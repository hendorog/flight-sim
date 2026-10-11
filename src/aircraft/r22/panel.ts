// R22 Beta II seven-hole VFR installation, POH 7-19 (26 Oct 2016): VSI / optional / ASI / tach,
// altimeter / optional / MAP. The optional holes carry electric attitude and heading instruments.
// Blue engine face and silver switch plate follow the supplied photographic reference. Digital CAT
// is an optional replacement; its existing estimated probe model is unchanged. No reference artwork used.
import type { AsiMarkings, GaugeDef, InstrumentSystemsDef, LampDef, LampInputs, PanelDef, RotorTachMarkings, ScaleDef, SwitchDef } from '../types';
import { DEG } from '../../core/math';
import { engineControl } from '../../core/types';
import { PANEL_CANVAS, PANEL_OUTLINE, PANEL_POD_OUTLINE, PANEL_PEDESTAL_OUTLINE, PANEL_PX_PER_M } from './dimensions';
import { R22_INSTRUMENT_REFERENCE as V, R22_MAP_PLACARD } from './reference';

// Whole case diameters at the shared px/m; renderer scales glass, needles and bezel knobs together.
const SCALE = { large: 3.125 * 0.0254 * PANEL_PX_PER_M / 172, small: 2.25 * 0.0254 * PANEL_PX_PER_M / 120 };
const APERTURES = { large: 74 * SCALE.large, small: 51 * SCALE.small };
const COL = [204, 420, 636, 852] as const;
const ROW = [190, 400] as const;

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
// Eight primary brow warnings (7-19), plus full-throttle/brake lenses; ALT/OIL/GOV OFF on the engine face.
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
  fixed: { flightRows: [['vsi', 'attitude', 'asi', 'tach'], ['altimeter', 'heading', 'map']],
    controls: [{ x: 298, y: 906, w: 450, h: 162 }] },
  // Estimated dimmer response, shared with the Raven analog installation; warning lights bypass it.
  id: 'r22', lightingDimmerExponent: 2.2, size: PANEL_CANVAS, instrumentScale: SCALE, instrumentBezel: 'round', apertures: APERTURES,
  console: { podOutline: PANEL_POD_OUTLINE, pedestalOutline: PANEL_PEDESTAL_OUTLINE, hoodOverhang: 0.045,
    color: 0x282e23, pedestalColor: 0x717664 },
  gauges: [
    { kind: 'vsi', id: 'vsi', at: [COL[0], ROW[0]] },
    { kind: 'attitude', id: 'attitude', at: [COL[1], ROW[0]] },
    { kind: 'asi', id: 'asi', at: [COL[2], ROW[0]], marks: R22_ASI_MARKS },
    { kind: 'rotorTach', id: 'tach', at: [COL[3], ROW[0]], marks: R22_TACH_MARKS },
    { kind: 'altimeter', id: 'altimeter', at: [312, ROW[1]] },
    { kind: 'heading', id: 'heading', at: [528, ROW[1]] },
    single('map', [744, ROW[1]], 'MANIFOLD', 'IN HG', 'large', R22_MAP_SCALE),
    { kind: 'clock', id: 'clock', at: [382, 714] },
    { kind: 'digitalTemperature', id: 'cat', bounds: { x: 316, y: 998, w: 156, h: 58 },
      label: 'CARB AIR TEMP', read: r => r.carbAirTempC },
    { kind: 'dualSector', id: 'ampsOil', bounds: { x: 480, y: 620, w: 252, h: 72 },
      left: scale('AMPS', -60, 60, [-60, 0, 60], 20, r => r.ammeterAmps),
      right: scale('OIL PSI', 0, 120, [0, 55, 95, 115], 10, r => r.oilPressurePsi,
        { arcs: [{ from: 25, to: 55, color: 'yellow' }, { from: 55, to: 95, color: 'green' },
          { from: 95, to: 115, color: 'yellow' }], redLines: [25, 115] }) },
    { kind: 'dualSector', id: 'auxOil', bounds: { x: 480, y: 742, w: 252, h: 72 },
      left: scale('AUX GAL', 0, V.auxUsableGal, [0, 4, 9.4], 1, r => r.fuelGal[1]),
      right: scale('OIL °F', 50, 250, [75, 150, 245], 25, r => r.oilTempF,
        { arcs: [{ from: 75, to: 245, color: 'green' }], redLines: [245] }) },
    { kind: 'dualSector', id: 'fuelCht', bounds: { x: 480, y: 824, w: 252, h: 72 },
      left: scale('MAIN GAL', 0, V.mainUsableGal, [0, 8, 16.9], 2, r => r.fuelGal[0]),
      right: scale('CHT °F', 0, 550, [0, 200, 500], 50, r => r.engines[0].chtF,
        { arcs: [{ from: 200, to: 500, color: 'green' }], redLines: [500] }) },
    { kind: 'navcom', id: 'navcom1', bounds: { x: 368, y: 1084, w: 320, h: 76 } },
    { kind: 'xpdr', id: 'xpdr', bounds: { x: 368, y: 1170, w: 320, h: 60 } },
    // Simulator hourmeter on the pedestal; the real unit is on the ledge ahead of the right seat (7-18).
    { kind: 'hourmeter', id: 'hours', bounds: { x: 320, y: 1450, w: 148, h: 44 } },
    { kind: 'pushButton', id: 'lampTest', bounds: { x: 646, y: 1430, w: 90, h: 78 }, label: 'LIGHT TEST',
      read: c => c.annunciatorTest ?? false, press: (down, c) => { c.annunciatorTest = down; } },
    { kind: 'pullKnob', id: 'mixture', bounds: { x: 568, y: 1512, w: 100, h: 100 }, label: 'MIXTURE', color: '#c8261b',
      read: c => 1 - engineControl(c, 0, 'mixture'), set: (c, v) => { c.mixture = 1 - v; },
      guard: { closed: c => !(c.mixtureGuardOpen ?? false), toggle: c => { c.mixtureGuardOpen = !c.mixtureGuardOpen; } } },
    { kind: 'pullKnob', id: 'carbHeat', bounds: { x: 374, y: 1512, w: 100, h: 100 }, label: 'CARB HEAT', color: '#ddd7c3',
      read: c => engineControl(c, 0, 'carbHeat'), set: (c, v) => { c.carbHeat = v; } },
    { kind: 'pullKnob', id: 'cabinHeat', bounds: { x: 484, y: 1426, w: 110, h: 80 }, label: 'CABIN HEAT', color: '#ddd7c3',
      read: c => c.cabinHeat ?? 0, set: (c, v) => { c.cabinHeat = v; } },
  ],
  annunciator: { bounds: { x: 254, y: 32, w: 548, h: 576 }, lamps: R22_ANNUNCIATOR_LAMPS,
    cells: [...Array.from({ length: 8 }, (_, i) => ({ x: 254 + i * 54, y: 38, w: 53, h: 48 })),
      ...Array.from({ length: 3 }, (_, i) => ({ x: 542 + i * 64, y: 558, w: 62, h: 50 })),
      { x: 686, y: 38, w: 58, h: 48 }, { x: 746, y: 38, w: 54, h: 48 }] },
  switchRow: {
    bounds: { x: 300, y: 906, w: 450, h: 154 }, rockerTop: 40, rockerW: 24, rockerH: 36, ink: '#20231f',
    switches: [
      switchDef('nav', 'NAV', 30, c => c.lights.nav, c => { c.lights.nav = !c.lights.nav; }),
      switchDef('strobe', 'STROBE', 76, c => c.lights.strobe, c => { c.lights.strobe = !c.lights.strobe; }),
      { ...switchDef('rotorClutch', 'CLUTCH', 126, c => c.rotorClutch ?? false, c => { c.rotorClutch = !c.rotorClutch; }, true), top: 40, cover: true },
      switchDef('landing', 'LAND', 176, c => c.lights.landing, c => { c.lights.landing = !c.lights.landing; }),
      switchDef('avionics', 'AVIONICS', 226, c => c.avionics, c => { c.avionics = !c.avionics; }),
      switchDef('alternator', 'ALT', 276, c => c.alternator, c => { c.alternator = !c.alternator; }),
      switchDef('battery', 'BAT', 322, c => c.masterBattery, c => { c.masterBattery = !c.masterBattery; }, true),
    ],
    legends: [{ text: 'PANEL', x: 224, y: 102, size: 8 }, { text: 'RADIO', x: 284, y: 102, size: 8 }],
    dimmers: { panel: 224, radio: 284, y: 126 },
  },
  ignition: { kind: 'key', at: [700, 954] },
  background: {
    color: '#30362b', outline: PANEL_OUTLINE, seamsX: [], bushings: [],
    plates: [
      { bounds: { x: 288, y: 548, w: 480, h: 360 }, color: '#14253d' },
      { bounds: { x: 288, y: 912, w: 480, h: 158 }, color: '#b9bbb4' },
      { bounds: { x: 288, y: 1074, w: 480, h: 348 }, color: '#282e31' },
      { bounds: { x: 288, y: 1426, w: 480, h: 206 }, color: '#969b8e' },
    ],
    rack: { rails: { x: 358, y: 1074, w: 340, h: 166 }, blanks: [] },
    placards: [
      { x: 606, y: 698, size: 23, lines: ['R22 Beta II'] },
      { x: 528, y: 1244, size: 9, lines: ['LIMIT MANIFOLD PRESSURE — IN HG', 'MAXIMUM CONTINUOUS POWER'] },
      { x: 528, y: 1280, size: 6.5, lines: [
        'ALT FT     OAT °C:  -20   -10     0     10     20     30     40',
        ...R22_MAP_PLACARD.values.map((row, i) => `${String(R22_MAP_PLACARD.altitudeFt[i] || 'SL').padStart(4)}        ${row.map(v => v === null ? ' FT ' : v.toFixed(1)).join('   ')}`),
        'FT = FULL THROTTLE   /   5 MIN TAKEOFF: ADD 0.9 IN HG',
      ] },
      { x: 528, y: 1359, size: 7, lines: ['VNE 102 KIAS TO 3000 FT DENSITY ALT',
        'ABOVE 3000 FT: REDUCE PER POH 2-11', 'NR POWER ON 101–104% / OFF 90–110%'] },
      { x: 528, y: 1402, size: 6, lines: ['DAY / NIGHT VFR — SOLO RIGHT SEAT — NO LOW-G PUSHOVERS'] },
      { x: 402, y: 872, size: 6, lines: ['BELOW 18 IN MP', 'IGNORE CAT — FULL CARB HEAT'] },
    ],
  },
  keepOut: [],
  regions: { sixpack: { x: 100, y: 88, w: 856, h: 416 }, engine: { x: 298, y: 550, w: 452, h: 358 },
    stack: { x: 358, y: 1074, w: 340, h: 166 } },
  spots: { asi: { x: COL[2], y: ROW[0], r: 98 }, tach: { x: COL[3], y: ROW[0], r: 98 },
    alt: { x: 312, y: ROW[1], r: 98 }, vsi: { x: COL[0], y: ROW[0], r: 98 },
    attitude: { x: COL[1], y: ROW[0], r: 98 }, heading: { x: 528, y: ROW[1], r: 98 },
    oil: { x: 669, y: 656, r: 44 }, fuel: { x: 543, y: 860, r: 44 } },
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
    { id: 'lowRpm', lit: (i: LampInputs) => i.state.rotorcraft?.lowRpmLight ?? false },
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
