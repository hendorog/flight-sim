// Gyroscopic flight instruments: vacuum attitude indicator, vacuum heading indicator (directional gyro)
// and the electric turn coordinator with its inclinometer.

import { DEG, clamp, wrapPi, wrapTwoPi, type Vec3 } from '../../core/math';
import { lagStep, SecondOrder } from './filters';
import { GyroRotor, SUCTION_RATED_INHG } from './gyro';

/**
 * Vacuum-driven attitude indicator. A rigid rotor holds its axis in space, so the horizon card follows
 * every attitude change of the case; as rigidity fades (vacuum lost, engine stopped) the card is dragged
 * along with the case instead and sags onto its gimbal stops. Separately, the pendulous-vane erection
 * mechanism slowly drives the spin axis toward the APPARENT vertical (the specific-force vector) at a few
 * degrees per minute, which reproduces the classic small turn and acceleration errors.
 */
export class AttitudeIndicator {
  static readonly ERECTION_RATE = (6 * DEG) / 60; // rad/s, typical 6 deg/min
  /** Where the card comes to rest with the rotor stopped (display attitude, rad). */
  static readonly REST_ROLL = -17 * DEG;
  static readonly REST_PITCH = -8 * DEG;
  /** Rate at which the unsupported card falls to rest, 1/s. */
  private static readonly TOPPLE_RATE = 0.6;

  readonly rotor: GyroRotor;
  /** Displayed bank and pitch, rad. */
  roll: number;
  pitch: number;
  private lastRoll = NaN;
  private lastPitch = NaN;

  constructor(
    spunUp = true,
    /** Suction at which the rotor reaches rated speed, inHg. */
    private readonly ratedInHg = SUCTION_RATED_INHG,
  ) {
    // Air-driven rotors reach speed in about a minute and coast for several minutes.
    this.rotor = new GyroRotor(25, 180, spunUp ? 1 : 0);
    // A running gyro picks up the true attitude on the first step; a stopped one starts at rest.
    this.roll = spunUp ? NaN : AttitudeIndicator.REST_ROLL;
    this.pitch = spunUp ? NaN : AttitudeIndicator.REST_PITCH;
  }

  /**
   * @param specificForce body-axis specific force in g (AircraftState.specificForce)
   */
  step(dt: number, trueRoll: number, truePitch: number, specificForce: Vec3, suctionInHg: number): void {
    if (Number.isNaN(this.roll)) {
      this.roll = trueRoll;
      this.pitch = truePitch;
    }
    if (Number.isNaN(this.lastRoll)) {
      this.lastRoll = trueRoll;
      this.lastPitch = truePitch;
    }
    this.rotor.step(dt, suctionInHg / this.ratedInHg);
    const r = this.rotor.rigidity;

    // Rigid fraction of the attitude change shows on the card.
    this.roll += wrapPi(trueRoll - this.lastRoll) * r;
    this.pitch += (truePitch - this.lastPitch) * r;
    this.lastRoll = trueRoll;
    this.lastPitch = truePitch;

    // Erection toward the apparent vertical, only while the rotor is spinning.
    const sf = specificForce;
    const sfMag = Math.hypot(sf.x, sf.y, sf.z);
    if (sfMag > 0.3 && r > 0) {
      // Attitude relative to the apparent vertical: gravity in body axes is (-sin t, sin p cos t, cos p cos t),
      // and the specific force in unaccelerated flight is its negative.
      const apparentRoll = Math.atan2(-sf.y, -sf.z);
      const apparentPitch = Math.asin(clamp(sf.x / sfMag, -1, 1));
      const maxStep = AttitudeIndicator.ERECTION_RATE * r * dt;
      this.roll += clamp(wrapPi(apparentRoll - this.roll), -maxStep, maxStep);
      this.pitch += clamp(apparentPitch - this.pitch, -maxStep, maxStep);
    }

    // Without rigidity the card falls to its rest pose against the gimbal stops.
    const k = 1 - Math.exp(-AttitudeIndicator.TOPPLE_RATE * (1 - r) * dt);
    this.roll += wrapPi(AttitudeIndicator.REST_ROLL - this.roll) * k;
    this.pitch += (AttitudeIndicator.REST_PITCH - this.pitch) * k;

    this.roll = wrapPi(this.roll);
    this.pitch = clamp(this.pitch, -80 * DEG, 80 * DEG);
  }
}

