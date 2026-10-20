// Cumulonimbus cells (the cells in effect at the camera, physics/weather/stormField.ts StormField.select through the
// frame's shared selection, stormSelection.ts, which the clouds read first to clear the cumulus around each cell:
// the weather's explicit `storms`, or the cells derived from the conditions): a scene effect after the clouds, built on the
// VolcanoPlumeEffect pattern. Created at boot whether or not the weather has cells, so that cells set later (menu,
// presets, __sim.setWeather) appear without a shader compile; with no cell on screen active() is false and PostPipeline
// skips it (rendered anyway, as by the shader warm-up, it copies its input).
//
// Per frame (2 draws; none when no cell is in the view frustum, except on the first render, which draws both passes
// with no cell so that their shaders compile in the Simulator's shader warm-up; the composite then returns its input):
//   1. march      (STORM_MARCH_FRAG, stormGlsl.ts)      STORM_SCALE resolution, MRT: premultiplied radiance +
//                                                       transmittance, and the density-weighted front distance
//                                                       with the scene depth the ray met
//   2. composite  (STORM_COMPOSITE_FRAG)                full resolution, depth-aware upsample, against the cumulus
//                                                       layer the clouds published (reprojectionLayer)
// Cell geometry (cellGeometry, pure): the centre moves with the cell (stormCentreAt at ctx.simTime); the core, anvil
// and rain shares of a derived cell (its selection weight and life cycle) scale the three densities; the base is
// the weather's cloudBaseM, the top the cell's topM; the anvil's radius is ANVIL_PER_RADIUS x the core radius (at
// most ANVIL_MAX_M) and its centre lies half that radius downwind of the steering wind (stormSteering: the surface
// wind veered to 2000 m, the motion of every derived cell; scaled down below ANVIL_FULL_DRIFT_KT); the rain shaft's
// radius is SHAFT_PER_RADIUS x the core radius.
// The march's result (front distance, transmittance) is also published for the lightning overlay (stormLayerOf),
// which lights the cell's pixels in a flash.
//
// Approximations: the composite against the cumulus uses one front distance per layer and pixel; a cell casts no
// ground shadow and the sky light (render/sky CloudSky) does not darken under an anvil; the moon does not light a
// cell; the temporal pass reprojects the cell's pixels with the depth buffer or the cumulus layer, not the cell's
// own distance.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { SceneEffect, SimContext } from '../../core/context';
import type { StormCell, WeatherSettings } from '../../core/types';
import { DEG } from '../../core/math';
import { MAX_STORMS, stormCentreAt, type NorthEast } from '../../core/weatherFields';
import { mulberry32 } from '../../physics/weather/random';
import { stormShare, stormSteering } from '../../physics/weather/stormField';
import { Atmosphere } from '../sky/Atmosphere';
import { transmittanceToSpace } from '../sky/transmittance';
import { FULLSCREEN_VERT } from '../clouds/resolveShaders';
import type { CloudsEffect } from '../clouds';
import { STORM_COMPOSITE_FRAG, STORM_COPY_FRAG, STORM_MARCH_FRAG, STORM_MAX_CELLS } from './stormGlsl';
import type { WeatherEffectContext } from './index';
import { cameraStormsAt, drawnCoreRadiusM } from './stormSelection';

/** Linear resolution of the march relative to the screen ('low' quality: STORM_SCALE_LOW). */
export const STORM_SCALE = 0.5;
export const STORM_SCALE_LOW = 0.35;
/** Anvil radius per core radius, and its largest value, m. Unconfirmed: look values. */
export const ANVIL_PER_RADIUS = 3;
export const ANVIL_MAX_M = 18_000;
/**
 * Steering-wind speed (stormSteering) at which the anvil reaches its full downwind offset (half its radius), kt:
 * 36 kt is a 20 kt surface wind times STEERING_FACTOR 1.8. Unconfirmed: a look value.
 */
export const ANVIL_FULL_DRIFT_KT = 36;
/** Rain-shaft radius per core radius (section 3.3 of the weather plan). */
export const SHAFT_PER_RADIUS = 0.6;
/** Margin of the bounding cylinder beyond the density's support, m. */
const BOUND_MARGIN_M = 400;
/** Lowest altitude a cell's bounds reach, m MSL (below the lowest terrain; the scene depth clips the march). */
const GROUND_Y = -100;
/** Firefly guard: no cell pixel brighter than this share of a white surface under the TOA sun (as the plume). */
const MAX_RADIANCE_REL = 0.5;
/** Ground albedo for the bounce light under a cell (as CloudsEffect's GROUND_ALBEDO). */
const GROUND_ALBEDO = new THREE.Color(0.1, 0.11, 0.08);

