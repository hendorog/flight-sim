// Cessna 172S: the airframe as data for the 3D model, the cameras and the livery worker. PLAIN and
// structured-cloneable: no three.js, no functions, no class instances (the worker imports this file through
// aircraft/visualLoader.ts and nothing else of the aircraft).
//
// The builders of render/aircraft take their parts from here. What the flight model and the picture must agree
// on (planforms, wheel contact points, the propeller disc, the eye point) comes from core/c172.ts; everything
// else is hand-shaped: the fuselage station table, the glazing and door outlines, the paint scheme, the cabin.
// Positions are FRD metres from the reference point. Colours: the livery palette is sRGB 0..255, the
// propeller paint sRGB 0..1.

import { C172 } from '../../core/c172';
import { makeFinPlanform, makeRudderPlanform, makeWingPlanform, sectionPoint, surfacePoint } from '../../render/aircraft/planformMath';
import type {
  AirframeVisualDef,
  CockpitDef,
  FRD,
  GlazingDef,
  LampVisualDef,
  LiveryDef,
  LoftDef,
  PropVisualDef,
  SectionShape,
  TailVisualDef,
  WheelVisualDef,
  WingVisualDef,
} from '../types';

const W = C172.wing;
const H = C172.hTail;
const V = C172.vTail;
const G = C172.gear;
const P = C172.prop;
const EYE = C172.fuselage.pilotEye;

const NACA2412: SectionShape = { m: 0.02, p: 0.4, t: 0.12 };
const NACA0009: SectionShape = { m: 0, p: 0.4, t: 0.09 };

// --- Wing: constant-chord centre panel, tapered outer panel, strut braced ----------------------------------

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
  // Single-slotted flap on tracks: about a quarter of its chord aft at full deflection.
  flap: { maxDeflection: W.flap.maxDeflection, travelAft: 0.13, travelDown: 0.04 },
  // The last 0.16 m rounds off, with a slight planform rounding of the corners (conical-camber tip).
  tip: { round: 0.16, chordRound: 0.1 },
  strut: {
    fuselage: [W.strut.fuselage.x, W.strut.fuselage.y, W.strut.fuselage.z],
    wing: [W.strut.wing.x, W.strut.wing.y, W.strut.wing.z],
    chord: 0.105,
    tc: 0.34,
  },
  // Filler caps over the tanks, inboard of the strut; the pitot tube under the left wing outboard of it.
  fuelCaps: [{ y: 1.95, xc: 0.34, side: 'both' }],
  pitot: { side: -1, y: 2.95, xc: 0.18 },
};

// --- Tail: fixed stabiliser with elevators, swept fin with rudder ---------------------------------------------

const TAIL: TailVisualDef = {
  section: NACA0009,
  h: {
    span: H.span,
    rootChord: H.rootChord,
    tipChord: H.tipChord,
    quarterChord: { x: H.quarterChord.x, z: H.quarterChord.z },
    incidence: H.incidence,
    kind: 'elevator',
    chordFraction: H.elevator.chordFraction,
    // Cut back inboard to clear the rudder's lower extension.
    innerCutY: 0.19,
    // Trim tab in the right elevator: span, and chord station of its hinge on the full stabiliser chord.
    tab: { y0: 0.3, y1: 0.74, xc: 0.935, sides: 'right' },
  },
  v: {
    base: { x: V.base.x, z: V.base.z },
    tip: { x: V.tip.x, z: V.tip.z },
    rootChord: V.rootChord,
    tipChord: V.tipChord,
    rudderChordFraction: V.rudder.chordFraction,
    // The rudder runs on below the fin base, behind the tail cone, to the tail light.
    rudderExtension: { bottomH: -0.27, aftChord: 0.86 },
  },
  tTail: false,
  vorAntenna: true,
};

// --- Fuselage: the station table ------------------------------------------------------------------------------

