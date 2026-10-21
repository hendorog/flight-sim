// Per-session checklist progress. Automatic marks describe current simulator state; a manual override
// wins until reset, even for an automatic item. Nothing is written to controls, lessons or saved flights.
import type { SimContext } from '../core/context';
import { FPM, FT, KT, RAD } from '../core/math';
import { engineControl } from '../core/types';
import { compile } from '../training/engine/predicates';
import { STANDARDS } from '../training/grading/standards';
import { propShaftTorqueFtLb } from '../training/telemetry/providers/powerplant';
import type { AircraftTypeDef, CompiledPred, EvalContext, Pred, SignalFrame } from '../training/types';
import type { FlightChecklist, FlightChecklistItem } from '../training/checklistData';

export type ChecklistTab = 'normal' | 'emergency';
export interface ChecklistMark { done: boolean; mode: 'auto' | 'manual'; overridden: boolean }
const EMERGENCIES = new Set(['engineFailure', 'forcedLandingSecurity']);
const ORDER = ['preflight', 'beforeStart', 'engineStart', 'afterStart', 'taxi', 'runup', 'beforeTakeoff', 'takeoff', 'afterTakeoff', 'climb', 'cruise', 'descent', 'downwind', 'final', 'landing', 'afterLanding', 'shutdown'];
const EMERGENCY_ORDER = ['powerFailure', 'engineFailure', 'lowHeightFailure', 'lowRpm', 'forcedLandingSecurity', 'startFire', 'hotStart', 'engineFire', 'chipLight', 'electricalFire', 'electrical', 'pusher'];

// Legacy school checks sometimes cover only part of their challenge. Explicitly admit the simple switch,
// lever and gauge items; combined inspections / timed sequences remain manual in the reference panel.
const LIVE_IDS = new Set(['fuelSelector', 'fuelPump', 'mixture', 'mags', 'parkingBrake', 'parkingBrakeOff',
  'avionicsOff', 'avionicsOn', 'master', 'beacon', 'navLights', 'strobes', 'landingLight', 'strobesOff',
  'flapsUp', 'flaps', 'rpm', 'runupRpm', 'climbPower', 'mixtureCutoff', 'magsOff', 'fuelOff',
  'masterOff', 'throttleIdle', 'mixturesForward', 'throttlesForward', 'throttlesIdle', 'fuelSelectorTank']);

// Cessna 208 (turboprop): audited simple lever / switch items. The battery is checked alone (the generator comes
// on after the start); the start sequence (starter, condition lever at 13 % Ng, starter off at 52 %) stays manual.
const C208_LIVE_IDS = new Set(['powerIdle', 'conditionCutoff', 'conditionHighIdle', 'conditionLowIdle', 'propMax',
  'propFeather', 'generator', 'runupPower', 'flapsLanding', 'ignitionOn']);

// Pilatus PC-12/47 (turboprop with a condition lever on `mixture` and no propeller lever): the audited simple lever and
// switch items. The battery is checked alone (the generators come on after the start); the start sequence (one STARTER
// press, condition lever to GROUND IDLE at 13 % Ng, the starter cutting out at 50 %) and the engine checks stay manual
// or are the explicit live predicates of the item itself.
const PC12_LIVE_IDS = new Set(['powerIdle', 'conditionCutoff', 'conditionGndIdle', 'conditionFltIdle', 'generators', 'runupPower',
  'flapsLanding', 'ignitionOn', 'fuelPump']);

