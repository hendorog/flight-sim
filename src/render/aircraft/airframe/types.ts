// The visual description of one airframe: everything the 3D model, the livery bake and the cockpit are built
// from. PLAIN, structured-cloneable data: no three.js types, no functions, no class instances (the livery
// worker reconstructs lofts and window masks from this alone). Positions are FRD metres from the type's
// reference point.
//
// State the visual reads, all in core/types.ts: state.propellers[i].{rotation, rpm, bladePitch, direction},
// state.gear.extension, state.engines[i].cowlFlap, state.surfaces (incl. rudderTrim), state.wheels.

import type { FuelSelector } from '../../../core/types';

export type FRD = readonly [number, number, number];
/** NACA 4-digit stand-in used for the visual contour: camber, camber position, thickness (fractions of chord). */
export interface SectionShape { m: number; p: number; t: number }

/** A lofted body (fuselage, nacelle): today's fuselageShape.ts key table. */
export interface LoftDef {
  /** Rows nose to tail: [x, zTop, zBot, zMid, halfWidth, nTop, nBot, ridge]. */
  keys: readonly (readonly [number, number, number, number, number, number, number, number])[];
  frontX: number; endX: number;
  ridgeW?: number;
  /** Offset of the loft's own axis (nacelles). */
  offset?: { y: number; z: number };
  grid?: { rows: number; cols: number };
}

export interface OutlineDef {
  pts: readonly (readonly [number, number])[]; r: number; sides: 'both' | 'left' | 'right';
  /** The outline is only looked at aft of this station (an early-out of the window distance). Absent: everywhere. */
  maxX?: number;
}

export interface GlazingDef {
  /** firewallX: the firewall, or the forward cabin bulkhead where the nose has no engine (PA-34, DA42). */
  cabinFrontX: number; cabinRearX: number; firewallX: number;
  /** Ring-fraction range the glass loft covers (0.2 .. 0.8 today). */
  tRange: readonly [number, number];
  /** Side-projection (x, z) convex outlines. A bubble canopy is one large outline bounded by sill, front and rear bows. */
  windows: readonly OutlineDef[];
  windscreen?: { sillC: readonly [number, number]; sillN: readonly [number, number];
                 post: readonly [readonly [number, number], readonly [number, number]]; postY: number; topX: number };
  /** Panel lines only (doors, baggage doors, canopy joint). */
  doors: readonly (OutlineDef & { handle?: { x: number; z: number } })[];
  /** Cabin-lining roof limit (FRD z); -Infinity is not cloneable-safe in JSON, so use -1e9 for "no headliner" (canopy). */
  liningRoofLimit: number;
  /** Stations [front, rear] outside which there is no glazing at all. Absent: [cabinFrontX, cabinRearX]. */
  xRange?: readonly [number, number];
  /**
   * Fabric headliner in the lining's relief: above z0 (full by z1) between the stations x0 > x1, with a seam
   * across the roof every `pitch` metres. Absent: none.
   */
  headliner?: { x0: number; x1: number; z0: number; z1: number; pitch: number };
}

export interface SurfaceBayDef { kind: 'fixed' | 'flap' | 'aileron'; from: number; to: number; chordFraction?: number }

