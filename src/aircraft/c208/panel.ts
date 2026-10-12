// Cessna 208 Caravan 675: the instrument panel as data (gauges and their markings, switch row, the STARTER and
// IGNITION switches, artwork, highlight spots) and what the instrument systems behind it need. CLOSURES.
//
// The analogue ("steam") panel of the 208 before the G1000, as close as the panel components allow (POH sect. 7,
// the instrument panel figure). In front of the left seat the six flight instruments with the clock and the
// suction gauge left of them and the two VOR / LOC indicators right of them; then the vertical column of engine
// instruments left of centre, top to bottom: torque, ITT, propeller rpm (Np), gas-generator rpm (Ng), fuel flow,
// oil pressure and temperature. The annunciator panel over the radio stack in the centre; the centre pedestal
// with the POWER, PROPELLER and CONDITION levers under it (3D, visual.ts). Right of the stack the two fuel
// quantity indicators and the volt / ammeter, the flap selector with its position scale on the lower panel; the
// co-pilot's airspeed, attitude, altimeter, heading and vertical speed over the right control wheel; placards and
// the circuit breakers on the right. The switch panel on the lower left: STARTER and IGNITION, then the battery,
// generator, avionics, fuel boost, lights and pitot heat; the parking brake handle under it.
//
// The face shown in the cockpit is the whole 2920 x 920 canvas at 2000 px/m (panelLayout.ts, shared with
// visual.ts), so the instruments are drawn at their real size. Airspeeds in knots.

import { singleGauge, type EngineDial } from '../../instruments/panels/gauges';
import type { AsiMarkings, GaugeDef, InstrumentSystemsDef, LampDef, LampInputs, PanelDef, ScaleDef, SwitchDef } from '../types';
import {
  C208_FLAP_SELECTOR,
  C208_PANEL_CENTRE_PX,
  C208_PANEL_PARTS,
  C208_PANEL_PX_PER_M,
  C208_PANEL_PX_RECT,
  C208_PANEL_SIZE,
  C208_PARKING_BRAKE,
  C208_PEDESTAL,
  C208_YOKES,
} from './panelLayout';
import { C208_MAX_NP, PT6A_114A } from './powerplant';
import { C208_REFERENCE } from './reference';

// The face facts visual.ts builds its 3D parts on, under the names the other types' panel.ts files export.
export {
  C208_FLAP_SELECTOR,
  C208_PANEL_CENTRE_PX,
  C208_PANEL_PARTS,
  C208_PANEL_PX_PER_M,
  C208_PANEL_PX_RECT,
  C208_PANEL_SIZE,
  C208_PARKING_BRAKE,
  C208_PEDESTAL,
  C208_YOKES,
};

const V = C208_REFERENCE;

// ---------------------------------------------------------------------------------------------------
// Layout, canvas px. Left seat on y = -0.38 m (px 700), right seat on +0.38 m (px 2220).

const PILOT_X = C208_YOKES.xs[0];
const COPILOT_X = C208_YOKES.xs[1];
/** The pilot's six-pack: the attitude indicator over the control wheel. */
const COLS = [PILOT_X - 184, PILOT_X, PILOT_X + 184] as const;
const ROWS = [150, 336] as const;
/** Clock over the suction gauge, left of the airspeed indicator. */
const LEFT_COLUMN = { x: 330, clock: 130, suction: 270 };
/** NAV 1 over NAV 2, right of the six-pack. */
const CDI = { x: COLS[2] + 184, y: ROWS };
/** The engine instruments: one vertical column of 2-1/4" indicators left of the radio stack. */
const ENGINE_COLUMN = { x: 1236, y: [160, 294, 428, 562, 696, 830] as const };
/**
 * Radio stack: rack units are 320 px wide (render/avionics.ts); the heights are repeated from there. Two nav / coms,
 * a panel-mount GPS and the transponder; a blanking plate (the audio panel's bay) above the pedestal.
 */
