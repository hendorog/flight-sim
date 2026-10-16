// Pilatus PC-12/47: the instrument panel as data (gauges and their markings, the engine instrument system windows,
// the CAWS legend grid, switch row, STARTER and IGNITION, artwork, highlight spots) and what the instrument systems
// behind it need. CLOSURES.
//
// The legacy /47 panel as the owner's analogue-style panel (owner decision 1: no glass / EPECS), arranged from the
// Commons photographs of the /47 cockpit (research-pc12.md section 15; PHOTO) and the 47E POH section 7 text
// (47E-PROXY). The EFIS tubes of the real /47 are drawn as electromechanical instruments in the EADI / EHSI places
// (AGENT choice: the attitude indicator and the heading indicator; the RMI places hold the NAV indicators):
//   outboard left   standby attitude indicator, airspeed indicator, altimeter
//   pilot's T       ASI | attitude | altimeter over RMI | horizontal situation (heading) | VSI; flap gauge, clock below
//   centre          EIS 3 x 3 window grid (TQ, ITT, NG / FUEL FLOW, FUEL QTY, NP / BAT, GEN, ENG OIL), the CAWS 6 x 8
//                   legend grid below it with the gear handle and its lights at the left
//   right of EIS    radio stack (two NAV / COM, GPS, transponder); cabin altitude / differential gauge
//   co-pilot's T    the same T
//   lower left      STARTER, STARTER INTERRUPT, IGNITION, the switch row (BAT, GEN 1, GEN 2, AVIONICS, FUEL PUMPS, lights,
//                   PITOT HT), PUSHER INTR and CAWS TEST
// The pedestal levers (PCL with beta / reverse aft of the gate, condition lever, MOR, flap lever) are 3D parts
// (visual.ts) standing at panelLayout.ts PC12_PEDESTAL.
//
// The panel face is the whole 2800 x 1040 canvas at 2000 px/m (panelLayout.ts), so the instruments are drawn at their
// real size. Airspeeds in knots. Torque everywhere through pc12TorquePsi (facts.ts). docs/pc12-panel.md has the
// sources, the AGENT choices and what is not modelled.

import type { EngineReadings } from '../../instruments/dynamics/instrumentSet';
import { singleGauge, type EngineDial } from '../../instruments/panels/gauges';
import type { AsiMarkings, EisDial, EisReadout, GaugeDef, InstrumentSystemsDef, LampDef, LampInputs, PanelDef, Rect, ScaleDef, SwitchDef } from '../types';
import {
  PC12_BUS_DEAD_VOLTS,
  PC12_CAWS_VOLTS,
  PC12_FLAP_DETENTS_DEG,
  PC12_GEN_AMPS,
  PC12_IDLE,
  PC12_ITT_C,
  PC12_NG_MAX,
  PC12_NP_GOVERNED,
  PC12_NP_PROHIBITED,
  PC12_NP_TRANSIENT,
  PC12_OVERSPEED,
  PC12_TORQUE_PSI,
  pc12TorquePsi,
} from './facts';
import {
  PC12_CAWS,
  PC12_COPILOT_T,
  PC12_EIS,
  PC12_FLAP_GAUGE,
  PC12_GEAR_HANDLE,
  PC12_GEAR_LIGHTS,
  PC12_PANEL_CENTRE_PX,
  PC12_PANEL_PARTS,
  PC12_PANEL_PX_PER_M,
  PC12_PANEL_PX_RECT,
  PC12_PANEL_SIZE,
  PC12_PEDESTAL,
  PC12_PILOT_T,
  PC12_T_PITCH,
  PC12_YOKES,
} from './panelLayout';
import { PC12_REFERENCE } from './reference';

// The face facts visual.ts builds its 3D parts on, under the names the other types' panel.ts files export.
export {
  PC12_CAWS,
  PC12_EIS,
  PC12_FLAP_GAUGE,
  PC12_GEAR_HANDLE,
  PC12_PANEL_CENTRE_PX,
  PC12_PANEL_PARTS,
  PC12_PANEL_PX_PER_M,
  PC12_PANEL_PX_RECT,
  PC12_PANEL_SIZE,
  PC12_PEDESTAL,
  PC12_YOKES,
};

const V = PC12_REFERENCE;

// ---------------------------------------------------------------------------------------------------
// Layout, canvas px (panelLayout.ts has the shared parts).

