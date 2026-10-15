// Deep Time, increment 2 (WP5): the volcano's ash and steam plume, a bounded ray march composited over the HDR
// scene. Inserted by the Simulator (through eraEffects.ts) immediately BEFORE the clouds, so the cumulus in front of
// it occludes it; only outside the present day, only when the era has a volcano, and not with ?eraoff=plume.
//
// Per frame (2 draws; a plain copy when the plume's bounds are off screen):
//   1. march      (MARCH_FRAG)      half resolution, MRT: premultiplied radiance + transmittance, and an aux target
//                                   with the plume's density-weighted distance and the scene depth the ray met
//   2. composite  (COMPOSITE_FRAG)  full resolution, depth-aware upsample: out = scene * T + L
// The march is PLUME_STEPS steps between the ray's entry into and exit from the plume's bounding box (clipped by
// the scene depth: the log-depth decode of DEPTH_GLSL), from an interleaved-gradient-noise start offset that
// changes every frame (the TAA after the effects resolves it).
//
// The plume (plumeBounds): a column from the crater floor to PLUME_TOP_MSL that leans downwind (the weather's wind,
// the FaunaSystem.windTo convention: windDirectionDeg is where it blows FROM) and spreads into an umbrella. Its
// density is a radial falloff broken up by a private 64^3 tileable noise (2 octaves) that rises slowly
// (uEraTime x PLUME_RISE m/s). Look: a dense ash core (albedo 0.08) grading to a pale steam cap (0.6). Light: the
// sun at the plume's altitude (the shared Atmosphere's transmittance, so it stays lit after sunset at the ground)
// through 2 light taps with a Henyey-Greenstein phase (g = 0.6: a silver edge against a low sun), the sky ambient,
// and the lava's underglow, exp(-h / 400 m) x lavaGain(uLava.w) x (0.9, 0.35, 0.08) (world/terrain/volcano.ts).
// Haze: the shared aerial-perspective volume (AERIAL_ATLAS_GLSL) at the density-weighted distance, as the clouds.
// Brightness is clamped so no plume pixel exceeds PLUME_MAX_EXPOSED x the adapted exposure's daylight scale.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { SceneEffect, SimContext } from '../../core/context';
import type { WeatherSettings } from '../../core/types';
import { DEPTH_GLSL } from '../../core/shaderLib';
import type { VolcanoSpec } from '../../world/era/types';
import { ERA_UNIFORMS } from '../../world/terrain/eraUniforms';
import { LAVA_GAIN_GLSL } from '../../world/terrain/volcano';
import { Atmosphere } from '../sky/Atmosphere';
import { transmittanceToSpace } from '../sky/transmittance';
import { FULLSCREEN_VERT } from '../clouds/resolveShaders';
import { AERIAL_ATLAS_GLSL } from './AerialPerspectiveEffect';

/** Extinction of the full-density ash, 1/m (optically thick: a dark column on a bright sky). */
export const PLUME_DENSITY = 1 / 16;
/** Ray-march steps through the plume's bounds (the shader's only loop; tests/era/plume.test.ts caps it at 24). */
export const PLUME_STEPS = 20;
/** Linear resolution of the march relative to the screen. */
export const PLUME_SCALE = 0.5;
/** Top of the plume (the umbrella's top), m MSL. */
export const PLUME_TOP_MSL = 6500;
/** Radius of the column at the vent, at the umbrella's base, and of the umbrella, m. */
export const PLUME_VENT_R = 550;
export const PLUME_COLUMN_R = 1900;
export const PLUME_UMBRELLA_R = 2400;
/** Where the umbrella starts spreading, as a fraction of the rise from the vent to the top. */
export const PLUME_UMBRELLA_FROM = 0.6;
/** Horizontal lean of the top per m/s of wind, as a fraction of the rise; and its largest value. */
/** The density reaches out to this multiple of the local radius (plumeDensity's cut-off; plumeBounds' box). */
export const PLUME_SUPPORT = 1.3;
export const PLUME_LEAN_PER_MS = 0.06;
export const PLUME_LEAN_MAX = 1.2;
/** Upward advection of the noise, m/s. */
export const PLUME_RISE = 4;
/** Underglow scale height above the vent, m, and its strength relative to the crater's lavaGain. */
export const PLUME_GLOW_H = 400;
export const PLUME_GLOW_K = 0.05;

