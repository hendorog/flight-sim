// GLSL of the cumulonimbus cells (StormCellEffect.ts): the half-resolution march and the full-resolution composite.
//
// A cell (uniform arrays, at most STORM_MAX_CELLS, three.js world: x east, y up MSL, z south):
//   uCellA = (centre x, centre z, core radius R, anvil top)
//   uCellB = (base, intensity, anvil radius, rain-shaft radius)
//   uCellC = (anvil centre x, anvil centre z, bounding-cylinder centre x, z)
//   uCellR = bounding-cylinder radius
//   uCellW = (core share, anvil share, rain share, 0): the cell's selection weight times its life cycle
//            (physics/weather/stormField.ts ActiveStorm; 1 for an explicit cell), multiplying each density
// Density (cell-local; r the horizontal distance to the centre, broken up by a world-space noise n):
//   core   smoothstep(R, 0.6 R, r) from the base to the anvil's underside, (0.6 + 0.4 n), extinction STORM_CORE_SIGMA
//   anvil  a disc of the anvil radius around the anvil centre (moved downwind), from (top - STORM_ANVIL_DEPTH_M),
//          thinning from half its radius to its edge, up to the top; (0.5 + 0.5 n), extinction STORM_ANVIL_SIGMA
//   shaft  smoothstep(shaftR, 0.3 shaftR, r) below the base, x intensity, extinction STORM_SHAFT_SIGMA
//   virga  outside the shaft, inside the core's footprint, fading out STORM_VIRGA_DEPTH_M below the base
// The march covers each cell's bounding cylinder (ground to top), clipped by the scene depth; the cylinders' ray
// intervals are sorted and merged, and the ray skips the gaps between them. It takes coarse steps until the
// optical depth of one step exceeds 0.3, then backs up one step and continues with quarter-length steps (back to
// coarse after three empty fine steps). Light per sample: the sun at the sample's altitude (uSunBase .. uSunTop
// interpolated, from the shared Atmosphere on the CPU) through two density taps toward the sun and, beyond them,
// the analytic core columns and anvils (STORM_SHADOW_GLSL), single-scattered with the clouds' dual-lobe
// Henyey-Greenstein phase plus a multiple-scattering term (the cumulus march's STORM_MS_ISO terms for the cloud,
// exp(-STORM_MS_K tau) for the rain); the sky ambient through the analytic column above the sample (the dark base),
// STORM_SIDE_SKY of the horizon radiance from the sides, and ground bounce through the column below, from ground
// that lies in the cells' shadow and, under their cloud, sees STORM_GROUND_SKY_UNDER of the sky. Albedo 0.99 for
// cloud and STORM_RAIN_ALBEDO for rain. Haze between the camera and the storm's front: the shared
// aerial-perspective volume, or an exponential haze without it (as VolcanoPlumeEffect).
// The sunlit share of that haze (STORM_HAZE_SUN_SHARE) is dimmed by the cells' shadow at four points along the path.
// Extra work per lit sample over the taps: two stormColumn and two stormShadowTau loops over the cells (each cell
// four ray-cylinder chords), no texture reads; per pixel, four more stormShadowTau loops for the haze.

import { DEPTH_GLSL } from '../../core/shaderLib';
import { AERIAL_ATLAS_GLSL } from '../post/AerialPerspectiveEffect';

/** Cells the shader reads. */
export const STORM_MAX_CELLS = 6;
/** March steps per pixel (the shader's main loop; tests/render/stormCells.test.ts caps it at 56). */
export const STORM_STEPS = 48;
/** Share of STORM_STEPS the coarse steps would take to cover every interval (the rest is for fine steps). */
export const STORM_COARSE_SHARE = 0.5;
/** Extinction of the full-density core, anvil and rain shaft, 1/m. Unconfirmed: tuning values, no source checked. */
export const STORM_CORE_SIGMA = 0.2;
export const STORM_ANVIL_SIGMA = 0.05;
export const STORM_SHAFT_SIGMA = 0.004;
/** Depth of the anvil at its centre, m (the core ends at its underside). */
export const STORM_ANVIL_DEPTH_M = 1500;
/** Depth below the base over which the virga fades out, m. */
export const STORM_VIRGA_DEPTH_M = 800;
/** Multiple-scattering share and its optical-depth scale. Unconfirmed: look values. */
export const STORM_MS = 0.6;
export const STORM_MS_K = 0.08;
/**
 * The high orders of scattering in the cloud (not the rain): STORM_MS_ISO exp(-STORM_MS_LEAK tau) / (1 + STORM_MS_ISO_K
 * tau) of the sunlight, the values of the cumulus march (render/clouds/marchShader.ts MS_ISO, MS_ISO_K, MS_LEAK), so a
 * sunlit tower is as white as a sunlit cumulus beside it. Unconfirmed: look values taken over from the cumulus.
 */
