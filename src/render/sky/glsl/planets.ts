// Naked-eye planets in the sky dome (package P3 of the night-sky plan owns this file and ../planets.ts).
//
// planets() returns the radiance the planets add along the view direction `d` (world), at the top of the
// atmosphere (nightSky applies uStarGain; the dome applies the transmittance, so they redden and fade near the
// horizon like the stars). Each planet is a steady point (no scintillation: agent choice, the real naked-eye cue).
//
// Anti-aliasing: the point is placed in exact SCREEN pixels (the perspective projection of its direction and of the
// pixel's, through the camera's axes) and drawn with the cubic B-spline kernel, which is the pixel-box integral of
// a quadratic B-spline spot (a Gaussian-like profile of sigma 0.5 px): the weights of the pixels around a planet
// sum to exactly 1 at any sub-pixel position (partition of unity), the radiance is E * weight / (that pixel's solid
// angle), so its flux - and its brightness after bloom - does not change as it drifts, with zoom, or toward the
// edge of a wide view. The kernel is compact (2 px radius): a planet is up to ~1e5 times brighter than the adapted
// night sky, and a Gaussian's tails would saturate a wide blob. (The brief's sigma 0.6 Gaussian: agent deviation.)
// A planet over display white spreads (glsl/pointSpread.ts): the kernel is widened by s, weight k(o / s) / s^2, which
// still integrates to 1 (the pixel sums to within ~1 % for s > 1), so its flux is unchanged.

import { POINT_COLOUR_GAIN_MAX, POINT_SPREAD_GLSL, POINT_SPREAD_MAX } from './pointSpread';
import { SCOTOPIC_GLSL } from '../../post/ToneMap';

export const PLANETS_GLSL = /* glsl */ `
${POINT_SPREAD_GLSL}
${SCOTOPIC_GLSL}
// xyz: world direction (unit); w: illuminance at the top of the atmosphere, scene units (0 = skip).
uniform vec4 uPlanets[6];
uniform vec3 uPlanetColours[6];
// The camera's screen axes in world space (right, up); uPixelAngle is the pixel pitch in tangent units.
uniform vec3 uPlanetRight;
uniform vec3 uPlanetUp;

// Cubic B-spline: the box integral of the quadratic B-spline; sums to 1 over integer shifts.
float planetKernel(float x) {
  x = abs(x);
  if (x >= 2.0) return 0.0;
  if (x < 1.0) return (4.0 - 6.0 * x * x + 3.0 * x * x * x) / 6.0;
  float t = 2.0 - x;
  return t * t * t / 6.0;
}

// gain: the presentation gain nightSky() applies to the result (it sets the spread, not the radiance).
vec3 planets(vec3 d, float airmass, float gain) {
  float pa = uPixelAngle;
  // Pixels are at most pa across (on the axis): (2 s + 1) pa covers the kernel's 2 s px radius everywhere, at the
  // widest spread. Tested on the difference vector (|p - d|^2 ~ angle^2, full float precision; a cosine next to 1.0
  // would round away at narrow fields of view). Almost every sky pixel stops at these six tests.
  const float R_MAX = ${(2 * POINT_SPREAD_MAX + 1).toFixed(4)};
  float r2Max = R_MAX * R_MAX * pa * pa;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    vec4 p = uPlanets[i];
    vec3 t = p.xyz - d;
    if (p.w <= 0.0 || dot(t, t) > r2Max) continue;
    vec3 fwd = cross(uPlanetUp, uPlanetRight);
    float cd = dot(d, fwd);
    float cp = dot(p.xyz, fwd);
    if (cd <= 0.05 || cp <= 0.05) continue;
    // Screen offset of the planet from this pixel, px (perspective projection through the camera's axes).
    vec2 o = (vec2(dot(p.xyz, uPlanetRight), dot(p.xyz, uPlanetUp)) / cp - vec2(dot(d, uPlanetRight), dot(d, uPlanetUp)) / cd) / pa;
    // A pixel at angle acos(cd) off the axis subtends pa^2 cd^3 sr. The sharp kernel's peak weight is 4/9.
    float radiance = p.w / (pa * pa * cd * cd * cd);
    float s = uExposureValid > 0.5 ? pointSpread(0.4444 * radiance * dot(uPlanetColours[i], vec3(0.2126, 0.7152, 0.0722)) * gain * uNight * sceneExposure()) : 1.0;
    float w = radiance * (planetKernel(o.x / s) * planetKernel(o.y / s)) / (s * s);
    // The planet's colour survives the tone map's rod shift, as the catalogue stars' (StarField.ts).
    vec3 colour = uPlanetColours[i];
    sum += w * scotopicCompensate(colour, w * dot(colour, vec3(0.2126, 0.7152, 0.0722)) * gain * uNight, ${POINT_COLOUR_GAIN_MAX.toFixed(2)});
  }
  return sum;
}
`;
