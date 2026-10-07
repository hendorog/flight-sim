// Piper PA-34-200 Seneca I: the instrument panel as data (gauges and their markings, switch row, magneto toggles,
// artwork, highlight spots) and what the instrument systems behind it need. CLOSURES.
//
// Arrangement from the type's engineering data sheet (aircraft-data/pa34.md in the design work folder, s.9
// "Instruments"; "s.N" below is its section N), as close as the panel components allow. Upper panel: the six
// flight instruments in front of the left seat, the twin-needle manifold pressure and tachometer right of them,
// the radio stack in the centre, NAV 1 and NAV 2 right of it, the clock and the suction gauge over the right
// control wheel, the placards on the right. Lower panel: the engine clusters split by engine either side of the
// pilot's control column (left engine left of it, right engine right of it: oil temperature and pressure, cylinder
// head temperature and fuel pressure), the gear selector with its three greens and red left of the throttle
// quadrant, the guarded emergency gear knob over the quadrant at the panel centre, the fuel flow and fuel quantity
// gauges right of the quadrant, the two alternator load meters right of the right control wheel, the circuit
// breakers on the lower right. The real switch panel is on the left side wall beside the pilot (s.9); here it is
// the lower left of the face: the four magneto toggles and the starter rocker, then the master, the alternators,
// the electric fuel pumps, the lights and the pitot heat. No flap indicator (manual flaps on a floor lever), no
// pitch or rudder trim indicator on the face (both are on the floor tunnel).
//
// The face shown in the cockpit is the whole 2080 x 800 canvas at 2000 px/m (visual.ts: a panel 1.04 m wide and
// 0.40 m high, the C172S's scale), so the instruments are drawn at their real size. Airspeeds in knots, as the
// simulator shows them everywhere (the Seneca I's own indicator is marked in mph at the same calibrated speeds).

import { engineSwitch, singleGauge, twinEngineGauge, type EngineDial } from '../../instruments/panels/gauges';
import type { AsiMarkings, GaugeDef, InstrumentSystemsDef, LampDef, LampInputs, PanelDef, Rect, ScaleDef, SwitchDef } from '../types';
import { PA34_REFERENCE } from './reference';

const V = PA34_REFERENCE;

/** The part of the 2080 x 800 canvas the panel face shows (visual.ts CockpitDef.panel.pxRect): all of it, 1.04 m at 2000 px/m. */
export const PA34_PANEL_PX_RECT: Rect = { x: 0, y: 0, w: 2080, h: 800 };
/** Canvas px per metre of the face, and the px column of the aircraft's centreline. */
export const PA34_PANEL_PX_PER_M = 2000;
export const PA34_PANEL_CENTRE_PX = PA34_PANEL_PX_RECT.x + PA34_PANEL_PX_RECT.w / 2;

// ---------------------------------------------------------------------------------------------------
// Layout, canvas px. Left seat on y = -0.28 m (px 480), right seat on +0.28 m (px 1600).

const COLS = [296, 480, 664] as const;
const ROWS = [160, 346] as const;
/** Twin-needle manifold pressure over the twin-needle tachometer, right of the six-pack. */
const POWER = { x: 856, map: ROWS[0], rpm: ROWS[1] };
/**
 * Radio stack: rack units are 320 px wide (render/avionics.ts); the heights are repeated from there. Two nav/coms
 * and the transponder of the period (s.9) over a panel-mount GPS of the kind most Senecas carry today.
 */
