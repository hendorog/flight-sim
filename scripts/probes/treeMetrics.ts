// Drainage-tree measurements shared by the probes treeMeasure (the seeded worlds as built), treeSpike (a long
// uplift + stream-power evolution of the same inputs) and the NZ comparison (out/tree/nz.py mirrors these rules).
// Experimental, probes only: nothing here is wired into the game.
//
// A drainage tree is a receiver per lattice cell (-1 at an outlet: the sea or the domain's edge) and a catchment per
// cell, km². The measures:
//  - confluences: a cell with two donors that each drain at least T km² (T = 10, 45, 200), by the class of ground
//    the junction lies in (mountain / hill / plain);
//  - range-front exits: a mountain cell whose receiver is outside the mountains and whose water never re-enters them
//    (to the sea or the edge without crossing mountain ground again); their number, nearest-neighbour spacing and
//    catchment, and the share of all water crossing the front carried by the largest few;
//  - per big river (mouth >= 500 km²): its largest single range exit as a share of its mouth area, and how many
//    exits >= 10 km² feed it (the Rakaia: one exit ~2560 of 2870 km², 89 %);
//  - Hack h: log L against log A over the land cells (L the longest flow path upstream of the cell, as
//    out/landforms/tools/validate.py), and Schumm's elongation Re = 2 sqrt(A / pi) / Lmax of the big basins.

import { macroAt, type Macro } from '../../src/world/terrain/seededLayout';

export const CLASS_SEA = 0;
export const CLASS_PLAIN = 1;
export const CLASS_HILL = 2;
export const CLASS_MTN = 3;
export const CLASS_NAMES = ['sea', 'plain', 'hill', 'mountain'];

const DI = [-1, -1, -1, 0, 0, 1, 1, 1];
const DJ = [-1, 0, 1, -1, 1, -1, 0, 1];

export interface Tree {
  n: number;
  /** Cell spacing, m. */
  cell: number;
  receiver: Int32Array;
  /** Catchment, km². */
  area: Float32Array;
}

/** Cells ordered downstream first (every cell after its receiver). */
export function topoOrder(receiver: Int32Array): Int32Array {
  const N = receiver.length;
  const start = new Int32Array(N + 1);
  for (let c = 0; c < N; c++) if (receiver[c] >= 0) start[receiver[c] + 1]++;
  for (let c = 0; c < N; c++) start[c + 1] += start[c];
  const donors = new Int32Array(start[N]);
  const fill = start.slice(0, N);
  for (let c = 0; c < N; c++) if (receiver[c] >= 0) donors[fill[receiver[c]]++] = c;
  const order = new Int32Array(N);
  let head = 0;
  let tail = 0;
  for (let c = 0; c < N; c++) if (receiver[c] < 0) order[tail++] = c;
  while (head < tail) {
    const c = order[head++];
    for (let k = start[c]; k < start[c + 1]; k++) order[tail++] = donors[k];
  }
  if (tail !== N) throw new Error(`receiver graph has a cycle (${N - tail} cells)`);
  return order;
}

/** Catchment, km², from receivers (each cell cell² m²). */
export function accumulate(receiver: Int32Array, order: Int32Array, cell: number): Float32Array {
  const area = new Float32Array(receiver.length).fill((cell * cell) / 1e6);
  for (let k = order.length - 1; k >= 0; k--) {
    const c = order[k];
    const r = receiver[c];
    if (r >= 0) area[r] += area[c];
  }
  return area;
}

/** The generator's macro fields per lattice cell (seededLayout.ts macroAt) and the hill amplitude seededNaturalHeight
 * gives them, m. */
export interface Fields {
  inland: Float32Array;
  uplift: Float32Array;
  foothill: Float32Array;
  hilly: Float32Array;
  hillAmp: Float32Array;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function macroFields(n: number, origin: number, cell: number): Fields {
  const N = n * n;
  const f: Fields = { inland: new Float32Array(N), uplift: new Float32Array(N), foothill: new Float32Array(N), hilly: new Float32Array(N), hillAmp: new Float32Array(N) };
  const m: Macro = { inland: 0, uplift: 0, foothill: 0, hilly: 0 };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      macroAt(origin + i * cell, origin + j * cell, m);
      const c = i * n + j;
      f.inland[c] = m.inland;
      f.uplift[c] = m.uplift;
      f.foothill[c] = m.foothill;
      f.hilly[c] = m.hilly;
      // heightfield.ts seededNaturalHeight: hillAmp = (90 + 260 smooth(-1000, 7000, inland) + 480 foothill) hilly.
      f.hillAmp[c] = (90 + 260 * smooth(-1000, 7000, m.inland) + 480 * m.foothill) * m.hilly;
    }
  }
  return f;
}

