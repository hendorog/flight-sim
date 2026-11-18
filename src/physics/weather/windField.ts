// The air-mass velocity field: steady boundary-layer wind (with the winds aloft above it, windsAloft.ts) + discrete gusts + Dryden continuous turbulence +
// orographic up/down-draughts + convective thermals + cumulonimbus cells (convection.ts; the cells in effect at the
// sample point from stormField.ts: WeatherSettings.storms when present, else the cells derived from the conditions).
// Reads the live WeatherSettings object on every call, and is deterministic for a given seed and settings history.
// Without storm cells at the point (storms empty, or no derived cell within its selection range) the convective
// branch is skipped and the arithmetic is that of the field before the cells existed.

import { DEG, KT, clamp, smoothstep, type Vec3 } from '../../core/math';
import type { WeatherSettings } from '../../core/types';
import { mountainWavesOf } from '../../core/weatherFields';
import { sunDirectionNED } from '../../core/world';
import { gradientWindFactor, windSpeedFactor, windVeer } from './boundaryLayer';
import { cbSample, cbSeverity, emptyCbSample, type CbSample } from './convection';
import { gustAt, type GustSample } from './gusts';
import { hashU32 } from './random';
import { StormField, type ActiveStorm } from './stormField';
import { SmoothedTerrain, type TerrainSample } from './terrainSampler';
import { thermalUpdraft } from './thermals';
import { milTurbulenceIntensity, SpectralTurbulence, type TurbulenceIntensity } from './turbulence';
import { AloftProfile, type WindNE } from './windsAloft';
import { channelDelta, channelDepth } from './orography/channel';
import { emptyOrographySample, OrographyField, type HeightFn, type OrographySample } from './orography/orographyField';
import { shelterShare } from './orography/shelter';
import { siteMask, type ReferenceSite } from './orography/sites';
import { SlopeWindSky, slopeWindAt, type SlopeWindSample } from './orography/slopeWind';
import { convectiveWaveFactor } from './stability';

/** The log profile is evaluated no lower than this, m. */
const MIN_HEIGHT = 0.3;
/** MIL-F-8785C W20 reference height (20 ft), m. */
const W20_HEIGHT = 6.1;
/** Vertical gusts vanish at the ground (impermeable surface); full strength from 10 ft up, m. */
const W_GROUND_SCALE = 3.05;
/** The turbulence field and the thermals drift with the wind at this height, m. */
const ADVECTION_HEIGHT = 100;
/** Orographic lift w = V . grad(h) decays with height above the terrain over this scale, m, and is capped. */
const OROGRAPHIC_DEPTH = 300;
const OROGRAPHIC_MAX = 4;
/** Terrain slope multiplies mechanical turbulence by up to 2x (flow separation over rough ground). */
const SLOPE_ROUGHNESS = 4;
/** Convective velocity scale w* on a strong thermal day, m/s. */
const CONVECTIVE_MAX = 2.2;
/** Minimum convective layer depth, m. */
const MIN_CONVECTIVE_DEPTH = 300;
/** Wave breaking: the perturbations are limited by tanh(b / BREAK_SCALE) / (b / BREAK_SCALE) for b > 0. Unconfirmed. */
const BREAK_SCALE = 0.8;
/** Vertical wave speed limit: W_LIMIT tanh(w / W_LIMIT), m/s. Unconfirmed. */
const W_LIMIT = 12;
/** Rotor / breaking turbulence severity: BREAK_SEVERITY smoothstep(0.5, 1, b). Unconfirmed. */
const BREAK_SEVERITY = 0.9;
/** Baseline of the terrain gradient for the slope winds, m. */
const SLOPE_WIND_BASELINE = 200;
/** Slope winds are not evaluated above this height AGL, m (the profile is under 1e-8 m/s there). */
const SLOPE_WIND_TOP = 1500;
/** Lee shelter: share of the wind removed deep in the wake (orography/shelter.ts SHELTER_DEPTH). */
const SHELTER_DEPTH = 0.6;
/** Veer of the gradient wind from the 10 m wind (boundaryLayer.ts), rad. */
const SURFACE_BACKING = 25 * DEG;
/** Past a record-length backward time jump (a reset), the advection restarts from t = 0. */
const TIME_RESET = 1;

