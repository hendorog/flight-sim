// Cessna 152 (1978 model): the instrument panel as data (gauges and their markings, switch row, magneto key,
// artwork, highlight spots) and what the instrument systems behind it need. CLOSURES.
//
// Arrangement from the type's engineering data sheet (aircraft-data/c152.md in the design work folder, s.9
// "Cockpit layout"; "s.N" below is its section N), as close as the panel components allow: the six flight
// instruments in front of the left seat with the clock and the suction gauge in a column left of them and the
// VOR indicator to their right; the radio stack in the centre; the tachometer right of centre with the ammeter
// and the one LOW VOLTAGE lamp beside it, placards and the map compartment on the far right; fuel and oil gauges
// on the lower left, the master switch, the magneto key and the light rockers below them (no fuel-pump rocker,
// no avionics master on the 1978 aircraft); along the lower centre the CARB HEAT knob left of the throttle, the
// mixture right of it, then the flap pre-select lever with its position scale; the circuit breakers under the
// right panel. There is no EGT and no fuel-flow gauge.
//
// The face shown in the cockpit is the left 1840 px of the 2080 x 800 canvas at 2000 px/m (visual.ts: a panel
// 0.92 m wide and 0.40 m high), so the instruments are drawn at the C172S's scale, their real size.

import type { AsiMarkings, GaugeDef, InstrumentSystemsDef, LampDef, LampInputs, PanelDef, Rect, ScaleDef, SwitchDef, TachMarkings } from '../types';
import { C152_REFERENCE } from './reference';

const V = C152_REFERENCE;

/** The part of the 2080 x 800 canvas the panel face shows (visual.ts CockpitDef.panel.pxRect): 0.92 m at 2000 px/m. */
export const C152_PANEL_PX_RECT: Rect = { x: 0, y: 0, w: 1840, h: 800 };
/** Canvas px per metre of the face, and the px column of the aircraft's centreline. */
export const C152_PANEL_PX_PER_M = 2000;
export const C152_PANEL_CENTRE_PX = C152_PANEL_PX_RECT.x + C152_PANEL_PX_RECT.w / 2;

// ---------------------------------------------------------------------------------------------------
// Layout, canvas px. Left seat on y = -0.24 m (px 440), right seat on +0.24 m (px 1400).

const COLS = [258, 442, 626] as const;
const ROWS = [175, 361] as const;
/** Clock and suction gauge, left of the airspeed indicator. */
const LEFT_COLUMN = { x: 86, clock: 140, suction: 282 };
const CDI = { x: 810, y: ROWS[0] };
/** Radio stack: rack units are 320 px wide (render/avionics.ts); the heights are repeated from there. */
const STACK = { x: 920, navcom1: 36, navcom2: 120, xpdr: 204, blank: 270 };
const TACH = { x: 1336, y: ROWS[0] };
const AMMETER = { x: 1500, y: 140 };
/** Fuel quantity and oil temperature / pressure: two 2-1/4" dual gauges on the lower left. */
const ENGINE_ROW = { y: 600, fuel: 150, oil: 290 };
/** Control wheel shafts through the panel (3D boots; visual.ts puts the yokes here). */
const YOKES = { y: 545, xs: [442, 1398] as const, r: 58 };
/** The push-pull knobs of the lower centre: carburettor heat, throttle, mixture (visual.ts engineControls). */
export const C152_KNOBS = { y: 735, carbHeat: 800, throttle: 920, mixture: 1040 } as const;
/** The parking brake handle at the left end of the lower panel, left of the fuel gauge (s.3, s.9), px. */
export const C152_PARKING_BRAKE = [56, 628] as const;
/** Flap scale and lever slot: slot at local x 100, 0 deg at local y 80, 30 deg 200 px lower (FlapIndicator). */
const FLAPS: Rect = { x: 1100, y: 470, w: 130, h: 312 };
const SWITCHES: Rect = { x: 16, y: 672, w: 600, h: 116 };
const ROW = {
  rockerTop: 44,
  rockerW: 24,
  rockerH: 42,
  magneto: { x: 130, y: 72 },
  dimmers: { panel: 510, radio: 562, y: 66 },
};
const APERTURES = { large: 74, small: 51 };

