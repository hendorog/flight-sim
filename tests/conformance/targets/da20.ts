// Diamond DA20-C1 (800 kg): the targets of contract section 5.3, each with its source in the type's data sheet
// (aircraft-data/da20.md in the design work folder, which quotes the flight manual DA202-C1 Rev 29, "AFM"). Bands
// are the contract's default ones (5 intro) unless 5.3 states its own. Sweeps and entries are KTAS, the stall
// speeds KCAS.

import { FT } from '../../../src/core/math';
import type { PilotTargets } from '../../input/keyboardPilot';
import { above, band, below, pct, range, type ConformanceTargets } from '../targets';

/** AFM 3.3.2: 11 : 1 at 73 KIAS, propeller windmilling (s.8). */
const GLIDE = 11;

export const DA20_TARGETS: ConformanceTargets = {
  aircraft: 'da20',
  stall: {
    // AFM 5.3.4, forward CG, idle: 54 KCAS flaps CRUISE, 45 KCAS flaps LDG. Pneumatic horn at least 5 kt early (AFM 7.13).
    clean: { flapDeg: 0, entryKt: 72, vs1gKcas: band(54, 3, 'AFM 5.3.4 (s.8), contract 5.3'), warningMarginKt: range(5, 10, 'AFM 7.13: at least 5 kt before the stall (s.9)') },
    landing: { flapDeg: 45, entryKt: 60, vs1gKcas: band(45, 3, 'AFM 5.3.4 (s.8), contract 5.3'), warningMarginKt: range(5, 10, 'AFM 7.13: at least 5 kt before the stall (s.9)') },
  },
  // 1.3 x 44 KIAS (Vs1); contract 3.1.
  stallRecovery: { entryKias: 57, recoveryS: below(4, 'contract 3.1 stall recovery') },
  climb: {
    range: { fromKt: 62, toKt: 95 },
    rocFpm: pct(925, 10, 'AFM fig 5.5 (s.8), contract 5.3'),
    vyKias: band(75, 7, 'AFM 4.2, fig 5.5 (s.8), contract 5.3 (+/-7 kt)'),
    table: {
      range: { fromKt: 62, toKt: 95 },
      // Full rich in the climb (AFM 4.4.8: lean above about 5000 ft only).
      rows: [{ ft: 5000, fpm: pct(660, 12, 'AFM fig 5.5 (s.8), contract 5.3') }],
    },
  },
  // AFM fig 5.7, table 3: about 130 KTAS at sea level, limited by the 2800 rpm red line at part throttle (the
  // propeller absorbs about 87 % there, s.5, s.8). Measured at the throttle that holds the red line.
  maxLevel: { bracketKt: [110, 145], throttle: 0.44, ktas: pct(130, 4, 'AFM fig 5.7 (s.8), contract 5.3'), rpm: range(2700, 2800, 'AFM fig 5.7: rpm 2700-2800, contract 5.3') },
  cruise: {
    altitudeFt: 4000,
    powerFraction: 0.76,
    bracketKt: [105, 140],
    resetKt: 125,
    // AFM table 3: 4000 ft, 2800 rpm, 76 %: 127 KTAS (full rich above 75 %).
    ktas: pct(127, 5, 'AFM table 3 (s.8), contract 5.3'),
    powerFractionReached: band(0.76, 0.005, 'the measurement holds 76 %'),
    rpm: range(2700, 2850, 'AFM table 3: 2800 rpm at 76 % at 4000 ft (s.8)'),
  },
  staticRun: { rpm: range(2000, 2300, 'AFM 4.4.7: at least 2000 (s.5), contract 5.3'), groundSpeed: below(0.05, 'parking brake holds') },
  // The AFM's charted take-off: flaps T/O, brakes held to full power, lift-off at 52 KIAS (AFM fig 5.4). With the fin's
  // swirl reduced (D-D-da20-phys-04) the roll no longer brake-steers against the swing; the wooden propeller's static
  // thrust was then too high (request D-M-D2-01, powerplant.ts blade section).
  takeoff: { flapDeg: 15, rotateKias: 51, pitchDeg: 8, staticRunUp: true, groundRollM: pct(390, 12, 'AFM fig 5.4 (s.8), contract 5.3') },
  // Flaps LDG, idle, 55 KIAS (62 KCAS) approach (AFM 5.3.12). Brakes that hold the static run (full throttle on the
  // brakes, AFM 4.4.7) stop the aircraft in about 140 m; the AFM's 201 m is flown with about 0.45 of the pedal
  // (DECISIONS-D2, D-D-pa38-phys-01 / D-D-da20-phys-02: the chart is conservative, the brakes are not weakened).
  landing: { flapDeg: 45, approachKt: 62, touchdownPitchDeg: 6, brake: 0.45, groundRollM: pct(201, 15, 'AFM 5.3.12 (s.8), contract 5.3') },
  glide: {
    range: { fromKt: 62, toKt: 100 },
    propeller: 'windmilling',
    ratio: band(GLIDE, 1.1, 'AFM 3.3.2 (s.8), contract 5.3: 9.9-12.1'),
    // The AFM's 73 KIAS lies on the flat high-speed side of the polar's optimum (11 : 1 at C_L 0.70 would need a span
    // efficiency of 0.48): judged by the ratio AT 73 KIAS below, and the optimum's own speed loosely (D-D-da20-phys-05).
    bestKias: pct(73, 20, 'AFM 3.2 (s.8); a flat optimum, +/-20 % (DECISIONS-D2, D-D-da20-phys-05)'),
    at: { kias: 73, ratio: band(GLIDE, 1.1, 'AFM 3.3.2 at 73 KIAS (s.8), contract 5.3') },
    windmillingRpm: above(300, 'AFM 3.3.2: propeller windmilling'),
  },
  trim: {
    // The envelope (flaps as lever positions): approach with LDG flap, T/O flap slow, the Vy climb, the circuit, the
    // cruise at altitude, a cruise descent and the dead-engine glide.
    cases: [
      { kt: 58, flaps: 1, fpaDeg: -3 },
      { kt: 62, flaps: 1 / 3 },
      { kt: 78, fpaDeg: 5 },
      { kt: 92 },
      { kt: 115, ftAboveField: 6000 },
      { kt: 120, ftMsl: 4000 },
      { kt: 105, fpaDeg: -4 },
      { kt: 76, engineRunning: false },
    ],
    maxResidual: 1e-5,
    maxRateDegS: 0.2,
    wheel: { kt: 105, maxWheel: 1, maxBall: 0.05 },
    impossibleClimb: { kt: 78, fpaDeg: 15, maxFpaDeg: 8 },
  },
  handsOff: {
    kt: 110,
    ftAboveField: 3000,
    seconds: 60,
    altDriftM: below(15, 'contract 3.10 generic block (the C172S bands)'),
    headingDriftDeg: below(3, 'contract 3.10 generic block'),
    maxVsFpm: below(50, 'contract 3.10 generic block'),
    tasChangeMps: below(0.5, 'contract 3.10 generic block'),
  },
  ground: {
    restHeightM: band(1.07, 0.03, 'geometry.restHeight; contract 5 intro (3 cm)'),
    idleRpm: range(975, 1100, 'AFM 2.4.2: ground idle at least 975 rpm (s.4), contract 5.3'),
    parkedDriftMm: below(5, 'contract 3.10 generic block'),
    parkedRateDegS: below(0.05, 'contract 3.10 generic block'),
    taxi: {
      meanSteer: range(-0.3, 0.3, 'contract 3.10 generic block'),
      maxHeadingErrorDeg: below(2, 'contract 3.10 generic block'),
      speedKt: band(10, 1, 'the taxi measurement holds 10 kt'),
      // Full right brake at 10 kt: the castering nosewheel gives no side force, so the turn is as tight as the side
      // force the mains can give behind the CG allows (da20.test.ts measures the pivot at walking pace, contract 5.3).
      radiusM: range(4, 12, 'castering nosewheel, brake turn at 10 kt'),
      maxYawAccelDegS2: below(5, 'contract 3.10 generic block'),
    },
  },
  yaw: {
    ftAboveField: 3000,
    resetKt: 80,
    climbKias: 75,
    // Clockwise propeller: "left yaw at full power and low speed; right rudder in the climb" (s.11).
    climb: range(0.05, 0.35, 'data sheet s.11: right rudder in the climb'),
    steep: { kias: 60, rudder: above(0.05, 'data sheet s.11: right rudder at full power and low speed') },
    cruise: { kias: 110, rudder: range(-0.02, 0.1, 'a little right pedal below the rig point') },
    rigPoint: { bracketKt: [115, 150], resetKt: 125, rudder: range(-0.02, 0.02, 'rudder tab rig point (systems.ts)') },
  },
  systems: {
    // AFM 4.4.6: at 1700 rpm, drop 25-150 rpm, difference at most 50 (contract 5.3).
    magnetoDrop: { rpm: 1700, drop: range(25, 150, 'AFM 4.4.6 (s.10), contract 5.3'), difference: range(0, 50, 'AFM 4.4.6 (s.10), contract 5.3') },
  },
};

