// Hailstones landing, bouncing and lying on the ground near the camera: a post-TAA overlay (PostPipeline.addOverlay)
// of two draws, in every camera mode while the camera is within GROUND_MAX_AGL_M of the ground.
//   scatter   a full-screen pass on upward-facing surfaces (the normal of the depth buffer's world position within
//             SCATTER_MIN_UP of vertical) within SCATTER_RANGE_M. The cover's mean whitening everywhere: the share of
//             the ground under stones (SCATTER_FILL x cover cells holding a stone of the rms diameter's area) plus
//             the smaller ice between them (SCATTER_FILM x cover^2), times 0.8 + 0.2 x a smooth value noise of 2 m
//             and 0.7 m wavelength. Within NEAR_FIELD_M of the camera, and where a stone is larger than half the
//             pixel's footprint, the stones themselves on a world-anchored grid of SCATTER_CELL_M cells (each cell
//             holding one while its hash is below SCATTER_FILL x the cover, of a diameter from the size
//             distribution, hail.ts hailDiameterMm): discs brightened toward their far side (0.85 + 0.25 ny, as the
//             pellets) on a soft contact shadow. Excluded: the aircraft's bounding box (the meshes under
//             ctx.aircraftRoot, in the aircraft's frame, from AIRCRAFT_FLOOR_M above its lowest point; every
//             camera mode) and in the cockpit the cabin box (PostPipeline.cabinFromView).
//   pellets   BOUNCE_CELLS^2 cells of BOUNCE_CELL_M about the camera's ground point (a toroidal window: a cell leaving
//             it on one side comes back on the other), BOUNCE_PER_CELL stones each: every cycle a stone lands at a
//             hashed point, rebounds at the restitution times its fall speed, bounces once more and rolls to rest.
//             Instanced quads facing the camera, depth-tested in the shader against the scene depth. A stone's chance
//             to land in a cycle follows the impact rate (hailGround.ts).
// Both read the hail at the camera (stormPrecip.ts localPrecipAt). The pellets' ground height is the aircraft's
// ground (altitudeMSL - altitudeAGL), so they assume flat ground within the window; the overlay runs while the
// camera is within GROUND_MAX_AGL_M of the ground under the camera itself (ctx.env.groundElevation).
// Cost per frame while active (stated, not measured on a GPU): one full-screen pass (1 depth read, 8 hashes for the
// noise and 1 for the stones per pixel on the surfaces it draws on) and one instanced draw of BOUNCE_CELLS^2 x BOUNCE_PER_CELL quads (768). Without hail
// and without cover, or with the camera higher, active() is false and PostPipeline skips it.
// Every constant is unconfirmed: look values set by eye.

import * as THREE from 'three';
import type { SceneEffect, SimContext } from '../../core/context';
import { DEPTH_GLSL } from '../../core/shaderLib';
import { hailDiameterMm, hailLowMm, HAIL_SCALE_SHARE } from '../../physics/weather/hail';
import { emptyLocalPrecip, localPrecipAt, type LocalPrecip } from '../../physics/weather/stormPrecip';
import { Atmosphere } from '../sky/Atmosphere';
import { FullscreenPass, passMaterial } from '../post/FullscreenPass';
import { cameraStormsAt, cameraStormsOf } from './stormSelection';
import { stormOverheadTau } from './stormShade';
import { HAIL_FALL_K, HAIL_SKY_GAIN, HAIL_SUN_GAIN } from './PrecipOverlay';
import { HAIL_RESTITUTION, HAIL_RESTITUTION_SPREAD, HailGround } from './hailGround';
import type { WeatherEffectContext } from './index';