export function livePredicate(item: FlightChecklistItem, section: FlightChecklist, type: AircraftTypeDef): Pred | null {
  if (item.live !== undefined) return item.live;
  if (item.id === 'carbHeat' && ['c152', 'pa38'].includes(type.id)) {
    if (/^cold$/i.test(item.response)) return { sig: 'checklist.carbHeat', op: '<=', v: 0.01 };
    if (/^on$/i.test(item.response)) return { sig: 'checklist.carbHeat', op: '>=', v: 0.99 };
  }
  if (type.id === 'c208') {
    if (item.id === 'master' || C208_LIVE_IDS.has(item.id)) return item.state === null ? null : item.state ?? item.check ?? null;
    if (item.id === 'flapsUp' && section.id === 'afterTakeoff') return null; // retraction above 90 KIAS is a sequence
  }
  if (type.id === 'pc12') {
    if (item.id === 'master' || PC12_LIVE_IDS.has(item.id)) return item.state === null ? null : item.state ?? item.check ?? null;
    if (item.id === 'gear' || item.id === 'gearUp') return item.id === 'gear' ? { sig: 'checklist.gearDown', eq: true } : null; // gear up after take-off is a sequence
    if (item.id === 'flapsUp' && section.id === 'afterTakeoff') return null; // retraction above 100 KIAS is a sequence
  }
  if (item.id === 'gear' && type.id === 'pa34') return { sig: 'checklist.gearDown', eq: true };
  if (item.id === 'fuelSelector' && type.id === 'pa38') return null; // proper / other tank requires judgement or a sequence
  if (item.id === 'fuelSelectorTank') return { any: [{ sig: 'fuelSel', eq: 'left' }, { sig: 'fuelSel', eq: 'right' }] };
  if (item.id === 'mags' && /then|check/i.test(item.response)) return null;
  if (item.id === 'magsOff' && /key out/i.test(item.response)) return null;
  if (item.id === 'avionicsOn' && type.id === 'da20') return null; // includes setting the radios
  if (item.id === 'masterOff' && /after/i.test(item.response)) return null;
  if (item.id === 'climbPower' && type.id === 'pa34') return null; // includes MAP and an altitude-dependent sequence
  if (item.id === 'flaps' && (type.id === 'pa38' || type.id === 'pa34')) return null; // runway / takeoff configuration choice
  if (item.id === 'master') return { all: [{ sig: 'master', eq: true }, { sig: 'alternator', eq: true }] };
  if (item.id === 'ammeter') return { all: [{ sig: 'ammeterA', op: '>=', v: 0 }, { sig: 'engineRunning', eq: true }, { sig: 'alternator', eq: true }, { sig: 'checklist.alternatorAmps', op: '>', v: 0 }] };
  if (item.id === 'start') return { all: [{ sig: 'engineRunning', eq: true }, { sig: 'starter', eq: false }, { sig: 'mags', eq: 3 }] };
  // A partial scalar check must never certify these combined responses.
  if (item.id === 'masterOff') return { all: [{ sig: 'master', eq: false }, { sig: 'alternator', eq: false }] };
  if (item.id === 'flapsUp' && section.id === 'afterTakeoff' && ['c152', 'pa38', 'da20'].includes(type.id)) return null; // retraction at a specified height / speed is a sequence
  if (!LIVE_IDS.has(item.id) || item.lookout) return null;
  const pred = item.state === null ? null : item.state ?? item.check ?? null;
  return pred && ['rpm', 'runupRpm'].includes(item.id) ? { all: [pred, { sig: 'engineRunning', eq: true }] } : pred;
}

export function checklistSections(type: AircraftTypeDef | undefined, aircraftId: string, placeholder = false): FlightChecklist[] {
  if (!type || type.id !== aircraftId || placeholder) return [];
  return Object.values(type.checklists).filter(s => s.items.length > 0).map(s => ({
    ...s, category: (s as FlightChecklist).category ?? (EMERGENCIES.has(s.id) ? 'emergency' : 'normal'),
  })).sort((a, b) => {
    const rank = (s: FlightChecklist): number => {
      const emergency = s.category === 'emergency', order = emergency ? EMERGENCY_ORDER : ORDER;
      const i = order.indexOf(s.id);
      return (emergency ? ORDER.length + 1 : 0) + (i < 0 ? order.length : i);
    };
    return rank(a) - rank(b);
  });
}

/** Real state only. Twin checks run with each engine's overrides, never the all-engine input scalar. */
export function checklistFrame(ctx: Pick<SimContext, 'state' | 'controls' | 'weather' | 'aircraft'>, engine = 0): SignalFrame {
  const s = ctx.state, c = ctx.controls, e = s.engines[engine] ?? (engine === 0 ? s.engine : undefined);
  const f: SignalFrame = {
    master: c.masterBattery, avionics: c.avionics, parkingBrake: c.parkingBrake,
    lightNav: c.lights.nav, lightBeacon: c.lights.beacon, lightStrobe: c.lights.strobe,
    lightLanding: c.lights.landing, lightTaxi: c.lights.taxi, pitotHeat: c.pitotHeat,
    flapLever: c.flaps, flapsDeg: s.surfaces.flaps * RAD, trim: c.elevatorTrim,
    elevator: c.elevator, aileron: c.aileron, rudder: c.rudder,
    onGround: s.onGround, kias: s.ias / KT, asiKt: s.ias / KT, aglFt: s.altitudeAGL / FT,
    altFt: s.altitudeMSL / FT, vsFpm: s.verticalSpeed / FPM,
    ammeterA: s.electrical.batteryAmps, 'checklist.alternatorAmps': s.electrical.alternators[engine], qnhErrHpa: c.kollsmanHpa - ctx.weather.qnhHpa,
    'checklist.gearDown': s.gear.locked.every(Boolean),
  };
  const engineKeys = { throttle: 'throttle', mixture: 'mixture', mags: 'magnetos', starter: 'starter',
    fuelSel: 'fuelSelector', fuelPump: 'fuelPump', alternator: 'alternator', 'checklist.carbHeat': 'carbHeat',
    propeller: 'propeller', cowlFlaps: 'cowlFlaps', alternateAir: 'alternateAir' } as const;
  for (const [signal, key] of Object.entries(engineKeys)) f[signal] = engineControl(c, engine, key);
  if (e) { f.rpm = e.rpm; f.engineRunning = e.running; f.oilPsi = e.oilPressure; f.oilTempF = e.oilTemp * 9 / 5 + 32; }
  // The 'powerplant' telemetry signals, per engine (training/telemetry/providers/powerplant.ts).
  f['prop.lever'] = engineControl(c, engine, 'propeller');
  f['prop.rpm'] = e?.propRpm ?? 0;
  const turbine = e?.ng !== undefined;
  f['turbine.ng'] = turbine ? e?.ng ?? 0 : 0;
  f['turbine.itt'] = turbine ? e?.itt ?? 0 : 0;
  f['turbine.torqueFtLb'] = turbine && e ? propShaftTorqueFtLb(e.torque, e.rpm, e.propRpm) : 0;
  const rotor = s.rotorcraft, d = ctx.aircraft.rotorcraft;
  if (rotor && d) {
    f['checklist.collective'] = c.collective ?? 0; f['checklist.governor'] = c.rotorGovernor ?? false; f['checklist.clutch'] = c.rotorClutch ?? false;
    f['checklist.clutchEngagement'] = rotor.clutchEngagement; f['checklist.clutchLight'] = rotor.clutchLight;
    f['checklist.governorActive'] = rotor.governorActive; f['checklist.rotorPercent'] = rotor.rotorRpm / d.referenceRpm * 100;
    if (e) f['checklist.enginePercent'] = e.rpm / (d.referenceRpm * d.engineRatio) * 100;
    // Controls and state of the rigid-rotor types (AH-56A): the tail-wheel lock, the prop lever and blade angle, the control gyro mode.
    f['checklist.tailWheelLock'] = c.tailWheelLock ?? false;
    f['checklist.propLever'] = c.propLever ?? 0;
    f['checklist.propBeta'] = rotor.pusher ? rotor.pusher.beta * RAD : 0;
    f['checklist.gyroIcs'] = rotor.controlGyro?.mode === 'ics';
  }
  return f;
}

