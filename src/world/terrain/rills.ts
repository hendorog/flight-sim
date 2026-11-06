// Hillside rills (a seeded world only): the small channels water cuts down every hillside, gathering into bigger ones
// in the gullies until they reach a stream, a river or a lake the drainage network (riverNetwork.ts, streams.ts) has
// traced. They are too small and too many for the world build: they are traced near the viewer, per RILL_PATCH square
// patch, in the terrain workers, on the ground as the terrain draws it (sampleTerrain), and drawn by the ground shader
// (terrainMaterial.ts, RillSystem.ts) as a darker, damp, stony bed along each line and, where the catchment carries
// enough water, a thin wet stripe of water down its middle. Nothing about the ground or its height changes.
//
// Tracing: the ground on a RILL_CELL raster around the patch (with a halo), steepest descent (D8), a pit spilling over
// to the first lower cell a small bounded flood reaches (else it is a sink: the water soaks away there), and the
// catchment accumulated down the flow. Every flow edge goes strictly down, so the result does not depend on the order
// of anything. A channel starts where the catchment passes RILL_AREA and has gathered from a slope more than one line
// wide (CONVERGE: on an even slope every raster column would otherwise grow its own parallel line), and goes on down to
// the network (a cell within reach of a traced channel's water, or in a lake or the sea), a sink (where it tapers out),
// or out of the window.
//
// Patches agree at their borders without seeing each other: a cell's catchment is used only when all of it lies
// within SAT_R cells of the cell (then every window that holds the cell with SAT_R + margin around it measures the same
// catchment); a cell whose catchment reaches further is "saturated" and drawn at the widest a rill gets (RILL_AREA_CAP,
// near the width the traced streams start at), and so is everything below it. So both sides of a border draw the same
// line, at the same width, from data they each work out alone.
//
// The lines are smoothed along the flow (a D8 path zigzags at 45 degrees), then each point is moved across the flow to
// the lowest ground within SNAP (the raster can sit a few metres up a gully's side), and smoothed lightly again.
// The patch's texels (RILL_TEXEL; a 1-texel apron all round so the texture filter never reads across patches) hold the
// vector to the nearest line point, the distance to it, and the line's size there: interpolating the vector is exact
// across a straight line, so the shader draws lines far narrower than a texel without stair-steps (RillSystem.ts).

import { hydrology, makeSample, sampleTerrain, snowShiftM, type TerrainSample } from './heightfield';
import type { FlowHit } from './hydrology';
import { gnoise } from './noise';
import { worldSeed } from '../worldSeed';
import { era } from '../era/eraState';

/** Patch edge length, m; raster cell and texel size, m. */
export const RILL_PATCH = 2048;
export const RILL_CELL = 16;
export const RILL_TEXEL = 4;
/** Texels per patch side, with the apron. */
export const RILL_TEX = RILL_PATCH / RILL_TEXEL + 2;
/** Texels hold the vector to the nearest line point out to this distance, m. */
export const RILL_RANGE = 16;
/** Catchment a rill starts from, km²; the most a rill's size counts (wider ones are drawn as this), km². */
export const RILL_AREA = 0.03;
export const RILL_AREA_CAP = 2;
/** Catchment from which a rill carries water to be seen (thinner ones are just the damp bed in its notch), km². */
export const RILL_WET_AREA = 0.12;

/** Cells per patch side. */
const CORE = RILL_PATCH / RILL_CELL;
/** A rill's size is the part of its catchment within this many cells (Chebyshev) of it, reached through cells within
 * it: exact for a small catchment, the near part of a big one. Every window holding the cell with this much (and the
 * flow's margin) around it measures the same. */
const AREA_R = 44;
/** A pit spills to the first lower cell a flood from it reaches within SPILL_R cells rising at most SPILL_D m. */
const SPILL_R = 6;
const SPILL_D = 2;
/** A line goes on this many cells below the last cell that starts one (its catchment near it big and converging
 * enough), narrowing out: a rill running out onto an even slope or a fan fades there rather than running on as one of
 * many parallel lines. Looked for up the flow through neighbouring cells only. */
const FADE = 12;
/** A rill ending in a sink tapers out over its last this many cells. */
const TAPER = 10;
// Window independence. Every value the core's texels use must come out the same in any window, so the window reaches
// far enough beyond the core for each in turn (margins in cells beyond the core; a flow step is at most SPILL_R cells,
// smoothing and snapping step to neighbouring cells only):
//   - segments from cells within SEG_M (a pit's spill segment reaches SPILL_R, a line's texels RILL_RANGE + apron);
//   - their ends, and the cells smoothing and snapping read about them (four neighbour steps): USE_M;
//   - the main donor there reads its donors' persistence: PERSIST_M;
//   - persistence looks up the flow FADE neighbour steps for a cell that starts a line: OWN_M;
//   - that cell's near catchment reads the flow within AREA_R, and a cell's flow reads the ground within SPILL_R + 1;
//   - a segment end's taper follows the flow TAPER steps down.
const SEG_M = SPILL_R + 2;
const USE_M = SEG_M + SPILL_R + 4;
const PERSIST_M = USE_M + SPILL_R;
const OWN_M = PERSIST_M + FADE;
/** Cells of raster around the core. */
const HALO = Math.max(OWN_M + AREA_R + SPILL_R + 1, SEG_M + SPILL_R + TAPER * SPILL_R + SPILL_R + 1);
/** A channel starts only where its catchment is at least this many times as wide (area over its longest flow path)
 * as one raster column: flow converging from a hollow, not a line down an even slope. */
