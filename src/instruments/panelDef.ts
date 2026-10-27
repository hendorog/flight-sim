// The instrument panel of one aircraft type as data: gauges, switch row, annunciator, ignition, artwork, and
// what the instrument systems behind it need. CLOSURES (switch and lamp bindings, scale read-outs): never
// crosses a postMessage. Types and one pure function; no DOM.
//
// SwitchDef.on / .toggle and every hotspot handler that concerns one engine use engineControl /
// setEngineControl (core/types.ts); a momentary per-engine control (START L, START R) calls
// InputSystem.hold(action, down, engine), never the keyboard's engine selection.

import type { AircraftState, ControlInputs } from '../core/types';
import type { InputAction } from '../input/bindings';                 // type-only
import type { InstrumentReadings } from './dynamics/instrumentSet';   // type-only
import type { CabinSchedule } from './dynamics/cabinDisplay';     // type-only
import type { PanelComponent } from './render/component';

export interface Rect { x: number; y: number; w: number; h: number }
export type ArcColor = 'green' | 'yellow' | 'red' | 'white' | 'blue';
export interface ArcDef { from: number; to: number; color: ArcColor; inner?: boolean }

export interface AsiMarkings {
  /** Dial map: knots against needle angle, degrees. */
  scaleKt: readonly number[]; scaleDeg: readonly number[];
  tickFrom: number; tickTo: number; minorStep: number; numberStep: number;
  arcs: readonly ArcDef[];
  redLine: number;
  /** Twins: Vyse and Vmca. */
  blueLine?: number; redRadial?: number;
  /** Cross-hatched red radial for a configuration-dependent limit (e.g. rotorcraft power-off Vne). */
  crossHatchedLine?: number;
}
export interface TachMarkings { max: number; majorStep: number; minorStep: number; numberStep: number;
                                arcs: readonly ArcDef[]; redLine: number; hourRpm: number }
/** Separate scales of an electronic engine/rotor percent tachometer. */
export interface RotorTachMarkings {
  min: number; max: number; majorStep: number; minorStep: number;
  engineArcs: readonly ArcDef[]; rotorArcs: readonly ArcDef[]; rotorRedLines: readonly number[];
  engineRedLines?: readonly number[];
}
export interface ScaleDef {
  label: string; min: number; max: number; majors: readonly number[]; minorStep: number;
  numbers?: boolean; signedNumbers?: boolean; arcs?: readonly ArcDef[]; redLines?: readonly number[];
  read(r: InstrumentReadings): number;
}

/** One row of the boxed engine display: a labelled value per engine with its bands and limits (which live in the type's panel data, never in the display component). */
export interface PanelEngineDisplayRow {
  label: string; unit: string; min: number; max: number; decimals?: number;
  arcs?: readonly ArcDef[]; redLines?: readonly number[];
  /** Value of this row for one engine (rows that are per side, like volts, read the same way). */
  read(r: InstrumentReadings, engine: number): number;
}

/** One digital readout line of an EIS window: label, unit, a value with its alert colour. */
export interface EisReadout {
  label: string; unit?: string; decimals: number;
  read(r: InstrumentReadings): number;
  /** Colour the figure takes at this value (absent: white). */
  alert?(v: number): 'red' | 'amber' | undefined;
}
/** The round dial of an EIS window: a sweep in degrees clockwise from 12 o'clock, bands, red lines and numbered marks. */
export interface EisDial {
  min: number; max: number; fromDeg: number; toDeg: number;
  majors: readonly number[]; labels?: readonly number[];
  arcs?: readonly ArcDef[]; redLines?: readonly number[];
  read(r: InstrumentReadings): number;
  /** Divisor applied to the numbers printed on the scale (scale x100). */
  labelDivisor?: number;
}
/** Vertical bar indicators of an EIS window (fuel quantity, oil temperature and pressure). */
export interface EisBars {
  min: number; max: number; arcs?: readonly ArcDef[]; redLines?: readonly number[];
  items: readonly { label: string; read(r: InstrumentReadings): number }[];
}

type At = readonly [number, number];
/**
 * `marks` of the airspeed indicator and the tachometer are REQUIRED: a type never inherits another's arcs by
 * omission. `scale` of the suction gauge and the ammeter (and the annunciator's `lamps`) are optional: absent =
 * the gauge class's default, the Cessna 172S's (aircraft/c172s/panel.ts).
 */