/**
 * Vacuum-driven heading indicator (directional gyro). It has no magnetic sense: the card simply follows
 * heading changes while the rotor is rigid and wanders slowly because of bearing friction and the
 * earth's rotation (15.04 deg/h * sin(latitude), ~11 deg/h at 46.5 N; with a latitude nut and bearing
 * drift the net apparent wander is a few degrees per 15 minutes). The pilot periodically realigns it to
 * the compass with `align()`. With the rotor stopped the card no longer turns with the aircraft.
 */
export class HeadingIndicator {
  /** Net apparent drift, rad/s (+ = card reads high). 12 deg/h = 3 deg per 15 min. */
  static readonly DRIFT_RATE = (12 * DEG) / 3600;

  readonly rotor: GyroRotor;
  /** Displayed heading, rad [0, 2PI). */
  heading = 0;
  /** Heading bug, rad. */
  bug = 0;
  private lastTrue = NaN;

  constructor(
    spunUp = true,
    /** Suction at which the rotor reaches rated speed, inHg. */
    private readonly ratedInHg = SUCTION_RATED_INHG,
  ) {
    this.rotor = new GyroRotor(25, 180, spunUp ? 1 : 0);
  }

  /** Set the card to the given heading (the pilot turning the knob to match the compass). */
  align(heading: number): void {
    this.heading = wrapTwoPi(heading);
    this.lastTrue = heading;
  }

  step(dt: number, trueHeading: number, suctionInHg: number): void {
    this.rotor.step(dt, suctionInHg / this.ratedInHg);
    if (Number.isNaN(this.lastTrue)) this.align(trueHeading);
    const r = this.rotor.rigidity;
    const turn = wrapPi(trueHeading - this.lastTrue);
    this.lastTrue = trueHeading;
    // Precession from friction torque grows as rotor speed falls (precession rate = torque / (I * omega)).
    const drift = (HeadingIndicator.DRIFT_RATE / Math.max(this.rotor.spin, 0.25)) * r;
    this.heading = wrapTwoPi(this.heading + turn * r + drift * dt);
  }
}

/**
 * Electric turn coordinator. The rotor's spin axis is canted ~30 degrees nose-up about the longitudinal
 * axis, so the gimbal precesses with both yaw rate and roll rate: signal = r + p * tan(30 deg), scaled so a
 * standard-rate (3 deg/s) coordinated turn puts the wingtip on the index mark. The damping dashpot gives a
 * short lag. The inclinometer ball is a second-order follower of the physics slip indication.
 */
export class TurnCoordinator {
  static readonly CANT = 30 * DEG;
  static readonly STANDARD_RATE = 3 * DEG;

  readonly rotor: GyroRotor;
  /** Turn rate in standard-rate units (1 = wingtip on the L/R index), clamped at the stops (+/-2). */
  rate = 0;
  /** Ball deflection -1..1 (+ = right). */
  get ball(): number {
    return this.ballFilter.value;
  }
  /** Power-failure flag visible. */
  flag = true;
  private readonly ballFilter = new SecondOrder(7, 0.55);

  constructor(spunUp = true) {
    // Small DC motor: up to speed in seconds, coasts for about a minute.
    this.rotor = new GyroRotor(4, 60, spunUp ? 1 : 0);
    this.flag = !spunUp;
  }

  /**
   * @param p body roll rate, rad/s
   * @param r body yaw rate, rad/s
   * @param slipBall AircraftState.slipBall
   * @param powered DC bus powered (and the TC breaker in)
   */
  step(dt: number, p: number, r: number, slipBall: number, powered: boolean): void {
    this.rotor.step(dt, powered ? 1 : 0);
    // Precession torque (and so gimbal deflection against the centring spring) scales with rotor speed.
    const signal = ((r + p * Math.tan(TurnCoordinator.CANT)) / TurnCoordinator.STANDARD_RATE) * this.rotor.spin;
    this.rate = clamp(lagStep(this.rate, signal, dt, 0.3), -2, 2);
    this.ballFilter.step(dt, clamp(slipBall, -1, 1));
    // The flag is a voltage-sensing solenoid: in view whenever the instrument is unpowered.
    this.flag = !powered;
  }
}