export const GROUND_MAX_AGL_M = 120;
export const SCATTER_RANGE_M = 80;
export const SCATTER_CELL_M = 0.03;
/** Share of the scatter's cells holding a stone per unit cover, and the whitening between the stones at full cover. */
export const SCATTER_FILL = 1.5;
export const SCATTER_FILM = 0.55;
export const SCATTER_MIN_UP = 0.8;
/** Range within which the scatter draws single stones, m (fading out over its last third). */
export const NEAR_FIELD_M = 6;
/** Height above the aircraft's lowest point from which its bounding box hides the scatter, m. */
export const AIRCRAFT_FLOOR_M = 0.08;
/** Seconds between measurements of the aircraft's bounding box. */
const AIRCRAFT_BOX_S = 2;
export const BOUNCE_CELLS = 16;
export const BOUNCE_CELL_M = 1;
export const BOUNCE_PER_CELL = 3;
/**
 * A stone's radiance over that of the surface behind it (ice of albedo about 0.5 against asphalt of about 0.2), at
 * least the hail radiance of the precipitation overlay (HAIL_SKY_GAIN, HAIL_SUN_GAIN). Unconfirmed: a look value.
 */
export const ICE_OVER_SCENE = 2.5;
/** Cycle of a pellet, s (each 0.8..1.2 times this): landing, two bounces, rest. */
export const BOUNCE_CYCLE_S = 1.6;
/** A stone's horizontal speed after landing, m/s (0.3 .. this). */
export const BOUNCE_SKID_MS = 1.5;

