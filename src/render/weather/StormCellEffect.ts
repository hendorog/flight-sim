// Cumulonimbus cells (the cells in effect at the camera, physics/weather/stormField.ts StormField.select through the
// frame's shared selection, stormSelection.ts, which the clouds also read to clear the cumulus around each cell:
// the weather's explicit `storms`, or the cells derived from the conditions): a scene effect before the clouds, built
// on the VolcanoPlumeEffect pattern. The cumulus march ends its rays at the storm's front (the layer's aux b, where
// the storm's transmittance falls below STORM_CLIP_T) and composites over this effect's output. Created at boot
// whether or not the weather has cells, so that cells set later (menu, presets, __sim.setWeather) appear without a
// shader compile; with no cell on screen active() is false and PostPipeline skips it (rendered anyway, as by the
// shader warm-up, it copies its input).
//
// Per frame (3 draws; none when no cell is in the view frustum, except on the first render, which draws every pass
// with no cell so that their shaders compile in the Simulator's shader warm-up; the composite then returns its input):
//   1. march      (STORM_MARCH_FRAG, stormGlsl.ts)      STORM_SCALE resolution, MRT: premultiplied radiance +
//                                                       transmittance, and the density-weighted front distance
//                                                       with the scene depth the ray met; blue-noise step offsets
//                                                       and a sub-pixel ray offset that change every frame
//   2. temporal   (the cumulus layer's TEMPORAL_FRAG,   reprojection of the accumulated result with the march's
//                  render/clouds/resolveShaders.ts)     front distance, variance clipping, ping-pong history; a
//                                                       still view (paused, or the camera at rest) converges to the
//                                                       mean of the jittered samples instead of showing them
//   3. composite  (STORM_COMPOSITE_FRAG)                full resolution, depth-aware upsample over the scene
// The cloud reads the cumulus layer's noise volumes (CloudsEffect.noiseTextures); until they are built no cell is
// drawn.
// Cell geometry: cellGeometry.ts (re-exported here), at ctx.simTime.
// The march's result (front distance, transmittance) is also published for the lightning overlay (stormLayerOf),
// which lights the cell's pixels in a flash.
//
// Approximations: the cumulus march ends at one storm distance per low-resolution pixel (cumulus behind thin storm
// cloud, transmittance above STORM_CLIP_T, is drawn over it); the moon does not light a cell; the temporal pass
// reprojects the cell's pixels with the depth buffer or the cumulus layer (whose front is the storm's clip distance
// where no cumulus lies in front), not the cell's own distance.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { SceneEffect, SimContext } from '../../core/context';
import { MAX_STORMS } from '../../core/weatherFields';
import { Atmosphere } from '../sky/Atmosphere';
import { transmittanceToSpace } from '../sky/transmittance';
import { createBlueNoiseTexture } from '../clouds/blueNoise';
import type { CloudsEffect } from '../clouds/CloudsEffect';
import { FULLSCREEN_VERT, TEMPORAL_FRAG } from '../clouds/resolveShaders';
import { STORM_COMPOSITE_FRAG, STORM_COPY_FRAG, STORM_MARCH_FRAG, STORM_MAX_CELLS, STORM_TOP_MARGIN_M } from './stormGlsl';
import type { WeatherEffectContext } from './index';
import { cameraStormsAt, cameraStormsOf } from './stormSelection';
import { hailSigmaPerMmH } from '../../physics/weather/stormPrecip';
import { cellGeometry, makeCellGeometry, type CellGeometry } from './cellGeometry';

/** Linear resolution of the march relative to the screen ('low' quality: STORM_SCALE_LOW). */
export const STORM_SCALE = 0.5;
export const STORM_SCALE_LOW = 0.35;
/** Lowest altitude a cell's bounds reach, m MSL (below the lowest terrain; the scene depth clips the march). */
const GROUND_Y = -100;
/** Firefly guard: no cell pixel brighter than this share of a white surface under the TOA sun (as the plume). */
const MAX_RADIANCE_REL = 0.5;
/** Ground albedo for the bounce light under a cell (as CloudsEffect's GROUND_ALBEDO). */
const GROUND_ALBEDO = new THREE.Color(0.1, 0.11, 0.08);

