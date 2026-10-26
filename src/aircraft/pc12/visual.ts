// Pilatus PC-12/47: the airframe as data for the 3D model, the cameras and the livery worker. PLAIN and
// structured-cloneable: no three.js, no functions, no class instances (the worker imports this file through
// aircraft/visualLoader.ts and nothing else of the aircraft).
//
// What the flight model and the picture must agree on comes from ./geometry (the propeller hub and disc, the wheel
// contact points and radii, the wing span, area, chords, dihedral and flap/aileron stations, the tailplane span and
// quarter-chord, the overall length); the panel face's pixel layout from ./panelLayout (P3's names). Everything else
// is shaped here from the POH three-view (Pilatus Report 02277 Fig 1-1, PDF p. 70, 47E-PROXY: same airframe) and the
// Wikimedia Commons photographs listed in docs/pc12-exterior.md (modelling references only, never textures).
//
// Tags: 3V = measured on Fig 1-1 at 300 dpi (side view 41.5 px/m vertically, 40.8 px/m along the body; front view
// 126 px/m); PHOTO = read from a photograph; TCDS / 47E = the documents of docs/pc12-sources.md; ESTIMATE = judged.
//
// HEIGHTS. Every height below is written as a height above level ground at rest (h, metres) and converted with
// hz(h) = PC12_REST_HEIGHT - h, so the drawing follows the reference point if P1 moves the CG height. The 3V puts the
// fuselage between 0.99 m (belly line) and 2.80 m (roof line) above the ground (the 6 ft bracket of Fig 1-1 is the
// fuselage DEPTH: rows 1014 and 1089 of the page against the ground line at row 1130), and the spinner centre at
// 1.60 m (front view) to 1.73 m (side view). The cabin below is the side view lowered by 0.07 m so that the drawing's
// thrust line meets geometry.ts's hub height (1.635 m); the nose is written against that thrust line. NOTE: geometry.ts
// (P1, ESTIMATE) still has the belly at 0.50, the roof at 2.33, the wing root chord plane at 0.70 and the pilot's eye
// at 2.03 m, read from the same bracket as if it stood on the ground; the values used here and requested for
// geometry.ts are the constants ROOF_H .. FLOOR_H below (docs/pc12-exterior.md, "Requested geometry changes").
//
// The type: a long pointed nose over the PT6A-67B (reverse flow: the air enters the crescent chin inlet under the
// spinner, the exhaust leaves through two stubs, one each side of the cowling behind the propeller), a round
// pressurised cabin with a large raked windscreen, the airstair door forward and the big cargo door aft on the left,
// oval cabin windows (four left, five right with the over-wing exit), a low straight-tapered wing with 5 degrees of
// dihedral, small upturned winglets, large single-slotted Fowler flaps on track fairings and black de-ice boots; a
// long tailcone with a dorsal fin, a pair of ventral strakes, a tall swept fin and a T-tail whose whole stabiliser
// trims under a bullet fairing; trailing-link mains folding inward into the wing root, a nose leg folding aft, a
// four-blade reversing Hartzell. Inside: two crew seats, two control wheels, the analogue panel, the centre pedestal
// with the MANUAL OVERRIDE, POWER and CONDITION levers and the flap selector, the gear handle left of the CAWS.

import { makeWingPlanform, sectionPoint, surfacePoint } from '../../render/aircraft/planformMath';
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
import { PC12_FUSELAGE, PC12_GEAR, PC12_GEOMETRY, PC12_PROP, PC12_REST_HEIGHT, PC12_TAIL, PC12_THRUST_Z, PC12_WING } from './geometry';
import { PC12_GEAR_HANDLE, PC12_PANEL_CENTRE_PX, PC12_PANEL_PX_PER_M, PC12_PANEL_PX_RECT, PC12_PEDESTAL, PC12_YOKES } from './panelLayout';

const DEG = Math.PI / 180;
/** FRD x of a station (m aft of the datum; geometry.ts: x = 6.00 - station). */
const sx = (station: number): number => 6.0 - station;
/** FRD z of a height above the ground at rest. */
const hz = (h: number): number => PC12_REST_HEIGHT - h;
/** Height of the thrust line (the propeller hub) above the ground; the nose is written against it. */
const T_H = PC12_REST_HEIGHT - PC12_THRUST_Z;

// --- The 3V heights (requested for geometry.ts; see the header) ------------------------------------------------------

/** Cabin roof line: 3V 2.80 m (side view row 1014) less the 0.07 m alignment. */
const ROOF_H = 2.73;
/** Belly line under the cabin: 3V 0.99 m (row 1089) less 0.07. */
const BELLY_H = 0.93;
/** Windscreen sill on the centre line: 3V 2.25 m at station 3.30 less 0.07. */
const SILL_H = 2.18;
/** Wing root chord plane at the fuselage side: 3V front view 1.03-1.10 m (root fairing bottom 0.87, top 1.27). */
const WING_ROOT_PLANE_H = 1.05;
/**
 * Pilot's eye: 0.30 m under the windscreen's top line over the seat (station 4.2: 2.63 m), at the middle of the cockpit
 * side window (3V 2.19-2.52 m), 1.15 m above the floor.
 */
const EYE_H = 2.33;
/**
 * Station of the eye: 4.20, 0.13 m aft of the W&B pilot arm (160.27 in = 4.071 m, the occupant's centre of gravity).
 * geometry.ts has 4.00: there the windscreen glass would stand 0.25 m in front of the face (3V top line 2.51 m).
 */
const EYE_STATION = 4.2;
/** Cabin floor (the airstair door sill: 3V 1.27 m less 0.07 = 1.20; the floor a little below it). */
const FLOOR_H = 1.18;

/** Pilot's eye: EYE_STATION, 0.40 m left of the centre line (geometry.ts's PC12_EYE.y), EYE_H. */
const EYE = { x: sx(EYE_STATION), y: -0.4, z: hz(EYE_H) } as const;

/** Wing section: NASA LS(1)-0417 MOD at the root, about 2 % camber at 40 %, 16.5 % thick (the tip's 0313 is thinner). */
const LS1_0417: SectionShape = { m: 0.022, p: 0.4, t: 0.165 };
/** Tail sections, about NACA 0012. */
const TAIL_SECTION: SectionShape = { m: 0, p: 0.4, t: 0.12 };
/** The winglet, a thin symmetrical section. */
const WINGLET_SECTION: SectionShape = { m: 0, p: 0.4, t: 0.1 };

// --- Wing: straight taper from the fuselage to the tip, winglets, Fowler flaps, de-ice boots ------------------------

