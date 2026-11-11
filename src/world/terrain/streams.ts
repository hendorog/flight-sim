// A seeded world's streams (any seed but 0): the small channels the river network (riverNetwork.ts) leaves out - the
// outlet of every lake no river runs through, and the headwaters above the rivers' sources - traced at load in every
// thread, and the flow along every channel (rivers and streams): how steep it runs, how fast, and where it falls.
//
// The rivers come from the drainage's 1 km lattice (drainage.ts, RIVER_AREA). A stream is too small for that lattice:
// it runs in the gullies and side valleys between its cells. So each one is traced down the terrain itself, on the
// 250 m raster the lakes are flooded on (LakeMask), by steepest descent (D8) over the ground as the terrain draws it
// along a stream (the natural ground without its small-scale relief and finest gullies, with the rivers' valleys cut
// into it: heightfield.ts naturalHeightSmooth, carveNetwork): it seeks the lowest point, step by step, until it reaches
// a river or a stream already traced (a confluence), a lake or the sea, and joins the water it reaches there (its last
// reach backs up to that water where it came lower). Where the descent finds no lower neighbour (a hollow finer than the
// lattice) the hollow fills and spills, by the drainage's own rule (drainage.ts, breach-or-fill): a priority flood from
// it finds its true spill, the stream wears a notch through the spill no deeper than a stream of its catchment keeps
// through a rim (breachAllowance), and a hollow deeper than that holds a pond at the spill less the notch - drawn as a
// lake by the lakes' rule (LakeMask.addPond: deep and wide enough, its shore a margin under its rim) - that the stream
// crosses at its level and leaves over the spill; where the hollow spills into water standing higher, its pond stands
// at that water's level (a backwater). So no stream ends in a hollow. A lake's outlet leaves where the lake naturally
// spills, by the lowest way out of its basin (a priority flood from its water) when that rises no more than OUTLET_SILL
// over the water; a lake with no such way out has no outlet (its water seeps away and evaporates). The tarns are the
// drainage's small lakes in the high country (drainage.ts).
//
// A stream is a cheap class: no meanders, no floodplain or valley, just a narrow notch (heightfield.ts carveNetwork).
// Its water follows the ground down (the running minimum of the ground along its course, a little under it, looked at
// again between the raster points), its width grows with the catchment (summed at each confluence: a step up), and
// down a steep slope it is a continuous cascade, its water following the ground (refineSteep). It falls only where the
// ground breaks (falls.ts: a fault, a hanging valley's lip, a lake perched on a wall).

import { breachAllowance, DOMAIN_HALF, DRAIN_CELL, HOLLOW_TOL, LAKE_MARGIN, LAKE_MIDDLE_DEPTH, LAKE_RASTER, MinHeap, RASTER_N, RIVER_AREA, type Drainage, type LakeMask } from './drainage';
import { hash2i } from './noise';
import { gullyNet, receiverOf } from './gullies';
import { slopeParams } from './hillslopes';
import { CHANNEL_AREA } from './erosion';
import { AIRPORT } from '../../core/world';

/** Water stands this far under the ground at each raster point of a stream's course, m. */
const STREAM_DEPTH = 1.0;
/** Catchment a stream gathers along its course from the slopes either side, km² per km. */
const LATERAL_GAIN = 2;
/** A headwater stream starts as if draining this much, km² (about 1.2 m half-width), and gathers its head cell's
 * catchment over HEAD_RAMP, m. */
export const HEAD_START_AREA = 6;
const HEAD_RAMP = 2000;
/** A river whose head is in no lake begins where the first stream joins it, when that is within FEED_JOIN m of its head
 * (riverNetwork.ts trims its head there: no trickle runs on above its first tributary). */
export const FEED_JOIN = 1500;
/** The ground under every this many stream samples is checked for a dip between the raster points. */
const LEVEL_EVERY = 3;
/** ... and those between them too where the level falls this much from one to the next, m. */
const STEEP_RECHECK = 3;
/** Stream sample spacing, m. */
export const STREAM_SPACING = 50;
/** The most raster points a hollow's flood (trace, fill and spill) visits before the stream ends in it (about 75 km²: a
 * closed basin that big is the drainage's, not a stream's). */
const POND_MAX = 1200;
/**
 * Owner decision 3 (default: the recommendation). A pond a stream's hollow would hold (trace, fill and spill) over
 * POND_KEEP km² is not kept where its spill stands POND_SILL_CUT m or less over its bottom: the stream cuts through the
 * spill instead, and no lake is made. A spill higher than that keeps the lake; so does a pond that is the backwater of the
 * water it spills into.
 */
const POND_KEEP = 3;
const POND_SILL_CUT = 15;
/**
 * Round T, square corners. A stream reaching a line's channel (its raster point within RIVER_TOUCH of it) joined it at
 * the most upstream of the receiver's samples that marked that point: coming in from beside the receiver, it hooked
 * back upstream to it (barbed: seed 42's line 517 into river 64 at 146 degrees). Where the way in from its last raster
 * point points back up the receiver by more than BARB_ANGLE (less than the 120 degrees the gate counts: the smoothing
 * turns the last reach further), it now joins downstream as water does: along a curve into the receiver (junction, as
 * a chain off an open floor), else at the receiver's sample nearest its last point. Off (round T default): as before -
 * on, it takes barbed mouths to 3.3/3.9/3.1 % (seeds 1/42/777777) and line 517's hook away, but drawnGate (i) on seed 42
 * falls to 95.4 % (floor 95.6), streams' high banks rise 94/122/93 (limit 92/121/90) and 517's points in the owner's
 * box move (out/fs/REPORT.md round T).
 */
const BARB_FIX = false;
const BARB_ANGLE = (105 * Math.PI) / 180;
/** Round T: a stream that is not a gully chain's, on the threshold slopes' open floor (no wall within V_SIDE either
 * side across its flow), is laid as a curve through its raster points as a chain stream is there (FLOOR_SMOOTH), not
 * pinned to them: no staircase of 250 m legs. Off (round T default): pinned as before - on, staircases 0.0/0.0/3.4 km and
 * floor grid share 34/28/31 %, every must-not-regress gate held but three of the owner's box's 146 points on line 517
 * moved more than 50 m (out/fs/REPORT.md round T). */