const KT = 0.514444;

/** The plume's geometry in three.js world space (x east, y up MSL, z south). */
export interface PlumeBounds {
  /** The vent (the crater floor's centre). */
  vent: THREE.Vector3;
  /** Top of the plume, m MSL. */
  top: number;
  /** Horizontal offset of the top's centre from the vent (world x, z), m: the lean. */
  lean: THREE.Vector2;
  /** Axis-aligned box that contains all of it. */
  box: THREE.Box3;
}

export function makePlumeBounds(): PlumeBounds {
  return { vent: new THREE.Vector3(), top: PLUME_TOP_MSL, lean: new THREE.Vector2(), box: new THREE.Box3() };
}

/** The plume of volcano V in this weather (pure; writes `out`). */
export function plumeBounds(V: VolcanoSpec, weather: Pick<WeatherSettings, 'windDirectionDeg' | 'windSpeedKt'>, out: PlumeBounds): PlumeBounds {
  const floor = V.summit - V.craterDepth;
  out.vent.set(V.east, floor, -V.north);
  out.top = Math.max(PLUME_TOP_MSL, floor + 1000);
  const rise = out.top - floor;
  // Wind TO (north, east), as FaunaSystem.windTo: the weather gives where it blows from.
  const from = ((weather?.windDirectionDeg ?? 0) * Math.PI) / 180;
  const ms = Math.max(0, weather?.windSpeedKt ?? 0) * KT;
  const lean = Math.min(PLUME_LEAN_MAX, ms * PLUME_LEAN_PER_MS) * rise;
  const toN = -Math.cos(from);
  const toE = -Math.sin(from);
  out.lean.set(toE * lean, -toN * lean);
  // The density's support (plumeDensity: r > R * PLUME_SUPPORT is empty, and the noise keeps it non-zero up to
  // there), R the widest of the vent, column and umbrella radii: the march must not clip it.
  const R = Math.max(PLUME_UMBRELLA_R, PLUME_COLUMN_R, PLUME_VENT_R) * PLUME_SUPPORT;
  out.box.min.set(out.vent.x + Math.min(0, out.lean.x) - R, floor - 60, out.vent.z + Math.min(0, out.lean.y) - R);
  out.box.max.set(out.vent.x + Math.max(0, out.lean.x) + R, out.top + 250, out.vent.z + Math.max(0, out.lean.y) + R);
  return out;
}

// ------------------------------------------------------------------------------------------------ noise

const NOISE_N = 64;

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable Worley distance (nearest feature point) over a `cells`^3 grid, at a point in [0, 1)^3. */
function worleyField(cells: number, seed: number): (x: number, y: number, z: number) => number {
  const rnd = mulberry32(seed);
  const pts = new Float32Array(cells * cells * cells * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = rnd();
  return (x, y, z) => {
    const px = x * cells, py = y * cells, pz = z * cells;
    const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
    let best = 9;
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const cx = ix + dx, cy = iy + dy, cz = iz + dz;
          const k = ((((cz % cells) + cells) % cells) * cells * cells + (((cy % cells) + cells) % cells) * cells + (((cx % cells) + cells) % cells)) * 3;
          const ex = cx + pts[k] - px, ey = cy + pts[k + 1] - py, ez = cz + pts[k + 2] - pz;
          const d = ex * ex + ey * ey + ez * ez;
          if (d < best) best = d;
        }
    return Math.sqrt(best);
  };
}

/**
 * The plume's private 64^3 tileable noise: billowy (inverted Worley at two cell counts), 0..1 in R (8 bit).
 * Built on the CPU in the constructor (synchronous, no GPU work), ~0.1 s.
 */
