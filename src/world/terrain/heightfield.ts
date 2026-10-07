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

import { clamp, type Vec3 } from '../../core/math';
import type { SurfaceType } from '../../core/types';
import { AIRPORT } from '../../core/world';
import { LAKE_ZONE, RIVER_INFLUENCE, buildHydrology, lakeRadius, type Hydrology, type RiverHit } from './hydrology';
import { fbm, gnoise, gullies, type Deriv } from './noise';

const ELEV = AIRPORT.elevation;
const RW = AIRPORT.runway;
const HALF_LEN = RW.length / 2;
const HALF_WID = RW.width / 2;
const RW_COS = Math.cos(RW.heading);
const RW_SIN = Math.sin(RW.heading);
const FLAT = AIRPORT.flatMargin;
const BLEND = AIRPORT.blendDistance;

/** Sea surface elevation, m MSL. */
export const SEA_LEVEL = 0;
/** Approach corridors keep terrain below this gradient from each runway end (3 deg glide path = 0.0524). */
export const APPROACH_GRADIENT = 0.04;
/** Length of the protected approach corridors beyond each runway end, m. */
const APPROACH_LENGTH = 12000;

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
 */
function erode(east: number, north: number, slopeE: number, slopeN: number): number {
  const slope = Math.sqrt(slopeE * slopeE + slopeN * slopeN);
  if (slope < 1e-3) return 0;
  const strength = slope / (slope + 0.15);
  let ux = slopeE / slope;
  let uy = slopeN / slope;
  let x = east / GULLY_CELL;
  let y = north / GULLY_CELL;
  let sum = 0;
  let amp = 0.5;
  let bx = 0;
  let by = 0;
  for (let o = 0; o < GULLY_OCTAVES; o++) {
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
  return sum * strength;
}

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

/** Regional terrain before rivers, lakes and the airport, m MSL. */
function naturalHeight(north: number, east: number): number {
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

const hydro: Hydrology = buildHydrology(naturalHeight);
export const hydrology: Readonly<Hydrology> = hydro;

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

/** Cross-section of the river valley: height above the water level at distance d from the centreline. */
function riverProfile(d: number, halfWidth: number): number {
  if (d < halfWidth) {
    const t = d / halfWidth;
    return -(2.2 + halfWidth * 0.05) * (1 - t * t);
  }
  const b = d - halfWidth;
  if (b < 25) return 1.3 * smooth(0, 25, b);
  // Floodplain, then valley walls steepening with distance.
  return 1.3 + 0.012 * (b - 25) + 0.00011 * (b - 25) * (b - 25);
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

  let h = naturalHeight(north, east);

  // Lakes: bed = natural terrain lowered toward (level - depth) inside the warped ellipse.
  for (let i = 0; i < hydro.lakes.length; i++) {
    const lake = hydro.lakes[i];
    const ln = north - lake.north;
    const le = east - lake.east;
    if (ln * ln + le * le > lake.bound * lake.bound) continue;
    const r = lakeRadius(lake, north, east);
    if (r < LAKE_ZONE) {
      // Wide, gentle bowl: the shore slopes in rather than being cut into the hillside.
      const bowl = 1 - smoother(0.3, 1.1, r);
      h += (lake.level - lake.depth - h) * bowl;
      out.standing = Math.max(out.standing, lake.level);
    }
  }

  // River: the natural terrain is cut down to the valley cross-section around the water level.
  hydro.queryRiver(north, east, riverHit);
  out.riverDist = riverHit.dist;
  if (riverHit.side !== 0) {
    out.riverSigned = riverHit.dist * riverHit.side;
    out.riverHalfWidth = riverHit.halfWidth * (1 - smooth(0, 60, riverHit.beyondSource));
    out.riverArc = riverHit.s;
  }
  if (riverHit.dist < RIVER_INFLUENCE) {
    const d = riverHit.dist;
    const w = riverHit.halfWidth;
    const target = riverHit.level + riverProfile(d, w);
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

  // Blend into the flat airfield.
  const blend = smoother(FLAT, FLAT + BLEND, dRect);
  out.airportBlend = blend;
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
  return 2500 + 180 * fbm(east / 3000 + 5.5, north / 3000 - 1.1, 3);
}

/**
 * Surface material for tyre friction and crash logic. Never 'runway'/'taxiway' (the airport layers those).
 * Slope is from the local normal; the thresholds are the mid-points of the terrain shader's blends
 * (without its noise), so what the pilot sees is what the wheels feel.
 */
export function terrainSurface(north: number, east: number): SurfaceType {
  const s = sampleTerrain(north, east, scratch);
  if (s.ground < Math.max(s.standing, s.river)) return 'water';
  if (s.airportBlend === 0) return 'grass';
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
