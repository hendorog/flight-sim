// The regional road network (present day): sealed roads joining the valley town and the villages around it, and a
// few gravel links, routed over the land at bake time (roadPlanner.ts) and loaded from roadNetwork.ts. The ground
// shader paints them (ROADS_GLSL, from the tables roadTables() packs), and the land cover keeps fields, hedges,
// shelterbelts and trees off the carriageway and its verges (queryRoad / onRoadVerge). Roads run down into the river
// where they cross it until the bridges are built (ROAD_NETWORK.crossings).
//
// Pure and three.js-free (runs in the workers).

import { isPresent } from '../era/eraState';
import { PolylineIndex, type PolylineNear } from './hydrology';
import { decodePolyline } from './meander';
import { ROAD_NETWORK } from './roadNetwork';

export const ROAD_KIND_SEALED = 0;
export const ROAD_KIND_GRAVEL = 1;
/** Half the carriageway, m, by kind: a two-lane sealed road 7 m wide, a gravel road 5 m. */
export const ROAD_HALF_WIDTH: readonly number[] = [3.5, 2.5];
/** The mown verge beyond the carriageway on each side, m: no crops, hedges or trees on it. */
export const ROAD_VERGE = 4;
/** Most villages the ground shader takes (uVillage). */
export const VILLAGE_MAX = 8;
/** A village's built-up radius, m. */
export const VILLAGE_RADIUS = 220;
/** The CPU index answers within this distance of a road's centre line, m. */
const REACH = 40;
const INDEX_CELL = 128;
/** The shader's tables: cell size, and how far beyond a road's centre line a cell lists it, m (the verge, and the
 * footprint of a distant pixel, which still shows a road its centre misses). */
const GPU_CELL = 128;
const GPU_REACH = 40;
const TABLE_WIDTH = 1024;

interface Network {
  lines: { north: Float64Array; east: Float64Array }[];
  kind: number[];
  /** Distance along each line at each vertex, m. */
  along: Float64Array[];
  index: PolylineIndex;
}

let net: Network | null = null;
function network(): Network {
  if (net) return net;
  const lines = ROAD_NETWORK.roads.map((r) => decodePolyline(r.line));
  const along = lines.map((l) => {
    const s = new Float64Array(l.north.length);
    for (let i = 1; i < s.length; i++) s[i] = s[i - 1] + Math.hypot(l.north[i] - l.north[i - 1], l.east[i] - l.east[i - 1]);
    return s;
  });
  net = { lines, kind: ROAD_NETWORK.roads.map((r) => r.kind), along, index: new PolylineIndex(lines, REACH, INDEX_CELL) };
  return net;
}

export interface RoadHit {
  /** Distance from the nearest road's centre line, m. */
  dist: number;
  halfWidth: number;
  kind: number;
  /** Distance along that road, m. */
  along: number;
}

export function makeRoadHit(): RoadHit {
  return { dist: Infinity, halfWidth: 0, kind: 0, along: 0 };
}

const near: PolylineNear = { line: 0, seg: 0, t: 0, u: 0, dist: Infinity, side: 0 };

/** The nearest regional road within 40 m (present day only); false, with dist Infinity, when there is none. */
export function queryRoad(north: number, east: number, out: RoadHit): boolean {
  out.dist = Infinity;
  if (!isPresent() || ROAD_NETWORK.roads.length === 0) return false;
  const n = network();
  if (!n.index.nearest(north, east, near) || near.dist > REACH) return false;
  const s = n.along[near.line];
  out.dist = near.dist;
  out.kind = n.kind[near.line];
  out.halfWidth = ROAD_HALF_WIDTH[out.kind];
  out.along = s[near.seg] + (s[near.seg + 1] - s[near.seg]) * near.t;
  return true;
}

const hit = makeRoadHit();
/** True on a road or its verge, or within `margin` m beyond the verge (present day only). */
export function onRoadVerge(north: number, east: number, margin = 0): boolean {
  return queryRoad(north, east, hit) && hit.dist < hit.halfWidth + ROAD_VERGE + margin;
}

