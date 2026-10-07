// Lifting-surface geometry: planform descriptions and their subdivision into spanwise strips.
//
// Every strip carries one horseshoe vortex: the bound segment a->b lies on the quarter-chord line and
// its boundary condition is applied at the three-quarter-chord control point (Weissinger / Pistolesi),
// which gives the right lift slope for low-aspect-ratio tails as well as for the wing.
//
// Section frame of a strip (body axes). Sections are streamwise, as in Weissinger's method, so a swept
// strip (the fin) keeps its streamwise chord and 3/4-chord control point:
//   s  unit vector along the bound vortex a->b (to the right on wings and tailplane, downward on the fin)
//   t  unit streamwise chord vector, leading edge -> trailing edge, rotated by the local incidence
//   n  = t x s normalised, the "upper surface" normal (up on the wing, to the right on the fin)
//   e  = n x t, the axis of a nose-up section moment
// Angle of attack is atan2(U.n, U.t) for the air velocity U relative to the strip; the velocity
// component along e is ignored (independence principle). Lift is perpendicular to the in-plane flow.

import { v3, type Vec3 } from '../../core/math';
import type { SurfaceState } from '../../core/types';
import { blendSections, makeFlapModel, type AirfoilSection, type FlapGeometry, type FlapModel } from './airfoil';

export type SurfaceId = 'wing' | 'hTail' | 'vTail';

/** A control surface acting on part of a strip. Deflection = gain * surfaces[source] * coverage. */
export interface ControlLink {
  source: keyof SurfaceState;
  gain: number;
  flap: FlapModel;
  /** Fraction of the strip span covered by the surface. */
  coverage: number;
}

export interface Strip {
  surface: SurfaceId;
  /** -1 left half, 0 centre/fin, +1 right half. */
  side: -1 | 0 | 1;
  /** Bound-vortex ends on the quarter-chord line (reference-point body axes). */
  a: Vec3;
  b: Vec3;
  /** Quarter-chord midpoint, where the strip force acts. */
  mid: Vec3;
  /** Three-quarter-chord control point. */
  cp: Vec3;
  t: Vec3;
  n: Vec3;
  s: Vec3;
  e: Vec3;
  chord: number;
  area: number;
  /** Spanwise coordinate of the strip centre (|y| on horizontal surfaces, height on the fin), m. */
  span: number;
  section: AirfoilSection;
  /** Separated-flow normal-force coefficient for this surface (finite aspect ratio). */
  cd90: number;
  /** Production-surface multiplier on the smooth-section minimum drag. */
  skinFactor: number;
  /**
   * Section lift-slope multiplier for leakage through an unsealed control-surface hinge gap (1 = sealed or
   * no gap). It scales the lift of the whole section, control deflection included.
   */
  liftSlopeFactor: number;
  controls: ControlLink[];
  /**
   * Lift carry-over across the fuselage: the strip has no section of its own; its circulation is the
   * mean of its two neighbours (circulation continuous through the body) and its force follows from
   * Kutta-Joukowski. Its profile drag is part of the fuselage.
   */
  carryover: boolean;
  /**
   * The strip spans the fuselage but has its own section: a high wing whose centre section is continued over
   * the cabin roof. It carries its own circulation (so a part-span flap's load is not carried across the cabin:
   * the flap-edge vortices are shed at the flap's inner end and the cabin section only feels their upwash), and
   * its profile drag is part of the fuselage's.
   */
  bodySection: boolean;
  /**
   * Index, in the definition's list this strip belongs to (`wing` or `tail`), of the strip whose separation state
   * a bodySection strip follows. buildStrips sets it on the strips of a body band, as an index into the list it
   * returns. Absent: the centre sections of `centre: 'body'` follow the exposed strip beside them, any other strip
   * its own.
   */
  separationFrom?: number;
  /**
   * Resolve the strip's force about the flow at the midpoint of its bound vortex (Kutta-Joukowski near-field
   * force, Katz & Plotkin sec. 12.3) instead of at its control point; the section lift and its size are still
   * those of the control point. Set on the strips of a `generalIncidence` planform: on a non-planar line
   * (winglets) the control point's induced angle tilts the force by the wrong amount, so the saving and the
   * yawing moment of a winglet would be wrong. Absent: at the control point.
   */
  forceAtBound?: boolean;
}

