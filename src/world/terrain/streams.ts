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
// rises); where the climb would go on too high the lattice's own routing shows the way. A lake's outlet leaves by the
// lowest way out of its basin (a priority flood from its water). Water lying higher than the stream's own (a river
// held up on its valley floor, a lake flooded on smoother ground) is not entered: the stream ends short of it.
//
// A stream is a cheap class: no meanders, no floodplain or valley, just a narrow notch (heightfield.ts carveNetwork).
// Its water follows the ground down (the running minimum of the ground along its course, a little under it, looked at
// again between the raster points), its width grows with the catchment (summed at each confluence: a step up), and
// where the ground falls too steeply for a cascade its descent is a flight of small falls with pools between
// (applyFalls, also on the rivers' channels).

import { DOMAIN_HALF, DRAIN_CELL, LAKE_RASTER, MinHeap, RASTER_N, RIVER_AREA, type Drainage, type LakeMask } from './drainage';
import { hash2i } from './noise';
import { AIRPORT } from '../../core/world';

/** Catchment, km², from which a headwater stream is drawn (the lattice cells reaching it whose donors do not). */
export const STREAM_AREA = 30;
/** Water stands this far under the ground at each raster point of a stream's course, m. */
const STREAM_DEPTH = 1.0;
/** Catchment a stream gathers along its course from the slopes either side, km² per km. */
const LATERAL_GAIN = 2;
/** A headwater stream starts as if draining this much, km² (about 1.2 m half-width), and gathers its head cell's
 * catchment over HEAD_RAMP, m. */
const HEAD_START_AREA = 6;
const HEAD_RAMP = 2000;
/** The ground under every this many stream samples is checked for a dip between the raster points. */
const LEVEL_EVERY = 2;
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
/** An outlet keeps its lake's level this far past the lake's domain, m. */
const OUTLET_KEEP = 60;
/** A stream climbs out of a pit over its lowest neighbour at most this high over the lowest ground on its course so
 * far, m; beyond, it follows the lattice's routing. */
const CLIMB_HEIGHT = 25;
/** Nor does a headwater follow the lattice's routing over ground higher than FORCE_HEIGHT over that lowest ground, m:
 * it ends in the hollow instead (a sink). A lake's outlet goes on over up to FORCE_HEIGHT_OUTLET (its lake drains that
 * way on the lattice): it cuts a gorge through the rim. */
const FORCE_HEIGHT = 40;
const FORCE_HEIGHT_OUTLET = 120;
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
  forced: number;
  samples: number;
  ms: number;
  /** Ground samples taken by the outlets. */
  outletSamples: number;
  /** Time to the end of the river marking, the outlets, the headwaters, ms. */
  tracePhases: number[];
  /** riverNetwork.ts's own phases (river falls, tracing and the streams' falls, flow, index), ms. */
  phases?: number[];
}

/**
 * Trace the streams of a seeded world. `ground` is the terrain they run on (detailed, with the rivers' valleys);
 * `rivers` the river network's channels (their levels final); `riverPools` flags the lake pools a river runs through.
 */
