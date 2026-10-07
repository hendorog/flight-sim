// Geometry building blocks for the procedural Cessna: body-axis conversion, monotone interpolation,
// parametric grid surfaces with smooth finite-difference normals, caps, swept tubes and merging.
//
// Authoring happens in the body frame of core/c172.ts (FRD: x forward, y right, z down, metres from the
// reference point) and is converted to three.js model space (nose -Z, right +X, up +Y) as (y, -z, -x).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface FRD {
  x: number;
  y: number;
  z: number;
}

/** FRD body coordinates -> three.js model space. */
export function frd(x: number, y: number, z: number, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  return out.set(y, -z, -x);
}

export function frdV(p: FRD, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  return out.set(p.y, -p.z, -p.x);
}

/**
 * Monotone piecewise-cubic Hermite interpolation (Fritsch-Carlson). Used for fuselage station tables and
 * livery curves: it passes through every key without the overshoot a Catmull-Rom spline shows near
 * abrupt changes (e.g. the cowling face), so lofted surfaces never bulge or ripple between keys.
 */
export class Pchip {
  private readonly m: Float64Array;

  constructor(
    private readonly xs: readonly number[],
    private readonly ys: readonly number[],
  ) {
    const n = xs.length;
    const d = new Float64Array(n - 1);
    for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    const m = new Float64Array(n);
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) m[i] = 0;
      else {
        const h0 = xs[i] - xs[i - 1];
        const h1 = xs[i + 1] - xs[i];
        const w0 = 2 * h1 + h0;
        const w1 = h1 + 2 * h0;
        m[i] = (w0 + w1) / (w0 / d[i - 1] + w1 / d[i]);
      }
    }
    this.m = m;
  }

  eval(x: number): number {
    const { xs, ys, m } = this;
    const n = xs.length;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const h = xs[hi] - xs[lo];
    const t = (x - xs[lo]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * m[lo] + (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * h * m[hi]
    );
  }
}

export interface GridSpec {
  /** Vertex rows (u direction) and columns (v direction). */
  rows: number;
  cols: number;
  /** Model-space position of vertex (i, j). */
  position(i: number, j: number, out: THREE.Vector3): void;
  /** Texture coordinate of vertex (i, j); defaults to (j / (cols-1), i / (rows-1)). */
  uv?(i: number, j: number, out: THREE.Vector2): void;
  /**
   * The first and last column coincide (a closed ring with a texture seam): normals are computed across
   * the seam so it shades smoothly. Without it the edge columns use one-sided differences (a crease).
   * A crease can also be placed inside a ring by repeating a contour point twice.
   */
  wrap?: boolean;
  /** Reverse the facing (normals and winding). */
  flip?: boolean;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _du = new THREE.Vector3();
const _dv = new THREE.Vector3();

function load(pos: Float32Array, cols: number, i: number, j: number, out: THREE.Vector3): THREE.Vector3 {
  const k = (i * cols + j) * 3;
  return out.set(pos[k], pos[k + 1], pos[k + 2]);
}

/**
 * Fill position and normal arrays for a grid spec (used both to build and to re-pose deforming grids).
 * Normals are the cross product of central differences along the two grid directions, so smooth
 * surfaces shade smoothly regardless of how the texture seams run.
 */
export function writeGrid(spec: GridSpec, pos: Float32Array, nrm: Float32Array): void {
  const { rows, cols } = spec;
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      spec.position(i, j, _a);
      const k = (i * cols + j) * 3;
      pos[k] = _a.x;
      pos[k + 1] = _a.y;
      pos[k + 2] = _a.z;
    }
  const sign = spec.flip ? -1 : 1;
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(rows - 1, i + 1);
      let j0 = j - 1;
      let j1 = j + 1;
      if (spec.wrap) {
        if (j0 < 0) j0 = cols - 2;
        if (j1 > cols - 1) j1 = 1;
      } else {
        j0 = Math.max(0, j0);
        j1 = Math.min(cols - 1, j1);
      }
      _du.subVectors(load(pos, cols, i1, j, _b), load(pos, cols, i0, j, _n));
      _dv.subVectors(load(pos, cols, i, j1, _b), load(pos, cols, i, j0, _n));
      // A collapsed neighbour (repeated crease point, pole) gives a zero difference: step one further.
      if (_dv.lengthSq() < 1e-14) _dv.subVectors(load(pos, cols, i, Math.min(cols - 1, j1 + 1), _b), load(pos, cols, i, Math.max(0, j0 - 1), _n));
      if (_du.lengthSq() < 1e-14) _du.subVectors(load(pos, cols, Math.min(rows - 1, i1 + 1), j, _b), load(pos, cols, Math.max(0, i0 - 1), j, _n));
      _n.crossVectors(_du, _dv);
      const l = _n.length();
      if (l > 1e-12) _n.multiplyScalar(sign / l);
      else _n.set(0, 1, 0);
      const k = (i * cols + j) * 3;
      nrm[k] = _n.x;
      nrm[k + 1] = _n.y;
      nrm[k + 2] = _n.z;
    }
}

