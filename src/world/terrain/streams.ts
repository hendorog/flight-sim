// A seeded world's streams (any seed but 0): the small channels the river network (riverNetwork.ts) leaves out - the
// outlet of every lake no river runs through, and the headwaters above the rivers' sources - traced at load in every
// thread, and the flow along every channel (rivers and streams): how steep it runs, how fast, and where it falls.
//
// The rivers come from the drainage's 1 km lattice (drainage.ts, RIVER_AREA). A stream is too small for that lattice:
// it runs in the gullies and side valleys between its cells. So each one is traced down the terrain itself, on the
// 250 m raster the lakes are flooded on (LakeMask), by steepest descent (D8) over the ground as the terrain draws it
// along a stream (the natural ground without its small-scale relief and finest gullies, with the rivers' valleys cut
// into it: heightfield.ts naturalHeightSmooth, carveNetwork): it seeks the lowest point, step by step, until it reaches
// a river or a stream already traced (a confluence), a lake or the sea. Where the descent finds no lower neighbour (a
// hollow finer than the lattice) it climbs out over the lowest one and cuts a notch through the sill (its water never
// rises); where that sill is too high the hollow is filled to it instead (a flat of silt the stream crosses, FillMask,
// as a tarn fills) and where it is too deep or big for that the lattice's own routing shows the way. A lake's outlet
// leaves by the lowest way out of its basin (a priority flood from its water), through a gorge where its rim stands over
// the water, but not through a high or long rise (OUTLET_SILL: that lake has no outlet). Water lying higher than the
// stream's own (a river held up on its valley floor, a lake flooded on smoother ground) is not entered: the stream goes
// on down beside it.
//
// A stream is a cheap class: no meanders, no floodplain or valley, just a narrow notch (heightfield.ts carveNetwork).
// Its water follows the ground down (the running minimum of the ground along its course, a little under it, looked at
// again between the raster points), its width grows with the catchment (summed at each confluence: a step up), and
// down a steep slope it is a continuous cascade, its water following the ground (refineSteep). It falls only where the
// ground breaks (falls.ts: a fault, a hanging valley's lip, a lake perched on a wall).

import { DOMAIN_HALF, DRAIN_CELL, LAKE_RASTER, MinHeap, RASTER_N, RIVER_AREA, type Drainage, type LakeMask } from './drainage';
import { hash2i } from './noise';
import { AIRPORT } from '../../core/world';

/** Catchment, km², from which a headwater stream is drawn (the lattice cells reaching it whose donors do not). */
export const STREAM_AREA = 35;
/** Water stands this far under the ground at each raster point of a stream's course, m. */
const STREAM_DEPTH = 1.0;
/** Catchment a stream gathers along its course from the slopes either side, km² per km. */
const LATERAL_GAIN = 2;
/** A headwater stream starts as if draining this much, km² (about 1.2 m half-width), and gathers its head cell's
 * catchment over HEAD_RAMP, m. */
export const HEAD_START_AREA = 6;
const HEAD_RAMP = 2000;
/** The ground under every this many stream samples is checked for a dip between the raster points. */
const LEVEL_EVERY = 3;
/** ... and those between them too where the level falls this much from one to the next, m. */
const STEEP_RECHECK = 3;
/** Stream sample spacing, m. */
const STREAM_SPACING = 50;
/** A stream joins a line (or a lake) where that water lies at most JOIN_TOL m over its own (its last reach then backs
 * up to it); where it lies higher, the stream came down through lower ground beside it (a river held up on its valley floor, a lake flooded on the ground
 * without its gullies) and ends SINK_CLEAR short of it (it sinks into the ground there), not cutting its notch under
 * the other water. */
const JOIN_TOL = 6;
/** How far under the water it joins the ground along a stream's last reach may lie for the reach to back up to it, m
 * (the terrain builds the banks up to STREAM_FILL, heightfield.ts). */
const BACKUP_FILL = 4;
const SINK_CLEAR = 200;
/** A stream ending in a hollow narrows over this much of its end, m, to this fraction of its width. */
const SINK_TAPER = 400;
const SINK_END = 0.25;
/** An outlet keeps its lake's level this far past the lake's domain, m. */
const OUTLET_KEEP = 60;
/** A stream climbs out of a pit over its lowest neighbour at most this high over the lowest ground on its course so
 * far, m; beyond, it follows the lattice's routing. */
const CLIMB_HEIGHT = 25;
/** Nor does a headwater follow the lattice's routing over ground higher than FORCE_HEIGHT over that lowest ground, m:
 * it ends in the hollow instead (a sink). A lake's outlet goes on over up to FORCE_HEIGHT_OUTLET (its lake drains that
 * way on the lattice): it cuts a gorge through the rim. */
const FORCE_HEIGHT = 40;
const FORCE_HEIGHT_OUTLET = 40;
/** Highest an outlet's way out may rise over its lake's water, m: the deepest its overflow has worn the rim down (a
 * broad breach, BREACH_*). A lake whose every way out rises higher has no outlet. */
const OUTLET_SILL = 80;
/**
 * A hollow a stream can neither climb out of (CLIMB_HEIGHT) nor cut its way out of along the lattice's routing
 * (FORCE_HEIGHT) holds water: it fills to its sill and the stream overflows it there (a tarn, TarnMask), when its sill
 * stands at most TARN_DEPTH over its floor and it spans at most TARN_POINTS raster points; its water stands TARN_BELOW
 * under the sill.
 */
const TARN_DEPTH = 250;
const TARN_POINTS = 160;
const TARN_BELOW = 0.3;
/** A tarn draining into other water just beyond its rim stands this far over that water, m; one with a channel through
 * its shore lower than its water by TARN_BREACHED drains to that channel. */
const TARN_OVER = 1;
const TARN_BREACHED = 3;
/**
 * Where a stream's water runs more than BREACH_MIN under the ground it crosses (it has worn its way through a rim, a
 * sill, a lake's outlet, or cut a gorge below a fall) the ground was worn away broadly, not cut as a trench: a floor
 * BREACH_BASE + BREACH_PER_M per metre of the cut wide either side, walls beyond (breachWall; heightfield.ts carves it).
 * A lake's outlet wears its rim down over a width that grows with the lake (breachOfLake), and the scar narrows over
 * BREACH_SCAR m beyond the rim.
 */
const BREACH_MIN = 3;
const BREACH_BASE = 12;
const BREACH_PER_M = 1.2;
/** (The floor widens with the cut up to BREACH_CUT_WIDE m of it: a deeper cut is a gorge, its walls rising higher.) */
const BREACH_CUT_WIDE = 30;
const BREACH_SCAR = 700;
/** A breach's walls rise at BREACH_WALL for their first BREACH_LOW m, then at BREACH_STEEP (rock): 24 then 45 degrees. */
const BREACH_WALL = 0.45;
const BREACH_LOW = 20;
const BREACH_STEEP = 1;
/** Height of a breach's wall at `x` m beyond its floor, m. */
export function breachWall(x: number): number {
  const xl = BREACH_LOW / BREACH_WALL;
  return x < xl ? BREACH_WALL * x : BREACH_LOW + BREACH_STEEP * (x - xl);
}
/** How far from its line a breach of floor half-width `bw` cut `cut` m under the ground reaches (its walls' top, with a
 * margin: heightfield.ts fades the carving out over the last part), m. */
export function breachReachOf(bw: number, cut: number): number {
  const c = Math.max(cut, 10) * 1.5 + 10;
  const xl = BREACH_LOW / BREACH_WALL;
  return bw + (c < BREACH_LOW ? c / BREACH_WALL : xl + (c - BREACH_LOW) / BREACH_STEEP) + 30;
}
/** The floor half-width of a breach cut `cut` m under the ground, m (0 under BREACH_MIN). */
export function breachOfCut(cut: number): number {
  return cut > BREACH_MIN ? BREACH_BASE + BREACH_PER_M * Math.min(cut, BREACH_CUT_WIDE) : 0;
}
/** Half-width of a lake's breach (its outlet's rim worn down), m, for a lake of `km2`: about 50 m for a tarn, 150 for a
 * lake of 2 km², 250 for one of 8 km², at most 300. */
const breachOfLake = (km2: number): number => Math.min(300, Math.max(50, 30 + 85 * Math.sqrt(Math.max(0, km2))));
/** Raster points an outlet's search for the lowest way out of its lake may visit. */
const OUTLET_FLOOD = 3000;
/** Most raster steps one stream may take. */
const MAX_STEPS = 3000;
/** Raster points within this distance of a river's channel samples (beyond its half-width; marked every 100 m along it)
 * count as reaching it, m: they cover a band at least the raster's half-diagonal wide, so no diagonal step slips past. */
const RIVER_TOUCH = 200;
/** Streams keep this far from the home runway's centreline segment, m (as the rivers' courses do). */
const HOME_CLEAR = 2500;

const ORIGIN = -DOMAIN_HALF;
const PER_CELL = DRAIN_CELL / LAKE_RASTER;
const SQRT2 = Math.SQRT2;
const DI = [-1, -1, -1, 0, 0, 1, 1, 1];
const DJ = [-1, 0, 1, -1, 1, -1, 0, 1];
/** The eight directions (indices into DI, DJ) in turn round the compass. */
const RING = [1, 2, 4, 7, 6, 5, 3, 0];

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** River channel half-width for a catchment (riverNetwork.ts halfWidthFor), m. */
export const riverHalfWidth = (area: number): number => Math.min(45, Math.max(3, 1.5 + 0.85 * Math.sqrt(area)));
/**
 * Channel half-width for any catchment, m: a stream's below RIVER_AREA (about 1.5 m at 8 km², 3.5 m at 20, growing
 * nearly in proportion), meeting the rivers' halfWidthFor at RIVER_AREA (7.2 m) and following it above.
 */
export function channelHalfWidth(area: number): number {
  if (area >= RIVER_AREA) return riverHalfWidth(area);
  return Math.max(0.8, riverHalfWidth(RIVER_AREA) * Math.pow(Math.max(0, area) / RIVER_AREA, 0.9));
}

