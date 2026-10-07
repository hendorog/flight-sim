// Wings: section panels lofted along the definition's planform (the Cessna 172S: NACA 2412, constant-chord
// centre panel, tapered outer panel, dihedral and linear washout), Fowler-type slotted flaps that run aft and
// down on their tracks, ailerons hinged at their noses, rounded tips, streamlined lift struts and wing-top
// fuel caps. A low wing ends just under the body's skin (root: 'conform'); a winglet is a second planform
// lofted on from the tip station.

import * as THREE from 'three';
import { C172S_VISUAL } from '../../aircraft/c172s/visual';
import type { SectionShape, WingVisualDef } from './airframe/types';
import { controlSurfaceContour, fullContour, surfacePoint, truncatedContour, type Pt } from './airfoil';
import { sectionHalfWidth } from './fuselage';
import { Ring, type FuselageShape } from './fuselageShape';
import { frd, gridGeometry, Hinge, MeshBatch, sweepGeometry, type FRD } from './geometry';
import {
  makeWingletPlanform,
  makeWingPlanform,
  roundTip,
  sectionPoint,
  stations,
  surfaceCap,
  surfaceGeometry,
  tipStations,
  wingPlanform,
  type Planform,
} from './liftingSurface';
import type { AircraftMaterials } from './materials';

/** Gap between a control surface's end and the fixed structure, m. */
const END_GAP = 0.008;
/** How far under the body's skin a conforming wing root ends, m. */
export const ROOT_UNDER_SKIN = 0.01;

function pointOn(planform: Planform, y: number, xc: number, yc: number, side: 1 | -1, out = new THREE.Vector3()): THREE.Vector3 {
  const p = sectionPoint(planform, y, xc, yc);
  return frd(p.x, p.y * side, p.z, out);
}

function surfacePointOn(planform: Planform, section: SectionShape, y: number, xc: number, surface: 1 | -1, side: 1 | -1, out = new THREE.Vector3()): THREE.Vector3 {
  const [px, py] = surfacePoint(section, xc, surface);
  return pointOn(planform, y, px, py, side, out);
}

/** Model-space point on the right wing of the Cessna 172S at span y and chord coordinates (xc, yc); side -1 mirrors. */
export function wingPoint(y: number, xc: number, yc: number, side: 1 | -1, out = new THREE.Vector3()): THREE.Vector3 {
  return pointOn(wingPlanform, y, xc, yc, side, out);
}

/** Upper (1) or lower (-1) surface point of the Cessna 172S wing's NACA 2412 at span y and chord fraction xc. */
export function wingSurfacePoint(y: number, xc: number, surface: 1 | -1, side: 1 | -1, out = new THREE.Vector3()): THREE.Vector3 {
  return surfacePointOn(wingPlanform, C172S_VISUAL.wing.section, y, xc, surface, side, out);
}

export interface WingParts {
  /** Static wing structure (merged). */
  structure: THREE.Group;
  /** Moving surfaces, index 0 = left, 1 = right (a wing with several flap bays a side: all the left ones first). */
  flaps: [Hinge, Hinge];
  ailerons: [Hinge, Hinge];
  /** Every moving surface with the side it is on, left wing first, each from the root outward. */
  surfaces: { hinge: Hinge; kind: 'flap' | 'aileron'; side: 1 | -1 }[];
}

/**
 * @param def the wing of the airframe definition (default: the Cessna 172S). Its bays are built from the root
 *            outward: a fixed bay is a full-section panel (the last one carries the rounded tip), a flap or
 *            aileron bay a panel cut back to the cove with the surface on its hinge behind it.
 * @param skin the body's outer skin (fuselageShape: inset 0), which a wing with root: 'conform' ends under
 */
