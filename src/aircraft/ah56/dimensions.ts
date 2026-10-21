// Lockheed AH-56A Cheyenne: the GEOMETRY CONTRACT shared by the flight model (AG, AC, AH), the exterior (AX), the panel
// (PN) and the sound (AU). Plain data. Final at the scaffold (S0); owner afterwards: AG (others request changes in PR
// text). Plan revision 2, section 2.3; research-ah56 section 2 (station table).
//
// Tags: P primary ([ASTA-72] US Army Aviation Systems Test Activity 1972 report; [AMCS-73]; [APE-I]; page in the comment),
// S secondary (Jane's 1969-70 via the Wikipedia spec box), D derived (arithmetic shown), 3V from photos, ESTIMATE.
//
// AXES. Stations are inches: FS fuselage station, WL water line (up), BL butt line (right +). The FS/WL datum is not
// defined in any source read. Body FRD metres about the reference point at FS 298.0 (the AMCS test CG, P) and WL_cg:
//   x = (298.0 - FS) * 0.0254,   y = BL * 0.0254,   z = (WL_CG - WL) * 0.0254.
// WL_CG = 95 is an ESTIMATE (the CG height is not published).
//
// NOTE (S0): the S0 physics STUB flies the MD 500E's hub point, skids and airframe (ah56/base.ts); the exterior (AX)
// builds to THESE numbers, and AG moves the physics onto them.

const IN = 0.0254;
/** Reference point station, in (P AMCS-73 p 37: CG FS 298 +/- 1, gear down). */
export const FS_REF = 298.0;
/** CG water line, in. ESTIMATE */
export const WL_CG = 95;
export const x = (fs: number): number => (FS_REF - fs) * IN;
export const y = (bl: number): number => bl * IN;
export const z = (wl: number): number => (WL_CG - wl) * IN;

/** Ground line in the ground attitude, WL (D/3V: height 164.5 in S with the head about 15-20 in above the WL 165.3
 *  flange; the belly turret 21 in above the ground at FS 190 P agrees). ESTIMATE */
export const GROUND_WL = 18;
/** Body z of the ground contact at rest (tyres), m. D from GROUND_WL. */
export const GROUND_Z = z(GROUND_WL);

// ---------------------------------------------------------------------------------------------- main rotor
/** Four blades; diameter 51.23 ft, R = 25.617 ft = 7.808 m (P ASTA-72 p 48, AMCS-73 p 21). */
export const MAIN_ROTOR_BLADES = 4;
export const MAIN_ROTOR_RADIUS = 25.617 * 12 * IN;
/** Chord, m (P: 28 in; solidity 0.1159 = 4 c / (pi R)). */
export const MAIN_ROTOR_CHORD = 0.711;
/** Root cut-out, m. ESTIMATE */
export const MAIN_ROTOR_ROOT_CUTOUT = 1.30;
/** Twist, deg (P). Precone 2 deg (P ASTA-72 p 48). Shaft incidence 0 (P). */
export const MAIN_ROTOR_TWIST_DEG = -5;
export const MAIN_ROTOR_PRECONE_DEG = 2;
export const SHAFT_TILT_DEG = 0;
/** Rotation: counter-clockwise viewed from above (+1). D (engine failure gives a LEFT yaw, research-ah56 section 5). */
export const MAIN_ROTOR_ROTATION = 1;
/** Hub (bottom of the fixed hub at the shaft flange): FS 300.0, WL 165.3, BL 0 (P ASTA-72 p 48). */
export const MAIN_HUB = { x: x(300.0), y: 0, z: z(165.3) } as const;
/** ICS gyro X: four arms, 9.7 ft tip to tip, about 33 deg to the blades (P ASTA-72 App C). AMCS: no gyro X visible. */
export const ICS_GYRO_SPAN = 9.7 * 12 * IN;
export const ICS_GYRO_CANT_DEG = 33;

// ---------------------------------------------------------------------------------------------- tail rotor, pusher
/** Tail rotor: 4 blades, teetering, 10 ft (R 1.524 m), chord 14 in = 0.356 m; LEFT side; hub (teeter centre) FS 658.5,
 *  WL 114.5, BL 72.0 LEFT (P ASTA-72 p 50); delta-3 37.5 deg (P). */