/** Half the TCDS span: the winglets' outer tips. */
const HALF_SPAN = PC12_WING.span / 2;
/** The winglet: 0.45 m high (geometry.ts), canted 62 deg up from the wing plane (ESTIMATE between the three-view's
 * front view, about 30 deg, and the photographs, 60-70 deg). */
const WINGLET_CANT = 62 * DEG;
/** The flat wing's tip station: inboard of the half span by the winglet's outward reach, so that the drawing keeps
 * the TCDS span of 16.28 m to the winglet tips (geometry.ts still ends the wing at 8.14: requested). */
const TIP_Y = HALF_SPAN - PC12_WING.winglet.height * Math.cos(WINGLET_CANT) - 0.045;
/** Chord of the straight-tapered trapezoid (2.10 m on the centre line, 1.08 at the half span; geometry.ts). */
const chordAt = (y: number): number => PC12_WING.rootChord + ((PC12_WING.tipChord - PC12_WING.rootChord) * y) / HALF_SPAN;

/** The aileron's outer end: geometry.ts's 7.95 m, held 8 cm inside the flat wing's tip. */
const AILERON_OUTER_Y = Math.min(PC12_WING.aileron.outerY, TIP_Y - 0.08);

const WING: WingVisualDef = {
  mount: 'low',
  root: 'conform',
  section: LS1_0417,
  // Straight quarter-chord line (geometry.ts quarterChordX 0 at every station): the leading edge sweeps back 1.8 deg.
  breaks: [
    { y: PC12_WING.rootY, chord: chordAt(PC12_WING.rootY), qcX: PC12_WING.quarterChordX },
    { y: TIP_Y, chord: chordAt(TIP_Y), qcX: PC12_WING.quarterChordX },
  ],
  rootY: PC12_WING.rootY,
  qcZ: hz(WING_ROOT_PLANE_H),
  dihedral: PC12_WING.dihedral,
  // ESTIMATE: 2 deg at the root washing out to 0 at the tip.
  rootIncidence: 2 * DEG,
  tipIncidence: 0,
  bays: [
    // The Fowler flap from the fuselage side to 5.05 m, a short fixed panel, the aileron to 7.95 m, the tip.
    { kind: 'flap', from: PC12_WING.rootY, to: PC12_WING.flap.outerY, chordFraction: 0.3 },
    { kind: 'fixed', from: PC12_WING.flap.outerY, to: PC12_WING.aileron.innerY },
    { kind: 'aileron', from: PC12_WING.aileron.innerY, to: AILERON_OUTER_Y, chordFraction: 0.27 },
    { kind: 'fixed', from: AILERON_OUTER_Y, to: TIP_Y },
  ],
  // Single-slotted Fowler flaps on tracks: at 40 deg they run most of their chord aft (PHOTO ZS-JDD on approach: a
  // deep slot opens between the shroud and the flap) and a little down.
  flap: { maxDeflection: 40 * DEG, travelAft: 0.42, travelDown: 0.1 },
  tip: {
    round: 0.08,
    chordRound: 0.05,
    // A small upturned winglet (PHOTO; front view of Fig 1-1), swept back, its chord narrowing to about 0.45 m.
    winglet: { height: PC12_WING.winglet.height, cant: WINGLET_CANT, rootChord: 0.95, tipChord: 0.45, sweep: 32 * DEG, section: WINGLET_SECTION, blend: 0.3 },
  },
  fuelCaps: [{ y: 6.4, xc: 0.35, side: 'both' }],
  pitot: { side: -1, y: 4.6, xc: 0.18 },
  liftDetector: { side: -1, y: 4.0 },
  // Pneumatic boots, inner and outer, on each leading edge (47E 7-14; PHOTO): about 6 % of the chord on top.
  boots: [
    { y0: 1.05, y1: 4.6, xcUpper: 0.06, xcLower: 0.07 },
    { y0: 4.7, y1: 7.85, xcUpper: 0.06, xcLower: 0.07 },
  ],
};

const WING_PLANFORM = makeWingPlanform(WING);

/** A point on the lower (-1) or upper (1) skin of the wing at span y (sign = side) and chord fraction xc. */
function wingSkin(y: number, xc: number, surface: 1 | -1, below = 0): FRD {
  const [px, py] = surfacePoint(LS1_0417, xc, surface);
  const p = sectionPoint(WING_PLANFORM, Math.abs(y), px, py);
  return [p.x, (y < 0 ? -1 : 1) * p.y, p.z + below];
}
/** Chord fraction at FRD x of the wing section at span y. */
function wingXc(y: number, x: number): number {
  const le = sectionPoint(WING_PLANFORM, Math.abs(y), 0, 0).x;
  return (le - x) / chordAt(Math.abs(y));
}

// --- Tail: T-tail with a trimmable stabiliser and bullet fairing, swept fin, dorsal fin, strakes ----------------------

/** The fin (3V): base inside the tailcone at 2.05 m, leading edge station 11.80, chord 1.95; tip under the tailplane. */
const FIN_BASE_H = 2.05;
const FIN = { baseLe: 11.8, baseChord: 1.95, tipLe: 13.35, tipChord: 1.2 };

const TAIL: TailVisualDef = {
  section: TAIL_SECTION,
  h: {
    span: PC12_TAIL.hSpan,
    rootChord: PC12_TAIL.hRootChord,
    tipChord: PC12_TAIL.hTipChord,
    quarterChord: { x: PC12_TAIL.hQuarterChord.x, z: PC12_TAIL.hQuarterChord.z },
    // The leading edge sweeps back about 12 deg (top view of Fig 1-1): the tip quarter-chord 0.42 m aft.
    tipQuarterChordX: PC12_TAIL.hQuarterChord.x - 0.42,
    // ESTIMATE: the stabiliser's rigging; the trim turns it from there.
    incidence: -1.5 * DEG,
    kind: 'elevator',
    chordFraction: 0.36,
    innerCutY: 0.1,
    // The whole stabiliser trims about its rear spar (47E 7-3: electric actuator, no trim tab). ESTIMATE: 65 % chord.
    trim: { pivotFraction: 0.65 },
  },
  v: {
    base: { x: sx(FIN.baseLe + 0.25 * FIN.baseChord), z: hz(FIN_BASE_H) },
    tip: { x: sx(FIN.tipLe + 0.25 * FIN.tipChord), z: PC12_TAIL.hQuarterChord.z },
    rootChord: FIN.baseChord,
    tipChord: FIN.tipChord,
    rudderChordFraction: 0.34,
  },
  tTail: true,
  // The bullet fairing over the junction (PHOTO): from ahead of the tailplane's leading edge to the tail's end.
  bullet: { aftX: PC12_TAIL.tailEndX + 0.005, radius: 0.2 },
  // The long dorsal fin from the roof at station 9.3 up the fin's leading edge (3V: kink at station 12.55, 3.30 m).
  dorsalFillet: { x0: sx(9.3), height: 1.2 },
  // A short ventral fin under the tailcone's end, and the pair of strakes along its lower sides (3V, PHOTO HB-FPT).
  ventralFin: { x0: sx(12.7), x1: sx(13.45), depth: 0.12 },
  strakes: { x0: sx(9.9), x1: sx(12.3), depth: 0.2, angle: 48 * DEG, cant: 40 * DEG },
  vorAntenna: false,
};

