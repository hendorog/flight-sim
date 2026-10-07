// Helpers of the airframe variant tests (variants.test.ts): stand-ins for what the model needs of a page, and
// measurements on what the builders return (facing, finiteness, bounding boxes, what a frame costs to draw).

import * as THREE from 'three';
import type { SimContext } from '../../src/core/context';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls } from '../../src/core/types';
import { AIRPORT } from '../../src/core/world';
import type { AircraftMaterials } from '../../src/render/aircraft/materials';

/** One distinct named double-sided material per member (the facing test casts rays from both sides). */
export function fakeMaterials(): AircraftMaterials {
  const cache = new Map<string | symbol, THREE.Material>();
  return new Proxy({} as AircraftMaterials, {
    get(_t, key) {
      if (!cache.has(key)) {
        const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
        m.name = String(key);
        cache.set(key, m);
      }
      return cache.get(key);
    },
  });
}

/** A 2D context that accepts every call and draws nothing; text is 10 px wide per character, pixels are blank. */
function blankContext(canvas: { width: number; height: number }): unknown {
  const own: Record<string | symbol, unknown> = {
    canvas,
    measureText: (text: string) => ({ width: 10 * text.length }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  };
  return new Proxy(own, {
    get: (t, key) => (key in t ? t[key] : (t[key] = () => new Proxy({}, { get: () => () => undefined }))),
    set: (t, key, value) => ((t[key] = value), true),
  });
}

/** The `document` the canvas-drawn textures need in node: every canvas is blank. */
export function blankDocument(): unknown {
  return {
    createElement: (): unknown => {
      const canvas = { width: 300, height: 150, getContext: (): unknown => context };
      const context = blankContext(canvas);
      return canvas;
    },
  };
}

/**
 * A simulator context as far as AircraftVisual reads it: parked on the runway.
 * @param engines engines and propellers in the state (a twin's visual)
 */
export function fakeContext(engines = 1): SimContext {
  const state = makeMockState({ heightAGL: 0, engines });
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  const aircraftRoot = new THREE.Group();
  const scene = new THREE.Scene();
  scene.add(aircraftRoot, camera);
  const ctx = {
    renderer: { getDrawingBufferSize: (v: THREE.Vector2) => v.set(1600, 900) },
    scene,
    camera,
    aircraftRoot,
    state,
    controls: defaultControls(),
    env: { groundElevation: () => AIRPORT.elevation, groundNormal: () => ({ x: 0, y: 0, z: -1 }) },
    sky: {
      sunDir: new THREE.Vector3(0.3, 0.8, 0.52).normalize(),
      moonDir: new THREE.Vector3(0, -1, 0),
      sunColor: new THREE.Color(9000, 8600, 8000),
      moonColor: new THREE.Color(0, 0, 0),
      skyColor: new THREE.Color(900, 1200, 1800),
      dayFactor: 1,
    },
    simTime: 0.02,
    cameraMode: 'chase',
    quality: 'high',
  };
  return ctx as unknown as SimContext;
}

/** Every mesh under `root`, baked into the root's space (control surfaces hang off hinge objects). */
export function worldMeshes(root: THREE.Object3D): THREE.Mesh[] {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, m.matrixWorld));
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.name = `${o.parent?.name ?? ''}/${m.name}|${(m.material as THREE.Material).name}`;
    out.push(mesh);
  });
  return out;
}

export interface Facing {
  outward: number;
  total: number;
  normalAgree: number;
}

/**
 * Facing of a closed body's mesh (tests/aircraft/surfaces.test.ts): a ray leaving a triangle along its normal
 * must not pass back through the same mesh within `far` metres; `normalAgree` counts the triangles whose vertex
 * normals agree with their winding.
 */
export function facing(mesh: THREE.Mesh, samples = 300, far = 0.25): Facing {
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
  ray.far = far;
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

/** Number of non-finite values in the position, normal and instance buffers and node transforms under `root`. */
export function nonFinite(root: THREE.Object3D): number {
  let bad = 0;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    for (const e of o.matrixWorld.elements) if (!Number.isFinite(e)) bad++;
    const mesh = o as THREE.InstancedMesh;
    if (!mesh.isMesh) return;
    for (const name of ['position', 'normal']) {
      const a = mesh.geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
      if (!a) continue;
      const arr = a.array as Float32Array;
      for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) bad++;
    }
    if (mesh.isInstancedMesh) {
      const arr = mesh.instanceMatrix.array as Float32Array;
      for (let i = 0; i < mesh.count * 16; i++) if (!Number.isFinite(arr[i])) bad++;
    }
  });
  return bad;
}

/** Bounding box of every mesh under `root`, in the root's space, as body (FRD) extents. */
export function bodyBox(root: THREE.Object3D): { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number } {
  const box = new THREE.Box3();
  for (const m of worldMeshes(root)) {
    m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox!);
  }
  // Model (X, Y, Z) = FRD (y, -z, -x).
  return { x0: -box.max.z, x1: -box.min.z, y0: box.min.x, y1: box.max.x, z0: -box.max.y, z1: -box.min.y };
}

/**
 * What a frame of the main pass costs under `root` as it stands: one draw call per visible mesh or point cloud
 * (an instanced mesh is one), and the triangles they send (an instanced mesh: its triangles times its count).
 * The depth-only shadow proxies are counted apart: they are drawn in the shadow pass.
 */
export function renderCost(root: THREE.Object3D): { draws: number; triangles: number; casters: number } {
  let draws = 0;
  let triangles = 0;
  let casters = 0;
  const visit = (o: THREE.Object3D): void => {
    if (!o.visible) return;
    const mesh = o as THREE.InstancedMesh;
    if (mesh.isMesh || (o as THREE.Points).isPoints) {
      const g = mesh.geometry;
      const n = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      if (mesh.isMesh && mesh.name.startsWith('shadowProxy:')) casters++;
      else {
        draws++;
        if (mesh.isMesh) triangles += n * (mesh.isInstancedMesh ? mesh.count : 1);
      }
    }
    for (const child of o.children) visit(child);
  };
  visit(root);
  return { draws, triangles, casters };
}
