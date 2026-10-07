// Empennage: stabiliser with elevators (cut back inboard to clear the rudder) and the right elevator's
// trim tab, swept fin with rudder (its lower extension runs down behind the tail cone to the tail
// light), and the VOR "cat whisker" antenna on the fin. Planforms, hinge fractions, the tab and the rudder's
// extension are the airframe definition's (default: the Cessna 172S).
//
// Variants of the definition: a stabilator (the whole tailplane on one hinge line, with a geared tab in its
// trailing edge), a T-tail (the tailplane on the fin tip under a bullet fairing; the fin and rudder square off
// below it), a swept tailplane, a rudder tab, a dorsal fillet and a ventral fin.

import * as THREE from 'three';
import { C172S_VISUAL } from '../../aircraft/c172s/visual';
import type { TailVisualDef } from './airframe/types';
import { controlSurfaceContour, fullContour, thickness, truncatedContour, type Pt } from './airfoil';
import type { FuselageShape } from './fuselageShape';
import { frd, Hinge, MeshBatch, sweepGeometry, gridGeometry } from './geometry';
import {
  makeFinPlanform,
  makeRudderPlanform,
  makeStabPlanform,
  roundTip,
  sectionPoint,
  stations,
  surfaceCap,
  surfaceGeometry,
  tipStations,
  type Planform,
} from './liftingSurface';
import type { AircraftMaterials } from './materials';

export interface TailParts {
  structure: THREE.Group;
  /** Index 0 = left, 1 = right. The two halves of a stabilator are its "elevators". */
  elevators: [Hinge, Hinge];
  /** The first of `tabs` (the Cessna 172S: the right elevator's trim tab); a tail without a tab has none. */
  trimTab: Hinge;
  rudder: Hinge;
  /** Every tab in the elevators' (or the stabilator's) trailing edge; each shows tabGearing x elevator + elevatorTrim. */
  tabs: Hinge[];
  tabGearing: number;
  /** The tab in the rudder's trailing edge, if the definition has one. */
  rudderTab: Hinge | null;
}

/** Hinge through the control-surface nose centre from span station s0 to s1 (axis points s0 -> s1). */
function hingeFrom(pf: Planform, hinge: Pt, s0: number, s1: number, mirror: boolean): Hinge {
  const a = sectionPoint(pf, s0, hinge[0], hinge[1]);
  const b = sectionPoint(pf, s1, hinge[0], hinge[1]);
  const pa = frd(a.x, mirror ? -a.y : a.y, a.z);
  const pb = frd(b.x, mirror ? -b.y : b.y, b.z);
  return new Hinge(pa, pb.clone().sub(pa));
}

function attach(hinge: Hinge, material: THREE.Material, geometries: THREE.BufferGeometry[], name: string): void {
  const b = new MeshBatch();
  for (const g of geometries) b.add(material, hinge.adopt(g));
  hinge.object.add(...b.build(name).children);
}

/**
 * @param def the tail of the airframe definition (default: the Cessna 172S)
 * @param skin the body's outer skin (fuselageShape: inset 0), from which a dorsal fillet and a ventral fin start
 */
