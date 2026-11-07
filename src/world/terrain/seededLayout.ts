// The large-scale layout of a seeded world (any seed but 0): where the land and the sea are, where the mountain
// ranges run, and which country is plain and which is hill country. Seed 0 keeps the hand-shaped layout of
// heightfield.ts (coast to the south, range to the north, valley along the runway) and never calls this module.
//
// The layout is a few very broad noise fields, turned and shifted by the seed. The home airfield stays at the origin,
// so the shift is chosen by a search: the first candidate whose macro fields suit (the field on land, land around it
// for the generated airfields, a coast or a range within reach) and whose ground takes a runway (homeSiting.ts) wins,
// and the home field moves there with its own name, heading and elevation (core/world.ts setHomeAirport). Anything
// goes - a coastal plain, a plateau, a basin among mountains, a hillside - as long as the field could be built and
// flown. Pure (no three.js); every thread runs the same search at load and gets the same answer.

import { fbm, fbmGrad, gnoise, mulberry32, type Deriv } from './noise';
import { onWorldSeed, seeded, worldSeed } from '../worldSeed';
import { SEED0_HOME, setHomeAirport } from '../../core/world';
import { siteHome, type HomeSite } from './homeSiting';
import type { Orogen } from './erosion';

/** The macro fields at one point (macroAt). */
export interface Macro {
  /** Warped distance inland from the coast, m (negative offshore); drives the coastal profile. */
  inland: number;
  /** Alpine uplift, about [0, 1.15]: the mountain ranges. */
  uplift: number;
  /** Foothill belt around the ranges, [0, 1]. */
  foothill: number;
  /** Hill-country factor, [0.35, 1]: low in the plains, 1 in the hill country. */
  hilly: number;
}

interface Layout {
  /** Rotation of the layout frame, rad, and its offset, m. */
  cos: number;
  sin: number;
  offX: number;
  offY: number;
  /** Continent noise threshold: more land as it falls. */
  sea: number;
}

const L: Layout = { cos: 1, sin: 0, offX: 0, offY: 0, sea: 0 };

/** Continent wavelength, ridge (range) wavelength, plains/hill-country wavelength, m. */
const CONTINENT = 170000;
const RANGES = 75000;
const COUNTRY = 38000;
/** Metres of "inland" per unit of the continent noise above the threshold. */
const INLAND_SCALE = 95000;

/** The macro fields at a point (any seed but 0). Writes into `out` and returns it. */
export function macroAt(north: number, east: number, out: Macro): Macro {
  // The layout frame: turned and shifted by the seed.
  const x = L.cos * east - L.sin * north + L.offX;
  const y = L.sin * east + L.cos * north + L.offY;

  // Land and sea: a broad fBm, warped so the coast does not follow the noise lattice, with today's small-scale
  // headlands and bays on top.
  const wx = x + 22000 * fbm(x / 60000 + 3.1, y / 60000 - 7.4, 2);
  const wy = y + 22000 * fbm(x / 60000 - 5.6, y / 60000 + 1.3, 2);
  const cont = fbm(wx / CONTINENT, wy / CONTINENT, 4);
  slow[0] = (cont - L.sea) * INLAND_SCALE + 3500 * fbm(east / 28000 + 11.3, north / 28000 - 4.2, 3);

  // Mountain ranges: the crest lines of a ridged noise (long, branching belts), strongest where two octaves agree.
  const rx = x + 14000 * fbm(x / 30000 + 8.8, y / 30000 + 2.2, 2);
  const ry = y + 14000 * fbm(x / 30000 - 1.7, y / 30000 - 6.6, 2);
  slow[1] = gnoise(rx / RANGES + 0.37, ry / RANGES - 0.81);
  slow[2] = gnoise(rx / (RANGES * 0.45) - 4.1, ry / (RANGES * 0.45) + 2.9);
  slow[3] = fbm(east / 55000 - 3.3, north / 55000 + 1.9, 2);
  // Plains and hill country.
  slow[4] = fbm(x / COUNTRY - 2.6, y / COUNTRY + 5.2, 2);
  return fromSlow(north, east, slow[0], slow[1], slow[2], slow[3], slow[4], out);
}