/** Mountain where uplift >= MTN_UPLIFT (mountain noise amplitude 3100 x uplift >= 775 m), in connected ranges of at
 * least MTN_MIN_CELLS cells; hill where the hill amplitude >= HILL_AMP m; plain otherwise; sea where the ground is at
 * or below 0 m. */
export const MTN_UPLIFT = 0.25;
export const MTN_MIN_CELLS = 100;
export const HILL_AMP = 300;

export function fieldClasses(n: number, f: Fields, h: Float32Array): Uint8Array {
  const N = n * n;
  const cls = new Uint8Array(N);
  for (let c = 0; c < N; c++) {
    if (h[c] <= 0) cls[c] = CLASS_SEA;
    else if (f.uplift[c] >= MTN_UPLIFT) cls[c] = CLASS_MTN;
    else if (f.hillAmp[c] >= HILL_AMP) cls[c] = CLASS_HILL;
    else cls[c] = CLASS_PLAIN;
  }
  dropSmallRanges(n, cls, f);
  return cls;
}

/** Relief classes: max - min of the ground within RELIEF_R cells (a 5 km window at 1 km): mountain >= RELIEF_MTN m,
 * hill >= RELIEF_HILL m, plain below; the same rule as out/tree/nz.py, so it carries to NZ ground. */
export const RELIEF_R = 2;
export const RELIEF_MTN = 500;
export const RELIEF_HILL = 150;

export function reliefClasses(n: number, h: Float32Array, cellM = 1000): Uint8Array {
  const N = n * n;
  const cls = new Uint8Array(N);
  const R = Math.max(1, Math.round((RELIEF_R * 1000) / cellM));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const c = i * n + j;
      if (h[c] <= 0) continue;
      let lo = Infinity;
      let hi = -Infinity;
      for (let a = -R; a <= R; a++) {
        const ii = i + a;
        if (ii < 0 || ii >= n) continue;
        for (let b = -R; b <= R; b++) {
          const jj = j + b;
          if (jj < 0 || jj >= n) continue;
          const v = Math.max(0, h[ii * n + jj]);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      const r = hi - lo;
      cls[c] = r >= RELIEF_MTN ? CLASS_MTN : r >= RELIEF_HILL ? CLASS_HILL : CLASS_PLAIN;
    }
  }
  dropSmallRanges(n, cls);
  return cls;
}

/** Mountain blobs under MTN_MIN_CELLS become hill. */
function dropSmallRanges(n: number, cls: Uint8Array, _f?: Fields): void {
  const N = n * n;
  const seen = new Uint8Array(N);
  const stack: number[] = [];
  for (let c0 = 0; c0 < N; c0++) {
    if (seen[c0] || cls[c0] !== CLASS_MTN) continue;
    const blob: number[] = [];
    seen[c0] = 1;
    stack.push(c0);
    while (stack.length) {
      const c = stack.pop() as number;
      blob.push(c);
      const i = (c / n) | 0;
      const j = c - i * n;
      for (let k = 0; k < 8; k++) {
        const ii = i + DI[k];
        const jj = j + DJ[k];
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const q = ii * n + jj;
        if (!seen[q] && cls[q] === CLASS_MTN) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (blob.length < MTN_MIN_CELLS) for (const c of blob) cls[c] = CLASS_HILL;
  }
}

const q = (xs: number[], f: number): number => {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(f * (s.length - 1))))];
};
export const quant = q;

