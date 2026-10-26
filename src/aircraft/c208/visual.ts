// Cessna 208 Caravan 675: the airframe as data for the 3D model, the cameras and the livery worker. PLAIN and
// structured-cloneable: no three.js, no functions, no class instances (the worker imports this file through
// aircraft/visualLoader.ts and nothing else of the aircraft).
//
// What the flight model and the picture must agree on (planforms, wheel contact points, the propeller disc, the
// eye point) comes from ./geometry; the panel face's pixel layout from ./panelLayout (plain data: panel.ts itself
// is not imported here). Everything else is shaped here from the POH three-view and photographs (no engineering
// data sheet exists for the type yet; the shapes are first picks to be refined against one): the fuselage station
// table, the glazing and door outlines, the paint, the cabin. Positions are FRD metres from the reference point;
// heights are written as the thrust line (C208_THRUST_Z) plus their height measured from it, as in geometry.ts.
// Colours: the livery palette is sRGB 0..255, the propeller paint sRGB 0..1.
//
// The type against the Cessna singles: a long slender nose over the PT6A (mounted "backwards": the air enters a
// chin inlet under the spinner, the exhaust leaves a single stack on the right of the cowling behind the
// propeller) tapering into a deep, slab-sided boxy cabin with a flat floor; a raked windscreen well ahead of the
// wing; crew doors each side, the two-piece cargo door on the left aft side and the airstair door on the right;
// five square cabin windows a side; the high wing on the cabin roof with one streamlined strut a side; a long
// tailcone rising to a tall swept fin with a dorsal fin and a low swept tailplane; tubular spring-steel main legs
// on big 6.50-10 wheels, an oleo nose leg; a three-blade feathering and reversing McCauley with a large spinner. Inside: two crew
// seats, control wheels on both sides, a full-width analogue panel, the centre pedestal with the power, propeller
// and condition levers and the trim wheel, the flap selector on the right of the lower panel, the fuel selectors
// overhead.

import { makeFinPlanform, makeRudderPlanform, makeWingPlanform, sectionPoint, surfacePoint } from '../../render/aircraft/planformMath';
import type {
  AirframeVisualDef,
  CockpitDef,
  FRD,
  GlazingDef,
  LampVisualDef,
  LiveryDef,
  PropVisualDef,
  SectionShape,
  TailVisualDef,
  WheelVisualDef,
  WingVisualDef,
} from '../types';
import { C208_GEOMETRY, C208_THRUST_Z } from './geometry';
import { C208_PANEL_CENTRE_PX, C208_PANEL_PARTS, C208_PANEL_PX_PER_M, C208_PANEL_PX_RECT } from './panelLayout';

const W = C208_GEOMETRY.wing;
const H = C208_GEOMETRY.hTail;
const V = C208_GEOMETRY.vTail;
const G = C208_GEOMETRY.gear;
const P = C208_GEOMETRY.propellers[0];
const EYE = C208_GEOMETRY.fuselage.pilotEye;
const DEG = Math.PI / 180;
/** Height of the thrust line (z down): every height below is T plus its height measured from the thrust line. */
const T = C208_THRUST_Z;

/** NACA 23017 (root) as a 4-digit stand-in: about 1.8 % camber well forward, 16.5 % thick (the tip's 23012 is thinner). */
const NACA23017: SectionShape = { m: 0.018, p: 0.2, t: 0.165 };
/** Tail sections, about NACA 0010-0012. */
const TAIL_SECTION: SectionShape = { m: 0, p: 0.4, t: 0.11 };

// --- Wing: constant-chord centre panel to the strut rib, tapered outer panel, one strut a side -----------------------

const TIP_Y = W.span / 2;

const WING: WingVisualDef = {
  mount: 'high',
  section: NACA23017,
  breaks: [
    { y: W.rootY, chord: W.rootChord, qcX: W.quarterChord.x },
    { y: W.taperStartY, chord: W.rootChord, qcX: W.quarterChord.x },
    { y: TIP_Y, chord: W.tipChord, qcX: W.quarterChord.x },
  ],
  rootY: W.rootY,
  qcZ: W.quarterChord.z,
  dihedral: W.dihedral,
  rootIncidence: W.rootIncidence,
  tipIncidence: W.tipIncidence,
  bays: [
    { kind: 'fixed', from: W.rootY, to: W.flap.innerY },
    { kind: 'flap', from: W.flap.innerY, to: W.flap.outerY, chordFraction: W.flap.chordFraction },
    { kind: 'aileron', from: W.aileron.innerY, to: W.aileron.outerY, chordFraction: W.aileron.chordFraction },
    { kind: 'fixed', from: W.aileron.outerY, to: TIP_Y },
  ],
  // Large single-slotted Fowler flaps on tracks: at FULL they run well aft (most of their chord) and a little down.
  flap: { maxDeflection: W.flap.maxDeflection, travelAft: 0.38, travelDown: 0.08 },
  // Squarish tips with a small rounded cap.
  tip: { round: 0.1, chordRound: 0.06 },
  // One streamlined strut a side, about 0.2 m of chord, from the stub fitting on the lower fuselage side at the
  // main-gear frame to the strut rib, below the cabin floor, just outside the slab side's lower rounding.
  strut: {
    fuselage: [W.strut!.fuselage.x, W.strut!.fuselage.y, W.strut!.fuselage.z],
    wing: [W.strut!.wing.x, W.strut!.wing.y, W.strut!.wing.z],
    chord: 0.2,
    tc: 0.3,
  },
  // The fuel fillers on top of each wing outboard of the strut; the pitot under the left wing; the stall-warning
  // vane on the left leading edge.
  fuelCaps: [{ y: 3.4, xc: 0.3, side: 'both' }],
  pitot: { side: -1, y: 3.3, xc: 0.15 },
  liftDetector: { side: -1, y: 3.0 },
};

