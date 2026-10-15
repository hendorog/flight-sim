// How a point source (a catalogue star, a planet) spreads when it is brighter than the display can show.
//
// At night the brightest stars and planets reach far over display white in their central pixel: drawn at their
// sharp size (StarField's sigma 0.6 px Gaussian, the planets' 2 px B-spline) they clip to small white squares and
// lose their colour (orange Mars, Betelgeuse, Antares), and nothing reads as brilliant. A camera's lens and the
// eye's optics do the same thing a little: a bright point spreads into a small soft disc. So the spot widens with
// the light it has over white, while its flux is conserved (the kernels integrate to 1 at any width): the wings
// carry the colour, the core still clips, bloom adds the glare. Agent choice (cinematic look, night-sky gate 1).
//
// scale = 1 + POINT_SPREAD_PER_EV * log2(peak display / POINT_SPREAD_WHITE), clamped to [1, POINT_SPREAD_MAX or STAR_SPREAD_MAX];
// peak display is the sharp spot's brightest pixel after exposure (display-linear, 0.18 = middle grey).

/**
 * Display-linear level from which a point starts to spread: a little under the tone map's white (2^1.2, ToneMap.ts
 * AGX_MAX_EV), so 2nd-magnitude stars already read as small soft discs (night-sky review round 2).
 */
export const POINT_SPREAD_WHITE = 1.2;
/** Growth of the spot's width per EV over white (a 0.6 px star gains 0.42 px per EV). */
export const POINT_SPREAD_PER_EV = 0.7;
/** Widest spot of a planet, as a multiple of the sharp one (2 px -> 8 px B-spline): Mars spreads into a soft disc. */
export const POINT_SPREAD_MAX = 4;
/**
 * Widest spot of a catalogue star (sigma 0.6 -> 1.56 px). Lower than the planets': a star's sprite area grows with the
 * square of the spread, and with thousands of stars over white on a moonless night a cap of 4 cost ~0.4 ms of fill.
 */
export const STAR_SPREAD_MAX = 2.6;

/**
 * Most a point source's colour is boosted against the tone map's rod shift (post/ToneMap.ts scotopicCompensate, an
 * exact inverse of the shift up to this gain; the full shift, share 0.7, needs 1 / 0.3 = 3.3). Agent choice, raised
 * from 2.5 in night-sky review round 2: Mars and Antares read white with neutral wings.
 */
export const POINT_COLOUR_GAIN_MAX = 3.4;

/** TS mirror of pointSpread() (for tests). */
export function pointSpread(peakDisplay: number, maxScale = POINT_SPREAD_MAX): number {
  const ev = Math.log2(Math.max(peakDisplay, 1e-30) / POINT_SPREAD_WHITE);
  return Math.min(maxScale, Math.max(1, 1 + POINT_SPREAD_PER_EV * ev));
}

export const POINT_SPREAD_GLSL = /* glsl */ `
float pointSpread(float peakDisplay, float maxScale) {
  float ev = log2(max(peakDisplay, 1e-30) / ${POINT_SPREAD_WHITE.toFixed(4)});
  return clamp(1.0 + ${POINT_SPREAD_PER_EV.toFixed(4)} * ev, 1.0, maxScale);
}
`;
