// The regional road network, planned at bake time only (tests/terrain/roadNetwork.test.ts; FS_ROAD_BAKE=1 writes
// roadNetwork.ts, which is what the game loads). Villages are sited like the valley town (flat, dry ground off the
// floodplain, outside woods and forestry estates, clear of the airfield and its approaches, a few km apart); the
// town and the villages are then joined into a tree by growing the network outward from the town one village at a
// time (each new road runs from the village to the cheapest point of the network so far, so roads meet at T
// junctions rather than running side by side), and a couple of gravel links close loops where the tree makes a
// long detour. Every road follows the cheapest route over a 40 m cost grid: length, grade (squared, and very dear
// above 14 %), woods, standing water, and a heavy charge for each river crossing (bridges come later); the
// airfield, its approaches and the town's interior are out of bounds. The cell paths are simplified and rounded
// off (Chaikin) into the polylines that are baked.
//
// Pure and three.js-free apart from the town site and its frame (src/world/airport), not imported at run time.

import { nearAirport, findTownSite, TOWN_RADIUS } from '../airport/valley';
import { rng } from '../airport/noise';
import { seeded } from '../worldSeed';
import { computeBiome, coverShape, makeBiome, makeCoverShape } from './biome';
import { hydrology, makeSample, sampleTerrain, terrainHeight } from './heightfield';
import { encodePolyline } from './meander';
import { estateWeight } from './plantation';
import { setTownSite } from './townMask';
import { ROAD_KIND_GRAVEL, ROAD_KIND_SEALED, VILLAGE_RADIUS } from './roads';

/** Villages to site, and the ring around the field they are sited in, m. */
export const VILLAGE_COUNT = 5;
const VILLAGE_RING: readonly [number, number] = [4500, 14500];
/** Villages keep this far from each other and from the town centre, m. */
const VILLAGE_SPACING = 4200;
/** Cost grid cell, m. */
const CELL = 40;
/** The grid reaches this far beyond the outermost settlement, m. */
const GRID_MARGIN = 2500;
/** Grade cost: a grade of GRADE_REF doubles the cost of a metre; above GRADE_MAX it is all but forbidden. */
const GRADE_REF = 0.06;
const GRADE_MAX = 0.14;
/** Extra cost of a river crossing, and of a cell of standing water or of woodland (per metre), m-equivalent. */
const CROSSING_COST = 4000;
const WATER_COST = 40;
const FOREST_COST = 0.8;
/** Gravel links: at most this many, each where the network detour is this many times the straight distance. */
const LOOP_LINKS = 2;
const LOOP_DETOUR = 1.8;

export interface PlannedNetwork {
  villages: { north: number; east: number; radius: number }[];
  roads: { kind: number; line: string }[];
  /** Where a road crosses the river (stage 3 bridges): the point and the road's bearing there, rad from north. */
  crossings: { north: number; east: number; bearing: number }[];
}

interface Pt {
  n: number;
  e: number;
}

/** The valley town's centre, radius and street frame (valley.ts buildValley draws its first random number for it). */
function townFrame(): { north: number; east: number; radius: number; angle: number } | null {
  const t = findTownSite(terrainHeight);
  if (!t) return null;
  return { north: t.north, east: t.east, radius: TOWN_RADIUS, angle: rng(seeded(4242))() * Math.PI };
}