/**
 * The convective state the thermals are drawn from (WindField.thermalFrame; read-only, for the wildlife that
 * soars in them). thermalUpdraft(seed, north - driftN, east - driftE, agl, t, wStar, zi(ground)) is the
 * thermal part of sample() at a point.
 */
export interface ThermalFrame {
  seed: number;
  /** Advection displacement of the thermal field, NED m (as of the last sample()). */
  driftN: number;
  driftE: number;
  /** Convective velocity scale w*, m/s (0 at night, under overcast or in strong wind). */
  wStar: number;
  /** Cloud base MSL, m: the convective layer depth over ground at h is max(minDepth, cloudBaseM - h). */
  cloudBaseM: number;
  minDepth: number;
}

/** Contributions to the wind at one point, for diagnostics and tests. */
export interface WindBreakdown {
  /** Steady boundary-layer wind, NED m/s. */
  mean: Vec3;
  /** Discrete gust, NED m/s. */
  gust: Vec3;
  /** Continuous turbulence in wind axes (u along the mean wind, v to its right, w up), m/s. */
  turbulence: { u: number; v: number; w: number };
  /** Orographic vertical velocity of the fine terrain, V . grad(h) near the ground, m/s (+ up). */
  orographic: number;
  /**
   * Mountain-wave contribution (orography/): horizontal speed-up north and east (boundary-layer share and site mask
   * applied) and the vertical velocity (blended in above the ground), m/s; after the breaking limiter and the gain.
   */
  wave: Vec3;
  /** Slope wind (anabatic / katabatic) north, east and up (+ up), m/s. */
  slope: Vec3;
  /** Lee-shelter speed factor applied to the mean wind (1 = none). */
  shelter: number;
  /** Turbulence severity from wave breaking and rotors, 0..1. */
  waveSeverity: number;
  /** Thermal vertical velocity, m/s (+ up). */
  thermal: number;
  /** Storm cells: vertical velocity (m/s, + up) and horizontal outflow (NED m/s); all 0 without cells. */
  convective: { up: number; outN: number; outE: number };
  /** Height above the smoothed terrain used by the profiles, m. */
  heightAGL: number;
  intensity: TurbulenceIntensity;
}

export interface WindFieldOptions {
  /** Terrain the orography tiles sample (default: the terrainHeight argument). */
  orographyTerrain?: HeightFn;
  /** Fields where the horizontal terrain terms vanish (orography/sites.ts); a function is read on every sample. */
  referenceSites?: readonly ReferenceSite[] | (() => readonly ReferenceSite[]);
}

export class WindField {
  private readonly terrain: SmoothedTerrain;
  private readonly turbulence: SpectralTurbulence;
  private readonly gustSeed: number;
  private readonly thermalSeed: number;
  /** Advection displacement of the turbulence/thermal field, NED m. */
  private driftN = 0;
  private driftE = 0;
  private lastTime: number | null = null;
  private sunTime = NaN;
  private sunDay = NaN;
  private sunElevationSin = 0;

  private readonly ter: TerrainSample = { height: 0, slopeNorth: 0, slopeEast: 0 };
  /** The free-atmosphere wind profile (windsAloft.ts), re-derived when the settings change. */
  readonly aloft = new AloftProfile();
  private readonly free: WindNE = { north: 0, east: 0 };
  private readonly gust: GustSample = { speed: 0, angle: 0 };
  private readonly cb: CbSample = emptyCbSample();
  /** The storm cells in effect at a point (explicit or derived); shared by sample, stormTurbulence and stormCells. */
  private readonly storms = new StormField();
  private readonly parts: WindBreakdown = {
    mean: { x: 0, y: 0, z: 0 },
    gust: { x: 0, y: 0, z: 0 },
    turbulence: { u: 0, v: 0, w: 0 },
    orographic: 0,
    wave: { x: 0, y: 0, z: 0 },
    slope: { x: 0, y: 0, z: 0 },
    shelter: 1,
    waveSeverity: 0,
    thermal: 0,
    convective: { up: 0, outN: 0, outE: 0 },
    heightAGL: 0,
    intensity: { sigmaU: 0, sigmaV: 0, sigmaW: 0, lengthU: 0, lengthV: 0, lengthW: 0 },
  };