export function buildWings(mat: AircraftMaterials, root: THREE.Object3D, def: WingVisualDef = C172S_VISUAL.wing, skin?: FuselageShape): WingParts {
  const planform = def === C172S_VISUAL.wing ? wingPlanform : makeWingPlanform(def);
  const section = def.section;
  const tipY = def.breaks[def.breaks.length - 1].y;
  const batch = new MeshBatch();
  const full = fullContour(section, 40);
  const winglet = def.tip.winglet;
  const conform = (def.root ?? 'cap') === 'conform';
  if (conform && !skin) throw new Error("wings: a wing with root: 'conform' needs the body's outer skin");
  // The innermost station row of a conforming root: every vertex goes to where the skin is at its own station
  // and height, less ROOT_UNDER_SKIN (to the centre line where the wing passes over or under the body).
  const ring = new Ring();
  const underSkin = (row: number, p: FRD): void => {
    if (row === 0) p.y = Math.max(0, sectionHalfWidth(skin!, p.x, p.z, ring.set(skin!.section(p.x))) - ROOT_UNDER_SKIN);
  };
  const bays = def.bays.map((bay) => {
    // About seven span stations a metre.
    const rows = Math.max(2, Math.round(7 * (bay.to - bay.from)));
    if (bay.kind === 'fixed') return { ...bay, rows, contour: full, aftEdge: 1, surface: null };
    const hinge = 1 - (bay.chordFraction ?? 0.25);
    return {
      ...bay,
      rows,
      // The upper skin overhangs the surface's nose; the flap's cove is cut further forward below.
      contour: truncatedContour(section, hinge + 0.022, hinge - (bay.kind === 'flap' ? 0.035 : 0.03), 34, 6),
      aftEdge: hinge + 0.022,
      surface: controlSurfaceContour(section, hinge, 16, 12),
    };
  });

  const tipStart = tipY - def.tip.round;
  const tipThickness = roundTip(tipStart, tipY, 0.03);
  // A slight planform rounding of the tip corners (C172 conical-camber tip).
  const tipChord = (s: number): number => 1 - def.tip.chordRound * (1 - tipThickness(s));

  const flaps: Hinge[] = [];
  const ailerons: Hinge[] = [];
  const surfaces: WingParts['surfaces'] = [];
  for (const side of [-1, 1] as const) {
    const mirror = side < 0;
    const add = (g: THREE.BufferGeometry): void => batch.add(mat.wingPaint, g);
    const outward = (s: number): THREE.Vector3 => new THREE.Vector3(s * side, 0, 0);
    // Fixed structure panels.
    bays.forEach((bay, i) => {
      const fit = conform && i === 0 ? underSkin : undefined;
      if (bay.kind === 'fixed' && i === bays.length - 1 && !winglet) {
        const tipRows = [bay.from, bay.from + 0.07, ...tipStations(tipStart, tipY, 8)];
        add(
          surfaceGeometry(planform, {
            stations: tipRows,
            contour: full,
            mirror,
            thicknessScale: tipThickness,
            chordScale: tipChord,
            fit,
          }),
        );
      } else add(surfaceGeometry(planform, { stations: stations(bay.from, bay.to, bay.rows), contour: bay.contour, mirror, fit }));
    });
    if (winglet) add(wingletGeometry(def, full, mirror));
    // End faces: the root, and at every joint of two bays the face of the one that reaches further aft.
    if (!conform) add(surfaceCap(planform, full, def.rootY, outward(-1), mirror));
    for (let i = 1; i < bays.length; i++) {
      const inner = bays[i - 1];
      const outer = bays[i];
      if (inner.aftEdge > outer.aftEdge) add(surfaceCap(planform, inner.contour, outer.from, outward(1), mirror));
      else if (outer.aftEdge > inner.aftEdge) add(surfaceCap(planform, outer.contour, outer.from, outward(-1), mirror));
    }

    // Flaps and ailerons on hinges through their nose centres.
    for (const bay of bays) {
      if (!bay.surface) continue;
      const hinge = controlSurface(root, mat.wingPaint, bay.surface.pts, bay.surface.hinge, bay.from + END_GAP, bay.to - END_GAP, side, bay.rows, planform);
      (bay.kind === 'flap' ? flaps : ailerons).push(hinge);
      surfaces.push({ hinge, kind: bay.kind === 'flap' ? 'flap' : 'aileron', side });
    }

    if (def.strut) addStrut(batch, mat, side, def.strut);
    for (const cap of def.fuelCaps) {
      if (cap.side === 'both' || (cap.side === 'right') === side > 0) addFuelCap(batch, mat, side, cap, planform, section);
    }
    for (const walk of def.walkways ?? []) {
      if (walk.side === 'both' || (walk.side === 'right') === side > 0) addWalkway(batch, mat, side, walk, planform, section);
    }
    for (const strip of def.stallStrips ?? []) addStallStrip(batch, mat, side, strip, planform, section);
  }
  if (def.pitot) addPitot(batch, mat, def.pitot, planform, section);
  if (def.liftDetector) addLiftDetector(batch, mat, def.liftDetector, planform, section);
  const structure = batch.build('wings');
  root.add(structure);
  return { structure, flaps: flaps as [Hinge, Hinge], ailerons: ailerons as [Hinge, Hinge], surfaces };
}

