// Cessna 208 Caravan 675 (PT6A-114A, 8000 lb): the conformance targets, each with its source (the 208 POH, sections
// 2, 4 and 5, at 8000 lb). Bands are the contract's default ones unless stated. Sweeps and entries are KTAS, the
// stall speeds KCAS. Power is set by torque: the power lever at its sea-level torque limit is about 0.9
// (aircraft/c208/sim.ts); "full throttle" in a block means the lever there unless the block says otherwise.
//
// Weak data are marked: no engineering data sheet exists for this type yet, and some POH figures are recalled
// from the published brochure tables rather than read off the charts.

import { C208_BETA } from '../../../src/aircraft/c208/powerplant';
import type { ConformanceTargets } from '../targets';
import { band, below, pct, range } from '../targets';

/** Power lever at the sea-level torque limit (aircraft/c208/sim.ts TAKEOFF_LEVER). */
const TORQUE_LIMIT_LEVER = 0.885;
/** Propeller 1900 rpm on the governor: the power turbine at 33 000 rpm. */
const PT_RPM_GOVERNED = range(32_400, 33_400, 'POH sect. 2: Np 1900 (power turbine 33 000 rpm)');

export const C208_TARGETS: ConformanceTargets = {
  aircraft: 'c208',
  stall: {
    // POH sect. 5 (8000 lb, forward CG, power idle): about 70 KCAS flaps UP and 60 KCAS flaps FULL (weak: recalled).
    clean: { flapDeg: 0, entryKt: 92, vs1gKcas: band(70, 4, 'POH sect. 5 (weak)'), warningMarginKt: range(3, 12, 'POH sect. 7: warning horn 5-10 kt early') },
    landing: { flapDeg: 30, entryKt: 78, vs1gKcas: band(60, 4, 'POH sect. 5 (weak)'), warningMarginKt: range(3, 12, 'POH sect. 7: warning horn 5-10 kt early') },
  },
  stallRecovery: { entryKias: 91, recoveryS: below(4, 'contract 3.1 stall recovery') },
  climb: {
    range: { fromKt: 85, toKt: 130 },
    throttle: TORQUE_LIMIT_LEVER,
    rocFpm: pct(1234, 10, 'POH sect. 5: maximum rate of climb at sea level, 8000 lb'),
    vyKias: band(104, 8, 'POH sect. 4: Vy 104 KIAS at sea level'),
  },
  // Torque-limited at sea level.
  maxLevel: { bracketKt: [130, 200], throttle: TORQUE_LIMIT_LEVER, ktas: pct(172, 6, 'POH sect. 5: about 170 KTAS at maximum cruise torque low down (weak)') },
  cruise: {
    altitudeFt: 10_000,
    // Maximum cruise at 10 000 ft: about 640 shp, at the ITT limit.
    powerFraction: 0.9,
    bracketKt: [140, 200],
    resetKt: 175,
    ktas: pct(180, 5, 'POH sect. 5: 184 KTAS maximum cruise at 10 000 ft'),
    powerFractionReached: band(0.9, 0.01, 'the measurement holds 90 %'),
    rpm: PT_RPM_GOVERNED,
  },
  staticRun: { rpm: PT_RPM_GOVERNED, groundSpeed: below(0.05, 'parking brake holds') },
  // POH sect. 5 (8000 lb, sea level, ISA, flaps 20): ground roll 970 ft, the chart's short-field technique (lift-off
  // about 70 KIAS: rotated at 65, as the other types' targets rotate a little below the published Vr).
  takeoff: { flapDeg: 20, rotateKias: 65, pitchDeg: 8, staticRunUp: true, throttle: TORQUE_LIMIT_LEVER, groundRollM: pct(296, 15, 'POH sect. 5: ground roll 970 ft') },
  // POH sect. 5 (7800 lb, flaps FULL, 78 KIAS, maximum braking, no reverse): ground roll 715 ft. The chart's
  // technique is "beta, no reverse": the power lever aft of the gate to ground fine on the roll (the end of the
  // pitch-only travel, C208_BETA.pitchOnlyTravel), Ng at idle.
  landing: { flapDeg: 30, approachKt: 78, touchdownPitchDeg: 5, reverse: C208_BETA.pitchOnlyTravel, groundRollM: pct(218, 20, 'POH sect. 5: ground roll 715 ft (beta, no reverse)') },
  glide: {
    range: { fromKt: 90, toKt: 140 },
    propeller: 'feathered',
    ratio: band(11, 1.5, 'POH sect. 3 maximum glide (weak)'),
    bestKias: pct(95, 15, 'POH sect. 3: 95 KIAS at 8000 lb'),
    at: { kias: 95, ratio: band(11, 1.5, 'POH sect. 3 at 95 KIAS (weak)') },
  },
  trim: {
    cases: [
      { kt: 80, flaps: 1, fpaDeg: -3 },
      { kt: 95, flaps: 2 / 3 },
      { kt: 104, fpaDeg: 4 },
      { kt: 120 },
      { kt: 160, ftAboveField: 6000 },
      { kt: 180, ftMsl: 10_000 },
      { kt: 140, fpaDeg: -3 },
      { kt: 100, engineRunning: false },
    ],
    maxResidual: 1e-5,
    maxRateDegS: 0.2,
    wheel: { kt: 130, maxWheel: 1, maxBall: 0.05 },
    impossibleClimb: { kt: 104, fpaDeg: 15, maxFpaDeg: 9 },
  },
  handsOff: {
    kt: 140,
    ftAboveField: 3000,
    seconds: 60,
    altDriftM: below(15, 'contract 3.10 generic block'),
    headingDriftDeg: below(3, 'contract 3.10 generic block'),
    maxVsFpm: below(50, 'contract 3.10 generic block'),
    tasChangeMps: below(0.5, 'contract 3.10 generic block'),
  },
  ground: {
    restHeightM: band(1.905, 0.03, 'geometry.restHeight; contract 5 intro (3 cm)'),
    // Power-turbine rpm at HIGH IDLE on the ground (the definition's default condition lever), the power lever on
    // the idle gate: the propeller at about 900-1200 rpm. The Ng is the POH's (high idle 65 %); the Np band is an
    // ESTIMATE (no handbook figure in hand), the same as the idle-taxi case "on the gate, HIGH IDLE" below.
    idleRpm: range(15_500, 21_000, 'POH sect. 7: HIGH IDLE 65 % Ng; Np about 900-1200 (ESTIMATE)'),
    parkedDriftMm: below(5, 'contract 3.10 generic block'),
    parkedRateDegS: below(0.05, 'contract 3.10 generic block'),
    taxi: {
      meanSteer: range(-0.3, 0.3, 'contract 3.10 generic block'),
      maxHeadingErrorDeg: below(2, 'contract 3.10 generic block'),
      speedKt: band(10, 1, 'the taxi measurement holds 10 kt'),
      // 15 degrees of nosewheel on a 3.55 m wheelbase: about 13 m.
      radiusM: range(9, 25, 'pedal steering +/-15 deg (POH sect. 7)'),
      maxYawAccelDegS2: below(5, 'contract 3.10 generic block'),
    },
    // The power lever's positions on the ground with Ng at idle (plan 4, T1b): on the gate the propeller sits on the
    // low-pitch stop and pulls; aft of the gate the beta valve flattens the blades to ground fine, where it makes
    // about no thrust. The gate at LOW IDLE (a steady unbraked 15-30 kt) and half the pitch-only travel (8-12 kt)
    // take longer to settle than this block rolls: they are type items in c208.test.ts.
    idleTaxi: [
      {
        label: 'on the gate, HIGH IDLE',
        reverse: 0,
        condition: 1,
        idleNp: range(900, 1200, 'HIGH IDLE on the ground: Np about 900-1200 (ESTIMATE, as ground.idleRpm)'),
        idleNgPct: band(65, 1, 'POH sect. 7: HIGH IDLE 65 % Ng'),
      },
      {
        label: 'ground fine, LOW IDLE',
        reverse: C208_BETA.pitchOnlyTravel,
        condition: 0.1,
        staticThrustN: range(-500, 500, 'ground fine: about zero static thrust (plan 4 item b, ESTIMATE)'),
        idleTaxiKt: range(-1, 5, 'held in ground fine the aircraft barely moves (plan 4 item b, ESTIMATE)'),
        idleNgPct: band(52, 1, 'TCDS IM.A.226 sect. 5.3: idle 52 % Ng minimum (LOW IDLE)'),
      },
    ],
  },
  yaw: {
    ftAboveField: 3000,
    resetKt: 110,
    climbKias: 104,
    throttle: TORQUE_LIMIT_LEVER,
    // A 675 shp single: marked right rudder (or rudder trim) in the climb.
    climb: range(0.05, 0.45, 'POH sect. 4: rudder trim set for take-off; right rudder in the climb'),
    cruise: { kias: 150, rudder: range(-0.02, 0.15, 'a little right pedal in the cruise') },
  },
};