/** Cowling face / spinner backplate station and tail cone end. */
const FRONT_X = 1.905;
const END_X = -5.05;
/** Firewall station (cowling / cabin joint). */
const FIREWALL_X = 0.99;
/** The baggage bulkhead: the cabin's glazing and lining end here. */
const CABIN_REAR_X = -2.12;
const HW = C172.fuselage.maxWidth / 2;
/** How far the cabin belly is lowered from the base table, m. */
const BELLY_DROP = 0.1;

type Key = [x: number, zTop: number, zBot: number, zMid: number, hw: number, nTop: number, nBot: number, ridge: number];

/** 1 over the cabin (x from -1.3 to 0.8), fading to 0 at x = 1.35 (lower cowl) and x = -2.4 (tail cone). */
function bellyWeight(x: number): number {
  const s = (a: number, b: number, v: number): number => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return s(1.35, 0.8, x) * s(-2.4, -1.3, x);
}

function fuselageKeys(): Key[] {
  const nose: Key[] = [
    // Nose bowl: a fairly flat face close around the spinner backplate, rounding over to the cowling sides
    // within ~6 cm (the inlets sit on the flat face and its rounded edge).
    [FRONT_X, -0.19, 0.2, 0.0, 0.19, 2.0, 2.0, 0],
    [1.901, -0.214, 0.27, 0.02, 0.31, 2.5, 2.4, 0],
    [1.888, -0.226, 0.322, 0.03, 0.385, 2.9, 2.7, 0],
    [1.85, -0.233, 0.36, 0.04, 0.43, 3.0, 2.8, 0],
    [1.75, -0.236, 0.39, 0.045, 0.447, 3.0, 2.8, 0],
    [1.6, -0.237, 0.405, 0.05, 0.458, 3.0, 2.8, 0],
    [1.3, -0.232, 0.44, 0.05, 0.485, 3.2, 3.0, 0],
    [FIREWALL_X, -0.222, 0.475, 0.04, 0.51, 3.4, 3.2, 0],
    // Windscreen: the top line rakes up to the wing leading edge.
    [0.85, -0.3, 0.495, 0.02, 0.522, 3.6, 3.8, 0],
    [0.7, -0.4, 0.51, 0.0, HW - 0.002, 3.9, 4.1, 0],
    [0.55, -0.505, 0.518, -0.02, HW, 4.4, 4.4, 0],
  ];
  // Between the wing roots the roof follows the root airfoil's upper surface (the carry-through fairing).
  const wingRoot: Key[] = [];
  const wing = makeWingPlanform(WING);
  const p = { x: 0, y: 0, z: 0 };
  for (const xc of [0, 0.02, 0.06, 0.12, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0]) {
    const [ax, ay] = xc === 0 ? [0, 0] : surfacePoint(WING.section, xc, 1);
    sectionPoint(wing, WING.rootY, ax, ay, p);
    // Boxy top corners so the roof meets the wing roots squarely instead of forming a hump.
    wingRoot.push([p.x, p.z + 0.003, 0.522 - 0.007 * xc, -0.03, HW, 9, 4.5, 0]);
  }
  const tail: Key[] = [
    [-1.4, -0.57, 0.495, -0.03, 0.505, 3.6, 3.8, 0],
    [-1.8, -0.525, 0.44, -0.035, 0.455, 3.0, 3.0, 0],
    [-2.25, -0.472, 0.362, -0.045, 0.39, 2.6, 2.8, 0],
    [-2.8, -0.42, 0.27, -0.07, 0.318, 2.4, 2.6, 0.012],
    [-3.4, -0.375, 0.17, -0.1, 0.25, 2.3, 2.4, 0.04],
    [-4.0, -0.337, 0.075, -0.13, 0.186, 2.2, 2.3, 0.1],
    [-4.35, -0.318, 0.022, -0.14, 0.152, 2.2, 2.2, 0.16],
    [-4.6, -0.307, -0.012, -0.15, 0.13, 2.2, 2.2, 0.0],
    [-4.85, -0.3, -0.036, -0.16, 0.11, 2.2, 2.2, 0],
    [END_X, -0.296, -0.052, -0.165, 0.095, 2.2, 2.2, 0],
  ];
  // The cabin belly sits BELLY_DROP lower than the table's base values between the firewall and the
  // baggage area, faded out over the lower cowling and the tail cone: that gives the 172S its ~1.2 m
  // (48 in) cabin interior under the wing and a belly ~0.7 m off the ground. The wing, windows, eye point
  // and panel are unaffected (they are all above the widest line).
  return [...nose, ...wingRoot, ...tail].map((k) => {
    const w = bellyWeight(k[0]);
    return [k[0], k[1], k[2] + BELLY_DROP * w, k[3] + 0.3 * BELLY_DROP * w, k[4], k[5], k[6], k[7]] as Key;
  });
}

