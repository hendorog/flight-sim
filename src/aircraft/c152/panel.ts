// Cessna 152 (1978 model): the instrument panel as data (gauges and their markings, switch row, magneto key,
// artwork, highlight spots) and what the instrument systems behind it need. CLOSURES.
//
// Arrangement of the POH's instrument panel figure (Fig 7-2, p.7-6/7-7; "#N" below is its key number), as close
// as the panel components allow. Top row: airspeed, attitude, the small clock, altimeter, VOR indicator; second
// row: turn coordinator, heading indicator, vertical speed (the ADF of the figure is not fitted). The tiny
// suction gauge sits between the airspeed indicator and the turn coordinator, the gyros slightly left of the
// control column. The radio stack in the centre; the tachometer right of centre with the ammeter and the one HIGH
// VOLTAGE lamp under it, the placard on the far right. Along the subpanel under the control wheel: the parking
// brake, the left and right fuel gauges either side of the magneto key, the oil temperature and pressure gauges
// right of the column; under them the split master, the key, the light rheostats and the light rockers (no
// fuel-pump rocker, no avionics master on the 1978 aircraft). Right of them the CARB HEAT knob, the throttle,
// the mixture and the flap pre-select lever with its position scale (the figure's flap switch and indicator),
// the circuit breakers under them either side of the flap scale and the map compartment at the right end
// (p.7-8). Further data from the type's engineering data sheet (aircraft-data/c152.md in the design work folder;
// "s.N" below is its section N). There is no EGT and no fuel-flow gauge.
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

// The 3-1/8" cases own 184 px squares; the gaps between the first three columns hold the round suction gauge (a
// 72 px flange) and the clock (108 px), so the VOR indicator ends at the radio stack.
const COLS = [93, 351, 643] as const;
const ROWS = [175, 361] as const;
/** The suction gauge at 0.6 of a 2-1/4" case between the first two columns; the clock at 0.9 in the next gap, low in the top row (#3, #7). */
const SUCTION = { x: 222, y: 268, scale: 0.6 };
const CLOCK = { x: 497, y: 210, scale: 0.9 };
const CDI = { x: 827, y: ROWS[0] };
/** Radio stack: rack units are 320 px wide (render/avionics.ts); the heights are repeated from there. */
const STACK = { x: 920, navcom1: 36, navcom2: 120, xpdr: 204, blank: 270 };
const TACH = { x: 1336, y: ROWS[0] };
const AMMETER = { x: 1500, y: 140 };
/**
 * The small rectangular engine gauges of the subpanel, centres: left and right fuel quantity either side of the
 * magneto key (#40, #38), oil temperature and oil pressure right of the control column (#35, #34).
 */
const ENGINE_ROW = { y: 618, w: 100, h: 70, fuelL: 185, fuelR: 295, oilTemp: 560, oilPress: 670 };
/** Control wheel shafts through the panel (3D boots; visual.ts puts the yokes here). */
const YOKES = { y: 545, xs: [442, 1398] as const, r: 58 };
/** The push-pull knobs along the top of the subpanel: carburettor heat, throttle, mixture (visual.ts engineControls). */
export const C152_KNOBS = { y: 670, carbHeat: 800, throttle: 920, mixture: 1040 } as const;
/** The parking brake handle at the left end of the subpanel, left of the fuel gauges (#43), px. */
export const C152_PARKING_BRAKE = [56, 628] as const;
/** Flap scale and lever slot: slot at local x 100, 0 deg at local y 80, 30 deg 200 px lower (FlapIndicator). */
const FLAPS: Rect = { x: 1100, y: 470, w: 130, h: 312 };
/** The lower strip of the subpanel: the master, the key under the fuel gauges, the rheostats, the rockers (#41, #39, #37, #33). */
const SWITCHES: Rect = { x: 16, y: 672, w: 720, h: 116 };
const ROW = {
  rockerTop: 44,
  rockerW: 24,
  rockerH: 42,
  magneto: { x: (ENGINE_ROW.fuelL + ENGINE_ROW.fuelR) / 2 - 16, y: 72 },
  dimmers: { panel: 320, radio: 368, y: 66 },
};
/** The subpanel strip under the primary panel (p.7-8). */
const SUBPANEL: Rect = { x: 4, y: 574, w: 1832, h: 222 };
/** Circuit breakers under the engine controls, either side of the flap scale (#26): one row of 6 + 6. */
const BREAKERS: Rect = { x: 756, y: 730, w: 816, h: 58 };
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
 * One side of the fuel quantity gauge: a 13 US gal tank, 12.25 gal usable (s.6). The gauge reads the whole tank
 * (C152_INSTRUMENT_SYSTEMS.fuel): full is 13, and the red arc is the "E plus red line" of s.9, the 0.75 gal
 * unusable left when the usable fuel is gone (POH p.7-19).
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