const STACK = { x: 1330, navcom1: 92, navcom2: 176, gps: 260, gpsH: 220, xpdr: 488, blank: 556, blankH: 128 };
/** Annunciator panel over the stack: two rows of five. */
const ANNUNCIATOR = { x: C208_PANEL_CENTRE_PX - 235, y: 10, w: 470, h: 62 };
/** Fuel quantity, left over right, then the volt / ammeter, right of the stack. */
const RIGHT_OF_STACK = { x: 1800, fuelLeft: 160, fuelRight: 294, voltAmp: 450 };
/** The co-pilot's instruments over the right control wheel. */
const CO_COLS = [COPILOT_X - 184, COPILOT_X, COPILOT_X + 184] as const;
/** Flap position scale and the selector's slot (render/controls.ts FlapIndicator: slot at local x 100, 0 deg at local y 80). */
const FLAPS = { x: C208_FLAP_SELECTOR.x - 100, y: C208_FLAP_SELECTOR.y - 80, w: 130, h: 312 };
/** The switch panel on the lower left, right of the STARTER and IGNITION switches. */
const SWITCHES = { x: 236, y: 680, w: 400, h: 116 };
const ROW = { rockerTop: 44, rockerW: 24, rockerH: 42 };
/** STARTER and IGNITION, at the left end of the switch panel. */
const IGNITION_AT = [128, 728] as const;
const APERTURES = { large: 74, small: 51 };

// ---------------------------------------------------------------------------------------------------
// Markings (POH sect. 2)

/**
 * Airspeed indicator, KIAS: white arc 60-125 (Vs0 to the flaps-FULL limit), green 70-175, red line 175 (Vmo).
 * A turboprop has no yellow arc. A 40-200 kt dial, the low end expanded.
 */
export const C208_ASI_MARKS: AsiMarkings = {
  scaleKt: [0, 40, 60, 80, 100, 120, 140, 160, 180, 200, 210],
  scaleDeg: [0, 30, 70, 110, 148, 183, 216, 248, 278, 306, 320],
  tickFrom: 40,
  tickTo: 200,
  minorStep: 5,
  numberStep: 20,
  arcs: [
    { from: V.vs1, to: V.vne, color: 'green' },
    { from: V.vs0, to: V.vfe[V.vfe.length - 1], color: 'white', inner: true },
  ],
  redLine: V.vne,
};

/** Jet A at 6.7 lb per US gallon (the POH's figure), kg per gallon. */
const LB_PER_GAL = 6.7;
const KG_PER_LB = 0.45359237;
const KG_PER_GAL = LB_PER_GAL * KG_PER_LB;
/** ft lbf per N m. */
const FT_LBF_PER_NM = 1 / 1.3558179;
/** Reduction gearbox: the torque gauge reads the propeller shaft, EngineState.torque is the power turbine's. */
const GEAR_RATIO = PT6A_114A.gearRatio;

/** Torque limit, ft lbf (POH sect. 2: 1865 for take-off and maximum continuous). */
export const C208_TORQUE_LIMIT_FTLB = 1865;
/** ITT: maximum for take-off and maximum continuous, and the starting limit (2 s), deg C (POH sect. 2). */
export const C208_ITT_LIMIT_C = 805;
export const C208_ITT_START_LIMIT_C = 1090;
/** Top of the ITT green arc: the maximum normal climb and cruise ITT, deg C. */
const ITT_NORMAL_C = 740;
/** Ng: green 52 % (low idle) to 101.6 %, red line 101.6 % (POH sect. 2). */
const NG_IDLE_PCT = 52;
export const C208_NG_LIMIT_PCT = 101.6;
/** Np: green 1600-1900 rpm, red line 1900 (POH sect. 2). */
const NP_MIN = 1600;
/** Oil: pressure green 85-105, yellow 40-85, red below 40 and above 105 psi; temperature green 10-99 C, red 99. */
const OIL = { minPsi: 40, greenPsi: 85, maxPsi: 105, minC: 10, maxC: 99 };
/** Bus voltage below which the VOLTAGE LOW light comes on (POH sect. 7: 24.5 V), and the 200 A starter-generator. */
const LOW_VOLTS = 24.5;
const GENERATOR_AMPS = 200;
/** Fuel in a tank below which its FUEL LOW light comes on (POH sect. 7: about 25 US gal), US gal. */
const FUEL_LOW_GAL = 25;
/** Fuel pressure below which FUEL PRESS LOW comes on (POH sect. 7: 4.75 psi), and oil pressure for OIL PRESS LOW. */
const FUEL_PRESS_LOW_PSI = 4.75;
/** Suction below which VACUUM LOW comes on, inHg. */
const VACUUM_LOW_INHG = 3;

