// Rain, snow, hail and cracks on the windscreen and canopy glass in the cockpit view: a post-TAA overlay
// (PostPipeline.addOverlay) that copies its input, then draws the aircraft's glazing meshes (the meshes named
// 'glazing' under ctx.aircraftRoot, render/aircraft/fuselage.ts: every fixed-wing type and every helicopter) a second
// time with a shader of its own. That shader keeps the glazing's window coverage (its alpha map, so only the windows
// draw), tests itself against the scene depth (the cabin, the panel and the airframe in front of the glass hide it),
// and draws on the glass at the glass's own position in the aircraft frame, so the drops stay on the glass when the
// head moves. Not drawn in any other camera mode.
//
// The state it draws (windscreenWater.ts: wetness, snow, the hail strike rate, the airflow share and the moving
// drops' phase) follows the precipitation at the aircraft (ctx.weatherFx.precip; at the camera on pages without it)
// and the true airspeed. Layers, each on a hashed grid on the glass (pcg4d, Jarzynski and Olano 2020), at most one
// cell read per layer:
//   beads      two grids (5 and 11 mm) in a frame fixed to the glass (up the glass and across it): drops that sit,
//              each living DROP_LIFE_S then replaced; blown off as the airflow share rises
//   runners    a grid of 8 x RUN_CELL_M mm cells along the drops' motion on the glass (gravity parked, the airflow at
//              speed) scrolled by the phase: parked, drops sliding down with a thin wet trail; at speed, streaks
//              stretched over 1/60 s of their motion
//   snow       7 mm cells in the glass frame: white flakes living SNOW_LIFE_S that turn to water drops as they melt
//   hail       40 mm cells: a white star-shaped splash for HAIL_SPLASH_S at the strike rate
//   cracks     the windscreen cracks of the hail damage (ctx.weatherFx.damage): each a radial star with arcs and a
//              crushed white centre, placed where the crack's direction from the pilot's eye meets the glass (a ray
//              cast once per crack); above SHATTER_LEVEL the glass about the cracks is crazed (a Voronoi network)
//              and whitened over a radius that grows to CRAZE_MAX_M
// A drop refracts the scene: it shows the view from its centre outward by DROP_REFRACT times the pixel's offset,
// so the outside appears inverted and smaller in each drop, darker at its rim (DROP_RIM) with a highlight of the
// sky toward the top of the glass. Snow, splashes and cracks are lit by the sky ambient and the direct sun
// (Atmosphere.cloudSky.directGround), as the precipitation streaks are.
// Cost per frame while active (stated, not measured on a GPU): one full-screen copy and one draw of the glazing
// meshes (the window pixels only). Per window pixel: 2 depth and alpha-map reads, 5 hashes (beads x2, runners, snow,
// hail), up to 12 crack loops, 9 hashes in a crazed area, 1 scene read per drop plus 4 for a wet film. With no
// precipitation on the glass and no cracks, or outside the cockpit view, active() is false and PostPipeline skips it:
// the frame is the same as without the overlay.
// Every constant is unconfirmed: look values set by eye.

import * as THREE from 'three';
import type { SceneEffect, SimContext } from '../../core/context';
import { DEPTH_GLSL } from '../../core/shaderLib';
import { emptyLocalPrecip, localPrecipAt, type LocalPrecip } from '../../physics/weather/stormPrecip';
import { MAX_CRACKS, SHATTER_LEVEL, type HailDamageState } from '../../sim/weather/hailDamage';
import { Atmosphere } from '../sky/Atmosphere';
import { FullscreenPass, passMaterial } from '../post/FullscreenPass';
import { cameraStormsAt, cameraStormsOf } from './stormSelection';
import { stormOverheadTau } from './stormShade';
import { HAIL_SPLASH_S, RUN_CELL_M, WindscreenWater } from './windscreenWater';
import type { WeatherEffectContext } from './index';

/** Life of a sitting drop before its site is drawn again, s. */
export const DROP_LIFE_S = 22;
/** Life of a flake on the glass, s (the last 40 % of it melting to water). */
export const SNOW_LIFE_S = 6;
/** How far beyond its centre a drop shows the scene, in multiples of the pixel's offset from the centre. */
export const DROP_REFRACT = 7;
/** Darkening at a drop's rim, share. */
export const DROP_RIM = 0.35;
/** A hail splash's radiance over that of the scene behind the glass, at least the sky-lit white. Unconfirmed. */
export const SPLASH_OVER_SCENE = 2;
/** Largest radius of the crazed area, m. */
export const CRAZE_MAX_M = 0.35;
/** Seconds between searches of the aircraft for its glazing while none is found. */
const GLASS_SEARCH_S = 1;

