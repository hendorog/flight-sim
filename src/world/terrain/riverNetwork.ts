// A seeded world's rivers and lakes (any seed but 0), built from its drainage (drainage.ts) at load in every thread.
// Seed 0 keeps the hand-placed river and lakes of hydrology.ts.
//
// Each drainage line becomes a river: its valley axis the course the model carved its valley along (erosion.ts
// channelCourse, on the drainage's own tree), its width from
// the catchment area, the big lowland rivers swung into meanders about the axis (a skewed sine whose wavelength
// follows the width, so no growth simulation has to run at load), and its water level falling from the source,
// meeting the river it joins at the confluence and lying level through any lake on its course. Lakes are the ponds
// the drainage leaves behind its breach cuts (drainage.ts LakeMask: the water covers the ground below the pond's level
// across its lattice cells); ellipses fitted to them place what goes by a lake.

import { hash2i, gnoise } from './noise';
import { LAKE_ZONE, PolylineIndex, CHANNEL_BANK, type FlowHit, type PolylineNear, type ChannelNear, type Hydrology, type Lake, type NetworkQuery, type OxbowHit, type RiverHit, type RiverLine, type ValleyHit, type ValleyNear } from './hydrology';
import { cellEast, cellNorth, DRAIN_CELL, LAKE_RASTER, type Drainage, type DrainLine, type LakeMask } from './drainage';
import { channelCourse, courseSpline } from './erosion';
import { bedWidth, breachOfCut, breachReachOf, channelHalfWidth, FallIndex, FEED_JOIN, flowOf, HEAD_START_AREA, REGIME, refineSteep, traceStreams, type Fall, type StreamLine, type StreamReport } from './streams';
import { bendOf, fitSwing, formOf, hSmooth, layThread, sineAmplitude, stepWhite, threadDepth } from './channelForm';
import { bedGrain, shapeLines, type LineArrays, type ShapeInput, type ShapeReport } from './falls';
import { buildFaults, FaultIndex } from './faults';
import { pitchPool, type PitchReport } from './pitchPool';
import { macroAt, type Macro } from './seededLayout';
import { AIRPORT } from '../../core/world';

/** Oxbow water stands this far above the river level of its valley section, m (as hydrology.ts). */
const OXBOW_LEVEL = 0.6;
/** Past a lake's outlet the river keeps the lake's level over this stretch, m (while its banks stand over it). */
const OUTLET_RUN = 800;
/** A pond whose water stands this far above the river running into it is drained (see the levels below), m. */
const DRAIN_MARGIN = 8;
/** Valley-axis sample spacing, m. */
const AXIS_SPACING = 120;
/** Index cells, m. */
const CHANNEL_CELL = 500;
const VALLEY_CELL = 1000;
/** A valley's stretches are blended over this far past the nearest (SegmentIndex.perLineBlend), m, at most
 * VALLEY_BAND_MAX. */
const valleyBand = (d: number): number => Math.min(VALLEY_BAND_MAX, 40 + 0.1 * d);
const VALLEY_BAND_MAX = 300;
/** Channels are searched this far beyond their half-width (bank and levee), m. */
const CHANNEL_MARGIN = CHANNEL_BANK + 45;
/** Beyond the channel index's reach, queryRiver estimates the distance from the valley axis. */
const CHANNEL_REACH = 450;
/** A stream's channel is listed, and reported by queryRiver and queryFlow, this far from it, m (a river's: CHANNEL_REACH). */
const STREAM_REACH = 150;
/** A river's head (not in a lake) widens from the stream feeding it to its own width over this much valley, m. */
const HEAD_TAPER = 1500;
/** Below a confluence the receiver's catchment steps up at once by what its lattice catchment gains within this, m
 * (the lattice counts the tributary's water a cell further on: brought forward to the confluence, not counted twice). */
const JOIN_PULL = 1000;
/** A line's last reach falls at most this steeply into the water it joins (m/m): a cascade, no fall at the confluence. */
const CONFLUENCE_GRADIENT = 0.3;
/** ... a gully chain's stream (gullies.ts) as steep as the threshold slopes it comes down (hillslopes.ts SLOPES.sc). */
const CHAIN_CONFLUENCE = 0.75;
/** A stream's water is raised towards the drawn ground where it runs more than RAISE_CUT m under the ground it was
 * traced on, to RAISE_DEPTH under the natural ground at most. */
const RAISE_CUT = 2;
const RAISE_DEPTH = 1.2;
/** ... and to at most this much over the lower of the ground either side, RAISE_SIDE m beyond its channel's half-width. */
const RAISE_BANK = 2;
const RAISE_SIDE = 25;
/** Round T repairs: a stream's water where it runs into standing water (a lake, a pond) stands at the water's surface,
 * not under it (riverNetwork.ts, after the pitches): see "Into standing water". */
const AT_THE_SURFACE = true;
/** ... only for a lake the line ends in or stays in: not one it passes, coming to it, running along it and leaving it
 * for good more than this under its level, m. */
const LEAVE_BELOW = 1;
/** heightfield.ts FIELD_RAISE (holdUnder): a stream's water is raised no more than this over another stream's within both
 * half-widths and RAISE_BESIDE_REACH of it, m. */
const RAISE_BESIDE = 1;
const RAISE_BESIDE_REACH = 20;
/** A hanging valley's lip lies where the alpine uplift (seededLayout.ts) is over this: high in the ranges. */
const HANG_UPLIFT = 0.25;
/** Catchment (km²) above which a river meanders on low ground, and the valley gradient below which it does. */
const MEANDER_AREA = 250;
const MEANDER_GRADIENT = 0.004;

/** The channel-form law's single-thread bank-full width for a catchment (channelForm.ts formOf: W_s), m. */
const formWs = (area: number): number => 4.47 * Math.pow(Math.max(0.05, area), 0.39);
/** A river's room is read across its axis every ROOM_EVERY axis samples, a stream's every STREAM_ROOM_EVERY m of its
 * course, out along ROOM_LADDER (then bisected), m. */
const ROOM_EVERY = 4;
const STREAM_ROOM_EVERY = 100;
const ROOM_LADDER = [15, 30, 50, 80, 120, 170, 230, 300, 400, 520, 680, 880, 1150, 1500];
/** The floor a bed is given at least (a river held under ground that falls away beside it still has a bed), m. */
const FLOOR_MIN = 10;
/** The thread's wavelength is at least this (six of the 8 m samples a level of detail keeps), m. */
const LAMBDA_MIN = 48;
/** A channel's water is checked against the valleys' carve every CARVE_CHECK m of its arc. */
const CARVE_CHECK = 40;
/** The bed's width varies as exp(WIDTH_SPREAD h) (DESIGN.md: a width CV about 0.45). */
const WIDTH_SPREAD = 0.45;
/** A reach with no white water draws at most this steepness (water.ts FLOW_FROM: placid below it). */
const WHITE_FROM = 0.19;

/** Channel half-width for a catchment area, m. */
export const halfWidthFor = (area: number): number => Math.min(45, Math.max(3, 1.5 + 0.85 * Math.sqrt(area)));

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Polynomial smooth minimum (as heightfield.ts's smin). */
const sminN = (a: number, b: number, k: number): number => {
  const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (b - a)) / k));
  return b + (a - b) * h - k * h * (1 - h);
};
/** heightfield.ts valleyProfile: a valley's floor and walls over its water at distance d from its axis, m. */
function valleyWall(d: number, floodplain: number): number {
  if (d < floodplain) return 1.3 + 1.2 * smooth(0.5 * floodplain, floodplain, d);
  const b = d - floodplain;
  return 1.3 + 1.2 + 0.012 * b + 0.00011 * b * b;
}

/** The walls' lowering (wallLift) takes over from the carve's own shape over this share of a valley's reach past where
 * the walls start (wallStart). */
const WALL_IN = 0.1;
/** Where the carve's own shape cuts deeper than the walls' gap (on the way in from the floor), the cut at most WALL_CUT
 * times the distance to the reach's edge: the walls above steepen by that much at most. */
const WALL_CUT = 0.25;
/** A valley's floor over its water (valleyWall at the floodplain's edge), m: a wall's gap is the ground's height over it. */
const FLOOR_OVER = 2.5;
/** The carve's own floor is kept this far past the farthest a channel swings (its banks and their carving's reach,
 * heightfield.ts channelProfile within CHANNEL_MARGIN), m. */
const SWING_KEEP = CHANNEL_BANK + 45;
/** Where a valley's walls start, as a share of its reach past the floodplain (wallLift's t0): past the floodplain,
 * and past the channel's swing (belt and half-width, ValleyNear.swing). */
export const wallStart = (f: number, I: number, swing: number): number => Math.max(0, (swing + SWING_KEEP - f) / I);
/**
 * A valley's carve target at reach fraction t = (d - floodplain) / reach I, where the ground there stands as the
 * threshold hillslopes' walls (hillslopes.ts; weight w, erosion.ts ErosionSample.mw); `target` is the carve's own.
 *
 * The carve's own shape (a floor, then walls climbing as t^2 to the ground at the reach's edge: a gorge through a
 * plateau) cuts a straight 36 degree wall deeply - a third of its height at mid-reach - and meets it at the edge at
 * twice its slope, then fades out over the last quarter: a band of near-vertical rock along the valley's side (stage
 * 4's pale slabs; most of stepScan's steps). Here the walls are instead only lowered by their gap (ValleyNear.gap: how
 * far the ground where the wall starts stands over the floor), tapering out quadratically to the reach's edge: the V
 * stays a V, sunk to its water, and meets the carve's floor where it starts. That takes over from the carve's own shape
 * over WALL_IN of the reach; on the way the cut is at most WALL_CUT times the distance to the reach's edge (or the gap's
 * taper, if more). Nothing where w is 0 (all the ground but the mountains' slopes: unchanged there), nor on the
 * floodplain or across the channel's swing.
 */
export function wallLift(target: number, h: number, t: number, I: number, gap: number, w: number, t0 = 0): number {
  if (!(w > 0) || !(t > t0) || t0 >= 1) return target;
  const r = 1 - Math.min(1, t);
  const rw = r / (1 - t0);
  const s = smooth(t0, t0 + WALL_IN, t);
  const cut = gap * rw * rw;
  const tw = Math.max((h - cut) * s + target * (1 - s), h - Math.max(WALL_CUT * I * r, cut) / Math.max(s, 1e-6));
  return tw > target ? target + w * (tw - target) : target;
}
/** The gap of a valley's side at its segment k, t along it (ValleyNear.gap). */
const gapAt = (a: { gapR: Float64Array; gapL: Float64Array }, k: number, t: number, side: number): number => {
  const g = side > 0 ? a.gapR : a.gapL;
  return g[k] + (g[k + 1] - g[k]) * t;
};

/**
 * No cliffs: a small stream may fall steeply, a big river at most 0.8 % more than the ground under it falls (the
 * drop is spread upstream). Where the ground itself falls steeply the water falls with it: a cap on the gradient
 * alone would hold a big mountain river to 0.8 % from its mouth upward, hundreds of metres under its valley floor.
 * A lake holds its level: the drop below its outlet stays there (rapids, a fall), not spread up through the lake.
 */
function capFall(p: { s: Float64Array; area: Float64Array; level: Float64Array; wet: Uint8Array; fall: Float64Array }): void {
  const { s, area, level, wet, fall } = p;
  for (let i = level.length - 2; i >= 0; i--) {
    if (wet[i]) continue;
    const cap = 0.008 + 0.6 * (1 - smooth(100, 1500, area[i]));
    level[i] = Math.min(level[i], level[i + 1] + cap * (s[i + 1] - s[i]) + Math.max(0, fall[i] - fall[i + 1]));
  }
}

/** destair: a drop at least this big ends a stair's tread, m; treads longer than STAIR_RUN are left level, m. */
const STAIR_DROP = 0.5;
const STAIR_RUN = 1500;
/**
 * No staircase: where the running minimum of the ground holds the water level over a short rise (a spur, a bump the
 * course crosses on a valley side) and then drops it, the valley carved about the level would be a flight of level
 * treads across the valley floor (ribs, 15-35 m steps every couple of hundred metres down a steep stream). Each short
 * tread is tilted down to the foot of its drop instead: never higher than it was, so still under the ground. Not over
 * a lake or the reaches held at its level by its outlet and inlet (dry anchors only), nor long level reaches.
 */
function destair(p: { s: Float64Array; level: Float64Array; wet: Uint8Array; pinned: Uint8Array }): void {
  const { s, level } = p;
  const fixed = (i: number): number => p.wet[i] | p.pinned[i];
  const n = level.length;
  let a = 0;
  for (let i = 1; i < n; i++) {
    if (!(fixed(i) || i === n - 1 || level[i] < level[i - 1] - STAIR_DROP)) continue;
    if (!fixed(a) && !fixed(i) && i - a > 1 && s[i] - s[a] <= STAIR_RUN) {
      const k = (level[i] - level[a]) / (s[i] - s[a]);
      for (let j = a + 1; j < i; j++) level[j] = Math.min(level[j], level[a] + k * (s[j] - s[a]));
    }
    a = i;
  }
}

/** The fine grid the model's floors are marked on, m (erosion.ts CUT_CELL). */
const FLOOR_GRID = 250;
/**
 * How far either side of a line's valley axis its own floor reaches (erosion.ts markCourse), m, per axis point: as far
 * as the channel can swing (the widest meander belt its catchment could take, where the lattice falls gently enough
 * for it to meander, at double MEANDER_GRADIENT for margin: the levels that decide it come later) or the floodplain
 * would reach, with the 80 m the levels are sampled either side, and a fine-grid cell more so the interpolated mark
 * is whole there. `t` is each point's place along the line's cells (bspline2).
 */
function floorHalf(d: Drainage, L: DrainLine, area: Float64Array, t: ArrayLike<number>): Float64Array {
  const cells = L.cells;
  const m = cells.length;
  // The lattice's fall along the line, m/m, over two cells either side.
  const grad = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    const a = Math.max(0, k - 2);
    const b = Math.min(m - 1, k + 2);
    let run = 0;
    for (let j = a; j < b; j++) run += Math.hypot(cellNorth(d, cells[j + 1]) - cellNorth(d, cells[j]), cellEast(d, cells[j + 1]) - cellEast(d, cells[j]));
    grad[k] = run > 0 ? Math.max(0, d.height[cells[a]] - Math.max(0, d.height[cells[b]])) / run : 0;
  }
  const out = new Float64Array(area.length);
  for (let i = 0; i < area.length; i++) {
    const k = Math.max(0, Math.min(m - 1, Math.round(t[i])));
    const hw = halfWidthFor(area[i]);
    const low = 1 - smooth(MEANDER_GRADIENT, 2 * MEANDER_GRADIENT, grad[k]);
    const mFree = smooth(MEANDER_AREA * 0.6, MEANDER_AREA * 1.6, area[i]) * low;
    const belt = Math.max(160, 36 * hw) * 1.15 * (0.06 + 0.55 * mFree);
    const floodplain = belt + hw + CHANNEL_BANK + 4 * hw * Math.min(1, belt / 200);
    out[i] = Math.max(floodplain, belt + hw + 80) + FLOOR_GRID;
  }
  return out;
}

interface Axis {
  north: Float64Array;
  east: Float64Array;
  s: Float64Array;
  area: Float64Array;
  level: Float64Array;
  halfWidth: Float64Array;
  belt: Float64Array;
  /** Meander strength, [0, 1] (streams wiggle a little at 0), and the meander wavelength along the valley, m. */
  wavelength: Float64Array;
  floodplain: Float64Array;
  influence: Float64Array;
  /** The ground the level was read from (the lowest of the axis and 80 m either side), m. */
  ground: Float64Array;
  /** Each side's wall gap (ValleyNear.gap: right, left of the flow), m; 0 off the threshold hillslopes. */
  gapR: Float64Array;
  gapL: Float64Array;
}

/**
 * The lakes of a seeded world, as Lake records for what places things by a lake (landmarks, sites, habitat, airfield
 * siting): an ellipse fitted to the water of each pond's main pool (drainage.ts LakeMask, its wet raster points), centred
 * on its middle (the water nearest its centroid, a few metres deep: a crescent's centroid may lie on its shore) and
 * sized by the water's spread about that same point (a uniform ellipse of semi-axis a has a spread of a / 2 along it),
 * at its level. The water itself is the LakeMask; these ellipses are not carved into the terrain. A pond the flood left
 * no water in has none.
 */
export function networkLakes(d: Drainage, mask: LakeMask): Lake[] {
  const out: Lake[] = [];
  for (let k = 0; k < d.lakes.length; k++) {
    const id = mask.main[k];
    if (id < 0) continue;
    const p = mask.pools[id];
    // The spread about the middle; each wet raster point stands for a square LAKE_RASTER a side: add its own spread so
    // a one-row lake has width.
    const dn = p.north - p.centreNorth;
    const de = p.east - p.centreEast;
    const snn = p.snn + dn * dn + (LAKE_RASTER * LAKE_RASTER) / 12;
    const see = p.see + de * de + (LAKE_RASTER * LAKE_RASTER) / 12;
    const sne = p.sne + dn * de;
    const tr = snn + see;
    const det = snn * see - sne * sne;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc;
    const l2 = Math.max(1, tr / 2 - disc);
    const radiusA = Math.max(150, 2 * Math.sqrt(l1));
    const radiusB = Math.max(120, 2 * Math.sqrt(l2));
    out.push({
      north: p.centreNorth,
      east: p.centreEast,
      radiusA,
      radiusB,
      rotation: 0.5 * Math.atan2(2 * sne, snn - see),
      depth: Math.min(40, Math.max(4, (p.level - p.bottom) * 0.6)),
      level: p.level,
      bound: Math.max(radiusA, radiusB) * LAKE_ZONE * 1.35,
    });
  }
  return out;
}

