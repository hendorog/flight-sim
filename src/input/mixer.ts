// Combining keyboard, mouse-yoke and hardware axes into one control value. Pure logic, no DOM.
//
// Centring controls (yoke, rudder): a hardware axis that is deflected or has just moved owns the control
// outright; otherwise the keyboard deflection is added to the mouse-yoke position, so tapping a key while
// flying with the mouse gives a held correction.
// Lever controls (throttle, mixture): whichever source moved last owns the lever ("last moved wins"), so a
// quadrant lever resting at idle does not fight the keyboard until it is touched.

import { clamp } from '../core/math';
import type { InputProfile } from './profile';

/** How long a hardware axis keeps ownership after it last moved, even if back at centre, s. */
export const AXIS_HOLD_TIME = 0.6;

/** Tracks when a hardware input last showed activity. */
export class Activity {
  private lastActive = -Infinity;

  /** Record a sample; `active` = deflected beyond the dead zone or moved this poll. */
  sample(active: boolean, time: number): void {
    if (active) this.lastActive = time;
  }

  isActive(time: number): boolean {
    return time - this.lastActive <= AXIS_HOLD_TIME;
  }
}

/**
 * @param keyboard keyboard virtual-yoke deflection
 * @param mouse    mouse-yoke position, or null when the mouse yoke is off
 * @param hardware hardware axis value when that axis is in use, else null
 */
export function mixCentring(keyboard: number, mouse: number | null, hardware: number | null): number {
  if (hardware !== null) return clamp(hardware, -1, 1);
  return clamp(keyboard + (mouse ?? 0), -1, 1);
}

export type LeverSource = 'keyboard' | 'hardware';

/** Last-moved-wins ownership of one lever control. */
export class LeverOwner {
  owner: LeverSource = 'keyboard';

  update(keyboardActive: boolean, hardwareMoved: boolean): LeverSource {
    if (keyboardActive) this.owner = 'keyboard';
    else if (hardwareMoved) this.owner = 'hardware';
    return this.owner;
  }
}

/**
 * Mouse position -> yoke deflection. The yoke reaches full travel at 80% of the half-width/half-height so
 * the stops are reachable without touching the screen edge, with a small central dead zone and a gentle
 * curve for fine control around neutral.
 * @param nx horizontal position, -1 (left edge) .. 1 (right edge)
 * @param ny vertical position, -1 (top) .. 1 (bottom); mouse toward the pilot (down) = yoke back = +elevator
 */
export function mouseYokeDeflection(nx: number, ny: number, tuning: InputProfile['mouseYoke'] = { expo: 0.3, deadzone: 0.02 }): { aileron: number; elevator: number } {
  const shape = (v: number): number => {
    const s = clamp(v / 0.8, -1, 1);
    const a = Math.abs(s);
    const d = Math.max(0, (a - tuning.deadzone) / (1 - tuning.deadzone));
    return Math.sign(s) * ((1 - tuning.expo) * d + tuning.expo * d * d * d);
  };
  return { aileron: shape(nx), elevator: shape(ny) };
}

/** Preserve the position at pickup while retaining both absolute stops. pickup is near zero. */
export function mouseAxisFromPickup(value: number, pickup: number, control: number): number {
  return value >= pickup ? control + (1 - control) * (value - pickup) / (1 - pickup) :
    control + (1 + control) * (value - pickup) / (1 + pickup);
}

/** Radius of the mouse-yoke pick-up zone around the view centre, in normalised units (-1..1 per axis). */
export const MOUSE_PICKUP_RADIUS = 0.1;

/** True when the pointer is inside the pick-up zone: an armed mouse yoke takes control here (bumpless). */
export function mouseYokeNearCentre(nx: number, ny: number): boolean {
  return Math.abs(nx) < MOUSE_PICKUP_RADIUS && Math.abs(ny) < MOUSE_PICKUP_RADIUS;
}
