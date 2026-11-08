// The structure of a seeded world's mountains (foundation stage 3, out/tree/PLAN.md §3.1-3.2, §3.6 item 3): what the
// steady-state model (erosion.ts steadyLattice) needs besides the uplift's broad envelope so that its rivers collect
// inside the ranges and leave them through a few gorges. Pure (no three.js), on the drainage lattice.
//
//  - Erodibility in bands along strike: hard and soft rock in belts parallel to the range front (bands of the distance
//    in from the front, wobbled along it). Rivers grade gently in the soft belts and steeply across the hard ones, and
//    the soft belts start lower (the start surface the first routing reads), so tributaries run along them as strike
//    valleys and gather before they cross out through a hard belt (a trellis).
//  - Faults (faults.ts) as steps in the uplift rate: the ground on a fault's up side rises faster, so its rivers stand
//    steeper there, with the break of slope (a knickpoint) at the trace, where falls.ts draws its fall.
//  - A late front block: a range rising a few kilometres out from the front after the main tree has formed. The rivers
//    that already carry A_crit or more keep their courses through it (their receivers are held: antecedent gorges); the
//    rest are turned aside behind it to join them (the Rakaia's gorge through the Mt Hutt front).

import { DRAIN_CELL } from './drainage';
import { fbm } from './noise';
import type { Fault } from './faults';

/** Settings of the structure (STRUCT). */
export interface StructParams {
  /** Erodibility bands: K is multiplied by 2^(kAmp x band), band in [-1, 1] (2: x1/4 .. x4). 0: none. */
  kAmp: number;
  /** Band spacing across strike (one hard and one soft belt), m. */
  kWave: number;
  /** Share of the spacing the soft belt takes (narrow soft belts between broad hard ones keep the ranges' relief). */
  kSoft: number;
  /** How far the bands wander along strike, in band spacings (a slow noise shifts their phase). */
  kWob: number;
  /** Share of the ranges where the bands show (a slow noise patches them in and out; 1: everywhere). */
  kPatch: number;
  /** How far a soft belt starts lower (and a hard one higher) on the start surface, m, at band +-1. */
  kStart: number;
  /** Faults' uplift step: the up side's rate is (1 + faultU x taper), faded out over faultReach from the trace, m. */
  faultU: number;
  faultReach: number;
  /** Front block: its rate (the uplift rate is raised to at least this there), the distances out from the front (the
   * orogen's mountain mask, ranges' share >= MTN_U) between which it stands, m, and its fade at either side, m. */
  blockRate: number;
  blockNear: number;
  blockFar: number;
  blockFade: number;
  /** Rivers from this catchment, km², keep their courses through the block (antecedent gorges). */
  blockA: number;
  /** How far the block's ground is raised at once before the rivers are routed again over it, m: those that cannot
   * hold a course over the rise are turned aside. */
  blockRaise: number;
  /** Route-and-solve iterations with the block. */
  blockIter: number;
  /** Share of the front along which a block stands (a noise threshold along it: blocks are segments, not a wall). */
  blockShare: number;
  /** A block stands only within this of a range exit of a river of blockA or more (fading out over its last third),
   * m: a segment of the front across each big river's way out. 0: the whole front band. */
  blockSpan: number;
  /** Beside a held river the block rises less, out to this many cells (its gorge's walls stand back). */
  blockGorge: number;
}

export const STRUCT: StructParams = {
  kAmp: 0,
  kWave: 9000,
  kSoft: 0.25,
  kWob: 1.2,
  kPatch: 0.6,
  kStart: 100,
  faultU: 0.3,
  faultReach: 12000,
  blockRate: 0.6,
  blockNear: 3000,
  blockFar: 12000,
  blockFade: 1500,
  blockA: 400,
  blockRaise: 3000,
  blockIter: 0,
  blockShare: 1,
  blockSpan: 0,
  blockGorge: 2,
};

let override: Partial<StructParams> | null = null;
/** Probes: change the structure's settings before a world is built (null: the defaults). */
export function setStructParams(p: Partial<StructParams> | null): void {
  override = p;
}
export const structParams = (): StructParams => ({ ...STRUCT, ...(override ?? {}) });
export const structKey = (p: StructParams): string => [p.kAmp, p.kWave, p.kSoft, p.kWob, p.kPatch, p.kStart, p.faultU, p.faultReach, p.blockRate, p.blockNear, p.blockFar, p.blockFade, p.blockA, p.blockRaise, p.blockIter, p.blockShare, p.blockSpan, p.blockGorge].join('_');

