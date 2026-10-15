// The Milky Way's diffuse light in the sky dome (package P2 of the night-sky plan owns this file).
//
// Today: an analytic galactic-latitude band brighter toward the bulge, with dust lanes. The rotation is the
// J2000 equatorial -> galactic matrix (Hipparcos, ESA 1997), written column by column.

import { SCENE_UNITS_PER_LUX } from '../params';

const f = (v: number): string => v.toExponential(6);

export const MILKY_WAY_GLSL = /* glsl */ `
/** Milky Way peak surface brightness ~5e-4 cd/m^2. */
const float MILKY_WAY_LUMINANCE = ${f(5e-4 * SCENE_UNITS_PER_LUX)};

vec3 milkyWay(vec3 e) {
  const mat3 EQ_TO_GAL = mat3(
    -0.0548755604, 0.4941094279, -0.8676661490,
    -0.8734370902, -0.4448296300, -0.1980763734,
    -0.4838350155, 0.7469822445, 0.4559837762);
  vec3 g = EQ_TO_GAL * e;
  float b = asin(clamp(g.z, -1.0, 1.0));
  float l = atan(g.y, g.x);
  float disc = exp(-0.5 * b * b / (0.12 * 0.12));
  float bulge = exp(-0.5 * l * l / (0.45 * 0.45)) * exp(-0.5 * b * b / (0.2 * 0.2));
  float clumps = 0.55 + 0.9 * fbm(g * 9.0);
  float dust = 1.0 - 0.75 * smoothstep(0.45, 0.7, fbm(g * 5.0 + 11.0)) * exp(-0.5 * b * b / (0.05 * 0.05));
  return MILKY_WAY_LUMINANCE * (0.35 * disc + 0.65 * bulge) * clumps * dust * vec3(1.0, 0.94, 0.84);
}
`;