export const STORM_MS_ISO = 0.3;
export const STORM_MS_ISO_K = 0.5;
export const STORM_MS_LEAK = 0.04;
/**
 * Share of the horizon radiance (ctx.sky.hazeColor) that lights a sample from the sides, where the analytic column
 * above it hides the sky: the shaded flanks, the base and the rain shaft under the core. Unconfirmed: a look value.
 */
export const STORM_SIDE_SKY = 0.25;
/** Share of the sky light that reaches the ground under a cell's core or anvil (lateral sky). Unconfirmed: a look value. */
export const STORM_GROUND_SKY_UNDER = 0.3;
/**
 * Shadow columns (STORM_SHADOW_GLSL): the core as two vertical cylinders of STORM_SHADOW_CORE_R and 0.6 of it times
 * R, from the base to STORM_SHADOW_CORE_TOP_M above the anvil's underside, at STORM_SHADOW_CORE_FILL of the core's
 * extinction (its mean noise factor 0.6 + 0.4 x 0.5). The core's visible surface lies at 0.7 to 1 R (stormGlsl
 * cellDensity), so the cylinders stay inside it: a larger radius shadowed the sunlit flanks from within (measured
 * with 1 R: the tower's sunlit side at 216 instead of 813 scene units, dev/weather.html, 2026-10-20). The anvil as two discs of
 * 1 and 0.5 times its radius from STORM_SHADOW_ANVIL_LIFT_M above its underside at the centre (the underside rises
 * 900 m toward the edge) to the top, at STORM_SHADOW_ANVIL_FILL of its extinction. Unconfirmed: fits to the density.
 */
export const STORM_SHADOW_CORE_R = 0.6;
export const STORM_SHADOW_CORE_TOP_M = 250;
export const STORM_SHADOW_CORE_FILL = 0.8;
export const STORM_SHADOW_ANVIL_LIFT_M = 300;
export const STORM_SHADOW_ANVIL_FILL = 0.75;
/**
 * Share of the haze's in-scatter in front of a cell that is direct sunlight, dimmed where the path lies in the cells'
 * shadow (the rest, sky light scattered by the air, is left). Measured before it (dev/weather.html, Thunderstorm at
 * 15:00, the cell 22 km west, 2026-10-20): the haze transmittance in front of the base 0.38 to 0.40 and the haze 85 %
 * of the base pixel's radiance. Unconfirmed: a look value.
 */
export const STORM_HAZE_SUN_SHARE = 0.8;
/** The cumulus march ends where the storm's transmittance falls below this (the storm layer's aux b). Unconfirmed. */
export const STORM_CLIP_T = 0.3;
/** Diffuse transmission of a column of optical depth tau: 1 / (1 + STORM_DIFFUSE_K tau). Unconfirmed: a look value. */
export const STORM_DIFFUSE_K = 0.11;
/** Albedo of the rain shaft (darker grey than the cloud). Unconfirmed: a look value. */
export const STORM_RAIN_ALBEDO = 0.55;
/** Noise periods, m (the 32^3 texture tiles), and the turrets' rise speed, m/s. */
export const STORM_NOISE_PERIOD_M = 5200;
export const STORM_NOISE_DETAIL_M = 900;
export const STORM_RISE_MS = 3;

const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));

