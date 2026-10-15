// The Moon disc of the visible sky dome (package P1 of the night-sky plan owns this file).
//
// A sphere lit by the sun (so phase and terminator orientation are exact) with the Lommel-Seeliger law of
// lunar regolith, procedural maria, and earthshine on the dark side. Its uniforms are made and updated by
// ../moon.ts (MoonModel); uMoonAngularRadius is the APPARENT radius (any presentation scale included), which
// the star layer also reads to hide stars behind the disc.

export const MOON_GLSL = /* glsl */ `
uniform vec3 uMoonRadiance;
uniform float uMoonAngularRadius;

/** Earthshine on the unlit part of the moon, relative to full-moon radiance (~1e-4, Danjon). */
const float EARTHSHINE = 1.5e-4;

vec3 moonDisc(vec3 d, out float cover) {
  cover = 0.0;
  float c = dot(d, uMoonDir);
  if (c < 0.999) return vec3(0.0);
  vec3 ax = normalize(cross(uCelestialPole, uMoonDir));
  vec3 ay = cross(uMoonDir, ax);
  vec2 p = vec2(dot(d, ax), dot(d, ay)) / uMoonAngularRadius;
  float q = dot(p, p);
  float aa = uPixelAngle / uMoonAngularRadius;
  cover = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, sqrt(q));
  if (cover <= 0.0) return vec3(0.0);
  float mu = sqrt(max(0.0, 1.0 - q));
  vec3 n = ax * p.x + ay * p.y - uMoonDir * mu;
  float mu0 = dot(n, uSunDir);
  float lommelSeeliger = mu0 > 0.0 ? 2.0 * mu0 / (mu0 + mu) : 0.0;
  vec3 local = vec3(p, mu);
  float maria = smoothstep(0.42, 0.62, fbm(local * 2.2 + vec3(3.1, 7.7, 1.3)));
  float albedo = mix(1.12, 0.62, maria) * (0.85 + 0.3 * fbm(local * 14.0));
  return uMoonRadiance * albedo * (lommelSeeliger + EARTHSHINE) * cover;
}
`;
