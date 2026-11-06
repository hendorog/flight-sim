// Fluvial erosion of a seeded world's macro terrain (any seed but 0), worked out at load on the drainage lattice
// (drainage.ts: DRAIN_CELL over +-DOMAIN_HALF). Pure (no three.js): every thread runs it and gets the same answer.
//
// The noise terrain has no history: its broad hollows are closed basins that no river would have left behind, and a
// river routed across one has to run at the basin's spill level and trench through the ground beyond it. Real
// fluvial country has very few closed hollows: the rivers that drain it have cut their valleys down through it.
// This pass gives the noise terrain that history, with the stream-power law of bedrock incision
//
//     dh/dt = -K A^m S        (A catchment area, S slope toward the receiver, n = 1)
//
// solved with the implicit O(n) scheme of Braun & Willett (2013, "FastScape"; Cordonnier et al. 2016): cells are
// visited downstream first, so each one is lowered toward its receiver's NEW height,
//
//     h_i <- (h_i + F h_r) / (1 + F),   F = K dt A^m / L,
//
// which is unconditionally stable. Water is routed over the filled surface (priority flood, as drainage.ts): inside
// a closed hollow a cell lies below its receiver and is left alone (a sediment trap), while the hollow's spill point
// carries the whole catchment of the hollow and cuts down fast - a big river keeps an antecedent gorge through
// rising ground and drains the basin behind it; a small one leaves its hollow as a lake. Ridges and peaks have the
// smallest catchments and keep their height. The pass only ever lowers the ground.
//
// The result (buildErosion) is drawn on a fine grid a quarter of the lattice's spacing: where the cut is deep the
// ground becomes the eroded surface, with each channel's valley carved along its smoothed course, and where it is
// shallow the natural ground is lowered by the cut; heightfield.ts applies it (erosionCut), C1 everywhere, so the
// terrain has no facets or creases at the lattice lines and no beads along a channel that steps diagonally.

import { DOMAIN_HALF, DRAIN_CELL, HOME_MOUND, HOME_RADIUS, LAKE_HOME_CLEAR, RIVER_AREA } from './drainage';

/** Settings of the erosion pass. */
export interface ErosionParams {
  /** Implicit steps, and routing refreshed every `reroute` steps. */
  steps: number;
  reroute: number;
  /** K dt / L for a one-cell catchment (1 km^2) and an orthogonal step: the per-step erosion factor on a ridge. */
  k: number;
  /** Area exponent m of the stream-power law (n = 1). */
  m: number;
  /**
   * [1 2 1] blurs of the cut, applied once, `settle` steps before the end: the walls of the notches the streams cut
   * fall back to valley slopes, and a channel that zigzags on the lattice leaves one smooth valley; the last steps
   * re-cut the floors so they drain again.
   */
  blur: number;
  settle: number;
  /**
   * Gentlest gradient a channel is cut to, m/m, at a one-cell catchment; it falls as A^-0.45 (Flint's law: the graded
   * profile under steady uplift), so a big river keeps a few metres per kilometre instead of being cut to sea level
   * far inland.
   */
  grade: number;
}

/** How far a river leaving the lattice's edge runs on to the sea, m, and the deepest it cuts the edge cell, m. */
const EDGE_RUN = 40000;
const EDGE_CUT = 250;
/** Catchment, cells, from which a diagonal step of a channel lowers the cells beside it. */
const CORNER_AREA = 10;
/** Lowest the pass takes the land, m. */
const LAND_MIN = 0.5;

/**
 * Strong area dependence (m > 1/2) so the trunk rivers cut their valleys and drain the hollows they cross while the
 * ridges and peaks (one-cell catchments) lose only metres. On seeds 1, 42 and 777777 the land in hollows filled over
 * 30 m deep falls from 12-22 % to about 3 % (lattice), the top 1 % of the ground is lowered by about 10 m, the median
 * cell by 8 m; trunk valleys are cut a few hundred metres, the deepest gorges about 1 km. Four routings (the costly
 * part, about 120 ms in node; a fifth when a hollow by the home field is breached, drainByHome).
 */