const GLASS_VERT = /* glsl */ `
uniform mat4 uGlassToRoot;
varying vec3 vRoot;
varying vec2 vUv;
varying float vViewZ;
void main() {
  vUv = uv;
  vRoot = (uGlassToRoot * vec4(position, 1.0)).xyz;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const GLASS_FRAG = /* glsl */ `
${DEPTH_GLSL}
uniform sampler2D uScene;
uniform sampler2D uDepth;
uniform sampler2D uAlphaMap;
uniform vec2 uResolution;
uniform float uPixelAngle;
uniform vec3 uEye;            // camera, aircraft-root frame (x right, y up, z aft)
uniform vec3 uOrigin;         // fixed point of the glass frame (the glazing's bounding-box centre)
uniform vec3 uGravity;        // unit, root frame
uniform vec3 uAirflow;        // unit air velocity relative to the aircraft, root frame
uniform mat4 uRootToClip;
uniform float uAirShare;
uniform float uWet;
uniform float uSnow;
uniform float uHailRate;      // strikes per m^2 and s
uniform float uHailSize;      // splash radius, m
uniform float uTime;
uniform float uRunPhase;
uniform float uRunStretch;    // streak half-length added by the motion, m
uniform vec3 uAmbient;
uniform vec3 uSun;
uniform int uCracks;
uniform vec4 uCrackA[${MAX_CRACKS}];  // centre (root frame), radius m
uniform vec4 uCrackB[${MAX_CRACKS}];  // seed, size, unused, unused
uniform float uCrackLevel;
uniform vec4 uCraze;                  // centre (root frame), radius m
varying vec3 vRoot;
varying vec2 vUv;
varying float vViewZ;

const float TAU = 6.28318531;

uvec4 pcg4d(uvec4 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v ^= v >> 16u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  return v;
}
vec4 hash4(ivec2 c, uint layer, uint k) {
  return vec4(pcg4d(uvec4(uvec2(c + 32768), layer, k)) >> 16u) * (1.0 / 65536.0);
}

// A drop found on the glass: coverage, offset of the pixel from its centre (glass-plane metres, root frame) and
// its radius.
float dropCover = 0.0;
vec3 dropOff = vec3(0.0);
float dropR = 1.0;
void takeDrop(float cover, vec3 off, float r) {
  if (cover > dropCover) { dropCover = cover; dropOff = off; dropR = r; }
}

// Sitting drops on a grid of cell size s (m) in the glass frame (bx, by).
void beads(vec2 q, vec3 bx, vec3 by, float s, uint layer, float density, float pxM) {
  vec2 g = q / s;
  ivec2 c = ivec2(floor(g));
  vec2 f = fract(g);
  vec4 h = hash4(c, layer, 0u);
  float life = ${DROP_LIFE_S.toFixed(1)} * (0.6 + 0.8 * h.w);
  float cyc = uTime / life + h.z;
  vec4 e = hash4(c, layer, uint(int(floor(cyc)) & 1023));
  float age = fract(cyc);
  if (e.x >= density) return;
  float r = s * (0.12 + 0.3 * e.y * e.y);
  vec2 ctr = vec2(0.5) + (e.zw - 0.5) * (1.0 - 2.0 * r / s - 0.05);
  vec2 d = (f - ctr) * s;
  float dist = length(d);
  float fade = smoothstep(0.0, 0.02, age) * (1.0 - smoothstep(0.85, 1.0, age));
  float cover = clamp((r - dist) * pxM + 0.5, 0.0, 1.0) * fade;
  takeDrop(cover, d.x * bx + d.y * by, r);
}

// Bright crack line: anti-aliased coverage of a line at distance dM (m) with width wPx (px).
float lineAA(float dM, float wPx, float pxM) {
  return clamp(0.5 * wPx + 0.5 - dM * pxM, 0.0, 1.0);
}

