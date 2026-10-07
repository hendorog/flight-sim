// How the cloud layer changes the light of the sky: the ambient radiance seen from the camera (for
// ctx.sky.skyColor, the environment map and the horizon haze) and the direct sun that reaches the
// ground, as functions of cloud cover, layer geometry and the incident sun- and skylight.
//
// Model (plane-parallel two-stream for the layer, Bohren 1987; Eddington with conservative scattering):
//   - Layer optical depth tau = mean extinction x thickness. A fair-weather cumulus / stratocumulus deck
//     of ~1 km has tau ~ 40: direct transmission ~0, diffuse transmission ~0.2.
//   - Diffuse transmission of a beam at cos zenith mu0: T(mu0) = (2 + 3 mu0) / (4 + 3 (1 - g) tau); for
//     the diffuse skylight on top (mean mu0 = 2/3) T = 1 / (1 + 0.75 (1 - g) tau). Reflectance 1 - T.
//   - Cloud base radiance: the transmitted illuminance spread over the lower hemisphere (Lambertian),
//     raised by the ground <-> cloud-base inter-reflections 1 / (1 - A_ground R_cloud).
//   - Broken cumulus seen from below show their sides toward the horizon: sunlit (bright white) looking
//     away from the sun, shaded looking toward it. The fraction of the sky they hide grows toward the
//     horizon, apparent cover f(e) = 1 - (1 - c)^(1 + k cot e) for cells of height/width aspect k.
//   - Clouds are seen through the haze between the camera and the layer, so toward the horizon they fade
//     into the air light; and that air light (the clear-sky in-scatter below the layer) is itself lit
//     only by what the clouds let through.
// Under 8/8 overcast this gives a grey cloud base of ~5-20 klux at the ground, near-neutral colour, no
// direct sun; under scattered cumulus, a clear blue sky plus bright white clouds, so cloud-shadowed
// ground is lit by a near-neutral mix of both instead of the blue sky alone.
//
// The GLSL (CLOUD_SKY_GLSL) evaluates the same radiance per direction for the environment map.

import { GROUND_ALBEDO } from './params';
import { SUMMARY_BANDS, type SkyBands } from './cpuSky';

/** Mean extinction of the cloud layer, 1/m: 0.1 /m at full density (clouds module) x ~0.4 mean fill. */
const LAYER_EXTINCTION = 0.04;
/** Henyey-Greenstein asymmetry of cloud droplets. */
const CLOUD_G = 0.85;
/** Height / width of cumulus cells: how quickly their sides close the view toward the horizon. */
const CELL_ASPECT = 0.6;
/** Share of the sun's normal illuminance a cloud side reflects toward the viewer: looking toward the sun
 * (shaded sides, silver lining) and looking away from it (sunlit sides), including the shape factor. */
const SIDE_TOWARD_SUN = 0.15;
const SIDE_AWAY_FROM_SUN = 0.6;
/** Share of the sky light a cloud side reflects (albedo ~0.8 of a vertical surface seeing half the sky). */
const SIDE_SKY = 0.8;
const GROUND_ALBEDO_Y = 0.2126 * GROUND_ALBEDO[0] + 0.7152 * GROUND_ALBEDO[1] + 0.0722 * GROUND_ALBEDO[2];

/**
 * The layer closes into a continuous deck above this cover (the clouds module fills the gaps between cells
 * from 0.8 to 1.0, see cloudWeather in render/clouds/cloudModel.ts): the local cloud-shadow map covers
 * the broken layer, the deck's direct transmission applies globally once it is closed.
 */
const DECK_CLOSE = [0.8, 1.0] as const;

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Fraction of the view hidden by a layer of cover c, seen at sine of elevation s above (or below) it. */
export function apparentCover(c: number, s: number): number {
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  const sn = Math.min(Math.max(Math.abs(s), 1e-3), 1);
  const cot = Math.sqrt(1 - sn * sn) / sn;
  return 1 - Math.pow(1 - c, 1 + CELL_ASPECT * cot);
}

/** Diffuse transmission of the layer for a beam at cos zenith mu0 (conservative Eddington). */
export function diffuseTransmission(tau: number, mu0: number): number {
  return Math.min(1, (2 + 3 * mu0) / (4 + 3 * (1 - CLOUD_G) * tau));
}

export interface CloudSkyInput {
  cover: number;
  baseM: number;
  topM: number;
  cameraAltitudeM: number;
  /** Key light (sun, or the moon at night): sine of elevation and horizontal direction (unit, x/z). */
  lightMu: number;
  lightX: number;
  lightZ: number;
  /** Direct illuminance of the key light at the layer on a surface facing it (scene units, rgb). */
  lightE: readonly [number, number, number];
  /** Haze extinction at sea level, 1/m, and scale height, m (ctx.sky.hazeExtinction / hazeScaleHeight). */
  hazeExtinction: number;
  hazeScaleHeight: number;
}

