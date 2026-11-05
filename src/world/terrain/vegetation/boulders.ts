// Boulder fields along fast water: where a seeded world's channels lose height quickly (rapids, step-pool cascades)
// and at the foot of their falls, the water has stripped the ground to rock and left the stones it cannot move. Placed
// per square cell from the hydrology contract (Hydrology.rivers' flow arrays, Hydrology.falls), deterministically:
// the stones in the bed come from the channel's stone lattice (channelStones.ts, which the water's shader reads too, so
// the white water breaks round the very rocks drawn here), those on the banks and under the falls from a hash of their
// channel segment (or fall) and their number there - never from the cell or the viewer, so the same stones stand
// wherever they are built. Sizes come from the bed's grain (RiverLine.grain): big blocks by the heads and on steep
// pitches, grading to cobbles downstream. Pure and three.js-free (runs in the tile workers); BoulderSystem.ts draws
// them. Seed 0 has no flow data and gets none.

import { hydrology, makeSample, sampleTerrain } from '../heightfield';
import { hash2i } from '../noise';
import { rockReach } from '../bedrock';
import { grainToUnit, STONE_ALONG, STONE_ACROSS, STONE_IN, stoneAt, unitToGrain, type ChannelStone } from '../channelStones';
import type { RiverLine } from '../hydrology';

export interface BoulderCellRequest {
  cx: number;
  cz: number;
  /** Cell edge length, m. Cell (cx, cz) covers east [cx*size, ...), north [cz*size, ...). */
  size: number;
}

/** Floats per boulder in BoulderCellData.boulders. */
export const BOULDER_STRIDE = 10;

export interface BoulderCellData {
  kind: 'boulders';
  cx: number;
  cz: number;
  /**
   * Per boulder: east, ground under its centre (m), north, radius (m, of the rock's widest part), half-height (m), yaw
   * (rad), shape (0..BOULDER_SHAPES-1) + 0.99 * tone (0..1), wetness (0 dry .. 1 in the water), its centre's height
   * over the ground (m, negative: sunk into it), and the radius it shows (m: at the waterline for a rock standing in
   * the water, else its radius; the drawing culls by it).
   */
  boulders: Float32Array;
  count: number;
}

/** Shared rock shapes (BoulderSystem builds them). */
export const BOULDER_SHAPES = 5;
/** Channels steeper than this (streams.ts steepness: 0.5 is the start of rapids) carry boulders. */
export const BOULDER_STEEP = 0.5;
/** Share of the bare banks the stones cover at full steepness, and at the start of rapids. */
const BANK_COVER_STEEP = 0.07;
const BANK_COVER_RAPIDS = 0.01;
/** Most bank stones placed per channel segment, and stones per fall. */
const SEGMENT_MAX = 60;
const FALL_MAX_STONES = 90;
/** The biggest stone on a bank or under a fall, m. */
const MAX_RADIUS = 4;
/** A rock standing in the water reaches down to the bed: at most this deep a channel, m (deeper ones are left out). */
const STAND_DEPTH_MAX = 3.6;

const rnd = (h: number, salt: number): number => hash2i(h, salt) / 4294967296;
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

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
    if (segs)
      for (let k = 0; k < segs.length; k += 2) {
        const r = idx.rivers[segs[k]];
        bedStones(r, segs[k + 1], out);
        bankStones(r, segs[k], segs[k + 1], out);
      }
    const fl = idx.falls.get(key);
    if (fl) for (const fi of fl) fallStones(fi, out);
  }
  return { kind: 'boulders', cx, cz, boulders: Float32Array.from(out), count: out.length / BOULDER_STRIDE };
}

/** Whether a stone may stand at the sample just taken: never in a lake or the sea, nor on its shore. */
function onOpenGround(north: number, east: number): boolean {
  // Never in a lake or the sea, nor on its shore (within a metre of its water).
  if (sample.standing > sample.ground - 1 || sample.airportBlend < 1) return false;
  // (Nor on the banks a stream's carving leaves standing in a lake.)
  return (hydrology.lakeMask?.at(north, east) ?? -Infinity) === -Infinity;
}

/**
 * Place one loose stone at (north, east) of radius r, if the ground there takes it: on land or in shallow water (its top
 * must show above the water, `level`), never in a lake or the sea. `wet` 1 in the channel, falling off up the bank.
 */