void main() {
  // The glass normal from the position's derivatives, before any fragment of the quad is discarded (derivatives
  // are undefined after a discard).
  vec3 P = vRoot;
  vec3 N = normalize(cross(dFdx(P), dFdy(P)));
  if (texture2D(uAlphaMap, vUv).g < 0.5) discard;
  vec2 suv = gl_FragCoord.xy / uResolution;
  float sd = texture2D(uDepth, suv).r;
  float sceneZ = isSky(sd) ? 1e9 : viewZFromDepth(sd);
  if (sceneZ < vViewZ - 0.01) discard;
  if (dot(N, uEye - P) < 0.0) N = -N;
  // Pixels per metre on the glass at this distance.
  float pxM = 1.0 / max(vViewZ * uPixelAngle, 1e-6);
  // The glass frame: up the glass (or forward where the glass faces up) and across it.
  vec3 up = vec3(0.0, 1.0, 0.0) - N.y * N;
  if (dot(up, up) < 0.04) up = vec3(0.0, 0.0, -1.0) - N.z * N;
  vec3 gy = normalize(up);
  vec3 gx = cross(N, gy);
  vec3 rel = P - uOrigin;
  vec2 q = vec2(dot(rel, gx), dot(rel, gy));
  // The drops' motion on the glass: down under gravity, along the airflow at speed.
  vec3 gv = uGravity - dot(uGravity, N) * N;
  vec3 av = uAirflow - dot(uAirflow, N) * N;
  vec3 mv = mix(normalize(gv + 1e-5 * gy), normalize(av + 1e-5 * gy), uAirShare);
  vec3 my = normalize(mv + 1e-5 * gy);
  vec3 mx = cross(N, my);
  vec2 qm = vec2(dot(rel, mx), dot(rel, my));

  vec4 scene = texture2D(uScene, suv);
  vec3 col = scene.rgb;

  if (uWet > 0.0) {
    float still = 1.0 - uAirShare;
    beads(q, gx, gy, 0.005, 1u, uWet * 0.55 * still, pxM);
    beads(q + 0.37, gx, gy, 0.011, 2u, uWet * 0.3 * still, pxM);
    // Running drops.
    float cw = 0.008;
    float cl = ${RUN_CELL_M.toFixed(4)};
    float colIx = floor(qm.x / cw);
    vec4 hc = hash4(ivec2(int(colIx), 7), 3u, 0u);
    float gyRun = (qm.y - uRunPhase) / cl + hc.x;
    ivec2 c = ivec2(int(colIx), int(floor(gyRun)) & 255);
    vec4 e = hash4(c, 3u, 1u);
    float dens = uWet * mix(0.18, 0.7, uAirShare);
    if (e.x < dens) {
      float r = cw * (0.1 + 0.18 * e.y);
      float hl = min(0.4 * cl, r + uRunStretch);
      vec2 f = vec2(fract(qm.x / cw), fract(gyRun));
      vec2 ctr = vec2(0.5 + (e.z - 0.5) * (1.0 - 2.0 * r / cw - 0.05), 0.5 + (e.w - 0.5) * (1.0 - 2.0 * hl / cl - 0.05));
      vec2 d = vec2((f.x - ctr.x) * cw, (f.y - ctr.y) * cl);
      // A capsule along the motion: the drop and its streak.
      float along = d.y - clamp(d.y, -(hl - r), hl - r);
      float dist = length(vec2(d.x, along));
      float cover = clamp((r - dist) * pxM + 0.5, 0.0, 1.0);
      takeDrop(cover, d.x * mx + along * my, r);
      // The wet trail behind a sliding drop (parked: the trail up the glass the drop came down).
      if (uAirShare < 0.5) {
        float tl = (0.45 - e.w * 0.25) * cl;
        float behind = -d.y;
        float tw = 0.3 * r;
        float trail = step(0.0, behind) * (1.0 - smoothstep(0.6 * tl, tl, behind)) * clamp((tw - abs(d.x)) * pxM + 0.5, 0.0, 1.0);
        takeDrop(0.35 * trail * (1.0 - 2.0 * uAirShare), vec3(d.x * mx) * 3.0, tw * 3.0);
      }
    }
  }

  vec3 lit = uAmbient + uSun;
  float white = 0.0;
  // Ice is brighter than what lies behind the glass under the same light: at least SPLASH_OVER_SCENE times it.
  vec3 whiteCol = lit;
  vec3 iceCol = max(lit, ${SPLASH_OVER_SCENE.toFixed(2)} * scene.rgb);
  float ice = 0.0;

  if (uSnow > 0.0) {
    float s = 0.007;
    vec2 g = q / s;
    ivec2 c = ivec2(floor(g));
    vec2 f = fract(g);
    vec4 h = hash4(c, 4u, 0u);
    float life = ${SNOW_LIFE_S.toFixed(1)} * mix(1.0, 0.3, uAirShare) * (0.6 + 0.8 * h.w);
    float cyc = uTime / life + h.z;
    vec4 e = hash4(c, 4u, uint(int(floor(cyc)) & 1023) + 9u);
    float age = fract(cyc);
    if (e.x < uSnow * 0.6 * (1.0 - 0.6 * uAirShare)) {
      float r = s * (0.18 + 0.22 * e.y);
      vec2 ctr = vec2(0.5) + (e.zw - 0.5) * (1.0 - 2.0 * r / s - 0.05);
      vec2 d = (f - ctr) * s;
      // A ragged flake outline that shrinks as it melts.
      float ang = atan(d.y, d.x);
      float rag = 1.0 + 0.25 * sin(6.0 * ang + TAU * e.z) * sin(3.0 * ang + TAU * e.w);
      float melt = smoothstep(0.6, 1.0, age);
      float rf = r * rag * (1.0 - 0.5 * melt);
      float flake = clamp((rf - length(d)) * pxM + 0.5, 0.0, 1.0) * smoothstep(0.0, 0.03, age);
      white = max(white, flake * 0.85 * (1.0 - melt));
      // The melt water stays as a drop.
      takeDrop(clamp((r * 0.6 - length(d)) * pxM + 0.5, 0.0, 1.0) * melt * (1.0 - smoothstep(0.95, 1.0, age)), d.x * gx + d.y * gy, r * 0.6);
    }
  }

  if (uHailRate > 0.0) {
    float s = 0.04;
    vec2 g = q / s;
    ivec2 c = ivec2(floor(g));
    vec2 f = fract(g);
    vec4 h = hash4(c, 5u, 0u);
    float cyc = uTime / ${HAIL_SPLASH_S.toFixed(3)} + h.z;
    vec4 e = hash4(c, 5u, uint(int(floor(cyc)) & 4095) + 3u);
    float age = fract(cyc);
    float p = 1.0 - exp(-uHailRate * s * s * ${HAIL_SPLASH_S.toFixed(3)});
    if (e.x < p) {
      float r = uHailSize * (0.6 + 0.8 * e.y);
      vec2 ctr = vec2(0.5) + (e.zw - 0.5) * (1.0 - 2.0 * min(r / s, 0.45));
      vec2 d = (f - ctr) * s;
      float dist = length(d);
      float ang = atan(d.y, d.x);
      float rays = 7.0 + floor(5.0 * h.y);
      float spike = pow(abs(cos(0.5 * rays * ang + TAU * h.x)), 6.0);
      float reach = r * (0.35 + 0.65 * spike) * (0.5 + 0.5 * smoothstep(0.0, 0.3, age));
      float sp = clamp((reach - dist) * pxM + 0.5, 0.0, 1.0) * (1.0 - smoothstep(0.3, 1.0, age));
      ice = max(ice, sp * 0.9);
    }
  }

  // Cracks.
  float crack = 0.0;
  float milk = 0.0;
  for (int k = 0; k < ${MAX_CRACKS}; k++) {
    if (k >= uCracks) break;
    vec4 A = uCrackA[k];
    vec4 B = uCrackB[k];
    vec3 d3 = P - A.xyz;
    d3 -= dot(d3, N) * N;
    float rho = length(d3);
    float R = A.w;
    if (rho > R) continue;
    float ang = atan(dot(d3, gx), dot(d3, gy));
    float n = 7.0 + floor(8.0 * B.x);
    // Radial cracks: the nearest of n rays (jittered angles, wiggling with the radius), each of its own length.
    float sector = (ang / TAU + 0.5) * n;
    float si = floor(sector);
    vec4 hr = hash4(ivec2(int(si), k), 6u, uint(B.x * 65535.0));
    float wig = 0.08 * sin(rho * 180.0 + TAU * hr.y) + 0.05 * sin(rho * 470.0 + TAU * hr.z);
    float rayAng = (si + 0.5 + 0.6 * (hr.x - 0.5) + wig - (ang / TAU + 0.5) * n) * (TAU / n);
    float len = R * (0.45 + 0.55 * hr.w);
    float ray = lineAA(abs(rayAng) * rho, 1.0, pxM) * (1.0 - smoothstep(0.7 * len, len, rho));
    // Arcs between the rays at two radii.
    float arc = 0.0;
    for (int j = 0; j < 2; j++) {
      float rr = R * (0.22 + 0.25 * float(j) + 0.1 * hr.y);
      float on = step(0.45, fract(hr.z * 7.0 + float(j) * 0.37));
      arc = max(arc, on * lineAA(abs(rho - rr), 1.0, pxM));
    }
    // The crushed centre.
    float core = 1.0 - smoothstep(0.05 * R, 0.12 * R, rho);
    crack = max(crack, max(max(ray, arc * 0.8), core));
    milk = max(milk, (0.12 + 0.3 * uCrackLevel) * exp(-3.0 * rho / R));
  }
  if (uCraze.w > 0.0) {
    vec3 d3 = P - uCraze.xyz;
    d3 -= dot(d3, N) * N;
    float rho = length(d3);
    if (rho < uCraze.w) {
      // Voronoi cell edges of a 12 mm net: the distance between the nearest two feature points.
      vec2 g = q / 0.012;
      ivec2 c = ivec2(floor(g));
      vec2 f = fract(g);
      float d1 = 8.0, d2 = 8.0;
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          vec2 o = vec2(float(i), float(j));
          vec2 pnt = o + hash4(c + ivec2(i, j), 7u, 0u).xy;
          float dd = length(f - pnt);
          if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
        }
      }
      float edge = lineAA(0.5 * (d2 - d1) * 0.012, 1.0, pxM);
      float inside = 1.0 - smoothstep(0.7 * uCraze.w, uCraze.w, rho);
      crack = max(crack, edge * inside);
      milk = max(milk, 0.45 * inside);
    }
  }

  if (dropCover > 0.0) {
    // The scene through the drop: from its centre outward, inverted.
    vec3 ref = -${DROP_REFRACT.toFixed(1)} * dropOff;
    vec4 c0 = uRootToClip * vec4(P, 1.0);
    vec4 c1 = uRootToClip * vec4(P + ref, 1.0);
    vec2 uv1 = clamp(suv + 0.5 * (c1.xy / c1.w - c0.xy / c0.w), vec2(0.001), vec2(0.999));
    vec3 through = texture2D(uScene, uv1).rgb;
    float rr = clamp(length(dropOff) / max(dropR, 1e-5), 0.0, 1.0);
    float rim = smoothstep(0.55, 1.0, rr);
    vec3 dropCol = through * (0.9 - ${DROP_RIM.toFixed(2)} * rim);
    // Highlight of the sky on the drop's upper side.
    float hl = smoothstep(0.35, 0.75, rr) * (1.0 - smoothstep(0.75, 0.95, rr)) * smoothstep(0.2, 0.9, dot(normalize(dropOff + 1e-6 * gy), gy));
    dropCol += uAmbient * 0.35 * hl;
    col = mix(col, dropCol, dropCover);
  }
  // A thin water film blurs the view at speed in rain.
  float film = uWet * uAirShare * 0.35;
  if (film > 0.0) {
    vec2 px = 2.0 / uResolution;
    vec3 blur = 0.25 * (texture2D(uScene, suv + vec2(px.x, 0.0)).rgb + texture2D(uScene, suv - vec2(px.x, 0.0)).rgb +
                        texture2D(uScene, suv + vec2(0.0, px.y)).rgb + texture2D(uScene, suv - vec2(0.0, px.y)).rgb);
    col = mix(col, blur, film);
  }
  col = mix(col, lit * 0.8, milk);
  col = mix(col, lit * 1.1, crack * 0.85);
  col = mix(col, whiteCol, white);
  col = mix(col, iceCol, ice);
  gl_FragColor = vec4(col, scene.a);
}
`;

const COPY_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uScene;
void main() { gl_FragColor = texture2D(uScene, vUv); }
`;

