// GLSL of the cumulonimbus cells (StormCellEffect.ts): the half-resolution march and the full-resolution composite.
//
// A cell (uniform arrays, at most STORM_MAX_CELLS, three.js world: x east, y up MSL, z south):
//   uCellA = (centre x, centre z, core radius R, anvil top)
//   uCellB = (base, intensity, anvil radius, rain-shaft radius)
//   uCellC = (anvil centre x, anvil centre z, bounding-cylinder centre x, z)
//   uCellR = bounding-cylinder radius
//   uCellW = (core share, anvil share, rain share, hail share): the cell's selection weight times its life cycle
//            (physics/weather/stormField.ts ActiveStorm; 1 for an explicit cell), multiplying each density
//   uCellH = (largest hailstone mm, hail extinction per mm/h, noise offset x, z)
// Density (cell-local noise coordinates: the cell's centre and its noise offset, so the turrets move with the cell;
// r the horizontal distance to the centre). The cloud reads the cumulus layer's noise volumes
// (render/clouds/noiseTextures.ts: the 128^3 Perlin-Worley shape, the 64^3 Worley detail, the 32^3 warp field)
// in the cumulus layer's way: a signed margin in metres inside an envelope, moved by large lobes and carved by
// the detail erosion, then a soft ramp to full density over an edge band.
//   core    envelope radius R (0.75 + 0.25 sin(pi h)) (1 + 0.6 smoothstep(0.7, 1, h)), h the height share from the
//           base to the anvil's underside. Lobes: the shape volume at STORM_LOBE_M (amplitude STORM_LOBE_SHARE R)
//           and STORM_TURRET_M (STORM_TURRET_AMP_M), each in its own rotated frame (STORM_ROT_A, STORM_ROT_B), the
//           domain warped by the warp field (STORM_WARP_M, STORM_WARP_AMP_M). Erosion: the detail volume at the
//           three periods of STORM_DETAIL_M, depth STORM_EROSION_SHARE of each period, inverted (cauliflower lobes)
//           above the base and plain (wisps) in its lowest STORM_RAGGED_M; each octave fades to its mean once the
//           pixel's footprint spans more than a few of its texels, so the mean surface stays where it is at every
//           distance. The base: lumped by the turret noise (STORM_BASE_LUMP_M), curving up toward the rim over the
//           outer STORM_BASE_ROUND_M of margin, a soft ramp of STORM_BASE_SOFT_M; scud below it (STORM_SCUD_DEPTH_M).
//           Extinction STORM_CORE_SIGMA.
//   anvil   a disc of the anvil radius around the anvil centre (moved downwind) from (top - STORM_ANVIL_DEPTH_M),
//           its underside rising 900 m toward the edge and lumped by the shape volume, to the top, raised by
//           STORM_OVERSHOOT_M over the updraft (the overshooting top); flattened lobes and a horizontally stretched
//           detail octave (fibres). Extinction STORM_ANVIL_SIGMA.
//   rain and hail  physics/weather/stormPrecip.ts STORM_PRECIP_GLSL (the field the local precipitation sample reads),
//           extinction STORM_SHAFT_SIGMA for the rain and stormPrecip hailSigmaPerMmH for the hail.
// Edge band: max(STORM_EDGE_M, STORM_EDGE_PX x the pixel's footprint): crisp up close, prefiltered far away.
// The march covers each cell's bounding cylinder (ground to top + STORM_TOP_MARGIN_M), clipped by the scene depth;
// the cylinders' ray intervals are sorted and merged, and the ray skips the gaps between them. Each step's sample
// lies at a jittered fraction of the step (the blue-noise texture plus a golden-ratio offset per frame, and a Halton
// sub-pixel offset of the ray), its step clipped to the interval's end and, in rain, to an optical depth of
// STORM_RAIN_STEP_TAU at the last sample's rain extinction (the medium about a camera inside the shaft is resolved
// from the camera on). It takes coarse steps until the cloud's optical depth over one step exceeds 0.3, then bisects
// for the entry on the coarse density (STORM_BISECT steps) and continues with fine steps (STORM_FINE_BAND of the edge
// band), lengthened by 1.6 per empty fine step and back to coarse after five. Light per sample: the sun at the sample's altitude (uSunBase .. uSunTop interpolated, from the
// shared Atmosphere on the CPU) through two coarse-density taps toward the sun (STORM_TAP_NEAR_M, STORM_TAP_FAR_M)
// and, beyond them, the analytic core columns and anvils (STORM_SHADOW_GLSL), single-scattered with the clouds'
// dual-lobe Henyey-Greenstein phase plus a multiple-scattering term (the cumulus march's STORM_MS_ISO terms for the
// cloud, exp(-STORM_MS_K tau) for the rain); the sky ambient through the analytic column above the sample (the dark
// base), STORM_SIDE_SKY of the horizon radiance from the sides, and ground bounce through the column below, from
// ground that lies in the cells' shadow and, under their cloud, sees STORM_GROUND_SKY_UNDER of the sky. Albedo 0.99
// for cloud and STORM_RAIN_ALBEDO for rain. Haze between the camera and the storm's front: the shared
// aerial-perspective volume, or an exponential haze without it (as VolcanoPlumeEffect).
// The sunlit share of that haze (STORM_HAZE_SUN_SHARE) is dimmed by the cells' shadow at four points along the path.
// Cost per pixel of the march (low resolution): at most STORM_STEPS steps plus STORM_BISECT bisection samples per
// entry. Texture reads per cell a sample touches: the warp field once per sample; the core 2 shape reads and up to 3
// detail reads (1 more below the base for the scud), the anvil 1 shape and up to 2 detail reads; each of the two sun
// taps 2 shape reads per core and 1 per anvil (no detail); a bisection sample as a tap. A lit sample in one cell's
// core: 1 + 5 + 4 = 10 reads; an empty sample outside every envelope: 1. Before this change (one 32^3 noise
// texture): 2 reads per density, 6 per lit sample. Extra ALU per lit sample: two stormColumn and two stormShadowTau
// loops over the cells (each cell four ray-cylinder chords) and the rain field's 12 lattice hashes per cell near a
// shaft; per pixel, four more stormShadowTau loops for the haze. The temporal pass (StormCellEffect) adds 18 reads
// per low-resolution pixel.

