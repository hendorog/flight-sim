// MBB Bo 105 CB-4 (2 x Allison 250-C20B, ZF FS 72B): the facts the definition, the panel, the sound and the consistency
// check must agree on. Plain data. Final at the scaffold; owner afterwards: BO (others request changes in PR text).
// Tags: P = EASA TCDS EASA.R.011 Issue 3 Section 2 (page), P5 = Flight Manual BO 105 CB-5/CBS-5 used for the CB-4
// (Sections 2-4, 7; same engines, transmission and rotor limits), P TM = BO 105 Training Manual, D = derived,
// ESTIMATE = no source. Pages and the transfer argument: docs/bo105-sources.md.

/** Rotor at 100 %, rpm: 433 / 1.02 = 416 / 0.98 = 467 / 1.10 = 424.5 (P TCDS p10 bands). D */
export const BO105_NR_100 = 424.5;
/** Engine output shaft (N2) at 100 %, rpm (P TCDS p9, 250-C20B). */
export const BO105_N2_100_RPM = 6016;
/** Gas producer (N1) at 100 %, rpm (250-C20B; the MD 500E's EASA IM.E.052 p15 value, same engine). P */
export const BO105_N1_100_RPM = 50_970;
/** N2 rpm / Nr rpm: 6016 / 424.5 = 14.17. D */
export const BO105_ENGINE_RATIO = BO105_N2_100_RPM / BO105_NR_100;
/** Tail-rotor rpm / Nr: 233 / 44.4 = 5.25. F (METU / Theodore) */
export const BO105_TAIL_RATIO = 5.25;

/** Rotor limits, % (P TCDS p10; P5 FM 2-8): power on 98-102 (416-433 rpm), transient 95 min and 105 for 15 s; power off
 *  85-110 (Model C). */
export const BO105_NR_PCT = { powerOn: [98, 102], transientMin: 95, transientMax15s: 105, powerOff: [85, 110] } as const;
/** N2 limits, %: 102 continuous, 105 for 15 s (P TCDS p9). Beep (ENGINE TRIM fore/aft) range 98-102 % (P5 FM 4-16 normal
 *  band; the exact stops ESTIMATE). */
export const BO105_N2_PCT = { continuous: 102, transient15s: 105 } as const;
export const BO105_N2_BEEP = { range: [0.98, 1.02], setDefault: 1.0 } as const;

/** 100 % torque = 298 kW per engine at 100 % N2 (D from the TCDS kW and % pairs: 257 kW = 86 %, 283 kW = 95 %). */
export const BO105_TORQUE_100_W = 298e3;
/** 100 % torque at the output shaft, N m: 298 kW / (6016 rpm x 2 pi / 60). D */
export const BO105_TORQUE_100_NM = BO105_TORQUE_100_W / (BO105_N2_100_RPM * 2 * Math.PI / 60);
/** Torque gauge: percent per output-shaft N m. D */
export const BO105_PCT_PER_NM = 100 / BO105_TORQUE_100_NM;
/** Ratings, % torque per engine (P TCDS p9; P5 FM 2-9): AEO take-off 86 % (257 kW, 5 min, TOT 810 C), AEO MCP 86 % at
 *  779 C; OEI 95 % (283 kW): emergency 30 min at 810 C, MCP at 779 C. Cruise guide 82 % / 738 C (P5 FM 4-17). */
export const BO105_TORQUE_PCT = { aeo: 86, aeoTakeoffSeconds: 300, oei: 95, oeiEmergencySeconds: 1800, cruiseGuide: 82 } as const;
/** TOT, C (P TCDS p9; P5 FM 2-10): MCP 779, take-off 810 (5 min), transient 843 (6 s), start 927 (<= 10 s above 810). */
export const BO105_TOT_C = { mcp: 779, takeoff: 810, transient6s: 843, start: 927, cruiseGuide: 738 } as const;
/** N1, % (P TCDS p9; P5 FM 2-10): 105 continuous, 106 for 15 s; idle 59-65. */
export const BO105_N1_PCT = { continuous: 105, transient15s: 106, idle: [59, 65] } as const;
/** The 250-C20B engine rating, W (the MD 500E's EngineDef.ratedPower: same engine). P (EASA IM.E.052 p9) */
export const BO105_ENGINE_RATED_W = 313e3;

/** Warning unit K-DW02/01 (P TM 00-44; P5 FM 3-16): N1 split >= 12 % (light + intermittent tone); NR <= 95 % (light +
 *  650 Hz at 5 per second); NR >= 103 % (light); NR >= 108 % (light + steady 2600 Hz). */
export const BO105_WARNINGS = { n1SplitPct: 12, nrLowPct: 95, nrLowToneHz: 650, nrLowBeepsPerSecond: 5, nrHighPct: 103,
  nrHighTonePct: 108, nrHighToneHz: 2600 } as const;

/**
 * Overhead power levers OFF - IDLE - FLIGHT, one per engine, on ControlInputs.engines[i].throttle (P TM; P5 FM 4-9):
 * OFF below `cutoffBelow`, the IDLE stop at `groundIdle`, FLIGHT = 1. Fractions of lever travel: AGENT choice (no
 * rigging published). The input profile's twistGrip deep-equals this (consistency).
 */
export const BO105_POWER_LEVER = { cutoffBelow: 0.05, groundIdle: 0.25 } as const;

/** Electrical: 28 V DC, two 150 A starter-generators (P5 FM 7-25). */
export const BO105_NOMINAL_VOLTS = 28;
export const BO105_GENERATOR_AMPS = 150;
export const BO105_BUS_DEAD_VOLTS = 18;

/** Fuel (P TCDS p11; research-bo105 section 11): usable 456 kg = supply 74 + main 382; LOW FUEL at 60 kg in the supply
 *  tank. */
export const BO105_FUEL = { supplyKg: 74, mainKg: 382, lowFuelKg: 60 } as const;

/** Masses, kg (P TCDS p10; P5 FM 2-2): max 2500, min 1140; typical 2200 (AR-280 flight-test). */
export const BO105_MASS_KG = { max: 2500, min: 1140, typical: 2200 } as const;
/** CG limits, mm aft of the datum (P TCDS p11): fwd 3081 at 1140 kg, 3038 at 1900 kg, 3082 at 2500 kg; aft 3395 at <= 2000
 *  kg, 3270 at 2500 kg; lateral +/-100 mm to 2400 kg, +/-80 above. */
export const BO105_CG_MM = { forward: [[1140, 3081], [1900, 3038], [2500, 3082]], aft: [[2000, 3395], [2500, 3270]],
  lateral: [[2400, 100], [2500, 80]] } as const;
/** Inertia at 2200 kg, kg m^2 (P AR-280 Table 6.2.1): Ixx 1433, Iyy 4973, Izz 4099, Ixz 660. */
export const BO105_INERTIA = { Ixx: 1433, Iyy: 4973, Izz: 4099, Ixz: 660 } as const;
