// Fast deterministic 2D noise for the heightfield. Pure JS (no three.js) so the same code runs in the
// physics, in tile-building workers and in node tests, giving bit-identical terrain everywhere.
//
// Gradient noise returns its analytic derivative through a caller-owned scratch object so hot loops do
// not allocate. The hash is a fixed permutation table (period 256 cells per octave); octaves are rotated
// and offset against each other so the period never shows.

import { onWorldSeed, seedSaltX, seedSaltY, worldSeed } from '../worldSeed';

/** Scratch for derivatives: d/dx and d/dy of the last noise evaluation. */
export interface Deriv {
  dx: number;
  dy: number;
}

/** Small deterministic PRNG (mulberry32), used only to build tables and place features. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit integer hash of two integers (lowbias32 finaliser); identical to the GLSL version in terrain shaders. */
export function hash2i(x: number, y: number): number {
  let h = (Math.imul(x + SALT_X, 0x27d4eb2d) ^ Math.imul(y + SALT_Y, 0x165667b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

// The world seed's salt on the hash inputs (worldSeed.ts; 0 for today's world).
let SALT_X = 0;
let SALT_Y = 0;
const PERM = new Int32Array(512);
const GX = new Float64Array(256);
const GY = new Float64Array(256);
/** The permutation and gradient tables, from a PRNG seeded by the world seed (today's tables at seed 0). */
function buildTables(): void {
  const rnd = mulberry32(worldSeed() === 0 ? 0x5eed1234 : (0x5eed1234 ^ hash2iRaw(worldSeed(), 0x5eed)) >>> 0);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) {
    const a = rnd() * Math.PI * 2;
    GX[i] = Math.cos(a);
    GY[i] = Math.sin(a);
  }
  SALT_X = seedSaltX();
  SALT_Y = seedSaltY();
}
function hash2iRaw(x: number, y: number): number {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  return (h ^ (h >>> 15)) >>> 0;
}
buildTables();
onWorldSeed(buildTables);

/**
 * 2D gradient (Perlin) noise with quintic fade, scaled to roughly [-1, 1].
 * If `d` is given, receives the analytic gradient with respect to (x, y).
 */
export function gnoise(x: number, y: number, d?: Deriv): number {
  const fx0 = Math.floor(x);
  const fy0 = Math.floor(y);
  const fx = x - fx0;
  const fy = y - fy0;
  const i = fx0 & 255;
  const j = fy0 & 255;
  const pi0 = PERM[i];
  const pi1 = PERM[i + 1];
  const ha = PERM[pi0 + j];
  const hb = PERM[pi1 + j];
  const hc = PERM[pi0 + j + 1];
  const hd = PERM[pi1 + j + 1];
  const gax = GX[ha], gay = GY[ha];
  const gbx = GX[hb], gby = GY[hb];
  const gcx = GX[hc], gcy = GY[hc];
  const gdx = GX[hd], gdy = GY[hd];
  const va = gax * fx + gay * fy;
  const vb = gbx * (fx - 1) + gby * fy;
  const vc = gcx * fx + gcy * (fy - 1);
  const vd = gdx * (fx - 1) + gdy * (fy - 1);
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const k = va - vb - vc + vd;
  const v = va + ux * (vb - va) + uy * (vc - va) + ux * uy * k;
  if (d) {
    const dux = 30 * fx * fx * (fx * (fx - 2) + 1);
    const duy = 30 * fy * fy * (fy * (fy - 2) + 1);
    d.dx = 1.4 * (gax + ux * (gbx - gax) + uy * (gcx - gax) + ux * uy * (gax - gbx - gcx + gdx) + dux * (uy * k + vb - va));
    d.dy = 1.4 * (gay + ux * (gby - gay) + uy * (gcy - gay) + ux * uy * (gay - gby - gcy + gdy) + duy * (ux * k + vc - va));
  }
  return 1.4 * v;
}

const TWO_PI = Math.PI * 2;

/**
 * One octave of the slope-aligned gully filter (Clay John's "eroded terrain noise", after Fewes).
 * Sums cosine stripes around jittered cell points, oriented so that crests and troughs run along
 * (dirX, dirY), the downhill direction; the stripe frequency grows with |dir| (steeper = more gullies).
 * Returns roughly [-1, 1]; `d` receives the (unscaled) stripe gradient used to branch the next octave.
 *
 * The original uses a Gaussian kernel truncated by the 4x4 cell window, which leaves ~1% steps along cell
 * edges. Here the kernel is (1 - r^2/R^2)^3 with R = 1.5: with cell points jittered by [0, 0.5) every
 * point closer than R lies inside the window, so the result is continuous.
 */
export function gullies(x: number, y: number, dirX: number, dirY: number, d: Deriv): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  let va = 0;
  let vx = 0;
  let vy = 0;
  let wt = 1e-6;
  for (let i = -2; i <= 1; i++) {
    for (let j = -2; j <= 1; j++) {
      const h = hash2i(ix - i, iy - j);
      const px = fx + i - (h & 0xffff) * (0.5 / 65536);
      const py = fy + j - (h >>> 16) * (0.5 / 65536);
      const q = 1 - (px * px + py * py) * (1 / 2.25);
      if (q <= 0) continue;
      const w = q * q * q;
      const phase = (px * dirY - py * dirX) * TWO_PI;
      const s = Math.sin(phase);
      va += Math.cos(phase) * w;
      vx -= s * dirY * w;
      vy += s * dirX * w;
      wt += w;
    }
  }
  const inv = 1 / wt;
  d.dx = vx * inv;
  d.dy = vy * inv;
  return va * inv;
}

/** sin(2 pi t) for t in [-0.5, 0.5] (folded onto a quarter turn, then a Taylor series: within 4e-6). */
function sinTurn(t: number): number {
  const f = t > 0.25 ? 0.5 - t : t < -0.25 ? -0.5 - t : t;
  const x = f * TWO_PI;
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 - x2 / 39916800)))));
}

