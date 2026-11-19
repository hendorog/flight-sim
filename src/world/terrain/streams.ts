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
import { gullyNet } from './gullies';
import { slopeParams } from './hillslopes';
import { CHANNEL_AREA } from './erosion';
import { AIRPORT } from '../../core/world';

/** Water stands this far under the ground at each raster point of a stream's course, m. */
const STREAM_DEPTH = 1.0;
/** Catchment a stream gathers along its course from the slopes either side, km² per km. */
const LATERAL_GAIN = 2;
/** A river's dry head starts as if draining this much, km² (about 1.2 m half-width): riverNetwork.ts. */
export const HEAD_START_AREA = 6;
/** A river whose head is in no lake begins where the first stream joins it, when that is within FEED_JOIN m of its head
 * (riverNetwork.ts trims its head there: no trickle runs on above its first tributary). */
export const FEED_JOIN = 1500;
/** The ground under every this many stream samples is checked for a dip between the raster points. */
const LEVEL_EVERY = 3;
/** ... and those between them too where the level falls this much from one to the next, m. */
const STEEP_RECHECK = 3;
/** Stream sample spacing, m. */
export const STREAM_SPACING = 50;
/**
 * Owner decision (2026-11-10). A pond a hollow on a line's way would hold over POND_KEEP km² is not kept where its spill
 * stands POND_SILL_CUT m or less over its bottom: the line cuts through the spill instead, and no lake is made. A spill
 * higher than that keeps the lake; so does a pond that is the backwater of the water it spills into.
 */
const POND_KEEP = 3;
const POND_SILL_CUT = 15;
/** A course come beside another's water on its floor - a neighbouring raster point of it, the ground there within
 * FLOOR_FLAT m of its own, the ground between rising no more than FLOOR_RISE m over the higher of the two, and that water
 * no higher than its own - joins it there: one floor, one line. */
const FLOOR_FLAT = 12;
const FLOOR_RISE = 3;
/** A course's raster point lies in a V where the routing ground a raster step either side across its flow stands this
 * much over it, m: it keeps to its point there (no smoothing off it, no look across). */
const V_SIDE = 15;
/** A stream's reaches off a V are laid as a curve through its raster points: this many smoothing passes over its
 * samples (STREAM_SPACING apart; about a 90 m Gaussian). */
const FLOOR_SMOOTH = 6;
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
/** The sea this deep or more on the drainage lattice, m, is not sampled on the streams' raster (its routing ends at the
 * sea well before it). */
const SEA_DEEP = -30;
/** Probes may change these; the sim never does. `lowland`: the catchment a stream heads at where the threshold slopes
 * did not build the ground (the model's channel area); `stem`: every channel runs up its main stem to the finest
 * channel head (stemHead); `beside`: a course joins another it comes beside on its floor. */
export const streamHeads = { lowland: CHANNEL_AREA, stem: true, beside: true };
/** The last traceStreams' routing ground (probes: endsGate's notch reaches). */
export const streamDebug: { route?: (north: number, east: number) => number; src?: string[]; keep?: boolean; routing?: { area: Float32Array; rdir: Int8Array; G: Float64Array; F: Float64Array } } = {};
/** The pass building the next stream (streamDebug.src, probes). */
let srcTag = '?';
const PER_CELL = DRAIN_CELL / LAKE_RASTER;
const SQRT2 = Math.SQRT2;
const DI = [-1, -1, -1, 0, 0, 1, 1, 1];
const DJ = [-1, 0, 1, -1, 1, -1, 0, 1];

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
  /** The streams' raster of the routing ground, ms; the drawn routing (flood, directions, catchment), ms. */
  rasterMs?: number;
  routingMs?: number;
  /** The lines' raster points laid at the lowest ground across their flow: the ground samples looked at, the points moved. */
  snapSamples?: number;
  /** How often LOWLINE's rows fire (probes): heads by the channel-head rule, of them moved up their main stem, rivers'
   * main stems fed, courses joined to another beside them, hollows on the courses (ponds, cut through, too shallow, on
   * water), outlets' courses walked and those closed. */
  lowline?: Record<string, number>;
  snapped?: number;
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
 * The ground the streams are routed over, without the rivers' valleys (`smooth`: the terrain without its small-scale
 * relief, heightfield.ts naturalHeightSmooth), at every point of the 250 m raster but the deep sea's (NaN: the drainage
 * lattice and every cell round it under SEA_DEEP), as float32 - the same in every thread, whether worked out there or
 * handed over with the model (macroCache.ts).
 */
export function smoothRaster(d: Drainage, smooth: (north: number, east: number) => number): Float32Array {
  const R = RASTER_N;
  const out = new Float32Array(R * R);
  const dn = d.n;
  for (let i = 0; i < R; i++) {
    const ci = Math.min(dn - 1, Math.round(i / PER_CELL));
    for (let j = 0; j < R; j++) {
      const cj = Math.min(dn - 1, Math.round(j / PER_CELL));
      let deep = true;
      for (let a = Math.max(0, ci - 1); a <= Math.min(dn - 1, ci + 1) && deep; a++)
        for (let b = Math.max(0, cj - 1); b <= Math.min(dn - 1, cj + 1); b++)
          if (!(d.height[a * dn + b] < SEA_DEEP)) {
            deep = false;
            break;
          }
      out[i * R + j] = deep ? NaN : smooth(ORIGIN + i * LAKE_RASTER, ORIGIN + j * LAKE_RASTER);
    }
  }
  return out;
}