/** The 3D parts that stand on the panel, in px, for visual.ts (yoke columns, flap lever slot). */
export const C152_PANEL_PARTS = { yokes: YOKES, flapSlot: { x: FLAPS.x + 100, y: FLAPS.y + 80 } } as const;

// ---------------------------------------------------------------------------------------------------
// Markings (POH section 2, s.4 and s.7)

/**
 * Airspeed indicator, KIAS (POH Fig 2-2): white arc 35-85 (Vs0 to Vfe), green 40-111 (Vs1 to Vno), yellow
 * 111-149, red line 149 (Vne). The dial of the small Cessna indicator: 40 kt at about 1 o'clock, 160 kt at
 * about 11 o'clock, the low end expanded.
 */
export const C152_ASI_MARKS: AsiMarkings = {
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

/** One hour at this rpm records one tach hour. */
const TACH_HOUR_RPM = 2300;
/** Rated (and maximum) engine speed of the installation, rpm (TCDS 3A19: 2550 rpm, 110 hp for all operations). */
const RATED_RPM = 2550;

/** Recording tachometer: 0-3500 rpm, green arc 1900-2550, red line 2550 (POH Fig 2-3, s.4). */
export const C152_TACH_MARKS: TachMarkings = {
  max: 3500,
  majorStep: 500,
  minorStep: 100,
  numberStep: 500,
  arcs: [{ from: 1900, to: RATED_RPM, color: 'green' }],
  redLine: RATED_RPM,
  hourRpm: TACH_HOUR_RPM,
};

/** Suction gauge: green 4.6-5.4 inHg, the normal range of s.9. The pointer rests on its stop below 3. */
export const C152_SUCTION_SCALE: ScaleDef = {
  label: '',
  min: 2.6,
  max: 7,
  majors: [3, 4, 5, 6, 7],
  minorStep: 0.5,
  arcs: [{ from: 4.6, to: 5.4, color: 'green' }],
  read: (r) => r.suctionInHg,
};

/** Battery ammeter, centre zero (charge / discharge), +/-60 A: the 60 A alternator of s.9. */
export const C152_AMMETER_SCALE: ScaleDef = {
  label: '',
  min: -60,
  max: 60,
  majors: [-60, -30, 0, 30, 60],
  minorStep: 10,
  read: (r) => r.ammeterAmps,
};

/**
 * One side of the fuel quantity gauge: a 13 US gal tank, 12.25 gal usable (s.6). The red arc is the "E plus
 * red line" of s.9, about 0.75 gal left in the tank.
 */
const fuelScale = (label: string, read: ScaleDef['read']): ScaleDef => ({
  label,
  min: 0,
  max: 13,
  majors: [0, 4, 8, 13],
  minorStep: 1,
  arcs: [{ from: 0, to: 0.75, color: 'red' }],
  read,
});

const FUEL_QTY: GaugeDef = {
  kind: 'dual',
  id: 'fuel',
  at: [ENGINE_ROW.fuel, ENGINE_ROW.y],
  seed: 211,
  title: ['FUEL QTY', 'U.S. GAL'],
  left: fuelScale('L', (r) => r.fuelLeftGal),
  right: fuelScale('R', (r) => r.fuelRightGal),
};
/** Oil temperature green 100-245 F, red line 245; oil pressure red lines 25 (idle) and 100 psi, green 60-90 (POH Fig 2-3). */
const OIL: GaugeDef = {
  kind: 'dual',
  id: 'oil',
  at: [ENGINE_ROW.oil, ENGINE_ROW.y],
  seed: 212,
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
    majors: [0, 25, 60, 90, 115],
    minorStep: 5,
    arcs: [{ from: 60, to: 90, color: 'green' }],
    redLines: [25, 100],
    read: (r) => r.oilPressurePsi,
  },
};

const RED = '#ff3b2a';

