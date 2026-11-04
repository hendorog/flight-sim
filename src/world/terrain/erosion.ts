// Fluvial erosion of a seeded world's macro terrain (any seed but 0), worked out at load on the drainage lattice
// (drainage.ts: DRAIN_CELL over +-DOMAIN_HALF). Pure (no three.js): every thread runs it and gets the same answer.
//
// The noise terrain has no history: its broad hollows are closed basins that no river would have left behind, and a
// river routed across one has to run at the basin's spill level and trench through the ground beyond it. Real
// fluvial country has very few closed hollows: the rivers that drain it have cut their valleys down through it.
// This pass gives the noise terrain that history, with the stream-power law of bedrock incision
//
//     dh/dt = -K A^m S        (A catchment area, S slope toward the receiver, n = 1)
//
// solved with the implicit O(n) scheme of Braun & Willett (2013, "FastScape"; Cordonnier et al. 2016): cells are
// visited downstream first, so each one is lowered toward its receiver's NEW height,
//
//     h_i <- (h_i + F h_r) / (1 + F),   F = K dt A^m / L,
//
// which is unconditionally stable. Water is routed over the filled surface (priority flood, as drainage.ts): inside
// a closed hollow a cell lies below its receiver and is left alone (a sediment trap), while the hollow's spill point
// carries the whole catchment of the hollow and cuts down fast - a big river keeps an antecedent gorge through
// rising ground and drains the basin behind it; a small one leaves its hollow as a lake. Ridges and peaks have the
// smallest catchments and keep their height. The pass only ever lowers the ground.
//
// The result is a per-cell height change (<= 0), which heightfield.ts adds to the natural terrain through a C1
// bicubic (Catmull-Rom) interpolation, so the corrected terrain has no facets or creases at the lattice lines.

import { DOMAIN_HALF, DRAIN_CELL, HOME_MOUND, HOME_RADIUS } from './drainage';

/** Settings of the erosion pass. */
export interface ErosionParams {
  /** Implicit steps, and routing refreshed every `reroute` steps. */
  steps: number;
  reroute: number;
  /** K dt / L for a one-cell catchment (1 km^2) and an orthogonal step: the per-step erosion factor on a ridge. */
  k: number;
  /** Area exponent m of the stream-power law (n = 1). */
  m: number;
  /**
   * [1 2 1] blurs of the cut, applied once, `settle` steps before the end: the walls of the notches the streams cut
   * fall back to valley slopes, and a channel that zigzags on the lattice leaves one smooth valley; the last steps
   * re-cut the floors so they drain again.
   */
  blur: number;
  settle: number;
  /**
   * Gentlest gradient a channel is cut to, m/m, at a one-cell catchment; it falls as A^-0.45 (Flint's law: the graded
   * profile under steady uplift), so a big river keeps a few metres per kilometre instead of being cut to sea level
   * far inland.
   */
  grade: number;
}

/** Catchment, cells, from which a diagonal step of a channel lowers the cells beside it. */
const CORNER_AREA = 10;
/** Lowest the pass takes the land, m. */
const LAND_MIN = 0.5;
/** How far a river leaving the lattice's edge runs on to the sea, m. */
const EDGE_RUN = 40000;

/**
 * Strong area dependence (m > 1/2) so the trunk rivers cut their valleys and drain the hollows they cross while the
 * ridges and peaks (one-cell catchments) lose only metres. On seeds 1, 42 and 777777 the land in hollows filled over
 * 30 m deep falls from 12-22 % to about 3 % (lattice), the top 1 % of the ground is lowered by about 10 m, the median
 * cell by 8 m; trunk valleys are cut a few hundred metres, the deepest gorges about 1 km. Four routings (the costly
 * part, about 120 ms in node).
 */
export const EROSION: ErosionParams = { steps: 20, reroute: 5, k: 0.0009, m: 1.2, blur: 2, settle: 5, grade: 0.03 };

/**
 * No correction within this distance of the home field, m, the full one beyond the second: its site is chosen on the
 * uneroded ground, and only its pad could suffer from a lowering (approach and circuit only gain clearance).
 */
const HOME_KEEP = 2000;
const HOME_FULL = 4500;
/** Beyond the lattice the correction carries on from its edge and fades out over this distance, m. */
const OUTSIDE_FADE = 15000;