/** The roads' centre lines (present day only; none in other eras). */
export function regionalRoads(): ReadonlyArray<{ north: Float64Array; east: Float64Array }> {
  return isPresent() && ROAD_NETWORK.roads.length ? network().lines : [];
}

/** Each road's kind, in regionalRoads() order. */
export function regionalRoadKinds(): readonly number[] {
  return isPresent() && ROAD_NETWORK.roads.length ? network().kind : [];
}

/** Where the roads cross the river (present day only): the point and the road's bearing there, rad from north. */
export function riverCrossings(): ReadonlyArray<{ north: number; east: number; bearing: number }> {
  return isPresent() ? ROAD_NETWORK.crossings : [];
}

/** The villages (present day only; none in other eras). */
export function villageSites(): ReadonlyArray<{ north: number; east: number; radius: number }> {
  return isPresent() ? ROAD_NETWORK.villages : [];
}

/** The shader's tables (see ROADS_GLSL), as float texels. */
export interface RoadTables {
  /** Two RGBA texels a segment: (east, north) of its ends; (half width, kind, distance along at its start, 0). */
  seg: Float32Array;
  segRows: number;
  /** One RG texel a cell, row-major from the south-west: (first entry in the list, entries). */
  cell: Float32Array;
  cols: number;
  rows: number;
  /** One R texel an entry: a segment number. */
  list: Float32Array;
  listRows: number;
  /** World east and north of the grid's south-west corner, m, and the cell size. */
  east0: number;
  north0: number;
  cellSize: number;
  width: number;
}

export function roadTables(): RoadTables {
  const n = network();
  const segs: number[] = [];
  let e0 = Infinity;
  let n0 = Infinity;
  let e1 = -Infinity;
  let n1 = -Infinity;
  n.lines.forEach((l, li) => {
    for (let i = 0; i + 1 < l.north.length; i++) {
      segs.push(l.east[i], l.north[i], l.east[i + 1], l.north[i + 1], ROAD_HALF_WIDTH[n.kind[li]], n.kind[li], n.along[li][i], 0);
      e0 = Math.min(e0, l.east[i], l.east[i + 1]);
      e1 = Math.max(e1, l.east[i], l.east[i + 1]);
      n0 = Math.min(n0, l.north[i], l.north[i + 1]);
      n1 = Math.max(n1, l.north[i], l.north[i + 1]);
    }
  });
  const count = segs.length / 8;
  if (count === 0) {
    return { seg: new Float32Array(8), segRows: 1, cell: new Float32Array(2), cols: 1, rows: 1, list: new Float32Array(1), listRows: 1, east0: 0, north0: 0, cellSize: GPU_CELL, width: 1 };
  }
  e0 = Math.floor((e0 - GPU_REACH) / GPU_CELL) * GPU_CELL;
  n0 = Math.floor((n0 - GPU_REACH) / GPU_CELL) * GPU_CELL;
  const cols = Math.ceil((e1 + GPU_REACH - e0) / GPU_CELL);
  const rows = Math.ceil((n1 + GPU_REACH - n0) / GPU_CELL);
  const lists: number[][] = Array.from({ length: cols * rows }, () => []);
  for (let s = 0; s < count; s++) {
    const o = s * 8;
    const ca = Math.floor((Math.min(segs[o], segs[o + 2]) - GPU_REACH - e0) / GPU_CELL);
    const cb = Math.floor((Math.max(segs[o], segs[o + 2]) + GPU_REACH - e0) / GPU_CELL);
    const ra = Math.floor((Math.min(segs[o + 1], segs[o + 3]) - GPU_REACH - n0) / GPU_CELL);
    const rb = Math.floor((Math.max(segs[o + 1], segs[o + 3]) + GPU_REACH - n0) / GPU_CELL);
    for (let r = Math.max(0, ra); r <= Math.min(rows - 1, rb); r++)
      for (let c = Math.max(0, ca); c <= Math.min(cols - 1, cb); c++) {
        // Only cells the segment's band actually reaches.
        if (segBoxDistance(segs, o, e0 + c * GPU_CELL, n0 + r * GPU_CELL, GPU_CELL) <= GPU_REACH) lists[r * cols + c].push(s);
      }
  }
  const cell = new Float32Array(cols * rows * 2);
  const flat: number[] = [];
  lists.forEach((l, k) => {
    cell[k * 2] = flat.length;
    cell[k * 2 + 1] = l.length;
    flat.push(...l);
  });
  const W = TABLE_WIDTH;
  const segRows = Math.ceil((count * 2) / W);
  const seg = new Float32Array(segRows * W * 4);
  seg.set(segs);
  const listRows = Math.max(1, Math.ceil(flat.length / W));
  const list = new Float32Array(listRows * W);
  list.set(flat);
  return { seg, segRows, cell, cols, rows, list, listRows, east0: e0, north0: n0, cellSize: GPU_CELL, width: W };
}

