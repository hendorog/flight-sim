// Facing of the lofted lifting surfaces (wings, flaps, ailerons, stabiliser, elevators, fin, rudder).
//
// A mesh faces outward when a ray leaving any triangle along its normal does not pass back through the
// same body: from an upper skin it goes up into free air, whereas from an inside-out skin it crosses the
// opposite skin within a section thickness. The rays are limited to 0.25 m so separate nearby parts
// (a strut under the wing, a flap under the cove) are not mistaken for the far skin.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildWings } from '../../src/render/aircraft/wings';
import { buildTail } from '../../src/render/aircraft/tail';
import { LandingGear } from '../../src/render/aircraft/gear';
import { planformInward, finPlanform, stabPlanform, wingPlanform } from '../../src/render/aircraft/liftingSurface';
import type { AircraftMaterials } from '../../src/render/aircraft/materials';

function fakeMaterials(): AircraftMaterials {
  const cache = new Map<string | symbol, THREE.Material>();
  return new Proxy({} as AircraftMaterials, {
    get(_t, key) {
      if (!cache.has(key)) {
        const m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
        m.name = String(key);
        cache.set(key, m);
      }
      return cache.get(key);
    },
  });
}

/** Every mesh under `root`, baked into world space (control surfaces hang off hinge objects). */
function worldMeshes(root: THREE.Object3D): THREE.Mesh[] {
  root.updateMatrixWorld(true);
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.name = `${o.parent?.name ?? ''}/${m.name}|${(m.material as THREE.Material).name}`;
    out.push(mesh);
  });
  return out;
}

interface Facing {
  outward: number;
  total: number;
  normalAgree: number;
}

function facing(mesh: THREE.Mesh, samples = 300): Facing {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const idx = g.index!;
  const tris = idx.count / 3;
  const step = Math.max(1, Math.floor(tris / samples));
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const vn = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  ray.far = 0.25;
  const hits: THREE.Intersection[] = [];
  let outward = 0;
  let total = 0;
  let normalAgree = 0;
  for (let t = 0; t < tris; t += step) {
    const i0 = idx.getX(3 * t);
    const i1 = idx.getX(3 * t + 1);
    const i2 = idx.getX(3 * t + 2);
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    n.subVectors(b, a).cross(c.clone().sub(a));
    const area = n.length();
    if (area < 1e-9) continue;
    n.divideScalar(area);
    vn.fromBufferAttribute(nrm, i0).add(new THREE.Vector3().fromBufferAttribute(nrm, i1)).add(new THREE.Vector3().fromBufferAttribute(nrm, i2));
    if (vn.dot(n) > 0) normalAgree++;
    const o = a.add(b).add(c).divideScalar(3).addScaledVector(n, 1e-4);
    ray.set(o, n);
    hits.length = 0;
    mesh.raycast(ray, hits);
    if (hits.filter((h) => h.distance > 2e-4).length === 0) outward++;
    total++;
  }
  return { outward, total, normalAgree };
}

describe('lofted and swept surfaces face outward', () => {
  it('derives the raw grid handedness from the planform axes', () => {
    // Wing and stabiliser: span +y, aft -x, up -z: span x aft = +z, opposite to up -> raw grid inward.
    expect(planformInward(wingPlanform, 0.5, 5)).toBe(true);
    expect(planformInward(stabPlanform, 0, 1.5)).toBe(true);
    // Fin: span -z (upward), aft -x, up +y: span x aft = +y -> raw grid outward.
    expect(planformInward(finPlanform, 0, 1.2)).toBe(false);
    // Reversing the station order reverses it.
    expect(planformInward(wingPlanform, 5, 0.5)).toBe(false);
  });

  for (const [name, build] of [
    ['wings', buildWings],
    ['tail', buildTail],
    ['gear', (m: AircraftMaterials, root: THREE.Object3D) => root.add(new LandingGear(m, true).group)],
  ] as const) {
    it(`${name}: every mesh faces outward with normals matching the winding`, () => {
      const root = new THREE.Group();
      build(fakeMaterials(), root);
      const meshes = worldMeshes(root);
      expect(meshes.length).toBeGreaterThan(2);
      let tested = 0;
      for (const m of meshes) {
        // Gear: only the lofted legs and fairings (plainPaint). The hubs, axles and oleo fittings are stacks
        // of overlapping closed primitives whose faces legitimately face one another.
        if (name === 'gear' && !/\|plainPaint$/.test(m.name)) continue;
        tested++;
        const f = facing(m);
        const frac = f.outward / f.total;
        const agree = f.normalAgree / f.total;
        expect(frac, `${m.name} outward fraction`).toBeGreaterThan(0.9);
        expect(agree, `${m.name} normal/winding agreement`).toBeGreaterThan(0.97);
      }
      expect(tested).toBeGreaterThan(2);
    });
  }
});

