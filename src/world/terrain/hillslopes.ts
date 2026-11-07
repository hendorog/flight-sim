// Threshold hillslopes in a seeded world's mountains (foundation stage 4, out/f4/REPORT.md): the sub-kilometre valleys
// the 1 km macro model (erosion.ts) cannot hold, cut into its ground on the 250 m fine grid, and the hillslopes rising
// from their floors at about the threshold angle up to the ridges. Pure (no three.js); worked out once per seed in the
// model worker and handed on with the model cells (heightfield.ts SeededModel, macroCache.ts).
//
// The 1 km model gives the mountains their height and their big valleys, but between its cells the ground is the
// B-spline of the lattice plus the noise's own finer relief: broad smooth domes. A slope limiter cannot steepen them (it
// only lowers ground already steeper than the threshold). What makes a range steep is incision: the small streams are
// graded to their trunks (gentle floors, a stream-power profile) while the ground between them stands as high as the
// uplift holds it, so the slopes between a stream's floor and its ridges stand at the angle the rock holds and no
// gentler. The construction, on the fine grid inside the orogen's mountains:
//
//   1. Route the water over the ground G as it stands (priority flood from the ground outside the pass and the drawn
//      rivers' floors, then steepest descent on the filled surface G_f).
//   2. Build the ground H downstream first: a node is its receiver's height plus the steepest drop it may stand over
//      it, s(A) L, with s(A) = tan Sc on a hillslope (A < A_c) and min(tan Sc, ks A^-theta) on a channel (A >= A_c);
//      so the channels' floors rise from their trunk at a stream-power gradient and every hillslope rises from its
//      channel at the threshold. Up to the envelope E = G_f + lift (lift only on mountain ground: not on a plain); over
//      it a slope rises on at `soft` of its gradient, at most `crown` over it, so a ridge is a crest where two slopes
//      meet, and a summit the envelope holds is a low peak, not a flat cap.
//   3. Route again over H (the channels now lower than the ground beside them gather its water: captures) and rebuild
//      from the envelope, a few times.
//   4. Where a channel steps diagonally, the two nodes beside the step come down to its middle (the interpolated
//      ground would otherwise leave a saddle across the step), and the slopes above are limited again.
//
// Every node stands over its receiver, so H has no closed hollow on the fine grid. The terrain takes H by its weight
// (erosion.ts sampleErosion: Catmull-Rom, bilinear along the channels' floors, where Catmull-Rom's negative weights
// would ripple a floor between walls a node's threshold rise high), the finer gullies and the small relief on top and
// given way along the channels, so their floors keep falling. streams.ts then traces its streams on the same 250 m
// raster down the same ground, pinned to the raster points on the channels' floors: they run in these valleys.
//
// Held at G: ground outside the orogen's mountain mask (the ranges' uplift share `ur`, `onset` to `full`), the sea,
// the home field's held ground and protected surfaces (erosion.ts `hard`, `cap`), and the drawn rivers' own floors
// (riverCore, from their axes as riverNetwork.ts lays them out): the rivers' levels, read off the ground after, are
// those of stage 2.

import { DOMAIN_HALF } from './drainage';

/** Settings of the threshold-hillslope pass. */
export interface SlopeParams {
  /** Threshold hillslope gradient, m/m (tan Sc). */
  sc: number;
  /** Channel-head catchment, km²: from here a node is a channel (its floor falls at the stream-power gradient). */
  ac: number;
  /** Channel steepness ks (gradient at 1 km²) and concavity theta of the floors' gradient ks A^-theta. */
  ks: number;
  theta: number;
  /** The orogen's mountain mask: the ranges' uplift share (erosion.ts ModelInputs.ur) where the pass starts and where it
   * runs fully. */
  onset: number;
  full: number;
  /** Route-and-build iterations. */
  iterations: number;
  /** A drawn river's own floor (riverCore, 0-1) is held from this weight up. */
  courseHold: number;
  /** Share of the gullies' relief kept where the pass runs fully (heightfield.ts): its channels are the valleys there. */
  gully: number;
  /** ... and of the finer gullies (the rills' scale, past heightfield.ts STREAM_GULLY_OCTAVES). */
  fine: number;
  /** Over the envelope the slopes rise on at this share of their gradient (0: a flat cap at the envelope). */
  soft: number;
  /** How far the ridges may rise over the ground as it stood, m (the envelope is G_f plus this, by the weight). */
  lift: number;
  /** ... and the most a slope rises on over the envelope, m. */
  crown: number;
  /** The share of both kept about a drawn river's valley (heightfield.ts RIVER_NO_LIFT). */
  riverLift: number;
}

