// Keyboard-driven virtual yoke: turns on/off key state into control positions, FSX/MSFS style.
//
// The keyboard yoke HOLDS POSITION: a held key moves the control at a rate, and releasing the key leaves it
// where it is (as a pilot's hand stays where it put the yoke). Numpad 5 / 5 centres aileron, elevator and
// rudder (InputSystem animates the return). The rate is non-linear in the time the key has been held: it
// starts slow, so a tap is a fine adjustment of a few thousandths of travel near the current position, and
// accelerates while the key stays down (quadratically over `accelTime`), so a long hold makes a big change.
//
// The travel a key can reach shrinks with airspeed because control power grows with dynamic pressure, and
// rates are expressed in units of that limit, so a given hold time makes about the same manoeuvre at every
// speed. The limit only stops a key from driving the control further out: a position set at a lower speed is
// held as it is (the pilot's hand does not move on its own).
//
// The tuning belongs to the aircraft type (InputProfile.assists, KeyboardAssistTuning). The Cessna 172S numbers,
// tuned against the real C172 flight model (tests/input/keyboardFlight.test.ts; they are in README.md), are in
// aircraft/c172s/input.ts and are the defaults here: the constants below that name them are that type's.
// Pure logic, no DOM; unit-tested in tests/input.

import { C172S_INPUT } from '../aircraft/c172s/input';
import { clamp, wrapPi } from '../core/math';
import type { KeyboardAssistTuning } from './profile';

export interface KeyAxisTuning {
  /** Rate at the instant a key goes down, in units of the current deflection limit per second (fine taps). */
  baseRate: number;
  /** Rate after the key has been held for `accelTime`, limit units per second. */
  maxRate: number;
  /** Time over which the rate builds from baseRate to maxRate, s. */
  accelTime: number;
  /** Shape of the build-up: rate = base + (max - base) * (t / accelTime)^accelExponent. */
  accelExponent: number;
  /** Rate multiplier when the key moves the control back toward centre. */
  reverseGain: number;
  /** Indicated airspeed below which full deflection is available, m/s. */
  fullAuthoritySpeed: number;
  /**
   * How the limit falls above fullAuthoritySpeed: (Vfull / V)^exponent. 1 keeps the roll/yaw RATE per key
   * constant (roll damping grows with V); 2 keeps the pitch LOAD FACTOR per key constant (lift grows with V^2).
   */
  authorityExponent: number;
  /** Lowest deflection limit at high airspeed. */
  minAuthority: number;
  /** Limit for negative deflection relative to positive (yoke forward: pushing to negative g is rarely wanted). */
  negativeScale: number;
}

/** The Cessna 172S key axis tuning. */
export const KEY_AXIS_TUNING = C172S_INPUT.assists.axes;

/**
 * Elevator key rate while a main wheel is on the ground, relative to the air: pivoting on the mains the
 * aircraft has no flight-path pitch damping, so the same yoke movement pitches the nose about twice as fast
 * as in the air; a held key rotates at a normal ~5-7 deg/s with this.
 */
export const GROUND_ELEVATOR_RATE = C172S_INPUT.assists.groundElevatorRate;

/** The elevator key tuning on the mains (slower rates, same limits). */
export function groundElevatorTuning(elevator: KeyAxisTuning, groundRate: number): KeyAxisTuning {
  return {
    ...elevator,
    baseRate: elevator.baseRate * groundRate,
    maxRate: elevator.maxRate * groundRate,
  };
}

/** The Cessna 172S elevator key tuning on the mains. */
export const GROUND_ELEVATOR_TUNING: KeyAxisTuning = groundElevatorTuning(KEY_AXIS_TUNING.elevator, GROUND_ELEVATOR_RATE);

/** Deflection limit available from the keyboard at a given indicated airspeed. */
export function keyAuthority(ias: number, t: KeyAxisTuning): number {
  if (ias <= t.fullAuthoritySpeed) return 1;
  return clamp(Math.pow(t.fullAuthoritySpeed / ias, t.authorityExponent), t.minAuthority, 1);
}

