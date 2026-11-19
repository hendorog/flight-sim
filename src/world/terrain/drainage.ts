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
/**
 * The tarns: in the high country (its spill at least TARN_SPILL, m) a closed hollow of a single lattice cell, as deep
 * as a lake, holds water too - a small mountain lake in its own basin, flooded to its natural spill level with its
 * natural shore (LakeMask, like any lake). Some 40-50 hollows per world qualify (seeds 1, 42, 777777), some of them too
 * shallow over the detailed ground at the middle to stand (settlePonds). The hollows the round-2 streams filled (150-285
 * a world, shores raised) are gone: a stream meeting a smaller hollow ends in it.
 */
const TARN_SPILL = 1200;
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
/** The deepest cut, m, the water of a catchment of `area` km² keeps through a rim (BREACH_DEPTH sqrt(A)): the drainage's
 * breach rule, and the streams' (streams.ts trace: a hollow deeper than this holds a pond behind it). */
export const breachAllowance = (area: number): number => BREACH_DEPTH * Math.sqrt(Math.max(0, area));
const BREACH_LENGTH = 3;
const BREACH_LENGTH_AREA = 0.2;
/** A lake's water stands at least this far over the detailed ground at its middle, m. */
export const LAKE_MIDDLE_DEPTH = 4;
/** Largest pond a river may stand in, lattice cells (km²). */
const POND_MAX_CELLS = 120;
/** A cut no deeper than this, m, does not count toward a breach's length (a river entrenches that much anywhere: a
 * lowland hollow's rim may need a long, shallow cut to reach lower ground). */
const BREACH_SHALLOW = 10;
/** Breach-and-fill passes (each settles the hollows the last one's cuts and ponds left). */
const BREACH_PASSES = 6;
/** A hollow is filled at least this deep, m, before it counts as one. */
export const HOLLOW_TOL = 0.5;
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
  /** A tarn (TARN_SPILL): a one-cell hollow in the high country; the gullies round it are not smoothed (ShoreSmooth). */
  tarn?: boolean;
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
 * `natural` already sampled at the lattice's cells (erosion.ts), and saves sampling it again. `routing`, when given, is
 * the same cells as the model routed them (erosion.ts ErosionField.routing): the water is routed over those (below).
 */
