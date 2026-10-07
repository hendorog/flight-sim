// Cessna 152 (1978 model): the airframe as data for the 3D model, the cameras and the livery worker. PLAIN and
// structured-cloneable: no three.js, no functions, no class instances (the worker imports this file through
// aircraft/visualLoader.ts and nothing else of the aircraft).
//
// What the flight model and the picture must agree on (planforms, wheel contact points, the propeller disc, the
// eye point) comes from ./geometry; the panel's pixel layout from ./panel. Everything else is shaped here from the
// type's engineering data sheet (aircraft-data/c152.md in the design work folder; "s.N" is its section N, s.12
// the appearance): the fuselage station table, the glazing and door outlines, the paint, the cabin. Positions
// are FRD metres from the reference point; a station "xs" of s.12 (metres aft of the spinner tip) is
// x = 1.99 - xs, and a height there above the thrust line h is z = 0.10 - h. Colours: the livery palette is sRGB
// 0..255, the propeller paint sRGB 0..1.
//
// The type against the C172S: a smaller, slimmer two-seater on the same wing section and root chord; a short
// nose sloping down to a flat cowl face with two rectangular inlets and the landing lights under the spinner;
// one door window and a tapering rear side window each side; a wrap-around rear window down the steep back of
// the cabin; a long low dorsal strake into a swept fin; unfaired tubular main legs; a two-seat cabin with a
// carpeted baggage shelf, the engine controls and the flap lever across the lower centre of the panel.

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
import { C152_GEOMETRY } from './geometry';
import { C152_KNOBS, C152_PARKING_BRAKE, C152_PANEL_CENTRE_PX, C152_PANEL_PARTS, C152_PANEL_PX_PER_M, C152_PANEL_PX_RECT } from './panel';

const W = C152_GEOMETRY.wing;
const H = C152_GEOMETRY.hTail;
const V = C152_GEOMETRY.vTail;
const G = C152_GEOMETRY.gear;
const P = C152_GEOMETRY.propellers[0];
const EYE = C152_GEOMETRY.fuselage.pilotEye;

/** NACA 2412 at the root (the tip is 0012 in the flight model; the contour keeps the root section). */
const NACA2412: SectionShape = { m: 0.02, p: 0.4, t: 0.12 };
/** Thin symmetric tail sections, about NACA 0009 (s.2.2, s.2.3). */
const NACA0009: SectionShape = { m: 0, p: 0.4, t: 0.09 };

// --- Wing: constant-chord centre panel to the strut rib, tapered outer panel, strut braced ----------------------

const TIP_Y = W.span / 2;

const WING: WingVisualDef = {
  mount: 'high',
  section: NACA2412,
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
  // Single-slotted "Para-Lift" flap on tracks (s.2.1): about a quarter of its chord aft at full deflection.
  flap: { maxDeflection: W.flap.maxDeflection, travelAft: 0.13, travelDown: 0.04 },
  // Glass-fibre conical-camber tips, slightly rounded in plan (s.2.1, s.12).
  tip: { round: 0.16, chordRound: 0.1 },
  // One streamlined strut a side, about 0.11 m chord (s.2.1). The fitting on the fuselage is drawn a little
  // outboard of and below the geometry's attach point: the strut's root fairing starts inside the end point and
  // flares, and from the geometry's point it stood through the cabin sidewall into the footwells.
  strut: {
    fuselage: [W.strut!.fuselage.x, 0.56, 0.46],
    wing: [W.strut!.wing.x, W.strut!.wing.y, W.strut!.wing.z],
    chord: 0.11,
    tc: 0.34,
  },
  // Filler caps on top of the tanks at about y 1.0 m; the pitot mast under the left wing near the strut station (s.12).
  fuelCaps: [{ y: 1.0, xc: 0.34, side: 'both' }],
  pitot: { side: -1, y: 2.35, xc: 0.18 },
};

// --- Tail: fixed stabiliser with elevators, swept fin and rudder on a long dorsal strake -------------------------

/** Height of the fin from its base to its tip quarter-chord point (the fin planform's span parameter), m. */
const FIN_HEIGHT = V.base.z - V.tip.z;

const TAIL: TailVisualDef = {
  section: NACA0009,
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
    innerCutY: 0.16,
    // "The entire trailing edge of the right half is hinged" (POH sect. 7): the trim tab along the right elevator.
    tab: { y0: 0.2, y1: 1.3, xc: 0.92, sides: 'right' },
  },
  v: {
    base: { x: V.base.x, z: V.base.z },
    tip: { x: V.tip.x, z: V.tip.z },
    rootChord: V.rootChord,
    tipChord: V.tipChord,
    rudderChordFraction: V.rudder.chordFraction,
    // The rudder runs on below the fin base behind the tail cone, its trailing edge ending at the tail cone's end
    // (s.2.3: rudder bottom trailing edge FS 221).
    rudderExtension: { bottomH: -0.14, aftChord: 0.48 },
  },
  tTail: false,
  // A low triangular strake on the tail cone top, from just behind the rear window to about 0.10 m high at the fin
  // leading edge (s.12).
  dorsalFillet: { x0: -1.85, height: 0.1 },
  // The VOR "cat-whisker" dipole near the top of the fin (s.12).
  vorAntenna: true,
};