const STACK = { x: 960, navcom1: 30, navcom2: 114, xpdr: 198, gps: 266, gpsH: 220 };
/** NAV 1 over NAV 2, right of the stack; the clock over the suction gauge right of them. */
const CDI = { x: 1400, y: ROWS };
const RIGHT_COLUMN = { x: 1560, clock: ROWS[0], suction: 330 };
/** Control wheel shafts through the panel (3D boots; visual.ts puts the yokes here). */
const YOKES = { y: 575, xs: [480, 1600] as const, r: 58 };
/** The row of engine gauges on the lower panel. */
const LOWER_Y = 560;
/** Engine clusters: the left engine's left of the pilot's control column, the right engine's right of it (s.9). */
const CLUSTER = { left: [220, 352] as const, right: [606, 738] as const };
/**
 * The throttle quadrant in front of the lower centre of the face (visual.ts builds it from these px): its body
 * covers x0 .. x1 from y0 down past the panel's lower edge. Nothing is painted there.
 */
export const PA34_QUADRANT = { x0: 876, x1: 1204, y0: 600 } as const;
/** The gear selector and its lights left of the quadrant (s.3, s.9); the emergency knob over the quadrant. */
const GEAR = { lights: { x: 808, y: 466, w: 112, h: 150 } as Rect, lever: [842, 700] as const, emergency: [1040, 552] as const };
/** Fuel flow and fuel quantity right of the quadrant; the two load meters right of the right control wheel. */
const RIGHT_LOWER = { fuelFlow: 1280, fuelQty: 1412, loadLeft: 1726, loadRight: 1858 };
const SWITCHES: Rect = { x: 250, y: 676, w: 520, h: 116 };
const ROW = { rockerTop: 44, rockerW: 24, rockerH: 42 };
/** The four magneto toggles and the starter rocker, left of the switch row. */
const IGNITION_AT = [128, 728] as const;
const APERTURES = { large: 74, small: 51 };

/** The 3D parts that stand on the panel, in px, for visual.ts (yoke columns, quadrant, gear selector). */
export const PA34_PANEL_PARTS = { yokes: YOKES, quadrant: PA34_QUADRANT, gearLever: GEAR.lever } as const;

// ---------------------------------------------------------------------------------------------------
// Markings (s.7 airspeed indicator, s.4 engine instruments)

/**
 * Airspeed indicator, knots (s.7, the AFM's marks): white arc 60-109 (Vs0 to the flaps-40 limit), green 66-165,
 * yellow 165-188, red line 188 (Vne), red radial 69 (Vmc), blue radial 91 (Vyse). The green arc starts at the
 * handbook's 66 KCAS, not at `vs1` (64, entered indicated). A 40-200 kt dial, the low end expanded.
 */
export const PA34_ASI_MARKS: AsiMarkings = {
  scaleKt: [0, 40, 60, 80, 100, 120, 140, 160, 180, 200, 210],
  scaleDeg: [0, 30, 70, 110, 148, 183, 216, 248, 278, 306, 320],
  tickFrom: 40,
  tickTo: 200,
  minorStep: 5,
  numberStep: 20,
  arcs: [
    { from: 66, to: V.vno, color: 'green' },
    { from: V.vno, to: V.vne, color: 'yellow' },
    { from: V.vs0, to: V.vfe[V.vfe.length - 1], color: 'white', inner: true },
  ],
  redLine: V.vne,
  redRadial: V.vmca,
  blueLine: V.vyse,
};

/** Rated (and maximum) engine speed, rpm (s.4: 200 hp at 2700 rpm, no time limit). */
const RATED_RPM = 2700;
/** One hour at this rpm records one tach hour: the normal cruise setting (s.11: 2400 rpm). */
const TACH_HOUR_RPM = 2400;

/**
 * Twin tachometer, rpm x 100 (s.4): green 500-2200 and 2400-2700, the red arc 2200-2400 (avoid continuous
 * operation without the propeller dampers), red line 2700.
 */
