// Diamond DA20-C1: the airframe as data for the 3D model, the cameras and the livery worker. PLAIN and
// structured-cloneable: no three.js, no functions, no class instances (the worker imports this file through
// aircraft/visualLoader.ts and nothing else of the aircraft).
//
// What the flight model and the picture must agree on (planforms, wheel contact points, the propeller disc, the
// eye point) comes from ./geometry; the panel's pixel layout from ./panel. Everything else is shaped here from the
// type's engineering data sheet (aircraft-data/da20.md in the design work folder; "s.N" is its section N, s.12
// the appearance): the fuselage station table, the canopy outline, the paint, the cockpit. Positions are FRD
// metres from the reference point; a station of s.12 (metres aft of the spinner tip, height above the fuselage
// reference line FRL) goes through geometry.ts's da20NoseX / da20FrlZ. Colours: the livery palette is sRGB
// 0..255, the propeller paint sRGB 0..1.
//
// The type: a sleek all-composite low-wing two-seater; a short wide cowl with two oval inlets beside the spinner
// and a chin inlet under it; a large bubble canopy set well forward, hinged at the rear; a pod-and-boom fuselage
// pinching sharply behind the cabin into a slim tail boom; a swept fin with the tailplane on top in a bullet
// fairing; long slender wings with blended upturned tips and a trailing-edge root fillet; white teardrop spats on
// leaf-spring mains and on a castering nose leg; white overall with thin sweeping stripes, no rivets. Inside:
// two reclined seat shells, a centre stick before each, a centre console with the three-lever quadrant (alternate
// air, throttle, mixture), a low, wide panel under a black glareshield with the compass on top.

