// Drainage of a seeded world (any seed but 0): where water runs and where it pools, worked out on a coarse lattice of
// the natural terrain. Pure (no three.js): every thread runs it at load and gets the same answer.
//
//   1. Sample the natural terrain on a 1 km lattice over the drainage domain (DOMAIN_HALF around the field), with a
//      low mound over the home field so no river is routed across it.
//   2. Priority flood (Barnes et al. 2014) from the sea and the domain's edge, and breaching or filling of every closed
//      hollow it finds (Lindsay 2016): a river big enough cuts through the rim (a gorge, up to an allowance that grows
//      with its catchment), the rest of the hollow ponds behind the cut (a lake, LakeMask). The flood over the cut
//      terrain gives every cell the level water stands at and a receiver, the neighbour its water flows to.
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
/** A pond becomes a lake when it is at least this deep, m (a shallower one on a river is cut out: the river entrenches
 * that much); a pond without a river also needs this many cells, and at most LAKE_MAX_CELLS (a big dry hollow is a
 * basin, not a lake: nothing feeds it). */
const LAKE_DEPTH = 15;
const LAKE_CELLS = 2;
const LAKE_MAX_CELLS = 80;
/** Most lakes kept: every one a river runs through first (by volume), then the dry hollows' (by volume). A world keeps
 * some 400-500 (the noise terrain is full of closed hollows; a lake costs nothing per terrain sample: LakeMask). */
const LAKE_MAX = 800;
/** Lakes keep this far from the home runway, m. */
export const LAKE_HOME_CLEAR = 6000;
/**
 * Breach allowance from stream power (E = K A^m S, m ~ 0.5): the deepest cut a river draining A km² keeps through a
 * rim is BREACH_DEPTH * sqrt(A), m, and the longest is BREACH_LENGTH + BREACH_LENGTH_AREA * sqrt(A) lattice cells
 * (counting only the cells cut more than BREACH_SHALLOW). A stream of 45 km² cuts some 20 m over 4 km; a river of
 * 2500 km² keeps a gorge 150 m deep and 13 km long. Smaller values give more lakes and fewer gorges.
 */
const BREACH_DEPTH = 3;
const BREACH_LENGTH = 3;
const BREACH_LENGTH_AREA = 0.2;
/** A lake's water stands at least this far over the detailed ground at its middle, m. */
const LAKE_MIDDLE_DEPTH = 4;
/** Largest pond a river may stand in, lattice cells (km²). */
const POND_MAX_CELLS = 120;
/** A cut no deeper than this, m, does not count toward a breach's length (a river entrenches that much anywhere: a
 * lowland hollow's rim may need a long, shallow cut to reach lower ground). */
const BREACH_SHALLOW = 10;
/** Breach-and-fill passes (each settles the hollows the last one's cuts and ponds left). */
const BREACH_PASSES = 6;
/** A hollow is filled at least this deep, m, before it counts as one. */
const HOLLOW_TOL = 0.5;
/** Height of the mound over the home field during routing, m, and its radius, m. */
export const HOME_MOUND = 80;
export const HOME_RADIUS = 3500;

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
  /** The pond's spill level on the lattice (LakeMask draws its edge from it), and the level its water stands at: the
   * spill level, or lower where the detailed ground dips under it round that edge, m. */
  spill: number;
  level: number;
  /** Deepest fill, m. */
  depth: number;
  /** Catchment area draining into it, km², and whether a river runs through it. */
  area: number;
  river: boolean;
  /** Its middle: the cell (of the few deepest) where the full-detail ground lies lowest under its water. */
  centre: number;
}