const TACH: EngineDial = {
  size: 'large',
  seed: 341,
  fromDeg: -130,
  toDeg: 130,
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
      { from: 24, to: RATED_RPM / 100, color: 'green' },
    ],
    redLines: [RATED_RPM / 100],
  },
};
/** Twin manifold pressure, inHg: no limit and no arc on the normally aspirated engine (s.4). */
const MANIFOLD: EngineDial = {
  size: 'large',
  seed: 342,
  fromDeg: -130,
  toDeg: 130,
  title: 'MAN PRESS',
  units: 'IN HG',
  labels: [10, 15, 20, 25, 30, 35],
  scale: { label: '', min: 10, max: 35, majors: [10, 15, 20, 25, 30, 35], minorStep: 1 },
};
/** Twin fuel flow, US gal/h: red line 19.2 (s.4). */
const FUEL_FLOW: EngineDial = {
  size: 'small',
  seed: 343,
  fromDeg: -120,
  toDeg: 120,
  title: 'FUEL FLOW',
  units: 'GAL/HR',
  labels: [0, 5, 10, 15, 20, 25],
  scale: { label: '', min: 0, max: 25, majors: [0, 5, 10, 15, 20, 25], minorStep: 1, redLines: [19.2] },
};
/** Load meter of one 60 A alternator (s.9: the ammeters are load meters, one per alternator; plan for 50 A). */
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

/** Suction gauge: 4.5-5.2 inHg (s.7); the regulators are set to 5.0 +/- 0.1 (s.9). */
export const PA34_SUCTION_SCALE: ScaleDef = {
  label: '',
  min: 2.6,
  max: 7,
  majors: [3, 4, 5, 6, 7],
  minorStep: 0.5,
  arcs: [{ from: 4.5, to: 5.2, color: 'green' }],
  read: (r) => r.suctionInHg,
};

/** Oil temperature green 75-245 F, red line 245; oil pressure green 60-90, yellow 25-60, red lines 25 and 90 psi (s.4). */
const oilGauge = (id: string, engine: number, side: string, at: readonly [number, number], seed: number): GaugeDef => ({
  kind: 'dual',
  id,
  at,
  seed,
  title: [`${side} OIL`, 'TEMP  PRESS'],
  left: {
    label: '°F',
    min: 60,
    max: 260,
    majors: [75, 150, 245],
    minorStep: 25,
    arcs: [{ from: 75, to: 245, color: 'green' }],
    redLines: [245],
    read: (r) => r.engines[engine]?.oilTempF ?? 0,
  },
  right: {
    label: 'PSI',
    min: 0,
    max: 115,
    majors: [0, 25, 60, 90, 115],
    minorStep: 5,
    arcs: [
      { from: 25, to: 60, color: 'yellow' },
      { from: 60, to: 90, color: 'green' },
    ],
    redLines: [25, 90],
    read: (r) => r.engines[engine]?.oilPressurePsi ?? 0,
  },
});
/** Cylinder head temperature green 200-475 F, red line 475; fuel pressure green 14-35 psi, red lines at both ends (s.4). */
const chtGauge = (id: string, engine: number, side: string, at: readonly [number, number], seed: number): GaugeDef => ({
  kind: 'dual',
  id,
  at,
  seed,
  title: [`${side} CYL HD`, 'TEMP  FUEL'],
  left: {
    label: '°F',
    min: 100,
    max: 500,
    majors: [200, 350, 475],
    minorStep: 25,
    arcs: [{ from: 200, to: 475, color: 'green' }],
    redLines: [475],
    read: (r) => r.engines[engine]?.chtF ?? 0,
  },
  right: {
    label: 'PSI',
    min: 0,
    max: 40,
    majors: [0, 14, 35, 40],
    minorStep: 2,
    arcs: [{ from: 14, to: 35, color: 'green' }],
    redLines: [14, 35],
    read: (r) => r.engines[engine]?.fuelPressurePsi ?? 0,
  },
});

/** One gauge for both tanks: 49 US gal each, 46.5 usable (s.6, s.9). */
const FUEL_QTY: GaugeDef = {
  kind: 'dual',
  id: 'fuel',
  at: [RIGHT_LOWER.fuelQty, LOWER_Y],
  seed: 344,
  title: ['FUEL QTY', 'U.S. GAL'],
  left: { label: 'L', min: 0, max: 50, majors: [0, 25, 50], minorStep: 5, arcs: [{ from: 0, to: 2.5, color: 'red' }], read: (r) => r.fuelGal[0] ?? 0 },
  right: { label: 'R', min: 0, max: 50, majors: [0, 25, 50], minorStep: 5, arcs: [{ from: 0, to: 2.5, color: 'red' }], read: (r) => r.fuelGal[1] ?? 0 },
};