/** The ranges' share (erosion.ts ModelInputs.ur) from which a cell is mountain ground: the orogen's mask. */
export const MTN_U = 0.3;

/** The model's structure on the lattice (erosion.ts ModelInputs.struct). */
export interface Structure {
  /** Erodibility factor per cell (1: the model's K). */
  k: Float32Array;
  /** The start surface's offset from the noise ground per cell, m (the soft belts lower). */
  start: Float32Array;
  /** The uplift rate's factor per cell from the faults (1: none). */
  fault: Float32Array;
  /** The front block's band per cell, [0, 1] (all 0: no block): where a block may stand (placeBlock). */
  block: Float32Array;
  /** The orogen's mountain mask (ur >= MTN_U). */
  mtn: Uint8Array;
  p: StructParams;
}

const DI8 = [-1, -1, -1, 0, 0, 1, 1, 1];
const DJ8 = [-1, 0, 1, -1, 1, -1, 0, 1];

/** Chamfer distance, m, from the cells where `src` is set (Infinity where none reach). */
function distance(src: Uint8Array, n: number): Float32Array {
  const N = n * n;
  const d = new Float32Array(N).fill(Infinity);
  for (let c = 0; c < N; c++) if (src[c]) d[c] = 0;
  for (let pass = 0; pass < 4; pass++) {
    for (let k0 = 0; k0 < N; k0++) {
      const c = pass % 2 === 0 ? k0 : N - 1 - k0;
      if (d[c] === 0) continue;
      const i = (c / n) | 0;
      const j = c - i * n;
      let best = d[c];
      for (let q = 0; q < 8; q++) {
        const ii = i + DI8[q];
        const jj = j + DJ8[q];
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const v = d[ii * n + jj] + (DI8[q] && DJ8[q] ? Math.SQRT2 : 1) * DRAIN_CELL;
        if (v < best) best = v;
      }
      d[c] = best;
    }
  }
  return d;
}

/** Box blur of a lattice field, r cells, `passes` times (edges renormalised); Infinity is read as `cap`. */
function boxBlur(v: Float32Array, n: number, r: number, passes: number, cap: number): Float32Array {
  let a = Float32Array.from(v, (x) => (Number.isFinite(x) ? Math.min(x, cap) : cap));
  const t = new Float32Array(n * n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let s = 0;
        let w = 0;
        for (let k = Math.max(0, j - r); k <= Math.min(n - 1, j + r); k++) (s += a[i * n + k]), w++;
        t[i * n + j] = s / w;
      }
    }
    const b = new Float32Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let s = 0;
        let w = 0;
        for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) (s += t[k * n + j]), w++;
        b[i * n + j] = s / w;
      }
    }
    a = b;
  }
  return a;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * The structure of the current seeded world on the lattice (n x n from (origin, origin), DRAIN_CELL apart): `ur` the
 * ranges' share with the orogen's envelope, `fade` the uplift's fade toward the coast (1 from 15 km inland), `keep`
 * where the block may stand at all ([0, 1]: off the home field, its protected surfaces and the kept lakes), `faults`
 * the world's faults, `salt` the seed's noise offset.
 */
