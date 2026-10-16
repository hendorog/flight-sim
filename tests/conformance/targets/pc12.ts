// Pilatus PC-12/47 (PT6A-67B, 4740 kg): the conformance targets, each with its source tag (docs/pc12-sources.md;
// plan sect. 5.7). TCDS = EASA A.089 sect. C; 47E-PROXY = PC-12/47E POH 02277 (same airframe, the PT6A-67P);
// CHART-READ = read by eye off a 47E chart (tolerance given); DERIVED = arithmetic shown; ESTIMATE = no source;
// AGENT = an agent's choice of test condition. Bands are the contract's default ones unless stated. Sweeps and
// entries are KTAS, the stall speeds KCAS (the 47E's KIAS through the type's air-data calibration, systems.ts).
//
// Power is set by torque: on the PC-12 the PCL's torque limiter holds the take-off torque (44.3 psi at sea level), so
// "full throttle" is the lever fully forward; the climb and the maximum cruise are at the maximum-continuous torque,
// 36.95 psi (aircraft/pc12/sim.ts PC12_CLIMB_LEVER near sea level).

import { pc12TorquePsi } from '../../../src/aircraft/pc12/facts';
import { PC12_CLIMB_LEVER, PC12_FLIGHT_IDLE, PC12_GROUND_IDLE, PC12_TAKEOFF_LEVER } from '../../../src/aircraft/pc12/sim';
import type { AircraftState } from '../../../src/core/types';
import type { PilotTargets } from '../../input/keyboardPilot';
import type { ConformanceTargets } from '../targets';
import { band, below, pct, range } from '../targets';

/** The PCL's aft travel that moves the blades only (aircraft/pc12/powerplant.ts beta.pitchOnlyTravel). */
const GROUND_FINE = 0.45;
/** Propeller 1700 rpm on the governor, +/- 30 rpm: the power turbine (gear 17.585, POH 2-6 note 8). */
const PT_GOVERNED = range(1670 * (29_894 / 1700), 1730 * (29_894 / 1700), 'TCDS / 47E 7-11: Np 1700 (1670-1730 steady)');