/** The erosion of a seeded world: the per-cell height change (<= 0) and the corrected lattice. */
export interface ErosionField {
  /** Height change per lattice cell, m (drainage.ts lattice: n x n from (origin, origin), DRAIN_CELL apart). */
  delta: Float32Array;
  /** The natural (coarse) terrain plus the change, per cell: what the drainage routes over. */
  lattice: Float32Array;
}

/**
 * Sample the coarse natural terrain `natural` on the drainage lattice, erode it, and fade the change out near the
 * home field (`home`, its site chosen on the uneroded ground) and the lattice's edge.
 */
export function buildErosion(natural: (north: number, east: number) => number, home: { north: number; east: number }, p: ErosionParams = EROSION): ErosionField {
  const n = Math.round((2 * DOMAIN_HALF) / DRAIN_CELL) + 1;
  const origin = -DOMAIN_HALF;
  // Routed as the drainage routes (drainage.ts): a low mound over the home field keeps the rivers off it.
  const h0 = new Float32Array(n * n);
  const mound = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const north = origin + i * DRAIN_CELL;
      const east = origin + j * DRAIN_CELL;
      const r = Math.hypot(north - home.north, east - home.east);
      if (r < HOME_RADIUS) mound[i * n + j] = HOME_MOUND * (1 - r / HOME_RADIUS);
      h0[i * n + j] = natural(north, east) + mound[i * n + j];
    }
  }
  const h = h0.slice();
  erodeLattice(h, n, p);
  const delta = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const c = i * n + j;
      const r = Math.hypot(origin + i * DRAIN_CELL - home.north, origin + j * DRAIN_CELL - home.east);
      const fade = smoothstep(HOME_KEEP, HOME_FULL, r);
      delta[c] = Math.min(0, h[c] - h0[c]) * fade;
      h0[c] -= mound[c];
      h[c] = h0[c] + delta[c];
    }
  }
  // The edge cells take their inner neighbours' change, so the interpolation leaves the lattice level (C1) and
  // carries the edge's valleys on outward while it fades (bicubic).
  for (let k = 0; k < n; k++) {
    delta[k] = delta[n + k];
    delta[(n - 1) * n + k] = delta[(n - 2) * n + k];
  }
  for (let k = 0; k < n; k++) {
    delta[k * n] = delta[k * n + 1];
    delta[k * n + n - 1] = delta[k * n + n - 2];
  }
  for (let k = 0; k < n; k++) {
    for (const c of [k, (n - 1) * n + k, k * n, k * n + n - 1]) h[c] = h0[c] + delta[c];
  }
  return { delta, lattice: h };
}

