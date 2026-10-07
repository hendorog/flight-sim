// Geometry helpers for procedural buildings and props. All generated UVs are in metres, so tiling textures keep
// a constant physical scale (set texture.repeat = 1 / tile size). Parts are collected per material in a
// GeometryBatch and merged, so the whole airport's buildings draw in about a dozen calls.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Box centred at the origin with per-face metric UVs (u horizontal, v vertical on walls). */
export function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z; 4 vertices each.
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) uv.setXY(f * 4 + i, uv.getX(f * 4 + i) * dims[f][0], uv.getY(f * 4 + i) * dims[f][1]);
  return g;
}

/** Cylinder along +y centred at the origin, metric UVs. */
export function cylGeo(rTop: number, rBottom: number, h: number, segments = 16, open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, segments, 1, open);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const circ = Math.PI * (rTop + rBottom);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * h);
  return g;
}

/**
 * Planar convex polygon with UVs from its own plane: u along the first edge, v perpendicular to it.
 * The winding is flipped if needed so the face points toward `facing`.
 */
export function polyGeo(points: THREE.Vector3[], facing: THREE.Vector3): THREE.BufferGeometry {
  const probe = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
  if (probe.dot(facing) < 0) points = [...points].reverse();
  const p0 = points[0];
  const e1 = points[1].clone().sub(p0).normalize();
  const n = points[2].clone().sub(p0).cross(points[1].clone().sub(p0)).normalize().negate();
  const e2 = n.clone().cross(e1);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    for (const p of [p0, points[i], points[i + 1]]) {
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      const d = p.clone().sub(p0);
      uv.push(d.dot(e1), d.dot(e2));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

export const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();

/** Translation + rotation about y (and optional x/z) as a matrix. */
export function placement(x: number, y: number, z: number, rotY = 0, rotX = 0, rotZ = 0, scale = 1): THREE.Matrix4 {
  tmpQuat.setFromEuler(tmpEuler.set(rotX, rotY, rotZ, 'YXZ'));
  return tmpMatrix.compose(new THREE.Vector3(x, y, z), tmpQuat, new THREE.Vector3(scale, scale, scale)).clone();
}

/**
 * Per-vertex weathering data of one part (see materials.ts): the part's lowest and highest point (y, m), a seed in
 * [0, 1) hashed from its position, and 1 if it stands on the ground (its base within 0.6 m of the field).
 */
function weatherAttribute(g: THREE.BufferGeometry): Float32Array {
  const pos = g.attributes.position as THREE.BufferAttribute;
  let y0 = Infinity, y1 = -Infinity, sx = 0, sz = 0;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
    sx += pos.getX(i);
    sz += pos.getZ(i);
  }
  const n = Math.max(pos.count, 1);
  const seed = Math.abs(Math.sin((sx / n) * 12.9898 + (sz / n) * 78.233 + y0 * 37.719) * 43758.5453) % 1;
  const out = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) out.set([y0, y1, seed, y0 < 0.6 ? 1 : 0], i * 4);
  return out;
}

/** Collects geometry for one material, with a baked vertex colour and weathering data, and merges it. */
export class GeometryBatch {
  private readonly parts: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, matrix?: THREE.Matrix4, color: THREE.ColorRepresentation = 0xffffff): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (matrix) g.applyMatrix4(matrix);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('weather', new THREE.BufferAttribute(weatherAttribute(g), 4));
    this.parts.push(g);
    geo.dispose();
    return this;
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    merged.computeBoundingSphere();
    return merged;
  }
}

/** A set of batches keyed by material name. */
export class BatchSet<K extends string> {
  private readonly batches = new Map<K, GeometryBatch>();

  get(key: K): GeometryBatch {
    let b = this.batches.get(key);
    if (!b) this.batches.set(key, (b = new GeometryBatch()));
    return b;
  }

  /** Build one mesh per non-empty batch. */
  meshes(materials: Record<K, THREE.Material>, shadows: { cast: boolean; receive: boolean } = { cast: true, receive: true }): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [key, batch] of this.batches) {
      if (batch.empty) continue;
      const m = new THREE.Mesh(batch.build(), materials[key]);
      m.name = key;
      m.castShadow = shadows.cast;
      m.receiveShadow = shadows.receive;
      out.push(m);
    }
    return out;
  }
}

/**
 * Flat ribbon along a polyline (points in world or local space, y up), `width` metres wide, with
 * uv = (distance along, offset across). Consecutive segments share mitred vertices.
 */
export function ribbonGeo(points: THREE.Vector3[], width: number): THREE.BufferGeometry {
  const n = points.length;
  const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), nor = new Float32Array(n * 2 * 3);
  const side = new THREE.Vector3(), dir = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let dist = 0;
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    dir.subVectors(b, a).setY(0).normalize();
    side.crossVectors(dir, up).normalize().multiplyScalar(width / 2);
    if (i > 0) dist += points[i].distanceTo(points[i - 1]);
    for (let s = 0; s < 2; s++) {
      const sign = s === 0 ? -1 : 1;
      const p = points[i];
      pos.set([p.x + side.x * sign, p.y, p.z + side.z * sign], (i * 2 + s) * 3);
      nor.set([0, 1, 0], (i * 2 + s) * 3);
      uv.set([dist, (sign * width) / 2], (i * 2 + s) * 2);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    index.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