export interface WingVisualDef {
  mount: 'high' | 'low';
  section: SectionShape;
  /** Chord and quarter-chord x at span breaks (linear between). */
  breaks: readonly { y: number; chord: number; qcX: number }[];
  rootY: number; qcZ: number; dihedral: number; rootIncidence: number; tipIncidence: number;
  /**
   * How the wing meets the body. 'cap' (default = today): flat cap at rootY (a high wing whose root section the
   * roof keys follow). 'conform' (low wings): the innermost station is not capped; each of its vertices is
   * moved inboard to `sectionHalfWidth(outerSkin, x, z) - 0.01`, so the wing ends just under the fuselage skin
   * at every chordwise point and nothing enters the cabin. rootY stays the geometric datum shared with
   * AircraftGeometry (dihedral and washout are measured from it) and is never used as a cosmetic knob.
   */
  root?: 'cap' | 'conform';
  /** Ordered, contiguous bays from rootY to the tip; a nacelle gap or a fixed panel is a 'fixed' bay. */
  bays: readonly SurfaceBayDef[];
  flap: { maxDeflection: number; travelAft: number; travelDown: number };
  /**
   * A winglet starts at the last `breaks` station (the tip is then not rounded off): `height` metres measured
   * along itself, canted up from the wing plane by `cant` (rad; pi / 2 = upright), its quarter-chord line swept
   * aft by `sweep`, chord from rootChord to tipChord. Over the first `blend` of its height (absent: 0.3) the
   * wing's tip section turns up and narrows into it.
   */
  tip: { round: number; chordRound: number;
         winglet?: { height: number; cant: number; rootChord: number; tipChord: number; sweep: number; section: SectionShape;
                     blend?: number } };
  strut?: { fuselage: FRD; wing: FRD; chord: number; tc: number };
  fuelCaps: readonly { y: number; xc: number; side: 'both' | 'left' | 'right' }[];
  pitot?: { side: 1 | -1; y: number; xc: number };
  /** Black non-slip walkways on the upper surface from span y0 to y1 and chord fraction xc0 to xc1. Absent: none. */
  walkways?: readonly { y0: number; y1: number; xc0: number; xc1: number; side: 'both' | 'left' | 'right' }[];
  /** Triangular stall (flow) strips on the leading edge from span y0 to y1, both wings. Absent: none. */
  stallStrips?: readonly { y0: number; y1: number }[];
  /** The stall-warning lift-detector vane: a small tab under the leading edge at span y (side -1 = left). Absent: none. */
  liftDetector?: { side: 1 | -1; y: number };
}

export interface TailVisualDef {
  section: SectionShape;
  h: { span: number; rootChord: number; tipChord: number;
       /** ROOT (centre-line) quarter-chord point. */
       quarterChord: { x: number; z: number };
       /** Quarter-chord x at the tip of a swept tailplane. Absent: quarterChord.x (straight quarter-chord line, C172S). */
       tipQuarterChordX?: number;
       incidence: number;
       /**
        * 'stabilator': the whole surface turns with state.surfaces.elevator about the spanwise line at
        * pivotFraction of the chord (absent: 0.25); chordFraction is then not read.
        */
       kind: 'elevator' | 'stabilator'; chordFraction: number; pivotFraction?: number;
       /** Inboard elevator cut (0 for a T-tail or stabilator). */
       innerCutY: number;
       /** gearing: anti-servo tab, tab angle = gearing x surface angle + state.surfaces.elevatorTrim. Absent: 0 (a trim tab). */
       tab?: { y0: number; y1: number; xc: number; sides: 'right' | 'both'; gearing?: number } };
  v: { base: { x: number; z: number }; tip: { x: number; z: number }; rootChord: number; tipChord: number;
       rudderChordFraction: number; rudderExtension?: { bottomH: number; aftChord: number };
       /** A tab in the rudder's trailing edge from fin height h0 to h1, hinged at chord station xc; it shows state.surfaces.rudderTrim. */
       rudderTab?: { h0: number; h1: number; xc: number } };
  /**
   * The tailplane sits on the fin tip (h.quarterChord.z is the junction): the fin and the rudder are not rounded
   * off at the top, and a bullet fairing covers the junction.
   */
  tTail: boolean;
  /**
   * T-tail only: the bullet fairing's aft tip (FRD x, m) and its largest radius (m). Absent: from 0.15 chord ahead
   * of the tailplane root's leading edge to its trailing edge, radius from the section thickness.
   */
  bullet?: { aftX?: number; radius?: number };
  /** A thin fillet ahead of the fin: from the body's top line at station x0 up to the fin's leading edge `height` above the fin base. */
  dorsalFillet?: { x0: number; height: number };
  /** A thin fin under the tail cone from station x0 aft to x1, `depth` deep at its aft end. */
  ventralFin?: { x0: number; x1: number; depth: number };
  vorAntenna?: boolean;
}

/**
 * The leg between the airframe and a wheel's axle (the axle is at the contact point less the wheel radius).
 * Every kind may stand at the nose or at a main wheel.
 * - springTube: a tapered round tube from `root` to the axle fitting, bending as a cantilever with the
 *   strut compression; axleOffset = lateral distance from the wheel's centre plane to the leg's end.
 * - leafSpring: the same cantilever as a flat leaf, `width` along the aircraft and `thickness` through it.
 * - oleo: a cylinder from `top` toward the axle, cylinderLen long, with a piston that slides into it; the fork
 *   crown is crownAt from the top and the fork legs stand forkHalf either side of the wheel.
 * - trailingLink: an arm from `pivot` aft (or forward) to the axle, which swings up about the pivot as the
 *   strut compresses; armLen = pivot to axle. `top` (absent: the retract pivot, or no post) is the upper end
 *   of the fixed post the arm hangs on.
 */
