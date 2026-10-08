// R22 Beta II, later six-hole VFR console: POH 7-21 and IPC figure 95-1. Flight instruments in the
// upper pod; CAT/clock and the six moving-coil engine instruments below; switches then radios down the
// centre pedestal. Guarded mixture and heat knobs at its foot. Dimensions/outline: dimensions.ts.
import type { AsiMarkings, GaugeDef, InstrumentSystemsDef, LampDef, LampInputs, PanelDef, RotorTachMarkings, ScaleDef, SwitchDef } from '../types';
import { DEG } from '../../core/math';
import { engineControl } from '../../core/types';
import { PANEL_CANVAS, PANEL_OUTLINE, PANEL_PX_PER_M } from './dimensions';
import { R22_INSTRUMENT_REFERENCE as V, R22_MAP_PLACARD } from './reference';

// Whole case diameters at the shared px/m; renderer scales glass, needles and bezel knobs together.
const SCALE = { large: 3.125 * 0.0254 * PANEL_PX_PER_M / 172, small: 2.25 * 0.0254 * PANEL_PX_PER_M / 120 };
const APERTURES = { large: 74 * SCALE.large, small: 51 * SCALE.small };
const COL = [192, 408, 624] as const;
const ROW = [188, 400] as const;

/** POH 2-8: no white/flap arc and no fixed-wing stall-speed marking. */
export const R22_ASI_MARKS: AsiMarkings = {
  scaleKt: [0, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110],
  scaleDeg: [0, 20, 50, 80, 110, 145, 180, 215, 250, 285, 320],
  tickFrom: 20, tickTo: 110, minorStep: 5, numberStep: 10,
  arcs: [{ from: V.asiGreenMin, to: V.vne, color: 'green' }], redLine: V.vne,
};
/** POH 2-8, O-360 installation: 101–104% green, not the O-320's older 97–104% dial. */
export const R22_TACH_MARKS: RotorTachMarkings = {
  min: 40, max: 110, majorStep: 10, minorStep: 2,
  engineArcs: [{ from: 60, to: 70, color: 'yellow' }, { from: 90, to: 101, color: 'red' },
    { from: 101, to: 104, color: 'green' }, { from: 104, to: 110, color: 'red' }],
  rotorArcs: [{ from: 60, to: 70, color: 'yellow' }, { from: 90, to: 101, color: 'yellow' },
    { from: 101, to: 104, color: 'green' }, { from: 104, to: 110, color: 'yellow' }],
  rotorRedLines: [90, 110],
};
const scale = (label: string, min: number, max: number, majors: number[], minorStep: number, read: ScaleDef['read'], more: Partial<ScaleDef> = {}): ScaleDef =>
  ({ label, min, max, majors, minorStep, read, numbers: true, ...more });
export const R22_MAP_SCALE = scale('', 10, 35, [10, 15, 20, 25, 30, 35], 1, r => r.engines[0].manifoldInHg,
  { arcs: [{ from: V.mapYellowMin, to: V.mapMax, color: 'yellow' }], redLines: [V.mapMax] });
export const R22_CAT_SCALE = scale('', -40, 50, [-40, -20, 0, 20, 40], 5, r => r.carbAirTempC,
  { signedNumbers: true, arcs: [{ from: -15, to: 5, color: 'yellow' }] });
const single = (id: string, at: readonly [number, number], title: string, units: string, size: 'small' | 'large', s: ScaleDef): GaugeDef =>
  ({ kind: 'single', id, at, seed: 322 + at[0], title, units, size, a0: -125 * DEG, a1: 125 * DEG, labels: s.majors, scale: s });

