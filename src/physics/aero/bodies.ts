// Non-lifting bodies: the fuselage and the discrete parasite-drag items (gear, struts, cooling flow).
//
// Fuselage, split into segments between cross-section stations, each seeing its own local air velocity
// (so rotation gives damping and the slipstream adds drag and side force):
//  - Slender-body potential flow (Munk 1924): a segment whose cross-section area S changes along the
//    flow carries a normal force  dF = rho V_axial V_cross dS  in the direction of the cross-flow (a
//    download where the body narrows). Following Hopkins (NACA RM A51C14, the method DATCOM uses for
//    fuselages) potential flow holds from the nose back to x0 = 0.378 L + 0.527 x1, where x1 is the
//    station of steepest area decrease; behind x0 the thick boundary layer of the afterbody leaves only
//    viscous cross-flow. The result is the destabilising Munk moment in pitch and yaw. In reverse flow
//    only growing sections carry potential load (Jorgensen, NASA TR R-474).
//  - Viscous cross-flow (Allen & Perkins, NACA TR 1048): dF = 0.5 rho eta Cdc D |V_cross| V_cross dx.
//  - Axial skin-friction and form drag, as an equivalent flat-plate area distributed by wetted area.
// Parasite items are ellipsoidal drag bodies: flat-plate areas facing the x, y and z body axes, combined
// by the direction cosines of the local flow, with the force along the local flow.
// An engine nacelle is the same slender body on an axis off the centre line (FuselageDefinition.axis): its Munk
// moment, cross-flow and axial drag act at its own segments, and its sources slow the air at the disc ahead of it.

import type { Vec3 } from '../../core/math';
import type { DragScales } from '../interfaces';
import type { MutableVec3 } from './vortex';

export interface FuselageStation {
  x: number;
  width: number;
  height: number;
  /** Height of the section centre, body z (down), m. */
  z: number;
  /**
   * Lateral added-mass (doublet strength) of the section relative to the ellipse of the same width and height
   * (default 1). A slab-sided, flat-roofed cabin with small corner radii deflects more side flow than its
   * inscribed ellipse: potential-flow added-mass coefficients of rounded rectangles lie between the ellipse's
   * (1) and the sharp-cornered square's (1.51 on the inscribed circle; Patton 1965, DNV-RP-C205 table D-1).
   * The same box factor applies to the section's added mass in vertical cross-flow (the slender-body term).
   */
  lateralMass?: number;
}

export interface FuselageDefinition {
  /** Ordered nose to tail (decreasing x). */
  stations: FuselageStation[];
  /** Axial drag as an equivalent flat-plate area at the reference Reynolds number, m^2. */
  axialDragArea: number;
  /**
   * Skin-friction share of the axial drag and the length Reynolds number it refers to: turbulent skin
   * friction scales as Re^-0.2 (Schlichting), the rest (form, cowl and windshield separation) is taken as
   * independent of Reynolds number.
   */
  skinFrictionFraction: number;
  referenceReynolds: number;
  /** eta * Cdc of the viscous cross-flow term (finite-length factor times section drag coefficient). */
  crossflowDrag: number;
  /** Apparent-mass factor (k2 - k1) of the slender-body term. */
  apparentMass: number;
  /**
   * Lateral / vertical position of the body axis (nacelles): the stations' section centres lie at y = axis.y and
   * z = axis.z + station.z. Absent: the centre line.
   */
  axis?: { y: number; z: number };
}

/** Height (body z) of a body's cross-section centre at station x (the ends' beyond them), its axis offset included. */
export function bodyAxisZ(def: FuselageDefinition, x: number): number {
  const st = def.stations;
  let k = 0;
  while (k < st.length - 2 && x < st[k + 1].x) k++;
  const f = (st[k].x - x) / (st[k].x - st[k + 1].x);
  const z = st[k].z + (st[k + 1].z - st[k].z) * Math.min(Math.max(f, 0), 1);
  return def.axis ? z + def.axis.z : z;
}

