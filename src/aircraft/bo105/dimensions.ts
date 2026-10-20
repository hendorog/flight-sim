// MBB Bo 105 CB-4: the GEOMETRY CONTRACT shared by the flight model (BO), the exterior and cockpit (BX), the panel
// (PN) and the sound (AU). Plain data. Final at the scaffold (S0); owner afterwards: BO (others request changes in PR
// text). Plan revision 2, section 2.3.
//
// Tags: P primary (EASA TCDS EASA.R.011 Issue 3 Section 2; MM; AGARD AR-280 Table 6.2.1 p 145), P5 the CB-5 flight
// manual used for the CB-4 (docs/bo105-sources.md), F family/near-variant, D derived (arithmetic shown), 3V measured
// on the FM Fig 1-1 three-view or the reference photos, ESTIMATE judged. Never present an ESTIMATE as verified.
//
// AXES. Body FRD, metres. The datum is 3000 mm forward of the levelling point at frame 7 (P TCDS p11); stations are
// mm aft of it. The reference point (body origin) is at STA 3150 mm, about the mast (D: the CG range 3038-3395 mm sits
// about 0.1 m either side of the hub; the exact mast station was not found), and 0.96 m below the hub (F METU: CG
// 3.15 ft below the hub). x = (3.150 - sta_m), y = right, z = (SKID_Z - height above the skid soles).
//
// NOTE (S0): the S0 physics STUB still flies the MD 500E's hub point, skids and airframe (bo105/rotorcraft.ts); the
// exterior (BX) builds to THESE numbers, and BO moves the physics onto them.

const DEG = Math.PI / 180;

/** Reference point (body origin) station, m aft of the datum. D */
export const REF_STATION_M = 3.150;
/** Body x of a station given in metres aft of the datum. */
export const x = (staM: number): number => REF_STATION_M - staM;

/** Hub centre height above the skid soles, m: 3.00 m to the top of the head (P TCDS p8) less about 0.10 m. 3V/ESTIMATE */
export const HUB_HEIGHT = 2.90;
/** CG (reference point) below the hub, m. F (METU: 3.15 ft) */
export const CG_BELOW_HUB = 0.96;
/** Body z of the skid soles (ground contact at rest), m: HUB_HEIGHT - CG_BELOW_HUB. D */
export const SKID_Z = HUB_HEIGHT - CG_BELOW_HUB;
/** Body z of a point `h` metres above the skid soles. */
export const z = (h: number): number => SKID_Z - h;

// ---------------------------------------------------------------------------------------------- main rotor
/** Four blades (P TCDS p8). */
export const MAIN_ROTOR_BLADES = 4;
/** Radius, m: diameter 9.84 m (P TCDS p8, MM ch 01 p3; AR-280 9.824). */
export const MAIN_ROTOR_RADIUS = 9.84 / 2;
/** Chord, m: rectangular Type 1 blade, NACA 23012 (P MM ch 14 p3; AR-280). */
export const MAIN_ROTOR_CHORD = 0.27;
/** Blade root cut-out (start of the aerodynamic blade), m. ESTIMATE (the plan's uniform-blade root; 22 % R). */
export const MAIN_ROTOR_ROOT_CUTOUT = 1.10;
/** Equivalent-linear twist, deg: -6.2 (P AR-280, the Theodore/Padfield flight-test model) chosen over the -8 deg
 *  hardware value (P NASA TM-85990). AGENT choice. */
export const MAIN_ROTOR_TWIST_DEG = -6.2;
/** Built-in coning (precone), deg. P NASA TM-85990 */
export const MAIN_ROTOR_PRECONE_DEG = 2.5;
/** Counter-clockwise viewed from above: +1 (D from FM 3-34/3-40: double engine failure yaws LEFT). */
export const MAIN_ROTOR_ROTATION = 1;
/** Shaft tilt forward, deg (P5 FM Fig 1-1; P AR-280 "-3.0 deg"). */
export const SHAFT_TILT_DEG = 3;
/** Hub centre, body m. D (x at the reference station; z from HUB_HEIGHT). */
export const MAIN_HUB = { x: x(3.150), y: 0, z: z(HUB_HEIGHT) } as const;
/** Solidity, thrust-weighted (P AR-280): 4 x 0.27 / (pi x 4.92) = 0.0699. */
export const MAIN_ROTOR_SOLIDITY = 0.07;
/** Equivalent hinge offset candidates, fraction of R: 0.12 with zero spring (P BK117-ERF7 "12 %, zero spring");
 *  12-15.2 % in the literature (research/hingeless_bo105_lynx.md section 1). RC fixes it (plan section 4). */
export const EQUIVALENT_HINGE_OFFSET_FRACTION = 0.12;
/** Rotating first flap frequency, per rev: 1.10-1.12 (F/P literature); RC's fitting rule picks inside the band. */
export const FLAP_FREQUENCY_BAND = [1.10, 1.12] as const;

