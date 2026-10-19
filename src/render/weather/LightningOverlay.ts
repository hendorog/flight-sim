// Lightning flashes and bolts from the storm cells (WeatherSettings.storms): a post-TAA overlay (PostPipeline
// addOverlay), so a flash shorter than a frame is not averaged away by the temporal pass. Created at boot whether or
// not the weather has cells. active() advances the strike schedule and is false while no flash is lit (after the
// first render), so PostPipeline skips the overlay between flashes; rendered with no flash lit it copies its input.
//
// Each frame it asks the scheduler (sim/weather/lightning.ts strikesBetween) for the strikes that began since the
// last frame's simulation time (none while paused; a jump back in time, a reset, drops the lit flashes; a jump of
// more than MAX_WINDOW_S forward skips the window), keeps up to MAX_FLASHES lit, emits ctx.events 'lightning' once
// per strike (the thunder, AudioSystem) and writes ctx.weatherFx.flash (the brightest).
// A flash is a point light at the strike (cloud-to-ground: at the cloud base above the ground point; intracloud: at
// its height in the cell) with luminous intensity FLASH_INTENSITY_CD x energy x the stroke envelope (flashEnvelope).
// An intracloud flash sends FLASH_IC_OUTSIDE of its light to the surfaces and the cumulus (the rest stays in the
// storm cloud, which it lights in full). Per pixel, with E = intensity / (d^2 + FLASH_SOFTEN_M^2) at the pixel's
// point:
//   opaque surface (depth buffer)  c *= min(8, 1 + E / A), weighted by the clouds' T in front; A, the surface's
//                                  illuminance before the flash: pi lum(skyColor) + max(sunDir.y, 0) lum(sunColor)
//   cloud (the cumulus front from the clouds' reprojection layer, the storm front from stormLayerOf, each averaged
//   over a 3 x 3 box of taps)      each layer lit at its own front: c += a_near E'(front_near) g h_near
//                                  + T_near a_far E'(front_far) g h_far, with a = smoothstep(0.02, 0.5, 1 - T),
//                                  g = FLASH_CLOUD_GAIN, h = exp(-hazeExtinction front), E' softened by
//                                  FLASH_CLOUD_SOFTEN_M; the sum L of the two is compressed to L / sqrt(1 + L /
//                                  Lmax), Lmax = FLASH_CLOUD_MAX A / pi (FLASH_CLOUD_MAX times a white surface
//                                  under A; for L above Lmax it grows as sqrt(L Lmax)); once the eye's adaptation
//                                  is known, that result L' is reduced again to L' / (1 + L' / Lc), Lc =
//                                  FLASH_CLOUD_EXPOSED_MAX / sceneExposure(), so the lit cloud stays below
//                                  FLASH_CLOUD_EXPOSED_MAX in exposed units, under the channel's core
// A cloud-to-ground strike also draws its channel (boltGeometry.ts: the BOLT_SEGMENTS segments of its path, its top
// moved sideways by up to BOLT_SLANT of its height and kept within BOLT_TOP_MAX_R of the core radius from the
// cell's centre, and up to BOLT_MAX_BRANCHES side branches of BRANCH_SEGMENTS
// segments rooted below the cloud base, projected on the CPU). Per pixel, at the distance r (px) to the nearest
// segment (in CSS pixels: render-buffer pixels / uPxScale): a core Lc exp(-r^2 / (2 BOLT_CORE_PX^2)) and a halo BOLT_HALO_SHARE Lc exp(-r / BOLT_HALO_PX), with Lc =
// min(BOLT_RADIANCE, BOLT_CORE_EXPOSED / sceneExposure()) (the eye's adaptation of the last frame, shared through
// Atmosphere.exposureUniforms; BOLT_RADIANCE before the first adaptation: a white core whose halo stays a few pixels
// wide at night) x the stroke envelope (flashEnvelope) on the channel and BRANCH_SHARE x the first stroke's envelope on the branches (the later
// strokes follow the channel only), fading to BRANCH_TIP along a branch. Occlusion: depth-tested against the scene;
// hidden behind the front of a cumulus layer with T < BOLT_HIDE_T and dimmed by a thinner one's T; the storm cells
// by the optical depth from the camera to each channel point through their density (stormGlsl.ts cellDensity at
// mean noise, integrated on the CPU, stormTau): the cloud's (core and anvil) dims both by exp(-tau), so the
// channel inside the cloud is not drawn and only lights it (the cloud term); the rain's by exp(-(1 -
// RAIN_DIFFRACTION_SHARE) tau) (the share of the drops' extinction diffracted within a fraction of a pixel of the
// line of sight stays in the image). Then exp(-hazeExtinction d). Only the brightest lit ground strike draws a channel. An intracloud strike draws none.
// Alpha passes through.
// The flash enters none of the exposure references (greyCardLuminance, NightLook.outdoorGreyCard, the
// estimateExposure copies); the auto exposure meters it after.
// The first render draws the lightning material with no flash (output = input) instead of the copy, so the shader
// compiles in the Simulator's shader warm-up rather than at the first strike.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { SCENE_UNITS_PER_LUX, type SceneEffect, type SimContext } from '../../core/context';
import { DEPTH_GLSL } from '../../core/shaderLib';
import { stormsOf } from '../../core/weatherFields';
import { flashEnd, flashEnvelope, makeStrike, strikesBetween, type Strike } from '../../sim/weather/lightning';
import type { CloudsEffect } from '../clouds';
import { FULLSCREEN_VERT } from '../clouds/resolveShaders';
import { EXPOSURE_GLSL } from '../post/AutoExposure';
import { Atmosphere } from '../sky/Atmosphere';
import { hashUnit } from '../../physics/weather/random';
import { BOLT_MAX_BRANCHES, BOLT_POINTS, BOLT_SEGMENTS, BOLT_TOP_ABOVE_BASE_M, BRANCH_POINTS, BRANCH_SEGMENTS, boltBranches, boltPath } from './boltGeometry';
import type { WeatherEffectContext } from './index';
import { cellGeometry, makeCellGeometry, stormLayerOf, type CellGeometry, type StormLayer } from './StormCellEffect';
import { STORM_ANVIL_DEPTH_M, STORM_ANVIL_SIGMA, STORM_CORE_SIGMA, STORM_RAY_GLSL, STORM_SHAFT_SIGMA, STORM_VIRGA_DEPTH_M } from './stormGlsl';