export type GaugeDef =
  /** Aircraft-specific dial using the shared sizing, recess, lighting and redraw contract. */
  | { kind: 'customRound'; id: string; at: At; size: 'large' | 'small';
      create(id: string, x: number, y: number, aperture: number): PanelComponent }
  /** Aircraft-specific rectangular instrument (a vertical-tape gauge, an indicator window) owning `bounds` of the canvas. */
  | { kind: 'customRect'; id: string; bounds: Rect; create(id: string, bounds: Rect): PanelComponent }
  /**
   * `scale` of a flight instrument: its size against the 3-1/8" case (a 2" standby instrument is 0.64), drawn,
   * recessed and hit-tested at that size. Absent: 1 (the panel's instrumentScale still applies on top).
   */
  | { kind: 'asi'; id: string; at: At; marks: AsiMarkings; scale?: number }
  | { kind: 'altimeter' | 'turn' | 'heading' | 'vsi' | 'clock' | 'blank'; id: string; at: At; scale?: number }
  /** `inclinometer`: a slip ball in a tube across the foot of the face (an EADI, a standby horizon), on a panel without a turn coordinator. */
  | { kind: 'attitude'; id: string; at: At; inclinometer?: boolean; scale?: number }
  | { kind: 'cdi'; id: string; at: At; receiver: 'nav1' | 'nav2'; fixedCourseDeg: number }
  /**
   * Horizontal situation indicator: a slaved compass card with the heading bug, the course pointer set by the OBS
   * (NAV 1; `fixedCourseDeg` otherwise), its deviation bar and the glideslope pointers of `receiver`.
   */
  | { kind: 'hsi'; id: string; at: At; receiver: 'nav1' | 'nav2'; fixedCourseDeg: number }
  /** Radio magnetic indicator: a slaved card and two bearing needles, no. 1 on the GPS's active waypoint, no. 2 (ADF) parked. */
  | { kind: 'rmi'; id: string; at: At }
  | { kind: 'tach'; id: string; at: At; size: 'large' | 'small'; marks: TachMarkings; engine?: number }
  | { kind: 'rotorTach'; id: string; at: At; marks: RotorTachMarkings }
  | { kind: 'hourmeter'; id: string; bounds: Rect }
  | { kind: 'digitalTemperature'; id: string; bounds: Rect; label: string; read(r: InstrumentReadings): number }
  /** Panel-mounted pull control. The guard must be lifted before moving the knob. */
  | { kind: 'pullKnob'; id: string; bounds: Rect; label: string; color: string;
      read(c: ControlInputs): number; set(c: ControlInputs, value: number): void;
      guard?: { closed(c: ControlInputs): boolean; toggle(c: ControlInputs): void } }
  | { kind: 'pushButton'; id: string; bounds: Rect; label: string;
      read(c: ControlInputs): boolean; press(down: boolean, c: ControlInputs): void; holdAction?: InputAction }
  | { kind: 'positionSwitch'; id: string; bounds: Rect; label: string; positions: readonly string[];
      read(c: ControlInputs): number; set(c: ControlInputs, position: number): void;
      guard?: { closed(c: ControlInputs): boolean; toggle(c: ControlInputs): void } }
  | { kind: 'dualSector'; id: string; bounds: Rect; left: ScaleDef; right: ScaleDef }
  | { kind: 'dual'; id: string; at: At; seed: number; title: readonly [string, string]; left: ScaleDef; right: ScaleDef }
  | { kind: 'single'; id: string; at: At; seed: number; size: 'large' | 'small'; a0: number; a1: number; title: string; units: string;
      labels: readonly number[]; scale: ScaleDef }
  /** Two needles (L, R) on one dial: twin tachometer, manifold pressure, fuel flow. */
  | { kind: 'twinNeedle'; id: string; at: At; seed: number; size: 'large' | 'small'; a0: number; a1: number; title: string; units: string;
      labels: readonly number[]; scale: Omit<ScaleDef, 'read'>; left(r: InstrumentReadings): number; right(r: InstrumentReadings): number;
      /** The letters of the two needles (default L, R; a helicopter's engines are numbered 1, 2). */
      letters?: readonly [string, string] }
  | { kind: 'suction' | 'ammeter'; id: string; at: At; scale?: ScaleDef }
  /** Three greens and the red unsafe light; with `lever`, also the gear selector drawn there, clickable as a 'select' hotspot. */
  | { kind: 'gearLights'; id: string; bounds: Rect; lever?: At;
      /** Legend of the first green lamp (default NOSE): TAIL on a tail-wheel type (the AH-56A's gear state keeps its tail wheel in the nose slot). */
      noseLegend?: string }
  | { kind: 'flapLever'; id: string; bounds: Rect; maxDeg: number; legends: readonly string[] }
  /**
   * One lamp per flap position. colors: lamp colour per position (DA42: green, white, white; DA20: green, yellow,
   * yellow); absent: green, then white. With `lever`, also the flap switch drawn there, clickable as a 'select' hotspot.
   */
  | { kind: 'flapLights'; id: string; bounds: Rect; positions: readonly string[]; colors?: readonly ArcColor[]; lever?: At;
      /**
       * Flap deflection at each position, degrees. Given: the lamps show the ACTUAL flaps (the lamp of a position
       * reached, the two neighbours while the flaps travel between positions) and the switch selects
       * degrees[i] / the last. Absent: the positions are evenly spaced over the lever's travel and the lamps follow the lever.
       */
      degrees?: readonly number[] }
  | { kind: 'trimBar'; id: string; bounds: Rect; axis: 'elevator' | 'rudder' }
  /** A guarded pull knob or push-button on the panel (emergency gear extension, gear-warning test): one click = the action. */
  | { kind: 'guardedKnob'; id: string; at: At; label: string; action: InputAction; engine?: number }
  /** Boxed engine display (DA42, D6): per engine LOAD %, RPM, fuel flow, oil temp/pressure, coolant, gearbox, volts/amps, one `rows` entry each. */
  | { kind: 'engineDisplay'; id: string; bounds: Rect; engines: number; rows: readonly PanelEngineDisplayRow[] }
  | { kind: 'gps' | 'navcom' | 'xpdr'; id: string; bounds: Rect }
  /**
   * One window of a legacy engine instrument system (Pilatus EIS): a self-lit black window with a title, an optional
   * round dial, up to three digital readouts and optional vertical bars. Dark while the bus is unpowered.
   */
  | { kind: 'eisWindow'; id: string; bounds: Rect; title: string; dial?: EisDial; readouts: readonly EisReadout[]; bars?: EisBars };

