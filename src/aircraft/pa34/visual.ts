// Piper PA-34-200 Seneca I: the airframe as data for the 3D model, the cameras and the livery worker. PLAIN and
// structured-cloneable: no three.js, no functions, no class instances (the worker imports this file through
// aircraft/visualLoader.ts and nothing else of the aircraft).
//
// What the flight model and the picture must agree on (planforms, wheel contact points, the propeller discs, the
// eye point) comes from ./geometry; the panel's pixel layout from ./panel. Everything else is shaped here from the
// type's engineering data sheet (aircraft-data/pa34.md in the design work folder; "s.N" is its section N, s.12
// the appearance): the fuselage station table, the glazing and door outlines, the nacelles, the paint, the cabin.
// Positions are FRD metres from the reference point. A station "xs" of s.12 (metres aft of the nose tip) is
// x = 3.09 - xs (geometry.ts: the nose tip at FS -27.5); a height above the ground h is z = 1.10 - h (the
// geometry's restHeight), so s.12's fuselage reference line (1.31 m above the ground) is z = -0.21. Colours: the
// livery palette is sRGB 0..255, the propeller paint sRGB 0..1.
//
// The type against the C172S: a seven-seat low-wing twin grown from the Cherokee Six. A long, pointed baggage
// nose drooping below the cabin line; a boxy cabin with flat sides, a raked two-piece windscreen and three windows
// a side (the 1972-73 airframe: the fourth, small aft window came with the 1974 model, s.12), the front door on
// the right and the rear door on the left; the tail cone tapering from both sides under a swept fin with a short
// fillet and the low rectangular stabilator; the constant-chord "Hershey bar" wing with its inboard glove and 7
// degrees of dihedral; two big boxy nacelles hung forward of the leading edge with their tail fairings on the wing
// top, cowl flaps underneath and counter-rotating two-blade feathering Hartzells; the oleo mains folding inboard
// into the wing root and the nose leg forward into the nose, the landing light on the nose leg. Inside: a flat
// full-width panel, two control wheels, the six-lever quadrant at the lower centre, the flap lever and the trims
// on the floor tunnel between the front seats, six individual seats.

import { makeFinPlanform, makeRudderPlanform, makeWingPlanform, sectionPoint, surfacePoint } from '../../render/aircraft/planformMath';
import type {
  AirframeVisualDef,
  CockpitDef,
  FRD,
  GlazingDef,
  LampVisualDef,
  LiveryDef,
  LoftDef,
  NacelleVisualDef,
  PropVisualDef,
  SectionShape,
  TailVisualDef,
  WheelVisualDef,
  WingVisualDef,
} from '../types';
import { PA34_GEOMETRY, pa34StationX } from './geometry';
import { PA34_PANEL_CENTRE_PX, PA34_PANEL_PARTS, PA34_PANEL_PX_PER_M, PA34_PANEL_PX_RECT } from './panel';

const W = PA34_GEOMETRY.wing;
const H = PA34_GEOMETRY.hTail;
const V = PA34_GEOMETRY.vTail;
const G = PA34_GEOMETRY.gear;
const PROPS = PA34_GEOMETRY.propellers;
const EYE = PA34_GEOMETRY.fuselage.pilotEye;
const DEG = Math.PI / 180;

/** NACA 65(2)-415 (s.2.1) as a NACA 4-digit stand-in: 15 % thick, 2 % camber near mid chord. */
const NACA65_415: SectionShape = { m: 0.022, p: 0.5, t: 0.15 };
/** NACA 0012 stabilator (s.2.2, assumed) and a slightly thinner fin. */
const NACA0012: SectionShape = { m: 0, p: 0.4, t: 0.12 };

/** Body x of a station of s.12, metres aft of the nose tip. */
const xs = (aftOfNose: number): number => PA34_GEOMETRY.fuselage.noseX - aftOfNose;

// --- Wing: constant chord with the inboard glove, low, 7 degrees of dihedral, squared tips -------------------------

const TIP_Y = W.span / 2;

const WING: WingVisualDef = {
  mount: 'low',
  section: NACA65_415,
  // The glove from the centre line to the inboard face of the nacelle, then the constant 63 in chord (geometry).
  breaks: W.breaks!,
  rootY: W.rootY,
  qcZ: W.quarterChord.z,
  dihedral: W.dihedral,
  rootIncidence: W.rootIncidence,
  tipIncidence: W.tipIncidence,
  // The wing ends just under the fuselage skin.
  root: 'conform',
  // One slotted flap from the fuselage side to the aileron, behind the nacelle (s.2.1); the Frise aileron; the
  // outer 0.63 m has no surface.
  bays: [
    { kind: 'flap', from: W.flap.innerY, to: W.flap.outerY, chordFraction: W.flap.chordFraction },
    { kind: 'aileron', from: W.aileron.innerY, to: W.aileron.outerY, chordFraction: W.aileron.chordFraction },
    { kind: 'fixed', from: W.aileron.outerY, to: TIP_Y },
  ],
  // Single-slotted: it runs a little aft and down on its hinge brackets as it goes down.
  flap: { maxDeflection: W.flap.maxDeflection, travelAft: 0.05, travelDown: 0.02 },
  // Squared tips with a small rounded glass-fibre cap carrying the navigation light (s.2.1, s.12).
  tip: { round: 0.09, chordRound: 0.06 },
  // One filler on the outboard tank a side, on the top outboard of the nacelle (s.6, s.12); the pitot mast under
  // the left wing (s.9).
  fuelCaps: [{ y: 3.3, xc: 0.14, side: 'both' }],
  pitot: { side: -1, y: 3.0, xc: 0.18 },
  // The wing walk on the right wing root, where the front door is (s.12); the lift-detector vane on the left
  // leading edge outboard of the nacelle (s.9: there are two, the flaps choosing which is live; the visual has one).
  walkways: [{ y0: W.rootY + 0.03, y1: 1.3, xc0: 0.22, xc1: 0.72, side: 'right' }],
  liftDetector: { side: -1, y: 2.65 },
};

// --- Tail: swept fin and rudder, low all-moving stabilator with its anti-servo tab (s.2.2, s.2.3) ------------------

/** Height of the fin from its base to its tip quarter-chord point (the fin planform's span parameter), m. */
const FIN_HEIGHT = V.base.z - V.tip.z;

