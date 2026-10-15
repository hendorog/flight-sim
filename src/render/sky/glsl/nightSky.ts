// The night sky's composition in the sky dome (package P3 of the night-sky plan owns this file and
// ../NightLook.ts): airglow, and how the stars, Milky Way, planets and airglow are added and scaled for
// presentation. Called by skyDome.ts once per sky pixel above the horizon; returns radiance at the top of the
// atmosphere (the caller applies the transmittance).
//
// uStarGain / uDiffuseGain / uAirglowGain: presentation gains (1 = photometric) for point sources (stars,
// planets), for the Milky Way's diffuse light, and for the airglow background, set by NightLook (see its header
// for why the airglow has its own gain: the dark-adapted look is a contrast change, agent choice). The catalogue
// star layer (../StarField.ts) reads uStarGain too.

import { SCENE_UNITS_PER_LUX } from '../params';

const f = (v: number): string => v.toExponential(6);

export const NIGHT_SKY_GLSL = /* glsl */ `
uniform float uStarGain;
uniform float uDiffuseGain;
uniform float uAirglowGain;

/** Airglow ~1.2e-4 cd/m^2 at the zenith. */
const float AIRGLOW_LUMINANCE = ${f(1.2e-4 * SCENE_UNITS_PER_LUX)};

// Airglow: faint emission from ~90 km, brightening toward the horizon with the van Rhijn slant factor.
vec3 airglow(vec3 d) {
  float sinZ2 = 1.0 - d.y * d.y;
  float vanRhijn = 1.0 / sqrt(1.0 - 0.972 * sinZ2);
  // Tint: the OI 557.7 nm line makes airglow green in long exposures, but the dark-adapted eye sees a neutral to
  // blue-grey black (and the tone map's Purkinje shift already cools it); a green tint read as a teal video-game
  // night (agent choice, night-sky gate 1).
  return AIRGLOW_LUMINANCE * min(vanRhijn, 4.0) * vec3(0.85, 1.0, 1.0);
}

// d: view direction (world); moonCover: share of the pixel covered by the Moon's disc. point: the planets' share of
// the result (for the tone map's point-source flag, skyDome.ts).
vec3 nightSky(vec3 d, float moonCover, out vec3 point) {
  point = vec3(0.0);
  if (uNight <= 0.0) return vec3(0.0);
  vec3 e = uWorldToEquatorial * d;
  float airmass = 1.0 / max(d.y, 0.05);
  // The Moon hides what lies behind it (stars, planets, the Milky Way); the airglow (~90 km up) is in front of it.
  point = uNight * (1.0 - moonCover) * uStarGain * planets(d, airmass, uStarGain);
  vec3 behind = uStarGain * stars(e, airmass) + uDiffuseGain * milkyWay(e);
  return point + uNight * ((1.0 - moonCover) * behind + uAirglowGain * airglow(d));
}
`;
