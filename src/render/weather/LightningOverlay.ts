// Lightning flashes and bolts from the storm cells (WeatherSettings.storms): a post-TAA overlay (PostPipeline
// addOverlay), so a flash shorter than a frame is not averaged away by the temporal pass. Created at boot whether or
// not the weather has cells; with no flash lit it copies its input.
//
// Each frame it asks the scheduler (sim/weather/lightning.ts strikesBetween) for the strikes that began since the
// last frame's simulation time (none while paused; a jump back in time, a reset, drops the lit flashes; a jump of
// more than MAX_WINDOW_S forward skips the window), keeps up to MAX_FLASHES lit, emits ctx.events 'lightning' once
// per strike (the thunder, AudioSystem) and writes ctx.weatherFx.flash (the brightest).
// A flash is a point light at the strike (cloud-to-ground: at the cloud base above the ground point; intracloud: at
// its height in the cell) with luminous intensity FLASH_INTENSITY_CD x energy x the stroke envelope (flashEnvelope).
// Per pixel, with E = intensity / (d^2 + FLASH_SOFTEN_M^2) at the pixel's point:
//   opaque surface (depth buffer)  c *= min(8, 1 + E / (pi lum(skyColor) + 1e-3)), weighted by the clouds' T in front
//   cloud (the cumulus front from the clouds' reprojection layer, the storm front from stormLayerOf; the nearer,
//   each averaged over 5 taps)     c += (1 - T) E' FLASH_CLOUD_GAIN, E' softened by FLASH_CLOUD_SOFTEN_M
// A cloud-to-ground strike also draws its channel (boltGeometry.ts, BOLT_SEGMENTS segments projected on the CPU):
// glow min(BOLT_MAX, BOLT_RADIANCE envelope exp(-px / 2)) (the bloom adds the halo), depth-tested against the scene,
// dimmed by the clouds' T where it lies behind their front, and by exp(-hazeExtinction d). Only the brightest lit
// ground strike draws a channel. Alpha passes through. The flash enters none of the exposure references
// (greyCardLuminance, NightLook.outdoorGreyCard, the estimateExposure copies); the auto exposure meters it after.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { SCENE_UNITS_PER_LUX, type SceneEffect, type SimContext } from '../../core/context';
import { DEPTH_GLSL } from '../../core/shaderLib';
import { stormsOf } from '../../core/weatherFields';
import { flashEnd, flashEnvelope, makeStrike, strikesBetween, type Strike } from '../../sim/weather/lightning';
import type { CloudsEffect } from '../clouds';
import { FULLSCREEN_VERT } from '../clouds/resolveShaders';
import { BOLT_POINTS, BOLT_SEGMENTS, BOLT_TOP_ABOVE_BASE_M, boltPath } from './boltGeometry';
import type { WeatherEffectContext } from './index';
import { cellGeometry, makeCellGeometry, stormLayerOf, type StormLayer } from './StormCellEffect';
import { STORM_RAY_GLSL } from './stormGlsl';

/** Flashes lit at once. */
export const MAX_FLASHES = 4;
/** Luminous intensity of a flash at energy 1 and envelope 1, cd. Unconfirmed: a tuning value, no source checked. */
export const FLASH_INTENSITY_CD = 1e7;
/** Softening distance of the flash's inverse-square falloff, m. */
export const FLASH_SOFTEN_M = 400;
/** Softening distance for cloud pixels, m (the flash's light spreads through the cloud). Unconfirmed: a look value. */
export const FLASH_CLOUD_SOFTEN_M = 1500;
/** Share of the illuminance a lit cloud pixel adds as radiance. Unconfirmed: a look value. */
export const FLASH_CLOUD_GAIN = 0.6;
/** Largest brightening of an opaque surface by a flash (a multiple of its colour). */
export const FLASH_SURFACE_MAX = 8;
/** Radiance of a bolt's core at envelope 1, and its cap, scene units. Unconfirmed: look values. */
export const BOLT_RADIANCE = 2e5;
export const BOLT_MAX = 60_000;
/** A larger forward jump of the simulation time than this, s, skips the strikes of the window. */
export const MAX_WINDOW_S = 2;

/** A lit flash. */
interface Flash {
  strike: Strike;
  /** Light position, three.js world. */
  x: number;
  y: number;
  z: number;
  /** Channel points (cloud-to-ground only). */
  bolt: Float32Array;
  hasBolt: boolean;
  end: number;
}