/** Flashes lit at once. */
export const MAX_FLASHES = 4;
/** Luminous intensity of a flash at energy 1 and envelope 1, cd. Unconfirmed: a tuning value, no source checked. */
export const FLASH_INTENSITY_CD = 1e8;
/** Softening distance of the flash's inverse-square falloff, m. */
export const FLASH_SOFTEN_M = 400;
/** Softening distance for cloud pixels, m (the flash's light spreads through the cloud). Unconfirmed: a look value. */
export const FLASH_CLOUD_SOFTEN_M = 1500;
/** Share of the illuminance a lit cloud pixel adds as radiance. Unconfirmed: a look value. */
export const FLASH_CLOUD_GAIN = 0.6;
/** Largest brightening of an opaque surface by a flash (a multiple of its colour). */
export const FLASH_SURFACE_MAX = 8;
/**
 * Radiance a flash adds to the clouds above which it grows as its square root, as a multiple of a white surface's
 * under the light before the flash (A / pi). Unconfirmed: a look value (at night the cloud light of a flash is
 * many times this; compressed, the lit cloud keeps a gradient instead of a white frame).
 */
export const FLASH_CLOUD_MAX = 6;
/**
 * Radiance in the tone map's input (exposed) units that the cloud light of a flash approaches and stays below once
 * the eye's adaptation is known (display white is about 16 there, the channel's core BOLT_CORE_EXPOSED). Unconfirmed:
 * a look value.
 */
export const FLASH_CLOUD_EXPOSED_MAX = 8;
/** Share of an intracloud flash's light that reaches the surfaces and the cumulus. Unconfirmed: a look value. */
export const FLASH_IC_OUTSIDE = 0.15;
/**
 * Radiance of a bolt's core at envelope 1, scene units: BOLT_RADIANCE, or BOLT_CORE_EXPOSED in the tone map's input
 * (exposed) units when that is less (display white is about 16 there, post/Bloom.ts). Unconfirmed: look values.
 */
export const BOLT_RADIANCE = 1e5;
export const BOLT_CORE_EXPOSED = 64;
/** Gaussian radius of the core, CSS px (about 1.6 px across at half its peak). Unconfirmed: a look value. */
export const BOLT_CORE_PX = 0.7;
/** The halo's radiance as a share of the core's, and its falloff length, CSS px. Unconfirmed: look values. */
export const BOLT_HALO_SHARE = 0.05;
export const BOLT_HALO_PX = 2.5;
/** Distance from the channel beyond which neither is drawn, CSS px. */
export const BOLT_MAX_PX = 10;
/** Brightness of a branch's root relative to the channel, and of its tip relative to its root. Unconfirmed: look values. */
export const BRANCH_SHARE = 0.6;
export const BRANCH_TIP = 0.1;
/** Largest sideways offset of the channel's top from its ground point, as a share of its height. Unconfirmed: a look value. */
export const BOLT_SLANT = 0.3;
/**
 * Largest horizontal distance of the channel's top from the cell's centre, as a share of its core radius (the top is
 * pulled in to it), so the upper channel stays inside the core, where stormTau hides it. Unconfirmed: a look value.
 */
export const BOLT_TOP_MAX_R = 0.5;
/**
 * Share of the rain's extinction that is diffraction, kept in the channel's image: drops of about 1 mm diffract
 * within about lambda / d = 5e-4 rad, under a pixel. 0.5 is the large-particle limit (extinction efficiency 2, half
 * of it diffraction). Unconfirmed: not checked against a source here.
 */