const RED = '#ff4538', AMBER = '#ffba35';
// Eleven lenses across the brow; FULL THROTTLE and BRAKE at the right edge (POH 7-21).
export const R22_ANNUNCIATOR_LAMPS: readonly LampDef[] = [
  ['clutch', 'CLUTCH', AMBER], ['mrTemp', 'MR TEMP', RED], ['mrChip', 'MR CHIP', AMBER],
  ['co', 'CARBON MONOXIDE', AMBER], ['starter', 'STARTER ON', AMBER], ['trChip', 'TR CHIP', AMBER],
  ['lowFuel', 'LOW FUEL', AMBER], ['lowRpm', 'LOW RPM', AMBER], ['alt', 'ALT', AMBER],
  ['oil', 'OIL', RED], ['govOff', 'GOV OFF', AMBER], ['fullThrottle', 'FULL THROTTLE', AMBER], ['brake', 'BRAKE', RED],
].map(([id, text, color]) => ({ id, text, color, lit: r => r.lamps[id] ?? false }));
const powered = (i: LampInputs): boolean => i.state.electrical.busVoltage > 10;
const switchDef = (id: string, label: string, x: number, on: SwitchDef['on'], toggle: SwitchDef['toggle'], red = false): SwitchDef =>
  ({ id, label, name: label, x, on, toggle, red });

