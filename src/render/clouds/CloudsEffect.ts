// Volumetric cloud post effect: ray-marched cumulus/stratocumulus layer plus a cirrus deck, composited over
// the HDR scene with correct depth occlusion, cloud shadows on the ground, and distance haze.
//
// Per frame (skipped entirely, as a plain copy, when cloudCover is 0):
//   1. shadow map   (CloudShadowPass)   sun transmittance through the layer, 256-1024^2
//   2. ray march    (MARCH_FRAG)        reduced resolution, blue-noise jittered start offset, MRT
//   3. temporal     (TEMPORAL_FRAG)     reprojection with variance clipping, ping-pong history
//   4. composite    (COMPOSITE_FRAG)    full resolution depth-aware upsample, shadows, scene * T + L

import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { QualityLevel, SceneEffect, SimContext } from '../../core/context';
import type { WeatherSettings } from '../../core/types';
import { Atmosphere } from '../sky/Atmosphere';
import { transmittanceToSpace } from '../sky/transmittance';
import { createBlueNoiseTexture } from './blueNoise';
import { CloudModel, SLICE_FRAG } from './cloudModel';
import { coverageControl, coverageParams } from './coverage';
import { CloudShadowPass, type CloudShadowUniforms } from './cloudShadow';
import { MARCH_FRAG } from './marchShader';
import { createCloudNoiseTextures, type CloudNoiseTextures } from './noiseTextures';
import { COMPOSITE_FRAG, COPY_FRAG, FULLSCREEN_VERT, TEMPORAL_FRAG } from './resolveShaders';

interface QualitySettings {
  /** Linear resolution of the march relative to the screen. */
  scale: number;
  maxSteps: number;
  lightSteps: number;
  /** Light-march steps that include the detail erosion (lobes shading each other). */
  lightDetailSteps: number;
  /** Shortest view-ray step, m. */
  minStep: number;
  /** Distance over which detail erosion is applied, m. */
  detailDist: number;
  shadowRes: number;
}

const QUALITY: Record<QualityLevel, QualitySettings> = {
  low: { scale: 0.33, maxSteps: 64, lightSteps: 3, lightDetailSteps: 1, minStep: 60, detailDist: 8_000, shadowRes: 256 },
  medium: { scale: 0.5, maxSteps: 112, lightSteps: 4, lightDetailSteps: 2, minStep: 40, detailDist: 15_000, shadowRes: 512 },
  high: { scale: 0.55, maxSteps: 128, lightSteps: 6, lightDetailSteps: 3, minStep: 25, detailDist: 25_000, shadowRes: 512 },
  ultra: { scale: 0.7, maxSteps: 192, lightSteps: 6, lightDetailSteps: 3, minStep: 20, detailDist: 35_000, shadowRes: 1024 },
};

/** Clouds are marched out to this distance, m (the curved layer dips below the horizon at ~140 km). */
const MAX_DISTANCE = 160_000;
/** Scale height of the boundary-layer haze, m. */
const HAZE_SCALE_HEIGHT = 1_200;
/** Koschmieder with the WMO 5 % contrast threshold: extinction = -ln(0.05) / visibility. */
const HAZE_CONTRAST = 3.0;
/** Cirrus altitude, m MSL, unless the cumulus tops are higher. */
const CIRRUS_ALTITUDE = 8_500;
/** Moonlight colour times intensity, linear HDR. Brighter than physical so night clouds stay readable. */
const MOONLIGHT = new THREE.Color(0.55, 0.65, 0.85).multiplyScalar(0.04);
/** Ground albedo for the bounce light under the clouds (mixed farmland / forest). */
const GROUND_ALBEDO = new THREE.Color(0.1, 0.11, 0.08);
/** Camera moves further than this in one frame (teleport, reset): drop the temporal history. */
const HISTORY_RESET_DISTANCE = 1_000;

type Uniforms = Record<string, THREE.IUniform>;

export interface CloudsEffectOptions {
  /**
   * Fade distant clouds with the shared Atmosphere's aerial perspective (render/sky), exactly like the
   * terrain behind them (default true; the sky module must be updating the Atmosphere every frame).
   * false: a simple exponential haze from ctx.sky.hazeExtinction / hazeScaleHeight toward ctx.sky.hazeColor.
   */
  atmosphere?: boolean;
}