/** The run-time quantity (AeroInput.dragScales) that scales a DragItem's area. */
export type DragScaleRef = { kind: 'gear'; leg: 0 | 1 | 2 } | { kind: 'cowlFlap'; engine: number };

export interface DragItem {
  name: string;
  position: Vec3;
  /** Flat-plate drag area presented to flow along body x, y and z, m^2. */
  area: Vec3;
  /** Area is multiplied by lerp(retractedFraction ?? 0, 1, value) where value comes from AeroInput.dragScales. */
  scale?: DragScaleRef;
  retractedFraction?: number;
}

/** Air velocity relative to the airframe at a body point (reference-point axes). */
export interface FlowSampler {
  sample(p: Vec3, out: MutableVec3): void;
  /**
   * Air velocity a body section of half-width a and half-height b centred at p sees as a whole: the mean round
   * the section's outline of any non-uniform part of the flow (the propeller's swirl), which is the cross-flow
   * induced by the vorticity outside the body. Returns the variance of the cross-flow round the outline about that
   * mean (m^2/s^2): the swirl's own speed over the skin, which loads the skin but not the side.
   * Absent: the point sample, no variance.
   */
  sampleSection?(p: Vec3, a: number, b: number, out: MutableVec3): number;
}

/** Collects forces applied at body points into a total force and moment. */
export interface LoadAccumulator {
  addForce(p: Vec3, fx: number, fy: number, fz: number): void;
}

interface Segment {
  centre: Vec3;
  length: number;
  width: number;
  height: number;
  /** Aft-minus-fore cross-section area, m^2. */
  dArea: number;
  /**
   * Aft-minus-fore added-mass area (added mass per unit length / rho) for vertical and for lateral cross-flow, m^2.
   * An elliptic section of width w and height h has pi w^2 / 4 in vertical and pi h^2 / 4 in lateral cross-flow
   * (the dimension across the flow counts: Milne-Thomson, "Theoretical Hydrodynamics" sec. 9.51), times the
   * section's box factor (FuselageStation.lateralMass).
   */
  dMassZ: number;
  dMassY: number;
  axialArea: number;
  /** Inside the potential-flow region (Hopkins) for flow from the nose. */
  potential: boolean;
}

const flow: MutableVec3 = { x: 0, y: 0, z: 0 };

export class Fuselage {
  private readonly segments: Segment[];
  /** Segment centres, where the segment loads act and the local flow is sampled. */
  readonly points: readonly Vec3[];
  /** Position of the body's axis (FuselageDefinition.axis; 0 on the centre line). */
  private readonly axisY: number;
  private readonly axisZ: number;

  constructor(private readonly def: FuselageDefinition) {
    const st = def.stations;
    const axis = def.axis;
    this.axisY = axis ? axis.y : 0;
    this.axisZ = axis ? axis.z : 0;
    const segs: Omit<Segment, 'axialArea' | 'potential'>[] = [];
    const wetted: number[] = [];
    const area = (s: FuselageStation) => (Math.PI / 4) * s.width * s.height;
    const massZ = (s: FuselageStation) => (Math.PI / 4) * s.width * s.width * (s.lateralMass ?? 1);
    const massY = (s: FuselageStation) => area(s);
    for (let k = 0; k + 1 < st.length; k++) {
      const f = st[k], a = st[k + 1];
      const length = f.x - a.x;
      const width = 0.5 * (f.width + a.width);
      const height = 0.5 * (f.height + a.height);
      const centre = axis ? { x: 0.5 * (f.x + a.x), y: axis.y, z: 0.5 * (f.z + a.z) + axis.z } : { x: 0.5 * (f.x + a.x), y: 0, z: 0.5 * (f.z + a.z) };
      segs.push({ centre, length, width, height, dArea: area(a) - area(f), dMassZ: massZ(a) - massZ(f), dMassY: massY(a) - massY(f) });
      // Ellipse perimeter (Ramanujan's first approximation, adequate here) times length.
      wetted.push(Math.PI * (0.75 * (width + height) - 0.5 * Math.sqrt(width * height)) * length);
    }
    const total = wetted.reduce((s, w) => s + w, 0);
    // Hopkins' end of potential flow, as a distance aft of the nose.
    const nose = st[0].x;
    const bodyLength = nose - st[st.length - 1].x;
    let steepest = segs[0];
    for (const g of segs) if (g.dArea / g.length < steepest.dArea / steepest.length) steepest = g;
    const x0 = 0.378 * bodyLength + 0.527 * (nose - steepest.centre.x);
    this.segments = segs.map((g, k) => ({ ...g, axialArea: (def.axialDragArea * wetted[k]) / total, potential: nose - g.centre.x < x0 }));
    this.points = this.segments.map((s) => s.centre);
  }

