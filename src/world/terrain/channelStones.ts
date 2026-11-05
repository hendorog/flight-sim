// The stones in a fast channel's bed (a seeded world's rapids and cascades): one lattice in the channel's own
// coordinates - along its arc length s (RiverLine.s, the ribbon's aRiverInfo.y) and across it (x, + toward the right
// bank looking downstream, the ribbon's aRiverInfo.x) - with at most one stone per cell, chosen by an integer hash of
// the cell (noise.ts hash2i, its GLSL twin hash2u). The boulder fields (vegetation/boulders.ts) place a rock on each,
// and the water's shader (water.ts flowFragment) breaks the water white round each one from the same numbers: a
// collar and a pillow round a rock standing out of the water, a boil downstream of one just under it, a wake trailing
// downstream of both. How many there are comes from the channel's steepness, how big from its bed's grain
// (RiverLine.grain, falls.ts bedGrain: the typical stone, m), both as the ribbon carries them per row (bytes, so the
// rocks and the foam read the same values). Pure and three.js-free. Seed 0 has no flow data and never runs this.

import { hash2i } from './noise';
import { seedSaltX, seedSaltY } from '../worldSeed';

/** Cell size along the channel and across it, m. */
export const STONE_ALONG = 5;
export const STONE_ACROSS = 4;
/** Steepness (streams.ts steepnessOf: 0.5 the start of rapids, 0.75 step-pool) over which stones fill in, and their most. */
export const STONE_STEEP_LO = 0.5;
export const STONE_STEEP_HI = 0.88;
export const STONE_FILL = 0.85;
/** Stones stand only this far out across the channel (a share of its half-width): in the water. */
export const STONE_IN = 0.88;
/** Share of the stones lying just under the surface (a boil and a wake, no rock showing). */
export const STONE_SUBMERGED = 0.3;
/** Smallest and largest stone, m (radius at the waterline). */
export const STONE_R_MIN = 0.1;
export const STONE_R_MAX = 2.6;
/** The ribbon's grain byte: grain = GRAIN_TOP * (byte / 255)^2, m. */
export const GRAIN_TOP = 6;

/** Grain (m) to the ribbon's unorm byte (0..1) and back. */
export const grainToUnit = (g: number): number => Math.sqrt(Math.min(1, Math.max(0, g / GRAIN_TOP)));
export const unitToGrain = (u: number): number => GRAIN_TOP * u * u;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Share of cells holding a stone at this steepness. */
export function stonePresence(steep: number): number {
  return STONE_FILL * smooth(STONE_STEEP_LO, STONE_STEEP_HI, steep);
}

/** One cell's stone (written by stoneAt). */
export interface ChannelStone {
  /** Its centre along (arc length, m) and across (m, + right bank). */
  s: number;
  x: number;
  /** Radius at the waterline, m. */
  r: number;
  /** Just under the surface (no rock shows). */
  submerged: boolean;
  /** How far its top stands out of the water, m (rocks only; the shader does not need it). */
  stand: number;
  /** Two more uniform numbers for its shape, turn and tone. */
  u7: number;
  u8: number;
}

const f16 = (h: number): number => (h & 0xffff) / 65536;
const g16 = (h: number): number => (h >>> 16) / 65536;
/** The cell's hashes (j offset so the hashed input stays positive: GLSL's int-to-uint of a negative is avoided). */
const cellHash = (k: number, j: number, q: number): number => hash2i(k, 4 * (j + 64) + q);

/**
 * The stone of cell (k along, j across), given the steepness and grain there (as the ribbon carries them) and the
 * half-width; false where the cell holds none.
 */
export function stoneAt(k: number, j: number, steep: number, grain: number, halfWidth: number, out: ChannelStone): boolean {
  const h0 = cellHash(k, j, 0);
  if (f16(h0) >= stonePresence(steep)) return false;
  const h1 = cellHash(k, j, 1);
  const h2 = cellHash(k, j, 2);
  out.s = (k + 0.5 + 0.8 * (g16(h0) - 0.5)) * STONE_ALONG;
  out.x = (j + 0.8 * (f16(h1) - 0.5)) * STONE_ACROSS;
  if (Math.abs(out.x) > STONE_IN * halfWidth) return false;
  out.r = Math.min(STONE_R_MAX, Math.max(STONE_R_MIN, 0.5 * grain * (0.45 + 1.25 * Math.pow(g16(h1), 1.7))));
  out.submerged = f16(h2) < STONE_SUBMERGED;
  out.stand = out.r * (0.55 + 0.7 * g16(h2));
  const h3 = cellHash(k, j, 3);
  out.u7 = f16(h3);
  out.u8 = g16(h3);
  return true;
}

/**
 * GLSL of the lattice (needs HASH_GLSL's hash2u): chStone(k, j, steep, grain, hw) -> vec4(s, x, r, submerged ? 1 : 0)
 * with r < 0 where the cell holds none. The world seed's hash salt is baked in (hash2i adds it in JS).
 */
export function channelStonesGlsl(): string {
  return /* glsl */ `
const float CH_ALONG = ${STONE_ALONG.toFixed(1)};
const float CH_ACROSS = ${STONE_ACROSS.toFixed(1)};
uint chHash(int k, int j, int q) { return hash2u(k + ${seedSaltX()}, 4 * (j + 64) + q + ${seedSaltY()}); }
float chF(uint h) { return float(h & 0xffffu) * (1.0 / 65536.0); }
float chG(uint h) { return float(h >> 16) * (1.0 / 65536.0); }
float chPresence(float steep) { return ${STONE_FILL.toFixed(2)} * smoothstep(${STONE_STEEP_LO.toFixed(2)}, ${STONE_STEEP_HI.toFixed(2)}, steep); }
vec4 chStone(int k, int j, float steep, float grain, float hw) {
  uint h0 = chHash(k, j, 0);
  if (chF(h0) >= chPresence(steep)) return vec4(0.0, 0.0, -1.0, 0.0);
  uint h1 = chHash(k, j, 1);
  uint h2 = chHash(k, j, 2);
  float s = (float(k) + 0.5 + 0.8 * (chG(h0) - 0.5)) * CH_ALONG;
  float x = (float(j) + 0.8 * (chF(h1) - 0.5)) * CH_ACROSS;
  if (abs(x) > ${STONE_IN.toFixed(2)} * hw) return vec4(0.0, 0.0, -1.0, 0.0);
  float r = clamp(0.5 * grain * (0.45 + 1.25 * pow(chG(h1), 1.7)), ${STONE_R_MIN.toFixed(2)}, ${STONE_R_MAX.toFixed(2)});
  return vec4(s, x, r, chF(h2) < ${STONE_SUBMERGED.toFixed(2)} ? 1.0 : 0.0);
}
`;
}
