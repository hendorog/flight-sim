// Two synthetic panels that put every panel mechanism the Cessna 172S does not use on a canvas, so the
// components, the click hotspots and the instrument dynamics behind them are proven before a real twin exists:
//   TWIN_TESTBED_PANEL   two piston engines: twin-needle manifold pressure, tachometer and fuel flow, load meters,
//                        gear lights with selector and emergency knob, trim bars, magneto toggles and a starter
//                        rocker (the Piper Seneca pattern, on a 14 V bus with a vacuum pump on each engine);
//   FADEC_TESTBED_PANEL  two FADEC diesels: boxed engine display, ENGINE MASTER switches and START key, flap
//                        lights with switch, electric gyros (the Diamond DA42 pattern, 28 V).
// Both fit the low panel face TESTBED_PX_RECT. They are test-beds, not the panels of those aircraft: the markings
// are the handbook's (work/aircraft-data/pa34.md, da42.md) so the artwork is judged on real numbers, but the
// arrangement is made up. The instruments dev page shows them (dev/instruments.html?type=twin | fadec).

import type { InputAction } from '../../input/bindings';
import type { AsiMarkings, InstrumentSystemsDef, LampInputs, PanelDef, PanelEngineDisplayRow, Rect, SwitchDef } from '../panelDef';
import { bar, celsius, engineDisplayRow, engineSwitch, singleGauge, sixPackGauges, twinEngineGauge, type EngineDial } from './gauges';

/** The part of the 2080 x 800 canvas a low panel face shows (render/aircraft/airframe/types.ts, CockpitDef.panel.pxRect). */
export const TESTBED_PX_RECT: Rect = { x: 0, y: 0, w: 2080, h: 624 };

const COLS = [315, 499, 683] as const;
const ROWS = [150, 338] as const;
/** Lower row of 3-1/8" instruments, either side of the pilot's control column. */
const ENGINE_ROW_Y = 530;
const YOKE = { x: 499, y: ENGINE_ROW_Y, r: 58 };
const STACK_X = 962;
const APERTURES = { large: 74, small: 51 };
const BIG = APERTURES.large * 1.1;

// The actions of the gear controls come with the key map of the retractable types.
const GEAR_EMERGENCY = 'gearEmergency' as string as InputAction;

/** A dial that runs evenly over 270 degrees. */
const AIRSPEED_DIAL = { scaleKt: [0, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220], scaleDeg: [0, 28, 66, 104, 140, 174, 207, 239, 270, 300, 328] };

const plain = (id: string, label: string, name: string, x: number, on: SwitchDef['on'], toggle: SwitchDef['toggle'], group?: string): SwitchDef => ({
  id,
  label,
  name,
  x,
  ...(group !== undefined && { group }),
  on,
  toggle,
});

/** Master, avionics and the lights: the switches that are not per engine. */
const commonSwitches = (x0: number): SwitchDef[] => [
  plain('landing', 'LAND', 'Landing light', x0, (c) => c.lights.landing, (c) => { c.lights.landing = !c.lights.landing; }, 'lights'),
  plain('taxi', 'TAXI', 'Taxi light', x0 + 42, (c) => c.lights.taxi, (c) => { c.lights.taxi = !c.lights.taxi; }, 'lights'),
  plain('nav', 'NAV', 'Nav lights', x0 + 84, (c) => c.lights.nav, (c) => { c.lights.nav = !c.lights.nav; }, 'lights'),
  plain('strobe', 'STROBE', 'Strobes', x0 + 126, (c) => c.lights.strobe, (c) => { c.lights.strobe = !c.lights.strobe; }, 'lights'),
  plain('avionics', 'AVIONICS', 'Avionics master', x0 + 194, (c) => c.avionics, (c) => { c.avionics = !c.avionics; }),
  plain('pitotHeat', 'PITOT HEAT', 'Pitot heat', x0 + 262, (c) => c.pitotHeat, (c) => { c.pitotHeat = !c.pitotHeat; }),
];

const ROW_BOUNDS: Rect = { x: 1300, y: 500, w: 760, h: 116 };
const ROCKER = { rockerTop: 44, rockerW: 24, rockerH: 42 };
const DIMMERS = { panel: 650, radio: 710, y: 66 };
const rowLegends = (lightsX: number): PanelDef['switchRow']['legends'] => [
  { text: 'LIGHTS', x: lightsX, y: ROCKER.rockerTop - 24, size: 8.5 },
  { text: 'PANEL', x: DIMMERS.panel, y: ROCKER.rockerTop - 12, size: 8 },
  { text: 'RADIO', x: DIMMERS.radio, y: ROCKER.rockerTop - 12, size: 8 },
];