/** Everything derived from the cloud layer that the sky, the environment map and post need. */
export class CloudSky {
  cover = 0;
  /** Layer optical depth. */
  tau = 0;
  /** 0 below the base, 1 above the top: how much of the layer lies below the camera. */
  above = 0;
  /** Mean direct transmission of the key light to the ground (and to the camera, `directCamera`). */
  directGround = 1;
  directCamera = 1;
  /** Factor on the shadow-casting light: the closed deck's direct transmission for points below it. */
  deckDirect = 1;
  /** Radiance of the cloud base seen from below, rgb. */
  readonly base = [0, 0, 0];
  /** Radiance of cloud sides seen from below looking toward / away from the key light, rgb. */
  readonly sideToward = [0, 0, 0];
  readonly sideAway = [0, 0, 0];
  /** Radiance of the cloud tops seen from above, rgb. */
  readonly top = [0, 0, 0];
  /**
   * The clear-sky air light below the layer, lit by what the clouds let through: scaled by `airScale` and
   * desaturated toward its own luminance by `airGrey` (the diffuse cloud light is near neutral).
   */
  airScale = 1;
  airGrey = 0;
  /** Haze extinction at the camera, 1/m, and the distance to the layer base above / top below, m. */
  hazeAtCamera = 0;
  distBase = 0;
  distTop = 0;

  /**
   * @param bands  clear-sky summary at the camera (per-band mean radiance); band 0 (near zenith) and the
   *               cosine-weighted mean stand in for the skylight falling on the layer top
   */
  update(input: CloudSkyInput, bands: SkyBands): void {
    const c = Math.min(Math.max(input.cover, 0), 1);
    this.cover = c;
    const thickness = Math.max(input.topM - input.baseM, 50);
    const tau = (this.tau = LAYER_EXTINCTION * thickness);
    const alt = input.cameraAltitudeM;
    this.above = smoothstep(input.baseM, input.topM, alt);
    this.distBase = Math.max(input.baseM - alt, 0);
    this.distTop = Math.max(alt - input.topM, 0);
    this.hazeAtCamera = input.hazeExtinction * Math.exp(-Math.max(alt, 0) / Math.max(input.hazeScaleHeight, 1));

    const mu0 = Math.max(input.lightMu, 0);
    const tSun = diffuseTransmission(tau, mu0);
    const tSky = diffuseTransmission(tau, 2 / 3);
    const tDirect = Math.exp(-tau / Math.max(mu0, 0.05));
    // Skylight on the layer top: the clear sky's cosine-weighted mean radiance (x PI = irradiance).
    const sky = [0, 0, 0];
    for (let i = 0; i < SUMMARY_BANDS; i++) for (let k = 0; k < 3; k++) sky[k] += bands.weight[i] * bands.band[3 * i + k];
    const interReflect = 1 / (1 - GROUND_ALBEDO_Y * (1 - tSky));
    const shade = apparentCover(c, mu0);
    this.directGround = 1 - shade * (1 - tDirect);
    this.directCamera = this.directGround + (1 - this.directGround) * this.above;
    this.deckDirect = 1 - smoothstep(DECK_CLOSE[0], DECK_CLOSE[1], c) * (1 - tDirect) * (1 - this.above);

    // Global horizontal illuminance below the layer relative to clear sky, per channel: sets the air light.
    for (let k = 0; k < 3; k++) {
      const eSun = input.lightE[k] * mu0;
      const eSky = Math.PI * sky[k];
      this.base[k] = ((tSun * eSun + tSky * eSky) / Math.PI) * interReflect;
      this.top[k] = ((1 - tSun) * eSun + (1 - tSky) * eSky) / Math.PI;
      const side = (SIDE_SKY * eSky) / (2 * Math.PI);
      this.sideToward[k] = (SIDE_TOWARD_SUN * input.lightE[k]) / Math.PI + side;
      this.sideAway[k] = (SIDE_AWAY_FROM_SUN * input.lightE[k]) / Math.PI + side;
    }
    // Air below the layer: lit by the direct sun where the clouds let it through, and by the diffuse light
    // of sky and clouds, which is near neutral. The clear air light keeps its colour in the sunlit share
    // and turns grey in the rest.
    const lum = (v: ArrayLike<number>): number => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    const clearGlobal = lum(input.lightE) * mu0 + Math.PI * lum(sky);
    const cloudy = apparentCover(c, 0.5);
    const diffuseUnder = Math.PI * ((1 - cloudy) * lum(sky) + cloudy * lum(this.base));
    const ratio = clearGlobal > 0 ? (this.directGround * lum(input.lightE) * mu0 + diffuseUnder) / clearGlobal : 1;
    this.airGrey = 0.7 * (1 - this.directGround) * (1 - this.above);
    this.airScale = 1 + (Math.min(ratio, 1) - 1) * (1 - this.above);
  }

  /** The air light below the layer for a clear-sky air light (rgb), in place. */
  airLight(v: number[] | Float64Array): void {
    const y = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    for (let k = 0; k < 3; k++) v[k] = (v[k] + (y - v[k]) * this.airGrey) * this.airScale;
  }