  /** Terrain waves, shelter and channelling (orography/); slope winds. */
  readonly orography: OrographyField;
  private readonly sites: readonly ReferenceSite[] | (() => readonly ReferenceSite[]);
  private readonly oro: OrographySample = emptyOrographySample();
  private readonly slopeSky = new SlopeWindSky();
  private readonly slopeOut: SlopeWindSample = { north: 0, east: 0, up: 0 };
  private readonly grad: TerrainSample = { height: 0, slopeNorth: 0, slopeEast: 0 };
  private readonly chan = new Float64Array(2);
  private skyTime = NaN;
  private skyDay = NaN;
  private skyCover = NaN;

  constructor(
    private readonly weather: WeatherSettings,
    terrainHeight: (north: number, east: number) => number,
    readonly seed = 1,
    options: WindFieldOptions = {},
  ) {
    this.terrain = new SmoothedTerrain(terrainHeight);
    this.orography = new OrographyField(options.orographyTerrain ?? terrainHeight);
    this.sites = options.referenceSites ?? [];
    this.turbulence = new SpectralTurbulence(hashU32(seed ^ 0x7475726b));
    this.gustSeed = hashU32(seed ^ 0x67757374);
    this.thermalSeed = hashU32(seed ^ 0x7468726d);
  }

  /**
   * Restart the advection of the turbulence and thermal field for a new flight whose clock starts again at 0
   * (a scenario reset): the same scenario then meets the same air, whatever flew before it.
   */
  reset(): void {
    this.lastTime = null;
    this.driftN = this.driftE = 0;
    this.orography.reset();
  }