/** Flaps T/O, power off, forward CG: 50 KCAS (AFM 5.3.4; contract 5.3). */
export const DA20_TAKEOFF_FLAP_STALL = { flapDeg: 15, entryKt: 66, vs1gKcas: band(50, 3, 'AFM 5.3.4 (s.8), contract 5.3') };
/** Fuel flow at 2000 ft, 2700 rpm, 74 %, leaned (AFM table 3: 25.7 L/h, 6.8 US gal/h), +/-10 % (contract 5.3). */
export const DA20_CRUISE_FUEL = { altitudeFt: 2000, powerFraction: 0.74, leanAtKt: 115, bracketKt: [105, 135] as const, resetKt: 120, gph: pct(6.8, 10, 'AFM table 3 (s.4, s.8), contract 5.3') };
/** Cruise altitude of the fuel-flow check, m. */
export const DA20_CRUISE_FUEL_ALT = DA20_CRUISE_FUEL.altitudeFt * FT;
/** Centre of gravity moving forward as the fuselage tank empties, maximum-weight loading (s.6, contract 5.3). */
export const DA20_CG_TRAVEL_CM = range(4, 6, 'data sheet s.6 arithmetic: about 5 cm forward, contract 5.3');
/** Taxi at idle with the feet only (the rudder keys below half travel), 5 kt: the castering nosewheel does not steer. */
export const DA20_PEDAL_TAXI = {
  kt: 5,
  rudder: 0.45,
  // The fin sees half the swirl behind the low wing (aero.ts SWIRL_BEHIND_WING; D-D-da20-phys-04).
  yawRateDegS: range(-1, 1, 'AFM 7.5: the pedals do not steer the nosewheel; contract 5.3'),
};
/** Rest attitude and propeller clearance at rest (s.2.1, geometry.ts). */
export const DA20_REST = {
  propClearanceM: range(0.25, 0.34, 'AFM 4.4.1: "minimum approx. 25 cm"; three-view 0.31 m (s.2.1)'),
};
/**
 * The keyboard pilot's tachometer settings and attitudes (keyboardTargets.ts: the keyboardCircuit block and
 * fly-keyboard.mjs), data sheet s.11 with the trims of this model where they differ: downwind 2000-2100 rpm at 90
 * KIAS (2100); base 70 KIAS with flaps LDG near idle (s.11: "1500 rpm or less"; the DA20 descends slowly, 1200);
 * final at the AFM's 55 KIAS on a 3 degree path (1590 rpm, 4 degrees nose-down with flaps LDG); the full-power climb
 * at Vy about 9 degrees nose-up and 2400 rpm. With the 172S's 6 degrees the round-out came late.
 */