/**
 * gullies (the same kernels, weights and stripes) for a seeded world's terrain, faster: the stripes' sine and cosine
 * from a series instead of Math.sin and Math.cos (to a few millionths), and the cells that cannot reach the point
 * (their jittered point is always beyond the kernel's radius) skipped before they are hashed. Seed 0 keeps gullies.
 */
export function gulliesFast(x: number, y: number, dirX: number, dirY: number, d: Deriv): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  let va = 0;
  let vx = 0;
  let vy = 0;
  let wt = 1e-6;
  for (let i = -2; i <= 1; i++) {
    // (A point's offset along x lies in [fx + i - 0.5, fx + i]: nearest 0 at the end closer to it.)
    const ex = fx + i > 0 ? fx + i - 0.5 : fx + i < 0 ? -(fx + i) : 0;
    const ex2 = ex > 0 ? ex * ex : 0;
    if (ex2 >= 2.25) continue;
    for (let j = -2; j <= 1; j++) {
      const ey = fy + j > 0 ? fy + j - 0.5 : fy + j < 0 ? -(fy + j) : 0;
      if (ex2 + (ey > 0 ? ey * ey : 0) >= 2.25) continue;
      const h = hash2i(ix - i, iy - j);
      const px = fx + i - (h & 0xffff) * (0.5 / 65536);
      const py = fy + j - (h >>> 16) * (0.5 / 65536);
      const q = 1 - (px * px + py * py) * (1 / 2.25);
      if (q <= 0) continue;
      const w = q * q * q;
      const turns = px * dirY - py * dirX;
      const t = turns - Math.round(turns);
      const s = sinTurn(t);
      const tc = t + 0.25;
      const c = sinTurn(tc > 0.5 ? tc - 1 : tc);
      va += c * w;
      vx -= s * dirY * w;
      vy += s * dirX * w;
      wt += w;
    }
  }
  const inv = 1 / wt;
  d.dx = vx * inv;
  d.dy = vy * inv;
  return va * inv;
}

// Octave rotation (about 36.87 degrees, the 3-4-5 triangle) times the lacunarity; breaks grid alignment.
const ROT_C = 0.8;
const ROT_S = 0.6;

/** Plain fBm of gradient noise, roughly [-1, 1]. Frequencies in cycles per unit of the input. */
export function fbm(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * gnoise(x, y);
    norm += amp;
    amp *= gain;
    const nx = (ROT_C * x - ROT_S * y) * lacunarity + 17.3;
    y = (ROT_S * x + ROT_C * y) * lacunarity - 9.1;
    x = nx;
  }
  return sum / norm;
}

/**
 * fbm with its gradient (per unit of the input, into `d`): the same value as fbm, bit for bit (the same octaves summed
 * in the same order), for a gradient of the fields built on it (seededLayout.ts macroGradAt).
 */
export function fbmGrad(x: number, y: number, octaves: number, d: Deriv, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let gx = 0;
  let gy = 0;
  // The octave's coordinates' Jacobian against the input's (rotated and scaled each octave).
  let jxx = 1;
  let jxy = 0;
  let jyx = 0;
  let jyy = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * gnoise(x, y, FD);
    gx += amp * (FD.dx * jxx + FD.dy * jyx);
    gy += amp * (FD.dx * jxy + FD.dy * jyy);
    norm += amp;
    amp *= gain;
    const nx = (ROT_C * x - ROT_S * y) * lacunarity + 17.3;
    y = (ROT_S * x + ROT_C * y) * lacunarity - 9.1;
    x = nx;
    const axx = (ROT_C * jxx - ROT_S * jyx) * lacunarity;
    const axy = (ROT_C * jxy - ROT_S * jyy) * lacunarity;
    jyx = (ROT_S * jxx + ROT_C * jyx) * lacunarity;
    jyy = (ROT_S * jxy + ROT_C * jyy) * lacunarity;
    jxx = axx;
    jxy = axy;
  }
  d.dx = gx / norm;
  d.dy = gy / norm;
  return sum / norm;
}
const FD: Deriv = { dx: 0, dy: 0 };
