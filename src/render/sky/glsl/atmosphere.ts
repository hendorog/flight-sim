// GLSL for the atmosphere model (Hillaire 2020). Shared by the LUT passes, the sky dome, the ambient
// probe and the aerial-perspective froxels, so every one of them sees exactly the same atmosphere.
// Distances are in km with the planet centre at the origin and +y up; directions are three.js world
// directions (the flat-earth world maps onto the point directly above the planet centre).

import { SUN_ANGULAR_RADIUS } from '../params';

export const TRANSMITTANCE_LUT_SIZE = [256, 64] as const;
export const MULTISCATTER_LUT_SIZE = 32;
export const SKYVIEW_LUT_SIZE = [192, 108] as const;

const f = (v: number): string => v.toFixed(8);

export const ATMOSPHERE_GLSL = /* glsl */ `
#define ATMO_PI 3.14159265359
uniform float uRb;
uniform float uRt;
uniform vec3 uRayleighScat;
uniform float uRayleighH;
uniform vec3 uMieScat;
uniform vec3 uMieExt;
uniform float uMieH;
uniform float uMieG;
uniform vec3 uOzoneAbs;
uniform vec3 uGroundAlbedo;
uniform sampler2D tTransmittance;
uniform sampler2D tMultiScatter;

const vec2 TRANSMITTANCE_SIZE = vec2(${TRANSMITTANCE_LUT_SIZE[0]}.0, ${TRANSMITTANCE_LUT_SIZE[1]}.0);
const float MULTISCATTER_SIZE = ${MULTISCATTER_LUT_SIZE}.0;
const vec2 SKYVIEW_SIZE = vec2(${SKYVIEW_LUT_SIZE[0]}.0, ${SKYVIEW_LUT_SIZE[1]}.0);
const float SUN_ANGULAR_RADIUS = ${f(SUN_ANGULAR_RADIUS)};

// Map [0,1] onto texel centres and back, so LUT edges are sampled exactly (Bruneton 2017).
float unitToTexel(float x, float size) { return 0.5 / size + x * (1.0 - 1.0 / size); }
float texelToUnit(float u, float size) { return (u - 0.5 / size) / (1.0 - 1.0 / size); }

float distanceToTop(float r, float mu) {
  return max(0.0, -r * mu + sqrt(max(0.0, r * r * (mu * mu - 1.0) + uRt * uRt)));
}
float distanceToGround(float r, float mu) {
  return max(0.0, -r * mu - sqrt(max(0.0, r * r * (mu * mu - 1.0) + uRb * uRb)));
}
bool rayHitsGround(float r, float mu) {
  return mu < 0.0 && r * r * (mu * mu - 1.0) + uRb * uRb >= 0.0;
}

// Soft planet shadow: fraction of the light's disc above the geometric horizon seen from radius r.
float planetShadow(float r, float mu) {
  float sinHorizon = uRb / r;
  float muHorizon = -sqrt(max(0.0, 1.0 - sinHorizon * sinHorizon));
  return smoothstep(-SUN_ANGULAR_RADIUS, SUN_ANGULAR_RADIUS, (mu - muHorizon) / sinHorizon);
}

// Transmittance LUT parameterisation (Bruneton 2017, section 4): x = distance to the top of the
// atmosphere between its extremes for this r, y = distance to the horizon.
vec2 transmittanceUv(float r, float mu) {
  float H = sqrt(uRt * uRt - uRb * uRb);
  float rho = sqrt(max(0.0, r * r - uRb * uRb));
  float d = distanceToTop(r, mu);
  float dMin = uRt - r;
  float dMax = rho + H;
  return vec2(unitToTexel((d - dMin) / (dMax - dMin), TRANSMITTANCE_SIZE.x), unitToTexel(rho / H, TRANSMITTANCE_SIZE.y));
}
void transmittanceRMu(vec2 uv, out float r, out float mu) {
  float xMu = texelToUnit(uv.x, TRANSMITTANCE_SIZE.x);
  float xR = texelToUnit(uv.y, TRANSMITTANCE_SIZE.y);
  float H = sqrt(uRt * uRt - uRb * uRb);
  float rho = H * xR;
  r = sqrt(rho * rho + uRb * uRb);
  float dMin = uRt - r;
  float dMax = rho + H;
  float d = dMin + xMu * (dMax - dMin);
  mu = d == 0.0 ? 1.0 : clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
}

/** Transmittance from radius r to space along cos-zenith mu (ignores the planet; see planetShadow). */
vec3 transmittanceToTop(float r, float mu) {
  return texture2D(tTransmittance, transmittanceUv(r, mu)).rgb;
}

/** Hillaire's multiple-scattering transfer Psi_ms for unit illuminance. */
vec3 multiScatter(float r, float muLight) {
  vec2 uv = vec2(
    unitToTexel(muLight * 0.5 + 0.5, MULTISCATTER_SIZE),
    unitToTexel(clamp((r - uRb) / (uRt - uRb), 0.0, 1.0), MULTISCATTER_SIZE));
  return texture2D(tMultiScatter, uv).rgb;
}

void sampleMedium(float h, out vec3 scatR, out vec3 scatM, out vec3 extinction) {
  float dR = exp(-h / uRayleighH);
  float dM = exp(-h / uMieH);
  float dO = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
  scatR = uRayleighScat * dR;
  scatM = uMieScat * dM;
  extinction = scatR + uMieExt * dM + uOzoneAbs * dO;
}

float phaseRayleigh(float c) { return 3.0 / (16.0 * ATMO_PI) * (1.0 + c * c); }
// Cornette-Shanks phase function: Henyey-Greenstein with a physically better back-scatter lobe.
float phaseMie(float c) {
  float g = uMieG;
  float k = 3.0 / (8.0 * ATMO_PI) * (1.0 - g * g) / (2.0 + g * g);
  return k * (1.0 + c * c) / pow(max(1e-4, 1.0 + g * g - 2.0 * g * c), 1.5);
}

// Radiance scattered toward the viewer at point p by one light (direction l, illuminance e).
vec3 lightScattering(vec3 p, float r, vec3 rd, vec3 l, vec3 e, vec3 scatR, vec3 scatM) {
  float muL = dot(p, l) / r;
  float c = dot(rd, l);
  vec3 single = transmittanceToTop(r, muL) * planetShadow(r, muL) * (scatR * phaseRayleigh(c) + scatM * phaseMie(c));
  return e * (single + multiScatter(r, muL) * (scatR + scatM));
}

/**
 * In-scattered radiance (rgb) and mean transmittance (a) along the ray ro + t rd, t in [0, tMax] km,
 * for up to two lights (pass e1 = 0 to skip the second). Each segment is integrated analytically
 * assuming constant medium (Hillaire 2015, "Physically based and unified volumetric rendering").
 * Segments are spaced quadratically (segment k ends at tMax ((k+1)/steps)^2), as in the aerial
 * perspective's flat integration: in thick haze the radiance saturates within the first few hundred
 * metres, and uniform segments of tMax/steps (35 km toward the horizon) would take it from air far out
 * and high above the haze, lit by a far less attenuated sun (3x too bright at 800 m visibility).
 */
vec4 integrateScattering(vec3 ro, vec3 rd, float tMax, float steps, vec3 l0, vec3 e0, vec3 l1, vec3 e1) {
  vec3 radiance = vec3(0.0);
  vec3 throughput = vec3(1.0);
  bool second = dot(e1, e1) > 0.0;
  float tPrev = 0.0;
  for (float i = 0.0; i < steps; i += 1.0) {
    float u = (i + 1.0) / steps;
    float tNext = tMax * u * u;
    float dt = tNext - tPrev;
    vec3 p = ro + rd * (tPrev + 0.3 * dt);
    tPrev = tNext;
    float r = length(p);
    vec3 scatR, scatM, extinction;
    sampleMedium(r - uRb, scatR, scatM, extinction);
    vec3 s = lightScattering(p, r, rd, l0, e0, scatR, scatM);
    if (second) s += lightScattering(p, r, rd, l1, e1, scatR, scatM);
    vec3 stepT = exp(-extinction * dt);
    radiance += throughput * (s - s * stepT) / max(extinction, vec3(1e-9));
    throughput *= stepT;
  }
  return vec4(radiance, dot(throughput, vec3(1.0 / 3.0)));
}

// Sky-view LUT parameterisation (Hillaire 2020, section 5.3): u = azimuth from the light (denser near
// it), v = view zenith angle with resolution concentrated at the horizon, which dips with altitude.
vec2 skyViewUv(float r, float muView, float cosAzimuth) {
  float vHorizon = sqrt(max(0.0, r * r - uRb * uRb));
  float beta = acos(clamp(vHorizon / r, -1.0, 1.0));
  float zenithHorizon = ATMO_PI - beta;
  float viewZenith = acos(clamp(muView, -1.0, 1.0));
  float v;
  if (!rayHitsGround(r, muView)) {
    float c = clamp(viewZenith / zenithHorizon, 0.0, 1.0);
    v = 0.5 * (1.0 - sqrt(1.0 - c));
  } else {
    float c = clamp((viewZenith - zenithHorizon) / beta, 0.0, 1.0);
    v = 0.5 + 0.5 * sqrt(c);
  }
  float u = sqrt(clamp(-cosAzimuth * 0.5 + 0.5, 0.0, 1.0));
  return vec2(unitToTexel(u, SKYVIEW_SIZE.x), unitToTexel(v, SKYVIEW_SIZE.y));
}

/** Cosine of the horizontal angle between a view direction and a light direction (y up). */
float horizontalCosine(vec3 d, vec3 l) {
  vec2 a = d.xz;
  vec2 b = l.xz;
  float la = dot(a, a);
  float lb = dot(b, b);
  return la > 1e-10 && lb > 1e-10 ? dot(a, b) * inversesqrt(la * lb) : 1.0;
}
`;

/**
 * Sky radiance toward a direction from the two sky-view LUTs (sun-lit and moon-lit sky). The alpha
 * channel is the mean transmittance along the view ray (to the ground or to space).
 */
export const SKY_SAMPLING_GLSL = /* glsl */ `
uniform sampler2D tSkyViewSun;
uniform sampler2D tSkyViewMoon;
uniform float uCamR;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
vec4 skyViewRadiance(vec3 d) {
  vec4 s = texture2D(tSkyViewSun, skyViewUv(uCamR, d.y, horizontalCosine(d, uSunDir)));
  vec3 m = texture2D(tSkyViewMoon, skyViewUv(uCamR, d.y, horizontalCosine(d, uMoonDir))).rgb;
  return vec4(s.rgb + m, s.a);
}
`;
