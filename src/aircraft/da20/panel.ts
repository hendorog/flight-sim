// Diamond DA20-C1: the instrument panel as data (gauges and their markings, switch row, magneto key, flap switch
// with its three lights, trim indicator, artwork, highlight spots) and what the instrument systems behind it
// need. CLOSURES.
//
// Arrangement from the type's engineering data sheet (aircraft-data/da20.md in the design work folder, s.9
// "Cockpit layout", the analogue panel of AFM fig 7.2; "s.N" below is its section N), as close as the panel
// components allow: the flight instruments in front of the left seat in two rows of four, the six-pack with the
// tachometer and the VOR indicator as the fourth column; the vacuum gauge over the clock at the far left; the
// LED trim indicator and the annunciators (GEN, CANOPY, START) at the top centre over the radio stack; the
// engine instruments right of the stack in two columns of four 2-inch gauges (EGT and CHT, fuel pressure and
// fuel quantity, oil temperature and pressure, ammeter and voltmeter); placards and the circuit breakers in rows
// at the far right. Along the bottom under the flight instruments: the light rockers, the dimmers, the magneto
// key, the AVIONICS MASTER, FUEL PUMP and split GEN / BAT rockers, then the three-position flap switch with its
// green CRUISE and yellow T/O and LDG lights. No manifold pressure gauge (s.4); the stall horn is pneumatic.
//
// The face shown in the cockpit is a LOW panel, the upper 624 px of the 2080 x 800 canvas on a face 0.96 m wide
// (visual.ts): 2167 px/m, so the instruments are drawn about 8 % smaller than on the C172S's 2000 px/m face.

import type { ArcDef, AsiMarkings, GaugeDef, InstrumentSystemsDef, LampDef, LampInputs, PanelDef, Rect, ScaleDef, SwitchDef, TachMarkings } from '../types';
import { DA20_REFERENCE } from './reference';

const V = DA20_REFERENCE;

/** The part of the 2080 x 800 canvas the panel face shows (visual.ts CockpitDef.panel.pxRect). */
export const DA20_PANEL_PX_RECT: Rect = { x: 0, y: 0, w: 2080, h: 624 };
/** Width of the panel face, m: about 1.0 m (s.12), narrowed so its top corners stay inside the canopy. */
export const DA20_PANEL_WIDTH = 0.96;
/** Canvas px per metre of the face, and the px column of the aircraft's centreline. */
export const DA20_PANEL_PX_PER_M = DA20_PANEL_PX_RECT.w / DA20_PANEL_WIDTH;
export const DA20_PANEL_CENTRE_PX = DA20_PANEL_PX_RECT.x + DA20_PANEL_PX_RECT.w / 2;

// ---------------------------------------------------------------------------------------------------
// Layout, canvas px (2167 px/m). Left seat on y = -0.27 m (px 455), right seat on +0.27 m (px 1625).

