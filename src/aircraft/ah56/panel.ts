// Lockheed AH-56A Cheyenne: the REAR-SEAT PILOT panel and instrument systems. AGENT RECONSTRUCTION, UNVERIFIED: no photograph
// or drawing of this panel exists in the sources (research-ah56 section 12). Built from the report text: rectangular vertical-tape
// gauges for torque, TIT, Ng and Nf / Nr (ASTA-72 para 73e), the basic T around an ADI / HSI, collective blade-angle and propeller
// blade-angle indicators in degrees (SoF, ASTA-72 App H), fuel (low 390 lb), a g-meter (APE-I para 134f), engine and transmission
// oil, triple hydraulic pressure (systems 1, 1A, 2), MASTER CAUTION with a small caution panel (APE-I para 134j), the gear handle
// and lights, the tail-wheel lock lever, and a placard of the control system in use with the ICS roll-compensator and
// pitch-desensitizer buttons. See docs/ah56-panel.md for what is a compromise. Frozen contract: panelLayout.ts (AH56_PANEL_CANVAS,
// AH56_TAPE_STACK).
import { clamp, DEG } from '../../core/math';
import type { AircraftState, ControlInputs } from '../../core/types';
import type { InstrumentSystemsDef, LampDef, LampInputs, PanelDef, Rect, SwitchDef } from '../types';
import type { InstrumentReadings } from '../../instruments/dynamics/instrumentSet';
import { ignitionLayout } from '../../instruments/panelParts';
import { AH56_COLLECTIVE_DEG, AH56_MASS_LB, AH56_NF_100_RPM, AH56_NR_100, AH56_TIT_C, AH56_TORQUE_LIMIT_PCT } from './facts';
import { Ah56AngleIndicator, Ah56GyroPlacard, Ah56HydraulicsGauge, Ah56TapeGauge } from './panelGauges';
import { AH56_PANEL_CANVAS, AH56_PANEL_OUTLINE, AH56_TAPE_STACK as STACK } from './panelLayout';
import { AH56_ASI_MARKS, AH56_BETA_INDICATOR, AH56_COLLECTIVE_INDICATOR, AH56_DIAL_SWEEP as SWEEP, AH56_ENGINE_OIL, AH56_FUEL_SCALE, AH56_G_SCALE,
  AH56_KG_PER_GAL, AH56_LB_PER_KG, AH56_NF_NR_TAPE, AH56_NG_TAPE, AH56_TIT_TAPE, AH56_TORQUE_TAPE, AH56_XMSN_OIL, ah56TorquePct } from './panelMarkings';
import { AH56_POWERPLANT } from './powerplant';
import { AH56_ROTORCRAFT } from './rotorcraft';

/** 3-1/8" instruments of the basic T: the rect of a scaled large gauge (175 px) stays inside the 182 px column pitch. */
const K = 0.95;
const SCALE = { large: K, small: 1 };
const AMBER = '#ffba35';

// ---------------------------------------------------------------------------------------------------- layout, px
const T = { cols: [130, 312, 494], rows: [150, 342] } as const;
/** The tape stack of the frozen contract: four tapes in a 248 px wide stack, 400 px tall, under the caution panel. */
const TAPES = { x: STACK.x, y: 318, w: STACK.w, h: 400, each: 58, pitch: 62 } as const;
const tapeRect = (i: number): Rect => ({ x: TAPES.x + i * TAPES.pitch, y: TAPES.y, w: TAPES.each, h: TAPES.h });
const INDICATORS = { collective: { x: 24, y: 452, w: 130, h: 178 }, beta: { x: 162, y: 452, w: 130, h: 178 } } as const;
const SWITCHES: Rect = { x: 896, y: 800, w: 576, h: 130 };
const IGNITION: PanelDef['ignition'] = { kind: 'toggles', at: [1380, 190], engines: 1, switches: 'ignition' };

