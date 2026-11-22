// Valley straightness ruler (owner 2026-11-11: "many valleys are dead straight, this would be rare in real life").
// One code path for any height grid: the seeded world's drawn surface (valleyStraight.test.ts samples terrainHeight)
// or an NZ reference grid (nzDem.py: the LINZ 8 m DEM block-averaged to the same cell). Nothing here reads the
// world's model, its lattice or its courses, so an irregular or curved model cannot score well by construction.
//
// 1. ROUTE. Pits filled by priority flood (outlets: land cells on the grid's border or beside sea / no data), D8 on
//    the filled surface (steepest descent; flats by the flood's order), catchment area by accumulation. A cell whose
//    catchment reaches the grid's outer two rows or columns is TRUNCATED (an NZ box that clips a river) and is dropped.
// 2. LINES. Channels drain >= 30 km2. Each channel cell continues upstream through its largest donor, so every channel
//    cell lies on exactly one line: head to outlet, or head to its junction with a larger line.
// 3. FLOOR AXIS (the floor's low line, traced on the grid, not on any model course). The D8 path is resampled every
//    DS m and smoothed (GUIDE_SIGMA) into a guide. At each guide point a cross-section square to the guide (direction
//    smoothed over DIR_SIGMA) is sampled on the bicubic grid surface every CROSS_STEP m, out to CROSS_HALF m each side
//    or until the ground stands RISE m over the guide point (a valley wall). The low line is the middle of the band of
//    that section within BAND m of its lowest point (a V's bottom; a flat floor's low side, or its middle where it is
//    level within BAND). The points are smoothed (AXIS_SIGMA) and the trace is run a second time on them. FLOOR width:
//    the band within FLOOR_BAND m of the lowest point. Not measured: guide points on flat water (the 3x3 cells within
//    FLAT_RANGE m: lakes, the sea, airfield flats), within JUNCTION_SKIP m of a junction (the section would find the
//    receiver's floor), or where the section has no land. (Filled pits are measured: a V at an angle to the grid makes
//    metre-deep D8 pits all along its bottom, and the section finds the low line through them.)
// 4. STRAIGHTNESS. For a window of axis length L, its deviation is the largest distance of the axis from the chord
//    joining the window's ends. Each axis point takes m_L: the least deviation of any L window containing it, so
//    m_L <= d says "this point lies in an L-km stretch that stays within d m of a straight line". S_L(d) is the share
//    of axis length with m_L <= d. Windows run every WIN_STEP m inside unbroken pieces of axis; a point in a piece
//    shorter than L has no m_L (not counted at that L).
// 5. CLASSES. Catchment: 30-100, 100-500, >= 500 km2 (the routed area of the axis point's D8 cell). Landscape: the
//    relief (max - min of the surface, sea as 0) over a 5 km window on a 1 km lattice about the point, as endsGate and
//    drawnGate classify: mountain >= 500 m, hill >= 150 m, plain below.
// 6. BENDS (secondary). Inflections of the axis heading (smoothed BEND_SIGMA); turns under BEND_TURN deg merged into
//    their neighbours. A bend's amplitude is its largest offset from its own chord; its wavelength twice that chord.
//    Ratios to the median floor width over the bend are kept only where that width is at least 3 cells.

export interface Grid {
  name: string;
  rows: number;
  cols: number;
  cell: number;
  /** North edge of row 0 and west edge of column 0, m. Cell (i, j) centre: (north0 - (i + .5) cell, east0 + (j + .5) cell). */
  north0: number;
  east0: number;
  /** Surface height, m; NaN = sea or no data. */
  h: Float32Array;
}