/** Least-squares slope and intercept of log10 y on log10 x. */
export function fitLogLog(xs: number[], ys: number[]): { b: number; a: number } {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let k = 0; k < xs.length; k++) {
    if (!(xs[k] > 0) || !(ys[k] > 0)) continue;
    const x = Math.log10(xs[k]);
    const y = Math.log10(ys[k]);
    n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return { b, a: Math.pow(10, (sy - b * sx) / n) };
}

export interface Confluence {
  cell: number;
  a1: number;
  a2: number;
  cls: number;
}

export interface Exit {
  cell: number;
  area: number;
  /** The outlet (sea or edge cell) its water reaches. */
  outlet: number;
}

export interface TreeStats {
  label: string;
  confluences: Confluence[];
  exits: Exit[];
  hack: { h: number; c: number; hMtn: number };
  re: { basins: number[]; exits: number[] };
  mouths: Array<{ outlet: number; area: number; topExit: number; exits10: number; sea: boolean }>;
  classArea: number[];
  frontCells: number;
  text: string;
}

/** Measure a drainage tree against a class map. `isSea(c)` marks outlets on the sea (others are the domain's edge). */
export function measureTree(label: string, t: Tree, cls: Uint8Array, isSea: (c: number) => boolean): TreeStats {
  const { n, receiver, area } = t;
  const N = n * n;
  const order = topoOrder(receiver);
  const L = t.cell / 1000;
  const lines: string[] = [];

  // --- Classes' land area (km²) and the front's length (mountain cells next to non-mountain land).
  const classArea = [0, 0, 0, 0];
  let frontCells = 0;
  for (let c = 0; c < N; c++) {
    classArea[cls[c]] += L * L;
    if (cls[c] !== CLASS_MTN) continue;
    const i = (c / n) | 0;
    const j = c - i * n;
    for (let k = 1; k < 8; k += 2) {
      const ii = i + DI[k], jj = j + DJ[k];
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const qc = ii * n + jj;
      if (cls[qc] === CLASS_PLAIN || cls[qc] === CLASS_HILL) {
        frontCells++;
        break;
      }
    }
  }
  const land = classArea[1] + classArea[2] + classArea[3];
  // Range width: each mountain cell's distance to the nearest ground that is not mountain (chamfer 1 / sqrt 2, km);
  // a straight range of width W has its cells' distances spread evenly over 0..W/2.
  const toFront = new Float32Array(N).fill(Infinity);
  {
    for (let c = 0; c < N; c++) if (cls[c] !== CLASS_MTN) toFront[c] = 0;
    for (let pass = 0; pass < 2; pass++) {
      const fw = pass === 0;
      for (let k0 = 0; k0 < N; k0++) {
        const c = fw ? k0 : N - 1 - k0;
        if (toFront[c] === 0) continue;
        const i = (c / n) | 0, j = c - i * n;
        let best = toFront[c];
        for (let k = 0; k < 8; k++) {
          const ii = i + DI[k], jj = j + DJ[k];
          if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
          const v = toFront[ii * n + jj] + (DI[k] && DJ[k] ? Math.SQRT2 : 1) * L;
          if (v < best) best = v;
        }
        toFront[c] = best;
      }
    }
  }
  const widths: number[] = [];
  for (let c = 0; c < N; c++) if (cls[c] === CLASS_MTN && Number.isFinite(toFront[c])) widths.push(toFront[c]);

  // --- Confluences: the two largest donors of each cell.
  const big1 = new Float32Array(N);
  const big2 = new Float32Array(N);
  for (let c = 0; c < N; c++) {
    const r = receiver[c];
    if (r < 0) continue;
    const a = area[c];
    if (a > big1[r]) (big2[r] = big1[r]), (big1[r] = a);
    else if (a > big2[r]) big2[r] = a;
  }
  const confluences: Confluence[] = [];
  for (let c = 0; c < N; c++) if (big2[c] >= 10 && cls[c] !== CLASS_SEA) confluences.push({ cell: c, a1: big1[c], a2: big2[c], cls: cls[c] });

  // --- Exits: downstream of a cell, does the water cross mountain ground again?
  const downMtn = new Uint8Array(N);
  const outletOf = new Int32Array(N);
  for (let k = 0; k < N; k++) {
    const c = order[k];
    const r = receiver[c];
    if (r < 0) {
      outletOf[c] = c;
      continue;
    }
    outletOf[c] = outletOf[r];
    downMtn[c] = cls[r] === CLASS_MTN || downMtn[r] ? 1 : 0;
  }
  const exits: Exit[] = [];
  for (let c = 0; c < N; c++) {
    const r = receiver[c];
    if (cls[c] !== CLASS_MTN || r < 0 || downMtn[c]) continue;
    // Straight into the sea or off the domain's edge: not a range front.
    if (cls[r] === CLASS_SEA || receiver[r] < 0) continue;
    exits.push({ cell: c, area: area[c], outlet: outletOf[c] });
  }
  exits.sort((a, b) => b.area - a.area);

  // --- Hack: the longest flow path upstream of each cell, km.
  const len = new Float32Array(N);
  for (let k = N - 1; k >= 0; k--) {
    const c = order[k];
    const r = receiver[c];
    if (r < 0) continue;
    const ci = (c / n) | 0, ri = (r / n) | 0;
    const step = ci !== ri && c - ci * n !== r - ri * n ? L * Math.SQRT2 : L;
    if (len[c] + step > len[r]) len[r] = len[c] + step;
  }
  const ha: number[] = [], hl: number[] = [], ma: number[] = [], ml: number[] = [];
  for (let c = 0; c < N; c++) {
    if (cls[c] === CLASS_SEA || area[c] < 10 || len[c] <= 0) continue;
    // Not cells whose catchment runs off the domain's edge... kept: the lattice's interior is most of it.
    ha.push(area[c]);
    hl.push(len[c]);
    if (cls[c] === CLASS_MTN) (ma.push(area[c]), ml.push(len[c]));
  }
  const hk = fitLogLog(ha, hl);
  const hm = fitLogLog(ma, ml);

  // --- Elongation of the basins at the outlets (>= 100 km²) and at the exits (>= 100 km²): the farthest cell of the
  // basin from its outlet, straight line.
  const far = new Map<number, number>();
  const exitSet = new Map<number, number>();
  for (const e of exits) if (e.area >= 100) exitSet.set(e.cell, 0);
  // Exit label per cell: nearest exit downstream (in order: a cell takes its receiver's).
  const exitOf = new Int32Array(N).fill(-1);
  for (let k = 0; k < N; k++) {
    const c = order[k];
    const r = receiver[c];
    exitOf[c] = exitSet.has(c) ? c : r >= 0 ? exitOf[r] : -1;
  }
  const dist = (a: number, b: number): number => {
    const ai = (a / n) | 0, bi = (b / n) | 0;
    return Math.hypot(ai - bi, a - ai * n - (b - bi * n)) * L;
  };
  for (let c = 0; c < N; c++) {
    const o = outletOf[c];
    if (area[o] >= 100) far.set(o, Math.max(far.get(o) ?? 0, dist(c, o)));
    const e = exitOf[c];
    if (e >= 0) exitSet.set(e, Math.max(exitSet.get(e) ?? 0, dist(c, e)));
  }
  const reOf = (a: number, lmax: number): number => (2 * Math.sqrt(a / Math.PI)) / Math.max(lmax, L);
  const reB: number[] = [];
  for (const [o, lm] of far) if (o >= 0 && isSea(o)) reB.push(reOf(area[o], lm));
  const reE: number[] = [];
  for (const [e, lm] of exitSet) reE.push(reOf(area[e], lm));

  // --- Big rivers: mouth area against their largest range exit.
  const byOutlet = new Map<number, Exit[]>();
  for (const e of exits) {
    const l = byOutlet.get(e.outlet) ?? [];
    l.push(e);
    byOutlet.set(e.outlet, l);
  }
  const mouths: TreeStats['mouths'] = [];
  for (const [o, es] of byOutlet) {
    if (area[o] < 500) continue;
    mouths.push({ outlet: o, area: area[o], topExit: es[0].area, exits10: es.filter((e) => e.area >= 10).length, sea: isSea(o) });
  }
  mouths.sort((a, b) => b.area - a.area);

  // --- Text.
  const f0 = (x: number): string => (Number.isFinite(x) ? x.toFixed(0) : '-');
  const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : '-');
  lines.push(`${label}: land ${f0(land)} km² (mountain ${f0(classArea[3])}, hill ${f0(classArea[2])}, plain ${f0(classArea[1])}); front ${frontCells} cells; mountain cells' distance to the front p50/p90/p99/max ${f2(q(widths, 0.5))}/${f2(q(widths, 0.9))}/${f2(q(widths, 0.99))}/${f2(q(widths, 1))} km`);
  for (const T of [10, 45, 200]) {
    const cs = confluences.filter((x) => x.a2 >= T);
    const by = [0, 0, 0, 0];
    for (const x of cs) by[x.cls]++;
    const tot = cs.length || 1;
    const dens = (k: number): string => (classArea[k] > 0 ? ((1000 * by[k]) / classArea[k]).toFixed(2) : '-');
    // Inside the ranges: on mountain ground, or upstream of a range exit (an intermontane basin: its water crosses
    // mountain ground again on the way out).
    const inside = cs.filter((x) => cls[x.cell] === CLASS_MTN || downMtn[x.cell]).length;
    lines.push(`  confluences both >= ${T} km²: ${cs.length}; mountain ${by[3]} (${((100 * by[3]) / tot).toFixed(0)} %), hill ${by[2]} (${((100 * by[2]) / tot).toFixed(0)} %), plain ${by[1]} (${((100 * by[1]) / tot).toFixed(0)} %); mountain+hill ${((100 * (by[3] + by[2])) / tot).toFixed(0)} %; inside the ranges ${((100 * inside) / tot).toFixed(0)} %; per 1000 km² mtn/hill/plain ${dens(3)}/${dens(2)}/${dens(1)}`);
  }
  const exitSum = exits.reduce((s, e) => s + e.area, 0);
  for (const T of [10, 45, 200]) {
    const es = exits.filter((e) => e.area >= T);
    const nn: number[] = [];
    for (const a of es) {
      let best = Infinity;
      for (const b of es) if (a !== b) best = Math.min(best, dist(a.cell, b.cell));
      if (best < Infinity) nn.push(best);
    }
    const areas = es.map((e) => e.area);
    lines.push(`  exits >= ${T} km²: ${es.length} (front ${frontCells} km -> one per ${f0(frontCells / Math.max(1, es.length))} km); NN spacing p25/p50/p75 ${f0(q(nn, 0.25))}/${f0(q(nn, 0.5))}/${f0(q(nn, 0.75))} km; area p25/p50/p75/max ${f0(q(areas, 0.25))}/${f0(q(areas, 0.5))}/${f0(q(areas, 0.75))}/${f0(q(areas, 1))} km²`);
  }
  const top = (k: number): string => ((100 * exits.slice(0, k).reduce((s, e) => s + e.area, 0)) / Math.max(1, exitSum)).toFixed(0);
  lines.push(`  water crossing the front: ${f0(exitSum)} km² in ${exits.length} exits (any size); top 1/3/5/10 carry ${top(1)}/${top(3)}/${top(5)}/${top(10)} %`);
  const ms = mouths.filter((m) => m.sea);
  const share = ms.map((m) => m.topExit / m.area);
  lines.push(`  rivers to the sea >= 500 km² fed from the ranges: ${ms.length}; largest exit / mouth area p25/p50/p75 ${f2(q(share, 0.25))}/${f2(q(share, 0.5))}/${f2(q(share, 0.75))}; exits >= 10 km² per river p50 ${f0(q(ms.map((m) => m.exits10), 0.5))}, max ${f0(q(ms.map((m) => m.exits10), 1))}`);
  lines.push(`    biggest: ${ms.slice(0, 6).map((m) => `${f0(m.area)} km² <- top exit ${f0(m.topExit)} (${f0((100 * m.topExit) / m.area)} %), ${m.exits10} exits>=10`).join('; ')}`);
  lines.push(`  Hack h (A >= 10 km², all land) ${f2(hk.b)} (c ${f2(hk.a)}), mountain cells ${f2(hm.b)}; elongation Re p50 sea basins >= 100 km² ${f2(q(reB, 0.5))} (n ${reB.length}), range-exit basins >= 100 km² ${f2(q(reE, 0.5))} (n ${reE.length})`);
  return { label, confluences, exits, hack: { h: hk.b, c: hk.a, hMtn: hm.b }, re: { basins: reB, exits: reE }, mouths, classArea, frontCells, text: lines.join('\n') };
}