import { makeFinPlanform, makeRudderPlanform, makeWingletPlanform, sectionPoint } from '../../render/aircraft/planformMath';
import type {
  AirframeVisualDef,
  CockpitDef,
  FairingDef,
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
import { DA20_GEOMETRY, da20FrlZ as FZ, da20NoseX as NX } from './geometry';
import { DA20_FLAP_SWITCH, DA20_PANEL_CENTRE_PX, DA20_PANEL_PX_PER_M, DA20_PANEL_PX_RECT, DA20_PANEL_WIDTH } from './panel';

const W = DA20_GEOMETRY.wing;
const H = DA20_GEOMETRY.hTail;
const V = DA20_GEOMETRY.vTail;
const G = DA20_GEOMETRY.gear;
const P = DA20_GEOMETRY.propellers[0];
const EYE = DA20_GEOMETRY.fuselage.pilotEye;
const DEG = Math.PI / 180;

/** Wortmann FX 63-137 (s.2.2) as the NACA stand-in of the contour: 13.7 % thick, about 6 % camber near mid-chord. */
const FX63_137: SectionShape = { m: 0.055, p: 0.5, t: 0.137 };
/** The upturned tip thins toward its end. */
const TIP_SECTION: SectionShape = { m: 0.02, p: 0.45, t: 0.1 };
/** Symmetric tail sections, about NACA 0012 (s.2.4: a 0012 polar is an acceptable stand-in). */
const NACA0012: SectionShape = { m: 0, p: 0.4, t: 0.12 };

// --- Wing: one straight-tapered panel from the root, the blended upturned tip, the root fillet --------------------

/** The geometry's wing stations (centre line, start of the raked tip), linearly interpolated to `y`. */
function wingStation(y: number): { y: number; chord: number; qcX: number } {
  const [a, b] = W.breaks!;
  const f = (y - a.y) / (b.y - a.y);
  return { y, chord: a.chord + f * (b.chord - a.chord), qcX: a.qcX + f * (b.qcX - a.qcX) };
}
const TIP = W.winglet!;
/**
 * The visual's winglet is swept along its QUARTER-CHORD line by `sweep` over its own length; the geometry gives the
 * leading-edge rake in plan over the 0.415 m it covers in span (G-da20 hand-off, note 4).
 */
const TIP_SPAN = TIP.height * Math.cos(TIP.cant);
const TIP_QC_SWEEP = Math.atan((TIP_SPAN * Math.tan(TIP.sweep) - 0.25 * (TIP.rootChord - TIP.tipChord)) / TIP.height);

const WING: WingVisualDef = {
  mount: 'low',
  section: FX63_137,
  // The root station on the fuselage side, then the start of the raked tip.
  breaks: [wingStation(W.rootY), W.breaks![1]],
  rootY: W.rootY,
  qcZ: W.quarterChord.z,
  dihedral: W.dihedral,
  rootIncidence: W.rootIncidence,
  tipIncidence: W.tipIncidence,
  // The wing ends just under the fuselage skin (the root stubs are part of the fuselage shells).
  root: 'conform',
  bays: [
    { kind: 'fixed', from: W.rootY, to: W.flap.innerY },
    { kind: 'flap', from: W.flap.innerY, to: W.flap.outerY, chordFraction: W.flap.chordFraction },
    { kind: 'aileron', from: W.aileron.innerY, to: W.aileron.outerY, chordFraction: W.aileron.chordFraction },
    { kind: 'fixed', from: W.aileron.outerY, to: TIP.rootY! },
  ],
  // Slotted flaps on external hinge brackets under the wing (s.2.3): a little aft and down as they go to 45 degrees.
  flap: { maxDeflection: W.flap.maxDeflection, travelAft: 0.04, travelDown: 0.03 },
  // A blended upturned tip, not a separate winglet plate (s.12): the tip section turns up and narrows into it.
  tip: {
    round: 0.1,
    chordRound: 0.1,
    winglet: { height: TIP.height, cant: TIP.cant, rootChord: TIP.rootChord, tipChord: TIP.tipChord, sweep: TIP_QC_SWEEP, section: TIP_SECTION },
  },
  // One fuselage tank: no caps on the wing. The pitot-static probe under the left wing (s.9, s.12).
  fuelCaps: [],
  pitot: { side: -1, y: 2.9, xc: 0.2 },
  // Short triangular stall strips on the outboard leading edges (s.2.1; span station estimated). The stall warner
  // is a pneumatic hole, not a vane.
  stallStrips: [{ y0: 3.3, y1: 3.55 }],
};

// --- Tail: swept fin with the tailplane on top (T-tail), one-piece elevator, rudder with a fixed tab ------------

/** Height of the fin from its base to its tip quarter-chord point (the fin planform's span parameter), m. */
const FIN_HEIGHT = V.base.z - V.tip.z;

const TAIL: TailVisualDef = {
  section: NACA0012,
  h: {
    span: H.span,
    rootChord: H.rootChord,
    tipChord: H.tipChord,
    quarterChord: { x: H.quarterChord.x, z: H.quarterChord.z },
    tipQuarterChordX: H.tipQuarterChordX,
    incidence: H.incidence,
    kind: 'elevator',
    chordFraction: H.elevator.chordFraction,
    // One-piece elevator across the full span, no tab (spring-bias trim, s.9).
    innerCutY: 0,
  },
  v: {
    base: { x: V.base.x, z: V.base.z },
    tip: { x: V.tip.x, z: V.tip.z },
    rootChord: V.rootChord,
    tipChord: V.tipChord,
    rudderChordFraction: V.rudder.chordFraction,
    // The tall, broad rudder runs on below the boom top behind the boom's end (station 12, s.12).
    rudderExtension: { bottomH: -0.16, aftChord: 0.42 },
    // The fixed ground-adjustable tab on the rudder (s.2.5).
    rudderTab: { h0: 0.12, h1: 0.32, xc: 0.88 },
  },
  tTail: true,
  // A short curved dorsal fillet where the fin meets the boom (s.12: no long dorsal fin).
  dorsalFillet: { x0: NX(5.45), height: 0.14 },
  // The small ventral tail skid under the boom's end (s.2.5, s.12).
  ventralFin: { x0: NX(6.2), x1: NX(6.55), depth: 0.09 },
};

// --- Fuselage: the station table of s.12 ------------------------------------------------------------------------

/** Spinner base and cowl front face, just behind the propeller plane (s.12 station 2; s.5 propeller plane 0.19). */
const FRONT_X = NX(0.25);
/** End of the tail boom under the rudder hinge (s.12 station 12). */
const END_X = NX(6.6);
/** Firewall and cowl rear edge (s.12 station 4). */
const FIREWALL_X = NX(1.05);
/** Behind the seats: the baggage shelf over the tank ends here, where the fuselage pinches in (s.12 station 7-8). */
const CABIN_REAR_X = NX(2.95);

type Key = [x: number, zTop: number, zBot: number, zMid: number, hw: number, nTop: number, nBot: number, ridge: number];

/**
 * A station of s.12: x aft of the spinner tip, the top and bottom of the section and the height of its widest
 * point above FRL, the width, and the superellipse exponents of the upper and lower halves.
 */
const station = (xn: number, top: number, bot: number, mid: number, width: number, nTop: number, nBot: number): Key => [
  NX(xn), FZ(top), FZ(bot), FZ(mid), width / 2, nTop, nBot, 0,
];

/** Height of the propeller hub above FRL (s.4), the centre of the spinner and of the cowl face. */
const HUB_UP = 0.05;

const KEYS: Key[] = [
  // The cowl face closes around the spinner backplate, then opens to a wide, shallow rounded rectangle.
  station(0.25, HUB_UP + 0.15, HUB_UP - 0.15, HUB_UP, 0.3, 2, 2),
  station(0.255, 0.26, -0.16, HUB_UP, 0.62, 2.6, 2.6),
  station(0.32, 0.3, -0.2, 0.05, 0.72, 2.8, 2.7),
  // Mid cowl, then the firewall: the lower cowl deepens toward the belly, the cowl deck rises to the windscreen.
  station(0.6, 0.36, -0.27, 0.04, 0.84, 2.8, 2.6),
  station(1.05, 0.395, -0.435, 0.04, 1.0, 2.6, 2.4),
  // The canopy: the windscreen rakes up from the cowl deck (x 1.14, +0.40) to the apex (2.15, +0.69); the cabin
  // is an egg, widest at the sill, its lower half fuller round the seat shells and the belly gently flattened (s.12
  // cross-sections).
  station(1.2, 0.455, -0.45, 0.12, 1.03, 2.2, 3.0),
  station(1.45, 0.56, -0.47, 0.15, 1.05, 2.1, 3.6),
  station(1.75, 0.64, -0.48, 0.17, 1.06, 2.05, 3.6),
  station(2.15, 0.695, -0.485, 0.18, 1.07, 2.0, 3.6),
  station(2.45, 0.69, -0.48, 0.18, 1.02, 2.0, 3.2),
  // The canopy's rear hoop, then the fuselage pinches sharply into the boom; the top line falls in a concave sweep.
  station(2.7, 0.645, -0.47, 0.16, 0.92, 2.0, 2.7),
  station(3.2, 0.48, -0.41, 0.07, 0.62, 2.05, 2.2),
  station(3.6, 0.36, -0.36, 0.02, 0.56, 2.0, 2.1),
  station(4.0, 0.27, -0.31, -0.01, 0.5, 2.0, 2.0),
  // The tail boom: a slightly upright ellipse, tapering smoothly.
  station(5.0, 0.16, -0.22, -0.03, 0.35, 2.0, 2.0),
  station(5.8, 0.11, -0.18, -0.04, 0.24, 2.0, 2.0),
  station(6.45, 0.065, -0.125, -0.03, 0.16, 2.0, 2.0),
  station(6.6, 0.02, -0.06, -0.02, 0.04, 2.0, 2.0),
];

/**
 * The cooling inlets: two ovals in the cowl face beside the spinner, and one wide low rectangular chin inlet under
 * it for induction, heater and oil cooler air (s.12 "Cowling").
 */
const COWL_INLETS: AirframeVisualDef['fuselage']['inlets'] = [
  { y: -0.215, z: FZ(HUB_UP + 0.01), w: 0.13, h: 0.1, r: 0.04, exponent: 2.3, xMin: FRONT_X - 0.05, baffleX: FRONT_X - 0.16 },
  { y: 0.215, z: FZ(HUB_UP + 0.01), w: 0.13, h: 0.1, r: 0.04, exponent: 2.3, xMin: FRONT_X - 0.05, baffleX: FRONT_X - 0.16 },
  { y: 0, z: FZ(-0.115), w: 0.24, h: 0.055, r: 0.02, exponent: 4, xMin: FRONT_X - 0.05, baffleX: FRONT_X - 0.14 },
];

const FUSELAGE: AirframeVisualDef['fuselage'] = {
  keys: KEYS,
  frontX: FRONT_X,
  endX: END_X,
  ridgeW: 0.04,
  grid: { rows: 150, cols: 96 },
  nose: 'prop',
  inlets: COWL_INLETS,
  // One exhaust stub out of the lower cowl, offset to the right (s.12).
  exhaust: { pos: [NX(0.98), 0.17, FZ(-0.4)], radius: 0.024 },
  antennas: [
    // COM and VOR antennas are inside the fin and tailplane (s.12). Outside: the ELT whip on the upper aft
    // fuselage, the transponder blade under the belly. (The flat GPS puck behind the canopy has no part kind:
    // a blade of any height reads as a fin, so it is left out.)
    { kind: 'whip', pos: [NX(3.45), 0, FZ(0.4)], height: 0.42 },
    { kind: 'stub', pos: [NX(3.0), 0, FZ(-0.405)], height: 0.09 },
  ],
};

// --- Canopy (side projection: x, z) --------------------------------------------------------------------------------

/** Canopy base at the windscreen (x 1.14 m, +0.40) and the sill line, nearly level (+0.17 to +0.20, s.12). */
const CANOPY_FRONT: readonly [number, number] = [NX(1.14), FZ(0.4)];
const SILL_UP = 0.18;
/** Where the windscreen's lower edge comes down the side onto the sill. */
const SILL_FRONT_X = NX(1.42);
/** The rear frame rakes forward from the rear hoop's top (x 2.70) down to the sill at x 2.42 (s.12). */
const SILL_REAR_X = NX(2.42);
const HOOP_X = NX(2.7);
const HOOP_Z = FZ(0.64);
/** Above everything: the outline only bounds the glass at its front, rear and sill. */
const ABOVE = -1.4;

const GLAZING: GlazingDef = {
  cabinFrontX: FIREWALL_X,
  cabinRearX: CABIN_REAR_X,
  firewallX: FIREWALL_X,
  tRange: [0.2, 0.8],
  // The one-piece tinted bubble, windscreen included: the sill, the windscreen's base on the cowl deck, the rear
  // frame. One outline from the sill to over the roof (the whole upper half of the cabin is glass).
  windows: [
    {
      pts: [
        [CANOPY_FRONT[0], ABOVE],
        [HOOP_X, ABOVE],
        [HOOP_X, HOOP_Z],
        [SILL_REAR_X, FZ(SILL_UP)],
        [SILL_FRONT_X, FZ(SILL_UP)],
        CANOPY_FRONT,
      ],
      r: 0.05,
      sides: 'both',
    },
  ],
  // The joint between the white GFRP canopy frame and the fuselage, a little outside the glass.
  doors: [
    {
      pts: [
        [CANOPY_FRONT[0] + 0.03, ABOVE],
        [HOOP_X - 0.05, ABOVE],
        [HOOP_X - 0.05, HOOP_Z + 0.04],
        [SILL_REAR_X - 0.05, FZ(SILL_UP - 0.04)],
        [SILL_FRONT_X + 0.03, FZ(SILL_UP - 0.04)],
        [CANOPY_FRONT[0] + 0.03, CANOPY_FRONT[1] + 0.03],
      ],
      r: 0.07,
      sides: 'both',
    },
  ],
  // No headliner under a canopy.
  liningRoofLimit: -1e9,
  xRange: [FIREWALL_X, CABIN_REAR_X],
};

// --- Landing gear: leaf-spring mains, a castering nose leg, white teardrop spats on all three -------------------

const mainWheel = (contact: { x: number; y: number; z: number }, side: 1 | -1): WheelVisualDef => ({
  contact: [contact.x, contact.y, contact.z],
  radius: G.mainWheelRadius,
  // 5.00-5 tyre, about 0.126 m wide; 5 in rim (s.3).
  width: 0.126,
  rimRadius: 0.0635,
  // Flat tapered aluminium leaf springs out of the fuselage underside below the wing root, running outward and
  // down at about 40 degrees to the wheels (s.12).
  leg: { kind: 'leafSpring', root: [contact.x + 0.02, side * 0.3, FZ(-0.42)], width: 0.13, thickness: 0.026 },
  // Teardrop spats, about 0.9 m long, 0.25 m wide, pointed at the rear (s.12).
  fairing: { length: 0.9, halfWidth: 0.125, top: 0.2, bottom: 0.11 },
});

const GEAR: AirframeVisualDef['gear'] = [
  {
    contact: [G.nose.x, G.nose.y, G.nose.z],
    radius: G.noseWheelRadius,
    // 5.00-4 tyre, about 0.127 m wide; 4 in rim (s.3).
    width: 0.127,
    rimRadius: 0.0508,
    // A slim steel tube pivoted under the firewall, running forward and down to the castering fork under the front
    // of the cowl (s.12); it does not follow the pedals (the visual turns it with the wheel's caster angle).
    leg: { kind: 'springTube', root: [FIREWALL_X - 0.02, 0, FZ(-0.42)], axleOffset: 0, r0: 0.024, r1: 0.019 },
    fairing: { length: 0.78, halfWidth: 0.11, top: 0.19, bottom: 0.1 },
  },
  mainWheel(G.leftMain, -1),
  mainWheel(G.rightMain, 1),
];

// --- Propeller: Sensenich W69EK7-63, two-blade fixed-pitch wood, clockwise seen from the cockpit -----------------

/** Geometric pitch at 0.75 R, m: 62.8 in (s.5). */
const PROP_PITCH = 62.8 * 0.0254;
/** Spinner: about 0.29 m across and 0.30 m long, a pointed ogive (s.5, s.12). */
const SPINNER_BASE_X = FRONT_X + 0.005;

const PROP: PropVisualDef = {
  hub: [P.hub.x, P.hub.y, P.hub.z],
  diameter: P.diameter,
  blades: P.blades,
  rotation: P.rotation,
  // 21.1 degrees at 0.75 R (s.5).
  referencePitch: Math.atan(PROP_PITCH / (2 * Math.PI * 0.75 * (P.diameter / 2))),
  variablePitch: false,
  // A wooden blade: broad at mid radius, thick at the root.
  chord: [
    [0.1, 0.08],
    [0.2, 0.11],
    [0.35, 0.135],
    [0.55, 0.14],
    [0.75, 0.125],
    [0.9, 0.1],
    [0.97, 0.072],
    [1.0, 0.03],
  ],
  geometricPitch: PROP_PITCH,
  spinner: { baseX: SPINNER_BASE_X, radius: 0.145, length: DA20_GEOMETRY.fuselage.noseX - SPINNER_BASE_X },
  // Varnished laminated wood, white tips (s.12).
  paint: { face: [0.42, 0.26, 0.13], back: [0.36, 0.22, 0.11], tip: [0.9, 0.9, 0.88], tipBand: 0.06 },
};

// --- Exterior lamps --------------------------------------------------------------------------------------------------

const LAMPS: readonly LampVisualDef[] = ((): LampVisualDef[] => {
  // Position light and strobe in the upturned tip (s.9, s.12).
  const tipPlanform = makeWingletPlanform(WING);
  const tip = (h: number, xc: number, side: 1 | -1): FRD => {
    const p = sectionPoint(tipPlanform, TIP.height * h, xc, 0);
    return [p.x, p.y * side, p.z];
  };
  // White tail light at the rudder's trailing edge low on the fin, swinging with it.
  const tail = sectionPoint(makeRudderPlanform(TAIL), 0.12, 1, 0);
  // The beacon on the tailplane's bullet fairing over the fin tip.
  const finTip = sectionPoint(makeFinPlanform(TAIL), FIN_HEIGHT - 0.01, 0.4, 0);
  // Landing and taxi lights behind one clear cover in the left wing leading edge, outboard (s.9, s.12).
  const leadingEdge = (y: number): FRD => {
    const c = wingStation(y);
    const dz = (y - W.rootY) * Math.tan(W.dihedral);
    return [c.qcX + 0.25 * c.chord - 0.01, -y, W.quarterChord.z - dz + 0.01];
  };
  return [
    { id: 'navL', pos: tip(0.55, 0.08, -1), radius: 0.028, glowOffset: [0.03, -0.03, 0] },
    { id: 'navR', pos: tip(0.55, 0.08, 1), radius: 0.028, glowOffset: [0.03, 0.03, 0] },
    { id: 'navTail', pos: [tail.x - 0.015, tail.y, tail.z], radius: 0.02, glowOffset: [-0.03, 0, 0], parent: 'rudder' },
    { id: 'strobeL', pos: tip(0.55, 0.3, -1), radius: 0.02, glowOffset: [0, -0.03, 0] },
    { id: 'strobeR', pos: tip(0.55, 0.3, 1), radius: 0.02, glowOffset: [0, 0.03, 0] },
    { id: 'beacon', pos: [finTip.x, 0, finTip.z - 0.1], radius: 0.03, glowOffset: [0, 0, -0.04] },
    { id: 'landing', pos: leadingEdge(4.05), radius: 0.04, glowOffset: [0.03, 0, 0], aim: { downDeg: 3, outDeg: 0, halfAngleDeg: 9 } },
    { id: 'taxi', pos: leadingEdge(3.8), radius: 0.04, glowOffset: [0.03, 0, 0], aim: { downDeg: 7, outDeg: 4, halfAngleDeg: 24 } },
  ];
})();

// --- Fairings ----------------------------------------------------------------------------------------------------------

/**
 * A station of the root fillet: x aft of the spinner tip, its half-width from the centre line, the height of its
 * mid-plane and its half-thickness (m, from the wing's quarter-chord height, + up).
 */
const filletKey = (xn: number, hw: number, up: number, half: number): Key => [NX(xn), -up - half, -up + half, -up, hw, 2, 2, 0];

/**
 * The trailing-edge root fillet (s.12): it extends the root chord locally to about 1.39 m and blends the wing
 * into the pinching fuselage. A thin plate across the fuselage on the wing's mean line, so only its edges show:
 * inside the wing's aft root ahead of the trailing edge (x 3.00 at the root), then a curved wedge behind it from
 * about 0.55 m out to the fuselage skin at station 8 (x 3.18).
 */
const ROOT_FILLET: FairingDef = {
  keys: [
    filletKey(2.7, 0.34, 0.06, 0.018),
    filletKey(2.85, 0.5, 0.043, 0.014),
    filletKey(2.95, 0.55, 0.032, 0.009),
    filletKey(3.0, 0.5, 0.024, 0.008),
    filletKey(3.06, 0.41, 0.022, 0.007),
    filletKey(3.12, 0.32, 0.022, 0.006),
    filletKey(3.18, 0.255, 0.022, 0.005),
    filletKey(3.24, 0.2, 0.022, 0.003),
  ],
  frontX: NX(2.7),
  endX: NX(3.24),
  offset: { y: 0, z: W.quarterChord.z },
  grid: { rows: 32, cols: 24 },
  paint: 'base',
};

// --- Cockpit ---------------------------------------------------------------------------------------------------------

// The cockpit is fitted to the pilot's eye of the geometry where a person is (seat, stick, pedals) and to the
// airframe where the structure is (panel, glareshield, floor, console).
/** Instrument panel face: vertical, facing aft, at x 1.33 m (s.12 station 5), centred, 0.96 m x 0.29 m (panel.ts). */
const PANEL_X = NX(1.33);
const PX = DA20_PANEL_PX_PER_M;
/** Panel top: low, so the face's top corners stay inside the canopy's flank (the real panel is a flattened arch). */
const PANEL_ZTOP = FZ(0.22);
const PANEL_ZB = PANEL_ZTOP + DA20_PANEL_PX_RECT.h / PX;
/** A point of the panel canvas, px, on the face (FRD y, z). */
const faceY = (px: number): number => (px - DA20_PANEL_CENTRE_PX) / PX;
const faceZ = (py: number): number => PANEL_ZTOP + (py - DA20_PANEL_PX_RECT.y) / PX;
/** Cabin floor (the tub, top of the carpet), about 0.14 m above the belly skin under the seats. */
const FLOOR_Z = FZ(-0.34);
/**
 * Lateral station of the seats, the sticks and the pedals: 2 cm inboard of the pilot's eye (geometry.ts, a quarter
 * of the cabin width), so the seat shells sit inside the narrowing lower tub.
 */
const SEAT_Y = -EYE.y - 0.02;
/** Seat cushion: its front edge and top. The pilot's eye is 0.69 m above the cushion, 0.2 m ahead of the reclined back. */
const SEAT_X = EYE.x + 0.66;
const SEAT_Z = EYE.z + 0.69;
/** Centre console: the quadrant's pivots on its sloping top. */
const QUADRANT = { x: PANEL_X - 0.25, z: FZ(-0.12) };
/** Fixed reclined seat shells with the backs at about 28 degrees (s.2.6, s.12). */
const RECLINE_DEG = 28;
const SEAT_WIDTH = 0.38;

const COCKPIT: CockpitDef = {
  pilotEye: [EYE.x, EYE.y, EYE.z],
  /** Default view: 8 degrees nose-down from level, over the glareshield onto the cowl. */
  defaultPitchDeg: -8,
  enclosure: 'canopy',
  // A low panel: the upper 624 px of the canvas (contract 5.3).
  panel: { x: PANEL_X, zTop: PANEL_ZTOP, width: DA20_PANEL_WIDTH, pxRect: DA20_PANEL_PX_RECT },
  floor: { z: FLOOR_Z, x0: FIREWALL_X - 0.05, x1: CABIN_REAR_X + 0.15 },
  // Black glareshield over the panel: a lip, then a padded top rising gently forward toward the windscreen's base
  // on the cowl deck (s.12), as wide as the cabin lets it be there.
  glareshield: {
    profile: [
      [PANEL_X - 0.03, PANEL_ZTOP - 0.0015],
      [PANEL_X - 0.04, PANEL_ZTOP - 0.012],
      [PANEL_X - 0.032, PANEL_ZTOP - 0.026],
      [PANEL_X + 0.02, PANEL_ZTOP - 0.036],
      [PANEL_X + 0.08, PANEL_ZTOP - 0.045],
      [PANEL_X + 0.15, FZ(0.28) + 0.004],
      [PANEL_X + 0.165, FZ(0.28) + 0.012],
      [PANEL_X + 0.165, PANEL_ZTOP + 0.01],
      [PANEL_X, PANEL_ZTOP - 0.0015],
    ],
    halfWidth: 0.44,
  },
  // Two fixed seat shells side by side, low in the tub and reclined; x is the cushion's front edge, z its top.
  seats: [
    { x: SEAT_X, y: -SEAT_Y, kind: 'shell', width: SEAT_WIDTH, depth: 0.48, reclineDeg: RECLINE_DEG, z: SEAT_Z },
    { x: SEAT_X, y: SEAT_Y, kind: 'shell', width: SEAT_WIDTH, depth: 0.48, reclineDeg: RECLINE_DEG, z: SEAT_Z },
  ],
  consoles: [
    // The centre console from the lower edge of the panel aft between the seats, its top sloping down toward the
    // panel: the quadrant at its front, the trim rocker and the fuel shut-off behind it (s.9).
    {
      min: [CABIN_REAR_X + 0.35, -0.075, PANEL_ZB - 0.01],
      max: [PANEL_X, 0.075, FLOOR_Z],
      bevel: 0.015,
      material: 'panelPlastic',
      profile: [
        [PANEL_X, PANEL_ZB - 0.01],
        [PANEL_X, FLOOR_Z],
        [CABIN_REAR_X + 0.35, FLOOR_Z],
        [CABIN_REAR_X + 0.35, FZ(-0.14)],
        [QUADRANT.x - 0.05, QUADRANT.z + 0.004],
      ],
    },
    // The quadrant's slotted face plate on the console top.
    { min: [QUADRANT.x - 0.07, -0.06, QUADRANT.z - 0.006], max: [QUADRANT.x + 0.07, 0.06, QUADRANT.z + 0.004], bevel: 0.004, material: 'black' },
    // The baggage shelf behind the seats, over the fuel tank (s.2.6), and the light grey tub's rear bulkhead.
    { min: [CABIN_REAR_X + 0.02, -0.38, FZ(0.04)], max: [CABIN_REAR_X + 0.32, 0.38, FZ(-0.02)], bevel: 0.012, material: 'carpet' },
  ],
  // Light grey composite tub: a moulded side panel along each sill under the canopy edge, carpet below.
  trimPanels: [
    { side: 0, x0: FIREWALL_X - 0.01, x1: CABIN_REAR_X + 0.05, z0: FZ(SILL_UP) + 0.02, z1: FZ(-0.1), relief: 0.008, material: 'trimPlastic', grid: { rows: 48, cols: 20 }, edge: 0.03 },
    { side: 0, x0: FIREWALL_X - 0.01, x1: CABIN_REAR_X + 0.1, z0: FZ(-0.1), z1: FLOOR_Z + 0.02, relief: 0.005, material: 'carpet', grid: { rows: 40, cols: 10 }, edge: 0.01, openBelow: true },
  ],
  // The footwell is closed: the tub's carpet runs up the firewall just ahead of the pedals to under the panel.
  fittings: { toeBoard: { x0: FIREWALL_X - 0.04, x1: FIREWALL_X - 0.005, z: FZ(0.02) } },
  // One figure for the external views (contract 5.3), in the left seat.
  occupants: [{ seat: 0 }],
  // A centre stick in front of each seat, between the knees, with a leather boot (s.9, s.12).
  // The grips at knee height, below the switch row and the key from the pilot's eye.
  column: { kind: 'stick', pivot: [SEAT_X + 0.1, 0, FLOOR_Z - 0.02], height: 0.35, pitchDeg: 14, rollDeg: 14, ys: [-SEAT_Y, SEAT_Y] },
  // Adjustable pedals with toe brakes, near the firewall.
  pedals: { x: FIREWALL_X - 0.1, ys: [-SEAT_Y, SEAT_Y] },
  // The three-lever quadrant side by side (s.9): alternate air left (forward = normal), throttle centre, the red
  // mixture right.
  engineControls: [
    { kind: 'lever', control: 'alternateAir', engine: 0, pos: [QUADRANT.x, -0.035, QUADRANT.z], travel: 50 * DEG, colour: 'black', length: 0.08 },
    { kind: 'lever', control: 'throttle', engine: 0, pos: [QUADRANT.x, 0, QUADRANT.z], travel: 50 * DEG, colour: 'black', length: 0.1 },
    { kind: 'lever', control: 'mixture', engine: 0, pos: [QUADRANT.x, 0.035, QUADRANT.z], travel: 50 * DEG, colour: 'red', length: 0.09 },
  ],
  // The three-position flap switch on the lower centre of the panel, beside its lights (panel.ts).
  flapControl: { kind: 'panelSwitch', pos: [PANEL_X, faceY(DA20_FLAP_SWITCH[0]), faceZ(DA20_FLAP_SWITCH[1])], travel: 40 * DEG },
  // Magnetic compass on top of the glareshield at the centre (s.12).
  compass: { pos: [PANEL_X + 0.08, 0, PANEL_ZTOP - 0.081] },
  // The overhead light module between the seat backs (s.12) carries the flood light, aimed at the panel.
  lamps: { flood: { pos: [CABIN_REAR_X + 0.15, 0, FZ(0.58)], aim: [PANEL_X, 0, PANEL_ZTOP + 0.12] } },
  // Simplified cabin for the occlusion bake: tub floor, the canopy as a glazed roof, flat sides at the sill width,
  // rear bulkhead, panel face and glareshield, the canopy's base on the cowl deck.
  box: {
    floor: FLOOR_Z,
    roof: FZ(0.69),
    side: 0.51,
    rear: CABIN_REAR_X,
    panelX: PANEL_X,
    glareshieldZ: PANEL_ZTOP - 0.03,
    sillZ: FZ(SILL_UP),
    windscreenX: CANOPY_FRONT[0],
    roofGlazed: true,
  },
  // Outward unit normals and areas, m^2, from the canopy outline: its top, the raked windscreen, the two flanks.
  glazingPanels: [
    { n: [0, 0, -1], area: 1.0 },
    { n: [0.6, 0, -0.8], area: 0.55 },
    { n: [0, -1, 0], area: 0.45 },
    { n: [0, 1, 0], area: 0.45 },
  ],
  // Tub floor, sides under the sill, the bulkhead, the panel and the seats.
  interiorArea: 6,
  // Controls the instructor points at that have no 3D part: the fuel shut-off and the parking-brake knob on the
  // console, the trim rocker behind the quadrant (s.9).
  controlPoints: {
    fuelSelector: [QUADRANT.x - 0.24, 0.05, FZ(-0.135)],
    parkingBrake: [QUADRANT.x + 0.1, 0.045, QUADRANT.z - 0.01],
    trimWheel: [QUADRANT.x - 0.13, 0, FZ(-0.128)],
  },
};

// --- Paint: white overall with thin sweeping stripes (s.12) ----------------------------------------------------------

const LIVERY: LiveryDef = {
  registration: 'N220FS',
  // Always white overall (the structural temperature limit, s.7), a dark blue stripe with a silver line.
  palette: { base: [244, 244, 240], band: [24, 44, 104], accent: [150, 154, 160] },
  // The stripe starts on the cowl behind the spinner, runs aft under the canopy sill and sweeps up along the boom to
  // the fin; its nose end is sheared so that it sweeps.
  stripe: {
    xs: [NX(6.3), NX(5.6), NX(4.8), NX(4.0), NX(3.3), NX(2.6), NX(1.8), NX(1.1), NX(0.6), NX(0.32)],
    centre: [FZ(0.05), FZ(0.06), FZ(0.08), FZ(0.1), FZ(0.08), FZ(0.06), FZ(0.06), FZ(0.08), FZ(0.08), FZ(0.06)],
    half: [0.012, 0.015, 0.018, 0.022, 0.026, 0.028, 0.028, 0.026, 0.022, 0.018],
    noseShearX: NX(0.4),
  },
  // The registration on the tail boom between the wing trailing edge and the fin, below the stripe (s.12).
  lettering: { x0: NX(5.15), x1: NX(3.75), z0: FZ(0.0), z1: FZ(-0.17) },
  construction: 'composite',
  skinJoints: [],
  // The two-piece cowling's split line along the hub, the oil filler door in the upper cowl (s.12).
  cowlSplitZ: FZ(HUB_UP),
  soot: { x: NX(1.0), y: 0.17 },
  cowl: { oilDoor: { x: NX(0.75), halfLength: 0.08, halfWidth: 0.07 } },
  // The stripe sweeps up the fin: z = bandZ0 + (x - bandX0) * slope, no cap under the tailplane.
  fin: { bandZ0: FZ(0.18), bandX0: NX(5.75), slope: 0.85, cap: 0 },
  // The two-seaters may use the smaller texture.
  texture: { w: 2048, h: 1024 },
};

export const DA20_VISUAL: AirframeVisualDef = {
  id: 'da20',
  fuselage: FUSELAGE,
  glazing: GLAZING,
  wing: WING,
  tail: TAIL,
  gear: GEAR,
  props: [PROP],
  nacelles: [],
  fairings: [ROOT_FILLET],
  lamps: LAMPS,
  cockpit: COCKPIT,
  livery: LIVERY,
  shadow: {
    halfX: 5.6,
    halfY: 6.0,
    // Belly band: centre x, half length, half width (cowl to boom).
    fuselage: [-1.1, 2.9, 0.5],
    // Wing band: centre x, half span of its core, and the height of the wing above the ground (a low wing: firm).
    wingX: -0.2,
    wingY: 4.4,
    wingHeight: DA20_GEOMETRY.restHeight - W.quarterChord.z,
    restHeight: DA20_GEOMETRY.restHeight,
  },
};

export default DA20_VISUAL;