/** Key rate after holding for `heldTime` s, in limit units per second (before the reverse gain). */
export function keyRate(t: KeyAxisTuning, heldTime: number): number {
  const f = clamp(heldTime / t.accelTime, 0, 1);
  return t.baseRate + (t.maxRate - t.baseRate) * Math.pow(f, t.accelExponent);
}

/**
 * Advance one keyboard axis (hold-position).
 * @param value     current deflection [-1, 1] relative to neutral
 * @param direction -1, 0 or +1 from the keys currently held (0: the control stays where it is)
 * @param ias       indicated airspeed, m/s
 * @param heldTime  how long the current key has been held, s (default: long enough for full rate)
 */
export function stepKeyAxis(value: number, direction: number, ias: number, dt: number, t: KeyAxisTuning, heldTime = Infinity): number {
  if (dt <= 0 || direction === 0) return value;
  const limit = keyAuthority(ias, t) * (direction < 0 ? t.negativeScale : 1);
  const target = direction * limit;
  // Already at or beyond the limit in this direction (set at a lower airspeed): hold it there.
  if ((target - value) * direction <= 0) return value;
  const towardCentre = value * direction < 0;
  // Integrate the rate over the frame (heldTime is the time at the end of the frame) so a tap is frame-rate independent.
  const t0 = Math.max(0, heldTime - dt);
  const rate = 0.5 * (keyRate(t, t0) + keyRate(t, heldTime));
  const step = rate * limit * dt * (towardCentre ? t.reverseGain : 1);
  if (Math.abs(target - value) <= step) return target;
  return value + direction * step;
}

/** Recentring rate of the keyboard yoke (Numpad 5 / 5), travel per second: centre from full travel in 0.25 s. */
export const CENTRE_RATE = 4;

/** Move a keyboard deflection toward zero at the recentring rate. */
export function stepCentre(value: number, dt: number): number {
  const step = CENTRE_RATE * dt;
  return Math.abs(value) <= step ? 0 : value - Math.sign(value) * step;
}

/**
 * Rate for held "lever" keys (throttle, mixture, trim, knobs): starts slow for fine adjustment and
 * accelerates to full rate after a second of holding.
 */
export function leverRate(baseRate: number, heldTime: number): number {
  return baseRate * (0.25 + 0.75 * clamp(heldTime, 0, 1));
}

/**
 * Toe brake from a held key: progressive application (a short tap gives a gentle touch, holding reaches
 * full braking in ~0.5 s) and a quick release. Toe brakes are pressure-modulated, and full braking from a
 * key would otherwise skid the tyres and pitch the nose down at every tap.
 */
export function stepBrake(value: number, held: boolean, dt: number): number {
  const target = held ? 1 : 0;
  const rate = held ? 2 : 6; // full application in 0.5 s, release in ~0.17 s
  const step = rate * dt;
  return Math.abs(target - value) <= step ? target : value + Math.sign(target - value) * step;
}

/** Flap lever detents of the Cessna 172S: 0, 10, 20, 30 degrees as lever fractions. */
export const FLAP_DETENTS = C172S_INPUT.flapDetents;

/**
 * Next flap detent in a direction (+1 = down/more flap, -1 = up) from the current lever position. `detents`:
 * the type's lever values, ascending from 0 to 1 (InputProfile.flapDetents).
 */
export function nextFlapDetent(lever: number, direction: 1 | -1, detents: readonly number[] = FLAP_DETENTS): number {
  const eps = 1e-3;
  if (direction > 0) {
    for (const d of detents) if (d > lever + eps) return d;
    return 1;
  }
  for (let i = detents.length - 1; i >= 0; i--) if (detents[i] < lever - eps) return detents[i];
  return 0;
}

/** Wrap a knob angle into [0, 360). */
export const wrapDegrees = (d: number): number => ((d % 360) + 360) % 360;

