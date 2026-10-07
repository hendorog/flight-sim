// Cessna 152 (1978, 1670 lb): the targets of contract section 5.1, each with its source in the type's data sheet
// (aircraft-data/c152.md in the design work folder, which quotes the 1978 POH). Bands are the contract's
// default ones (5 intro) unless 5.1 states its own. Sweeps and entries are KTAS, the stall speeds KCAS.

import { FT } from '../../../src/core/math';
import type { PilotTargets } from '../../input/keyboardPilot';
import { above, band, below, pct, range, type ConformanceTargets } from '../targets';

/** POH Fig 3-1 / s.8: 9.5 : 1 (the chart reads 9.7, the usual figure 9.1); weak datum. */
const GLIDE = 9.5;

export const C152_TARGETS: ConformanceTargets = {
  aircraft: 'c152',
  stall: {
    // POH Fig 5-3, forward CG, power off: 48 KCAS clean, 43 KCAS flaps 30. Pneumatic horn 5-10 kt early (s.9).
    clean: { flapDeg: 0, entryKt: 62, vs1gKcas: band(48, 3, 'POH fig 5-3 (s.8), contract 5.1'), warningMarginKt: range(5, 10, 'POH sect. 7: horn 5-10 kt before the stall (s.9)') },
    landing: { flapDeg: 30, entryKt: 56, vs1gKcas: band(43, 3, 'POH fig 5-3 (s.8), contract 5.1'), warningMarginKt: range(5, 10, 'POH sect. 7: horn 5-10 kt before the stall (s.9)') },
  },
  // 1.3 x 40 KIAS (Vs1); contract 3.1.
  stallRecovery: { entryKias: 52, recoveryS: below(4, 'contract 3.1 stall recovery') },
  climb: {
    range: { fromKt: 55, toKt: 85 },
    rocFpm: pct(715, 10, 'POH fig 5-5 (s.8), contract 5.1'),
    vyKias: band(67, 7, 'POH fig 5-5 (s.8), contract 5.1 (+/-7 kt)'),
    table: {
      range: { fromKt: 55, toKt: 85 },
      // Mixture leaned for maximum rpm above 3000 ft (POH sect. 4).
      leanAtKt: 70,
      rows: [{ ft: 5000, fpm: pct(505, 12, 'POH fig 5-6 (s.8), contract 5.1') }],
    },
  },
  maxLevel: { bracketKt: [90, 130], ktas: pct(110, 4, 'brochure (s.8), contract 5.1') },
  cruise: {
    altitudeFt: 8000,
    powerFraction: 0.75,
    bracketKt: [85, 125],
    leanAtKt: 100,
    resetKt: 105,
    // 107 KTAS with the speed fairings, 105 without (POH fig 5-7); the definition has none.
    ktas: pct(105, 5, 'POH fig 5-7 without fairings (s.8), contract 5.1'),
    powerFractionReached: band(0.75, 0.005, 'the measurement holds 75 %'),
    rpm: range(2450, 2650, 'POH fig 5-7: 2550 rpm at 75 % at 8000 ft (s.8)'),
  },
  staticRun: { rpm: range(2280, 2380, 'POH sect. 2, TCDS 3A19 (s.4), contract 5.1'), groundSpeed: below(0.05, 'parking brake holds') },
  // Short-field technique: flaps 10, brakes held to full power, lift off at 50 KIAS (POH fig 5-4).
  takeoff: { flapDeg: 10, rotateKias: 50, pitchDeg: 8, staticRunUp: true, groundRollM: pct(221, 12, 'POH fig 5-4 (s.8), contract 5.1') },
  // Flaps 30, power off, 54 KIAS at 50 ft, maximum braking (POH fig 5-10).
  landing: { flapDeg: 30, approachKt: 55, touchdownPitchDeg: 7, groundRollM: pct(145, 15, 'POH fig 5-10 (s.8), contract 5.1') },
  glide: {
    range: { fromKt: 50, toKt: 80 },
    propeller: 'windmilling',
    ratio: band(GLIDE, 0.9, 'POH fig 3-1 (s.8), contract 5.1: 8.6-10.4 (weak)'),
    bestKias: pct(60, 15, 'POH fig 3-1 (s.8); a flat optimum (contract 5 intro)'),
    at: { kias: 60, ratio: band(GLIDE, 0.9, 'POH fig 3-1 at 60 KIAS (s.8), contract 5.1 (weak)') },
    windmillingRpm: above(300, 'the propeller windmills'),
  },
  trim: {
    // The envelope (flaps as lever positions, as targets/c172s.ts writes them): approach with landing flap, flap 10
    // slow, the Vy climb, the circuit, the cruise at altitude, a cruise descent and the dead-engine glide.
    cases: [
      { kt: 55, flaps: 1, fpaDeg: -3 },
      { kt: 60, flaps: 1 / 3 },
      { kt: 67, fpaDeg: 4 },
      { kt: 80 },
      { kt: 95, ftAboveField: 6000 },
      { kt: 100, ftMsl: 8000 },
      { kt: 85, fpaDeg: -4 },
      { kt: 60, engineRunning: false },
    ],
    maxResidual: 1e-5,
    maxRateDegS: 0.2,
    wheel: { kt: 90, maxWheel: 1, maxBall: 0.05 },
    impossibleClimb: { kt: 67, fpaDeg: 15, maxFpaDeg: 8 },
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
    restHeightM: band(1.19, 0.03, 'geometry.restHeight; contract 5 intro (3 cm)'),
    idleRpm: range(575, 700, 'SM 11-49: 600 +/-25 (s.4), contract 5.1'),
    parkedDriftMm: below(5, 'contract 3.10 generic block'),
    parkedRateDegS: below(0.05, 'contract 3.10 generic block'),
    taxi: {
      meanSteer: range(-0.3, 0.3, 'contract 3.10 generic block'),
      maxHeadingErrorDeg: below(2, 'contract 3.10 generic block'),
      speedKt: band(10, 1, 'the taxi measurement holds 10 kt'),
      // 8.5 degrees of nosewheel on a 1.47 m wheelbase: about 10 m.
      radiusM: range(6, 20, 'pedal steering +/-8.5 deg (s.3)'),
      maxYawAccelDegS2: below(5, 'contract 3.10 generic block'),
    },
  },
  yaw: {
    ftAboveField: 3000,
    resetKt: 70,
    climbKias: 67,
    // "Modest left yaw on take-off and in the climb (110 hp); right rudder needed throughout the climb" (s.11).
    climb: range(0.08, 0.3, 'data sheet s.11: modest right rudder in the climb'),
    steep: { kias: 55, rudder: above(0.08, 'data sheet s.11: right rudder in the climb') },
    cruise: { kias: 90, rudder: range(0, 0.1, 'a little right pedal below the rig point') },
    rigPoint: { bracketKt: [95, 125], resetKt: 105, rudder: range(-0.02, 0.02, 'rudder tab rig point (systems.ts)') },
  },
  systems: {
    // POH sect. 4: drop not over 125 rpm on either, not over 50 difference; contract 5.1 band 30-125.
    magnetoDrop: { rpm: 1700, drop: range(30, 125, 'POH sect. 4 (s.10), contract 5.1'), difference: range(0, 50, 'POH sect. 4 (s.10)') },
    // POH sect. 7: 150-200 rpm at full throttle; about 50-100 at the run-up (school); contract 5.1's bands.
    carbHeat: { runUpRpm: 1700, fullThrottle: range(110, 240, 'POH sect. 7 (s.4), contract 5.1'), runUp: range(30, 130, 'school practice (s.4), contract 5.1') },
  },
};

