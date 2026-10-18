// The channel of a cloud-to-ground lightning strike as a polyline, for the lightning overlay. Pure (no three.js):
// midpoint displacement over BOLT_LEVELS levels between a top point (inside the cloud, BOLT_TOP_ABOVE_BASE_M above
// the base) and the ground point, seeded by the strike id, so a strike always has the same shape. Each level
// moves every new midpoint sideways (in the horizontal plane) by up to BOLT_ROUGHNESS of its segment's length and
// up or down by a fifth of that; the two end points never move.
//
// Coordinates are y-up (the overlay passes three.js world positions: x east, y altitude MSL, z south).

import { hashU32, mulberry32 } from '../../physics/weather/random';

/** Subdivision levels: 2^BOLT_LEVELS segments. */
export const BOLT_LEVELS = 5;
/** Segments of a bolt (the overlay's uniform array length). */
export const BOLT_SEGMENTS = 1 << BOLT_LEVELS;
/** Points of a bolt. */
export const BOLT_POINTS = BOLT_SEGMENTS + 1;
/** Height of the channel's top above the cloud base, m (clamped to the cell top by the caller). */
export const BOLT_TOP_ABOVE_BASE_M = 3000;
/** Largest sideways displacement of a midpoint, as a fraction of its segment's length. Unconfirmed: a look value. */
export const BOLT_ROUGHNESS = 0.32;

export interface BoltEnd {
  x: number;
  y: number;
  z: number;
}

/**
 * The channel from `top` to `bottom` for strike `id`, written into `out` as BOLT_POINTS (x, y, z) triples from the
 * top down (out.length >= 3 * BOLT_POINTS). The first point is `top` and the last `bottom`, exactly. Returns `out`.
 */
export function boltPath(id: number, top: BoltEnd, bottom: BoltEnd, out: Float32Array | number[]): Float32Array | number[] {
  const rnd = mulberry32(hashU32((id >>> 0) ^ 0xb017));
  const set = (i: number, x: number, y: number, z: number): void => {
    out[3 * i] = x;
    out[3 * i + 1] = y;
    out[3 * i + 2] = z;
  };
  set(0, top.x, top.y, top.z);
  set(BOLT_SEGMENTS, bottom.x, bottom.y, bottom.z);
  for (let level = 0; level < BOLT_LEVELS; level++) {
    const stride = BOLT_SEGMENTS >> level;
    const half = stride >> 1;
    for (let a = 0; a < BOLT_SEGMENTS; a += stride) {
      const b = a + stride;
      const ax = out[3 * a], ay = out[3 * a + 1], az = out[3 * a + 2];
      const bx = out[3 * b], by = out[3 * b + 1], bz = out[3 * b + 2];
      const len = Math.hypot(bx - ax, by - ay, bz - az);
      const amp = BOLT_ROUGHNESS * len;
      const angle = 2 * Math.PI * rnd();
      const side = amp * (rnd() * 2 - 1);
      const up = 0.2 * amp * (rnd() * 2 - 1);
      set(a + half, 0.5 * (ax + bx) + side * Math.cos(angle), 0.5 * (ay + by) + up, 0.5 * (az + bz) + side * Math.sin(angle));
    }
  }
  return out;
}