const TAIL: TailVisualDef = {
  section: NACA0012,
  h: {
    span: H.span,
    rootChord: H.rootChord,
    tipChord: H.tipChord,
    quarterChord: { x: H.quarterChord.x, z: H.quarterChord.z },
    incidence: H.incidence,
    kind: 'stabilator',
    chordFraction: 1,
    // Pivot at about 26-30 % chord (s.2.2).
    pivotFraction: 0.28,
    innerCutY: 0,
    // The anti-servo tab across the middle 74 % of the trailing edge, 20 % chord, moving with the stabilator about
    // 1.5 times as far (s.2.2); it is also the trim tab.
    tab: { y0: 0.12, y1: 1.52, xc: 0.8, sides: 'both', gearing: 1.5 },
  },
  v: {
    base: { x: V.base.x, z: V.base.z },
    tip: { x: V.tip.x, z: V.tip.z },
    rootChord: V.rootChord,
    tipChord: V.tipChord,
    rudderChordFraction: V.rudder.chordFraction,
    // The trim tab low on the rudder's trailing edge (s.2.3, s.12).
    rudderTab: { h0: 0.12, h1: 0.55, xc: 0.86 },
  },
  tTail: false,
  // A short concave fillet ahead of the fin from about xs 6.5 (s.12: no long dorsal fin).
  dorsalFillet: { x0: xs(6.5), height: 0.16 },
  // The V-shaped VOR antenna on the fin (s.12).
  vorAntenna: true,
};

// --- Fuselage: the station table of s.12 ---------------------------------------------------------------------------

/** Nose tip (FS -27.5) and the tail cone's end (about FS 311); the rudder overhangs it to FS 316. */
const NOSE_X = PA34_GEOMETRY.fuselage.noseX;
const END_X = pa34StationX(311);
/** Forward cabin bulkhead FS 49.5, windscreen base FS 53.6, aft cabin bulkhead FS 187.84 (s.2.4). */
const BULKHEAD_X = pa34StationX(49.5);
const SCREEN_BASE_X = pa34StationX(53.6);
const CABIN_REAR_X = pa34StationX(187.84);
/** Cabin roof 1.93 m and cabin bottom about 0.69 m above the ground (s.12); the reference line 1.31 m. */
const ROOF_Z = PA34_GEOMETRY.restHeight - 1.93;
const BELLY_Z = PA34_GEOMETRY.restHeight - 0.69;
const REF_LINE_Z = PA34_GEOMETRY.restHeight - 1.31;
/**
 * The windscreen's lower edge on the centre line, just over the nose's top line. Set from the eye (the
 * geometry's estimate), not from s.12's 1.02 m section height: the pilot must look over the glareshield to the
 * nose, as in the aeroplane.
 */
const SCREEN_SILL_Z = EYE.z + 0.09;
/** The windscreen's top edge (the roof's front edge) on the centre line, about FS 83 (s.12). */
const SCREEN_TOP_X = pa34StationX(80);
/** Window sill and window top along the cabin sides. */
const SILL_Z = -0.33;
const WINDOW_TOP_Z = ROOF_Z + 0.13;

type Key = [x: number, zTop: number, zBot: number, zMid: number, hw: number, nTop: number, nBot: number, ridge: number];

function fuselageKeys(): Key[] {
  // The nose: a blunt rounded point below the reference line (s.12 rows 1-4), the top line rising in a gentle
  // convex curve to the windscreen's base, the sides widening to the cabin's.
  const nose: Key[] = [
    [NOSE_X, -0.02, 0.04, 0.01, 0.02, 2, 2, 0],
    [NOSE_X - 0.06, -0.1, 0.13, 0.01, 0.12, 2, 2, 0],
    [xs(0.2), -0.18, 0.2, 0.01, 0.2, 2.1, 2.1, 0],
    [xs(0.4), -0.24, 0.25, 0.0, 0.275, 2.2, 2.2, 0],
    [xs(0.7), -0.31, 0.31, -0.02, 0.38, 2.4, 2.4, 0],
    [xs(1.0), -0.35, 0.36, -0.04, 0.47, 2.6, 2.6, 0],
    [xs(1.5), -0.39, 0.39, -0.07, 0.54, 2.8, 2.9, 0],
    [BULKHEAD_X, -0.415, 0.405, -0.09, 0.585, 3.0, 3.2, 0],
    [SCREEN_BASE_X, SCREEN_SILL_Z + 0.01, BELLY_Z, -0.1, 0.61, 3.0, 3.4, 0],
  ];
  // The cabin: the raked windscreen rising to the roof's front edge, flat sides, a gently curved roof and a flat
  // belly (s.12 rows 5-8), narrowing aft of the rear seats.
  const cabin: Key[] = [
    [0.78, -0.6, BELLY_Z, -0.14, 0.625, 2.9, 3.6, 0],
    [0.55, -0.73, BELLY_Z, -0.18, 0.632, 2.9, 3.8, 0],
    [SCREEN_TOP_X, ROOF_Z + 0.01, BELLY_Z, REF_LINE_Z, 0.635, 3.0, 4.0, 0],
    [0.0, ROOF_Z, BELLY_Z, REF_LINE_Z, 0.635, 3.0, 4.0, 0],
    [xs(3.7), ROOF_Z, BELLY_Z, REF_LINE_Z, 0.635, 3.0, 4.0, 0],
    [xs(4.65), ROOF_Z + 0.04, BELLY_Z - 0.02, REF_LINE_Z, 0.575, 2.9, 3.6, 0],
  ];
  // The tail cone: the belly sweeps up from the aft cabin bulkhead, the top line runs gently down to the fin, and
  // its centre line stays slightly below the cabin's (s.12 rows 9-12).
  const tail: Key[] = [
    [CABIN_REAR_X, ROOF_Z + 0.115, 0.36, REF_LINE_Z + 0.03, 0.475, 2.8, 3.0, 0],
    [xs(6.0), -0.6, 0.3, -0.13, 0.36, 2.5, 2.6, 0],
    [xs(6.5), -0.53, 0.28, -0.11, 0.28, 2.3, 2.4, 0],
    [xs(7.2), -0.44, 0.21, -0.11, 0.19, 2.2, 2.2, 0],
    [xs(7.94), -0.36, 0.14, -0.11, 0.125, 2.1, 2.1, 0],
    [xs(8.3), -0.3, 0.07, -0.12, 0.08, 2, 2, 0],
    [END_X, -0.25, 0.0, -0.13, 0.035, 2, 2, 0],
  ];
  return [...nose, ...cabin, ...tail];
}

const FUSELAGE_KEYS = fuselageKeys();

/** Height of the belly at station x (the fuselage keys' bottom line). */
function bellyZ(x: number): number {
  for (let i = 1; i < FUSELAGE_KEYS.length; i++) {
    const [x0, , b0] = FUSELAGE_KEYS[i - 1];
    const [x1, , b1] = FUSELAGE_KEYS[i];
    if (x <= x0 && x >= x1) return b0 + ((x - x0) / (x1 - x0)) * (b1 - b0);
  }
  return BELLY_Z;
}