export const SEA = 0.5;
export const P = {
  minArea: 30e6,
  classes: [30e6, 100e6, 500e6],
  ds: 50,
  guideSigma: 200,
  dirSigma: 400,
  axisSigma: 150,
  crossHalf: 750,
  crossStep: 16,
  rise: 15,
  band: 2,
  floorBand: 5,
  junctionSkip: 750,
  flatRange: 0.05,
  windows: [3000, 5000, 10000],
  /** The gate's d per window: 7 % of L, NZ's median least chord deviation (frozen on NZ before any world was measured). */
  dStraight: [210, 350, 700],
  /** "Dead straight" per window, 2 % of L: reported beside the gate, not gated (NZ has almost none). */
  dDead: [60, 100, 200],
  winStep: 100,
  minReach: 5000,
  bendSigma: 250,
  bendTurn: 10,
};
/** Class names from P.classes (lower bounds, m2): '30-100', '100-500', '500+'. */
export const CLASS_NAMES: string[] = [];
export function setClasses(lower: number[]): void {
  P.classes = lower;
  P.minArea = lower[0];
  CLASS_NAMES.length = 0;
  lower.forEach((a, i) => CLASS_NAMES.push(i + 1 < lower.length ? `${a / 1e6}-${lower[i + 1] / 1e6}` : `${a / 1e6}+`));
}
setClasses(P.classes);
export const classOf = (areaM2: number): number => { let c = 0; while (c + 1 < P.classes.length && areaM2 >= P.classes[c + 1]) c++; return c; };
export const LAND_NAMES = ['plain', 'hill', 'mountain'];

const DI = [-1, -1, -1, 0, 0, 1, 1, 1];
const DJ = [-1, 0, 1, -1, 1, -1, 0, 1];

export interface Routed {
  land: Uint8Array;
  filled: Float32Array;
  rec: Int32Array;
  order: Int32Array;
  area: Float64Array;
  edge: Uint8Array;
}

/** Priority-flood fill, D8 receivers, catchment areas (m2) and the truncated flag. */
export function route(g: Grid): Routed {
  const { rows: R, cols: C, h, cell } = g;
  const N = R * C;
  const land = new Uint8Array(N);
  let nLand = 0;
  for (let i = 0; i < N; i++) if (h[i] > SEA) { land[i] = 1; nLand++; }
  const filled = new Float32Array(N);
  const parent = new Int32Array(N).fill(-1);
  const seq = new Int32Array(N);
  const done = new Uint8Array(N);
  const outlet = new Uint8Array(N);
  const heap = new Int32Array(nLand);
  let hs = 0, sq = 0;
  const less = (a: number, b: number): boolean => filled[a] < filled[b] || (filled[a] === filled[b] && seq[a] < seq[b]);
  const push = (c: number): void => {
    seq[c] = sq++;
    let k = hs++;
    heap[k] = c;
    while (k > 0) { const p = (k - 1) >> 1; if (!less(heap[k], heap[p])) break; const t = heap[k]; heap[k] = heap[p]; heap[p] = t; k = p; }
  };
  const pop = (): number => {
    const top = heap[0];
    heap[0] = heap[--hs];
    let k = 0;
    for (;;) {
      const l = 2 * k + 1, r = l + 1;
      let m = k;
      if (l < hs && less(heap[l], heap[m])) m = l;
      if (r < hs && less(heap[r], heap[m])) m = r;
      if (m === k) break;
      const t = heap[k]; heap[k] = heap[m]; heap[m] = t; k = m;
    }
    return top;
  };
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
    const c = i * C + j;
    if (!land[c]) continue;
    let out = i === 0 || j === 0 || i === R - 1 || j === C - 1;
    if (!out) for (let k = 0; k < 8; k++) if (!land[c + DI[k] * C + DJ[k]]) { out = true; break; }
    if (out) { filled[c] = h[c]; done[c] = 1; outlet[c] = 1; push(c); }
  }
  const order = new Int32Array(nLand);
  let no = 0;
  while (hs > 0) {
    const c = pop();
    order[no++] = c;
    const i = (c / C) | 0, j = c - i * C;
    for (let k = 0; k < 8; k++) {
      const ii = i + DI[k], jj = j + DJ[k];
      if (ii < 0 || jj < 0 || ii >= R || jj >= C) continue;
      const nb = ii * C + jj;
      if (!land[nb] || done[nb]) continue;
      done[nb] = 1;
      filled[nb] = Math.max(h[nb], filled[c]);
      parent[nb] = c;
      push(nb);
    }
  }
  const rec = new Int32Array(N).fill(-1);
  for (let q = 0; q < no; q++) {
    const c = order[q];
    if (outlet[c]) continue;
    const i = (c / C) | 0, j = c - i * C;
    let best = -1, bs = 0;
    for (let k = 0; k < 8; k++) {
      const ii = i + DI[k], jj = j + DJ[k];
      if (ii < 0 || jj < 0 || ii >= R || jj >= C) continue;
      const nb = ii * C + jj;
      if (!land[nb] || !(filled[nb] < filled[c])) continue;
      const s = (filled[c] - filled[nb]) / (DI[k] && DJ[k] ? Math.SQRT2 : 1);
      if (s > bs) { bs = s; best = nb; }
    }
    rec[c] = best >= 0 ? best : parent[c];
  }
  const area = new Float64Array(N);
  const edge = new Uint8Array(N);
  for (let q = 0; q < no; q++) {
    const c = order[q];
    area[c] = cell * cell;
    const i = (c / C) | 0, j = c - i * C;
    if (i < 2 || j < 2 || i >= R - 2 || j >= C - 2) edge[c] = 1;
  }
  for (let q = no - 1; q >= 0; q--) {
    const c = order[q], r = rec[c];
    if (r < 0) continue;
    area[r] += area[c];
    if (edge[c]) edge[r] = 1;
  }
  return { land, filled, rec, order: order.subarray(0, no), area, edge };
}