/**
 * Optical depth of the cells' core columns and anvils along a ray, for the shadows the cells cast on themselves,
 * on the ground below them (StormCellEffect) and on the cumulus (render/clouds/cloudModel.ts). stormColumnTau
 * integrates o + s d, s >= 0, d upward (d.y > 0), through one cell: centre c, core radius R, base, the anvil's
 * underside at its centre (anvilBot), the anvil's centre ac and radius aR, top = anvilBot + STORM_ANVIL_DEPTH_M,
 * and the extinctions sc (core) and sa (anvil) of the full-density cloud times the cell's shares.
 */
export const STORM_SHADOW_GLSL = /* glsl */ `
// Length of o + s d inside the vertical cylinder of radius r about c between altitudes y0 and y1, s >= 0.
float stormChord(vec3 o, vec3 d, vec2 c, float r, float y0, float y1) {
  float dy = max(d.y, 1e-3);
  float s0 = max((y0 - o.y) / dy, 0.0), s1 = (y1 - o.y) / dy;
  if (s1 <= s0) return 0.0;
  vec2 oc = o.xz - c;
  float a = dot(d.xz, d.xz);
  float k = dot(oc, oc) - r * r;
  if (a < 1e-8) return k < 0.0 ? s1 - s0 : 0.0;
  float b = dot(oc, d.xz);
  float disc = b * b - a * k;
  if (disc <= 0.0) return 0.0;
  float q = sqrt(disc);
  return max(min(s1, (-b + q) / a) - max(s0, (-b - q) / a), 0.0);
}
float stormColumnTau(vec3 o, vec3 d, vec2 c, float R, float base, float anvilBot, vec2 ac, float aR, float sc, float sa) {
  float tau = 0.0;
  if (sc > 0.0) {
    float y1 = anvilBot + ${f(STORM_SHADOW_CORE_TOP_M)};
    float rc = ${f(STORM_SHADOW_CORE_R)} * R;
    tau += sc * ${f(STORM_SHADOW_CORE_FILL)} * 0.5 * (stormChord(o, d, c, rc, base, y1) + stormChord(o, d, c, 0.6 * rc, base, y1));
  }
  if (sa > 0.0) {
    float y0 = anvilBot + ${f(STORM_SHADOW_ANVIL_LIFT_M)}, y1 = anvilBot + ${f(STORM_ANVIL_DEPTH_M)};
    tau += sa * ${f(STORM_SHADOW_ANVIL_FILL)} * 0.5 * (stormChord(o, d, ac, aR, y0, y1) + stormChord(o, d, ac, 0.5 * aR, y0, y1));
  }
  return tau;
}
`;

export const STORM_RAY_GLSL = /* glsl */ `
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
vec3 rayDirView(vec2 uv) {
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  return normalize(v.xyz / v.w);
}
`;