export const EROSION: ErosionParams = { steps: 20, reroute: 5, k: 0.0009, m: 1.2, blur: 2, settle: 5, grade: 0.03 };

/**
 * The rock does not erode within this distance of the home field, m, and erodes fully beyond the second: its site is
 * chosen on the uneroded ground, and only its pad could suffer from a lowering (approach and circuit only gain
 * clearance).
 */
const HOME_KEEP = 1800;
const HOME_FULL = 3000;
/** No cut at all within the first of these distances of the home field, m, faded in by the second. */
const PAD_KEEP = [1500, 2500];
/** Beyond the lattice the correction carries on from its edge and fades out over this distance, m. */
const OUTSIDE_FADE = 15000;

/** The erosion of a seeded world, as the terrain applies it (sampleErosion, erosionCutAt, erosionGullies). */
export interface ErosionField {
  /**
   * The eroded surface T, m, on the fine grid (CUT_N x CUT_N points from (-DOMAIN_HALF, -DOMAIN_HALF), CUT_CELL
   * apart): the eroded cells interpolated, with the channels carved along their smoothed courses.
   */
  surface: Float32Array;
  /**
   * How far each point of the fine grid lies on a channel's valley floor, 0-255 (FLOOR_HALF either side of its
   * course): the gullies give way there, where the eroded surface replaced the ground (erosionGullies).
   */
  floor: Uint8Array;
  /** The home field, where the cut is held at none over its pad (PAD_KEEP). */
  home: { north: number; east: number };
  /** The lattice's cut D per cell, m (<= 0): the ground's lowering where the cut is shallow, and by its depth how
   * far the ground is replaced by T (erosionWeight). */
  lowered: Float32Array;
  /** The erosion's change per drainage lattice cell, m (<= 0; drainage.ts lattice: n x n from (origin, origin), DRAIN_CELL apart). */
  delta: Float32Array;
  /** The eroded cells (the natural coarse terrain plus the change): what the drainage routes over. */
  lattice: Float32Array;
}

/** Spacing of the fine grid the valleys are drawn on, m: a quarter of the lattice's. */
export const CUT_CELL = 250;
const FINE = DRAIN_CELL / CUT_CELL;
const LATTICE_N = Math.round((2 * DOMAIN_HALF) / DRAIN_CELL) + 1;
/** Points per side of the fine grid. */
export const CUT_N = (LATTICE_N - 1) * FINE + 1;

/**
 * Depth of the lattice's cut, m, over which the ground goes from lowered by it (the natural relief kept) to replaced
 * by the eroded surface (the relief finer than the lattice gone with the rock the river took away).
 */
const REPLACE = [15, 60];
/** Distance inside the lattice's edge, m, over which the replacement comes in. */
const EDGE_KEEP = [1000, 4000];
/**
 * Channels drawn along their smoothed course: the catchment (cells) from which a channel is drawn, reaching full
 * strength at twice it, the samples per channel piece, the smoothing passes of the course, and the half-width of the
 * carve, m, at its least and growing with its depth (VALLEY_SLOPE: the steepest mean slope of the carve's sides).
 */
const CHANNEL_AREA = 30;
const PIECE_SAMPLES = 6;
const COURSE_PASSES = 3;
const CARVE_HALF = 650;
const CARVE_HALF_MAX = 1600;
const VALLEY_SLOPE = 0.12;
/** Half-width of a channel's valley floor, m, where the gullies give way (erosionGullies). */
const FLOOR_HALF = 450;

