// Lofting of wings, tailplane and fin from airfoil contours along a planform, and the planforms of the
// Cessna 172S surfaces (the default airframe definition, whose planform numbers come from core/c172.ts so
// the model matches the flight model). The planform arithmetic itself is planformMath.ts.

import * as THREE from 'three';
import { C172S_VISUAL } from '../../aircraft/c172s/visual';
import type { Pt } from './airfoil';
import { capGeometry, frd, gridGeometry, type FRD, type GridSpec } from './geometry';
import { makeFinPlanform, makeStabPlanform, makeWingPlanform, sectionPoint, type Planform } from './planformMath';

export { makeFinPlanform, makeRudderPlanform, makeStabPlanform, makeWingletPlanform, makeWingPlanform, sectionPoint, type Planform } from './planformMath';

export interface SurfaceOptions {
  /** Span stations (rows), ascending. */
  stations: number[];
  /** Section contour (chord units, see airfoil.ts). */
  contour: Pt[];
  /** Section thickness scale at station s (1 = true section); used to round tips. */
  thicknessScale?(s: number): number;
  /** Chord scale at station s (planform rounding of tips). */
  chordScale?(s: number): number;
  /** Mirror across the symmetry plane (left side). */
  mirror?: boolean;
  /** Reverse the facing (inside-visible surfaces only; the outward facing is derived automatically). */
  flip?: boolean;
  /** The contour of station row i where it changes along the span (same number of points in every row). Absent: `contour`. */
  contourAt?(i: number): Pt[];
  /** Move the body point (right side, before mirroring) of a vertex of station row i, e.g. onto another body. */
  fit?(i: number, p: FRD): void;
}

/**
 * Whether the raw grid (rows along the span, columns along the contour TE -> lower -> LE -> upper -> TE)
 * of this planform faces inward. The grid normal is d(span) x d(contour); on the upper surface the contour
 * runs aft, so the normal is span x aft, which must agree with the section's up axis to face outward.
 * The FRD -> model mapping is a proper rotation, so the test can be made in body axes.
 */
export function planformInward(pf: Planform, s0: number, s1: number): boolean {
  const a = pf.ref(s0, { x: 0, y: 0, z: 0 });
  const b = pf.ref(s1, { x: 0, y: 0, z: 0 });
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const sz = b.z - a.z;
  const { aft: f, up: u } = pf;
  const nx = sy * f.z - sz * f.y;
  const ny = sz * f.x - sx * f.z;
  const nz = sx * f.y - sy * f.x;
  return nx * u.x + ny * u.y + nz * u.z < 0;
}

/** Texture v for a contour point: 0..0.5 along the lower surface (TE->LE), 0.5..1 along the upper. */
function contourV(pts: Pt[]): number[] {
  let le = 0;
  for (let j = 1; j < pts.length; j++) if (pts[j][0] < pts[le][0]) le = j;
  return pts.map((p, j) => (j <= le ? 0.5 - 0.5 * p[0] : 0.5 + 0.5 * p[0]));
}

/** Grid spec of a lifting surface; texture u = metres along the span, v = contourV. */
export function surfaceSpec(pf: Planform, o: SurfaceOptions): GridSpec {
  const v = contourV(o.contour);
  const p: FRD = { x: 0, y: 0, z: 0 };
  const mirror = o.mirror ? -1 : 1;
  const st = o.stations;
  // Mirroring reverses handedness; stations listed in descending order reverse the row direction.
  const inward = planformInward(pf, st[0], st[st.length - 1]) !== (o.mirror ?? false);
  return {
    rows: o.stations.length,
    cols: o.contour.length,
    flip: inward !== (o.flip ?? false),
    position(i, j, out) {
      const s = o.stations[i];
      const ts = o.thicknessScale?.(s) ?? 1;
      const cs = o.chordScale?.(s) ?? 1;
      const [xc, yc] = o.contourAt ? o.contourAt(i)[j] : o.contour[j];
      // Chord scaling shrinks about the reference point so the planform rounds symmetrically.
      const x = pf.refFrac + (xc - pf.refFrac) * cs;
      sectionPoint(pf, s, x, yc * ts * cs, p);
      o.fit?.(i, p);
      frd(p.x, p.y * mirror, p.z, out);
    },
    uv(i, j, out) {
      out.set(o.stations[i], v[j]);
    },
  };
}

export function surfaceGeometry(pf: Planform, o: SurfaceOptions): THREE.BufferGeometry {
  return gridGeometry(surfaceSpec(pf, o));
}

/** Flat end cap closing the section at station s, facing `outward` (model space). */
export function surfaceCap(pf: Planform, contour: Pt[], s: number, outward: THREE.Vector3, mirror = false): THREE.BufferGeometry {
  const loop: THREE.Vector3[] = [];
  const p: FRD = { x: 0, y: 0, z: 0 };
  for (let j = 0; j < contour.length - 1; j++) {
    const [xc, yc] = contour[j];
    if (j > 0 && contour[j][0] === contour[j - 1][0] && contour[j][1] === contour[j - 1][1]) continue;
    sectionPoint(pf, s, xc, yc, p);
    loop.push(frd(p.x, mirror ? -p.y : p.y, p.z));
  }
  return capGeometry(loop, outward);
}

/** n + 1 evenly spaced span stations from a to b. */
export function stations(a: number, b: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(a + ((b - a) * i) / n);
  return out;
}

/** n + 1 span stations from `start` to the tip edge at `end`, denser toward the edge (for rounded tips). */
export function tipStations(start: number, end: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(start + (end - start) * Math.sin((Math.PI / 2) * (i / n)));
  return out;
}

/** Elliptical tip rounding: 1 inboard of `start`, falling to `floor` at `end`. */
export function roundTip(start: number, end: number, floor = 0.02): (s: number) => number {
  return (s) => {
    if (s <= start) return 1;
    const u = Math.min(1, (s - start) / (end - start));
    return Math.max(floor, Math.sqrt(1 - u * u));
  };
}

// --- Cessna 172S planforms --------------------------------------------------------------------------

const TAIL = C172S_VISUAL.tail;

/** Main wing (right side; mirror for left). Span parameter = body y. */
export const wingPlanform: Planform = makeWingPlanform(C172S_VISUAL.wing);

/** Chordwise fraction of the elevator hinge. */
export const ELEVATOR_HINGE = 1 - TAIL.h.chordFraction;
/** Horizontal stabiliser (right side), referenced to the straight elevator hinge line. */
export const stabPlanform: Planform = makeStabPlanform(TAIL);

/** Chordwise fraction of the rudder hinge. */
export const RUDDER_HINGE = 1 - TAIL.v.rudderChordFraction;
/** Fin: span parameter h = metres above the fin base (along -z); quarter-chord line from base to tip. */
export const finPlanform: Planform = makeFinPlanform(TAIL);
export const FIN_HEIGHT = TAIL.v.base.z - TAIL.v.tip.z;
export const STAB_HALF_SPAN = TAIL.h.span / 2;