// ---------------------------------------------------------------------------------------------- tail rotor
/** Two-blade teetering tail rotor, NACA 0012, twist 0 (P5 FM 7-21; P AR-280). */
export const TAIL_ROTOR_BLADES = 2;
/** Radius, m: diameter 1.90 m (P TCDS p8). */
export const TAIL_ROTOR_RADIUS = 1.90 / 2;
/** Chord, m (P MM 0.180; AR-280 0.179). */
export const TAIL_ROTOR_CHORD = 0.18;
export const TAIL_ROTOR_TWIST_DEG = 0;
/** Tail rotor rpm / rotor rpm: 233 / 44.4 = 5.25 (F METU / Theodore; D). */
export const TAIL_ROTOR_RATIO = 5.25;
/** Sense for the renderer, as the MD 500E's (rotation not found: gap). ESTIMATE */
export const TAIL_ROTOR_ROTATION = -1;
/**
 * Tail-rotor hub: on the LEFT of the fin at the fin top (P5 FM Fig 1-1 / 7-1, photo D-HILF; 3V). Station D: the
 * 11.86 m overall length (P5) taken from the main-rotor front tip (STA 3.15 - 4.92 = -1.77) to the tail-rotor rear tip
 * puts the TR hub at about STA 9.14 m. Height 3V ESTIMATE (fin top, a little below the main-rotor hub). Lateral offset
 * ESTIMATE.
 */
export const TAIL_HUB = { x: x(9.14), y: -0.26, z: z(2.30) } as const;
/** Tail-rotor shaft cant, deg (F METU / Theodore model -4.2). */
export const TAIL_SHAFT_CANT_DEG = -4.2;

// ---------------------------------------------------------------------------------------------- fuselage
/** Overall length, rotors turning, m (P5 FM Fig 1-1; P MM; AR-280 11.84). */
export const OVERALL_LENGTH = 11.86;
/** Fuselage including the tail boom, TR blade vertical, m (P5 FM Fig 1-1; AR-280 8.45). */
export const FUSELAGE_LENGTH = 8.56;
/** Cabin hull length and width, m (P TCDS p8; P5 FM Fig 1-1). */
export const HULL_LENGTH = 4.30;
export const HULL_WIDTH = 1.58;
/** Height to the top of the rotor head, m (P TCDS p8). */
export const HEIGHT_TO_HEAD = 3.00;
/** Nose: about STA 0.70 m (D: the tail end at about STA 9.26 m, just aft of the TR hub, less the 8.56 m fuselage). 3V/ESTIMATE */
export const NOSE_X = x(0.70);
export const TAIL_END_X = NOSE_X - FUSELAGE_LENGTH;
/** Cabin floor and roof heights above the skid soles, m. 3V ESTIMATE (photos). */
export const FLOOR_HEIGHT = 0.62;
export const CABIN_ROOF_HEIGHT = 2.02;
/** Belly height above the skid soles, m (MM OCR candidate 0.35 m fuselage clearance, UNVERIFIED; 3V). */
export const BELLY_HEIGHT = 0.40;

// ---------------------------------------------------------------------------------------------- stabiliser and fin
/** Horizontal stabiliser: span 2.0 m, chord 0.4 m, area 0.8 m^2, incidence 0 deg (P AR-280 p145); with endplates (P TCDS
 *  p8; area and outline 3V/ESTIMATE). Station and height 3V ESTIMATE. */
export const HORIZONTAL_STABILIZER = { span: 2.0, chord: 0.4, area: 0.8, incidenceDeg: 0,
  quarterChord: { x: x(7.55), z: z(1.62) }, endplates: { height: 0.45, chord: 0.42 } } as const;
/** Swept vertical fin carrying the TR gearbox at its top; tail skid under it. 3V ESTIMATE outline (station m, height m). */
export const FIN_OUTLINE: readonly (readonly [number, number])[] = [[8.55, 1.30], [9.05, 2.30], [9.35, 2.35], [9.30, 1.25]];

// ---------------------------------------------------------------------------------------------- skids
/** Skid track (tube centre to tube centre), m (P5 FM Fig 1-1: 2.53 unloaded). */
export const SKID_TRACK = 2.53;
export const SKID_HALF_TRACK = SKID_TRACK / 2;
/** Skid tube length and stations, m. ESTIMATE (MM OCR candidate 2.70 m, UNVERIFIED; 3V). */
export const SKID_LENGTH = 2.70;
export const SKID_FRONT_X = x(1.75);
export const SKID_REAR_X = x(4.45);
/** Skid angle to the drawn reference line at the aft end, deg (3V FM Fig 1-1; sense unresolved). Ground stance target:
 *  skids level +/-1.5 deg (plan 6.2). */
export const SKID_ANGLE_DEG = 1.5;

// ---------------------------------------------------------------------------------------------- crew
/** Pilot in the RIGHT seat (the certificated minimum-crew position, P TCDS p11). Eye point 3V ESTIMATE. */
export const PILOT_SEAT_Y = 0.36;
export const PILOT_EYE = { x: x(1.62), y: PILOT_SEAT_Y, z: z(1.70) } as const;

/** Shaft tilt in radians (for convenience). */
export const SHAFT_TILT = SHAFT_TILT_DEG * DEG;
