// Piper PA-38-112 Tomahawk II: the airframe as data for the 3D model, the cameras and the livery worker. PLAIN and
// structured-cloneable: no three.js, no functions, no class instances (the worker imports this file through
// aircraft/visualLoader.ts and nothing else of the aircraft).
//
// What the flight model and the picture must agree on (planforms, wheel contact points, the propeller disc, the
// eye point) comes from ./geometry; the panel's pixel layout from ./panel. Everything else is shaped here from the
// type's engineering data sheet (aircraft-data/pa38.md in the design work folder; "s.N" is its section N, s.12
// the appearance): the fuselage station table, the glazing and door outlines, the paint, the cabin. Positions
// are FRD metres from the reference point; a station "xs" of s.12 (metres aft of the spinner tip) is
// x = 2.074 - xs, and a height there above the thrust line h is z = -0.089 - h. Colours: the livery palette is
// sRGB 0..255, the propeller paint sRGB 0..1.
//
// The type against the C172S: a two-seat low-wing trainer with a T-tail. A blunt cowling with a deep chin, two
// rounded inlets beside a pointed spinner and the landing lights low in the nose; a tall bubble cabin glazed all
// round (a one-piece wrap-around windshield from the cowling back to the door posts, a large window in each
// forward-hinged door, a wrap-around rear window over the top) with a narrow metal roof between them; a dead
// level, straight-sided tail cone under a sharply swept fin with the tailplane on top; a constant-chord wing with
// rounded tips; flat steel leaf-spring main legs out of the wing; the throttle quadrant in front of the lower
// panel and the flap lever and trim wheel on a console between the seats.

import { makeFinPlanform, makeRudderPlanform, makeWingPlanform, sectionPoint } from '../../render/aircraft/planformMath';
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
import { PA38_GEOMETRY } from './geometry';
import { PA38_PANEL_CENTRE_PX, PA38_PANEL_PARTS, PA38_PANEL_PX_PER_M, PA38_PANEL_PX_RECT } from './panel';

const W = PA38_GEOMETRY.wing;
const H = PA38_GEOMETRY.hTail;
const V = PA38_GEOMETRY.vTail;
const G = PA38_GEOMETRY.gear;
const P = PA38_GEOMETRY.propellers[0];
const EYE = PA38_GEOMETRY.fuselage.pilotEye;

/** NASA GA(W)-1 (LS(1)-0417, s.2.1) as a NACA 4-digit stand-in: 17 % thick, the camber well aft. */
const GAW1: SectionShape = { m: 0.024, p: 0.5, t: 0.17 };
/** Symmetric tail sections, about NACA 0011 (s.2.4). */
const NACA0011: SectionShape = { m: 0, p: 0.4, t: 0.11 };

/** Metres per inch, and the body x of a Piper fuselage station (as geometry.ts converts it). */
const IN = 0.0254;
const sta = (station: number): number => (77.25 - station) * IN;

// --- Wing: one constant-chord panel, low, rounded down-turned tips, no strut ------------------------------------

const TIP_Y = W.span / 2;

const WING: WingVisualDef = {
  mount: 'low',
  section: GAW1,
  breaks: [
    { y: W.rootY, chord: W.rootChord, qcX: W.quarterChord.x },
    { y: TIP_Y, chord: W.tipChord, qcX: W.quarterChord.x },
  ],
  rootY: W.rootY,
  qcZ: W.quarterChord.z,
  dihedral: W.dihedral,
  rootIncidence: W.rootIncidence,
  tipIncidence: W.tipIncidence,
  // The wing ends just under the fuselage skin (no root cap floating clear of the narrowing belly).
  root: 'conform',
  bays: [
    { kind: 'fixed', from: W.rootY, to: W.flap.innerY },
    { kind: 'flap', from: W.flap.innerY, to: W.flap.outerY, chordFraction: W.flap.chordFraction },
    { kind: 'aileron', from: W.aileron.innerY, to: W.aileron.outerY, chordFraction: W.aileron.chordFraction },
    { kind: 'fixed', from: W.aileron.outerY, to: TIP_Y },
  ],
  // Plain flap on hinges at about 80 % chord (s.2.2): it turns, it does not run aft.
  flap: { maxDeflection: W.flap.maxDeflection, travelAft: 0, travelDown: 0 },
  // Removable thermoplastic tips, rounded and turned down, about 0.2 m wide (s.2.1).
  tip: { round: 0.21, chordRound: 0.16 },
  // Filler cap on the upper forward slope of each inboard leading-edge tank; the pitot blade under the left
  // wing (s.9, s.12).
  fuelCaps: [{ y: 1.75, xc: 0.12, side: 'both' }],
  pitot: { side: -1, y: 3.3, xc: 0.16 },
  // Black wing walks from the doors to the trailing edge over the fixed root bay (s.12); one inboard and one
  // outboard flow strip a wing (s.2.1: span stations not found, these are estimates); the Safe Flight lift-detector
  // vane on the left leading edge (s.9).
  walkways: [{ y0: W.rootY + 0.02, y1: W.flap.innerY - 0.02, xc0: 0.18, xc1: 0.96, side: 'both' }],
  stallStrips: [{ y0: 1.05, y1: 1.25 }, { y0: 2.4, y1: 2.6 }],
  liftDetector: { side: -1, y: 2.0 },
};

