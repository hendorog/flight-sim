// Fuselage meshes: painted skin, window glazing and cabin lining (all three lofted from FuselageShape
// with the same (s, t) parameterisation, so the baked masks line up), the cowling inlet ducts, exhaust
// stack, end caps and small external fittings (antennas, door handles).
//
// Engine nacelles and fairings (wing-root fillets, nacelle tails) are further lofts of the same kind, placed
// by their own axis offset and mirrored for the left side: plain paint (no baked texture), overlapping the
// wing; a nacelle's inlets are dark decals on its nose bowl.

import * as THREE from 'three';
import { C172S_VISUAL } from '../../aircraft/c172s/visual';
import type { AirframeVisualDef, FairingDef, InletDef, LoftDef, NacelleVisualDef } from './airframe/types';
import { capGeometry, frd, gridGeometry, Hinge, MeshBatch, outlineNormal, plateGeometry, sweepGeometry, type GridSpec } from './geometry';
import { FuselageShape, Ring } from './fuselageShape';
import { inletOutline, inletShape } from './livery';
import type { AircraftMaterials } from './materials';

/** The three surfaces lofted from the same parameterisation. */
export interface FuselageShapes {
  outer: FuselageShape;
  /** Glazing, 3 mm inside the skin so the skin edge always wins the depth test. */
  glass: FuselageShape;
  /** Cabin lining, 15 mm inside the skin, headliner no higher than just under the wing root. */
  lining: FuselageShape;
}

/** The three shapes of an airframe's fuselage (default: the Cessna 172S). */
export function createFuselageShapes(def: Pick<AirframeVisualDef, 'fuselage' | 'glazing'> = C172S_VISUAL): FuselageShapes {
  return {
    outer: new FuselageShape(0, -Infinity, def.fuselage),
    glass: new FuselageShape(0.003, -Infinity, def.fuselage),
    lining: new FuselageShape(0.015, def.glazing.liningRoofLimit, def.fuselage),
  };
}

/** Where a loft with its own axis stands: the axis offset, and side -1 to mirror it to the left of the aircraft. */
export interface Placement {
  y: number;
  z: number;
  side: 1 | -1;
}

/**
 * Loft of a shape between surface parameters s0..s1 (rows) and t0..t1 around the section (columns).
 * A full ring (t 0..1) wraps so the bottom seam shades smoothly. Texture u is s re-normalised to the
 * range [u0, u1] (the cabin-only textures cover just the cabin), v is t.
 */
function loftSpec(
  shape: FuselageShape,
  s0: number,
  s1: number,
  rows: number,
  cols: number,
  flip: boolean,
  t0 = 0,
  t1 = 1,
  u0 = 0,
  u1 = 1,
  place?: Placement,
): GridSpec {
  const ring = new Ring();
  const p = { y: 0, z: 0 };
  let row = -1;
  let x = 0;
  const t = (j: number): number => t0 + ((t1 - t0) * j) / cols;
  return {
    rows,
    cols: cols + 1,
    wrap: t0 === 0 && t1 === 1,
    flip,
    position(i, j, out) {
      if (i !== row) {
        row = i;
        x = shape.x(s0 + ((s1 - s0) * i) / (rows - 1));
        ring.set(shape.section(x));
      }
      ring.at(t(j), p);
      if (place) frd(x, place.side * (p.y + place.y), p.z + place.z, out);
      else frd(x, p.y, p.z, out);
    },
    uv(i, j, out) {
      out.set((s0 + ((s1 - s0) * i) / (rows - 1) - u0) / (u1 - u0), t(j));
    },
  };
}

/**
 * Flat cabin floor at body height z, following the lining's width at that height from x0 aft to x1
 * (it ends where the lining's bottom rises above the floor in the tail cone).
 */