const WING_PLANFORM = makeWingPlanform(WING);

// --- Tail: low swept tailplane with elevators, tall swept fin and rudder with a dorsal fin ----------------------------

/** Height of the fin from its base to its tip quarter-chord point (the fin planform's span parameter), m. */
const FIN_HEIGHT = V.base.z - V.tip.z;

const TAIL: TailVisualDef = {
  section: TAIL_SECTION,
  h: {
    span: H.span,
    rootChord: H.rootChord,
    tipChord: H.tipChord,
    quarterChord: { x: H.quarterChord.x, z: H.quarterChord.z },
    tipQuarterChordX: H.tipQuarterChordX,
    incidence: H.incidence,
    kind: 'elevator',
    chordFraction: H.elevator.chordFraction,
    // The central cut-out of the elevators for the rudder.
    innerCutY: 0.12,
    // A trim tab in the inboard trailing edge of each elevator.
    tab: { y0: 0.3, y1: 1.1, xc: 0.86, sides: 'both' },
  },
  v: {
    base: { x: V.base.x, z: V.base.z },
    tip: { x: V.tip.x, z: V.tip.z },
    rootChord: V.rootChord,
    tipChord: V.tipChord,
    rudderChordFraction: V.rudder.chordFraction,
    // The rudder trim tab low on its trailing edge.
    rudderTab: { h0: 0.15, h1: 0.7, xc: 0.88 },
  },
  tTail: false,
  // The long dorsal fin from mid tailcone up the fin's leading edge.
  dorsalFillet: { x0: -4.2, height: 0.55 },
  vorAntenna: true,
};

// --- Fuselage: the station table ---------------------------------------------------------------------------------

/** The cowling face just behind the spinner's backplate. */
const FRONT_X = 3.545;
/** The tailcone's end under the rudder (geometry.ts, 3V). */
const END_X = -7.25;
/** Firewall: the cowling / cabin joint. */
const FIREWALL_X = 2.42;
/** The windscreen's lower edge on the centre line and its top edge (the roof's front edge). */
const SCREEN_SILL: readonly [number, number] = [2.3, T - 0.465];
const SCREEN_TOP_X = 1.55;
/** The aft cabin bulkhead behind the cargo door. */
const CABIN_REAR_X = -2.35;
/** Belly under the cabin (3V: the flat floor is low, the belly about 0.86 m above the ground) and cabin floor. */
const BELLY_Z = T + 0.82;
const FLOOR_Z = T + 0.68;
/** Half the cabin's external width (geometry: 1.75 m). */
const HW = C208_GEOMETRY.fuselage.maxWidth / 2;

type Key = [x: number, zTop: number, zBot: number, zMid: number, hw: number, nTop: number, nBot: number, ridge: number];
/** A key written against the thrust line (zTop, zBot, zMid measured from it). */
const k = (x: number, top: number, bot: number, mid: number, hw: number, nTop: number, nBot: number): Key => [x, T + top, T + bot, T + mid, hw, nTop, nBot, 0];

