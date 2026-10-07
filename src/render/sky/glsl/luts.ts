// Fragment shaders of the atmosphere lookup-table passes (Hillaire 2020). All are drawn with the
// full-screen triangle from post/FullscreenPass.ts, which provides vUv.

import { ATMOSPHERE_GLSL, SKY_SAMPLING_GLSL } from './atmosphere';

/** Transmittance to the top of the atmosphere as a function of (r, mu). */
export const TRANSMITTANCE_FRAG = /* glsl */ `
${ATMOSPHERE_GLSL}
varying vec2 vUv;
void main() {
  float r, mu;
  transmittanceRMu(vUv, r, mu);
  // Quadratically spaced segments, dense where the ray starts in the dense boundary-layer haze.
  const float STEPS = 40.0;
  float tMax = distanceToTop(r, mu);
  vec3 opticalDepth = vec3(0.0);
  float tPrev = 0.0;
  for (float i = 0.0; i < STEPS; i += 1.0) {
    float u = (i + 1.0) / STEPS;
    float tNext = tMax * u * u;
    float dt = tNext - tPrev;
    float t = tPrev + 0.5 * dt;
    tPrev = tNext;
    float h = sqrt(r * r + t * t + 2.0 * r * mu * t) - uRb;
    vec3 scatR, scatM, extinction;
    sampleMedium(h, scatR, scatM, extinction);
    opticalDepth += extinction * dt;
  }
  gl_FragColor = vec4(exp(-opticalDepth), 1.0);
}
`;

/**
 * Multiple-scattering transfer Psi_ms(r, mu_light) (Hillaire 2020, section 5.5): second-order
 * isotropic scattering L2 gathered over 64 directions, and the fraction f_ms re-scattered, summed as
 * the geometric series L2 / (1 - f_ms). Includes light bounced off the ground.
 */
export const MULTISCATTER_FRAG = /* glsl */ `
${ATMOSPHERE_GLSL}
varying vec2 vUv;
void main() {
  float muL = texelToUnit(vUv.x, MULTISCATTER_SIZE) * 2.0 - 1.0;
  float r = uRb + max(texelToUnit(vUv.y, MULTISCATTER_SIZE), 1e-4) * (uRt - uRb);
  vec3 ro = vec3(0.0, r, 0.0);
  vec3 l = vec3(sqrt(max(0.0, 1.0 - muL * muL)), muL, 0.0);
  const float ISOTROPIC = 1.0 / (4.0 * ATMO_PI);
  const float STEPS = 20.0;
  vec3 lum = vec3(0.0);
  vec3 fms = vec3(0.0);
  for (float i = 0.0; i < 8.0; i += 1.0) {
    for (float j = 0.0; j < 8.0; j += 1.0) {
      float cosT = 1.0 - 2.0 * (j + 0.5) / 8.0;
      float sinT = sqrt(1.0 - cosT * cosT);
      float phi = 2.0 * ATMO_PI * (i + 0.5) / 8.0;
      vec3 rd = vec3(sinT * cos(phi), cosT, sinT * sin(phi));
      bool ground = rayHitsGround(r, rd.y);
      float tMax = ground ? distanceToGround(r, rd.y) : distanceToTop(r, rd.y);
      vec3 throughput = vec3(1.0);
      float tPrev = 0.0;
      for (float k = 0.0; k < STEPS; k += 1.0) {
        float u = (k + 1.0) / STEPS;
        float tNext = tMax * u * u;
        float dt = tNext - tPrev;
        vec3 p = ro + rd * (tPrev + 0.3 * dt);
        tPrev = tNext;
        float pr = length(p);
        vec3 scatR, scatM, extinction;
        sampleMedium(pr - uRb, scatR, scatM, extinction);
        vec3 scat = scatR + scatM;
        float pMuL = dot(p, l) / pr;
        vec3 s = scat * transmittanceToTop(pr, pMuL) * planetShadow(pr, pMuL) * ISOTROPIC;
        vec3 stepT = exp(-extinction * dt);
        vec3 ext = max(extinction, vec3(1e-9));
        lum += throughput * (s - s * stepT) / ext;
        fms += throughput * (scat - scat * stepT) / ext;
        throughput *= stepT;
      }
      if (ground) {
        vec3 n = normalize(ro + rd * tMax);
        float nl = dot(n, l);
        lum += throughput * transmittanceToTop(uRb, nl) * max(nl, 0.0) * uGroundAlbedo / ATMO_PI;
      }
    }
  }
  lum /= 64.0;
  fms /= 64.0;
  gl_FragColor = vec4(lum / (1.0 - fms), 1.0);
}
`;