/** Cirrus cover when the weather does not set one: a few thin wisps, as on most fair-weather days. */
export const DEFAULT_CIRRUS_COVER = 0.1;

/**
 * Cirrus cover 0..1, independent of the cumulus layer. Read from an optional `cirrusCover` field of the
 * weather settings (see CloudsEffect docs), DEFAULT_CIRRUS_COVER when it is absent or not a number.
 */
export function cirrusCover(w: WeatherSettings): number {
  const c = (w as WeatherSettings & { cirrusCover?: unknown }).cirrusCover;
  return typeof c === 'number' && Number.isFinite(c) ? THREE.MathUtils.clamp(c, 0, 1) : DEFAULT_CIRRUS_COVER;
}

/** Radical inverse in the given base: the Halton low-discrepancy sequence used for sub-pixel jitter. */
function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  for (let i = index; i > 0; i = Math.floor(i / base)) {
    f /= base;
    r += f * (i % base);
  }
  return r;
}

/** Direct sunlight (scene units) at altitude km for a sun at cosine zenith mu, from the shared atmosphere. */
function directSun(atmosphere: Atmosphere, km: number, mu: number, out: THREE.Color): THREE.Color {
  transmittanceToSpace(atmosphere.params, km, mu, out);
  const e = atmosphere.sunIlluminance;
  return out.setRGB(out.r * e.x, out.g * e.y, out.b * e.z);
}

function fullscreenMaterial(fragmentShader: string, uniforms: Uniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FULLSCREEN_VERT,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
}

export class CloudsEffect implements SceneEffect {
  readonly name = 'clouds';
  /**
   * Uniforms for CLOUD_SHADOW_GLSL (see cloudShadow.ts). Spread them into another material's uniforms to
   * give it cloud shadows; the objects are updated in place every frame.
   */
  readonly shadowUniforms: CloudShadowUniforms;
  /**
   * Darken the scene colour under cloud shadows in the composite (reconstructed from depth). Set to false
   * if the terrain/scenery materials apply cloudShadow() themselves, or the shadows are applied twice.
   */
  compositeShadows = true;

  /**
   * Resolves once the procedural noise textures are built (a few frames after construction; the GPU is
   * never stalled). Until then render() passes the scene through unchanged.
   */
  readonly ready: Promise<void>;

  private noise: CloudNoiseTextures | null = null;
  private disposed = false;
  private readonly blueNoise: THREE.DataTexture;
  private readonly model: CloudModel;
  private readonly shadow: CloudShadowPass;
  private readonly quad = new FullScreenQuad();
  /** Fade with the shared aerial-perspective volume (Atmosphere.aerial) when it is published. */
  private readonly useAtmosphere: boolean;
  private readonly atmosphere: Atmosphere;
  private readonly aerialUniforms: { uAerialOn: THREE.IUniform<number>; uAerialAtlas: THREE.IUniform<THREE.Texture | null>; uAerialMax: THREE.IUniform<number> };
  private readonly marchMat: THREE.ShaderMaterial;
  private readonly temporalMat: THREE.ShaderMaterial;
  private readonly compositeMat: THREE.ShaderMaterial;
  private readonly copyMat: THREE.ShaderMaterial;
  private sliceMat: THREE.ShaderMaterial | null = null;

  private marchRT: THREE.WebGLRenderTarget;
  private history: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private historyIndex = 0;
  private historyValid = false;

  private quality: QualityLevel = 'high';
  private width = 1;
  private height = 1;
  private frame = 0;

  // Camera and lighting scratch values, shared by reference with the materials' uniforms.
  private readonly invProj = new THREE.Matrix4();
  private readonly camWorld = new THREE.Matrix4();
  private readonly camPos = new THREE.Vector3();
  private readonly prevViewProj = new THREE.Matrix4();
  private readonly prevCamPos = new THREE.Vector3();
  private readonly lowSize = new THREE.Vector2(1, 1);
  private readonly fullSize = new THREE.Vector2(1, 1);
  private readonly lightDir = new THREE.Vector3(0, 1, 0);
  private readonly lightColor = new THREE.Color();
  private readonly groundRadiance = new THREE.Color();
  private readonly sunTop = new THREE.Color();
  private readonly haze = new THREE.Vector2();

