// Lockheed AH-56A Cheyenne: the reference speeds and performance data sheet the definition, limits, training and tests
// read. Plain data. Final at the scaffold; owner afterwards: AG. Tags as dimensions.ts; the acceptance bands built on
// these are plan revision 2, sections 7.2-7.4.

export const AH56_REFERENCE = {
  /** V_H, KTAS: 194 (TOW configuration, SL, transmission-limited, P ASTA-72 para 14); AMCS level 215-220 (P Hoh-74 / S). */
  vh: 194, vhAmcs: [215, 220],
  /** Vne, KCAS: ESTIMATE 195 (INF: push-overs began at <= 165 "to preclude exceeding V_NE"). Dive 245 kt (S). */
  vne: 195, diveKt: 245,
  /** Autorotation, KCAS (P): 85-95; 2,200 ft/min at 95 KCAS, 19,700 lb, 2,700 ft DA, prop +8 deg (P para 69). */
  autorotationKcas: [85, 95], autorotationFpm: 2200,
  /** Gear limit, KCAS (P). */
  gearKcas: 130,
  /** Hover OGE ceiling, ft (P ASTA-72 paras 11-12): 8,500 at 18,750 lb std (prop at the -2.2 deg detent); 6,000 OGE /
   *  9,300 IGE (10 ft wheels) at 20,500 lb. */
  hogeFt18750: 8500, hoge20500Ft: 6000, hige20500Ft: 9300,
  /** Acceleration 0 -> 188 KTAS in 107 s; deceleration 196 -> 0 in 33 s (P ASTA-72 Table 3). */
  accel: { toKtas: 188, seconds: 107 }, decel: { fromKtas: 196, seconds: 33 },
} as const;