const RED = '#ff3b2a';

/**
 * The red over-voltage light beside each alternator switch (s.9): the regulator's relay has dropped the
 * alternator off line. Shown here as the alternator giving no output on a live bus, over the two ALT switches.
 */
export const PA34_ANNUNCIATOR_LAMPS: readonly LampDef[] = [
  { id: 'leftAlternator', text: 'L ALT', color: RED, lit: (r) => r.lamps.leftAlternator },
  { id: 'rightAlternator', text: 'R ALT', color: RED, lit: (r) => r.lamps.rightAlternator },
];

// ---------------------------------------------------------------------------------------------------
// Switch row (s.9): the master, the two alternators, the two electric fuel pumps (one per engine), the lights and
// the pitot heat. No avionics master: each radio has its own switch.

const rocker = (id: string, label: string, name: string, x: number, on: SwitchDef['on'], toggle: SwitchDef['toggle'], more: Pick<SwitchDef, 'red' | 'group'> = {}): SwitchDef => ({
  id,
  label,
  name,
  x,
  ...more,
  on,
  toggle,
});

const RX = { master: 34, lAlt: 92, rAlt: 122, lPump: 182, rPump: 212, nav: 272, landing: 307, taxi: 342, strobe: 377, beacon: 412, pitotHeat: 474 };

// ---------------------------------------------------------------------------------------------------

// Ring radii of the highlight spots: a little outside the glass of a 3-1/8" and of a 2-1/4" instrument.
const BIG = APERTURES.large * 1.1;
const SMALL = APERTURES.small * 1.15;

