// Winds aloft: the free-atmosphere wind F(z) above the boundary layer, derived from the surface wind, the date and a
// climatological shear, or set by manual levels (WeatherSettings.windsAloft). Node-safe; no allocation after
// construction. See docs/weather.md "Winds aloft".
//
// Derived profile, z in m MSL:
//   G0 = the gradient wind: the 10 m wind times gradientWindFactor (boundaryLayer.ts), veered by SURFACE_BACKING.
//   F(z) = G0 + T Phi(z), T the shear vector (1/s), Phi(z) (m) a C1 shape that is 0 up to z0 = field elevation +
//   PROFILE_BASE_AGL_M, grows linearly to the jet, turns over and falls to a constant residual in the stratosphere.
//   T = baroclinic part + barotropic part:
//     baroclinic: thermal wind toward the east (westerlies aloft) S_bc = g Gamma_y / (f T_m), Gamma_y the
//       meridional temperature gradient (larger in winter), times an activity factor q that is ACTIVITY_CALM in calm
//       air and grows with the surface wind (owner decision: winds aloft exist over a calm surface);
//     barotropic: |G0| / BAROTROPIC_DEPTH along the gradient wind (0 in calm air).
//   The isaDeviation does not enter the wind profile.
// Manual levels: the difference between each level's wind and the derived wind at its altitude, in (north, east)
// components, is interpolated linearly in z between the levels, from 0 at z0, constant above the top level. Levels
// at or below z0 + MANUAL_MIN_ABOVE_BASE_M are ignored. An empty table means no shear: F = G0 at every height.

import { DEG, FT, KT } from '../../core/math';
import type { WeatherSettings, WindAloftLevel } from '../../core/types';
import { windsAloftOf } from '../../core/weatherFields';
import { AIRPORT } from '../../core/world';
import { geopotentialAltitude, isaTemperature, temperatureProfile, type TemperatureProfile } from '../atmosphere';
import { gradientWindFactor, windSpeedFactor, windVeer } from './boundaryLayer';

/** Veer of the gradient wind from the 10 m wind (boundaryLayer.ts SURFACE_BACKING), rad. */
const GRADIENT_VEER = 25 * DEG;
/** The free-atmosphere shear starts this far above the field elevation, m. */
export const PROFILE_BASE_AGL_M = 600;
/** Depth over which the shear ramps in above z0 (Phi quadratic), m. Unconfirmed. */
const BASE_RAMP_M = 300;
/** Jet level, m MSL; half depth of the shear reversal around it, m; reversed shear above as a share of the lower. Unconfirmed. */
const JET_ALT_M = 10_500;
const JET_HALF_DEPTH_M = 1500;
const JET_REVERSAL = 0.6;
/** Stratospheric residual of Phi as a share of Phi at the jet. Unconfirmed. */
const JET_RESIDUAL = 0.35;
/** Earth rotation rate, rad/s. */
const OMEGA_EARTH = 7.292e-5;
/** Mean temperature of the troposphere in the thermal-wind relation, K. Unconfirmed. */
const MEAN_TROPOSPHERE_T = 255;
/** Meridional temperature gradient, K/m: annual mean and amplitude (largest mid-January). Unconfirmed (3-8 K per 1000 km). */
const GRADIENT_MEAN = 5.5e-6;
const GRADIENT_AMPLITUDE = 2.5e-6;
const GRADIENT_PEAK_DAY = 15;
/** Activity factor of the baroclinic shear: q = ACTIVITY_CALM + ACTIVITY_GAIN |G0| / (|G0| + ACTIVITY_SCALE). Unconfirmed tuning. */
const ACTIVITY_CALM = 0.6;
const ACTIVITY_GAIN = 0.8;
const ACTIVITY_SCALE = 8;
/** Barotropic shear |G0| / BAROTROPIC_DEPTH along the gradient wind, m. Unconfirmed. */
const BAROTROPIC_DEPTH = 8000;
/** Manual levels this close above z0 or lower are ignored, m. */
const MANUAL_MIN_ABOVE_BASE_M = 100;
const G = 9.80665;

/** A horizontal wind vector: the direction the air moves TOWARD, NED m/s. */
export interface WindNE {
  north: number;
  east: number;
}

/** Base of the free-atmosphere shear, m MSL. */
export const PROFILE_BASE_M = AIRPORT.elevation + PROFILE_BASE_AGL_M;

const JET_LOW = JET_ALT_M - JET_HALF_DEPTH_M;
const PHI_LOW = JET_LOW - PROFILE_BASE_M - BASE_RAMP_M / 2;
const REVERSAL_DEPTH = JET_HALF_DEPTH_M * (1 + JET_REVERSAL);
const PHI_HIGH = PHI_LOW + REVERSAL_DEPTH - (REVERSAL_DEPTH * REVERSAL_DEPTH) / (2 * JET_HALF_DEPTH_M);
const PHI_JET = PHI_LOW + JET_HALF_DEPTH_M / 2;
const PHI_TOP = JET_RESIDUAL * PHI_JET;
const JET_HIGH = JET_LOW + REVERSAL_DEPTH;
const RESIDUAL_ALT = JET_HIGH + (PHI_HIGH - PHI_TOP) / JET_REVERSAL;

