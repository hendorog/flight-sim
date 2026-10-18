// Precipitation streaks at the camera (WeatherSettings.precipType, precipRateMmH): a post-TAA overlay
// (PostPipeline.addOverlay), one full-screen draw, no scene objects, no textures of its own.
//
// Each pixel looks for a drop on up to 4 spheres ("shells") about the camera (precipOptics.SHELL_RADII_M: 2, 5, 12
// and 30 m on high and ultra, 2, 6 and 20 m on medium, none on low). On a shell the drops sit in the cells of a grid
// aligned with their motion relative to the camera (precipOptics.ts header): psi = ln tan(theta / 2) along the
// motion, phi about it. Every drop moves at the same rate in psi, so the grid scrolls by one phase per shell, and
// every streak (the drop's path in STREAK_EXPOSURE_S, at most STREAK_MAX_M) fits in its own cell: the shader hashes
// the one cell the pixel falls in (pcg4d, Jarzynski and Olano 2020), places the drop in it and measures the pixel's
// distance to the streak in pixels (anti-aliased over STREAK_WIDTH_PX, since nothing after the overlays filters it).
//   - Motion: vRel = wind at the camera (ctx.env.wind) - camera velocity (from its position in the last frame; a
//     jump of more than CUT_DISTANCE_M or CUT_SPEED_MS keeps the previous velocity) + the fall speed, smoothed with
//     VREL_TAU_S. Snow adds a sideways sway of each flake.
//   - Occlusion: a shell beyond the scene's depth at the pixel (DEPTH_GLSL) is skipped, and in the cockpit a shell
//     point inside the cabin box (PostPipeline.cabinFromView, the tone map's outside mask) draws nothing.
//   - Light: the sky ambient and the direct sun under the cloud layer (Atmosphere.cloudSky.directGround); the
//     landing light and the airport lights do not light the drops.
// The overlay writes the input's alpha unchanged (the tone map's point-source flag). With no precipitation (rate 0)
// or on 'low' it copies its input. The prevailing visibility in precipitation is not drawn here: the sky, haze and
// clouds read core/weatherFields.effectiveVisibilityM.
// Known limits: the grid's cells lengthen in powers of 2 as the streaks lengthen (precipOptics.psiCell), so the
// drop pattern of a shell is redrawn at each doubling while the aircraft accelerates; near the axis of the motion
// (the focus of expansion and its opposite) the drops are thinned out as sin^2(theta) so the drops per solid angle
// stay uniform.

import * as THREE from 'three';
import type { SceneEffect, SimContext } from '../../core/context';
import { DEPTH_GLSL } from '../../core/shaderLib';
import type { PrecipType } from '../../core/types';
import { precipOf, type Precip } from '../../core/weatherFields';
import { Atmosphere } from '../sky/Atmosphere';
import { FullscreenPass, passMaterial } from '../post/FullscreenPass';
import type { WeatherEffectContext } from './index';
import {
  AXIS_MIN_SPEED,
  CELL_ANGLE,
  COS_MAX,
  PHI_CELLS,
  PSI_TILE,
  SHELL_RADII_M,
  dropProbability,
  fallSpeed,
  psiCell,
  relativeVelocity,
  shellPhase,
  streakLengthM,
  transportReference,
  type V3,
} from './precipOptics';

/** Shells the shader reads (the length of its uniform arrays). */
export const MAX_SHELLS = 4;
/** Full width of a rain or drizzle streak on the screen, px. */
export const STREAK_WIDTH_PX = 1.2;
/** Diameter of a snowflake, m: its width on a shell is the larger of this and STREAK_WIDTH_PX. Unconfirmed: tuning value. */
export const SNOWFLAKE_M = 0.01;
/** Snow sway: amplitude, m, and frequency, Hz (each flake with its own phase). Unconfirmed: tuning values. */
export const SNOW_SWAY_M = 0.3;
export const SNOW_SWAY_HZ = 1.5;
/** A drop's position across its cell stays this fraction of the cell away from each edge (holds the sway). */
const CELL_MARGIN = 0.2;
/** Camera motion between two frames treated as a cut (the velocity is kept), m and m/s. */
export const CUT_DISTANCE_M = 100;
export const CUT_SPEED_MS = 250;
/** Time constant of the smoothing of the relative velocity, s (turbulence would otherwise shake the streaks). */
export const VREL_TAU_S = 0.2;
/** Faintest a streak gets as it lengthens on the screen (the drop's light spread along it), fraction. */
const BLUR_FLOOR = 0.2;