  /**
   * Cross-section of the fuselage at body station x (all 0 outside): equivalent radius, centre height, and
   * the strength of the 2-D doublet that represents the elliptic section in LATERAL cross-flow, per unit
   * lateral velocity (m^2). An ellipse with semi-axis a along the flow and b across it has the far field of
   * a doublet of strength b (a + b) / 2 (b^2 for a flat plate across the flow, R^2 for a circle); the cabin
   * is taller than it is wide, so it deflects more side flow than a circle of the same area.
   */
  sectionAt(x: number, out: { radius: number; z: number; lateralDoublet: number }): void {
    const st = this.def.stations;
    out.radius = 0;
    out.z = 0;
    out.lateralDoublet = 0;
    if (x > st[0].x || x < st[st.length - 1].x) return;
    let k = 0;
    while (k < st.length - 2 && x < st[k + 1].x) k++;
    const f = (st[k].x - x) / (st[k].x - st[k + 1].x);
    const w = st[k].width + (st[k + 1].width - st[k].width) * f;
    const h = st[k].height + (st[k + 1].height - st[k].height) * f;
    out.radius = 0.5 * Math.sqrt(w * h);
    out.z = st[k].z + (st[k + 1].z - st[k].z) * f;
    if (this.def.axis) out.z += this.axisZ;
    const mass = (st[k].lateralMass ?? 1) + ((st[k + 1].lateralMass ?? 1) - (st[k].lateralMass ?? 1)) * f;
    out.lateralDoublet = 0.25 * h * (0.5 * (w + h)) * mass;
  }