export function cabinFloorGeometry(lining: FuselageShape, z: number, x0: number, x1: number): THREE.BufferGeometry {
  const ring = new Ring();
  const p = { y: 0, z: 0 };
  const rows = 40;
  const halfWidth = (x: number): number => {
    const sec = lining.section(x);
    if (sec.zBot <= z) return 0;
    ring.set(sec);
    let prevY = 0;
    let prevZ = sec.zBot;
    for (let k = 1; k <= 200; k++) {
      ring.at(k / 400, p);
      if (p.z <= z) {
        const f = (prevZ - z) / (prevZ - p.z || 1);
        return prevY + (p.y - prevY) * f;
      }
      prevY = p.y;
      prevZ = p.z;
    }
    return 0;
  };
  const widths = Array.from({ length: rows }, (_, i) => halfWidth(x0 + ((x1 - x0) * i) / (rows - 1)));
  return gridGeometry({
    rows,
    cols: 2,
    position(i, j, out) {
      const x = x0 + ((x1 - x0) * i) / (rows - 1);
      frd(x, (j === 0 ? -1 : 1) * widths[i], z, out);
    },
    uv(i, j, out) {
      out.set(j, i / (rows - 1));
    },
  });
}

/**
 * Half width (m, >= 0) of a shape's cross-section at body station x and height z (FRD, z down), measured on
 * the upper part of the section: the |y| where the outline crosses z. 0 above the top or below the bottom.
 * `ring` may be passed to reuse an already set ring of the section at x.
 */
export function sectionHalfWidth(shape: FuselageShape, x: number, z: number, ring: Ring = new Ring().set(shape.section(x))): number {
  // The right half runs k = 0 (bottom centreline) .. ARC/2 (top centreline); scan down from the top.
  const n = ring.y.length - 1;
  const top = n >> 1;
  if (z < ring.z[top]) return 0;
  for (let k = top - 1; k >= 0; k--) {
    if (ring.z[k] >= z) {
      const z0 = ring.z[k + 1];
      const f = (z - z0) / (ring.z[k] - z0 || 1);
      return Math.abs(ring.y[k + 1] + (ring.y[k] - ring.y[k + 1]) * f);
    }
  }
  return 0;
}

/** Closing cap of a loft at body station x (outline of that section), placed at station `at` (default x). */
function sectionCap(shape: FuselageShape, x: number, n: number, outwardX: number, at = x, place?: Placement): THREE.BufferGeometry {
  const ring = new Ring().set(shape.section(x));
  const p = { y: 0, z: 0 };
  const loop: THREE.Vector3[] = [];
  for (let j = 0; j < n; j++) {
    ring.at(j / n, p);
    if (place) loop.push(frd(at, place.side * (p.y + place.y), p.z + place.z));
    else loop.push(frd(at, p.y, p.z));
  }
  return capGeometry(loop, frd(outwardX, 0, 0));
}

export interface FuselageParts {
  skin: THREE.Mesh;
  glass: THREE.Mesh;
  lining: THREE.Mesh;
  /** Merged static fittings (inlets, exhaust, caps, antennas). */
  fittings: THREE.Group;
}

/** Grid of the skin loft where the definition gives none. */
const SKIN_GRID = { rows: 176, cols: 112 };

