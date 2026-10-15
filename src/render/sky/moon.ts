// The Moon's presentation in the visible sky (package P1 of the night-sky plan owns this file, glsl/moon.ts and
// celestial.ts): the uniforms of MOON_GLSL and their per-frame update.
//
// Interface (frozen by the scaffold; see the plan): `uniforms` is spread into the sky dome's uniforms, so the
// objects are shared with every material that spreads the dome's uniforms (the star layer reads
// uMoonAngularRadius to hide stars behind the disc). update() runs once per frame from SkyDome.update, after the
// Celestial has moved.
//
// SIZE. Owner: "about 3x", then "more cinematic, and enlarge it at the horizon as well for effect", with a menu
// setting from real size up. The numbers are AGENT choices: the setting s (ctx.moonScale, 1..5, default 4) scales
// the real radius, and below 35 deg altitude the disc grows further (the Moon illusion):
//     r = R_real * s * g(h),  g(h) = 1 + G * w(h) * (s - 1) / 3,  w(h) = 1 - smoothstep(0, 35 deg, h)  (w = 1 below 0)
// with G = 0.6: the default is 4x above 35 deg and 6.4x at the horizon; s = 1 is exactly real size everywhere.
//
// BRIGHTNESS (agent choice; the plan explains why the brief's "divide the radiance by s^2" does not work):
// - The disc keeps the real Moon's SURFACE BRIGHTNESS (radiance per solid angle). By day an enlarged Moon is then
//   as pale against the blue as the real one (divided by s^2 it would vanish); its extra flux is a fraction of a
//   percent of a daylight frame.
// - At night the real disc (~4e3 cd/m^2) is ~18 EV over the dark-adapted level: a white blob under the tone map.
//   The eye adapts locally and sees maria, so the whole disc is scaled by k = min(1, L_cap / L_peak), with
//   L_cap = 2^MOON_DISPLAY_EV * 0.18 / sceneExposure() (the eye's adaptation, previous frame) and L_peak the
//   radiance of the brightest highlands at full phase: the brightest ground lands MOON_DISPLAY_EV over middle grey
//   and every albedo and terminator gradient below it survives (a per-pixel min would clip the highlands flat).
//   One scale for the whole disc keeps the flux bounded by L_cap x the disc's solid angle, whatever the real Moon
//   does, so the size setting barely moves the auto-exposure (measured < 0.05 EV between s = 1 and s = 5).
// - Moonlight on the ground, aircraft and sky (Atmosphere.moonIlluminance, the sky-view LUT) comes from
//   Celestial.moonIlluminance and never from the disc or the size setting.
// - Earthshine and a faint aureole are cinematic (agent choice), and only where the cap acts (by day the disc is
//   physical: earthshine 1.5e-4 of full, no aureole). The cap itself is gated by the dome's uNight (sun below
//   +5.7 deg), so a dim day never caps or styles the disc.

import * as THREE from 'three';
import type { SimContext } from '../../core/context';
import { DEG } from '../../core/math';
import { MOON_TINT } from './Atmosphere';
import type { Celestial } from './celestial';
import { DEFAULT_MOON_SCALE, MOON_ANGULAR_RADIUS, MOON_FULL_ILLUMINANCE_TOA, MOON_SCALE_MAX, MOON_SCALE_MIN } from './params';

const MOON_SOLID_ANGLE = Math.PI * MOON_ANGULAR_RADIUS * MOON_ANGULAR_RADIUS;

/** Extra horizon growth at s = 4 (agent choice): g(0) = 1 + G. */
export const MOON_HORIZON_GROWTH = 0.6;
/** Altitude above which the Moon has no horizon growth, rad (agent choice). */
export const MOON_HORIZON_KNEE = 35 * DEG;

/**
 * Night display level of the brightest highlands at full phase, EV over middle grey (agent choice). AgX reaches
 * white at +3.7 EV (post/ToneMap.ts): +3 keeps the highlands just under white and the maria ~1.7 EV lower.
 */