export const RAIN_DIFFRACTION_SHARE = 0.5;
/** A cloud layer with less transmittance than this hides the part of the channel behind its front. */
export const BOLT_HIDE_T = 0.9;
/** A larger forward jump of the simulation time than this, s, skips the strikes of the window. */
export const MAX_WINDOW_S = 2;
/** Seed of the channel's slant (hashUnit). */
const SLANT_SEED = 0x51a7;

/** A lit flash. */
interface Flash {
  strike: Strike;
  /** Light position, three.js world. */
  x: number;
  y: number;
  z: number;
  /** Channel points and its side branches' points (cloud-to-ground only), and the branch count. */
  bolt: Float32Array;
  branches: Float32Array;
  branchCount: number;
  hasBolt: boolean;
  end: number;
}

function makeFlash(): Flash {
  return {
    strike: makeStrike(),
    x: 0,
    y: 0,
    z: 0,
    bolt: new Float32Array(3 * BOLT_POINTS),
    branches: new Float32Array(3 * BOLT_MAX_BRANCHES * BRANCH_POINTS),
    branchCount: 0,
    hasBolt: false,
    end: 0,
  };
}

/** Steps of stormTau: over the whole ray, and over its last STORM_TAU_END_M (where a point less than that inside the cloud gathers its optical depth). */
const STORM_TAU_STEPS = 32;
const STORM_TAU_END_STEPS = 12;
const STORM_TAU_END_M = 600;

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Extinction of the cells at (x, y, z), 1/m, written as out.cloud (core and anvil) and out.rain: stormGlsl.ts
 * cellDensity with the noise at its mean (n = 0.5: no billow, the noise factors 0.8, 0.75 and 0.85).
 */
function stormSigma(cells: readonly CellGeometry[], count: number, x: number, y: number, z: number, out: { cloud: number; rain: number }): void {
  let cloud = 0;
  let rain = 0;
  for (let i = 0; i < count; i++) {
    const g = cells[i];
    const R = g.radius;
    const r = Math.hypot(x - g.x, z - g.z);
    const anvilBot = g.top - STORM_ANVIL_DEPTH_M;
    const h = Math.min(1, Math.max(0, (y - g.base) / Math.max(anvilBot - g.base, 1)));
    const Rh = R * (0.75 + 0.25 * Math.sin(Math.PI * h)) * (1 + 0.6 * smoothstep(0.7, 1, h));
    const core = smoothstep(Rh, 0.6 * Rh, r) * smoothstep(g.base, g.base + 60, y) * (1 - smoothstep(anvilBot + 100, anvilBot + 400, y)) * 0.8;
    const ra = Math.hypot(x - g.anvilX, z - g.anvilZ);
    const e = Math.min(1, Math.max(0, ra / Math.max(g.anvilRadius, 1)));
    const bot = anvilBot + 900 * e * e;
    const anvil = smoothstep(g.anvilRadius, 0.5 * g.anvilRadius, ra) * smoothstep(bot, bot + 200, y) * (1 - smoothstep(g.top - 250, g.top, y)) * 0.75;
    const below = 1 - smoothstep(g.base - 100, g.base, y);
    const shaft = smoothstep(g.shaftRadius, 0.3 * g.shaftRadius, r);
    const foot = smoothstep(R, 0.6 * R, r);
    const virga = Math.max(foot - shaft, 0) * smoothstep(g.base - STORM_VIRGA_DEPTH_M, g.base, y);
    cloud += core * STORM_CORE_SIGMA + anvil * STORM_ANVIL_SIGMA;
    rain += (shaft + virga) * below * g.intensity * 0.85 * STORM_SHAFT_SIGMA;
  }
  out.cloud = cloud;
  out.rain = rain;
}

const _sigma = { cloud: 0, rain: 0 };

const _hit: CellGeometry[] = [];

/**
 * Optical depth of the cells' cloud (out.cloud) and rain (out.rain) from `from` to (x, y, z), by the midpoint rule:
 * STORM_TAU_STEPS steps up to STORM_TAU_END_M before the point and STORM_TAU_END_STEPS over the rest. Cells whose
 * bounding circle (boundX, boundZ, boundRadius; the density is 0 outside it) the ray's ground track misses are
 * skipped. At 32 steps a ray of tens of km takes steps of several hundred metres, about the rain shaft's radius,
 * so the rain's optical depth is coarse (it enters the channel's weight as exp(-0.5 tau)).
 */
export function stormTau(cells: readonly CellGeometry[], count: number, from: THREE.Vector3, x: number, y: number, z: number, out: { cloud: number; rain: number }): void {
  out.cloud = 0;
  out.rain = 0;
  if (count <= 0) return;
  const dx = x - from.x, dy = y - from.y, dz = z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len <= 0) return;
  _hit.length = 0;
  const h2 = dx * dx + dz * dz;
  for (let i = 0; i < count; i++) {
    const g = cells[i];
    const ox = g.boundX - from.x, oz = g.boundZ - from.z;
    const t = h2 > 0 ? Math.min(1, Math.max(0, (ox * dx + oz * dz) / h2)) : 0;
    if (Math.hypot(ox - t * dx, oz - t * dz) <= g.boundRadius) _hit.push(g);
  }
  if (_hit.length === 0) return;
  const hit = _hit;
  const n = hit.length;
  const split = Math.max(0, len - STORM_TAU_END_M) / len;
  const part = (s0: number, s1: number, steps: number): void => {
    const ds = (s1 - s0) / steps;
    if (ds <= 0) return;
    for (let k = 0; k < steps; k++) {
      const s = s0 + (k + 0.5) * ds;
      stormSigma(hit, n, from.x + dx * s, from.y + dy * s, from.z + dz * s, _sigma);
      out.cloud += _sigma.cloud * ds * len;
      out.rain += _sigma.rain * ds * len;
    }
  };
  part(0, split, STORM_TAU_STEPS);
  part(split, 1, STORM_TAU_END_STEPS);
}