export const PA34_PANEL: PanelDef = {
  id: 'pa34',
  size: { w: 2080, h: 800 },
  // In the order the panel draws them.
  gauges: [
    { kind: 'asi', id: 'asi', at: [COLS[0], ROWS[0]], marks: PA34_ASI_MARKS },
    { kind: 'attitude', id: 'attitude', at: [COLS[1], ROWS[0]] },
    { kind: 'altimeter', id: 'altimeter', at: [COLS[2], ROWS[0]] },
    { kind: 'turn', id: 'turn', at: [COLS[0], ROWS[1]] },
    { kind: 'heading', id: 'heading', at: [COLS[1], ROWS[1]] },
    { kind: 'vsi', id: 'vsi', at: [COLS[2], ROWS[1]] },
    twinEngineGauge('manifold', [POWER.x, POWER.map], MANIFOLD, (e) => e.manifoldInHg),
    twinEngineGauge('tach', [POWER.x, POWER.rpm], TACH, (e) => e.rpm / 100),
    // NAV 1 over NAV 2; NAV 1's course card set to runway 07 when nothing turns the OBS.
    { kind: 'cdi', id: 'cdi1', at: [CDI.x, CDI.y[0]], receiver: 'nav1', fixedCourseDeg: 70 },
    { kind: 'cdi', id: 'cdi2', at: [CDI.x, CDI.y[1]], receiver: 'nav2', fixedCourseDeg: 70 },
    { kind: 'clock', id: 'clock', at: [RIGHT_COLUMN.x, RIGHT_COLUMN.clock] },
    { kind: 'suction', id: 'suction', at: [RIGHT_COLUMN.x, RIGHT_COLUMN.suction], scale: PA34_SUCTION_SCALE },
    oilGauge('oilLeft', 0, 'L', [CLUSTER.left[0], LOWER_Y], 345),
    chtGauge('chtLeft', 0, 'L', [CLUSTER.left[1], LOWER_Y], 346),
    oilGauge('oilRight', 1, 'R', [CLUSTER.right[0], LOWER_Y], 347),
    chtGauge('chtRight', 1, 'R', [CLUSTER.right[1], LOWER_Y], 348),
    twinEngineGauge('fuelFlow', [RIGHT_LOWER.fuelFlow, LOWER_Y], FUEL_FLOW, (e) => e.fuelFlowGph),
    FUEL_QTY,
    singleGauge('loadLeft', [RIGHT_LOWER.loadLeft, LOWER_Y], loadMeter(349, 'L ALT'), (r) => r.alternatorAmps[0] ?? 0),
    singleGauge('loadRight', [RIGHT_LOWER.loadRight, LOWER_Y], loadMeter(350, 'R ALT'), (r) => r.alternatorAmps[1] ?? 0),
    { kind: 'navcom', id: 'navcom1', bounds: { x: STACK.x, y: STACK.navcom1, w: 320, h: 76 } },
    { kind: 'navcom', id: 'navcom2', bounds: { x: STACK.x, y: STACK.navcom2, w: 320, h: 76 } },
    { kind: 'xpdr', id: 'xpdr', bounds: { x: STACK.x, y: STACK.xpdr, w: 320, h: 60 } },
    { kind: 'gps', id: 'gps', bounds: { x: STACK.x, y: STACK.gps, w: 320, h: STACK.gpsH } },
    // Three greens and the red, the selector under them (pull out to move, s.3); the guarded emergency knob.
    { kind: 'gearLights', id: 'gear', bounds: GEAR.lights, lever: GEAR.lever },
    { kind: 'guardedKnob', id: 'gearEmergency', at: GEAR.emergency, label: 'EMERG GEAR', action: 'gearEmergency' },
  ],
  // The two lamps just over the ALT L / R rockers of the switch row (s.9: beside each alternator switch).
  annunciator: { bounds: { x: SWITCHES.x + (RX.lAlt + RX.rAlt) / 2 - 92, y: SWITCHES.y - 48, w: 184, h: 34 }, lamps: PA34_ANNUNCIATOR_LAMPS },
  switchRow: {
    bounds: SWITCHES,
    rockerTop: ROW.rockerTop,
    rockerW: ROW.rockerW,
    rockerH: ROW.rockerH,
    switches: [
      rocker('battery', 'MASTER', 'Master', RX.master, (c) => c.masterBattery, (c) => { c.masterBattery = !c.masterBattery; }, { red: true }),
      engineSwitch('leftAlternator', 'L', 'Left alternator', RX.lAlt, 'alternator', 0, { group: 'alternators' }),
      engineSwitch('rightAlternator', 'R', 'Right alternator', RX.rAlt, 'alternator', 1, { group: 'alternators' }),
      engineSwitch('leftFuelPump', 'L', 'Left electric fuel pump', RX.lPump, 'fuelPump', 0, { group: 'pumps' }),
      engineSwitch('rightFuelPump', 'R', 'Right electric fuel pump', RX.rPump, 'fuelPump', 1, { group: 'pumps' }),
      rocker('nav', 'NAV', 'Nav lights', RX.nav, (c) => c.lights.nav, (c) => { c.lights.nav = !c.lights.nav; }, { group: 'lights' }),
      rocker('landing', 'LAND', 'Landing light', RX.landing, (c) => c.lights.landing, (c) => { c.lights.landing = !c.lights.landing; }, { group: 'lights' }),
      rocker('taxi', 'TAXI', 'Taxi light', RX.taxi, (c) => c.lights.taxi, (c) => { c.lights.taxi = !c.lights.taxi; }, { group: 'lights' }),
      rocker('strobe', 'STROBE', 'Strobes', RX.strobe, (c) => c.lights.strobe, (c) => { c.lights.strobe = !c.lights.strobe; }, { group: 'lights' }),
      rocker('beacon', 'BCN', 'Beacon', RX.beacon, (c) => c.lights.beacon, (c) => { c.lights.beacon = !c.lights.beacon; }, { group: 'lights' }),
      rocker('pitotHeat', 'PITOT HT', 'Pitot heat', RX.pitotHeat, (c) => c.pitotHeat, (c) => { c.pitotHeat = !c.pitotHeat; }),
    ],
    // Local px of the row: the tabs of the brackets over the alternators, the pumps and the lights.
    legends: [
      { text: 'ALT', x: (RX.lAlt + RX.rAlt) / 2, y: ROW.rockerTop - 24, size: 8.5 },
      { text: 'FUEL PUMP', x: (RX.lPump + RX.rPump) / 2, y: ROW.rockerTop - 24, size: 7.5 },
      { text: 'LIGHTS', x: (RX.nav + RX.beacon) / 2, y: ROW.rockerTop - 24, size: 8.5 },
    ],
  },
  // Panel px: L and R magneto toggles of each engine either side of the starter rocker (s.4, s.9).
  ignition: { kind: 'toggles', at: IGNITION_AT, engines: 2 },
  background: {
    // Sub-panel seams either side of the radio stack (the flat full-width panel, s.12).
    seamsX: [944, 1296],
    // Legends of the controls that are painted, not built: the alternate static valve under the panel right of the
    // quadrant, the heater and defroster controls on the right (s.9).
    bushings: [
      { at: [1250, 712], text: 'ALT STATIC', sub: 'PULL ON' },
      { at: [1990, 440], text: 'CABIN HEAT', sub: 'PULL ON' },
      { at: [1990, 560], text: 'DEFROST', sub: 'PULL ON' },
    ],
    // Placards: centre x and top y; lines; lettering size where not the default.
    placards: [
      { x: 102, y: 96, lines: ['AVOID CONTINUOUS', 'OPERATION BETWEEN', '2200 AND 2400 RPM'], size: 6.5 },
      {
        x: 1850,
        y: 34,
        lines: [
          'THIS AIRPLANE MUST BE OPERATED AS A NORMAL',
          'CATEGORY AIRPLANE IN COMPLIANCE WITH THE',
          'OPERATING LIMITATIONS STATED IN THE FORM OF',
          'PLACARDS, MARKINGS AND MANUALS.',
          'NO ACROBATIC MANEUVERS INCLUDING SPINS APPROVED.',
        ],
        size: 6.5,
      },
      // The handbook's speeds are calibrated airspeeds (s.7: the Seneca I's IAS reads about 1-2 kt low).
      { x: 1850, y: 128, lines: ['ONE ENGINE INOPERATIVE', `VMC ${V.vmca} KCAS · VYSE ${V.vyse} KCAS`], size: 8 },
      { x: 1850, y: 180, lines: ['MANEUVERING SPEED', `${V.va} KCAS AT 4200 LB`], size: 8 },
      { x: 1850, y: 232, lines: [`GEAR DOWN ${V.vloExtend} KCAS MAX`, `GEAR UP ${V.vloRetract} KCAS MAX`], size: 7.5 },
      { x: 1850, y: 284, lines: [`FLAPS 10° ${V.vfe[0]} · 25° ${V.vfe[1]} · 40° ${V.vfe[2]} KCAS`], size: 7.5 },
      { x: 1850, y: 318, lines: ['NO TAKE-OFF OR LANDING', 'WITH A SELECTOR ON CROSSFEED'], size: 7 },
    ],
    // Push-to-reset circuit breakers on the lower right (s.9): legend and rating, A.
    breakers: {
      bounds: { x: 1680, y: 682, w: 380, h: 108 },
      names: ['L ALT', 'R ALT', 'GEAR PUMP', 'GEAR WARN', 'STALL WARN', 'TURN', 'L PUMP', 'R PUMP', 'NAV LT', 'LAND LT', 'PITOT HT', 'RADIO 1', 'RADIO 2', 'XPDR'],
      amps: [60, 60, 25, 5, 5, 5, 5, 5, 10, 15, 15, 5, 5, 5],
      perRow: 7,
    },
    // Rack rails of the centre stack.
    rack: { rails: { x: STACK.x - 4, y: STACK.navcom1 - 6, w: 328, h: STACK.gps + STACK.gpsH + 12 - STACK.navcom1 }, blanks: [] },
  },
  // The control wheel shaft boots.
  keepOut: YOKES.xs.map((x) => ({ x, y: YOKES.y, r: YOKES.r })),
  apertures: APERTURES,
  // The instrument groups of InstrumentPanel.drawTo().
  regions: {
    sixpack: { x: COLS[0] - 92, y: ROWS[0] - 92, w: 3 * 184, h: 2 * 188 },
    engine: { x: POWER.x - 92, y: POWER.map - 92, w: 184, h: 2 * 188 },
    stack: { x: STACK.x, y: STACK.navcom1, w: 320, h: STACK.gps + STACK.gpsH - STACK.navcom1 },
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
    tach: { x: POWER.x, y: POWER.rpm, r: BIG },
    fuel: { x: RIGHT_LOWER.fuelQty, y: LOWER_Y, r: SMALL },
    // Both engines' oil gauges in one ring.
    oil: { x: (CLUSTER.left[0] + CLUSTER.right[0]) / 2, y: LOWER_Y, r: (CLUSTER.right[0] - CLUSTER.left[0]) / 2 + SMALL },
  },
};

