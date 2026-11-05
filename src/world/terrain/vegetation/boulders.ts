// Boulder fields along fast water: where a seeded world's channels lose height quickly (rapids, step-pool cascades)
// and at the foot of their falls, the water has stripped the ground to rock and left the stones it cannot move. Placed
// per square cell from the hydrology contract (Hydrology.rivers' flow arrays, Hydrology.falls), deterministically:
// every boulder comes from a hash of its channel segment (or fall) and its number there, never from the cell or the
// viewer, so the same stones stand wherever they are built. Pure and three.js-free (runs in the tile workers);
// BoulderSystem.ts draws them. Seed 0 has no flow data and gets none.

import { hydrology, makeSample, sampleTerrain } from '../heightfield';
import { hash2i } from '../noise';
import { rockReach } from '../bedrock';
import type { RiverLine } from '../hydrology';

export interface BoulderCellRequest {
  cx: number;
  cz: number;
  /** Cell edge length, m. Cell (cx, cz) covers east [cx*size, ...), north [cz*size, ...). */
  size: number;
}

/** Floats per boulder in BoulderCellData.boulders. */
export const BOULDER_STRIDE = 8;

export interface BoulderCellData {
  kind: 'boulders';
  cx: number;
  cz: number;
  /**
   * Per boulder: east, base height (the ground under its centre, m), north, radius (m), height over radius (its
   * squash, 0.6-1), yaw (rad), shape (0..BOULDER_SHAPES-1) + 0.99 * tone (0..1), wetness (0 dry .. 1 in the water).
   */
  boulders: Float32Array;
  count: number;
}

/** Shared rock shapes (BoulderSystem builds them). */
export const BOULDER_SHAPES = 3;
/** Channels steeper than this (streams.ts steepness: 0.5 is the start of rapids) carry boulders. */
export const BOULDER_STEEP = 0.5;
/** Share of the channel and its bare banks the stones cover at full steepness, and at the start of rapids. */
const COVER_STEEP = 0.22;
const COVER_RAPIDS = 0.025;
/** Most stones placed per channel segment, and per fall. */
const SEGMENT_MAX = 160;
const FALL_MAX_STONES = 40;
/** The biggest stone a stone in the water is grown to, to break the surface, m. */
const MAX_RADIUS = 3.5;

const rnd = (h: number, salt: number): number => hash2i(h, salt) / 4294967296;
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Mean stone radius of a channel of this half-width and steepness, m: cobbles and small boulders in a brook, big blocks in a river. */
function meanRadius(halfWidth: number, steep: number): number {
  return Math.min(1.6, 0.28 + 0.07 * halfWidth) * (0.75 + 0.5 * smooth(0.5, 1, steep));
}

/** Cell index of the steep channel segments and falls (per world: rebuilt when the hydrology changes). */
interface SteepIndex {
  rivers: ReadonlyArray<RiverLine>;
  size: number;
  /** Cell key -> flat list of (line, segment) pairs, and of fall indices. */
  segments: Map<number, number[]>;
  falls: Map<number, number[]>;
}
let index: SteepIndex | null = null;

const cellKey = (cx: number, cz: number): number => (cx + 1048576) * 2097152 + (cz + 1048576);

function steepIndex(size: number): SteepIndex | null {
  const rivers = hydrology.rivers;
  if (!rivers || !hydrology.queryFlow) return null;
  if (index && index.rivers === rivers && index.size === size) return index;
  const segments = new Map<number, number[]>();
  const falls = new Map<number, number[]>();
  const push = (m: Map<number, number[]>, north: number, east: number, ...v: number[]): void => {
    const k = cellKey(Math.floor(east / size), Math.floor(north / size));
    const l = m.get(k);
    if (l) l.push(...v);
    else m.set(k, v);
  };
  rivers.forEach((r, li) => {
    const st = r.steepness;
    if (!st) return;
    for (let i = 0; i + 1 < r.north.length; i++) {
      if (Math.max(st[i], st[i + 1]) < BOULDER_STEEP) continue;
      push(segments, r.north[i], r.east[i], li, i);
    }
  });
  (hydrology.falls ?? []).forEach((f, fi) => push(falls, f.north, f.east, fi));
  index = { rivers, size, segments, falls };
  return index;
}

const sample = makeSample();

/** The boulders of one cell (an empty list where the world has no flow data or no fast water there). */
export function buildBoulderCell(req: BoulderCellRequest): BoulderCellData {
  const { cx, cz, size } = req;
  const out: number[] = [];
  const idx = steepIndex(size);
  const key = cellKey(cx, cz);
  if (idx) {
    const segs = idx.segments.get(key);
    if (segs) for (let k = 0; k < segs.length; k += 2) segmentStones(idx.rivers[segs[k]], segs[k], segs[k + 1], out);
    const fl = idx.falls.get(key);
    if (fl) for (const fi of fl) fallStones(fi, out);
  }
  return { kind: 'boulders', cx, cz, boulders: Float32Array.from(out), count: out.length / BOULDER_STRIDE };
}

/**
 * Place one stone at (north, east) of radius r, if the ground there takes it: on land or in shallow water (its top
 * must show above the water, `level`), never in a lake or the sea. `wet` 1 in the channel, falling off up the bank.
 */