const PX = PC12_PILOT_T.x;
const CX = PC12_COPILOT_T.x;
const ROWS = [PC12_PILOT_T.y, PC12_PILOT_T.y + PC12_T_PITCH.y] as const;
/** A basic T's three columns. */
const cols = (x: number): readonly [number, number, number] => [x - PC12_T_PITCH.x, x, x + PC12_T_PITCH.x];
const PILOT_COLS = cols(PX);
const COPILOT_COLS = cols(CX);
/** The standby instruments, one column outboard of the pilot's T. */
const STANDBY = { x: PILOT_COLS[0] - PC12_T_PITCH.x, y: [PC12_PILOT_T.y, ROWS[1], 518] as const };
const FLAP = PC12_FLAP_GAUGE;
const CLOCK = { x: PILOT_COLS[1], y: 520 };
/** Radio stack: rack units are 320 px wide (render/avionics.ts); heights as the C208's. */
const STACK = { x: 1380, navcom1: 92, navcom2: 176, gps: 260, gpsH: 220, xpdr: 504, blank: 572, blankH: 128 };
const CABIN_GAUGE = { x: 1812, y: 150 };
/** Lower left: starter interrupt, pusher interrupt and CAWS test buttons over the STARTER / IGNITION group and the switch row. */
const BUTTONS = { y: 770, w: 96, h: 78, xs: [30, 150, 270] as const };
const IGNITION_AT = [90, 930] as const;
const SWITCHES: Rect = { x: 170, y: 880, w: 520, h: 116 };
const ROW = { rockerTop: 44, rockerW: 24, rockerH: 42 };
const APERTURES = { large: 74, small: 51 };
const EIS_CELL = PC12_EIS.cell;
const eisRect = (col: number, row: number): Rect => ({ x: PC12_EIS.x0 + col * EIS_CELL, y: PC12_EIS.y0 + row * EIS_CELL, w: EIS_CELL, h: EIS_CELL });
const EIS_ALL: Rect = { x: PC12_EIS.x0, y: PC12_EIS.y0, w: EIS_CELL * PC12_EIS.cols, h: EIS_CELL * PC12_EIS.rows };

// ---------------------------------------------------------------------------------------------------
// Markings

/**
 * Airspeed indicator, KIAS (the /47 dial is marked in KIAS): white arc Vs0 to Vfe (flaps 40 / 30), green Vs1 to Vmo, red
 * line at Vmo (PHOTO placard: Vmo 236 KIAS). A turboprop has no yellow arc. A 40-300 kt dial.
 */
export const PC12_ASI_MARKS: AsiMarkings = {
  scaleKt: [0, 40, 60, 100, 150, 200, 250, 300],
  scaleDeg: [0, 10, 42, 100, 168, 232, 288, 334],
  tickFrom: 40,
  tickTo: 300,
  minorStep: 10,
  numberStep: 50,
  arcs: [
    { from: V.vs1, to: V.vne, color: 'green' },
    { from: V.vs0, to: V.vfe[V.vfe.length - 1], color: 'white', inner: true },
  ],
  redLine: V.vne,
};

/** Jet A at 6.7 lb per US gallon (the C208 panel's figure), kg per gallon, and lb per gallon. */
const LB_PER_GAL = 6.7;
const KG_PER_LB = 0.45359237;
export const PC12_KG_PER_GAL = LB_PER_GAL * KG_PER_LB;
/** Fuel in a tank below which L / R FUEL LOW comes on: 20 US gal per side (SECONDARY flashcards, research 14). */
const FUEL_LOW_GAL = 20;
/** Fuel pressure below which FUEL PRESS comes on, psi (SECONDARY flashcards: below 2 psi). */
const FUEL_PRESS_LOW_PSI = 2;
/** Oil: pressure green 85-105, minimum 40 at idle; temperature green 10-99 C (the C208 panel's PT6 figures: ESTIMATE for the -67B). */
const OIL = { minPsi: 40, greenPsi: 85, maxPsi: 105, minC: 10, maxC: 99 };
/** Ng green band: ground-idle minimum 50.7 % to the 104 % limit (ETCDS / 47E-PROXY 2-6). */
const NG_GREEN = [PC12_IDLE.groundNg[0] * 100, PC12_NG_MAX * 100] as const;
const NG_LIMIT = PC12_NG_MAX * 100;

// ---------------------------------------------------------------------------------------------------
// EIS windows (research 15: top row TQ, ITT, NG; middle FUEL FLOW / USED, FUEL QTY, NP; bottom BAT, GEN, ENG OIL)

const eng = (r: { engines: EngineReadings[] }): EngineReadings | undefined => r.engines[0];