function fuselageKeys(): Key[] {
  // The nose: a small face round the spinner's backplate flaring within a few centimetres into the cowling, whose
  // lower lip runs forward under the spinner round the chin inlet; the cowling deepens and widens aft over the
  // engine to the firewall, its top rising gently to the windscreen.
  const nose: Key[] = [
    k(FRONT_X, -0.2, 0.21, 0.0, 0.205, 2, 2),
    k(3.538, -0.25, 0.33, 0.03, 0.27, 2.3, 2.4),
    k(3.52, -0.28, 0.44, 0.05, 0.31, 2.5, 2.8),
    k(3.48, -0.3, 0.51, 0.06, 0.335, 2.7, 3.0),
    k(3.38, -0.315, 0.55, 0.07, 0.355, 2.8, 3.2),
    k(3.1, -0.335, 0.58, 0.08, 0.4, 3.0, 3.4),
    k(2.8, -0.37, 0.64, 0.06, 0.47, 3.2, 3.6),
    k(2.55, -0.41, 0.72, 0.02, 0.57, 3.4, 4.0),
    k(FIREWALL_X, -0.44, 0.77, -0.02, 0.65, 3.6, 4.5),
    // The windscreen rises from its sill to the roof's front edge; the cabin reaches its full slab-sided width.
    k(SCREEN_SILL[0], -0.465, 0.8, -0.05, 0.74, 3.8, 5),
    k(2.15, -0.6, 0.82, -0.08, 0.83, 4.2, 5.5),
    k(1.95, -0.79, 0.82, -0.1, 0.87, 4.6, 6),
    k(1.75, -0.96, 0.82, -0.1, HW, 5, 6),
    k(SCREEN_TOP_X, -1.09, 0.82, -0.1, HW, 5.5, 6),
    // The roof over the cockpit, ahead of the wing.
    k(1.25, -1.145, 0.82, -0.1, HW, 6, 6),
    k(0.9, -1.16, 0.82, -0.1, HW, 6.5, 6),
  ];
  // Between the wing roots the roof follows the root section's upper surface (the cabin-top fairing between the
  // root ribs); its leading edge is inside the roof fairing ahead of it.
  const wingRoot: Key[] = [];
  const p = { x: 0, y: 0, z: 0 };
  for (const xc of [0.12, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0]) {
    const [ax, ay] = surfacePoint(WING.section, xc, 1);
    sectionPoint(WING_PLANFORM, WING.rootY, ax, ay, p);
    wingRoot.push([p.x, p.z + 0.003, BELLY_Z, T - 0.1, HW, 7, 6, 0]);
  }
  // Behind the wing the top line falls gently to the fin; the belly runs level under the cargo door, then sweeps
  // up in a long straight line to the tailcone's end; the sides close in.
  const tail: Key[] = [
    k(-1.6, -1.12, 0.82, -0.12, 0.87, 5.5, 6),
    k(-2.1, -1.05, 0.8, -0.14, 0.84, 5, 5.5),
    k(-2.6, -0.99, 0.7, -0.18, 0.77, 4.4, 4.6),
    k(-3.2, -0.93, 0.55, -0.22, 0.67, 3.8, 4),
    k(-3.9, -0.87, 0.37, -0.27, 0.55, 3.3, 3.4),
    k(-4.6, -0.82, 0.2, -0.32, 0.44, 3, 3),
    k(-5.3, -0.77, 0.04, -0.37, 0.34, 2.8, 2.8),
    k(-6.0, -0.71, -0.12, -0.42, 0.25, 2.6, 2.6),
    k(-6.6, -0.69, -0.28, -0.48, 0.17, 2.4, 2.4),
    k(-7.0, -0.68, -0.42, -0.55, 0.1, 2.2, 2.2),
    k(END_X, -0.66, -0.56, -0.61, 0.03, 2.2, 2.2),
  ];
  return [...nose, ...wingRoot, ...tail];
}

const FUSELAGE_KEYS = fuselageKeys();

/** Height of the top line at station x (the keys' zTop, linear between keys). */
function topZ(x: number): number {
  for (let i = 1; i < FUSELAGE_KEYS.length; i++) {
    const [x0, z0] = FUSELAGE_KEYS[i - 1];
    const [x1, z1] = FUSELAGE_KEYS[i];
    if (x <= x0 && x >= x1) return z0 + ((x - x0) / (x1 - x0)) * (z1 - z0);
  }
  return FUSELAGE_KEYS[FUSELAGE_KEYS.length - 1][1];
}

const FUSELAGE: AirframeVisualDef['fuselage'] = {
  keys: FUSELAGE_KEYS,
  frontX: FRONT_X,
  endX: END_X,
  grid: { rows: 200, cols: 112 },
  nose: 'prop',
  // The engine's chin inlet under the spinner: a wide rounded opening in the cowling's lower lip.
  inlets: [{ y: 0, z: T + 0.37, w: 0.38, h: 0.15, r: 0.04, exponent: 4 }],
  // The single exhaust stack on the right of the cowling just behind the propeller, pointing out and aft.
  exhaust: { pos: [3.25, 0.34, T - 0.05], radius: 0.065, dir: [-0.12, 0.17, -0.03] },
  antennas: [
    // VHF com blades on the roof behind the wing and on the tailcone, the ELT whip, the transponder and DME stubs
    // under the belly.
    { kind: 'blade', pos: [-1.9, 0, topZ(-1.9)], height: 0.25 },
    { kind: 'blade', pos: [-3.0, 0, topZ(-3.0)], height: 0.25 },
    { kind: 'whip', pos: [-3.9, 0, topZ(-3.9)], height: 0.45 },
    { kind: 'stub', pos: [0.3, 0, BELLY_Z + 0.002], height: 0.1 },
    { kind: 'stub', pos: [-1.0, 0, BELLY_Z + 0.002], height: 0.1 },
  ],
};

// --- Glazing and door lines (side projection: x, z) ---------------------------------------------------------------

/** The windscreen's lower corners at the cabin sides, and the A-post from there up to the roof's front edge. */
const SCREEN_CORNER: readonly [number, number] = [2.12, T - 0.33];
const SCREEN_POST_TOP: readonly [number, number] = [SCREEN_TOP_X, T - 1.1];
const SCREEN_SILL_N = ((): readonly [number, number] => {
  const dx = SCREEN_SILL[0] - SCREEN_CORNER[0];
  const dz = SCREEN_CORNER[1] - SCREEN_SILL[1];
  const l = Math.hypot(dx, dz);
  return [dz / l, dx / l];
})();
/** Station of the A-post at height z (side projection), moved aft by `back`. */
const postX = (z: number, back = 0): number =>
  SCREEN_CORNER[0] + ((z - SCREEN_CORNER[1]) / (SCREEN_POST_TOP[1] - SCREEN_CORNER[1])) * (SCREEN_POST_TOP[0] - SCREEN_CORNER[0]) - back;

