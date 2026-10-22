// Lockheed AH-56A Cheyenne: the facts the definition, the gyro, the panel, the sound and the consistency check must agree
// on. Plain data. Final at the scaffold; owner afterwards: AG (others request changes in PR text). Tags as
// dimensions.ts; pages in research-ah56 sections 5-12 and docs/ah56-sources.md.

/** Rotor 100 %, rpm (P). AMCS normal 97.5 % = 239.85 rpm (P AMCS-73); ICS 100 % = 246 rpm (P ASTA-72). */
export const AH56_NR_100 = 246;
export const AH56_AMCS_NR_FRACTION = 0.975;
/** Rotor limits, % (P): power on 95-105, power off 85-110. */
export const AH56_NR_PCT = { powerOn: [95, 105], powerOff: [85, 110] } as const;
/** T64-GE-716 power turbine (Nf) 100 %, rpm (S 13,600), so the engine-to-rotor ratio is 13,600 / 246 = 55.28 (D). */
export const AH56_NF_100_RPM = 13_600;
export const AH56_ENGINE_RATIO = AH56_NF_100_RPM / AH56_NR_100;
/** Pusher rpm / rotor rpm: 1717 / 246 = 6.980 (D); tail rotor rpm / rotor rpm: 1238 / 246 = 5.033 (D). */
export const AH56_PROP_RATIO = 1717 / 246;
export const AH56_TAIL_RATIO = 1238 / 246;
/** Beep (RPM SET) range, fraction of Nr 100 % (ESTIMATE inside the P power-on band); resume.ts TURBOSHAFT_SET_PCT. */
export const AH56_N2_BEEP = { range: [0.95, 1.05], setDefault: 1.0 } as const;

/** Torque: 100 % = 3435 shp; transmission limit 3925 shp = 114 % (P). */
export const AH56_TORQUE_100_SHP = 3435;
export const AH56_TRANSMISSION_LIMIT_SHP = 3925;
export const AH56_TORQUE_LIMIT_PCT = 114;
/** T64-GE-716 maximum, shp (P: 4330 in 1972 / 4275 in 1973). Rating ladder ESTIMATE 4330/4090/3810 shp, SFC 0.49. */
export const AH56_ENGINE_MAX_SHP = { ics: 4330, amcs: 4275 } as const;
/** TIT, C (P): green 300-740; 740 maximum continuous; 740-770 yellow 30 min; 770-780 yellow 10 min; 785 inspection (red). */
export const AH56_TIT_C = { greenLow: 300, continuous: 740, yellow30min: 770, yellow10min: 780, inspection: 785 } as const;
/** Ng, % (P): idle 58-72; 100 continuous; 101.5 red. */
export const AH56_NG_PCT = { idle: [58, 72], continuous: 100, red: 101.5 } as const;

/** Pusher blade angle at 0.7 R (42 in), deg (P): range -17.2 to +40.8; flight minimum -12; hover detent -2.2; autorotation
 *  +8; delta-beta +18 from forward, -8.5 (AMCS) / -7 (ICS) from reverse. Prop inertia 13.98 slug-ft^2 = 18.95 kg m^2 (P). */
export const AH56_PROP_BETA_DEG = { min: -17.2, max: 40.8, flightMin: -12, hoverDetent: -2.2, autorotation: 8,
  deltaBetaForward: 18, deltaBetaReverse: { amcs: -8.5, ics: -7 } } as const;
export const AH56_PROP_INERTIA = 13.98 * 1.3558179483314004;

/** Stick travel, in, longitudinal x lateral (P): ICS 11.0 x 7.5; AMCS 9.9 x 5.8. Pedals 6.4 in (AMCS, P). */
export const AH56_STICK_IN = { ics: { longitudinal: 11.0, lateral: 7.5 }, amcs: { longitudinal: 9.9, lateral: 5.8 }, pedals: 6.4 } as const;
/** Collective, indicated deg (P): AMCS 4.5-21.5, 13 cruise; ICS 5-7 cruise ("13 deg AMCS = 6 deg ICS": AMCS reads +7, D). */
export const AH56_COLLECTIVE_DEG = { amcsIndicated: [4.5, 21.5], amcsCruise: 13, icsCruise: [5, 7], amcsOffset: 7 } as const;

