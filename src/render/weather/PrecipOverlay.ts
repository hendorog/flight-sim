// Precipitation streaks at the camera (WeatherSettings.precipType, precipRateMmH): a post-TAA overlay
// (PostPipeline.addOverlay), one full-screen draw, no scene objects, no textures of its own.
//
// Each pixel looks for a drop on up to 4 spheres ("shells") about the camera (precipOptics.SHELL_RADII_M: 2, 5, 12
// and 30 m on high and ultra, 2, 6 and 20 m on medium, none on low). On a shell the drops sit in the cells of a grid
// aligned with their motion relative to the camera (precipOptics.ts header): psi = ln tan(theta / 2) along the
// motion, phi about it. Every drop moves at the same rate in psi, so the grid scrolls by one phase per shell, and
// every streak (the drop's path in STREAK_EXPOSURE_S, SNOW_STREAK_EXPOSURE_S for snow, at most STREAK_MAX_M) fits in
// its own cell: the shader reads the one cell the pixel falls in, hashes each of its drop slots
// (precipOptics.dropSlots, at most MAX_DROPS_PER_CELL; one pcg4d hash per slot, Jarzynski and Olano 2020), places
// the drops in it and measures the pixel's distance to each streak in pixels (anti-aliased, since nothing after the
// overlays filters it). Above the rate that fills every slot of a cell, the drops' coverage grows instead
// (precipOptics.dropWeight). Cost: at most 16 hashes per pixel on high and ultra (4 shells x 4 slots), 12 on medium.
//   - Each hash also sets a drop's look. Rain and drizzle: width (STREAK_WIDTH_PX, +-RAIN_WIDTH_SPREAD / 2), length
//     (RAIN_LENGTH_MIN..1 of the streak), brightness (RAIN_BRIGHTNESS_MIN..1), and a fade with the shell's radius
//     (RAIN_DEPTH_FADE_EXP). Snow: a round flake with a soft edge, SNOWFLAKE_MIN_M..SNOWFLAKE_MAX_M across (a flake
//     under 1 px is drawn 1 px across with its coverage scaled by its width), a sway on a small ellipse and a
//     brightness that varies at SNOW_TUMBLE_HZ (the flake tumbling).
//   - Motion: vRel = wind at the camera (ctx.env.wind) - camera velocity (from its position in the last frame; a
//     jump of more than CUT_DISTANCE_M or CUT_SPEED_MS, a change of camera mode or a scenario reset discards the
//     last position) + the fall speed, smoothed with VREL_TAU_S. Parked on index.html?scenario=runway&wx=snow (wind 6 kt from
//     100 deg), vRel read (-2.6, -1.1, -0.1) m/s, mostly horizontal, so with a 1/60 s exposure snow streaks ran
//     across the screen; SNOW_STREAK_EXPOSURE_S keeps them round flakes.
//   - Occlusion: a shell beyond the scene's depth at the pixel (DEPTH_GLSL) is skipped, and in the cockpit a shell
//     point inside the cabin box (PostPipeline.cabinFromView, the tone map's outside mask) draws nothing.
//   - Light: the sky ambient and the direct sun under the cloud layer (Atmosphere.cloudSky.directGround); the
//     landing light and the airport lights do not light the drops.
// The overlay writes the input's alpha unchanged (the tone map's point-source flag). With no precipitation (rate 0)
// or on 'low' active() is false after the first frame and PostPipeline skips it; rendered anyway (the shader warm-up)
// it copies its input. The streaks have no fade-out: they stop on the frame the rate reaches 0. The prevailing visibility in precipitation is not drawn here: the sky, haze and
// clouds read core/weatherFields.effectiveVisibilityM.
// Each column of cells in phi has its own offset in psi, so the cells' edges do not form rings about the axis.
// Known limits: the grid's cells lengthen in powers of 2 as the streaks lengthen (precipOptics.psiScale), so the
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
  MAX_DROPS_PER_CELL,
  dropProbability,
  dropSlots,
  dropWeight,
  dropsPerCell,
  fallSpeed,
  psiScale,
  relativeVelocity,
  shellPhase,
  streakLengthM,
  transportReference,
  type V3,
} from './precipOptics';