// --- Tail: sharply swept fin and rudder under a fixed tailplane with elevators (T-tail) -------------------------

/** Height of the fin from its base to its tip quarter-chord point (the fin planform's span parameter), m. */
const FIN_HEIGHT = V.base.z - V.tip.z;
/** Rudder bottom, WL 44.90 (s.2.7), below the fin base on the tail cone top (WL 57.00). */
const RUDDER_BOTTOM_Z = (36.5 - 44.9) * IN;

const TAIL: TailVisualDef = {
  section: NACA0011,
  h: {
    span: H.span,
    rootChord: H.rootChord,
    tipChord: H.tipChord,
    quarterChord: { x: H.quarterChord.x, z: H.quarterChord.z },
    incidence: H.incidence,
    kind: 'elevator',
    chordFraction: H.elevator.chordFraction,
    // A T-tail: one elevator across the span, no cut-out for the rudder; no trim tab (spring trim, s.9).
    innerCutY: 0,
  },
  v: {
    base: { x: V.base.x, z: V.base.z },
    tip: { x: V.tip.x, z: V.tip.z },
    rootChord: V.rootChord,
    tipChord: V.tipChord,
    // The nearly parallel-chord rudder of s.12 (about 0.45 m): the visual's one fraction of the local chord puts
    // it at 0.55 m at the base and 0.27 m at the top (the flight model's 0.45 is an area mean, s.2.5).
    rudderChordFraction: 0.38,
    // The rudder runs on below the tail cone top to its bottom at WL 44.90, its lower aft corner at STA 261.07
    // (s.2.7): behind the tail cone's end. bottomH is measured up the fin from its base, so below it is negative.
    rudderExtension: { bottomH: V.base.z - RUDDER_BOTTOM_Z, aftChord: 0.48 },
  },
  tTail: true,
  // The fin-top bullet runs aft past the elevator's trailing edge to the aircraft's aft-most point, STA 273.59 (s.2.7, s.12).
  bullet: { aftX: PA38_GEOMETRY.fuselage.tailX },
  // A small triangular fillet ahead of the fin root, about 0.5 m long (s.2.5).
  dorsalFillet: { x0: sta(205.5) + 0.5, height: 0.1 },
  // The VOR "cat-whisker" dipole high on the fin (s.12).
  vorAntenna: true,
};

// --- Fuselage: the station table ---------------------------------------------------------------------------------

/** Cowling front face just behind the propeller flange (STA 9.50, s.2.7). */
const FRONT_X = 1.735;
/** Firewall, STA 45.30 (s.2.7): cowling / cabin joint, the windshield's lower edge on the centre line. */
const FIREWALL_X = sta(45.3);
/**
 * The tail cone's end, at the rudder hinge (the visual's rudder fraction): the rudder hangs behind it down to WL
 * 44.90 with its lower aft corner at STA 261.07.
 */
const END_X = -4.2;
/** Door posts (STA 72.78 and 96.78) and the rear window's aft edge, the tail cone joint (STA 134.00), s.2.7. */
const DOOR_FRONT_X = sta(72.78);
const DOOR_REAR_X = sta(96.78);
const CABIN_REAR_X = sta(134.0);
/** Tail cone top, WL 57.00 (s.2.7): level from the rear window to the fin; the fin stands on it. */
const CONE_TOP_Z = V.base.z;
/** Window sill, 0.20 m above the thrust line (s.12). */
const SILL_Z = -0.289;

type Key = [x: number, zTop: number, zBot: number, zMid: number, hw: number, nTop: number, nBot: number, ridge: number];

/**
 * The belly line (s.12): flat under the cabin to the wing trailing edge (xs 2.9), then "the bottom line rises in a
 * straight line to the sternpost" (WL 44.90 at STA 261.07).
 */
function bellyZ(x: number): number {
  if (x >= -0.826) return 0.53;
  return 0.53 + (x + 0.826) * 0.192;
}

/** The roof line over the cabin: the windshield rising from the firewall to the canopy crown over the seats (s.12 rows 5-9). */
const ROOF: readonly (readonly [number, number])[] = [
  [0.7, -0.432],
  [0.55, -0.53],
  [0.31, -0.645],
  [0.1, -0.745],
  [-0.106, -0.789],
  [-0.3, -0.78],
  [DOOR_REAR_X, -0.73],
  [-0.8, -0.645],
  [-1.1, -0.578],
];