/** A glazing mesh of the aircraft and the copy the overlay draws. */
interface GlassProxy {
  source: THREE.Mesh;
  proxy: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

export class WindscreenOverlay implements SceneEffect {
  readonly name = 'windscreen';
  /** Whether the last frame drew the glass (false: it copied its input or was skipped). For tests and tools. */
  drawn = false;
  readonly water = new WindscreenWater();
  /** The precipitation at the glass this frame. */
  readonly local: LocalPrecip = emptyLocalPrecip();
  private readonly copyMat: THREE.ShaderMaterial;
  private readonly pass = new FullscreenPass();
  private readonly scene = new THREE.Scene();
  private readonly glass: GlassProxy[] = [];
  private searchedAt = -Infinity;
  private searchedRoot: THREE.Object3D | null = null;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private atmosphere: Atmosphere | null = null;
  private width = 1;
  private height = 1;
  private lastSimTime = Number.NaN;
  private warm: THREE.WebGLRenderTarget | null = null;
  private readonly warmMesh: THREE.Mesh;
  private readonly warmCamera = new THREE.PerspectiveCamera();
  private readonly rootInv = new THREE.Matrix4();
  private readonly eye = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private readonly gravity = new THREE.Vector3();
  private readonly airflow = new THREE.Vector3();
  private readonly rootToClip = new THREE.Matrix4();
  private readonly crackA = Array.from({ length: MAX_CRACKS }, () => new THREE.Vector4());
  private readonly crackB = Array.from({ length: MAX_CRACKS }, () => new THREE.Vector4());
  private readonly craze = new THREE.Vector4();
  private readonly ambient = new THREE.Vector3();
  private readonly sun = new THREE.Vector3();
  private readonly resolution = new THREE.Vector2(1, 1);
  /** Cracks placed on the glass so far (their centres are in crackA). */
  private placed = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly tmp = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly hits: THREE.Intersection[] = [];