const FUSELAGE: AirframeVisualDef['fuselage'] = {
  keys: FUSELAGE_KEYS,
  frontX: NOSE_X,
  endX: END_X,
  grid: { rows: 170, cols: 104 },
  // No engine in the nose: a closed baggage nose.
  nose: 'closed',
  inlets: [],
  antennas: [
    // Two bent-whip VHF com antennas on the cabin roof, the transponder and the marker antennas under the belly (s.12):
    // a blade stands up from its base, so the belly ones are stubs, hanging down.
    { kind: 'whip', pos: [-0.35, 0, ROOF_Z], height: 0.55 },
    { kind: 'whip', pos: [-1.35, 0, ROOF_Z + 0.01], height: 0.55 },
    { kind: 'stub', pos: [-0.9, 0, BELLY_Z + 0.002], height: 0.09 },
    { kind: 'stub', pos: [-1.9, 0, bellyZ(-1.9) + 0.002], height: 0.12 },
  ],
};

// --- Glazing and door lines (side projection: x, z) ---------------------------------------------------------------

/** The windscreen's lower corners at the cabin sides, and the A-post from there up to the roof's front edge. */
const SCREEN_CORNER: readonly [number, number] = [0.8, SILL_Z - 0.02];
const SCREEN_SILL_N = ((): readonly [number, number] => {
  const dx = SCREEN_BASE_X - SCREEN_CORNER[0];
  const dz = SCREEN_CORNER[1] - SCREEN_SILL_Z;
  const l = Math.hypot(dx, dz);
  return [dz / l, dx / l];
})();
/** The A-post's upper end at the roof's front edge; the front side window's leading edge runs along the post. */
const SCREEN_POST_TOP: readonly [number, number] = [SCREEN_TOP_X + 0.02, ROOF_Z + 0.04];
/** Station of the A-post at height z (side projection). */
const postX = (z: number): number => SCREEN_CORNER[0] + ((z - SCREEN_CORNER[1]) / (SCREEN_POST_TOP[1] - SCREEN_CORNER[1])) * (SCREEN_POST_TOP[0] - SCREEN_CORNER[0]);
/** The B-post between the front window and the first cabin window, at the front door's rear edge. */
const DOOR_REAR_X = xs(3.55);

const GLAZING: GlazingDef = {
  cabinFrontX: SCREEN_BASE_X + 0.02,
  cabinRearX: CABIN_REAR_X,
  // The forward cabin bulkhead: there is no engine in the nose.
  firewallX: BULKHEAD_X,
  tRange: [0.2, 0.8],
  windows: [
    // Front side window, its front edge along the A-post (the pilot's window on the left, the door's on the right),
    // a little closer to the post at the top, where the post wraps round the cabin's shoulder, so that the post
    // reads from the seat as a band of nearly even width.
    { pts: [[postX(SILL_Z) - 0.045, SILL_Z], [postX(WINDOW_TOP_Z) - 0.02, WINDOW_TOP_Z], [DOOR_REAR_X + 0.06, WINDOW_TOP_Z], [DOOR_REAR_X + 0.06, SILL_Z]], r: 0.05, sides: 'both' },
    // Two large rounded-rectangle cabin windows (s.12), the second a little lower at the top where the roof falls.
    { pts: [[DOOR_REAR_X - 0.05, SILL_Z], [DOOR_REAR_X - 0.05, WINDOW_TOP_Z], [-1.05, WINDOW_TOP_Z], [-1.05, SILL_Z]], r: 0.07, sides: 'both' },
    { pts: [[-1.15, SILL_Z], [-1.15, WINDOW_TOP_Z], [-1.76, WINDOW_TOP_Z + 0.03], [-1.76, SILL_Z - 0.01]], r: 0.07, sides: 'both' },
  ],
  // The two-piece windscreen raked about 30 degrees (s.12), from its base over the nose up to the roof's front
  // edge; the A-posts close it at the sides.
  windscreen: {
    sillC: [SCREEN_BASE_X, SCREEN_SILL_Z],
    sillN: SCREEN_SILL_N,
    post: [SCREEN_CORNER, SCREEN_POST_TOP],
    postY: 0.46,
    topX: SCREEN_TOP_X,
  },
  doors: [
    // Front cabin door, right side, over the wing (s.2.4, s.12): its front edge along the A-post, down to the wing
    // walk; the handle at its aft edge.
    {
      pts: [
        [0.62, 0.24],
        [SCREEN_CORNER[0] - 0.04, SILL_Z + 0.03],
        [0.3, ROOF_Z + 0.04],
        [DOOR_REAR_X, ROOF_Z + 0.04],
        [DOOR_REAR_X, 0.24],
      ],
      r: 0.05,
      sides: 'right',
      handle: { x: DOOR_REAR_X + 0.07, z: -0.22 },
    },
    // Rear cabin door, left side, aft of the wing (FS 138.63 to FS 165.72, s.2.4).
    {
      pts: [
        [pa34StationX(138.63), 0.34],
        [pa34StationX(138.63), ROOF_Z + 0.05],
        [pa34StationX(165.72), ROOF_Z + 0.06],
        [pa34StationX(165.72), 0.33],
      ],
      r: 0.05,
      sides: 'left',
      handle: { x: pa34StationX(138.63) - 0.07, z: -0.22 },
    },
    // Nose baggage door, left side (0.61 x 0.53 m, s.2.4).
    {
      pts: [
        [xs(0.9), 0.2],
        [xs(0.9), -0.3],
        [xs(1.51), -0.38],
        [xs(1.51), 0.24],
      ],
      r: 0.04,
      sides: 'left',
      handle: { x: xs(1.45), z: -0.06 },
    },
  ],
  // A fabric headliner under the roof.
  liningRoofLimit: ROOF_Z + 0.09,
  headliner: { x0: SCREEN_TOP_X - 0.02, x1: CABIN_REAR_X + 0.05, z0: ROOF_Z + 0.12, z1: ROOF_Z + 0.08, pitch: 0.3 },
  xRange: [SCREEN_BASE_X + 0.02, CABIN_REAR_X - 0.01],
};

// --- Nacelles: the cowled IO-360s forward of the wing, tail fairings on the wing top (s.12) ------------------------