// ---------------------------------------------------------------------------------------------------
// Instrument systems

/** 100LL avgas, kg per US gallon (6.0 lb/gal). */
const KG_PER_GAL = 2.7216;
/** DC bus voltage below which electric gauges and lamps are dead: the 14 V system (12 V battery, s.9). */
const BUS_DEAD_VOLTS = 9;
/** Regulated suction (s.9: 5.0 +/- 0.1 inHg at 2000 rpm). */
const SUCTION_REGULATED_INHG = 5.0;
/** Suction at which an air-driven gyro reaches rated speed (bottom of the green arc, s.7). */
const SUCTION_RATED_INHG = 4.5;
/** Alternator output below which its light shows: the alternator is off line, A. */
const ALT_LAMP_AMPS = 0.5;

/** The lamp needs bus power. */
const powered = (i: LampInputs): boolean => i.state.electrical.busVoltage > BUS_DEAD_VOLTS;

export const PA34_INSTRUMENT_SYSTEMS: InstrumentSystemsDef = {
  engines: 2,
  // A dry pump on each engine, either one carries all the gyros to 12,500 ft (s.9); the attitude and heading gyros
  // are air-driven, the turn coordinator electric.
  vacuum: {
    engines: [0, 1],
    regulatedInHg: SUCTION_REGULATED_INHG,
    ratedInHg: SUCTION_RATED_INHG,
    // Pump capacity rises roughly with shaft speed and the regulator caps it (the C172S's fit): 5.0 inHg at the
    // 2000 rpm run-up.
    suction: (engineRpm) => (engineRpm <= 0 ? 0 : Math.min(SUCTION_REGULATED_INHG, 5.4 * (1 - Math.exp(-engineRpm / 470)))),
  },
  gyroDrive: { attitude: 'vacuum', heading: 'vacuum' },
  // One combined tank a side, one gauge needle each (s.9).
  fuel: { kgPerGal: KG_PER_GAL, tanks: [(s) => s.fuel.left, (s) => s.fuel.right] },
  busDeadVolts: BUS_DEAD_VOLTS,
  tachHourRpm: TACH_HOUR_RPM,
  lamps: [
    { id: 'leftAlternator', lit: (i) => powered(i) && (i.state.electrical.alternators[0] ?? 0) < ALT_LAMP_AMPS },
    { id: 'rightAlternator', lit: (i) => powered(i) && (i.state.electrical.alternators[1] ?? 0) < ALT_LAMP_AMPS },
  ],
};