/** Distance from a segment (east, north ends at segs[o..o+3]) to an axis-aligned square, m (0 if they meet). */
function segBoxDistance(segs: readonly number[], o: number, e: number, n: number, size: number): number {
  // Sample the segment finely enough for a 128 m box and a band of a few metres.
  const steps = Math.max(1, Math.ceil(Math.hypot(segs[o + 2] - segs[o], segs[o + 3] - segs[o + 1]) / 4));
  let best = Infinity;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const pe = segs[o] + (segs[o + 2] - segs[o]) * t;
    const pn = segs[o + 1] + (segs[o + 3] - segs[o + 1]) * t;
    const de = Math.max(e - pe, 0, pe - (e + size));
    const dn = Math.max(n - pn, 0, pn - (n + size));
    best = Math.min(best, Math.hypot(de, dn));
  }
  return best;
}

/** Most entries a shader cell walks (cells near junctions list a few roads' segments). */
export const ROAD_CELL_MAX = 48;

/**
 * GLSL: roadAt(east, north) -> (distance from the nearest road's centre line within the tables' reach, else 1e4;
 * its half width; kind; distance along it), from tRoadSeg / tRoadCell / tRoadList and uRoadGrid (east0, north0,
 * 1 / cell size, 0).
 */
export const ROADS_GLSL = /* glsl */ `
uniform highp sampler2D tRoadSeg;
uniform highp sampler2D tRoadCell;
uniform highp sampler2D tRoadList;
uniform vec4 uRoadGrid;
vec4 roadAt(vec2 ne) {
  vec4 best = vec4(1e4, 0.0, 0.0, 0.0);
  ivec2 gs = textureSize(tRoadCell, 0);
  ivec2 c = ivec2(floor((ne - uRoadGrid.xy) * uRoadGrid.z));
  if (c.x < 0 || c.y < 0 || c.x >= gs.x || c.y >= gs.y) return best;
  vec2 oc = texelFetch(tRoadCell, c, 0).rg;
  int first = int(oc.x);
  int cnt = int(oc.y);
  int w = ${TABLE_WIDTH};
  for (int k = 0; k < ${ROAD_CELL_MAX}; k++) {
    if (k >= cnt) break;
    int li = first + k;
    int s = int(texelFetch(tRoadList, ivec2(li % w, li / w), 0).r) * 2;
    vec4 ab = texelFetch(tRoadSeg, ivec2(s % w, s / w), 0);
    vec2 d = ab.zw - ab.xy;
    float u = clamp(dot(ne - ab.xy, d) / max(dot(d, d), 1e-6), 0.0, 1.0);
    float dist = length(ne - ab.xy - d * u);
    if (dist < best.x) {
      vec4 m = texelFetch(tRoadSeg, ivec2((s + 1) % w, (s + 1) / w), 0);
      best = vec4(dist, m.x, m.y, m.z + u * length(d));
    }
  }
  return best;
}
`;