export function createPlumeNoise(): THREE.Data3DTexture {
  const data = new Uint8Array(NOISE_N * NOISE_N * NOISE_N);
  const w4 = worleyField(4, 0x9b1);
  const w8 = worleyField(8, 0x37c);
  const w16 = worleyField(16, 0x5d3);
  let i = 0;
  for (let z = 0; z < NOISE_N; z++)
    for (let y = 0; y < NOISE_N; y++)
      for (let x = 0; x < NOISE_N; x++) {
        const u = (x + 0.5) / NOISE_N, v = (y + 0.5) / NOISE_N, w = (z + 0.5) / NOISE_N;
        const n = 0.55 * (1 - w4(u, v, w) * 1.15) + 0.3 * (1 - w8(u, v, w) * 1.15) + 0.15 * (1 - w16(u, v, w) * 1.15);
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

// ------------------------------------------------------------------------------------------------ shaders

const RAY_GLSL = /* glsl */ `
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
vec3 rayDirView(vec2 uv) {
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  return normalize(v.xyz / v.w);
}
`;

export const PLUME_MARCH_FRAG = /* glsl */ `
${DEPTH_GLSL}
${RAY_GLSL}
${AERIAL_ATLAS_GLSL}
${LAVA_GAIN_GLSL}
in vec2 vUv;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outAux;

uniform sampler2D uDepth;
uniform highp sampler3D uNoise;
uniform float uAerialOn;
uniform vec2 uHaze;            // sea-level extinction 1/m, scale height m (fallback haze)
uniform vec3 uHazeColor;
uniform float uFrame;

uniform vec3 uVent;            // world
uniform float uTop;            // m MSL
uniform vec2 uLean;            // world xz offset of the top's centre
uniform vec4 uRadii;           // vent, column top, umbrella, umbrella start (fraction of the rise)
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform float uDensity;        // extinction of the full-density ash, 1/m

uniform vec3 uSunDir;
uniform vec3 uSunTop;          // direct sunlight at the plume's altitude
uniform vec3 uSkyColor;
uniform float uMaxRadiance;    // clamp (exposure-referenced firefly guard)

uniform float uEraTime;
uniform vec4 uLava;

const float PLUME_PI = 3.14159265;

float plumeHg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PLUME_PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

// Density 0..1 at a world point; u = the fraction of the rise (for the look).
float plumeDensity(vec3 p, out float u) {
  float rise = uTop - uVent.y;
  float h = p.y - uVent.y;
  u = clamp(h / rise, 0.0, 1.0);
  vec2 c = uVent.xz + uLean * pow(u, 1.5);
  float r = length(p.xz - c);
  float R = mix(uRadii.x, uRadii.y, smoothstep(0.0, uRadii.w, u));
  float umb = smoothstep(uRadii.w, 0.97, u);
  R = mix(R, uRadii.z, umb * umb * (3.0 - 2.0 * umb));
  if (r > R * ${PLUME_SUPPORT.toFixed(2)} || h < -20.0 || h > rise + 200.0) return 0.0;
  // Noise rising with the column (and drifting downwind with the lean), two octaves.
  vec3 q = p - vec3(uLean.x, rise, uLean.y) * (uEraTime * ${PLUME_RISE.toFixed(1)} / rise);
  float n = texture(uNoise, q / 1700.0).r * 0.62 + texture(uNoise, q / 430.0 + 0.37).r * 0.38;
  float shape = 1.0 - r / R;
  // The umbrella's top is flattened and frayed; the column fades in just above the crater floor.
  float vert = smoothstep(-20.0, 120.0, h) * (1.0 - smoothstep(rise - 600.0 * (0.6 + n), rise + 150.0, h));
  return clamp(shape * 1.5 + (n - 0.5) * 2.4 - 0.1, 0.0, 1.0) * vert;
}

float plumeDensity(vec3 p) { float u; return plumeDensity(p, u); }

vec2 boxHit(vec3 o, vec3 d) {
  vec3 inv = 1.0 / d;
  vec3 t0 = (uBoxMin - o) * inv, t1 = (uBoxMax - o) * inv;
  vec3 lo = min(t0, t1), hi = max(t0, t1);
  return vec2(max(max(lo.x, lo.y), max(lo.z, 0.0)), min(min(hi.x, hi.y), hi.z));
}

void main() {
  vec3 dv = rayDirView(vUv);
  vec3 dir = normalize(mat3(uCamWorld) * dv);
  float d = texture(uDepth, vUv).r;
  float sceneDist = isSky(d) ? 1e8 : viewZFromDepth(d) / max(-dv.z, 1e-4);
  vec2 hit = boxHit(uCamPos, dir);
  hit.y = min(hit.y, sceneDist);
  outAux = vec4(log2(1.0 + 1e8), log2(1.0 + sceneDist), 0.0, 0.0);
  if (hit.x >= hit.y) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  // Interleaved gradient noise start offset (Jimenez 2014), a new pattern each frame.
  vec2 px = gl_FragCoord.xy + vec2(47.0, 17.0) * mod(uFrame, 64.0);
  float jitter = fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
  float dt = (hit.y - hit.x) / ${PLUME_STEPS.toFixed(1)};
  float cosSun = dot(dir, uSunDir);
  float phase = mix(plumeHg(cosSun, 0.6), plumeHg(cosSun, -0.25), 0.3);
  float glow = lavaGain(uLava.w) * ${PLUME_GLOW_K.toFixed(4)};
  vec3 L = vec3(0.0);
  float T = 1.0;
  float dsum = 0.0, wsum = 0.0;
  for (int i = 0; i < ${PLUME_STEPS}; i++) {
    float t = hit.x + (float(i) + jitter) * dt;
    vec3 p = uCamPos + dir * t;
    float u;
    float den = plumeDensity(p, u);
    if (den <= 0.002) continue;
    float steam = smoothstep(0.55, 0.95, u + 0.25 * (1.0 - den));
    float sigma = den * uDensity * mix(1.0, 0.45, steam);
    // Sunlight through the plume toward the sun: two taps.
    float tau = (plumeDensity(p + uSunDir * 140.0) * 140.0 + plumeDensity(p + uSunDir * 520.0) * 380.0) * uDensity * mix(1.0, 0.45, steam);
    // Ash (brown-grey, albedo ~0.08) grading to a grey steam-and-ash cap (0.45: grey, not white, against the sky).
    vec3 albedo = mix(vec3(0.1, 0.082, 0.066), vec3(0.45), steam);
    float h = p.y - uVent.y;
    vec3 S = albedo * (uSunTop * exp(-tau) * phase + uSkyColor * (0.55 + 0.45 * u))
           + vec3(0.9, 0.35, 0.08) * (glow * exp(-h / ${PLUME_GLOW_H.toFixed(1)}) * (0.35 + albedo.g));
    float Ts = exp(-sigma * dt);
    float a = T * (1.0 - Ts);
    L += S * a;
    dsum += t * a;
    wsum += a;
    T *= Ts;
    if (T < 0.01) break;
  }
  if (wsum <= 1e-5) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float front = dsum / wsum;
  // Haze between the camera and the plume: its own aerial perspective at the density-weighted distance.
  vec3 inscatter;
  float Th;
  if (uAerialOn > 0.5) {
    vec4 ap = aerialPerspective(vUv, front);
    Th = ap.a;
    inscatter = ap.rgb;
  } else {
    float y0 = uCamPos.y, y1 = uCamPos.y + dir.y * front, H = uHaze.y;
    float avg = abs(y1 - y0) < 1.0 ? exp(-y0 / H) : H * (exp(-y0 / H) - exp(-y1 / H)) / (y1 - y0);
    Th = exp(-uHaze.x * front * avg);
    inscatter = uHazeColor * (1.0 - Th);
  }
  L = min(L, vec3(uMaxRadiance));
  outColor = vec4(L * Th + inscatter * (1.0 - T), T);
  outAux = vec4(log2(1.0 + front), log2(1.0 + sceneDist), 0.0, 0.0);
}
`;

/**
 * Depth-aware upsample (the 2x2 bilinear taps weighted by depth similarity) and composite: out = scene * T + L. A tap
 * whose plume lies behind this pixel's surface contributes no plume, so the cockpit frame, the aircraft and the
 * ridgelines in front of it stay clean where the half-resolution march did not see them.
 */
export const PLUME_COMPOSITE_FRAG = /* glsl */ `
${DEPTH_GLSL}
${RAY_GLSL}
in vec2 vUv;
layout(location = 0) out vec4 outColor;
uniform sampler2D uScene;
uniform sampler2D uDepth;
uniform sampler2D uPlume;
uniform sampler2D uAux;
uniform vec2 uLowSize;

void main() {
  vec4 scene = texture(uScene, vUv);
  float d = texture(uDepth, vUv).r;
  vec3 dv = rayDirView(vUv);
  float dist = isSky(d) ? 1e8 : viewZFromDepth(d) / max(-dv.z, 1e-4);
  float logD = log2(1.0 + dist);
  vec2 lp = vUv * uLowSize - 0.5;
  ivec2 i0 = ivec2(floor(lp));
  vec2 f = lp - vec2(i0);
  ivec2 maxPx = ivec2(uLowSize) - 1;
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    ivec2 q = clamp(i0 + o, ivec2(0), maxPx);
    vec4 aux = texelFetch(uAux, q, 0);
    vec4 c = logD < aux.r - 0.15 ? vec4(0.0, 0.0, 0.0, 1.0) : texelFetch(uPlume, q, 0);
    float bw = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
    float dw = max(exp(-max(abs(aux.g - logD) - 0.25, 0.0) * 8.0), 1e-3);
    acc += c * (bw * dw);
    wsum += bw * dw;
  }
  vec4 p = acc / max(wsum, 1e-6);
  outColor = vec4(scene.rgb * p.a + p.rgb, scene.a);
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

/** Largest plume radiance relative to the daylight sun's: keeps every pixel far below FIREFLY_MAX exposed. */
const MAX_RADIANCE_REL = 0.5;

export class VolcanoPlumeEffect implements SceneEffect {
  readonly name = 'volcanoPlume';
  /** The bounds as of the last frame (or construction): for tests and tools. */
  readonly bounds: PlumeBounds = makePlumeBounds();
  /** Whether the last frame marched (false: the bounds were off screen and the scene was copied). */
  marched = false;

  private readonly noise: THREE.Data3DTexture;
  private readonly quad = new FullScreenQuad();
  readonly marchMat: THREE.ShaderMaterial;
  readonly compositeMat: THREE.ShaderMaterial;
  private readonly copyMat: THREE.ShaderMaterial;
  private readonly marchRT: THREE.WebGLRenderTarget;
  private atmosphere: Atmosphere | null = null;
  private width = 1;
  private height = 1;
  private frame = 0;

  private readonly invProj = new THREE.Matrix4();
  private readonly camWorld = new THREE.Matrix4();
  private readonly camPos = new THREE.Vector3();
  private readonly lowSize = new THREE.Vector2(1, 1);
  private readonly sunDir = new THREE.Vector3(0, 1, 0);
  private readonly sunTop = new THREE.Color();
  private readonly skyColor = new THREE.Color();
  private readonly hazeColor = new THREE.Color();
  private readonly haze = new THREE.Vector2(1e-5, 1200);
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();

  constructor(
    private readonly volcano: VolcanoSpec,
    private readonly weather: WeatherSettings,
  ) {
    plumeBounds(volcano, weather, this.bounds);
    this.noise = createPlumeNoise();
    const camera: Uniforms = { uInvProj: { value: this.invProj }, uCamWorld: { value: this.camWorld }, uCamPos: { value: this.camPos } };
    const b = this.bounds;
    this.marchMat = fullscreenMaterial(PLUME_MARCH_FRAG, {
      ...camera,
      uDepth: { value: null },
      uNoise: { value: this.noise },
      uAerialOn: { value: 0 },
      uAerialAtlas: { value: null },
      uAerialMax: { value: 1 },
      uHaze: { value: this.haze },
      uHazeColor: { value: this.hazeColor },
      uFrame: { value: 0 },
      uVent: { value: b.vent },
      uTop: { value: b.top },
      uLean: { value: b.lean },
      uRadii: { value: new THREE.Vector4(PLUME_VENT_R, PLUME_COLUMN_R, PLUME_UMBRELLA_R, PLUME_UMBRELLA_FROM) },
      uBoxMin: { value: b.box.min },
      uBoxMax: { value: b.box.max },
      uDensity: { value: PLUME_DENSITY },
      uSunDir: { value: this.sunDir },
      uSunTop: { value: this.sunTop },
      uSkyColor: { value: this.skyColor },
      uMaxRadiance: { value: 1e6 },
      // The era's clock and lava state, shared by reference (world/terrain/eraUniforms.ts).
      uEraTime: ERA_UNIFORMS.uEraTime,
      uLava: ERA_UNIFORMS.uLava,
    });
    this.compositeMat = fullscreenMaterial(PLUME_COMPOSITE_FRAG, {
      ...camera,
      uScene: { value: null },
      uDepth: { value: null },
      uPlume: { value: null },
      uAux: { value: null },
      uLowSize: { value: this.lowSize },
    });
    this.copyMat = fullscreenMaterial(COPY_FRAG, { uScene: { value: null } });
    this.marchRT = new THREE.WebGLRenderTarget(1, 1, {
      count: 2,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const lw = Math.max(1, Math.ceil(this.width * PLUME_SCALE));
    const lh = Math.max(1, Math.ceil(this.height * PLUME_SCALE));
    if (lw === this.lowSize.x && lh === this.lowSize.y) return;
    this.lowSize.set(lw, lh);
    this.marchRT.setSize(lw, lh);
  }

  render(renderer: THREE.WebGLRenderer, input: THREE.Texture, depth: THREE.DepthTexture, output: THREE.WebGLRenderTarget, ctx: SimContext): void {
    const prevTarget = renderer.getRenderTarget();
    const camera = ctx.camera;
    plumeBounds(this.volcano, ctx.weather ?? this.weather, this.bounds);
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProj);
    this.marched = this.frustum.intersectsBox(this.bounds.box);
    if (!this.marched) {
      this.copyMat.uniforms.uScene.value = input;
      this.draw(renderer, this.copyMat, output);
      renderer.setRenderTarget(prevTarget);
      return;
    }
    this.invProj.copy(camera.projectionMatrixInverse);
    this.camWorld.copy(camera.matrixWorld);
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    this.updateLighting(renderer, ctx);
    const m = this.marchMat.uniforms;
    m.uDepth.value = depth;
    m.uFrame.value = this.frame++ % 4096;
    m.uTop.value = this.bounds.top;
    this.draw(renderer, this.marchMat, this.marchRT);
    const c = this.compositeMat.uniforms;
    c.uScene.value = input;
    c.uDepth.value = depth;
    c.uPlume.value = this.marchRT.textures[0];
    c.uAux.value = this.marchRT.textures[1];
    this.draw(renderer, this.compositeMat, output);
    renderer.setRenderTarget(prevTarget);
  }

  dispose(): void {
    this.noise.dispose();
    this.marchRT.dispose();
    [this.marchMat, this.compositeMat, this.copyMat].forEach((m) => m.dispose());
    this.quad.dispose();
  }

  private updateLighting(renderer: THREE.WebGLRenderer, ctx: SimContext): void {
    const sky = ctx.sky;
    const a = (this.atmosphere ??= Atmosphere.for(renderer));
    const m = this.marchMat.uniforms;
    this.sunDir.copy(sky.sunDir);
    // The sun as the plume's middle sees it (it stays lit, reddened, after sunset at the ground).
    const km = (0.5 * (this.bounds.vent.y + this.bounds.top)) / 1000;
    transmittanceToSpace(a.params, km, sky.sunDir.y, this.sunTop);
    const e = a.sunIlluminance;
    this.sunTop.setRGB(this.sunTop.r * e.x, this.sunTop.g * e.y, this.sunTop.b * e.z);
    this.skyColor.copy(sky.skyColor);
    this.hazeColor.copy(sky.hazeColor);
    if (sky.hazeExtinction > 0 && sky.hazeScaleHeight > 0) this.haze.set(sky.hazeExtinction, sky.hazeScaleHeight);
    const aerial = a.aerial;
    m.uAerialOn.value = aerial ? 1 : 0;
    if (aerial) {
      m.uAerialAtlas.value = aerial.uAerialAtlas.value;
      m.uAerialMax.value = aerial.uAerialMax.value;
    }
    // Firefly guard: never brighter than a white surface under the full TOA sun (far below FIREFLY_MAX exposed).
    m.uMaxRadiance.value = (MAX_RADIANCE_REL * e.y) / Math.PI;
  }

  private draw(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }
}