export const MOON_DISPLAY_EV = 3.0;
/**
 * Albedo of the brightest highlands relative to the disc mean: the map's near-side 95th percentile of linear
 * luminance over its disc-weighted mean (0.678 / 0.397, scripts/sky/moon-albedo.py).
 */
export const MOON_PEAK_ALBEDO = 1.7;
/** Cinematic earthshine: EV under the sunlit surface at the same albedo, at full Earth (agent choice). */
export const MOON_EARTHSHINE_EV = 6.5;
/** Physical earthshine relative to full-moon radiance at full Earth (~1e-4, Danjon). */
export const MOON_EARTHSHINE_PHYSICAL = 1.5e-4;
/** Peak aureole radiance just outside the limb, relative to L_cap at full phase (agent choice; <= 0.3). */
export const MOON_AUREOLE = 0.15;

/** Rec. 709 luminance of a linear RGB triple. */
const lum = (v: THREE.Vector3): number => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;

/** Runtime URL of the NASA SVS CGI Moon Kit colour map (public/sky/moon/SOURCE.md). */
const MOON_MAP_PATH = 'sky/moon/lroc_color_2k.jpg';

/** Clamp a size setting into [MOON_SCALE_MIN, MOON_SCALE_MAX]; non-numbers give the default. */
export function clampMoonScale(s: number | undefined | null): number {
  if (typeof s !== 'number' || !Number.isFinite(s)) return DEFAULT_MOON_SCALE;
  return Math.min(MOON_SCALE_MAX, Math.max(MOON_SCALE_MIN, s));
}

/**
 * Apparent angular radius of the drawn Moon, rad, for size setting `scale` (1 = real) with the Moon's centre at
 * altitude `altitudeRad` (see the header).
 */
export function moonApparentRadius(scale: number, altitudeRad: number): number {
  const t = THREE.MathUtils.clamp(altitudeRad / MOON_HORIZON_KNEE, 0, 1);
  const w = 1 - t * t * (3 - 2 * t);
  const g = 1 + (MOON_HORIZON_GROWTH * w * (scale - 1)) / 3;
  return MOON_ANGULAR_RADIUS * scale * g;
}

/**
 * Scale applied to the whole disc's physical radiance (the shader's k, mirrored here): 1 by day (night = 0), when
 * no exposure is known (exposureValid false), or whenever the real Moon is darker than the display cap; < 1 at
 * night. The daylight gate matters: an overcast or low-sun day adapts to a few hundred cd/m^2, where the cap alone
 * would dim the disc and switch on the night styling (earthshine, aureole: the shader gates both by 1 - k).
 * @param sceneExposure the eye's multiplier from scene radiance to display-linear (0.18 = grey), as sceneExposure()
 * @param peakLuminance luminance of the brightest highlands at full phase, scene units
 * @param night the dome's uNight (SkyDome.update: smoothstep(-sunDir.y, -0.1, 0.05); 0 with the sun above +5.7 deg)
 */
export function moonDisplayScale(sceneExposure: number, exposureValid: boolean, peakLuminance: number, night: number): number {
  if (!exposureValid) return 1;
  const cap = (2 ** MOON_DISPLAY_EV * 0.18) / Math.max(sceneExposure, 1e-30);
  return THREE.MathUtils.lerp(1, Math.min(1, cap / peakLuminance), night);
}

/**
 * Selenographic latitude/longitude (rad) seen at disc point p = (x, y) (units of the disc radius; x toward
 * celestial east, y toward celestial north, as the shader's ax / ay), for a Moon without libration whose axis is
 * along celestial north: sub-Earth point (0, 0), lunar north up, lunar EAST (+longitude, IAU) toward celestial
 * WEST (so Mare Crisium, +59 deg, sits on the sky-west limb). The shader mirrors this.
 */
export function moonSurfaceLatLon(x: number, y: number): { lat: number; lon: number } {
  const mu = Math.sqrt(Math.max(0, 1 - x * x - y * y));
  return { lat: Math.asin(THREE.MathUtils.clamp(y, -1, 1)), lon: Math.atan2(-x, mu) };
}

