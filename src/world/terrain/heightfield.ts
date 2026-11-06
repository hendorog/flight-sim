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

import { onWorldSeed, worldSeed } from '../worldSeed';
import { macroAt, setLayoutGround, type Macro } from './seededLayout';
import { clamp, type Vec3 } from '../../core/math';
import type { SurfaceType } from '../../core/types';
import { AIRPORT, onHomeAirport } from '../../core/world';
import { breachWall } from './streams';
import { CHANNEL_BANK, LAKE_ZONE, RIVER_INFLUENCE, buildHydrology, buildLakes, buildLegacyHydrology, lakeRadius, type ChannelNear, type Hydrology, type Lake, type OxbowHit, type RiverHit, type ValleyHit, type ValleyNear } from './hydrology';
import { buildDrainage, DOMAIN_HALF, DRAIN_CELL, LakeMask, ShoreSmooth } from './drainage';
import { buildErosion, erosionCutAt, erosionCutGrad, erosionGullies, sampleErosion, sampleErosionGrad, type ErosionField, type ErosionGrad, type ErosionSample } from './erosion';
import { buildNetworkHydrology } from './riverNetwork';
import { fbm, gnoise, gullies, type Deriv } from './noise';
import { era, isPresent } from '../era/eraState';
import { volcanoBound, volcanoHeight, volcanoMerge } from './volcano';
import { setGeneratedAirfields, type Airfield } from '../airfields';
import { siteAirfields } from './airfieldSiting';

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
function mountainShape(east: number, north: number, out: Shape): void {
  let x = east / 9000 + 3.7;
  let y = north / 9000 - 1.2;
  let freq = 1 / 9000;
  let amp = 0.55;
  let v = 0;
  let gx = 0;
  let gy = 0;
  for (let o = 0; o < 5; o++) {
    const n = gnoise(x, y, D);
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
function hillShape(east: number, north: number, out: Shape): void {
  let x = east / 7000 - 2.1;
  let y = north / 7000 + 6.4;
  let freq = 1 / 7000;
  let amp = 0.6;
  let v = 0;
  let gx = 0;
  let gy = 0;
  for (let o = 0; o < 4; o++) {
    v += amp * gnoise(x, y, D);
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
 * `cap` (a seeded world's, seededNaturalHeight) bounds the strength from above, softly; seed 0 passes none.
 */
function erode(east: number, north: number, slopeE: number, slopeN: number, octaves = GULLY_OCTAVES, cap = Infinity): number {
  gullyFine = 0;
  gullySum = 0;
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
  for (let o = 0; o < octaves; o++) {
    if (o === STREAM_GULLY_OCTAVES) coarseSum = sum;
    const dx = ux + bx * GULLY_BRANCH;
    const dy = uy + by * GULLY_BRANCH;
    const k = GULLY_FREQ / Math.sqrt(dx * dx + dy * dy + 1e-9);
    sum += amp * gullies(x, y, dx * k, dy * k, D);
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
  if (octaves > STREAM_GULLY_OCTAVES) gullyFine = (sum - coarseSum) * strength;
  gullySum = sum;
  return sum * strength;
}
/** erode's last sum of octaves before its strength (about [-1, 1]: low in the troughs, high on the spurs). */
let gullySum = 0;
/** A smooth lower bound of two non-negative numbers: their minimum, rounded off (to 0.84 of it where they are equal). */
function softMin(a: number, b: number): number {
  if (b <= 0 || a <= 0) return 0;
  const a4 = a * a * a * a;
  const b4 = b * b * b * b;
  return (a * b) / Math.sqrt(Math.sqrt(a4 + b4));
}

// A seeded world's gully floors keep falling (the water that cut them has a way out). Down a gully the ground is the
// eroded macro ground B (the coarse terrain with the erosion's cut) plus the gully relief K g, and g (erode's octave
// sum) varies along a trough by at most about 1.45 per cell (gullies(), p99 of its derivative along the stripes, 200k
// samples) as its kernels' weights shift; over the octaves (amplitudes 1/2, 1/4, ... on cells of 1500, 750, ... m) that
// is a rise of at most K 1.45 x 2.5 / 1500 per metre. Holding K under GULLY_FALL |grad B| keeps it under 0.9 of B's
// own fall along the gully, so its floor keeps falling where the octaves do not all rise together; the gullies follow
// B's fall line (with the erosion's valleys, not the uncut ground's), so their troughs run down it.
/** Deepest gully relief per unit of the eroded ground's slope, m: 0.9 x 1500 / (1.45 x 2.5). */
const GULLY_FALL = 372;
/** The small-scale relief by the slope too: its knobs (`rough`, m) at most SMALL_FALL and its ledges (`rugged`) at most
 * RUGGED_FALL times the eroded ground's slope (they would bead a gentle gully floor with hollows), and fading into the
 * gully troughs (erode's sum from FLOOR_FADE[1] down to FLOOR_FADE[0]), where the water runs. */
const SMALL_FALL = 12;
const RUGGED_FALL = 3;
const FLOOR_FADE = [-0.2, 0.4];
/** The gully octaves the streams route over (streams.ts: the finer ones are rills on the slopes, finer than its raster). */
const STREAM_GULLY_OCTAVES = 3;
/** What erode's octaves beyond STREAM_GULLY_OCTAVES added to its last result. */
let gullyFine = 0;

/** Valley floor elevation along the runway axis (along = m toward ENE), m. */
function valleyFloor(along: number): number {
  return along <= 0 ? ELEV + 0.0048 * along : ELEV + 0.0055 * along + 1.2e-7 * along * along;
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
/** How much of its small-scale relief the point seededNaturalHeight is working on keeps (0 over a lake's domain). */
let calm = 1;
/** A seeded world's gullies smoothed round its lakes (drainage.ts), built with its water for that seed only (the
 * home field's site search, before the water, sees none). */
let shoreSmooth: ShoreSmooth | null = null;
let shoreSeed = 0;
/** A seeded world's lakes (drainage.ts LakeMask), whose domains smooth out the small-scale relief, for that seed only. */
let lakeSmooth: LakeMask | null = null;
let lakeSeed = 0;
// The home field's site search (seededLayout.ts, homeSiting.ts) looks at the ground as it will be, eroded ridges and
// all (in the mountains the erosion adds hundreds of metres the approach trimming would otherwise cut into walls).
// It sees the ground before the load-time corrections (the erosion pass, erosion.ts, and the shore smoothing round
// the lakes, drainage.ts), which are worked out for the layout it chooses and faded
// out around the field, so the site stays valid (the pass only lowers the ground).
setLayoutGround((n, e) => seededNaturalHeight(n, e, true, false));

/** The erosion pass (erosion.ts), null in seed 0's world. */
let erosion: ErosionField | null = null;
const erosionAt: ErosionSample = { d: 0, w: 0, t: 0, keep: 1, north: 0, east: 0 };
const erosionGrad: ErosionGrad = { dN: 0, dE: 0, tN: 0, tE: 0 };
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
 * The ground `h` with the erosion pass's interpolated cut applied, C1 in both. The cut never raises the ground: its
 * fine grid holds no point above 0 (erosion.ts), and what the interpolation overshoots between them (centimetres) is
 * dropped. Land stays land: a cut is cushioned (a smooth maximum) a metre or two above the sea, blended in over its
 * first 5 m, so the lowest reaches of a river cut down to sea level do not drown.
 */
function applyCut(h: number, cut: number): number {
  if (cut >= 0) return h;
  const lowered = h + cut;
  const cushioned = -smin(-lowered, -smin(h, 2, 2), 3);
  return lowered + smooth(0, -5, cut) * (cushioned - lowered);
}

/** A seeded world's natural terrain without its small-scale relief (the ledges and knobs under 200 m, and the finest
 * gullies): streams.ts routes its streams down it (they follow the gullies and valleys, not the knobs and rills). */
export const naturalHeightSmooth = (north: number, east: number): number => seededNaturalHeight(north, east, true, true, true, false);

/** The small-scale relief seededNaturalHeight last added (its ledges and knobs), m: carveNetwork takes it away along a
 * stream (streams.ts routes and levels them on the ground without it). */
let lastSmall = 0;

function seededNaturalHeight(north: number, east: number, detail = true, eroded = true, volcano = true, small = true): number {
  lastSmall = 0;
  let fineGully = 0;
  macroAt(north, east, macro);
  calm = 1;
  const inland = macro.inland;
  const base = coastProfile(inland);

  const hillAmp = (90 + 260 * smooth(-1000, 7000, inland) + 480 * macro.foothill) * macro.hilly;
  hillShape(east, north, rolling);
  const bias = 0.55 * smooth(-2000, 5000, inland);
  let relief = hillAmp * (rolling.v + bias);
  let gE = hillAmp * rolling.dx;
  let gN = hillAmp * rolling.dy;
  const uplift = macro.uplift;
  let amplitude = hillAmp;
  if (uplift > 0) {
    mountainShape(east, north, massif);
    const a = uplift * 3100;
    relief += a * massif.v;
    gE += a * massif.dx;
    gN += a * massif.dy;
    amplitude += a;
  }
  // The ground without the gullies, which the erosion's eroded surface replaces where its cut is deep.
  const coarse = base + relief;
  const cut = eroded ? erosion : null;
  if (cut) {
    if (detail) sampleErosionGrad(cut, north, east, erosionAt, erosionGrad);
    else sampleErosion(cut, north, east, erosionAt);
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
    const gullyKeep = (1 - shore) * (cut ? erosionGullies(cut, erosionAt) : 1);
    let lakeW = eroded && lakeSeed === worldSeed() && lakeSmooth ? lakeSmooth.smooth(north, east) : 0;
    if (lakeW > 0) {
      const hc = cut ? applyCut(coarse, erosionCutAt(erosionAt, coarse)) : coarse;
      const reach = 0.13 * amplitude * gullyKeep + 2.2 * (1.2 + 0.004 * clamp(hc, 0, 3000)) + 3.2 + 1;
      lakeW *= 1 - smooth(reach, 1.5 * reach, hc - (lakeSmooth as LakeMask).smoothLevel);
    }
    calm = 1 - lakeW;
    const keep = gullyKeep * calm;
    // The eroded ground's gradient: the coarse terrain's with the cut's (erosion.ts).
    let bE = gE;
    let bN = gN;
    if (cut) {
      erosionCutGrad(erosionAt, erosionGrad, coarse, gE, gN, cutGrad);
      bE += cutGrad.dx;
      bN += cutGrad.dy;
    }
    fall = Math.sqrt(bE * bE + bN * bN);
    gullyW = keep;
    if (keep > 0) {
      const g = erode(east, north, bE, bN, small ? GULLY_OCTAVES : STREAM_GULLY_OCTAVES, (GULLY_FALL * fall) / (0.13 * amplitude + 1e-9));
      relief += amplitude * 0.13 * g * keep;
      fineGully = amplitude * 0.13 * gullyFine * keep;
    }
  }
  let h = base + relief;
  // The rivers' valleys, cut by the erosion pass (erosion.ts), C1-smooth: the gullies stay on the eroded surface.
  if (cut) h = applyCut(h, erosionCutAt(erosionAt, coarse));

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
  const floor = 1 - gullyW * (1 - smooth(FLOOR_FADE[0], FLOOR_FADE[1], gullySum));
  const rough = softMin(calm * floor * (1.2 + 0.004 * clamp(h, 0, 3000)), SMALL_FALL * fall);
  h += rough * (2.2 * gnoise(east / 180 + 0.3, north / 180 + 0.7) + 0.8 * gnoise(east / 60 - 4.1, north / 60 + 2.2));
  const rugged = softMin(calm * floor * clamp(amplitude / 1500, 0, 1) * (0.4 + 0.6 * smooth(0.1, 0.5, Math.sqrt(gE * gE + gN * gN))), RUGGED_FALL * fall);
  if (rugged > 0) {
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
let presentHydro: Hydrology;
let legacyHydro: Hydrology;
// The generated airfields (airfields.ts, present day only), sited against the same natural terrain and water.
let fields: readonly Airfield[] = [];
/** How long the last seeded world's airfield siting took, ms (probes). */
export let siteMs = 0;
function buildWater(): void {
  if (SEEDED) {
    // The erosion pass first (erosion.ts): the rivers cut the macro terrain's valleys and drain most of its closed
    // hollows. Then the drainage, routed over the eroded terrain without its gullies and small-scale relief (finer
    // than the 1 km lattice, and the costly part): the hollows the erosion left are breached or ponded (Lindsay 2016).
    erosion = null;
    shoreSmooth = null;
    lakeSmooth = null;
    const home = AIRPORT.runway.center;
    // Worked out on the ground without the era's volcano, as the cut is applied (the cone merges over it after).
    const eroded = buildErosion((n, e) => seededNaturalHeight(n, e, false, false, false), home);
    erosion = eroded;
    // The eroded cells the drainage routes over (erosion.ts), with the cushion above the sea and the era's volcano.
    const lat = eroded.lattice;
    const V = era().terrain.volcano;
    for (let c = 0; c < lat.length; c++) {
      lat[c] = applyCut(lat[c] - eroded.delta[c], eroded.delta[c]);
      if (!V) continue;
      const north = -DOMAIN_HALF + Math.floor(c / EROSION_N) * DRAIN_CELL;
      const east = -DOMAIN_HALF + (c % EROSION_N) * DRAIN_CELL;
      const b = volcanoBound(V);
      if ((north - V.north) ** 2 + (east - V.east) ** 2 < b * b) lat[c] = volcanoMerge(lat[c], volcanoHeight(north, east, V));
    }
    const drainage = buildDrainage(naturalHeightCoarse, naturalHeight, (ponds) => {
      shoreSmooth = new ShoreSmooth(EROSION_N, -DOMAIN_HALF, ponds, home);
      shoreSeed = worldSeed();
    }, lat);
    // Its lakes are the drainage's ponds, flooded on the detailed ground (LakeMask): the water covers the natural
    // ground below their level, nothing carved; the fitted ellipses only place things by them.
    const mask = new LakeMask(drainage, naturalHeightCoarse);
    lakeSmooth = mask;
    lakeSeed = worldSeed();
    lakes = [];
    presentHydro = buildNetworkHydrology(naturalHeight, drainage, mask, eroded.delta, naturalHeightSmooth, () => lastSmall);
    legacyHydro = presentHydro;
    const tf = performance.now();
    fields = siteAirfields(naturalHeight, presentHydro, presentHydro.lakes);
    siteMs = performance.now() - tf;
    setGeneratedAirfields(fields);
    return;
  } else {
    erosion = null;
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

const riverHit: RiverHit = { dist: Infinity, level: 0, halfWidth: 0, s: 0, side: 0, beyondSource: 0 };
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

/**
 * A stream's banks as the water has worn them (a seeded world's network, carveNetwork): its bed a little under the
 * water, then a bank whose width wanders along the stream and differs from side to side, and rock walls beyond rising at a
 * slope that varies (about 30 to 50 degrees, steepening a little with height, never sheer), with ledges and
 * buttresses across them. `s` is the arc length along the stream, `side` the bank (+1 right), `line` the stream.
 */
function streamBanks(d: number, halfWidth: number, s: number, side: number, line: number): number {
  if (d < halfWidth) {
    const t = d / halfWidth;
    return -(0.5 + 0.2 * halfWidth) * (1 - t * t);
  }
  const b = d - halfWidth;
  const n1 = gnoise(s / 90 + side * 5.3 + line * 0.71, line * 1.37 + side * 0.5);
  const bank = (2 + 1.5 * halfWidth) * (1 + 0.6 * n1);
  if (b < bank) return 0.5 * smooth(0, bank, b);
  const w = b - bank;
  const slope = 0.75 - 0.35 * n1;
  const ledge = gnoise(s / 37 - side * 2.9 + line * 0.11, w / 9 + line * 0.53);
  return 0.5 + slope * w + 0.02 * w * w + Math.min(4, 1 + 0.08 * w) * ledge * smooth(0, 8, w);
}

/** A stream's broad breach (streams.ts BREACH_*): its floor BREACH_FLOOR over the water, rising BREACH_RISE across to
 * its edge at `breach` m, walls at BREACH_WALL beyond. */
const BREACH_FLOOR = 0.6;
const BREACH_RISE = 1.2;
function breachProfile(d: number, breach: number): number {
  if (d < breach) return BREACH_FLOOR + BREACH_RISE * (d / breach) * (d / breach);
  return BREACH_FLOOR + BREACH_RISE + breachWall(d - breach);
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

/** Smallest warped lake radius at the point sampleTerrain is working on (< 1 under a lake's water). */
let lakeCover = Infinity;
/** The seeded world's lake over the sample point (LakeMask): its level (-Infinity: none) and edge field. */
let maskLevel = -Infinity;
let maskField = 0;
const valleyNear: ValleyNear[] = [];
const channelNear: ChannelNear[] = [];

/** A seeded world's river network (riverNetwork.ts): every valley and channel near the point cut into h, as carveRiver cuts its one river. */
function carveNetwork(north: number, east: number, h: number, out: TerrainSample): number {
  const net = presentHydro.network as NonNullable<Hydrology['network']>;
  // The hollows the streams filled to their sills (streams.ts): a flat over each (not in a lake's domain: its water).
  // Round a tarn the ground the streams were routed over and its shore (streams.ts TarnMask): not in a pond's water.
  if (net.fill && (maskLevel === -Infinity || presentHydro.lakeMask?.tarnHit)) h = net.fill(north, east, h);
  const hShore = h;
  // Along a stream (streams.ts) the ground is its smooth course, without the small-scale relief's knobs and ledges:
  // the stream's water follows that ground down (it took them away), fading back in by STREAM_SMOOTH beyond its bank.
  const nc0 = net.channels(north, east, channelNear);
  let calmS = 0;
  for (let j = 0; j < nc0; j++) {
    const c = channelNear[j];
    if (c.kind === 1) calmS = Math.max(calmS, 1 - smooth(c.halfWidth + STREAM_SMOOTH[0], c.halfWidth + STREAM_SMOOTH[1], c.dist));
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
    let carved = smin(h, v.level + valleyProfile(d, f) + excess * t * t, 4);
    if (hold > 0) carved += hold * Math.max(0, Math.min(h, holdLevel + 0.5) - carved);
    h += (carved - h) * (1 - smooth(f + I * 0.75, f + I, d));
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
    out.riverSigned = riverHit.dist * riverHit.side;
    out.riverHalfWidth = riverHit.halfWidth * (1 - smooth(0, 60, riverHit.beyondSource));
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
  for (let q = 0; q < nc; q++) {
    const o = channelNear[q];
    if (!(o.dist < o.halfWidth + CHANNEL_BANK + 20)) continue;
    const v = o.level + BANK_HEIGHT;
    if (v > keep1) {
      keep2 = keep1;
      keep1 = v;
      keepLine = o.line;
    } else if (v > keep2) keep2 = v;
  }
  /** The tarn whose shore the point lies on, if any (streams.ts TarnMask). */
  const tarnRim = net.tarnRim ? net.tarnRim(north, east) : -Infinity;
  /** The highest water of a channel whose bed or bank the point lies on (-Infinity: none). */
  let inChannel = -Infinity;
  for (let j = 0; j < nc; j++) {
    const c = channelNear[j];
    const d = c.dist;
    if (c.kind === 1) {
      // A stream (streams.ts): a narrow notch, no floodplain banks or levee.
      // Its broad breach first (a rim or sill worn down), then its own bed and banks. Neither takes the ground under
      // another channel's water within that channel's banks (a stream running down beside a river held up on its valley
      // floor would leave the river's water standing over a hollow).
      let keep = keepLine === c.line ? keep2 : keep1;
      // Nor beside a lake standing higher (its domain and a raster point round it, LakeMask.holds), nor a tarn's shore.
      if (c.breach > 0 && mask && mask.holds(north, east) > 0) keep = Math.max(keep, mask.holdLevel + 0.5);
      if (tarnRim > c.level + 3) keep = Math.max(keep, tarnRim + 0.4);
      // (Faded out over the last fifth of its reach, where its walls should long since have met the ground.)
      if (c.breach > 0) h += (Math.max(Math.min(h, keep), smin(h, c.level + breachProfile(d, c.breach), 3)) - h) * open * (1 - smooth(0.8 * c.reach, c.reach, d));
      const w = c.halfWidth * (1 - smooth(0, 20, c.beyondSource));
      if (w <= 0.3) continue;
      // (Not worked out where its banks stand well over the ground: their least height there is under the ground's.)
      const kb = 0.5 + 0.3 * w;
      if (d < w || c.level + 0.4 * (d - w - 3.2 * (2 + 1.5 * w)) - 4 < h + kb) {
        const banks = smin(h, c.level + streamBanks(d, w, c.s, c.side, c.line), kb);
        h += ((d > w ? Math.max(Math.min(h, keep), banks) : banks) - h) * open;
      }
      // Its banks hold its water: where the ground beside it lies under the water (a hillside it crosses, a dip
      // between the points it was traced on) a low bank is built up, at most STREAM_FILL (not in another channel's
      // water, nor at a mouth on the sea).
      if (d > w && out.river === -Infinity && c.level > 0.5 && dryS) {
        const need = Math.min(c.level + 0.3 + 0.03 * (d - w), hNatural + STREAM_FILL) - h;
        if (need > 0) h += need * (1 - smooth(w + STREAM_SMOOTH[0] + 15, w + STREAM_SMOOTH[1], d)) * open;
      }
      if (d < w && h < c.level && open >= 1) out.river = Math.max(out.river, c.level);
      if (d < w + 6) inChannel = Math.max(inChannel, c.level);
      continue;
    }
    const w = c.halfWidth * (1 - smooth(0, 60, c.beyondSource));
    if (w <= 0.5) continue;
    // A gorge below a fall (falls.ts): worn broadly, as a stream's breach.
    if (c.breach > 0) h += (smin(h, c.level + breachProfile(d, c.breach), 3) - h) * open * (1 - smooth(0.8 * c.reach, c.reach, d));
    let carved = smin(h, c.level + channelProfile(d, w), 3);
    // A natural levee is a few metres at most: never a bank raised far over the plain (a wall).
    // (Judged on the ground before a stream's banks raised it: a levee on top of a stream's bank would be a wall.)
    if (d > w && d < w + 40 && c.level > 0.5 && c.level - Math.min(carved, hNatural) < 4) {
      const levee = c.level + 0.3 + 0.03 * (d - w);
      carved += (Math.max(carved, levee) - carved) * (1 - smooth(w + 25, w + 40, d));
    }
    h += (carved - h) * open;
    if (d < w && h < c.level && open >= 1) out.river = Math.max(out.river, c.level);
    if (d < w + 6) inChannel = Math.max(inChannel, c.level);
  }
  // A tarn's shore again over what the valleys and channels carved (they must not let its water stand against lower
  // ground), but not across the bed of a channel at its level (its inflows and its overflow).
  // (Never over the shore as it was laid before the carving.)
  if (net.rim && tarnRim > -Infinity && h < hShore && !(inChannel >= tarnRim - 3) && (maskLevel === -Infinity || mask?.tarnHit)) h = Math.min(hShore, net.rim(north, east, h));
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

  h = presentHydro.network ? carveNetwork(north, east, h, out) : isPresent() ? carveRiver(north, east, h, out) : carveLegacyRiver(north, east, h, out);

  // Approach corridors: keep terrain under a gradient well below the 3 degree glide path from both ends.
  const beyond = Math.abs(along) - HALF_LEN;
  if (beyond > 0 && beyond < APPROACH_LENGTH) {
    const halfW = 300 + 0.12 * beyond;
    const w = (1 - smooth(halfW, halfW * 1.8, Math.abs(across))) * (1 - smooth(APPROACH_LENGTH * 0.85, APPROACH_LENGTH, beyond));
    // Obstacle-clear zone (no trees) for the first few kilometres of each approach.
    out.approach = w * (1 - smooth(1500, 3000, beyond));
    if (w > 0) {
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
      if (w > 0) {
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
    return 2500 + snowShift + 180 * fbm(east / 3000 + 5.5, north / 3000 - 1.1, 3);
  }
  return snowLineBase() + 180 * fbm(east / 3000 + 5.5, north / 3000 - 1.1, 3);
}

/** Level of the snow line before its noise, m: 2500 plus the era's offset (the shader's threshold, its GLSL twin). */
export function snowLineBase(): number {
  return 2500 + era().terrain.snowLineOffset + snowShift;
}

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