export function planRoadNetwork(): PlannedNetwork {
  const town = townFrame();
  setTownSite(town);
  const sample = makeSample();
  const shape = makeCoverShape();
  const biome = makeBiome();
  const valleyHit = { dist: 0, level: 0, floodplain: 0 };
  const forestAt = (n: number, e: number): number => {
    sampleTerrain(n, e, sample);
    coverShape(n, e, sample.ground, shape);
    return computeBiome(n, e, sample, shape.up, biome, shape.north).forest;
  };
  const slope = (n: number, e: number, s: number): number =>
    Math.hypot(terrainHeight(n + s, e) - terrainHeight(n - s, e), terrainHeight(n, e + s) - terrainHeight(n, e - s)) / (2 * s);

  // --- Villages: the best-scoring candidates on a 400 m lattice, greedily, spaced apart.
  const cands: { n: number; e: number; score: number }[] = [];
  for (let n = -VILLAGE_RING[1]; n <= VILLAGE_RING[1]; n += 400) {
    for (let e = -VILLAGE_RING[1]; e <= VILLAGE_RING[1]; e += 400) {
      const d = Math.hypot(n, e);
      if (d < VILLAGE_RING[0] || d > VILLAGE_RING[1] || nearAirport(n, e, 1500)) continue;
      if (town && Math.hypot(n - town.north, e - town.east) < VILLAGE_SPACING) continue;
      hydrology.queryValley(n, e, valleyHit);
      if (valleyHit.dist < valleyHit.floodplain + 300) continue;
      sampleTerrain(n, e, sample);
      if (sample.ground > 700 || sample.approach > 0 || sample.airportBlend < 1) continue;
      if (estateWeight(e, n, sample.ground) > 0.15) continue;
      let s = 0;
      let wet = 0;
      let wood = 0;
      for (let j = 0; j < 9; j++) {
        const b = (j / 9) * Math.PI * 2;
        const rr = j === 0 ? 0 : VILLAGE_RADIUS + 80;
        const pn = n + Math.cos(b) * rr;
        const pe = e + Math.sin(b) * rr;
        s += slope(pn, pe, 30);
        sampleTerrain(pn, pe, sample);
        if (sample.ground < Math.max(sample.standing, sample.river) + 2) wet++;
        wood += forestAt(pn, pe);
      }
      if (wet > 0 || wood / 9 > 0.3) continue;
      cands.push({ n, e, score: s / 9 + 0.15 * (wood / 9) + d / 250000 });
    }
  }
  cands.sort((a, b) => a.score - b.score);
  // One village a sector round the field first (so they spread round it rather than bunch on the best ground),
  // then the best of the rest.
  const villages: Pt[] = [];
  const sectorOf = (c: Pt): number => Math.floor(((Math.atan2(c.e, c.n) + 2 * Math.PI) % (2 * Math.PI)) / ((2 * Math.PI) / VILLAGE_COUNT));
  const spaced = (c: Pt): boolean => villages.every((v) => Math.hypot(v.n - c.n, v.e - c.e) >= VILLAGE_SPACING);
  const filled = new Set<number>();
  for (const c of cands) {
    if (villages.length >= VILLAGE_COUNT) break;
    if (filled.has(sectorOf(c)) || !spaced(c)) continue;
    filled.add(sectorOf(c));
    villages.push({ n: c.n, e: c.e });
  }
  for (const c of cands) {
    if (villages.length >= VILLAGE_COUNT) break;
    if (spaced(c)) villages.push({ n: c.n, e: c.e });
  }

  // --- Cost grid over the settlements.
  const pts = [...villages, ...(town ? [{ n: town.north, e: town.east }] : [])];
  const n0 = Math.min(...pts.map((p) => p.n)) - GRID_MARGIN;
  const e0 = Math.min(...pts.map((p) => p.e)) - GRID_MARGIN;
  const rows = Math.ceil((Math.max(...pts.map((p) => p.n)) + GRID_MARGIN - n0) / CELL) + 1;
  const cols = Math.ceil((Math.max(...pts.map((p) => p.e)) + GRID_MARGIN - e0) / CELL) + 1;
  const count = rows * cols;
  const height = new Float32Array(count);
  const side = new Int8Array(count);
  const extra = new Float32Array(count);
  const blocked = new Uint8Array(count);
  const cellN = (k: number): number => n0 + Math.floor(k / cols) * CELL;
  const cellE = (k: number): number => e0 + (k % cols) * CELL;
  const cellAt = (n: number, e: number): number => {
    const r = Math.min(rows - 1, Math.max(0, Math.round((n - n0) / CELL)));
    const c = Math.min(cols - 1, Math.max(0, Math.round((e - e0) / CELL)));
    return r * cols + c;
  };
  for (let k = 0; k < count; k++) {
    const n = cellN(k);
    const e = cellE(k);
    sampleTerrain(n, e, sample);
    height[k] = sample.ground;
    side[k] = Number.isFinite(sample.riverDist) && sample.riverDist < 400 ? (sample.riverSigned >= 0 ? 1 : -1) : 0;
    if (sample.airportBlend < 1 || sample.approach > 0 || nearAirport(n, e, 60)) blocked[k] = 1;
    if (town) {
      const dt = Math.hypot(n - town.north, e - town.east);
      if (dt < town.radius - 60) blocked[k] = 1;
      else if (dt < town.radius + 150) extra[k] += 2;
    }
    if (blocked[k]) continue;
    const wet = sample.ground < Math.max(sample.standing, sample.river) + 0.3;
    coverShape(n, e, sample.ground, shape);
    extra[k] += FOREST_COST * computeBiome(n, e, sample, shape.up, biome, shape.north).forest + (wet ? WATER_COST : 0);
  }

  // 16-neighbour moves (the knight's moves too, so routes are not confined to eight headings).
  const moves: [number, number][] = [];
  for (let dr = -2; dr <= 2; dr++)
    for (let dc = -2; dc <= 2; dc++) {
      if ((dr === 0 && dc === 0) || (Math.abs(dr) === 2 && Math.abs(dc) !== 1) || (Math.abs(dc) === 2 && Math.abs(dr) !== 1)) continue;
      moves.push([dr, dc]);
    }
  const stepCost = (a: number, b: number, len: number): number => {
    const grade = Math.abs(height[b] - height[a]) / len;
    let c = len * (1 + (grade / GRADE_REF) ** 2 + 0.5 * (extra[a] + extra[b]));
    if (grade > GRADE_MAX) c += len * 60;
    if (side[a] !== 0 && side[b] !== 0 && side[a] !== side[b]) c += CROSSING_COST;
    return c;
  };

  // Dijkstra from a set of source cells (cost 0) over the grid; returns the cost and predecessor of every cell.
  // `only` restricts the search to those cells (plain length then).
  const dist = new Float64Array(count);
  const prev = new Int32Array(count);
  const search = (sources: Iterable<number>, only?: Uint8Array): void => {
    dist.fill(Infinity);
    prev.fill(-1);
    const heap = new MinHeap();
    for (const s of sources) {
      dist[s] = 0;
      heap.push(s, 0);
    }
    while (heap.size > 0) {
      const [k, d] = heap.pop();
      if (d > dist[k]) continue;
      const r = Math.floor(k / cols);
      const c = k % cols;
      for (const [dr, dc] of moves) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        const j = rr * cols + cc;
        if (blocked[j]) continue;
        if (only && !only[j]) continue;
        const len = CELL * Math.hypot(dr, dc);
        const nd = d + (only ? len : stepCost(k, j, len));
        if (nd < dist[j]) {
          dist[j] = nd;
          prev[j] = k;
          heap.push(j, nd);
        }
      }
    }
  };
  const trace = (from: number): number[] => {
    const path = [from];
    for (let k = prev[from]; k >= 0; k = prev[k]) path.push(k);
    return path;
  };

  // --- The network so far: its cells (a road's cells and their neighbours) and its smoothed polylines.
  const onNet = new Uint8Array(count);
  const lines: { kind: number; n: number[]; e: number[] }[] = [];
  const mark = (path: readonly number[]): void => {
    for (const k of path) {
      const r = Math.floor(k / cols);
      const c = k % cols;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && cc >= 0 && rr < rows && cc < cols) onNet[rr * cols + cc] = 1;
        }
    }
  };
  /** The nearest point on the network's polylines (or a fixed anchor) to a point. */
  const anchors: Pt[] = [];
  const snap = (p: Pt): Pt => {
    let best = { n: p.n, e: p.e };
    let bd = Infinity;
    for (const a of anchors) {
      const d = Math.hypot(a.n - p.n, a.e - p.e);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    for (const l of lines)
      for (let i = 0; i + 1 < l.n.length; i++) {
        const q = closest(p, { n: l.n[i], e: l.e[i] }, { n: l.n[i + 1], e: l.e[i + 1] });
        const d = Math.hypot(q.n - p.n, q.e - p.e);
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
    return best;
  };
  /** Lay a road along a cell path, from an exact start to an exact end point. */
  const lay = (path: readonly number[], start: Pt, end: Pt, kind: number): void => {
    const raw: Pt[] = [start, ...path.slice(1, -1).map((k) => ({ n: cellN(k), e: cellE(k) })), end];
    const line = resample(chaikin(simplify(raw, 14), 4), 0.25);
    lines.push({ kind, n: line.map((p) => p.n), e: line.map((p) => p.e) });
    mark(path);
  };

  // The town's four exits: the ends of its two main streets (valley.ts), where the old through road began.
  const exits: Pt[] = [];
  if (town) {
    const ca = Math.cos(town.angle);
    const sa = Math.sin(town.angle);
    for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const r = town.radius - 30;
      exits.push({ n: town.north + r * (x * ca - y * sa), e: town.east + r * (x * sa + y * ca) });
    }
  }
  const sources = new Set<number>();
  for (const x of exits) {
    sources.add(cellAt(x.n, x.e));
    blocked[cellAt(x.n, x.e)] = 0;
    anchors.push(x);
  }
  const exitAt = (k: number): Pt | undefined => exits.find((x) => cellAt(x.n, x.e) === k);

  // --- Tree: grow from the town, cheapest village first (with no town, from the first village).
  const joined = new Array<boolean>(villages.length).fill(false);
  if (sources.size === 0 && villages.length) {
    joined[0] = true;
    sources.add(cellAt(villages[0].n, villages[0].e));
    anchors.push(villages[0]);
  }
  for (;;) {
    search(sources);
    let pick = -1;
    for (let i = 0; i < villages.length; i++) {
      if (joined[i]) continue;
      const k = cellAt(villages[i].n, villages[i].e);
      if (pick < 0 || dist[k] < dist[cellAt(villages[pick].n, villages[pick].e)]) pick = i;
    }
    if (pick < 0) break;
    const v = villages[pick];
    const path = trace(cellAt(v.n, v.e));
    const endCell = path[path.length - 1];
    const end = exitAt(endCell) ?? snap({ n: cellN(endCell), e: cellE(endCell) });
    lay(path, v, end, ROAD_KIND_SEALED);
    joined[pick] = true;
    anchors.push(v);
    for (let k = 0; k < count; k++) if (onNet[k]) sources.add(k);
  }

  // --- Loops: gravel links where the network's way round is much longer than the straight distance.
  type Node = Pt & { cells: number[] };
  const nodes: Node[] = villages.map((v) => ({ ...v, cells: [cellAt(v.n, v.e)] }));
  if (town) nodes.push({ n: town.north, e: town.east, cells: exits.map((x) => cellAt(x.n, x.e)) });
  // Along the network (and through the town) only.
  const netCells = Uint8Array.from(onNet);
  for (const x of exits) netCells[cellAt(x.n, x.e)] = 1;
  if (town) for (let k = 0; k < count; k++) if (Math.hypot(cellN(k) - town.north, cellE(k) - town.east) < town.radius) netCells[k] = 1;
  const nearest = (cells: readonly number[]): number => cells.reduce((best, k) => (dist[k] < dist[best] ? k : best), cells[0]);
  const links: { a: number; b: number; ratio: number }[] = [];
  const freeBlocked = Uint8Array.from(blocked);
  for (let a = 0; a < nodes.length; a++) {
    blocked.fill(0);
    search(nodes[a].cells, netCells);
    blocked.set(freeBlocked);
    for (let b = a + 1; b < nodes.length; b++) {
      const straight = Math.hypot(nodes[a].n - nodes[b].n, nodes[a].e - nodes[b].e);
      if (straight > 11000) continue;
      const ratio = dist[nearest(nodes[b].cells)] / straight;
      if (ratio > LOOP_DETOUR) links.push({ a, b, ratio });
    }
  }
  links.sort((x, y) => y.ratio - x.ratio);
  let added = 0;
  for (const { a, b } of links) {
    if (added >= LOOP_LINKS) break;
    search(nodes[b].cells);
    const path = trace(nearest(nodes[a].cells));
    // Only the stretches off the network are new road; each joins the network at both ends (a village's cell, a
    // town exit or a point on a road laid before).
    const joint = (k: number): Pt => exitAt(k) ?? nodes.find((p) => p.cells.length === 1 && p.cells[0] === k) ?? snap({ n: cellN(k), e: cellE(k) });
    let laid = 0;
    for (let i = 1; i < path.length; i++) {
      if (onNet[path[i]]) continue;
      let j = i;
      while (j + 1 < path.length && !onNet[path[j + 1]]) j++;
      const run = path.slice(i - 1, Math.min(path.length, j + 2));
      if (run.length >= 6) {
        lay(run, joint(run[0]), joint(run[run.length - 1]), ROAD_KIND_GRAVEL);
        laid += run.length;
      }
      i = j + 1;
    }
    if (laid > 0) added++;
  }

  // --- River crossings along the laid roads.
  const crossings: PlannedNetwork['crossings'] = [];
  const hit = { dist: Infinity, level: 0, halfWidth: 0, s: 0, side: 0, beyondSource: 0 };
  for (const l of lines) {
    let prevSide = 0;
    for (let i = 0; i < l.n.length; i++) {
      hydrology.queryRiver(l.n[i], l.e[i], hit);
      const s = hit.side !== 0 && hit.dist < 200 ? hit.side : 0;
      if (s !== 0 && prevSide !== 0 && s !== prevSide) {
        crossings.push({ north: (l.n[i] + l.n[i - 1]) / 2, east: (l.e[i] + l.e[i - 1]) / 2, bearing: Math.atan2(l.e[i] - l.e[i - 1], l.n[i] - l.n[i - 1]) });
      }
      if (s !== 0) prevSide = s;
    }
  }

  return {
    villages: villages.map((v) => ({ north: v.n, east: v.e, radius: VILLAGE_RADIUS })),
    roads: lines.map((l) => ({ kind: l.kind, line: encodePolyline(l.n, l.e) })),
    crossings: crossings.map((c) => ({ north: Math.round(c.north * 10) / 10, east: Math.round(c.east * 10) / 10, bearing: Math.round(c.bearing * 1000) / 1000 })),
  };
}