// --- Fuselage: the station table ---------------------------------------------------------------------------------

/** Cowling face just behind the propeller plane (s.12: spinner base, propeller plane and cowl face at xs 0.22). */
const FRONT_X = 1.735;
/** Tail cone end below the rudder (FS 221; the aero body ends here too). */
const END_X = -4.76;
/** Firewall station (FS 0; cowling / cabin joint). */
const FIREWALL_X = 0.85;
/** Aft cabin bulkhead, the end of the rear window (FS 95): the cabin's glazing and lining end here. */
const CABIN_REAR_X = -1.56;
/** Half the cabin width at the door sill (s.2.4: 1.02 m), which is also the wing's root station. */
const HW = C152_GEOMETRY.fuselage.maxWidth / 2;

type Key = [x: number, zTop: number, zBot: number, zMid: number, hw: number, nTop: number, nBot: number, ridge: number];

/**
 * The belly line (s.12): level under the cabin from the firewall to the main gear bulkhead (FS 56.7), then "the
 * belly rises in a straight line from the main gear to the tail".
 */
function bellyZ(x: number): number {
  if (x >= -0.59) return 0.655;
  return 0.655 + (x + 0.59) * 0.149;
}

function fuselageKeys(): Key[] {
  const nose: Key[] = [
    // Nose cap: a flat face close around the spinner backplate, rounding over to the flat cowling sides within
    // a few centimetres (the inlets sit on the flat face and its rounded edge; s.12 "flat front nose cap").
    [FRONT_X, -0.06, 0.27, 0.11, 0.17, 2.0, 2.0, 0],
    [1.731, -0.085, 0.31, 0.12, 0.3, 2.6, 2.4, 0],
    [1.718, -0.098, 0.345, 0.125, 0.38, 3.0, 2.7, 0],
    [1.68, -0.106, 0.37, 0.13, 0.425, 3.2, 2.9, 0],
    [1.58, -0.115, 0.405, 0.14, 0.445, 3.3, 3.0, 0],
    // Mid cowl (xs 0.70): flat sides, slightly domed top; the lower cowl deepens toward the nose gear.
    [1.29, -0.145, 0.53, 0.16, 0.473, 3.4, 3.1, 0],
    // Firewall (xs 1.14).
    [FIREWALL_X, -0.18, 0.64, 0.12, 0.485, 3.6, 3.4, 0],
    // Windshield: the top line rakes up to the wing leading edge at the roof.
    [0.78, -0.205, 0.648, 0.08, 0.495, 3.8, 3.8, 0],
    [0.66, -0.33, 0.652, 0.06, HW - 0.002, 4.0, 4.1, 0],
    [0.53, -0.47, 0.655, 0.05, HW, 4.4, 4.4, 0],
  ];
  // Between the wing roots the roof follows the root airfoil's upper surface (the flat cabin-top fairing between
  // the root ribs, s.12).
  const wingRoot: Key[] = [];
  const wing = makeWingPlanform(WING);
  const p = { x: 0, y: 0, z: 0 };
  for (const xc of [0, 0.02, 0.06, 0.12, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0]) {
    const [ax, ay] = xc === 0 ? [0, 0] : surfacePoint(WING.section, xc, 1);
    sectionPoint(wing, WING.rootY, ax, ay, p);
    // Boxy top corners so the roof meets the wing roots squarely instead of forming a hump.
    wingRoot.push([p.x, p.z + 0.003, bellyZ(p.x), 0.05, HW, 9, 4.5, 0]);
  }
  // Behind the wing the roof drops steeply under the rear window to the tail cone top; the tail cone is an upright
  // oval with flat-ish sides, its top line nearly level, its bottom the straight belly line (s.12 table).
  const tail: Key[] = [
    [-1.32, -0.55, bellyZ(-1.32), 0.08, 0.47, 4.0, 3.8, 0],
    [-1.44, -0.35, bellyZ(-1.44), 0.11, 0.42, 3.4, 3.4, 0],
    [-1.57, -0.19, bellyZ(-1.57), 0.14, 0.37, 2.9, 3.0, 0],
    [-1.9, -0.17, bellyZ(-1.9), 0.13, 0.33, 2.7, 2.8, 0],
    [-2.54, -0.148, bellyZ(-2.54), 0.08, 0.25, 2.5, 2.6, 0],
    [-3.1, -0.135, bellyZ(-3.1), 0.04, 0.19, 2.4, 2.4, 0],
    [-3.56, -0.126, bellyZ(-3.56), 0.012, 0.137, 2.3, 2.3, 0],
    [-4.0, -0.114, bellyZ(-4.0), -0.015, 0.088, 2.2, 2.2, 0],
    [-4.35, -0.102, bellyZ(-4.35) - 0.006, -0.03, 0.05, 2.2, 2.2, 0],
    [END_X, -0.07, -0.01, -0.04, 0.016, 2.2, 2.2, 0],
  ];
  return [...nose, ...wingRoot, ...tail];
}