/** The right propeller's hub (the nacelle's axis); the left nacelle is its mirror image. */
const HUB = PROPS[1].hub;
/** Spinner tip at FS 14 (s.12), backplate on the cowl face just ahead of the propeller plane. */
const SPINNER_TIP_X = pa34StationX(14);
const COWL_FRONT_X = HUB.x - 0.05;
/** The nacelle's tail fairing ends on the wing top at about 57 % chord (s.12): the constant chord's LE is at x 0.4. */
const NACELLE_END_X = 0.4 - 0.57 * 1.6;

/**
 * Written for the right side, z about the nacelle's own axis (the thrust line). The cowl is about 0.97 m wide and
 * 0.70 m deep, boxy with rounded corners, the thrust line about 40 % of the depth down from its top (s.12).
 */
const NACELLE_LOFT: LoftDef = {
  keys: [
    [COWL_FRONT_X, -0.17, 0.17, 0.0, 0.175, 2, 2, 0],
    [COWL_FRONT_X - 0.012, -0.235, 0.29, 0.02, 0.33, 2.6, 2.6, 0],
    [COWL_FRONT_X - 0.07, -0.27, 0.37, 0.04, 0.44, 3.6, 3.4, 0],
    [1.35, -0.29, 0.41, 0.05, 0.48, 3.8, 3.6, 0],
    [0.95, -0.3, 0.42, 0.06, 0.485, 3.8, 3.6, 0],
    [0.55, -0.29, 0.4, 0.06, 0.46, 3.6, 3.4, 0],
    // Aft of the cowl's rear edge the top line falls steadily onto the wing's upper skin (0.15-0.16 below the axis
    // over the rear half of the chord) and the sides close in over the same distance.
    [0.2, -0.18, 0.37, 0.09, 0.36, 3.0, 3.0, 0],
    [-0.15, -0.02, 0.34, 0.14, 0.22, 2.5, 2.5, 0],
    [NACELLE_END_X, 0.15, 0.24, 0.19, 0.05, 2, 2, 0],
  ],
  frontX: COWL_FRONT_X,
  endX: NACELLE_END_X,
  offset: { y: HUB.y, z: HUB.z },
  grid: { rows: 56, cols: 40 },
};

/** Station of the cowl flap hinge on the nacelle's flat underside, and the depth of the underside below the axis. */
const COWL_FLAP_HINGE_X = 0.62;
const NACELLE_BOTTOM = 0.405;

const nacelle = (side: 1 | -1): NacelleVisualDef => ({
  loft: NACELLE_LOFT,
  side,
  inlets: [
    // The two rounded-rectangle cooling inlets either side of the spinner (s.12), clear of its backplate; the
    // induction scoop on the outboard lower cowl.
    { y: -0.29, z: -0.04, w: 0.22, h: 0.1, r: 0.04 },
    { y: 0.29, z: -0.04, w: 0.22, h: 0.1, r: 0.04 },
    { y: 0.24, z: 0.27, w: 0.12, h: 0.06, r: 0.025 },
  ],
  // The exhaust stack under the cowl, outboard of the cowl flap (s.12).
  exhaust: { pos: [0.5, HUB.y + 0.2, HUB.z + 0.38], radius: 0.03 },
  // One cowl flap across the underside aft of the engine, trailing edge down to open (s.4: three positions).
  cowlFlaps: [
    {
      hinge: [COWL_FLAP_HINGE_X, HUB.y, HUB.z + NACELLE_BOTTOM],
      axis: [0, 1, 0],
      maxAngle: 0.4,
      pts: [
        [COWL_FLAP_HINGE_X, HUB.y - 0.17, HUB.z + NACELLE_BOTTOM],
        [COWL_FLAP_HINGE_X, HUB.y + 0.17, HUB.z + NACELLE_BOTTOM],
        [COWL_FLAP_HINGE_X - 0.2, HUB.y + 0.15, HUB.z + NACELLE_BOTTOM - 0.01],
        [COWL_FLAP_HINGE_X - 0.2, HUB.y - 0.15, HUB.z + NACELLE_BOTTOM - 0.01],
      ],
    },
  ],
});

// --- Landing gear: oleo legs, the mains folding inboard into the wing root, the nose leg forward (s.3, s.12) --------

/** 6.00-6 tyres on 6-inch rims, about 0.16 m wide (s.3). */
const RIM_RADIUS = 0.0762;
const TYRE_WIDTH = 0.16;

/** A point on the lower skin of the wing, right side; side -1 mirrors. */
const WING_PLANFORM = makeWingPlanform(WING);
function wingLower(y: number, xc: number, below = 0): FRD {
  const [px, py] = surfacePoint(NACA65_415, xc, -1);
  const p = sectionPoint(WING_PLANFORM, Math.abs(y), px, py);
  return [p.x, Math.sign(y) * p.y, p.z + below];
}
/** Chord fraction of the constant-chord wing at body station x (leading edge at x 0.4). */
const xcAt = (x: number): number => (0.4 - x) / 1.6;

/** Leg pivot inside the wing over the axle, and how far inboard the leg folds. */
const MAIN_PIVOT_Z = 0.27;
const MAIN_FOLD_DEG = 87;

const mainWheel = (contact: { x: number; y: number; z: number }, side: 1 | -1): WheelVisualDef => {
  const legLength = contact.z - G.mainWheelRadius - MAIN_PIVOT_Z;
  // The well: from just outboard of the leg to where the folded wheel lies, inboard; under the wing's skin at the
  // leg's station. The wheel stays partly exposed (s.12): the wing is thinner than the tyre is wide.
  const inner = contact.y - side * (legLength + 0.3);
  const outer = contact.y + side * 0.12;
  const wellAt = (y: number, x: number): FRD => {
    const p = wingLower(y, xcAt(x), 0.004);
    return [x, p[1], p[2]];
  };
  const fore = contact.x + 0.25;
  const aft = contact.x - 0.25;
  return {
    contact: [contact.x, contact.y, contact.z],
    radius: G.mainWheelRadius,
    width: TYRE_WIDTH,
    rimRadius: RIM_RADIUS,
    // Straight air-oil oleo with scissor links (s.3, s.12).
    leg: { kind: 'oleo', top: [contact.x, contact.y, MAIN_PIVOT_Z], cylinderLen: 0.42, crownAt: 0.62, forkHalf: 0.1, scissors: true, steers: false },
    retract: {
      pivot: [contact.x, contact.y, MAIN_PIVOT_Z],
      axis: [1, 0, 0],
      angle: side * MAIN_FOLD_DEG * DEG,
      // A small door on the leg's outboard side closes the leg's slot when it is up (s.12: leg-mounted doors).
      doors: [
        {
          hinge: [contact.x, outer, wellAt(outer, contact.x)[2]],
          axis: [1, 0, 0],
          angle: -side * 80 * DEG,
          pts: [wellAt(outer, fore - 0.08), wellAt(contact.y - side * 0.1, fore - 0.08), wellAt(contact.y - side * 0.1, aft + 0.08), wellAt(outer, aft + 0.08)],
        },
      ],
      well: [wellAt(outer, fore), wellAt(inner, fore), wellAt(inner, aft), wellAt(outer, aft)],
    },
  };
};

