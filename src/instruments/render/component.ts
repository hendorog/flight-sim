// Base types for things drawn on the instrument panel canvas.

import type { ControlInputs } from '../../core/types';
import type { InstrumentReadings } from '../dynamics/instrumentSet';
import type { Ctx2D } from './canvas';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Something on the panel that can change. Each component owns a rectangle of the panel canvas that no
 * other component draws into; when it changes, the panel restores the static background under that
 * rectangle and asks the component to draw itself again.
 */
export interface PanelComponent {
  readonly id: string;
  readonly bounds: Rect;
  /**
   * Latch the display values from the readings and controls, quantised to what is visible.
   * @returns true when the drawing differs from the last draw().
   */
  sample(r: InstrumentReadings, c: ControlInputs, time: number): boolean;
  /** Draw into `bounds` of the panel canvas, in panel pixel coordinates. */
  draw(g: Ctx2D): void;
  /** Optional static artwork painted once onto the panel background (labels, placards around it). */
  drawStatic?(g: Ctx2D): void;
  /**
   * Optional: paint the self-lit parts into the light mask (an opaque canvas cleared to black), in panel
   * pixels. Use LIGHT_DIAL for backlit dial markings and LIGHT_DISPLAY for displays and lamps.
   */
  paintLightMask?(g: Ctx2D): void;
}

/**
 * Light-mask fill colours (sRGB; the mask multiplies the sRGB panel image, so the linear factor is about
 * value^2.2). Backlit dial markings get 0.1 of a display's luminance, displays and lamps 1.
 */
export const LIGHT_DIAL = 'rgb(89,89,89)';
export const LIGHT_DISPLAY = '#ffffff';
/** Linear factor LIGHT_DIAL applies (0.349^2.2). */
export const LIGHT_DIAL_LINEAR = 0.1;

/**
 * Tracks a set of quantised display values so a component only redraws when something visible moved.
 * `set(i, v, q)` stores round(v / q) * q and reports whether it changed.
 */
export class Latch {
  private readonly values: Float64Array;
  private dirty = true;

  constructor(n: number) {
    this.values = new Float64Array(n).fill(NaN);
  }

  set(i: number, v: number, quantum: number): number {
    const q = Math.round(v / quantum) * quantum;
    if (q !== this.values[i]) {
      this.values[i] = q;
      this.dirty = true;
    }
    return q;
  }

  /**
   * For analogue pointers: keeps the drawn value until the input has moved a whole quantum away from it,
   * then latches the exact input. Unlike set(), noise far below a quantum that happens to straddle a
   * rounding boundary does not redraw the gauge every frame (in cruise the engine cluster did, 95% of
   * frames, for needle moves of about 0.1 px). The drawn value lags by at most one quantum.
   */
  track(i: number, v: number, quantum: number): number {
    const old = this.values[i];
    if (!(Math.abs(v - old) < quantum)) {
      this.values[i] = v;
      this.dirty = true;
      return v;
    }
    return old;
  }

  get(i: number): number {
    return this.values[i];
  }

  /** Returns and clears the changed flag. */
  take(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }
}