/**
 * Cowling air inlets either side of the spinner: rounded openings about 0.2 m wide and 0.12 m tall, seen from
 * ahead (a superellipse; the duct behind runs to the baffle).
 */
const inlet = (y: number): AirframeVisualDef['fuselage']['inlets'][number] => ({ y, z: 0.035, w: 0.196, h: 0.12, r: 0.04, exponent: 3.2, xMin: 1.8, baffleX: 1.73 });

const FUSELAGE: AirframeVisualDef['fuselage'] = {
  keys: fuselageKeys(),
  frontX: FRONT_X,
  endX: END_X,
  ridgeW: 0.055,
  grid: { rows: 176, cols: 112 },
  nose: 'prop',
  inlets: [inlet(0.285), inlet(-0.285)],
  // The stack leaves the lower right cowling, angled down and aft.
  exhaust: { pos: [1.2, 0.17, 0.4], radius: 0.028 },
  // Two VHF comm blades on the cabin roof (behind the wing carry-through), the transponder stub on the belly.
  antennas: [
    { kind: 'blade', pos: [-1.38, 0, -0.565], height: 0.24 },
    { kind: 'blade', pos: [-2.35, 0, -0.475], height: 0.2 },
    { kind: 'stub', pos: [-1.6, 0.0, 0.525], height: 0.09 },
  ],
};

// --- Glazing and door lines (side projection: x, z) -----------------------------------------------------------

/** Unit normal of the windscreen's sill plane. */
const SILL_N = ((): readonly [number, number] => {
  const nx = 0.17;
  const nz = 0.21;
  const l = Math.hypot(nx, nz);
  return [nx / l, nz / l];
})();

const GLAZING: GlazingDef = {
  cabinFrontX: FIREWALL_X,
  cabinRearX: CABIN_REAR_X,
  firewallX: FIREWALL_X,
  tRange: [0.2, 0.8],
  windows: [
    // Door window: its front edge runs parallel to the A-post, ~35 mm of frame behind it (door skin and
    // window retainer; the door's own edge lies between them).
    {
      pts: [
        [0.681, -0.1],
        [0.417, -0.556],
        [-0.4, -0.556],
        [-0.4, -0.1],
      ],
      r: 0.025,
      sides: 'both',
      maxX: 0.72,
    },
    // Rear side window.
    {
      pts: [
        [-0.49, -0.1],
        [-0.49, -0.556],
        [-1.24, -0.545],
        [-1.24, -0.335],
      ],
      r: 0.03,
      sides: 'both',
      maxX: -0.45,
    },
    // Rear window, wrapping over the tail cone.
    {
      pts: [
        [-1.34, -1.2],
        [-1.34, -0.43],
        [-1.72, -0.414],
        [-2.06, -0.452],
        [-2.06, -1.2],
      ],
      r: 0.05,
      sides: 'both',
      maxX: -0.45,
    },
  ],
  // Bounded below by a plane through the glareshield sill (centre) and the lower corners, aft by the A-pillar
  // line (on the sides only: inboard of postY the glass is on the cabin top), above by the wing leading edge.
  windscreen: {
    sillC: [0.95, -0.232],
    sillN: SILL_N,
    post: [
      [0.745, -0.055],
      [0.43, -0.6],
    ],
    postY: 0.44,
    topX: 0.418,
  },
  doors: [
    // Cabin door, both sides, with its exterior handle below the window.
    {
      pts: [
        [0.72, 0.4],
        [0.74, -0.02],
        [0.425, -0.575],
        [-0.47, -0.575],
        [-0.47, 0.4],
      ],
      r: 0.07,
      sides: 'both',
      handle: { x: -0.36, z: -0.02 },
    },
    // Baggage door, left side.
    {
      pts: [
        [-1.05, 0.33],
        [-1.05, -0.02],
        [-1.55, -0.02],
        [-1.55, 0.33],
      ],
      r: 0.04,
      sides: 'left',
    },
  ],
  // The headliner sits just under the wing root.
  liningRoofLimit: -0.63,
  xRange: [1.0, -2.1],
  // Fabric stretched between transverse bows from the windscreen header to the rear window.
  headliner: { x0: 0.42, x1: -1.34, z0: -0.5, z1: -0.56, pitch: 0.28 },
};