/** Crew door: aft edge, sill and top; the door window's sill and top. */
const CREW_DOOR_AFT_X = 1.04;
const CREW_WINDOW = { sill: T - 0.36, top: T - 1.02 };
/** Cabin windows: centres, half width, sill and top (square, with rounded corners). */
const CABIN_WINDOW_XS = [0.55, -0.05, -0.65, -1.25, -1.85] as const;
const CABIN_WINDOW = { half: 0.2, sill: T - 0.32, top: T - 0.74 };
/** The cargo door (left) and the airstair door (right): stations and the two halves' joint. */
const CARGO = { x0: -0.93, x1: -2.2, top: T - 0.98, joint: T - 0.16, sill: T + 0.73 };
const AIRSTAIR = { x0: -1.52, x1: -2.2, top: T - 0.98, sill: T + 0.74 };

const rect = (x0: number, x1: number, top: number, sill: number): [number, number][] => [
  [x0, sill],
  [x0, top],
  [x1, top],
  [x1, sill],
];

const GLAZING: GlazingDef = {
  cabinFrontX: SCREEN_SILL[0],
  cabinRearX: CABIN_REAR_X,
  firewallX: FIREWALL_X,
  tRange: [0.2, 0.8],
  windows: [
    // The crew door windows: large, the front edge along the A-post.
    {
      pts: [
        [postX(CREW_WINDOW.sill, 0.06), CREW_WINDOW.sill],
        [postX(CREW_WINDOW.top, 0.05), CREW_WINDOW.top],
        [CREW_DOOR_AFT_X + 0.08, CREW_WINDOW.top],
        [CREW_DOOR_AFT_X + 0.08, CREW_WINDOW.sill],
      ],
      r: 0.06,
      sides: 'both',
    },
    // Five square cabin windows a side (the aft two on the left in the cargo door's upper half, the aft one on the
    // right in the airstair door).
    ...CABIN_WINDOW_XS.map((x) => ({
      pts: rect(x + CABIN_WINDOW.half, x - CABIN_WINDOW.half, CABIN_WINDOW.top, CABIN_WINDOW.sill),
      r: 0.07,
      sides: 'both' as const,
      maxX: x + CABIN_WINDOW.half + 0.05,
    })),
  ],
  windscreen: {
    sillC: SCREEN_SILL,
    sillN: SCREEN_SILL_N,
    post: [SCREEN_CORNER, SCREEN_POST_TOP],
    postY: 0.5,
    topX: SCREEN_TOP_X,
  },
  doors: [
    // Crew doors, both sides, hinged at the front: from the floor line up to the roof behind the A-post.
    {
      pts: [
        [2.1, T + 0.7],
        [2.1, T - 0.3],
        [postX(T - 1.06, 0.02), T - 1.06],
        [CREW_DOOR_AFT_X, T - 1.06],
        [CREW_DOOR_AFT_X, T + 0.7],
      ],
      r: 0.05,
      sides: 'both',
      handle: { x: CREW_DOOR_AFT_X + 0.09, z: T - 0.2 },
    },
    // The two-piece cargo door on the left: upper half hinged at the top, lower half forward.
    { pts: rect(CARGO.x0, CARGO.x1, CARGO.top, CARGO.joint - 0.01), r: 0.05, sides: 'left', handle: { x: CARGO.x1 + 0.1, z: CARGO.joint - 0.1 } },
    { pts: rect(CARGO.x0, CARGO.x1, CARGO.joint + 0.01, CARGO.sill), r: 0.05, sides: 'left', handle: { x: CARGO.x1 + 0.1, z: CARGO.joint + 0.12 } },
    // The passenger airstair door on the right, aft.
    { pts: rect(AIRSTAIR.x0, AIRSTAIR.x1, AIRSTAIR.top, AIRSTAIR.sill), r: 0.05, sides: 'right', handle: { x: AIRSTAIR.x0 - 0.1, z: T - 0.12 } },
  ],
  // The headliner just above the crew window tops (the windscreen's upper part is cut out of it, x > topX).
  liningRoofLimit: T - 1.04,
  xRange: [SCREEN_SILL[0] + 0.01, CABIN_REAR_X + 0.05],
  headliner: { x0: SCREEN_TOP_X - 0.05, x1: CABIN_REAR_X + 0.05, z0: T - 0.98, z1: T - 1.02, pitch: 0.3 },
};

// --- Landing gear: oleo nose leg, tubular spring-steel main legs, no fairings --------------------------------------