/** Torque, psi: green to MCP 36.95, yellow to take-off 44.34, red from the 61 psi transient limit; red radial at 44.34. */
const TQ_DIAL: EisDial = {
  min: 0, max: 70, fromDeg: -135, toDeg: 135, majors: [0, 10, 20, 30, 40, 50, 60, 70],
  arcs: [
    { from: 0, to: PC12_TORQUE_PSI.mcp, color: 'green' },
    { from: PC12_TORQUE_PSI.mcp, to: PC12_TORQUE_PSI.takeoff, color: 'yellow' },
    { from: PC12_TORQUE_PSI.transient, to: 70, color: 'red' },
  ],
  redLines: [PC12_TORQUE_PSI.takeoff],
  read: (r) => pc12TorquePsi(eng(r)?.torqueNm ?? 0),
};
/** ITT, deg C: green to MCP 760, yellow to take-off 800, red above (transient 870, start 1000). */
const ITT_DIAL: EisDial = {
  min: 0, max: 1100, fromDeg: -135, toDeg: 135, majors: [0, 200, 400, 600, 800, 1000], labels: [0, 400, 800, 1000], labelDivisor: 100,
  arcs: [
    { from: 400, to: PC12_ITT_C.mcp, color: 'green' },
    { from: PC12_ITT_C.mcp, to: PC12_ITT_C.takeoff, color: 'yellow' },
    { from: PC12_ITT_C.transient, to: 1100, color: 'red' },
  ],
  redLines: [PC12_ITT_C.takeoff, PC12_ITT_C.start],
  read: (r) => eng(r)?.ittC ?? 0,
};
const NG_DIAL: EisDial = {
  min: 0, max: 110, fromDeg: -135, toDeg: 135, majors: [0, 20, 40, 60, 80, 100],
  arcs: [{ from: NG_GREEN[0], to: NG_GREEN[1], color: 'green' }],
  redLines: [NG_LIMIT],
  read: (r) => eng(r)?.ngPct ?? 0,
};
/** Propeller rpm: red arc 350-950 (stabilised ground operation prohibited), green 1600-1700, yellow to the 1870 transient limit. */
const NP_DIAL: EisDial = {
  min: 0, max: 2000, fromDeg: -135, toDeg: 135, majors: [0, 400, 800, 1200, 1600, 2000], labelDivisor: 100,
  arcs: [
    { from: PC12_NP_PROHIBITED[0], to: PC12_NP_PROHIBITED[1], color: 'red' },
    { from: 1600, to: PC12_NP_GOVERNED, color: 'green' },
    { from: PC12_NP_GOVERNED, to: PC12_NP_TRANSIENT, color: 'yellow' },
  ],
  redLines: [PC12_NP_TRANSIENT],
  read: (r) => eng(r)?.rpm ?? 0,
};
const FF_DIAL: EisDial = {
  min: 0, max: 800, fromDeg: -135, toDeg: 135, majors: [0, 200, 400, 600, 800], labelDivisor: 100,
  read: (r) => (eng(r)?.fuelFlowGph ?? 0) * LB_PER_GAL,
};

const readout = (label: string, unit: string, decimals: number, read: EisReadout['read'], alert?: EisReadout['alert']): EisReadout => ({ label, unit, decimals, read, alert });


/** The nine windows of the EIS (the order of research 15), left to right, top to bottom. */
const EIS_WINDOWS: GaugeDef[] = [
  { kind: 'eisWindow', id: 'eisTq', bounds: eisRect(0, 0), title: 'TQ', dial: TQ_DIAL,
    readouts: [readout('', 'PSI', 1, (r) => TQ_DIAL.read(r), (v) => (v > PC12_TORQUE_PSI.transient ? 'red' : v > PC12_TORQUE_PSI.takeoff + 0.3 ? 'amber' : undefined))] },
  { kind: 'eisWindow', id: 'eisItt', bounds: eisRect(1, 0), title: 'ITT', dial: ITT_DIAL,
    readouts: [readout('', '°C', 0, (r) => ITT_DIAL.read(r), (v) => (v > PC12_ITT_C.transient ? 'red' : v > PC12_ITT_C.takeoff ? 'amber' : undefined))] },
  { kind: 'eisWindow', id: 'eisNg', bounds: eisRect(2, 0), title: 'NG', dial: NG_DIAL,
    readouts: [readout('', '%', 1, (r) => NG_DIAL.read(r), (v) => (v > NG_LIMIT ? 'red' : undefined))] },
  { kind: 'eisWindow', id: 'eisFuelFlow', bounds: eisRect(0, 1), title: 'FUEL FLOW', dial: FF_DIAL,
    readouts: [readout('FF', 'PPH', 0, (r) => FF_DIAL.read(r)), readout('USED', 'LB', 0, (r) => r.fuelUsedGal * LB_PER_GAL)] },
  { kind: 'eisWindow', id: 'eisFuelQty', bounds: eisRect(1, 1), title: 'FUEL QTY',
    bars: {
      min: 0, max: 1400,
      arcs: [{ from: 0, to: FUEL_LOW_GAL * LB_PER_GAL, color: 'yellow' }],
      items: [{ label: 'L', read: (r) => (r.fuelGal[0] ?? 0) * LB_PER_GAL }, { label: 'R', read: (r) => (r.fuelGal[1] ?? 0) * LB_PER_GAL }],
    },
    readouts: [readout('L', 'LB', 0, (r) => (r.fuelGal[0] ?? 0) * LB_PER_GAL), readout('R', 'LB', 0, (r) => (r.fuelGal[1] ?? 0) * LB_PER_GAL)] },
  { kind: 'eisWindow', id: 'eisNp', bounds: eisRect(2, 1), title: 'NP', dial: NP_DIAL,
    readouts: [readout('', 'RPM', 0, (r) => NP_DIAL.read(r), (v) => (v > PC12_NP_TRANSIENT ? 'red' : v > 1750 ? 'amber' : undefined))] },
  { kind: 'eisWindow', id: 'eisBat', bounds: eisRect(0, 2), title: 'BAT',
    readouts: [readout('DC A', '', 0, (r) => r.ammeterAmps), readout('DC V', '', 1, (r) => r.busVolts, (v) => (v < PC12_CAWS_VOLTS.bus ? 'amber' : undefined))] },
  { kind: 'eisWindow', id: 'eisGen', bounds: eisRect(1, 2), title: 'GEN 1 / GEN 2',
    readouts: [readout('GEN1 A', '', 0, (r) => r.alternatorAmps[0] ?? 0, (v) => (v > PC12_GEN_AMPS[0] ? 'red' : undefined)),
      readout('GEN2 A', '', 0, (r) => r.alternatorAmps[1] ?? 0, (v) => (v > PC12_GEN_AMPS[1] ? 'red' : undefined)),
      readout('DC V', '', 1, (r) => r.busVolts, (v) => (v < PC12_CAWS_VOLTS.genOff ? 'amber' : undefined))] },
  { kind: 'eisWindow', id: 'eisOil', bounds: eisRect(2, 2), title: 'ENG OIL',
    bars: {
      min: 0, max: 200,
      arcs: [{ from: OIL.minPsi, to: OIL.greenPsi, color: 'yellow' }, { from: OIL.greenPsi, to: OIL.maxPsi, color: 'green' }],
      redLines: [OIL.minPsi, OIL.maxPsi],
      items: [{ label: 'P', read: (r) => eng(r)?.oilPressurePsi ?? 0 }],
    },
    readouts: [readout('TEMP', '°C', 0, (r) => (((eng(r)?.oilTempF ?? 32) - 32) * 5) / 9, (v) => (v > OIL.maxC ? 'red' : undefined)),
      readout('PRESS', 'PSI', 0, (r) => eng(r)?.oilPressurePsi ?? 0, (v) => (v > 0 && v < OIL.minPsi ? 'red' : v > OIL.maxPsi ? 'amber' : undefined))] },
];