/** The envelope is raised (SlopeParams.lift, crown) where the ground's relief within RELIEF_R nodes is from the first to
 * the second of RELIEF_LIFT, m: on mountain ground, not on a plain or a broad basin floor in the mask. */
const RELIEF_R = 8;
const RELIEF_LIFT = [150, 400];

export const SLOPES: SlopeParams = { sc: 0.73, ac: 1.5, ks: 0.2, theta: 0.45, onset: 0.3, full: 0.4, iterations: 6, courseHold: 0.98, gully: 0, fine: 1, lift: 100, soft: 0.4, crown: 150, riverLift: 1 };

/** Probes: change the pass's settings before a world is built (null: the defaults). */
let override: Partial<SlopeParams> | null = null;
export function setSlopeParams(p: Partial<SlopeParams> | null): void {
  override = p;
}
export const slopeParams = (): SlopeParams => ({ ...SLOPES, ...(override ?? {}) });
/** The settings as part of the model's cache key (heightfield.ts). */
export const slopeKey = (p: SlopeParams): string => [p.sc, p.ac, p.ks, p.theta, p.onset, p.full, p.iterations, p.courseHold, p.gully, p.fine, p.lift, p.soft, p.crown, p.riverLift].join('_');

/** What the pass hands the terrain (erosion.ts ErosionField.slopes), on the fine grid (n x n from (-DOMAIN_HALF,
 * -DOMAIN_HALF), `cell` apart). */
export interface SlopeField {
  /** The ground the pass built, m: at every node it built and G at those it held and three rings about them, else 0. */
  h: Float32Array;
  /** How far the terrain takes h, 0-255 (the mountain mask with the home field's fade). */
  w: Uint8Array;
  /** How far a node lies on a channel's floor, 0-255: the gullies and the small relief give way there. */
  chan: Uint8Array;
  /** How far a node lies on a drawn river's own floor, 0-255 (riverCore): the pass holds it and the terrain keeps the
   * ground as it stood there. */
  core: Uint8Array;
}

/** Beyond a drawn river's floor (where its level is read and its channel swings) the nodes are held this much further,
 * m (a point on the floor reads the 2 x 2 nodes about it: half a diagonal), and the hold comes off over CORE_TAPER. */
const CORE_HOLD = 180;
const CORE_TAPER = 250;

/**
 * Mark the drawn rivers' own floors on the fine grid (n x n, `cell` apart, from (-DOMAIN_HALF, -DOMAIN_HALF)), 0-255:
 * 255 within each axis point's `half` m (riverNetwork.ts: the floodplain and the channel's swing, or the axis and the
 * 80 m either side its level is read from) plus CORE_HOLD, off over CORE_TAPER beyond.
 */