/** A line's arrays as a stage of the levels leaves them (levelProbe): the ground sampled for the level on the axis. */
export interface LevelStage {
  north: ArrayLike<number>;
  east: ArrayLike<number>;
  s: ArrayLike<number>;
  level: Float64Array;
  ground?: Float64Array;
  wet?: Uint8Array;
  lake?: Float64Array;
}
/**
 * Probes only (scripts/probes/rz*.test.ts): hears each line's level after each stage that sets it, live arrays (copy
 * what is kept). On the valley axis: A the running minimum of the ground, B the confluence cuts, C0 the parent's level
 * at the mouth (or the sea's), C the gradient cap, D the other valleys' carve, E destair; on the channel: chan the
 * meandering channel, shape the falls (falls.ts shapeLines), pitch the pitches and pools.
 */
export const levelProbe: { on?: (stage: string, li: number, line: LevelStage) => void } = {};
/** Probes: each river's law along its axis as it is laid (channelForm.ts), and its channel's samples. */
export const formProbe: { on?: (li: number, axis: { north: Float64Array; east: Float64Array; s: Float64Array; area: Float64Array; level: Float64Array; S: Float64Array; roomL: Float64Array; roomR: Float64Array; rL: Float64Array; rR: Float64Array; Wa: Float64Array; lam2: Float64Array; om2: Float64Array; lam1: Float64Array; om1: Float64Array }) => void } = {};
/** How far beyond its floodplain a river's valley is carved into the ground about it (carveNetwork), m, for a catchment
 * of `area` km². */