export interface PlanformStation {
  /** Spanwise coordinate: |y| for a horizontal surface, height above the root for a fin, m. */
  span: number;
  /** Quarter-chord point of the right-hand (or only) half. */
  qc: Vec3;
  chord: number;
  /** Incidence relative to the body x axis, rad (+ = leading edge up / toward the upper surface). */
  incidence: number;
  /** Section at this station; strips between two stations blend theirs. Absent: the planform's section. */
  section?: AirfoilSection;
}

export interface PlanformControl {
  source: keyof SurfaceState;
  /** Source used on the mirrored (left) half; null = this control exists on the right half only. */
  mirrorSource?: keyof SurfaceState | null;
  gain: number;
  geometry: FlapGeometry;
  /** Spanwise extent (same coordinate as the stations). */
  from: number;
  to: number;
}

export interface Planform {
  surface: SurfaceId;
  section: AirfoilSection;
  /**
   * true: symmetric surface. `edges[0]` is the half-width of the fuselage, spanned by a single
   * carry-over strip, followed by the outboard strip edges of the right half; the left half is mirrored.
   * false: single surface (fin) with bound vortices running from the tip toward the root.
   */
  mirror: boolean;
  stations: PlanformStation[];
  edges: number[];
  controls: PlanformControl[];
  cd90: number;
  skinFactor: number;
  /** See Strip.liftSlopeFactor (default 1). */
  liftSlopeFactor?: number;
  /**
   * Symmetric surfaces: how the part across the fuselage is represented. 'carryover' (default): one strip whose
   * circulation is the mean of its neighbours'. 'body': two lifting strips (left and right of the plane of
   * symmetry) with the root section and no control surfaces (Strip.bodySection). 'none': the two halves meet at
   * y = 0 with nothing between (T-tail on a fin); edges[0] must be 0.
   */
  centre?: 'carryover' | 'body' | 'none';
  /**
   * Spanwise bands whose strips lie on a body (wing across a nacelle): Strip.bodySection = true, controls kept.
   * A strip belongs to a band when its centre does (put strip edges on the band's ends); it follows the
   * separation state of the nearest strip outside the band (the inboard one when two are equally near).
   */
  bodyBands?: { from: number; to: number }[];
  /**
   * Local section replacement (stall strips). A strip wholly inside a band takes the band's section; one partly
   * covered takes the blend of its own and the band's by the covered fraction of its span.
   */
  sectionBands?: { from: number; to: number; section: AirfoilSection }[];
  /**
   * Rotate incidence about each strip's own span axis instead of body y (winglets): t = -cos(i) x + sin(i) m with
   * m = x cross s normalised, so a positive incidence still turns the leading edge toward the strip's upper
   * surface: up on a wing panel, toe-in on a winglet standing on the tip. Default false: on a wing with dihedral
   * the two differ by sin(i) sin(dihedral) in t.y. Also puts the force of every strip at its bound vortex
   * (Strip.forceAtBound).
   */
  generalIncidence?: boolean;
}

function stationAt(p: Planform, span: number): { qc: Vec3; chord: number; incidence: number } {
  const st = p.stations;
  let i = 0;
  while (i < st.length - 2 && span > st[i + 1].span) i++;
  const s0 = st[i], s1 = st[i + 1];
  const f = (span - s0.span) / (s1.span - s0.span);
  return {
    qc: v3.lerp(s0.qc, s1.qc, f),
    chord: s0.chord + (s1.chord - s0.chord) * f,
    incidence: s0.incidence + (s1.incidence - s0.incidence) * f,
  };
}

/**
 * Section of the strip [e0, e1]: the planform's, or the blend of the sections of the two stations round the
 * strip's centre where stations carry their own (PlanformStation.section), then the section bands.
 */
