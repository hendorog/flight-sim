// MBB Bo 105 CB-4 instrument panel and instrument systems: the FM Fig 7-3 "typical" pedestal (P5 = Flight Manual BO 105
// CB-5/CBS-5 used for the CB-4), warning lights FM 3-2..3-19 / TM 00-44, markings FM 2-18..2-21 (panelMarkings.ts). It
// fills the face of the frozen panelLayout.ts (BO105_COLS / BO105_ROWS; the face is not moved). See docs/bo105-panel.md for
// what is a compromise. Rows, top to bottom (three columns):
//   1 F fire lights outboard, the attitude indicator and DG (AGENT additions, TM 00-26) beside the caution block
//   2 ASI | (caution segment block) | altimeter
//   3 power levers | clock | VSI +/-6000
//   4 mast-moment indicator | dual torque % | triple tach (N2 1, N2 2, NR)
//   5 triple oil temperature | TOT 1 | TOT 2
//   6 starters + ignition, MM test | N1 1 | N1 2
//   7 triple oil pressure | fuel quantity S/M | fuel pressure 1/2
// and the centre-console / overhead switches on one strip under row 7 (the real ones are on the console and the roof; the
// panel texture is one canvas, as the MD 500E's lower console is).
import { DEG } from '../../core/math';
import { engineControl, setEngineControl, type ControlInputs } from '../../core/types';
import type { ArcDef, InstrumentSystemsDef, LampDef, LampInputs, PanelDef, Rect, SwitchDef } from '../types';
import type { InstrumentReadings } from '../../instruments/dynamics/instrumentSet';
import { BO105_BUS_DEAD_VOLTS, BO105_FUEL, BO105_N2_100_RPM, BO105_NR_100, BO105_POWER_LEVER } from './facts';
import { BO105_COLS as COL, BO105_PANEL_CANVAS, BO105_PANEL_OUTLINE, BO105_ROWS as ROW } from './panelLayout';
import { Bo105MastMomentGauge, Bo105TripleGauge, Bo105VerticalSpeedGauge, type TripleDialSpec } from './panelGauges';
import { ignitionLayout } from '../../instruments/panelParts';
import { BO105_ASI_MARKS, BO105_DIAL_SWEEP as SWEEP, BO105_FUEL_PRESSURE, BO105_FUEL_SCALES, BO105_N1_SCALE, bo105MastMomentLimit, bo105MastMomentPct,
  BO105_OIL_PRESSURE, BO105_OIL_TEMP, BO105_TACH, BO105_TORQUE_SCALE, BO105_TOT_SCALE, bo105N2Pct, bo105TorquePct, KPCM2_PER_PSI } from './panelMarkings';

/** 3-1/8" instruments on the 3-column grid: the rect of a scaled large gauge must stay under the 200 px row pitch. */
const K = 1.06;
const SCALE = { large: K, small: 1 };
/** Jet A-1, 0.8 kg/l (research-bo105 section 11): kg per US gallon. */
export const BO105_KG_PER_GAL = 0.8 * 3.785411784;
const RED = '#ff4538';
const C = (f: number): number => (f - 32) * 5 / 9;

// ---------------------------------------------------------------------------------------------------- lamps
type LampRow = readonly [id: string, text: string, color: string];
/** The caution / warning segment block, row by row, two lenses a row (FM Fig 7-3; research-bo105 section 12). All red (FM 3-2). */
const BLOCK_ROWS: readonly (readonly [LampRow, LampRow])[] = [
  [['lowFuel', 'LOW FUEL', RED], ['hyBlock', 'HY BLOCK', RED]],
  [['rpm', 'RPM', RED], ['tOil', 'T OIL', RED]],
  [['gen1', 'GEN 1', RED], ['gen2', 'GEN 2', RED]],
  [['filt1', 'FILT 1', RED], ['filt2', 'FILT 2', RED]],
  [['hyd1', 'HYD 1', RED], ['hyd2', 'HYD 2', RED]],
  [['magPlug1', 'MAG PLUG 1', RED], ['magPlug2', 'MAG PLUG 2', RED]],
  [['bat60', 'BAT 60', RED], ['bat70', 'BAT 70', RED]],
  [['oilCool', 'OIL COOL', RED], ['pressTest', 'LAMP TEST', '#e9e6d6']],
];
const FIRE: readonly LampRow[] = [['fire1', 'F TEST', RED], ['fire2', 'F TEST', RED]];
/** Lenses in annunciator order: the fire light of engine 1, the block (row-major), the fire light of engine 2. */
const LAMP_ROWS: readonly LampRow[] = [FIRE[0], ...BLOCK_ROWS.flat(), FIRE[1]];