  /**
   * Blend of clear sky and clouds for a direction of sine elevation s whose clear radiance is `clear`
   * (rgb); cosAz is the horizontal cosine to the key light. Writes rgb into out.
   */
  radiance(s: number, cosAz: number, clear: ArrayLike<number>, out: number[] | Float64Array): void {
    const c = this.cover;
    if (s >= 0) {
      // Clouds above the camera (fading out as the camera climbs into and above the layer), seen through
      // the haze below the base.
      const f = apparentCover(c, s) * (1 - this.above) * Math.exp(-this.hazeAtCamera * this.distBase / Math.max(s, 0.02));
      const sides = (1 - c) * Math.sqrt(Math.max(0, 1 - s * s));
      const w = 0.5 - 0.5 * cosAz;
      for (let k = 0; k < 3; k++) out[k] = clear[k];
      this.airLight(out);
      for (let k = 0; k < 3; k++) {
        const side = this.sideToward[k] + (this.sideAway[k] - this.sideToward[k]) * w;
        const cloud = this.base[k] + (side - this.base[k]) * sides;
        out[k] = out[k] * (1 - f) + cloud * f;
      }
    } else {
      // Cloud tops below the camera.
      const f = apparentCover(c, s) * this.above * Math.exp(-this.hazeAtCamera * this.distTop / Math.max(-s, 0.02));
      for (let k = 0; k < 3; k++) out[k] = clear[k];
      this.airLight(out);
      for (let k = 0; k < 3; k++) out[k] = out[k] * (1 - f) + this.top[k] * f;
    }
  }

  /** skyColor and hazeColor from the clear-sky summary, with the clouds blended in. */
  summarize(bands: SkyBands, sky: { setRGB(r: number, g: number, b: number): unknown }, haze: { setRGB(r: number, g: number, b: number): unknown }): void {
    const acc = [0, 0, 0];
    const tmp = [0, 0, 0];
    const clear = [0, 0, 0];
    // Azimuth mean of the side term: evaluate at cosAz = 0 (the side term is linear in cosAz).
    for (let i = 0; i < SUMMARY_BANDS; i++) {
      for (let k = 0; k < 3; k++) clear[k] = bands.band[3 * i + k];
      this.radiance(bands.mu[i], 0, clear, tmp);
      for (let k = 0; k < 3; k++) acc[k] += bands.weight[i] * tmp[k];
    }
    sky.setRGB(acc[0], acc[1], acc[2]);
    const h = bands.horizon;
    this.radiance(0, 0, h, tmp);
    haze.setRGB(tmp[0], tmp[1], tmp[2]);
  }
}

/**
 * GLSL twin of CloudSky.radiance for the environment map. Uniforms (filled by SkySystem):
 *   uCloudA: x cover, y above, z haze extinction at the camera (1/m), w cell aspect
 *   uCloudB: x distance to base (m), y distance to top (m)
 *   uCloudBase, uCloudSideToward, uCloudSideAway, uCloudTop: rgb
 *   uAirLight: x airScale, y airGrey (shared with the aerial perspective, Atmosphere.uniforms)
 *   uCloudLight: horizontal direction of the key light (xz, unit)
 */
export const CLOUD_SKY_GLSL = /* glsl */ `
uniform vec4 uCloudA;
uniform vec2 uCloudB;
uniform vec3 uCloudBase;
uniform vec3 uCloudSideToward;
uniform vec3 uCloudSideAway;
uniform vec3 uCloudTop;
uniform vec2 uAirLight;
vec3 airLight(vec3 v) { return mix(v, vec3(dot(v, vec3(0.2126, 0.7152, 0.0722))), uAirLight.y) * uAirLight.x; }
uniform vec2 uCloudLight;
float cloudApparentCover(float s) {
  float c = uCloudA.x;
  if (c <= 0.0) return 0.0;
  if (c >= 1.0) return 1.0;
  float sn = clamp(abs(s), 1e-3, 1.0);
  return 1.0 - pow(1.0 - c, 1.0 + uCloudA.w * sqrt(1.0 - sn * sn) / sn);
}
// inscatter: clear-sky radiance of the air along the ray; ground: the (already cloud-lit) ground behind it.
vec3 cloudySky(vec3 d, vec3 inscatter, vec3 ground) {
  if (uCloudA.x <= 0.0) return inscatter + ground;
  vec3 clear = airLight(inscatter) + ground;
  float s = d.y;
  if (s >= 0.0) {
    float f = cloudApparentCover(s) * (1.0 - uCloudA.y) * exp(-uCloudA.z * uCloudB.x / max(s, 0.02));
    float sides = (1.0 - uCloudA.x) * sqrt(max(0.0, 1.0 - s * s));
    float h = length(d.xz);
    float cosAz = h > 1e-5 ? dot(d.xz / h, uCloudLight) : 0.0;
    vec3 side = mix(uCloudSideToward, uCloudSideAway, 0.5 - 0.5 * cosAz);
    return mix(clear, mix(uCloudBase, side, sides), f);
  }
  float f = cloudApparentCover(s) * uCloudA.y * exp(-uCloudA.z * uCloudB.y / max(-s, 0.02));
  return mix(clear, uCloudTop, f);
}
`;

export const CLOUD_CELL_ASPECT = CELL_ASPECT;