export type LegVisualDef =
  | { kind: 'springTube'; root: FRD; axleOffset: number; r0: number; r1: number }
  | { kind: 'leafSpring'; root: FRD; width: number; thickness: number }
  | { kind: 'oleo'; top: FRD; cylinderLen: number; crownAt: number; forkHalf: number; scissors: boolean; steers: boolean }
  | { kind: 'trailingLink'; pivot: FRD; armLen: number; top?: FRD };

export interface WheelVisualDef {
  contact: FRD; radius: number; width: number; rimRadius: number;
  leg: LegVisualDef;
  fairing?: { length: number; halfWidth: number; top: number; bottom: number };
  /**
   * Leg swings about `axis` through `pivot` by `angle` (rad, right-hand rule about `axis`) from down to up;
   * the leg is not drawn when fully up. A door's `pts` are its outline CLOSED (flush with the skin); it swings
   * open by its `angle` about its `axis` through `hinge` as the leg comes down (the same extension value).
   * `well`: outline of the dark inset decal drawn on the skin under the doors (no hole is cut).
   */
  retract?: { pivot: FRD; axis: FRD; angle: number;
              doors: readonly { hinge: FRD; axis: FRD; angle: number; pts: readonly FRD[] }[];
              well?: readonly FRD[] };
}

export interface PropVisualDef {
  hub: FRD; diameter: number; blades: number;
  /**
   * Handedness of the BLADE GEOMETRY only (twist and the direction of the motion smear). The spin angle comes
   * from PropellerState.rotation unchanged, which is already signed (group.rotation.z = -rotation as today):
   * do not apply `rotation` to the angle as well.
   */
  rotation: 1 | -1;
  /** Blade angle at the reference station the geometry is built at, rad; variable pitch is applied per instance about the blade axis. */
  referencePitch: number;
  variablePitch: boolean;
  /** Chord (m) against r / R. */
  chord: readonly (readonly [number, number])[];
  /** Geometric pitch of the blade's helical twist, m: beta(r) = atan(pitch / 2 pi r). Absent: the helix through referencePitch at 0.75 R. */
  geometricPitch?: number;
  spinner: { baseX: number; radius: number; length: number };
  paint: { face: FRD; back: FRD; tip: FRD; tipBand: number };
}

export interface InletDef {
  y: number; z: number; w: number; h: number; r: number;
  /**
   * Fuselage inlets (alpha cut-outs of the baked texture with a duct behind; `r` is the corner radius of a
   * nacelle's decal inlet and is not read here): the outline is a superellipse of this exponent in w x h.
   * Absent: 3.2.
   */
  exponent?: number;
  /** Fuselage inlets: the opening exists forward of xMin, the duct ends at the baffle. Absent: 0.105 m and 0.175 m behind the loft's frontX. */
  xMin?: number; baffleX?: number;
}
/**
 * An engine nacelle: nacelle i belongs to engine i. The loft (with its `offset`), the exhaust and the cowl
 * flaps are written for the RIGHT side of the aircraft; `side: -1` mirrors all of them in y. Inlet y and z are
 * measured from the loft's own axis.
 */
export interface NacelleVisualDef {
  /** Nacelle inlets are dark inset DECAL meshes on the unbaked loft (the fuselage's inlets stay alpha cut-outs of its baked texture). */
  loft: LoftDef; side: 1 | -1; inlets: readonly InletDef[]; exhaust?: { pos: FRD; radius: number };
  /** Each flap's `pts` are its outline closed; it opens by maxAngle x state.engines[i].cowlFlap about `axis` through `hinge`. */
  cowlFlaps?: readonly { hinge: FRD; axis: FRD; maxAngle: number; pts: readonly FRD[] }[];
}
/** An unbaked loft built with the nacelle code path: wing-root fillets, nacelle tail fairings, strut cuffs, flap-hinge fairings. */
export type FairingDef = LoftDef & { paint: 'base' | 'band'; mirror?: boolean };