// --- Landing gear: 5.00-5 tyres, tubular spring main legs, oleo nose strut ------------------------------------

const RIM_RADIUS = 0.0635;

const mainWheel = (contact: { x: number; y: number; z: number }, side: 1 | -1): WheelVisualDef => ({
  contact: [contact.x, contact.y, contact.z],
  radius: G.mainWheelRadius,
  width: 0.135,
  rimRadius: RIM_RADIUS,
  // The leg root is inside the lower fuselage; the leg ends at the axle fitting, inboard of the wheel plane.
  leg: { kind: 'springTube', root: [-0.4, side * 0.36, 0.49], axleOffset: 0.1, r0: 0.029, r1: 0.018 },
  fairing: { length: 1.0, halfWidth: 0.12, top: 0.25, bottom: 0.14 },
});

const GEAR: AirframeVisualDef['gear'] = [
  {
    contact: [G.nose.x, G.nose.y, G.nose.z],
    radius: G.noseWheelRadius,
    width: 0.12,
    rimRadius: RIM_RADIUS,
    // Top of the oleo cylinder inside the cowling; fixed cylinder length and piston crown along the strut.
    leg: { kind: 'oleo', top: [1.13, 0, 0.36], cylinderLen: 0.36, crownAt: 0.53, forkHalf: 0.075, scissors: true, steers: true },
    fairing: { length: 0.82, halfWidth: 0.105, top: 0.215, bottom: 0.125 },
  },
  mainWheel(G.leftMain, -1),
  mainWheel(G.rightMain, 1),
];

// --- Propeller: McCauley 1A170E, fixed pitch, clockwise seen from the cockpit ----------------------------------

const SPINNER_BASE_X = 1.9;
/** Geometric pitch, m (the "60" in 7660, inches). */
const PROP_PITCH = P.pitchIn * 0.0254;

const PROP: PropVisualDef = {
  hub: [P.hub.x, P.hub.y, P.hub.z],
  diameter: P.diameter,
  blades: P.blades,
  rotation: 1,
  referencePitch: Math.atan(PROP_PITCH / (2 * Math.PI * 0.75 * (P.diameter / 2))),
  variablePitch: false,
  // Typical of the 1A170 planform.
  chord: [
    [0.1, 0.07],
    [0.2, 0.1],
    [0.35, 0.14],
    [0.55, 0.15],
    [0.75, 0.138],
    [0.9, 0.11],
    [0.97, 0.078],
    [1.0, 0.03],
  ],
  geometricPitch: PROP_PITCH,
  spinner: { baseX: SPINNER_BASE_X, radius: 0.2, length: C172.fuselage.noseX - SPINNER_BASE_X },
  // Satin grey thrust face, matt black back (anti-glare, seen from the cockpit), white tips.
  paint: { face: [0.45, 0.46, 0.47], back: [0.035, 0.035, 0.037], tip: [0.9, 0.9, 0.88], tipBand: 0.075 },
};

// --- Exterior lamps -------------------------------------------------------------------------------------------

