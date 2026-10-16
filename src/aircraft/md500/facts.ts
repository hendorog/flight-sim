// MD 500E (369E) with the Rolls-Royce (Allison) 250-C20B: the facts the definition, the panel, the sound and the
// consistency check must agree on. Plain data; owner after the scaffold: T2 (others request changes in PR text).
// Tags: P = primary (RFM CSP-E-1 Rev 16, FAA TCDS H3WE Rev 21, EASA TCDS IM.E.052 Issue 02), D = derived (arithmetic
// shown), M = MD marketing, ESTIMATE = no source.

const LBF_FT = 1.3558179483314004; // N m per lbf ft

/** Engine output shaft (N2) at 100 %, rpm (EASA IM.E.052 p15). P */
export const MD500_N2_100_RPM = 6016;
/** Gas producer (N1) at 100 %, rpm (EASA IM.E.052 p15). P */
export const MD500_N1_100_RPM = 50_970;
/** Rotor at 100 % N2, rpm: 492 / 1.03 (RFM 2-4: 102-103 % = 487-492 rpm). D */
export const MD500_NR_100 = 492 / 1.03;
/** Normal governed rotor speed, rpm (103 %). P */
export const MD500_NR_NOMINAL = 492;
/** N2 rpm / Nr rpm: 6016 / 477.67 = 12.594 (TCDS p12: 6196 rpm N2 at 492 Nr). D */
export const MD500_ENGINE_RATIO = MD500_N2_100_RPM / MD500_NR_100;
/** Tail-rotor rpm / Nr: 2933 / 492 = 5.96. ESTIMATE (secondary source; the OH-6A ratio is 6.447). */
export const MD500_TAIL_RATIO = 2933 / 492;

/**
 * The 250-C20B engine rating, 313 kW (420 shp) take-off and maximum continuous (EASA IM.E.052 p9). P. This is
 * EngineDef.ratedPower AND AudioProfile ratedPowerW (one value; consistency compares them). The installed
 * airframe ratings below are pilot limits only.
 */
export const MD500_ENGINE_RATED_W = 313e3;
/** Installed ratings: 375 shp take-off (5 min), 350 shp MCP (TCDS p12; RFM 1-9). P */
export const MD500_INSTALLED_W = { takeoff: 375 * 745.6999, mcp: 350 * 745.6999 } as const;

/**
 * psi per OUTPUT-SHAFT N m. EngineState.torque on the 250 (EngineDef.gearRatio 1) IS the output-shaft torque, so the
 * gauge reads EngineState.torque x MD500_PSI_PER_NM. TCDS p12: 318 ft lb = 87.2 psi (3.647 ft lb per psi). D
 */
export const MD500_PSI_PER_NM = 87.2 / (318 * LBF_FT);
export const md500TorquePsi = (outputTorqueNm: number): number => outputTorqueNm * MD500_PSI_PER_NM;

/** Torque limits, psi (RFM 2-5): MCP 81.3 (74.3 with TOT above 738 C); take-off 87.2 for 5 min; transient 93.0 (15 s), 97.6 (3 s). P */
export const MD500_TORQUE_PSI = { mcp: 81.3, mcpHot: 74.3, mcpHotAboveTotC: 738, takeoff: 87.2, takeoffSeconds: 300, transient15s: 93.0, transient3s: 97.6 } as const;
/** TOT limits, C (RFM 2-5): MCP 755 (738 above 74.3 psi), take-off 810, transient 843 for 6 s, start 927 for 1 s, residual at light-off 150. P */
export const MD500_TOT_C = { mcp: 755, mcpHighTorque: 738, takeoff: 810, transient6s: 843, start1s: 927, lightOffResidual: 150 } as const;
/** N1 limits, % (RFM 2-5, 4-16): 105 continuous, 106 for 15 s; ground idle 64-65. P */
export const MD500_N1_PCT = { continuous: 105, transient15s: 106, groundIdle: [64, 65] } as const;
/** N2: beep range at least 104-105 % high and at most 98 % low (RFM 4-18); avoid 75-88 % steady (RFM 2-5). P */
export const MD500_N2_PCT = { beepLowMax: 98, beepHighMin: 104, setTakeoff: 103, avoid: [75, 88] } as const;
/** ENGINE OUT warning (light + horn): N1 below 55 % or Nr below 468 rpm (RFM 3-3). P */
export const MD500_ENGINE_OUT = { n1Below: 0.55, nrBelowRpm: 468 } as const;
/** Rotor limits, rpm (RFM 2-4): power on 487-492 (102-103 %); power off 410-523. P */
export const MD500_NR_LIMITS = { powerOn: [487, 492], powerOff: [410, 523] } as const;

/** Electrical (RFM 1-11, 2-9; EASA IM.E.052 p10): 28 V DC, 24 V battery, 150 A starter-generator on N1 (pad ratio 0.2361). P */
export const MD500_NOMINAL_VOLTS = 28;
export const MD500_GENERATOR_AMPS = 150;
export const MD500_GENERATOR_PAD_RATIO = 0.2361;
/** Bus voltage below which bus-powered instruments, lamps and the horn are dead, V. ESTIMATE (the S269's 18 V). */
export const MD500_BUS_DEAD_VOLTS = 18;

/** Fuel (RFM 1-13): 64.0 US gal total, 62.1 usable = 421.9 lb Jet A; FUEL LOW at about 35 lb (RFM 3-23). P */
export const MD500_FUEL = { usableLb: 421.9, unusableLb: 13.1, lowLb: 35 } as const;
