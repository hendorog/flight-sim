// Water, snow and hail on the windscreen and canopy glass (WindscreenOverlay.ts): the state the overlay's shader
// draws, advanced once per frame from the precipitation at the aircraft and its airspeed. No three.js import, so
// every number is unit-tested in node (tests/render/windscreenWater.test.ts).
//
//   airShare   smoothstep(AIR_SHARE_LO_MS, AIR_SHARE_HI_MS, TAS): 0 parked or slow (drops bead and run down under
//              gravity), 1 at speed (drops are blown along the glass with the airflow)
//   wetness    0..1, the share of the glass's drop sites holding a drop. In rain or drizzle it moves toward
//              rate / (rate + WET_HALF_MMH) with WET_TAU_S; above that level (out of rain, or lighter rain) it falls
//              with the drying time constant mix(DRY_TAU_PARKED_S, DRY_TAU_FLYING_S, airShare)
//   snow       0..1, the share of flake sites holding a flake: toward rate / (rate + SNOW_HALF_MMH) with SNOW_TAU_S;
//              the flakes melt or blow off with mix(SNOW_MELT_PARKED_S, SNOW_BLOW_FLYING_S, airShare)
//   hail       stones striking the glass per m^2 and s: hailNumberDensity x the stones' speed into the glass (the
//              mean stone's fall speed, and the airspeed for the forward-facing glass), each drawn as a white splash
//              for HAIL_SPLASH_S
//   runSpeedMs speed of the moving drops along the glass: RUN_PARKED_MS (gravity) to RUN_PER_TAS x TAS (airflow)
//   phases     the moving drops' offset along the glass, m, kept below RUN_WRAP_M (the shader's pattern repeats there)
// Every constant is unconfirmed: look values set for this model, not measured.

import type { PrecipType } from '../../core/types';
import { hailFallSpeed, hailMeanMm, hailNumberDensity } from '../../physics/weather/hail';

export const AIR_SHARE_LO_MS = 8;
export const AIR_SHARE_HI_MS = 30;
export const WET_HALF_MMH = 1.5;
export const WET_TAU_S = 4;
export const DRY_TAU_PARKED_S = 90;
export const DRY_TAU_FLYING_S = 6;
export const SNOW_HALF_MMH = 0.6;
export const SNOW_TAU_S = 5;
export const SNOW_MELT_PARKED_S = 8;
export const SNOW_BLOW_FLYING_S = 1.5;
export const HAIL_SPLASH_S = 0.15;
export const RUN_PARKED_MS = 0.03;
export const RUN_PER_TAS = 0.02;
/** Below this the state counts as dry (and is set to 0). */
export const DRY_EPS = 1e-3;
/**
 * Length after which the moving-drop phase wraps, m: a whole number of the shader's run cells (RUN_CELL_M) times its
 * hash tile (256), so the wrap does not move a drop.
 */
export const RUN_CELL_M = 0.016;
export const RUN_WRAP_M = RUN_CELL_M * 256;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** What the glass meets this frame. */
export interface GlassWeather {
  type: PrecipType;
  /** Rain, drizzle or snow, mm/h. */
  rateMmH: number;
  hailMmH: number;
  hailMaxMm: number;
  /** True airspeed, m/s. */
  tasMs: number;
}

export class WindscreenWater {
  airShare = 0;
  wetness = 0;
  snow = 0;
  /** Hail stones striking the glass per m^2 and s. */
  hailPerM2s = 0;
  runSpeedMs = RUN_PARKED_MS;
  /** Offset of the moving drops along the glass, m (0 .. RUN_WRAP_M). */
  runPhaseM = 0;
  /** Seconds of glass time (summed dt), for the shader's drop and splash life cycles; wraps at 4096 s. */
  time = 0;

  /** Advance by dt (s). */
  update(w: GlassWeather, dt: number): void {
    const v = Math.max(0, w.tasMs);
    this.airShare = smoothstep(AIR_SHARE_LO_MS, AIR_SHARE_HI_MS, v);
    const a = this.airShare;
    this.runSpeedMs = Math.max(RUN_PARKED_MS, RUN_PER_TAS * v * a);
    if (w.hailMmH > 0 && w.hailMaxMm > 0) {
      const vt = hailFallSpeed(hailMeanMm(w.hailMaxMm));
      this.hailPerM2s = hailNumberDensity(w.hailMmH, w.hailMaxMm) * Math.hypot(vt, v);
    } else this.hailPerM2s = 0;
    if (!(dt > 0)) return;
    this.time = (this.time + dt) % 4096;
    this.runPhaseM = (this.runPhaseM + this.runSpeedMs * dt) % RUN_WRAP_M;
    const liquid = w.type === 'rain' || w.type === 'drizzle' ? Math.max(0, w.rateMmH) : 0;
    const wetEq = liquid / (liquid + WET_HALF_MMH);
    const dry = DRY_TAU_PARKED_S + (DRY_TAU_FLYING_S - DRY_TAU_PARKED_S) * a;
    this.wetness = toward(this.wetness, wetEq, this.wetness < wetEq ? WET_TAU_S : dry, dt);
    const snowRate = w.type === 'snow' ? Math.max(0, w.rateMmH) : 0;
    const snowEq = snowRate / (snowRate + SNOW_HALF_MMH);
    const melt = SNOW_MELT_PARKED_S + (SNOW_BLOW_FLYING_S - SNOW_MELT_PARKED_S) * a;
    this.snow = toward(this.snow, snowEq, this.snow < snowEq ? SNOW_TAU_S : melt, dt);
    if (this.wetness < DRY_EPS && wetEq === 0) this.wetness = 0;
    if (this.snow < DRY_EPS && snowEq === 0) this.snow = 0;
  }

  /** Nothing on the glass: no drops, flakes or hail. */
  get dry(): boolean {
    return this.wetness === 0 && this.snow === 0 && this.hailPerM2s === 0;
  }

  /** A new flight or a cut to a dry glass. */
  reset(): void {
    this.wetness = this.snow = this.hailPerM2s = 0;
    this.runPhaseM = 0;
  }
}

/** First-order step of x toward target with time constant tau (s) over dt (s). */
function toward(x: number, target: number, tau: number, dt: number): number {
  return target + (x - target) * Math.exp(-dt / tau);
}