export const LIGHTNING_FRAG = /* glsl */ `
${DEPTH_GLSL}
${STORM_RAY_GLSL}
in vec2 vUv;
layout(location = 0) out vec4 outColor;
uniform sampler2D uScene;
uniform sampler2D uDepth;
uniform sampler2D uCuDist;
uniform sampler2D uCuTrans;
uniform float uHasCu;
uniform vec2 uCuTexel;
uniform vec2 uCbTexel;
uniform sampler2D uCbDist;
uniform sampler2D uCbTrans;
uniform float uHasCb;
uniform vec4 uFlash[${MAX_FLASHES}];   // xyz world, w intensity (scene units x m^2)
uniform float uFlashOutside[${MAX_FLASHES}]; // per flash: the share of its light outside the storm cloud
uniform int uFlashCount;
// Channel and branch points: xy pixel, z distance from the camera m, w weight 0..1 (negative: behind the camera).
uniform vec4 uBolt[${BOLT_POINTS}];
uniform vec4 uBranch[${BOLT_MAX_BRANCHES * BRANCH_POINTS}];
uniform float uBoltGain;               // envelope x energy of the channel and of the branches
uniform float uBranchGain;
uniform float uExposureValid;
${EXPOSURE_GLSL}
uniform vec2 uFullSize;
uniform float uPxScale;                // render-buffer pixels per CSS pixel (>= 1)
uniform float uAmbient;                // the surface's illuminance before the flash, scene units (> 0)
uniform float uHazeExt;

// Illuminance of the flashes at p, softened by soften2 (m^2); outside 1: at a point outside the storm cloud.
float flashE(vec3 p, float soften2, float outside) {
  float e = 0.0;
  for (int i = 0; i < ${MAX_FLASHES}; i++) {
    if (i >= uFlashCount) break;
    vec3 d = p - uFlash[i].xyz;
    e += uFlash[i].w * mix(1.0, uFlashOutside[i], outside) / (dot(d, d) + soften2);
  }
  return e;
}

// A cloud layer's transmittance (x) and front distance (y, m; weighted by opacity) in front of a surface at dist,
// averaged over a 3 x 3 box of taps 1.5 texels apart (the layer is the jittered, lower-resolution march of this
// frame; the overlay runs after the temporal pass).
vec2 layerAt(sampler2D trans, sampler2D front, vec2 texel, float dist) {
  float T = 0.0, fs = 0.0, fw = 0.0;
  for (int k = 0; k < 9; k++) {
    vec2 o = vec2(float(k % 3) - 1.0, float(k / 3) - 1.0) * 1.5 * texel;
    float t = clamp(texture(trans, vUv + o).a, 0.0, 1.0);
    float f = exp2(texture(front, vUv + o).r) - 1.0;
    if (f >= dist) t = 1.0;
    T += t;
    fs += f * (1.0 - t);
    fw += 1.0 - t;
  }
  return vec2(T / 9.0, fw > 1e-4 ? fs / fw : 1e9);
}

// The light a flash adds to a cloud layer seen with transmittance T at its front: (1 - T) (from 0 below an
// opacity of 0.02, so the march's edge noise stays unlit) x E at the front x FLASH_CLOUD_GAIN, through the haze.
vec3 cloudLight(vec3 dir, vec2 tf, float outside) {
  float a = smoothstep(0.02, 0.5, 1.0 - tf.x);
  if (a <= 0.0) return vec3(0.0);
  return vec3(a * flashE(uCamPos + dir * tf.y, ${(FLASH_CLOUD_SOFTEN_M * FLASH_CLOUD_SOFTEN_M).toFixed(1)}, outside) * ${FLASH_CLOUD_GAIN.toFixed(3)} * exp(-uHazeExt * tf.y));
}

// One channel segment's core (x) and halo (y) at pixel px, per unit core radiance, over a surface at dist (0 when hidden), with the
// cumulus layer cu (transmittance, front distance) in front.
vec2 boltSegment(vec4 a, vec4 b, vec2 px, float dist, vec2 cu) {
  if (a.w < 0.0 || b.w < 0.0 || a.w + b.w <= 0.0) return vec2(0.0);
  vec2 ab = b.xy - a.xy;
  float h = clamp(dot(px - a.xy, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  float r = length(px - a.xy - ab * h) / uPxScale;
  if (r > ${BOLT_MAX_PX.toFixed(1)}) return vec2(0.0);
  float z = mix(a.z, b.z, h);
  if (z > dist) return vec2(0.0);
  // Behind the cumulus front: hidden by a layer of transmittance below BOLT_HIDE_T (the flash's light there is the
  // cloud term), dimmed by a thinner one.
  float through = 1.0;
  if (z > cu.y + 100.0) {
    if (cu.x < ${BOLT_HIDE_T.toFixed(2)}) return vec2(0.0);
    through = cu.x;
  }
  float w = mix(a.w, b.w, h) * through * exp(-uHazeExt * z);
  return w * vec2(exp(-0.5 * r * r / ${(BOLT_CORE_PX * BOLT_CORE_PX).toFixed(4)}), ${BOLT_HALO_SHARE.toFixed(3)} * exp(-r / ${BOLT_HALO_PX.toFixed(2)}));
}

void main() {
  vec4 c = texture(uScene, vUv);
  float dd = texture(uDepth, vUv).r;
  bool sky = isSky(dd);
  vec3 dv = rayDirView(vUv);
  vec3 dir = normalize(mat3(uCamWorld) * dv);
  float dist = sky ? 1e8 : viewZFromDepth(dd) / max(-dv.z, 1e-4);
  // The two cloud layers in front of the surface, each (transmittance, front distance); a layer that is absent or
  // clear here is (1, 1e9). The nearer one is lit at its front, the farther at its own front behind the nearer's T.
  vec2 cu = vec2(1.0, 1e9);
  vec2 cb = vec2(1.0, 1e9);
  if (uHasCu > 0.5) {
    vec2 tf = layerAt(uCuTrans, uCuDist, uCuTexel, dist);
    if (tf.x < 0.999) cu = tf;
  }
  if (uHasCb > 0.5) {
    vec2 tf = layerAt(uCbTrans, uCbDist, uCbTexel, dist);
    if (tf.x < 0.999) cb = tf;
  }
  vec2 near = cu.y <= cb.y ? cu : cb;
  vec2 far = cu.y <= cb.y ? cb : cu;
  float T = near.x * far.x;
  vec3 rgb = c.rgb;
  if (uFlashCount > 0) {
    if (!sky) {
      float k = min(${FLASH_SURFACE_MAX.toFixed(1)}, 1.0 + flashE(uCamPos + dir * dist, ${(FLASH_SOFTEN_M * FLASH_SOFTEN_M).toFixed(1)}, 1.0) / uAmbient);
      rgb *= mix(1.0, k, T);
    }
    if (T < 0.999) {
      // The cumulus is outside the storm cloud.
      float nearOut = cu.y <= cb.y ? 1.0 : 0.0;
      vec3 l = cloudLight(dir, near, nearOut) + near.x * cloudLight(dir, far, 1.0 - nearOut);
      float lmax = ${(FLASH_CLOUD_MAX / Math.PI).toFixed(4)} * uAmbient;
      l /= sqrt(1.0 + dot(l, vec3(0.2126, 0.7152, 0.0722)) / lmax);
      if (uExposureValid > 0.5) l /= 1.0 + dot(l, vec3(0.2126, 0.7152, 0.0722)) * sceneExposure() / ${FLASH_CLOUD_EXPOSED_MAX.toFixed(1)};
      rgb += l;
    }
  }
  if (uBoltGain > 0.0) {
    vec2 px = vUv * uFullSize;
    vec2 chan = vec2(0.0);
    for (int i = 0; i < ${BOLT_SEGMENTS}; i++) chan = max(chan, boltSegment(uBolt[i], uBolt[i + 1], px, dist, cu));
    vec2 side = vec2(0.0);
    for (int i = 0; i < ${BOLT_MAX_BRANCHES * BRANCH_POINTS - 1}; i++) {
      // The last point of one branch and the first of the next are no segment.
      if (i % ${BRANCH_POINTS} == ${BRANCH_SEGMENTS}) continue;
      side = max(side, boltSegment(uBranch[i], uBranch[i + 1], px, dist, cu));
    }
    vec2 g = max(chan * uBoltGain, side * uBranchGain);
    float lc = ${BOLT_RADIANCE.toFixed(1)};
    if (uExposureValid > 0.5) lc = min(lc, ${BOLT_CORE_EXPOSED.toFixed(1)} / sceneExposure());
    rgb += lc * (g.x + g.y) * vec3(0.86, 0.9, 1.0);
  }
  outColor = vec4(rgb, c.a);
}
`;