/**
 * Look of each precipitation type. Unconfirmed: tuning values set by eye on index.html, not measured.
 *   skyGain, sunGain  radiance of a drop: skyGain x the sky ambient + sunGain x the direct sun on a horizontal surface
 *   occlusion         fraction of the scene behind a drop's coverage it hides (0: the drop only adds light)
 *   alpha             coverage of a streak's centre
 */
export const PRECIP_LOOK: Readonly<Record<Exclude<PrecipType, 'none'>, { skyGain: number; sunGain: number; occlusion: number; alpha: number }>> = Object.freeze({
  rain: { skyGain: 0.6, sunGain: 0.05, occlusion: 0.3, alpha: 0.7 },
  drizzle: { skyGain: 0.6, sunGain: 0.05, occlusion: 0.3, alpha: 0.35 },
  snow: { skyGain: 0.8, sunGain: 0.25, occlusion: 1, alpha: 0.9 },
});

const PRECIP_FRAG = /* glsl */ `
${DEPTH_GLSL}
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uAxis;          // unit relative velocity of the drops, world
uniform vec3 uAxisU;         // phi = 0 reference, perpendicular to uAxis
uniform vec3 uAxisW;         // uAxis x uAxisU
uniform vec4 uShellA[${MAX_SHELLS}]; // radius m, psi phase, psi cell length, drop probability
uniform vec4 uShellB[${MAX_SHELLS}]; // streak length in psi, width px, sway amplitude in phi cells, alpha
uniform int uShells;
uniform float uPixelAngle;   // rad per pixel
uniform float uTime;         // s
uniform vec3 uRadiance;
uniform float uOcclusion;
uniform float uCabinOn;
uniform mat4 uCabinFromView;

const float PHI_CELLS = ${PHI_CELLS.toFixed(1)};
const float PRECIP_TAU = 6.28318531;

// pcg4d (Jarzynski and Olano 2020, "Hash Functions for GPU Rendering").
uvec4 pcg4d(uvec4 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v ^= v >> 16u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  return v;
}

void main() {
  vec4 scene = texture2D(uScene, vUv);
  vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dv = normalize(vp.xyz / vp.w);
  float d = texture2D(uDepth, vUv).r;
  float sceneDist = isSky(d) ? 1e9 : viewZFromDepth(d) / max(-dv.z, 1e-4);
  vec3 dir = normalize(mat3(uCamWorld) * dv);
  float c = clamp(dot(dir, uAxis), -${COS_MAX}, ${COS_MAX});
  float s = sqrt(1.0 - c * c);
  float psi = 0.5 * log((1.0 - c) / (1.0 + c));
  float gp = (atan(dot(dir, uAxisW), dot(dir, uAxisU)) + 3.14159265) * (PHI_CELLS / PRECIP_TAU);
  float cellP = floor(gp);
  float fp = gp - cellP;
  uint iP = uint(mod(cellP, PHI_CELLS));
  float keep = 1.0;
  for (int k = 0; k < ${MAX_SHELLS}; k++) {
    if (k >= uShells) break;
    vec4 A = uShellA[k];
    vec4 B = uShellB[k];
    // Shells are in ascending radius: the first one behind the scene ends the search.
    if (A.x > sceneDist) break;
    if (uCabinOn > 0.5) {
      vec3 b = (uCabinFromView * vec4(dv * A.x, 1.0)).xyz;
      if (max(max(abs(b.x), abs(b.y)), abs(b.z)) < 1.0) continue;
    }
    float gs = (psi + A.y) / A.z;
    float cellS = floor(gs);
    float fs = gs - cellS;
    uint iS = uint(int(cellS) + ${PSI_TILE * 4}) & ${PSI_TILE - 1}u;
    vec4 r = vec4(pcg4d(uvec4(iP, iS, uint(k), 0x9e3779b9u))) * (1.0 / 4294967296.0);
    // A drop in this cell, thinned as sin^2(theta) (a cell spans sin^2(theta) of the solid angle it does at the
    // equator), with a soft edge so a drop moving toward the axis fades out.
    float exist = smoothstep(r.x, r.x + 0.05, A.w * s * s);
    if (exist <= 0.0) continue;
    float len = B.x / A.z;
    float across = ${CELL_MARGIN.toFixed(2)} + ${(1 - 2 * CELL_MARGIN).toFixed(2)} * r.y + B.z * sin(PRECIP_TAU * (${SNOW_SWAY_HZ.toFixed(2)} * uTime + r.w));
    float head = r.z * max(0.0, 1.0 - len);
    // Distance from the pixel to the streak (from the head to the head + len in psi), as an angle, in pixels.
    float ex = (fp - across) * (PRECIP_TAU / PHI_CELLS);
    float ey = (fs - clamp(fs, head, head + len)) * A.z;
    float px = s * length(vec2(ex, ey)) / uPixelAngle;
    float cover = clamp(0.5 * B.y + 0.5 - px, 0.0, 1.0);
    // The drop's light spreads along a streak: fainter as the streak lengthens on the screen.
    float lenPx = s * B.x / uPixelAngle;
    float blur = clamp(sqrt(B.y / max(lenPx, B.y)), ${BLUR_FLOOR.toFixed(2)}, 1.0);
    keep *= 1.0 - cover * exist * blur * B.w;
  }
  float a = 1.0 - keep;
  gl_FragColor = vec4(scene.rgb * (1.0 - a * uOcclusion) + uRadiance * a, scene.a);
}
`;