export const PC12_TARGETS: ConformanceTargets = {
  aircraft: 'pc12',
  stall: {
    // "Stall is defined by pusher activation" (47E-PROXY 5 p. 329): the stall speed is the first push, at the forward
    // limit and MTOW (the stall block's 'forward' loading: 10 450 lb), idle. CHART-READ +/-2 (Fig 5-2-1): 95 KIAS flaps 0,
    // 67 KIAS flaps 40 = 97 / 69 KCAS through PC12_AIR_DATA (ESTIMATE position error).
    trip: 'pusher',
    clean: { flapDeg: 0, entryKt: 128, vs1gKcas: band(97, 3, '47E-PROXY Fig 5-2-1 CHART-READ: 95 KIAS (pusher), 10 450 lb'), warningMarginKt: range(5, 10, '47E-PROXY 7-21: shaker 5-10 kt before the pusher') },
    landing: { flapDeg: 40, entryKt: 95, vs1gKcas: band(69, 3, '47E-PROXY Fig 5-2-1 CHART-READ: 67 KIAS (pusher), 10 450 lb'), warningMarginKt: range(5, 10, '47E-PROXY 7-21: shaker 5-10 kt before the pusher') },
  },
  stallRecovery: { entryKias: 124, recoveryS: below(4, 'contract 3.1 stall recovery') },
  climb: {
    range: { fromKt: 110, toKt: 160 },
    throttle: PC12_CLIMB_LEVER,
    // The /47 at 1000 shp (36.95 psi) climbs less than the 47E's chart: ESTIMATE 1650 ft/min at MTOW, SL ISA
    // (SECONDARY: about 1680 at 4500 kg).
    rocFpm: pct(1650, 20, 'ESTIMATE (plan 5.7): MCP 36.95 psi, SL ISA, MTOW; SECONDARY ~1680 at 4500 kg'),
    vyKias: band(130, 10, '47E-PROXY 4.2: Vy 130 KIAS at sea level'),
  },
  // Level at the maximum-continuous torque near sea level (report only, plan 5.7): the 47E's 36.9 psi row.
  maxLevel: { bracketKt: [190, 270], throttle: PC12_CLIMB_LEVER, ktas: pct(229, 6, '47E-PROXY Fig 5-2-31: SL ISA 36.9 psi, 229 KTAS at 10 400 lb (report)') },
  cruise: {
    // Maximum cruise at 12 000 ft ISA: 36.9 psi = 1000 shp = 0.832 of the 1200 shp rating (DERIVED).
    altitudeFt: 12_000,
    powerFraction: 36.9 / 44.34,
    bracketKt: [200, 290],
    resetKt: 255,
    ktas: pct(256, 4, '47E-PROXY Fig 5-2-31: 12 000 ft ISA 36.9 psi, 256 KTAS at 10 400 lb'),
    powerFractionReached: band(36.9 / 44.34, 0.01, 'the measurement holds 36.9 psi'),
    rpm: PT_GOVERNED,
  },
  staticRun: { rpm: PT_GOVERNED, groundSpeed: below(0.05, 'parking brake holds') },
  // 47E-PROXY Fig 5-2-12 (flaps 15, SL ISA, 10 450 lb): about 1700 ft CHART-READ +/-150 (SECONDARY 1650); the chart's
  // technique: PCL to the take-off torque on the brakes, rotate at 82 KIAS (rotated at 80, as the other types' targets
  // rotate a little below the published Vr).
  takeoff: { flapDeg: 15, rotateKias: 80, pitchDeg: 8, staticRunUp: true, throttle: PC12_TAKEOFF_LEVER, groundRollM: pct(518, 15, '47E-PROXY Fig 5-2-12 CHART-READ: 1700 ft (SECONDARY 1650)') },
  // 47E-PROXY Fig 5-2-52 (flaps 40) read at SL ISA, 9921 lb (its weight reference line), zero wind and slope: 1275 ft
  // CHART-READ +/-100 ft. Its associated conditions: "average braking technique, ground idle after touch down" (the PCL
  // at IDLE on the gate, the condition lever to GROUND IDLE): brake 0.4 of full (AGENT reading of "average", set at
  // MLW: 0.5 rolled 322 m, 0.4 385 m, 0.35 428 m; the model's brakes may be strong rather than the pilot light). Vref 85
  // KIAS. The generic roll (measure.ts landingRoll) cannot move the condition lever: on the roll it stays at FLIGHT
  // IDLE, whose 66 % Ng pulls about 5 kN at a standstill on the 6 deg stop (460 m, ratio 0.59). Those two items are held
  // on the beta plumbing ('PC12-beta': LandingOptions.rollCondition requested); pc12.test.ts judges the chart's
  // technique (ground idle after touchdown) against the same bands.
  landing: {
    flapDeg: 40,
    approachKt: 86,
    touchdownPitchDeg: 5,
    brake: 0.4,
    groundRollM: band(389, 30, '47E-PROXY Fig 5-2-52 CHART-READ: 1275 ft +/-100 at SL ISA, 9921 lb, average braking, ground idle after touchdown', 'PC12-beta'),
    reverse: 0,
    // 47E-PROXY 4.16: the PCL back to IDLE before the aircraft stops.
    reverseCancel: { kias: 40, to: 0 },
    // Fig 5-2-54 ("full reverse thrust after touch down", average braking): the example's 1680 ft over 50 ft against
    // 1990 without reverse, with the same 870 ft in the air (1990 - 1120), gives a ground roll of 810 ft against 1120:
    // 0.72 (DERIVED).
    withReverse: {
      reverse: 1,
      groundRollM: band(280, 35, 'DERIVED: 0.72 x the chart-read 389 m (47E-PROXY Fig 5-2-52/54)', 'PC12-beta'),
      ratio: band(0.72, 0.08, 'DERIVED: 47E-PROXY example 1680 / 1990 ft over 50 ft -> 810 / 1120 ft on the ground', 'PC12-beta'),
    },
  },
  glide: {
    range: { fromKt: 100, toKt: 150 },
    propeller: 'feathered',
    ratio: band(15.8, 1.5, 'DERIVED: 47E-PROXY Fig 5-2-46, 65 NM from 25 000 ft feathered'),
    bestKias: band(119, 10, '47E-PROXY 3.2: best glide 119 KIAS at 10 450 lb'),
    at: { kias: 119, ratio: band(15.8, 1.5, 'DERIVED: 47E-PROXY Fig 5-2-46 at 119 KIAS') },
  },
  trim: {
    cases: [
      { kt: 88, flaps: 1, fpaDeg: -3 },
      { kt: 105, flaps: 15 / 40 },
      { kt: 132, fpaDeg: 5 },
      { kt: 160 },
      { kt: 200, ftAboveField: 6000 },
      { kt: 250, ftMsl: 12_000 },
      { kt: 180, fpaDeg: -3 },
      { kt: 125, engineRunning: false },
    ],
    maxResidual: 1e-5,
    maxRateDegS: 0.2,
    wheel: { kt: 170, maxWheel: 1, maxBall: 0.05 },
    impossibleClimb: { kt: 130, fpaDeg: 15, maxFpaDeg: 10 },
  },
  handsOff: {
    kt: 200,
    ftAboveField: 3000,
    seconds: 60,
    altDriftM: below(15, 'contract 3.10 generic block'),
    headingDriftDeg: below(3, 'contract 3.10 generic block'),
    maxVsFpm: below(50, 'contract 3.10 generic block'),
    tasChangeMps: below(0.5, 'contract 3.10 generic block'),
  },
  ground: {
    restHeightM: band(1.54, 0.03, 'geometry.restHeight; contract 5 intro (3 cm)'),
    // Power-turbine rpm on the gate at the definition's default condition lever (FLIGHT IDLE, 66 % Ng): the propeller
    // on its 6 deg stop runs up to about its governed speed (ESTIMATE; the 47E: 1700 rpm "except at low power settings
    // at low speeds").
    idleRpm: range(1500 * (29_894 / 1700), 1730 * (29_894 / 1700), 'ESTIMATE: FLIGHT IDLE on the gate, Np 1500-1730'),
    parkedDriftMm: below(5, 'contract 3.10 generic block'),
    parkedRateDegS: below(0.05, 'contract 3.10 generic block'),
    taxi: {
      meanSteer: range(-0.3, 0.3, 'contract 3.10 generic block'),
      maxHeadingErrorDeg: below(2, 'contract 3.10 generic block'),
      speedKt: band(10, 1, 'the taxi measurement holds 10 kt'),
      // 12 deg of nosewheel on a 3.48 m wheelbase: about 16 m.
      radiusM: range(12, 30, '47E-PROXY 7-4: pedal steering +/-12 deg'),
      maxYawAccelDegS2: below(5, 'contract 3.10 generic block'),
    },
    // The static items at each lever position (the generic block). The steady unbraked speeds take 200-300 s to
    // settle at 4740 kg (the thrust falls slowly with speed), longer than the block's 150 s: pc12.test.ts judges them
    // over 300 s (IdleTaxiCase.seconds requested).
    idleTaxi: [
      {
        label: 'on the gate, ground idle',
        reverse: 0,
        condition: PC12_GROUND_IDLE,
        idleNp: band(1060, 60, '47E-PROXY 7-11 p. 707: ground idle about 1060 rpm'),
        idleNgPct: range(50.7, 61.4, '47E-PROXY 2-6: ground idle Ng 50.7-61.4 %'),
        idleIttC: below(750, '47E-PROXY 2-6 note 5: minimum-idle ITT 750 C'),
      },
      {
        label: 'ground fine',
        reverse: GROUND_FINE,
        condition: PC12_GROUND_IDLE,
        staticThrustN: range(-500, 500, 'AGENT (plan 5.7 (b)): ground fine is about zero thrust'),
        idleTaxiKt: below(5, 'AGENT (plan 5.7 (b))'),
      },
    ],
  },
  yaw: {
    ftAboveField: 3000,
    resetKt: 135,
    climbKias: 130,
    throttle: PC12_TAKEOFF_LEVER,
    // A 1200 shp single at 130 KIAS: marked right rudder with the rudder trim at zero.
    climb: range(0.15, 0.45, 'ESTIMATE (plan 5.7): 1200 shp single, rudder trim 0'),
    cruise: { kias: 200, rudder: range(-0.02, 0.12, 'ESTIMATE (plan 5.7): little pedal in the cruise') },
  },
  systems: {
    gearTransit: { kias: 130, up: range(5, 9, 'ESTIMATE: 6-8 s (not published, research 10)'), down: range(5, 9, 'ESTIMATE: 6-8 s') },
  },
};