/** Apertures of a 3-1/8" and a 2-1/4" instrument, px: the C172S's, so the dials fill their bezels as drawn. */
const APERTURES = { large: 74, small: 51 };
/** Centre spacing of the 3-1/8" instruments: a bezel and its shadow margin (instruments/panelParts.ts). */
const PITCH = 184;
/** Two rows of four in front of the pilot: airspeed, attitude, altimeter, tachometer over turn coordinator, heading, VSI, VOR. */
const COLS = [228, 228 + PITCH, 228 + 2 * PITCH, 228 + 3 * PITCH] as const;
const ROWS = [98, 98 + PITCH] as const;
/** The vacuum gauge top left (AFM fig 7.2), the clock under it (the AFM's clock over the attitude indicator has no room on the low face). */
const LEFT_COLUMN = { x: 70, suction: 82, clock: 226 };
/** The LED trim indicator, upright, between the flight instruments and the stack (top centre). */
const TRIM: Rect = { x: 878, y: 8, w: 44, h: 196 };
/** Radio stack: rack units are 320 px wide (render/avionics.ts), the annunciator strip over it. */
const STACK = { x: 930, navcom: 50, gps: 132, xpdr: 374 };
const ANNUNCIATOR: Rect = { x: STACK.x, y: 6, w: 320, h: 38 };
/** The engine instruments: two columns of four 2-inch gauges. */
const ENGINE = { xs: [1324, 1458] as const, ys: [74, 210, 346, 482] as const };
/** Switch row under the flight instruments: lights, dimmers, the key, the master panel. */
const SWITCHES: Rect = { x: 130, y: 440, w: 660, h: 116 };
const ROW = {
  rockerTop: 44,
  rockerW: 24,
  rockerH: 42,
  magneto: { x: 352, y: 72 },
  dimmers: { panel: 230, radio: 280, y: 66 },
};
/** Flap switch at the right end of the bottom row, its three lights in a column beside it (s.9). */
export const DA20_FLAP_SWITCH = [824, 500] as const;
const FLAP_LIGHTS: Rect = { x: 858, y: 425, w: 62, h: 150 };
/** The circuit breakers in rows at the far right (s.9), placards above them. */
const BREAKERS: Rect = { x: 1556, y: 360, w: 504, h: 230 };

// ---------------------------------------------------------------------------------------------------
// Markings (AFM 2.3 and 2.5, s.4 and s.7)

/**
 * Airspeed indicator, KIAS (AFM 2.3): white arc 34-78, green 42-118, yellow 118-164, red line 164. The bottoms of
 * the white and green arcs are the 750 kg stall speeds of the original certification, not the 800 kg ones of the
 * reference table (s.7). A 30-200 kt dial with the low end expanded.
 */
export const DA20_ASI_MARKS: AsiMarkings = {
  scaleKt: [0, 30, 40, 60, 80, 100, 120, 140, 160, 180, 200],
  scaleDeg: [0, 20, 40, 84, 126, 166, 204, 240, 274, 304, 332],
  tickFrom: 30,
  tickTo: 200,
  minorStep: 5,
  numberStep: 20,
  arcs: [
    { from: 42, to: V.vno, color: 'green' },
    { from: V.vno, to: V.vne, color: 'yellow' },
    { from: 34, to: V.vfe[V.vfe.length - 1], color: 'white', inner: true },
  ],
  redLine: V.vne,
};

/** Rated (and maximum) engine speed, rpm: 125 hp at 2800 rpm for take-off and continuous (AFM 2.4.1, s.4). */
const RATED_RPM = 2800;
/** One hour at this rpm records one tach hour (cruise rpm of the type). */
const TACH_HOUR_RPM = 2500;

/** Tachometer: 0-3500 rpm, green arc 700-2800, red line 2800 (AFM 2.5, s.4). */
export const DA20_TACH_MARKS: TachMarkings = {
  max: 3500,
  majorStep: 500,
  minorStep: 100,
  numberStep: 500,
  arcs: [{ from: 700, to: RATED_RPM, color: 'green' }],
  redLine: RATED_RPM,
  hourRpm: TACH_HOUR_RPM,
};

/** Vacuum gauge: green 4.5-5.2 inHg (s.9). The pointer rests on its stop below 3. */
export const DA20_SUCTION_SCALE: ScaleDef = {
  label: '',
  min: 2.6,
  max: 7,
  majors: [3, 4, 5, 6, 7],
  minorStep: 0.5,
  arcs: [{ from: 4.5, to: 5.2, color: 'green' }],
  read: (r) => r.suctionInHg,
};

/** The usable fuel of the one fuselage tank, US gal: 91 of 93 L (s.6, s.9). */
const USABLE_GAL = 24;

/**
 * A 2-inch engine gauge: 250 degrees of sweep, the title under the pivot (gauges.ts singleGauge, inlined here).
 * The title line runs between the two ends of the scale, so the numerals at the ends are left out where it is long.
 */