export const STORM_MARCH_FRAG = /* glsl */ `
${DEPTH_GLSL}
${STORM_RAY_GLSL}
${STORM_SHADOW_GLSL}
${AERIAL_ATLAS_GLSL}
in vec2 vUv;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outAux;

uniform sampler2D uDepth;
uniform highp sampler3D uNoise;
uniform float uAerialOn;
uniform vec2 uHaze;
uniform vec3 uHazeColor;
uniform float uFrame;
uniform float uTime;
uniform float uNearClip;

uniform vec4 uCellA[${STORM_MAX_CELLS}];
uniform vec4 uCellB[${STORM_MAX_CELLS}];
uniform vec4 uCellC[${STORM_MAX_CELLS}];
uniform float uCellR[${STORM_MAX_CELLS}];
uniform vec4 uCellW[${STORM_MAX_CELLS}];
uniform int uCount;
uniform float uGroundY;
uniform vec2 uSunSpan;         // altitudes of uSunBase and uSunTop, m MSL

uniform vec3 uSunDir;
uniform vec3 uSunBase;
uniform vec3 uSunTop;
uniform vec3 uSkyColor;
uniform vec3 uGroundSun;       // ground radiance from the direct sun on open ground (albedo x E mu0 / pi)
uniform vec3 uGroundSky;       // ground radiance from the sky light on open ground (albedo x sky radiance)
uniform float uGroundAlt;      // ground altitude under the camera, m MSL
uniform float uMaxRadiance;

const float STORM_PI = 3.14159265;

float stormHg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * STORM_PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

float stormDiffuse(float tau) { return 1.0 / (1.0 + ${f(STORM_DIFFUSE_K)} * tau); }

float stormNoise(vec3 p) {
  vec3 q = p - vec3(0.0, uTime * ${f(STORM_RISE_MS)}, 0.0);
  return texture(uNoise, q / ${f(STORM_NOISE_PERIOD_M)}).r * 0.65 + texture(uNoise, q / ${f(STORM_NOISE_DETAIL_M)} + 0.37).r * 0.35;
}

// Densities of one cell at p (with the point's noise n): x core, y anvil, z rain (shaft and virga).
vec3 cellDensity(int i, vec3 p, float n) {
  vec4 A = uCellA[i];
  vec4 B = uCellB[i];
  vec4 C = uCellC[i];
  float R = A.z, top = A.w, base = B.x;
  float r = length(p.xz - A.xy);
  float bill = (0.5 - n);
  float anvilBot = top - ${f(STORM_ANVIL_DEPTH_M)};
  // Core: a column wider at mid-height that flares into the anvil, with billowed edges.
  float h = clamp((p.y - base) / max(anvilBot - base, 1.0), 0.0, 1.0);
  float Rh = R * (0.75 + 0.25 * sin(STORM_PI * h)) * (1.0 + 0.6 * smoothstep(0.7, 1.0, h));
  float rc = r + bill * 0.7 * R;
  float core = smoothstep(Rh, 0.6 * Rh, rc) * smoothstep(base, base + 60.0, p.y) * (1.0 - smoothstep(anvilBot + 100.0, anvilBot + 400.0, p.y));
  core *= 0.6 + 0.4 * n;
  // Anvil: thickest over its centre, its underside rising toward the edge.
  float ra = length(p.xz - C.xy) + bill * 0.45 * B.z;
  float e = clamp(ra / max(B.z, 1.0), 0.0, 1.0);
  float bot = anvilBot + 900.0 * e * e;
  float anvil = smoothstep(B.z, 0.5 * B.z, ra) * smoothstep(bot, bot + 200.0, p.y) * (1.0 - smoothstep(top - 250.0, top, p.y));
  anvil *= 0.5 + 0.5 * n;
  // Rain: the shaft under the core, and virga at the rest of the core's footprint below the base.
  float below = 1.0 - smoothstep(base - 100.0, base, p.y);
  float rs = r + bill * 0.4 * B.w;
  float shaft = smoothstep(B.w, 0.3 * B.w, rs);
  float foot = smoothstep(R, 0.6 * R, rc);
  float virga = max(foot - shaft, 0.0) * smoothstep(base - ${f(STORM_VIRGA_DEPTH_M)}, base, p.y);
  float rain = (shaft + virga) * below * B.y * (0.7 + 0.3 * n);
  return vec3(core, anvil, rain) * uCellW[i].xyz;
}

// Extinction at p, 1/m, and the rain's share of it.
float stormSigma(vec3 p, out float rainShare) {
  float n = stormNoise(p);
  vec3 d = vec3(0.0);
  for (int i = 0; i < ${STORM_MAX_CELLS}; i++) {
    if (i >= uCount) break;
    d += cellDensity(i, p, n);
  }
  float cloud = d.x * ${f(STORM_CORE_SIGMA)} + d.y * ${f(STORM_ANVIL_SIGMA)};
  float rain = d.z * ${f(STORM_SHAFT_SIGMA)};
  float s = cloud + rain;
  rainShare = s > 0.0 ? rain / s : 0.0;
  return s;
}

float stormSigma(vec3 p) { float r; return stormSigma(p, r); }

// Optical depth of the cells' cloud above (x) and below (y) p, analytic (no noise), for the ambient terms.
vec2 stormColumn(vec3 p) {
  vec2 tau = vec2(0.0);
  for (int i = 0; i < ${STORM_MAX_CELLS}; i++) {
    if (i >= uCount) break;
    vec4 A = uCellA[i];
    vec4 B = uCellB[i];
    vec4 C = uCellC[i];
    float anvilBot = A.w - ${f(STORM_ANVIL_DEPTH_M)};
    float core = smoothstep(A.z, 0.6 * A.z, length(p.xz - A.xy)) * 0.8 * ${f(STORM_CORE_SIGMA)};
    float above = clamp(anvilBot - max(p.y, B.x), 0.0, 1e5);
    float below = clamp(min(p.y, anvilBot) - B.x, 0.0, 1e5);
    float ra = length(p.xz - C.xy);
    float e = clamp(ra / max(B.z, 1.0), 0.0, 1.0);
    float anvil = smoothstep(B.z, 0.5 * B.z, ra) * 0.75 * ${f(STORM_ANVIL_SIGMA)} * clamp(A.w - max(p.y, anvilBot + 900.0 * e * e), 0.0, 3000.0);
    vec4 W = uCellW[i];
    tau += vec2(core * W.x * above + anvil * W.y, core * W.x * below);
  }
  return tau;
}

// Optical depth of the cells' core columns and anvils along o + s d, s >= 0 (STORM_SHADOW_GLSL).
float stormShadowTau(vec3 o, vec3 d) {
  float tau = 0.0;
  for (int i = 0; i < ${STORM_MAX_CELLS}; i++) {
    if (i >= uCount) break;
    vec4 A = uCellA[i];
    vec4 B = uCellB[i];
    vec4 W = uCellW[i];
    tau += stormColumnTau(o, d, A.xy, A.z, B.x, A.w - ${f(STORM_ANVIL_DEPTH_M)}, uCellC[i].xy, B.z, W.x * ${f(STORM_CORE_SIGMA)}, W.y * ${f(STORM_ANVIL_SIGMA)});
  }
  return tau;
}

// Ray interval through a cell's bounding cylinder (x entry, y exit; x >= y when missed).
vec2 cellHit(int i, vec3 o, vec3 d) {
  vec2 c = uCellC[i].zw;
  float R = uCellR[i];
  vec2 oc = o.xz - c;
  float a = dot(d.xz, d.xz);
  float b = dot(oc, d.xz);
  float k = dot(oc, oc) - R * R;
  vec2 t = vec2(-1e9, 1e9);
  if (a > 1e-10) {
    float disc = b * b - a * k;
    if (disc <= 0.0) return vec2(1.0, 0.0);
    float s = sqrt(disc);
    t = vec2((-b - s) / a, (-b + s) / a);
  } else if (k > 0.0) {
    return vec2(1.0, 0.0);
  }
  float y0 = uGroundY, y1 = uCellA[i].w + 100.0;
  if (abs(d.y) > 1e-8) {
    float ta = (y0 - o.y) / d.y, tb = (y1 - o.y) / d.y;
    t = vec2(max(t.x, min(ta, tb)), min(t.y, max(ta, tb)));
  } else if (o.y < y0 || o.y > y1) {
    return vec2(1.0, 0.0);
  }
  return t;
}

void main() {
  vec3 dv = rayDirView(vUv);
  vec3 dir = normalize(mat3(uCamWorld) * dv);
  float dd = texture(uDepth, vUv).r;
  float sceneDist = isSky(dd) ? 1e8 : viewZFromDepth(dd) / max(-dv.z, 1e-4);
  outAux = vec4(log2(1.0 + 1e8), log2(1.0 + sceneDist), log2(1.0 + 1e8), 0.0);
  outColor = vec4(0.0, 0.0, 0.0, 1.0);

  // The cylinders' intervals, clipped, sorted by entry and merged.
  vec2 iv[${STORM_MAX_CELLS}];
  int m = 0;
  for (int i = 0; i < ${STORM_MAX_CELLS}; i++) {
    if (i >= uCount) break;
    vec2 h = cellHit(i, uCamPos, dir);
    h.x = max(h.x, uNearClip);
    h.y = min(h.y, sceneDist);
    if (h.x < h.y) iv[m++] = h;
  }
  if (m == 0) return;
  for (int a = 1; a < ${STORM_MAX_CELLS}; a++) {
    if (a >= m) break;
    for (int b = a; b > 0; b--) {
      if (iv[b].x >= iv[b - 1].x) break;
      vec2 tmp = iv[b]; iv[b] = iv[b - 1]; iv[b - 1] = tmp;
    }
  }
  int n = 1;
  for (int a = 1; a < ${STORM_MAX_CELLS}; a++) {
    if (a >= m) break;
    if (iv[a].x <= iv[n - 1].y) iv[n - 1].y = max(iv[n - 1].y, iv[a].y);
    else iv[n++] = iv[a];
  }
  float total = 0.0;
  for (int a = 0; a < ${STORM_MAX_CELLS}; a++) {
    if (a >= n) break;
    total += iv[a].y - iv[a].x;
  }

  // Interleaved gradient noise start offset (Jimenez 2014), a new pattern each frame.
  vec2 px = gl_FragCoord.xy + vec2(47.0, 17.0) * mod(uFrame, 64.0);
  float jitter = fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
  float coarse = max(total / (${STORM_STEPS}.0 * ${f(STORM_COARSE_SHARE)}), 20.0);
  float fineStep = max(coarse * 0.25, 15.0);
  float cosSun = dot(dir, uSunDir);
  float phase = mix(stormHg(cosSun, 0.8), stormHg(cosSun, -0.25), 0.35);
  float rainPhase = mix(stormHg(cosSun, 0.5), 1.0 / (4.0 * STORM_PI), 0.5);
  vec3 sunL = normalize(uSunDir);
  vec3 L = vec3(0.0);
  float T = 1.0;
  float clip = 1e8;
  float dsum = 0.0, wsum = 0.0;
  int k = 0;
  float t = iv[0].x + jitter * coarse;
  bool fine = false;
  int empty = 0;
  for (int i = 0; i < ${STORM_STEPS}; i++) {
    while (k < n && t >= iv[k].y) {
      k++;
      if (k < n) t = max(t, iv[k].x + jitter * (fine ? fineStep : coarse));
    }
    if (k >= n) break;
    float dt = fine ? fineStep : coarse;
    vec3 p = uCamPos + dir * t;
    float rainShare;
    float sigma = stormSigma(p, rainShare);
    if (!fine && sigma * dt > 0.3) {
      // Entering dense medium: back up one coarse step and continue finely.
      fine = true;
      empty = 0;
      t = max(t - coarse, iv[k].x);
      continue;
    }
    if (fine) {
      empty = sigma * dt < 1e-3 ? empty + 1 : 0;
      if (empty >= 3) fine = false;
    }
    if (sigma > 1e-6) {
      // Toward the sun: two density taps (the turrets shading each other), then the analytic core columns and
      // anvils beyond them, so the rain under the core and the base lie in the shadow of the cloud above them.
      float tauSun = stormSigma(p + sunL * 150.0) * 150.0 + stormSigma(p + sunL * 600.0) * 450.0 + stormShadowTau(p + sunL * 600.0, sunL);
      vec2 col = stormColumn(p);
      float hs = clamp((p.y - uSunSpan.x) / max(uSunSpan.y - uSunSpan.x, 1.0), 0.0, 1.0);
      vec3 sun = mix(uSunBase, uSunTop, hs);
      float ph = mix(phase, rainPhase, rainShare);
      // Multiple scattering: the cloud's high orders (as the cumulus), the rain's single forward-peaked term.
      float msCloud = ${f(STORM_MS_ISO)} * exp(-${f(STORM_MS_LEAK)} * tauSun) / (1.0 + ${f(STORM_MS_ISO_K)} * tauSun);
      float msRain = ${f(STORM_MS)} * exp(-${f(STORM_MS_K)} * tauSun) / (4.0 * STORM_PI);
      // The ground below the sample: in the cells' shadow, and under their cloud lit by the lateral sky only.
      vec3 gp = vec3(p.x, uGroundAlt, p.z);
      float under = 1.0 - exp(-0.2 * stormColumn(gp).x);
      vec3 ground = uGroundSun * exp(-stormShadowTau(gp, sunL)) + uGroundSky * mix(1.0, ${f(STORM_GROUND_SKY_UNDER)}, under);
      vec3 S = sun * (ph * exp(-tauSun) + mix(msCloud, msRain, rainShare))
             + uSkyColor * (0.85 * stormDiffuse(col.x)) + uHazeColor * ${f(STORM_SIDE_SKY)} + ground * (0.35 * stormDiffuse(col.y));
      S *= mix(0.99, ${f(STORM_RAIN_ALBEDO)}, rainShare);
      float Ts = exp(-sigma * dt);
      float a = T * (1.0 - Ts);
      L += S * a;
      dsum += t * a;
      wsum += a;
      // Where the transmittance crosses STORM_CLIP_T (the cumulus march ends there).
      if (T >= ${f(STORM_CLIP_T)} && T * Ts < ${f(STORM_CLIP_T)}) clip = t + log(T / ${f(STORM_CLIP_T)}) / sigma;
      T *= Ts;
      if (T < 0.01) break;
    }
    t += dt;
  }
  if (wsum <= 1e-5) return;
  float front = dsum / wsum;
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
  // The air in front of the cells lies partly in their shadow (the tower and the anvil toward the sun): the sunlit
  // share of its in-scatter is dimmed by the cells' direct transmission at four points along the path, each
  // weighted by the haze transmittance in front of it.
  if (sunL.y > 0.0) {
    float sh = 0.0, wh = 0.0;
    for (int j = 0; j < 4; j++) {
      float fj = (float(j) + 0.5) * 0.25;
      float w = pow(max(Th, 1e-3), fj);
      sh += w * exp(-stormShadowTau(uCamPos + dir * (front * fj), sunL));
      wh += w;
    }
    inscatter *= mix(1.0, sh / wh, ${f(STORM_HAZE_SUN_SHARE)});
  }
  L = min(L, vec3(uMaxRadiance));
  outColor = vec4(L * Th + inscatter * (1.0 - T), T);
  outAux = vec4(log2(1.0 + front), log2(1.0 + sceneDist), log2(1.0 + clip), 0.0);
}
`;