function sectionFor(p: Planform, e0: number, e1: number): AirfoilSection {
  let section = p.section;
  const st = p.stations;
  if (st.some((s) => s.section !== undefined)) {
    const span = 0.5 * (e0 + e1);
    let i = 0;
    while (i < st.length - 2 && span > st[i + 1].span) i++;
    const f = (span - st[i].span) / (st[i + 1].span - st[i].span);
    section = blendSections(st[i].section ?? p.section, st[i + 1].section ?? p.section, Math.min(Math.max(f, 0), 1));
  }
  for (const band of p.sectionBands ?? []) {
    const covered = (Math.min(e1, band.to) - Math.max(e0, band.from)) / (e1 - e0);
    if (covered >= 1 - 1e-9) section = band.section;
    else if (covered > 1e-3) section = blendSections(section, band.section, covered);
  }
  return section;
}

/** Planform area between two spanwise coordinates (exact for the piecewise-linear chord). */
function areaBetween(p: Planform, e0: number, e1: number): number {
  const cuts = [e0, ...p.stations.map((s) => s.span).filter((s) => s > e0 && s < e1), e1];
  let area = 0;
  for (let k = 0; k + 1 < cuts.length; k++) {
    area += 0.5 * (stationAt(p, cuts[k]).chord + stationAt(p, cuts[k + 1]).chord) * (cuts[k + 1] - cuts[k]);
  }
  return area;
}

const mirrorY = (v: Vec3): Vec3 => ({ x: v.x, y: -v.y, z: v.z });

function makeStrip(
  p: Planform,
  side: -1 | 0 | 1,
  a: Vec3,
  b: Vec3,
  area: number,
  chord: number,
  incidence: number,
  span: number,
  controls: ControlLink[],
  section: AirfoilSection = p.section,
): Strip {
  const s = v3.normalize(v3.sub(b, a));
  let t = { x: -Math.cos(incidence), y: 0, z: Math.sin(incidence) };
  if (p.generalIncidence) {
    const m = v3.normalize(v3.cross({ x: 1, y: 0, z: 0 }, s));
    t = { x: -Math.cos(incidence), y: Math.sin(incidence) * m.y, z: Math.sin(incidence) * m.z };
  }
  const n = v3.normalize(v3.cross(t, s));
  const mid = v3.lerp(a, b, 0.5);
  const strip: Strip = {
    surface: p.surface,
    side,
    a,
    b,
    mid,
    cp: v3.addScaled(mid, t, chord / 2),
    t,
    n,
    s,
    e: v3.cross(n, t),
    chord,
    area,
    span,
    section,
    cd90: p.cd90,
    skinFactor: p.skinFactor,
    liftSlopeFactor: p.liftSlopeFactor ?? 1,
    controls,
    carryover: false,
    bodySection: false,
  };
  if (p.generalIncidence) strip.forceAtBound = true;
  return strip;
}

/** Integral of a unit ramp rising from 0 at x = -w/2 to 1 at x = +w/2, from -infinity to x. */
function rampIntegral(x: number, w: number): number {
  if (x <= -w / 2) return 0;
  if (x >= w / 2) return x;
  const u = x + w / 2;
  return (u * u) / (2 * w);
}

/**
 * Controls acting on the strip [e0, e1]. The load of a part-span surface does not end abruptly: it
 * decays over about one surface chord at each end, so the spanwise weight is a trapezoid whose ramps
 * are one surface chord wide, averaged over the strip.
 */
function controlsFor(p: Planform, e0: number, e1: number, mirrored: boolean): ControlLink[] {
  const links: ControlLink[] = [];
  for (const c of p.controls) {
    const source = mirrored ? (c.mirrorSource === undefined ? c.source : c.mirrorSource) : c.source;
    if (source === null) continue;
    if (c.geometry.kind === 'allMoving') {
      // The whole surface turns on one hinge: no end ramps, the part of the strip inside the extent turns fully.
      const inside = (Math.min(e1, c.to) - Math.max(e0, c.from)) / (e1 - e0);
      if (inside > 1e-3) links.push({ source, gain: c.gain, flap: makeFlapModel(c.geometry), coverage: Math.min(inside, 1) });
      continue;
    }
    const w0 = c.geometry.chordFraction * stationAt(p, c.from).chord;
    const w1 = c.geometry.chordFraction * stationAt(p, c.to).chord;
    // Weight = ramp up at `from` minus ramp down at `to`; its integral over [e0, e1]:
    const inner = (x: number) => rampIntegral(x - c.from, w0) - rampIntegral(x - c.to, w1);
    const coverage = (inner(e1) - inner(e0)) / (e1 - e0);
    if (coverage <= 1e-3) continue;
    links.push({ source, gain: c.gain, flap: makeFlapModel(c.geometry), coverage: Math.min(coverage, 1) });
  }
  return links;
}