const mainWheel = (contact: { x: number; y: number; z: number }, side: 1 | -1): WheelVisualDef => ({
  contact: [contact.x, contact.y, contact.z],
  radius: G.mainWheelRadius,
  // 6.50-10 tyre, about 0.165 m wide, on a 10 in rim.
  width: 0.165,
  rimRadius: 0.127,
  // Thick tapered spring-steel tubes from the belly's corner at the main-gear frame, out, down and a little aft
  // to the axles.
  leg: { kind: 'springTube', root: [-0.42, side * 0.6, T + 0.8], axleOffset: 0.13, r0: 0.05, r1: 0.032 },
});

const GEAR: AirframeVisualDef['gear'] = [
  {
    contact: [G.nose.x, G.nose.y, G.nose.z],
    radius: G.noseWheelRadius,
    // 22 x 8.00-8: about 0.2 m wide on an 8 in rim.
    width: 0.2,
    rimRadius: 0.1016,
    // The long oleo leg from the engine mount out of the lower cowling, torque links, a fork either side.
    leg: { kind: 'oleo', top: [3.12, 0, T + 0.48], cylinderLen: 0.42, crownAt: 0.66, forkHalf: 0.13, scissors: true, steers: true },
  },
  mainWheel(G.leftMain, -1),
  mainWheel(G.rightMain, 1),
];

// --- Propeller: McCauley three-blade 106 in, constant speed, full feathering, reversing ------------------------------

const SPINNER_BASE_X = 3.55;

const PROP: PropVisualDef = {
  hub: [P.hub.x, P.hub.y, P.hub.z],
  diameter: P.diameter,
  blades: P.blades,
  rotation: P.rotation,
  // Flight-idle (low pitch) blade angle; the state's blade pitch turns each blade from it (feather, reverse).
  referencePitch: 15 * DEG,
  variablePitch: true,
  // Broad aluminium blades, about 0.21 m of chord at their widest, rounded tips.
  chord: [
    [0.12, 0.09],
    [0.25, 0.16],
    [0.45, 0.21],
    [0.65, 0.21],
    [0.85, 0.18],
    [0.95, 0.14],
    [1.0, 0.06],
  ],
  // The large, blunt-pointed spinner about 0.5 m across.
  spinner: { baseX: SPINNER_BASE_X, radius: 0.25, length: C208_GEOMETRY.fuselage.noseX - SPINNER_BASE_X },
  // Black blades (anti-glare both sides) with white tips.
  paint: { face: [0.07, 0.07, 0.075], back: [0.035, 0.035, 0.037], tip: [0.92, 0.92, 0.9], tipBand: 0.08 },
};

// --- Exterior lamps ------------------------------------------------------------------------------------------------

const LAMPS: readonly LampVisualDef[] = ((): LampVisualDef[] => {
  const onWing = (y: number, xc: number, yc: number, side: 1 | -1): FRD => {
    const p = sectionPoint(WING_PLANFORM, y, xc, yc);
    return [p.x, p.y * side, p.z];
  };
  // Navigation light in each tip cap, the strobe just behind it.
  const tipY = TIP_Y - 0.04;
  // The white tail light on top of the rudder, swinging with it.
  const tail = sectionPoint(makeRudderPlanform(TAIL), FIN_HEIGHT - 0.06, 1, 0);
  // The red beacon on the fin tip.
  const finTip = sectionPoint(makeFinPlanform(TAIL), FIN_HEIGHT - 0.01, 0.3, 0);
  return [
    { id: 'navL', pos: onWing(tipY, 0.06, 0.0, -1), radius: 0.03, glowOffset: [0.035, -0.035, 0] },
    { id: 'navR', pos: onWing(tipY, 0.06, 0.0, 1), radius: 0.03, glowOffset: [0.035, 0.035, 0] },
    { id: 'navTail', pos: [tail.x - 0.015, tail.y, tail.z], radius: 0.022, glowOffset: [-0.03, 0, 0], parent: 'rudder' },
    { id: 'strobeL', pos: onWing(tipY + 0.01, 0.22, 0.0, -1), radius: 0.02, glowOffset: [0, -0.035, 0] },
    { id: 'strobeR', pos: onWing(tipY + 0.01, 0.22, 0.0, 1), radius: 0.02, glowOffset: [0, 0.035, 0] },
    { id: 'beacon', pos: [finTip.x, 0, finTip.z - 0.035], radius: 0.035, glowOffset: [0, 0, -0.045] },
    // The landing light in the left wing's leading edge outboard of the strut, the taxi light in the right one.
    { id: 'landing', pos: onWing(3.6, 0.004, 0.0, -1), radius: 0.06, glowOffset: [0.03, 0, 0], aim: { downDeg: 3, outDeg: 0, halfAngleDeg: 9 } },
    { id: 'taxi', pos: onWing(3.6, 0.004, 0.0, 1), radius: 0.055, glowOffset: [0.03, 0, 0], aim: { downDeg: 7, outDeg: 0, halfAngleDeg: 24 } },
  ];
})();

// --- Cockpit ---------------------------------------------------------------------------------------------------------