/**
 * Cowling cooling inlets either side of the spinner: roughly rectangular with rounded corners, each about 0.25 m
 * wide and 0.10 m high (s.12), seen from ahead (a superellipse; the duct behind runs to the baffle).
 */
const inlet = (y: number): AirframeVisualDef['fuselage']['inlets'][number] => ({ y, z: 0.075, w: 0.21, h: 0.095, r: 0.03, exponent: 4 });

const FUSELAGE: AirframeVisualDef['fuselage'] = {
  keys: fuselageKeys(),
  frontX: FRONT_X,
  endX: END_X,
  ridgeW: 0.05,
  grid: { rows: 160, cols: 104 },
  nose: 'prop',
  inlets: [inlet(0.26), inlet(-0.26)],
  // The exhaust stub at the lower right near the firewall (s.12).
  exhaust: { pos: [0.98, 0.2, 0.6], radius: 0.022 },
  antennas: [
    // A white com whip on the cabin roof over the wing carry-through; the ELT whip on the tail cone behind the rear
    // window; the transponder stub under the belly (s.12).
    { kind: 'whip', pos: [-0.55, 0, -0.735], height: 0.62 },
    { kind: 'whip', pos: [-2.15, 0, -0.16], height: 0.36 },
    { kind: 'stub', pos: [-0.95, 0, bellyZ(-0.95) - 0.004], height: 0.09 },
  ],
};

// --- Glazing and door lines (side projection: x, z) ---------------------------------------------------------------

/** Unit normal of the windscreen's sill plane. */
const SILL_N = ((): readonly [number, number] => {
  const nx = 0.17;
  const nz = 0.21;
  const l = Math.hypot(nx, nz);
  return [nx / l, nz / l];
})();

/** The windshield post (A-pillar) line on the side: from the cowl deck up to the wing leading edge at the roof. */
const POST: readonly [readonly [number, number], readonly [number, number]] = [
  [0.79, -0.1],
  [0.42, -0.6],
];
/** x of the post line at height z, moved aft by `back`. */
const postX = (z: number, back = 0): number => POST[0][0] + ((z - POST[0][1]) / (POST[1][1] - POST[0][1])) * (POST[1][0] - POST[0][0]) - back;

/** Door window sill (0.25 m above the thrust line, s.12) and the top of the side glass under the wing. */
const SILL_Z = -0.15;
const GLASS_TOP_Z = -0.565;
/** Rear door post / main gear bulkhead (FS 56.69). */
const REAR_POST_X = -0.59;