/**
 * Mark the strips of the planform's body bands (Planform.bodyBands) in a finished strip list: `spans[k]` is the
 * spanwise coordinate of strips[k]'s centre and `halves[k]` the half it belongs to (bands apply to both halves of
 * a mirrored surface). Each marked strip follows the separation state of the nearest unmarked strip of its half.
 */
function applyBodyBands(p: Planform, strips: Strip[], spans: number[], halves: number[]): void {
  const bands = p.bodyBands;
  if (!bands || bands.length === 0) return;
  const inBand = spans.map((y, k) => !strips[k].carryover && bands.some((b) => y >= b.from && y <= b.to));
  for (let k = 0; k < strips.length; k++) {
    if (!inBand[k]) continue;
    let best = -1;
    for (let j = 0; j < strips.length; j++) {
      if (inBand[j] || halves[j] !== halves[k] || strips[j].carryover || strips[j].bodySection) continue;
      const d = Math.abs(j - k), db = Math.abs(best - k);
      if (best < 0 || d < db || (d === db && spans[j] < spans[best])) best = j;
    }
    strips[k].bodySection = true;
    if (best >= 0) strips[k].separationFrom = best;
  }
}

/** Subdivide a planform into strips (left half first for symmetric surfaces, then centre, then right). */
export function buildStrips(p: Planform): Strip[] {
  const e = p.edges;
  if (!p.mirror) {
    const strips: Strip[] = [];
    for (let k = 0; k + 1 < e.length; k++) {
      const s0 = stationAt(p, e[k]), s1 = stationAt(p, e[k + 1]);
      const area = areaBetween(p, e[k], e[k + 1]);
      const inc = stationAt(p, 0.5 * (e[k] + e[k + 1])).incidence;
      // Bound vortex runs from the outer end toward the root.
      strips.push(makeStrip(p, 0, s1.qc, s0.qc, area, area / (e[k + 1] - e[k]), inc, 0.5 * (e[k] + e[k + 1]), controlsFor(p, e[k], e[k + 1], false), sectionFor(p, e[k], e[k + 1])));
    }
    applyBodyBands(p, strips, strips.map((st) => st.span), strips.map(() => 0));
    return strips;
  }
  const right: Strip[] = [];
  const left: Strip[] = [];
  for (let k = 0; k + 1 < e.length; k++) {
    const s0 = stationAt(p, e[k]), s1 = stationAt(p, e[k + 1]);
    const area = areaBetween(p, e[k], e[k + 1]);
    const chord = area / (e[k + 1] - e[k]);
    const inc = stationAt(p, 0.5 * (e[k] + e[k + 1])).incidence;
    const span = 0.5 * (e[k] + e[k + 1]);
    const section = sectionFor(p, e[k], e[k + 1]);
    right.push(makeStrip(p, 1, s0.qc, s1.qc, area, chord, inc, span, controlsFor(p, e[k], e[k + 1], false), section));
    left.unshift(makeStrip(p, -1, mirrorY(s1.qc), mirrorY(s0.qc), area, chord, inc, span, controlsFor(p, e[k], e[k + 1], true), section));
  }
  const finish = (strips: Strip[]): Strip[] => {
    applyBodyBands(p, strips, strips.map((st) => st.span), strips.map((st) => st.side));
    return strips;
  };
  const c0 = stationAt(p, 0);
  const half = e[0];
  if (p.centre === 'none') {
    // The two halves meet in the plane of symmetry: the root strips are neighbours on one lifting line, and their
    // root trailing legs leave from the same point (a fin tip placed there closes the junction).
    if (half !== 0) throw new Error("buildStrips: centre 'none' needs edges[0] = 0");
    return finish([...left, ...right]);
  }
  const centreArea = 2 * areaBetween(p, 0, half);
  // The centre takes the section at the plane of symmetry (the planform's unless the root station carries one).
  const centreSection = p.stations[0].section ?? p.section;
  // An all-moving surface carried through the body (a stabilator) turns as one piece, its centre included.
  const centreControls = (): ControlLink[] =>
    p.controls
      .filter((c) => c.geometry.kind === 'allMoving' && c.from <= 0)
      .map((c) => ({ source: c.source, gain: c.gain, flap: makeFlapModel(c.geometry), coverage: 1 }));
  if (p.centre === 'body') {
    const area = centreArea / 2;
    const mid = { x: c0.qc.x, y: 0, z: c0.qc.z };
    const l = makeStrip(p, -1, { x: c0.qc.x, y: -half, z: c0.qc.z }, mid, area, area / half, c0.incidence, half / 2, centreControls(), centreSection);
    const r = makeStrip(p, 1, mid, { x: c0.qc.x, y: half, z: c0.qc.z }, area, area / half, c0.incidence, half / 2, centreControls(), centreSection);
    l.bodySection = r.bodySection = true;
    return finish([...left, l, r, ...right]);
  }
  const centre = makeStrip(
    p,
    0,
    { x: c0.qc.x, y: -half, z: c0.qc.z },
    { x: c0.qc.x, y: half, z: c0.qc.z },
    centreArea,
    centreArea / (2 * half),
    c0.incidence,
    0,
    centreControls(),
    centreSection,
  );
  centre.carryover = true;
  return finish([...left, centre, ...right]);
}