const SCATTER_FRAG = /* glsl */ `
${DEPTH_GLSL}
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uCover;
uniform vec4 uHailSize;   // smallest stone mm, scale mm, 1 - exp(-span / scale), rms stone diameter mm
uniform vec3 uRadiance;
uniform float uCabinOn;
uniform mat4 uCabinFromView;
uniform float uPlaneOn;
uniform mat4 uPlaneFromView;   // view space -> the aircraft's frame
uniform vec3 uPlaneMin;
uniform vec3 uPlaneMax;

uvec4 pcg4d(uvec4 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v ^= v >> 16u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  return v;
}
float h1(ivec2 c, uint k) { return float(pcg4d(uvec4(uvec2(c + 1048576), 12u, k)).x >> 16u) * (1.0 / 65536.0); }
// Smooth value noise, 0..1, on a unit lattice.
float vnoise(vec2 x, uint k) {
  ivec2 i = ivec2(floor(x));
  vec2 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h1(i, k), h1(i + ivec2(1, 0), k), f.x), mix(h1(i + ivec2(0, 1), k), h1(i + ivec2(1, 1), k), f.x), f.y);
}

void main() {
  vec4 scene = texture2D(uScene, vUv);
  gl_FragColor = scene;
  float d = texture2D(uDepth, vUv).r;
  if (isSky(d)) return;
  vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dv = vp.xyz / vp.w;
  dv /= max(-dv.z, 1e-4);
  vec3 pv = dv * viewZFromDepth(d);
  if (uCabinOn > 0.5) {
    vec3 b = (uCabinFromView * vec4(pv, 1.0)).xyz;
    if (max(max(abs(b.x), abs(b.y)), abs(b.z)) < 1.0) return;
  }
  if (uPlaneOn > 0.5) {
    vec3 b = (uPlaneFromView * vec4(pv, 1.0)).xyz;
    if (all(greaterThan(b, uPlaneMin)) && all(lessThan(b, uPlaneMax))) return;
  }
  vec3 pw = (uCamWorld * vec4(pv, 1.0)).xyz;
  vec3 n = normalize(cross(dFdx(pw), dFdy(pw)));
  if (abs(n.y) < ${SCATTER_MIN_UP.toFixed(2)}) return;
  float range = length(pw - uCamPos);
  if (range > ${SCATTER_RANGE_M.toFixed(1)}) return;
  float cellM = ${SCATTER_CELL_M.toFixed(3)};
  vec2 g = pw.xz / cellM;
  // Footprint of the pixel on the ground, cells.
  float fp = max(length(fwidth(g)), 1e-4);
  float fill = min(1.0, ${SCATTER_FILL.toFixed(2)} * uCover);
  // The mean cover: the stones' share of the ground at the mean diameter, the ice between them, in soft patches.
  float rMean = min(0.5 * uHailSize.w * 0.001 / cellM, 0.45);
  float patches = 0.8 + 0.2 * (0.6 * vnoise(pw.xz * 0.5, 1u) + 0.4 * vnoise(pw.xz * 1.43, 2u));
  float film = ${SCATTER_FILM.toFixed(2)} * uCover * uCover;
  float mean = min(1.0, (fill * 3.14159 * rMean * rMean + film) * patches);
  float a = mean;
  vec3 ice = max(uRadiance, ${ICE_OVER_SCENE.toFixed(2)} * scene.rgb);
  vec3 ground = scene.rgb;
  // Near the camera, where a stone covers more than the pixel: the stones one by one.
  float near = (1.0 - smoothstep(${(NEAR_FIELD_M * 2 / 3).toFixed(1)}, ${NEAR_FIELD_M.toFixed(1)}, range)) * (1.0 - smoothstep(rMean, 4.0 * rMean, fp));
  if (near > 0.0) {
    ivec2 c = ivec2(floor(g));
    vec2 f = fract(g);
    vec4 h = vec4(pcg4d(uvec4(uvec2(c + 1048576), 11u, 0u)) >> 16u) * (1.0 / 65536.0);
    float D = uHailSize.x - uHailSize.y * log(1.0 - h.x * uHailSize.z);
    float r = min(0.5 * D * 0.001 / cellM, 0.4);
    vec2 ctr = vec2(0.5) + (h.zw - 0.5) * (1.0 - 2.4 * r);
    float has = step(h.y, fill);
    vec2 o = f - ctr;
    float stone = has * clamp((r - length(o)) / fp + 0.5, 0.0, 1.0);
    // Lit toward its far side, a soft shadow at its foot on the near side.
    vec2 away = normalize(pw.xz - uCamPos.xz + 1e-4);
    float ny = clamp(dot(o, away) / max(r, 1e-4), -1.0, 1.0);
    float foot = has * (1.0 - smoothstep(0.9 * r, 1.5 * r, length(o + 0.25 * r * away))) * (1.0 - stone);
    ground = mix(scene.rgb, scene.rgb * 0.62, near * foot);
    float aNear = max(stone, film * patches);
    a = mix(mean, aNear, near);
    ice = mix(ice, ice * (0.85 + 0.25 * ny), near * stone);
  }
  a *= 1.0 - smoothstep(0.8 * ${SCATTER_RANGE_M.toFixed(1)}, ${SCATTER_RANGE_M.toFixed(1)}, range);
  gl_FragColor = vec4(mix(ground, ice, a), scene.a);
}
`;