  /** Air-mass velocity at a point, NED m/s. */
  sample(p: Vec3, t: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
    const w = this.weather;
    const parts = this.parts;
    this.advect(t);
    const ter = this.terrain.sample(p.x, p.y, this.ter);
    const agl = Math.max(MIN_HEIGHT, -p.z - ter.height);
    parts.heightAGL = agl;

    // Steady wind: log profile and Ekman veer. `to` is the unit vector the wind blows toward.
    const u10 = Math.max(0, w.windSpeedKt) * KT;
    const veer = windVeer(agl);
    const from = w.windDirectionDeg * DEG + veer;
    const toN = -Math.cos(from);
    const toE = -Math.sin(from);
    const profile = windSpeedFactor(agl);
    const U = u10 * profile;
    parts.mean.x = U * toN;
    parts.mean.y = U * toE;
    // Winds aloft: above the shear base the free-atmosphere wind F(z) (by MSL altitude) differs from the gradient
    // wind G0; the boundary layer carries the difference with the same speed share s = profile / gradientWindFactor
    // and backing beta = 25 deg - veer as the gradient wind itself, so far above the ground the mean wind is F(z).
    // Below the base (or with windsAloft: []) F = G0 and nothing is added.
    const aloft = this.aloft.update(w);
    const altitude = -p.z;
    let mechanicalWind = u10;
    if (!aloft.isGradient(altitude)) {
      const f = aloft.freeWind(altitude, this.free);
      const dN = f.north - aloft.g0N;
      const dE = f.east - aloft.g0E;
      const share = profile / gradientWindFactor;
      // Rotating a vector's FROM direction by -beta: (n, e) -> (n cos b + e sin b, -n sin b + e cos b).
      const beta = SURFACE_BACKING - veer;
      const cb = Math.cos(beta);
      const sb = Math.sin(beta);
      parts.mean.x += share * (dN * cb + dE * sb);
      parts.mean.y += share * (-dN * sb + dE * cb);
      // Mechanical turbulence sees the local equivalent 10 m wind of the free-atmosphere wind.
      mechanicalWind = Math.hypot(f.north, f.east) / gradientWindFactor;
    }

    // Terrain: mountain waves (with the breaking limiter), lee shelter, valley channelling and slope winds, all
    // times the mountainWaves gain (0 skips them: the wind of a flat world). The horizontal terms vanish at the
    // reference sites (the airfields keep the set wind).
    const wv = parts.wave;
    const sl = parts.slope;
    wv.x = wv.y = wv.z = 0;
    sl.x = sl.y = sl.z = 0;
    parts.shelter = 1;
    parts.waveSeverity = 0;
    let shelter = 0;
    const gain = mountainWavesOf(w);
    if (gain > 0) {
      const oro = this.orography;
      oro.update(w, t);
      const o = oro.sample(p.x, p.y, altitude, t, this.oro);
      const gradient = aloft.isGradient(altitude);
      const freeN = gradient ? aloft.g0N : this.free.north;
      const freeE = gradient ? aloft.g0E : this.free.east;
      const freeSpeed = Math.hypot(freeN, freeE);
      const slopeWinds = this.slopeWindsOn();
      const sites = typeof this.sites === 'function' ? this.sites() : this.sites;
      const terms = o.waveN !== 0 || o.waveE !== 0 || o.shelter !== 0 || o.nn !== 0 || o.ee !== 0 || slopeWinds;
      const mask = sites.length > 0 && terms ? siteMask(sites, p.x, p.y) : 1;
      if (o.waveN !== 0 || o.waveE !== 0 || o.waveW !== 0) {
        const g = gain * convectiveWaveFactor(this.convectiveVelocity(u10));
        // Breaking: b is the share of the background wind the perturbation removes.
        const f2 = freeSpeed * freeSpeed;
        const b = f2 > 0 ? -(o.waveN * freeN + o.waveE * freeE) / f2 : 0;
        const limit = b > 0 ? Math.tanh(b / BREAK_SCALE) / (b / BREAK_SCALE) : 1;
        const share = profile / gradientWindFactor;
        wv.x = o.waveN * limit * g * share * mask;
        wv.y = o.waveE * limit * g * share * mask;
        wv.z = W_LIMIT * Math.tanh((o.waveW * limit) / W_LIMIT) * g * (1 - Math.exp(-agl / OROGRAPHIC_DEPTH));
        parts.waveSeverity = BREAK_SEVERITY * smoothstep(0.5, 1, b) * g;
        parts.mean.x += wv.x;
        parts.mean.y += wv.y;
      }
      const m = mask * gain;
      if (o.shelter > 0 && m > 0) {
        shelter = shelterShare(o.shelter, ter.height, altitude) * m;
        if (shelter > 0) {
          parts.shelter = 1 - SHELTER_DEPTH * shelter;
          parts.mean.x *= parts.shelter;
          parts.mean.y *= parts.shelter;
        }
      }
      if ((o.nn !== 0 || o.ee !== 0) && m > 0) {
        const c = channelDepth(o.envelope, ter.height, altitude) * m;
        if (c > 0) {
          const d = channelDelta(o.nn, o.ne, o.ee, c, parts.mean.x, parts.mean.y, this.chan);
          parts.mean.x += d[0];
          parts.mean.y += d[1];
        }
      }
      if (slopeWinds && m > 0 && agl < SLOPE_WIND_TOP) {
        const gr = this.terrain.gradient(p.x, p.y, SLOPE_WIND_BASELINE, this.grad);
        if (gr.slopeNorth !== 0 || gr.slopeEast !== 0) {
          const s = slopeWindAt(this.slopeSky, gr.slopeNorth, gr.slopeEast, agl, freeSpeed, this.slopeOut);
          sl.x = s.north * m;
          sl.y = s.east * m;
          sl.z = s.up * m;
        }
      }
    }

    // Discrete gusts, sheared like the mean wind.
    const g = gustAt(this.gustSeed, t, Math.max(0, w.gustKt - w.windSpeedKt) * KT, this.gust);
    const gs = g.speed * profile;
    parts.gust.x = -gs * Math.cos(from + g.angle);
    parts.gust.y = -gs * Math.sin(from + g.angle);

    // Storm cells: their wind is added after the sum below, and they raise the turbulence severity near them.
    const cells = this.storms.select(w, t, p.x, p.y);
    const conv = parts.convective;
    let cb: CbSample | null = null;
    let severity = w.turbulence;
    if (parts.waveSeverity > severity) severity = parts.waveSeverity;
    if (cells.length) {
      cb = cbSample(cells, p, t, agl, ter.height, w.cloudBaseM, this.cb);
      if (cb.severity > severity) severity = cb.severity;
      conv.up = cb.up;
      conv.outN = cb.outN;
      conv.outE = cb.outE;
    } else {
      conv.up = conv.outN = conv.outE = 0;
    }

    // Continuous turbulence; mechanical turbulence grows with the surface wind and the terrain slope.
    const slope = Math.hypot(ter.slopeNorth, ter.slopeEast);
    let roughness = 1 + Math.min(1, SLOPE_ROUGHNESS * slope);
    if (shelter > 0) roughness += shelter;
    const I = milTurbulenceIntensity(agl, severity, mechanicalWind * windSpeedFactor(W20_HEIGHT) * roughness, parts.intensity);
    const tb = parts.turbulence;
    this.turbulence.sample(p.x - this.driftN, p.y - this.driftE, p.z, t, I, tb);
    tb.w *= Math.min(1, agl / W_GROUND_SCALE);

    // Flow over terrain: the surface wind follows the slope, w = V . grad(h).
    const lift = (parts.mean.x * ter.slopeNorth + parts.mean.y * ter.slopeEast) * Math.exp(-agl / OROGRAPHIC_DEPTH);
    parts.orographic = clamp(lift, -OROGRAPHIC_MAX, OROGRAPHIC_MAX);

    const zi = Math.max(MIN_CONVECTIVE_DEPTH, w.cloudBaseM - ter.height);
    parts.thermal = thermalUpdraft(this.thermalSeed, p.x - this.driftN, p.y - this.driftE, agl, t, this.convectiveVelocity(u10), zi);

    let up = tb.w + parts.orographic + parts.thermal;
    out.x = parts.mean.x + parts.gust.x + tb.u * toN - tb.v * toE;
    out.y = parts.mean.y + parts.gust.y + tb.u * toE + tb.v * toN;
    if (wv.z !== 0) up += wv.z;
    if (sl.x !== 0 || sl.y !== 0 || sl.z !== 0) {
      out.x += sl.x;
      out.y += sl.y;
      up += sl.z;
    }
    out.z = -up;
    if (cb) {
      out.x += cb.outN;
      out.y += cb.outE;
      out.z -= cb.up;
    }
    return out;
  }