/** The macro fields from their slow parts (macroAt's `slow`) and the coast's 9 km wobble at the point. */
function fromSlow(north: number, east: number, inlandSlow: number, n1: number, n2: number, u3: number, hf: number, out: Macro): Macro {
  out.inland = inlandSlow + 1800 * fbm(east / 9000 - 2.3, north / 9000 + 4.2, 2);
  const ridge = 0.72 * (1 - Math.abs(n1)) + 0.28 * (1 - Math.abs(n2));
  const land = smooth(2000, 22000, out.inland);
  out.uplift = smooth(0.74, 0.93, ridge) * land * (0.85 + 0.3 * u3);
  out.foothill = smooth(0.55, 0.8, ridge) * smooth(-1000, 15000, out.inland);
  out.hilly = 0.35 + 0.65 * smooth(-0.25, 0.25, hf);
  return out;
}
/** The slow parts of the last macroAt: the coast's broad part (all but its 9 km wobble), the two range noises (before
 * their crests are folded), the ranges' strength noise and the hill-country noise. */
const slow = new Float64Array(5);

/** The gradients of the macro fields at one point (macroGradAt), per m: d/d east (e) and d/d north (n). */
export interface MacroGrad {
  inlandE: number;
  inlandN: number;
  upliftE: number;
  upliftN: number;
  foothillE: number;
  foothillN: number;
  hillyE: number;
  hillyN: number;
}

const GD: Deriv = { dx: 0, dy: 0 };
/** smooth() and its derivative (into SD). */
function smoothD(e0: number, e1: number, v: number): number {
  const t = (v - e0) / (e1 - e0);
  if (t <= 0 || t >= 1) {
    SD = 0;
    return t <= 0 ? 0 : 1;
  }
  SD = (6 * t * (1 - t)) / (e1 - e0);
  return t * t * (3 - 2 * t);
}
let SD = 0;

/**
 * macroAt with the gradients of its fields (`g`): the same values, bit for bit, and their derivatives worked through
 * the layout frame, the warps and the smooth steps (the terrain's slope includes the ranges' and the coast's rise, not
 * only the shapes laid on them: heightfield.ts orients its gullies by it).
 */