/** Texture coordinate of a selenographic point in the equirectangular map (three's flipY: v = 1 at the top row). */
export function moonTexCoord(lat: number, lon: number): { u: number; v: number } {
  return { u: 0.5 + lon / (2 * Math.PI), v: 0.5 + lat / Math.PI };
}

/** Where on the disc (x east, y north; units of the radius) a selenographic point appears, or null on the far side. */
export function moonDiscPoint(latDeg: number, lonDeg: number): { x: number; y: number } | null {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  if (Math.cos(lat) * Math.cos(lon) <= 0) return null;
  return { x: -Math.cos(lat) * Math.sin(lon), y: Math.sin(lat) };
}

export class MoonModel {
  /** Disc radiance at full phase and real surface brightness, linear RGB scene units (the shader shades the phase). */
  private readonly radiance = MOON_TINT.clone().multiplyScalar(MOON_FULL_ILLUMINANCE_TOA / MOON_SOLID_ANGLE);
  private readonly placeholder = new THREE.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1);
  private map: THREE.Texture | null = null;
  private disposed = false;

  readonly uniforms = {
    uMoonRadiance: { value: this.radiance },
    /** Apparent angular radius of the drawn disc, rad (size setting and horizon growth included). */
    uMoonAngularRadius: { value: MOON_ANGULAR_RADIUS },
    /** The LRO colour map (sRGB decoded by the hardware); a 1x1 placeholder until it has loaded. */
    uMoonMap: { value: this.placeholder as THREE.Texture },
    /** 1 once uMoonMap holds the real map; 0 draws the procedural maria (node tests, first frames, load errors). */
    uMoonMapReady: { value: 0 },
    /**
     * x: luminance cap factor, k = min(1, x / sceneExposure()) at night (2^EV * 0.18 / L_peak).
     * y: physical earthshine (relative to the sunlit surface at the same albedo), z: cinematic earthshine,
     * w: aureole peak relative to the capped full-disc level (the shader gates z and w by 1 - k).
     */
    uMoonLook: { value: new THREE.Vector4() },
  };

  constructor() {
    this.placeholder.needsUpdate = true;
    if (typeof document !== 'undefined') this.load();
  }

  private load(): void {
    const url = `${import.meta.env.BASE_URL}${MOON_MAP_PATH}`;
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        if (this.disposed) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.anisotropy = 4;
        tex.needsUpdate = true;
        this.map = tex;
        this.uniforms.uMoonMap.value = tex;
        this.uniforms.uMoonMapReady.value = 1;
      },
      undefined,
      () => console.warn(`Moon map ${url} failed to load; the procedural Moon stays.`),
    );
  }

  update(ctx: SimContext, celestial: Celestial): void {
    const u = this.uniforms;
    const scale = clampMoonScale(ctx.moonScale);
    u.uMoonAngularRadius.value = moonApparentRadius(scale, Math.asin(THREE.MathUtils.clamp(celestial.moonDir.y, -1, 1)));

    // Earth's phase seen from the Moon: full at new Moon. The cinematic earthshine fades out by first quarter.
    const i = celestial.moonPhaseAngle;
    const earthPhase = (1 - Math.cos(i)) / 2;
    const fade = THREE.MathUtils.smoothstep(i, 80 * DEG, 130 * DEG);
    // Aureole follows the illuminated fraction (a thin crescent has little glow).
    const litFraction = (1 + Math.cos(i)) / 2;
    u.uMoonLook.value.set(
      (2 ** MOON_DISPLAY_EV * 0.18) / (lum(this.radiance) * MOON_PEAK_ALBEDO),
      MOON_EARTHSHINE_PHYSICAL * earthPhase,
      2 ** -MOON_EARTHSHINE_EV * earthPhase * fade,
      MOON_AUREOLE * litFraction,
    );
  }

  dispose(): void {
    this.disposed = true;
    this.map?.dispose();
    this.placeholder.dispose();
  }
}
