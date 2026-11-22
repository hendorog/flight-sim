// The wind-independent terrain data of one orography tile (tiles.ts): heights sampled on the TILE_N x TILE_N grid,
// the tile mean and relief, the blocking envelope and the valley-channelling tensor. Built once per terrain function
// and tile (cached in orographyField.ts; the worker builds the same data from the same function).
//
// Envelope (blocked flow, section 5.5 of the design): the highest terrain within ENVELOPE_RADIUS (a square window),
// box-smoothed over SMOOTH_HALF cells either side.
// Channelling: from the Hessian of the box-smoothed terrain, the cross-valley eigenvector n of the largest
// eigenvalue lambda1 > 0 and a = clamp((lambda1 - |lambda2|) / CHANNEL_CURVATURE, 0, 1); stored as a n n^T.

import { TILE_DX, TILE_N, WINDOW_N, WINDOW_START, nodePosition } from './tiles';

/** Blocking envelope: highest terrain within this distance (square window), m. */
const ENVELOPE_RADIUS = 6000;
/** Box smoothing of the envelope and of the terrain for the Hessian: cells either side (3 km box at 500 m). */
const SMOOTH_HALF = 3;
/** Curvature at which a valley channels fully, 1/m. Unconfirmed tuning (a 1000 m deep valley 6 km wide has ~2e-4). */
const CHANNEL_CURVATURE = 1e-4;
/** Relief below which a tile is flat (no waves, no channelling), m. */
export const FLAT_RELIEF = 1;

export interface TileTerrain {
  ti: number;
  tj: number;
  /** Raw heights MSL, TILE_N x TILE_N, row = north. */
  h: Float64Array;
  /** Mean height of the grid, m MSL. */
  mean: number;
  /** max - min of the heights after removing the least-squares plane, m. */
  relief: number;
  /** Blocking envelope over the whole grid (null when flat). */
  envelope: Float32Array | null;
  /** Window grids (WINDOW_N^2): the envelope and the channelling tensor a n n^T (nn, ne, ee); null when flat. */
  envWindow: Float32Array | null;
  chanNN: Float32Array | null;
  chanNE: Float32Array | null;
  chanEE: Float32Array | null;
}

/** Fit h = c0 + c1 i + c2 j (grid indices) by least squares on a TILE_N x TILE_N grid; returns [c0, c1, c2]. */
export function planeFit(h: ArrayLike<number>): [number, number, number] {
  const n = TILE_N;
  let s = 0;
  let si = 0;
  let sj = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = h[i * n + j];
      s += v;
      si += v * (i - (n - 1) / 2);
      sj += v * (j - (n - 1) / 2);
    }
  }
  // Centred indices are orthogonal: sum (i - c)^2 over the grid = n * n (n^2 - 1) / 12.
  const sxx = (n * n * (n * n - 1)) / 12;
  const c1 = si / sxx;
  const c2 = sj / sxx;
  const c0 = s / (n * n) - (c1 * (n - 1)) / 2 - (c2 * (n - 1)) / 2;
  return [c0, c1, c2];
}

/** Sliding max over `half` cells either side along rows (axis 0) or columns (axis 1), clamped at the edges. */
function slidingMax(src: Float64Array, dst: Float64Array, half: number, axis: 0 | 1): void {
  const n = TILE_N;
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      let m = -Infinity;
      const lo = Math.max(0, b - half);
      const hi = Math.min(n - 1, b + half);
      for (let c = lo; c <= hi; c++) {
        const v = axis === 1 ? src[a * n + c] : src[c * n + a];
        if (v > m) m = v;
      }
      if (axis === 1) dst[a * n + b] = m;
      else dst[b * n + a] = m;
    }
  }
}

/** Box mean over `half` cells either side along one axis, clamped at the edges. */
function boxMean(src: Float64Array, dst: Float64Array, half: number, axis: 0 | 1): void {
  const n = TILE_N;
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      let s = 0;
      let c = 0;
      const lo = Math.max(0, b - half);
      const hi = Math.min(n - 1, b + half);
      for (let k = lo; k <= hi; k++) {
        s += axis === 1 ? src[a * n + k] : src[k * n + a];
        c++;
      }
      if (axis === 1) dst[a * n + b] = s / c;
      else dst[b * n + a] = s / c;
    }
  }
}