/** The shape of the derived shear, m: 0 at and below PROFILE_BASE_M, C1 up to the stratospheric residual. */
export function shearShape(z: number): number {
  const s = z - PROFILE_BASE_M;
  if (s <= 0) return 0;
  if (s < BASE_RAMP_M) return (s * s) / (2 * BASE_RAMP_M);
  if (z < JET_LOW) return s - BASE_RAMP_M / 2;
  if (z < JET_HIGH) {
    const a = z - JET_LOW;
    return PHI_LOW + a - (a * a) / (2 * JET_HALF_DEPTH_M);
  }
  if (z < RESIDUAL_ALT) return PHI_HIGH - JET_REVERSAL * (z - JET_HIGH);
  return PHI_TOP;
}

/** Coriolis parameter at the airport latitude, 1/s. */
export const CORIOLIS = 2 * OMEGA_EARTH * Math.sin(AIRPORT.latitudeDeg * DEG);

/** The thermal-wind shear for a day of the year before the activity factor, 1/s. */
export function baroclinicShear(dayOfYear: number): number {
  const gradient = GRADIENT_MEAN + GRADIENT_AMPLITUDE * Math.cos((2 * Math.PI * (dayOfYear - GRADIENT_PEAK_DAY)) / 365);
  return (G * gradient) / (CORIOLIS * MEAN_TROPOSPHERE_T);
}

/**
 * The free-atmosphere wind profile of one WeatherSettings. update(w) re-derives it when the surface wind, the day
 * or the windsAloft array (identity) changed; freeWind(z, out) is allocation-free.
 */
export class AloftProfile {
  /** Gradient wind G0, toward, m/s. */
  g0N = 0;
  g0E = 0;
  /** Shear vector T, 1/s. */
  private tN = 0;
  private tE = 0;
  /** True when F = G0 at every height (windsAloft: []). */
  private none = false;
  /** Manual anomalies: altitudes (m MSL, ascending) and the (north, east) difference from the derived wind. */
  private readonly levelZ = new Float64Array(16);
  private readonly levelN = new Float64Array(16);
  private readonly levelE = new Float64Array(16);
  private levels = 0;
  private kDir = NaN;
  private kSpeed = NaN;
  private kDay = NaN;
  private kTable: readonly WindAloftLevel[] | undefined | null = null;
  /** Bumped on every re-derivation (a cache key for consumers). */
  version = 0;

  /** Re-derive when the inputs changed; returns this. */
  update(w: WeatherSettings): this {
    const table = windsAloftOf(w);
    if (w.windDirectionDeg === this.kDir && w.windSpeedKt === this.kSpeed && w.dayOfYear === this.kDay && table === this.kTable) return this;
    this.kDir = w.windDirectionDeg;
    this.kSpeed = w.windSpeedKt;
    this.kDay = w.dayOfYear;
    this.kTable = table;
    this.version++;
    const g = Math.max(0, w.windSpeedKt) * KT * gradientWindFactor;
    const from = w.windDirectionDeg * DEG + GRADIENT_VEER;
    this.g0N = -g * Math.cos(from);
    this.g0E = -g * Math.sin(from);
    this.none = table !== undefined && table.length === 0;
    const q = ACTIVITY_CALM + (ACTIVITY_GAIN * g) / (g + ACTIVITY_SCALE);
    // Thermal wind toward the east, plus the barotropic part along G0 (|G0| / depth times the unit vector).
    this.tN = this.g0N / BAROTROPIC_DEPTH;
    this.tE = q * baroclinicShear(w.dayOfYear) + this.g0E / BAROTROPIC_DEPTH;
    this.levels = 0;
    if (table && table.length > 0) {
      for (const l of table) {
        const z = l.altFt * FT;
        if (z <= PROFILE_BASE_M + MANUAL_MIN_ABOVE_BASE_M || this.levels >= this.levelZ.length) continue;
        const phi = shearShape(z);
        const a = l.dirDeg * DEG;
        const s = l.kt * KT;
        this.levelZ[this.levels] = z;
        this.levelN[this.levels] = -s * Math.cos(a) - (this.g0N + this.tN * phi);
        this.levelE[this.levels] = -s * Math.sin(a) - (this.g0E + this.tE * phi);
        this.levels++;
      }
    }
    return this;
  }

  /** True when F(z) = G0 exactly (below the shear base, or no shear at all). */
  isGradient(z: number): boolean {
    return this.none || z <= PROFILE_BASE_M;
  }