const COPY_FRAG = /* glsl */ `
in vec2 vUv;
layout(location = 0) out vec4 outColor;
uniform sampler2D uScene;
void main() { outColor = texture(uScene, vUv); }
`;

type Uniforms = Record<string, THREE.IUniform>;

function fullscreenMaterial(fragmentShader: string, uniforms: Uniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false });
}

/** One texel of a render target's texture in uv (1 when the size is unknown). */
function texelOf(tex: THREE.Texture, out: THREE.Vector2): void {
  const img = tex.image as { width?: number; height?: number } | undefined;
  out.set(1 / Math.max(1, img?.width ?? 1), 1 / Math.max(1, img?.height ?? 1));
}

const lum = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

export class LightningOverlay implements SceneEffect {
  readonly name = 'lightning';
  /** Lit flashes (the first `lit` entries). */
  private readonly flashes: Flash[] = Array.from({ length: MAX_FLASHES }, makeFlash);
  private lit = 0;
  /** Strikes added by inject(), started on the next render. */
  private readonly injected: Strike[] = [];
  private readonly found: Strike[] = [];
  private lastTime: number | null = null;
  private readonly geometry = makeCellGeometry();
  private readonly quad = new FullScreenQuad();
  readonly material: THREE.ShaderMaterial;
  private readonly copyMat: THREE.ShaderMaterial;
  private width = 1;
  private height = 1;
  /** Whether the lightning material has been drawn once (compiled). */
  private warmed = false;