/** One cell's geometry in three.js world (x east, y up MSL, z south). */
export interface CellGeometry {
  x: number;
  z: number;
  radius: number;
  base: number;
  top: number;
  intensity: number;
  /** Density shares 0..1 of the core, anvil and rain (stormField.ts ActiveStorm; 1 for a plain StormCell). */
  core: number;
  anvil: number;
  rain: number;
  anvilRadius: number;
  anvilX: number;
  anvilZ: number;
  shaftRadius: number;
  /** Bounding cylinder (ground to top + 100 m): centre and radius. */
  boundX: number;
  boundZ: number;
  boundRadius: number;
}

export function makeCellGeometry(): CellGeometry {
  return { x: 0, z: 0, radius: 0, base: 0, top: 0, intensity: 0, core: 1, anvil: 1, rain: 1, anvilRadius: 0, anvilX: 0, anvilZ: 0, shaftRadius: 0, boundX: 0, boundZ: 0, boundRadius: 0 };
}

const _ne: NorthEast = { north: 0, east: 0 };
const _steer = { fromDeg: 0, kt: 0 };

/**
 * Geometry of `cell` at simulation time t in weather w (pure; writes `out`). The core radius is clamped to
 * 500..8000 m (drawnCoreRadiusM), the intensity to 0..1, and the top to at least the base + 2000 m (the anvil's
 * depth plus 500 m; a derived cell's top never lies below it, stormField.ts MIN_GROWING_DEPTH_M).
 */
export function cellGeometry(cell: StormCell, w: Pick<WeatherSettings, 'cloudBaseM' | 'windDirectionDeg' | 'windSpeedKt'>, t: number, out: CellGeometry): CellGeometry {
  stormCentreAt(cell, t, _ne);
  out.x = _ne.east;
  out.z = -_ne.north;
  out.radius = drawnCoreRadiusM(cell);
  out.base = w.cloudBaseM;
  out.top = Math.max(cell.topM, out.base + 2000);
  out.intensity = Math.min(1, Math.max(0, cell.intensity));
  out.core = stormShare(cell, 'core');
  out.anvil = stormShare(cell, 'anvil');
  out.rain = stormShare(cell, 'rain');
  out.anvilRadius = Math.min(ANVIL_MAX_M, ANVIL_PER_RADIUS * out.radius);
  out.shaftRadius = SHAFT_PER_RADIUS * out.radius;
  // Downwind of the steering wind (where it blows FROM; a derived cell's motionDeg and motionKt); three.js x = east,
  // z = -north.
  stormSteering(w, _steer);
  const from = _steer.fromDeg * DEG;
  const drift = 0.5 * out.anvilRadius * Math.min(1, _steer.kt / ANVIL_FULL_DRIFT_KT);
  const toE = -Math.sin(from);
  const toN = -Math.cos(from);
  out.anvilX = out.x + toE * drift;
  out.anvilZ = out.z - toN * drift;
  // The cylinder around the core's footprint (its flare, 1.6 R, plus its billow, 0.35 R) and the anvil (its radius
  // plus its billow, 0.225 of it); stormGlsl.ts cellDensity.
  out.boundX = 0.5 * (out.x + out.anvilX);
  out.boundZ = 0.5 * (out.z + out.anvilZ);
  const half = 0.5 * drift;
  out.boundRadius = half + Math.max(1.95 * out.radius, 1.225 * out.anvilRadius) + BOUND_MARGIN_M;
  return out;
}

// ------------------------------------------------------------------------------------------------ noise

const NOISE_N = 32;

/** Tileable Worley distance (nearest feature point) over a `cells`^3 grid, at a point in [0, 1)^3. */
function worleyField(cells: number, seed: number): (x: number, y: number, z: number) => number {
  const rnd = mulberry32(seed);
  const pts = new Float32Array(cells * cells * cells * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = rnd();
  const wrap = (v: number): number => ((v % cells) + cells) % cells;
  return (x, y, z) => {
    const px = x * cells, py = y * cells, pz = z * cells;
    const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
    let best = 9;
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const cx = ix + dx, cy = iy + dy, cz = iz + dz;
          const k = (wrap(cz) * cells * cells + wrap(cy) * cells + wrap(cx)) * 3;
          const ex = cx + pts[k] - px, ey = cy + pts[k + 1] - py, ez = cz + pts[k + 2] - pz;
          const d = ex * ex + ey * ey + ez * ez;
          if (d < best) best = d;
        }
    return Math.sqrt(best);
  };
}