/** The one warning light, under the ammeter (s.9): the bus is below the alternator's output, the battery is discharging. */
export const C152_ANNUNCIATOR_LAMPS: readonly LampDef[] = [{ id: 'lowVolts', text: 'LOW VOLTAGE', color: RED, lit: (r) => r.lamps.lowVolts }];

// ---------------------------------------------------------------------------------------------------
// Switch row: the split MASTER (ALT left half, BAT right half, s.9), the magneto key, the light rockers (up =
// ON) and pitot heat, the two concentric light rheostats shown as PANEL and RADIO.

const rocker = (id: string, label: string, name: string, x: number, on: SwitchDef['on'], toggle: SwitchDef['toggle'], more: Pick<SwitchDef, 'red' | 'group'> = {}): SwitchDef => ({
  id,
  label,
  name,
  x,
  ...more,
  on,
  toggle,
});

const RX = { alt: 40, bat: 65, beacon: 210, landing: 250, taxi: 290, nav: 330, strobe: 370, pitotHeat: 440 };

// ---------------------------------------------------------------------------------------------------

// Ring radii of the highlight spots: a little outside the glass of a 3-1/8" and of a 2-1/4" instrument.
const BIG = APERTURES.large * 1.1;
const SMALL = APERTURES.small * 1.15;

