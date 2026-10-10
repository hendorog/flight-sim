// Small FRD construction helpers; fixed parts are batched by material by their caller.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { FRD } from '../airframe/types';
import { capGeometry, frd, gridGeometry, MeshBatch } from '../geometry';

/** Rounded teardrop cowl, with its broad nose ahead of the mast and a narrow trailing edge. */
export function mastFairing(bottom: FRD, top: FRD, chords: readonly [number, number]): THREE.BufferGeometry {
  const rows = 17, cols = 49;
  const g = gridGeometry({ rows, cols, wrap: true,
    position(i, j, out) {
      const t = i / (rows - 1), a = j / (cols - 1) * Math.PI * 2;
      const c = THREE.MathUtils.lerp(...chords, t) * (1 + 0.06 * Math.sin(Math.PI * t));
      frd(THREE.MathUtils.lerp(bottom[0], top[0], t) + c * Math.cos(a) / 2,
        THREE.MathUtils.lerp(bottom[1], top[1], t) + c * 0.29 * Math.sin(a) * (1 + 0.3 * Math.cos(a)),
        THREE.MathUtils.lerp(bottom[2], top[2], t), out);
    },
  });
  const batch = new MeshBatch(), dummy = new THREE.MeshBasicMaterial();
  const p = g.getAttribute('position');
  for (const row of [0, rows - 1]) {
    const loop = Array.from({ length: cols - 1 }, (_, j) => new THREE.Vector3().fromBufferAttribute(p, row * cols + j));
    batch.add(dummy, capGeometry(loop, new THREE.Vector3(0, row === 0 ? -1 : 1, 0)));
  }
  batch.add(dummy, g);
  const mesh = batch.build('mastFairing').children[0] as THREE.Mesh;
  dummy.dispose(); return mesh.geometry;
}

export function box(p: FRD, size: FRD, radius = 0.008): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(size[1], size[2], size[0], 2, radius);
  return g.translate(...frd(...p).toArray());
}

export function tube(a: FRD, b: FRD, radius: number, endRadius = radius, segments = 12): THREE.BufferGeometry {
  const p = frd(...a), q = frd(...b), d = q.clone().sub(p);
  const g = new THREE.CylinderGeometry(endRadius, radius, d.length(), segments);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return g.translate(...p.add(q).multiplyScalar(0.5).toArray());
}

export function pathTube(points: readonly FRD[], radius: number, segments = 36): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map(p => frd(...p)), false, 'centripetal');
  return new THREE.TubeGeometry(curve, segments, radius, 8, false);
}

/** A shallow lenticular section along a polygon: no paper-thin fins or visible open edges. */
export function fin(outline: readonly FRD[], thickness: number, axis: 'y' | 'z'): THREE.BufferGeometry {
  const centre = new THREE.Vector3();
  const pts = outline.map(p => frd(...p));
  pts.forEach(p => centre.addScaledVector(p, 1 / pts.length));
  const normal = axis === 'y' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const batch = new MeshBatch();
  const dummy = new THREE.MeshBasicMaterial();
  for (const side of [-1, 1]) {
    const c = centre.clone().addScaledVector(normal, side * thickness / 2);
    for (let i = 0; i < pts.length; i++) batch.add(dummy, capGeometry([pts[i], pts[(i + 1) % pts.length], c], normal.clone().multiplyScalar(side)));
  }
  const mesh = batch.build('fin').children[0] as THREE.Mesh;
  dummy.dispose();
  return mesh.geometry;
}

/** Tapered round tail cone with longitudinal UVs (registration is applied separately). */
export function boom(a: FRD, b: FRD, radii: readonly [number, number]): THREE.BufferGeometry {
  return gridGeometry({ rows: 24, cols: 33, wrap: true, flip: true,
    position(i, j, out) {
      const t = i / 23, angle = j / 32 * Math.PI * 2;
      const r = THREE.MathUtils.lerp(radii[0], radii[1], t);
      frd(THREE.MathUtils.lerp(a[0], b[0], t), r * Math.sin(angle), THREE.MathUtils.lerp(a[2], b[2], t) + r * Math.cos(angle), out);
    },
    uv(i, j, out) { out.set(i / 23, j / 32); },
  });
}