// ---------------------------------------------------------------------------------------------------- lamps
type LampRow = readonly [id: string, text: string, color: string];
/** MASTER CAUTION and the small caution panel (APE-I para 134j: "a limited number of items"); legends AGENT. */
const LAMP_ROWS: readonly LampRow[] = [
  ['master', 'MASTER CAUTION', AMBER],
  ['lowFuel', 'LOW FUEL', AMBER], ['xmsnOil', 'XMSN OIL PRESS', AMBER],
  ['engOil', 'ENG OIL PRESS', AMBER], ['tit', 'TIT HIGH', AMBER],
  ['nr', 'NR LOW', AMBER], ['gear', 'GEAR UNSAFE', AMBER],
  ['torque', 'TORQUE HIGH', AMBER], ['pressTest', 'LAMP TEST', '#e9e6d6'],
];
const CELLS: readonly Rect[] = [
  { x: TAPES.x, y: 80, w: TAPES.w, h: 48 },
  ...Array.from({ length: 8 }, (_, i) => ({ x: TAPES.x + (i % 2) * 127, y: 134 + Math.floor(i / 2) * 44, w: 121, h: 40 })),
];
const lampPress = (id: string) => id === 'pressTest' || id === 'master'
  ? (down: boolean, c: ControlInputs) => { c.annunciatorTest = down; }
  : (down: boolean, c: ControlInputs) => { c.lampTestId = down ? id : undefined; };
export const AH56_ANNUNCIATOR_LAMPS: readonly LampDef[] = LAMP_ROWS.map(([id, text, color]) => ({ id, text, color, lit: r => r.lamps[id] ?? false, press: lampPress(id) }));

const powered = (i: LampInputs): boolean => i.state.electrical.busVoltage > AH56_POWERPLANT.electrical.busDeadVolts;
const fuelLb = (s: AircraftState): number => (s.fuel.left + s.fuel.right) * AH56_LB_PER_KG;
const nrPct = (s: AircraftState): number => (s.rotorcraft?.rotorRpm ?? 0) / AH56_NR_100 * 100;
/**
 * Caution rules. Limits are the published ones (tagged in panelMarkings.ts); the pressure cautions are ESTIMATE thresholds (the SoF
 * gives the markings, not the switch settings).
 */
const RULES: Record<string, (i: LampInputs) => boolean> = {
  lowFuel: i => fuelLb(i.state) <= AH56_MASS_LB.lowFuel,
  // The transmission oil caution light may come on below the minimum manoeuvre load factor (P AMCS-73 SoF): with the rotor turning.
  xmsnOil: i => { const t = i.state.rotorcraft?.transmission; return t !== undefined && nrPct(i.state) > 50 && t.oilPressurePsi < 70; },
  engOil: i => i.state.engine.running && i.state.engine.oilPressure < 10,
  tit: i => (i.state.engine.itt ?? 0) > AH56_TIT_C.continuous,
  // Nr under the power-on minimum of 95 % with the engine at power (the ground idle Nr is lower by design).
  nr: i => i.state.engine.running && (i.state.engine.ng ?? 0) > 90 && nrPct(i.state) < 95,
  gear: i => i.state.gear.retractable && i.state.gear.inTransit,
  torque: i => ah56TorquePct(i.state.engine.torque) > AH56_TORQUE_LIMIT_PCT,
};
const CAUTION_IDS = ['lowFuel', 'xmsnOil', 'engOil', 'tit', 'nr', 'gear', 'torque'] as const;
export const AH56_LAMP_IDS: readonly string[] = LAMP_ROWS.map(l => l[0]);

// ---------------------------------------------------------------------------------------------------- gauges
const DIAL = { a0: SWEEP.a0, a1: SWEEP.a1 };
const extra = (r: InstrumentReadings, id: string): number => r.extra?.[id] ?? NaN;
const nfPct = (r: InstrumentReadings): number => r.engines[0].rpm / AH56_NF_100_RPM * 100;
const switchDef = (id: string, label: string, i: number, on: SwitchDef['on'], toggle: SwitchDef['toggle'], red = false): SwitchDef =>
  ({ id, label, name: label, x: 44 + i * 80, on, toggle, red });

/** Tail-wheel lock lever: LOCKED / UNLOCKED on ControlInputs.tailWheelLock (absent = unlocked: the gear reads it as a truth value). */
const tailWheel: PanelDef['gauges'][number] = { kind: 'positionSwitch', id: 'tailWheel', bounds: { x: 1160, y: 84, w: 110, h: 176 }, label: 'TAIL WHEEL',
  positions: ['LOCKED', 'UNLOCKED'], read: c => c.tailWheelLock ? 0 : 1, set: (c, position) => { c.tailWheelLock = position === 0; } };

