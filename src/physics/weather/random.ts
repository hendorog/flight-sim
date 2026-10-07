// Deterministic hashing and pseudo-random numbers for the procedural weather and surface models. Everything
// random in the environment derives from a seed through these functions, so a run is reproducible.

/** lowbias32 integer hash (C. Wellons, "Prospecting for hash functions", 2018): full avalanche, cheap. */
export function hashU32(x: number): number {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Hash of a seed and up to three integers into [0, 1). */
export function hashUnit(seed: number, a: number, b = 0, c = 0): number {
  let h = hashU32(seed ^ 0x9e3779b9);
  h = hashU32(h ^ (a | 0));
  h = hashU32(h ^ Math.imul(b | 0, 0x85ebca6b));
  h = hashU32(h ^ Math.imul(c | 0, 0xc2b2ae35));
  return h / 4294967296;
}

/** mulberry32 generator: a seeded stream of uniform numbers in [0, 1). */
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

export interface NoiseSample {
  value: number;
  /** Partial derivatives with respect to the two input coordinates. */
  dx: number;
  dy: number;
}

/**
 * 2-D value noise in [-1, 1] on a unit lattice with quintic (C2) interpolation, plus its analytic gradient.
 */
export function valueNoise2(seed: number, x: number, y: number, out: NoiseSample): NoiseSample {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const a = hashUnit(seed, i, j) * 2 - 1;
  const b = hashUnit(seed, i + 1, j) * 2 - 1;
  const c = hashUnit(seed, i, j + 1) * 2 - 1;
  const d = hashUnit(seed, i + 1, j + 1) * 2 - 1;
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const dsx = 30 * fx * fx * (fx - 1) * (fx - 1);
  const dsy = 30 * fy * fy * (fy - 1) * (fy - 1);
  const k = a - b - c + d;
  out.value = a + (b - a) * sx + (c - a) * sy + k * sx * sy;
  out.dx = (b - a + k * sy) * dsx;
  out.dy = (c - a + k * sx) * dsy;
  return out;
}