function small(id: string, at: readonly [number, number], seed: number, title: string, units: string, labels: readonly number[], scale: ScaleDef): GaugeDef {
  const DEG = Math.PI / 180;
  return { kind: 'single', id, at, seed, size: 'small', a0: -125 * DEG, a1: 125 * DEG, title, units, labels, scale };
}
const arcs = (...a: ArcDef[]): ArcDef[] => a;

/** EGT: one probe, no limit marking, used for leaning (AFM 4.4.9, s.4). */
const EGT = small('egt', [ENGINE.xs[0], ENGINE.ys[0]], 231, 'EGT', '°F', [], {
  label: '',
  min: 1000,
  max: 1700,
  majors: [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700],
  minorStep: 50,
  numbers: false,
  read: (r) => r.engines[0].egtF,
});
/** CHT: green 300-420 F, yellow 420-460, red line 460 (AFM 2.4.1, 2.5; s.4). */
const CHT = small('cht', [ENGINE.xs[1], ENGINE.ys[0]], 232, 'CHT', '°F', [200, 300, 400, 500], {
  label: '',
  min: 200,
  max: 500,
  majors: [200, 250, 300, 350, 400, 450, 500],
  minorStep: 25,
  arcs: arcs({ from: 300, to: 420, color: 'green' }, { from: 420, to: 460, color: 'yellow' }),
  redLines: [460],
  read: (r) => r.engines[0].chtF,
});
/** Fuel pressure: red lines at 3.5 and 16.5 psi (AFM 2.5, s.4). */
const FUEL_PRESS = small('fuelPress', [ENGINE.xs[0], ENGINE.ys[1]], 233, 'FUEL PRESS', 'PSI', [5, 10, 15], {
  label: '',
  min: 0,
  max: 20,
  majors: [0, 5, 10, 15, 20],
  minorStep: 1,
  arcs: arcs({ from: 3.5, to: 16.5, color: 'green' }),
  redLines: [3.5, 16.5],
  read: (r) => r.engines[0].fuelPressurePsi,
});
/** Fuel quantity of the one fuselage tank, US gal; the red arc is the unusable fuel. */
const FUEL_QTY = small('fuel', [ENGINE.xs[1], ENGINE.ys[1]], 234, 'FUEL QTY', 'U.S. GAL', [8, 16], {
  label: '',
  min: 0,
  max: USABLE_GAL,
  majors: [0, 4, 8, 12, 16, 20, 24],
  minorStep: 2,
  arcs: arcs({ from: 0, to: 1, color: 'red' }),
  read: (r) => r.fuelGal[0],
});
/** Oil temperature: yellow 75-170 F, green 170-220, yellow 220-240, red line 240 (AFM 2.4.1, 2.5; s.4). */
const OIL_TEMP = small('oilTemp', [ENGINE.xs[0], ENGINE.ys[2]], 235, 'OIL TEMP', '°F', [100, 150, 200], {
  label: '',
  min: 75,
  max: 250,
  majors: [75, 100, 150, 200, 250],
  minorStep: 25,
  arcs: arcs({ from: 75, to: 170, color: 'yellow' }, { from: 170, to: 220, color: 'green' }, { from: 220, to: 240, color: 'yellow' }),
  redLines: [240],
  read: (r) => r.engines[0].oilTempF,
});
/** Oil pressure: red line 10 psi, yellow 10-30, green 30-60, yellow 60-100, red line 100 (AFM 2.4.1, s.4). */
const OIL_PRESS = small('oilPress', [ENGINE.xs[1], ENGINE.ys[2]], 236, 'OIL PRESS', 'PSI', [25, 50, 75], {
  label: '',
  min: 0,
  max: 115,
  majors: [0, 25, 50, 75, 100],
  minorStep: 5,
  arcs: arcs({ from: 10, to: 30, color: 'yellow' }, { from: 30, to: 60, color: 'green' }, { from: 60, to: 100, color: 'yellow' }),
  redLines: [10, 100],
  read: (r) => r.engines[0].oilPressurePsi,
});

