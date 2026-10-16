// MD 500E (Hughes 369E), standard skid gear, LH command, 2-blade tail rotor: the geometry contract for physics,
// exterior and audio. Written at the scaffold; owner afterwards: T2 (M2/M3/A1 read it and request changes in
// their PR text). The panel face lives in panelLayout.ts (M3).
//
// Sources (docs/md500-sources.md): RFM = MD 500E RFM CSP-E-1 Rev 16 (Fig 1-1 three-view, Fig 6-2/6-3 stations);
// TCDS = FAA H3WE Rev 21 sect. IV; F = family reference (OH-6A, Heffley NASA CR-3144; 500C, NASA CR-166256);
// 3V = measured on Fig 1-1 / 6-3; ESTIMATE = judged, no source.
//
// AXES. FRD metres (x forward, y right, z down), origin on the main-rotor mast axis (STA 100.0, RFM 6-1) at the
// reference height SKID_Z above the skid soles (the S269 convention).
//   station s (in, datum 100 in forward of the rotor centreline):  x = (100 - s) x IN
//   waterline w (in, WL 0 = fuselage bottom line):                 z = SKID_Z - (w + GROUND_WL_BELOW) x IN
//   buttline b (in, + right):                                      y = b x IN
// The ground is WL -15.2 (belly 1.27 ft above it, RFM Fig 1-1; hub-fairing top WL 89.5 at 8.72 ft checks it). The
// real ground attitude is 4.7 deg nose up with full fuel (Fig 1-1 note 1); these axes ignore it (skids level): T2
// may tilt the skids to reproduce it.

const IN = 0.0254, FT = 0.3048;

/** Reference height above the skid soles, m. ESTIMATE (an origin convention, near the loaded CG height; not a measured CG). */
export const SKID_Z = 1.2;
/** Ground line below WL 0, in (RFM Fig 1-1: 1.27 ft belly clearance on standard gear). */
export const GROUND_WL_BELOW = 15.2;
const x = (sta: number): number => (100 - sta) * IN;
const z = (wl: number): number => SKID_Z - (wl + GROUND_WL_BELOW) * IN;
/** Height above the ground (skid soles), m, to body z. */
const zh = (h: number): number => SKID_Z - h;

// ------------------------------------------------------------------------------------------- main rotor
/** RFM 1-10: five blades, fully articulated (V-strap pack, elastomeric lead-lag dampers). */
export const MAIN_ROTOR_BLADES = 5;
/** RFM Fig 1-1: 26.4 ft disc (spec p9: 26 ft 4.8 in). */
export const MAIN_ROTOR_RADIUS = 26.4 * FT / 2;
/** F / ESTIMATE: 6.75 in (OH-6A 0.5625 ft, Heffley p34; 500C baseline 8.775 / 1.30, CR-166256 p3). */
export const MAIN_ROTOR_CHORD = 6.75 * IN;
/** F / ESTIMATE: -8 deg linear (OH-6A); the 500C has -9 deg. */
export const MAIN_ROTOR_TWIST_DEG = -8;
/** Counter-clockwise from above (RFM 3-3 left yaw on power loss; 3-5 right pedal at hover engine failure). */
export const MAIN_ROTOR_ROTATION = 1;
/** F / ESTIMATE: 500C flap hinge 0.458 ft (CR-166256 p5); e/R 0.035. Lag hinge: ESTIMATE at the same radius. */
export const FLAP_HINGE_OFFSET = 0.458 * FT + IN;
export const LAG_HINGE_OFFSET = 0.458 * FT + IN;
/** F / ESTIMATE: start of the aerofoil 1.576 ft (500C, CR-166256 p5). */
export const MAIN_BLADE_ROOT = 1.576 * FT;
/** F / 3V: 3 deg forward shaft tilt (OH-6A, Heffley p34; RFM Fig 6-3 cant lines). */
export const SHAFT_TILT_DEG = 3;
/** RFM Fig 6-3: rotor hub centreline STA 100.0, WL 83.0; hub-fairing top WL 89.5 (8.72 ft above the ground, Fig 1-1). */
export const MAIN_HUB = { x: x(100), y: 0, z: z(83) } as const;
export const HUB_FAIRING_TOP_Z = z(89.5);
/** RFM Fig 1-1: static blade height 7.65 ft at the root (front view). */
export const STATIC_BLADE_ROOT_HEIGHT = 7.65 * FT;

