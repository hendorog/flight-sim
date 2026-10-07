// Piper PA-34-200 Seneca I (4200 lb): the targets of contract section 5.4, each with its source in the type's data
// sheet (aircraft-data/pa34.md in the design work folder, which quotes the AFM VB-423, the owner's handbook OH-1 /
// OH-2 / OH-6 / OH-8 and TCDS A7SO). The manuals give speeds in mph CAS; contract 5.4 converts them to knots CAS.
// Bands are the contract's default ones (5 intro) unless 5.4 states its own. Sweeps and entries are KTAS, the stall
// speeds and the twin speeds KCAS.

import { FT } from '../../../src/core/math';
import type { AircraftState } from '../../../src/core/types';
import type { PilotTargets } from '../../input/keyboardPilot';
import { above, band, below, pct, range, type ConformanceTargets } from '../targets';

/** Propeller lever for a governed rpm (1700 at the feather gate, 2700 at the stop; aircraft/pa34/powerplant.ts). */
const propellerFor = (rpm: number) => 0.08 + (0.92 * (rpm - 1700)) / 1000;

export const PA34_TARGETS: ConformanceTargets = {
  aircraft: 'pa34',
  stall: {
    // AFM, OH-1 (s.8): 76 mph CAS (66 kt) gear down flaps up, 69 mph (60 kt) gear and flaps down, power off, 4200 lb.
    // Electric horn 5-10 mph (4-9 kt) ahead (s.11).
    clean: { flapDeg: 0, entryKt: 90, vs1gKcas: band(66, 3, 'AFM, OH-1 (s.8), contract 5.4'), warningMarginKt: range(4, 9, 'horn 5-10 mph before the stall (s.11)') },
    landing: { flapDeg: 40, entryKt: 82, vs1gKcas: band(60, 3, 'AFM, OH-1 (s.8), contract 5.4'), warningMarginKt: range(4, 9, 'horn 5-10 mph before the stall (s.11)') },
  },
  // 1.3 x 64 KIAS (Vs1); contract 3.1.
  stallRecovery: { entryKias: 83, recoveryS: below(4, 'contract 3.1 stall recovery') },
  climb: {
    range: { fromKt: 80, toKt: 115 },
    rocFpm: pct(1360, 10, 'OH-1 (s.8): 1360 ft/min at 105 mph, 4200 lb; contract 5.4'),
    vyKias: band(91, 7, 'OH-1 (s.8): Vy 105 mph; contract 5 intro (+/-7 kt)'),
  },
  maxLevel: { bracketKt: [150, 190], ktas: pct(170, 4, 'OH-1 (s.8): 195.3 mph; contract 5.4') },
  cruise: {
    // 75 % at 6000 ft: full throttle there at 2400 rpm (OH-8, s.4); 186.3 mph TAS (s.8).
    altitudeFt: 6000,
    powerFraction: 0.75,
    bracketKt: [140, 185],
    leanAtKt: 160,
    resetKt: 160,
    ktas: pct(162, 5, 'OH-1, OH-8 (s.8): 186.3 mph TAS; contract 5.4'),
    powerFractionReached: band(0.75, 0.005, 'the measurement holds 75 %'),
  },
  staticRun: {
    rpm: range(2650, 2700, 's.5 (estimate, weak), contract 5.4: governed'),
    mapInHg: range(28, 29.5, 's.4 (estimate, weak), contract 5.4'),
    groundSpeed: below(0.05, 'parking brake holds'),
  },
  // Short field, flaps 25: full power against the brakes, rotate 70 mph (61 kt) (s.10; OH-1: 800 ft ground roll).
  takeoff: { flapDeg: 25, rotateKias: 61, pitchDeg: 8, staticRunUp: true, groundRollM: pct(244, 15, 'OH-1 (s.8): 800 ft, short field, flaps 25; contract 5.4') },
  // Flaps 40, approach 87 mph (76 kt), touchdown about 67 mph, heavy braking (OH-1, OH-8: 705 ft at 4000 lb; the
  // block lands at 4200 lb, about 3 % longer). Brakes as the chart implies (DECISIONS-D2: a conservative chart).
  landing: { flapDeg: 40, approachKt: 76, touchdownPitchDeg: 6, brake: 0.6, groundRollM: pct(215, 15, 'OH-1, OH-8 (s.8): 705 ft at 4000 lb; contract 5.4') },
  glide: {
    range: { fromKt: 75, toKt: 115 },
    propeller: 'feathered',
    // Not published: "roughly 10 : 1 feathered (range 8.5-11)" (s.8 verification note).
    ratio: band(9.75, 1.25, 's.8 estimate (weak): 8.5-11 feathered'),
    bestKias: pct(91, 15, 'school checklist 105 mph (s.8); a flat optimum (contract 5 intro)'),
    at: { kias: 91, ratio: band(9.75, 1.25, 's.8 estimate (weak): 8.5-11 feathered') },
  },
  trim: {
    // The envelope (flaps as lever positions): final with full flap, base with 25, the Vy climb, the circuit, the
    // cruise at altitude and below, a cruise descent and both engines dead.
    cases: [
      { kt: 84, flaps: 1, fpaDeg: -3 },
      { kt: 93, flaps: 25 / 40 },
      { kt: 95, fpaDeg: 6 },
      { kt: 102 },
      { kt: 160, ftAboveField: 6000 },
      { kt: 150, ftMsl: 8000 },
      { kt: 140, fpaDeg: -3 },
      { kt: 95, engineRunning: false },
    ],
    maxResidual: 1e-5,
    maxRateDegS: 0.2,
    wheel: { kt: 145, maxWheel: 1, maxBall: 0.05 },
    impossibleClimb: { kt: 95, fpaDeg: 15, maxFpaDeg: 9 },
  },
  handsOff: {
    kt: 145,
    ftAboveField: 3000,
    seconds: 60,
    altDriftM: below(15, 'contract 3.10 generic block (the C172S bands)'),
    headingDriftDeg: below(3, 'contract 3.10 generic block'),
    maxVsFpm: below(50, 'contract 3.10 generic block'),
    tasChangeMps: below(0.5, 'contract 3.10 generic block'),
  },
  ground: {
    restHeightM: band(1.1, 0.03, 'geometry.restHeight; contract 5 intro (3 cm)'),
    idleRpm: range(550, 750, 's.4: about 600-700 rpm (estimate)'),
    parkedDriftMm: below(5, 'contract 3.10 generic block'),
    parkedRateDegS: below(0.05, 'contract 3.10 generic block'),
    taxi: {
      meanSteer: range(-0.3, 0.3, 'contract 3.10 generic block'),
      maxHeadingErrorDeg: below(2, 'contract 3.10 generic block'),
      speedKt: band(10, 1, 'the taxi measurement holds 10 kt'),
      // 21 degrees of nosewheel on a 2.13 m wheelbase: 5.6 m about the reference point (SM: 19.5 ft at the nose wheel).
      radiusM: range(4.5, 7, 'nosewheel 21 deg (TCDS), SM turning radius 19.5 ft (s.2.4, s.3)'),
      maxYawAccelDegS2: below(5, 'contract 3.10 generic block'),
    },
  },
  yaw: {
    ftAboveField: 3000,
    resetKt: 95,
    climbKias: 91,
    // Counter-rotation (s.1): no rudder for zero sideslip with both engines at full power (contract 5.4).
    climb: range(-0.04, 0.04, 'counter-rotation: "under 0.04 of travel" (contract 5.4)'),
    throttle: 1,
    steep: { kias: 78, rudder: range(-0.04, 0.04, 'counter-rotation (contract 5.4)') },
    cruise: { kias: 150, rudder: range(-0.04, 0.04, 'counter-rotation (contract 5.4)') },
  },
  systems: {
    // DSU checklist (s.10): at 2000 rpm, normal drop 100, at most 175, difference at most 50.
    magnetoDrop: { rpm: 2000, drop: range(25, 175, 'DSU checklist (s.10), contract 5.4'), difference: range(0, 50, 'DSU checklist (s.10)') },
    // OH-2: 6 to 7 s either way (contract 5.4: 5.5-7.5 s).
    gearTransit: { kias: 100, up: range(5.5, 7.5, 'OH-2 (s.3), contract 5.4'), down: range(5.5, 7.5, 'OH-2 (s.3), contract 5.4') },
    // OH-8 chart (weak): 1180 ft/min gear down against 1460 clean at 4000 lb, at the gear-down Vy of 92 mph (80 kt).
    gearDownClimb: { kcas: 80, lossFpm: range(190, 370, 'OH-8 chart (s.8, weak), contract 5.4') },
  },
  twin: {
    criticalEngine: 'none',
    // TCDS, AFM (s.7): Vmc 80 mph, Vyse 105 mph.
    vmcaKcas: 69,
    vyseKcas: 91,
    pedalAt110Vmca: range(0.55, 0.9, 'pedal ~ 1 / V^3 from Vmca 69 (contract 5.4)'),
    pedalAtVyse: range(0.3, 0.65, 'pedal ~ 1 / V^3 from Vmca 69 (contract 5.4)'),
    vmca: band(69, 5, 'TCDS, AFM (s.7): 80 mph; contract 5.4: 64-74 if rudder-limited'),
    sides: { vmcaKt: 1, pedal: 0.03, source: 'counter-rotation: the two sides are equal (contract 5.4)' },
    oeiClimb: [
      { altitudeFt: 0, fpm: band(190, 70, 'OH-1 (s.8): 190 ft/min, feathered, 4200 lb; contract 5.4') },
      { altitudeFt: 5000, fpm: band(0, 60, 'OH-1 (s.8): absolute ceiling 5000 ft; contract 5.4') },
    ],
    oeiThrottle: 1,
    // The live engine's cowl flap open, the dead one's closed (s.10, "securing the dead engine").
    oeiCowlFlaps: { leftFailed: [0, 1], rightFailed: [1, 0] },
    windmillingLossFpm: range(150, 450, 's.8 estimate (weak): 200-350 ft/min; contract 5.4'),
    // The dead engine at 11 inHg and 2000 rpm (DSU, LEA, s.8): the climb as feathered.
    // Lever 0.1357 is 11.0 inHg at 2000 rpm, 91 KCAS, sea level (0.2 was 16.5 inHg). The model's zero-thrust point is
    // 8.4 inHg there, so 11 inHg gives +188 ft/min against feathered. Lead's ruling on D-D-pa34-phys-01: the 11 inHg
    // figure is a school rule of thumb, not a handbook datum (weak); engine power and propeller agree with the cruise
    // table and the blade-element solver there, so the band is widened to 250 ft/min rather than the model tuned.
    zeroThrust: { controls: { throttle: 0.1357, propeller: propellerFor(2000) }, withinFpm: 250, source: 'DSU, LEA (s.8): 11 inHg, 2000 rpm, school practice (weak, lead D-D-pa34-phys-01); contract 5.4' },
    // Windmilling, wings level at Vmca + 5 kt and 3400 ft the Seneca I cannot hold its height (D-D-pa34-phys-02):
    // s.8 windmilling at Vyse, sea level, -50 to -150 ft/min, less about 40 ft/min per 1000 ft (OH-1: 190 -> 0 at 5000 ft).
    engineCut: {
      maxHeadingChangeDeg: below(30, 'behaviour check: recoverable at Vmca + 5 kt (contract 3.10)'),
      source: 'contract 3.10',
      minVerticalSpeedFpm: above(-300, 's.8 windmilling at sea level, OH-1 ceiling slope (D-D-pa34-phys-02)'),
    },
  },
};