const PELLET_VERT = /* glsl */ `
attribute float aId;
uniform vec2 uCamCell;     // camera's cell (x, z indices)
uniform float uGroundY;
uniform float uTime;
uniform float uSpawn;      // chance a stone lands in one cycle
uniform vec4 uHailSize;
uniform float uFallK;
uniform float uPixelAngle;
varying vec2 vCorner;
varying float vAlpha;
varying float vViewZ;

uvec4 pcg4d(uvec4 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v ^= v >> 16u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  return v;
}
vec4 h4(ivec2 c, uint a, uint b) { return vec4(pcg4d(uvec4(uvec2(c + 1048576), a, b)) >> 16u) * (1.0 / 65536.0); }

void main() {
  int id = int(aId + 0.5);
  int slot = id % ${BOUNCE_PER_CELL};
  int cell = id / ${BOUNCE_PER_CELL};
  int n = ${BOUNCE_CELLS};
  ivec2 local = ivec2(cell % n, cell / n);
  // The toroidal window: the world cell this instance covers, within n / 2 cells of the camera's.
  ivec2 base = ivec2(uCamCell) - n / 2;
  ivec2 wc = base + ivec2(mod(vec2(local - base), float(n)));
  vec4 h = h4(wc, 21u, uint(slot));
  float period = ${BOUNCE_CYCLE_S.toFixed(2)} * (0.8 + 0.4 * h.x);
  float cyc = uTime / period + h.y;
  float tau = fract(cyc) * period;
  vec4 e = h4(wc, 22u + uint(slot), uint(int(floor(cyc)) & 4095));
  vec4 k = h4(wc, 40u + uint(slot), uint(int(floor(cyc)) & 4095));
  float D = uHailSize.x - uHailSize.y * log(1.0 - e.x * uHailSize.z);
  float vt = sqrt(uFallK * D);
  float rest = ${HAIL_RESTITUTION.toFixed(2)} + ${HAIL_RESTITUTION_SPREAD.toFixed(2)} * (2.0 * k.x - 1.0);
  float u1 = rest * vt, u2 = rest * u1;
  float g = 9.80665;
  float t1 = 2.0 * u1 / g, t2 = 2.0 * u2 / g;
  float hgt;
  if (tau < t1) hgt = u1 * tau - 0.5 * g * tau * tau;
  else if (tau < t1 + t2) { float s = tau - t1; hgt = u2 * s - 0.5 * g * s * s; }
  else hgt = 0.0;
  float moving = min(tau, t1 + t2 + 0.3);
  float ang = 6.28318531 * k.y;
  vec2 skid = vec2(cos(ang), sin(ang)) * (0.3 + ${(BOUNCE_SKID_MS - 0.3).toFixed(2)} * k.z) * moving * exp(-0.5 * moving);
  vec2 xz = (vec2(wc) + e.yz) * ${BOUNCE_CELL_M.toFixed(2)} + skid;
  float r = 0.0005 * D;
  vec3 wp = vec3(xz.x, uGroundY + hgt + r, xz.y);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vViewZ = -mv.z;
  float pxSize = vViewZ * uPixelAngle;
  float half_ = max(r, 1.5 * pxSize);
  // Present this cycle, gone after a short rest.
  float alive = step(e.w, uSpawn) * (1.0 - smoothstep(t1 + t2 + 0.2, t1 + t2 + 0.5, tau));
  vAlpha = alive * min(1.0, r / pxSize + 0.5);
  // The disc fills the quad: a stone under 1.5 px is drawn 1.5 px across with its coverage scaled (vAlpha).
  vCorner = position.xy;
  mv.xy += position.xy * half_;
  gl_Position = projectionMatrix * mv;
  if (alive <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const PELLET_FRAG = /* glsl */ `
${DEPTH_GLSL}
uniform sampler2D uScene;
uniform sampler2D uDepth;
uniform vec2 uResolution;
uniform vec3 uRadiance;
varying vec2 vCorner;
varying float vAlpha;
varying float vViewZ;
void main() {
  vec2 suv = gl_FragCoord.xy / uResolution;
  float sd = texture2D(uDepth, suv).r;
  float sceneZ = isSky(sd) ? 1e9 : viewZFromDepth(sd);
  if (sceneZ < vViewZ - 0.02) discard;
  float r = length(vCorner);
  float a = vAlpha * (1.0 - smoothstep(0.7, 1.0, r));
  if (a <= 0.0) discard;
  // Ice under the light the ground behind it gets: ICE_OVER_SCENE times the scene behind, at least the hail
  // radiance; brighter on the upper half.
  vec3 behind = texture2D(uScene, suv).rgb;
  gl_FragColor = vec4(max(uRadiance, ${ICE_OVER_SCENE.toFixed(2)} * behind) * (0.85 + 0.25 * vCorner.y), a);
}
`;

const COPY_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uScene;
void main() { gl_FragColor = texture2D(uScene, vUv); }
`;