/** A channel line as riverNetwork.ts keeps them (source first). */
export interface ChannelArrays {
  north: Float64Array;
  east: Float64Array;
  level: Float64Array;
  halfWidth: Float64Array;
  s: Float64Array;
}

/** A traced stream (source first). */
export interface StreamLine extends ChannelArrays {
  /** Catchment at each point, km². */
  area: Float64Array;
  /** Half-width of the broad breach worn through the ground where the water runs well under it (0: none), and how far
   * the water runs under the ground there (its cut), m. */
  breach: Float64Array;
  cut: Float64Array;
  /** The line it flows into (index into rivers then streams: the river count plus a stream's index), -1: none. */
  joins: number;
  /** Arc length along that line where it joins, m. */
  joinS: number;
  /** What it ends in. */
  end: 'channel' | 'lake' | 'sea' | 'edge' | 'stuck' | 'sink';
  /** The lake pool it drains (LakeMask.pools index), -1 for a headwater, and how many of its first samples keep the
   * lake's level (no fall among them). */
  pool: number;
  held: number;
}

export interface StreamReport {
  /** Lake pools standing; those a river runs through; outlet streams traced; outlets straight into another lake, onto the sea, with no spill found. */
  pools: number;
  riverPools: number;
  outlets: number;
  outletToLake: number;
  outletToSea: number;
  outletNone: number;
  /** Headwater heads found and traced (some are already beside a channel). */
  heads: number;
  traced: number;
  /** Streams by what they end in, and the outlet streams alone. */
  ends: Record<string, number>;
  outletEnds: Record<string, number>;
  km: number;
  steps: number;
  /** Raster steps of the outlet streams. */
  outletSteps: number;
  levelSamples: number;
  /** Ground over the water at each raster point of the courses, m (probes). */
  notch: number[];
  notchOutlet: number[];
  pits: number;
  /** Streams that end short of water lying above them, and how far above (lines, lakes), m. */
  sinks: number;
  sinkGap: number[];
  sinkGapLake: number[];
  /** Line sinks: the line's water over the ground at the stream's last raster point (less its depth), m. */
  sinkGapLast: number[];
  /** Streams that end in a hollow (a sink with no water beside it). */
  hollows: number;
  floods: number;
  /** Tarns lowered to a channel cutting through their shore, and those left holding water. */
  tarnsDrained: number;
  tarnsWet: number;
  /** Why outlet streams ended short (sink or stuck), counted. */
  outletSinkWhy: Record<string, number>;
  /** Hollows that hold water (tarns, TarnMask), and their depth over their floor, m; stream samples in a broad breach. */
  tarns: number;
  tarnDepth: number[];
  breachSamples: number;
  forced: number;
  samples: number;
  ms: number;
  /** How high each outlet's way out rises over its lake's water (the sill its notch cuts through), m. */
  outletSill: number[];
  /** Lakes whose every way out rises more than OUTLET_SILL over their water (no outlet). */
  outletHigh: number;
  /** Ground samples taken by the outlets. */
  outletSamples: number;
  /** Time to the end of the river marking, the outlets, the headwaters, ms. */
  tracePhases: number[];
  /** The falls' shaping (falls.ts shapeLines). */
  shape?: import('./falls').ShapeReport;
  /** riverNetwork.ts's own phases (river falls, tracing and the streams' falls, flow, index), ms. */
  phases?: number[];
}

/**
 * Trace the streams of a seeded world. `ground` is the terrain they run on (detailed, with the rivers' valleys);
 * `rivers` the river network's channels (their levels final); `riverPools` flags the lake pools a river runs through.
 */