const powered = (i: LampInputs, deadVolts: number): boolean => i.state.electrical.busVoltage > deadVolts;

// ---------------------------------------------------------------------------------------------------
// Twin piston test-bed. Markings: Piper PA-34-200 handbook (work/aircraft-data/pa34.md).

/** Knots: white 60-109, green 66-165, yellow 165-188, red line 188 (Vne); red radial 69 (Vmc), blue radial 91 (Vyse). */
const TWIN_ASI: AsiMarkings = {
  ...AIRSPEED_DIAL,
  tickFrom: 40,
  tickTo: 220,
  minorStep: 5,
  numberStep: 20,
  arcs: [
    { from: 66, to: 165, color: 'green' },
    { from: 165, to: 188, color: 'yellow' },
    { from: 60, to: 109, color: 'white', inner: true },
  ],
  redLine: 188,
  redRadial: 69,
  blueLine: 91,
};

/** Tachometer: green 500-2200 and 2400-2700 rpm, red arc 2200-2400 (avoid continuous operation), red line 2700. */
const TWIN_TACH: EngineDial = {
  size: 'large',
  seed: 121,
  fromDeg: -135,
  toDeg: 135,
  title: 'RPM',
  units: 'X100',
  labels: [0, 5, 10, 15, 20, 25, 30, 35],
  scale: {
    label: '',
    min: 0,
    max: 35,
    majors: [0, 5, 10, 15, 20, 25, 30, 35],
    minorStep: 1,
    arcs: [
      { from: 5, to: 22, color: 'green' },
      { from: 22, to: 24, color: 'red' },
      { from: 24, to: 27, color: 'green' },
    ],
    redLines: [27],
  },
};
/** Manifold pressure, inHg: no limit and no arc on the normally aspirated engine. */
const TWIN_MANIFOLD: EngineDial = {
  size: 'large',
  seed: 122,
  fromDeg: -135,
  toDeg: 135,
  title: 'MANIFOLD PRESS',
  units: 'IN HG',
  labels: [10, 15, 20, 25, 30, 35, 40],
  scale: { label: '', min: 10, max: 40, majors: [10, 15, 20, 25, 30, 35, 40], minorStep: 1 },
};
/** Fuel flow, US gal/h: red line 19.2. */
const TWIN_FUEL_FLOW: EngineDial = {
  size: 'small',
  seed: 123,
  fromDeg: -125,
  toDeg: 125,
  title: 'FUEL FLOW',
  units: 'GAL/HR',
  labels: [0, 5, 10, 15, 20],
  scale: { label: '', min: 0, max: 20, majors: [0, 5, 10, 15, 20], minorStep: 1, redLines: [19.2] },
};
/** Load meter of one alternator: 60 A each. */
const loadMeter = (seed: number, title: string): EngineDial => ({
  size: 'small',
  seed,
  fromDeg: -70,
  toDeg: 70,
  title,
  units: 'AMPS',
  labels: [0, 30, 60],
  scale: { label: '', min: 0, max: 60, majors: [0, 15, 30, 45, 60], minorStep: 5, redLines: [60] },
});

const TWIN_ROW_X = { battery: 40, lAlt: 92, rAlt: 122, lPump: 176, rPump: 206, lights: 268 };