/** The eight lamp ids are fixed (photometry is keyed on them, and the scene keeps 2 spot + 3 point lights). */
export interface LampVisualDef {
  id: 'navL' | 'navR' | 'navTail' | 'strobeL' | 'strobeR' | 'beacon' | 'landing' | 'taxi';
  pos: FRD; radius: number; glowOffset: FRD;
  /** A lamp parented to a gear leg moves with it and is extinguished below extension 0.9. */
  parent?: 'rudder' | 'noseGear';
  aim?: { downDeg: number; outDeg: number; halfAngleDeg: number };
}

/**
 * One moulded side-wall panel: a height field over the lining from x0 to x1 and z0 to z1, standing `relief`
 * metres proud inside its rounded edge. side 0 = on both sides. The optional members are the mouldings of
 * today's C172S panels; absent = a plain panel.
 */
export interface VisualTrimPanelDef {
  side: 1 | -1 | 0; x0: number; x1: number; z0: number; z1: number; relief: number;
  material: 'trimPlastic' | 'carpet' | 'seatFabric' | 'panelPlastic';
  /** Grid of the panel (rows along x, columns along z). Absent: 24 x 24. */
  grid?: { rows: number; cols: number };
  /** Width of the rounded edge over which the relief rises, m. Absent: 0.02. */
  edge?: number;
  /** The relief does not fall off toward the lower edge (the panel runs on below the floor). */
  openBelow?: boolean;
  /** Height the whole panel stands off the lining, edge included, m. Absent: 0. */
  offset?: number;
  /** A bolster from x = xa to xb, centred at zc with half height hz, standing `height` proud, tapering over `taper` at its ends. */
  armrest?: { xa: number; xb: number; zc: number; hz: number; height: number; taper: number };
  /** A rectangle set back by `depth` (where another panel is let in), rounded over `edge`. */
  recess?: { x0: number; x1: number; z0: number; z1: number; depth: number; edge: number };
  /** A map pocket: its lip stands `lip` proud at zTop between x0 > x1 and runs out over `depth` below. */
  pocket?: { x0: number; x1: number; zTop: number; depth: number; lip: number };
}