  /**
   * Mean speed ratio u / U of the fuselage's boundary layer and viscous wake over the exposed part of a strip
   * a -> b that lies beside the body (the tailplane and fin roots on the tail cone), or NaN if no part of the
   * strip lies outside the body. Everything the fuselage has lost to drag ahead of the strip's station is still
   * in the layer around it there: momentum conservation gives the layer's momentum-deficit integral as half the
   * drag area shed ahead, over the annulus around the local section (equivalent radius r_b),
   *   2 pi delta (7/72 r_b + 7/240 delta) = f / 2,
   * for the 1/7-power turbulent profile u / U = (d / delta)^(1/7) at a distance d from the surface (Schlichting,
   * "Boundary-Layer Theory" ch. 21; the thick axisymmetric layer on a converging afterbody, whose momentum
   * thickness grows as the perimeter shrinks). On the C172 this puts the inboard third of each tailplane half in
   * a layer 0.4-0.5 m thick at about 0.8 of the free-stream dynamic pressure, the usual tail efficiency of
   * eta_t ~0.9-0.95 for a tail on the fuselage (Perkins & Hage, "Airplane Performance, Stability and Control",
   * sec. 5-4; DATCOM 4.4.1). The drag areas are those at the reference Reynolds number.
   */
  boundaryLayerSpeedRatio(a: Vec3, b: Vec3): number {
    const st = this.def.stations;
    const x = 0.5 * (a.x + b.x);
    if (x > st[0].x || x < st[st.length - 1].x) return 1;
    let k = 0;
    while (k < st.length - 2 && x < st[k + 1].x) k++;
    const f = (st[k].x - x) / (st[k].x - st[k + 1].x);
    const w = st[k].width + (st[k + 1].width - st[k].width) * f;
    const h = st[k].height + (st[k + 1].height - st[k].height) * f;
    let zc = st[k].z + (st[k + 1].z - st[k].z) * f;
    if (this.def.axis) zc += this.axisZ;
    const yc = this.axisY;
    // Drag area shed ahead of the station (the segment containing it in proportion).
    let dragArea = 0;
    for (const seg of this.segments) {
      const fore = seg.centre.x + 0.5 * seg.length;
      const aft = seg.centre.x - 0.5 * seg.length;
      if (aft >= x) dragArea += seg.axialArea;
      else if (fore > x) dragArea += (seg.axialArea * (fore - x)) / seg.length;
    }
    if (!(dragArea > 0) || !(w > 0) || !(h > 0)) return 1;
    const rb = 0.5 * Math.sqrt(w * h);
    // 2 pi delta (7/72 rb + 7/240 delta) = dragArea / 2, solved for delta.
    const qa = (2 * Math.PI * 7) / 240, qb = (2 * Math.PI * 7 * rb) / 72, qc = -dragArea / 2;
    const delta = (-qb + Math.sqrt(qb * qb - 4 * qa * qc)) / (2 * qa);
    const ha = 0.5 * w, hb = 0.5 * h;
    const n = 16;
    let sum = 0, count = 0;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const y = a.y + (b.y - a.y) * u - yc;
      const z = a.z + (b.z - a.z) * u - zc;
      const r = Math.hypot(y, z);
      if (r < 1e-9) continue;
      const c = y / r, sn = z / r;
      // Distance from the elliptical section's surface along the ray from its centre.
      const d = r - (ha * hb) / Math.sqrt((hb * c) ** 2 + (ha * sn) ** 2);
      if (d <= 0) continue;
      sum += d < delta ? Math.pow(d / delta, 1 / 7) : 1;
      count++;
    }
    // A strip mostly inside the body has too little exposed span to sample.
    return count >= n / 2 ? sum / count : NaN;
  }

  /**
   * Axial velocity the fuselage induces at body point p per unit of axial free-stream speed (+ = forward, i.e. it
   * slows air arriving from ahead). Slender-body potential flow: the body is a line of sources of strength
   * V dS/ds along its axis (s aft; sinks where it narrows), each inducing u = q (x_p - x) / (4 pi d^3) along the
   * axis (Munk; Thwaites, "Incompressible Aerodynamics" ch. 9). Ahead of the cowl this is the blockage the
   * propeller disc sits in. Distances are measured from the body's own axis, so a nacelle slows the air at the
   * disc ahead of it and hardly at all at a disc 4 m to its side.
   */
  axialBlockage(p: Vec3): number {
    const st = this.def.stations;
    const area = (s: FuselageStation) => (Math.PI / 4) * s.width * s.height;
    let u = 0;
    for (let k = 0; k + 1 < st.length; k++) {
      const f = st[k], a = st[k + 1];
      const n = 40;
      const growth = (area(a) - area(f)) / n; // source strength per V over one sub-segment
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = f.x + (a.x - f.x) * t;
        const z = f.z + (a.z - f.z) * t;
        const dx = p.x - x, dy = p.y - this.axisY, dz = p.z - z - this.axisZ;
        const dr2 = dy * dy + dz * dz;
        const d2 = dx * dx + dr2;
        if (d2 < 1e-6) continue;
        u += (growth * dx) / (4 * Math.PI * d2 * Math.sqrt(d2));
      }
    }
    return u;
  }

  /**
   * Accumulate the fuselage loads. `induced` holds an extra air velocity at each of `points` (xyz
   * interleaved, from `offset`): the wing's upwash and downwash field.
   */
  addLoads(rho: number, sampler: FlowSampler, induced: Float64Array, offset: number, loads: LoadAccumulator, viscosity = 1.79e-5): void {
    const { crossflowDrag, apparentMass, skinFrictionFraction, referenceReynolds } = this.def;
    // Reynolds number of the whole body from the free stream seen at the nose segment's flow sample.
    const st = this.def.stations;
    const length = st[0].x - st[st.length - 1].x;
    sampler.sample(this.segments[0].centre, flow);
    const re = Math.max((rho * Math.hypot(flow.x, flow.y, flow.z) * length) / viscosity, 1e5);
    const axialScale = 1 - skinFrictionFraction + skinFrictionFraction * Math.pow(re / referenceReynolds, -0.2);
    for (let k = 0; k < this.segments.length; k++) {
      const seg = this.segments[k];
      // The cross-flow that loads a section is the mean round its outline (FlowSampler.sampleSection): a section
      // inside the propeller's swirl, round its axis, has the rotating air flowing round it with no net cross-flow,
      // while the point at its centre may see the swirl's full speed.
      let swirl2 = 0;
      if (sampler.sampleSection) swirl2 = sampler.sampleSection(seg.centre, 0.5 * seg.width, 0.5 * seg.height, flow);
      else sampler.sample(seg.centre, flow);
      const j = offset + 3 * k;
      const ux = flow.x + induced[j], uy = flow.y + induced[j + 1], uz = flow.z + induced[j + 2];
      const cross = Math.sqrt(uy * uy + uz * uz);
      // Skin friction follows the speed of the air over the skin, the swirl's included (Hoerner, "Fluid-Dynamic
      // Drag" ch. 2: friction grows with the local resultant speed), while only the mean cross-flow loads the side.
      const speed = Math.sqrt(ux * ux + cross * cross + swirl2);
      const fx = 0.5 * rho * seg.axialArea * axialScale * speed * ux;
      let fy = 0, fz = 0;
      if (cross > 1e-6) {
        // Munk term (the flow runs aft when ux < 0).
        const sgn = ux < 0 ? 1 : -1;
        const inPotentialFlow = ux < 0 ? seg.potential : sgn * seg.dArea > 0;
        const k = inPotentialFlow ? rho * Math.abs(ux) * apparentMass : 0;
        const potY = k * sgn * seg.dMassY, potZ = k * sgn * seg.dMassZ;
        // Cross-flow drag on the projected depth of the elliptical section.
        const cy = uy / cross, cz = uz / cross;
        const depth = Math.sqrt((seg.width * cz) ** 2 + (seg.height * cy) ** 2);
        const visc = 0.5 * rho * crossflowDrag * depth * seg.length * cross;
        fy = (potY + visc) * uy;
        fz = (potZ + visc) * uz;
      }
      loads.addForce(seg.centre, fx, fy, fz);
    }
  }
}