const GLAZING: GlazingDef = {
  cabinFrontX: FIREWALL_X,
  cabinRearX: CABIN_REAR_X,
  firewallX: FIREWALL_X,
  tRange: [0.2, 0.8],
  windows: [
    // Door window, nearly rectangular, its front edge parallel to the windshield post.
    {
      pts: [
        [postX(SILL_Z, 0.04), SILL_Z],
        [postX(GLASS_TOP_Z, 0.04), GLASS_TOP_Z],
        [REAR_POST_X + 0.05, GLASS_TOP_Z],
        [REAR_POST_X + 0.05, SILL_Z],
      ],
      r: 0.025,
      sides: 'both',
      maxX: 0.8,
    },
    // Rear side window: a "D" behind the rear door post, tapering in height toward the rear (s.12).
    {
      pts: [
        [REAR_POST_X - 0.06, SILL_Z],
        [REAR_POST_X - 0.06, GLASS_TOP_Z],
        [-1.12, GLASS_TOP_Z + 0.01],
        [-1.42, -0.27],
        [-1.42, SILL_Z],
      ],
      r: 0.04,
      sides: 'both',
      maxX: -0.55,
    },
    // Rear window: one wrap-around transparency over the sloping back of the cabin, from the wing trailing edge
    // down to the tail cone top (s.12).
    {
      pts: [
        [-1.25, -1.2],
        [-1.25, -0.6],
        [-1.48, -0.3],
        [-1.6, -0.2],
        [-1.6, -1.2],
      ],
      r: 0.04,
      sides: 'both',
      maxX: -1.2,
    },
  ],
  // Bounded below by a plane through the cowl deck (centre) and the lower corners, aft by the post line (on the
  // sides only: inboard of postY the glass is on the cabin top), above by the wing leading edge.
  windscreen: {
    sillC: [0.775, -0.212],
    sillN: SILL_N,
    post: POST,
    postY: 0.42,
    topX: 0.4,
  },
  doors: [
    // Cabin door, both sides, forward hinged: its front edge follows the windshield rake; the recessed handle at
    // its aft edge (s.12).
    {
      pts: [
        [0.79, 0.3],
        [0.81, -0.06],
        [postX(-0.585, -0.01), -0.585],
        [REAR_POST_X + 0.015, -0.585],
        [REAR_POST_X + 0.015, 0.3],
      ],
      r: 0.06,
      sides: 'both',
      handle: { x: REAR_POST_X + 0.1, z: -0.04 },
    },
  ],
  // The headliner sits just under the wing root.
  liningRoofLimit: -0.6,
  xRange: [0.84, -1.6],
  // Fabric stretched between transverse bows from the windscreen header to the rear window.
  headliner: { x0: 0.4, x1: -1.22, z0: -0.5, z1: -0.56, pitch: 0.27 },
};

// --- Landing gear: oleo nose strut, one-piece tapered tubular spring-steel main legs, no fairings ---------------

const MAIN_RIM_RADIUS = 0.0762;
const NOSE_RIM_RADIUS = 0.0635;

const mainWheel = (contact: { x: number; y: number; z: number }, side: 1 | -1): WheelVisualDef => ({
  contact: [contact.x, contact.y, contact.z],
  radius: G.mainWheelRadius,
  // 6.00-6 tyre, about 0.16 m wide (s.3).
  width: 0.155,
  rimRadius: MAIN_RIM_RADIUS,
  // "Land-O-Matic" legs (s.3, s.12): about 45 mm at the fuselage, 30 mm at the axle, leaving the lower fuselage at
  // the rear door post and running outward, downward and forward to the axle. Trainers fly without wheel fairings.
  leg: { kind: 'springTube', root: [-0.59, side * 0.4, 0.6], axleOffset: 0.1, r0: 0.0225, r1: 0.015 },
});

const GEAR: AirframeVisualDef['gear'] = [
  {
    contact: [G.nose.x, G.nose.y, G.nose.z],
    radius: G.noseWheelRadius,
    // 5.00-5 tyre, about 0.125 m wide (s.3).
    width: 0.125,
    rimRadius: NOSE_RIM_RADIUS,
    // Vertical air/oil strut on the engine mount, chrome piston, torque links at the rear, two-sided fork (s.12).
    leg: { kind: 'oleo', top: [1.13, 0, 0.45], cylinderLen: 0.21, crownAt: 0.52, forkHalf: 0.07, scissors: true, steers: true },
  },
  mainWheel(G.leftMain, -1),
  mainWheel(G.rightMain, 1),
];

// --- Propeller: McCauley 1A103/TCM6958, fixed pitch, clockwise seen from the cockpit -----------------------------

/** Geometric pitch at 0.75 R, m (the "58" of 6958, inches; s.5). */
const PROP_PITCH = 58 * 0.0254;
const SPINNER_BASE_X = 1.745;

const PROP: PropVisualDef = {
  hub: [P.hub.x, P.hub.y, P.hub.z],
  diameter: P.diameter,
  blades: P.blades,
  rotation: P.rotation,
  // 19.6 degrees at 0.75 R (s.5).
  referencePitch: Math.atan(PROP_PITCH / (2 * Math.PI * 0.75 * (P.diameter / 2))),
  variablePitch: false,
  // About 0.13 m of chord at mid radius (s.12).
  chord: [
    [0.1, 0.065],
    [0.2, 0.095],
    [0.35, 0.125],
    [0.55, 0.133],
    [0.75, 0.122],
    [0.9, 0.098],
    [0.97, 0.07],
    [1.0, 0.03],
  ],
  geometricPitch: PROP_PITCH,
  // A pointed, slightly ogival spinner about 0.27 m across the base (s.12).
  spinner: { baseX: SPINNER_BASE_X, radius: 0.135, length: C152_GEOMETRY.fuselage.noseX - SPINNER_BASE_X },
  // Satin grey thrust face, matt black back (anti-glare, seen from the cockpit), coloured tips.
  paint: { face: [0.5, 0.5, 0.51], back: [0.035, 0.035, 0.037], tip: [0.85, 0.12, 0.1], tipBand: 0.07 },
};