export function traceStreams(p: { d: Drainage; mask: LakeMask; route: (north: number, east: number) => number; rivers: ReadonlyArray<ChannelArrays>; riverPools: Uint8Array; minArea?: number }): { streams: StreamLine[]; report: StreamReport; tarns: TarnMask } {
  const t0 = performance.now();
  const { d, mask, rivers } = p;
  const minArea = p.minArea ?? STREAM_AREA;
  const n = d.n;
  const R = RASTER_N;
  const nR = rivers.length;
  const report: StreamReport = { pools: 0, riverPools: 0, outlets: 0, outletToLake: 0, outletToSea: 0, outletNone: 0, heads: 0, traced: 0, ends: {}, outletEnds: {}, km: 0, steps: 0, outletSteps: 0, levelSamples: 0, notch: [], notchOutlet: [], pits: 0, sinks: 0, sinkGap: [], sinkGapLake: [], sinkGapLast: [], hollows: 0, floods: 0, outletSinkWhy: {}, tarns: 0, tarnsDrained: 0, tarnsWet: 0, tarnDepth: [], breachSamples: 0, forced: 0, samples: 0, ms: 0, tracePhases: [], outletSamples: 0, outletSill: [], outletHigh: 0 };

  // --- The ground on the raster, sampled as the traces need it: without the small-scale relief (the terrain takes it
  // away along a stream, heightfield.ts carveNetwork), for the routing and the water level alike.
  const cache = new Map<number, number>();
  const G = (k: number): number => {
    let g = cache.get(k);
    if (g === undefined) {
      g = p.route(ORIGIN + Math.floor(k / R) * LAKE_RASTER, ORIGIN + (k % R) * LAKE_RASTER);
      cache.set(k, g);
      report.samples++;
    }
    return g;
  };


  // --- The tarns so far (raster point -> tarn), and the water they hold (TarnMask).
  /** Each raster point's tarn + 1 (0: none). */
  const tarnGrid = new Int16Array(R * R);
  const tarnOf = { get: (k: number): number | undefined => (tarnGrid[k] > 0 ? tarnGrid[k] - 1 : undefined) };
  const tarns: Tarn[] = [];
  /** The tarns' points and the ring round them (tarn + 1, 0: none), where the terrain keeps to the routing ground. */
  const tarnNear = new Int16Array(R * R);
  const tarnMask = new TarnMask(tarnGrid, tarns, tarnNear);
  /** Each tarn's raster points. */
  const tarnPts: number[][] = [];
  /** The routing ground at the tarns' points before they filled. */
  const ground0 = new Map<number, number>();
  const fillHeap = new MinHeap(1024);

  // --- The home runway's surroundings, where no stream may run (its pad and approaches are levelled over the ground).
  const rw = AIRPORT.runway;
  const rwC = Math.cos(rw.heading);
  const rwS = Math.sin(rw.heading);
  const byHome = (k: number): boolean => {
    const dn = ORIGIN + Math.floor(k / R) * LAKE_RASTER - rw.center.north;
    const de = ORIGIN + (k % R) * LAKE_RASTER - rw.center.east;
    const along = Math.max(-rw.length / 2, Math.min(rw.length / 2, dn * rwC + de * rwS));
    return Math.hypot(dn - along * rwC, de - along * rwS) < HOME_CLEAR;
  };

  // --- What a trace may reach: the rivers' channels (and every stream once traced). A raster-sized array, 0 where
  // nothing is, else line * 65536 + sample + 1 (a line's samples are far fewer than 65536).
  const occ = new Int32Array(R * R);
  const mark = (k: number, line: number, idx: number): void => {
    if (occ[k] === 0) occ[k] = line * 65536 + Math.min(65534, idx) + 1;
  };
  const occLine = (o: number): number => Math.floor((o - 1) / 65536);
  const occIdx = (o: number): number => (o - 1) % 65536;
  for (let li = 0; li < nR; li++) {
    const r = rivers[li];
    let last = -Infinity;
    for (let i = 0; i < r.north.length; i++) {
      if (r.s[i] - last < 100 && i < r.north.length - 1) continue;
      last = r.s[i];
      const rad = r.halfWidth[i] + RIVER_TOUCH;
      const ri0 = Math.ceil((r.north[i] - rad - ORIGIN) / LAKE_RASTER);
      const ri1 = Math.floor((r.north[i] + rad - ORIGIN) / LAKE_RASTER);
      const rj0 = Math.ceil((r.east[i] - rad - ORIGIN) / LAKE_RASTER);
      const rj1 = Math.floor((r.east[i] + rad - ORIGIN) / LAKE_RASTER);
      for (let ri = Math.max(0, ri0); ri <= Math.min(R - 1, ri1); ri++) {
        for (let rj = Math.max(0, rj0); rj <= Math.min(R - 1, rj1); rj++) {
          const dn = ORIGIN + ri * LAKE_RASTER - r.north[i];
          const de = ORIGIN + rj * LAKE_RASTER - r.east[i];
          if (dn * dn + de * de <= rad * rad) mark(ri * R + rj, li, i);
        }
      }
    }
  }

  report.tracePhases.push(performance.now() - t0);
  const streams: StreamLine[] = [];
  /** The trace (its stamp) that last visited each raster point, and where on its course. */
  const visit = new Map<number, number>();
  const visitAt = new Map<number, number>();
  let stamp = 0;

  /**
   * The hollow round raster point `pit`, flooded from it (lowest first) until the flood steps down beyond its sill:
   * the hollow's points, its sill's level, and the way from the pit over the sill to the first point beyond it (`route`,
   * pit excluded). Null when it is too deep or too big (TARN_DEPTH, TARN_POINTS), reaches the edge, the home runway's
   * surroundings, a lake or a channel. Where the way out runs back up the course (`st`'s points), `keep` is how many of
   * the course's points come before it leaves the course.
   */
  const fillHollow = (pit: number, st: number, own: number, path: number[]): { route: number[]; level: number; floor: number; pts: number[]; keep: number } | null => {
    if (fillHeap.capacity < TARN_POINTS * 9) fillHeap.grow(TARN_POINTS * 9);
    fillHeap.size = 0;
    const parent = new Map<number, number>();
    parent.set(pit, -1);
    fillHeap.push(pit, G(pit));
    // (Measured from the ground before any flat was laid: flats do not stack up.)
    let floor = ground0.get(pit) ?? G(pit);
    let lvl = -Infinity;
    const pts: number[] = [];
    /** The way from the pit to k, the course cut back to where it leaves the course (null: it never leaves it). */
    const out = (k: number): { route: number[]; level: number; floor: number; pts: number[]; keep: number } | null => {
      const route: number[] = [];
      for (let q = k; q >= 0; q = parent.get(q) as number) route.push(q);
      route.reverse();
      // Its way out may run back up the course a little and leave it further up (the descent missed a lower way
      // there): the course is cut back to where the way out leaves it (the flat covers the rest).
      let last = 0;
      const onCourse = (q: number): boolean => {
        const vi = visitAt.get(q);
        return visit.get(q) === st && vi !== undefined && vi < path.length && path[vi] === q;
      };
      for (let i = 1; i < route.length; i++) if (onCourse(route[i])) last = i;
      if (last === route.length - 1) return null;
      return { route: route.slice(last + 1), level: lvl, floor, pts, keep: (visitAt.get(route[last]) as number) + 1 };
    };
    while (fillHeap.size > 0) {
      const k = fillHeap.pop();
      const g = G(k);
      // Water beside the hollow: where it lies no higher than the flood the flat spills into it; higher, it bounds it.
      const o = occ[k];
      const pool = o === 0 ? mask.poolAt(Math.floor(k / R), k % R) : -1;
      if (o !== 0 || pool >= 0) {
        const wl = o !== 0 ? lineAt(occLine(o)).level[occIdx(o)] : mask.pools[pool].level;
        if (wl <= Math.max(lvl, g)) return out(k);
        continue;
      }
      // (The course's own points lower than the flood lie in the same hollow: the stream came down into it.)
      if (g < lvl && visit.get(k) !== st) return out(k);
      lvl = Math.max(lvl, g);
      floor = Math.min(floor, ground0.get(k) ?? g);
      if (lvl - floor > TARN_DEPTH || pts.length >= TARN_POINTS) return null;
      pts.push(k);
      const ki = Math.floor(k / R);
      const kj = k % R;
      if (ki <= 0 || kj <= 0 || ki >= R - 1 || kj >= R - 1) return null;
      for (let a = 0; a < 8; a++) {
        const q = (ki + DI[a]) * R + kj + DJ[a];
        if (parent.has(q) || byHome(q)) continue;
        const qp = mask.poolAt(Math.floor(q / R), q % R);
        if (qp >= 0 && (qp === own || mask.pools[qp].drained)) continue;
        parent.set(q, k);
        fillHeap.push(q, G(q));
      }
    }
    return null;
  };

  /** What a course reached; `ok` when the trace found it can flow into it (canReach). */
  type End = { kind: StreamLine['end']; line: number; idx: number; pool: number; ok?: boolean; tarn?: number; why?: string };
  /**
   * Steepest descent from raster point `start`, never into `own` pool. Returns the course (raster indices, start
   * first) and what it reached. (report.floods counts the climbs over a pit's sill.)
   */
  const trace = (prefix: number[], own: number, level: number): { path: number[]; end: End; made: number[] } => {
    const st = ++stamp;
    /** The tarns this trace filled. */
    const made: number[] = [];
    const path = prefix.slice();
    path.forEach((k, i) => {
      visit.set(k, st);
      visitAt.set(k, i);
    });
    /** Whether the step from raster point c to q (a diagonal) crosses the course between the two corners. */
    const crosses = (c: number, q: number): boolean => {
      const ci = Math.floor(c / R);
      const qj = q % R;
      const qi = Math.floor(q / R);
      const cj = c % R;
      if (ci === qi || cj === qj) return false;
      const a = qi * R + cj;
      const b = ci * R + qj;
      return visit.get(a) === st && visit.get(b) === st && Math.abs((visitAt.get(a) as number) - (visitAt.get(b) as number)) === 1;
    };
    let cur = path[path.length - 1];
    // The lowest ground on the course so far: a pit's climb goes no higher than CLIMB_HEIGHT over it.
    let runMin = level;
    for (const k of path) if (!(own >= 0 && mask.poolAt(Math.floor(k / R), k % R) === own)) runMin = Math.min(runMin, G(k));
    // Water the stream can flow into lies no higher than its own (JOIN_TOL): a line where its water is that low, or
    // such a lake. Higher water (a river held up on its valley floor, a lake flooded on smoother ground) is not
    // entered: the stream ends short of it (build, sink).
    const joinAt = (o: number): number => {
      const j = occIdx(o);
      return canReach(lineAt(occLine(o)).level[j]) ? j : -1;
    };
    /**
     * Whether the stream can flow into water at `mouth`: it lies no higher than JOIN_TOL over the stream's own, or the
     * stream's last reach can back up to it - the ground along the reach lying under `mouth` is nowhere more than
     * BACKUP_FILL under it (the terrain builds the stream's banks up that much, heightfield.ts carveNetwork). The
     * stream's level carries the deepest dip it went through (a pit it climbed out of); arriving at a river held a
     * little over that dip, the water backs up over it rather than the stream ending short.
     */
    const canReach = (mouth: number): boolean => {
      // (Never water standing over its source: its whole course would back up over the lake it leaves.)
      if (mouth > level) return false;
      if (mouth <= runMin - STREAM_DEPTH + JOIN_TOL) return true;
      for (let i = path.length - 1; i >= 0 && lowAt[i] - STREAM_DEPTH < mouth; i--) {
        if (i === 0 || G(path[i]) - STREAM_DEPTH < mouth - BACKUP_FILL) return false;
      }
      return true;
    };
    // The running minimum of the ground at each point of the course (for canReach).
    const lowAt: number[] = [];
    {
      let lo = level;
      for (const k of path) {
        if (!(own >= 0 && mask.poolAt(Math.floor(k / R), k % R) === own)) lo = Math.min(lo, G(k));
        lowAt.push(lo);
      }
    }
    const reached = (k: number): End | null => {
      const o = occ[k];
      if (o !== 0) {
        const j = joinAt(o);
        return j >= 0 ? { kind: 'channel', line: occLine(o), idx: j, pool: -1, ok: true } : { kind: 'sink', line: occLine(o), idx: occIdx(o), pool: -1 };
      }
      const ri = Math.floor(k / R);
      const rj = k % R;
      if (ri <= 0 || rj <= 0 || ri >= R - 1 || rj >= R - 1) return { kind: 'edge', line: -1, idx: 0, pool: -1 };
      const pool = mask.poolAt(ri, rj);
      if (pool >= 0 && pool !== own && !mask.pools[pool].drained) return canReach(mask.pools[pool].level) ? { kind: 'lake', line: -1, idx: 0, pool, ok: true } : { kind: 'sink', line: -1, idx: 0, pool };
      // A tarn another trace filled whose stream was not drawn (its lake's own water, as a lake's).
      const t = tarnOf.get(k);
      if (t !== undefined && tarns[t].line < 0 && !made.includes(t)) return { kind: 'lake', line: -1, idx: 0, pool: -1, ok: true, tarn: t };
      if (G(k) <= 0.5) return { kind: 'sea', line: -1, idx: 0, pool: -1 };
      return null;
    };
    /** Whether k lies in or beside another lake whose water stands higher than the stream's (it would cut a notch
     * beside that water). */
    const byHigherLake = (k: number): boolean => besideLake(k, own, runMin - STREAM_DEPTH + JOIN_TOL + BACKUP_FILL);
    /** Whether k lies in water standing higher than the stream's that it cannot back up to (a line held up on its
     * valley floor, a lake perched over the gully): the stream goes round it, on down beside it, rather than ending. */
    const higherWater = (k: number): boolean => {
      const o = occ[k];
      if (o !== 0) return joinAt(o) < 0;
      const pool = mask.poolAt(Math.floor(k / R), k % R);
      return pool >= 0 && pool !== own && !mask.pools[pool].drained && !canReach(mask.pools[pool].level);
    };
    /** Whether k lies in or round a tarn (its own too, once it has come down from it) whose water stands well over the
     * stream's (it would cut under it). */
    const byHigherTarn = (k: number): boolean => {
      const t = tarnNear[k] - 1;
      return t >= 0 && tarns[t].level > runMin - STREAM_DEPTH + JOIN_TOL + BACKUP_FILL;
    };
    const blocked = (k: number): boolean => visit.get(k) === st || (own >= 0 && mask.poolAt(Math.floor(k / R), k % R) === own) || byHome(k) || crosses(cur, k) || byHigherLake(k) || higherWater(k) || byHigherTarn(k);
    // The direction of the last step (index into RING), -1 before the first; climbs over sills since the last descent.
    let dir = -1;
    let forcing = 0;
    let forceTarget = -1;
    /**
     * Fill the hollow round raster point `pit` to its sill (fillHollow): the flat lies over it (later streams route
     * over it too), and the course crosses it to the sill and goes on from the first point beyond. False when it
     * cannot be filled.
     */
    const fillAt = (pit: number): boolean => {
      const hollow = fillHollow(pit, st, own, path);
      if (!hollow) return false;
      report.tarns++;
      report.tarnDepth.push(hollow.level - hollow.floor);
      const id = tarns.length;
      // It spills over its sill, or where it reaches other water lower than that (a stream or lake just beyond its
      // rim), it drains into that water: its own stands a little over it (the rim between is worn through, a breach).
      const exit = hollow.route[hollow.route.length - 1];
      const ex = exit === undefined ? 0 : occ[exit];
      const exPool = exit === undefined || ex !== 0 ? -1 : mask.poolAt(Math.floor(exit / R), exit % R);
      const below = ex !== 0 ? lineAt(occLine(ex)).level[occIdx(ex)] : exPool >= 0 ? mask.pools[exPool].level : Infinity;
      const water = Math.min(hollow.level - TARN_BELOW, below + TARN_OVER);
      const pts = hollow.pts.filter((k) => (ground0.get(k) ?? G(k)) < water);
      if (!pts.length) return false;
      tarns.push({ level: water, floor: hollow.floor, points: pts.length, line: -1, idx: 0 });
      tarnPts.push(pts);
      made.push(id);
      for (const k of pts) {
        if (!ground0.has(k)) ground0.set(k, G(k));
        tarnGrid[k] = id + 1;
        const ki = Math.floor(k / R);
        const kj = k % R;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (ki + a >= 0 && kj + b >= 0 && ki + a < R && kj + b < R && tarnNear[(ki + a) * R + kj + b] === 0) tarnNear[(ki + a) * R + kj + b] = id + 1;
        // (Later traces route over its water as over a flat.)
        cache.set(k, Math.max(G(k), water));
      }
      path.length = hollow.keep;
      for (const k of hollow.route) {
        visit.set(k, st);
        visitAt.set(k, path.length);
        path.push(k);
      }
      runMin = Infinity;
      lowAt.length = 0;
      for (const k of path) {
        if (!(own >= 0 && mask.poolAt(Math.floor(k / R), k % R) === own)) runMin = Math.min(runMin, G(k));
        lowAt.push(Math.min(runMin, level));
      }
      runMin = Math.min(runMin, level);
      cur = path[path.length - 1];
      dir = -1;
      return true;
    };
    for (let step = 0; step < MAX_STEPS; step++) {
      if (step > 0) {
        const e = reached(cur);
        if (e) return { path, end: e, made };
      }
      const ri = Math.floor(cur / R);
      const rj = cur % R;
      if (ri <= 0 || rj <= 0 || ri >= R - 1 || rj >= R - 1) return { path, end: { kind: 'edge', line: -1, idx: 0, pool: -1 }, made };
      report.steps++;
      let next = -1;
      let nextDir = -1;
      if (forcing > 0) {
        // Following the lattice's routing toward its next cell down.
        forcing--;
        const ti = Math.floor(forceTarget / R);
        const tj = forceTarget % R;
        let nd = Infinity;
        for (let r = 0; r < 8; r++) {
          const a = RING[r];
          const q = (ri + DI[a]) * R + rj + DJ[a];
          if (visit.get(q) === st || byHome(q) || crosses(cur, q) || byHigherLake(q) || higherWater(q)) continue;
          const dd = (ri + DI[a] - ti) ** 2 + (rj + DJ[a] - tj) ** 2;
          if (dd < nd) {
            nd = dd;
            next = q;
            nextDir = r;
          }
        }
        if (next === forceTarget) forcing = 0;
        if (next >= 0 && G(next) - runMin > (own < 0 ? FORCE_HEIGHT : FORCE_HEIGHT_OUTLET)) {
          forcing = 0;
          if (fillAt(cur)) continue;
          return { path, end: { kind: 'sink', line: -1, idx: 0, pool: -1, why: 'force-high' }, made };
        }
      } else {
        const g0 = G(cur);
        // Steepest descent, the three directions ahead first (the ground behind and beside was seen from the last
        // point); the rest only when none of them falls.
        let bestSlope = 0;
        const look = (r: number): void => {
          const a = RING[(r + 8) & 7];
          const q = (ri + DI[a]) * R + rj + DJ[a];
          if (blocked(q)) return;
          const slope = (g0 - G(q)) / (DI[a] && DJ[a] ? SQRT2 : 1);
          if (slope > bestSlope) {
            bestSlope = slope;
            next = q;
            nextDir = (r + 8) & 7;
          }
        };
        if (dir >= 0) {
          look(dir);
          look(dir - 1);
          look(dir + 1);
          if (next < 0) for (const r of [dir - 2, dir + 2, dir - 3, dir + 3]) look(r);
        } else for (let r = 0; r < 8; r++) look(r);
        if (next < 0) {
          // A pit (a hollow finer than the lattice): over the lowest neighbour, its water held at the pit's level (the
          // stream cuts a notch through the sill), unless the climb has gone on too long or too high.
          report.pits++;
          let low = Infinity;
          for (let r = 0; r < 8; r++) {
            const a = RING[r];
            const q = (ri + DI[a]) * R + rj + DJ[a];
            if (blocked(q)) continue;
            const g = G(q);
            if (g < low) {
              low = g;
              next = q;
              nextDir = r;
            }
          }
          if (next >= 0 && low - runMin <= CLIMB_HEIGHT) report.floods++;
          else {
            // The lattice's routing (it drains everything to the sea or the edge) shows the way: toward the next cell
            // down its receivers that is not on the course yet.
            report.forced++;
            let c = Math.round(ri / PER_CELL) * n + Math.round(rj / PER_CELL);
            forceTarget = -1;
            for (let hop = 0; hop < 8 && c >= 0; hop++) {
              const r = d.receiver[c];
              if (r < 0) break;
              const tk = Math.floor(r / n) * PER_CELL * R + (r % n) * PER_CELL;
              if (visit.get(tk) !== st) {
                forceTarget = tk;
                break;
              }
              c = r;
            }
            // (Not over a rim much higher than the hollow: its notch would be a slot canyon. The hollow is filled to its
            // sill instead, or where it is too deep or big the water stays in it: the stream ends there.)
            if (forceTarget < 0 || G(forceTarget) - runMin > (own < 0 ? FORCE_HEIGHT : FORCE_HEIGHT_OUTLET)) {
              if (fillAt(cur)) continue;
              return { path, end: { kind: forceTarget < 0 ? 'stuck' : 'sink', line: -1, idx: 0, pool: -1, why: forceTarget < 0 ? 'pit-no-target' : 'pit-deep' }, made };
            }
            forcing = 2 * PER_CELL;
            step--;
            report.steps--;
            continue;
          }
        }
      }
      if (next < 0) {
        // Hemmed in by its own course (a pocket it wound into): the pocket holds water, overflowing at its sill.
        forcing = 0;
        if (fillAt(cur)) continue;
        return { path, end: { kind: 'stuck', line: -1, idx: 0, pool: -1, why: 'no-way' }, made };
      }
      visit.set(next, st);
      visitAt.set(next, path.length);
      path.push(next);
      // (Not the ground in the water it reaches - a lake's bed, a river's valley floor: whether it can flow into that
      // water was decided on the stream's own level, before the step.)
      const into = occ[next] !== 0 || (() => {
        const pl = mask.poolAt(Math.floor(next / R), next % R);
        return pl >= 0 && pl !== own && !mask.pools[pl].drained;
      })();
      if (!into) runMin = Math.min(runMin, G(next));
      lowAt.push(runMin);
      cur = next;
      dir = nextDir;
    }
    return { path, end: { kind: 'stuck', line: -1, idx: 0, pool: -1, why: 'steps' }, made };
  };

  /** The line `line` (river or stream) as arrays. */
  const lineAt = (line: number): ChannelArrays => (line < nR ? rivers[line] : streams[line - nR]);

  /** Build a stream from its traced course and record it. */
  const build = (path: number[], endAt: End, first: { north: number; east: number; level: number } | null, area0: number, pool: number, made: readonly number[] = []): void => {
    const m = path.length;
    let end = endAt;
    // Points: an outlet's first point in its lake, the raster course, a confluence's point on the line it joins; the
    // water at each and the ground it runs through (its cut is the difference).
    const pn: number[] = [];
    const pe: number[] = [];
    const lv: number[] = [];
    const gp: number[] = [];
    if (first) {
      pn.push(first.north);
      pe.push(first.east);
      lv.push(first.level);
      gp.push(first.level + STREAM_DEPTH);
    }
    let run = first ? first.level : Infinity;
    for (let i = 0; i < m; i++) {
      const k = path[i];
      pn.push(ORIGIN + Math.floor(k / R) * LAKE_RASTER);
      pe.push(ORIGIN + (k % R) * LAKE_RASTER);
      run = Math.min(run, G(k) - STREAM_DEPTH);
      lv.push(run);
      gp.push(G(k));
      (pool >= 0 ? report.notchOutlet : report.notch).push(G(k) - run);
    }
    let joins = -1;
    let joinS = 0;
    /** The water it flows into (a line's or a lake's), m; its last reach backs up to it where it came lower. */
    let mouth = -Infinity;
    /** Drop the course's last points within `clear` of (cn, ce): the stream ends short of water it cannot reach. */
    /** Whether the raster point k lies beside a line whose water stands higher than `w` (JOIN_TOL over it). */
    const besideHigher = (k: number, w: number): boolean => {
      const ki = Math.floor(k / R);
      const kj = k % R;
      for (let a = -1; a < 8; a++) {
        const o = occ[a < 0 ? k : (ki + DI[a]) * R + kj + DJ[a]];
        if (o !== 0 && lineAt(occLine(o)).level[occIdx(o)] > w + JOIN_TOL) return true;
      }
      return false;
    };
    const sink = (cn: number, ce: number, clear: number): void => {
      const off = first ? 1 : 0;
      while (pn.length > off + 1 && (Math.hypot(pn[pn.length - 1] - cn, pe[pe.length - 1] - ce) < clear || besideHigher(path[pn.length - 1 - off], lv[lv.length - 1]))) {
        pn.pop();
        pe.pop();
        lv.pop();
        gp.pop();
      }
      report.sinks++;
      end = { kind: 'sink', line: -1, idx: 0, pool: -1 };
    };
    if (end.kind === 'sink') {
      // It came to water lying above its own: it ends short of it.
      if (end.line >= 0) {
        const L = lineAt(end.line);
        report.sinkGap.push(L.level[end.idx] - run);
        report.sinkGapLast.push(L.level[end.idx] - (G(path[m - 1]) - STREAM_DEPTH));
        sink(L.north[end.idx], L.east[end.idx], L.halfWidth[end.idx] + SINK_CLEAR);
      } else if (end.pool < 0) {
        // A hollow it cannot climb out of: it ends in it.
        report.hollows++;
      } else {
        report.sinkGapLake.push(mask.pools[end.pool].level - run);
        sink(pn[pn.length - 1], pe[pe.length - 1], SINK_CLEAR);
      }
    } else if (end.kind === 'channel') {
      const L = lineAt(end.line);
      const j = end.idx;
      if (end.ok || L.level[j] <= run + JOIN_TOL) {
        pn.push(L.north[j]);
        pe.push(L.east[j]);
        lv.push(L.level[j]);
        gp.push(L.level[j] + STREAM_DEPTH);
        mouth = L.level[j];
        joins = end.line;
        joinS = L.s[j];
      } else {
        report.sinkGap.push(L.level[j] - run);
        sink(L.north[j], L.east[j], L.halfWidth[j] + SINK_CLEAR);
      }
    } else if (end.kind === 'lake') {
      const lake = end.tarn !== undefined ? tarns[end.tarn].level : mask.pools[end.pool].level;
      if (!end.ok && run < lake - JOIN_TOL) sink(pn[pn.length - 1], pe[pe.length - 1], SINK_CLEAR);
      else {
        lv[lv.length - 1] = lake;
        mouth = lake;
      }
    } else if (end.kind === 'sea') {
      lv[lv.length - 1] = Math.min(run, 0);
    }
    if (pn.length < 2) return;
    // Smooth the raster's zigzags (the ends stay put), then resample at STREAM_SPACING; each sample keeps its
    // fractional index into the points, for the level.
    let sn = pn.slice();
    let se = pe.slice();
    for (let pass = 0; pass < 2; pass++) {
      const n2 = sn.slice();
      const e2 = se.slice();
      for (let i = 1; i < sn.length - 1; i++) {
        n2[i] = 0.25 * sn[i - 1] + 0.5 * sn[i] + 0.25 * sn[i + 1];
        e2[i] = 0.25 * se[i - 1] + 0.5 * se[i] + 0.25 * se[i + 1];
      }
      sn = n2;
      se = e2;
    }
    const on: number[] = [];
    const oe: number[] = [];
    const ol: number[] = [];
    const og: number[] = [];
    for (let i = 0; i < sn.length - 1; i++) {
      const seg = Math.hypot(sn[i + 1] - sn[i], se[i + 1] - se[i]);
      const steps = Math.max(1, Math.ceil(seg / STREAM_SPACING));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        on.push(sn[i] + (sn[i + 1] - sn[i]) * t);
        oe.push(se[i] + (se[i + 1] - se[i]) * t);
        ol.push(lv[i] + (lv[i + 1] - lv[i]) * t);
        og.push(gp[i] + (gp[i + 1] - gp[i]) * t);
      }
    }
    on.push(sn[sn.length - 1]);
    oe.push(se[se.length - 1]);
    ol.push(lv[lv.length - 1]);
    og.push(gp[gp.length - 1]);
    untangleCourse(on, oe, ol, og);
    const count = on.length;
    const north = Float64Array.from(on);
    const east = Float64Array.from(oe);
    const level = Float64Array.from(ol);
    const s = new Float64Array(count);
    for (let i = 1; i < count; i++) s[i] = s[i - 1] + Math.hypot(north[i] - north[i - 1], east[i] - east[i - 1]);
    // The ground between the raster points: a gully finer than the raster can lie between two of them (the course
    // steps over it). Every LEVEL_EVERY-th sample the ground is looked at again and the water kept under it (not in a
    // lake: the one it leaves or the one it ends in), then the level kept falling.
    const groundAt = (n: number, e: number): number => tarnMask.rim(n, e, p.route(n, e));
    const wetAt = (n: number, e: number): boolean => mask.at(n, e) > -Infinity || tarnMask.at(n, e) > -Infinity;
    /** The samples whose ground was looked at (og then holds it, not the raster points' interpolated). */
    const seen = new Uint8Array(count);
    seen[0] = seen[count - 1] = 1;
    for (let i = 1; i < count - 1; i += LEVEL_EVERY) {
      const g = groundAt(north[i], east[i]);
      report.levelSamples++;
      og[i] = g;
      seen[i] = 1;
      if (g - STREAM_DEPTH >= level[i]) continue;
      if (wetAt(north[i], east[i])) continue;
      level[i] = g - STREAM_DEPTH;
    }
    // And the samples between where the level falls steeply there (a cliff can lie between two looked at).
    for (let i = 2; i < count - 1; i++) {
      if ((i - 1) % LEVEL_EVERY === 0) continue;
      const lo = i - ((i - 1) % LEVEL_EVERY);
      if (level[lo] - level[Math.min(count - 1, lo + LEVEL_EVERY)] < STEEP_RECHECK) continue;
      const g = groundAt(north[i], east[i]);
      report.levelSamples++;
      og[i] = g;
      seen[i] = 1;
      if (g - STREAM_DEPTH >= level[i] || wetAt(north[i], east[i])) continue;
      level[i] = g - STREAM_DEPTH;
    }
    for (let i = 1; i < count; i++) level[i] = Math.min(level[i], level[i - 1]);
    // Where it came down lower than the water it joins (JOIN_TOL at most), its last reach lies at that water's level:
    // backed up and silted to it (the terrain builds its banks up to hold it, heightfield.ts carveNetwork).
    for (let i = count - 1; i >= 0 && level[i] < mouth; i--) level[i] = Math.min(mouth, level[0]);
    // An outlet leaves its lake at the lake's level and keeps it OUTLET_KEEP past the lake's domain (its rim), so it
    // drops away (falls) clear of the lake's water, not in a notch cut down beside it.
    let held = 0;
    if (pool >= 0) {
      const lake = first ? first.level : mask.pools[pool].level;
      let out = -1;
      for (let i = 0; i < count; i++) {
        if (out < 0 && !(mask.at(north[i], east[i]) > -Infinity)) out = i;
        if (out >= 0 && s[i] - s[out] > OUTLET_KEEP) break;
        level[i] = Math.max(level[i], lake);
        held = i + 1;
      }
      for (let i = held; i < count; i++) level[i] = Math.min(level[i], level[i - 1]);
    }
    // Where the water runs well under the ground it crosses (a rim, a sill it has worn through) the ground is worn
    // away broadly: the breach's half-width at each sample (heightfield.ts carveNetwork), and how deep the cut is.
    const cut = new Float64Array(count);
    const breach = new Float64Array(count);
    // (The ground between the samples looked at, interpolated between them.)
    for (let i = 0, a = 0; i < count; i++) {
      if (seen[i]) {
        a = i;
        continue;
      }
      let b = i + 1;
      while (!seen[b]) b++;
      og[i] = og[a] + ((og[b] - og[a]) * (s[i] - s[a])) / Math.max(1e-6, s[b] - s[a]);
    }
    for (let i = 0; i < count; i++) {
      cut[i] = Math.max(0, og[i] - STREAM_DEPTH - level[i]);
      breach[i] = breachOfCut(cut[i]);
    }
    if (pool >= 0) {
      // A lake's outlet: its rim worn down over a width that grows with the lake, from the lake across the rim to where
      // the ground falls below the lake's water, then a scar narrowing down the slope beyond.
      const lake = first ? first.level : mask.pools[pool].level;
      const half = breachOfLake(mask.pools[pool].wet * (LAKE_RASTER / 1000) ** 2);
      let rimEnd = -1;
      for (let i = 0; i < count && rimEnd < 0; i++) if (!(mask.at(north[i], east[i]) > -Infinity) && og[i] < lake - STREAM_DEPTH) rimEnd = i;
      const sRim = rimEnd < 0 ? s[count - 1] : s[rimEnd];
      for (let i = 0; i < count; i++) breach[i] = Math.max(breach[i], half * (1 - smooth(sRim, sRim + BREACH_SCAR, s[i])));
    }
    // (Spread along the line: the widest within two samples, smoothed, so the breach changes width gradually.)
    {
      const w = Float64Array.from(breach);
      for (let i = 0; i < count; i++) for (let k = Math.max(0, i - 2); k <= Math.min(count - 1, i + 2); k++) w[i] = Math.max(w[i], breach[k] * (1 - 0.15 * Math.abs(k - i)));
      for (let i = 0; i < count; i++) breach[i] = (w[Math.max(0, i - 1)] + 2 * w[i] + w[Math.min(count - 1, i + 1)]) / 4;
      for (let i = 0; i < count; i++) if (breach[i] > 0) report.breachSamples++;
    }
    const area = new Float64Array(count);
    // A headwater's catchment as the lattice saw it at its head (minArea or more) comes in over its first HEAD_RAMP:
    // the stream begins as a trickle (its channel above the head is finer than the lattice) and widens as it gathers.
    for (let i = 0; i < count; i++) area[i] = (pool < 0 ? HEAD_START_AREA + (area0 - HEAD_START_AREA) * smooth(0, HEAD_RAMP, s[i]) : area0) + (LATERAL_GAIN * s[i]) / 1000;
    const id = nR + streams.length;
    streams.push({ north, east, level, halfWidth: new Float64Array(count), s, area, breach, cut, joins, joinS, end: end.kind, pool, held });
    report.traced++;
    report.ends[end.kind] = (report.ends[end.kind] ?? 0) + 1;
    if (pool >= 0) report.outletEnds[end.kind] = (report.outletEnds[end.kind] ?? 0) + 1;
    if (pool >= 0 && (end.kind === 'sink' || end.kind === 'stuck')) {
      const why = end.why ?? (end.line >= 0 ? 'beside-line' : end.pool >= 0 ? 'beside-lake' : 'hollow');
      report.outletSinkWhy[why] = (report.outletSinkWhy[why] ?? 0) + 1;
    }
    report.km += s[count - 1] / 1000;
    // Its raster course may be reached by the streams traced after it: each point maps to the sample nearest it (by
    // arc length along the points), and a diagonal step marks a corner too, so no later diagonal step slips across.
    const cum = new Float64Array(pn.length);
    for (let i = 1; i < pn.length; i++) cum[i] = cum[i - 1] + Math.hypot(pn[i] - pn[i - 1], pe[i] - pe[i - 1]);
    const total = cum[pn.length - 1] || 1;
    const off = first ? 1 : 0;
    for (let i = 0; i < m; i++) {
      const idx = Math.min(count - 1, Math.round(((cum[i + off] / total) * (count - 1))));
      mark(path[i], id, idx);
      if (i > 0) {
        const a = path[i - 1];
        const b = path[i];
        const ai = Math.floor(a / R);
        const bj = b % R;
        if (ai !== Math.floor(b / R) && a % R !== bj) mark(ai * R + bj, id, idx);
      }
    }
    // The tarns it filled are its water: a later stream reaching one joins it where its course enters the tarn.
    for (const t of made) {
      let idx = 0;
      for (let i = 0; i < m; i++) {
        if (tarnOf.get(path[i]) === t) {
          idx = Math.min(count - 1, Math.round((cum[i + off] / total) * (count - 1)));
          break;
        }
      }
      tarns[t].line = id;
      tarns[t].idx = idx;
      for (const k of tarnPts[t]) mark(k, id, idx);
    }
  };

  /** Whether raster point k lies in or beside a lake other than `own` whose water stands higher than `level`. */
  const besideLake = (k: number, own: number, level: number): boolean => {
    const ki = Math.floor(k / R);
    const kj = k % R;
    for (let a = -1; a < 8; a++) {
      const pool = a < 0 ? mask.poolAt(ki, kj) : mask.poolAt(ki + DI[a], kj + DJ[a]);
      if (pool >= 0 && pool !== own && !mask.pools[pool].drained && mask.pools[pool].level > level) return true;
    }
    return false;
  };
  /**
   * The lowest way out of pool `id`: its course from its water (first point in the lake) to the first point beyond
   * its sill lower than its level, or to what it reaches first (a channel, another lake, the sea; `end`). Null when
   * none is found within OUTLET_FLOOD points.
   */
  const outletHeap = new MinHeap(4096);
  const outletPath = (id: number): { path: number[]; end: End | null } | null => {
    const pool = mask.pools[id];
    const ground = (k: number): number => {
      const g = mask.rasterGround(Math.floor(k / R), k % R);
      return g === g ? g : G(k);
    };
    const parent = new Map<number, number>();
    const pts = mask.poolPoints(id);
    if (outletHeap.capacity < pts.length * 9 + OUTLET_FLOOD * 8) outletHeap.grow(pts.length * 9 + OUTLET_FLOOD * 8);
    outletHeap.size = 0;
    const key = new Map<number, number>();
    const own = new Set(pts);
    for (const k of pts) {
      parent.set(k, -1);
      key.set(k, pool.level);
      outletHeap.push(k, pool.level);
    }
    for (let pops = 0; outletHeap.size > 0 && pops < OUTLET_FLOOD + pts.length; pops++) {
      const k = outletHeap.pop();
      const kk = key.get(k) as number;
      // (The flood is minimax: past OUTLET_SILL over the water every way out is higher. The lake has no outlet a
      // stream could cut: a notch deeper than that would be a slot canyon, kilometres long through the hills.)
      if (kk > pool.level + OUTLET_SILL) {
        report.outletHigh++;
        return null;
      }
      if (!own.has(k)) {
        const o = occ[k];
        let end: End | null = null;
        if (o !== 0) end = { kind: 'channel', line: occLine(o), idx: occIdx(o), pool: -1 };
        else {
          const other = mask.poolAt(Math.floor(k / R), k % R);
          if (other >= 0 && other !== id && !mask.pools[other].drained) end = { kind: 'lake', line: -1, idx: 0, pool: other };
          else if (ground(k) <= 0.5) end = { kind: 'sea', line: -1, idx: 0, pool: -1 };
        }
        if (end || ground(k) < pool.level - STREAM_DEPTH) {
          const back: number[] = [];
          for (let q = k; q >= 0; q = parent.get(q) as number) back.push(q);
          back.reverse();
          // From the last point in the lake.
          let f = 0;
          for (let i = 0; i < back.length; i++) if (own.has(back[i])) f = i;
          report.outletSill.push(kk - pool.level);
          return { path: back.slice(f), end };
        }
      }
      const ki = Math.floor(k / R);
      const kj = k % R;
      if (ki <= 0 || kj <= 0 || ki >= R - 1 || kj >= R - 1) continue;
      for (let a = 0; a < 8; a++) {
        const q = (ki + DI[a]) * R + kj + DJ[a];
        if (parent.has(q) || byHome(q) || besideLake(q, id, pool.level)) continue;
        parent.set(q, k);
        const kq = own.has(q) ? pool.level : Math.max(kk, ground(q));
        key.set(q, kq);
        outletHeap.push(q, kq);
      }
    }
    return null;
  };

  // --- Lake outlets: every pool that stands with no river through it, from its spill point.
  const pondArea = (k: number): number => d.lakes[k].area;
  const poolsBySize = mask.pools.map((_, i) => i).filter((i) => !mask.pools[i].drained);
  report.pools = poolsBySize.length;
  poolsBySize.sort((a, b) => pondArea(mask.pools[b].lake) - pondArea(mask.pools[a].lake) || mask.pools[b].wet - mask.pools[a].wet || a - b);
  for (const id of poolsBySize) {
    const pool = mask.pools[id];
    if (p.riverPools[id]) {
      report.riverPools++;
      continue;
    }
    // The lowest way out of the lake over the ground (a priority flood from its water, minimax): to the first point
    // lower than its water, a channel, another lake or the sea. Its sill may stand over the water (the lake was flooded
    // on the ground without its gullies): the stream cuts a notch through it.
    const out = outletPath(id);
    if (!out) {
      report.outletNone++;
      continue;
    }
    if (out.end && out.end.kind === 'lake') report.outletToLake++;
    if (out.end && out.end.kind === 'sea') report.outletToSea++;
    const k0 = out.path[0];
    const first = { north: ORIGIN + Math.floor(k0 / R) * LAKE_RASTER, east: ORIGIN + (k0 % R) * LAKE_RASTER, level: pool.level };
    // (At the edge of its domain the water drawn there may be a lower pool's, beside it: the outlet leaves at that.)
    const drawn = mask.at(first.north, first.east, G(k0));
    if (drawn > -Infinity) first.level = Math.min(first.level, drawn);
    const main = mask.main[pool.lake] === id;
    // The pond's catchment drains through its main pool; a sub-basin's is a share of it.
    const a0 = main ? pondArea(pool.lake) : Math.min(pondArea(pool.lake), minArea);
    // (Straight into another lake or onto the sea: the short reach between, its end in that water.)
    const t = out.end ? { path: out.path.slice(1), end: { ...out.end, ok: true }, made: [] as number[] } : trace(out.path.slice(1), id, pool.level);
    report.outlets++;
    report.outletSteps += t.path.length;
    build(t.path, t.end, first, Math.max(1, a0), id, t.made);
  }

  report.tracePhases.push(performance.now() - t0);
  report.outletSamples = report.samples;
  // --- Headwaters: the lattice cells whose catchment reaches minArea (but not RIVER_AREA) whose donors' do not.
  const N = n * n;
  const hasDonor = new Uint8Array(N);
  for (let c = 0; c < N; c++) {
    const r = d.receiver[c];
    if (r >= 0 && d.area[c] >= minArea) hasDonor[r] = 1;
  }
  const heads: number[] = [];
  for (let c = 0; c < N; c++) if (d.area[c] >= minArea && d.area[c] < RIVER_AREA && !hasDonor[c] && d.receiver[c] >= 0) heads.push(c);
  heads.sort((a, b) => d.area[b] - d.area[a] || a - b);
  report.heads = heads.length;
  for (const c of heads) {
    const k = Math.floor(c / n) * PER_CELL * R + (c % n) * PER_CELL;
    const ki = Math.floor(k / R);
    const kj = k % R;
    if (occ[k] !== 0 || mask.poolAt(ki, kj) >= 0 || byHome(k) || G(k) <= 0.5) continue;
    const t = trace([k], -1, G(k));
    build(t.path, t.end, null, d.area[c], -1, t.made);
  }

  report.tracePhases.push(performance.now() - t0);
  // --- A tarn whose rim a channel runs through lower than its water (a stream traced before it, cutting along its
  // shore; its own overflow come back past it) drains to that channel: its water lowered to stand TARN_OVER over the
  // lowest such, its raster points cut to those under that, and its overflow stream's water through it lowered with it.
  {
    const lowest = new Float64Array(tarns.length).fill(Infinity);
    const sampleAt = (n: number, e: number): number => Math.round((n - ORIGIN) / LAKE_RASTER) * R + Math.round((e - ORIGIN) / LAKE_RASTER);
    const scan = (L: ChannelArrays): void => {
      for (let i = 0; i < L.level.length; i++) {
        // (Any tarn round the raster cell the sample lies in, its own water aside.)
        const ci = Math.floor((L.north[i] - ORIGIN) / LAKE_RASTER);
        const cj = Math.floor((L.east[i] - ORIGIN) / LAKE_RASTER);
        if (ci < 0 || cj < 0 || ci >= R - 1 || cj >= R - 1) continue;
        const k0 = ci * R + cj;
        if (tarnNear[k0] === 0 && tarnNear[k0 + 1] === 0 && tarnNear[k0 + R] === 0 && tarnNear[k0 + R + 1] === 0) continue;
        if (tarnGrid[sampleAt(L.north[i], L.east[i])] > 0) continue;
        for (let c = 0; c < 4; c++) {
          const t = tarnNear[k0 + (c & 1) + (c >> 1) * R] - 1;
          if (t >= 0 && L.level[i] < tarns[t].level - TARN_BREACHED) lowest[t] = Math.min(lowest[t], L.level[i]);
        }
      }
    };
    for (const L of rivers) scan(L);
    for (const L of streams) scan(L);
    /** Lower tarn t's water to `water`: its points over that dry, its overflow stream's water through it lowered. */
    const drain = (t: number, water: number): void => {
      if (!(water < tarns[t].level)) return;
      report.tarnsDrained++;
      tarns[t].level = water;
      let left = 0;
      for (const k of tarnPts[t]) {
        if (tarnGrid[k] - 1 !== t) continue;
        if ((ground0.get(k) ?? G(k)) >= water) tarnGrid[k] = 0;
        else left++;
      }
      tarns[t].points = left;
      const line = tarns[t].line - nR;
      if (line < 0) return;
      const st = streams[line];
      for (let i = 0; i < st.level.length; i++) {
        const k = sampleAt(st.north[i], st.east[i]);
        const before = st.level[i];
        if (k >= 0 && k < R * R && tarnNear[k] - 1 === t) st.level[i] = Math.min(st.level[i], water - STREAM_DEPTH);
        if (i > 0) st.level[i] = Math.min(st.level[i], st.level[i - 1]);
        if (st.level[i] < before) {
          st.cut[i] += before - st.level[i];
          st.breach[i] = Math.max(st.breach[i], breachOfCut(st.cut[i]));
        }
      }
    };
    for (let t = 0; t < tarns.length; t++) if (lowest[t] < Infinity) drain(t, lowest[t] + TARN_OVER);
    // A tarn's rim as its ground lies (a tarn filled beside it raised the routing ground over its points, and it may
    // have drained since): where it is lower than the water, the tarn drains to it. Repeated, as one draining can
    // lower another's rim.
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (let t = 0; t < tarns.length; t++) {
        if (tarns[t].points === 0) continue;
        let rim = Infinity;
        for (const k of tarnPts[t]) {
          if (tarnGrid[k] - 1 !== t) continue;
          const ki = Math.floor(k / R);
          const kj = k % R;
          for (let a = 0; a < 8; a++) {
            const q = (ki + DI[a]) * R + kj + DJ[a];
            if (tarnGrid[q] - 1 === t) continue;
            // (Another tarn's water beside it is its rim at that level; a channel's course is its overflow.)
            const o = tarnGrid[q] - 1;
            // (Only ground already sampled: the tarn's flood sampled every point round what it filled.)
            const g = o >= 0 ? tarns[o].level : occ[q] !== 0 ? Infinity : (ground0.get(q) ?? cache.get(q) ?? Infinity);
            rim = Math.min(rim, g);
          }
        }
        if (rim < tarns[t].level - 1) {
          drain(t, rim - TARN_BELOW);
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  report.tarnsWet = tarns.filter((t) => t.points > 0).length;
  // --- Catchment summed down the network: each stream's own (its source and what it gathers), plus every stream
  // that joins it from its confluence on (latest first: a stream only ever joins one traced before it).
  for (let j = streams.length - 1; j >= 0; j--) {
    const st = streams[j];
    if (st.joins >= nR) {
      const P = streams[st.joins - nR];
      const add = st.area[st.area.length - 1];
      for (let i = 0; i < P.s.length; i++) if (P.s[i] >= st.joinS - 1e-6) P.area[i] += add;
    }
  }
  /** The furthest down each stream another joins it, m. */
  const lastJoin = new Float64Array(streams.length).fill(-Infinity);
  for (const st of streams) if (st.joins >= nR) lastJoin[st.joins - nR] = Math.max(lastJoin[st.joins - nR], st.joinS);
  for (let j = 0; j < streams.length; j++) {
    const st = streams[j];
    for (let i = 0; i < st.area.length; i++) st.halfWidth[i] = channelHalfWidth(st.area[i]);
    // A stream that ends in a hollow (it sinks into the ground there) dwindles over its last SINK_TAPER rather than
    // stopping at its full width.
    if (st.end !== 'sink' && st.end !== 'stuck') continue;
    // (Below the last stream joining it: never narrower than what joins it.)
    const sEnd = st.s[st.s.length - 1];
    const s0 = Math.max(sEnd - SINK_TAPER, lastJoin[j] + 50);
    if (s0 >= sEnd - 50) continue;
    // (Never narrower than its head: a line ends at least as wide as it starts.)
    const hw0 = st.halfWidth[0];
    for (let i = 0; i < st.s.length; i++) st.halfWidth[i] = Math.max(hw0, st.halfWidth[i] * (1 - (1 - SINK_END) * smooth(s0, sEnd, st.s[i])));
  }
  report.ms = performance.now() - t0;
  return { streams, report, tarns: tarnMask };
}

/**
 * Cut out any loop where a course crosses itself (the smoothing can fold a hairpin of the raster course over): from
 * the first segment that a later one crosses, straight to the crossing and on along the later one (in place). The
 * water keeps the lower level there.
 */
function untangleCourse(n: number[], e: number[], lv: number[], gr: number[]): void {
  const CELL = 100;
  for (let pass = 0; pass < 8; pass++) {
    const grid = new Map<number, number[]>();
    const key = (a: number, b: number): number => (Math.floor(a / CELL) + 32768) * 65536 + (Math.floor(b / CELL) + 32768);
    for (let i = 0; i < n.length - 1; i++) {
      const k = key(n[i], e[i]);
      const l = grid.get(k);
      if (l) l.push(i);
      else grid.set(k, [i]);
    }
    let cut = false;
    for (let i = 0; i < n.length - 1 && !cut; i++) {
      let hit = -1;
      let t = 0;
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          for (const j of grid.get(key(n[i] + a * CELL, e[i] + b * CELL)) ?? []) {
            if (j <= i + 1 || j <= hit) continue;
            const px = e[i], py = n[i], qx = e[i + 1] - px, qy = n[i + 1] - py;
            const rx = e[j], ry = n[j], sx = e[j + 1] - rx, sy = n[j + 1] - ry;
            const den = qx * sy - qy * sx;
            if (Math.abs(den) < 1e-12) continue;
            const tt = ((rx - px) * sy - (ry - py) * sx) / den;
            const uu = ((rx - px) * qy - (ry - py) * qx) / den;
            if (tt > 0 && tt < 1 && uu > 0 && uu < 1) {
              hit = j;
              t = tt;
            }
          }
        }
      }
      if (hit < 0) continue;
      const xn = n[i] + t * (n[i + 1] - n[i]);
      const xe = e[i] + t * (e[i + 1] - e[i]);
      const xl = Math.min(lv[i] + t * (lv[i + 1] - lv[i]), lv[hit + 1]);
      const xg = gr[i] + t * (gr[i + 1] - gr[i]);
      n.splice(i + 1, hit - i, xn);
      e.splice(i + 1, hit - i, xe);
      lv.splice(i + 1, hit - i, xl);
      gr.splice(i + 1, hit - i, xg);
      cut = true;
    }
    if (!cut) return;
  }
}