// ---------------------------------------------------------------------------------------------------
// Flap gauge and the cabin altitude / differential gauge

/** Flap position, deg: the detents 0, 15, 30, 40 (47E-PROXY 7-3), a small round dial. */
const FLAP_DIAL: EngineDial = {
  size: 'small',
  seed: 1201,
  fromDeg: -60,
  toDeg: 120,
  title: 'FLAPS',
  units: 'DEG',
  labels: [...PC12_FLAP_DETENTS_DEG],
  scale: { label: '', min: 0, max: 40, majors: [...PC12_FLAP_DETENTS_DEG], minorStep: 5, numbers: true, arcs: [{ from: 0, to: 40, color: 'white' }] },
};

/**
 * Cabin pressure display, 47E POH 7-17 controller schedule (47E-PROXY; the /47 controller is believed equivalent, ESTIMATE):
 * FL300 -> 10 000 ft, FL250 -> 7379, FL200 -> 5315, FL150 -> 3680, FL100 -> 2252; cabin rate limited to 500 ft/min; the
 * differential never above the 5.75 psid maximum (placard, PHOTO: the safety valve relieves the cabin in a fast climb).
 */
export const PC12_CABIN_SCHEDULE = {
  altFt: [10_000, 15_000, 20_000, 25_000, 30_000],
  cabinFt: [2252, 3680, 5315, 7379, 10_000],
  rateFpm: 500,
  maxDiffPsi: 5.75,
} as const;
/** Maximum cabin differential, psi (placard, PHOTO). */
export const PC12_MAX_DIFF_PSI = PC12_CABIN_SCHEDULE.maxDiffPsi;

const CABIN_ALT_SCALE: ScaleDef = {
  label: 'FT', min: 0, max: 15, majors: [0, 5, 10, 15], minorStep: 1, numbers: true,
  arcs: [{ from: 0, to: 10, color: 'green' }], redLines: [14.5],
  read: (r) => r.cabinAltFt / 1000,
};
const CABIN_DIFF_SCALE: ScaleDef = {
  label: 'PSI', min: 0, max: 7, majors: [0, 2, 4, 6], minorStep: 0.5, numbers: true,
  arcs: [{ from: 0, to: PC12_MAX_DIFF_PSI, color: 'green' }], redLines: [PC12_MAX_DIFF_PSI],
  read: (r) => r.cabinDiffPsi,
};

// ---------------------------------------------------------------------------------------------------
// CAWS: 6 x 8 legend grid. Legends of the legacy /47 (research 14, SECONDARY flashcards about 2013; AFM 02211 not seen) and
// the 47E CAS equivalents (ESTIMATE). Red warnings, amber cautions, green advisories.