/** Bicubic (Catmull-Rom) surface at a point; bilinear where the 4x4 has no data; NaN off the land. */
export function surfaceAt(g: Grid, north: number, east: number): number {
  const fi = (g.north0 - north) / g.cell - 0.5, fj = (east - g.east0) / g.cell - 0.5;
  const i0 = Math.floor(fi), j0 = Math.floor(fj);
  const ti = fi - i0, tj = fj - j0;
  const { rows: R, cols: C, h } = g;
  if (i0 < 0 || j0 < 0 || i0 + 1 >= R || j0 + 1 >= C) return NaN;
  if (i0 >= 1 && j0 >= 1 && i0 + 2 < R && j0 + 2 < C) {
    const wi = cr(ti), wj = cr(tj);
    let s = 0, ok = true;
    for (let a = 0; a < 4 && ok; a++) {
      const row = (i0 - 1 + a) * C + j0 - 1;
      let r = 0;
      for (let b = 0; b < 4; b++) { const v = h[row + b]; if (!(v > SEA)) { ok = false; break; } r += wj[b] * v; }
      s += wi[a] * r;
    }
    if (ok) return s;
  }
  const a = h[i0 * C + j0], b = h[i0 * C + j0 + 1], c = h[(i0 + 1) * C + j0], d = h[(i0 + 1) * C + j0 + 1];
  if (!(a > SEA && b > SEA && c > SEA && d > SEA)) return NaN;
  return (a * (1 - tj) + b * tj) * (1 - ti) + (c * (1 - tj) + d * tj) * ti;
}
const W4 = [new Float64Array(4), new Float64Array(4)];
let w4i = 0;
function cr(t: number): Float64Array {
  const w = W4[(w4i ^= 1)];
  const t2 = t * t, t3 = t2 * t;
  w[0] = (-t3 + 2 * t2 - t) / 2;
  w[1] = (3 * t3 - 5 * t2 + 2) / 2;
  w[2] = (-3 * t3 + 4 * t2 + t) / 2;
  w[3] = (t3 - t2) / 2;
  return w;
}

function gauss(a: Float64Array, sigma: number): Float64Array {
  const n = a.length, out = new Float64Array(n);
  if (sigma <= 0) { out.set(a); return out; }
  const r = Math.ceil(3 * sigma);
  const k = new Float64Array(2 * r + 1);
  for (let i = -r; i <= r; i++) k[i + r] = Math.exp((-i * i) / (2 * sigma * sigma));
  for (let i = 0; i < n; i++) {
    let s = 0, w = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) { s += a[j] * k[j - i + r]; w += k[j - i + r]; }
    out[i] = s / w;
  }
  return out;
}