/** Condition lever positions the type items use (aircraft/pc12/sim.ts). */
export const PC12_CONDITION = { groundIdle: PC12_GROUND_IDLE, flightIdle: PC12_FLIGHT_IDLE } as const;

/** Rest attitude and propeller clearance (3V; the PC-12 stands about level). */
export const PC12_REST = {
  pitchDeg: range(-1, 1.5, '3V (47E-PROXY Fig 1-1): the PC-12 stands about level'),
  propClearanceM: band(0.3, 0.05, 'geometry.ts ESTIMATE (3V): about 0.30 m'),
};

/** Static, PCL full (the torque limiter), SL ISA (plan 5.7). */
export const PC12_STATIC_TAKEOFF = {
  torquePsi: range(44.0, 46.0, 'TCDS 44.34 psi; the 47E limiter 44.3 at sea level (plan 5.7)'),
  ngPct: range(93, 99, 'ESTIMATE (flat rated: below the 104 % limit)'),
  ittC: range(680, 780, 'ESTIMATE (below the 800 C take-off limit, TCDS)'),
  np: band(1700, 30, 'TCDS: 1700 rpm'),
};
/** PCL full at 10 000 ft ISA, 150 KIAS (plan 5.7: the limiter's lapse). */
export const PC12_LIMITER_10000 = {
  torquePsi: range(40.5, 43.0, '47E-PROXY 7-10: 44.3 - 2.7 psi per 10 000 ft; ESTIMATE for the /47'),
  ittC: below(800, 'TCDS: take-off ITT 800 C'),
};
/**
 * Hot and high static, 8000 ft, 26 C: the PCL set for the ITT limit, 800 C (the engine has no ITT limiter: with the PCL
 * full the torque limiter's 42 psi would overtemp it; the POH technique sets the lesser of the torque and ITT limits).
 */