const BLOCK = { x: 272, y: 42, w: 128, h: 40, gapX: 8, gapY: 2 } as const;
const blockCell = (row: number, col: number): Rect => ({ x: BLOCK.x + col * (BLOCK.w + BLOCK.gapX), y: BLOCK.y + row * (BLOCK.h + BLOCK.gapY), w: BLOCK.w, h: BLOCK.h });
const FIRE_CELLS: readonly Rect[] = [{ x: 10, y: 62, w: 76, h: 58 }, { x: 730, y: 62, w: 76, h: 58 }];
const CELLS: readonly Rect[] = [FIRE_CELLS[0], ...BLOCK_ROWS.flatMap((_, row) => [blockCell(row, 0), blockCell(row, 1)]), FIRE_CELLS[1]];

/** Press-to-test: the FM 4-9 lamp test lights every segment except the F lights, MM LIMIT and LOW FUEL (they have their own tests). */
const OWN_TEST = new Set(['fire1', 'fire2', 'lowFuel', 'mmTest']);
export const BO105_ANNUNCIATOR_LAMPS: readonly LampDef[] = LAMP_ROWS.map(([id, text, color]) => ({ id, text, color,
  lit: r => r.lamps[id] ?? false,
  press: id === 'pressTest' ? (down: boolean, c: ControlInputs) => { c.annunciatorTest = down; }
    : (down: boolean, c: ControlInputs) => { c.lampTestId = down ? id : undefined; } }));

const powered = (i: LampInputs): boolean => i.state.electrical.busVoltage > BO105_BUS_DEAD_VOLTS;
const flashing = (i: LampInputs): boolean => Math.floor(i.state.time * 2) % 2 === 0;
const twin = (i: LampInputs) => i.state.rotorcraft?.twinTurboshaft;
/** The generator of engine e is on line: its switch ON and the engine running (the reverse-current relay closes, FM 7-31). ESTIMATE threshold. */
const genOut = (i: LampInputs, e: number): boolean => !engineControl(i.controls, e, 'alternator') || !(i.state.engines[e]?.running ?? false);
/** Lamp rules. Conditions with no flight-model state (HY BLOCK, FILT, HYD, MAG PLUG, BAT) light on the lamp test only. */
const RULES: Record<string, (i: LampInputs) => boolean> = {
  // Supply tank below 60 kg (P5 FM 3-13); fuel.left is the supply tank (contract request to BO).
  lowFuel: i => i.state.fuel.left < BO105_FUEL.lowFuelKg,
  // N1 split >= 12 %, NR <= 95 %, NR >= 103 % (P5 FM 3-16, TM 00-44); flashes (the warning unit pulses the lamp). TW evaluates the flags.
  rpm: i => flashing(i) && (twin(i)?.n1SplitLight === true || twin(i)?.nrLowLight === true || twin(i)?.nrHighLight === true),
  // Transmission oil above 105 C or below 0.5 kp/cm2 (P5 FM 3-18 / TM 00-44).
  tOil: i => { const t = i.state.rotorcraft?.transmission; return t === undefined || t.oilPressurePsi < 0.5 / KPCM2_PER_PSI || t.oilTemperatureC > 105; },
  gen1: i => genOut(i, 0), gen2: i => genOut(i, 1),
  // The oil-cooler fan stops with the rotor: lit below 20 % NR (P5 FM 3-9 shutdown).
  oilCool: i => (i.state.rotorcraft?.rotorRpm ?? 0) < 0.2 * BO105_NR_100,
};
export const BO105_LAMP_IDS: readonly string[] = [...LAMP_ROWS.map(l => l[0]), 'mmTest'];

// ---------------------------------------------------------------------------------------------------- gauges
const DIAL = { a0: SWEEP.a0, a1: SWEEP.a1 };
const engineScale = (s: typeof BO105_TOT_SCALE, engine: number) => ({ ...s, read: (r: InstrumentReadings) => (s === BO105_TOT_SCALE ? r.engines[engine].ittC / 100 : r.engines[engine].ngPct) });
const bandArcs = (a: readonly ArcDef[] | undefined): readonly ArcDef[] => a ?? [];
const SPAN = { a0: -140 * DEG, a1: 140 * DEG };