export function gridGeometry(spec: GridSpec): THREE.BufferGeometry {
  const { rows, cols } = spec;
  const pos = new Float32Array(rows * cols * 3);
  const nrm = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  writeGrid(spec, pos, nrm);
  const t = new THREE.Vector2();
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      if (spec.uv) spec.uv(i, j, t);
      else t.set(j / (cols - 1), i / (rows - 1));
      const k = (i * cols + j) * 2;
      uv[k] = t.x;
      uv[k + 1] = t.y;
    }
  const index: number[] = [];
  for (let i = 0; i < rows - 1; i++)
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = (i + 1) * cols + j;
      const c = i * cols + j + 1;
      const d = (i + 1) * cols + j + 1;
      if (spec.flip) index.push(a, c, b, c, d, b);
      else index.push(a, b, c, c, b, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

/** Re-pose a deforming grid in place (no allocation beyond the first call's buffers). */
export function refreshGrid(g: THREE.BufferGeometry, spec: GridSpec): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  writeGrid(spec, pos.array as Float32Array, nrm.array as Float32Array);
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
  g.computeBoundingSphere();
}

/**
 * Flat triangle-fan cap over a closed loop of points (star-shaped about its centroid, e.g. an airfoil).
 * The normal is chosen to point along `outward`.
 */
export function capGeometry(loop: THREE.Vector3[], outward: THREE.Vector3): THREE.BufferGeometry {
  const c = new THREE.Vector3();
  for (const p of loop) c.add(p);
  c.divideScalar(loop.length);
  const n = outward.clone().normalize();
  const pos: number[] = [c.x, c.y, c.z];
  const nrm: number[] = [n.x, n.y, n.z];
  const uv: number[] = [0.5, 0.5];
  for (const p of loop) {
    pos.push(p.x, p.y, p.z);
    nrm.push(n.x, n.y, n.z);
    uv.push(0.5, 0.5);
  }
  // Orient the fan so its geometric normal agrees with `outward`.
  const e1 = new THREE.Vector3().subVectors(loop[0], c);
  const e2 = new THREE.Vector3().subVectors(loop[Math.floor(loop.length / 3)], c);
  const forward = e1.cross(e2).dot(n) > 0;
  const index: number[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % loop.length);
    if (forward) index.push(0, a, b);
    else index.push(0, b, a);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

/** Unit normal of the plane of a closed outline (FRD points; Newell's method), in model space, pointing away from `inside`. */
export function outlineNormal(pts: readonly (readonly [number, number, number])[], inside: THREE.Vector3): THREE.Vector3 {
  const n = new THREE.Vector3();
  const c = new THREE.Vector3();
  const loop = pts.map((p) => frd(p[0], p[1], p[2]));
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
    c.addScaledVector(a, 1 / loop.length);
  }
  n.normalize();
  return n.dot(c.sub(inside)) < 0 ? n.negate() : n;
}

/**
 * A flat plate over a closed outline (FRD points, star-shaped about its centroid): its outer face `lift` proud
 * of the outline's plane along `outward`, and with `twoFaced` an inner face 4 mm behind it (a door, a flap).
 */
export function plateGeometry(pts: readonly (readonly [number, number, number])[], outward: THREE.Vector3, lift: number, twoFaced: boolean): THREE.BufferGeometry[] {
  const loop = pts.map((p) => frd(p[0], p[1], p[2]).addScaledVector(outward, lift));
  const faces = [capGeometry(loop, outward)];
  if (twoFaced) faces.push(capGeometry(pts.map((p) => frd(p[0], p[1], p[2]).addScaledVector(outward, lift - 0.004)), outward.clone().negate()));
  return faces;
}

