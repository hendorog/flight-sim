// The macro ground of a seeded world (any seed but 0): its rivers' valleys and the ridges between them as a landscape
// in balance between uplift and river incision, worked out at load on the drainage lattice (drainage.ts: DRAIN_CELL
// over +-DOMAIN_HALF). Pure (no three.js): every thread can run it and gets the same answer.
//
// The noise terrain has no history: its broad hollows are closed basins that no river would have left behind, and its
// slopes are the noise's. This pass replaces its relief on the lattice's scale with a steady state of the stream-power
// law of bedrock incision under an uplift field,
//
//     dh/dt = U - K A^m S        (A catchment area, S slope toward the receiver, n = 1),
//
// solved by the steady-state iteration of Cordonnier et al. (2016): route the water (priority flood from the sea and
// the domain's edge, then steepest descent on the filled surface, so a cell in a hollow drains toward its spill), set
// every cell downstream first to its receiver's height plus the steady drop U L / (K A^m), and route again, ITERATIONS
// times. Rivers capture their neighbours between iterations as the heights change. Started from the noise ground, so
// the first routing (where the rivers run) is today's and the tree changes only by local captures (out/tree/PLAN.md:
// over today's ranges the drainage-tree measures do not move). The drop is held between a gentlest graded gradient
// (`grade`, falling as A^-0.45: Flint's law, a gravel river on the plains where the uplift is about nil) and a
// threshold slope (`sc`, which touches only ridge cells at 1 km). The uplift rate comes from the generator's ranges
// and hill country (heightfield.ts upliftRate). The surface drains to base level by construction: no closed hollows
// are left on the lattice except where the home field is held (`hard`) or the era's volcano stands.
//
// The result T is the macro ground. The terrain applies it as a signed change of the noise ground (heightfield.ts
// applyMacro): the noise ground plus the B-spline of (T - noise lattice), which is T's B-spline plus the noise relief
// finer than the lattice (the B-spline is linear), plus each channel's valley carved along its smoothed course on a
// fine grid a quarter of the lattice's spacing. On a valley floor the finer relief and the gullies give way, so the
// floor keeps falling. C1 everywhere, so the terrain has no facets or creases at the lattice lines and no beads along
// a channel that steps diagonally. The change may raise the ground as well as lower it; nothing clamps it at 0.

import { DOMAIN_HALF, DRAIN_CELL, HOME_MOUND, HOME_RADIUS, LAKE_HOME_CLEAR, RIVER_AREA } from './drainage';
import type { SlopeField } from './hillslopes';
import { placeBlock, type Structure } from './structure';

/** Settings of the steady-state model. */
export interface SteadyParams {
  /** Route-and-solve iterations (the receivers settle within 20-30). */
  iterations: number;
  /** Steady drop over 1 km of a one-cell (1 km²) catchment where the uplift rate is 1, m: U / K. */
  ridge: number;
  /** Area exponent m of the stream-power law (n = 1). */
  m: number;
  /** Steepest a lattice step may stand over its receiver, m/m (threshold hillslope at 1 km). */
  sc: number;
  /** Gentlest gradient of a one-cell catchment, m/m, falling as A^-0.45 (a graded river). */
  grade: number;
}

/**
 * Set with the wide orogen (foundation stage 2, scripts/probes/orogenSweep.test.ts, out/f2/REPORT.md) on seeds 1, 42
 * and 777777: highest land p99 2100-2250 m (the seed-42 box's summits under ~2900 m, not the 3000-3500 m domes of
 * U/K 450 over the orogen), the ranges' 1 km slope p50 ~13 degrees, and the big rivers (>= 500 km²) at 400-700 m
 * graded at 0.4-0.6 % (stage 1's m 0.45 gave 1-2 % there over the orogen: n = 1 stream power on a 1 km lattice puts
 * the hillslopes' relief into the one-cell catchments, so the trunks came out too steep for the ridges' height).
 * m 0.6 is the lattice's concavity, steeper than the 0.41-0.45 of real channels measured at 20 m: the smallest
 * lattice catchments stand for hillslope as well as channel.
 */
export const STEADY: SteadyParams = { iterations: 30, ridge: 400, m: 0.6, sc: 0.45, grade: 0.06 };
/** Bump when the model or its inputs change meaning: part of the cache key (macroCache.ts). */
export const MODEL_VERSION = 'ss7-v1';

/** Catchment, cells, from which a diagonal step of a channel lowers the cells beside it. */
const CORNER_AREA = 10;
/** Lowest the model takes the land, m (the sea's surface is the base level, not the shelf under it). */
const LAND_MIN = 0.5;

/**
 * The model follows the noise ground within this distance of the home field, m, and runs fully beyond the second:
 * its site is chosen on the noise ground (homeSiting.ts) and held during the run.
 */
const HOME_KEEP = 1800;
const HOME_FULL = 3000;
/** No change at all within the first of these distances of the home field, m, faded in by the second. */
const PAD_KEEP = [1500, 2500];
/**
 * The home runway's protected surfaces (homeSiting.ts): the corridor along its axis out to CAP_ALONG either way,
 * CAP_ACROSS either side, and the circuit's box, m; the model may lower the ground there but not raise it over the
 * noise ground, fully within the first of CAP_FADE of them and not at all beyond the second.
 */
const CAP_ALONG = 10900;
const CAP_ACROSS = 400;
const CAP_BOX = [3500, 1800];
const CAP_FADE = [1000, 2500];
/** Beyond the lattice the change carries on from its edge and fades out over this distance, m. */
const OUTSIDE_FADE = 15000;

/** What the model runs on: the lattice samples of the noise ground and the uplift field (modelInputs). */
export interface ModelInputs {
  n: number;
  /** The noise ground at the cells with the routing mound over the home field, m. */
  h0: Float32Array;
  mound: Float32Array;
  /** Uplift rate per cell (1: the steady drop of `ridge` m per km on a one-cell catchment). */
  u: Float32Array;
  /** The ranges' share of the uplift rate per cell, with the orogen's envelope (orogenEnvelope) and before the fade
   * toward the coast: what tells mountain ground from hill country and plain here (the kept lakes, modelInputs). */
  ur: Float32Array;
  /** How much of the gentlest graded gradient (SteadyParams.grade) holds per cell, [0, 1]: less toward the coast,
   * where the plains are built by the rivers' gravel (heightfield.ts gradeShare). */
  g: Float32Array;
  /** Base-level cells (1): the sea and the domain's edge. */
  fixed: Uint8Array;
  /** How far each cell follows the model, [0, 1]: 0 within HOME_KEEP of the home field. */
  hard: Float32Array;
  /**
   * How far each cell is kept from rising over the noise ground, [0, 1]: 1 under the home runway's approach and
   * climb-out corridors and its circuit (homeSiting.ts checked them on the noise ground), faded out over CAP_FADE.
   */
  cap: Float32Array;
  /**
   * Lowest each cell may stand, m (0: no limit): the rims of the noise ground's lowland hollows kept as lakes
   * (keptHollows), at the noise ground, so the hollow still holds water on the model's ground.
   */
  sill: Float32Array;
  /** How many of the noise ground's hollows are kept as lakes (keptHollows). */
  lakes: number;
  home: { north: number; east: number; heading: number };
  /** The mountains' structure (structure.ts: erodibility bands, faults' uplift steps, the front block); null: none. */
  struct?: Structure | null;
  /** The uplift's fade toward the coast per cell (ModelSample.fade). */
  fade?: Float32Array;
}

/**
 * The wide orogen (out/tree/PLAN.md stage 2): the ranges' uplift spread from the ridged-noise belts into a mountain
 * mass some 40-80 km across, so the hill country between neighbouring belts rises as mountains and intermontane
 * valleys, the big rivers join inside the ranges and leave them through a few exits. The belts' uplift, blurred
 * (Gaussian, `sigma` m), scaled so the blurred field's top `gain` share rises at the full rate; the belts themselves
 * kept where they are higher (their crests stay the highest ground). Null: the narrow belts alone (a "Manawatu" seed:
 * narrow ranges in wide hill country).
 */
export interface Orogen {
  sigma: number;
  gain: number;
}

/** The macro ground of a seeded world, as the terrain applies it (sampleErosion, macroOffset, erosionGullies). */
export interface ErosionField {
  /** The model's signed change of the noise ground per lattice cell, m (T - noise lattice), B-spline interpolated. */
  delta: Float32Array;
  /** The noise ground at the cells (no mound), m: the residual finer than the lattice is the ground less its B-spline. */
  base: Float32Array;
  /** The channels' valleys carved along their smoothed courses on the fine grid (CUT_N x CUT_N from (-DOMAIN_HALF,
   * -DOMAIN_HALF), CUT_CELL apart), m (<= 0). */
  carve: Float32Array;
  /** Per lattice cell: whether any carve reaches the samples interpolated in it (a skip for the rest). */
  carveAny: Uint8Array;
  /**
   * How far each point of the fine grid lies on a channel's valley floor, 0-255 (FLOOR_HALF either side of its
   * course): the finer relief and the gullies give way there (erosionGullies), so the floor keeps falling.
   */
  floor: Uint8Array;
  /**
   * How far each point of the fine grid lies on a drawn river's own floor, 0-255 (markCourse: riverNetwork.ts marks its
   * valley axes once they are laid out, the floodplain and the swing of the channel either side): the relief finer than
   * the lattice gives way there, as on a channel's floor (`floor`), but not the gullies. All 0 until marked.
   */
  course: Uint8Array;
  /** Per lattice cell: whether any of `course` reaches the samples interpolated in it (a skip for the rest). */
  courseAny: Uint8Array;
  /** The home field, where the change is held at none over its pad (PAD_KEEP). */
  home: { north: number; east: number };
  /** The macro cells T (the noise lattice plus the change), with the corner fix below (a drawing fix for the
   * interpolated ground): the lakes and the breach cuts are settled on these (drainage.ts buildDrainage). */
  lattice: Float32Array;
  /** The same cells as the model routed them, before the corner fix: what the drainage routes the water over, so every
   * river runs down the channel the model carved (drainage.ts buildDrainage `routing`). */
  routing: Float32Array;
  /** How far each cell lies below the ground about it on T, m (>= 0): a river's own valley (riverNetwork.ts). */
  valley: Float32Array;
  /** The mountains' threshold hillslopes on the fine grid (hillslopes.ts), once worked out (attachSlopes); null before
   * and outside a seed's mountains. */
  slopes: SlopeField | null;
  /** Per lattice cell: whether any of the slopes' weight reaches the samples interpolated in it (a skip for the rest). */
  slopeAny: Uint8Array | null;
}

/** Spacing of the fine grid the valleys are drawn on, m: a quarter of the lattice's. */
export const CUT_CELL = 250;
const FINE = DRAIN_CELL / CUT_CELL;
const LATTICE_N = Math.round((2 * DOMAIN_HALF) / DRAIN_CELL) + 1;
/** Points per side of the fine grid. */
export const CUT_N = (LATTICE_N - 1) * FINE + 1;

/**
 * Channels drawn along their smoothed course: the catchment (cells) from which a channel is drawn, reaching full
 * strength at twice it, the samples per channel piece, the smoothing passes of the course, and the half-width of the
 * carve, m, at its least and growing with its depth (VALLEY_SLOPE: the steepest mean slope of the carve's sides).
 */
export const CHANNEL_AREA = 30;
const PIECE_SAMPLES = 6;
const COURSE_PASSES = 3;
const CARVE_HALF = 650;
const CARVE_HALF_MAX = 1600;
const VALLEY_SLOPE = 0.12;
/** Distance inside the fine grid's edge, m, over which the carve and the floor come in. */
const EDGE_KEEP = [1000, 3000];
/** Half-width of a channel's valley floor, m, where the finer relief and the gullies give way (erosionGullies). */
const FLOOR_HALF = 450;
/** Half-width of the window, cells, whose mean ground a cell's valley depth is measured from (valley): on river cells
 * its distribution matches the old erosion's cut there (p50 45-55 m), which riverNetwork.ts GORGE_CUT reads. */
const VALLEY_R = 1;

/**
 * Sample the model's inputs on the drainage lattice: `sample` writes the noise ground (`h`, m) and the uplift rate
 * (`u`) at a point. The home field (`home`, its site chosen on the noise ground) gets the routing mound (drainage.ts)
 * and is held (`hard`).
 */
