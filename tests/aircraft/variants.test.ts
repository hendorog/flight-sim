// The variant builders of the airframe model (src/render/aircraft), proven on the synthetic airframes of
// render/aircraft/airframe/testbed.ts before a real type has its data: a low wing with bays and a nacelle gap
// ending under an egg-shaped body, winglets, T-tail and stabilator, the four leg kinds with retract hinges,
// doors and wells, a three-blade variable-pitch propeller of either hand, nacelles with decal inlets and cowl
// flaps, a canopy cockpit with sticks, levers and occupants, lamps on the nose leg, and what a twin costs to draw.
//
// Every block states the fact it checks and where the number comes from: a handbook dimension carried by the
// type's geometry file (src/aircraft/<id>/geometry.ts), rigid-body kinematics, the beam formula the spring leg
// is drawn with, mirror symmetry, or the rule the contract gives for a mechanism.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { C172S_PANEL } from '../../src/aircraft/c172s/panel';
import { C172S_VISUAL } from '../../src/aircraft/c172s/visual';
import { DA20_GEOMETRY } from '../../src/aircraft/da20/geometry';
import { DA42_GEOMETRY } from '../../src/aircraft/da42/geometry';
import { PA34_GEOMETRY } from '../../src/aircraft/pa34/geometry';
import { AIRPORT } from '../../src/core/world';
import { setEngineControl, type WheelState } from '../../src/core/types';
import type { AirframeVisualDef, PropVisualDef, WheelVisualDef, WingVisualDef } from '../../src/render/aircraft/airframe/types';
import { SYNTHETIC_AIRFRAMES, SYNTHETIC_CANOPY, SYNTHETIC_TWIN } from '../../src/render/aircraft/airframe/testbed';
import { AircraftVisual, interiorInView } from '../../src/render/aircraft/AircraftVisual';
import { Cockpit, cockpitControls } from '../../src/render/aircraft/cockpit';
import { buildNacelles, cabinFloorGeometry, createFuselageShapes, inletDecal, sectionHalfWidth } from '../../src/render/aircraft/fuselage';
import { FuselageShape } from '../../src/render/aircraft/fuselageShape';
import { LandingGear } from '../../src/render/aircraft/gear';
import { makeStabPlanform, makeWingletPlanform, makeWingPlanform, sectionPoint } from '../../src/render/aircraft/planformMath';
import { Propeller } from '../../src/render/aircraft/propeller';
import { buildTail } from '../../src/render/aircraft/tail';
import { buildWings, ROOT_UNDER_SKIN, setFlap } from '../../src/render/aircraft/wings';
import { blankDocument, bodyBox, facing, fakeContext, fakeMaterials, nonFinite, renderCost, worldMeshes } from './meshChecks';

// The builders take up to a second a test alone; on a loaded machine (the gate runs every core) several times that.
vi.setConfig({ testTimeout: 60_000 });

beforeAll(() => {
  vi.stubGlobal('document', blankDocument());
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const DEG = Math.PI / 180;

/** Every lofted (painted) mesh under `root` faces outward with normals that agree with its winding. */
function expectOutward(root: THREE.Object3D, paint = /\|(wingPaint|finPaint|plainPaint)$/): number {
  let tested = 0;
  for (const m of worldMeshes(root)) {
    if (!paint.test(m.name)) continue;
    const f = facing(m);
    expect(f.outward / f.total, `${m.name} outward fraction`).toBeGreaterThan(0.9);
    expect(f.normalAgree / f.total, `${m.name} normal/winding agreement`).toBeGreaterThan(0.97);
    tested++;
  }
  return tested;
}

/** World (root-space) positions of a mesh's vertices. */
function positions(mesh: THREE.Mesh, root: THREE.Object3D): THREE.Vector3[] {
  root.updateMatrixWorld(true);
  const m = new THREE.Matrix4().multiplyMatrices(root.matrixWorld.clone().invert(), mesh.matrixWorld);
  const p = mesh.geometry.getAttribute('position');
  return Array.from({ length: p.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m));
}

const meshesNamed = (root: THREE.Object3D, name: string | RegExp): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && (typeof name === 'string' ? o.name === name : name.test(o.name))) out.push(o as THREE.Mesh);
  });
  return out;
};

/** Index of the largest value of `key` over the points. */
const argMax = (pts: THREE.Vector3[], key: (p: THREE.Vector3) => number): number => pts.reduce((best, p, i) => (key(p) > key(pts[best]) ? i : best), 0);

/** A point turned about a body-axis line by the right-hand rule (Rodrigues), FRD in and out. */
function turnFrd(p: readonly number[], pivot: readonly number[], axis: readonly number[], angle: number): [number, number, number] {
  const k = new THREE.Vector3(axis[0], axis[1], axis[2]).normalize();
  const v = new THREE.Vector3(p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]);
  const r = v
    .clone()
    .multiplyScalar(Math.cos(angle))
    .add(new THREE.Vector3().crossVectors(k, v).multiplyScalar(Math.sin(angle)))
    .add(k.clone().multiplyScalar(k.dot(v) * (1 - Math.cos(angle))));
  return [pivot[0] + r.x, pivot[1] + r.y, pivot[2] + r.z];
}

/** FRD body point -> model space, as the builders map it. */
const model = (p: readonly number[]): THREE.Vector3 => new THREE.Vector3(p[1], -p[2], -p[0]);

const wheelState = (name: WheelState['name'], compression = 0, steerAngle = 0): WheelState => ({ name, compression, onGround: false, load: 0, spinRate: 0, rotation: 0, steerAngle, skid: 0 });
const wheels = (compression = 0, steer = 0): WheelState[] => [wheelState('nose', compression, steer), wheelState('left', compression), wheelState('right', compression)];

// ---------------------------------------------------------------------------------------------------------------