/** Torque indicator, ft lbf x 100: green 0-1865, red line 1865. */
const TORQUE: EngineDial = {
  size: 'small',
  seed: 801,
  fromDeg: -125,
  toDeg: 125,
  title: 'TORQUE',
  units: 'FT-LB X100',
  labels: [0, 4, 8, 12, 16, 20, 24],
  scale: {
    label: '',
    min: 0,
    max: 24,
    majors: [0, 4, 8, 12, 16, 20, 24],
    minorStep: 1,
    arcs: [{ from: 0, to: C208_TORQUE_LIMIT_FTLB / 100, color: 'green' }],
    redLines: [C208_TORQUE_LIMIT_FTLB / 100],
  },
};
/** Inter-turbine temperature, deg C x 100: green 100-740, yellow 740-805, red line 805, red mark at 1090 (starting). */
const ITT: EngineDial = {
  size: 'small',
  seed: 802,
  fromDeg: -125,
  toDeg: 125,
  title: 'ITT',
  units: '°C X100',
  labels: [0, 2, 4, 6, 8, 10, 12],
  scale: {
    label: '',
    min: 0,
    max: 12,
    majors: [0, 2, 4, 6, 8, 10, 12],
    minorStep: 0.5,
    arcs: [
      { from: 1, to: ITT_NORMAL_C / 100, color: 'green' },
      { from: ITT_NORMAL_C / 100, to: C208_ITT_LIMIT_C / 100, color: 'yellow' },
    ],
    redLines: [C208_ITT_LIMIT_C / 100, C208_ITT_START_LIMIT_C / 100],
  },
};
/** Propeller rpm x 100: green 1600-1900, red line 1900. */
const NP: EngineDial = {
  size: 'small',
  seed: 803,
  fromDeg: -125,
  toDeg: 125,
  title: 'PROP RPM',
  units: 'X100',
  labels: [0, 4, 8, 12, 16, 20, 24],
  scale: {
    label: '',
    min: 0,
    max: 24,
    majors: [0, 4, 8, 12, 16, 20, 24],
    minorStep: 1,
    arcs: [{ from: NP_MIN / 100, to: C208_MAX_NP / 100, color: 'green' }],
    redLines: [C208_MAX_NP / 100],
  },
};
/** Gas-generator rpm, %: green 52-101.6, red line 101.6. */
const NG: EngineDial = {
  size: 'small',
  seed: 804,
  fromDeg: -125,
  toDeg: 125,
  title: 'GAS GEN',
  units: '% RPM',
  labels: [0, 20, 40, 60, 80, 100],
  scale: {
    label: '',
    min: 0,
    max: 110,
    majors: [0, 20, 40, 60, 80, 100],
    minorStep: 5,
    arcs: [{ from: NG_IDLE_PCT, to: C208_NG_LIMIT_PCT, color: 'green' }],
    redLines: [C208_NG_LIMIT_PCT],
  },
};
/** Fuel flow, lb/h x 100: no markings. */
const FUEL_FLOW: EngineDial = {
  size: 'small',
  seed: 805,
  fromDeg: -125,
  toDeg: 125,
  title: 'FUEL FLOW',
  units: 'PPH X100',
  labels: [0, 1, 2, 3, 4, 5, 6],
  scale: { label: '', min: 0, max: 6, majors: [0, 1, 2, 3, 4, 5, 6], minorStep: 0.2 },
};
/** One tank's fuel quantity indicator, lb x 100: 0 to about 1112 lb usable, yellow below the FUEL LOW point. */
const fuelDial = (seed: number, side: string): EngineDial => ({
  size: 'small',
  seed,
  fromDeg: -125,
  toDeg: 125,
  title: `${side} FUEL`,
  units: 'LBS X100',
  labels: [0, 2, 4, 6, 8, 10, 12],
  scale: {
    label: '',
    min: 0,
    max: 12,
    majors: [0, 2, 4, 6, 8, 10, 12],
    minorStep: 0.5,
    arcs: [{ from: 0, to: (FUEL_LOW_GAL * LB_PER_GAL) / 100, color: 'yellow' }],
  },
});

/** Oil pressure (psi) and temperature (deg C) of the engine, one 2-1/4" dual indicator. */
const OIL_GAUGE: GaugeDef = {
  kind: 'dual',
  id: 'oil',
  at: [ENGINE_COLUMN.x, ENGINE_COLUMN.y[5]],
  seed: 806,
  title: ['OIL', '°C   PSI'],
  left: {
    label: '°C',
    min: -40,
    max: 140,
    majors: [-40, 10, 99, 140],
    minorStep: 10,
    arcs: [{ from: OIL.minC, to: OIL.maxC, color: 'green' }],
    redLines: [OIL.maxC],
    read: (r) => ((r.engines[0]?.oilTempF ?? 32) - 32) * (5 / 9),
  },
  right: {
    label: 'PSI',
    min: 0,
    max: 200,
    majors: [0, 40, 85, 105, 200],
    minorStep: 10,
    arcs: [
      { from: OIL.minPsi, to: OIL.greenPsi, color: 'yellow' },
      { from: OIL.greenPsi, to: OIL.maxPsi, color: 'green' },
    ],
    redLines: [OIL.minPsi, OIL.maxPsi],
    read: (r) => r.engines[0]?.oilPressurePsi ?? 0,
  },
};