  constructor(_c: WeatherEffectContext | null = null) {
    this.uniforms = {
      uScene: { value: null },
      uDepth: { value: null },
      uResolution: { value: this.resolution },
      uPixelAngle: { value: 1e-3 },
      uEye: { value: this.eye },
      uOrigin: { value: this.origin },
      uGravity: { value: this.gravity },
      uAirflow: { value: this.airflow },
      uRootToClip: { value: this.rootToClip },
      uAirShare: { value: 0 },
      uWet: { value: 0 },
      uSnow: { value: 0 },
      uHailRate: { value: 0 },
      uHailSize: { value: 0.01 },
      uTime: { value: 0 },
      uRunPhase: { value: 0 },
      uRunStretch: { value: 0 },
      uAmbient: { value: this.ambient },
      uSun: { value: this.sun },
      uCracks: { value: 0 },
      uCrackA: { value: this.crackA },
      uCrackB: { value: this.crackB },
      uCrackLevel: { value: 0 },
      uCraze: { value: this.craze },
    };
    this.copyMat = passMaterial({ fragmentShader: COPY_FRAG, uniforms: { uScene: { value: null } } });
    this.scene.matrixWorldAutoUpdate = false;
    // A one-triangle stand-in for the shader warm-up when the aircraft's glazing is not built yet.
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, -2, 3, -1, -2, -1, 3, -2], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    this.warmMesh = new THREE.Mesh(tri, this.makeMaterial(null));
    this.warmMesh.frustumCulled = false;
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.resolution.set(this.width, this.height);
  }