/** Fuel flow at 75 % at 8000 ft, leaned (POH fig 5-7: 6.1 US gal/h), +/-10 % (contract 5.1). */
export const C152_CRUISE_FUEL_GPH = pct(6.1, 10, 'POH fig 5-7 (s.4, s.8), contract 5.1');
/** Rest attitude and propeller clearance (POH fig 1-1; contract 5.1). */
export const C152_REST = {
  pitchDeg: range(2.5, 4.0, 'POH fig 1-1: 3 deg 25 min (s.2.4), contract 5.1'),
  propClearanceM: band(0.305, 0.04, 'POH fig 1-1 note 4 (s.2.4), contract 5.1'),
};
/** Carburettor ice model check (contract 5.1): 10 min at 2000 rpm, 10 C, spread 3 K, no heat. */
export const C152_CARB_ICE = {
  rpm: 2000,
  oatC: 10,
  spreadK: 3,
  minutes: 10,
  lossRpm: range(100, 400, 'contract 5.1 model check (no handbook figure)'),
  /** After full heat: recovered (within this many rpm of the ice-free figure) within 60 s, after a further dip. */
  recoverS: below(60, 'contract 5.1 model check'),
};
/** Cruise altitude of the fuel-flow check, m. */
export const C152_CRUISE_ALT = 8000 * FT;
/**
 * The keyboard pilot's tachometer settings and attitudes (keyboardTargets.ts: the keyboardCircuit block and
 * fly-keyboard.mjs), data sheet s.11 with the trims of this model in brackets: downwind 2100-2200 rpm at 80-90 KIAS
 * (2150 at 85), base 1500-1700 with flap 20 (1470 for 500 ft/min at 65), final with flap 30 on a 3 degree path at
 * 60 KIAS (1680; the school's 1300-1500 is a rule of thumb), corrected by 20 rpm per metre off the path (the 172S's
 * 15 left the crosswind circuit's touchdown sink at 2.0 m/s once the full flap's wake was capped, aero.ts
 * WAKE_MAX_LOSS; the sink scatters 0.6-2.0 m/s with the gust met in the round-out). The 152 comes down final about
 * 1 degree nose-down (the 172S 3) and is landed on its mains about 8-10 degrees nose-up, well above its 3.5 degree
 * ground attitude: with the 172S's 6 degrees the round-out came too late and it arrived flat and fast (review F3).
 */
export const KEYBOARD_PILOT_TARGETS: Partial<PilotTargets> = {
  powerDownwind: 2150,
  powerPattern: 1900,
  powerBase: 1500,
  powerFinal: 1680,
  powerMax: 2300,
  powerPerMetre: 20,
  finalPitchDeg: -1,
  landingPitchDeg: 10,
};