/** Sample the terrain and derive the wind-independent tile data. */
export function buildTileTerrain(heightAt: (north: number, east: number) => number, ti: number, tj: number): TileTerrain {
  const n = TILE_N;
  const h = new Float64Array(n * n);
  const pos = new Float64Array(2);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      nodePosition(ti, tj, i, j, pos);
      const v = heightAt(pos[0], pos[1]);
      h[i * n + j] = v;
      sum += v;
    }
  }
  const mean = sum / (n * n);
  const [c0, c1, c2] = planeFit(h);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const r = h[i * n + j] - (c0 + c1 * i + c2 * j);
      if (r < lo) lo = r;
      if (r > hi) hi = r;
    }
  }
  const relief = hi - lo;
  const t: TileTerrain = { ti, tj, h, mean, relief, envelope: null, envWindow: null, chanNN: null, chanNE: null, chanEE: null };
  if (!(relief >= FLAT_RELIEF)) return t;

  // Envelope: separable max, then a separable box mean.
  const a = new Float64Array(n * n);
  const b = new Float64Array(n * n);
  const r = Math.round(ENVELOPE_RADIUS / TILE_DX);
  slidingMax(h, a, r, 1);
  slidingMax(a, b, r, 0);
  boxMean(b, a, SMOOTH_HALF, 1);
  boxMean(a, b, SMOOTH_HALF, 0);
  t.envelope = Float32Array.from(b);

  // Smoothed terrain for the Hessian.
  const s = new Float64Array(n * n);
  boxMean(h, a, SMOOTH_HALF, 1);
  boxMean(a, s, SMOOTH_HALF, 0);

  const W = WINDOW_N;
  t.envWindow = new Float32Array(W * W);
  t.chanNN = new Float32Array(W * W);
  t.chanNE = new Float32Array(W * W);
  t.chanEE = new Float32Array(W * W);
  const dx2 = TILE_DX * TILE_DX;
  for (let wi = 0; wi < W; wi++) {
    for (let wj = 0; wj < W; wj++) {
      const i = WINDOW_START + wi;
      const j = WINDOW_START + wj;
      const o = wi * W + wj;
      t.envWindow[o] = t.envelope[i * n + j];
      const c = s[i * n + j];
      const hxx = (s[(i + 1) * n + j] - 2 * c + s[(i - 1) * n + j]) / dx2;
      const hyy = (s[i * n + j + 1] - 2 * c + s[i * n + j - 1]) / dx2;
      const hxy = (s[(i + 1) * n + j + 1] - s[(i + 1) * n + j - 1] - s[(i - 1) * n + j + 1] + s[(i - 1) * n + j - 1]) / (4 * dx2);
      // Eigenvalues of [[hxx, hxy], [hxy, hyy]].
      const m = 0.5 * (hxx + hyy);
      const d = Math.hypot(0.5 * (hxx - hyy), hxy);
      const l1 = m + d;
      const l2 = m - d;
      if (!(l1 > 0)) continue;
      const strength = Math.min(1, Math.max(0, (l1 - Math.abs(l2)) / CHANNEL_CURVATURE));
      if (strength === 0) continue;
      // Eigenvector of l1: (hxy, l1 - hxx) or (l1 - hyy, hxy), whichever is longer.
      let vx = hxy;
      let vy = l1 - hxx;
      if (Math.hypot(vx, vy) < Math.hypot(l1 - hyy, hxy)) {
        vx = l1 - hyy;
        vy = hxy;
      }
      const len = Math.hypot(vx, vy);
      if (!(len > 0)) continue;
      vx /= len;
      vy /= len;
      t.chanNN[o] = strength * vx * vx;
      t.chanNE[o] = strength * vx * vy;
      t.chanEE[o] = strength * vy * vy;
    }
  }
  return t;
}

/** Bilinear terrain height of the tile grid at grid coordinates (x, y) in cells (clamped to the grid). */
export function gridHeight(t: TileTerrain, x: number, y: number): number {
  const n = TILE_N;
  const max = n - 1;
  if (x < 0) x = 0;
  else if (x > max) x = max;
  if (y < 0) y = 0;
  else if (y > max) y = max;
  let i = Math.floor(x);
  let j = Math.floor(y);
  if (i >= max) i = max - 1;
  if (j >= max) j = max - 1;
  const fx = x - i;
  const fy = y - j;
  const o = i * n + j;
  const a = t.h[o];
  const b = t.h[o + n];
  const c = t.h[o + 1];
  const d = t.h[o + n + 1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