const TACH_SPEC: TripleDialSpec = {
  seed: 1053, electric: false, legend: ['N2 / NR', '%'],
  outer: { min: 0, max: BO105_TACH.max, ...SPAN, majors: BO105_TACH.majors, minorStep: 5, labels: 'majors', radius: 1, width: 6,
    arcs: [{ from: BO105_TACH.n2.green[0], to: BO105_TACH.n2.green[1], color: 'green' }], redLines: BO105_TACH.n2.redLines, redDots: BO105_TACH.n2.redDots },
  inner: { min: 0, max: BO105_TACH.max, ...SPAN, majors: BO105_TACH.majors, minorStep: 10, radius: 0.62, width: 4,
    arcs: [{ from: BO105_TACH.nr.green[0], to: BO105_TACH.nr.green[1], color: 'green' }], redLines: BO105_TACH.nr.redLines },
  read: r => [bo105N2Pct(r.engines[0].rpm), bo105N2Pct(r.engines[1].rpm), r.rotorRpmPct],
};
const OIL_TEMP_SPEC: TripleDialSpec = {
  seed: 1054, electric: true, legend: ['OIL TEMP', '°C'],
  outer: { min: BO105_OIL_TEMP.min, max: BO105_OIL_TEMP.max, majors: BO105_OIL_TEMP.majors, ...SPAN, minorStep: 10, labels: 'majors', radius: 1, width: 6,
    arcs: bandArcs(BO105_OIL_TEMP.engine.arcs), redLines: BO105_OIL_TEMP.engine.redLines },
  inner: { min: BO105_OIL_TEMP.min, max: BO105_OIL_TEMP.max, majors: BO105_OIL_TEMP.majors, ...SPAN, minorStep: 10, radius: 0.62, width: 4,
    arcs: bandArcs(BO105_OIL_TEMP.transmission.arcs), redLines: BO105_OIL_TEMP.transmission.redLines },
  read: r => [C(r.engines[0].oilTempF), C(r.engines[1].oilTempF), r.extra?.xmsnOilTempC ?? BO105_OIL_TEMP.min],
};
const OIL_PRESSURE_SPEC: TripleDialSpec = {
  seed: 1055, electric: true, legend: ['OIL PRESS', 'kp/cm²'],
  outer: { min: 0, max: BO105_OIL_PRESSURE.max, ...SPAN, majors: BO105_OIL_PRESSURE.majors, minorStep: 0.5, labels: 'majors', radius: 1, width: 6,
    arcs: bandArcs(BO105_OIL_PRESSURE.engine.arcs), redLines: BO105_OIL_PRESSURE.engine.redLines },
  inner: { min: 0, max: BO105_OIL_PRESSURE.transmission.max, ...SPAN, majors: BO105_OIL_PRESSURE.transmission.majors, minorStep: 0.25, radius: 0.62, width: 4,
    arcs: bandArcs(BO105_OIL_PRESSURE.transmission.arcs), redLines: BO105_OIL_PRESSURE.transmission.redLines },
  read: r => [r.engines[0].oilPressurePsi * KPCM2_PER_PSI, r.engines[1].oilPressurePsi * KPCM2_PER_PSI, r.extra?.xmsnOilKp ?? 0],
};

const totGauge = (id: string, at: [number, number], seed: number, engine: number) =>
  ({ kind: 'single' as const, id, at, seed, title: `TOT ${engine + 1}`, units: '°C ×100', size: 'large' as const, ...DIAL, labels: BO105_TOT_SCALE.majors,
    scale: engineScale(BO105_TOT_SCALE, engine) });
const N1_DIAL = { ...DIAL, labels: BO105_N1_SCALE.majors, title: 'N1', units: '%' };
const FUEL_PRESSURE = { ...DIAL, labels: BO105_FUEL_PRESSURE.majors, title: 'FUEL PRESS', units: 'kp/cm²' };

const kg = (gal: number): number => gal * BO105_KG_PER_GAL;

// ---------------------------------------------------------------------------------------------------- switches
const switchDef = (id: string, label: string, i: number, on: SwitchDef['on'], toggle: SwitchDef['toggle'], opts: { red?: boolean; cover?: boolean } = {}): SwitchDef =>
  ({ id, label, name: label, x: 48 + i * 58, on, toggle, red: opts.red, cover: opts.cover });