function place(north: number, east: number, r: number, level: number, h: number, wet: number, out: number[]): void {
  // (At the position as stored: the ground under a stone on a steep notch wall changes within float32 rounding.)
  north = Math.fround(north);
  east = Math.fround(east);
  sampleTerrain(north, east, sample);
  // Never in a lake or the sea, nor on its shore (within a metre of its water).
  if (sample.standing > sample.ground - 1 || sample.airportBlend < 1) return;
  // (Nor on the banks a stream's carving leaves standing in a lake.)
  if ((hydrology.lakeMask?.at(north, east) ?? -Infinity) > -Infinity) return;
  const g = sample.ground;
  const squash = 0.6 + 0.4 * rnd(h, 5);
  // In the water a stone has to break the surface: bigger where it is deeper, or none where it would be lost.
  const depth = level - g;
  if (depth > 0) {
    const need = depth / (squash * 0.8) + 0.1;
    if (need > Math.min(r * 2.2, MAX_RADIUS)) return;
    r = Math.max(r, need);
  }
  const shape = Math.floor(rnd(h, 6) * BOULDER_SHAPES) % BOULDER_SHAPES;
  out.push(east, g, north, r, squash, rnd(h, 7) * Math.PI * 2, shape + 0.99 * rnd(h, 8), wet);
}

/** Stones along channel segment (i, i + 1) of line li: in the bed and over its bare banks, by steepness. */
function segmentStones(r: RiverLine, li: number, i: number, out: number[]): void {
  const st = r.steepness as Float32Array;
  const dn = r.north[i + 1] - r.north[i];
  const de = r.east[i + 1] - r.east[i];
  const len = Math.hypot(dn, de);
  if (len < 0.5) return;
  const steep = 0.5 * (st[i] + st[i + 1]);
  const hw = 0.5 * (r.halfWidth[i] + r.halfWidth[i + 1]);
  const reach = rockReach(hw);
  const band = hw + reach;
  const cover = COVER_RAPIDS + (COVER_STEEP - COVER_RAPIDS) * smooth(0.5, 0.9, steep);
  if (steep < BOULDER_STEEP) return;
  const rMean = meanRadius(hw, steep);
  const expected = (cover * len * 2 * band) / (Math.PI * rMean * rMean * 1.4);
  const hs = hash2i(li * 7919 + 13, i);
  // Clumped: some segments carry a field of stones, others few (the stones lie where the flow dropped them).
  const clump = 0.25 + 1.5 * rnd(hs, 2) ** 1.5;
  let count = Math.floor(expected * clump + rnd(hs, 1));
  count = Math.min(SEGMENT_MAX, count);
  const un = dn / len;
  const ue = de / len;
  for (let k = 0; k < count; k++) {
    const h = hash2i(hs, k + 101);
    const t = rnd(h, 1);
    // Across: most stones in the bed, the rest strewn over the banks, thinning up them.
    const inBed = rnd(h, 2) < 0.35;
    const side = rnd(h, 3) < 0.5 ? -1 : 1;
    const u = rnd(h, 4);
    const across = side * (inBed ? hw * Math.sqrt(u) : hw + 0.8 * reach * u ** 1.6);
    const north = r.north[i] + dn * t - ue * across;
    const east = r.east[i] + de * t + un * across;
    const level = r.level[i] + (r.level[i + 1] - r.level[i]) * t;
    // Sizes: many small, few big (a skewed spread about the mean), smaller up the banks.
    const size = rMean * (0.35 + 1.6 * rnd(h, 9) ** 2.2) * (inBed ? 1 : 0.85);
    const wet = inBed ? 1 : 1 - Math.min(1, (Math.abs(across) - hw) / Math.max(1, reach));
    place(north, east, size, level, h, wet, out);
  }
}

/** A heap of big stones in and around the plunge pool at a fall's foot, and a few at its lip. */
function fallStones(fi: number, out: number[]): void {
  const f = (hydrology.falls ?? [])[fi];
  if (!f) return;
  const drop = f.top - f.bottom;
  const hw = 0.5 * f.width;
  const hs = hash2i(fi * 4099 + 7, Math.round(f.north) ^ Math.round(f.east));
  const count = Math.min(FALL_MAX_STONES, Math.round(6 + 1.2 * drop + 0.4 * hw));
  const rBase = meanRadius(hw, 1) * (1 + 0.04 * drop);
  // The pool lies a little beyond the face (a higher fall throws further), as wide as the water and a bit more.
  const poolN = f.north + f.dirN * (3 + 0.35 * drop);
  const poolE = f.east + f.dirE * (3 + 0.35 * drop);
  const spread = hw + 2 + 0.25 * drop;
  for (let k = 0; k < count; k++) {
    const h = hash2i(hs, k + 211);
    const lip = k < count * 0.2;
    // Around the pool (its rim more than its middle) and just downstream; at the lip, at the sides of the water.
    const a = rnd(h, 1) * Math.PI * 2;
    const d = spread * (0.45 + 0.75 * Math.sqrt(rnd(h, 2)));
    let north: number;
    let east: number;
    if (lip) {
      const side = rnd(h, 3) < 0.5 ? -1 : 1;
      const across = side * (hw * (0.7 + 0.6 * rnd(h, 4)));
      north = f.north - f.dirE * across - f.dirN * rnd(h, 2) * 3;
      east = f.east + f.dirN * across - f.dirE * rnd(h, 2) * 3;
    } else {
      // Stretched along the flow: the pool's tail runs out downstream.
      const along = Math.cos(a) * d * 1.4;
      const across = Math.sin(a) * d;
      north = poolN + f.dirN * along - f.dirE * across;
      east = poolE + f.dirE * along + f.dirN * across;
    }
    const size = rBase * (0.6 + 1.5 * rnd(h, 9) ** 1.8);
    place(north, east, size, lip ? f.top : f.bottom, h, 1, out);
  }
}
