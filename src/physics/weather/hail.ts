// Hail of the storm cells: the largest stone a cell's updraft can hold up, the stones' fall speed and their size
// distribution. Pure functions, no state (read by stormPrecip.ts, the precipitation overlay, the airframe sound and
// the hail exposure).
//
// A stone grows while the updraft holds it up and falls out once its fall speed exceeds the updraft, so the largest
// stone of a cell is the one whose terminal velocity equals the updraft speed at the growth level:
//   v_t(D) = sqrt(4 g D rho_h / (3 C_d rho_a))    (a sphere at drag coefficient C_d)
//   D_max  = 3 C_d rho_a w^2 / (4 g rho_h)
// The updraft is the larger of the field's wMax (convection.ts UPDRAFT_BASE + UPDRAFT_PER_INTENSITY intensity) and
// intensity x HAIL_CAPE_UPDRAFT_SHARE x sqrt(2 CAPE), the parcel-theory updraft reduced for entrainment and water
// loading. Sizes, mm: v_t 9.4 m/s at 5 mm and 29.9 m/s at 50 mm (sea-level density 1.1 kg/m^3 here); D_max 62 mm at
// intensity 1 and CAPE 2743 J/kg (the Thunderstorm preset), 11 mm for an explicit cell of intensity 0.8 under a
// weather without CAPE.
// Unconfirmed: C_d, the stone density, the CAPE share and the distribution's shape are values chosen for this model;
// no source has been checked for them. The 5 km air density is the ISA value.

import { clamp, smoothstep } from '../../core/math';
import { UPDRAFT_BASE, UPDRAFT_PER_INTENSITY } from './convection';

const G = 9.80665;
/** Drag coefficient of a hailstone (sphere), unconfirmed. */
export const HAIL_DRAG_COEFF = 0.6;
/** Bulk density of a hailstone, kg/m^3, unconfirmed (solid ice is 917). */
export const HAIL_DENSITY_KGM3 = 900;
/** Air density at the growth level, kg/m^3: ISA at 5000 m. */
export const HAIL_GROWTH_AIR_DENSITY = 0.736;
/** Air density the drawn stones fall through (below the cloud base), kg/m^3. */
export const HAIL_FALL_AIR_DENSITY = 1.1;
/** Share of the parcel-theory updraft sqrt(2 CAPE) the hail updraft reaches, unconfirmed. */
export const HAIL_CAPE_UPDRAFT_SHARE = 0.55;
/** Largest diameter the model gives, mm. */
export const HAIL_MAX_MM = 150;
/** Largest diameter at which a cell starts and reaches full hail occurrence, mm (hailOccurrence). */
export const HAIL_ONSET_MM = 3;
export const HAIL_FULL_MM = 8;
/** Smallest diameter of hail (METAR GR); below it a fall is small hail (GS), mm. */
export const HAIL_GR_MM = 5;
/**
 * Size distribution of the stones at a point (hailDiameterMm): an exponential of scale HAIL_SCALE_SHARE x D_max
 * from D_lo = HAIL_LOW_SHARE x min(D_max, 12.5 mm) (5 mm pea-size stones under a large-hail cell), truncated at
 * D_max. Unconfirmed.
 */
export const HAIL_SCALE_SHARE = 0.25;
export const HAIL_LOW_SHARE = 0.4;

/** Terminal fall speed of a stone of diameter dMm (mm) in air of density rhoAir (kg/m^3), m/s. */
export function hailFallSpeed(dMm: number, rhoAir = HAIL_FALL_AIR_DENSITY): number {
  const d = Math.max(0, dMm) / 1000;
  return Math.sqrt((4 * G * d * HAIL_DENSITY_KGM3) / (3 * HAIL_DRAG_COEFF * rhoAir));
}

/** The updraft that grows a cell's hail, m/s, from its intensity 0..1 and the CAPE of the weather, J/kg. */
export function hailUpdraftMs(intensity: number, capeJkg: number): number {
  const i = clamp(intensity, 0, 1);
  return Math.max(UPDRAFT_BASE + UPDRAFT_PER_INTENSITY * i, i * HAIL_CAPE_UPDRAFT_SHARE * Math.sqrt(2 * Math.max(0, capeJkg)));
}

/** Largest stone an updraft of w m/s holds up at the growth level, mm (at most HAIL_MAX_MM). */
export function hailMaxDiameterMm(w: number): number {
  const d = (3 * HAIL_DRAG_COEFF * HAIL_GROWTH_AIR_DENSITY * w * w) / (4 * G * HAIL_DENSITY_KGM3);
  return Math.min(HAIL_MAX_MM, d * 1000);
}

/** Share 0..1 of a cell's hail rate for its largest stone (0 below HAIL_ONSET_MM, 1 from HAIL_FULL_MM). */
export function hailOccurrence(maxMm: number): number {
  return smoothstep(HAIL_ONSET_MM, HAIL_FULL_MM, maxMm);
}

/** Smallest stone of the distribution for a largest stone of maxMm, mm. */
export function hailLowMm(maxMm: number): number {
  return HAIL_LOW_SHARE * Math.min(maxMm, 12.5);
}

/**
 * The diameter at quantile u (0..1) of the size distribution with largest stone maxMm, mm: the inverse of the
 * truncated exponential. Increasing in u and in maxMm. The overlay's shader draws each stone's size with the same
 * formula from its hash.
 */
export function hailDiameterMm(u: number, maxMm: number): number {
  const lo = hailLowMm(maxMm);
  const scale = Math.max(HAIL_SCALE_SHARE * maxMm, 1e-3);
  const span = Math.max(0, maxMm - lo);
  return lo - scale * Math.log(1 - clamp(u, 0, 1) * (1 - Math.exp(-span / scale)));
}

/** Mean diameter of the distribution, mm (the median quantile stands in for it). */
export function hailMeanMm(maxMm: number): number {
  return hailDiameterMm(0.5, maxMm);
}

/**
 * Number of stones per m^3 at a hail rate (mm/h liquid-water equivalent) with largest stone maxMm: the mass
 * concentration rho_w R / v_t over the mass of a stone of the mean diameter (hailMeanMm).
 */
export function hailNumberDensity(rateMmH: number, maxMm: number): number {
  if (!(rateMmH > 0) || !(maxMm > 0)) return 0;
  const d = hailMeanMm(maxMm) / 1000;
  const mass = HAIL_DENSITY_KGM3 * (Math.PI / 6) * d * d * d;
  return (1000 * (rateMmH / 3.6e6)) / hailFallSpeed(d * 1000) / mass;
}