/** Kinds of flow (FlowArrays.regime). */
export const REGIME = { placid: 0, riffle: 1, rapids: 2, steppool: 3, fall: 4 } as const;
/** Smoothed gradient at the upper bound of placid, riffle and rapids flow (beyond: step-pool and boulder cascades). */
export const REGIME_GRADIENT = [0.005, 0.02, 0.08] as const;
/** A fall's face spans this much ground along the channel, m (its lip and foot are that far apart). */
export const FALL_RUN = 3;
/** Gradient window, m (either side half of it). */
const GRADIENT_WINDOW = 200;

/** Where a waterfall comes from (falls.ts): a fault the channel crosses, the lip of a hanging valley, a lake's outlet. */
export type FallCause = 'fault' | 'hanging' | 'outlet';

/**
 * A waterfall: where a channel's water drops at once, its lip at sample `index` of its line and its foot at the next
 * sample (index + 1), FALL_RUN or a little more downstream (falls.ts cutFall).
 */
export interface Fall {
  /** The line (index into Hydrology.rivers) and the sample at its lip (the foot is the next sample). */
  line: number;
  index: number;
  /** The lip, m. */
  north: number;
  east: number;
  /** The foot (where the water lands), m. */
  footNorth: number;
  footEast: number;
  /** Water level at the lip and at the foot (the pool), m; height = top - bottom. */
  top: number;
  bottom: number;
  height: number;
  /** Width of the water going over, m. */
  width: number;
  /** Flow direction (unit, north and east). */
  dirN: number;
  dirE: number;
  cause: FallCause;
  /** Several falls of one flight (a fault's throw over ~15 m) share a flight number (-1: a fall on its own). */
  flight: number;
}