/**
 * Grid spec of a tube swept along a model-space path `path(t)`, t in 0..1, with a 2D cross-section.
 * `section(t, a)` returns the offset of ring angle a (0..2PI) at t in the local (side, up) frame, where
 * `up` is the component of `upRef` perpendicular to the path.
 *
 * The returned spec faces outward whichever way the section is traversed: the (tangent, side, up) frame
 * is always right-handed, so the facing depends only on the section's winding in (side, up), which is
 * measured here. Set `flip` on the result only to show the tube's inside (a duct).
 */
export function sweepGeometry(
  path: (t: number, out: THREE.Vector3) => void,
  section: (t: number, a: number, out: THREE.Vector2) => void,
  rows: number,
  cols: number,
  upRef: THREE.Vector3,
): GridSpec {
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  const s = new THREE.Vector2();
  // Signed area of the mid-path section: counter-clockwise (side -> up) gives d(path) x d(ring) outward.
  let area = 0;
  const q0 = new THREE.Vector2();
  const q1 = new THREE.Vector2();
  for (let j = 0; j < cols; j++) {
    section(0.5, (j / cols) * Math.PI * 2, q0);
    section(0.5, (((j + 1) % cols) / cols) * Math.PI * 2, q1);
    area += q0.x * q1.y - q1.x * q0.y;
  }
  return {
    rows,
    cols: cols + 1,
    wrap: true,
    flip: area < 0,
    position(i, j, out) {
      const t = i / (rows - 1);
      const dt = 1 / (rows - 1);
      path(Math.max(0, t - dt * 0.5), p0);
      path(Math.min(1, t + dt * 0.5), p1);
      tan.subVectors(p1, p0).normalize();
      up.copy(upRef).addScaledVector(tan, -upRef.dot(tan)).normalize();
      side.crossVectors(tan, up);
      path(t, out);
      section(t, ((j % cols) / cols) * Math.PI * 2, s);
      out.addScaledVector(side, s.x).addScaledVector(up, s.y);
    },
  };
}

/**
 * Keep only position/normal/uv (and vertex colours, which only the propeller blades use) so geometries
 * from different sources can be merged.
 */
export function cleanAttributes(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') g.deleteAttribute(name);
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.index) {
    const n = g.getAttribute('position').count;
    const idx = new Array<number>(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(idx);
  }
  return g;
}

/**
 * Collects static geometry per material and merges each set into one mesh, so the many small fixed parts
 * of the aircraft cost one draw call per material instead of one per part.
 */
export class MeshBatch {
  private readonly sets = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(material: THREE.Material, geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4): void {
    const g = cleanAttributes(geometry);
    if (matrix) g.applyMatrix4(matrix);
    let list = this.sets.get(material);
    if (!list) this.sets.set(material, (list = []));
    list.push(g);
  }

  build(name: string, shadows: { cast: boolean; receive: boolean } = { cast: true, receive: true }): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    for (const [material, list] of this.sets) {
      const merged = mergeGeometries(list, false);
      if (!merged) throw new Error(`MeshBatch ${name}: incompatible geometries`);
      for (const g of list) g.dispose();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = shadows.cast;
      mesh.receiveShadow = shadows.receive;
      mesh.name = `${name}:${material.name}`;
      group.add(mesh);
    }
    this.sets.clear();
    return group;
  }
}

/**
 * A control-surface hinge: an Object3D placed on the hinge line whose local +X is the hinge axis.
 * Geometry authored in model space is re-expressed in the hinge frame with `adopt`, and setAngle()
 * rotates it about the axis (right-hand rule).
 */
export class Hinge {
  readonly object = new THREE.Object3D();
  private readonly base = new THREE.Quaternion();
  private readonly spin = new THREE.Quaternion();
  private static readonly X = new THREE.Vector3(1, 0, 0);
  /** Rest position of the hinge point (model space of the parent). */
  readonly origin: THREE.Vector3;

  constructor(origin: THREE.Vector3, axis: THREE.Vector3) {
    this.origin = origin.clone();
    this.object.position.copy(origin);
    this.base.setFromUnitVectors(Hinge.X, axis.clone().normalize());
    this.object.quaternion.copy(this.base);
    this.object.updateMatrix();
  }

  /** Transform a model-space geometry into this hinge's local frame. */
  adopt(g: THREE.BufferGeometry): THREE.BufferGeometry {
    this.object.updateMatrix();
    return g.applyMatrix4(this.object.matrix.clone().invert());
  }

  setAngle(rad: number): void {
    this.spin.setFromAxisAngle(Hinge.X, rad);
    this.object.quaternion.multiplyQuaternions(this.base, this.spin);
  }
}
