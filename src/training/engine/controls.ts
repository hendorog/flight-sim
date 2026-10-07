// What the instructor knows about the cockpit controls (owner playtest: "No point just saying avionic switch,
// when the student needs to first find the switch, then which way do they need to switch it"): each control's
// name, where it is, the key that works it, and which signal shows its state. The guided checklists and the
// callouts read it; lesson data may override any of it per item (ChecklistItem.control / key / stateLabel).
//
// Inference: an item without `control` gets one from the signal its predicate tests (eq('avionics', false) ->
// the avionics switch), its required state from the predicate (OFF / ON / BOTH / RICH / an rpm band), and its
// key from that state (magnetos BOTH is 4, START is S; mixture RICH is Shift+M).

import type { ControlInputs } from '../../core/types';
import { isInputAction, keyLabelForAction, keysForAction, type InputAction } from '../../input/bindings';
import type { ChecklistItem, ChecklistKeyPair, ControlId, InstrumentId, PointTarget, Pred, SignalId } from '../types';

export interface ControlInfo {
  /** 'Avionics switch'. */
  label: string;
  /** Where it is, as said aloud: 'the rocker on the right of the switch row, under the panel'. */
  where: string;
  /** The key that works it when no state says otherwise. */
  action: InputAction | null;
}

const ROW = 'in the switch row along the bottom of the panel';

export const CONTROL_INFO: Readonly<Record<ControlId, ControlInfo>> = {
  master: { label: 'Master switch', where: `the red split rocker at the left of the switch row`, action: 'masterSwitch' },
  alternator: { label: 'Alternator', where: 'the left half of the red master rocker', action: 'alternator' },
  avionics: { label: 'Avionics switch', where: `the rocker at the right of the switch row, under the radios`, action: 'avionics' },
  fuelPump: { label: 'Fuel pump', where: `the first white rocker ${ROW}`, action: 'fuelPump' },
  beacon: { label: 'Beacon', where: `the white rocker marked BCN ${ROW}`, action: 'beacon' },
  landingLight: { label: 'Landing light', where: `the rocker marked LAND ${ROW}`, action: 'landingLight' },
  taxiLight: { label: 'Taxi light', where: `the rocker marked TAXI ${ROW}`, action: 'taxiLight' },
  navLights: { label: 'Navigation lights', where: `the rocker marked NAV ${ROW}`, action: 'navLights' },
  strobes: { label: 'Strobes', where: `the rocker marked STROBE ${ROW}`, action: 'strobes' },
  pitotHeat: { label: 'Pitot heat', where: `the rocker right of the avionics switch`, action: 'pitotHeat' },
  panelLights: { label: 'Panel lights', where: 'the small dimmer knob right of the switch row', action: 'panelLights' },
  magnetos: { label: 'Magneto key', where: 'the key switch at the bottom left of the panel', action: 'magnetoBoth' },
  throttle: { label: 'Throttle', where: 'the black knob in the middle, under the radios', action: 'throttleUp' },
  mixture: { label: 'Mixture', where: 'the red knob right of the throttle', action: 'mixtureRich' },
  flapLever: { label: 'Flap lever', where: 'the white lever right of the mixture', action: 'flapsUp' },
  trimWheel: { label: 'Trim wheel', where: 'the wheel between the seats, below the throttle', action: 'trimNoseUp' },
  fuelSelector: { label: 'Fuel selector', where: 'the valve on the floor between the seats', action: 'fuelSelector' },
  parkingBrake: { label: 'Parking brake', where: 'the handle under the left of the panel', action: 'parkingBrake' },
  yoke: { label: 'Control wheel', where: 'in front of you', action: null },
  rudderPedals: { label: 'Rudder pedals', where: 'at your feet', action: 'rudderLeft' },
  toeBrakes: { label: 'Toe brakes', where: 'the tops of the rudder pedals', action: 'brakes' },
};