export function buildDrainage(natural: (north: number, east: number) => number, fine: (north: number, east: number) => number = natural, onPonds?: (ponds: number[][]) => void, lattice?: Float32Array, routing?: Float32Array): Drainage {
  const n = Math.round((2 * DOMAIN_HALF) / DRAIN_CELL) + 1;
  const origin = -DOMAIN_HALF;
  const N = n * n;
  const height = new Float32Array(N);
  const rc = AIRPORT.runway.center;
  // (The mound over the home field, at cell c.)
  const moundAt = (c: number): number => {
    const r = Math.hypot(origin + Math.floor(c / n) * DRAIN_CELL - rc.north, origin + (c % n) * DRAIN_CELL - rc.east);
    return r < HOME_RADIUS ? HOME_MOUND * (1 - r / HOME_RADIUS) : 0;
  };
  for (let i = 0; i < n; i++) {
    const north = origin + i * DRAIN_CELL;
    for (let j = 0; j < n; j++) {
      const east = origin + j * DRAIN_CELL;
      height[i * n + j] = (lattice ? lattice[i * n + j] : natural(north, east)) + moundAt(i * n + j);
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
  // The set of ponds onPonds last heard.
  let heard = '';
  for (let round = 0; round < 12; round++) {
    flood.run(routed);
    const c = classifyPonds(n, origin, height, routed, flood, rc);
    let cut = c.cut;
    // (The last round settles whatever is left: a river through a pond still to be cut runs at its running minimum.)
    if (!cut.length || round === 11) {
      // The detailed ground round the ponds changes with them (the shore smoothing): levels settled against the last
      // set of ponds' ground are stale once the set changes.
      // (Not round a tarn: its basin is a small one in rugged country, and the edge it is settled against is the
      // detailed ground's as it lies.)
      const ponds = c.lakes.filter((x) => !x.lake.tarn).map((x) => x.lake.cells);
      const sig = pondSignature(ponds);
      if (sig !== heard) {
        onPonds?.(ponds);
        settleCache.clear();
        heard = sig;
      }
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
  // The shore smoothing round the lakes that stand only (not round the ponds that were cut out or dropped: a smoothed
  // bowl with no water in it).
  const final = lakes.filter((l) => !l.tarn).map((l) => l.cells);
  if (pondSignature(final) !== heard) onPonds?.(final);
  // The water's courses. The lakes and the cuts stand as settled above, on the lattice as drawn; the water is routed
  // over the model's cells as the model routed them (`routing`: the drawn lattice is those with a drawing fix, erosion.ts
  // buildErosion), with the same mound, the cuts and the lakes' water: so every river runs down the channel the model
  // carved, and through the lakes and their outlets.
  let flow = flood;
  if (routing) {
    const r2 = new Float32Array(N);
    for (let c = 0; c < N; c++) r2[c] = cutWhy[c] ? Math.min(routing[c] + moundAt(c), routed[c]) : routing[c] + moundAt(c);
    for (const l of lakes) for (const c of l.cells) r2[c] = Math.min(r2[c], Math.max(routed[c], l.level));
    flow = new Flood(n);
    flow.run(r2);
  }
  const filled = flow.filled;
  const receiver = flow.receiver;
  const area = flow.area;

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


/** A key for a set of ponds (FNV-1a over their cells). */
function pondSignature(ponds: number[][]): string {
  let h = 0x811c9dc5;
  for (const cells of ponds) {
    h = Math.imul(h ^ cells.length, 0x01000193);
    for (const c of cells) h = Math.imul(h ^ c, 0x01000193);
  }
  return `${ponds.length}:${h >>> 0}`;
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
    // Steepest descent on the filled surface for the cells standing on it (a cell inside a filled hollow keeps the
    // flood's receiver, toward the spill): the routing the macro model's ground was built with (erosion.ts
    // SteadyRouter), so the rivers run down its valleys. A receiver stands strictly lower on the filled surface, so
    // the flood order stays downstream first.
    for (let c = 0; c < N; c++) {
      if (receiver[c] < 0 || filled[c] > height[c]) continue;
      const i = Math.floor(c / n);
      const j = c % n;
      let best = -1;
      let bs = 0;
      for (let k = 0; k < 8; k++) {
        const ii = i + DI[k];
        const jj = j + DJ[k];
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const nb = ii * n + jj;
        const d = filled[c] - filled[nb];
        if (d <= 0) continue;
        const s = DI[k] !== 0 && DJ[k] !== 0 ? d / Math.SQRT2 : d;
        if (s > bs) {
          bs = s;
          best = nb;
        }
      }
      if (best >= 0) receiver[c] = best;
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
    else if (ok && r.cells.length === 1 && r.level >= TARN_SPILL) {
      lake.tarn = true;
      dry.push({ lake, hollow: r, volume });
    }
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
export class MinHeap {
  private ids: Int32Array;
  private keys: Float64Array;
  size = 0;
  constructor(cap: number) {
    this.ids = new Int32Array(cap);
    this.keys = new Float64Array(cap);
  }
  get capacity(): number {
    return this.ids.length;
  }
  /** Room for `cap` entries (empties the heap). */
  grow(cap: number): void {
    this.ids = new Int32Array(cap);
    this.keys = new Float64Array(cap);
    this.size = 0;
  }
  /** The key of the entry pop() returns next. */
  topKey(): number {
    return this.keys[0];
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

/** LakeMask's field at a raster corner for pool `id` whose domain's edge stands at `top`: how far the corner's ground lies
 * below it (outside the pool, never above 0). */
function cornerField(R: PondRaster, p: number, id: number, top: number): number {
  const g = R.ground[p];
  if (g !== g) return -LAKE_MARGIN;
  return R.pool[p] === id ? top - g : Math.min(0, top - g);
}

/** Spacing of the raster the lakes are flooded on, m (a quarter of a lattice cell), and the raster's size a side. */
export const LAKE_RASTER = 250;
export const RASTER_N = Math.round((2 * DOMAIN_HALF) / LAKE_RASTER) + 1;
const RASTER_PER_CELL = DRAIN_CELL / LAKE_RASTER;
/**
 * A lake's water is drawn over the raster points connected to its pit whose ground lies below its level plus this
 * margin, m: every raster point beside that domain stands this much over the water, so the domain's edge (along the
 * raster lines) lies over dry ground (the ground the flood sees is smooth at the raster's scale: see LakeMask).
 */
export const LAKE_MARGIN = 3;
/** The small-scale relief is smoothed out over a lake's domain and this many raster points round it (then fades out
 * over the cubic B-spline's reach, two more). */
const SMOOTH_RING = 2;
/** Raster points round a pond's region in its box: the flood's step out of it, the smoothed ring and the B-spline. */
const BOX_PAD = 1 + SMOOTH_RING + 2;
/** Most pools one pond's cells may hold (sub-basins the lattice saw as one pond, each at its own level). */
const POOLS_PER_LAKE = 6;

/** One body of standing water on the raster: its level, its pond (index into Drainage.lakes) and its wet points. */
export interface LakePool {
  lake: number;
  level: number;
  /** Lowest ground under it, m; and its wet raster points' count, centroid (m) and second moments about it (m²). */
  bottom: number;
  wet: number;
  north: number;
  east: number;
  snn: number;
  see: number;
  sne: number;
  /** Its middle: the raster point nearest the centroid with at least LAKE_CENTRE_DEPTH of water over it, m. */
  centreNorth: number;
  centreEast: number;
  /** Taken away by drainPond: no water drawn. */
  drained?: boolean;
  /**
   * Where the flood that drew it stopped (global raster index ri * RASTER_N + rj, -1: none): the lowest raster point
   * round its domain, over which its water would spill (its outlet sill; on the sea, another pond's water, the home
   * field's clearance or the edge of what the pond may cover). streams.ts starts its outlet stream there.
   */
  spill: number;
}
/** A lake's middle has at least this much water over it, m. */
const LAKE_CENTRE_DEPTH = 3;

/** One pond's raster: a box of raster points round its cells and their ring, with each point's ground and pool. */
interface PondRaster {
  /** Raster index of the box's first point and its size, points. */
  gi: number;
  gj: number;
  rows: number;
  cols: number;
  /** Ground per point (NaN: not sampled), the pool holding it (-1: none) and whether its relief is smoothed out. */
  ground: Float32Array;
  pool: Int16Array;
  soft: Uint8Array;
  /** The pool whose shore a point holds (a pool's points and the ring round them; -1: none). */
  shore: Int16Array;
  /** The pool whose smoothing reaches a point (where soft is set; the higher pool's where two meet). */
  softPool: Int16Array;
}

/**
 * Where a seeded world's lakes stand. Each pond the drainage keeps is flooded on a 250 m raster of the ground without
 * its small-scale relief (`ground`: the hills, mountains and erosion cut, smooth at the raster's scale) from its lowest
 * point (Barnes-style priority flood): the flood rises until it would spill out of the pond's cells and the ring round
 * them (or reach another lake, the sea or the home field's clearance), and the water stands LAKE_MARGIN below that
 * spill, never above the pond's settled level. The water covers the raster points connected to the pit whose ground
 * lies below level + LAKE_MARGIN, and between them the ground below the level: the shoreline is wherever the ground
 * crosses the level (the terrain hides the flat water above it), and the domain's edge runs over ground at least
 * LAKE_MARGIN above the water. Over the domain and a ring round it the terrain leaves out its small-scale relief
 * (`smooth`, heightfield.ts): a lake's bed and shore are sediment and wave-cut, and a bump or dip finer than the raster
 * would otherwise put dry ground under the water or leave it standing against nothing at the domain's edge. A
 * sub-basin of the pond its main pool does not reach (behind a rim above the level) is flooded the same way as a pool
 * of its own, at its own level.
 */
export class LakeMask {
  /** The field at the last point `at` found in a lake (0 elsewhere): how far (m) the ground interpolated between the
   * raster points lies below the domain's edge (level + LAKE_MARGIN) there. */
  field = 0;
  readonly pools: LakePool[] = [];
  /** The ponds left dry because their water would stand against lower ground beside it (probes). */
  readonly leaky: number[] = [];
  /** Each pond's main pool (its largest), -1 where the flood left no water deep enough for a lake. */
  readonly main: Int32Array;
  private readonly rasters: PondRaster[] = [];
  /** Per lattice square: the ponds whose water reaches it (CSR). */
  private sqStart: Int32Array;
  private sqPond: Int16Array;
  constructor(private readonly d: Drainage, ground: (north: number, east: number) => number) {
    /** A raster's ground at (row, col), sampled where the flood did not. */
    const groundOf = (R: PondRaster, i: number, j: number): number => {
      const p = i * R.cols + j;
      let g = R.ground[p];
      if (g !== g) R.ground[p] = g = ground(d.origin + (R.gi + i) * LAKE_RASTER, d.origin + (R.gj + j) * LAKE_RASTER);
      return g;
    };
    const n = d.n;
    const rc = AIRPORT.runway.center;
    const pondOf = new Int16Array(n * n).fill(-1);
    d.lakes.forEach((l, k) => {
      for (const c of l.cells) pondOf[c] = k;
    });
    // Raster points already holding a pool (any pond's), for the floods of the ponds after it.
    const claimed = new Map<number, number>();
    const origin = d.origin;
    this.main = new Int32Array(d.lakes.length).fill(-1);
    const heap = new MinHeap(1);
    d.lakes.forEach((l, k) => {
      let i0 = n;
      let i1 = 0;
      let j0 = n;
      let j1 = 0;
      for (const c of l.cells) {
        const i = Math.floor(c / n);
        const j = c % n;
        i0 = Math.min(i0, i);
        i1 = Math.max(i1, i);
        j0 = Math.min(j0, j);
        j1 = Math.max(j1, j);
      }
      // The box: the pond's cells and the ring round them (each lattice node owns the raster points nearest it), and
      // BOX_PAD more raster points.
      const gi = Math.max(0, (i0 - 1) * RASTER_PER_CELL - RASTER_PER_CELL / 2 - BOX_PAD);
      const gj = Math.max(0, (j0 - 1) * RASTER_PER_CELL - RASTER_PER_CELL / 2 - BOX_PAD);
      const rows = Math.min(RASTER_N - 1, (i1 + 1) * RASTER_PER_CELL + RASTER_PER_CELL / 2 + BOX_PAD) - gi + 1;
      const cols = Math.min(RASTER_N - 1, (j1 + 1) * RASTER_PER_CELL + RASTER_PER_CELL / 2 + BOX_PAD) - gj + 1;
      const R: PondRaster = { gi, gj, rows, cols, ground: new Float32Array(rows * cols).fill(NaN), pool: new Int16Array(rows * cols).fill(-1), soft: new Uint8Array(rows * cols), shore: new Int16Array(rows * cols).fill(-1), softPool: new Int16Array(rows * cols).fill(-1) };
      this.rasters.push(R);
      const size = rows * cols;
      if (heap.capacity < size) heap.grow(size);
      const seen = new Uint8Array(size);
      const groundAt = (p: number): number => {
        let g = R.ground[p];
        if (Number.isNaN(g)) {
          g = ground(origin + (gi + Math.floor(p / cols)) * LAKE_RASTER, origin + (gj + (p % cols)) * LAKE_RASTER);
          R.ground[p] = g;
        }
        return g;
      };
      // Whether the water may stand at a raster point: in the pond's cells or the ring round them (not another
      // pond's), clear of the home field and the sea and not in another pond's pool.
      const inside = (p: number): boolean => {
        const ri = gi + Math.floor(p / cols);
        const rj = gj + (p % cols);
        const ci = Math.round(ri / RASTER_PER_CELL);
        const cj = Math.round(rj / RASTER_PER_CELL);
        if (ci < 1 || cj < 1 || ci >= n - 1 || cj >= n - 1) return false;
        const c = ci * n + cj;
        if (Math.hypot(origin + ri * LAKE_RASTER - rc.north, origin + rj * LAKE_RASTER - rc.east) < LAKE_HOME_CLEAR) return false;
        if (pondOf[c] === k) return R.pool[p] < 0;
        if (pondOf[c] >= 0) return false;
        let ring = false;
        for (let a = 0; a < 8 && !ring; a++) ring = pondOf[c + DI[a] * n + DJ[a]] === k;
        // (A ring cell may be another pond's ring too: its pools may have claimed the point.)
        return ring && R.pool[p] < 0 && !claimed.has(ri * RASTER_N + rj);
      };
      const tried = new Uint8Array(size);
      const ownPools: number[] = [];
      // A pool from one seed point: the flood's popped points (in order) and the spill level.
      const flood = (seed: number): void => {
        seen.fill(0);
        heap.size = 0;
        const popped: number[] = [];
        seen[seed] = 1;
        heap.push(seed, groundAt(seed));
        let running = -Infinity;
        let spill = Infinity;
        let spillAt = -1;
        while (heap.size > 0) {
          const key = heap.topKey();
          const p = heap.pop();
          if (!inside(p) || key <= 0) {
            spill = Math.max(running, key);
            spillAt = p;
            break;
          }
          running = Math.max(running, key);
          // Above the pond's settled level and the margin: the water stands at that level.
          if (running >= l.level + LAKE_MARGIN) {
            spill = running;
            spillAt = p;
            break;
          }
          popped.push(p);
          const pi = Math.floor(p / cols);
          const pj = p % cols;
          for (let a = 0; a < 8; a++) {
            const qi = pi + DI[a];
            const qj = pj + DJ[a];
            if (qi < 0 || qj < 0 || qi >= rows || qj >= cols) continue;
            const q = qi * cols + qj;
            if (seen[q]) continue;
            seen[q] = 1;
            heap.push(q, groundAt(q));
          }
        }
        for (const p of popped) tried[p] = 1;
        if (spill === Infinity) spill = running;
        const level = Math.min(l.level, spill - LAKE_MARGIN);
        // The domain: the popped points connected to the seed below level + margin.
        const top = level + LAKE_MARGIN;
        // (seen: 2 popped, 3 in the domain.)
        for (const p of popped) seen[p] = 2;
        if (seen[seed] !== 2 || !(R.ground[seed] < top)) return;
        const dom: number[] = [seed];
        seen[seed] = 3;
        for (let h = 0; h < dom.length; h++) {
          const p = dom[h];
          const pi = Math.floor(p / cols);
          const pj = p % cols;
          for (let a = 0; a < 8; a++) {
            const qi = pi + DI[a];
            const qj = pj + DJ[a];
            if (qi < 0 || qj < 0 || qi >= rows || qj >= cols) continue;
            const q = qi * cols + qj;
            if (seen[q] !== 2 || !(R.ground[q] < top)) continue;
            seen[q] = 3;
            dom.push(q);
          }
        }
        let bottom = Infinity;
        let wet = 0;
        let sn = 0;
        let se = 0;
        for (const p of dom) {
          const g = R.ground[p];
          bottom = Math.min(bottom, g);
          if (g >= level) continue;
          wet++;
          sn += origin + (gi + Math.floor(p / cols)) * LAKE_RASTER;
          se += origin + (gj + (p % cols)) * LAKE_RASTER;
        }
        // Too shallow (or too small) for a lake: no water.
        if (level - bottom < LAKE_MIDDLE_DEPTH || wet < 2) return;
        sn /= wet;
        se /= wet;
        let snn = 0;
        let see = 0;
        let sne = 0;
        let cn = sn;
        let ce = se;
        let cd = Infinity;
        for (const p of dom) {
          if (R.ground[p] >= level) continue;
          const dn = origin + (gi + Math.floor(p / cols)) * LAKE_RASTER - sn;
          const de = origin + (gj + (p % cols)) * LAKE_RASTER - se;
          snn += dn * dn;
          see += de * de;
          sne += dn * de;
          if (R.ground[p] <= level - LAKE_CENTRE_DEPTH && dn * dn + de * de < cd) {
            cd = dn * dn + de * de;
            cn = sn + dn;
            ce = se + de;
          }
        }
        const id = this.pools.length;
        const spillPoint = spillAt < 0 ? -1 : (gi + Math.floor(spillAt / cols)) * RASTER_N + gj + (spillAt % cols);
        this.pools.push({ lake: k, level, bottom, wet, north: sn, east: se, snn: snn / wet, see: see / wet, sne: sne / wet, centreNorth: cn, centreEast: ce, spill: spillPoint });
        ownPools.push(id);
        for (const p of dom) {
          R.pool[p] = id;
          claimed.set((gi + Math.floor(p / cols)) * RASTER_N + gj + (p % cols), id);
        }
      };
      // The main pool from the pond's middle, then any sub-basin its water did not reach: the pond's deepest cells
      // first, each from its lowest raster point.
      const cells = l.cells.slice().sort((a, b) => d.routed[a] - d.routed[b] || a - b);
      const nodePoint = (c: number): number => (Math.floor(c / n) * RASTER_PER_CELL - gi) * cols + (c % n) * RASTER_PER_CELL - gj;
      const lowest = (c: number): number => {
        // The lowest raster point the cell owns (its node and the points round it within half a cell).
        const p0 = nodePoint(c);
        let best = p0;
        const h = RASTER_PER_CELL / 2;
        for (let a = -h + 1; a < h; a++) {
          for (let b = -h + 1; b < h; b++) {
            const q = p0 + a * cols + b;
            if (groundAt(q) < groundAt(best)) best = q;
          }
        }
        return best;
      };
      const centre = l.centre >= 0 ? l.centre : cells[0];
      flood(lowest(centre));
      for (const c of cells) {
        if (ownPools.length >= POOLS_PER_LAKE) break;
        const p = nodePoint(c);
        if (tried[p] || R.pool[p] >= 0) continue;
        if (!(groundAt(p) < l.level - LAKE_MIDDLE_DEPTH)) continue;
        const q = lowest(c);
        if (tried[q] || R.pool[q] >= 0) continue;
        flood(q);
      }
      let best = -1;
      for (const id of ownPools) if (best < 0 || this.pools[id].wet > this.pools[best].wet) best = id;
      this.main[k] = best;
      // The smoothed ground: the pools and SMOOTH_RING raster points round them; the shore: the pools and the ring of
      // points round them (the higher pool's where two meet).
      for (let p = 0; p < size; p++) {
        const id = R.pool[p];
        if (id < 0) continue;
        const pi = Math.floor(p / cols);
        const pj = p % cols;
        for (let a = -1; a <= 1; a++) {
          for (let b = -1; b <= 1; b++) {
            const q = (pi + a) * cols + pj + b;
            const o = R.shore[q];
            if (o < 0 || this.pools[o].level < this.pools[id].level) R.shore[q] = id;
          }
        }
        for (let a = -SMOOTH_RING; a <= SMOOTH_RING; a++) {
          for (let b = -SMOOTH_RING; b <= SMOOTH_RING; b++) {
            const qi = pi + a;
            const qj = pj + b;
            if (qi < 0 || qj < 0 || qi >= rows || qj >= cols) continue;
            const q = qi * cols + qj;
            R.soft[q] = 1;
            const o = R.softPool[q];
            if (o < 0 || this.pools[o].level < this.pools[id].level) R.softPool[q] = id;
          }
        }
      }
    });
    // Which ponds' rasters reach each lattice square (a raster square within the B-spline's reach of a smoothed
    // point: every square with a corner in a pool among them).
    const N = n * n;
    const lists: number[][] = [];
    const sqOf = new Int32Array(N).fill(-1);
    this.rasters.forEach((R, k) => {
      for (let p = 0; p < R.soft.length; p++) {
        if (!R.soft[p]) continue;
        const ri = R.gi + Math.floor(p / R.cols);
        const rj = R.gj + (p % R.cols);
        for (let a = -2; a <= 1; a++) {
          for (let b = -2; b <= 1; b++) {
            const si = Math.floor((ri + a) / RASTER_PER_CELL);
            const sj = Math.floor((rj + b) / RASTER_PER_CELL);
            if (si < 0 || sj < 0 || si >= n - 1 || sj >= n - 1) continue;
            const s = si * n + sj;
            if (sqOf[s] < 0) {
              sqOf[s] = lists.length;
              lists.push([]);
            }
            const list = lists[sqOf[s]];
            if (!list.includes(k)) list.push(k);
          }
        }
      }
    });
    this.sqStart = new Int32Array(N + 1);
    for (let s = 0; s < N; s++) this.sqStart[s + 1] = this.sqStart[s] + (sqOf[s] >= 0 ? lists[sqOf[s]].length : 0);
    this.sqPond = new Int16Array(this.sqStart[N]);
    for (let s = 0; s < N; s++) if (sqOf[s] >= 0) this.sqPond.set(lists[sqOf[s]], this.sqStart[s]);
    // A lake holds water only in a closed basin: where the ground at a raster point beside its water lies under its
    // level (its basin opens onto a slope falling away between the raster points, past the cells it may flood, or onto
    // a lower lake's water), the water would stand against nothing there (a wall), and it is left dry. Mostly tarns
    // (small basins in steep country); a few lakes a world.
    d.lakes.forEach((l, k) => {
      if (this.main[k] < 0) return;
      const R = this.rasters[k];
      for (let p = 0; p < R.pool.length; p++) {
        const id = R.pool[p];
        if (id < 0) continue;
        const pi = Math.floor(p / R.cols);
        const pj = p % R.cols;
        for (let a = 0; a < 8; a++) {
          const qi = pi + DI[a];
          const qj = pj + DJ[a];
          const leak = qi < 0 || qj < 0 || qi >= R.rows || qj >= R.cols || (R.pool[qi * R.cols + qj] !== id && !(groundOf(R, qi, qj) >= this.pools[id].level));
          if (leak) {
            this.drainPond(k);
            this.leaky.push(k);
            return;
          }
        }
      }
    });
  }
  /**
   * How far the small-scale relief is smoothed out at (north, east), [0, 1]: 1 over each lake's domain and SMOOTH_RING
   * raster points round it, falling to 0 over two more (a cubic B-spline over the raster: C2, no crease on its lines).
   * Leaves the lake's level in smoothLevel (the terrain keeps its relief where it stands well over the water).
   */
  smooth(north: number, east: number): number {
    this.smoothLevel = -Infinity;
    const { d } = this;
    const x = (east - d.origin) / LAKE_RASTER;
    const y = (north - d.origin) / LAKE_RASTER;
    const rj = Math.floor(x);
    const ri = Math.floor(y);
    if (ri < 1 || rj < 1 || ri >= RASTER_N - 2 || rj >= RASTER_N - 2) return 0;
    const s = Math.floor(ri / RASTER_PER_CELL) * d.n + Math.floor(rj / RASTER_PER_CELL);
    const s0 = this.sqStart[s];
    const s1 = this.sqStart[s + 1];
    if (s0 === s1) return 0;
    const tx = x - rj;
    const ty = y - ri;
    let best = 0;
    for (let t = s0; t < s1; t++) {
      const R = this.rasters[this.sqPond[t]];
      const li = ri - R.gi;
      const lj = rj - R.gj;
      if (li < 1 || lj < 1 || li >= R.rows - 2 || lj >= R.cols - 2) continue;
      let v = 0;
      let level = -Infinity;
      for (let a = 0; a < 4; a++) {
        const row = (li - 1 + a) * R.cols + lj - 1;
        v += bspline(a, ty) * (bspline(0, tx) * R.soft[row] + bspline(1, tx) * R.soft[row + 1] + bspline(2, tx) * R.soft[row + 2] + bspline(3, tx) * R.soft[row + 3]);
        for (let b = 0; b < 4; b++) {
          const id = R.softPool[row + b];
          if (id >= 0) level = Math.max(level, this.pools[id].level);
        }
      }
      if (v > best) {
        best = v;
        this.smoothLevel = level;
      }
    }
    return Math.min(1, best);
  }
  /** The pond (Drainage.lakes index) of the lake `at` last found (-1: none). */
  pond = -1;
  /** The pool (index into pools) of the lake `at` last found (-1: none). */
  poolHit = -1;
  /**
   * Take a pond's water away (all its pools), before anything samples the terrain: a pond the river network finds
   * standing well above the river that runs into it (its water level was set on the lattice, but the raster flood of a
   * pond upstream spilled lower and the river arrives below it) is not a lake but a dry basin the river runs through.
   */
  drainPond(k: number): void {
    this.changed.push(k);
    const R = this.rasters[k];
    R.pool.fill(-1);
    R.shore.fill(-1);
    R.soft.fill(0);
    R.softPool.fill(-1);
    for (const p of this.pools) if (p.lake === k) p.drained = true;
    this.main[k] = -1;
  }
  /**
   * Lower a pond's water to `level` (each of its pools standing higher): a river runs through its basin at that level
   * (riverNetwork.ts), so the water cannot stand over it. The raster points whose ground now lies at or over the
   * domain's edge (level + LAKE_MARGIN) leave the domain; a pool left too shallow or too small for a lake is dry.
   */
  lowerPond(k: number, level: number): void {
    this.changed.push(k);
    const R = this.rasters[k];
    const top = level + LAKE_MARGIN;
    this.pools.forEach((pool, id) => {
      if (pool.lake !== k || pool.drained || pool.level <= level) return;
      pool.level = level;
      let bottom = Infinity;
      let wet = 0;
      let sn = 0;
      let se = 0;
      for (let p = 0; p < R.pool.length; p++) {
        if (R.pool[p] !== id) continue;
        const g = R.ground[p];
        if (!(g < top)) {
          R.pool[p] = -1;
          continue;
        }
        bottom = Math.min(bottom, g);
        if (g >= level) continue;
        wet++;
        sn += this.d.origin + (R.gi + Math.floor(p / R.cols)) * LAKE_RASTER;
        se += this.d.origin + (R.gj + (p % R.cols)) * LAKE_RASTER;
      }
      if (level - bottom < LAKE_MIDDLE_DEPTH || wet < 2) {
        for (let p = 0; p < R.pool.length; p++) if (R.pool[p] === id) R.pool[p] = -1;
        pool.drained = true;
        return;
      }
      sn /= wet;
      se /= wet;
      let snn = 0;
      let see = 0;
      let sne = 0;
      let cd = Infinity;
      for (let p = 0; p < R.pool.length; p++) {
        if (R.pool[p] !== id || R.ground[p] >= level) continue;
        const dn = this.d.origin + (R.gi + Math.floor(p / R.cols)) * LAKE_RASTER - sn;
        const de = this.d.origin + (R.gj + (p % R.cols)) * LAKE_RASTER - se;
        snn += dn * dn;
        see += de * de;
        sne += dn * de;
        if (R.ground[p] <= level - LAKE_CENTRE_DEPTH && dn * dn + de * de < cd) {
          cd = dn * dn + de * de;
          pool.centreNorth = sn + dn;
          pool.centreEast = se + de;
        }
      }
      Object.assign(pool, { bottom, wet, north: sn, east: se, snn: snn / wet, see: see / wet, sne: sne / wet });
    });
    let best = -1;
    this.pools.forEach((pool, id) => {
      if (pool.lake === k && !pool.drained && (best < 0 || pool.wet > this.pools[best].wet)) best = id;
    });
    this.main[k] = best;
    if (best < 0) this.drainPond(k);
  }
  /** The level of the lake whose smoothing smooth() last found (-Infinity: none). */
  smoothLevel = -Infinity;
  /** The level of the lake whose shore holds() last found (-Infinity: none). */
  holdLevel = -Infinity;
  /**
   * How firmly a valley carved past a lake keeps its ground over the lake's water at (north, east), [0, 1]: 1 over a
   * lake's domain and the ring of raster points round it, falling to 0 within two more (a cubic B-spline over the
   * raster). Leaves the lake's level in holdLevel. Without it a valley's floor or wall could fall below the water
   * just past the domain's edge, and the water would stand against nothing there; it reaches a raster point beyond
   * the domain, so it holds a shore, not a plateau.
   */
  holds(north: number, east: number): number {
    this.holdLevel = -Infinity;
    const { d } = this;
    const x = (east - d.origin) / LAKE_RASTER;
    const y = (north - d.origin) / LAKE_RASTER;
    const rj = Math.floor(x);
    const ri = Math.floor(y);
    if (ri < 1 || rj < 1 || ri >= RASTER_N - 2 || rj >= RASTER_N - 2) return 0;
    const s = Math.floor(ri / RASTER_PER_CELL) * d.n + Math.floor(rj / RASTER_PER_CELL);
    const s0 = this.sqStart[s];
    const s1 = this.sqStart[s + 1];
    if (s0 === s1) return 0;
    const tx = x - rj;
    const ty = y - ri;
    let best = 0;
    for (let t = s0; t < s1; t++) {
      const R = this.rasters[this.sqPond[t]];
      const li = ri - R.gi;
      const lj = rj - R.gj;
      if (li < 1 || lj < 1 || li >= R.rows - 2 || lj >= R.cols - 2) continue;
      let v = 0;
      let level = -Infinity;
      for (let a = 0; a < 4; a++) {
        const row = (li - 1 + a) * R.cols + lj - 1;
        const wy = bspline(a, ty);
        for (let b = 0; b < 4; b++) {
          const id = R.shore[row + b];
          if (id < 0) continue;
          v += wy * bspline(b, tx);
          level = Math.max(level, this.pools[id].level);
        }
      }
      if (v > best) {
        best = v;
        this.holdLevel = level;
      }
    }
    return Math.min(1, best);
  }
  /**
   * The pool whose domain holds the raster point (ri, rj) (global raster indices), -1 for none: the pool drawn there
   * (its water covers the point where the ground there lies below its level; the domain's edge stands up to
   * LAKE_MARGIN over it). For streams.ts, which routes on the same raster.
   */
  poolAt(ri: number, rj: number): number {
    const { d } = this;
    if (ri < 0 || rj < 0 || ri >= RASTER_N || rj >= RASTER_N) return -1;
    const s = Math.min(d.n - 2, Math.floor(ri / RASTER_PER_CELL)) * d.n + Math.min(d.n - 2, Math.floor(rj / RASTER_PER_CELL));
    for (let t = this.sqStart[s]; t < this.sqStart[s + 1]; t++) {
      const R = this.rasters[this.sqPond[t]];
      const li = ri - R.gi;
      const lj = rj - R.gj;
      if (li < 0 || lj < 0 || li >= R.rows || lj >= R.cols) continue;
      const id = R.pool[li * R.cols + lj];
      if (id >= 0) return id;
    }
    return -1;
  }
  /**
   * Add a pond flooded after the drainage (streams.ts: a closed hollow a stream ends in, filled to its spill): its
   * raster points (global indices) whose `ground` (the routing ground there) lies under `level`, as one pool of a new
   * raster of its own (no relief smoothing about it: the streams traced before it keep the ground they ran on). Its
   * points are the lakes' domain (the ground under its level plus LAKE_MARGIN, streams.ts), so its shore lies inside
   * them, where the ground crosses its level. Returns the pool's id. Its water is drawn as any lake's (at).
   */
  addPond(points: readonly number[], ground: readonly number[], level: number, spill: number): number {
    const { d } = this;
    let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
    for (const k of points) {
      const i = Math.floor(k / RASTER_N);
      const j = k % RASTER_N;
      i0 = Math.min(i0, i);
      i1 = Math.max(i1, i);
      j0 = Math.min(j0, j);
      j1 = Math.max(j1, j);
    }
    const gi = Math.max(0, i0 - 2);
    const gj = Math.max(0, j0 - 2);
    const rows = Math.min(RASTER_N - 1, i1 + 2) - gi + 1;
    const cols = Math.min(RASTER_N - 1, j1 + 2) - gj + 1;
    const R: PondRaster = { gi, gj, rows, cols, ground: new Float32Array(rows * cols).fill(NaN), pool: new Int16Array(rows * cols).fill(-1), soft: new Uint8Array(rows * cols), shore: new Int16Array(rows * cols).fill(-1), softPool: new Int16Array(rows * cols).fill(-1) };
    const k = this.rasters.length;
    const id = this.pools.length;
    let wet = 0, sn = 0, se = 0, bottom = Infinity, cn = 0, ce = 0, deep = -Infinity;
    points.forEach((q, t) => {
      const p = (Math.floor(q / RASTER_N) - gi) * cols + (q % RASTER_N) - gj;
      R.ground[p] = ground[t];
      R.pool[p] = id;
      const north = d.origin + Math.floor(q / RASTER_N) * LAKE_RASTER;
      const east = d.origin + (q % RASTER_N) * LAKE_RASTER;
      wet++;
      sn += north;
      se += east;
      bottom = Math.min(bottom, ground[t]);
      if (level - ground[t] > deep) {
        deep = level - ground[t];
        cn = north;
        ce = east;
      }
    });
    this.rasters.push(R);
    this.pools.push({ lake: k, level, bottom, wet, north: sn / wet, east: se / wet, snn: 0, see: 0, sne: 0, centreNorth: cn, centreEast: ce, spill });
    // The squares its points (and two about them, as at() reads a raster square's corners) reach.
    const n = d.n;
    const N = n * n;
    const add = new Map<number, number>();
    for (const q of points) {
      const ri = Math.floor(q / RASTER_N);
      const rj = q % RASTER_N;
      for (let a = -2; a <= 1; a++)
        for (let b = -2; b <= 1; b++) {
          const si = Math.floor((ri + a) / RASTER_PER_CELL);
          const sj = Math.floor((rj + b) / RASTER_PER_CELL);
          if (si < 0 || sj < 0 || si >= n - 1 || sj >= n - 1) continue;
          add.set(si * n + sj, 1);
        }
    }
    const start = new Int32Array(N + 1);
    for (let sq = 0; sq < N; sq++) start[sq + 1] = start[sq] + (this.sqStart[sq + 1] - this.sqStart[sq]) + (add.has(sq) ? 1 : 0);
    const pond = new Int16Array(start[N]);
    for (let sq = 0; sq < N; sq++) {
      const a0 = this.sqStart[sq];
      const len = this.sqStart[sq + 1] - a0;
      pond.set(this.sqPond.subarray(a0, a0 + len), start[sq]);
      if (add.has(sq)) pond[start[sq] + len] = k;
    }
    this.sqStart = start;
    this.sqPond = pond;
    return id;
  }
  /** The ponds added so far (addPond), to take back the ones added after it (restorePonds; streams.ts, a seeded
   * world's pond pass: a pond filled by one rule that then gives way to another). */
  pondState(): { rasters: number; pools: number; sqStart: Int32Array; sqPond: Int16Array } {
    return { rasters: this.rasters.length, pools: this.pools.length, sqStart: this.sqStart, sqPond: this.sqPond };
  }
  restorePonds(s: { rasters: number; pools: number; sqStart: Int32Array; sqPond: Int16Array }): void {
    this.rasters.length = s.rasters;
    this.pools.length = s.pools;
    this.sqStart = s.sqStart;
    this.sqPond = s.sqPond;
  }
  /** The pond rasters drained or lowered (drainPond, lowerPond) since this was last emptied: the ground the terrain
   * draws there (its lake smoothing) changed with them (streams.ts takes the streams' raster afresh there). */
  readonly changed: number[] = [];
  /** A pond raster's box: its first raster point (row, column) and its size, points. */
  rasterBox(k: number): { gi: number; gj: number; rows: number; cols: number } {
    const R = this.rasters[k];
    return { gi: R.gi, gj: R.gj, rows: R.rows, cols: R.cols };
  }
  /** The raster points (global indices ri * RASTER_N + rj) of a pool's domain. */
  poolPoints(id: number): number[] {
    const R = this.rasters[this.pools[id].lake];
    const out: number[] = [];
    for (let p = 0; p < R.pool.length; p++) if (R.pool[p] === id) out.push((R.gi + Math.floor(p / R.cols)) * RASTER_N + R.gj + (p % R.cols));
    return out;
  }
  /** The ground the pond rasters sampled at the raster point (ri, rj) (NaN where none did). */
  rasterGround(ri: number, rj: number): number {
    const { d } = this;
    if (ri < 0 || rj < 0 || ri >= RASTER_N || rj >= RASTER_N) return NaN;
    const s = Math.min(d.n - 2, Math.floor(ri / RASTER_PER_CELL)) * d.n + Math.min(d.n - 2, Math.floor(rj / RASTER_PER_CELL));
    for (let t = this.sqStart[s]; t < this.sqStart[s + 1]; t++) {
      const R = this.rasters[this.sqPond[t]];
      const li = ri - R.gi;
      const lj = rj - R.gj;
      if (li < 0 || lj < 0 || li >= R.rows || lj >= R.cols) continue;
      const g = R.ground[li * R.cols + lj];
      if (g === g) return g;
    }
    return NaN;
  }
  /**
   * The level of the lake standing over (north, east), m, or -Infinity: inside a lake's domain, or (given the ground
   * there) on ground below the level of the one pool on the corners of its raster square (the ground between the
   * raster points can dip under the level where the interpolated field puts the domain's edge: a dip the water
   * reaches, not one it stands against).
   */
  at(north: number, east: number, ground?: number): number {
    this.field = 0;
    this.pond = -1;
    this.poolHit = -1;
    const { d } = this;
    const x = (east - d.origin) / LAKE_RASTER;
    const y = (north - d.origin) / LAKE_RASTER;
    const rj = Math.floor(x);
    const ri = Math.floor(y);
    if (ri < 0 || rj < 0 || ri >= RASTER_N - 1 || rj >= RASTER_N - 1) return -Infinity;
    const s = Math.floor(ri / RASTER_PER_CELL) * d.n + Math.floor(rj / RASTER_PER_CELL);
    const s0 = this.sqStart[s];
    const s1 = this.sqStart[s + 1];
    if (s0 === s1) return -Infinity;
    const fx = x - rj;
    const fy = y - ri;
    let bestLevel = -Infinity;
    let bestField = 0;
    let bestPond = -1;
    let bestPool = -1;
    for (let t = s0; t < s1; t++) {
      const R = this.rasters[this.sqPond[t]];
      const li = ri - R.gi;
      const lj = rj - R.gj;
      if (li < 0 || lj < 0 || li >= R.rows - 1 || lj >= R.cols - 1) continue;
      const p00 = li * R.cols + lj;
      const p01 = p00 + 1;
      const p10 = p00 + R.cols;
      const p11 = p10 + 1;
      // The pool of the corners (the highest, where two meet).
      const q00 = R.pool[p00];
      const q01 = R.pool[p01];
      const q10 = R.pool[p10];
      const q11 = R.pool[p11];
      if (q00 < 0 && q01 < 0 && q10 < 0 && q11 < 0) continue;
      let id = -1;
      let one = true;
      for (let c = 0; c < 4; c++) {
        const q = c === 0 ? q00 : c === 1 ? q01 : c === 2 ? q10 : q11;
        if (q < 0) continue;
        if (id >= 0 && q !== id) one = false;
        if (id < 0 || this.pools[q].level > this.pools[id].level) id = q;
      }
      const top = this.pools[id].level + LAKE_MARGIN;
      let f = (1 - fx) * (1 - fy) * cornerField(R, p00, id, top) + fx * (1 - fy) * cornerField(R, p01, id, top) + (1 - fx) * fy * cornerField(R, p10, id, top) + fx * fy * cornerField(R, p11, id, top);
      if (f <= 0) {
        if (ground === undefined || !one || ground >= this.pools[id].level) continue;
        f = 0.01;
      }
      if (this.pools[id].level > bestLevel) {
        bestLevel = this.pools[id].level;
        bestField = f;
        bestPond = this.pools[id].lake;
        bestPool = id;
      }
    }
    if (bestLevel === -Infinity) return -Infinity;
    this.field = bestField;
    this.pond = bestPond;
    this.poolHit = bestPool;
    return bestLevel;
  }
}
/** Further lateral samples along a lake's edge in settlePonds, as fractions of the first (0.3 cell). */
const EDGE_LATERAL = [0.5, 1.5];
/** See LakeMask, m. */
const LAKE_SHORE_MARGIN = 20;
