// Bankside trees along the river: where they stand is a value noise along the river's arc length, per bank,
// evaluated identically on the CPU (tree placement, vegetation/placement.ts) and in the water shader (the far
// bank's trees reflected in the river, water.ts). Pure and three.js-free.

import { hash2i } from './noise';

/** Length of one clump cell along the river, m. */
export const RIPARIAN_CELL = 60;
/** Mean height of the bankside trees, m (placement draws 7-18 m). */
export const RIPARIAN_TREE_HEIGHT = 12;
/** The trees stand this far beyond the water's edge (a band), m. */
export const RIPARIAN_NEAR = 3;
export const RIPARIAN_FAR = 22;

const salt = (side: number): number => (side > 0 ? 71 : 73);
const h01 = (k: number, s: number): number => hash2i(k, s) / 4294967296;

/** Share of the bank lined with trees at arc length s (m) on bank side (+1 right of the flow, -1 left, as RiverHit.side), 0..1. */
export function riparianPresence(s: number, side: number): number {
  const x = s / RIPARIAN_CELL;
  const k = Math.floor(x);
  const f = x - k;
  const t = f * f * (3 - 2 * f);
  const v = h01(k, salt(side)) + (h01(k + 1, salt(side)) - h01(k, salt(side))) * t;
  const p = Math.min(1, Math.max(0, (v - 0.3) * 3));
  return p * p * (3 - 2 * p);
}

/** GLSL twin of riparianPresence (needs HASH_GLSL). */
export const RIPARIAN_GLSL = /* glsl */ `
float riparianPresence(float s, float side) {
  float x = s / ${RIPARIAN_CELL.toFixed(1)};
  float k = floor(x);
  float f = x - k;
  float t = f * f * (3.0 - 2.0 * f);
  int sl = side > 0.0 ? 71 : 73;
  float v = mix(hash2f(int(k), sl), hash2f(int(k) + 1, sl), t);
  return smoothstep(0.0, 1.0, clamp((v - 0.3) * 3.0, 0.0, 1.0));
}
`;