export function modelInputs(sample: (north: number, east: number, out: ModelSample) => void, home: { north: number; east: number; heading: number }, orogen: Orogen | null = null, lakes = false): ModelInputs {
  const n = LATTICE_N;
  const origin = -DOMAIN_HALF;
  const N = n * n;
  const h0 = new Float32Array(N);
  const mound = new Float32Array(N);
  const u = new Float32Array(N);
  const ur = new Float32Array(N);
  const hu = new Float32Array(N);
  const fade = new Float32Array(N);
  const g = new Float32Array(N);
  const fixed = new Uint8Array(N);
  const hard = new Float32Array(N);
  const cap = new Float32Array(N);
  const sill = new Float32Array(N);
  const ch = Math.cos(home.heading);
  const sh = Math.sin(home.heading);
  const s: ModelSample = { h: 0, u: 0, g: 1, hill: 0, fade: 1 };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const north = origin + i * DRAIN_CELL;
      const east = origin + j * DRAIN_CELL;
      const c = i * n + j;
      s.hill = 0;
      s.fade = 1;
      sample(north, east, s);
      const r = Math.hypot(north - home.north, east - home.east);
      if (r < HOME_RADIUS) mound[c] = HOME_MOUND * (1 - r / HOME_RADIUS);
      h0[c] = s.h + mound[c];
      ur[c] = Math.max(0, s.u);
      hu[c] = Math.max(0, s.hill);
      fade[c] = s.fade;
      g[c] = Math.min(1, Math.max(0, s.g));
      fixed[c] = s.h <= 0 || i === 0 || j === 0 || i === n - 1 || j === n - 1 ? 1 : 0;
      hard[c] = smoothstep(HOME_KEEP, HOME_FULL, r);
      // (homeSiting.ts: north = c along - s across, east = s along + c across.)
      const dn = north - home.north;
      const de = east - home.east;
      const along = Math.abs(ch * dn + sh * de);
      const across = Math.abs(-sh * dn + ch * de);
      const corridor = Math.hypot(Math.max(0, along - CAP_ALONG), Math.max(0, across - CAP_ACROSS));
      const box = Math.hypot(Math.max(0, along - CAP_BOX[0]), Math.max(0, across - CAP_BOX[1]));
      cap[c] = 1 - smoothstep(CAP_FADE[0], CAP_FADE[1], Math.min(corridor, box));
    }
  }
  if (orogen) ur.set(orogenEnvelope(ur, n, orogen));
  for (let c = 0; c < N; c++) u[c] = Math.max(0, (ur[c] + hu[c]) * fade[c]);
  const kept = lakes ? keptHollows(h0, fixed, ur, n, home, cap, sill) : 0;
  return { n, h0, mound, u, ur, g, fixed, hard, cap, sill, lakes: kept, home: { north: home.north, east: home.east, heading: home.heading }, struct: null, fade };
}

/** What modelInputs' `sample` writes at a lattice node. */
export interface ModelSample {
  /** The noise ground, m. */
  h: number;
  /** The ranges' uplift rate (before the orogen's envelope), and the hill country's, and their fade toward the coast
   * (the rate is (envelope(u) + hill) x fade). */
  u: number;
  hill: number;
  fade: number;
  /** The share of the gentlest graded gradient that holds (ModelInputs.g). */
  g: number;
}

/** The ranges' uplift share `r` (n x n) spread into the wide orogen (Orogen). */
export function orogenEnvelope(r: Float32Array, n: number, o: Orogen): Float32Array {
  const b = blur(r, n, o.sigma / DRAIN_CELL);
  let top = 0;
  for (let c = 0; c < b.length; c++) top = Math.max(top, b[c]);
  const out = new Float32Array(r.length);
  if (top <= 0) return r.slice();
  for (let c = 0; c < r.length; c++) out[c] = Math.max(r[c], Math.min(1, (o.gain * b[c]) / top));
  return out;
}

/** Separable Gaussian blur of an n x n lattice field, `sigma` in cells (weights renormalised at the edges). */
function blur(v: Float32Array, n: number, sigma: number): Float32Array {
  const R = Math.ceil(3 * sigma);
  const w = new Float64Array(2 * R + 1);
  for (let k = 0; k <= 2 * R; k++) w[k] = Math.exp(-((k - R) ** 2) / (2 * sigma * sigma));
  const tmp = new Float32Array(n * n);
  const out = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      let ws = 0;
      for (let k = Math.max(-R, -j); k <= Math.min(R, n - 1 - j); k++) {
        s += w[k + R] * v[i * n + j + k];
        ws += w[k + R];
      }
      tmp[i * n + j] = s / ws;
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      let ws = 0;
      for (let k = Math.max(-R, -i); k <= Math.min(R, n - 1 - i); k++) {
        s += w[k + R] * tmp[(i + k) * n + j];
        ws += w[k + R];
      }
      out[i * n + j] = s / ws;
    }
  }
  return out;
}

/**
 * The lowland lakes (owner, 2026-11-08: they stay; the mountain ones may go until the ice stage). The steady state
 * drains by construction, so it would fill every hollow of the noise ground. The noise ground's closed hollows that
 * could hold a lake as drainage.ts judges one (at least LAKE_DEPTH_KEEP deep over a river's breach allowance,
 * LAKE_CELLS_KEEP cells) and lie off the
 * ranges (the ranges' uplift share at the hollow's deepest cell, with the orogen's envelope, under LAKE_RANGE_U: hill
 * country and plain) are kept: their cells may not rise over the noise ground (`cap`) and their rims may not fall
 * under it (`sill`). The flood still routes through them to their spill, so a kept lake sits in the
 * drainage tree as before, its inflows graded down to it and its outflow leaving over its sill. Returns the count.
 */
function keptHollows(h0: Float32Array, fixed: Uint8Array, ur: Float32Array, n: number, home: { north: number; east: number }, cap: Float32Array, sill: Float32Array): number {
  const N = n * n;
  const R = new SteadyRouter(n);
  R.route(h0, fixed);
  const filled = R.filledLevels;
  const comp = new Int32Array(N).fill(-1);
  const stack: number[] = [];
  const origin = -DOMAIN_HALF;
  let kept = 0;
  for (let c0 = 0; c0 < N; c0++) {
    if (comp[c0] >= 0 || fixed[c0] || filled[c0] - h0[c0] <= HOLLOW_KEEP_TOL) continue;
    const cells: number[] = [];
    comp[c0] = c0;
    stack.push(c0);
    let pit = c0;
    let level = 0;
    while (stack.length) {
      const c = stack.pop() as number;
      cells.push(c);
      if (h0[c] < h0[pit]) pit = c;
      level = Math.max(level, filled[c]);
      const i = (c / n) | 0;
      const j = c - i * n;
      for (let k = 0; k < 8; k++) {
        const ii = i + DI8[k];
        const jj = j + DJ8[k];
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const q = ii * n + jj;
        if (comp[q] >= 0 || fixed[q] || filled[q] - h0[q] <= HOLLOW_KEEP_TOL) continue;
        comp[q] = c0;
        stack.push(q);
      }
    }
    // (A big river through it keeps its course through the rim: drainage.ts cuts a pond out where the breach
    // allowance, BREACH_DEPTH sqrt(A), leaves it under LAKE_DEPTH, unless the rim is too long to cut. Holding such a
    // hollow on a trunk river would only leave a notch through ungraded ground on its way.)
    let area = 0;
    for (const c of cells) area = Math.max(area, R.area[c]);
    if (level - h0[pit] < LAKE_DEPTH_KEEP + (area >= BREACH_AREA ? BREACH_KEEP * Math.sqrt(area) : 0) || cells.length < LAKE_CELLS_KEEP[0] || cells.length > LAKE_CELLS_KEEP[1] || ur[pit] >= LAKE_RANGE_U) continue;
    let near = false;
    for (const c of cells) if (Math.hypot(origin + Math.floor(c / n) * DRAIN_CELL - home.north, origin + (c % n) * DRAIN_CELL - home.east) < LAKE_HOME_CLEAR) near = true;
    if (near) continue;
    kept++;
    for (const c of cells) cap[c] = 1;
    // The rim, and the ring beyond it, may rise but not fall under the noise ground (the rim is raised toward the spill
    // level by up to SILL_RAISE: the cell past the spill a low sill, not a dam): the terrain takes the model's change
    // as a B-spline, which would carry the lowering of the graded ground outside into the rim and let the lake out.
    let ring = cells;
    for (let r = 0; r < SILL_RINGS; r++) {
      const next: number[] = [];
      for (const c of ring) {
        const i = (c / n) | 0;
        const j = c - i * n;
        for (let k = 0; k < 8; k++) {
          const ii = i + DI8[k];
          const jj = j + DJ8[k];
          if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
          const q = ii * n + jj;
          const lo = r === 0 ? Math.max(h0[q], Math.min(level, h0[q] + SILL_RAISE)) : h0[q];
          if (comp[q] === c0 || fixed[q] || sill[q] >= lo) continue;
          sill[q] = lo;
          next.push(q);
        }
      }
      ring = next;
    }
  }
  return kept;
}
/** Rings of cells round a kept lake that may not fall under the noise ground, and how far the rim is raised toward
 * the spill level, m. */
const SILL_RINGS = 2;
const SILL_RAISE = 20;
/** A noise hollow's cells: filled more than this, m (drainage.ts HOLLOW_TOL). */
const HOLLOW_KEEP_TOL = 0.5;
/** A kept hollow is at least this deep, m, and this many cells (drainage.ts LAKE_DEPTH, LAKE_CELLS; POND_MAX_CELLS). */
const LAKE_DEPTH_KEEP = 15;
/** drainage.ts BREACH_DEPTH: a river's breach allowance through a rim, m per sqrt(km²), checked from this catchment,
 * km² (smaller rivers' ponds mostly stand behind rims too long to cut). */
const BREACH_KEEP = 3;
const BREACH_AREA = 500;
const LAKE_CELLS_KEEP = [2, 120];
/** Ranges' uplift share from which a hollow counts as mountain ground and is graded away (treeMetrics.ts field
 * classes: the alpine uplift 0.25, here over its 1.15). */
const LAKE_RANGE_U = 0.25 / 1.15;