export const C152_PANEL: PanelDef = {
  id: 'c152',
  size: { w: 2080, h: 800 },
  // In the order the panel draws them.
  gauges: [
    { kind: 'asi', id: 'asi', at: [COLS[0], ROWS[0]], marks: C152_ASI_MARKS },
    { kind: 'attitude', id: 'attitude', at: [COLS[1], ROWS[0]] },
    { kind: 'altimeter', id: 'altimeter', at: [COLS[2], ROWS[0]] },
    { kind: 'turn', id: 'turn', at: [COLS[0], ROWS[1]] },
    { kind: 'heading', id: 'heading', at: [COLS[1], ROWS[1]] },
    { kind: 'vsi', id: 'vsi', at: [COLS[2], ROWS[1]] },
    // The VOR / LOC indicator top right of the block; its course card set to runway 07 when nothing turns the OBS.
    { kind: 'cdi', id: 'cdi1', at: [CDI.x, CDI.y], receiver: 'nav1', fixedCourseDeg: 70 },
    { kind: 'clock', id: 'clock', at: [LEFT_COLUMN.x, LEFT_COLUMN.clock] },
    { kind: 'suction', id: 'suction', at: [LEFT_COLUMN.x, LEFT_COLUMN.suction], scale: C152_SUCTION_SCALE },
    { kind: 'tach', id: 'tach', at: [TACH.x, TACH.y], size: 'large', marks: C152_TACH_MARKS },
    { kind: 'ammeter', id: 'ammeter', at: [AMMETER.x, AMMETER.y], scale: C152_AMMETER_SCALE },
    FUEL_QTY,
    OIL,
    // The pre-select lever's position scale: stops at 10 and 20 degrees, full travel 30 (s.2.1).
    { kind: 'flapLever', id: 'flaps', bounds: FLAPS, maxDeg: 30, legends: ['0°', '10°', '20°', '30°'] },
    { kind: 'navcom', id: 'navcom1', bounds: { x: STACK.x, y: STACK.navcom1, w: 320, h: 76 } },
    { kind: 'navcom', id: 'navcom2', bounds: { x: STACK.x, y: STACK.navcom2, w: 320, h: 76 } },
    { kind: 'xpdr', id: 'xpdr', bounds: { x: STACK.x, y: STACK.xpdr, w: 320, h: 60 } },
  ],
  annunciator: { bounds: { x: AMMETER.x - 56, y: AMMETER.y + 70, w: 112, h: 36 }, lamps: C152_ANNUNCIATOR_LAMPS },
  switchRow: {
    bounds: SWITCHES,
    rockerTop: ROW.rockerTop,
    rockerW: ROW.rockerW,
    rockerH: ROW.rockerH,
    switches: [
      rocker('alternator', '', 'Master ALT', RX.alt, (c) => c.alternator, (c) => { c.alternator = !c.alternator; }, { red: true, group: 'master' }),
      rocker('battery', '', 'Master BAT', RX.bat, (c) => c.masterBattery, (c) => { c.masterBattery = !c.masterBattery; }, { red: true, group: 'master' }),
      rocker('beacon', 'BCN', 'Beacon', RX.beacon, (c) => c.lights.beacon, (c) => { c.lights.beacon = !c.lights.beacon; }, { group: 'lights' }),
      rocker('landing', 'LAND', 'Landing light', RX.landing, (c) => c.lights.landing, (c) => { c.lights.landing = !c.lights.landing; }, { group: 'lights' }),
      rocker('taxi', 'TAXI', 'Taxi light', RX.taxi, (c) => c.lights.taxi, (c) => { c.lights.taxi = !c.lights.taxi; }, { group: 'lights' }),
      rocker('nav', 'NAV', 'Nav lights', RX.nav, (c) => c.lights.nav, (c) => { c.lights.nav = !c.lights.nav; }, { group: 'lights' }),
      rocker('strobe', 'STROBE', 'Strobes', RX.strobe, (c) => c.lights.strobe, (c) => { c.lights.strobe = !c.lights.strobe; }, { group: 'lights' }),
      rocker('pitotHeat', 'PITOT HT', 'Pitot heat', RX.pitotHeat, (c) => c.pitotHeat, (c) => { c.pitotHeat = !c.pitotHeat; }),
    ],
    // Local px of the row: the MASTER pair, the tab of the bracket over the light switches, the rheostats.
    legends: [
      { text: 'MASTER', x: (RX.alt + RX.bat) / 2, y: ROW.rockerTop - 24, size: 8.5 },
      { text: 'ALT', x: RX.alt, y: ROW.rockerTop - 12, size: 8 },
      { text: 'BAT', x: RX.bat, y: ROW.rockerTop - 12, size: 8 },
      { text: 'LIGHTS', x: (RX.beacon + RX.strobe) / 2, y: ROW.rockerTop - 24, size: 8.5 },
      { text: 'PANEL LT', x: ROW.dimmers.panel, y: ROW.rockerTop - 12, size: 8 },
      { text: 'RADIO LT', x: ROW.dimmers.radio, y: ROW.rockerTop - 12, size: 8 },
      { text: 'BRT', x: (ROW.dimmers.panel + ROW.dimmers.radio) / 2, y: ROW.rockerTop + 8, size: 6.5 },
    ],
    dimmers: ROW.dimmers,
  },
  // Panel px, where the click hotspot and the 3D key are.
  ignition: { kind: 'key', at: [SWITCHES.x + ROW.magneto.x, SWITCHES.y + ROW.magneto.y] },
  background: {
    // Sub-panel seams: pilot panel | centre stack | right panel.
    seamsX: [STACK.x - 18, STACK.x + 330],
    // Legend and sub-legend under the three push-pull knobs of the lower centre, and under the parking brake.
    bushings: [
      { at: [C152_KNOBS.carbHeat, C152_KNOBS.y], text: 'CARB HEAT', sub: 'PULL ON' },
      { at: [C152_KNOBS.throttle, C152_KNOBS.y], text: 'THROTTLE', sub: 'PUSH OPEN' },
      { at: [C152_KNOBS.mixture, C152_KNOBS.y], text: 'MIXTURE', sub: 'PUSH RICH' },
      { at: [C152_PARKING_BRAKE[0], C152_PARKING_BRAKE[1]], text: 'PARK BRAKE', sub: 'PULL' },
    ],
    // Placards of the right panel: centre x and top y; lines; lettering size where not the default.
    placards: [
      {
        x: 1700,
        y: 36,
        lines: [
          'THIS AIRPLANE MUST BE OPERATED AS A UTILITY',
          'CATEGORY AIRPLANE IN COMPLIANCE WITH THE OPERATING',
          'LIMITATIONS STATED IN THE FORM OF PLACARDS,',
          'MARKINGS AND MANUALS. NO ACROBATIC MANEUVERS',
          'EXCEPT THOSE LISTED IN THE HANDBOOK. SPINS WITH',
          'FLAPS EXTENDED PROHIBITED. ALTITUDE LOSS IN A',
          'STALL RECOVERY 160 FT. FLIGHT INTO KNOWN ICING',
          'PROHIBITED.',
        ],
        size: 6.5,
      },
      { x: 1700, y: 168, lines: ['MANEUVERING SPEED', `${V.va} KIAS`], size: 8 },
      { x: 1700, y: 222, lines: ['FUEL 100LL / 100 MIN. GRADE', '24.5 U.S. GAL USABLE'], size: 8 },
    ],
    // Circuit breakers under the right panel, row by row: legend and rating, A.
    breakers: {
      bounds: { x: 1256, y: 680, w: 560, h: 110 },
      names: ['ALT FLD', 'INST', 'TURN COORD', 'FLAP', 'NAV LT', 'LAND LT', 'BCN', 'STROBE', 'PITOT HT', 'RADIO 1', 'RADIO 2', 'XPDR', 'CIG LTR', 'ALT'],
      amps: [5, 5, 5, 15, 5, 15, 5, 5, 15, 15, 15, 5, 15, 60],
      perRow: 7,
    },
    // The map compartment at the far right of the panel.
    glovebox: { x: 1580, y: 330, w: 236, h: 180 },
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
    engine: { x: ENGINE_ROW.fuel - 66, y: ENGINE_ROW.y - 66, w: ENGINE_ROW.oil - ENGINE_ROW.fuel + 132, h: 132 },
    stack: { x: STACK.x, y: STACK.navcom1, w: 320, h: STACK.blank - STACK.navcom1 },
  },
  // Ring centre and radius of each instrument a lesson can name (training/types.ts InstrumentId).
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
    fuel: { x: ENGINE_ROW.fuel, y: ENGINE_ROW.y, r: SMALL },
    oil: { x: ENGINE_ROW.oil, y: ENGINE_ROW.y, r: SMALL },
    flaps: { x: FLAPS.x + FLAPS.w / 2, y: FLAPS.y + FLAPS.h / 2, r: FLAPS.h / 2 },
  },
};

