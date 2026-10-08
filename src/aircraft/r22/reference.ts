// Presentation reference values: Robinson R22 POH, Beta II / O-360-J2A.
// https://www.robinsonheli.com/publications (accessed 8 October 2026)
// Section 1 p1-6: https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_poh_1_f2700c9508.pdf
// Section 2 pp2-8..2-11: https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_poh_2_a730a7b2f8.pdf
// Section 3 pp3-3, 3-9: https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_poh_3_4bcbbbfc58.pdf
// Section 4 pp4-6..4-8: https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_poh_4_98ca296aca.pdf
// Section 7 pp7-18..7-24: https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_poh_7_6581e57af0.pdf
export const R22_INSTRUMENT_REFERENCE = {
  engineRpm100: 2550, rotorRpm100: 510,
  vne: 102, asiGreenMin: 50,
  mainUsableGal: 16.9, auxUsableGal: 9.4, kgPerGal: 2.72155,
  mapYellowMin: 19.6, mapMax: 24.1,
} as const;

/** POH 2-11. MCP, inHg, at pressure altitude / OAT; null = FULL THROTTLE in the placard. */
export const R22_MAP_PLACARD = {
  oatC: [-20, -10, 0, 10, 20, 30, 40],
  altitudeFt: [0, 2000, 4000, 6000, 8000],
  values: [
    [21.5, 21.8, 22.1, 22.3, 22.6, 22.9, 23.2],
    [21.1, 21.4, 21.6, 21.9, 22.2, 22.5, 22.8],
    [20.7, 21.0, 21.2, 21.5, 21.8, 22.0, 22.3],
    [20.3, 20.6, 20.8, 21.1, 21.3, 21.6, 21.9],
    [19.9, 20.2, 20.4, 20.7, 20.9, null, null],
  ],
  takeoffIncrementInHg: 0.9,
} as const;