/** Fuel flow per engine at the 75 % cruise, 6000 ft (OH-1, OH-8: 10.3 US gal/h; contract 5.4 +/-10 %). */
export const PA34_CRUISE_FUEL_GPH = pct(10.3, 10, 'OH-1, OH-8 (s.4, s.8), contract 5.4');
/** Rest attitude and propeller clearance (s.2.4: about 0.23 m, estimate +/-0.08). */
export const PA34_REST = {
  pitchDeg: range(-1.5, 1.5, 'the cabin level at rest (levelling points, WB; s.6)'),
  propClearanceM: band(0.23, 0.05, 's.2.4: about 0.23 m (estimate)'),
};
/** Hands-off full-power take-off roll: no swing (counter-rotation; contract 5.4: under 2 deg in 10 s). */
export const PA34_TAKEOFF_SWING_DEG = below(2, 'counter-rotation: no swing (contract 5.4)');
/** Feathering time from the governed range to the feather stop, s (OH-2: about 6 s; contract 5.4 4-8 s). */
export const PA34_FEATHER_S = range(4, 8, 'OH-2 (s.5), contract 5.4');
/** Gear horn: manifold pressure at the throttle microswitch, sea level, 2000 rpm (OH-2: 14 inHg; contract 5.4 13-15). */
export const PA34_HORN_INHG = range(13, 15, 'OH-2, s.9 (throttle microswitch), contract 5.4');
/** Propeller exercise at 2000 rpm: lever to the low end (DSU checklist: 200-300 rpm drop; contract 5.4). */
export const PA34_PROP_EXERCISE_RPM = range(200, 300, 'DSU checklist (s.10), contract 5.4');
/** One-engine trim at Vyse, feathered: the rudder trim holds the pedal (OH-2 "essential"; contract 5.4: under 100 %). */
export const PA34_OEI_RUDDER_TRIM = range(0, 1, 'OH-2 (s.9): rudder trim essential for one-engine flight; contract 5.4');
/** Cylinder heads in a Vy climb, cowl flaps closed against open, C (contract 5.4 model check: at least 15 C hotter). */
export const PA34_COWL_CHT_C = above(15, 'contract 5.4 model check');
/** The A-key hold (heading and altitude, yaw damper on) for 60 s at 120 KIAS: the rudder steady and the speed held. */
export const PA34_HOLD = {
  meanRudder: range(0, 0.15, 'yaw damper steady (the C172S 0.13)'),
  maxSideslipDeg: range(0, 1, 'ball near the centre'),
  speedLossKt: range(-2, 2, 'speed held at a fixed throttle'),
};
/** Altitude of the fuel-flow check, m. */
export const PA34_CRUISE_ALT = 6000 * FT;

