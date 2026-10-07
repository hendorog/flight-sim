// Cessna 172S: the instrument panel as data (gauges and their markings, switch row, magneto key, artwork,
// highlight spots) and what the instrument systems behind it need (vacuum, fuel gauging, annunciator
// thresholds). CLOSURES.
//
// Positions come from instruments/layout.ts (PANEL_LAYOUT, a pure module). The numbers and the lettering of
// the panel are written HERE: the instruments module is built from these objects, and its C172-named constants
// (KG_PER_GAL, BUS_DEAD_VOLTS, vacuumSuction, PANEL_PLACARDS, ENGINE_CLUSTER, ROCKER_LABELS, ...) are members
// of them under their old names. The markings of the airspeed indicator, the tachometer, the suction gauge and
// the ammeter and the annunciator lamps are exported by name and carried by the gauges of C172S_PANEL.

import { C172 } from '../../core/c172';
import { PANEL_HEIGHT, PANEL_LAYOUT, PANEL_WIDTH, type RockerKey } from '../../instruments/layout';
import type {
  AsiMarkings,
  GaugeDef,
  InstrumentSystemsDef,
  LampDef,
  LampInputs,
  PanelDef,
  ScaleDef,
  SwitchDef,
  TachMarkings,
} from '../types';

const L = PANEL_LAYOUT;
const SW = L.switches;
const ROW = L.switchRow;
const [c0, c1, c2] = L.sixPack.cols;
const [r0, r1] = L.sixPack.rows;
const poh = C172.poh;

// ---------------------------------------------------------------------------------------------------
// Gauge markings (POH section 2)

/**
 * Airspeed indicator, KIAS. The dial is non-linear (the diaphragm responds to V^2 and the linkage expands the
 * low end); table read off a Cessna 172S indicator: 40 kt at about 1 o'clock, 200 kt near 11 o'clock.
 * Operating arcs: green 48-129 = normal (Vs1 to Vno), yellow 129-163 = caution, white 40-85 = flap operating
 * range (Vs0 to Vfe), red line 163 = Vne.
 */
export const C172S_ASI_MARKS: AsiMarkings = {
  scaleKt: [0, 40, 60, 80, 100, 120, 140, 160, 180, 200, 215],
  scaleDeg: [0, 30, 74, 118, 158, 196, 233, 268, 300, 330, 348],
  tickFrom: 40,
  tickTo: 200,
  minorStep: 5,
  numberStep: 20,
  arcs: [
    { from: 48, to: poh.vnoKias, color: 'green' },
    { from: poh.vnoKias, to: poh.vneKias, color: 'yellow' },
    { from: 40, to: poh.vfeKias, color: 'white', inner: true },
  ],
  redLine: poh.vneKias,
};

/** One hour at this rpm (a typical cruise) records one tach hour. */
const TACH_HOUR_RPM = 2400;

/** Tachometer: 0-3500 rpm; green arc 2100-2700 rpm, red line 2700 (rated). */
export const C172S_TACH_MARKS: TachMarkings = {
  max: 3500,
  majorStep: 500,
  minorStep: 100,
  numberStep: 500,
  arcs: [{ from: 2100, to: 2700, color: 'green' }],
  redLine: 2700,
  hourRpm: TACH_HOUR_RPM,
};

/** Suction gauge: 3-7 inHg, green 4.5-5.5. The pointer rests on its stop below 3. */
export const C172S_SUCTION_SCALE: ScaleDef = {
  label: '',
  min: 2.6,
  max: 7,
  majors: [3, 4, 5, 6, 7],
  minorStep: 0.5,
  arcs: [{ from: 4.5, to: 5.5, color: 'green' }],
  read: (r) => r.suctionInHg,
};

/** Battery ammeter, centre zero, +/-60 A. */
export const C172S_AMMETER_SCALE: ScaleDef = {
  label: '',
  min: -60,
  max: 60,
  majors: [-60, -30, 0, 30, 60],
  minorStep: 10,
  read: (r) => r.ammeterAmps,
};

/** One side of the FUEL QTY gauge. */
const fuelScale = (label: string, read: ScaleDef['read']): ScaleDef => ({
  label,
  min: 0,
  max: 26,
  majors: [0, 5, 10, 15, 20, 26],
  minorStep: 2.5,
  arcs: [{ from: 0, to: 1.5, color: 'red' }],
  read,
});