  constructor(renderer: THREE.WebGLRenderer, options: CloudsEffectOptions = {}) {
    this.useAtmosphere = options.atmosphere !== false;
    this.atmosphere = Atmosphere.for(renderer);
    // Filled every frame from Atmosphere.aerial (see syncAerial); off until the aerial-perspective effect has
    // published its volume, and always off without the atmosphere (exponential haze instead).
    const aerialUniforms = (this.aerialUniforms = { uAerialOn: { value: 0 }, uAerialAtlas: { value: null }, uAerialMax: { value: 1 } });
    this.blueNoise = createBlueNoiseTexture();
    this.model = new CloudModel();
    this.ready = createCloudNoiseTextures(renderer).then((noise) => {
      if (this.disposed) {
        noise.dispose();
        return;
      }
      this.noise = noise;
      this.model.setTextures(noise);
    });
    this.shadow = new CloudShadowPass(this.model, QUALITY[this.quality].shadowRes);
    this.shadowUniforms = this.shadow.uniforms;

    const camera: Uniforms = {
      uInvProj: { value: this.invProj },
      uCamWorld: { value: this.camWorld },
      uCamPos: { value: this.camPos },
    };
    this.marchMat = fullscreenMaterial(MARCH_FRAG, {
      ...this.model.uniforms,
      ...this.shadow.uniforms,
      ...camera,
      ...aerialUniforms,
      // The sky-view LUTs, to keep the haze in front of the clouds consistent with the dome behind them.
      ...(this.useAtmosphere ? this.atmosphere.uniforms : {}),
      uDepth: { value: null },
      uScene: { value: null },
      uFullSize: { value: this.fullSize },
      uLowSize: { value: this.lowSize },
      uBlueNoise: { value: this.blueNoise },
      uJitter: { value: 0 },
      uPixelJitter: { value: new THREE.Vector2() },
      uPixelAngle: { value: 0.002 },
      uLightDir: { value: this.lightDir },
      uLightColor: { value: this.lightColor },
      uSunByAltitude: { value: 0 },
      uSkyColor: { value: new THREE.Color() },
      uGroundRadiance: { value: this.groundRadiance },
      uHazeColor: { value: new THREE.Color() },
      uHaze: { value: this.haze },
      // Step settings are filled in from QUALITY by resizeTargets().
      uMaxSteps: { value: 0 },
      uLightSteps: { value: 0 },
      uLightDetailSteps: { value: 0 },
      uMinStep: { value: 0 },
      uMaxDist: { value: MAX_DISTANCE },
      uDetailDist: { value: 0 },
      uDetailScale: { value: 1 },
      uCirrus: { value: new THREE.Vector2() },
      uCirrusOffset: { value: this.model.cirrusOffset },
      uCirrusAxis: { value: this.model.cirrusAxis },
    });
    if (this.useAtmosphere) this.marchMat.defines = { CLOUDS_ATMOSPHERE: 1 };
    this.temporalMat = fullscreenMaterial(TEMPORAL_FRAG, {
      ...camera,
      uCurr: { value: null },
      uAux: { value: null },
      uHistory: { value: null },
      uPrevViewProj: { value: this.prevViewProj },
      uBlend: { value: 0.1 },
      uClipGamma: { value: 1.25 },
      uHistoryValid: { value: 0 },
    });
    this.compositeMat = fullscreenMaterial(COMPOSITE_FRAG, {
      ...camera,
      ...this.shadow.uniforms,
      ...aerialUniforms,
      uScene: { value: null },
      uDepth: { value: null },
      uClouds: { value: null },
      uAux: { value: null },
      uLowSize: { value: this.lowSize },
      uHaze: { value: this.haze },
      uCompositeShadows: { value: 1 },
    });
    this.copyMat = fullscreenMaterial(COPY_FRAG, { uScene: { value: null } });

    this.marchRT = this.createMarchTarget(1, 1);
    this.history = [this.createHistoryTarget(1, 1), this.createHistoryTarget(1, 1)];
    this.resizeTargets();
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.resizeTargets();
  }