function place(north: number, east: number, r: number, level: number, h: number, wet: number, out: number[]): void {
  // (At the position as stored: the ground under a stone on a steep notch wall changes within float32 rounding.)
  north = Math.fround(north);
  east = Math.fround(east);
  sampleTerrain(north, east, sample);
  if (!onOpenGround(north, east)) return;
  const g = sample.ground;
  const squash = 0.6 + 0.4 * rnd(h, 5);
  // In the water a stone has to break the surface: bigger where it is deeper, or none where it would be lost. (The
  // water there may be another channel's, higher: by a junction.)
  const depth = Math.max(level, sample.river) - g;
  if (depth > 0) {
    const need = depth / (squash * 0.8) + 0.1;
    if (need > Math.min(r * 2.2, MAX_RADIUS)) return;
    r = Math.max(r, need);
  }
  const shape = Math.floor(rnd(h, 6) * BOULDER_SHAPES) % BOULDER_SHAPES;
  const hy = r * squash;
  out.push(east, g, north, r, hy, rnd(h, 7) * Math.PI * 2, shape + 0.99 * rnd(h, 8), wet, -0.25 * hy, r);
}

/** The ribbon's row values as its vertices carry them (water.ts ribbonRows: float32 positions, byte flow). */
const rowSteep = (r: RiverLine, i: number): number => Math.round(255 * Math.min(1, Math.max(0, r.steepness![i]))) / 255;
const rowGrain = (r: RiverLine, i: number): number => unitToGrain(Math.round(255 * grainToUnit(r.grain?.[i] ?? 0)) / 255);

/** A ribbon row's vertex frame (water.ts ribbonRows): centre and the unit toward the left bank (east, north). */
function rowFrame(r: RiverLine, i: number): { e: number; n: number; pe: number; pn: number } {
  const count = r.north.length;
  const i0 = Math.max(0, i - 1);
  const i1 = Math.min(count - 1, i + 1);
  const tn = r.north[i1] - r.north[i0];
  const te = r.east[i1] - r.east[i0];
  const tl = Math.hypot(tn, te) || 1;
  return { e: r.east[i], n: r.north[i], pe: -tn / tl, pn: te / tl };
}
/** The ribbon's across fractions (water.ts RIBBON_ACROSS). */
const ACROSS = [-1.2, -0.55, 0, 0.55, 1.2];

/**
 * The ribbon's point at channel coordinates (s, x) between rows i and i + 1, as its triangles interpolate them
 * (water.ts ribbonRows: x = -a * halfWidth at the vertex a * halfWidth toward the left bank): world east, north and the
 * water's level there. False when (s, x) is off the ribbon.
 */
const bary = { e: 0, n: 0, level: 0 };
function ribbonPoint(r: RiverLine, i: number, s: number, x: number): boolean {
  const A = rowFrame(r, i);
  const B = rowFrame(r, i + 1);
  const s0 = Math.fround(r.s[i]);
  const s1 = Math.fround(r.s[i + 1]);
  const w0 = r.halfWidth[i];
  const w1 = r.halfWidth[i + 1];
  // Vertices: (s, x, east, north, level) of row i column c (P0[c]) and row i + 1 (P1[c]).
  const vert = (row: 0 | 1, c: number): [number, number, number, number, number] => {
    const F = row ? B : A;
    const w = row ? w1 : w0;
    const off = ACROSS[c] * w;
    return [row ? s1 : s0, -off, F.e + F.pe * off, F.n + F.pn * off, r.level[i + row]];
  };
  for (let c = 0; c + 1 < ACROSS.length; c++) {
    const a = vert(0, c);
    const cc = vert(1, c);
    const b = vert(0, c + 1);
    const d = vert(1, c + 1);
    // The two triangles water.ts draws: (a, c, b) and (b, c, d).
    for (const [p, q, t] of [[a, cc, b], [b, cc, d]]) {
      const det = (q[0] - p[0]) * (t[1] - p[1]) - (t[0] - p[0]) * (q[1] - p[1]);
      if (Math.abs(det) < 1e-9) continue;
      const l1 = ((s - p[0]) * (t[1] - p[1]) - (t[0] - p[0]) * (x - p[1])) / det;
      const l2 = ((q[0] - p[0]) * (x - p[1]) - (s - p[0]) * (q[1] - p[1])) / det;
      const l0 = 1 - l1 - l2;
      if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
      bary.e = l0 * p[2] + l1 * q[2] + l2 * t[2];
      bary.n = l0 * p[3] + l1 * q[3] + l2 * t[3];
      bary.level = l0 * p[4] + l1 * q[4] + l2 * t[4];
      return true;
    }
  }
  return false;
}

const stone: ChannelStone = { s: 0, x: 0, r: 0, submerged: false, stand: 0, u7: 0, u8: 0 };

/**
 * The rocks of the channel's stone lattice (channelStones.ts) between samples i and i + 1 of a line: each stands on the
 * bed and shows the lattice's radius at the waterline (the water's shader draws its collar there), its top standing
 * out by the lattice's amount. A rock in deep water is a block reaching down to the bed, mostly under the surface.
 * The lattice's submerged stones show no rock (their boil is the shader's).
 */