function smoothstep(e0: number, e1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Erode the lattice `h` (n x n cells, row-major, north rows; cells at or below 0 m and the edge are fixed base level)
 * in place. Returns nothing; the caller diffs against its copy.
 */
export function erodeLattice(h: Float32Array, n: number, p: ErosionParams = EROSION): void {
  const N = n * n;
  const receiver = new Int32Array(N);
  const diag = new Uint8Array(N);
  const order = new Int32Array(N);
  const area = new Float32Array(N);
  const filled = new Float32Array(N);
  const done = new Uint8Array(N);
  const heap = new Heap(N);
  const pit = new Int32Array(N);
  const DI = [-1, -1, -1, 0, 0, 1, 1, 1];
  const DJ = [-1, 0, 1, -1, 1, -1, 0, 1];

  const route = (): void => {
    // Priority flood (Barnes et al. 2014) with a FIFO for cells inside hollows, from the sea and the edge.
    done.fill(0);
    receiver.fill(-1);
    let popped = 0;
    let pitHead = 0;
    let pitTail = 0;
    for (let c = 0; c < N; c++) {
      const i = (c / n) | 0;
      const j = c - i * n;
      if (h[c] <= 0 || i === 0 || j === 0 || i === n - 1 || j === n - 1) {
        filled[c] = h[c];
        done[c] = 1;
        heap.push(c, filled[c]);
      }
    }
    while (pitHead < pitTail || heap.size > 0) {
      const c = pitHead < pitTail ? pit[pitHead++] : heap.pop();
      order[popped++] = c;
      const i = (c / n) | 0;
      const j = c - i * n;
      const fc = filled[c];
      for (let k = 0; k < 8; k++) {
        const ii = i + DI[k];
        const jj = j + DJ[k];
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const nb = ii * n + jj;
        if (done[nb]) continue;
        done[nb] = 1;
        receiver[nb] = c;
        diag[nb] = DI[k] !== 0 && DJ[k] !== 0 ? 1 : 0;
        if (h[nb] <= fc + 1e-3) {
          filled[nb] = fc + 1e-3;
          pit[pitTail++] = nb;
        } else {
          filled[nb] = h[nb];
          heap.push(nb, h[nb]);
        }
      }
    }
    // Catchment area in cells: upstream cells come later in flood order.
    area.fill(1);
    for (let k = N - 1; k >= 0; k--) {
      const c = order[k];
      const r = receiver[c];
      if (r >= 0) area[r] += area[c];
    }
  };

  const h0 = h.slice();
  const cut = new Float32Array(N);
  const tmp = new Float32Array(N);
  const kDiag = p.k / Math.SQRT2;
  const kEdge = p.k * (DRAIN_CELL / EDGE_RUN);
  for (let s = 0; s < p.steps; s++) {
    if (s % p.reroute === 0) route();
    for (let k = 0; k < N; k++) {
      const c = order[k];
      const r = receiver[c];
      if (r < 0) {
        // An edge cell: its river runs on beyond the lattice, graded toward the distant sea (EDGE_RUN away).
        const hc = h[c];
        if (hc > 0) h[c] = hc / (1 + kEdge * Math.pow(area[c], p.m));
        continue;
      }
      // The sea's surface is the base level (not the shelf under it), so the land stays land.
      const hr = Math.max(h[r], LAND_MIN);
      const hc = h[c];
      // A cell in a hollow lies below its receiver: a sediment trap, left as it is.
      if (hc <= hr) continue;
      const a = area[c];
      const F = (diag[c] ? kDiag : p.k) * Math.pow(a, p.m);
      const floor = hr + p.grade * Math.pow(a, -0.45) * (diag[c] ? DRAIN_CELL * Math.SQRT2 : DRAIN_CELL);
      if (hc <= floor) continue;
      h[c] = Math.max(floor, (hc + F * hr) / (1 + F));
    }
    if (s === p.steps - 1 - p.settle) for (let b = 0; b < p.blur; b++) spread(h, h0, cut, tmp, n);
  }
  // A channel that steps diagonally between two cells would leave a saddle between them in the interpolated
  // terrain (the two cells beside the step are still high): bring those down to the mean of the step's two ends,
  // so the valley floor runs on down the diagonal.
  for (let k = 0; k < N; k++) {
    const c = order[k];
    const r = receiver[c];
    if (r < 0 || !diag[c] || area[c] < CORNER_AREA) continue;
    const mid = 0.5 * (h[c] + Math.max(h[r], LAND_MIN));
    const ic = (c / n) | 0;
    const ir = (r / n) | 0;
    const a = ir * n + (c - ic * n);
    const b = ic * n + (r - ir * n);
    if (h[a] > mid) h[a] = mid;
    if (h[b] > mid) h[b] = mid;
  }
}

/** Spread the cut (h - h0, <= 0) sideways: a [1 2 1] blur of it. Land stays land. */
function spread(h: Float32Array, h0: Float32Array, cut: Float32Array, tmp: Float32Array, n: number): void {
  const N = n * n;
  for (let c = 0; c < N; c++) cut[c] = h[c] - h0[c];
  for (let i = 0; i < n; i++) {
    const row = i * n;
    for (let j = 0; j < n; j++) {
      const l = j > 0 ? cut[row + j - 1] : cut[row + j];
      const r = j < n - 1 ? cut[row + j + 1] : cut[row + j];
      tmp[row + j] = 0.25 * l + 0.5 * cut[row + j] + 0.25 * r;
    }
  }
  for (let i = 0; i < n; i++) {
    const up = (i > 0 ? i - 1 : i) * n;
    const dn = (i < n - 1 ? i + 1 : i) * n;
    const row = i * n;
    for (let j = 0; j < n; j++) {
      const c = row + j;
      // Fixed cells (the sea) keep their height.
      if (h0[c] <= 0) continue;
      const b = 0.25 * tmp[up + j] + 0.5 * tmp[c] + 0.25 * tmp[dn + j];
      h[c] = Math.max(h0[c] + Math.min(0, b), Math.min(h0[c], LAND_MIN));
    }
  }
}

/** Binary min-heap of cell indices keyed by level, ties broken by index (deterministic). */
class Heap {
  private readonly ids: Int32Array;
  private readonly keys: Float64Array;
  size = 0;
  constructor(cap: number) {
    this.ids = new Int32Array(cap);
    this.keys = new Float64Array(cap);
  }
  push(id: number, key: number): void {
    const ids = this.ids;
    const keys = this.keys;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const kp = keys[p];
      if (kp < key || (kp === key && ids[p] < id)) break;
      ids[i] = ids[p];
      keys[i] = kp;
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0];
    const last = --this.size;
    if (last > 0) {
      const id = ids[last];
      const key = keys[last];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= last) break;
        const r = l + 1;
        let m = l;
        if (r < last && (keys[r] < keys[l] || (keys[r] === keys[l] && ids[r] < ids[l]))) m = r;
        if (keys[m] > key || (keys[m] === key && ids[m] > id)) break;
        ids[i] = ids[m];
        keys[i] = keys[m];
        i = m;
      }
      ids[i] = id;
      keys[i] = key;
    }
    return top;
  }
}