export interface SwitchDef {
  id: string; label: string; name: string;
  /** Optional rocker top relative to the switch group (separate clutch switch on a console). */
  top?: number;
  /** Centre x within the switch row. */
  x: number; red?: boolean; group?: string;
  /** Raised red safety cover, posed open for ENGAGE; click binding remains the switch's. */
  cover?: boolean;
  on(c: ControlInputs): boolean;
  toggle(c: ControlInputs): void;
}
export interface LampDef { id: string; text: string; color: string; lit(r: InstrumentReadings): boolean;
  /** Individual press-to-test lens. */
  press?(down: boolean, c: ControlInputs): void }

export type IgnitionPanelDef =
  | { kind: 'key'; at: At; prime?: boolean }                         // OFF / R / L / BOTH / START
  | { kind: 'toggles'; at: At; engines: number;    // L and R magneto toggles per engine + starter rocker (PA-34)
      /**
       * 'ignition': ONE IGNITION toggle per engine instead of the two magneto toggles, and the rocker lettered
       * STARTER (a turbine's igniters: off = magnetos 0, on = both bits). Absent: 'magnetos'.
       */
      switches?: 'magnetos' | 'ignition';
      /** The two engines' names on the legends of a twin: ['L', 'R'] by default ('1', '2' on a helicopter whose engines are numbered). */
      sides?: readonly [string, string] }
  | { kind: 'engineMaster'; at: At; engines: number }; // ENGINE MASTER per engine + START (DA42)