function makeFlash(): Flash {
  return { strike: makeStrike(), x: 0, y: 0, z: 0, bolt: new Float32Array(3 * BOLT_POINTS), hasBolt: false, end: 0 };
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
uniform int uFlashCount;
uniform vec4 uBolt[${BOLT_POINTS}];    // xy pixel, z distance from the camera m, w 1 = in front of the camera
uniform float uBoltGain;
uniform vec2 uFullSize;
uniform float uAmbient;                // pi lum(skyColor) + 1e-3
uniform float uHazeExt;

float flashE(vec3 p, float soften2) {
  float e = 0.0;
  for (int i = 0; i < ${MAX_FLASHES}; i++) {
    if (i >= uFlashCount) break;
    vec3 d = p - uFlash[i].xyz;
    e += uFlash[i].w / (dot(d, d) + soften2);
  }
  return e;
}

// A cloud layer's transmittance (x) and front distance (y, m; weighted by opacity) in front of a surface at dist.
vec2 layerAt(sampler2D trans, sampler2D front, vec2 texel, float dist) {
  float T = 0.0, fs = 0.0, fw = 0.0;
  for (int k = 0; k < 5; k++) {
    vec2 o = k == 0 ? vec2(0.0) : vec2(k < 3 ? -0.75 : 0.75, (k & 1) == 1 ? -0.75 : 0.75) * texel;
    float t = clamp(texture(trans, vUv + o).a, 0.0, 1.0);
    float f = exp2(texture(front, vUv + o).r) - 1.0;
    if (f >= dist) t = 1.0;
    T += t;
    fs += f * (1.0 - t);
    fw += 1.0 - t;
  }
  return vec2(T / 5.0, fw > 1e-4 ? fs / fw : 1e9);
}

void main() {
  vec4 c = texture(uScene, vUv);
  float dd = texture(uDepth, vUv).r;
  bool sky = isSky(dd);
  vec3 dv = rayDirView(vUv);
  vec3 dir = normalize(mat3(uCamWorld) * dv);
  float dist = sky ? 1e8 : viewZFromDepth(dd) / max(-dv.z, 1e-4);
  // The clouds in front of the surface: the nearer front and the product of the transmittances, each layer
  // averaged over 5 taps of its (jittered, lower-resolution) march so the flash does not show its noise.
  float T = 1.0;
  float cloudDist = 1e9;
  if (uHasCu > 0.5) {
    vec2 tf = layerAt(uCuTrans, uCuDist, uCuTexel, dist);
    if (tf.x < 0.999) { T *= tf.x; cloudDist = min(cloudDist, tf.y); }
  }
  if (uHasCb > 0.5) {
    vec2 tf = layerAt(uCbTrans, uCbDist, uCbTexel, dist);
    if (tf.x < 0.999) { T *= tf.x; cloudDist = min(cloudDist, tf.y); }
  }
  vec3 rgb = c.rgb;
  if (uFlashCount > 0) {
    if (!sky) {
      float k = min(${FLASH_SURFACE_MAX.toFixed(1)}, 1.0 + flashE(uCamPos + dir * dist, ${(FLASH_SOFTEN_M * FLASH_SOFTEN_M).toFixed(1)}) / uAmbient);
      rgb *= mix(1.0, k, T);
    }
    if (T < 0.999) rgb += (1.0 - T) * flashE(uCamPos + dir * cloudDist, ${(FLASH_CLOUD_SOFTEN_M * FLASH_CLOUD_SOFTEN_M).toFixed(1)}) * ${FLASH_CLOUD_GAIN.toFixed(3)};
  }
  if (uBoltGain > 0.0) {
    vec2 px = vUv * uFullSize;
    float glow = 0.0;
    for (int i = 0; i < ${BOLT_SEGMENTS}; i++) {
      vec4 a = uBolt[i];
      vec4 b = uBolt[i + 1];
      if (a.w < 0.5 || b.w < 0.5) continue;
      vec2 ab = b.xy - a.xy;
      float h = clamp(dot(px - a.xy, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
      float r = length(px - a.xy - ab * h);
      if (r > 24.0) continue;
      float z = mix(a.z, b.z, h);
      if (z > dist) continue;
      float g = min(${BOLT_MAX.toFixed(1)}, uBoltGain * exp(-r * 0.5));
      g *= exp(-uHazeExt * z) * (z > cloudDist ? T : 1.0);
      glow = max(glow, g);
    }
    rgb += glow * vec3(0.86, 0.9, 1.0);
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

  private readonly invProj = new THREE.Matrix4();
  private readonly camWorld = new THREE.Matrix4();
  private readonly camPos = new THREE.Vector3();
  private readonly fullSize = new THREE.Vector2(1, 1);
  private readonly flashU = Array.from({ length: MAX_FLASHES }, () => new THREE.Vector4());
  private readonly boltU = Array.from({ length: BOLT_POINTS }, () => new THREE.Vector4());
  private readonly viewProj = new THREE.Matrix4();
  private readonly v = new THREE.Vector4();
  private readonly tmp = new THREE.Vector3();

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
      uFlashCount: { value: 0 },
      uBolt: { value: this.boltU },
      uBoltGain: { value: 0 },
      uFullSize: { value: this.fullSize },
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
    if (f.hasBolt) {
      const topY = Math.min(g.top, g.base + BOLT_TOP_ABOVE_BASE_M);
      boltPath(s.id, { x, y: topY, z }, { x, y: groundY, z }, f.bolt);
      // The channel's light comes out under the base; the thunder's channel runs to its top.
      f.y = g.base;
      altM = topY;
    } else {
      f.y = flashY;
    }
    ctx.events.emit('lightning', { id: s.id, kind: s.kind, north: s.north, east: s.east, altM, energy: s.energy, strokes: s.strokes });
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
    for (let i = 0; i < this.lit; i++) {
      const f = this.flashes[i];
      const e = flashEnvelope(f.strike, t) * f.strike.energy;
      if (e < 1e-3) continue;
      const intensity = e * FLASH_INTENSITY_CD * SCENE_UNITS_PER_LUX;
      this.flashU[count++].set(f.x, f.y, f.z, intensity);
      if (intensity > bestE) {
        bestE = intensity;
        best = i;
      }
      if (f.hasBolt && e > boltE) {
        boltE = e;
        bolt = i;
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
    if (count === 0) {
      this.copyMat.uniforms.uScene.value = input;
      this.draw(renderer, this.copyMat, output);
      renderer.setRenderTarget(prevTarget);
      return;
    }
    const camera = ctx.camera;
    this.invProj.copy(camera.projectionMatrixInverse);
    this.camWorld.copy(camera.matrixWorld);
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    u.uScene.value = input;
    u.uDepth.value = depth;
    u.uFlashCount.value = count;
    u.uAmbient.value = Math.PI * lum(ctx.sky.skyColor) + 1e-3;
    u.uHazeExt.value = ctx.sky.hazeExtinction > 0 ? ctx.sky.hazeExtinction : 3.0 / Math.max(ctx.weather.visibilityM, 100);
    const layer = this.clouds?.reprojectionLayer() ?? null;
    u.uHasCu.value = layer ? 1 : 0;
    u.uCuDist.value = layer?.distance ?? null;
    u.uCuTrans.value = layer?.transmittance ?? null;
    if (layer) texelOf(layer.transmittance, u.uCuTexel.value);
    const storm = this.storms(ctx);
    const stormOn = storm !== null && storm.active;
    u.uHasCb.value = stormOn ? 1 : 0;
    u.uCbDist.value = stormOn ? storm.distance : null;
    u.uCbTrans.value = stormOn ? storm.transmittance : null;
    if (stormOn) texelOf(storm.transmittance, u.uCbTexel.value);
    u.uBoltGain.value = bolt >= 0 ? BOLT_RADIANCE * boltE : 0;
    if (bolt >= 0) this.projectBolt(this.flashes[bolt].bolt, camera);
    this.draw(renderer, this.material, output);
    renderer.setRenderTarget(prevTarget);
  }

  /** Bolt points to pixels (x, y), distance from the camera (z) and a front-of-camera flag (w). */
  private projectBolt(points: Float32Array, camera: THREE.PerspectiveCamera): void {
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    for (let i = 0; i < BOLT_POINTS; i++) {
      this.v.set(points[3 * i], points[3 * i + 1], points[3 * i + 2], 1).applyMatrix4(this.viewProj);
      const out = this.boltU[i];
      if (this.v.w <= 1) {
        out.set(0, 0, 0, 0);
        continue;
      }
      const dist = this.tmp.set(points[3 * i], points[3 * i + 1], points[3 * i + 2]).distanceTo(this.camPos);
      out.set((this.v.x / this.v.w * 0.5 + 0.5) * this.width, (this.v.y / this.v.w * 0.5 + 0.5) * this.height, dist, 1);
    }
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

/** The lightning overlay: always created (it copies its input while no flash is lit). */
export function createLightningOverlay(c: WeatherEffectContext): SceneEffect | null {
  return new LightningOverlay(c.clouds);
}