const CONVERGE = 2.5;
/** Probe overrides (scripts/probes/rillMap.test.ts): never set in the sim. */
export const RILL_TUNE = { converge: CONVERGE, noise: 0.6, area: 0 };
/** The water is routed over the ground plus this much noise, m (at ROUTE_WAVE m and a third of that): on near-level
 * ground it makes the lines wander and gather as small unevenness does, where the raster's own steepest descent runs
 * them dead straight and parallel. Steeper ground hardly notices it. */
const ROUTE_NOISE = 0.6;
const ROUTE_WAVE = 150;
/** Points move across the flow to the lowest ground within this, m, in SNAP_STEP steps. */
const SNAP = 10;
const SNAP_STEP = 2;
/** A cell is in the network when within this of a traced channel's water, m (or under a lake's or the sea's). */
const NET_MARGIN = 4;
/** Strands within this many cells of a bigger line are drawn as it, followed at most MERGE_STEPS lines over
 * (rillSegments). */
const MERGE_R = 1;
const MERGE_STEPS = 3;

const DN = [-1, -1, 0, 1, 1, 1, 0, -1];
const DE = [0, 1, 1, 1, 0, -1, -1, -1];

export interface RillPatchRequest {
  /** Patch (pi, pj) covers east [pi * RILL_PATCH, +RILL_PATCH), north [pj * RILL_PATCH, +RILL_PATCH). */
  pi: number;
  pj: number;
}

export interface RillStats {
  /** Raster cells in the window, of them sampled (not in the block cache), channel cells in the core, rill length in the core (km), its wet part (km). */
  cells: number;
  sampled: number;
  channelCells: number;
  km: number;
  wetKm: number;
  /** Lines in the core ending in the network, in a sink. */
  toNetwork: number;
  toSink: number;
  /** Time spent sampling the ground, tracing, smoothing and snapping, rasterising, ms. */
  msGround: number;
  msTrace: number;
  msLines: number;
  msRaster: number;
}

export interface RillPatchData {
  kind: 'rills';
  pi: number;
  pj: number;
  /** RILL_TEX² texels, RGBA8 (row 0 south, column 0 west): see encode below; null when the patch has no rill. */
  texels: Uint8Array | null;
  stats: RillStats;
}

/** A rill segment (world east, north; size code 0..1 at each end; for the probes and tests). */
export interface RillSegment {
  e0: number;
  n0: number;
  e1: number;
  n1: number;
  s0: number;
  s1: number;
}

/** Size code (0..1) of a catchment (km²): log scale from RILL_AREA to RILL_AREA_CAP. */
export function rillSize(area: number): number {
  return Math.min(1, Math.max(0, Math.log(area / RILL_AREA) / Math.log(RILL_AREA_CAP / RILL_AREA)));
}
/** Catchment (km²) of a size code. */
export function rillArea(size: number): number {
  return RILL_AREA * Math.pow(RILL_AREA_CAP / RILL_AREA, size);
}
/** Half-width of a rill's channel (m) for a size code (the shader's twin: rillShader.ts). Hydraulic geometry: a channel's
 * width goes about as the root of its catchment; a little faster here, so that over the sizes a hillside's rills
 * reach (code 0 to about 0.6: 0.03 to 0.4 km² near them) it widens fivefold, 0.35 m to 1.7 m, and the trunk below a
 * join is plainly wider than either branch. Grows in from nothing at the head. */
export function rillBedHalf(size: number): number {
  const t = Math.min(1, Math.max(0, size / 0.08));
  return 0.35 * Math.exp(2.6 * size) * t * t * (3 - 2 * t);
}
/** Half-width of the water (m), 0 below RILL_WET_AREA: about half the channel, coming in over a short way. */
export function rillWaterHalf(size: number): number {
  const s0 = rillSize(RILL_WET_AREA);
  return size <= s0 ? 0 : rillBedHalf(size) * 0.55 * Math.min(1, (size - s0) / 0.12);
}