const perEngine = (e: number, key: 'alternator' | 'fuelPump') => ({
  on: (c: ControlInputs) => !!engineControl(c, e, key),
  toggle: (c: ControlInputs) => setEngineControl(c, e, key, !engineControl(c, e, key)),
});
/** Emergency fuel valve of engine e: ON = open (the guarded switch closes it, P5 FM Fig 7-4). */
const fuelValve = (e: number) => ({
  on: (c: ControlInputs) => engineControl(c, e, 'fuelSelector') !== 'off',
  toggle: (c: ControlInputs) => setEngineControl(c, e, 'fuelSelector', engineControl(c, e, 'fuelSelector') === 'off' ? 'both' : 'off'),
});
const CB_NAMES = ['N2 CONT', 'GEN 1', 'GEN 2', 'INSTR', 'START 1', 'START 2', 'FUEL P1', 'FUEL P2', 'WARN', 'LDG LT', 'ANTI C', 'POS LT'];
void CB_NAMES;

/** Power lever position: 0 = FLIGHT (top), 1 = IDLE, 2 = OFF (bottom). OFF below the cut-off stop, IDLE below the mid-point to FLIGHT. */
const LEVER_STOPS = [1, BO105_POWER_LEVER.groundIdle, 0] as const;
const leverPosition = (c: ControlInputs, e: number): number => {
  const t = engineControl(c, e, 'throttle');
  return t < BO105_POWER_LEVER.cutoffBelow ? 2 : t < (BO105_POWER_LEVER.groundIdle + 1) / 2 ? 1 : 0;
};
const powerLever = (e: number): PanelDef['gauges'][number] => ({ kind: 'positionSwitch', id: `pwr${e + 1}`, bounds: { x: 14 + e * 122, y: 408, w: 112, h: 184 },
  label: `PWR ${e + 1}`, positions: ['FLIGHT', 'IDLE', 'OFF'], read: c => leverPosition(c, e),
  set: (c, position) => setEngineControl(c, e, 'throttle', LEVER_STOPS[position]) });

const SWITCH_ROW_BOUNDS: Rect = { x: 8, y: 1402, w: 800, h: 84 };
const IGNITION: PanelDef['ignition'] = { kind: 'toggles', at: [COL[0], 1058], engines: 2, switches: 'ignition', sides: ['1', '2'] };

