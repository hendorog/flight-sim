// Planform and section mathematics of the lifting surfaces: where a chord point of a wing, tailplane or fin
// lies in body axes, and the NACA 4-digit section shape. PURE: no three.js and no aircraft file, so an
// airframe definition (src/aircraft/<id>/visual.ts, which the livery worker loads) can use it to derive plain
// numbers, e.g. the cabin roof stations that follow the wing root. liftingSurface.ts and airfoil.ts re-export
// everything here under the names the builders have always used.

import type { TailVisualDef, WingVisualDef } from './airframe/types';

/** A point or direction in body axes (FRD: x forward, y right, z down), m. */
export interface BodyPoint {
  x: number;
  y: number;
  z: number;
}

// --- NACA 4-digit sections (Abbott & von Doenhoff, "Theory of Wing Sections", 1959, section 6.4) ---------

export interface Naca4 {
  /** Max camber, fraction of chord (0.02 for 2412). */
  m: number;
  /** Chordwise position of max camber (0.4 for 2412). */
  p: number;
  /** Max thickness, fraction of chord (0.12 for 2412). */
  t: number;
}

export type Pt = [number, number];

export function thickness(af: Naca4, x: number): number {
  const sx = Math.sqrt(Math.max(0, x));
  return 5 * af.t * (0.2969 * sx - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
}

export function camber(af: Naca4, x: number): { yc: number; slope: number } {
  const { m, p } = af;
  if (m === 0) return { yc: 0, slope: 0 };
  if (x < p) return { yc: (m / (p * p)) * (2 * p * x - x * x), slope: ((2 * m) / (p * p)) * (p - x) };
  const q = (1 - p) * (1 - p);
  return { yc: (m / q) * (1 - 2 * p + 2 * p * x - x * x), slope: ((2 * m) / q) * (p - x) };
}

/** Point on the upper (side = 1) or lower (side = -1) surface at chord station x. */
export function surfacePoint(af: Naca4, x: number, side: 1 | -1): Pt {
  const yt = thickness(af, x);
  const { yc, slope } = camber(af, x);
  const th = Math.atan(slope);
  return [x - side * yt * Math.sin(th), yc + side * yt * Math.cos(th)];
}

// --- Planforms ---------------------------------------------------------------------------------------------

/** A lifting-surface planform in body axes. Span parameter s is metres along the span axis. */
export interface Planform {
  /** Chord reference point (the chord line at `refFrac` of the chord) at span station s, FRD. */
  ref(s: number, out: BodyPoint): BodyPoint;
  /** Chordwise fraction of the reference point (0.25 = quarter chord). */
  refFrac: number;
  chord(s: number): number;
  /** Nose-up twist (incidence) about the span axis, rad. */
  twist(s: number): number;
  /** Unit chord axis pointing aft (leading edge -> trailing edge) with zero twist, FRD. */
  aft: BodyPoint;
  /** Unit section "up" axis (the airfoil's +y), FRD. */
  up: BodyPoint;
  /** The section's up axis at span station s, where it turns along the span (a winglet's blend). Absent: `up` everywhere. */
  upAt?(s: number, out: BodyPoint): BodyPoint;
}

const tmpRef: BodyPoint = { x: 0, y: 0, z: 0 };
const tmpUp: BodyPoint = { x: 0, y: 0, z: 0 };

/** Body-frame (FRD) point of chord coordinates (xc, yc) at span s. */
export function sectionPoint(pf: Planform, s: number, xc: number, yc: number, out: BodyPoint = { x: 0, y: 0, z: 0 }): BodyPoint {
  const r = pf.ref(s, tmpRef);
  const c = pf.chord(s);
  const t = pf.twist(s);
  const ct = Math.cos(t);
  const st = Math.sin(t);
  // Twisted axes: aft' = aft cos t - up sin t, up' = up cos t + aft sin t (leading edge rises for t > 0).
  const a = (xc - pf.refFrac) * c;
  const u = yc * c;
  const ax = a * ct + u * st;
  const au = -a * st + u * ct;
  const up = pf.upAt ? pf.upAt(s, tmpUp) : pf.up;
  out.x = r.x + pf.aft.x * ax + up.x * au;
  out.y = r.y + pf.aft.y * ax + up.y * au;
  out.z = r.z + pf.aft.z * ax + up.z * au;
  return out;
}

/**
 * Main wing (right side; mirror for left). Span parameter = body y. Chord and quarter-chord x run linearly
 * between the span breaks (held inboard of the first, continued outboard of the last); dihedral and the
 * linear washout are measured from rootY to the last break.
 */
export function makeWingPlanform(w: WingVisualDef): Planform {
  const breaks = w.breaks;
  const last = breaks.length - 1;
  const tipY = breaks[last].y;
  const tanDihedral = Math.tan(w.dihedral);
  const between = (y: number, key: 'chord' | 'qcX'): number => {
    let i = 1;
    while (i < last && y > breaks[i].y) i++;
    const a = breaks[i - 1];
    const b = breaks[i];
    if (y <= a.y) return a[key];
    return a[key] + ((b[key] - a[key]) * (y - a.y)) / (b.y - a.y);
  };
  return {
    refFrac: 0.25,
    ref(y, out) {
      out.x = between(y, 'qcX');
      out.y = y;
      out.z = w.qcZ - (y - w.rootY) * tanDihedral;
      return out;
    },
    chord(y) {
      return between(y, 'chord');
    },
    twist(y) {
      const t = Math.min(1, Math.max(0, (y - w.rootY) / (tipY - w.rootY)));
      return w.rootIncidence + (w.tipIncidence - w.rootIncidence) * t;
    },
    aft: { x: -1, y: 0, z: 0 },
    up: { x: 0, y: 0, z: -1 },
  };
}

/**
 * Winglet of the right wing. Span parameter s = metres along the winglet from the wing's tip station. Over the
 * first `blend` of its height the wing's tip section turns up from the wing plane to the cant angle and its
 * chord narrows to the winglet's own; from there on the quarter-chord line is straight, swept aft by `sweep`,
 * and the chord tapers to tipChord. The upper (suction) surface faces inboard.
 */
export function makeWingletPlanform(w: WingVisualDef): Planform {
  const let_ = w.tip.winglet;
  if (!let_) throw new Error('makeWingletPlanform: the wing has no winglet');
  const wing = makeWingPlanform(w);
  const tipY = w.breaks[w.breaks.length - 1].y;
  const root = wing.ref(tipY, { x: 0, y: 0, z: 0 });
  const rootChord = wing.chord(tipY);
  const twist = wing.twist(tipY);
  const blend = Math.max(1e-3, (let_.blend ?? 0.3) * let_.height);
  const ease = (s: number): number => {
    const t = Math.min(1, Math.max(0, s / blend));
    return t * t * (3 - 2 * t);
  };
  // The wing's tip line rises with the dihedral and the winglet turns up from there; the wing's sections stand
  // upright (its dihedral is a shear), so the section's own up axis turns from upright.
  const angle = (s: number): number => w.dihedral + (let_.cant - w.dihedral) * ease(s);
  const upAngle = (s: number): number => let_.cant * ease(s);
  // The path of the quarter-chord line in the y-z plane, integrated once (the blend is an arc of varying radius).
  const N = 64;
  const ys = new Float64Array(N + 1);
  const zs = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) {
    const a = angle(((i - 0.5) / N) * let_.height);
    ys[i] = ys[i - 1] + (Math.cos(a) * let_.height) / N;
    zs[i] = zs[i - 1] - (Math.sin(a) * let_.height) / N;
  }
  const tanSweep = Math.tan(let_.sweep);
  const ownChord = (s: number): number => let_.rootChord + ((let_.tipChord - let_.rootChord) * s) / let_.height;
  const mid = upAngle(let_.height / 2);
  return {
    refFrac: 0.25,
    ref(s, out) {
      const f = Math.min(1, Math.max(0, s / let_.height)) * N;
      const i = Math.min(N - 1, Math.floor(f));
      out.x = root.x - s * tanSweep;
      out.y = root.y + ys[i] + (ys[i + 1] - ys[i]) * (f - i);
      out.z = root.z + zs[i] + (zs[i + 1] - zs[i]) * (f - i);
      return out;
    },
    chord(s) {
      const k = ease(s);
      return rootChord + (ownChord(s) - rootChord) * k;
    },
    twist: (s) => twist * (1 - ease(s)),
    aft: { x: -1, y: 0, z: 0 },
    up: { x: 0, y: -Math.sin(mid), z: -Math.cos(mid) },
    upAt(s, out) {
      const a = upAngle(s);
      out.x = 0;
      out.y = -Math.sin(a);
      out.z = -Math.cos(a);
      return out;
    },
  };
}