  /** The free-atmosphere wind at z m MSL (manual levels applied), toward, m/s, into `out`. */
  freeWind(z: number, out: WindNE): WindNE {
    if (this.isGradient(z)) {
      out.north = this.g0N;
      out.east = this.g0E;
      return out;
    }
    const phi = shearShape(z);
    out.north = this.g0N + this.tN * phi;
    out.east = this.g0E + this.tE * phi;
    const n = this.levels;
    if (n > 0) {
      let i = 0;
      while (i < n && this.levelZ[i] < z) i++;
      if (i === n) {
        out.north += this.levelN[n - 1];
        out.east += this.levelE[n - 1];
      } else {
        const z0 = i === 0 ? PROFILE_BASE_M : this.levelZ[i - 1];
        const n0 = i === 0 ? 0 : this.levelN[i - 1];
        const e0 = i === 0 ? 0 : this.levelE[i - 1];
        const f = (z - z0) / (this.levelZ[i] - z0);
        out.north += n0 + (this.levelN[i] - n0) * f;
        out.east += e0 + (this.levelE[i] - e0) * f;
      }
    }
    return out;
  }

  /** The derived wind at z m MSL ignoring the manual levels (the menu's placeholders), into `out`. */
  derivedWind(z: number, out: WindNE): WindNE {
    const phi = this.none ? 0 : shearShape(z);
    out.north = this.g0N + this.tN * phi;
    out.east = this.g0E + this.tE * phi;
    return out;
  }
}

const shared = new AloftProfile();

/** The free-atmosphere wind of `w` at z m MSL, toward, m/s (for the menu, clouds, storms and training). */
export function windAloftAt(w: WeatherSettings, zMSL: number, out: WindNE): WindNE {
  return shared.update(w).freeWind(zMSL, out);
}

/** The derived free-atmosphere wind of `w` at z m MSL ignoring manual levels (an empty table still gives G0). */
export function derivedWindAloftAt(w: WeatherSettings, zMSL: number, out: WindNE): WindNE {
  return shared.update(w).derivedWind(zMSL, out);
}

/**
 * The steady mean wind of windField.ts without terrain terms at `agl` m above the ground and z m MSL: the boundary
 * layer of the setting plus the share of F(z) - G0 the boundary layer carries (for consumers that need the wind at a
 * height without a WindField, e.g. a lesson's nav log). Toward, m/s.
 */
export function meanWindAt(w: WeatherSettings, zMSL: number, agl: number, out: WindNE): WindNE {
  const p = shared.update(w);
  const veer = windVeer(agl);
  const profile = windSpeedFactor(agl);
  const from = w.windDirectionDeg * DEG + veer;
  const U = Math.max(0, w.windSpeedKt) * KT * profile;
  let n = -U * Math.cos(from);
  let e = -U * Math.sin(from);
  if (!p.isGradient(zMSL)) {
    const f = p.freeWind(zMSL, _mean);
    const dN = f.north - p.g0N;
    const dE = f.east - p.g0E;
    const share = profile / gradientWindFactor;
    const beta = GRADIENT_VEER - veer;
    n += share * (dN * Math.cos(beta) + dE * Math.sin(beta));
    e += share * (-dN * Math.sin(beta) + dE * Math.cos(beta));
  }
  out.north = n;
  out.east = e;
  return out;
}

const _mean: WindNE = { north: 0, east: 0 };

/** Direction a wind vector blows FROM, deg in [0, 360). */
export function windFromDeg(v: WindNE): number {
  const d = Math.atan2(-v.east, -v.north) / DEG;
  return d < 0 ? d + 360 : d;
}

/** Speed of a wind vector, kt. */
export function windKt(v: WindNE): number {
  return Math.hypot(v.north, v.east) / KT;
}

let profileTable: readonly WindAloftLevel[] | undefined | null = null;
let profileDev = NaN;
let profileValue: TemperatureProfile | undefined;

/**
 * The temperature profile of the manual levels that carry tempC: nodes at the field elevation (isaDeviation) and
 * at each such level (its temperature minus ISA). undefined when no level has a temperature (the uniform
 * deviation applies). Cached on the table identity and the deviation.
 */
export function temperatureProfileOf(w: WeatherSettings): TemperatureProfile | undefined {
  const table = windsAloftOf(w);
  if (table === profileTable && w.isaDeviation === profileDev) return profileValue;
  profileTable = table;
  profileDev = w.isaDeviation;
  profileValue = undefined;
  if (!table || !table.some((l) => l.tempC !== undefined)) return undefined;
  const H = [geopotentialAltitude(AIRPORT.elevation)];
  const dT = [w.isaDeviation];
  for (const l of table) {
    if (l.tempC === undefined) continue;
    const h = geopotentialAltitude(l.altFt * FT);
    if (h <= H[H.length - 1]) continue;
    H.push(h);
    dT.push(l.tempC + 273.15 - isaTemperature(h));
  }
  profileValue = temperatureProfile(H, dT);
  return profileValue;
}