/**
 * The cells' private 32^3 tileable noise: billowy (inverted Worley at 3 cell counts), 0..1 in R (8 bit). A copy
 * of VolcanoPlumeEffect's builder at an eighth of the voxels, built on the CPU in the constructor.
 */
export function createStormNoise(): THREE.Data3DTexture {
  const data = new Uint8Array(NOISE_N * NOISE_N * NOISE_N);
  const w2 = worleyField(2, 0x5c1);
  const w4 = worleyField(4, 0x2e7);
  const w8 = worleyField(8, 0x71b);
  let i = 0;
  for (let z = 0; z < NOISE_N; z++)
    for (let y = 0; y < NOISE_N; y++)
      for (let x = 0; x < NOISE_N; x++) {
        const u = (x + 0.5) / NOISE_N, v = (y + 0.5) / NOISE_N, w = (z + 0.5) / NOISE_N;
        const n = 0.5 * (1 - w2(u, v, w) * 1.15) + 0.32 * (1 - w4(u, v, w) * 1.15) + 0.18 * (1 - w8(u, v, w) * 1.15);
        data[i++] = Math.max(0, Math.min(255, Math.round(n * 255)));
      }
  const tex = new THREE.Data3DTexture(data, NOISE_N, NOISE_N, NOISE_N);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
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
  /** r: log2(1 + front distance, m); g: log2(1 + scene distance). STORM_SCALE resolution. */
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

  private readonly noise: THREE.Data3DTexture;
  private readonly quad = new FullScreenQuad();
  readonly marchMat: THREE.ShaderMaterial;
  readonly compositeMat: THREE.ShaderMaterial;
  private readonly copyMat: THREE.ShaderMaterial;
  private readonly marchRT: THREE.WebGLRenderTarget;
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
  private readonly groundRadiance = new THREE.Color();
  private readonly hazeColor = new THREE.Color();
  private readonly haze = new THREE.Vector2(1e-5, 1200);
  private readonly cellA = Array.from({ length: STORM_MAX_CELLS }, () => new THREE.Vector4());
  private readonly cellB = Array.from({ length: STORM_MAX_CELLS }, () => new THREE.Vector4());
  private readonly cellC = Array.from({ length: STORM_MAX_CELLS }, () => new THREE.Vector4());
  private readonly cellR = new Float32Array(STORM_MAX_CELLS);
  private readonly cellW = Array.from({ length: STORM_MAX_CELLS }, () => new THREE.Vector4(1, 1, 1, 0));
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private readonly box = new THREE.Box3();

  /** `clouds`: the cumulus effect drawn before this one (its reprojection layer is composited against). */
  constructor(private readonly clouds: CloudsEffect | null) {
    this.noise = createStormNoise();
    const camera: Uniforms = { uInvProj: { value: this.invProj }, uCamWorld: { value: this.camWorld }, uCamPos: { value: this.camPos } };
    this.marchMat = fullscreenMaterial(STORM_MARCH_FRAG, {
      ...camera,
      uDepth: { value: null },
      uNoise: { value: this.noise },
      uAerialOn: { value: 0 },
      uAerialAtlas: { value: null },
      uAerialMax: { value: 1 },
      uHaze: { value: this.haze },
      uHazeColor: { value: this.hazeColor },
      uFrame: { value: 0 },
      uTime: { value: 0 },
      uNearClip: { value: 0 },
      uCellA: { value: this.cellA },
      uCellB: { value: this.cellB },
      uCellC: { value: this.cellC },
      uCellR: { value: this.cellR },
      uCellW: { value: this.cellW },
      uCount: { value: 0 },
      uGroundY: { value: GROUND_Y },
      uSunSpan: { value: this.sunSpan },
      uSunDir: { value: this.sunDir },
      uSunBase: { value: this.sunBase },
      uSunTop: { value: this.sunTop },
      uSkyColor: { value: this.skyColor },
      uGroundRadiance: { value: this.groundRadiance },
      uMaxRadiance: { value: 1e6 },
    });
    this.compositeMat = fullscreenMaterial(STORM_COMPOSITE_FRAG, {
      ...camera,
      uScene: { value: null },
      uDepth: { value: null },
      uStorm: { value: null },
      uAux: { value: null },
      uCuDist: { value: null },
      uCuTrans: { value: null },
      uHasCu: { value: 0 },
      uLowSize: { value: this.lowSize },
    });
    this.copyMat = fullscreenMaterial(STORM_COPY_FRAG, { uScene: { value: null } });
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
    return this.marchRT.textures[0];
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
  }

  /** Update the cells in effect at the camera at ctx.simTime and cull them against the view; returns the count on screen. */
  updateCells(ctx: SimContext): number {
    const camera = ctx.camera;
    // The frame's selection at the camera, shared with the cumulus layer and the lightning overlay.
    const cells = cameraStormsAt(ctx);
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProj);
    let n = 0;
    for (let i = 0; i < Math.min(cells.length, MAX_STORMS); i++) {
      const g = cellGeometry(cells[i], ctx.weather, ctx.simTime, this.cells[n]);
      this.box.min.set(g.boundX - g.boundRadius, GROUND_Y, g.boundZ - g.boundRadius);
      this.box.max.set(g.boundX + g.boundRadius, g.top + 100, g.boundZ + g.boundRadius);
      if (!this.frustum.intersectsBox(this.box)) continue;
      this.cellA[n].set(g.x, g.z, g.radius, g.top);
      this.cellB[n].set(g.base, g.intensity, g.anvilRadius, g.shaftRadius);
      this.cellC[n].set(g.anvilX, g.anvilZ, g.boundX, g.boundZ);
      this.cellR[n] = g.boundRadius;
      this.cellW[n].set(g.core, g.anvil, g.rain, 0);
      n++;
    }
    this.count = n;
    return n;
  }

  /**
   * Whether a cell is in the view frustum (updateCells), or the first render (which compiles the march and
   * composite) is still to come. A false result publishes a layer that did not march (marched false, count 0) for
   * the lightning overlay, as render's copy does.
   */
  active(ctx: SimContext): boolean {
    const on = this.updateCells(ctx) > 0;
    this.marched = on;
    return on || !this.warmed;
  }

  render(renderer: THREE.WebGLRenderer, input: THREE.Texture, depth: THREE.DepthTexture, output: THREE.WebGLRenderTarget, ctx: SimContext): void {
    const prevTarget = renderer.getRenderTarget();
    const scale = ctx.quality === 'low' ? STORM_SCALE_LOW : STORM_SCALE;
    if (scale !== this.scale) {
      this.scale = scale;
      this.resize();
    }
    this.marched = this.updateCells(ctx) > 0;
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
    // With no cell (the warm-up draw) the march returns before its lighting.
    if (this.count > 0) this.updateLighting(renderer, ctx);
    const m = this.marchMat.uniforms;
    m.uDepth.value = depth;
    m.uFrame.value = this.frame++ % 4096;
    m.uTime.value = ctx.simTime;
    m.uCount.value = this.count;
    m.uNearClip.value = ctx.cameraMode === 'cockpit' ? 3 : 0;
    this.draw(renderer, this.marchMat, this.marchRT);
    const c = this.compositeMat.uniforms;
    c.uScene.value = input;
    c.uDepth.value = depth;
    c.uStorm.value = this.marchRT.textures[0];
    c.uAux.value = this.marchRT.textures[1];
    const layer = this.clouds?.reprojectionLayer() ?? null;
    c.uHasCu.value = layer ? 1 : 0;
    c.uCuDist.value = layer?.distance ?? null;
    c.uCuTrans.value = layer?.transmittance ?? null;
    this.draw(renderer, this.compositeMat, output);
    renderer.setRenderTarget(prevTarget);
  }

  dispose(): void {
    this.noise.dispose();
    this.marchRT.dispose();
    [this.marchMat, this.compositeMat, this.copyMat].forEach((mat) => mat.dispose());
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
    // Lambertian ground radiance under the cells: albedo x (direct irradiance + pi x sky radiance) / pi.
    this.groundRadiance
      .copy(sky.sunColor)
      .multiplyScalar(Math.max(sky.sunDir.y, 0) / Math.PI)
      .add(sky.skyColor)
      .multiply(GROUND_ALBEDO);
    if (sky.hazeExtinction > 0 && sky.hazeScaleHeight > 0) this.haze.set(sky.hazeExtinction, sky.hazeScaleHeight);
    else this.haze.set(3.0 / Math.max(ctx.weather.visibilityM, 100), 1200);
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