const COPY_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uScene;
void main() { gl_FragColor = texture2D(uScene, vUv); }
`;

export class PrecipOverlay implements SceneEffect {
  readonly name = 'precipitation';
  /** Whether the last frame drew streaks (false: it copied its input). For tests and tools. */
  drawn = false;
  readonly material: THREE.ShaderMaterial;
  private readonly copyMat: THREE.ShaderMaterial;
  private readonly pass = new FullscreenPass();
  private atmosphere: Atmosphere | null = null;
  private height = 1;
  private time = 0;
  private warm: THREE.WebGLRenderTarget | null = null;

  private readonly precip: Precip = { type: 'none', rateMmH: 0 };
  private readonly invProj = new THREE.Matrix4();
  private readonly camWorld = new THREE.Matrix4();
  private readonly cabinFromView = new THREE.Matrix4();
  private readonly axis = new THREE.Vector3(0, -1, 0);
  private readonly axisU = new THREE.Vector3(1, 0, 0);
  private readonly axisW = new THREE.Vector3(0, 0, 1);
  private readonly shellA = Array.from({ length: MAX_SHELLS }, () => new THREE.Vector4());
  private readonly shellB = Array.from({ length: MAX_SHELLS }, () => new THREE.Vector4());
  private readonly phase = new Float64Array(MAX_SHELLS);
  private readonly cellScale = new Float64Array(MAX_SHELLS);
  private readonly radiance = new THREE.Vector3();

  private readonly camPos = new THREE.Vector3();
  private readonly prevCamPos = new THREE.Vector3();
  private hasPrev = false;
  private readonly camVel: V3 = { x: 0, y: 0, z: 0 };
  private readonly wind: V3 = { x: 0, y: 0, z: 0 };
  private readonly target: V3 = { x: 0, y: 0, z: 0 };
  /** Smoothed velocity of the drops relative to the camera, three.js world, m/s. */
  readonly vRel: V3 = { x: 0, y: -1, z: 0 };
  private primed = false;
  private readonly ned = { x: 0, y: 0, z: 0 };

  constructor(private readonly post: WeatherEffectContext['post'] | null = null) {
    this.material = passMaterial({
      fragmentShader: PRECIP_FRAG,
      uniforms: {
        uScene: { value: null },
        uDepth: { value: null },
        uInvProj: { value: this.invProj },
        uCamWorld: { value: this.camWorld },
        uAxis: { value: this.axis },
        uAxisU: { value: this.axisU },
        uAxisW: { value: this.axisW },
        uShellA: { value: this.shellA },
        uShellB: { value: this.shellB },
        uShells: { value: 0 },
        uPixelAngle: { value: 1e-3 },
        uTime: { value: 0 },
        uRadiance: { value: this.radiance },
        uOcclusion: { value: 0 },
        uCabinOn: { value: 0 },
        uCabinFromView: { value: this.cabinFromView },
      },
    });
    this.copyMat = passMaterial({ fragmentShader: COPY_FRAG, uniforms: { uScene: { value: null } } });
  }

  setSize(_width: number, height: number): void {
    this.height = Math.max(1, height);
  }

  render(renderer: THREE.WebGLRenderer, input: THREE.Texture, depth: THREE.DepthTexture, output: THREE.WebGLRenderTarget, ctx: SimContext, dt: number): void {
    const prevTarget = renderer.getRenderTarget();
    const p = precipOf(ctx.weather, this.precip);
    const radii = SHELL_RADII_M[ctx.quality] ?? SHELL_RADII_M.high;
    this.drawn = p.rateMmH > 0 && radii.length > 0;
    if (!this.warm) {
      // Compile the streak shader on the first frame (into a 1x1 target), so the first shower does not stall on it.
      this.warm = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
      this.material.uniforms.uScene.value = input;
      this.material.uniforms.uDepth.value = depth;
      this.pass.render(renderer, this.material, this.warm);
    }
    if (!this.drawn) {
      // Nothing falling: forget the camera's motion so the next shower starts from the current pose.
      this.hasPrev = false;
      this.primed = false;
      this.copyMat.uniforms.uScene.value = input;
      this.pass.render(renderer, this.copyMat, output);
      renderer.setRenderTarget(prevTarget);
      return;
    }
    const camera = ctx.camera;
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    const u = this.material.uniforms;
    // Vertical angle of one pixel: 2 tan(fov / 2) / height (projectionMatrix[5] = 1 / tan(fov / 2)).
    u.uPixelAngle.value = 2 / (camera.projectionMatrix.elements[5] * this.height);
    this.updateMotion(ctx, p.type, dt);
    this.updateShells(p, radii, dt);
    this.updateLight(renderer, ctx, p.type);
    this.time = (this.time + Math.max(0, dt)) % 3600;

    this.invProj.copy(camera.projectionMatrixInverse);
    this.camWorld.copy(camera.matrixWorld);
    u.uScene.value = input;
    u.uDepth.value = depth;
    u.uShells.value = Math.min(radii.length, MAX_SHELLS);
    u.uTime.value = this.time;
    const cockpit = ctx.cameraMode === 'cockpit' && this.post !== null;
    u.uCabinOn.value = cockpit ? 1 : 0;
    if (cockpit) this.post!.cabinFromView(ctx, this.cabinFromView);
    this.pass.render(renderer, this.material, output);
    renderer.setRenderTarget(prevTarget);
  }

  dispose(): void {
    this.material.dispose();
    this.copyMat.dispose();
    this.warm?.dispose();
  }

  /** Relative velocity of the drops (smoothed) and the grid's axes. */
  private updateMotion(ctx: SimContext, type: PrecipType, dt: number): void {
    const cam = this.camPos;
    if (dt > 0 && this.hasPrev) {
      const dx = cam.x - this.prevCamPos.x, dy = cam.y - this.prevCamPos.y, dz = cam.z - this.prevCamPos.z;
      const dist = Math.hypot(dx, dy, dz);
      // A cut or teleport keeps the last velocity.
      if (dist <= CUT_DISTANCE_M && dist / dt <= CUT_SPEED_MS) {
        this.camVel.x = dx / dt;
        this.camVel.y = dy / dt;
        this.camVel.z = dz / dt;
      }
    }
    if (dt > 0 || !this.hasPrev) {
      this.prevCamPos.copy(cam);
      this.hasPrev = true;
    }
    // The wind at the camera, NED -> three.js (frames.ts nedToThree: x east, y up, z south).
    const env = ctx.env as Partial<SimContext['env']> | undefined;
    if (env && typeof env.wind === 'function') {
      this.ned.x = -cam.z;
      this.ned.y = cam.x;
      this.ned.z = -cam.y;
      const w = env.wind(this.ned, ctx.simTime);
      this.wind.x = w.y;
      this.wind.y = -w.z;
      this.wind.z = -w.x;
    } else {
      this.wind.x = this.wind.y = this.wind.z = 0;
    }
    relativeVelocity(this.wind, this.camVel, fallSpeed(type), this.target);
    const v = this.vRel;
    if (!this.primed) {
      v.x = this.target.x;
      v.y = this.target.y;
      v.z = this.target.z;
      this.primed = true;
    } else if (dt > 0) {
      const k = 1 - Math.exp(-dt / VREL_TAU_S);
      v.x += (this.target.x - v.x) * k;
      v.y += (this.target.y - v.y) * k;
      v.z += (this.target.z - v.z) * k;
    }
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed > AXIS_MIN_SPEED) {
      this.axis.set(v.x / speed, v.y / speed, v.z / speed);
      transportReference(this.axis, this.axisU);
      this.axisW.crossVectors(this.axis, this.axisU);
    }
  }

  /** Per-shell uniforms: phase, cell length, drop probability, streak length and width, sway. */
  private updateShells(p: Precip, radii: readonly number[], dt: number): void {
    const v = this.vRel;
    const speed = Math.hypot(v.x, v.y, v.z);
    const streak = streakLengthM(speed);
    const look = PRECIP_LOOK[p.type as Exclude<PrecipType, 'none'>];
    const snow = p.type === 'snow';
    const pixelAngle = this.material.uniforms.uPixelAngle.value as number;
    const n = Math.min(radii.length, MAX_SHELLS);
    for (let k = 0; k < n; k++) {
      const R = radii[k];
      const [cell, scale] = psiCell(streak, R);
      // A new cell length redraws the shell's pattern; keep the phase inside the new period.
      if (scale !== this.cellScale[k]) {
        this.cellScale[k] = scale;
        this.phase[k] = shellPhase(this.phase[k], 0, R, 0, cell);
      }
      if (dt > 0) this.phase[k] = shellPhase(this.phase[k], speed, R, dt, cell);
      this.shellA[k].set(R, this.phase[k], cell, dropProbability(p.rateMmH, k, scale, p.type));
      const width = snow ? Math.max(STREAK_WIDTH_PX, SNOWFLAKE_M / (R * pixelAngle)) : STREAK_WIDTH_PX;
      // The sway in phi cells at theta = 90 deg, held inside the cell's margin.
      const sway = snow ? Math.min(SNOW_SWAY_M / (R * CELL_ANGLE), CELL_MARGIN - 0.05) : 0;
      this.shellB[k].set(streak / R, width, sway, look.alpha);
    }
  }

  private updateLight(renderer: THREE.WebGLRenderer, ctx: SimContext, type: PrecipType): void {
    const sky = ctx.sky;
    const look = PRECIP_LOOK[type as Exclude<PrecipType, 'none'>];
    const a = (this.atmosphere ??= Atmosphere.for(renderer));
    const sun = Math.max(0, sky.sunDir.y) * a.cloudSky.directGround * look.sunGain;
    this.radiance.set(
      sky.skyColor.r * look.skyGain + sky.sunColor.r * sun,
      sky.skyColor.g * look.skyGain + sky.sunColor.g * sun,
      sky.skyColor.b * look.skyGain + sky.sunColor.b * sun,
    );
    this.material.uniforms.uOcclusion.value = look.occlusion;
  }
}

/** The precipitation overlay. Always created (the weather can start raining at any time); it copies its input while nothing falls. */
export function createPrecipOverlay(c: WeatherEffectContext): SceneEffect | null {
  return new PrecipOverlay(c.post);
}