// ------------------------------------------------------------------------------------------- tail rotor
/** RFM 1-10: two blades, teetering ("semi-rigid"), on the LEFT of the boom. */
export const TAIL_ROTOR_BLADES = 2;
/** RFM Fig 1-1: 4.58 ft (55 in) disc. */
export const TAIL_ROTOR_RADIUS = 55 * IN / 2;
/** F / ESTIMATE: OH-6A tail rotor chord 0.12 m and -8 deg twist (Heffley p34). */
export const TAIL_ROTOR_CHORD = 0.12;
export const TAIL_ROTOR_TWIST_DEG = -8;
/** ESTIMATE (the S269 legacy sense); T2 verifies against the render and the yaw response. */
export const TAIL_ROTOR_ROTATION = -1;
/** RFM Fig 1-1 note 1: on the ground (full fuel) the cargo deck sits 4.7 deg nose up. Fig 1-1 heights are taken in that attitude. */
export const GROUND_ATTITUDE_DEG = 4.7;
/**
 * RFM Fig 6-3: tail-rotor centreline STA 284.0. Height: the lowest tip is 2.0 ft above the ground in the 4.7 deg
 * ground attitude (Fig 1-1); the ground line WL -15.2 holds at the mast (the hub-fairing check above), and at STA 284
 * the nose-up attitude has lowered the tail by (284 - 100) sin 4.7 = 15.1 in, so in these level axes the hub is
 * 24 + 27.5 + 15.1 = 66.6 in above that line: WL 51.4 (the OH-6A's is WL 54.3, Heffley p34, F). D. Lateral: on the
 * left of the boom; ESTIMATE 0.30 m (OH-6A hub BL -11.6 in = -0.295 m, F).
 */
export const TAIL_HUB = { x: x(284), y: -0.3,
  z: zh(2.0 * FT + TAIL_ROTOR_RADIUS + (284 - 100) * IN * Math.sin(GROUND_ATTITUDE_DEG * Math.PI / 180)) } as const;
/** TCDS p14: tail-rotor pitch +27 deg (thrust to the right, anti-torque) to -13..-15 deg. */
export const TAIL_PITCH_DEG = { max: 27, min: -14 } as const;

// ------------------------------------------------------------------------------------------- fuselage, boom, tail surfaces
/** RFM Fig 1-1 / spec p9: overall length rotors turning 30.81 ft; fuselage (nose to the aft-most fin) 23.88 ft. */
export const OVERALL_LENGTH = 30.81 * FT;
export const FUSELAGE_LENGTH = 23.88 * FT;
/** RFM Fig 6-2/6-3: nose at STA 15.0. */
export const NOSE_X = x(15);
export const TAIL_END_X = NOSE_X - FUSELAGE_LENGTH;
/** RFM Fig 1-1: cabin / fuselage maximum width 4.57 ft; cabin roof 6.77 ft above the ground; belly 1.27 ft. */
export const CABIN_WIDTH = 4.57 * FT;
export const CABIN_ROOF_Z = zh(6.77 * FT);
export const BELLY_Z = zh(1.27 * FT);
/** RFM Fig 6-3: firewall / aft bulkhead STA 174.0; cargo compartment STA 78.5-124; floor WL 11.98; centre beam WL 45.36. */
export const FIREWALL_X = x(174);
export const FLOOR_Z = z(11.98);
/** RFM Fig 6-3: tailboom root at the cant STA 197.78, WL 55.34; frame-base cant STA 281.12. */
export const BOOM_ROOT = { x: x(197.78), z: z(55.34) } as const;
export const BOOM_END_X = x(281.12);
/**
 * Horizontal stabiliser: T-tail on the upper fin, span 5.43 ft with toed endplates (RFM Fig 1-1; spec); centreline
 * WL 96.91, top WL 102.17 (Fig 6-3); incidence 8.92-9.42 deg to a line perpendicular to the mast (TCDS p14), leading
 * edge UP: the same TCDS signs the 369FF's stab "-1.9 deg nose down with respect to waterline plane" (p21), so its
 * unsigned 369D/E figure is positive, and leading edge down (-12.17 deg to the waterline) would stall the surface at
 * the cruise attitude. heli-archive (S): "set at +5 deg and produces negative lift" (an inverted cambered section,
 * rotorcraft.ts). Leading edge station and chord ESTIMATE (3V): STA 287, chord 0.30 m.
 */
export const HORIZONTAL_STABILIZER = {
  span: 5.43 * FT,
  chord: 0.3,
  leadingX: x(287),
  z: z(96.91),
  incidenceToMastNormalDeg: 9.17,
  endplates: { height: 0.3, toeDeg: 5 },
} as const;
/** Stabiliser chord to the fuselage waterline, deg, leading edge up: the mast normal lies SHAFT_TILT_DEG nose-down of
 * the waterline, so 9.17 - 3 = +6.17 deg. The flight model (rotorcraft.ts) and the exterior both read this. */