export const BO105_PANEL: PanelDef = {
  id: 'bo105',
  // Fixed 2D view. Upper: the flight instruments with the engine-power ones (tach, torque, mast moment, TOT), the lenses
  // beside them. Lower: the rest of the engine monitoring and every control (levers, starters, switches).
  fixed: { flightRows: [['asi', 'attitude', 'altimeter', 'vsi', 'tach', 'mm'], ['heading', 'clock', 'torque', 'tot1', 'tot2']],
    controls: [SWITCH_ROW_BOUNDS, ignitionLayout(IGNITION)!.rect], lampsBeside: true, lower: ['n1a', 'n1b', 'fuel', 'fuelPressure'] },
  size: BO105_PANEL_CANVAS, instrumentScale: SCALE, instrumentBezel: 'square', lightingDimmerExponent: 2.2,
  apertures: { large: 74 * SCALE.large, small: 51 * SCALE.small },
  gauges: [
    { kind: 'asi', id: 'asi', at: [COL[0], ROW[1]], marks: BO105_ASI_MARKS },
    { kind: 'altimeter', id: 'altimeter', at: [COL[2], ROW[1]] },
    // The AGENT attitude indicator and DG: smaller cases beside the caution block (TM 00-26).
    { kind: 'attitude', id: 'attitude', at: [170, 118], scale: 0.78 },
    { kind: 'heading', id: 'heading', at: [646, 118], scale: 0.78 },
    { kind: 'clock', id: 'clock', at: [COL[1], ROW[2]] },
    { kind: 'customRound', id: 'vsi', at: [COL[2], ROW[2]], size: 'large', create: (id, x, y, aperture) => new Bo105VerticalSpeedGauge(id, x, y, aperture) },
    { kind: 'customRound', id: 'mm', at: [COL[0], ROW[3]], size: 'large', create: (id, x, y, aperture) => new Bo105MastMomentGauge(id, x, y, aperture) },
    { kind: 'twinNeedle', id: 'torque', at: [COL[1], ROW[3]], seed: 1056, size: 'large', ...DIAL, title: 'TORQUE', units: '%', letters: ['1', '2'],
      labels: BO105_TORQUE_SCALE.majors, scale: { label: '', min: 0, max: BO105_TORQUE_SCALE.max, majors: BO105_TORQUE_SCALE.majors, minorStep: 5, numbers: true,
        arcs: BO105_TORQUE_SCALE.arcs, redLines: BO105_TORQUE_SCALE.redLines },
      left: r => bo105TorquePct(r.engines[0].torqueNm), right: r => bo105TorquePct(r.engines[1].torqueNm) },
    { kind: 'customRound', id: 'tach', at: [COL[2], ROW[3]], size: 'large', create: (id, x, y, aperture) => new Bo105TripleGauge(id, x, y, aperture, TACH_SPEC) },
    { kind: 'customRound', id: 'oilTemp', at: [COL[0], ROW[4]], size: 'large', create: (id, x, y, aperture) => new Bo105TripleGauge(id, x, y, aperture, OIL_TEMP_SPEC) },
    totGauge('tot1', [COL[1], ROW[4]], 1057, 0),
    totGauge('tot2', [COL[2], ROW[4]], 1058, 1),
    // The overhead power levers (OFF - IDLE - FLIGHT), drawn on the pedestal canvas as the console twins the fixed 2-D view needs.
    powerLever(0), powerLever(1),
    { kind: 'pushButton', id: 'mmTest', bounds: { x: 44, y: 1124, w: 184, h: 70 }, label: 'MM TEST', read: c => c.lampTestId === 'mmTest',
      press: (down, c) => { c.lampTestId = down ? 'mmTest' : undefined; } },
    { kind: 'single', id: 'n1a', at: [COL[1], ROW[5]], seed: 1059, size: 'large', ...N1_DIAL, scale: engineScale(BO105_N1_SCALE, 0) },
    { kind: 'single', id: 'n1b', at: [COL[2], ROW[5]], seed: 1060, size: 'large', ...N1_DIAL, scale: engineScale(BO105_N1_SCALE, 1) },
    { kind: 'customRound', id: 'oilPressure', at: [COL[0], ROW[6]], size: 'large', create: (id, x, y, aperture) => new Bo105TripleGauge(id, x, y, aperture, OIL_PRESSURE_SPEC) },
    { kind: 'dual', id: 'fuel', at: [COL[1], ROW[6]], seed: 1061, title: ['S', 'M'],
      left: { label: 'S', min: 0, max: 100, majors: [0, 50, 100], minorStep: 10, numbers: true, arcs: BO105_FUEL_SCALES.supply.arcs, read: r => kg(r.fuelGal[0]) },
      right: { label: 'M', min: 0, max: 400, majors: [0, 100, 200, 300, 400], minorStep: 50, numbers: true, read: r => kg(r.fuelGal[1] ?? 0) } },
    { kind: 'twinNeedle', id: 'fuelPressure', at: [COL[2], ROW[6]], seed: 1062, size: 'small', ...FUEL_PRESSURE, letters: ['1', '2'],
      scale: { label: '', min: 0, max: BO105_FUEL_PRESSURE.max, majors: BO105_FUEL_PRESSURE.majors, minorStep: 0.1, numbers: true, arcs: BO105_FUEL_PRESSURE.arcs, redLines: BO105_FUEL_PRESSURE.redLines },
      left: r => r.engines[0].fuelPressurePsi * KPCM2_PER_PSI, right: r => r.engines[1].fuelPressurePsi * KPCM2_PER_PSI },
  ],
  annunciator: { bounds: { x: 10, y: 42, w: 796, h: 336 }, lamps: BO105_ANNUNCIATOR_LAMPS, cells: CELLS, lensLegend: true, clipGlow: true },
  switchRow: { bounds: SWITCH_ROW_BOUNDS, rockerTop: 36, rockerW: 28, rockerH: 38,
    switches: [
      // FM Fig 7-4 / 7-5 (order ESTIMATE): battery, the two generators, the supply-tank pumps, the guarded emergency fuel valves, lights.
      switchDef('battery', 'BAT', 0, c => c.masterBattery, c => { c.masterBattery = !c.masterBattery; }, { red: true }),
      switchDef('gen1', 'GEN 1', 1, perEngine(0, 'alternator').on, perEngine(0, 'alternator').toggle),
      switchDef('gen2', 'GEN 2', 2, perEngine(1, 'alternator').on, perEngine(1, 'alternator').toggle),
      switchDef('pump1', 'PUMP 1', 3, perEngine(0, 'fuelPump').on, perEngine(0, 'fuelPump').toggle),
      switchDef('pump2', 'PUMP 2', 4, perEngine(1, 'fuelPump').on, perEngine(1, 'fuelPump').toggle),
      switchDef('valve1', 'VALVE 1', 5, fuelValve(0).on, fuelValve(0).toggle, { cover: true }),
      switchDef('valve2', 'VALVE 2', 6, fuelValve(1).on, fuelValve(1).toggle, { cover: true }),
      switchDef('beacon', 'ANTI-COLL', 7, c => c.lights.beacon, c => { c.lights.beacon = !c.lights.beacon; }),
      switchDef('nav', 'POS LT', 8, c => c.lights.nav, c => { c.lights.nav = !c.lights.nav; }),
      switchDef('landing', 'LDG LT', 9, c => c.lights.landing, c => { c.lights.landing = !c.lights.landing; }),
    ],
    legends: [{ text: 'INSTR', x: 632, y: 20, size: 8 }, { text: 'CONSOLE', x: 714, y: 20, size: 8 }],
    // Both knobs set the one panel-light level (the real rheostat dims the instrument post lights).
    dimmers: { panel: 632, radio: 714, y: 56 } },
  ignition: IGNITION,
  background: { color: '#2a2d2e', outline: BO105_PANEL_OUTLINE, seamsX: [], bushings: [],
    plates: [
      { bounds: { x: 4, y: 36, w: 808, h: 352 }, color: '#212426' },
      { bounds: { x: 4, y: 1396, w: 808, h: 90 }, color: '#212426' },
    ],
    placards: [
      { x: COL[1], y: 392, size: 8, lines: ['BO 105 CB-4'] },
    ] },
  keepOut: [],
  regions: { sixpack: { x: 4, y: 200, w: 808, h: 400 }, engine: { x: 4, y: 604, w: 808, h: 600 }, stack: { x: 4, y: 1200, w: 808, h: 200 } },
  spots: { asi: { x: COL[0], y: ROW[1], r: 98 }, alt: { x: COL[2], y: ROW[1], r: 98 }, vsi: { x: COL[2], y: ROW[2], r: 98 },
    attitude: { x: 170, y: 118, r: 76 }, heading: { x: 646, y: 118, r: 76 }, tach: { x: COL[2], y: ROW[3], r: 98 }, torque: { x: COL[1], y: ROW[3], r: 98 },
    mm: { x: COL[0], y: ROW[3], r: 98 }, tot: { x: COL[1], y: ROW[4], r: 98 }, oil: { x: COL[0], y: ROW[4], r: 98 }, fuel: { x: COL[1], y: ROW[6], r: 66 } },
};