function fuselageKeys(): Key[] {
  const nose: Key[] = [
    // Cowl face: flat, close around the spinner backplate, rounding over to the cowling sides within a few
    // centimetres; the two inlets sit on it beside the spinner (s.12 rows 2-3).
    [FRONT_X, -0.225, 0.075, -0.075, 0.15, 2.0, 2.0, 0],
    [1.731, -0.245, 0.17, -0.07, 0.3, 2.6, 2.4, 0],
    [1.718, -0.258, 0.22, -0.065, 0.38, 3.0, 2.7, 0],
    [1.68, -0.266, 0.255, -0.06, 0.42, 3.2, 2.9, 0],
    [1.6, -0.275, 0.3, -0.055, 0.44, 3.3, 3.0, 0],
    // Mid cowl (xs 0.80): rounded rectangle, the deep chin (s.12 row 4).
    [1.274, -0.314, 0.476, -0.04, 0.48, 3.4, 3.2, 0],
    // Firewall (xs 1.26): the cowl top rises a little to the windshield's lower edge (s.12 row 5).
    [FIREWALL_X, -0.379, 0.515, -0.12, 0.52, 3.5, 3.8, 0],
  ];
  // The cabin: flat sides below the sill, a glazed dome above it peaking over the seats (s.12 rows 6-8), the flat
  // belly under it.
  const cabin: Key[] = ROOF.map(([x, top], i): Key => {
    const hw = x > 0.31 ? 0.52 + ((0.7 - x) / 0.39) * 0.04 : x > -0.3 ? 0.56 : 0.56 - ((-0.3 - x) / 0.8) * 0.07;
    const zMid = x > 0.31 ? -0.15 - ((0.7 - x) / 0.39) * 0.14 : SILL_Z;
    return [x, top, bellyZ(x), zMid, hw, i < 2 ? 2.8 : 2.4, x > 0.31 ? 4.2 : 5, 0];
  });
  // The tail cone: a rectangle with rounded corners, a level top, straight sides tapering in plan and the bottom
  // the straight belly line (s.12 rows 9-12).
  const tail: Key[] = [
    [CABIN_REAR_X, CONE_TOP_Z, bellyZ(CABIN_REAR_X), -0.17, 0.465, 3.2, 3.6, 0],
    [-2.316, CONE_TOP_Z, bellyZ(-2.316), -0.14, 0.355, 3.4, 3.4, 0],
    [-3.206, CONE_TOP_Z, bellyZ(-3.206), -0.2, 0.245, 3.4, 3.2, 0],
    [-3.8, CONE_TOP_Z, bellyZ(-3.8), -0.26, 0.16, 3.2, 3.0, 0],
    [END_X, CONE_TOP_Z + 0.01, bellyZ(END_X) - 0.01, -0.31, 0.06, 3.0, 2.8, 0],
  ];
  return [...nose, ...cabin, ...tail];
}

/**
 * Cowling cooling inlets either side of the spinner: rounded rectangles about 0.20 m wide and 0.12 m high (s.12),
 * seen from ahead (a superellipse; the duct behind runs to the baffle).
 */
const inlet = (y: number): AirframeVisualDef['fuselage']['inlets'][number] => ({ y, z: -0.085, w: 0.2, h: 0.12, r: 0.035, exponent: 4 });

const FUSELAGE: AirframeVisualDef['fuselage'] = {
  keys: fuselageKeys(),
  frontX: FRONT_X,
  endX: END_X,
  ridgeW: 0.05,
  grid: { rows: 160, cols: 104 },
  nose: 'prop',
  inlets: [inlet(0.255), inlet(-0.255)],
  // The twin stacks out of the lower right of the cowling (s.4, s.12).
  exhaust: { pos: [0.98, 0.22, 0.5], radius: 0.022 },
  antennas: [
    // The VHF whip on the tail cone top, the ELT whip behind it, the transponder stub under the belly (s.12).
    { kind: 'whip', pos: [-2.0, 0, CONE_TOP_Z], height: 0.6 },
    { kind: 'whip', pos: [-2.75, 0, CONE_TOP_Z], height: 0.32 },
    { kind: 'stub', pos: [-1.0, 0, bellyZ(-1.0) - 0.004], height: 0.09 },
  ],
};

// --- Glazing and door lines (side projection: x, z) ---------------------------------------------------------------

/** The windshield's lower edge: on the centre line at the firewall top, at the sides down to the sill near the door post. */
const SILL_N = ((): readonly [number, number] => {
  const dx = 0.6;
  const dz = 0.085;
  const l = Math.hypot(dx, dz);
  return [dz / l, dx / l];
})();
/** The roof line above the door window, x -> z, and the narrow metal roof left between the door windows. */
const ROOF_BAND = 0.016;
const roofAt = (x: number): number => {
  for (let i = 1; i < ROOF.length; i++) {
    const [x0, z0] = ROOF[i - 1];
    const [x1, z1] = ROOF[i];
    if (x <= x0 && x >= x1) return z0 + ((x - x0) / (x1 - x0)) * (z1 - z0);
  }
  return ROOF[ROOF.length - 1][1];
};