/** Nose leg pivot under the baggage bay, and the belly there (the nose wheel well and its two narrow doors). */
const NOSE_PIVOT: FRD = [G.nose.x + 0.08, 0, 0.3];
const NOSE_WELL = { fore: xs(0.75), aft: G.nose.x - 0.12, halfWidth: 0.12 };
const NOSE_WHEEL: WheelVisualDef = {
  contact: [G.nose.x, G.nose.y, G.nose.z],
  radius: G.noseWheelRadius,
  width: TYRE_WIDTH,
  rimRadius: RIM_RADIUS,
  // A single wheel on a fork under an oleo, steered by the pedals (s.3).
  leg: { kind: 'oleo', top: NOSE_PIVOT, cylinderLen: 0.34, crownAt: 0.52, forkHalf: 0.1, scissors: true, steers: true },
  retract: {
    // Folds forward into the nose about the lateral axis (s.3); two narrow doors hinged along the belly either side.
    pivot: NOSE_PIVOT,
    axis: [0, 1, 0],
    angle: 100 * DEG,
    doors: ([-1, 1] as const).map((side) => ({
      hinge: [(NOSE_WELL.fore + NOSE_WELL.aft) / 2, side * NOSE_WELL.halfWidth, bellyZ((NOSE_WELL.fore + NOSE_WELL.aft) / 2)] as FRD,
      axis: [NOSE_WELL.fore - NOSE_WELL.aft, 0, bellyZ(NOSE_WELL.fore) - bellyZ(NOSE_WELL.aft)] as FRD,
      angle: -side * 85 * DEG,
      pts: [
        [NOSE_WELL.fore, side * NOSE_WELL.halfWidth, bellyZ(NOSE_WELL.fore) + 0.003],
        [NOSE_WELL.fore, 0, bellyZ(NOSE_WELL.fore) + 0.003],
        [NOSE_WELL.aft, 0, bellyZ(NOSE_WELL.aft) + 0.003],
        [NOSE_WELL.aft, side * NOSE_WELL.halfWidth, bellyZ(NOSE_WELL.aft) + 0.003],
      ] as FRD[],
    })),
    well: [
      [NOSE_WELL.fore, -NOSE_WELL.halfWidth, bellyZ(NOSE_WELL.fore) + 0.002],
      [NOSE_WELL.fore, NOSE_WELL.halfWidth, bellyZ(NOSE_WELL.fore) + 0.002],
      [NOSE_WELL.aft, NOSE_WELL.halfWidth, bellyZ(NOSE_WELL.aft) + 0.002],
      [NOSE_WELL.aft, -NOSE_WELL.halfWidth, bellyZ(NOSE_WELL.aft) + 0.002],
    ],
  },
};

const GEAR: AirframeVisualDef['gear'] = [NOSE_WHEEL, mainWheel(G.leftMain, -1), mainWheel(G.rightMain, 1)];

// --- Propellers: Hartzell two-blade constant-speed full-feathering, counter-rotating (s.5) --------------------------

/** Low pitch stop 13.5 degrees at the 30 in station (s.5). */
const LOW_PITCH = 13.5 * DEG;

/** Blade geometry handedness from the geometry's rotation (left clockwise, right counter-clockwise from the cockpit). */
const prop = (i: 0 | 1): PropVisualDef => {
  const p = PROPS[i];
  return {
    hub: [p.hub.x, p.hub.y, p.hub.z],
    diameter: p.diameter,
    blades: p.blades,
    rotation: p.rotation,
    referencePitch: LOW_PITCH,
    variablePitch: true,
    // Slender aluminium blades with rounded tips, about 0.15 m of chord at their widest.
    chord: [
      [0.12, 0.07],
      [0.25, 0.115],
      [0.45, 0.15],
      [0.65, 0.145],
      [0.85, 0.12],
      [0.95, 0.09],
      [1.0, 0.035],
    ],
    // A pointed spinner about 0.33 m across and 0.36 m long (s.12).
    spinner: { baseX: SPINNER_TIP_X - 0.36, radius: 0.165, length: 0.36 },
    // Grey faces, black backs (anti-glare, seen from the cabin), white tips.
    paint: { face: [0.5, 0.51, 0.52], back: [0.035, 0.035, 0.037], tip: [0.9, 0.9, 0.88], tipBand: 0.06 },
  };
};

// --- Root fillet ------------------------------------------------------------------------------------------------------

/** The fillet's axis, just outboard of the cabin side over the wing root. */
const FILLET_Y = 0.6;
/** Height of the wing's upper skin at the fillet's axis at body station x (inside the glove's chord there). */
function wingTopAtRoot(x: number): number {
  const le = sectionPoint(WING_PLANFORM, FILLET_Y, 0, 0).x;
  const te = sectionPoint(WING_PLANFORM, FILLET_Y, 1, 0).x;
  const [px, py] = surfacePoint(NACA65_415, Math.min(1, Math.max(0, (le - x) / (le - te))), 1);
  return sectionPoint(WING_PLANFORM, FILLET_Y, px, py).z;
}
/** Stations: x, its top above the wing skin, its half height, its half width (m). */
const ROOT_FILLET: readonly (readonly [number, number, number, number])[] = [
  [0.66, 0.0, 0.01, 0.01],
  [0.45, 0.03, 0.05, 0.07],
  [-0.2, 0.04, 0.07, 0.11],
  [-0.85, 0.03, 0.05, 0.07],
  [-1.15, 0.0, 0.01, 0.01],
];

// --- Exterior lamps --------------------------------------------------------------------------------------------------

