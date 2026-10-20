// Precipitation of the storm cells at a point: the rain shaft, the virga and the hail, as one field that the storm
// march draws (render/weather/stormGlsl.ts reads STORM_PRECIP_GLSL, the GLSL twin of stormPrecipAt) and that the
// consumers at the camera and the aircraft read (localPrecipAt: the precipitation overlay, the airframe sound, the
// carburettor-icing moisture, the hail exposure). Node-safe, no allocation.
//
// Per cell (cellGeometry.ts, three.js world: x east, y up MSL, z south), at the point's horizontal position moved
// upwind by the curtain's slant (RAIN_SLANT per metre below the base, along the anvil's downwind offset):
//   curtain noise   cn (edge, RAIN_NOISE_M and RAIN_NOISE_FINE_M octaves) and cb (body, RAIN_BODY_NOISE_M), 0..1,
//                   value noise on hashed lattices (the same integer hash in TypeScript and GLSL)
//   shaft           smoothstep(shaftR, 0.3 shaftR, r + SHAFT_RAGGED shaftR (2 cn - 1)) x (0.65 + 0.35 cb)
//   virga           outside the shaft, inside the core's footprint, fading out STORM_VIRGA_DEPTH_M (0.5 + cn) below
//                   the base
//   rain density    (shaft + virga) x [1 - smoothstep(base + 50, base + 400, y)] x the fade toward the ground
//                   1 - RAIN_GROUND_FADE (1 - cb) min(1, (base - y) / RAIN_FADE_DEPTH_M) x intensity x rain share
//   rain extinction rain density x STORM_SHAFT_SIGMA; the rate is the inverse of the rain extinction fit
//                   (core/weatherFields.ts precipRateForExtinction)
//   hail            core: smoothstep(HAIL_SHAFT_EDGE shaftR, 0.5 shaftR, rs) (0.6 + 0.4 cn), wider than the rain shaft,
//                   so its edge has hail under lighter rain; anvil: HAIL_ANVIL_SHARE under the anvil downwind of the
//                   core's footprint, in patches (cb above 0.55); up to 500 m below the anvil's underside; times
//                   intensity, the cell's hail share (cellGeometry hail) and HAIL_RATE_FULL_MMH
//   hail extinction 3 rho_w R / (v_t rho_h D) at the distribution's mean diameter (extinction efficiency 2), per
//                   cell (hailSigmaPerMmH; the march reads it as uCellH.y)
// Unconfirmed: every constant here is a look value chosen for this model; no source has been checked.

import { clamp, smoothstep } from '../../core/math';
import type { PrecipType, StormCell, WeatherSettings } from '../../core/types';
import { MAX_STORMS, precipExtinctionPerM, precipOf, precipRateForExtinction, type Precip } from '../../core/weatherFields';
import { cellGeometry, makeCellGeometry, type CellGeometry } from './cellGeometry';
import { HAIL_DENSITY_KGM3, hailFallSpeed, hailMeanMm } from './hail';

/** Extinction of the full-density rain shaft, 1/m. Unconfirmed: a tuning value. */
export const STORM_SHAFT_SIGMA = 0.004;
/** Depth below the base over which the virga fades out, m (times 0.5 + cn). */
export const STORM_VIRGA_DEPTH_M = 800;
/** Depth of the storm's anvil at its centre, m (the core ends at its underside; stormGlsl.ts). */
export const STORM_ANVIL_DEPTH_M = 1500;
/** Curtain noise periods, m. */
export const RAIN_NOISE_M = 1100;
export const RAIN_NOISE_FINE_M = 370;
export const RAIN_BODY_NOISE_M = 620;
/** Displacement of the shaft's edge by the curtain noise, share of the shaft radius (each way). */
export const SHAFT_RAGGED = 0.3;
/** Horizontal slant of the curtains, m per m below the base, at the full anvil offset. */
export const RAIN_SLANT = 0.25;
/** Uneven fade of the rain toward the ground: largest share lost, and the depth below the base it reaches. */
export const RAIN_GROUND_FADE = 0.45;
export const RAIN_FADE_DEPTH_M = 1500;
/** The hail core's edge, in shaft radii (the rain shaft ends at 1). */
export const HAIL_SHAFT_EDGE = 1.35;
/** Hail under the anvil, share of the core's rate. */
export const HAIL_ANVIL_SHARE = 0.15;
/** Hail rate of a cell at full share and intensity, mm/h liquid-water equivalent. */
export const HAIL_RATE_FULL_MMH = 12;
/** Most precipitation the sample reports, mm/h. */
export const LOCAL_RATE_MAX_MMH = 200;

