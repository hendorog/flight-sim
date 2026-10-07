// Hardware axis conditioning: calibration, inversion, dead-zone and response curve. Pure functions.
//
// Raw Gamepad API axes are nominally [-1, 1], but real hardware rarely uses the full range or rests at
// exactly zero, so each axis carries a calibration (observed min / centre / max). Centring axes (stick,
// yoke, pedals' rudder) map to [-1, 1] around their centre; lever axes (throttle, mixture, toe brakes)
// map min..max to [0, 1].

import { clamp } from '../core/math';

export interface AxisCalibration {
  min: number;
  center: number;
  max: number;
  invert: boolean;
  /** Fraction of travel around the centre (bipolar) or at each end (unipolar) that reads as exactly 0 / end. */
  deadzone: number;
  /** Response curve 0..1: 0 = linear, 1 = pure cubic. Softens the centre for fine control. */
  curve: number;
}

export const defaultCalibration = (deadzone = 0.03, curve = 0.2, invert = false): AxisCalibration => ({
  min: -1,
  center: 0,
  max: 1,
  invert,
  deadzone,
  curve,
});

/** Expo curve: blend of linear and cubic, keeps the endpoints at +/-1. */
export function applyCurve(v: number, curve: number): number {
  return (1 - curve) * v + curve * v * v * v;
}

/** Remove a symmetric dead zone and rescale so the output still reaches +/-1. */
export function applyDeadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return (Math.sign(v) * (a - dz)) / (1 - dz);
}

/** Centring axis -> [-1, 1] (piecewise around the calibrated centre so an off-centre rest still reads 0). */
export function normalizeBipolar(raw: number, c: AxisCalibration): number {
  let v: number;
  if (raw >= c.center) v = c.max > c.center ? (raw - c.center) / (c.max - c.center) : 0;
  else v = c.center > c.min ? (raw - c.center) / (c.center - c.min) : 0;
  v = clamp(v, -1, 1);
  if (c.invert) v = -v;
  return applyCurve(applyDeadzone(v, c.deadzone), c.curve);
}

/** Lever axis -> [0, 1], with small end dead-zones so idle and full are reachable despite sensor noise. */
export function normalizeUnipolar(raw: number, c: AxisCalibration): number {
  const span = c.max - c.min;
  let v = span > 1e-6 ? (raw - c.min) / span : 0;
  if (c.invert) v = 1 - v;
  const dz = c.deadzone;
  return clamp((v - dz) / (1 - 2 * dz), 0, 1);
}

/** Widen a calibration's range to include a new raw sample (continuous auto-calibration). */
export function widenRange(c: AxisCalibration, raw: number): boolean {
  let changed = false;
  if (raw < c.min) {
    c.min = raw;
    changed = true;
  }
  if (raw > c.max) {
    c.max = raw;
    changed = true;
  }
  return changed;
}

/**
 * Tracks whether a hardware axis is actively being used, so it can take a control away from the keyboard
 * ("last moved wins"). An axis claims its control when it moves more than `threshold` from where it was
 * when it last claimed or was overridden.
 */
export class MotionDetector {
  private anchor = Number.NaN;

  constructor(private readonly threshold = 0.04) {}

  /** Returns true when the value has moved enough since the anchor; re-anchors on each detection. */
  moved(value: number): boolean {
    if (Number.isNaN(this.anchor)) {
      this.anchor = value;
      return false;
    }
    if (Math.abs(value - this.anchor) > this.threshold) {
      this.anchor = value;
      return true;
    }
    return false;
  }

  /** Forget the anchor position (the next sample becomes the new reference). */
  reset(): void {
    this.anchor = Number.NaN;
  }
}

/**
 * Detects the pilot deliberately working a centring axis (yoke, stick, pedals), as opposed to the axis
 * merely resting off centre. Spring-centred consumer yokes and gamepad sticks often rest a few percent (up
 * to ~10 %) away from zero and drift slowly; neither must count as the pilot taking over (for example to
 * disconnect the autopilot). The axis counts as worked when it moves more than `threshold` away from a
 * reference that slowly follows it (time constant `followTau`), so a steady deflection, however large,
 * stops counting after a few seconds and slow drift never counts.
 */
export class TakeoverDetector {
  private anchor = Number.NaN;

  constructor(
    private readonly threshold = 0.12,
    private readonly followTau = 3,
  ) {}

  /** @param dt time since the previous sample, s. Returns true while the axis is being worked. */
  update(value: number, dt: number): boolean {
    if (Number.isNaN(this.anchor)) {
      this.anchor = value;
      return false;
    }
    if (Math.abs(value - this.anchor) > this.threshold) {
      this.anchor = value;
      return true;
    }
    if (dt > 0) this.anchor += (value - this.anchor) * (1 - Math.exp(-dt / this.followTau));
    return false;
  }

  reset(): void {
    this.anchor = Number.NaN;
  }
}