// --- Fuselage: the station table ------------------------------------------------------------------------------------

const SPINNER_BASE_X = sx(1.025);
/** The cowling face just behind the spinner's backplate. */
const FRONT_X = SPINNER_BASE_X;
/** The tailcone's end under the rudder (3V station 13.55). */
const END_X = sx(13.55);
/** Firewall: frame 10, 3.000 m aft of the datum (TCDS C.III.14). */
const FIREWALL_X = sx(3.0);
/** Windscreen: sill on the centre line, and the roof's front edge where the glass ends (3V station 4.20). */
const SCREEN_SILL: readonly [number, number] = [sx(3.3), hz(SILL_H)];
const SCREEN_TOP_X = sx(4.2);
/** Aft cabin bulkhead behind the cargo door (3V station 9.1). */
const CABIN_REAR_X = sx(9.1);
/** Half the cabin's external width (3V: 1.69 m). */
const HW = PC12_FUSELAGE.maxWidth / 2;
const BELLY_Z = hz(BELLY_H);
const FLOOR_Z = hz(FLOOR_H);

type Key = [x: number, zTop: number, zBot: number, zMid: number, hw: number, nTop: number, nBot: number, ridge: number];
/** A nose key against the thrust line: heights above it (top, bottom, widest line). */
const n = (station: number, top: number, bot: number, mid: number, hw: number, nTop: number, nBot: number): Key => [sx(station), hz(T_H + top), hz(T_H + bot), hz(T_H + mid), hw, nTop, nBot, 0];
/** A cabin or tail key in heights above the ground. */
const c = (station: number, top: number, bot: number, mid: number, hw: number, nTop: number, nBot: number): Key => [sx(station), hz(top), hz(bot), hz(mid), hw, nTop, nBot, 0];

const KEYS: Key[] = [
  // The nose (3V, against the thrust line): a small face round the spinner's backplate, the lower cowl running
  // forward under the spinner round the chin inlet, the cowl deepening and widening to the firewall, its top line
  // rising in a straight, gentle slope to the windscreen.
  n(1.025, 0.25, -0.27, 0.0, 0.25, 2, 2),
  n(1.06, 0.27, -0.37, -0.03, 0.31, 2.1, 2.2),
  n(1.15, 0.29, -0.46, -0.06, 0.37, 2.2, 2.4),
  n(1.4, 0.32, -0.54, -0.07, 0.44, 2.3, 2.5),
  n(1.8, 0.365, -0.6, -0.07, 0.53, 2.3, 2.5),
  n(2.2, 0.41, -0.65, -0.07, 0.62, 2.3, 2.5),
  n(2.6, 0.455, -0.69, -0.06, 0.7, 2.3, 2.5),
  [FIREWALL_X, hz(T_H + 0.5), BELLY_Z, hz(T_H + 0.0), 0.77, 2.3, 2.5, 0],
  // The windscreen rises from the sill to the roof; the cabin grows round.
  // Under the windscreen the section is full-shouldered (the panes reach well out to the sides, 3V front view).
  c(3.3, SILL_H, BELLY_H, 1.78, 0.83, 3.0, 2.9),
  c(3.65, 2.36, BELLY_H, 1.8, HW, 2.8, 3.0),
  c(4.0, 2.54, BELLY_H, 1.82, HW, 2.4, 2.8),
  c(4.3, 2.67, BELLY_H, 1.84, HW, 2.1, 2.5),
  c(4.7, ROOF_H, BELLY_H, 1.86, HW, 2.0, 2.4),
  // The cabin; the wing-root fairing deepens the belly over the wing (3V: 0.88 m between stations 5.1 and 7.8).
  c(5.1, ROOF_H, 0.9, 1.86, HW, 2.0, 2.4),
  c(6.4, ROOF_H, 0.87, 1.86, HW, 2.0, 2.4),
  c(7.8, ROOF_H, 0.9, 1.86, HW, 2.0, 2.4),
  c(8.6, ROOF_H, 0.98, 1.88, 0.84, 2.0, 2.3),
  // The tailcone: the top line falls slowly under the dorsal fin, the belly sweeps up in a straight line (3V:
  // 0.98 m at station 8.66 to 1.90 m at 13.66), the sides close in.
  c(9.2, ROOF_H, 1.07, 1.92, 0.81, 2.0, 2.2),
  c(10.0, 2.64, 1.22, 1.96, 0.73, 2.1, 2.1),
  c(11.0, 2.54, 1.4, 2.0, 0.6, 2.1, 2.1),
  c(12.0, 2.45, 1.58, 2.04, 0.45, 2.1, 2.1),
  c(12.8, 2.38, 1.73, 2.08, 0.3, 2.1, 2.1),
  c(13.3, 2.35, 1.83, 2.1, 0.16, 2.1, 2.1),
  [END_X, hz(2.33), hz(1.88), hz(2.12), 0.05, 2.1, 2.1, 0],
];

/** z of the keys' column `col` (1 top, 2 belly) at station x, linear between keys. */
function keyZ(x: number, col: 1 | 2): number {
  for (let i = 1; i < KEYS.length; i++) {
    const a = KEYS[i - 1];
    const b = KEYS[i];
    if (x <= a[0] && x >= b[0]) return a[col] + ((x - a[0]) / (b[0] - a[0])) * (b[col] - a[col]);
  }
  return KEYS[KEYS.length - 1][col];
}
const topZ = (x: number): number => keyZ(x, 1);
const bellyZ = (x: number): number => keyZ(x, 2);