describe('wing variants', () => {
  it('low wing with a nacelle gap: bays, hinges, span, facing', () => {
    const def = SYNTHETIC_TWIN.wing;
    const shapes = createFuselageShapes(SYNTHETIC_TWIN);
    const root = new THREE.Group();
    const parts = buildWings(fakeMaterials(), root, def, shapes.outer);
    expect(nonFinite(root)).toBe(0);
    // Two flap bays and one aileron a side, left wing first, each from the root outward.
    expect(parts.surfaces.map((s) => `${s.kind}${s.side}`)).toEqual(['flap-1', 'flap-1', 'aileron-1', 'flap1', 'flap1', 'aileron1']);
    // The span is the PA-34's (its geometry file: 11.85 m).
    const box = bodyBox(root);
    expect(box.y1 - box.y0).toBeCloseTo(PA34_GEOMETRY.wing.span, 2);
    expect(box.y0).toBeCloseTo(-box.y1, 5);
    expect(expectOutward(root)).toBeGreaterThanOrEqual(7);

    // No flap inside the nacelle gap (the fixed bay from 1.5 m to 2.31 m), on either side.
    const gap = def.bays[2];
    expect(gap.kind).toBe('fixed');
    for (const s of parts.surfaces.filter((x) => x.kind === 'flap')) {
      const ys = positions(s.hinge.object.children[0] as THREE.Mesh, root).map((p) => Math.abs(p.x));
      const inside = ys.filter((y) => y > gap.from + 1e-3 && y < gap.to - 1e-3).length;
      expect(inside).toBe(0);
    }

    // A positive angle is trailing edge down on both sides (the hinge axes point to the aircraft's right); a
    // flap also runs aft on its track. Flap chord 0.205 x 1.6 m at 40 degrees: the trailing edge comes down
    // by about (0.205 x 1.6 - nose radius) x sin 40 = 0.19 m plus the 2 cm of the track.
    for (const s of parts.surfaces) {
      const mesh = s.hinge.object.children[0] as THREE.Mesh;
      const before = positions(mesh, root);
      const te = argMax(before, (p) => p.z);
      if (s.kind === 'flap') setFlap(s.hinge, def.flap.maxDeflection, def.flap);
      else s.hinge.setAngle(0.2);
      const after = positions(mesh, root);
      const drop = before[te].y - after[te].y;
      if (s.kind === 'flap') {
        expect(drop).toBeGreaterThan(0.17);
        expect(drop).toBeLessThan(0.24);
        expect(after[te].z - before[te].z).toBeGreaterThan(-0.08);
      } else {
        // Aileron chord 0.175 x 1.6 m less its nose: about 0.25 m x sin 0.2 = 0.05 m.
        expect(drop).toBeGreaterThan(0.035);
        expect(drop).toBeLessThan(0.06);
      }
    }
  });

  it("root: 'conform': the root ring lies 1 cm under the egg-shaped body's skin and outside its lining", () => {
    const def = SYNTHETIC_TWIN.wing;
    const shapes = createFuselageShapes(SYNTHETIC_TWIN);
    const root = new THREE.Group();
    const parts = buildWings(fakeMaterials(), root, def, shapes.outer);
    const structure = parts.structure.children.find((m) => m.name === 'wings:wingPaint') as THREE.Mesh;
    // Everything inboard of the root station is the conformed ring (every other station is at rootY or beyond).
    const ring = positions(structure, root).filter((p) => Math.abs(p.x) < def.rootY - 1e-4);
    // Bay 0 is a full section of 81 contour points, on two sides.
    expect(ring.length).toBe(2 * 81);
    let narrowest = Infinity;
    for (const p of ring) {
      // Model (X, Y, Z) = FRD (y, -z, -x).
      const x = -p.z;
      const z = -p.y;
      const skin = sectionHalfWidth(shapes.outer, x, z);
      const lining = sectionHalfWidth(shapes.lining, x, z);
      narrowest = Math.min(narrowest, skin);
      // Not outside the outer skin: exactly ROOT_UNDER_SKIN inside it.
      expect(skin - Math.abs(p.x)).toBeGreaterThan(ROOT_UNDER_SKIN - 2e-4);
      expect(skin - Math.abs(p.x)).toBeLessThan(ROOT_UNDER_SKIN + 2e-4);
      // Not inside the cabin: clear of the lining (15 mm inside the skin).
      expect(Math.abs(p.x) - lining).toBeGreaterThan(0.003);
    }
    // The case the mechanism is for: the body is well inside the wing's root station at the wing's height (a flat
    // cap at rootY = 0.616 m would float 10 cm and more clear of it).
    expect(narrowest).toBeLessThan(def.rootY - 0.1);
    // And there is no cap at the root station.
    const capped = new THREE.Group();
    buildWings(fakeMaterials(), capped, { ...def, root: 'cap' });
    const cappedStructure = capped.children.find((c) => c.name === 'wings')!.children.find((m) => m.name === 'wings:wingPaint') as THREE.Mesh;
    expect(cappedStructure.geometry.getAttribute('position').count).toBeGreaterThan(structure.geometry.getAttribute('position').count);
    // Without the body's skin a conforming wing cannot be built: it says so.
    expect(() => buildWings(fakeMaterials(), new THREE.Group(), def)).toThrow(/outer skin/);
  });

  it('winglet: continues the tip section, turns up to its cant, mirrors', () => {
    const def = SYNTHETIC_CANOPY.wing;
    const winglet = def.tip.winglet!;
    const wing = makeWingPlanform(def);
    const let_ = makeWingletPlanform(def);
    const tipY = def.breaks[def.breaks.length - 1].y;
    // Continuity: the winglet's first section IS the wing's tip section (no step in the skin).
    for (const [xc, yc] of [[0, 0], [0.3, 0.06], [1, 0], [0.6, -0.04]]) {
      const a = sectionPoint(wing, tipY, xc, yc);
      const b = sectionPoint(let_, 0, xc, yc);
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(1e-9);
    }
    // Its tip: the height is measured along the winglet, so it rises less than height x sin(cant) and more than
    // that less the blend, and reaches out less than its height (DA20 geometry: 0.458 m at 25 degrees).
    const top = let_.ref(winglet.height, { x: 0, y: 0, z: 0 });
    const root = let_.ref(0, { x: 0, y: 0, z: 0 });
    const rise = root.z - top.z;
    expect(rise).toBeLessThan(winglet.height * Math.sin(winglet.cant));
    expect(rise).toBeGreaterThan(0.7 * winglet.height * Math.sin(winglet.cant));
    expect(Math.hypot(top.y - root.y, top.z - root.z)).toBeLessThanOrEqual(winglet.height + 1e-9);
    // Swept: the quarter-chord line goes aft by height x tan(sweep).
    expect(root.x - top.x).toBeCloseTo(winglet.height * Math.tan(winglet.sweep), 9);
    expect(let_.chord(winglet.height)).toBeCloseTo(winglet.tipChord, 9);

    const shapes = createFuselageShapes(SYNTHETIC_CANOPY);
    const group = new THREE.Group();
    buildWings(fakeMaterials(), group, def, shapes.outer);
    expect(nonFinite(group)).toBe(0);
    expect(expectOutward(group)).toBeGreaterThanOrEqual(5);
    // Overall span with the winglets: the DA20's 10.87 m (its geometry file) within 2 cm.
    const box = bodyBox(group);
    expect(box.y1 - box.y0).toBeGreaterThan(DA20_GEOMETRY.wing.span - 0.02);
    expect(box.y1 - box.y0).toBeLessThan(DA20_GEOMETRY.wing.span + 0.02);
    expect(box.y0).toBeCloseTo(-box.y1, 5);
    // The winglet stands above the wing tip (the tip's own upper skin is about 5 cm above its chord plane).
    const tipZ = wing.ref(tipY, { x: 0, y: 0, z: 0 }).z;
    expect(tipZ - box.z0).toBeGreaterThan(0.7 * winglet.height * Math.sin(winglet.cant));
    expect(tipZ - box.z0).toBeLessThan(winglet.height * Math.sin(winglet.cant) + 0.03);
  });

  it('walkways face up on both wings, proud of the skin; stall strips at the leading edge; one lift detector', () => {
    const plain = SYNTHETIC_CANOPY.wing;
    const shapes = createFuselageShapes(SYNTHETIC_CANOPY);
    const named = (g: THREE.Object3D, name: string): THREE.Mesh[] => {
      const out: THREE.Mesh[] = [];
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.name === name) out.push(o as THREE.Mesh);
      });
      return out;
    };
    const bare = new THREE.Group();
    buildWings(fakeMaterials(), bare, plain, shapes.outer);
    expect(named(bare, 'wings:black').length).toBe(0);
    const def: WingVisualDef = {
      ...plain,
      walkways: [{ y0: plain.rootY + 0.05, y1: plain.rootY + 0.4, xc0: 0.2, xc1: 0.9, side: 'both' }],
      stallStrips: [{ y0: 2, y1: 2.2 }],
      liftDetector: { side: -1, y: 2.5 },
    };
    const group = new THREE.Group();
    buildWings(fakeMaterials(), group, def, shapes.outer);
    expect(nonFinite(group)).toBe(0);
    const [walk] = named(group, 'wings:black');
    const pos = walk.geometry.getAttribute('position');
    const nrm = walk.geometry.getAttribute('normal');
    let left = 0, right = 0;
    for (let i = 0; i < pos.count; i++) {
      expect(nrm.getY(i)).toBeGreaterThan(0.8);
      if (pos.getX(i) < 0) left++;
      else right++;
    }
    expect([left, right]).toEqual([pos.count / 2, pos.count / 2]);
    // 3 mm above the upper skin at the same point.
    const wingPf = makeWingPlanform(def);
    const p = sectionPoint(wingPf, def.walkways![0].y0, 0.2, 0);
    expect(pos.getY(pos.count / 2)).toBeGreaterThan(-p.z);
    // The strips and the vane add aluminium to the wing: more of it than on the bare wing.
    const alu = (g: THREE.Object3D): number => named(g, 'wings:aluminium').reduce((n, m) => n + m.geometry.getAttribute('position').count, 0);
    expect(alu(group)).toBeGreaterThan(alu(bare));
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('tail variants', () => {
  it('swept T-tail without a tab: tailplane on the fin tip, square fin top, bullet, ventral fin', () => {
    const def = SYNTHETIC_CANOPY.tail;
    const shapes = createFuselageShapes(SYNTHETIC_CANOPY);
    const root = new THREE.Group();
    const tail = buildTail(fakeMaterials(), root, def, shapes.outer);
    expect(nonFinite(root)).toBe(0);
    expect(expectOutward(root)).toBeGreaterThanOrEqual(5);
    expect(tail.tabs).toEqual([]);
    expect(tail.trimTab).toBeUndefined();
    expect(tail.rudderTab).toBeNull();

    // Sweep: the quarter-chord line runs from the root station to tipQuarterChordX (DA20 geometry).
    // (Measured at zero incidence: the -4 degree setting turns the section about the hinge line, which moves the
    // quarter-chord point 0.49 c (1 - cos 4 deg) = 1 mm.)
    const stab = makeStabPlanform({ ...def, h: { ...def.h, incidence: 0 } });
    const half = def.h.span / 2;
    expect(sectionPoint(stab, 0, 0.25, 0).x).toBeCloseTo(DA20_GEOMETRY.hTail.quarterChord.x, 9);
    expect(sectionPoint(stab, half, 0.25, 0).x).toBeCloseTo(DA20_GEOMETRY.hTail.tipQuarterChordX!, 9);
    // The 74 % chord line therefore sweeps aft by (-4.9663 + 5.0325) = 0.066 m over the half span of 1.33 m,
    // 2.85 degrees. The hinge axis runs through the centres of the elevator's rounded nose, a fixed fraction of
    // the chord aft of that line, which on a surface tapering from 0.87 to 0.41 m sweeps it a little less
    // (2.5 degrees). Both hinge axes point to the aircraft's right.
    for (const [i, side] of [
      [0, -1],
      [1, 1],
    ] as const) {
      const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(tail.elevators[i].object.quaternion);
      expect(axis.x).toBeGreaterThan(0.99);
      const sweep = Math.atan2(side * axis.z, axis.x) / DEG;
      expect(sweep).toBeGreaterThan(2.0);
      expect(sweep).toBeLessThan(2.85);
      // On the fin tip: the hinge is at the tailplane's height.
      expect(-tail.elevators[i].origin.y).toBeCloseTo(def.h.quarterChord.z, 1);
    }
    // Trailing edge down for a positive elevator angle on both halves.
    for (const e of tail.elevators) {
      const mesh = e.object.children[0] as THREE.Mesh;
      const before = positions(mesh, root);
      const te = argMax(before, (p) => p.z);
      e.setAngle(0.2);
      expect(before[te].y - positions(mesh, root)[te].y).toBeGreaterThan(0.02);
      e.setAngle(0);
    }

    // The fin is not rounded off under the tailplane: at its top it is still a section thick (10 % of the 0.82 m
    // tip chord, less toward the hinge), where the Cessna's rounded tip closes to a few millimetres.
    const finTopWidth = (group: THREE.Object3D): number => {
      const fin = group.children.find((c) => c.name === 'tail')!.children.find((m) => m.name === 'tail:finPaint') as THREE.Mesh;
      const pts = positions(fin, group);
      const top = Math.max(...pts.map((p) => p.y));
      return Math.max(...pts.filter((p) => p.y > top - 1e-4).map((p) => Math.abs(p.x)));
    };
    expect(finTopWidth(root)).toBeGreaterThan(0.03);
    const cessna = new THREE.Group();
    buildTail(fakeMaterials(), cessna);
    expect(finTopWidth(cessna)).toBeLessThan(0.006);

    // Bullet fairing and ventral fin are the plain-painted parts of the structure.
    const plain = tail.structure.children.find((m) => m.name === 'tail:plainPaint') as THREE.Mesh;
    const pts = positions(plain, root);
    const bullet = pts.filter((p) => -p.y < def.h.quarterChord.z + 0.2);
    const le = sectionPoint(stab, 0, 0, 0).x;
    // From 0.15 chord ahead of the root leading edge to the root trailing edge.
    expect(Math.max(...bullet.map((p) => -p.z))).toBeCloseTo(le + 0.15 * def.h.rootChord, 2);
    expect(Math.min(...bullet.map((p) => -p.z))).toBeCloseTo(le - 0.99 * def.h.rootChord, 2);
    // The ventral fin hangs below the boom by nearly its depth (0.2 m), and nowhere above the boom's belly line.
    const ventral = pts.filter((p) => -p.y > def.v.base.z);
    let deepest = 0;
    for (const p of ventral) deepest = Math.max(deepest, -p.y - shapes.outer.section(-p.z).zBot);
    expect(deepest).toBeGreaterThan(0.85 * def.ventralFin!.depth);
    expect(deepest).toBeLessThanOrEqual(def.ventralFin!.depth + 1e-6);
    expect(Math.min(...ventral.map((p) => -p.z))).toBeCloseTo(def.ventralFin!.x1, 3);
  });

  it('stabilator: the whole surface turns about its pivot line; geared tabs, rudder tab, dorsal fillet', () => {
    const def = SYNTHETIC_TWIN.tail;
    const shapes = createFuselageShapes(SYNTHETIC_TWIN);
    const root = new THREE.Group();
    const tail = buildTail(fakeMaterials(), root, def, shapes.outer);
    expect(nonFinite(root)).toBe(0);
    expect(expectOutward(root)).toBeGreaterThanOrEqual(6);
    // No fixed stabiliser: the wing-painted parts are all on the two hinges.
    expect(tail.structure.children.some((m) => m.name === 'tail:wingPaint')).toBe(false);
    expect(tail.tabs.length).toBe(2);
    expect(tail.trimTab).toBe(tail.tabs[0]);
    expect(tail.tabGearing).toBe(1.5);
    expect(tail.rudderTab).not.toBeNull();

    // Rigid rotation about the pivot line at 27 % of the 0.871 m chord (PA-34 geometry): at 0.2 rad the leading
    // edge rises 0.27 c sin 0.2 = 0.0467 m and the trailing edge drops 0.73 c sin 0.2 = 0.1263 m.
    const c = PA34_GEOMETRY.hTail.rootChord;
    const pivot = def.h.pivotFraction!;
    for (const half of tail.elevators) {
      const mesh = half.object.children.find((m) => m.name === 'stabilator:wingPaint') as THREE.Mesh;
      const before = positions(mesh, root);
      const le = argMax(before, (p) => -p.z);
      const te = argMax(before, (p) => p.z);
      half.setAngle(0.2);
      const after = positions(mesh, root);
      expect(after[le].y - before[le].y).toBeCloseTo(pivot * c * Math.sin(0.2), 3);
      expect(before[te].y - after[te].y).toBeCloseTo((1 - pivot) * c * Math.sin(0.2), 3);
      // Nothing of it stays behind: every vertex moved except those on the pivot line.
      const still = after.filter((p, i) => p.distanceTo(before[i]) < 1e-4).length;
      expect(still / after.length).toBeLessThan(0.05);
      half.setAngle(0);
    }
    // The tabs ride on the stabilator halves (they move with them) and are cut out of them: the stabilator's
    // trailing edge between the tab's ends stops at the tab's hinge (82 % chord).
    for (const tab of tail.tabs) expect(tail.elevators.some((e) => e.object === tab.object.parent)).toBe(true);
    const right = positions(tail.elevators[1].object.children.find((m) => m.name === 'stabilator:wingPaint') as THREE.Mesh, root);
    const qc = def.h.quarterChord.x;
    const inTabSpan = right.filter((p) => p.x > def.h.tab!.y0 + 0.05 && p.x < def.h.tab!.y1 - 0.05);
    const aftMost = Math.min(...inTabSpan.map((p) => -p.z));
    expect(aftMost).toBeCloseTo(qc + 0.25 * c - (def.h.tab!.xc - 0.004) * c, 3);

    // The rudder tab rides on the rudder; the dorsal fillet starts at its station on the body's top line.
    expect(tail.rudderTab!.object.parent).toBe(tail.rudder.object);
    const plain = tail.structure.children.find((m) => m.name === 'tail:plainPaint') as THREE.Mesh;
    const fillet = positions(plain, root);
    expect(Math.max(...fillet.map((p) => -p.z))).toBeCloseTo(def.dorsalFillet!.x0, 3);
    // Its top is `height` above the fin base.
    expect(Math.max(...fillet.map((p) => p.y))).toBeCloseTo(-def.v.base.z + def.dorsalFillet!.height, 2);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('landing gear variants', () => {
  /** Tyre meshes in the order nose, left, right, with their centres in the gear group's space. */
  const tyres = (gear: LandingGear, def: AirframeVisualDef['gear']): { mesh: THREE.Mesh; centre(): THREE.Vector3 }[] => {
    const all = meshesNamed(gear.group, '').filter((m) => (m.material as THREE.Material).name === 'tyre');
    expect(all.length).toBe(3);
    const centre = (mesh: THREE.Mesh) => (): THREE.Vector3 => {
      gear.group.updateMatrixWorld(true);
      return new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(gear.group.matrixWorld.clone().invert(), mesh.matrixWorld));
    };
    gear.update(wheels());
    // Told apart by where they stand when down.
    return def.map((w) => {
      const at = model([w.contact[0], w.contact[1], w.contact[2] - w.radius]);
      const mesh = all.find((m) => centre(m)().distanceTo(at) < 1e-3)!;
      expect(mesh, 'a tyre at each contact point less its radius').toBeDefined();
      return { mesh, centre: centre(mesh) };
    });
  };

  it('three retracting oleo legs: rigid swing by the right-hand rule, hidden when up, doors, wells', () => {
    const def = SYNTHETIC_TWIN.gear;
    const gear = new LandingGear(fakeMaterials(), true, def);
    const t = tyres(gear, def);
    expect(nonFinite(gear.group)).toBe(0);
    // Down: the tyres stand on the contact points of the PA-34 geometry (lowest point of the gear = the main
    // wheels' contact height).
    expect(bodyBox(gear.group).z1).toBeCloseTo(PA34_GEOMETRY.gear.rightMain.z, 3);

    const ease = (e: number): number => e * e * (3 - 2 * e);
    for (const extension of [0.75, 0.5, 0.2]) {
      gear.update(wheels(), [extension, extension, extension]);
      def.forEach((w, i) => {
        const r = w.retract!;
        // The wheel centre is the down position turned about the retract axis by angle x (1 - ease(extension)).
        const expected = model(turnFrd([w.contact[0], w.contact[1], w.contact[2] - w.radius], r.pivot, r.axis, r.angle * (1 - ease(extension))));
        expect(t[i].centre().distanceTo(expected), `wheel ${i} at extension ${extension}`).toBeLessThan(1e-4);
      });
    }
    // Nearly up: the nose wheel has gone forward into the nose, the main wheels inboard into the wing, all of them
    // up to about the height of their pivots.
    gear.update(wheels(), [0.02, 0.02, 0.02]);
    const up = t.map((x) => x.centre());
    expect(-up[0].z).toBeGreaterThan(def[0].retract!.pivot[0] + 0.5);
    expect(up[1].x).toBeGreaterThan(def[1].contact[1] + 0.7);
    expect(up[2].x).toBeLessThan(def[2].contact[1] - 0.7);
    for (let i = 0; i < 3; i++) expect(-up[i].y).toBeLessThan(def[i].retract!.pivot[2] + 0.25);

    // Fully up the legs are not drawn; a fixed gear's are always.
    const hinges: THREE.Object3D[] = [];
    gear.group.traverse((o) => {
      if (o.name === 'gearRetract') hinges.push(o);
    });
    expect(hinges.length).toBe(3);
    gear.update(wheels(), [0, 0, 0]);
    expect(hinges.map((h) => h.visible)).toEqual([false, false, false]);
    gear.update(wheels(), [1, 1, 0]);
    expect(hinges.filter((h) => h.visible).length).toBe(2);

    // Doors: closed (flush: within their 6 mm of the outline's plane) when up, swung by their angle when down.
    // A nose door is 0.15 m wide and opens 85 degrees: its free edge travels the chord 2 x 0.15 x sin(42.5) = 0.203 m.
    const doors = meshesNamed(gear.group, 'gearDoor:plainPaint');
    expect(doors.length).toBe(4);
    gear.update(wheels(), [0, 0, 0]);
    const closed = doors.map((d) => positions(d, gear.group));
    gear.update(wheels(), [1, 1, 1]);
    const open = doors.map((d) => positions(d, gear.group));
    const travel = closed.map((pts, d) => Math.max(...pts.map((p, i) => p.distanceTo(open[d][i]))));
    const noseDoors = travel.filter((x) => Math.abs(x - 2 * 0.15 * Math.sin(42.5 * DEG)) < 0.012);
    expect(noseDoors.length).toBe(2);
    // Every door opens downward (its free edge ends lower than it started).
    closed.forEach((pts, d) => {
      const i = argMax(pts, (p) => p.distanceTo(open[d][pts.indexOf(p)]));
      expect(open[d][i].y).toBeLessThan(pts[i].y - 0.1);
    });
    const rig = gear.shadowRig();
    for (const d of doors) expect(rig.none).toContain(d);
    for (const h of hinges) expect(rig.moving).toContain(h);

    // Wells: flat dark decals of exactly the outlines' area (nose 0.3 x hypot(1.1, 0.2), mains 0.52 x 1.11 each).
    const well = meshesNamed(gear.group, 'gearFixed:black')[0];
    const p = well.geometry.getAttribute('position');
    const idx = well.geometry.index!;
    let area = 0;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i < idx.count; i += 3) {
      a.fromBufferAttribute(p, idx.getX(i));
      b.fromBufferAttribute(p, idx.getX(i + 1));
      c.fromBufferAttribute(p, idx.getX(i + 2));
      area += b.sub(a).cross(c.sub(a)).length() / 2;
    }
    expect(area).toBeCloseTo(0.3 * Math.hypot(1.1, 0.2) + 2 * 0.52 * 1.11, 4);
  });

  it('leaf-spring main legs bend as cantilevers; the castering spring-tube nose wheel swivels', () => {
    const def = SYNTHETIC_CANOPY.gear;
    const gear = new LandingGear(fakeMaterials(), true, def);
    const t = tyres(gear, def);
    expect(nonFinite(gear.group)).toBe(0);
    let tested = 0;
    for (const m of worldMeshes(gear.group)) {
      if (!/\|plainPaint$/.test(m.name)) continue;
      const f = facing(m);
      expect(f.outward / f.total, m.name).toBeGreaterThan(0.9);
      expect(f.normalAgree / f.total, m.name).toBeGreaterThan(0.97);
      tested++;
    }
    expect(tested).toBeGreaterThanOrEqual(6);

    // The legs are the casters that keep casting themselves: left, right, nose.
    const legs = gear.shadowRig().keep;
    expect(legs.length).toBe(3);
    const ROWS = 14;
    const COLS = 17;
    /** Centre of ring `row` of a leg's grid. */
    const ringCentre = (leg: THREE.Mesh, row: number): THREE.Vector3 => {
      const p = leg.geometry.getAttribute('position');
      const c = new THREE.Vector3();
      for (let j = 0; j < COLS - 1; j++) c.add(new THREE.Vector3().fromBufferAttribute(p, row * COLS + j));
      return c.divideScalar(COLS - 1);
    };
    const rest = legs.map((leg) => [0, 7, ROWS - 1].map((row) => ringCentre(leg, row)));
    const centres = t.map((x) => x.centre());
    const c = 0.05;
    gear.update(wheels(c));
    legs.forEach((leg, k) => {
      // Euler-Bernoulli cantilever with a load at its end: w(s) / w(1) = s^2 (3 - s) / 2. The root does not move,
      // the end moves by the strut compression, the ring at s = 7 / 13 by 0.3568 of it.
      const s = 7 / 13;
      expect(ringCentre(leg, 0).y - rest[k][0].y).toBeCloseTo(0, 6);
      expect(ringCentre(leg, 7).y - rest[k][1].y).toBeCloseTo((c * s * s * (3 - s)) / 2, 5);
      expect(ringCentre(leg, ROWS - 1).y - rest[k][2].y).toBeCloseTo(c, 6);
    });
    // The wheels come up with the leg ends.
    t.forEach((x, i) => expect(x.centre().y - centres[i].y).toBeCloseTo(c, 6));

    // A leaf is flat: at ring 7 of a main leg it is `width` (x 0.838 there: it narrows 30 % toward the axle)
    // along the aircraft and `thickness` through.
    const leaf = def[1].leg as Extract<WheelVisualDef['leg'], { kind: 'leafSpring' }>;
    const p = legs[0].geometry.getAttribute('position');
    const ring = Array.from({ length: COLS - 1 }, (_, j) => new THREE.Vector3().fromBufferAttribute(p, 7 * COLS + j));
    const along = Math.max(...ring.map((v) => v.z)) - Math.min(...ring.map((v) => v.z));
    const through = Math.hypot(Math.max(...ring.map((v) => v.x)) - Math.min(...ring.map((v) => v.x)), Math.max(...ring.map((v) => v.y)) - Math.min(...ring.map((v) => v.y)));
    expect(along).toBeCloseTo(leaf.width * (1 - (0.3 * 7) / 13), 3);
    expect(through).toBeCloseTo(leaf.thickness, 2);
    expect(along / through).toBeGreaterThan(4);

    // Castering: a positive steer angle turns the nose wheel to the right about the vertical (its rolling
    // direction, model -Z at rest, swings toward +X by the angle); the main wheels do not turn.
    gear.update(wheels(0, 0.5));
    gear.group.updateMatrixWorld(true);
    const heading = (mesh: THREE.Mesh): THREE.Vector3 => new THREE.Vector3(0, 0, -1).transformDirection(mesh.matrixWorld);
    expect(heading(t[0].mesh).x).toBeCloseTo(Math.sin(0.5), 6);
    expect(heading(t[0].mesh).z).toBeCloseTo(-Math.cos(0.5), 6);
    expect(heading(t[1].mesh).x).toBeCloseTo(0, 9);
  });

  it('trailing-link legs: the axle swings on the arc of the arm; with retract hinges', () => {
    // The DA42 pattern on its contact points: arm pivots 0.30 m ahead of and 0.105 m above the axles.
    const G = DA42_GEOMETRY.gear;
    const link = (contact: { x: number; y: number; z: number }, radius: number, side: -1 | 0 | 1): WheelVisualDef => {
      const axle = [contact.x, contact.y, contact.z - radius] as const;
      const pivot = [axle[0] + 0.3, axle[1], axle[2] - 0.105] as const;
      return {
        contact: [contact.x, contact.y, contact.z],
        radius,
        width: 0.14,
        rimRadius: 0.07,
        leg: { kind: 'trailingLink', pivot, armLen: Math.hypot(0.3, 0.105), top: [pivot[0], pivot[1], pivot[2] - 0.45] },
        retract: side === 0 ? undefined : { pivot: [pivot[0], pivot[1], pivot[2] - 0.45], axis: [1, 0, 0], angle: side * 85 * DEG, doors: [] },
      };
    };
    const def: AirframeVisualDef['gear'] = [link(G.nose, G.noseWheelRadius, 0), link(G.leftMain, G.mainWheelRadius, -1), link(G.rightMain, G.mainWheelRadius, 1)];
    const gear = new LandingGear(fakeMaterials(), false, def);
    const t = tyres(gear, def);
    expect(nonFinite(gear.group)).toBe(0);
    const rest = t.map((x) => x.centre());
    const c = 0.06;
    gear.update(wheels(c));
    t.forEach((x, i) => {
      const now = x.centre();
      const pivot = model((def[i].leg as { pivot: readonly number[] }).pivot);
      // Rigid arm: the axle stays armLen from the pivot, rises by the compression, and so moves aft from
      // sqrt(L^2 - 0.105^2) = 0.300 to sqrt(L^2 - 0.045^2) = 0.3146 m behind the pivot.
      expect(now.distanceTo(pivot)).toBeCloseTo(Math.hypot(0.3, 0.105), 6);
      expect(now.y - rest[i].y).toBeCloseTo(c, 6);
      expect(now.z - rest[i].z).toBeCloseTo(Math.sqrt(0.3 ** 2 + 0.105 ** 2 - 0.045 ** 2) - 0.3, 6);
    });
    // The nose leg steers about the vertical through its pivot; the mains retract inboard.
    gear.update(wheels(0, 0.3));
    const pivot0 = model((def[0].leg as { pivot: readonly number[] }).pivot);
    const steered = t[0].centre();
    expect(steered.x - pivot0.x).toBeCloseTo(0.3 * Math.sin(0.3) * -1, 6);
    gear.update(wheels(), [1, 0.02, 0.02]);
    expect(t[1].centre().x).toBeGreaterThan(G.leftMain.y + 0.5);
    expect(t[2].centre().x).toBeLessThan(G.rightMain.y - 0.5);
    expect(gear.shadowRig().moving.length).toBe(3 * 2 + 2);
  });

  it('the Cessna 172S gear keeps its update signature and never hides', () => {
    const gear = new LandingGear(fakeMaterials(), true);
    gear.update(wheels(0.03));
    gear.update(wheels(0.03), [0, 0, 0]);
    let hidden = 0;
    gear.group.traverse((o) => {
      if (!o.visible) hidden++;
    });
    expect(hidden).toBe(0);
    expect(gear.noseMount).toBe(gear.group);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('propeller variants', () => {
  const base = SYNTHETIC_TWIN.props[0];
  const hands: PropVisualDef[] = [
    { ...base, hub: [0, 0, 0], rotation: 1 },
    { ...base, hub: [0, 0, 0], rotation: -1 },
  ];
  const R = base.diameter / 2;
  const blades = (prop: Propeller): THREE.InstancedMesh[] => meshesNamed(prop.group, /^blade/) as THREE.InstancedMesh[];
  const ROWS = 24;
  const COLS = 13;
  /** Radius fraction of grid row i (the blade builder's spacing), and the row nearest 0.75 R. */
  const fraction = (i: number): number => 0.1 / R + (1 - 0.1 / R) * Math.sin((Math.PI / 2) * (i / (ROWS - 1)));
  const ROW75 = Array.from({ length: ROWS }, (_, i) => i).reduce((a, b) => (Math.abs(fraction(b) - 0.75) < Math.abs(fraction(a) - 0.75) ? b : a));
  /** Blade angle of instance k at row ROW75: the chord line (trailing to leading edge) against the plane of rotation, deg. */
  const bladeAngle = (prop: Propeller, def: PropVisualDef, instance = 0): number => {
    const front = blades(prop)[0];
    const p = front.geometry.getAttribute('position');
    const m = new THREE.Matrix4();
    front.getMatrixAt(instance, m);
    // Thrust face columns run trailing edge -> leading edge.
    const te = new THREE.Vector3().fromBufferAttribute(p, ROW75 * COLS).applyMatrix4(m);
    const le = new THREE.Vector3().fromBufferAttribute(p, ROW75 * COLS + COLS - 1).applyMatrix4(m);
    const chord = le.sub(te);
    // Forward is model -Z; the blade at twelve o'clock (+Y) moves toward +X for rotation 1 and -X for rotation
    // -1: the direction of motion of a blade along `axis` is forward x axis, times the hand.
    const axis = new THREE.Vector3(0, 1, 0).transformDirection(m);
    const motion = new THREE.Vector3(0, 0, -1).cross(axis).multiplyScalar(def.rotation);
    return Math.atan2(-chord.z, chord.dot(motion)) / DEG;
  };

  it('three blades, variable pitch: built at the reference angle, turned to the blade angle per instance', () => {
    for (const def of hands) {
      const prop = new Propeller(fakeMaterials(), def, true);
      expect(blades(prop).length).toBe(2);
      // One blade per face, room for blades x 16 smear copies.
      for (const b of blades(prop)) expect(b.instanceMatrix.count).toBe(3 * 16);
      prop.update(0, 0);
      expect(nonFinite(prop.group)).toBe(0);
      for (const b of blades(prop)) expect(b.count).toBe(3);
      // The twist is the helix through the reference angle at 0.75 R: beta(r) = atan(tan(ref) x 0.75 R / r).
      const expected = Math.atan((Math.tan(def.referencePitch) * 0.75) / fraction(ROW75)) / DEG;
      expect(Math.abs(expected - 20)).toBeLessThan(0.5);
      expect(bladeAngle(prop, def)).toBeCloseTo(expected, 3);
      // Coarse, and feathered: the whole blade turns by the difference from the reference angle.
      prop.update(0, 0, 45 * DEG);
      expect(bladeAngle(prop, def)).toBeCloseTo(expected + 25, 3);
      prop.update(0, 0, 84 * DEG);
      expect(bladeAngle(prop, def)).toBeCloseTo(expected + 64, 3);
      for (let k = 0; k < 3; k++) expect(bladeAngle(prop, def, k)).toBeCloseTo(expected + 64, 3);
      // A balanced propeller: the three blade axes sum to zero.
      const front = blades(prop)[0];
      const sum = new THREE.Vector3();
      const m = new THREE.Matrix4();
      for (let k = 0; k < 3; k++) {
        front.getMatrixAt(k, m);
        sum.add(new THREE.Vector3(0, 1, 0).transformDirection(m));
      }
      expect(sum.length()).toBeLessThan(1e-6);
      prop.dispose();
    }
  });

  it('rotation -1 is the mirror image; the spin angle is the state\'s own; the smear trails', () => {
    const [cw, ccw] = hands.map((def) => new Propeller(fakeMaterials(), def, true));
    for (const face of [0, 1]) {
      const a = blades(cw)[face].geometry.getAttribute('position');
      const b = blades(ccw)[face].geometry.getAttribute('position');
      expect(a.count).toBe(ROWS * COLS);
      let worst = 0;
      for (let i = 0; i < a.count; i++) worst = Math.max(worst, Math.abs(a.getX(i) + b.getX(i)), Math.abs(a.getY(i) - b.getY(i)), Math.abs(a.getZ(i) - b.getZ(i)));
      // Mirror symmetry in the plane through the blade axis and the shaft.
      expect(worst).toBeLessThan(1e-6);
    }
    for (const [prop, def] of [
      [cw, hands[0]],
      [ccw, hands[1]],
    ] as const) {
      const [front, back] = blades(prop);
      // The leading edge leads: for rotation 1 the blade at twelve o'clock moves to the right (+X).
      const p = front.geometry.getAttribute('position');
      expect(def.rotation * (p.getX(ROW75 * COLS + COLS - 1) - p.getX(ROW75 * COLS))).toBeGreaterThan(0.05);
      // The thrust face looks forward (model -Z) and the back aft, whichever hand; windings agree with the normals.
      for (const [mesh, sign] of [
        [front, -1],
        [back, 1],
      ] as const) {
        const n = mesh.geometry.getAttribute('normal');
        let mean = 0;
        for (let i = 0; i < n.count; i++) mean += (sign * n.getZ(i)) / n.count;
        expect(mean).toBeGreaterThan(0.6);
        const f = facing(new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), 400, 0.01);
        expect(f.normalAgree / f.total).toBeGreaterThan(0.99);
      }
      // The spin angle is PropellerState.rotation as it comes, already signed: never negated by the definition.
      prop.update(0.7, 0);
      expect(prop.group.rotation.z).toBe(-0.7);
      prop.update(-0.7, 0);
      expect(prop.group.rotation.z).toBe(0.7);
      // At 600 rpm one 1/60 s exposure sweeps 600 / 60 / 60 rev = 60 degrees: sixteen copies of each blade trail
      // over that angle, behind the blade: toward +Z rotation for rotation 1, the other way for -1.
      prop.update(0, 600);
      expect(front.count).toBe(48);
      const m = new THREE.Matrix4();
      front.getMatrixAt(15, m);
      const axis = new THREE.Vector3(0, 1, 0).transformDirection(m);
      expect(Math.atan2(-axis.x, axis.y)).toBeCloseTo((def.rotation * Math.PI) / 3, 6);
    }
    // The three-blade variable-pitch propeller sends no more triangles than the Cessna's two-blade fixed one.
    const cessna = new Propeller(fakeMaterials());
    cessna.update(0, 600);
    cw.update(0, 600);
    const triangles = (prop: Propeller): number => blades(prop).reduce((sum, b) => sum + (b.geometry.index!.count / 3) * b.count, 0);
    expect(triangles(cw)).toBeLessThanOrEqual(triangles(cessna));
    cw.dispose();
    ccw.dispose();
    cessna.dispose();
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('nacelles and fairings', () => {
  it('two mirrored nacelles on the propeller axes, root fillets, cowl flaps that open downward', () => {
    const root = new THREE.Group();
    const parts = buildNacelles(fakeMaterials(), root, SYNTHETIC_TWIN.nacelles, SYNTHETIC_TWIN.fairings);
    root.add(parts.group);
    expect(nonFinite(root)).toBe(0);
    const skin = parts.group.children.find((m) => m.name === 'nacelles:plainPaint') as THREE.Mesh;
    const f = facing(skin, 600);
    expect(f.outward / f.total).toBeGreaterThan(0.9);
    expect(f.normalAgree / f.total).toBeGreaterThan(0.97);
    // Mirror symmetry: for every vertex there is one at -y (the left nacelle and fillet are the right ones mirrored).
    const pts = positions(skin, root);
    const box = bodyBox(parts.group);
    expect(box.y0).toBeCloseTo(-box.y1, 6);
    const right = pts.filter((p) => p.x > 0);
    expect(right.length).toBe(pts.length / 2);
    // The nacelles stand on the propeller axes of the PA-34 geometry: outboard edge = hub y + the loft's half width.
    const hub = PA34_GEOMETRY.propellers![1].hub;
    expect(box.y1).toBeCloseTo(hub.y + 0.36, 2);
    // From the spinner backplate to the aft end of the root fillets (they run further aft than the nacelles).
    expect(box.x1).toBeCloseTo(SYNTHETIC_TWIN.nacelles[0].loft.frontX, 2);
    expect(box.x0).toBeCloseTo(Math.min(SYNTHETIC_TWIN.nacelles[0].loft.endX, ...SYNTHETIC_TWIN.fairings!.map((f) => f.endX)), 2);

    // Cowl flaps: one per nacelle, engine by engine; open = trailing edge down on BOTH sides, by 0.3 m x sin(0.45).
    expect(parts.cowlFlaps.map((c) => c.engine)).toEqual([0, 1]);
    for (const flap of parts.cowlFlaps) {
      const mesh = flap.hinge.object.children[0] as THREE.Mesh;
      const before = positions(mesh, root);
      const te = argMax(before, (p) => p.z);
      flap.hinge.setAngle(flap.angle);
      const after = positions(mesh, root);
      expect(before[te].y - after[te].y).toBeCloseTo(0.3 * Math.sin(0.45), 2);
    }
  });

  it('a nacelle inlet is a decal on the nose bowl: its outline, 4 mm proud of the skin at every vertex', () => {
    const nacelle = SYNTHETIC_TWIN.nacelles[1];
    const loft = nacelle.loft;
    const shape = new FuselageShape(0, -Infinity, loft);
    for (const side of [1, -1] as const) {
      const place = { y: loft.offset!.y, z: loft.offset!.z, side };
      const inlet = nacelle.inlets[0];
      const g = inletDecal(shape, loft, inlet, place);
      const p = g.getAttribute('position');
      const n = g.getAttribute('normal');
      let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < p.count; i++) {
        // Model (X, Y, Z) = FRD (y, -z, -x); back to the loft's own axes.
        const x = -p.getZ(i);
        const y = side * p.getX(i) - place.y;
        const z = -p.getY(i) - place.z;
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
        // 4 mm behind the vertex the skin's section contains its (y, z); at the vertex it no longer does: the
        // decal lies on the skin's outside, not buried in it.
        expect(sectionHalfWidth(shape, x - 0.0041, z)).toBeGreaterThanOrEqual(Math.abs(y) - 1e-4);
        expect(sectionHalfWidth(shape, x + 0.0005, z)).toBeLessThan(Math.abs(y) + 1e-4);
        // Facing forward.
        expect(n.getZ(i)).toBeLessThan(0);
      }
      // The outline is the definition's w x h rounded rectangle about (y, z).
      expect(y1 - y0).toBeCloseTo(inlet.w, 3);
      expect(z1 - z0).toBeCloseTo(inlet.h, 3);
      expect((y0 + y1) / 2).toBeCloseTo(inlet.y, 3);
      expect((z0 + z1) / 2).toBeCloseTo(inlet.z, 3);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('cockpit variants', () => {
  const build = (def: AirframeVisualDef): Cockpit => {
    const shapes = createFuselageShapes(def);
    const floor = def.cockpit.floor;
    return new Cockpit(fakeMaterials(), cabinFloorGeometry(shapes.lining, floor.z, floor.x0, floor.x1), shapes, def.cockpit, C172S_PANEL);
  };
  /** The groups (direct children of the cockpit group) that hold a mesh of this name. */
  const holders = (cockpit: Cockpit, name: string): THREE.Object3D[] => cockpit.group.children.filter((g) => g.children.some((m) => m.name === name));
  /** Where a point of a node's own space is in the cockpit group. */
  const at = (node: THREE.Object3D, x: number, y: number, z: number): THREE.Vector3 => {
    node.updateMatrix();
    return new THREE.Vector3(x, y, z).applyMatrix4(node.matrix);
  };

  it('canopy cockpit: sticks, console levers, a flap switch; none of the Cessna cabin fittings', () => {
    const def = SYNTHETIC_CANOPY;
    const cockpit = build(def);
    expect(nonFinite(cockpit.group)).toBe(0);
    const ctx = fakeContext();
    const sticks = holders(cockpit, 'stick:black');
    expect(sticks.length).toBe(2);
    const column = def.cockpit.column as Extract<AirframeVisualDef['cockpit']['column'], { kind: 'stick' }>;
    const h = column.height;
    cockpit.update(ctx.state, ctx.controls, 1);
    const neutral = sticks.map((s) => at(s, 0, h, 0));
    // Full back: the grip (0.36 m above the pivot) moves aft by h sin(14 deg) = 0.087 m; full right: to the right.
    Object.assign(ctx.controls, { elevator: 1, aileron: 0 });
    cockpit.update(ctx.state, ctx.controls, 1);
    sticks.forEach((s, i) => expect(at(s, 0, h, 0).z - neutral[i].z).toBeCloseTo(h * Math.sin(column.pitchDeg * DEG), 6));
    Object.assign(ctx.controls, { elevator: 0, aileron: 1 });
    cockpit.update(ctx.state, ctx.controls, 1);
    sticks.forEach((s, i) => expect(at(s, 0, h, 0).x - neutral[i].x).toBeCloseTo(h * Math.sin(column.rollDeg * DEG), 6));
    expect(cockpit.shadowRig().moving).toEqual(sticks);

    // Throttle lever: forward of its pivot at full throttle, aft at idle, by length x sin(travel / 2).
    const throttle = holders(cockpit, 'lever:knobBlack')[0];
    const lever = def.cockpit.engineControls[0];
    ctx.controls.throttle = 1;
    cockpit.update(ctx.state, ctx.controls, 1);
    const forward = at(throttle, 0, lever.length!, 0).z;
    ctx.controls.throttle = 0;
    cockpit.update(ctx.state, ctx.controls, 1);
    expect(at(throttle, 0, lever.length!, 0).z - forward).toBeCloseTo(2 * lever.length! * Math.sin(lever.travel / 2), 6);
    // Alternate air is a knob pulled for ON (the other knobs are pushed in for full).
    const knob = holders(cockpit, 'knob:knobWhite')[0];
    const off = knob.position.z;
    ctx.controls.alternateAir = true;
    cockpit.update(ctx.state, ctx.controls, 1);
    expect(knob.position.z - off).toBeCloseTo(def.cockpit.engineControls[2].travel, 9);
    // Flap switch tilts through its travel.
    const flap = holders(cockpit, 'flapLever:knobWhite')[0];
    ctx.controls.flaps = 1;
    cockpit.update(ctx.state, ctx.controls, 1);
    const down = flap.rotation.x;
    ctx.controls.flaps = 0;
    cockpit.update(ctx.state, ctx.controls, 1);
    expect(down - flap.rotation.x).toBeCloseTo(def.cockpit.flapControl.travel, 9);

    // No compass, trim wheel, visors, yokes or gear lever in this cockpit.
    const names = new Set<string>();
    cockpit.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) names.add(`${o.name}|${((o as THREE.Mesh).material as THREE.Material).name}`);
    });
    for (const absent of [/compassCard/, /sunVisor/, /^trimWheel/, /^yoke/, /^gearLever/]) expect([...names].some((n) => absent.test(n)), String(absent)).toBe(false);
    expect(cockpit.ownMaterials.map((m) => m.name)).toEqual(['instrumentPanel', 'sunVisor', 'rocker']);
    // The instructor's "yoke" target is the pilot's stick grip.
    const target = cockpitControls(def.cockpit, C172S_PANEL).yoke;
    expect(target.y).toBeCloseTo(-(column.pivot[2] - h), 9);
    expect(target.x).toBeCloseTo(column.ys[0], 9);
    cockpit.dispose();
  });

  it("seat kind 'shell': the back runs up into a head section, no headrest posts and no seat rails", () => {
    const seatsOf = (kind: 'front' | 'shell'): THREE.BufferGeometry[] => {
      const def: AirframeVisualDef = {
        ...SYNTHETIC_CANOPY,
        cockpit: { ...SYNTHETIC_CANOPY.cockpit, seats: SYNTHETIC_CANOPY.cockpit.seats.map((st) => ({ ...st, kind })) },
      };
      const cockpit = build(def);
      expect(nonFinite(cockpit.group)).toBe(0);
      const out: THREE.BufferGeometry[] = [];
      cockpit.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && /seatFabric/.test(o.name)) out.push((o as THREE.Mesh).geometry);
      });
      cockpit.dispose();
      return out;
    };
    const top = (gs: THREE.BufferGeometry[]): number => Math.max(...gs.map((g) => (g.computeBoundingBox(), g.boundingBox!.max.y)));
    const count = (gs: THREE.BufferGeometry[]): number => gs.reduce((n, g) => n + g.getAttribute('position').count, 0);
    const front = seatsOf('front'), shell = seatsOf('shell');
    // The shell's back reaches about as high as the front seat's separate headrest, from fewer parts.
    expect(Math.abs(top(shell) - top(front))).toBeLessThan(0.08);
    expect(count(shell)).toBeLessThan(count(front));
  });

  it('seat back: a low back without its headrest ends below the default back; absent, as before', () => {
    const seatsOf = (back?: { height?: number; headrest?: boolean }): THREE.BufferGeometry[] => {
      const def: AirframeVisualDef = {
        ...SYNTHETIC_CANOPY,
        cockpit: { ...SYNTHETIC_CANOPY.cockpit, seats: SYNTHETIC_CANOPY.cockpit.seats.map((st) => ({ ...st, kind: 'front' as const, reclineDeg: 0, ...(back ? { back } : {}) })) },
      };
      const cockpit = build(def);
      expect(nonFinite(cockpit.group)).toBe(0);
      const out: THREE.BufferGeometry[] = [];
      cockpit.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && /seatFabric/.test(o.name)) out.push((o as THREE.Mesh).geometry);
      });
      cockpit.dispose();
      return out;
    };
    const top = (gs: THREE.BufferGeometry[]): number => Math.max(...gs.map((g) => (g.computeBoundingBox(), g.boundingBox!.max.y)));
    const count = (gs: THREE.BufferGeometry[]): number => gs.reduce((n, g) => n + g.getAttribute('position').count, 0);
    const standard = seatsOf(), same = seatsOf({}), low = seatsOf({ height: 0.42, headrest: false });
    expect(count(same)).toBe(count(standard));
    expect(top(same)).toBe(top(standard));
    // Upright: the standard seat's headrest tops out 0.785 m above the pivot, the low back at 0.42 m (-z is up).
    expect(top(standard) - top(low)).toBeCloseTo(0.785 - 0.42, 2);
    expect(count(low)).toBeLessThan(count(standard));
  });

  it('quadrant fuel selector handle and parking brake handle follow the controls (absent: not built)', () => {
    expect(holders(build(SYNTHETIC_CANOPY), 'fuelSelector:chrome').length).toBe(0);
    const def: AirframeVisualDef = {
      ...SYNTHETIC_CANOPY,
      cockpit: { ...SYNTHETIC_CANOPY.cockpit, fuelSelectorHandle: { pos: [0.5, 0, 0.1], angles: { left: -45, right: 45, off: 180 } }, parkingBrakeHandle: { pos: [0.5, 0, 0.2], travel: 0.05 } },
    };
    const cockpit = build(def);
    expect(nonFinite(cockpit.group)).toBe(0);
    const ctx = fakeContext();
    const handle = holders(cockpit, 'fuelSelector:chrome')[0];
    // The pointer's tip (0.04 m above the boss, in three's +y) as the pilot sees it: LEFT up-left, RIGHT up-right, OFF down.
    const tip = (sel: 'left' | 'right' | 'off'): THREE.Vector3 => {
      ctx.controls.fuelSelector = sel;
      cockpit.update(ctx.state, ctx.controls, 1);
      return at(handle, 0, 0.04, 0).sub(handle.position);
    };
    const left = tip('left'), right = tip('right'), off = tip('off');
    expect(left.x).toBeLessThan(-0.02);
    expect(left.y).toBeGreaterThan(0.02);
    expect(right.x).toBeGreaterThan(0.02);
    expect(off.y).toBeCloseTo(-0.04, 9);
    const brake = holders(cockpit, 'parkingBrake:knobBlack')[0];
    ctx.controls.parkingBrake = false;
    cockpit.update(ctx.state, ctx.controls, 1);
    const inZ = brake.position.z;
    ctx.controls.parkingBrake = true;
    cockpit.update(ctx.state, ctx.controls, 1);
    expect(brake.position.z - inZ).toBeCloseTo(0.05, 9);
    const none = new Set(cockpit.shadowRig().none);
    for (const g of [handle, brake]) for (const m of g.children) expect(none.has(m as THREE.Mesh)).toBe(true);
    cockpit.dispose();
  });

  it('twin cockpit: six quadrant levers follow their own engines, floor flap lever, gear selector', () => {
    const def = SYNTHETIC_TWIN;
    const cockpit = build(def);
    expect(nonFinite(cockpit.group)).toBe(0);
    const ctx = fakeContext(2);
    ctx.controls.engines = [{}, {}];
    const levers = { throttle: holders(cockpit, 'lever:knobBlack'), propeller: holders(cockpit, 'lever:knobBlue'), mixture: holders(cockpit, 'lever:knobRed') };
    expect([levers.throttle.length, levers.propeller.length, levers.mixture.length]).toEqual([2, 2, 2]);
    expect(cockpit.ownMaterials.some((m) => m.name === 'knobBlue')).toBe(true);
    // The left engine's levers are to the left of the right engine's.
    for (const pair of Object.values(levers)) expect(pair[0].position.x).toBeLessThan(pair[1].position.x);
    // One throttle closed: only that engine's lever comes back (60 degrees of travel, forward = full).
    Object.assign(ctx.controls, { throttle: 1, propeller: 1, mixture: 1 });
    setEngineControl(ctx.controls, 1, 'throttle', 0);
    setEngineControl(ctx.controls, 0, 'propeller', 0);
    cockpit.update(ctx.state, ctx.controls, 1);
    expect(levers.throttle.map((l) => l.rotation.x / DEG)).toEqual([expect.closeTo(-30, 9), expect.closeTo(30, 9)]);
    expect(levers.propeller.map((l) => l.rotation.x / DEG)).toEqual([expect.closeTo(30, 9), expect.closeTo(-30, 9)]);
    expect(levers.mixture.map((l) => l.rotation.x / DEG)).toEqual([expect.closeTo(-30, 9), expect.closeTo(-30, 9)]);

    // Gear selector up / down; the floor flap lever comes up by its travel at full flap.
    const gearLever = holders(cockpit, 'gearLever:knobWhite')[0];
    ctx.controls.gearLever = 'up';
    cockpit.update(ctx.state, ctx.controls, 1);
    const up = at(gearLever, 0, 0, 0.05).y;
    ctx.controls.gearLever = 'down';
    cockpit.update(ctx.state, ctx.controls, 1);
    expect(up).toBeGreaterThan(at(gearLever, 0, 0, 0.05).y);
    const flap = holders(cockpit, 'flapLever:black')[0];
    ctx.controls.flaps = 1;
    cockpit.update(ctx.state, ctx.controls, 1);
    expect(flap.rotation.x).toBeCloseTo(def.cockpit.flapControl.travel, 9);
    // Its grip (0.3 m ahead of the pivot) is then higher by 0.3 sin(35 deg) = 0.17 m than lying flat.
    const raised = at(flap, 0, 0, -0.3).y;
    ctx.controls.flaps = 0;
    cockpit.update(ctx.state, ctx.controls, 1);
    expect(raised - at(flap, 0, 0, -0.3).y).toBeCloseTo(0.3 * Math.sin(35 * DEG), 6);
    // Levers, selector and flap lever are too small to cast: all in the rig's `none` list.
    const none = new Set(cockpit.shadowRig().none);
    for (const g of [...levers.throttle, gearLever, flap]) for (const m of g.children) expect(none.has(m as THREE.Mesh)).toBe(true);
    cockpit.dispose();
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('whole synthetic aircraft', () => {
  /** Build an airframe as the simulator does (synchronous bake) and draw one frame from a chase position. */
  const fly = (airframe: AirframeVisualDef | undefined, engines: number, onGround = false): { visual: AircraftVisual; ctx: ReturnType<typeof fakeContext> } => {
    const ctx = fakeContext(engines);
    if (!onGround) {
      // Cruise: 2350 rpm, wheels off the ground.
      for (const p of ctx.state.propellers) p.rpm = 2350;
      for (const w of ctx.state.wheels) Object.assign(w, { compression: 0, onGround: false });
    }
    const visual = new AircraftVisual({ asyncBake: false, airframe });
    visual.init(ctx);
    // The chase position, 13 m from the aircraft (the mock's aircraft root is at the scene origin).
    ctx.camera.position.set(3, 3, 12);
    ctx.camera.updateMatrixWorld(true);
    ctx.aircraftRoot.updateMatrixWorld(true);
    visual.update(1 / 60, ctx);
    return { visual, ctx };
  };
  const hingeAngle = (o: THREE.Object3D, rest: THREE.Quaternion): number => 2 * Math.acos(Math.min(1, Math.abs(rest.clone().invert().multiply(o.quaternion).w)));

  it('the twin: no NaN, outward skins, handbook span and length, tabs, cowl flaps, lamps on the nose leg', () => {
    const { visual, ctx } = fly(SYNTHETIC_TWIN, 2);
    const s = ctx.state;
    expect(visual.root.name).toBe('syn-twin');
    expect(nonFinite(visual.root)).toBe(0);
    expect(expectOutward(visual.root, /\|(wingPaint|finPaint)$/)).toBeGreaterThanOrEqual(12);
    // PA-34 handbook figures carried by its geometry file: span 11.85 m, length 8.72 m (nose to rudder trailing edge).
    const box = bodyBox(visual.root);
    expect(box.y1 - box.y0).toBeCloseTo(PA34_GEOMETRY.wing.span, 2);
    expect(box.x1 - box.x0).toBeGreaterThan(PA34_GEOMETRY.fuselage.length - 0.03);
    expect(box.x1 - box.x0).toBeLessThan(PA34_GEOMETRY.fuselage.length + 0.03);

    // Anti-servo tabs: tab angle = gearing x elevator + trim (contract 3.5) = 1.5 x 0.1 + 0.02 = 0.17 rad.
    const tabs = meshesNamed(visual.root, 'trimTab:wingPaint').map((m) => m.parent!);
    expect(tabs.length).toBe(2);
    Object.assign(s.surfaces, { elevator: 0, elevatorTrim: 0, rudderTrim: 0 });
    visual.update(1 / 60, ctx);
    const rest = tabs.map((t) => t.quaternion.clone());
    const rudderTab = meshesNamed(visual.root, 'rudderTab:finPaint')[0].parent!;
    const rudderTabRest = rudderTab.quaternion.clone();
    Object.assign(s.surfaces, { elevator: 0.1, elevatorTrim: 0.02, rudderTrim: 0.05 });
    visual.update(1 / 60, ctx);
    tabs.forEach((t, i) => expect(hingeAngle(t, rest[i])).toBeCloseTo(0.17, 6));
    expect(hingeAngle(rudderTab, rudderTabRest)).toBeCloseTo(0.05, 6);

    // Cowl flaps follow their own engine.
    const cowl: THREE.Object3D[] = [];
    visual.root.traverse((o) => {
      if (o.name === 'cowlFlap' && !(o as THREE.Mesh).isMesh) cowl.push(o);
    });
    expect(cowl.length).toBe(2);
    s.engines[0].cowlFlap = 0;
    s.engines[1].cowlFlap = 0;
    visual.update(1 / 60, ctx);
    const shut = cowl.map((c) => c.quaternion.clone());
    s.engines[1].cowlFlap = 1;
    visual.update(1 / 60, ctx);
    expect(hingeAngle(cowl[0], shut[0])).toBeCloseTo(0, 6);
    expect(hingeAngle(cowl[1], shut[1])).toBeCloseTo(0.45, 6);

    // The landing light rides on the nose leg: lit with the leg down, dark below extension 0.9 (contract 3.5),
    // and it swings with the leg (rigidly about the retract pivot).
    s.electrical.busVoltage = 28;
    ctx.controls.lights.landing = true;
    const lamp = SYNTHETIC_TWIN.lamps.find((l) => l.id === 'landing')!;
    const lampAt = model(lamp.pos);
    // On the beam's axis, 50 m ahead (aimed 3 degrees down).
    ctx.camera.position.set(lampAt.x, lampAt.y - 50 * Math.sin(3 * DEG), lampAt.z - 50);
    ctx.camera.updateMatrixWorld(true);
    const glow = visual.root.getObjectByName('aircraftLightGlow') as THREE.Points;
    const level = (): number => (glow.geometry.getAttribute('glow') as THREE.BufferAttribute).getX(6);
    const spots = (): number[] => {
      const out: number[] = [];
      visual.root.traverse((o) => {
        if ((o as THREE.SpotLight).isSpotLight) out.push((o as THREE.SpotLight).intensity);
      });
      return out;
    };
    const sprite = (): THREE.Vector3 => new THREE.Vector3().fromBufferAttribute(glow.geometry.getAttribute('position') as THREE.BufferAttribute, 6);
    s.gear.extension = [1, 1, 1];
    visual.update(1 / 60, ctx);
    expect(level()).toBeGreaterThan(0);
    expect(Math.max(...spots())).toBeGreaterThan(0);
    const down = sprite();
    s.gear.extension = [0.95, 0.95, 0.95];
    visual.update(1 / 60, ctx);
    expect(level()).toBeGreaterThan(0);
    s.gear.extension = [0.89, 0.89, 0.89];
    visual.update(1 / 60, ctx);
    expect(level()).toBe(0);
    expect(spots()).toEqual([0, 0]);
    s.gear.extension = [0.5, 0.5, 0.5];
    visual.update(1 / 60, ctx);
    const pivot = model(SYNTHETIC_TWIN.gear[0].retract!.pivot);
    const offset = model(lamp.glowOffset);
    const half = sprite();
    // The glow offset is fixed in the aircraft's axes; the lens itself keeps its distance from the pivot.
    expect(half.clone().sub(offset).distanceTo(pivot)).toBeCloseTo(down.clone().sub(offset).distanceTo(pivot), 5);
    expect(half.distanceTo(down)).toBeGreaterThan(0.2);

    // Ground contact shadow: no crease under a leg that is not down; the rest height is the type's (1.1 m).
    const shadow = ctx.scene.getObjectByName('aircraftContactShadow') as THREE.Mesh;
    const uniforms = (shadow.material as THREE.ShaderMaterial).uniforms;
    for (const w of s.wheels) w.onGround = true;
    visual.update(1 / 60, ctx);
    expect((uniforms.uWheels.value as THREE.Vector3[]).map((v) => v.z)).toEqual([0, 0, 0]);
    s.gear.extension = [1, 1, 1];
    visual.update(1 / 60, ctx);
    expect((uniforms.uWheels.value as THREE.Vector3[]).map((v) => v.z)).toEqual([1, 1, 1]);
    expect(uniforms.uHeight.value).toBeCloseTo(s.altitudeMSL - AIRPORT.elevation - PA34_GEOMETRY.restHeight!, 9);
    visual.dispose();
  }, 120_000);

  it('a state with one propeller leaves the second one stopped; with two each turns by its own state', () => {
    const { visual, ctx } = fly(SYNTHETIC_TWIN, 1);
    const groups = visual.root.children.filter((c) => c.name === 'propeller');
    expect(groups.length).toBe(2);
    const blades = groups.map((g) => meshesNamed(g, /^blade/)[0] as THREE.InstancedMesh);
    // The first is a disc at 2350 rpm (its blades are not drawn); the second stands still with three sharp blades.
    expect(blades[0].parent!.visible).toBe(false);
    expect(blades[1].parent!.visible).toBe(true);
    expect(blades[1].count).toBe(3);
    expect(Math.abs(groups[1].rotation.z)).toBe(0);
    // The two propellers do not share blade materials (their opacity follows their own rpm).
    expect(blades[0].material).not.toBe(blades[1].material);
    visual.dispose();

    const twin = fly(SYNTHETIC_TWIN, 2);
    const s = twin.ctx.state;
    // Counter-rotating: the right propeller's angle counts down in the state; the model shows each as given.
    Object.assign(s.propellers[0], { rotation: 0.6, rpm: 0, bladePitch: 20 * DEG });
    Object.assign(s.propellers[1], { rotation: -0.6, rpm: 0, bladePitch: 84 * DEG, feathered: true });
    twin.visual.update(1 / 60, twin.ctx);
    const g = twin.visual.root.children.filter((c) => c.name === 'propeller');
    expect(g[0].rotation.z).toBe(-0.6);
    expect(g[1].rotation.z).toBe(0.6);
    // And they stand on the hubs of the PA-34 geometry.
    const hub = PA34_GEOMETRY.propellers![1].hub;
    expect(g[1].position.distanceTo(model([hub.x, hub.y, hub.z]))).toBeLessThan(1e-6);
    expect(g[0].position.x).toBeCloseTo(-hub.y, 6);
    twin.visual.dispose();
  }, 120_000);

  it('the canopy single: outward skins, handbook span and length, occupants and controls seen from outside', () => {
    const { visual, ctx } = fly(SYNTHETIC_CANOPY, 1, true);
    expect(nonFinite(visual.root)).toBe(0);
    expect(expectOutward(visual.root, /\|(wingPaint|finPaint)$/)).toBeGreaterThanOrEqual(8);
    // DA20 handbook figures carried by its geometry file: span 10.87 m, length 7.24 m.
    const box = bodyBox(visual.root);
    expect(Math.abs(box.y1 - box.y0 - DA20_GEOMETRY.wing.span)).toBeLessThan(0.02);
    expect(Math.abs(box.x1 - box.x0 - DA20_GEOMETRY.fuselage.length)).toBeLessThan(0.03);
    // Standing on its wheels: the lowest point is a tyre's contact height less the mock's compression (nose 6 cm,
    // mains 8 cm): here the nose tyre's, 1.13 - 0.06 = 1.07 m against the mains' 1.14 - 0.08 = 1.06 m.
    const G = DA20_GEOMETRY.gear;
    expect(box.z1).toBeCloseTo(Math.max(G.nose.z - 0.06, G.leftMain.z - 0.08, G.rightMain.z - 0.08), 3);

    const cockpit = visual.root.getObjectByName('cockpit')!;
    const occupants = visual.root.getObjectByName('occupants')!;
    const stick = meshesNamed(cockpit, 'stick:black')[0].parent!;
    const lever = meshesNamed(cockpit, 'lever:knobBlack')[0].parent!;
    // Seen from outside (chase): the interior, its small controls and the two figures are drawn, and the sticks cast.
    expect([cockpit.visible, occupants.visible, stick.visible, lever.visible]).toEqual([true, true, true, true]);
    const proxy = stick.children.find((c) => c.name.startsWith('shadowProxy:')) as THREE.Mesh;
    expect(proxy.castShadow).toBe(true);
    // About 300 flat-shaded triangles a figure.
    let triangles = 0;
    for (const m of occupants.children as THREE.Mesh[]) triangles += m.geometry.index!.count / 3;
    expect(triangles / 2).toBeGreaterThan(250);
    expect(triangles / 2).toBeLessThan(400);
    // Their heads are under the canopy, about at the pilot's eye height (DA20 geometry).
    const heads = bodyBox(occupants);
    expect(heads.z0).toBeLessThan(DA20_GEOMETRY.fuselage.pilotEye.z - 0.03);
    expect(heads.z0).toBeGreaterThan(DA20_GEOMETRY.fuselage.pilotEye.z - 0.2);
    // In the cockpit view the figures are not drawn (the camera sits in the pilot's head).
    (ctx as { cameraMode: string }).cameraMode = 'cockpit';
    visual.update(1 / 60, ctx);
    expect([cockpit.visible, occupants.visible]).toEqual([true, false]);
    visual.dispose();
  }, 120_000);

  it('interior level of detail: by distance under a cabin roof, by projected size under a canopy', () => {
    // The rule (contract 3.5): visible while distance x tan(fov / 2) / tan(30 deg) < the LOD distance of 60 m.
    expect(interiorInView(59, 60, 60)).toBe(true);
    expect(interiorInView(61, 60, 60)).toBe(false);
    // A tower camera zoomed to 4 degrees sees the aircraft at 800 m as large as a 60 degree camera at 48 m.
    expect((800 * Math.tan(2 * DEG)) / Math.tan(30 * DEG)).toBeCloseTo(48.39, 2);
    expect(interiorInView(800, 4, 60)).toBe(true);
    expect(interiorInView(1000, 4, 60)).toBe(false);
    // A wide camera close by: 50 m at 90 degrees is as small as 86.6 m at 60.
    expect(interiorInView(50, 90, 60)).toBe(false);

    for (const [airframe, engines, expected] of [
      [SYNTHETIC_CANOPY, 1, true],
      [SYNTHETIC_TWIN, 2, false],
      [undefined, 1, false],
    ] as const) {
      const { visual, ctx } = fly(airframe, engines);
      const cockpit = visual.root.getObjectByName('cockpit')!;
      // In the chase position, 13 m away at 60 degrees: drawn.
      expect(cockpit.visible).toBe(true);
      // 500 m away, zoomed to 4 degrees: the canopy's interior fills the picture and stays; a cabin's is culled by
      // distance alone, as it always was.
      ctx.camera.fov = 4;
      ctx.camera.position.set(0, 0, 500);
      ctx.camera.updateMatrixWorld(true);
      visual.update(1 / 60, ctx);
      expect(cockpit.visible, airframe?.id ?? 'c172s').toBe(expected);
      visual.dispose();
    }
  }, 120_000);

  it('a twin costs at most +30 draw calls and +60 000 triangles over the Cessna 172S in the chase view', () => {
    // In cruise (propellers are discs, gear DOWN as the worst case) and parked at idle (smeared blades).
    for (const onGround of [false, true]) {
      const cessna = fly(undefined, 1, onGround);
      const twin = fly(SYNTHETIC_TWIN, 2, onGround);
      const a = renderCost(cessna.visual.root);
      const b = renderCost(twin.visual.root);
      console.log(`[variants] ${onGround ? 'parked at 800 rpm' : 'cruise'}: c172s ${a.draws} draws ${a.triangles} triangles ${a.casters} proxies; syn-twin ${b.draws} draws ${b.triangles} triangles ${b.casters} proxies`);
      expect(b.draws - a.draws).toBeLessThanOrEqual(30);
      expect(b.triangles - a.triangles).toBeLessThanOrEqual(60_000);
      // Shadow pass: one merged proxy per rigid part; the twin's retract hinges and second propeller add a few.
      expect(b.casters - a.casters).toBeLessThanOrEqual(12);
      cessna.visual.dispose();
      twin.visual.dispose();
    }
  }, 180_000);

  it('the synthetic airframes are plain data with their own ids', () => {
    for (const def of Object.values(SYNTHETIC_AIRFRAMES)) {
      expect(structuredClone(def)).toEqual(def);
      expect(JSON.parse(JSON.stringify(def))).toEqual(def);
    }
    expect(Object.keys(SYNTHETIC_AIRFRAMES)).toEqual(['syn-twin', 'syn-canopy']);
    // The Cessna 172S definition names every fitting the builders used to hard-wire.
    expect(Object.keys(C172S_VISUAL.cockpit.fittings!).sort()).toEqual(['airOutlet', 'defrosters', 'doorHandle', 'fuelSelector', 'overhead', 'toeBoard', 'vents', 'visors', 'windowLatch']);
  });
});