/** Route a lattice: priority flood from the sea (h <= 0) and the edge (Barnes 2014, with a FIFO inside hollows), then
 * each cell drains to its steepest lower neighbour on the filled surface (distance-weighted D8); cells in a filled
 * hollow keep the flood's receiver (toward the spill). Returns the receivers and the filled surface. */
export class Router {
  readonly receiver: Int32Array;
  readonly filled: Float32Array;
  readonly order: Int32Array;
  readonly area: Float32Array;
  private readonly done: Uint8Array;
  private readonly pit: Int32Array;
  private readonly heap: Heap;
  constructor(private readonly n: number, private readonly cell: number) {
    const N = n * n;
    this.receiver = new Int32Array(N);
    this.filled = new Float32Array(N);
    this.order = new Int32Array(N);
    this.area = new Float32Array(N);
    this.done = new Uint8Array(N);
    this.pit = new Int32Array(N);
    this.heap = new Heap(N);
  }
  /** `fixed(c)`: base-level cells (outlets). */
  route(h: Float32Array, fixed: Uint8Array, steepest = true): void {
    const { n, receiver, filled, done, pit, heap, order } = this;
    const N = n * n;
    done.fill(0);
    receiver.fill(-1);
    heap.size = 0;
    let pitHead = 0, pitTail = 0, popped = 0;
    for (let c = 0; c < N; c++) {
      if (fixed[c]) {
        filled[c] = h[c];
        done[c] = 1;
        heap.push(c, h[c]);
      }
    }
    const flood = new Int32Array(0);
    void flood;
    while (pitHead < pitTail || heap.size > 0) {
      const c = pitHead < pitTail ? pit[pitHead++] : heap.pop();
      order[popped++] = c;
      const i = (c / n) | 0;
      const j = c - i * n;
      const fc = filled[c];
      for (let k = 0; k < 8; k++) {
        const ii = i + DI[k], jj = j + DJ[k];
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const nb = ii * n + jj;
        if (done[nb]) continue;
        done[nb] = 1;
        receiver[nb] = c;
        if (h[nb] <= fc + 1e-3) {
          filled[nb] = fc + 1e-3;
          pit[pitTail++] = nb;
        } else {
          filled[nb] = h[nb];
          heap.push(nb, h[nb]);
        }
      }
    }
    if (steepest) {
      // Steepest descent on the filled surface (cells standing above it: the hollow cells keep the flood receiver).
      for (let c = 0; c < N; c++) {
        if (fixed[c] || filled[c] > h[c] + 1e-6) continue;
        const i = (c / n) | 0;
        const j = c - i * n;
        let best = -1, bs = 0;
        for (let k = 0; k < 8; k++) {
          const ii = i + DI[k], jj = j + DJ[k];
          if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
          const nb = ii * n + jj;
          const d = filled[c] - filled[nb];
          if (d <= 0) continue;
          const s = d / (DI[k] && DJ[k] ? Math.SQRT2 : 1);
          if (s > bs) (bs = s), (best = nb);
        }
        if (best >= 0) receiver[c] = best;
      }
      // Downstream-first order by filled level (every receiver stands lower on the filled surface).
      const o = topoOrder(receiver);
      order.set(o);
    }
    const a0 = (this.cell * this.cell) / 1e6;
    this.area.fill(a0);
    for (let k = N - 1; k >= 0; k--) {
      const c = order[k];
      const r = receiver[c];
      if (r >= 0) this.area[r] += this.area[c];
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
    const ids = this.ids, keys = this.keys;
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
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const last = --this.size;
    if (last > 0) {
      const id = ids[last], key = keys[last];
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

/** A picture of a lattice: tinted relief with hill shading, channels >= 10 km² coloured by catchment (pale cyan at
 * 10 km² to deep blue/violet at 3000 km² and over), the range front (mountain-class boundary) in white, range exits
 * >= 45 km² as red squares sized by catchment, and confluences of two branches >= 45 km² as yellow dots. */
export function renderTree(n: number, h: Float32Array, t: Tree, cls: Uint8Array, s: TreeStats | null, scale = 3): { w: number; rgb: Uint8Array } {
  const W = n * scale;
  const rgb = new Uint8Array(W * W * 3);
  const TINT: Array<[number, number[]]> = [[0, [110, 150, 90]], [150, [150, 175, 105]], [400, [195, 190, 130]], [800, [180, 150, 105]], [1500, [150, 120, 95]], [2200, [170, 165, 160]], [2800, [245, 245, 250]]];
  const tint = (v: number): number[] => {
    if (v <= TINT[0][0]) return TINT[0][1];
    for (let k = 1; k < TINT.length; k++) if (v <= TINT[k][0]) { const u = (v - TINT[k - 1][0]) / (TINT[k][0] - TINT[k - 1][0]); return TINT[k - 1][1].map((x, m) => x + (TINT[k][1][m] - x) * u); }
    return TINT[TINT.length - 1][1];
  };
  const put = (x: number, y: number, c: number[]): void => {
    if (x < 0 || y < 0 || x >= W || y >= W) return;
    const o = (y * W + x) * 3;
    rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
  };
  // North up: row i (north) drawn at y = n - 1 - i.
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const c = i * n + j;
      const hx = h[i * n + Math.min(n - 1, j + 1)] - h[i * n + Math.max(0, j - 1)];
      const hy = h[Math.min(n - 1, i + 1) * n + j] - h[Math.max(0, i - 1) * n + j];
      const shade = Math.min(1.25, Math.max(0.45, 0.9 + ((-hx + hy) / (2 * t.cell)) * 2.5));
      let col = h[c] <= 0 ? [40, 70, 130] : tint(h[c]).map((v) => Math.max(0, Math.min(255, v * shade)));
      const a = t.area[c];
      if (h[c] > 0 && a >= 10) {
        const u = Math.min(1, Math.log10(a / 10) / Math.log10(300));
        col = [Math.round(150 * (1 - u) + 60 * u), Math.round(230 * (1 - u) + 20 * u), Math.round(255 * (1 - u) + 200 * u)];
      }
      for (let a2 = 0; a2 < scale; a2++) for (let b2 = 0; b2 < scale; b2++) put(j * scale + b2, (n - 1 - i) * scale + a2, col);
    }
  }
  // The front: mountain cells' edges toward non-mountain land.
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const c = i * n + j;
      if (cls[c] !== CLASS_MTN) continue;
      const y = (n - 1 - i) * scale, x = j * scale;
      const other = (ii: number, jj: number): boolean => ii >= 0 && jj >= 0 && ii < n && jj < n && cls[ii * n + jj] !== CLASS_MTN && cls[ii * n + jj] !== CLASS_SEA;
      if (other(i + 1, j)) for (let k = 0; k < scale; k++) put(x + k, y, [255, 255, 255]);
      if (other(i - 1, j)) for (let k = 0; k < scale; k++) put(x + k, y + scale - 1, [255, 255, 255]);
      if (other(i, j - 1)) for (let k = 0; k < scale; k++) put(x, y + k, [255, 255, 255]);
      if (other(i, j + 1)) for (let k = 0; k < scale; k++) put(x + scale - 1, y + k, [255, 255, 255]);
    }
  }
  if (s) {
    for (const cf of s.confluences) {
      if (cf.a2 < 45) continue;
      const i = (cf.cell / n) | 0, j = cf.cell - i * n;
      const cx = j * scale + (scale >> 1), cy = (n - 1 - i) * scale + (scale >> 1);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) put(cx + b, cy + a, [255, 220, 0]);
    }
    for (const e of s.exits) {
      if (e.area < 45) continue;
      const i = (e.cell / n) | 0, j = e.cell - i * n;
      const r = Math.round(1 + Math.min(5, Math.log10(e.area / 10) * 2.5));
      const cx = j * scale + (scale >> 1), cy = (n - 1 - i) * scale + (scale >> 1);
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) if (Math.abs(a) === r || Math.abs(b) === r) put(cx + b, cy + a, [230, 30, 30]);
    }
  }
  return { w: W, rgb };
}