export function buildStructure(n: number, origin: number, ur: Float32Array, fade: Float32Array, keep: Float32Array, faults: ReadonlyArray<Fault>, salt: number, p: StructParams): Structure {
  const N = n * n;
  const k = new Float32Array(N).fill(1);
  const start = new Float32Array(N);
  const fault = new Float32Array(N).fill(1);
  const block = new Float32Array(N);
  const mtn = new Uint8Array(N);
  for (let c = 0; c < N; c++) mtn[c] = ur[c] >= MTN_U ? 1 : 0;
  const ox = (salt % 997) * 1.37;
  const oy = (salt % 991) * 2.11;

  // Erodibility bands: of the distance in from the front (smoothed, so the bands follow the front's broad line, not its
  // cell steps), wobbled along strike by a slow noise; a soft square wave, so a belt is mostly hard or soft.
  if (p.kAmp > 0) {
    const off = new Uint8Array(N);
    for (let c = 0; c < N; c++) off[c] = mtn[c] ? 0 : 1;
    const din = boxBlur(distance(off, n), n, 2, 2, 60000);
    for (let c = 0; c < N; c++) {
      const w = smooth(MTN_U, MTN_U + 0.15, ur[c]);
      if (w <= 0) continue;
      const north = origin + Math.floor(c / n) * DRAIN_CELL;
      const east = origin + (c % n) * DRAIN_CELL;
      const wob = p.kWob * fbm(east / 40000 + ox, north / 40000 + oy, 2);
      const patch = p.kPatch >= 1 ? 1 : smooth(-0.08, 0.08, fbm(east / 35000 - ox, north / 35000 + 2 * oy, 2) + 0.4 * (p.kPatch - 0.5) * 2);
      if (patch <= 0) continue;
      const s = Math.sin(2 * Math.PI * (din[c] / p.kWave + wob));
      const th = Math.cos(Math.PI * p.kSoft);
      const band = 2 * smooth(th - 0.3, th + 0.3, s) - 1;
      // (Its log-mean is 0: the soft belts as much softer as the hard ones are harder over their share, so the
      // ranges keep their height.)
      k[c] = Math.pow(2, p.kAmp * (band - (2 * p.kSoft - 1)) * w * patch);
      start[c] = -p.kStart * band * w * patch;
    }
  }

  // Faults: a step of the uplift rate across each trace, the up side (by the fault's index) rising faster, tapering
  // with the throw along the trace and fading out from it over faultReach.
  if (p.faultU > 0) {
    for (let fi = 0; fi < faults.length; fi++) {
      const f = faults[fi];
      const side = (((fi * 2654435761) ^ salt) >>> 0) % 2 === 0 ? 1 : -1;
      let tmax = 0;
      for (let q = 0; q < f.throw.length; q++) tmax = Math.max(tmax, f.throw[q]);
      if (tmax <= 0) continue;
      let n0 = Infinity, n1 = -Infinity, e0 = Infinity, e1 = -Infinity;
      for (let q = 0; q < f.north.length; q++) {
        n0 = Math.min(n0, f.north[q]); n1 = Math.max(n1, f.north[q]);
        e0 = Math.min(e0, f.east[q]); e1 = Math.max(e1, f.east[q]);
      }
      const R = p.faultReach + DRAIN_CELL;
      const i0 = Math.max(0, Math.floor((n0 - R - origin) / DRAIN_CELL));
      const i1 = Math.min(n - 1, Math.ceil((n1 + R - origin) / DRAIN_CELL));
      const j0 = Math.max(0, Math.floor((e0 - R - origin) / DRAIN_CELL));
      const j1 = Math.min(n - 1, Math.ceil((e1 + R - origin) / DRAIN_CELL));
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const pn = origin + i * DRAIN_CELL;
          const pe = origin + j * DRAIN_CELL;
          // Nearest point of the trace: signed distance (left of the trace's direction positive) and the throw there.
          let best = Infinity, sd = 0, th = 0, tAlong = 0;
          for (let q = 0; q < f.north.length - 1; q++) {
            const an = f.north[q], ae = f.east[q];
            const bn = f.north[q + 1] - an, be = f.east[q + 1] - ae;
            const L2 = bn * bn + be * be;
            const t = Math.max(0, Math.min(1, ((pn - an) * bn + (pe - ae) * be) / L2));
            const dn = pn - an - t * bn, de = pe - ae - t * be;
            const d = Math.hypot(dn, de);
            if (d < best) {
              best = d;
              sd = Math.sign(be * dn - bn * de) || 1;
              th = f.throw[q] + (f.throw[q + 1] - f.throw[q]) * t;
              tAlong = t > 0 && t < 1 ? 1 : 0;
            }
          }
          if (best > p.faultReach || sd !== side) continue;
          // Past the trace's tips the step fades with the distance (the end segment's clamp leaves best growing).
          const step = (th / tmax) * (1 - smooth(0.4 * p.faultReach, p.faultReach, best)) * (tAlong ? 1 : 1 - smooth(0, 3000, best));
          const c = i * n + j;
          fault[c] = Math.max(fault[c], 1 + p.faultU * step * smooth(0.1, 0.25, ur[c]));
        }
      }
    }
  }

  // Front block: land off the mountain mask, blockNear..blockFar out from it, from 15 km inland, on the share of the
  // front a slow noise along it leaves (segments with gaps between them).
  if (p.blockRate > 0) {
    const dout = distance(mtn, n);
    for (let c = 0; c < N; c++) {
      const d = dout[c];
      if (!(d > 0) || !Number.isFinite(d)) continue;
      const w = smooth(p.blockNear - p.blockFade, p.blockNear, d) * (1 - smooth(p.blockFar, p.blockFar + p.blockFade, d));
      if (w <= 0) continue;
      const north = origin + Math.floor(c / n) * DRAIN_CELL;
      const east = origin + (c % n) * DRAIN_CELL;
      const seg = p.blockShare >= 1 ? 1 : smooth(-0.05, 0.05, 0.5 * fbm(east / 30000 - oy, north / 30000 + ox, 2) + 0.5 - (1 - p.blockShare));
      block[c] = w * seg * fade[c] * fade[c] * keep[c];
    }
  }
  return { k, start, fault, block, mtn, p };
}

