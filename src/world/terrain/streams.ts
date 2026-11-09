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
// rises); where that sill is too high the stream ends in the hollow (it sinks into the ground there). A lake's outlet
// leaves where the lake naturally spills, by the lowest way out of its basin (a priority flood from its water) when
// that rises no more than OUTLET_SILL over the water; a lake with no such way out has no outlet (its water seeps away
// and evaporates). The tarns are the drainage's small lakes in the high country (drainage.ts). Water lying higher than the
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
import { chainArea, gullyNet, receiverOf } from './gullies';
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
/** A river head's feeders (traceStreams feedHeads): each climbs towards the top of a chain of the lattice's largest
 * donors, where the catchment falls under FEED_AREA km²; a second donor gets its own from FEED_SECOND km²; each joins its
 * river within FEED_JOIN m of its head (the river then starts there, riverNetwork.ts). */
const FEED_AREA = 5;
const FEED_SECOND = 15;
export const FEED_JOIN = 1500;
/** A feeder's walk up: each step rises at least WALK_RISE m; it bends towards its target by FEED_BEND (a slope's worth
 * per unit of 1 - cos of the angle off it); it ends within WALK_ARRIVE m of the target; a feeder is at least
 * FEED_MIN_STEPS raster steps long. */
const WALK_RISE = 0.2;
const FEED_BEND = 0.08;
const WALK_ARRIVE = 350;
const FEED_MIN_STEPS = 2;
/** A feeder's catchment grows this much along it, km² per km (the lattice's chains of largest donors gain about 6). */
const FEED_GAIN = 6;
/** A feeder is at most this long, m; the second one up a river's head FEED_LEN2. */
const FEED_LEN = 2000;
const FEED_LEN2 = 1000;
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
/** A chain stream (gullies.ts) joins a chain stream whose water lies up to this much over its own, m: that water is
 * lowered to its own from the junction on (build). */
const CHAIN_LOWER = 40;
/** A chain stream climbs out of a hollow over a sill at most this high over its lowest ground so far, m (a trace's
 * CLIMB_HEIGHT): it wears a notch of its bed's width through the sill rather than ending in the hollow. */
const CHAIN_CLIMB = 80;
/** A stream ending in a hollow joins the nearest water lying under its own within this many raster steps (trace). */
const CONNECT_R = 12;
/** A continuation (a stream that ended in a hollow running on) climbs a sill up to CONT_CLIMB m, or joins water under
 * its own within CONT_CONNECT_R raster steps. */
const CONT_CLIMB = 80;
const CONT_CONNECT_R = 24;
/** A hollow a stream ends in is filled as a pond up to POND_MAX raster points (about 30 km²) and POND_DEEP m deep, its
 * water POND_DROP m under its sill. */
const POND_MAX = 1200;
const POND_DEEP = 120;
const POND_DROP = 0.5;
/** A stream stopped beside water over its own runs in to it from within this many raster steps (joinBeside). */
const JOIN_REACH = 8;
/** A stream whose every way into the pond it filled crosses its own course is cut back into the pond by at most this
 * much of its course, m (and half of it). */
const CUT_BACK = 3000;
/** A trace in a hollow on the threshold hillslopes follows their routing down at most this many raster steps. */
const PASS_WALK = 400;
/** A chain stream's samples between two of its points take the points' ground where the routing ground there is the
 * slopes' own within this, m (away from a river's carved valley). */
const CHAIN_PLAIN = 2;
/** A chain come onto a river's floor (gullies.ts GullyNet.core) crosses it to the river's nearest sample within
 * FLOOR_CROSS m, where the ground on the way (looked at every FLOOR_STEP m) rises no more than FLOOR_RISE m over the
 * chain's there, and the water there lies no more than FLOOR_DROP m under the chain's ground (a floor, not a valley
 * below a wall). The rivers' samples are indexed about every RIVER_INDEX_STEP m in RIVER_INDEX_CELL m cells. */
const FLOOR_CROSS = 900;
/** A chain beside a chain stream's course where the ground across differs by no more than this, m, joins it there. */
const FLOOR_FLAT = 12;
/** A chain's point lies in a V where the ground across its flow, a raster step either side, stands this much over it,
 * m (on the threshold slopes about 180 m); out of the V's (a valley's floor) it crosses to the water there. */
const V_SIDE = 15;
const FLOOR_STEP = 60;
/** A chain stream's open-floor reaches are laid as a curve through its raster points: this many smoothing passes over
 * its samples (STREAM_SPACING apart; about a 90 m Gaussian). */
const FLOOR_SMOOTH = 6;
/** A chain stream off an open floor joins its receiver curving downstream into it: at most this far down from where it
 * reached it, m, at an angle of at most JUNCTION_ANGLE (radians) to the receiver's course. */
const JUNCTION_SHIFT = 400;
const JUNCTION_ANGLE = Math.PI / 4;
const FLOOR_RISE = 3;
const FLOOR_DROP = 20;
const RIVER_INDEX_STEP = 60;
const RIVER_INDEX_CELL = 500;
/** A stream ending in a hollow narrows over this much of its end, m, to this fraction of its width. */
const SINK_TAPER = 400;
const SINK_END = 0.25;
/** An outlet keeps its lake's level this far past the lake's domain, m. */
const OUTLET_KEEP = 60;
/** A stream climbs out of a pit over its lowest neighbour at most this high over the lowest ground on its course so
 * far, m; beyond, it ends in the hollow (a sink). */
const CLIMB_HEIGHT = 25;
/** Highest an outlet's way out may rise over its lake's water, m: where the lake naturally spills (its water stands
 * LAKE_MARGIN under the lowest point of its rim on the raster, drainage.ts, and the routing ground the flood looks at
 * beyond the lake's own raster lies a few metres off that), its overflow wears the rim down (a broad breach,
 * BREACH_*). A lake whose every way out rises higher has no outlet. */