/** Ammeter, centre zero, +/-60 A (s.9: 40 A alternator). */
export const DA20_AMMETER_SCALE: ScaleDef = {
  label: '',
  min: -60,
  max: 60,
  majors: [-60, -30, 0, 30, 60],
  minorStep: 10,
  read: (r) => r.ammeterAmps,
};
/** Voltmeter 8-16 V: red 8-11, yellow 11-12.5, green 12.5-16, red line 16.1 (s.9). */
const VOLTS = small('volts', [ENGINE.xs[1], ENGINE.ys[3]], 238, 'VOLTS', '', [8, 10, 12, 14, 16], {
  label: '',
  min: 8,
  max: 16,
  majors: [8, 10, 12, 14, 16],
  minorStep: 0.5,
  arcs: arcs({ from: 8, to: 11, color: 'red' }, { from: 11, to: 12.5, color: 'yellow' }, { from: 12.5, to: 16, color: 'green' }),
  redLines: [16.1],
  read: (r) => r.busVolts,
});

const RED = '#ff3b2a';
const AMBER = '#ffb21e';

/** The annunciators at the top centre (s.9): red GEN, amber CANOPY, amber START (the EPU light is not fitted). */
export const DA20_ANNUNCIATOR_LAMPS: readonly LampDef[] = [
  { id: 'gen', text: 'GEN', color: RED, lit: (r) => r.lamps.gen },
  { id: 'canopy', text: 'CANOPY', color: AMBER, lit: (r) => r.lamps.canopy },
  { id: 'start', text: 'START', color: AMBER, lit: (r) => r.lamps.start },
];

// ---------------------------------------------------------------------------------------------------
// Switch row: LANDING, TAXI, POSITION, STROBE; the instrument and flood dimmers; the key; AVIONICS MASTER and FUEL
// PUMP; the split GEN / BAT master rocker (s.9).

const rocker = (id: string, label: string, name: string, x: number, on: SwitchDef['on'], toggle: SwitchDef['toggle'], more: Pick<SwitchDef, 'red' | 'group'> = {}): SwitchDef => ({
  id,
  label,
  name,
  x,
  ...more,
  on,
  toggle,
});

const RX = { landing: 30, taxi: 72, nav: 114, strobe: 156, avionics: 448, fuelPump: 508, gen: 584, bat: 612 };

// Ring radii of the highlight spots: a little outside the glass of a 3-1/8" and of a 2-inch instrument.
const BIG = APERTURES.large * 1.1;
const SMALL = APERTURES.small * 1.15;