/** A steep stretch (falling more than PIECE_GRADIENT) is cut into pieces falling at most PIECE_STEP each, m, their
 * water kept under the ground. */
const PIECE_STEP = 4;
const PIECE_GRADIENT = 0.2;
/** The water stands this far under the ground at each piece's point, m. */
const PIECE_DEPTH = 1;
/** Most pieces one segment is cut into. */
const PIECES_MAX = 64;

/**
 * A steep channel is a continuous cascade: its water follows the ground down. Between two samples falling more than
 * PIECE_STEP (and PIECE_GRADIENT) the ground can bulge over the straight line between them (a convex pitch), so such a segment is cut into
 * pieces, the water at each kept PIECE_DEPTH under `ground` (never under the segment's lower end), and the level kept
 * falling. Skips the segments between samples flagged in `keep` (a lake). Returns the arrays with the pieces inserted
 * (every per-sample array of `a` that has the level's length).
 */
export function refineSteep(a: Record<string, Float64Array> & { level: Float64Array; s: Float64Array; north: Float64Array; east: Float64Array }, keep: Uint8Array | undefined, ground: (north: number, east: number) => number): Record<string, Float64Array> {
  const n0 = a.level.length;
  const keys = Object.keys(a).filter((k) => a[k].length === n0);
  const pieces = new Int32Array(n0);
  let total = n0;
  for (let i = 0; i < n0 - 1; i++) {
    pieces[i] = 1;
    if (keep?.[i] && keep[i + 1]) continue;
    const D = a.level[i] - a.level[i + 1];
    const ds = a.s[i + 1] - a.s[i];
    if (D > PIECE_STEP && D > PIECE_GRADIENT * ds) {
      pieces[i] = Math.min(PIECES_MAX, Math.ceil(D / PIECE_STEP));
      total += pieces[i] - 1;
    }
  }
  if (total === n0) return a;
  const out: Record<string, Float64Array> = {};
  for (const k of keys) out[k] = new Float64Array(total);
  let o = 0;
  for (let i = 0; i < n0; i++) {
    const p = i < n0 - 1 ? pieces[i] : 1;
    const lEnd = i < n0 - 1 ? a.level[i + 1] : a.level[i];
    for (let q = 0; q < p; q++) {
      const t = q / p;
      for (const k of keys) out[k][o] = q === 0 ? a[k][i] : a[k][i] + (a[k][i + 1] - a[k][i]) * t;
      if (q > 0) out.level[o] = Math.max(lEnd, Math.min(out.level[o], ground(out.north[o], out.east[o]) - PIECE_DEPTH));
      if (o > 0) out.level[o] = Math.min(out.level[o], out.level[o - 1]);
      o++;
    }
  }
  return out;
}