const LAMPS: readonly LampVisualDef[] = ((): LampVisualDef[] => {
  const wing = makeWingPlanform(WING);
  const onWing = (y: number, xc: number, yc: number, side: 1 | -1): FRD => {
    const p = sectionPoint(wing, y, xc, yc);
    return [p.x, p.y * side, p.z];
  };
  const onWingSurface = (y: number, xc: number, side: 1 | -1): FRD => {
    const [px, py] = surfacePoint(WING.section, xc, 1);
    return onWing(y, px, py, side);
  };
  // Wingtip nav + strobe housings at the leading edge of each tip.
  const tipY = TIP_Y - 0.05;
  // The white tail light sits on the bottom of the rudder's trailing edge and swings with it.
  const tail = sectionPoint(makeRudderPlanform(TAIL), TAIL.v.rudderExtension!.bottomH + 0.03, 1, 0);
  // The beacon stands on the fin tip.
  const finTip = sectionPoint(makeFinPlanform(TAIL), V.base.z - V.tip.z - 0.01, 0.35, 0);
  // Glow offsets put the sprite on the outer face of each lens, clear of the skin around it.
  return [
    { id: 'navL', pos: onWing(tipY, 0.06, 0.0, -1), radius: 0.03, glowOffset: [0.035, -0.035, 0] },
    { id: 'navR', pos: onWing(tipY, 0.06, 0.0, 1), radius: 0.03, glowOffset: [0.035, 0.035, 0] },
    { id: 'navTail', pos: [tail.x - 0.015, tail.y, tail.z], radius: 0.022, glowOffset: [-0.03, 0, 0], parent: 'rudder' },
    { id: 'strobeL', pos: onWing(tipY + 0.01, 0.2, 0.0, -1), radius: 0.02, glowOffset: [0, -0.035, 0] },
    { id: 'strobeR', pos: onWing(tipY + 0.01, 0.2, 0.0, 1), radius: 0.02, glowOffset: [0, 0.035, 0] },
    { id: 'beacon', pos: [finTip.x, 0, finTip.z - 0.035], radius: 0.035, glowOffset: [0, 0, -0.045] },
    // Landing (outboard) and taxi (inboard) lights in the left leading edge, outboard of the strut.
    { id: 'landing', pos: onWingSurface(3.35, 0.004, -1), radius: 0.045, glowOffset: [0.02, 0, 0], aim: { downDeg: 2.5, outDeg: 1, halfAngleDeg: 9 } },
    { id: 'taxi', pos: onWingSurface(3.05, 0.004, -1), radius: 0.045, glowOffset: [0.02, 0, 0], aim: { downDeg: 6, outDeg: 10, halfAngleDeg: 24 } },
  ];
})();

// --- Cockpit ----------------------------------------------------------------------------------------------------

/** Instrument panel face: vertical, facing aft, centred on the aircraft centreline. */
const PANEL_X = 0.5;
const PANEL_ZTOP = -0.28;
/** 2000 px/m: the 2080 x 800 px canvas makes a face 1.04 m wide and 0.40 m high. */
const PANEL_WIDTH = 1.04;
const PANEL_ZB = PANEL_ZTOP + 0.4;
/** Cabin floor (top of the carpet): ~1.2 m below the headliner, ~0.26 m below the front seat cushions. */
const FLOOR_Z = 0.565;
/** Lateral station of the pilots' seats, yokes and pedals. */
const SEAT_Y = 0.27;
const YOKE_X = 0.3;
const YOKE_Z = 0.035;
/** Rudder pedal floor pivots. */
const PEDAL_X = 0.64;
/** Stations and heights of the door panel (the door's inner skin below the window). */
const DOOR = { x0: 0.7, x1: -0.45, z0: -0.088, z1: 0.4 };
/** The padded insert on the lower door. */
const INSERT = { x0: 0.62, x1: -0.37, z0: 0.105, z1: 0.37 };