// The cockpit is fitted to the pilot's eye of the geometry: the panel top 0.15 m below it and 0.67 m ahead of it.
// The fuselage, the windscreen and the cabin box are the airframe's and do not move with it.
/** Instrument panel face: vertical, facing aft, centred on the centre line (panelLayout.ts: 1.46 x 0.46 m). */
const PANEL_X = EYE.x + 0.67;
const PANEL_ZTOP = EYE.z + 0.15;
const PX = C208_PANEL_PX_PER_M;
const PANEL_W = C208_PANEL_PX_RECT.w / PX;
const PANEL_ZB = PANEL_ZTOP + C208_PANEL_PX_RECT.h / PX;
/** A point of the panel canvas, px, on the face (FRD y, z). */
const faceY = (px: number): number => (px - C208_PANEL_CENTRE_PX) / PX;
const faceZ = (py: number): number => PANEL_ZTOP + (py - C208_PANEL_PX_RECT.y) / PX;
/** Lateral station of the crew seats, the control wheels and the pedals: the pilot's eye. */
const SEAT_Y = -EYE.y;
/** The centre pedestal (panelLayout.ts C208_PEDESTAL): its sides, its top at the face, its aft face. */
const PED = C208_PANEL_PARTS.pedestal;
const PEDESTAL = { y0: faceY(PED.x0), y1: faceY(PED.x1), top: faceZ(PED.y0), aftX: PANEL_X - 0.3 };
/** The levers' pivots in the pedestal top, under its slots; the levers stand 0.2 m up out of them. */
const LEVER = { x: PANEL_X - 0.16, z: PEDESTAL.top + 0.06, length: 0.2 };
/** The crew door's inner panel and the cabin side walls below the windows. */
const DOOR = { x0: 2.06, x1: CREW_DOOR_AFT_X + 0.04, z0: CREW_WINDOW.sill + 0.03, z1: FLOOR_Z - 0.06 };
/** The headliner's height (the lining's roof limit) and the overhead console under it. */
const ROOF_IN = GLAZING.liningRoofLimit;