/**
 * Sample the coarse natural terrain `natural` on the drainage lattice, erode it, and draw the result on the fine grid,
 * faded out near the home field (`home`, its site chosen on the uneroded ground).
 *
 * The lattice holds one height per square kilometre, and the coarse terrain has relief on shorter wavelengths (down
 * to about 600 m in the mountains). Lowering the natural ground by the cells' cut, interpolated between them, carries
 * that relief down to the floor of a valley cut hundreds of metres deep, as a chain of pits and saddles tens of metres
 * high; and where a channel steps diagonally from cell to cell, the ground between two of them is the less cut ground
 * beside the channel, so the valley is beaded 1.4 km apart. So where the cut is deep (REPLACE) the ground is replaced
 * by the eroded surface itself (T: the eroded cells interpolated by the cubic B-spline, which unlike Catmull-Rom does
 * not ring into pits beside a steep valley wall), and each channel is followed as a smooth curve (its cells smoothed
 * along it as the rivers' courses are, then a quadratic B-spline) with its floor falling along it as the eroded cells
 * do: wherever T stands above that floor, it is carved down to it with a smooth valley cross-profile, and on the floor
 * the gullies give way (floor). Where the cut is shallow the natural ground is lowered by it (D), keeping its relief.
 */
export function buildErosion(natural: (north: number, east: number) => number, home: { north: number; east: number }, p: ErosionParams = EROSION): ErosionField {
  const n = LATTICE_N;
  const origin = -DOMAIN_HALF;
  // Routed as the drainage routes (drainage.ts): a low mound over the home field keeps the rivers off it.
  const h0 = new Float32Array(n * n);
  const mound = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const north = origin + i * DRAIN_CELL;
      const east = origin + j * DRAIN_CELL;
      const r = Math.hypot(north - home.north, east - home.east);
      if (r < HOME_RADIUS) mound[i * n + j] = HOME_MOUND * (1 - r / HOME_RADIUS);
      h0[i * n + j] = natural(north, east) + mound[i * n + j];
    }
  }
  // The rock gets harder near the home field (none of it erodes within HOME_KEEP): a river that cannot cut through
  // there finds its way round or leaves a lake, and the drainage routes over just what the erosion left (fading the
  // cut after the erosion would raise ridges back across the valleys it cut).
  const fadeAt = (north: number, east: number): number => smoothstep(HOME_KEEP, HOME_FULL, Math.hypot(north - home.north, east - home.east));
  const hard = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      hard[i * n + j] = fadeAt(origin + i * DRAIN_CELL, origin + j * DRAIN_CELL);
    }
  }
  const h = h0.slice();
  const { receiver, area, route } = erodeLattice(h, n, p, hard);
  // No lake may lie by the home field (drainage.ts LAKE_HOME_CLEAR): a river's hollow there would be breached by the
  // drainage, its river cut down through ground the erosion left standing. Its valley is cut here instead, and the
  // channels routed again down it.
  if (drainByHome(h, n, home, hard, area)) route();
  // The lattice's cut; the edge cells take their inner neighbours' change, so the interpolation leaves the lattice
  // level (C1).
  const change = new Float32Array(n * n);
  for (let c = 0; c < n * n; c++) {
    change[c] = Math.min(0, h[c] - h0[c]);
    h0[c] -= mound[c];
  }
  copyEdges(change, n);
  // The eroded surface at the cells.
  const eroded = new Float32Array(n * n);
  for (let c = 0; c < n * n; c++) eroded[c] = h0[c] + change[c];
  const N = CUT_N;
  const surface = upsample(eroded, n);
  const carve = new Float32Array(N * N);
  const floorMask = new Uint8Array(N * N);
  // Each channel's course: its cells smoothed along it as the rivers' courses are (riverNetwork.ts: three [1 2 1]
  // passes, a cell's neighbours along the channel being its receiver and its main donor, the largest), so the valley
  // is carved where the river will run.
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
  // The carve, faded out near home as the cut is; the edge points take their inner neighbours' value.
  for (let y = 0; y < N; y++) {
    const north = origin + y * CUT_CELL;
    for (let x = 0; x < N; x++) {
      const q = y * N + x;
      if (carve[q] < 0) surface[q] += carve[q] * fadeAt(north, origin + x * CUT_CELL);
    }
  }
  copyEdges(surface, N);
  const field = { surface, floor: floorMask, lowered: change, home: { north: home.north, east: home.east } };
  // The drainage routes over the eroded cells themselves (drained by the erosion, its channels running down them),
  // not over the terrain sampled at the cells: a valley drawn along its smoothed course lies between the cells it
  // steps through, and the cells beside it would leave hollows on the lattice that are not in the terrain.
  return { ...field, delta: change, lattice: eroded };
}

