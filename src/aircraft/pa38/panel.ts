// Piper PA-38-112 Tomahawk II: the instrument panel as data (gauges and their markings, switch row, magneto key,
// artwork, highlight spots) and what the instrument systems behind it need. CLOSURES.
//
// Arrangement from the type's engineering data sheet (aircraft-data/pa38.md in the design work folder, s.9
// "Cockpit layout", POH fig 7-13; "s.N" below is its section N), as close as the panel components allow: the six
// flight instruments in front of the left seat with the clock and the suction gauge in a column left of them, the
// red ALT warning light at the top between the attitude indicator and the altimeter, NAV 1 and NAV 2 to their
// right; the radio stack in the centre, the placards on the right. On the lower panel, left to right: the split
// MASTER and the magneto key under the left control wheel, the rocker row (electric fuel pump, lights, pitot
// heat), the tachometer left of the throttle quadrant, the two fuel gauges over the quadrant either side of its
// selector, the engine cluster right of it (fuel pressure and the alternator load meter, oil temperature and
// pressure), the cabin heat and defrost knobs and the circuit breakers on the lower right. There is no flap
// indicator (the flap lever is on the floor between the seats), no EGT, no fuel flow and no manifold pressure.
//
// The face shown in the cockpit is the left 2000 px of the 2080 x 800 canvas at 2000 px/m (visual.ts: a panel
// 1.00 m wide and 0.40 m high), so the instruments are drawn at the C172S's scale, their real size.

import { singleGauge, type EngineDial } from '../../instruments/panels/gauges';
import type { AsiMarkings, GaugeDef, InstrumentSystemsDef, LampDef, LampInputs, PanelDef, Rect, ScaleDef, SwitchDef, TachMarkings } from '../types';
import { PA38_REFERENCE } from './reference';

const V = PA38_REFERENCE;

/** The part of the 2080 x 800 canvas the panel face shows (visual.ts CockpitDef.panel.pxRect): 1.00 m at 2000 px/m. */
export const PA38_PANEL_PX_RECT: Rect = { x: 0, y: 0, w: 2000, h: 800 };
/** Canvas px per metre of the face, and the px column of the aircraft's centreline. */
export const PA38_PANEL_PX_PER_M = 2000;
export const PA38_PANEL_CENTRE_PX = PA38_PANEL_PX_RECT.x + PA38_PANEL_PX_RECT.w / 2;

// ---------------------------------------------------------------------------------------------------
// Layout, canvas px. Left seat on y = -0.27 m (px 460), right seat on +0.27 m (px 1540).

const COLS = [276, 460, 644] as const;
const ROWS = [175, 361] as const;
/** Clock and suction gauge, left of the airspeed indicator. */
const LEFT_COLUMN = { x: 92, clock: 140, suction: 282 };
/** NAV 1 over NAV 2, right of the six-pack. */
const CDI = { x: 828, y: ROWS };
/** Radio stack: rack units are 320 px wide (render/avionics.ts); the heights are repeated from there. */
const STACK = { x: 940, navcom1: 36, navcom2: 120, xpdr: 204, blank: 270 };
/** Control wheel shafts through the panel (3D boots; visual.ts puts the yokes here). */
const YOKES = { y: 545, xs: [460, 1540] as const, r: 58 };
/** Tachometer, left of the quadrant (s.9). */
const TACH = { x: 728, y: 572 };
/**
 * The throttle quadrant in front of the lower centre of the face (visual.ts builds it from these px): its body
 * covers x0 .. x1 from y0 down past the panel's lower edge. Nothing is painted there.
 */
export const PA38_QUADRANT = { x0: 850, x1: 1150, y0: 592 } as const;
/** The two fuel gauges over the quadrant, either side of the selector (s.9). */
const FUEL = { y: 525, left: 925, right: 1075 };
/** Engine cluster right of the quadrant: fuel pressure and load meter, oil temperature and pressure (s.9). */
const CLUSTER = { y: 600, fuel: 1240, oil: 1376 };
const SWITCHES: Rect = { x: 190, y: 676, w: 640, h: 116 };
const ROW = {
  rockerTop: 44,
  rockerW: 24,
  rockerH: 42,
  magneto: { x: 190, y: 72 },
};
const APERTURES = { large: 74, small: 51 };

