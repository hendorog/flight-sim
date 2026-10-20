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
//              each living DROP_LIFE_S then replaced; blown off as the airflow share rises, except in the
//              aerodynamic shadow (the window ending, as for the slush, within SHADOW_SILL_M below the pixel or
//              SHADOW_POST_M to either side: the sill and the posts); at speed a sparse layer of small beads (4 mm grid, density
//              BEAD_FLYING_SHARE) stays on all of the glass
//   runners    a grid of 8 x RUN_CELL_M mm cells along the drops' motion on the glass (gravity parked, the airflow at
//              speed) scrolled by the phase: drops sliding down with a thin wet trail, fewer as the airflow share rises
//   streams    at speed: rivulets in columns of STREAM_COL_M across the motion, one in a column's cell of RUN_WRAP_M / 9
//              along it with a chance of STREAM_SHARE x wetness x airflow share: a line of STREAM_WIDTH_M (half that
//              at its tail end) 0.1 to 0.4 m long, wandering sideways by 6 and 2 mm over 16 and 5 cm of the glass
//              (the path fixed on the glass, the stream scrolled along it by the phase), with a 2 mm bead at its head;
//              drawn as a drop (refracting) and darkened to STREAM_DARK of the scene plus STREAM_SKY of the sky light.
//              The motion at speed is the airflow on the glass plus STREAM_OUTWARD times the direction away from the
//              glazing's centre line on glass facing the airflow, so on a raked windscreen the streams run up and
//              out toward the side posts
//   snow       7 mm cells in the glass frame: white flakes living SNOW_LIFE_S that turn to water drops as they melt
//   slush      white along the sill: where the window ends (its coverage in the alpha map ends, or the scene depth
//              shows the coaming, a post or the cabin in front of the glass) within 15 to 35 mm (hashed per 12 mm)
//              times the slush level below the pixel, found through the screen derivatives of the glass position and
//              the texture coordinates
//   hail       40 mm cells along the drops' motion, (1 + 3 airShare) times longer along it: one strike per cell and
//              cycle of HAIL_WET_S (0.35 of it at speed) at the strike rate of the pixel (the fall part weighted by
//              how far the glass faces up, the airspeed part by how far it faces the airflow): a white star-shaped
//              splash for HAIL_SPLASH_S, stretched downstream by the same factor, then a wet spot (a drop) fading
//              out over the cycle
//   cracks     the windscreen cracks of the hail damage (ctx.weatherFx.damage), placed where the crack's direction
//              from the pilot's eye meets the glass (a ray cast once per crack), in cast acrylic: 4 to 8 radial
//              cracks of unequal lengths, a crushed centre of CRACK_CORE_M (3 to 6 mm) and a stress-whitened zone a
//              few mm across; a crack larger than RUNNER_SIZE also sends 1 to 3 runners (wandering 1 px lines of 0.3
//              to 0.8 m, which reach the frame where it is near) and one larger than HOLE_SIZE is a ragged hole
//              (the scene behind it read without drops or film) with a white chipped rim and 4 short rays. Above
//              SHATTER_LEVEL every crack is drawn larger, so more of them have runners and holes. Laminated glass
//              (GlazingDef.laminated, the PC-12 only) also gets two broken arcs between the radial cracks
// A drop refracts the scene: it shows the view from its centre outward by DROP_REFRACT times the pixel's offset,
// so the outside appears inverted and smaller in each drop, darker at its rim (DROP_RIM) with a highlight of the
// sky toward the top of the glass; over the sky its centre is darkened by up to DROP_SKY_DARK. Snow, splashes and cracks are lit by the sky ambient and the direct sun
// (Atmosphere.cloudSky.directGround), as the precipitation streaks are.
// Cost per frame while active (stated, not measured on a GPU): one full-screen copy and one draw of the glazing
// meshes (the window pixels only). Per window pixel: 2 depth and alpha-map reads, 5 hashes (beads x2, runners, snow,
// hail), up to 12 crack loops of 1 hash (and up to 3 runners each), 1 scene read per drop plus 4 for a wet film. With no
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
import { HAIL_SPLASH_S, HAIL_WET_S, RUN_CELL_M, RUN_WRAP_M, WindscreenWater, type GlassWeather } from './windscreenWater';
import type { WeatherEffectContext } from './index';