/**
 * Depth-aware upsample of the march (as VolcanoPlumeEffect) over the scene: out = in T_cb + L_cb. The storm pass
 * runs before the cumulus (render/weather/index.ts), whose march ends at the storm's front (the aux b distance,
 * STORM_CLIP_T) and composites over this result.
 */
export const STORM_COMPOSITE_FRAG = /* glsl */ `
${DEPTH_GLSL}
${STORM_RAY_GLSL}
in vec2 vUv;
layout(location = 0) out vec4 outColor;
uniform sampler2D uScene;
uniform sampler2D uDepth;
uniform sampler2D uStorm;
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
  vec2 fr = lp - vec2(i0);
  ivec2 maxPx = ivec2(uLowSize) - 1;
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    ivec2 q = clamp(i0 + o, ivec2(0), maxPx);
    vec4 aux = texelFetch(uAux, q, 0);
    vec4 c = logD < aux.r - 0.15 ? vec4(0.0, 0.0, 0.0, 1.0) : texelFetch(uStorm, q, 0);
    float bw = (o.x == 1 ? fr.x : 1.0 - fr.x) * (o.y == 1 ? fr.y : 1.0 - fr.y);
    float dw = max(exp(-max(abs(aux.g - logD) - 0.25, 0.0) * 8.0), 1e-3);
    acc += c * (bw * dw);
    wsum += bw * dw;
  }
  vec4 p = acc / max(wsum, 1e-6);
  if (p.a > 0.9999) { outColor = scene; return; }
  vec3 rgb = scene.rgb * p.a + p.rgb;
  float flag = scene.a;
  if (scene.a < 0.0) {
    float tl = dot(scene.rgb, vec3(0.2126, 0.7152, 0.0722)) * p.a;
    flag = scene.a * tl / max(tl + dot(p.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-30);
  }
  outColor = vec4(rgb, flag);
}
`;

/** Plain copy (no cell on screen). */
export const STORM_COPY_FRAG = /* glsl */ `
in vec2 vUv;
layout(location = 0) out vec4 outColor;
uniform sampler2D uScene;
void main() { outColor = texture(uScene, vUv); }
`;