/**
 * The pilot's hand during rotation, for the keyboard elevator. On the take-off roll the C172 needs only a
 * fifth of the aft yoke travel to lift the nose at 55 KIAS (with the mains as the pivot there is no pitch
 * damping from a flight path, and the tail's lift grows as the nose comes up), so a nose-up key held on the
 * runway, which keeps moving the yoke aft and faster the longer it is held, would pitch the nose up through
 * the take-off attitude into the tail skid. A pilot pulls until the nose starts to come up and then holds
 * that pressure: while the nose-up key is held with a main wheel on the ground, this stops the key moving the
 * yoke further aft once the pitch rate (with a little lead on its acceleration) reaches a normal rotation
 * rate, and eases it forward if the rate or the attitude (approaching the tail-strike attitude) runs past.
 *
 * With the hold-position keyboard it acts ONLY while that key is held (it never moves a yoke the pilot has
 * let go of, so it cannot fight a position the pilot set), and it stays with the same press through lift-off
 * with the climb attitude AIR_PITCH_LIMIT as its stop, because leaving ground effect at full power the C172
 * pitches up by itself. Once the key is released the yoke stays where it is; a fresh press in the air is not
 * guarded (the soft load-factor stop is the only limit), so stalls and steep pull-ups remain possible.
 */
export class RotationGuard {
  // The Cessna 172S tuning (the default of the constructor).
  /** Pitch rate a pilot rotates at, rad/s (about 5 deg/s). */
  static readonly RATE = C172S_INPUT.assists.rotation.rate;
  /** Lead on the pitch acceleration, s. */
  static readonly RATE_LEAD = C172S_INPUT.assists.rotation.rateLead;
  /** Pitch attitude the pilot will not pull past with the mains on the ground, rad (tail strike ~13-14 deg). */
  static readonly PITCH_LIMIT = C172S_INPUT.assists.rotation.pitchLimitGround;
  /** Initial-climb attitude held while the same press continues after lift-off, rad. */
  static readonly AIR_PITCH_LIMIT = C172S_INPUT.assists.rotation.pitchLimitAir;
  /** Lead on the pitch rate for the attitude stop, s. */
  static readonly PITCH_LEAD = C172S_INPUT.assists.rotation.pitchLead;
  /** Yoke relaxed per second per rad/s of excess pitch rate. */
  static readonly BLEED = C172S_INPUT.assists.rotation.bleed;
  /** Filter time constant of the pitch-acceleration estimate, s. */
  static readonly ACCEL_TAU = 0.06;

  private readonly tuning: KeyboardAssistTuning['rotation'];
  private lastQ = Number.NaN;
  private qdot = 0;
  /** The nose-up key held on the ground is still held. */
  private latched = false;

  constructor(tuning: KeyboardAssistTuning['rotation'] = C172S_INPUT.assists.rotation) {
    this.tuning = tuning;
  }

  reset(): void {
    this.lastQ = Number.NaN;
    this.qdot = 0;
    this.latched = false;
  }

  /** True while the guard is acting (the nose-up key is held and was held on the mains). */
  get active(): boolean {
    return this.latched;
  }

  /**
   * @param value    keyboard elevator after this frame's key step (relative to neutral, + = aft)
   * @param previous keyboard elevator before this frame's key step
   * @param q        body pitch rate, rad/s (+ = nose up)
   * @param pitch    pitch attitude, rad
   * @param onMains  a main wheel is on the ground
   * @param pulling  the nose-up key is held
   * @returns the keyboard elevator to use (never more aft than `value`)
   */
  step(value: number, previous: number, q: number, pitch: number, onMains: boolean, dt: number, pulling = false): number {
    if (dt <= 0) return value;
    const raw = Number.isNaN(this.lastQ) ? 0 : (q - this.lastQ) / dt;
    this.lastQ = q;
    this.qdot += (raw - this.qdot) * (1 - Math.exp(-dt / RotationGuard.ACCEL_TAU));
    this.latched = pulling && (onMains || this.latched);
    if (!this.latched || value <= 0) return value;
    const t = this.tuning;
    const limit = onMains ? t.pitchLimitGround : t.pitchLimitAir;
    const rateExcess = q + Math.max(0, this.qdot) * t.rateLead - t.rate;
    const pitchExcess = (pitch + Math.max(0, q) * t.pitchLead - limit) * 2;
    const excess = Math.max(rateExcess, pitchExcess);
    if (excess <= 0) return value;
    return Math.max(0, Math.min(value, Math.max(0, previous)) - t.bleed * excess * dt);
  }
}