const FUSELAGE: AirframeVisualDef['fuselage'] = {
  keys: KEYS,
  frontX: FRONT_X,
  endX: END_X,
  grid: { rows: 220, cols: 112 },
  nose: 'prop',
  // The crescent chin inlet under the spinner (PHOTO propeller and nose): a wide, low opening in the lower lip.
  inlets: [{ y: 0, z: hz(T_H - 0.34), w: 0.46, h: 0.13, r: 0.05, exponent: 3, xMin: FRONT_X - 0.04, baffleX: FRONT_X - 0.3 }],
  // The two exhaust stubs, one each side of the cowling at the thrust line behind the propeller, pointing out and
  // aft (PHOTO: N814WA station about 1.9; front view): flattened polished pipes 0.12 m tall and 0.2 m wide, their
  // mouths standing 0.1 m proud of the cowl (skin half width 0.60 m at the mouth), dark inside.
  exhaust: { pos: [sx(1.85), 0.5, hz(T_H + 0.02)], radius: 0.085, dir: [-0.28, 0.2, 0.01], mirror: true, oval: [0.06, 0.1], finish: 'polished' },
  antennas: [
    // VHF blades on the roof, GPS on the roof, a VHF blade and the transponder stub under the belly.
    { kind: 'blade', pos: [sx(6.4), 0, topZ(sx(6.4))], height: 0.24 },
    { kind: 'blade', pos: [sx(8.3), 0, topZ(sx(8.3))], height: 0.24 },
    { kind: 'stub', pos: [sx(5.2), 0, topZ(sx(5.2))], height: 0.06 },
    { kind: 'blade', pos: [sx(8.6), 0, bellyZ(sx(8.6)) + 0.002], height: 0.16 },
    { kind: 'stub', pos: [sx(4.5), 0, BELLY_Z + 0.002], height: 0.09 },
  ],
};

// --- Glazing and door lines (side projection: x, z) ---------------------------------------------------------------

/** The windscreen's lower corner at the cabin side, and the A-post from there up to the roof's front edge (3V). */
// The panes' lower edge falls slightly from the centre to the sides (front view): the sill plane falls aft.
const SCREEN_CORNER: readonly [number, number] = [sx(3.42), hz(2.12)];
const SCREEN_POST_TOP: readonly [number, number] = [sx(4.22), hz(2.7)];
const SCREEN_SILL_N = ((): readonly [number, number] => {
  const dx = SCREEN_SILL[0] - SCREEN_CORNER[0];
  const dz = SCREEN_CORNER[1] - SCREEN_SILL[1];
  const l = Math.hypot(dx, dz);
  return [dz / l, dx / l];
})();

/** Cabin windows (3V, PHOTO): ovals 0.29 m wide and 0.36 m tall, centred 2.16 m up. */
const WIN = { half: 0.145, sill: hz(1.98), top: hz(2.34), r: 0.135 };
const oval = (station: number): [number, number][] => {
  const x = sx(station);
  return [
    [x + WIN.half, WIN.sill],
    [x + WIN.half, WIN.top],
    [x - WIN.half, WIN.top],
    [x - WIN.half, WIN.sill],
  ];
};
/** Left: three between the airstair door and the cargo door, one in the cargo door (3V side view, left side). */
const LEFT_WINDOWS = [5.65, 6.27, 7.04, 8.04] as const;
/** Right: five, the second in the over-wing emergency exit (PHOTO HB-FPT). */
const RIGHT_WINDOWS = [4.75, 5.5, 6.27, 7.04, 7.8] as const;
/** Doors (47E 1-8; 3V): airstair (left front) 0.61 x 1.35 m, cargo (left rear) 1.35 x 1.32 m, exit (right) 0.49 x 0.68 m. */
const AIRSTAIR = { s0: 4.76, s1: 5.37, sill: hz(1.2), top: hz(2.56) };
const CARGO = { s0: 7.62, s1: 9.0, sill: hz(1.18), top: hz(2.52) };
const EXIT = { s0: 5.255, s1: 5.745, sill: hz(1.82), top: hz(2.5) };

const rect = (s0: number, s1: number, top: number, sill: number): [number, number][] => [
  [sx(s0), sill],
  [sx(s0), top],
  [sx(s1), top],
  [sx(s1), sill],
];

const GLAZING: GlazingDef = {
  // Laminated glass windscreen panes: unconfirmed (no handbook page on the windscreen's construction was checked).
  laminated: true,
  cabinFrontX: SCREEN_SILL[0],
  cabinRearX: CABIN_REAR_X,
  firewallX: FIREWALL_X,
  tRange: [0.2, 0.8],
  windows: [
    // The cockpit side windows behind the A-post (3V: 2.13-2.57 m, less 0.07; the direct-vision panel in their forward part).
    // Their front edge runs parallel to the A-post plane's trace on the skin, a few cm behind it, so the post is a
    // slender frame of even width from the panes' lower corner to the roof (PHOTO BOUTIQUE AIR cockpit). It pinched to
    // nothing at the top with the edge too far forward (4.07 at the top), and blanked a wide wedge of the forward-left
    // view at 4.17; 4.13 keeps it even and slim.
    {
      pts: [
        [sx(3.47), hz(2.085)],
        [sx(4.13), hz(2.5)],
        [sx(4.45), hz(2.5)],
        [sx(4.45), hz(2.06)],
      ],
      r: 0.05,
      sides: 'both',
    },
    ...LEFT_WINDOWS.map((s) => ({ pts: oval(s), r: WIN.r, oval: true, sides: 'left' as const, maxX: sx(s) + WIN.half + 0.05 })),
    ...RIGHT_WINDOWS.map((s) => ({ pts: oval(s), r: WIN.r, oval: true, sides: 'right' as const, maxX: sx(s) + WIN.half + 0.05 })),
  ],
  windscreen: {
    sillC: SCREEN_SILL,
    sillN: SCREEN_SILL_N,
    post: [SCREEN_CORNER, SCREEN_POST_TOP],
    postY: 0.56,
    // The A-post leans inward from the panes' lower corners to the top frame over the seats (3V front view; PHOTO
    // BOUTIQUE AIR cockpit): a plane across the shoulder, so the post keeps its width up to the roof.
    postLine: [
      [SCREEN_CORNER[0], 0.74, SCREEN_CORNER[1]],
      [SCREEN_TOP_X, 0.5, hz(2.62)],
    ],
    topX: SCREEN_TOP_X,
    // Two panes either side of a centre post 0.06 m wide (PHOTO BOUTIQUE AIR cockpit, cockpit linke Seite).
    centrePost: 0.03,
  },
  doors: [
    // The airstair door, hinged at its foot; the cargo door, hinged at its top; the over-wing exit on the right.
    { pts: rect(AIRSTAIR.s0, AIRSTAIR.s1, AIRSTAIR.top, AIRSTAIR.sill), r: 0.06, sides: 'left', handle: { x: sx(AIRSTAIR.s0) - 0.1, z: hz(2.25) } },
    { pts: rect(CARGO.s0, CARGO.s1, CARGO.top, CARGO.sill), r: 0.08, sides: 'left', handle: { x: sx(CARGO.s1) + 0.12, z: hz(1.5) } },
    { pts: rect(EXIT.s0, EXIT.s1, EXIT.top, EXIT.sill), r: 0.06, sides: 'right' },
  ],
  // The headliner (the windscreen's upper part is cut out of it, x > topX).
  liningRoofLimit: hz(ROOF_H - 0.07),
  xRange: [SCREEN_SILL[0] + 0.01, CABIN_REAR_X + 0.05],
  headliner: { x0: SCREEN_TOP_X - 0.05, x1: CABIN_REAR_X + 0.05, z0: hz(ROOF_H - 0.13), z1: hz(ROOF_H - 0.08), pitch: 0.35 },
};

