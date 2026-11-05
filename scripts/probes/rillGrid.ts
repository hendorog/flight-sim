// Shared by the rill probes: a ground raster, steepest descent with a bounded pit spill, and accumulation.
import { makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';

export const DN = [-1, -1, 0, 1, 1, 1, 0, -1];
export const DE = [0, 1, 1, 1, 0, -1, -1, -1];

export interface Grid {
  n: number;
  step: number;
  /** North of row 0, east of column 0. */
  north0: number;
  east0: number;
  ground: Float64Array;
  water: Uint8Array;
  /** Downstream cell, -1 at the edge / in water, -2 in a sink (a pit deeper than the spill allows). */
  to: Int32Array;
  area: Float64Array;
}

export function raster(cn: number, ce: number, half: number, step: number, height?: (n: number, e: number) => number): Grid {
  const n = Math.round((2 * half) / step) + 1;
  const ground = new Float64Array(n * n);
  const water = new Uint8Array(n * n);
  const s = makeSample();
  const north0 = cn + half;
  const east0 = ce - half;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const north = north0 - y * step;
      const east = east0 + x * step;
      sampleTerrain(north, east, s);
      ground[y * n + x] = height ? height(north, east) : s.ground;
      water[y * n + x] = Math.max(s.standing, s.river) > s.ground ? 1 : 0;
    }
  }
  return { n, step, north0, east0, ground, water, to: new Int32Array(n * n), area: new Float64Array(n * n) };
}

/**
 * Steepest descent; a cell with no lower neighbour spills to the first lower cell a bounded flood from it reaches
 * (within `radius` cells, rising at most `depth` m), else it is a sink. Every edge goes strictly down, so the
 * accumulation order is the height order and no window or build order changes it.
 */
export function descend(g: Grid, radius: number, depth: number): { pits: number; spilled: number; sinks: number } {
  const { n, ground, water, to } = g;
  let pits = 0, spilled = 0, sinks = 0;
  const seen = new Map<number, number>();
  for (let i = 0; i < n * n; i++) {
    const x = i % n, y = (i / n) | 0;
    if (water[i] || x === 0 || y === 0 || x === n - 1 || y === n - 1) { to[i] = -1; continue; }
    let best = -1, bs = 0;
    for (let k = 0; k < 8; k++) {
      const j = (y + DN[k]) * n + x + DE[k];
      const s2 = (ground[i] - ground[j]) / (k & 1 ? Math.SQRT2 : 1);
      if (s2 > bs) { bs = s2; best = j; }
    }
    if (best >= 0) { to[i] = best; continue; }
    pits++;
    // Bounded flood: cells in height order from the pit; the first one lower than the pit is the spill target.
    seen.clear();
    const h0 = ground[i];
    const open: number[] = [i];
    seen.set(i, 1);
    let target = -2;
    while (open.length) {
      let m = 0;
      for (let q = 1; q < open.length; q++) if (ground[open[q]] < ground[open[m]]) m = q;
      const c = open[m];
      open[m] = open[open.length - 1];
      open.pop();
      if (ground[c] < h0) { target = c; break; }
      if (ground[c] > h0 + depth) continue;
      const cx = c % n, cy = (c / n) | 0;
      for (let k = 0; k < 8; k++) {
        const xx = cx + DE[k], yy = cy + DN[k];
        if (xx < 0 || yy < 0 || xx >= n || yy >= n || Math.abs(xx - x) > radius || Math.abs(yy - y) > radius) continue;
        const j = yy * n + xx;
        if (seen.has(j)) continue;
        seen.set(j, 1);
        open.push(j);
      }
    }
    to[i] = target;
    if (target >= 0) spilled++;
    else sinks++;
  }
  return { pits, spilled, sinks };
}

/** Accumulate the catchment (km²) down `to`, highest cell first. Also each cell's catchment bounding box (cells). */
export function accumulate(g: Grid, box?: Int32Array): void {
  const { n, ground, to, area } = g;
  const order = new Uint32Array(n * n);
  for (let i = 0; i < n * n; i++) order[i] = i;
  order.sort((a, b) => ground[b] - ground[a] || a - b);
  area.fill((g.step * g.step) / 1e6);
  if (box) for (let i = 0; i < n * n; i++) { const x = i % n, y = (i / n) | 0; box[i * 4] = x; box[i * 4 + 1] = y; box[i * 4 + 2] = x; box[i * 4 + 3] = y; }
  for (const i of order) {
    const j = to[i];
    if (j < 0) continue;
    area[j] += area[i];
    if (box) {
      box[j * 4] = Math.min(box[j * 4], box[i * 4]);
      box[j * 4 + 1] = Math.min(box[j * 4 + 1], box[i * 4 + 1]);
      box[j * 4 + 2] = Math.max(box[j * 4 + 2], box[i * 4 + 2]);
      box[j * 4 + 3] = Math.max(box[j * 4 + 3], box[i * 4 + 3]);
    }
  }
}

/** Mean of the 8 neighbours minus the cell, m (> 0 in a hollow). */
export function hollow(g: Grid, i: number, r = 1): number {
  const { n, ground } = g;
  const x = i % n, y = (i / n) | 0;
  let s = 0, c = 0;
  for (let k = 0; k < 8; k++) {
    const xx = x + DE[k] * r, yy = y + DN[k] * r;
    if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
    s += ground[yy * n + xx];
    c++;
  }
  return c ? s / c - ground[i] : 0;
}

/** The rise (m) a flood from cell i must reach to find a lower cell within `radius` cells (Infinity if none), and that cell. */
export function spillDepth(g: Grid, i: number, radius: number, cap: number, prev?: Map<number, number>): { rise: number; to: number } {
  const { n, ground } = g;
  const x = i % n, y = (i / n) | 0;
  const h0 = ground[i];
  const seen = new Set<number>([i]);
  prev?.clear();
  // Binary heap by height.
  const heap: number[] = [i];
  const up = (k: number): void => { while (k > 0) { const p = (k - 1) >> 1; if (ground[heap[p]] <= ground[heap[k]]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const down = (k: number): void => { for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && ground[heap[l]] < ground[heap[m]]) m = l; if (r < heap.length && ground[heap[r]] < ground[heap[m]]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } };
  let level = h0;
  while (heap.length) {
    const c = heap[0];
    const last = heap.pop()!;
    if (heap.length) { heap[0] = last; down(0); }
    if (ground[c] < h0) return { rise: level - h0, to: c };
    level = Math.max(level, ground[c]);
    if (level - h0 > cap) break;
    const cx = c % n, cy = (c / n) | 0;
    for (let k = 0; k < 8; k++) {
      const xx = cx + DE[k], yy = cy + DN[k];
      if (xx < 0 || yy < 0 || xx >= n || yy >= n || Math.abs(xx - x) > radius || Math.abs(yy - y) > radius) continue;
      const j = yy * n + xx;
      if (seen.has(j)) continue;
      seen.add(j);
      prev?.set(j, c);
      heap.push(j);
      up(heap.length - 1);
    }
  }
  return { rise: Infinity, to: -1 };
}
