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
// interpolated, from the shared Atmosphere on the CPU) through two density taps toward the sun, single-scattered
// with the clouds' dual-lobe Henyey-Greenstein phase plus a multiple-scattering term exp(-STORM_MS_K tau); the sky
// ambient through the analytic column above the sample (the dark base), and ground bounce through the column
// below. Albedo 0.99 for cloud and STORM_RAIN_ALBEDO for rain. Haze between the camera and the storm's front: the
// shared aerial-perspective volume, or an exponential haze without it (as VolcanoPlumeEffect).

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
/** Diffuse transmission of a column of optical depth tau: 1 / (1 + STORM_DIFFUSE_K tau). Unconfirmed: a look value. */
export const STORM_DIFFUSE_K = 0.11;
/** Albedo of the rain shaft (darker grey than the cloud). Unconfirmed: a look value. */
export const STORM_RAIN_ALBEDO = 0.55;
/** Noise periods, m (the 32^3 texture tiles), and the turrets' rise speed, m/s. */
export const STORM_NOISE_PERIOD_M = 5200;
export const STORM_NOISE_DETAIL_M = 900;
export const STORM_RISE_MS = 3;

const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));

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
uniform vec3 uGroundRadiance;
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
  outAux = vec4(log2(1.0 + 1e8), log2(1.0 + sceneDist), 0.0, 0.0);
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
      float tauSun = (stormSigma(p + sunL * 150.0) * 150.0 + stormSigma(p + sunL * 600.0) * 450.0);
      vec2 col = stormColumn(p);
      float hs = clamp((p.y - uSunSpan.x) / max(uSunSpan.y - uSunSpan.x, 1.0), 0.0, 1.0);
      vec3 sun = mix(uSunBase, uSunTop, hs);
      float ph = mix(phase, rainPhase, rainShare);
      vec3 S = sun * (ph * exp(-tauSun) + ${f(STORM_MS)} * exp(-${f(STORM_MS_K)} * tauSun) / (4.0 * STORM_PI))
             + uSkyColor * (0.85 * stormDiffuse(col.x)) + uGroundRadiance * (0.35 * stormDiffuse(col.y));
      S *= mix(0.99, ${f(STORM_RAIN_ALBEDO)}, rainShare);
      float Ts = exp(-sigma * dt);
      float a = T * (1.0 - Ts);
      L += S * a;
      dsum += t * a;
      wsum += a;
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
  L = min(L, vec3(uMaxRadiance));
  outColor = vec4(L * Th + inscatter * (1.0 - T), T);
  outAux = vec4(log2(1.0 + front), log2(1.0 + sceneDist), 0.0, 0.0);
}
`;

/**
 * Depth-aware upsample of the march (as VolcanoPlumeEffect) and the composite against the cumulus layer the clouds
 * drew before this effect (their reprojection layer: front distance and transmittance T_cu). With the storm's
 * front nearer than the cumulus front, out = in T_cb + L_cb; behind it, the cumulus already in `in` covers the
 * storm: out = in (1 - (1 - T_cb) T_cu) + L_cb T_cu. An approximation: one front per layer and pixel.
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
uniform sampler2D uCuDist;
uniform sampler2D uCuTrans;
uniform float uHasCu;
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
  float fsum = 0.0, fw = 0.0;
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    ivec2 q = clamp(i0 + o, ivec2(0), maxPx);
    vec4 aux = texelFetch(uAux, q, 0);
    vec4 c = logD < aux.r - 0.15 ? vec4(0.0, 0.0, 0.0, 1.0) : texelFetch(uStorm, q, 0);
    float bw = (o.x == 1 ? fr.x : 1.0 - fr.x) * (o.y == 1 ? fr.y : 1.0 - fr.y);
    float dw = max(exp(-max(abs(aux.g - logD) - 0.25, 0.0) * 8.0), 1e-3);
    acc += c * (bw * dw);
    wsum += bw * dw;
    float ow = (1.0 - c.a) * bw * dw;
    fsum += aux.r * ow;
    fw += ow;
  }
  vec4 p = acc / max(wsum, 1e-6);
  if (p.a > 0.9999) { outColor = scene; return; }
  float logFront = fw > 1e-6 ? fsum / fw : logD;
  float Tcu = 1.0;
  if (uHasCu > 0.5) {
    float cuFront = texture(uCuDist, vUv).r;
    float cuT = clamp(texture(uCuTrans, vUv).a, 0.0, 1.0);
    // The cumulus covers the storm only where its front is nearer (and in front of the surface).
    Tcu = cuFront < logFront && cuFront < logD ? cuT : 1.0;
  }
  float through = 1.0 - (1.0 - p.a) * Tcu;
  vec3 rgb = scene.rgb * through + p.rgb * Tcu;
  float flag = scene.a;
  if (scene.a < 0.0) {
    float tl = dot(scene.rgb, vec3(0.2126, 0.7152, 0.0722)) * through;
    flag = scene.a * tl / max(tl + dot(p.rgb * Tcu, vec3(0.2126, 0.7152, 0.0722)), 1e-30);
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