/**
 * Fraction of its area a scaled drag item presents: retractedFraction at value 0 (gear up, cowl flap closed)
 * rising linearly to 1 at value 1; 1 for an item without `scale`, or while the caller gives no scales.
 */
export function dragItemScale(item: DragItem, scales: DragScales | undefined): number {
  const ref = item.scale;
  if (ref === undefined || scales === undefined) return 1;
  const raw = ref.kind === 'gear' ? scales.gear[ref.leg] : scales.cowlFlaps[ref.engine];
  // A leg or an engine the caller's arrays do not hold counts as down / open.
  const value = raw === undefined || !Number.isFinite(raw) ? 1 : Math.min(Math.max(raw, 0), 1);
  const stowed = item.retractedFraction ?? 0;
  return stowed + (1 - stowed) * value;
}

/**
 * Forces of the discrete parasite-drag items; `induced` as for Fuselage.addLoads. `scales`: the run-time
 * multipliers of the items that carry a `scale` (their positions stay where they are).
 */
export function addDragItemLoads(
  items: readonly DragItem[],
  rho: number,
  sampler: FlowSampler,
  induced: Float64Array,
  offset: number,
  loads: LoadAccumulator,
  scales?: DragScales,
): void {
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    sampler.sample(it.position, flow);
    const j = offset + 3 * k;
    flow.x += induced[j];
    flow.y += induced[j + 1];
    flow.z += induced[j + 2];
    const sq = flow.x * flow.x + flow.y * flow.y + flow.z * flow.z;
    if (sq < 1e-12) continue;
    // f = sum(area_k cos^2), force = 0.5 rho f |U| U along the air flow.
    let f = (it.area.x * flow.x * flow.x + it.area.y * flow.y * flow.y + it.area.z * flow.z * flow.z) / sq;
    if (it.scale !== undefined) f *= dragItemScale(it, scales);
    const c = 0.5 * rho * f * Math.sqrt(sq);
    loads.addForce(it.position, c * flow.x, c * flow.y, c * flow.z);
  }
}