const GLAZING: GlazingDef = {
  cabinFrontX: FIREWALL_X,
  cabinRearX: CABIN_REAR_X,
  firewallX: FIREWALL_X,
  tRange: [0.2, 0.8],
  windows: [
    // Door window: almost the whole door above the sill, its top following the roof.
    {
      pts: [
        [DOOR_FRONT_X - 0.025, SILL_Z],
        [DOOR_FRONT_X - 0.025, roofAt(DOOR_FRONT_X - 0.025) + ROOF_BAND],
        [-0.106, roofAt(-0.106) + ROOF_BAND],
        [-0.3, roofAt(-0.3) + ROOF_BAND],
        [DOOR_REAR_X + 0.035, roofAt(DOOR_REAR_X + 0.035) + ROOF_BAND],
        [DOOR_REAR_X + 0.035, SILL_Z],
      ],
      r: 0.04,
      sides: 'both',
      maxX: DOOR_FRONT_X + 0.05,
    },
    // Rear window: one tinted wrap-around transparency over the top and down both sides, from the rear door post
    // to the tail cone joint (s.2.6, s.12).
    {
      pts: [
        [DOOR_REAR_X - 0.035, SILL_Z + 0.01],
        [DOOR_REAR_X - 0.035, -1.2],
        [CABIN_REAR_X + 0.04, -1.2],
        [CABIN_REAR_X + 0.04, CONE_TOP_Z - 0.015],
        [-1.0, -0.38],
      ],
      r: 0.05,
      sides: 'both',
      maxX: DOOR_REAR_X,
    },
  ],
  // The one-piece wrap-around windshield (s.12): its lower edge from the firewall top on the centre line down to
  // the sill at the sides, aft to the door posts, up to the front of the metal roof.
  windscreen: {
    sillC: [FIREWALL_X - 0.01, -0.385],
    sillN: SILL_N,
    post: [
      [DOOR_FRONT_X + 0.025, -0.28],
      [DOOR_FRONT_X + 0.005, -0.8],
    ],
    postY: 0.3,
    topX: DOOR_FRONT_X - 0.02,
  },
  doors: [
    // Cabin door, both sides, forward hinged at the front post, down to the wing walk; the latch at its aft edge
    // (s.2.6). The joint runs along the roof edge, where the overhead latch meets it.
    {
      pts: [
        [DOOR_FRONT_X, 0.24],
        [DOOR_FRONT_X, roofAt(DOOR_FRONT_X) + 0.006],
        [-0.106, roofAt(-0.106) + 0.006],
        [DOOR_REAR_X, roofAt(DOOR_REAR_X) + 0.006],
        [DOOR_REAR_X, 0.24],
      ],
      r: 0.05,
      sides: 'both',
      handle: { x: DOOR_REAR_X + 0.07, z: -0.11 },
    },
  ],
  // No headliner: the roof between the windows is a narrow metal strip.
  liningRoofLimit: -1e9,
  xRange: [FIREWALL_X + 0.01, CABIN_REAR_X - 0.01],
};

// --- Landing gear: oleo nose leg from the engine mount, flat leaf-spring main legs out of the wing -----------------

/** 6.00-6 tyres on 6-inch rims (s.3). */
const RIM_RADIUS = 0.0762;

const mainWheel = (contact: { x: number; y: number; z: number }, side: 1 | -1): WheelVisualDef => ({
  contact: [contact.x, contact.y, contact.z],
  radius: G.mainWheelRadius,
  // 6.00-6, about 0.16 m wide (s.12).
  width: 0.16,
  rimRadius: RIM_RADIUS,
  // Single steel leaves about 0.10 m wide, leaving the wing underside at about y 1.15 m and running down and out to
  // the axle (s.3, s.12). No wheel fairings as standard.
  leg: { kind: 'leafSpring', root: [contact.x + 0.02, side * 1.15, 0.4], width: 0.1, thickness: 0.026 },
});

const GEAR: AirframeVisualDef['gear'] = [
  {
    contact: [G.nose.x, G.nose.y, G.nose.z],
    radius: G.noseWheelRadius,
    width: 0.16,
    rimRadius: RIM_RADIUS,
    // Near-vertical air-oil oleo on the engine mount, 3 in of chrome showing at rest, scissor link and steering
    // arms, a fork round the exposed wheel (s.3, s.12).
    leg: { kind: 'oleo', top: [G.nose.x + 0.03, 0, 0.32], cylinderLen: 0.3, crownAt: 0.41, forkHalf: 0.095, scissors: true, steers: true },
  },
  mainWheel(G.leftMain, -1),
  mainWheel(G.rightMain, 1),
];

// --- Propeller: Sensenich 72CK-0-56, fixed pitch, clockwise seen from the cockpit -------------------------------