export function buildTail(mat: AircraftMaterials, root: THREE.Object3D, def: TailVisualDef = C172S_VISUAL.tail, skin?: FuselageShape): TailParts {
  const batch = new MeshBatch();
  const section = def.section;
  const stabPlanform = makeStabPlanform(def);
  const finPlanform = makeFinPlanform(def);
  /** Fin planform continued below the base for the rudder's lower extension (growing aft chord). */
  const rudderPlanform = makeRudderPlanform(def);
  const elevatorHinge = 1 - def.h.chordFraction;
  const rudderHinge = 1 - def.v.rudderChordFraction;
  const finHeight = def.v.base.z - def.v.tip.z;
  /** Elevator span: inboard end cut back to clear the rudder's lower extension. */
  const elevatorY0 = def.h.innerCutY;
  /** Trim tab: span and chord fraction of the full stabiliser chord. */
  const tabDef = def.h.tab;
  /** Rudder lower extension below the fin base. */
  const rudderBottomH = def.v.rudderExtension?.bottomH ?? 0;
  const hTip = def.h.span / 2;
  const stabTip = roundTip(hTip - 0.1, hTip, 0.04);

  const elevators: Hinge[] = [];
  const tabs: Hinge[] = [];
  /** A tab riding on `parent` (an elevator or a stabilator half): its hinge is expressed in the parent's frame. */
  const addTab = (parent: Hinge, tab: NonNullable<TailVisualDef['h']['tab']>, side: 1 | -1): void => {
    const mirror = side < 0;
    // Positive SurfaceState.elevatorTrim swings the tab trailing edge down (nose-up trim).
    const contour = controlSurfaceContour(section, tab.xc, 6, 6, 0.0015);
    const y0 = tab.y0 + 0.006;
    const y1 = tab.y1 - 0.006;
    const worldTab = hingeFrom(stabPlanform, contour.hinge, mirror ? y1 : y0, mirror ? y0 : y1, mirror);
    const inv = parent.object.matrix.clone().invert();
    const origin = worldTab.origin.clone().applyMatrix4(inv);
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(worldTab.object.quaternion).applyQuaternion(parent.object.quaternion.clone().invert());
    const hinge = new Hinge(origin, axis);
    const tabGeo = [
      surfaceGeometry(stabPlanform, { stations: stations(y0, y1, 4), contour: contour.pts, mirror }),
      surfaceCap(stabPlanform, contour.pts, y0, new THREE.Vector3(-side, 0, 0), mirror),
      surfaceCap(stabPlanform, contour.pts, y1, new THREE.Vector3(side, 0, 0), mirror),
    ].map((g) => g.applyMatrix4(inv));
    attach(hinge, mat.wingPaint, tabGeo, 'trimTab');
    parent.object.add(hinge.object);
    tabs.push(hinge);
  };

  if (def.h.kind === 'stabilator') {
    // The whole surface turns about its pivot line: no fixed stabiliser, one hinge per half.
    const pivot: Pt = [def.h.pivotFraction ?? 0.25, 0];
    const full = fullContour(section, 30);
    for (const side of [-1, 1] as const) {
      const mirror = side < 0;
      // Axis toward the aircraft's right on both sides: positive rotation = trailing edge down.
      const hinge = hingeFrom(stabPlanform, pivot, mirror ? hTip : 0, mirror ? 0 : hTip, mirror);
      const tabbed = tabDef !== undefined && (tabDef.sides === 'both' || side > 0);
      const parts: THREE.BufferGeometry[] = [];
      const tipRows = (from: number): number[] => {
        const start = Math.max(from, hTip - 0.1);
        const inner = start - from > 0.08 ? [from, ...stations(from + 0.04, start, 8)] : [from];
        return [...inner, ...tipStations(start, hTip, 6).slice(1)];
      };
      if (tabDef && tabbed) {
        // Full section except where the tab sits in the trailing edge.
        const cut = truncatedContour(section, tabDef.xc - 0.004, tabDef.xc - 0.004, 30, 5);
        parts.push(surfaceGeometry(stabPlanform, { stations: stations(0, tabDef.y0, 3), contour: full, mirror }));
        parts.push(surfaceGeometry(stabPlanform, { stations: stations(tabDef.y0, tabDef.y1, 6), contour: cut, mirror }));
        parts.push(surfaceGeometry(stabPlanform, { stations: tipRows(tabDef.y1), contour: full, mirror, thicknessScale: stabTip }));
        parts.push(surfaceCap(stabPlanform, full, tabDef.y0, new THREE.Vector3(side, 0, 0), mirror));
        parts.push(surfaceCap(stabPlanform, full, tabDef.y1, new THREE.Vector3(-side, 0, 0), mirror));
      } else {
        parts.push(surfaceGeometry(stabPlanform, { stations: tipRows(0), contour: full, mirror, thicknessScale: stabTip }));
      }
      attach(hinge, mat.wingPaint, parts, 'stabilator');
      root.add(hinge.object);
      elevators.push(hinge);
      if (tabDef && tabbed) addTab(hinge, tabDef, side);
    }
  } else {
    const stabCut = truncatedContour(section, elevatorHinge - 0.012, elevatorHinge - 0.012, 30, 5);
    const elev = controlSurfaceContour(section, elevatorHinge, 16, 10);
    for (const side of [-1, 1] as const) {
      const mirror = side < 0;
      batch.add(
        mat.wingPaint,
        surfaceGeometry(stabPlanform, {
          stations: [0, ...stations(0.12, hTip - 0.1, 10), ...tipStations(hTip - 0.1, hTip, 6).slice(1)],
          contour: stabCut,
          mirror,
          thicknessScale: stabTip,
        }),
      );
      const y0 = elevatorY0;
      const y1 = hTip - 0.012;
      // Axis toward the aircraft's right on both sides: positive rotation = trailing edge down.
      const hinge = hingeFrom(stabPlanform, elev.hinge, mirror ? y1 : y0, mirror ? y0 : y1, mirror);
      const parts: THREE.BufferGeometry[] = [];
      const tipRound = roundTip(hTip - 0.1, y1 + 0.012, 0.05);
      const tabbed = tabDef !== undefined && (tabDef.sides === 'both' || side > 0);
      if (tabDef && tabbed) {
        // Right elevator: full chord except where the trim tab sits in its trailing edge.
        const elevShort = controlSurfaceContour(section, elevatorHinge, 16, 10, 0.006, tabDef.xc - 0.004);
        parts.push(surfaceGeometry(stabPlanform, { stations: stations(y0, tabDef.y0, 2), contour: elev.pts, mirror }));
        parts.push(surfaceGeometry(stabPlanform, { stations: stations(tabDef.y0, tabDef.y1, 4), contour: elevShort.pts, mirror }));
        parts.push(surfaceGeometry(stabPlanform, { stations: [tabDef.y1, ...stations(tabDef.y1 + 0.04, y1, 10)], contour: elev.pts, mirror, thicknessScale: tipRound }));
        parts.push(surfaceCap(stabPlanform, elev.pts, tabDef.y0, new THREE.Vector3(side, 0, 0), mirror));
        parts.push(surfaceCap(stabPlanform, elev.pts, tabDef.y1, new THREE.Vector3(-side, 0, 0), mirror));
      } else {
        parts.push(surfaceGeometry(stabPlanform, { stations: stations(y0, y1, 12), contour: elev.pts, mirror, thicknessScale: tipRound }));
      }
      parts.push(surfaceCap(stabPlanform, elev.pts, y0, new THREE.Vector3(-side, 0, 0), mirror));
      attach(hinge, mat.wingPaint, parts, 'elevator');
      root.add(hinge.object);
      elevators.push(hinge);

      // The tab rides on the elevator.
      if (tabDef && tabbed) addTab(hinge, tabDef, side);
    }
  }

  // Fin: fixed part down into the tail cone, rounded tip (square under the tailplane of a T-tail).
  const finCut = truncatedContour(section, rudderHinge - 0.012, rudderHinge - 0.012, 30, 5);
  const finTip = def.tTail ? undefined : roundTip(finHeight - 0.08, finHeight, 0.05);
  batch.add(
    mat.finPaint,
    surfaceGeometry(finPlanform, {
      stations: [-0.06, ...stations(0.05, finHeight - 0.08, 12), ...tipStations(finHeight - 0.08, finHeight, 5).slice(1)],
      contour: finCut,
      thicknessScale: finTip,
    }),
  );

  // Rudder: hinge axis points down so a positive angle swings the trailing edge left. Under a T-tail it ends
  // below the tailplane's lower surface.
  const rud = controlSurfaceContour(section, rudderHinge, 16, 10);
  const top = def.tTail ? finHeight - 0.5 * section.t * def.h.rootChord - 0.03 : finHeight - 0.012;
  const rudder = hingeFrom(rudderPlanform, rud.hinge, top, rudderBottomH, false);
  const rudderTip = def.tTail ? undefined : roundTip(finHeight - 0.08, top + 0.012, 0.05);
  const rudderTabDef = def.v.rudderTab;
  const rudderParts: THREE.BufferGeometry[] = [];
  const lower = rudderBottomH < 0 ? stations(rudderBottomH, 0, 5) : [0];
  if (rudderTabDef) {
    // Full chord except where the tab sits in the trailing edge.
    const { h0, h1 } = rudderTabDef;
    const short = controlSurfaceContour(section, rudderHinge, 16, 10, 0.006, rudderTabDef.xc - 0.004);
    rudderParts.push(surfaceGeometry(rudderPlanform, { stations: [...lower.filter((h) => h < h0 - 0.02), h0], contour: rud.pts }));
    rudderParts.push(surfaceGeometry(rudderPlanform, { stations: stations(h0, h1, 4), contour: short.pts }));
    rudderParts.push(surfaceGeometry(rudderPlanform, { stations: [h1, ...stations(h1 + 0.04, top, 8)], contour: rud.pts, thicknessScale: rudderTip }));
    rudderParts.push(surfaceCap(rudderPlanform, rud.pts, h0, new THREE.Vector3(0, 1, 0)));
    rudderParts.push(surfaceCap(rudderPlanform, rud.pts, h1, new THREE.Vector3(0, -1, 0)));
  } else {
    rudderParts.push(
      surfaceGeometry(rudderPlanform, {
        stations: rudderBottomH < 0 ? [...stations(rudderBottomH, 0, 5), ...stations(0.1, top, 12)] : [0, ...stations(0.1, top, 12)],
        contour: rud.pts,
        thicknessScale: rudderTip,
      }),
    );
  }
  rudderParts.push(surfaceCap(rudderPlanform, rud.pts, rudderBottomH, new THREE.Vector3(0, -1, 0)));
  if (def.tTail) rudderParts.push(surfaceCap(rudderPlanform, rud.pts, top, new THREE.Vector3(0, 1, 0)));
  attach(rudder, mat.finPaint, rudderParts, 'rudder');
  root.add(rudder.object);

  let rudderTab: Hinge | null = null;
  if (rudderTabDef) {
    // The tab rides on the rudder; its axis points down like the rudder's (positive = trailing edge left).
    const contour = controlSurfaceContour(section, rudderTabDef.xc, 6, 6, 0.0015);
    const h0 = rudderTabDef.h0 + 0.006;
    const h1 = rudderTabDef.h1 - 0.006;
    const worldTab = hingeFrom(rudderPlanform, contour.hinge, h1, h0, false);
    const inv = rudder.object.matrix.clone().invert();
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(worldTab.object.quaternion).applyQuaternion(rudder.object.quaternion.clone().invert());
    rudderTab = new Hinge(worldTab.origin.clone().applyMatrix4(inv), axis);
    const geo = [
      surfaceGeometry(rudderPlanform, { stations: stations(h0, h1, 4), contour: contour.pts }),
      surfaceCap(rudderPlanform, contour.pts, h0, new THREE.Vector3(0, -1, 0)),
      surfaceCap(rudderPlanform, contour.pts, h1, new THREE.Vector3(0, 1, 0)),
    ].map((g) => g.applyMatrix4(inv));
    attach(rudderTab, mat.finPaint, geo, 'rudderTab');
    rudder.object.add(rudderTab.object);
  }

  if (def.tTail && def.h.kind === 'elevator') addBullet(batch, mat, def, stabPlanform);
  if (def.dorsalFillet) addDorsalFillet(batch, mat, def, def.dorsalFillet, finPlanform, skin);
  if (def.ventralFin && skin) addVentralFin(batch, mat, def.ventralFin, skin);
  if (def.vorAntenna) addVorAntenna(batch, mat, finPlanform, finHeight);
  const structure = batch.build('tail');
  root.add(structure);
  return { structure, elevators: elevators as [Hinge, Hinge], trimTab: tabs[0], rudder, tabs, tabGearing: tabDef?.gearing ?? 0, rudderTab };
}