describe('cabin interior stays inside the fuselage skin', () => {
  it('the glareshield hood is inside the skin cross-section everywhere', async () => {
    const { glareshieldGeometry, GLARESHIELD_SKIN_CLEARANCE } = await import('../../src/render/aircraft/cockpit');
    const { FuselageShape } = await import('../../src/render/aircraft/fuselageShape');
    const { sectionHalfWidth } = await import('../../src/render/aircraft/fuselage');
    const skin = new FuselageShape(0);
    const g = glareshieldGeometry(skin);
    const pos = g.getAttribute('position');
    let worst = -Infinity;
    let widest = 0;
    for (let i = 0; i < pos.count; i++) {
      // Model (X, Y, Z) = FRD (y, -z, -x).
      const x = -pos.getZ(i);
      const z = -pos.getY(i);
      const y = Math.abs(pos.getX(i));
      widest = Math.max(widest, y);
      const hw = sectionHalfWidth(skin, x, z);
      worst = Math.max(worst, y - hw);
    }
    // Every vertex at least ~the clearance inside the skin (1 mm for the loft's linear interpolation).
    expect(worst).toBeLessThan(-GLARESHIELD_SKIN_CLEARANCE + 0.001);
    // It still spans the cabin at the panel.
    expect(widest).toBeGreaterThan(0.45);
    // And it is not inside out (the profile-to-model mapping is a mirror).
    g.setIndex(Array.from({ length: pos.count }, (_, i) => i));
    const f = facing(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), 600);
    expect(f.outward / f.total).toBeGreaterThan(0.9);
    expect(f.normalAgree / f.total).toBeGreaterThan(0.97);
  });
});

describe('cabin trim panels', () => {
  it('sit inboard of the lining and face into the cabin', async () => {
    const { liningPanel } = await import('../../src/render/aircraft/cabinTrim');
    const { FuselageShape } = await import('../../src/render/aircraft/fuselageShape');
    const { sectionHalfWidth } = await import('../../src/render/aircraft/fuselage');
    const lining = new FuselageShape(0.015, -0.63);
    for (const side of [-1, 1] as const) {
      // A door-sized panel with a 6 cm bolster across its middle.
      const g = liningPanel(lining, side, 0.7, -0.45, -0.08, 0.4, 40, 30, (_x, z) => 0.06 * Math.max(0, 1 - Math.abs(z - 0.04) / 0.05));
      const p = g.getAttribute('position');
      const n = g.getAttribute('normal');
      let inboard = 0;
      let worst = -Infinity;
      for (let i = 0; i < p.count; i++) {
        // Model (X, Y, Z) = FRD (y, -z, -x).
        const x = -p.getZ(i);
        const z = -p.getY(i);
        worst = Math.max(worst, Math.abs(p.getX(i)) - sectionHalfWidth(lining, x, z));
        if (Math.sign(n.getX(i)) === -side) inboard++;
      }
      // Never behind the lining (at least the 2 mm clearance in front of it), and facing the cabin.
      expect(worst).toBeLessThan(-0.0015);
      expect(inboard / p.count).toBeGreaterThan(0.95);
    }
  });
});