export const valleyInfluence = (area: number): number => 500 + 1900 * smooth(30, 2000, area);
/** Build a seeded world's hydrology from its drainage and lakes. */
export function buildNetworkHydrology(natural: (north: number, east: number) => number, d: Drainage, mask: LakeMask, valleyDepth?: Float32Array, smoothGround: (north: number, east: number) => number = natural, markFloor?: (axes: Array<{ north: Float64Array; east: Float64Array; half: Float64Array; area: Float64Array }>) => void, pinned?: (north: number, east: number) => number, wallWeight?: (north: number, east: number) => number): Hydrology {
  const lines = d.lines;
  void valleyDepth;
  // --- Courses: each line's is the model's own (erosion.ts channelCourse, over the drainage's tree), the course the
  // model carved its valley along. A tributary's last cell is its junction cell, on its parent's course; its course runs
  // on along that cell's piece to the middle of the leg to the cell's receiver (`ext`), where it meets its parent's
  // B-spline, as the model's carve of it does.
  const model = channelCourse(d.n, d.origin, d.receiver, d.area);
  const courses: Array<{ n: number[]; e: number[]; ext?: [number, number] }> = [];
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li];
    const n = L.cells.map((c) => model.pn[c]);
    const e = L.cells.map((c) => model.pe[c]);
    const r = d.receiver[L.cells[L.cells.length - 1]];
    clearOfRunway(n, e);
    courses.push({ n, e, ext: L.joins >= 0 && r >= 0 ? [model.pn[r], model.pe[r]] : undefined });
  }

  // --- Valley axes: densified courses with catchment, level, width, meander belt, floodplain.
  const axes: Axis[] = [];
  // First each line's own course and water level (the running minimum of the ground), then the confluences, then
  // the rest of each valley from its final level.
  // The ponds a line has run through at their level (main stems first): no later line drains them.
  const held = new Uint8Array(d.lakes.length);
  const pre: Array<{ north: Float64Array; east: Float64Array; s: Float64Array; area: Float64Array; level: Float64Array; wet: Uint8Array; pinned: Uint8Array; ground: Float64Array; fall: Float64Array; poolOf: Int32Array }> = [];
  const laid: Array<{ north: Float64Array; east: Float64Array; s: Float64Array; area: Float64Array; t: ArrayLike<number> }> = [];
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li];
    const c = courses[li];
    // The course's quadratic B-spline, as the model carves its valley (erosion.ts buildErosion).
    const pts = courseSpline(c.n, c.e, AXIS_SPACING, c.ext);
    // The spline can swing inside the clearance between two points that keep outside it.
    clearOfRunway(pts.n, pts.e);
    const count = pts.n.length;
    const north = Float64Array.from(pts.n);
    const east = Float64Array.from(pts.e);
    const s = new Float64Array(count);
    for (let i = 1; i < count; i++) s[i] = s[i - 1] + Math.hypot(north[i] - north[i - 1], east[i] - east[i - 1]);
    const area = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const u = pts.t[i];
      const k = Math.min(L.area.length - 2, Math.floor(u));
      area[i] = L.area[k] + (L.area[k + 1] - L.area[k]) * (u - k);
    }
    laid.push({ north, east, s, area, t: pts.t });
  }
  // The ground each river runs on is its own: the relief finer than the lattice gives way across its floor (erosion.ts
  // markCourse), as it does on the model's channel floors. The axes lie on those floors' courses; the channel swings
  // across its belt about the axis and the floodplain reaches past the model's FLOOR_HALF, and there the noise's own
  // relief (tens of metres on a plain the model lowered by a couple of hundred) stood on a valley floor graded to a few
  // tens of metres: its troughs reached the sea's level inland (held there by the cushion), the running minimum below
  // took the river down to them, and it was carved to the sea's level through every rise downstream. (Where a river
  // leaves the model's channel - through the drainage's cuts and its lakes - the mark is all there is.) Then the
  // ground about them is made before their levels are read off it (heightfield.ts: the threshold hillslopes, graded up
  // from the model's floors).
  markFloor?.(laid.map((a, li) => ({ north: a.north, east: a.east, half: floorHalf(d, lines[li], a.area, a.t), area: a.area })));
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li];
    const { north, east, s, area } = laid[li];
    const count = north.length;
    // Water level: the running minimum of the natural terrain downstream, level across lakes, meeting the parent.
    // The ground is sampled at every other point (the lowest of the centre and 80 m either side across the valley);
    // the points between take the lower of their neighbours.
    const ground = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      if (i % 2 === 1 && i < count - 1) continue;
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(count - 1, i + 1);
      const tl = Math.hypot(north[i1] - north[i0], east[i1] - east[i0]) || 1;
      const qn = (-(east[i1] - east[i0]) / tl) * 80;
      const qe = ((north[i1] - north[i0]) / tl) * 80;
      // A sample in a lake counts as a bank over its water (by a lake's outlet the side samples fall in the lake: the
      // river leaving it runs on at its level, not dropped below it).
      const at = (pn: number, pe: number): number => Math.max(natural(pn, pe), mask.at(pn, pe) + 2.5);
      ground[i] = Math.min(at(north[i], east[i]), at(north[i] + qn, east[i] + qe), at(north[i] - qn, east[i] - qe));
    }
    for (let i = 1; i < count - 1; i += 2) ground[i] = Math.min(ground[i - 1], ground[i + 1]);
    const level = new Float64Array(count);
    const wet = new Uint8Array(count);
    // The reaches held at a lake's level past its outlet or before its inlet.
    const pinned = new Uint8Array(count);
    let run = Infinity;
    // The lake at each point (-Infinity: none), and the next one downstream: its level and where the river reaches it.
    const lakeAt = new Float64Array(count);
    const pondAt = new Int32Array(count);
    // The pool (LakeMask.pools) at each point: the pools a river runs through need no outlet stream (streams.ts).
    const poolOf = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      lakeAt[i] = mask.at(north[i], east[i]);
      pondAt[i] = mask.pond;
      poolOf[i] = mask.poolHit;
    }
    const next = new Float64Array(count).fill(-Infinity);
    const nextAt = new Float64Array(count);
    const findNext = (): void => {
      next.fill(-Infinity);
      for (let i = count - 2; i >= 0; i--) {
        if (lakeAt[i + 1] > -Infinity) (next[i] = lakeAt[i + 1]), (nextAt[i] = s[i + 1]);
        else (next[i] = next[i + 1]), (nextAt[i] = nextAt[i + 1]);
      }
    };
    findNext();
    // The last lake the river ran through: its level and where the river left it.
    let left = -Infinity;
    let leftAt = 0;
    for (let i = 0; i < count; i++) {
      // A lake the river reaches well below its level (a pond whose level the lattice set, under which the raster
      // flood of a pond upstream let the river down) is drained: the river runs on through its dry basin. Not one an
      // earlier line (a main stem, before its tributaries) has already run through at its level.
      if (lakeAt[i] > run + DRAIN_MARGIN && pondAt[i] >= 0 && !held[pondAt[i]]) {
        const k = pondAt[i];
        mask.drainPond(k);
        for (let j = i; j < count; j++) if (pondAt[j] === k) lakeAt[j] = -Infinity;
        findNext();
      }
      const lake = lakeAt[i];
      if (lake > -Infinity) {
        held[pondAt[i]] = 1;
        run = lake;
        wet[i] = 1;
        left = lake;
        leftAt = s[i];
      } else {
        // Past a lake's outlet the river runs on at its level while the banks stand over it (a few decimetres), only
        // dropping its usual depth under them over the next OUTLET_RUN m: no step down from the lake to the river.
        // Likewise into a lake: a river reaching one comes in at its level, not under it.
        const out = left > -Infinity ? 1 - smooth(OUTLET_RUN * 0.5, OUTLET_RUN, s[i] - leftAt) : 0;
        const inn = next[i] > -Infinity ? 1 - smooth(OUTLET_RUN * 0.5, OUTLET_RUN, nextAt[i] - s[i]) : 0;
        if (out > 0 || inn > 0) pinned[i] = 1;
        let cand = ground[i] - 2.5;
        if (out > 0) cand = Math.max(cand, Math.min(left, ground[i] - 0.3) * out + (ground[i] - 2.5) * (1 - out));
        if (inn > 0) cand = Math.max(cand, Math.min(next[i], ground[i] - 0.3) * inn + (ground[i] - 2.5) * (1 - inn));
        run = i === 0 ? cand : Math.min(run - 0.00025 * (s[i] - s[i - 1]), cand);
      }
      level[i] = Math.max(0, run);
    }
    // The ground's own fall along the course (smoothed over about a kilometre, so a gully or a bump between samples
    // does not count): the gradient cap below lets the water fall as steeply as the ground does.
    const fall = Float64Array.from(ground);
    smoothAlong(fall, Math.ceil(500 / AXIS_SPACING), 2);
    pre.push({ north, east, s, area, level, wet, pinned, ground, fall, poolOf });
    levelProbe.on?.('A', li, { north, east, s, level, ground, wet, lake: lakeAt });
  }
  // --- Confluences. A tributary that arrives lower than the river it joins has cut down through a rim (it drains a
  // closed basin the routing filled: a big hollow is not a lake, drainage.ts): the river it joins cuts down with it
  // below the confluence - a gorge - rather than the tributary being held up at the rim, hundreds of metres over its
  // own valley floor. Tributaries first (they come after the lines they join), so a cut carries on down the network.
  for (let li = lines.length - 1; li >= 0; li--) {
    const L = lines[li];
    if (L.joins < 0) continue;
    const c = pre[li];
    const p = pre[L.joins];
    const mouth = c.level[c.level.length - 1];
    // A lake below the confluence holds its own level: the cut ends at its shore.
    for (let i = nearestIndex(p, c.north[c.north.length - 1], c.east[c.east.length - 1]); i < p.level.length && !p.wet[i]; i++) p.level[i] = Math.min(p.level[i], mouth);
  }
  if (levelProbe.on) for (let li = 0; li < lines.length; li++) levelProbe.on('B', li, pre[li]);
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li];
    const { north, east, s, area, level, wet } = pre[li];
    const count = north.length;
    if (L.joins >= 0) {
      const p = axes[L.joins];
      const at = p.s[nearestIndex(p, north[count - 1], east[count - 1])];
      const lj = sampleAt(p.s, p.level, at);
      for (let i = 0; i < count; i++) level[i] = Math.max(level[i], lj);
      level[count - 1] = lj;
    } else if (d.height[L.cells[L.cells.length - 1]] <= 0 && !wet[count - 1]) {
      // A river reaching the sea ends at the sea's level (its mouth's ground can stand a few metres over it where the
      // shore lies a little seaward of the outlet cell).
      level[count - 1] = 0;
    }
    levelProbe.on?.('C0', li, pre[li]);
    capFall(pre[li]);
    levelProbe.on?.('C', li, pre[li]);
    const halfWidth = new Float64Array(count);
    // The valley's own swing for its walls (wallStart): a few hundredths of a meander length. (The law's thread is laid
    // in the room the floor this carves gives it, channelForm.ts: not wider.)
    const belt = new Float64Array(count);
    const wavelength = new Float64Array(count);
    const floodplain = new Float64Array(count);
    const influence = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const hw = halfWidthFor(area[i]);
      halfWidth[i] = hw;
      // Meanders: big rivers on gentle ground swing wide; none in the last stretch of a tributary (it meets its parent).
      const j0 = Math.max(0, i - 8);
      const j1 = Math.min(count - 1, i + 8);
      const grad = (level[j0] - level[j1]) / Math.max(1, s[j1] - s[j0]);
      const lowland = 1 - smooth(MEANDER_GRADIENT * 0.5, MEANDER_GRADIENT, grad);
      const big = smooth(MEANDER_AREA * 0.6, MEANDER_AREA * 1.6, area[i]);
      const tail = L.joins >= 0 ? smooth(0, 2500, s[count - 1] - s[i]) : 1;
      // None across a lake (its water hides the course; the loops would only cost time).
      const mFree = (1 - wet[i]) * lowland * big * tail * clampUnit(0.8 + 0.4 * gnoise(s[i] / 5200 + li * 7.31, 2.7 + li));
      // Meander wavelength about 18 channel widths (the long end of Leopold & Wolman's range: broad loops, as seed 0's
      // river has), varied along the river.
      wavelength[i] = Math.max(160, 36 * hw) * (0.85 + 0.3 * gnoise(s[i] / 3000 + li * 3.3, 9.1));
      belt[i] = 0.06 * wavelength[i];
      // The floodplain keeps the width the free meanders would need, so it does not pinch where they are held in.
      const freeBelt = wavelength[i] * (0.06 + 0.55 * mFree);
      floodplain[i] = freeBelt + hw + CHANNEL_BANK + 4 * hw * Math.min(1, freeBelt / 200);
      influence[i] = valleyInfluence(area[i]);
    }
    // The floodplain's width changes only gradually along the river: inside a bend the nearest axis point jumps from
    // one stretch to another, and two different widths there would leave a step in the valley wall.
    smoothAlong(floodplain, Math.ceil(1500 / AXIS_SPACING), 3);
    for (let i = 0; i < count; i++) belt[i] = Math.max(0, Math.min(belt[i], floodplain[i] - halfWidth[i] - CHANNEL_BANK));
    axes.push({ north, east, s, area, level, halfWidth, belt, wavelength, floodplain, influence, ground: pre[li].ground, gapR: new Float64Array(count), gapL: new Float64Array(count) });
  }

  // --- Water under the other valleys' carving. Each line's level came from the natural ground along it, but the
  // terrain cuts every valley near a point into it (heightfield.ts carveNetwork): where a tributary comes down the
  // side of its parent's valley (wide, its walls a parabola about the parent's axis), the parent's carve takes the
  // ground tens of metres below the tributary's water, and the stream would hang over its bed. The level is taken down
  // to the carved ground (carveNetwork's valley cut of every other line at the axis point, on the natural ground
  // sampled for the level), parents first (their own level moves their carve), then kept falling downstream, put back
  // on the parent at the confluence and given the gradient cap again.
  const valleyReach = axes.map((a) => {
    const m = a.north.length;
    const own = new Float64Array(m);
    for (let i = 0; i < m; i++) own[i] = a.floodplain[i] + a.influence[i];
    const out = new Float64Array(m);
    const W = Math.ceil(4000 / AXIS_SPACING);
    // Sliding-window maximum (monotone deque) over +-W samples.
    const dq: number[] = [];
    for (let i = 0, j = 0; i < m; i++) {
      for (; j < m && j <= i + W; j++) {
        while (dq.length && own[dq[dq.length - 1]] <= own[j]) dq.pop();
        dq.push(j);
      }
      while (dq[0] < i - W) dq.shift();
      out[i] = own[dq[0]];
    }
    return out;
  });
  const valleyIndex = new SegmentIndex(axes, (li, i) => Math.max(valleyReach[li][i], valleyReach[li][i + 1]), VALLEY_CELL);
  // The terrain's valleys blend each line's stretches about a switch of its nearest point (SegmentIndex.perLineBlend),
  // their segments listed VALLEY_BAND_MAX further out (the levels above were read with the nearest alone, as before).
  const valleyBlend = new SegmentIndex(axes, (li, i) => Math.max(valleyReach[li][i], valleyReach[li][i + 1]) + VALLEY_BAND_MAX, VALLEY_CELL);
  /** A line's valley at a point (valleyBlend's segments for it), into o. */
  const blendValley = (li: number, dist: number, n: number, o: ValleyNear): void => {
    const a = axes[li];
    const B = valleyBlend;
    let lv = 0, fp = 0, inf = 0, gp = 0, sw = 0, s = 0, top = -1;
    for (let q = 0; q < n; q++) {
      const i = B.bSeg[q];
      const t = B.bT[q];
      const w = B.bW[q];
      lv += w * (a.level[i] + (a.level[i + 1] - a.level[i]) * t);
      fp += w * (a.floodplain[i] + (a.floodplain[i + 1] - a.floodplain[i]) * t);
      inf += w * (a.influence[i] + (a.influence[i + 1] - a.influence[i]) * t);
      gp += w * gapAt(a, i, t, B.bSide[q]);
      sw += w * (a.belt[i] + a.halfWidth[i] + (a.belt[i + 1] + a.halfWidth[i + 1] - a.belt[i] - a.halfWidth[i]) * t);
      if (w > top) {
        top = w;
        s = a.s[i] + (a.s[i + 1] - a.s[i]) * t;
      }
    }
    o.dist = dist;
    o.level = lv;
    o.floodplain = fp;
    o.influence = inf;
    o.gap = gp;
    o.swing = sw;
    o.line = li;
    o.s = s;
  };
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li];
    const P = pre[li];
    const { north, east, s, level, wet, pinned, ground } = P;
    const count = north.length;
    let moved = false;
    for (let i = 0; i < count; i += 2) {
      if (wet[i] || pinned[i]) continue;
      let h = ground[i];
      valleyIndex.perLine(north[i], east[i], (lj, k, t, d) => {
        if (lj === li) return false;
        const a = axes[lj];
        const f = a.floodplain[k] + (a.floodplain[k + 1] - a.floodplain[k]) * t;
        const I = a.influence[k] + (a.influence[k + 1] - a.influence[k]) * t;
        if (d >= f + I) return false;
        const lv = a.level[k] + (a.level[k + 1] - a.level[k]) * t;
        const excess = Math.max(0, h - lv - valleyWall(f + I, f));
        const u = Math.min(1, Math.max(0, (d - f) / I));
        const carved = sminN(h, lv + valleyWall(d, f) + excess * u * u, 4);
        h += (carved - h) * (1 - smooth(f + I * 0.75, f + I, d));
        return false;
      });
      const lim = h - 2.5;
      for (const j of i + 1 < count - 1 ? [i, i + 1] : [i]) {
        if (!wet[j] && !pinned[j] && lim < level[j]) {
          level[j] = Math.max(0, lim);
          moved = true;
        }
      }
      if (i + 2 >= count && i !== count - 1) i = count - 3;
    }
    if (!moved && L.joins < 0) continue;
    // Falling downstream, through lakes at their level.
    for (let i = 1; i < count; i++) if (!wet[i]) level[i] = Math.max(0, Math.min(level[i], level[i - 1]));
    if (L.joins >= 0) {
      const p = axes[L.joins];
      const at = p.s[nearestIndex(p, north[count - 1], east[count - 1])];
      const lj = sampleAt(p.s, p.level, at);
      for (let i = 0; i < count; i++) level[i] = Math.max(level[i], lj);
      level[count - 1] = lj;
    }
    if (moved || L.joins >= 0) capFall(P);
    levelProbe.on?.('D', li, P);
    void s;
  }
  for (let li = 0; li < lines.length; li++) {
    destair(pre[li]);
    levelProbe.on?.('E', li, pre[li]);
  }
  // The walls' gaps (wallLift): on each side, how far the ground where the wall starts (past the floodplain and the
  // channel's swing, wallStart) stands over the valley's floor, where the threshold hillslopes' walls stand about it;
  // every other sample, the ones between interpolated.
  if (wallWeight) {
    for (const a of axes) {
      const m = a.north.length;
      for (let i = 0; i < m; i++) {
        if (i % 2 === 1 && i < m - 1) continue;
        if (!(wallWeight(a.north[i], a.east[i]) > 0)) continue;
        const i0 = Math.max(0, i - 1);
        const i1 = Math.min(m - 1, i + 1);
        const tl = Math.hypot(a.north[i1] - a.north[i0], a.east[i1] - a.east[i0]) || 1;
        const de = Math.max(a.floodplain[i], a.belt[i] + a.halfWidth[i] + SWING_KEEP);
        const qn = (-(a.east[i1] - a.east[i0]) / tl) * de;
        const qe = ((a.north[i1] - a.north[i0]) / tl) * de;
        const floor = a.level[i] + FLOOR_OVER;
        a.gapR[i] = Math.max(0, natural(a.north[i] + qn, a.east[i] + qe) - floor);
        a.gapL[i] = Math.max(0, natural(a.north[i] - qn, a.east[i] - qe) - floor);
      }
      for (let i = 1; i < m - 1; i += 2) {
        a.gapR[i] = 0.5 * (a.gapR[i - 1] + a.gapR[i + 1]);
        a.gapL[i] = 0.5 * (a.gapL[i - 1] + a.gapL[i + 1]);
      }
    }
  }
  /**
   * The highest water a channel point at (pn, pe) may hold given the valleys' carve there (carveNetwork's valley cut
   * of every line, on the natural ground): 1.3 m under the carved ground, as a valley's water lies under its floor.
   * The natural ground is sampled only where a valley's floor or wall at the point could lie under `level` + 1.3.
   */
  const carvedUnder = (pn: number, pe: number, level: number): number => {
    let low = Infinity;
    valleyIndex.perLine(pn, pe, (lj, k, t, d) => {
      const v = axes[lj];
      const f = v.floodplain[k] + (v.floodplain[k + 1] - v.floodplain[k]) * t;
      const I = v.influence[k] + (v.influence[k + 1] - v.influence[k]) * t;
      if (d < f + I) low = Math.min(low, v.level[k] + (v.level[k + 1] - v.level[k]) * t + valleyWall(d, f));
      return false;
    });
    if (low - 1.3 >= level) return Infinity;
    return valleyGround(pn, pe) - 1.3;
  };
  /** The ground at (pn, pe) as the valleys carve it: their floors and walls cut into the ground, m. */
  const valleyGround = (pn: number, pe: number): number => {
    let h = natural(pn, pe);
    valleyIndex.perLine(pn, pe, (lj, k, t, d) => {
      const v = axes[lj];
      const f = v.floodplain[k] + (v.floodplain[k + 1] - v.floodplain[k]) * t;
      const I = v.influence[k] + (v.influence[k + 1] - v.influence[k]) * t;
      if (d >= f + I) return false;
      const lv = v.level[k] + (v.level[k + 1] - v.level[k]) * t;
      const excess = Math.max(0, h - lv - valleyWall(f + I, f));
      const u = Math.min(1, Math.max(0, (d - f) / I));
      const carved = sminN(h, lv + valleyWall(d, f) + excess * u * u, 4);
      h += (carved - h) * (1 - smooth(f + I * 0.75, f + I, d));
      return false;
    });
    return h;
  };

  // The ground the streams run down: the terrain's, with the rivers' valleys cut in (as carveNetwork cuts them); they
  // are routed over it without its small-scale relief.
  const routeValley: ValleyNear = { dist: 0, level: 0, floodplain: 0, influence: 0, gap: 0, swing: 0 };
  const carvedGround = (h: number, pn: number, pe: number): number => {
    let w = -1;
    // (Each line's nearest stretch, as the levels were read: the terrain's blend about a switch moves the ground by a
    // few metres at most, and the streams traced on it would wander off into other courses for it.)
    valleyIndex.perLine(pn, pe, (lj, k, t, dd, side) => {
      const v = routeValley;
      const a = axes[lj];
      v.floodplain = a.floodplain[k] + (a.floodplain[k + 1] - a.floodplain[k]) * t;
      v.influence = a.influence[k] + (a.influence[k + 1] - a.influence[k]) * t;
      v.level = a.level[k] + (a.level[k + 1] - a.level[k]) * t;
      v.gap = gapAt(a, k, t, side);
      v.swing = a.belt[k] + a.halfWidth[k] + (a.belt[k + 1] + a.halfWidth[k + 1] - a.belt[k] - a.halfWidth[k]) * t;
      const f = v.floodplain;
      const I = v.influence;
      if (dd >= f + I) return false;
      const lv = v.level;
      const excess = Math.max(0, h - lv - valleyWall(f + I, f));
      const u = Math.min(1, Math.max(0, (dd - f) / I));
      let target = lv + valleyWall(dd, f) + excess * u * u;
      // (As the terrain carves it: the threshold hillslopes' walls only lowered, wallLift.)
      if (wallWeight && dd > f) {
        if (w < 0) w = wallWeight(pn, pe);
        target = wallLift(target, h, (dd - f) / I, I, v.gap, w, wallStart(f, I, v.swing));
      }
      const carved = sminN(h, target, 4);
      h += (carved - h) * (1 - smooth(f + I * 0.75, f + I, dd));
      return false;
    });
    return h;
  };
  // --- The channel-form law (channelForm.ts): each river's room on its floor, read across its axis on the ground its
  // valleys carve (the floor's edge: where that ground first stands its bank and a metre over the floodplain's own
  // height above the water, or falls under the water), and the law's widths, swings and wavelengths from its reach
  // state (catchment, gradient, room) at every axis sample.
  const floorGround = (pn: number, pe: number): number => carvedGround(smoothGround(pn, pe), pn, pe);
  /**
   * The room one side of a channel at (pn, pe), across (nn, ne): how far out the floor reaches, m - to where the ground
   * as the valleys carve it first stands over `top` or falls under `bottom` (another valley), or comes into the home
   * runway's clear zone (no channel swings into it: RUNWAY_CLEAR). Out along ROOM_LADDER, then bisected. Every line's
   * room, river or stream, is read so (DESIGN.md section 1).
   */
  const roomAcross = (pn: number, pe: number, nn: number, ne: number, top: number, bottom: number): number => {
    const out = (d: number): boolean => {
      const qn = pn + nn * d;
      const qe = pe + ne * d;
      if (runwayDistance(qn, qe) < RUNWAY_CLEAR) return true;
      const g = floorGround(qn, qe);
      return g > top || g < bottom;
    };
    let prev = 0;
    for (const d of ROOM_LADDER) {
      if (out(d)) {
        let l0 = prev;
        let l1 = d;
        for (let k = 0; k < 3; k++) {
          const mid = 0.5 * (l0 + l1);
          if (out(mid)) l1 = mid;
          else l0 = mid;
        }
        return 0.5 * (l0 + l1);
      }
      prev = d;
    }
    return prev;
  };
  const roomOfAxis = (li: number): { roomL: Float64Array; roomR: Float64Array; S: Float64Array; swingL: Float64Array; swingR: Float64Array } => {
    const a = axes[li];
    const P = pre[li];
    const m = a.north.length;
    const roomL = new Float64Array(m);
    const roomR = new Float64Array(m);
    const S = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const Ws = formWs(a.area[i]);
      const half = Math.max(100, 10 * Ws);
      const lo = sampleAt(a.s, a.level, Math.max(0, a.s[i] - half));
      const hi = sampleAt(a.s, a.level, Math.min(a.s[m - 1], a.s[i] + half));
      const run = Math.min(a.s[m - 1], a.s[i] + half) - Math.max(0, a.s[i] - half);
      S[i] = run > 1 ? Math.max(0, (lo - hi) / run) : 0;
    }
    // The floor read at stations along the axis (none in a lake: the water there is the lake's).
    roomL.fill(NaN);
    roomR.fill(NaN);
    const station = (i: number): void => {
      if (P.wet[i]) return;
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(m - 1, i + 1);
      const tn = a.north[i1] - a.north[i0];
      const te = a.east[i1] - a.east[i0];
      const tl = Math.hypot(tn, te) || 1;
      const nn = -te / tl;
      const ne = tn / tl;
      const lv = a.level[i];
      const top = lv + FLOOR_OVER + formOf(a.area[i], S[i], 0).bankH + 1;
      const bottom = lv + 0.5;
      roomR[i] = roomAcross(a.north[i], a.east[i], nn, ne, top, bottom);
      roomL[i] = roomAcross(a.north[i], a.east[i], -nn, -ne, top, bottom);
    };
    for (let i = 0; i < m; i += ROOM_EVERY) station(i);
    if ((m - 1) % ROOM_EVERY !== 0) station(m - 1);
    const isStation = (i: number): boolean => i % ROOM_EVERY === 0 || i === m - 1;
    /** Between the stations the lower of the two, then smoothed along (over about a kilometre). */
    const spread = (r: Float64Array): void => {
      let last = 0;
      for (let i = 1; i < m; i++) {
        if (isStation(i)) {
          for (let j = last + 1; j < i; j++) r[j] = Math.min(r[last], r[i]);
          last = i;
        }
      }
      smoothAlong(r, Math.ceil(500 / AXIS_SPACING), 2);
    };
    // The thread swings in the floor as read (none in a lake, easing in and out); the bed's width is capped by the floor
    // as read inland: a station in a lake or at the sea (whose ground beside is the lake's bed or the shore) takes the
    // floor of the nearest station that reads one, so a river keeps its width through a lake and to its mouth.
    const swingL = Float64Array.from(roomL, (v) => (Number.isFinite(v) ? v : 0));
    const swingR = Float64Array.from(roomR, (v) => (Number.isFinite(v) ? v : 0));
    spread(swingL);
    spread(swingR);
    for (let i = 0; i < m; i++) {
      if (!(a.level[i] < 1)) continue;
      roomL[i] = NaN;
      roomR[i] = NaN;
    }
    for (const r of [roomL, roomR]) {
      let prevAt = -1;
      const nearest = new Int32Array(m).fill(-1);
      for (let i = 0; i < m; i++) if (isStation(i) && Number.isFinite(r[i])) prevAt = i;
      else if (isStation(i)) nearest[i] = prevAt;
      let nextAt = -1;
      for (let i = m - 1; i >= 0; i--) {
        if (!isStation(i)) continue;
        if (Number.isFinite(r[i])) {
          nextAt = i;
          continue;
        }
        const b = nearest[i];
        const pick = b < 0 ? nextAt : nextAt < 0 ? b : i - b <= nextAt - i ? b : nextAt;
        r[i] = pick >= 0 ? r[pick] : 0.5 * FLOOR_MIN;
      }
      for (let i = 0; i < m; i++) if (isStation(i) && !Number.isFinite(r[i])) r[i] = 0.5 * FLOOR_MIN;
      spread(r);
    }
    return { roomL, roomR, S, swingL, swingR };
  };
  /** Each river's room (floor) per axis sample, and per channel sample (filled as the channels are laid). */
  const roomAx: Array<{ roomL: Float64Array; roomR: Float64Array; S: Float64Array; swingL: Float64Array; swingR: Float64Array }> = [];
  const formCh: Array<{ s: Float64Array; kap: Float32Array; roomL: Float32Array; roomR: Float32Array }> = [];
  const lawAx: Array<{ Wa: Float64Array; lam2: Float64Array }> = [];
  /** Where the law's time goes (probes): the room transects, laying the threads, the rest of the channel loop. */
  const formMs = { room: 0, lay: 0, chan: 0, form: 0 };
  const layRiver = (li: number): { north: number[]; east: number[]; valleyS: number[]; off: number[] } => {
    const a = axes[li];
    const m = a.north.length;
    const tR0 = performance.now();
    const R = roomOfAxis(li);
    formMs.room += performance.now() - tR0;
    roomAx[li] = R;
    const lam1 = new Float64Array(m);
    const om1 = new Float64Array(m);
    const lam2 = new Float64Array(m);
    const om2 = new Float64Array(m);
    const Wa = new Float64Array(m);
    const rL = new Float64Array(m);
    const rR = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const F = Math.max(FLOOR_MIN, R.roomL[i] + R.roomR[i]);
      const f = formOf(a.area[i], R.S[i], F);
      const w = f.phi * f.Wa;
      // The thread's centre keeps its water on the floor (the runway's clear zone is not floor: roomAcross).
      rL[i] = Math.max(0, Math.min(R.swingL[i], R.roomL[i]) - 0.5 * w);
      rR[i] = Math.max(0, Math.min(R.swingR[i], R.roomR[i]) - 0.5 * w);
      Wa[i] = f.Wa;
      lam1[i] = f.lam1;
      lam2[i] = Math.max(LAMBDA_MIN, f.lam2);
      // The room filled from the smallest scale up: the thread keeps its swing (to 0.8 of the room), the belt the rest.
      const room = 0.5 * (rL[i] + rR[i]);
      const a2 = Math.min(sineAmplitude(lam2[i], f.om2), 0.8 * room);
      om2[i] = fitSwing(lam2[i], f.om2, a2);
      om1[i] = fitSwing(f.lam1, f.om1, Math.max(0, 0.8 * room - a2));
    }
    // (The valley's own bends: no offset on the inside of one deeper than half its radius, or the curve would fold.)
    for (let i = 1; i < m - 1; i++) {
      const tn0 = a.north[i] - a.north[i - 1];
      const te0 = a.east[i] - a.east[i - 1];
      const tn1 = a.north[i + 1] - a.north[i];
      const te1 = a.east[i + 1] - a.east[i];
      const turn = Math.atan2(tn0 * te1 - te0 * tn1, tn0 * tn1 + te0 * te1);
      const k = Math.abs(turn) / Math.max(1, 0.5 * (a.s[i + 1] - a.s[i - 1]));
      if (k < 1e-6) continue;
      if (turn > 0) rR[i] = Math.min(rR[i], 0.5 / k);
      else rL[i] = Math.min(rL[i], 0.5 / k);
    }
    lawAx[li] = { Wa, lam2 };
    formProbe.on?.(li, { north: a.north, east: a.east, s: a.s, area: a.area, level: a.level, S: R.S, roomL: R.roomL, roomR: R.roomR, rL, rR, Wa, lam2, om2, lam1, om1 });
    const tL0 = performance.now();
    const laid = layThread(a.north, a.east, { lam1, om1, lam2, om2, Wa, roomL: rL, roomR: rR }, li + 1);
    formMs.lay += performance.now() - tL0;
    return laid;
  };

  // --- Channels: the law's thread about the axis (channelForm.ts), some loops cut off as oxbows; a tributary's end on its parent's channel.
  const rivers: Array<RiverLine & { valleyS: Float64Array }> = [];
  const oxbows: Array<{ north: Float64Array; east: Float64Array; level: number; halfWidth: number; depth: number }> = [];
  const tChan0 = performance.now();
  for (let li = 0; li < lines.length; li++) {
    const a = axes[li];
    const total = a.s[a.s.length - 1];
    const ch = layRiver(li);
    for (const o of cutOffLoops(ch, a, li, lawAx[li].Wa)) {
      oxbows.push({
        north: o.north,
        east: o.east,
        level: sampleAt(a.s, a.level, o.valleyS) + OXBOW_LEVEL,
        halfWidth: o.halfWidth * 0.85,
        // Cut off long ago (age near 0): more silted up, as hydrology.ts's oxbows.
        depth: 0.8 + 2.2 * o.age,
      });
    }
    const north = ch.north;
    const east = ch.east;
    const valleyS = ch.valleyS;
    let steps = north.length - 1;
    const L = lines[li];
    if (L.joins >= 0) {
      // Pull the last stretch onto the parent's channel at the confluence.
      const p = rivers[L.joins];
      const j = nearestOnChannel(p, north[steps], east[steps]);
      const dn = p.north[j] - north[steps];
      const de = p.east[j] - east[steps];
      // Over a stretch three times the gap (the parent's loop may swing a few hundred metres from its axis), so no kink.
      const span = Math.min(total, Math.max(600, 3 * Math.hypot(dn, de)));
      for (let k = 0; k <= steps; k++) {
        const w = smooth(total - span, total, valleyS[k]);
        north[k] += dn * w;
        east[k] += de * w;
      }
    }
    // Nothing may cross itself: a curl the pull onto the parent (or a loop the cutoffs missed) folds in is cut out.
    untangle(north, east, valleyS);
    steps = north.length - 1;
    const count = steps + 1;
    const s = new Float64Array(count);
    const level = new Float64Array(count);
    const halfWidth = new Float64Array(count);
    const wetAxis = pre[li].wet;
    const pinAxis = pre[li].pinned;
    let lastCheck = -Infinity;
    for (let k = 0; k < count; k++) {
      if (k > 0) s[k] = s[k - 1] + Math.hypot(north[k] - north[k - 1], east[k] - east[k - 1]);
      let lv = sampleAt(a.s, a.level, valleyS[k]);
      // The channel swings off its axis (a meander, a bend that brings it near a lower stretch of its own valley or
      // another's wall): its water no higher than the valleys carve the ground there (every CARVE_CHECK m of arc).
      if (s[k] - lastCheck >= CARVE_CHECK && k < count - 1 && !wetAxis[segmentAt(a.s, valleyS[k])] && !pinAxis[segmentAt(a.s, valleyS[k])]) {
        lv = Math.min(lv, carvedUnder(north[k], east[k], lv));
        lastCheck = s[k];
      }
      level[k] = k === 0 ? lv : Math.min(level[k - 1], lv);
      halfWidth[k] = sampleAt(a.s, a.halfWidth, valleyS[k]);
    }
    // The thread's bends (their inside, point bars) and its room left and right on the floor at every sample.
    {
      const la = lawAx[li];
      const smoothM = new Float64Array(count);
      const peakM = new Float64Array(count);
      const roomL = new Float32Array(count);
      const roomR = new Float32Array(count);
      const RA = roomAx[li];
      for (let k = 0; k < count; k++) {
        const vs = valleyS[k];
        smoothM[k] = Math.max(12, sampleAt(a.s, la.lam2, vs) / 8);
        peakM[k] = Math.max(30, sampleAt(a.s, la.lam2, vs) / 2);
        // Its offset from the axis (right: +).
        const i = segmentAt(a.s, vs);
        const t = Math.min(1, Math.max(0, (vs - a.s[i]) / Math.max(1e-9, a.s[i + 1] - a.s[i])));
        const tn = a.north[i + 1] - a.north[i];
        const te = a.east[i + 1] - a.east[i];
        const tl = Math.hypot(tn, te) || 1;
        const off = (north[k] - a.north[i] - tn * t) * (-te / tl) + (east[k] - a.east[i] - te * t) * (tn / tl);
        roomR[k] = Math.max(0, sampleAt(a.s, RA.roomR, vs) - off);
        roomL[k] = Math.max(0, sampleAt(a.s, RA.roomL, vs) + off);
      }
      formCh[li] = { s: Float64Array.from(s), kap: bendOf(north, east, smoothM, peakM), roomL, roomR };
    }
    rivers.push({ north: Float64Array.from(north), east: Float64Array.from(east), level, halfWidth, s, valleyS: Float64Array.from(valleyS) });
    levelProbe.on?.('chan', li, rivers[li]);
  }

  formMs.chan = performance.now() - tChan0;
  const tPhase: number[] = [performance.now()];
  /** Whether each river's head lies in a lake (its bed's stones are its own, bedGrain). */
  const P0wet = pre.map((P) => P.wet[0] === 1);
  const faults = buildFaults();
  const faultIndex = new FaultIndex(faults);
  let shapeReport: ShapeReport | undefined;
  // --- The channels' flow (streams.ts): each river's head narrows to the stream that feeds it, the steep reaches
  // become falls with pools, then the streams are traced down to the rivers and treated alike.
  const nR = rivers.length;
  const kinds: number[] = [];
  const channelArea: Float64Array[] = [];
  const lipsOf: number[][] = [];
  /** A stream's unit coordinate and where its pitches and pools are drawn (pitchPool.ts), per sample. */
  const pitchOf: Array<{ sigma: Float64Array; on: Float64Array } | undefined> = [];
  const falls: Fall[] = [];
  /** Rivers whose head is not in a lake. */
  const headDry = new Uint8Array(nR);
  /** How much of each river's head was trimmed off above its first junction, m (probes). */
  const trimmed = new Float64Array(nR);
  /** A finished line's water level at arc length sv. */
  const levelOn = (c: { s: Float64Array; level: Float64Array }, sv: number): number => sampleAt(c.s, c.level, sv);
  for (let li = 0; li < nR; li++) {
    const r = rivers[li];
    const a = axes[li];
    const P = pre[li];
    const count = r.s.length;
    const area = new Float64Array(count);
    const keep = new Uint8Array(count);
    // (The channel's valley arc length runs nearly monotonically: a pointer walks the axis with it.)
    const last = a.s.length - 1;
    let seg = 0;
    for (let k = 0; k < count; k++) {
      const sv = r.valleyS[k];
      while (seg > 0 && sv < a.s[seg]) seg--;
      while (seg < last - 1 && sv > a.s[seg + 1]) seg++;
      const t = last > 0 ? Math.min(1, Math.max(0, (sv - a.s[seg]) / Math.max(1e-9, a.s[seg + 1] - a.s[seg]))) : 0;
      area[k] = last > 0 ? a.area[seg] + (a.area[seg + 1] - a.area[seg]) * t : a.area[0];
      keep[k] = P.wet[seg] | P.wet[Math.min(seg + 1, last)];
    }
    // A river's head (not in a lake) starts as wide as the biggest stream feeding its first lattice cell, widening
    // to its own width over HEAD_TAPER: no channel 15 m wide out of nothing.
    headDry[li] = P.wet[0] ? 0 : 1;
    if (!P.wet[0]) {
      const c0 = lines[li].cells[0];
      let feed = 0;
      for (let k = 0; k < 8; k++) {
        const ci = Math.floor(c0 / d.n) + [-1, -1, -1, 0, 0, 1, 1, 1][k];
        const cj = (c0 % d.n) + [-1, 0, 1, -1, 1, -1, 0, 1][k];
        if (ci < 0 || cj < 0 || ci >= d.n || cj >= d.n) continue;
        const q = ci * d.n + cj;
        if (d.receiver[q] === c0) feed = Math.max(feed, d.area[q]);
      }
      for (let k = 0; k < count && r.valleyS[k] < HEAD_TAPER; k++) {
        const A = feed + (area[k] - feed) * smooth(0, HEAD_TAPER, r.valleyS[k]);
        r.halfWidth[k] = Math.min(r.halfWidth[k], channelHalfWidth(A));
      }
    }
    // A tributary ends at its parent's water (the parent may have fallen below it there: a fall at the confluence).
    const L = lines[li];
    if (L.joins >= 0) {
      const p = rivers[L.joins];
      r.level[count - 1] = Math.min(r.level[count - 1], p.level[nearestOnChannel(p, r.north[count - 1], r.east[count - 1])]);
    }
    const c = { north: r.north, east: r.east, level: r.level, halfWidth: r.halfWidth, s: r.s, valleyS: r.valleyS };
    rivers[li] = c;
    channelArea[li] = area;
    kinds[li] = 0;
    lipsOf[li] = [];
  }
  // A lake a river's final course runs through well below its level (the course wanders off the samples the levels
  // were set on, or a later pass took the river down to a confluence or a valley it cuts) stands at the river's level
  // instead (its basin holds water up to there, and the river runs through it): at its own its water would stand
  // against the channel, a wall tens of metres high (seed 1: 104 m).
  const lowerTo = new Map<number, number>();
  for (const r of rivers) {
    for (let i = 0; i < r.north.length; i++) {
      const lv = mask.at(r.north[i], r.east[i]);
      if (lv > r.level[i] + DRAIN_MARGIN && mask.pond >= 0) lowerTo.set(mask.pond, Math.min(lowerTo.get(mask.pond) ?? Infinity, r.level[i]));
    }
  }
  for (const [k, lv] of [...lowerTo.entries()].sort((a, b) => a[0] - b[0])) mask.lowerPond(k, lv);
  // The pools a river runs through.
  const riverPools = new Uint8Array(mask.pools.length);
  for (const P of pre) for (let i = 0; i < P.wet.length; i++) if (P.wet[i] && P.poolOf[i] >= 0) riverPools[P.poolOf[i]] = 1;
  tPhase.push(performance.now());
  const route = (pn: number, pe: number): number => carvedGround(smoothGround(pn, pe), pn, pe);
  const netMs = { refine: 0, shape: 0, pitch: 0, flow: 0, index: 0 };
  const traced = traceStreams({ d, mask, route, rivers, riverPools, pinned });
  // A river whose head is in no lake begins where its water does: where the first stream (a feeder, streams.ts
  // feedHeads) or lattice tributary joins it, when that is within FEED_JOIN of the head - no trickle runs on above it.
  {
    const tribAt = new Float64Array(nR).fill(Infinity);
    for (let lj = 0; lj < nR; lj++) {
      const pj = lines[lj].joins;
      if (pj < 0 || pj >= nR) continue;
      const c = rivers[lj];
      const p = rivers[pj];
      tribAt[pj] = Math.min(tribAt[pj], p.s[nearestOnChannel(p, c.north[c.north.length - 1], c.east[c.east.length - 1])]);
    }
    for (let li = 0; li < nR; li++) {
      const r = rivers[li];
      const s0 = Math.min(traced.headAt[li], tribAt[li]);
      if (!(s0 > 0 && s0 <= FEED_JOIN) || mask.at(r.north[0], r.east[0]) > -Infinity) continue;
      let i0 = 0;
      while (i0 < r.s.length - 1 && r.s[i0] < s0 - 1e-6) i0++;
      if (i0 === 0 || i0 > r.s.length - 3) continue;
      const cut = r.s[i0];
      const s = r.s.slice(i0);
      for (let i = 0; i < s.length; i++) s[i] -= cut;
      rivers[li] = { north: r.north.slice(i0), east: r.east.slice(i0), level: r.level.slice(i0), halfWidth: r.halfWidth.slice(i0), s, valleyS: r.valleyS.slice(i0) };
      const fc = formCh[li];
      formCh[li] = { s: fc.s.slice(i0).map((v) => v - cut), kap: fc.kap.slice(i0), roomL: fc.roomL.slice(i0), roomR: fc.roomR.slice(i0) };
      channelArea[li] = channelArea[li].slice(i0);
      for (const st of traced.streams) if (st.joins === li) st.joinS = Math.max(0, st.joinS - cut);
      trimmed[li] = cut;
    }
    const tr = [...trimmed].filter((x) => x > 0).sort((a, b) => a - b);
    traced.report.feed = { ...(traced.report.feed ?? {}), trims: tr.length, trimKm: Math.round(tr.reduce((a, b) => a + b, 0)) / 1000, trimP50: Math.round(tr[tr.length >> 1] ?? 0), trimMax: Math.round(tr[tr.length - 1] ?? 0) };
  }
  const streamLines: Array<{ north: Float64Array; east: Float64Array; level: Float64Array; halfWidth: Float64Array; s: Float64Array; breach: Float64Array; cut: Float64Array }> = [];
  const streamJoins: number[] = [];
  const streamEnds: Array<StreamLine['end']> = [];
  // (A stream that ran on as a continuation joins a line traced after it: that one's levels as traced, then.)
  const lineOf = (li: number): { s: Float64Array; level: Float64Array } => (li < nR ? rivers[li] : streamLines[li - nR] ?? traced.streams[li - nR]);
  for (let j = 0; j < traced.streams.length; j++) {
    const st = traced.streams[j];
    const li = nR + j;
    // Its end at the water of the line it joins (final: that line came first).
    if (st.joins >= 0) st.level[st.level.length - 1] = Math.min(st.level[st.level.length - 1], levelOn(lineOf(st.joins), st.joinS));
    for (let i = 1; i < st.level.length; i++) st.level[i] = Math.min(st.level[i], st.level[i - 1]);
    // A stream not leaving a lake runs as high as the drawn ground lets it: where its water runs well under the ground
    // it was traced on (its level a straight line between the raster points, under a convex face or a spur's nose),
    // it is raised to the running minimum of the natural ground there (looked at only there), never over it and never
    // rising downstream. What cut is left is a sill it wears through, in a notch of its bed's width (below).
    // (Never over the lower of its banks, RAISE_BANK m over it at most: off a spur's nose the ground falls away either
    // side, and water raised to the nose's ground would stand over the ground beside it - a perched reach. Not dropped
    // altogether: without the raise seed 777777's 110 m step at 21500,-144000 comes back, and seed 1 has two more
    // points of water over the ground at a held mouth; out/fs/REPORT.md round S.)
    if (st.pool < 0) {
      const m = st.level.length;
      let run = Infinity;
      for (let i = 0; i < m - 1; i++) {
        let top = st.level[i];
        if (st.cut[i] > RAISE_CUT) {
          top = Math.min(st.level[i] + st.cut[i], natural(st.north[i], st.east[i]) - RAISE_DEPTH);
          if (top > st.level[i]) {
            const a = Math.max(0, i - 1);
            const b = Math.min(m - 1, i + 1);
            const tn = st.north[b] - st.north[a];
            const te = st.east[b] - st.east[a];
            const tl = Math.hypot(tn, te) || 1;
            const off = channelHalfWidth(st.area[i]) + RAISE_SIDE;
            const left = natural(st.north[i] - (te / tl) * off, st.east[i] + (tn / tl) * off);
            const right = natural(st.north[i] + (te / tl) * off, st.east[i] - (tn / tl) * off);
            top = Math.max(st.level[i], Math.min(top, Math.min(left, right) + RAISE_BANK));
          }
        }
        run = Math.min(run, top);
        if (run > st.level[i]) {
          const raise = run - st.level[i];
          st.level[i] = run;
          st.cut[i] = Math.max(0, st.cut[i] - raise);
          st.breach[i] = breachOfCut(st.cut[i]);
        }
      }
    }
    const keep = new Uint8Array(st.level.length);
    // (An outlet's first samples keep its lake's level.)
    for (let i = 0; i < st.held - 1; i++) keep[i] = 1;
    // A steep stream is a cascade whose water follows the ground down between its samples.
    const tR = performance.now();
    const f = refineSteep({ north: st.north, east: st.east, level: st.level, halfWidth: st.halfWidth, s: st.s, area: st.area, breach: st.breach, cut: st.cut }, keep, route);
    netMs.refine += performance.now() - tR;
    const c = { north: f.north, east: f.east, level: f.level, halfWidth: f.halfWidth, s: f.s, breach: f.breach, cut: f.cut };
    streamLines.push(c);
    streamJoins.push(st.joins);
    streamEnds.push(st.end);
    channelArea[li] = f.area;
    kinds[li] = 1;
    lipsOf[li] = [];
  }
  const allLines = [...rivers, ...streamLines];
  /** Whether line li is a gully chain's stream (streams.ts, gullies.ts). */
  const isChain = (li: number): boolean => li >= nR && traced.streams[li - nR].chainS >= 0;
  const joinsOf = (li: number): number => (li < nR ? lines[li].joins : streamJoins[li - nR]);
  const joinSOf = (li: number): number => {
    if (li >= nR) return traced.streams[li - nR].joinS;
    const c = allLines[li];
    const p = allLines[joinsOf(li)];
    return p.s[nearestOnChannel(p, c.north[c.north.length - 1], c.east[c.east.length - 1])];
  };
  /** The catchment each river's width is read at (a dry head's tapered: below); a stream's is its own. */
  const widthArea: Array<{ s: Float64Array; a: Float64Array } | undefined> = [];
  // --- Catchment and width down the network: never less downstream, stepping up at each confluence (the receiver
  // carries its own catchment above it plus what its lattice catchment gains within JOIN_PULL, and never less than the
  // tributary's own), tributaries before their receivers.
  {
    const nL = allLines.length;
    const depth = new Int32Array(nL);
    for (let li = 0; li < nL; li++) {
      let c = li;
      let k = 0;
      while (joinsOf(c) >= 0 && k < nL) {
        c = joinsOf(c);
        k++;
      }
      depth[li] = k;
    }
    const into: Array<Array<{ s: number; li: number }>> = allLines.map(() => []);
    for (let li = 0; li < nL; li++) if (joinsOf(li) >= 0 && joinsOf(li) < nR) into[joinsOf(li)].push({ s: joinSOf(li), li });
    const order = Array.from({ length: nR }, (_, i) => i).sort((a, b) => depth[b] - depth[a] || a - b);
    for (const li of order) {
      const A = channelArea[li];
      const c = allLines[li];
      const orig = Float64Array.from(A);
      for (let i = 1; i < A.length; i++) A[i] = Math.max(A[i], A[i - 1]);
      into[li].sort((x, y) => x.s - y.s || x.li - y.li);
      for (const t of into[li]) {
        const At = channelArea[t.li][channelArea[t.li].length - 1];
        let i0 = 0;
        while (i0 < A.length - 1 && c.s[i0] < t.s) i0++;
        const up = A[Math.max(0, i0 - 1)];
        const ahead = sampleAt(c.s, A, t.s + JOIN_PULL);
        const target = Math.max(At, Math.min(up + At, ahead));
        for (let i = i0; i < A.length; i++) A[i] = Math.max(A[i], target);
      }
      // Its width follows its catchment (the channel-form law, below); a dry head tapers from the stream feeding it (or
      // a trickle) to its width over HEAD_TAPER: the catchment its width is read at.
      void orig;
      const WA = Float64Array.from(A);
      // (Its head in no lake now: a pond drained after the river was laid out leaves a dry basin at its head too.)
      if (headDry[li] || !(mask.at(c.north[0], c.east[0]) > -Infinity)) {
        // (A tributary joining within the taper brings its own width from where it joins.)
        for (let k = 0; k < WA.length && c.s[k] < HEAD_TAPER; k++) {
          let feed = HEAD_START_AREA + (A[k] - HEAD_START_AREA) * smooth(0, HEAD_TAPER, c.s[k]);
          // (All that has joined it by there: the width steps up at each confluence.)
          let joined = 0;
          for (const t of into[li]) if (t.s <= c.s[k]) joined += channelArea[t.li][channelArea[t.li].length - 1];
          feed = Math.max(feed, Math.min(A[k], joined));
          WA[k] = Math.min(A[k], feed);
        }
      }
      widthArea[li] = { s: Float64Array.from(c.s), a: WA };
    }
  }
  // --- Falls (falls.ts), receivers first: each line's mouth on the water it joins and its last reach a cascade down to
  // it, a hanging valley's lip, an outlet's cliff, the faults it crosses.
  {
    const macro: Macro = { inland: 0, uplift: 0, foothill: 0, hilly: 0 };
    const wet = (pn: number, pe: number): boolean => mask.at(pn, pe) > -Infinity;
    const alpine = (pn: number, pe: number): boolean => macroAt(pn, pe, macro).uplift > HANG_UPLIFT;
    const inputs: ShapeInput[] = allLines.map((c, li) => ({
      // (A river's breach and cut, as a stream's: none until a fall's gorge lowers it. Its level a copy: the old one
      // measures how far the shaping lowered it.)
      a: { ...(li < nR ? { breach: new Float64Array(c.s.length), cut: new Float64Array(c.s.length) } : {}), ...(c as unknown as Record<string, Float64Array>), level: Float64Array.from(c.level), area: channelArea[li] } as unknown as LineArrays,
      kind: kinds[li],
      joins: joinsOf(li),
      joinS: joinsOf(li) >= 0 ? joinSOf(li) : 0,
      wet,
      outlet: li >= nR && traced.streams[li - nR].pool >= 0,
      // (A gully chain's stream, gullies.ts, comes down the threshold slopes' V's, graded to its receiver: no hanging
      // valley's fall, and its last reach as steep as those slopes.)
      ...(isChain(li) ? { alpine: () => false, confluence: CHAIN_CONFLUENCE } : { alpine }),
    }));
    const tS = performance.now();
    const shaped = shapeLines(inputs, faultIndex, CONFLUENCE_GRADIENT);
    netMs.shape += performance.now() - tS;
    for (let li = 0; li < allLines.length; li++) {
      // A stream lowered (a gorge below a fall, its last reach a cascade down to its mouth) runs that much deeper
      // under the ground: its breach (streams.ts) follows.
      {
        const old = allLines[li];
        const a = inputs[li].a;
        // (Both lines' arc lengths run up together: a pointer walks the old one.)
        let j = 0;
        const os = old.s;
        const last = os.length - 1;
        for (let i = 0; i < a.s.length; i++) {
          const sv = a.s[i];
          while (j < last - 1 && os[j + 1] < sv) j++;
          const t = last > 0 ? Math.min(1, Math.max(0, (sv - os[j]) / Math.max(1e-9, os[j + 1] - os[j]))) : 0;
          const lowered = (last > 0 ? old.level[j] + (old.level[j + 1] - old.level[j]) * t : old.level[0]) - a.level[i];
          if (lowered <= 0.5) continue;
          a.cut[i] += lowered;
          a.breach[i] = Math.max(a.breach[i], breachOfCut(a.cut[i]));
        }
      }
      const { area, ...rest } = inputs[li].a;
      Object.assign(allLines[li], rest);
      channelArea[li] = area;
      lipsOf[li] = shaped.lips[li];
    }
    falls.push(...shaped.falls);
    shapeReport = shaped.report;
    if (levelProbe.on) for (let li = 0; li < nR; li++) levelProbe.on('shape', li, allLines[li]);
  }
  // --- Pitches and pools along the streams' steep reaches (pitchPool.ts), receivers first: a tributary's mouth is put
  // on its receiver's reshaped water (its last reach a cascade down to it, as shapeLines puts it), then its own cut.
  const pitchReport: PitchReport = { units: 0, spacingW: [], spacingM: [], drop: [], gradient: [], deepen: [], inserted: 0, ms: 0 };
  {
    const tp = performance.now();
    const fallsOn: number[][] = allLines.map(() => []);
    falls.forEach((f, fi) => fallsOn[f.line].push(fi));
    const wet = (pn: number, pe: number): boolean => mask.at(pn, pe) > -Infinity;
    for (let li = nR; li < allLines.length; li++) {
      const c = allLines[li] as unknown as LineArrays;
      const j = joinsOf(li);
      if (j >= nR) {
        const mouth = levelOn(allLines[j], joinSOf(li));
        const m = c.level.length;
        if (mouth < c.level[m - 1]) {
          c.level[m - 1] = mouth;
          for (let i = m - 2; i >= 0; i--) {
            const cap = mouth + (isChain(li) ? CHAIN_CONFLUENCE : CONFLUENCE_GRADIENT) * (c.s[m - 1] - c.s[i]);
            if (c.level[i] <= cap) break;
            c.level[i] = cap;
          }
        }
      }
      const fs: number[] = [];
      for (const fi of fallsOn[li]) fs.push(c.s[falls[fi].index], c.s[Math.min(c.s.length - 1, falls[fi].index + 1)]);
      const r = pitchPool({ ...c, area: channelArea[li] } as LineArrays, li, fs, wet, pitchReport);
      const { area, sigma, on, ...rest } = r.a;
      Object.assign(c, rest);
      channelArea[li] = area;
      pitchOf[li] = { sigma, on };
      for (const fi of fallsOn[li]) falls[fi].index = r.map[falls[fi].index];
      lipsOf[li] = lipsOf[li].map((k) => r.map[k]);
    }
    pitchReport.ms = performance.now() - tp;
    netMs.pitch = pitchReport.ms;
    if (levelProbe.on) for (let li = 0; li < nR; li++) levelProbe.on('pitch', li, allLines[li]);
  }
  tPhase.push(performance.now());
  // --- Into standing water (AT_THE_SURFACE): where a stream runs into a lake or pond (LakeMask's domain), its water
  // there stands at the lake's surface - no channel cut, nor breach, under the lake's bed - and on the way in, where
  // its water ran under that surface (a filled hollow's stream kept the level it was traced at in the hollow's notch;
  // a tributary re-joined straight to its filler's stub), it is held up to it: the lake backs up its channel. (Seed 1
  // pond 602: line 1853 ran 12 m under the pond's surface in a trench 14 m deep through the shore, its water a wall
  // against the lake's.) Then the same backwater up any stream joining a reach so raised, under its water. Only where
  // its banks hold the lake's level (RAISE_BANK over the lower, as the raise above): a stream whose valley runs under
  // the lake's level beside it (a pond the stream pass filled on its routing ground, standing over the drawn ground the
  // stream runs in - seed 777777 line 1814, 54 m) is not raised over its banks; it keeps its level up to the water
  // (`blocked`). Not an outlet's head in its own lake, nor the rivers. Falls and pitches left on a reach now level are
  // taken off.
  const surfaceReport = { lines: 0, raised: 0, km: 0, falls: 0, blocked: 0, blockedStep: 0, passing: 0 };
  if (AT_THE_SURFACE) {
    const raisedLine = new Uint8Array(allLines.length);
    const lift = (c: LineArrays, li: number, i: number, to: number, inside: boolean): void => {
      const up = to - c.level[i];
      if (!(up > 0) && !inside) return;
      if (up > 0) c.level[i] = to;
      c.cut[i] = inside ? 0 : Math.max(0, c.cut[i] - Math.max(0, up));
      c.breach[i] = inside ? 0 : Math.min(c.breach[i], breachOfCut(c.cut[i]));
      const p = pitchOf[li];
      if (p) p.on[i] = 0;
      if (!(up > 0.01)) return;
      if (!raisedLine[li]) surfaceReport.lines++;
      raisedLine[li] = 1;
      surfaceReport.raised++;
      if (i > 0) surfaceReport.km += (c.s[i] - c.s[i - 1]) / 1000;
    };
    /** Whether sample k's banks hold water at `to`: the lower of the natural ground either side, its half-width and
     * RAISE_SIDE off its course, no more than RAISE_BANK under it (or in the lake's domain). */
    const holds = (c: LineArrays, li: number, k: number, to: number): boolean => {
      const m = c.level.length;
      const a = Math.max(0, k - 1);
      const b = Math.min(m - 1, k + 1);
      const tn = c.north[b] - c.north[a];
      const te = c.east[b] - c.east[a];
      const tl = Math.hypot(tn, te) || 1;
      const off = channelHalfWidth(channelArea[li][k]) + RAISE_SIDE;
      // (A bank in the lake's domain holds: the lake's water stands there anyway.)
      const bank = (pn: number, pe: number): number => (mask.at(pn, pe) > -Infinity ? Infinity : natural(pn, pe));
      const left = bank(c.north[k] - (te / tl) * off, c.east[k] + (tn / tl) * off);
      const right = bank(c.north[k] + (te / tl) * off, c.east[k] - (tn / tl) * off);
      return to <= Math.min(left, right) + RAISE_BANK;
    };
    /** Upstream from sample i - 1 while the water stands under `to`: held up to it, the whole reach or none of it
     * (water may not run uphill) - none where a bank on it would not hold `to`. Whether it was. */
    const backwater = (c: LineArrays, li: number, i: number, to: number): boolean => {
      let k0 = i - 1;
      while (k0 >= 0 && c.level[k0] < to) k0--;
      for (let k = i - 1; k > k0; k--) if (!holds(c, li, k, to)) {
        surfaceReport.blocked++;
        surfaceReport.blockedStep = Math.max(surfaceReport.blockedStep, to - c.level[i - 1]);
        return false;
      }
      for (let k = i - 1; k > k0; k--) lift(c, li, k, to, false);
      return true;
    };
    // (Receivers before the lines joining them - a stream's continuation before the stream it continues - so a mouth on
    // a reach the pass raised finds it raised: in index order seed 777777 line 474 ran 8.4 m up into its continuation
    // 2267's raised head.)
    const order: number[] = [];
    {
      const seen = new Uint8Array(allLines.length);
      const chain: number[] = [];
      for (let l0 = nR; l0 < allLines.length; l0++) {
        chain.length = 0;
        for (let l = l0; l >= nR && l < allLines.length && !seen[l]; l = joinsOf(l)) {
          seen[l] = 1;
          chain.push(l);
        }
        for (let q = chain.length - 1; q >= 0; q--) order.push(chain[q]);
      }
    }
    for (const li of order) {
      const c = allLines[li] as unknown as LineArrays;
      const st = traced.streams[li - nR];
      const m = c.level.length;
      // (Its mouth on a reach the pass raised: under the receiver's water now, it backs up.)
      const j = joinsOf(li);
      if (j >= nR && raisedLine[j]) {
        const mouth = levelOn(allLines[j], joinSOf(li));
        if (c.level[m - 1] < mouth - 0.01 && holds(c, li, m - 1, mouth) && backwater(c, li, m - 1, mouth)) lift(c, li, m - 1, mouth, false);
      }
      let i = 0;
      // (An outlet's head in its own lake keeps its lake's level.)
      if (st.pool >= 0) while (i < m && mask.at(c.north[i], c.east[i]) > -Infinity) i++;
      let wasIn = i > 0;
      // (Whether the run of samples in the water it is on came in at the surface: a run whose backwater is blocked
      // keeps its levels, which may not rise downstream.)
      let runOk = true;
      for (; i < m; i++) {
        const lv = mask.at(c.north[i], c.east[i]);
        const inside = lv > -Infinity;
        if (inside && !wasIn) {
          // (Only a lake it ends in or stays in backs it up. A line that passes it - its water already under the lake's
          // level as it comes to it, no lower when it leaves it for good, and under that level then: a notch along the
          // lake's edge, as traced - keeps its levels. Seed 777777 line 2267 ran flat at 204.3 m along lake 212.7 m for
          // 234 m and on for 10 km: the backwater stood the 5 km above it 8.4 m higher, over a step down where it left,
          // and the stream joining its head, line 474, ran 8.4 m up into it.)
          const pool = mask.poolHit;
          let eLast = i;
          for (let e = i + 1; e < m; e++) if (mask.at(c.north[e], c.east[e]) > -Infinity && mask.poolHit === pool) eLast = e;
          const passes = i > 0 && eLast + 1 < m && c.level[i - 1] < lv - LEAVE_BELOW && c.level[i - 1] - c.level[eLast] < LEAVE_BELOW && c.level[eLast + 1] < lv - LEAVE_BELOW;
          if (passes) {
            runOk = false;
            surfaceReport.passing++;
          } else runOk = c.level[i] >= lv - 0.01 || backwater(c, li, i, lv);
        }
        if (inside && runOk) {
          const to = i > 0 ? Math.min(lv, c.level[i - 1]) : lv;
          lift(c, li, i, Math.max(c.level[i], to), true);
        }
        wasIn = inside;
      }
    }
    // (A fall or a lip whose drop the pass took away.)
    const keepFall = (f: Fall): boolean => !raisedLine[f.line] || allLines[f.line].level[f.index] - allLines[f.line].level[Math.min(allLines[f.line].level.length - 1, f.index + 1)] > 0.5;
    const kept = falls.filter(keepFall);
    surfaceReport.falls = falls.length - kept.length;
    falls.length = 0;
    falls.push(...kept);
    for (let li = nR; li < allLines.length; li++) {
      if (!raisedLine[li]) continue;
      const lv = allLines[li].level;
      lipsOf[li] = lipsOf[li].filter((k) => lv[k] - lv[Math.min(lv.length - 1, k + 1)] > 0.5);
    }
  }
  // A stream's carved floor is its bed: no broad breach (a floor worn through a rim) but at a lake's outlet; where its
  // water runs well under the ground (a sill, a gorge below a fall) the notch is its bed's width (streams.ts bedWidth).
  for (let li = nR; li < allLines.length; li++) {
    if (traced.streams[li - nR].pool >= 0) continue;
    const b = (allLines[li] as unknown as { breach: Float64Array }).breach;
    const A = channelArea[li];
    for (let i = 0; i < b.length; i++) if (b[i] > 0) b[i] = Math.min(b[i], 0.5 * bedWidth(A[i]));
  }
  const tF = performance.now();
  const flows = allLines.map((c, li) => flowOf(c, lipsOf[li]));
  netMs.flow += performance.now() - tF;
  // --- The channel-form law on every line, river or stream (channelForm.ts; organic-map DESIGN.md sections 2-4). From
  // its reach state at each sample - catchment, water gradient over 20 single-thread widths (at least 200 m), the room
  // its floor gives either side (roomAcross) - the law gives the bed (active) width, the water's share of it, the
  // bank, the steps. The water's half-width each line carries is the law's (its catchment's water), never narrower
  // below a junction than what joined it there (RN45, every line). The drawn form about the line: the bed's edges (a
  // point bar inside each bend, a cut bank outside), the water's edges, both ragged by the heterogeneity field h at
  // their own points and the bed kept on its floor; the depth (a pool at a bend's apex, a riffle at a crossing); white
  // water only where a step is higher than the water is deep.
  const formOfLine: Array<{ bedR: Float32Array; bedL: Float32Array; wetR: Float32Array; wetL: Float32Array; depth: Float32Array; bankH: Float32Array; bankTan: Float32Array }> = [];
  const formStats = { samples: 0, braidLaw: 0, white: 0, ms: formMs };
  const tForm0 = performance.now();
  /** Each line's law per sample (catchment for its width, gradient, room each side, bend), then its widths. */
  const lawLine = allLines.map((c, li) => {
    const m = c.s.length;
    // (Read by arc length: the falls may have put samples into the line since.)
    const wa = widthArea[li];
    const A = wa ? Float64Array.from(c.s, (sv, i) => Math.min(channelArea[li][i], lerpS(wa.s, wa.a, sv))) : channelArea[li];
    const S = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const half = Math.max(100, 10 * formWs(A[i]));
      const s0 = Math.max(0, c.s[i] - half);
      const s1 = Math.min(c.s[m - 1], c.s[i] + half);
      S[i] = s1 - s0 > 1 ? Math.max(0, (sampleAt(c.s, c.level, s0) - sampleAt(c.s, c.level, s1)) / (s1 - s0)) : 0;
    }
    let roomL: Float32Array;
    let roomR: Float32Array;
    let kap: Float32Array;
    const fc = li < nR ? formCh[li] : undefined;
    if (fc) {
      // (A river's, as its thread was laid in it, read by arc length: the falls may have put samples in since.)
      roomL = Float32Array.from(c.s, (sv) => lerpS(fc.s, fc.roomL, sv));
      roomR = Float32Array.from(c.s, (sv) => lerpS(fc.s, fc.roomR, sv));
      kap = Float32Array.from(c.s, (sv) => lerpS(fc.s, fc.kap, sv));
    } else {
      // (A stream's, read across it every STREAM_ROOM_EVERY m, the lower of two stations between them; none in a lake.)
      roomL = new Float32Array(m);
      roomR = new Float32Array(m);
      const st: number[] = [];
      let next = 0;
      for (let i = 0; i < m; i++) if (c.s[i] >= next || i === m - 1) {
        st.push(i);
        next = c.s[i] + STREAM_ROOM_EVERY;
      }
      const sL = new Float32Array(st.length).fill(NaN);
      const sR = new Float32Array(st.length).fill(NaN);
      for (let q = 0; q < st.length; q++) {
        const i = st[q];
        if (mask.at(c.north[i], c.east[i]) > -Infinity) continue;
        const i0 = Math.max(0, i - 1);
        const i1 = Math.min(m - 1, i + 1);
        const tl = Math.hypot(c.north[i1] - c.north[i0], c.east[i1] - c.east[i0]) || 1;
        const nn = -(c.east[i1] - c.east[i0]) / tl;
        const ne = (c.north[i1] - c.north[i0]) / tl;
        const top = c.level[i] + FLOOR_OVER + formOf(A[i], S[i], 0).bankH + 1;
        sR[q] = roomAcross(c.north[i], c.east[i], nn, ne, top, c.level[i] + 0.5);
        sL[q] = roomAcross(c.north[i], c.east[i], -nn, -ne, top, c.level[i] + 0.5);
      }
      // (A station in a lake takes the nearest that reads a floor.)
      for (const r of [sL, sR]) {
        let last = NaN;
        for (let q = 0; q < r.length; q++) if (Number.isFinite(r[q])) last = r[q];
        else if (Number.isFinite(last)) r[q] = last;
        last = NaN;
        for (let q = r.length - 1; q >= 0; q--) if (Number.isFinite(r[q])) last = r[q];
        else r[q] = Number.isFinite(last) ? last : 0.5 * FLOOR_MIN;
      }
      for (let q = 0; q + 1 < st.length; q++) for (let i = st[q]; i <= st[q + 1]; i++) {
        roomL[i] = Math.min(sL[q], sL[q + 1]);
        roomR[i] = Math.min(sR[q], sR[q + 1]);
      }
      if (st.length === 1) roomL.fill(sL[0]), roomR.fill(sR[0]);
      const smoothM = new Float64Array(m);
      const peakM = new Float64Array(m);
      for (let i = 0; i < m; i++) {
        const lam2 = Math.max(LAMBDA_MIN, formOf(A[i], S[i], Math.max(FLOOR_MIN, roomL[i] + roomR[i])).lam2);
        smoothM[i] = Math.max(12, lam2 / 8);
        peakM[i] = Math.max(30, lam2 / 2);
      }
      kap = bendOf(c.north, c.east, smoothM, peakM);
    }
    const hw = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const f = formOf(A[i], S[i], Math.max(FLOOR_MIN, roomL[i] + roomR[i]));
      hw[i] = 0.5 * f.phi * f.Wa;
    }
    return { A, S, roomL, roomR, kap, hw };
  });
  // Below a junction a line's water is never narrower than what joined it there (every line; tributaries' own widths
  // first: until nothing changes).
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let li = allLines.length - 1; li >= 0; li--) {
      const j = joinsOf(li);
      if (j < 0) continue;
      const wIn = lawLine[li].hw[lawLine[li].hw.length - 1];
      const P = allLines[j];
      const hP = lawLine[j].hw;
      const sj = joinSOf(li);
      for (let i = 0; i < P.s.length; i++) {
        if (P.s[i] < sj - 1e-6 || hP[i] >= wIn) continue;
        hP[i] = wIn;
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (let li = 0; li < allLines.length; li++) {
    const c = allLines[li];
    const L = lawLine[li];
    const m = c.s.length;
    const fl = flows[li];
    const out = { bedR: new Float32Array(m), bedL: new Float32Array(m), wetR: new Float32Array(m), wetL: new Float32Array(m), depth: new Float32Array(m), bankH: new Float32Array(m), bankTan: new Float32Array(m) };
    for (let i = 0; i < m; i++) {
      const roomL = L.roomL[i];
      const roomR = L.roomR[i];
      const f = formOf(L.A[i], L.S[i], Math.max(FLOOR_MIN, roomL + roomR));
      const hw = L.hw[i];
      // The bed (active) width the water's half-width gives at the law's share, varied by h at twice its width.
      const Wb = Math.max(2 * hw / f.phi, 0.5);
      const pn = c.north[i];
      const pe = c.east[i];
      const vary = Math.exp(WIDTH_SPREAD * hSmooth(pn / (2 * Wb), pe / (2 * Wb), 1));
      const Wa = Wb * vary;
      const w = 2 * hw * vary;
      // The sample's direction, for its banks' own points.
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(m - 1, i + 1);
      const tn = c.north[i1] - c.north[i0];
      const te = c.east[i1] - c.east[i0];
      const tl = Math.hypot(tn, te) || 1;
      const rn = -te / tl;
      const re = tn / tl;
      const kap = L.kap[i];
      const inR = kap > 0 ? 1 : 0;
      const k = Math.abs(kap);
      const inner = 0.5 * w + (Wa - w) * (0.2 + 0.94 * k);
      const outer = 0.5 * w + 0.2 * (Wa - w);
      for (const side of [1, -1]) {
        const base = (side > 0) === (inR === 1) ? inner : outer;
        const en = pn + side * rn * base;
        const ee = pe + side * re * base;
        const wetE = 0.5 * w * (1 + 0.12 * Math.max(-1.25, Math.min(1.25, hSmooth(en / (2 * Wa), ee / (2 * Wa), 3))));
        const room = side > 0 ? roomR : roomL;
        const bed = Math.max(wetE + 0.3, Math.min(Math.max(room, wetE + 0.3), base + 0.2 * Wa * hSmooth(en / (2 * Wa), ee / (2 * Wa), 2)));
        if (side > 0) {
          out.bedR[i] = bed;
          out.wetR[i] = wetE;
        } else {
          out.bedL[i] = bed;
          out.wetL[i] = wetE;
        }
      }
      c.halfWidth[i] = hw;
      out.depth[i] = threadDepth(w, f.beta, k);
      out.bankH[i] = f.bankH;
      out.bankTan[i] = f.bankTan;
      // White water and the kind of flow from the steps (no 200 m gradient window): a riffle where the fall is not taken
      // in steps, placid where the pattern is meandering too.
      const white = stepWhite(f.stepH, out.depth[i]);
      if (fl.regime[i] !== REGIME.fall) {
        fl.steepness[i] = Math.min(fl.steepness[i], WHITE_FROM + (1 - WHITE_FROM) * white);
        fl.regime[i] = f.sigma >= 0.4 ? REGIME.steppool : f.sigma >= 0.05 ? REGIME.rapids : f.pi < 0.3 ? REGIME.placid : REGIME.riffle;
      }
      formStats.samples++;
      if (f.betaLaw > 0.2) formStats.braidLaw++;
      if (white > 0) formStats.white++;
    }
    formOfLine[li] = out;
  }
  formMs.form = performance.now() - tForm0;
  (traced.report as unknown as { form?: typeof formStats }).form = formStats;
  // The stones on each bed (falls.ts bedGrain).
  const feetOf: Array<Array<{ index: number; height: number }>> = allLines.map(() => []);
  for (const f of falls) feetOf[f.line].push({ index: f.index, height: f.height });
  const grains = allLines.map((c, li) => bedGrain(c, channelArea[li], flows[li].gradient, li >= nR ? traced.streams[li - nR].pool >= 0 : P0wet[li], feetOf[li]));
  tPhase.push(performance.now());
  const fallIndex = new FallIndex(falls);
  const streamReport: StreamReport = traced.report;
  streamReport.shape = shapeReport;
  streamReport.pitch = pitchReport;
  (streamReport as unknown as { surface?: typeof surfaceReport }).surface = surfaceReport;

  // --- Indexes: every cell lists the segments (line, index) that can reach a point in it (the valley index above:
  // each axis segment is listed out to the largest reach of the segments near it along the river, as the query takes
  // a line's nearest listed segment, so a nearer one left unlisted (a smaller reach) would put a seam at a cell edge).
  // One channel index serves both the carving (within the bank) and queryRiver (out to CHANNEL_REACH).
  // A stream's broad breaches (streams.ts) reach out to their walls' top: its segments there are listed that far.
  const breachReach = allLines.map((c) => {
    const b = (c as { breach: Float64Array }).breach;
    const k = (c as { cut: Float64Array }).cut;
    const r = new Float64Array(b.length);
    let any = false;
    for (let i = 0; i < b.length; i++) {
      r[i] = b[i] > 0 ? breachReachOf(b[i], k[i]) : 0;
      if (b[i] > 0) any = true;
    }
    return any ? r : null;
  });
  // A stream's bed half-width at each sample (its banks are carved to it, heightfield.ts streamBanks).
  const bedOf = allLines.map((c, li) => (li < nR ? null : Float64Array.from(channelArea[li], (A) => 0.5 * bedWidth(A))));
  const tI = performance.now();
  const channelIndex = new SegmentIndex(allLines, (li, i) => {
    const br = breachReach[li];
    return Math.max(li < nR ? CHANNEL_REACH : STREAM_REACH, br ? Math.max(br[i], br[i + 1]) : 0);
  }, CHANNEL_CELL);
  const wideIndex = channelIndex;
  netMs.index = performance.now() - tI;
  traced.report.netMs = netMs;
  tPhase.push(performance.now());
  traced.report.phases = tPhase.slice(1).map((t, i) => t - tPhase[i]);
  const oxbowIndex = new PolylineIndex(oxbows, 200, 100);
  const oxNear: PolylineNear = { line: 0, seg: 0, t: 0, u: 0, dist: Infinity, side: 0 };

  const valleyHits: ValleyNear[] = [];
  const channelHits: ChannelNear[] = [];
  const network: NetworkQuery = {
    valleys(pn, pe, out) {
      return valleyBlend.perLineBlend(pn, pe, valleyBand, (li, dist, n, k) => {
        const o = out[k] ?? (out[k] = { dist: 0, level: 0, floodplain: 0, influence: 0, gap: 0, swing: 0 });
        blendValley(li, dist, n, o);
        return dist < o.floodplain + o.influence;
      });
    },
    channels(pn, pe, out) {
      return channelIndex.perLine(pn, pe, (li, i, t, dist, side, u, k) => {
        const r = allLines[li];
        const o = out[k] ?? (out[k] = { line: 0, dist: 0, side: 0, level: 0, halfWidth: 0, s: 0, beyondSource: 0, kind: 0, breach: 0, reach: 0, cut: 0, bed: 0 });
        o.line = li;
        o.kind = kinds[li];
        o.dist = dist;
        o.side = side;
        o.level = r.level[i] + (r.level[i + 1] - r.level[i]) * t;
        o.halfWidth = r.halfWidth[i] + (r.halfWidth[i + 1] - r.halfWidth[i]) * t;
        o.s = r.s[i] + (r.s[i + 1] - r.s[i]) * t;
        o.beyondSource = i === 0 && u < 0 ? -u * Math.hypot(r.north[1] - r.north[0], r.east[1] - r.east[0]) : 0;
        const bd = bedOf[li];
        o.bed = bd ? bd[i] + (bd[i + 1] - bd[i]) * t : o.halfWidth;
        const fm = formOfLine[li];
        o.wet = undefined;
        if (fm) {
          // A river's bed, water edge, depth and bank on this side (the law's, channelForm.ts).
          const bd2 = side > 0 ? fm.bedR : fm.bedL;
          const we = side > 0 ? fm.wetR : fm.wetL;
          o.bed = bd2[i] + (bd2[i + 1] - bd2[i]) * t;
          o.wet = we[i] + (we[i + 1] - we[i]) * t;
          o.depth = fm.depth[i] + (fm.depth[i + 1] - fm.depth[i]) * t;
          o.bankH = fm.bankH[i] + (fm.bankH[i + 1] - fm.bankH[i]) * t;
          o.bankTan = fm.bankTan[i] + (fm.bankTan[i + 1] - fm.bankTan[i]) * t;
        }
        const br = breachReach[li];
        if (br && (br[i] > 0 || br[i + 1] > 0)) {
          const b = (r as { breach: Float64Array }).breach;
          o.breach = b[i] + (b[i + 1] - b[i]) * t;
          o.reach = Math.max(br[i], br[i + 1]);
          const ct = (r as { cut: Float64Array }).cut;
          o.cut = ct[i] + (ct[i + 1] - ct[i]) * t;
          return dist < Math.max(Math.max(o.halfWidth, fm ? o.bed : 0) + CHANNEL_MARGIN, o.reach);
        }
        o.breach = 0;
        return dist < Math.max(o.halfWidth, fm ? o.bed : 0) + CHANNEL_MARGIN;
      });
    },
  };

  /** Each line's bed edges integrated along it (queryRiver's smoothing). */
  const bedSum = allLines.map((r, li) => {
    const m = r.s.length;
    const R = new Float64Array(m);
    const Lf = new Float64Array(m);
    const f = formOfLine[li];
    for (let i = 1; i < m; i++) {
      const ds = r.s[i] - r.s[i - 1];
      R[i] = R[i - 1] + 0.5 * (f.bedR[i] + f.bedR[i - 1]) * ds;
      Lf[i] = Lf[i - 1] + 0.5 * (f.bedL[i] + f.bedL[i - 1]) * ds;
    }
    return { R, L: Lf };
  });
  const queryRiver = (pn: number, pe: number, out: RiverHit): RiverHit => {
    out.dist = Infinity;
    out.side = 0;
    out.beyondSource = 0;
    let best = -1;
    let bestD = Infinity;
    wideIndex.perLine(pn, pe, (li, i, t, dist, side, u) => {
      // A stream counts within its own reach only (its segments are listed no further out).
      if (dist < bestD && (li < nR || dist <= STREAM_REACH)) {
        bestD = dist;
        best = li;
        const r = allLines[li];
        out.dist = dist;
        out.side = side;
        out.level = r.level[i] + (r.level[i + 1] - r.level[i]) * t;
        out.halfWidth = r.halfWidth[i] + (r.halfWidth[i + 1] - r.halfWidth[i]) * t;
        out.s = r.s[i] + (r.s[i + 1] - r.s[i]) * t;
        out.beyondSource = i === 0 && u < 0 ? -u * Math.hypot(r.north[1] - r.north[0], r.east[1] - r.east[0]) : 0;
        // (A line's bed about its middle: the ground shader paints it, the trees keep off it. Asked for it smoothed
        // along the line - a coarse tile's vertices, `out.smooth` m apart - its edges' mean over that much of the line
        // either side: the bars and bays between two vertices are not drawn as spikes.)
        const fm = formOfLine[li];
        let bR = fm.bedR[i] + (fm.bedR[i + 1] - fm.bedR[i]) * t;
        let bL = fm.bedL[i] + (fm.bedL[i + 1] - fm.bedL[i]) * t;
        if (out.smooth && out.smooth > 0) {
          const ci = bedSum[li];
          const s0 = Math.max(0, out.s - out.smooth);
          const s1 = Math.min(r.s[r.s.length - 1], out.s + out.smooth);
          if (s1 - s0 > 1) {
            bR = (lerpS(r.s, ci.R, s1) - lerpS(r.s, ci.R, s0)) / (s1 - s0);
            bL = (lerpS(r.s, ci.L, s1) - lerpS(r.s, ci.L, s0)) / (s1 - s0);
          }
        }
        out.bed = 0.5 * (bR + bL);
        out.bedShift = 0.5 * (bR - bL);
      }
      return false;
    });
    if (best >= 0 && bestD <= CHANNEL_REACH) return out;
    out.dist = Infinity;
    out.side = 0;
    out.beyondSource = 0;
    // Out of reach of every channel: a distance estimated from the nearest valley axis and its meander belt.
    let vd = Infinity;
    valleyIndex.perLine(pn, pe, (li, i, t, dist) => {
      const a = axes[li];
      const est = Math.max(CHANNEL_REACH, dist - (a.belt[i] + (a.belt[i + 1] - a.belt[i]) * t) - a.halfWidth[i]);
      if (est < vd) {
        vd = est;
        out.dist = est;
        out.level = a.level[i] + (a.level[i + 1] - a.level[i]) * t;
        out.halfWidth = a.halfWidth[i];
        out.bed = a.halfWidth[i];
        out.bedShift = 0;
        out.s = 0;
      }
      return false;
    });
    return out;
  };
  /** The nearest channel's flow at a point (within its reach: CHANNEL_REACH for a river, STREAM_REACH for a stream). */
  const queryFlow = (pn: number, pe: number, out: FlowHit): FlowHit => {
    out.dist = Infinity;
    out.line = -1;
    let bestD = Infinity;
    channelIndex.perLine(pn, pe, (li, i, t, dist, side) => {
      if (dist >= bestD || dist > (li < nR ? CHANNEL_REACH : STREAM_REACH)) return false;
      bestD = dist;
      const c = allLines[li];
      const f = flows[li];
      // The nearer sample's kind of flow and gradient; the rest interpolated.
      const j = t < 0.5 ? i : i + 1;
      out.dist = dist;
      out.side = side;
      out.line = li;
      out.kind = kinds[li];
      out.index = j;
      out.s = c.s[i] + (c.s[i + 1] - c.s[i]) * t;
      out.level = c.level[i] + (c.level[i + 1] - c.level[i]) * t;
      out.halfWidth = c.halfWidth[i] + (c.halfWidth[i + 1] - c.halfWidth[i]) * t;
      out.gradient = f.gradient[j];
      out.steepness = f.steepness[i] + (f.steepness[i + 1] - f.steepness[i]) * t;
      out.speed = f.speed[i] + (f.speed[i + 1] - f.speed[i]) * t;
      out.regime = f.regime[j];
      const dn = c.north[i + 1] - c.north[i];
      const de = c.east[i + 1] - c.east[i];
      const len = Math.hypot(dn, de) || 1;
      out.dirN = dn / len;
      out.dirE = de / len;
      return false;
    });
    return out;
  };
  const queryValley = (pn: number, pe: number, out: ValleyHit): ValleyHit => {
    out.dist = Infinity;
    const k = network.valleys(pn, pe, valleyHits);
    for (let j = 0; j < k; j++) {
      const v = valleyHits[j];
      // The valley that shapes the point most: the one whose floodplain edge is nearest.
      if (out.dist === Infinity || v.dist - v.floodplain < out.dist - out.floodplain) {
        out.dist = v.dist;
        out.level = v.level;
        out.floodplain = v.floodplain;
      }
    }
    return out;
  };
  const queryOxbow = (pn: number, pe: number, out: OxbowHit): OxbowHit => {
    out.dist = Infinity;
    if (!oxbowIndex.nearest(pn, pe, oxNear)) return out;
    const o = oxbows[oxNear.line];
    out.dist = oxNear.dist;
    out.level = o.level;
    out.halfWidth = o.halfWidth;
    out.depth = o.depth;
    return out;
  };
  void channelHits;

  const main = rivers[0] ?? { north: new Float64Array(0), east: new Float64Array(0), level: new Float64Array(0), halfWidth: new Float64Array(0), s: new Float64Array(0) };
  const mainAxis = axes[0];
  return {
    // The lakes as they stand after any pond the levels drained (networkLakes leaves out a pond with no water).
    lakes: networkLakes(d, mask),
    lakeMask: mask,
    river: { north: main.north, east: main.east, level: main.level, halfWidth: main.halfWidth, s: main.s },
    valley: mainAxis
      ? { north: mainAxis.north, east: mainAxis.east, level: mainAxis.level, floodplain: mainAxis.floodplain, s: mainAxis.s }
      : { north: new Float64Array(0), east: new Float64Array(0), level: new Float64Array(0), floodplain: new Float64Array(0), s: new Float64Array(0) },
    oxbows,
    rivers: allLines.map((r, li) => ({ north: r.north, east: r.east, level: r.level, halfWidth: r.halfWidth, s: r.s, joins: joinsOf(li), kind: kinds[li], ...(li >= nR ? { end: streamEnds[li - nR] } : {}), breach: (r as { breach: Float64Array }).breach, cut: (r as { cut: Float64Array }).cut, area: channelArea[li], ...flows[li], grain: grains[li], ...(pitchOf[li] ? { sigma: Float32Array.from(pitchOf[li]!.sigma), pitchOn: Float32Array.from(pitchOf[li]!.on) } : {}), bedR: formOfLine[li].bedR, bedL: formOfLine[li].bedL, wetR: formOfLine[li].wetR, wetL: formOfLine[li].wetL, depth: formOfLine[li].depth })),
    falls,
    faults,
    queryFlow,
    holdUnder(trim, under, near, over) {
      let lowered = 0;
      type HeldLine = { north: Float64Array; east: Float64Array; level: Float64Array; cut: Float64Array; breach: Float64Array; halfWidth: Float64Array; s: Float64Array };
      const raisedLine = new Uint8Array(allLines.length);
      const beside: ChannelNear[] = [];
      // Its cut, how far its water runs under the ground its channel is carved into (the shaped ground there), and its
      // breach from that - no wider than before: the channel index lists each segment out to the breach's reach as it
      // was built, before the airfields were sited. Then its flow.
      const settle = (li: number, og: Float64Array, was: Float64Array): void => {
        const r = allLines[li] as HeldLine;
        for (let i = 0; i < r.level.length; i++) {
          const lowerHere = r.level[i] < was[i] - 1e-9;
          const raiseHere = r.level[i] > was[i] + 1e-9;
          if (lowerHere) lowered++;
          if (raiseHere) raisedLine[li] = 1;
          const tg = trim(og[i], r.north[i], r.east[i]);
          if (!lowerHere && !raiseHere && !(tg < og[i] - 0.01)) continue;
          r.cut[i] = Math.max(0, tg - r.level[i]);
          r.breach[i] = Math.min(r.breach[i], breachOfCut(r.cut[i]));
        }
        const f = flowOf(r, lipsOf[li]);
        flows[li].gradient.set(f.gradient);
        flows[li].steepness.set(f.steepness);
        flows[li].regime.set(f.regime);
        flows[li].speed.set(f.speed);
      };
      // Every line, river or stream: the airfields are sited on the terrain, wherever it puts them, and a river through
      // a field's reach is held as a stream is (rivers ran up to 1.5 m under the blends of re-sited fields).
      for (let li = 0; li < allLines.length; li++) {
        const r = allLines[li] as HeldLine;
        const m = r.level.length;
        // (The ground each sample was levelled on, and its water, before.)
        let og: Float64Array | null = null;
        let was: Float64Array | null = null;
        let changed = false;
        for (let i = 0; i < m; i++) {
          if (!near(r.north[i], r.east[i])) continue;
          const g = r.level[i] + r.cut[i];
          // (Under that ground as the airfields shape it - trimmed under their approaches before the network carves the
          // channel into it, blended into their flats after: heightfield.ts fieldTrim, fieldUnder.)
          // (Or raised where a blend into a flat raises the ground over it, to under that ground as blended - over the
          // ground the channel is carved into before the blend, which the blend then raises over it: heightfield.ts
          // fieldOver - but no more than RAISE_BESIDE over another line's water beside it: two streams side by side,
          // one raised, stood a wall apart, their banks 8 m apart.)
          let u = over ? over(g, r.north[i], r.east[i]) : -Infinity;
          if (u > r.level[i] + 0.01) {
            const nh = network.channels(r.north[i], r.east[i], beside);
            for (let q = 0; q < nh; q++) {
              const o = beside[q];
              if (o.line !== li && o.dist < o.halfWidth + r.halfWidth[i] + RAISE_BESIDE_REACH) u = Math.min(u, Math.max(r.level[i], o.level + RAISE_BESIDE));
            }
          }
          const raise = u > r.level[i] + 0.01;
          const t = under(g, r.north[i], r.east[i]);
          const lower = !raise && t < r.level[i] - 0.01;
          if (!lower && !raise && !(trim(g, r.north[i], r.east[i]) < g - 0.01)) continue;
          og ??= Float64Array.from(r.level, (v, q) => v + r.cut[q]);
          was ??= Float64Array.from(r.level);
          changed = true;
          if (lower) r.level[i] = t;
          else if (raise) r.level[i] = u;
        }
        if (!changed || !og || !was) continue;
        // (Never over the water above it: a raise stops at it.)
        for (let i = 1; i < m; i++) r.level[i] = Math.min(r.level[i], r.level[i - 1]);
        settle(li, og, was);
      }
      // A line joining a reach so raised, under its water now, backs up to it (receivers first).
      if (over) {
        const seen = new Uint8Array(allLines.length);
        const chain: number[] = [];
        for (let l0 = 0; l0 < allLines.length; l0++) {
          chain.length = 0;
          for (let l = l0; l >= 0 && l < allLines.length && !seen[l]; l = joinsOf(l)) {
            seen[l] = 1;
            chain.push(l);
          }
          for (let q = chain.length - 1; q >= 0; q--) {
            const li = chain[q];
            const j = joinsOf(li);
            if (j < 0 || !raisedLine[j]) continue;
            const r = allLines[li] as HeldLine;
            const m = r.level.length;
            const mouth = levelOn(allLines[j], joinSOf(li));
            if (!(r.level[m - 1] < mouth - 0.01)) continue;
            const og = Float64Array.from(r.level, (v, k) => v + r.cut[k]);
            const was = Float64Array.from(r.level);
            for (let k = m - 1; k >= 0 && r.level[k] < mouth; k--) r.level[k] = mouth;
            settle(li, og, was);
          }
        }
      }
      return lowered;
    },
    fallsNear: (pn, pe, radius, out) => fallIndex.near(pn, pe, radius, out),
    streamReport,
    network,
    queryRiver,
    queryValley,
    queryOxbow,
  };
}


/** Courses keep this far from the home runway's centreline segment, m (the meander belt then still clears it). */
const RUNWAY_CLEAR = 2500;
const RW_HALF = AIRPORT.runway.length / 2;

/** Distance from the home runway's centreline segment, m. */
function runwayDistance(pn: number, pe: number): number {
  const c = AIRPORT.runway.center;
  const RW_C = Math.cos(AIRPORT.runway.heading);
  const RW_S = Math.sin(AIRPORT.runway.heading);
  const dn = pn - c.north;
  const de = pe - c.east;
  const along = Math.max(-RW_HALF, Math.min(RW_HALF, dn * RW_C + de * RW_S));
  return Math.hypot(dn - along * RW_C, de - along * RW_S);
}

/** Push course points lying near the home runway out to RUNWAY_CLEAR from it (in place). */
function clearOfRunway(n: number[], e: number[]): void {
  const c = AIRPORT.runway.center;
  const RW_C = Math.cos(AIRPORT.runway.heading);
  const RW_S = Math.sin(AIRPORT.runway.heading);
  for (let i = 0; i < n.length; i++) {
    const dn = n[i] - c.north;
    const de = e[i] - c.east;
    const along = Math.max(-RW_HALF, Math.min(RW_HALF, dn * RW_C + de * RW_S));
    const qn = dn - along * RW_C;
    const qe = de - along * RW_S;
    const d = Math.hypot(qn, qe);
    if (d >= RUNWAY_CLEAR) continue;
    // Straight out from the runway (across it, or off its end); a point on the centreline goes to the right.
    const un = d > 1 ? qn / d : -RW_S;
    const ue = d > 1 ? qe / d : RW_C;
    n[i] = c.north + along * RW_C + un * RUNWAY_CLEAR;
    e[i] = c.east + along * RW_S + ue * RUNWAY_CLEAR;
  }
}

const clampUnit = (x: number): number => Math.min(1, Math.max(0, x));

/** Box-filter arr in place over +-half samples, `passes` times (ends shortened, never padded). */

function smoothAlong(arr: Float64Array, half: number, passes: number): void {
  const m = arr.length;
  const tmp = new Float64Array(m);
  for (let p = 0; p < passes; p++) {
    let sum = 0;
    let lo = 0;
    let hi = -1;
    for (let i = 0; i < m; i++) {
      while (hi < Math.min(m - 1, i + half)) sum += arr[++hi];
      while (lo < i - half) sum -= arr[lo++];
      tmp[i] = sum / (hi - lo + 1);
    }
    arr.set(tmp);
  }
}

/**
 * Cut every loop where the polyline crosses itself (in place): the points between the two crossing segments go, and
 * the crossing point joins them. Segments are found through a 200 m grid, so a long channel costs little.
 */
function untangle(n: number[], e: number[], vs: number[]): void {
  const CELL = 200;
  for (let pass = 0; pass < 8; pass++) {
    // Segments by the cell of their midpoint: a dense grid over the line's extent (a head per cell, a chain through
    // the segments). The crossing kept is the furthest one along (whatever order the candidates come in).
    const m = n.length - 1;
    if (m < 2) return;
    const cn = new Int32Array(m);
    const ce = new Int32Array(m);
    let n0 = Infinity;
    let e0 = Infinity;
    let n1 = -Infinity;
    let e1 = -Infinity;
    for (let i = 0; i < m; i++) {
      cn[i] = Math.floor((n[i] + n[i + 1]) / 2 / CELL);
      ce[i] = Math.floor((e[i] + e[i + 1]) / 2 / CELL);
      n0 = Math.min(n0, cn[i]);
      n1 = Math.max(n1, cn[i]);
      e0 = Math.min(e0, ce[i]);
      e1 = Math.max(e1, ce[i]);
    }
    const rows = n1 - n0 + 3;
    const cols = e1 - e0 + 3;
    const head = new Int32Array(rows * cols).fill(-1);
    const next = new Int32Array(m);
    for (let i = m - 1; i >= 0; i--) {
      const c = (cn[i] - n0 + 1) * cols + ce[i] - e0 + 1;
      next[i] = head[c];
      head[c] = i;
    }
    let cut = false;
    for (let i = 0; i < m && !cut; i++) {
      let hit = -1;
      let t = 0;
      const px = e[i], py = n[i], qx = e[i + 1] - px, qy = n[i + 1] - py;
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          for (let j = head[(cn[i] - n0 + 1 + a) * cols + ce[i] - e0 + 1 + b]; j >= 0; j = next[j]) {
            if (j <= i + 1 || j <= hit) continue;
            // Segment i (p -> q) against segment j (r -> s): p + t (q - p) = r + u (s - r).
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
      // Keep 0..i, the crossing point, then hit+1.. (the outermost crossing of segment i, so the whole curl goes).
      const xn = n[i] + t * (n[i + 1] - n[i]);
      const xe = e[i] + t * (e[i + 1] - e[i]);
      const xs = vs[i] + t * (vs[i + 1] - vs[i]);
      n.splice(i + 1, hit - i, xn);
      e.splice(i + 1, hit - i, xe);
      vs.splice(i + 1, hit - i, Math.min(xs, vs[i + 1 + (hit - i)] ?? xs));
      cut = true;
    }
    if (!cut) return;
  }
}

/** cutOffLoops' grid of channel points, m. */
const LOOP_CELL = 200;

/** An oxbow cut off by cutOffLoops: the abandoned loop's centreline, where it lies along the valley, and its age. */
interface CutLoop {
  north: Float64Array;
  east: Float64Array;
  valleyS: number;
  halfWidth: number;
  age: number;
}

/**
 * Curls cut off: where the channel swings a loop round onto itself (two points with a loop of channel between them
 * whose beds overlap: closer than 1.2 of the law's bed width `Wa`, per axis sample), the channel takes the short way across and the loop is left beside it as an
 * oxbow lake, trimmed clear of the new channel. (The law's thread, its swing under 1.75 rad, rarely does: no neck is cut
 * by chance, channelForm.ts.) Edits the channel in place (it gets shorter); returns the oxbows.
 */
function cutOffLoops(ch: { north: number[]; east: number[]; valleyS: number[]; off: number[] }, a: Axis, li: number, Wa: Float64Array): CutLoop[] {
  const out: CutLoop[] = [];
  const { north, east, valleyS, off } = ch;
  const N = north.length;
  const cuts: Array<[number, number]> = [];
  // Arc length along the channel, and its points on a grid: each point looks only at the points near it (a curl), not
  // along the whole loop.
  const cum = new Float64Array(N);
  for (let j = 1; j < N; j++) cum[j] = cum[j - 1] + Math.hypot(north[j] - north[j - 1], east[j] - east[j - 1]);
  const grid = new Map<number, number[]>();
  const key = (cn: number, ce: number): number => (cn + 32768) * 65536 + (ce + 32768);
  for (let j = 0; j < N; j++) {
    const g = key(Math.floor(north[j] / LOOP_CELL), Math.floor(east[j] / LOOP_CELL));
    const l = grid.get(g);
    if (l) l.push(j);
    else grid.set(g, [j]);
  }
  let k = 0;
  while (k < N - 2) {
    const i = segmentAt(a.s, Math.max(0, valleyS[k]));
    const lambda = a.wavelength[i];
    // (The bed's half-width by the law, channelForm.ts: two stretches whose beds overlap touch.)
    const hw = 0.5 * Wa[i];
    // The nearest point a loop or more further on (a loop's channel is about 1-3 meander lengths; a tight curl less).
    const touchAt = 2.4 * hw;
    const reach = touchAt;
    let touch = -1;
    const pn = north[k];
    const pe = east[k];
    const c0 = Math.floor((pn - reach) / LOOP_CELL);
    const c1 = Math.floor((pn + reach) / LOOP_CELL);
    const e0 = Math.floor((pe - reach) / LOOP_CELL);
    const e1 = Math.floor((pe + reach) / LOOP_CELL);
    for (let cn = c0; cn <= c1; cn++) {
      for (let ce = e0; ce <= e1; ce++) {
        const l = grid.get(key(cn, ce));
        if (!l) continue;
        for (const j of l) {
          // The points a loop or more on and within 3.5 meander lengths of channel.
          if (j <= k || cum[j - 1] - cum[k] >= 3.5 * lambda) continue;
          const arc = cum[j] - cum[k];
          if (arc < 2 * touchAt) continue;
          const d = Math.hypot(north[j] - pn, east[j] - pe);
          // A loop swung round onto itself (always cut: a river cannot cross its own channel); the furthest such point.
          if (d < touchAt && j > touch) touch = j;
        }
      }
    }
    if (touch < 0) {
      k++;
      continue;
    }
    const best = touch;
    // The loop's crescent, clear of the short channel across the neck.
    const cn = north[k];
    const ce = east[k];
    const dn = north[best] - cn;
    const de = east[best] - ce;
    const l2 = dn * dn + de * de || 1;
    const clear = 2 * hw + 15;
    const on: number[] = [];
    const oe: number[] = [];
    for (let j = k; j <= best; j++) {
      const u = Math.min(1, Math.max(0, ((north[j] - cn) * dn + (east[j] - ce) * de) / l2));
      if (Math.hypot(north[j] - cn - dn * u, east[j] - ce - de * u) > clear) {
        on.push(north[j]);
        oe.push(east[j]);
      }
    }
    // A loop too small to leave a lake behind is still cut when it touches itself.
    if (on.length >= 5) out.push({ north: Float64Array.from(on), east: Float64Array.from(oe), valleyS: valleyS[(k + best) >> 1], halfWidth: hw, age: (hash2i(li, k) & 0xffff) / 65536 });
    cuts.push([k, best]);
    k = best;
  }
  if (cuts.length === 0) return out;
  // Rebuild the channel: each cut loop replaced by the neck, sampled every 20 m.
  const n2: number[] = [];
  const e2: number[] = [];
  const v2: number[] = [];
  const o2: number[] = [];
  let c = 0;
  for (let j = 0; j < N; j++) {
    n2.push(north[j]);
    e2.push(east[j]);
    v2.push(valleyS[j]);
    o2.push(off[j]);
    if (c < cuts.length && j === cuts[c][0]) {
      const to = cuts[c][1];
      const len = Math.hypot(north[to] - north[j], east[to] - east[j]);
      const steps = Math.max(1, Math.ceil(len / 20));
      for (let q = 1; q < steps; q++) {
        const t = q / steps;
        n2.push(north[j] + (north[to] - north[j]) * t);
        e2.push(east[j] + (east[to] - east[j]) * t);
        v2.push(valleyS[j] + (valleyS[to] - valleyS[j]) * t);
        o2.push(off[j] + (off[to] - off[j]) * t);
      }
      j = to - 1;
      c++;
    }
  }
  ch.north = n2;
  ch.east = e2;
  ch.valleyS = v2;
  ch.off = o2;
  return out;
}

/** Index of the segment containing arc length sv (clamped). */
function segmentAt(s: Float64Array, sv: number): number {
  let lo = 0;
  let hi = s.length - 1;
  if (sv <= s[0]) return 0;
  if (sv >= s[hi]) return Math.max(0, hi - 1);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid] <= sv) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Linear interpolation of arr (any array) at arc length sv. */
function lerpS(s: Float64Array, arr: ArrayLike<number>, sv: number): number {
  if (s.length === 1) return arr[0];
  const i = segmentAt(s, sv);
  const t = Math.min(1, Math.max(0, (sv - s[i]) / Math.max(1e-9, s[i + 1] - s[i])));
  return arr[i] + (arr[i + 1] - arr[i]) * t;
}

/** Linear interpolation of arr at arc length sv. */
function sampleAt(s: Float64Array, arr: Float64Array, sv: number): number {
  if (s.length === 1) return arr[0];
  const i = segmentAt(s, sv);
  const t = Math.min(1, Math.max(0, (sv - s[i]) / Math.max(1e-9, s[i + 1] - s[i])));
  return arr[i] + (arr[i + 1] - arr[i]) * t;
}

function nearestIndex(a: { north: Float64Array; east: Float64Array }, pn: number, pe: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < a.north.length; i++) {
    const d = (a.north[i] - pn) ** 2 + (a.east[i] - pe) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}
const nearestOnChannel = nearestIndex;

/**
 * Spatial index over many polylines with a reach per segment: each cell lists (line, segment) pairs whose reach
 * covers some of the cell. perLine visits, for every line listed at a point, its nearest segment.
 */
class SegmentIndex {
  /** The cells over the lines' extent, dense (CSR): cell (cn, ce) lists entries start[c] .. start[c + 1] of `entries`
   * (line, segment pairs), c = (cn - cn0) * cols + ce - ce0. */
  private readonly cn0: number;
  private readonly ce0: number;
  private readonly rows: number;
  private readonly cols: number;
  private readonly start: Int32Array;
  private readonly entries: Int32Array;
  private readonly bestD: Float64Array;
  private readonly bestSeg: Int32Array;
  private readonly bestT: Float64Array;
  private readonly bestU: Float64Array;
  private readonly stamp: Int32Array;
  private readonly touched: Int32Array;
  private tick = 0;
  constructor(private readonly lines: ReadonlyArray<{ north: Float64Array; east: Float64Array }>, reach: (line: number, seg: number) => number, private readonly cell: number) {
    // Each segment's cell box (its bounding box grown by its reach), then a count per cell, then the entries in the
    // lines' and segments' order (perLine's ties go to the first listed, as they always have).
    let total = 0;
    for (const l of lines) total += Math.max(0, l.north.length - 1);
    const box = new Int32Array(total * 4);
    let cn0 = Infinity;
    let ce0 = Infinity;
    let cn1 = -Infinity;
    let ce1 = -Infinity;
    let q = 0;
    lines.forEach((l, li) => {
      for (let i = 0; i < l.north.length - 1; i++, q += 4) {
        const r = reach(li, i);
        box[q] = Math.floor((Math.min(l.north[i], l.north[i + 1]) - r) / cell);
        box[q + 1] = Math.floor((Math.max(l.north[i], l.north[i + 1]) + r) / cell);
        box[q + 2] = Math.floor((Math.min(l.east[i], l.east[i + 1]) - r) / cell);
        box[q + 3] = Math.floor((Math.max(l.east[i], l.east[i + 1]) + r) / cell);
        cn0 = Math.min(cn0, box[q]);
        cn1 = Math.max(cn1, box[q + 1]);
        ce0 = Math.min(ce0, box[q + 2]);
        ce1 = Math.max(ce1, box[q + 3]);
      }
    });
    if (!(cn0 <= cn1)) cn0 = cn1 = ce0 = ce1 = 0;
    this.cn0 = cn0;
    this.ce0 = ce0;
    this.rows = cn1 - cn0 + 1;
    this.cols = ce1 - ce0 + 1;
    const cells = this.rows * this.cols;
    const start = new Int32Array(cells + 1);
    for (let b = 0; b < total * 4; b += 4) {
      for (let cx = box[b]; cx <= box[b + 1]; cx++) {
        const row = (cx - cn0) * this.cols - ce0;
        for (let cy = box[b + 2]; cy <= box[b + 3]; cy++) start[row + cy + 1] += 2;
      }
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    const entries = new Int32Array(start[cells]);
    const fill = start.slice(0, cells);
    q = 0;
    lines.forEach((l, li) => {
      for (let i = 0; i < l.north.length - 1; i++, q += 4) {
        for (let cx = box[q]; cx <= box[q + 1]; cx++) {
          const row = (cx - cn0) * this.cols - ce0;
          for (let cy = box[q + 2]; cy <= box[q + 3]; cy++) {
            const at = fill[row + cy];
            entries[at] = li;
            entries[at + 1] = i;
            fill[row + cy] = at + 2;
          }
        }
      }
    });
    this.start = start;
    this.entries = entries;
    const L = lines.length;
    this.bestD = new Float64Array(L);
    this.bestSeg = new Int32Array(L);
    this.bestT = new Float64Array(L);
    this.bestU = new Float64Array(L);
    this.stamp = new Int32Array(L);
    this.touched = new Int32Array(L);
  }

  /**
   * For every line listed at the point, call f with its nearest segment, the clamped and unclamped parameter, the
   * distance and the side (+1 right of the flow); f returns whether to count it (k is the running count). Returns the count.
   */
  perLine(pn: number, pe: number, f: (line: number, seg: number, t: number, dist: number, side: number, u: number, k: number) => boolean): number {
    const cx = Math.floor(pn / this.cell) - this.cn0;
    const cy = Math.floor(pe / this.cell) - this.ce0;
    if (cx < 0 || cy < 0 || cx >= this.rows || cy >= this.cols) return 0;
    const c = cx * this.cols + cy;
    const k0 = this.start[c];
    const k1 = this.start[c + 1];
    if (k0 === k1) return 0;
    const list = this.entries;
    const tick = ++this.tick;
    let nt = 0;
    for (let k = k0; k < k1; k += 2) {
      const li = list[k];
      const i = list[k + 1];
      const l = this.lines[li];
      const an = l.north[i];
      const ae = l.east[i];
      const dn = l.north[i + 1] - an;
      const de = l.east[i + 1] - ae;
      const l2 = dn * dn + de * de;
      const u = l2 > 0 ? ((pn - an) * dn + (pe - ae) * de) / l2 : 0;
      const t = u < 0 ? 0 : u > 1 ? 1 : u;
      const qn = an + dn * t - pn;
      const qe = ae + de * t - pe;
      const d2 = qn * qn + qe * qe;
      if (this.stamp[li] !== tick) {
        this.stamp[li] = tick;
        this.touched[nt++] = li;
        this.bestD[li] = Infinity;
      }
      if (d2 < this.bestD[li]) {
        this.bestD[li] = d2;
        this.bestSeg[li] = i;
        this.bestT[li] = t;
        this.bestU[li] = u;
      }
    }
    let count = 0;
    for (let j = 0; j < nt; j++) {
      const li = this.touched[j];
      const i = this.bestSeg[li];
      const l = this.lines[li];
      const dn = l.north[i + 1] - l.north[i];
      const de = l.east[i + 1] - l.east[i];
      const side = dn * (pe - l.east[i]) - de * (pn - l.north[i]) >= 0 ? 1 : -1;
      if (f(li, i, this.bestT[li], Math.sqrt(this.bestD[li]), side, this.bestU[li], count)) count++;
    }
    return count;
  }

  /** perLineBlend's segments for the line it is calling back on: segment, parameter, side, weight (summing to 1). */
  bSeg = new Int32Array(64);
  bT = new Float64Array(64);
  bSide = new Float64Array(64);
  bW = new Float64Array(64);
  private bD = new Float64Array(64);

  /**
   * As perLine, but for every line listed at the point its stretches within band(d) of its nearest (d) are blended:
   * f is called with the line, d and the number of segments, left in bSeg / bT / bSide / bW, weighted 1 at the nearest
   * down to 0 at d + band. A stretch is a segment the point lies square to (or the nearest point, an end). A line's nearest point jumps from one stretch to another across a bend's inside (the two
   * equally far); the stretches' levels and widths differ there, and taken from the nearest alone they left a step in
   * the valley's walls along the line where it switched. (The cells list each line's segments in order, together.)
   */
  perLineBlend(pn: number, pe: number, band: (d: number) => number, f: (line: number, dist: number, n: number, k: number) => boolean): number {
    const cx = Math.floor(pn / this.cell) - this.cn0;
    const cy = Math.floor(pe / this.cell) - this.ce0;
    if (cx < 0 || cy < 0 || cx >= this.rows || cy >= this.cols) return 0;
    const c = cx * this.cols + cy;
    const k0 = this.start[c];
    const k1 = this.start[c + 1];
    const list = this.entries;
    let count = 0;
    for (let g = k0; g < k1; ) {
      const li = list[g];
      let g1 = g;
      while (g1 < k1 && list[g1] === li) g1 += 2;
      const m = (g1 - g) >> 1;
      if (m > this.bD.length) {
        this.bD = new Float64Array(2 * m);
        this.bSeg = new Int32Array(2 * m);
        this.bT = new Float64Array(2 * m);
        this.bSide = new Float64Array(2 * m);
        this.bW = new Float64Array(2 * m);
      }
      const l = this.lines[li];
      let best = Infinity;
      for (let q = 0; q < m; q++) {
        const i = list[g + 2 * q + 1];
        const an = l.north[i];
        const ae = l.east[i];
        const dn = l.north[i + 1] - an;
        const de = l.east[i + 1] - ae;
        const l2 = dn * dn + de * de;
        const u = l2 > 0 ? ((pn - an) * dn + (pe - ae) * de) / l2 : 0;
        const t = u < 0 ? 0 : u > 1 ? 1 : u;
        const qn = an + dn * t - pn;
        const qe = ae + de * t - pe;
        const d = Math.sqrt(qn * qn + qe * qe);
        // (Only a segment the point lies square to is a stretch of its own; one whose nearest point is its end is the
        // stretch running on through that point, and blending it would smooth the valley along the line.)
        this.bD[q] = u > 0 && u < 1 ? d : -d;
        if (d < best) best = d;
      }
      const B = band(best);
      let n = 0;
      let sum = 0;
      let ends = 0;
      for (let q = 0; q < m; q++) {
        const dq = this.bD[q];
        // (An end counts once, where it is the nearest: at a bend's outside, where no segment lies square to the point.)
        if (dq < 0 && (-dq > best || ends++ > 0)) continue;
        const x = (Math.abs(dq) - best) / B;
        if (x >= 1) continue;
        const w = 1 - x * x * (3 - 2 * x);
        const i = list[g + 2 * q + 1];
        const an = l.north[i];
        const ae = l.east[i];
        const dn = l.north[i + 1] - an;
        const de = l.east[i + 1] - ae;
        const l2 = dn * dn + de * de;
        const u = l2 > 0 ? ((pn - an) * dn + (pe - ae) * de) / l2 : 0;
        this.bSeg[n] = i;
        this.bT[n] = u < 0 ? 0 : u > 1 ? 1 : u;
        this.bSide[n] = dn * (pe - ae) - de * (pn - an) >= 0 ? 1 : -1;
        this.bW[n] = w;
        sum += w;
        n++;
      }
      for (let q = 0; q < n; q++) this.bW[q] /= sum;
      if (f(li, best, n, count)) count++;
      g = g1;
    }
    return count;
  }
}