export interface CockpitDef {
  pilotEye: FRD; defaultPitchDeg: number;
  enclosure: 'cabin' | 'canopy';
  /**
   * The flat panel face. The canvas is always 2080 x 800 px. `pxRect` is the part of it shown on the face
   * (default the whole canvas); pxPerM = pxRect.w / width, and the face HEIGHT IS DERIVED as pxRect.h / pxPerM
   * (there is no height field: pixels are square by construction, so round dials stay round and coincide with
   * the round recesses). The mesh UVs cover pxRect, so cockpit clicks (uv x 2080 / 800) need no change. C172S:
   * width 1.04, no pxRect (2000 px/m, height 0.40). A low panel uses e.g. pxRect { x: 0, y: 0, w: 2080, h: 624 }
   * at width 1.0. The recess radius uses pxPerM, not the literal 2000; the recess depth is in metres (gaugeRecess).
   */
  panel: { x: number; zTop: number; width: number; pxRect?: { x: number; y: number; w: number; h: number } };
  floor: { z: number; x0: number; x1: number };
  glareshield: { profile: readonly (readonly [number, number])[]; halfWidth: number };
  /**
   * x: the cushion's front edge. z: top of the cushion (absent: 0.265 m above the floor). reclineDeg: of the back from
   * upright (absent: 12). kind 'shell': a fixed one-place seat shell moulded into the cabin tub (Diamond), its back
   * running up into an integral head section, with no headrest posts and no seat rails. back: the back's height
   * (absent: 0.6 front, 0.56 bench, 0.78 shell) and whether a front seat has its headrest on posts (absent: true).
   */
  seats: readonly { x: number; y: number; kind: 'front' | 'bench' | 'shell'; width: number; depth: number; reclineDeg?: number; z?: number;
                    back?: { height?: number; headrest?: boolean } }[];
  /** Interior furniture as bevelled boxes: knee panel, pedestal, quadrant body, centre console, floor tunnel. The engine controls sit in these. */
  consoles: readonly { min: FRD; max: FRD; bevel: number;
                       material: 'panelPlastic' | 'trimPlastic' | 'carpet' | 'black' | 'darkMetal' | 'aluminium' | 'seatFabric' | 'glareshield';
                       /** An (x, z) outline extruded across the cabin from min y to max y instead of the box (a knee panel). */
                       profile?: readonly (readonly [number, number])[] }[];
  /** Moulded side-wall panels fitted to the lining (the generic liningPanel() call). C172S: today's cabinTrim stations as data. */
  trimPanels: readonly VisualTrimPanelDef[];
  /** Simple seated figures drawn in EXTERNAL views only (hidden in the cockpit view). Default none. `seat` indexes `seats`. */
  occupants?: readonly { seat: number }[];
  /**
   * yoke: one at y and one at -y, sliding `travel` fore and aft and turning rollDeg. stick: one at each of
   * `ys`, `height` tall from `pivot` (its y is not read), leaning pitchDeg fore and aft and rollDeg sideways.
   */
  column: { kind: 'yoke'; x: number; y: number; z: number; travel: number; rollDeg: number }
        | { kind: 'stick'; pivot: FRD; height: number; pitchDeg: number; rollDeg: number; ys: readonly number[] };
  pedals: { x: number; ys: readonly number[] };
  /**
   * Push-pull knobs and quadrant levers, animated from ControlInputs through engineControl(). knob: `pos` is
   * where its shaft leaves the panel, `travel` how far it pulls out, m. lever: `pos` is its pivot, `travel`
   * its swing, rad (forward = 1), `length` (absent: 0.11) the pivot-to-knob distance, m.
   */
  engineControls: readonly { kind: 'knob' | 'lever'; control: 'throttle' | 'mixture' | 'propeller' | 'carbHeat' | 'cowlFlaps' | 'alternateAir';
                             engine: number; pos: FRD; travel: number; colour: 'black' | 'red' | 'blue' | 'white'; length?: number }[];
  /**
   * panelLever: a lever in a slot on the panel face, `travel` m down from UP to FULL. panelSwitch: a paddle
   * switch on the face, tilting `travel` rad. floorLever: a hand lever between the seats pivoted at `pos`,
   * pulled up by `travel` rad for full flap.
   */
  flapControl: { kind: 'panelLever' | 'panelSwitch' | 'floorLever'; pos: FRD; travel: number };
  /** The gear selector on the panel face at `pos`: a short lever with a wheel-shaped knob, up or down with controls.gearLever. */
  gearLever?: { pos: FRD };
  /**
   * A fuel selector handle on an aft-facing face (a quadrant) at `pos`: a pointer turning about the body x axis to
   * `angles[position]` (degrees clockwise as the pilot sees it, 0 = up) for controls.fuelSelector, with a white tick
   * at each position. Absent: none (the C172S's selector is the floor dial of fittings.fuelSelector).
   */
  fuelSelectorHandle?: { pos: FRD; angles: Partial<Record<FuelSelector, number>> };
  /** A T-handle on an aft-facing face at `pos`, pulled `travel` m aft while controls.parkingBrake is set. Absent: none. */
  parkingBrakeHandle?: { pos: FRD; travel: number };
  /** Absent: no trim wheel. axis: the body axis the wheel turns about. */
  trimWheel?: { pos: FRD; axis: 'x' | 'y' };
  /** Absent: no magnetic compass. */
  compass?: { pos: FRD };
  /**
   * Cabin fittings only some types have; what is absent is not fitted.
   * defrosters: centres of the outlet slots on the glareshield top. fuelSelector: the selector dial on the floor
   * at (x, y), its red shut-off knob at shutoffX. visors: tinted sun visors folded up under the headliner,
   * centred at (x, +/-each of ys, z). vents: round fresh-air outlets in the upper cabin corners. overhead: the
   * console around the flood lamp and the dome lamp's housing, on a headliner at height z. doorHandle,
   * windowLatch, airOutlet: (x, z) on both side walls. toeBoard: the carpet running up the firewall from the
   * floor at station x0 to height z at x1.
   */
  fittings?: {
    defrosters?: readonly FRD[];
    fuelSelector?: { x: number; y: number; shutoffX?: number };
    visors?: { x: number; z: number; ys: readonly number[] };
    vents?: readonly FRD[];
    overhead?: { z: number };
    doorHandle?: readonly [number, number];
    windowLatch?: readonly [number, number];
    airOutlet?: readonly [number, number];
    toeBoard?: { x0: number; x1: number; z: number };
  };
  lamps: { flood: { pos: FRD; aim: FRD }; dome?: { pos: FRD } };
  /** Box model for the cabin occlusion bake and the radiosity budget. */
  box: { floor: number; roof: number; side: number; rear: number; panelX: number; glareshieldZ: number; sillZ: number;
         windscreenX: number; roofGlazed: boolean };
  glazingPanels: readonly { n: FRD; area: number }[]; interiorArea: number;
  /** Positions of controls the instructor points at that have no 3D part, by PointTarget id. */
  controlPoints: Readonly<Record<string, FRD>>;
}