/**
 * Trace the streams of a seeded world. `ground` is the terrain they run on (detailed, with the rivers' valleys);
 * `rivers` the river network's channels (their levels final); `riverPools` flags the lake pools a river runs through.
 */
export function traceStreams(p: { d: Drainage; mask: LakeMask; route: (north: number, east: number) => number; smooth: (north: number, east: number) => number; carve: (h: number, north: number, east: number) => number; raster: Float32Array | null; rivers: ReadonlyArray<ChannelArrays>; riverPools: Uint8Array; minArea?: number; pinned?: (north: number, east: number) => number }): { streams: StreamLine[]; report: StreamReport; headAt: Float64Array } {
  const t0 = performance.now();
  const { d, mask, rivers } = p;
  streamDebug.route = p.route;
  streamDebug.src = [];
  // (A stream heads where the routing it runs on makes a channel: the model's lattice from its channel area, CHANNEL_AREA -
  // the carve draws its channels from there - and the slopes' own routing from theirs, SlopeParams.ac, below.)
  const minArea = p.minArea ?? CHANNEL_AREA;
  const R = RASTER_N;
  const nR = rivers.length;
  const report: StreamReport = { pools: 0, riverPools: 0, outlets: 0, outletToLake: 0, outletToSea: 0, outletNone: 0, heads: 0, traced: 0, ends: {}, outletEnds: {}, km: 0, steps: 0, outletSteps: 0, levelSamples: 0, notch: [], notchOutlet: [], pits: 0, sinks: 0, sinkGap: [], sinkGapLake: [], sinkGapLast: [], hollows: 0, floods: 0, outletSinkWhy: {}, breachSamples: 0, wanderSamples: 0, wanderCut: 0, samples: 0, ms: 0, tracePhases: [], outletSamples: 0, outletSill: [], outletHigh: 0 };

  // --- The ground on the raster: without the small-scale relief (the terrain takes it away along a stream,
  // heightfield.ts carveNetwork), for the routing and the water level alike. Sampled at every raster point but the
  // deep sea's (the drainage lattice and every cell round it under SEA_DEEP: the lattice's own height stands for it).
  // (The ground without the rivers' valleys - the same at every thread - comes worked out with the model, macroCache.ts:
  // the valleys are cut in here; the ponds drained or lowered since are taken afresh.)
  const tR0 = performance.now();
  const Gr = new Float64Array(R * R);
  {
    const sm = p.raster ?? smoothRaster(d, p.smooth);
    for (let i = 0; i < R; i++)
      for (let j = 0; j < R; j++) {
        const k = i * R + j;
        const v = sm[k];
        Gr[k] = v !== v ? d.height[Math.min(d.n - 1, Math.round(i / PER_CELL)) * d.n + Math.min(d.n - 1, Math.round(j / PER_CELL))] : p.carve(v, ORIGIN + i * LAKE_RASTER, ORIGIN + j * LAKE_RASTER);
      }
    for (const b of new Set(mask.changed)) {
      const { gi, gj, rows, cols } = mask.rasterBox(b);
      for (let i = gi; i < gi + rows; i++)
        for (let j = gj; j < gj + cols; j++) {
          const k = i * R + j;
          if (sm[k] !== sm[k]) continue;
          const n0 = ORIGIN + i * LAKE_RASTER;
          const e0 = ORIGIN + j * LAKE_RASTER;
          Gr[k] = p.carve(Math.fround(p.smooth(n0, e0)), n0, e0);
          report.samples++;
        }
    }
  }
  report.rasterMs = performance.now() - tR0;
  const G = (k: number): number => Gr[k];


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
  /** What a course reached; `ok` when the trace found it can flow into it. */
  type End = { kind: StreamLine['end']; line: number; idx: number; pool: number; ok?: boolean; why?: string; cross?: boolean };
  /** The ponds the last trace filled (fill-and-spill) and the pond state before it (build registers them with the line
   * it builds, or takes them back where it builds none); and the level the water stands at on the course's raster points
   * in them (build: a stream crossing its pond runs at the pond's level). */
  let pendingFloor = new Map<number, number>();

  /** The line `line` (river or stream) as arrays. */
  const lineAt = (line: number): ChannelArrays => (line < nR ? rivers[line] : streams[line - nR]);
  /** Build a stream from its traced course and record it. */
  const build = (path: number[], endAt: End, first: { north: number; east: number; level: number } | null, pool: number, pathArea: number[], pathVee: number[], at: { n: number[]; e: number[]; g: number[] }): void => {
    const bt0 = performance.now();
    const m = path.length;
    let end = endAt;
    // Points: an outlet's first point in its lake, the raster course, a confluence's point on the line it joins; the
    // water at each and the ground it runs through (its cut is the difference).
    const pn: number[] = [];
    const pe: number[] = [];
    const lv: number[] = [];
    const gp: number[] = [];
    /** Its catchment at each point of its course (NaN off it), km². */
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
      // (At the lowest ground across its flow, where it was laid there.)
      pn.push(at.n[i]);
      pe.push(at.e[i]);
      const gk = at.g[i];
      // (Through a pond on its way, at the pond's level.)
      run = Math.max(Math.min(run, gk - STREAM_DEPTH), pendingFloor.get(k) ?? -Infinity);
      lv.push(run);
      gp.push(gk);
      pa.push(pathArea[i]);
      (pool >= 0 ? report.notchOutlet : report.notch).push(gk - run);
    }
    let joins = -1;
    let joinS = 0;
    /** The water it flows into (a line's or a lake's), m; its last reach backs up to it where it came lower. */
    let mouth = -Infinity;
    if (end.kind === 'sink') {
      // A hollow the flood found no way out of within POND_MAX points: it ends in it.
      report.hollows++;
      const why = end.why ?? '?';
      (report.hollowWhy ??= {})[why] = (report.hollowWhy[why] ?? 0) + 1;
      (report.hollowAt ??= []).push(pn[pn.length - 1], pe[pe.length - 1]);
    } else if (end.kind === 'channel') {
      // It joins the water it reached (its last reach backs up to it where it came lower).
      const L = lineAt(end.line);
      let j = end.idx;
      // (At the receiver's sample nearest where it reached it: the raster point it came to is marked by the receiver's
      // first sample within reach of it, up to RIVER_TOUCH and the receiver's width upstream of it, whose water stands
      // higher - backed up to that, its last reach stood over its ground.)
      {
        const ln = pn[pn.length - 1];
        const le = pe[pe.length - 1];
        const reach = 2 * (RIVER_TOUCH + L.halfWidth[j]);
        let bd = Math.hypot(L.north[j] - ln, L.east[j] - le);
        for (let q = j + 1; q < L.s.length && L.s[q] - L.s[end.idx] <= reach; q++) {
          const dq = Math.hypot(L.north[q] - ln, L.east[q] - le);
          if (dq < bd) {
            bd = dq;
            j = q;
          }
        }
      }
      {
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
      // It ends at the lake's surface (its last reach backs up to it where it came lower).
      const lake = mask.pools[end.pool].level;
      lv[lv.length - 1] = lake;
      mouth = lake;
    } else if (end.kind === 'sea') {
      lv[lv.length - 1] = Math.min(run, 0);
    }
    if (pn.length < 2) {
      pendingFloor = new Map();
      return;
    }
    const bt1 = performance.now();
    // Smooth the raster's zigzags (the ends stay put), then resample at STREAM_SPACING. Not where it keeps to its raster
    // point (in a V, `pathVee`; an outlet's first point where the ground pins it, `pinned`: smoothed off them, a stream
    // would ride up a wall); its junction curve and mouth are free.
    let sn = pn.slice();
    let se = pe.slice();
    const off0 = first ? 1 : 0;
    const pin = pn.map((_, i) => (i < off0 ? (p.pinned ? p.pinned(pn[i], pe[i]) : 0) : i - off0 < m ? pathVee[i - off0] : 0));
    for (let pass = 0; pass < 2; pass++) {
      const n2 = sn.slice();
      const e2 = se.slice();
      for (let i = 1; i < sn.length - 1; i++) {
        n2[i] = 0.25 * sn[i - 1] + 0.5 * sn[i] + 0.25 * sn[i + 1];
        e2[i] = 0.25 * se[i - 1] + 0.5 * se[i] + 0.25 * se[i + 1];
        if (pin[i] > 0) {
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
    /** Its pin at each sample (1 at its raster points in a V, 0 off one). */
    const op: number[] = [];
    // (Its catchment off its course - an outlet's first point, its junction curve, its mouth - the nearest course
    // point's, gathering LATERAL_GAIN on from there.)
    {
      let last = pathArea[0];
      let lastI = 0;
      for (let i = 0; i < pa.length; i++) {
        if (pa[i] === pa[i]) {
          last = pa[i];
          lastI = i;
        } else pa[i] = last + (LATERAL_GAIN * LAKE_RASTER * Math.max(0, i - lastI)) / 1000;
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
        oa.push(pa[i] + (pa[i + 1] - pa[i]) * t);
        op.push(pin[i] + (pin[i + 1] - pin[i]) * t);
      }
    }
    on.push(sn[sn.length - 1]);
    oe.push(se[se.length - 1]);
    ol.push(lv[lv.length - 1]);
    og.push(gp[gp.length - 1]);
    oa.push(pa[pa.length - 1]);
    // Its reaches off a V: the raster course (points 250 m apart, turning in 45 degree steps) laid as a curve through
    // them (FLOOR_SMOOTH passes at the samples' spacing), not as the raster's straight runs and corners.
    if (op.length) {
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
    untangleCourse(on, oe, ol, og, oa);
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
    // Its catchment: the routing's along its course (never less downstream).
    const area = new Float64Array(count);
    for (let i = 0; i < count; i++) area[i] = Math.max(oa[i], i > 0 ? area[i - 1] : 0);
    const id = nR + streams.length;
    streams.push({ north, east, level, halfWidth: new Float64Array(count), s, area, breach, cut, joins, joinS, end: end.kind, pool, held });
    streamDebug.src?.push(srcTag);
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
    const bt5 = performance.now();
    const bm = (report.buildMs ??= [0, 0, 0, 0, 0]);
    bm[0] += bt1 - bt0;
    bm[1] += bt2 - bt1;
    bm[2] += bt3 - bt2;
    bm[3] += bt4 - bt3;
    bm[4] += bt5 - bt4;
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

  const headFrom = new Float64Array(nR).fill(Infinity);
  // --- The drawn ground's own routing (LOWLINE): the routing ground on the whole raster, its hollows filled (a priority
  // flood from the sea, the domain's edge and the lakes' water, never into the home runway's surroundings), steepest
  // descent over the filled ground, the catchment summed down it. Every stream heads and runs on it; a lake's outlet
  // leaves it by its own lowest way out (outletPath) and runs on down it.
  const tRt = performance.now();
  const N = R * R;
  const fires: Record<string, number> = { heads: 0, stemMoved: 0, riverStems: 0, beside: 0, ponds: 0, cutThrough: 0, shallow: 0, onWater: 0, outlets: 0, outletsClosed: 0 };
  report.lowline = fires;
  /** The water standing at each raster point (a lake's level where it stands over the ground; -Infinity: none). */
  const lakeLevel = (k: number): number => {
    const pool = mask.poolAt(Math.floor(k / R), k % R);
    return pool >= 0 && !mask.pools[pool].drained && Gr[k] < mask.pools[pool].level ? mask.pools[pool].level : -Infinity;
  };
  const F = new Float64Array(N).fill(Infinity);
  /** Each raster point's receiver's direction (index into DI, DJ), -1: none (an outlet, or never reached). */
  const rdir = new Int8Array(N).fill(-1);
  const order = new Int32Array(N);
  let no = 0;
  {
    const done = new Uint8Array(N);
    const heap = new MinHeap(N);
    for (let k = 0; k < N; k++) {
      const i = Math.floor(k / R);
      const j = k % R;
      if (byHome(k)) {
        done[k] = 1;
        continue;
      }
      const lk = lakeLevel(k);
      if (i === 0 || j === 0 || i === R - 1 || j === R - 1 || Gr[k] <= 0.5 || lk > -Infinity) {
        F[k] = lk > -Infinity ? lk : Gr[k];
        done[k] = 1;
        heap.push(k, F[k]);
      }
    }
    while (heap.size > 0) {
      const c = heap.pop();
      order[no++] = c;
      const ci = Math.floor(c / R);
      const cj = c % R;
      for (let a = 0; a < 8; a++) {
        const qi = ci + DI[a];
        const qj = cj + DJ[a];
        if (qi < 0 || qj < 0 || qi >= R || qj >= R) continue;
        const q = qi * R + qj;
        if (done[q]) continue;
        done[q] = 1;
        F[q] = Math.max(Gr[q], F[c] + 1e-3);
        heap.push(q, F[q]);
      }
    }
  }
  /** An outlet of the routing: the domain's edge, the sea, a lake's water. */
  const isOutlet = (k: number): boolean => {
    const ki = Math.floor(k / R);
    const kj = k % R;
    return ki === 0 || kj === 0 || ki === R - 1 || kj === R - 1 || Gr[k] <= 0.5 || lakeLevel(k) > -Infinity;
  };
  for (let k = 0; k < N; k++) {
    if (F[k] === Infinity || isOutlet(k)) continue;
    const ki = Math.floor(k / R);
    const kj = k % R;
    let best = 0;
    for (let a = 0; a < 8; a++) {
      const q = (ki + DI[a]) * R + kj + DJ[a];
      const sl = (F[k] - F[q]) / (DI[a] !== 0 && DJ[a] !== 0 ? SQRT2 : 1);
      if (sl > best) {
        best = sl;
        rdir[k] = a;
      }
    }
  }
  const recv = (k: number): number => (rdir[k] < 0 ? -1 : k + DI[rdir[k]] * R + DJ[rdir[k]]);
  const cellKm2 = (LAKE_RASTER / 1000) ** 2;
  const area = new Float32Array(N).fill(cellKm2);
  for (let i = no - 1; i >= 0; i--) {
    const c = order[i];
    const r = recv(c);
    if (r >= 0) area[r] += area[c];
  }
  /** How far each point's water runs to its outlet, raster steps. */
  const toOutlet = new Float32Array(N);
  for (let i = 0; i < no; i++) {
    const c = order[i];
    const r = recv(c);
    if (r >= 0) toOutlet[c] = toOutlet[r] + (DI[rdir[c]] !== 0 && DJ[rdir[c]] !== 0 ? SQRT2 : 1);
  }
  // --- The hollows the flood filled: each connected set of points whose filled level stands over their ground (by more
  // than HOLLOW_TOL), its spill (the lowest filled level in it), its bottom and the point its water leaves by.
  const hid = new Int32Array(N).fill(-1);
  const hollows: Array<{ pts: number[]; W: number; bottom: number; out: number; wet: boolean }> = [];
  for (let k0 = 0; k0 < N; k0++) {
    if (hid[k0] >= 0 || !(F[k0] - Gr[k0] > HOLLOW_TOL) || F[k0] === Infinity || isOutlet(k0)) continue;
    const h = hollows.length;
    const pts = [k0];
    hid[k0] = h;
    let W = Infinity;
    let bottom = Infinity;
    let out = k0;
    let wet = false;
    for (let t = 0; t < pts.length; t++) {
      const c = pts[t];
      W = Math.min(W, F[c]);
      bottom = Math.min(bottom, Gr[c]);
      if (area[c] > area[out]) out = c;
      if (occ[c] !== 0) wet = true;
      const ci = Math.floor(c / R);
      const cj = c % R;
      for (let a = 0; a < 8; a++) {
        const qi = ci + DI[a];
        const qj = cj + DJ[a];
        if (qi < 0 || qj < 0 || qi >= R || qj >= R) continue;
        const q = qi * R + qj;
        if (hid[q] >= 0 || !(F[q] - Gr[q] > HOLLOW_TOL) || F[q] === Infinity || isOutlet(q)) continue;
        hid[q] = h;
        pts.push(q);
      }
    }
    hollows.push({ pts, W, bottom, out, wet });
  }
  report.routingMs = performance.now() - tRt;
  streamDebug.routing = streamDebug.keep ? { area, rdir, G: Gr, F } : undefined;
  /**
   * What a hollow on a line's way holds, decided once for the hollow (whichever line crosses it first): one level. The
   * line wears a notch through its spill no deeper than a stream of the catchment leaving it keeps through a rim
   * (breachAllowance); a hollow deeper than that holds a pond at the spill less the notch (drawn as any lake:
   * LakeMask.addPond), never lower than the water it spills into. Owner decision 3: a pond over POND_KEEP km² is cut
   * through instead where its spill stands POND_SILL_CUT m or less over its bottom (else it stays a lake). The level
   * (NaN: none, the lines run through at their own water) and the pond's points.
   */
  const hollowLevel = new Float64Array(hollows.length).fill(NaN);
  const hollowDone = new Uint8Array(hollows.length);
  const pondOfHollow = new Int32Array(hollows.length).fill(-1);
  const decideHollow = (h: number): void => {
    if (hollowDone[h]) return;
    hollowDone[h] = 1;
    const H = hollows[h];
    if (H.wet) {
      fires.onWater++;
      return;
    }
    const r = recv(H.out);
    const into = r >= 0 && isOutlet(r) ? F[r] : -Infinity;
    const level = Math.max(H.W - breachAllowance(area[H.out]), into);
    if (level - H.bottom < LAKE_MIDDLE_DEPTH) {
      fires.shallow++;
      return;
    }
    const dom: number[] = [];
    let wet = 0;
    for (const q of H.pts) {
      if (Gr[q] >= level + LAKE_MARGIN) continue;
      dom.push(q);
      if (Gr[q] < level) wet++;
    }
    if (wet < 2) {
      fires.shallow++;
      return;
    }
    if (wet * cellKm2 > POND_KEEP && into < level && H.W - H.bottom <= POND_SILL_CUT) {
      report.pondWhy ??= {};
      report.pondWhy.cutThrough = (report.pondWhy.cutThrough ?? 0) + 1;
      fires.cutThrough++;
      return;
    }
    hollowLevel[h] = level;
    fires.ponds++;
    pondOfHollow[h] = mask.addPond(dom, dom.map((q) => Gr[q]), level, H.out);
    (report.filledPonds ??= []).push(pondOfHollow[h], dom.length, level, H.W, ORIGIN + Math.floor(H.pts[0] / R) * LAKE_RASTER, ORIGIN + (H.pts[0] % R) * LAKE_RASTER, breachAllowance(area[H.out]), into, H.bottom, wet);
  };

  // --- The lines' courses down the routing, before any is built (so every hollow on them is decided, and its pond
  // stands, before a level is read): each from its first point to the first point a line holds (a river's channel, or
  // a course laid before it), a lake's water, the sea or the domain's edge. A course come beside another's water on its
  // floor - a neighbouring raster point of it, the ground level across within FLOOR_FLAT and its water no higher -
  // joins it there: one floor, one line.
  /** Each raster point a course runs through: the course (1 + its index among the courses) and where along it. */
  const onCourse = new Int32Array(N);
  const onCourseAt = new Int32Array(N);
  /** The water each course stands at on its raster points so far (the lowest ground on its course, less its depth). */
  const courseLv: Float64Array[] = [];
  type Course = { path: number[]; pathA: number[]; end: End; area0: number; pool: number; first: { north: number; east: number; level: number } | null; avoid: Set<number> | null; lakeAvoid: Set<number> | null };
  const courses: Course[] = [];
  const walk = (start: number[], own: number, level: number, avoidLines: Set<number> | null, avoidLakes: Set<number> | null): { path: number[]; end: End } => {
    const path = start.slice();
    const ci = courses.length + 1;
    let run = level;
    const lv: number[] = [];
    const take = (k: number): void => {
      run = Math.min(run, Gr[k] - STREAM_DEPTH);
      lv.push(run);
    };
    path.forEach(take);
    let end: End = { kind: 'stuck', line: -1, idx: 0, pool: -1, why: 'steps' };
    const waterAt = (k: number): End | null => {
      const o = occ[k];
      if (o !== 0 && !(avoidLines && avoidLines.has(occLine(o)))) return { kind: 'channel', line: occLine(o), idx: occIdx(o), pool: -1, ok: true };
      const c = onCourse[k];
      if (c !== 0 && c !== ci) return { kind: 'channel', line: -c, idx: onCourseAt[k], pool: -1, ok: true };
      const ki = Math.floor(k / R);
      const kj = k % R;
      if (ki <= 0 || kj <= 0 || ki >= R - 1 || kj >= R - 1) return { kind: 'edge', line: -1, idx: 0, pool: -1 };
      const pool = mask.poolAt(ki, kj);
      if (pool >= 0 && pool !== own && !mask.pools[pool].drained && Gr[k] < mask.pools[pool].level && !(avoidLakes && avoidLakes.has(pool))) return { kind: 'lake', line: -1, idx: 0, pool, ok: true };
      if (Gr[k] <= 0.5) return { kind: 'sea', line: -1, idx: 0, pool: -1 };
      return null;
    };
    for (let step = 0, k = path[path.length - 1]; step < MAX_STEPS; step++) {
      if (step > 0 || own >= 0) {
        const e = waterAt(k);
        if (e) {
          end = e;
          break;
        }
      }
      // (Beside another course's water on its floor, no higher than its own: it joins it.)
      {
        const ki = Math.floor(k / R);
        const kj = k % R;
        let joined: End | null = null;
        for (let a = 0; a < 8 && !joined && step > 0 && streamHeads.beside; a++) {
          const q = (ki + DI[a]) * R + kj + DJ[a];
          const c = onCourse[q];
          if (c === 0 || c === ci) continue;
          if (Math.abs(Gr[q] - Gr[k]) > FLOOR_FLAT || courseLv[c - 1][onCourseAt[q]] > run) continue;
          const mid = p.route(ORIGIN + (ki + 0.5 * DI[a]) * LAKE_RASTER, ORIGIN + (kj + 0.5 * DJ[a]) * LAKE_RASTER);
          if (mid > Math.max(Gr[q], Gr[k]) + FLOOR_RISE) continue;
          path.push(q);
          take(q);
          joined = { kind: 'channel', line: -c, idx: onCourseAt[q], pool: -1, ok: true };
          fires.beside++;
        }
        if (joined) {
          end = joined;
          break;
        }
      }
      const r = recv(k);
      if (r < 0) {
        end = Gr[k] <= 0.5 ? { kind: 'sea', line: -1, idx: 0, pool: -1 } : { kind: 'sink', line: -1, idx: 0, pool: -1, why: isOutlet(k) ? 'outlet' : 'flood' };
        break;
      }
      // (Not back into its own lake, nor into the water it must keep out of - a lake's outlet's.)
      const lr = lakeLevel(r);
      if (lr > -Infinity && (mask.poolAt(Math.floor(r / R), r % R) === own || (avoidLakes && avoidLakes.has(mask.poolAt(Math.floor(r / R), r % R))))) {
        end = { kind: 'sink', line: -1, idx: 0, pool: -1, why: 'closed' };
        break;
      }
      path.push(r);
      take(r);
      k = r;
    }
    // (Its points are a course's now: later courses reach them.)
    for (let i = 0; i < path.length; i++) {
      const k = path[i];
      if (onCourse[k] !== 0 || occ[k] !== 0) continue;
      onCourse[k] = ci;
      onCourseAt[k] = i;
    }
    courseLv.push(Float64Array.from(lv));
    return { path, end };
  };

  /** The lake a course's water ends in, through the courses it joins (-1: none - a river, the sea). */
  const endsIn = (c: number): number => {
    for (let g = 0; c >= 0 && g < courses.length; g++) {
      const e = courses[c].end;
      if (e.kind === 'lake') return e.pool;
      c = e.kind === 'channel' && e.line < 0 ? -e.line - 1 : -1;
    }
    return -1;
  };
  // Lake outlets: every pool that stands with no river through it, from its spill point.
  const pondArea = (k: number): number => d.lakes[k].area;
  const poolsBySize = mask.pools.map((_, i) => i).filter((i) => !mask.pools[i].drained);
  report.pools = poolsBySize.length;
  poolsBySize.sort((a, b) => pondArea(mask.pools[b].lake) - pondArea(mask.pools[a].lake) || mask.pools[b].wet - mask.pools[a].wet || a - b);
  /** The lake each outlet course drains (index into courses -> pool). */
  for (const id of poolsBySize) {
    const pool = mask.pools[id];
    if (p.riverPools[id]) {
      report.riverPools++;
      continue;
    }
    // The lowest way out of the lake over the ground (a priority flood from its water, minimax): to the first point
    // lower than its water, a channel, another lake or the sea. (Never into a course ending in this lake, nor one running
    // into that, nor a lake upstream of those: round T, no outlet loops back.)
    const lakeWalls = new Set<number>();
    for (let grew = true; grew; ) {
      grew = false;
      for (let c = 0; c < courses.length; c++) {
        const P = courses[c].pool;
        if (P < 0 || lakeWalls.has(P)) continue;
        const into = endsIn(c);
        if (into === id || lakeWalls.has(into)) {
          lakeWalls.add(P);
          grew = true;
        }
      }
    }
    const out = outletPath(id, null, Infinity, lakeWalls.size ? lakeWalls : null);
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
    const t = out.end ? { path: out.path.slice(1), end: { ...out.end, ok: true } } : walk(out.path.slice(1), id, pool.level, null, lakeWalls.size ? lakeWalls : null);
    if (out.end) {
      for (let i = 0; i < t.path.length; i++) if (onCourse[t.path[i]] === 0 && occ[t.path[i]] === 0) (onCourse[t.path[i]] = courses.length + 1), (onCourseAt[t.path[i]] = i);
      courseLv.push(new Float64Array(t.path.length).fill(pool.level));
    }
    // (Its way on leads back into its lake, or a lake upstream of it: the lake has no way out lower than that, and no
    // outlet - as a lake whose rim rises more than OUTLET_SILL.)
    if (t.path.length === 0 || (t.end.kind === 'sink' && t.end.why === 'closed')) {
      const ci = courses.length + 1;
      for (const k of t.path) if (onCourse[k] === ci) onCourse[k] = 0;
      courseLv.pop();
      report.outletNone++;
      fires.outletsClosed++;
      report.outletHigh++;
      continue;
    }
    report.outlets++;
    fires.outlets++;
    report.outletSteps += t.path.length;
    courses.push({ path: t.path, pathA: t.path.map((k) => a0 + area[k]), end: t.end, area0: Math.max(1, a0), pool: id, first, avoid: null, lakeAvoid: lakeWalls.size ? lakeWalls : null });
  }
  const nOutlets = courses.length;
  // --- Where a stream heads: where the routing's catchment reaches the ground's own channel head - the threshold
  // slopes' (SlopeParams.ac: their V's begin there) where they built the ground, the model's (CHANNEL_AREA: it carves its
  // channels from there) elsewhere - with no head above it.
  const gn = gullyNet();
  const AV = slopeParams().ac;
  const headArea = (k: number): number => (gn && gn.n === R && gn.dir[k] ? AV : streamHeads.lowland);
  const chDonor = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    if (area[k] < headArea(k)) continue;
    const r = recv(k);
    if (r >= 0) chDonor[r] = 1;
  }
  /** Up a channel's main stem from raster point k (its largest donor each step) while the catchment there is at least
   * the finest channel head the ground has (ac): where the channel begins. */
  const stemHead = (k: number): number => {
    for (let g = 0; g < MAX_STEPS; g++) {
      const ki = Math.floor(k / R);
      const kj = k % R;
      let best = -1;
      for (let a = 0; a < 8; a++) {
        const qi = ki + DI[a];
        const qj = kj + DJ[a];
        if (qi < 0 || qj < 0 || qi >= R || qj >= R) continue;
        const q = qi * R + qj;
        if (recv(q) !== k || area[q] < AV) continue;
        if (best < 0 || area[q] > area[best] || (area[q] === area[best] && q < best)) best = q;
      }
      if (best < 0) return k;
      k = best;
    }
    return k;
  };
  const headSet = new Set<number>();
  for (let k = 0; k < N; k++)
    if (area[k] >= headArea(k) && !chDonor[k] && rdir[k] >= 0) {
      const h = streamHeads.stem ? stemHead(k) : k;
      fires.heads++;
      if (h !== k) fires.stemMoved++;
      headSet.add(h);
    }
  // (A river is a channel too: its main stem above its head - where its own head has no channel above it - is a stream
  // from there.)
  if (streamHeads.stem) {
    for (let li = 0; li < nR; li++) {
      const rv = rivers[li];
      if (mask.at(rv.north[0], rv.east[0]) > -Infinity) continue;
      const ri = Math.round((rv.north[0] - ORIGIN) / LAKE_RASTER);
      const rj = Math.round((rv.east[0] - ORIGIN) / LAKE_RASTER);
      let k0 = -1;
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++) {
          const q = (ri + a) * R + rj + b;
          if (q < 0 || q >= N || lakeLevel(q) > -Infinity) continue;
          if (k0 < 0 || area[q] > area[k0]) k0 = q;
        }
      if (k0 < 0) continue;
      const h = stemHead(k0);
      if (h !== k0 && occ[h] === 0) {
        headSet.add(h);
        fires.riverStems++;
      }
    }
  }
  const lheads = [...headSet];
  // The longest first: a valley's trunk is one line, each side valley's stream joins it.
  lheads.sort((a, b) => toOutlet[b] - toOutlet[a] || a - b);
  const chainStats = { heads: lheads.length, traced: 0, km: 0, skipped: 0, crossed: 0, ms: 0, msTrace: 0, msBuild: 0, samples0: report.samples };
  const tc = performance.now();
  for (const q of lheads) {
    if (occ[q] !== 0 || onCourse[q] !== 0 || mask.poolAt(Math.floor(q / R), q % R) >= 0 || Gr[q] <= 0.5) {
      chainStats.skipped++;
      continue;
    }
    const t = walk([q], -1, Gr[q], null, null);
    if (t.end.kind === 'channel' && t.end.line < 0) chainStats.crossed++;
    courses.push({ path: t.path, pathA: t.path.map((k) => area[k]), end: t.end, area0: area[q], pool: -1, first: null, avoid: null, lakeAvoid: null });
  }
  chainStats.msTrace = performance.now() - tc;
  // --- Every hollow on a course decided (its pond stands before any level is read).
  for (const C of courses) for (const k of C.path) if (hid[k] >= 0) decideHollow(hid[k]);
  // --- Each course laid at the lowest ground across its flow within half a raster step either side, at each raster
  // point (a rise of its water's depth over the lowest seen is a bank it does not look past), and built.
  const courseLine = new Int32Array(courses.length).fill(-1);
  const tb = performance.now();
  const HALF = LAKE_RASTER / 2;
  const LOOK = [HALF / 3, (2 * HALF) / 3, HALF];
  courses.forEach((C, ci) => {
    const { path } = C;
    const m = path.length;
    const at = { n: new Array<number>(m), e: new Array<number>(m), g: new Array<number>(m) };
    const vee = new Array<number>(m).fill(1);
    for (let i = 0; i < m; i++) {
      const k = path[i];
      const ki = Math.floor(k / R);
      const kj = k % R;
      let bn = ORIGIN + ki * LAKE_RASTER;
      let be = ORIGIN + kj * LAKE_RASTER;
      let bg = Gr[k];
      at.n[i] = bn;
      at.e[i] = be;
      at.g[i] = bg;
      if (m < 3 || i === 0 || i >= m - 2 || hid[k] >= 0 || mask.poolAt(ki, kj) >= 0) continue;
      const a = path[i - 1];
      const b = path[i + 1];
      const dn = Math.floor(b / R) - Math.floor(a / R);
      const de = (b % R) - (a % R);
      const dl = Math.hypot(dn, de);
      if (!(dl > 0)) continue;
      const un = -de / dl;
      const ue = dn / dl;
      // (In a V - the ground a raster step either side across its flow stands V_SIDE over it - it keeps to its point.)
      const si = Math.round(un);
      const sj = Math.round(ue);
      const A = (ki + si) * R + kj + sj;
      const B = (ki - si) * R + kj - sj;
      if (A >= 0 && B >= 0 && A < N && B < N && Gr[A] - Gr[k] > V_SIDE && Gr[B] - Gr[k] > V_SIDE) continue;
      vee[i] = 0;
      const n0 = bn;
      const e0 = be;
      for (const side of [-1, 1]) {
        let low = Gr[k];
        for (const t of LOOK) {
          const qn = n0 + side * un * t;
          const qe = e0 + side * ue * t;
          const g = p.route(qn, qe);
          report.snapSamples = (report.snapSamples ?? 0) + 1;
          if (g > low + STREAM_DEPTH) break;
          low = Math.min(low, g);
          if (g < bg) {
            bg = g;
            bn = qn;
            be = qe;
          }
        }
      }
      if (bn !== n0 || be !== e0) {
        if (mask.at(bn, be) > -Infinity) continue;
        report.snapped = (report.snapped ?? 0) + 1;
        at.n[i] = bn;
        at.e[i] = be;
        at.g[i] = bg;
      }
    }
    // A course ending on another course: on the line built from it, at the sample its raster point maps to.
    let end = C.end;
    if (end.kind === 'channel' && end.line < 0) {
      const o = occ[path[m - 1]];
      const L = courseLine[-end.line - 1];
      if (o !== 0 && L >= 0 && occLine(o) === nR + L) end = { ...end, line: occLine(o), idx: occIdx(o) };
      else if (o !== 0) end = { ...end, line: occLine(o), idx: occIdx(o) };
      else end = { kind: 'sink', line: -1, idx: 0, pool: -1, why: 'unbuilt' };
    }
    // (Through a pond on its way at the pond's level.)
    pendingFloor = new Map();
    for (const k of path) {
      const h = hid[k];
      if (h >= 0 && hollowLevel[h] === hollowLevel[h]) pendingFloor.set(k, hollowLevel[h]);
    }
    srcTag = C.pool >= 0 ? 'outlet' : 'chain';
    const before = streams.length;
    build(path, end, C.pool >= 0 ? C.first : null, C.pool, C.pathA, vee, at);
    if (streams.length > before) {
      courseLine[ci] = before;
      if (ci >= nOutlets) {
        chainStats.traced++;
        chainStats.km += streams[before].s[streams[before].s.length - 1] / 1000;
      }
    }
  });
  chainStats.msBuild = performance.now() - tb;
  chainStats.ms = performance.now() - tc;
  chainStats.samples0 = report.samples - chainStats.samples0;
  report.chains = chainStats;
  // (Where a river's water starts: a chain may join it above its first feeder - riverNetwork.ts trims the river's head
  // to the first junction.)
  for (const st of streams) if (st.joins >= 0 && st.joins < nR) headFrom[st.joins] = Math.min(headFrom[st.joins], st.joinS);

  report.tracePhases.push(performance.now() - t0);
  // --- Catchment down the network: the routing summed each line's own (every line joining it upstream is in it). A
  // lake's catchment is not (the lakes are the routing's outlets): an outlet carries its lake's, and every line it runs
  // into carries it on from where it joins (latest first: a line only ever joins one built before it).
  const carry = streams.map((st) => (st.pool >= 0 ? st.area[0] : 0));
  for (let j = streams.length - 1; j >= 0; j--) {
    const st = streams[j];
    if (st.joins < nR || carry[j] <= 0) continue;
    const P = streams[st.joins - nR];
    for (let i = 0; i < P.s.length; i++) if (P.s[i] >= st.joinS - 1e-6) P.area[i] += carry[j];
    carry[st.joins - nR] += carry[j];
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