/**
 * The fairing over a T-tail's junction: a body of revolution along the tailplane's root chord, from a little ahead
 * of its leading edge to its trailing edge (or to def.bullet.aftX).
 */
function addBullet(batch: MeshBatch, mat: AircraftMaterials, def: TailVisualDef, stabPlanform: Planform): void {
  const c = def.h.rootChord;
  const le = sectionPoint(stabPlanform, 0, 0, 0);
  const R = def.bullet?.radius ?? 0.5 * Math.max(def.section.t * c, def.section.t * def.v.tipChord) + 0.025;
  const a = frd(le.x + 0.15 * c, 0, le.z);
  const b = frd(def.bullet?.aftX ?? le.x - 0.99 * c, 0, le.z);
  const spec = sweepGeometry(
    (t, out) => out.lerpVectors(a, b, t),
    (t, ang, out) => {
      // Blunt nose, long tapering tail.
      const r = R * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.6);
      out.set(Math.cos(ang) * Math.max(r, 1e-4), Math.sin(ang) * Math.max(r, 1e-4));
    },
    18,
    16,
    new THREE.Vector3(0, 1, 0),
  );
  batch.add(mat.plainPaint, gridGeometry(spec));
}

/** A thin lens-section plate between two (x, z) edge lines: `fore(t)` and `aft(t)` for t = 0..1 along it, FRD. */
function thinFin(fore: (t: number) => [number, number], aft: (t: number) => [number, number], halfThickness: number, rows: number): THREE.BufferGeometry {
  const cols = 12;
  const spec = {
    rows,
    cols: cols + 1,
    wrap: true,
    position(i: number, j: number, out: THREE.Vector3): void {
      const t = i / (rows - 1);
      const [xf, zf] = fore(t);
      const [xa, za] = aft(t);
      const a = (j / cols) * Math.PI * 2;
      // Around the lens: the fore edge at a = 0, the aft edge at pi.
      const k = 0.5 - 0.5 * Math.cos(a);
      frd(xf + (xa - xf) * k, halfThickness * Math.sin(a), zf + (za - zf) * k, out);
    },
  };
  const g = gridGeometry(spec);
  // Facing: the right face (+y, first half of the ring) must look to the right.
  const n = new THREE.Vector3().fromBufferAttribute(g.getAttribute('normal'), Math.floor(rows / 2) * (cols + 1) + Math.floor(cols / 4));
  return n.x >= 0 ? g : gridGeometry({ ...spec, flip: true });
}