export const TWIN_TESTBED_PANEL: PanelDef = {
  id: 'twin-testbed',
  size: { w: 2080, h: 800 },
  gauges: [
    ...sixPackGauges(COLS, ROWS, TWIN_ASI),
    { kind: 'cdi', id: 'cdi1', at: [867, ROWS[0]], receiver: 'nav1', fixedCourseDeg: 70 },
    twinEngineGauge('manifold', [COLS[0], ENGINE_ROW_Y], TWIN_MANIFOLD, (e) => e.manifoldInHg),
    twinEngineGauge('tach', [COLS[2], ENGINE_ROW_Y], TWIN_TACH, (e) => e.rpm / 100),
    twinEngineGauge('fuelFlow', [867, 320], TWIN_FUEL_FLOW, (e) => e.fuelFlowGph),
    {
      kind: 'dual',
      id: 'fuel',
      at: [867, 460],
      seed: 124,
      title: ['FUEL QTY', 'U.S. GAL'],
      // 98 US gal in two tanks, 93 usable.
      left: { label: 'L', min: 0, max: 50, majors: [0, 10, 20, 30, 40, 50], minorStep: 5, arcs: [{ from: 0, to: 2.5, color: 'red' }], read: (r) => r.fuelGal[0] },
      right: { label: 'R', min: 0, max: 50, majors: [0, 10, 20, 30, 40, 50], minorStep: 5, arcs: [{ from: 0, to: 2.5, color: 'red' }], read: (r) => r.fuelGal[1] },
    },
    // Vacuum 4.5-5.2 inHg.
    {
      kind: 'suction',
      id: 'suction',
      at: [100, 150],
      scale: { label: '', min: 2.6, max: 7, majors: [3, 4, 5, 6, 7], minorStep: 0.5, arcs: [{ from: 4.5, to: 5.2, color: 'green' }], read: (r) => r.suctionInHg },
    },
    singleGauge('loadLeft', [100, 290], loadMeter(125, 'L ALT'), (r) => r.alternatorAmps[0] ?? 0),
    singleGauge('loadRight', [100, 430], loadMeter(126, 'R ALT'), (r) => r.alternatorAmps[1] ?? 0),
    { kind: 'gps', id: 'gps', bounds: { x: STACK_X, y: 34, w: 320, h: 236 } },
    { kind: 'gearLights', id: 'gear', bounds: { x: 970, y: 290, w: 120, h: 150 }, lever: [1140, 365] },
    { kind: 'guardedKnob', id: 'gearEmergency', at: [1230, 350], label: 'EMERGENCY GEAR', action: GEAR_EMERGENCY },
    { kind: 'trimBar', id: 'elevatorTrim', bounds: { x: 990, y: 450, w: 76, h: 168 }, axis: 'elevator' },
    { kind: 'trimBar', id: 'rudderTrim', bounds: { x: 1090, y: 520, w: 190, h: 56 }, axis: 'rudder' },
  ],
  annunciator: {
    bounds: { x: 316, y: 4, w: 366, h: 52 },
    lamps: [
      { id: 'leftAlternator', text: 'L ALT OUT', color: '#ffb21e', lit: (r) => r.lamps.leftAlternator },
      { id: 'vacuum', text: 'LOW VAC', color: '#ffb21e', lit: (r) => r.lamps.vacuum },
      { id: 'rightAlternator', text: 'R ALT OUT', color: '#ffb21e', lit: (r) => r.lamps.rightAlternator },
    ],
  },
  switchRow: {
    bounds: ROW_BOUNDS,
    ...ROCKER,
    switches: [
      plain('battery', 'MASTER', 'Master', TWIN_ROW_X.battery, (c) => c.masterBattery, (c) => { c.masterBattery = !c.masterBattery; }),
      engineSwitch('leftAlternator', 'L', 'Left alternator', TWIN_ROW_X.lAlt, 'alternator', 0, { group: 'alternators' }),
      engineSwitch('rightAlternator', 'R', 'Right alternator', TWIN_ROW_X.rAlt, 'alternator', 1, { group: 'alternators' }),
      engineSwitch('leftFuelPump', 'L', 'Left fuel pump', TWIN_ROW_X.lPump, 'fuelPump', 0, { group: 'pumps' }),
      engineSwitch('rightFuelPump', 'R', 'Right fuel pump', TWIN_ROW_X.rPump, 'fuelPump', 1, { group: 'pumps' }),
      ...commonSwitches(TWIN_ROW_X.lights),
    ],
    legends: [
      { text: 'ALT', x: (TWIN_ROW_X.lAlt + TWIN_ROW_X.rAlt) / 2, y: ROCKER.rockerTop - 24, size: 8.5 },
      { text: 'FUEL PUMP', x: (TWIN_ROW_X.lPump + TWIN_ROW_X.rPump) / 2, y: ROCKER.rockerTop - 24, size: 7.5 },
      ...rowLegends(TWIN_ROW_X.lights + 63),
    ],
    dimmers: DIMMERS,
  },
  // Four magneto switches and the starter rocker.
  ignition: { kind: 'toggles', at: [1500, 420], engines: 2 },
  background: {
    seamsX: [STACK_X - 16, 1292],
    bushings: [],
    placards: [{ x: 1700, y: 70, lines: ['MINIMUM SINGLE ENGINE CONTROL SPEED 69 KIAS', 'BEST SINGLE ENGINE RATE OF CLIMB 91 KIAS'], size: 8 }],
    rack: { rails: { x: STACK_X - 4, y: 28, w: 328, h: 248 }, blanks: [] },
  },
  keepOut: [YOKE, { x: 1960, y: 300, r: 58 }],
  apertures: APERTURES,
  regions: {
    sixpack: { x: COLS[0] - 92, y: ROWS[0] - 92, w: 3 * 184, h: 2 * 188 },
    engine: { x: COLS[0] - 92, y: ENGINE_ROW_Y - 92, w: COLS[2] - COLS[0] + 184, h: 184 },
  },
  spots: {
    asi: { x: COLS[0], y: ROWS[0], r: BIG },
    tach: { x: COLS[2], y: ENGINE_ROW_Y, r: BIG },
    manifold: { x: COLS[0], y: ENGINE_ROW_Y, r: BIG },
  },
};

