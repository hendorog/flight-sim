// Bare rock along fast water (a seeded world's channels only; seed 0 has no flow data and none of this runs).
//
// Where a channel loses height quickly (rapids, cascades, step-pools, falls) the water scours its bed and banks down
// to bedrock: no silt, gravel bars, reeds or bank grass, and fewer bank trees. How much is bare comes from the
// channel's steepness (Hydrology.queryFlow, streams.ts steepnessOf: a quarter per kind of flow), how far beyond the
// water's edge from its size. The same numbers are used by the terrain tiles (tileBuilder.ts: the steepness per
// vertex, aFlow), the ground shader (terrainMaterial.ts, BEDROCK_GLSL), tree placement (vegetation/placement.ts) and
// the boulder fields (vegetation/boulders.ts). Pure and three.js-free.

import type { FlowHit } from './hydrology';
import { hash2i } from './noise';

/**
 * Steepness over which the bed turns from gravel and silt to bare rock (streams.ts steepnessOf: 0.5 is the start of
 * rapids, 2 %; 0.78 a step-pool cascade of 10 %): riffles stay gravel, rapids turn rocky, cascades are bare rock.
 */
export const ROCK_STEEP_LO = 0.5;
export const ROCK_STEEP_HI = 0.78;
/**
 * The rock reaches this far beyond the water's edge: a base plus a multiple of the half-width, capped, m - the scoured
 * bank the floods keep bare; its ragged edge (rockAtPoint) takes it RAG_MIN to RAG_MIN + 1 times as far.
 */
export const ROCK_REACH_BASE = 3;
export const ROCK_REACH_PER_WIDTH = 0.9;
export const ROCK_REACH_MAX = 16;
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

/**
 * The bare rock's ragged edge: its reach at a point is rockReach times RAG_MIN..RAG_MIN + 1 by a value noise of the
 * world position (two octaves, RAG_CELL_A and RAG_CELL_B m cells, on the integer hash the shaders share), so the rock
 * gives way to the woods in tongues and bays, not along a ruled line. The ground shader (ROCK_EDGE_GLSL) and the tree
 * placement (rockAtPoint) read the same numbers, so no tree stands on the rock.
 */
export const RAG_MIN = 0.45;
const RAG_CELL_A = 11;
const RAG_CELL_B = 4.3;
/** Where the rock gives way to soil: over the outer RAG_EDGE of its (ragged) reach. */
const RAG_EDGE = 0.3;

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number): number => (hash2i(a, b) >>> 8) / 16777216;
  const a = h(ix, iy);
  const b = h(ix + 1, iy);
  const c = h(ix, iy + 1);
  const d = h(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** The rock's ragged reach factor at a point (0..1, add RAG_MIN). */
export function rockRag(east: number, north: number): number {
  return 0.65 * valueNoise(east / RAG_CELL_A, north / RAG_CELL_A) + 0.35 * valueNoise(east / RAG_CELL_B + 17.3, north / RAG_CELL_B - 5.1);
}

/**
 * Bare rock at a point (east, north) near a channel, with the ragged edge (0..1): the bed's rock out to its reach there,
 * giving way over the outer RAG_EDGE of it. `edge` is the distance from the water's edge (m, negative in the water).
 */
export function rockAtPoint(steepness: number, halfWidth: number, edge: number, east: number, north: number): number {
  const bed = bedRock(steepness);
  if (bed <= 0) return 0;
  const reach = rockReach(halfWidth) * (RAG_MIN + rockRag(east, north));
  return bed * (1 - smooth(reach * (1 - RAG_EDGE), reach, edge));
}

/** GLSL twins of rockRag and the edge (the ground shader, after its salted hash2u: glsl.ts hashGlsl). */
export const ROCK_EDGE_GLSL = /* glsl */ `
float rockVN(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  float a = float(hash2u(c.x, c.y) >> 8) * (1.0 / 16777216.0);
  float b = float(hash2u(c.x + 1, c.y) >> 8) * (1.0 / 16777216.0);
  float d = float(hash2u(c.x, c.y + 1) >> 8) * (1.0 / 16777216.0);
  float e = float(hash2u(c.x + 1, c.y + 1) >> 8) * (1.0 / 16777216.0);
  return a + (b - a) * u.x + (d - a) * u.y + (a - b - d + e) * u.x * u.y;
}
// The rock's reach at a world point (east, north) for a channel of half-width hw, and its cover at edge m from the water.
float rockReachAt(float hw, vec2 en) {
  return rockReach(hw) * (${RAG_MIN.toFixed(2)} + 0.65 * rockVN(en * ${(1 / RAG_CELL_A).toFixed(6)}) + 0.35 * rockVN(en * ${(1 / RAG_CELL_B).toFixed(6)} + vec2(17.3, -5.1)));
}
float rockEdgeCover(float reach, float edge) { return 1.0 - smoothstep(reach * ${(1 - RAG_EDGE).toFixed(2)}, reach, edge); }
`;

/** GLSL twins of bedRock and rockReach (the ground shader). */
export const BEDROCK_GLSL = /* glsl */ `
float bedRock(float steep) { return smoothstep(${ROCK_STEEP_LO.toFixed(3)}, ${ROCK_STEEP_HI.toFixed(3)}, steep); }
float rockReach(float hw) { return min(${ROCK_REACH_MAX.toFixed(1)}, ${ROCK_REACH_BASE.toFixed(2)} + ${ROCK_REACH_PER_WIDTH.toFixed(3)} * hw); }
`;