export function macroGradAt(north: number, east: number, out: Macro, g: MacroGrad): Macro {
  const c = L.cos;
  const s = L.sin;
  const x = c * east - s * north + L.offX;
  const y = s * east + c * north + L.offY;
  // d(x, y)/d(east, north): x_e = c, x_n = -s, y_e = s, y_n = c.
  const f1 = fbmGrad(x / 60000 + 3.1, y / 60000 - 7.4, 2, GD);
  const f1x = GD.dx / 60000;
  const f1y = GD.dy / 60000;
  const f2 = fbmGrad(x / 60000 - 5.6, y / 60000 + 1.3, 2, GD);
  const f2x = GD.dx / 60000;
  const f2y = GD.dy / 60000;
  const wx = x + 22000 * f1;
  const wy = y + 22000 * f2;
  // d(wx, wy)/d(x, y)
  const wxx = 1 + 22000 * f1x;
  const wxy = 22000 * f1y;
  const wyx = 22000 * f2x;
  const wyy = 1 + 22000 * f2y;
  const cont = fbmGrad(wx / CONTINENT, wy / CONTINENT, 4, GD);
  const cwx = GD.dx / CONTINENT;
  const cwy = GD.dy / CONTINENT;
  const contX = cwx * wxx + cwy * wyx;
  const contY = cwx * wxy + cwy * wyy;
  const i2 = fbmGrad(east / 28000 + 11.3, north / 28000 - 4.2, 3, GD);
  const i2e = GD.dx / 28000;
  const i2n = GD.dy / 28000;
  slow[0] = (cont - L.sea) * INLAND_SCALE + 3500 * i2;
  slowG[0] = INLAND_SCALE * (contX * c + contY * s) + 3500 * i2e;
  slowG[1] = INLAND_SCALE * (contX * -s + contY * c) + 3500 * i2n;

  const q1 = fbmGrad(x / 30000 + 8.8, y / 30000 + 2.2, 2, GD);
  const q1x = GD.dx / 30000;
  const q1y = GD.dy / 30000;
  const q2 = fbmGrad(x / 30000 - 1.7, y / 30000 - 6.6, 2, GD);
  const q2x = GD.dx / 30000;
  const q2y = GD.dy / 30000;
  const rx = x + 14000 * q1;
  const ry = y + 14000 * q2;
  const rxx = 1 + 14000 * q1x;
  const rxy = 14000 * q1y;
  const ryx = 14000 * q2x;
  const ryy = 1 + 14000 * q2y;
  // (Each range noise's gradient turned from the warped frame to east and north.)
  for (let k = 0; k < 2; k++) {
    const sc = k === 0 ? RANGES : RANGES * 0.45;
    const nv = k === 0 ? gnoise(rx / sc + 0.37, ry / sc - 0.81, GD) : gnoise(rx / sc - 4.1, ry / sc + 2.9, GD);
    const nrx = GD.dx / sc;
    const nry = GD.dy / sc;
    const nx = nrx * rxx + nry * ryx;
    const ny = nrx * rxy + nry * ryy;
    slow[1 + k] = nv;
    slowG[2 + 2 * k] = nx * c + ny * s;
    slowG[3 + 2 * k] = nx * -s + ny * c;
  }
  slow[3] = fbmGrad(east / 55000 - 3.3, north / 55000 + 1.9, 2, GD);
  slowG[6] = GD.dx / 55000;
  slowG[7] = GD.dy / 55000;
  const hf = fbmGrad(x / COUNTRY - 2.6, y / COUNTRY + 5.2, 2, GD);
  const hfx = GD.dx / COUNTRY;
  const hfy = GD.dy / COUNTRY;
  slow[4] = hf;
  slowG[8] = hfx * c + hfy * s;
  slowG[9] = hfx * -s + hfy * c;
  return fromSlowGrad(north, east, out, g);
}
/** The slow parts' gradients of the last macroGradAt (or of the cache's interpolation), per m: east then north of each. */
const slowG = new Float64Array(10);

/** fromSlow with the gradients, from `slow` and `slowG`. */
function fromSlowGrad(north: number, east: number, out: Macro, g: MacroGrad): Macro {
  const i1 = fbmGrad(east / 9000 - 2.3, north / 9000 + 4.2, 2, GD);
  out.inland = slow[0] + 1800 * i1;
  g.inlandE = slowG[0] + (1800 * GD.dx) / 9000;
  g.inlandN = slowG[1] + (1800 * GD.dy) / 9000;
  const n1 = slow[1];
  const n2 = slow[2];
  // (The derivative of 1 - |n| with its sign rounded off over |n| < 0.02: no jump in the gradient on a crest line.)
  const s1 = -n1 / Math.sqrt(n1 * n1 + 0.0004);
  const s2 = -n2 / Math.sqrt(n2 * n2 + 0.0004);
  const ridge = 0.72 * (1 - Math.abs(n1)) + 0.28 * (1 - Math.abs(n2));
  const ridgeE = 0.72 * s1 * slowG[2] + 0.28 * s2 * slowG[4];
  const ridgeN = 0.72 * s1 * slowG[3] + 0.28 * s2 * slowG[5];
  const land = smoothD(2000, 22000, out.inland);
  const landD = SD;
  const sU = smoothD(0.74, 0.93, ridge);
  const sUD = SD;
  const u3f = 0.85 + 0.3 * slow[3];
  out.uplift = sU * land * u3f;
  g.upliftE = sUD * ridgeE * land * u3f + sU * landD * g.inlandE * u3f + sU * land * 0.3 * slowG[6];
  g.upliftN = sUD * ridgeN * land * u3f + sU * landD * g.inlandN * u3f + sU * land * 0.3 * slowG[7];
  const sF = smoothD(0.55, 0.8, ridge);
  const sFD = SD;
  const sI = smoothD(-1000, 15000, out.inland);
  const sID = SD;
  out.foothill = sF * sI;
  g.foothillE = sFD * ridgeE * sI + sF * sID * g.inlandE;
  g.foothillN = sFD * ridgeN * sI + sF * sID * g.inlandN;
  const sH = smoothD(-0.25, 0.25, slow[4]);
  out.hilly = 0.35 + 0.65 * sH;
  g.hillyE = 0.65 * SD * slowG[8];
  g.hillyN = 0.65 * SD * slowG[9];
  return out;
}