const RHO_WATER = 1000;
/** mm/h to m/s. */
const MMH = 1 / 3.6e6;

// ---------------------------------------------------------------------------------------------- curtain noise
/** Integer hash of a lattice point to [0, 1) (shared with the GLSL twin: 32-bit products and shifts). */
export function rainHash(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Value noise 0..1 at (x, z) / period, smoothstep-interpolated between hashed lattice values. */
export function rainValueNoise(x: number, z: number, period: number, seed: number): number {
  const u = x / period, v = z / period;
  const iu = Math.floor(u), iv = Math.floor(v);
  let fu = u - iu, fv = v - iv;
  fu = fu * fu * (3 - 2 * fu);
  fv = fv * fv * (3 - 2 * fv);
  const a = rainHash(iu, iv, seed), b = rainHash(iu + 1, iv, seed), c = rainHash(iu, iv + 1, seed), d = rainHash(iu + 1, iv + 1, seed);
  return (a + (b - a) * fu) * (1 - fv) + (c + (d - c) * fu) * fv;
}

const SEED_EDGE = 0x1b873593;
const SEED_FINE = 0x5bd1e995;
const SEED_BODY = 0x68e31da4;

// ---------------------------------------------------------------------------------------------- one point
/** The storm precipitation at a point (stormPrecipAt). */
export interface StormPrecipSample {
  /** Rain extinction, 1/m, and its rate, mm/h. */
  rainSigma: number;
  rainMmH: number;
  /** Hail rate, mm/h liquid-water equivalent; its largest stone (rate-weighted over the cells), mm; extinction, 1/m. */
  hailMmH: number;
  hailMaxMm: number;
  hailSigma: number;
}

export const emptyStormPrecip = (): StormPrecipSample => ({ rainSigma: 0, rainMmH: 0, hailMmH: 0, hailMaxMm: 0, hailSigma: 0 });

/** Hail extinction per mm/h of stones of largest diameter maxMm, 1/m per mm/h (0 for maxMm 0). */
export function hailSigmaPerMmH(maxMm: number): number {
  if (!(maxMm > 0)) return 0;
  const d = hailMeanMm(maxMm);
  return (3 * RHO_WATER * MMH) / (hailFallSpeed(d) * HAIL_DENSITY_KGM3 * (d / 1000));
}

/** Hail extinction of a rate (mm/h) of stones of largest diameter maxMm, 1/m. */
export function hailExtinctionPerM(rateMmH: number, maxMm: number): number {
  return rateMmH > 0 ? rateMmH * hailSigmaPerMmH(maxMm) : 0;
}

/**
 * Rain density (x, before STORM_SHAFT_SIGMA) and hail rate (y, mm/h) of one cell at three.js (x, y, z). The GLSL
 * twin is stormPrecipCell in STORM_PRECIP_GLSL.
 */
function cellPrecip(g: CellGeometry, x: number, y: number, z: number, out: { rain: number; hail: number }): void {
  out.rain = 0;
  out.hail = 0;
  if (g.rain <= 0 && g.hail <= 0) return;
  // The curtains lean downwind below the base: read the field upwind of the point.
  const below = Math.max(0, g.base - y);
  const ox = g.anvilX - g.x, oz = g.anvilZ - g.z;
  const lean = (RAIN_SLANT * below) / Math.max(0.5 * g.anvilRadius, 1);
  const px = x - ox * lean, pz = z - oz * lean;
  const r = Math.hypot(px - g.x, pz - g.z);
  const R = g.radius;
  const sr = g.shaftRadius;
  if (r > 1.8 * R && Math.hypot(px - g.anvilX, pz - g.anvilZ) > g.anvilRadius) return;
  const cn = 0.65 * rainValueNoise(px, pz, RAIN_NOISE_M, SEED_EDGE) + 0.35 * rainValueNoise(px, pz, RAIN_NOISE_FINE_M, SEED_FINE);
  const cb = rainValueNoise(px, pz, RAIN_BODY_NOISE_M, SEED_BODY);
  const rs = r + SHAFT_RAGGED * sr * (2 * cn - 1);
  const shaft = smoothstep(sr, 0.3 * sr, rs) * (0.65 + 0.35 * cb);
  const foot = smoothstep(R, 0.6 * R, r);
  const virga = Math.max(foot - smoothstep(sr, 0.3 * sr, rs), 0) * smoothstep(g.base - STORM_VIRGA_DEPTH_M * (0.5 + cn), g.base, y);
  const top = 1 - smoothstep(g.base + 50, g.base + 400, y);
  const fade = 1 - RAIN_GROUND_FADE * (1 - cb) * Math.min(1, below / RAIN_FADE_DEPTH_M);
  out.rain = (shaft + virga) * top * fade * g.intensity * g.rain;
  if (g.hail > 0) {
    const core = smoothstep(HAIL_SHAFT_EDGE * sr, 0.5 * sr, rs) * (0.6 + 0.4 * cn);
    const ra = Math.hypot(px - g.anvilX, pz - g.anvilZ);
    const anvil = HAIL_ANVIL_SHARE * smoothstep(0.85 * g.anvilRadius, 0.35 * g.anvilRadius, ra) * (1 - foot) * smoothstep(0.55, 0.75, cb);
    const anvilBot = g.top - STORM_ANVIL_DEPTH_M;
    const up = 1 - smoothstep(anvilBot - 500, anvilBot, y);
    out.hail = HAIL_RATE_FULL_MMH * (core + anvil) * up * g.intensity * g.hail;
  }
}

const _cell = { rain: 0, hail: 0 };

/** The precipitation of the first `count` cells at three.js (x, y, z), written into `out`. */
export function stormPrecipAt(cells: readonly CellGeometry[], count: number, x: number, y: number, z: number, out: StormPrecipSample): StormPrecipSample {
  let rain = 0, hail = 0, hailD = 0, hailSigma = 0;
  for (let i = 0; i < count; i++) {
    const g = cells[i];
    cellPrecip(g, x, y, z, _cell);
    rain += _cell.rain;
    if (_cell.hail > 0) {
      hail += _cell.hail;
      hailD += _cell.hail * g.hailMm;
      hailSigma += _cell.hail * hailSigmaPerMmH(g.hailMm);
    }
  }
  out.rainSigma = rain * STORM_SHAFT_SIGMA;
  out.rainMmH = out.rainSigma > 0 ? Math.min(LOCAL_RATE_MAX_MMH, precipRateForExtinction('rain', out.rainSigma)) : 0;
  out.hailMmH = hail;
  out.hailMaxMm = hail > 0 ? hailD / hail : 0;
  out.hailSigma = hailSigma;
  return out;
}

// ---------------------------------------------------------------------------------------------- local sample
/** The precipitation at a point: the weather's stratiform precipitation and the storm cells' (localPrecipAt). */
export interface LocalPrecip {
  /** The type that falls the most: the stratiform type, or 'rain' where the storm rain is the larger. */
  type: PrecipType;
  /** Rain, drizzle or snow, stratiform plus storm rain, mm/h. */
  rateMmH: number;
  /** The storm cells' share of rateMmH, mm/h. */
  stormRainMmH: number;
  /** Hail, mm/h liquid-water equivalent, and its largest stone, mm (0 without hail). */
  hailMmH: number;
  hailMaxMm: number;
  /** Extinction of everything falling at the point, 1/m (stratiform, storm rain, hail). */
  extinctionPerM: number;
}

export const emptyLocalPrecip = (): LocalPrecip => ({ type: 'none', rateMmH: 0, stormRainMmH: 0, hailMmH: 0, hailMaxMm: 0, extinctionPerM: 0 });

const _geo: CellGeometry[] = Array.from({ length: MAX_STORMS }, makeCellGeometry);
const _storm = emptyStormPrecip();
const _precip: Precip = { type: 'none', rateMmH: 0 };

/** The stratiform precipitation alone, written into `out` (what the consumers read before the storm cells). */
export function stratiformPrecip(w: WeatherSettings, out: LocalPrecip): LocalPrecip {
  const p = precipOf(w, _precip);
  out.type = p.type;
  out.rateMmH = p.rateMmH;
  out.stormRainMmH = 0;
  out.hailMmH = 0;
  out.hailMaxMm = 0;
  out.extinctionPerM = precipExtinctionPerM(p.type, p.rateMmH);
  return out;
}

/**
 * The precipitation at NED (north, east), altM MSL, simulation time t, from the weather's stratiform fields and the
 * storm cells `cells` in effect there (StormField.select; at most MAX_STORMS read), written into `out`. `capeJkg`:
 * the CAPE of the weather (the hail size, cellGeometry). Without cells it is stratiformPrecip(w).
 */
export function localPrecipAt(w: WeatherSettings, cells: readonly StormCell[], t: number, capeJkg: number, north: number, east: number, altM: number, out: LocalPrecip): LocalPrecip {
  stratiformPrecip(w, out);
  const n = Math.min(cells.length, MAX_STORMS);
  if (n === 0) return out;
  for (let i = 0; i < n; i++) cellGeometry(cells[i], w, t, _geo[i], capeJkg);
  const s = stormPrecipAt(_geo, n, east, altM, -north, _storm);
  if (s.rainMmH <= 0 && s.hailMmH <= 0) return out;
  if (s.rainMmH > out.rateMmH) out.type = 'rain';
  out.rateMmH = clamp(out.rateMmH + s.rainMmH, 0, LOCAL_RATE_MAX_MMH);
  out.stormRainMmH = s.rainMmH;
  out.hailMmH = s.hailMmH;
  out.hailMaxMm = s.hailMaxMm;
  out.extinctionPerM += s.rainSigma + s.hailSigma;
  return out;
}

// ---------------------------------------------------------------------------------------------- GLSL twin
const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const u32 = (v: number): string => `${v >>> 0}u`;

/**
 * GLSL of stormPrecipAt's per-cell field for the storm march. Expects the march's uniforms uCellA..uCellC, uCellW
 * (w: hail share) and uCellH (x: largest stone, mm; y: hailSigmaPerMmH). stormPrecipCell returns (rain density, hail rate mm/h).
 */
export const STORM_PRECIP_GLSL = /* glsl */ `
float rainHash(ivec2 c, uint seed) {
  uint h = (uint(c.x) * 0x27d4eb2du) ^ (uint(c.y) * 0x165667b1u) ^ seed;
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h ^= h >> 13u;
  h *= 0xc2b2ae35u;
  h ^= h >> 16u;
  return float(h) * (1.0 / 4294967296.0);
}
float rainValueNoise(vec2 p, float period, uint seed) {
  vec2 u = p / period;
  vec2 i = floor(u);
  vec2 fr = u - i;
  fr = fr * fr * (3.0 - 2.0 * fr);
  ivec2 c = ivec2(i);
  float a = rainHash(c, seed), b = rainHash(c + ivec2(1, 0), seed), d0 = rainHash(c + ivec2(0, 1), seed), d1 = rainHash(c + ivec2(1, 1), seed);
  return mix(mix(a, b, fr.x), mix(d0, d1, fr.x), fr.y);
}
vec2 stormPrecipCell(int i, vec3 p) {
  vec4 A = uCellA[i];
  vec4 B = uCellB[i];
  vec4 C = uCellC[i];
  vec4 W = uCellW[i];
  if (W.z <= 0.0 && W.w <= 0.0) return vec2(0.0);
  float base = B.x;
  float below = max(0.0, base - p.y);
  vec2 o = C.xy - A.xy;
  float lean = ${f(RAIN_SLANT)} * below / max(0.5 * B.z, 1.0);
  vec2 q = p.xz - o * lean;
  float r = length(q - A.xy);
  float R = A.z, sr = B.w;
  if (r > 1.8 * R && length(q - C.xy) > B.z) return vec2(0.0);
  float cn = 0.65 * rainValueNoise(q, ${f(RAIN_NOISE_M)}, ${u32(SEED_EDGE)}) + 0.35 * rainValueNoise(q, ${f(RAIN_NOISE_FINE_M)}, ${u32(SEED_FINE)});
  float cb = rainValueNoise(q, ${f(RAIN_BODY_NOISE_M)}, ${u32(SEED_BODY)});
  float rs = r + ${f(SHAFT_RAGGED)} * sr * (2.0 * cn - 1.0);
  float s0 = smoothstep(sr, 0.3 * sr, rs);
  float foot = smoothstep(R, 0.6 * R, r);
  float virga = max(foot - s0, 0.0) * smoothstep(base - ${f(STORM_VIRGA_DEPTH_M)} * (0.5 + cn), base, p.y);
  float top = 1.0 - smoothstep(base + 50.0, base + 400.0, p.y);
  float fade = 1.0 - ${f(RAIN_GROUND_FADE)} * (1.0 - cb) * min(1.0, below / ${f(RAIN_FADE_DEPTH_M)});
  float rain = (s0 * (0.65 + 0.35 * cb) + virga) * top * fade * B.y * W.z;
  float hail = 0.0;
  if (W.w > 0.0) {
    float core = smoothstep(${f(HAIL_SHAFT_EDGE)} * sr, 0.5 * sr, rs) * (0.6 + 0.4 * cn);
    float anvil = ${f(HAIL_ANVIL_SHARE)} * smoothstep(0.85 * B.z, 0.35 * B.z, length(q - C.xy)) * (1.0 - foot) * smoothstep(0.55, 0.75, cb);
    float anvilBot = A.w - ${f(STORM_ANVIL_DEPTH_M)};
    hail = ${f(HAIL_RATE_FULL_MMH)} * (core + anvil) * (1.0 - smoothstep(anvilBot - 500.0, anvilBot, p.y)) * B.y * W.w;
  }
  return vec2(rain, hail);
}
`;
