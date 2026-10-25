// Cessna 208 Caravan 675 (PT6A-114A, 8000 lb): the conformance targets, each with its source (the 208 POH, sections
// 2, 4 and 5, at 8000 lb). Bands are the contract's default ones unless stated. Sweeps and entries are KTAS, the
// stall speeds KCAS. Power is set by torque: the power lever at its sea-level torque limit is about 0.9
// (aircraft/c208/sim.ts); "full throttle" in a block means the lever there unless the block says otherwise.
//
// Weak data are marked: no engineering data sheet exists for this type yet, and some POH figures are recalled
// from the published brochure tables rather than read off the charts.

import { C208_BETA, PT6A_114A } from '../../../src/aircraft/c208/powerplant';
import type { PilotTargets } from '../../input/keyboardPilot';
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
    // the idle gate: the propeller at about 850-1200 rpm. The Ng is the POH's (high idle 65 %); the Np band is an
    // ESTIMATE (no handbook figure in hand), the same as the idle-taxi case "on the gate, HIGH IDLE" below. Widened
    // from 900 to 850 rpm (2026-10-26) when the idle gas power came down so that idle drags (powerplant.ts): about 890.
    idleRpm: range(14_700, 21_000, 'POH sect. 7: HIGH IDLE 65 % Ng; Np about 850-1200 (ESTIMATE)'),
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
        idleNp: range(850, 1200, 'HIGH IDLE on the ground: Np about 850-1200 (ESTIMATE, as ground.idleRpm)'),
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
 * The power lever's positions on the ground at idle that settle slower than the suite's idle-taxi block rolls
 * (c208.test.ts; plan 4, T1b items a and c), maximum gross, level, unbraked. All bands are ESTIMATES. Recalibrated
 * 2026-10-26 when the idle stopped pulling the aircraft along (powerplant.ts: the low-pitch stop at the TCDS's station,
 * LOW / HIGH IDLE 25 / 40 shp of gas power): before, the gate at HIGH IDLE ran away past 70 kt (3.5 kN static) and an
 * unbraked landing roll at idle levelled off at 55 kt; the gate at LOW IDLE ran 22 kt (band 15-30) and half travel
 * 10.9 kt (band 8-12). Now the gate at LOW IDLE is a slow taxi that a loaded Caravan needs "a fair amount of breakaway
 * power" to start (AOPA Pilot, Turbine Pilot: Cessna Caravan, March 2009), and the gate at HIGH IDLE (the landing
 * setting) still a brisk taxi that the POH's "beta after touchdown" controls. Owner decision: the LOW IDLE bands.
 */
export const C208_BETA_TAXI = [
  {
    label: 'on the gate',
    reverse: 0,
    condition: 0.1,
    speedKt: range(4, 12, 'on the gate at LOW IDLE a slow taxi; breaks away slowly when loaded (AOPA 2009; ESTIMATE, owner decision)'),
    thrustN: range(700, 1200, 'a little more than the rolling resistance (0.02 x 35 kN, about 700 N): it creeps off (ESTIMATE)'),
    np: range(600, 1000, 'below HIGH IDLE (850-1200): LOW IDLE 52 % Ng on the low-pitch stop (ESTIMATE)'),
    settled: range(1, 1, 'measure.ts idleTaxi steady'),
  },
  {
    label: 'half the pitch-only travel',
    reverse: C208_BETA.pitchOnlyTravel / 2,
    condition: 0.1,
    speedKt: range(1, 6, 'halfway into beta at LOW IDLE: slower than the gate, a creep (ESTIMATE)'),
    thrustN: range(500, 1200, 'between ground fine and the gate (ESTIMATE)'),
    np: range(600, 1700, 'between the gate and ground fine; under 95 % Np, the beta topping (ESTIMATE)'),
    settled: range(1, 1, 'measure.ts idleTaxi steady'),
  },
  {
    label: 'on the gate, HIGH IDLE',
    reverse: 0,
    condition: 1,
    speedKt: range(15, 35, 'on the gate at HIGH IDLE (the landing setting) a brisk taxi, not a run-away: it was 73 kt and still accelerating (ESTIMATE)'),
    thrustN: range(1000, 2000, 'HIGH IDLE static on the gate: was 3.5 kN (ESTIMATE)'),
    np: range(850, 1200, 'HIGH IDLE on the ground: Np about 850-1200 (ESTIMATE, as ground.idleRpm)'),
    settled: range(1, 1, 'measure.ts idleTaxi steady'),
  },
] as const;

/**
 * Idle descents (power lever on the gate, condition HIGH IDLE, propeller MAX; maximum gross, 5000 ft above the field,
 * the speed held on the pitch): the propeller on its low-pitch stop drags, as on the real aircraft: feathering at
 * idle makes it surge forward, and below about 500 ft lbf the flattened blades are "a giant, drag-producing disc"
 * (AOPA Pilot, Turbine Pilot: Cessna Caravan, March 2009). Before 2026-10-26 the idle propeller pulled +1.2 kN at
 * 95 KIAS (an idle glide of 2.7 deg, L/D 21, against 4.5 deg feathered) and the flaps-FULL idle path was 4.6 deg.
 * The bands are ESTIMATES (no POH idle-descent figure in hand).
 */
