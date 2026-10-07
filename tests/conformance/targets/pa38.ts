// Piper PA-38-112 Tomahawk II (1670 lb): the targets of contract section 5.2, each with its source in the type's data
// sheet (aircraft-data/pa38.md in the design work folder, which quotes the POH, Piper report VB-2126). Bands are the
// contract's default ones (5 intro) unless 5.2 states its own. Sweeps and entries are KTAS, the stall speeds KCAS.
// The POH charts are for the Tomahawk I's 5.00-5 wheels: the II climbs about 15 ft/min less and cruises 2-3 kt
// slower (POH 5.3), which contract 5.2 has already taken off.

import { FT } from '../../../src/core/math';
import type { PilotTargets } from '../../input/keyboardPilot';
import { above, band, below, pct, range, type ConformanceTargets } from '../targets';

/** POH fig 5-33: 7.6-7.9 : 1 from the chart's slope (7.8 picked, s.8); contract 5.2: 8 : 1, 7.0-8.6 (weak). */
const GLIDE = 7.8;

export const PA38_TARGETS: ConformanceTargets = {
  aircraft: 'pa38',
  stall: {
    // POH 4.35 with fig 5-1a, both pairs of flow strips, power off: 54 KCAS clean (52 KIAS), 52 KCAS flaps 34
    // (49 KIAS). Electric horn 5-10 kt before the stall (POH 4.35, s.9).
    clean: { flapDeg: 0, entryKt: 66, vs1gKcas: band(54, 3, 'POH 4.35, fig 5-1a (s.8), contract 5.2'), warningMarginKt: range(5, 10, 'POH 4.35: horn 5-10 kt above the stall (s.9)') },
    landing: { flapDeg: 34, entryKt: 64, vs1gKcas: band(52, 3, 'POH 4.35, fig 5-1a (s.8), contract 5.2'), warningMarginKt: range(5, 10, 'POH 4.35: horn 5-10 kt above the stall (s.9)') },
  },
  // 1.3 x 52 KIAS (Vs1); contract 3.1.
  stallRecovery: { entryKias: 68, recoveryS: below(4, 'contract 3.1 stall recovery') },
  climb: {
    range: { fromKt: 60, toKt: 90 },
    rocFpm: pct(705, 10, 'POH fig 5-13 less 15 ft/min for the II (s.8), contract 5.2'),
    vyKias: band(70, 7, 'POH 4.3 (s.8), contract 5.2 (+/-7 kt)'),
  },
  // 106-109 kt (s.8): 109 at the 2600 rpm limit for the Tomahawk I, the II 2-3 kt slower.
  maxLevel: { bracketKt: [90, 130], ktas: pct(107, 4, 's.8 (106-109), contract 5.2') },
  cruise: {
    // The 75 % best-power line meets full throttle at 7100-7500 ft (POH fig 5-19, s.8): 108 KTAS there for the I.
    altitudeFt: 7000,
    powerFraction: 0.75,
    bracketKt: [85, 125],
    leanAtKt: 100,
    resetKt: 105,
    ktas: pct(105.5, 5, 'POH fig 5-19 less 2.5 kt (s.8), contract 5.2'),
    powerFractionReached: band(0.75, 0.005, 'the measurement holds 75 %'),
    // POH fig 5-17: 75 % at 2400 rpm at sea level, 2565 at 8700 ft (+20 rpm per 1000 ft, s.4, s.11).
    rpm: range(2460, 2620, 'POH fig 5-17: about 2540 rpm for 75 % at 7000 ft (s.4)'),
  },
  staticRun: { rpm: range(2200, 2350, 'POH 2.7, TCDS A18SO (s.5), contract 5.2'), groundSpeed: below(0.05, 'parking brake holds') },
  // Normal take-off, flaps up, full power before the brakes are released (the chart's technique), rotate 53 KIAS
  // (POH 4.5, fig 5-5).
  takeoff: { flapDeg: 0, rotateKias: 53, pitchDeg: 8, staticRunUp: true, groundRollM: pct(250, 12, 'POH fig 5-5 (s.8), contract 5.2') },
  // Flaps 34, power off, 67 KIAS approach, "maximum braking" (POH fig 5-36). Full brakes stop the aircraft in about
  // 140 m (0.31 g, no skid); the Piper chart is flown at about 0.22 g, i.e. 0.55 of the pedal (DECISIONS-D2,
  // D-D-pa38-phys-01: the chart is conservative, the brakes are not weakened).
  landing: { flapDeg: 34, approachKt: 67, touchdownPitchDeg: 7, brake: 0.55, groundRollM: pct(215, 15, 'POH fig 5-36 (s.8), contract 5.2') },
  glide: {
    range: { fromKt: 58, toKt: 90 },
    propeller: 'windmilling',
    ratio: band(GLIDE, 0.8, 'POH fig 5-33 (s.8), contract 5.2: 7.0-8.6 (weak: 6.6-8.1)'),
    bestKias: pct(70, 15, 'POH 3.3 (s.8); a flat optimum (contract 5 intro)'),
    at: { kias: 70, ratio: band(GLIDE, 0.8, 'POH fig 5-33 at 70 KIAS (s.8), contract 5.2: 7.0-8.6 (weak)') },
    windmillingRpm: above(300, 'the propeller windmills'),
  },
  trim: {
    // The envelope (flaps as lever positions): approach with full flap, the first notch slow, the Vy climb, the
    // circuit, the cruise at altitude, a cruise descent and the dead-engine glide.
    cases: [
      { kt: 64, flaps: 1, fpaDeg: -3 },
      { kt: 68, flaps: 21 / 34 },
      { kt: 70, fpaDeg: 4 },
      { kt: 80 },
      { kt: 95, ftAboveField: 6000 },
      { kt: 100, ftMsl: 7000 },
      { kt: 95, fpaDeg: -4 },
      { kt: 70, engineRunning: false },
    ],
    maxResidual: 1e-5,
    maxRateDegS: 0.2,
    wheel: { kt: 95, maxWheel: 1, maxBall: 0.05 },
    impossibleClimb: { kt: 70, fpaDeg: 15, maxFpaDeg: 8 },
  },
  handsOff: {
    kt: 95,
    ftAboveField: 3000,
    seconds: 60,
    altDriftM: below(15, 'contract 3.10 generic block (the C172S bands)'),
    headingDriftDeg: below(3, 'contract 3.10 generic block'),
    maxVsFpm: below(50, 'contract 3.10 generic block'),
    tasChangeMps: below(0.5, 'contract 3.10 generic block'),
  },
  ground: {
    restHeightM: band(1.05, 0.03, 'geometry.restHeight; contract 5 intro (3 cm)'),
    idleRpm: range(550, 700, 'POH 4.19: 550-650 rpm (s.4), contract 5.2'),
    parkedDriftMm: below(5, 'contract 3.10 generic block'),
    parkedRateDegS: below(0.05, 'contract 3.10 generic block'),
    taxi: {
      meanSteer: range(-0.3, 0.3, 'contract 3.10 generic block'),
      maxHeadingErrorDeg: below(2, 'contract 3.10 generic block'),
      speedKt: band(10, 1, 'the taxi measurement holds 10 kt'),
      // 30 degrees of nosewheel at full pedal on a 1.448 m wheelbase: about 2.5 m about the reference point (POH fig
      // 1-1: 7.92 m from the pivot to the wingtip).
      radiusM: range(1.8, 4, 'direct steering +/-30 deg (POH 7.7, s.3)'),
      maxYawAccelDegS2: below(5, 'contract 3.10 generic block'),
    },
  },
  yaw: {
    ftAboveField: 3000,
    resetKt: 70,
    climbKias: 70,
    // Left-turning tendencies of a clockwise propeller; right rudder in the climb (s.4, s.11).
    climb: range(0.08, 0.3, 'right rudder in the full-power climb (s.11)'),
    steep: { kias: 61, rudder: above(0.08, 'right rudder at Vx') },
    cruise: { kias: 95, rudder: range(0, 0.1, 'a little right pedal below the rig point') },
    rigPoint: { bracketKt: [95, 125], resetKt: 105, rudder: range(-0.02, 0.02, 'rudder tab rig point (systems.ts)') },
  },
  systems: {
    // POH 4.19: at 1800 rpm, drop not over 175 rpm, not over 50 difference; contract 5.2 band 40-175.
    magnetoDrop: { rpm: 1800, drop: range(40, 175, 'POH 4.19 (s.4), contract 5.2'), difference: range(0, 50, 'POH 4.19 (s.4)') },
    // Not published; s.4 ESTIMATE 50-100 rpm at 1800-2000 rpm (weak); full throttle as the C152's same engine.
    carbHeat: { runUpRpm: 1800, fullThrottle: range(110, 240, 'the C152 engine (contract 5.1); not in the PA-38 POH'), runUp: range(30, 130, 's.4 ESTIMATE 50-100 rpm (weak)') },
  },
};

