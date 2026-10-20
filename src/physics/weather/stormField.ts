// Cumulonimbus cells from the atmospheric conditions, and the selection of the cells in effect near a point.
// Node-safe (no three.js, no DOM). Physics (WindField, SimEnvironment.moisture) owns a StormField and asks it for the
// cells at the sample point; the render (the cumulus clearing, StormCellEffect, LightningOverlay) shares one per
// simulation context and frame at the camera (render/weather/stormSelection.ts). For the same weather, simulation
// time and point the result is the same.
//
// EXPLICIT AND PROCEDURAL CELLS. When WeatherSettings.storms is present (an array, empty or not: the URL's cb=,
// cb=none, __sim.setWeather, tests) its first MAX_STORMS cells are the cells, every weight 1, and nothing is
// derived. When `storms` is absent (or undefined, NEUTRAL_EXTRAS), the cells come from a lattice of candidate sites
// whose activity is derived from the other weather fields (convectiveState below).
//
// CONVECTIVE ACTIVITY (convectiveState), 0..1, a product of six terms, each 0..1:
//   activity = I x H x D x B x C x Y
//   I  instability   smoothstep(CAPE_MIN, CAPE_FULL, CAPE). CAPE (J/kg) of a surface parcel lifted in the
//                    simulator's own atmosphere (physics/atmosphere.ts: ISA with isaDeviation and the QNH, 6.5 K/km
//                    to 11 km, isothermal above; the only lapse rate the weather defines). The parcel starts at the
//                    field elevation at the air temperature plus HEATING_MAX_K x max(0, sLag) (surface heating),
//                    rises dry-adiabatically (DRY_LAPSE) to cloudBaseM (the lifting condensation level, as
//                    environment.ts reads the base as the dew-point spread), then moist-adiabatically (moistLapse)
//                    in PARCEL_STEP_M steps to PARCEL_TOP_M. CAPE sums g (Tp - Te) / Te dz over the buoyant steps;
//                    the convective inhibition below them is not used. The top of the highest buoyant step is the
//                    equilibrium level, which bounds the cell tops.
//   H  heating       smoothstep(HEAT_SUN_MIN, HEAT_SUN_FULL, sLag), sLag the sine of the sun elevation at
//                    timeOfDay - HEATING_LAG_H on dayOfYear (core/world sunDirectionNED). Night gives 0, a low
//                    winter sun close to 0 (0.05 at 15:00 on day 355), a summer afternoon 1.
//   D  depth         1 for 'towering' (the type is the depth signal); otherwise smoothstep(DEPTH_MIN_M, DEPTH_FULL_M,
//                    (cloudTopM - cloudBaseM) x towerExt), the cumulus layer depth as the clouds module draws it for
//                    the type alone (CLOUD_TYPE_PROFILES towerExt: 1.6 for 'auto' and 'cumulus'; the deepening by
//                    the activity, render/clouds layerTowerExt, is not fed back). The fair-weather layer of
//                    defaultWeather() (1100 m x 1.6 = 1760 m) gives 0.
//   B  moisture      1 - smoothstep(BASE_MOIST_M, BASE_DRY_M, cloudBaseM - field elevation): a low base is a moist
//                    boundary layer. WeatherSettings has no humidity field; the base is the only moisture input.
//   C  cumulus cover smoothstep(COVER_MIN, COVER_FULL, cloudCover): 0 at cover 0.05, 1 from 0.25.
//   Y  cloud type    TYPE_FACTOR: towering 1, cumulus 0.8, stratus / stratocumulus / nimbostratus 0 (a deck
//                    suppresses surface-based convection); 'auto' 0.8 x (1 - smoothstep(0.6, 0.9, cloudCover)), the
//                    cover band where 'auto' turns from cumulus into a deck (as WindField.convectiveVelocity).
//
// SITES. A square lattice of SITE_SPACING_M in world NED (site (i, j) at north i S, east j S). Each site has a
// period P (PERIOD_MIN_S..PERIOD_MAX_S) and a phase, both hashed from the site and the seed; time is cut into
// generations of P, and each generation holds at most one cell, with hashed lifetime L (LIFE_MIN_S..LIFE_MAX_S,
// L < P), birth time inside the generation, jitter of the birth position (up to SITE_JITTER S on each axis), core
// radius, intensity and top share. A cell's existence e = clamp((EXIST_MAX x a_b x r - u) / EXIST_SOFT, 0, 1), u
// hashed, a_b the activity at the cell's birth time and r the site's regional factor:
//   a_b   the activity of the weather at the clock reading of the birth (the other inputs as they are now),
//         linear between samples BIRTH_GRID_S apart (cached per field); the intensity and the top use it too. A
//         decaying activity (evening) stops births and leaves the cells already born to end their life cycle.
//   r     value noise on a lattice of REGION_SPACING_M (REGION_MIN..REGION_MAX, seeded, at the site's lattice point):
//         the cells cluster into regions and gaps of about 60 km.
// A change of the weather inputs (not of the clock) changes a_b and fades cells in and out.
//   Time base: T = ((dayOfYear - 1) x 24 + timeOfDay) x 3600 s, the weather's own clock, not the simulation time.
//   SimPhysics.resetTo sets the simulation time to 0 and leaves timeOfDay, so a reset or a resume moves no cell.
//   With the clock frozen (clock=0) T does not advance and the cells stand still. Past day SKY_DAYS_IN_YEAR the
//   date wraps to 1 and T jumps back a year (every cell changes). Editing the time of day moves T with it.
//   Drift: a cell moves from its birth position with the steering wind (stormSteering): from windDirectionDeg veered
//   by the boundary layer's veer at STEERING_HEIGHT_M (boundaryLayer windVeer, 25 deg) at windSpeedKt x
//   STEERING_FACTOR (the factor the cumulus layer drifts with, render/clouds CLOUD_WIND_FACTOR). It is not stored:
//   a change of the wind settings moves every live cell by the change of velocity times its age.
//   Life cycle, a = age / L, every share 0 at a = 0 and at a = 1:
//     growth    0..GROWTH_END: the top rises from 0.3 to 1 of its height above the base, the core radius from
//               0.6 to 1 of its value (towering cumulus);
//     core      smoothstep(0, 0.1, a) (1 - smoothstep(0.7, 0.95, a))
//     anvil     smoothstep(0.2, 0.4, a) (1 - smoothstep(0.85, 1, a))     (outlasts the core: dissipating anvil)
//     rain      smoothstep(0.25, 0.4, a) (1 - smoothstep(0.7, 0.9, a))
//     lightning smoothstep(0.3, 0.4, a) (1 - smoothstep(0.65, 0.8, a))
//     wind      smoothstep(0.05, 0.3, a) (1 - smoothstep(0.75, 0.95, a))  (updraft, downdraft, outflow, turbulence)
//   Tops: base + (ceiling - base) x (0.6 + 0.4 a_b) x (0.8 + 0.2 u), ceiling = min(TOP_CEILING_M, equilibrium level
//   at birth + OVERSHOOT_M), at least base + MIN_CELL_DEPTH_M; during growth at least base + MIN_GROWING_DEPTH_M
//   (the render's floor; physics/weather/convection.ts cellTopM floors a derived cell at DERIVED_TOP_MIN_M).
//
// SELECTION at a reference point: of the live cells within FADE_END_M, at most MAX_STORMS (6) by the score
// s = e x max(core, anvil) x (1 - d / FADE_END_M), d the horizontal distance. Each selected cell gets the weight
//   weight = e x (1 - smoothstep(FADE_START_M, FADE_END_M, d)) x clamp((s - sOut) / m, 0, 1),
//   m = clamp(sPrev - sOut, RANK_MARGIN_MIN, RANK_MARGIN),
// sOut the score of the first cell left out (rank MAX_STORMS + 1) and sPrev that of rank MAX_STORMS - 1 (each 0
// when missing), and its shares are multiplied by it. The rank fade reaches 1 at sPrev, so it dims only the lowest
// selected cell unless three scores lie within RANK_MARGIN_MIN. When a cell overtakes the lowest selected one both
// scores equal sOut, so the weight of the cell leaving the set is 0 at that moment; when two selected cells swap
// both weights are equal. The weights are continuous in the point and in time.
//   Cache: the live cells are kept for points within REUSE_M of the point they were built for and clock readings
//   within CLOCK_REUSE_S of their build clock. They hold every cell alive at some reading in that window, and
//   choose() evaluates positions and life cycles at the current clock, so a reused cache gives what a rebuild gives.
//
// Unconfirmed: every constant below except the physical ones (G, LV, RD, CP, EPS, DRY_LAPSE and the saturation
// vapour pressure fit) is a tuning value chosen for this model, not taken from observations.

