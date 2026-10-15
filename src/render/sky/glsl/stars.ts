// Stars drawn inside the sky dome's fragment shader (package P2 of the night-sky plan owns this file and
// ../StarField.ts, which may add a separate catalogue layer).
//
// Today: one hashed star per cell of a cube map over the celestial sphere, drawn as a Gaussian a little under a
// pixel wide carrying the star's full flux, so they neither alias nor change brightness with zoom.

import { SCENE_UNITS_PER_LUX } from '../params';

const f = (v: number): string => v.toExponential(6);

/** Stars per cube-map face side; ~240 000 cells, one star each, magnitudes -1.4 .. 9.4. */
const STAR_CELLS = 200;

export const STARS_GLSL = /* glsl */ `
/** Illuminance of a magnitude-0 star, 2.54e-6 lux, in scene units. */
const float STAR_E0 = ${f(2.54e-6 * SCENE_UNITS_PER_LUX)};
const float STAR_CELLS = ${STAR_CELLS}.0;
/** Brightest magnitude + 2 log10(cell count): N(<m) grows ~x3.2 per magnitude (Allen). */
const float STAR_MAG_LIMIT = ${(-1.4 + 2 * Math.log10(6 * STAR_CELLS * STAR_CELLS)).toFixed(3)};

vec3 starColour(float t) {
  vec3 c = t < 0.1 ? vec3(0.65, 0.75, 1.0)
         : t < 0.3 ? vec3(0.85, 0.9, 1.0)
         : t < 0.6 ? vec3(1.0, 0.97, 0.92)
         : t < 0.85 ? vec3(1.0, 0.86, 0.68)
         : vec3(1.0, 0.72, 0.5);
  return c / dot(c, vec3(0.2126, 0.7152, 0.0722));
}
vec3 stars(vec3 e, float airmass) {
  vec3 a = abs(e);
  uint face;
  vec2 uv;
  if (a.x >= a.y && a.x >= a.z) { face = e.x > 0.0 ? 0u : 1u; uv = e.yz / a.x; }
  else if (a.y >= a.z) { face = e.y > 0.0 ? 2u : 3u; uv = e.xz / a.y; }
  else { face = e.z > 0.0 ? 4u : 5u; uv = e.xy / a.z; }
  vec2 cell = floor((uv * 0.5 + 0.5) * STAR_CELLS);
  vec3 r0 = random3(uvec3(uvec2(cell), face));
  float mag = STAR_MAG_LIMIT + 2.0 * log(max(r0.z, 1e-9)) / log(10.0);
  // Fainter stars than ~7th magnitude sit below the night-sky background even for dark-adapted eyes.
  if (mag > 7.0) return vec3(0.0);
  vec2 suv = (cell + 0.2 + 0.6 * r0.xy) / STAR_CELLS * 2.0 - 1.0;
  float s = face % 2u == 0u ? 1.0 : -1.0;
  vec3 star = face < 2u ? vec3(s, suv) : face < 4u ? vec3(suv.x, s, suv.y) : vec3(suv, s);
  vec3 dv = e - normalize(star);
  float sigma = 0.6 * uPixelAngle;
  float profile = exp(-0.5 * dot(dv, dv) / (sigma * sigma)) / (6.2831853 * sigma * sigma);
  vec3 r1 = random3(uvec3(uvec2(cell), face + 6u));
  float twinkle = 1.0 + 0.3 * min(airmass - 1.0, 3.0) * sin(uTime * (7.0 + 9.0 * r1.x) + 6.2831853 * r1.y);
  return STAR_E0 * pow(10.0, -0.4 * mag) * profile * twinkle * starColour(r1.z);
}
`;