const TWIN_BUS_DEAD_VOLTS = 9;

export const TWIN_TESTBED_SYSTEMS: InstrumentSystemsDef = {
  engines: 2,
  // A pump on each engine; either one carries all the gyros. Regulated to 5.0 inHg at 2000 rpm.
  vacuum: {
    engines: [0, 1],
    regulatedInHg: 5.0,
    ratedInHg: 4.5,
    suction: (engineRpm) => (engineRpm <= 0 ? 0 : Math.min(5.0, 5.4 * (1 - Math.exp(-engineRpm / 470)))),
  },
  gyroDrive: { attitude: 'vacuum', heading: 'vacuum' },
  // 100LL, 6.0 lb per US gallon; a gauge per side.
  fuel: { kgPerGal: 2.7216, tanks: [(s) => s.fuel.left, (s) => s.fuel.right] },
  // A 14 V system.
  busDeadVolts: TWIN_BUS_DEAD_VOLTS,
  tachHourRpm: 2300,
  lamps: [
    { id: 'leftAlternator', lit: (i) => powered(i, TWIN_BUS_DEAD_VOLTS) && (i.state.electrical.alternators[0] ?? 0) < 1 },
    { id: 'rightAlternator', lit: (i) => powered(i, TWIN_BUS_DEAD_VOLTS) && (i.state.electrical.alternators[1] ?? 0) < 1 },
    { id: 'vacuum', lit: (i) => powered(i, TWIN_BUS_DEAD_VOLTS) && i.suctionInHg < 3.5 },
  ],
};

// ---------------------------------------------------------------------------------------------------
// FADEC diesel twin test-bed. Markings and limits: Diamond DA42 NG flight manual (work/aircraft-data/da42.md).

/** Knots: white 62-113, green 69-151, yellow 151-188, red line 188; red radial 76 (Vmca), blue radial 85 (Vyse). */
const FADEC_ASI: AsiMarkings = {
  ...AIRSPEED_DIAL,
  tickFrom: 40,
  tickTo: 200,
  minorStep: 5,
  numberStep: 20,
  arcs: [
    { from: 69, to: 151, color: 'green' },
    { from: 151, to: 188, color: 'yellow' },
    { from: 62, to: 113, color: 'white', inner: true },
  ],
  redLine: 188,
  redRadial: 76,
  blueLine: 85,
};