export const PC12_HOT_HIGH = {
  torquePsi: range(29, 34, 'ESTIMATE from the 47E-PROXY Fig 5-2-3 example (34.1 psi at 850 C), at the /47\'s 800 C'),
};
/** Maximum cruise rows (47E-PROXY Fig 5-2-31 sheet 3, ISA, 36.9 psi), flown at the maxGross loading (10 450 lb). */
export const PC12_CRUISE_ROWS = [
  { ft: 0, ktas: pct(229, 4, '47E-PROXY Fig 5-2-31: SL 229 KTAS at 10 400 lb'), fuelPph: pct(634, 10, '47E-PROXY Fig 5-2-31: SL 634 lb/h') },
  { ft: 8000, ktas: pct(247, 4, '47E-PROXY Fig 5-2-31: 8000 ft 247 KTAS at 10 400 lb'), fuelPph: pct(564, 10, '47E-PROXY Fig 5-2-31: 8000 ft 564 lb/h') },
  { ft: 12_000, ktas: pct(256, 4, '47E-PROXY Fig 5-2-31: 12 000 ft 256 KTAS at 10 400 lb'), fuelPph: pct(541, 10, '47E-PROXY Fig 5-2-31: 12 000 ft 541 lb/h'), ittC: below(760, 'TCDS: MCP ITT 760 C') },
] as const;
/** The other two pusher speeds, at the maxGross loading (10 450 lb), KCAS through PC12_AIR_DATA. */
export const PC12_PUSHER_FLAPS = [
  { flapDeg: 15, entryKt: 105, kcas: band(80, 3, '47E-PROXY Fig 5-2-1 CHART-READ: 78 KIAS (pusher), 10 450 lb') },
  { flapDeg: 30, entryKt: 98, kcas: band(72, 3, '47E-PROXY Fig 5-2-1 CHART-READ / DERIVED 77 / 1.1: 70 KIAS (pusher)') },
] as const;
/** Steady unbraked idle taxi at ground idle, over 300 s (plan 5.7 (a), (c)). */
export const PC12_TAXI = [
  { label: 'on the gate, ground idle', reverse: 0, speedKt: range(15, 30, 'ESTIMATE (plan 5.7 (a)): the reason the POH taxis in beta') },
  { label: 'half beta', reverse: GROUND_FINE / 2, speedKt: range(8, 12, '47E-PROXY 4.7 ("use the beta range to control taxi speed") / AGENT (plan 5.7 (c))') },
] as const;
/** Take-off roll with the rudder trim at zero (plan 5.7, AGENT). */
export const PC12_TAKEOFF_HEADING = {
  headingErrorDeg: below(5, 'AGENT (plan 5.7): heading held within 5 deg'),
  pedal: below(0.6, 'AGENT (plan 5.7): with no more than 0.6 of the pedal'),
};
/** Pusher at a 1 kt/s deceleration, flaps 40 (plan 5.7). */
export const PC12_PUSH = {
  // With the pilot's yoke held where it was at the trip, the push alone must drive the vane through its own reset
  // (1.5 deg below the trip, stickPusher.ts) within 1.5 s; with no actuator the AOA does not fall at all.
  heldAlphaOffDeg: range(1.5, Infinity, 'AGENT: the pusher reset, 1.5 deg below the trip (stickPusher.ts), reached by the push alone'),
  pitchDownDeg: range(8, 20, '47E-PROXY 5 p. 329 / ESTIMATE: the nose drops through the horizon'),
  heightLossFt: below(300, '47E-PROXY 5 p. 329: maximum altitude loss 300 ft at 1 kt/s'),
};
/** Approach, 3 deg path, Vref 85 KIAS, flaps 40, gear down, MLW: guards the flight-idle low-pitch stop (plan 5.1). */
export const PC12_APPROACH_TORQUE = range(8, 18, 'ESTIMATE (plan 5.7): torque on a 3 deg approach at Vref, flaps 40');
/** Start (47E-PROXY 4.5): one press of STARTER, the condition lever to GROUND IDLE at 13 % Ng. */
export const PC12_START_TARGETS = {
  peakIttC: range(650, 850, 'ESTIMATE (plan 5.7); limit 1000 C for 5 s (TCDS)'),
  cutoutNgPct: band(50, 1, '47E-PROXY 4.5, 7-10: the starter cuts out at 50 % Ng'),
  ng50WithinS: below(40, 'ESTIMATE (plan 5.7)'),
  idleNp: range(950, Infinity, 'TCDS C.III.6.7 / 47E 4.5: at least 950 rpm at ground idle'),
};