/** Shells the shader reads (the length of its uniform arrays). */
export const MAX_SHELLS = 4;
/** Mean full width of a rain or drizzle streak on the screen, px. */
export const STREAK_WIDTH_PX = 1.2;
/**
 * Rain and drizzle drops' variation, from each drop's hash: width STREAK_WIDTH_PX x (1 +- RAIN_WIDTH_SPREAD / 2),
 * length RAIN_LENGTH_MIN..1 of the streak, brightness RAIN_BRIGHTNESS_MIN..1; and the coverage of shell k scales as
 * (radius of shell 0 / radius of shell k)^RAIN_DEPTH_FADE_EXP. Unconfirmed: tuning values.
 */
export const RAIN_WIDTH_SPREAD = 0.3;
export const RAIN_LENGTH_MIN = 0.6;
export const RAIN_BRIGHTNESS_MIN = 0.55;
export const RAIN_DEPTH_FADE_EXP = 0.5;
/**
 * Snowflake diameters, m: SNOWFLAKE_MIN_M + (SNOWFLAKE_MAX_M - SNOWFLAKE_MIN_M) u^2 with u uniform (more small
 * flakes than large). 0.7 to 3.5 px on the 2 m shell at 540 px and a 60 deg field of view. Unconfirmed: tuning values.
 */
export const SNOWFLAKE_MIN_M = 0.003;
export const SNOWFLAKE_MAX_M = 0.015;
/**
 * Snow sway: amplitude across the motion as a fraction of a cell's width in phi (an angle of SNOW_SWAY_CELLS x
 * CELL_ANGLE at theta = 90 deg, 0.01 m on a 2 m shell), SNOW_SWAY_ALONG of that along it; and frequency, Hz (each
 * flake 0.7..1.3 times this, with its own phase). Unconfirmed: tuning values.
 */
export const SNOW_SWAY_CELLS = 0.1;
export const SNOW_SWAY_ALONG = 0.5;
export const SNOW_SWAY_HZ = 1.2;
/**
 * Snow tumble: a flake's coverage varies by up to SNOW_TUMBLE_DEPTH at 0.5..1.5 x SNOW_TUMBLE_HZ. Unconfirmed: tuning
 * values.
 */
export const SNOW_TUMBLE_DEPTH = 0.35;
export const SNOW_TUMBLE_HZ = 0.8;
/** Largest margin of a drop from its cell's edges (precipMargin), fraction of the cell. */
const MAX_CELL_MARGIN = 0.45;
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
  rain: { skyGain: 0.3, sunGain: 0.05, occlusion: 0.3, alpha: 0.7 },
  drizzle: { skyGain: 0.3, sunGain: 0.05, occlusion: 0.3, alpha: 0.35 },
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
uniform vec4 uShellB[${MAX_SHELLS}]; // streak length in psi, width px (snow: the largest flake's), sway in phi cells, alpha
uniform vec4 uShellC[${MAX_SHELLS}]; // drop slots per cell, coverage weight, depth fade, margin in phi cells
uniform int uShells;
uniform float uSnow;         // 1: snowflakes, 0: rain or drizzle streaks
uniform float uPixelAngle;   // rad per pixel
uniform float uTime;         // s
uniform vec3 uRadiance;
uniform float uOcclusion;
uniform float uCabinOn;
uniform mat4 uCabinFromView;