export const DA20_PANEL: PanelDef = {
  id: 'da20',
  size: { w: 2080, h: 800 },
  // In the order the panel draws them.
  gauges: [
    { kind: 'asi', id: 'asi', at: [COLS[0], ROWS[0]], marks: DA20_ASI_MARKS },
    { kind: 'attitude', id: 'attitude', at: [COLS[1], ROWS[0]] },
    { kind: 'altimeter', id: 'altimeter', at: [COLS[2], ROWS[0]] },
    { kind: 'tach', id: 'tach', at: [COLS[3], ROWS[0]], size: 'large', marks: DA20_TACH_MARKS },
    { kind: 'turn', id: 'turn', at: [COLS[0], ROWS[1]] },
    { kind: 'heading', id: 'heading', at: [COLS[1], ROWS[1]] },
    { kind: 'vsi', id: 'vsi', at: [COLS[2], ROWS[1]] },
    // The VOR / LOC indicator closes the lower row; its course card on runway 07 when nothing turns the OBS.
    { kind: 'cdi', id: 'cdi1', at: [COLS[3], ROWS[1]], receiver: 'nav1', fixedCourseDeg: 70 },
    { kind: 'clock', id: 'clock', at: [LEFT_COLUMN.x, LEFT_COLUMN.clock] },
    { kind: 'suction', id: 'suction', at: [LEFT_COLUMN.x, LEFT_COLUMN.suction], scale: DA20_SUCTION_SCALE },
    EGT,
    CHT,
    FUEL_PRESS,
    FUEL_QTY,
    OIL_TEMP,
    OIL_PRESS,
    { kind: 'ammeter', id: 'ammeter', at: [ENGINE.xs[0], ENGINE.ys[3]], scale: DA20_AMMETER_SCALE },
    VOLTS,
    // Three-position switch, green CRUISE, yellow T/O and LDG; two lit while the flaps travel (s.9).
    {
      kind: 'flapLights',
      id: 'flaps',
      bounds: FLAP_LIGHTS,
      positions: ['CRUISE', 'T/O', 'LDG'],
      colors: ['green', 'yellow', 'yellow'],
      degrees: [0, 15, 45],
      lever: DA20_FLAP_SWITCH,
    },
    { kind: 'trimBar', id: 'elevatorTrim', bounds: TRIM, axis: 'elevator' },
    { kind: 'navcom', id: 'navcom1', bounds: { x: STACK.x, y: STACK.navcom, w: 320, h: 76 } },
    { kind: 'gps', id: 'gps', bounds: { x: STACK.x, y: STACK.gps, w: 320, h: 236 } },
    { kind: 'xpdr', id: 'xpdr', bounds: { x: STACK.x, y: STACK.xpdr, w: 320, h: 60 } },
  ],
  annunciator: { bounds: ANNUNCIATOR, lamps: DA20_ANNUNCIATOR_LAMPS },
  switchRow: {
    bounds: SWITCHES,
    rockerTop: ROW.rockerTop,
    rockerW: ROW.rockerW,
    rockerH: ROW.rockerH,
    switches: [
      rocker('landing', 'LAND', 'Landing light', RX.landing, (c) => c.lights.landing, (c) => { c.lights.landing = !c.lights.landing; }, { group: 'lights' }),
      rocker('taxi', 'TAXI', 'Taxi light', RX.taxi, (c) => c.lights.taxi, (c) => { c.lights.taxi = !c.lights.taxi; }, { group: 'lights' }),
      rocker('nav', 'POS', 'Position lights', RX.nav, (c) => c.lights.nav, (c) => { c.lights.nav = !c.lights.nav; }, { group: 'lights' }),
      rocker('strobe', 'STROBE', 'Strobes', RX.strobe, (c) => c.lights.strobe, (c) => { c.lights.strobe = !c.lights.strobe; }, { group: 'lights' }),
      rocker('avionics', 'AVIONICS', 'Avionics master', RX.avionics, (c) => c.avionics, (c) => { c.avionics = !c.avionics; }),
      rocker('fuelPump', 'FUEL PUMP', 'Fuel pump', RX.fuelPump, (c) => c.fuelPump, (c) => { c.fuelPump = !c.fuelPump; }),
      rocker('alternator', '', 'Master GEN', RX.gen, (c) => c.alternator, (c) => { c.alternator = !c.alternator; }, { red: true, group: 'master' }),
      rocker('battery', '', 'Master BAT', RX.bat, (c) => c.masterBattery, (c) => { c.masterBattery = !c.masterBattery; }, { red: true, group: 'master' }),
    ],
    // Local px of the row: the bracket tabs over the lights and the master, the dimmer names.
    legends: [
      { text: 'LIGHTS', x: (RX.landing + RX.strobe) / 2, y: ROW.rockerTop - 24, size: 8.5 },
      { text: 'MASTER', x: (RX.gen + RX.bat) / 2, y: ROW.rockerTop - 24, size: 8.5 },
      { text: 'GEN', x: RX.gen, y: ROW.rockerTop - 12, size: 8 },
      { text: 'BAT', x: RX.bat, y: ROW.rockerTop - 12, size: 8 },
      { text: 'INSTR', x: ROW.dimmers.panel, y: ROW.rockerTop - 12, size: 8 },
      { text: 'FLOOD', x: ROW.dimmers.radio, y: ROW.rockerTop - 12, size: 8 },
    ],
    dimmers: ROW.dimmers,
  },
  // Panel px, where the click hotspot and the 3D key are.
  ignition: { kind: 'key', at: [SWITCHES.x + ROW.magneto.x, SWITCHES.y + ROW.magneto.y] },
  background: {
    // Sub-panel seams: pilot panel | centre stack | right panel.
    seamsX: [STACK.x - 14, STACK.x + 334],
    bushings: [],
    // Placards of the right panel: centre x and top y; lines; lettering size where not the default.
    placards: [
      {
        x: 1810,
        y: 34,
        lines: [
          'THIS AIRPLANE MAY ONLY BE OPERATED IN THE UTILITY',
          'CATEGORY IN NON-ICING CONDITIONS. DAY VFR ONLY.',
          'AEROBATIC MANEUVERS ARE PROHIBITED EXCEPT THOSE',
          'LISTED IN THE FLIGHT MANUAL. INTENTIONAL SPINS',
          'WITH FLAPS CRUISE ONLY.',
        ],
        size: 6.5,
      },
      { x: 1810, y: 132, lines: ['MANEUVERING SPEED', `VA = ${V.va} KIAS`], size: 8 },
      { x: 1810, y: 184, lines: ['MAX FLAP EXTENDED SPEEDS', `T/O ${V.vfe[0]} KIAS   LDG ${V.vfe[V.vfe.length - 1]} KIAS`], size: 7.5 },
      { x: 1810, y: 238, lines: ['FUEL 100LL / 100', `${USABLE_GAL} U.S. GAL USABLE`], size: 8 },
      { x: 1810, y: 292, lines: ['DO NOT OPEN CANOPY', 'WITH ENGINE RUNNING'], size: 7.5 },
      // FUEL PRIME at the far left of the panel (s.9): the switch is not modelled (the electric pump primes).
      { x: 70, y: 306, lines: ['FUEL PRIME'], size: 7 },
    ],
    // Circuit breakers in rows (s.9: engine, systems, lights, avionics, electrical): legend and rating, A.
    breakers: {
      bounds: BREAKERS,
      names: [
        'INST', 'FUEL PUMP', 'FLAPS', 'TRIM', 'START', 'GEN CTL',
        'LANDING', 'TAXI', 'POS', 'STROBE', 'INST LT', 'FLOOD',
        'AV BUS', 'COM', 'NAV', 'GPS', 'XPDR', 'INTERCOM',
        'TURN', 'ANNUN', 'VOLTS', 'ESS BUS', 'GEN', 'BAT',
      ],
      amps: [5, 5, 5, 3, 5, 5, 10, 10, 5, 5, 5, 3, 25, 10, 5, 5, 5, 3, 3, 3, 3, 25, 50, 50],
      perRow: 6,
    },
    // Rack rails of the centre stack.
    rack: { rails: { x: STACK.x - 4, y: STACK.navcom - 6, w: 328, h: STACK.xpdr + 66 - STACK.navcom }, blanks: [] },
  },
  // The sticks stand on the floor: nothing passes through the panel.
  keepOut: [],
  apertures: APERTURES,
  // The instrument groups of InstrumentPanel.drawTo().
  regions: {
    sixpack: { x: COLS[0] - PITCH / 2, y: ROWS[0] - PITCH / 2, w: 4 * PITCH, h: 2 * PITCH },
    engine: { x: ENGINE.xs[0] - 66, y: ENGINE.ys[0] - 66, w: ENGINE.xs[1] - ENGINE.xs[0] + 132, h: ENGINE.ys[3] - ENGINE.ys[0] + 132 },
    stack: { x: STACK.x, y: STACK.navcom, w: 320, h: STACK.xpdr + 60 - STACK.navcom },
  },
  // Ring centre and radius of each instrument a lesson can name (training/types.ts InstrumentId).
  spots: {
    asi: { x: COLS[0], y: ROWS[0], r: BIG },
    ai: { x: COLS[1], y: ROWS[0], r: BIG },
    alt: { x: COLS[2], y: ROWS[0], r: BIG },
    tach: { x: COLS[3], y: ROWS[0], r: BIG },
    tc: { x: COLS[0], y: ROWS[1], r: BIG },
    // The slip ball sits in the lower part of the turn coordinator.
    ball: { x: COLS[0], y: ROWS[1] + APERTURES.large * 0.45, r: APERTURES.large * 0.42 },
    dg: { x: COLS[1], y: ROWS[1], r: BIG },
    vsi: { x: COLS[2], y: ROWS[1], r: BIG },
    fuel: { x: ENGINE.xs[1], y: ENGINE.ys[1], r: SMALL },
    oil: { x: ENGINE.xs[1], y: ENGINE.ys[2], r: SMALL },
    flaps: { x: FLAP_LIGHTS.x + FLAP_LIGHTS.w / 2 - 20, y: FLAP_LIGHTS.y + FLAP_LIGHTS.h / 2, r: FLAP_LIGHTS.h / 2 },
  },
};