/** Geometric pitch at 0.75 R, m (56 in, s.5). */
const PROP_PITCH = 56 * IN;
const SPINNER_BASE_X = 1.75;

const PROP: PropVisualDef = {
  hub: [P.hub.x, P.hub.y, P.hub.z],
  diameter: P.diameter,
  blades: P.blades,
  rotation: P.rotation,
  // 18.3 degrees at 0.75 R (s.5).
  referencePitch: Math.atan(PROP_PITCH / (2 * Math.PI * 0.75 * (P.diameter / 2))),
  variablePitch: false,
  // Broad aluminium blades, about 0.13 m of chord at mid radius.
  chord: [
    [0.1, 0.065],
    [0.2, 0.1],
    [0.35, 0.128],
    [0.55, 0.135],
    [0.75, 0.124],
    [0.9, 0.1],
    [0.97, 0.072],
    [1.0, 0.03],
  ],
  geometricPitch: PROP_PITCH,
  // A short, pointed metal spinner about 0.26 m across (s.5, s.12).
  spinner: { baseX: SPINNER_BASE_X, radius: 0.13, length: PA38_GEOMETRY.fuselage.noseX - SPINNER_BASE_X },
  // Bare aluminium face, black backs (POH 8.17: anti-glare, seen from the cockpit), white tips.
  paint: { face: [0.55, 0.55, 0.56], back: [0.035, 0.035, 0.037], tip: [0.9, 0.9, 0.88], tipBand: 0.07 },
};

// --- Exterior lamps ------------------------------------------------------------------------------------------------

const LAMPS: readonly LampVisualDef[] = ((): LampVisualDef[] => {
  const wing = makeWingPlanform(WING);
  const onWing = (y: number, xc: number, yc: number, side: 1 | -1): FRD => {
    const p = sectionPoint(wing, y, xc, yc);
    return [p.x, p.y * side, p.z];
  };
  // Navigation light at the front of each tip cap, the strobe just behind it (s.9: wingtip strobes).
  const tipY = TIP_Y - 0.05;
  // The white tail light at the foot of the rudder's trailing edge, swinging with it.
  const foot = sectionPoint(makeRudderPlanform(TAIL), TAIL.v.rudderExtension!.bottomH + 0.04, 1, 0);
  // The beacon on top of the bullet fairing over the fin and tailplane junction (s.12).
  const finTip = sectionPoint(makeFinPlanform(TAIL), FIN_HEIGHT - 0.01, 0.3, 0);
  // Two lenses side by side in the lower nose under the spinner (s.9: landing light in the nose cowl).
  const noseLamp = (y: number): FRD => [1.722, y, 0.15];
  return [
    { id: 'navL', pos: onWing(tipY, 0.06, 0.0, -1), radius: 0.03, glowOffset: [0.035, -0.035, 0] },
    { id: 'navR', pos: onWing(tipY, 0.06, 0.0, 1), radius: 0.03, glowOffset: [0.035, 0.035, 0] },
    { id: 'navTail', pos: [foot.x - 0.015, foot.y, foot.z], radius: 0.022, glowOffset: [-0.03, 0, 0], parent: 'rudder' },
    { id: 'strobeL', pos: onWing(tipY + 0.01, 0.2, 0.0, -1), radius: 0.02, glowOffset: [0, -0.035, 0] },
    { id: 'strobeR', pos: onWing(tipY + 0.01, 0.2, 0.0, 1), radius: 0.02, glowOffset: [0, 0.035, 0] },
    { id: 'beacon', pos: [finTip.x, 0, finTip.z - 0.09], radius: 0.032, glowOffset: [0, 0, -0.04] },
    { id: 'landing', pos: noseLamp(-0.085), radius: 0.04, glowOffset: [0.02, 0, 0], aim: { downDeg: 2.5, outDeg: 0, halfAngleDeg: 9 } },
    { id: 'taxi', pos: noseLamp(0.085), radius: 0.04, glowOffset: [0.02, 0, 0], aim: { downDeg: 6, outDeg: 0, halfAngleDeg: 24 } },
  ];
})();

// --- Cockpit ---------------------------------------------------------------------------------------------------------

// The cockpit is fitted to the pilot's eye of the geometry: the panel top 0.15 m below it, the seat cushion 0.70 m
// below it, so the view over the glareshield is the same whatever the eye height. The fuselage, the windshield and
// the cabin box are the airframe's and do not move with it.
/**
 * Instrument panel face: vertical, facing aft, centred on the centre line (panel.ts), at about STA 64 (s.2.7: the
 * instruments' arms at 61-62 lie ahead of it, the panel frame at 63).
 */
