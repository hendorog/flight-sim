// The stones in a fast channel's bed (a seeded world's rapids and cascades): two lattices in the channel's own
// coordinates - along its arc length s (RiverLine.s, the ribbon's aRiverInfo.y) and across it (x, + toward the right
// bank looking downstream, the ribbon's aRiverInfo.x) - with at most one stone per cell, chosen by an integer hash of
// the cell (noise.ts hash2i, its GLSL twin hash2u): a fine one of boulders and cobbles, and a coarse one of the few
// very large blocks. The boulder fields (vegetation/boulders.ts) place a rock on each, and the water's shader (water.ts
// flowFragment) breaks the water white round each one from the same numbers: a collar and a pillow round a rock
// standing out of the water, a boil downstream of one just under it, a wake trailing downstream of both.
//
// How many there are comes from the channel's steepness (none below rapids), and where they lie is uneven: they lie in
// clumps along the channel (a smooth hashed field over STONE_CLUMP cells), and on a stream cut into pitches and pools
// (pitchPool.ts) they crowd onto the pitches and the plunge below each, the biggest there, leaving the pools mostly
// clear water. How big from the bed's grain (RiverLine.grain, falls.ts bedGrain: the typical stone, m, graded down the
// network), with a long tail: many middling, a few several times the grain. The bank stones (boulders.ts) take the
// same size law and clumps, so the bed's and the banks' rocks read as one population. Steepness, grain, half-width
// and the pitches' unit coordinate come as the ribbon carries them per row (water.ts: aFlow bytes, aPitch floats), so
// the rocks and the foam read the same values. Pure and three.js-free. Seed 0 has no flow data and never runs this.

import { hash2i } from './noise';
import { seedSaltX, seedSaltY } from '../worldSeed';
import { pitchGlsl, pitchPhase, type PitchPhase } from './pitchPool';

/** Cell size along the channel and across it, m. */
export const STONE_ALONG = 4.5;
export const STONE_ACROSS = 3.5;
/** Steepness (streams.ts steepnessOf: 0.5 the start of rapids, 0.75 step-pool) over which stones fill in, and their most. */
export const STONE_STEEP_LO = 0.5;
export const STONE_STEEP_HI = 0.82;
export const STONE_FILL = 0.95;
/** Stones stand only this far out across the channel (a share of its half-width): in the water. */
export const STONE_IN = 0.88;
/** Share of the stones lying just under the surface (a boil and a wake, no rock showing). */
export const STONE_SUBMERGED = 0.3;
/** Smallest and largest stone of the fine lattice, m (radius at the waterline). */
export const STONE_R_MIN = 0.1;
export const STONE_R_MAX = 2.6;
/** The ribbon's grain byte: grain = GRAIN_TOP * (byte / 255)^2, m. */
export const GRAIN_TOP = 6;
/** The clumps: a smooth field along the channel over this many cells (a hash per STONE_CLUMP cells, eased between). */
export const STONE_CLUMP = 5;
/**
 * The coarse lattice of very large blocks: cells BIG_ALONG by BIG_ACROSS m, a block in some where the bed's grain is
 * coarse (from BIG_GRAIN_LO, fully at BIG_GRAIN_HI), BIG_R_MIN to BIG_R_MAX m across at the waterline, never more than
 * 0.6 of the half-width plus 1.2 m (a block too big for a small stream would dam it).
 */
export const BIG_ALONG = 14;
export const BIG_ACROSS = 10;
export const BIG_GRAIN_LO = 0.7;
export const BIG_GRAIN_HI = 2.5;
export const BIG_R_MIN = 2;
export const BIG_R_MAX = 4.8;
const BIG_SHARE = 0.5;

/** Grain (m) to the ribbon's unorm byte (0..1) and back. */
export const grainToUnit = (g: number): number => Math.sqrt(Math.min(1, Math.max(0, g / GRAIN_TOP)));
export const unitToGrain = (u: number): number => GRAIN_TOP * u * u;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Share of cells holding a stone at this steepness (before the clumps and the pitches). */
export function stonePresence(steep: number): number {
  return STONE_FILL * smooth(STONE_STEEP_LO, STONE_STEEP_HI, steep);
}