const float PHI_CELLS = ${PHI_CELLS.toFixed(1)};
const float CELL_ANGLE = ${CELL_ANGLE.toFixed(4)};
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
    // Each column of cells (phi) and shell has its own psi offset (a golden-ratio sequence), so the cells' edges,
    // and the streaks that start near them, do not line up in rings about the axis.
    float gs = (psi + A.y) / A.z + fract(float(iP) * 0.618034 + float(k) * 0.381966);
    float cellS = floor(gs);
    float fs = gs - cellS;
    uint iS = uint(int(cellS) + ${PSI_TILE * 4}) & ${PSI_TILE - 1}u;
    vec4 C = uShellC[k];
    float len = B.x / A.z;
    // The drop's light spreads along a streak: fainter as the streak lengthens on the screen.
    float lenPx = s * B.x / uPixelAngle;
    float wRef = max(B.y, 1.0);
    float blur = clamp(sqrt(wRef / max(lenPx, wRef)), ${BLUR_FLOOR.toFixed(2)}, 1.0);
    // Margins from the cell's edges, across (phi cells) and along (psi cells), and the widest drop that fits inside
    // them on the screen (a cell is s x CELL_ANGLE across).
    float marginP = C.w;
    float marginS = C.w * (CELL_ANGLE / A.z);
    float wFit = max(1.0, 2.0 * ((marginP - B.z) * s * CELL_ANGLE / uPixelAngle - 1.0));
    for (int j = 0; j < ${MAX_DROPS_PER_CELL}; j++) {
      if (float(j) >= C.x) break;
      uvec4 h = pcg4d(uvec4(iP, iS, uint(k * 8 + j), 0x9e3779b9u));
      // Two 16-bit uniforms from each 32-bit word: r places the drop, e sets its look.
      vec4 r = vec4(h >> 16u) * (1.0 / 65536.0);
      vec4 e = vec4(h & 0xffffu) * (1.0 / 65536.0);
      // A drop in this slot, thinned as sin^2(theta) (a cell spans sin^2(theta) of the solid angle it does at the
      // equator), with a soft edge so a drop moving toward the axis fades out.
      float exist = smoothstep(r.x, r.x + 0.05, A.w * s * s);
      if (exist <= 0.0) continue;
      float w;
      float l;
      float bright;
      if (uSnow > 0.5) {
        w = B.y * mix(${(SNOWFLAKE_MIN_M / SNOWFLAKE_MAX_M).toFixed(4)}, 1.0, e.x * e.x);
        l = len;
        bright = 1.0 - ${SNOW_TUMBLE_DEPTH.toFixed(2)} * (0.5 + 0.5 * sin(PRECIP_TAU * (${SNOW_TUMBLE_HZ.toFixed(2)} * (0.5 + e.w) * uTime + e.y)));
      } else {
        w = B.y * (${(1 - RAIN_WIDTH_SPREAD / 2).toFixed(3)} + ${RAIN_WIDTH_SPREAD.toFixed(3)} * e.x);
        l = len * mix(${RAIN_LENGTH_MIN.toFixed(2)}, 1.0, e.w);
        bright = mix(${RAIN_BRIGHTNESS_MIN.toFixed(2)}, 1.0, e.y);
      }
      // A drop under 1 px is drawn 1 px across with its coverage scaled by its width. Unconfirmed: a choice for the
      // look; its area (width^2) would hide the flakes of the 12 to 30 m shells (0.3 px and under at 540 px).
      float sub = min(1.0, w);
      w = min(max(w, 1.0), wFit);
      float sway = PRECIP_TAU * (${SNOW_SWAY_HZ.toFixed(2)} * (0.7 + 0.6 * e.z) * uTime + r.w);
      float across = marginP + (1.0 - 2.0 * marginP) * r.y + B.z * sin(sway);
      float head = marginS + r.z * max(0.0, 1.0 - l - 2.0 * marginS) + B.z * ${SNOW_SWAY_ALONG.toFixed(2)} * (CELL_ANGLE / A.z) * cos(sway);
      // Distance from the pixel to the streak (from the head to the head + l in psi), as an angle, in pixels.
      float ex = (fp - across) * (PRECIP_TAU / PHI_CELLS);
      float ey = (fs - clamp(fs, head, head + l)) * A.z;
      float px = s * length(vec2(ex, ey)) / uPixelAngle;
      // Snow: a soft disc, opaque inside a fifth of its radius. Rain: a line anti-aliased over 1 px.
      float cover = uSnow > 0.5 ? 1.0 - smoothstep(0.2 * w - 0.5, 0.5 * w + 0.75, px) : clamp(0.5 * w + 0.5 - px, 0.0, 1.0);
      keep *= 1.0 - min(1.0, cover * exist * blur * B.w * C.y * C.z * bright * sub);
    }
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
  private readonly shellC = Array.from({ length: MAX_SHELLS }, () => new THREE.Vector4());
  private readonly phase = new Float64Array(MAX_SHELLS);
  private readonly cellScale = new Float64Array(MAX_SHELLS);
  private readonly radiance = new THREE.Vector3();

  private readonly camPos = new THREE.Vector3();
  private readonly prevCamPos = new THREE.Vector3();
  private hasPrev = false;
  /** Camera mode and simTime of the last frame drawn (a mode change or a simTime that went back is a cut). */
  private lastMode: SimContext['cameraMode'] | null = null;
  private lastSimTime = 0;
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
        uShellC: { value: this.shellC },
        uShells: { value: 0 },
        uSnow: { value: 0 },
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

  /**
   * False when nothing falls (rate 0, or no shells on this quality) once the streak shader has been compiled (the
   * first render). A false result forgets the camera's motion, as render's copy does.
   */
  active(ctx: SimContext): boolean {
    if (!this.warm) return true;
    const p = precipOf(ctx.weather, this.precip);
    const radii = SHELL_RADII_M[ctx.quality] ?? SHELL_RADII_M.high;
    if (p.rateMmH > 0 && radii.length > 0) return true;
    this.drawn = false;
    this.forgetMotion();
    return false;
  }

  /** Nothing falling: forget the camera's motion so the next shower starts from the current pose. */
  private forgetMotion(): void {
    this.hasPrev = false;
    this.primed = false;
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
      this.forgetMotion();
      this.copyMat.uniforms.uScene.value = input;
      this.pass.render(renderer, this.copyMat, output);
      renderer.setRenderTarget(prevTarget);
      return;
    }
    // A camera mode switch moves the camera without a cut-sized jump at low frame rates; a scenario reset restarts
    // simTime at 0 and puts the aircraft elsewhere.
    if (ctx.simTime < this.lastSimTime) {
      this.primed = false;
      this.camVel.x = this.camVel.y = this.camVel.z = 0;
      this.hasPrev = false;
    }
    if (ctx.cameraMode !== this.lastMode) this.hasPrev = false;
    this.lastMode = ctx.cameraMode;
    this.lastSimTime = ctx.simTime;
    const camera = ctx.camera;
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    const u = this.material.uniforms;
    // Vertical angle of one pixel: 2 tan(fov / 2) / height (projectionMatrix[5] = 1 / tan(fov / 2)).
    u.uPixelAngle.value = 2 / (camera.projectionMatrix.elements[5] * this.height);
    this.updateMotion(ctx, p.type, dt);
    this.updateShells(p, radii, dt);
    u.uSnow.value = p.type === 'snow' ? 1 : 0;
    this.updateLight(renderer, ctx, p.type);
    this.time += Math.max(0, dt);

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
    // The wind at the camera, NED -> three.js (frames.ts nedToThree: x east, y up, z south). SimContext.env is
    // required; the guard is for test contexts built without one.
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
    const streak = streakLengthM(speed, p.type);
    const look = PRECIP_LOOK[p.type as Exclude<PrecipType, 'none'>];
    const snow = p.type === 'snow';
    const pixelAngle = this.material.uniforms.uPixelAngle.value as number;
    const n = Math.min(radii.length, MAX_SHELLS);
    for (let k = 0; k < n; k++) {
      const R = radii[k];
      const scale = psiScale(streak, R);
      const cell = CELL_ANGLE * scale;
      // A new cell length redraws the shell's pattern; keep the phase inside the new period.
      if (scale !== this.cellScale[k]) {
        this.cellScale[k] = scale;
        this.phase[k] = shellPhase(this.phase[k], 0, R, 0, cell);
      }
      if (dt > 0) this.phase[k] = shellPhase(this.phase[k], speed, R, dt, cell);
      const perCell = dropsPerCell(p.rateMmH, k, scale, p.type);
      this.shellA[k].set(R, this.phase[k], cell, dropProbability(p.rateMmH, k, scale, p.type));
      const width = snow ? SNOWFLAKE_MAX_M / (R * pixelAngle) : STREAK_WIDTH_PX;
      const sway = snow ? SNOW_SWAY_CELLS : 0;
      const fade = snow ? 1 : (radii[0] / R) ** RAIN_DEPTH_FADE_EXP;
      const widest = snow ? width : STREAK_WIDTH_PX * (1 + RAIN_WIDTH_SPREAD / 2);
      this.shellB[k].set(streak / R, width, sway, look.alpha);
      this.shellC[k].set(dropSlots(scale, perCell), dropWeight(p.rateMmH, k, scale, p.type), fade, precipMargin(widest, sway, pixelAngle));
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

/**
 * Margin of a drop from its cell's edges, fraction of a cell (CELL_ANGLE): the sway (in cells) plus half the widest
 * drop and 1 px of anti-aliasing at theta = 90 deg (a cell CELL_ANGLE / pixelAngle px across), at most
 * MAX_CELL_MARGIN. A drop inside it is not cut at the cell's edge, which the shader does not read past.
 */
export function precipMargin(widestPx: number, swayCells: number, pixelAngle: number): number {
  return Math.min(MAX_CELL_MARGIN, swayCells + ((0.5 * widestPx + 1) * pixelAngle) / CELL_ANGLE);
}

/** The precipitation overlay. Always created (the weather can start raining at any time); skipped while nothing falls. */
export function createPrecipOverlay(c: WeatherEffectContext): SceneEffect | null {
  return new PrecipOverlay(c.post);
}