export function traceStreams(p: { d: Drainage; mask: LakeMask; route: (north: number, east: number) => number; rivers: ReadonlyArray<ChannelArrays>; riverPools: Uint8Array; minArea?: number }): { streams: StreamLine[]; report: StreamReport } {
  const t0 = performance.now();
  const { d, mask, rivers } = p;
  const minArea = p.minArea ?? STREAM_AREA;
  const n = d.n;
  const R = RASTER_N;
  const nR = rivers.length;
  const report: StreamReport = { pools: 0, riverPools: 0, outlets: 0, outletToLake: 0, outletToSea: 0, outletNone: 0, heads: 0, traced: 0, ends: {}, outletEnds: {}, km: 0, steps: 0, outletSteps: 0, levelSamples: 0, notch: [], notchOutlet: [], pits: 0, sinks: 0, sinkGap: [], sinkGapLake: [], sinkGapLast: [], hollows: 0, floods: 0, forced: 0, samples: 0, ms: 0, tracePhases: [], outletSamples: 0 };

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

  /** What a course reached; `ok` when the trace found it can flow into it (canReach). */
  type End = { kind: StreamLine['end']; line: number; idx: number; pool: number; ok?: boolean };
  /**
   * Steepest descent from raster point `start`, never into `own` pool. Returns the course (raster indices, start
   * first) and what it reached. (report.floods counts the climbs over a pit's sill.)
   */
  const trace = (prefix: number[], own: number, level: number): { path: number[]; end: End } => {
    const st = ++stamp;
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
      if (G(k) <= 0.5) return { kind: 'sea', line: -1, idx: 0, pool: -1 };
      return null;
    };
    /** Whether k lies in or beside another lake whose water stands higher than the stream's (it would cut a notch
     * beside that water). */
    const byHigherLake = (k: number): boolean => besideLake(k, own, runMin - STREAM_DEPTH + JOIN_TOL + BACKUP_FILL);
    const blocked = (k: number): boolean => visit.get(k) === st || (own >= 0 && mask.poolAt(Math.floor(k / R), k % R) === own) || byHome(k) || crosses(cur, k) || byHigherLake(k);
    // The direction of the last step (index into RING), -1 before the first; climbs over sills since the last descent.
    let dir = -1;
    let forcing = 0;
    let forceTarget = -1;
    for (let step = 0; step < MAX_STEPS; step++) {
      if (step > 0) {
        const e = reached(cur);
        if (e) return { path, end: e };
      }
      const ri = Math.floor(cur / R);
      const rj = cur % R;
      if (ri <= 0 || rj <= 0 || ri >= R - 1 || rj >= R - 1) return { path, end: { kind: 'edge', line: -1, idx: 0, pool: -1 } };
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
          if (visit.get(q) === st || byHome(q) || crosses(cur, q) || byHigherLake(q)) continue;
          const dd = (ri + DI[a] - ti) ** 2 + (rj + DJ[a] - tj) ** 2;
          if (dd < nd) {
            nd = dd;
            next = q;
            nextDir = r;
          }
        }
        if (next === forceTarget) forcing = 0;
        if (next >= 0 && G(next) - runMin > (own < 0 ? FORCE_HEIGHT : FORCE_HEIGHT_OUTLET)) return { path, end: { kind: 'sink', line: -1, idx: 0, pool: -1 } };
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
            if (forceTarget < 0) return { path, end: { kind: 'stuck', line: -1, idx: 0, pool: -1 } };
            // (Not over a rim much higher than the hollow: its notch would be a slot canyon. The water stays in the
            // hollow: the stream ends there.)
            if (G(forceTarget) - runMin > (own < 0 ? FORCE_HEIGHT : FORCE_HEIGHT_OUTLET)) return { path, end: { kind: 'sink', line: -1, idx: 0, pool: -1 } };
            forcing = 2 * PER_CELL;
            step--;
            report.steps--;
            continue;
          }
        }
      }
      if (next < 0) return { path, end: { kind: 'stuck', line: -1, idx: 0, pool: -1 } };
      visit.set(next, st);
      visitAt.set(next, path.length);
      path.push(next);
      runMin = Math.min(runMin, G(next));
      lowAt.push(runMin);
      cur = next;
      dir = nextDir;
    }
    return { path, end: { kind: 'stuck', line: -1, idx: 0, pool: -1 } };
  };

  /** The line `line` (river or stream) as arrays. */
  const lineAt = (line: number): ChannelArrays => (line < nR ? rivers[line] : streams[line - nR]);

  /** Build a stream from its traced course and record it. */
  const build = (path: number[], endAt: End, first: { north: number; east: number; level: number } | null, area0: number, pool: number): void => {
    const m = path.length;
    let end = endAt;
    // Points: an outlet's first point in its lake, the raster course, a confluence's point on the line it joins.
    const pn: number[] = [];
    const pe: number[] = [];
    const lv: number[] = [];
    if (first) {
      pn.push(first.north);
      pe.push(first.east);
      lv.push(first.level);
    }
    let run = first ? first.level : Infinity;
    for (let i = 0; i < m; i++) {
      const k = path[i];
      pn.push(ORIGIN + Math.floor(k / R) * LAKE_RASTER);
      pe.push(ORIGIN + (k % R) * LAKE_RASTER);
      run = Math.min(run, G(k) - STREAM_DEPTH);
      lv.push(run);
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
        mouth = L.level[j];
        joins = end.line;
        joinS = L.s[j];
      } else {
        report.sinkGap.push(L.level[j] - run);
        sink(L.north[j], L.east[j], L.halfWidth[j] + SINK_CLEAR);
      }
    } else if (end.kind === 'lake') {
      const lake = mask.pools[end.pool].level;
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
    for (let i = 0; i < sn.length - 1; i++) {
      const seg = Math.hypot(sn[i + 1] - sn[i], se[i + 1] - se[i]);
      const steps = Math.max(1, Math.ceil(seg / STREAM_SPACING));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        on.push(sn[i] + (sn[i + 1] - sn[i]) * t);
        oe.push(se[i] + (se[i + 1] - se[i]) * t);
        ol.push(lv[i] + (lv[i + 1] - lv[i]) * t);
      }
    }
    on.push(sn[sn.length - 1]);
    oe.push(se[se.length - 1]);
    ol.push(lv[lv.length - 1]);
    untangleCourse(on, oe, ol);
    const count = on.length;
    const north = Float64Array.from(on);
    const east = Float64Array.from(oe);
    const level = Float64Array.from(ol);
    const s = new Float64Array(count);
    for (let i = 1; i < count; i++) s[i] = s[i - 1] + Math.hypot(north[i] - north[i - 1], east[i] - east[i - 1]);
    // The ground between the raster points: a gully finer than the raster can lie between two of them (the course
    // steps over it). Every LEVEL_EVERY-th sample the ground is looked at again and the water kept under it (not in a
    // lake: the one it leaves or the one it ends in), then the level kept falling.
    for (let i = 1; i < count - 1; i += LEVEL_EVERY) {
      const g = p.route(north[i], east[i]);
      report.levelSamples++;
      if (g - STREAM_DEPTH >= level[i]) continue;
      if (mask.at(north[i], east[i]) > -Infinity) continue;
      level[i] = g - STREAM_DEPTH;
    }
    for (let i = 1; i < count; i++) level[i] = Math.min(level[i], level[i - 1]);
    // Where it came down lower than the water it joins (JOIN_TOL at most), its last reach lies at that water's level:
    // backed up and silted to it (the terrain builds its banks up to hold it, heightfield.ts carveNetwork).
    for (let i = count - 1; i >= 0 && level[i] < mouth; i--) level[i] = mouth;
    // An outlet leaves its lake at the lake's level and keeps it OUTLET_KEEP past the lake's domain (its rim), so it
    // drops away (falls) clear of the lake's water, not in a notch cut down beside it.
    let held = 0;
    if (pool >= 0) {
      const lake = mask.pools[pool].level;
      let out = -1;
      for (let i = 0; i < count; i++) {
        if (out < 0 && !(mask.at(north[i], east[i]) > -Infinity)) out = i;
        if (out >= 0 && s[i] - s[out] > OUTLET_KEEP) break;
        level[i] = Math.max(level[i], lake);
        held = i + 1;
      }
      for (let i = held; i < count; i++) level[i] = Math.min(level[i], level[i - 1]);
    }
    const area = new Float64Array(count);
    // A headwater's catchment as the lattice saw it at its head (minArea or more) comes in over its first HEAD_RAMP:
    // the stream begins as a trickle (its channel above the head is finer than the lattice) and widens as it gathers.
    for (let i = 0; i < count; i++) area[i] = (pool < 0 ? HEAD_START_AREA + (area0 - HEAD_START_AREA) * smooth(0, HEAD_RAMP, s[i]) : area0) + (LATERAL_GAIN * s[i]) / 1000;
    const id = nR + streams.length;
    streams.push({ north, east, level, halfWidth: new Float64Array(count), s, area, joins, joinS, end: end.kind, pool, held });
    report.traced++;
    report.ends[end.kind] = (report.ends[end.kind] ?? 0) + 1;
    if (pool >= 0) report.outletEnds[end.kind] = (report.outletEnds[end.kind] ?? 0) + 1;
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
    if (out.end && out.end.kind === 'lake') {
      report.outletToLake++;
      continue;
    }
    if (out.end && out.end.kind === 'sea') {
      report.outletToSea++;
      continue;
    }
    const k0 = out.path[0];
    const first = { north: ORIGIN + Math.floor(k0 / R) * LAKE_RASTER, east: ORIGIN + (k0 % R) * LAKE_RASTER, level: pool.level };
    const main = mask.main[pool.lake] === id;
    // The pond's catchment drains through its main pool; a sub-basin's is a share of it.
    const a0 = main ? pondArea(pool.lake) : Math.min(pondArea(pool.lake), minArea);
    const t = out.end ? { path: out.path.slice(1), end: out.end } : trace(out.path.slice(1), id, pool.level);
    report.outlets++;
    report.outletSteps += t.path.length;
    build(t.path, t.end, first, Math.max(1, a0), id);
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
    build(t.path, t.end, null, d.area[c], -1);
  }

  report.tracePhases.push(performance.now() - t0);
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
  for (const st of streams) for (let i = 0; i < st.area.length; i++) st.halfWidth[i] = channelHalfWidth(st.area[i]);
  report.ms = performance.now() - t0;
  return { streams, report };
}

