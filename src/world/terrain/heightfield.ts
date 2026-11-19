// The procedural landscape. Pure, deterministic and three.js-free: physics, tile workers, vegetation
// placement and tests all call these functions and get identical answers.
//
// Layout (NED, airport at the origin, runway 07/25 on 070 degrees true):
//   - a broad valley along the runway axis; its floor falls gently WSW toward the coast and rises ENE into
//     the mountains as a glacial trough, with a river running down it ~3 km SSE of the runway;
//   - rolling hills between the valley and the sea, and foothills rising north of it;
//   - an alpine range 20-45 km north with eroded peaks of 2000-3200 m, continuing indefinitely;
//   - the sea ~20 km to the south (level 0 m), with a shelf deepening offshore;
//   - four lakes at fixed levels and a flat airfield with protected approach corridors.
//
// Every function here is unbounded: any (north, east) gives a valid answer.

import { onWorldSeed, seeded, setWorldSeed, worldSeed } from '../worldSeed';
import { macroCacheBegin, macroCachedAt, macroCachedGradAt, macroCacheEnd, macroCacheRecord, seededOrogen, setLayoutGround, type Macro, type MacroGrad } from './seededLayout';
import { clamp, type Vec3 } from '../../core/math';
import type { SurfaceType } from '../../core/types';
import { AIRPORT, onHomeAirport } from '../../core/world';
import { breachWall, smoothRaster } from './streams';
import { CHANNEL_BANK, LAKE_ZONE, RIVER_INFLUENCE, buildHydrology, buildLakes, buildLegacyHydrology, lakeRadius, type ChannelNear, type Hydrology, type Lake, type OxbowHit, type RiverHit, type ValleyHit, type ValleyNear } from './hydrology';
import { buildDrainage, DOMAIN_HALF, DRAIN_CELL, LAKE_RASTER, LakeMask, RASTER_N, ShoreSmooth, type Drainage } from './drainage';
import { gullyNetOf, setGullyNet } from './gullies';
import { attachSlopes, buildErosion, floorHalfFor, FLOOR_SMIN, sminUp, CUT_CELL as CUT_CELL_M, CUT_N, erosionGullies, upsample, markCourse, macroOffset, macroOffsetGrad, modelInputs, modelKey, sampleErosion, sampleErosionGrad, slopeSmoothDelta, steadyLattice, type ErosionField, type ErosionGrad, type ErosionSample, type ModelInputs, type ModelSample } from './erosion';
import { buildNetworkHydrology, floorSet, wallLift, wallStart } from './riverNetwork';
import { braidAt, braidHit, formSection, threadDepth } from './channelForm';
import { slopeKey, slopeParams, slopeStats, thresholdSlopes, type FloorLines, type SlopeField } from './hillslopes';
import { structParams, structureFor } from './structure';
import { buildFaults } from './faults';
import { fbm, gnoise, gullies, gulliesFast, type Deriv } from './noise';
import { era, isPresent } from '../era/eraState';
import { volcanoBound, volcanoHeight, volcanoMerge } from './volcano';
import { setGeneratedAirfields, type Airfield } from '../airfields';
import { siteAirfields } from './airfieldSiting';
import { siteRunway, type RunwayFit } from './homeSiting';

// The home field (core/world.ts AIRPORT): its elevation and runway heading change with the world seed.
let ELEV = AIRPORT.elevation;
const RW = AIRPORT.runway;
const HALF_LEN = RW.length / 2;
const HALF_WID = RW.width / 2;
let RW_COS = Math.cos(RW.heading);
let RW_SIN = Math.sin(RW.heading);
const FLAT = AIRPORT.flatMargin;
const BLEND = AIRPORT.blendDistance;
/** Length of the protected approach corridors beyond each runway end, m. */
let APPROACH_LENGTH = AIRPORT.approachLength;
onHomeAirport(() => {
  ELEV = AIRPORT.elevation;
  RW_COS = Math.cos(RW.heading);
  RW_SIN = Math.sin(RW.heading);
  APPROACH_LENGTH = AIRPORT.approachLength;
});

/** Sea surface elevation, m MSL. */
export const SEA_LEVEL = 0;
/** Approach corridors keep terrain below this gradient from each runway end (3 deg glide path = 0.0524). */
export const APPROACH_GRADIENT = 0.04;

const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** The derivative of smooth(e0, e1, x) in x. */
const smoothD = (e0: number, e1: number, x: number): number => {
  const t = (x - e0) / (e1 - e0);
  return t <= 0 || t >= 1 ? 0 : (6 * t * (1 - t)) / (e1 - e0);
};
/** Quintic smoothstep: C2 continuous, so blended surfaces have no visible crease in their shading. */
const smoother = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
/** Polynomial smooth minimum (Quilez), blending over a band of width k. */
const smin = (a: number, b: number, k: number): number => {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
};

const D: Deriv = { dx: 0, dy: 0 };

/** Value and gradient (per metre) written by the shape functions below. */
interface Shape {
  v: number;
  dx: number;
  dy: number;
}
const massif: Shape = { v: 0, dx: 0, dy: 0 };
const rolling: Shape = { v: 0, dx: 0, dy: 0 };

/**
 * Large-scale mountain shape, about [0, 1]: two octaves of smoothed ridged noise (main ridgelines with
 * crest spacing ~9 km, spurs ~4.5 km) over three octaves of fBm, then sharpened so peaks stand proud of
 * broad valley floors. Relief of ~1500 m per half wavelength gives the 25-35 degree slopes of real alpine
 * terrain. Analytic gradient in 1/m so the gully filter can follow the slope.
 */
function mountainShape(east: number, north: number, out: Shape, exact = false): void {
  let x = east / 9000 + 3.7;
  let y = north / 9000 - 1.2;
  let freq = 1 / 9000;
  let amp = 0.55;
  let v = 0;
  let gx = 0;
  let gy = 0;
  // (With `exact`, a seeded world's: each octave's gradient turned back from its rotated frame, rc, rs.)
  let rc = 1;
  let rs = 0;
  for (let o = 0; o < 5; o++) {
    const n = gnoise(x, y, D);
    if (exact) {
      const dx = D.dx * rc + D.dy * rs;
      D.dy = -D.dx * rs + D.dy * rc;
      D.dx = dx;
      const c = 0.8 * rc - 0.6 * rs;
      rs = 0.6 * rc + 0.8 * rs;
      rc = c;
    }
    if (o < 2) {
      // Ridge 1 - |n| with the kink rounded over |n| < 0.08, so crests are sharp but not creased.
      const s = Math.sqrt(n * n + 0.0064);
      v += amp * (1 - s);
      gx -= amp * (n / s) * D.dx * freq;
      gy -= amp * (n / s) * D.dy * freq;
    } else {
      v += amp * 0.5 * n;
      gx += amp * 0.5 * D.dx * freq;
      gy += amp * 0.5 * D.dy * freq;
    }
    amp *= o === 0 ? 0.55 : 0.5;
    freq *= 2;
    const nx = (0.8 * x - 0.6 * y) * 2 + 5.3;
    y = (0.6 * x + 0.8 * y) * 2 - 2.9;
    x = nx;
  }
  // Sharpen: v^1.5 (with its derivative) keeps valleys broad and peaks steep.
  const c = Math.max(v, 0);
  const sq = Math.sqrt(c);
  out.v = c * sq;
  out.dx = 1.5 * sq * gx;
  out.dy = 1.5 * sq * gy;
}

/** Rolling hills, about [-1, 1]: four octaves of fBm from a 7 km wavelength, with gradient in 1/m. */
function hillShape(east: number, north: number, out: Shape, exact = false): void {
  let x = east / 7000 - 2.1;
  let y = north / 7000 + 6.4;
  let freq = 1 / 7000;
  let amp = 0.6;
  let v = 0;
  let gx = 0;
  let gy = 0;
  let rc = 1;
  let rs = 0;
  for (let o = 0; o < 4; o++) {
    v += amp * gnoise(x, y, D);
    if (exact) {
      const dx = D.dx * rc + D.dy * rs;
      D.dy = -D.dx * rs + D.dy * rc;
      D.dx = dx;
      const c = 0.8 * rc - 0.6 * rs;
      rs = 0.6 * rc + 0.8 * rs;
      rc = c;
    }
    gx += amp * D.dx * freq;
    gy += amp * D.dy * freq;
    amp *= 0.45;
    freq *= 2;
    const nx = (0.8 * x - 0.6 * y) * 2 + 1.7;
    y = (0.6 * x + 0.8 * y) * 2 + 9.2;
    x = nx;
  }
  out.v = v;
  out.dx = gx;
  out.dy = gy;
}

const GULLY_OCTAVES = 5;
/** Wavelength of the coarsest gully cell, m. */
const GULLY_CELL = 1500;
/** Gully stripes per cell. Constant, so steep faces are not hatched with ever finer stripes. */
const GULLY_FREQ = 0.9;
/** How strongly each octave's gullies bend the next octave (branching). */
const GULLY_BRANCH = 1.3;

/**
 * Hydraulic-erosion look: layered slope-aligned gullies, deepest on steep ground and absent on flats.
 * Returns a signed height offset in units of the relief (negative in gullies, positive on the spurs).
 * `cap` (a seeded world's, seededNaturalHeight) bounds the strength from above, softly; seed 0 passes none. With
 * `scale` (the relief in m per unit of the result) the octaves past the first stop where they would add under GULLY_LEAST
 * m; `fast` (a seeded world's) takes gulliesFast.
 */
function erode(east: number, north: number, slopeE: number, slopeN: number, octaves = GULLY_OCTAVES, cap = Infinity, scale = Infinity, fast = false): number {
  gullyFine = 0;
  gullySum = 0;
  // (And the coarse sum and first octave with it: left from the last call, a flat point's ground took that call's
  // gullies - the ground depended on what was sampled before it.)
  gullyCoarse = 0;
  gully0 = 0;
  gully0Im = 0;
  const slope = Math.sqrt(slopeE * slopeE + slopeN * slopeN);
  if (slope < 1e-3) return 0;
  let strength = slope / (slope + 0.15);
  if (cap < Infinity) strength = softMin(strength, cap);
  let ux = slopeE / slope;
  let uy = slopeN / slope;
  let x = east / GULLY_CELL;
  let y = north / GULLY_CELL;
  let sum = 0;
  let amp = 0.5;
  let bx = 0;
  let by = 0;
  let coarseSum = 0;
  let coarseSet = false;
  for (let o = 0; o < octaves; o++) {
    if (o === STREAM_GULLY_OCTAVES) {
      coarseSum = sum;
      coarseSet = true;
    }
    if (o > 0 && amp * strength * scale < GULLY_LEAST) break;
    const dx = ux + bx * GULLY_BRANCH;
    const dy = uy + by * GULLY_BRANCH;
    const k = GULLY_FREQ / Math.sqrt(dx * dx + dy * dy + 1e-9);
    const va = fast ? gulliesFast(x, y, dx * k, dy * k, D) : gullies(x, y, dx * k, dy * k, D);
    if (o === 0) {
      gully0 = va;
      gully0Im = Math.sqrt(D.dx * D.dx + D.dy * D.dy) / GULLY_FREQ;
    }
    sum += amp * va;
    bx += amp * D.dx;
    by += amp * D.dy;
    amp *= 0.5;
    // Next octave: double the frequency and rotate the cell lattice (and the direction frame with it).
    const nx = (0.8 * x - 0.6 * y) * 2 + 0.37;
    y = (0.6 * x + 0.8 * y) * 2 - 0.61;
    x = nx;
    const rx = 0.8 * ux - 0.6 * uy;
    uy = 0.6 * ux + 0.8 * uy;
    ux = rx;
    const cx = 0.8 * bx - 0.6 * by;
    by = 0.6 * bx + 0.8 * by;
    bx = cx;
  }
  if (octaves > STREAM_GULLY_OCTAVES) gullyFine = coarseSet ? (sum - coarseSum) * strength : 0;
  gullySum = sum;
  gullyCoarse = coarseSet ? coarseSum : sum;
  return sum * strength;
}
/** erode's last sum of octaves before its strength (about [-1, 1]: low in the troughs, high on the spurs). */
let gullySum = 0;
/** ... and of its first STREAM_GULLY_OCTAVES octaves only. */
let gullyCoarse = 0;
/** erode's first octave (about [-1, 1]) and its quadrature part (the sine sum: the octave's envelope is their norm). */
let gully0 = 0;
let gully0Im = 0;
/** What the last seeded detail sample's gullies were (probes: the octave sum, the first octave's place across its
 * stripes, the eroded ground's slope and the trough and spur depths, m). */
export const gullyProbe = { g: 0, c0: 0, A0: 0, fall: 0, kCap: 0, kFull: 0, sr: 0, up: 0, gate: 0 };
/** A smooth lower bound of two non-negative numbers: their minimum, rounded off (to 0.92 of it where they are equal). */
function softMin(a: number, b: number): number {
  if (b <= 0 || a <= 0) return 0;
  // (a b / (a^8 + b^8)^(1/8), scaled by the larger to keep the powers in range: 0.92 of the minimum where they meet.)
  const m = Math.max(a, b);
  const x = a / m;
  const y = b / m;
  const x2 = x * x;
  const y2 = y * y;
  const x4 = x2 * x2;
  const y4 = y2 * y2;
  return (a * b) / (m * Math.sqrt(Math.sqrt(Math.sqrt(x4 * x4 + y4 * y4))));
}