// --- Landing gear: trailing-link mains folding inward, nose leg folding aft (47E 7-4) ------------------------------

const G = PC12_GEAR;
/** Contact points of the legs fully extended (the definition's, below PC12_GEAR's static ones by the static sag). */
const EXTENDED = PC12_GEOMETRY.gear;
/**
 * Main leg (3V, PHOTO HB-FPT): a post down from the wing to the trailing arm's pivot 0.38 m ahead of the axle, the arm
 * running aft and down to the axle. The leg hangs on a fore-aft hinge in the wing at the post's top and folds inward
 * about it into the wing root, the tyre lying flat and standing a few centimetres proud of the wing's lower skin.
 */
const MAIN = { pivotStation: 5.92, pivotH: 0.55, topH: 1.08, fold: 90 * DEG };
/** 8.50-10 tyre on a 10 in rim; 17.5 x 6.25-6 nose tyre on a 6 in rim (TCDS C.III.19). */
const MAIN_TYRE = { width: 0.216, rim: 0.127 };
const NOSE_TYRE = { width: 0.159, rim: 0.0762 };

const mainWheel = (contact: { x: number; y: number; z: number }, side: 1 | -1): WheelVisualDef => {
  const pivot: FRD = [sx(MAIN.pivotStation), contact.y, hz(MAIN.pivotH)];
  const top: FRD = [sx(MAIN.pivotStation), contact.y, hz(MAIN.topH)];
  const axleZ = contact.z - G.mainWheelRadius;
  // The well on the wing's lower skin: from just outboard of the post inboard to where the folded tyre lies.
  const fore = pivot[0] + 0.2;
  const aft = contact.x - 0.42;
  const yOut = contact.y + side * 0.14;
  const yIn = contact.y - side * (axleZ - top[2] + 0.38);
  const well = (y: number, x: number): FRD => [x, y, wingSkin(y, wingXc(y, x), -1, 0.004)[2]];
  return {
    contact: [contact.x, contact.y, contact.z],
    radius: G.mainWheelRadius,
    width: MAIN_TYRE.width,
    rimRadius: MAIN_TYRE.rim,
    leg: { kind: 'trailingLink', pivot, armLen: Math.hypot(pivot[0] - contact.x, axleZ - pivot[2]), top },
    retract: {
      pivot: top,
      axis: [1, 0, 0],
      angle: side * MAIN.fold,
      // A door on the leg's slot, closing over the post when it is up (PHOTO: leg-mounted door on the strut).
      doors: [
        {
          hinge: well(yOut, (fore + aft) / 2),
          axis: [1, 0, 0],
          angle: -side * 80 * DEG,
          pts: [well(yOut, fore - 0.04), well(contact.y - side * 0.1, fore - 0.04), well(contact.y - side * 0.1, aft + 0.06), well(yOut, aft + 0.06)],
        },
      ],
      well: [well(yOut, fore), well(yIn, fore), well(yIn, aft), well(yOut, aft)],
    },
  };
};

/** Nose leg: hinge inside the nose-gear bay above the wheel; it folds aft into the bay under two doors. */
const NOSE_PIVOT: FRD = [sx(2.74), 0, hz(1.12)];
const NOSE_WELL = { fore: sx(2.5), aft: sx(3.85), halfWidth: 0.15 };
const NOSE_WHEEL: WheelVisualDef = {
  contact: [EXTENDED.nose.x, EXTENDED.nose.y, EXTENDED.nose.z],
  radius: G.noseWheelRadius,
  width: NOSE_TYRE.width,
  rimRadius: NOSE_TYRE.rim,
  // An oleo leg with torque links and a single wheel in a fork, steered by the pedals (+/-12 deg; 47E 7-4).
  leg: { kind: 'oleo', top: NOSE_PIVOT, cylinderLen: 0.38, crownAt: 0.6, forkHalf: 0.11, scissors: true, steers: true },
  retract: {
    pivot: NOSE_PIVOT,
    axis: [0, 1, 0],
    angle: -96 * DEG,
    doors: ([-1, 1] as const).map((side) => {
      const mid = (NOSE_WELL.fore + NOSE_WELL.aft) / 2;
      return {
        hinge: [mid, side * NOSE_WELL.halfWidth, bellyZ(mid)] as FRD,
        axis: [NOSE_WELL.fore - NOSE_WELL.aft, 0, bellyZ(NOSE_WELL.fore) - bellyZ(NOSE_WELL.aft)] as FRD,
        angle: -side * 85 * DEG,
        pts: [
          [NOSE_WELL.fore, side * NOSE_WELL.halfWidth, bellyZ(NOSE_WELL.fore) + 0.004],
          [NOSE_WELL.fore, 0, bellyZ(NOSE_WELL.fore) + 0.004],
          [NOSE_WELL.aft, 0, bellyZ(NOSE_WELL.aft) + 0.004],
          [NOSE_WELL.aft, side * NOSE_WELL.halfWidth, bellyZ(NOSE_WELL.aft) + 0.004],
        ] as FRD[],
      };
    }),
    well: [
      [NOSE_WELL.fore, -NOSE_WELL.halfWidth, bellyZ(NOSE_WELL.fore) + 0.003],
      [NOSE_WELL.fore, NOSE_WELL.halfWidth, bellyZ(NOSE_WELL.fore) + 0.003],
      [NOSE_WELL.aft, NOSE_WELL.halfWidth, bellyZ(NOSE_WELL.aft) + 0.003],
      [NOSE_WELL.aft, -NOSE_WELL.halfWidth, bellyZ(NOSE_WELL.aft) + 0.003],
    ],
  },
};

const GEAR: AirframeVisualDef['gear'] = [NOSE_WHEEL, mainWheel(EXTENDED.leftMain, -1), mainWheel(EXTENDED.rightMain, 1)];

// --- Flap-track fairings: two canoes under each wing (the third track is inside the root fairing) ------------------