/** Life of a sitting drop before its site is drawn again, s. */
export const DROP_LIFE_S = 22;
/** Life of a flake on the glass, s (the last 40 % of it melting to water). */
export const SNOW_LIFE_S = 6;
/** How far beyond its centre a drop shows the scene, in multiples of the pixel's offset from the centre. */
export const DROP_REFRACT = 7;
/** Darkening at a drop's rim, share. */
export const DROP_RIM = 0.35;
/** Darkening at the centre of a drop seen against the sky, share. */
export const DROP_SKY_DARK = 0.15;
/** A hail splash's radiance over that of the scene behind the glass, at least the sky-lit white. Unconfirmed. */
export const SPLASH_OVER_SCENE = 2;
/** Crack size (HailDamageState cracks[].size, 0..1) above which a crack sends runners, and above which it is a hole. */
export const RUNNER_SIZE = 0.6;
export const HOLE_SIZE = 0.85;
/** Radius of a crack's crushed centre at size 0 and 1, m. */
export const CRACK_CORE_M: readonly [number, number] = [0.003, 0.006];
/** Rivulet columns across the motion, m; the share of a column's cells holding one at full wetness; its width, m. */
export const STREAM_COL_M = 0.03;
export const STREAM_SHARE = 0.35;
export const STREAM_WIDTH_M = 0.0015;
/** A stream's colour: the scene times STREAM_DARK plus STREAM_SKY times the sky ambient. */
export const STREAM_DARK = 0.55;
export const STREAM_SKY = 0.1;
/** Share of the direction away from the glazing's centre line added to the airflow on glass facing the airflow. */
export const STREAM_OUTWARD = 0.4;
/** Density of the small beads that stay on the glass at speed. */
export const BEAD_FLYING_SHARE = 0.05;
/** Reach of the aerodynamic shadow below the pixel (the sill) and to its sides (the posts), m. */
export const SHADOW_SILL_M = 0.025;
export const SHADOW_POST_M = 0.012;
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
uniform float uHailFall;      // strikes per m^2 and s on glass facing straight up (n v_t)
uniform float uHailAir;       // strikes per m^2 and s on glass facing straight into the airflow (n v)
uniform float uHailSize;      // splash radius, m
uniform float uSlush;
uniform float uTime;
uniform float uRunPhase;
uniform vec3 uAmbient;
uniform vec3 uSun;
uniform int uCracks;
uniform vec4 uCrackA[${MAX_CRACKS}];  // centre (root frame), radius m
uniform vec4 uCrackB[${MAX_CRACKS}];  // seed, size, unused, unused
uniform float uCrackLevel;
uniform float uLaminated;             // 1: laminated glass (arcs between the radial cracks)
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

// Window coverage at uv, 0 outside the texture.
float coverAt(vec2 uv) {
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
  return texture2D(uAlphaMap, uv).g;
}

// 1 where the glass ends at texture coordinates uv / screen position sp: no window coverage, or the scene there in
// front of the glass (the coaming, a post, the cabin) by more than 3 cm. viewZ: the glass pixel's depth.
float glassEnds(vec2 uv, vec2 sp, float viewZ) {
  if (coverAt(uv) < 0.5) return 1.0;
  if (any(lessThan(sp, vec2(0.0))) || any(greaterThan(sp, vec2(1.0)))) return 0.0;
  float d = texture2D(uDepth, sp).r;
  return (!isSky(d) && viewZFromDepth(d) < viewZ - 0.03) ? 1.0 : 0.0;
}

// Bright crack line: anti-aliased coverage of a line at distance dM (m) with width wPx (px).
float lineAA(float dM, float wPx, float pxM) {
  return clamp(0.5 * wPx + 0.5 - dM * pxM, 0.0, 1.0);
}

