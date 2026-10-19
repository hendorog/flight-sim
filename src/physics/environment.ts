// The Environment handed to the flight model: atmosphere (ISA with the live QNH and temperature deviation),
// the wind field, and the terrain queries forwarded from the world modules.
//
// MOISTURE (for carburettor icing). WeatherSettings has no humidity; it is inferred from the cloud layer. A
// cumulus base sits about 125 m higher per kelvin of dew-point spread at the surface, so the spread at the
// field is (cloudBaseM - field elevation) / 125 K, and it closes with height by the difference of the
// temperature and dew-point lapse rates, (6.5 - 1.8) K per km. Inside the layer (cover >= 0.3) the air is
// saturated. Under a clear sky (cover < 0.05) there is no layer to infer from: the spread is at least 12 K.
// The optional weather fields (core/weatherFields.ts) add saturated air where they are present: inside the ground
// fog layer, inside a storm cell's core, within MID_LAYER_HALF_DEPTH of a mid-level sheet of cover >= 0.3 (all
// inCloud), and below the cloud base in rain or drizzle (spread 0). With the fields absent or neutral none of
// these applies and the result is the one above.

import type { Vec3 } from '../core/math';
import type { Environment, SurfaceType, WeatherSettings } from '../core/types';
import { fogOf, midLayerOf, precipOf, stormsOf, type FogLayer, type MidLayer, type Precip } from '../core/weatherFields';
import { AIRPORT } from '../core/world';
import { atmosphereAt, type AtmosphereConditions } from './atmosphere';
import type { MoistureSample } from './interfaces';
import { inStormCore } from './weather/convection';
import { WindField } from './weather/windField';

/** Terrain queries supplied by the world modules. */
export interface TerrainProvider {
  /** Elevation MSL, m. */
  height(north: number, east: number): number;
  /** Unit up-normal in NED (z < 0). */
  normal(north: number, east: number): Vec3;
  surface(north: number, east: number): SurfaceType;
}

export interface EnvironmentOptions {
  /** The live settings object; mutations (e.g. from the UI) take effect on the next query. */
  weather: WeatherSettings;
  terrain: TerrainProvider;
  /** Seed of the gust, turbulence and thermal fields. */
  seed?: number;
}

/** Height a cumulus base rises per kelvin of surface dew-point spread, m. */
const BASE_RISE_PER_K = 125;
/** Rate at which the spread closes with height: temperature lapse minus dew-point lapse, K/m. */
const SPREAD_LAPSE = (6.5 - 1.8) / 1000;
/** Cloud cover below which the sky counts as clear, and the smallest spread then, K. */
const CLEAR_COVER = 0.05;
const CLEAR_SPREAD = 12;
/** Cloud cover from which an aircraft between base and top is taken to be in cloud. */
const IN_CLOUD_COVER = 0.3;
/** Half the depth of the mid-level sheet for moisture: within this of midAltM is in cloud, m. */
const MID_LAYER_HALF_DEPTH = 150;

export interface SimEnvironment extends Environment {
  /** The wind model, for diagnostics (breakdown of wind components, turbulence intensity). */
  readonly windField: WindField;
  /**
   * Moisture at an altitude from the live WeatherSettings (cloud base/top, cover, temperature; fog, precipitation,
   * mid-level sheet and storm cells when present). The horizontal position (NED m) and the time (s) place the
   * point relative to the storm cells; nothing else depends on them. The returned object is owned by the
   * environment and overwritten by the next call.
   */
  moisture(altitudeMSL: number, north?: number, east?: number, time?: number): MoistureSample;
}

export function createEnvironment({ weather, terrain, seed = 1 }: EnvironmentOptions): SimEnvironment {
  const windField = new WindField(weather, (n, e) => terrain.height(n, e), seed);
  const conditions: AtmosphereConditions = { isaDeviation: 0, seaLevelPressure: 101325 };
  const moisture: MoistureSample = { dewPointSpread: 0, inCloud: false };
  const fog: FogLayer = { topM: 0, visibilityM: 0 };
  const mid: MidLayer = { cover: 0, type: 'altostratus', altM: 0 };
  const precip: Precip = { type: 'none', rateMmH: 0 };
  return {
    windField,
    moisture(altitudeMSL, north = 0, east = 0, time = 0) {
      let inCloud = weather.cloudCover >= IN_CLOUD_COVER && altitudeMSL >= weather.cloudBaseM && altitudeMSL <= weather.cloudTopM;
      if (!inCloud) {
        const f = fogOf(weather, fog);
        const m = midLayerOf(weather, mid);
        const cells = stormsOf(weather);
        inCloud =
          (f.topM > 0 && altitudeMSL - AIRPORT.elevation < f.topM) ||
          (m.cover >= IN_CLOUD_COVER && Math.abs(altitudeMSL - m.altM) <= MID_LAYER_HALF_DEPTH) ||
          (cells.length > 0 && inStormCore(cells, north, east, altitudeMSL, time, weather.cloudBaseM));
      }
      let spread = 0;
      if (!inCloud) {
        const atField = Math.max(0, weather.cloudBaseM - AIRPORT.elevation) / BASE_RISE_PER_K;
        spread = Math.max(0, atField - SPREAD_LAPSE * (altitudeMSL - AIRPORT.elevation));
        if (weather.cloudCover < CLEAR_COVER) spread = Math.max(spread, CLEAR_SPREAD);
        // Falling rain or drizzle saturates the air below the base.
        const p = precipOf(weather, precip);
        if (p.rateMmH > 0 && (p.type === 'rain' || p.type === 'drizzle') && altitudeMSL < weather.cloudBaseM) spread = 0;
      }
      moisture.dewPointSpread = spread;
      moisture.inCloud = inCloud;
      return moisture;
    },
    atmosphere(altitudeMSL) {
      conditions.isaDeviation = weather.isaDeviation;
      conditions.seaLevelPressure = weather.qnhHpa * 100;
      return atmosphereAt(altitudeMSL, conditions);
    },
    wind: (position, time) => windField.sample(position, time),
    groundElevation: (north, east) => terrain.height(north, east),
    groundNormal: (north, east) => terrain.normal(north, east),
    surface: (north, east) => terrain.surface(north, east),
  };
}
