// Mean wind in the atmospheric surface/boundary layer.
//
// The reported wind (WeatherSettings.windSpeedKt / windDirectionDeg) is the METAR wind at the standard 10 m
// anemometer height. Below it the speed follows the neutral logarithmic profile U(z) ~ ln(z / z0); above it
// the log law is blended smoothly into the free-stream (gradient) wind at the top of the boundary layer by
// saturating the height, z_e = H (1 - exp(-z / H)). With open-terrain roughness this makes the gradient
// wind ~1.6x the surface wind, typical of a neutral day over land.
//
// Direction: surface friction backs the near-ground wind relative to the gradient wind (Ekman spiral),
// typically 20-30 degrees over land in the northern hemisphere, so the wind veers (turns clockwise) with
// height. The veer is taken proportional to the speed increase above 10 m.

import { DEG } from '../../core/math';

/** Aerodynamic roughness length, m: open flat terrain with low grass (WMO / Davenport class 3). */
export const ROUGHNESS_LENGTH = 0.03;
/** Anemometer height of the reported surface wind, m. */
export const REFERENCE_HEIGHT = 10;
/** Height scale over which the log profile saturates into the gradient wind, m. */
const PROFILE_DEPTH = 400;
/** Total veer from the 10 m wind to the gradient wind. */
const SURFACE_BACKING = 25 * DEG;

const effectiveHeight = (z: number) => PROFILE_DEPTH * (1 - Math.exp(-z / PROFILE_DEPTH));
const logProfile = (z: number) => Math.log(1 + effectiveHeight(z) / ROUGHNESS_LENGTH);
const REFERENCE_LOG = logProfile(REFERENCE_HEIGHT);
const GRADIENT_RATIO = Math.log(1 + PROFILE_DEPTH / ROUGHNESS_LENGTH) / REFERENCE_LOG;

/** Mean wind speed at a height above ground as a multiple of the reported 10 m wind. */
export function windSpeedFactor(heightAGL: number): number {
  return logProfile(Math.max(0, heightAGL)) / REFERENCE_LOG;
}

/** Clockwise turning of the wind direction at a height relative to the 10 m direction, rad. */
export function windVeer(heightAGL: number): number {
  const f = windSpeedFactor(heightAGL);
  return f <= 1 ? 0 : (SURFACE_BACKING * (f - 1)) / (GRADIENT_RATIO - 1);
}

/** Ratio of the gradient (free-stream) wind to the reported 10 m wind. */
export const gradientWindFactor = GRADIENT_RATIO;