// --- A seeded world's slow macro fields on its drainage lattice ---------------------------------------------------
// The macro fields are noise kilometres broad (all but the coast's 9 km wobble at least 7 km a wave), and macroAt is a
// good share of a terrain sample's cost. heightfield.ts records their slow parts (`slow`) at the lattice's nodes as the
// erosion pass samples them, and from then on the terrain takes them from the lattice (Catmull-Rom: the same values at
// the nodes, metres off between them; macroCached*), the 9 km wobble and the folds and steps worked out per point.
/** Slow parts per node, their nodes per side, the first node's position and the spacing, m. */
let cacheV: Float32Array | null = null;
let cacheN = 0;
let cacheOrigin = 0;
let cacheCell = 1;
let cacheOn = false;
/** Start recording the slow parts on an n x n lattice from (origin, origin), `cell` m apart (the cache is off meanwhile). */
export function macroCacheBegin(n: number, origin: number, cell: number): void {
  cacheOn = false;
  if (!cacheV || cacheV.length !== n * n * 5) cacheV = new Float32Array(n * n * 5);
  cacheN = n;
  cacheOrigin = origin;
  cacheCell = cell;
}
/** Record the last macroAt's slow parts at its node (north, east). */
export function macroCacheRecord(north: number, east: number): void {
  const i = Math.round((north - cacheOrigin) / cacheCell);
  const j = Math.round((east - cacheOrigin) / cacheCell);
  if (!cacheV || i < 0 || j < 0 || i >= cacheN || j >= cacheN) return;
  cacheV.set(slow, (i * cacheN + j) * 5);
}
/** Every node recorded: the terrain takes the slow parts from the lattice (macroCached*) from now on. */
export function macroCacheEnd(): void {
  cacheOn = true;
}
/** Back to working everything out per point (a new seed, before its lattice is recorded). */
export function macroCacheOff(): void {
  cacheOn = false;
}
/** The cache fades into macroAt's own values over this many nodes inside its edge. */
const CACHE_EDGE = [2, 4];

/** Interpolate the slow parts (and with `grad` their gradients) at the point into slow/slowG; the weight of the cache
 * there (1 inside, fading to 0 at its edge: 0 means not used). */