export const INSTRUMENT_INFO: Readonly<Record<InstrumentId, { label: string; where: string }>> = {
  asi: { label: 'Airspeed indicator', where: 'top left of the six instruments' },
  ai: { label: 'Attitude indicator', where: 'top centre of the six instruments' },
  alt: { label: 'Altimeter', where: 'top right of the six instruments' },
  tc: { label: 'Turn coordinator', where: 'bottom left of the six instruments' },
  ball: { label: 'Balance ball', where: 'the bottom of the turn coordinator' },
  dg: { label: 'Heading indicator', where: 'bottom centre of the six instruments' },
  vsi: { label: 'Vertical speed indicator', where: 'bottom right of the six instruments' },
  tach: { label: 'Tachometer', where: 'right of your control column, low on the panel' },
  fuel: { label: 'Fuel gauges', where: 'low on the left of the panel' },
  oil: { label: 'Oil pressure gauge', where: 'low on the left, beside the fuel gauges' },
  flaps: { label: 'Flap indicator', where: 'beside the flap lever' },
};

export function isControlId(id: string): id is ControlId {
  return id in CONTROL_INFO;
}

export function targetLabel(t: PointTarget): string {
  return isControlId(t) ? CONTROL_INFO[t].label : INSTRUMENT_INFO[t as InstrumentId]?.label ?? t;
}

export function targetWhere(t: PointTarget): string {
  return isControlId(t) ? CONTROL_INFO[t].where : INSTRUMENT_INFO[t as InstrumentId]?.where ?? '';
}

// ---- inference from a predicate ------------------------------------------------------------------------------

/** The control (or instrument) whose state a signal shows. */
const SIG_TARGET: Partial<Record<string, PointTarget>> = {
  avionics: 'avionics', master: 'master', alternator: 'alternator', fuelPump: 'fuelPump', pitotHeat: 'pitotHeat',
  lightBeacon: 'beacon', lightNav: 'navLights', lightStrobe: 'strobes', lightLanding: 'landingLight', lightTaxi: 'taxiLight',
  fuelSel: 'fuelSelector', mixture: 'mixture', throttle: 'throttle', rpm: 'throttle', parkingBrake: 'parkingBrake',
  mags: 'magnetos', starter: 'magnetos', engineRunning: 'magnetos', flapsDeg: 'flapLever', flapLever: 'flapLever',
  trim: 'trimWheel', oilPsi: 'oil', brakes: 'toeBrakes',
};
/** Item ids whose control cannot be read from a predicate (Enter items that still name a control). */
const ITEM_TARGET: Partial<Record<string, PointTarget>> = {
  fuelPumpPrime: 'fuelPump', magCheck: 'magnetos', engineInstruments: 'oil', instruments: 'ai', controls: 'yoke',
  propArea: undefined,
};

/** The signals a predicate tests, first first. */
export function predSignals(p: Pred | undefined): string[] {
  if (!p) return [];
  const out: string[] = [];
  const walk = (q: Pred): void => {
    if ('sig' in q && typeof q.sig === 'string') out.push(q.sig);
    else if ('all' in q) q.all.forEach(walk);
    else if ('any' in q) q.any.forEach(walk);
    else if ('not' in q) walk(q.not);
    else if ('held' in q) walk(q.held);
    else if ('ever' in q) walk(q.ever);
  };
  walk(p);
  return out;
}

/** The control a checklist item sets: its own `control`, else from its predicate's signal or its id. */
export function itemTarget(item: ChecklistItem): PointTarget | null {
  if (item.control !== undefined) return item.control;
  for (const s of predSignals(item.state ?? item.check)) {
    const t = SIG_TARGET[s];
    if (t) return t;
  }
  return ITEM_TARGET[item.id] ?? null;
}

/** The first `{ sig, eq }` (or comparison) in a predicate for a signal. */
function findLeaf(p: Pred | undefined, sig: string): Pred | null {
  if (!p) return null;
  if ('sig' in p && p.sig === sig) return p;
  const kids: Pred[] = 'all' in p ? p.all : 'any' in p ? p.any : 'not' in p ? [] : 'held' in p ? [p.held] : 'ever' in p ? [p.ever] : [];
  for (const k of kids) {
    const hit = findLeaf(k, sig);
    if (hit) return hit;
  }
  return null;
}