/**
 * Cut out any loop where a course crosses itself (the smoothing can fold a hairpin of the raster course over): from
 * the first segment that a later one crosses, straight to the crossing and on along the later one (in place). The
 * water keeps the lower level there.
 */
function untangleCourse(n: number[], e: number[], lv: number[]): void {
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
      n.splice(i + 1, hit - i, xn);
      e.splice(i + 1, hit - i, xe);
      lv.splice(i + 1, hit - i, xl);
      cut = true;
    }
    if (!cut) return;
  }
}

/** Kinds of flow (FlowArrays.regime). */
export const REGIME = { placid: 0, riffle: 1, rapids: 2, steppool: 3, fall: 4 } as const;
/** Smoothed gradient at the upper bound of placid, riffle and rapids flow (beyond: step-pool and boulder cascades). */
export const REGIME_GRADIENT = [0.005, 0.02, 0.08] as const;
/** A reach falling more steeply than this (per sample) is a flight of falls; the treads between fall this steeply. */
const FALL_GRADIENT = 0.22;
const TREAD = 0.08;
/** Highest single fall, m (a bigger drop is a chain of them, each with its pool), and the lowest counted as one. */
export const FALL_MAX = 12;
export const FALL_MIN = 3;
/** The least height a fall in a flight is given (each its own, between this and FALL_MAX), m. */
const FALL_LOW = 5;
/** A fall's face spans this much ground along the channel, m. */
const FALL_RUN = 3;
/** Gradient window, m (either side half of it). */
const GRADIENT_WINDOW = 200;