  render(
    renderer: THREE.WebGLRenderer,
    input: THREE.Texture,
    depth: THREE.DepthTexture,
    output: THREE.WebGLRenderTarget,
    ctx: SimContext,
    dt: number,
  ): void {
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    if ((ctx.weather.cloudCover <= 0 && cirrusCover(ctx.weather) <= 0) || !this.noise) {
      this.historyValid = false;
      this.shadow.uniforms.cloudShadowLight.value.w = 0;
      this.copyMat.uniforms.uScene.value = input;
      this.draw(renderer, this.copyMat, output);
    } else {
      if (ctx.quality !== this.quality) this.setQuality(ctx.quality);
      this.model.update(ctx, dt);
      this.updateCamera(ctx.camera);
      this.updateLighting(ctx);
      this.syncAerial();

      const layer = this.model.uniforms.uLayer.value;
      // No cumulus (cirrus only): the shadow map is not needed, and a zero strength switches it off.
      // The shadow map (40 km, ~80 m texels) changes slowly: it is re-rendered every other frame, and at once
      // after a jump of the camera.
      if (layer.w > 0) this.shadow.render(renderer, this.camPos, this.lightDir, layer.x, this.shadowStrength(ctx), this.frame % 2 === 0 || !this.historyValid);
      else this.shadow.uniforms.cloudShadowLight.value.w = 0;

      const m = this.marchMat.uniforms;
      m.uDepth.value = depth;
      m.uScene.value = input;
      m.uJitter.value = (this.frame * 0.618034) % 1;
      const j = (this.frame % 16) + 1;
      (m.uPixelJitter.value as THREE.Vector2).set(halton(j, 2) - 0.5, halton(j, 3) - 0.5);
      this.draw(renderer, this.marchMat, this.marchRT);

      const src = this.history[this.historyIndex];
      const dst = this.history[1 - this.historyIndex];
      const t = this.temporalMat.uniforms;
      t.uCurr.value = this.marchRT.textures[0];
      t.uAux.value = this.marchRT.textures[1];
      t.uHistory.value = src.texture;
      t.uHistoryValid.value = this.historyValid ? 1 : 0;
      this.draw(renderer, this.temporalMat, dst);
      this.historyIndex = 1 - this.historyIndex;
      this.historyValid = true;

      const c = this.compositeMat.uniforms;
      c.uScene.value = input;
      c.uDepth.value = depth;
      c.uClouds.value = dst.texture;
      c.uAux.value = this.marchRT.textures[1];
      c.uCompositeShadows.value = this.compositeShadows ? 1 : 0;
      this.draw(renderer, this.compositeMat, output);

      this.prevViewProj.multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse);
      this.prevCamPos.copy(this.camPos);
      this.frame++;
    }

    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
  }

  /**
   * Development aid: draw a vertical slice of the cloud density into `target` (x: `lengthM` metres along the
   * horizontal direction (dx, dz) from world (x, z); y: cloud base to top). Red = full density with detail
   * erosion, green = the coarse shape used for lighting and shadows (mode 0) or the raw shape (1) or detail (2)
   * noise, blue = the lateral coverage mask and the envelope.
   */
  renderDensitySlice(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, x: number, z: number, dx: number, dz: number, lengthM: number, mode = 0): void {
    if (!this.noise) return;
    const mat = (this.sliceMat ??= fullscreenMaterial(SLICE_FRAG, {
      ...this.model.uniforms,
      uSliceOrigin: { value: new THREE.Vector2() },
      uSliceDir: { value: new THREE.Vector2() },
      uSliceLength: { value: 1 },
      uSliceMode: { value: 0 },
    }));
    mat.uniforms.uSliceMode.value = mode;
    (mat.uniforms.uSliceOrigin.value as THREE.Vector2).set(x, z);
    (mat.uniforms.uSliceDir.value as THREE.Vector2).set(dx, dz).normalize();
    mat.uniforms.uSliceLength.value = lengthM;
    const prev = renderer.getRenderTarget();
    this.draw(renderer, mat, target);
    renderer.setRenderTarget(prev);
  }

  /**
   * Development aid (calibration of coverage.ts): the fraction of the ground under cloud (transmittance of a
   * vertical ray through the layer below 0.5, from the shadow pass, averaged over nine 40 km squares), for
   * each requested cover or, with `control`, for each raw coverage control value (coverageControl), with the
   * cloud type of the cover `typeCover[i]` (default: the current cover). Stalls the GPU (synchronous
   * read-back); call only from tools.
   */
  measureCover(renderer: THREE.WebGLRenderer, values: number[], control = false, typeCover?: number[]): number[] {
    if (!this.noise) return [];
    const n = 256;
    const rt = new THREE.WebGLRenderTarget(n, n, { depthBuffer: false });
    const px = new Uint8Array(n * n * 4);
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const u = this.model.uniforms;
    const saved = u.uCoverage.value.clone();
    const savedCover = u.uLayer.value.w;
    const out: number[] = [];
    for (const [i, v] of values.entries()) {
      if (control) {
        coverageControl(v, u.uCoverage.value);
        u.uLayer.value.w = typeCover?.[i] ?? savedCover;
      } else {
        coverageParams(v, u.uCoverage.value);
        u.uLayer.value.w = v; // the cloud type (tops, deck) also follows the cover
      }
      let hit = 0;
      for (let i = 0; i < 9; i++) {
        pos.set((i % 3) * 20_000 + 3_000, 0, Math.floor(i / 3) * 20_000 + 7_000);
        this.shadow.renderTo(renderer, rt, pos, up, u.uLayer.value.x);
        renderer.readRenderTargetPixels(rt, 0, 0, n, n, px);
        for (let k = 0; k < n * n; k++) if (px[k * 4] < 128) hit++;
      }
      out.push(hit / (9 * n * n));
    }
    u.uCoverage.value.copy(saved);
    u.uLayer.value.w = savedCover;
    rt.dispose();
    return out;
  }

  dispose(): void {
    this.sliceMat?.dispose();
    this.disposed = true;
    this.noise?.dispose();
    this.blueNoise.dispose();
    this.shadow.dispose();
    this.marchRT.dispose();
    this.history.forEach((h) => h.dispose());
    [this.marchMat, this.temporalMat, this.compositeMat, this.copyMat].forEach((m) => m.dispose());
    this.quad.dispose();
  }

  /** Bind this frame's shared aerial-perspective volume (filled by the aerial-perspective effect before us). */
  private syncAerial(): void {
    const a = this.useAtmosphere ? this.atmosphere.aerial : null;
    const u = this.aerialUniforms;
    u.uAerialOn.value = a ? 1 : 0;
    if (!a) return;
    u.uAerialAtlas.value = a.uAerialAtlas.value;
    u.uAerialMax.value = a.uAerialMax.value;
  }

  private draw(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  private setQuality(q: QualityLevel): void {
    this.quality = q;
    this.shadow.setResolution(QUALITY[q].shadowRes);
    this.resizeTargets();
  }

  private resizeTargets(): void {
    const s = QUALITY[this.quality];
    const lw = Math.max(1, Math.ceil(this.width * s.scale));
    const lh = Math.max(1, Math.ceil(this.height * s.scale));
    this.fullSize.set(this.width, this.height);
    const m = this.marchMat.uniforms;
    m.uMaxSteps.value = s.maxSteps;
    m.uLightSteps.value = s.lightSteps;
    m.uLightDetailSteps.value = s.lightDetailSteps;
    m.uDetailDist.value = s.detailDist;
    if (lw === this.lowSize.x && lh === this.lowSize.y) return;
    this.lowSize.set(lw, lh);
    this.marchRT.setSize(lw, lh);
    this.history.forEach((h) => h.setSize(lw, lh));
    this.historyValid = false;
  }

  private updateCamera(camera: THREE.PerspectiveCamera): void {
    this.invProj.copy(camera.projectionMatrixInverse);
    this.camWorld.copy(camera.matrixWorld);
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    if (this.camPos.distanceTo(this.prevCamPos) > HISTORY_RESET_DISTANCE) this.historyValid = false;
    const m = this.marchMat.uniforms;
    m.uPixelAngle.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / camera.zoom) / this.lowSize.y;
    m.uDetailScale.value = this.lowSize.y / (2 * Math.tan(Math.PI / 6));
    // Narrow fields of view (the zoomed tower camera) see each metre of cloud over many pixels: shorten the
    // near steps in proportion (down to 30 %), or the step pattern shows as streaks and bands.
    const zoom = THREE.MathUtils.clamp(m.uPixelAngle.value * m.uDetailScale.value, 0.3, 1);
    m.uMinStep.value = QUALITY[this.quality].minStep * zoom;
  }

  /**
   * How much a full cloud shadow darkens a horizontal surface: the direct-light share of its illuminance,
   * from the key light (sun or moon) and the sky ambient, faded out as the light approaches the horizon.
   */
  private shadowStrength(ctx: SimContext): number {
    const lum = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const direct = lum(this.lightColor) * Math.max(this.lightDir.y, 0);
    const diffuse = Math.PI * lum(ctx.sky.skyColor);
    const share = direct > 0 ? direct / (direct + diffuse) : 0;
    return share * THREE.MathUtils.smoothstep(this.lightDir.y, 0.02, 0.15);
  }

  private updateLighting(ctx: SimContext): void {
    const sky = ctx.sky;
    const w = ctx.weather;
    const m = this.marchMat.uniforms;
    // The moon takes over as the key light once it outshines the (reddened, fading) sun.
    // ctx.sky.moonColor is the physical moonlight (black when the moon is down); MOONLIGHT is only a
    // fallback for a sky provider that does not publish it.
    const physicalMoon = sky.moonColor.r + sky.moonColor.g + sky.moonColor.b > 0;
    const moonWeight = physicalMoon ? 1 : THREE.MathUtils.smoothstep(sky.moonDir.y, -0.05, 0.1) * (1 - sky.dayFactor);
    const moon = physicalMoon ? sky.moonColor : MOONLIGHT;
    const lum = (c: THREE.Color): number => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
    // The sun as the cloud tops see it: after sunset at the camera it still lights them (reddened) for a while.
    const layer = this.model.uniforms.uLayer.value;
    const sunTop = this.useAtmosphere
      ? directSun(this.atmosphere, layer.y / 1000, sky.sunDir.y, this.sunTop)
      : this.sunTop.copy(sky.sunColor);
    const sunLum = Math.max(lum(sky.sunColor), lum(sunTop));
    const moonLum = lum(moon) * moonWeight;
    if (sunLum >= moonLum) {
      this.lightDir.copy(sky.sunDir);
      this.lightColor.copy(sky.sunColor);
    } else {
      this.lightDir.copy(sky.moonDir);
      this.lightColor.copy(moon).multiplyScalar(moonWeight);
    }
    // The shader then evaluates the sunlight at each sample's altitude from the transmittance table.
    m.uSunByAltitude.value = this.useAtmosphere && sunLum >= moonLum ? 1 : 0;
    (m.uSkyColor.value as THREE.Color).copy(sky.skyColor);
    (m.uHazeColor.value as THREE.Color).copy(sky.hazeColor);
    // Lambertian ground radiance: albedo * (direct irradiance + pi * sky radiance) / pi.
    const direct = Math.max(this.lightDir.y, 0) / Math.PI;
    this.groundRadiance
      .copy(this.lightColor)
      .multiplyScalar(direct)
      .add(sky.skyColor)
      .multiply(GROUND_ALBEDO);
    // Fade distant clouds like the aerial-perspective pass fades terrain (ctx.sky haze parameters).
    if (sky.hazeExtinction > 0 && sky.hazeScaleHeight > 0) this.haze.set(sky.hazeExtinction, sky.hazeScaleHeight);
    else this.haze.set(HAZE_CONTRAST / Math.max(w.visibilityM, 100), HAZE_SCALE_HEIGHT);
    (m.uCirrus.value as THREE.Vector2).set(cirrusCover(w), Math.max(CIRRUS_ALTITUDE, layer.y + 2_000));
  }

  private createMarchTarget(w: number, h: number): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(w, h, {
      count: 2,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
  }

  private createHistoryTarget(w: number, h: number): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
  }
}