/** A rectangular engine gauge of the subpanel row, centred on x. */
const engineGauge = (id: string, x: number, title: string, scale: ScaleDef): GaugeDef => ({
  kind: 'sector',
  id,
  bounds: { x: x - ENGINE_ROW.w / 2, y: ENGINE_ROW.y - ENGINE_ROW.h / 2, w: ENGINE_ROW.w, h: ENGINE_ROW.h },
  title,
  scale,
});

const FUEL_LEFT = engineGauge('fuelLeft', ENGINE_ROW.fuelL, 'L FUEL U.S. GAL', fuelScale('L', (r) => r.fuelLeftGal));
const FUEL_RIGHT = engineGauge('fuelRight', ENGINE_ROW.fuelR, 'R FUEL U.S. GAL', fuelScale('R', (r) => r.fuelRightGal));
/** Oil temperature green 100-245 F, red line 245; oil pressure red lines 25 (idle) and 100 psi, green 60-90 (POH Fig 2-3). */
const OIL = {
  temp: {
    label: '°F',
    min: 75,
    max: 250,
    majors: [100, 150, 200, 245],
    minorStep: 25,
    arcs: [{ from: 100, to: 245, color: 'green' }],
    redLines: [245],
    read: (r) => r.oilTempF,
  } satisfies ScaleDef,
  press: {
    label: 'PSI',
    min: 0,
    max: 115,
    majors: [0, 25, 60, 90, 115],
    minorStep: 5,
    arcs: [{ from: 60, to: 90, color: 'green' }],
    redLines: [25, 100],
    read: (r) => r.oilPressurePsi,
  } satisfies ScaleDef,
};

const RED = '#ff3b2a';

/**
 * The one warning light, red HIGH VOLTAGE under the ammeter (POH p.7-20/7-21): the alternator is off line, so the
 * battery carries everything.
 */
export const C152_ANNUNCIATOR_LAMPS: readonly LampDef[] = [{ id: 'highVolts', text: 'HIGH VOLTAGE', color: RED, lit: (r) => r.lamps.highVolts }];

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

const RX = { alt: 110, bat: 135, beacon: 440, landing: 480, taxi: 520, nav: 560, strobe: 600, pitotHeat: 670 };

// ---------------------------------------------------------------------------------------------------

// Ring radii of the highlight spots: a little outside the glass of a 3-1/8" and of a 2-1/4" instrument.
const BIG = APERTURES.large * 1.1;
/** Round a pair of the subpanel's rectangular gauges. */
const PAIR = Math.hypot(ENGINE_ROW.fuelR - ENGINE_ROW.fuelL + ENGINE_ROW.w, ENGINE_ROW.h) / 2 + 4;