export const R22_PANEL: PanelDef = {
  id: 'r22', size: PANEL_CANVAS, instrumentScale: SCALE, apertures: APERTURES,
  gauges: [
    { kind: 'vsi', id: 'vsi', at: [COL[0], ROW[0]] },
    { kind: 'asi', id: 'asi', at: [COL[1], ROW[0]], marks: R22_ASI_MARKS },
    { kind: 'rotorTach', id: 'tach', at: [COL[2], ROW[0]], marks: R22_TACH_MARKS },
    { kind: 'blank', id: 'optional', at: [COL[0], ROW[1]] },
    { kind: 'altimeter', id: 'altimeter', at: [COL[1], ROW[1]] },
    single('map', [COL[2], ROW[1]], 'MANIFOLD', 'IN HG', 'large', R22_MAP_SCALE),
    single('cat', [275, 650], 'CARB AIR', '°C', 'small', R22_CAT_SCALE),
    { kind: 'clock', id: 'clock', at: [275, 815] },
    { kind: 'dualSector', id: 'ampsOil', bounds: { x: 372, y: 584, w: 252, h: 88 },
      left: scale('AMPS', -60, 60, [-60, 0, 60], 20, r => r.ammeterAmps),
      right: scale('OIL PSI', 0, 120, [0, 55, 95, 115], 10, r => r.oilPressurePsi,
        { arcs: [{ from: 25, to: 55, color: 'yellow' }, { from: 55, to: 95, color: 'green' },
          { from: 95, to: 115, color: 'yellow' }], redLines: [25, 115] }) },
    { kind: 'dualSector', id: 'auxOil', bounds: { x: 372, y: 688, w: 252, h: 88 },
      left: scale('AUX GAL', 0, V.auxUsableGal, [0, 4, 9.4], 1, r => r.fuelGal[1]),
      right: scale('OIL °F', 50, 250, [75, 150, 245], 25, r => r.oilTempF,
        { arcs: [{ from: 75, to: 245, color: 'green' }], redLines: [245] }) },
    { kind: 'dualSector', id: 'fuelCht', bounds: { x: 372, y: 792, w: 252, h: 88 },
      left: scale('MAIN GAL', 0, V.mainUsableGal, [0, 8, 16.9], 2, r => r.fuelGal[0]),
      right: scale('CHT °F', 0, 550, [0, 200, 500], 50, r => r.engines[0].chtF,
        { arcs: [{ from: 200, to: 500, color: 'green' }], redLines: [500] }) },
    { kind: 'navcom', id: 'navcom1', bounds: { x: 248, y: 1040, w: 320, h: 76 } },
    { kind: 'xpdr', id: 'xpdr', bounds: { x: 248, y: 1126, w: 320, h: 60 } },
    // Simulator hourmeter on the pedestal; the real unit is on the ledge ahead of the right seat (7-18).
    { kind: 'hourmeter', id: 'hours', bounds: { x: 208, y: 1440, w: 148, h: 44 } },
    { kind: 'pushButton', id: 'lampTest', bounds: { x: 526, y: 1430, w: 90, h: 78 }, label: 'LIGHT TEST',
      read: c => c.annunciatorTest ?? false, press: (down, c) => { c.annunciatorTest = down; } },
    { kind: 'pullKnob', id: 'mixture', bounds: { x: 448, y: 1512, w: 100, h: 100 }, label: 'MIXTURE', color: '#c8261b',
      read: c => 1 - engineControl(c, 0, 'mixture'), set: (c, v) => { c.mixture = 1 - v; },
      guard: { closed: c => !(c.mixtureGuardOpen ?? false), toggle: c => { c.mixtureGuardOpen = !c.mixtureGuardOpen; } } },
    { kind: 'pullKnob', id: 'carbHeat', bounds: { x: 254, y: 1512, w: 100, h: 100 }, label: 'CARB HEAT', color: '#ddd7c3',
      read: c => engineControl(c, 0, 'carbHeat'), set: (c, v) => { c.carbHeat = v; } },
    { kind: 'pullKnob', id: 'cabinHeat', bounds: { x: 364, y: 1408, w: 110, h: 100 }, label: 'CABIN HEAT', color: '#ddd7c3',
      read: c => c.cabinHeat ?? 0, set: (c, v) => { c.cabinHeat = v; } },
  ],
  annunciator: { bounds: { x: 80, y: 18, w: 730, h: 480 }, lamps: R22_ANNUNCIATOR_LAMPS,
    cells: [...Array.from({ length: 11 }, (_, i) => ({ x: 90 + i * 57, y: 20, w: 56, h: 60 })),
      { x: 738, y: 282, w: 70, h: 68 }, { x: 738, y: 424, w: 70, h: 58 }] },
  switchRow: {
    bounds: { x: 56, y: 500, w: 746, h: 526 }, rockerTop: 464, rockerW: 24, rockerH: 36,
    switches: [
      switchDef('nav', 'NAV', 174, c => c.lights.nav, c => { c.lights.nav = !c.lights.nav; }),
      switchDef('strobe', 'STROBE', 230, c => c.lights.strobe, c => { c.lights.strobe = !c.lights.strobe; }),
      switchDef('landing', 'LAND', 286, c => c.lights.landing, c => { c.lights.landing = !c.lights.landing; }),
      switchDef('avionics', 'AVIONICS', 352, c => c.avionics, c => { c.avionics = !c.avionics; }),
      switchDef('alternator', 'ALT', 408, c => c.alternator, c => { c.alternator = !c.alternator; }),
      switchDef('battery', 'BAT', 464, c => c.masterBattery, c => { c.masterBattery = !c.masterBattery; }, true),
      { ...switchDef('rotorClutch', 'CLUTCH', 48, c => c.rotorClutch ?? false, c => { c.rotorClutch = !c.rotorClutch; }, true), top: 44 },
    ],
    legends: [{ text: 'PANEL', x: 195, y: 412, size: 8 }, { text: 'RADIO', x: 255, y: 412, size: 8 }],
    dimmers: { panel: 195, radio: 255, y: 433 },
  },
  ignition: { kind: 'key', at: [748, 548] },
  background: {
    color: '#25272a', outline: PANEL_OUTLINE, seamsX: [], bushings: [],
    rack: { rails: { x: 238, y: 1030, w: 340, h: 166 }, blanks: [] },
    placards: [
      { x: 478, y: 918, size: 15, lines: ['R22 Beta II'] },
      { x: 408, y: 1212, size: 9, lines: ['LIMIT MANIFOLD PRESSURE — IN HG', 'MAXIMUM CONTINUOUS POWER'] },
      { x: 408, y: 1248, size: 9, lines: [
        'ALT FT     OAT °C:  -20   -10     0     10     20     30     40',
        ...R22_MAP_PLACARD.values.map((row, i) => `${String(R22_MAP_PLACARD.altitudeFt[i] || 'SL').padStart(4)}        ${row.map(v => v === null ? ' FT ' : v.toFixed(1)).join('   ')}`),
        'FT = FULL THROTTLE   /   5 MIN TAKEOFF: ADD 0.9 IN HG',
      ] },
      { x: 408, y: 1358, size: 9, lines: ['VNE 102 KIAS TO 3000 FT DENSITY ALT',
        'ABOVE 3000 FT: REDUCE PER POH 2-11', 'NR POWER ON 101–104% / OFF 90–110%'] },
      { x: 408, y: 1404, size: 8, lines: ['DAY / NIGHT VFR — SOLO RIGHT SEAT — NO LOW-G PUSHOVERS'] },
      { x: 408, y: 568, size: 8, lines: ['BELOW 18 IN MP — IGNORE CAT — FULL CARB HEAT'] },
    ],
  },
  keepOut: [],
  regions: { sixpack: { x: 84, y: 80, w: 648, h: 424 }, engine: { x: 188, y: 578, w: 440, h: 312 },
    stack: { x: 238, y: 1030, w: 340, h: 166 } },
  spots: { asi: { x: COL[1], y: ROW[0], r: 98 }, tach: { x: COL[2], y: ROW[0], r: 98 },
    alt: { x: COL[1], y: ROW[1], r: 98 }, vsi: { x: COL[0], y: ROW[0], r: 98 },
    oil: { x: 561, y: 628, r: 44 }, fuel: { x: 435, y: 836, r: 44 } },
};