export function buildFuselage(shapes: FuselageShapes, mat: AircraftMaterials, def: Pick<AirframeVisualDef, 'fuselage' | 'glazing'> = C172S_VISUAL): FuselageParts {
  const { outer } = shapes;
  const { fuselage, glazing } = def;
  const grid = fuselage.grid ?? SKIN_GRID;
  // Rows run nose to tail and columns up the right side, so the natural winding faces inward: the skin
  // and glazing are flipped to face out, the lining keeps the inward facing.
  const skin = new THREE.Mesh(gridGeometry(loftSpec(outer, 0, 1, grid.rows, grid.cols, true)), mat.fuselagePaint);
  skin.name = 'fuselageSkin';
  skin.castShadow = true;
  skin.receiveShadow = true;

  // Glazing only spans the upper part of the sections (all windows are above the sill line). Glazing and
  // lining textures cover the cabin only (see bakeFuselageTextures).
  const g0 = shapes.glass.s(glazing.cabinFrontX);
  const g1 = shapes.glass.s(glazing.cabinRearX);
  const glass = new THREE.Mesh(gridGeometry(loftSpec(shapes.glass, g0, g1, 72, 64, true, glazing.tRange[0], glazing.tRange[1], g0, g1)), mat.glass);
  glass.name = 'glazing';
  glass.renderOrder = 2;

  const l0 = shapes.lining.s(glazing.cabinFrontX);
  const l1 = shapes.lining.s(glazing.cabinRearX);
  const lining = new THREE.Mesh(gridGeometry(loftSpec(shapes.lining, l0, l1, 60, 84, false, 0, 1, l0, l1)), mat.lining);
  lining.name = 'cabinLining';
  lining.receiveShadow = true;
  lining.castShadow = false;

  const batch = new MeshBatch();
  // Tail cone end and cowling nose ring (behind the spinner backplate).
  batch.add(mat.plainPaint, sectionCap(outer, fuselage.endX + 0.001, 48, -1));
  // (The outline of the opening itself, set 4 mm back: the nose bowl's face is nearly flat, so the outline of
  // the section there would lie on the skin and z-fight with it.)
  if (fuselage.nose === 'prop') batch.add(mat.black, sectionCap(outer, fuselage.frontX, 48, 1, fuselage.frontX - 0.004));
  // Baggage bulkhead behind the rear seat, and the firewall face behind the instrument panel.
  batch.add(mat.trimPlastic, sectionCap(shapes.lining, glazing.cabinRearX + 0.002, 64, 1));
  batch.add(mat.panelPlastic, sectionCap(shapes.lining, glazing.cabinFrontX - 0.002, 64, -1));

  addInletDucts(batch, mat, outer, fuselage);
  if (fuselage.exhaust) addExhaust(batch, mat, fuselage.exhaust);
  addAntennas(batch, mat, fuselage.antennas);
  addDoorHardware(batch, mat, outer, glazing.doors);
  const fittings = batch.build('fuselageFittings');
  return { skin, glass, lining, fittings };
}

/** Grid of a nacelle's or a fairing's loft where the definition gives none. */
const NACELLE_GRID = { rows: 36, cols: 32 };

/** The painted skin of a loft standing at `place`, closed at whichever end is not drawn to a point. */
function addPlacedLoft(batch: MeshBatch, paint: THREE.Material, shape: FuselageShape, loft: LoftDef, place: Placement, capFront: boolean): void {
  const grid = loft.grid ?? NACELLE_GRID;
  // As the fuselage skin, the raw grid faces inward; mirroring reverses that once more.
  batch.add(paint, gridGeometry(loftSpec(shape, 0, 1, grid.rows, grid.cols, place.side > 0, 0, 1, 0, 1, place)));
  if (shape.section(loft.endX).hw > 0.012) batch.add(paint, sectionCap(shape, loft.endX + 0.001, 24, -1, loft.endX + 0.001, place));
  if (capFront && shape.section(loft.frontX).hw > 0.012) batch.add(paint, sectionCap(shape, loft.frontX - 0.001, 24, 1, loft.frontX - 0.001, place));
}

/** Half-extents rounded-rectangle distance (negative inside). */
function roundRectSdf(u: number, v: number, hw: number, hh: number, r: number): number {
  const qu = Math.abs(u) - (hw - r);
  const qv = Math.abs(v) - (hh - r);
  return Math.hypot(Math.max(qu, 0), Math.max(qv, 0)) + Math.min(Math.max(qu, qv), 0) - r;
}

/**
 * A nacelle inlet as a dark decal: a rounded rectangle (seen from ahead) laid on the nose bowl 4 mm proud of
 * the skin, every vertex at the station where the skin passes its own (y, z).
 */