/**
 * Horizontal stabiliser (right side). The elevator hinge line is straight and perpendicular to the
 * centreline as on the real aircraft, so the planform is referenced to it: the leading edge sweeps back
 * and the trailing edge forward as the chord tapers. A swept tailplane (tipQuarterChordX) has its
 * quarter-chord line running straight from root to tip instead and the hinge line following from it; a
 * stabilator is referenced to its pivot line.
 */
export function makeStabPlanform(tail: TailVisualDef): Planform {
  const h = tail.h;
  const hinge = h.kind === 'stabilator' ? (h.pivotFraction ?? 0.25) : 1 - h.chordFraction;
  const half = h.span / 2;
  const hingeX = h.quarterChord.x - (hinge - 0.25) * h.rootChord;
  const chord = (y: number): number => h.rootChord + (h.tipChord - h.rootChord) * Math.min(1, Math.max(0, y / half));
  const tipQcX = h.tipQuarterChordX;
  return {
    refFrac: hinge,
    ref(y, out) {
      out.x = tipQcX === undefined ? hingeX : h.quarterChord.x + (tipQcX - h.quarterChord.x) * Math.min(1, Math.max(0, y / half)) - (hinge - 0.25) * chord(y);
      out.y = y;
      out.z = h.quarterChord.z;
      return out;
    },
    chord(y) {
      return h.rootChord + (h.tipChord - h.rootChord) * Math.min(1, Math.max(0, y / half));
    },
    twist: () => h.incidence,
    aft: { x: -1, y: 0, z: 0 },
    up: { x: 0, y: 0, z: -1 },
  };
}