/** A difference between the pilot's two toe brakes beyond this is the pilot steering with them. */
export const PILOT_DIFFERENTIAL_BRAKE = 0.05;

/**
 * The keyboard pilot's feet on the ground (auto-rudder). A C172 needs ~0.15-0.2 right pedal throughout the
 * take-off roll (propeller torque / slipstream) and small corrections in every ground roll. While the keyboard
 * rudder is centred (not touched since the scenario started or the last Numpad 5 / 5) this keeps the nose on
 * the heading it had when it took over (PID on heading, damped by the yaw rate). The first rudder key press
 * hands the pedals to the pilot without a bump (InputSystem adds this output to the held keyboard rudder and
 * resets it), so it never fights a rudder position the pilot has set; centring hands them back (handover()).
 * A differential brake freezes it while applied. After lift-off it washes out over a couple of seconds (the
 * pilot's feet relax); it is inactive in flight and when hardware pedals own the rudder.
 *
 * On a type with a castering nosewheel (`kind: 'differentialBrake'`) the pedals do not steer and the rudder has
 * no grip on the heading until the air does: below `rudderEffectiveSpeed` the same demand also goes to the toe
 * brakes (brakeDemand, differentialBrake below), fading out as the rudder takes over. The keyboard rudder carries
 * the same brake (rudderBrake), so the hand-overs move neither the rudder nor the brakes.
 */
export class GroundSteeringAssist {
  /** Output (rudder, -1..1). */
  value = 0;
  private integral = 0;
  private hold: number | null = null;
  // The Cessna 172S tuning (the default of the constructor).
  /** Rudder per rad of heading error, per rad*s of accumulated error, and per rad/s of yaw rate. */
  static readonly KP = C172S_INPUT.assists.steering.kp;
  static readonly KI = C172S_INPUT.assists.steering.ki;
  static readonly KD = C172S_INPUT.assists.steering.kd;
  /** Output limit: the assist holds a line, it does not do the pilot's steering. */
  static readonly LIMIT = C172S_INPUT.assists.steering.limit;
  /** Ground speed at which the assist begins to act, and the span over which it fades in, m/s. */
  static readonly FADE_IN_START = C172S_INPUT.assists.steering.fadeInSpeed[0];
  static readonly FADE_IN_SPAN = C172S_INPUT.assists.steering.fadeInSpeed[1] - C172S_INPUT.assists.steering.fadeInSpeed[0];

  private readonly tuning: KeyboardAssistTuning['steering'];
  private readonly fadeInSpan: number;

  constructor(tuning: KeyboardAssistTuning['steering'] = C172S_INPUT.assists.steering) {
    this.tuning = tuning;
    this.fadeInSpan = tuning.fadeInSpeed[1] - tuning.fadeInSpeed[0];
  }

  /** Output limit of this assist (the largest rudder handover() takes over). */
  get limit(): number {
    return this.tuning.limit;
  }

  /** The type is steered on the ground with the brakes (castering nosewheel). */
  get steersWithBrakes(): boolean {
    return this.tuning.kind === 'differentialBrake';
  }

  /**
   * Share of the steering the brakes carry at an indicated airspeed (m/s): 1 at rest, 0 from
   * `rudderEffectiveSpeed` up. The rudder's yawing moment grows with dynamic pressure, so the brakes make up
   * 1 - (V / Veff)^2 and the two together steer about equally hard at every speed. 0 on a type steered by its
   * pedals.
   */
  brakeShare(ias: number): number {
    if (this.tuning.kind !== 'differentialBrake') return 0;
    const f = clamp(ias / (this.tuning.rudderEffectiveSpeed ?? DEFAULT_RUDDER_EFFECTIVE_SPEED), 0, 1);
    return 1 - f * f;
  }