export { ANVIL_FULL_DRIFT_KT, ANVIL_MAX_M, ANVIL_PER_RADIUS, SHAFT_PER_RADIUS, cellGeometry, makeCellGeometry, type CellGeometry } from './cellGeometry';

/** Camera moves further than this in one frame (teleport, reset): drop the temporal history, m. */
const HISTORY_RESET_DISTANCE = 1_000;
/** Weight of the new frame in the temporal pass, and its clip box half-size (the cumulus layer's values). */
const TEMPORAL_BLEND = 0.1;
const TEMPORAL_CLIP_GAMMA = 1.25;

/** Halton sequence (sub-pixel ray offsets). */
function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

// ------------------------------------------------------------------------------------------------ effect

type Uniforms = Record<string, THREE.IUniform>;

function fullscreenMaterial(fragmentShader: string, uniforms: Uniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false });
}

/** What the storm march drew in the last frame, for the lightning overlay. */
export interface StormLayer {
  /** Whether the last frame marched (false: no cell on screen; the textures are stale). */
  readonly marched: boolean;
  /**
   * r: log2(1 + front distance, m); g: log2(1 + scene distance); b: log2(1 + the distance at which the cells'
   * transmittance falls below STORM_CLIP_T, 1e8 m where it does not). STORM_SCALE resolution.
   */
  readonly distance: THREE.Texture;
  /** a: transmittance of the cells. */
  readonly transmittance: THREE.Texture;
  /** The cells drawn (three.js world), and their count. */
  readonly cells: readonly CellGeometry[];
  readonly count: number;
}

/** The storm layer published per simulation context (stormLayerOf). */
const LAYERS = new WeakMap<SimContext, StormCellEffect>();

/** The storm-cell effect created for `ctx`, as its last frame's layer, or null when there is none. */
export function stormLayerOf(ctx: SimContext): StormLayer | null {
  return LAYERS.get(ctx) ?? null;
}

export class StormCellEffect implements SceneEffect, StormLayer {
  readonly name = 'stormCells';
  marched = false;
  count = 0;
  readonly cells: CellGeometry[] = Array.from({ length: MAX_STORMS }, makeCellGeometry);

  private readonly blueNoise: THREE.DataTexture;
  private readonly clouds: CloudsEffect | null;
  private readonly quad = new FullScreenQuad();
  readonly marchMat: THREE.ShaderMaterial;
  readonly compositeMat: THREE.ShaderMaterial;
  private readonly copyMat: THREE.ShaderMaterial;
  private readonly marchRT: THREE.WebGLRenderTarget;
  readonly temporalMat: THREE.ShaderMaterial;
  private readonly history: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private historyIndex = 0;
  private historyValid = false;
  private readonly prevViewProj = new THREE.Matrix4();
  private readonly prevCamPos = new THREE.Vector3();
  private readonly pixelJitter = new THREE.Vector2();
  private readonly noDrift = new THREE.Vector3();
  private atmosphere: Atmosphere | null = null;
  private width = 1;
  private height = 1;
  private scale = STORM_SCALE;
  private frame = 0;
  /** Whether the march and composite have been drawn once (compiled). */
  private warmed = false;

  private readonly invProj = new THREE.Matrix4();
  private readonly camWorld = new THREE.Matrix4();
  private readonly camPos = new THREE.Vector3();
  private readonly lowSize = new THREE.Vector2(1, 1);
  private readonly sunDir = new THREE.Vector3(0, 1, 0);
  private readonly sunBase = new THREE.Color();
  private readonly sunTop = new THREE.Color();
  private readonly sunSpan = new THREE.Vector2(0, 1);
  private readonly skyColor = new THREE.Color();
  private readonly groundSun = new THREE.Color();
  private readonly groundSky = new THREE.Color();
  private readonly hazeColor = new THREE.Color();
  private readonly haze = new THREE.Vector2(1e-5, 1200);
  private readonly cellA = Array.from({ length: STORM_MAX_CELLS }, () => new THREE.Vector4());
  private readonly cellB = Array.from({ length: STORM_MAX_CELLS }, () => new THREE.Vector4());
  private readonly cellC = Array.from({ length: STORM_MAX_CELLS }, () => new THREE.Vector4());
  private readonly cellR = new Float32Array(STORM_MAX_CELLS);
  private readonly cellW = Array.from({ length: STORM_MAX_CELLS }, () => new THREE.Vector4(1, 1, 1, 0));
  private readonly cellH = Array.from({ length: STORM_MAX_CELLS }, () => new THREE.Vector4());
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private readonly box = new THREE.Box3();