  private readonly invProj = new THREE.Matrix4();
  private readonly camWorld = new THREE.Matrix4();
  private readonly camPos = new THREE.Vector3();
  private readonly fullSize = new THREE.Vector2(1, 1);
  private readonly flashU = Array.from({ length: MAX_FLASHES }, () => new THREE.Vector4());
  private readonly flashOutside = new Float32Array(MAX_FLASHES).fill(1);
  /** The first return stroke of the brightest lit ground strike (flashEnvelope of its branches). */
  private readonly firstStroke = { tStart: 0, strokes: 1 };
  private readonly boltU = Array.from({ length: BOLT_POINTS }, () => new THREE.Vector4());
  private readonly branchU = Array.from({ length: BOLT_MAX_BRANCHES * BRANCH_POINTS }, () => new THREE.Vector4());
  private readonly tau = { cloud: 0, rain: 0 };
  /** The renderer's atmosphere (exposureOf; undefined until the first lit render, null when there is none). */
  private atmosphere: Atmosphere | null | undefined = undefined;
  private readonly viewProj = new THREE.Matrix4();
  private readonly v = new THREE.Vector4();
  private readonly tmp = new THREE.Vector3();
  private readonly size = new THREE.Vector2();

  /**
   * `clouds`: the cumulus effect (its reprojection layer gives the cloud front); `storms`: the storm layer of the
   * same context (stormLayerOf), or null.
   */
  constructor(
    private readonly clouds: CloudsEffect | null,
    private readonly storms: (ctx: SimContext) => StormLayer | null = stormLayerOf,
  ) {
    const camera: Uniforms = { uInvProj: { value: this.invProj }, uCamWorld: { value: this.camWorld }, uCamPos: { value: this.camPos } };
    this.material = fullscreenMaterial(LIGHTNING_FRAG, {
      ...camera,
      uScene: { value: null },
      uDepth: { value: null },
      uCuDist: { value: null },
      uCuTrans: { value: null },
      uHasCu: { value: 0 },
      uCuTexel: { value: new THREE.Vector2(1, 1) },
      uCbTexel: { value: new THREE.Vector2(1, 1) },
      uCbDist: { value: null },
      uCbTrans: { value: null },
      uHasCb: { value: 0 },
      uFlash: { value: this.flashU },
      uFlashOutside: { value: this.flashOutside },
      uFlashCount: { value: 0 },
      uBolt: { value: this.boltU },
      uBranch: { value: this.branchU },
      uBoltGain: { value: 0 },
      uBranchGain: { value: 0 },
      tExposure: { value: null },
      uExposureBias: { value: 0 },
      uExposureValid: { value: 0 },
      uFullSize: { value: this.fullSize },
      uPxScale: { value: 1 },
      uAmbient: { value: 1 },
      uHazeExt: { value: 0 },
    });
    this.copyMat = fullscreenMaterial(COPY_FRAG, { uScene: { value: null } });
  }

  /** Lit flashes as of the last render. */
  get litCount(): number {
    return this.lit;
  }

  /**
   * Start a strike on the next render, in addition to the schedule (dev pages and tools). Its `cell` must index the
   * weather's storms; its tStart is simulation time.
   */
  inject(strike: Strike): void {
    this.injected.push({ ...strike });
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.fullSize.set(this.width, this.height);
  }

  /** Advance the schedule to ctx.simTime: start new strikes, drop finished ones (no rendering; for tests too). */
  advance(ctx: SimContext): void {
    const t = ctx.simTime;
    const cells = stormsOf(ctx.weather);
    if (this.lastTime === null || t < this.lastTime) {
      // First frame, or a reset / restore moved the clock back: nothing carries over.
      this.lit = 0;
      this.lastTime = t;
    }
    let n = 0;
    if (t - this.lastTime <= MAX_WINDOW_S) n = strikesBetween(cells, this.lastTime, t, this.found);
    this.lastTime = t;
    for (let i = 0; i < n; i++) this.start(this.found[i], ctx);
    for (const s of this.injected) this.start(s, ctx);
    this.injected.length = 0;
    // Drop the finished flashes (keep the order of the rest).
    let k = 0;
    for (let i = 0; i < this.lit; i++) {
      if (t <= this.flashes[i].end) {
        if (k !== i) {
          const keep = this.flashes[i];
          this.flashes[i] = this.flashes[k];
          this.flashes[k] = keep;
        }
        k++;
      }
    }
    this.lit = k;
  }