export class HailGroundOverlay implements SceneEffect {
  readonly name = 'hailGround';
  drawn = false;
  readonly ground = new HailGround();
  readonly local: LocalPrecip = emptyLocalPrecip();
  readonly scatterMat: THREE.ShaderMaterial;
  readonly pelletMat: THREE.ShaderMaterial;
  private readonly copyMat: THREE.ShaderMaterial;
  private readonly pass = new FullscreenPass();
  private readonly pellets: THREE.Mesh;
  private readonly invProj = new THREE.Matrix4();
  private readonly camWorld = new THREE.Matrix4();
  private readonly cabinFromView = new THREE.Matrix4();
  private readonly planeFromView = new THREE.Matrix4();
  private readonly planeMin = new THREE.Vector3();
  private readonly planeMax = new THREE.Vector3();
  /** The aircraft's bounding box in its own frame, and when and for which root it was measured. */
  private readonly planeBox = new THREE.Box3();
  private readonly meshBox = new THREE.Box3();
  private readonly meshToRoot = new THREE.Matrix4();
  private readonly rootInv = new THREE.Matrix4();
  private planeRoot: THREE.Object3D | null = null;
  private planeAt = -Infinity;
  private readonly camPos = new THREE.Vector3();
  private readonly hailSize = new THREE.Vector4(1, 1, 0, 0);
  private readonly radiance = new THREE.Vector3();
  private readonly camCell = new THREE.Vector2();
  private readonly resolution = new THREE.Vector2(1, 1);
  private atmosphere: Atmosphere | null = null;
  private height = 1;
  private lastSimTime = Number.NaN;
  private warm: THREE.WebGLRenderTarget | null = null;

