// Drainage of a seeded world (any seed but 0): where water runs and where it pools, worked out on a coarse lattice of
// the natural terrain. Pure (no three.js): every thread runs it at load and gets the same answer.
//
//   1. Sample the natural terrain on a 1 km lattice over the drainage domain (DOMAIN_HALF around the field), with a
//      low mound over the home field so no river is routed across it.
//   2. Priority flood (Barnes et al. 2014) from the sea and the domain's edge: every cell gets the level water would
//      fill it to and a receiver, the neighbour its water flows to. Filled hollows deep and wide enough become lakes.
//   3. Flow accumulation in reverse flood order: each cell's catchment area.
//   4. The river network: every cell whose catchment passes RIVER_AREA is a channel. Lines are traced upstream from
//      each mouth, the largest branch continuing the line at each confluence and the others starting tributaries,
//      so a line runs source to mouth and a tributary ends on the node of the line it joins.

import { AIRPORT } from '../../core/world';

/** Half-size of the drainage domain around the field, m, and its lattice spacing, m. */
export const DOMAIN_HALF = 160000;
export const DRAIN_CELL = 1000;
/** Catchment area at which a channel begins, km² (cells). */
export const RIVER_AREA = 45;
/** A filled hollow becomes a lake when it is at least this deep, m, and this many cells. */
const LAKE_DEPTH = 8;
const LAKE_CELLS = 2;
/** Larger hollows are not lakes: their river cuts down through the rim and drains them. */
const LAKE_MAX_CELLS = 80;
/** Most lakes kept (the largest by volume). */
const LAKE_MAX = 40;
/** Height of the mound over the home field during routing, m, and its radius, m. */
const HOME_MOUND = 80;
const HOME_RADIUS = 3500;

/** A river line on the lattice: cells from source to mouth, and what it flows into. */
export interface DrainLine {
  /** Lattice cell indices, source first. */
  cells: number[];
  /** Catchment area at each cell, km². */
  area: number[];
  /** The line this one flows into (-1: the sea or the domain's edge) and the index of the junction in its cells. */
  joins: number;
  joinAt: number;
}

/** A filled hollow: its cells and spill level on the lattice. */
export interface DrainLake {
  cells: number[];
  level: number;
  /** Deepest fill, m. */
  depth: number;
}

export interface Drainage {
  /** Lattice size (cells per side) and the world position of cell 0, m. */
  n: number;
  origin: number;
  /** Natural terrain, filled level, receiver (-1 at outlets) and catchment area per cell. */
  height: Float32Array;
  filled: Float32Array;
  receiver: Int32Array;
  area: Float32Array;
  lines: DrainLine[];
  lakes: DrainLake[];
}

/** World position of a lattice cell, m. */
export function cellNorth(d: Drainage, c: number): number {
  return d.origin + Math.floor(c / d.n) * DRAIN_CELL;
}
export function cellEast(d: Drainage, c: number): number {
  return d.origin + (c % d.n) * DRAIN_CELL;
}