/** The traced raster of a window: everything the lines need, valid (window-independent) inside its margin. */
export interface RillGraph {
  /** Global cell coordinates of cell 0 (east, north: e = gx * RILL_CELL), and the window size in cells. */
  gx0: number;
  gy0: number;
  nx: number;
  ny: number;
  ground: Float64Array;
  /** 1: in the network (near a traced channel's water, or under standing water). */
  net: Uint8Array;
  /** Receiver cell; -1 none (network, window edge), -2 a sink. */
  to: Int32Array;
  /** Whole-window catchment, cells (a filter only: not the same in every window). */
  cells: Int32Array;
  /** Catchment within AREA_R in cells (0 where not worked out: too small to matter). */
  areaR: Int32Array;
  /** How far down from the last cell that starts a line (FADE at it, 0: no line). */
  persist: Uint8Array;
  /** Main channel donor (-1 none). */
  main: Int32Array;
  /** Cells downstream to a sink (TAPER + 1: further or none). */
  toSink: Uint8Array;
  /** Where a line's water meets the network: the point on the channel's centreline (or the cell). */
  endE: Map<number, number>;
  endN: Map<number, number>;
}

const scratch: TerrainSample = makeSample();

/** Raster cells per cached block side, and blocks kept (about 9 KB each: four windows' worth). */
const BLOCK = 32;
const CACHE_BLOCKS = 480;
interface RasterBlock {
  ground: Float64Array;
  route: Float64Array;
  net: Uint8Array;
}
let cacheState: { key: string; blocks: Map<string, RasterBlock> } | null = null;
/** The block cache of this thread, emptied when the world (seed, era, water) changes. */
function rasterCache(): { blocks: Map<string, RasterBlock> } {
  const key = `${worldSeed()}|${era().id}|${snowShiftM()}|${RILL_TUNE.noise}`;
  const rivers = hydrology.rivers;
  if (!cacheState || cacheState.key !== key || cacheRivers !== rivers) {
    cacheState = { key, blocks: new Map() };
    cacheRivers = rivers;
  }
  return cacheState;
}
let cacheRivers: unknown = null;
/** Empty the block cache (probes timing a cold build). */
export function clearRillCache(): void {
  cacheState = null;
}

/** Trace the raster of cells gx in [gx0, gx0 + nx), gy in [gy0, gy0 + ny); `ex0`..`ey1` (window cells) is where the
 * segments are wanted (rillSegments' range): the values they use are worked out around it (USE_M, PERSIST_M, OWN_M
 * less SEG_M). */