export const C208_IDLE_DESCENT = [
  {
    label: 'clean at 95 KIAS',
    kias: 95,
    flapLever: 0,
    thrustN: below(0, 'idle drags: feathering it gains (AOPA 2009)'),
    pathDeg: range(4.6, 9, 'steeper than the feathered glide at 95 KIAS (about 4.5 deg, L/D 12-13) (ESTIMATE)'),
  },
  {
    label: 'clean at 120 KIAS',
    kias: 120,
    flapLever: 0,
    thrustN: below(0, 'idle drags: feathering it gains (AOPA 2009)'),
    pathDeg: range(5, 10, 'idle descent clean at 120 KIAS: about 1300-2000 ft/min (ESTIMATE)'),
  },
  {
    label: 'flaps FULL at 78 KIAS',
    kias: 78,
    flapLever: 1,
    thrustN: below(600, 'about no thrust on short final at idle (ESTIMATE)'),
    pathDeg: range(5.5, 12, 'flaps FULL at idle comes down steeply: "do not go to flight idle until about to touch down" (AOPA 2009; ESTIMATE)'),
  },
] as const;

/** ft lbf per N m. */
const FT_LB_PER_NM = 1 / 1.3558179;

/**
 * The keyboard circuit pilot's targets (keyboardTargets.ts; tests/input/keyboardPilot.ts): power is set by TORQUE, ft lbf
 * on the propeller shaft, as the Caravan is flown (the propeller holds 1900 rpm on its governor whatever the power). The
 * torques are those of the trimmed scenario starts (downwind 115 KIAS level about 790 ft lbf; final 95 KIAS flaps 20 on
 * the 3 deg path about 470) and the POH's take-off and climb settings (1865 ft lbf maximum: take-off at 1750 with a
 * margin for the spool-up overshoot, climb 1650). Take-off and climb with flaps 20 at 90 KIAS (POH sect. 4: "climb out at
 * 85-95 KIAS with flaps 20"), flaps up at the level-off, 10 abeam the threshold, 20 on base at 95, FULL on final at 78.
 * On the roll-out the power lever goes over the gate into beta, to ground fine, once the nose wheel is down (below
 * 75 KIAS; POH: beta after touchdown), and the brakes come on below 55 KIAS.
 */
export const KEYBOARD_PILOT_TARGETS: Partial<PilotTargets> = {
  power: (s) => s.engines[0].torque * PT6A_114A.gearRatio * FT_LB_PER_NM,
  takeoffPower: 1750,
  climbPower: 1650,
  takeoffFlapDetent: 2,
  rotateKias: 72,
  climbKias: 90,
  rotatePitchDeg: 8,
  climbPitchDeg: 9,
  levelPitchDeg: 3,
  finalPitchDeg: -1.5,
  landingPitchDeg: 5,
  powerDownwind: 800,
  powerPattern: 600,
  powerBase: 450,
  powerFinal: 550,
  powerMin: 150,
  powerMax: 1400,
  powerPerKt: 20,
  powerPerMetre: 10,
  powerBand: 60,
  // A wider circuit than the 172's, set when the Caravan's idle propeller still turned about 400 ft lbf on approach
  // (flaps FULL, 78 KIAS, idle: about 3.6 deg; since 2026-10-26 about 100 ft lbf and 6.4 deg, and the circuit was
  // left as it was). The pilot comes down 450 ft from abeam the threshold, turns base 2500 m beyond it and flies base
  // at 450 ft, so the final starts on or a little under the path, where power, not idle, corrects it.
  baseTurnM: 2500,
  baseFt: 450,
  downwindDescentFt: 450,
  // A heavy aircraft: the crab kept until just before the wheels touch (its ailerons would not hold a wing down
  // against the drift through a long float). The flare from 7.5 m (7 m until 2026-10-26: with idle now dragging, the
  // 7 m round-out touched at 1.81 m/s in the 10 kt crosswind; 7.5 m gives 1.41 / 1.69 m/s calm / crosswind).
  flareM: 7.5,
  decrabM: 2,
  flareBankDeg: 8,
  brakeKias: 55,
  rolloutReverse: { belowKias: 75, lever: C208_BETA.pitchOnlyTravel },
};

/** The keyboard circuit's checks (plan 4, T1b): what a Caravan pilot flying the circuit by hand would be held to. */
export const C208_KEYBOARD_CIRCUIT = {
  completed: range(1, 1, 'take-off, circuit, landing and a stop'),
  climbKias: range(85, 95, 'POH sect. 4: climb out at 85-95 KIAS with flaps 20'),
  downwindKias: range(100, 130, 'SCHOOL: downwind 110-120 KIAS (+/-10)'),
  torqueFtLb: below(1865, 'POH sect. 2: 1865 ft lb maximum'),
  flapOverspeed: range(0, 0, 'POH sect. 2: flaps 10 175, 20 150, FULL 125 KIAS'),
  touchdownM: range(0, 450, 'within the first 450 m of the runway (plan 4)'),
  betaBelow60: range(C208_BETA.pitchOnlyTravel - 0.01, 1, 'POH sect. 4: beta after touchdown (ground fine or further aft)'),
};