/**
 * A streamlined lift strut: a slender lifting surface from `root` (fuselage) to `tip` (wing), chord along
 * body x. In sideslip the flow crosses the inclined struts, which then lift like a pair of steep dihedral
 * panels (a stabilising rolling moment); in pitch both add a little lift. Each strut is end-plated by the
 * fuselage and the wing, so it has nearly its 2-D lift slope.
 */
export interface LiftingStrut {
  name: string;
  root: Vec3;
  tip: Vec3;
  chord: number;
  /** Lift-curve slope, 1/rad. */
  liftSlope: number;
  /** Largest lift coefficient (thick symmetric section, early stall). */
  clMax: number;
}

/** Midpoint of a strut (where its load acts and its flow is sampled). */
export const strutMidpoint = (s: LiftingStrut): Vec3 => ({ x: 0.5 * (s.root.x + s.tip.x), y: 0.5 * (s.root.y + s.tip.y), z: 0.5 * (s.root.z + s.tip.z) });

/** Lift of the struts (their drag is a DragItem); `induced` as for Fuselage.addLoads. */
export function addStrutLoads(
  struts: readonly LiftingStrut[],
  rho: number,
  sampler: FlowSampler,
  induced: Float64Array,
  offset: number,
  loads: LoadAccumulator,
): void {
  for (let k = 0; k < struts.length; k++) {
    const st = struts[k];
    const mid = strutMidpoint(st);
    sampler.sample(mid, flow);
    const j = offset + 3 * k;
    const ux = flow.x + induced[j], uy = flow.y + induced[j + 1], uz = flow.z + induced[j + 2];
    // Strut axis s, chord direction c (leading to trailing edge, body -x made normal to s), normal n = c x s.
    let sx = st.tip.x - st.root.x, sy = st.tip.y - st.root.y, sz = st.tip.z - st.root.z;
    const length = Math.sqrt(sx * sx + sy * sy + sz * sz);
    sx /= length;
    sy /= length;
    sz /= length;
    let cx = -1 + sx * sx, cy = sx * sy, cz = sx * sz;
    const cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
    cx /= cl;
    cy /= cl;
    cz /= cl;
    const nx = cy * sz - cz * sy, ny = cz * sx - cx * sz, nz = cx * sy - cy * sx;
    // Flow in the section plane.
    const ut = ux * cx + uy * cy + uz * cz;
    const un = ux * nx + uy * ny + uz * nz;
    const q2 = ut * ut + un * un;
    if (q2 < 1e-6 || ut <= 0) continue;
    const alpha = Math.atan2(un, ut);
    const clift = Math.max(-st.clMax, Math.min(st.clMax, st.liftSlope * Math.sin(alpha)));
    // Lift perpendicular to the in-plane flow, toward n at positive alpha: l = (ut n - un c) / |q|.
    const f = (0.5 * rho * Math.sqrt(q2) * st.chord * length * clift);
    loads.addForce(mid, f * (ut * nx - un * cx), f * (ut * ny - un * cy), f * (ut * nz - un * cz));
  }
}
