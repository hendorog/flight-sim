// The night sky's composition in the sky dome (package P3 of the night-sky plan owns this file and
// ../NightLook.ts): airglow, and how the stars, Milky Way, planets and airglow are added and scaled for
// presentation. Called by skyDome.ts once per sky pixel above the horizon; returns radiance at the top of the
// atmosphere (the caller applies the transmittance).
//
// uStarGain / uDiffuseGain: presentation gains (1 = photometric) for point sources (stars, planets) and for
// diffuse light (Milky Way, airglow), set by NightLook. The catalogue star layer (../StarField.ts) reads
// uStarGain too.

import { SCENE_UNITS_PER_LUX } from '../params';

const f = (v: number): string => v.toExponential(6);

export const NIGHT_SKY_GLSL = /* glsl */ `
uniform float uStarGain;
uniform float uDiffuseGain;

/** Airglow ~1.2e-4 cd/m^2 at the zenith. */
const float AIRGLOW_LUMINANCE = ${f(1.2e-4 * SCENE_UNITS_PER_LUX)};

// Airglow: faint emission from ~90 km, brightening toward the horizon with the van Rhijn slant factor.
vec3 airglow(vec3 d) {
  float sinZ2 = 1.0 - d.y * d.y;
  float vanRhijn = 1.0 / sqrt(1.0 - 0.972 * sinZ2);
  return AIRGLOW_LUMINANCE * min(vanRhijn, 4.0) * vec3(0.75, 1.0, 0.8);
}

// d: view direction (world); moonCover: share of the pixel covered by the Moon's disc.
vec3 nightSky(vec3 d, float moonCover) {
  if (uNight <= 0.0) return vec3(0.0);
  vec3 e = uWorldToEquatorial * d;
  float airmass = 1.0 / max(d.y, 0.05);
  // Summed in this order (stars, planets, Milky Way, airglow) so that with unit gains and no planets the sum is
  // bit-identical to the pre-split shader.
  vec3 sky = uStarGain * stars(e, airmass) + uStarGain * planets(d, airmass) + uDiffuseGain * milkyWay(e) + uDiffuseGain * airglow(d);
  return (1.0 - moonCover) * uNight * sky;
}
`;