// The three 2-1/4" dual gauges of the engine cluster.
const FUEL_QTY: GaugeDef = {
  kind: 'dual',
  id: 'fuel',
  at: [L.engineRow.fuel, L.engineRow.y],
  seed: 201,
  title: ['FUEL QTY', 'U.S. GAL'],
  left: fuelScale('L', (r) => r.fuelLeftGal),
  right: fuelScale('R', (r) => r.fuelRightGal),
};
const OIL: GaugeDef = {
  kind: 'dual',
  id: 'oil',
  at: [L.engineRow.oil, L.engineRow.y],
  seed: 202,
  title: ['OIL', 'TEMP  PRESS'],
  left: {
    label: '°F',
    min: 75,
    max: 250,
    majors: [100, 150, 200, 245],
    minorStep: 25,
    arcs: [{ from: 100, to: 245, color: 'green' }],
    redLines: [245],
    read: (r) => r.oilTempF,
  },
  right: {
    label: 'PSI',
    min: 0,
    max: 115,
    majors: [0, 20, 50, 90, 115],
    minorStep: 10,
    arcs: [
      { from: 20, to: 50, color: 'yellow' },
      { from: 50, to: 90, color: 'green' },
      { from: 90, to: 115, color: 'yellow' },
    ],
    redLines: [20, 115],
    read: (r) => r.oilPressurePsi,
  },
};
const EGT_FUEL_FLOW: GaugeDef = {
  kind: 'dual',
  id: 'egtff',
  at: [L.engineRow.egt, L.engineRow.y],
  seed: 203,
  title: ['EGT / FUEL FLOW', 'GPH'],
  // EGT: unnumbered scale in 25 deg F divisions (the pilot leans relative to peak).
  left: { label: 'EGT', min: 1100, max: 1700, majors: [1100, 1400, 1700], minorStep: 50, read: (r) => r.egtF },
  right: {
    label: '',
    min: 0,
    max: 19,
    majors: [0, 5, 10, 15],
    minorStep: 1,
    numbers: true,
    arcs: [{ from: 0, to: 12, color: 'green' }],
    read: (r) => r.fuelFlowGph,
  },
};

const AMBER = '#ffb21e';
const RED = '#ff3b2a';

/** The annunciator strip, left to right: amber cautions, red warnings. */
export const C172S_ANNUNCIATOR_LAMPS: readonly LampDef[] = [
  { id: 'lowFuelLeft', text: 'L LOW FUEL', color: AMBER, lit: (r) => r.annunciators.lowFuelLeft },
  { id: 'oilPress', text: 'OIL PRESS', color: RED, lit: (r) => r.annunciators.oilPress },
  { id: 'vacuum', text: 'LOW VAC', color: AMBER, lit: (r) => r.annunciators.vacuum },
  { id: 'lowVolts', text: 'LOW VOLTS', color: RED, lit: (r) => r.annunciators.lowVolts },
  { id: 'lowFuelRight', text: 'LOW FUEL R', color: AMBER, lit: (r) => r.annunciators.lowFuelRight },
];

// ---------------------------------------------------------------------------------------------------
// Switch row

/** The legend above each rocker of PANEL_LAYOUT.switchRow. */
const ROCKER_LABELS: Record<RockerKey, string> = {
  alt: 'ALT',
  bat: 'BAT',
  fuelPump: 'FUEL PUMP',
  beacon: 'BEACON',
  landing: 'LAND',
  taxi: 'TAXI',
  nav: 'NAV',
  strobe: 'STROBE',
  avionics: 'AVIONICS',
  pitotHeat: 'PITOT HEAT',
};

/**
 * A rocker of PANEL_LAYOUT.switchRow. `id` is also the id of its click hotspot (instruments/hotspots.ts) and
 * `name` that hotspot's tooltip. `label` is the legend the row letters above the rocker; the split MASTER pair
 * has none of its own (the row's `legends` letter it, smaller).
 */
const rocker = (key: RockerKey, id: string, name: string, group: string | undefined, on: SwitchDef['on'], toggle: SwitchDef['toggle']): SwitchDef => {
  const r = ROW.rockers.find((k) => k.key === key)!;
  const master = group === 'master';
  return {
    id,
    label: master ? '' : ROCKER_LABELS[key],
    name,
    x: r.x,
    ...('red' in r && { red: r.red }),
    ...(group !== undefined && { group }),
    on,
    toggle,
  };
};

// ---------------------------------------------------------------------------------------------------
// Artwork

/** Avionics rack units are 320 px wide (render/avionics.ts); their heights are repeated from there. */
const rack = (y: number, h: number): { x: number; y: number; w: number; h: number } => ({ x: L.stack.x, y, w: 320, h });