export const C152_PANEL: PanelDef = {
  id: 'c152',
  fixed: { flightRows: [['asi', 'attitude', 'altimeter', 'cdi1'], ['turn', 'heading', 'vsi']],
    controls: [{ x: SWITCHES.x, y: 680, w: SWITCHES.w, h: 120 }] },
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
    { kind: 'clock', id: 'clock', at: [CLOCK.x, CLOCK.y], scale: CLOCK.scale },
    { kind: 'suction', id: 'suction', at: [SUCTION.x, SUCTION.y], scale: C152_SUCTION_SCALE, caseScale: SUCTION.scale },
    { kind: 'tach', id: 'tach', at: [TACH.x, TACH.y], size: 'large', marks: C152_TACH_MARKS },
    { kind: 'ammeter', id: 'ammeter', at: [AMMETER.x, AMMETER.y], scale: C152_AMMETER_SCALE },
    FUEL_LEFT,
    FUEL_RIGHT,
    engineGauge('oilTemp', ENGINE_ROW.oilTemp, 'OIL TEMP °F', OIL.temp),
    engineGauge('oilPress', ENGINE_ROW.oilPress, 'OIL PRESS PSI', OIL.press),
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
    // The subpanel along the foot of the panel, under the control wheel shafts (#33-#43, #24-#29).
    plates: [{ bounds: SUBPANEL, color: '#3a3c40', radius: 4 }],
    // Sub-panel seams: pilot panel | centre stack | right panel.
    seamsX: [STACK.x - 18, STACK.x + 330],
    // Legend and sub-legend under the three push-pull knobs of the lower centre, and under the parking brake.
    bushings: [
      { at: [C152_KNOBS.carbHeat, C152_KNOBS.y], text: 'CARB HEAT', sub: 'PULL ON' },
      { at: [C152_KNOBS.throttle, C152_KNOBS.y], text: 'THROTTLE', sub: 'PUSH OPEN' },
      { at: [C152_KNOBS.mixture, C152_KNOBS.y], text: 'MIXTURE', sub: 'PUSH RICH' },
      { at: [C152_PARKING_BRAKE[0], C152_PARKING_BRAKE[1]], text: 'PARK BRAKE', sub: 'PULL' },
    ],
    // Placards: centre x and top y; lines; lettering size where not the default. The pilot's composite placard
    // of the right panel and the spin recovery placard above the altimeter, in the POH's words (p.2-8, 2-9); the
    // registration plate above the clock (#6; the livery's, visual.ts). The fuel placard is on the floor valve.
    placards: [
      {
        x: 1700,
        y: 30,
        lines: [
          'THIS AIRPLANE IS APPROVED IN THE UTILITY CATEGORY',
          'AND MUST BE OPERATED IN COMPLIANCE WITH THE',
          'OPERATING LIMITATIONS AS STATED IN THE FORM OF',
          'PLACARDS, MARKINGS AND MANUALS.',
          '— MAXIMUMS —',
          `MANEUVERING SPEED (IAS) ${V.va} KNOTS`,
          'GROSS WEIGHT 1670 LBS',
          'FLIGHT LOAD FACTOR FLAPS UP +4.4, -1.76',
          'FLAPS DOWN +3.5',
          '— NO ACROBATIC MANEUVERS APPROVED —',
          'EXCEPT: CHANDELLES, LAZY EIGHTS, STEEP TURNS 95 KNOTS;',
          'SPINS, STALLS (EXCEPT WHIP STALLS) SLOW DECELERATION.',
          `ABRUPT USE OF CONTROLS PROHIBITED ABOVE ${V.va} KNOTS.`,
          'INTENTIONAL SPINS WITH FLAPS EXTENDED ARE PROHIBITED.',
          'ALTITUDE LOSS IN STALL RECOVERY - 160 FT. FLIGHT INTO',
          'KNOWN ICING CONDITIONS PROHIBITED. THIS AIRPLANE IS',
          'CERTIFIED FOR THE FOLLOWING FLIGHT OPERATIONS AS OF',
          'DATE OF ORIGINAL AIRWORTHINESS CERTIFICATE:',
          'DAY - NIGHT - VFR - IFR',
        ],
        size: 6,
      },
      { x: CLOCK.x, y: 108, lines: ['N152FS'], size: 8 },
      {
        x: COLS[2],
        y: 24,
        lines: [
          'SPIN RECOVERY',
          '1. VERIFY AILERONS NEUTRAL AND THROTTLE CLOSED',
          '2. APPLY FULL OPPOSITE RUDDER',
          '3. MOVE CONTROL WHEEL BRISKLY FORWARD',
          'TO BREAK STALL',
          '4. NEUTRALIZE RUDDER AND RECOVER FROM DIVE',
        ],
        size: 5.5,
      },
    ],
    // Circuit breakers in one row under the engine controls, six left of the flap scale and six right of it:
    // legend and rating, A. Legends of POH Fig 7-7 (p.7-21), three radios fitted; ALT FLD is the auto-reset field
    // breaker.
    breakers: {
      bounds: BREAKERS,
      names: ['FUEL IND', 'BCN PITOT', 'STROBE LTS', 'LDG LTS', 'FLAP', 'INST LTS', 'NAV DOME', 'RADIO 1', 'RADIO 2', 'RADIO 3', 'ALT FLD', 'ALT'],
      amps: [5, 15, 5, 15, 15, 5, 5, 15, 15, 5, 5, 60],
      perRow: 12,
      split: { after: 6, gap: 160 },
    },
    // The map compartment at the right end of the subpanel (#23).
    glovebox: { x: 1600, y: 590, w: 216, h: 196 },
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
    sixpack: { x: COLS[0] - 92, y: ROWS[0] - 92, w: COLS[2] - COLS[0] + 184, h: 2 * 188 },
    engine: { x: ENGINE_ROW.fuelL - ENGINE_ROW.w / 2, y: ENGINE_ROW.y - ENGINE_ROW.h / 2, w: ENGINE_ROW.oilPress - ENGINE_ROW.fuelL + ENGINE_ROW.w, h: ENGINE_ROW.h },
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
    // Each ring round the pair of gauges.
    fuel: { x: (ENGINE_ROW.fuelL + ENGINE_ROW.fuelR) / 2, y: ENGINE_ROW.y, r: PAIR },
    oil: { x: (ENGINE_ROW.oilTemp + ENGINE_ROW.oilPress) / 2, y: ENGINE_ROW.y, r: PAIR },
    flaps: { x: FLAPS.x + FLAPS.w / 2, y: FLAPS.y + FLAPS.h / 2, r: FLAPS.h / 2 },
  },
};