export const AH56_PANEL: PanelDef = {
  id: 'ah56',
  // Fixed 2D view. Upper: the basic T with the blade-angle indicators, the tape stack (whole, one crop), the round engine
  // gauges and the lenses. Lower: gear, tail wheel, hydraulics, the control-system placard and every switch.
  fixed: { flightRows: [['asi', 'attitude', 'altimeter', 'collective'], ['clock', 'hsi', 'vsi', 'propBeta']],
    crops: [{ x: TAPES.x - 2, y: TAPES.y - 2, w: TAPES.w + 4, h: TAPES.h + 4 }],
    controls: [SWITCHES, ignitionLayout(IGNITION)!.rect], lampsBeside: true },
  size: AH56_PANEL_CANVAS, instrumentScale: SCALE, instrumentBezel: 'square', lightingDimmerExponent: 2.2,
  apertures: { large: 74 * SCALE.large, small: 51 * SCALE.small },
  gauges: [
    // The basic T: ASI | ADI | altimeter over the HSI, with the clock and the VSI under the arms.
    { kind: 'asi', id: 'asi', at: [T.cols[0], T.rows[0]], marks: AH56_ASI_MARKS },
    { kind: 'attitude', id: 'attitude', at: [T.cols[1], T.rows[0]], inclinometer: true },
    { kind: 'altimeter', id: 'altimeter', at: [T.cols[2], T.rows[0]] },
    { kind: 'clock', id: 'clock', at: [T.cols[0], T.rows[1]] },
    { kind: 'hsi', id: 'hsi', at: [T.cols[1], T.rows[1]], receiver: 'nav1', fixedCourseDeg: 0 },
    { kind: 'vsi', id: 'vsi', at: [T.cols[2], T.rows[1]] },
    // The vertical tapes.
    { kind: 'customRect', id: 'torqueTape', bounds: tapeRect(0), create: (id, b) => new Ah56TapeGauge(id, b, AH56_TORQUE_TAPE, [r => extra(r, 'torquePct')]) },
    { kind: 'customRect', id: 'titTape', bounds: tapeRect(1), create: (id, b) => new Ah56TapeGauge(id, b, AH56_TIT_TAPE, [r => r.engines[0].ittC]) },
    { kind: 'customRect', id: 'ngTape', bounds: tapeRect(2), create: (id, b) => new Ah56TapeGauge(id, b, AH56_NG_TAPE, [r => r.engines[0].ngPct]) },
    { kind: 'customRect', id: 'nfNrTape', bounds: tapeRect(3), create: (id, b) => new Ah56TapeGauge(id, b, AH56_NF_NR_TAPE, [nfPct, r => r.rotorRpmPct]) },
    // Collective blade angle (indicated per configuration) and propeller blade angle.
    { kind: 'customRect', id: 'collective', bounds: INDICATORS.collective, create: (id, b) => new Ah56AngleIndicator(id, b, AH56_COLLECTIVE_INDICATOR, r => extra(r, 'collectiveDeg')) },
    { kind: 'customRect', id: 'propBeta', bounds: INDICATORS.beta, create: (id, b) => new Ah56AngleIndicator(id, b, AH56_BETA_INDICATOR, r => extra(r, 'propBetaDeg')) },
    // Round auxiliaries.
    { kind: 'single', id: 'gMeter', at: [410, 520], seed: 2001, size: 'small', ...DIAL, title: 'G', units: '', labels: [-2, 0, 2, 4],
      scale: { ...AH56_G_SCALE, read: r => extra(r, 'gLoad') } },
    { kind: 'single', id: 'fuel', at: [548, 520], seed: 2002, size: 'small', ...DIAL, title: 'FUEL', units: 'LB ×100', labels: [0, 10, 20, 30],
      scale: { ...AH56_FUEL_SCALE, read: r => extra(r, 'fuelLb') / 100 } },
    { kind: 'dual', id: 'engineOil', at: [410, 660], seed: 2003, title: ['ENG OIL', '°C  PSI'],
      left: { label: 'T', min: 0, max: 150, majors: [0, 50, 100, 150], minorStep: 10, numbers: true, arcs: AH56_ENGINE_OIL.temp.arcs, redLines: AH56_ENGINE_OIL.temp.redLines, read: r => (r.engines[0].oilTempF - 32) * 5 / 9 },
      right: { label: 'P', min: 0, max: 100, majors: [0, 25, 50, 75, 100], minorStep: 5, numbers: true, arcs: AH56_ENGINE_OIL.pressure.arcs, redLines: AH56_ENGINE_OIL.pressure.redLines, read: r => r.engines[0].oilPressurePsi } },
    { kind: 'dual', id: 'xmsnOil', at: [548, 660], seed: 2004, title: ['XMSN OIL', '°C  PSI'],
      left: { label: 'T', min: 0, max: 150, majors: [0, 50, 100, 150], minorStep: 10, numbers: true, arcs: AH56_XMSN_OIL.temp.arcs, redLines: AH56_XMSN_OIL.temp.redLines, read: r => extra(r, 'xmsnOilTempC') },
      right: { label: 'P', min: 0, max: 150, majors: [0, 50, 100, 150], minorStep: 10, numbers: true, arcs: AH56_XMSN_OIL.pressure.arcs, redLines: AH56_XMSN_OIL.pressure.redLines, read: r => extra(r, 'xmsnOilPsi') } },
    { kind: 'customRect', id: 'hydraulics', bounds: { x: 24, y: 740, w: 150, h: 190 }, create: (id, b) => new Ah56HydraulicsGauge(id, b, r => [extra(r, 'hydPsi'), extra(r, 'hydPsi'), extra(r, 'hydPsi')]) },
    // The control system in use and the ICS buttons.
    { kind: 'customRect', id: 'gyroPlacard', bounds: { x: TAPES.x, y: 736, w: TAPES.w, h: 196 }, create: (id, b) => new Ah56GyroPlacard(id, b) },
    // Gear handle and lights (the tail wheel on the first lamp), the tail-wheel lock lever.
    { kind: 'gearLights', id: 'gear', bounds: { x: 896, y: 84, w: 150, h: 176 }, lever: [1096, 170], noseLegend: 'TAIL' },
    tailWheel,
  ],
  annunciator: { bounds: { x: TAPES.x, y: 80, w: TAPES.w, h: 262 }, lamps: AH56_ANNUNCIATOR_LAMPS, cells: CELLS, lensLegend: true, clipGlow: true },
  switchRow: { bounds: SWITCHES, rockerTop: 54, rockerW: 28, rockerH: 38,
    switches: [
      // Miniature toggles (APE-I 134a): battery, generator, boost pump, lights (order ESTIMATE).
      switchDef('battery', 'BAT', 0, c => c.masterBattery, c => { c.masterBattery = !c.masterBattery; }, true),
      switchDef('generator', 'GEN', 1, c => c.alternator, c => { c.alternator = !c.alternator; }),
      switchDef('boostPump', 'BOOST PUMP', 2, c => c.fuelPump, c => { c.fuelPump = !c.fuelPump; }),
      switchDef('beacon', 'ANTI-COLL', 3, c => c.lights.beacon, c => { c.lights.beacon = !c.lights.beacon; }),
      switchDef('nav', 'POS LT', 4, c => c.lights.nav, c => { c.lights.nav = !c.lights.nav; }),
      switchDef('landing', 'LDG LT', 5, c => c.lights.landing, c => { c.lights.landing = !c.lights.landing; }),
      switchDef('panelLights', 'PNL LT', 6, c => c.lights.panel > 0, c => { c.lights.panel = c.lights.panel > 0 ? 0 : 1; }),
    ],
    legends: [{ text: 'MISCELLANEOUS TOGGLES', x: 288, y: 18, size: 9 }] },
  ignition: IGNITION,
  background: { color: '#25282a', outline: AH56_PANEL_OUTLINE, seamsX: [], bushings: [],
    plates: [
      { bounds: { x: 4, y: 36, w: 600, h: 410 }, color: '#1c1f21' },
      { bounds: { x: 880, y: 74, w: 600, h: 200 }, color: '#1c1f21' },
      { bounds: { x: 880, y: 780, w: 600, h: 170 }, color: '#1c1f21' },
    ],
    placards: [
      { x: 744, y: 12, size: 8, lines: ['AH-56A  PILOT (REAR) PANEL'] },
      { x: 1180, y: 400, size: 9, lines: ['RECONSTRUCTED FROM REPORT TEXT', 'NO PHOTOGRAPH OF THE REAR PANEL IS KNOWN', 'LAYOUT UNVERIFIED'] },
      { x: 1180, y: 520, size: 7.5, lines: ['PROP BLADE ANGLE: HOVER DETENT -2.2', 'AUTOROTATION +8   FULL REVERSE -12'] },
      { x: 1180, y: 600, size: 7.5, lines: ['START: APU, START, CONDITION GRIP TO IDLE AT 20 % Ng', 'LANDING ROLL: REVERSE PROP AND MAIN GEAR BRAKES ONLY'] },
    ] },
  keepOut: [],
  regions: { sixpack: { x: 4, y: 76, w: 600, h: 370 }, engine: { x: 604, y: 76, w: 280, h: 880 }, stack: { x: 880, y: 74, w: 600, h: 880 } },
  spots: { asi: { x: T.cols[0], y: T.rows[0], r: 90 }, attitude: { x: T.cols[1], y: T.rows[0], r: 90 }, alt: { x: T.cols[2], y: T.rows[0], r: 90 },
    heading: { x: T.cols[1], y: T.rows[1], r: 90 }, vsi: { x: T.cols[2], y: T.rows[1], r: 90 },
    torque: { x: TAPES.x + 29, y: TAPES.y + 200, r: 60 }, tit: { x: TAPES.x + 91, y: TAPES.y + 200, r: 60 }, tach: { x: TAPES.x + 215, y: TAPES.y + 200, r: 60 },
    collective: { x: 89, y: 541, r: 80 }, prop: { x: 227, y: 541, r: 80 } },
};