/** The 3D parts that stand on the panel, in px, for visual.ts (yoke columns, quadrant). */
export const PA38_PANEL_PARTS = { yokes: YOKES, quadrant: PA38_QUADRANT } as const;

// ---------------------------------------------------------------------------------------------------
// Markings (POH section 2, s.4 and s.7: the Tomahawk II, both pairs of flow strips)

/**
 * Airspeed indicator, KIAS (POH 2.5): white arc 49-89 (Vs0 to Vfe), green 52-110 (Vs1 to Vno), yellow 110-138,
 * red line 138 (Vne). A 40-160 kt dial, the low end expanded.
 */
export const PA38_ASI_MARKS: AsiMarkings = {
  scaleKt: [0, 30, 40, 60, 80, 100, 120, 140, 160, 170],
  scaleDeg: [0, 22, 40, 92, 142, 190, 236, 280, 320, 336],
  tickFrom: 40,
  tickTo: 160,
  minorStep: 5,
  numberStep: 20,
  arcs: [
    { from: V.vs1, to: V.vno, color: 'green' },
    { from: V.vno, to: V.vne, color: 'yellow' },
    { from: V.vs0, to: V.vfe[V.vfe.length - 1], color: 'white', inner: true },
  ],
  redLine: V.vne,
};

/** One hour at this rpm records one tach hour: the 75 % power setting at sea level (s.4). */
const TACH_HOUR_RPM = 2400;
/** Rated (and maximum) engine speed of the installation, rpm (POH 2.7: 112 hp at 2600 rpm, all operations). */
const RATED_RPM = 2600;

/** Recording tachometer: 0-3500 rpm, green arc 500-2600, red line 2600 (POH 2.9, s.4). */
export const PA38_TACH_MARKS: TachMarkings = {
  max: 3500,
  majorStep: 500,
  minorStep: 100,
  numberStep: 500,
  arcs: [{ from: 500, to: RATED_RPM, color: 'green' }],
  redLine: RATED_RPM,
  hourRpm: TACH_HOUR_RPM,
};

/** Suction gauge: the regulator is set to 5.0 +/- 0.1 inHg (s.9); green 4.8-5.2. The pointer rests on its stop below 3. */
export const PA38_SUCTION_SCALE: ScaleDef = {
  label: '',
  min: 2.6,
  max: 7,
  majors: [3, 4, 5, 6, 7],
  minorStep: 0.5,
  arcs: [{ from: 4.8, to: 5.2, color: 'green' }],
  read: (r) => r.suctionInHg,
};

/** A fuel quantity gauge beside the selector: a 16 US gal tank, 15 gal usable (s.6, s.9). */
const fuelDial = (seed: number, title: string): EngineDial => ({
  size: 'small',
  seed,
  fromDeg: -60,
  toDeg: 60,
  title,
  units: 'U.S. GAL',
  labels: [0, 8, 16],
  scale: { label: '', min: 0, max: 16, majors: [0, 4, 8, 12, 16], minorStep: 2, arcs: [{ from: 0, to: 1, color: 'red' }] },
});

/**
 * Fuel pressure green 0.5-8 psi, red lines 0.5 and 8 (POH 2.9); the load meter of the 60 A alternator, 0-60 A
 * (s.9: it shows the alternator's output, not the battery's charge).
 */
