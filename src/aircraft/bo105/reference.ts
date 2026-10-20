// MBB Bo 105 CB-4: the reference speeds and performance data sheet the definition, limits, training and tests read.
// Plain data. Final at the scaffold; owner afterwards: BO. Tags as facts.ts: P TCDS EASA.R.011 (page), P5 CB-5 FM used
// for the CB-4, F family data (CB-5 performance with the Type 2 blades: optimistic for a CB-4), S secondary, D derived,
// ESTIMATE. Plan revision 2, sections 6.1-6.2 hold the acceptance bands built on these.

export const BO105_REFERENCE = {
  /** Vne, KIAS: 145 at <= 2400 kg, 130 above (P TCDS p10); the FM Fig 2-2 placard grid lives in limits.ts. */
  vne: 145, vneHeavy: 130, vneWeightBreakKg: 2400,
  /** Vy, KIAS (P5 FM 5). */
  vy: 60,
  /** Autorotation, KIAS (P5 FM 3-34): recommended 75; minimum descent 60 at 100 % NR; maximum glide (range) 100 at 85 % NR. */
  autorotationKias: 75, minDescentKias: 60, maxGlideKias: 100,
  /** OEI maximum, KIAS (P5 FM). */
  oeiMaxKias: 100,
  /** Sideward / rearward flight limits, kt (P5 FM 2). */
  sidewardKt: 25, rearwardKt: 20,
  /** Hover turn rate limit, deg/s (P5 FM 2). */
  hoverTurnLimitDegS: 90,
  /** Maximum pressure altitude, ft (P TCDS p10, Jet A). */
  maxPressureAltitudeFt: 17_000,
  /** HOGE / HIGE ceiling at 2500 kg ISA take-off power, ft: CB-5 (F) 5,550 / 7,900; CB-4 ESTIMATE 3,850 / 6,200
   *  (about 1,700 ft lower: Jane's CBS-4 cross-check). HIGE 2300 kg ISA 8,900 ft (S Jane's). */
  hoge2500Ft: 3850, hige2500Ft: 6200, hige2300Ft: 8900,
  /** Climb AEO take-off power, 60 KIAS SL ISA, ft/min: 2200 kg 1,575 (S Jane's CB). */
  rocAeo2200Fpm: 1575,
  /** Max cruise, MCP, SL ISA 2500 kg, KTAS (S Jane's 131). */
  maxCruiseKtas: 131,
  /** Fuel flow 90 KCAS SL 2500 kg, kg/h (D from the CB-5 F 286 NM range example). */
  fuelFlow90KcasKgH: 143,
} as const;