/** Volt / ammeter: bus voltage (green 24.5-28.5 V) and the starter-generator's load (red line 200 A). */
const VOLT_AMP: GaugeDef = {
  kind: 'dual',
  id: 'voltAmp',
  at: [RIGHT_OF_STACK.x, RIGHT_OF_STACK.voltAmp],
  seed: 807,
  title: ['GEN', 'VOLTS  AMPS'],
  left: {
    label: 'V',
    min: 16,
    max: 32,
    majors: [16, 24, 28, 32],
    minorStep: 1,
    arcs: [{ from: LOW_VOLTS, to: 28.5, color: 'green' }],
    read: (r) => r.busVolts,
  },
  right: {
    label: 'A',
    min: 0,
    max: 250,
    majors: [0, 100, 200, 250],
    minorStep: 25,
    redLines: [GENERATOR_AMPS],
    read: (r) => r.alternatorAmps[0] ?? 0,
  },
};

/** Suction gauge: 4.5-5.5 inHg (the bleed-air ejector's regulated range). */
export const C208_SUCTION_SCALE: ScaleDef = {
  label: '',
  min: 2.6,
  max: 7,
  majors: [3, 4, 5, 6, 7],
  minorStep: 0.5,
  arcs: [{ from: 4.5, to: 5.5, color: 'green' }],
  read: (r) => r.suctionInHg,
};

const AMBER = '#ffb21e';
const RED = '#ff3b2a';
const GREEN = '#46e05a';

/**
 * The annunciator panel over the stack (POH sect. 7), warnings red, cautions amber, advisories green. The lamps of
 * the analogue 208 that the simulation drives; RESERVOIR FUEL LOW, CHIP DETECTOR, EMERGENCY POWER LEVER and the
 * standby electrical lamps are not fitted (nothing models them).
 */
export const C208_ANNUNCIATOR_LAMPS: readonly LampDef[] = [
  { id: 'oilPress', text: 'OIL PRESS LOW', color: RED, lit: (r) => r.lamps.oilPress },
  { id: 'fuelSelectOff', text: 'FUEL SELECT OFF', color: RED, lit: (r) => r.lamps.fuelSelectOff },
  { id: 'generatorOff', text: 'GENERATOR OFF', color: AMBER, lit: (r) => r.lamps.generatorOff },
  { id: 'voltageLow', text: 'VOLTAGE LOW', color: AMBER, lit: (r) => r.lamps.voltageLow },
  { id: 'vacuumLow', text: 'VACUUM LOW', color: AMBER, lit: (r) => r.lamps.vacuumLow },
  { id: 'leftFuelLow', text: 'L FUEL LOW', color: AMBER, lit: (r) => r.lamps.leftFuelLow },
  { id: 'fuelPressLow', text: 'FUEL PRESS LOW', color: AMBER, lit: (r) => r.lamps.fuelPressLow },
  { id: 'starterEnergized', text: 'STARTER ENERGIZED', color: AMBER, lit: (r) => r.lamps.starterEnergized },
  { id: 'ignitionOn', text: 'IGNITION ON', color: GREEN, lit: (r) => r.lamps.ignitionOn },
  { id: 'rightFuelLow', text: 'R FUEL LOW', color: AMBER, lit: (r) => r.lamps.rightFuelLow },
];

// ---------------------------------------------------------------------------------------------------
// Switch row: BATTERY and GENERATOR, AVIONICS, FUEL BOOST, the lights and the pitot heat (up = ON).

const rocker = (id: string, label: string, name: string, x: number, on: SwitchDef['on'], toggle: SwitchDef['toggle'], more: Pick<SwitchDef, 'red' | 'group'> = {}): SwitchDef => ({
  id,
  label,
  name,
  x,
  ...more,
  on,
  toggle,
});

const RX = { battery: 26, generator: 58, avionics: 106, fuelBoost: 152, beacon: 200, nav: 232, strobe: 264, landing: 296, taxi: 328, pitotHeat: 374 };

