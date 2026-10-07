// Cessna 172S: the bands of today's flight-model tests (tests/fdm), so the suite proves itself on the type the
// model was built for. Each source names the test the band is copied from; the POH figures are core/c172.ts poh.

import { C172 } from '../../../src/core/c172';
import { FT } from '../../../src/core/math';
import { above, band, below, pct, range, type ConformanceTargets } from '../targets';

const POH = C172.poh;
/** The POH glide, 1.5 NM per 1000 ft of height (9.11 : 1). */
const POH_GLIDE = (1.5 * 1852) / (1000 * FT);

export const C172S_TARGETS: ConformanceTargets = {
  aircraft: 'c172s',
  stall: {
    clean: { flapDeg: 0, entryKt: 70, vs1gKcas: pct(POH.stallCleanKcas, 4, 'POH; stall.test.ts clean'), warningMarginKt: range(5, 10, 'stall.test.ts') },
    landing: { flapDeg: 30, entryKt: 62, vs1gKcas: pct(POH.stallFullFlapKcas, 5, 'POH; stall.test.ts full flap'), warningMarginKt: range(5, 10, 'stall.test.ts') },
  },
  // 1.3 x 48 KIAS (Vs1); contract 3.1.
  stallRecovery: { entryKias: 62.4, recoveryS: below(4, 'contract 3.1 stall recovery') },
  climb: {
    range: { fromKt: 60, toKt: 90 },
    rocFpm: pct(POH.climbRateSeaLevelFpm, 5, 'POH; performance.test.ts'),
    // A flat optimum: measured +6.4 % (performance.test.ts).
    vyKias: pct(POH.vyKias, 10, 'POH; performance.test.ts'),
    table: {
      range: { fromKt: 60, toKt: 95 },
      leanAtKt: 80,
      rows: [
        { ft: 4000, fpm: pct(597, 4, 'POH fig. 5-6 at ISA; performance.test.ts') },
        { ft: 8000, fpm: pct(408, 4, 'POH fig. 5-6 at ISA; performance.test.ts') },
        { ft: 12000, fpm: pct(221, 4, 'POH fig. 5-6 at ISA; performance.test.ts') },
      ],
    },
  },
  maxLevel: { bracketKt: [100, 140], ktas: pct(POH.maxSpeedSeaLevelKtas, 5, 'POH; performance.test.ts'), rpm: range(2650, 2720, 'red line; performance.test.ts') },
  cruise: {
    altitudeFt: 8000,
    powerFraction: 0.75,
    bracketKt: [100, 140],
    leanAtKt: 115,
    resetKt: 120,
    // Measured -2.8 % (performance.test.ts explains why the model sides with the sea-level figure).
    ktas: pct(POH.cruise75pct8000ftKtas, 7, 'POH; performance.test.ts'),
    powerFractionReached: band(0.75, 0.005, 'performance.test.ts toBeCloseTo(0.75, 2)'),
  },
  staticRun: { rpm: range(POH.staticRpm[0], POH.staticRpm[1], 'POH; performance.test.ts'), groundSpeed: below(0.05, 'parking brake holds; performance.test.ts') },
  takeoff: { flapDeg: 10, rotateKias: 48, pitchDeg: 8, staticRunUp: true, groundRollM: pct(POH.takeoffGroundRollM, 10, 'POH short field; ground.test.ts') },
  landing: { flapDeg: 30, approachKt: 61, touchdownPitchDeg: 7, groundRollM: pct(POH.landingGroundRollM, 10, 'POH; ground.test.ts') },
  glide: {
    range: { fromKt: 60, toKt: 82 },
    propeller: 'windmilling',
    // Measured +6.9 % (performance.test.ts: the POH figure is rounded and conservative).
    ratio: pct(POH_GLIDE, 8, 'POH 1.5 NM / 1000 ft; performance.test.ts'),
    bestKias: pct(POH.bestGlideKias, 15, 'POH; performance.test.ts (flat optimum)'),
    at: { kias: POH.bestGlideKias, ratio: pct(POH_GLIDE, 8, 'POH; performance.test.ts') },
    windmillingRpm: above(300, 'performance.test.ts'),
  },
  trim: {
    // trim.test.ts "converges across the envelope" (flaps as lever positions, the test's literals).
    cases: [
      { kt: 60, flaps: 1, fpaDeg: -3 },
      { kt: 65, flaps: 0.33 },
      { kt: 74, fpaDeg: 5 },
      { kt: 90 },
      { kt: 110, ftAboveField: 6000 },
      { kt: 125, ftMsl: 8000 },
      { kt: 100, fpaDeg: -5 },
      { kt: 68, engineRunning: false },
    ],
    maxResidual: 1e-5,
    maxRateDegS: 0.2,
    wheel: { kt: 100, maxWheel: 1, maxBall: 0.05 },
    impossibleClimb: { kt: 74, fpaDeg: 15, maxFpaDeg: 10 },
  },
  handsOff: {
    kt: 110,
    ftAboveField: 3000,
    seconds: 60,
    altDriftM: below(15, 'trim.test.ts'),
    headingDriftDeg: below(3, 'trim.test.ts'),
    maxVsFpm: below(50, 'trim.test.ts'),
    tasChangeMps: below(0.5, 'trim.test.ts'),
  },
  ground: {
    restHeightM: band(1.25, 0.03, 'geometry.restHeight; trim.test.ts 1.1-1.3'),
    idleRpm: range(600, 800, 'trim.test.ts'),
    parkedDriftMm: below(5, 'ground.test.ts'),
    parkedRateDegS: below(0.05, 'ground.test.ts'),
    taxi: {
      meanSteer: range(-0.3, 0.3, 'ground.test.ts'),
      maxHeadingErrorDeg: below(2, 'ground.test.ts'),
      speedKt: band(10, 1, 'ground.test.ts'),
      radiusM: range(6, 20, 'ground.test.ts (10 deg nosewheel)'),
      maxYawAccelDegS2: below(5, 'ground.test.ts'),
    },
  },
  yaw: {
    ftAboveField: 3000,
    resetKt: 75,
    climbKias: 74,
    climb: range(0.2, 0.35, 'owner: a quarter to a third of right pedal; handling.test.ts'),
    steep: { kias: 62, rudder: above(0.15, 'handling.test.ts') },
    cruise: { kias: 100, rudder: range(0.05, 0.1, 'handling.test.ts') },
    rigPoint: { bracketKt: [110, 135], resetKt: 120, rudder: range(-0.02, 0.02, 'rudder tab rig point; handling.test.ts') },
  },
};