const COCKPIT: CockpitDef = {
  pilotEye: [EYE.x, EYE.y, EYE.z],
  /** Default view: 8 degrees nose-down from level, over the glareshield. */
  defaultPitchDeg: -8,
  // Instrument focus (Q): the main instruments centred, the glareshield ~25 % down the frame, the 3-1/8 in dials
  // 128-135 px across on a 991 px high view (scripts/cockpit-focus.mjs).
  focus: { yawDeg: 0, pitchDeg: -20.5, fovDeg: 46 },
  enclosure: 'cabin',
  panel: { x: PANEL_X, zTop: PANEL_ZTOP, width: PANEL_W, pxRect: C208_PANEL_PX_RECT },
  floor: { z: FLOOR_Z, x0: FIREWALL_X - 0.04, x1: CABIN_REAR_X + 0.05 },
  // A wide, nearly flat black glareshield from the panel's lip forward to just under the windscreen's lower edge.
  glareshield: {
    profile: [
      [PANEL_X - 0.03, PANEL_ZTOP - 0.0015],
      [PANEL_X - 0.039, PANEL_ZTOP - 0.01],
      [PANEL_X - 0.034, PANEL_ZTOP - 0.022],
      [PANEL_X, PANEL_ZTOP - 0.027],
      [SCREEN_SILL[0] - 0.03, SCREEN_SILL[1] + 0.006],
      [SCREEN_SILL[0] - 0.01, SCREEN_SILL[1] + 0.012],
      [SCREEN_SILL[0] - 0.01, SCREEN_SILL[1] + 0.04],
      [PANEL_X + 0.03, PANEL_ZTOP + 0.0015],
      [PANEL_X, PANEL_ZTOP - 0.0015],
    ],
    halfWidth: 0.8,
  },
  // Two crew seats on their raised bases, slid to where the eye sits over the rear of the cushion; two rows of
  // commuter seats behind (the cabin is often fitted for cargo). x is the cushion's front edge, z its top.
  seats: [
    { x: EYE.x + 0.31, y: -SEAT_Y, kind: 'front', width: 0.5, depth: 0.48, z: EYE.z + 0.78, reclineDeg: 14 },
    { x: EYE.x + 0.31, y: SEAT_Y, kind: 'front', width: 0.5, depth: 0.48, z: EYE.z + 0.78, reclineDeg: 14 },
    { x: 0.6, y: -0.42, kind: 'front', width: 0.46, depth: 0.46, z: FLOOR_Z - 0.44, reclineDeg: 15 },
    { x: 0.6, y: 0.42, kind: 'front', width: 0.46, depth: 0.46, z: FLOOR_Z - 0.44, reclineDeg: 15 },
    { x: -0.4, y: -0.42, kind: 'front', width: 0.46, depth: 0.46, z: FLOOR_Z - 0.44, reclineDeg: 15 },
    { x: -0.4, y: 0.42, kind: 'front', width: 0.46, depth: 0.46, z: FLOOR_Z - 0.44, reclineDeg: 15 },
  ],
  consoles: [
    // Structure under the lower edge of the panel, toward the firewall (knee room under it).
    {
      min: [PANEL_X + 0.002, -0.76, PANEL_ZB - 0.005],
      max: [PANEL_X + 0.17, 0.76, PANEL_ZB + 0.14],
      bevel: 0.008,
      material: 'panelPlastic',
      profile: [
        [PANEL_X + 0.002, PANEL_ZB - 0.005],
        [PANEL_X + 0.002, PANEL_ZB + 0.04],
        [PANEL_X + 0.12, PANEL_ZB + 0.14],
        [PANEL_X + 0.17, PANEL_ZB + 0.14],
        [PANEL_X + 0.17, PANEL_ZB - 0.005],
      ],
    },
    // The centre pedestal from the lower panel aft and down to the floor; the three levers stand out of its top.
    { min: [PEDESTAL.aftX, PEDESTAL.y0, PEDESTAL.top], max: [PANEL_X + 0.01, PEDESTAL.y1, FLOOR_Z], bevel: 0.015, material: 'black' },
    // The overhead fuel selector panel between the crew seats.
    { min: [EYE.x - 0.2, -0.14, ROOF_IN + 0.005], max: [EYE.x + 0.25, 0.14, ROOF_IN + 0.05], bevel: 0.01, material: 'panelPlastic' },
  ],
  // Both sides: the crew door's inner panel with its armrest, the kick panel ahead of it, the cabin side walls.
  trimPanels: [
    {
      side: 0, x0: DOOR.x0, x1: DOOR.x1, z0: DOOR.z0, z1: DOOR.z1, relief: 0.011, material: 'trimPlastic',
      grid: { rows: 48, cols: 44 },
      edge: 0.025,
      armrest: { xa: 1.15, xb: 1.85, zc: T - 0.02, hz: 0.045, height: 0.05, taper: 0.08 },
    },
    { side: 0, x0: FIREWALL_X - 0.03, x1: DOOR.x0 + 0.02, z0: T - 0.2, z1: FLOOR_Z + 0.02, relief: 0.008, material: 'panelPlastic', grid: { rows: 16, cols: 36 }, edge: 0.015, openBelow: true },
    { side: 0, x0: CREW_DOOR_AFT_X - 0.02, x1: CABIN_REAR_X + 0.06, z0: CABIN_WINDOW.sill + 0.03, z1: FLOOR_Z - 0.04, relief: 0.009, material: 'seatFabric', grid: { rows: 90, cols: 30 }, edge: 0.02 },
  ],
  // Occupied in external views: the pilot.
  occupants: [{ seat: 0 }],
  // Two control wheels on shafts through the panel: neutral end position, fore-aft travel, rotation.
  column: { kind: 'yoke', x: PANEL_X - 0.2, y: SEAT_Y, z: faceZ(C208_PANEL_PARTS.yokes.y), travel: 0.09, rollDeg: 45, style: 'cessna208' },
  pedals: { x: PANEL_X + 0.24, ys: [-SEAT_Y, SEAT_Y] },
  // The pedestal's levers, left to right: POWER (black), PROP (blue), CONDITION (red; it moves with the
  // per-engine 'mixture' control: forward HIGH IDLE, aft CUTOFF). The power lever goes on aft of its idle gate
  // through BETA to REVERSE (ControlInputs.reverse) over a further third of its forward swing (ESTIMATE from cockpit
  // photographs: the reverse slot is about a third as long as the IDLE-MAX slot).
  engineControls: [
    { kind: 'lever', control: 'throttle', engine: 0, pos: [LEVER.x, faceY(PED.levers.power), LEVER.z], travel: 0.8, colour: 'black', length: LEVER.length, reverseTravel: 0.35 },
    { kind: 'lever', control: 'propeller', engine: 0, pos: [LEVER.x, faceY(PED.levers.propeller), LEVER.z], travel: 0.8, colour: 'blue', length: LEVER.length },
    { kind: 'lever', control: 'mixture', engine: 0, pos: [LEVER.x, faceY(PED.levers.condition), LEVER.z], travel: 0.8, colour: 'red', length: LEVER.length },
  ],
  // The flap selector in its slot on the right of the lower panel, UP to FULL over `travel` px.
  flapControl: {
    kind: 'panelLever',
    pos: [PANEL_X, faceY(C208_PANEL_PARTS.flapSelector.x), faceZ(C208_PANEL_PARTS.flapSelector.y)],
    travel: C208_PANEL_PARTS.flapSelector.travel / PX,
  },
  // The elevator trim wheel on the pedestal's left side.
  trimWheel: { pos: [PANEL_X - 0.17, PEDESTAL.y0 - 0.012, FLOOR_Z - 0.56], axis: 'y' },
  // The parking brake T-handle at the lower left of the panel, pulled to set.
  parkingBrakeHandle: { pos: [PANEL_X, faceY(C208_PANEL_PARTS.parkingBrake[0]), faceZ(C208_PANEL_PARTS.parkingBrake[1])], travel: 0.05 },
  // The standby compass under the windscreen's top on the centre line.
  compass: { pos: [SCREEN_TOP_X + 0.01, 0, T - 0.93] },
  fittings: {
    defrosters: [
      [SCREEN_SILL[0] - 0.08, -0.3, SCREEN_SILL[1] + 0.003],
      [SCREEN_SILL[0] - 0.08, 0.3, SCREEN_SILL[1] + 0.003],
    ],
    visors: { x: SCREEN_TOP_X - 0.06, z: ROOF_IN + 0.02, ys: [-SEAT_Y, SEAT_Y] },
    overhead: { z: ROOF_IN + 0.005 },
    doorHandle: [CREW_DOOR_AFT_X + 0.2, T - 0.06],
    airOutlet: [FIREWALL_X - 0.05, T + 0.3],
    toeBoard: { x0: PANEL_X + 0.18, x1: FIREWALL_X - 0.04, z: T + 0.42 },
  },
  // Flood light by the overhead panel aimed at the instrument panel; dome light over the cabin.
  // Flood: white overhead flood, 11.7 cd at full dimmer so its panel ~1.07 m away gets the Cessna 172S's ~10 lx (agent choice,
  // panel lighting for every type); the mask's glareshield top is this cabin's (box.glareshieldZ).
  lamps: { flood: { pos: [EYE.x - 0.1, 0, ROOF_IN + 0.02], aim: [PANEL_X, -0.2, PANEL_ZTOP + 0.2], cd: 11.7, maskTop: -(PANEL_ZTOP - 0.02) }, dome: { pos: [-0.8, 0, ROOF_IN + 0.02] } },
  // Simplified cabin for the occlusion bake.
  box: {
    floor: FLOOR_Z,
    roof: ROOF_IN + 0.01,
    side: 0.83,
    rear: CABIN_REAR_X + 0.05,
    panelX: PANEL_X,
    glareshieldZ: PANEL_ZTOP - 0.02,
    sillZ: SCREEN_SILL[1],
    windscreenX: SCREEN_SILL[0],
    roofGlazed: false,
  },
  // Outward unit normals and areas, m^2, from the window outlines.
  glazingPanels: [
    { n: [0.73, 0, -0.68], area: 1.1 }, // the windscreen
    { n: [0, -1, 0], area: 1.46 }, // left crew door and cabin windows
    { n: [0, 1, 0], area: 1.46 },
  ],
  // Floor, headliner, sides, panel, bulkhead and seats, less the glazing.
  interiorArea: 34,
  // Controls the instructor points at that have no 3D part of their own: the fuel selectors overhead.
  controlPoints: {
    fuelSelector: [EYE.x + 0.02, 0, ROOF_IN + 0.055],
    parkingBrake: [PANEL_X, faceY(C208_PANEL_PARTS.parkingBrake[0]), faceZ(C208_PANEL_PARTS.parkingBrake[1])],
  },
};

