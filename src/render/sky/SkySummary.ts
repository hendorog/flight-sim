// Clear-sky summary for the CPU (the sky ambient and horizon colour behind ctx.sky.skyColor / hazeColor),
// computed on the CPU from the same atmosphere model as the GPU sky (cpuSky.ts), so nothing is ever read
// back from the GPU. (A WebGL read-back is a synchronous round trip to Chrome's GPU process: it cost
// ~21 ms every 6th frame under load, even behind a fence.)
//
// The summary is linear in the lights' top-of-atmosphere illuminance, so it is computed per unit
// illuminance and scaled when used. It depends only on the camera altitude and the elevations of the
// sun and moon; a refresh starts when one of them has moved enough and is spread over a few frames
// (one ring of the hemisphere per step, ~0.15 ms each). The first summary is computed at once, so there
// are no black frames at start-up.

import { CpuSky, SUMMARY_BANDS, createSkyBands, type SkyBands } from './cpuSky';
import type { AtmosphereParams } from './params';

/** Rings per light: the hemisphere bands plus the horizon ring. */
const RINGS = SUMMARY_BANDS + 1;
/** Rings integrated per frame while a refresh is running. */
const RINGS_PER_FRAME = 3;
/** Refresh thresholds: change of the sine of the sun's / moon's elevation ... */
const MU_THRESHOLD = 0.002;
/** ... or of the camera altitude, the larger of these (m, fraction of the altitude above the field). */
const ALTITUDE_THRESHOLD_M = 25;
const ALTITUDE_THRESHOLD_FRACTION = 0.03;
/** Jumps this large (a reset or teleport) are recomputed at once instead of over several frames. */
const JUMP_MU = 0.05;
const JUMP_ALTITUDE_M = 500;
/** The moon lights a visible share of the sky only once the sun is down. */
const MOON_SUN_MU = 0.05;

interface State {
  altKm: number;
  sunMu: number;
  moonMu: number;
  moon: boolean;
  params: AtmosphereParams | null;
}

export class SkySummary {
  private readonly sky = new CpuSky();
  /** Clear sky per unit sun / moon illuminance (the completed summary). */
  private readonly sun = createSkyBands();
  private readonly moon = createSkyBands();
  /** Being integrated. */
  private readonly nextSun = createSkyBands();
  private readonly nextMoon = createSkyBands();
  private readonly done: State = { altKm: NaN, sunMu: NaN, moonMu: NaN, moon: false, params: null };
  private readonly pending: State = { altKm: 0, sunMu: 0, moonMu: 0, moon: false, params: null };
  /** Next ring to integrate (sun rings, then moon rings), -1 when idle. */
  private step = -1;
  /** Number of completed summaries. */
  version = 0;

  /**
   * Advance the summary toward the current state. Returns true when a new summary was completed.
   * @param altKm camera altitude above sea level, km
   */
  update(params: AtmosphereParams, altKm: number, sunMu: number, moonMu: number): boolean {
    const moon = sunMu < MOON_SUN_MU;
    if (this.step < 0) {
      if (!this.stale(params, altKm, sunMu, moonMu, moon)) return false;
      this.begin(params, altKm, sunMu, moonMu, moon);
      const d = this.done;
      if (this.version === 0 || params !== d.params || Math.abs(sunMu - d.sunMu) > JUMP_MU || Math.abs(altKm - d.altKm) * 1000 > JUMP_ALTITUDE_M) {
        while (this.step >= 0) this.advance();
        return true;
      }
    }
    for (let i = 0; i < RINGS_PER_FRAME && this.step >= 0; i++) this.advance();
    return this.step < 0;
  }

  /** The clear sky: sun bands x sunE + moon bands x moonE, into out. */
  combine(sunE: ArrayLike<number>, moonE: ArrayLike<number>, out: SkyBands): SkyBands {
    for (let i = 0; i < 3 * SUMMARY_BANDS; i++) {
      const k = i % 3;
      out.band[i] = this.sun.band[i] * sunE[k] + this.moon.band[i] * moonE[k];
    }
    for (let k = 0; k < 3; k++) out.horizon[k] = this.sun.horizon[k] * sunE[k] + this.moon.horizon[k] * moonE[k];
    return out;
  }

  private stale(params: AtmosphereParams, altKm: number, sunMu: number, moonMu: number, moon: boolean): boolean {
    const d = this.done;
    const altM = altKm * 1000;
    return (
      params !== d.params ||
      Math.abs(sunMu - d.sunMu) > MU_THRESHOLD ||
      moon !== d.moon ||
      (moon && Math.abs(moonMu - d.moonMu) > MU_THRESHOLD) ||
      Math.abs(altM - d.altKm * 1000) > Math.max(ALTITUDE_THRESHOLD_M, ALTITUDE_THRESHOLD_FRACTION * Math.abs(altM))
    );
  }

  private begin(params: AtmosphereParams, altKm: number, sunMu: number, moonMu: number, moon: boolean): void {
    this.sky.setParams(params);
    Object.assign(this.pending, { altKm, sunMu, moonMu, moon, params });
    for (const b of [this.nextSun, this.nextMoon]) {
      b.band.fill(0);
      b.horizon.fill(0);
    }
    this.step = 0;
  }

  private advance(): void {
    const s = this.pending;
    const moonRing = this.step >= RINGS;
    if (!moonRing || s.moon) {
      const ring = this.step % RINGS;
      this.sky.addSummaryRing(s.altKm, moonRing ? s.moonMu : s.sunMu, UNIT, moonRing ? this.nextMoon : this.nextSun, ring);
    }
    this.step++;
    if (this.step >= 2 * RINGS || (this.step >= RINGS && !s.moon)) this.finish();
  }

  private finish(): void {
    swapBands(this.sun, this.nextSun);
    swapBands(this.moon, this.nextMoon);
    Object.assign(this.done, this.pending);
    this.step = -1;
    this.version++;
  }
}

const UNIT = [1, 1, 1] as const;

function swapBands(dst: SkyBands, src: SkyBands): void {
  dst.band.set(src.band);
  dst.horizon.set(src.horizon);
}