export interface Drainage {
  /** Lattice size (cells per side) and the world position of cell 0, m. */
  n: number;
  origin: number;
  /** Natural terrain, the terrain the water is routed over (breach cuts lowered in), filled level (lakes over the
   * routed terrain), receiver (-1 at outlets) and catchment area per cell. */
  height: Float32Array;
  routed: Float32Array;
  /** Why each cell was cut below the natural lattice (0: not; 1 within the river's allowance; 2 to keep its pond within
   * POND_MAX_CELLS; 3 a pond that could not be a lake cut out to its bottom). */
  cutWhy: Uint8Array;
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

/**
 * Work out the drainage of the natural terrain `natural` (m MSL at north, east). `fine`, the terrain with all its
 * detail, checks that each lake's water stands over the ground at its middle (the lattice routes the coarse terrain).
 * `onPonds` hears the ponds that may become lakes before they are settled against `fine`. `lattice`, when given, is
 * `natural` already sampled at the lattice's cells (erosion.ts), and saves sampling it again.
 */
export function buildDrainage(natural: (north: number, east: number) => number, fine: (north: number, east: number) => number = natural, onPonds?: (ponds: number[][]) => void, lattice?: Float32Array): Drainage {
  const n = Math.round((2 * DOMAIN_HALF) / DRAIN_CELL) + 1;
  const origin = -DOMAIN_HALF;
  const N = n * n;
  const height = new Float32Array(N);
  const rc = AIRPORT.runway.center;
  for (let i = 0; i < n; i++) {
    const north = origin + i * DRAIN_CELL;
    for (let j = 0; j < n; j++) {
      const east = origin + j * DRAIN_CELL;
      let h = lattice ? lattice[i * n + j] : natural(north, east);
      const r = Math.hypot(north - rc.north, east - rc.east);
      if (r < HOME_RADIUS) h += HOME_MOUND * (1 - r / HOME_RADIUS);
      height[i * n + j] = h;
    }
  }

  // --- Breaching and filling (Lindsay 2016, with the breach allowance from stream power): every closed hollow the
  // priority flood would fill is either cut through (a gorge, where the river draining it is big enough to have kept
  // its course through the rising rim) or ponded (a lake at the level the cut cannot get below), or both: the cut
  // reaches as deep as the river's allowance and the water stands behind it. `routed` is the terrain the water runs
  // over: the natural lattice with the breach cuts lowered into it.
  const routed = Float32Array.from(height);
  const flood = new Flood(n);
  const search = new BreachSearch(n);
  // Hollows already settled: the level their water was left standing at, kept on their pit cell.
  const settled = new Float32Array(N).fill(Infinity);
  // Cells by the home runway, where no lake may reach.
  const byHome = new Uint8Array(N);
  for (let c = 0; c < N; c++) {
    if (Math.hypot(origin + Math.floor(c / n) * DRAIN_CELL - rc.north, origin + (c % n) * DRAIN_CELL - rc.east) < LAKE_HOME_CLEAR) byHome[c] = 1;
  }
  // Why each cell was cut (probes): 1 within the allowance, 2 to keep a pond within POND_MAX_CELLS, 3 a pond that
  // could not be a lake cut out.
  const cutWhy = new Uint8Array(N);
  for (let pass = 0; pass < BREACH_PASSES; pass++) {
    flood.run(routed);
    const regions = fillRegions(n, routed, flood);
    let changed = 0;
    for (const r of regions) {
      // A pond already settled (its pit, or a deeper hollow it covers, in the region) at about this level is done.
      let kept = Infinity;
      for (const q of r.cells) kept = Math.min(kept, settled[q]);
      if (kept < Infinity && r.level <= kept + HOLLOW_TOL) continue;
      const allowDepth = BREACH_DEPTH * Math.sqrt(r.area);
      const allowLength = Math.round(BREACH_LENGTH + BREACH_LENGTH_AREA * Math.sqrt(r.area));
      const depth = r.level - routed[r.pit];
      // The level the water is left at: as low as the cut allows (the bottom of the hollow if the whole rim can go).
      let lw = Math.max(routed[r.pit], r.level - allowDepth);
      // A residual pond too shallow for a lake is cut out entirely (a few metres deeper than the allowance).
      if (lw - routed[r.pit] < LAKE_DEPTH && depth > 0) lw = routed[r.pit];
      let maxCut = lw === routed[r.pit] ? allowDepth + LAKE_DEPTH : allowDepth;
      let maxLen = allowLength;
      // A river's pond is at most POND_MAX_CELLS, and keeps LAKE_HOME_CLEAR off the home runway: a bigger basin, or
      // one reaching the field, is cut deeper (its river kept its course through the rim as the basin rose round it),
      // the cut as long as it needs.
      if (r.area >= RIVER_AREA) {
        const cap = search.pondCap(routed, r.pit, POND_MAX_CELLS, byHome);
        if (cap < lw) {
          lw = cap;
          maxCut = Infinity;
          maxLen = n * n;
        }
      }
      let path = search.run(routed, flood.filled, r.pit, lw, maxCut, maxLen);
      // No cut short enough at that level: raise the water in steps until one is (at the spill level none is needed).
      const step = Math.max(2, (r.level - lw) / 6);
      while (!path && lw < r.level - step) {
        lw += step;
        path = search.run(routed, flood.filled, r.pit, lw, allowDepth, allowLength);
      }
      if (!path) {
        settled[r.pit] = r.level;
        continue;
      }
      for (const q of path) if (routed[q] > lw) (routed[q] = lw), (cutWhy[q] = maxCut === Infinity ? 2 : 1);
      settled[r.pit] = lw;
      changed++;
    }
    if (!changed) break;
  }

  // --- Ponds that cannot be lakes (too shallow, too big, by the home field, beyond LAKE_MAX, or with too little
  // water over the detailed ground at the middle) but carry a river are cut out to their bottom, so no river is held
  // up at the level of water that is not drawn. The ponds that can be lakes are handed to `onPonds` first (the
  // detailed terrain smooths its gullies round them), then settled against the detailed ground.
  let lakes: DrainLake[] = [];
  // A pond's settled level and middle, kept from round to round while it stays the same pond.
  const settleCache = new Map<string, { level: number; centre: number }>();
  for (let round = 0; round < 12; round++) {
    flood.run(routed);
    const c = classifyPonds(n, origin, height, routed, flood, rc);
    let cut = c.cut;
    // (The last round settles whatever is left: a river through a pond still to be cut runs at its running minimum.)
    if (!cut.length || round === 11) {
      onPonds?.(c.lakes.map((x) => x.lake.cells));
      const settled = settlePonds(n, origin, routed, c, fine, settleCache);
      lakes = settled.lakes;
      cut = settled.cut;
      if (!cut.length || round === 11) break;
    }
    for (const r of cut) {
      // A basin too big for a lake keeps a pond of POND_MAX_CELLS (its other hollows come up in the next round); the
      // rest are cut to their bottom.
      const level = r.cells.length > POND_MAX_CELLS ? Math.max(routed[r.pit], Math.min(r.level, search.pondCap(routed, r.pit, POND_MAX_CELLS, byHome))) : routed[r.pit];
      const path = search.run(routed, flood.filled, r.pit, level, Infinity, n * n);
      if (path) for (const q of path) if (routed[q] > level) (routed[q] = level), (cutWhy[q] = level > routed[r.pit] ? 2 : 3);
    }
  }
  const filled = flood.filled;
  const receiver = flood.receiver;
  const area = flood.area;

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

  return { n, origin, height, routed, cutWhy, filled, receiver, area, lines, lakes };
}


const DI = [-1, -1, -1, 0, 0, 1, 1, 1];
const DJ = [-1, 0, 1, -1, 1, -1, 0, 1];

/** Priority flood (Barnes et al. 2014) from the sea and the domain's edge, then flow accumulation in reverse order. */
class Flood {
  readonly filled: Float32Array;
  readonly receiver: Int32Array;
  readonly order: Int32Array;
  readonly area: Float32Array;
  private readonly done: Uint8Array;
  private readonly heap: MinHeap;
  constructor(private readonly n: number) {
    const N = n * n;
    this.filled = new Float32Array(N);
    this.receiver = new Int32Array(N);
    this.order = new Int32Array(N);
    this.area = new Float32Array(N);
    this.done = new Uint8Array(N);
    this.heap = new MinHeap(N);
  }
  run(height: Float32Array): void {
    const { n, filled, receiver, order, done, heap, area } = this;
    const N = n * n;
    receiver.fill(-1);
    done.fill(0);
    heap.size = 0;
    let popped = 0;
    for (let c = 0; c < N; c++) {
      const i = Math.floor(c / n);
      const j = c % n;
      if (height[c] <= 0 || i === 0 || j === 0 || i === n - 1 || j === n - 1) {
        filled[c] = height[c];
        done[c] = 1;
        heap.push(c, filled[c]);
      }
    }
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
    // Flow accumulation: upstream cells come later in flood order.
    area.fill((DRAIN_CELL * DRAIN_CELL) / 1e6);
    for (let k = N - 1; k >= 0; k--) {
      const c = order[k];
      const r = receiver[c];
      if (r >= 0) area[r] += area[c];
    }
  }
}

/** A filled hollow of one flood: its cells, its lowest cell, spill level and the catchment draining out of it. */
interface Hollow {
  cells: number[];
  pit: number;
  level: number;
  area: number;
}

/** The connected (8-neighbour) hollows the flood filled at least HOLLOW_TOL deep, by rising spill level. */
function fillRegions(n: number, routed: Float32Array, flood: Flood): Hollow[] {
  const N = n * n;
  const { filled, receiver, area } = flood;
  const label = new Int32Array(N).fill(-1);
  const out: Hollow[] = [];
  const stack: number[] = [];
  const wet = (c: number): boolean => filled[c] - routed[c] > HOLLOW_TOL;
  for (let c = 0; c < N; c++) {
    if (label[c] !== -1 || !wet(c)) continue;
    const id = out.length;
    const cells: number[] = [];
    label[c] = id;
    stack.push(c);
    while (stack.length) {
      const q = stack.pop() as number;
      cells.push(q);
      const i = Math.floor(q / n);
      const j = q % n;
      for (let k = 0; k < 8; k++) {
        const ii = i + DI[k];
        const jj = j + DJ[k];
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const nb = ii * n + jj;
        if (label[nb] !== -1 || !wet(nb)) continue;
        label[nb] = id;
        stack.push(nb);
      }
    }
    let pit = cells[0];
    let level = -Infinity;
    let a = 0;
    for (const q of cells) {
      if (routed[q] < routed[pit] || (routed[q] === routed[pit] && q < pit)) pit = q;
      level = Math.max(level, filled[q]);
      const r = receiver[q];
      if ((r < 0 || label[r] !== id) && area[q] > a) a = area[q];
    }
    out.push({ cells, pit, level, area: a });
  }
  out.sort((x, y) => x.level - y.level || x.pit - y.pit);
  return out;
}

/**
 * Least-cost breach path (Lindsay 2016) out of a hollow: Dijkstra from its pit over the lattice, each cell costing the
 * depth it must be cut below `level` (the water left standing behind the cut), to the first cell whose filled level
 * lies below `level` (water reaching it runs on to an outlet). Cells needing a cut deeper than maxCut are closed, and a
 * path may cut at most maxLen cells. Returns the path's cells (target first), or null.
 */
class BreachSearch {
  private readonly cost: Float64Array;
  private readonly len: Int32Array;
  private readonly prev: Int32Array;
  private readonly stamp: Int32Array;
  private readonly closed: Int32Array;
  private readonly heap: MinHeap;
  private visit = 0;
  constructor(private readonly n: number) {
    const N = n * n;
    this.cost = new Float64Array(N);
    this.len = new Int32Array(N);
    this.prev = new Int32Array(N);
    this.stamp = new Int32Array(N);
    this.closed = new Int32Array(N);
    this.heap = new MinHeap(N);
  }
  run(routed: Float32Array, filled: Float32Array, pit: number, level: number, maxCut: number, maxLen: number): number[] | null {
    const { n, cost, len, prev, stamp, closed, heap } = this;
    const v = ++this.visit;
    heap.size = 0;
    stamp[pit] = v;
    cost[pit] = 0;
    len[pit] = 0;
    prev[pit] = -1;
    heap.push(pit, 0);
    while (heap.size > 0) {
      const c = heap.pop();
      if (closed[c] === v) continue;
      closed[c] = v;
      if (c !== pit && filled[c] < level - 0.05) {
        const path: number[] = [];
        for (let q = c; q >= 0; q = prev[q]) path.push(q);
        return path;
      }
      const i = Math.floor(c / n);
      const j = c % n;
      for (let k = 0; k < 8; k++) {
        const ii = i + DI[k];
        const jj = j + DJ[k];
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const nb = ii * n + jj;
        if (closed[nb] === v) continue;
        const cut = routed[nb] - level;
        if (cut > maxCut) continue;
        const l = len[c] + (cut > BREACH_SHALLOW ? 1 : 0);
        if (l > maxLen) continue;
        // Diagonal steps cut a longer trench.
        const w = cost[c] + Math.max(0, cut) * (k === 0 || k === 2 || k === 5 || k === 7 ? Math.SQRT2 : 1) + 1e-3;
        if (stamp[nb] === v && w >= cost[nb]) continue;
        stamp[nb] = v;
        cost[nb] = w;
        len[nb] = l;
        prev[nb] = c;
        heap.push(nb, w);
      }
    }
    return null;
  }