/** Fuel flow at 75 % best power at 7000 ft (POH fig 5-19: 6.5 US gal/h), +/-10 % (contract 5.2). */
export const PA38_CRUISE_FUEL_GPH = pct(6.5, 10, 'POH fig 5-19 (s.4, s.8), contract 5.2');
/** Cruise altitude of the fuel-flow check, m. */
export const PA38_CRUISE_ALT = 7000 * FT;
/** Rest attitude and propeller clearance on 6.00-6 tyres (s.2.9: level stance; s.2.6: about 0.22 m, ESTIMATE). */
export const PA38_REST = {
  pitchDeg: range(-1, 1, 'POH fig 1-1, MM water lines: the thrust line level at rest (s.2.9)'),
  propClearanceM: band(0.22, 0.03, 'POH fig 1-1 + 6.00-6 tyres (s.2.6, s.2.9)'),
};
/** Fuel pressure with either pump alone (POH 2.9: green arc 0.5-8 psi; contract 5.2). */
export const PA38_FUEL_PRESSURE = range(0.5, 8, 'POH 2.9 (s.4), contract 5.2');
/** Nosewheel-lift speed at full power, full aft yoke, forward loading (AOPA note, s.11; contract 5.2). */
export const PA38_NOSE_LIFT_KIAS = range(28, 45, 'AOPA: little elevator authority until about 35 KIAS (s.11), contract 5.2');
/**
 * Elevator change from idle to full power at 70 KIAS, as a fraction of the C172S's (s.11: the tail is above the
 * slipstream, so the power trim change is small; contract 5.2).
 */
