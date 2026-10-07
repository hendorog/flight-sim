// CPU evaluation of the atmosphere model: transmittance along a ray to space, used for the colour of
// direct sun/moon light and exported for other modules (clouds, water glints, aircraft lights) that need
// the same numbers as the GPU sky. Matches transmittanceLut in glsl/atmosphere.ts.

import * as THREE from 'three';
import type { SimContext } from '../../core/context';
import { smoothstep } from '../../core/math';
import { ATMOSPHERE_TOP_KM, EARTH_RADIUS_KM, SUN_ANGULAR_RADIUS, SUN_ILLUMINANCE_TOA, atmosphereParams, type AtmosphereParams } from './params';

const STEPS = 32;

/**
 * Soft planet shadow for a light seen from radius r (km) at cosine zenith angle mu: 0 when the light is
 * fully below the geometric horizon, 1 when fully above, blended across the sun's angular diameter.
 */
export function planetShadow(r: number, mu: number): number {
  const sinHorizon = EARTH_RADIUS_KM / r;
  const muHorizon = -Math.sqrt(Math.max(0, 1 - sinHorizon * sinHorizon));
  return smoothstep(-SUN_ANGULAR_RADIUS, SUN_ANGULAR_RADIUS, (mu - muHorizon) / sinHorizon);
}

/**
 * Transmittance from altitude (km above sea level) to the top of the atmosphere in the direction with
 * cosine zenith angle mu, including the planet shadow. Writes linear RGB into out.
 */
export function transmittanceToSpace(p: AtmosphereParams, altitudeKm: number, mu: number, out: THREE.Color): THREE.Color {
  const r = EARTH_RADIUS_KM + Math.max(altitudeKm, 0.001);
  const shadow = planetShadow(r, mu);
  if (shadow <= 0) return out.setRGB(0, 0, 0);
  const d = -r * mu + Math.sqrt(Math.max(0, r * r * (mu * mu - 1) + ATMOSPHERE_TOP_KM * ATMOSPHERE_TOP_KM));
  const dt = d / STEPS;
  let sumR = 0;
  let sumM = 0;
  let sumO = 0;
  for (let i = 0; i < STEPS; i++) {
    const t = (i + 0.5) * dt;
    const h = Math.sqrt(r * r + t * t + 2 * r * mu * t) - EARTH_RADIUS_KM;
    sumR += Math.exp(-h / p.rayleighScaleHeight);
    sumM += Math.exp(-h / p.mieScaleHeight);
    sumO += Math.max(0, 1 - Math.abs(h - 25) / 15);
  }
  const channel = (c: number): number =>
    Math.exp(-dt * (p.rayleighScattering[c] * sumR + p.mieExtinction[c] * sumM + p.ozoneAbsorption[c] * sumO)) * shadow;
  return out.setRGB(channel(0), channel(1), channel(2));
}

let cachedVisibility = NaN;
let cachedParams: AtmosphereParams = atmosphereParams(60_000);
function paramsFor(visibilityM: number): AtmosphereParams {
  if (visibilityM !== cachedVisibility) {
    cachedVisibility = visibilityM;
    cachedParams = atmosphereParams(visibilityM);
  }
  return cachedParams;
}

/**
 * Atmospheric transmittance from a point at altitudeM (MSL) toward a three.js world direction, out to
 * space. Use it to tint anything lit by the sun at that altitude, e.g. sunlight on a cloud top:
 * `atmosphereTransmittance(alt, ctx.sky.sunDir, ctx.weather.visibilityM, c).multiplyScalar(SUN_ILLUMINANCE_TOA)`.
 */
export function atmosphereTransmittance(altitudeM: number, dir: THREE.Vector3, visibilityM: number, out: THREE.Color): THREE.Color {
  return transmittanceToSpace(paramsFor(visibilityM), altitudeM / 1000, dir.y / Math.max(dir.length(), 1e-9), out);
}

/** Direct sunlight (colour x illuminance, scene units) arriving at a point at altitudeM MSL. */
export function sunlightAt(altitudeM: number, ctx: SimContext, out: THREE.Color): THREE.Color {
  return atmosphereTransmittance(altitudeM, ctx.sky.sunDir, ctx.weather.visibilityM, out).multiplyScalar(SUN_ILLUMINANCE_TOA);
}
