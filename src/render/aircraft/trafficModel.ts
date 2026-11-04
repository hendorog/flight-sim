// A traffic type's static models, made once per type from its own exterior (trafficExterior.ts) and shared by every
// aircraft of the type that uses them:
//
//   near  the whole exterior at rest (surfaces neutral, gear down, propeller still, no crew), merged into one
//         geometry per material with the type's own materials and livery, without a registration: an aircraft
//         parked on the apron, a dozen draw calls instead of sixty and nothing to do per frame.
//   far   the same surfaces reduced by vertex clustering (cells of FAR_CELL, split by facing so the two skins of a
//         thin wing stay apart) to a few thousand triangles in one vertex-coloured geometry, its colours sampled
//         from the baked livery: an aircraft a few pixels across, its real silhouette and paint.
//
// Model space as the exterior's: nose -Z, right wing +X, up +Y, metres, origin at the reference point.

import * as THREE from 'three';
import type { AirframeVisualDef, LampVisualDef } from './airframe/types';
import { frd } from './geometry';
import { TrafficExterior } from './trafficExterior';

export interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export interface TrafficModel {
  readonly id: string;
  readonly near: readonly ModelPart[];
  readonly far: readonly ModelPart[];
  /** Lamp positions, model space (absent: the type has none). */
  readonly lamps: Partial<Record<LampVisualDef['id'], THREE.Vector3>>;
  /** Height of the reference point above the ground standing on its wheels, m. */
  readonly restHeight: number;
  readonly triangles: { near: number; far: number };
}

/** Cluster size of the far model, m: an aircraft drawn with it is under ~30 px across. */
const FAR_CELL = 0.09;
/** The glazing seen from outside at a distance: dark, a little blue. */
const GLASS = new THREE.Color(0.035, 0.045, 0.06);

const cache = new Map<string, Promise<TrafficModel>>();

/** The type's models (built on first use, then shared). */
export function trafficModel(def: AirframeVisualDef): Promise<TrafficModel> {
  let p = cache.get(def.id);
  if (!p) cache.set(def.id, (p = build(def)));
  return p;
}

async function build(def: AirframeVisualDef): Promise<TrafficModel> {
  // No registration: every parked aircraft of the type shares this one livery.
  const ext = new TrafficExterior(def, '', { crew: false });
  await ext.baked;
  ext.root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  ext.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !shown(m, ext.root)) return;
    const mat = m.material as THREE.Material;
    if (Array.isArray(m.material) || (mat.transparent && !mat.depthWrite)) return; // glows, the blur disc, trails
    meshes.push(m);
  });

  // Near: one geometry per material.
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const m of meshes) {
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    const list = byMaterial.get(m.material as THREE.Material);
    if (list) list.push(g);
    else byMaterial.set(m.material as THREE.Material, [g]);
  }
  const near: ModelPart[] = [];
  for (const [material, list] of byMaterial) near.push({ geometry: merge(list), material });

  // Far: everything outside the cabin, coloured per vertex, clustered.
  const farParts: { pos: Float32Array; nrm: Float32Array; col: Float32Array; idx: ArrayLike<number> }[] = [];
  for (const m of meshes) {
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mat.name === 'lining') continue;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    farParts.push({
      pos: g.getAttribute('position').array as Float32Array,
      nrm: g.getAttribute('normal').array as Float32Array,
      col: vertexColours(g, mat),
      idx: g.index ? g.index.array : sequence(g.getAttribute('position').count),
    });
  }
  const farGeometry = cluster(farParts, FAR_CELL);
  const farMaterial = new THREE.MeshStandardMaterial({ name: 'trafficFar', vertexColors: true, roughness: 0.45, metalness: 0, side: THREE.DoubleSide });
  const far: ModelPart[] = [{ geometry: farGeometry, material: farMaterial }];

  // The exterior's materials and textures live on in the near model; its own geometry goes.
  ext.releaseGeometry();

  const lamps: TrafficModel['lamps'] = {};
  for (const l of def.lamps) lamps[l.id] = frd(l.pos[0], l.pos[1], l.pos[2]);
  const tris = (parts: readonly ModelPart[]) => parts.reduce((n, p) => n + (p.geometry.index ? p.geometry.index.count : p.geometry.getAttribute('position').count) / 3, 0);
  return { id: def.id, near, far, lamps, restHeight: def.shadow.restHeight ?? 1.25, triangles: { near: tris(near), far: tris(far) } };
}

/** Visible, as are all its parents up to the root. */
function shown(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (!p.visible) return false;
  return true;
}

function sequence(n: number): Uint32Array {
  const a = new Uint32Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  return a;
}