/** A track fairing under the wing at span y: from 25 % chord to 0.45 m behind the trailing edge. */
function trackFairing(y: number): FairingDef {
  const le = sectionPoint(WING_PLANFORM, y, 0, 0).x;
  const chord = chordAt(y);
  const x0 = le - 0.25 * chord;
  const x1 = le - chord - 0.45;
  const keys: Key[] = [];
  const N = 9;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const x = x0 + (x1 - x0) * t;
    // Top just inside the lower skin (level with the trailing edge behind it); deepest near the flap hinge.
    const skin = wingSkin(y, Math.min(0.98, wingXc(y, x)), -1)[2] - 0.02;
    const depth = 0.2 * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.7 + 0.01;
    const hw = 0.06 * Math.sin(Math.PI * Math.min(1, t * 1.1)) ** 0.5 + 0.005;
    keys.push([x, skin, skin + depth, skin + depth * 0.45, hw, 2, 2.2, 0]);
  }
  return { keys, frontX: x0, endX: x1, offset: { y, z: 0 }, grid: { rows: 18, cols: 12 }, paint: 'base', mirror: true };
}

const FAIRINGS: readonly FairingDef[] = [trackFairing(2.6), trackFairing(4.45)];

// --- Propeller: Hartzell HC-E4A-3D, four blades, 2.67 m, constant speed, feathering and reversing (TCDS C.III.6) ----

const PROP: PropVisualDef = {
  hub: [PC12_PROP.hub.x, PC12_PROP.hub.y, PC12_PROP.hub.z],
  diameter: PC12_PROP.diameter,
  blades: PC12_PROP.blades,
  rotation: PC12_PROP.rotation,
  // Built at the flight-idle low-pitch stop the flight model starts from (17 deg at the 42 in station, plan 5.1); the
  // state's blade pitch turns each blade from it, down to -17.5 deg in reverse and up to 79.6 deg feathered.
  referencePitch: 17 * DEG,
  // The helix through 17 deg at that station (0.80 R), so the blade angle drawn there is the commanded one.
  geometricPitch: Math.tan(17 * DEG) * 2 * Math.PI * PC12_PROP.STATION * (PC12_PROP.diameter / 2),
  variablePitch: true,
  // Slender aluminium blades about 0.19 m wide at their widest (PHOTO propeller and nose), rounded tips.
  chord: [
    [0.12, 0.085],
    [0.25, 0.15],
    [0.45, 0.19],
    [0.65, 0.185],
    [0.85, 0.16],
    [0.95, 0.12],
    [1.0, 0.05],
  ],
  // The polished spinner, about 0.48 m across, from the cowl face to the tip at station 0.55.
  spinner: { baseX: SPINNER_BASE_X, radius: 0.24, length: PC12_PROP.spinnerTipX - SPINNER_BASE_X },
  // Dark grey blades, black backs, white tips.
  paint: { face: [0.11, 0.11, 0.115], back: [0.035, 0.035, 0.037], tip: [0.92, 0.92, 0.9], tipBand: 0.07 },
};

// --- Exterior lamps ------------------------------------------------------------------------------------------------

const LAMPS: readonly LampVisualDef[] = ((): LampVisualDef[] => {
  const onWing = (y: number, xc: number, yc: number, side: 1 | -1): FRD => {
    const p = sectionPoint(WING_PLANFORM, y, xc, yc);
    return [p.x, p.y * side, p.z];
  };
  const tipY = TIP_Y - 0.06;
  // The red beacon on the bullet's top (PHOTO ZS-JDD), the white tail light in its tail.
  const bulletTop = PC12_TAIL.hQuarterChord.z - 0.2;
  // The taxi light on the nose leg (PHOTO propeller and nose), the landing light in the left leading edge.
  const noseLeg: FRD = [G.nose.x + 0.12, 0, hz(0.62)];
  return [
    { id: 'navL', pos: onWing(tipY, 0.04, 0.0, -1), radius: 0.03, glowOffset: [0.035, -0.035, 0] },
    { id: 'navR', pos: onWing(tipY, 0.04, 0.0, 1), radius: 0.03, glowOffset: [0.035, 0.035, 0] },
    { id: 'navTail', pos: [PC12_TAIL.tailEndX + 0.01, 0, PC12_TAIL.hQuarterChord.z], radius: 0.022, glowOffset: [-0.03, 0, 0] },
    { id: 'strobeL', pos: onWing(tipY, 0.2, 0.02, -1), radius: 0.02, glowOffset: [0, -0.035, 0] },
    { id: 'strobeR', pos: onWing(tipY, 0.2, 0.02, 1), radius: 0.02, glowOffset: [0, 0.035, 0] },
    { id: 'beacon', pos: [sx(14.2), 0, bulletTop - 0.02], radius: 0.035, glowOffset: [0, 0, -0.045] },
    { id: 'landing', pos: onWing(3.3, 0.004, 0.0, -1), radius: 0.06, glowOffset: [0.03, 0, 0], aim: { downDeg: 3, outDeg: 0, halfAngleDeg: 9 } },
    { id: 'taxi', pos: noseLeg, radius: 0.045, glowOffset: [0.03, 0, 0], parent: 'noseGear', aim: { downDeg: 7, outDeg: 0, halfAngleDeg: 24 } },
  ];
})();

// --- Cockpit ---------------------------------------------------------------------------------------------------------

// Fitted to the pilot's eye: the panel top 0.15 m below it and 0.60 m ahead of it, 14 deg down (the C208's is 13), so
// at the default -8 deg view the whole primary T and the engine instruments show over the glareshield (PHOTO linke
// Seite: the glareshield meets the windscreen's base). At 0.27 m (24 deg) only the top row was on screen. The fuselage, windscreen and cabin box are the
// airframe's and do not move with it.
const PX = PC12_PANEL_PX_PER_M;
// The face shows the whole canvas (panelLayout.ts: 2800 x 1040 px at 2000 px/m, 1.40 x 0.52 m; the cabin is 1.52 m
// wide inside, 47E 1-8).
const PX_RECT = PC12_PANEL_PX_RECT;
const PANEL_X = EYE.x + 0.6;
const PANEL_ZTOP = EYE.z + 0.15;
const PANEL_W = PX_RECT.w / PX;
const PANEL_ZB = PANEL_ZTOP + PX_RECT.h / PX;
/** A point of the panel canvas, px, on the face (FRD y, z). */
const faceY = (px: number): number => (px - PC12_PANEL_CENTRE_PX) / PX;
const faceZ = (py: number): number => PANEL_ZTOP + (py - PX_RECT.y) / PX;
/** Lateral station of the crew seats, the control wheels and the pedals: the pilot's eye. */
const SEAT_Y = -EYE.y;
/** The centre pedestal (panelLayout.ts PC12_PEDESTAL): its sides, its top at the face, its aft face. */
const PED = PC12_PEDESTAL;
const PEDESTAL = { y0: faceY(PED.x0), y1: faceY(PED.x1), top: faceZ(PED.y0), aftX: PANEL_X - 0.34 };
/** The levers' pivots in the pedestal top, under its slots; the levers stand 0.19 m up out of them. */
const LEVER = { x: PANEL_X - 0.17, z: PEDESTAL.top + 0.05, length: 0.19 };
/** The parking brake handle low on the panel's left (canvas px). */
const BRAKE_PX = [140, 980] as const;
/** The headliner's height. */
const ROOF_IN = GLAZING.liningRoofLimit;
/** The glareshield's front edge, 0.12 m ahead of the panel and 4 cm above its top (inside the skin's shoulders). */
const GLARE_FRONT: readonly [number, number] = [PANEL_X + 0.12, PANEL_ZTOP - 0.04];