// ---------------------------------------------------------------------------------------------------- systems
/**
 * Collective blade angle as the cockpit indicator reads it, degrees. With the control gyro in the definition (AG): the blade collective
 * (ICS-referenced) plus the configuration's indicator offset (AMCS +7 deg, ICS 0, D from "13 deg AMCS = 6 deg ICS"). Until then: the
 * published AMCS indicated range 4.5-21.5 deg mapped on the lever, less 7 deg for the ICS (P AMCS-73 SoF 2b; D).
 */
export function ah56CollectiveIndicatedDeg(s: AircraftState, c: ControlInputs): number {
  const gyro = AH56_ROTORCRAFT.controlGyro;
  const mode = s.rotorcraft?.controlGyro?.mode ?? gyro?.default ?? 'amcs';
  const lever = clamp(c.collective ?? 0, 0, 1);
  if (gyro) {
    const m = AH56_ROTORCRAFT.main;
    return (m.minPitch + lever * (m.maxPitch - m.minPitch)) / DEG + gyro.configs[mode].collectiveIndicatedOffset / DEG;
  }
  const [lo, hi] = AH56_COLLECTIVE_DEG.amcsIndicated;
  return lo + lever * (hi - lo) - (mode === 'ics' ? AH56_COLLECTIVE_DEG.amcsOffset : 0);
}