function bedStones(r: RiverLine, i: number, out: number[]): void {
  if (!r.grain || r.level[i] < 0.3) return;
  const s0 = Math.fround(r.s[i]);
  const s1 = Math.fround(r.s[i + 1]);
  if (!(s1 > s0)) return;
  const st0 = rowSteep(r, i);
  const st1 = rowSteep(r, i + 1);
  const g0 = rowGrain(r, i);
  const g1 = rowGrain(r, i + 1);
  const wMax = Math.max(r.halfWidth[i], r.halfWidth[i + 1]);
  const jMax = Math.ceil((STONE_IN * wMax) / STONE_ACROSS + 0.5);
  for (let k = Math.floor(s0 / STONE_ALONG) - 1; k <= Math.floor(s1 / STONE_ALONG); k++) {
    for (let j = -jMax; j <= jMax; j++) {
      // The values the ribbon interpolates at the stone (its lattice cell's own centre first: close enough to decide).
      const tc = Math.min(1, Math.max(0, ((k + 0.5) * STONE_ALONG - s0) / (s1 - s0)));
      if (!stoneAt(k, j, st0 + (st1 - st0) * tc, g0 + (g1 - g0) * tc, r.halfWidth[i] + (r.halfWidth[i + 1] - r.halfWidth[i]) * tc, stone)) continue;
      if (stone.s < s0 || stone.s >= s1) continue;
      // Again at its centre (the lattice moved it within its cell).
      const t = (stone.s - s0) / (s1 - s0);
      if (!stoneAt(k, j, st0 + (st1 - st0) * t, g0 + (g1 - g0) * t, r.halfWidth[i] + (r.halfWidth[i + 1] - r.halfWidth[i]) * t, stone)) continue;
      if (stone.submerged) continue;
      if (!ribbonPoint(r, i, stone.s, stone.x)) continue;
      const north = Math.fround(bary.n);
      const east = Math.fround(bary.e);
      sampleTerrain(north, east, sample);
      if (!onOpenGround(north, east)) continue;
      const g = sample.ground;
      const depth = bary.level - g;
      // (Not where another channel's water stands higher, by a junction: it would drown the rock.)
      if (depth > STAND_DEPTH_MAX || sample.river > bary.level + 0.2) continue;
      const h = hash2i(k * 31 + 7, j + 4099);
      const shape = Math.floor(stone.u7 * BOULDER_SHAPES) % BOULDER_SHAPES;
      const rw = stone.r;
      let rr: number;
      let hy: number;
      let dy: number;
      if (depth < 0.05) {
        // On the bed's dry edge: an ordinary stone, a quarter sunk.
        hy = rw * (0.6 + 0.4 * stone.u8);
        rr = rw;
        dy = -0.25 * hy;
      } else {
        // Its top `stand` over the water; reaching from the bed (a quarter of its height sunk) up to there, as wide at
        // the waterline as the lattice says.
        const top = bary.level + stone.stand;
        hy = Math.max(rw * 0.6, (top - g) / 1.5);
        const z = hy - stone.stand;
        rr = Math.min(2.6 * rw, rw / Math.sqrt(Math.max(0.05, 1 - (z / hy) * (z / hy))));
        dy = top - hy - g;
      }
      // (Wet by the water, its top splashed rather than soaked.)
      out.push(east, g, north, rr, hy, rnd(h, 7) * Math.PI * 2, shape + 0.99 * stone.u8, 0.55, dy, rw);
    }
  }
}