// A seeded world's gully floors keep falling (the water that cut them has a way out). Down a gully the ground is the
// eroded macro ground B (the coarse terrain with the erosion's cut) plus the gully relief K g, and g (erode's octave
// sum) varies along a trough by at most about 1.45 per cell (gullies(), p99 of its derivative along the stripes, 200k
// samples) as its kernels' weights shift; over the octaves (amplitudes 1/2, 1/4, ... on cells of 1500, 750, ... m) that
// is a rise of at most K 1.45 x 2.5 / 1500 per metre. Holding K under GULLY_FALL |grad B| keeps it under 0.9 of B's
// own fall along the gully, so its floor keeps falling where the octaves do not all rise together; the gullies follow
// B's fall line (with the erosion's valleys, not the uncut ground's), so their troughs run down it.
/** Deepest gully relief per unit of the eroded ground's slope, m. The bound above gives 372 (0.9 x 1500 / (1.45 x
 * 2.5)); 420 still keeps the rill heads ending in a gully hollow under 10 % on the probed windows (rillFates: 2-9 %,
 * 0-7 % at 372) and gives the hillsides back some of their relief. */
const GULLY_FALL = 420;
/** ... and on gentler ground (B's slope s under GULLY_BEND) at most GULLY_FALL s^2 / GULLY_BEND: a trough's depth then
 * changes along it by 2 GULLY_FALL s ds / GULLY_BEND, which stays under B's own fall s wherever B's slope changes by
 * less than GULLY_BEND / (2 GULLY_FALL) (0.067 per 100 m) along it - so a gully does not shallow out into a hollow
 * at the foot of a slope, where the ground flattens. */
const GULLY_BEND = 0.5;
/** A gully octave adding less than this much relief is not worked out, m (on gentle ground, seeded worlds). */
const GULLY_LEAST = 0.05;
// Only the troughs need holding: water leaves a spur, a crest or a summit, it does not stand on one. So the spurs between
// the troughs keep the hillside's relief (the depth before the floors were held: 0.13 of the relief's amplitude by the
// slope of the relief itself), as a rise over the first gully octave's spur half (where its stripes stand above their
// mean, gully0 > 0): the trough half, where the water runs, is held as A1 held it. The first octave's own place across
// its stripes is robust (its envelope A0, the norm of its cosine and sine sums, says how strongly it is striped); the
// finer octaves' troughs on a spur would carry water across the spur's rise, so they are kept to the trough depth there
// (their part of a spur's rise is the troughs' share of it: all of it on steep ground).
/** The spur's rise starts rounded over this share of the octave's envelope (no crease along the troughs' banks). */
const SPUR_ROUND = 0.2;
/** The finer octaves give way to the smooth spur over this share of the envelope. */
const SPUR_SMOOTH = 0.3;
/** The spurs stand up as far as the first octave is striped (its envelope from the first to the second): where it is not,
 * its spur half is no spur but a shallow fold the finer octaves' water crosses. (A gentle ramp: the envelope itself jumps
 * where the stripes turn quickly, see SPUR_MAX, and a steep one stood spurs up and down in a few metres.) */
const SPUR_COHERENT = [0, 0.9];
/** ... and where the eroded ground falls (slope from the first to the second): on a flat (a saddle, a valley floor, a
 * summit plateau) the troughs cannot fall and spurs would wall them in. */
const SPUR_FALL = [0.02, 0.08];
/** The spur's rise over the trough depth at most SPUR_MAX m plus SPUR_MAX_K times the trough depth. The first octave's
 * stripes turn with the eroded ground's fall line, and on gentle ground (crests, the finer macro octaves' bends) that
 * line turns a degree or more per metre; the stripes, 1.7 km apart and pinned to kernels up to 2 km away, then sweep
 * across the point, and a rise of a few hundred metres stood up as a fluted wall (seed 42 -43172,-6564). Bounded so, a
 * sweep makes a bank of tens of metres at most; on steep ground (deep troughs) the spurs keep more. (Turning the first
 * octave by a smoother fall line instead was tried: more walls and more hollows on the gully floors.) */
const SPUR_MAX = 30;
const SPUR_MAX_K = 0.5;
/** The small-scale relief by the slope too: its knobs (`rough`, m) at most SMALL_FALL and its ledges (`rugged`) at most
 * RUGGED_FALL times the eroded ground's slope (they would bead a gentle gully floor with hollows), and on ground
 * gentler than 2 FLOOR_SLOPE fading into the gully troughs (erode's sum from FLOOR_FADE[1] down to FLOOR_FADE[0]),
 * where the water runs (a steeper floor falls faster than they rise). */
const SMALL_FALL = 18;
const RUGGED_FALL = 4.5;
const FLOOR_FADE = [-0.2, 0.4];
const FLOOR_SLOPE = 0.3;
/** The gully octaves the streams route over (streams.ts: the finer ones are rills on the slopes, finer than its raster). */
const STREAM_GULLY_OCTAVES = 3;
/** What erode's octaves beyond STREAM_GULLY_OCTAVES added to its last result. */
let gullyFine = 0;

/** Valley floor elevation along the runway axis (along = m toward ENE), m. */
function valleyFloor(along: number): number {
  return along <= 0 ? ELEV + 0.0048 * along : ELEV + 0.0055 * along + 1.2e-7 * along * along;
}

/** The derivative of coastProfile, m per m inland. */
function coastProfileD(inland: number): number {
  if (inland >= 0) return (150 / 7000) * Math.exp(-inland / 7000);
  const off = -inland;
  return (80 / 5000) * Math.exp(-off / 5000) + 320 * smoothD(8000, 40000, off);
}

/** Coastal profile against warped distance inland from the coastline, m. */
function coastProfile(inland: number): number {
  if (inland >= 0) return 150 * (1 - Math.exp(-inland / 7000));
  const off = -inland;
  return -80 * (1 - Math.exp(-off / 5000)) - 320 * smooth(8000, 40000, off);
}

/** True in a seeded world (any seed but 0): naturalHeight takes the seeded layout (seededLayout.ts). */
let SEEDED = worldSeed() !== 0;
onWorldSeed(() => {
  SEEDED = worldSeed() !== 0;
});

/** Regional terrain before rivers, lakes and the airport, m MSL. Exported for tests (tests/era/volcano.test.ts). */
export function naturalHeight(north: number, east: number): number {
  if (SEEDED) return seededNaturalHeight(north, east);
  const dn = north - RW.center.north;
  const de = east - RW.center.east;
  const along = dn * RW_COS + de * RW_SIN;
  const across = -dn * RW_SIN + de * RW_COS;

  // Continental-scale warp so the coast, the mountain front and the valley walls meander.
  const wNorth = north + 3500 * fbm(east / 28000 + 11.3, north / 28000 - 4.2, 3);
  const wAcross = across + 1300 * fbm(along / 9000 + 2.1, across / 9000 + 7.7, 2);

  const coastN = -21500 + 7000 * fbm(east / 50000 + 0.5, 1.7, 3) + 1800 * fbm(east / 9000 - 2.3, 4.2, 2);
  const inland = wNorth - coastN;
  const base = coastProfile(inland);

  // Relief above the base: hills everywhere on land (they also make the headlands and bays of the coast),
  // growing into foothills and then the alpine range toward the north.
  const hillAmp = 90 + 260 * smooth(-1000, 7000, inland) + 480 * smooth(0, 20000, wNorth);
  hillShape(east, north, rolling);
  // Biased positive inland so the hills never dip below sea level away from the coast.
  const bias = 0.55 * smooth(-2000, 5000, inland);
  let relief = hillAmp * (rolling.v + bias);
  let gE = hillAmp * rolling.dx;
  let gN = hillAmp * rolling.dy;
  // Alpine uplift, modulated along the range so the peaks cluster into massifs.
  const uplift = smooth(12000, 32000, wNorth) * (0.85 + 0.3 * fbm(east / 55000 - 3.3, north / 55000 + 1.9, 2));
  let amplitude = hillAmp;
  if (uplift > 0) {
    mountainShape(east, north, massif);
    const a = uplift * 3100;
    relief += a * massif.v;
    gE += a * massif.dx;
    gN += a * massif.dy;
    amplitude += a;
  }
  relief += amplitude * 0.13 * erode(east, north, gE, gN);
  let h = base + relief;

  // An era's stratovolcano (volcano.ts): merged by a smooth maximum that leaves the land exactly as it was beyond
  // the cone's foot and wherever the cone lies below it (no hydrology, approach or airfield sample is touched).
  const V = era().terrain.volcano;
  if (V) {
    const vn = north - V.north;
    const ve = east - V.east;
    const b = volcanoBound(V);
    if (vn * vn + ve * ve < b * b) h = volcanoMerge(h, volcanoHeight(north, east, V));
  }

  // The valley: floor at valleyFloor(along), walls starting 1-2.5 km from the axis, merging into the
  // coastal plain. Away from the airfield some of the hills survive on the floor as low spurs and knolls.
  const wallStart = 1700 + 800 * fbm(along / 9000 + 4.4, 0.3, 2);
  const valley = (1 - smooth(wallStart, wallStart + 3400, Math.abs(wAcross))) * (1 - 0.3 * smooth(5000, 15000, Math.abs(along)));
  if (valley > 0) {
    const floor = Math.max(Math.min(valleyFloor(along), base + 15), 0.6 * base) + 7 * fbm(east / 1400, north / 1400, 3);
    h += (floor - h) * valley;
  }

  // Small-scale relief: rougher on high ground; in hills and mountains (outside the valley floor) add
  // rugged ledges and knobs at 9-25 m, the scale between the gully filter and the ground textures.
  const rough = 1.2 + 0.004 * clamp(h, 0, 3000);
  h += rough * (2.2 * gnoise(east / 180 + 0.3, north / 180 + 0.7) + 0.8 * gnoise(east / 60 - 4.1, north / 60 + 2.2));
  const rugged = clamp(amplitude / 1500, 0, 1) * (0.4 + 0.6 * smooth(0.1, 0.5, Math.sqrt(gE * gE + gN * gN))) * (1 - valley);
  if (rugged > 0) {
    const ridge = 1 - Math.abs(gnoise(east / 23 + 7.7, north / 23 - 3.1));
    h += rugged * (2.4 * ridge * ridge + 0.7 * gnoise(east / 9 - 1.3, north / 9 + 5.9));
  }
  return h;
}

const macro: Macro = { inland: 0, uplift: 0, foothill: 0, hilly: 0 };
const macroGrad: MacroGrad = { inlandE: 0, inlandN: 0, upliftE: 0, upliftN: 0, foothillE: 0, foothillN: 0, hillyE: 0, hillyN: 0 };
/** How much of its small-scale relief the point seededNaturalHeight is working on keeps (0 over a lake's domain). */
let calm = 1;
/** A seeded world's gullies smoothed round its lakes (drainage.ts), built with its water for that seed only (the
 * home field's site search, before the water, sees none). */
let shoreSmooth: ShoreSmooth | null = null;
let shoreSeed = 0;
/** A seeded world's lakes (drainage.ts LakeMask), whose domains smooth out the small-scale relief, for that seed only. */
let lakeSmooth: LakeMask | null = null;
let lakeSeed = 0;
// The home field's site search (seededLayout.ts, homeSiting.ts) looks at the noise ground, gullies and all (in the
// mountains they add hundreds of metres the approach trimming would otherwise cut into walls). It sees the ground
// before the load-time corrections (the macro model, erosion.ts, and the shore smoothing round the lakes,
// drainage.ts), which are worked out for the layout it chooses and held at none over the field. The model may raise
// the ground about it as well as lower it, so the site is checked once more on the finished ground (homeRecheck).
setLayoutGround((n, e) => seededNaturalHeight(n, e, true, false));

/** The macro model (erosion.ts), null in seed 0's world. */
let erosion: ErosionField | null = null;
const erosionAt: ErosionSample = { d: 0, c: 0, f: 0, w: 0, r: 0, keep: 1, o: 0, m: 0, hs: 0, ch: 0, fw: 0, fin: 0, fc: Infinity, north: 0, east: 0 };
const erosionGrad: ErosionGrad = { dN: 0, dE: 0, cN: 0, cE: 0, fN: 0, fE: 0, wN: 0, wE: 0, rN: 0, rE: 0, mN: 0, mE: 0, hN: 0, hE: 0 };
const cutGrad: Deriv = { dx: 0, dy: 0 };
const EROSION_N = Math.round((2 * DOMAIN_HALF) / DRAIN_CELL) + 1;

/**
 * naturalHeight in a seeded world: the same coastal profile, hills, mountains, gullies and small-scale relief as
 * today's world, but laid out by the seed's macro fields (seededLayout.ts) instead of the hand-shaped coast, range
 * and valley. The home field takes the ground as it finds it (homeSiting.ts chose a site that takes a runway); only
 * its pad and approaches are levelled, in sampleTerrain.
 */
/** A seeded world's natural terrain without its gullies and small-scale relief (the drainage routes over it). */
export const naturalHeightCoarse = (north: number, east: number): number => seededNaturalHeight(north, east, false);
/** A seeded world's natural terrain before the erosion pass (erosion.ts): what the home field's site search sees. */
export const naturalHeightRaw = (north: number, east: number, detail = true): number => seededNaturalHeight(north, east, detail, false);