  private start(s: Strike, ctx: SimContext): void {
    const cells = stormsOf(ctx.weather);
    const cell = cells[s.cell];
    if (!cell) return;
    // Reuse a free slot, else the flash that ends first.
    let slot = this.lit;
    if (slot >= MAX_FLASHES) {
      slot = 0;
      for (let i = 1; i < MAX_FLASHES; i++) if (this.flashes[i].end < this.flashes[slot].end) slot = i;
    } else {
      this.lit++;
    }
    const f = this.flashes[slot];
    Object.assign(f.strike, s);
    const g = cellGeometry(cell, ctx.weather, s.tStart, this.geometry);
    const x = s.east;
    const z = -s.north;
    const ground = ctx.env.groundElevation(s.north, s.east);
    const groundY = Number.isFinite(ground) ? ground : 0;
    const flashY = g.base + s.heightFrac * (g.top - g.base);
    f.x = x;
    f.z = z;
    f.end = flashEnd(s);
    f.hasBolt = s.kind === 'cg';
    let altM = flashY;
    f.branchCount = 0;
    if (f.hasBolt) {
      const topY = Math.min(g.top, g.base + BOLT_TOP_ABOVE_BASE_M);
      const slant = BOLT_SLANT * hashUnit(SLANT_SEED, s.id, 0) * Math.max(0, topY - groundY);
      const heading = 2 * Math.PI * hashUnit(SLANT_SEED, s.id, 1);
      let topX = x + slant * Math.cos(heading);
      let topZ = z + slant * Math.sin(heading);
      const fromC = Math.hypot(topX - g.x, topZ - g.z);
      const maxC = BOLT_TOP_MAX_R * g.radius;
      if (fromC > maxC) {
        topX = g.x + (topX - g.x) * (maxC / fromC);
        topZ = g.z + (topZ - g.z) * (maxC / fromC);
      }
      boltPath(s.id, { x: topX, y: topY, z: topZ }, { x, y: groundY, z }, f.bolt);
      f.branchCount = boltBranches(s.id, f.bolt, g.base, f.branches);
      // The channel's light comes out under the base, where the channel leaves the cloud; the thunder's channel
      // runs to its top.
      for (let i = 1; i < BOLT_POINTS; i++) {
        if (f.bolt[3 * i + 1] > g.base) continue;
        f.x = f.bolt[3 * i];
        f.z = f.bolt[3 * i + 2];
        break;
      }
      f.y = g.base;
      altM = topY;
    } else {
      f.y = flashY;
    }
    ctx.events.emit('lightning', { id: s.id, kind: s.kind, north: s.north, east: s.east, altM, energy: s.energy, strokes: s.strokes });
  }

  /**
   * Advance the schedule (advance; render's own call at the same simTime then starts nothing) and report whether a
   * flash is lit, or the first render (which compiles the lightning material) is still to come. A false result
   * publishes no flash (ctx.weatherFx.flash energy 0), as render's copy does.
   */
  active(ctx: SimContext): boolean {
    if (!this.warmed) return true;
    this.advance(ctx);
    if (this.lit > 0) return true;
    const fx = ctx.weatherFx?.flash;
    if (fx) fx.energy = 0;
    return false;
  }