import { DEPTH_GLSL } from '../../core/shaderLib';
import { STORM_ANVIL_DEPTH_M, STORM_PRECIP_GLSL, STORM_SHAFT_SIGMA, STORM_VIRGA_DEPTH_M } from '../../physics/weather/stormPrecip';
import { BLUE_NOISE_SIZE } from '../clouds/blueNoise';
import { AERIAL_ATLAS_GLSL } from '../post/AerialPerspectiveEffect';

export { STORM_ANVIL_DEPTH_M, STORM_SHAFT_SIGMA, STORM_VIRGA_DEPTH_M };

/** Cells the shader reads. */
export const STORM_MAX_CELLS = 6;
/** March steps per pixel (the shader's main loop; tests/render/stormCells.test.ts caps it at 56). */
export const STORM_STEPS = 48;
/** Bisection samples that locate a dense entry after a coarse step (the march's cost bound adds them per entry). */
export const STORM_BISECT = 4;
/** Share of STORM_STEPS the coarse steps would take to cover every interval (the rest is for fine steps). */
export const STORM_COARSE_SHARE = 0.5;
/** Extinction of the full-density core and anvil, 1/m. Unconfirmed: tuning values, no source checked. */
export const STORM_CORE_SIGMA = 0.08;
export const STORM_ANVIL_SIGMA = 0.05;
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
 * Shadow columns (STORM_SHADOW_GLSL): the core as a vertical column of the biweight profile (1 - (rho / r)^2)^2 out to
 * r = STORM_SHADOW_CORE_R R, from the base to STORM_SHADOW_CORE_TOP_M above the anvil's underside, at
 * STORM_SHADOW_CORE_FILL of the core's extinction on its axis. The core's visible surface lies at 0.7 to 1 R, so the
 * column stays inside it: a larger radius shadowed the sunlit flanks from within (measured with 1 R: the tower's
 * sunlit side at 216 instead of 813 scene units, dev/weather.html, 2026-10-20). The anvil as a column of the same
 * profile out to STORM_SHADOW_ANVIL_R times its radius, from STORM_SHADOW_ANVIL_LIFT_M above its underside at the
 * centre (the underside rises 900 m toward the edge) to the top, at STORM_SHADOW_ANVIL_FILL of its extinction. The
 * profile falls smoothly to 0 at its edge (two nested cylinders before 2026-10-20: their rims showed as arcs in the
 * haze and the ground light from inside a cell). Unconfirmed: fits to the density.
 */