export function traceRillGraph(gx0: number, gy0: number, nx: number, ny: number, ex0: number, ey0: number, ex1: number, ey1: number, stats?: RillStats): RillGraph {
  const t0 = performance.now();
  const N = nx * ny;
  const ground = new Float64Array(N);
  const route = new Float64Array(N);
  const net = new Uint8Array(N);
  const s = scratch;
  // The raster by blocks (kept for the next patches: neighbouring windows overlap by most of their area).
  const cache = rasterCache();
  for (let by = Math.floor(gy0 / BLOCK); by * BLOCK < gy0 + ny; by++)
    for (let bx = Math.floor(gx0 / BLOCK); bx * BLOCK < gx0 + nx; bx++) {
      const key = `${bx},${by}`;
      let b = cache.blocks.get(key);
      if (b) cache.blocks.delete(key);
      else {
        b = { ground: new Float64Array(BLOCK * BLOCK), route: new Float64Array(BLOCK * BLOCK), net: new Uint8Array(BLOCK * BLOCK) };
        for (let y = 0; y < BLOCK; y++) {
          const north = (by * BLOCK + y) * RILL_CELL;
          for (let x = 0; x < BLOCK; x++) {
            const east = (bx * BLOCK + x) * RILL_CELL;
            sampleTerrain(north, east, s);
            const i = y * BLOCK + x;
            b.ground[i] = s.ground;
            b.route[i] = s.ground + RILL_TUNE.noise * (gnoise(east / ROUTE_WAVE + 31.7, north / ROUTE_WAVE - 12.3) + 0.5 * gnoise((3 * east) / ROUTE_WAVE - 7.1, (3 * north) / ROUTE_WAVE + 4.9));
            // (An airfield's flattened ground ends a line too: drained, not drawn.)
            if (s.standing > s.ground || s.river > s.ground || s.riverDist <= s.riverHalfWidth + NET_MARGIN || s.airportBlend < 1) b.net[i] = 1;
          }
        }
        if (stats) stats.sampled += BLOCK * BLOCK;
      }
      // Most recently used last.
      cache.blocks.set(key, b);
      const y0 = Math.max(gy0, by * BLOCK), y1 = Math.min(gy0 + ny, (by + 1) * BLOCK);
      const x0 = Math.max(gx0, bx * BLOCK), x1 = Math.min(gx0 + nx, (bx + 1) * BLOCK);
      for (let y = y0; y < y1; y++) {
        const src = (y - by * BLOCK) * BLOCK - bx * BLOCK;
        const dst = (y - gy0) * nx - gx0;
        for (let x = x0; x < x1; x++) {
          ground[dst + x] = b.ground[src + x];
          route[dst + x] = b.route[src + x];
          net[dst + x] = b.net[src + x];
        }
      }
    }
  while (cache.blocks.size > CACHE_BLOCKS) cache.blocks.delete(cache.blocks.keys().next().value as string);
  const t1 = performance.now();
  // Steepest descent over the routing ground; pits spill over a bounded flood.
  const to = new Int32Array(N);
  const stamp = new Int32Array(N);
  let stampNo = 0;
  const open: number[] = [];
  for (let i = 0; i < N; i++) {
    const x = i % nx;
    const y = (i / nx) | 0;
    if (net[i] || x === 0 || y === 0 || x === nx - 1 || y === ny - 1) {
      to[i] = -1;
      continue;
    }
    let best = -1;
    let bs = 0;
    const h = route[i];
    for (let k = 0; k < 8; k++) {
      const j = (y + DN[k]) * nx + x + DE[k];
      const d = (h - route[j]) * (k & 1 ? Math.SQRT1_2 : 1);
      if (d > bs) {
        bs = d;
        best = j;
      }
    }
    if (best >= 0) {
      to[i] = best;
      continue;
    }
    // A pit: flood out from it in height order (ties by cell order); the first cell lower than it receives its water.
    stampNo++;
    open.length = 0;
    open.push(i);
    stamp[i] = stampNo;
    let target = -2;
    while (open.length) {
      let m = 0;
      for (let q = 1; q < open.length; q++) {
        const a = open[q];
        const b = open[m];
        if (route[a] < route[b] || (route[a] === route[b] && a < b)) m = q;
      }
      const c = open[m];
      open[m] = open[open.length - 1];
      open.pop();
      if (route[c] < h) {
        target = c;
        break;
      }
      if (route[c] > h + SPILL_D) continue;
      const cx = c % nx;
      const cy = (c / nx) | 0;
      for (let k = 0; k < 8; k++) {
        const xx = cx + DE[k];
        const yy = cy + DN[k];
        if (xx < 0 || yy < 0 || xx >= nx || yy >= ny || Math.abs(xx - x) > SPILL_R || Math.abs(yy - y) > SPILL_R) continue;
        const j = yy * nx + xx;
        if (stamp[j] === stampNo) continue;
        stamp[j] = stampNo;
        open.push(j);
      }
    }
    to[i] = target;
  }
  // Whole-window catchment (cells), in height order: only a filter (a cell with less can have no line).
  const order = new Uint32Array(N);
  for (let i = 0; i < N; i++) order[i] = i;
  order.sort((a, b) => route[b] - route[a] || a - b);
  const cells = new Int32Array(N).fill(1);
  for (const i of order) {
    const j = to[i];
    if (j >= 0) cells[j] += cells[i];
  }
  // Donor lists.
  const dStart = new Int32Array(N + 1);
  for (let i = 0; i < N; i++) if (to[i] >= 0) dStart[to[i] + 1]++;
  for (let i = 0; i < N; i++) dStart[i + 1] += dStart[i];
  const donors = new Int32Array(dStart[N]);
  const fill = dStart.slice(0, N);
  for (let i = 0; i < N; i++) if (to[i] >= 0) donors[fill[to[i]]++] = i;
  const minCells = Math.ceil(((RILL_TUNE.area || RILL_AREA) * 1e6) / (RILL_CELL * RILL_CELL));
  // The catchment within AREA_R of each candidate (and its longest flow path there): a walk up the donor tree that
  // stays in the box. A cell starts a line where that is big enough and converging.
  const areaR = new Int32Array(N);
  const own = new Uint8Array(N);
  const pathLen = new Float32Array(N);
  const stack: number[] = [];
  const om = OWN_M - SEG_M;
  const bx0 = Math.max(0, ex0 - om), bx1 = Math.min(nx, ex1 + om);
  const by0 = Math.max(0, ey0 - om), by1 = Math.min(ny, ey1 + om);
  for (let y = by0; y < by1; y++)
    for (let x = bx0; x < bx1; x++) {
      const c = y * nx + x;
      if (cells[c] < minCells || net[c]) continue;
      let count = 0;
      let longest = 0;
      pathLen[c] = 0;
      stack.length = 0;
      stack.push(c);
      while (stack.length) {
        const u = stack.pop()!;
        count++;
        const lu = pathLen[u];
        if (lu > longest) longest = lu;
        const ux = u % nx;
        const uy = (u / nx) | 0;
        for (let q = dStart[u]; q < dStart[u + 1]; q++) {
          const d = donors[q];
          const dx = d % nx;
          const dy = (d / nx) | 0;
          if (Math.abs(dx - x) > AREA_R || Math.abs(dy - y) > AREA_R) continue;
          pathLen[d] = lu + Math.hypot(dx - ux, dy - uy) * RILL_CELL;
          stack.push(d);
        }
      }
      areaR[c] = count;
      if (count >= minCells && count * RILL_CELL >= RILL_TUNE.converge * longest) own[c] = 1;
    }
  // Persistence: FADE less the neighbour steps up the flow to the nearest cell that starts a line.
  const persist = new Uint8Array(N);
  const depth = new Uint8Array(N);
  const queue: number[] = [];
  const pm = PERSIST_M - SEG_M;
  for (let y = Math.max(0, ey0 - pm); y < Math.min(ny, ey1 + pm); y++)
    for (let x = Math.max(0, ex0 - pm); x < Math.min(nx, ex1 + pm); x++) {
      const c = y * nx + x;
      if (cells[c] < minCells || net[c]) continue;
      if (own[c]) {
        persist[c] = FADE;
        continue;
      }
      queue.length = 0;
      queue.push(c);
      depth[c] = 0;
      let found = -1;
      for (let h = 0; h < queue.length && found < 0; h++) {
        const u = queue[h];
        if (depth[u] >= FADE) continue;
        for (let q = dStart[u]; q < dStart[u + 1]; q++) {
          const d = donors[q];
          if (cells[d] < minCells || Math.abs((d % nx) - (u % nx)) > 1 || Math.abs(((d / nx) | 0) - ((u / nx) | 0)) > 1) continue;
          depth[d] = depth[u] + 1;
          if (own[d]) {
            found = depth[d];
            break;
          }
          queue.push(d);
        }
      }
      if (found >= 0) persist[c] = FADE - found;
    }
  // The main channel donor of each cell: the biggest near catchment, ties by place.
  const main = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    const j = to[i];
    if (j < 0 || !persist[i]) continue;
    const m = main[j];
    if (m < 0 || areaR[i] > areaR[m] || (areaR[i] === areaR[m] && i < m)) main[j] = i;
  }
  // Steps down to a sink.
  const toSink = new Uint8Array(N).fill(TAPER + 1);
  const sm = SPILL_R;
  for (let y = Math.max(0, ey0 - sm); y < Math.min(ny, ey1 + sm); y++)
    for (let x = Math.max(0, ex0 - sm); x < Math.min(nx, ex1 + sm); x++) {
      const c = y * nx + x;
      if (!persist[c]) continue;
      let j = c;
      for (let k = 0; k <= TAPER; k++) {
        const t = to[j];
        if (t === -2) {
          toSink[c] = k;
          break;
        }
        if (t < 0) break;
        j = t;
      }
    }
  // Where a line meets the network: the nearest point of the channel's centreline (a lake or the sea: the cell itself).
  const endE = new Map<number, number>();
  const endN = new Map<number, number>();
  const hit: FlowHit = { dist: Infinity, side: 0, line: -1, kind: 0, index: 0, s: 0, level: 0, halfWidth: 0, gradient: 0, steepness: 0, regime: 0, speed: 0, dirN: 0, dirE: 0 };
  for (let i = 0; i < N; i++) {
    const j = to[i];
    if (!persist[i] || j < 0 || !net[j] || endE.has(j)) continue;
    const east = (gx0 + (j % nx)) * RILL_CELL;
    const north = (gy0 + ((j / nx) | 0)) * RILL_CELL;
    let ee = east;
    let nn = north;
    sampleTerrain(north, east, s);
    if (!(s.standing > s.ground) && s.riverDist <= s.riverHalfWidth + NET_MARGIN && hydrology.queryFlow) {
      hydrology.queryFlow(north, east, hit);
      if (hit.line >= 0 && Number.isFinite(hit.dist)) {
        // Right of the flow is (dirN, -dirE) in (east, north); the point lies `side * dist` that way from the line.
        ee = east - hit.side * hit.dist * hit.dirN;
        nn = north + hit.side * hit.dist * hit.dirE;
      }
    }
    endE.set(j, ee);
    endN.set(j, nn);
  }
  const t2 = performance.now();
  if (stats) {
    stats.cells += N;
    stats.msGround += t1 - t0;
    stats.msTrace += t2 - t1;
  }
  return { gx0, gy0, nx, ny, ground, net, to, cells, areaR, persist, main, toSink, endE, endN };
}