/** A waterfall: where a channel's water drops FALL_MIN or more at once. */
export interface Fall {
  /** The line (index into Hydrology.rivers) and the sample at its lip. */
  line: number;
  index: number;
  north: number;
  east: number;
  /** Water level at the lip and at the foot (the pool), m. */
  top: number;
  bottom: number;
  /** Width of the water going over, m. */
  width: number;
  /** Flow direction (unit, north and east). */
  dirN: number;
  dirE: number;
}

/**
 * Turn the steep reaches of a channel's water level into falls with pools: where the level falls more steeply than
 * FALL_GRADIENT, a fall of up to FALL_MAX at a lip at the original level, then a tread falling at TREAD until it meets
 * the original level again (the next lip). Never above the level it was (the water stays under the ground). Skips
 * the samples flagged in `keep` (a lake). Returns the arrays with a foot sample inserted after each lip, and the lip
 * indices (into the returned arrays) with their drops.
 */
export function applyFalls(a: Record<string, Float64Array> & { level: Float64Array; s: Float64Array; north: Float64Array; east: Float64Array }, keep?: Uint8Array): { line: Record<string, Float64Array>; lips: Array<{ index: number; drop: number }> } {
  const { s, level: L } = a;
  const n = L.length;
  const W = Float64Array.from(L);
  const lipsAt: Array<{ at: number; drop: number }> = [];
  let i = 0;
  while (i < n - 1) {
    const ds = s[i + 1] - s[i];
    if (keep?.[i] || ds <= 0 || (L[i] - L[i + 1]) / ds <= FALL_GRADIENT) {
      i++;
      continue;
    }
    // Lip at i: the first sample where a tread from a fall of `high` (FALL_LOW to FALL_MAX, each fall its own)
    // meets the level again.
    const high = FALL_LOW + (FALL_MAX - FALL_LOW) * ((hash2i(Math.round(a.north[i]), Math.round(a.east[i])) & 0xffff) / 65535);
    let j = -1;
    let k = i + 1;
    for (; k < n && !keep?.[k]; k++) {
      if (L[i] - L[k] >= high + TREAD * (s[k] - s[i])) {
        j = k;
        break;
      }
      // The steep reach ended (the level falls gently on): a last, smaller fall meets it here.
      if (k > i + 1 && (L[k - 1] - L[k]) / Math.max(1e-6, s[k] - s[k - 1]) <= TREAD) break;
    }
    let drop = high;
    if (j < 0) {
      j = Math.min(n - 1, k - 1);
      if (j <= i) j = i + 1;
      drop = L[i] - L[j] - TREAD * (s[j] - s[i]);
      if (drop < FALL_MIN) {
        i++;
        continue;
      }
    }
    const foot = L[i] - drop;
    for (let q = i + 1; q <= j; q++) W[q] = Math.min(L[q], foot - TREAD * Math.max(0, s[q] - s[i] - FALL_RUN));
    lipsAt.push({ at: i, drop });
    i = j;
  }
  if (!lipsAt.length) return { line: { ...a, level: W }, lips: [] };
  // Insert a foot sample FALL_RUN past each lip (where the next sample is further than that).
  const ins = new Set<number>();
  for (const l of lipsAt) if (l.at + 1 < n && s[l.at + 1] - s[l.at] > FALL_RUN * 1.5) ins.add(l.at);
  const m = n + ins.size;
  const out: Record<string, Float64Array> = {};
  const keys = Object.keys(a).filter((k) => a[k].length === n);
  for (const key of keys) out[key] = new Float64Array(m);
  const map = new Int32Array(n);
  let o = 0;
  for (let q = 0; q < n; q++) {
    map[q] = o;
    for (const key of keys) out[key][o] = key === 'level' ? W[q] : a[key][q];
    o++;
    if (ins.has(q)) {
      const t = FALL_RUN / (s[q + 1] - s[q]);
      for (const key of keys) {
        const v = a[key];
        out[key][o] = v[q] + (v[q + 1] - v[q]) * t;
      }
      const lip = lipsAt.find((l) => l.at === q) as { drop: number };
      out.level[o] = Math.min(L[q] - lip.drop, L[q] + (L[q + 1] - L[q]) * t, W[q]);
      o++;
    }
  }
  return { line: out, lips: lipsAt.map((l) => ({ index: map[l.at], drop: l.drop })) };
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