export const PA38_POWER_TRIM_RATIO = range(0, 0.5, 'AOPA: small trim change with power (s.11), contract 5.2');
/** Aileron to hold the wings level after 1 h on one tank (contract 5.2: measurable, under 15 % of travel). */
export const PA38_ONE_TANK_AILERON = range(0.005, 0.15, 'contract 5.2 model check: no BOTH position (s.11)');
/**
 * Take-off trim (the full-power climb at Vy that a runway start sets) on the spring trim's wheel, +1 = full nose-up:
 * "set, slightly aft of neutral" (POH 4.5, s.10), the before-take-off check's band (training.ts: -0.2 to 0.5).
 */
export const PA38_TAKEOFF_TRIM = range(0, 0.5, 'POH 4.5: slightly aft of neutral (s.10); the checklist band');
/**
 * The A-key hold (heading and altitude, yaw damper on) for 60 s at 80 KIAS: the rudder steady, not limit-cycling
 * (review D-pa38-phys F1: the 172's yaw-damper gains drove the big rudder stop to stop), and the speed held.
 */
export const PA38_HOLD = {
  meanRudder: range(0, 0.15, 'yaw damper steady (the C172S 0.13)'),
  maxSideslipDeg: range(0, 1, 'ball near the centre'),
  speedLossKt: range(-2, 2, 'speed held at a fixed throttle'),
};
/**
 * The keyboard pilot's tachometer settings and attitudes (keyboardTargets.ts: the keyboardCircuit block and
 * fly-keyboard.mjs), data sheet s.10-s.11 with the trims of this model in brackets: downwind 2000-2100 rpm at 80-85
 * KIAS (2075 level at 80), abeam the threshold 1500-1700 rpm with the first notch (1700 for a 3 degree path at 70),
 * final with full flap at 67 KIAS (1740 holds a 3 degree path; the pilot sets 1550, the low end of the school's
 * 1500-1700, and makes up the path with powerPerMetre: with more the low wing floats longer in ground effect and
 * the crosswind circuit drifts further off the centre line in the flare). The
 * Tomahawk flies level at about 2.5 degrees at 80 KIAS (the 172S 5), climbs at Vy about 9 degrees nose-up, comes
 * down final about 1.5 degrees nose-down and is landed on its mains about 8 degrees nose-up (it sits level on its
 * wheels).
 */
export const KEYBOARD_PILOT_TARGETS: Partial<PilotTargets> = {
  powerDownwind: 2100,
  powerPattern: 1900,
  powerBase: 1650,
  powerFinal: 1550,
  powerMax: 2300,
  climbPitchDeg: 8,
  levelPitchDeg: 2.5,
  finalPitchDeg: -1.5,
  landingPitchDeg: 10,
  // "Closed throttle in the flare" (s.10): the T-tail is out of the slipstream, so the power comes off early in the
  // round-out without the 172S's nose-down pitch, and the float (and the crosswind drift in it) is shorter
  // (D-D-pa38-phys-02: 6.2 m off the centre line with the 172S's 3 m, 3.4 m with 6 m).
  throttleOffM: 6,
};