/**
 * How much of a stream's unit (pitchPool.ts pitchPhase) is pitch at a point: 1 from just over its lip to its foot and
 * through the plunge below it, falling away into the pool (0 over the pool's body and its tail).
 */
export function pitchWeight(p: PitchPhase): number {
  return smooth(-0.04, 0.02, p.u) * (1 - smooth(p.pitch + 0.04, p.pitch + 0.2, p.u));
}

/** The size law: a stone's radius over half the grain for a uniform number u (many middling, a long tail of big ones). */
export const sizeLaw = (u: number): number => 0.4 + 1.6 * u * u * u;

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
/** The clump field at fine row k (0..1, eased between a hash every STONE_CLUMP rows). */
export function clumpAt(k: number): number {
  const kk = k + 64 * STONE_CLUMP;
  const K = Math.floor(kk / STONE_CLUMP);
  const t = (kk - K * STONE_CLUMP) / STONE_CLUMP;
  const a = f16(cellHash(K, -61, 0));
  const b = f16(cellHash(K + 1, -61, 0));
  const e = t * t * (3 - 2 * t);
  return a + (b - a) * e;
}

/** A stream's pitches about a stone: how much of it is cut into units (`on`) and its unit coordinate at arc length s. */
export interface StonePitch {
  on: number;
  sigmaAt: (s: number) => number;
}
const phase: PitchPhase = { k: 0, u: 0, pitch: 0, span: 1, size: 1 };
/** The pitch weight at arc length s, the less on a small unit (0 where the water is not cut into units). */
function pitchAt(p: StonePitch | undefined, s: number): number {
  if (!p || p.on <= 0) return 0;
  const ph = pitchPhase(p.sigmaAt(s), phase);
  return pitchWeight(ph) * (0.45 + 0.55 * ph.size);
}

/**
 * The stone of fine cell (k along, j across), given the steepness and grain there (as the ribbon carries them), the
 * half-width and a stream's pitches; false where the cell holds none.
 */
export function stoneAt(k: number, j: number, steep: number, grain: number, halfWidth: number, out: ChannelStone, pitch?: StonePitch): boolean {
  const base = stonePresence(steep);
  if (base <= 0) return false;
  const h0 = cellHash(k, j, 0);
  const s = (k + 0.5 + 0.8 * (g16(h0) - 0.5)) * STONE_ALONG;
  const c = clumpAt(k);
  const on = pitch ? pitch.on : 0;
  const pw = on > 0 ? pitchAt(pitch, s) : 0;
  // Clumped; on a stream's units crowded onto the pitches, few in the pools.
  const mod = (1 - on) * (0.25 + 1.1 * c * Math.sqrt(c)) + on * (0.07 + 0.85 * pw) * (0.5 + 0.5 * c);
  if (f16(h0) >= Math.min(0.97, base * mod)) return false;
  const h1 = cellHash(k, j, 1);
  const h2 = cellHash(k, j, 2);
  out.s = s;
  out.x = (j + 0.8 * (f16(h1) - 0.5)) * STONE_ACROSS;
  if (Math.abs(out.x) > STONE_IN * halfWidth) return false;
  const u = g16(h1);
  out.r = Math.min(STONE_R_MAX, Math.max(STONE_R_MIN, 0.5 * grain * sizeLaw(u) * (1 + on * (0.45 * pw - 0.2))));
  out.submerged = f16(h2) < STONE_SUBMERGED;
  out.stand = out.r * (0.55 + 0.7 * g16(h2));
  const h3 = cellHash(k, j, 3);
  out.u7 = f16(h3);
  out.u8 = g16(h3);
  return true;
}

/** The coarse lattice's hashes (rows offset well clear of the fine lattice's). */
const bigHash = (k: number, j: number, q: number): number => hash2i(k + 16384, 4 * (j + 64) + q);

/**
 * The very large block of coarse cell (k along, j across), as stoneAt (never submerged); false where it holds none.
 */