const COCKPIT: CockpitDef = {
  pilotEye: [EYE.x, EYE.y, EYE.z],
  /** Default view: 7 degrees nose-down from level, over the glareshield. */
  defaultPitchDeg: -7,
  enclosure: 'cabin',
  panel: { x: PANEL_X, zTop: PANEL_ZTOP, width: PANEL_WIDTH },
  floor: { z: FLOOR_Z, x0: 0.95, x1: -2.1 },
  // Hood profile: panel-top lip, padded top, and forward under the windscreen's lower edge (glass edge at
  // x ~0.95 on the centreline) ~4 mm below the glazing, so no lining shows between the hood and the glass.
  glareshield: {
    profile: [
      [0.47, -0.2815],
      [0.461, -0.29],
      [0.466, -0.302],
      [0.5, -0.307],
      [0.7, -0.288],
      [0.93, -0.236],
      [0.975, -0.217],
      [0.975, -0.2],
      [0.53, -0.28],
      [0.5, -0.2815],
    ],
    halfWidth: 0.505,
  },
  // Front seats slid to where the pilot eye (x -0.18) sits over the rear of the cushion; the rear bench is two
  // places wide. x is the cushion's front edge, z its top.
  seats: [
    { x: 0.14, y: -SEAT_Y, kind: 'front', width: 0.44, depth: 0.44, z: 0.3 },
    { x: 0.14, y: SEAT_Y, kind: 'front', width: 0.44, depth: 0.44, z: 0.3 },
    { x: -0.92, y: 0, kind: 'bench', width: 0.94, depth: 0.4, z: 0.3 },
  ],
  consoles: [
    // Lower (knee) panel under the instrument panel.
    {
      min: [PANEL_X + 0.002, -0.5, PANEL_ZB - 0.005],
      max: [PANEL_X + 0.2, 0.5, PANEL_ZB + 0.2],
      bevel: 0.008,
      material: 'panelPlastic',
      profile: [
        [PANEL_X + 0.002, PANEL_ZB - 0.005],
        [PANEL_X + 0.002, PANEL_ZB + 0.06],
        [PANEL_X + 0.14, PANEL_ZB + 0.2],
        [PANEL_X + 0.2, PANEL_ZB + 0.2],
        [PANEL_X + 0.2, PANEL_ZB - 0.005],
      ],
    },
    // Centre pedestal from the panel's lower edge to the floor (the trim wheel sits in it).
    { min: [PANEL_X - 0.09, -0.08, PANEL_ZB], max: [PANEL_X + 0.03, 0.08, FLOOR_Z], bevel: 0.015, material: 'panelPlastic' },
    // Plate of the fuel selector on the floor between the front seats.
    { min: [-0.2, -0.06, FLOOR_Z - 0.011], max: [-0.04, 0.06, FLOOR_Z + 0.001], bevel: 0.005, material: 'panelPlastic' },
  ],
  // Both sides. Door: plastic moulding with an integrated armrest, recessed where the padded insert with its
  // map pocket sits; dark kick panel in the footwell; carpeted lower sidewall (it follows the lining on down
  // below the floor's edge and closes the joint); rear side panel with its armrest; baggage bay panel.
  trimPanels: [
    {
      side: 0, x0: DOOR.x0, x1: DOOR.x1, z0: DOOR.z0, z1: DOOR.z1, relief: 0.011, material: 'trimPlastic',
      grid: { rows: 60, cols: 46 },
      edge: 0.025,
      armrest: { xa: -0.36, xb: 0.32, zc: 0.035, hz: 0.048, height: 0.062, taper: 0.08 },
      recess: { x0: INSERT.x0 + 0.01, x1: INSERT.x1 - 0.01, z0: INSERT.z0 - 0.01, z1: INSERT.z1 + 0.01, depth: 0.004, edge: 0.01 },
    },
    {
      side: 0, x0: INSERT.x0, x1: INSERT.x1, z0: INSERT.z0, z1: INSERT.z1, relief: 0.014, material: 'seatFabric',
      grid: { rows: 48, cols: 36 },
      edge: 0.014,
      offset: 0.004,
      pocket: { x0: 0.55, x1: 0.03, zTop: 0.205, depth: 0.16, lip: 0.028 },
    },
    { side: 0, x0: 0.975, x1: 0.705, z0: -0.02, z1: FLOOR_Z + 0.025, relief: 0.008, material: 'panelPlastic', grid: { rows: 28, cols: 40 }, edge: 0.02, openBelow: true },
    { side: 0, x0: 0.705, x1: -1.32, z0: DOOR.z1 - 0.01, z1: FLOOR_Z + 0.025, relief: 0.006, material: 'carpet', grid: { rows: 48, cols: 12 }, edge: 0.01, openBelow: true },
    {
      side: 0, x0: -0.5, x1: -1.3, z0: -0.075, z1: DOOR.z1, relief: 0.01, material: 'trimPlastic',
      grid: { rows: 40, cols: 36 },
      edge: 0.025,
      armrest: { xa: -0.62, xb: -1.18, zc: 0.05, hz: 0.04, height: 0.045, taper: 0.07 },
    },
    { side: 0, x0: -1.36, x1: -2.08, z0: -0.32, z1: 0.3, relief: 0.007, material: 'trimPlastic', grid: { rows: 24, cols: 24 }, edge: 0.02 },
  ],
  // Two ram's-horn yokes on columns through the panel: neutral end position, fore-aft travel for full
  // elevator input, maximum rotation.
  column: { kind: 'yoke', x: YOKE_X, y: SEAT_Y, z: YOKE_Z, travel: 0.07, rollDeg: 40 },
  pedals: { x: PEDAL_X, ys: [-SEAT_Y, SEAT_Y] },
  // Push-pull knobs on the lower panel: throttle (black) and mixture (red).
  engineControls: [
    { kind: 'knob', control: 'throttle', engine: 0, pos: [PANEL_X, 0.0, 0.08], travel: 0.075, colour: 'black' },
    { kind: 'knob', control: 'mixture', engine: 0, pos: [PANEL_X, 0.11, 0.08], travel: 0.075, colour: 'red' },
  ],
  // Electric flap lever in its slot on the panel: 0.1 m of travel from UP to FULL.
  flapControl: { kind: 'panelLever', pos: [PANEL_X, 0.25, 0], travel: 0.1 },
  // Trim wheel in the pedestal, protruding through its aft face.
  trimWheel: { pos: [PANEL_X - 0.05, 0, 0.36], axis: 'y' },
  // Magnetic compass hanging from the windscreen header on the centreline.
  compass: { pos: [0.37, 0, -0.515] },
  fittings: {
    // Defroster outlets on the glareshield top just aft of the windscreen (hood top at x 0.88 is z -0.247).
    defrosters: [
      [0.88, -0.16, -0.2475],
      [0.88, 0.16, -0.2475],
    ],
    // Fuel selector (LEFT / BOTH / RIGHT) and the red shut-off knob on the plate between the front seats.
    fuelSelector: { x: -0.12, y: 0, shutoffX: -0.02 },
    // Tinted sun visors folded up under the headliner, the wing-root fresh-air vents in the upper cabin corners.
    visors: { x: 0.27, z: -0.612, ys: [-SEAT_Y, SEAT_Y] },
    vents: [
      [0.18, -0.455, -0.575],
      [0.18, 0.455, -0.575],
    ],
    // Overhead console with the panel flood light, and the dome light's housing, on the headliner.
    overhead: { z: -0.62 },
    // Door handle at the armrest's front end, window latch on the sill, cabin-air outlet in the kick panel.
    doorHandle: [0.42, 0.03],
    windowLatch: [-0.28, -0.07],
    airOutlet: [0.86, 0.36],
    // The floor carpet runs up the firewall behind the pedals.
    toeBoard: { x0: 0.7, x1: 0.975, z: 0.3 },
  },
  // Overhead-console panel flood light and the point on the panel it is aimed at; dome light over the rear seats.
  lamps: { flood: { pos: [0.06, 0, -0.605], aim: [0.5, -0.1, -0.06] }, dome: { pos: [-0.55, 0, -0.605] } },
  // Simplified cabin for the occlusion bake: floor, headliner, flat sides, baggage bulkhead, panel face and
  // glareshield top, the windscreen sill (forward of the panel).
  box: { floor: 0.565, roof: -0.62, side: 0.515, rear: -2.1, panelX: 0.5, glareshieldZ: -0.285, sillZ: -0.232, windscreenX: 0.95, roofGlazed: false },
  // Outward unit normals and areas, m^2, from the window outlines.
  glazingPanels: [
    { n: [0.57, 0, -0.82], area: 0.65 }, // windscreen, raked back from the sill to the wing leading edge
    { n: [0, -1, 0], area: 0.68 }, // left door and rear side windows
    { n: [0, 1, 0], area: 0.68 },
    { n: [-0.45, 0, -0.89], area: 0.4 }, // rear window over the tail cone
  ],
  // Floor, headliner, sides, panel, bulkhead and seats, less the glazing.
  interiorArea: 14,
  // No 3D part: the fuel selector on the floor at the foot of the pedestal, the brake handle under the left of
  // the panel.
  controlPoints: {
    fuelSelector: [PANEL_X - 0.2, 0, FLOOR_Z - 0.04],
    parkingBrake: [PANEL_X - 0.04, -0.4, 0.17],
  },
};