/**
 * The ground `h` with the macro model's signed offset applied (erosion.ts macroOffset), C1 in both. Raised ground takes
 * the offset as it is. Land stays land: a lowering is cushioned (a smooth maximum) a metre or two above the sea,
 * blended in over its first 5 m, so the lowest reaches of a river graded down to sea level do not drown. (The one
 * place a lowering is treated apart from a rise.)
 */
function applyMacro(h: number, offset: number): number {
  if (offset >= 0) return h + offset;
  const lowered = h + offset;
  const cushioned = -smin(-lowered, -smin(h, 2, 2), 3);
  return lowered + smooth(0, -5, offset) * (cushioned - lowered);
}

/**
 * The uplift rate of the macro model at the macro fields `m` (erosion.ts steadyLattice: 1 gives the steady drop of
 * STEADY.ridge m over 1 km on a one-cell catchment), in its parts (erosion.ts ModelSample): the ranges' (the alpine
 * uplift, about 0-1.15, over 1.15; the model spreads it into the seed's wide orogen, if it has one), a share for the
 * hill country by its relief amplitude (HILL_UPLIFT per m), and their fade toward the coast.
 */
function upliftParts(m: Macro, out: ModelSample): void {
  const hillAmp = (90 + 260 * smooth(-1000, 7000, m.inland) + 480 * m.foothill) * m.hilly;
  out.u = m.uplift / 1.15;
  out.hill = HILL_UPLIFT * hillAmp;
  out.fade = smooth(0, 15000, m.inland);
}
/**
 * How much of the model's gentlest graded gradient holds at the macro fields `m` (erosion.ts SteadyParams.grade):
 * GRADE_COAST of it at the coast, all of it from 15 km inland (the coastal plains are the rivers' own gravel, not
 * hillslopes: graded fully, they would rise some 40 m in their first kilometre).
 */
function gradeShare(m: Macro): number {
  return GRADE_COAST + (1 - GRADE_COAST) * smooth(0, 15000, m.inland);
}
const GRADE_COAST = 0.5;
/** Uplift rate per metre of the hill country's relief amplitude (0.5 at the hills' highest, 830 m; calibrated with
 * erosion.ts STEADY). */
const HILL_UPLIFT = 0.5 / 830;

/** Probes: the model's valley depth (erosion.ts ErosionField.valley) at the lattice cell nearest a point. */
export function debugValley(north: number, east: number): number {
  if (!erosion) return 0;
  const i = Math.round((north + DOMAIN_HALF) / DRAIN_CELL);
  const j = Math.round((east + DOMAIN_HALF) / DRAIN_CELL);
  return erosion.valley[i * EROSION_N + j];
}
/** Probes: the macro model's parts at a point of the current seeded world (null at seed 0): the change, carve, valley
 * floor weight and noise lattice B-spline (erosion.ts ErosionSample), and the grounds with and without the offset; and
 * the model's own ground there (the offset applied, without the threshold hillslopes). */
export function debugMacro(north: number, east: number): { s: ErosionSample; coarseRaw: number; coarse: number; ground: number; model: number; slope: number } | null {
  if (!erosion) return null;
  const coarseRaw = seededNaturalHeight(north, east, false, false);
  const coarse = seededNaturalHeight(north, east, false, true);
  const ground = seededNaturalHeight(north, east, true, true);
  const s: ErosionSample = { d: 0, c: 0, f: 0, w: 0, r: 0, keep: 1, o: 0, m: 0, hs: 0, ch: 0, fw: 0, fin: 0, fc: Infinity, north: 0, east: 0 };
  sampleErosion(erosion, north, east, s);
  const model = applyMacro(coarseRaw, macroOffset(s, coarseRaw));
  return { s, coarseRaw, coarse, ground, model, slope: s.m > 0 ? slopeGround(s, model) : NaN };
}

/** The threshold hillslopes' ground at the point sampled into `s` with the model's floors drawn in (erosion.ts
 * floorGround): on a floor the model's own ground `g`, about the floors the lowest of their walls, met with the slopes'
 * own ground by a smooth minimum. */
function slopeGround(s: ErosionSample, g: number): number {
  if (!(s.fw > 0)) return s.hs;
  const F = s.fin ? Math.min(g, s.fc) : s.fc;
  return s.hs + s.fw * (sminUp(s.hs, F, FLOOR_SMIN) - s.hs);
}

/** A seeded world's natural terrain without its small-scale relief (the ledges and knobs under 200 m, and the finest
 * gullies): streams.ts routes its streams down it (they follow the gullies and valleys, not the knobs and rills). */
export const naturalHeightSmooth = (north: number, east: number): number => seededNaturalHeight(north, east, true, true, true, false);

/** The small-scale relief seededNaturalHeight last added (its ledges and knobs), m: carveNetwork takes it away along a
 * stream (streams.ts routes and levels them on the ground without it). */
let lastSmall = 0;
/** How far the ground seededNaturalHeight last worked out stands as the threshold hillslopes' walls (erosion.ts
 * ErosionSample.m; 0 off them): carveNetwork only lowers such walls (riverNetwork.ts wallLift). */
let lastWall = 0;

function seededNaturalHeight(north: number, east: number, detail = true, eroded = true, volcano = true, small = true): number {
  lastSmall = 0;
  lastWall = 0;
  let fineGully = 0;
  if (detail) macroCachedGradAt(north, east, macro, macroGrad);
  else macroCachedAt(north, east, macro);
  calm = 1;
  const inland = macro.inland;
  const base = coastProfile(inland);

  const hillAmp = (90 + 260 * smooth(-1000, 7000, inland) + 480 * macro.foothill) * macro.hilly;
  hillShape(east, north, rolling, true);
  const bias = 0.55 * smooth(-2000, 5000, inland);
  let relief = hillAmp * (rolling.v + bias);
  let gE = hillAmp * rolling.dx;
  let gN = hillAmp * rolling.dy;
  const uplift = macro.uplift;
  let amplitude = hillAmp;
  if (uplift > 0) {
    mountainShape(east, north, massif, true);
    const a = uplift * 3100;
    relief += a * massif.v;
    gE += a * massif.dx;
    gN += a * massif.dy;
    amplitude += a;
  }
  // The ground without the gullies (the noise ground the macro model's offset applies to).
  const coarse = base + relief;
  // Its full gradient (with the macro fields' rise: the coast's, the ranges' and the hill country's), for the gullies.
  let cE = gE;
  let cN = gN;
  if (detail) {
    const mg = macroGrad;
    const baseD = coastProfileD(inland);
    const s1 = smoothD(-1000, 7000, inland);
    const hillAmpE = (260 * s1 * mg.inlandE + 480 * mg.foothillE) * macro.hilly + (90 + 260 * smooth(-1000, 7000, inland) + 480 * macro.foothill) * mg.hillyE;
    const hillAmpN = (260 * s1 * mg.inlandN + 480 * mg.foothillN) * macro.hilly + (90 + 260 * smooth(-1000, 7000, inland) + 480 * macro.foothill) * mg.hillyN;
    const biasD = 0.55 * smoothD(-2000, 5000, inland);
    const rb = rolling.v + bias;
    const mv = uplift > 0 ? 3100 * massif.v : 0;
    cE += baseD * mg.inlandE + hillAmpE * rb + hillAmp * biasD * mg.inlandE + mv * mg.upliftE;
    cN += baseD * mg.inlandN + hillAmpN * rb + hillAmp * biasD * mg.inlandN + mv * mg.upliftN;
  }
  const cut = eroded ? erosion : null;
  if (cut) {
    if (detail) sampleErosionGrad(cut, north, east, erosionAt, erosionGrad);
    else sampleErosion(cut, north, east, erosionAt);
    lastWall = erosionAt.m;
  }
  /** The slope of the eroded macro ground, m/m (the gullies and small-scale relief are held to it), and how much of
   * the gullies the point keeps (the small-scale relief fades into their troughs as far). */
  let fall = 0;
  let gullyW = 0;
  gullySum = 0;
  if (detail) {
    // Round a lake (drainage.ts ShoreSmooth) the gullies give way to the smooth basin the lake sits in, and on the
    // floor of a valley the erosion cut (erosion.ts). Not in the ground before the load-time corrections (`eroded`
    // false): the home site search sees no stale smoothing.
    const shore = eroded && shoreSeed === worldSeed() && shoreSmooth ? shoreSmooth.at(north, east) : 0;
    // Over a lake's bed and shore (drainage.ts LakeMask) none of the small-scale relief either, where it could reach
    // down to the water (the lake is flooded on the ground without it): only on ground standing within the relief's
    // reach of the lake's level, so a slope rising from the water keeps its rock and hummocks.
    // (And along the threshold hillslopes' channels and the model's floors they stand on, hillslopes.ts: their floors
    // keep falling.)
    const gullyKeep = (1 - shore) * (cut ? erosionGullies(erosionAt) * (1 - erosionAt.m * erosionAt.ch) : 1);
    let lakeW = eroded && lakeSeed === worldSeed() && lakeSmooth ? lakeSmooth.smooth(north, east) : 0;
    if (lakeW > 0) {
      const hc = cut ? applyMacro(coarse, macroOffset(erosionAt, coarse)) : coarse;
      const reach = 0.13 * amplitude * gullyKeep + 2.2 * (1.2 + 0.004 * clamp(hc, 0, 3000)) + 3.2 + 1;
      lakeW *= 1 - smooth(reach, 1.5 * reach, hc - (lakeSmooth as LakeMask).smoothLevel);
    }
    calm = 1 - lakeW;
    const keep = gullyKeep * calm;
    // The macro ground's gradient: the coarse terrain's with the model's offset's (erosion.ts).
    let bE = cE;
    let bN = cN;
    if (cut) {
      macroOffsetGrad(erosionAt, erosionGrad, coarse, cE, cN, cutGrad);
      bE += cutGrad.dx;
      bN += cutGrad.dy;
      // The threshold hillslopes' ground (hillslopes.ts), blended in by its weight m: (1 - m) B + m H + grad m (H - B).
      // (The slopes' own gradient, smooth across the model's floors' edges, where the floor drawn along its line meets
      // its walls with a crease: the gullies and the small relief are sized by it.)
      const m = erosionAt.m;
      if (m > 0) {
        const g = applyMacro(coarse, macroOffset(erosionAt, coarse));
        const diff = slopeGround(erosionAt, g) - g;
        bE += m * (erosionGrad.hE - bE) + erosionGrad.mE * diff;
        bN += m * (erosionGrad.hN - bN) + erosionGrad.mN * diff;
      }
    }
    fall = Math.sqrt(bE * bE + bN * bN);
    gullyW = keep;
    // (Where the threshold slopes' ground is all there is and none of their gullies is kept - the slopes' weight 1,
    // SlopeParams.gully 0 - the streams' octaves add exactly nothing (their share of the coarse gullies is 0 and they
    // have no finer ones): not worked out.)
    const noGullies = !small && cut !== null && erosionAt.m > 0 && 1 - erosionAt.m * (1 - slopeGully) === 0;
    if (keep > 0 && !noGullies) {
      // The gullies follow the eroded ground's fall line; their troughs are held to it (GULLY_FALL, kCap) and the
      // spurs between them stand up as the hillside's relief allows (kFull, as before the floors were held): see SPUR_*.
      const K = amplitude * 0.13 * keep;
      const str = fall / (fall + 0.15);
      const sr = Math.sqrt(gE * gE + gN * gN);
      const kCap = K * softMin(str, softMin(GULLY_FALL * fall, (GULLY_FALL * fall * fall) / GULLY_BEND) / (0.13 * amplitude + 1e-9));
      const kFull = Math.max((K * sr) / (sr + 0.15), kCap);
      // (Its finer octaves stop where they would add under GULLY_LEAST m in a trough.)
      erode(east, north, bE, bN, small ? GULLY_OCTAVES : STREAM_GULLY_OCTAVES, Infinity, kCap / (str + 1e-9), true);
      const A0 = Math.sqrt(gully0 * gully0 + gully0Im * gully0Im);
      const gate = smooth(SPUR_COHERENT[0], SPUR_COHERENT[1], A0) * smooth(SPUR_FALL[0], SPUR_FALL[1], fall);
      const kSpur = Math.min(kFull - kCap, SPUR_MAX + SPUR_MAX_K * kCap);
      // How far the point stands up the first octave's spur (0 in the trough half of its stripes), and the spur's rise.
      const w = SPUR_ROUND * A0 + 1e-6;
      const up = gully0 <= 0 ? 0 : gully0 < w ? (gully0 * gully0) / (2 * w) : gully0 - w / 2;
      const spur = gully0 <= 0 ? 0 : smooth(0, SPUR_SMOOTH * A0 + 1e-6, gully0) * gate;
      // The finer octaves at the troughs' depth, and on a spur only as far as its rise is the troughs' (steep ground).
      const fineK = kCap * (1 - (spur * kSpur) / (kCap + kSpur + 1e-9));
      const g0 = 0.5 * gully0;
      // (By the slopes' weight: their walls and the floors they stand on, not a band between.)
      const mm = cut ? erosionAt.m : 0;
      if (mm > 0) {
        // In the mountains the threshold hillslopes' channels are the valleys (hillslopes.ts): the gullies the streams
        // route over (the first STREAM_GULLY_OCTAVES) keep SlopeParams.gully of their relief there, the finer ones (the
        // rills' scale) SlopeParams.fine.
        const kc = 1 - mm * (1 - slopeGully);
        const kf = 1 - mm * (1 - slopeFine);
        const fineG = fineK * (gullySum - gullyCoarse);
        relief += kc * (kCap * g0 + fineK * (gullyCoarse - g0) + kSpur * up * gate) + kf * fineG;
        fineGully = kf * fineG;
      } else {
        relief += kCap * g0 + fineK * (gullySum - g0) + kSpur * up * gate;
        fineGully = fineK * (gullySum - gullyCoarse);
      }
      gullyProbe.g = gullySum;
      gullyProbe.c0 = gully0 / (A0 + 1e-9);
      gullyProbe.A0 = A0;
      gullyProbe.kCap = kCap;
      gullyProbe.kFull = kFull;
      gullyProbe.sr = sr;
      gullyProbe.up = up;
      gullyProbe.gate = gate;
    }
  }
  let h = base + relief;
  // The macro model's ground (erosion.ts), C1-smooth: the gullies ride on it. In the mountains it gives way to the
  // threshold hillslopes' ground (hillslopes.ts) by their weight.
  if (cut) {
    let off = macroOffset(erosionAt, coarse);
    if (erosionAt.m > 0) {
      const g = applyMacro(coarse, off);
      off += erosionAt.m * (slopeGround(erosionAt, g) - g);
    }
    h = applyMacro(h, off);
  }

  // The era's volcano over the eroded ground (the erosion pass works on the ground without it, `volcano` false).
  const V = volcano ? era().terrain.volcano : undefined;
  if (V) {
    const vn = north - V.north;
    const ve = east - V.east;
    const b = volcanoBound(V);
    if (vn * vn + ve * ve < b * b) h = volcanoMerge(h, volcanoHeight(north, east, V));
  }

  if (!detail || calm <= 0 || !small) {
    lastSmall = fineGully;
    return h;
  }
  const h0 = h;
  // (Held to the slope and faded into the gully troughs: see SMALL_FALL.)
  const floor = (1 - gullyW * (1 - smooth(FLOOR_FADE[0], FLOOR_FADE[1], gullySum)) * (1 - smooth(FLOOR_SLOPE, 2 * FLOOR_SLOPE, fall))) * (cut ? 1 - erosionAt.m * erosionAt.ch : 1);
  const rough = softMin(calm * floor * (1.2 + 0.004 * clamp(h, 0, 3000)), SMALL_FALL * fall);
  const rugged = softMin(calm * floor * clamp(amplitude / 1500, 0, 1) * (0.4 + 0.6 * smooth(0.1, 0.5, Math.sqrt(gE * gE + gN * gN))), RUGGED_FALL * fall);
  gullyProbe.fall = fall;
  if (rough > 0.02) h += rough * (2.2 * gnoise(east / 180 + 0.3, north / 180 + 0.7) + 0.8 * gnoise(east / 60 - 4.1, north / 60 + 2.2));
  if (rugged > 0.02) {
    const ridge = 1 - Math.abs(gnoise(east / 23 + 7.7, north / 23 - 3.1));
    h += rugged * (2.4 * ridge * ridge + 0.7 * gnoise(east / 9 - 1.3, north / 9 + 5.9));
  }
  lastSmall = h - h0 + fineGully;
  return h;
}

