// Lockheed AH-56A Cheyenne: the control gyro data, both configurations. Owner: AG (stage 2). Plan revision 2, section 7.2;
// docs/control-gyro-model.md has the equation, the senses, the fitted numbers and their sources.
//
// AGENT choice (not an owner decision): the AMCS ship 66-8832 (1973) is the default; the ICS 66-8834 (1972) is a runtime
// configuration of the same aircraft (URL config=ics, InitialConditions.rotorcraftConfig, persisted in the save).
import { DEG } from '../../core/math';
import type { ControlGyroConfig, ControlGyroDef } from '../../physics/rotorcraft/controlGyro';
import { AH56_AMCS_GYRO, AH56_AMCS_NR_FRACTION, AH56_COLLECTIVE_DEG, AH56_ICS_BLADE, AH56_ICS_GYRO, AH56_NR_100, AH56_STICK_IN } from './facts';

const IN = 0.0254;
const OMEGA_100 = AH56_NR_100 * Math.PI / 30;
/** The ICS input rotation the model flies, deg advanced (fitted to G8; P 36). */
export const ICS_INPUT_ROTATION_DEG = 13;
/** The AMCS input rotation, deg advanced (fitted to G8). */
// Stage 5 (AH handover, docs/ah56-high-speed.md section 5.1): 9 -> 5 deg with the lateral stick moment 975 -> 907 N m (below) and
// AC's K_R / longitudinal refit: G8 AMCS p/q 0.095 / 0.187 (<= 0.2) against C9's 0.498 in lateral trim at 190 KCAS (<= 0.5).
export const AMCS_INPUT_ROTATION_DEG = 5;

/**
 * ICS 1972 (P ASTA-72 App C pp 57-60 unless tagged): the 45 slug-ft^2 gyro X turning with the rotor (INF: a "main rotor
 * gyro drive torque" is instrumented, App H p 87), +/-15 deg; 278 / 337 ft-lb per inch over 5.5 / 3.75 in of stick each
 * side (11.0 x 7.5 in); 4100 ft-lb/rad net spring; 2 x 44 in-lb/(rad/s) per axis; feathering-moment feedback through
 * 4 deg of forward sweep and 3 deg 10 min of droop (p 49), the blade pitching moments in full (INF: "the entire blade
 * feathering moments were transmitted", Hoh-74), 28 ft-lb of feather-bearing friction. Input rotation 36 deg advanced
 * and cant 33 deg (P), applied as the residual turns beyond the linkages' 90 deg (docs: "Senses").
 */
export const AH56_ICS_CONFIG: ControlGyroConfig = {
  inertia: AH56_ICS_GYRO.inertia, spinRatio: 1,
  maxTilt: { up: AH56_ICS_GYRO.maxTiltDeg * DEG, down: AH56_ICS_GYRO.maxTiltDeg * DEG,
    left: AH56_ICS_GYRO.maxTiltDeg * DEG, right: AH56_ICS_GYRO.maxTiltDeg * DEG },
  stickTravel: { longitudinal: AH56_STICK_IN.ics.longitudinal / 2 * IN, lateral: AH56_STICK_IN.ics.lateral / 2 * IN },
  stickMoment: { longitudinal: AH56_ICS_GYRO.momentPerInch.longitudinal * AH56_STICK_IN.ics.longitudinal / 2,
    lateral: AH56_ICS_GYRO.momentPerInch.lateral * AH56_STICK_IN.ics.lateral / 2 },
  spring: AH56_ICS_GYRO.spring,
  damping: AH56_ICS_GYRO.dampingPerAxis,
  // The 28 ft-lb feather-bearing friction (P) as rotating damping (CR-114362 App A's C_R), its describing-function
  // equivalent 4 F / (pi Omega A) at a 5 deg cyclic amplitude: 4 x 38.0 / (pi x 25.76 x 0.0873) = 21.5 N m s/rad (D).
  rotatingDamping: 4 * AH56_ICS_GYRO.frictionMoment / (Math.PI * OMEGA_100 * 5 * DEG),
  // Feedback: the P cant, 33 deg advanced (the best-damped auto-trim phase of the model, docs "Senses"). Input: FITTED to
  // G8 (pure longitudinal stick, roll rate within 20 % of pitch rate): 13 deg advanced; the P 36 deg gives about 1.6 deg/s
  // of roll per deg/s of pitch in this model (docs: "Input rotation").
  inputRotation: ICS_INPUT_ROTATION_DEG * DEG, feedbackRotation: AH56_ICS_GYRO.cantDeg * DEG,
  cyclicPerTilt: 1,
  feedback: { mode: 'featheringMoment', sweep: AH56_ICS_BLADE.sweepDeg * DEG, droop: AH56_ICS_BLADE.droopDeg * DEG,
    pitchingMomentGain: 1, frictionMoment: AH56_ICS_GYRO.frictionMoment },
  augmentation: {
    // P: zero gain at <= 100 kt, full (twice the stick per response) at 170 kt; authority 0.757 in.
    pitchDesensitizer: { gainByKcas: { x: [100, 170], y: [1, 0.5] }, authority: 0.757 * IN },
    // P: zero gain to 110 kt, full at 200 kt; roll-rate signal saturating at 30 deg/s; the same 0.757 in piston.
    decoupler: { gainByKcas: { x: [110, 200], y: [0, 1] }, rollRateLimit: 30 * DEG, authority: 0.757 * IN },
    // P: hover to 80 KCAS, +/-0.329 in; gain ESTIMATE (full authority at 20 deg/s of roll rate).
    rollCompensator: { gainByKcas: { x: [80, 90], y: [1, 0] }, stickPerRate: 0.329 * IN / (20 * DEG), authority: 0.329 * IN },
  },
  nominalRpmFraction: 1,
  collectiveIndicatedOffset: 0,
};

