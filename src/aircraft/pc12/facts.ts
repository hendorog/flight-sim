// Pilatus PC-12/47: the facts the definition, the panel, the sound, the conformance targets and the consistency
// check must agree on. Plain data; owner after the scaffold: P1 (others request changes in their PR text).
// Tags (research-pc12.md, docs/pc12-sources.md): TCDS = EASA TCDS A.089 Issue 11 sect. C; ETCDS = EASA TCDS IM.E.008
// Issue 06 (PT6A-67); 47E-PROXY = PC-12/47E POH Report 02277 Rev 20 (other engine; same airframe family);
// DERIVED = arithmetic shown; ESTIMATE = no source.

const LBF_FT = 1.3558179483314004; // N m per lbf ft

/** PT6A-67B take-off and maximum-continuous engine rating, 1200 shp = 895 kW (ETCDS II.5). */
export const PT6A_67B_RATED_W = 895e3;
/** Installed maximum continuous / climb / cruise power on the /47: 1000 shp (TCDS C.III.4.3). */
export const PC12_MCP_W = 1000 * 745.6999;
/** Governed propeller speed, rpm (TCDS C.III.4.3; POH 2-6). */
export const PC12_NP_GOVERNED = 1700;
/** Power-turbine rpm / propeller rpm: 29 894 / 1700 (POH 2-6 note 8, ETCDS IV.2). DERIVED. */
export const PC12_GEAR_RATIO = 29_894 / 1700;
/** Gas generator at Ng 100 %, rpm (TCDS note; ETCDS IV.2). */
export const PC12_NG_100_RPM = 37_468;
/** Overspeed governor 1802 rpm (106 %), fuel topping (Nf) governor 1853 rpm (109 %), transient limit 1870 rpm for 20 s (TCDS; 47E 7-11). */
export const PC12_NP_OVERSPEED_GOVERNOR = 1802;
export const PC12_NP_TOPPING = 1853;
export const PC12_NP_TRANSIENT = 1870;
/** Torque limits, psi (TCDS C.III.4.3): take-off 44.34 (3708 lbf ft), MCP 36.95 (3090 lbf ft), transient 61.00 for 20 s. */
export const PC12_TORQUE_PSI = { takeoff: 44.34, mcp: 36.95, transient: 61.0 } as const;
/** ITT limits, C (TCDS): take-off 800, MCP 760, transient 870 (20 s), start 1000 (5 s); minimum-idle ITT 750 (47E-PROXY 2-6). */
export const PC12_ITT_C = { takeoff: 800, mcp: 760, transient: 870, start: 1000, idle: 750 } as const;
/** Ng limit, fraction (104 %, TCDS). */
export const PC12_NG_MAX = 1.04;

/**
 * psi per PROPELLER-SHAFT N m. DERIVED from TCDS 44.34 psi = 3708 lbf ft: 83.63 lbf ft per psi.
 * EngineState.torque (and InstrumentReadings.torqueNm) is POWER-TURBINE torque: the gauge reads
 *   psi = EngineState.torque x PC12_GEAR_RATIO x PC12_PSI_PER_NM = pc12TorquePsi(EngineState.torque).
 * Use pc12TorquePsi everywhere (panel, keyboard pilot, telemetry, conformance, stick-pusher torque input).
 */
export const PC12_PSI_PER_NM = 1 / ((3708 / 44.34) * LBF_FT);
/** Torque gauge reading, psi, from POWER-TURBINE torque, N m (EngineState.torque). */
export const pc12TorquePsi = (ptTorqueNm: number): number => ptTorqueNm * PC12_GEAR_RATIO * PC12_PSI_PER_NM;

/** Electrical: 28 V DC (FAA N 8900.428). GEN 1 300 A (starter-generator, ESTIMATE: unconfirmed on the /47), GEN 2 115 A. */
export const PC12_NOMINAL_VOLTS = 28;
export const PC12_GEN_AMPS = [300, 115] as const;
/** Bus voltage below which bus-powered instruments and sounds are dead, V. ESTIMATE (the C208's practice). */
export const PC12_BUS_DEAD_VOLTS = 18;
/** Legacy CAWS thresholds, V (SECONDARY flashcards): GEN OFF below 20, ESNTL / N ESSNTL BUS below 22. */
export const PC12_CAWS_VOLTS = { genOff: 20, bus: 22 } as const;

/** Flap detents, deg (47E-PROXY 7-3): Fowler, electric. */
export const PC12_FLAP_DETENTS_DEG = [0, 15, 30, 40] as const;

/** Ground idle: Ng 50.7-61.4 % (minimum 50.7), Np about 1060 rpm (at least 950); flight idle Ng at least 64 % (47E-PROXY 2-6, 7-11). */
export const PC12_IDLE = { groundNg: [0.507, 0.614], groundNp: 1060, groundNpMin: 950, flightNgMin: 0.64 } as const;
/** Start: condition lever to GROUND IDLE at 13 % Ng; starter cuts out at 50 % Ng or 80 s (47E-PROXY 4.5, 7-10). */
export const PC12_START = { conditionAtNg: 0.13, starterCutoutNg: 0.5, starterCutoutSeconds: 80 } as const;
/** Stabilised ground operation (unfeathered) between 350 and 950 propeller rpm is prohibited (TCDS C.III.6.7). */
export const PC12_NP_PROHIBITED = [350, 950] as const;

/**
 * Torque limiter (47E-PROXY 7-10 p. 689; ESTIMATE for the /47): about 44.3 psi at sea level, -2.7 psi per 10 000 ft
 * up to 12 000 ft, then -4.5 psi per 10 000 ft; a further -2.9 psi between 102 and 104 % Ng.
 */
export const PC12_TORQUE_LIMITER = {
  psi: 44.3,
  lapse: { altFt: [0, 12_000, 30_000], psi: [44.3, 44.3 - 2.7 * 1.2, 44.3 - 2.7 * 1.2 - 4.5 * 1.8] },
  ngTaper: [1.02, 1.04] as const,
  taperPsi: 2.9,
} as const;

/** Aural overspeed warning: Vmo 236 KIAS (placard; 240 KCAS TCDS) / Mmo 0.48. */
export const PC12_OVERSPEED = { kias: 236, mach: 0.48 } as const;