// Both rivers are built at load, against the present-day natural terrain (the era is chosen after): the meandering
// one, and the Late Cretaceous era's (its scenery is placed along the river's earlier course).
// Rebuilt when the world seed changes (worldSeed.ts), against that world's natural terrain.
// A seeded world (any seed but 0) has no hand-placed water: its rivers and lakes come from its drainage
// (drainage.ts, riverNetwork.ts), the same network in every era.
let lakes: Lake[] = [];
/** The last seeded world's drainage lattice (probes only: scripts/probes/treeMeasure.test.ts); null at seed 0. */
export let seededDrainage: Drainage | null = null;
/** The last seeded world's macro model inputs (probes only: the orogen's uplift, the kept lakes); null at seed 0. */
export let seededInputs: ModelInputs | null = null;
let presentHydro: Hydrology;
let legacyHydro: Hydrology;
// The generated airfields (airfields.ts, present day only), sited against the same natural terrain and water.
let fields: readonly Airfield[] = [];
/** Round T: hold a seeded world's lines, rivers and streams, under the ground the airfields cut (holdUnder); the samples
 * it lowered. */
const FIELD_HOLD = true;
/** Round T: a seeded world's ground trimmed under the airfields' approaches before its network carves it (sampleTerrain),
 * the blends into their flats still after. */
const FIELD_FIRST = true;
/** The least a stream's carved banks stand over its water where an airfield's blend flattens them after the carve
 * (fieldUnder), m. */
const HOLD_BANK = 1;
/** Round T repairs: a seeded world's traced streams keep their channels through an airfield's blend into its flat
 * (keepChannels): the blend follows the network's carve, and pulled a stream's carved bed and banks up to the field's
 * elevation over its water - seed 777777 line 720 ran dry for 1.1 km beside KPMH's runway. */
const FIELD_CHANNEL = true;
/** Round T repairs 2: where an airfield's blend into its flat raises the ground over a seeded world's stream, its water
 * is raised with it (holdUnder, fieldOver): to RAISE_UNDER m under the ground as blended. */
const FIELD_RAISE = true;
const RAISE_UNDER = 1.5;
let fieldHeld = 0;
/** The streams' samples FIELD_HOLD lowered (probes). */
export const fieldHeldCount = (): number => fieldHeld;
/** Whether a point lies where an airfield shapes the ground (sampleTerrain): a generated field's reach, the home field's
 * approaches. */
function nearField(north: number, east: number): boolean {
  for (const f of isPresent() ? fields : []) {
    const fn = north - f.north;
    const fe = east - f.east;
    const reach = f.length / 2 + f.approachLength + f.blend;
    if (fn * fn + fe * fe <= reach * reach) return true;
  }
  const dn = north - RW.center.north;
  const de = east - RW.center.east;
  const along = dn * RW_COS + de * RW_SIN;
  const across = -dn * RW_SIN + de * RW_COS;
  return Math.abs(along) - HALF_LEN < APPROACH_LENGTH && Math.abs(across) < 2 * (300 + 0.12 * APPROACH_LENGTH);
}
/** A generated field within reach of a point (sampleTerrain: they are spaced so at most one is) and the point in its
 * runway's coordinates (fieldAt), or null. */
const fieldAt = { f: null as Airfield | null, along: 0, across: 0, rect: Infinity };
function fieldNear(north: number, east: number): Airfield | null {
  fieldAt.f = null;
  for (const f of isPresent() ? fields : []) {
    const fn = north - f.north;
    const fe = east - f.east;
    const reach = f.length / 2 + f.approachLength + f.blend;
    if (fn * fn + fe * fe > reach * reach) continue;
    const c = Math.cos(f.heading);
    const sn = Math.sin(f.heading);
    fieldAt.along = fn * c + fe * sn;
    fieldAt.across = -fn * sn + fe * c;
    const fx = Math.max(Math.abs(fieldAt.along) - f.length / 2, 0);
    const fy = Math.max(Math.abs(fieldAt.across) - f.width / 2, 0);
    fieldAt.rect = Math.sqrt(fx * fx + fy * fy);
    fieldAt.f = f;
    break;
  }
  return fieldAt.f;
}
/** Ground h trimmed under the airfields' approaches (sampleTerrain): the home field's under APPROACH_GRADIENT from its
 * runway's ends, a generated field's (`gf`, the point in its runway's coordinates) the same. */
function approachTrim(h: number, along: number, across: number, gf: Airfield | null, gAlong: number, gAcross: number): number {
  const beyond = Math.abs(along) - HALF_LEN;
  if (beyond > 0 && beyond < APPROACH_LENGTH) {
    const halfW = 300 + 0.12 * beyond;
    const w = (1 - smooth(halfW, halfW * 1.8, Math.abs(across))) * (1 - smooth(APPROACH_LENGTH * 0.85, APPROACH_LENGTH, beyond));
    if (w > 0) {
      const excess = h - (ELEV + APPROACH_GRADIENT * beyond);
      h -= w * 0.5 * (excess + Math.sqrt(excess * excess + 400));
    }
  }
  if (gf) {
    const gBeyond = Math.abs(gAlong) - gf.length / 2;
    if (gBeyond > 0 && gBeyond < gf.approachLength) {
      const halfW = 150 + 0.12 * gBeyond;
      const w = (1 - smooth(halfW, halfW * 1.8, Math.abs(gAcross))) * (1 - smooth(gf.approachLength * 0.85, gf.approachLength, gBeyond));
      if (w > 0) {
        const excess = h - (gf.elevation + APPROACH_GRADIENT * gBeyond);
        h -= w * 0.5 * (excess + Math.sqrt(excess * excess + 400));
      }
    }
  }
  return h;
}
/** The ground h at a point as a seeded world's network carves it near the airfields: trimmed under their approaches
 * (FIELD_FIRST; the blends into their flats come after the carve). */
function fieldTrim(h: number, north: number, east: number): number {
  const dn = north - RW.center.north;
  const de = east - RW.center.east;
  const gf = fieldNear(north, east);
  return approachTrim(h, dn * RW_COS + de * RW_SIN, -dn * RW_SIN + de * RW_COS, gf, fieldAt.along, fieldAt.across);
}
/** The highest a stream's water may stand at a point by the airfields, levelled on ground g there: 1 m under that
 * ground trimmed under the approaches (the channel is carved into it), and where a blend into a flat follows the carve -
 * pulling the banks towards the field's elevation - no higher than leaves its banks (HOLD_BANK over the water as carved)
 * over the water when blended; under a flat itself, 1 m under it. */
function fieldUnder(g: number, north: number, east: number): number {
  const dn = north - RW.center.north;
  const de = east - RW.center.east;
  const along = dn * RW_COS + de * RW_SIN;
  const across = -dn * RW_SIN + de * RW_COS;
  const ox = Math.max(Math.abs(along) - HALF_LEN, 0);
  const oy = Math.max(Math.abs(across) - HALF_WID, 0);
  const dRect = Math.sqrt(ox * ox + oy * oy);
  if (dRect <= FLAT) return ELEV - 1;
  const gf = fieldNear(north, east);
  if (gf && fieldAt.rect <= gf.flatMargin) return gf.elevation - 1;
  let t = approachTrim(g + 1, along, across, gf, fieldAt.along, fieldAt.across) - 1;
  // (Blended, a bank b over water t stands at E + (t + b - E) * k: over t while t <= E + b k / (1 - k).)
  if (gf) {
    const k = smoother(gf.flatMargin, gf.flatMargin + gf.blend, fieldAt.rect);
    if (k < 1 && t > gf.elevation) t = Math.min(t, gf.elevation + (HOLD_BANK * k) / (1 - k));
  }
  const k = smoother(FLAT, FLAT + BLEND, dRect);
  if (k < 1 && t > ELEV) t = Math.min(t, ELEV + (HOLD_BANK * k) / (1 - k));
  return t;
}
/**
 * FIELD_RAISE: the least a stream's water should stand at by the airfields, levelled on ground g there, where a blend
 * into a flat with its elevation E over the water raises the ground over it: so that the ground as blended stands no
 * more than RAISE_UNDER m over it. The blend follows the carve, so a stream left at its level ran deep under the
 * blended ground: buried (seed 777777 line 734 under KHLT's approach, 9 m), or, cut back into it (keepChannels), at the
 * foot of a gully that deep (734), or under a cut bank of 4.4 m (720 by KPMH). Blended by k, ground h stands at
 * E + (h - E) k: by its own ground (g trimmed under the approaches, t) the water stands at E + (t - E) k - RAISE_UNDER;
 * where that ground stands higher, the carve leaves the banks BANK_HEIGHT over the water, and the water stands at
 * E - (RAISE_UNDER - BANK_HEIGHT k) / (1 - k). The lower of the two; -Infinity where no blend raises the ground.
 */
function fieldOver(g: number, north: number, east: number): number {
  const dn = north - RW.center.north;
  const de = east - RW.center.east;
  const along = dn * RW_COS + de * RW_SIN;
  const across = -dn * RW_SIN + de * RW_COS;
  const ox = Math.max(Math.abs(along) - HALF_LEN, 0);
  const oy = Math.max(Math.abs(across) - HALF_WID, 0);
  const dRect = Math.sqrt(ox * ox + oy * oy);
  const gf = fieldNear(north, east);
  const t = approachTrim(g, along, across, gf, fieldAt.along, fieldAt.across);
  const under = (E: number, k: number): number => (k < 1 ? Math.min(E + (t - E) * k - RAISE_UNDER, E - (RAISE_UNDER - BANK_HEIGHT * k) / (1 - k)) : -Infinity);
  let to = -Infinity;
  if (gf && fieldAt.rect > gf.flatMargin) to = under(gf.elevation, smoother(gf.flatMargin, gf.flatMargin + gf.blend, fieldAt.rect));
  if (dRect > FLAT) to = Math.max(to, under(ELEV, smoother(FLAT, FLAT + BLEND, dRect)));
  return to;
}
/** The home runway checked on the finished ground of the last seeded world (homeSiting.ts siteRunway); null at seed 0. */
export let homeRecheck: RunwayFit | null = null;
/** A seeded world's macro model cells (erosion.ts steadyLattice) for one seed and input key. */
export interface SeededModel {
  seed: number;
  key: string;
  lattice: Float32Array;
  /** The mountains' threshold hillslopes on the fine grid (hillslopes.ts), worked out from the cells. */
  slopes?: SlopeField | null;
  /** The ground the streams are routed over, without the rivers' valleys, on the streams' 250 m raster (streams.ts
   * smoothRaster), worked out once the slopes are. */
  route?: Float32Array | null;
}
/** How many raster points a handed-over streams' raster is checked at against the ground worked out afresh (a stale
 * cache entry - the ground's code changed under the same model key - is worked out again). */