export function bigStoneAt(k: number, j: number, steep: number, grain: number, halfWidth: number, out: ChannelStone, pitch?: StonePitch): boolean {
  const base = stonePresence(steep) * smooth(BIG_GRAIN_LO, BIG_GRAIN_HI, grain);
  if (base <= 0) return false;
  const h0 = bigHash(k, j, 0);
  const s = (k + 0.5 + 0.8 * (g16(h0) - 0.5)) * BIG_ALONG;
  const on = pitch ? pitch.on : 0;
  const pw = on > 0 ? pitchAt(pitch, s) : 0;
  if (f16(h0) >= BIG_SHARE * base * ((1 - on) * 0.5 + on * (0.12 + 1.2 * pw))) return false;
  const h1 = bigHash(k, j, 1);
  out.s = s;
  out.x = (j + 0.8 * (f16(h1) - 0.5)) * BIG_ACROSS;
  if (Math.abs(out.x) > STONE_IN * halfWidth) return false;
  out.r = Math.min(BIG_R_MAX, 0.6 * halfWidth + 1.2, Math.max(BIG_R_MIN, 0.75 * grain * (1 + 0.9 * g16(h1))));
  out.submerged = false;
  const h2 = bigHash(k, j, 2);
  out.stand = out.r * (0.5 + 0.5 * g16(h2));
  out.u7 = f16(h2);
  out.u8 = g16(bigHash(k, j, 3));
  return true;
}

/**
 * Steps across a step-pool river's reach (a channel not cut into units: the rivers): some lattice rows are a line of
 * stones the water pours over (a pitch break), drawn by the shader as a glassy tongue over the lip and a white band of
 * broken water below it. This share of the rows at full steepness (none below STEP_STEEP_LO), at row k's own position
 * along (stepAt).
 */
export const STEP_SHARE = 0.3;
export const STEP_STEEP_LO = 0.68;
export const STEP_STEEP_HI = 0.95;
/** Row k's step along the channel (arc length, m), or -1 where row k has none at this steepness. */
export function stepAt(k: number, steep: number): number {
  const h = cellHash(k, -63, 0);
  if (f16(h) >= STEP_SHARE * smooth(STEP_STEEP_LO, STEP_STEEP_HI, steep)) return -1;
  return (k + 0.2 + 0.6 * g16(h)) * STONE_ALONG;
}

/**
 * GLSL of the lattices (needs HASH_GLSL's hash2u): chStone(k, j, steep, grain, hw, on, sig0, s0, dSig) and
 * chBig(...) -> vec4(s, x, r, submerged ? 1 : 0) with r < 0 where the cell holds none; a stream's unit coordinate at a
 * stone's arc length s is sig0 + (s - s0) * dSig (the fragment's, and its rate along the channel). Also pitchPhase and
 * chPitchW (pitchWeight). The world seed's hash salt is baked in (hash2i adds it in JS).
 */
