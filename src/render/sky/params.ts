// Physical parameters of the atmosphere model and the photometric scale of the renderer.
//
// The model follows Hillaire 2020, "A Scalable and Production Ready Sky and Atmosphere Rendering
// Technique" (EGSR): a spherical planet with exponential Rayleigh and Mie layers and a tent-shaped
// ozone layer. Distances in the atmosphere code (GLSL and CPU) are in KILOMETRES and coefficients in
// 1/km, which keeps float32 precision comfortable at planetary radii.

import { SCENE_UNITS_PER_LUX } from '../../core/context';
import { clamp } from '../../core/math';
import { AIRPORT } from '../../core/world';
import type { SurfaceType } from '../../core/types';

/**
 * Scene radiance/illuminance units per cd/m^2 / lux. The HDR buffers are half-float (max 65504, min
 * normal 6e-5), so the scale is chosen to keep moonlit terrain (~0.01 cd/m^2) in the normal range while
 * leaving ~20x headroom above sunlit white surfaces (~30 000 cd/m^2). Emissive materials (lamps,
 * displays) should multiply a luminance in cd/m^2 by this.
 */
export { SCENE_UNITS_PER_LUX };

/** Solar illuminance at the top of the atmosphere (~128 klx, from 1361 W/m^2 at ~93 lm/W). */
export const SUN_ILLUMINANCE_TOA = 128_000 * SCENE_UNITS_PER_LUX;
/** Full-moon illuminance at the top of the atmosphere (~0.26 lux; Allen, Astrophysical Quantities). */
export const MOON_FULL_ILLUMINANCE_TOA = 0.26 * SCENE_UNITS_PER_LUX;
/** Apparent angular radii, rad. */
export const SUN_ANGULAR_RADIUS = 0.004654;
export const MOON_ANGULAR_RADIUS = 0.00452;

export const EARTH_RADIUS_KM = 6360;
export const ATMOSPHERE_TOP_KM = 6460;

/** Rayleigh scattering at sea level for linear-sRGB primaries (Hillaire 2020 / Bruneton 2017), 1/km. */
const RAYLEIGH_SCATTERING = [5.802e-3, 13.558e-3, 33.1e-3] as const;
const RAYLEIGH_SCALE_HEIGHT_KM = 8.0;
/** Ozone absorption peak (Hillaire 2020), 1/km; tent profile centred at 25 km, half-width 15 km. */
const OZONE_ABSORPTION = [0.65e-3, 1.881e-3, 0.085e-3] as const;
/** Aerosols live mostly in the boundary layer. */
const MIE_SCALE_HEIGHT_KM = 1.2;
/** Henyey-Greenstein asymmetry of continental haze. */
const MIE_G = 0.8;
/**
 * Aerosol optics change with visibility: dry continental haze (visibility >= 10 km) is small, weakly
 * absorbing particles (single-scattering albedo ~0.9, Angstrom exponent ~1: extinction ~ lambda^-1, so
 * haze is bluish and the sun through it reddens). Low visibility means water: hygroscopic growth into
 * mist and fog droplets of several microns, which scatter all wavelengths alike (Angstrom ~0.1) and
 * absorb almost nothing (albedo ~0.99; pure water droplets > 0.999). Interpolated in log visibility
 * between 1 km (mist/fog) and 10 km (haze). With the dry-haze values a fog was a dark brown smog.
 */
const HAZE_ALBEDO = 0.9;
const FOG_ALBEDO = 0.99;
const HAZE_ANGSTROM = 1.0;
const FOG_ANGSTROM = 0.1;

/** 0 for fog/mist (visibility <= 1 km), 1 for dry haze (>= 10 km), linear in log10 visibility between. */
export function hazeDryness(visibilityKm: number): number {
  return clamp(Math.log10(Math.max(visibilityKm, 1e-3)), 0, 1);
}
/** Effective wavelengths of the linear-sRGB primaries, nm. */
const LAMBDA = [630, 550, 465] as const;
/** Average albedo of the ground seen from the sky (vegetation / soil mix). */
export const GROUND_ALBEDO = [0.1, 0.12, 0.08] as const;

