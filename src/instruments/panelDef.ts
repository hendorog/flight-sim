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
}
export interface TachMarkings { max: number; majorStep: number; minorStep: number; numberStep: number;
                                arcs: readonly ArcDef[]; redLine: number; hourRpm: number }
export interface ScaleDef {
  label: string; min: number; max: number; majors: readonly number[]; minorStep: number;
  numbers?: boolean; arcs?: readonly ArcDef[]; redLines?: readonly number[];
  read(r: InstrumentReadings): number;
}

/** One row of the boxed engine display: a labelled value per engine with its bands and limits (which live in the type's panel data, never in the display component). */
export interface PanelEngineDisplayRow {
  label: string; unit: string; min: number; max: number; decimals?: number;
  arcs?: readonly ArcDef[]; redLines?: readonly number[];
  /** Value of this row for one engine (rows that are per side, like volts, read the same way). */
  read(r: InstrumentReadings, engine: number): number;
}

type At = readonly [number, number];
/**
 * `marks` of the airspeed indicator and the tachometer are REQUIRED: a type never inherits another's arcs by
 * omission. `scale` of the suction gauge and the ammeter (and the annunciator's `lamps`) are optional: absent =
 * the gauge class's default, the Cessna 172S's (aircraft/c172s/panel.ts).
 */
export type GaugeDef =
  | { kind: 'asi'; id: string; at: At; marks: AsiMarkings }
  | { kind: 'attitude' | 'altimeter' | 'turn' | 'heading' | 'vsi' | 'clock'; id: string; at: At }
  | { kind: 'cdi'; id: string; at: At; receiver: 'nav1' | 'nav2'; fixedCourseDeg: number }
  | { kind: 'tach'; id: string; at: At; size: 'large' | 'small'; marks: TachMarkings; engine?: number }
  | { kind: 'dual'; id: string; at: At; seed: number; title: readonly [string, string]; left: ScaleDef; right: ScaleDef }
  | { kind: 'single'; id: string; at: At; seed: number; size: 'large' | 'small'; a0: number; a1: number; title: string; units: string;
      labels: readonly number[]; scale: ScaleDef }
  /** Two needles (L, R) on one dial: twin tachometer, manifold pressure, fuel flow. */
  | { kind: 'twinNeedle'; id: string; at: At; seed: number; size: 'large' | 'small'; a0: number; a1: number; title: string; units: string;
      labels: readonly number[]; scale: Omit<ScaleDef, 'read'>; left(r: InstrumentReadings): number; right(r: InstrumentReadings): number }
  | { kind: 'suction' | 'ammeter'; id: string; at: At; scale?: ScaleDef }
  /** Three greens and the red unsafe light; with `lever`, also the gear selector drawn there, clickable as a 'select' hotspot. */
  | { kind: 'gearLights'; id: string; bounds: Rect; lever?: At }
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
  | { kind: 'gps' | 'navcom' | 'xpdr'; id: string; bounds: Rect };

export interface SwitchDef {
  id: string; label: string; name: string;
  /** Centre x within the switch row. */
  x: number; red?: boolean; group?: string;
  on(c: ControlInputs): boolean;
  toggle(c: ControlInputs): void;
}
export interface LampDef { id: string; text: string; color: string; lit(r: InstrumentReadings): boolean }

export type IgnitionPanelDef =
  | { kind: 'key'; at: At }                         // OFF / R / L / BOTH / START
  | { kind: 'toggles'; at: At; engines: number }    // L and R magneto toggles per engine + starter rocker (PA-34)
  | { kind: 'engineMaster'; at: At; engines: number }; // ENGINE MASTER per engine + START (DA42)

export interface PanelDef {
  id: string;
  /** Always { w: 2080, h: 800 }. Every gauge, switch, lamp and hotspot lies inside the cockpit's `panel.pxRect` (asserted by the generic per-type visual test). */
  size: { w: number; h: number };
  gauges: readonly GaugeDef[];
  annunciator?: { bounds: Rect; lamps?: readonly LampDef[] };
  switchRow: { bounds: Rect; rockerTop: number; rockerW: number; rockerH: number; switches: readonly SwitchDef[];
               legends: readonly { text: string; x: number; y: number; size?: number }[];
               dimmers?: { panel: number; radio: number; y: number } };
  ignition: IgnitionPanelDef;
  background: { seamsX: readonly number[];
                bushings: readonly { at: At; text: string; sub: string }[];
                placards: readonly { x: number; y: number; lines: readonly string[]; size?: number }[];
                breakers?: { bounds: Rect; names: readonly string[]; amps: readonly number[]; perRow: number };
                glovebox?: Rect;
                /** The avionics rack: the rails behind the units and the blanking plate of each empty bay. Absent: none is painted. */
                rack?: { rails: Rect; blanks: readonly Rect[] } };
  /** Circles 3D parts pass through (yoke boots): artwork and hotspots keep out. */
  keepOut: readonly { x: number; y: number; r: number }[];
  apertures: { large: number; small: number };
  regions: Readonly<Record<string, Rect>>;
  /** Highlight / point targets by InstrumentId or ControlId (px on the panel). */
  spots: Readonly<Record<string, { x: number; y: number; r: number }>>;
}

/** How far the dial sits behind the panel face, m: 3-1/8" instruments are mounted from behind (~14 mm), 2-1/4" ones ~10 mm. */
const RECESS_DEPTH_LARGE = 0.014;
const RECESS_DEPTH_SMALL = 0.01;

export interface LampInputs { state: AircraftState; controls: ControlInputs; fuelGal: readonly number[]; suctionInHg: number }

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
    case 'asi': case 'attitude': case 'altimeter': case 'turn': case 'heading': case 'vsi': case 'cdi':
      large = true;
      break;
    case 'tach': case 'single': case 'twinNeedle':
      large = g.size === 'large';
      break;
    case 'clock': case 'dual': case 'suction': case 'ammeter':
      large = false;
      break;
    default:
      return null;
  }
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
  /** The shaft the tachometers read: 'propeller' on a geared engine whose cockpit rpm is the propeller's. Absent: 'crank'. */
  tachShaft?: 'crank' | 'propeller';
  lamps: readonly { id: string; lit(i: LampInputs): boolean }[];
}
