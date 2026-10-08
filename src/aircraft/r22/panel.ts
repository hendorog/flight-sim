// R22 Beta II: basic six-hole VFR installation, optional VSI, bladder main/aux tanks, cabin heater,
// single NAV/COM and transponder; no attitude/heading gyros. POH 7-21 and Robinson's six-hole console photo:
// https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/R22_Beta_Console1_67484cb4dc.png
// The shared 0.56 x 0.30 m face cannot contain the tall real console AND pedestal at full scale. Primary
// positions follow the figure; pedestal engine gauges, radios and knobs are unfolded to its sides/bottom.
// This is a layout approximation, not a claim that the real R22 has a wide airplane instrument panel.
import type { AsiMarkings, GaugeDef, InstrumentSystemsDef, LampDef, LampInputs, PanelDef, RotorTachMarkings, ScaleDef, SwitchDef } from '../types';
import { DEG } from '../../core/math';
import { engineControl } from '../../core/types';
import { PANEL_CANVAS, PANEL_PX_PER_M } from './dimensions';
import { R22_INSTRUMENT_REFERENCE as V, R22_MAP_PLACARD } from './reference';

// Whole case diameters at the shared px/m; renderer scales glass, needles and bezel knobs together.
const SCALE = { large: 3.125 * 0.0254 * PANEL_PX_PER_M / 172, small: 2.25 * 0.0254 * PANEL_PX_PER_M / 120 };
const APERTURES = { large: 74 * SCALE.large, small: 51 * SCALE.small };
const COL = [325, 533, 741] as const;
const ROW = [180, 388] as const;

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
// Order of the upper console lamps in POH 7-21, with BRAKE and FULL THROTTLE brought into the same strip.
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
    { kind: 'dual', id: 'fuel', at: [95, 180], seed: 323, title: ['FUEL', 'US GAL'],
      left: scale('MAIN', 0, V.mainUsableGal, [0, 8, 16.9], 2, r => r.fuelGal[0]),
      right: scale('AUX', 0, V.auxUsableGal, [0, 4, 9.4], 1, r => r.fuelGal[1]) },
    { kind: 'dual', id: 'oil', at: [95, 335], seed: 324, title: ['OIL', '°F / PSI'],
      left: scale('°F', 50, 250, [75, 150, 245], 25, r => r.oilTempF,
        { arcs: [{ from: 75, to: 245, color: 'green' }], redLines: [245] }),
      right: scale('PSI', 0, 120, [0, 55, 95, 115], 10, r => r.oilPressurePsi,
        { arcs: [{ from: 25, to: 55, color: 'yellow' }, { from: 55, to: 95, color: 'green' },
          { from: 95, to: 115, color: 'yellow' }], redLines: [25, 115] }) },
    { kind: 'dual', id: 'chtAmps', at: [95, 490], seed: 325, title: ['CHT', 'AMPS'],
      left: scale('°F', 0, 550, [0, 200, 500], 50, r => r.engines[0].chtF,
        { arcs: [{ from: 200, to: 500, color: 'green' }], redLines: [500] }),
      right: scale('A', -60, 60, [-60, 0, 60], 20, r => r.ammeterAmps) },
    single('cat', [325, 565], 'CARB AIR', '°C', 'small', R22_CAT_SCALE),
    { kind: 'clock', id: 'clock', at: [485, 565] },
    { kind: 'hourmeter', id: 'hours', bounds: { x: 642, y: 510, w: 160, h: 44 } },
    { kind: 'navcom', id: 'navcom1', bounds: { x: 970, y: 420, w: 320, h: 76 } },
    { kind: 'xpdr', id: 'xpdr', bounds: { x: 970, y: 504, w: 320, h: 60 } },
    { kind: 'pushButton', id: 'lampTest', bounds: { x: 65, y: 625, w: 90, h: 78 }, label: 'LIGHT TEST',
      read: c => c.annunciatorTest ?? false, press: (down, c) => { c.annunciatorTest = down; } },
    { kind: 'pullKnob', id: 'mixture', bounds: { x: 946, y: 610, w: 100, h: 100 }, label: 'MIXTURE', color: '#c8261b',
      read: c => 1 - engineControl(c, 0, 'mixture'), set: (c, v) => { c.mixture = 1 - v; },
      guard: { closed: c => !(c.mixtureGuardOpen ?? false), toggle: c => { c.mixtureGuardOpen = !c.mixtureGuardOpen; } } },
    { kind: 'pullKnob', id: 'carbHeat', bounds: { x: 1080, y: 610, w: 100, h: 100 }, label: 'CARB HEAT', color: '#ddd7c3',
      read: c => engineControl(c, 0, 'carbHeat'), set: (c, v) => { c.carbHeat = v; } },
    { kind: 'pullKnob', id: 'cabinHeat', bounds: { x: 1214, y: 610, w: 110, h: 100 }, label: 'CABIN HEAT', color: '#ddd7c3',
      read: c => c.cabinHeat ?? 0, set: (c, v) => { c.cabinHeat = v; } },
  ],
  annunciator: { bounds: { x: 20, y: 30, w: 1304, h: 43 }, lamps: R22_ANNUNCIATOR_LAMPS, columns: 13 },
  switchRow: {
    bounds: { x: 208, y: 640, w: 654, h: 78 }, rockerTop: 28, rockerW: 24, rockerH: 36,
    switches: [
      switchDef('nav', 'NAV', 28, c => c.lights.nav, c => { c.lights.nav = !c.lights.nav; }),
      switchDef('strobe', 'STROBE', 85, c => c.lights.strobe, c => { c.lights.strobe = !c.lights.strobe; }),
      switchDef('landing', 'LAND', 142, c => c.lights.landing, c => { c.lights.landing = !c.lights.landing; }),
      switchDef('avionics', 'AVIONICS', 210, c => c.avionics, c => { c.avionics = !c.avionics; }),
      switchDef('alternator', 'ALT', 270, c => c.alternator, c => { c.alternator = !c.alternator; }),
      switchDef('battery', 'BAT', 320, c => c.masterBattery, c => { c.masterBattery = !c.masterBattery; }, true),
      switchDef('rotorClutch', 'CLUTCH', 392, c => c.rotorClutch ?? false, c => { c.rotorClutch = !c.rotorClutch; }, true),
    ],
    legends: [{ text: 'PANEL', x: 450, y: 15, size: 8 }, { text: 'RADIO', x: 493, y: 15, size: 8 }],
    dimmers: { panel: 450, radio: 493, y: 46 },
  },
  ignition: { kind: 'key', at: [800, 685] },
  background: {
    color: '#25272a', seamsX: [196, 888], bushings: [],
    rack: { rails: { x: 966, y: 414, w: 328, h: 156 }, blanks: [] },
    placards: [
      { x: 1130, y: 88, size: 10, lines: ['R22 BETA II — O-360-J2A', 'LIMIT MANIFOLD PRESSURE — IN HG', 'MAXIMUM CONTINUOUS POWER'] },
      { x: 1130, y: 140, size: 10, lines: [
        'ALT FT     OAT °C:  -20   -10     0     10     20     30     40',
        ...R22_MAP_PLACARD.values.map((row, i) => `${String(R22_MAP_PLACARD.altitudeFt[i] || 'SL').padStart(4)}        ${row.map(v => v === null ? ' FT ' : v.toFixed(1)).join('   ')}`),
        'FT = FULL THROTTLE', '5 MIN TAKEOFF: ADD 0.9 IN HG',
      ] },
      { x: 1130, y: 266, size: 10, lines: ['VNE 102 KIAS TO 3000 FT DENSITY ALT', 'ABOVE 3000 FT: REDUCE PER POH 2-11', 'NR POWER ON 101–104% / OFF 90–110%'] },
      { x: 1130, y: 328, size: 10, lines: ['DAY / NIGHT VFR ONLY', 'LOW-G PUSHOVERS PROHIBITED', 'SOLO FROM RIGHT SEAT ONLY'] },
      { x: 720, y: 575, size: 9, lines: ['BELOW 18 IN MP', 'IGNORE CAT — FULL CARB HEAT'] },
      { x: 95, y: 578, size: 9, lines: ['MAIN 16.9 / AUX 9.4 US GAL', 'USABLE — BLADDER TANKS'] },
      { x: 1268, y: 577, size: 8, lines: ['ENGINE FIRE:', 'CABIN HEAT OFF'] },
    ],
  },
  keepOut: [],
  regions: { sixpack: { x: 218, y: 77, w: 628, h: 417 }, engine: { x: 18, y: 103, w: 155, h: 465 },
    stack: { x: 966, y: 414, w: 328, h: 156 } },
  spots: { asi: { x: COL[1], y: ROW[0], r: 98 }, tach: { x: COL[2], y: ROW[0], r: 98 },
    alt: { x: COL[1], y: ROW[1], r: 98 }, vsi: { x: COL[0], y: ROW[0], r: 98 },
    oil: { x: 95, y: 335, r: 72 }, fuel: { x: 95, y: 180, r: 72 } },
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
    // POH 3-8: about one gallon usable remaining. Sender is in the main tank (7-13).
    { id: 'lowFuel', lit: (i: LampInputs) => i.fuelGal[0] <= 1 },
    // Near-open microswitch threshold is an ESTIMATE. Use actual governor throttle while active.
    { id: 'fullThrottle', lit: (i: LampInputs) => (i.state.rotorcraft?.governorActive ? i.state.rotorcraft.governorThrottle : i.controls.throttle) >= 0.98 },
    // No sensor/actuator state in the current model; present, testable, never fabricated from other warnings.
    ...['mrTemp', 'mrChip', 'trChip', 'co', 'brake'].map(id => ({ id, lit: (_i: LampInputs) => false })),
  ].map(l => ({ id: l.id, lit: (i: LampInputs) => powered(i) && ((i.controls.annunciatorTest ?? false) || l.lit(i)) })),
};
