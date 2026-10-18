// The channel of a cloud-to-ground lightning strike as a polyline, for the lightning overlay. Pure (no three.js):
// midpoint displacement over BOLT_LEVELS levels between a top point (inside the cloud, BOLT_TOP_ABOVE_BASE_M above
// the base) and the ground point, seeded by the strike id, so a strike always has the same shape. Each level
// moves every new midpoint sideways (in the horizontal plane) by up to BOLT_ROUGHNESS of its segment's length and
// up or down by a fifth of that; the two end points never move.
// boltBranches adds BRANCH_MIN..BOLT_MAX_BRANCHES side branches, also seeded by the id: each leaves the channel at
// one of its points at or below a given height, runs down and outward BRANCH_TILT_MIN_DEG..BRANCH_TILT_MAX_DEG from
// the vertical for BRANCH_LEN_MIN..BRANCH_LEN_MAX of the height of the highest root above the ground (its end kept
// above the ground), and is broken up by the same midpoint displacement over BRANCH_LEVELS levels.
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
/** Side branches per strike: BRANCH_MIN..BOLT_MAX_BRANCHES. Unconfirmed: look values. */
export const BRANCH_MIN = 2;
export const BOLT_MAX_BRANCHES = 4;
/** Subdivision levels of a branch, its segments and its points. */
export const BRANCH_LEVELS = 3;
export const BRANCH_SEGMENTS = 1 << BRANCH_LEVELS;
export const BRANCH_POINTS = BRANCH_SEGMENTS + 1;
/** A branch's angle from the vertical, degrees, and its length as a share of the highest root's height above the ground. Unconfirmed: look values. */
export const BRANCH_TILT_MIN_DEG = 25;
export const BRANCH_TILT_MAX_DEG = 60;
export const BRANCH_LEN_MIN = 0.2;
export const BRANCH_LEN_MAX = 0.45;
/** Lowest root of a branch, as a share of the way from the ground to the highest. Unconfirmed: a look value. */
export const BRANCH_ROOT_MIN = 0.4;

export interface BoltEnd {
  x: number;
  y: number;
  z: number;
}

type Points = Float32Array | number[];

/**
 * Midpoint displacement of the `segments` (a power of two, 2^levels) segments of the polyline at point offset `at`
 * of `out`, between its first and last points (set by the caller).
 */
function displace(rnd: () => number, out: Points, at: number, levels: number): void {
  const segments = 1 << levels;
  for (let level = 0; level < levels; level++) {
    const stride = segments >> level;
    const half = stride >> 1;
    for (let a = 0; a < segments; a += stride) {
      const ia = 3 * (at + a);
      const ib = 3 * (at + a + stride);
      const ax = out[ia], ay = out[ia + 1], az = out[ia + 2];
      const bx = out[ib], by = out[ib + 1], bz = out[ib + 2];
      const len = Math.hypot(bx - ax, by - ay, bz - az);
      const amp = BOLT_ROUGHNESS * len;
      const angle = 2 * Math.PI * rnd();
      const side = amp * (rnd() * 2 - 1);
      const up = 0.2 * amp * (rnd() * 2 - 1);
      const im = 3 * (at + a + half);
      out[im] = 0.5 * (ax + bx) + side * Math.cos(angle);
      out[im + 1] = 0.5 * (ay + by) + up;
      out[im + 2] = 0.5 * (az + bz) + side * Math.sin(angle);
    }
  }
}

/**
 * The channel from `top` to `bottom` for strike `id`, written into `out` as BOLT_POINTS (x, y, z) triples from the
 * top down (out.length >= 3 * BOLT_POINTS). The first point is `top` and the last `bottom`, exactly. Returns `out`.
 */
export function boltPath(id: number, top: BoltEnd, bottom: BoltEnd, out: Points): Points {
  const rnd = mulberry32(hashU32((id >>> 0) ^ 0xb017));
  out[0] = top.x;
  out[1] = top.y;
  out[2] = top.z;
  out[3 * BOLT_SEGMENTS] = bottom.x;
  out[3 * BOLT_SEGMENTS + 1] = bottom.y;
  out[3 * BOLT_SEGMENTS + 2] = bottom.z;
  displace(rnd, out, 0, BOLT_LEVELS);
  return out;
}

/**
 * The side branches of strike `id` on its channel `path` (boltPath's output), written into `out` as BRANCH_POINTS
 * (x, y, z) triples per branch, from the root (a point of `path`, exactly) outward (out.length >= 3 *
 * BOLT_MAX_BRANCHES * BRANCH_POINTS). Roots are channel points no higher than `rootMaxY` (the cloud base: a branch
 * inside the cloud is not seen) and at least BRANCH_ROOT_MIN of the way from the ground to it, excluding the ends.
 * Returns the branch count: BRANCH_MIN..BOLT_MAX_BRANCHES, or 0 when no point qualifies.
 */
export function boltBranches(id: number, path: Points, rootMaxY: number, out: Points): number {
  const rnd = mulberry32(hashU32((id >>> 0) ^ 0xb7a4c));
  const groundY = path[3 * BOLT_SEGMENTS + 1];
  const minY = groundY + BRANCH_ROOT_MIN * (rootMaxY - groundY);
  let first = -1;
  let last = -1;
  for (let i = 1; i < BOLT_SEGMENTS - 1; i++) {
    const y = path[3 * i + 1];
    if (y > rootMaxY || y < minY) continue;
    if (first < 0) first = i;
    last = i;
  }
  if (first < 0) return 0;
  const count = BRANCH_MIN + Math.floor(rnd() * (BOLT_MAX_BRANCHES - BRANCH_MIN + 1));
  for (let b = 0; b < count; b++) {
    const root = first + Math.floor(rnd() * (last - first + 1));
    const rx = path[3 * root], ry = path[3 * root + 1], rz = path[3 * root + 2];
    const tilt = (BRANCH_TILT_MIN_DEG + rnd() * (BRANCH_TILT_MAX_DEG - BRANCH_TILT_MIN_DEG)) * (Math.PI / 180);
    const heading = 2 * Math.PI * rnd();
    const len = (BRANCH_LEN_MIN + rnd() * (BRANCH_LEN_MAX - BRANCH_LEN_MIN)) * Math.max(0, rootMaxY - groundY);
    const at = b * BRANCH_POINTS;
    const i0 = 3 * at;
    const i1 = 3 * (at + BRANCH_SEGMENTS);
    out[i0] = rx;
    out[i0 + 1] = ry;
    out[i0 + 2] = rz;
    out[i1] = rx + len * Math.sin(tilt) * Math.cos(heading);
    out[i1 + 1] = Math.max(groundY + 0.1 * (ry - groundY), ry - len * Math.cos(tilt));
    out[i1 + 2] = rz + len * Math.sin(tilt) * Math.sin(heading);
    displace(rnd, out, at, BRANCH_LEVELS);
  }
  return count;
}