export const KEYBOARD_PILOT_TARGETS: Partial<PilotTargets> = {
  // D-D-da20-phys-03: the glider-like DA20 reached base at 1000 ft with 1900 rpm abeam and S-turned onto a final it
  // joined 150 m high. 1300 rpm abeam and base at 65 KIAS bring it down; the throttle closes as the round-out begins
  // and the flare may bank up to 12 degrees into the wind (small ailerons, a long float).
  baseKias: 65,
  // Braked below 35 KIAS: with flaps LDG the wing still carries most of the weight at 45 and full brakes lock the
  // lightly loaded wheels, which then slide downwind in a crosswind (D-M-D2-02: 17 m across on the roll-out).
  brakeKias: 35,
  powerDownwind: 2100,
  powerPattern: 1300,
  powerBase: 1200,
  powerFinal: 1590,
  powerMax: 2400,
  powerPerMetre: 20,
  climbPitchDeg: 9,
  finalPitchDeg: -4,
  landingPitchDeg: 7,
  throttleOffM: 10,
  flareBankDeg: 12,
  // D-D-da20-phys-06: kicking the crab out at the round-out left a 4-6 s float in the slip, which the small ailerons
  // could not hold wings-level: the DA20 rolled away from the wind and touched down 12.6 m downwind. It keeps the
  // crab to 2 m and kicks it out just before the wheels touch (1 deg of crab left at touchdown, 2.5 m upwind).
  decrabM: 2,
};