import { DEG, KT, clamp, smoothstep } from '../../core/math';
import type { AtmosphereSample, CloudType, StormCell, WeatherSettings } from '../../core/types';
import { CLOUD_TYPE_PROFILES, MAX_STORMS, cloudTypeOf, stormsOf } from '../../core/weatherFields';
import { AIRPORT, sunDirectionNED } from '../../core/world';
import { ISA_SEA_LEVEL, R_AIR, atmosphereInto, geopotentialAltitude, type AtmosphereConditions } from '../atmosphere';
import { windVeer } from './boundaryLayer';
import { hashU32 } from './random';

// ---------------------------------------------------------------------------------------------- activity constants
/** Instability term: CAPE where it starts and where it reaches 1, J/kg. */
export const CAPE_MIN = 300;
export const CAPE_FULL = 1500;
/** Parcel temperature excess over the air at full sun (sLag = 1), K. */
export const HEATING_MAX_K = 4;
/** Lag of the surface heating behind the sun, h (convection peaks in the afternoon). */
export const HEATING_LAG_H = 2;
/** Heating term: lagged sun-elevation sine where it starts and where it reaches 1. */
export const HEAT_SUN_MIN = 0.25;
export const HEAT_SUN_FULL = 0.7;
/** Depth term: drawn cumulus depth where it starts and where it reaches 1, m ('towering' gives D = 1 at any depth). */
export const DEPTH_MIN_M = 2000;
export const DEPTH_FULL_M = 4000;
/** Moisture term: cloud base above the field where it is 1 (moist) and where it reaches 0 (dry), m. */
export const BASE_MOIST_M = 800;
export const BASE_DRY_M = 2000;
/**
 * Cover term: cumulus cover where it starts and where it reaches 1. The cover is a symptom of the convection, not
 * its cause, so the band sits low: a few scattered cumulus (cover 0.25) are enough.
 */
export const COVER_MIN = 0.05;
export const COVER_FULL = 0.25;
/** Cloud type term ('auto' is 0.8 times its cumulus share, see convectiveState). */
export const TYPE_FACTOR: Readonly<Record<CloudType, number>> = Object.freeze({
  auto: 0.8,
  cumulus: 0.8,
  towering: 1,
  stratus: 0,
  stratocumulus: 0,
  nimbostratus: 0,
});