/** Dilate (max over a square of r cells) a lattice field. */
function dilate(v: Float32Array, n: number, r: number): Float32Array {
  const t = new Float32Array(n * n);
  const o = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    let m = 0;
    for (let k = Math.max(0, j - r); k <= Math.min(n - 1, j + r); k++) m = Math.max(m, v[i * n + k]);
    t[i * n + j] = m;
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    let m = 0;
    for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) m = Math.max(m, t[k * n + j]);
    o[i * n + j] = m;
  }
  return o;
}

/** The front block stands clear of the home field by these distances, m (none within the first, full past the second). */
const BLOCK_HOME = [8000, 14000];
/** ... and comes in between these distances from the lattice's edge, m (heightfield.ts SLOPE_EDGE: the model's change
 * carries on past the edge, and a block raised there would leave a step). */
const BLOCK_EDGE = [10000, 16000];
/** ... and this many cells clear of a kept lake or the home field's protected surfaces (ModelInputs.cap). */
const BLOCK_CAP_CLEAR = 3;

/**
 * The structure for a world's model inputs (erosion.ts ModelInputs): its ranges' share, fade, held ground (`hard`),
 * protected surfaces and kept lakes (`cap`), and the home field; null when nothing of it is set.
 */
export function structureFor(inp: { n: number; ur: Float32Array; fade?: Float32Array; hard: Float32Array; cap: Float32Array; home: { north: number; east: number } }, faults: ReadonlyArray<Fault>, salt: number, p: StructParams): Structure | null {
  if (p.kAmp <= 0 && p.faultU <= 0 && p.blockRate <= 0) return null;
  const n = inp.n;
  const N = n * n;
  const origin = -(n - 1) * DRAIN_CELL * 0.5;
  const capNear = dilate(inp.cap, n, BLOCK_CAP_CLEAR);
  const keep = new Float32Array(N);
  for (let c = 0; c < N; c++) {
    const north = origin + Math.floor(c / n) * DRAIN_CELL;
    const east = origin + (c % n) * DRAIN_CELL;
    const r = Math.hypot(north - inp.home.north, east - inp.home.east);
    const i = Math.floor(c / n);
    const j = c % n;
    const edge = DRAIN_CELL * Math.min(i, j, n - 1 - i, n - 1 - j);
    keep[c] = Math.min(1, inp.hard[c]) * (1 - Math.min(1, capNear[c])) * smooth(BLOCK_HOME[0], BLOCK_HOME[1], r) * smooth(BLOCK_EDGE[0], BLOCK_EDGE[1], edge);
  }
  const fade = inp.fade ?? new Float32Array(N).fill(1);
  return buildStructure(n, origin, inp.ur, fade, keep, faults, salt >>> 0, p);
}

/**
 * The front block's weight per cell from its band (Structure.block) and the tree the model has formed (receivers,
 * catchments in cells, a downstream-first order): with blockSpan, only within that of a range exit (a mountain cell
 * whose water leaves the mask and never meets it again) of a river of blockA or more; else the whole band.
 */
export function placeBlock(st: Structure, n: number, receiver: Int32Array, area: Float32Array, order: Int32Array): Float32Array {
  const p = st.p;
  const N = n * n;
  if (p.blockSpan <= 0) return st.block;
  const { mtn } = st;
  const down = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const c = order[k];
    const r = receiver[c];
    down[c] = r >= 0 && (mtn[r] || down[r]) ? 1 : 0;
  }
  const exits: number[] = [];
  for (let c = 0; c < N; c++) {
    const r = receiver[c];
    if (mtn[c] && r >= 0 && !mtn[r] && !down[r] && area[c] >= p.blockA) exits.push(c);
  }
  const w = new Float32Array(N);
  const R = Math.ceil(p.blockSpan / DRAIN_CELL);
  for (const e of exits) {
    const ei = (e / n) | 0;
    const ej = e - ei * n;
    for (let i = Math.max(0, ei - R); i <= Math.min(n - 1, ei + R); i++) {
      for (let j = Math.max(0, ej - R); j <= Math.min(n - 1, ej + R); j++) {
        const c = i * n + j;
        if (st.block[c] <= 0) continue;
        const d = Math.hypot(i - ei, j - ej) * DRAIN_CELL;
        const v = st.block[c] * (1 - smooth((2 / 3) * p.blockSpan, p.blockSpan, d));
        if (v > w[c]) w[c] = v;
      }
    }
  }
  return w;
}
