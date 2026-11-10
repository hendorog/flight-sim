// The gully network of a seeded world's mountains (foundation streams, out/fs/REPORT.md): the threshold hillslopes'
// own routing (hillslopes.ts SlopeField.dir, the steepest descent over the ground the pass built, on the 250 m fine
// grid) with its catchment summed down it. Every V the pass cut runs along it, so the water does too:
//   - streams.ts starts a traced stream (a ribbon, its channel carved) where the pass makes a chain a channel (its
//     channel-head catchment, hillslopes.ts SlopeParams.ac: the V begins there) and follows the chain down, sized by
//     the chain's own catchment;
//   - rills.ts reads a chain's catchment for a rill whose catchment reaches beyond its window (it would otherwise be
//     drawn at its window's cap), so the painted streams are sized as the ribbons are;
//   - placement.ts keeps trees off the beds of the bigger painted ones.
// Pure (no three.js). Built in every thread from the slopes' fields (about 30 ms); null where a world has none (seed 0,
// a narrow orogen's seeds).

import type { SlopeField } from './hillslopes';
import { SLOPE_DI, SLOPE_DJ } from './hillslopes';
import { DOMAIN_HALF, LAKE_RASTER } from './drainage';

export interface GullyNet {
  /** Nodes per side, spacing (m) and the south-west node (north, east) of the fine grid. */
  n: number;
  cell: number;
  origin: number;
  /** SlopeField.dir: 1 + the receiver's direction at each node the pass built, 0 elsewhere. */
  dir: Uint8Array;
  /** Catchment through each node the pass built, km² (its own cell and every node draining to it), 0 elsewhere. */
  area: Float32Array;
  /** SlopeField.floor: the nodes on a model's floor (the pass's fixed base level), 255. */
  floor: Uint8Array;
  /** SlopeField.h: the ground the pass built, m. */
  h: Float32Array;
}

let lastSlopes: SlopeField | null = null;
let lastNet: GullyNet | null = null;

/** The receiver of node q (-1: none, the pass did not build it). */
export function receiverOf(g: GullyNet, q: number): number {
  const d = g.dir[q];
  if (!d) return -1;
  return q + SLOPE_DI[d - 1] * g.n + SLOPE_DJ[d - 1];
}

/** Build the network from the slopes' fields (once per field: the same object hands back the same network). */
export function gullyNetOf(sl: SlopeField | null | undefined): GullyNet | null {
  if (!sl || !sl.dir) return null;
  if (sl === lastSlopes) return lastNet;
  const n = Math.round(Math.sqrt(sl.h.length));
  const N = n * n;
  const dir = sl.dir;
  const cellKm2 = (LAKE_RASTER / 1000) ** 2;
  // (The pass summed it already when it built the field here; a field from the cache sums it again.)
  if (sl.area && sl.area.length === N) {
    lastSlopes = sl;
    lastNet = { n, cell: LAKE_RASTER, origin: -DOMAIN_HALF, dir, area: sl.area, floor: sl.floor, h: sl.h };
    return lastNet;
  }
  const area = new Float32Array(N);
  // Donor counts, then a queue from the nodes no node drains to (Kahn): every node's catchment before its receiver's.
  const indeg = new Uint8Array(N);
  let built = 0;
  for (let q = 0; q < N; q++) {
    const d = dir[q];
    if (!d) continue;
    built++;
    area[q] = cellKm2;
    const r = q + SLOPE_DI[d - 1] * n + SLOPE_DJ[d - 1];
    if (dir[r]) indeg[r]++;
  }
  const queue = new Int32Array(built);
  let tail = 0;
  for (let q = 0; q < N; q++) if (dir[q] && indeg[q] === 0) queue[tail++] = q;
  for (let head = 0; head < tail; head++) {
    const q = queue[head];
    const d = dir[q];
    const r = q + SLOPE_DI[d - 1] * n + SLOPE_DJ[d - 1];
    if (!dir[r]) continue;
    area[r] += area[q];
    if (--indeg[r] === 0) queue[tail++] = r;
  }
  lastSlopes = sl;
  lastNet = { n, cell: LAKE_RASTER, origin: -DOMAIN_HALF, dir, area, floor: sl.floor, h: sl.h };
  return lastNet;
}

/** The current world's network (heightfield.ts sets it once the slopes are attached; null without them). */
let current: GullyNet | null = null;
export function setGullyNet(g: GullyNet | null): void {
  current = g;
}
export const gullyNet = (): GullyNet | null => current;

/** Where a point lies by the network's chains (gullyNear). */
export interface GullyHit {
  /** Distance to the nearest chain segment (a node to its receiver) of at least the asked catchment, m (Infinity: none
   * within reach). */
  dist: number;
  /** Catchment there, km² (the segment's upper node's: what runs along it). */
  area: number;
  /** The segment's upper node (-1 none) and how far along it the nearest point is (0-1). */
  node: number;
  t: number;
}

/**
 * The nearest chain segment (a node to its receiver) draining at least `minArea` km² to (north, east), within `reach`
 * m (at most a node spacing: the segments from the nodes within two of the point's cell are looked at).
 */
export function gullyNear(g: GullyNet, north: number, east: number, minArea: number, reach: number, out: GullyHit): GullyHit {
  out.dist = Infinity;
  out.area = 0;
  out.node = -1;
  out.t = 0;
  const fy = (north - g.origin) / g.cell;
  const fx = (east - g.origin) / g.cell;
  const y0 = Math.floor(fy);
  const x0 = Math.floor(fx);
  const n = g.n;
  if (y0 < 2 || x0 < 2 || y0 > n - 4 || x0 > n - 4) return out;
  let best = reach * reach;
  for (let y = y0 - 1; y <= y0 + 2; y++)
    for (let x = x0 - 1; x <= x0 + 2; x++) {
      const q = y * n + x;
      const d = g.dir[q];
      if (!d || g.area[q] < minArea) continue;
      const by = y + SLOPE_DI[d - 1];
      const bx = x + SLOPE_DJ[d - 1];
      const ay = (y - fy) * g.cell;
      const ax = (x - fx) * g.cell;
      const dy = (by - y) * g.cell;
      const dx = (bx - x) * g.cell;
      const l2 = dy * dy + dx * dx;
      const t = Math.max(0, Math.min(1, -(ay * dy + ax * dx) / l2));
      const qy = ay + dy * t;
      const qx = ax + dx * t;
      const d2 = qy * qy + qx * qx;
      if (d2 < best) {
        best = d2;
        out.dist = Math.sqrt(d2);
        out.area = g.area[q];
        out.node = q;
        out.t = t;
      }
    }
  return out;
}

/** Whether chain node q runs in a V the pass cut: the slopes' ground a node either side across its flow stands at least
 * `rise` m over it (on a valley's floor, where the routing runs straight along the lattice, it does not). */
export function inV(g: GullyNet, q: number, rise = 10): boolean {
  const d = g.dir[q];
  if (!d) return false;
  const di = SLOPE_DI[d - 1];
  const dj = SLOPE_DJ[d - 1];
  const a = q + dj * g.n - di;
  const b = q - dj * g.n + di;
  if (a < 0 || b < 0 || a >= g.h.length || b >= g.h.length) return false;
  return g.h[a] - g.h[q] > rise && g.h[b] - g.h[q] > rise;
}