/**
 * The winglet of one side: lofted on from the wing's tip section, which turns up and narrows into the winglet's
 * own section over the blend; the top rounds off.
 * @param wingContour the wing's full section contour, whose point count the winglet's contour shares
 */
function wingletGeometry(def: WingVisualDef, wingContour: Pt[], mirror: boolean): THREE.BufferGeometry {
  const winglet = def.tip.winglet!;
  const planform = makeWingletPlanform(def);
  const h = winglet.height;
  const blend = (winglet.blend ?? 0.3) * h;
  const own = fullContour(winglet.section, (wingContour.length - 1) / 2);
  const rows = [...stations(0, blend, 6), ...stations(blend, 0.8 * h, 4).slice(1), ...tipStations(0.8 * h, h, 5).slice(1)];
  const contours = rows.map((s) => {
    const t = Math.min(1, s / blend);
    const k = t * t * (3 - 2 * t);
    return wingContour.map((p, j): Pt => [p[0] + (own[j][0] - p[0]) * k, p[1] + (own[j][1] - p[1]) * k]);
  });
  const top = roundTip(0.8 * h, h, 0.05);
  return surfaceGeometry(planform, { stations: rows, contour: own, contourAt: (i) => contours[i], mirror, thicknessScale: top });
}

function controlSurface(
  root: THREE.Object3D,
  material: THREE.Material,
  contour: Pt[],
  hingePt: Pt,
  y0: number,
  y1: number,
  side: 1 | -1,
  rows: number,
  planform: Planform,
): Hinge {
  const mirror = side < 0;
  const inner = pointOn(planform, y0, hingePt[0], hingePt[1], side);
  const outer = pointOn(planform, y1, hingePt[0], hingePt[1], side);
  // Axis points to the aircraft's right on both sides so positive rotation is trailing edge down.
  const axis = side > 0 ? outer.clone().sub(inner) : inner.clone().sub(outer);
  const hinge = new Hinge(inner, axis);
  const parts = [
    surfaceGeometry(planform, { stations: stations(y0, y1, rows), contour, mirror }),
    surfaceCap(planform, contour, y0, new THREE.Vector3(-side, 0, 0), mirror),
    surfaceCap(planform, contour, y1, new THREE.Vector3(side, 0, 0), mirror),
  ];
  const b = new MeshBatch();
  for (const g of parts) b.add(material, hinge.adopt(g));
  const group = b.build('controlSurface');
  hinge.object.add(...group.children);
  root.add(hinge.object);
  return hinge;
}

/** Pose a flap: rotate trailing edge down and run the hinge aft and down along the track. */
export function setFlap(h: Hinge, deflection: number, flap: WingVisualDef['flap'] = C172S_VISUAL.wing.flap): void {
  const k = Math.min(1, Math.max(0, deflection / flap.maxDeflection));
  // Most of the aft travel happens in the first half of the flap range (the track is curved).
  const aft = flap.travelAft * Math.sin((k * Math.PI) / 2);
  h.object.position.copy(h.origin);
  h.object.position.y -= flap.travelDown * k;
  h.object.position.z += aft;
  h.setAngle(deflection);
}

/** Streamlined lift strut from the lower fuselage to the wing, with end cuffs. */
function addStrut(batch: MeshBatch, mat: AircraftMaterials, side: 1 | -1, s: NonNullable<WingVisualDef['strut']>): void {
  const a = frd(s.fuselage[0], s.fuselage[1] * side, s.fuselage[2]);
  const b = frd(s.wing[0], s.wing[1] * side, s.wing[2]);
  const chord = s.chord;
  const tc = s.tc;
  // The path starts a little inside the fuselage so the root fairing blends into the skin.
  const t0 = -0.035;
  const spec = sweepGeometry(
    (t, out) => out.lerpVectors(a, b, t0 + (1 - t0) * t),
    (t, ang, out) => {
      // NACA 00xx-style teardrop, leading edge forward (+up in the sweep frame).
      const xc = 0.5 * (1 - Math.cos(ang));
      // Faired ends grown from the strut itself: a long root fairing where it meets the fuselage fitting
      // and a short cuff at the wing fitting.
      const root = Math.max(0, 1 - t / 0.13);
      const tip = Math.max(0, 1 - (1 - t) / 0.045);
      const flare = 1 + 1.3 * root * root * (3 - 2 * root) + 0.4 * tip * tip;
      const half = 5 * tc * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);
      out.set(Math.sign(Math.sin(ang)) * half * chord * flare, (0.3 - xc) * chord * flare);
    },
    40,
    32,
    frd(1, 0, 0),
  );
  batch.add(mat.wingPaint, gridGeometry(spec));
}