// ---------------------------------------------------------------------------------------------- parcel constants
/** Gravity, m/s^2; latent heat of vaporisation, J/kg; dry-air gas constant, J/(kg K); cp, J/(kg K); Rd / Rv. */
const G = 9.80665;
const LV = 2.501e6;
const RD = 287.05;
const CP = 1004;
const EPS = 0.622;
/** Dry-adiabatic lapse rate g / cp, K/m. */
const DRY_LAPSE = G / CP;
/** Parcel ascent step and its highest level, m. */
export const PARCEL_STEP_M = 200;
export const PARCEL_TOP_M = 16_000;

// ---------------------------------------------------------------------------------------------- site constants
/** Lattice spacing, m, and the largest jitter of a birth position on each axis, as a share of it. */
export const SITE_SPACING_M = 15_000;
export const SITE_JITTER = 0.35;
/** Generation period of a site, s. */
export const PERIOD_MIN_S = 75 * 60;
export const PERIOD_MAX_S = 105 * 60;
/** Cell lifetime, s (below PERIOD_MIN_S, so a generation holds one whole life). */
export const LIFE_MIN_S = 30 * 60;
export const LIFE_MAX_S = 60 * 60;
/** Existence: probability of a cell per generation at activity 1 and regional factor 1, and the soft band of the threshold. */
export const EXIST_MAX = 0.5;
export const EXIST_SOFT = 0.03;
/**
 * Regional factor: value noise on a square lattice of REGION_SPACING_M (features about twice that across: storm
 * regions and gaps of about 60 km), REGION_MIN..REGION_MAX, multiplying the existence probability of every site.
 */
export const REGION_SPACING_M = 30_000;
export const REGION_MIN = 0.5;
export const REGION_MAX = 1.5;
/** Clock grid on which the activity at a cell's birth is sampled (linear between grid points), s. */
export const BIRTH_GRID_S = 600;
/** Core radius range at maturity, m (the growth phase starts at 0.6 of it). */
export const RADIUS_MIN_M = 1800;
export const RADIUS_MAX_M = 4000;
/** Intensity at maturity: INTENSITY_MIN..1 hashed, times (0.5 + 0.5 activity). */
export const INTENSITY_MIN = 0.5;
/** Highest top, m MSL (a tropopause-like ceiling), the overshoot above the equilibrium level, m, and the least cell depth, m. */
export const TOP_CEILING_M = 14_000;
export const OVERSHOOT_M = 1000;
export const MIN_CELL_DEPTH_M = 3000;
/** Least depth of a growing cell above the base, m (the render's floor, StormCellEffect cellGeometry: base + 2000 m). */
export const MIN_GROWING_DEPTH_M = 2000;
/** End of the growth phase, as a share of the life. */
export const GROWTH_END = 0.3;
/** Steering wind: the surface wind's speed times this (render/clouds CLOUD_WIND_FACTOR, 1.8). */
export const STEERING_FACTOR = 1.8;
/** Steering wind: the surface direction veered as the boundary layer veers it at this height (boundaryLayer windVeer), m AGL. */
export const STEERING_HEIGHT_M = 2000;
/** Default seed of the lattice. */
export const STORM_SEED = 1;

// ---------------------------------------------------------------------------------------------- selection constants
/** Distance fade of a selected cell: full weight to FADE_START_M, none from FADE_END_M, m. */
export const FADE_START_M = 40_000;
export const FADE_END_M = 60_000;
/**
 * Rank fade: a selected cell reaches full weight at a score margin m over the first cell left out, m =
 * clamp(gap, RANK_MARGIN_MIN, RANK_MARGIN), gap the margin of the second-lowest selected cell over it.
 */
export const RANK_MARGIN = 0.05;
export const RANK_MARGIN_MIN = 0.025;
/** The candidate list is rebuilt when the reference point moves this far from where it was built, m. */
const REUSE_M = 10_000;
/**
 * ... or when the weather clock moves this far from the clock it was built at, s. The list holds every cell alive
 * at some clock reading within it, so the selection does not depend on when the list was built.
 */
export const CLOCK_REUSE_S = 10;
const SALT = 0x63626c74;
const REGION_SALT = 0x7267696f;

// ---------------------------------------------------------------------------------------------- types
/**
 * A cell as the consumers read it: a StormCell (stormCentreAt(cell, t) is its centre at the simulation time t it
 * was selected for) plus its identity and shares. Explicit cells have every share 1 and id = their index.
 */
export interface ActiveStorm extends StormCell {
  /** Stable identity (lightning schedule): the index of an explicit cell; a hash of site and generation. */
  id: number;
  /** True for a cell derived from the conditions, false for an explicit one. */
  derived: boolean;
  /** Selection weight 0..1 (1 for explicit cells); already multiplied into the shares below. */
  weight: number;
  /** Shares 0..1 of the drawn core cloud, anvil and rain shaft, of the lightning rate and of the wind field. */
  core: number;
  anvil: number;
  rain: number;
  flash: number;
  wind: number;
}

/** The derived convective state and its terms (convectiveState). */
export interface ConvectiveState {
  activity: number;
  instability: number;
  heating: number;
  depth: number;
  moisture: number;
  cover: number;
  type: number;
  /** CAPE of the surface parcel, J/kg. */
  capeJkg: number;
  /** Top of the highest buoyant parcel step, m MSL; 0 when no step is buoyant. */
  equilibriumM: number;
  /** Sine of the sun elevation HEATING_LAG_H before timeOfDay. */
  sunLagSin: number;
}