  /** Update the slope-wind sun and sky inputs when the time, day or cover changed; true when slope winds blow. */
  private slopeWindsOn(): boolean {
    const w = this.weather;
    if (w.timeOfDay !== this.skyTime || w.dayOfYear !== this.skyDay || w.cloudCover !== this.skyCover) {
      this.skyTime = w.timeOfDay;
      this.skyDay = w.dayOfYear;
      this.skyCover = w.cloudCover;
      const sun = sunDirectionNED(w.timeOfDay, w.dayOfYear);
      this.slopeSky.set(sun.x, sun.y, sun.z, w.cloudCover);
    }
    return this.slopeSky.day !== 0 || this.slopeSky.night !== 0;
  }

  /** The components of the wind at a point (a copy; for diagnostics and tests). */
  breakdown(p: Vec3, t: number): WindBreakdown {
    this.sample(p, t);
    const b = this.parts;
    return {
      mean: { ...b.mean },
      gust: { ...b.gust },
      turbulence: { ...b.turbulence },
      orographic: b.orographic,
      wave: { ...b.wave },
      slope: { ...b.slope },
      shelter: b.shelter,
      waveSeverity: b.waveSeverity,
      thermal: b.thermal,
      convective: { ...b.convective },
      heightAGL: b.heightAGL,
      intensity: { ...b.intensity },
    };
  }