const MAG_WORD = ['OFF', 'R', 'L', 'BOTH'];

/** The required state as a short label ('OFF', 'BOTH', 'RICH', '1,000 RPM'). */
export function itemStateLabel(item: ChecklistItem): string {
  if (item.stateLabel) return item.stateLabel;
  let r = item.response.split('(')[0].trim();
  if (!/, then /i.test(r)) r = r.split(', ')[0];
  return r.toUpperCase();
}

export interface KeyInfo { label: string; code: { code: string; shift: boolean } | null }

/** The key that does an input action, as the callout shows it. */
export function keyFor(action: InputAction | null): KeyInfo | null {
  return keyOf(action);
}

function keyOf(action: InputAction | null): KeyInfo | null {
  if (!action) return null;
  const label = keyLabelForAction(action);
  const k = keysForAction(action)[0];
  return label ? { label, code: k ? { code: k.code, shift: k.shift } : null } : null;
}

/**
 * The key for an item: its `key` (an action id or a literal label), else the action the required state
 * needs (magnetos BOTH -> 4, START -> S; mixture RICH -> Shift+M, lean -> M; throttle up / down -> F3 / F2).
 */
export function itemKey(item: ChecklistItem, target: PointTarget | null, frame?: Readonly<Record<string, unknown>>): KeyInfo | null {
  const pred = item.state ?? item.check;
  if (item.key === null) return null;
  if (typeof item.key === 'string') return isInputAction(item.key) ? keyOf(item.key) : { label: item.key, code: null };
  if (item.key) return pairKey(item.key, pred, frame);
  if (!target || !isControlId(target)) return null;
  switch (target) {
    case 'magnetos': {
      if (findLeaf(pred, 'engineRunning') || findLeaf(pred, 'starter')) return keyOf('starter');
      const leaf = findLeaf(pred, 'mags');
      const v = leaf && 'eq' in leaf ? Number(leaf.eq) : 3;
      return keyOf((['magnetoOff', 'magnetoRight', 'magnetoLeft', 'magnetoBoth'] as const)[v] ?? 'magnetoBoth');
    }
    case 'mixture': {
      const leaf = findLeaf(pred, 'mixture');
      const lean = leaf && 'op' in leaf && (leaf.op === '<' || leaf.op === '<=');
      return keyOf(lean ? 'mixtureLean' : 'mixtureRich');
    }
    case 'throttle': {
      // The band's edges (an rpm or a lever position): forward below the lower edge, back above the upper.
      const both = { label: `${keyLabelForAction('throttleDown')} / ${keyLabelForAction('throttleUp')}`, code: null };
      const b = bandOf(pred, 'rpm') ?? bandOf(pred, 'throttle');
      if (!b) return both;
      const cur = b.sig === 'rpm' ? num(frame?.rpm) : num(frame?.throttle);
      if (!Number.isFinite(cur)) return both;
      if (cur < b.lo) return keyOf('throttleUp');
      if (cur > b.hi) return keyOf('throttleDown');
      return both;
    }
    case 'flapLever': {
      const leaf = findLeaf(pred, 'flapsDeg') ?? findLeaf(pred, 'flapLever');
      const down = leaf && 'op' in leaf && (leaf.op === '>' || leaf.op === '>=');
      return keyOf(down ? 'flapsDown' : 'flapsUp');
    }
    default:
      return keyOf(CONTROL_INFO[target].action);
  }
}

const num = (x: unknown): number => (typeof x === 'number' ? x : NaN);

const keyOrLabel = (k: string): KeyInfo | null => (isInputAction(k) ? keyOf(k) : { label: k, code: null });