function fromCache(north: number, east: number, grad: boolean): number {
  if (!cacheOn || !cacheV) return 0;
  const fy = (north - cacheOrigin) / cacheCell;
  const fx = (east - cacheOrigin) / cacheCell;
  const edge = Math.min(fy, fx, cacheN - 1 - fy, cacheN - 1 - fx);
  if (!(edge > CACHE_EDGE[0])) return 0;
  const i = Math.floor(fy);
  const j = Math.floor(fx);
  const ty = fy - i;
  const tx = fx - j;
  const tx2 = tx * tx;
  const tx3 = tx2 * tx;
  const ty2 = ty * ty;
  const ty3 = ty2 * ty;
  const ax = 0.5 * (-tx3 + 2 * tx2 - tx);
  const bx = 0.5 * (3 * tx3 - 5 * tx2 + 2);
  const cx = 0.5 * (-3 * tx3 + 4 * tx2 + tx);
  const dx = 0.5 * (tx3 - tx2);
  const ay = 0.5 * (-ty3 + 2 * ty2 - ty);
  const by = 0.5 * (3 * ty3 - 5 * ty2 + 2);
  const cy = 0.5 * (-3 * ty3 + 4 * ty2 + ty);
  const dy = 0.5 * (ty3 - ty2);
  const V = cacheV;
  const n5 = cacheN * 5;
  const b0 = ((i - 1) * cacheN + j - 1) * 5;
  if (!grad) {
    for (let f = 0; f < 5; f++) {
      let o = b0 + f;
      const r0 = ax * V[o] + bx * V[o + 5] + cx * V[o + 10] + dx * V[o + 15];
      o += n5;
      const r1 = ax * V[o] + bx * V[o + 5] + cx * V[o + 10] + dx * V[o + 15];
      o += n5;
      const r2 = ax * V[o] + bx * V[o + 5] + cx * V[o + 10] + dx * V[o + 15];
      o += n5;
      const r3 = ax * V[o] + bx * V[o + 5] + cx * V[o + 10] + dx * V[o + 15];
      slow[f] = ay * r0 + by * r1 + cy * r2 + dy * r3;
    }
  } else {
    const ax1 = 0.5 * (-3 * tx2 + 4 * tx - 1);
    const bx1 = 0.5 * (9 * tx2 - 10 * tx);
    const cx1 = 0.5 * (-9 * tx2 + 8 * tx + 1);
    const dx1 = 0.5 * (3 * tx2 - 2 * tx);
    const ay1 = 0.5 * (-3 * ty2 + 4 * ty - 1);
    const by1 = 0.5 * (9 * ty2 - 10 * ty);
    const cy1 = 0.5 * (-9 * ty2 + 8 * ty + 1);
    const dy1 = 0.5 * (3 * ty2 - 2 * ty);
    const inv = 1 / cacheCell;
    for (let f = 0; f < 5; f++) {
      let o = b0 + f;
      let a0 = V[o], a1 = V[o + 5], a2 = V[o + 10], a3 = V[o + 15];
      const r0 = ax * a0 + bx * a1 + cx * a2 + dx * a3;
      const q0 = ax1 * a0 + bx1 * a1 + cx1 * a2 + dx1 * a3;
      o += n5;
      a0 = V[o]; a1 = V[o + 5]; a2 = V[o + 10]; a3 = V[o + 15];
      const r1 = ax * a0 + bx * a1 + cx * a2 + dx * a3;
      const q1 = ax1 * a0 + bx1 * a1 + cx1 * a2 + dx1 * a3;
      o += n5;
      a0 = V[o]; a1 = V[o + 5]; a2 = V[o + 10]; a3 = V[o + 15];
      const r2 = ax * a0 + bx * a1 + cx * a2 + dx * a3;
      const q2 = ax1 * a0 + bx1 * a1 + cx1 * a2 + dx1 * a3;
      o += n5;
      a0 = V[o]; a1 = V[o + 5]; a2 = V[o + 10]; a3 = V[o + 15];
      const r3 = ax * a0 + bx * a1 + cx * a2 + dx * a3;
      const q3 = ax1 * a0 + bx1 * a1 + cx1 * a2 + dx1 * a3;
      slow[f] = ay * r0 + by * r1 + cy * r2 + dy * r3;
      slowG[2 * f] = (ay * q0 + by * q1 + cy * q2 + dy * q3) * inv;
      slowG[2 * f + 1] = (ay1 * r0 + by1 * r1 + cy1 * r2 + dy1 * r3) * inv;
    }
  }
  return edge >= CACHE_EDGE[1] ? 1 : (edge - CACHE_EDGE[0]) / (CACHE_EDGE[1] - CACHE_EDGE[0]);
}
const slowC = new Float64Array(5);
const slowGC = new Float64Array(10);