// --- Exterior lamps ------------------------------------------------------------------------------------------------

const LAMPS: readonly LampVisualDef[] = ((): LampVisualDef[] => {
  const wing = makeWingPlanform(WING);
  const onWing = (y: number, xc: number, yc: number, side: 1 | -1): FRD => {
    const p = sectionPoint(wing, y, xc, yc);
    return [p.x, p.y * side, p.z];
  };
  // Navigation light at the front of each tip, the strobe just behind it (s.12).
  const tipY = TIP_Y - 0.05;
  // The white tail light on top of the rudder (POH sect. 7: "wing tips and top of the rudder"), swinging with it.
  const tail = sectionPoint(makeRudderPlanform(TAIL), FIN_HEIGHT - 0.06, 1, 0);
  // The red beacon on the fin tip, at its front (s.12).
  const finTip = sectionPoint(makeFinPlanform(TAIL), FIN_HEIGHT - 0.01, 0.25, 0);
  // Two lenses side by side in the nose cap under the spinner (the optional dual landing / taxi installation, s.9).
  const noseLamp = (y: number): FRD => [FRONT_X - 0.004, y, 0.285];
  // Glow offsets put the sprite on the outer face of each lens, clear of the skin around it.
  return [
    { id: 'navL', pos: onWing(tipY, 0.06, 0.0, -1), radius: 0.03, glowOffset: [0.035, -0.035, 0] },
    { id: 'navR', pos: onWing(tipY, 0.06, 0.0, 1), radius: 0.03, glowOffset: [0.035, 0.035, 0] },
    { id: 'navTail', pos: [tail.x - 0.015, tail.y, tail.z], radius: 0.02, glowOffset: [-0.03, 0, 0], parent: 'rudder' },
    { id: 'strobeL', pos: onWing(tipY + 0.01, 0.2, 0.0, -1), radius: 0.02, glowOffset: [0, -0.035, 0] },
    { id: 'strobeR', pos: onWing(tipY + 0.01, 0.2, 0.0, 1), radius: 0.02, glowOffset: [0, 0.035, 0] },
    { id: 'beacon', pos: [finTip.x, 0, finTip.z - 0.03], radius: 0.032, glowOffset: [0, 0, -0.04] },
    { id: 'landing', pos: noseLamp(-0.075), radius: 0.04, glowOffset: [0.02, 0, 0], aim: { downDeg: 2.5, outDeg: 0, halfAngleDeg: 9 } },
    { id: 'taxi', pos: noseLamp(0.075), radius: 0.04, glowOffset: [0.02, 0, 0], aim: { downDeg: 6, outDeg: 0, halfAngleDeg: 24 } },
  ];
})();

// --- Cockpit ---------------------------------------------------------------------------------------------------------

// The cockpit is fitted to the pilot's eye of the geometry: the panel top 0.15 m below it (the C172S: 0.14), the
// seat cushion 0.70 m below it, so the view over the glareshield and the cowling is the same whatever the eye
// height. The fuselage, the windshield and the cabin box are the airframe's and do not move with it.
/** Instrument panel face: vertical, facing aft, centred on the aircraft centreline, 0.40 m tall (panel.ts). */
const PANEL_X = 0.45;
const PANEL_ZTOP = EYE.z + 0.15;
const PX = C152_PANEL_PX_PER_M;
const PANEL_ZB = PANEL_ZTOP + C152_PANEL_PX_RECT.h / PX;
/** A point of the panel canvas, px, on the face (FRD y, z). */
const faceY = (px: number): number => (px - C152_PANEL_CENTRE_PX) / PX;
const faceZ = (py: number): number => PANEL_ZTOP + (py - C152_PANEL_PX_RECT.y) / PX;
/** Forward edge of the glareshield hood, about 5 mm under the windshield's lower edge (GLAZING.windscreen.sillC). */
const GLARESHIELD_FRONT_Z = -0.207;
/** Cabin floor (top of the carpet), about 0.1 m above the belly skin. */
const FLOOR_Z = 0.56;
/** Lateral station of the seats, the control wheels and the pedals: the pilot's eye (s.2.5). */
const SEAT_Y = -EYE.y;
/** The low seat backs without headrests of the two side-by-side seats (s.12; review-D-c152-visual F3). */
const LOW_BACK = { height: 0.42, headrest: false };
/** Stations and heights of the door panel (the door's inner skin below the window). */
const DOOR = { x0: 0.78, x1: REAR_POST_X + 0.02, z0: SILL_Z + 0.02, z1: 0.3 };
/** The padded insert on the lower door. */
const INSERT = { x0: 0.68, x1: REAR_POST_X + 0.1, z0: 0.06, z1: 0.27 };
/** Front of the carpeted baggage shelf behind the seats, and the aft cabin bulkhead. */
const SHELF_X = -0.72;