export const TAIL_ROTOR_BLADES = 4;
export const TAIL_ROTOR_RADIUS = 5 * 12 * IN;
export const TAIL_ROTOR_CHORD = 0.356;
export const TAIL_HUB = { x: x(658.5), y: y(-72.0), z: z(114.5) } as const;
/** Pusher propeller: Hamilton Standard, 3 blades, 10 ft (R 1.524 m); hub FS 675.7, WL 114.5, BL 0 (P ASTA-72 p 51). */
export const PUSHER_BLADES = 3;
export const PUSHER_RADIUS = 5 * 12 * IN;
export const PUSHER_HUB = { x: x(675.7), y: 0, z: z(114.5) } as const;

// ---------------------------------------------------------------------------------------------- wing, tail surfaces
/** Wing: 195 ft^2, span 26.7 ft (tip BL 160.2, P ASTA-72 p 53), AR 3.66, 1/4-MAC FS 308.2 (P), dihedral 5 deg (P),
 *  incidence L 11 deg 52 min / R 12 deg 58 min (P; datum unstated), twist -3 deg (P). MAC 2.316 m (D). */
export const WING = { areaM2: 195 * 0.09290304, span: 26.7 * 12 * IN, tipBl: 160.2, quarterMacX: x(308.2), dihedralDeg: 5,
  incidenceDeg: { left: 11 + 52 / 60, right: 12 + 58 / 60 }, twistDeg: -3, macM: 2.316 } as const;
/** Wing pylons at BL 70 (inboard) and BL 117 (outboard) (P ASTA-72 App J p 144). */
export const PYLON_BL = [70, 117] as const;
/** Horizontal stabiliser (bobtailed LEFT surface carrying the TR): 1/4-MAC FS 637.18 (P ASTA-72 p 55), 31.83 ft^2, span
 *  3.301 m, incidence 2 deg (P). */
export const HORIZONTAL_STABILIZER = { quarterMacX: x(637.18), areaM2: 31.83 * 0.09290304, span: 3.301, incidenceDeg: 2 } as const;
/** Ventral fin: 1/4-MAC FS 620.3, WL 79.4; root WL 114.5, tip WL 37.6; 24.6 ft^2 (P ASTA-72 p 56). */
export const VENTRAL_FIN = { quarterMac: { x: x(620.3), z: z(79.4) }, rootZ: z(114.5), tipZ: z(37.6), areaM2: 24.6 * 0.09290304 } as const;

// ---------------------------------------------------------------------------------------------- fuselage
/** Fuselage length 54 ft 8 in = 656 in (S Jane's). Nose about FS 30 (D/3V: 656 in ending at the spinner). */
export const FUSELAGE_LENGTH = 656 * IN;
export const NOSE_FS = 30;
export const NOSE_X = x(NOSE_FS);
/** Height 13 ft 8.5 in (S), presumably to the top of the head. */
export const HEIGHT = 164.5 * IN;
/** Belly turret (XM52): FS 190, lowest point 21 in above the ground (P ASTA-72 p 36 para 91). */
export const BELLY_TURRET = { x: x(190), clearanceM: 21 * IN } as const;

// ---------------------------------------------------------------------------------------------- gear
/** Retractable tail-wheel gear. Mains: track about 62 in (D from the "landing gear 5 ft 2 in" pivot radius, P ASTA-72
 *  p 37), retracting into the sponsons. Main axles at FS 268 (3V, AG stage 2: the Fort Campbell left and Rucker right
 *  side photos put the main wheels 30-35 in ahead of the mast at FS 300; the scaffold's FS 285 left the mains only 13 in
 *  ahead of the CG, where braking above 0.17 g tips the aircraft onto its nose). Tail wheel under the ventral fin,
 *  about FS 640 (P location, station 3V), retracting into the fin; 5.00x4 tyre at 100 psi (P). */
export const MAIN_GEAR = { x: x(268), halfTrack: 31 * IN } as const;
export const TAIL_WHEEL = { x: x(640) } as const;
/** Tyre rolling radii, m: main 11 in (3V; the exterior's MAIN_TYRE), tail 6.75 in (a 5.00x4 tyre, P size). */
export const MAIN_TYRE_RADIUS = 11 * IN;
export const TAIL_TYRE_RADIUS = 6.75 * IN;
/** Main wheel half-track, m (D, 62 in track). */
export const MAIN_GEAR_HALF_TRACK = 31 * IN;

// ---------------------------------------------------------------------------------------------- crew
/** Pilot in the REAR seat. Vibration pickups / floor points: front FS 124 (FS 130.5 BL 1 R WL 80.5 AMCS), rear FS 170
 *  WL 98.5 (P APE-I para 138, AMCS-73 App G p 41). Eye point ESTIMATE. */
export const PILOT_EYE = { x: x(168), y: 0, z: z(130) } as const;
export const GUNNER_EYE = { x: x(118), y: 0, z: z(112) } as const;