const AMBER = '#ffb21e';
const RED = '#ff3b2a';
const GREEN = '#46e05a';
type Cell = readonly [id: string, text: string, color: string];
const SPARE: Cell = ['', '', AMBER];
/** Row by row, left to right. Cells with an empty id are blank lenses. */
const CAWS_CELLS: readonly Cell[] = [
  ['oilQty', 'OIL QTY', RED], ['engFire', 'ENG FIRE', RED], ['esntlBus', 'ESNTL BUS', RED], ['avBus', 'AV BUS', RED], ['apTrim', 'AP TRIM', RED], ['propLowP', 'PROP LOW P', RED],
  ['airGnd', 'AIR/GND', RED], ['cargoDoor', 'CARGO DOOR', RED], ['propDeIce', 'PROP DE ICE', AMBER], ['pitot1', 'PITOT 1', AMBER], ['pitot2', 'PITOT 2', AMBER], ['wshldHeat', 'WSHLD HEAT', AMBER],
  ['staticHeat', 'STATIC', AMBER], ['inertSep', 'INERT SEP', AMBER], ['deIceBoots', 'DE ICE BOOTS', AMBER], ['aoaDeIce', 'AOA DE ICE', AMBER], ['leftFuelLow', 'L FUEL LOW', AMBER], ['rightFuelLow', 'R FUEL LOW', AMBER],
  ['fuelPress', 'FUEL PRESS', AMBER], ['nEssntlBus', 'N ESSNTL BUS', AMBER], ['ecs', 'ECS', AMBER], ['hydr', 'HYDR', AMBER], ['chip', 'CHIP', AMBER], ['flaps', 'FLAPS', AMBER],
  ['batHot', 'BAT HOT', AMBER], ['inverter', 'INVERTER', AMBER], ['gen1Off', 'GEN 1 OFF', AMBER], ['gen2Off', 'GEN 2 OFF', AMBER], ['busTie', 'BUS TIE', AMBER], ['pusher', 'PUSHER', AMBER],
  ['cabPress', 'CAB PRESS', AMBER], ['passDoor', 'PASS DOOR', AMBER], ['engOilCaws', 'ENG OIL', AMBER], ['fuelImbal', 'FUEL IMBAL', AMBER], ['starter', 'STARTER', GREEN], ['ignition', 'IGNITION', GREEN],
  ['pusherIce', 'PUSHER ICE', GREEN], ['gen1Hot', 'GEN 1 HOT', AMBER], ['eps', 'EPS', AMBER], SPARE, SPARE, SPARE,
  SPARE, SPARE, SPARE, SPARE, SPARE, SPARE,
];
/** The CAWS lenses the simulation drives, id by id (the rest are unlit and lamp-test only). */
export const PC12_CAWS_MODELLED = ['esntlBus', 'propLowP', 'leftFuelLow', 'rightFuelLow', 'fuelPress', 'nEssntlBus', 'hydr', 'gen1Off', 'gen2Off', 'pusher', 'starter', 'ignition'] as const;

export const PC12_CAWS_LAMPS: readonly LampDef[] = CAWS_CELLS.map(([id, text, color], i) => ({
  id: id || `spare${i}`, text, color, lit: (r) => (id ? r.lamps[id] ?? false : false),
}));

// ---------------------------------------------------------------------------------------------------
// Switch row: BATTERY, GEN 1, GEN 2, AVIONICS, FUEL PUMPS, the lights and the pitot heat (up = ON).

const rocker = (id: string, label: string, name: string, x: number, on: SwitchDef['on'], toggle: SwitchDef['toggle'], more: Pick<SwitchDef, 'red' | 'group'> = {}): SwitchDef => ({
  id, label, name, x, ...more, on, toggle,
});
const RX = { battery: 26, gen1: 58, gen2: 90, avionics: 138, fuelPumps: 184, beacon: 232, nav: 264, strobe: 296, landing: 328, taxi: 360, pitotHeat: 408 };

// ---------------------------------------------------------------------------------------------------

const BIG = APERTURES.large * 1.1;
const SMALL = APERTURES.small * 1.15;