/**
 * The keyboard circuit (AGENT targets, plan 5.7): the pilot reads the torque gauge, psi. Climb at Vy 130, downwind and
 * base with flaps 15 at 125 / 115 KIAS, final flaps 40 at Vref + 5 (90) on about 13 psi, base leg 600 ft, the round-out
 * from 8 m with the PCL closed (the flaps-40 drag stops the float), the brakes as soon as the nosewheel is down (the
 * roll-out stays on the gate at FLIGHT IDLE: the input package's pilot has no beta yet; braking from 50 KIAS left
 * 2.3 km of roll, 0.21 g of nose-leg rocking and 12 m of drift in the crosswind). Fragile: flareM 7 crashes the
 * crosswind circuit (2.7 m/s at 88 KIAS) and 9 ends 8.8 m off the centreline; see KNOWN_ISSUES "Keyboard circuit".
 */
export const KEYBOARD_PILOT_TARGETS: Partial<PilotTargets> = {
  power: (s: AircraftState) => pc12TorquePsi(s.engines[0].torque),
  rotateKias: 82,
  climbKias: 130,
  downwindKias: 125,
  baseKias: 115,
  finalKias: 90,
  brakeKias: 80,
  rotatePitchDeg: 8,
  climbPitchDeg: 9,
  levelPitchDeg: 2,
  finalPitchDeg: -3,
  landingPitchDeg: 6,
  powerDownwind: 16,
  powerPattern: 13,
  powerBase: 12,
  powerFinal: 13,
  powerMin: 6,
  powerMax: 37,
  powerPerKt: 0.3,
  powerPerMetre: 0.25,
  powerBand: 1,
  baseFt: 500,
  baseTurnM: 3600,
  flareM: 8,
  throttleOffM: 4,
};