const ROUTE_CHECKS = 24;
/** The model cells handed over for the next build (macroCache.ts, a terrain worker's setup), if any. */
let providedModel: SeededModel | null = null;
/** The streams' raster of the current seeded build (SeededModel.route). */
let streamRaster: Float32Array | null = null;
/** The model cells the last seeded build used (to hand on to the terrain workers and the cache); null at seed 0. */
let lastModel: SeededModel | null = null;
/** How long the last seeded build spent in the model, ms (0 when it was handed over). */
export let modelMs = 0;
/** While set, a seeded build stops once the model cells and the threshold hillslopes are worked out (computeSeededModel:
 * the model worker). */
let modelOnly = false;
/** Thrown out of the river network's build to stop there (modelOnly). */
const MODEL_DONE = { done: true };
/**
 * Work out a seed's model cells and its mountains' threshold hillslopes (they need the rivers' axes laid out, so the
 * drainage is built as far as that) and nothing else of its world (macroWorker.ts: one worker does this for the main
 * thread and the terrain workers). Leaves this thread's world half built: for a thread of its own.
 */
export function computeSeededModel(seed: number): SeededModel | null {
  modelOnly = true;
  try {
    setWorldSeed(seed);
  } finally {
    modelOnly = false;
  }
  return lastModel;
}
/** Hand over a seed's model cells before its world is built (setWorldSeed): used when its input key matches. */
export function provideSeededModel(m: SeededModel | null): void {
  providedModel = m;
}
/** The model cells the current world was built with (null at seed 0). */
export const seededModel = (): SeededModel | null => lastModel;
/** How long the last seeded world's airfield siting took, ms (probes). */
export let siteMs = 0;
function buildWater(): void {
  setGullyNet(null);
  if (SEEDED) {
    // The macro model first (erosion.ts): the steady state of uplift and river incision over the noise ground's
    // drainage, which the terrain takes as its macro ground. Then the drainage, routed over the model's cells (they
    // drain by construction; the hollows left by the held home field and the era's volcano are breached or ponded,
    // Lindsay 2016).
    erosion = null;
    shoreSmooth = null;
    lakeSmooth = null;
    const home = AIRPORT.runway.center;
    // Worked out on the ground without the era's volcano, as the offset is applied (the cone merges over it after).
    // (Its lattice's nodes record the slow macro fields as they are sampled: the terrain takes them from there after.)
    macroCacheBegin(EROSION_N, -DOMAIN_HALF, DRAIN_CELL);
    const inputs = modelInputs((n, e, out) => {
      out.h = seededNaturalHeight(n, e, false, false, false);
      upliftParts(macro, out);
      out.g = gradeShare(macro);
      macroCacheRecord(n, e);
    }, { north: home.north, east: home.east, heading: AIRPORT.runway.heading }, seededOrogen(), true);
    macroCacheEnd();
    // The mountains' structure (structure.ts: erodibility bands along strike, the faults' uplift steps, the front
    // block), on a seed with a wide orogen only (narrow ranges keep their character).
    if (seededOrogen()) inputs.struct = structureFor(inputs, buildFaults(), seeded(STRUCT_SALT), structParams());
    seededInputs = inputs;
    // The model's cells: handed over for this seed (macroCache.ts: another thread or the cache worked them out), or
    // worked out here.
    const sp = slopeParams();
    slopeGully = sp.gully;
    slopeFine = sp.fine;
    const key = `${modelKey(inputs)}-${slopeKey(sp)}`;
    const handed = providedModel && providedModel.seed === worldSeed() && providedModel.key === key ? providedModel : null;
    const given = handed ? handed.lattice : null;
    const t0 = performance.now();
    const T = given ?? steadyLattice(inputs);
    modelMs = given ? 0 : performance.now() - t0;
    const eroded = buildErosion(inputs, T);
    erosion = eroded;
    lastModel = { seed: worldSeed(), key, lattice: T, slopes: null };
    // The macro cells the drainage settles its lakes on and the cells it routes the water over (erosion.ts: the same
    // cells, as drawn and as the model routed them), each with the cushion above the sea and the era's volcano.
    const lat = eroded.lattice;
    const rte = eroded.routing;
    const V = era().terrain.volcano;
    for (let c = 0; c < lat.length; c++) {
      lat[c] = applyMacro(eroded.base[c], lat[c] - eroded.base[c]);
      rte[c] = applyMacro(eroded.base[c], rte[c] - eroded.base[c]);
      if (!V) continue;
      const north = -DOMAIN_HALF + Math.floor(c / EROSION_N) * DRAIN_CELL;
      const east = -DOMAIN_HALF + (c % EROSION_N) * DRAIN_CELL;
      const b = volcanoBound(V);
      if ((north - V.north) ** 2 + (east - V.east) ** 2 < b * b) {
        lat[c] = volcanoMerge(lat[c], volcanoHeight(north, east, V));
        rte[c] = volcanoMerge(rte[c], volcanoHeight(north, east, V));
      }
    }
    const drainage = buildDrainage(naturalHeightCoarse, naturalHeight, (ponds) => {
      shoreSmooth = new ShoreSmooth(EROSION_N, -DOMAIN_HALF, ponds, home);
      shoreSeed = worldSeed();
    }, lat, rte);
    seededDrainage = drainage;
    // Its lakes are the drainage's ponds, flooded on the detailed ground (LakeMask): the water covers the natural
    // ground below their level, nothing carved; the fitted ellipses only place things by them.
    const mask = new LakeMask(drainage, naturalHeightCoarse);
    lakeSmooth = mask;
    lakeSeed = worldSeed();
    lakes = [];
    // Each river's own floor is marked into the model (erosion.ts markCourse) once its axis is laid out, before its
    // levels are read off the ground: not by a lake (its basin and shore were flooded on the ground without the mark).
    const R = CUT_CELL_M;
    const byLake = (n: number, e: number): number => (mask.smooth(n, e) > 0 || mask.smooth(n + R, e) > 0 || mask.smooth(n - R, e) > 0 || mask.smooth(n, e + R) > 0 || mask.smooth(n, e - R) > 0 ? 0 : 1);
    // Then the mountains' threshold hillslopes (hillslopes.ts), graded up from the floors the model carved (handed over
    // with the cells, or worked out here: the model worker stops there): so the rivers' levels, read next, are those of
    // the model's floors, and the streams are traced down the slopes' valleys.
    try {
      presentHydro = buildNetworkHydrology(naturalHeight, drainage, mask, eroded.valley, naturalHeightSmooth, (axes) => {
        markCourse(eroded, axes, byLake);
        // (The rivers' own courses are floors' lines too, as wide as their own floors (the floodplain and the channel's
        // swing, floorHalf): where a river leaves the channel the model carved - through the drainage's cuts and lakes -
        // or its meanders swing past the model's floor, its floor is the slopes' base level as the model's are.)
        eroded.floorLines = withCourses(eroded.floorLines, axes);
        const t1 = performance.now();
        const slopes = (handed && handed.slopes) || mountainSlopes(inputs, sp, eroded);
        if (!(handed && handed.slopes)) modelMs += performance.now() - t1;
        attachSlopes(eroded, slopes);
        // (The slopes' own routing, with its catchment: the streams follow it, gullies.ts.)
        setGullyNet(gullyNetOf(slopes));
        // The ground the streams are routed over, on their raster (handed over with the model where it is still the
        // ground worked out here: checked at a few points), and from here the ponds drained or lowered are taken afresh.
        const t2 = performance.now();
        const given2 = handed && handed.route && handed.route.length === RASTER_N * RASTER_N ? handed.route : null;
        let fresh = !!given2;
        for (let c = 0; c < ROUTE_CHECKS && given2; c++) {
          const k = Math.floor(((c + 0.5) / ROUTE_CHECKS) * given2.length);
          const v = given2[k];
          if (v !== v) continue;
          if (Math.fround(naturalHeightSmooth(-DOMAIN_HALF + Math.floor(k / RASTER_N) * LAKE_RASTER, -DOMAIN_HALF + (k % RASTER_N) * LAKE_RASTER)) !== v) fresh = false;
        }
        streamRaster = fresh && given2 ? given2 : smoothRaster(drainage, naturalHeightSmooth);
        mask.changed.length = 0;
        if (!fresh) modelMs += performance.now() - t2;
        lastModel = { seed: worldSeed(), key, lattice: T, slopes, route: streamRaster };
        if (modelOnly) throw MODEL_DONE;
      }, slopePinned, slopeWall, () => streamRaster);
    } catch (e) {
      if (e === MODEL_DONE) return;
      throw e;
    }
    legacyHydro = presentHydro;
    // The home field was sited on the noise ground and held during the model (erosion.ts HOME_KEEP): checked once more
    // on the finished ground (the model may have raised the approach or the circuit).
    homeRecheck = siteRunway(naturalHeight, AIRPORT.runway.heading);
    if (!homeRecheck.ok) console.warn(`[terrain] seed ${worldSeed()}: the home runway fails its check on the macro ground`, homeRecheck);
    const tf = performance.now();
    fields = siteAirfields(naturalHeight, presentHydro, presentHydro.lakes);
    siteMs = performance.now() - tf;
    setGeneratedAirfields(fields);
    // Round T (FIELD_HOLD): the streams' water held under the ground the airfields' approaches and flats cut (sampleTerrain),
    // which the streams, traced first, were not levelled on (seed 777777 line 720 stood 50 m over an approach).
    // (FIELD_RAISE: and raised where a blend into a flat raises the ground over it.)
    if (FIELD_HOLD) fieldHeld = presentHydro.holdUnder?.(fieldTrim, fieldUnder, nearField, FIELD_RAISE ? fieldOver : undefined) ?? 0;
    return;
  } else {
    erosion = null;
    lastModel = null;
    homeRecheck = null;
    seededDrainage = null;
    seededInputs = null;
    lakes = buildLakes(naturalHeight);
    presentHydro = buildHydrology(naturalHeight, lakes);
    legacyHydro = buildLegacyHydrology(naturalHeight, lakes);
  }
  fields = siteAirfields(naturalHeight, presentHydro, lakes);
  setGeneratedAirfields(fields);
}
buildWater();
onWorldSeed(buildWater);
/** The water of the current era. */
const current = (): Hydrology => (isPresent() ? presentHydro : legacyHydro);

/** How far a stream's raster course is pinned to its points (streams.ts traceStreams): on the threshold hillslopes'
 * channels' floors (hillslopes.ts), by their weight. */
const pinAt: ErosionSample = { d: 0, c: 0, f: 0, w: 0, r: 0, keep: 1, o: 0, m: 0, hs: 0, ch: 0, fw: 0, fin: 0, fc: Infinity, north: 0, east: 0 };
function slopePinned(north: number, east: number): number {
  if (!erosion || !erosion.slopes) return 0;
  sampleErosion(erosion, north, east, pinAt);
  return Math.min(1, pinAt.m * pinAt.ch * 2);
}
/** The threshold hillslopes' ground smoothed less as drawn (erosion.ts slopeSmoothDelta), m: 0 without them. */
export function slopeRouteDelta(north: number, east: number): number {
  if (!erosion || !erosion.slopes) return 0;
  return slopeSmoothDelta(erosion, north, east);
}
/** How far the ground stands as the threshold hillslopes' walls (lastWall), for riverNetwork.ts's carve. */
function slopeWall(north: number, east: number): number {
  if (!erosion || !erosion.slopes) return 0;
  sampleErosion(erosion, north, east, pinAt);
  return pinAt.m;
}
/** The threshold hillslopes come in from the fine grid's edge between these distances, m: the model's change carries on
 * past the lattice's edge and fades out (erosion.ts OUTSIDE_FADE), the slopes not (the terrain reads none of the grid
 * within its outer rows), so they are gone well inside it. */
const SLOPE_EDGE = [10000, 16000];
/** The structure's noise salt (structure.ts). */
const STRUCT_SALT = 0x57c3;
/** The gullies' share of their relief in the threshold hillslopes' mountains (hillslopes.ts SlopeParams.gully), for the
 * current world. */
let slopeGully = 1;
let slopeFine = 1;
/** The model's floors' lines (erosion.ts floorLines) and the rivers' courses (their valley axes) as lines after them,
 * each point's half-width the wider of the model's floor for its catchment (floorHalfFor) and the river's own floor
 * (riverNetwork.ts floorHalf, as markCourse marks it). */
function withCourses(L: FloorLines, axes: ReadonlyArray<{ north: ArrayLike<number>; east: ArrayLike<number>; half: ArrayLike<number>; area: ArrayLike<number> }>): FloorLines {
  const start = Array.from(L.start);
  const n = Array.from(L.north);
  const e = Array.from(L.east);
  const h = Array.from(L.half);
  const cap = Array.from(L.cap);
  for (const a of axes) {
    const m = a.north.length;
    if (m < 2) continue;
    for (let i = 0; i < m; i++) {
      n.push(a.north[i]);
      e.push(a.east[i]);
      h.push(Math.max(floorHalfFor(a.area[i]), a.half[i]));
    }
    start.push(n.length);
    cap.push(3);
  }
  return { start: Int32Array.from(start), north: Float32Array.from(n), east: Float32Array.from(e), half: Float32Array.from(h), cap: Uint8Array.from(cap) };
}
/**
 * The threshold-hillslope pass (hillslopes.ts) over a seeded world's mountains: its weight from the orogen's mountain
 * mask (the ranges' uplift share with the envelope, erosion.ts ModelInputs.ur, SlopeParams.onset to full), none over
 * the home field's held ground and its protected surfaces; graded up from the floors the model carved (erosion.ts
 * floorLines), at the model's ground on their lines; on the ground the model built.
 */
