// The air-mass velocity field: steady boundary-layer wind + discrete gusts + Dryden continuous turbulence +
// orographic up/down-draughts + convective thermals. Reads the live WeatherSettings object on every call,
// and is deterministic for a given seed and settings history.

import { DEG, KT, clamp, smoothstep, type Vec3 } from '../../core/math';
import type { WeatherSettings } from '../../core/types';
import { sunDirectionNED } from '../../core/world';
import { windSpeedFactor, windVeer } from './boundaryLayer';
import { gustAt, type GustSample } from './gusts';
import { hashU32 } from './random';
import { SmoothedTerrain, type TerrainSample } from './terrainSampler';
import { thermalUpdraft } from './thermals';
import { milTurbulenceIntensity, SpectralTurbulence, type TurbulenceIntensity } from './turbulence';

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
/** Past a record-length backward time jump (a reset), the advection restarts from t = 0. */
const TIME_RESET = 1;

/** Contributions to the wind at one point, for diagnostics and tests. */
export interface WindBreakdown {
  /** Steady boundary-layer wind, NED m/s. */
  mean: Vec3;
  /** Discrete gust, NED m/s. */
  gust: Vec3;
  /** Continuous turbulence in wind axes (u along the mean wind, v to its right, w up), m/s. */
  turbulence: { u: number; v: number; w: number };
  /** Orographic vertical velocity, m/s (+ up). */
  orographic: number;
  /** Thermal vertical velocity, m/s (+ up). */
  thermal: number;
  /** Height above the smoothed terrain used by the profiles, m. */
  heightAGL: number;
  intensity: TurbulenceIntensity;
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
  private readonly gust: GustSample = { speed: 0, angle: 0 };
  private readonly parts: WindBreakdown = {
    mean: { x: 0, y: 0, z: 0 },
    gust: { x: 0, y: 0, z: 0 },
    turbulence: { u: 0, v: 0, w: 0 },
    orographic: 0,
    thermal: 0,
    heightAGL: 0,
    intensity: { sigmaU: 0, sigmaV: 0, sigmaW: 0, lengthU: 0, lengthV: 0, lengthW: 0 },
  };

  constructor(
    private readonly weather: WeatherSettings,
    terrainHeight: (north: number, east: number) => number,
    readonly seed = 1,
  ) {
    this.terrain = new SmoothedTerrain(terrainHeight);
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
    const from = w.windDirectionDeg * DEG + windVeer(agl);
    const toN = -Math.cos(from);
    const toE = -Math.sin(from);
    const profile = windSpeedFactor(agl);
    const U = u10 * profile;
    parts.mean.x = U * toN;
    parts.mean.y = U * toE;

    // Discrete gusts, sheared like the mean wind.
    const g = gustAt(this.gustSeed, t, Math.max(0, w.gustKt - w.windSpeedKt) * KT, this.gust);
    const gs = g.speed * profile;
    parts.gust.x = -gs * Math.cos(from + g.angle);
    parts.gust.y = -gs * Math.sin(from + g.angle);

    // Continuous turbulence; mechanical turbulence grows with the surface wind and the terrain slope.
    const slope = Math.hypot(ter.slopeNorth, ter.slopeEast);
    const roughness = 1 + Math.min(1, SLOPE_ROUGHNESS * slope);
    const I = milTurbulenceIntensity(agl, w.turbulence, u10 * windSpeedFactor(W20_HEIGHT) * roughness, parts.intensity);
    const tb = parts.turbulence;
    this.turbulence.sample(p.x - this.driftN, p.y - this.driftE, p.z, t, I, tb);
    tb.w *= Math.min(1, agl / W_GROUND_SCALE);

    // Flow over terrain: the surface wind follows the slope, w = V . grad(h).
    const lift = (parts.mean.x * ter.slopeNorth + parts.mean.y * ter.slopeEast) * Math.exp(-agl / OROGRAPHIC_DEPTH);
    parts.orographic = clamp(lift, -OROGRAPHIC_MAX, OROGRAPHIC_MAX);

    const zi = Math.max(MIN_CONVECTIVE_DEPTH, w.cloudBaseM - ter.height);
    parts.thermal = thermalUpdraft(this.thermalSeed, p.x - this.driftN, p.y - this.driftE, agl, t, this.convectiveVelocity(u10), zi);

    const up = tb.w + parts.orographic + parts.thermal;
    out.x = parts.mean.x + parts.gust.x + tb.u * toN - tb.v * toE;
    out.y = parts.mean.y + parts.gust.y + tb.u * toE + tb.v * toN;
    out.z = -up;
    return out;
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
      thermal: b.thermal,
      heightAGL: b.heightAGL,
      intensity: { ...b.intensity },
    };
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