/** A raise / lower pair (ChecklistItem.key): by which side of the predicate's band the control is on now. */
function pairKey(pair: ChecklistKeyPair, pred: Pred | undefined, frame?: Readonly<Record<string, unknown>>): KeyInfo | null {
  const both = { label: `${keyOrLabel(pair.lower)?.label ?? pair.lower} / ${keyOrLabel(pair.raise)?.label ?? pair.raise}`, code: null };
  const sigs = predSignals(pred);
  for (const sig of sigs) {
    const b = bandOf(pred, sig);
    if (!b) continue;
    const cur = num(frame?.[sig]);
    if (!Number.isFinite(cur)) return both;
    if (cur < b.lo) return keyOrLabel(pair.raise);
    if (cur > b.hi) return keyOrLabel(pair.lower);
    return both;
  }
  return both;
}

/** The band a predicate puts on `sig` (its >, >=, <, <= leaves under all()); null when it tests none. */
function bandOf(p: Pred | undefined, sig: string): { sig: string; lo: number; hi: number } | null {
  if (!p) return null;
  const leaves: Pred[] = 'all' in p ? p.all : [p];
  let lo = -Infinity, hi = Infinity, any = false;
  for (const l of leaves) {
    if (!('sig' in l) || l.sig !== sig || !('op' in l) || typeof l.v !== 'number') continue;
    any = true;
    if (l.op === '>' || l.op === '>=') lo = Math.max(lo, l.v);
    else hi = Math.min(hi, l.v);
  }
  return any ? { sig, lo, hi } : null;
}

/**
 * The key for a control pointed at with a state ('START' on the magnetos is the starter, S; 'RICH' is Shift+M):
 * a step's `point` with `pointState`, a reminder that names the direction. Else the control's main key.
 */
export function stateKey(t: PointTarget, state: string | null): KeyInfo | null {
  const st = (state ?? '').toUpperCase();
  if (t === 'magnetos') {
    if (st === 'START') return keyOf('starter');
    const i = ['OFF', 'R', 'L', 'BOTH'].indexOf(st);
    if (i >= 0) return keyOf((['magnetoOff', 'magnetoRight', 'magnetoLeft', 'magnetoBoth'] as const)[i]);
  }
  if (t === 'mixture' && st) return keyOf(/RICH/.test(st) ? 'mixtureRich' : 'mixtureLean');
  if (t === 'flapLever' && st) return keyOf(/UP/.test(st) ? 'flapsUp' : 'flapsDown');
  if (t === 'throttle' && /BACK|IDLE|CLOSE/.test(st)) return keyOf('throttleDown');
  return targetKey(t);
}

/** Thousands separator for spoken rpm ('1,840'). */
const thousands = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Ground throttle (lever 0-1) for an rpm with the engine warm, standing still: about 880 rpm at 0.04 and 1,840
 * at 0.2 (playtest 3), near enough linear over the ground range. For the instructor setting an rpm herself.
 */
export function groundThrottleFor(rpm: number): number {
  return Math.min(1, Math.max(0.02, 0.04 + (rpm - 880) / 6000));
}

/** The key of a control pointed at outside a checklist (its main action), or null (instruments, the yoke). */
export function targetKey(t: PointTarget): KeyInfo | null {
  return isControlId(t) ? keyOf(CONTROL_INFO[t].action) : null;
}