const FUEL_PRESS_AMPS: GaugeDef = {
  kind: 'dual',
  id: 'fuelPressAmps',
  at: [CLUSTER.fuel, CLUSTER.y],
  seed: 381,
  title: ['FUEL PRESS', 'AMPS'],
  left: {
    label: 'PSI',
    min: 0,
    max: 10,
    majors: [0, 2, 4, 6, 8, 10],
    minorStep: 1,
    arcs: [{ from: 0.5, to: 8, color: 'green' }],
    redLines: [0.5, 8],
    read: (r) => r.engines[0]?.fuelPressurePsi ?? 0,
  },
  right: {
    label: 'A',
    min: 0,
    max: 60,
    majors: [0, 20, 40, 60],
    minorStep: 10,
    read: (r) => r.alternatorAmps[0] ?? 0,
  },
};
/** Oil temperature green 75-245 F, red line 245; oil pressure green 60-90, yellow 15-60 and 90-100, red lines 15 and 100 psi (POH 2.9). */
const OIL: GaugeDef = {
  kind: 'dual',
  id: 'oil',
  at: [CLUSTER.oil, CLUSTER.y],
  seed: 382,
  title: ['OIL', 'TEMP  PRESS'],
  left: {
    label: '°F',
    min: 60,
    max: 260,
    majors: [75, 150, 245],
    minorStep: 25,
    arcs: [{ from: 75, to: 245, color: 'green' }],
    redLines: [245],
    read: (r) => r.oilTempF,
  },
  right: {
    label: 'PSI',
    min: 0,
    max: 115,
    majors: [0, 15, 60, 90, 115],
    minorStep: 5,
    arcs: [
      { from: 15, to: 60, color: 'yellow' },
      { from: 60, to: 90, color: 'green' },
      { from: 90, to: 100, color: 'yellow' },
    ],
    redLines: [15, 100],
    read: (r) => r.oilPressurePsi,
  },
};

const RED = '#ff3b2a';

/** The one warning light, at the top between the attitude indicator and the altimeter (s.9): no alternator output. */
export const PA38_ANNUNCIATOR_LAMPS: readonly LampDef[] = [{ id: 'alt', text: 'ALT', color: RED, lit: (r) => r.lamps.alt }];

// ---------------------------------------------------------------------------------------------------
// Switch row: the split MASTER (ALT left half, BAT right half, s.9), the magneto key, the white rockers (up = ON)
// of the electric fuel pump, the lights and the pitot heat. The two light rheostats are right of the quadrant
// (s.9), not in the row: they are not drawn.

const rocker = (id: string, label: string, name: string, x: number, on: SwitchDef['on'], toggle: SwitchDef['toggle'], more: Pick<SwitchDef, 'red' | 'group'> = {}): SwitchDef => ({
  id,
  label,
  name,
  x,
  ...more,
  on,
  toggle,
});

const RX = { alt: 40, bat: 65, fuelPump: 290, nav: 350, landing: 390, taxi: 430, strobe: 470, beacon: 510, pitotHeat: 575 };

// ---------------------------------------------------------------------------------------------------

// Ring radii of the highlight spots: a little outside the glass of a 3-1/8" and of a 2-1/4" instrument.
const BIG = APERTURES.large * 1.1;
const SMALL = APERTURES.small * 1.15;