function mountainSlopes(inputs: ModelInputs, sp: ReturnType<typeof slopeParams>, eroded: ErosionField): SlopeField {
  // (The front block, structure.ts, stands outside the orogen's mask: it takes the mountains' slopes by its weight.)
  const blk = inputs.struct ? inputs.struct.block : null;
  const ur = upsample(blk ? Float32Array.from(inputs.ur, (v, c) => Math.max(v, sp.onset + (sp.full - sp.onset) * blk[c])) : inputs.ur, inputs.n);
  const hard = upsample(inputs.hard, inputs.n);
  const cap = upsample(inputs.cap, inputs.n);
  const w = new Float32Array(ur.length);
  for (let q = 0; q < w.length; q++) {
    const t = Math.min(1, Math.max(0, (ur[q] - sp.onset) / (sp.full - sp.onset)));
    if (t <= 0) continue;
    // (None toward the fine grid's edge, where the terrain stops reading it: SLOPE_EDGE.)
    const y = Math.floor(q / CUT_N);
    const x = q - y * CUT_N;
    const edge = CUT_CELL_M * Math.min(x, y, CUT_N - 1 - x, CUT_N - 1 - y);
    const te = Math.min(1, Math.max(0, (edge - SLOPE_EDGE[0]) / (SLOPE_EDGE[1] - SLOPE_EDGE[0])));
    w[q] = t * t * (3 - 2 * t) * te * te * (3 - 2 * te) * Math.min(1, Math.max(0, hard[q])) * (1 - Math.min(1, Math.max(0, cap[q])));
  }
  // The floors' edges' levels: the model's ground at each edge, left and right of each point of their lines (where a
  // node lies on a floor it is the model's own ground there).
  const ground = (n: number, e: number): number => seededNaturalHeight(n, e, false, true, false);
  const L = eroded.floorLines;
  const tz = performance.now();
  const lz = new Float32Array(2 * L.north.length);
  for (let li = 0; li < L.start.length - 1; li++) {
    const k0 = L.start[li];
    const k1 = L.start[li + 1] - 1;
    for (let k = k0; k <= k1; k++) {
      const a = Math.max(k0, k - 1);
      const b = Math.min(k1, k + 1);
      const tn = L.north[b] - L.north[a];
      const te = L.east[b] - L.east[a];
      const s = L.half[k] / (Math.hypot(tn, te) || 1);
      if (s > 0) {
        lz[2 * k] = ground(L.north[k] - te * s, L.east[k] + tn * s);
        lz[2 * k + 1] = ground(L.north[k] + te * s, L.east[k] - tn * s);
      } else lz[2 * k] = lz[2 * k + 1] = ground(L.north[k], L.east[k]);
    }
  }
  const msLevels = performance.now() - tz;
  const out = thresholdSlopes(CUT_N, CUT_CELL_M, w, ground, L, lz, sp);
  slopeStats.msLevels = msLevels;
  return out;
}
/** Rivers and lakes of the current era (read at call time, like era()). */
export const hydrology: Readonly<Hydrology> = {
  get lakes() { return current().lakes; },
  get river() { return current().river; },
  get valley() { return current().valley; },
  get oxbows() { return current().oxbows; },
  get rivers() { return current().rivers; },
  get network() { return current().network; },
  get lakeMask() { return current().lakeMask; },
  get falls() { return current().falls; },
  get faults() { return current().faults; },
  get streamReport() { return current().streamReport; },
  get queryFlow() { return current().queryFlow; },
  get fallsNear() { return current().fallsNear; },
  queryRiver: (north, east, out) => current().queryRiver(north, east, out),
  queryValley: (north, east, out) => current().queryValley(north, east, out),
  queryOxbow: (north, east, out) => current().queryOxbow(north, east, out),
};

/** Full terrain sample; see sampleTerrain. */
export interface TerrainSample {
  /** Solid ground (or water bed) elevation, m MSL. */
  ground: number;
  /** Surface level of standing water (sea or lake) that would cover this point; SEA_LEVEL away from lakes. */
  standing: number;
  /** River surface level when inside the river channel, otherwise -Infinity. */
  river: number;
  /** 0 inside the flat airport zone, 1 outside its blend band. */
  airportBlend: number;
  /** Horizontal distance to the river centreline, m (Infinity when far). */
  riverDist: number;
  /** riverDist signed by bank (+ right of the flow, - left): linear across the channel. 0 when far. */
  riverSigned: number;
  /** River half-width at the nearest centreline point, m; fades to 0 upstream of the source (0 when far). */
  riverHalfWidth: number;
  /** Arc length of the nearest centreline point from the source, m (0 when far). */
  riverArc: number;
  /** 1 in the obstacle-clear inner part of an approach corridor (no trees), 0 outside. */
  approach: number;
}

export function makeSample(): TerrainSample {
  return { ground: 0, standing: SEA_LEVEL, river: -Infinity, airportBlend: 1, riverDist: Infinity, riverSigned: 0, riverHalfWidth: 0, riverArc: 0, approach: 0 };
}

const riverHit: RiverHit = { dist: Infinity, level: 0, halfWidth: 0, s: 0, side: 0, beyondSource: 0, bedFrame: true };
const valleyHit: ValleyHit = { dist: Infinity, level: 0, floodplain: 0 };
const oxbowHit: OxbowHit = { dist: Infinity, level: 0, halfWidth: 0, depth: 0 };

/** A stream's banks are smooth (no small-scale relief) this far beyond them, fading back in by the second, m. */
const STREAM_SMOOTH = [15, 50];
/** Most the ground along a stream is built up over the natural ground (its smooth course, its banks), m. */
const STREAM_FILL = 5;
/** Height of the floodplain at the river's banks above its water level, m. */
const BANK_HEIGHT = 1.3;

/**
 * Cross-section of the river valley about its axis: height above the river's water level at distance d. The flat
 * floodplain (the meander belt) rises a little toward its edges, then the valley walls steepen with distance.
 */
function valleyProfile(d: number, floodplain: number): number {
  if (d < floodplain) return BANK_HEIGHT + 1.2 * smooth(0.5 * floodplain, floodplain, d);
  const b = d - floodplain;
  return BANK_HEIGHT + 1.2 + 0.012 * b + 0.00011 * b * b;
}

/** Cross-section of the channel cut into the floodplain: height above its water level at distance d (rising steeply beyond the bank). */
function channelProfile(d: number, halfWidth: number): number {
  if (d < halfWidth) {
    const t = d / halfWidth;
    return -(2.2 + halfWidth * 0.05) * (1 - t * t);
  }
  const b = d - halfWidth;
  if (b < CHANNEL_BANK) return BANK_HEIGHT * smooth(0, CHANNEL_BANK, b);
  return BANK_HEIGHT + 0.05 * (b - CHANNEL_BANK) * (b - CHANNEL_BANK);
}


/** The low strip of a stream's banks beyond its water: out to its bed's edge, at least STREAM_BANK_MIN m. */
const STREAM_BANK_MIN = 0.6;
const streamBankWidth = (halfWidth: number, bed: number): number => Math.max(STREAM_BANK_MIN, bed - halfWidth);
/** A stream's broad breach (streams.ts BREACH_*): its floor BREACH_FLOOR over the water, rising BREACH_RISE across to
 * its edge at `breach` m, walls at BREACH_WALL beyond. */
const BREACH_FLOOR = 0.6;
const BREACH_RISE = 1.2;
function breachProfile(d: number, breach: number): number {
  if (d < breach) return BREACH_FLOOR + BREACH_RISE * (d / breach) * (d / breach);
  return BREACH_FLOOR + BREACH_RISE + breachWall(d - breach);
}
/**
 * A breach's carve target where the ground about it stands as the threshold hillslopes' walls (weight w, lastWall):
 * the walls only lowered by the breach's cut, tapering out by the start of its fade (0.8 of its reach). Its own walls
 * (breachWall, at most 45 degrees) climb out of a cut through a rim on level ground; against a 36 degree slope they
 * never meet it within the reach, and the fade there left a step tens of metres high.
 */
function breachLift(target: number, h: number, d: number, reach: number, cut: number, w: number): number {
  if (!(w > 0)) return target;
  const r = 1 - Math.min(1, d / (0.8 * reach));
  const tw = h - cut * r * r;
  return tw > target ? target + w * (tw - target) : target;
}

/** The meandering river: its valley, oxbow lakes and channel cut into the terrain height h; fills out's river fields. */
function carveRiver(north: number, east: number, h: number, out: TerrainSample): number {
  // River valley: the natural terrain is cut down to the floodplain and valley walls about the valley axis.
  presentHydro.queryValley(north, east, valleyHit);
  if (valleyHit.dist < valleyHit.floodplain + RIVER_INFLUENCE) {
    const d = valleyHit.dist;
    const f = valleyHit.floodplain;
    const carved = smin(h, valleyHit.level + valleyProfile(d, f), 4);
    h += (carved - h) * (1 - smooth(f + RIVER_INFLUENCE * 0.75, f + RIVER_INFLUENCE, d));
  }

  // Oxbow lakes: still water in the abandoned loops, a little above the river and below the floodplain.
  presentHydro.queryOxbow(north, east, oxbowHit);
  if (oxbowHit.dist < oxbowHit.halfWidth + 30) {
    const d = oxbowHit.dist;
    const w = oxbowHit.halfWidth;
    const bank = BANK_HEIGHT - 0.6;
    const target = d < w ? oxbowHit.level - oxbowHit.depth * (1 - (d / w) * (d / w)) : oxbowHit.level + bank * smooth(0, 20, d - w) + 0.05 * Math.max(0, d - w - 20) ** 2;
    h = smin(h, target, 1.5);
    if (d < w && h < oxbowHit.level) out.standing = Math.max(out.standing, oxbowHit.level);
  }

  // River channel: cut into the floodplain along the meandering centreline.
  presentHydro.queryRiver(north, east, riverHit);
  out.riverDist = riverHit.dist;
  if (riverHit.side !== 0) {
    out.riverSigned = riverHit.dist * riverHit.side;
    out.riverHalfWidth = riverHit.halfWidth * (1 - smooth(0, 60, riverHit.beyondSource));
    out.riverArc = riverHit.s;
  }
  if (riverHit.side !== 0 && riverHit.dist < riverHit.halfWidth + CHANNEL_BANK + 40) {
    const d = riverHit.dist;
    const w = riverHit.halfWidth;
    const target = riverHit.level + channelProfile(d, w);
    let carved = smin(h, target, 3);
    // The smooth minimum dips below both inputs; keep the immediate banks dry (a low natural levee where
    // the plain beside the river lies below its water level). Not at the mouth, where the river meets the sea.
    if (d > w && d < w + 40 && riverHit.level > 0.5) {
      const levee = riverHit.level + 0.3 + 0.03 * (d - w);
      carved += (Math.max(carved, levee) - carved) * (1 - smooth(w + 25, w + 40, d));
    }
    h = carved;
    if (d < w && h < riverHit.level) out.river = riverHit.level;
  }
  return h;
}

/** The threshold hillslopes' wall weight at the point sampleTerrain is working on (lastWall). */
let lastWallAt = 0;
/** Smallest warped lake radius at the point sampleTerrain is working on (< 1 under a lake's water). */
let lakeCover = Infinity;
/** The seeded world's lake over the sample point (LakeMask): its level (-Infinity: none) and edge field. */
let maskLevel = -Infinity;
let maskField = 0;
/** FIELD_RAISE: how much an airfield's blend into its flat will raise the ground at the point sampleTerrain is working on
 * (after the carve), m: a stream's banks are built up over its water (carveNetwork) only by what the blend leaves to do. */
let blendLift = 0;
const valleyNear: ValleyNear[] = [];
const channelNear: ChannelNear[] = [];