const PANEL_X = 0.34;
const PANEL_ZTOP = EYE.z + 0.15;
const PX = PA38_PANEL_PX_PER_M;
const PANEL_ZB = PANEL_ZTOP + PA38_PANEL_PX_RECT.h / PX;
/** A point of the panel canvas, px, on the face (FRD y, z). */
const faceY = (px: number): number => (px - PA38_PANEL_CENTRE_PX) / PX;
const faceZ = (py: number): number => PANEL_ZTOP + (py - PA38_PANEL_PX_RECT.y) / PX;
/** Forward edge of the glareshield deck, about 5 mm under the windshield's lower edge (GLAZING.windscreen.sillC). */
const GLARESHIELD_FRONT_Z = -0.39;
/** Cabin floor (top of the carpet), over the wing carry-through, about 0.13 m above the belly skin. */
const FLOOR_Z = 0.4;
/** Lateral station of the seats, the control wheels and the pedals: the pilot's eye. */
const SEAT_Y = -EYE.y;
/** The throttle quadrant body (panel.ts PA38_QUADRANT), m on the face. */
const Q = PA38_PANEL_PARTS.quadrant;
const QUADRANT = { y0: faceY(Q.x0), y1: faceY(Q.x1), zTop: faceZ(Q.y0), aftX: PANEL_X - 0.09 };
/**
 * Lever pivots in a slotted housing under the quadrant, far enough aft of its face that the knobs stay in front of
 * it over the whole travel (0.17 m x sin 0.4 rad forward of the pivot, plus the knob).
 */
const LEVER = { x: QUADRANT.aftX - 0.09, z: 0.07 };
/** The console between the seats carrying the flap lever and the trim wheel (s.9). */
const CONSOLE = { x0: 0.24, x1: -0.55, hw: 0.065, top: FLOOR_Z - 0.16 };