// ---------------------------------------------------------------------------------------------------

// Ring radii of the highlight spots: a little outside the glass of a 3-1/8" and of a 2-1/4" instrument.
const BIG = APERTURES.large * 1.1;
const SMALL = APERTURES.small * 1.15;

const eng = (i: number) => ENGINE_COLUMN.y[i];

export const C208_PANEL: PanelDef = {
  id: 'c208',
  fixed: {
    flightRows: [['asi', 'attitude', 'altimeter', 'cdi1'], ['turn', 'heading', 'vsi', 'cdi2']],
    controls: [{ x: 64, y: 664, w: 576, h: 140 }],
  },
  size: { w: C208_PANEL_SIZE.w, h: C208_PANEL_SIZE.h },
  // In the order the panel draws them.
  gauges: [
    { kind: 'asi', id: 'asi', at: [COLS[0], ROWS[0]], marks: C208_ASI_MARKS },
    { kind: 'attitude', id: 'attitude', at: [COLS[1], ROWS[0]] },
    { kind: 'altimeter', id: 'altimeter', at: [COLS[2], ROWS[0]] },
    { kind: 'turn', id: 'turn', at: [COLS[0], ROWS[1]] },
    { kind: 'heading', id: 'heading', at: [COLS[1], ROWS[1]] },
    { kind: 'vsi', id: 'vsi', at: [COLS[2], ROWS[1]] },
    // NAV 1 over NAV 2; NAV 1's course card set to runway 07 when nothing turns the OBS.
    { kind: 'cdi', id: 'cdi1', at: [CDI.x, CDI.y[0]], receiver: 'nav1', fixedCourseDeg: 70 },
    { kind: 'cdi', id: 'cdi2', at: [CDI.x, CDI.y[1]], receiver: 'nav2', fixedCourseDeg: 70 },
    { kind: 'clock', id: 'clock', at: [LEFT_COLUMN.x, LEFT_COLUMN.clock] },
    { kind: 'suction', id: 'suction', at: [LEFT_COLUMN.x, LEFT_COLUMN.suction], scale: C208_SUCTION_SCALE },
    // The engine column, top to bottom.
    singleGauge('torque', [ENGINE_COLUMN.x, eng(0)], TORQUE, (r) => ((r.engines[0]?.torqueNm ?? 0) * GEAR_RATIO * FT_LBF_PER_NM) / 100),
    singleGauge('itt', [ENGINE_COLUMN.x, eng(1)], ITT, (r) => (r.engines[0]?.ittC ?? 0) / 100),
    // Np: the tachometer reads the propeller shaft (instrument systems: tachShaft 'propeller').
    singleGauge('np', [ENGINE_COLUMN.x, eng(2)], NP, (r) => (r.engines[0]?.rpm ?? 0) / 100),
    singleGauge('ng', [ENGINE_COLUMN.x, eng(3)], NG, (r) => r.engines[0]?.ngPct ?? 0),
    singleGauge('fuelFlow', [ENGINE_COLUMN.x, eng(4)], FUEL_FLOW, (r) => ((r.engines[0]?.fuelFlowGph ?? 0) * LB_PER_GAL) / 100),
    OIL_GAUGE,
    singleGauge('fuelLeft', [RIGHT_OF_STACK.x, RIGHT_OF_STACK.fuelLeft], fuelDial(808, 'LEFT'), (r) => ((r.fuelGal[0] ?? 0) * LB_PER_GAL) / 100),
    singleGauge('fuelRight', [RIGHT_OF_STACK.x, RIGHT_OF_STACK.fuelRight], fuelDial(809, 'RIGHT'), (r) => ((r.fuelGal[1] ?? 0) * LB_PER_GAL) / 100),
    VOLT_AMP,
    // The co-pilot's instruments (one pitot-static system and one set of gyros feed both sides here).
    { kind: 'asi', id: 'asi2', at: [CO_COLS[0], ROWS[0]], marks: C208_ASI_MARKS },
    { kind: 'attitude', id: 'attitude2', at: [CO_COLS[1], ROWS[0]] },
    { kind: 'altimeter', id: 'altimeter2', at: [CO_COLS[2], ROWS[0]] },
    { kind: 'heading', id: 'heading2', at: [CO_COLS[1], ROWS[1]] },
    { kind: 'vsi', id: 'vsi2', at: [CO_COLS[2], ROWS[1]] },
    // The selector's position scale: UP, 10, 20 and FULL (30 degrees).
    { kind: 'flapLever', id: 'flaps', bounds: FLAPS, maxDeg: 30, legends: ['UP', '10°', '20°', 'FULL'] },
    { kind: 'navcom', id: 'navcom1', bounds: { x: STACK.x, y: STACK.navcom1, w: 320, h: 76 } },
    { kind: 'navcom', id: 'navcom2', bounds: { x: STACK.x, y: STACK.navcom2, w: 320, h: 76 } },
    { kind: 'gps', id: 'gps', bounds: { x: STACK.x, y: STACK.gps, w: 320, h: STACK.gpsH } },
    { kind: 'xpdr', id: 'xpdr', bounds: { x: STACK.x, y: STACK.xpdr, w: 320, h: 60 } },
  ],
  annunciator: { bounds: ANNUNCIATOR, lamps: C208_ANNUNCIATOR_LAMPS, columns: 5 },
  switchRow: {
    bounds: SWITCHES,
    rockerTop: ROW.rockerTop,
    rockerW: ROW.rockerW,
    rockerH: ROW.rockerH,
    switches: [
      rocker('battery', 'BATTERY', 'Battery', RX.battery, (c) => c.masterBattery, (c) => { c.masterBattery = !c.masterBattery; }, { red: true, group: 'power' }),
      rocker('generator', 'GEN', 'Generator', RX.generator, (c) => c.alternator, (c) => { c.alternator = !c.alternator; }, { red: true, group: 'power' }),
      rocker('avionics', 'AVIONICS', 'Avionics power', RX.avionics, (c) => c.avionics, (c) => { c.avionics = !c.avionics; }),
      rocker('fuelBoost', 'FUEL BOOST', 'Fuel boost pump', RX.fuelBoost, (c) => c.fuelPump, (c) => { c.fuelPump = !c.fuelPump; }),
      rocker('beacon', 'BCN', 'Beacon', RX.beacon, (c) => c.lights.beacon, (c) => { c.lights.beacon = !c.lights.beacon; }, { group: 'lights' }),
      rocker('nav', 'NAV', 'Nav lights', RX.nav, (c) => c.lights.nav, (c) => { c.lights.nav = !c.lights.nav; }, { group: 'lights' }),
      rocker('strobe', 'STROBE', 'Strobes', RX.strobe, (c) => c.lights.strobe, (c) => { c.lights.strobe = !c.lights.strobe; }, { group: 'lights' }),
      rocker('landing', 'LAND', 'Landing lights', RX.landing, (c) => c.lights.landing, (c) => { c.lights.landing = !c.lights.landing; }, { group: 'lights' }),
      rocker('taxi', 'TAXI', 'Taxi lights', RX.taxi, (c) => c.lights.taxi, (c) => { c.lights.taxi = !c.lights.taxi; }, { group: 'lights' }),
      rocker('pitotHeat', 'PITOT HT', 'Pitot heat', RX.pitotHeat, (c) => c.pitotHeat, (c) => { c.pitotHeat = !c.pitotHeat; }),
    ],
    // Local px of the row: the tabs of the brackets over the power switches and the lights.
    legends: [
      { text: 'POWER', x: (RX.battery + RX.generator) / 2, y: ROW.rockerTop - 24, size: 8.5 },
      { text: 'LIGHTS', x: (RX.beacon + RX.taxi) / 2, y: ROW.rockerTop - 24, size: 8.5 },
    ],
  },
  // The STARTER rocker (held for the start) beside the IGNITION switch (ON / NORM), at the left of the switch panel.
  ignition: { kind: 'toggles', at: IGNITION_AT, engines: 1, switches: 'ignition' },
  background: {
    // Sub-panel seams either side of the radio stack.
    seamsX: [1312, 1668],
    // Painted controls: the parking brake handle, the alternate static source and the cabin heat.
    bushings: [
      { at: [C208_PARKING_BRAKE[0], C208_PARKING_BRAKE[1]], text: 'PARK BRAKE', sub: 'PULL' },
      { at: [920, 760], text: 'ALT STATIC', sub: 'PULL ON' },
      { at: [1070, 760], text: 'CABIN HEAT', sub: 'PULL ON' },
      { at: [2000, 760], text: 'DEFROST', sub: 'PULL ON' },
    ],
    // Placards: centre x and top y; lines; lettering size where not the default.
    placards: [
      {
        x: 2720,
        y: 40,
        lines: [
          'THIS AIRPLANE MUST BE OPERATED IN THE NORMAL',
          'CATEGORY IN COMPLIANCE WITH THE OPERATING',
          'LIMITATIONS STATED IN THE FORM OF PLACARDS,',
          'MARKINGS AND MANUALS.',
          'NO ACROBATIC MANEUVERS, INCLUDING SPINS, APPROVED.',
        ],
        size: 6.5,
      },
      { x: 2720, y: 140, lines: ['MAX OPERATING SPEED', `VMO ${V.vne} KIAS`], size: 8 },
      { x: 2720, y: 194, lines: ['MANEUVERING SPEED', `${V.va} KIAS AT 8000 LB`], size: 8 },
      { x: 2720, y: 248, lines: [`FLAPS 10° ${V.vfe[0]} · 20° ${V.vfe[1]} · FULL ${V.vfe[2]} KIAS`], size: 7.5 },
      {
        x: 2720,
        y: 290,
        lines: ['ENGINE LIMITS', `TORQUE ${C208_TORQUE_LIMIT_FTLB} FT-LB · NG ${C208_NG_LIMIT_PCT}%`, `ITT ${C208_ITT_LIMIT_C}°C · START ${C208_ITT_START_LIMIT_C}°C (2 SEC)`, `NP ${C208_MAX_NP} RPM`],
        size: 7,
      },
      { x: 2720, y: 380, lines: ['FUEL: JET A, JET A-1, JET B', '332 U.S. GAL USABLE'], size: 7.5 },
      { x: LEFT_COLUMN.x - 210, y: 70, lines: ['STARTER: 30 SEC ON,', '60 SEC OFF; 30 ON,', '60 OFF; 30 ON, 30 MIN OFF'], size: 6 },
    ],
    // Push-to-reset circuit breakers on the lower right: legend and rating, A.
    breakers: {
      bounds: { x: 2340, y: 700, w: 560, h: 200 },
      names: [
        'START', 'IGN', 'GEN FLD', 'BUS 1', 'BUS 2', 'AVN 1', 'AVN 2',
        'FUEL BOOST', 'ANN', 'ENG INST', 'FUEL QTY', 'TURN', 'PITOT HT', 'STALL HT',
        'BCN', 'NAV LT', 'STROBE', 'LAND L', 'LAND R', 'TAXI', 'FLAPS',
        'NAV 1', 'NAV 2', 'GPS', 'XPDR', 'AUDIO', 'CLOCK', 'INST LT',
      ],
      amps: [5, 5, 5, 50, 50, 30, 30, 15, 5, 5, 5, 5, 20, 10, 5, 7.5, 7.5, 15, 15, 15, 10, 7.5, 7.5, 5, 5, 5, 2, 5],
      perRow: 7,
    },
    // Rack rails of the centre stack and the blanking plate of the audio panel's bay.
    rack: {
      rails: { x: STACK.x - 4, y: STACK.navcom1 - 6, w: 328, h: STACK.blank + STACK.blankH + 6 - STACK.navcom1 },
      blanks: [{ x: STACK.x, y: STACK.blank, w: 320, h: STACK.blankH }],
    },
  },
  // The control wheel shaft boots.
  keepOut: C208_YOKES.xs.map((x) => ({ x, y: C208_YOKES.y, r: C208_YOKES.r })),
  apertures: APERTURES,
  // The instrument groups of InstrumentPanel.drawTo().
  regions: {
    sixpack: { x: COLS[0] - 92, y: ROWS[0] - 92, w: 3 * 184, h: 2 * 188 },
    engine: { x: ENGINE_COLUMN.x - 66, y: eng(0) - 66, w: 132, h: eng(5) - eng(0) + 132 },
    stack: { x: STACK.x, y: STACK.navcom1, w: 320, h: STACK.xpdr + 60 - STACK.navcom1 },
  },
  // Ring centre and radius of each instrument a lesson can name (training/types.ts InstrumentId). The power
  // instrument of a turboprop is the torque indicator: 'tach' points at it.
  spots: {
    asi: { x: COLS[0], y: ROWS[0], r: BIG },
    ai: { x: COLS[1], y: ROWS[0], r: BIG },
    alt: { x: COLS[2], y: ROWS[0], r: BIG },
    tc: { x: COLS[0], y: ROWS[1], r: BIG },
    // The slip ball sits in the lower part of the turn coordinator.
    ball: { x: COLS[0], y: ROWS[1] + APERTURES.large * 0.45, r: APERTURES.large * 0.42 },
    dg: { x: COLS[1], y: ROWS[1], r: BIG },
    vsi: { x: COLS[2], y: ROWS[1], r: BIG },
    tach: { x: ENGINE_COLUMN.x, y: eng(0), r: SMALL },
    // Both fuel quantity indicators in one ring.
    fuel: { x: RIGHT_OF_STACK.x, y: (RIGHT_OF_STACK.fuelLeft + RIGHT_OF_STACK.fuelRight) / 2, r: (RIGHT_OF_STACK.fuelRight - RIGHT_OF_STACK.fuelLeft) / 2 + SMALL },
    oil: { x: ENGINE_COLUMN.x, y: eng(5), r: SMALL },
    flaps: { x: FLAPS.x + FLAPS.w / 2, y: FLAPS.y + FLAPS.h / 2, r: FLAPS.h / 2 },
  },
};

