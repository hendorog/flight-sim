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