/**
 * The erosion's cut, m (<= 0), at (north, east) where the natural ground without its gullies and small relief stands
 * at `coarse`: the eroded surface where the cut is deep, the natural ground lowered by it where it is shallow. C1
 * (but where it would raise the ground: it never does).
 */
export function erosionCut(f: Pick<ErosionField, 'surface' | 'lowered' | 'home'>, north: number, east: number, coarse: number): number {
  sampleErosion(f, north, east, scratch);
  return erosionCutAt(scratch, coarse);
}

/** The erosion at a point (sampleErosion), for erosionGullies and erosionCutAt. */
export interface ErosionSample {
  /** The lattice's cut, interpolated, m. */
  d: number;
  /** The weight of the eroded surface (erosionWeight). */
  w: number;
  /** The eroded surface, m (when w > 0). */
  t: number;
  /** How much of the cut is kept: none over the home field's pad. */
  keep: number;
  north: number;
  east: number;
}
const scratch: ErosionSample = { d: 0, w: 0, t: 0, keep: 1, north: 0, east: 0 };

/** The erosion at (north, east), into `out`. */
export function sampleErosion(f: Pick<ErosionField, 'surface' | 'lowered' | 'home'>, north: number, east: number, out: ErosionSample): void {
  out.north = north;
  out.east = east;
  out.d = bicubic(f.lowered, LATTICE_N, -DOMAIN_HALF, DRAIN_CELL, north, east, true);
  out.w = erosionWeight(out.d, north, east);
  out.t = out.w > 0 ? bicubic(f.surface, CUT_N, -DOMAIN_HALF, CUT_CELL, north, east) : 0;
  // The interpolation reaches a cell or two in from the faded cells about the home field: none over its pad.
  const hn = north - f.home.north;
  const he = east - f.home.east;
  const r2 = hn * hn + he * he;
  out.keep = r2 < PAD_KEEP[1] * PAD_KEEP[1] ? smoothstep(PAD_KEEP[0], PAD_KEEP[1], Math.sqrt(r2)) : 1;
}

/** The gradient of the erosion at a point (sampleErosionGrad): of the lattice's cut and of the eroded surface, per m. */
export interface ErosionGrad {
  dN: number;
  dE: number;
  tN: number;
  tE: number;
}
const cubic = { v: 0, gy: 0, gx: 0 };

/**
 * sampleErosion with the gradients of its interpolated fields (`g`, per m), for the slope of the eroded ground
 * (erosionCutGrad). Off the lattice (where the fields fade out) the gradients are taken as 0.
 */
export function sampleErosionGrad(f: Pick<ErosionField, 'surface' | 'lowered' | 'home'>, north: number, east: number, out: ErosionSample, g: ErosionGrad): void {
  out.north = north;
  out.east = east;
  const fy = (north + DOMAIN_HALF) / DRAIN_CELL;
  const fx = (east + DOMAIN_HALF) / DRAIN_CELL;
  const inside = fy >= 1 && fx >= 1 && fy < LATTICE_N - 2 && fx < LATTICE_N - 2;
  if (inside) {
    cubicGrad(f.lowered, LATTICE_N, fy, fx, true);
    out.d = cubic.v;
    g.dN = cubic.gy / DRAIN_CELL;
    g.dE = cubic.gx / DRAIN_CELL;
  } else {
    out.d = bicubic(f.lowered, LATTICE_N, -DOMAIN_HALF, DRAIN_CELL, north, east, true);
    g.dN = g.dE = 0;
  }
  out.w = erosionWeight(out.d, north, east);
  g.tN = g.tE = 0;
  if (out.w > 0) {
    if (inside) {
      cubicGrad(f.surface, CUT_N, (north + DOMAIN_HALF) / CUT_CELL, (east + DOMAIN_HALF) / CUT_CELL, false);
      out.t = cubic.v;
      g.tN = cubic.gy / CUT_CELL;
      g.tE = cubic.gx / CUT_CELL;
    } else out.t = bicubic(f.surface, CUT_N, -DOMAIN_HALF, CUT_CELL, north, east);
  } else out.t = 0;
  const hn = north - f.home.north;
  const he = east - f.home.east;
  const r2 = hn * hn + he * he;
  out.keep = r2 < PAD_KEEP[1] * PAD_KEEP[1] ? smoothstep(PAD_KEEP[0], PAD_KEEP[1], Math.sqrt(r2)) : 1;
}