export const emptyConvectiveState = (): ConvectiveState => ({
  activity: 0, instability: 0, heating: 0, depth: 0, moisture: 0, cover: 0, type: 0, capeJkg: 0, equilibriumM: 0, sunLagSin: 0,
});

/** True when the cells come from the conditions (`storms` absent or undefined). */
export const proceduralStorms = (w: WeatherSettings): boolean => (w as { storms?: unknown }).storms === undefined;

/** The weather's own clock, s: ((dayOfYear - 1) x 24 + timeOfDay) x 3600. */
export const stormClockS = (w: WeatherSettings): number => ((w.dayOfYear - 1) * 24 + w.timeOfDay) * 3600;

// ---------------------------------------------------------------------------------------------- parcel
/** Saturation vapour pressure over water, Pa (Bolton 1980), T in K. */
function saturationPa(T: number): number {
  return 611.2 * Math.exp((17.67 * (T - 273.15)) / (T - 29.65));
}

/** Saturated (moist) adiabatic lapse rate at temperature T (K) and pressure p (Pa), K/m. */
export function moistLapse(T: number, p: number): number {
  const es = saturationPa(T);
  const r = (EPS * es) / Math.max(p - es, 1);
  return (G * (1 + (LV * r) / (RD * T))) / (CP + (LV * LV * r * EPS) / (RD * T * T));
}

/** Air temperature of atmosphere.ts at altitude z (m MSL, below 20 km geopotential) with deviation dT, K. */
function isaTemperature(z: number, dT: number): number {
  return ISA_SEA_LEVEL.temperature + dT - 0.0065 * Math.min(geopotentialAltitude(z), 11_000);
}

const _cond: AtmosphereConditions = { isaDeviation: 0, seaLevelPressure: 101325 };
const _atm: AtmosphereSample = { temperature: 0, pressure: 0, density: 0, speedOfSound: 0, viscosity: 0 };

/** The convective activity of `w` and its terms, written into `out` (see the header). Allocation-free. */
export function convectiveState(w: WeatherSettings, out: ConvectiveState): ConvectiveState {
  const field = AIRPORT.elevation;
  const type = cloudTypeOf(w);
  const cover = Number.isFinite(w.cloudCover) ? clamp(w.cloudCover, 0, 1) : 0;
  out.sunLagSin = -sunDirectionNED(w.timeOfDay - HEATING_LAG_H, w.dayOfYear).z;
  out.heating = smoothstep(HEAT_SUN_MIN, HEAT_SUN_FULL, out.sunLagSin);
  const drawnDepth = Math.max(0, w.cloudTopM - w.cloudBaseM) * CLOUD_TYPE_PROFILES[type].towerExt;
  out.depth = type === 'towering' ? 1 : smoothstep(DEPTH_MIN_M, DEPTH_FULL_M, drawnDepth);
  out.moisture = 1 - smoothstep(BASE_MOIST_M, BASE_DRY_M, w.cloudBaseM - field);
  out.cover = smoothstep(COVER_MIN, COVER_FULL, cover);
  out.type = type === 'auto' ? TYPE_FACTOR.auto * (1 - smoothstep(0.6, 0.9, cover)) : TYPE_FACTOR[type];

  // The parcel: surface heating, dry ascent to the base, moist ascent above it. The air's pressure is carried up
  // hydrostatically from atmosphereInto at the base (one exp per step instead of a full atmosphereInto); its
  // temperature is atmosphere.ts's layer formula (6.5 K/km to 11 km geopotential, isothermal to 20 km).
  _cond.isaDeviation = w.isaDeviation;
  _cond.seaLevelPressure = w.qnhHpa * 100;
  const base = Math.max(field, w.cloudBaseM);
  let Tp = atmosphereInto(field, _cond, _atm).temperature + HEATING_MAX_K * Math.max(0, out.sunLagSin);
  Tp -= DRY_LAPSE * (base - field);
  let p = atmosphereInto(base, _cond, _atm).pressure;
  let Te = _atm.temperature;
  let cape = 0;
  let el = 0;
  for (let z = base; z < PARCEL_TOP_M; z += PARCEL_STEP_M) {
    const buoyancy = (Tp - Te) / Te;
    if (buoyancy > 0) {
      cape += G * buoyancy * PARCEL_STEP_M;
      el = z + PARCEL_STEP_M;
    }
    Tp -= moistLapse(Tp, p) * PARCEL_STEP_M;
    const TeNext = isaTemperature(z + PARCEL_STEP_M, w.isaDeviation);
    p *= Math.exp((-G * PARCEL_STEP_M) / (R_AIR * 0.5 * (Te + TeNext)));
    Te = TeNext;
  }
  out.capeJkg = Number.isFinite(cape) ? cape : 0;
  out.equilibriumM = el;
  out.instability = smoothstep(CAPE_MIN, CAPE_FULL, out.capeJkg);
  const a = out.instability * out.heating * out.depth * out.moisture * out.cover * out.type;
  out.activity = Number.isFinite(a) ? clamp(a, 0, 1) : 0;
  return out;
}

// ---------------------------------------------------------------------------------------------- the field
/**
 * A cell of the lattice alive at some clock reading within CLOCK_REUSE_S of the build clock: what does not depend
 * on the clock (birth position NED m, birth time and lifetime on the weather clock, s, the values hashed or taken
 * from the birth activity); choose() evaluates its position and life cycle at the current clock.
 */