/** Per-sample flow of a channel: gradient over GRADIENT_WINDOW, steepness 0-1, kind of flow, speed. */
export interface FlowArrays {
  gradient: Float32Array;
  steepness: Float32Array;
  regime: Uint8Array;
  speed: Float32Array;
}

/** Steepness 0-1 for a gradient: a quarter per kind of flow (placid, riffle, rapids, step-pool up to 25 %). */
export function steepnessOf(g: number): number {
  const [a, b, c] = REGIME_GRADIENT;
  if (g < a) return (0.25 * Math.max(0, g)) / a;
  if (g < b) return 0.25 + (0.25 * (g - a)) / (b - a);
  if (g < c) return 0.5 + (0.25 * (g - b)) / (c - b);
  return 0.75 + 0.25 * Math.min(1, (g - c) / 0.17);
}

/**
 * The flow along a channel: the water's gradient over GRADIENT_WINDOW about each sample, its kind (REGIME; a fall's lip
 * is a fall) and speed (Manning: depth from the width, roughness from the steepness), m/s.
 */
export function flowOf(c: { level: Float64Array; halfWidth: Float64Array; s: Float64Array }, lips: ReadonlyArray<number>): FlowArrays {
  const n = c.s.length;
  const gradient = new Float32Array(n);
  const steepness = new Float32Array(n);
  const regime = new Uint8Array(n);
  const speed = new Float32Array(n);
  const h = GRADIENT_WINDOW / 2;
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    while (lo < i && c.s[i] - c.s[lo] > h) lo++;
    while (hi < n - 1 && c.s[hi + 1] - c.s[i] <= h) hi++;
    const run = c.s[hi] - c.s[lo];
    const g = run > 1 ? Math.max(0, (c.level[lo] - c.level[hi]) / run) : 0;
    gradient[i] = g;
    steepness[i] = steepnessOf(g);
    const [a, b, cc] = REGIME_GRADIENT;
    regime[i] = g < a ? REGIME.placid : g < b ? REGIME.riffle : g < cc ? REGIME.rapids : REGIME.steppool;
    const depth = 0.25 + 0.06 * c.halfWidth[i];
    const rough = 0.03 + 0.04 * steepness[i];
    speed[i] = Math.min(6, Math.max(0.1, (Math.cbrt(depth * depth) * Math.sqrt(Math.max(g, 0.0003))) / rough));
  }
  for (const k of lips) regime[k] = REGIME.fall;
  return { gradient, steepness, regime, speed };
}