/** Fuel filler cap on the wing top over the tank. */
function addFuelCap(batch: MeshBatch, mat: AircraftMaterials, side: 1 | -1, cap: WingVisualDef['fuelCaps'][number], planform: Planform, section: SectionShape): void {
  const y = cap.y;
  const p = surfacePointOn(planform, section, y, cap.xc, 1, side);
  const n = surfacePointOn(planform, section, y, cap.xc + 0.02, 1, side).sub(surfacePointOn(planform, section, y, cap.xc - 0.02, 1, side));
  const across = new THREE.Vector3(1, 0, 0);
  const up = new THREE.Vector3().crossVectors(n, across).normalize();
  if (up.y < 0) up.negate();
  const g = new THREE.CylinderGeometry(0.038, 0.042, 0.012, 24);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up));
  g.translate(p.x, p.y, p.z);
  batch.add(mat.aluminium, g);
}

/** Black non-slip walkway: a thin skin over the upper surface, 3 mm proud of it. */
function addWalkway(batch: MeshBatch, mat: AircraftMaterials, side: 1 | -1, w: NonNullable<WingVisualDef['walkways']>[number], planform: Planform, section: SectionShape): void {
  const NX = 8;
  const pos: number[] = [];
  const index: number[] = [];
  const p = new THREE.Vector3();
  for (const y of [w.y0, w.y1]) {
    for (let i = 0; i <= NX; i++) {
      surfacePointOn(planform, section, y, w.xc0 + ((w.xc1 - w.xc0) * i) / NX, 1, side, p);
      pos.push(p.x, p.y + 0.003, p.z);
    }
  }
  for (let i = 0; i < NX; i++) {
    const a = i, b = i + 1, c = NX + 1 + i, d = NX + 2 + i;
    // Facing up on either wing (the mirror flips the winding).
    if (side > 0) index.push(a, b, c, b, d, c);
    else index.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  batch.add(mat.black, g);
}

/** Stall strip: a small triangular prism along the leading edge. */
function addStallStrip(batch: MeshBatch, mat: AircraftMaterials, side: 1 | -1, strip: NonNullable<WingVisualDef['stallStrips']>[number], planform: Planform, section: SectionShape): void {
  const a = surfacePointOn(planform, section, strip.y0, 0, 1, side);
  const b = surfacePointOn(planform, section, strip.y1, 0, 1, side);
  const dir = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(0.008, 0.008, dir.length(), 3);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  batch.add(mat.aluminium, g);
}

/** Lift-detector vane: a small tab standing out of the lower leading edge. */
function addLiftDetector(batch: MeshBatch, mat: AircraftMaterials, v: NonNullable<WingVisualDef['liftDetector']>, planform: Planform, section: SectionShape): void {
  const p = surfacePointOn(planform, section, v.y, 0.01, -1, v.side);
  const g = new THREE.BoxGeometry(0.03, 0.003, 0.025);
  g.translate(p.x, p.y - 0.004, p.z - 0.008);
  batch.add(mat.aluminium, g);
}

/** Pitot tube under the wing. */
function addPitot(batch: MeshBatch, mat: AircraftMaterials, pitot: NonNullable<WingVisualDef['pitot']>, planform: Planform, section: SectionShape): void {
  const base = surfacePointOn(planform, section, pitot.y, pitot.xc, -1, pitot.side);
  const mast = new THREE.CylinderGeometry(0.007, 0.012, 0.1, 10);
  mast.translate(base.x, base.y - 0.05, base.z);
  batch.add(mat.aluminium, mast);
  const tube = new THREE.CylinderGeometry(0.006, 0.007, 0.26, 12);
  tube.rotateX(Math.PI / 2);
  tube.translate(base.x, base.y - 0.1, base.z - 0.09);
  batch.add(mat.aluminium, tube);
}