export const R22_INSTRUMENT_SYSTEMS: InstrumentSystemsDef = {
  engines: 1, vacuum: null, gyroDrive: { attitude: 'electric', heading: 'electric' },
  fuel: { kgPerGal: V.kgPerGal, tanks: [s => s.fuel.left, s => s.fuel.right] },
  busDeadVolts: 10, tachHourRpm: V.engineRpm100,
  rotorTach: { engineRpm100: V.engineRpm100, rotorRpm100: V.rotorRpm100,
    // POH 7-23: clutch ENGAGE powers both tach circuits directly from the battery with both masters off.
    powered: i => powered(i) || (!!i.controls.rotorClutch && i.state.electrical.batteryCharge > 0) },
  // ESTIMATE only: physics exposes no CAT probe. Approximate venturi cooling and exhaust-shroud heat;
  // these are not certified probe calibration values and do not duplicate the icing solver.
  carbAirTempC: (s, c) => s.oat - 273.15 + (s.engine.running ? 45 * engineControl(c, 0, 'carbHeat') - 20 : 0),
  lamps: [
    { id: 'clutch', lit: (i: LampInputs) => i.state.rotorcraft?.clutchLight ?? false },
    { id: 'lowRpm', lit: (i: LampInputs) => i.state.rotorcraft?.lowRpmHorn ?? false },
    // GOV OFF follows switch position; governorActive is separately displayed on the HUD (idle is not OFF).
    { id: 'govOff', lit: (i: LampInputs) => !(i.controls.rotorGovernor ?? false) },
    { id: 'alt', lit: (i: LampInputs) => i.state.electrical.busVoltage < 12.5 },
    { id: 'starter', lit: (i: LampInputs) => engineControl(i.controls, 0, 'starter') },
    // Pressure switch set-point is an ESTIMATE; indication reads undamped pressure, not the gauge needle.
    { id: 'oil', lit: (i: LampInputs) => i.state.engine.oilPressure < 25 },
    // POH 3-9: about 1.5 gallons usable with bladder tanks (one gallon applies to aluminum tanks).
    // The independent sender is in the main tank (7-13).
    { id: 'lowFuel', lit: (i: LampInputs) => i.fuelGal[0] <= 1.5 },
    // POH 7-24: switch on the throttle linkage. governorThrottle is the mechanical/governor opening,
    // including idle; governorActive is NOT a selector for the throttle source. The pilot grip limits
    // available opening in the solver. Near-open microswitch threshold is an ESTIMATE.
    { id: 'fullThrottle', lit: (i: LampInputs) => Math.min(i.controls.throttle, i.state.rotorcraft?.governorThrottle ?? i.controls.throttle) >= 0.98 },
    // No sensor/actuator state in the current model; present, testable, never fabricated from other warnings.
    ...['mrTemp', 'mrChip', 'trChip', 'co', 'brake'].map(id => ({ id, lit: (_i: LampInputs) => false })),
  ].map(l => ({ id: l.id, lit: (i: LampInputs) => powered(i) && ((i.controls.annunciatorTest ?? false) || l.lit(i)) })),
};