export interface PanelDef {
  id: string;
  /** Fixed view: rows preserve the type's flight-instrument arrangement. Controls are canvas crops,
   * including their legends; remaining gauges and annunciators are arranged automatically. */
  fixed?: { flightRows: readonly (readonly string[])[]; controls: readonly Rect[];
    /** Canvas crops shown whole in the Upper view after the flight rows (an engine display whose windows must stay together); gauges inside one are not placed again. */
    crops?: readonly Rect[];
    /** Put the annunciator beside the engine instruments instead of below them (a tall engine display and a large warning grid). */
    lampsBeside?: boolean;
    /** Gauges (by id) that belong in the Lower view whatever their kind (the second-rank engine monitoring of a twin). */
    lower?: readonly string[] };
  /** Dial lighting interlock; self-lit radios and warning lenses remain independent. */
  lightingRequiresNav?: boolean;
  /** Optional dimmer curve: emissive alpha tags dimmed circuits (0.5) versus warning lamps (1).
   * Renderer applies the curve after RGB filtering, at constant luminance. Absent retains legacy dimming. */
  lightingDimmerExponent?: number;
  /** Canvas size from the type's cockpit contract. Every component lies inside its panel face. */
  size: { w: number; h: number };
  /** Separate rotorcraft pod and pedestal shells; coordinates share the flat face's canvas UVs. */
  console?: { podOutline: readonly At[]; pedestalOutline: readonly At[]; hoodOverhang: number;
    color: number; pedestalColor: number };
  gauges: readonly GaugeDef[];
  /**
   * `lensLegend` (with `cells`): each cell is a rectangular press-to-test lens with the legend on the lens cap itself
   * (MD 500E), instead of a round lens under a painted legend.
   */
  annunciator?: { bounds: Rect; lamps?: readonly LampDef[]; columns?: number; cells?: readonly Rect[]; lensLegend?: boolean;
    /** Keep a lit lens's glow inside its own cell (a lens that flashes would otherwise pile its glow onto the lenses beside it). */
    clipGlow?: boolean };
  switchRow: { bounds: Rect; rockerTop: number; rockerW: number; rockerH: number; switches: readonly SwitchDef[]; ink?: string; distributed?: boolean;
               legends: readonly { text: string; x: number; y: number; size?: number }[];
               dimmers?: { panel: number; radio: number; y: number } };
  ignition: IgnitionPanelDef;
  /**
   * A hand primer's knob (EngineDef.primer), panel px of its centre: painted with its lock and its strokes, and
   * clickable (instruments/hotspots.ts: right half one stroke, left half the lock). Its bushing and legend are a
   * background bushing. Absent: none.
   */
  primer?: { at: At };
  background: { color?: string; outline?: readonly At[]; seamsX: readonly number[];
                plates?: readonly { bounds: Rect; color: string; radius?: number }[];
                bushings: readonly { at: At; text: string; sub: string }[];
                placards: readonly { x: number; y: number; lines: readonly string[]; size?: number }[];
                /** Legends ('' an empty slot) and ratings, A, row by row, `perRow` to a row. */
                breakers?: { bounds: Rect; names: readonly string[]; amps: readonly number[]; perRow: number };
                glovebox?: Rect;
                /** The avionics rack: the rails behind the units and the blanking plate of each empty bay. Absent: none is painted. */
                rack?: { rails: Rect; blanks: readonly Rect[] } };
  /** Circles 3D parts pass through (yoke boots): artwork and hotspots keep out. */
  keepOut: readonly { x: number; y: number; r: number }[];
  /** Gauges drawn on the canvas outside the face and shown on 3D parts of the cockpit (CockpitDef.panel.windows). */
  offFace?: readonly string[];
  apertures: { large: number; small: number };
  /** Scale of complete round instruments, including needles, bezels and hotspots; absent = native artwork. */
  instrumentScale?: { large: number; small: number };
  instrumentBezel?: 'square' | 'round';
  regions: Readonly<Record<string, Rect>>;
  /** Highlight / point targets by InstrumentId or ControlId (px on the panel). */
  spots: Readonly<Record<string, { x: number; y: number; r: number }>>;
}

/** How far the dial sits behind the panel face, m: 3-1/8" instruments are mounted from behind (~14 mm), 2-1/4" ones ~10 mm. */
const RECESS_DEPTH_LARGE = 0.014;
const RECESS_DEPTH_SMALL = 0.01;