const LAMPS: readonly LampVisualDef[] = ((): LampVisualDef[] => {
  const onWing = (y: number, xc: number, yc: number, side: 1 | -1): FRD => {
    const p = sectionPoint(WING_PLANFORM, y, xc, yc);
    return [p.x, p.y * side, p.z];
  };
  // Navigation light in each tip cap, the strobe just behind it (s.12).
  const tipY = TIP_Y - 0.03;
  // The white tail light at the foot of the rudder's trailing edge, swinging with it.
  const foot = sectionPoint(makeRudderPlanform(TAIL), 0.06, 1, 0);
  // The red beacon on top of the fin (s.12).
  const finTip = sectionPoint(makeFinPlanform(TAIL), FIN_HEIGHT - 0.01, 0.4, 0);
  // The landing light on the nose leg (s.9, s.12), aimed ahead; it folds away with the leg.
  const legLamp = (y: number): FRD => [G.nose.x + 0.12, y, 0.62];
  return [
    { id: 'navL', pos: onWing(tipY, 0.08, 0.0, -1), radius: 0.03, glowOffset: [0.035, -0.035, 0] },
    { id: 'navR', pos: onWing(tipY, 0.08, 0.0, 1), radius: 0.03, glowOffset: [0.035, 0.035, 0] },
    { id: 'navTail', pos: [foot.x - 0.015, foot.y, foot.z], radius: 0.022, glowOffset: [-0.03, 0, 0], parent: 'rudder' },
    { id: 'strobeL', pos: onWing(tipY + 0.01, 0.25, 0.0, -1), radius: 0.02, glowOffset: [0, -0.035, 0] },
    { id: 'strobeR', pos: onWing(tipY + 0.01, 0.25, 0.0, 1), radius: 0.02, glowOffset: [0, 0.035, 0] },
    { id: 'beacon', pos: [finTip.x, 0, finTip.z - 0.035], radius: 0.035, glowOffset: [0, 0, -0.045] },
    { id: 'landing', pos: legLamp(-0.05), radius: 0.045, glowOffset: [0.02, 0, 0], parent: 'noseGear', aim: { downDeg: 3, outDeg: 0, halfAngleDeg: 9 } },
    { id: 'taxi', pos: legLamp(0.05), radius: 0.04, glowOffset: [0.02, 0, 0], parent: 'noseGear', aim: { downDeg: 7, outDeg: 0, halfAngleDeg: 24 } },
  ];
})();

// --- Cockpit ---------------------------------------------------------------------------------------------------------

// The cockpit is fitted to the pilot's eye of the geometry: the panel top 0.15 m below it, the seat cushion 0.70 m
// below it. The fuselage, the windscreen and the cabin box are the airframe's and do not move with it.
/** Instrument panel face: vertical, facing aft, centred on the centre line (panel.ts), 0.64 m ahead of the eye. */
const PANEL_X = EYE.x + 0.64;
const PANEL_ZTOP = EYE.z + 0.15;
const PX = PA34_PANEL_PX_PER_M;
const PANEL_W = PA34_PANEL_PX_RECT.w / PX;
const PANEL_ZB = PANEL_ZTOP + PA34_PANEL_PX_RECT.h / PX;
/** A point of the panel canvas, px, on the face (FRD y, z). */
const faceY = (px: number): number => (px - PA34_PANEL_CENTRE_PX) / PX;
const faceZ = (py: number): number => PANEL_ZTOP + (py - PA34_PANEL_PX_RECT.y) / PX;
/** Cabin floor (top of the carpet) over the wing carry-through. */
const FLOOR_Z = 0.36;
/** Lateral station of the front seats, the control wheels and the pedals: the pilot's eye. */
const SEAT_Y = -EYE.y;
/** The throttle quadrant body (panel.ts PA34_QUADRANT), m on the face. */
const Q = PA34_PANEL_PARTS.quadrant;
const QUADRANT = { y0: faceY(Q.x0), y1: faceY(Q.x1), zTop: faceZ(Q.y0), aftX: PANEL_X - 0.1 };
/** Lever pivots in the slotted housing under the quadrant, aft of its face, so the knobs stay in view. */
const LEVER = { x: QUADRANT.aftX - 0.08, z: 0.07, pitch: 0.026 };
/** The floor tunnel between the front seats: flap lever, pitch and rudder trims, fuel selectors (s.9). */
const TUNNEL = { x0: PANEL_X - 0.12, x1: -0.5, hw: 0.075, top: FLOOR_Z - 0.12 };

/** The six quadrant levers, left to right: throttles, propellers, mixtures, each pair left engine first (s.9). */
const QUADRANT_LEVERS: CockpitDef['engineControls'] = (['throttle', 'propeller', 'mixture'] as const).flatMap((control, k) =>
  ([0, 1] as const).map((engine) => ({
    kind: 'lever' as const,
    control,
    engine,
    pos: [LEVER.x, (k * 2 + engine - 2.5) * LEVER.pitch, LEVER.z] as FRD,
    travel: 0.8,
    colour: control === 'throttle' ? ('black' as const) : control === 'propeller' ? ('blue' as const) : ('red' as const),
    length: 0.17,
  })),
);

