// How a point source (a catalogue star, a planet) spreads when it is brighter than the display can show.
//
// At night the brightest stars and planets reach far over display white in their central pixel: drawn at their
// sharp size (StarField's sigma 0.6 px Gaussian, the planets' 2 px B-spline) they clip to small white squares and
// lose their colour (orange Mars, Betelgeuse, Antares), and nothing reads as brilliant. A camera's lens and the
// eye's optics do the same thing a little: a bright point spreads into a small soft disc. So the spot widens with
// the light it has over white, while its flux is conserved (the kernels integrate to 1 at any width): the wings
// carry the colour, the core still clips, bloom adds the glare. Agent choice (cinematic look, night-sky gate 1).
//
// scale = 1 + POINT_SPREAD_PER_EV * log2(peak display / POINT_SPREAD_WHITE), clamped to [1, POINT_SPREAD_MAX];
// peak display is the sharp spot's brightest pixel after exposure (display-linear, 0.18 = middle grey).

/** Display-linear level from which a point starts to spread: the tone map's white (2^1.2, ToneMap.ts AGX_MAX_EV). */
export const POINT_SPREAD_WHITE = 2.3;
/** Growth of the spot's width per EV over white (a 0.6 px star gains 0.27 px per EV). */
export const POINT_SPREAD_PER_EV = 0.45;
/** Widest spot, as a multiple of the sharp one (a star's sigma 0.6 -> 1.56 px). */
export const POINT_SPREAD_MAX = 2.6;

/**
 * Most a point source's colour saturation is raised against the tone map's rod shift (post/ToneMap.ts SCOTOPIC_GLSL;
 * full compensation at night would be 1 / 0.3 = 3.3, which overshoots strongly coloured stars). Agent choice.
 */
export const POINT_COLOUR_GAIN_MAX = 2.5;

/** TS mirror of pointSpread() (for tests). */
export function pointSpread(peakDisplay: number): number {
  const ev = Math.log2(Math.max(peakDisplay, 1e-30) / POINT_SPREAD_WHITE);
  return Math.min(POINT_SPREAD_MAX, Math.max(1, 1 + POINT_SPREAD_PER_EV * ev));
}

export const POINT_SPREAD_GLSL = /* glsl */ `
float pointSpread(float peakDisplay) {
  float ev = log2(max(peakDisplay, 1e-30) / ${POINT_SPREAD_WHITE.toFixed(4)});
  return clamp(1.0 + ${POINT_SPREAD_PER_EV.toFixed(4)} * ev, 1.0, ${POINT_SPREAD_MAX.toFixed(4)});
}
`;