export const PA38_PANEL: PanelDef = {
  id: 'pa38',
  size: { w: 2080, h: 800 },
  // In the order the panel draws them.
  gauges: [
    { kind: 'asi', id: 'asi', at: [COLS[0], ROWS[0]], marks: PA38_ASI_MARKS },
    { kind: 'attitude', id: 'attitude', at: [COLS[1], ROWS[0]] },
    { kind: 'altimeter', id: 'altimeter', at: [COLS[2], ROWS[0]] },
    { kind: 'turn', id: 'turn', at: [COLS[0], ROWS[1]] },
    { kind: 'heading', id: 'heading', at: [COLS[1], ROWS[1]] },
    { kind: 'vsi', id: 'vsi', at: [COLS[2], ROWS[1]] },
    // NAV 1 over NAV 2 (s.9); NAV 1's course card set to runway 07 when nothing turns the OBS.
    { kind: 'cdi', id: 'cdi1', at: [CDI.x, CDI.y[0]], receiver: 'nav1', fixedCourseDeg: 70 },
    { kind: 'cdi', id: 'cdi2', at: [CDI.x, CDI.y[1]], receiver: 'nav2', fixedCourseDeg: 70 },
    { kind: 'clock', id: 'clock', at: [LEFT_COLUMN.x, LEFT_COLUMN.clock] },
    { kind: 'suction', id: 'suction', at: [LEFT_COLUMN.x, LEFT_COLUMN.suction], scale: PA38_SUCTION_SCALE },
    { kind: 'tach', id: 'tach', at: [TACH.x, TACH.y], size: 'large', marks: PA38_TACH_MARKS },
    singleGauge('fuelLeft', [FUEL.left, FUEL.y], fuelDial(383, 'FUEL L'), (r) => r.fuelLeftGal),
    singleGauge('fuelRight', [FUEL.right, FUEL.y], fuelDial(384, 'FUEL R'), (r) => r.fuelRightGal),
    FUEL_PRESS_AMPS,
    OIL,
    { kind: 'navcom', id: 'navcom1', bounds: { x: STACK.x, y: STACK.navcom1, w: 320, h: 76 } },
    { kind: 'navcom', id: 'navcom2', bounds: { x: STACK.x, y: STACK.navcom2, w: 320, h: 76 } },
    { kind: 'xpdr', id: 'xpdr', bounds: { x: STACK.x, y: STACK.xpdr, w: 320, h: 60 } },
  ],
  annunciator: { bounds: { x: (COLS[1] + COLS[2]) / 2 - 40, y: 46, w: 80, h: 34 }, lamps: PA38_ANNUNCIATOR_LAMPS },
  switchRow: {
    bounds: SWITCHES,
    rockerTop: ROW.rockerTop,
    rockerW: ROW.rockerW,
    rockerH: ROW.rockerH,
    switches: [
      rocker('alternator', '', 'Master ALT', RX.alt, (c) => c.alternator, (c) => { c.alternator = !c.alternator; }, { red: true, group: 'master' }),
      rocker('battery', '', 'Master BAT', RX.bat, (c) => c.masterBattery, (c) => { c.masterBattery = !c.masterBattery; }, { red: true, group: 'master' }),
      rocker('fuelPump', 'FUEL PUMP', 'Electric fuel pump', RX.fuelPump, (c) => c.fuelPump, (c) => { c.fuelPump = !c.fuelPump; }),
      rocker('nav', 'NAV', 'Nav lights', RX.nav, (c) => c.lights.nav, (c) => { c.lights.nav = !c.lights.nav; }, { group: 'lights' }),
      rocker('landing', 'LAND', 'Landing light', RX.landing, (c) => c.lights.landing, (c) => { c.lights.landing = !c.lights.landing; }, { group: 'lights' }),
      rocker('taxi', 'TAXI', 'Taxi light', RX.taxi, (c) => c.lights.taxi, (c) => { c.lights.taxi = !c.lights.taxi; }, { group: 'lights' }),
      rocker('strobe', 'STROBE', 'Strobes', RX.strobe, (c) => c.lights.strobe, (c) => { c.lights.strobe = !c.lights.strobe; }, { group: 'lights' }),
      rocker('beacon', 'BCN', 'Beacon', RX.beacon, (c) => c.lights.beacon, (c) => { c.lights.beacon = !c.lights.beacon; }, { group: 'lights' }),
      rocker('pitotHeat', 'PITOT HT', 'Pitot heat', RX.pitotHeat, (c) => c.pitotHeat, (c) => { c.pitotHeat = !c.pitotHeat; }),
    ],
    // Local px of the row: the MASTER pair, the tab of the bracket over the light switches.
    legends: [
      { text: 'MASTER', x: (RX.alt + RX.bat) / 2, y: ROW.rockerTop - 24, size: 8.5 },
      { text: 'ALT', x: RX.alt, y: ROW.rockerTop - 12, size: 8 },
      { text: 'BAT', x: RX.bat, y: ROW.rockerTop - 12, size: 8 },
      { text: 'LIGHTS', x: (RX.nav + RX.beacon) / 2, y: ROW.rockerTop - 24, size: 8.5 },
    ],
  },
  // Panel px, where the click hotspot and the 3D key are: under the left control wheel (s.9).
  ignition: { kind: 'key', at: [SWITCHES.x + ROW.magneto.x, SWITCHES.y + ROW.magneto.y] },
  background: {
    // Sub-panel seam: the flat full-width panel (s.12) is one sheet from the pilot's side to the radio stack, with
    // the right panel joining it between the two engine-cluster gauges (clear of the fuel gauges over the quadrant).
    seamsX: [(CLUSTER.fuel + CLUSTER.oil) / 2],
    // Legends of the controls that are painted, not built: the primer right of the quadrant, the cabin heat and
    // defrost knobs on the lower right (s.9). The parking brake handle hangs under the quadrant, below the face.
    bushings: [
      { at: [1218, 730], text: 'PRIMER', sub: 'PUSH LOCK' },
      { at: [1640, 600], text: 'CABIN HEAT', sub: 'PULL ON' },
      { at: [1780, 600], text: 'DEFROST', sub: 'PULL ON' },
    ],
    // Placards of the right panel: centre x and top y; lines; lettering size where not the default.
    placards: [
      {
        x: 1700,
        y: 40,
        lines: [
          'THIS AIRPLANE MUST BE OPERATED AS A NORMAL OR',
          'UTILITY CATEGORY AIRPLANE IN COMPLIANCE WITH THE',
          'OPERATING LIMITATIONS STATED IN THE FORM OF',
          'PLACARDS, MARKINGS AND MANUALS. UTILITY CATEGORY:',
          'SPINS APPROVED WITH FLAPS UP ONLY, NO BAGGAGE.',
          'NO ACROBATIC MANEUVERS IN NORMAL CATEGORY.',
        ],
        size: 6.5,
      },
      { x: 1700, y: 150, lines: ['MANEUVERING SPEED', `${V.va} KIAS AT 1670 LB`], size: 8 },
      { x: 1700, y: 204, lines: ['FUEL 100LL / 100 MIN. GRADE', '30 U.S. GAL USABLE'], size: 8 },
      { x: 1700, y: 258, lines: ['ELECTRIC FUEL PUMP ON FOR', 'TAKE-OFF, LANDING AND TANK CHANGES'], size: 7 },
      { x: 1700, y: 312, lines: ['FLAPS 21° AND 34°', `${V.vfe[V.vfe.length - 1]} KIAS MAX`], size: 7.5 },
    ],
    // Push-to-reset circuit breakers on the lower right (s.9): legend and rating, A.
    breakers: {
      bounds: { x: 1500, y: 682, w: 480, h: 108 },
      names: ['ALT FLD', 'ALT', 'INST', 'TURN', 'FUEL PUMP', 'STALL WARN', 'NAV LT', 'LAND LT', 'STROBE', 'PITOT HT', 'RADIO 1', 'RADIO 2'],
      amps: [5, 60, 5, 5, 5, 5, 10, 10, 10, 10, 5, 5],
      perRow: 6,
    },
    // Rack rails of the centre stack and the blanking plate under the transponder.
    rack: {
      rails: { x: STACK.x - 4, y: STACK.navcom1 - 6, w: 328, h: STACK.blank + 50 - STACK.navcom1 },
      blanks: [{ x: STACK.x, y: STACK.blank, w: 320, h: 40 }],
    },
  },
  // The control wheel shaft boots.
  keepOut: YOKES.xs.map((x) => ({ x, y: YOKES.y, r: YOKES.r })),
  apertures: APERTURES,
  // The instrument groups of InstrumentPanel.drawTo().
  regions: {
    sixpack: { x: COLS[0] - 92, y: ROWS[0] - 92, w: 3 * 184, h: 2 * 188 },
    engine: { x: CLUSTER.fuel - 66, y: CLUSTER.y - 66, w: CLUSTER.oil - CLUSTER.fuel + 132, h: 132 },
    stack: { x: STACK.x, y: STACK.navcom1, w: 320, h: STACK.blank - STACK.navcom1 },
  },
  // Ring centre and radius of each instrument a lesson can name (training/types.ts InstrumentId). No flap
  // indicator on the type: 'flaps' has no spot.
  spots: {
    asi: { x: COLS[0], y: ROWS[0], r: BIG },
    ai: { x: COLS[1], y: ROWS[0], r: BIG },
    alt: { x: COLS[2], y: ROWS[0], r: BIG },
    tc: { x: COLS[0], y: ROWS[1], r: BIG },
    // The slip ball sits in the lower part of the turn coordinator.
    ball: { x: COLS[0], y: ROWS[1] + APERTURES.large * 0.45, r: APERTURES.large * 0.42 },
    dg: { x: COLS[1], y: ROWS[1], r: BIG },
    vsi: { x: COLS[2], y: ROWS[1], r: BIG },
    tach: { x: TACH.x, y: TACH.y, r: BIG },
    // Both fuel gauges in one ring.
    fuel: { x: (FUEL.left + FUEL.right) / 2, y: FUEL.y, r: (FUEL.right - FUEL.left) / 2 + SMALL },
    oil: { x: CLUSTER.oil, y: CLUSTER.y, r: SMALL },
  },
};