/** Grid index of the falls, for fallsNear. */
export class FallIndex {
  private readonly cells = new Map<number, number[]>();
  constructor(private readonly falls: ReadonlyArray<Fall>, private readonly cell = 1000) {
    falls.forEach((f, i) => {
      const k = (Math.floor(f.north / cell) + 32768) * 65536 + Math.floor(f.east / cell) + 32768;
      const l = this.cells.get(k);
      if (l) l.push(i);
      else this.cells.set(k, [i]);
    });
  }
  /** The falls within `radius` of a point (indices into the list, nearest first); returns how many were written. */
  near(north: number, east: number, radius: number, out: number[]): number {
    const c = this.cell;
    const found: Array<[number, number]> = [];
    for (let a = Math.floor((north - radius) / c); a <= Math.floor((north + radius) / c); a++) {
      for (let b = Math.floor((east - radius) / c); b <= Math.floor((east + radius) / c); b++) {
        const l = this.cells.get((a + 32768) * 65536 + b + 32768);
        if (!l) continue;
        for (const i of l) {
          const f = this.falls[i];
          const d2 = (f.north - north) ** 2 + (f.east - east) ** 2;
          if (d2 <= radius * radius) found.push([d2, i]);
        }
      }
    }
    found.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    out.length = 0;
    for (const [, i] of found) out.push(i);
    return out.length;
  }
}