export const STORM_SHADOW_CORE_R = 0.7;
export const STORM_SHADOW_CORE_TOP_M = 250;
export const STORM_SHADOW_CORE_FILL = 0.8;
export const STORM_SHADOW_ANVIL_LIFT_M = 300;
export const STORM_SHADOW_ANVIL_FILL = 0.75;
export const STORM_SHADOW_ANVIL_R = 1;
/**
 * Share of the haze's in-scatter in front of a cell that is direct sunlight, dimmed where the path lies in the cells'
 * shadow (the rest, sky light scattered by the air, is left). Measured before it (dev/weather.html, Thunderstorm at
 * 15:00, the cell 22 km west, 2026-10-20): the haze transmittance in front of the base 0.38 to 0.40 and the haze 85 %
 * of the base pixel's radiance. Unconfirmed: a look value.
 */
export const STORM_HAZE_SUN_SHARE = 0.8;
/**
 * Optical depths at which the march records the distance along the ray (the storm layer's aux b and a): the
 * cumulus march models the storm's optical depth in front of a distance t as the line through these two points,
 * at most the ray's total (stormTauAt in render/clouds/marchShader.ts), dims the cumulus there by exp(-tau), and
 * ends where tau reaches STORM_STOP_TAU. Unconfirmed: a model chosen for this.
 */
export const STORM_TAU_A = 0.1;
export const STORM_TAU_B = 1;
export const STORM_STOP_TAU = 4.6;
/** Diffuse transmission of a column of optical depth tau: 1 / (1 + STORM_DIFFUSE_K tau). Unconfirmed: a look value. */
export const STORM_DIFFUSE_K = 0.11;
/** Albedo of the rain shaft (darker grey than the cloud). Unconfirmed: a look value. */
export const STORM_RAIN_ALBEDO = 0.55;
/** The turrets' rise speed through the cell, m/s. Unconfirmed: a look value. */
export const STORM_RISE_MS = 3;
/**
 * Cloud shape (header). Periods of the noise volumes' tiles, m, and amplitudes. Unconfirmed: look values set on
 * dev/weather.html.
 */
export const STORM_LOBE_M = 5200;
export const STORM_LOBE_SHARE = 0.22;
export const STORM_TURRET_M = 1700;
export const STORM_TURRET_AMP_M = 260;
export const STORM_WARP_M = 4100;
export const STORM_WARP_AMP_M = 350;
export const STORM_DETAIL_M: readonly number[] = [880, 230, 61];
export const STORM_EROSION_SHARE = 0.12;
export const STORM_RAGGED_M = 160;
export const STORM_BASE_LUMP_M = 90;
export const STORM_BASE_ROUND_M = 500;
export const STORM_BASE_SOFT_M = 70;
export const STORM_SCUD_DEPTH_M = 380;
export const STORM_SCUD_M = 520;
export const STORM_OVERSHOOT_M = 700;
/** Height of the bounding cylinders above the anvil top (the overshooting dome), m. */
export const STORM_TOP_MARGIN_M = STORM_OVERSHOOT_M + 100;
/** Edge band of the density ramp: at least STORM_EDGE_M, and STORM_EDGE_PX low-resolution pixel footprints. */
export const STORM_EDGE_M = 50;
export const STORM_EDGE_PX = 2.5;
/** An octave of the detail fades to its mean between these footprints, in its texels. */
export const STORM_OCTAVE_FADE: readonly [number, number] = [1.5, 4];
/** Largest optical depth of one step in rain (at the last sample's extinction). */
export const STORM_RAIN_STEP_TAU = 0.5;
/** Fine steps in cloud: STORM_FINE_BAND of the edge band, at least STORM_FINE_MIN_M, m. */
export const STORM_FINE_BAND = 0.15;
export const STORM_FINE_MIN_M = 8;
/** Erosion of the coarse density the sun taps read, in means of the detail erosion (gCoarseErosion). */
export const STORM_TAP_EROSION = 2;
/** The sun taps' distances, m. */
export const STORM_TAP_NEAR_M = 120;
export const STORM_TAP_FAR_M = 450;

/** Column-major GLSL mat3 of the rotation by `deg` about the unit axis (x, y, z). */
function rotation(x: number, y: number, z: number, deg: number): string {
  const n = Math.hypot(x, y, z);
  x /= n;
  y /= n;
  z /= n;
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  const m = [t * x * x + c, t * x * y + s * z, t * x * z - s * y, t * x * y - s * z, t * y * y + c, t * y * z + s * x, t * x * z + s * y, t * y * z - s * x, t * z * z + c];
  return `mat3(${m.map((v) => v.toFixed(6)).join(', ')})`;
}
/** The rotated frames of the lobe and turret octaves (each tiling lattice at its own orientation). */
const STORM_ROT_A = rotation(0.31, 0.87, 0.38, 37);
const STORM_ROT_B = rotation(-0.62, 0.41, 0.67, 71);
const STORM_ROT_C = rotation(0.18, -0.52, 0.83, 53);