void main() {
  // The glass normal from the position's derivatives, before any fragment of the quad is discarded (derivatives
  // are undefined after a discard).
  vec3 P = vRoot;
  vec3 dPx = dFdx(P), dPy = dFdy(P);
  vec2 dUx = dFdx(vUv), dUy = dFdy(vUv);
  vec3 N = normalize(cross(dPx, dPy));
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
  // Screen (scrUp, scrRight, in screen-texture units) and texture-coordinate (uvUp, uvRight) steps per metre up and
  // across the glass, from the screen derivatives of the glass position and the texture coordinates: where the
  // window ends near the pixel (its coverage ends, or the airframe or cabin hides the glass).
  vec2 qdx = vec2(dot(dPx, gx), dot(dPx, gy)), qdy = vec2(dot(dPy, gx), dot(dPy, gy));
  float det = qdx.x * qdy.y - qdx.y * qdy.x;
  bool haveUv = abs(det) > 1e-14;
  vec2 dUp = haveUv ? vec2(-qdy.x, qdx.x) / det : vec2(0.0);
  vec2 dRight = haveUv ? vec2(qdy.y, -qdx.y) / det : vec2(0.0);
  vec2 uvUp = dUp.x * dUx + dUp.y * dUy;
  vec2 uvRight = dRight.x * dUx + dRight.y * dUy;
  // The screen steps from the projection itself (the derivatives' sign convention in y need not match the screen's).
  vec4 cP = uRootToClip * vec4(P, 1.0);
  vec4 cU = uRootToClip * vec4(P + 0.01 * gy, 1.0);
  vec4 cR = uRootToClip * vec4(P + 0.01 * gx, 1.0);
  vec2 scrUp = 50.0 * (cU.xy / cU.w - cP.xy / cP.w);
  vec2 scrRight = 50.0 * (cR.xy / cR.w - cP.xy / cP.w);
  // The drops' motion on the glass: down under gravity, along the airflow at speed, and on glass facing the airflow
  // outward from the glazing's centre line.
  vec3 gv = uGravity - dot(uGravity, N) * N;
  vec3 av = uAirflow - dot(uAirflow, N) * N;
  float facing = smoothstep(0.3, 0.7, dot(uAirflow, N));
  vec3 avOut = av + ${STREAM_OUTWARD.toFixed(2)} * clamp(q.x / 0.08, -1.0, 1.0) * facing * gx;
  vec3 mv = mix(normalize(gv + 1e-5 * gy), normalize(avOut + 1e-5 * gy), uAirShare);
  vec3 my = normalize(mv + 1e-5 * gy);
  vec3 mx = cross(N, my);
  vec2 qm = vec2(dot(rel, mx), dot(rel, my));

  vec4 scene = texture2D(uScene, suv);
  vec3 col = scene.rgb;

  // Coverage of a stream: drawn darker than the scene with a share of the sky light (water against the glass).
  float stream = 0.0;
  if (uWet > 0.0) {
    // Beads stay where the airflow does not reach: next to the sill and the posts.
    float shadow = 0.0;
    if (uAirShare > 0.0 && haveUv) {
      float m = ${SHADOW_POST_M.toFixed(3)};
      shadow = max(glassEnds(vUv - uvUp * ${SHADOW_SILL_M.toFixed(3)}, suv - scrUp * ${SHADOW_SILL_M.toFixed(3)}, vViewZ),
                   max(glassEnds(vUv - uvRight * m, suv - scrRight * m, vViewZ), glassEnds(vUv + uvRight * m, suv + scrRight * m, vViewZ)));
    }
    float still = max(1.0 - uAirShare, 0.85 * shadow);
    beads(q, gx, gy, 0.005, 1u, uWet * 0.55 * still, pxM);
    beads(q + 0.37, gx, gy, 0.011, 2u, uWet * 0.3 * still, pxM);
    if (uAirShare > 0.0) beads(q + 0.71, gx, gy, 0.004, 12u, uWet * ${BEAD_FLYING_SHARE.toFixed(2)} * uAirShare, pxM);
    // Running drops (parked and slow).
    float cw = 0.008;
    float cl = ${RUN_CELL_M.toFixed(4)};
    float colIx = floor(qm.x / cw);
    vec4 hc = hash4(ivec2(int(colIx), 7), 3u, 0u);
    float gyRun = (qm.y - uRunPhase) / cl + hc.x;
    ivec2 c = ivec2(int(colIx), int(floor(gyRun)) & 255);
    vec4 e = hash4(c, 3u, 1u);
    float dens = uWet * 0.18 * (1.0 - uAirShare);
    if (e.x < dens) {
      float r = cw * (0.1 + 0.18 * e.y);
      vec2 f = vec2(fract(qm.x / cw), fract(gyRun));
      vec2 ctr = vec2(0.5 + (e.z - 0.5) * (1.0 - 2.0 * r / cw - 0.05), 0.5 + (e.w - 0.5) * (1.0 - 2.0 * r / cl - 0.05));
      vec2 d = vec2((f.x - ctr.x) * cw, (f.y - ctr.y) * cl);
      float dist = length(d);
      float cover = clamp((r - dist) * pxM + 0.5, 0.0, 1.0);
      takeDrop(cover, d.x * mx + d.y * my, r);
      // The wet trail behind a sliding drop (parked: the trail up the glass the drop came down).
      if (uAirShare < 0.5) {
        float tl = (0.45 - e.w * 0.25) * cl;
        float behind = -d.y;
        float tw = 0.3 * r;
        float trail = step(0.0, behind) * (1.0 - smoothstep(0.6 * tl, tl, behind)) * clamp((tw - abs(d.x)) * pxM + 0.5, 0.0, 1.0);
        takeDrop(0.35 * trail * (1.0 - 2.0 * uAirShare), vec3(d.x * mx) * 3.0, tw * 3.0);
      }
    }
    // Streams at speed: rivulets along the motion, one per column cell, scrolled by the phase along a path fixed on
    // the glass, with a bead at the head.
    if (uAirShare > 0.0) {
      float cwS = ${STREAM_COL_M.toFixed(3)};
      float clS = ${(RUN_WRAP_M / 9).toFixed(6)};
      float ci = floor(qm.x / cwS);
      vec4 hs = hash4(ivec2(int(ci), 13), 10u, 0u);
      float yS = qm.y - uRunPhase;
      float gS = yS / clS;
      int cyi = int(floor(gS));
      cyi -= 9 * int(floor(float(cyi) / 9.0));
      vec4 es = hash4(ivec2(int(ci), cyi), 10u, 1u);
      if (es.x < ${STREAM_SHARE.toFixed(2)} * uWet * uAirShare) {
        float cx = (ci + 0.2 + 0.6 * hs.y) * cwS + 0.006 * sin(qm.y * 40.0 + TAU * hs.z) + 0.002 * sin(qm.y * 130.0 + TAU * hs.w);
        float Ls = 0.1 + 0.3 * es.y;
        float headAt = Ls + (clS - Ls - 0.004) * es.z;
        float back = headAt - fract(gS) * clS;
        float dx = qm.x - cx;
        if (back > -0.003 && back < Ls) {
          float halfW = 0.5 * ${STREAM_WIDTH_M.toFixed(4)} * (1.0 - 0.5 * smoothstep(0.0, 0.3, back));
          float wPx = 2.0 * halfW * pxM;
          float cov = clamp(0.5 * max(wPx, 1.0) + 0.5 - abs(dx) * pxM, 0.0, 1.0) * min(1.0, 0.4 + wPx);
          cov *= step(0.0, back) * (1.0 - smoothstep(0.5 * Ls, Ls, back));
          takeDrop(cov, dx * mx, max(halfW, 0.5 / pxM));
          stream = max(stream, cov);
          // The head bead, 2 mm across.
          vec2 db = vec2(dx, back - 0.001);
          takeDrop(clamp((0.001 - length(db)) * pxM + 0.5, 0.0, 1.0), db.x * mx - db.y * my, 0.001);
        }
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

  // Hail strikes: the fall part on glass facing up, the airspeed part on glass facing the airflow (N faces the
  // cabin, so the outward normal is -N).
  float hailRate = uHailFall * max(0.0, dot(uGravity, N)) + uHailAir * max(0.0, dot(uAirflow, N));
  if (hailRate > 0.0) {
    // Cells along the drops' motion (the airflow at speed), longer along it as the splash stretches.
    float stretch = 1.0 + 3.0 * uAirShare;
    vec2 s = vec2(0.04, 0.04 * stretch);
    vec2 g = qm / s;
    ivec2 c = ivec2(floor(g));
    vec2 f = fract(g);
    vec4 h = hash4(c, 5u, 0u);
    // One strike per cell and cycle: the splash for HAIL_SPLASH_S, then a wet spot for the rest of the cycle.
    float cycleS = ${HAIL_WET_S.toFixed(2)} * mix(1.0, 0.35, uAirShare);
    float cyc = uTime / cycleS + h.z;
    vec4 e = hash4(c, 5u, uint(int(floor(cyc)) & 4095) + 3u);
    float tS = fract(cyc) * cycleS;
    float p = 1.0 - exp(-hailRate * s.x * s.y * cycleS);
    if (e.x < p) {
      float r = uHailSize * (0.6 + 0.8 * e.y);
      float len = r * stretch;
      vec2 ctr = vec2(0.5 + (e.z - 0.5) * (1.0 - 2.0 * min(r / s.x, 0.45)), 0.5 + (e.w - 0.5) * (1.0 - 2.0 * min(len / s.y, 0.45)));
      vec2 d = (f - ctr) * s;
      float age = tS / ${HAIL_SPLASH_S.toFixed(3)};
      if (age < 1.0) {
        // The spray streaks downstream of the impact at speed: the along-motion offset is shortened by the stretch.
        vec2 ds = vec2(d.x, (d.y - 0.5 * (len - r)) / stretch);
        float dist = length(ds);
        float ang = atan(ds.y, ds.x);
        float rays = 7.0 + floor(5.0 * h.y);
        float spike = pow(abs(cos(0.5 * rays * ang + TAU * h.x)), 6.0);
        float reach = r * (0.35 + 0.65 * spike) * (0.5 + 0.5 * smoothstep(0.0, 0.3, age));
        float sp = clamp((reach - dist) * pxM + 0.5, 0.0, 1.0) * (1.0 - smoothstep(0.3, 1.0, age));
        ice = max(ice, sp * 0.9);
      }
      // The melt water of the stone: a wet spot at the impact, fading over the cycle.
      float wr = 0.7 * r;
      float wet = clamp((wr - length(d)) * pxM + 0.5, 0.0, 1.0) * smoothstep(0.3, 1.0, age) * (1.0 - smoothstep(0.6 * cycleS, cycleS, tS));
      takeDrop(wet, d.x * mx + d.y * my, wr);
    }
  }

  // Slush at the sill: where the window ends within a hashed 15..35 mm below the pixel (down the glass).
  if (uSlush > 0.0) {
    if (haveUv) {
      float hx = floor(q.x / 0.012);
      vec4 hs = hash4(ivec2(int(hx), 0), 8u, 0u);
      float fx = fract(q.x / 0.012);
      float edge = 0.015 + 0.02 * mix(hs.x, hash4(ivec2(int(hx) + 1, 0), 8u, 0u).x, smoothstep(0.0, 1.0, fx));
      float hgt = edge * uSlush;
      if (glassEnds(vUv - uvUp * hgt, suv - scrUp * hgt, vViewZ) > 0.5) white = max(white, 0.75 * uSlush * (0.8 + 0.2 * hs.y));
    }
  }

  // Cracks.
  float crack = 0.0;
  float milk = 0.0;
  float hole = 0.0;
  // Above SHATTER_LEVEL the cracks grow: more runners and holes.
  float grow = 0.3 * clamp((uCrackLevel - ${SHATTER_LEVEL.toFixed(2)}) / ${(1 - SHATTER_LEVEL).toFixed(2)}, 0.0, 1.0);
  for (int k = 0; k < ${MAX_CRACKS}; k++) {
    if (k >= uCracks) break;
    vec4 A = uCrackA[k];
    vec4 B = uCrackB[k];
    float size = min(1.0, B.y + grow);
    vec3 d3 = P - A.xyz;
    d3 -= dot(d3, N) * N;
    vec2 d2 = vec2(dot(d3, gx), dot(d3, gy));
    float rho = length(d2);
    float R = A.w;
    uint seed = uint(B.x * 65535.0);
    // Runners: cracks running on from the impact across the glass, each at a hashed angle, wandering sideways.
    if (size > ${RUNNER_SIZE.toFixed(2)}) {
      vec4 hn = hash4(ivec2(k, 0), 9u, seed);
      int runners = 1 + int(floor(3.0 * hn.x * (size - ${RUNNER_SIZE.toFixed(2)}) / ${(1 - RUNNER_SIZE).toFixed(2)} + 0.5 * hn.y));
      for (int j = 0; j < 3; j++) {
        if (j >= runners) break;
        vec4 hj = hash4(ivec2(k, j + 1), 9u, seed);
        float th = TAU * (hj.x + float(j) / 3.0);
        vec2 u = vec2(cos(th), sin(th));
        float sAlong = dot(d2, u);
        float L = 0.3 + 0.5 * hj.y;
        if (sAlong < 0.0 || sAlong > L) continue;
        float lat = dot(d2, vec2(-u.y, u.x));
        float wander = 0.01 * sin(sAlong * 9.0 + TAU * hj.z) + 0.004 * sin(sAlong * 31.0 + TAU * hj.w);
        // Grows out of the centre (no wander at the impact) and fades over its last 30 %.
        float dLat = abs(lat - wander * smoothstep(0.0, 0.05, sAlong));
        float fade = 1.0 - smoothstep(0.7 * L, L, sAlong);
        crack = max(crack, lineAA(dLat, 1.0, pxM) * fade);
        milk = max(milk, 0.2 * lineAA(dLat, 5.0, pxM) * fade);
      }
    }
    if (rho > R) continue;
    float ang = atan(d2.x, d2.y);
    float n = 4.0 + floor(5.0 * B.x);
    // Radial cracks: the nearest of n rays (jittered angles, wiggling with the radius), each of its own length.
    float sector = (ang / TAU + 0.5) * n;
    float si = floor(sector);
    vec4 hr = hash4(ivec2(int(si), k), 6u, seed);
    float wig = 0.04 * sin(rho * 120.0 + TAU * hr.y) + 0.015 * sin(rho * 400.0 + TAU * hr.z);
    float rayAng = (si + 0.5 + 0.7 * (hr.x - 0.5) + wig - sector) * (TAU / n);
    float len = R * (0.25 + 0.75 * hr.w);
    float ray = lineAA(abs(rayAng) * rho, 1.0, pxM) * (1.0 - smoothstep(0.7 * len, len, rho));
    // Laminated glass: arcs between the rays at two radii.
    float arc = 0.0;
    if (uLaminated > 0.5) {
      for (int j = 0; j < 2; j++) {
        float rr = R * (0.22 + 0.25 * float(j) + 0.1 * hr.y);
        float on = step(0.45, fract(hr.z * 7.0 + float(j) * 0.37));
        arc = max(arc, on * lineAA(abs(rho - rr), 1.0, pxM));
      }
    }
    // The crushed centre and the stress-whitened zone about it.
    float cr = ${CRACK_CORE_M[0].toFixed(4)} + ${(CRACK_CORE_M[1] - CRACK_CORE_M[0]).toFixed(4)} * B.y;
    float core = 1.0 - smoothstep(0.6 * cr, cr, rho);
    milk = max(milk, (0.35 + 0.25 * uCrackLevel) * (1.0 - smoothstep(cr, 2.5 * cr, rho)));
    float c = max(max(ray, arc * 0.8), core);
    if (size > ${HOLE_SIZE.toFixed(2)}) {
      // A hole: a ragged disc of 0.3 R, a chipped white rim of 3 mm and 4 short rays from it.
      vec4 hh = hash4(ivec2(k, 7), 9u, seed);
      float rh = 0.3 * R * (1.0 + 0.12 * sin(5.0 * ang + TAU * hh.x) + 0.06 * sin(11.0 * ang + TAU * hh.y));
      float inside = clamp((rh - rho) * pxM + 0.5, 0.0, 1.0);
      float chip = 0.003 * (0.7 + 0.3 * sin(17.0 * ang + TAU * hh.z) * sin(7.0 * ang + TAU * hh.w));
      float rim = clamp((rh + chip - rho) * pxM + 1.0, 0.0, 1.0) * (1.0 - inside);
      // Crushed acrylic about the rim.
      milk = max(milk, 0.5 * (1.0 - smoothstep(rh + chip, rh + chip + 0.006, rho)));
      float q4 = (ang / TAU + 0.5) * 4.0 + hh.x;
      float shortAng = (fract(q4) - 0.5) * (TAU / 4.0);
      float shortLen = rh * (1.3 + 0.5 * hh.w);
      float shortRay = lineAA(abs(shortAng) * rho, 1.0, pxM) * step(rh, rho) * (1.0 - smoothstep(0.8 * shortLen, shortLen, rho));
      c = max(c * (1.0 - inside), max(rim, shortRay));
      milk *= 1.0 - inside;
      hole = max(hole, inside);
    }
    crack = max(crack, c);
  }

  // Nothing on the glass where it is broken through: no drops, film, snow or splashes.
  dropCover *= 1.0 - hole;
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
    // Against the sky the view through a drop is sky too: a fixed darkening toward its centre shows it as a lens.
    if (isSky(sd)) dropCol *= 1.0 - ${DROP_SKY_DARK.toFixed(2)} * (1.0 - rr * rr);
    // Highlight of the sky on the drop's upper side.
    float hl = smoothstep(0.35, 0.75, rr) * (1.0 - smoothstep(0.75, 0.95, rr)) * smoothstep(0.2, 0.9, dot(normalize(dropOff + 1e-6 * gy), gy));
    dropCol += uAmbient * 0.35 * hl;
    col = mix(col, dropCol, dropCover);
  }
  // A thin water film blurs the view at speed in rain.
  float film = uWet * uAirShare * 0.35 * (1.0 - hole);
  if (film > 0.0) {
    vec2 px = 2.0 / uResolution;
    vec3 blur = 0.25 * (texture2D(uScene, suv + vec2(px.x, 0.0)).rgb + texture2D(uScene, suv - vec2(px.x, 0.0)).rgb +
                        texture2D(uScene, suv + vec2(0.0, px.y)).rgb + texture2D(uScene, suv - vec2(0.0, px.y)).rgb);
    col = mix(col, blur, film);
  }
  col = mix(col, col * ${STREAM_DARK.toFixed(2)} + uAmbient * ${STREAM_SKY.toFixed(2)}, stream * (1.0 - hole));
  col = mix(col, lit * 0.8, milk);
  col = mix(col, lit * 1.1, crack * 0.85);
  col = mix(col, whiteCol, white * (1.0 - hole));
  col = mix(col, iceCol, ice * (1.0 - hole));
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
  /** What the glass meets this frame (advance() fills it; one object for the overlay's life). */
  private readonly glassWeather: GlassWeather = { type: 'none', rateMmH: 0, hailMmH: 0, hailMaxMm: 0, tasMs: 0 };
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
  private readonly ambient = new THREE.Vector3();
  private readonly sun = new THREE.Vector3();
  private readonly resolution = new THREE.Vector2(1, 1);
  /** Cracks placed on the glass so far (their centres are in crackA). */
  private placed = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly tmp = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly hits: THREE.Intersection[] = [];

  constructor(c: WeatherEffectContext | null = null) {
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
      uHailFall: { value: 0 },
      uHailAir: { value: 0 },
      uSlush: { value: 0 },
      uHailSize: { value: 0.01 },
      uTime: { value: 0 },
      uRunPhase: { value: 0 },
      uAmbient: { value: this.ambient },
      uSun: { value: this.sun },
      uCracks: { value: 0 },
      uCrackA: { value: this.crackA },
      uCrackB: { value: this.crackB },
      uCrackLevel: { value: 0 },
      uLaminated: { value: c?.ctx?.presentation?.visual?.glazing?.laminated ? 1 : 0 },
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
    const g = this.glassWeather;
    g.type = p.type;
    g.rateMmH = p.rateMmH;
    g.hailMmH = p.hailMmH;
    g.hailMaxMm = p.hailMaxMm;
    g.tasMs = Number.isFinite(tas) ? tas : 0;
    this.water.update(g, dt);
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
    u.uHailFall.value = w.hailFallPerM2s;
    u.uHailAir.value = w.hailAirPerM2s;
    u.uSlush.value = w.slush;
    const p = ctx.weatherFx?.precip ?? this.local;
    u.uHailSize.value = Math.max(0.004, 0.0006 * Math.max(p.hailMaxMm, 5));
    u.uTime.value = w.time;
    u.uRunPhase.value = w.runPhaseM;
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

  /** Place the cracks not yet placed (a ray from the eye along each crack's direction). */
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
    u.uCrackLevel.value = d ? d.windscreen : 0;
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