const COCKPIT: CockpitDef = {
  pilotEye: [EYE.x, EYE.y, EYE.z],
  defaultPitchDeg: -8,
  // Instrument focus (Q): the main instruments centred, the glareshield ~25 % down the frame, the 3-1/8 in dials
  // 126-137 px across on a 991 px high view (scripts/cockpit-focus.mjs).
  focus: { yawDeg: 2, pitchDeg: -19.5, fovDeg: 50 },
  enclosure: 'cabin',
  panel: { x: PANEL_X, zTop: PANEL_ZTOP, width: PANEL_W, pxRect: PX_RECT },
  floor: { z: FLOOR_Z, x0: FIREWALL_X - 0.04, x1: CABIN_REAR_X + 0.05 },
  // A black glareshield over the panel's top, 0.12 m deep (the windscreen's sill is 0.3 m ahead of the panel).
  glareshield: {
    profile: [
      [PANEL_X - 0.04, PANEL_ZTOP - 0.0015],
      [PANEL_X - 0.05, PANEL_ZTOP - 0.012],
      [PANEL_X - 0.045, PANEL_ZTOP - 0.026],
      [PANEL_X, PANEL_ZTOP - 0.032],
      [GLARE_FRONT[0], GLARE_FRONT[1]],
      [GLARE_FRONT[0] + 0.004, GLARE_FRONT[1] + 0.025],
      [PANEL_X + 0.03, PANEL_ZTOP + 0.0015],
      [PANEL_X, PANEL_ZTOP - 0.0015],
    ],
    halfWidth: 0.64,
  },
  // Two crew seats on raised bases; four club seats of the executive interior behind (the commuter cabin has nine).
  seats: [
    { x: EYE.x + 0.31, y: -SEAT_Y, kind: 'front', width: 0.5, depth: 0.48, z: EYE.z + 0.78, reclineDeg: 14 },
    { x: EYE.x + 0.31, y: SEAT_Y, kind: 'front', width: 0.5, depth: 0.48, z: EYE.z + 0.78, reclineDeg: 14 },
    { x: sx(5.6), y: -0.4, kind: 'front', width: 0.5, depth: 0.5, z: FLOOR_Z - 0.42, reclineDeg: 15 },
    { x: sx(5.6), y: 0.4, kind: 'front', width: 0.5, depth: 0.5, z: FLOOR_Z - 0.42, reclineDeg: 15 },
    { x: sx(6.9), y: -0.4, kind: 'front', width: 0.5, depth: 0.5, z: FLOOR_Z - 0.42, reclineDeg: 15 },
    { x: sx(6.9), y: 0.4, kind: 'front', width: 0.5, depth: 0.5, z: FLOOR_Z - 0.42, reclineDeg: 15 },
  ],
  consoles: [
    // Structure under the lower edge of the panel, toward the firewall.
    {
      min: [PANEL_X + 0.002, -0.64, PANEL_ZB - 0.005],
      max: [PANEL_X + 0.16, 0.64, PANEL_ZB + 0.12],
      bevel: 0.008,
      material: 'panelPlastic',
      profile: [
        [PANEL_X + 0.002, PANEL_ZB - 0.005],
        [PANEL_X + 0.002, PANEL_ZB + 0.03],
        [PANEL_X + 0.11, PANEL_ZB + 0.12],
        [PANEL_X + 0.16, PANEL_ZB + 0.12],
        [PANEL_X + 0.16, PANEL_ZB - 0.005],
      ],
    },
    // The centre pedestal from the panel aft and down to the floor; the levers stand out of its top.
    { min: [PEDESTAL.aftX, PEDESTAL.y0, PEDESTAL.top], max: [PANEL_X + 0.01, PEDESTAL.y1, FLOOR_Z], bevel: 0.015, material: 'black' },
    // The overhead panel behind the windscreen's top edge (lights, the cockpit air outlets).
    { min: [sx(4.95), -0.16, ROOF_IN + 0.005], max: [sx(4.5), 0.16, ROOF_IN + 0.05], bevel: 0.01, material: 'panelPlastic' },
  ],
  trimPanels: [
    // The cockpit side walls below the side windows, and the cabin walls below the window line.
    { side: 0, x0: sx(3.5), x1: sx(4.6), z0: hz(2.02), z1: FLOOR_Z + 0.02, relief: 0.009, material: 'panelPlastic', grid: { rows: 30, cols: 36 }, edge: 0.02, openBelow: true },
    { side: 0, x0: sx(4.6), x1: CABIN_REAR_X + 0.06, z0: hz(1.94), z1: FLOOR_Z - 0.04, relief: 0.009, material: 'seatFabric', grid: { rows: 110, cols: 30 }, edge: 0.02 },
  ],
  occupants: [{ seat: 0 }],
  // Two control wheels on columns out of the panel.
  column: { kind: 'yoke', x: PANEL_X - 0.2, y: SEAT_Y, z: faceZ(PC12_YOKES.y), travel: 0.1, rollDeg: 45, style: 'pilatus' },
  pedals: { x: PANEL_X + 0.26, ys: [-SEAT_Y, SEAT_Y] },
  // The pedestal's levers, left to right (47E 7-10): MANUAL OVERRIDE (drawn fixed at OFF, aft: not modelled), the
  // POWER CONTROL LEVER (black grip; aft of the idle gate it swings on through beta into reverse with
  // ControlInputs.reverse), the CONDITION lever (moves with the 'mixture' control) with its three detents
  // CUT-OFF/FEATHER (0), GROUND IDLE (0.1: turbineEngine.ts CUTOFF_BELOW, where LOW IDLE starts) and FLIGHT IDLE (1).
  // There is no propeller lever (the CSU governs 1700 rpm).
  engineControls: [
    { kind: 'lever', control: 'throttle', engine: 0, pos: [LEVER.x, faceY(PED.levers.mor), LEVER.z], travel: 0.7, colour: 'white', length: LEVER.length * 0.8, fixed: 0 },
    { kind: 'lever', control: 'throttle', engine: 0, pos: [LEVER.x, faceY(PED.levers.power), LEVER.z], travel: 0.8, colour: 'black', length: LEVER.length, reverseTravel: 0.45 },
    { kind: 'lever', control: 'mixture', engine: 0, pos: [LEVER.x, faceY(PED.levers.condition), LEVER.z], travel: 0.7, colour: 'red', length: LEVER.length * 0.9, detents: [0, 0.1, 1] },
  ],
  // The flap selector right of the power controls, drawn as a lever in a slot low on the panel face over the
  // pedestal (UP to 40 over 80 px).
  flapControl: {
    kind: 'panelLever',
    pos: [PANEL_X, faceY(PED.levers.flaps), faceZ(PED.y0 + 40)],
    travel: 80 / PX,
  },
  // The gear handle on the lower panel left of the CAWS (white wheel knob; PHOTO linke Seite).
  gearLever: { pos: [PANEL_X, faceY(PC12_GEAR_HANDLE.x), faceZ(PC12_GEAR_HANDLE.y)] },
  parkingBrakeHandle: { pos: [PANEL_X, faceY(BRAKE_PX[0]), faceZ(BRAKE_PX[1])], travel: 0.05 },
  // The standby compass on the glareshield's centre, under the windscreen's centre post.
  compass: { pos: [PANEL_X - 0.02, 0, PANEL_ZTOP - 0.07], mount: 'glareshield' },
  fittings: {
    defrosters: [
      [GLARE_FRONT[0] - 0.03, -0.3, GLARE_FRONT[1] - 0.002],
      [GLARE_FRONT[0] - 0.03, 0.3, GLARE_FRONT[1] - 0.002],
    ],
    // Folded up against the cabin's shoulders above the side windows.
    visors: { x: SCREEN_TOP_X - 0.12, z: hz(2.5), ys: [-0.34, 0.34] },
    overhead: { z: ROOF_IN + 0.005 },
    airOutlet: [FIREWALL_X - 0.15, hz(1.7)],
    toeBoard: { x0: PANEL_X + 0.2, x1: FIREWALL_X - 0.04, z: hz(1.55) },
  },
  lamps: { flood: { pos: [sx(4.6), 0, ROOF_IN + 0.02], aim: [PANEL_X, -0.2, PANEL_ZTOP + 0.2] }, dome: { pos: [sx(6.3), 0, ROOF_IN + 0.02] } },
  box: {
    floor: FLOOR_Z,
    roof: ROOF_IN + 0.01,
    side: 0.78,
    rear: CABIN_REAR_X + 0.05,
    panelX: PANEL_X,
    glareshieldZ: PANEL_ZTOP - 0.02,
    sillZ: SCREEN_SILL[1],
    windscreenX: SCREEN_SILL[0],
    roofGlazed: false,
  },
  // Outward unit normals and areas, m^2, from the window outlines.
  glazingPanels: [
    { n: [0.53, 0, -0.85], area: 1.15 }, // the windscreen, raked about 32 deg
    { n: [0, -1, 0], area: 0.63 }, // left side window and four cabin windows
    { n: [0, 1, 0], area: 0.71 },
  ],
  interiorArea: 42,
  controlPoints: {
    fuelSelector: [sx(4.7), 0, ROOF_IN + 0.055],
    parkingBrake: [PANEL_X, faceY(BRAKE_PX[0]), faceZ(BRAKE_PX[1])],
  },
};