const COCKPIT: CockpitDef = {
  pilotEye: [EYE.x, EYE.y, EYE.z],
  /** Default view: 8 degrees nose-down from level, over the glareshield to the long nose. */
  defaultPitchDeg: -8,
  enclosure: 'cabin',
  panel: { x: PANEL_X, zTop: PANEL_ZTOP, width: PANEL_W, pxRect: PA34_PANEL_PX_RECT },
  floor: { z: FLOOR_Z, x0: BULKHEAD_X - 0.01, x1: CABIN_REAR_X + 0.05 },
  // A shallow black glareshield (s.12): the panel-top lip and a deck rising a little forward to the windscreen's base.
  glareshield: {
    profile: [
      [PANEL_X - 0.03, PANEL_ZTOP - 0.0015],
      [PANEL_X - 0.039, PANEL_ZTOP - 0.01],
      [PANEL_X - 0.034, PANEL_ZTOP - 0.022],
      [PANEL_X, PANEL_ZTOP - 0.027],
      [SCREEN_BASE_X - 0.03, SCREEN_SILL_Z + 0.006],
      [SCREEN_BASE_X - 0.01, SCREEN_SILL_Z + 0.012],
      [SCREEN_BASE_X - 0.01, SCREEN_SILL_Z + 0.04],
      [PANEL_X + 0.03, PANEL_ZTOP + 0.0015],
      [PANEL_X, PANEL_ZTOP - 0.0015],
    ],
    halfWidth: 0.6,
  },
  // Six individual forward-facing seats: two front, two centre, two rear with an aisle (s.2.5, s.12). x is the
  // cushion's front edge, z its top.
  seats: [
    { x: EYE.x + 0.31, y: -SEAT_Y, kind: 'front', width: 0.46, depth: 0.46, z: EYE.z + 0.7, reclineDeg: 13 },
    { x: EYE.x + 0.31, y: SEAT_Y, kind: 'front', width: 0.46, depth: 0.46, z: EYE.z + 0.7, reclineDeg: 13 },
    { x: pa34StationX(118.1) + 0.3, y: -0.3, kind: 'front', width: 0.44, depth: 0.44, z: EYE.z + 0.72, reclineDeg: 15 },
    { x: pa34StationX(118.1) + 0.3, y: 0.3, kind: 'front', width: 0.44, depth: 0.44, z: EYE.z + 0.72, reclineDeg: 15 },
    { x: pa34StationX(155.7) + 0.3, y: -0.28, kind: 'front', width: 0.42, depth: 0.42, z: EYE.z + 0.72, reclineDeg: 16 },
    { x: pa34StationX(155.7) + 0.3, y: 0.28, kind: 'front', width: 0.42, depth: 0.42, z: EYE.z + 0.72, reclineDeg: 16 },
  ],
  consoles: [
    // Structure under the lower edge of the panel, toward the forward bulkhead (knee room under it).
    {
      min: [PANEL_X + 0.002, -0.6, PANEL_ZB - 0.005],
      max: [PANEL_X + 0.16, 0.6, PANEL_ZB + 0.12],
      bevel: 0.008,
      material: 'panelPlastic',
      profile: [
        [PANEL_X + 0.002, PANEL_ZB - 0.005],
        [PANEL_X + 0.002, PANEL_ZB + 0.04],
        [PANEL_X + 0.11, PANEL_ZB + 0.12],
        [PANEL_X + 0.16, PANEL_ZB + 0.12],
        [PANEL_X + 0.16, PANEL_ZB - 0.005],
      ],
    },
    // The panel's fascia carried out to the cabin walls either side of the 1.04 m face (inside the skin where the
    // cabin's sides start to curve in at the top).
    { min: [PANEL_X - 0.004, -0.57, PANEL_ZTOP], max: [PANEL_X + 0.03, -PANEL_W / 2, PANEL_ZB], bevel: 0.006, material: 'panelPlastic' },
    { min: [PANEL_X - 0.004, PANEL_W / 2, PANEL_ZTOP], max: [PANEL_X + 0.03, 0.57, PANEL_ZB], bevel: 0.006, material: 'panelPlastic' },
    // The quadrant at the lower centre of the panel, reachable from both seats (s.9): throttles, propellers and
    // mixtures left to right.
    { min: [QUADRANT.aftX, QUADRANT.y0, QUADRANT.zTop], max: [PANEL_X + 0.01, QUADRANT.y1, PANEL_ZB + 0.1], bevel: 0.012, material: 'black' },
    // Its lower part runs aft under the levers, which stand up out of slots in its top; the cowl flap levers below.
    { min: [LEVER.x - 0.03, QUADRANT.y0, LEVER.z - 0.005], max: [QUADRANT.aftX + 0.01, QUADRANT.y1, PANEL_ZB + 0.1], bevel: 0.012, material: 'black' },
    // The pedestal down to the floor, and the floor tunnel between the front seats (s.9, s.12).
    { min: [LEVER.x - 0.02, QUADRANT.y0 + 0.02, PANEL_ZB + 0.1], max: [PANEL_X - 0.02, QUADRANT.y1 - 0.02, FLOOR_Z], bevel: 0.012, material: 'trimPlastic' },
    { min: [TUNNEL.x1, -TUNNEL.hw, TUNNEL.top], max: [TUNNEL.x0, TUNNEL.hw, FLOOR_Z], bevel: 0.015, material: 'trimPlastic' },
    // The aft baggage area behind the rear seats (s.2.4), on a raised floor: the cabin's bottom rounds up toward the
    // tail cone there.
    { min: [CABIN_REAR_X + 0.1, -0.3, 0.12], max: [-1.85, 0.3, 0.28], bevel: 0.012, material: 'carpet' },
  ],
  // Both sides. The front side walls with an armrest and a map pocket under the front window, a kick panel ahead
  // of them, the walls by the centre and rear seats.
  trimPanels: [
    {
      side: 0, x0: SCREEN_CORNER[0] - 0.12, x1: DOOR_REAR_X + 0.02, z0: SILL_Z + 0.02, z1: FLOOR_Z - 0.04, relief: 0.011, material: 'trimPlastic',
      grid: { rows: 48, cols: 44 },
      edge: 0.025,
      armrest: { xa: -0.4, xb: 0.15, zc: -0.08, hz: 0.04, height: 0.05, taper: 0.08 },
      pocket: { x0: 0.25, x1: -0.3, zTop: 0.12, depth: 0.12, lip: 0.022 },
    },
    { side: 0, x0: BULKHEAD_X - 0.005, x1: SCREEN_CORNER[0] - 0.12, z0: -0.2, z1: FLOOR_Z + 0.02, relief: 0.008, material: 'panelPlastic', grid: { rows: 28, cols: 36 }, edge: 0.015, openBelow: true },
    { side: 0, x0: DOOR_REAR_X - 0.02, x1: CABIN_REAR_X + 0.06, z0: SILL_Z + 0.02, z1: FLOOR_Z - 0.04, relief: 0.009, material: 'seatFabric', grid: { rows: 60, cols: 30 }, edge: 0.02 },
  ],
  // Occupied in external views: the pilot.
  occupants: [{ seat: 0 }],
  // Two control wheels on shafts through the panel (s.12): neutral end position, fore-aft travel, rotation.
  column: { kind: 'yoke', x: PANEL_X - 0.2, y: SEAT_Y, z: faceZ(PA34_PANEL_PARTS.yokes.y), travel: 0.08, rollDeg: 45 },
  pedals: { x: PANEL_X + 0.24, ys: [-SEAT_Y, SEAT_Y] },
  engineControls: [
    ...QUADRANT_LEVERS,
    // The two cowl flap levers below the quadrant (s.4, s.9): push to open.
    { kind: 'lever', control: 'cowlFlaps', engine: 0, pos: [QUADRANT.aftX - 0.01, -0.035, PANEL_ZB + 0.075], travel: 0.6, colour: 'white', length: 0.06 },
    { kind: 'lever', control: 'cowlFlaps', engine: 1, pos: [QUADRANT.aftX - 0.01, 0.035, PANEL_ZB + 0.075], travel: 0.6, colour: 'white', length: 0.06 },
  ],
  // The hand flap lever on the tunnel between the front seats, 0 / 10 / 25 / 40 degrees (s.2.1, s.9).
  flapControl: { kind: 'floorLever', pos: [-0.12, 0, TUNNEL.top], travel: 0.75 },
  // The gear selector left of the quadrant (panel.ts draws its slot and lights there).
  gearLever: { pos: [PANEL_X, faceY(PA34_PANEL_PARTS.gearLever[0]), faceZ(PA34_PANEL_PARTS.gearLever[1])] },
  // The pitch trim wheel on the tunnel ahead of the flap lever (s.9).
  trimWheel: { pos: [0.12, 0, TUNNEL.top - 0.01], axis: 'y' },
  // The parking brake: the hand lever under the left-centre panel, pulled to set (s.3).
  parkingBrakeHandle: { pos: [PANEL_X + 0.005, faceY(780), PANEL_ZB + 0.06], travel: 0.05 },
  // The magnetic compass on the windscreen's centre strip, its bracket 1 cm under the glass (the cabin keys' top
  // line: z -0.73 at x 0.55), about 16 degrees above the pilot's eye line and in view over the glareshield.
  compass: { pos: [0.5, 0, -0.595] },
  fittings: {
    // Defroster outlets on the glareshield deck at the windscreen's base.
    defrosters: [
      [SCREEN_BASE_X - 0.06, -0.3, SCREEN_SILL_Z + 0.003],
      [SCREEN_BASE_X - 0.06, 0.3, SCREEN_SILL_Z + 0.003],
    ],
    // Fresh-air outlets in the headliner over the front seats, fed from the fin scoop (s.9).
    vents: [
      [0.2, -0.45, ROOF_Z + 0.095],
      [0.2, 0.45, ROOF_Z + 0.095],
    ],
    // Overhead console with the panel flood and dome lamps.
    overhead: { z: ROOF_Z + 0.07 },
    doorHandle: [DOOR_REAR_X + 0.08, -0.12],
    airOutlet: [PANEL_X - 0.02, 0.05],
    // The floor carpet runs up the forward bulkhead behind the pedals.
    toeBoard: { x0: PANEL_X + 0.2, x1: BULKHEAD_X - 0.01, z: 0.18 },
  },
  // Flood light in the overhead console aimed at the panel; dome light over the centre seats.
  lamps: { flood: { pos: [0.1, 0, ROOF_Z + 0.08], aim: [PANEL_X, -0.2, -0.25] }, dome: { pos: [-1.0, 0, ROOF_Z + 0.08] } },
  // Simplified cabin for the occlusion bake: floor, headliner, flat sides, aft bulkhead, panel face and glareshield,
  // the windscreen's lower edge.
  box: { floor: FLOOR_Z, roof: ROOF_Z + 0.08, side: 0.6, rear: CABIN_REAR_X + 0.05, panelX: PANEL_X, glareshieldZ: PANEL_ZTOP - 0.02, sillZ: SCREEN_SILL_Z, windscreenX: SCREEN_BASE_X, roofGlazed: false },
  // Outward unit normals and areas, m^2, from the window outlines.
  glazingPanels: [
    { n: [0.5, 0, -0.87], area: 0.85 }, // the windscreen
    { n: [0, -1, 0], area: 1.05 }, // left side windows
    { n: [0, 1, 0], area: 1.05 },
  ],
  // Floor, headliner, sides, panel, bulkhead and six seats, less the glazing.
  interiorArea: 19,
  // Controls the instructor points at that have no 3D part of their own: the fuel selectors on the tunnel floor
  // (two levers ON / OFF / CROSSFEED), the parking brake (s.9).
  controlPoints: {
    fuelSelector: [-0.32, 0, TUNNEL.top - 0.005],
    parkingBrake: [PANEL_X + 0.005, faceY(780), PANEL_ZB + 0.06],
  },
};