/** The rows of the engine display with the manual's bands. Temperatures in degrees C and oil pressure in bar, as that aircraft shows them. */
const FADEC_ROWS: readonly PanelEngineDisplayRow[] = [
  engineDisplayRow('LOAD', '%', 0, 100, (e) => e.loadPct, { arcs: [{ from: 0, to: 92, color: 'green' }, { from: 92, to: 100, color: 'yellow' }] }),
  // Propeller rpm (the tachometer's shaft on this type); 2300 is the limit.
  engineDisplayRow('RPM', '', 0, 2600, (e) => e.rpm, {
    arcs: [{ from: 0, to: 2100, color: 'green' }, { from: 2100, to: 2300, color: 'yellow' }, { from: 2300, to: 2600, color: 'red' }],
    redLines: [2300],
  }),
  engineDisplayRow('FUEL FLOW', 'GAL/H', 0, 10, (e) => e.fuelFlowGph, { decimals: 1 }),
  engineDisplayRow('OIL TEMP', '°C', -30, 150, (e) => celsius(e.oilTempF), {
    arcs: [{ from: -30, to: 50, color: 'yellow' }, { from: 50, to: 135, color: 'green' }, { from: 135, to: 140, color: 'yellow' }, { from: 140, to: 150, color: 'red' }],
  }),
  engineDisplayRow('OIL PRES', 'BAR', 0, 7, (e) => bar(e.oilPressurePsi), {
    decimals: 1,
    arcs: [
      { from: 0, to: 0.9, color: 'red' },
      { from: 0.9, to: 2.5, color: 'yellow' },
      { from: 2.5, to: 6, color: 'green' },
      { from: 6, to: 6.5, color: 'yellow' },
      { from: 6.5, to: 7, color: 'red' },
    ],
  }),
  engineDisplayRow('COOLANT', '°C', -30, 110, (e) => celsius(e.coolantF), {
    arcs: [{ from: -30, to: 60, color: 'yellow' }, { from: 60, to: 95, color: 'green' }, { from: 95, to: 105, color: 'yellow' }, { from: 105, to: 110, color: 'red' }],
  }),
  engineDisplayRow('GEARBOX', '°C', -30, 125, (e) => celsius(e.gearboxF), {
    arcs: [{ from: -30, to: 35, color: 'yellow' }, { from: 35, to: 115, color: 'green' }, { from: 115, to: 120, color: 'yellow' }, { from: 120, to: 125, color: 'red' }],
  }),
  {
    label: 'VOLTS',
    unit: 'V',
    min: 20,
    max: 34,
    decimals: 1,
    arcs: [
      { from: 20, to: 24.1, color: 'red' },
      { from: 24.1, to: 25, color: 'yellow' },
      { from: 25, to: 30, color: 'green' },
      { from: 30, to: 32, color: 'yellow' },
      { from: 32, to: 34, color: 'red' },
    ],
    // One bus: both sides show it.
    read: (r) => r.busVolts,
  },
  {
    label: 'AMPS',
    unit: 'A',
    min: 0,
    max: 80,
    arcs: [{ from: 0, to: 60, color: 'green' }, { from: 60, to: 70, color: 'yellow' }, { from: 70, to: 80, color: 'red' }],
    read: (r, engine) => r.alternatorAmps[engine] ?? 0,
  },
];

const FADEC_ROW_X = { battery: 40, lAlt: 92, rAlt: 122, lPump: 176, rPump: 206, lights: 268 };

