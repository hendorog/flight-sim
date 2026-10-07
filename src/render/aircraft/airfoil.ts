// Airfoil contours for the lifting surfaces and propeller.
//
// NACA 4-digit sections (Abbott & von Doenhoff, "Theory of Wing Sections", 1959, section 6.4) with the
// closed-trailing-edge thickness coefficient (-0.1036). Contours are returned in chord units as
// (x from the leading edge, y up), sampled with cosine spacing so the leading edge is well resolved.
// Every contour of a given kind and sample count has the same number of points, so stations can be lofted.

import { camber, surfacePoint, thickness, type Naca4, type Pt } from './planformMath';

// The section shape itself (thickness, camber, surface point) is pure arithmetic and lives in planformMath.ts.
export { camber, surfacePoint, thickness, type Naca4, type Pt };

export const NACA2412: Naca4 = { m: 0.02, p: 0.4, t: 0.12 };
export const NACA0009: Naca4 = { m: 0, p: 0.4, t: 0.09 };

const cosSpace = (a: number, b: number, k: number, n: number): number => a + (b - a) * 0.5 * (1 - Math.cos((Math.PI * k) / n));

/**
 * Full closed contour: trailing edge -> lower surface -> leading edge -> upper surface -> trailing edge.
 * 2n + 1 points; the first and last coincide (the trailing-edge crease).
 */
export function fullContour(af: Naca4, n: number): Pt[] {
  const pts: Pt[] = [];
  for (let k = 0; k <= n; k++) pts.push(surfacePoint(af, cosSpace(1, 0, k, n), -1));
  for (let k = 1; k <= n; k++) pts.push(surfacePoint(af, cosSpace(0, 1, k, n), 1));
  return pts;
}

/**
 * Contour of the fixed part of a surface ahead of a control surface: lower surface from `xLower` to the
 * leading edge, upper surface to `xUpper` (the upper skin overhangs the control-surface nose), then the
 * spar/cove face straight back down. Corner points are repeated so the loft creases there.
 * 2n + nCove + 3 points, first and last coincide.
 */
export function truncatedContour(af: Naca4, xUpper: number, xLower: number, n: number, nCove: number): Pt[] {
  const pts: Pt[] = [];
  for (let k = 0; k <= n; k++) pts.push(surfacePoint(af, cosSpace(xLower, 0, k, n), -1));
  for (let k = 1; k <= n; k++) pts.push(surfacePoint(af, cosSpace(0, xUpper, k, n), 1));
  const top = pts[pts.length - 1];
  const bottom = pts[0];
  pts.push([top[0], top[1]]);
  for (let k = 1; k < nCove; k++) {
    const t = k / nCove;
    // Slightly concave cove so the control-surface nose clears it through its travel.
    const bulge = 0.35 * Math.sin(Math.PI * t) * (top[1] - bottom[1]) * 0.25;
    pts.push([top[0] + (bottom[0] - top[0]) * t - bulge, top[1] + (bottom[1] - top[1]) * t]);
  }
  pts.push([bottom[0], bottom[1]]);
  pts.push([bottom[0], bottom[1]]);
  return pts;
}

/**
 * Control-surface section aft of a hinge at chord station `xh`: a round nose centred on the camber line,
 * then the parent airfoil's upper and lower surfaces to the trailing edge (or to `xEnd` for a surface
 * whose trailing edge is cut back, e.g. around a trim tab). Returns the contour (trailing edge -> lower ->
 * nose -> upper -> trailing edge, 2n + nNose + 1 points) and the nose centre, which is the hinge point.
 */
export function controlSurfaceContour(af: Naca4, xh: number, n: number, nNose: number, gap = 0.006, xEnd = 1): { pts: Pt[]; hinge: Pt } {
  const r = thickness(af, xh + 0.02) - gap;
  const cx = xh + r;
  const cy = camber(af, cx).yc;
  const start = cx;
  const pts: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const x = cosSpace(xEnd, start, k, n);
    pts.push(blendToNose(af, x, -1, start, cx, cy, r));
  }
  for (let k = 1; k < nNose; k++) {
    const a = -Math.PI / 2 - (Math.PI * k) / nNose;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  for (let k = 0; k <= n; k++) {
    const x = cosSpace(start, xEnd, k, n);
    pts.push(blendToNose(af, x, 1, start, cx, cy, r));
  }
  return { pts, hinge: [cx, cy] };
}

/** Parent surface point, pulled onto the nose circle's tangent where the section starts. */
function blendToNose(af: Naca4, x: number, side: 1 | -1, start: number, cx: number, cy: number, r: number): Pt {
  const p = surfacePoint(af, x, side);
  const w = Math.max(0, 1 - (x - start) / 0.08);
  const y = p[1] * (1 - w * w) + (cy + side * r) * w * w;
  return [p[0], y];
}