/**
 * The gradient (per m, into `out`: dx east, dy north) of the cut at the point sampleErosionGrad sampled, where the
 * ground without its gullies stands at `coarse` with gradient (cE, cN). The home pad's fade and the lattice's edge
 * fade are taken as constant (their gradients are left out).
 */
export function erosionCutGrad(s: ErosionSample, g: ErosionGrad, coarse: number, cE: number, cN: number, out: { dx: number; dy: number }): void {
  let gE = g.dE;
  let gN = g.dN;
  // (Where the eroded surface's cut comes up to nothing, erosionCutAt rounds it off to 0 over CUT_ROUND m: the
  // derivative of that rounding.)
  let fade = 1;
  if (s.w > 0) {
    const cut = s.w * (s.t - coarse) + (1 - s.w) * s.d;
    if (cut >= CUT_ROUND) {
      out.dx = out.dy = 0;
      return;
    }
    if (cut > -CUT_ROUND) fade = (CUT_ROUND - cut) / (2 * CUT_ROUND);
    // w = smoothstep(REPLACE, -d) times the edge fade: dw/dd from the first.
    const depth = -s.d;
    const u = (depth - REPLACE[0]) / (REPLACE[1] - REPLACE[0]);
    const edge = u > 0 && u < 1 ? s.w / (u * u * (3 - 2 * u)) : 0;
    const dwdd = u > 0 && u < 1 ? (-6 * u * (1 - u) * edge) / (REPLACE[1] - REPLACE[0]) : 0;
    const k = s.t - coarse - s.d;
    gE = dwdd * g.dE * k + s.w * (g.tE - cE) + (1 - s.w) * g.dE;
    gN = dwdd * g.dN * k + s.w * (g.tN - cN) + (1 - s.w) * g.dN;
  }
  out.dx = gE * s.keep * fade;
  out.dy = gN * s.keep * fade;
}
/**
 * Where the eroded surface's cut comes up to nothing (the surface stands over the natural ground) it is 0, rounded off
 * over this much either side (C1: a kink there would crease the ground and turn the gullies oriented by it), m. The
 * rounding lowers the ground by at most a quarter of it.
 */
const CUT_ROUND = 5;
/** min(0, x) rounded off over |x| < CUT_ROUND (never above it). */
function roundMin0(x: number): number {
  if (x <= -CUT_ROUND) return x;
  if (x >= CUT_ROUND) return 0;
  const u = CUT_ROUND - x;
  return -(u * u) / (4 * CUT_ROUND);
}

/** Value and gradient (cell units, into `cubic`) of the bicubic interpolation of `v` at (fy, fx) cells, inside the
 * lattice: the uniform B-spline (`approx`) or Catmull-Rom. */
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
export function erosionCutAt(s: ErosionSample, coarse: number): number {
  const cut = s.w > 0 ? roundMin0(s.w * (s.t - coarse) + (1 - s.w) * s.d) : s.d;
  return cut * s.keep;
}

/**
 * How much of the gullies stay at the sampled point (sampleErosion), [0, 1]: they give way on a channel's valley
 * floor where the eroded surface replaced the ground (the river's bed and the ground it wanders over are its own, not
 * the hillside's).
 */