/** Fin: span parameter h = metres above the fin base (along -z); quarter-chord line from base to tip. */
export function makeFinPlanform(tail: TailVisualDef): Planform {
  const v = tail.v;
  const span = v.base.z - v.tip.z;
  return {
    refFrac: 0.25,
    ref(h, out) {
      const t = h / span;
      out.x = v.base.x + (v.tip.x - v.base.x) * t;
      out.y = 0;
      out.z = v.base.z - h;
      return out;
    },
    chord(h) {
      return v.rootChord + ((v.tipChord - v.rootChord) * h) / span;
    },
    twist: () => 0,
    aft: { x: -1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
  };
}

/**
 * The fin planform referenced to the rudder hinge line (span parameter h as for the fin), continued below the
 * fin base for a rudder with a lower extension (growing aft chord).
 */
export function makeRudderPlanform(tail: TailVisualDef): Planform {
  const fin = makeFinPlanform(tail);
  const hinge = 1 - tail.v.rudderChordFraction;
  const extension = tail.v.rudderExtension;
  // Where the hinge line crosses the fin base and its slope per metre of fin height.
  const base = sectionPoint(fin, 0, hinge, 0);
  const slope = (() => {
    const p = sectionPoint(fin, 1, hinge, 0);
    return { x: p.x - base.x, z: p.z - base.z };
  })();
  return {
    ...fin,
    refFrac: hinge,
    ref(h, out) {
      out.x = base.x + slope.x * h;
      out.y = 0;
      out.z = base.z + slope.z * h;
      return out;
    },
    chord(h) {
      if (h >= 0 || !extension) return fin.chord(h);
      const aft = (1 - hinge) * fin.chord(0);
      const t = h / extension.bottomH;
      return (aft + (extension.aftChord - aft) * t * t) / (1 - hinge);
    },
  };
}