// --- Paint ------------------------------------------------------------------------------------------------------

const LIVERY: LiveryDef = {
  registration: 'N417FS',
  // White, navy band, red accent line.
  palette: { base: [236, 237, 234], band: [26, 40, 74], accent: [168, 30, 40] },
  // Band centre height and half width along the body; its nose end is sheared so that it sweeps.
  stripe: {
    xs: [-5.1, -4.4, -3.8, -3.0, -2.2, -1.5, -0.5, 0.5, 1.2, 1.95],
    centre: [-0.235, -0.175, -0.1, -0.015, 0.075, 0.135, 0.17, 0.172, 0.165, 0.14],
    half: [0.03, 0.034, 0.038, 0.043, 0.047, 0.05, 0.05, 0.05, 0.05, 0.05],
    noseShearX: 1.84,
  },
  lettering: { x0: -3.62, x1: -1.98, z0: -0.325, z1: -0.075 },
  construction: 'metal',
  // Tail-cone skin joints, the cowling's split line, the exhaust stack the soot streaks aft from.
  skinJoints: [-2.3, -3.35, -4.4],
  cowlSplitZ: 0.05,
  soot: { x: 1.1, y: 0.17 },
  // The split line and its camloc fasteners, the induction-air grille below the spinner, the oil filler door in
  // the cowl top; the rivet row along the cabin floor line.
  cowl: {
    splitEndX: 1.86,
    camlocEndX: 1.8,
    grille: { x: 1.84, z0: 0.19, z1: 0.27, halfWidth: 0.1 },
    oilDoor: { x: 1.325, halfLength: 0.155, halfWidth: 0.13 },
  },
  floorRivets: { z: 0.3, x1: -1.35 },
  // The fin band continues the fuselage stripe's sweep: z = bandZ0 + (x - bandX0) * slope; navy cap on top.
  fin: { bandZ0: -0.62, bandX0: -4.7, slope: 0.72, cap: 0.14 },
  texture: { w: 4096, h: 2048 },
};

export const C172S_VISUAL: AirframeVisualDef = {
  id: 'c172s',
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
    halfX: 6.5,
    halfY: 6.2,
    // Belly band: centre x, half length, half width (cowling to tail cone).
    fuselage: [-1.0, 2.6, 0.62],
    // Wing band: centre x, half span of its core, and the height of the wing above the ground (a high wing:
    // very soft and faint).
    wingX: -0.1,
    wingY: 3.8,
    wingHeight: 2.5,
  },
};

export default C172S_VISUAL;