export function erosionGullies(f: Pick<ErosionField, 'floor'>, s: ErosionSample): number {
  if (s.w <= 0) return 1;
  const fl = bicubicU8(f.floor, CUT_N, -DOMAIN_HALF, CUT_CELL, s.north, s.east) / 255;
  return 1 - Math.min(1, Math.max(0, fl)) * s.w * s.keep;
}

/**
 * How far the ground at (north, east) is replaced by the eroded surface, [0, 1]: by the depth of the lattice's cut
 * there (`d`, the interpolated `lowered`), none within a kilometre of the lattice's edge (and beyond it, where the cut carries
 * on outward over the natural ground), all of it from 4 km in. C1.
 */
function erosionWeight(d: number, north: number, east: number): number {
  const depth = -d;
  if (depth <= REPLACE[0]) return 0;
  const inside = DOMAIN_HALF - Math.max(Math.abs(north), Math.abs(east));
  if (inside <= EDGE_KEEP[0]) return 0;
  return smoothstep(REPLACE[0], REPLACE[1], depth) * smoothstep(EDGE_KEEP[0], EDGE_KEEP[1], inside);
}

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
function upsample(v: Float32Array, n: number): Float32Array {
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
 */
export function erodeLattice(h: Float32Array, n: number, p: ErosionParams = EROSION, hard?: Float32Array): { receiver: Int32Array; area: Float32Array; route: () => void } {
  const N = n * n;
  const receiver = new Int32Array(N);
  const diag = new Uint8Array(N);
  const order = new Int32Array(N);
  const area = new Float32Array(N);
  const filled = new Float32Array(N);
  const done = new Uint8Array(N);
  const heap = new Heap(N);
  const pit = new Int32Array(N);
  const DI = [-1, -1, -1, 0, 0, 1, 1, 1];
  const DJ = [-1, 0, 1, -1, 1, -1, 0, 1];

  const route = (): void => {
    // Priority flood (Barnes et al. 2014) with a FIFO for cells inside hollows, from the sea and the edge.
    done.fill(0);
    receiver.fill(-1);
    let popped = 0;
    let pitHead = 0;
    let pitTail = 0;
    for (let c = 0; c < N; c++) {
      const i = (c / n) | 0;
      const j = c - i * n;
      if (h[c] <= 0 || i === 0 || j === 0 || i === n - 1 || j === n - 1) {
        filled[c] = h[c];
        done[c] = 1;
        heap.push(c, filled[c]);
      }
    }
    while (pitHead < pitTail || heap.size > 0) {
      const c = pitHead < pitTail ? pit[pitHead++] : heap.pop();
      order[popped++] = c;
      const i = (c / n) | 0;
      const j = c - i * n;
      const fc = filled[c];
      for (let k = 0; k < 8; k++) {
        const ii = i + DI[k];
        const jj = j + DJ[k];
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const nb = ii * n + jj;
        if (done[nb]) continue;
        done[nb] = 1;
        receiver[nb] = c;
        diag[nb] = DI[k] !== 0 && DJ[k] !== 0 ? 1 : 0;
        if (h[nb] <= fc + 1e-3) {
          filled[nb] = fc + 1e-3;
          pit[pitTail++] = nb;
        } else {
          filled[nb] = h[nb];
          heap.push(nb, h[nb]);
        }
      }
    }
    // Catchment area in cells: upstream cells come later in flood order.
    area.fill(1);
    for (let k = N - 1; k >= 0; k--) {
      const c = order[k];
      const r = receiver[c];
      if (r >= 0) area[r] += area[c];
    }
  };

  const h0 = h.slice();
  const cut = new Float32Array(N);
  const tmp = new Float32Array(N);
  const kDiag = p.k / Math.SQRT2;
  const kEdge = p.k * (DRAIN_CELL / EDGE_RUN);
  for (let s = 0; s < p.steps; s++) {
    if (s % p.reroute === 0) route();
    for (let k = 0; k < N; k++) {
      const c = order[k];
      const r = receiver[c];
      if (r < 0) {
        // An edge cell: its river runs on beyond the lattice, graded toward a sea EDGE_RUN away, but cut no more than
        // EDGE_CUT into the ground it leads out over (the cut carries on outward and fades, OUTSIDE_FADE).
        const hc = h[c];
        if (hc <= 0) continue;
        const a = area[c];
        const floor = Math.max(LAND_MIN + p.grade * Math.pow(a, -0.45) * EDGE_RUN, h0[c] - EDGE_CUT);
        if (hc <= floor) continue;
        const F = kEdge * Math.pow(a, p.m) * (hard ? hard[c] : 1);
        h[c] = Math.max(floor, hc / (1 + F));
        continue;
      }
      // The sea's surface is the base level (not the shelf under it), so the land stays land.
      const hr = Math.max(h[r], LAND_MIN);
      const hc = h[c];
      // A cell in a hollow lies below its receiver: a sediment trap, left as it is.
      if (hc <= hr) continue;
      const a = area[c];
      const F = (diag[c] ? kDiag : p.k) * Math.pow(a, p.m) * (hard ? hard[c] : 1);
      if (F <= 0) continue;
      const floor = hr + p.grade * Math.pow(a, -0.45) * (diag[c] ? DRAIN_CELL * Math.SQRT2 : DRAIN_CELL);
      if (hc <= floor) continue;
      h[c] = Math.max(floor, (hc + F * hr) / (1 + F));
    }
    if (s === p.steps - 1 - p.settle) for (let b = 0; b < p.blur; b++) spread(h, h0, cut, tmp, n, hard);
  }
  // A channel that steps diagonally between two cells would leave a saddle between them in the interpolated
  // terrain (the two cells beside the step are still high): bring those down to the mean of the step's two ends,
  // so the valley floor runs on down the diagonal.
  for (let k = 0; k < N; k++) {
    const c = order[k];
    const r = receiver[c];
    if (r < 0 || !diag[c] || area[c] < CORNER_AREA) continue;
    const mid = 0.5 * (h[c] + Math.max(h[r], LAND_MIN));
    const ic = (c / n) | 0;
    const ir = (r / n) | 0;
    const a = ir * n + (c - ic * n);
    const b = ic * n + (r - ir * n);
    const ka = hard ? hard[a] : 1;
    const kb = hard ? hard[b] : 1;
    if (h[a] > mid) h[a] -= (h[a] - mid) * ka;
    if (h[b] > mid) h[b] -= (h[b] - mid) * kb;
  }
  return { receiver, area, route };
}

/** Spread the cut (h - h0, <= 0) sideways: a [1 2 1] blur of it, as far as `hard` lets it. Land stays land. */
function spread(h: Float32Array, h0: Float32Array, cut: Float32Array, tmp: Float32Array, n: number, hard?: Float32Array): void {
  const N = n * n;
  for (let c = 0; c < N; c++) cut[c] = h[c] - h0[c];
  for (let i = 0; i < n; i++) {
    const row = i * n;
    for (let j = 0; j < n; j++) {
      const l = j > 0 ? cut[row + j - 1] : cut[row + j];
      const r = j < n - 1 ? cut[row + j + 1] : cut[row + j];
      tmp[row + j] = 0.25 * l + 0.5 * cut[row + j] + 0.25 * r;
    }
  }
  for (let i = 0; i < n; i++) {
    const up = (i > 0 ? i - 1 : i) * n;
    const dn = (i < n - 1 ? i + 1 : i) * n;
    const row = i * n;
    for (let j = 0; j < n; j++) {
      const c = row + j;
      // Fixed cells (the sea) keep their height.
      if (h0[c] <= 0) continue;
      const b = 0.25 * tmp[up + j] + 0.5 * tmp[c] + 0.25 * tmp[dn + j];
      const k = hard ? hard[c] : 1;
      h[c] = Math.max(h0[c] + Math.min(0, k * b + (1 - k) * cut[c]), Math.min(h0[c], LAND_MIN));
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