  /**
   * The highest level water can stand at in the hollow of `pit` and still cover at most maxCells cells, none of them
   * a `stop` cell: the cells in the order the water reaches them as it rises (minimax level from the pit), the level
   * just below the one that would add the next cell. Infinity when the hollow never grows that big (the caller's
   * level stands).
   */
  pondCap(routed: Float32Array, pit: number, maxCells: number, stop: Uint8Array): number {
    const { n, cost, stamp, closed, heap } = this;
    const v = ++this.visit;
    heap.size = 0;
    stamp[pit] = v;
    cost[pit] = routed[pit];
    heap.push(pit, routed[pit]);
    let count = 0;
    while (heap.size > 0) {
      const c = heap.pop();
      if (closed[c] === v) continue;
      closed[c] = v;
      if (++count > maxCells || stop[c]) return cost[c] - 0.01;
      const i = Math.floor(c / n);
      const j = c % n;
      for (let k = 0; k < 8; k++) {
        const ii = i + DI[k];
        const jj = j + DJ[k];
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const nb = ii * n + jj;
        if (closed[nb] === v) continue;
        const w = Math.max(cost[c], routed[nb]);
        if (stamp[nb] === v && w >= cost[nb]) continue;
        stamp[nb] = v;
        cost[nb] = w;
        heap.push(nb, w);
      }
    }
    return Infinity;
  }
}

type PondCandidate = { lake: DrainLake; hollow: Hollow; volume: number };

/**
 * The ponds left after breaching: the ones that may be lakes (every river's first, by volume, then the dry hollows' up
 * to LAKE_MAX), and the ones a river runs through that must be cut out instead (too shallow, too big, by the home
 * field, at the sea). `member` gives each pond cell's index in `regions`.
 */
function classifyPonds(n: number, origin: number, height: Float32Array, routed: Float32Array, flood: Flood, rc: { north: number; east: number }): { lakes: PondCandidate[]; cut: Hollow[]; member: Int32Array } {
  const cut: Hollow[] = [];
  const river: PondCandidate[] = [];
  const dry: PondCandidate[] = [];
  const member = new Int32Array(n * n).fill(-1);
  fillRegions(n, routed, flood).forEach((r, id) => {
    let depth = 0;
    let near = false;
    let sea = false;
    let volume = 0;
    for (const q of r.cells) {
      depth = Math.max(depth, flood.filled[q] - height[q]);
      volume += flood.filled[q] - routed[q];
      if (Math.hypot(origin + Math.floor(q / n) * DRAIN_CELL - rc.north, origin + (q % n) * DRAIN_CELL - rc.east) < LAKE_HOME_CLEAR) near = true;
      if (height[q] <= 0) sea = true;
      member[q] = id;
    }
    const isRiver = r.area >= RIVER_AREA;
    const lake: DrainLake = { cells: r.cells, spill: r.level, level: r.level, depth, area: r.area, river: isRiver, centre: -1 };
    const ok = !near && !sea && depth >= LAKE_DEPTH && !(isRiver && r.cells.length > POND_MAX_CELLS);
    if (isRiver) {
      if (ok) river.push({ lake, hollow: r, volume });
      else {
        cut.push(r);
      }
    } else if (ok && r.cells.length >= LAKE_CELLS && r.cells.length <= LAKE_MAX_CELLS) dry.push({ lake, hollow: r, volume });
  });
  river.sort((a, b) => b.volume - a.volume);
  dry.sort((a, b) => b.volume - a.volume);
  for (const c of river.slice(LAKE_MAX)) cut.push(c.hollow);
  const lakes = river.slice(0, LAKE_MAX);
  lakes.push(...dry.slice(0, LAKE_MAX - lakes.length));
  return { lakes, cut, member };
}

/**
 * The level each candidate's water can stand at: its spill level, or lower where the detailed ground dips under it
 * round the edge LakeMask draws (sampled where the edge crosses the step to each outside neighbour, and just beyond);
 * a lake also needs its water LAKE_MIDDLE_DEPTH over the detailed ground at its middle (of its deepest few cells, the
 * one where that ground lies lowest). A river's pond that fails is returned to be cut out; a dry one is dropped.
 */
function settlePonds(n: number, origin: number, routed: Float32Array, c: { lakes: PondCandidate[]; member: Int32Array }, fine: (north: number, east: number) => number, cache: Map<string, { level: number; centre: number }>): { lakes: DrainLake[]; cut: Hollow[] } {
  const lakes: DrainLake[] = [];
  const cut: Hollow[] = [];
  for (const { lake: l, hollow: r } of c.lakes) {
    const key = `${r.pit}|${l.spill}|${r.cells.length}`;
    const known = cache.get(key);
    if (known) {
      if (known.centre < 0) {
        if (l.river) cut.push(r);
        continue;
      }
      l.level = known.level;
      l.centre = known.centre;
      lakes.push(l);
      continue;
    }
    const id = c.member[r.cells[0]];
    let edge = Infinity;
    // LakeMask's field for this lake.
    const corner = (q: number): number => (c.member[q] === id ? l.spill - routed[q] + LAKE_SHORE_MARGIN : routed[q] >= l.spill - 0.01 ? -2 : -60);
    const field = (pn: number, pe: number): number => {
      const x = (pe - origin) / DRAIN_CELL;
      const y = (pn - origin) / DRAIN_CELL;
      const j = Math.min(n - 2, Math.max(0, Math.floor(x)));
      const i = Math.min(n - 2, Math.max(0, Math.floor(y)));
      const fx = x - j;
      const fy = y - i;
      const c0 = i * n + j;
      return (1 - fx) * (1 - fy) * corner(c0) + fx * (1 - fy) * corner(c0 + 1) + (1 - fx) * fy * corner(c0 + n) + fx * fy * corner(c0 + n + 1);
    };
    for (const q of r.cells) {
      const i = Math.floor(q / n);
      const j = q % n;
      const dq = l.spill - routed[q] + LAKE_SHORE_MARGIN;
      const qn = origin + i * DRAIN_CELL;
      const qe = origin + j * DRAIN_CELL;
      for (let k = 0; k < 8; k++) {
        const ii = i + DI[k];
        const jj = j + DJ[k];
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const nb = ii * n + jj;
        if (c.member[nb] === id) continue;
        const dn = routed[nb] >= l.spill - 0.01 ? -2 : -60;
        const t = dq / (dq - dn);
        // On the edge, a little beyond it, and along it to either side (the edge bends between the lattice lines).
        const len = Math.hypot(DI[k], DJ[k]);
        const pn = (-DJ[k] / len) * 0.3 * DRAIN_CELL;
        const pe = (DI[k] / len) * 0.3 * DRAIN_CELL;
        const en = qn + t * DI[k] * DRAIN_CELL;
        const ee = qe + t * DJ[k] * DRAIN_CELL;
        // The lateral samples only where they lie on the edge (the edge may bend away from them, into the lake).
        const pts: Array<[number, number, boolean]> = [[en, ee, true], [en + 0.12 * DI[k] * DRAIN_CELL, ee + 0.12 * DJ[k] * DRAIN_CELL, true], [en + pn, ee + pe, false], [en - pn, ee - pe, false]];
        for (const f of EDGE_LATERAL) pts.push([en + f * pn, ee + f * pe, false], [en - f * pn, ee - f * pe, false]);
        for (const [a, b, always] of pts) {
          if (!always) {
            const f = field(a, b);
            if (f < -1 || f > 1) continue;
          }
          const g = fine(a, b);
          if (g < edge) {
            edge = g;
          }
        }
      }
    }
    l.level = Math.min(l.spill, edge - 1);
    const deepest = r.cells.slice().sort((a, b) => routed[a] - routed[b] || a - b).slice(0, 6);
    let best = Infinity;
    for (const q of deepest) {
      const g = fine(origin + Math.floor(q / n) * DRAIN_CELL, origin + (q % n) * DRAIN_CELL);
      if (g < best) {
        best = g;
        l.centre = q;
      }
    }
    const ok = best <= l.level - LAKE_MIDDLE_DEPTH;
    cache.set(key, { level: l.level, centre: ok ? l.centre : -1 });
    if (ok) lakes.push(l);
    else if (l.river) {
      cut.push(r);
    }
  }
  return { lakes, cut };
}

/**
 * The detailed terrain's gullies smoothed out round a seeded world's lakes (heightfield.ts applies it to the gully
 * filter): 1 over each pond and the cells round it, falling to 0 a cell or two beyond, as a cubic B-spline over the
 * lattice (C2 smooth: no crease at a lattice line), faded out by the home field. A lake basin's floor and shore are
 * sediment and wave-cut, not the noise's gullies; and a gully through the rim the lattice cannot see would drain the
 * lake or leave its water standing against nothing.
 */
export class ShoreSmooth {
  private readonly m: Uint8Array;
  private readonly sq: Uint8Array;
  constructor(private readonly n: number, private readonly origin: number, ponds: number[][], private readonly home: { north: number; east: number }) {
    const N = n * n;
    this.m = new Uint8Array(N);
    for (const cells of ponds) {
      for (const q of cells) {
        const i = Math.floor(q / n);
        const j = q % n;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (i + a >= 0 && j + b >= 0 && i + a < n && j + b < n) this.m[(i + a) * n + j + b] = 1;
      }
    }
    // Squares whose B-spline support (the 4 x 4 cells round them) touches the smoothed cells.
    this.sq = new Uint8Array(N);
    for (let c = 0; c < N; c++) {
      if (!this.m[c]) continue;
      const i = Math.floor(c / n);
      const j = c % n;
      for (let a = -2; a <= 1; a++) for (let b = -2; b <= 1; b++) if (i + a >= 0 && j + b >= 0 && i + a < n && j + b < n) this.sq[(i + a) * n + j + b] = 1;
    }
  }
  /** How far the gullies are smoothed out at (north, east), [0, 1]. */
  at(north: number, east: number): number {
    const { n, m } = this;
    const x = (east - this.origin) / DRAIN_CELL;
    const y = (north - this.origin) / DRAIN_CELL;
    const j = Math.floor(x);
    const i = Math.floor(y);
    if (i < 1 || j < 1 || i >= n - 2 || j >= n - 2 || !this.sq[i * n + j]) return 0;
    const tx = x - j;
    const ty = y - i;
    let v = 0;
    for (let a = 0; a < 4; a++) {
      const wy = bspline(a, ty);
      const row = (i - 1 + a) * n + j - 1;
      v += wy * (bspline(0, tx) * m[row] + bspline(1, tx) * m[row + 1] + bspline(2, tx) * m[row + 2] + bspline(3, tx) * m[row + 3]);
    }
    if (v <= 0.03) return 0;
    const r = Math.hypot(north - this.home.north, east - this.home.east);
    return smoothstep(0.03, 0.45, v) * smoothstep(SHORE_HOME_CLEAR[0], SHORE_HOME_CLEAR[1], r);
  }
}
/** The shore smoothing fades in between these distances from the home runway, m (its circuit and the start of its
 * approaches keep the ground the site search saw). */
const SHORE_HOME_CLEAR = [4500, 6000];
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
/** Uniform cubic B-spline basis k (0-3) at t in [0, 1]. */
function bspline(k: number, t: number): number {
  const u = 1 - t;
  if (k === 0) return (u * u * u) / 6;
  if (k === 1) return (3 * t * t * t - 6 * t * t + 4) / 6;
  if (k === 2) return (-3 * t * t * t + 3 * t * t + 3 * t + 1) / 6;
  return (t * t * t) / 6;
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

/**
 * Where a seeded world's lakes stand: a lake's water covers the ground below its level within the lattice cells of
 * its pond, out to its rim. A smooth field over the lattice, positive inside: a pond cell counts its depth plus
 * LAKE_SHORE_MARGIN, a rim cell (routed terrain at or over the level) a little below zero, so the edge lies just short
 * of the rim cells where the ground stands over the water; a cell lower than the level outside the pond (the outflow,
 * beyond the spill or the breach) strongly negative, so no sheet of water hangs over the ground falling away there.
 */
export class LakeMask {
  private readonly id: Int16Array;
  private readonly levels: Float64Array;
  private readonly spills: Float32Array;
  /** The field at the last point `at` found in a lake (0 elsewhere): how far inside its edge the point lies. */
  field = 0;
  constructor(private readonly d: Drainage) {
    this.id = new Int16Array(d.n * d.n).fill(-1);
    d.lakes.forEach((l, k) => {
      for (const c of l.cells) this.id[c] = k;
    });
    this.levels = Float64Array.from(d.lakes, (l) => l.level);
    this.spills = Float32Array.from(d.lakes, (l) => l.spill);
    // The cells guard() holds: each lake's cells and the ring round them (its shore and rim), the higher lake's where
    // two meet; and the squares whose B-spline support (the 4 x 4 cells round them) holds one.
    const n = d.n;
    this.gid = new Int16Array(n * n).fill(-1);
    d.lakes.forEach((l, k) => {
      for (const c of l.cells) {
        const i = Math.floor(c / n);
        const j = c % n;
        for (let a = -1; a <= 1; a++) {
          for (let b = -1; b <= 1; b++) {
            if (i + a < 0 || j + b < 0 || i + a >= n || j + b >= n) continue;
            const q = (i + a) * n + j + b;
            const g = this.gid[q];
            if (g < 0 || this.levels[g] < l.level) this.gid[q] = k;
          }
        }
      }
    });
    this.sq = new Uint8Array(n * n);
    for (let c = 0; c < n * n; c++) {
      if (this.gid[c] < 0) continue;
      const i = Math.floor(c / n);
      const j = c % n;
      for (let a = -2; a <= 1; a++) for (let b = -2; b <= 1; b++) if (i + a >= 0 && j + b >= 0 && i + a < n && j + b < n) this.sq[(i + a) * n + j + b] = 1;
    }
  }
  private readonly sq: Uint8Array;
  private readonly gid: Int16Array;
  /** The level of the lake guard() last found (-Infinity: none). */
  guardLevel = -Infinity;
  /**
   * How firmly the ground round a lake is kept over its water at (north, east), [0, 1]: 1 over the lake and its shore,
   * falling to 0 a cell or so beyond (a cubic B-spline of the lake's cells and the ring round them: C2 smooth). A valley carved past a lake
   * (a gorge running by it) keeps its walls over the lake's level there, or the lake would stand against nothing at
   * the edge of its mask. Leaves the lake's level in guardLevel.
   */
  guard(north: number, east: number): number {
    const { d, gid } = this;
    const n = d.n;
    this.guardLevel = -Infinity;
    const x = (east - d.origin) / DRAIN_CELL;
    const y = (north - d.origin) / DRAIN_CELL;
    const j = Math.floor(x);
    const i = Math.floor(y);
    if (i < 1 || j < 1 || i >= n - 2 || j >= n - 2 || !this.sq[i * n + j]) return 0;
    const tx = x - j;
    const ty = y - i;
    // The weight of each lake among the 16 cells (rarely more than one).
    let k0 = -1;
    let v0 = 0;
    let k1 = -1;
    let v1 = 0;
    for (let a = 0; a < 4; a++) {
      const wy = bspline(a, ty);
      for (let b = 0; b < 4; b++) {
        const k = gid[(i - 1 + a) * n + j - 1 + b];
        if (k < 0) continue;
        const w = wy * bspline(b, tx);
        if (k === k0 || k0 < 0) (k0 = k), (v0 += w);
        else if (k === k1 || k1 < 0) (k1 = k), (v1 += w);
      }
    }
    if (v1 > v0) (k0 = k1), (v0 = v1);
    if (k0 < 0 || v0 <= 0.02) return 0;
    this.guardLevel = this.levels[k0];
    return smoothstep(0.02, 0.45, v0);
  }
  /** The level of the lake standing over (north, east), m, or -Infinity. */
  at(north: number, east: number): number {
    const { d, id } = this;
    this.field = 0;
    const x = (east - d.origin) / DRAIN_CELL;
    const y = (north - d.origin) / DRAIN_CELL;
    const j = Math.floor(x);
    const i = Math.floor(y);
    if (i < 0 || j < 0 || i >= d.n - 1 || j >= d.n - 1) return -Infinity;
    const c00 = i * d.n + j;
    const c01 = c00 + 1;
    const c10 = c00 + d.n;
    const c11 = c10 + 1;
    const k00 = id[c00];
    const k01 = id[c01];
    const k10 = id[c10];
    const k11 = id[c11];
    if (k00 < 0 && k01 < 0 && k10 < 0 && k11 < 0) return -Infinity;
    const fx = x - j;
    const fy = y - i;
    const w00 = (1 - fx) * (1 - fy);
    const w01 = fx * (1 - fy);
    const w10 = (1 - fx) * fy;
    const w11 = fx * fy;
    // The lake of the nearest member corner.
    let k = -1;
    let wk = -1;
    if (k00 >= 0 && w00 > wk) (k = k00), (wk = w00);
    if (k01 >= 0 && w01 > wk) (k = k01), (wk = w01);
    if (k10 >= 0 && w10 > wk) (k = k10), (wk = w10);
    if (k11 >= 0 && w11 > wk) (k = k11), (wk = w11);
    const L = this.spills[k];
    const f = w00 * this.corner(c00, k00, k, L) + w01 * this.corner(c01, k01, k, L) + w10 * this.corner(c10, k10, k, L) + w11 * this.corner(c11, k11, k, L);
    if (f <= 0) return -Infinity;
    this.field = f;
    return this.levels[k];
  }
  private corner(c: number, kc: number, k: number, L: number): number {
    const r = this.d.routed[c];
    if (kc === k) return L - r + LAKE_SHORE_MARGIN;
    return r >= L - 0.01 ? -2 : -60;
  }
}
/** Further lateral samples along a lake's edge in settlePonds, as fractions of the first (0.3 cell). */
const EDGE_LATERAL = [0.5, 1.5];
/** See LakeMask, m. */
const LAKE_SHORE_MARGIN = 20;