/** A cell's size code: its near catchment (plus `extra` cells), fading below the last cell that starts its line and
 * toward a sink. */
function sizeOf(g: RillGraph, i: number, extra = 0): number {
  let s = rillSize(((g.areaR[i] + extra) * RILL_CELL * RILL_CELL) / 1e6);
  if (g.persist[i] < FADE) s *= g.persist[i] / FADE;
  if (g.toSink[i] <= TAPER) s *= (0.25 + g.toSink[i]) / (TAPER + 0.25);
  return s;
}

/**
 * The rill segments of the channel cells in [x0, x1) x [y0, y1) (window cells; at least EVAL - 2 inside the window's
 * valid part), smoothed and moved onto the gully floor. Each segment runs from a cell to its receiver.
 */
export function rillSegments(g: RillGraph, x0: number, y0: number, x1: number, y1: number, stats?: RillStats): RillSegment[] {
  const t0 = performance.now();
  const { nx, to, main } = g;
  const chan = g.persist;
  const E = (i: number): number => (g.gx0 + (i % nx)) * RILL_CELL;
  const Nn = (i: number): number => (g.gy0 + ((i / nx) | 0)) * RILL_CELL;
  // Smoothing and snapping step along the flow to neighbouring cells only (not over a pit's spill), so what they read
  // stays within a few cells (the window margins count on it).
  const near = (i: number, j: number): boolean => Math.abs((i % nx) - (j % nx)) <= 1 && Math.abs(((i / nx) | 0) - ((j / nx) | 0)) <= 1;
  const up = (i: number): number => (main[i] >= 0 && near(i, main[i]) ? main[i] : -1);
  /** The next cell down the line (a channel cell or the network cell it ends at), -1 none. */
  const down = (i: number): number => (to[i] >= 0 && near(i, to[i]) ? to[i] : -1);
  // Strands: steepest descent on a raster runs two lines down neighbouring cells side by side for hundreds of metres,
  // where the water would have run into one channel. A channel cell beside a bigger line (within MERGE_R cells, not
  // its receiver nor flowing into it) is that line: it is not drawn, a line running into it joins the bigger line
  // there (the confluence), and the bigger line is drawn with the strand's water added (so the trunk below the join
  // is wider than either branch). Bigger: the larger near catchment, ties by cell. Followed to the biggest within
  // MERGE_STEPS (all of it local: the window margins count on it).
  const ar = g.areaR;
  const hid = new Map<number, number>();
  /** Whether b lies on the line down from a within a few steps (the line itself, not a strand beside it). */
  const onLine = (a: number, b: number): boolean => {
    let c = a;
    for (let k = 0; k <= 2 * MERGE_R + 1; k++) {
      const t = to[c];
      if (t < 0 || !near(c, t)) return false;
      if (t === b) return true;
      c = t;
    }
    return false;
  };
  const hider = (i: number): number => {
    const m = hid.get(i);
    if (m !== undefined) return m;
    let best = -1;
    const x = i % nx;
    const y = (i / nx) | 0;
    if (chan[i] && !g.net[i]) {
      for (let dy = -MERGE_R; dy <= MERGE_R; dy++)
        for (let dx = -MERGE_R; dx <= MERGE_R; dx++) {
          if ((dx === 0 && dy === 0) || x + dx < 0 || x + dx >= nx || y + dy < 0 || y + dy >= g.ny) continue;
          const k = i + dy * nx + dx;
          if (!chan[k] || g.net[k] || onLine(i, k) || onLine(k, i)) continue;
          if (ar[k] < ar[i] || (ar[k] === ar[i] && k > i)) continue;
          if (best < 0 || ar[k] > ar[best] || (ar[k] === ar[best] && k < best)) best = k;
        }
    }
    hid.set(i, best);
    return best;
  };
  /** The line a hidden cell is drawn as (itself when not hidden). */
  const root = (i: number): number => {
    let r = i;
    for (let k = 0; k < MERGE_STEPS; k++) {
      const h = hider(r);
      if (h < 0) break;
      r = h;
    }
    return r;
  };
  /** The strands' water a drawn cell carries besides its own: the biggest strand hidden beside it. */
  const extra = (k: number): number => {
    let e = 0;
    const x = k % nx;
    const y = (k / nx) | 0;
    for (let dy = -MERGE_R; dy <= MERGE_R; dy++)
      for (let dx = -MERGE_R; dx <= MERGE_R; dx++) {
        if ((dx === 0 && dy === 0) || x + dx < 0 || x + dx >= nx || y + dy < 0 || y + dy >= g.ny) continue;
        const h = k + dy * nx + dx;
        if (chan[h] && hider(h) === k && ar[h] > e) e = ar[h];
      }
    return e;
  };
  const sizeAt = (i: number): number => sizeOf(g, i, extra(i));
  const atE = (i: number): number => g.endE.get(i) ?? E(i);
  const atN = (i: number): number => g.endN.get(i) ?? Nn(i);
  // Smoothed positions along the flow (weights 1 2 3 2 1 over two cells up the main line and two down).
  const sE = new Map<number, number>();
  const sN = new Map<number, number>();
  const smooth = (i: number): void => {
    if (sE.has(i)) return;
    let we = 3 * E(i);
    let wn = 3 * Nn(i);
    let w = 3;
    const u1 = up(i);
    if (u1 >= 0) {
      we += 2 * E(u1);
      wn += 2 * Nn(u1);
      w += 2;
      const u2 = up(u1);
      if (u2 >= 0) {
        we += E(u2);
        wn += Nn(u2);
        w += 1;
      }
    }
    const d1 = down(i);
    if (d1 >= 0) {
      we += 2 * atE(d1);
      wn += 2 * atN(d1);
      w += 2;
      const d2 = chan[d1] ? down(d1) : -1;
      if (d2 >= 0) {
        we += atE(d2);
        wn += atN(d2);
        w += 1;
      }
    }
    sE.set(i, we / w);
    sN.set(i, wn / w);
  };
  // Snapped: across the flow to the lowest ground within SNAP (a slight pull to stay put).
  const pE = new Map<number, number>();
  const pN = new Map<number, number>();
  const s = scratch;
  const snap = (i: number): void => {
    if (pE.has(i)) return;
    smooth(i);
    const u = up(i);
    const d = down(i);
    let te = 0;
    let tn = 0;
    if (u >= 0) {
      smooth(u);
      te -= sE.get(u)!;
      tn -= sN.get(u)!;
    } else {
      te -= sE.get(i)!;
      tn -= sN.get(i)!;
    }
    if (d >= 0 && chan[d]) {
      smooth(d);
      te += sE.get(d)!;
      tn += sN.get(d)!;
    } else if (d >= 0) {
      te += atE(d);
      tn += atN(d);
    } else {
      te += sE.get(i)!;
      tn += sN.get(i)!;
    }
    const tl = Math.hypot(te, tn) || 1;
    const ae = -tn / tl;
    const an = te / tl;
    const ce = sE.get(i)!;
    const cn = sN.get(i)!;
    let best = Infinity;
    let bo = 0;
    for (let o = -SNAP; o <= SNAP; o += SNAP_STEP) {
      sampleTerrain(cn + an * o, ce + ae * o, s);
      const h = s.ground + 0.02 * Math.abs(o);
      if (h < best) {
        best = h;
        bo = o;
      }
    }
    pE.set(i, ce + ae * bo);
    pN.set(i, cn + an * bo);
  };
  // Final: the snapped points smoothed lightly (1 2 1).
  const fE = new Map<number, number>();
  const fN = new Map<number, number>();
  const final = (i: number): void => {
    if (fE.has(i)) return;
    snap(i);
    let e = 2 * pE.get(i)!;
    let n = 2 * pN.get(i)!;
    let w = 2;
    const u = up(i);
    if (u >= 0) {
      snap(u);
      e += pE.get(u)!;
      n += pN.get(u)!;
      w++;
    }
    const d = down(i);
    if (d >= 0 && chan[d]) {
      snap(d);
      e += pE.get(d)!;
      n += pN.get(d)!;
      w++;
    }
    fE.set(i, e / w);
    fN.set(i, n / w);
  };
  const out: RillSegment[] = [];
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * nx + x;
      if (!chan[i] || hider(i) >= 0) continue;
      let j = to[i];
      final(i);
      const s0 = sizeAt(i);
      // (Into a strand beside a bigger line: on into that line.)
      if (j >= 0 && chan[j] && near(i, j) && hider(j) >= 0) {
        const r = root(j);
        if (r !== i && hider(r) < 0) j = r;
      }
      if (j >= 0 && chan[j]) {
        final(j);
        out.push({ e0: fE.get(i)!, n0: fN.get(i)!, e1: fE.get(j)!, n1: fN.get(j)!, s0, s1: sizeAt(j) });
      } else if (j >= 0) {
        // Into the network: on to the channel's centreline (or the lake's cell).
        out.push({ e0: fE.get(i)!, n0: fN.get(i)!, e1: atE(j), n1: atN(j), s0, s1: s0 });
      }
    }
  if (stats) stats.msLines += performance.now() - t0;
  return out;
}