export function inletDecal(shape: FuselageShape, loft: LoftDef, inlet: InletDef, place: Placement): THREE.BufferGeometry {
  const ring = new Ring();
  const hw = inlet.w / 2;
  const hh = inlet.h / 2;
  const r = Math.min(inlet.r, hw, hh);
  // Body x at which the skin passes through (y, z) of the loft's own axes: the most forward station whose section contains it.
  const skinX = (y: number, z: number): number => {
    let lo = loft.frontX - 0.4;
    let hi = loft.frontX;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (sectionHalfWidth(shape, mid, z, ring.set(shape.section(mid))) >= Math.abs(y)) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  const rows = 4;
  const cols = 24;
  // Radius of the outline along each direction from the centre.
  const reach: number[] = [];
  for (let j = 0; j < cols; j++) {
    const a = (j / cols) * Math.PI * 2;
    let lo = 0;
    let hi = Math.hypot(hw, hh);
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (roundRectSdf(Math.cos(a) * mid, Math.sin(a) * mid, hw, hh, r) < 0) lo = mid;
      else hi = mid;
    }
    reach.push(lo);
  }
  const spec: GridSpec = {
    rows,
    cols: cols + 1,
    wrap: true,
    position(i, j, out) {
      const a = ((j % cols) / cols) * Math.PI * 2;
      const d = (reach[j % cols] * i) / (rows - 1);
      const y = inlet.y + Math.cos(a) * d;
      const z = inlet.z + Math.sin(a) * d;
      frd(skinX(y, z) + 0.004, place.side * (y + place.y), z + place.z, out);
    },
  };
  // Facing forward (model -Z), whichever way the mirroring left the winding.
  let g = gridGeometry(spec);
  if (g.getAttribute('normal').getZ((rows - 1) * (cols + 1)) >= 0) g = gridGeometry({ ...spec, flip: true });
  // Row 0 is the centre point repeated: the grid gives it no normal; it takes the mean of the first ring's.
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const mean = new THREE.Vector3();
  for (let j = 0; j < cols; j++) mean.add(new THREE.Vector3().fromBufferAttribute(n, cols + 1 + j));
  mean.normalize();
  for (let j = 0; j <= cols; j++) n.setXYZ(j, mean.x, mean.y, mean.z);
  return g;
}

export interface NacelleParts {
  /** Static parts of every nacelle and fairing (merged per material). */
  group: THREE.Group;
  /** Cowl flaps on their hinges: flap i opens to `angle` x state.engines[engine].cowlFlap. */
  cowlFlaps: { hinge: Hinge; angle: number; engine: number }[];
}

/**
 * The engine nacelles (nacelle i belongs to engine i) and the fairings of an airframe definition.
 * @param root cowl flaps hang directly on this node; the returned group is not added to it
 */
export function buildNacelles(mat: AircraftMaterials, root: THREE.Object3D, nacelles: readonly NacelleVisualDef[], fairings: readonly FairingDef[] = []): NacelleParts {
  const batch = new MeshBatch();
  const cowlFlaps: NacelleParts['cowlFlaps'] = [];
  nacelles.forEach((nacelle, engine) => {
    const loft = nacelle.loft;
    const side = nacelle.side;
    const shape = new FuselageShape(0, -Infinity, loft);
    const place: Placement = { y: loft.offset?.y ?? 0, z: loft.offset?.z ?? 0, side };
    addPlacedLoft(batch, mat.plainPaint, shape, loft, place, false);
    // The nose ring behind the spinner backplate, as on a fuselage that carries the propeller.
    batch.add(mat.black, sectionCap(shape, loft.frontX, 32, 1, loft.frontX - 0.004, place));
    for (const inlet of nacelle.inlets) batch.add(mat.black, inletDecal(shape, loft, inlet, place));
    const mirrored = (p: readonly [number, number, number]): [number, number, number] => [p[0], side * p[1], p[2]];
    if (nacelle.exhaust) addExhaust(batch, mat, { pos: mirrored(nacelle.exhaust.pos), radius: nacelle.exhaust.radius });
    for (const flap of nacelle.cowlFlaps ?? []) {
      const pts = flap.pts.map(mirrored);
      const axis = mirrored(flap.axis);
      const hinge = new Hinge(frd(...mirrored(flap.hinge)), frd(axis[0], axis[1], axis[2]));
      hinge.object.name = 'cowlFlap';
      const inside = frd(loft.frontX + 0.5 * (loft.endX - loft.frontX), side * place.y, place.z);
      const b = new MeshBatch();
      for (const g of plateGeometry(pts, outlineNormal(pts, inside), 0.005, true)) b.add(mat.plainPaint, hinge.adopt(g));
      hinge.object.add(...b.build('cowlFlap').children);
      root.add(hinge.object);
      // A mirrored rotation turns the other way about the mirrored axis.
      cowlFlaps.push({ hinge, angle: side * flap.maxAngle, engine });
    }
  });
  for (const fairing of fairings) {
    const shape = new FuselageShape(0, -Infinity, fairing);
    const paint = fairing.paint === 'band' ? mat.navyPaint : mat.plainPaint;
    for (const side of fairing.mirror ? ([1, -1] as const) : ([1] as const)) {
      addPlacedLoft(batch, paint, shape, fairing, { y: fairing.offset?.y ?? 0, z: fairing.offset?.z ?? 0, side }, true);
    }
  }
  return { group: batch.build('nacelles'), cowlFlaps };
}