/** Smooth step, for the river heads' taper (riverNetwork.ts). */
export const smoothStep = smooth;

/** A tarn: a closed hollow on a stream's course whose sill was too high to wear through, filled with water to it. */
export interface Tarn {
  /** Its water's level, and the floor of its hollow (the lowest routing ground in it), m. */
  level: number;
  floor: number;
  /** Raster points it spans. */
  points: number;
  /** The stream that fills and overflows it (index into the network's lines; -1 none drawn) and the sample where that
   * stream's course enters it. */
  line: number;
  idx: number;
}

/** A tarn's shore: the ground in the raster cells round its edge is kept at least this over its water at the
 * smoothed corner weight RIM_W, shelving to RIM_DEEP under it at the weight 1, m; raised at most RIM_MAX. */
const RIM_TOP = 0.4;
const RIM_W = 0.45;
const RIM_SLOPE = 8;
const RIM_DEEP = 3;
const RIM_MAX = 120;

/**
 * The tarns streams.ts filled: each a set of points of the 250 m lake raster with the level of its water. A point lies
 * in a tarn where the smoothstep-weighted bilinear share of its cell's corners in it is at least a half (`at`); round
 * the edge the ground is shaped into a shore (`rim`: raised where it dips under the water outside, so the water never
 * stands against lower ground).
 */
export class TarnMask {
  /** The field at the last point `at` found in a tarn: how far inside its edge, m (0 elsewhere). */
  field = 0;
  private w = 0;
  private id = -1;
  /** `grid`: each raster point's tarn + 1 (0: none). */
  constructor(private readonly grid: Int16Array, readonly tarns: ReadonlyArray<Tarn>, private readonly near: Int16Array) {}
  /**
   * How far the terrain at the point keeps to the ground the streams were routed over (without the small-scale relief
   * and finest gullies: heightfield.ts takes them away), 0-1: over a tarn and the raster ring round it, fading over the
   * next cell. The tarn was found on that ground: a fine gully the routing never saw would drain it through its rim.
   */
  calm(north: number, east: number): number {
    if (this.tarns.length === 0) return 0;
    const x = (east - ORIGIN) / LAKE_RASTER;
    const y = (north - ORIGIN) / LAKE_RASTER;
    const j = Math.floor(x);
    const i = Math.floor(y);
    if (i < 0 || j < 0 || i >= RASTER_N - 1 || j >= RASTER_N - 1) return 0;
    const k = i * RASTER_N + j;
    const g = this.near;
    if (g[k] === 0 && g[k + 1] === 0 && g[k + RASTER_N] === 0 && g[k + RASTER_N + 1] === 0) return 0;
    const tx = smooth(0, 1, x - j);
    const ty = smooth(0, 1, y - i);
    return (g[k] ? (1 - tx) * (1 - ty) : 0) + (g[k + 1] ? tx * (1 - ty) : 0) + (g[k + RASTER_N] ? (1 - tx) * ty : 0) + (g[k + RASTER_N + 1] ? tx * ty : 0);
  }
  get size(): number {
    return this.tarns.length;
  }
  /** The weight of the highest tarn among the corners of the point's cell (w, id); false when none. */
  private look(north: number, east: number): boolean {
    if (this.tarns.length === 0) return false;
    const x = (east - ORIGIN) / LAKE_RASTER;
    const y = (north - ORIGIN) / LAKE_RASTER;
    const j = Math.floor(x);
    const i = Math.floor(y);
    if (i < 0 || j < 0 || i >= RASTER_N - 1 || j >= RASTER_N - 1) return false;
    const k = i * RASTER_N + j;
    const g = this.grid;
    const c00 = g[k] - 1;
    const c01 = g[k + 1] - 1;
    const c10 = g[k + RASTER_N] - 1;
    const c11 = g[k + RASTER_N + 1] - 1;
    if (c00 < 0 && c01 < 0 && c10 < 0 && c11 < 0) return false;
    // The tarn with the most weight among the corners (two tarns can share a cell).
    const tx = smooth(0, 1, x - j);
    const ty = smooth(0, 1, y - i);
    const w00 = (1 - tx) * (1 - ty);
    const w01 = tx * (1 - ty);
    const w10 = (1 - tx) * ty;
    const w11 = tx * ty;
    this.w = 0;
    this.id = -1;
    for (let q = 0; q < 4; q++) {
      const c = q === 0 ? c00 : q === 1 ? c01 : q === 2 ? c10 : c11;
      if (c < 0 || c === this.id) continue;
      const w = (c00 === c ? w00 : 0) + (c01 === c ? w01 : 0) + (c10 === c ? w10 : 0) + (c11 === c ? w11 : 0);
      if (w > this.w) {
        this.w = w;
        this.id = c;
      }
    }
    return this.id >= 0;
  }
  /** The level of the tarn whose shore or water the point lies in (any corner of its cell), -Infinity: none. */
  rimLevel(north: number, east: number): number {
    return this.look(north, east) ? this.tarns[this.id].level : -Infinity;
  }
  /** The level of the tarn whose water may cover the point (-Infinity: none); leaves `field`. */
  at(north: number, east: number): number {
    this.field = 0;
    if (!this.look(north, east) || this.w < 0.5) return -Infinity;
    this.field = (this.w - 0.5) * LAKE_RASTER;
    return this.tarns[this.id].level;
  }
  /** The ground h at the point with the tarns' shores laid over it. */
  rim(north: number, east: number, h: number): number {
    if (!this.look(north, east)) return h;
    const lv = this.tarns[this.id].level;
    const g = Math.max(lv - RIM_DEEP, Math.min(lv + RIM_TOP, lv + RIM_TOP - RIM_SLOPE * (this.w - RIM_W)));
    // (Only round the edge: the raise fades in from the outer corners and out toward the water's middle.)
    return h + Math.min(RIM_MAX, Math.max(0, g - h)) * smooth(0, 0.15, this.w) * (1 - smooth(0.6, 0.95, this.w));
  }
}