// --- Paint: generic white with a blue cheat line and a grey accent, 'N47PC' (no operator branding) ------------------

const LIVERY: LiveryDef = {
  registration: 'N47PC',
  palette: { base: [242, 243, 242], band: [34, 62, 128], accent: [140, 146, 152] },
  accentBelow: true,
  // From the cowl behind the spinner along the lower cabin under the windows, sweeping up the tailcone to the fin.
  stripe: {
    xs: [sx(13.4), sx(12.4), sx(11.2), sx(10.0), sx(8.8), sx(7.0), sx(5.0), sx(3.4), sx(2.2), sx(1.3)],
    centre: [2.2, 2.05, 1.9, 1.78, 1.7, 1.66, 1.66, 1.64, T_H - 0.02, T_H - 0.06].map(hz),
    half: [0.03, 0.04, 0.05, 0.06, 0.065, 0.065, 0.065, 0.06, 0.05, 0.035],
    noseShearX: sx(1.45),
  },
  // The registration on the tailcone ahead of the fin (PHOTO N814WA), above the band.
  lettering: { x0: sx(12.0), x1: sx(10.3), z0: hz(2.5), z1: hz(2.24) },
  construction: 'metal',
  skinJoints: [FIREWALL_X, sx(4.6), CABIN_REAR_X, sx(11.2)],
  cowlSplitZ: hz(T_H - 0.05),
  cowl: { oilDoor: { x: sx(2.2), halfLength: 0.08, halfWidth: 0.07 } },
  floorRivets: { z: FLOOR_Z + 0.02, x1: CABIN_REAR_X },
  // The airstair, cargo and exit door gaps read as dark outlines from across the ramp (PHOTO ZS-JDD cargo door).
  doorSeam: { halfWidth: 0.004, darken: 0.55 },
  fin: { bandZ0: hz(2.45), bandX0: sx(12.2), slope: 0.75, cap: 0.12 },
  texture: { w: 4096, h: 2048 },
};

export const PC12_VISUAL: AirframeVisualDef = {
  id: 'pc12',
  fuselage: FUSELAGE,
  glazing: GLAZING,
  wing: WING,
  tail: TAIL,
  gear: GEAR,
  props: [PROP],
  nacelles: [],
  fairings: FAIRINGS,
  lamps: LAMPS,
  cockpit: COCKPIT,
  livery: LIVERY,
  shadow: {
    halfX: 8.4,
    halfY: 8.5,
    // Belly band: centre x, half length, half width (cowling to tailcone).
    fuselage: [(FRONT_X + END_X) / 2, (FRONT_X - END_X) / 2, HW],
    wingX: -0.4,
    wingY: 7.2,
    wingHeight: WING_ROOT_PLANE_H,
    restHeight: PC12_REST_HEIGHT,
  },
};

/** The 3V heights this drawing uses where geometry.ts (P1) still carries its first estimate (docs/pc12-exterior.md). */
export const PC12_VISUAL_HEIGHTS = { eyeStation: EYE_STATION, roof: ROOF_H, belly: BELLY_H, sill: SILL_H, wingRootPlane: WING_ROOT_PLANE_H, eye: EYE_H, floor: FLOOR_H } as const;

export default PC12_VISUAL;