/** Dorsal fillet: from the body's top line at x0 up to the fin's leading edge. */
function addDorsalFillet(
  batch: MeshBatch,
  mat: AircraftMaterials,
  def: TailVisualDef,
  fillet: NonNullable<TailVisualDef['dorsalFillet']>,
  finPlanform: Planform,
  skin: FuselageShape | undefined,
): void {
  const top = sectionPoint(finPlanform, fillet.height, 0, 0);
  const z0 = skin ? skin.section(fillet.x0).zTop + 0.01 : def.v.base.z;
  const p = { x: 0, y: 0, z: 0 };
  batch.add(
    mat.plainPaint,
    thinFin(
      (t) => [fillet.x0 + (top.x - fillet.x0) * t, z0 + (top.z - z0) * t],
      (t) => {
        // Aft edge: inside the fin, a tenth of its chord behind the leading edge (down to the body below the base).
        const h = fillet.height * t;
        sectionPoint(finPlanform, h, 0.1, 0, p);
        return [Math.min(p.x, fillet.x0 + (top.x - fillet.x0) * t - 0.002), p.z];
      },
      0.5 * thickness(def.section, 0.1) * def.v.rootChord,
      10,
    ),
  );
}

/** Ventral fin: a thin plate under the tail cone, deepest at its aft end. */
function addVentralFin(batch: MeshBatch, mat: AircraftMaterials, fin: NonNullable<TailVisualDef['ventralFin']>, skin: FuselageShape): void {
  const belly = (x: number): number => skin.section(x).zBot - 0.01;
  batch.add(
    mat.plainPaint,
    thinFin(
      // Along the keel from x0 to x1: the upper edge inside the body, the lower edge the fin's outline.
      (t) => {
        const x = fin.x0 + (fin.x1 - fin.x0) * t;
        return [x, belly(x)];
      },
      (t) => {
        const x = fin.x0 + (fin.x1 - fin.x0) * t;
        return [x, belly(x) + 0.01 + fin.depth * Math.pow(t, 0.8) * Math.min(1, (1 - t) / 0.08 + 0.55)];
      },
      0.012,
      14,
    ),
  );
}

/** Rudder trailing-edge bottom (tail light position), FRD. */
export function rudderBottomTrailingEdge(def: TailVisualDef = C172S_VISUAL.tail): { x: number; y: number; z: number } {
  return sectionPoint(makeRudderPlanform(def), (def.v.rudderExtension?.bottomH ?? 0) + 0.03, 1, 0);
}

/** VOR navigation antenna: two swept-forward rods either side of the fin, near the top. */
function addVorAntenna(batch: MeshBatch, mat: AircraftMaterials, finPlanform: Planform, finHeight: number): void {
  const h = finHeight * 0.62;
  const base = sectionPoint(finPlanform, h, 0.35, 0);
  for (const side of [-1, 1]) {
    const a = frd(base.x, 0, base.z);
    const b = frd(base.x + 0.32, side * 0.36, base.z - 0.04);
    const spec = sweepGeometry(
      (t, out) => out.lerpVectors(a, b, t),
      (t, ang, out) => out.set(Math.cos(ang), Math.sin(ang)).multiplyScalar(0.0045 - 0.0015 * t),
      4,
      8,
      new THREE.Vector3(0, 1, 0),
    );
    batch.add(mat.darkMetal, gridGeometry(spec));
  }
}