/**
 * C1 bicubic (Catmull-Rom) interpolation of a lattice field `v` (n x n, spacing `cell`, cell 0 at (origin, origin))
 * at (north, east). Off the lattice it carries on from the edge cells (which must equal their inner neighbours, for
 * C1) and fades to 0 over OUTSIDE_FADE.
 */
export function bicubic(v: Float32Array, n: number, origin: number, cell: number, north: number, east: number): number {
  const fy = (north - origin) / cell;
  const fx = (east - origin) / cell;
  if (fy >= 1 && fx >= 1 && fy < n - 2 && fx < n - 2) return catmullRom(v, n, fy, fx);
  const span = (n - 1) * cell;
  const out = Math.max(origin - north, north - origin - span, origin - east, east - origin - span, 0);
  if (out >= OUTSIDE_FADE) return 0;
  const cy = Math.min(n - 1, Math.max(0, fy));
  const cx = Math.min(n - 1, Math.max(0, fx));
  return catmullRom(v, n, cy, cx) * (1 - smoothstep(0, OUTSIDE_FADE, out));
}

/** Catmull-Rom over the 4 x 4 cells around (fy, fx) in cells; indices clamped to the lattice. */
function catmullRom(v: Float32Array, n: number, fy: number, fx: number): number {
  const i = Math.floor(fy);
  const j = Math.floor(fx);
  const ty = fy - i;
  const tx = fx - j;
  const tx2 = tx * tx;
  const tx3 = tx2 * tx;
  const ax = 0.5 * (-tx3 + 2 * tx2 - tx);
  const bx = 0.5 * (3 * tx3 - 5 * tx2 + 2);
  const cx = 0.5 * (-3 * tx3 + 4 * tx2 + tx);
  const dx = 0.5 * (tx3 - tx2);
  const ty2 = ty * ty;
  const ty3 = ty2 * ty;
  const ay = 0.5 * (-ty3 + 2 * ty2 - ty);
  const by = 0.5 * (3 * ty3 - 5 * ty2 + 2);
  const cy = 0.5 * (-3 * ty3 + 4 * ty2 + ty);
  const dy = 0.5 * (ty3 - ty2);
  const j0 = Math.max(0, j - 1);
  const j1 = j;
  const j2 = Math.min(n - 1, j + 1);
  const j3 = Math.min(n - 1, j + 2);
  const b0 = Math.max(0, i - 1) * n;
  const b1 = i * n;
  const b2 = Math.min(n - 1, i + 1) * n;
  const b3 = Math.min(n - 1, i + 2) * n;
  const r0 = ax * v[b0 + j0] + bx * v[b0 + j1] + cx * v[b0 + j2] + dx * v[b0 + j3];
  const r1 = ax * v[b1 + j0] + bx * v[b1 + j1] + cx * v[b1 + j2] + dx * v[b1 + j3];
  const r2 = ax * v[b2 + j0] + bx * v[b2 + j1] + cx * v[b2 + j2] + dx * v[b2 + j3];
  const r3 = ax * v[b3 + j0] + bx * v[b3 + j1] + cx * v[b3 + j2] + dx * v[b3 + j3];
  return ay * r0 + by * r1 + cy * r2 + dy * r3;
}