interface Candidate {
  id: number;
  north0: number;
  east0: number;
  birth: number;
  life: number;
  /** Full core radius, m; top above the base at full growth, m. */
  radiusFull: number;
  topSpan: number;
  intensity: number;
  exist: number;
  /** At the clock StormField.evalClock (choose()): position, age (s; NaN when not alive), core and anvil shares. */
  north: number;
  east: number;
  age: number;
  core: number;
  anvil: number;
}

const makeCandidate = (): Candidate => ({ id: 0, north0: 0, east0: 0, birth: 0, life: 1, radiusFull: 0, topSpan: 0, intensity: 0, exist: 0, north: 0, east: 0, age: NaN, core: 0, anvil: 0 });
const makeActive = (): ActiveStorm => ({
  northM: 0, eastM: 0, radiusM: 0, topM: 0, intensity: 0, motionDeg: 0, motionKt: 0, lightning: undefined, id: 0, derived: false, weight: 1, core: 1, anvil: 1, rain: 1, flash: 1, wind: 1,
});

const NONE: readonly ActiveStorm[] = Object.freeze([]);

/** The low and high 16 bits of a hash as a value in [0, 1). */
const lowHalf = (h: number): number => (h & 0xffff) / 65536;
const highHalf = (h: number): number => (h >>> 16) / 65536;
/** The k-th value in [0, 1) drawn from the hash h. */
const unit = (h: number, k: number): number => hashU32(h + Math.imul(k + 1, 0x632be5ab)) / 4294967296;

/** Ring of the birth-activity grid samples (BIRTH_GRID_S apart; a life spans at most LIFE_MAX_S / BIRTH_GRID_S + 2). */
const GRID_SLOTS = 16;
const slotOf = (k: number): number => ((k % GRID_SLOTS) + GRID_SLOTS) % GRID_SLOTS;

/** Value noise 0..1 of the region lattice (REGION_SPACING_M) at NED (north, east), m: smoothstep-weighted bilinear. */
function regionNoise(seed: number, north: number, east: number): number {
  const x = north / REGION_SPACING_M;
  const y = east / REGION_SPACING_M;
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const v = (a: number, b: number): number => hashU32(hashU32(seed ^ Math.imul(a, 0x2c1b3c6d)) ^ Math.imul(b, 0x297a2d39)) / 4294967296;
  const v0 = v(i, j) + (v(i, j + 1) - v(i, j)) * sy;
  const v1 = v(i + 1, j) + (v(i + 1, j + 1) - v(i + 1, j)) * sy;
  return v0 + (v1 - v0) * sx;
}

/**
 * The regional factor REGION_MIN..REGION_MAX of the existence probability at NED (north, east), m, for the lattice
 * seed `seed` (StormField's constructor argument). Deterministic: every StormField with the same seed reads it.
 */
export function regionFactor(north: number, east: number, seed = STORM_SEED): number {
  return REGION_MIN + (REGION_MAX - REGION_MIN) * regionNoise(hashU32(hashU32(seed ^ SALT) ^ REGION_SALT), north, east);
}

/** The steering wind of the derived cells: where it blows from, deg in [0, 360), and its speed, kt. */
export function stormSteering(w: Pick<WeatherSettings, 'windDirectionDeg' | 'windSpeedKt'>, out: { fromDeg: number; kt: number }): { fromDeg: number; kt: number } {
  const from = w.windDirectionDeg + windVeer(STEERING_HEIGHT_M) / DEG;
  out.fromDeg = ((from % 360) + 360) % 360;
  out.kt = Math.max(0, w.windSpeedKt) * STEERING_FACTOR;
  return out;
}

/**
 * The cells in effect at a reference point (see the header). One instance per consumer: it caches the derived
 * state and the live cells near the last reference point, and reuses the returned array and its entries.
 */
export class StormField {
  private readonly state = emptyConvectiveState();
  private readonly seed: number;
  private readonly regionSeed: number;
  // Cache keys of convective(): the activity inputs.
  private kIsa = NaN;
  private kQnh = NaN;
  private kCover = NaN;
  private kBase = NaN;
  private kTop = NaN;
  private kType: CloudType | null = null;
  private kTod = NaN;
  private kDay = NaN;
  // Cache keys of the selection: the activity inputs other than the clock, the clock, the wind and the centre.
  private sIsa = NaN;
  private sQnh = NaN;
  private sCover = NaN;
  private sBase = NaN;
  private sTop = NaN;
  private sType: CloudType | null = null;
  private sClock = NaN;
  private kDir = NaN;
  private kSpeed = NaN;
  private kNorth = NaN;
  private kEast = NaN;
  /** Birth-activity grid: the clock index k (time k BIRTH_GRID_S) held in each slot, its activity and equilibrium level. */
  private readonly gridK = new Float64Array(GRID_SLOTS).fill(NaN);
  private readonly gridAct = new Float64Array(GRID_SLOTS);
  private readonly gridEl = new Float64Array(GRID_SLOTS);
  private readonly gridState = emptyConvectiveState();
  private gridWeather: WeatherSettings | null = null;
  /** The weather clock of the last select, s, and the clock the candidates were last evaluated at (choose()). */
  private clock = NaN;
  private evalClock = NaN;
  /** Largest activity at a birth time of a cell alive within CLOCK_REUSE_S of the clock sClock (0: no cell). */
  private windowMax = 0;
  /** Activity and equilibrium level at the birth time of the last birthSample call. */
  private bAct = 0;
  private bEl = 0;
  private readonly steer = { fromDeg: 0, kt: 0 };
  private readonly candidates: Candidate[] = [];
  private count = 0;
  private readonly active: ActiveStorm[] = Array.from({ length: MAX_STORMS }, makeActive);
  private readonly list: ActiveStorm[] = [];
  /** Top-(MAX_STORMS + 1) scratch: candidate indices and their scores. */
  private readonly topIdx = new Int32Array(MAX_STORMS + 1);
  private readonly topScore = new Float64Array(MAX_STORMS + 1);
  private readonly topDist = new Float64Array(MAX_STORMS + 1);