const COCKPIT: CockpitDef = {
  pilotEye: [EYE.x, EYE.y, EYE.z],
  /** Default view: 9 degrees nose-down from level, over the glareshield, with the tops of the wheels in view. */
  defaultPitchDeg: -9,
  enclosure: 'cabin',
  panel: { x: PANEL_X, zTop: PANEL_ZTOP, width: C152_PANEL_PX_RECT.w / PX, pxRect: C152_PANEL_PX_RECT },
  // The cabin floor ends at the baggage shelf, where the belly line rises above it.
  floor: { z: FLOOR_Z, x0: 0.8, x1: SHELF_X - 0.1 },
  // Padded black hood with a shallow curve (s.12): panel-top lip, padded top, and forward under the windshield's
  // lower edge about 5 mm below the glazing, so no lining shows between the hood and the glass.
  glareshield: {
    profile: [
      [PANEL_X - 0.03, PANEL_ZTOP - 0.0015],
      [PANEL_X - 0.039, PANEL_ZTOP - 0.01],
      [PANEL_X - 0.034, PANEL_ZTOP - 0.022],
      [PANEL_X, PANEL_ZTOP - 0.027],
      // The padded top, a shallow curve from the lip down (or up) to the windshield.
      [PANEL_X + 0.15, PANEL_ZTOP - 0.027 + 0.45 * (GLARESHIELD_FRONT_Z - PANEL_ZTOP + 0.027) - 0.006],
      [0.77, GLARESHIELD_FRONT_Z],
      [0.79, GLARESHIELD_FRONT_Z + 0.007],
      [0.79, GLARESHIELD_FRONT_Z + 0.022],
      [PANEL_X + 0.03, PANEL_ZTOP + 0.0015],
      [PANEL_X, PANEL_ZTOP - 0.0015],
    ],
    halfWidth: 0.47,
  },
  // Two side-by-side seats with low backs (s.12), slid to where the pilot's eye sits over the rear of the cushion.
  // x is the cushion's front edge, z its top.
  seats: [
    { x: 0.22, y: -SEAT_Y, kind: 'front', width: 0.4, depth: 0.42, z: EYE.z + 0.7, reclineDeg: 14, back: LOW_BACK },
    { x: 0.22, y: SEAT_Y, kind: 'front', width: 0.4, depth: 0.42, z: EYE.z + 0.7, reclineDeg: 14, back: LOW_BACK },
  ],
  consoles: [
    // Structure under the lower edge of the panel, toward the firewall (knee room under it).
    {
      min: [PANEL_X + 0.002, -0.46, PANEL_ZB - 0.005],
      max: [PANEL_X + 0.17, 0.46, PANEL_ZB + 0.14],
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
    // The small centre pedestal from the panel's lower edge to the floor; the trim wheel sits in it (s.12).
    { min: [PANEL_X - 0.08, -0.065, PANEL_ZB], max: [PANEL_X + 0.03, 0.065, FLOOR_Z], bevel: 0.015, material: 'panelPlastic' },
    // Plate of the fuel shut-off valve on the floor between the seats (s.9).
    { min: [-0.06, -0.05, FLOOR_Z - 0.011], max: [0.08, 0.05, FLOOR_Z + 0.001], bevel: 0.005, material: 'panelPlastic' },
    // The flat carpeted baggage shelf behind the seats (s.12; baggage areas 1 and 2, s.6).
    // It stops short of the aft bulkhead and of the side walls, where the cabin narrows into the tail cone.
    { min: [-1.3, -0.32, 0.3], max: [SHELF_X, 0.32, 0.47], bevel: 0.012, material: 'carpet' },
  ],
  // Both sides. Door: plastic moulding with an integrated armrest, recessed where the padded insert with its map
  // pocket sits; a narrow kick panel ahead of the door; carpeted lower sidewall (it follows the lining on down below
  // the floor's edge and closes the joint); the side panel aft of the door; the baggage bay panel.
  trimPanels: [
    {
      side: 0, x0: DOOR.x0, x1: DOOR.x1, z0: DOOR.z0, z1: DOOR.z1, relief: 0.011, material: 'trimPlastic',
      grid: { rows: 56, cols: 40 },
      edge: 0.025,
      armrest: { xa: -0.42, xb: 0.25, zc: 0.0, hz: 0.045, height: 0.055, taper: 0.08 },
      recess: { x0: INSERT.x0 + 0.01, x1: INSERT.x1 - 0.01, z0: INSERT.z0 - 0.01, z1: INSERT.z1 + 0.01, depth: 0.004, edge: 0.01 },
    },
    {
      side: 0, x0: INSERT.x0, x1: INSERT.x1, z0: INSERT.z0, z1: INSERT.z1, relief: 0.014, material: 'seatFabric',
      grid: { rows: 44, cols: 30 },
      edge: 0.014,
      offset: 0.004,
      pocket: { x0: 0.6, x1: 0.08, zTop: 0.16, depth: 0.12, lip: 0.025 },
    },
    { side: 0, x0: FIREWALL_X - 0.005, x1: 0.785, z0: -0.05, z1: FLOOR_Z + 0.025, relief: 0.008, material: 'panelPlastic', grid: { rows: 16, cols: 36 }, edge: 0.015, openBelow: true },
    { side: 0, x0: 0.785, x1: SHELF_X, z0: DOOR.z1 - 0.01, z1: FLOOR_Z + 0.025, relief: 0.006, material: 'carpet', grid: { rows: 40, cols: 12 }, edge: 0.01, openBelow: true },
    { side: 0, x0: REAR_POST_X - 0.02, x1: -1.1, z0: SILL_Z + 0.02, z1: 0.3, relief: 0.01, material: 'trimPlastic', grid: { rows: 28, cols: 30 }, edge: 0.025 },
    { side: 0, x0: -1.12, x1: CABIN_REAR_X + 0.03, z0: -0.25, z1: 0.32, relief: 0.007, material: 'trimPlastic', grid: { rows: 20, cols: 24 }, edge: 0.02 },
  ],
  // Two ram's-horn control wheels on shafts through the panel (s.12): neutral end position, fore-aft travel for full
  // elevator input, maximum rotation.
  column: { kind: 'yoke', x: PANEL_X - 0.18, y: SEAT_Y, z: faceZ(C152_PANEL_PARTS.yokes.y), travel: 0.07, rollDeg: 40 },
  pedals: { x: 0.64, ys: [-SEAT_Y, SEAT_Y] },
  // Push-pull knobs along the lower centre of the panel (s.9): carburettor heat left of the throttle (black), the
  // large throttle knob, the red mixture knob right of it.
  engineControls: [
    { kind: 'knob', control: 'carbHeat', engine: 0, pos: [PANEL_X, faceY(C152_KNOBS.carbHeat), faceZ(C152_KNOBS.y)], travel: 0.06, colour: 'black' },
    { kind: 'knob', control: 'throttle', engine: 0, pos: [PANEL_X, faceY(C152_KNOBS.throttle), faceZ(C152_KNOBS.y)], travel: 0.075, colour: 'black' },
    { kind: 'knob', control: 'mixture', engine: 0, pos: [PANEL_X, faceY(C152_KNOBS.mixture), faceZ(C152_KNOBS.y)], travel: 0.075, colour: 'red' },
  ],
  // The electric flap pre-select lever in its slotted gate right of the mixture: 0.1 m of travel from UP to 30 deg.
  flapControl: { kind: 'panelLever', pos: [PANEL_X, faceY(C152_PANEL_PARTS.flapSlot.x), faceZ(C152_PANEL_PARTS.flapSlot.y)], travel: 0.1 },
  // The vertical elevator trim wheel on the pedestal below the throttle (s.9).
  trimWheel: { pos: [PANEL_X - 0.05, 0, PANEL_ZB + 0.11], axis: 'y' },
  // Magnetic compass on the windshield centre post at the top (s.9).
  compass: { pos: [0.37, 0, -0.53] },
  fittings: {
    // The defrost outlet slots on the glareshield top just aft of the windshield.
    defrosters: [
      [0.72, -0.15, -0.2035],
      [0.72, 0.15, -0.2035],
    ],
    // The fuel shut-off valve handle on the plate between the seats (ON / OFF; no tank selector).
    fuelSelector: { x: 0.01, y: 0 },
    // Sun visors folded up under the headliner; the two wing-root ventilators at the upper corners of the
    // windshield (s.9).
    visors: { x: 0.25, z: -0.578, ys: [-SEAT_Y, SEAT_Y] },
    vents: [
      [0.22, -0.43, -0.545],
      [0.22, 0.43, -0.545],
    ],
    // Overhead console with the red panel flood light and the speaker (s.12).
    overhead: { z: -0.585 },
    // Door handle at the armrest's front end, window latch on the sill, cabin-air outlet low in the kick panel.
    doorHandle: [0.32, -0.005],
    windowLatch: [-0.35, SILL_Z + 0.02],
    airOutlet: [0.815, 0.36],
    // The floor carpet runs up the firewall behind the pedals.
    toeBoard: { x0: 0.6, x1: FIREWALL_X - 0.01, z: 0.32 },
  },
  // Overhead-console flood light and the point on the panel it is aimed at; dome light over the baggage shelf.
  lamps: { flood: { pos: [0.02, 0, -0.57], aim: [0.45, -0.1, 0.02] }, dome: { pos: [-0.75, 0, -0.57] } },
  // Simplified cabin for the occlusion bake: floor, headliner, flat sides, aft bulkhead, panel face and glareshield
  // top, the windshield sill (forward of the panel).
  box: { floor: FLOOR_Z, roof: -0.585, side: 0.475, rear: CABIN_REAR_X + 0.04, panelX: PANEL_X, glareshieldZ: PANEL_ZTOP - 0.02, sillZ: -0.212, windscreenX: 0.775, roofGlazed: false },
  // Outward unit normals and areas, m^2, from the window outlines.
  glazingPanels: [
    { n: [0.6, 0, -0.8], area: 0.5 }, // windshield, raked back from the cowl deck to the wing leading edge
    { n: [0, -1, 0], area: 0.58 }, // left door and rear side windows
    { n: [0, 1, 0], area: 0.58 },
    { n: [-0.78, 0, -0.63], area: 0.36 }, // rear window down the back of the cabin
  ],
  // Floor, headliner, sides, panel, bulkhead and seats, less the glazing.
  interiorArea: 9,
  // The parking brake knob on the lower left of the panel (s.3; panel.ts paints it, it has no 3D part). The fuel
  // valve has its handle.
  controlPoints: {
    fuelSelector: [0.01, 0, FLOOR_Z - 0.04],
    parkingBrake: [PANEL_X - 0.01, faceY(C152_PARKING_BRAKE[0]), faceZ(C152_PARKING_BRAKE[1])],
  },
};

// --- Paint: a late-1970s factory scheme, representative (s.12) ------------------------------------------------------

const LIVERY: LiveryDef = {
  registration: 'N152FS',
  // Overall white, a broad red side stripe with a thin dark line along it.
  palette: { base: [238, 238, 234], band: [172, 30, 36], accent: [52, 40, 44] },
  // "a thinner second stripe ... just below it" (s.12).
  accentBelow: true,
  // The stripe starts on the cowl behind the spinner, runs aft at door-handle height below the windows and narrows
  // along the lower tail cone, sweeping up to the tail; its nose end is sheared so that it sweeps.
  stripe: {
    xs: [-4.75, -4.2, -3.5, -2.8, -2.2, -1.5, -0.6, 0.3, 1.0, 1.72],
    centre: [-0.035, 0.075, 0.165, 0.205, 0.21, 0.185, 0.09, 0.075, 0.085, 0.1],
    half: [0.018, 0.022, 0.028, 0.034, 0.04, 0.046, 0.05, 0.05, 0.05, 0.048],
    noseShearX: 1.66,
  },
  // The registration on the rear fuselage between the rear window and the tailplane, above the stripe, as tall as
  // the tail cone side allows (s.12: about 0.3 m; the stripe's accent line runs above the band, below the letters).
  lettering: { x0: -3.25, x1: -1.8, z0: -0.125, z1: 0.115 },
  construction: 'metal',
  // Tail-cone skin joints (FS 95, 133.3 and 173.4), the two-piece cowling's split line, the exhaust the soot
  // streaks aft from.
  skinJoints: [-1.6, -2.54, -3.56],
  cowlSplitZ: 0.13,
  soot: { x: 0.95, y: 0.2 },
  // The split line and its camloc fasteners, the carburettor air-filter opening below the spinner, the oil
  // dipstick door in the cowl top; the rivet row along the cabin floor line.
  cowl: {
    grille: { x: 1.69, z0: 0.215, z1: 0.255, halfWidth: 0.045 },
    oilDoor: { x: 1.22, halfLength: 0.09, halfWidth: 0.08 },
  },
  floorRivets: { z: 0.48, x1: -1.5 },
  // The fin band continues the stripe's sweep: z = bandZ0 + (x - bandX0) * slope; a cap in the stripe colour.
  fin: { bandZ0: -0.72, bandX0: -4.45, slope: 0.72, cap: 0.12 },
  // The two-seaters may use the smaller texture.
  texture: { w: 2048, h: 1024 },
};

export const C152_VISUAL: AirframeVisualDef = {
  id: 'c152',
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
    halfY: 5.8,
    // Belly band: centre x, half length, half width (cowling to tail cone).
    fuselage: [-1.3, 2.9, 0.5],
    // Wing band: centre x, half span of its core, and the height of the wing above the ground (a high wing: very
    // soft and faint).
    wingX: -0.1,
    wingY: 3.6,
    wingHeight: 2.3,
    restHeight: C152_GEOMETRY.restHeight,
  },
};

export default C152_VISUAL;
