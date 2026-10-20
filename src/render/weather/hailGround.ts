// Hail on the ground near the camera (HailGroundOverlay.ts): the stones that land and bounce, and the white scatter
// they leave under heavy hail. The state the overlay draws, advanced once per frame from the hail at the camera. No
// three.js import (tests/render/hailGround.test.ts).
//
//   impacts     stones landing per m^2 and s: hailNumberDensity x the mean stone's fall speed (hail.ts)
//   cover       0..1, the share of the ground's stone sites holding a stone: toward hail / (hail + COVER_HALF_MMH) with
//               COVER_RISE_S while it hails that hard, else melting away with COVER_MELT_S
//   bounce      a landing stone leaves the ground at HAIL_RESTITUTION (+- HAIL_RESTITUTION_SPREAD) times its fall
//               speed, bounces once more at that share of its rebound speed, and rolls to rest (bounceHeights)
// Unconfirmed: the restitution of a hailstone on a runway is given as 0.3 to 0.5 in the owner's brief and has not been
// checked against a source; the cover and melt constants are look values.

import { hailFallSpeed, hailMeanMm, hailNumberDensity } from '../../physics/weather/hail';

export const HAIL_RESTITUTION = 0.4;
export const HAIL_RESTITUTION_SPREAD = 0.1;
export const COVER_HALF_MMH = 4;
export const COVER_RISE_S = 40;
export const COVER_MELT_S = 240;
/** Below this the cover counts as gone. */
export const COVER_EPS = 2e-3;
const G = 9.80665;

/** Apex heights of the first and second bounce of a stone of diameter dMm (mm) at restitution e, m. */
export function bounceHeights(dMm: number, e = HAIL_RESTITUTION): [number, number] {
  const v1 = e * hailFallSpeed(dMm);
  const v2 = e * v1;
  return [(v1 * v1) / (2 * G), (v2 * v2) / (2 * G)];
}

export class HailGround {
  impactsPerM2s = 0;
  cover = 0;
  /** The largest stone of the hail last seen, mm (the scatter keeps its sizes while it melts). */
  maxMm = 0;
  /** Seconds of ground time, wrapping at 4096 s. */
  time = 0;

  update(hailMmH: number, hailMaxMm: number, dt: number): void {
    const rate = hailMmH > 0 && hailMaxMm > 0 ? hailMmH : 0;
    if (rate > 0) {
      this.maxMm = hailMaxMm;
      this.impactsPerM2s = hailNumberDensity(rate, hailMaxMm) * hailFallSpeed(hailMeanMm(hailMaxMm));
    } else this.impactsPerM2s = 0;
    if (!(dt > 0)) return;
    this.time = (this.time + dt) % 4096;
    const eq = rate / (rate + COVER_HALF_MMH);
    const tau = eq > this.cover ? COVER_RISE_S : COVER_MELT_S;
    this.cover = eq + (this.cover - eq) * Math.exp(-dt / tau);
    if (this.cover < COVER_EPS && eq === 0) this.cover = 0;
  }

  /** No stones falling and none lying. */
  get clear(): boolean {
    return this.impactsPerM2s === 0 && this.cover === 0;
  }

  reset(): void {
    this.impactsPerM2s = this.cover = 0;
  }
}