// ---------------------------------------------------------------------------------------------------
// Instrument systems

/** DC bus voltage below which electric gauges and lamps are dead: the 28 V system (powerplant.ts electrical). */
const BUS_DEAD_VOLTS = 18;
/** Regulated suction of the bleed-air ejector, inHg, and the suction at which an air-driven gyro is at rated speed. */
const SUCTION_REGULATED_INHG = 5.0;
const SUCTION_RATED_INHG = 4.5;
/** Power-turbine rpm (the shaft the vacuum system is handed) at which the ejector reaches its regulated suction. */
const EJECTOR_RPM = 4000;
/** Generator output below which GENERATOR OFF shows, A. */
const GENERATOR_LAMP_AMPS = 0.5;

/** The lamp needs bus power. */
const powered = (i: LampInputs): boolean => i.state.electrical.busVoltage > BUS_DEAD_VOLTS;

export const C208_INSTRUMENT_SYSTEMS: InstrumentSystemsDef = {
  engines: 1,
  // Engine bleed air through an ejector drives the attitude and heading gyros (the turn coordinator is electric).
  // The model hands the pump the power turbine's rpm while the engine runs: full suction from a low idle.
  vacuum: {
    engines: [0],
    regulatedInHg: SUCTION_REGULATED_INHG,
    ratedInHg: SUCTION_RATED_INHG,
    suction: (rpm) => (rpm <= 0 ? 0 : Math.min(SUCTION_REGULATED_INHG, 5.4 * (1 - Math.exp(-rpm / EJECTOR_RPM)))),
  },
  gyroDrive: { attitude: 'vacuum', heading: 'vacuum' },
  // Two wing tanks, one gauge each, in pounds of Jet A.
  fuel: { kgPerGal: KG_PER_GAL, tanks: [(s) => s.fuel.left, (s) => s.fuel.right] },
  busDeadVolts: BUS_DEAD_VOLTS,
  // The propeller tachometer (the 208 has no hour meter on it; the figure only paces the readings' tach hours).
  tachHourRpm: C208_MAX_NP,
  tachShaft: 'propeller',
  lamps: [
    { id: 'oilPress', lit: (i) => powered(i) && i.state.engine.oilPressure < OIL.minPsi },
    { id: 'fuelSelectOff', lit: (i) => powered(i) && i.controls.fuelSelector !== 'on' && i.controls.fuelSelector !== 'both' },
    { id: 'generatorOff', lit: (i) => powered(i) && (i.state.electrical.alternators[0] ?? 0) < GENERATOR_LAMP_AMPS },
    { id: 'voltageLow', lit: (i) => powered(i) && i.state.electrical.busVoltage < LOW_VOLTS },
    { id: 'vacuumLow', lit: (i) => powered(i) && i.suctionInHg < VACUUM_LOW_INHG },
    { id: 'leftFuelLow', lit: (i) => powered(i) && (i.fuelGal[0] ?? 0) < FUEL_LOW_GAL },
    { id: 'fuelPressLow', lit: (i) => powered(i) && i.state.engine.fuelPressure < FUEL_PRESS_LOW_PSI },
    { id: 'starterEnergized', lit: (i) => powered(i) && i.controls.starter },
    // The igniters spark while the starter turns (IGNITION at NORM), or continuously with it ON (turbineEngine.ts).
    { id: 'ignitionOn', lit: (i) => powered(i) && (i.controls.starter || i.controls.magnetos !== 0) },
    { id: 'rightFuelLow', lit: (i) => powered(i) && (i.fuelGal[1] ?? 0) < FUEL_LOW_GAL },
  ],
};