export interface LiveryDef {
  registration: string;
  palette: { base: FRD; band: FRD; accent: FRD };
  /** The thin accent line runs just below the band instead of above it. Absent: above. */
  accentBelow?: boolean;
  stripe: { xs: readonly number[]; centre: readonly number[]; half: readonly number[]; noseShearX: number };
  lettering: { x0: number; x1: number; z0: number; z1: number };
  /** 'metal': rivets, skin laps, camlocs. 'composite': none. */
  construction: 'metal' | 'composite';
  skinJoints: readonly number[]; cowlSplitZ?: number; soot?: { x: number; y: number };
  /**
   * Details of a nose cowling, each absent = none. splitEndX / camlocEndX: how far forward of the firewall the
   * split line (cowlSplitZ) and its fasteners run (absent: 0.045 and 0.105 behind the loft's frontX). grille:
   * the induction-air grille under the spinner, forward of x, between z0 and z1, halfWidth either side.
   * oilDoor: the filler door in the cowl top, centred at station x.
   */
  cowl?: { splitEndX?: number; camlocEndX?: number;
           grille?: { x: number; z0: number; z1: number; halfWidth: number };
           oilDoor?: { x: number; halfLength: number; halfWidth: number } };
  /** A rivet row along the cabin floor line at height z, from the firewall aft to station x1 ('metal' only). Absent: none. */
  floorRivets?: { z: number; x1: number };
  fin: { bandZ0: number; bandX0: number; slope: number; cap: number };
  /** Fuselage texture size, px (4096 x 2048 today; 2048 x 1024 allowed for the two-seaters). */
  texture: { w: number; h: number };
}

export interface AirframeVisualDef {
  id: string;
  fuselage: LoftDef & { nose: 'prop' | 'closed'; inlets: readonly InletDef[]; exhaust?: { pos: FRD; radius: number };
                        antennas: readonly { kind: 'blade' | 'stub' | 'whip'; pos: FRD;
                                             /** Length of the antenna from its base at `pos`, m. Absent: 0.2 (blade), 0.09 (stub). */
                                             height?: number }[] };
  glazing: GlazingDef;
  wing: WingVisualDef;
  tail: TailVisualDef;
  /** nose, left, right: the order of AircraftState.wheels. */
  gear: readonly [WheelVisualDef, WheelVisualDef, WheelVisualDef];
  /** One per engine, same order as AircraftState.propellers. A state with fewer propellers than `props` (a visual shown over a placeholder definition) draws the extra ones stopped. */
  props: readonly PropVisualDef[];
  nacelles: readonly NacelleVisualDef[];
  /** Data-only escape hatch for junction shapes the builders do not derive. Default none. */
  fairings?: readonly FairingDef[];
  lamps: readonly LampVisualDef[];
  cockpit: CockpitDef;
  livery: LiveryDef;
  /**
   * Ground contact-shadow shape, metres, about the reference point. halfX / halfY: half extents of the shadow
   * quad along and across the aircraft. fuselage: [centre x, half length, half width] of the body's blob.
   * wingX: centre x of the wing band; wingY: half span of its core; wingHeight: height of the wing above the
   * ground at rest, which sets how soft the band is. restHeight: height of the reference point above the
   * ground when the aircraft stands on its wheels (absent: 1.25, the Cessna 172S).
   */
  shadow: { halfX: number; halfY: number; fuselage: readonly [number, number, number]; wingX: number; wingY: number; wingHeight: number;
            restHeight?: number };
}