// ---------------------------------------------------------------------------------------------------
// Instrument systems

/** 100LL avgas, kg per US gallon (6.0 lb/gal). */
const KG_PER_GAL = 2.7216;
/** DC bus voltage below which electric gauges and lamps are dead (28 V system, as the C172S). */
const BUS_DEAD_VOLTS = 18;
/** Regulated suction in the green arc (4.6-5.4 inHg, s.9); the regulator is set to 5.0. */
const SUCTION_REGULATED_INHG = 5.0;
/** Suction at which an air-driven gyro reaches rated speed (bottom of the green arc). */
const SUCTION_RATED_INHG = 4.6;
/** The LOW VOLTAGE light comes on below this bus voltage: the 28 V battery alone is carrying the load. */
const LOW_VOLTS = 24.5;

/** The lamp needs bus power. */
const powered = (i: LampInputs): boolean => i.state.electrical.busVoltage > BUS_DEAD_VOLTS;

export const C152_INSTRUMENT_SYSTEMS: InstrumentSystemsDef = {
  engines: 1,
  // The optional engine-driven dry pump fitted to virtually every trainer (s.9): attitude and heading gyros are
  // air-driven, the turn coordinator electric.
  vacuum: {
    engines: [0],
    regulatedInHg: SUCTION_REGULATED_INHG,
    ratedInHg: SUCTION_RATED_INHG,
    // Pump capacity rises roughly with shaft speed and the regulator caps it (the C172S's fit: ~3.8 inHg at a
    // 600 rpm idle, full regulated suction above ~1300 rpm, so the 1700 rpm run-up reads in the green).
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
  lamps: [{ id: 'lowVolts', lit: (i) => powered(i) && i.state.electrical.busVoltage < LOW_VOLTS }],
};