/**
 * The keyboard pilot's settings (keyboardTargets.ts: the keyboardCircuit block and fly-keyboard.mjs). A constant-speed
 * twin is flown on MANIFOLD PRESSURE (inHg x 100 on the pilot's power scale), both throttles together; the gear stays
 * down through the circuit (the keyboard pilot does not work the gear; the school lowers it mid-downwind, s.11).
 * Settings from the school's syllabus (s.11) with this model's trims in brackets: downwind 18 inHg at 100 KIAS, 13
 * inHg from abeam the threshold (the syllabus's 15 holds the Seneca level with the gear down and 10 degrees of flap:
 * with it the aircraft reached base 800 ft up and dived the final), base at 600 ft after a downwind 1800 m past the
 * threshold, final at 76 KIAS (87 mph, the short-field figure, s.10: from the 95 mph final the round-out ballooned
 * 10 m and floated a kilometre), 14 inHg on the glide path, the throttles closed 2 m up ("heavy pull in the flare",
 * s.11: closed at 5-12 m the Seneca with full flap sank onto the runway at 1.9-2.4 m/s), landed about 7 degrees
 * nose-up.
 */
export const KEYBOARD_PILOT_TARGETS: Partial<PilotTargets> = {
  power: (s: AircraftState) => 100 * s.engines[0].manifoldPressure,
  finalKias: 76,
  powerDownwind: 1800,
  powerPattern: 1300,
  powerBase: 1300,
  powerFinal: 1400,
  powerMin: 1000,
  powerMax: 2900,
  powerPerKt: 25,
  powerPerMetre: 10,
  powerBand: 40,
  climbPitchDeg: 8,
  levelPitchDeg: 1.5,
  finalPitchDeg: -3,
  landingPitchDeg: 7,
  baseFt: 600,
  baseTurnM: 1800,
  throttleOffM: 2,
};