export function channelStonesGlsl(): string {
  return /* glsl */ `${pitchGlsl(seedSaltX(), seedSaltY())}
const float CH_ALONG = ${STONE_ALONG.toFixed(1)};
const float CH_ACROSS = ${STONE_ACROSS.toFixed(1)};
const float CH_BIG_ALONG = ${BIG_ALONG.toFixed(1)};
const float CH_BIG_ACROSS = ${BIG_ACROSS.toFixed(1)};
uint chHash(int k, int j, int q) { return hash2u(k + ${seedSaltX()}, 4 * (j + 64) + q + ${seedSaltY()}); }
float chF(uint h) { return float(h & 0xffffu) * (1.0 / 65536.0); }
float chG(uint h) { return float(h >> 16) * (1.0 / 65536.0); }
float chPresence(float steep) { return ${STONE_FILL.toFixed(2)} * smoothstep(${STONE_STEEP_LO.toFixed(2)}, ${STONE_STEEP_HI.toFixed(2)}, steep); }
float chClump(int k) {
  int kk = k + ${64 * STONE_CLUMP};
  int K = kk / ${STONE_CLUMP};
  float t = float(kk - K * ${STONE_CLUMP}) / ${STONE_CLUMP.toFixed(1)};
  float a = chF(chHash(K, -61, 0));
  float b = chF(chHash(K + 1, -61, 0));
  return a + (b - a) * (t * t * (3.0 - 2.0 * t));
}
float chPitchW(vec4 ph) { return smoothstep(-0.04, 0.02, ph.x) * (1.0 - smoothstep(ph.y + 0.04, ph.y + 0.2, ph.x)); }
float chPitchAt(float on, float sig) {
  if (on <= 0.0) return 0.0;
  vec4 ph = pitchPhase(sig);
  return chPitchW(ph) * (0.45 + 0.55 * ph.w);
}
vec4 chStone(int k, int j, float steep, float grain, float hw, float on, float sig0, float s0, float dSig) {
  float base = chPresence(steep);
  uint h0 = chHash(k, j, 0);
  float s = (float(k) + 0.5 + 0.8 * (chG(h0) - 0.5)) * CH_ALONG;
  float c = chClump(k);
  float pw = chPitchAt(on, sig0 + (s - s0) * dSig);
  float pmod = (1.0 - on) * (0.25 + 1.1 * c * sqrt(c)) + on * (0.07 + 0.85 * pw) * (0.5 + 0.5 * c);
  if (chF(h0) >= min(0.97, base * pmod)) return vec4(0.0, 0.0, -1.0, 0.0);
  uint h1 = chHash(k, j, 1);
  uint h2 = chHash(k, j, 2);
  float x = (float(j) + 0.8 * (chF(h1) - 0.5)) * CH_ACROSS;
  if (abs(x) > ${STONE_IN.toFixed(2)} * hw) return vec4(0.0, 0.0, -1.0, 0.0);
  float u = chG(h1);
  float r = clamp(0.5 * grain * (0.4 + 1.6 * u * u * u) * (1.0 + on * (0.45 * pw - 0.2)), ${STONE_R_MIN.toFixed(2)}, ${STONE_R_MAX.toFixed(2)});
  return vec4(s, x, r, chF(h2) < ${STONE_SUBMERGED.toFixed(2)} ? 1.0 : 0.0);
}
uint chBigHash(int k, int j, int q) { return hash2u(k + 16384 + ${seedSaltX()}, 4 * (j + 64) + q + ${seedSaltY()}); }
vec4 chBig(int k, int j, float steep, float grain, float hw, float on, float sig0, float s0, float dSig) {
  float base = chPresence(steep) * smoothstep(${BIG_GRAIN_LO.toFixed(2)}, ${BIG_GRAIN_HI.toFixed(2)}, grain);
  uint h0 = chBigHash(k, j, 0);
  float s = (float(k) + 0.5 + 0.8 * (chG(h0) - 0.5)) * CH_BIG_ALONG;
  float pw = chPitchAt(on, sig0 + (s - s0) * dSig);
  if (chF(h0) >= ${BIG_SHARE.toFixed(2)} * base * ((1.0 - on) * 0.5 + on * (0.12 + 1.2 * pw))) return vec4(0.0, 0.0, -1.0, 0.0);
  uint h1 = chBigHash(k, j, 1);
  float x = (float(j) + 0.8 * (chF(h1) - 0.5)) * CH_BIG_ACROSS;
  if (abs(x) > ${STONE_IN.toFixed(2)} * hw) return vec4(0.0, 0.0, -1.0, 0.0);
  float r = min(min(${BIG_R_MAX.toFixed(2)}, 0.6 * hw + 1.2), max(${BIG_R_MIN.toFixed(2)}, 0.75 * grain * (1.0 + 0.9 * chG(h1))));
  return vec4(s, x, r, 0.0);
}
float chStep(int k, float steep) {
  uint h = chHash(k, -63, 0);
  if (chF(h) >= ${STEP_SHARE.toFixed(2)} * smoothstep(${STEP_STEEP_LO.toFixed(2)}, ${STEP_STEEP_HI.toFixed(2)}, steep)) return -1.0;
  return (float(k) + 0.2 + 0.6 * chG(h)) * CH_ALONG;
}
`;
}