export const AH56_INSTRUMENT_SYSTEMS: InstrumentSystemsDef = {
  engines: 1, vacuum: null, gyroDrive: { attitude: 'electric', heading: 'electric' },
  // Fuel in the sponsons: one total, kg indicated as US gal at Jet A-1 (the tape reads lb through extra.fuelLb).
  fuel: { kgPerGal: AH56_KG_PER_GAL, tanks: [s => s.fuel.left + s.fuel.right] },
  busDeadVolts: AH56_POWERPLANT.electrical.busDeadVolts, tachHourRpm: AH56_NF_100_RPM,
  // Nf / Nr: Nf is the power turbine (13,600 rpm = 100 %, S), Nr the rotor (246 rpm = 100 %, P; the AMCS aircraft flies 97.5 %). Self-powered.
  rotorTach: { engineRpm100: AH56_NF_100_RPM, rotorRpm100: AH56_NR_100, powered: () => true },
  extra: {
    torquePct: s => ah56TorquePct(s.engine.torque),
    collectiveDeg: (s, c) => ah56CollectiveIndicatedDeg(s, c),
    // The propeller blade angle: absent (NaN) until the pusher exists (stage 3-4); the prop is drawn stopped before that.
    propBetaDeg: s => s.rotorcraft?.pusher ? s.rotorcraft.pusher.beta / DEG : NaN,
    gyroMode: s => (s.rotorcraft?.controlGyro?.mode ?? AH56_ROTORCRAFT.controlGyro?.default) === 'ics' ? 1 : 0,
    gLoad: s => s.gLoad,
    fuelLb: s => fuelLb(s),
    xmsnOilTempC: s => s.rotorcraft?.transmission?.oilTemperatureC ?? 0,
    xmsnOilPsi: s => s.rotorcraft?.transmission?.oilPressurePsi ?? 0,
    // No hydraulic model: all three systems indicate 3000 psi (inside 2800-3400) while the rotor turns, ESTIMATE; zero with it stopped.
    hydPsi: s => nrPct(s) >= 20 ? 3000 : 0,
  },
  lamps: AH56_LAMP_IDS.map(id => ({ id, lit: (i: LampInputs) => powered(i) && (!!i.controls.annunciatorTest ||
    (id === 'master' ? CAUTION_IDS.some(k => RULES[k](i)) : i.controls.lampTestId === id || (RULES[id]?.(i) ?? false))) })),
};