/** Axis samples of one dataset (struct of arrays). */
export interface Axes {
  name: string;
  cell: number;
  n: Float64Array;
  e: Float64Array;
  s: Float64Array;
  line: Int32Array;
  piece: Int32Array; // -1 = not measured
  cls: Int8Array;
  /** Catchment area at the point (its D8 cell), km2. */
  area: Float32Array;
  landC: Int8Array;
  w5: Float32Array;
  m: Float32Array[]; // per window: m_L, NaN where the piece is shorter than L
  lines: number;
  km: number;
}

export function trace(g: Grid, R: Routed): Axes {
  const { rows: Rw, cols: C, cell, h } = g;
  const { land, rec, order, area, edge } = R;
  const chan = (c: number): boolean => land[c] === 1 && edge[c] === 0 && area[c] >= P.minArea;
  const main = new Int32Array(Rw * C).fill(-1);
  for (let q = 0; q < order.length; q++) {
    const c = order[q];
    if (!chan(c)) continue;
    const r = rec[c];
    if (r >= 0 && chan(r) && (main[r] < 0 || area[c] > area[main[r]])) main[r] = c;
  }
  const cN = (c: number): number => g.north0 - ((((c / C) | 0) + 0.5) * cell);
  const cE = (c: number): number => g.east0 + ((c % C) + 0.5) * cell;
  const outN: number[] = [], outE: number[] = [], outS: number[] = [], outL: number[] = [], outP: number[] = [], outC: number[] = [], outA: number[] = [], outLand: number[] = [], outW: number[] = [];
  const reliefCache = new Map<number, number>();
  const relief = (n: number, e: number): number => {
    const n0 = Math.round(n / 1000), e0 = Math.round(e / 1000);
    const key = n0 * 100003 + e0;
    let v = reliefCache.get(key);
    if (v === undefined) {
      let lo = Infinity, hi = -Infinity;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
        const x = surfaceAt(g, (n0 + a) * 1000, (e0 + b) * 1000);
        const y = x > SEA ? x : 0;
        lo = Math.min(lo, y); hi = Math.max(hi, y);
      }
      v = hi - lo >= 500 ? 2 : hi - lo >= 150 ? 1 : 0;
      reliefCache.set(key, v);
    }
    return v;
  };
  const flatAt = (c: number): boolean => {
    const i = (c / C) | 0, j = c - i * C;
    let lo = h[c], hi = h[c];
    for (let k = 0; k < 8; k++) {
      const ii = i + DI[k], jj = j + DJ[k];
      if (ii < 0 || jj < 0 || ii >= Rw || jj >= C) continue;
      const v = h[ii * C + jj];
      if (!(v > SEA)) return true;
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    return hi - lo < P.flatRange;
  };
  let nLines = 0, piece = 0;
  const xsN = new Float64Array(Math.ceil((2 * P.crossHalf) / P.crossStep) + 3);
  for (let q = 0; q < order.length; q++) {
    const head = order[q];
    if (!chan(head) || main[head] >= 0) continue;
    // The line's cells, head to end.
    const path: number[] = [head];
    let c = head, junction = false;
    for (;;) {
      const r = rec[c];
      if (r < 0) break;
      if (!chan(r)) { junction = land[r] === 1; if (junction) path.push(r); break; }
      if (main[r] !== c) { junction = true; path.push(r); break; }
      path.push(r);
      c = r;
    }
    if (path.length < 3) continue;
    nLines++;
    const lineId = nLines - 1;
    // Resample the D8 path every DS m.
    const pn: number[] = [], pe: number[] = [], pc: number[] = [];
    for (let k = 0; k + 1 < path.length; k++) {
      const an = cN(path[k]), ae = cE(path[k]), bn = cN(path[k + 1]), be = cE(path[k + 1]);
      const len = Math.hypot(bn - an, be - ae);
      const steps = Math.max(1, Math.round(len / P.ds));
      for (let t = 0; t < steps; t++) { const f = t / steps; pn.push(an + (bn - an) * f); pe.push(ae + (be - ae) * f); pc.push(path[f < 0.5 ? k : k + 1]); }
    }
    pn.push(cN(path[path.length - 1])); pe.push(cE(path[path.length - 1])); pc.push(path[path.length - 1]);
    const M = pn.length;
    let gn = gauss(Float64Array.from(pn), P.guideSigma / P.ds), ge = gauss(Float64Array.from(pe), P.guideSigma / P.ds);
    const ok = new Uint8Array(M);
    const w5 = new Float32Array(M).fill(NaN);
    for (let pass = 0; pass < 2; pass++) {
      const dn = gauss(gn, P.dirSigma / P.ds), de = gauss(ge, P.dirSigma / P.ds);
      const off = new Float64Array(M).fill(NaN);
      for (let k = 0; k < M; k++) {
        const ka = Math.max(0, k - 1), kb = Math.min(M - 1, k + 1);
        let tn = dn[kb] - dn[ka], te = de[kb] - de[ka];
        const tl = Math.hypot(tn, te) || 1;
        tn /= tl; te /= tl;
        const nn = -te, ne = tn; // a normal
        const h0 = surfaceAt(g, gn[k], ge[k]);
        if (!(h0 > SEA)) continue;
        // Walk each side; collect the section in xsN (index 0 = far left).
        const half = Math.floor(P.crossHalf / P.crossStep);
        let lo = half, hi = half;
        xsN.fill(NaN);
        xsN[half] = h0;
        for (const sd of [1, -1]) {
          for (let t = 1; t <= half; t++) {
            const v = surfaceAt(g, gn[k] + sd * t * P.crossStep * nn, ge[k] + sd * t * P.crossStep * ne);
            if (!(v > SEA)) break;
            xsN[half + sd * t] = v;
            if (sd > 0) hi = half + t; else lo = half - t;
            if (v > h0 + P.rise) break;
          }
        }
        let im = half;
        for (let t = lo; t <= hi; t++) if (xsN[t] < xsN[im]) im = t;
        const hm = xsN[im];
        let a = im, b = im;
        while (a > lo && xsN[a - 1] <= hm + P.band) a--;
        while (b < hi && xsN[b + 1] <= hm + P.band) b++;
        off[k] = ((a + b) / 2 - half) * P.crossStep;
        if (pass === 1) {
          let fa = im, fb = im;
          while (fa > lo && xsN[fa - 1] <= hm + P.floorBand) fa--;
          while (fb < hi && xsN[fb + 1] <= hm + P.floorBand) fb++;
          w5[k] = (fb - fa + 1) * P.crossStep;
        }
      }
      // Fill failed sections from their neighbours, then move and smooth.
      let last = NaN;
      for (let k = 0; k < M; k++) { if (Number.isNaN(off[k])) off[k] = Number.isNaN(last) ? 0 : last; else last = off[k]; }
      const rn = new Float64Array(M), re = new Float64Array(M);
      for (let k = 0; k < M; k++) {
        const ka = Math.max(0, k - 1), kb = Math.min(M - 1, k + 1);
        let tn = dn[kb] - dn[ka], te = de[kb] - de[ka];
        const tl = Math.hypot(tn, te) || 1;
        tn /= tl; te /= tl;
        rn[k] = gn[k] - te * off[k];
        re[k] = ge[k] + tn * off[k];
      }
      gn = gauss(rn, P.axisSigma / P.ds);
      ge = gauss(re, P.axisSigma / P.ds);
    }
    // What is measured.
    let sEnd = 0;
    const s = new Float64Array(M);
    for (let k = 1; k < M; k++) s[k] = s[k - 1] + Math.hypot(gn[k] - gn[k - 1], ge[k] - ge[k - 1]);
    sEnd = s[M - 1];
    for (let k = 0; k < M; k++) {
      const cc = pc[k];
      let good = !flatAt(cc) && !Number.isNaN(w5[k]) && area[cc] >= P.minArea && edge[cc] === 0;
      if (junction && sEnd - s[k] < P.junctionSkip) good = false;
      ok[k] = good ? 1 : 0;
    }
    let inPiece = false;
    for (let k = 0; k < M; k++) {
      if (!ok[k]) { inPiece = false; continue; }
      if (!inPiece) { piece++; inPiece = true; }
      const cc = pc[k];
      outN.push(gn[k]); outE.push(ge[k]); outS.push(s[k]); outL.push(lineId); outP.push(piece - 1);
      outC.push(classOf(area[cc]));
      outA.push(area[cc] / 1e6);
      outLand.push(relief(gn[k], ge[k]));
      outW.push(w5[k]);
    }
  }
  const K = outN.length;
  const ax: Axes = {
    name: g.name, cell, n: Float64Array.from(outN), e: Float64Array.from(outE), s: Float64Array.from(outS), line: Int32Array.from(outL),
    piece: Int32Array.from(outP), cls: Int8Array.from(outC), area: Float32Array.from(outA), landC: Int8Array.from(outLand), w5: Float32Array.from(outW),
    m: P.windows.map(() => new Float32Array(K).fill(NaN)), lines: nLines, km: (K * P.ds) / 1000,
  };
  windows(ax);
  return ax;
}