export const STAB_INCIDENCE_TO_WL_DEG = HORIZONTAL_STABILIZER.incidenceToMastNormalDeg - SHAFT_TILT_DEG;
/** Upper fin (swept, carries the T-stab; top 8.4 ft above the ground) and lower fin with the tail-skid bumper (bottom WL 25.46). 3V ESTIMATE outlines. */
export const UPPER_FIN_TOP_Z = zh(8.4 * FT);
export const LOWER_FIN_BOTTOM_Z = z(25.46);
export const UPPER_FIN_OUTLINE = [
  { x: x(268), y: 0, z: z(60) },
  { x: x(286), y: 0, z: z(96.91) },
  { x: x(296), y: 0, z: z(96.91) },
  { x: x(290), y: 0, z: z(60) },
] as const;
export const LOWER_FIN_OUTLINE = [
  { x: x(270), y: 0, z: z(50) },
  { x: x(283), y: 0, z: z(25.46) },
  { x: x(290), y: 0, z: z(26.67) },
  { x: x(288), y: 0, z: z(50) },
] as const;

// ------------------------------------------------------------------------------------------- skids
/** RFM Fig 1-1: skid track 6.45 ft (outside); tube about 8.3 ft from STA 28 (upturned toe) to STA 128 (3V). */
export const SKID_TUBE_RADIUS = 0.038;
export const SKID_HALF_TRACK = 6.45 * FT / 2 - SKID_TUBE_RADIUS;
export const SKID_FRONT_X = x(28);
export const SKID_REAR_X = x(128);
/** RFM Fig 6-2 (3V): gear struts at the cargo-compartment frames STA 78.5 and STA 124; nitrogen dampers (RFM 1-9). */
export const SKID_CONTACT_FRONT_X = x(78.5);
export const SKID_CONTACT_REAR_X = x(124);
/**
 * The skid tubes are not parallel to the waterlines: with full fuel the 500E sits 4.7 deg nose up on level ground
 * (RFM Fig 1-1 note 1). The front strut contacts are lower in body axes than the rear ones (SKID_Z, which stays the
 * reference height at the rear struts): the contact span x tan(4.7 deg) = 0.095 m, less the 1.7 deg the dampers'
 * unequal static strokes and the tall CG's aft load shift on the nose-up stance add (pilot, full fuel, the 0.14 m
 * dampers of rotorcraft.ts; docs/md500-flight-model.md "Skid gear"): 0.061 m. D / calibrated.
 */
export const SKID_FRONT_Z = SKID_Z + (SKID_CONTACT_FRONT_X - SKID_CONTACT_REAR_X) * Math.tan((GROUND_ATTITUDE_DEG - 1.7) * Math.PI / 180);

// ------------------------------------------------------------------------------------------- crew
/** TCDS p13 / RFM 6-3: pilot (LH command) seat STA 73.5, BL -13.0; RH forward passenger BL +15.5. */
export const SEAT_CENTRES = [
  { x: x(73.5), y: -13.0 * IN, z: z(21.5) },
  { x: x(73.5), y: 15.5 * IN, z: z(21.5) },
] as const;
export const PILOT_SEAT = 0;
/** ESTIMATE seated eye: 0.08 m ahead of the seat arm, 0.80 m above the corner-seat WL 21.5. */
export const PILOT_EYE = { x: x(73.5) + 0.08, y: -13.0 * IN, z: z(21.5) - 0.8 } as const;

/** Cyclic rigging, TCDS p14 (relative to the rigging position): forward 17-18.5, aft 7-9.3, left 7-9.3, right 5.5-8.5 deg. Mid values. */
export const CYCLIC_LIMITS_DEG = { forward: 17.75, aft: 8.15, left: 8.15, right: 7.0 } as const;
/** RFM 4-12: the longitudinal trim neutral for start and shutdown is about 1/3 of the travel from full aft (8.15 / 25.9 = 0.31). */
export const CYCLIC_NEUTRAL_FROM_AFT = CYCLIC_LIMITS_DEG.aft / (CYCLIC_LIMITS_DEG.forward + CYCLIC_LIMITS_DEG.aft);
/** TCDS p14: collective range 14.25-18.0 deg (relative; the absolute low-pitch angle is not given). */
export const COLLECTIVE_RANGE_DEG = 16.1;