/** Stones over a steep segment's bare banks (i, i + 1) of line li: a few, some large, sized from the bed's grain. */
function bankStones(r: RiverLine, li: number, i: number, out: number[]): void {
  const st = r.steepness as Float32Array;
  const dn = r.north[i + 1] - r.north[i];
  const de = r.east[i + 1] - r.east[i];
  const len = Math.hypot(dn, de);
  if (len < 0.5) return;
  const steep = 0.5 * (st[i] + st[i + 1]);
  if (steep < BOULDER_STEEP) return;
  const hw = 0.5 * (r.halfWidth[i] + r.halfWidth[i + 1]);
  const reach = rockReach(hw);
  const cover = BANK_COVER_RAPIDS + (BANK_COVER_STEEP - BANK_COVER_RAPIDS) * smooth(0.5, 0.9, steep);
  const grain = Math.max(0.3, 0.5 * ((r.grain?.[i] ?? 0.6) + (r.grain?.[i + 1] ?? 0.6)));
  const rMean = 0.45 * grain;
  const expected = (cover * len * 2 * 0.8 * reach) / (Math.PI * rMean * rMean * 1.6);
  const hs = hash2i(li * 7919 + 13, i);
  // Clumped: some segments carry a field of stones, others few (the stones lie where the flow dropped them).
  const clump = 0.25 + 1.5 * rnd(hs, 2) ** 1.5;
  const count = Math.min(SEGMENT_MAX, Math.floor(expected * clump + rnd(hs, 1)));
  const un = dn / len;
  const ue = de / len;
  for (let k = 0; k < count; k++) {
    const h = hash2i(hs, k + 101);
    const t = rnd(h, 1);
    // Across: strewn over the banks, thinning up them.
    const side = rnd(h, 3) < 0.5 ? -1 : 1;
    const u = rnd(h, 4);
    const across = side * (hw + 0.5 + 0.8 * reach * u ** 1.6);
    const north = r.north[i] + dn * t - ue * across;
    const east = r.east[i] + de * t + un * across;
    const level = r.level[i] + (r.level[i + 1] - r.level[i]) * t;
    // Sizes: many middling, a few big (a long tail over the bed's grain).
    const size = Math.min(MAX_RADIUS, rMean * (0.4 + 2.2 * rnd(h, 9) ** 3));
    const wet = 1 - Math.min(1, (Math.abs(across) - hw) / Math.max(1, reach));
    place(north, east, size, level, h, wet, out);
  }
}

/**
 * Rubble at a fall's foot: blocks broken off its face, heaped along the wall's foot either side of the plunge pool and
 * strewn down the pool's tail - the biggest against the wall, grading smaller outward; and a few at its lip.
 */
function fallStones(fi: number, out: number[]): void {
  const f = (hydrology.falls ?? [])[fi];
  if (!f) return;
  const r = hydrology.rivers?.[f.line];
  const drop = f.top - f.bottom;
  const hw = 0.5 * f.width;
  const hs = hash2i(fi * 4099 + 7, Math.round(f.north) ^ Math.round(f.east));
  const count = Math.min(FALL_MAX_STONES, Math.round(14 + 0.8 * drop + 0.8 * hw));
  // The bed's grain below the fall (falls.ts bedGrain: 1.5 to 4 m under a tall one).
  const grain = Math.max(1, r?.grain?.[Math.min(r.grain.length - 1, f.index + 1)] ?? 2);
  const rBase = 0.5 * grain * (1 + 0.004 * drop);
  // The pool lies a little beyond the face (a higher fall throws further); the scree runs along the wall's foot either
  // side of it, as far as the gorge is wide.
  const poolOut = 3 + 0.12 * drop;
  const wallSpread = Math.min(Math.max(hw + 6, r?.breach?.[Math.min(r.breach.length - 1, f.index + 1)] ?? 0), hw + 8 + 0.5 * drop);
  for (let k = 0; k < count; k++) {
    const h = hash2i(hs, k + 211);
    const lip = k < count * 0.12;
    let north: number;
    let east: number;
    let size: number;
    if (lip) {
      const side = rnd(h, 3) < 0.5 ? -1 : 1;
      const across = side * (hw * (0.7 + 0.6 * rnd(h, 4)));
      north = f.north - f.dirE * across - f.dirN * rnd(h, 2) * 3;
      east = f.east + f.dirN * across - f.dirE * rnd(h, 2) * 3;
      size = rBase * (0.5 + 0.8 * rnd(h, 9));
    } else {
      // Along the wall's foot (out from the face a little, the pool's sides) or down the pool's tail.
      const tail = rnd(h, 1) < 0.35;
      const u = rnd(h, 2);
      let along: number;
      let across: number;
      if (tail) {
        along = poolOut + (hw + 4 + 0.3 * drop) * (0.3 + 1.2 * Math.sqrt(u));
        across = (rnd(h, 4) - 0.5) * 2 * (hw + 2 + 0.1 * drop);
      } else {
        along = 1 + (2 + 0.08 * drop) * u ** 1.5;
        const side = rnd(h, 3) < 0.5 ? -1 : 1;
        across = side * (0.6 * hw + (wallSpread - 0.6 * hw) * Math.sqrt(rnd(h, 4)));
      }
      north = f.footNorth + f.dirN * along - f.dirE * across;
      east = f.footEast + f.dirE * along + f.dirN * across;
      // Biggest by the wall, smaller outward; a long tail of big blocks.
      const out01 = Math.min(1, along / (poolOut + hw + 4 + 0.3 * drop));
      size = Math.min(MAX_RADIUS, rBase * (1.25 - 0.6 * out01) * (0.35 + 1.6 * rnd(h, 9) ** 2));
    }
    place(north, east, size, lip ? f.top : f.bottom, h, lip ? 1 : 0.6, out);
  }
}