/** A key for the model's result: the inputs and the settings, hashed (FNV-1a over their bytes), with MODEL_VERSION. */
export function modelKey(inp: ModelInputs, p: SteadyParams = STEADY): string {
  let h = 0x811c9dc5;
  const mixIn = (a: ArrayBufferView): void => {
    const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let k = 0; k < b.length; k++) h = Math.imul(h ^ b[k], 0x01000193);
  };
  mixIn(inp.h0);
  mixIn(inp.u);
  mixIn(inp.g);
  mixIn(inp.fixed);
  mixIn(inp.hard);
  mixIn(inp.cap);
  mixIn(inp.sill);
  if (inp.struct) {
    mixIn(inp.struct.k);
    mixIn(inp.struct.start);
    mixIn(inp.struct.fault);
    mixIn(inp.struct.block);
    const q = inp.struct.p;
    mixIn(new Float64Array([q.blockRate, q.blockA, q.blockRaise, q.blockIter, q.blockSpan, q.blockGorge]));
  }
  mixIn(new Float64Array([p.iterations, p.ridge, p.m, p.sc, p.grade, inp.home.north, inp.home.east, inp.home.heading]));
  return `${MODEL_VERSION}-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * The steady-state macro cells T (with the routing mound, as `h0`), m: the costly part, the same in every thread (a
 * cache can hand it over: macroCache.ts). Fixed cells keep their height; a held cell (`hard` < 1) keeps that share
 * of its noise height; under the home runway's corridors (`cap`) a cell rises no higher than its noise height.
 */
/** Probes: the front block's weight the last steadyLattice placed (structure.ts placeBlock), null if none. */
export let lastBlock: Float32Array | null = null;
export function steadyLattice(inp: ModelInputs, p: SteadyParams = STEADY): Float32Array {
  lastBlock = null;
  const { n, h0, g, fixed, hard, cap, sill } = inp;
  const st = inp.struct ?? null;
  const N = n * n;
  const h = h0.slice();
  let u = inp.u;
  // The structure (structure.ts): the faults' steps of the uplift rate, the erodibility bands and the start surface
  // the first routing reads (the soft belts lower).
  if (st) {
    u = new Float32Array(N);
    for (let c = 0; c < N; c++) u[c] = inp.u[c] * st.fault[c];
    for (let c = 0; c < N; c++) if (!fixed[c]) h[c] += st.start[c] * hard[c];
  }
  const kf = st ? st.k : null;
  const R = new SteadyRouter(n);
  const L = DRAIN_CELL;
  const per = L / 1000;
  const solve = (uu: Float32Array, hold: Int32Array | null): void => {
    R.route(h, fixed, hold);
    const { receiver, order, area, diag } = R;
    for (let k = 0; k < order.length; k++) {
      const c = order[k];
      const r = receiver[c];
      if (r < 0 || fixed[c]) continue;
      const a = area[c];
      const dist = diag[c] ? Math.SQRT2 : 1;
      const rise = Math.max((p.ridge * per * uu[c] * Math.pow(a, -p.m)) / (kf ? kf[c] : 1), p.grade * g[c] * L * Math.pow(a, -0.45)) * dist;
      let hs = Math.max(h[r], LAND_MIN) + Math.min(rise, p.sc * L * dist);
      // Under the home runway's protected surfaces the ground may fall but not rise.
      if (cap[c] > 0 && hs > h0[c]) hs -= cap[c] * (hs - h0[c]);
      // A kept lake's rim stays at its spill level (keptHollows).
      if (hs < sill[c]) hs = sill[c];
      const k0 = hard[c];
      h[c] = k0 >= 1 ? hs : h0[c] + k0 * (hs - h0[c]);
    }
  };
  for (let s = 0; s < p.iterations; s++) solve(u, null);
  // The late front block (structure.ts): the tree as it stands holds the courses of its rivers of blockA or more
  // (antecedent gorges); the block's ground rises at once by blockRaise and its rate is raised to blockRate, and the
  // rest is routed again over it, turned aside behind it where it cannot hold a course over the rise.
  if (st && st.p.blockRate > 0) {
    const block = placeBlock(st, n, R.receiver, R.area, R.order);
    lastBlock = block;
    let any = false;
    for (let c = 0; c < N; c++) if (block[c] > 0) any = true;
    if (any) {
      const hold = new Int32Array(N).fill(-1);
      for (let c = 0; c < N; c++) if (!fixed[c] && R.area[c] >= st.p.blockA && R.receiver[c] >= 0) hold[c] = R.receiver[c];
      // (The block rises less beside a held river, within st.p.blockGorge cells: its gorge is wider than one cell, so
      // the drawn river's channel is not cut into a wall standing at its margin.)
      const gorge = new Float32Array(N).fill(1);
      const G = st.p.blockGorge;
      if (G > 0) {
        for (let c = 0; c < N; c++) {
          if (hold[c] < 0 || block[c] <= 0) continue;
          const ci = (c / n) | 0;
          const cj = c - ci * n;
          for (let di = -G; di <= G; di++) {
            for (let dj = -G; dj <= G; dj++) {
              const ii = ci + di;
              const jj = cj + dj;
              if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
              const d = Math.hypot(di, dj);
              const f = Math.min(1, d / (G + 1));
              const q = ii * n + jj;
              if (f < gorge[q]) gorge[q] = f;
            }
          }
        }
      }
      const ub = new Float32Array(N);
      const hr = h.slice();
      for (let c = 0; c < N; c++) {
        const w = block[c] * (hold[c] >= 0 ? 1 : gorge[c]);
        ub[c] = u[c] + w * Math.max(0, st.p.blockRate * (inp.fade ? inp.fade[c] : 1) - u[c]);
        if (!fixed[c] && hold[c] < 0) hr[c] += st.p.blockRaise * w * Math.min(1, hard[c]);
      }
      // Routed once over the risen block (the big rivers held), then the heights solved on that routing; then
      // blockIter free iterations (the big rivers still held), where the rest may capture each other again.
      R.route(hr, fixed, hold);
      const all = Int32Array.from(R.receiver);
      solve(ub, all);
      for (let s = 0; s < st.p.blockIter; s++) solve(ub, hold);
    }
  }
  return h;
}

/**
 * The terrain's field from the model's cells `T` (steadyLattice, or the same handed over by a cache): the change,
 * the channels' valleys carved on the fine grid along their smoothed courses, their floors, and each cell's valley
 * depth, faded out near the home field.
 */
export function buildErosion(inp: ModelInputs, T: Float32Array): ErosionField {
  const n = inp.n;
  const origin = -DOMAIN_HALF;
  const { h0, mound, fixed, hard, home, sill } = inp;
  const fadeAt = (north: number, east: number): number => smoothstep(HOME_KEEP, HOME_FULL, Math.hypot(north - home.north, east - home.east));
  const h = T.slice();
  const R = new SteadyRouter(n);
  R.route(h, fixed);
  // No lake may lie by the home field (drainage.ts LAKE_HOME_CLEAR): a river's hollow there (the held field standing
  // under the model's ground about it) would be breached by the drainage, its river cut down through ground the model
  // left standing. Its valley is cut here instead, and the channels routed again down it.
  if (drainByHome(h, n, home, hard, R.area)) R.route(h, fixed);
  const { receiver, area, order, diag } = R;
  // (The cells as routed, before the corner fix below: what the drainage routes the water over.)
  const routedCells = h.slice();
  // A channel that steps diagonally between two cells would leave a saddle between them in the interpolated
  // terrain (the two cells beside the step are still high): bring those down to the mean of the step's two ends,
  // so the valley floor runs on down the diagonal.
  for (let k = 0; k < order.length; k++) {
    const c = order[k];
    const r = receiver[c];
    if (r < 0 || !diag[c] || area[c] < CORNER_AREA) continue;
    const mid = 0.5 * (h[c] + Math.max(h[r], LAND_MIN));
    const ic = (c / n) | 0;
    const ir = (r / n) | 0;
    const a = ir * n + (c - ic * n);
    const b = ic * n + (r - ir * n);
    if (!fixed[a] && h[a] > mid) h[a] = Math.max(Math.min(h[a], sill[a]), h[a] - (h[a] - mid) * hard[a]);
    if (!fixed[b] && h[b] > mid) h[b] = Math.max(Math.min(h[b], sill[b]), h[b] - (h[b] - mid) * hard[b]);
  }
  // The macro cells (what the drainage routes and the valleys are carved from), and the signed change as the terrain
  // interpolates it: there the edge cells take their inner neighbours' change, so the interpolation leaves the lattice
  // level (C1). (Not in the cells the drainage routes: an edge cell raised or lowered so would leave a false rim or
  // hollow beside the domain's edge, and the drainage would breach a gorge through the ground the model built.)
  const change = new Float32Array(n * n);
  const base = new Float32Array(n * n);
  const eroded = new Float32Array(n * n);
  const routing = new Float32Array(n * n);
  for (let c = 0; c < n * n; c++) {
    change[c] = h[c] - h0[c];
    base[c] = h0[c] - mound[c];
    eroded[c] = base[c] + change[c];
    routing[c] = base[c] + (routedCells[c] - h0[c]);
  }
  copyEdges(change, n);
  const N = CUT_N;
  const surface = upsample(eroded, n);
  const carve = new Float32Array(N * N);
  const floorMask = new Uint8Array(N * N);
  // Each channel's course (channelCourse): the valley is carved along it, and the rivers are laid on it (riverNetwork.ts).
  const channel: number[] = [];
  for (let c = 0; c < n * n; c++) if (area[c] >= CHANNEL_AREA) channel.push(c);
  const { pn, pe } = channelCourse(n, origin, receiver, area);
  const sn = new Float64Array(PIECE_SAMPLES + 1);
  const se = new Float64Array(PIECE_SAMPLES + 1);
  const ex = new Float64Array(PIECE_SAMPLES + 1);
  const fk = new Float64Array(PIECE_SAMPLES + 1);
  const carvePiece = (a: number, c: number, r: number, strength: number): void => {
    // Quadratic B-spline piece from the middle of a->c, about c, to the middle of c->r (a = c: from the cell itself),
    // through the smoothed course.
    const cn0 = pn[a];
    const ce0 = pe[a];
    const cn1 = pn[c];
    const ce1 = pe[c];
    const cn2 = pn[r];
    const ce2 = pe[r];
    const pn0 = 0.5 * (cn0 + cn1);
    const pe0 = 0.5 * (ce0 + ce1);
    const pn2 = 0.5 * (cn1 + cn2);
    const pe2 = 0.5 * (ce1 + ce2);
    const f0 = 0.5 * (eroded[a] + eroded[c]);
    const f1 = eroded[c];
    const f2 = 0.5 * (eroded[c] + Math.max(eroded[r], LAND_MIN));
    let any = false;
    for (let k = 0; k <= PIECE_SAMPLES; k++) {
      const t = k / PIECE_SAMPLES;
      const w0 = (1 - t) * (1 - t);
      const w1 = 2 * t * (1 - t);
      const w2 = t * t;
      const qn = w0 * pn0 + w1 * cn1 + w2 * pn2;
      const qe = w0 * pe0 + w1 * ce1 + w2 * pe2;
      sn[k] = qn;
      se[k] = qe;
      const fl = w0 * f0 + w1 * f1 + w2 * f2;
      fk[k] = fl;
      ex[k] = Math.max(0, bicubic(eroded, n, origin, DRAIN_CELL, qn, qe, true) - fl) * strength;
      if (ex[k] > 0) any = true;
    }
    for (let k = 0; k < PIECE_SAMPLES; k++) {
      markFloor(floorMask, N, sn[k], se[k], sn[k + 1], se[k + 1], strength);
      if (any && (ex[k] > 0 || ex[k + 1] > 0)) carveSegment(carve, surface, N, sn[k], se[k], fk[k], sn[k + 1], se[k + 1], fk[k + 1], Math.max(ex[k], ex[k + 1]), strength);
    }
  };
  for (const c of channel) {
    const r = receiver[c];
    const ac = area[c];
    if (r < 0) continue;
    const strength = smoothstep(CHANNEL_AREA, 2 * CHANNEL_AREA, ac);
    // A channel's first cell starts from itself; every donor joins along its own piece to the middle of c->r.
    let donors = 0;
    const ic = (c / n) | 0;
    const jc = c - ic * n;
    for (let k = 0; k < 8; k++) {
      const i = ic + DI8[k];
      const j = jc + DJ8[k];
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const d = i * n + j;
      if (receiver[d] !== c || area[d] < CHANNEL_AREA) continue;
      donors++;
      carvePiece(d, c, r, strength);
    }
    if (donors === 0) carvePiece(c, c, r, strength);
  }
  // The carve, faded out near home as the change is, and with the floor faded out toward the fine grid's edge (none
  // within EDGE_KEEP[0] of it: the samples there read neither, so the ground stays continuous across it).
  for (let y = 0; y < N; y++) {
    const north = origin + y * CUT_CELL;
    for (let x = 0; x < N; x++) {
      const q = y * N + x;
      const edge = smoothstep(EDGE_KEEP[0], EDGE_KEEP[1], CUT_CELL * Math.min(x, y, N - 1 - x, N - 1 - y));
      if (carve[q] < 0) carve[q] *= fadeAt(north, origin + x * CUT_CELL) * edge;
      if (floorMask[q] > 0) floorMask[q] = Math.round(floorMask[q] * edge);
    }
  }
  // The lattice cells whose interpolation (4 x 4 fine points about each of the cell's own) touches any carve.
  const carveAny = new Uint8Array(n * n);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (carve[y * N + x] === 0) continue;
      const i0 = Math.max(0, Math.floor((y - 2) / FINE));
      const i1 = Math.min(n - 1, Math.floor((y + 1) / FINE));
      const j0 = Math.max(0, Math.floor((x - 2) / FINE));
      const j1 = Math.min(n - 1, Math.floor((x + 1) / FINE));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) carveAny[i * n + j] = 1;
    }
  }
  return { delta: change, base, carve, carveAny, floor: floorMask, course: new Uint8Array(N * N), courseAny: new Uint8Array(n * n), home: { north: home.north, east: home.east }, lattice: eroded, routing, valley: valleyDepth(eroded, n, fixed), slopes: null, slopeAny: null };
}

/**
 * A channel's course, for every cell of CHANNEL_AREA or more (cells; `receiver` and `area` a routing of the lattice of
 * `n` cells a side from `origin`): its centre, then COURSE_PASSES [1 2 1] passes with its receiver and its main donor
 * (the largest of CHANNEL_AREA or more) at once over the whole tree; a cell lacking either keeps its place. The model
 * carves its valleys along these courses (buildErosion), and the rivers are laid on them (riverNetwork.ts), each as the
 * same quadratic B-spline through them.
 */
export function channelCourse(n: number, origin: number, receiver: ArrayLike<number>, area: ArrayLike<number>): { pn: Float64Array; pe: Float64Array } {
  const channel: number[] = [];
  const main = new Int32Array(n * n).fill(-1);
  for (let c = 0; c < n * n; c++) {
    const r = receiver[c];
    if (area[c] < CHANNEL_AREA) continue;
    channel.push(c);
    if (r >= 0 && (main[r] < 0 || area[c] > area[main[r]])) main[r] = c;
  }
  const pn = new Float64Array(n * n);
  const pe = new Float64Array(n * n);
  for (const c of channel) {
    pn[c] = origin + ((c / n) | 0) * DRAIN_CELL;
    pe[c] = origin + (c % n) * DRAIN_CELL;
  }
  const qn = new Float64Array(n * n);
  const qe = new Float64Array(n * n);
  for (let pass = 0; pass < COURSE_PASSES; pass++) {
    for (const c of channel) {
      const r = receiver[c];
      const m = main[c];
      if (r < 0 || m < 0) {
        qn[c] = pn[c];
        qe[c] = pe[c];
        continue;
      }
      qn[c] = 0.25 * pn[m] + 0.5 * pn[c] + 0.25 * pn[r];
      qe[c] = 0.25 * pe[m] + 0.5 * pe[c] + 0.25 * pe[r];
    }
    for (const c of channel) {
      pn[c] = qn[c];
      pe[c] = qe[c];
    }
  }
  return { pn, pe };
}

/** How far each cell lies below the mean of the macro cells within VALLEY_R of it (land only), m (>= 0). */
function valleyDepth(t: Float32Array, n: number, fixed: Uint8Array): Float32Array {
  const out = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const c = i * n + j;
      if (fixed[c]) continue;
      let s = 0;
      let k = 0;
      for (let ii = Math.max(0, i - VALLEY_R); ii <= Math.min(n - 1, i + VALLEY_R); ii++) {
        for (let jj = Math.max(0, j - VALLEY_R); jj <= Math.min(n - 1, j + VALLEY_R); jj++) {
          s += Math.max(t[ii * n + jj], 0);
          k++;
        }
      }
      out[c] = Math.max(0, s / k - t[c]);
    }
  }
  return out;
}

/** The threshold hillslopes give way to a drawn river's own floor (hillslopes.ts riverCore) from the first of these to
 * the second (its core, where its level is read: the ground there stays the model's). Across the whole of the core's
 * taper: the slopes' ground (on the 250 m grid) can stand a couple of hundred metres over the model's beside a river's
 * floor narrower than a node, and over the taper's last half (from 0.5) it came in as a wall 60-90 m high in 25 m
 * (seeds 1 / 42 / 777777: 128 / 80 / 268 of them once the valley carve no longer cut them away). */
const COURSE_SLOPES = [0, 0.95];
/** ... and the gullies come back over the same (ErosionSample.mg): over the last tenth of it only, the slopes' ground
 * stood over the model's full gully relief across the rest, and where a river's channel swings onto the taper its
 * troughs lay under the water (water over the ground > 10 m, seeds 1 / 42 / 777777: 60 / 13 / 28 with that, 55 / 10 /
 * 23 without; overGround). */
const COURSE_GULLIES = [0, 0.95];

/** Hand the field its threshold hillslopes (hillslopes.ts thresholdSlopes), with the skip per lattice cell. */
export function attachSlopes(f: ErosionField, s: SlopeField): void {
  const n = LATTICE_N;
  const N = CUT_N;
  const any = new Uint8Array(n * n);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (s.w[y * N + x] === 0) continue;
      const i0 = Math.max(0, Math.floor((y - 2) / FINE));
      const i1 = Math.min(n - 1, Math.floor((y + 1) / FINE));
      const j0 = Math.max(0, Math.floor((x - 2) / FINE));
      const j1 = Math.min(n - 1, Math.floor((x + 1) / FINE));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) any[i * n + j] = 1;
    }
  }
  f.slopes = s;
  f.slopeAny = any;
}

/** The model at a point (sampleErosion), for macroOffset and erosionGullies. */
export interface ErosionSample {
  /** The lattice's change, interpolated (B-spline), m. */
  d: number;
  /** The carve on the fine grid, m (<= 0 but for the interpolation's ringing). */
  c: number;
  /** How far the point lies on a valley floor, [0, 1]. */
  f: number;
  /** How far the relief finer than the lattice gives way, [0, 1]: on a valley floor and in the model's valleys. */
  w: number;
  /** The noise lattice's B-spline (where w > 0), m. */
  r: number;
  /** How much of the change is kept: none over the home field's pad. */
  keep: number;
  /** How far outside the lattice the point lies, m (0 inside). */
  o: number;
  /** The threshold hillslopes (hillslopes.ts): how far the ground takes them, [0, 1] (0: none here), the ground they
   * built (Catmull-Rom), m, and how far the point lies on one of their channels' floors, [0, 1]. */
  m: number;
  hs: number;
  ch: number;
  /** How far the gullies give way to the threshold hillslopes' valleys, [0, 1]: the weight, off only on a drawn river's
   * core (where the ground stays the model's, gullies and all), so they do not come back in the band where the ground
   * blends from the slopes to the river's floor. */
  mg: number;
  /** The threshold hillslopes' own weight (their mountain mask, SlopeField.w, by the home pad's keep), [0, 1]: not off
   * on a river's core, so smooth across it (heightfield.ts carveNetwork lowers their walls by it, riverNetwork.ts
   * wallLift). */
  mw: number;
  north: number;
  east: number;
}

const DOMAIN_LO = -DOMAIN_HALF;

/**
 * The relief finer than the lattice gives way in the model's valleys as well as on the channels' floors: from none
 * where the valley depth (`valley`, B-spline) is the first of these, m, to all of it at the second. It is the noise's
 * own, not laid out along the model's valleys, and left in them it closes them into hollows (the seed 42 mountain box:
 * 43 dry closed basins over 50 m deep with it, 1 without; the ridges and slopes keep it, so slope and relief over 1 km
 * stay as they were). Probes: setResidualFade.
 */
let RESIDUAL_FADE = [20, 100];
export function setResidualFade(fade: number[]): void {
  RESIDUAL_FADE = fade;
}
/** smoothstep over RESIDUAL_FADE and its derivative (into fadeD). */
let fadeD = 0;
function residualFade(x: number): number {
  const a = RESIDUAL_FADE[0];
  const b = RESIDUAL_FADE[1];
  const t = (x - a) / (b - a);
  if (t <= 0 || t >= 1) {
    fadeD = 0;
    return t <= 0 ? 0 : 1;
  }
  fadeD = (6 * t * (1 - t)) / (b - a);
  return t * t * (3 - 2 * t);
}

/** The model at (north, east), into `out`. */
export function sampleErosion(f: Pick<ErosionField, 'delta' | 'base' | 'carve' | 'carveAny' | 'floor' | 'course' | 'courseAny' | 'home' | 'valley' | 'slopes' | 'slopeAny'>, north: number, east: number, out: ErosionSample): void {
  out.north = north;
  out.east = east;
  out.d = bicubic(f.delta, LATTICE_N, DOMAIN_LO, DRAIN_CELL, north, east, true);
  const fy = (north - DOMAIN_LO) / CUT_CELL;
  const fx = (east - DOMAIN_LO) / CUT_CELL;
  const inside = fy >= 1 && fx >= 1 && fy < CUT_N - 2 && fx < CUT_N - 2;
  out.c = inside && f.carveAny[cellAt(north, east)] ? catmullRom(f.carve, CUT_N, fy, fx) : 0;
  out.f = inside ? Math.min(1, Math.max(0, catmullRomU8(f.floor, CUT_N, fy, fx) / 255)) : 0;
  const g = residualFade(bicubic(f.valley, LATTICE_N, DOMAIN_LO, DRAIN_CELL, north, east, true));
  const k = inside && f.courseAny[cellAt(north, east)] ? Math.min(1, Math.max(0, catmullRomU8(f.course, CUT_N, fy, fx) / 255)) : 0;
  out.w = 1 - (1 - out.f) * (1 - g) * (1 - k);
  out.r = out.w > 0 ? bicubic(f.base, LATTICE_N, DOMAIN_LO, DRAIN_CELL, north, east, true) : 0;
  out.keep = padKeep(f.home, north, east);
  out.o = outside(north, east);
  out.m = out.hs = out.ch = out.mg = out.mw = 0;
  const sl = f.slopes;
  if (sl && inside && (f.slopeAny as Uint8Array)[cellAt(north, east)]) {
    const kr = catmullRomU8(sl.core, CUT_N, fy, fx) / 255;
    const m0 = Math.min(1, Math.max(0, catmullRomU8(sl.w, CUT_N, fy, fx) / 255));
    out.mg = m0 * (1 - smoothstep(COURSE_GULLIES[0], COURSE_GULLIES[1], kr)) * out.keep;
    out.mw = m0 * out.keep;
    const m = m0 * (1 - smoothstep(COURSE_SLOPES[0], COURSE_SLOPES[1], kr));
    if (m > 1e-4) {
      out.m = Math.min(1, m) * out.keep;
      out.hs = catmullRom(sl.h, CUT_N, fy, fx);
      out.ch = Math.min(1, Math.max(0, catmullRomU8(sl.chan, CUT_N, fy, fx) / 255));
      if (out.ch > 0) out.hs += out.ch * (bilinear(sl.h, CUT_N, fy, fx) - out.hs);
    }
  }
}

/**
 * The threshold hillslopes' ground (hillslopes.ts) smoothed - its B-spline over the fine grid's nodes - less the ground
 * the terrain draws from it (sampleErosion: Catmull-Rom, bilinear along the channels), by the weight the terrain takes
 * it, m. The drawn ground follows the 250 m grid: a valley turns at its nodes in 45 degree steps, and beside a channel
 * the bilinear cells are planes facing along the grid's rows and columns. Water routed over the drawn ground plus this
 * runs down the slopes' own fall lines and round their valleys' bends as curves (rills.ts). 0 off the slopes.
 */
const smoothAt: ErosionSample = { d: 0, c: 0, f: 0, w: 0, r: 0, keep: 1, o: 0, m: 0, hs: 0, ch: 0, mg: 0, mw: 0, north: 0, east: 0 };
export function slopeSmoothDelta(f: Pick<ErosionField, 'delta' | 'base' | 'carve' | 'carveAny' | 'floor' | 'course' | 'courseAny' | 'home' | 'valley' | 'slopes' | 'slopeAny'>, north: number, east: number): number {
  const sl = f.slopes;
  if (!sl || !f.slopeAny) return 0;
  const fy = (north - DOMAIN_LO) / CUT_CELL;
  const fx = (east - DOMAIN_LO) / CUT_CELL;
  if (!(fy >= 1 && fx >= 1 && fy < CUT_N - 2 && fx < CUT_N - 2) || !f.slopeAny[cellAt(north, east)]) return 0;
  sampleErosion(f, north, east, smoothAt);
  if (!(smoothAt.m > 0)) return 0;
  return smoothAt.m * (bspline(sl.h, CUT_N, fy, fx) - smoothAt.hs);
}

/**
 * Bilinear interpolation of a fine-grid field at (fy, fx) in cells (inside it). Along the threshold hillslopes'
 * channels the ground takes it over Catmull-Rom's: a channel's floor is a narrow trench between walls a node high, and
 * Catmull-Rom's negative weights on the walls ripple its floor by +-10-20 m between the nodes (closed pits).
 */
function bilinear(v: Float32Array, n: number, fy: number, fx: number): number {
  const i = Math.floor(fy);
  const j = Math.floor(fx);
  const ty = fy - i;
  const tx = fx - j;
  const b = i * n + j;
  return (1 - ty) * ((1 - tx) * v[b] + tx * v[b + 1]) + ty * ((1 - tx) * v[b + n] + tx * v[b + n + 1]);
}

/** The lattice cell (n x n) holding (north, east), clamped. */
function cellAt(north: number, east: number): number {
  const i = Math.min(LATTICE_N - 1, Math.max(0, Math.floor((north - DOMAIN_LO) / DRAIN_CELL)));
  const j = Math.min(LATTICE_N - 1, Math.max(0, Math.floor((east - DOMAIN_LO) / DRAIN_CELL)));
  return i * LATTICE_N + j;
}

/** The share of the change kept at a point: none over the home field's pad (the interpolation reaches a cell or two
 * in from the held cells about it). */
function padKeep(home: { north: number; east: number }, north: number, east: number): number {
  const hn = north - home.north;
  const he = east - home.east;
  const r2 = hn * hn + he * he;
  return r2 < PAD_KEEP[1] * PAD_KEEP[1] ? smoothstep(PAD_KEEP[0], PAD_KEEP[1], Math.sqrt(r2)) : 1;
}

/** The gradients of the model's fields at a point (sampleErosionGrad), per m. */
export interface ErosionGrad {
  dN: number;
  dE: number;
  cN: number;
  cE: number;
  fN: number;
  fE: number;
  /** Of the fade w. */
  wN: number;
  wE: number;
  rN: number;
  rE: number;
  /** Of the hillslopes' weight and ground (B-spline gradients, as the carve's). */
  mN: number;
  mE: number;
  hN: number;
  hE: number;
}
const cubic = { v: 0, gy: 0, gx: 0 };

/**
 * sampleErosion with the gradients of its interpolated fields (`g`, per m), for the slope of the macro ground
 * (macroOffsetGrad). Values as sampleErosion's; gradients the B-spline's (Catmull-Rom's gradient is only C0, and the
 * gullies turned and held by it crease the ground along every grid line). Off the grids the gradients are taken as 0.
 */
export function sampleErosionGrad(f: Pick<ErosionField, 'delta' | 'base' | 'carve' | 'carveAny' | 'floor' | 'course' | 'courseAny' | 'home' | 'valley' | 'slopes' | 'slopeAny'>, north: number, east: number, out: ErosionSample, g: ErosionGrad): void {
  out.north = north;
  out.east = east;
  const ly = (north - DOMAIN_LO) / DRAIN_CELL;
  const lx = (east - DOMAIN_LO) / DRAIN_CELL;
  const inLattice = ly >= 1 && lx >= 1 && ly < LATTICE_N - 2 && lx < LATTICE_N - 2;
  latticeGrad(f.delta, inLattice, ly, lx, north, east);
  out.d = cubic.v;
  g.dN = cubic.gy;
  g.dE = cubic.gx;
  const fy = (north - DOMAIN_LO) / CUT_CELL;
  const fx = (east - DOMAIN_LO) / CUT_CELL;
  const inside = fy >= 1 && fx >= 1 && fy < CUT_N - 2 && fx < CUT_N - 2;
  out.c = 0;
  g.cN = g.cE = 0;
  if (inside && f.carveAny[cellAt(north, east)]) {
    out.c = catmullRom(f.carve, CUT_N, fy, fx);
    cubicGrad(f.carve, CUT_N, fy, fx, true);
    g.cN = cubic.gy / CUT_CELL;
    g.cE = cubic.gx / CUT_CELL;
  }
  out.f = 0;
  g.fN = g.fE = 0;
  if (inside) {
    const fl = catmullRomU8(f.floor, CUT_N, fy, fx) / 255;
    if (fl > 0) {
      out.f = Math.min(1, fl);
      if (fl < 1) {
        cubicGradU8(f.floor, CUT_N, fy, fx);
        g.fN = cubic.gy / (255 * CUT_CELL);
        g.fE = cubic.gx / (255 * CUT_CELL);
      }
    }
  }
  // The fade of the finer relief: the floor's, the valley's (gv, with its gradient) and a drawn river's (k).
  let gv = 0;
  let gvN = 0;
  let gvE = 0;
  latticeGrad(f.valley, inLattice, ly, lx, north, east);
  gv = residualFade(cubic.v);
  gvN = fadeD * cubic.gy;
  gvE = fadeD * cubic.gx;
  let k = 0;
  let kN = 0;
  let kE = 0;
  if (inside && f.courseAny[cellAt(north, east)]) {
    const kl = catmullRomU8(f.course, CUT_N, fy, fx) / 255;
    if (kl > 0) {
      k = Math.min(1, kl);
      if (kl < 1) {
        cubicGradU8(f.course, CUT_N, fy, fx);
        kN = cubic.gy / (255 * CUT_CELL);
        kE = cubic.gx / (255 * CUT_CELL);
      }
    }
  }
  out.w = 1 - (1 - out.f) * (1 - gv) * (1 - k);
  g.wN = ((1 - gv) * g.fN + (1 - out.f) * gvN) * (1 - k) + (1 - out.f) * (1 - gv) * kN;
  g.wE = ((1 - gv) * g.fE + (1 - out.f) * gvE) * (1 - k) + (1 - out.f) * (1 - gv) * kE;
  out.r = 0;
  g.rN = g.rE = 0;
  if (out.w > 0) {
    latticeGrad(f.base, inLattice, ly, lx, north, east);
    out.r = cubic.v;
    g.rN = cubic.gy;
    g.rE = cubic.gx;
  }
  out.keep = padKeep(f.home, north, east);
  out.o = outside(north, east);
  out.m = out.hs = out.ch = out.mg = out.mw = 0;
  g.mN = g.mE = g.hN = g.hE = 0;
  const sl = f.slopes;
  if (sl && inside && (f.slopeAny as Uint8Array)[cellAt(north, east)]) {
    const m0 = Math.min(1, Math.max(0, catmullRomU8(sl.w, CUT_N, fy, fx) / 255));
    const kr = catmullRomU8(sl.core, CUT_N, fy, fx) / 255;
    out.mg = m0 * (1 - smoothstep(COURSE_GULLIES[0], COURSE_GULLIES[1], kr)) * out.keep;
    out.mw = m0 * out.keep;
    const kc = 1 - smoothstep(COURSE_SLOPES[0], COURSE_SLOPES[1], kr);
    const m = m0 * kc;
    if (m > 1e-4) {
      out.m = Math.min(1, m) * out.keep;
      if (m < 1) {
        let gN = 0;
        let gE = 0;
        if (m0 < 1) {
          cubicGradU8(sl.w, CUT_N, fy, fx);
          gN = cubic.gy / (255 * CUT_CELL);
          gE = cubic.gx / (255 * CUT_CELL);
        }
        // (With the drawn river's floor's fade: d(1 - smoothstep)/dk times its mark's gradient.)
        const t = (kr - COURSE_SLOPES[0]) / (COURSE_SLOPES[1] - COURSE_SLOPES[0]);
        let krN = 0;
        let krE = 0;
        if (t > 0 && t < 1) {
          cubicGradU8(sl.core, CUT_N, fy, fx);
          const dk = -(6 * t * (1 - t)) / (COURSE_SLOPES[1] - COURSE_SLOPES[0]);
          krN = (dk * cubic.gy) / (255 * CUT_CELL);
          krE = (dk * cubic.gx) / (255 * CUT_CELL);
        }
        g.mN = out.keep * (gN * kc + m0 * krN);
        g.mE = out.keep * (gE * kc + m0 * krE);
      }
      out.hs = catmullRom(sl.h, CUT_N, fy, fx);
      cubicGrad(sl.h, CUT_N, fy, fx, true);
      g.hN = cubic.gy / CUT_CELL;
      g.hE = cubic.gx / CUT_CELL;
      out.ch = Math.min(1, Math.max(0, catmullRomU8(sl.chan, CUT_N, fy, fx) / 255));
      if (out.ch > 0) out.hs += out.ch * (bilinear(sl.h, CUT_N, fy, fx) - out.hs);
    }
  }
}

/**
 * A lattice field's B-spline value and gradient (per m, into `cubic`) at (north, east), `inLattice` at (ly, lx) cells:
 * by the spline's own gradient inside, and by central differences of bicubic about the domain's edge and beyond it
 * (where the field carries on from its edge and fades out), so the gradient stays continuous there too.
 */
function latticeGrad(v: Float32Array, inLattice: boolean, ly: number, lx: number, north: number, east: number): void {
  if (inLattice) {
    cubicGrad(v, LATTICE_N, ly, lx, true);
    cubic.gy /= DRAIN_CELL;
    cubic.gx /= DRAIN_CELL;
    return;
  }
  const e = 5;
  const v0 = bicubic(v, LATTICE_N, DOMAIN_LO, DRAIN_CELL, north, east, true);
  const gy = (bicubic(v, LATTICE_N, DOMAIN_LO, DRAIN_CELL, north + e, east, true) - bicubic(v, LATTICE_N, DOMAIN_LO, DRAIN_CELL, north - e, east, true)) / (2 * e);
  const gx = (bicubic(v, LATTICE_N, DOMAIN_LO, DRAIN_CELL, north, east + e, true) - bicubic(v, LATTICE_N, DOMAIN_LO, DRAIN_CELL, north, east - e, true)) / (2 * e);
  cubic.v = v0;
  cubic.gy = gy;
  cubic.gx = gx;
}

/**
 * The macro ground's offset from the noise ground at the sampled point (sampleErosion), m, signed, where the ground
 * without its gullies and small relief stands at `coarse`: the lattice's change, the channel's carve, and on a valley
 * floor the relief finer than the lattice taken away (the ground there is T's own).
 */
export function macroOffset(s: ErosionSample, coarse: number): number {
  return s.keep * coastKeep(coarse, s.o) * (s.d + s.c - s.w * (coarse - s.r));
}

/** How far (north, east) lies outside the lattice, m (0 inside). */
function outside(north: number, east: number): number {
  const span = (LATTICE_N - 1) * DRAIN_CELL;
  return Math.max(DOMAIN_LO - north, north - DOMAIN_LO - span, DOMAIN_LO - east, east - DOMAIN_LO - span, 0);
}

/**
 * The share of the model's offset kept where the noise ground stands at `coarse`, m: none out to sea and all of it
 * from COAST_KEEP[1] up, so the shore stays where the noise ground put it (the model's sea cells keep their depth, but
 * the interpolation would carry the raised land next to them out over the shallows). Its derivative into coastD.
 */
function coastKeep(coarse: number, out: number): number {
  // (Beyond the lattice no sea cell holds the change down by the shore, as the model's base level does inside: there
  // it comes in over the first COAST_OUT m of the noise ground's rise instead of a cliff at the water's edge.)
  const hi = COAST_KEEP[1] + (out > 0 ? COAST_OUT * smoothstep(0, COAST_OUT_FADE, out) : 0);
  const t = (coarse - COAST_KEEP[0]) / (hi - COAST_KEEP[0]);
  if (t <= 0 || t >= 1) {
    coastD = 0;
    return t <= 0 ? 0 : 1;
  }
  coastD = (6 * t * (1 - t)) / (hi - COAST_KEEP[0]);
  return t * t * (3 - 2 * t);
}
let coastD = 0;
const COAST_KEEP = [-3, 1];
/** Beyond the lattice the kept share rises over this much more of the noise ground's height, m, from this far out. */
const COAST_OUT = 80;
const COAST_OUT_FADE = 1500;

/**
 * The gradient (per m, into `out`: dx east, dy north) of macroOffset at the point sampleErosionGrad sampled, where the
 * ground without its gullies stands at `coarse` with gradient (cE, cN). The home pad's fade is taken as constant.
 */
export function macroOffsetGrad(s: ErosionSample, g: ErosionGrad, coarse: number, cE: number, cN: number, out: { dx: number; dy: number }): void {
  const res = coarse - s.r;
  const k = coastKeep(coarse, s.o);
  const off = s.d + s.c - s.w * res;
  out.dx = s.keep * (k * (g.dE + g.cE - g.wE * res - s.w * (cE - g.rE)) + coastD * cE * off);
  out.dy = s.keep * (k * (g.dN + g.cN - g.wN * res - s.w * (cN - g.rN)) + coastD * cN * off);
}

/**
 * How much of the gullies stay at the sampled point (sampleErosion), [0, 1]: they give way on a channel's valley
 * floor (the river's bed and the ground it wanders over are its own, not the hillside's).
 */
export function erosionGullies(s: ErosionSample): number {
  return 1 - s.f * s.keep;
}

/** Value and gradient (cell units, into `cubic`) of the uniform cubic B-spline of a Uint8Array grid at (fy, fx), inside it. */
function cubicGradU8(v: Uint8Array, n: number, fy: number, fx: number): void {
  const i = Math.min(n - 2, Math.floor(fy));
  const j = Math.min(n - 2, Math.floor(fx));
  const tx = fx - j;
  const ty = fy - i;
  const ux = 1 - tx;
  const ax = (ux * ux * ux) / 6;
  const bx = (3 * tx * tx * tx - 6 * tx * tx + 4) / 6;
  const dx = (tx * tx * tx) / 6;
  const cx = 1 - ax - bx - dx;
  const ax1 = -0.5 * ux * ux;
  const bx1 = 0.5 * (3 * tx * tx - 4 * tx);
  const dx1 = 0.5 * tx * tx;
  const cx1 = -ax1 - bx1 - dx1;
  const uy = 1 - ty;
  const ay = (uy * uy * uy) / 6;
  const by = (3 * ty * ty * ty - 6 * ty * ty + 4) / 6;
  const dy = (ty * ty * ty) / 6;
  const cy = 1 - ay - by - dy;
  const ay1 = -0.5 * uy * uy;
  const by1 = 0.5 * (3 * ty * ty - 4 * ty);
  const dy1 = 0.5 * ty * ty;
  const cy1 = -ay1 - by1 - dy1;
  const j0 = Math.max(0, j - 1);
  const j2 = Math.min(n - 1, j + 1);
  const j3 = Math.min(n - 1, j + 2);
  const b0 = Math.max(0, i - 1) * n;
  const b1 = i * n;
  const b2 = Math.min(n - 1, i + 1) * n;
  const b3 = Math.min(n - 1, i + 2) * n;
  const r0 = ax * v[b0 + j0] + bx * v[b0 + j] + cx * v[b0 + j2] + dx * v[b0 + j3];
  const r1 = ax * v[b1 + j0] + bx * v[b1 + j] + cx * v[b1 + j2] + dx * v[b1 + j3];
  const r2 = ax * v[b2 + j0] + bx * v[b2 + j] + cx * v[b2 + j2] + dx * v[b2 + j3];
  const r3 = ax * v[b3 + j0] + bx * v[b3 + j] + cx * v[b3 + j2] + dx * v[b3 + j3];
  const q0 = ax1 * v[b0 + j0] + bx1 * v[b0 + j] + cx1 * v[b0 + j2] + dx1 * v[b0 + j3];
  const q1 = ax1 * v[b1 + j0] + bx1 * v[b1 + j] + cx1 * v[b1 + j2] + dx1 * v[b1 + j3];
  const q2 = ax1 * v[b2 + j0] + bx1 * v[b2 + j] + cx1 * v[b2 + j2] + dx1 * v[b2 + j3];
  const q3 = ax1 * v[b3 + j0] + bx1 * v[b3 + j] + cx1 * v[b3 + j2] + dx1 * v[b3 + j3];
  const v0 = ay * r0 + by * r1 + cy * r2 + dy * r3;
  const gy = ay1 * r0 + by1 * r1 + cy1 * r2 + dy1 * r3;
  const gx = ay * q0 + by * q1 + cy * q2 + dy * q3;
  cubic.v = v0;
  cubic.gy = gy;
  cubic.gx = gx;
}

function cubicGrad(v: Float32Array, n: number, fy: number, fx: number, approx: boolean): void {
  const i = Math.min(n - 2, Math.floor(fy));
  const j = Math.min(n - 2, Math.floor(fx));
  const ty = fy - i;
  const tx = fx - j;
  let ax: number, bx: number, cx: number, dx: number, ay: number, by: number, cy: number, dy: number;
  let ax1: number, bx1: number, cx1: number, dx1: number, ay1: number, by1: number, cy1: number, dy1: number;
  if (approx) {
    const ux = 1 - tx;
    ax = (ux * ux * ux) / 6;
    bx = (3 * tx * tx * tx - 6 * tx * tx + 4) / 6;
    dx = (tx * tx * tx) / 6;
    cx = 1 - ax - bx - dx;
    ax1 = -0.5 * ux * ux;
    bx1 = 0.5 * (3 * tx * tx - 4 * tx);
    dx1 = 0.5 * tx * tx;
    cx1 = -ax1 - bx1 - dx1;
    const uy = 1 - ty;
    ay = (uy * uy * uy) / 6;
    by = (3 * ty * ty * ty - 6 * ty * ty + 4) / 6;
    dy = (ty * ty * ty) / 6;
    cy = 1 - ay - by - dy;
    ay1 = -0.5 * uy * uy;
    by1 = 0.5 * (3 * ty * ty - 4 * ty);
    dy1 = 0.5 * ty * ty;
    cy1 = -ay1 - by1 - dy1;
  } else {
    const tx2 = tx * tx;
    const tx3 = tx2 * tx;
    ax = 0.5 * (-tx3 + 2 * tx2 - tx);
    bx = 0.5 * (3 * tx3 - 5 * tx2 + 2);
    cx = 0.5 * (-3 * tx3 + 4 * tx2 + tx);
    dx = 0.5 * (tx3 - tx2);
    ax1 = 0.5 * (-3 * tx2 + 4 * tx - 1);
    bx1 = 0.5 * (9 * tx2 - 10 * tx);
    cx1 = 0.5 * (-9 * tx2 + 8 * tx + 1);
    dx1 = 0.5 * (3 * tx2 - 2 * tx);
    const ty2 = ty * ty;
    const ty3 = ty2 * ty;
    ay = 0.5 * (-ty3 + 2 * ty2 - ty);
    by = 0.5 * (3 * ty3 - 5 * ty2 + 2);
    cy = 0.5 * (-3 * ty3 + 4 * ty2 + ty);
    dy = 0.5 * (ty3 - ty2);
    ay1 = 0.5 * (-3 * ty2 + 4 * ty - 1);
    by1 = 0.5 * (9 * ty2 - 10 * ty);
    cy1 = 0.5 * (-9 * ty2 + 8 * ty + 1);
    dy1 = 0.5 * (3 * ty2 - 2 * ty);
  }
  const j0 = Math.max(0, j - 1);
  const j2 = Math.min(n - 1, j + 1);
  const j3 = Math.min(n - 1, j + 2);
  const b0 = Math.max(0, i - 1) * n;
  const b1 = i * n;
  const b2 = Math.min(n - 1, i + 1) * n;
  const b3 = Math.min(n - 1, i + 2) * n;
  const v00 = v[b0 + j0], v01 = v[b0 + j], v02 = v[b0 + j2], v03 = v[b0 + j3];
  const v10 = v[b1 + j0], v11 = v[b1 + j], v12 = v[b1 + j2], v13 = v[b1 + j3];
  const v20 = v[b2 + j0], v21 = v[b2 + j], v22 = v[b2 + j2], v23 = v[b2 + j3];
  const v30 = v[b3 + j0], v31 = v[b3 + j], v32 = v[b3 + j2], v33 = v[b3 + j3];
  const r0 = ax * v00 + bx * v01 + cx * v02 + dx * v03;
  const r1 = ax * v10 + bx * v11 + cx * v12 + dx * v13;
  const r2 = ax * v20 + bx * v21 + cx * v22 + dx * v23;
  const r3 = ax * v30 + bx * v31 + cx * v32 + dx * v33;
  const q0 = ax1 * v00 + bx1 * v01 + cx1 * v02 + dx1 * v03;
  const q1 = ax1 * v10 + bx1 * v11 + cx1 * v12 + dx1 * v13;
  const q2 = ax1 * v20 + bx1 * v21 + cx1 * v22 + dx1 * v23;
  const q3 = ax1 * v30 + bx1 * v31 + cx1 * v32 + dx1 * v33;
  cubic.v = ay * r0 + by * r1 + cy * r2 + dy * r3;
  cubic.gy = ay1 * r0 + by1 * r1 + cy1 * r2 + dy1 * r3;
  cubic.gx = ay * q0 + by * q1 + cy * q2 + dy * q3;
}

/** The cut at the sampled point (sampleErosion) where the ground without its gullies stands at `coarse`. */
/** Half-width of the window about the home field searched for hollows, cells. */
const HOME_WINDOW = 30;

/**
 * Breach the hollows within LAKE_HOME_CLEAR of the home field that a river (RIVER_AREA) drains, on the eroded lattice
 * `h` in place: the course from each one's pit out over its rim is lowered to fall evenly from the pit to the ground
 * below the rim (never through the cells about the field that do not erode, `hard` under a half). Flooded over a
 * window about the field (its edge an outlet). Returns whether any cell was lowered.
 */
function drainByHome(h: Float32Array, n: number, home: { north: number; east: number }, hard: Float32Array, area: Float32Array): boolean {
  const origin = -DOMAIN_HALF;
  const ci = Math.round((home.north - origin) / DRAIN_CELL);
  const cj = Math.round((home.east - origin) / DRAIN_CELL);
  const i0 = Math.max(0, ci - HOME_WINDOW);
  const i1 = Math.min(n - 1, ci + HOME_WINDOW);
  const j0 = Math.max(0, cj - HOME_WINDOW);
  const j1 = Math.min(n - 1, cj + HOME_WINDOW);
  const w = j1 - j0 + 1;
  const m = (i1 - i0 + 1) * w;
  const cell = (q: number): number => (i0 + ((q / w) | 0)) * n + j0 + (q % w);
  let changed = false;
  for (let pass = 0; pass < 3; pass++) {
    // Priority flood over the window: each cell's receiver and water level.
    const filled = new Float32Array(m);
    const receiver = new Int32Array(m).fill(-1);
    const done = new Uint8Array(m);
    const heap = new Heap(m);
    for (let q = 0; q < m; q++) {
      const y = (q / w) | 0;
      const x = q % w;
      const hc = h[cell(q)];
      if (hc <= 0 || y === 0 || x === 0 || y === i1 - i0 || x === w - 1) {
        filled[q] = hc;
        done[q] = 1;
        heap.push(q, hc);
      }
    }
    while (heap.size > 0) {
      const q = heap.pop();
      const y = (q / w) | 0;
      const x = q % w;
      for (let k = 0; k < 8; k++) {
        const yy = y + DI8[k];
        const xx = x + DJ8[k];
        if (yy < 0 || xx < 0 || yy > i1 - i0 || xx >= w) continue;
        const nb = yy * w + xx;
        if (done[nb]) continue;
        done[nb] = 1;
        receiver[nb] = q;
        filled[nb] = Math.max(h[cell(nb)], filled[q] + 1e-3);
        heap.push(nb, filled[nb]);
      }
    }
    // The hollows (cells under water, 8-connected), each with its pit, its biggest catchment, and whether it comes
    // within LAKE_HOME_CLEAR of the field.
    const seen = new Uint8Array(m);
    let cut = false;
    for (let s = 0; s < m; s++) {
      if (seen[s] || filled[s] - h[cell(s)] <= 0.5) continue;
      let pit = s;
      let biggest = 0;
      let near = false;
      const stack = [s];
      seen[s] = 1;
      while (stack.length) {
        const q = stack.pop()!;
        const c = cell(q);
        if (h[c] < h[cell(pit)]) pit = q;
        biggest = Math.max(biggest, area[c]);
        if (Math.hypot(origin + Math.floor(c / n) * DRAIN_CELL - home.north, origin + (c % n) * DRAIN_CELL - home.east) < LAKE_HOME_CLEAR) near = true;
        const y = (q / w) | 0;
        const x = q % w;
        for (let k = 0; k < 8; k++) {
          const yy = y + DI8[k];
          const xx = x + DJ8[k];
          if (yy < 0 || xx < 0 || yy > i1 - i0 || xx >= w) continue;
          const nb = yy * w + xx;
          if (seen[nb] || filled[nb] - h[cell(nb)] <= 0.5) continue;
          seen[nb] = 1;
          stack.push(nb);
        }
      }
      if (!near || biggest < RIVER_AREA) continue;
      // The course out: from the pit along the receivers to the first cell below it.
      const base = h[cell(pit)];
      const path: number[] = [];
      let q = receiver[pit];
      while (q >= 0 && h[cell(q)] >= base) {
        path.push(cell(q));
        q = receiver[q];
      }
      if (q < 0 || path.some((c) => hard[c] < 0.5)) continue;
      const end = h[cell(q)];
      path.forEach((c, k) => {
        const target = base + ((end - base) * (k + 1)) / (path.length + 1);
        if (h[c] > target) {
          h[c] = target;
          cut = true;
        }
      });
    }
    if (!cut) break;
    changed = true;
  }
  return changed;
}

const DI8 = [-1, -1, -1, 0, 0, 1, 1, 1];
const DJ8 = [-1, 0, 1, -1, 1, -1, 0, 1];

/** Edge rows and columns of an m x m grid take their inner neighbours' values (C1 continuation outward). */
function copyEdges(v: Float32Array, m: number): void {
  for (let k = 0; k < m; k++) {
    v[k] = v[m + k];
    v[(m - 1) * m + k] = v[(m - 2) * m + k];
  }
  for (let k = 0; k < m; k++) {
    v[k * m] = v[k * m + 1];
    v[k * m + m - 1] = v[k * m + m - 2];
  }
}

/** The lattice field `v` (n x n) on the fine grid: the same B-spline as bicubic(..., approx), separable. */
export function upsample(v: Float32Array, n: number): Float32Array {
  const N = (n - 1) * FINE + 1;
  const W = new Float64Array(FINE * 4);
  for (let k = 0; k < FINE; k++) {
    const t = k / FINE;
    const u = 1 - t;
    W[4 * k] = (u * u * u) / 6;
    W[4 * k + 1] = (3 * t * t * t - 6 * t * t + 4) / 6;
    W[4 * k + 3] = (t * t * t) / 6;
    W[4 * k + 2] = 1 - W[4 * k] - W[4 * k + 1] - W[4 * k + 3];
  }
  // Along the rows, then down the columns.
  const rows = new Float32Array(n * N);
  for (let i = 0; i < n; i++) {
    const b = i * n;
    for (let x = 0; x < N; x++) {
      const j = Math.min(n - 2, Math.floor(x / FINE));
      const k = x - j * FINE;
      const jj = k >= FINE ? j + 1 : j;
      const kk = k >= FINE ? 0 : k;
      rows[i * N + x] = W[4 * kk] * v[b + Math.max(0, jj - 1)] + W[4 * kk + 1] * v[b + jj] + W[4 * kk + 2] * v[b + Math.min(n - 1, jj + 1)] + W[4 * kk + 3] * v[b + Math.min(n - 1, jj + 2)];
    }
  }
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const i0 = Math.min(n - 2, Math.floor(y / FINE));
    const k0 = y - i0 * FINE;
    const i = k0 >= FINE ? i0 + 1 : i0;
    const k = k0 >= FINE ? 0 : k0;
    const o = y * N;
    const r0 = Math.max(0, i - 1) * N;
    const r1 = i * N;
    const r2 = Math.min(n - 1, i + 1) * N;
    const r3 = Math.min(n - 1, i + 2) * N;
    const a = W[4 * k];
    const b = W[4 * k + 1];
    const c = W[4 * k + 2];
    const d = W[4 * k + 3];
    for (let x = 0; x < N; x++) out[o + x] = a * rows[r0 + x] + b * rows[r1 + x] + c * rows[r2 + x] + d * rows[r3 + x];
  }
  return out;
}

/** Mark the valley floor along the segment (n0, e0) -> (n1, e1) into `floor` (N x N, 0-255), FLOOR_HALF either side. */
function markFloor(floor: Uint8Array, N: number, n0: number, e0: number, n1: number, e1: number, strength: number): void {
  const w = FLOOR_HALF;
  const origin = -DOMAIN_HALF;
  const yLo = Math.max(0, Math.ceil((Math.min(n0, n1) - w - origin) / CUT_CELL));
  const yHi = Math.min(N - 1, Math.floor((Math.max(n0, n1) + w - origin) / CUT_CELL));
  const xLo = Math.max(0, Math.ceil((Math.min(e0, e1) - w - origin) / CUT_CELL));
  const xHi = Math.min(N - 1, Math.floor((Math.max(e0, e1) + w - origin) / CUT_CELL));
  const dn = n1 - n0;
  const de = e1 - e0;
  const L2 = dn * dn + de * de || 1;
  const w2 = w * w;
  for (let y = yLo; y <= yHi; y++) {
    const qn = origin + y * CUT_CELL - n0;
    for (let x = xLo; x <= xHi; x++) {
      const qe = origin + x * CUT_CELL - e0;
      const u = Math.min(1, Math.max(0, (qn * dn + qe * de) / L2));
      const pn = qn - u * dn;
      const pe = qe - u * de;
      const d2 = pn * pn + pe * pe;
      if (d2 >= w2) continue;
      const s = 1 - d2 / w2;
      const v = Math.round(255 * s * s * strength);
      const q = y * N + x;
      if (v > floor[q]) floor[q] = v;
    }
  }
}

/** Beyond a drawn river's own floor (markCourse) the relief finer than the lattice comes back over this, m. */
let COURSE_TAPER = 500;
/** Probes: the course mark's taper, m. */
export function setCourseTaper(v: number): void {
  COURSE_TAPER = v;
}
/** markCourse marks a valley axis in chords of about this, m. */
const COURSE_CHORD = 480;

/**
 * Mark the drawn rivers' own floors (ErosionField.course) along their valley axes (`north`, `east`, m), `half` m either side
 * of each point (the floodplain and the channel's swing), coming off over COURSE_TAPER beyond; `keep` (0-1) scales the
 * mark at a fine-grid point (riverNetwork.ts: none by a lake, whose basin and shore were flooded on the ground as it
 * was). Faded toward the fine grid's edge as the floor is.
 */
export function markCourse(f: ErosionField, axes: ReadonlyArray<{ north: ArrayLike<number>; east: ArrayLike<number>; half: ArrayLike<number> }>, keep: (north: number, east: number) => number): void {
  const N = CUT_N;
  const origin = -DOMAIN_HALF;
  const course = f.course;
  const n = LATTICE_N;
  /** The keep factor per fine point, 0-255 (255 + 1: not yet asked). */
  const kept = new Uint16Array(N * N).fill(256);
  for (const { north, east, half } of axes) {
    // (In chords of about COURSE_CHORD: a smooth axis strays a few tens of metres at most from them, inside the
    // marks' margin, and each fine point is then visited a few times rather than dozens.)
    const m = north.length;
    let step = 1;
    if (m > 2) step = Math.max(1, Math.round(COURSE_CHORD / Math.max(1, Math.hypot(north[1] - north[0], east[1] - east[0]))));
    for (let k0 = 0; k0 + 1 < m; k0 += step) {
      const k1 = Math.min(m - 1, k0 + step);
      const n0 = north[k0];
      const e0 = east[k0];
      const n1 = north[k1];
      const e1 = east[k1];
      let h0 = half[k0];
      let h1 = half[k1];
      for (let k = k0 + 1; k < k1; k++) (h0 = Math.max(h0, half[k])), (h1 = Math.max(h1, half[k]));
      const reach = Math.max(h0, h1) + COURSE_TAPER;
      const yLo = Math.max(0, Math.ceil((Math.min(n0, n1) - reach - origin) / CUT_CELL));
      const yHi = Math.min(N - 1, Math.floor((Math.max(n0, n1) + reach - origin) / CUT_CELL));
      const xLo = Math.max(0, Math.ceil((Math.min(e0, e1) - reach - origin) / CUT_CELL));
      const xHi = Math.min(N - 1, Math.floor((Math.max(e0, e1) + reach - origin) / CUT_CELL));
      const dn = n1 - n0;
      const de = e1 - e0;
      const L2 = dn * dn + de * de || 1;
      for (let y = yLo; y <= yHi; y++) {
        const qn = origin + y * CUT_CELL - n0;
        for (let x = xLo; x <= xHi; x++) {
          const q = y * N + x;
          if (course[q] === 255) continue;
          const qe = origin + x * CUT_CELL - e0;
          const u = Math.min(1, Math.max(0, (qn * dn + qe * de) / L2));
          const pn = qn - u * dn;
          const pe = qe - u * de;
          const h = h0 + (h1 - h0) * u;
          const dist = Math.sqrt(pn * pn + pe * pe);
          if (dist >= h + COURSE_TAPER) continue;
          const s = 1 - smoothstep(h, h + COURSE_TAPER, dist);
          if (kept[q] === 256) {
            const edge = smoothstep(EDGE_KEEP[0], EDGE_KEEP[1], CUT_CELL * Math.min(x, y, N - 1 - x, N - 1 - y));
            kept[q] = Math.round(255 * edge * Math.min(1, Math.max(0, keep(origin + y * CUT_CELL, origin + x * CUT_CELL))));
          }
          const v = Math.round(s * kept[q]);
          if (v <= course[q]) continue;
          if (course[q] === 0) {
            // The lattice cells whose interpolation (4 x 4 fine points about each of the cell's own) touches the mark.
            const i0 = Math.max(0, Math.floor((y - 2) / FINE));
            const i1 = Math.min(n - 1, Math.floor((y + 1) / FINE));
            const j0 = Math.max(0, Math.floor((x - 2) / FINE));
            const j1 = Math.min(n - 1, Math.floor((x + 1) / FINE));
            for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) f.courseAny[i * n + j] = 1;
          }
          course[q] = v;
        }
      }
    }
  }
}

/**
 * Carve a valley along the segment (n0, e0) -> (n1, e1) into the fine grid `carve` (N x N), lowering the surface
 * `surface` toward the floor `f0`..`f1` (linear along it; `strength` of the way): all the way on the line, falling off
 * sideways as (1 - (d/w)^2)^2 over a half-width w that grows with `depth`, the most it is lowered on the line. Never
 * below the floor, and each point keeps the deepest carve over it.
 */
function carveSegment(carve: Float32Array, surface: Float32Array, N: number, n0: number, e0: number, f0: number, n1: number, e1: number, f1: number, depth: number, strength: number): void {
  const w = Math.min(CARVE_HALF_MAX, Math.max(CARVE_HALF, (2 * depth) / VALLEY_SLOPE));
  const origin = -DOMAIN_HALF;
  const yLo = Math.max(0, Math.ceil((Math.min(n0, n1) - w - origin) / CUT_CELL));
  const yHi = Math.min(N - 1, Math.floor((Math.max(n0, n1) + w - origin) / CUT_CELL));
  const xLo = Math.max(0, Math.ceil((Math.min(e0, e1) - w - origin) / CUT_CELL));
  const xHi = Math.min(N - 1, Math.floor((Math.max(e0, e1) + w - origin) / CUT_CELL));
  const dn = n1 - n0;
  const de = e1 - e0;
  const L2 = dn * dn + de * de || 1;
  const w2 = w * w;
  for (let y = yLo; y <= yHi; y++) {
    const qn = origin + y * CUT_CELL - n0;
    for (let x = xLo; x <= xHi; x++) {
      const qe = origin + x * CUT_CELL - e0;
      const u = Math.min(1, Math.max(0, (qn * dn + qe * de) / L2));
      const pn = qn - u * dn;
      const pe = qe - u * de;
      const d2 = pn * pn + pe * pe;
      if (d2 >= w2) continue;
      const q = y * N + x;
      const above = surface[q] - (f0 + (f1 - f0) * u);
      if (above <= 0) continue;
      const s = 1 - d2 / w2;
      const v = -above * s * s * strength;
      if (v < carve[q]) carve[q] = v;
    }
  }
}

function smoothstep(e0: number, e1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Erode the lattice `h` (n x n cells, row-major, north rows; cells at or below 0 m are fixed base level, the edge cells
 * drain off it) in place; the caller diffs against its copy. `hard` (per cell, [0, 1]) scales how readily each cell erodes (0: not
 * at all, nor lowered by the blur or beside a diagonal step). Returns the last routing: each cell's receiver (-1 at
 * base level) and catchment, cells, and `route` to route `h` again after a change (updating them).
/**
 * Water routing on the lattice for the model: a priority flood (Barnes et al. 2014, a FIFO for cells inside hollows)
 * from the base-level cells, then steepest descent on the filled surface (a cell inside a filled hollow keeps the
 * flood's receiver, toward the spill), a downstream-first order, catchments in cells and whether each cell's step to
 * its receiver is diagonal. Deterministic (ties broken by index).
 */
export class SteadyRouter {
  readonly receiver: Int32Array;
  readonly order: Int32Array;
  readonly area: Float32Array;
  readonly diag: Uint8Array;
  private readonly filled: Float32Array;
  /** The filled surface of the last route (a hollow's cells at its spill level). */
  get filledLevels(): Float32Array {
    return this.filled;
  }
  private readonly done: Uint8Array;
  private readonly pit: Int32Array;
  private readonly heap: Heap;
  private readonly start: Int32Array;
  private readonly donors: Int32Array;
  constructor(private readonly n: number) {
    const N = n * n;
    this.receiver = new Int32Array(N);
    this.order = new Int32Array(N);
    this.area = new Float32Array(N);
    this.diag = new Uint8Array(N);
    this.filled = new Float32Array(N);
    this.done = new Uint8Array(N);
    this.pit = new Int32Array(N);
    this.heap = new Heap(N);
    this.start = new Int32Array(N + 1);
    this.donors = new Int32Array(N);
  }

  /** Route `h`; where `hold` is set (>= 0) a cell keeps that receiver (structure.ts: the front block's antecedent
   * rivers, whose held courses run down to base level). */
  route(h: Float32Array, fixed: Uint8Array, hold: Int32Array | null = null): void {
    const { n, receiver, filled, done, pit, heap, order, area, diag } = this;
    const N = n * n;
    done.fill(0);
    receiver.fill(-1);
    let pitHead = 0;
    let pitTail = 0;
    for (let c = 0; c < N; c++) {
      if (!fixed[c]) continue;
      filled[c] = h[c];
      done[c] = 1;
      heap.push(c, h[c]);
    }
    while (pitHead < pitTail || heap.size > 0) {
      const c = pitHead < pitTail ? pit[pitHead++] : heap.pop();
      const i = (c / n) | 0;
      const j = c - i * n;
      const fc = filled[c];
      for (let k = 0; k < 8; k++) {
        const ii = i + DI8[k];
        const jj = j + DJ8[k];
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const nb = ii * n + jj;
        if (done[nb]) continue;
        done[nb] = 1;
        receiver[nb] = c;
        if (h[nb] <= fc + 1e-3) {
          filled[nb] = fc + 1e-3;
          pit[pitTail++] = nb;
        } else {
          filled[nb] = h[nb];
          heap.push(nb, h[nb]);
        }
      }
    }
    // Steepest descent on the filled surface, for the cells standing on it (not inside a hollow).
    for (let c = 0; c < N; c++) {
      if (fixed[c] || filled[c] > h[c] + 1e-6) continue;
      const i = (c / n) | 0;
      const j = c - i * n;
      let best = -1;
      let bs = 0;
      for (let k = 0; k < 8; k++) {
        const ii = i + DI8[k];
        const jj = j + DJ8[k];
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const nb = ii * n + jj;
        const d = filled[c] - filled[nb];
        if (d <= 0) continue;
        const s = DI8[k] !== 0 && DJ8[k] !== 0 ? d / Math.SQRT2 : d;
        if (s > bs) {
          bs = s;
          best = nb;
        }
      }
      if (best >= 0) receiver[c] = best;
    }
    if (hold) for (let c = 0; c < N; c++) if (hold[c] >= 0 && !fixed[c]) receiver[c] = hold[c];
    for (let c = 0; c < N; c++) {
      const r = receiver[c];
      diag[c] = r >= 0 && ((r / n) | 0) !== ((c / n) | 0) && r % n !== c % n ? 1 : 0;
    }
    // Downstream-first order: outlets, then each cell's donors after it.
    const { start, donors } = this;
    start.fill(0);
    for (let c = 0; c < N; c++) if (receiver[c] >= 0) start[receiver[c] + 1]++;
    for (let c = 0; c < N; c++) start[c + 1] += start[c];
    const fill = start.slice(0, N);
    for (let c = 0; c < N; c++) if (receiver[c] >= 0) donors[fill[receiver[c]]++] = c;
    let head = 0;
    let tail = 0;
    for (let c = 0; c < N; c++) if (receiver[c] < 0) order[tail++] = c;
    while (head < tail) {
      const c = order[head++];
      for (let k = start[c]; k < start[c + 1]; k++) order[tail++] = donors[k];
    }
    if (tail !== N) throw new Error(`model routing has a cycle (${N - tail} cells)`);
    area.fill(1);
    for (let k = N - 1; k >= 0; k--) {
      const c = order[k];
      const r = receiver[c];
      if (r >= 0) area[r] += area[c];
    }
  }
}

/** Binary min-heap of cell indices keyed by level, ties broken by index (deterministic). */
class Heap {
  private readonly ids: Int32Array;
  private readonly keys: Float64Array;
  size = 0;
  constructor(cap: number) {
    this.ids = new Int32Array(cap);
    this.keys = new Float64Array(cap);
  }
  push(id: number, key: number): void {
    const ids = this.ids;
    const keys = this.keys;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const kp = keys[p];
      if (kp < key || (kp === key && ids[p] < id)) break;
      ids[i] = ids[p];
      keys[i] = kp;
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0];
    const last = --this.size;
    if (last > 0) {
      const id = ids[last];
      const key = keys[last];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= last) break;
        const r = l + 1;
        let m = l;
        if (r < last && (keys[r] < keys[l] || (keys[r] === keys[l] && ids[r] < ids[l]))) m = r;
        if (keys[m] > key || (keys[m] === key && ids[m] > id)) break;
        ids[i] = ids[m];
        keys[i] = keys[m];
        i = m;
      }
      ids[i] = id;
      keys[i] = key;
    }
    return top;
  }
}

/**
 * C1 bicubic interpolation of a lattice field `v` (n x n, spacing `cell`, cell 0 at (origin, origin)) at (north,
 * east): Catmull-Rom (through the cells' values), or with `approx` the uniform cubic B-spline (C2, its weights all
 * positive: never beyond the values about it, no ringing beside a step, but smoothing them). Off the lattice it
 * carries on from the edge cells (which must equal their inner neighbours, for C1) and fades to 0 over OUTSIDE_FADE.
 */
export function bicubic(v: Float32Array, n: number, origin: number, cell: number, north: number, east: number, approx = false): number {
  const fy = (north - origin) / cell;
  const fx = (east - origin) / cell;
  if (fy >= 1 && fx >= 1 && fy < n - 2 && fx < n - 2) return approx ? bspline(v, n, fy, fx) : catmullRom(v, n, fy, fx);
  const span = (n - 1) * cell;
  const out = Math.max(origin - north, north - origin - span, origin - east, east - origin - span, 0);
  if (out >= OUTSIDE_FADE) return 0;
  const cy = Math.min(n - 1, Math.max(0, fy));
  const cx = Math.min(n - 1, Math.max(0, fx));
  return (approx ? bspline(v, n, cy, cx) : catmullRom(v, n, cy, cx)) * (1 - smoothstep(0, OUTSIDE_FADE, out));
}

/** The uniform cubic B-spline over the 4 x 4 cells around (fy, fx) in cells; indices clamped to the lattice. */
function bspline(v: Float32Array, n: number, fy: number, fx: number): number {
  const i = Math.min(n - 2, Math.floor(fy));
  const j = Math.min(n - 2, Math.floor(fx));
  const ty = fy - i;
  const tx = fx - j;
  const ux = 1 - tx;
  const ax = (ux * ux * ux) / 6;
  const bx = (3 * tx * tx * tx - 6 * tx * tx + 4) / 6;
  const dx = (tx * tx * tx) / 6;
  const cx = 1 - ax - bx - dx;
  const uy = 1 - ty;
  const ay = (uy * uy * uy) / 6;
  const by = (3 * ty * ty * ty - 6 * ty * ty + 4) / 6;
  const dy = (ty * ty * ty) / 6;
  const cy = 1 - ay - by - dy;
  const j0 = Math.max(0, j - 1);
  const j2 = Math.min(n - 1, j + 1);
  const j3 = Math.min(n - 1, j + 2);
  const b0 = Math.max(0, i - 1) * n;
  const b1 = i * n;
  const b2 = Math.min(n - 1, i + 1) * n;
  const b3 = Math.min(n - 1, i + 2) * n;
  const r0 = ax * v[b0 + j0] + bx * v[b0 + j] + cx * v[b0 + j2] + dx * v[b0 + j3];
  const r1 = ax * v[b1 + j0] + bx * v[b1 + j] + cx * v[b1 + j2] + dx * v[b1 + j3];
  const r2 = ax * v[b2 + j0] + bx * v[b2 + j] + cx * v[b2 + j2] + dx * v[b2 + j3];
  const r3 = ax * v[b3 + j0] + bx * v[b3 + j] + cx * v[b3 + j2] + dx * v[b3 + j3];
  return ay * r0 + by * r1 + cy * r2 + dy * r3;
}

/** Catmull-Rom over the 4 x 4 cells around (fy, fx) in cells; indices clamped to the lattice. */
function catmullRom(v: Float32Array, n: number, fy: number, fx: number): number {
  const i = Math.floor(fy);
  const j = Math.floor(fx);
  const ty = fy - i;
  const tx = fx - j;
  const tx2 = tx * tx;
  const tx3 = tx2 * tx;
  const ax = 0.5 * (-tx3 + 2 * tx2 - tx);
  const bx = 0.5 * (3 * tx3 - 5 * tx2 + 2);
  const cx = 0.5 * (-3 * tx3 + 4 * tx2 + tx);
  const dx = 0.5 * (tx3 - tx2);
  const ty2 = ty * ty;
  const ty3 = ty2 * ty;
  const ay = 0.5 * (-ty3 + 2 * ty2 - ty);
  const by = 0.5 * (3 * ty3 - 5 * ty2 + 2);
  const cy = 0.5 * (-3 * ty3 + 4 * ty2 + ty);
  const dy = 0.5 * (ty3 - ty2);
  const j0 = Math.max(0, j - 1);
  const j1 = j;
  const j2 = Math.min(n - 1, j + 1);
  const j3 = Math.min(n - 1, j + 2);
  const b0 = Math.max(0, i - 1) * n;
  const b1 = i * n;
  const b2 = Math.min(n - 1, i + 1) * n;
  const b3 = Math.min(n - 1, i + 2) * n;
  const r0 = ax * v[b0 + j0] + bx * v[b0 + j1] + cx * v[b0 + j2] + dx * v[b0 + j3];
  const r1 = ax * v[b1 + j0] + bx * v[b1 + j1] + cx * v[b1 + j2] + dx * v[b1 + j3];
  const r2 = ax * v[b2 + j0] + bx * v[b2 + j1] + cx * v[b2 + j2] + dx * v[b2 + j3];
  const r3 = ax * v[b3 + j0] + bx * v[b3 + j1] + cx * v[b3 + j2] + dx * v[b3 + j3];
  return ay * r0 + by * r1 + cy * r2 + dy * r3;
}

/** bicubic (Catmull-Rom) of a Uint8Array field: 0 off the lattice. */
function bicubicU8(v: Uint8Array, n: number, origin: number, cell: number, north: number, east: number): number {
  const fy = (north - origin) / cell;
  const fx = (east - origin) / cell;
  if (fy >= 1 && fx >= 1 && fy < n - 2 && fx < n - 2) return catmullRomU8(v, n, fy, fx);
  return 0;
}

/** catmullRom over a Uint8Array. */
function catmullRomU8(v: Uint8Array, n: number, fy: number, fx: number): number {
  const i = Math.floor(fy);
  const j = Math.floor(fx);
  const ty = fy - i;
  const tx = fx - j;
  const tx2 = tx * tx;
  const tx3 = tx2 * tx;
  const ax = 0.5 * (-tx3 + 2 * tx2 - tx);
  const bx = 0.5 * (3 * tx3 - 5 * tx2 + 2);
  const cx = 0.5 * (-3 * tx3 + 4 * tx2 + tx);
  const dx = 0.5 * (tx3 - tx2);
  const ty2 = ty * ty;
  const ty3 = ty2 * ty;
  const ay = 0.5 * (-ty3 + 2 * ty2 - ty);
  const by = 0.5 * (3 * ty3 - 5 * ty2 + 2);
  const cy = 0.5 * (-3 * ty3 + 4 * ty2 + ty);
  const dy = 0.5 * (ty3 - ty2);
  const j0 = Math.max(0, j - 1);
  const j1 = j;
  const j2 = Math.min(n - 1, j + 1);
  const j3 = Math.min(n - 1, j + 2);
  const b0 = Math.max(0, i - 1) * n;
  const b1 = i * n;
  const b2 = Math.min(n - 1, i + 1) * n;
  const b3 = Math.min(n - 1, i + 2) * n;
  const r0 = ax * v[b0 + j0] + bx * v[b0 + j1] + cx * v[b0 + j2] + dx * v[b0 + j3];
  const r1 = ax * v[b1 + j0] + bx * v[b1 + j1] + cx * v[b1 + j2] + dx * v[b1 + j3];
  const r2 = ax * v[b2 + j0] + bx * v[b2 + j1] + cx * v[b2 + j2] + dx * v[b2 + j3];
  const r3 = ax * v[b3 + j0] + bx * v[b3 + j1] + cx * v[b3 + j2] + dx * v[b3 + j3];
  return ay * r0 + by * r1 + cy * r2 + dy * r3;
}
