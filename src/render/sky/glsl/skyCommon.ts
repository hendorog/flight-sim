// Shared GLSL of the visible sky dome's celestial modules (moon.ts, stars.ts, milkyWay.ts, planets.ts,
// nightSky.ts): the uniforms they all read and the hash / value-noise helpers. Included once, before them.
//
// Owned by the sky dome itself (see skyDome.ts); the modules add their own uniforms in their own chunks.

import { EXPOSURE_GLSL } from '../../post/AutoExposure';

export const SKY_COMMON_GLSL = /* glsl */ `
uniform vec3 uCelestialPole;
uniform mat3 uWorldToEquatorial;
uniform float uPixelAngle;
uniform float uNight;
uniform float uTime;
// The eye's current adaptation (post/AutoExposure.ts), shared through Atmosphere.exposureUniforms: lets a module
// place a radiance relative to what the display shows (sceneExposure()). uExposureValid is 0 until a
// PostPipeline has run (dev pages without post-processing, the first frame): then sceneExposure() is meaningless.
uniform float uExposureValid;
${EXPOSURE_GLSL}

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 random3(uvec3 v) { return vec3(pcg3d(v)) * (1.0 / 4294967295.0); }

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  uvec3 b = uvec3(ivec3(i) + 32768);
  float n000 = random3(b).x, n100 = random3(b + uvec3(1, 0, 0)).x;
  float n010 = random3(b + uvec3(0, 1, 0)).x, n110 = random3(b + uvec3(1, 1, 0)).x;
  float n001 = random3(b + uvec3(0, 0, 1)).x, n101 = random3(b + uvec3(1, 0, 1)).x;
  float n011 = random3(b + uvec3(0, 1, 1)).x, n111 = random3(b + uvec3(1, 1, 1)).x;
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * valueNoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.96875;
}
`;