/** macroAt, the slow parts from the drainage lattice once it is recorded (macroCacheEnd). */
export function macroCachedAt(north: number, east: number, out: Macro): Macro {
  const w = fromCache(north, east, false);
  if (w <= 0) return macroAt(north, east, out);
  if (w < 1) {
    slowC.set(slow);
    macroAt(north, east, out);
    for (let f = 0; f < 5; f++) slow[f] += (slowC[f] - slow[f]) * w;
  }
  return fromSlow(north, east, slow[0], slow[1], slow[2], slow[3], slow[4], out);
}

/** macroGradAt, the slow parts from the drainage lattice once it is recorded (macroCacheEnd). */
export function macroCachedGradAt(north: number, east: number, out: Macro, g: MacroGrad): Macro {
  const w = fromCache(north, east, true);
  if (w <= 0) return macroGradAt(north, east, out, g);
  if (w < 1) {
    slowC.set(slow);
    slowGC.set(slowG);
    macroGradAt(north, east, out, g);
    for (let f = 0; f < 5; f++) slow[f] += (slowC[f] - slow[f]) * w;
    for (let f = 0; f < 10; f++) slowG[f] += (slowGC[f] - slowG[f]) * w;
  }
  return fromSlowGrad(north, east, out, g);
}

function smooth(e0: number, e1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** How the chosen layout scored (for tests and the dev pages). */
export interface LayoutReport {
  /** Candidate index chosen, and how many were tried. */
  candidate: number;
  tried: number;
  /** Inland distance at the field, m; nearest coast and nearest high range found on the rings, km (Infinity if none). */
  inlandAtField: number;
  coastKm: number;
  rangeKm: number;
  /** The home field's site (homeSiting.ts), null if no candidate took a runway (then seed 0's field stands). */
  site: HomeSite | null;
}

let report: LayoutReport = { candidate: -1, tried: 0, inlandAtField: 0, coastKm: Infinity, rangeKm: Infinity, site: null };
/** The layout search's result for the current seed. */
export const layoutReport = (): LayoutReport => report;

/**
 * The seed's type of mountains (out/tree/PLAN.md §3.1): most seeds get a wide orogen (a "Canterbury" type: one wide
 * mountain mass, its big rivers joining inside it and leaving through a few gorges; erosion.ts Orogen), the rest keep
 * the narrow ridged-noise ranges in wide hill country (a "Manawatu" type). Both are real; the macro model makes either
 * consistent with its rivers. OROGEN_WIDE of the seeds are wide.
 */
const OROGEN_WIDE = 0.75;
export const OROGEN: Orogen = { sigma: 12000, gain: 2.2 };
let orogen: Orogen | null = null;
/** Probes: force the orogen of the next layouts (undefined: the seed's own). */
let orogenForced: Orogen | null | undefined;
export function forceOrogen(o: Orogen | null | undefined): void {
  orogenForced = o;
}
/** The current seed's wide orogen, or null for narrow ranges (and at seed 0). */
export const seededOrogen = (): Orogen | null => orogen;

const CANDIDATES = 400;
const M: Macro = { inland: 0, uplift: 0, foothill: 0, hilly: 0 };

/**
 * The natural ground of the current layout, for the home field's site (homeSiting.ts). heightfield.ts registers it
 * at load (it imports this module, so this one cannot import it).
 */
let natural: ((north: number, east: number) => number) | null = null;
export function setLayoutGround(f: (north: number, east: number) => number): void {
  natural = f;
}

/**
 * Choose the layout for the current seed: the first candidate whose macro fields suit (homeScreen) and whose ground
 * at the origin takes a runway (homeSiting.ts), then move the home field there (core/world.ts setHomeAirport).
 */
function chooseLayout(): void {
  // Seed 0 keeps Fable Regional (and back to it after another seed); the home field moves before anything that
  // derives from it rebuilds (core/world.ts onHomeAirport runs inside setHomeAirport, before heightfield's water).
  setHomeAirport(SEED0_HOME);
  // (The last world's slow macro fields are not this one's.)
  macroCacheOff();
  orogen = null;
  if (worldSeed() === 0) return;
  orogen = orogenForced !== undefined ? orogenForced : mulberry32(seeded(0x0a06e))() < OROGEN_WIDE ? OROGEN : null;
  const rnd = mulberry32(seeded(0x1a7b0));
  let fallback: { L: Layout; report: LayoutReport } | null = null;
  for (let k = 0; k < CANDIDATES; k++) {
    const a = rnd() * Math.PI * 2;
    L.cos = Math.cos(a);
    L.sin = Math.sin(a);
    L.offX = (rnd() - 0.5) * 4e6;
    L.offY = (rnd() - 0.5) * 4e6;
    L.sea = -0.12 + 0.16 * rnd();
    const r = homeScreen(k);
    if (!r) continue;
    fallback ??= { L: { ...L }, report: r };
    const site = natural ? siteHome(natural) : null;
    if (!site) continue;
    report = { ...r, site };
    setHomeAirport({ ...homeName(), elevation: site.elevation, heading: site.heading, ids: site.ids, approachLength: SEEDED_APPROACH });
    return;
  }
  // No candidate took a runway (not seen): the first that suited, with seed 0's field on its plain.
  if (fallback) {
    Object.assign(L, fallback.L);
    report = fallback.report;
  }
}

/** Protected approach length of a seeded world's home field, m (its approach is checked clear out to 10 km). */
const SEEDED_APPROACH = 8000;

/**
 * The macro fields' screen of the current candidate: the field on land, most of the ring the generated airfields use
 * on land too, and a coast or a high range within reach. Anything else - coast or inland, plain or mountains - goes.
 */
function homeScreen(k: number): LayoutReport | null {
  macroAt(0, 0, M);
  const inland0 = M.inland;
  if (inland0 < 1500) return null;
  let coast = Infinity;
  let range = Infinity;
  let landRing = 0;
  let ringPts = 0;
  for (let rk = 10; rk <= 80; rk += 5) {
    const n = Math.round(rk * 0.8) + 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      macroAt(rk * 1000 * Math.cos(a), rk * 1000 * Math.sin(a), M);
      if (M.inland < 0) coast = Math.min(coast, rk);
      if (M.uplift > 0.6) range = Math.min(range, rk);
      if (rk >= 15 && rk <= 45) {
        ringPts++;
        if (M.inland > 3000) landRing++;
      }
    }
  }
  if (landRing / Math.max(1, ringPts) < 0.55) return null;
  if (coast > 80 && range > 80) return null;
  return { candidate: k, tried: k + 1, inlandAtField: inland0, coastKm: coast, rangeKm: range, site: null };
}