const COCKPIT: CockpitDef = {
  pilotEye: [EYE.x, EYE.y, EYE.z],
  /** Default view: 9 degrees nose-down from level, over the deep glareshield to the cowling. */
  defaultPitchDeg: -9,
  enclosure: 'cabin',
  panel: { x: PANEL_X, zTop: PANEL_ZTOP, width: PA38_PANEL_PX_RECT.w / PX, pxRect: PA38_PANEL_PX_RECT },
  floor: { z: FLOOR_Z, x0: FIREWALL_X - 0.01, x1: -0.62 },
  // Padded black glareshield (s.12): panel-top lip, and a long, nearly flat deck forward to the windshield's
  // lower edge on the firewall, about 5 mm below the glazing.
  glareshield: {
    profile: [
      [PANEL_X - 0.03, PANEL_ZTOP - 0.0015],
      [PANEL_X - 0.039, PANEL_ZTOP - 0.01],
      [PANEL_X - 0.034, PANEL_ZTOP - 0.022],
      [PANEL_X, PANEL_ZTOP - 0.027],
      [PANEL_X + 0.15, PANEL_ZTOP - 0.027 + 0.4 * (GLARESHIELD_FRONT_Z - PANEL_ZTOP + 0.027) - 0.004],
      [FIREWALL_X - 0.04, GLARESHIELD_FRONT_Z],
      [FIREWALL_X - 0.02, GLARESHIELD_FRONT_Z + 0.007],
      [FIREWALL_X - 0.02, GLARESHIELD_FRONT_Z + 0.03],
      [PANEL_X + 0.03, PANEL_ZTOP + 0.0015],
      [PANEL_X, PANEL_ZTOP - 0.0015],
    ],
    halfWidth: 0.5,
  },
  // Two individual seats on inclined tracks (s.12), slid to where the pilot's eye sits over the rear of the
  // cushion. x is the cushion's front edge, z its top.
  seats: [
    { x: EYE.x + 0.31, y: -SEAT_Y, kind: 'front', width: 0.42, depth: 0.44, z: EYE.z + 0.7, reclineDeg: 14 },
    { x: EYE.x + 0.31, y: SEAT_Y, kind: 'front', width: 0.42, depth: 0.44, z: EYE.z + 0.7, reclineDeg: 14 },
  ],
  consoles: [
    // Structure under the lower edge of the panel, toward the firewall (knee room under it).
    {
      min: [PANEL_X + 0.002, -0.5, PANEL_ZB - 0.005],
      max: [PANEL_X + 0.17, 0.5, PANEL_ZB + 0.14],
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
    // The throttle quadrant in front of the lower centre of the panel, reachable from both seats (s.9): throttle
    // on the left, fuel selector in the middle, mixture on the right, the carburettor heat lever at its left edge.
    { min: [QUADRANT.aftX, QUADRANT.y0, QUADRANT.zTop], max: [PANEL_X + 0.01, QUADRANT.y1, PANEL_ZB + 0.12], bevel: 0.012, material: 'black' },
    // Its lower part runs aft under the levers, the throttle and mixture standing up out of slots in its top.
    { min: [LEVER.x - 0.03, QUADRANT.y0, LEVER.z - 0.005], max: [QUADRANT.aftX + 0.01, QUADRANT.y1, PANEL_ZB + 0.12], bevel: 0.012, material: 'black' },
    // The narrow console between the seats, the flap lever at its front and the trim wheel behind it (s.9).
    { min: [CONSOLE.x1, -CONSOLE.hw, CONSOLE.top], max: [CONSOLE.x0, CONSOLE.hw, FLOOR_Z], bevel: 0.015, material: 'trimPlastic' },
    // The open baggage shelf behind the seats under the rear window (s.2.6, s.12).
    { min: [-1.3, -0.42, 0.12], max: [-0.66, 0.42, 0.3], bevel: 0.012, material: 'carpet' },
  ],
  // Both sides. Door: plastic moulding with an armrest and a map pocket; a kick panel ahead of the door under the
  // windshield's side; the panel under the rear window, aft of the door.
  trimPanels: [
    {
      side: 0, x0: DOOR_FRONT_X - 0.01, x1: DOOR_REAR_X + 0.02, z0: SILL_Z + 0.02, z1: 0.3, relief: 0.011, material: 'trimPlastic',
      grid: { rows: 48, cols: 44 },
      edge: 0.025,
      armrest: { xa: -0.42, xb: 0.02, zc: -0.06, hz: 0.04, height: 0.05, taper: 0.08 },
      pocket: { x0: 0.06, x1: -0.38, zTop: 0.12, depth: 0.12, lip: 0.022 },
    },
    { side: 0, x0: FIREWALL_X - 0.005, x1: DOOR_FRONT_X + 0.005, z0: -0.2, z1: FLOOR_Z + 0.025, relief: 0.008, material: 'panelPlastic', grid: { rows: 28, cols: 36 }, edge: 0.015, openBelow: true },
    { side: 0, x0: DOOR_REAR_X - 0.02, x1: CABIN_REAR_X + 0.06, z0: -0.33, z1: 0.3, relief: 0.008, material: 'trimPlastic', grid: { rows: 36, cols: 30 }, edge: 0.02 },
  ],
  // Two ram's-horn control wheels on shafts through the panel (s.9): neutral end position, fore-aft travel for
  // full elevator input, maximum rotation.
  column: { kind: 'yoke', x: PANEL_X - 0.18, y: SEAT_Y, z: faceZ(PA38_PANEL_PARTS.yokes.y), travel: 0.07, rollDeg: 40 },
  pedals: { x: 0.62, ys: [-SEAT_Y, SEAT_Y] },
  // Quadrant levers (s.9): the large cylindrical throttle knob, the red scalloped mixture knob, the small
  // carburettor heat lever on the quadrant's left edge (down = ON).
  engineControls: [
    { kind: 'lever', control: 'carbHeat', engine: 0, pos: [QUADRANT.aftX - 0.006, QUADRANT.y0 - 0.012, LEVER.z - 0.04], travel: 0.5, colour: 'black', length: 0.08 },
    { kind: 'lever', control: 'throttle', engine: 0, pos: [LEVER.x, -0.042, LEVER.z], travel: 0.8, colour: 'black', length: 0.17 },
    { kind: 'lever', control: 'mixture', engine: 0, pos: [LEVER.x, 0.042, LEVER.z], travel: 0.8, colour: 'red', length: 0.17 },
  ],
  // The hand flap lever between the seats, pulled up through 21 to 34 degrees (s.9).
  flapControl: { kind: 'floorLever', pos: [CONSOLE.x0 - 0.06, 0, CONSOLE.top], travel: 0.7 },
  // The elevator trim wheel on the console behind the flap lever, forward = nose down (s.9).
  trimWheel: { pos: [0.02, 0, CONSOLE.top - 0.01], axis: 'y' },
  // The fuel selector handle in the middle of the quadrant, LEFT / RIGHT / OFF (no BOTH; s.3, s.9), and the parking
  // brake handle hanging under the quadrant, pulled to set (s.9).
  fuelSelectorHandle: { pos: [QUADRANT.aftX - 0.002, 0, faceZ(680)], angles: { left: -45, right: 45, off: 180 } },
  parkingBrakeHandle: { pos: [PANEL_X - 0.06, 0, PANEL_ZB + 0.15], travel: 0.05 },
  // Magnetic compass at the top centre of the windshield, hung from the front of the metal roof strip (s.9); its
  // bracket (0.125 m above pos) stays under the roof skin.
  compass: { pos: [DOOR_FRONT_X - 0.065, 0, -0.615] },
  fittings: {
    // The defrost outlet slots on the glareshield deck just aft of the windshield.
    defrosters: [
      [FIREWALL_X - 0.07, -0.2, GLARESHIELD_FRONT_Z - 0.003],
      [FIREWALL_X - 0.07, 0.2, GLARESHIELD_FRONT_Z - 0.003],
    ],
    // Door handle at the armrest's front end; the fresh-air outlet at the lower corner of the panel (s.9).
    doorHandle: [0.0, -0.1],
    airOutlet: [PANEL_X - 0.02, 0.0],
    // The floor carpet runs up the firewall behind the pedals.
    toeBoard: { x0: 0.56, x1: FIREWALL_X - 0.01, z: 0.24 },
  },
  // Flood light under the metal roof strip aimed at the panel; dome light over the baggage shelf.
  lamps: { flood: { pos: [-0.02, 0, -0.73], aim: [PANEL_X, -0.12, -0.25] }, dome: { pos: [-0.62, 0, -0.71] } },
  // Simplified cabin for the occlusion bake: floor, roof, flat sides, aft bulkhead, panel face and glareshield, the
  // windshield's lower edge (forward of the panel). The roof is mostly glass.
  box: { floor: FLOOR_Z, roof: -0.77, side: 0.53, rear: CABIN_REAR_X + 0.04, panelX: PANEL_X, glareshieldZ: PANEL_ZTOP - 0.02, sillZ: -0.385, windscreenX: FIREWALL_X - 0.01, roofGlazed: true },
  // Outward unit normals and areas, m^2, from the window outlines.
  glazingPanels: [
    { n: [0.45, 0, -0.89], area: 0.95 }, // the wrap-around windshield
    { n: [0, -1, 0], area: 0.3 }, // left door window
    { n: [0, 1, 0], area: 0.3 },
    { n: [-0.55, 0, -0.83], area: 0.85 }, // the wrap-around rear window
  ],
  // Floor, roof strip, sides, panel, bulkhead and seats, less the glazing.
  interiorArea: 8,
  // The fuel selector in the middle of the quadrant, the parking brake handle hanging under it (s.3, s.9; drawn by
  // fuelSelectorHandle and parkingBrakeHandle).
  controlPoints: {
    fuelSelector: [QUADRANT.aftX - 0.005, 0, faceZ(680)],
    parkingBrake: [PANEL_X - 0.06, 0, PANEL_ZB + 0.15],
  },
};

// --- Paint: a 1981 factory scheme, representative (s.12) ------------------------------------------------------------

const LIVERY: LiveryDef = {
  registration: 'N2438T',
  // White overall, a dark blue side stripe with a light blue line along it (s.12).
  palette: { base: [240, 240, 236], band: [30, 52, 112], accent: [92, 150, 205] },
  // From the cowling behind the spinner along the side under the window line to the tail, sweeping up toward the
  // fin; its nose end is sheared so that it sweeps.
  stripe: {
    xs: [END_X, -3.6, -3.0, -2.4, -1.8, -1.2, -0.5, 0.3, 0.9, 1.4, 1.72],
    centre: [-0.44, -0.4, -0.355, -0.31, -0.27, -0.235, -0.2, -0.185, -0.16, -0.125, -0.1],
    half: [0.03, 0.033, 0.036, 0.04, 0.043, 0.046, 0.048, 0.048, 0.046, 0.04, 0.035],
    noseShearX: 1.66,
  },
  // The registration on the tail cone sides between the rear window and the fin, under the stripe (s.12).
  lettering: { x0: -3.1, x1: -1.75, z0: -0.235, z1: -0.02 },
  construction: 'metal',
  // Tail-cone skin joints at the frames (STA 134.00, 160.25, 188.00, 221.42), the cowling's split line between
  // the metal upper and the glass-fibre lower half, the exhaust the soot streaks aft from.
  skinJoints: [CABIN_REAR_X, sta(160.25), sta(188.0), sta(221.42)],
  cowlSplitZ: -0.03,
  soot: { x: 0.95, y: 0.22 },
  // The carburettor-air chin scoop under the spinner, the oil filler door in the cowl top; the rivet row along the
  // cabin floor line.
  cowl: {
    grille: { x: 1.7, z0: 0.205, z1: 0.245, halfWidth: 0.075 },
    oilDoor: { x: 1.16, halfLength: 0.08, halfWidth: 0.07 },
  },
  floorRivets: { z: 0.42, x1: CABIN_REAR_X },
  // The fin band continues the stripe's sweep: z = bandZ0 + (x - bandX0) * slope; the fin cap in the stripe colour.
  fin: { bandZ0: -1.0, bandX0: -4.2, slope: 0.44, cap: 0.12 },
  // The two-seaters may use the smaller texture.
  texture: { w: 2048, h: 1024 },
};

export const PA38_VISUAL: AirframeVisualDef = {
  id: 'pa38',
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
    halfX: 5.8,
    halfY: 6.0,
    // Belly band: centre x, half length, half width (cowling to tail cone).
    fuselage: [-1.25, 3.0, 0.55],
    // Wing band: centre x (mid chord), half span of its core, and the height of the wing above the ground (a low
    // wing: a dark, sharp band).
    wingX: -0.28,
    wingY: 4.6,
    wingHeight: PA38_GEOMETRY.restHeight - W.quarterChord.z,
    restHeight: PA38_GEOMETRY.restHeight,
  },
};

export default PA38_VISUAL;