/** A seeded world's river network (riverNetwork.ts): every valley and channel near the point cut into h, as carveRiver cuts its one river. */
function carveNetwork(north: number, east: number, h: number, out: TerrainSample): number {
  const net = presentHydro.network as NonNullable<Hydrology['network']>;
  const wallHere = lastWallAt;
  // Along a stream (streams.ts) the ground is its smooth course, without the small-scale relief's knobs and ledges:
  // the stream's water follows that ground down (it took them away), fading back in by STREAM_SMOOTH beyond its bank.
  const nc0 = net.channels(north, east, channelNear);
  let calmS = 0;
  for (let j = 0; j < nc0; j++) {
    const c = channelNear[j];
    calmS = Math.max(calmS, 1 - smooth(c.bed + STREAM_SMOOTH[0], c.bed + STREAM_SMOOTH[1], c.dist));
  }
  // (Never more than STREAM_FILL over the natural ground: a dip deeper than that beside a stream stays a dip.)
  // Not in a lake's domain: its bed and shore keep their ground (a stream's smoothing or banks there would raise a
  // causeway through the water at an outlet).
  const hNatural = h;
  const dryS = maskLevel === -Infinity;
  if (calmS > 0 && dryS) h = Math.min(h - lastSmall * calmS, hNatural + STREAM_FILL);
  const nv = net.valleys(north, east, valleyNear);
  // Beside a lake a valley keeps its ground over the lake's water (drainage.ts LakeMask.holds: the domain and a raster
  // point round it), or the water would stand against nothing at the domain's edge.
  const mask = presentHydro.lakeMask;
  const hold = nv > 0 && mask ? mask.holds(north, east) : 0;
  const holdLevel = hold > 0 && mask ? mask.holdLevel : -Infinity;
  for (let j = 0; j < nv; j++) {
    const v = valleyNear[j];
    const d = v.dist;
    const f = v.floodplain;
    // Where the ground stands far above the valley's walls at the edge of its reach (a river through mountains), the
    // walls climb to it across the reach - a gorge - instead of the blend below raising a sheer wall at the edge.
    const I = v.influence;
    const excess = Math.max(0, h - v.level - valleyProfile(f + I, f));
    const t = clamp((d - f) / I, 0, 1);
    // (Where the ground stands as the threshold hillslopes' walls, they are only lowered: wallLift.)
    let carved = smin(h, wallLift(v.level + valleyProfile(d, f) + excess * t * t, h, (d - f) / I, I, v.gap, wallHere, wallStart(f, I, v.swing)), 4);
    if (hold > 0) carved += hold * Math.max(0, Math.min(h, holdLevel + 0.5) - carved);
    h += (carved - h) * (1 - smooth(f + I * 0.75, f + I, d));
  }
  // The rivers' floors, as their water shaped them (riverNetwork.ts floorSet): not in a lake's domain, nor beside a
  // lake under the ground the lake's water needs (as the valleys keep it, LakeMask.holds).
  if (nv > 0 && dryS) {
    const hv = h;
    h = floorSet(h, valleyNear, nv, hNatural);
    if (hold > 0) h += hold * Math.max(0, Math.min(hv, holdLevel + 0.5) - h);
  }

  // Oxbow lakes, as carveRiver cuts them (not under a lake's water).
  presentHydro.queryOxbow(north, east, oxbowHit);
  if (oxbowHit.dist < oxbowHit.halfWidth + 30 && lakeCover >= 1 && h > maskLevel + 2) {
    const d = oxbowHit.dist;
    const w = oxbowHit.halfWidth;
    const bank = BANK_HEIGHT - 0.6;
    const target = d < w ? oxbowHit.level - oxbowHit.depth * (1 - (d / w) * (d / w)) : oxbowHit.level + bank * smooth(0, 20, d - w) + 0.05 * Math.max(0, d - w - 20) ** 2;
    h = smin(h, target, 1.5);
    if (d < w && h < oxbowHit.level) out.standing = Math.max(out.standing, oxbowHit.level);
  }

  presentHydro.queryRiver(north, east, riverHit);
  out.riverDist = riverHit.dist;
  if (riverHit.side !== 0) {
    // (Measured from the middle of the bed, which is wider than the water and lies to one side of it: channelForm.ts.)
    out.riverSigned = riverHit.dist * riverHit.side - (riverHit.bedShift ?? 0);
    out.riverDist = Math.abs(out.riverSigned);
    out.riverHalfWidth = (riverHit.bed ?? riverHit.halfWidth) * (1 - smooth(0, 6 * (riverHit.bed ?? riverHit.halfWidth), riverHit.beyondSource));
    out.riverArc = riverHit.s;
  }
  // Under a lake its water covers the river: no channel cut across the lake bed (it would show as a dark line).
  let open = smooth(0.8, 1.0, lakeCover);
  // A seeded world's lake (LakeMask): no channel where its water covers the ground, but one across dry ground inside
  // its edge (the river joining two arms), and none faded in toward the edge.
  if (maskLevel > -Infinity) open = Math.min(open, Math.max(smooth(maskLevel - 0.5, maskLevel + 1.5, h), 1 - smooth(0, 10, maskField)));
  const nc = open > 0 ? nc0 : 0;
  // The highest water whose banks the point lies within (and the line it is), and the highest of the other lines'
  // (a stream's carving keeps the ground over another channel's water there).
  let keep1 = -Infinity;
  let keep2 = -Infinity;
  let keepLine = -1;
  // (And the lines whose water covers the point: no line's bank or levee is raised over another line's water - two
  // rivers running side by side into their junction, 30-45 m apart, the one's levee stood up to 2 m over the other's
  // water, hiding it, about 20 km of river on each seed.)
  let wetLine = -1;
  let wet2 = false;
  for (let q = 0; q < nc; q++) {
    const o = channelNear[q];
    if (o.dist < (o.wet !== undefined ? o.wet : o.halfWidth)) {
      if (wetLine >= 0 && wetLine !== o.line) wet2 = true;
      else wetLine = o.line;
    }
    if (!(o.dist < (o.wet !== undefined ? o.bed : o.halfWidth) + CHANNEL_BANK + 20)) continue;
    const v = o.level + BANK_HEIGHT;
    if (v > keep1) {
      keep2 = keep1;
      keep1 = v;
      keepLine = o.line;
    } else if (v > keep2) keep2 = v;
  }
  for (let j = 0; j < nc; j++) {
    const c = channelNear[j];
    const d = c.dist;
    const wetOther = wet2 || (wetLine >= 0 && wetLine !== c.line);
    // Every line alike (channelForm.ts formSection): its broad breach first (a rim or sill worn down), then its own wet
    // bed, the bar out to its bed's edge and its bank, faded in from its source over three of its bed's widths. Neither
    // takes the ground under another channel's water within that channel's banks (a stream running down beside a river
    // held up on its valley floor would leave the river's water standing over a hollow), nor beside a lake standing
    // higher (its domain and a raster point round it, LakeMask.holds).
    let keep = keepLine === c.line ? keep2 : keep1;
    if (c.breach > 0 && mask && mask.holds(north, east) > 0) keep = Math.max(keep, mask.holdLevel + 0.5);
    // (Faded out over the last fifth of its reach, where its walls should long since have met the ground.)
    if (c.breach > 0) h += (Math.max(Math.min(h, keep), smin(h, breachLift(c.level + breachProfile(d, c.breach), h, d, c.reach, c.cut, wallHere), 3)) - h) * open * (1 - smooth(0.8 * c.reach, c.reach, d));
    const fade = 1 - smooth(0, 6 * c.bed, c.beyondSource);
    const wet = (c.wet ?? c.halfWidth) * fade;
    if (wet <= 0.2) continue;
    const bed = Math.max(wet, c.bed * fade);
    const banks = smin(h, c.level + formSection(d, wet, bed, c.depth ?? 1, c.bankH ?? 1, c.bankTan ?? 0.5, h - c.level), Math.min(3, 0.5 + 0.3 * wet));
    h += ((d > wet ? Math.max(Math.min(h, keep), banks) : banks) - h) * open;
    // Its banks hold its water: where the ground beside it lies under the water (a hillside it crosses, a dip between
    // the points it was traced on) a low bank is built up, at most STREAM_FILL (not in another channel's water, nor at
    // a mouth on the sea; less what an airfield's blend will raise it by: FIELD_RAISE).
    if (d > wet && !wetOther && out.river === -Infinity && c.level > 0.5 && dryS) {
      // (Its bed flat at the bank's foot, rising from its edge: from the water's edge, a gravel bed hundreds of metres wide
      // rose 3 % across its bars, metres over its water at its edge - its threads trenches in a raised floor.)
      const need = Math.min(c.level + 0.3 + 0.03 * Math.max(0, d - bed), hNatural + STREAM_FILL) - h - blendLift;
      if (need > 0) h += need * (1 - smooth(bed + STREAM_SMOOTH[0] + 15, bed + STREAM_SMOOTH[1], d)) * open;
    }
    if (d < wet && h < c.level && open >= 1) out.river = Math.max(out.river, c.level);
    // A braided bed's other threads (channelForm.ts braidAt, read in the bed's frame as the ribbon reads them: water.ts
    // FLOW_BARS): the ground under each cut under the line's water, a trough of the thread's own depth - what the ribbon
    // draws wet is wet where the sim asks (landing, ditching), and its water shows over the bars close in.
    if (c.braidK !== undefined && c.braidK > 1 && c.braidHb! > 1) {
      // (Its bars wherever its ribbon draws its bed - which reaches past the bed its nearest point gives where the main
      // thread wanders it: ground left standing there over the lifted ribbon showed as blocky tongues of grass.)
      const top = Math.max(BRAID_BAR_LOW, 0.6 * (c.bankH ?? 1));
      h += (Math.min(h, c.level + BRAID_BAR_LOW + (top - BRAID_BAR_LOW) * Math.min(1, Math.abs(c.braidU!))) - h) * open;
      const inside = braidAt(c.braidU!, c.braidUm!, c.braidHb!, c.braidK, c.braidPh!, c.braidPs!, c.braidW!);
      if (inside > 0) {
        const half = braidHit.half;
        const q = 1 - inside / half;
        h += (Math.min(h, c.level - threadDepth(2 * half, 0) * (1 - q * q)) - h) * open;
        if (h < c.level && open >= 1) out.river = Math.max(out.river, c.level);
      }
    }
  }
  return h;
}

/** A braided bed's bars stand this far over its water at its middle, m, rising to its bank's 0.6 at its edges. */
const BRAID_BAR_LOW = 0.1;
/** FIELD_CHANNEL: a stream's banks cut again through an airfield's blend rise at this slope (keepChannels). */
const FIELD_BANK_SLOPE = 0.35;
/** ... cutting the ground down to it fully this far beyond its low strip, the cut fading out over twice as far
 * (keepChannels), m. */
const FIELD_BANK_WIDTH = 8;
/** ... and keeps the ground over another stream's water this far beyond it (keepChannels), m. */
const FIELD_KEEP = 6;
/**
 * A stream's banks as cut again through an airfield's blend (keepChannels): its bed and low strip as streamBanks, then
 * an earth bank rising at FIELD_BANK_SLOPE - no rock walls, ledges or buttresses, which are a gorge's. (streamBanks'
 * walls cut into the blended ground, a mown field, showed as a row of pale scallops along seed 777777 line 720's far
 * bank by KPMH, and as a V gully 30 m across at 734 under KHLT's approach.)
 */
function fieldBanks(d: number, halfWidth: number, bed: number): number {
  if (d < halfWidth) {
    const t = d / halfWidth;
    return -(0.5 + 0.2 * halfWidth) * (1 - t * t);
  }
  const b = d - halfWidth;
  const bank = streamBankWidth(halfWidth, bed);
  if (b < bank) return 0.5 * smooth(0, bank, b);
  return 0.5 + FIELD_BANK_SLOPE * (b - bank);
}

/**
 * FIELD_CHANNEL: every line's channel, river or stream, cut again into ground h an airfield's blend into its flat (weight k
 * towards its elevation E) has pulled towards the field's elevation: carveNetwork's bed, then earth banks (fieldBanks).
 * The blend's raised banks stand over the water (fieldUnder held it under them, fieldOver raised it under them);
 * without this the blended bed did too, and the stream vanished under it. By how far the blend moved the ground at the
 * stream's water ((1 - k) |E - level|, smooth along the stream): none where it leaves it, all of it from a metre. Not in
 * a lake's domain.
 */
function keepChannels(north: number, east: number, h: number, k: number, E: number, out: TerrainSample): number {
  if (!(k < 1) || maskLevel > -Infinity) return h;
  const net = presentHydro.network as NonNullable<Hydrology['network']>;
  const nc = net.channels(north, east, channelNear);
  let keep1 = -Infinity;
  let keep2 = -Infinity;
  let keepLine = -1;
  // (Its cut keeps the ground over another channel's water only on that channel's own banks, FIELD_KEEP m beyond its
  // water: with earth banks either side the ground between two streams stands over both. carveNetwork's reach, CHANNEL_BANK
  // + 20 m, held the ground over a stream the raise left lower - 1727 beside 734 under KHLT - to the other's water, a
  // wall at its edge.)
  for (let q = 0; q < nc; q++) {
    const o = channelNear[q];
    if (!(o.dist < (o.wet ?? o.halfWidth) + FIELD_KEEP)) continue;
    const v = o.level + BANK_HEIGHT;
    if (v > keep1) {
      keep2 = keep1;
      keep1 = v;
      keepLine = o.line;
    } else if (v > keep2) keep2 = v;
  }
  let cut = h;
  let w = 0;
  for (let j = 0; j < nc; j++) {
    const c = channelNear[j];
    const d = c.dist;
    const hw = (c.wet ?? c.halfWidth) * (1 - smooth(0, 6 * c.bed, c.beyondSource));
    if (hw <= 0.2) continue;
    const keep = keepLine === c.line ? keep2 : keep1;
    const kb = 0.5 + 0.3 * hw;
    if (d < hw || c.level + 0.3 * (d - hw - streamBankWidth(hw, c.bed)) - 4 < cut + kb) {
      // (The cut fades out beyond FIELD_BANK_WIDTH, meeting the ground as it slopes away: carried on at 0.35 it cut a
      // hillside 75 m off 720's SE reach, and along a winding course - the nearest segment's level changing from one
      // segment to the next - as a row of teeth.)
      const fade = 1 - smooth(FIELD_BANK_WIDTH, 3 * FIELD_BANK_WIDTH, d - hw - streamBankWidth(hw, c.bed));
      if (!(fade > 0)) continue;
      const banks = cut + (smin(cut, c.level + fieldBanks(d, hw, c.bed), kb) - cut) * fade;
      cut = d > hw ? Math.max(Math.min(cut, keep), banks) : banks;
      w = Math.max(w, smooth(0.1, 1, (1 - k) * Math.abs(E - c.level)));
    }
  }
  h += (Math.min(cut, h) - h) * w;
  for (let j = 0; j < nc; j++) {
    const c = channelNear[j];
    if (c.dist < (c.wet ?? c.halfWidth) && h < c.level) out.river = Math.max(out.river, c.level);
  }
  return h;
}