const f = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));

/**
 * Optical depth of the cells' core columns and anvils along a ray, for the shadows the cells cast on themselves,
 * on the ground below them (StormCellEffect) and on the cumulus (render/clouds/cloudModel.ts). stormColumnTau
 * integrates o + s d, s >= 0, d upward (d.y > 0), through one cell: centre c, core radius R, base, the anvil's
 * underside at its centre (anvilBot), the anvil's centre ac and radius aR, top = anvilBot + STORM_ANVIL_DEPTH_M,
 * and the extinctions sc (core) and sa (anvil) of the full-density cloud times the cell's shares.
 */
export const STORM_SHADOW_GLSL = /* glsl */ `
// Integral of the biweight column profile (1 - rho^2 / r^2)^2 (rho the horizontal distance to c, 0 beyond r) along
// o + s d, s >= 0, between altitudes y0 and y1: smooth at the column's edge, so its shadow has no rim.
float stormChord(vec3 o, vec3 d, vec2 c, float r, float y0, float y1) {
  float dy = max(d.y, 1e-3);
  float s0 = max((y0 - o.y) / dy, 0.0), s1 = (y1 - o.y) / dy;
  if (s1 <= s0) return 0.0;
  vec2 oc = o.xz - c;
  float a = dot(d.xz, d.xz);
  float k = dot(oc, oc);
  float ir2 = 1.0 / (r * r);
  if (a < 1e-8) {
    float v = max(1.0 - k * ir2, 0.0);
    return v * v * (s1 - s0);
  }
  float b = dot(oc, d.xz);
  float sm = -b / a;
  float A = 1.0 - max(k - b * b / a, 0.0) * ir2;
  if (A <= 0.0) return 0.0;
  float um = sqrt(A / (a * ir2));
  float u0 = clamp(s0 - sm, -um, um), u1 = clamp(s1 - sm, -um, um);
  if (u1 <= u0) return 0.0;
  float c3 = 2.0 * A * a * ir2 / 3.0, c5 = a * a * ir2 * ir2 / 5.0;
  return (A * A * u1 - c3 * u1 * u1 * u1 + c5 * u1 * u1 * u1 * u1 * u1) - (A * A * u0 - c3 * u0 * u0 * u0 + c5 * u0 * u0 * u0 * u0 * u0);
}
float stormColumnTau(vec3 o, vec3 d, vec2 c, float R, float base, float anvilBot, vec2 ac, float aR, float sc, float sa) {
  float tau = 0.0;
  if (sc > 0.0) {
    float y1 = anvilBot + ${f(STORM_SHADOW_CORE_TOP_M)};
    tau += sc * ${f(STORM_SHADOW_CORE_FILL)} * stormChord(o, d, c, ${f(STORM_SHADOW_CORE_R)} * R, base, y1);
  }
  if (sa > 0.0) {
    float y0 = anvilBot + ${f(STORM_SHADOW_ANVIL_LIFT_M)}, y1 = anvilBot + ${f(STORM_ANVIL_DEPTH_M)};
    tau += sa * ${f(STORM_SHADOW_ANVIL_FILL)} * stormChord(o, d, ac, ${f(STORM_SHADOW_ANVIL_R)} * aR, y0, y1);
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
uniform highp sampler3D uShapeTex;
uniform highp sampler3D uDetailTex;
uniform highp sampler3D uWarpTex;
uniform sampler2D uBlueNoise;
uniform float uJitter;         // per-frame golden-ratio offset added to the blue noise
uniform vec2 uPixelJitter;     // per-frame sub-pixel offset of the ray, low-resolution pixels
uniform vec2 uLowSize;
uniform float uPixelAngle;     // rad per low-resolution pixel
uniform float uAerialOn;
uniform vec2 uHaze;
uniform vec3 uHazeColor;
uniform float uTime;
uniform float uNearClip;

uniform vec4 uCellA[${STORM_MAX_CELLS}];
uniform vec4 uCellB[${STORM_MAX_CELLS}];
uniform vec4 uCellC[${STORM_MAX_CELLS}];
uniform float uCellR[${STORM_MAX_CELLS}];
uniform vec4 uCellW[${STORM_MAX_CELLS}];
uniform vec4 uCellH[${STORM_MAX_CELLS}];
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
const mat3 STORM_ROT_A = ${STORM_ROT_A};
const mat3 STORM_ROT_B = ${STORM_ROT_B};
const mat3 STORM_ROT_C = ${STORM_ROT_C};
const float DETAIL_P0 = ${f(STORM_DETAIL_M[0])};
const float DETAIL_P1 = ${f(STORM_DETAIL_M[1])};
const float DETAIL_P2 = ${f(STORM_DETAIL_M[2])};

${STORM_PRECIP_GLSL}

float stormHg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * STORM_PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

float stormDiffuse(float tau) { return 1.0 / (1.0 + ${f(STORM_DIFFUSE_K)} * tau); }

// The footprint of a low-resolution pixel at the sample being shaded, m (set per sample by the march).
float gFoot = 1.0;
// The coarse density's erosion, in means of the detail erosion: 0 for the bisection (the outermost surface the
// eroded cloud can have, so the entry is never missed), STORM_TAP_EROSION for the sun taps (they start outside the
// lobes' eroded surface and measure the lobes shading each other, not the erosion's creases).
float gCoarseErosion = 0.0;

// Mip level of a volume of period P (m) and N texels at the current footprint.
float stormLod(float P, float N) { return max(log2(max(gFoot * N / P, 1.0)), 0.0); }

// Weight of a detail octave of period P (64^3 texels): 1 while the footprint spans few of its texels, then 0.
float octaveWeight(float P) { return 1.0 - smoothstep(${f(STORM_OCTAVE_FADE[0])}, ${f(STORM_OCTAVE_FADE[1])}, gFoot * 64.0 / P); }

// The detail erosion at q (cell-local), m of margin: each octave carves STORM_EROSION_SHARE of its period, its mean
// (half of that) always taken; ragged 0..1 mixes the inverted field (creases between lobes) toward the plain one (wisps).
float stormErosion(vec3 q, float ragged, float scale) {
  float e = 0.0;
  float w0 = octaveWeight(DETAIL_P0), w1 = octaveWeight(DETAIL_P1), w2 = octaveWeight(DETAIL_P2);
  e += DETAIL_P0 * 0.5;
  if (w0 > 0.0) {
    float d = smoothstep(0.1, 0.9, textureLod(uDetailTex, STORM_ROT_B * q / DETAIL_P0, stormLod(DETAIL_P0, 64.0)).r);
    e += DETAIL_P0 * w0 * (mix(1.0 - d, d, ragged) - 0.5);
  }
  e += DETAIL_P1 * 0.5;
  if (w1 > 0.0) {
    float d = smoothstep(0.1, 0.9, textureLod(uDetailTex, STORM_ROT_C * q / DETAIL_P1 + 0.31, stormLod(DETAIL_P1, 64.0)).r);
    e += DETAIL_P1 * w1 * (mix(1.0 - d, d, ragged) - 0.5);
  }
  e += DETAIL_P2 * 0.5;
  if (w2 > 0.0) {
    float d = smoothstep(0.1, 0.9, textureLod(uDetailTex, STORM_ROT_A * q / DETAIL_P2 + 0.57, stormLod(DETAIL_P2, 64.0)).r);
    e += DETAIL_P2 * w2 * (mix(1.0 - d, d, ragged) - 0.5);
  }
  return e * ${f(STORM_EROSION_SHARE)} * scale;
}

float stormBand() { return max(${f(STORM_EDGE_M)}, ${f(STORM_EDGE_PX)} * gFoot); }

// Cloud densities of one cell at p (warp: the warp field at p, -1..1): x core (and scud), y anvil. full: the detail
// erosion, the anvil's fibres and the scud (the view samples); without it the mean erosion (sun taps, bisection).
vec2 cellCloud(int i, vec3 p, vec3 warp, bool full) {
  vec4 A = uCellA[i];
  vec4 B = uCellB[i];
  vec4 C = uCellC[i];
  vec4 W = uCellW[i];
  vec4 H = uCellH[i];
  float R = A.z, top = A.w, base = B.x;
  float r = length(p.xz - A.xy);
  float anvilBot = top - ${f(STORM_ANVIL_DEPTH_M)};
  vec3 q = vec3(p.x - A.x + H.z, p.y, p.z - A.y + H.w) + warp * ${f(STORM_WARP_AMP_M)};
  float band = stormBand();
  vec2 dens = vec2(0.0);
  // Core: the envelope's margin in metres, moved by the lobes and turrets (rising through the cell).
  if (W.x > 0.0 && p.y < anvilBot + 400.0 && p.y > base - ${f(STORM_SCUD_DEPTH_M)} && r < 1.95 * R) {
    float h = clamp((p.y - base) / max(anvilBot - base, 1.0), 0.0, 1.0);
    float Rh = R * (0.75 + 0.25 * sin(STORM_PI * h)) * (1.0 + 0.6 * smoothstep(0.7, 1.0, h));
    vec3 qr = q - vec3(0.0, uTime * ${f(STORM_RISE_MS)}, 0.0);
    float n1 = textureLod(uShapeTex, STORM_ROT_A * qr / ${f(STORM_LOBE_M)}, stormLod(${f(STORM_LOBE_M)}, 128.0)).r;
    float n2 = textureLod(uShapeTex, STORM_ROT_B * qr / ${f(STORM_TURRET_M)} + 0.43, stormLod(${f(STORM_TURRET_M)}, 128.0)).r;
    float m = Rh - r + ${f(STORM_LOBE_SHARE)} * R * (2.0 * n1 - 1.0) + ${f(STORM_TURRET_AMP_M)} * (2.0 * n2 - 1.0);
    // The base: lumped, rising toward the rim (rounded, not a cut edge), with a soft ramp.
    float baseL = base + ${f(STORM_BASE_LUMP_M)} * (2.0 * n2 - 1.0) + 0.5 * ${f(STORM_BASE_ROUND_M)} * pow(1.0 - smoothstep(0.0, ${f(STORM_BASE_ROUND_M)}, m), 2.0);
    float above = p.y - baseL;
    float vert = smoothstep(-${f(STORM_BASE_SOFT_M)}, ${f(STORM_BASE_SOFT_M)}, above) * (1.0 - smoothstep(anvilBot + 100.0, anvilBot + 400.0, p.y));
    float ragged = 1.0 - smoothstep(0.0, ${f(STORM_RAGGED_M)}, above);
    float meanErosion = ${f(0.5 * STORM_EROSION_SHARE * (STORM_DETAIL_M[0] + STORM_DETAIL_M[1] + STORM_DETAIL_M[2]))};
    float reach = 2.0 * meanErosion + band;
    if (m > 0.0 && vert > 0.0) {
      float mm = m;
      if (full) mm -= m < reach ? stormErosion(qr, ragged, 1.0 + 0.5 * ragged) : meanErosion;
      else mm -= gCoarseErosion * meanErosion;
      dens.x = smoothstep(0.0, band, mm) * vert;
    }
    // Scud: ragged fragments hanging below the base under the core, sparser further down.
    if (full && above < ${f(STORM_BASE_SOFT_M)} && r < 0.85 * R) {
      float s = smoothstep(base - ${f(STORM_SCUD_DEPTH_M)}, base, p.y);
      float th = mix(0.86, 0.5, s);
      float sc = textureLod(uDetailTex, STORM_ROT_C * qr / ${f(STORM_SCUD_M)} + 0.19, stormLod(${f(STORM_SCUD_M)}, 64.0)).r;
      float soft = max(0.06, gFoot / 400.0);
      dens.x = max(dens.x, 0.6 * smoothstep(th, th + soft, sc) * smoothstep(0.85 * R, 0.45 * R, r) * s);
    }
    dens.x *= W.x;
  }
  // Anvil: thickest over its centre, its underside rising toward the edge, the overshooting top over the updraft.
  if (W.y > 0.0 && p.y > anvilBot - 200.0) {
    float ra = length(p.xz - C.xy);
    float aR = B.z;
    float e = clamp(ra / max(aR, 1.0), 0.0, 1.0);
    vec3 qa = vec3(q.x, q.y * 3.0, q.z);
    float na = textureLod(uShapeTex, STORM_ROT_C * qa / ${f(STORM_LOBE_M)} + 0.71, stormLod(${f(STORM_LOBE_M)} / 3.0, 128.0)).r;
    float ma = aR - ra + 0.15 * aR * (2.0 * na - 1.0);
    float bot = anvilBot + 900.0 * e * e + 180.0 * (2.0 * na - 1.0);
    float topL = top + ${f(STORM_OVERSHOOT_M)} * W.x * pow(1.0 - smoothstep(0.0, 0.7 * R, r), 2.0);
    float bandA = max(0.06 * aR, band);
    float a = smoothstep(0.0, bandA, ma) * smoothstep(bot, bot + 150.0, p.y) * (1.0 - smoothstep(topL - 200.0, topL, p.y));
    if (a > 0.0) {
      a *= 0.55 + 0.45 * na;
      if (full) {
        // Fibres: the detail stretched along the anvil's spread, thinning the underside and the edge into streaks.
        float w0 = octaveWeight(DETAIL_P0);
        float fib = 0.5;
        if (w0 > 0.0) fib = mix(0.5, smoothstep(0.15, 0.85, textureLod(uDetailTex, vec3(q.x, q.y * 6.0, q.z) / (2.0 * DETAIL_P0), stormLod(DETAIL_P0, 64.0)).r), w0);
        float w1 = octaveWeight(DETAIL_P1);
        if (w1 > 0.0) fib = mix(fib, 0.6 * fib + 0.4 * textureLod(uDetailTex, vec3(q.z, q.y * 5.0, q.x) / (2.0 * DETAIL_P1) + 0.37, stormLod(DETAIL_P1, 64.0)).r, w1);
        a *= mix(1.0, 0.35 + 0.65 * fib * 2.0, 0.6) * (1.0 - 0.4 * smoothstep(0.6, 1.0, e) * (1.0 - fib));
      }
      dens.y = min(a, 1.0) * W.y;
    }
  }
  return dens;
}

vec3 stormWarpAt(vec3 p) { return textureLod(uWarpTex, p / ${f(STORM_WARP_M)}, 0.0).rgb * 2.0 - 1.0; }

// Extinction at p, 1/m, and the rain's share of it.
float stormSigma(vec3 p, vec3 warp, bool full, out float rainShare) {
  vec2 cloud = vec2(0.0);
  float rain = 0.0;
  for (int i = 0; i < ${STORM_MAX_CELLS}; i++) {
    if (i >= uCount) break;
    vec2 bc = p.xz - uCellC[i].zw;
    if (dot(bc, bc) > uCellR[i] * uCellR[i]) continue;
    cloud += cellCloud(i, p, warp, full);
    vec2 pr = stormPrecipCell(i, p);
    rain += pr.x * ${f(STORM_SHAFT_SIGMA)} + pr.y * uCellH[i].y;
  }
  float c = cloud.x * ${f(STORM_CORE_SIGMA)} + cloud.y * ${f(STORM_ANVIL_SIGMA)};
  float s = c + rain;
  rainShare = s > 0.0 ? rain / s : 0.0;
  return s;
}

float stormSigmaCoarse(vec3 p, vec3 warp) { float r; return stormSigma(p, warp, false, r); }

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
  float y0 = uGroundY, y1 = uCellA[i].w + ${f(STORM_TOP_MARGIN_M)};
  if (abs(d.y) > 1e-8) {
    float ta = (y0 - o.y) / d.y, tb = (y1 - o.y) / d.y;
    t = vec2(max(t.x, min(ta, tb)), min(t.y, max(ta, tb)));
  } else if (o.y < y0 || o.y > y1) {
    return vec2(1.0, 0.0);
  }
  return t;
}

void main() {
  // The ray is jittered across the pixel's footprint every frame (the temporal pass integrates it).
  vec2 rayUv = vUv + uPixelJitter / uLowSize;
  vec3 dv = rayDirView(rayUv);
  vec3 dir = normalize(mat3(uCamWorld) * dv);
  float dd = texture(uDepth, vUv).r;
  float sceneDist = isSky(dd) ? 1e8 : viewZFromDepth(dd) / max(-dv.z, 1e-4);
  outAux = vec4(log2(1.0 + 1e8), log2(1.0 + sceneDist), log2(1.0 + 1e8), log2(1.0 + 1e8));
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

  // Blue-noise sample position within each step (Ulichney void-and-cluster, render/clouds/blueNoise.ts) with a
  // golden-ratio offset per frame: the error is high-frequency, which the temporal pass averages away.
  float jitter = fract(texelFetch(uBlueNoise, ivec2(gl_FragCoord.xy) & ${BLUE_NOISE_SIZE - 1}, 0).r + uJitter);
  float coarse = max(total / (${STORM_STEPS}.0 * ${f(STORM_COARSE_SHARE)}), 20.0);
  float fineStep = 20.0, fineBase = 20.0, rainSigma = 0.0;
  float cosSun = dot(dir, uSunDir);
  float phase = mix(stormHg(cosSun, 0.8), stormHg(cosSun, -0.25), 0.35);
  float rainPhase = mix(stormHg(cosSun, 0.5), 1.0 / (4.0 * STORM_PI), 0.5);
  vec3 sunL = normalize(uSunDir);
  vec3 L = vec3(0.0);
  float T = 1.0;
  float dA = 1e8, dB = 1e8;
  float dsum = 0.0, wsum = 0.0;
  int k = 0;
  // s0: the start of the current step; each step's sample lies at s0 + jitter x its length.
  float s0 = iv[0].x;
  {
    // The rain at the ray's start sets the first step (a camera inside the shaft).
    vec3 p0 = uCamPos + dir * s0;
    gFoot = s0 * uPixelAngle;
    float rs0;
    float s = stormSigma(p0, stormWarpAt(p0), false, rs0);
    rainSigma = s * rs0;
  }
  bool fine = false;
  int empty = 0;
  for (int i = 0; i < ${STORM_STEPS}; i++) {
    while (k < n && s0 >= iv[k].y - 1e-3) {
      k++;
      if (k < n) s0 = max(s0, iv[k].x);
    }
    if (k >= n) break;
    // In rain the step is held to an optical depth of STORM_RAIN_STEP_TAU at the last sample's rain extinction.
    float dt = min(min(fine ? fineStep : coarse, ${f(STORM_RAIN_STEP_TAU)} / max(rainSigma, 1e-7)), iv[k].y - s0);
    float t = s0 + jitter * dt;
    vec3 p = uCamPos + dir * t;
    gFoot = t * uPixelAngle;
    vec3 warp = stormWarpAt(p);
    float rainShare;
    float sigma = stormSigma(p, warp, true, rainShare);
    rainSigma = sigma * rainShare;
    float cloudSigma = sigma - rainSigma;
    if (!fine && cloudSigma * dt > 0.3) {
      // Entering dense medium: find the entry on the coarse density between the step's start and the sample, and
      // continue finely from it.
      float lo = s0, hi = t;
      gCoarseErosion = 0.0;
      for (int b = 0; b < ${STORM_BISECT}; b++) {
        float mid = 0.5 * (lo + hi);
        vec3 pm = uCamPos + dir * mid;
        gFoot = mid * uPixelAngle;
        float rs;
        float sm = stormSigma(pm, stormWarpAt(pm), false, rs);
        if (sm * (1.0 - rs) * dt > 0.03) hi = mid; else lo = mid;
      }
      fine = true;
      empty = 0;
      gFoot = t * uPixelAngle;
      fineBase = max(${f(STORM_FINE_BAND)} * stormBand(), ${f(STORM_FINE_MIN_M)});
      fineStep = fineBase;
      s0 = max(lo - stormBand(), s0);
      continue;
    }
    if (fine) {
      // Empty fine steps lengthen (the erosion leaves clear air inside the coarse density's entry), up to a quarter
      // of the coarse step; a dense one returns to the base length.
      bool none = cloudSigma * dt < 1e-3;
      empty = none ? empty + 1 : 0;
      fineStep = none ? min(fineStep * 1.6, max(0.25 * coarse, fineBase)) : fineBase;
      if (empty >= 5) fine = false;
    }
    if (sigma > 1e-6) {
      // Toward the sun: two coarse-density taps (the turrets shading each other), then the analytic core columns and
      // anvils beyond them, so the rain under the core and the base lie in the shadow of the cloud above them.
      vec3 p1 = p + sunL * ${f(STORM_TAP_NEAR_M)};
      vec3 p2 = p + sunL * ${f(STORM_TAP_FAR_M)};
      gCoarseErosion = ${f(STORM_TAP_EROSION)};
      float tauSun = stormSigmaCoarse(p1, warp) * ${f(STORM_TAP_NEAR_M)} + stormSigmaCoarse(p2, warp) * ${f(STORM_TAP_FAR_M - STORM_TAP_NEAR_M)} + stormShadowTau(p2, sunL);
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
      // Where the optical depth from the camera crosses STORM_TAU_A and STORM_TAU_B (the cumulus march's model).
      float tau0 = -log(T), tau1 = tau0 + sigma * dt;
      if (tau0 <= ${f(STORM_TAU_A)} && tau1 > ${f(STORM_TAU_A)}) dA = s0 + (${f(STORM_TAU_A)} - tau0) / sigma;
      if (tau0 <= ${f(STORM_TAU_B)} && tau1 > ${f(STORM_TAU_B)}) dB = s0 + (${f(STORM_TAU_B)} - tau0) / sigma;
      T *= Ts;
      if (T < 0.01) break;
    }
    s0 += dt;
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
  outAux = vec4(log2(1.0 + front), log2(1.0 + sceneDist), log2(1.0 + dA), log2(1.0 + dB));
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