/** Sky radiance around the camera for one light, in the sky-view parameterisation. */
export const SKYVIEW_FRAG = /* glsl */ `
${ATMOSPHERE_GLSL}
uniform float uCamR;
uniform vec3 uLightDir;
uniform vec3 uLightE;
varying vec2 vUv;
void main() {
  float u = texelToUnit(vUv.x, SKYVIEW_SIZE.x);
  float v = texelToUnit(vUv.y, SKYVIEW_SIZE.y);
  float r = uCamR;
  float beta = acos(clamp(sqrt(max(0.0, r * r - uRb * uRb)) / r, -1.0, 1.0));
  float zenithHorizon = ATMO_PI - beta;
  float viewZenith = v < 0.5
    ? zenithHorizon * (1.0 - (1.0 - 2.0 * v) * (1.0 - 2.0 * v))
    : zenithHorizon + beta * (2.0 * v - 1.0) * (2.0 * v - 1.0);
  float cosAz = 1.0 - 2.0 * u * u;
  float sinZ = sin(viewZenith);
  vec3 rd = vec3(sinZ * cosAz, cos(viewZenith), sinZ * sqrt(max(0.0, 1.0 - cosAz * cosAz)));
  float muL = uLightDir.y;
  vec3 l = vec3(sqrt(max(0.0, 1.0 - muL * muL)), muL, 0.0);
  vec3 ro = vec3(0.0, r, 0.0);
  float tMax = rayHitsGround(r, rd.y) ? distanceToGround(r, rd.y) : distanceToTop(r, rd.y);
  gl_FragColor = integrateScattering(ro, rd, tMax, 32.0, l, uLightE, l, vec3(0.0));
}
`;

/**
 * Two-texel summary of the sky for the CPU: texel 0 = cosine-weighted upper-hemisphere radiance
 * (irradiance on an upward surface / PI), texel 1 = mean radiance of the horizontal ring (haze colour).
 */
export const SKY_SUMMARY_FRAG = /* glsl */ `
${ATMOSPHERE_GLSL}
${SKY_SAMPLING_GLSL}
varying vec2 vUv;
void main() {
  vec3 sum = vec3(0.0);
  if (vUv.x < 0.5) {
    const float NT = 8.0;
    const float NP = 16.0;
    for (float i = 0.0; i < NT; i += 1.0) {
      float theta = (i + 0.5) / NT * 0.5 * ATMO_PI;
      float w = cos(theta) * sin(theta) * (0.5 * ATMO_PI / NT) * (2.0 * ATMO_PI / NP) / ATMO_PI;
      for (float j = 0.0; j < NP; j += 1.0) {
        float phi = (j + 0.5) / NP * 2.0 * ATMO_PI;
        sum += w * skyViewRadiance(vec3(sin(theta) * cos(phi), cos(theta), sin(theta) * sin(phi))).rgb;
      }
    }
  } else {
    for (float j = 0.0; j < 16.0; j += 1.0) {
      float phi = (j + 0.5) / 16.0 * 2.0 * ATMO_PI;
      sum += skyViewRadiance(vec3(cos(phi), 0.0, sin(phi))).rgb / 16.0;
    }
  }
  gl_FragColor = vec4(sum, 1.0);
}
`;