// --- Paint: overall white with a dark blue cheat line and a gold accent, representative ------------------------------

const LIVERY: LiveryDef = {
  registration: 'N208FS',
  palette: { base: [241, 241, 238], band: [30, 52, 108], accent: [190, 150, 64] },
  accentBelow: true,
  // Along the cowling from behind the spinner, under the windows, and sweeping up the tailcone toward the fin.
  stripe: {
    xs: [-7.2, -6.2, -5.0, -3.8, -2.6, -1.4, 0, 1.2, 2.2, 2.9, 3.48],
    centre: [-0.6, -0.52, -0.4, -0.3, -0.2, -0.17, -0.17, -0.17, -0.15, -0.1, -0.05].map((z) => T + z),
    half: [0.03, 0.04, 0.055, 0.065, 0.07, 0.07, 0.07, 0.07, 0.06, 0.05, 0.04],
    noseShearX: 3.2,
  },
  // The registration on the tailcone below the stripe.
  lettering: { x0: -4.7, x1: -2.75, z0: T - 0.22, z1: T + 0.02 },
  construction: 'metal',
  skinJoints: [FIREWALL_X, CABIN_REAR_X, -3.6, -5.0],
  // The cowling's split line and fasteners, the oil filler door on its top.
  cowlSplitZ: T + 0.1,
  cowl: { oilDoor: { x: 2.75, halfLength: 0.08, halfWidth: 0.07 } },
  floorRivets: { z: FLOOR_Z + 0.02, x1: CABIN_REAR_X },
  // The band sweeps up across the fin and rudder: z = bandZ0 + (x - bandX0) * slope.
  fin: { bandZ0: T - 1.15, bandX0: -5.6, slope: 0.6, cap: 0.15 },
  texture: { w: 4096, h: 2048 },
};

export const C208_VISUAL: AirframeVisualDef = {
  id: 'c208',
  fuselage: FUSELAGE,
  glazing: GLAZING,
  wing: WING,
  tail: TAIL,
  gear: GEAR,
  props: [PROP],
  nacelles: [],
  lamps: LAMPS,
  cockpit: COCKPIT,
  livery: LIVERY,
  shadow: {
    halfX: 8.2,
    halfY: 8.4,
    // Belly band: centre x, half length, half width (cowling to tailcone).
    fuselage: [-1.7, 5.6, 0.85],
    // Wing band: centre x (mid chord), half span of its core, and the height of the wing above the ground.
    wingX: -0.475,
    wingY: 6.4,
    wingHeight: C208_GEOMETRY.restHeight - W.quarterChord.z,
    restHeight: C208_GEOMETRY.restHeight,
  },
};

export default C208_VISUAL;
