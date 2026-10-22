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
// The flight model (bo105/rotorcraft.ts) flies these numbers: hub, tail rotor, stabiliser, fin, skids and their contacts.
// The body REFERENCE point (origin) is 0.96 m below the hub (F METU); the CG of a loading is the mass model's
// (bo105/mass.ts: about 1.5 m below the hub at 2200 kg).

const DEG = Math.PI / 180;

/** Reference point (body origin) station, m aft of the datum. D */
export const REF_STATION_M = 3.150;
/** Body x of a station given in metres aft of the datum. */
export const x = (staM: number): number => REF_STATION_M - staM;

/** Hub centre height above the skid soles, m: 3.00 m to the top of the head (P TCDS p8) less about 0.10 m. 3V/ESTIMATE */
export const HUB_HEIGHT = 2.90;
/** Body REFERENCE point below the hub, m: the Theodore model's CG height (F METU: 3.15 ft). The mass model's CG of a
 *  loading sits lower (mass.ts: about 1.53 m below the hub at 2200 kg; the METU height cannot hold with the AR-280 inertia
 *  and the underfloor tanks, docs/bo105-flight-model.md section 3). Kept as the axes' origin (every consumer's z). */
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
 * puts the TR hub at about STA 9.14 m. Height 2.80 m above the skid soles, near the main hub's 2.90 m (3V/D: the MM's
 * "about 3.80 m with a tail-rotor blade vertical" less R 0.95 m gives 2.85 m (OCR-garbled, UNVERIFIED); the D-HADO
 * near-profile puts the hub a few tenths below the main hub; plan 6.2 "the Bo 105 TR sits at the fin top near hub
 * height"). Raised from the scaffold's 2.30 m at BX's request (docs/bo105-exterior.md, request 2). Lateral offset
 * ESTIMATE.
 */
export const TAIL_HUB = { x: x(9.14), y: -0.26, z: z(2.80) } as const;
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
/** Swept vertical fin carrying the TR gearbox at its top; tail skid under it. 3V ESTIMATE outline (station m, height m):
 *  the root leading edge near STA 8.1 and the top at the tail-rotor hub (BX's request 2, D-HADO near-profile). */
export const FIN_OUTLINE: readonly (readonly [number, number])[] = [[8.10, 1.70], [8.98, 2.80], [9.26, 2.86], [8.72, 1.38]];
/** Tail skid under the fin: its lowest point (station m, height m). 3V ESTIMATE (D-HILF, D-HADO). */
export const TAIL_SKID = { sta: 8.85, height: 1.02 } as const;

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
/** Ground contacts of the skid tubes (the flight model's four points), stations m: the straight run of the tube, about
 *  0.25 m inside each end (the toe curls up; the heel ends at the rear cross-tube bend). 3V ESTIMATE. */
export const SKID_CONTACT_FRONT_X = x(2.00);
export const SKID_CONTACT_REAR_X = x(4.25);
/**
 * Body z of the FRONT ground contacts, m: the skids set 1.25 deg nose-up to the fuselage reference, so the fuselage rests
 * about 1.3 deg nose-up on level ground (with the skids' static compression) and the IGE hover attitude (about +3 deg at
 * 2200 kg mid-CG) is within 2 deg of it: the plan's ground-stance row (fuselage within 1.5 deg of level, no lift-off
 * pitch jump above 2 deg). AGENT/3V: P5 FM Fig 1-1 draws a 1.5 deg angle between the skid tube and the reference line at
 * the aft end whose sense is not resolved (research-bo105 section 14). D: the contacts 2.25 m apart, 2.25 x tan(1.25
 * deg) = 0.049 m.
 */
export const SKID_GROUND_ATTITUDE_DEG = 1.25;
export const SKID_FRONT_Z = SKID_Z + (SKID_CONTACT_FRONT_X - SKID_CONTACT_REAR_X) * Math.tan(SKID_GROUND_ATTITUDE_DEG * DEG);
/** Skid tube radius, m (3V ESTIMATE: about 80 mm tube). */
export const SKID_TUBE_RADIUS = 0.04;

// ---------------------------------------------------------------------------------------------- crew
/** Pilot in the RIGHT seat (the certificated minimum-crew position, P TCDS p11). Eye point 3V ESTIMATE. */
export const PILOT_SEAT_Y = 0.36;
export const PILOT_EYE = { x: x(1.62), y: PILOT_SEAT_Y, z: z(1.70) } as const;

/** Shaft tilt in radians (for convenience). */
export const SHAFT_TILT = SHAFT_TILT_DEG * DEG;