const CURVE_FLOORS = false;
/** ... with FLOOR_PASSES more smoothing passes at the raster's spacing there, each point kept within FLOOR_LAY m of its
 * raster point (moved.py's 150 m: no f3 course moves for it). */
const FLOOR_PASSES = 4;
const FLOOR_LAY = 90;
const FLOOR_KEEP_END = 3;
/** A chain come onto a river's floor (gullies.ts GullyNet.floor) crosses it to the river's nearest sample within
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
/** An outlet keeps its lake's level this far past the lake's domain, m. */
const OUTLET_KEEP = 60;
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
/** The last traceStreams' routing ground (probes: endsGate's notch reaches). */
export const streamDebug: { route?: (north: number, east: number) => number; src?: string[] } = {};
/** The pass building the next stream (streamDebug.src, probes). */
let srcTag = '?';
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
  /** Ponds the traces filled (fill and spill), ten numbers each: pool id, raster points, level, spill, north and east
   * of the pit, the breach allowance, the water it spills into (-Infinity: ground), its bottom, its wet points. */
  filledPonds?: number[];
  pondsUndone?: number;
  /** Ponds filled in hollows streams ended in (trace): pool id, raster points, in pairs. */
  ponds?: number[];
  /** Streams the pond pass left dead whose hollow was filled to its real way out (FILL_DEAD_ENDS), by line. */
  filled?: number[];
  /** Pond outlets whose catchment was set to their pond's inflow. */
  pondInflow?: number;
  /** Ponds left closed by the outlet rule, and why (probes). */
  pondClosed?: string[];
  /** Each pond outlet's inflow: the lines filling it, each with its area at its end and what it lost to the pond's water. */
  pondInflowDetail?: string[];
  pondWhy?: Record<string, number>;
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
  /** Streams whose way into their receiver pointed back up it (BARB_FIX); of them, joined along a curve, or moved to
   * the receiver's nearest sample down from where they reached it. */
  barbed?: number;
  barbedCurved?: number;
  barbedMoved?: number;
  /** Non-chain streams' raster points (probes): all, on an open floor (CURVE_FLOORS), pinned over 0.5 by the slopes. */
  floorFree?: number[];
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
  streamDebug.route = p.route;
  streamDebug.src = [];
  // (A stream heads where the routing it runs on makes a channel: the model's lattice from its channel area, CHANNEL_AREA -
  // the carve draws its channels from there - and the slopes' own routing from theirs, SlopeParams.ac, below.)
  const minArea = p.minArea ?? CHANNEL_AREA;
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

  /** What a course reached; `ok` when the trace found it can flow into it. */
  type End = { kind: StreamLine['end']; line: number; idx: number; pool: number; ok?: boolean; why?: string; cross?: boolean };
  /** Lines a trace may not join or step onto while set (a lake's outlet: the streams ending in its water and every line
   * upstream of them, so its water never runs back in). */
  let avoid: Set<number> | null = null;
  /** Lakes and ponds a trace may not step into while set (a lake's outlet: those upstream of it, poolsUpstream). */
  let avoidPools: Set<number> | null = null;
  /** The ponds the last trace filled (fill-and-spill) and the pond state before it (build registers them with the line
   * it builds, or takes them back where it builds none); and the level the water stands at on the course's raster points
   * in them (build: a stream crossing its pond runs at the pond's level). */
  let pendingPonds: number[] = [];
  let pendingState: ReturnType<LakeMask['pondState']> | null = null;
  let pendingFloor = new Map<number, number>();
  /** The pond a trace filled (a pool index) -> the line running through it and the raster point of its spill: a later
   * stream ending in the pond's water joins that line there (its water runs on through the pond). */
  const pondThrough = new Map<number, { line: number; spill: number }>();
  const floodHeap = new MinHeap(POND_MAX * 8 + 16);
  /**
   * Steepest descent from the last point of `prefix` over the routing ground until the course reaches water - a line's
   * channel, a lake, the sea - or the domain's edge, never into `own` pool. Returns the course (raster indices, the
   * prefix first) and what it reached.
   *
   * A hollow on the way (a point with no lower neighbour) is filled and spilled, as the drainage does on its lattice
   * (drainage.ts, Lindsay's breach-or-fill): a priority flood from the hollow finds its true spill (the lowest way out:
   * the first point the rising water reaches that lies under its level, or water), and the course runs on through the
   * hollow and over the spill. The stream wears a notch through the spill where that is no deeper than the cut a
   * stream of its catchment keeps through a rim (drainage.ts breachAllowance, from `area`, the catchment where the trace
   * starts, km²); a deeper hollow holds a pond at the spill less that cut - drawn as any lake (LakeMask.addPond: the
   * lakes' rule for depth, size and shore) - and the stream runs through it at its level and on over the spill.
   */
  const trace = (prefix: number[], own: number, level: number, checkFirst = false, area = 1, wayOut = false, notLine = -1): { path: number[]; end: End } => {
    const st = ++stamp;
    const path = prefix.slice();
    pendingPonds = [];
    pendingFloor = new Map();
    pendingState = mask.pondState();
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
    // The stream's own water so far: the lowest ground on its course (a pond it filled holds it at the pond's level);
    // and at each point of its course (the water a later hollow's flood finds in the notch it wore).
    let runMin = level;
    const pathLv: number[] = [];
    for (const k of path) {
      if (!(own >= 0 && mask.poolAt(Math.floor(k / R), k % R) === own)) runMin = Math.min(runMin, G(k));
      pathLv.push(runMin);
    }
    /** Whether the water at raster point k (a line's, a lake's) stands over the course's source (a lake's outlet beside
     * water higher than its lake): no water runs up into it, it is a wall to the course. */
    const overSource = (k: number): boolean => {
      const o = occ[k];
      if (o !== 0) return lineAt(occLine(o)).level[occIdx(o)] > level;
      const pool = mask.poolAt(Math.floor(k / R), k % R);
      // (Not a pond this trace filled: it is the course's own water.)
      return pool >= 0 && pool !== own && !mask.pools[pool].drained && mask.pools[pool].level > level && pendingPonds.indexOf(pool) < 0;
    };
    /** The water a course may flow into at raster point k: a line's channel or a lake (not its own, nor those it must
     * avoid, nor water over its source), the sea, the domain's edge. */
    const reached = (k: number): End | null => {
      const o = occ[k];
      if (o !== 0 && occLine(o) !== notLine && !(avoid && avoid.has(occLine(o))) && !overSource(k)) return { kind: 'channel', line: occLine(o), idx: occIdx(o), pool: -1, ok: true };
      const ri = Math.floor(k / R);
      const rj = k % R;
      if (ri <= 0 || rj <= 0 || ri >= R - 1 || rj >= R - 1) return { kind: 'edge', line: -1, idx: 0, pool: -1 };
      // (A lake where its water stands over the point: its domain's rim, under a margin over the water, is dry ground
      // the course runs on over into the water.)
      const pool = mask.poolAt(ri, rj);
      if (pool >= 0 && pool !== own && !mask.pools[pool].drained && !(avoidPools && avoidPools.has(pool)) && !overSource(k) && G(k) < mask.pools[pool].level) return { kind: 'lake', line: -1, idx: 0, pool, ok: true };
      if (G(k) <= 0.5) return { kind: 'sea', line: -1, idx: 0, pool: -1 };
      return null;
    };
    const blocked = (k: number): boolean => (notLine >= 0 && occ[k] !== 0 && occLine(occ[k]) === notLine && k !== path[0]) || (avoid !== null && occ[k] !== 0 && avoid.has(occLine(occ[k]))) || (avoidPools !== null && avoidPools.has(mask.poolAt(Math.floor(k / R), k % R))) || visit.get(k) === st || (own >= 0 && mask.poolAt(Math.floor(k / R), k % R) === own) || byHome(k) || crosses(cur, k) || overSource(k);
    /** Step onto raster point q; its water: the course's so far, down to its ground (not where it steps into water),
     * held at a pond's level in a pond its trace filled. */
    const push = (q: number, lower = true): void => {
      visit.set(q, st);
      visitAt.set(q, path.length);
      path.push(q);
      if (lower) runMin = Math.max(Math.min(runMin, G(q)), pendingFloor.get(q) ?? -Infinity);
      pathLv.push(runMin);
    };
    /**
     * Fill and spill the hollow at raster point `pit`: a priority flood over the routing ground from it (never onto the
     * course so far, the home field's clearance, or water it may not enter) until the rising water reaches water it
     * may flow into, the domain's edge, or a point lower than its level (over the spill). The course runs on from the
     * pit through the hollow to there; a hollow deeper than the notch the stream may wear holds a pond. Returns the
     * point reached (the course's new last point), or -1 where the flood found no way out within POND_MAX points.
     */
    const fillAndSpill = (pit: number): number => {
      const parent = new Map<number, number>();
      const popped: number[] = [];
      const inFlood = new Set<number>();
      /** Each flooded point's height to the flood: its ground, or the water standing in it (a line's, a lake's, its
       * own course's), the lower. */
      const keyOf = new Map<number, number>();
      floodHeap.size = 0;
      parent.set(pit, -1);
      floodHeap.push(pit, G(pit));
      let W = -Infinity;
      let out = -1;
      while (floodHeap.size > 0 && popped.length < POND_MAX) {
        const gc = floodHeap.topKey();
        const c = floodHeap.pop();
        // (The way out is ground the trace has not been on: its own course and the hollows it filled before are part of
        // this one where the water reaches them - they drain back into it.)
        if (c !== pit && visit.get(c) !== st && (reached(c) || gc < W)) {
          out = c;
          break;
        }
        W = Math.max(W, gc);
        popped.push(c);
        inFlood.add(c);
        keyOf.set(c, gc);
        const ci = Math.floor(c / R);
        const cj = c % R;
        if (ci <= 0 || cj <= 0 || ci >= R - 1 || cj >= R - 1) continue;
        for (let a = 0; a < 8; a++) {
          const q = (ci + DI[a]) * R + cj + DJ[a];
          if (parent.has(q)) continue;
          const o = occ[q];
          // (Not into a pond it may not enter; water it may flow into is a way out. Its own course is in the hollow
          // like any ground: where the stream came down into it, the hollow's water reaches up its course.)
          if (byHome(q) || overSource(q) || (own >= 0 && mask.poolAt(Math.floor(q / R), q % R) === own) || (notLine >= 0 && o !== 0 && occLine(o) === notLine) || (avoid !== null && o !== 0 && avoid.has(occLine(o))) || (avoidPools !== null && avoidPools.has(mask.poolAt(Math.floor(q / R), q % R)))) continue;
          parent.set(q, c);
          // (Water stands at its own level, under the ground it runs through: a line's channel notched through a rim is
          // a way out at its water's level.)
          // (Its own course at its water too: a hollow beyond a notch it wore floods back through the notch.)
          const pq = o === 0 ? mask.poolAt(Math.floor(q / R), q % R) : -1;
          const at = visit.get(q) === st ? visitAt.get(q) : undefined;
          floodHeap.push(q, o !== 0 ? Math.min(G(q), lineAt(occLine(o)).level[occIdx(o)]) : pq >= 0 && !mask.pools[pq].drained ? Math.min(G(q), mask.pools[pq].level) : at !== undefined ? Math.min(G(q), pathLv[at]) : G(q));
        }
      }
      if (out < 0) return -1;
      report.floods++;
      // The stream comes into the hollow's water where its course first reaches the flooded points: its course from
      // there on (down into the pit) is under that water, and it crosses the hollow from there to the spill.
      let i0 = path.length - 1;
      for (let i = 0; i < path.length; i++)
        if (inFlood.has(path[i])) {
          i0 = i;
          break;
        }
      // (Those points stay the trace's own - under the hollow's water, never stepped on again - but off its course.)
      for (let i = i0 + 1; i < path.length; i++) visitAt.delete(path[i]);
      path.length = i0 + 1;
      pathLv.length = i0 + 1;
      const entry = path[i0];
      runMin = pathLv[i0];
      // The way through: the shortest way over the flooded points from there to the one beside the point over the
      // spill (the hollow's water is one level: the stream crosses it directly, not round the order the flood rose in).
      const way: number[] = [];
      {
        const oi = Math.floor(out / R);
        const oj = out % R;
        const bfs = (strict: boolean): Map<number, number> | null => {
          const prev = new Map<number, number>([[entry, -1]]);
          const queue = [entry];
          for (let h = 0; h < queue.length; h++) {
            const c = queue[h];
            const ci = Math.floor(c / R);
            const cj = c % R;
            if (Math.abs(ci - oi) <= 1 && Math.abs(cj - oj) <= 1 && !(strict && crosses(c, out))) {
              prev.set(-2, c);
              return prev;
            }
            for (let a = 0; a < 8; a++) {
              const q = (ci + DI[a]) * R + cj + DJ[a];
              if (prev.has(q) || !inFlood.has(q) || (strict && crosses(c, q))) continue;
              prev.set(q, c);
              queue.push(q);
            }
          }
          return null;
        };
        const prev = (bfs(true) ?? bfs(false)) as Map<number, number>;
        for (let q = prev.get(-2) as number; q !== entry && q >= 0; q = prev.get(q) as number) way.push(q);
        way.reverse();
        way.push(out);
      }
      // The water the hollow spills into, where it spills into water (a line's, a lake's, the sea): its water cannot
      // stand lower than that.
      const ex = reached(out);
      const into = !ex ? -Infinity : ex.kind === 'channel' ? lineAt(ex.line).level[ex.idx] : ex.kind === 'lake' ? mask.pools[ex.pool].level : ex.kind === 'sea' ? 0 : -Infinity;
      // A pond where the hollow is deeper than the notch the stream may wear through its spill (the lakes' rule: water
      // LAKE_MIDDLE_DEPTH deep, on two raster points or more, its shore a margin under the spill's ground).
      // (Its catchment at the hollow: what it drained where the trace began, gathering LATERAL_GAIN on its way, as
      // build reckons it.)
      const allow = breachAllowance(area + (LATERAL_GAIN * Math.max(0, path.length - prefix.length) * LAKE_RASTER * 1.08) / 1000);
      const pondLevel = Math.max(W - allow, into);
      // (A lake's outlet whose way on is a hollow standing over the lake - its water would run back into the lake: the
      // lake has no way out lower than that, and no outlet, as a lake whose rim rises more than OUTLET_SILL.)
      if (own >= 0 && pondLevel > level + HOLLOW_TOL) return -2;
      let floor0 = Infinity;
      for (const q of popped) floor0 = Math.min(floor0, G(q));
      if (pondLevel - floor0 > HOLLOW_TOL) {
        const top = pondLevel + LAKE_MARGIN;
        const dom: number[] = [pit];
        const inDom = new Set<number>(dom);
        let wet = 0;
        let bottom = Infinity;
        for (let h = 0; h < dom.length; h++) {
          const c = dom[h];
          const g = G(c);
          bottom = Math.min(bottom, g);
          if (g < pondLevel) wet++;
          const ci = Math.floor(c / R);
          const cj = c % R;
          for (let a = 0; a < 8; a++) {
            const q = (ci + DI[a]) * R + cj + DJ[a];
            // (Only the flood's own points: the hollow, not the ground beyond the spill; and through the notch the
            // course wore where the water stands lower than the ground, as the flood rose.)
            if (inDom.has(q) || !inFlood.has(q) || !((keyOf.get(q) as number) < top)) continue;
            inDom.add(q);
            dom.push(q);
          }
        }
        // (Owner decision 3: a hollow it fills over POND_KEEP km² on a sill POND_SILL_CUT m or less over its bottom is
        // cut through instead - where its water is the hollow's own, not a backwater of the water it spills into.)
        const cutThrough = into < W - allow && wet * (LAKE_RASTER / 1000) ** 2 > POND_KEEP && W - bottom <= POND_SILL_CUT;
        if (wet >= 2 && pondLevel - bottom >= LAKE_MIDDLE_DEPTH && !cutThrough) {
          let sill = pit;
          for (const q of way) if (G(q) >= G(sill)) sill = q;
          const id = mask.addPond(dom, dom.map((q) => G(q)), pondLevel, sill);
          pendingPonds.push(id);
          // (The stream crosses it at its level, and wears its notch through the spill down to it.)
          for (const q of dom) pendingFloor.set(q, pondLevel);
          for (const q of way) pendingFloor.set(q, Math.max(pendingFloor.get(q) ?? -Infinity, pondLevel));
          (report.filledPonds ??= []).push(id, dom.length, pondLevel, W, ORIGIN + Math.floor(pit / R) * LAKE_RASTER, ORIGIN + (pit % R) * LAKE_RASTER, allow, into, bottom, wet);
          if (inDom.has(entry)) {
            runMin = Math.max(runMin, pondLevel);
            pathLv[i0] = runMin;
          }
          // (The water it backs up over: the course down to the entry stands at the pond's level where it lies lower.)
        }
      }
      // (The hollow is the course's own: no later step comes back into it.)
      for (const q of popped) if (visit.get(q) !== st) visit.set(q, st);
      for (const q of way) push(q, occ[q] === 0 && !(mask.poolAt(Math.floor(q / R), q % R) >= 0));
      return out;
    };
    // The direction of the last step (index into RING), -1 before the first.
    let dir = -1;
    for (let step = 0; step < MAX_STEPS; step++) {
      if (step > 0 || checkFirst) {
        const e = reached(cur);
        if (e) return { path, end: e };
      }
      // (A way-out trace - a chain's - joins water lying beside it, on a neighbouring raster point, that its own water
      // can flow into (no higher than its own): it does not run on beside it.)
      if (wayOut && step > 0) {
        const ci = Math.floor(cur / R);
        const cj = cur % R;
        for (let a = 0; a < 8; a++) {
          const q = (ci + DI[a]) * R + cj + DJ[a];
          const o = occ[q];
          if (o === 0 || visit.get(q) === st || occLine(o) === notLine || (avoid && avoid.has(occLine(o)))) continue;
          if (lineAt(occLine(o)).level[occIdx(o)] > runMin - STREAM_DEPTH) continue;
          push(q, false);
          return { path, end: { kind: 'channel', line: occLine(o), idx: occIdx(o), pool: -1, ok: true } };
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
      }
      if (next < 0) {
        // A hollow: filled and spilled.
        report.pits++;
        const q = fillAndSpill(cur);
        if (q < 0) return { path, end: { kind: 'sink', line: -1, idx: 0, pool: -1, why: q === -2 ? 'closed' : 'flood' } };
        cur = q;
        dir = -1;
        continue;
      }
      // (Not the ground in the water it reaches - a lake's bed, a river's valley floor.)
      const into = occ[next] !== 0 || (() => {
        const pl = mask.poolAt(Math.floor(next / R), next % R);
        return pl >= 0 && pl !== own && !mask.pools[pl].drained;
      })();
      push(next, !into);
      cur = next;
      dir = nextDir;
    }
    return { path, end: { kind: 'stuck', line: -1, idx: 0, pool: -1, why: 'steps' } };
  };

  /** The line `line` (river or stream) as arrays. */
  const lineAt = (line: number): ChannelArrays => (line < nR ? rivers[line] : streams[line - nR]);
  /** A stand-in for an outlet not built (its lake or pond has no way out but back into a stream filling it): two
   * samples in its water at raster point k, so the streams after it keep their ids - each one's wander is seeded by it. */
  const standIn = (id: number, k: number): void => {
    const n0 = ORIGIN + Math.floor(k / R) * LAKE_RASTER;
    const e0 = ORIGIN + (k % R) * LAKE_RASTER;
    const lv = mask.pools[id].level;
    const f2 = (a: number, b: number): Float64Array => Float64Array.from([a, b]);
    streams.push({ north: f2(n0, n0 + 1), east: f2(e0, e0 + 1), level: f2(lv, lv), halfWidth: f2(0, 0), s: f2(0, Math.SQRT2), area: f2(1, 1), breach: f2(0, 0), cut: f2(0, 0), joins: -1, joinS: 0, end: 'lake', pool: id, held: 2, chainS: -1 });
    streamDebug.src?.push('standin');
    report.traced++;
  };
  /** Line L and every stream whose water runs into it (its joins lead there). */
  const upstreamOf = (L: number): Set<number> => {
    const set = new Set<number>([L]);
    for (let q = 0; q < streams.length; q++) for (let x = streams[q].joins, g = 0; x >= nR && g < 400; x = streams[x - nR].joins, g++) if (x === L) set.add(nR + q);
    return set;
  };
  /** The pool a line's last point lies in (-1: none). */
  const poolOfEnd = (L: ChannelArrays): number => {
    const m = L.north.length - 1;
    return mask.poolAt(Math.round((L.north[m] - ORIGIN) / LAKE_RASTER), Math.round((L.east[m] - ORIGIN) / LAKE_RASTER));
  };
  /**
   * The lakes and ponds upstream of the lines in `fill` (round T: a loop through a lake): every pool whose outlet is one
   * of them, then on up through the lines filling each such pool, which join `fill`. An outlet from water these lines
   * fill may end in none of those pools, nor join any of those lines: its water would come back round to itself.
   */
  const poolsUpstream = (fill: Set<number>): Set<number> => {
    const pools = new Set<number>();
    for (let grew = true, g = 0; grew && g < 50; g++) {
      grew = false;
      for (let q = 0; q < streams.length; q++) {
        const p = streams[q].pool;
        if (p < 0 || pools.has(p) || !fill.has(nR + q)) continue;
        pools.add(p);
        grew = true;
        for (let x = 0; x < streams.length; x++) if (x !== q && streams[x].end === 'lake' && poolOfEnd(streams[x]) === p) for (const y of upstreamOf(nR + x)) fill.add(y);
      }
    }
    return pools;
  };

  /** Build a stream from its traced course and record it. */
  /**
   * The junction of a chain stream off an open floor (build): from its last point (pn[last], pe[last]), on its course's
   * heading there, to the receiver `line` at a sample from `j0` down at most JUNCTION_SHIFT where the way in meets the
   * receiver at JUNCTION_ANGLE or less, along a cubic curve tangent to both courses. The curve's ground (p.route, every
   * STREAM_SPACING) never rises FLOOR_RISE over `g0` (the last point's), nor lies under the receiver's water (backing
   * up, it would stand over the ground). Its inner points (north, east, ground) and the receiver's sample, or
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
        if (gq > g0 + FLOOR_RISE || gq < mouth) return null;
        n.push(qn);
        e.push(qe);
        g.push(gq);
      }
      return { n, e, g, idx: j };
    };
    // The first sample down the receiver where the way in meets it at JUNCTION_ANGLE or less.
    let best = -1;
    for (let j = j0; j < cnt - 1 && L.s[j] - L.s[j0] <= JUNCTION_SHIFT; j++) {
      if (mask.at(L.north[j], L.east[j]) > -Infinity) break;
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
  const build = (path: number[], endAt: End, first: { north: number; east: number; level: number } | null, area0: number, pool: number, pathArea: number[] | null = null, pathVee: number[] | null = null): void => {
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
      pn.push(ORIGIN + Math.floor(k / R) * LAKE_RASTER);
      pe.push(ORIGIN + (k % R) * LAKE_RASTER);
      // (Through a pond its trace filled, at the pond's level.)
      run = Math.max(Math.min(run, G(k) - STREAM_DEPTH), pendingFloor.get(k) ?? -Infinity);
      lv.push(run);
      gp.push(G(k));
      pa.push(pathArea && i < pathArea.length ? pathArea[i] : NaN);
      (pool >= 0 ? report.notchOutlet : report.notch).push(G(k) - run);
    }
    let joins = -1;
    let joinS = 0;
    /** The water it flows into (a line's or a lake's), m; its last reach backs up to it where it came lower. */
    let mouth = -Infinity;
    if (end.kind === 'sink') {
      // A hollow the flood found no way out of within POND_MAX points: it ends in it.
      report.hollows++;
      const why = `${end.why ?? '?'}${pathArea ? '-chain' : ''}`;
      (report.hollowWhy ??= {})[why] = (report.hollowWhy[why] ?? 0) + 1;
      (report.hollowAt ??= []).push(pn[pn.length - 1], pe[pe.length - 1]);
    } else if (end.kind === 'channel') {
      // It joins the water it reached (its last reach backs up to it where it came lower).
      const L = lineAt(end.line);
      let j = end.idx;
      {
        // A chain stream come off an open floor (or across one) joins its receiver as water does there: curving
        // downstream into it (a Y), not square across it (junction).
        const last = pn.length - 1;
        // (BARB_FIX: whether the way in from its last point to the receiver's sample j points back up the receiver.)
        const barbed = (jj: number): boolean => {
          if (!BARB_FIX || last < 0 || L.s.length < 3) return false;
          let fn = pn[last];
          let fe = pe[last];
          if (Math.hypot(L.north[jj] - fn, L.east[jj] - fe) < 50 && last > 0) {
            fn = pn[last - 1];
            fe = pe[last - 1];
          }
          const vn = L.north[jj] - fn;
          const ve = L.east[jj] - fe;
          const a = Math.max(0, Math.min(L.s.length - 2, jj));
          const b = Math.min(L.s.length - 1, a + 2);
          const tn = L.north[b] - L.north[a];
          const te = L.east[b] - L.east[a];
          const c = (vn * tn + ve * te) / ((Math.hypot(vn, ve) || 1) * (Math.hypot(tn, te) || 1));
          return c < Math.cos(BARB_ANGLE);
        };
        const isBarbed = barbed(j);
        let curved = false;
        if (isBarbed) report.barbed = (report.barbed ?? 0) + 1;
        if (last >= (first ? 1 : 0) && last - (first ? 1 : 0) === m - 1 && ((pathArea && pathVee && (end.cross || pathVee[m - 1] === 0)) || (isBarbed && !(pathVee && pathVee[m - 1] !== 0)))) {
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
            curved = true;
            if (isBarbed) report.barbedCurved = (report.barbedCurved ?? 0) + 1;
          }
        }
        if (isBarbed && !curved) {
          // (No curve in: the receiver's sample nearest its last point, down from j, where the water there is no higher.)
          let bd = Infinity;
          let bj = j;
          for (let q = j; q < L.s.length && L.s[q] - L.s[j] <= 2 * (RIVER_TOUCH + L.halfWidth[j]) + 250; q++) {
            if (L.level[q] > L.level[j] + 1e-6 || mask.at(L.north[q], L.east[q]) > -Infinity) continue;
            const d = Math.hypot(L.north[q] - pn[pn.length - 1], L.east[q] - pe[pe.length - 1]);
            if (d < bd) {
              bd = d;
              bj = q;
            }
          }
          if (bj !== j) report.barbedMoved = (report.barbedMoved ?? 0) + 1;
          j = bj;
        }
        pn.push(L.north[j]);
        pe.push(L.east[j]);
        lv.push(L.level[j]);
        gp.push(L.level[j] + STREAM_DEPTH);
        pa.push(NaN);
        mouth = L.level[j];
        joins = end.line;
        joinS = L.s[j];
      }
    } else if (end.kind === 'lake') {
      // It ends at the lake's surface (its last reach backs up to it where it came lower); in a pond a stream filled,
      // its water joins the line running through the pond, at the pond's spill.
      const lake = mask.pools[end.pool].level;
      lv[lv.length - 1] = lake;
      mouth = lake;
      const th = pondThrough.get(end.pool);
      const o = th ? occ[th.spill] : 0;
      if (th && o !== 0 && occLine(o) === th.line) {
        joins = th.line;
        joinS = lineAt(th.line).s[occIdx(o)];
      }
    } else if (end.kind === 'sea') {
      lv[lv.length - 1] = Math.min(run, 0);
    }
    if (pn.length < 2) {
      // (No stream: the ponds its trace filled are taken back.)
      if (pendingPonds.length && pendingState) {
        mask.restorePonds(pendingState);
        report.pondsUndone = (report.pondsUndone ?? 0) + pendingPonds.length;
      }
      pendingPonds = [];
      pendingFloor = new Map();
      return;
    }
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
    // (CURVE_FLOORS: a stream not a chain's, at a raster point of its course on the slopes' open floor - their ground
    // standing under V_SIDE over it on both sides across its flow - is not pinned.)
    // (Only a stream that joins a channel or the sea, and not a lake's outlet: one ending in a lake, or in a hollow the
    // pond pass fills later, keeps its course as traced to where it comes into the water; an outlet - seed 42's line 517,
    // the owner's winding stream, is one - keeps its course.)
    const gnF = !pathArea && CURVE_FLOORS && p.pinned && pool < 0 && (end.kind === 'channel' || end.kind === 'sea') ? gullyNet() : null;
    const openFloor = (q: number): boolean => {
      if (!gnF || gnF.n !== R || m < 2 || q < 0 || q >= m) return false;
      const k = path[q];
      const nx = q + 1 < m ? path[q + 1] : path[q - 1];
      const ki = Math.floor(k / R);
      const kj = k % R;
      const di = Math.floor(nx / R) - ki;
      const dj = (nx % R) - kj;
      if (Math.abs(di) > 1 || Math.abs(dj) > 1 || (di === 0 && dj === 0) || ki < 1 || kj < 1 || ki >= R - 1 || kj >= R - 1) return false;
      const H = gnF.h;
      const g0 = H[k];
      return H[(ki + dj) * R + kj - di] - g0 < V_SIDE && H[(ki - dj) * R + kj + di] - g0 < V_SIDE;
    };
    // (Not its last FLOOR_KEEP_END raster points: where it ends - a junction, a lake's or pond's water - stays as traced.)
    const free = gnF ? pn.map((_, i) => (i >= off0 && i - off0 < m - FLOOR_KEEP_END ? openFloor(i - off0) : false)) : null;
    if (free && m >= 3) {
      // (And where its course laid as a curve - the smoothing below with nothing pinned - keeps to ground no higher than
      // FLOOR_RISE over its raster point's: a staircase of D8 legs down a channel whose floor is broad enough.)
      let cn = pn.slice();
      let ce = pe.slice();
      for (let pass = 0; pass < 2 + FLOOR_PASSES; pass++) {
        const n2 = cn.slice();
        const e2 = ce.slice();
        for (let i = 1; i < cn.length - 1; i++) {
          n2[i] = 0.25 * cn[i - 1] + 0.5 * cn[i] + 0.25 * cn[i + 1];
          e2[i] = 0.25 * ce[i - 1] + 0.5 * ce[i] + 0.25 * ce[i + 1];
          const dn = n2[i] - pn[i];
          const de = e2[i] - pe[i];
          const dl = Math.hypot(dn, de);
          if (dl > FLOOR_LAY) {
            n2[i] = pn[i] + (dn * FLOOR_LAY) / dl;
            e2[i] = pe[i] + (de * FLOOR_LAY) / dl;
          }
        }
        cn = n2;
        ce = e2;
      }
      for (let i = Math.max(1, off0); i < Math.min(pn.length - 1, off0 + m - FLOOR_KEEP_END); i++) {
        if (free[i] || Math.hypot(cn[i] - pn[i], ce[i] - pe[i]) < 10) continue;
        if (p.route(cn[i], ce[i]) <= G(path[i - off0]) + FLOOR_RISE) free[i] = true;
      }
    }
    if (free) {
      const fs = (report.floorFree ??= [0, 0, 0]);
      for (let i = 0; i < pn.length; i++) {
        fs[0]++;
        if (free[i]) fs[1]++;
        if (p.pinned && (p.pinned as (n: number, e: number) => number)(pn[i], pe[i]) > 0.5) fs[2]++;
      }
    }
    const pinOf = (i: number): number => {
      if (pathArea && pathVee && i >= off0 && i - off0 >= m) return 0;
      if (pathArea && pa[i] === pa[i]) return pathVee && i - off0 < pathVee.length ? pathVee[i - off0] : 1;
      if (free && free[i]) return 0;
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
    // (CURVE_FLOORS: on an open floor, more passes at the raster's spacing - a staircase of single steps comes out as
    // its diagonal - each point kept within FLOOR_LAY m of its raster point, and of where the two passes put it.)
    if (free && free.some((x) => x)) {
      const n0 = sn.slice();
      const e0 = se.slice();
      for (let pass = 0; pass < FLOOR_PASSES; pass++) {
        const n2 = sn.slice();
        const e2 = se.slice();
        for (let i = 1; i < sn.length - 1; i++) {
          if (!free[i]) continue;
          n2[i] = 0.25 * sn[i - 1] + 0.5 * sn[i] + 0.25 * sn[i + 1];
          e2[i] = 0.25 * se[i - 1] + 0.5 * se[i] + 0.25 * se[i + 1];
          const dn = n2[i] - pn[i];
          const de = e2[i] - pe[i];
          const dl = Math.hypot(dn, de);
          if (dl > FLOOR_LAY) {
            n2[i] = pn[i] + (dn * FLOOR_LAY) / dl;
            e2[i] = pe[i] + (de * FLOOR_LAY) / dl;
          }
        }
        sn = n2;
        se = e2;
      }
      void n0;
      void e0;
    }
    const on: number[] = [];
    const oe: number[] = [];
    const ol: number[] = [];
    const og: number[] = [];
    const oa: number[] = [];
    /** A chain stream's pin at each sample (1 at its raster points in a V, 0 on an open floor). */
    const op: number[] = [];
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
        if (pathVee && pin) op.push(pin[i] + (pin[i + 1] - pin[i]) * t);
        else if (free) op.push((free[i] ? 0 : 1) + ((free[i + 1] ? 0 : 1) - (free[i] ? 0 : 1)) * t);
        if (i < chainEnd) chainSamples++;
      }
    }
    on.push(sn[sn.length - 1]);
    oe.push(se[se.length - 1]);
    ol.push(lv[lv.length - 1]);
    og.push(gp[gp.length - 1]);
    if (pathArea) oa.push(pa[pa.length - 1]);
    // A chain stream's open-floor reaches: the raster course (points 250 m apart, turning in 45 degree steps) laid as a
    // curve through them (FLOOR_SMOOTH passes at the samples' spacing), not as the raster's straight runs and corners.
    if ((pathVee || (free && free.some((x) => x))) && pin && op.length) {
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
    // (Its thread about this course is laid with the rivers', riverNetwork.ts: the channel-form law, channelForm.ts.)
    const bt2 = performance.now();
    const seenG = new Float64Array(on.length).fill(NaN);
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
    /** The samples whose ground was looked at (og then holds it, not the raster points' interpolated): every stream's,
     * a chain's too (its V's floor between two raster points need not fall straight). */
    const seen = new Uint8Array(count);
    seen[0] = seen[count - 1] = 1;
    for (let i = 1; i < count - 1; i += LEVEL_EVERY) {
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
    // Where it came down lower than the water it joins, its last reach lies at that water's level: backed up and silted
    // to it (the terrain builds its banks up to hold it, heightfield.ts carveNetwork).
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
    if (!pathArea) for (let i = 0; i < count; i++) area[i] = (pool < 0 ? HEAD_START_AREA + (area0 - HEAD_START_AREA) * smooth(0, HEAD_RAMP, s[i]) : area0) + (LATERAL_GAIN * s[i]) / 1000;
    const id = nR + streams.length;
    streams.push({ north, east, level, halfWidth: new Float64Array(count), s, area, breach, cut, joins, joinS, end: end.kind, pool, held, chainS });
    streamDebug.src?.push(srcTag);
    for (const pid of pendingPonds) pondThrough.set(pid, { line: id, spill: mask.pools[pid].spill });
    pendingPonds = [];
    pendingFloor = new Map();
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
  const outletPath = (id: number, skip: Set<number> | null = null, maxJoin = Infinity, walls: Set<number> | null = null): { path: number[]; end: End | null } | null => {
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
        // (A lake's outlet: never into a stream filling it or a line upstream of that (`skip`), nor water standing over
        // `maxJoin`: those are walls to it.)
        if (o !== 0 && ((skip && skip.has(occLine(o))) || lineAt(occLine(o)).level[occIdx(o)] > maxJoin)) continue;
        if (o !== 0) end = { kind: 'channel', line: occLine(o), idx: occIdx(o), pool: -1 };
        else {
          const other = mask.poolAt(Math.floor(k / R), k % R);
          // (Nor a lake or pond upstream of the stream filling it, `walls`: its water would come back round.)
          if (other >= 0 && walls && walls.has(other)) continue;
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
        // (Into water, as high as that water: a lake's outflow cannot run up into a line standing over it.)
        const oq = occ[q];
        const kq = own.has(q) ? pool.level : Math.max(kk, ground(q), oq !== 0 ? lineAt(occLine(oq)).level[occIdx(oq)] : -Infinity);
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
    // (Never into a stream ending in this lake, or one running into that: round T, no outlet loops back.)
    let fill: Set<number> | null = null;
    for (let q = 0; q < streams.length; q++) {
      const L = streams[q];
      const m = L.north.length - 1;
      if (L.end !== 'lake' || mask.poolAt(Math.round((L.north[m] - ORIGIN) / LAKE_RASTER), Math.round((L.east[m] - ORIGIN) / LAKE_RASTER)) !== id) continue;
      fill ??= new Set<number>();
      for (const x of upstreamOf(nR + q)) fill.add(x);
    }
    // (Nor into a lake or pond upstream of those: poolsUpstream.)
    const lakeWalls = fill ? poolsUpstream(fill) : null;
    const out = outletPath(id, fill, Infinity, lakeWalls);
    if (!out) {
      report.outletNone++;
      // (Its only way out was back into a stream filling it: no outlet. A stand-in of two samples in its water keeps the
      // streams after it on their ids - each one's wander is seeded by its id.)
      const o0 = fill ? outletPath(id) : null;
      if (o0) {
        standIn(id, o0.path[0]);
        (report.pondWhy ??= {}).lakeLoopClosed = (report.pondWhy.lakeLoopClosed ?? 0) + 1;
      }
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
    avoid = fill;
    avoidPools = lakeWalls;
    const t = out.end ? { path: out.path.slice(1), end: { ...out.end, ok: true } } : trace(out.path.slice(1), id, pool.level, false, Math.max(1, a0));
    avoid = null;
    avoidPools = null;
    if (t.end.kind === 'sink' && t.end.why === 'closed') {
      // (Its way out leads into a hollow standing over it: no outlet.)
      if (pendingPonds.length && pendingState) mask.restorePonds(pendingState);
      pendingPonds = [];
      pendingFloor = new Map();
      report.outletNone++;
      report.outletHigh++;
      continue;
    }
    report.outlets++;
    report.outletSteps += t.path.length;
    srcTag = 'outlet';
    build(t.path, t.end, first, Math.max(1, a0), id);
  }

  const headFrom = new Float64Array(nR).fill(Infinity);
  // --- Headwaters: the lattice cells whose catchment reaches minArea (but not RIVER_AREA) whose donors' do not, where
  // the lattice is the finest routing (in the slopes' mountains their own routing heads the streams, the chains below).
  const gn = gullyNet();
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
    if (occ[k] !== 0 || mask.poolAt(ki, kj) >= 0 || byHome(k) || G(k) <= 0.5 || (gn && gn.n === R && gn.dir[k])) continue;
    const t = trace([k], -1, G(k), false, d.area[c]);
    srcTag = 'head';
    build(t.path, t.end, null, d.area[c], -1);
  }
  // --- The gully chains (gullies.ts, a seeded world's mountains), after every other stream (the outlets, the lattice's
  // headwaters and the rivers' head feeders are traced first, exactly as without them, so they keep their courses):
  // every chain of the threshold hillslopes' own routing from where the pass makes it a channel (its channel-head
  // catchment, SlopeParams.ac: where its V begins; the ground shader paints the rills above, rills.ts) is a stream down
  // its chain, sized by the chain's catchment, on to where another
  // line, a lake or the sea takes it (or, where the pass ends, on down the ground as any trace). The longest chains
  // first: a valley's trunk is one line, each side gully's stream joins it.
  const chainStats = { heads: 0, traced: 0, km: 0, skipped: 0, crossed: 0, ms: 0, msTrace: 0, msBuild: 0, samples0: report.samples };
  if (gn && gn.n === R) {
    const tc = performance.now();
    // (A channel heads where the pass's routing makes one: its channel-head catchment, SlopeParams.ac - the V its
    // channels cut begins there, and so does the stream in it.)
    const AV = slopeParams().ac;
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
    // The rivers' samples about every RIVER_INDEX_STEP m, by RIVER_INDEX_CELL cell: a chain come onto a river's floor
    // (a model's floor the slopes stand on, gullies.ts GullyNet.floor) crosses the floor to it.
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
        if (st.level[j] > low || st.level[j] < g0 - FLOOR_DROP) continue;
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
            if (r.level[l[m + 1]] > low) continue;
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
      if (mouth > low || mouth < g0 - FLOOR_DROP) return null;
      const L = Math.sqrt(best);
      // (The way across: never rising over the chain's ground, nor so low that the water backing up from the line it
      // joins would stand over it.)
      for (let t = FLOOR_STEP; t < L - r.halfWidth[bi]; t += FLOOR_STEP) {
        const f = t / L;
        const g = p.route(kn + (r.north[bi] - kn) * f, ke + (r.east[bi] - ke) * f);
        report.crossSamples = (report.crossSamples ?? 0) + 1;
        if (g > g0 + FLOOR_RISE || g < mouth) return null;
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
      const pathA = [gn.area[q]];
      /** Per point: 1 in a V or beside a wall (pinned to its raster point), 0 on an open floor (laid as a curve). */
      const pathV = [1];
      let low = G(q) - STREAM_DEPTH;
      let cross: End | null = null;
      for (let k = q, r = receiverOf(gn, k); r >= 0; k = r, r = receiverOf(gn, k)) {
        if (byHome(r)) break;
        // (Not over ground standing higher over its water than the notch a stream of its catchment wears through a rim:
        // the slopes' routing crosses a seam of the drawn ground there, and the trace fills and spills the hollow.)
        if (occ[r] === 0 && G(r) - STREAM_DEPTH - low > breachAllowance(pathA[pathA.length - 1])) break;
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
        if ((gn.floor[r] > 0 || (nx >= 0 && !inV(r, nx))) && (cross = crossTo(r, low))) break;
        // (Beside a chain stream on the same floor - a neighbouring point of its course, the ground level across: the
        // raster's steepest descent runs parallel lines down an even floor where the water gathers into one.)
        if ((cross = besideChain(r, low))) break;
      }
      const before = streams.length;
      const tt = performance.now();
      const t = cross ? { path, end: cross } : trace(path, -1, G(q), true, pathA[pathA.length - 1], true);
      if (cross) chainStats.crossed++;
      const tb = performance.now();
      srcTag = 'chain';
      build(t.path, t.end, null, gn.area[q], -1, pathA, pathV);
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
  // (Where a river's water starts: a chain may join it above its first feeder - riverNetwork.ts trims the river's head
  // to the first junction.)
  for (const st of streams) if (st.joins >= 0 && st.joins < nR) headFrom[st.joins] = Math.min(headFrom[st.joins], st.joinS);

  report.tracePhases.push(performance.now() - t0);
  // --- Catchment summed down the network: each stream's own (its source and what it gathers), plus every stream
  // that joins it from its confluence on (latest first: a stream only ever joins one traced before it).
  for (let j = streams.length - 1; j >= 0; j--) {
    const st = streams[j];
    if (st.joins >= nR) {
      const P = streams[st.joins - nR];
      const add = st.area[st.area.length - 1];
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
  for (const st of streams) for (let i = 0; i < st.area.length; i++) st.halfWidth[i] = channelHalfWidth(st.area[i]);
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