export function riverCore(n: number, cell: number, axes: ReadonlyArray<{ north: ArrayLike<number>; east: ArrayLike<number>; half: ArrayLike<number> }>): Uint8Array {
  const out = new Uint8Array(n * n);
  const origin = -DOMAIN_HALF;
  for (const { north, east, half } of axes) {
    const m = north.length;
    // (In chords of about 240 m: a smooth axis strays a few metres from them.)
    let step = 1;
    if (m > 2) step = Math.max(1, Math.round(240 / Math.max(1, Math.hypot(north[1] - north[0], east[1] - east[0]))));
    for (let k0 = 0; k0 + 1 < m; k0 += step) {
      const k1 = Math.min(m - 1, k0 + step);
      const n0 = north[k0];
      const e0 = east[k0];
      const dn = north[k1] - n0;
      const de = east[k1] - e0;
      let h0 = half[k0];
      let h1 = half[k1];
      for (let k = k0 + 1; k < k1; k++) (h0 = Math.max(h0, half[k])), (h1 = Math.max(h1, half[k]));
      const reach = Math.max(h0, h1) + CORE_HOLD + CORE_TAPER;
      const yLo = Math.max(0, Math.ceil((Math.min(n0, n0 + dn) - reach - origin) / cell));
      const yHi = Math.min(n - 1, Math.floor((Math.max(n0, n0 + dn) + reach - origin) / cell));
      const xLo = Math.max(0, Math.ceil((Math.min(e0, e0 + de) - reach - origin) / cell));
      const xHi = Math.min(n - 1, Math.floor((Math.max(e0, e0 + de) + reach - origin) / cell));
      const L2 = dn * dn + de * de || 1;
      for (let y = yLo; y <= yHi; y++) {
        const qn = origin + y * cell - n0;
        for (let x = xLo; x <= xHi; x++) {
          const q = y * n + x;
          if (out[q] === 255) continue;
          const qe = origin + x * cell - e0;
          const u = Math.min(1, Math.max(0, (qn * dn + qe * de) / L2));
          const d = Math.hypot(qn - u * dn, qe - u * de);
          const h = h0 + (h1 - h0) * u + CORE_HOLD;
          if (d >= h + CORE_TAPER) continue;
          const v = Math.round(255 * (1 - smoothstep(h, h + CORE_TAPER, d)));
          if (v > out[q]) out[q] = v;
        }
      }
    }
  }
  return out;
}

const DI8 = [-1, -1, -1, 0, 0, 1, 1, 1];
const DJ8 = [-1, 0, 1, -1, 1, -1, 0, 1];