/** Work out the drainage of the natural terrain `natural` (m MSL at north, east). */
export function buildDrainage(natural: (north: number, east: number) => number): Drainage {
  const n = Math.round((2 * DOMAIN_HALF) / DRAIN_CELL) + 1;
  const origin = -DOMAIN_HALF;
  const N = n * n;
  const height = new Float32Array(N);
  const rc = AIRPORT.runway.center;
  for (let i = 0; i < n; i++) {
    const north = origin + i * DRAIN_CELL;
    for (let j = 0; j < n; j++) {
      const east = origin + j * DRAIN_CELL;
      let h = natural(north, east);
      const r = Math.hypot(north - rc.north, east - rc.east);
      if (r < HOME_RADIUS) h += HOME_MOUND * (1 - r / HOME_RADIUS);
      height[i * n + j] = h;
    }
  }

  // --- Priority flood: outlets are the sea and the domain's edge.
  const filled = new Float32Array(N);
  const receiver = new Int32Array(N).fill(-1);
  const done = new Uint8Array(N);
  const order = new Int32Array(N);
  let popped = 0;
  const heap = new MinHeap(N);
  for (let c = 0; c < N; c++) {
    const i = Math.floor(c / n);
    const j = c % n;
    if (height[c] <= 0 || i === 0 || j === 0 || i === n - 1 || j === n - 1) {
      filled[c] = height[c];
      done[c] = 1;
      heap.push(c, filled[c]);
    }
  }
  const DI = [-1, -1, -1, 0, 0, 1, 1, 1];
  const DJ = [-1, 0, 1, -1, 1, -1, 0, 1];
  while (heap.size > 0) {
    const c = heap.pop();
    order[popped++] = c;
    const i = Math.floor(c / n);
    const j = c % n;
    for (let k = 0; k < 8; k++) {
      const ii = i + DI[k];
      const jj = j + DJ[k];
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const nb = ii * n + jj;
      if (done[nb]) continue;
      done[nb] = 1;
      // A tiny rise per step across filled flats keeps every cell draining toward the spill point.
      filled[nb] = Math.max(height[nb], filled[c] + 1e-3);
      receiver[nb] = c;
      heap.push(nb, filled[nb]);
    }
  }

  // --- Flow accumulation: upstream cells come later in flood order.
  const area = new Float32Array(N).fill((DRAIN_CELL * DRAIN_CELL) / 1e6);
  for (let k = N - 1; k >= 0; k--) {
    const c = order[k];
    const r = receiver[c];
    if (r >= 0) area[r] += area[c];
  }

  // --- Lakes: connected filled hollows (8-neighbour), deep and wide enough, away from the home field and the sea.
  const lakeOf = new Int32Array(N).fill(-1);
  const found: DrainLake[] = [];
  for (let c = 0; c < N; c++) {
    if (lakeOf[c] !== -1 || filled[c] - height[c] < 0.5 || height[c] <= 0) continue;
    const cells: number[] = [];
    const stack = [c];
    lakeOf[c] = -2;
    let depth = 0;
    let level = -Infinity;
    while (stack.length) {
      const q = stack.pop() as number;
      cells.push(q);
      depth = Math.max(depth, filled[q] - height[q]);
      level = Math.max(level, filled[q]);
      const i = Math.floor(q / n);
      const j = q % n;
      for (let k = 0; k < 8; k++) {
        const ii = i + DI[k];
        const jj = j + DJ[k];
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const nb = ii * n + jj;
        if (lakeOf[nb] !== -1 || filled[nb] - height[nb] < 0.5 || height[nb] <= 0) continue;
        lakeOf[nb] = -2;
        stack.push(nb);
      }
    }
    if (depth < LAKE_DEPTH || cells.length < LAKE_CELLS || cells.length > LAKE_MAX_CELLS) continue;
    let near = false;
    for (const q of cells) if (Math.hypot(origin + Math.floor(q / n) * DRAIN_CELL - rc.north, origin + (q % n) * DRAIN_CELL - rc.east) < 6000) near = true;
    if (!near) found.push({ cells, level, depth });
  }
  const volume = (l: DrainLake): number => l.cells.reduce((s, q) => s + filled[q] - height[q], 0);
  found.sort((a, b) => volume(b) - volume(a));
  const lakes = found.slice(0, LAKE_MAX);

  // --- River lines, traced upstream from each mouth.
  const isChannel = (c: number): boolean => area[c] >= RIVER_AREA;
  // Donors of each channel cell (CSR over the receiver tree, channel cells only).
  const donorStart = new Int32Array(N + 1);
  for (let c = 0; c < N; c++) if (isChannel(c) && receiver[c] >= 0) donorStart[receiver[c] + 1]++;
  for (let c = 0; c < N; c++) donorStart[c + 1] += donorStart[c];
  const donors = new Int32Array(donorStart[N]);
  const fill = donorStart.slice(0, N);
  for (let c = 0; c < N; c++) if (isChannel(c) && receiver[c] >= 0) donors[fill[receiver[c]]++] = c;

  const lines: DrainLine[] = [];
  // Work items: a cell to trace upstream from, and the line/junction it flows into.
  const work: Array<{ start: number; joins: number; joinAt: number }> = [];
  // Lines start at the outlets the channels reach (a sea cell or an edge cell; channel area accumulates into them).
  for (let c = 0; c < N; c++) if (isChannel(c) && receiver[c] < 0) work.push({ start: c, joins: -1, joinAt: -1 });
  // Largest rivers first, so line 0 is the main river.
  work.sort((a, b) => area[b.start] - area[a.start]);

  while (work.length) {
    const w = work.shift() as { start: number; joins: number; joinAt: number };
    // Walk upstream along the largest donor; collect the others as tributaries of this line.
    const down: number[] = [];
    const side: number[][] = [];
    let c = w.start;
    for (;;) {
      down.push(c);
      let best = -1;
      const others: number[] = [];
      for (let k = donorStart[c]; k < donorStart[c + 1]; k++) {
        const d = donors[k];
        if (best < 0 || area[d] > area[best]) {
          if (best >= 0) others.push(best);
          best = d;
        } else others.push(d);
      }
      side.push(others);
      if (best < 0) break;
      c = best;
    }
    // Source first.
    const cells = down.slice().reverse();
    // A lone outlet cell (channel-sized catchment, but fed only by sheet flow) is not a river.
    if (cells.length < 2 && w.joins < 0) continue;
    const lineIndex = lines.length;
    // A tributary ends on the junction cell of the line it joins (a main line already ends on its outlet).
    if (w.joins >= 0) cells.push(lines[w.joins].cells[w.joinAt]);
    lines.push({ cells, area: cells.map((q) => area[q]), joins: w.joins, joinAt: w.joinAt });
    // Tributaries: index of the junction cell in this line's (source-first) cells.
    const len = down.length;
    const trib: Array<{ start: number; joins: number; joinAt: number }> = [];
    for (let k = 0; k < len; k++) for (const t of side[k]) trib.push({ start: t, joins: lineIndex, joinAt: len - 1 - k });
    trib.sort((a, b) => area[b.start] - area[a.start]);
    // Keep the queue ordered by size so bigger tributaries get lower indices.
    for (const t of trib) {
      let at = work.length;
      while (at > 0 && area[work[at - 1].start] < area[t.start]) at--;
      work.splice(at, 0, t);
    }
  }

  return { n, origin, height, filled, receiver, area, lines, lakes };
}

/** Binary min-heap of cell indices keyed by level; ties by insertion order are not needed for determinism (keys + ids). */
class MinHeap {
  private readonly ids: Int32Array;
  private readonly keys: Float64Array;
  size = 0;
  constructor(cap: number) {
    this.ids = new Int32Array(cap);
    this.keys = new Float64Array(cap);
  }
  private less(a: number, b: number): boolean {
    const ka = this.keys[a];
    const kb = this.keys[b];
    return ka < kb || (ka === kb && this.ids[a] < this.ids[b]);
  }
  private swap(a: number, b: number): void {
    const ti = this.ids[a];
    this.ids[a] = this.ids[b];
    this.ids[b] = ti;
    const tk = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = tk;
  }
  push(id: number, key: number): void {
    let i = this.size++;
    this.ids[i] = id;
    this.keys[i] = key;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.ids[0];
    this.size--;
    if (this.size > 0) {
      this.ids[0] = this.ids[this.size];
      this.keys[0] = this.keys[this.size];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.size && this.less(l, m)) m = l;
        if (r < this.size && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}