export const FADEC_TESTBED_PANEL: PanelDef = {
  id: 'fadec-testbed',
  size: { w: 2080, h: 800 },
  gauges: [
    ...sixPackGauges(COLS, ROWS, FADEC_ASI),
    { kind: 'cdi', id: 'cdi1', at: [867, ROWS[0]], receiver: 'nav1', fixedCourseDeg: 70 },
    { kind: 'clock', id: 'clock', at: [100, 150] },
    { kind: 'engineDisplay', id: 'engines', bounds: { x: STACK_X, y: 34, w: 320, h: 330 }, engines: 2, rows: FADEC_ROWS },
    { kind: 'gearLights', id: 'gear', bounds: { x: 600, y: 450, w: 120, h: 150 }, lever: [770, 525] },
    { kind: 'guardedKnob', id: 'gearEmergency', at: [860, 490], label: 'EMERGENCY GEAR', action: GEAR_EMERGENCY },
    // Flaps UP / APP 20 deg / LDG 42 deg: green, white, white; two lit while the flaps travel.
    {
      kind: 'flapLights',
      id: 'flaps',
      bounds: { x: 1100, y: 380, w: 100, h: 110 },
      positions: ['UP', 'APP', 'LDG'],
      colors: ['green', 'white', 'white'],
      degrees: [0, 20, 42],
      lever: [1010, 435],
    },
    { kind: 'trimBar', id: 'elevatorTrim', bounds: { x: 1220, y: 380, w: 60, h: 200 }, axis: 'elevator' },
    { kind: 'trimBar', id: 'rudderTrim', bounds: { x: 980, y: 530, w: 220, h: 56 }, axis: 'rudder' },
  ],
  annunciator: {
    bounds: { x: 316, y: 4, w: 366, h: 52 },
    lamps: [
      { id: 'leftAlternator', text: 'L ALTN FAIL', color: '#ffb21e', lit: (r) => r.lamps.leftAlternator },
      { id: 'lowVolts', text: 'LOW VOLTS', color: '#ff3b2a', lit: (r) => r.lamps.lowVolts },
      { id: 'rightAlternator', text: 'R ALTN FAIL', color: '#ffb21e', lit: (r) => r.lamps.rightAlternator },
    ],
  },
  switchRow: {
    bounds: ROW_BOUNDS,
    ...ROCKER,
    switches: [
      plain('battery', 'ELECT', 'Electric master', FADEC_ROW_X.battery, (c) => c.masterBattery, (c) => { c.masterBattery = !c.masterBattery; }),
      engineSwitch('leftAlternator', 'L', 'Left alternator', FADEC_ROW_X.lAlt, 'alternator', 0, { group: 'alternators' }),
      engineSwitch('rightAlternator', 'R', 'Right alternator', FADEC_ROW_X.rAlt, 'alternator', 1, { group: 'alternators' }),
      engineSwitch('leftFuelPump', 'L', 'Left fuel pump', FADEC_ROW_X.lPump, 'fuelPump', 0, { group: 'pumps' }),
      engineSwitch('rightFuelPump', 'R', 'Right fuel pump', FADEC_ROW_X.rPump, 'fuelPump', 1, { group: 'pumps' }),
      ...commonSwitches(FADEC_ROW_X.lights),
    ],
    legends: [
      { text: 'ALTERNATOR', x: (FADEC_ROW_X.lAlt + FADEC_ROW_X.rAlt) / 2, y: ROCKER.rockerTop - 24, size: 7.5 },
      { text: 'FUEL PUMP', x: (FADEC_ROW_X.lPump + FADEC_ROW_X.rPump) / 2, y: ROCKER.rockerTop - 24, size: 7.5 },
      ...rowLegends(FADEC_ROW_X.lights + 63),
    ],
    dimmers: DIMMERS,
  },
  // ENGINE MASTER L, the START key, ENGINE MASTER R.
  ignition: { kind: 'engineMaster', at: [300, 540], engines: 2 },
  background: {
    seamsX: [STACK_X - 16, 1292],
    bushings: [],
    placards: [{ x: 1700, y: 70, lines: ['MINIMUM CONTROL SPEED 76 KIAS', 'ONE ENGINE INOPERATIVE CLIMB 85 KIAS'], size: 8 }],
  },
  keepOut: [YOKE, { x: 1960, y: 300, r: 58 }],
  apertures: APERTURES,
  regions: { sixpack: { x: COLS[0] - 92, y: ROWS[0] - 92, w: 3 * 184, h: 2 * 188 }, engine: { x: STACK_X, y: 34, w: 320, h: 330 } },
  spots: { asi: { x: COLS[0], y: ROWS[0], r: BIG } },
};

const FADEC_BUS_DEAD_VOLTS = 18;

export const FADEC_TESTBED_SYSTEMS: InstrumentSystemsDef = {
  engines: 2,
  // No vacuum system: the gyros are electric.
  vacuum: null,
  gyroDrive: { attitude: 'electric', heading: 'electric' },
  // Jet A-1 at 0.80 kg/L.
  fuel: { kgPerGal: 0.8 * 3.785411784, tanks: [(s) => s.fuel.left, (s) => s.fuel.right] },
  busDeadVolts: FADEC_BUS_DEAD_VOLTS,
  tachHourRpm: 2100,
  // The cockpit rpm of the geared engine is the propeller's (crank rpm = propeller rpm x 1.69).
  tachShaft: 'propeller',
  lamps: [
    { id: 'leftAlternator', lit: (i) => powered(i, FADEC_BUS_DEAD_VOLTS) && (i.state.electrical.alternators[0] ?? 0) < 1 },
    { id: 'rightAlternator', lit: (i) => powered(i, FADEC_BUS_DEAD_VOLTS) && (i.state.electrical.alternators[1] ?? 0) < 1 },
    { id: 'lowVolts', lit: (i) => powered(i, FADEC_BUS_DEAD_VOLTS) && i.state.electrical.busVoltage < 24.1 },
  ],
};