function smoothstep(e0: number, e1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Binary min-heap of node indices keyed by level, ties broken by index (deterministic). */
class Heap {
  private ids: Int32Array;
  private keys: Float64Array;
  size = 0;
  constructor(cap: number) {
    this.ids = new Int32Array(cap);
    this.keys = new Float64Array(cap);
  }
  push(id: number, key: number): void {
    if (this.size === this.ids.length) {
      const ids = new Int32Array(this.ids.length * 2);
      ids.set(this.ids);
      const keys = new Float64Array(this.keys.length * 2);
      keys.set(this.keys);
      this.ids = ids;
      this.keys = keys;
    }
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

/** Probes: what the last pass did (nodes, iterations' changed receivers, ms per part). */
export const slopeStats = { active: 0, sampled: 0, changed: [] as number[], corners: 0, msSample: 0, msPass: 0 };

/**
 * The pass (see the head of the file). `n`, `cell`: the fine grid. `weight(north, east)`: the pass's weight at a node,
 * [0, 1] (the mountain mask with the home field's fade; 0 outside, where nothing is sampled). `hold(q)`: true where a
 * node is held at its ground (a drawn river's floor). `core`: riverCore's marks, kept with the result. `ground(north, east)`: the ground G as it stands, m.
 */
export function thresholdSlopes(n: number, cell: number, weight: Float32Array, hold: (q: number) => boolean, ground: (north: number, east: number) => number, core: Uint8Array, p: SlopeParams = slopeParams(), nearRiver: Uint8Array | null = null): SlopeField {
  const origin = -DOMAIN_HALF;
  const N = n * n;
  const t0 = performance.now();
  const W = new Float32Array(N);
  const w8 = new Uint8Array(N);
  // The weight per node, as the terrain will read it (0-255).
  let active = 0;
  for (let q = 0; q < N; q++) {
    const v = weight[q];
    if (!(v > 0)) continue;
    w8[q] = Math.round(255 * Math.min(1, v));
    W[q] = w8[q] / 255;
  }
  // Active nodes: weight > 0, not on the grid's rim, not held. The ground is sampled there and three rings about them
  // (the terrain's interpolation reads the 4 x 4 nodes about a point).
  const state = new Uint8Array(N); // 0 untouched, 1 sampled (fixed), 2 active
  const RING = 3;
  const G = new Float32Array(N);
  // A held floor is base level only where it runs on, through held floor, to the ground outside the pass (a river
  // runs out of the ranges): a patch of it standing alone would be a closed hollow among the slopes built about it, so
  // it takes part in the pass.
  const held = new Uint8Array(N);
  {
    const stack: number[] = [];
    for (let q = 0; q < N; q++) {
      if (W[q] > 0 && hold(q)) held[q] = 1;
    }
    for (let q = 0; q < N; q++) {
      if (held[q] !== 1) continue;
      const y = (q / n) | 0;
      const x = q - y * n;
      let out = y === 0 || x === 0 || y === n - 1 || x === n - 1;
      for (let k = 0; k < 8 && !out; k++) {
        const nb = (y + DI8[k]) * n + (x + DJ8[k]);
        if (W[nb] <= 0) out = true;
      }
      if (out) {
        held[q] = 2;
        stack.push(q);
      }
    }
    while (stack.length) {
      const q = stack.pop() as number;
      const y = (q / n) | 0;
      const x = q - y * n;
      for (let k = 0; k < 8; k++) {
        const yy = y + DI8[k];
        const xx = x + DJ8[k];
        if (yy < 0 || xx < 0 || yy >= n || xx >= n) continue;
        const nb = yy * n + xx;
        if (held[nb] !== 1) continue;
        held[nb] = 2;
        stack.push(nb);
      }
    }
  }
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      const q = y * n + x;
      if (W[q] <= 0 || held[q] === 2) continue;
      state[q] = 2;
      active++;
    }
  }
  // (Every node within RING of a weighted one: the terrain's interpolation reads the 4 x 4 nodes about a point.)
  const near = new Uint8Array(N);
  {
    const rowNear = new Uint8Array(N);
    for (let y = 0; y < n; y++) {
      let last = -1e9;
      for (let x = 0; x < n; x++) {
        if (w8[y * n + x] > 0) last = x;
        if (x - last <= RING) rowNear[y * n + x] = 1;
      }
      last = 1e9;
      for (let x = n - 1; x >= 0; x--) {
        if (w8[y * n + x] > 0) last = x;
        if (last - x <= RING) rowNear[y * n + x] = 1;
      }
    }
    for (let x = 0; x < n; x++) {
      let last = -1e9;
      for (let y = 0; y < n; y++) {
        if (rowNear[y * n + x]) last = y;
        if (y - last <= RING) near[y * n + x] = 1;
      }
      last = 1e9;
      for (let y = n - 1; y >= 0; y--) {
        if (rowNear[y * n + x]) last = y;
        if (last - y <= RING) near[y * n + x] = 1;
      }
    }
  }
  let sampled = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const q = y * n + x;
      if (!near[q]) continue;
      G[q] = ground(origin + y * cell, origin + x * cell);
      sampled++;
      if (state[q] !== 2) state[q] = 1;
      else if (G[q] <= 0) {
        // The sea is base level.
        state[q] = 1;
        active--;
      }
    }
  }
  const t1 = performance.now();
  // 1. Priority flood from the fixed nodes bordering the active ones: the filled envelope Gf (strictly rising inward)
  // and the first receivers (steepest descent on it).
  const Gf = new Float32Array(N);
  const done = new Uint8Array(N);
  const heap = new Heap(1 << 16);
  const pitQ = new Int32Array(Math.max(16, active));
  const EPS = 1e-3;
  for (let q = 0; q < N; q++) {
    if (state[q] !== 1) continue;
    Gf[q] = G[q];
    done[q] = 1;
    // Only those beside an active node start the flood.
    const y = (q / n) | 0;
    const x = q - y * n;
    for (let k = 0; k < 8; k++) {
      const yy = y + DI8[k];
      const xx = x + DJ8[k];
      if (yy < 0 || xx < 0 || yy >= n || xx >= n) continue;
      if (state[yy * n + xx] === 2) {
        heap.push(q, G[q]);
        break;
      }
    }
  }
  let ph = 0;
  let pt = 0;
  while (ph < pt || heap.size > 0) {
    const c = ph < pt ? pitQ[ph++] : heap.pop();
    const y = (c / n) | 0;
    const x = c - y * n;
    const fc = Gf[c];
    for (let k = 0; k < 8; k++) {
      const yy = y + DI8[k];
      const xx = x + DJ8[k];
      if (yy < 0 || xx < 0 || yy >= n || xx >= n) continue;
      const nb = yy * n + xx;
      if (done[nb] || state[nb] !== 2) continue;
      done[nb] = 1;
      if (G[nb] <= fc + EPS) {
        Gf[nb] = fc + EPS;
        pitQ[pt++] = nb;
      } else {
        Gf[nb] = G[nb];
        heap.push(nb, G[nb]);
      }
    }
  }
  // (An active node the flood never reached - none expected, every active region borders fixed ground - is held.)
  for (let q = 0; q < N; q++) {
    if (state[q] === 2 && !done[q]) {
      state[q] = 1;
      Gf[q] = G[q];
      active--;
    }
  }
  // How far the envelope may be raised at each node: by the weight, where the ground's relief within RELIEF_R nodes
  // (highest less lowest) is RELIEF_LIFT[0] to [1] m: in the mountains, valley floors and all, but not on a plain or a
  // broad basin floor inside the mask.
  const L = new Float32Array(N);
  {
    const R = RELIEF_R;
    const lo = new Float32Array(N);
    const hi = new Float32Array(N);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let a = Infinity;
        let b = -Infinity;
        for (let d = -R; d <= R; d++) {
          const xx = x + d;
          if (xx < 0 || xx >= n) continue;
          const q = y * n + xx;
          if (state[q] === 0) continue;
          if (Gf[q] < a) a = Gf[q];
          if (Gf[q] > b) b = Gf[q];
        }
        lo[y * n + x] = a;
        hi[y * n + x] = b;
      }
    }
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        if (state[y * n + x] !== 2) continue;
        let a = Infinity;
        let b = -Infinity;
        for (let d = -R; d <= R; d++) {
          const yy = y + d;
          if (yy < 0 || yy >= n) continue;
          const q = yy * n + x;
          if (lo[q] < a) a = lo[q];
          if (hi[q] > b) b = hi[q];
        }
        const q = y * n + x;
        L[q] = W[q] * smoothstep(RELIEF_LIFT[0], RELIEF_LIFT[1], b - a) * (nearRiver ? 1 - (1 - p.riverLift) * (nearRiver[q] / 255) : 1);
      }
    }
  }
  const list = new Int32Array(active);
  {
    let k = 0;
    for (let q = 0; q < N; q++) if (state[q] === 2) list[k++] = q;
  }
  const rec = new Int32Array(N).fill(-1);
  const H = new Float32Array(N);
  for (let q = 0; q < N; q++) if (state[q] === 1) H[q] = G[q];
  const area = new Float32Array(N);
  const order = new Int32Array(active);
  const start = new Int32Array(N + 1);
  const donors = new Int32Array(active);
  const seen = new Uint8Array(N);
  const cellKm2 = (cell / 1000) * (cell / 1000);

  /** Steepest descent over `z` for every active node (a strictly lower neighbour always exists). */
  const route = (z: Float32Array): number => {
    let changed = 0;
    for (let k = 0; k < active; k++) {
      const c = list[k];
      const y = (c / n) | 0;
      const x = c - y * n;
      const zc = z[c];
      let best = -1;
      let bs = 0;
      for (let d = 0; d < 8; d++) {
        const nb = (y + DI8[d]) * n + (x + DJ8[d]);
        if (state[nb] === 0) continue;
        const dz = zc - z[nb];
        if (dz <= 0) continue;
        const s = DI8[d] !== 0 && DJ8[d] !== 0 ? dz / Math.SQRT2 : dz;
        if (s > bs) {
          bs = s;
          best = nb;
        }
      }
      if (best < 0) throw new Error('threshold slopes: an active node with no lower neighbour');
      if (rec[c] !== best) changed++;
      rec[c] = best;
    }
    return changed;
  };
  /** Downstream-first order of the active nodes (receivers before donors), and their catchments, km². */
  const orderAndArea = (): void => {
    start.fill(0);
    for (let k = 0; k < active; k++) start[rec[list[k]] + 1]++;
    for (let q = 0; q < N; q++) start[q + 1] += start[q];
    const fill = start.slice(0, N);
    for (let k = 0; k < active; k++) {
      const c = list[k];
      donors[fill[rec[c]]++] = c;
    }
    let tail = 0;
    // Roots: the fixed nodes some active node drains to.
    for (let k = 0; k < active; k++) {
      const r = rec[list[k]];
      if (state[r] !== 2 && !seen[r]) {
        seen[r] = 1;
        for (let m = start[r]; m < start[r + 1]; m++) order[tail++] = donors[m];
      }
    }
    for (let k = 0; k < active; k++) seen[rec[list[k]]] = 0;
    let head = 0;
    while (head < tail) {
      const c = order[head++];
      for (let m = start[c]; m < start[c + 1]; m++) order[tail++] = donors[m];
    }
    if (tail !== active) throw new Error(`threshold slopes: routing has a cycle (${active - tail} nodes)`);
    for (let k = 0; k < active; k++) area[list[k]] = cellKm2;
    for (let k = active - 1; k >= 0; k--) {
      const c = order[k];
      const r = rec[c];
      if (state[r] === 2) area[r] += area[c];
    }
  };
  /** The steepest a node may stand over its receiver, m per m (faded by the weight: none at the mask's edge). */
  const slopeOf = (c: number): number => {
    const a = area[c];
    const s = a < p.ac ? p.sc : Math.min(p.sc, p.ks * Math.pow(a, -p.theta));
    return s / Math.max(W[c], 1e-3);
  };
  const build = (): void => {
    for (let k = 0; k < active; k++) {
      const c = order[k];
      const r = rec[c];
      const dist = (r - c === 1 || c - r === 1 || r - c === n || c - r === n ? 1 : Math.SQRT2) * cell;
      const hr = H[r];
      const rise = slopeOf(c) * dist;
      // Up to the envelope at the full rise; over it at `soft` of it (a summit stands as a low peak, not a flat cap), up
      // to `crown` over it. Where the ground stood high over its surroundings only (L[c]): a plain stays a plain.
      const e = Gf[c] + p.lift * L[c];
      let v = hr + rise;
      if (v > e) {
        const top = e + p.crown * L[c];
        v = Math.min(top, Math.max(e, hr) + p.soft * L[c] * (v - Math.max(e, hr)));
        if (hr > top) v = hr;
      }
      // (Never down to its receiver: the envelope may stand under a receiver the routing moved to.)
      H[c] = Math.max(v, hr + EPS * dist);
    }
  };
  // 2-3. Build, route over the result, build again.
  route(Gf);
  orderAndArea();
  build();
  slopeStats.changed = [];
  for (let it = 1; it < p.iterations; it++) {
    const ch = route(H);
    slopeStats.changed.push(ch);
    orderAndArea();
    build();
    if (ch === 0) break;
  }
  // 4. A channel's diagonal step: the two nodes beside it come down to its middle; then the slopes above are limited
  // again (over the routing of the result).
  let corners = 0;
  const cornerArea = 2 * cellKm2;
  for (let k = 0; k < active; k++) {
    const c = order[k];
    const r = rec[c];
    if (area[c] < cornerArea) continue;
    const yc = (c / n) | 0;
    const xc = c - yc * n;
    const yr = (r / n) | 0;
    const xr = r - yr * n;
    if (yc === yr || xc === xr) continue;
    const mid = 0.5 * (H[c] + H[r]);
    const a = yc * n + xr;
    const b = yr * n + xc;
    if (state[a] === 2 && H[a] > mid) {
      H[a] = mid;
      corners++;
    }
    if (state[b] === 2 && H[b] > mid) {
      H[b] = mid;
      corners++;
    }
  }
  // (And where a held floor runs on diagonally, one node wide: those two nodes are its floor's too, chanFloor.)
  const chanFloor: number[] = [];
  for (let q = 0; q < N; q++) {
    if (held[q] !== 2) continue;
    const y = (q / n) | 0;
    const x = q - y * n;
    for (const [dy, dx] of [[1, 1], [1, -1]]) {
      const yy = y + dy;
      const xx = x + dx;
      if (yy >= n || xx < 0 || xx >= n) continue;
      const d = yy * n + xx;
      const a = y * n + xx;
      const b = yy * n + x;
      if (held[d] !== 2 || held[a] === 2 || held[b] === 2) continue;
      const mid = 0.5 * (H[q] + H[d]);
      if (state[a] === 2 && H[a] > mid) {
        H[a] = mid;
        corners++;
      }
      if (state[b] === 2 && H[b] > mid) {
        H[b] = mid;
        corners++;
      }
      if (state[a] === 2) chanFloor.push(a);
      if (state[b] === 2) chanFloor.push(b);
    }
  }
  route(H);
  orderAndArea();
  for (let k = 0; k < active; k++) {
    const c = order[k];
    const r = rec[c];
    const dist = (r - c === 1 || c - r === 1 || r - c === n || c - r === n ? 1 : Math.SQRT2) * cell;
    const v = Math.min(H[c], H[r] + slopeOf(c) * dist);
    H[c] = Math.max(v, H[r] + EPS * dist);
  }
  // The channels' floors (the gullies and small relief give way there): from the channel head's catchment up, and
  // the two nodes beside each diagonal step as the step's.
  const chan = new Uint8Array(N);
  for (let k = 0; k < active; k++) {
    const c = list[k];
    const v = smoothstep(p.ac, 2 * p.ac, area[c]);
    if (v > 0) chan[c] = Math.max(chan[c], Math.round(255 * v));
    const r = rec[c];
    const yc = (c / n) | 0;
    const xc = c - yc * n;
    const yr = (r / n) | 0;
    const xr = r - yr * n;
    if (v <= 0 || yc === yr || xc === xr) continue;
    const a = yc * n + xr;
    const b = yr * n + xc;
    const u = Math.round(255 * v);
    if (state[a] === 2 && u > chan[a]) chan[a] = u;
    if (state[b] === 2 && u > chan[b]) chan[b] = u;
  }
  // (A held valley floor is a channel's floor too: the ground beside it may stand a node's threshold rise above it.)
  for (let q = 0; q < N; q++) if (state[q] === 1 && held[q] === 2) chan[q] = 255;
  for (const q of chanFloor) chan[q] = 255;
  for (let q = 0; q < N; q++) if (state[q] === 0) w8[q] = 0;
  slopeStats.active = active;
  slopeStats.sampled = sampled;
  slopeStats.corners = corners;
  slopeStats.msSample = t1 - t0;
  slopeStats.msPass = performance.now() - t1;
  return { h: H, w: w8, chan, core };
}