const OUTLET_SILL = 10;
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
 * One hydraulic geometry for every channel, from a hillside rill to a river (out/fs/REPORT.md, "Width law"):
 *   - the bed (bankfull channel: the stony or gravel strip a flood fills) is BED_A A^BED_B m wide (A km²), through the
 *     rivers' width at RIVER_AREA (riverHalfWidth: 14.4 m) and within 5 % of it from there to 3000 km², where the rivers
 *     keep their own law;
 *   - the water fills WATER_SHARE0 of it at A = WATER_A0 (a trickle among the stones of a gully's bed), rising with
 *     log A to all of it at RIVER_AREA (a river fills its channel).
 * channelHalfWidth (the water's, as every traced line and ribbon draws it) and rills.ts / rillShader.ts (the painted
 * ones) read these, so a stream is the same width whichever way it is drawn.
 */
export const BED_A = 2.594;
export const BED_B = 0.45;
export const WATER_A0 = 0.1;
export const WATER_SHARE0 = 0.45;
/** Full width of the bed (bankfull channel) for a catchment, m. */
export function bedWidth(area: number): number {
  if (area >= RIVER_AREA) return 2 * riverHalfWidth(area);
  return BED_A * Math.pow(Math.max(0, area), BED_B);
}
/** The share of its bed the water fills. */
export function waterShare(area: number): number {
  const t = Math.log(Math.max(area, 1e-6) / WATER_A0) / Math.log(RIVER_AREA / WATER_A0);
  return WATER_SHARE0 + (1 - WATER_SHARE0) * Math.min(1, Math.max(0, t));
}
/**
 * Half-width of the water for any catchment, m: below RIVER_AREA bedWidth x waterShare (0.37 m at 0.25 km², 0.85 m
 * at 1, 2.2 m at 5, 3.1 m at 10), the rivers' halfWidthFor from RIVER_AREA (7.2 m there: the law meets it).
 */
export function channelHalfWidth(area: number): number {
  if (area >= RIVER_AREA) return riverHalfWidth(area);
  return Math.max(0.2, 0.5 * bedWidth(area) * waterShare(area));
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
  /** A chain stream (gullies.ts): how far down it its catchment is the chain's own (every tributary's water already in
   * it), m; -1 for the others. */
  chainS: number;
  /** Its last raster point (-1 none); and whether it ran on as a continuation (another line, from its end: its
   * catchment is carried there whole, not summed at a confluence). */
  endK: number;
  continued: boolean;
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
  /** Why outlet streams ended short (sink or stuck), counted. */
  outletSinkWhy: Record<string, number>;
  /** Stream samples moved by the wander, and those whose wander was cut back (it climbed the gully's side). */
  wanderSamples: number;
  wanderCut: number;
  /** Stream samples in a broad breach. */
  breachSamples: number;
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
  /** The pitches and pools cut along the streams' steep reaches (pitchPool.ts). */
  pitch?: import('./pitchPool').PitchReport;
  /** riverNetwork.ts's own phases (river falls, tracing and the streams' falls, flow, index), ms. */
  phases?: number[];
  /** The rivers' head feeders (probes). */
  feed?: Record<string, unknown>;
  /** The gully chains traced as streams (gullies.ts): heads, traced, km, skipped (already on water), ms. */
  /** Ponds filled in hollows streams ended in (trace): pool id, raster points, in pairs. */
  ponds?: number[];
  pondWhy?: Record<string, number>;
  /** Streams that ended in a hollow run on as a continuation. */
  continued?: number;
  /** Traces led out of a hollow down the threshold hillslopes' routing (trace). */
  passWalks?: number;
  /** Streams that ended in a hollow joined to water near it instead (trace connect). */
  connects?: number;
  /** Why streams ended in a hollow, and where (probes). */
  hollowWhy?: Record<string, number>;
  hollowAt?: number[];
  /** Chain streams that lowered the chain stream they join to their own water (build: CHAIN_LOWER). */
  chainLowered?: number;
  /** riverNetwork.ts's sub-phases after the tracing (probes), ms. */
  netMs?: Record<string, number>;
  /** A chain stream's build() by section (probes), ms: points and end, smoothing and resampling, levels and breach, catchment and record, marking. */
  buildMs?: number[];
  /** Ground samples the floor crossings took (probes). */
  crossSamples?: number;
  /** Chain streams joining their receiver curving downstream into it (build, junction). */
  junctions?: number;
  /** Why each stream that ended in a hollow did not get out of it (by line: the river count plus its index), the
   * steps tried in turn (probes: sinkCases). */
  endWhy?: Record<number, string>;
  /** Line sinks (probes): north, east of the last point, 0 a river / 1 a stream, the gap (m), 1 a chain stream. */
  sinkAt?: number[];
  chains?: { heads: number; traced: number; km: number; skipped: number; crossed: number; ms: number; msTrace: number; msBuild: number; samples0: number };
}

/**
 * Trace the streams of a seeded world. `ground` is the terrain they run on (detailed, with the rivers' valleys);
 * `rivers` the river network's channels (their levels final); `riverPools` flags the lake pools a river runs through.
 */
export function traceStreams(p: { d: Drainage; mask: LakeMask; route: (north: number, east: number) => number; rivers: ReadonlyArray<ChannelArrays>; riverPools: Uint8Array; minArea?: number; pinned?: (north: number, east: number) => number }): { streams: StreamLine[]; report: StreamReport; headAt: Float64Array } {
  const t0 = performance.now();
  const { d, mask, rivers } = p;
  const minArea = p.minArea ?? STREAM_AREA;
  const n = d.n;
  const R = RASTER_N;
  const nR = rivers.length;
  const report: StreamReport = { pools: 0, riverPools: 0, outlets: 0, outletToLake: 0, outletToSea: 0, outletNone: 0, heads: 0, traced: 0, ends: {}, outletEnds: {}, km: 0, steps: 0, outletSteps: 0, levelSamples: 0, notch: [], notchOutlet: [], pits: 0, sinks: 0, sinkGap: [], sinkGapLake: [], sinkGapLast: [], hollows: 0, floods: 0, outletSinkWhy: {}, breachSamples: 0, wanderSamples: 0, wanderCut: 0, samples: 0, ms: 0, tracePhases: [], outletSamples: 0, outletSill: [], outletHigh: 0 };

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
  type End = { kind: StreamLine['end']; line: number; idx: number; pool: number; ok?: boolean; why?: string; cross?: boolean };
  /**
   * Steepest descent from raster point `start`, never into `own` pool. Returns the course (raster indices, start
   * first) and what it reached. (report.floods counts the climbs over a pit's sill.)
   */
  const trace = (prefix: number[], own: number, level: number, checkFirst = false, climb = CLIMB_HEIGHT, wayOut = false, notLine = -1, connectR = CONNECT_R): { path: number[]; end: End } => {
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
      if (o !== 0 && occLine(o) !== notLine) {
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
    /** Whether k lies in water standing higher than the stream's that it cannot back up to (a line held up on its
     * valley floor, a lake perched over the gully): the stream goes round it, on down beside it, rather than ending. */
    const higherWater = (k: number): boolean => {
      const o = occ[k];
      if (o !== 0) return joinAt(o) < 0;
      const pool = mask.poolAt(Math.floor(k / R), k % R);
      return pool >= 0 && pool !== own && !mask.pools[pool].drained && !canReach(mask.pools[pool].level);
    };
    const blocked = (k: number): boolean => (notLine >= 0 && occ[k] !== 0 && occLine(occ[k]) === notLine && k !== path[0]) || visit.get(k) === st || (own >= 0 && mask.poolAt(Math.floor(k / R), k % R) === own) || byHome(k) || crosses(cur, k) || byHigherLake(k) || higherWater(k);
    // The direction of the last step (index into RING), -1 before the first.
    let dir = -1;
    for (let step = 0; step < MAX_STEPS; step++) {
      if (step > 0 || checkFirst) {
        const e = reached(cur);
        if (e) return { path, end: e };
      }
      // (A way-out trace - a chain's, a continuation's - joins water it can reach lying beside it, on a neighbouring
      // raster point: it does not run on beside it.)
      if (wayOut && step > 0) {
        const ci = Math.floor(cur / R);
        const cj = cur % R;
        for (let a = 0; a < 8; a++) {
          const q = (ci + DI[a]) * R + cj + DJ[a];
          const o = occ[q];
          if (o === 0 || visit.get(q) === st || occLine(o) === notLine) continue;
          const j = joinAt(o);
          if (j < 0) continue;
          visit.set(q, st);
          visitAt.set(q, path.length);
          path.push(q);
          return { path, end: { kind: 'channel', line: occLine(o), idx: j, pool: -1, ok: true } };
        }
      }
      const ri = Math.floor(cur / R);
      const rj = cur % R;
      if (ri <= 0 || rj <= 0 || ri >= R - 1 || rj >= R - 1) return { path, end: { kind: 'edge', line: -1, idx: 0, pool: -1 } };
      report.steps++;
      let next = -1;
      let nextDir = -1;
      {
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
          // (A hollow of the routing ground on the threshold hillslopes, gullies.ts: there the slopes' own ground has
          // none, and its routing leads on down out of it - the way its V's run.)
          const gw = gullyNet();
          if (wayOut && !(next >= 0 && low - runMin <= climb) && gw && gw.n === R && gw.dir[cur]) {
            let k = cur;
            let walked = 0;
            for (let r = receiverOf(gw, k); r >= 0 && walked < PASS_WALK; r = receiverOf(gw, k)) {
              if (visit.get(r) === st || byHome(r)) break;
              visit.set(r, st);
              visitAt.set(r, path.length);
              path.push(r);
              if (occ[r] === 0) runMin = Math.min(runMin, G(r));
              lowAt.push(runMin);
              walked++;
              k = r;
              if (occ[r] !== 0 || mask.poolAt(Math.floor(r / R), r % R) >= 0 || !gw.dir[r]) break;
            }
            if (walked > 0) {
              report.passWalks = (report.passWalks ?? 0) + 1;
              cur = k;
              dir = -1;
              continue;
            }
          }
          if (next >= 0 && low - runMin <= climb) report.floods++;
          else {
            // (A sill higher than that, or no way on: it joins the nearest water lying under its own within
            // CONNECT_R raster steps, worn through in a notch of its bed's width; else it ends in the hollow, its
            // water seeping away.)
            const c = wayOut ? connect(cur, runMin - STREAM_DEPTH, own, notLine, connectR) : null;
            // (Not back across its own course.)
            if (c && !c.steps.some((k, i) => i < c.steps.length - 1 && (visit.get(k) === st || crosses(i === 0 ? cur : c.steps[i - 1], k)))) {
              for (const k of c.steps) {
                visit.set(k, st);
                visitAt.set(k, path.length);
                path.push(k);
              }
              report.connects = (report.connects ?? 0) + 1;
              return { path, end: c.end };
            }
            return { path, end: { kind: 'sink', line: -1, idx: 0, pool: -1, why: next < 0 ? 'pit-no-way' : 'pit-deep' } };
          }
        }
      }
      if (next < 0) return { path, end: { kind: 'stuck', line: -1, idx: 0, pool: -1, why: 'no-way' } };
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
    return { path, end: { kind: 'stuck', line: -1, idx: 0, pool: -1, why: 'steps' } };
  };

  /** From raster point k, the nearest line's water within CONNECT_R steps lying at or under `level` (not across a
   * lake, the home field, or another line's water on the way): the raster points of a straight way to it, and the end
   * there. Null when there is none. */
  const connect = (k: number, level: number, own: number, notLine = -1, CR = CONNECT_R): { steps: number[]; end: End } | null => {
    const ki = Math.floor(k / R);
    const kj = k % R;
    let best: { d: number; q: number } | null = null;
    for (let a = -CR; a <= CR; a++)
      for (let b = -CR; b <= CR; b++) {
        const qi = ki + a;
        const qj = kj + b;
        if (qi < 1 || qj < 1 || qi >= R - 1 || qj >= R - 1) continue;
        const o = occ[qi * R + qj];
        if (o === 0 || occLine(o) === notLine || lineAt(occLine(o)).level[occIdx(o)] > level) continue;
        const d = Math.hypot(a, b);
        if (d <= CR && (!best || d < best.d)) best = { d, q: qi * R + qj };
      }
    if (!best) return null;
    const qi = Math.floor(best.q / R);
    const qj = best.q % R;
    const n = Math.max(Math.abs(qi - ki), Math.abs(qj - kj));
    const steps: number[] = [];
    for (let t = 1; t <= n; t++) {
      const q = Math.round(ki + ((qi - ki) * t) / n) * R + Math.round(kj + ((qj - kj) * t) / n);
      if (t < n && ((occ[q] !== 0 && occLine(occ[q]) !== notLine) || byHome(q) || (mask.poolAt(Math.floor(q / R), q % R) >= 0 && mask.poolAt(Math.floor(q / R), q % R) !== own))) return null;
      steps.push(q);
    }
    const o = occ[best.q];
    return { steps, end: { kind: 'channel', line: occLine(o), idx: occIdx(o), pool: -1, ok: true } };
  };

  /** The line `line` (river or stream) as arrays. */
  const lineAt = (line: number): ChannelArrays => (line < nR ? rivers[line] : streams[line - nR]);

  /** Build a stream from its traced course and record it. */
  /**
   * The junction of a chain stream off an open floor (build): from its last point (pn[last], pe[last]), on its course's
   * heading there, to the receiver `line` at a sample from `j0` down at most JUNCTION_SHIFT where the way in meets the
   * receiver at JUNCTION_ANGLE or less, along a cubic curve tangent to both courses. The curve's ground (p.route, every
   * STREAM_SPACING) never rises FLOOR_RISE over `g0` (the last point's), nor lies so low that the receiver's water
   * backing up would stand BACKUP_FILL over it. Its inner points (north, east, ground) and the receiver's sample, or
   * null (none such: the stream joins as it reached it).
   */
  const junction = (pn: number[], pe: number[], last: number, line: number, j0: number, g0: number, run: number): { n: number[]; e: number[]; g: number[]; idx: number } | null => {
    const L = lineAt(line);
    const cnt = L.s.length;
    if (cnt < 3) return null;
    const P0n = pn[last];
    const P0e = pe[last];
    let un = last > 0 ? P0n - pn[last - 1] : L.north[j0] - P0n;
    let ue = last > 0 ? P0e - pe[last - 1] : L.east[j0] - P0e;
    const ul = Math.hypot(un, ue) || 1;
    un /= ul;
    ue /= ul;
    const dirAt = (j: number): [number, number] => {
      const a = Math.max(0, Math.min(cnt - 2, j));
      const b = Math.min(cnt - 1, a + 2);
      const dn = L.north[b] - L.north[a];
      const de = L.east[b] - L.east[a];
      const dl = Math.hypot(dn, de) || 1;
      return [dn / dl, de / dl];
    };
    const cosMax = Math.cos(JUNCTION_ANGLE);
    const tryAt = (j: number): { n: number[]; e: number[]; g: number[]; idx: number } | null => {
      const Jn = L.north[j];
      const Je = L.east[j];
      const c = Math.hypot(Jn - P0n, Je - P0e);
      if (c < 1.5 * STREAM_SPACING) return null;
      const [tn, te] = dirAt(j);
      const k = 0.6 * c;
      const steps = Math.max(2, Math.ceil(c / STREAM_SPACING));
      const n: number[] = [];
      const e: number[] = [];
      const g: number[] = [];
      const mouth = L.level[j];
      for (let q = 1; q < steps; q++) {
        const t = q / steps;
        const h00 = 2 * t * t * t - 3 * t * t + 1;
        const h10 = t * t * t - 2 * t * t + t;
        const h01 = -2 * t * t * t + 3 * t * t;
        const h11 = t * t * t - t * t;
        const qn = h00 * P0n + h10 * k * un + h01 * Jn + h11 * k * tn;
        const qe = h00 * P0e + h10 * k * ue + h01 * Je + h11 * k * te;
        // (Not over the receiver's water before its mouth, nor into a lake.)
        if (Math.hypot(qn - Jn, qe - Je) > L.halfWidth[j] + STREAM_SPACING && mask.at(qn, qe) > -Infinity) return null;
        const gq = p.route(qn, qe);
        report.crossSamples = (report.crossSamples ?? 0) + 1;
        if (gq > g0 + FLOOR_RISE || gq - STREAM_DEPTH < mouth - BACKUP_FILL) return null;
        n.push(qn);
        e.push(qe);
        g.push(gq);
      }
      return { n, e, g, idx: j };
    };
    // The first sample down the receiver where the way in meets it at JUNCTION_ANGLE or less.
    let best = -1;
    for (let j = j0; j < cnt - 1 && L.s[j] - L.s[j0] <= JUNCTION_SHIFT; j++) {
      if (L.level[j] > run + JOIN_TOL || mask.at(L.north[j], L.east[j]) > -Infinity) break;
      const cn = L.north[j] - P0n;
      const ce = L.east[j] - P0e;
      const cl = Math.hypot(cn, ce) || 1;
      const [tn, te] = dirAt(j);
      if ((cn * tn + ce * te) / cl >= cosMax) {
        best = j;
        break;
      }
    }
    if (best >= 0) {
      const r = tryAt(best);
      if (r) return r;
    }
    return tryAt(j0);
  };
  const build = (path: number[], endAt: End, first: { north: number; east: number; level: number } | null, area0: number, pool: number, areaEnd = -1, pathArea: number[] | null = null, startAt: { north: number; east: number } | null = null, pathVee: number[] | null = null): void => {
    const bt0 = performance.now();
    const m = path.length;
    let end = endAt;
    // Points: an outlet's first point in its lake, the raster course, a confluence's point on the line it joins; the
    // water at each and the ground it runs through (its cut is the difference).
    const pn: number[] = [];
    const pe: number[] = [];
    const lv: number[] = [];
    const gp: number[] = [];
    /** A chain stream's catchment at each point (NaN past the chain), km². */
    const pa: number[] = [];
    if (first) {
      pn.push(first.north);
      pe.push(first.east);
      lv.push(first.level);
      gp.push(first.level + STREAM_DEPTH);
      pa.push(NaN);
    }
    let run = first ? first.level : Infinity;
    for (let i = 0; i < m; i++) {
      const k = path[i];
      // (A continuation starts at its stream's last point exactly.)
      pn.push(i === 0 && startAt ? startAt.north : ORIGIN + Math.floor(k / R) * LAKE_RASTER);
      pe.push(i === 0 && startAt ? startAt.east : ORIGIN + (k % R) * LAKE_RASTER);
      run = Math.min(run, G(k) - STREAM_DEPTH);
      lv.push(run);
      gp.push(G(k));
      pa.push(pathArea && i < pathArea.length ? pathArea[i] : NaN);
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
        pa.pop();
      }
      report.sinks++;
      end = { kind: 'sink', line: -1, idx: 0, pool: -1 };
    };
    // A chain stream come to a chain stream whose water lies above its own (the trunk's level is its course's running
    // minimum of the routing ground, which can lie a few metres off the slopes' ground its chain was built on): the
    // trunk's water comes down to the tributary's from the junction on (its channel cut that much deeper), and the
    // tributary joins it. Both run down the same routing, so the trunk's water must be the lower.
    if (end.kind === 'sink' && end.line >= nR && pathArea && end.idx >= streams[end.line - nR].held && lineAt(end.line).level[end.idx] - run <= CHAIN_LOWER) {
      const T = streams[end.line - nR];
      for (let i = end.idx; i < T.level.length && T.level[i] > run; i++) {
        const lowered = T.level[i] - run;
        T.level[i] = run;
        T.cut[i] += lowered;
        T.breach[i] = Math.max(T.breach[i], breachOfCut(T.cut[i]));
      }
      report.chainLowered = (report.chainLowered ?? 0) + 1;
      end = { kind: 'channel', line: end.line, idx: end.idx, pool: -1, ok: true };
    }
    if (end.kind === 'sink') {
      // It came to water lying above its own: it ends short of it.
      if (end.line >= 0) {
        const L = lineAt(end.line);
        report.sinkGap.push(L.level[end.idx] - run);
        (report.sinkAt ??= []).push(pn[pn.length - 1], pe[pe.length - 1], end.line < nR ? 0 : 1, L.level[end.idx] - run, pathArea ? 1 : 0);
        report.sinkGapLast.push(L.level[end.idx] - (G(path[m - 1]) - STREAM_DEPTH));
        sink(L.north[end.idx], L.east[end.idx], L.halfWidth[end.idx] + SINK_CLEAR);
      } else if (end.pool < 0) {
        // A hollow it cannot climb out of: it ends in it.
        report.hollows++;
        const why = `${end.why ?? '?'}${pathArea ? '-chain' : ''}`;
        (report.hollowWhy ??= {})[why] = (report.hollowWhy[why] ?? 0) + 1;
        (report.hollowAt ??= []).push(pn[pn.length - 1], pe[pe.length - 1]);
      } else {
        report.sinkGapLake.push(mask.pools[end.pool].level - run);
        sink(pn[pn.length - 1], pe[pe.length - 1], SINK_CLEAR);
      }
    } else if (end.kind === 'channel') {
      const L = lineAt(end.line);
      let j = end.idx;
      if (end.ok || L.level[j] <= run + JOIN_TOL) {
        // A chain stream come off an open floor (or across one) joins its receiver as water does there: curving
        // downstream into it (a Y), not square across it (junction).
        const last = pn.length - 1;
        if (pathArea && pathVee && last >= (first ? 1 : 0) && last - (first ? 1 : 0) === m - 1 && (end.cross || pathVee[m - 1] === 0)) {
          const jc = junction(pn, pe, last, end.line, j, G(path[m - 1]), run);
          if (jc) {
            j = jc.idx;
            for (let q = 0; q < jc.n.length; q++) {
              pn.push(jc.n[q]);
              pe.push(jc.e[q]);
              lv.push(run);
              gp.push(jc.g[q]);
              pa.push(NaN);
            }
            report.junctions = (report.junctions ?? 0) + 1;
          }
        }
        pn.push(L.north[j]);
        pe.push(L.east[j]);
        lv.push(L.level[j]);
        gp.push(L.level[j] + STREAM_DEPTH);
        pa.push(NaN);
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
    const bt1 = performance.now();
    // Smooth the raster's zigzags (the ends stay put), then resample at STREAM_SPACING; each sample keeps its
    // fractional index into the points, for the level. Not where the ground pins the course to its raster points
    // (`pinned`, 0-1: a seeded world's threshold hillslopes, hillslopes.ts, whose valleys' floors run from point to point
    // between walls rising a raster step's threshold rise: smoothed off them, a stream would ride up a wall).
    let sn = pn.slice();
    let se = pe.slice();
    // (A chain's own points lie on its channel's floor: pinned without asking.)
    // (A chain's points on an open floor are not: there it is laid as a curve through them, and so are the points of
    // its junction curve.)
    const off0 = first ? 1 : 0;
    const pinOf = (i: number): number => {
      if (pathArea && pathVee && i >= off0 && i - off0 >= m) return 0;
      if (pathArea && pa[i] === pa[i]) return pathVee && i - off0 < pathVee.length ? pathVee[i - off0] : 1;
      return p.pinned ? (p.pinned as (n: number, e: number) => number)(pn[i], pe[i]) : 0;
    };
    const pin = p.pinned ? pn.map((_, i) => pinOf(i)) : null;
    for (let pass = 0; pass < 2; pass++) {
      const n2 = sn.slice();
      const e2 = se.slice();
      for (let i = 1; i < sn.length - 1; i++) {
        n2[i] = 0.25 * sn[i - 1] + 0.5 * sn[i] + 0.25 * sn[i + 1];
        e2[i] = 0.25 * se[i - 1] + 0.5 * se[i] + 0.25 * se[i + 1];
        if (pin && pin[i] > 0) {
          n2[i] += pin[i] * (sn[i] - n2[i]);
          e2[i] += pin[i] * (se[i] - e2[i]);
        }
      }
      sn = n2;
      se = e2;
    }
    const on: number[] = [];
    const oe: number[] = [];
    const ol: number[] = [];
    const og: number[] = [];
    const oa: number[] = [];
    /** Whether each sample lies between two of a chain's points where the routing ground is the slopes' own (not a
     * river's valley carved into it): its ground is the points' interpolated. */
    const oc: boolean[] = [];
    /** A chain stream's pin at each sample (1 at its raster points in a V, 0 on an open floor). */
    const op: number[] = [];
    const gnH = pathArea ? gullyNet() : null;
    const plain = (i: number): boolean => {
      if (!gnH || !(pa[i] === pa[i]) || (pin && pin[i] < 1)) return false;
      const k = path[i - (first ? 1 : 0)];
      return k !== undefined && Math.abs(G(k) - gnH.h[k]) < CHAIN_PLAIN;
    };
    // (A chain stream: its points' catchment past the chain the last one's, gathering LATERAL_GAIN as a headwater's.)
    let chainEnd = -1;
    let chainSamples = 0;
    if (pathArea) {
      let last = pathArea[0];
      let lastI = 0;
      for (let i = 0; i < pa.length; i++) {
        if (pa[i] === pa[i]) {
          last = pa[i];
          lastI = i;
          chainEnd = i;
        } else pa[i] = last + (LATERAL_GAIN * LAKE_RASTER * (i - lastI)) / 1000;
      }
    }
    for (let i = 0; i < sn.length - 1; i++) {
      const seg = Math.hypot(sn[i + 1] - sn[i], se[i + 1] - se[i]);
      const steps = Math.max(1, Math.ceil(seg / STREAM_SPACING));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        on.push(sn[i] + (sn[i + 1] - sn[i]) * t);
        oe.push(se[i] + (se[i + 1] - se[i]) * t);
        ol.push(lv[i] + (lv[i + 1] - lv[i]) * t);
        og.push(gp[i] + (gp[i + 1] - gp[i]) * t);
        if (pathArea) oa.push(pa[i] + (pa[i + 1] - pa[i]) * t);
        oc.push(plain(i) && plain(i + 1));
        if (pathVee && pin) op.push(pin[i] + (pin[i + 1] - pin[i]) * t);
        if (i < chainEnd) chainSamples++;
      }
    }
    on.push(sn[sn.length - 1]);
    oe.push(se[se.length - 1]);
    ol.push(lv[lv.length - 1]);
    og.push(gp[gp.length - 1]);
    if (pathArea) oa.push(pa[pa.length - 1]);
    oc.push(false);
    // A chain stream's open-floor reaches: the raster course (points 250 m apart, turning in 45 degree steps) laid as a
    // curve through them (FLOOR_SMOOTH passes at the samples' spacing), not as the raster's straight runs and corners.
    if (pathVee && pin && op.length) {
      op[0] = 1;
      op.push(1);
      for (let pass = 0; pass < FLOOR_SMOOTH; pass++) {
        const n2 = on.slice();
        const e2 = oe.slice();
        for (let i = 1; i < on.length - 1; i++) {
          const w = 1 - op[i];
          if (w <= 0) continue;
          n2[i] += w * (0.25 * on[i - 1] + 0.25 * on[i + 1] - 0.5 * on[i]);
          e2[i] += w * (0.25 * oe[i - 1] + 0.25 * oe[i + 1] - 0.5 * oe[i]);
        }
        for (let i = 1; i < on.length - 1; i++) {
          on[i] = n2[i];
          oe[i] = e2[i];
        }
      }
    }
    // A natural wander about the raster's course (wander): the ground under every LEVEL_EVERY-th sample (from the
    // first) is looked at on the way, and kept for the level below.
    // (Not a chain stream's: its chain is the V's floor, between walls at the threshold slope, so it has no floor to
    // wander on.)
    const bt2 = performance.now();
    const seenG = pathArea ? new Float64Array(on.length).fill(NaN) : wander(on, oe, p.route, (n, e) => mask.at(n, e) > -Infinity, nR + streams.length, area0, pool >= 0, report);
    const before = on.length;
    untangleCourse(on, oe, ol, og, pathArea ? oa : undefined);
    if (on.length !== before) seenG.fill(NaN);
    const count = on.length;
    const north = Float64Array.from(on);
    const east = Float64Array.from(oe);
    const level = Float64Array.from(ol);
    const s = new Float64Array(count);
    for (let i = 1; i < count; i++) s[i] = s[i - 1] + Math.hypot(north[i] - north[i - 1], east[i] - east[i - 1]);
    // The ground between the raster points: a gully finer than the raster can lie between two of them (the course
    // steps over it). Every LEVEL_EVERY-th sample the ground is looked at again and the water kept under it (not in a
    // lake: the one it leaves or the one it ends in), then the level kept falling.
    const groundAt = p.route;
    const wetAt = (n: number, e: number): boolean => mask.at(n, e) > -Infinity;
    /** The samples whose ground was looked at (og then holds it, not the raster points' interpolated). */
    // (The chain samples' ground is their points' while the course is as laid: not where a loop was cut out of it.)
    const untangled = !pathArea || on.length !== before;
    const onChain = (i: number): boolean => !untangled && !!oc[i];
    const seen = new Uint8Array(count);
    seen[0] = seen[count - 1] = 1;
    // (A chain sample's ground is its points' already: as good as looked at.)
    for (let i = 1; i < count - 1; i++) if (onChain(i)) seen[i] = 1;
    // (A chain stream's samples along its chain are not looked at again: the chain runs from raster point to raster point
    // on the slopes' channel floor, which falls straight between them, so the raster points' ground, interpolated, is
    // the floor's.)
    for (let i = 1; i < count - 1; i += LEVEL_EVERY) {
      if (onChain(i)) continue;
      const g = seenG[i] === seenG[i] ? seenG[i] : groundAt(north[i], east[i]);
      if (seenG[i] !== seenG[i]) report.levelSamples++;
      og[i] = g;
      seen[i] = 1;
      if (g - STREAM_DEPTH >= level[i]) continue;
      if (wetAt(north[i], east[i])) continue;
      level[i] = g - STREAM_DEPTH;
    }
    // And the samples between where the level falls steeply there (a cliff can lie between two looked at).
    for (let i = 2; i < count - 1; i++) {
      if ((i - 1) % LEVEL_EVERY === 0 || onChain(i)) continue;
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
    for (let i = 0, a = 0, b = 0; i < count; i++) {
      if (seen[i]) {
        a = i;
        continue;
      }
      if (b <= i) for (b = i + 1; !seen[b]; b++);
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
    const bt3 = performance.now();
    const area = new Float64Array(count);
    let chainS = -1;
    if (pathArea) {
      // A chain stream: the chain's own catchment along it (the pass's routing summed it), then gathering on.
      for (let i = 0; i < count; i++) area[i] = Math.max(oa[i], i > 0 ? area[i - 1] : 0);
      chainS = s[Math.min(count - 1, chainSamples)];
    }
    // A headwater's catchment as the lattice saw it at its head (minArea or more) comes in over its first HEAD_RAMP:
    // the stream begins as a trickle (its channel above the head is finer than the lattice) and widens as it gathers.
    // A river head's feeder gathers FEED_GAIN km² per km of its course (as the lattice's chains of largest donors do),
    // up to `areaEnd` (its donor's catchment) at the junction.
    if (pathArea) {
      // (Set above.)
    } else if (areaEnd >= 0) {
      const gain = Math.max(0, Math.min(FEED_GAIN / 1000, (areaEnd - area0) / Math.max(1, s[count - 1])));
      for (let i = 0; i < count; i++) area[i] = area0 + gain * s[i];
    }
    else for (let i = 0; i < count; i++) area[i] = (pool < 0 ? HEAD_START_AREA + (area0 - HEAD_START_AREA) * smooth(0, HEAD_RAMP, s[i]) : area0) + (LATERAL_GAIN * s[i]) / 1000;
    const id = nR + streams.length;
    streams.push({ north, east, level, halfWidth: new Float64Array(count), s, area, breach, cut, joins, joinS, end: end.kind, pool, held, chainS, endK: path.length ? path[path.length - 1] : -1, continued: false });
    report.traced++;
    report.ends[end.kind] = (report.ends[end.kind] ?? 0) + 1;
    if (pool >= 0) report.outletEnds[end.kind] = (report.outletEnds[end.kind] ?? 0) + 1;
    if (pool >= 0 && (end.kind === 'sink' || end.kind === 'stuck')) {
      const why = end.why ?? (end.line >= 0 ? 'beside-line' : end.pool >= 0 ? 'beside-lake' : 'hollow');
      report.outletSinkWhy[why] = (report.outletSinkWhy[why] ?? 0) + 1;
    }
    report.km += s[count - 1] / 1000;
    const bt4 = performance.now();
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
    if (pathArea) {
      const bt5 = performance.now();
      const bm = (report.buildMs ??= [0, 0, 0, 0, 0]);
      bm[0] += bt1 - bt0;
      bm[1] += bt2 - bt1;
      bm[2] += bt3 - bt2;
      bm[3] += bt4 - bt3;
      bm[4] += bt5 - bt4;
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
    const t = out.end ? { path: out.path.slice(1), end: { ...out.end, ok: true } } : trace(out.path.slice(1), id, pool.level);
    report.outlets++;
    report.outletSteps += t.path.length;
    build(t.path, t.end, first, Math.max(1, a0), id);
  }

  /**
   * The feeders of the rivers' heads. A river (a lattice line from RIVER_AREA) whose head is in no lake and that no
   * stream joins within FEED_JOIN of its head gathers its water from the slopes above it, which the lattice only sums:
   * its head cell's largest donors (the largest, and the next where it drains FEED_SECOND km² or more), each followed
   * up its own chain of largest donors to where the catchment falls under FEED_AREA (the chain's top). The raster finds
   * the way: from the river's head a walk climbs the way water comes down - each step to a neighbour higher by
   * WALK_RISE or more whose own steepest way down is the point it left, the least steep of them within two directions
   * of the last step, bent towards the chain's top (FEED_BEND) - until it is within WALK_ARRIVE of that top, has gone
   * FEED_LEN (FEED_LEN2 for the second), or can climb no further (no neighbour drains to it, or the next would be another line, a lake, home).
   * Water runs back down the walk to the river (the first raster point by it, as a trace stops): the feeder, falling
   * all the way, never into a hollow. A second walk climbs towards the second donor's top beside the first: the two
   * meet at the river's head. (Where the walk from the head finds no way up, or meets the river where it is held over
   * the ground the walk came down, the next raster point down the river, within FEED_JOIN; riverNetwork.ts then starts
   * the river at the junction.) A feeder starts as a trickle (FEED_AREA) and gathers FEED_GAIN km² per km, at most its
   * donor's catchment at the junction: the river's head is as wide as what joins it there.
   */
  function feedHeads(): void {
    const tf = performance.now();
    const s0 = report.samples;
    const firstFeeder = nR + streams.length;
    const fr: Record<string, number> = { rivers: 0, fedAlready: 0, fed: 0, feeders: 0, unfed: 0, short: 0, held: 0, heldAfter: 0, km: 0, steps: 0 };
    const stops: Record<string, number> = {};
    const joinAt: number[] = [];
    // The first junction on each river so far.
    const first = headFrom;
    for (const st of streams) if (st.joins >= 0 && st.joins < nR) first[st.joins] = Math.min(first[st.joins], st.joinS);
    const donors = (c: number): number[] => {
      const out: number[] = [];
      const ci = Math.floor(c / n);
      const cj = c % n;
      for (let a = 0; a < 8; a++) {
        const qi = ci + DI[a];
        const qj = cj + DJ[a];
        if (qi < 0 || qj < 0 || qi >= n || qj >= n) continue;
        if (d.receiver[qi * n + qj] === c) out.push(qi * n + qj);
      }
      return out.sort((x, y) => d.area[y] - d.area[x] || x - y);
    };
    const taken = new Set<number>();
    /** Start points with no way up. */
    const dead = new Set<number>();
    const cand: Array<{ q: number; r: number; slope: number; score: number }> = [];
    /** The walk up from raster point k0 (river li's) towards (tn, te): its raster points, k0 first. */
    const walk = (li: number, k0: number, tn: number, te: number, maxLen: number): number[] => {
      const path = [k0];
      let len = 0;
      let dir = -1;
      for (;;) {
        const p = path[path.length - 1];
        const pi = Math.floor(p / R);
        const pj = p % R;
        const dn = tn - (ORIGIN + pi * LAKE_RASTER);
        const de = te - (ORIGIN + pj * LAKE_RASTER);
        const dT = Math.hypot(dn, de);
        if (dT < WALK_ARRIVE) {
          stops.arrived = (stops.arrived ?? 0) + 1;
          break;
        }
        if (len > maxLen) {
          stops.long = (stops.long ?? 0) + 1;
          break;
        }
        if (pi <= 1 || pj <= 1 || pi >= R - 2 || pj >= R - 2) break;
        const g0 = G(p);
        let best = -1;
        let bestDir = -1;
        let why = 'top';
        // The candidates up from p (least steep first, bent towards the target), each taken only if its steepest way
        // down is to p: the walk climbs the way water comes down.
        cand.length = 0;
        for (let r = dir < 0 ? 0 : dir - 2; r <= (dir < 0 ? 7 : dir + 2); r++) {
          const a = RING[(r + 8) & 7];
          const qi = pi + DI[a];
          const qj = pj + DJ[a];
          const q = qi * R + qj;
          if (taken.has(q)) continue;
          const o = occ[q];
          if ((o !== 0 && occLine(o) !== li) || mask.poolAt(qi, qj) >= 0 || byHome(q)) {
            why = o !== 0 ? 'line' : 'lake';
            continue;
          }
          const dist = (DI[a] && DJ[a] ? SQRT2 : 1) * LAKE_RASTER;
          const rise = G(q) - g0;
          if (rise < WALK_RISE) continue;
          cand.push({ q, r: (r + 8) & 7, slope: rise / dist, score: rise / dist + FEED_BEND * (1 - ((DI[a] * dn + DJ[a] * de) * LAKE_RASTER) / (dist * dT)) });
        }
        cand.sort((x, y) => x.score - y.score || x.r - y.r);
        for (const c of cand) {
          const qi = Math.floor(c.q / R);
          const qj = c.q % R;
          const gq = G(c.q);
          let down = true;
          for (let b = 0; b < 8 && down; b++) {
            const ni = qi + DI[b];
            const nj = qj + DJ[b];
            if (ni === pi && nj === pj) continue;
            if ((gq - G(ni * R + nj)) / ((DI[b] && DJ[b] ? SQRT2 : 1) * LAKE_RASTER) > c.slope) down = false;
          }
          if (down) {
            best = c.q;
            bestDir = c.r;
            break;
          }
        }
        if (best < 0) {
          stops[why] = (stops[why] ?? 0) + 1;
          break;
        }
        path.push(best);
        taken.add(best);
        len += (DI[RING[bestDir]] && DJ[RING[bestDir]] ? SQRT2 : 1) * LAKE_RASTER;
        dir = bestDir;
        fr.steps++;
      }
      return path;
    };
    for (let li = 0; li < nR; li++) {
      const r = rivers[li];
      if (mask.at(r.north[0], r.east[0]) > -Infinity || li >= d.lines.length) continue;
      fr.rivers++;
      if (first[li] <= FEED_JOIN) {
        fr.fedAlready++;
        continue;
      }
      const c0 = d.lines[li].cells[0];
      const ds = donors(c0).filter((q, i) => d.area[q] >= (i === 0 ? FEED_AREA : FEED_SECOND)).slice(0, 2);
      let fed = 0;
      for (let di = 0; di < ds.length; di++) {
        const dn = ds[di];
        // The chain of largest donors up from the donor while the catchment stays at FEED_AREA or more: its top.
        let top = dn;
        for (;;) {
          const q = donors(top)[0];
          if (q === undefined || d.area[q] < FEED_AREA) break;
          top = q;
        }
        const tn = ORIGIN + Math.floor(top / n) * DRAIN_CELL;
        const te = ORIGIN + (top % n) * DRAIN_CELL;
        // From the river's head, or the next raster point down it, within FEED_JOIN.
        let built = false;
        for (let i = 0; i < r.s.length && r.s[i] <= FEED_JOIN && !built; i++) {
          if (i > 0 && Math.floor(r.s[i] / LAKE_RASTER) === Math.floor(r.s[i - 1] / LAKE_RASTER)) continue;
          const ki = Math.round((r.north[i] - ORIGIN) / LAKE_RASTER);
          const kj = Math.round((r.east[i] - ORIGIN) / LAKE_RASTER);
          const k0 = ki * R + kj;
          if ((taken.has(k0) && i > 0) || dead.has(k0)) continue;
          // (Not where the river is held up over the ground beside it: water coming down there cannot reach it.)
          if (r.level[i] > G(k0) - STREAM_DEPTH + JOIN_TOL) {
            fr.held++;
            continue;
          }
          const w = walk(li, k0, tn, te, di === 0 ? FEED_LEN : FEED_LEN2);
          // Down the walk to the first point on the river's band (where a trace would join it).
          const path = w.reverse();
          let m = 0;
          while (m < path.length && occ[path[m]] === 0) m++;
          if (m >= path.length || m < FEED_MIN_STEPS || occLine(occ[path[m]]) !== li) {
            fr.short++;
            // (No way up from there: nor for the next donor's walk.)
            if (w.length < FEED_MIN_STEPS + 1) dead.add(k0);
            for (const k of w) if (k !== k0) taken.delete(k);
            continue;
          }
          const o = occ[path[m]];
          const L = rivers[li];
          const j = occIdx(o);
          let low = Infinity;
          for (let q = 0; q <= m; q++) low = Math.min(low, G(path[q]));
          // (Its water reaches the river's: not where the river is held up over the ground the walk came down.)
          if (L.level[j] > low - STREAM_DEPTH + JOIN_TOL) {
            fr.heldAfter++;
            for (const k of w) if (k !== k0) taken.delete(k);
            continue;
          }
          const before = streams.length;
          build(path.slice(0, m + 1), { kind: 'channel', line: li, idx: j, pool: -1, ok: true }, null, FEED_AREA, -1, d.area[dn]);
          const st = streams[before];
          if (!st || st.joins !== li) continue;
          built = true;
          fed++;
          fr.feeders++;
          fr.km += st.s[st.s.length - 1] / 1000;
          joinAt.push(st.joinS);
          first[li] = Math.min(first[li], st.joinS);
        }
      }
      if (fed) fr.fed++;
      else fr.unfed++;
    }
    joinAt.sort((a, b) => a - b);
    const q = (f: number): number => Math.round(joinAt[Math.min(joinAt.length - 1, Math.floor(f * joinAt.length))] ?? -1);
    report.feed = { ...(report.feed ?? {}), ...fr, firstFeeder, stops, joinP50: q(0.5), joinP90: q(0.9), ms: Math.round(performance.now() - tf), samples: report.samples - s0 };
  }



  report.tracePhases.push(performance.now() - t0);
  report.outletSamples = report.samples;
  /** Where each river's water starts to be fed (the first stream joining it, or the lake a feeder flows into), m. */
  const headFrom = new Float64Array(nR).fill(Infinity);
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
  feedHeads();
  // --- The gully chains (gullies.ts, a seeded world's mountains), after every other stream (the outlets, the lattice's
  // headwaters and the rivers' head feeders are traced first, exactly as without them, so they keep their courses):
  // every chain of the threshold hillslopes' own routing from where its catchment reaches chainArea() (below that the
  // ground shader paints it, rills.ts) is a stream down its chain, sized by the chain's catchment, on to where another
  // line, a lake or the sea takes it (or, where the pass ends, on down the ground as any trace). The longest chains
  // first: a valley's trunk is one line, each side gully's stream joins it.
  const gn = gullyNet();
  const chainStats = { heads: 0, traced: 0, km: 0, skipped: 0, crossed: 0, ms: 0, msTrace: 0, msBuild: 0, samples0: report.samples };
  if (gn && gn.n === R) {
    const tc = performance.now();
    const AV = chainArea();
    const up = new Uint8Array(R * R);
    for (let q = 0; q < R * R; q++) {
      if (!gn.dir[q] || gn.area[q] < AV) continue;
      const r = receiverOf(gn, q);
      if (r >= 0) up[r] = 1;
    }
    const cheads: number[] = [];
    for (let q = 0; q < R * R; q++) if (gn.dir[q] && gn.area[q] >= AV && !up[q]) cheads.push(q);
    const len = new Float64Array(cheads.length);
    cheads.forEach((q, i) => {
      let k = q;
      let L = 0;
      for (let r = receiverOf(gn, k); r >= 0 && L < 1e6; r = receiverOf(gn, k)) {
        L += Math.abs(r - k) === 1 || Math.abs(r - k) === R ? 1 : SQRT2;
        k = r;
      }
      len[i] = L;
    });
    const ord = cheads.map((_, i) => i).sort((a, b) => len[b] - len[a] || cheads[a] - cheads[b]);
    chainStats.heads = cheads.length;
    /** The chain being walked (besideChain, crossTo). */
    let chainPath: number[] = [];
    // The rivers' samples about every RIVER_INDEX_STEP m, by RIVER_INDEX_CELL cell: a chain come onto a river's floor
    // (the ground the slopes held for it, beside its core) crosses the floor to it.
    const rIdx = new Map<number, number[]>();
    const rKey = (nn: number, ee: number): number => Math.floor((nn - ORIGIN) / RIVER_INDEX_CELL) * 4096 + Math.floor((ee - ORIGIN) / RIVER_INDEX_CELL);
    for (let li = 0; li < nR; li++) {
      const r = rivers[li];
      let last = -Infinity;
      for (let i = 0; i < r.s.length; i++) {
        if (r.s[i] - last < RIVER_INDEX_STEP && i < r.s.length - 1) continue;
        last = r.s[i];
        const k = rKey(r.north[i], r.east[i]);
        const l = rIdx.get(k);
        if (l) l.push(li, i);
        else rIdx.set(k, [li, i]);
      }
    }
    /** The river a chain at raster point k crosses its floor to: its nearest sample within FLOOR_CROSS (the way there
     * never rising over the chain's ground at k, and its water no higher than the chain's can reach), or null. */
    /** Whether the water `mouth` a chain at the end of `path` would join backs up its last reach with no water standing
     * more than BACKUP_FILL over the ground (canReach's rule for the chain's own course). */
    const backsUp = (path: number[], mouth: number): boolean => {
      for (let i = path.length - 1; i >= 0; i--) {
        const g = G(path[i]) - STREAM_DEPTH;
        if (g >= mouth) return true;
        if (g < mouth - BACKUP_FILL) return false;
      }
      return false;
    };
    const besideChain = (k: number, low: number): End | null => {
      const ki = Math.floor(k / R);
      const kj = k % R;
      const g0 = G(k);
      for (let a = 0; a < 8; a++) {
        const nb = (ki + DI[a]) * R + kj + DJ[a];
        const o = occ[nb];
        if (o === 0 || occLine(o) < nR) continue;
        const st = streams[occLine(o) - nR];
        if (Math.abs(G(nb) - g0) > FLOOR_FLAT) continue;
        const j = occIdx(o);
        if (st.level[j] > low + JOIN_TOL || st.level[j] < g0 - FLOOR_DROP || !backsUp(chainPath, st.level[j])) continue;
        return { kind: 'channel', line: occLine(o), idx: j, pool: -1, ok: true };
      }
      return null;
    };
    /** Index a built stream's samples too (a later chain may cross a floor to it). */
    const indexLine = (li: number): void => {
      const r = lineAt(li);
      let last = -Infinity;
      for (let i = 0; i < r.s.length; i++) {
        if (r.s[i] - last < RIVER_INDEX_STEP && i < r.s.length - 1) continue;
        last = r.s[i];
        const k = rKey(r.north[i], r.east[i]);
        const l = rIdx.get(k);
        if (l) l.push(li, i);
        else rIdx.set(k, [li, i]);
      }
    };
    for (let j = 0; j < streams.length; j++) indexLine(nR + j);
    /** Whether a chain's raster point k lies in a V: the slopes' ground (gullies.ts GullyNet.h) on both sides across its
     * flow (the next points) stands V_SIDE m over it. */
    const H = gn.h;
    const inV = (k: number, next: number): boolean => {
      const ki = Math.floor(k / R);
      const kj = k % R;
      const di = Math.floor(next / R) - ki;
      const dj = (next % R) - kj;
      const g0 = H[k];
      return H[(ki + dj) * R + kj - di] - g0 > V_SIDE && H[(ki - dj) * R + kj + di] - g0 > V_SIDE;
    };
    /** Whether a chain's raster point k lies on an open floor: the slopes' ground on neither side across its flow stands
     * V_SIDE m over it (no V, no wall beside it), so its course need not keep to the raster point. */
    const onFloor = (k: number, next: number): boolean => {
      const ki = Math.floor(k / R);
      const kj = k % R;
      const di = Math.floor(next / R) - ki;
      const dj = (next % R) - kj;
      const g0 = H[k];
      return H[(ki + dj) * R + kj - di] - g0 < V_SIDE && H[(ki - dj) * R + kj + di] - g0 < V_SIDE;
    };
    const crossTo = (k: number, low: number): End | null => {
      const kn = ORIGIN + Math.floor(k / R) * LAKE_RASTER;
      const ke = ORIGIN + (k % R) * LAKE_RASTER;
      const c0 = rKey(kn, ke);
      let best = FLOOR_CROSS * FLOOR_CROSS;
      let bl = -1;
      let bi = -1;
      const span = Math.ceil(FLOOR_CROSS / RIVER_INDEX_CELL);
      for (let a = -span; a <= span; a++)
        for (let b = -span; b <= span; b++) {
          const l = rIdx.get(c0 + a * 4096 + b);
          if (!l) continue;
          for (let m = 0; m < l.length; m += 2) {
            const r = lineAt(l[m]);
            if (r.level[l[m + 1]] > low + JOIN_TOL) continue;
            const d2 = (r.north[l[m + 1]] - kn) ** 2 + (r.east[l[m + 1]] - ke) ** 2;
            if (d2 < best) {
              best = d2;
              bl = l[m];
              bi = l[m + 1];
            }
          }
        }
      if (bl < 0) return null;
      // (Refined to the nearest sample of that line about it.)
      const r = lineAt(bl);
      for (let i = Math.max(0, bi - 20); i < Math.min(r.s.length, bi + 20); i++) {
        const d2 = (r.north[i] - kn) ** 2 + (r.east[i] - ke) ** 2;
        if (d2 < best) {
          best = d2;
          bi = i;
        }
      }
      const mouth = r.level[bi];
      const g0 = G(k);
      // (A floor: the water there lies no more than FLOOR_DROP under the chain's ground - not a valley below, down a wall.)
      if (mouth > low + JOIN_TOL || mouth < g0 - FLOOR_DROP || !backsUp(chainPath, mouth)) return null;
      const L = Math.sqrt(best);
      // (The way across: never rising over the chain's ground, nor so low that the water backing up from the line it
      // joins would stand over it.)
      for (let t = FLOOR_STEP; t < L - r.halfWidth[bi]; t += FLOOR_STEP) {
        const f = t / L;
        const g = p.route(kn + (r.north[bi] - kn) * f, ke + (r.east[bi] - ke) * f);
        report.crossSamples = (report.crossSamples ?? 0) + 1;
        if (g > g0 + FLOOR_RISE || g - STREAM_DEPTH < mouth - BACKUP_FILL) return null;
      }
      return { kind: 'channel', line: bl, idx: bi, pool: -1, ok: true, cross: true };
    };
    for (const i of ord) {
      const q = cheads[i];
      if (occ[q] !== 0 || mask.poolAt(Math.floor(q / R), q % R) >= 0 || byHome(q) || G(q) <= 0.5) {
        chainStats.skipped++;
        continue;
      }
      // The chain down to the first point a line holds, a lake, the sea; or the pass's last node (the trace goes on).
      const path = [q];
      chainPath = path;
      const pathA = [gn.area[q]];
      /** Per point: 1 in a V or beside a wall (pinned to its raster point), 0 on an open floor (laid as a curve). */
      const pathV = [1];
      let low = G(q) - STREAM_DEPTH;
      let cross: End | null = null;
      for (let k = q, r = receiverOf(gn, k); r >= 0; k = r, r = receiverOf(gn, k)) {
        if (byHome(r)) break;
        // (Not into water standing higher than its own that it cannot back up to: the trace goes on round it.)
        if (occ[r] !== 0) {
          const o = occ[r];
          const T = lineAt(occLine(o));
          const j = occIdx(o);
          if (T.level[j] > Math.min(low, G(r) - STREAM_DEPTH) + JOIN_TOL && !(occLine(o) >= nR && j >= streams[occLine(o) - nR].held && T.level[j] - low <= CHAIN_LOWER)) break;
        }
        path.push(r);
        pathA.push(gn.dir[r] ? gn.area[r] : gn.area[k]);
        {
          const nx2 = receiverOf(gn, r);
          pathV.push(nx2 >= 0 ? (onFloor(r, nx2) ? 0 : 1) : 1);
        }
        if (occ[r] !== 0 || mask.poolAt(Math.floor(r / R), r % R) >= 0 || G(r) <= 0.5 || !gn.dir[r]) break;
        low = Math.min(low, G(r) - STREAM_DEPTH);
        // (On a river's floor, or a valley's floor out of the V's: across it to the water already there, not down the
        // floor beside it.)
        const nx = receiverOf(gn, r);
        if ((gn.core[r] > 0 || (nx >= 0 && !inV(r, nx))) && (cross = crossTo(r, low))) break;
        // (Beside a chain stream on the same floor - a neighbouring point of its course, the ground level across: the
        // raster's steepest descent runs parallel lines down an even floor where the water gathers into one.)
        if ((cross = besideChain(r, low))) break;
      }
      const before = streams.length;
      const tt = performance.now();
      const t = cross ? { path, end: cross } : trace(path, -1, G(q), true, CHAIN_CLIMB, true);
      if (cross) chainStats.crossed++;
      const tb = performance.now();
      build(t.path, t.end, null, gn.area[q], -1, -1, pathA, null, pathV);
      chainStats.msTrace += tb - tt;
      chainStats.msBuild += performance.now() - tb;
      if (streams.length > before) {
        indexLine(nR + before);
        chainStats.traced++;
        chainStats.km += streams[before].s[streams[before].s.length - 1] / 1000;
      }
    }
    chainStats.ms = performance.now() - tc;
    chainStats.samples0 = report.samples - chainStats.samples0;
  }
  report.chains = chainStats;
  // --- A stream that ended in a hollow (after every other is traced, so none of their courses changes) runs on out of
  // it as a continuation from its end: down the threshold hillslopes' routing, over a sill up to CHAIN_CLIMB, or to the
  // nearest water lying under its own (trace's way out), with the whole of its catchment.
  const conts: Array<{ old: number; cont: number; at0: number }> = [];
  {
    const nBefore = streams.length;
    for (let j = 0; j < nBefore; j++) {
      const st = streams[j];
      // (A lake's outlet too: it may sink below its lake as any stream may.)
      if (st.end !== 'sink' || st.joins >= 0 || st.endK < 0) continue;
      const lvl = st.level[st.level.length - 1];
      // (From the raster point at its last point: a stream that sank short of water standing over its own was cut back.)
      const m = st.north.length - 1;
      const k0 = Math.round((st.north[m] - ORIGIN) / LAKE_RASTER) * R + Math.round((st.east[m] - ORIGIN) / LAKE_RASTER);
      const t = trace([k0], -1, lvl + STREAM_DEPTH, false, CONT_CLIMB, true, nR + j, CONT_CONNECT_R);
      const why = (w: string): void => {
        (report.endWhy ??= {})[nR + j] = w;
      };
      if (t.end.kind === 'sink' || t.end.kind === 'stuck' || t.path.length < 2) {
        why(`cont: ${t.end.kind}${t.end.why ? ` (${t.end.why})` : ''}, ${t.path.length} points`);
        continue;
      }
      const before = streams.length;
      const a0 = st.area[st.area.length - 1];
      // (From its stream's last point and water: a continuation never stands over the water it carries on.)
      build(t.path, t.end, { north: st.north[m], east: st.east[m], level: lvl }, a0, -1, a0);
      if (streams.length === before) continue;
      // (Nor where the water it joins runs back into its stream: no loop.)
      let loop = false;
      for (let L = streams[before].joins, g = 0; L >= nR && g < 200; L = streams[L - nR].joins, g++) if (L === nR + j) loop = true;
      if (streams[before].end === 'sink' || loop) {
        why(loop ? 'cont: would loop' : 'cont: sank again');
        // (It sank again, or would loop: not kept, nor its marks.)
        streams.pop();
        for (let q = 0; q < occ.length; q++) if (occ[q] !== 0 && occLine(occ[q]) === nR + before) occ[q] = 0;
        report.traced--;
        continue;
      }
      st.end = 'channel';
      st.joins = nR + before;
      st.joinS = 0;
      st.continued = true;
      conts.push({ old: j, cont: before, at0: a0 });
    }
    report.continued = conts.length;
  }
  /** Whether a straight reach from stream st's end to (tn, te) crosses its own course. */
  const crossesOwn = (st: StreamLine, tn: number, te: number, upTo = -1): boolean => {
    const m0 = upTo >= 0 ? upTo : st.north.length - 1;
    const ax = st.east[m0], ay = st.north[m0];
    for (let i = 0; i + 2 < m0; i++) {
      const cx = st.east[i], cy = st.north[i], dx = st.east[i + 1], dy = st.north[i + 1];
      if (Math.max(cx, dx) < Math.min(ax, te) - 1 || Math.min(cx, dx) > Math.max(ax, te) + 1 || Math.max(cy, dy) < Math.min(ay, tn) - 1 || Math.min(cy, dy) > Math.max(ay, tn) + 1) continue;
      const d1 = (te - ax) * (cy - ay) - (tn - ay) * (cx - ax);
      const d2 = (te - ax) * (dy - ay) - (tn - ay) * (dx - ax);
      const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
      const d4 = (dx - cx) * (tn - cy) - (dy - cy) * (te - cx);
      if (d1 * d2 < 0 && d3 * d4 < 0) return true;
    }
    return false;
  };
  /** Run stream st on in a straight reach to (tn, te): its water follows the routing ground down under it (never rising,
   * never over the ground), to `end` at most at the far end. */
  const appendTo = (st: StreamLine, tn: number, te: number, end: number): void => {
    const m = st.north.length;
    const n0 = st.north[m - 1], e0 = st.east[m - 1], s0 = st.s[m - 1], a0 = st.area[m - 1], h0 = st.halfWidth[m - 1];
    const dist = Math.hypot(tn - n0, te - e0);
    const add = Math.max(1, Math.ceil(dist / STREAM_SPACING));
    const N2 = m + add;
    const grow = (a: Float64Array): Float64Array => {
      const out = new Float64Array(N2);
      out.set(a);
      return out;
    };
    st.north = grow(st.north);
    st.east = grow(st.east);
    st.level = grow(st.level);
    st.s = grow(st.s);
    st.area = grow(st.area);
    st.halfWidth = grow(st.halfWidth);
    st.breach = grow(st.breach);
    st.cut = grow(st.cut);
    let lv = st.level[m - 1];
    for (let q = 1; q <= add; q++) {
      const t = q / add;
      const i = m - 1 + q;
      st.north[i] = n0 + (tn - n0) * t;
      st.east[i] = e0 + (te - e0) * t;
      const g = p.route(st.north[i], st.east[i]);
      lv = Math.min(lv, g - STREAM_DEPTH);
      if (q === add) lv = Math.min(lv, end);
      st.level[i] = lv;
      st.cut[i] = Math.max(0, g - STREAM_DEPTH - lv);
      st.breach[i] = breachOfCut(st.cut[i]);
      st.s[i] = s0 + dist * t;
      st.area[i] = a0;
      st.halfWidth[i] = h0;
    }
  };
  /** Stream st (index j) cut to its first `n` samples. */
  const truncate = (st: StreamLine, j: number, n: number): void => {
    if (n >= st.north.length) return;
    st.north = st.north.slice(0, n);
    st.east = st.east.slice(0, n);
    st.level = st.level.slice(0, n);
    st.s = st.s.slice(0, n);
    st.area = st.area.slice(0, n);
    st.halfWidth = st.halfWidth.slice(0, n);
    st.breach = st.breach.slice(0, n);
    st.cut = st.cut.slice(0, n);
    // (Its raster marks past them are cleared: no later trace may join water that is no longer there.)
    for (let q = 0; q < occ.length; q++) if (occ[q] !== 0 && occLine(occ[q]) === nR + j && occIdx(occ[q]) >= n) occ[q] = 0;
    // (The streams that joined it on the part cut off run on to its new end.)
    const sEnd = st.s[n - 1];
    for (const o of streams) {
      if (o.joins !== nR + j || o.joinS <= sEnd) continue;
      if (!crossesOwn(o, st.north[n - 1], st.east[n - 1])) appendTo(o, st.north[n - 1], st.east[n - 1], st.level[n - 1]);
      o.joinS = sEnd;
    }
  };
  /** Stream j, ending at raster point k0, runs on to the nearest other line's sample within JOIN_REACH raster steps
   * (its course straight there, its water no higher than at its end): whether it found one. */
  const joinBeside = (j: number, k0: number): boolean => {
    const st = streams[j];
    const ki = Math.floor(k0 / R);
    const kj = k0 % R;
    let best = -1;
    let bd = Infinity;
    for (let a = -JOIN_REACH; a <= JOIN_REACH; a++)
      for (let b = -JOIN_REACH; b <= JOIN_REACH; b++) {
        const qi = ki + a;
        const qj = kj + b;
        if (qi < 0 || qj < 0 || qi >= R || qj >= R) continue;
        const o = occ[qi * R + qj];
        if (o === 0 || occLine(o) === nR + j) continue;
        // (Not a line that runs back into this one.)
        let loop = false;
        for (let L = occLine(o), g = 0; L >= nR && g < 200; L = streams[L - nR].joins, g++) if (L === nR + j) loop = true;
        if (loop) continue;
        const d = Math.hypot(a, b);
        if (d >= bd) continue;
        // (Not across its own course.)
        const T = lineAt(occLine(o));
        const tn = T.north[occIdx(o)], te = T.east[occIdx(o)];
        const m0 = st.north.length - 1;
        const ax = st.east[m0], ay = st.north[m0];
        let cross = false;
        for (let i = 0; i + 2 < m0 && !cross; i++) {
          const cx = st.east[i], cy = st.north[i], dx = st.east[i + 1], dy = st.north[i + 1];
          if (Math.max(cx, dx) < Math.min(ax, te) - 1 || Math.min(cx, dx) > Math.max(ax, te) + 1 || Math.max(cy, dy) < Math.min(ay, tn) - 1 || Math.min(cy, dy) > Math.max(ay, tn) + 1) continue;
          const d1 = (te - ax) * (cy - ay) - (tn - ay) * (cx - ax);
          const d2 = (te - ax) * (dy - ay) - (tn - ay) * (dx - ax);
          const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
          const d4 = (dx - cx) * (tn - cy) - (dy - cy) * (te - cx);
          if (d1 * d2 < 0 && d3 * d4 < 0) cross = true;
        }
        if (cross) continue;
        bd = d;
        best = o;
      }
    if (best < 0) return false;
    const L = lineAt(occLine(best));
    const idx = occIdx(best);
    appendTo(st, L.north[idx], L.east[idx], L.level[idx]);
    st.end = 'channel';
    st.joins = occLine(best);
    st.joinS = L.s[idx];
    return true;
  };
  // --- A stream that still ends in a hollow fills it: the hollow (a priority flood from its end over the routing
  // ground, up to its lowest sill) becomes a pond at its spill (LakeMask.addPond), and the pond's outlet runs on from
  // the sill as any lake's (outletPath, trace). A hollow too big (POND_MAX raster points) or deep (POND_DEEP) for that,
  // or by the home field, stays a sink.
  {
    const nBefore = streams.length;
    const ponds: number[] = [];
    for (let j = 0; j < nBefore; j++) {
      const st = streams[j];
      if (st.end !== 'sink' || st.joins >= 0) continue;
      const m = st.north.length - 1;
      const kEnd = Math.round((st.north[m] - ORIGIN) / LAKE_RASTER) * R + Math.round((st.east[m] - ORIGIN) / LAKE_RASTER);
      // (From the hollow's bottom: steepest descent over the routing ground from its end, past the stream's own points.)
      let k0 = kEnd;
      for (let step = 0; step < 400; step++) {
        const ci = Math.floor(k0 / R);
        const cj = k0 % R;
        let nb = -1;
        let low = G(k0);
        for (let a = 0; a < 8; a++) {
          const qi = ci + DI[a];
          const qj = cj + DJ[a];
          if (qi < 1 || qj < 1 || qi >= R - 1 || qj >= R - 1) continue;
          const q = qi * R + qj;
          if ((occ[q] !== 0 && occLine(occ[q]) !== nR + j) || mask.poolAt(qi, qj) >= 0) continue;
          if (G(q) < low) {
            low = G(q);
            nb = q;
          }
        }
        if (nb < 0) break;
        k0 = nb;
      }
      const heap = new MinHeap(8 * (POND_MAX + 2));
      const seen = new Set<number>([k0]);
      const popped: number[] = [];
      /** The flood's height at a raster point: its ground, or another line's water there where that stands higher (the
       * hollow's water cannot run into a line standing over it: it is a wall to the flood, up to that water). */
      const HF = (c: number): number => (occ[c] !== 0 && occLine(occ[c]) !== nR + j ? Math.max(G(c), lineAt(occLine(occ[c])).level[occIdx(occ[c])]) : G(c));
      heap.push(k0, HF(k0));
      let lvl = -Infinity;
      let sill = -1;
      let ok = true;
      while (heap.size > 0) {
        const c = heap.pop();
        const g = HF(c);
        // (Another line's water no higher than the flood's (JOIN_TOL): the hollow spills into that line there.)
        const other = occ[c] !== 0 && occLine(occ[c]) !== nR + j && lineAt(occLine(occ[c])).level[occIdx(occ[c])] <= Math.max(lvl, HF(k0)) + JOIN_TOL;
        if (g < lvl - 0.01 || other || (mask.poolAt(Math.floor(c / R), c % R) >= 0) || g <= 0.5) {
          // Over the sill: lower ground, another line's water, a lake, the sea.
          sill = c;
          break;
        }
        lvl = Math.max(lvl, g);
        popped.push(c);
        if (popped.length > POND_MAX || lvl - G(k0) > POND_DEEP || byHome(c)) {
          const why = popped.length > POND_MAX ? 'big' : byHome(c) ? 'home' : 'deep';
          (report.pondWhy ??= {})[why] = (report.pondWhy[why] ?? 0) + 1;
          ok = false;
          break;
        }
        const ci = Math.floor(c / R);
        const cj = c % R;
        for (let a = 0; a < 8; a++) {
          const qi = ci + DI[a];
          const qj = cj + DJ[a];
          if (qi < 1 || qj < 1 || qi >= R - 1 || qj >= R - 1) continue;
          const q = qi * R + qj;
          if (seen.has(q)) continue;
          seen.add(q);
          heap.push(q, HF(q));
        }
      }
      if (ok && sill < 0) (report.pondWhy ??= {}).nosill = (report.pondWhy.nosill ?? 0) + 1;
      const ew = (report.endWhy ??= {});
      const why0 = ew[nR + j] ?? '';
      if (!ok || sill < 0) {
        // (Too big or deep a hollow to fill: it joins water beside it, if any.)
        const big = popped.length > POND_MAX ? `big (${popped.length} points)` : lvl - G(k0) > POND_DEEP ? `deep (${(lvl - G(k0)).toFixed(0)} m)` : sill < 0 ? 'no sill' : 'by home';
        if (joinBeside(j, kEnd)) (report.pondWhy ??= {}).joinedBig = (report.pondWhy.joinedBig ?? 0) + 1;
        else ew[nR + j] = `${why0}; pond: ${big}; join within ${JOIN_REACH} steps: none`;
        continue;
      }
      // Its water stands at the sill, POND_DROP under it: the points under that.
      const level = lvl - POND_DROP;
      const pts: number[] = [];
      const gs: number[] = [];
      for (const c of popped) {
        // (Not another line's points: its water stands over the pond's.)
        if (G(c) < level && !(occ[c] !== 0 && occLine(occ[c]) !== nR + j)) {
          pts.push(c);
          gs.push(G(c));
        }
      }
      if (pts.length === 0 && occ[sill] !== 0 && occLine(occ[sill]) !== nR + j) {
        // (No hollow, and the way on is another line's water, no higher than its own: it runs in there.)
        const L = lineAt(occLine(occ[sill]));
        const idx = occIdx(occ[sill]);
        let loop = false;
        for (let Lj = occLine(occ[sill]), g2 = 0; Lj >= nR && g2 < 200; Lj = streams[Lj - nR].joins, g2++) if (Lj === nR + j) loop = true;
        if (!loop && !crossesOwn(st, L.north[idx], L.east[idx])) {
          appendTo(st, L.north[idx], L.east[idx], L.level[idx]);
          st.end = 'channel';
          st.joins = occLine(occ[sill]);
          st.joinS = L.s[idx];
          (report.pondWhy ??= {}).sillLine = (report.pondWhy.sillLine ?? 0) + 1;
          continue;
        }
      }
      if (pts.length === 0) {
        (report.pondWhy ??= {}).flat = (report.pondWhy.flat ?? 0) + 1;
        // (No hollow: it stopped beside water standing over its own - a river held up on its floor, a stream - that its
        // trace may not step into. It runs in there: on to that line's nearest sample within JOIN_REACH raster steps,
        // its water level, as at any mouth, under the other's.)
        if (joinBeside(j, kEnd)) (report.pondWhy ??= {}).joined = (report.pondWhy.joined ?? 0) + 1;
        else if (!(sill >= 0 && occ[sill] === 0)) ew[nR + j] = `${why0}; pond: flat (no point under the sill), join: none; run on: the sill is another line's (${sill >= 0 ? occLine(occ[sill]) : -1})`;
        else if (sill >= 0 && occ[sill] === 0) {
          // (Else on down from the lower ground beside it, as a continuation.)
          const lvl0 = st.level[m];
          const t = trace([sill], -1, lvl0 + STREAM_DEPTH, false, CONT_CLIMB, true, nR + j, CONT_CONNECT_R);
          if (!(t.end.kind !== 'sink' && t.end.kind !== 'stuck' && t.path.length >= 2)) ew[nR + j] = `${why0}; pond: flat, join: none; run on from the sill: ${t.end.kind}${t.end.why ? ` (${t.end.why})` : ''}, ${t.path.length} points`;
          if (t.end.kind !== 'sink' && t.end.kind !== 'stuck' && t.path.length >= 2) {
            const before = streams.length;
            const a0 = st.area[m];
            build(t.path, t.end, { north: st.north[m], east: st.east[m], level: lvl0 }, a0, -1, a0);
            if (!(streams.length > before)) ew[nR + j] = `${why0}; pond: flat, join: none; run on from the sill: not built`;
            if (streams.length > before && streams[before].end !== 'sink') {
              st.end = 'channel';
              st.joins = nR + before;
              st.joinS = 0;
              st.continued = true;
              (report.pondWhy ??= {}).ranOn = (report.pondWhy.ranOn ?? 0) + 1;
            } else if (streams.length > before) {
              ew[nR + j] = `${why0}; pond: flat, join: none; run on from the sill: sank again`;
              streams.pop();
              for (let q = 0; q < occ.length; q++) if (occ[q] !== 0 && occLine(occ[q]) === nR + before) occ[q] = 0;
              report.traced--;
            }
          }
        }
        // (A raster artefact: no water would stand here. The stream runs on over the sill.)
        continue;
      }
      const id = mask.addPond(pts, gs, level, sill);
      ponds.push(id, pts.length);
      st.end = 'lake';
      // (Into the pond's water: on to its nearest point where the stream's end stands over it.)
      const inPond = mask.at(st.north[m], st.east[m]) > -Infinity;
      (report.pondWhy ??= {})[inPond ? 'endIn' : 'endOut'] = (report.pondWhy[inPond ? 'endIn' : 'endOut'] ?? 0) + 1;
      if (!inPond) {
        let done = false;
        const order = pts.map((q) => ({ q, d: Math.hypot(ORIGIN + Math.floor(q / R) * LAKE_RASTER - st.north[m], ORIGIN + (q % R) * LAKE_RASTER - st.east[m]) })).sort((a, b) => a.d - b.d || a.q - b.q);
        for (const { q } of order) {
          const tn = ORIGIN + Math.floor(q / R) * LAKE_RASTER;
          const te = ORIGIN + (q % R) * LAKE_RASTER;
          if (crossesOwn(st, tn, te)) continue;
          appendTo(st, tn, te, level);
          done = true;
          break;
        }
        if (!done) {
          // (Every straight way in from its end crosses its own course: its course ran past the pond, or through it, and
          // turned back. It ends where its course first comes into the pond's water, or nearest the pond, cut there.)
          let cutAt = -1;
          const inThis = (i: number): boolean => mask.poolAt(Math.round((st.north[i] - ORIGIN) / LAKE_RASTER), Math.round((st.east[i] - ORIGIN) / LAKE_RASTER)) === id;
          for (let i = 1; i < st.north.length && cutAt < 0; i++) if (inThis(i)) cutAt = i;
          if (cutAt < 0) {
            let bd = 2 * LAKE_RASTER;
            for (let i = 1; i < st.north.length; i++)
              for (const q of pts) {
                const d = Math.hypot(ORIGIN + Math.floor(q / R) * LAKE_RASTER - st.north[i], ORIGIN + (q % R) * LAKE_RASTER - st.east[i]);
                if (d < bd) {
                  bd = d;
                  cutAt = i;
                }
              }
          }
          // (Cut as little as it may: from the last of its samples after that from which a straight reach of at most
          // two raster steps runs into the pond without crossing its course before it.)
          let into = -1;
          for (let i = st.north.length - 2; i > cutAt && into < 0 && cutAt > 0; i--) {
            let bq = -1;
            let bd = 2 * LAKE_RASTER;
            for (const q of pts) {
              const tn = ORIGIN + Math.floor(q / R) * LAKE_RASTER;
              const te = ORIGIN + (q % R) * LAKE_RASTER;
              const d = Math.hypot(tn - st.north[i], te - st.east[i]);
              if (d < bd && !crossesOwn(st, tn, te, i)) {
                bd = d;
                bq = q;
              }
            }
            if (bq >= 0) {
              cutAt = i;
              into = bq;
            }
          }
          // (Not where that would cut away most of it: there its course ran through the pond's hollow and on over a
          // sill to end in another; it stays a sink.)
          const cutLen = cutAt > 0 ? st.s[st.s.length - 1] - st.s[cutAt] : 0;
          if (cutAt > 0 && cutLen <= CUT_BACK && cutLen <= 0.5 * st.s[st.s.length - 1]) {
            truncate(st, j, cutAt + 1);
            if (into >= 0) appendTo(st, ORIGIN + Math.floor(into / R) * LAKE_RASTER, ORIGIN + (into % R) * LAKE_RASTER, level);
            (report.pondWhy ??= {}).cutBack = (report.pondWhy.cutBack ?? 0) + 1;
            done = true;
          } else {
            ew[nR + j] = `${why0}; pond: filled (${pts.length} points), every way in crosses its own course; ${cutAt > 0 ? `cutting it back into the pond would take ${(cutLen / 1000).toFixed(1)} of its ${(st.s[st.s.length - 1] / 1000).toFixed(1)} km` : `none of it within ${2 * LAKE_RASTER} m`}`;
            (report.pondWhy ??= {}).allCross = (report.pondWhy.allCross ?? 0) + 1;
            st.end = 'sink';
          }
        }
      }
      const me = st.north.length - 1;
      st.level[me] = Math.min(st.level[me], level);
      // The outlet, from the pond's lowest way out.
      const out = outletPath(id);
      if (!out) continue;
      const kk = out.path[0];
      const first = { north: ORIGIN + Math.floor(kk / R) * LAKE_RASTER, east: ORIGIN + (kk % R) * LAKE_RASTER, level };
      const t = out.end ? { path: out.path.slice(1), end: { ...out.end, ok: true } } : trace(out.path.slice(1), id, level, false, CONT_CLIMB, true, -1, CONT_CONNECT_R);
      build(t.path, t.end, first, Math.max(1, st.area[st.area.length - 1]), id);
    }
    report.ponds = ponds;
  }
  // (Where a river's water starts: a chain or a continuation may join it above its first feeder - riverNetwork.ts trims
  // the river's head to the first junction.)
  for (const st of streams) if (st.joins >= 0 && st.joins < nR) headFrom[st.joins] = Math.min(headFrom[st.joins], st.joinS);
  // (Where a river's water starts: a chain may join it above its first feeder - riverNetwork.ts trims the river's head
  // to the first junction.)

  report.tracePhases.push(performance.now() - t0);
  // --- Catchment summed down the network: each stream's own (its source and what it gathers), plus every stream
  // that joins it from its confluence on (latest first: a stream only ever joins one traced before it).
  for (let j = streams.length - 1; j >= 0; j--) {
    const st = streams[j];
    if (st.joins >= nR) {
      const P = streams[st.joins - nR];
      const add = st.area[st.area.length - 1];
      // (Run on as a continuation: its catchment is carried over below, whole.)
      if (st.continued) continue;
      // (A chain joining a chain stream on its chain: the chain's catchment holds its water already, and so does the
      // rest.)
      if (st.chainS >= 0 && P.chainS >= 0 && st.joinS <= P.chainS + 1e-6) continue;
      // (A chain joining a lattice stream, or another stream joining a chain stream on its chain: the one catchment
      // holds the other's slopes already (the lattice's with LATERAL_GAIN, the chain's on the slopes' routing): the
      // receiver is never narrower than what joins it below the junction, not summed with it.)
      if ((st.chainS >= 0 && P.chainS < 0) || (P.chainS >= 0 && st.joinS <= P.chainS + 1e-6)) {
        for (let i = 0; i < P.s.length; i++) if (P.s[i] >= st.joinS - 1e-6) P.area[i] = Math.max(P.area[i], add);
        continue;
      }
      for (let i = 0; i < P.s.length; i++) if (P.s[i] >= st.joinS - 1e-6) P.area[i] += add;
    }
  }
  // (A continuation carries what its stream gathered after it was traced - the streams that joined it since - on down
  // its receivers.)
  for (let c = conts.length - 1; c >= 0; c--) {
    const { old, cont, at0 } = conts[c];
    const delta = streams[old].area[streams[old].area.length - 1] - at0;
    if (!(delta > 0)) continue;
    let L = streams[cont];
    for (let i = 0; i < L.area.length; i++) L.area[i] += delta;
    for (let guard = 0; L.joins >= nR && guard < 100; guard++) {
      const P = streams[L.joins - nR];
      for (let i = 0; i < P.s.length; i++) if (P.s[i] >= L.joinS - 1e-6) P.area[i] += delta;
      L = P;
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
  return { streams, report, headAt: headFrom };
}

/**
 * Cut out any loop where a course crosses itself (the smoothing can fold a hairpin of the raster course over): from
 * the first segment that a later one crosses, straight to the crossing and on along the later one (in place). The
 * water keeps the lower level there.
 */
function untangleCourse(n: number[], e: number[], lv: number[], gr: number[], ar?: number[]): void {
  const CELL = 100;
  for (let pass = 0; pass < 64; pass++) {
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
      if (ar) ar.splice(i + 1, hit - i, ar[i] + t * (ar[i + 1] - ar[i]));
      cut = true;
    }
    if (!cut) return;
  }
}

/**
 * A stream's wander: the course traced on the 250 m raster runs in straight reaches between its points; a stream
 * wanders about such a line within its gully floor. Each sample is moved across the course by a sum of two long waves
 * (WANDER_WAVE and WANDER_WAVE2 channel widths, at least WANDER_MIN m; each stream its own phases, their swing waxing
 * and waning over WANDER_SWING waves), WANDER_AMP widths
 * (WANDER_LO to WANDER_HI m) at most, fading in and out over WANDER_END at the ends and nil in a lake. Where the moved
 * course climbs the gully's side - the ground under a looked-at sample (every LEVEL_EVERY-th) stands more than
 * WANDER_CLIMB m over the ground at its place on the line - the wander is cut back there (to the share that keeps the
 * climb within it, eased over the samples about it), and looked at again. Edits the course in place; returns the
 * ground under each looked-at sample as moved (NaN elsewhere), for the level.
 */
const WANDER_AMP = 1.0;
const WANDER_LO = 5;
const WANDER_HI = 20;
const WANDER_WAVE = 14;
const WANDER_WAVE2 = 2.3;
/** ... its swing waxing and waning over this many of the first wave's lengths. */
const WANDER_SWING = 4.7;
const WANDER_MIN = 200;
const WANDER_END = 150;
const WANDER_CLIMB = 1.5;
/** Moves under this, m, are not checked for a climb (on a side at 1:2 they rise at most WANDER_CLIMB). */
const WANDER_CHECK = 3;
function wander(n: number[], e: number[], ground: (north: number, east: number) => number, wet: (north: number, east: number) => boolean, id: number, area0: number, outlet: boolean, report: StreamReport): Float64Array {
  const m = n.length;
  const seen = new Float64Array(m).fill(NaN);
  if (m < 4) return seen;
  const s = new Float64Array(m);
  for (let i = 1; i < m; i++) s[i] = s[i - 1] + Math.hypot(n[i] - n[i - 1], e[i] - e[i - 1]);
  const total = s[m - 1];
  const h = hash2i(id, 0x3a7d);
  const ph1 = ((h & 0xffff) / 65536) * 2 * Math.PI;
  const ph2 = ((h >>> 16) / 65536) * 2 * Math.PI;
  const off = new Float64Array(m);
  const un = new Float64Array(m);
  const ue = new Float64Array(m);
  for (let i = 1; i < m - 1; i++) {
    // (The width it will have there: its catchment as build() will reckon it, roughly.)
    const w = 2 * channelHalfWidth((outlet ? area0 : HEAD_START_AREA + (area0 - HEAD_START_AREA) * smooth(0, HEAD_RAMP, s[i])) + (LATERAL_GAIN * s[i]) / 1000);
    const lam = Math.max(WANDER_MIN, WANDER_WAVE * w);
    const amp = Math.min(WANDER_HI, Math.max(WANDER_LO, WANDER_AMP * w));
    const fade = smooth(0, WANDER_END, s[i]) * smooth(0, WANDER_END, total - s[i]);
    if (fade <= 0 || wet(n[i], e[i])) continue;
    // (Its swing waxing and waning along the stream, so the bends are not a regular wave.)
    const swing = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin((2 * Math.PI * s[i]) / (WANDER_SWING * lam) + ph1 * 1.7 + ph2));
    off[i] = amp * fade * swing * (0.65 * Math.sin((2 * Math.PI * s[i]) / lam + ph1) + 0.35 * Math.sin((2 * Math.PI * s[i]) / (WANDER_WAVE2 * lam) + ph2));
    const tn = n[i + 1] - n[i - 1];
    const te = e[i + 1] - e[i - 1];
    const tl = Math.hypot(tn, te) || 1;
    un[i] = -te / tl;
    ue[i] = tn / tl;
  }
  // The looked-at samples: the ground under each as moved and at its place on the line; cut back where it climbs.
  const keep = new Float64Array(m).fill(1);
  const look: number[] = [];
  for (let i = 1; i < m - 1; i += LEVEL_EVERY) look.push(i);
  for (const i of look) {
    // (A small move cannot climb far up a gully's side: not looked at here; the level looks at it as moved.)
    if (Math.abs(off[i]) < WANDER_CHECK) continue;
    const g0 = ground(n[i], e[i]);
    const g1 = ground(n[i] + un[i] * off[i], e[i] + ue[i] * off[i]);
    report.levelSamples += 2;
    if (g1 - g0 > WANDER_CLIMB) keep[i] = Math.max(0, WANDER_CLIMB / (g1 - g0));
    else seen[i] = g1;
  }
  // (Eased over the samples about a cut: the least keep within LEVEL_EVERY, smoothed.)
  const k2 = Float64Array.from(keep);
  for (let i = 0; i < m; i++) for (let j = Math.max(0, i - LEVEL_EVERY); j <= Math.min(m - 1, i + LEVEL_EVERY); j++) k2[i] = Math.min(k2[i], keep[j] + (1 - keep[j]) * (Math.abs(j - i) / (LEVEL_EVERY + 1)));
  let cut = 0;
  for (let i = 1; i < m - 1; i++) {
    if (k2[i] < 1) {
      cut++;
      seen[i] = NaN;
    }
    n[i] += un[i] * off[i] * k2[i];
    e[i] += ue[i] * off[i] * k2[i];
  }
  report.wanderCut += cut;
  report.wanderSamples += m - 2;
  return seen;
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

