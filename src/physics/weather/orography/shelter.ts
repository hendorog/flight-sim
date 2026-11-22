// Lee sheltering behind terrain (design section 6). The wake top at x for a low-level wind toward the unit vector u
// is H_w = max over upwind distances d <= WAKE_REACH of h(x - d u) - WAKE_SLOPE d; inside the wake the wind is
// reduced to shelterFactor(): 1 - SHELTER_DEPTH smoothstep(0, 1, (H_w - z) / max(WAKE_MIN_DEPTH, 0.5 (H_w - h))).
// Stored per tile and wind direction as the excess E = max(0, H_w - h) on the tile window (h the tile grid height at
// the node; d from one grid step), so that at lookup H_w = h(x) + E with h the fine terrain under the point and flat
// or windward ground (E = 0) gives a factor of exactly 1. All constants unconfirmed.

import { smoothstep } from '../../../core/math';
import { gridHeight, type TileTerrain } from './terrainGrid';
import { TILE_DX, TILE_N, WINDOW_N, WINDOW_START } from './tiles';

/** Upwind reach of the wake search, m. */
const WAKE_REACH = 10_000;
/** The wake top descends this much per metre downwind of the obstacle. */
const WAKE_SLOPE = 0.15;
/** Share of the wind removed deep in the wake. */
const SHELTER_DEPTH = 0.6;
/** Smallest depth of the transition at the wake top, m. */
const WAKE_MIN_DEPTH = 50;

/** Fill `out` (WINDOW_N^2) with the wake excess for a low-level wind toward (toN, toE) (a unit vector). */
export function shelterExcess(t: TileTerrain, toN: number, toE: number, out: Float32Array): Float32Array {
  const steps = Math.round(WAKE_REACH / TILE_DX);
  for (let wi = 0; wi < WINDOW_N; wi++) {
    for (let wj = 0; wj < WINDOW_N; wj++) {
      const i = WINDOW_START + wi;
      const j = WINDOW_START + wj;
      const here = t.h[i * TILE_N + j];
      let top = -Infinity;
      for (let s = 1; s <= steps; s++) {
        const v = gridHeight(t, i - s * toN, j - s * toE) - WAKE_SLOPE * s * TILE_DX;
        if (v > top) top = v;
      }
      out[wi * WINDOW_N + wj] = Math.max(0, top - here);
    }
  }
  return out;
}

/** Speed factor in the wake at height z for ground h under the point and wake excess E, 0.4..1. */
export function shelterFactor(excess: number, h: number, z: number): number {
  return 1 - SHELTER_DEPTH * shelterShare(excess, h, z);
}

/** The wake share 0..1 (the smoothstep of shelterFactor; also added to the mechanical-turbulence roughness). */
export function shelterShare(excess: number, h: number, z: number): number {
  if (!(excess > 0)) return 0;
  return smoothstep(0, 1, (h + excess - z) / Math.max(WAKE_MIN_DEPTH, 0.5 * excess));
}