/** The window a patch is traced over (global cells). */
export function rillWindow(pi: number, pj: number): { gx0: number; gy0: number; n: number } {
  return { gx0: pi * CORE - HALO, gy0: pj * CORE - HALO, n: CORE + 2 * HALO + 1 };
}

/** Encode one texel: (vector east, north to the nearest line point; its distance; the line's size code there). */
function encode(out: Uint8Array, o: number, ve: number, vn: number, d: number, size: number): void {
  out[o] = Math.round(127.5 + (127.5 * Math.max(-RILL_RANGE, Math.min(RILL_RANGE, ve))) / RILL_RANGE);
  out[o + 1] = Math.round(127.5 + (127.5 * Math.max(-RILL_RANGE, Math.min(RILL_RANGE, vn))) / RILL_RANGE);
  out[o + 2] = Math.round((255 * Math.min(RILL_RANGE, d)) / RILL_RANGE);
  out[o + 3] = Math.round(255 * Math.min(1, Math.max(0, size)));
}

/** Rasterise segments into a patch's texels (RILL_TEX², with the apron). Null when no texel is in reach of a line. */
export function rasteriseRills(pi: number, pj: number, segs: ReadonlyArray<RillSegment>): Uint8Array | null {
  const T = RILL_TEX;
  const e0 = pi * RILL_PATCH - 1.5 * RILL_TEXEL;
  const n0 = pj * RILL_PATCH - 1.5 * RILL_TEXEL;
  // Texel k's centre is pi * RILL_PATCH + (k - 0.5) * RILL_TEXEL (k = 0 the apron): e0 + (k + 1) * RILL_TEXEL.
  const best = new Float32Array(T * T).fill(RILL_RANGE * RILL_RANGE);
  const out = new Uint8Array(T * T * 4);
  let any = false;
  for (let k = 0; k < T * T; k++) encode(out, k * 4, RILL_RANGE, RILL_RANGE, RILL_RANGE, 0);
  for (const sg of segs) {
    const lo = (v: number, o: number): number => Math.max(0, Math.floor((v - RILL_RANGE - o) / RILL_TEXEL - 1));
    const hi = (v: number, o: number): number => Math.min(T - 1, Math.ceil((v + RILL_RANGE - o) / RILL_TEXEL + 1));
    const ka = lo(Math.min(sg.e0, sg.e1), e0 + RILL_TEXEL);
    const kb = hi(Math.max(sg.e0, sg.e1), e0 + RILL_TEXEL);
    const la = lo(Math.min(sg.n0, sg.n1), n0 + RILL_TEXEL);
    const lb = hi(Math.max(sg.n0, sg.n1), n0 + RILL_TEXEL);
    if (ka > kb || la > lb) continue;
    const de = sg.e1 - sg.e0;
    const dn = sg.n1 - sg.n0;
    const l2 = de * de + dn * dn || 1e-9;
    for (let l = la; l <= lb; l++) {
      const tn = n0 + (l + 1) * RILL_TEXEL;
      for (let k = ka; k <= kb; k++) {
        const te = e0 + (k + 1) * RILL_TEXEL;
        const t = Math.max(0, Math.min(1, ((te - sg.e0) * de + (tn - sg.n0) * dn) / l2));
        const qe = sg.e0 + de * t;
        const qn = sg.n0 + dn * t;
        const d2 = (qe - te) ** 2 + (qn - tn) ** 2;
        const idx = l * T + k;
        if (d2 >= best[idx]) continue;
        best[idx] = d2;
        encode(out, idx * 4, qe - te, qn - tn, Math.sqrt(d2), sg.s0 + (sg.s1 - sg.s0) * t);
        any = true;
      }
    }
  }
  return any ? out : null;
}

