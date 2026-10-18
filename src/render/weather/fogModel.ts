// Ground fog layer: the medium and its CPU twin. Pure (no three.js, no DOM), so the node tests check the same
// numbers the shaders compute (fogGlsl.ts holds the GLSL port of fogOpticalDepth and fogRadiance).
//
// The layer (WeatherSettings.fogTopM, fogVisibilityM through core/weatherFields fogOf) has a uniform extinction
// beta = 3.912 / fogVisibilityM (Koschmieder, the 2 % contrast threshold the rest of the sky uses) from the ground up
// to yA = yTop - FOG_RAMP_FRACTION * fogTopM, then a smoothstep fall-off to 0 at the top yTop = field elevation +
// fogTopM:
//   rho(y) = 1 - smoothstep(yA, yTop, y)
// Below yA the density stays 1 at any depth (fog filling the valleys below the field). Along a straight segment the
// altitude changes linearly, so the optical depth is the altitude integral of rho scaled by length / |dy|. With
// s = (y - yA) / (yTop - yA) clamped to [0, 1], the antiderivative of 1 - smoothstep is F(s) = s - s^3 + s^4 / 2,
// and C(y) = min(y - yA, 0) + (yTop - yA) F(s) is an antiderivative of rho over every altitude:
//   tau = beta * d * |C(y1) - C(y0)| / |y1 - y0|            (|y1 - y0| >= FOG_FLAT_DY_M)
//   tau = beta * d * rho((y0 + y1) / 2)                       (flatter segments: the midpoint rule)
// C is taken relative to yA so the GPU's 32-bit floats keep their precision near the layer.
//
// The in-scattered radiance is a single-colour two-term source: the ambient air light (ctx.sky.hazeColor, which
// already carries the cloud layer's dimming, render/sky/cloudSky.ts summarize) and a forward-scattered share of the
// direct sun (Henyey-Greenstein, g = FOG_SUN_G) reaching the camera's altitude through the fog above it:
//   L = (1 - e^-tau) * (ambient + sun * HG(cos theta) * FOG_SUN_SHARE * T_sunToTop),   out = in * e^-tau + L.

/** Koschmieder constant: visibility = 3.912 / extinction (2 % contrast), as core/weatherFields.ts and render/sky. */
const KOSCHMIEDER = 3.912;
/** Fraction of the fog depth over which the density falls from 1 to 0 at the top (a shape choice; unconfirmed). */
export const FOG_RAMP_FRACTION = 0.2;
/** Segments flatter than this, m of altitude change, use the midpoint rule (avoids 0 / 0 and float cancellation). */
export const FOG_FLAT_DY_M = 0.5;
/** Henyey-Greenstein asymmetry of the fog's sun term (droplet forward scattering; unconfirmed tuning value). */
export const FOG_SUN_G = 0.85;
/** Share of the direct sun's single scattering kept in the in-scatter term (unconfirmed tuning value). */
export const FOG_SUN_SHARE = 0.05;
/** Lowest sine of the sun elevation the sun's path through the fog is evaluated at (keeps the path finite). */
export const FOG_SUN_MIN_MU = 0.05;

/** The layer's shape in world altitude: extinction (1/m) and the ramp's start and top (m, three.js y = MSL). */
export interface FogShape {
  beta: number;
  yA: number;
  yTop: number;
}

/**
 * The layer's shape from its depth above the field (m) and its visibility (m), written into `out`. A depth of 0
 * gives beta 0 (no fog anywhere).
 */
export function fogShape(topM: number, visibilityM: number, fieldElevationM: number, out: FogShape): FogShape {
  out.yTop = fieldElevationM + topM;
  out.yA = out.yTop - FOG_RAMP_FRACTION * topM;
  out.beta = topM > 0 ? KOSCHMIEDER / visibilityM : 0;
  return out;
}

/** Relative density at altitude y, 0..1. */
export function fogDensity(yA: number, yTop: number, y: number): number {
  const h = yTop - yA;
  if (!(h > 0)) return y < yTop ? 1 : 0;
  const s = Math.min(Math.max((y - yA) / h, 0), 1);
  return 1 - s * s * (3 - 2 * s);
}

/** Antiderivative of fogDensity over altitude, relative to yA (see header). */
function cumulative(yA: number, yTop: number, y: number): number {
  const h = yTop - yA;
  if (!(h > 0)) return Math.min(y, yTop) - yA;
  const s = Math.min(Math.max((y - yA) / h, 0), 1);
  const s3 = s * s * s;
  return Math.min(y - yA, 0) + h * (s - s3 + 0.5 * s3 * s);
}

/** Optical depth of the fog along a straight segment of length d (m) from altitude y0 to y1 (m). */
export function fogOpticalDepth(beta: number, yA: number, yTop: number, y0: number, y1: number, d: number): number {
  if (!(beta > 0) || !(d > 0)) return 0;
  const dy = y1 - y0;
  if (Math.abs(dy) < FOG_FLAT_DY_M) return beta * d * fogDensity(yA, yTop, 0.5 * (y0 + y1));
  return (beta * d * Math.abs(cumulative(yA, yTop, y1) - cumulative(yA, yTop, y0))) / Math.abs(dy);
}

/** Henyey-Greenstein phase function, 1/sr. */
export function phaseHG(cosTheta: number, g: number): number {
  const d = 1 + g * g - 2 * g * cosTheta;
  return (1 - g * g) / (4 * Math.PI * d * Math.sqrt(d));
}

/** Transmittance of the fog from the camera's altitude up through the top toward a light of sine elevation mu. */
export function fogSunTransmittance(beta: number, yA: number, yTop: number, camY: number, mu: number): number {
  if (!(beta > 0) || camY >= yTop) return 1;
  const m = Math.max(mu, FOG_SUN_MIN_MU);
  return Math.exp(-fogOpticalDepth(beta, yA, yTop, camY, yTop, (yTop - camY) / m));
}

/**
 * The fogged colour of one pixel, rgb written into `out` (the CPU twin of the composite in FogEffect.ts):
 * input colour `c`, optical depth `tau`, ambient air light, sun colour (already scaled by the share of the direct
 * sun that reaches the ground through the clouds), cos of the angle between the view ray and the sun, and the
 * sun's transmittance through the fog above the camera.
 */
export function fogRadiance(
  c: ArrayLike<number>,
  tau: number,
  ambient: ArrayLike<number>,
  sun: ArrayLike<number>,
  cosSun: number,
  sunTransmittance: number,
  out: number[] | Float64Array,
): number[] | Float64Array {
  const t = Math.exp(-tau);
  const sunK = phaseHG(cosSun, FOG_SUN_G) * FOG_SUN_SHARE * sunTransmittance;
  for (let k = 0; k < 3; k++) out[k] = c[k] * t + (1 - t) * (ambient[k] + sun[k] * sunK);
  return out;
}