export interface LampInputs { state: AircraftState; controls: ControlInputs; fuelGal: readonly number[]; suctionInHg: number }

/** A gauge's own size factor (GaugeDef `scale`), 1 when it has none. */
export function gaugeScale(g: GaugeDef): number {
  return 'scale' in g && typeof g.scale === 'number' ? g.scale : 1;
}

/**
 * The 3D recess of a gauge: centre and aperture radius, px on the canvas, and how far the dial sits behind the
 * panel face, m; or null for a kind that has none (rack units, light clusters, levers). The ONE place that
 * knows which kinds are round and how large: the 2D artwork and the 3D recess shader both call it, so they
 * cannot disagree. The rule is the Cessna 172S panel's: the six-pack, the CDIs and a 'large' dial take the
 * large aperture; the clock, suction, ammeter, the dual engine gauges and a 'small' dial the small one.
 */
export function gaugeRecess(g: GaugeDef, apertures: { large: number; small: number }): { x: number; y: number; r: number; depth: number } | null {
  let large: boolean;
  switch (g.kind) {
    case 'asi': case 'attitude': case 'altimeter': case 'turn': case 'heading': case 'vsi': case 'cdi': case 'hsi': case 'rmi': case 'rotorTach': case 'blank':
      large = true;
      break;
    case 'tach': case 'single': case 'twinNeedle': case 'customRound':
      large = g.size === 'large';
      break;
    case 'clock': case 'dual': case 'suction': case 'ammeter':
      large = false;
      break;
    default:
      return null;
  }
  const k = gaugeScale(g);
  if (k !== 1) return { x: g.at[0], y: g.at[1], r: (large ? apertures.large : apertures.small) * k, depth: large ? RECESS_DEPTH_LARGE : RECESS_DEPTH_SMALL };
  return { x: g.at[0], y: g.at[1], r: large ? apertures.large : apertures.small, depth: large ? RECESS_DEPTH_LARGE : RECESS_DEPTH_SMALL };
}

export interface InstrumentSystemsDef {
  engines: 1 | 2;
  /** Engine-driven vacuum pumps (any one sustains the gyros), or null (no vacuum system). */
  vacuum: { engines: readonly number[]; regulatedInHg: number; ratedInHg: number; suction(rpm: number): number } | null;
  gyroDrive: { attitude: 'vacuum' | 'electric'; heading: 'vacuum' | 'electric' };
  /** kg per US gallon of the fuel, and kg indicated per gauge. */
  fuel: { kgPerGal: number; tanks: readonly ((s: AircraftState) => number)[] };
  busDeadVolts: number;
  tachHourRpm: number;
  /** The oil pressure gauge is fed by a pressure line (Bourdon tube) and reads without bus power. Absent: electric. */
  oilPressureDirect?: boolean;
  /** The shaft the tachometers read: 'propeller' on a geared engine whose cockpit rpm is the propeller's. Absent: 'crank'. */
  tachShaft?: 'crank' | 'propeller';
  /** Electric dual tachometer: independent percent references and battery bypass supply. */
  rotorTach?: { engineRpm100: number; rotorRpm100: number; powered(i: LampInputs): boolean };
  /** Carburettor probe temperature, C. A type may supply an explicitly documented estimate. */
  carbAirTempC?(s: AircraftState, c: ControlInputs): number;
  hourmeterRunning?(s: AircraftState, c: ControlInputs): boolean;
  /** Cabin altitude / differential display (dynamics/cabinDisplay.ts), stepped with the instruments: readings.cabinAltFt, cabinDiffPsi. */
  cabin?: CabinSchedule;
  /**
   * Bespoke readings evaluated every step from the whole state (readings.extra[id]): what a type's custom gauges and lamps
   * need that the common readings do not carry. Pure functions of the state and the controls.
   */
  extra?: Readonly<Record<string, (s: AircraftState, c: ControlInputs) => number>>;
  /**
   * `chime`: a caution and warning panel lens (PC-12 CAWS) whose lighting strikes the master chime: InstrumentSet
   * reports the edge (takeChime), the panel emits the 'caws' sim event. Not on the lamp test, not at a reset.
   */
  lamps: readonly { id: string; lit(i: LampInputs): boolean; chime?: 'warning' | 'caution' }[];
}