/**
 * Albedo (linear RGB) of the ground types under the aircraft, for the environment map's lower hemisphere
 * near the nadir: the bounce light on a white airframe's undersides. Pavement is neutral: weathered
 * asphalt runway ~0.12-0.18, concrete apron and taxiways ~0.25-0.35 (Oke, Boundary Layer Climates;
 * Taha et al. 1992). Grass ~0.2 broadband but dark in blue and red; snow ~0.8.
 */
export const SURFACE_ALBEDO: Record<SurfaceType, readonly [number, number, number]> = {
  runway: [0.15, 0.15, 0.15],
  taxiway: [0.27, 0.27, 0.26],
  grass: [0.09, 0.13, 0.05],
  dirt: [0.2, 0.16, 0.12],
  rock: [0.2, 0.19, 0.18],
  snow: [0.8, 0.8, 0.82],
  water: [0.05, 0.06, 0.07],
};

export interface AtmosphereParams {
  rayleighScattering: [number, number, number];
  rayleighScaleHeight: number;
  mieScattering: [number, number, number];
  mieExtinction: [number, number, number];
  mieScaleHeight: number;
  mieG: number;
  ozoneAbsorption: [number, number, number];
  groundAlbedo: [number, number, number];
}

/**
 * Atmosphere coefficients for a meteorological visibility. Koschmieder's law (2 % contrast threshold)
 * gives the total extinction at 550 nm at the airfield, beta = 3.912 / V; Rayleigh accounts for part of
 * it and aerosols for the rest, spread over their scale height. 60 km visibility gives an aerosol
 * optical depth of ~0.07, typical of a clean continental day.
 */
export function atmosphereParams(visibilityM: number): AtmosphereParams {
  const vKm = clamp(visibilityM / 1000, 0.3, 500);
  const fieldKm = AIRPORT.elevation / 1000;
  const rayleighField = RAYLEIGH_SCATTERING[1] * Math.exp(-fieldKm / RAYLEIGH_SCALE_HEIGHT_KM);
  const aerosolField = Math.max(3.912 / vKm - rayleighField, 2e-3);
  const aerosolSeaLevel = aerosolField / Math.exp(-fieldKm / MIE_SCALE_HEIGHT_KM);
  const dry = hazeDryness(vKm);
  const angstrom = FOG_ANGSTROM + (HAZE_ANGSTROM - FOG_ANGSTROM) * dry;
  const albedo = FOG_ALBEDO + (HAZE_ALBEDO - FOG_ALBEDO) * dry;
  const ext = LAMBDA.map((l) => aerosolSeaLevel * Math.pow(l / LAMBDA[1], -angstrom)) as [number, number, number];
  return {
    rayleighScattering: [...RAYLEIGH_SCATTERING],
    rayleighScaleHeight: RAYLEIGH_SCALE_HEIGHT_KM,
    mieScattering: ext.map((e) => e * albedo) as [number, number, number],
    mieExtinction: ext,
    mieScaleHeight: MIE_SCALE_HEIGHT_KM,
    mieG: MIE_G,
    ozoneAbsorption: [...OZONE_ABSORPTION],
    groundAlbedo: [...GROUND_ALBEDO],
  };
}

/** Altitude band, km, over which the exponential haze fit matches the model's optical depth. */
const HAZE_FIT_TOP_KM = 6;

/**
 * Fit beta0 * exp(-h / H) to the green extinction of the two-layer model (aerosol + Rayleigh): beta0 is
 * exact at sea level and H makes the optical depth of the 0..6 km column match, the layer in which
 * aircraft, terrain and clouds live. Writes (beta0 in 1/m, H in m) into `out`.
 */
export function fitHaze<T extends { set(x: number, y: number): T }>(p: AtmosphereParams, out: T): T {
  const bm = p.mieExtinction[1];
  const br = p.rayleighScattering[1];
  const top = HAZE_FIT_TOP_KM;
  const beta0 = bm + br;
  const column = bm * p.mieScaleHeight * (1 - Math.exp(-top / p.mieScaleHeight)) + br * p.rayleighScaleHeight * (1 - Math.exp(-top / p.rayleighScaleHeight));
  // column(H) = beta0 H (1 - exp(-top/H)) grows monotonically with H: bisect.
  let lo = 0.05;
  let hi = 50;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (beta0 * mid * (1 - Math.exp(-top / mid)) < column) lo = mid;
    else hi = mid;
  }
  return out.set(beta0 / 1000, 500 * (lo + hi));
}