export const PC12_PANEL: PanelDef = {
  id: 'pc12',
  fixed: {
    flightRows: [['asi', 'attitude', 'altimeter'], ['rmi', 'heading', 'vsi']],
    controls: [{ x: 20, y: 870, w: 680, h: 140 }],
    crops: [EIS_ALL],
    lampsBeside: true,
  },
  size: { w: PC12_PANEL_SIZE.w, h: PC12_PANEL_SIZE.h },
  // In the order the panel draws them.
  gauges: [
    // The pilot's T.
    { kind: 'asi', id: 'asi', at: [PILOT_COLS[0], ROWS[0]], marks: PC12_ASI_MARKS },
    { kind: 'attitude', id: 'attitude', at: [PILOT_COLS[1], ROWS[0]], inclinometer: true },
    { kind: 'altimeter', id: 'altimeter', at: [PILOT_COLS[2], ROWS[0]] },
    // RMI place: the NAV 1 indicator; horizontal situation: the heading indicator; VSI.
    { kind: 'cdi', id: 'rmi', at: [PILOT_COLS[0], ROWS[1]], receiver: 'nav1', fixedCourseDeg: 70 },
    { kind: 'heading', id: 'heading', at: [PILOT_COLS[1], ROWS[1]] },
    { kind: 'vsi', id: 'vsi', at: [PILOT_COLS[2], ROWS[1]] },
    // Standby instruments, outboard.
    { kind: 'attitude', id: 'attitudeSb', at: [STANDBY.x, STANDBY.y[0]], inclinometer: true },
    { kind: 'asi', id: 'asiSb', at: [STANDBY.x, STANDBY.y[1]], marks: PC12_ASI_MARKS },
    { kind: 'altimeter', id: 'altimeterSb', at: [STANDBY.x, STANDBY.y[2]] },
    singleGauge('flaps', [FLAP.x, FLAP.y], FLAP_DIAL, (r) => r.flapsDeg),
    { kind: 'clock', id: 'clock', at: [CLOCK.x, CLOCK.y] },
    // The co-pilot's T (one pitot-static system and one set of gyros feed both sides here).
    { kind: 'asi', id: 'asi2', at: [COPILOT_COLS[0], ROWS[0]], marks: PC12_ASI_MARKS },
    { kind: 'attitude', id: 'attitude2', at: [COPILOT_COLS[1], ROWS[0]], inclinometer: true },
    { kind: 'altimeter', id: 'altimeter2', at: [COPILOT_COLS[2], ROWS[0]] },
    { kind: 'cdi', id: 'rmi2', at: [COPILOT_COLS[0], ROWS[1]], receiver: 'nav2', fixedCourseDeg: 70 },
    { kind: 'heading', id: 'heading2', at: [COPILOT_COLS[1], ROWS[1]] },
    { kind: 'vsi', id: 'vsi2', at: [COPILOT_COLS[2], ROWS[1]] },
    // The EIS.
    ...EIS_WINDOWS,
    // Gear handle with its three greens and the red unsafe light.
    { kind: 'gearLights', id: 'gear', bounds: PC12_GEAR_LIGHTS, lever: [PC12_GEAR_HANDLE.x, PC12_GEAR_HANDLE.y] },
    { kind: 'guardedKnob', id: 'gearEmergency', at: [PC12_GEAR_HANDLE.x, PC12_GEAR_HANDLE.y + 110], label: 'EMERG GEAR', action: 'gearEmergency' },
    // Cabin altitude / differential (a display function of pressure altitude, see PC12_CABIN_SCHEDULE).
    {
      // The display model is stepped by the instruments (PC12_INSTRUMENT_SYSTEMS.cabin), in every camera view.
      kind: 'dual', id: 'cabin', at: [CABIN_GAUGE.x, CABIN_GAUGE.y], seed: 1202, title: ['CABIN', 'ALT   PSI'], left: CABIN_ALT_SCALE, right: CABIN_DIFF_SCALE,
    },
    // Momentary buttons: the STARTER INTERRUPT, the stick PUSHER INTR (held) and the CAWS lamp test.
    // STARTER INTR is NOT wired yet: ControlInputs has no interrupt input. The turbine core (EngineUnit.starterCommand) cuts a
    // latched start on a SECOND STARTER press, so a button that pressed STARTER would ENGAGE the starter whenever the latch
    // is off; clearing `starter` (the earlier wiring) did nothing a released key does not. The button is a painted
    // placeholder until `ControlInputs.starterInterrupt` exists (requested from the integrator / T1a); press S again meanwhile.
    { kind: 'pushButton', id: 'starterInterrupt', bounds: { x: BUTTONS.xs[0], y: BUTTONS.y, w: BUTTONS.w, h: BUTTONS.h }, label: 'STARTER INTR',
      read: () => false, press: () => {} },
    { kind: 'pushButton', id: 'pusherIntr', bounds: { x: BUTTONS.xs[1], y: BUTTONS.y, w: BUTTONS.w, h: BUTTONS.h }, label: 'PUSHER INTR',
      read: (c) => c.pusherInterrupt ?? false, press: (down, c) => { c.pusherInterrupt = down; } },
    { kind: 'pushButton', id: 'lampTest', bounds: { x: BUTTONS.xs[2], y: BUTTONS.y, w: BUTTONS.w, h: BUTTONS.h }, label: 'CAWS TEST',
      read: (c) => c.annunciatorTest ?? false, press: (down, c) => { c.annunciatorTest = down; } },
    // Radio stack.
    { kind: 'navcom', id: 'navcom1', bounds: { x: STACK.x, y: STACK.navcom1, w: 320, h: 76 } },
    { kind: 'navcom', id: 'navcom2', bounds: { x: STACK.x, y: STACK.navcom2, w: 320, h: 76 } },
    { kind: 'gps', id: 'gps', bounds: { x: STACK.x, y: STACK.gps, w: 320, h: STACK.gpsH } },
    { kind: 'xpdr', id: 'xpdr', bounds: { x: STACK.x, y: STACK.xpdr, w: 320, h: 60 } },
  ],
  annunciator: { bounds: { x: PC12_CAWS.x0, y: PC12_CAWS.y0, w: PC12_CAWS.w, h: PC12_CAWS.h }, lamps: PC12_CAWS_LAMPS, columns: PC12_CAWS.cols },
  switchRow: {
    bounds: SWITCHES,
    rockerTop: ROW.rockerTop,
    rockerW: ROW.rockerW,
    rockerH: ROW.rockerH,
    switches: [
      rocker('battery', 'BAT', 'Battery', RX.battery, (c) => c.masterBattery, (c) => { c.masterBattery = !c.masterBattery; }, { red: true, group: 'power' }),
      // One generator control drives both generators here (docs/pc12-panel.md): the two rockers are tied.
      rocker('gen1', 'GEN 1', 'Generator 1', RX.gen1, (c) => c.alternator, (c) => { c.alternator = !c.alternator; }, { red: true, group: 'power' }),
      rocker('gen2', 'GEN 2', 'Generator 2', RX.gen2, (c) => c.alternator, (c) => { c.alternator = !c.alternator; }, { red: true, group: 'power' }),
      rocker('avionics', 'AVIONICS', 'Avionics power', RX.avionics, (c) => c.avionics, (c) => { c.avionics = !c.avionics; }),
      rocker('fuelPumps', 'FUEL PUMPS', 'Fuel pumps', RX.fuelPumps, (c) => c.fuelPump, (c) => { c.fuelPump = !c.fuelPump; }),
      rocker('beacon', 'BCN', 'Beacon', RX.beacon, (c) => c.lights.beacon, (c) => { c.lights.beacon = !c.lights.beacon; }, { group: 'lights' }),
      rocker('nav', 'NAV', 'Nav lights', RX.nav, (c) => c.lights.nav, (c) => { c.lights.nav = !c.lights.nav; }, { group: 'lights' }),
      rocker('strobe', 'STROBE', 'Strobes', RX.strobe, (c) => c.lights.strobe, (c) => { c.lights.strobe = !c.lights.strobe; }, { group: 'lights' }),
      rocker('landing', 'LAND', 'Landing lights', RX.landing, (c) => c.lights.landing, (c) => { c.lights.landing = !c.lights.landing; }, { group: 'lights' }),
      rocker('taxi', 'TAXI', 'Taxi lights', RX.taxi, (c) => c.lights.taxi, (c) => { c.lights.taxi = !c.lights.taxi; }, { group: 'lights' }),
      rocker('pitotHeat', 'PITOT HT', 'Pitot heat', RX.pitotHeat, (c) => c.pitotHeat, (c) => { c.pitotHeat = !c.pitotHeat; }),
    ],
    legends: [
      { text: 'ELECTRICAL', x: (RX.battery + RX.gen2) / 2, y: ROW.rockerTop - 24, size: 8.5 },
      { text: 'LIGHTS', x: (RX.beacon + RX.taxi) / 2, y: ROW.rockerTop - 24, size: 8.5 },
    ],
  },
  // STARTER (one press latches it on the PC-12: turbine core) beside the IGNITION switch (ON / AUTO), at the lower left.
  ignition: { kind: 'toggles', at: IGNITION_AT, engines: 1, switches: 'ignition' },
  background: {
    // Sub-panel seams either side of the EIS and the radio stack.
    seamsX: [PC12_EIS.x0 - 12, STACK.x - 16],
    bushings: [
      { at: [2000, 800], text: 'CABIN PRESS', sub: 'DUMP / AUTO' },
      { at: [2150, 800], text: 'TEMP', sub: 'HOT / COLD' },
      { at: [2300, 800], text: 'ECS', sub: 'MAN / AUTO' },
    ],
    placards: [
      // Vo / Vmo placard (PHOTO) top right, the flap and gear speeds, the engine limits.
      { x: 2640, y: 60, lines: ['MAXIMUM OPERATING SPEEDS', `VMO ${V.vne} KIAS · MMO ${PC12_OVERSPEED.mach.toFixed(2)}`, `VO ${V.va} KIAS (4740 KG)`], size: 8 },
      { x: 2640, y: 150, lines: [`FLAPS 15° ${V.vfe[0]} KIAS`, `FLAPS 30° / 40° ${V.vfe[1]} KIAS`, `GEAR: VLO ${V.vloExtend} · VLE ${V.vle} KIAS`], size: 7.5 },
      {
        x: 2640, y: 260,
        lines: ['ENGINE LIMITS PT6A-67B', `TORQUE ${PC12_TORQUE_PSI.takeoff} PSI T/O · ${PC12_TORQUE_PSI.mcp} PSI MCP`, `ITT ${PC12_ITT_C.takeoff} T/O · ${PC12_ITT_C.mcp} MCP · START ${PC12_ITT_C.start} (5 S)`, `NG ${NG_LIMIT} % · NP ${PC12_NP_GOVERNED} RPM`],
        size: 7,
      },
      { x: 2640, y: 370, lines: ['FUEL: JET A, JET A-1, JET B (TS-1)', '402 U.S. GAL USABLE'], size: 7.5 },
      { x: 1812, y: 250, lines: ['MAXIMUM CABIN DIFF PRESS', `${PC12_MAX_DIFF_PSI.toFixed(2)} PSID`], size: 7 },
      // The stabilised-propeller placard under the EIS.
      { x: PC12_EIS.x0 + EIS_ALL.w / 2, y: EIS_ALL.y + EIS_ALL.h + 14, lines: ['STABILIZED PROPELLER OPERATION ON GROUND (NOT FEATHERED)', `BETWEEN ${PC12_NP_PROHIBITED[0]} AND ${PC12_NP_PROHIBITED[1]} RPM IS PROHIBITED`], size: 6.5 },
    ],
    // Rack rails of the radio stack and the blanking plate of the audio panel's bay.
    rack: {
      rails: { x: STACK.x - 4, y: STACK.navcom1 - 6, w: 328, h: STACK.blank + STACK.blankH + 6 - STACK.navcom1 },
      blanks: [{ x: STACK.x, y: STACK.blank, w: 320, h: STACK.blankH }],
    },
  },
  // The control wheel shaft boots.
  keepOut: PC12_YOKES.xs.map((x) => ({ x, y: PC12_YOKES.y, r: PC12_YOKES.r })),
  apertures: APERTURES,
  // The instrument groups of InstrumentPanel.drawTo().
  regions: {
    sixpack: { x: PILOT_COLS[0] - 92, y: ROWS[0] - 92, w: 3 * PC12_T_PITCH.x, h: 2 * PC12_T_PITCH.y },
    engine: EIS_ALL,
    stack: { x: STACK.x, y: STACK.navcom1, w: 320, h: STACK.xpdr + 60 - STACK.navcom1 },
  },
  // Ring centre and radius of each instrument a lesson can name (training/types.ts InstrumentId). The power instrument
  // of a turboprop is the torque window: 'tach' points at it. No turn coordinator is fitted: 'tc' names the pilot's attitude
  // indicator and 'ball' the inclinometer across its foot (AttitudeGauge: the tube's lowest point at 0.74 aperture).
  spots: {
    asi: { x: PILOT_COLS[0], y: ROWS[0], r: BIG },
    ai: { x: PILOT_COLS[1], y: ROWS[0], r: BIG },
    alt: { x: PILOT_COLS[2], y: ROWS[0], r: BIG },
    tc: { x: PILOT_COLS[1], y: ROWS[0], r: BIG },
    ball: { x: PILOT_COLS[1], y: ROWS[0] + APERTURES.large * 0.72, r: APERTURES.large * 0.36 },
    dg: { x: PILOT_COLS[1], y: ROWS[1], r: BIG },
    vsi: { x: PILOT_COLS[2], y: ROWS[1], r: BIG },
    tach: { x: PC12_EIS.x0 + EIS_CELL / 2, y: PC12_EIS.y0 + EIS_CELL / 2, r: EIS_CELL * 0.55 },
    fuel: { x: PC12_EIS.x0 + EIS_CELL * 1.5, y: PC12_EIS.y0 + EIS_CELL * 1.5, r: EIS_CELL * 0.55 },
    oil: { x: PC12_EIS.x0 + EIS_CELL * 2.5, y: PC12_EIS.y0 + EIS_CELL * 2.5, r: EIS_CELL * 0.55 },
    flaps: { x: FLAP.x, y: FLAP.y, r: SMALL },
  },
};