/** What the control shows now, in words ('on', 'off', 'lean', 'R'), for "still ..." reminders; null if unknown. */
export function currentStateWord(target: PointTarget, frame: Readonly<Record<string, unknown>>): string | null {
  const b = (sig: SignalId): string | null => (typeof frame[sig] === 'boolean' ? (frame[sig] ? 'on' : 'off') : null);
  switch (target) {
    case 'avionics': return b('avionics');
    case 'master': return b('master');
    case 'alternator': return b('alternator');
    case 'fuelPump': return b('fuelPump');
    case 'pitotHeat': return b('pitotHeat');
    case 'beacon': return b('lightBeacon');
    case 'navLights': return b('lightNav');
    case 'strobes': return b('lightStrobe');
    case 'landingLight': return b('lightLanding');
    case 'taxiLight': return b('lightTaxi');
    case 'parkingBrake': return typeof frame.parkingBrake === 'boolean' ? (frame.parkingBrake ? 'set' : 'off') : null;
    case 'magnetos': return Number.isFinite(num(frame.mags)) ? MAG_WORD[num(frame.mags)] ?? null : null;
    case 'fuelSelector': return typeof frame.fuelSel === 'string' ? frame.fuelSel.toUpperCase() : null;
    case 'mixture': { const m = num(frame.mixture); return Number.isFinite(m) ? (m >= 0.95 ? 'rich' : m <= 0.05 ? 'at cut-off' : 'lean') : null; }
    case 'throttle': {
      const r = num(frame.rpm);
      if (Number.isFinite(r) && r > 100) return `at ${thousands(Math.round(r / 10) * 10)} rpm`;
      const th = num(frame.throttle);
      return Number.isFinite(th) && th <= 0.02 ? 'closed' : null;
    }
    case 'flapLever': { const f = num(frame.flapsDeg); return Number.isFinite(f) ? (f < 1 ? 'up' : `${Math.round(f)} degrees`) : null; }
    default: return null;
  }
}

/**
 * Controls that make a simple predicate true (the instructor sets a missed item, or shows it): switches,
 * levers and the selector. Null when it cannot be done by setting a control (an rpm, a gauge, the start).
 */
export function controlsFor(pred: Pred | undefined): Partial<ControlInputs> | null {
  if (!pred) return null;
  // An rpm band on the ground (1,000 rpm after the start, 1,800 for the run-up): she sets the throttle for it.
  const rpmBand = bandOf(pred, 'rpm');
  if (rpmBand && predSignals(pred).every((x) => x === 'rpm')) {
    const lo = Number.isFinite(rpmBand.lo) ? rpmBand.lo : rpmBand.hi - 300;
    const hi = Number.isFinite(rpmBand.hi) ? rpmBand.hi : rpmBand.lo + 300;
    return { throttle: groundThrottleFor((lo + hi) / 2) };
  }
  const leaves: Pred[] = 'all' in pred ? pred.all : [pred];
  const out: Record<string, unknown> = {};
  let lights: Record<string, unknown> | null = null;
  let any = false;
  for (const l of leaves) {
    if (!('sig' in l) || typeof l.sig !== 'string') return null;
    const sig = l.sig;
    if ('eq' in l) {
      const v = l.eq;
      const lightKey: Partial<Record<string, keyof ControlInputs['lights']>> = { lightNav: 'nav', lightBeacon: 'beacon', lightStrobe: 'strobe', lightLanding: 'landing', lightTaxi: 'taxi' };
      const direct: Partial<Record<string, keyof ControlInputs>> = {
        avionics: 'avionics', master: 'masterBattery', alternator: 'alternator', fuelPump: 'fuelPump', pitotHeat: 'pitotHeat',
        parkingBrake: 'parkingBrake', mags: 'magnetos', fuelSel: 'fuelSelector',
      };
      if (lightKey[sig]) (lights ??= {})[lightKey[sig]!] = v;
      else if (direct[sig]) out[direct[sig]!] = v;
      else return null;
      if (sig === 'master' && v === true) out.alternator = true;
      any = true;
    } else if ('op' in l && typeof l.v === 'number') {
      const up = l.op === '>' || l.op === '>=';
      if (sig === 'mixture') out.mixture = up ? 1 : 0;
      else if (sig === 'flapsDeg' || sig === 'flapLever') out.flaps = up ? 1 / 3 : 0;
      else if (sig === 'throttle') out.throttle = up ? Math.min(1, l.v + 0.05) : Math.max(0, l.v - 0.05);
      else return null;
      any = true;
    } else {
      return null;
    }
  }
  if (lights) out.lights = lights;
  // A partial `lights` object: TrainingSystem's setControls merges it into the current lights.
  return any ? (out as Partial<ControlInputs>) : null;
}