  /** The assist's demand on the brakes, signed like the rudder (+ = nose right = right brake), [-1, 1]. */
  brakeDemand(ias: number): number {
    return clamp(this.value * (this.tuning.brakeGain ?? 1) * this.brakeShare(ias), -1, 1);
  }

  /**
   * The toe brake the pilot's keyboard rudder carries, signed like it: the assist's own law (brakeDemand) on the
   * part of it within the assist's authority (`limit`). The first rudder key press moves the assist's output
   * into the keyboard rudder, and Numpad 5 hands a held rudder within the limit back to the assist: with the same
   * law on both sides the brakes do not move at either hand-over. 0 on a type steered by its pedals.
   */
  rudderBrake(rudder: number, ias: number): number {
    return clamp(clamp(rudder, -this.limit, this.limit) * (this.tuning.brakeGain ?? 1) * this.brakeShare(ias), -1, 1);
  }

  /**
   * The toe brake a foot adds on a pedal pushed past half travel, signed like the rudder: nothing up to 50 % of
   * travel, then in proportion up to `pedalBrakeGain` at the stop, with the same fade-out with airspeed as the
   * assist's brake. With rudderBrake this is what lets the rudder keys steer a castering type at taxi speed.
   */
  pedalBrake(rudder: number, ias: number): number {
    const beyond = clamp((Math.abs(rudder) - PEDAL_BRAKE_START) / (1 - PEDAL_BRAKE_START), 0, 1);
    return Math.sign(rudder) * beyond * (this.tuning.pedalBrakeGain ?? DEFAULT_PEDAL_BRAKE_GAIN) * this.brakeShare(ias);
  }

  reset(): void {
    this.value = 0;
    this.integral = 0;
    this.hold = null;
  }

  /** Take the pedals over from the pilot at `rudder` (clamped to the assist's limit), holding the present heading. */
  handover(rudder: number): void {
    this.value = this.integral = clamp(rudder, -this.limit, this.limit);
    this.hold = null;
  }

  /**
   * @param heading      true heading, rad
   * @param yawRate      body yaw rate r, rad/s (+ = nose right)
   * @param onGround     any wheel on the ground
   * @param groundSpeed  m/s
   * @param pilotSteering a rudder key or a differential brake is being used (or the keyboard rudder is
   *                      still returning to neutral)
   */
  step(heading: number, yawRate: number, onGround: boolean, groundSpeed: number, pilotSteering: boolean, dt: number): number {
    if (dt <= 0) return this.value;
    if (!onGround) {
      // Airborne: relax the feet over ~2 s.
      const k = Math.exp(-dt / 2);
      this.integral *= k;
      this.value *= k;
      this.hold = null;
      return this.value;
    }
    // Fade in with speed: at walking pace the nosewheel stays where the pilot left it.
    const t = this.tuning;
    const w = clamp((groundSpeed - t.fadeInSpeed[0]) / this.fadeInSpan, 0, 1);
    if (pilotSteering || w <= 0) {
      this.hold = null;
      if (w <= 0) {
        this.integral *= Math.exp(-dt / 3);
        this.value = this.integral;
      }
      return this.value;
    }
    if (this.hold === null) {
      // Taking over: keep the current output (bumpless) and hold the current heading.
      this.hold = heading;
      this.integral = this.value;
    }
    const err = wrapPi(this.hold - heading);
    const L = t.limit;
    this.integral = clamp(this.integral + t.ki * err * w * dt, -L, L);
    this.value = clamp(this.integral + (t.kp * err - t.kd * yawRate) * w, -L, L);
    return this.value;
  }
}