// ---------------------------------------------------------------------------------------------------
// Instrument systems

/** 100LL avgas, kg per US gallon (6.0 lb/gal). */
const KG_PER_GAL = 2.7216;
/** Unusable fuel per tank, kg: 0.75 US gal (POH p.7-19). The physics tanks hold usable fuel only. */
const UNUSABLE_KG = 0.75 * KG_PER_GAL;
/** DC bus voltage below which electric gauges and lamps are dead (28 V system, as the C172S). */
const BUS_DEAD_VOLTS = 18;
/** Regulated suction in the green arc (4.6-5.4 inHg, s.9); the regulator is set to 5.0. */
const SUCTION_REGULATED_INHG = 5.0;
/** Suction at which an air-driven gyro reaches rated speed (bottom of the green arc). */
const SUCTION_RATED_INHG = 4.6;

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
  // Two wing tanks, one float sender each, reading the unusable fuel too: E with the usable fuel gone, 13 full.
  fuel: { kgPerGal: KG_PER_GAL, tanks: [(s) => s.fuel.left + UNUSABLE_KG, (s) => s.fuel.right + UNUSABLE_KG] },
  busDeadVolts: BUS_DEAD_VOLTS,
  tachHourRpm: TACH_HOUR_RPM,
  // A direct pressure oil line feeds the oil pressure gauge; only oil temperature is electric (POH p.7-14).
  oilPressureDirect: true,
  // HIGH VOLTAGE: lit while the alternator is off line, tripped by the over-voltage sensor (powerplant.ts) or switched
  // off with the BAT half on; ALT off is the POH's lamp test (p.7-21). A stopped engine with ALT on leaves it out.
  lamps: [{ id: 'highVolts', lit: (i) => powered(i) && (!i.controls.alternator || i.state.electrical.overVoltageTripped === true) }],
};
