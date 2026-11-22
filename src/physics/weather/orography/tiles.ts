// The fixed world lattice of orography tiles. A tile is centred on (ti P, tj P) NED (the airport, at the origin, is
// a centre), solves on an N x N grid at DX (a periodic domain of N DX = 128 km), and contributes inside its valid
// window with the separable weight omega(dn) omega(de), omega(d) = 1 - smootherstep(WEIGHT_INNER, WEIGHT_OUTER, |d|).
// With WEIGHT_INNER + WEIGHT_OUTER = P the weights of neighbouring tiles sum to 1 everywhere, and a point lies in at
// most two tiles per axis (four in a corner). The field is a function of position and weather only: a new tile
// enters where its weight is 0 (owner decision D4: 256 x 256 at 500 m).

/** Grid points per side. */
export const TILE_N = 256;
/** Grid spacing, m. */
export const TILE_DX = 500;
/** Tile centre spacing, m. */
export const TILE_SPACING = 64_000;
/** The weight is 1 up to WEIGHT_INNER from the centre and 0 from WEIGHT_OUTER on (per axis), m. */
export const WEIGHT_INNER = 16_000;
export const WEIGHT_OUTER = 48_000;
/** Grid index of the tile centre. */
export const TILE_CENTRE = TILE_N / 2;
/** The stored window: grid indices WINDOW_START .. WINDOW_START + WINDOW_N - 1 cover |d| <= WEIGHT_OUTER. */
export const WINDOW_START = TILE_CENTRE - WEIGHT_OUTER / TILE_DX;
export const WINDOW_N = (2 * WEIGHT_OUTER) / TILE_DX + 1;
/** The terrain is tapered (cos^2) to 0 between TAPER_START and the domain edge (N DX / 2) from the centre, m. */
export const TAPER_START = WEIGHT_OUTER;

const smootherstep = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Weight of a tile along one axis at offset d from its centre, m. */
export function tileWeight1d(d: number): number {
  const a = Math.abs(d);
  if (a <= WEIGHT_INNER) return 1;
  if (a >= WEIGHT_OUTER) return 0;
  return 1 - smootherstep((a - WEIGHT_INNER) / (WEIGHT_OUTER - WEIGHT_INNER));
}

/** Index of the tile whose centre is at or below `x` on one axis (the other candidate is this + 1). */
export function tileFloor(x: number): number {
  return Math.floor(x / TILE_SPACING);
}

/** NED position of grid node (i, j) of tile (ti, tj), written as [north, east]. */
export function nodePosition(ti: number, tj: number, i: number, j: number, out: Float64Array): Float64Array {
  out[0] = ti * TILE_SPACING + (i - TILE_CENTRE) * TILE_DX;
  out[1] = tj * TILE_SPACING + (j - TILE_CENTRE) * TILE_DX;
  return out;
}

/** Key of a tile in the caches. */
export function tileKey(ti: number, tj: number): string {
  return `${ti},${tj}`;
}

/** cos^2 taper of the terrain toward the periodic domain edge, per axis, at offset d from the centre. */
export function edgeTaper(d: number): number {
  const a = Math.abs(d);
  const edge = (TILE_N / 2) * TILE_DX;
  if (a <= TAPER_START) return 1;
  if (a >= edge) return 0;
  const c = Math.cos((0.5 * Math.PI * (a - TAPER_START)) / (edge - TAPER_START));
  return c * c;
}

/**
 * Bilinear lookup in a window grid (WINDOW_N x WINDOW_N, row = north) at window coordinates (x, y) in cells,
 * clamped to the window.
 */
export function windowBilinear(g: Float32Array, x: number, y: number): number {
  const max = WINDOW_N - 1;
  if (x < 0) x = 0;
  else if (x > max) x = max;
  if (y < 0) y = 0;
  else if (y > max) y = max;
  let i = Math.floor(x);
  let j = Math.floor(y);
  if (i >= max) i = max - 1;
  if (j >= max) j = max - 1;
  const fx = x - i;
  const fy = y - j;
  const o = i * WINDOW_N + j;
  const a = g[o];
  const b = g[o + WINDOW_N];
  const c = g[o + 1];
  const d = g[o + WINDOW_N + 1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
