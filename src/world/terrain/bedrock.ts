// Bare rock along fast water (a seeded world's channels only; seed 0 has no flow data and none of this runs).
//
// Where a channel loses height quickly (rapids, cascades, step-pools, falls) the water scours its bed and banks down
// to bedrock: no silt, gravel bars, reeds or bank grass, and fewer bank trees. How much is bare comes from the
// channel's steepness (Hydrology.queryFlow, streams.ts steepnessOf: a quarter per kind of flow), how far beyond the
// water's edge from its size. The same numbers are used by the terrain tiles (tileBuilder.ts: the steepness per
// vertex, aFlow), the ground shader (terrainMaterial.ts, BEDROCK_GLSL), tree placement (vegetation/placement.ts) and
// the boulder fields (vegetation/boulders.ts). Pure and three.js-free.

import type { FlowHit } from './hydrology';

/**
 * Steepness over which the bed turns from gravel and silt to bare rock (streams.ts steepnessOf: 0.5 is the start of
 * rapids, 2 %; 0.78 a step-pool cascade of 10 %): riffles stay gravel, rapids turn rocky, cascades are bare rock.
 */
export const ROCK_STEEP_LO = 0.5;
export const ROCK_STEEP_HI = 0.78;
/**
 * The rock reaches this far beyond the water's edge: a base plus a multiple of the half-width, capped, m. It takes in
 * a stream's notch (heightfield.ts streamProfile: its bank, 2 + 1.5 half-widths, and the foot of its walls) and a
 * river's banks.
 */
export const ROCK_REACH_BASE = 5;
export const ROCK_REACH_PER_WIDTH = 1.6;
export const ROCK_REACH_MAX = 28;
/** Share of the trees left out where the bank is fully bare rock (placement.ts); fewer as the rock gives way to soil. */
export const ROCK_TREE_THIN = 0.85;
/**
 * Share of the gallery of bankside trees (riparian.ts: a lowland river's willows and poplars, out to GALLERY_FAR) left
 * out along fully bare reaches: a mountain torrent has no such gallery, only the woods of its slopes.
 */
export const GALLERY_ROCK_THIN = 0.7;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How bare the bed is (0 gravel and silt .. 1 bare rock) for a channel's steepness (0..1). */
export function bedRock(steepness: number): number {
  return smooth(ROCK_STEEP_LO, ROCK_STEEP_HI, steepness);
}

/** How far the bare rock reaches beyond the water's edge for a channel of this half-width, m. */
export function rockReach(halfWidth: number): number {
  return Math.min(ROCK_REACH_MAX, ROCK_REACH_BASE + ROCK_REACH_PER_WIDTH * halfWidth);
}

/**
 * Bare rock at a point near a channel (0..1): the bed's rock, over the channel and its banks out to rockReach, fading
 * over its last third. `edge` is the distance from the water's edge (m, negative in the water).
 */
export function rockAt(steepness: number, halfWidth: number, edge: number): number {
  const reach = rockReach(halfWidth);
  return bedRock(steepness) * (1 - smooth(reach * 0.6, reach, edge));
}

/** rockAt from a queryFlow hit (0 when no channel is in reach). */
export function rockOfHit(hit: FlowHit): number {
  if (!(hit.dist < Infinity) || hit.line < 0) return 0;
  return rockAt(hit.steepness, hit.halfWidth, hit.dist - hit.halfWidth);
}

/** GLSL twins of bedRock and rockReach (the ground shader). */
export const BEDROCK_GLSL = /* glsl */ `
float bedRock(float steep) { return smoothstep(${ROCK_STEEP_LO.toFixed(3)}, ${ROCK_STEEP_HI.toFixed(3)}, steep); }
float rockReach(float hw) { return min(${ROCK_REACH_MAX.toFixed(1)}, ${ROCK_REACH_BASE.toFixed(2)} + ${ROCK_REACH_PER_WIDTH.toFixed(3)} * hw); }
`;