/** Left edge of the right sub-panel's placards. */
const RIGHT_PANEL_X = 1440;

// Ring radii of the highlight spots: a little outside the glass of a 3-1/8" and of a 2-1/4" instrument.
const BIG = L.apertures.sixPack * 1.1;
const SMALL = L.apertures.small * 1.15;

export const C172S_PANEL: PanelDef = {
  id: 'c172s',
  size: { w: PANEL_WIDTH, h: PANEL_HEIGHT },
  // In the order the panel draws them.
  gauges: [
    { kind: 'asi', id: 'asi', at: [c0, r0], marks: C172S_ASI_MARKS },
    { kind: 'attitude', id: 'attitude', at: [c1, r0] },
    { kind: 'altimeter', id: 'altimeter', at: [c2, r0] },
    { kind: 'turn', id: 'turn', at: [c0, r1] },
    { kind: 'heading', id: 'heading', at: [c1, r1] },
    { kind: 'vsi', id: 'vsi', at: [c2, r1] },
    // The course on the card of a CDI whose receiver has no OBS input: runway 07 and its reciprocal.
    { kind: 'cdi', id: 'cdi1', at: [L.cdi.x, L.cdi.rows[0]], receiver: 'nav1', fixedCourseDeg: 70 },
    { kind: 'cdi', id: 'cdi2', at: [L.cdi.x, L.cdi.rows[1]], receiver: 'nav2', fixedCourseDeg: 250 },
    { kind: 'clock', id: 'clock', at: [L.leftColumn.x, L.leftColumn.clock] },
    { kind: 'suction', id: 'suction', at: [L.leftColumn.x, L.leftColumn.suction], scale: C172S_SUCTION_SCALE },
    { kind: 'ammeter', id: 'ammeter', at: [L.leftColumn.x, L.leftColumn.ammeter], scale: C172S_AMMETER_SCALE },
    { kind: 'tach', id: 'tach', at: [L.engineRow.tach, L.engineRow.y], size: 'large', marks: C172S_TACH_MARKS },
    FUEL_QTY,
    OIL,
    EGT_FUEL_FLOW,
    // Flap deflection at the bottom of the position scale, degrees, and the legends of the detents down the scale.
    { kind: 'flapLever', id: 'flaps', bounds: L.flaps, maxDeg: 30, legends: ['0°', '10°', '20°', 'FULL'] },
    { kind: 'gps', id: 'gps', bounds: rack(L.stack.gps, 236) },
    { kind: 'navcom', id: 'navcom2', bounds: rack(L.stack.navcom, 76) },
    { kind: 'xpdr', id: 'xpdr', bounds: rack(L.stack.xpdr, 60) },
  ],
  annunciator: { bounds: L.annunciator, lamps: C172S_ANNUNCIATOR_LAMPS },
  switchRow: {
    bounds: SW,
    rockerTop: ROW.rockerTop,
    rockerW: ROW.rockerW,
    rockerH: ROW.rockerH,
    switches: [
      rocker('alt', 'alternator', 'Master ALT', 'master', (c) => c.alternator, (c) => { c.alternator = !c.alternator; }),
      rocker('bat', 'battery', 'Master BAT', 'master', (c) => c.masterBattery, (c) => { c.masterBattery = !c.masterBattery; }),
      rocker('fuelPump', 'fuelPump', 'Fuel pump', undefined, (c) => c.fuelPump, (c) => { c.fuelPump = !c.fuelPump; }),
      rocker('beacon', 'beacon', 'Beacon', 'lights', (c) => c.lights.beacon, (c) => { c.lights.beacon = !c.lights.beacon; }),
      rocker('landing', 'landing', 'Landing light', 'lights', (c) => c.lights.landing, (c) => { c.lights.landing = !c.lights.landing; }),
      rocker('taxi', 'taxi', 'Taxi light', 'lights', (c) => c.lights.taxi, (c) => { c.lights.taxi = !c.lights.taxi; }),
      rocker('nav', 'nav', 'Nav lights', 'lights', (c) => c.lights.nav, (c) => { c.lights.nav = !c.lights.nav; }),
      rocker('strobe', 'strobe', 'Strobes', 'lights', (c) => c.lights.strobe, (c) => { c.lights.strobe = !c.lights.strobe; }),
      rocker('avionics', 'avionics', 'Avionics master', undefined, (c) => c.avionics, (c) => { c.avionics = !c.avionics; }),
      rocker('pitotHeat', 'pitotHeat', 'Pitot heat', undefined, (c) => c.pitotHeat, (c) => { c.pitotHeat = !c.pitotHeat; }),
    ],
    // Local px of the row: the MASTER pair, the tab of the bracket over the light switches, the dimmers.
    legends: [
      { text: 'MASTER', x: 150.5, y: ROW.rockerTop - 24, size: 8.5 },
      { text: ROCKER_LABELS.alt, x: 138, y: ROW.rockerTop - 12, size: 8 },
      { text: ROCKER_LABELS.bat, x: 163, y: ROW.rockerTop - 12, size: 8 },
      { text: 'LIGHTS', x: 364, y: ROW.rockerTop - 24, size: 8.5 },
      { text: 'PANEL', x: ROW.dimmers.panel, y: ROW.rockerTop - 12, size: 8 },
      { text: 'RADIO', x: ROW.dimmers.radio, y: ROW.rockerTop - 12, size: 8 },
      { text: 'BRT', x: 680, y: ROW.rockerTop + 8, size: 6.5 },
    ],
    dimmers: ROW.dimmers,
  },
  // Panel px, where the click hotspot and the 3D key are.
  ignition: { kind: 'key', at: [SW.x + ROW.magneto.x, SW.y + ROW.magneto.y] },
  background: {
    // Sub-panel seams: pilot panel | centre stack | right panel.
    seamsX: [L.stack.x - 16, L.rightSeamX],
    // Legend and sub-legend under the throttle and mixture bushings.
    bushings: [
      { at: L.throttle, text: 'THROTTLE', sub: 'PUSH OPEN' },
      { at: L.mixture, text: 'MIXTURE', sub: 'PUSH RICH' },
    ],
    // Placards of the right sub-panel: centre x and top y; lines; lettering size where not the default.
    placards: [
      {
        x: RIGHT_PANEL_X + 190,
        y: 70,
        lines: [
          'THIS AIRPLANE MUST BE OPERATED AS A NORMAL OR UTILITY CATEGORY AIRPLANE',
          'IN COMPLIANCE WITH THE OPERATING LIMITATIONS AS STATED IN THE FORM OF',
          'PLACARDS, MARKINGS AND MANUALS.  NO ACROBATIC MANEUVERS INCLUDING SPINS',
          'APPROVED IN NORMAL CATEGORY.  FLIGHT INTO KNOWN ICING PROHIBITED.',
        ],
      },
      { x: RIGHT_PANEL_X + 90, y: 150, lines: ['MANEUVERING SPEED', '105 KIAS'], size: 8 },
      { x: RIGHT_PANEL_X + 290, y: 150, lines: ['FUEL 100LL / 100 MIN. GRADE', '53 U.S. GAL USABLE'], size: 8 },
    ],
    // Circuit breakers, row by row: legend and rating, A.
    breakers: {
      bounds: L.circuitBreakers,
      names: ['FLAP', 'INST', 'AVN FAN', 'TURN CORD', 'NAV 1', 'COM 1', 'GPS', 'XPDR', 'ALT FLD', 'NAV 2', 'COM 2', 'AUDIO', 'PITOT HT', 'LAND LT', 'TAXI LT', 'NAV LT', 'STROBE', 'BCN'],
      amps: [10, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 10, 15, 10, 5, 5, 5],
      perRow: 9,
    },
    glovebox: { x: 1640, y: 420, w: 390, h: 240 },
    // Rack rails of the centre stack and the blanking plate under the transponder.
    rack: {
      rails: { x: L.stack.x - 4, y: L.stack.gps - 6, w: 328, h: L.stack.blank + 66 - L.stack.gps },
      blanks: [{ x: L.stack.x, y: L.stack.blank, w: 320, h: 58 }],
    },
  },
  // The yoke column boots.
  keepOut: L.yokes.xs.map((x) => ({ x, y: L.yokes.y, r: L.yokes.r })),
  apertures: { large: L.apertures.sixPack, small: L.apertures.small },
  // The instrument groups of InstrumentPanel.drawTo().
  regions: {
    sixpack: { x: L.sixPack.cols[0] - 92, y: L.sixPack.rows[0] - 92, w: 3 * 184, h: 2 * 188 },
    engine: {
      x: L.engineRow.fuel - 66,
      y: L.engineRow.y - 92,
      w: L.engineRow.egt + 66 - (L.engineRow.fuel - 66),
      h: 184,
    },
    stack: { x: L.stack.x, y: L.stack.gps, w: 320, h: L.stack.blank - L.stack.gps },
  },
  // Ring centre and radius of each instrument a lesson can name (training/types.ts InstrumentId); the same
  // values as INSTRUMENT_SPOTS of ui/school/highlight.ts.
  spots: {
    asi: { x: c0, y: r0, r: BIG },
    ai: { x: c1, y: r0, r: BIG },
    alt: { x: c2, y: r0, r: BIG },
    tc: { x: c0, y: r1, r: BIG },
    // The slip ball sits in the lower part of the turn coordinator.
    ball: { x: c0, y: r1 + L.apertures.sixPack * 0.45, r: L.apertures.sixPack * 0.42 },
    dg: { x: c1, y: r1, r: BIG },
    vsi: { x: c2, y: r1, r: BIG },
    tach: { x: L.engineRow.tach, y: L.engineRow.y, r: BIG },
    fuel: { x: L.engineRow.fuel, y: L.engineRow.y, r: SMALL },
    oil: { x: L.engineRow.oil, y: L.engineRow.y, r: SMALL },
    flaps: { x: L.flaps.x + L.flaps.w / 2, y: L.flaps.y + L.flaps.h / 2, r: L.flaps.h / 2 },
  },
};