// --- Paint: a 1972-74 factory scheme, representative (s.12) ----------------------------------------------------------

const LIVERY: LiveryDef = {
  registration: 'N34FS',
  // Overall white, a broad mid-blue band at the window sill with a thin dark accent line under it (s.12).
  palette: { base: [240, 240, 236], band: [36, 78, 150], accent: [24, 32, 52] },
  accentBelow: true,
  // From the nose along the sides at sill level to the tail, sweeping up toward the fin.
  stripe: {
    xs: [END_X, -4.6, -3.6, -2.6, -1.6, -0.6, 0.4, 1.2, 2.0, 2.6, 2.95],
    centre: [-0.27, -0.26, -0.27, -0.28, -0.28, -0.27, -0.25, -0.22, -0.17, -0.1, -0.04],
    half: [0.035, 0.045, 0.055, 0.06, 0.065, 0.065, 0.065, 0.06, 0.05, 0.04, 0.03],
    noseShearX: 2.4,
  },
  // The registration in 0.30 m letters on the rear fuselage between the rear window and the stabilator (s.12).
  lettering: { x0: -3.6, x1: -2.2, z0: -0.18, z1: 0.08 },
  construction: 'metal',
  // Skin joints at the cabin bulkheads and the tail-cone frames.
  skinJoints: [BULKHEAD_X, CABIN_REAR_X, xs(6.3), xs(7.3)],
  floorRivets: { z: 0.3, x1: CABIN_REAR_X },
  // The band sweeps up across the fin and rudder: z = bandZ0 + (x - bandX0) * slope.
  fin: { bandZ0: -0.75, bandX0: -4.4, slope: 0.55, cap: 0.1 },
  texture: { w: 4096, h: 2048 },
};

export const PA34_VISUAL: AirframeVisualDef = {
  id: 'pa34',
  fuselage: FUSELAGE,
  glazing: GLAZING,
  wing: WING,
  tail: TAIL,
  gear: GEAR,
  // Left engine first, as AircraftState.propellers.
  props: [prop(0), prop(1)],
  nacelles: [nacelle(-1), nacelle(1)],
  // The glove's root fillet: a slim body along each wing root, sunk in the cabin side and in the wing so that only
  // a fillet line a few centimetres high shows over the wing's upper skin, closing to nothing just inside the glove's
  // leading edge and the trailing edge.
  fairings: [
    {
      keys: ROOT_FILLET.map(([x, rise, half, hw]): Key => {
        const top = wingTopAtRoot(x) - rise;
        return [x, top, top + 2 * half, top + half, hw, 2, 2, 0];
      }),
      frontX: ROOT_FILLET[0][0],
      endX: ROOT_FILLET[ROOT_FILLET.length - 1][0],
      offset: { y: FILLET_Y, z: 0 },
      grid: { rows: 24, cols: 16 },
      paint: 'base',
      mirror: true,
    },
  ],
  lamps: LAMPS,
  cockpit: COCKPIT,
  livery: LIVERY,
  shadow: {
    halfX: 6.4,
    halfY: 6.5,
    // Belly band: centre x, half length, half width (nose to tail cone).
    fuselage: [-1.2, 4.3, 0.62],
    // Wing band: centre x (mid chord), half span of its core, and the height of the wing above the ground.
    wingX: -0.4,
    wingY: 5.2,
    wingHeight: PA34_GEOMETRY.restHeight - W.quarterChord.z,
    restHeight: PA34_GEOMETRY.restHeight,
  },
};

export default PA34_VISUAL;