export class ChecklistSession {
  readonly sections: FlightChecklist[];
  tab: ChecklistTab = 'normal';
  sectionId = '';
  linkedItem: string | null = null;
  private readonly overrides = new Map<string, boolean>();
  private readonly results = new Map<string, boolean>();
  private readonly checks = new Map<string, CompiledPred[]>();

  constructor(readonly type: AircraftTypeDef | undefined, aircraftId: string, private readonly engines: number, placeholder = false) {
    this.sections = checklistSections(type, aircraftId, placeholder);
    this.sectionId = this.sections[0]?.id ?? '';
    if (type) for (const section of this.sections) for (const item of section.items) {
      const pred = livePredicate(item, section, type);
      if (pred) this.checks.set(this.key(section.id, item.id), Array.from({ length: engines }, () => compile(pred)));
    }
  }

  get available(): FlightChecklist[] { return this.sections.filter(s => s.category === this.tab); }
  get section(): FlightChecklist | undefined { return this.sections.find(s => s.id === this.sectionId); }
  get currentItem(): string | null { return this.linkedItem ?? this.section?.items.find(i => !this.mark(i.id).done)?.id ?? null; }
  select(id: string, item: string | null = null): void {
    const section = this.sections.find(s => s.id === id);
    if (!section) return;
    this.sectionId = id; this.tab = section.category ?? 'normal'; this.linkedItem = item;
  }
  changeTab(tab: ChecklistTab): void { this.tab = tab; this.sectionId = this.available[0]?.id ?? ''; this.linkedItem = null; }
  move(delta: number): void {
    const lists = this.available, index = lists.findIndex(s => s.id === this.sectionId);
    const next = lists[index + delta]; if (next) this.select(next.id);
  }
  mark(item: string): ChecklistMark {
    const key = this.key(this.sectionId, item), manual = this.overrides.get(key);
    return { done: manual ?? this.results.get(key) ?? false, mode: manual !== undefined || !this.checks.has(key) ? 'manual' : 'auto', overridden: manual !== undefined };
  }
  toggle(item: string): void { this.overrides.set(this.key(this.sectionId, item), !this.mark(item).done); }
  reset(): void {
    this.overrides.clear(); this.results.clear(); this.linkedItem = null;
    for (const checks of this.checks.values()) for (const check of checks) check.reset();
  }
  update(ctx: SimContext): void {
    if (!this.type) return;
    const frames = Array.from({ length: this.engines }, (_, i) => checklistFrame(ctx, i));
    const evaluation: EvalContext = {
      frame: frames[0], aircraft: this.type, vars: {}, standards: STANDARDS, authority: 'easa', standard: 'training',
      fieldElevFt: 0, dt: 0, simT: ctx.simTime, stepT: 0, stepMark: 0, pilot: 'student', speechIdle: true,
      signalDef: () => undefined, exerciseGrade: () => null, events: { mark: () => 0, since: () => [] },
    };
    for (const item of this.section?.items ?? []) {
      const key = this.key(this.sectionId, item.id), checks = this.checks.get(key);
      if (checks) this.results.set(key, checks.map((check, i) => check.eval({ ...evaluation, frame: frames[i] })).every(Boolean));
    }
  }
  private key(section: string, item: string): string { return `${section}/${item}`; }
}