/** Concatenate geometries (indexed in the result) with the attributes all of them have. */
function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = Object.keys(list[0].attributes).filter((n) => list.every((g) => g.getAttribute(n)?.itemSize === list[0].getAttribute(n).itemSize));
  let vertices = 0;
  let indices = 0;
  for (const g of list) {
    vertices += g.getAttribute('position').count;
    indices += g.index ? g.index.count : g.getAttribute('position').count;
  }
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = list[0].getAttribute(n).itemSize;
    const data = new Float32Array(vertices * size);
    let o = 0;
    for (const g of list) {
      const a = g.getAttribute(n);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) data[o++] = a.getComponent(i, k);
    }
    out.setAttribute(n, new THREE.BufferAttribute(data, size, n === 'color' ? false : list[0].getAttribute(n).normalized));
  }
  const index = new Uint32Array(indices);
  let o = 0;
  let base = 0;
  for (const g of list) {
    const count = g.getAttribute('position').count;
    if (g.index) for (let i = 0; i < g.index.count; i++) index[o++] = base + g.index.getX(i);
    else for (let i = 0; i < count; i++) index[o++] = base + i;
    base += count;
    g.dispose();
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** Each vertex's colour (linear): the material's, times its vertex colours, times its colour map where it has one. */
function vertexColours(g: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial): Float32Array {
  const n = g.getAttribute('position').count;
  const out = new Float32Array(n * 3);
  const base = mat.color ? mat.color : new THREE.Color(1, 1, 1);
  const vc = mat.vertexColors ? g.getAttribute('color') : undefined;
  const uv = g.getAttribute('uv');
  const map = mat.map as THREE.DataTexture | null;
  const img = map?.image as { data?: ArrayLike<number>; width: number; height: number } | undefined;
  const sample = !!(map && img?.data && img.width > 1 && uv);
  if (map && sample) map.updateMatrix();
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if (mat.name === 'glass') c.copy(GLASS);
    else {
      c.copy(base);
      if (vc) c.multiply(new THREE.Color(vc.getX(i), vc.getY(i), vc.getZ(i)));
      if (sample) {
        v.set(uv!.getX(i), uv!.getY(i), 1).applyMatrix3(map!.matrix);
        const px = texel(img!, v.x, v.y, map!.wrapS === THREE.RepeatWrapping, map!.wrapT === THREE.RepeatWrapping);
        // A window cut out of the skin (the alpha test): the glazing behind it shows.
        if (mat.alphaTest > 0 && px[3] / 255 < mat.alphaTest) c.copy(GLASS);
        else {
          const t = new THREE.Color().setRGB(px[0] / 255, px[1] / 255, px[2] / 255, map!.colorSpace === THREE.SRGBColorSpace ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace);
          c.multiply(t);
        }
      }
    }
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  }
  return out;
}

function texel(img: { data?: ArrayLike<number>; width: number; height: number }, u: number, v: number, repeatU: boolean, repeatV: boolean): [number, number, number, number] {
  const wrap = (t: number, rep: boolean) => (rep ? t - Math.floor(t) : Math.min(1, Math.max(0, t)));
  const x = Math.min(img.width - 1, Math.floor(wrap(u, repeatU) * img.width));
  const y = Math.min(img.height - 1, Math.floor(wrap(v, repeatV) * img.height));
  const d = img.data!;
  const k = (y * img.width + x) * 4;
  return [d[k], d[k + 1], d[k + 2], d[k + 3]];
}

/**
 * Vertex clustering: the vertices in one cell of `cell` metres that face the same way (the dominant axis of the
 * normal, and its sign) become one at their mean; triangles that collapse are dropped, duplicates kept once.
 */
export function cluster(parts: readonly { pos: ArrayLike<number>; nrm: ArrayLike<number>; col: ArrayLike<number>; idx: ArrayLike<number> }[], cell: number): THREE.BufferGeometry {
  const ids = new Map<number, number>();
  const sumP: number[] = [];
  const sumN: number[] = [];
  const sumC: number[] = [];
  const count: number[] = [];
  const tris: number[] = [];
  const seen = new Set<number>();
  for (const part of parts) {
    const { pos, nrm, col, idx } = part;
    const n = pos.length / 3;
    const of = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      const facing = ax >= ay && ax >= az ? (nx >= 0 ? 0 : 1) : ay >= az ? (ny >= 0 ? 2 : 3) : nz >= 0 ? 4 : 5;
      const key = (((Math.floor(x / cell) + 1024) * 2048 + (Math.floor(y / cell) + 1024)) * 2048 + (Math.floor(z / cell) + 1024)) * 8 + facing;
      let id = ids.get(key);
      if (id === undefined) {
        id = count.length;
        ids.set(key, id);
        sumP.push(0, 0, 0);
        sumN.push(0, 0, 0);
        sumC.push(0, 0, 0);
        count.push(0);
      }
      sumP[id * 3] += x; sumP[id * 3 + 1] += y; sumP[id * 3 + 2] += z;
      sumN[id * 3] += nx; sumN[id * 3 + 1] += ny; sumN[id * 3 + 2] += nz;
      sumC[id * 3] += col[i * 3]; sumC[id * 3 + 1] += col[i * 3 + 1]; sumC[id * 3 + 2] += col[i * 3 + 2];
      count[id]++;
      of[i] = id;
    }
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = of[idx[t]], b = of[idx[t + 1]], c = of[idx[t + 2]];
      if (a === b || b === c || a === c) continue;
      // Once per triangle whatever its first corner (same winding).
      const lo = Math.min(a, b, c);
      const [p, q, r] = lo === a ? [a, b, c] : lo === b ? [b, c, a] : [c, a, b];
      const k = (p * 1048576 + q) * 1048576 + r;
      if (seen.has(k)) continue;
      seen.add(k);
      tris.push(a, b, c);
    }
  }
  const m = count.length;
  const position = new Float32Array(m * 3);
  const normal = new Float32Array(m * 3);
  const colour = new Float32Array(m * 3);
  for (let i = 0; i < m; i++) {
    const k = count[i];
    for (let j = 0; j < 3; j++) {
      position[i * 3 + j] = sumP[i * 3 + j] / k;
      colour[i * 3 + j] = sumC[i * 3 + j] / k;
    }
    const len = Math.hypot(sumN[i * 3], sumN[i * 3 + 1], sumN[i * 3 + 2]) || 1;
    for (let j = 0; j < 3; j++) normal[i * 3 + j] = sumN[i * 3 + j] / len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colour, 3));
  g.setIndex(new THREE.BufferAttribute(m > 65535 ? new Uint32Array(tris) : new Uint16Array(tris), 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