/**
 * Ducts behind the cowling inlets, dark inside, with a baffle face deep inside. Each starts just inside the
 * skin all round the opening (the nose bowl is curved, so the skin is at a different x at each point of the
 * outline) and runs aft to the baffle.
 */
function addInletDucts(batch: MeshBatch, mat: AircraftMaterials, outer: FuselageShape, fuselage: AirframeVisualDef['fuselage']): void {
  const cols = 32;
  const rows = 6;
  const ring = new Ring();
  for (const def of fuselage.inlets) {
    const INLET = inletShape(def, fuselage.frontX);
    const BAFFLE_X = def.baffleX ?? fuselage.frontX - 0.175;
    // Body x at which the skin passes through (y, z): the most forward station whose section contains it.
    const skinX = (y: number, z: number): number => {
      let lo = BAFFLE_X;
      let hi = fuselage.frontX;
      for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2;
        if (sectionHalfWidth(outer, mid, z, ring.set(outer.section(mid))) >= Math.abs(y)) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    const cy = INLET.y;
    const lip: number[] = [];
    for (let j = 0; j <= cols; j++) {
      const [u, v] = inletOutline((j / cols) * Math.PI * 2, 0.004, INLET);
      lip.push(skinX(cy + u, INLET.z + v) - 0.004);
    }
    const spec = (flip: boolean): GridSpec => ({
      rows,
      cols: cols + 1,
      wrap: true,
      flip,
      position(i, j, out) {
        const t = i / (rows - 1);
        const [u, v] = inletOutline((j / cols) * Math.PI * 2, 0.004, INLET);
        frd(lip[j] + (BAFFLE_X - lip[j]) * t, cy + u, INLET.z + v + t * 0.02, out);
      },
    });
    // Seen from inside: the normals must point toward the duct's axis.
    let g = gridGeometry(spec(false));
    const p = new THREE.Vector3().fromBufferAttribute(g.getAttribute('position'), cols + 1 + 0);
    const n = new THREE.Vector3().fromBufferAttribute(g.getAttribute('normal'), cols + 1 + 0);
    if (n.dot(frd(-p.z, cy, -p.y).sub(p)) < 0) g = gridGeometry(spec(true));
    batch.add(mat.black, g);
    const back: THREE.Vector3[] = [];
    for (let k = 0; k < 24; k++) {
      const [u, v] = inletOutline((k / 24) * Math.PI * 2, 0.005, INLET);
      back.push(frd(BAFFLE_X, cy + u, INLET.z + 0.02 + v));
    }
    batch.add(mat.darkMetal, capGeometry(back, frd(1, 0, 0)));
  }
}

/** Exhaust stack exiting the lower cowling at `pos`, angled down and aft. */
function addExhaust(batch: MeshBatch, mat: AircraftMaterials, exhaust: NonNullable<AirframeVisualDef['fuselage']['exhaust']>): void {
  const [x0, y0, z0] = exhaust.pos;
  const a = new THREE.Vector3();
  const spec = sweepGeometry(
    (t, out) => {
      frd(x0 - t * 0.14, y0, z0 + t * 0.1, a);
      out.copy(a);
    },
    (t, ang, out) => {
      const r = exhaust.radius - 0.002 * t;
      out.set(Math.cos(ang) * r, Math.sin(ang) * r);
    },
    6,
    20,
    new THREE.Vector3(1, 0, 0),
  );
  batch.add(mat.exhaust, gridGeometry(spec));
  // Open end, sooty inside.
  const lip: THREE.Vector3[] = [];
  const dir = frd(-0.14, 0, 0.1).normalize();
  const end = frd(x0 - 0.14, y0, z0 + 0.1);
  const side = new THREE.Vector3(1, 0, 0);
  const up = new THREE.Vector3().crossVectors(dir, side).normalize();
  const bore = exhaust.radius - 0.005;
  for (let k = 0; k < 20; k++) {
    const ang = (k / 20) * Math.PI * 2;
    lip.push(end.clone().addScaledVector(side, Math.cos(ang) * bore).addScaledVector(up, Math.sin(ang) * bore));
  }
  batch.add(mat.black, capGeometry(lip, dir));
}

/** Blade antennas standing on the roof (VHF comm), stubs hanging from the belly (transponder / DME) and whips. */
function addAntennas(batch: MeshBatch, mat: AircraftMaterials, antennas: AirframeVisualDef['fuselage']['antennas']): void {
  const blade = (x: number, y: number, zBase: number, height: number, down: boolean): THREE.BufferGeometry => {
    // Swept tapered blade: a thin symmetric section lofted from root to tip.
    const spec: GridSpec = {
      rows: 6,
      cols: 17,
      wrap: true,
      flip: down,
      position(i, j, out) {
        const h = (i / 5) * height;
        const chord = 0.2 - 0.12 * (i / 5);
        const sweep = 0.1 * (i / 5);
        const a = (j / 16) * Math.PI * 2;
        const xc = (Math.cos(a) * 0.5 + 0.5) * chord;
        const th = 0.008 * (1 - 0.5 * (i / 5)) * Math.sin(a);
        frd(x + chord / 2 - xc - sweep, y + th, down ? zBase + h : zBase - h, out);
      },
    };
    return gridGeometry(spec);
  };
  for (const a of antennas) {
    if (a.kind === 'blade') batch.add(mat.darkMetal, blade(a.pos[0], a.pos[1], a.pos[2], a.height ?? 0.2, false));
    else if (a.kind === 'stub') batch.add(mat.darkMetal, blade(a.pos[0], a.pos[1], a.pos[2], a.height ?? 0.09, true));
    else {
      // Whip: a thin rod standing on the roof, raked aft.
      const h = a.height ?? 0.5;
      const rod = new THREE.CylinderGeometry(0.002, 0.004, h, 6).translate(0, h / 2, 0).rotateX(0.35);
      const base = frd(a.pos[0], a.pos[1], a.pos[2]);
      batch.add(mat.darkMetal, rod.translate(base.x, base.y, base.z));
    }
  }
}

/** Exterior door handles below the door windows. */
function addDoorHardware(batch: MeshBatch, mat: AircraftMaterials, outer: FuselageShape, doors: AirframeVisualDef['glazing']['doors']): void {
  const ring = new Ring();
  const p = { y: 0, z: 0 };
  for (const door of doors) {
    if (!door.handle) continue;
    for (const side of door.sides === 'both' ? [1, -1] : door.sides === 'right' ? [1] : [-1]) {
      const { x, z } = door.handle;
      ring.set(outer.section(x));
      // Find the skin at the handle's height on this side.
      let yAt = 0;
      for (let k = 0; k < 400; k++) {
        ring.at(side > 0 ? k / 800 : 1 - k / 800, p);
        if (Math.abs(p.z - z) < 0.01) yAt = p.y;
      }
      const handle = new THREE.CapsuleGeometry(0.008, 0.11, 4, 8);
      handle.rotateX(Math.PI / 2);
      handle.translate(yAt + side * 0.018, -z, -x);
      batch.add(mat.chrome, handle);
    }
  }
}