/** A fin standing on a body in the plane of symmetry (see buildFin). */
export interface FinPlanform {
  section: AirfoilSection;
  /** Quarter-chord points of the exposed fin's base and tip, and the chords there. */
  base: { x: number; z: number };
  tip: { x: number; z: number };
  rootChord: number;
  tipChord: number;
  /** Height (body z) of the body's axis at the base station, below the base: the panel is continued down to it. */
  axisZ: number;
  /** Strip edges between the base and the tip, as heights above the base, m (ascending; the two ends are added). */
  edges: number[];
  /** Extents are heights above the panel's lower end on the body axis (the spanwise coordinate of its strips). */
  controls: PlanformControl[];
  cd90: number;
  skinFactor: number;
  /** See Strip.liftSlopeFactor (default 1). */
  liftSlopeFactor?: number;
}

/**
 * Strips of a fin: the quarter-chord line through the given base and tip, chord varying linearly. The base
 * sits just inside the body; the panel is continued down to the body's axis and no further (one strip from the
 * axis to the base, then the given edges). That is the slender-body convention for a surface mounted on a body
 * (Nielsen, "Missile Aerodynamics", ch. 5): the panel extended to the body axis stands for the exposed fin plus
 * the side force it induces on the body. Taking it lower would count the tail cone itself as lifting surface,
 * on top of the fuselage's own cross-flow loads.
 */
export function buildFin(f: FinPlanform): Strip[] {
  const { base, tip } = f;
  const baseToTip = base.z - tip.z;
  const below = f.axisZ - base.z;
  const perHeight = { x: (tip.x - base.x) / baseToTip, z: -1 };
  const chordSlope = (f.tipChord - f.rootChord) / baseToTip;
  const finAt = (hgt: number): PlanformStation => ({
    span: hgt,
    qc: { x: base.x + perHeight.x * (hgt - below), y: 0, z: base.z + perHeight.z * (hgt - below) },
    chord: f.rootChord + chordSlope * (hgt - below),
    incidence: 0,
  });
  return buildStrips({
    surface: 'vTail',
    section: f.section,
    mirror: false,
    stations: [finAt(0), finAt(below + baseToTip)],
    edges: [0, below, ...f.edges.map((h) => below + h), below + baseToTip],
    controls: f.controls,
    cd90: f.cd90,
    skinFactor: f.skinFactor,
    liftSlopeFactor: f.liftSlopeFactor,
  });
}