// ---------------------------------------------------------------------------------------------------
// Instrument systems

/** The lamp needs bus power. */
const powered = (i: LampInputs): boolean => i.state.electrical.busVoltage > PC12_BUS_DEAD_VOLTS;
/** Generator output below which GEN OFF shows, A. */
const GENERATOR_LAMP_AMPS = 0.5;

/** The modelled CAWS lenses: bus power gates every lens; the lamp test (annunciatorTest) lights all of them. */
const CAWS_LOGIC: Record<(typeof PC12_CAWS_MODELLED)[number], (i: LampInputs) => boolean> = {
  esntlBus: (i) => i.state.electrical.busVoltage < PC12_CAWS_VOLTS.bus,
  nEssntlBus: (i) => i.state.electrical.busVoltage < PC12_CAWS_VOLTS.bus,
  // Blades finer than the flight low-pitch stop in the air (PropellerState.beta, the turbine core): AGENT reading of the
  // legacy "pitch below 6 deg in flight" (plan 5.1: the flight-idle stop is calibrated, not a hard 6 deg).
  propLowP: (i) => !i.state.onGround && (i.state.propellers[0]?.beta ?? false),
  leftFuelLow: (i) => (i.fuelGal[0] ?? 0) < FUEL_LOW_GAL,
  rightFuelLow: (i) => (i.fuelGal[1] ?? 0) < FUEL_LOW_GAL,
  fuelPress: (i) => i.state.engine.fuelPressure < FUEL_PRESS_LOW_PSI,
  // No hydraulic model: the lens shows the emergency gear extension (hydraulic system isolated), AGENT choice.
  hydr: (i) => i.controls.gearEmergency,
  gen1Off: (i) => (i.state.electrical.alternators[0] ?? 0) < GENERATOR_LAMP_AMPS,
  gen2Off: (i) => (i.state.electrical.alternators[1] ?? 0) < GENERATOR_LAMP_AMPS,
  pusher: (i) => (i.state.stickPusher ?? false) || (i.state.stickShaker ?? false),
  starter: (i) => i.controls.starter,
  // The igniters spark while the starter turns (IGNITION AUTO) or continuously with it ON (turbineEngine.ts).
  ignition: (i) => i.controls.starter || i.controls.magnetos !== 0,
};