  constructor(seed = STORM_SEED) {
    this.seed = hashU32(seed ^ SALT);
    this.regionSeed = hashU32(this.seed ^ REGION_SALT);
  }

  /** The derived convective state of `w` at its own clock (cached; read-only result). */
  convective(w: WeatherSettings): Readonly<ConvectiveState> {
    const type = cloudTypeOf(w);
    if (
      w.isaDeviation !== this.kIsa || w.qnhHpa !== this.kQnh || w.cloudCover !== this.kCover || w.cloudBaseM !== this.kBase ||
      w.cloudTopM !== this.kTop || type !== this.kType || w.timeOfDay !== this.kTod || w.dayOfYear !== this.kDay
    ) {
      this.kIsa = w.isaDeviation;
      this.kQnh = w.qnhHpa;
      this.kCover = w.cloudCover;
      this.kBase = w.cloudBaseM;
      this.kTop = w.cloudTopM;
      this.kType = type;
      this.kTod = w.timeOfDay;
      this.kDay = w.dayOfYear;
      convectiveState(w, this.state);
    }
    return this.state;
  }

  /**
   * The cells in effect at NED (north, east) at simulation time t, s: the explicit list when `storms` is present,
   * else the procedural selection. The array and its entries are reused by the next call.
   */
  select(w: WeatherSettings, t: number, north: number, east: number): readonly ActiveStorm[] {
    if (!proceduralStorms(w)) return this.explicit(w);
    this.sync(w);
    if (!(this.windowMax > 0)) return NONE;
    if (!(Math.abs(north - this.kNorth) <= REUSE_M && Math.abs(east - this.kEast) <= REUSE_M)) this.build(w, north, east);
    return this.choose(w, t, north, east);
  }

  /** Invalidate the caches the weather's inputs changed: the birth grid, the live cells. */
  private sync(w: WeatherSettings): void {
    const type = cloudTypeOf(w);
    if (
      w.isaDeviation !== this.sIsa || w.qnhHpa !== this.sQnh || w.cloudCover !== this.sCover || w.cloudBaseM !== this.sBase ||
      w.cloudTopM !== this.sTop || type !== this.sType
    ) {
      this.sIsa = w.isaDeviation;
      this.sQnh = w.qnhHpa;
      this.sCover = w.cloudCover;
      this.sBase = w.cloudBaseM;
      this.sTop = w.cloudTopM;
      this.sType = type;
      this.gridK.fill(NaN);
      this.sClock = NaN;
    }
    const T = stormClockS(w);
    this.clock = T;
    if (!(Math.abs(T - this.sClock) <= CLOCK_REUSE_S)) {
      this.sClock = T;
      // A cell alive within CLOCK_REUSE_S of T was born in (T - CLOCK_REUSE_S - LIFE_MAX_S, T + CLOCK_REUSE_S); its
      // birth sample lies between these grid points.
      let max = 0;
      const k1 = Math.floor((T + CLOCK_REUSE_S) / BIRTH_GRID_S) + 1;
      for (let k = Math.floor((T - CLOCK_REUSE_S - LIFE_MAX_S) / BIRTH_GRID_S); k <= k1; k++) max = Math.max(max, this.gridActivity(w, k));
      this.windowMax = max;
      this.kNorth = NaN;
    }
    if (w.windDirectionDeg !== this.kDir || w.windSpeedKt !== this.kSpeed) {
      this.kDir = w.windDirectionDeg;
      this.kSpeed = w.windSpeedKt;
      this.kNorth = NaN;
    }
  }

  /** The activity at clock k BIRTH_GRID_S (cached in the grid ring; also fills its equilibrium level). */
  private gridActivity(w: WeatherSettings, k: number): number {
    const slot = slotOf(k);
    if (this.gridK[slot] !== k) {
      const Tg = k * BIRTH_GRID_S;
      const day = Math.floor(Tg / 86_400) + 1;
      const g = (this.gridWeather ??= { ...w });
      g.isaDeviation = w.isaDeviation;
      g.qnhHpa = w.qnhHpa;
      g.cloudCover = w.cloudCover;
      g.cloudBaseM = w.cloudBaseM;
      g.cloudTopM = w.cloudTopM;
      g.cloudType = cloudTypeOf(w);
      g.dayOfYear = day;
      g.timeOfDay = (Tg - (day - 1) * 86_400) / 3600;
      convectiveState(g, this.gridState);
      this.gridK[slot] = k;
      this.gridAct[slot] = this.gridState.activity;
      this.gridEl[slot] = this.gridState.equilibriumM;
    }
    return this.gridAct[slot];
  }