const NAME_A = ['Ash', 'Bel', 'Carr', 'Dray', 'Eske', 'Fen', 'Gar', 'Hal', 'Ing', 'Kil', 'Loch', 'Mor', 'Nant', 'Orm', 'Pen', 'Quarr', 'Ros', 'Shel', 'Tarn', 'Ux', 'Vale', 'Wynd', 'Yar', 'Zenn'];
const NAME_B = ['brook', 'bury', 'caster', 'don', 'field', 'gate', 'haven', 'holme', 'ley', 'mouth', 'port', 'ridge', 'thorpe', 'water'];
const NAME_KIND = ['Regional', 'Airport', 'Municipal', 'County'];

/** The home field's name and ICAO code for the current seed ('Kilhaven Regional', 'KKLH'). */
function homeName(): { name: string; icao: string } {
  const r = mulberry32(seeded(0x40e1));
  const place = NAME_A[Math.floor(r() * NAME_A.length)] + NAME_B[Math.floor(r() * NAME_B.length)];
  const kind = NAME_KIND[Math.floor(r() * NAME_KIND.length)];
  const letters = (place[0] + place.slice(1).replace(/[aeiou]/g, '')).toUpperCase().replace(/^K/, '');
  return { name: `${place} ${kind}`, icao: ('K' + letters + 'XXX').slice(0, 4) };
}

chooseLayout();
onWorldSeed(chooseLayout);