// ---------------------------------------------------------------------------------------------------
// Instrument systems

/** 100LL avgas, kg per US gallon (6.0 lb/gal). */
const KG_PER_GAL = 2.7216;
/** DC bus voltage below which electric gauges and lamps are dead. */
const BUS_DEAD_VOLTS = 18;
/** Regulated suction in the green arc (POH 4.5 - 5.5 inHg); the regulator is set to 5.0. */
const SUCTION_REGULATED_INHG = 5.0;
/** Suction at which an air-driven gyro reaches rated speed (bottom of the green arc). */
const SUCTION_RATED_INHG = 4.5;

/**
 * Annunciator thresholds (POH section 7): LOW FUEL below 5 gal usable in a tank, OIL PRESS below 20 psi,
 * LOW VOLTS below 24.5 V, VAC below 3.0 inHg.
 */
export const C172S_ANNUNCIATOR_THRESHOLDS = { lowFuelGal: 5, oilPressurePsi: 20, lowVolts: 24.5, vacuumInHg: 3.0 };
const LOW = C172S_ANNUNCIATOR_THRESHOLDS;

/** The annunciator lamps need bus power. */
const powered = (i: LampInputs): boolean => i.state.electrical.busVoltage > BUS_DEAD_VOLTS;

export const C172S_INSTRUMENT_SYSTEMS: InstrumentSystemsDef = {
  engines: 1,
  // One engine-driven dry pump; attitude and heading gyros are air-driven (the turn coordinator is electric).
  vacuum: {
    engines: [0],
    regulatedInHg: SUCTION_REGULATED_INHG,
    ratedInHg: SUCTION_RATED_INHG,
    // Dry vacuum pump on the accessory drive. Pump capacity rises roughly with shaft speed; the regulator
    // relief valve caps the suction. The fit gives ~3.8 inHg at a 600 rpm idle, the rated 4.5 inHg at ~850 rpm
    // and full regulated suction above ~1300 rpm, which matches the usual "check suction at 1800 rpm run-up".
    suction: (engineRpm) => {
      if (engineRpm <= 0) return 0;
      return Math.min(SUCTION_REGULATED_INHG, 5.4 * (1 - Math.exp(-engineRpm / 470)));
    },
  },
  gyroDrive: { attitude: 'vacuum', heading: 'vacuum' },
  // Two wing tanks, one gauge each: the legacy pair of the state.
  fuel: { kgPerGal: KG_PER_GAL, tanks: [(s) => s.fuel.left, (s) => s.fuel.right] },
  busDeadVolts: BUS_DEAD_VOLTS,
  tachHourRpm: TACH_HOUR_RPM,
  // The ids are the members of Annunciators (dynamics/engineSystems.ts).
  lamps: [
    { id: 'lowFuelLeft', lit: (i) => powered(i) && i.fuelGal[0] < LOW.lowFuelGal },
    { id: 'lowFuelRight', lit: (i) => powered(i) && i.fuelGal[1] < LOW.lowFuelGal },
    { id: 'oilPress', lit: (i) => powered(i) && i.state.engine.oilPressure < LOW.oilPressurePsi },
    { id: 'lowVolts', lit: (i) => powered(i) && i.state.electrical.busVoltage < LOW.lowVolts },
    { id: 'vacuum', lit: (i) => powered(i) && i.suctionInHg < LOW.vacuumInHg },
  ],
};