  /** The activity and equilibrium level at birth time b (s, weather clock) into bAct, bEl: linear in the grid. */
  private birthSample(w: WeatherSettings, b: number): void {
    const x = b / BIRTH_GRID_S;
    const k = Math.floor(x);
    const f = x - k;
    const a0 = this.gridActivity(w, k);
    const e0 = this.gridEl[slotOf(k)];
    const a1 = this.gridActivity(w, k + 1);
    const e1 = this.gridEl[slotOf(k + 1)];
    this.bAct = a0 + (a1 - a0) * f;
    this.bEl = e0 + (e1 - e0) * f;
  }

  /** Explicit cells, every share 1 (copies, so the shared entries are never the weather's own objects). */
  private explicit(w: WeatherSettings): readonly ActiveStorm[] {
    const cells = stormsOf(w);
    const n = Math.min(cells.length, MAX_STORMS);
    const list = this.list;
    list.length = 0;
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      const a = this.active[i];
      a.northM = c.northM;
      a.eastM = c.eastM;
      a.radiusM = c.radiusM;
      a.topM = c.topM;
      a.intensity = c.intensity;
      a.motionDeg = c.motionDeg;
      a.motionKt = c.motionKt;
      a.lightning = c.lightning === false ? false : undefined;
      a.id = i;
      a.derived = false;
      a.weight = a.core = a.anvil = a.rain = a.flash = a.wind = 1;
      list.push(a);
    }
    return list;
  }

  /**
   * Rebuild the cells alive within CLOCK_REUSE_S of the clock sClock that lie within FADE_END_M + REUSE_M (diagonal
   * included) of (north, east) at some clock reading in that window.
   */
  private build(w: WeatherSettings, north: number, east: number): void {
    this.kNorth = north;
    this.kEast = east;
    this.count = 0;
    this.evalClock = NaN;
    const T = this.sClock;
    const T0 = T - CLOCK_REUSE_S;
    const T1 = T + CLOCK_REUSE_S;
    const S = SITE_SPACING_M;
    const steer = stormSteering(w, this.steer);
    const from = steer.fromDeg * DEG;
    const speed = steer.kt * KT;
    const vN = -Math.cos(from) * speed;
    const vE = -Math.sin(from) * speed;
    // A cell moves up to speed CLOCK_REUSE_S between T and the clock it is read at.
    const reach = FADE_END_M + REUSE_M * Math.SQRT2 + speed * CLOCK_REUSE_S;
    const jitter = SITE_JITTER * S;
    // A cell born at p0 sits at p0 + v age, age <= LIFE_MAX_S: the birth sites lie up to v LIFE_MAX_S upwind.
    const dN = vN * LIFE_MAX_S;
    const dE = vE * LIFE_MAX_S;
    const i0 = Math.floor((north - reach - jitter - Math.max(0, dN)) / S);
    const i1 = Math.ceil((north + reach + jitter - Math.min(0, dN)) / S);
    const j0 = Math.floor((east - reach - jitter - Math.max(0, dE)) / S);
    const j1 = Math.ceil((east + reach + jitter - Math.min(0, dE)) / S);
    const base = w.cloudBaseM;
    const pMax = EXIST_MAX * this.windowMax * REGION_MAX;
    for (let i = i0; i <= i1; i++) {
      const row = hashU32(this.seed ^ Math.imul(i, 0x27d4eb2f));
      for (let j = j0; j <= j1; j++) {
        // One hash per site (its period and phase from its two 16-bit halves) and one per generation (lifetime and
        // birth from its halves; the other values are successive hashes of it).
        const key = hashU32(row ^ Math.imul(j, 0x165667b1));
        const period = PERIOD_MIN_S + (PERIOD_MAX_S - PERIOD_MIN_S) * lowHalf(key);
        const phase = period * highHalf(key);
        // The generations covering the window (two when it spans a generation's end; PERIOD_MIN_S >> the window).
        const g1 = Math.floor((T1 + phase) / period);
        for (let g = Math.floor((T0 + phase) / period); g <= g1; g++) {
          const gen = hashU32(key ^ Math.imul(g, 0x9e3779b1));
          const life = LIFE_MIN_S + (LIFE_MAX_S - LIFE_MIN_S) * lowHalf(gen);
          const birth = g * period - phase + (period - life) * highHalf(gen);
          if (!(birth < T1 && birth + life > T0)) continue;
          // The existence threshold u against the largest probability first (most sites stop here).
          const u = unit(gen, 2);
          if (u >= pMax) continue;
          this.birthSample(w, birth);
          const act = this.bAct;
          if (u >= EXIST_MAX * act * REGION_MAX) continue;
          const pExist = EXIST_MAX * act * (REGION_MIN + (REGION_MAX - REGION_MIN) * regionNoise(this.regionSeed, i * S, j * S));
          const exist = clamp((pExist - u) / EXIST_SOFT, 0, 1);
          if (exist <= 0) continue;
          const n0 = i * S + (2 * unit(gen, 3) - 1) * jitter;
          const e0 = j * S + (2 * unit(gen, 4) - 1) * jitter;
          const dn = n0 + vN * (T - birth) - north;
          const de = e0 + vE * (T - birth) - east;
          if (dn * dn + de * de >= reach * reach) continue;
          const c = this.candidates[this.count] ?? (this.candidates[this.count] = makeCandidate());
          this.count++;
          c.id = gen & 0x3fffffff;
          c.north0 = n0;
          c.east0 = e0;
          c.birth = birth;
          c.life = life;
          c.exist = exist;
          c.radiusFull = RADIUS_MIN_M + (RADIUS_MAX_M - RADIUS_MIN_M) * unit(gen, 5);
          c.intensity = (INTENSITY_MIN + (1 - INTENSITY_MIN) * unit(gen, 6)) * (0.5 + 0.5 * act);
          const ceiling = Math.max(base + MIN_CELL_DEPTH_M, Math.min(TOP_CEILING_M, this.bEl + OVERSHOOT_M));
          const topMax = base + (ceiling - base) * (0.6 + 0.4 * act) * (0.8 + 0.2 * unit(gen, 7));
          c.topSpan = Math.max(topMax, base + MIN_CELL_DEPTH_M) - base;
        }
      }
    }
  }

  /** The selection among the candidates at (north, east): up to MAX_STORMS by score, with their weights. */
  private choose(w: WeatherSettings, t: number, north: number, east: number): readonly ActiveStorm[] {
    const K = MAX_STORMS + 1;
    const idx = this.topIdx;
    const sc = this.topScore;
    const dist = this.topDist;
    let found = 0;
    const T = this.clock;
    const steer = stormSteering(w, this.steer);
    const kt = steer.kt;
    const from = steer.fromDeg * DEG;
    if (T !== this.evalClock) {
      // The candidates at the current clock (the wind is a key of the list: build() follows its change).
      this.evalClock = T;
      const speed = kt * KT;
      const vN = -Math.cos(from) * speed;
      const vE = -Math.sin(from) * speed;
      for (let k = 0; k < this.count; k++) {
        const c = this.candidates[k];
        const age = T - c.birth;
        if (!(age > 0 && age < c.life)) {
          c.age = NaN;
          continue;
        }
        c.age = age;
        c.north = c.north0 + vN * age;
        c.east = c.east0 + vE * age;
        const a = age / c.life;
        c.core = smoothstep(0, 0.1, a) * (1 - smoothstep(0.7, 0.95, a));
        c.anvil = smoothstep(0.2, 0.4, a) * (1 - smoothstep(0.85, 1, a));
      }
    }
    for (let k = 0; k < this.count; k++) {
      const c = this.candidates[k];
      if (!(c.age > 0)) continue;
      const dn = c.north - north;
      const de = c.east - east;
      const d2 = dn * dn + de * de;
      if (d2 >= FADE_END_M * FADE_END_M) continue;
      const d = Math.sqrt(d2);
      const s = c.exist * Math.max(c.core, c.anvil) * (1 - d / FADE_END_M);
      if (!(s > 0)) continue;
      // Insert into the descending top-K (ties: the lower id first, so the order does not depend on the scan).
      let pos = found < K ? found : K;
      while (pos > 0 && (sc[pos - 1] < s || (sc[pos - 1] === s && this.candidates[idx[pos - 1]].id > c.id))) pos--;
      if (pos >= K) continue;
      for (let m = Math.min(found, K - 1); m > pos; m--) {
        idx[m] = idx[m - 1];
        sc[m] = sc[m - 1];
        dist[m] = dist[m - 1];
      }
      idx[pos] = k;
      sc[pos] = s;
      dist[pos] = d;
      if (found < K) found++;
    }
    // Rank fade against the first cell left out (score sOut, 0 with fewer candidates), over a margin set by the
    // second-lowest selected cell (0 when missing), so that normally only the lowest selected cell fades.
    const sOut = found === K ? sc[K - 1] : 0;
    const sPrev = found >= MAX_STORMS - 1 ? sc[MAX_STORMS - 2] : 0;
    const margin = clamp(sPrev - sOut, RANK_MARGIN_MIN, RANK_MARGIN);
    const list = this.list;
    list.length = 0;
    const travel = kt * KT * t;
    const base = w.cloudBaseM;
    for (let m = 0; m < Math.min(found, MAX_STORMS); m++) {
      const c = this.candidates[idx[m]];
      const weight = c.exist * (1 - smoothstep(FADE_START_M, FADE_END_M, dist[m])) * clamp((sc[m] - sOut) / margin, 0, 1);
      if (!(weight > 0)) continue;
      const a = this.active[list.length];
      const f = c.age / c.life;
      const grow = smoothstep(0, GROWTH_END, f);
      // Anchored so that stormCentreAt(a, t) is the candidate's position at the current clock.
      a.northM = c.north + Math.cos(from) * travel;
      a.eastM = c.east + Math.sin(from) * travel;
      a.radiusM = c.radiusFull * (0.6 + 0.4 * grow);
      a.topM = base + Math.max(MIN_GROWING_DEPTH_M, c.topSpan * (0.3 + 0.7 * grow));
      a.intensity = c.intensity;
      a.motionDeg = steer.fromDeg;
      a.motionKt = kt;
      a.lightning = undefined;
      a.id = c.id;
      a.derived = true;
      a.weight = weight;
      a.core = weight * c.core;
      a.anvil = weight * c.anvil;
      a.rain = weight * (smoothstep(0.25, 0.4, f) * (1 - smoothstep(0.7, 0.9, f)));
      a.flash = weight * (smoothstep(0.3, 0.4, f) * (1 - smoothstep(0.65, 0.8, f)));
      a.wind = weight * (smoothstep(0.05, 0.3, f) * (1 - smoothstep(0.75, 0.95, f)));
      list.push(a);
    }
    return list;
  }
}

/** A share of a cell as the consumers read it: the ActiveStorm field, or 1 for a plain StormCell. */
export function stormShare(cell: StormCell, key: 'weight' | 'core' | 'anvil' | 'rain' | 'flash' | 'wind'): number {
  const v = (cell as Partial<ActiveStorm>)[key];
  return v === undefined ? 1 : v;
}