// ---------------------------------------------------------------------------------------------------
// Instrument systems

/** 100LL avgas, kg per US gallon (6.0 lb/gal). */
const KG_PER_GAL = 2.7216;
/**
 * DC bus voltage below which electric gauges and lamps are dead: the C172S's 18 V of 28 scaled to the 14 V system
 * of the type (s.9). powerplant.ts states the same number (tests/aircraft/consistency.ts).
 */
const BUS_DEAD_VOLTS = 9;
/** Regulated suction (s.9: 4.5-5.2 inHg); the gyros reach rated speed at the bottom of the green arc. */
const SUCTION_REGULATED_INHG = 5.0;
const SUCTION_RATED_INHG = 4.5;
/** The GEN light: the bus is below what the generator holds it at, the battery alone carries the load. */
const GEN_LAMP_VOLTS = 13.0;

/** The lamp needs bus power. */
const powered = (i: LampInputs): boolean => i.state.electrical.busVoltage > BUS_DEAD_VOLTS;

export const DA20_INSTRUMENT_SYSTEMS: InstrumentSystemsDef = {
  engines: 1,
  // Engine-driven vacuum pump for the attitude indicator and the directional gyro; the turn coordinator is
  // electric (s.9).
  vacuum: {
    engines: [0],
    regulatedInHg: SUCTION_REGULATED_INHG,
    ratedInHg: SUCTION_RATED_INHG,
    // Pump capacity rises with shaft speed and the regulator caps it (the C172S's fit): in the green at the
    // 1000 rpm the type idles at on the ground.
    suction: (engineRpm) => {
      if (engineRpm <= 0) return 0;
      return Math.min(SUCTION_REGULATED_INHG, 5.4 * (1 - Math.exp(-engineRpm / 470)));
    },
  },
  gyroDrive: { attitude: 'vacuum', heading: 'vacuum' },
  // One fuselage tank behind the seats, one sender: the legacy view splits it into two halves.
  fuel: { kgPerGal: KG_PER_GAL, tanks: [(s) => s.fuel.left + s.fuel.right] },
  busDeadVolts: BUS_DEAD_VOLTS,
  tachHourRpm: TACH_HOUR_RPM,
  lamps: [
    { id: 'gen', lit: (i) => powered(i) && i.state.electrical.busVoltage < GEN_LAMP_VOLTS },
    // Canopy closed and latched: the sim has no canopy to open, so the light stays out.
    { id: 'canopy', lit: () => false },
    { id: 'start', lit: (i) => powered(i) && i.controls.starter },
  ],
};
