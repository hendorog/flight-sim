// Hail and snow on the ground near the camera (HailGroundOverlay.ts): the stones that land and bounce, and the hail
// and snow lying on the two surface classes (groundCover.ts). The state the overlay draws, advanced once per frame
// from the precipitation at the camera's ground point. No three.js import (tests/render/hailGround.test.ts,
// tests/render/groundCover.test.ts).
//
//   impacts     stones landing per m^2 and s: hailNumberDensity x the mean stone's fall speed (hail.ts)
//   surfaces    the ground temperature, lying ice and snow, and wetness of soil and pavement (groundCover.ts)
//   bounce      a landing stone leaves the ground at HAIL_RESTITUTION (+- HAIL_RESTITUTION_SPREAD) times its fall
//               speed, bounces once more at that share of its rebound speed, and rolls to rest (bounceHeights)
// Unconfirmed: the restitution of a hailstone on a runway is given as 0.3 to 0.5 in the owner's brief and has not been
// checked against a source.

import { hailFallSpeed, hailMeanMm, hailNumberDensity } from '../../physics/weather/hail';
import { GroundCover } from './groundCover';

export const HAIL_RESTITUTION = 0.4;
export const HAIL_RESTITUTION_SPREAD = 0.1;
const G = 9.80665;

/** Apex heights of the first and second bounce of a stone of diameter dMm (mm) at restitution e, m. */
export function bounceHeights(dMm: number, e = HAIL_RESTITUTION): [number, number] {
  const v1 = e * hailFallSpeed(dMm);
  const v2 = e * v1;
  return [(v1 * v1) / (2 * G), (v2 * v2) / (2 * G)];
}

export class HailGround {
  impactsPerM2s = 0;
  /** The largest stone of the hail last seen, mm (the lying stones keep its sizes while they melt). */
  maxMm = 0;
  /** Seconds of ground time, wrapping at 4096 s. */
  time = 0;
  readonly surfaces = new GroundCover();

  /**
   * Advance by dt s of simulated time: hail (mm/h liquid equivalent) with largest stone hailMaxMm, snow and rain
   * (mm/h liquid equivalent), the surface air temperature airC (deg C).
   */
  update(hailMmH: number, hailMaxMm: number, snowMmH: number, rainMmH: number, airC: number, dt: number): void {
    const rate = hailMmH > 0 && hailMaxMm > 0 ? hailMmH : 0;
    if (rate > 0) {
      this.maxMm = hailMaxMm;
      this.impactsPerM2s = hailNumberDensity(rate, hailMaxMm) * hailFallSpeed(hailMeanMm(hailMaxMm));
    } else this.impactsPerM2s = 0;
    this.surfaces.update(rate, snowMmH, rainMmH, airC, dt);
    if (dt > 0) this.time = (this.time + dt) % 4096;
  }

  /** No stones falling, nothing lying and no wetness left from hail or snow. */
  get clear(): boolean {
    return this.impactsPerM2s === 0 && this.surfaces.clear;
  }

  reset(): void {
    this.impactsPerM2s = 0;
    this.surfaces.reset();
  }
}