/** m_L for every sample: the least chord deviation of any L window containing it, within its piece. */
function windows(ax: Axes): void {
  const K = ax.n.length;
  let a0 = 0;
  while (a0 < K) {
    let b0 = a0;
    while (b0 + 1 < K && ax.piece[b0 + 1] === ax.piece[a0]) b0++;
    // piece a0..b0
    P.windows.forEach((L, wi) => {
      const m = ax.m[wi];
      if (ax.s[b0] - ax.s[a0] < L) return;
      for (let k = a0; k <= b0; k++) m[k] = Infinity;
      let b = a0;
      for (let a = a0; a <= b0; ) {
        while (b <= b0 && ax.s[b] - ax.s[a] < L) b++;
        if (b > b0) break;
        let un = ax.n[b] - ax.n[a], ue = ax.e[b] - ax.e[a];
        const ul = Math.hypot(un, ue) || 1;
        un /= ul; ue /= ul;
        let dev = 0;
        for (let k = a + 1; k < b; k++) { const d = Math.abs((ax.n[k] - ax.n[a]) * ue - (ax.e[k] - ax.e[a]) * un); if (d > dev) dev = d; }
        for (let k = a; k <= b; k++) if (dev < m[k]) m[k] = dev;
        const s0 = ax.s[a];
        while (a <= b0 && ax.s[a] - s0 < P.winStep) a++;
      }
      for (let k = a0; k <= b0; k++) if (m[k] === Infinity) m[k] = NaN;
    });
    a0 = b0 + 1;
  }
}