  constructor(private readonly post: WeatherEffectContext['post'] | null = null) {
    this.scatterMat = passMaterial({
      fragmentShader: SCATTER_FRAG,
      uniforms: {
        uScene: { value: null },
        uDepth: { value: null },
        uInvProj: { value: this.invProj },
        uCamWorld: { value: this.camWorld },
        uCamPos: { value: this.camPos },
        uCover: { value: 0 },
        uHailSize: { value: this.hailSize },
        uRadiance: { value: this.radiance },
        uCabinOn: { value: 0 },
        uCabinFromView: { value: this.cabinFromView },
        uPlaneOn: { value: 0 },
        uPlaneFromView: { value: this.planeFromView },
        uPlaneMin: { value: this.planeMin },
        uPlaneMax: { value: this.planeMax },
      },
    });
    this.pelletMat = new THREE.ShaderMaterial({
      vertexShader: PELLET_VERT,
      fragmentShader: PELLET_FRAG,
      uniforms: {
        uScene: { value: null },
        uDepth: { value: null },
        uResolution: { value: this.resolution },
        uRadiance: { value: this.radiance },
        uCamCell: { value: this.camCell },
        uGroundY: { value: 0 },
        uTime: { value: 0 },
        uSpawn: { value: 0 },
        uHailSize: { value: this.hailSize },
        uFallK: { value: HAIL_FALL_K },
        uPixelAngle: { value: 1e-3 },
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      toneMapped: false,
    });
    const count = BOUNCE_CELLS * BOUNCE_CELLS * BOUNCE_PER_CELL;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('aId', new THREE.InstancedBufferAttribute(Float32Array.from({ length: count }, (_, i) => i), 1));
    geo.instanceCount = count;
    this.pellets = new THREE.Mesh(geo, this.pelletMat);
    this.pellets.frustumCulled = false;
    this.copyMat = passMaterial({ fragmentShader: COPY_FRAG, uniforms: { uScene: { value: null } } });
  }

  setSize(width: number, height: number): void {
    this.height = Math.max(1, height);
    this.resolution.set(Math.max(1, width), this.height);
  }

  active(ctx: SimContext): boolean {
    this.advance(ctx);
    if (!this.warm) return true;
    const on = this.wanted(ctx);
    if (!on) this.drawn = false;
    return on;
  }

  render(renderer: THREE.WebGLRenderer, input: THREE.Texture, depth: THREE.DepthTexture, output: THREE.WebGLRenderTarget, ctx: SimContext, _dt: number): void {
    const prevTarget = renderer.getRenderTarget();
    const u = this.scatterMat.uniforms;
    u.uScene.value = input;
    u.uDepth.value = depth;
    this.pelletMat.uniforms.uDepth.value = depth;
    this.pelletMat.uniforms.uScene.value = input;
    if (!this.warm) {
      this.warm = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
      this.pass.render(renderer, this.scatterMat, this.warm);
      renderer.setRenderTarget(this.warm);
      renderer.render(this.pellets, ctx.camera);
    }
    this.drawn = this.wanted(ctx);
    if (!this.drawn) {
      this.copyMat.uniforms.uScene.value = input;
      this.pass.render(renderer, this.copyMat, output);
      renderer.setRenderTarget(prevTarget);
      return;
    }
    const cam = ctx.camera;
    this.invProj.copy(cam.projectionMatrixInverse);
    this.camWorld.copy(cam.matrixWorld);
    this.camPos.setFromMatrixPosition(cam.matrixWorld);
    const g = this.ground;
    u.uCover.value = g.cover;
    const lo = hailLowMm(g.maxMm);
    const scale = Math.max(HAIL_SCALE_SHARE * g.maxMm, 1e-3);
    this.hailSize.set(lo, scale, 1 - Math.exp(-Math.max(0, g.maxMm - lo) / scale), hailRmsMm(g.maxMm));
    const cockpit = ctx.cameraMode === 'cockpit' && this.post !== null;
    u.uCabinOn.value = cockpit ? 1 : 0;
    if (cockpit) this.post!.cabinFromView(ctx, this.cabinFromView);
    u.uPlaneOn.value = this.updatePlaneBox(ctx) ? 1 : 0;
    this.updateLight(renderer, ctx);
    this.pass.render(renderer, this.scatterMat, output);
    if (g.impactsPerM2s > 0) {
      const pu = this.pelletMat.uniforms;
      pu.uGroundY.value = groundY(ctx);
      pu.uTime.value = g.time;
      // Stones landing per instance and cycle: the impact rate over the cell's share of an instance.
      const perCycle = (g.impactsPerM2s * BOUNCE_CELL_M * BOUNCE_CELL_M * BOUNCE_CYCLE_S) / BOUNCE_PER_CELL;
      pu.uSpawn.value = Math.min(1, perCycle);
      pu.uPixelAngle.value = 2 / (cam.projectionMatrix.elements[5] * this.height);
      this.camCell.set(Math.floor(this.camPos.x / BOUNCE_CELL_M), Math.floor(this.camPos.z / BOUNCE_CELL_M));
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(output);
      renderer.render(this.pellets, cam);
      renderer.autoClear = autoClear;
    }
    renderer.setRenderTarget(prevTarget);
  }

  dispose(): void {
    this.scatterMat.dispose();
    this.pelletMat.dispose();
    this.copyMat.dispose();
    this.pellets.geometry.dispose();
    this.warm?.dispose();
  }

  /** Something to draw: hail falling or lying, and the camera within GROUND_MAX_AGL_M of the ground under it. */
  private wanted(ctx: SimContext): boolean {
    if (this.ground.clear) return false;
    const c = ctx.camera?.position;
    if (!c) return false;
    const ground = ctx.env ? ctx.env.groundElevation(-c.z, c.x) : groundY(ctx);
    return c.y - (Number.isFinite(ground) ? ground : groundY(ctx)) < GROUND_MAX_AGL_M;
  }

  /**
   * The view -> aircraft-frame matrix and the aircraft's bounding box (its meshes, measured again every
   * AIRCRAFT_BOX_S), for the scatter to leave the aircraft out. False without an aircraft.
   */
  private updatePlaneBox(ctx: SimContext): boolean {
    const root = ctx.aircraftRoot;
    if (!root) return false;
    const now = performance.now() / 1000;
    if (root !== this.planeRoot || now - this.planeAt > AIRCRAFT_BOX_S) {
      this.planeRoot = root;
      this.planeAt = now;
      const box = this.planeBox.makeEmpty();
      root.updateMatrixWorld();
      this.rootInv.copy(root.matrixWorld).invert();
      root.traverseVisible((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        this.meshToRoot.multiplyMatrices(this.rootInv, mesh.matrixWorld);
        box.union(this.meshBox.copy(mesh.geometry.boundingBox!).applyMatrix4(this.meshToRoot));
      });
    }
    if (this.planeBox.isEmpty()) return false;
    this.planeMin.copy(this.planeBox.min);
    this.planeMin.y += AIRCRAFT_FLOOR_M;
    this.planeMax.copy(this.planeBox.max);
    this.rootInv.copy(root.matrixWorld).invert();
    this.planeFromView.multiplyMatrices(this.rootInv, ctx.camera.matrixWorld);
    return true;
  }

  private advance(ctx: SimContext): void {
    const t = ctx.simTime;
    const dt = Number.isFinite(this.lastSimTime) && t >= this.lastSimTime ? Math.min(0.25, t - this.lastSimTime) : 0;
    if (Number.isFinite(this.lastSimTime) && t < this.lastSimTime) this.ground.reset();
    this.lastSimTime = t;
    const p = this.sample(ctx);
    this.ground.update(p.hailMmH, p.hailMaxMm, dt);
  }

  private sample(ctx: SimContext): LocalPrecip {
    const c = ctx.camera?.position;
    const cells = cameraStormsAt(ctx);
    if (cells.length === 0) {
      this.local.hailMmH = 0;
      this.local.hailMaxMm = 0;
      return this.local;
    }
    const cape = cameraStormsOf(ctx).field.convective(ctx.weather).capeJkg;
    return localPrecipAt(ctx.weather, cells, ctx.simTime, cape, c ? -c.z : 0, c ? c.x : 0, c ? c.y : 0, this.local);
  }

  private updateLight(renderer: THREE.WebGLRenderer, ctx: SimContext): void {
    const sky = ctx.sky;
    const atm = (this.atmosphere ??= Atmosphere.for(renderer));
    const mu0 = Math.max(0, sky.sunDir.y);
    const overhead = stormOverheadTau(ctx);
    const stormSun = overhead > 0 ? Math.exp(-overhead / Math.max(mu0, 0.1)) : 1;
    const hs = mu0 * atm.cloudSky.directGround * stormSun * HAIL_SUN_GAIN;
    this.radiance.set(
      sky.skyColor.r * HAIL_SKY_GAIN + sky.sunColor.r * hs,
      sky.skyColor.g * HAIL_SKY_GAIN + sky.sunColor.g * hs,
      sky.skyColor.b * HAIL_SKY_GAIN + sky.sunColor.b * hs,
    );
  }
}

/** Root-mean-square diameter of the size distribution with largest stone maxMm, mm (16 quantiles): the stones' area. */
export function hailRmsMm(maxMm: number): number {
  let sum = 0;
  for (let j = 0; j < 16; j++) sum += hailDiameterMm((j + 0.5) / 16, maxMm) ** 2;
  return Math.sqrt(sum / 16);
}

/** The ground under the aircraft, three.js world y (MSL m). */
function groundY(ctx: SimContext): number {
  const s = ctx.state;
  return s ? s.altitudeMSL - s.altitudeAGL : 0;
}

/** The hail-on-the-ground overlay. Always created; skipped while no hail falls or lies near the camera. */
export function createHailGroundOverlay(c: WeatherEffectContext): SceneEffect | null {
  return new HailGroundOverlay(c.post);
}