function closest(p: Pt, a: Pt, b: Pt): Pt {
  const dn = b.n - a.n;
  const de = b.e - a.e;
  const l2 = dn * dn + de * de;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((p.n - a.n) * dn + (p.e - a.e) * de) / l2)) : 0;
  return { n: a.n + dn * t, e: a.e + de * t };
}

/** Douglas-Peucker: drop points within `tol` of the line through their neighbours (the ends stay). */
function simplify(p: readonly Pt[], tol: number): Pt[] {
  if (p.length < 3) return [...p];
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let worst = -1;
    let wd = tol;
    for (let k = i + 1; k < j; k++) {
      const q = closest(p[k], p[i], p[j]);
      const d = Math.hypot(q.n - p[k].n, q.e - p[k].e);
      if (d > wd) {
        wd = d;
        worst = k;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([i, worst], [worst, j]);
    }
  }
  return p.filter((_, k) => keep[k]);
}

/** Chaikin corner cutting, the end points fixed. */
function chaikin(p: readonly Pt[], passes: number): Pt[] {
  let q = [...p];
  for (let s = 0; s < passes; s++) {
    if (q.length < 3) return q;
    const r: Pt[] = [q[0]];
    for (let i = 0; i + 1 < q.length; i++) {
      const a = q[i];
      const b = q[i + 1];
      if (i > 0) r.push({ n: 0.75 * a.n + 0.25 * b.n, e: 0.75 * a.e + 0.25 * b.e });
      if (i + 2 < q.length) r.push({ n: 0.25 * a.n + 0.75 * b.n, e: 0.25 * a.e + 0.75 * b.e });
    }
    r.push(q[q.length - 1]);
    q = r;
  }
  return q;
}

/** Drop points closer than `tol` to the chord of their neighbours, keeping segments under 60 m. */
function resample(p: readonly Pt[], tol: number): Pt[] {
  const s = simplify(p, tol);
  const out: Pt[] = [s[0]];
  for (let i = 1; i < s.length; i++) {
    const a = out[out.length - 1];
    const b = s[i];
    const m = Math.ceil(Math.hypot(b.n - a.n, b.e - a.e) / 60);
    for (let k = 1; k <= m; k++) out.push({ n: a.n + ((b.n - a.n) * k) / m, e: a.e + ((b.e - a.e) * k) / m });
  }
  return out;
}

/** Binary min-heap of (cell, cost). */
class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size(): number {
    return this.k.length;
  }
  push(key: number, val: number): void {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= val) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): [number, number] {
    const k = this.k;
    const v = this.v;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= k.length) break;
        const r = l + 1;
        const c = r < k.length && v[r] < v[l] ? r : l;
        if (v[c] >= lv) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}