/** Masses, lb (P): AMCS test 18,300 at FS 298; empty (production) 12,874; TOW mission 18,750; max 19,200 (AMCS) / 20,500
 *  (ICS). Fuel about 2,500 lb ESTIMATE (capacity not found). Low-fuel warning 390 lb (P). */
export const AH56_MASS_LB = { test: 18_300, empty: 12_874, towMission: 18_750, maxAmcs: 19_200, maxIcs: 20_500, fuel: 2_500, lowFuel: 390 } as const;
/** Inertia, kg m^2: ESTIMATES scaled from the AH-1G (plan section 0, item 9). */
export const AH56_INERTIA = { Ixx: 10_850, Iyy: 56_900, Izz: 50_200, Ixz: 2_700 } as const;
/** Main-rotor polar inertia 13,217 kg m^2 (9748 slug-ft^2); drivetrain referred to the rotor 14,564 kg m^2 (P). */
export const AH56_ROTOR_INERTIA = 13_217;
export const AH56_DRIVETRAIN_INERTIA = 14_564;

/** Gear: limit speed 130 KCAS (P). */
export const AH56_GEAR_LIMIT_KCAS = 130;

// ---------------------------------------------------------------------------------------------- stage 2 (AG)
const SLUG_FT2 = 1.3558179483314004; // kg m^2 per slug ft^2 (= N m per lbf ft)
const FT_LB = 1.3558179483314004;    // N m per ft lbf
const HP = 745.6998715822702;

/** Tail rotor polar inertia, kg m^2: 12.6 slug-ft^2 (P ASTA-72 p 50). */
export const AH56_TAIL_ROTOR_INERTIA = 12.6 * SLUG_FT2;
/** Tail-rotor blade pitch range, deg (P 1972/AMCS): -7.4 to +24.2 (+ = thrust to the right, the anti-torque side). */
export const AH56_TAIL_PITCH_DEG = { min: -7.4, max: 24.2 } as const;
/** Transmission loss the Army used, shp (P ASTA-72 App G para 3): 90 constant; as an efficiency at 3925 shp, 0.977 (D). */
export const AH56_TRANSMISSION_LOSS_SHP = 90;

/** T64-GE-716 gas generator 100 %, rpm. ESTIMATE (gap: not in any source read; the T64 class). */
export const AH56_NG_100_RPM = 18_000;
/** T64-GE-716 rating ladder, shp (ESTIMATE from the GE T64-100 sheet, the 716's 4330 maximum P): maximum (10 min) 4330,
 *  military (30 min) 4090, normal 3810; SFC about 0.49 lb/shp/h. */
export const AH56_T64_RATINGS_SHP = { maximum: 4330, military: 4090, normal: 3810 } as const;
/** Engine rated power, W: the 716's 4330 shp maximum (P ASTA-72). EngineDef.ratedPower and the sound's ratedPowerW. */
export const AH56_ENGINE_RATED_W = AH56_ENGINE_MAX_SHP.ics * HP;
/** Torque gauge: % of 3435 shp at 100 % Nf, per output-shaft N m (D: 3435 shp at 13,600 rpm = 1798.6 N m = 100 %). */
export const AH56_TORQUE_PCT_PER_NM = 100 / (AH56_TORQUE_100_SHP * HP / (AH56_NF_100_RPM * Math.PI / 30));
/** Nf (power turbine) limits, % (P APE 1.1 / ASTA-72): 95-105 power on, 105 maximum, overspeed cut-off 113. */
export const AH56_NF_PCT = { powerOn: [95, 105], max: 105, overspeedCutoff: 113 } as const;
/** Condition grip (ControlInputs.throttle): OFF below 0.05, the IDLE detent at 0.18, RUN = 1 (P OFF/IDLE/RUN; fractions
 *  of grip travel AGENT, as the MD 500E's twist grip). The input profile's twistGrip deep-equals this. */