// ---------------------------------------------------------------------------------------------------
// Instrument systems

/** 100LL avgas, kg per US gallon (6.0 lb/gal). */
const KG_PER_GAL = 2.7216;
/**
 * DC bus voltage below which electric gauges and lamps are dead: the 14 V system (12 V battery, s.9), as the
 * propulsion test-bed's 14 V electrical system has it.
 */
const BUS_DEAD_VOLTS = 9;
/** Regulated suction (s.9: 5.0 +/- 0.1 inHg). */
const SUCTION_REGULATED_INHG = 5.0;
/** Suction at which an air-driven gyro reaches rated speed (bottom of the green arc). */
const SUCTION_RATED_INHG = 4.8;
/** Alternator output below which the ALT light shows: it reads "no output" (s.9), A. */
const ALT_LAMP_AMPS = 0.5;

/** The lamp needs bus power. */
const powered = (i: LampInputs): boolean => i.state.electrical.busVoltage > BUS_DEAD_VOLTS;

export const PA38_INSTRUMENT_SYSTEMS: InstrumentSystemsDef = {
  engines: 1,
  // The engine-driven dry pump, optional but normally fitted (s.9): attitude and heading gyros are air-driven,
  // the turn coordinator electric.
  vacuum: {
    engines: [0],
    regulatedInHg: SUCTION_REGULATED_INHG,
    ratedInHg: SUCTION_RATED_INHG,
    // Pump capacity rises roughly with shaft speed and the regulator caps it (the C172S's fit: full regulated
    // suction above ~1300 rpm, so the 1800 rpm run-up reads 5.0).
    suction: (engineRpm) => {
      if (engineRpm <= 0) return 0;
      return Math.min(SUCTION_REGULATED_INHG, 5.4 * (1 - Math.exp(-engineRpm / 470)));
    },
  },
  gyroDrive: { attitude: 'vacuum', heading: 'vacuum' },
  // Two wing tanks, one float sender each.
  fuel: { kgPerGal: KG_PER_GAL, tanks: [(s) => s.fuel.left, (s) => s.fuel.right] },
  busDeadVolts: BUS_DEAD_VOLTS,
  tachHourRpm: TACH_HOUR_RPM,
  lamps: [{ id: 'alt', lit: (i) => powered(i) && i.state.electrical.alternatorAmps < ALT_LAMP_AMPS }],
};