export interface Bend { cls: number; land: number; amp: number; wave: number; floor: number }

/** Bends between inflections of the axis heading (secondary measure). */
export function bends(ax: Axes): Bend[] {
  const out: Bend[] = [];
  const K = ax.n.length;
  let a0 = 0;
  while (a0 < K) {
    let b0 = a0;
    while (b0 + 1 < K && ax.piece[b0 + 1] === ax.piece[a0]) b0++;
    const M = b0 - a0 + 1;
    if (M >= 10) {
      const th = new Float64Array(M);
      for (let k = 0; k < M; k++) {
        const ka = a0 + Math.max(0, k - 1), kb = a0 + Math.min(M - 1, k + 1);
        th[k] = Math.atan2(ax.e[kb] - ax.e[ka], ax.n[kb] - ax.n[ka]);
        if (k > 0) { while (th[k] - th[k - 1] > Math.PI) th[k] -= 2 * Math.PI; while (th[k] - th[k - 1] < -Math.PI) th[k] += 2 * Math.PI; }
      }
      const ts = gauss(th, P.bendSigma / P.ds);
      // Inflections: sign changes of the turning; merge turns under BEND_TURN.
      let cuts: number[] = [0];
      for (let k = 1; k + 1 < M; k++) if (Math.sign(ts[k] - ts[k - 1]) !== Math.sign(ts[k + 1] - ts[k]) && ts[k + 1] !== ts[k]) cuts.push(k);
      cuts.push(M - 1);
      const lim = (P.bendTurn * Math.PI) / 180;
      for (let changed = true; changed && cuts.length > 2; ) {
        changed = false;
        let wi = -1, wv = Infinity;
        for (let i = 0; i + 1 < cuts.length; i++) { const t = Math.abs(ts[cuts[i + 1]] - ts[cuts[i]]); if (t < wv) { wv = t; wi = i; } }
        if (wv < lim) {
          // drop the inner cut that merges the smallest turn into its neighbour (keep the piece ends)
          const drop = wi === 0 ? 1 : wi + 1 === cuts.length - 1 ? wi : wi + 1;
          cuts = cuts.filter((_, i) => i !== drop);
          changed = true;
        }
      }
      for (let i = 0; i + 1 < cuts.length; i++) {
        if (i === 0 || i + 2 === cuts.length) continue; // a piece's end bends are cut short
        const a = a0 + cuts[i], b = a0 + cuts[i + 1];
        let un = ax.n[b] - ax.n[a], ue = ax.e[b] - ax.e[a];
        const ul = Math.hypot(un, ue) || 1;
        un /= ul; ue /= ul;
        let amp = 0;
        const ws: number[] = [];
        for (let k = a; k <= b; k++) { amp = Math.max(amp, Math.abs((ax.n[k] - ax.n[a]) * ue - (ax.e[k] - ax.e[a]) * un)); ws.push(ax.w5[k]); }
        ws.sort((x, y) => x - y);
        const mid = a + ((b - a) >> 1);
        out.push({ cls: ax.cls[mid], land: ax.landC[mid], amp, wave: 2 * ul, floor: ws[ws.length >> 1] });
      }
    }
    a0 = b0 + 1;
  }
  return out;
}