/** Fuel flow at maximum cruise at 10 000 ft (POH sect. 5: about 360-380 lb/h), +/-12 %. */
export const C208_CRUISE_FUEL_PPH = pct(370, 12, 'POH sect. 5 maximum cruise at 10 000 ft');
/** Rest attitude and propeller clearance (POH sect. 1 three-view). */
export const C208_REST = {
  pitchDeg: range(-1, 1.5, 'POH three-view: the 208 stands about level'),
  propClearanceM: band(0.33, 0.06, 'POH sect. 1: propeller ground clearance about 11-13 in'),
};
/** Engine limits a correct take-off setting respects (POH sect. 2). */
export const C208_TAKEOFF_LIMITS = {
  torqueFtLb: range(1700, 1865, 'POH sect. 2: 1865 ft lb maximum (the lever set just below the limit)'),
  ittC: below(805, 'POH sect. 2: 805 C maximum'),
  ng: below(101.6, 'POH sect. 2: 101.6 % maximum'),
  np: range(1850, 1950, 'POH sect. 2: 1900 rpm'),
};

/**
 * The power lever's positions on the ground at LOW IDLE that settle slower than the suite's idle-taxi block rolls
 * (c208.test.ts; plan 4, T1b items a and c). On the gate the propeller on its low-pitch stop pulls the aircraft to a
 * brisk taxi, which is why the POH taxies it in beta; halfway through the pitch-only travel it should be a walking
 * taxi. Both bands are ESTIMATES. Half travel is held open: with the blade angle linear in the lever, 5 deg of blade
 * makes as much static thrust as the low-pitch stop (requests.ts 'C208-beta-cam').
 */
export const C208_BETA_TAXI = [
  {
    label: 'on the gate',
    reverse: 0,
    speedKt: range(15, 30, 'on the gate at LOW IDLE the Caravan runs away and is taxied in beta (plan 4 item a, ESTIMATE)'),
    thrustN: range(1000, 2500, 'enough to break away and accelerate (ESTIMATE)'),
    np: range(600, 1000, 'below HIGH IDLE (900-1200): LOW IDLE 52 % Ng on the low-pitch stop (ESTIMATE)'),
    settled: range(1, 1, 'measure.ts idleTaxi steady'),
  },
  {
    label: 'half the pitch-only travel',
    reverse: C208_BETA.pitchOnlyTravel / 2,
    speedKt: range(8, 12, 'halfway into beta: a walking taxi (plan 4 item c, ESTIMATE)', 'C208-beta-cam'),
    thrustN: range(500, 1200, 'between ground fine and the gate (ESTIMATE)', 'C208-beta-cam'),
    np: range(600, 1700, 'between the gate and ground fine; under 95 % Np, the beta topping (ESTIMATE)'),
    settled: range(1, 1, 'measure.ts idleTaxi steady', 'C208-beta-cam'),
  },
] as const;