  /** `clouds`: the cumulus layer whose noise volumes the cells read (null: no cell is drawn; tests). */
  constructor(clouds: CloudsEffect | null = null) {
    this.clouds = clouds;
    this.blueNoise = createBlueNoiseTexture();
    const camera: Uniforms = { uInvProj: { value: this.invProj }, uCamWorld: { value: this.camWorld }, uCamPos: { value: this.camPos } };
    this.marchMat = fullscreenMaterial(STORM_MARCH_FRAG, {
      ...camera,
      uDepth: { value: null },
      uShapeTex: { value: null },
      uDetailTex: { value: null },
      uWarpTex: { value: null },
      uBlueNoise: { value: this.blueNoise },
      uJitter: { value: 0 },
      uPixelJitter: { value: this.pixelJitter },
      uLowSize: { value: this.lowSize },
      uPixelAngle: { value: 1e-3 },
      uAerialOn: { value: 0 },
      uAerialAtlas: { value: null },
      uAerialMax: { value: 1 },
      uHaze: { value: this.haze },
      uHazeColor: { value: this.hazeColor },
      uTime: { value: 0 },
      uNearClip: { value: 0 },
      uCellA: { value: this.cellA },
      uCellB: { value: this.cellB },
      uCellC: { value: this.cellC },
      uCellR: { value: this.cellR },
      uCellW: { value: this.cellW },
      uCellH: { value: this.cellH },
      uCount: { value: 0 },
      uGroundY: { value: GROUND_Y },
      uSunSpan: { value: this.sunSpan },
      uSunDir: { value: this.sunDir },
      uSunBase: { value: this.sunBase },
      uSunTop: { value: this.sunTop },
      uSkyColor: { value: this.skyColor },
      uGroundSun: { value: this.groundSun },
      uGroundSky: { value: this.groundSky },
      uGroundAlt: { value: 0 },
      uMaxRadiance: { value: 1e6 },
    });
    this.compositeMat = fullscreenMaterial(STORM_COMPOSITE_FRAG, {
      ...camera,
      uScene: { value: null },
      uDepth: { value: null },
      uStorm: { value: null },
      uAux: { value: null },
      uLowSize: { value: this.lowSize },
    });
    this.copyMat = fullscreenMaterial(STORM_COPY_FRAG, { uScene: { value: null } });
    this.temporalMat = fullscreenMaterial(TEMPORAL_FRAG, {
      ...camera,
      uCurr: { value: null },
      uAux: { value: null },
      uHistory: { value: null },
      uPrevViewProj: { value: this.prevViewProj },
      uDrift: { value: this.noDrift },
      uBlend: { value: TEMPORAL_BLEND },
      uClipGamma: { value: TEMPORAL_CLIP_GAMMA },
      uHistoryValid: { value: 0 },
    });
    const history = (): THREE.WebGLRenderTarget =>
      new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
    this.history = [history(), history()];
    this.marchRT = new THREE.WebGLRenderTarget(1, 1, {
      count: 2,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
  }

  get distance(): THREE.Texture {
    return this.marchRT.textures[1];
  }

  get transmittance(): THREE.Texture {
    return this.history[this.historyIndex].texture;
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.resize();
  }

  private resize(): void {
    const lw = Math.max(1, Math.ceil(this.width * this.scale));
    const lh = Math.max(1, Math.ceil(this.height * this.scale));
    if (lw === this.lowSize.x && lh === this.lowSize.y) return;
    this.lowSize.set(lw, lh);
    this.marchRT.setSize(lw, lh);
    this.history.forEach((h) => h.setSize(lw, lh));
    this.historyValid = false;
  }

  /** Update the cells in effect at the camera at ctx.simTime and cull them against the view; returns the count on screen. */
  updateCells(ctx: SimContext): number {
    const camera = ctx.camera;
    // The frame's selection at the camera, shared with the cumulus layer and the lightning overlay.
    const cells = cameraStormsAt(ctx);
    // The CAPE of the live weather sizes the hail (cellGeometry); the shared selection's field caches it.
    const cape = cells.length > 0 ? cameraStormsOf(ctx).field.convective(ctx.weather).capeJkg : 0;
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProj);
    let n = 0;
    for (let i = 0; i < Math.min(cells.length, MAX_STORMS); i++) {
      const g = cellGeometry(cells[i], ctx.weather, ctx.simTime, this.cells[n], cape);
      this.box.min.set(g.boundX - g.boundRadius, GROUND_Y, g.boundZ - g.boundRadius);
      this.box.max.set(g.boundX + g.boundRadius, g.top + STORM_TOP_MARGIN_M, g.boundZ + g.boundRadius);
      if (!this.frustum.intersectsBox(this.box)) continue;
      this.cellA[n].set(g.x, g.z, g.radius, g.top);
      this.cellB[n].set(g.base, g.intensity, g.anvilRadius, g.shaftRadius);
      this.cellC[n].set(g.anvilX, g.anvilZ, g.boundX, g.boundZ);
      this.cellR[n] = g.boundRadius;
      this.cellW[n].set(g.core, g.anvil, g.rain, g.hail);
      this.cellH[n].set(g.hailMm, hailSigmaPerMmH(g.hailMm), g.seedX, g.seedZ);
      n++;
    }
    this.count = n;
    return n;
  }

  /**
   * Whether a cell is in the view frustum (updateCells), or the first render (which compiles the march and
   * composite) is still to come. A false result publishes a layer that did not march (marched false, count 0) for
   * the lightning overlay, as render's copy does, and drops the history as render's copy does (a later march
   * starts afresh rather than blending frames from before the skipped ones).
   */
  active(ctx: SimContext): boolean {
    const on = this.textured() && this.updateCells(ctx) > 0;
    this.marched = on;
    if (!on) this.historyValid = false;
    return on || !this.warmed;
  }

  render(renderer: THREE.WebGLRenderer, input: THREE.Texture, depth: THREE.DepthTexture, output: THREE.WebGLRenderTarget, ctx: SimContext): void {
    const prevTarget = renderer.getRenderTarget();
    const scale = ctx.quality === 'low' ? STORM_SCALE_LOW : STORM_SCALE;
    if (scale !== this.scale) {
      this.scale = scale;
      this.resize();
    }
    this.marched = this.textured() && this.updateCells(ctx) > 0;
    if (!this.marched) this.historyValid = false;
    if (!this.marched && this.warmed) {
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
    if (this.camPos.distanceTo(this.prevCamPos) > HISTORY_RESET_DISTANCE) this.historyValid = false;
    // With no cell (the warm-up draw) the march returns before its lighting.
    if (this.count > 0) this.updateLighting(renderer, ctx);
    const m = this.marchMat.uniforms;
    const noise = this.clouds?.noiseTextures ?? null;
    m.uShapeTex.value = noise?.shape ?? null;
    m.uDetailTex.value = noise?.detail ?? null;
    m.uWarpTex.value = noise?.warp ?? null;
    m.uDepth.value = depth;
    m.uJitter.value = (this.frame * 0.618034) % 1;
    const j = (this.frame % 16) + 1;
    this.pixelJitter.set(halton(j, 2) - 0.5, halton(j, 3) - 0.5);
    this.frame = (this.frame + 1) % 4096;
    m.uPixelAngle.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / camera.zoom / this.lowSize.y;
    m.uTime.value = ctx.simTime;
    m.uCount.value = this.count;
    m.uNearClip.value = ctx.cameraMode === 'cockpit' ? 3 : 0;
    this.draw(renderer, this.marchMat, this.marchRT);
    // Temporal accumulation at the march's resolution (the cumulus layer's pass, with no wind drift).
    const src = this.history[this.historyIndex];
    const dst = this.history[1 - this.historyIndex];
    const t = this.temporalMat.uniforms;
    t.uCurr.value = this.marchRT.textures[0];
    t.uAux.value = this.marchRT.textures[1];
    t.uHistory.value = src.texture;
    t.uHistoryValid.value = this.historyValid && this.count > 0 ? 1 : 0;
    this.draw(renderer, this.temporalMat, dst);
    this.historyIndex = 1 - this.historyIndex;
    this.historyValid = this.count > 0;
    this.prevViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.prevCamPos.copy(this.camPos);
    const c = this.compositeMat.uniforms;
    c.uScene.value = input;
    c.uDepth.value = depth;
    c.uStorm.value = dst.texture;
    c.uAux.value = this.marchRT.textures[1];
    this.draw(renderer, this.compositeMat, output);
    renderer.setRenderTarget(prevTarget);
  }

  dispose(): void {
    this.blueNoise.dispose();
    this.marchRT.dispose();
    this.history.forEach((h) => h.dispose());
    [this.marchMat, this.temporalMat, this.compositeMat, this.copyMat].forEach((mat) => mat.dispose());
    this.quad.dispose();
  }

  private updateLighting(renderer: THREE.WebGLRenderer, ctx: SimContext): void {
    const sky = ctx.sky;
    const m = this.marchMat.uniforms;
    this.sunDir.copy(sky.sunDir);
    let base = Infinity;
    let top = -Infinity;
    for (let i = 0; i < this.count; i++) {
      base = Math.min(base, this.cellB[i].x);
      top = Math.max(top, this.cellA[i].w);
    }
    this.sunSpan.set(base, top);
    let a: Atmosphere | null = null;
    try {
      a = this.atmosphere ??= Atmosphere.for(renderer);
    } catch {
      a = null;
    }
    if (a) {
      // The sun as the cell's base and its top see it (the top stays lit, reddened, after sunset at the ground).
      const e = a.sunIlluminance;
      transmittanceToSpace(a.params, base / 1000, sky.sunDir.y, this.sunBase);
      this.sunBase.setRGB(this.sunBase.r * e.x, this.sunBase.g * e.y, this.sunBase.b * e.z);
      transmittanceToSpace(a.params, top / 1000, sky.sunDir.y, this.sunTop);
      this.sunTop.setRGB(this.sunTop.r * e.x, this.sunTop.g * e.y, this.sunTop.b * e.z);
      m.uMaxRadiance.value = (MAX_RADIANCE_REL * e.y) / Math.PI;
      const aerial = a.aerial;
      m.uAerialOn.value = aerial ? 1 : 0;
      if (aerial) {
        m.uAerialAtlas.value = aerial.uAerialAtlas.value;
        m.uAerialMax.value = aerial.uAerialMax.value;
      }
    } else {
      this.sunBase.copy(sky.sunColor);
      this.sunTop.copy(sky.sunColor);
      m.uAerialOn.value = 0;
    }
    this.skyColor.copy(sky.skyColor);
    this.hazeColor.copy(sky.hazeColor);
    // Lambertian ground radiance on open ground: albedo x (direct irradiance + pi x sky radiance) / pi, its sun and
    // sky parts apart (the march shades each under the cells).
    this.groundSun.copy(sky.sunColor).multiplyScalar(Math.max(sky.sunDir.y, 0) / Math.PI).multiply(GROUND_ALBEDO);
    this.groundSky.copy(sky.skyColor).multiply(GROUND_ALBEDO);
    const ground = ctx.env.groundElevation(-this.camPos.z, this.camPos.x);
    m.uGroundAlt.value = Number.isFinite(ground) ? ground : 0;
    if (sky.hazeExtinction > 0 && sky.hazeScaleHeight > 0) this.haze.set(sky.hazeExtinction, sky.hazeScaleHeight);
    else this.haze.set(3.0 / Math.max(ctx.weather.visibilityM, 100), 1200);
  }

  /** Whether the cumulus layer's noise volumes are built (the cells' density reads them). */
  private textured(): boolean {
    return this.clouds?.noiseTextures != null;
  }

  private draw(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }
}

/** The storm-cell scene effect: always created (skipped while no cell is on screen). */
export function createStormCellEffect(c: WeatherEffectContext): SceneEffect | null {
  const effect = new StormCellEffect(c.clouds);
  LAYERS.set(c.ctx, effect);
  return effect;
}