// ---------------------------------------------------------------- summaries

export const D_GRID = [50, 60, 100, 150, 200, 210, 250, 300, 350, 500, 700];

/** Length-weighted quantile. */
export function wq(v: number[], w: number[], p: number): number {
  if (!v.length) return NaN;
  const idx = v.map((_, i) => i).sort((a, b) => v[a] - v[b]);
  const tot = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (const i of idx) { acc += w[i]; if (acc >= p * tot) return v[i]; }
  return v[idx[idx.length - 1]];
}

/** Reaches: runs of one class along one line (measured samples only); returns per reach the eligible length per window and the count at or under each d. */
export interface Reach { cls: number; line: number; km: number; elig: number[]; under: number[][] }
export function reaches(ax: Axes): Reach[] {
  const out: Reach[] = [];
  const K = ax.n.length;
  let a = 0;
  while (a < K) {
    let b = a;
    while (b + 1 < K && ax.line[b + 1] === ax.line[a] && ax.cls[b + 1] === ax.cls[a]) b++;
    const r: Reach = { cls: ax.cls[a], line: ax.line[a], km: ((b - a + 1) * P.ds) / 1000, elig: P.windows.map(() => 0), under: P.windows.map(() => D_GRID.map(() => 0)) };
    for (let k = a; k <= b; k++) P.windows.forEach((_, wi) => {
      const m = ax.m[wi][k];
      if (Number.isNaN(m)) return;
      r.elig[wi]++;
      D_GRID.forEach((d, di) => { if (m <= d) r.under[wi][di]++; });
    });
    out.push(r);
    a = b + 1;
  }
  return out;
}

/** Longest run (km) of consecutive samples with m_L <= d, by class. */
export function longestRun(ax: Axes, wi: number, d: number): number[] {
  const best = P.classes.map(() => 0);
  const K = ax.n.length;
  let a = 0;
  while (a < K) {
    if (!(ax.m[wi][a] <= d)) { a++; continue; }
    let b = a;
    while (b + 1 < K && ax.piece[b + 1] === ax.piece[a] && ax.m[wi][b + 1] <= d) b++;
    const km = (ax.s[b] - ax.s[a]) / 1000;
    const counts = P.classes.map(() => 0);
    for (let k = a; k <= b; k++) counts[ax.cls[k]]++;
    const c = counts.indexOf(Math.max(...counts));
    best[c] = Math.max(best[c], km);
    a = b + 1;
  }
  return best;
}