/**
 * AMCS 1973 (P AMCS-73 App C pp 29-30 unless tagged): the 1.5 slug-ft^2, 26 in gyro below the transmission, its momentum
 * fixed at the ICS value (ESTIMATE, plan 7.2: geared to about 7,400 rpm); labelled tilt stops up 10.11, down 18.05, right
 * 12.27, left 18.08 deg read as blade cyclic (SSL gain 1, plan G5a); 9.9 x 5.8 in of stick; irreversible servos (no
 * feathering-moment path) and first-harmonic flapping fed back through springs. FITTED to the measured 6 / 9 deg/s/in
 * pitch and 16 deg/s/in roll (P AMCS-73 paras 33-34; Hoh-74): the stick moments and K_R only (docs: "AMCS fit"). The
 * positive spring, the negative spring that partly cancels it and the rotating damping (Hohenemser's slow alignment) are
 * ESTIMATES.
 */
export const AH56_AMCS_CONFIG: ControlGyroConfig = {
  inertia: AH56_AMCS_GYRO.inertia,
  spinRatio: AH56_ICS_GYRO.inertia * OMEGA_100 / (AH56_AMCS_GYRO.inertia * AH56_AMCS_NR_FRACTION * OMEGA_100),
  maxTilt: { up: AH56_AMCS_GYRO.stopsDeg.up * DEG, down: AH56_AMCS_GYRO.stopsDeg.down * DEG,
    left: AH56_AMCS_GYRO.stopsDeg.left * DEG, right: AH56_AMCS_GYRO.stopsDeg.right * DEG },
  stickTravel: { longitudinal: AH56_STICK_IN.amcs.longitudinal / 2 * IN, lateral: AH56_STICK_IN.amcs.lateral / 2 * IN },
  stickMoment: { longitudinal: 811, lateral: 907 },
  spring: AH56_ICS_GYRO.spring, negativeSpring: 4500,
  damping: AH56_ICS_GYRO.dampingPerAxis, rotatingDamping: 0.4,
  // No AMCS angles are published: the feedback at the model's best-damped auto-trim phase, 20 deg advanced (ESTIMATE, docs
  // "Senses"); the input FITTED to G8 (pure longitudinal stick, roll within 20 % of pitch).
  inputRotation: AMCS_INPUT_ROTATION_DEG * DEG, feedbackRotation: 20 * DEG,
  cyclicPerTilt: 1,
  feedback: { mode: 'flapping', gain: 7500 },
  augmentation: {
    // P sense (trim aft as speed rises); ESTIMATE amounts: 0.3 in forward at the hover to 0.3 in aft at 180 KCAS.
    trimSchedule: { offsetByKcas: { x: [0, 180], y: [-0.3 * IN, 0.3 * IN] } },
    // P: gain 0 to 40 kt, full at 60 kt; 0.5 in of lateral stick at 12.5 deg of sideslip, saturating there.
    sideslipSas: { gainByKcas: { x: [40, 60], y: [0, 1] }, stickPerRad: 0.5 * IN / (12.5 * DEG), authority: 0.5 * IN },
  },
  nominalRpmFraction: AH56_AMCS_NR_FRACTION,
  collectiveIndicatedOffset: AH56_COLLECTIVE_DEG.amcsOffset * DEG,
};

export const AH56_GYRO: ControlGyroDef | undefined = { default: 'amcs', configs: { amcs: AH56_AMCS_CONFIG, ics: AH56_ICS_CONFIG } };