/** Texel k's centre east of a patch's west edge, m (k = 0 is the apron). */
export const rillTexelCentre = (k: number): number => (k - 0.5) * RILL_TEXEL;

/** Build one patch (in a terrain worker). `lo` and `hi` widen the window (cells, west and south, east and north) for the
 * tests: the texels must not change. */
export function buildRillPatch(req: RillPatchRequest, lo = 0, hi = 0): RillPatchData {
  const stats: RillStats = { cells: 0, sampled: 0, channelCells: 0, km: 0, wetKm: 0, toNetwork: 0, toSink: 0, msGround: 0, msTrace: 0, msLines: 0, msRaster: 0 };
  if (!hydrology.queryFlow) return { kind: 'rills', pi: req.pi, pj: req.pj, texels: null, stats };
  const w = rillWindow(req.pi, req.pj);
  const h = HALO + lo;
  const n = w.n + lo + hi;
  // Lines from the cells near the core (a line's texels reach RILL_RANGE beyond it; a spill segment SPILL_R cells).
  const a = h - SEG_M;
  const b = h + CORE + SEG_M + 1;
  const g = traceRillGraph(w.gx0 - lo, w.gy0 - lo, n, n, a, a, b, b, stats);
  const segs = rillSegments(g, a, a, b, b, stats);
  const t0 = performance.now();
  const texels = rasteriseRills(req.pi, req.pj, segs);
  stats.msRaster = performance.now() - t0;
  // Core statistics.
  const e0 = req.pi * RILL_PATCH;
  const n0 = req.pj * RILL_PATCH;
  const wet = rillSize(RILL_WET_AREA);
  for (const s of segs) {
    const me = (s.e0 + s.e1) / 2;
    const mn = (s.n0 + s.n1) / 2;
    if (me < e0 || me >= e0 + RILL_PATCH || mn < n0 || mn >= n0 + RILL_PATCH) continue;
    const l = Math.hypot(s.e1 - s.e0, s.n1 - s.n0) / 1000;
    stats.km += l;
    if ((s.s0 + s.s1) / 2 > wet) stats.wetKm += l;
  }
  for (let y = h; y < h + CORE; y++)
    for (let x = h; x < h + CORE; x++) {
      const i = y * g.nx + x;
      if (!g.persist[i]) continue;
      stats.channelCells++;
      const j = g.to[i];
      if (j === -2) stats.toSink++;
      else if (j >= 0 && g.net[j]) stats.toNetwork++;
    }
  return { kind: 'rills', pi: req.pi, pj: req.pj, texels, stats };
}