/** Indicated airspeed from which the rudder alone steers a castering type, m/s, where its profile gives none. */
export const DEFAULT_RUDDER_EFFECTIVE_SPEED = 15;
/** Toe brake at full pedal where the profile gives none (KeyboardAssistTuning.steering.pedalBrakeGain). */
export const DEFAULT_PEDAL_BRAKE_GAIN = 0.5;
/** Pedal travel beyond which the foot also presses the toe brake. */
export const PEDAL_BRAKE_START = 0.5;

/**
 * Steering with the brakes (castering nosewheel). `demand` is the signed steering demand (+ = nose right) and
 * `base` the pilot's symmetric brake (the smaller of his two toe brakes). The demand ADDS brake on the inside of
 * the correction and RELEASES it on the outside in proportion to what is applied there, so it keeps its
 * authority while the pilot holds both brakes on the roll-out (combining by maximum, as the pedal sources are,
 * would leave it none: both sides are already at 1), and with the brakes off it is a plain toe brake.
 */
export function differentialBrake(base: number, demand: number, out: { left: number; right: number }): { left: number; right: number } {
  out.left = clamp(base + Math.max(0, -demand) - Math.max(0, demand) * base, 0, 1);
  out.right = clamp(base + Math.max(0, demand) - Math.max(0, -demand) * base, 0, 1);
  return out;
}

/**
 * Roll trim for the keyboard while the ailerons are centred (hands off the yoke): the C172 needs a small
 * steady aileron (about 0.04 right in a full-power climb against propeller torque, less at cruise) that a
 * pilot holds without thinking about it. While the keyboard ailerons are centred (untouched since the
 * scenario started or the last Numpad 5 / 5) and the wings are within a few degrees of level, this slowly
 * builds up a small aileron bias that holds the bank the aircraft had (integral of the roll rate, like trim,
 * plus a slow integral of the bank error). It never rolls out of a turn (inactive beyond 6 degrees of bank)
 * and its authority is a few percent of travel. The first roll key press hands the bias to the pilot's held
 * keyboard aileron without a bump, so it never fights an aileron position the pilot has set.
 */
export class RollTrimAssist {
  value = 0;
  // The Cessna 172S tuning (the default of the constructor).
  /** Bias per radian of roll-rate integral. */
  static readonly KI = C172S_INPUT.assists.rollTrim.ki;
  /** Bias per second per radian of bank away from the bank the pilot left. */
  static readonly KB = C172S_INPUT.assists.rollTrim.kb;
  static readonly LIMIT = C172S_INPUT.assists.rollTrim.limit;
  /** Active only within this bank angle, rad. */
  static readonly BANK_WINDOW = (6 * Math.PI) / 180;
  /** Wait after the pilot's last roll input before holding, s. */
  static readonly HOLD_OFF = 0.8;
  private readonly tuning: KeyboardAssistTuning['rollTrim'];
  private quiet = 0;
  private reference: number | null = null;

  constructor(tuning: KeyboardAssistTuning['rollTrim'] = C172S_INPUT.assists.rollTrim) {
    this.tuning = tuning;
  }

  reset(): void {
    this.value = 0;
    this.quiet = 0;
    this.reference = null;
  }

  step(rollRate: number, bank: number, airborne: boolean, pilotRolling: boolean, dt: number): number {
    if (dt <= 0) return this.value;
    if (!airborne) {
      this.value *= Math.exp(-dt / 1);
      this.reference = null;
      return this.value;
    }
    if (pilotRolling) {
      this.quiet = 0;
      this.reference = null;
      return this.value;
    }
    this.quiet += dt;
    if (this.quiet < RollTrimAssist.HOLD_OFF || Math.abs(bank) > RollTrimAssist.BANK_WINDOW) {
      this.reference = null;
      return this.value;
    }
    this.reference ??= bank;
    const t = this.tuning;
    const L = t.limit;
    this.value = clamp(this.value - (t.ki * rollRate + t.kb * (bank - this.reference)) * dt, -L, L);
    return this.value;
  }
}