export const AH56_CONDITION_GRIP = { cutoffBelow: 0.05, groundIdle: 0.18 } as const;
/** Fuel: low-fuel warning 390 lb (P); usable capacity ESTIMATE 2,500 lb (gap). Fuel flow idle 103-350 pph, maximum 1720
 *  pph (gauge marks, P APE 1.1, T64-GE-16). */
export const AH56_FUEL_LB = { usable: AH56_MASS_LB.fuel, low: AH56_MASS_LB.lowFuel, flowIdle: [103, 350], flowMax: 1720 } as const;
/** Electrical: 28 V DC; generator amps ESTIMATE 300 (a 1970s attack helicopter's DC generator); bus dead 18 V ESTIMATE. */
export const AH56_GENERATOR_AMPS = 300;
export const AH56_BUS_DEAD_VOLTS = 18;
/** Transmission oil pressure, psi (P 1972): 70 minimum, 70-110 green, 110 red. */
export const AH56_XMSN_OIL_PSI = { min: 70, max: 110 } as const;

/** ICS control gyro (P ASTA-72 App C pp 57-60): 45 slug-ft^2, 9.7 ft, cant 33 deg, input rotation 36.0 deg advanced, max
 *  tilt +/-15 deg, 278 / 337 ft-lb per inch of stick, 4100 ft-lb/rad net spring each axis, 4 dampers (2 pitch, 2 roll) at
 *  44 in-lb/(rad/s), feather-bearing friction 28 ft-lb; stick 11.0 x 7.5 in. */
export const AH56_ICS_GYRO = {
  inertia: 45 * SLUG_FT2, cantDeg: 33, inputRotationDeg: 36, maxTiltDeg: 15,
  momentPerInch: { longitudinal: 278 * FT_LB, lateral: 337 * FT_LB },
  spring: 4100 * FT_LB, dampingPerAxis: 2 * 44 / 12 * FT_LB, frictionMoment: 28 * FT_LB,
} as const;
/** ICS blade sweep and droop (P ASTA-72 p 49): forward sweep 4 deg 00 min; droop 3 deg 10 min. */
export const AH56_ICS_BLADE = { sweepDeg: 4, droopDeg: 3 + 10 / 60 } as const;
/** AMCS control gyro (P AMCS-73 App C p 29): 1.5 slug-ft^2, 26 in; tilt stops pitch-up 10.11, pitch-down 18.05, right roll
 *  12.27, left roll 18.08 deg; stick 9.9 x 5.8 in. Blades: no sweep, droop 1 deg 53 min (P p 21). */
export const AH56_AMCS_GYRO = {
  inertia: 1.5 * SLUG_FT2, stopsDeg: { up: 10.11, down: 18.05, right: 12.27, left: 18.08 },
  droopDeg: 1 + 53 / 60,
} as const;
/** Measured responses (the tuning targets of the AMCS gyro, P AMCS-73 paras 33-34; Hoh-74 sect. 6.1): pitch 9 deg/s/in at
 *  the hover falling to 6 at 100 KCAS and about constant to 180; roll 16 deg/s/in (Hohenemser 13). */
export const AH56_AMCS_RESPONSE = { pitchHoverDegPerSecPerIn: 9, pitchDegPerSecPerIn: 6, rollDegPerSecPerIn: 16, rollHohenemser: 13 } as const;

/** Pusher twist grip as ControlInputs.propLever (0-1): blade angle at the lever ends, deg (P AMCS: -12.0 to +40.8 physical
 *  flight range on about 130 deg of grip), linear in between (ESTIMATE: the grip's 2:1 / 3:1 nonlinearity, P ASTA-72
 *  para 43, is AC's beta table). The snaps of the input profile are these lever positions. */
export const AH56_PROP_LEVER_BETA_DEG = { atZero: -12, atOne: 40.8 } as const;
/** Lever position for a blade angle, deg (the linear grip above). */
export const ah56PropLever = (betaDeg: number): number =>
  (betaDeg - AH56_PROP_LEVER_BETA_DEG.atZero) / (AH56_PROP_LEVER_BETA_DEG.atOne - AH56_PROP_LEVER_BETA_DEG.atZero);