  /** Advances the glass's water every frame; true in the cockpit view while anything is on the glass. */
  active(ctx: SimContext): boolean {
    this.advance(ctx);
    if (!this.warm) return true;
    const on = this.wanted(ctx);
    if (!on) this.drawn = false;
    return on;
  }

  render(renderer: THREE.WebGLRenderer, input: THREE.Texture, depth: THREE.DepthTexture, output: THREE.WebGLRenderTarget, ctx: SimContext, _dt: number): void {
    const prevTarget = renderer.getRenderTarget();
    this.copyMat.uniforms.uScene.value = input;
    this.pass.render(renderer, this.copyMat, output);
    this.uniforms.uScene.value = input;
    this.uniforms.uDepth.value = depth;
    if (!this.warm) {
      // Compile the glass shader on the first frame (a triangle into a 1x1 target).
      this.warm = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
      renderer.setRenderTarget(this.warm);
      renderer.render(this.warmMesh, this.warmCamera);
    }
    this.drawn = this.wanted(ctx);
    if (this.drawn) {
      this.prepare(renderer, ctx);
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(output);
      renderer.render(this.scene, ctx.camera);
      renderer.autoClear = autoClear;
    }
    renderer.setRenderTarget(prevTarget);
  }

  dispose(): void {
    this.copyMat.dispose();
    for (const g of this.glass) g.material.dispose();
    (this.warmMesh.material as THREE.Material).dispose();
    this.warmMesh.geometry.dispose();
    this.warm?.dispose();
  }

  /** Something to draw: the cockpit view, glazing found, and water, snow, hail or cracks on it. */
  private wanted(ctx: SimContext): boolean {
    if (ctx.cameraMode !== 'cockpit') return false;
    const dmg = ctx.weatherFx?.damage;
    if (this.water.dry && !(dmg && (dmg.crackCount > 0 || dmg.windscreen > 0))) return false;
    return this.findGlass(ctx) > 0;
  }