  /**
   * The thermal field's seed, drift and convective scales as sample() uses them (read-only: it neither advects
   * the field nor changes any state the flight model sees). Writes into `out` when given.
   */
  thermalFrame(out?: ThermalFrame): ThermalFrame {
    const w = this.weather;
    const f = out ?? { seed: 0, driftN: 0, driftE: 0, wStar: 0, cloudBaseM: 0, minDepth: MIN_CONVECTIVE_DEPTH };
    f.seed = this.thermalSeed;
    f.driftN = this.driftN;
    f.driftE = this.driftE;
    f.wStar = this.convectiveVelocity(Math.max(0, w.windSpeedKt) * KT);
    f.cloudBaseM = w.cloudBaseM;
    f.minDepth = MIN_CONVECTIVE_DEPTH;
    return f;
  }

  /**
   * Turbulence severity of the storm cells at a point, 0..1 (0 without cells); the field uses
   * max(weather.turbulence, this). Read-only: it neither advects the field nor changes any state.
   */
  stormTurbulence(p: Vec3, t: number): number {
    const cells = this.storms.select(this.weather, t, p.x, p.y);
    return cells.length ? cbSeverity(cells, p, t) : 0;
  }

  /**
   * The storm cells in effect at NED (north, east) at time t (stormField.ts StormField.select; explicit cells or
   * those derived from the conditions). The array is reused by the next call. Read-only for the wind field.
   */
  stormCells(north: number, east: number, t: number): readonly ActiveStorm[] {
    return this.storms.select(this.weather, t, north, east);
  }

  /** The StormField behind stormCells (shared with the aircraft's weather sample, sim/weather/aircraftWeather.ts). */
  get stormField(): StormField {
    return this.storms;
  }

  /** Convective layer depth zi over ground at `groundM` MSL, m (as sample() computes it). */
  convectiveDepth(groundM: number): number {
    return Math.max(MIN_CONVECTIVE_DEPTH, this.weather.cloudBaseM - groundM);
  }

  /**
   * Convective velocity scale w* from the sun elevation, the cumulus cover (fair-weather cumulus marks good
   * thermals, overcast kills them) and the wind (strong wind shears thermals apart), m/s.
   */
  convectiveVelocity(surfaceWind: number): number {
    const w = this.weather;
    if (w.timeOfDay !== this.sunTime || w.dayOfYear !== this.sunDay) {
      this.sunTime = w.timeOfDay;
      this.sunDay = w.dayOfYear;
      this.sunElevationSin = -sunDirectionNED(w.timeOfDay, w.dayOfYear).z;
    }
    const sun = smoothstep(0.15, 0.6, this.sunElevationSin);
    const cc = w.cloudCover;
    const sky = (0.4 + 0.6 * smoothstep(0.05, 0.3, cc)) * (1 - smoothstep(0.6, 0.9, cc));
    const shear = 1 - smoothstep(8, 15, surfaceWind);
    return CONVECTIVE_MAX * sun * sky * shear;
  }

  /** Integrate the drift of the frozen turbulence/thermal field with the wind at ADVECTION_HEIGHT. */
  private advect(t: number): void {
    const w = this.weather;
    const speed = Math.max(0, w.windSpeedKt) * KT * windSpeedFactor(ADVECTION_HEIGHT);
    const from = w.windDirectionDeg * DEG + windVeer(ADVECTION_HEIGHT);
    const vN = -speed * Math.cos(from);
    const vE = -speed * Math.sin(from);
    if (this.lastTime === null || t < this.lastTime - TIME_RESET) {
      this.driftN = vN * t;
      this.driftE = vE * t;
      this.lastTime = t;
    } else if (t > this.lastTime) {
      this.driftN += vN * (t - this.lastTime);
      this.driftE += vE * (t - this.lastTime);
      this.lastTime = t;
    }
  }
}