// ---------------------------------------------------------------------------------------------------- systems
export const BO105_INSTRUMENT_SYSTEMS: InstrumentSystemsDef = {
  engines: 2, vacuum: null, gyroDrive: { attitude: 'electric', heading: 'electric' },
  // Supply tank (S) and main tank (M): fuel.left and fuel.right, kg indicated as US gal at Jet A-1 (contract request to BO).
  fuel: { kgPerGal: BO105_KG_PER_GAL, tanks: [s => s.fuel.left, s => s.fuel.right] },
  busDeadVolts: BO105_BUS_DEAD_VOLTS, tachHourRpm: BO105_N2_100_RPM,
  // Triple tach: N2 1 / N2 2 come from each engine's output shaft, NR from the rotor; tach generators are self-powered (ESTIMATE; the FM is silent).
  rotorTach: { engineRpm100: BO105_N2_100_RPM, rotorRpm100: BO105_NR_100, powered: () => true },
  extra: {
    mastMomentPct: s => bo105MastMomentPct(s) ?? 0,
    mastMomentYellowPct: () => 100 * bo105MastMomentLimit().yellow,
    xmsnOilTempC: s => s.rotorcraft?.transmission?.oilTemperatureC ?? BO105_OIL_TEMP.min,
    xmsnOilKp: s => (s.rotorcraft?.transmission?.oilPressurePsi ?? 0) * KPCM2_PER_PSI,
  },
  lamps: BO105_LAMP_IDS.map(id => ({ id, lit: (i: LampInputs) => powered(i) &&
    ((!!i.controls.annunciatorTest && !OWN_TEST.has(id)) || i.controls.lampTestId === id || (RULES[id]?.(i) ?? false)) })),
};