  /** The water state, from the precipitation at the aircraft and the simulation time that passed. */
  private advance(ctx: SimContext): void {
    const t = ctx.simTime;
    const dt = Number.isFinite(this.lastSimTime) && t >= this.lastSimTime ? Math.min(0.25, t - this.lastSimTime) : 0;
    // A scenario reset restarts the clock: a dry glass.
    if (Number.isFinite(this.lastSimTime) && t < this.lastSimTime) this.water.reset();
    this.lastSimTime = t;
    const p = ctx.weatherFx?.precip ?? this.sampleAtCamera(ctx);
    const tas = ctx.state?.tas ?? 0;
    this.water.update({ type: p.type, rateMmH: p.rateMmH, hailMmH: p.hailMmH, hailMaxMm: p.hailMaxMm, tasMs: Number.isFinite(tas) ? tas : 0 }, dt);
  }

  private sampleAtCamera(ctx: SimContext): LocalPrecip {
    const c = ctx.camera?.position;
    const cells = cameraStormsAt(ctx);
    const cape = cells.length > 0 ? cameraStormsOf(ctx).field.convective(ctx.weather).capeJkg : 0;
    return localPrecipAt(ctx.weather, cells, ctx.simTime, cape, c ? -c.z : 0, c ? c.x : 0, c ? c.y : 0, this.local);
  }