export const PC12_INSTRUMENT_SYSTEMS: InstrumentSystemsDef = {
  engines: 1,
  // Electromechanical gyros on the 28 V bus; no vacuum system.
  vacuum: null,
  gyroDrive: { attitude: 'electric', heading: 'electric' },
  // Two wing tanks, one gauge each.
  fuel: { kgPerGal: PC12_KG_PER_GAL, tanks: [(s) => s.fuel.left, (s) => s.fuel.right] },
  busDeadVolts: PC12_BUS_DEAD_VOLTS,
  // The propeller tachometer paces the readings' tach hours.
  tachHourRpm: PC12_NP_GOVERNED,
  tachShaft: 'propeller',
  // Cabin altitude / differential display (PC12_CABIN_SCHEDULE), stepped with the instruments and reset with them.
  cabin: PC12_CABIN_SCHEDULE,
  lamps: [
    ...Object.entries(CAWS_LOGIC).map(([id, lit]) => ({
      id,
      lit: (i: LampInputs) => powered(i) && ((i.controls.annunciatorTest ?? false) || lit(i)),
    })),
    // Every other lens is unlit but takes the lamp test.
    ...CAWS_CELLS.filter(([id]) => id && !(id in CAWS_LOGIC)).map(([id]) => ({
      id,
      lit: (i: LampInputs) => powered(i) && (i.controls.annunciatorTest ?? false),
    })),
  ],
};