/** Cross-section of the Late Cretaceous river's valley, carved about the channel: height above its water level at d. */
function legacyRiverProfile(d: number, halfWidth: number): number {
  if (d < halfWidth) {
    const t = d / halfWidth;
    return -(2.2 + halfWidth * 0.05) * (1 - t * t);
  }
  const b = d - halfWidth;
  if (b < 25) return 1.3 * smooth(0, 25, b);
  // Floodplain, then valley walls steepening with distance.
  return 1.3 + 0.012 * (b - 25) + 0.00011 * (b - 25) * (b - 25);
}

/** The Late Cretaceous river (buildLegacyHydrology): the natural terrain cut down to its valley about the channel. */
function carveLegacyRiver(north: number, east: number, h: number, out: TerrainSample): number {
  legacyHydro.queryRiver(north, east, riverHit);
  out.riverDist = riverHit.dist;
  if (riverHit.side !== 0) {
    out.riverSigned = riverHit.dist * riverHit.side;
    out.riverHalfWidth = riverHit.halfWidth * (1 - smooth(0, 60, riverHit.beyondSource));
    out.riverArc = riverHit.s;
  }
  if (riverHit.dist < RIVER_INFLUENCE) {
    const d = riverHit.dist;
    const w = riverHit.halfWidth;
    const target = riverHit.level + legacyRiverProfile(d, w);
    let carved = smin(h, target, 4);
    // The smooth minimum dips below both inputs; keep the immediate banks dry (a low natural levee where
    // the plain beside the river lies below its water level). Not at the mouth, where the river meets the sea.
    if (d > w && d < w + 40 && riverHit.level > 0.5) {
      const levee = riverHit.level + 0.3 + 0.03 * (d - w);
      carved += (Math.max(carved, levee) - carved) * (1 - smooth(w + 25, w + 40, d));
    }
    h += (carved - h) * (1 - smooth(RIVER_INFLUENCE * 0.75, RIVER_INFLUENCE, d));
    if (d < w && h < riverHit.level) out.river = riverHit.level;
  }
  return h;
}

/**
 * Sample everything the terrain knows at a point. Writes into `out` (no allocation) and returns it.
 */
export function sampleTerrain(north: number, east: number, out: TerrainSample): TerrainSample {
  // Airport: exactly flat within flatMargin of the runway rectangle.
  const dn = north - RW.center.north;
  const de = east - RW.center.east;
  const along = dn * RW_COS + de * RW_SIN;
  const across = -dn * RW_SIN + de * RW_COS;
  const ox = Math.max(Math.abs(along) - HALF_LEN, 0);
  const oy = Math.max(Math.abs(across) - HALF_WID, 0);
  const dRect = Math.sqrt(ox * ox + oy * oy);
  out.standing = SEA_LEVEL;
  out.river = -Infinity;
  out.riverDist = Infinity;
  out.riverSigned = 0;
  out.riverHalfWidth = 0;
  out.riverArc = 0;
  out.approach = 0;
  if (dRect <= FLAT) {
    out.ground = ELEV;
    out.airportBlend = 0;
    return out;
  }
  // A generated airfield within reach (present day; they are spaced so at most one is): its runway coordinates.
  let gf: Airfield | null = null;
  let gAlong = 0;
  let gAcross = 0;
  let gRect = Infinity;
  if (fields.length && isPresent()) {
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const fn = north - f.north;
      const fe = east - f.east;
      const reach = f.length / 2 + f.approachLength + f.blend;
      if (fn * fn + fe * fe > reach * reach) continue;
      const c = Math.cos(f.heading);
      const sn = Math.sin(f.heading);
      gAlong = fn * c + fe * sn;
      gAcross = -fn * sn + fe * c;
      const fx = Math.max(Math.abs(gAlong) - f.length / 2, 0);
      const fy = Math.max(Math.abs(gAcross) - f.width / 2, 0);
      gRect = Math.sqrt(fx * fx + fy * fy);
      gf = f;
      break;
    }
    if (gf && gRect <= gf.flatMargin) {
      out.ground = gf.elevation;
      out.airportBlend = 0;
      return out;
    }
  }

  let h = naturalHeight(north, east);
  lastWallAt = SEEDED ? lastWall : 0;

  // Lakes: bed = natural terrain lowered toward (level - depth) inside the warped ellipse.
  lakeCover = Infinity;
  for (let i = 0; i < lakes.length; i++) {
    const lake = lakes[i];
    const ln = north - lake.north;
    const le = east - lake.east;
    if (ln * ln + le * le > lake.bound * lake.bound) continue;
    const r = lakeRadius(lake, north, east);
    if (r < lakeCover) lakeCover = r;
    if (r < LAKE_ZONE) {
      // Wide, gentle bowl: the shore slopes in rather than being cut into the hillside.
      const bowl = 1 - smoother(0.3, 1.1, r);
      h += (lake.level - lake.depth - h) * bowl;
      out.standing = Math.max(out.standing, lake.level);
    }
  }

  maskLevel = -Infinity;
  const mask = presentHydro.lakeMask;
  if (mask) {
    maskLevel = mask.at(north, east, h);
    maskField = mask.field;
    if (maskLevel > -Infinity) out.standing = Math.max(out.standing, maskLevel);
  }

  // A seeded world's ground is trimmed under the airfields' approaches (FIELD_FIRST) before its network carves it, not
  // after: its streams' water is held under that trimmed ground (holdUnder), each in its own channel cut into it.
  // (Trimmed after the carve, a stream's bed and banks were lowered again under water levelled on the trimmed ground:
  // seed 777777 line 720 stood up to 24 m over both banks in an approach.) The blends into the flats stay after the
  // carve, which may cut far below a field's elevation by it (a valley's walls).
  const trimFirst = FIELD_FIRST && !!presentHydro.network;
  if (trimFirst) h = approachTrim(h, along, across, gf, gAlong, gAcross);
  // (FIELD_RAISE: what the blends into the flats will raise the ground by here, a stream's banks built up the less.)
  blendLift = 0;
  if (FIELD_RAISE && trimFirst) {
    if (gf && gf.elevation > h) blendLift = (1 - smoother(gf.flatMargin, gf.flatMargin + gf.blend, gRect)) * (gf.elevation - h);
    if (ELEV > h) blendLift = Math.max(blendLift, (1 - smoother(FLAT, FLAT + BLEND, dRect)) * (ELEV - h));
  }

  h = presentHydro.network ? carveNetwork(north, east, h, out) : isPresent() ? carveRiver(north, east, h, out) : carveLegacyRiver(north, east, h, out);

  // Approach corridors: keep terrain under a gradient well below the 3 degree glide path from both ends.
  const beyond = Math.abs(along) - HALF_LEN;
  if (beyond > 0 && beyond < APPROACH_LENGTH) {
    const halfW = 300 + 0.12 * beyond;
    const w = (1 - smooth(halfW, halfW * 1.8, Math.abs(across))) * (1 - smooth(APPROACH_LENGTH * 0.85, APPROACH_LENGTH, beyond));
    // Obstacle-clear zone (no trees) for the first few kilometres of each approach.
    out.approach = w * (1 - smooth(1500, 3000, beyond));
    if (w > 0 && !trimFirst) {
      const excess = h - (ELEV + APPROACH_GRADIENT * beyond);
      // Smooth max(excess, 0) over a 20 m band so the trimmed surface has no crease.
      h -= w * 0.5 * (excess + Math.sqrt(excess * excess + 400));
    }
  }

  // A generated field: its approaches kept low and clear the same way (shorter and narrower), then its flat area.
  let gBlend = 1;
  if (gf) {
    const gBeyond = Math.abs(gAlong) - gf.length / 2;
    if (gBeyond > 0 && gBeyond < gf.approachLength) {
      const halfW = 150 + 0.12 * gBeyond;
      const w = (1 - smooth(halfW, halfW * 1.8, Math.abs(gAcross))) * (1 - smooth(gf.approachLength * 0.85, gf.approachLength, gBeyond));
      out.approach = Math.max(out.approach, w * (1 - smooth(800, 1600, gBeyond)));
      if (w > 0 && !trimFirst) {
        const excess = h - (gf.elevation + APPROACH_GRADIENT * gBeyond);
        h -= w * 0.5 * (excess + Math.sqrt(excess * excess + 400));
      }
    }
    gBlend = smoother(gf.flatMargin, gf.flatMargin + gf.blend, gRect);
    h = gf.elevation + (h - gf.elevation) * gBlend;
  }

  // Blend into the flat airfield.
  const blend = smoother(FLAT, FLAT + BLEND, dRect);
  out.airportBlend = Math.min(blend, gBlend);
  out.ground = ELEV + (h - ELEV) * blend;
  // (A seeded world's streams keep their channels through the blends, where the blends moved the ground as carved:
  // FIELD_CHANNEL.)
  if (FIELD_CHANNEL && presentHydro.network && out.airportBlend < 1) out.ground = gf && gBlend < blend ? keepChannels(north, east, out.ground, gBlend, gf.elevation, out) : keepChannels(north, east, out.ground, blend, ELEV, out);
  return out;
}

const scratch = makeSample();

/** Surface elevation MSL, m: the ground, or the water surface where water covers it. */
export function terrainHeight(north: number, east: number): number {
  const s = sampleTerrain(north, east, scratch);
  return Math.max(s.ground, s.standing, s.river);
}

/** Unit surface normal in NED (points up, z < 0), from central differences over 1 m. */
export function terrainNormal(north: number, east: number): Vec3 {
  const e = 1;
  const hn = terrainHeight(north + e, east) - terrainHeight(north - e, east);
  const he = terrainHeight(north, east + e) - terrainHeight(north, east - e);
  // Surface z = -h(n, e); normal = (dh/dn, dh/de, -1) normalised (up is -z).
  const nx = hn / (2 * e);
  const ny = he / (2 * e);
  const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
  return { x: nx * inv, y: ny * inv, z: -inv };
}

/** Snow line elevation at a point, m; varies with position so the snow edge is irregular. */
export function snowLine(north: number, east: number): number {
  if (isPresent()) {
    return 2500 + snowShift + seededSnow() + 180 * fbm(east / 3000 + 5.5, north / 3000 - 1.1, 3);
  }
  return snowLineBase() + 180 * fbm(east / 3000 + 5.5, north / 3000 - 1.1, 3);
}

/** Level of the snow line before its noise, m: 2500 plus the era's offset (the shader's threshold, its GLSL twin). */
export function snowLineBase(): number {
  return 2500 + era().terrain.snowLineOffset + snowShift + seededSnow();
}

/**
 * A seeded world's snow line against seed 0's, m (0 at seed 0). The macro model over the wide orogen (erosion.ts
 * STEADY) puts the highest summits at about 2300-2900 m, the bulk of the ranges' crests at 1800-2300 m: with the line
 * here only the highest summits and ridges carry snow (out/f2/REPORT.md).
 */
const SEEDED_SNOW = -100;
const seededSnow = (): number => (SEEDED ? SEEDED_SNOW : 0);

/** Debug shift of the snow line, m (URL snowShift=; 0, the default, leaves every value as it was). */
let snowShift = 0;
/** Set the debug snow-line shift (before the terrain and its materials are built; the workers get it in their setup). */
export function setSnowShift(m: number): void {
  snowShift = Number.isFinite(m) ? m : 0;
}
export const snowShiftM = (): number => snowShift;

/**
 * Surface material for tyre friction and crash logic. Never 'runway'/'taxiway' (the airport layers those).
 * Slope is from the local normal; the thresholds are the mid-points of the terrain shader's blends
 * (without its noise), so what the pilot sees is what the wheels feel.
 */
export function terrainSurface(north: number, east: number): SurfaceType {
  const s = sampleTerrain(north, east, scratch);
  if (s.ground < Math.max(s.standing, s.river)) {
    // Water above the snow line is a sheet of ice under snow (water.ts 'ice': the sheet's midpoint lies 50 m under
    // the line for a lake, in the hollow of its basin, and 25 m over it for a river), and takes a landing like snow.
    const line = snowLine(north, east);
    return s.standing >= s.river ? (s.standing > line - 50 ? 'snow' : 'water') : s.river > line + 25 ? 'snow' : 'water';
  }
  if (s.airportBlend === 0) return isPresent() ? 'grass' : era().world.flatSurface;
  const h = s.ground;
  const standing = s.standing;
  const nrm = terrainNormal(north, east);
  const up = -nrm.z;
  // Steep faces (steeper than ~43 degrees) are bare rock.
  if (up < 0.73) return 'rock';
  // Lower on north faces, as the shader draws it (SNOW_ASPECT in terrainMaterial.ts).
  const sl = snowLine(north, east) - 260 * nrm.x;
  // Snow above the snow line where it can lie; rock on the steeper ground around it.
  if (h > sl + 40 && up > 0.67) return 'snow';
  if (h > sl - 25 && up < 0.885) return 'rock';
  // Beaches.
  if (standing === SEA_LEVEL && h < SEA_LEVEL + 2.5) return 'dirt';
  return 'grass';
}