  private makeMaterial(alphaMap: THREE.Texture | null): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: GLASS_VERT,
      fragmentShader: GLASS_FRAG,
      uniforms: { ...this.uniforms, uAlphaMap: { value: alphaMap ?? WHITE }, uGlassToRoot: { value: new THREE.Matrix4() } },
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      transparent: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
  }

  /** The glazing meshes under ctx.aircraftRoot (searched again once per GLASS_SEARCH_S while none is found). */
  private findGlass(ctx: SimContext): number {
    const root = ctx.aircraftRoot;
    if (!root) return 0;
    if (this.searchedRoot !== root) this.clearGlass();
    if (this.glass.length > 0) {
      // A visual replaced since (another airframe): search again. A hidden airframe (the fixed panel) draws nothing.
      let shown = 0;
      for (const g of this.glass) {
        const v = shownUnder(g.source, root);
        if (v < 0) {
          this.clearGlass();
          return 0;
        }
        g.proxy.visible = v > 0;
        shown += v;
      }
      return shown;
    }
    const now = performance.now() / 1000;
    if (now - this.searchedAt < GLASS_SEARCH_S && this.searchedRoot === root) return 0;
    this.searchedAt = now;
    this.searchedRoot = root;
    const box = new THREE.Box3();
    root.updateMatrixWorld();
    const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    root.traverse((o) => {
      if (o.name !== 'glazing' || !(o as THREE.Mesh).isMesh) return;
      const mesh = o as THREE.Mesh;
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const alphaMap = (mat as THREE.MeshStandardMaterial).alphaMap ?? null;
      const material = this.makeMaterial(alphaMap);
      const proxy = new THREE.Mesh(mesh.geometry, material);
      proxy.matrixAutoUpdate = false;
      proxy.frustumCulled = false;
      this.scene.add(proxy);
      this.glass.push({ source: mesh, proxy, material });
      mesh.geometry.computeBoundingBox();
      const b = mesh.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInv, mesh.matrixWorld));
      box.union(b);
    });
    if (this.glass.length > 0) box.getCenter(this.origin);
    this.placed = 0;
    return this.glass.length;
  }

  private clearGlass(): void {
    for (const g of this.glass) {
      this.scene.remove(g.proxy);
      g.material.dispose();
    }
    this.glass.length = 0;
    this.placed = 0;
  }

  /** Per-frame uniforms: frames, motion, light, cracks. */
  private prepare(renderer: THREE.WebGLRenderer, ctx: SimContext): void {
    const root = ctx.aircraftRoot;
    const cam = ctx.camera;
    const u = this.uniforms;
    const w = this.water;
    this.rootInv.copy(root.matrixWorld).invert();
    this.eye.setFromMatrixPosition(cam.matrixWorld).applyMatrix4(this.rootInv);
    for (const g of this.glass) {
      g.proxy.matrixWorld.copy(g.source.matrixWorld);
      (g.material.uniforms.uGlassToRoot.value as THREE.Matrix4).multiplyMatrices(this.rootInv, g.source.matrixWorld);
    }
    // Gravity in the root frame (three world y down), the relative air from the angle of attack and sideslip
    // (FRD air velocity -(cos a cos b, sin b, sin a cos b) in the model frame x right, y up, z aft).
    this.gravity.set(0, -1, 0).transformDirection(this.rootInv);
    const s = ctx.state;
    const a = s?.alpha ?? 0, b = s?.beta ?? 0;
    this.airflow.set(-Math.sin(b), Math.sin(a) * Math.cos(b), Math.cos(a) * Math.cos(b)).normalize();
    this.rootToClip.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).multiply(root.matrixWorld);
    u.uPixelAngle.value = 2 / (cam.projectionMatrix.elements[5] * this.height);
    u.uAirShare.value = w.airShare;
    u.uWet.value = w.wetness;
    u.uSnow.value = w.snow;
    u.uHailRate.value = w.hailPerM2s;
    const p = ctx.weatherFx?.precip ?? this.local;
    u.uHailSize.value = Math.max(0.004, 0.0006 * Math.max(p.hailMaxMm, 5));
    u.uTime.value = w.time;
    u.uRunPhase.value = w.runPhaseM;
    u.uRunStretch.value = 0.5 * w.runSpeedMs * w.airShare / 60;
    this.updateLight(renderer, ctx);
    this.updateCracks(ctx.weatherFx?.damage, root);
  }

  private updateLight(renderer: THREE.WebGLRenderer, ctx: SimContext): void {
    const sky = ctx.sky;
    const atm = (this.atmosphere ??= Atmosphere.for(renderer));
    const mu0 = Math.max(0, sky.sunDir.y);
    const overhead = stormOverheadTau(ctx);
    const stormSun = overhead > 0 ? Math.exp(-overhead / Math.max(mu0, 0.1)) : 1;
    const sun = mu0 * atm.cloudSky.directGround * stormSun * 0.2;
    this.ambient.set(sky.skyColor.r * 0.7, sky.skyColor.g * 0.7, sky.skyColor.b * 0.7);
    this.sun.set(sky.sunColor.r * sun, sky.sunColor.g * sun, sky.sunColor.b * sun);
  }

  /** Place the cracks not yet placed (a ray from the eye along each crack's direction), and the crazed area. */
  private updateCracks(d: HailDamageState | undefined, root: THREE.Object3D): void {
    const u = this.uniforms;
    const n = d ? d.crackCount : 0;
    if (n < this.placed) this.placed = 0;
    for (let i = this.placed; i < n; i++) {
      const c = d!.cracks[i];
      // Direction from FRD (cos el cos az, cos el sin az, -sin el) to the model frame (x right, y up, z aft).
      this.tmpDir.set(Math.cos(c.el) * Math.sin(c.az), Math.sin(c.el), -Math.cos(c.el) * Math.cos(c.az));
      const radius = 0.05 + 0.13 * c.size;
      this.crackA[i].set(this.eye.x + 0.8 * this.tmpDir.x, this.eye.y + 0.8 * this.tmpDir.y, this.eye.z + 0.8 * this.tmpDir.z, radius);
      this.tmp.copy(this.eye).applyMatrix4(root.matrixWorld);
      this.raycaster.set(this.tmp, this.tmpDir.clone().transformDirection(root.matrixWorld));
      this.hits.length = 0;
      for (const g of this.glass) g.source.raycast(this.raycaster, this.hits);
      let best = Infinity;
      for (const h of this.hits) {
        if (h.distance > 0.1 && h.distance < best) {
          best = h.distance;
          this.tmp.copy(h.point).applyMatrix4(this.rootInv);
          this.crackA[i].set(this.tmp.x, this.tmp.y, this.tmp.z, radius);
        }
      }
      this.crackB[i].set(c.seed, c.size, 0, 0);
    }
    this.placed = n;
    u.uCracks.value = n;
    const level = d ? d.windscreen : 0;
    u.uCrackLevel.value = level;
    // Crazed glass above SHATTER_LEVEL, centred on the first crack.
    if (n > 0 && level > SHATTER_LEVEL) {
      const r = CRAZE_MAX_M * Math.min(1, (level - SHATTER_LEVEL) / (1 - SHATTER_LEVEL) + 0.25);
      const a = this.crackA[0];
      this.craze.set(a.x, a.y, a.z, r);
    } else this.craze.set(0, 0, 0, 0);
  }
}

/** A 1x1 white texture: full coverage for the warm-up triangle. */
const WHITE = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

/** 1 when `o` lies under `root` and every object from it to the root is visible, 0 when hidden, -1 when not under it. */
function shownUnder(o: THREE.Object3D, root: THREE.Object3D): number {
  let visible = 1;
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    if (!p.visible) visible = 0;
    if (p === root) return visible;
  }
  return -1;
}

/** The windscreen overlay. Always created (rain can start at any time); skipped while the glass is dry. */
export function createWindscreenOverlay(c: WeatherEffectContext): SceneEffect | null {
  return new WindscreenOverlay(c);
}