  render(renderer: THREE.WebGLRenderer, input: THREE.Texture, depth: THREE.DepthTexture, output: THREE.WebGLRenderTarget, ctx: SimContext): void {
    const prevTarget = renderer.getRenderTarget();
    this.advance(ctx);
    const t = ctx.simTime;
    const u = this.material.uniforms;
    let count = 0;
    let best = -1;
    let bestE = 0;
    let bolt = -1;
    let boltE = 0;
    let boltFirst = 0;
    for (let i = 0; i < this.lit; i++) {
      const f = this.flashes[i];
      const e = flashEnvelope(f.strike, t) * f.strike.energy;
      if (e < 1e-3) continue;
      const intensity = e * FLASH_INTENSITY_CD * SCENE_UNITS_PER_LUX;
      this.flashOutside[count] = f.hasBolt ? 1 : FLASH_IC_OUTSIDE;
      this.flashU[count++].set(f.x, f.y, f.z, intensity);
      if (intensity > bestE) {
        bestE = intensity;
        best = i;
      }
      if (f.hasBolt && e > boltE) {
        boltE = e;
        bolt = i;
        this.firstStroke.tStart = f.strike.tStart;
        boltFirst = flashEnvelope(this.firstStroke, t) * f.strike.energy;
      }
    }
    const fx = ctx.weatherFx?.flash;
    if (fx) {
      if (best >= 0) {
        const f = this.flashes[best];
        fx.x = f.x;
        fx.y = f.y;
        fx.z = f.z;
      }
      fx.energy = bestE;
    }
    if (count === 0 && this.warmed) {
      this.copyMat.uniforms.uScene.value = input;
      this.draw(renderer, this.copyMat, output);
      renderer.setRenderTarget(prevTarget);
      return;
    }
    this.warmed = true;
    const camera = ctx.camera;
    this.invProj.copy(camera.projectionMatrixInverse);
    this.camWorld.copy(camera.matrixWorld);
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    u.uScene.value = input;
    u.uDepth.value = depth;
    u.uFlashCount.value = count;
    u.uAmbient.value = Math.PI * lum(ctx.sky.skyColor) + Math.max(ctx.sky.sunDir.y, 0) * lum(ctx.sky.sunColor) + 1e-3;
    u.uHazeExt.value = ctx.sky.hazeExtinction > 0 ? ctx.sky.hazeExtinction : 3.0 / Math.max(ctx.weather.visibilityM, 100);
    const layer = this.clouds?.reprojectionLayer() ?? null;
    u.uHasCu.value = layer ? 1 : 0;
    u.uCuDist.value = layer?.distance ?? null;
    u.uCuTrans.value = layer?.transmittance ?? null;
    if (layer) texelOf(layer.transmittance, u.uCuTexel.value);
    const storm = this.storms(ctx);
    const stormOn = storm !== null && storm.marched;
    u.uHasCb.value = stormOn ? 1 : 0;
    u.uCbDist.value = stormOn ? storm.distance : null;
    u.uCbTrans.value = stormOn ? storm.transmittance : null;
    if (stormOn) texelOf(storm.transmittance, u.uCbTexel.value);
    u.uBoltGain.value = bolt >= 0 ? boltE : 0;
    // Render-buffer pixels per CSS pixel (1 for a renderer without a canvas size, the tests' fake).
    const cssWidth = typeof renderer.getSize === 'function' ? renderer.getSize(this.size).x : this.width;
    u.uPxScale.value = Math.max(1, this.width / Math.max(1, cssWidth));
    u.uBranchGain.value = bolt >= 0 ? BRANCH_SHARE * boltFirst : 0;
    const exposure = this.exposureOf(renderer);
    u.tExposure.value = exposure?.tExposure.value ?? null;
    u.uExposureBias.value = exposure?.uExposureBias.value ?? 0;
    u.uExposureValid.value = exposure && exposure.tExposure.value ? exposure.uExposureValid.value : 0;
    if (bolt >= 0) {
      const f = this.flashes[bolt];
      const cells = stormOn ? storm.cells : [];
      const n = stormOn ? storm.count : 0;
      this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      for (let i = 0; i < BOLT_POINTS; i++) this.projectPoint(f.bolt, i, 1, cells, n, this.boltU[i]);
      for (let b = 0; b < BOLT_MAX_BRANCHES; b++) {
        for (let j = 0; j < BRANCH_POINTS; j++) {
          const k = b * BRANCH_POINTS + j;
          if (b >= f.branchCount) this.branchU[k].set(0, 0, 0, 0);
          else this.projectPoint(f.branches, k, 1 - (1 - BRANCH_TIP) * (j / BRANCH_SEGMENTS), cells, n, this.branchU[k]);
        }
      }
    }
    this.draw(renderer, this.material, output);
    renderer.setRenderTarget(prevTarget);
  }

  /**
   * Point i of `points` to its pixel (x, y), its distance from the camera (z) and its weight (w; -1 behind the
   * camera): `fade` x the storm cells' transmittance from the camera (stormTau). Needs viewProj.
   */
  private projectPoint(points: Float32Array, i: number, fade: number, cells: readonly CellGeometry[], count: number, out: THREE.Vector4): void {
    const x = points[3 * i], y = points[3 * i + 1], z = points[3 * i + 2];
    this.v.set(x, y, z, 1).applyMatrix4(this.viewProj);
    if (this.v.w <= 1) {
      out.set(0, 0, 0, -1);
      return;
    }
    stormTau(cells, count, this.camPos, x, y, z, this.tau);
    const w = fade * Math.exp(-this.tau.cloud - (1 - RAIN_DIFFRACTION_SHARE) * this.tau.rain);
    const dist = this.tmp.set(x, y, z).distanceTo(this.camPos);
    out.set((this.v.x / this.v.w * 0.5 + 0.5) * this.width, (this.v.y / this.v.w * 0.5 + 0.5) * this.height, dist, w);
  }

  /** The shared eye adaptation (Atmosphere.exposureUniforms), or null without an atmosphere for this renderer. */
  private exposureOf(renderer: THREE.WebGLRenderer): Atmosphere['exposureUniforms'] | null {
    if (this.atmosphere === undefined) {
      try {
        this.atmosphere = Atmosphere.for(renderer);
      } catch {
        this.atmosphere = null;
      }
    }
    return this.atmosphere?.exposureUniforms ?? null;
  }

  dispose(): void {
    this.material.dispose();
    this.copyMat.dispose();
    this.quad.dispose();
  }

  private draw(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }
}

/** The lightning overlay: always created (skipped while no flash is lit). */
export function createLightningOverlay(c: WeatherEffectContext): SceneEffect | null {
  return new LightningOverlay(c.clouds);
}
