// Procedural creature rig (Deep Time fauna art, WP4): builds a species' meshes from one body plan.
//
// A body is a set of parts, each a grid surface (render/aircraft/geometry.ts gridGeometry with smooth
// finite-difference normals):
//   - lofts: superellipse sections (separate top and bottom half-heights, so a deep belly hangs below a
//     straight back) swept along a smooth spine path (sweepGeometry);
//   - limbs: tapered tubes swept along a joint polyline (hip -> knee -> ankle -> toe, or shoulder -> elbow
//     -> wrist -> hand);
//   - membranes: two-faced grids between a leading-edge curve (the wing bones) and a trailing edge.
// Every vertex carries the rig attributes the animated material reads (faunaMaterial.ts):
//   aBone   float  analytic bone (fauna/types.ts BONE), < BONE_COUNT
//   aBoneW  float  weight of aBone; 1 - aBoneW goes to the bone's parent (2-bone blend near joints)
//   aRig    vec2   x: coordinate along the limb, m (distance from the limb bone's pivot along the rest-pose
//                  path; for wings the rest span |z|), which selects the limb's sub-joints (knee, ankle, elbow,
//                  wrist, knuckle); y: membrane chord distance behind the leading edge, m (0 elsewhere), used
//                  to tuck the membrane in when the wing folds
//   color   vec3   baked linear albedo (countershading, mottling, crest colour, AO), 0.03-0.15
// The LODs are the same plan built at different `detail` resolutions, so they share pivots by construction.
//
// Body space: metres, +x forward (head), +y up, +z right. Three-only (no renderer), so node tests run it.

import * as THREE from 'three';
import { gridGeometry, Pchip, sweepGeometry, type GridSpec } from '../../render/aircraft/geometry';
import { BONE_COUNT } from './types';

export type Vec3 = readonly [number, number, number];
export type RGB = [number, number, number];

/** Per-vertex rig data a part's attribute callback fills in. */
export interface RigVertex {
  bone: number;
  w: number;
  limb: number;
  chord: number;
  color: RGB;
}

/** What an attribute callback knows about a vertex. */
export interface VertexInfo {
  /** Rest position and normal, body space. */
  p: THREE.Vector3;
  n: THREE.Vector3;
  /** Grid coordinates: u along the part (0..1), v around / across it (0..1). */
  u: number;
  v: number;
}

export type AttributeFn = (info: VertexInfo, out: RigVertex) => void;

/** Accumulates parts into one geometry with the rig attribute set. */
export class RigMesh {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly col: number[] = [];
  private readonly bone: number[] = [];
  private readonly boneW: number[] = [];
  private readonly rig: number[] = [];
  private readonly index: number[] = [];

  /** Add a grid part. `uv` of the grid is ignored; `attr` assigns bone, weight, limb coordinates and colour. */
  add(spec: GridSpec, attr: AttributeFn): void {
    const g = gridGeometry(spec);
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const base = this.pos.length / 3;
    const info: VertexInfo = { p: new THREE.Vector3(), n: new THREE.Vector3(), u: 0, v: 0 };
    const out: RigVertex = { bone: 0, w: 1, limb: 0, chord: 0, color: [0.1, 0.1, 0.1] };
    for (let k = 0; k < p.count; k++) {
      const i = Math.floor(k / spec.cols);
      const j = k % spec.cols;
      info.p.set(p.getX(k), p.getY(k), p.getZ(k));
      info.n.set(n.getX(k), n.getY(k), n.getZ(k));
      info.u = spec.rows > 1 ? i / (spec.rows - 1) : 0;
      info.v = spec.cols > 1 ? j / (spec.cols - 1) : 0;
      out.bone = 0;
      out.w = 1;
      out.limb = 0;
      out.chord = 0;
      attr(info, out);
      this.pos.push(info.p.x, info.p.y, info.p.z);
      this.nrm.push(info.n.x, info.n.y, info.n.z);
      this.col.push(out.color[0], out.color[1], out.color[2]);
      this.bone.push(out.bone);
      this.boneW.push(out.w);
      this.rig.push(out.limb, out.chord);
    }
    const idx = g.getIndex()!;
    for (let k = 0; k < idx.count; k++) this.index.push(base + idx.getX(k));
    g.dispose();
  }

  get triangles(): number {
    return this.index.length / 3;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aBone', new THREE.Float32BufferAttribute(this.bone, 1));
    g.setAttribute('aBoneW', new THREE.Float32BufferAttribute(this.boneW, 1));
    g.setAttribute('aRig', new THREE.Float32BufferAttribute(this.rig, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.index, 1) : new THREE.Uint16BufferAttribute(this.index, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Paths

/** A smooth path through control points, parametrised by arc length (t in 0..1). */
export class RigPath {
  private readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;

  constructor(points: readonly Vec3[], tension = 0.5) {
    this.curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
      false,
      'centripetal',
      tension,
    );
    this.curve.arcLengthDivisions = 400;
    this.length = this.curve.getLength();
  }

  at(t: number, out: THREE.Vector3): THREE.Vector3 {
    return this.curve.getPointAt(Math.min(1, Math.max(0, t)), out);
  }

  /** Arc length from the start to the control point nearest `p`, m (for joint coordinates). */
  distanceTo(p: Vec3): number {
    const q = new THREE.Vector3(p[0], p[1], p[2]);
    const tmp = new THREE.Vector3();
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i <= 400; i++) {
      const d = this.at(i / 400, tmp).distanceToSquared(q);
      if (d < bestD) {
        bestD = d;
        best = i / 400;
      }
    }
    return best * this.length;
  }
}

/** A table keyed by a scalar (a station x, or a limb coordinate), interpolated monotonically. */
export class Profile {
  private readonly curves: Pchip[];
  constructor(keys: readonly (readonly number[])[]) {
    const xs = keys.map((k) => k[0]);
    this.curves = [];
    for (let c = 1; c < keys[0].length; c++) this.curves.push(new Pchip(xs, keys.map((k) => k[c])));
  }
  /** Column c (1-based as in the key rows) at x. */
  at(x: number, c: number): number {
    return this.curves[c - 1].eval(x);
  }
}

const sgnPow = (v: number, e: number): number => Math.sign(v) * Math.pow(Math.abs(v), e);

/**
 * A loft: superellipse sections swept along `path`. The section at a path point P is given by
 * `section(P, t)` -> [halfWidth, halfTop, halfBottom, exponent] (exponent 2 = ellipse, larger = boxier).
 * The ring starts at the top and runs over the right side.
 */
export function loftSpec(
  path: RigPath,
  section: (p: THREE.Vector3, t: number) => readonly [number, number, number, number],
  rows: number,
  cols: number,
): GridSpec {
  const tmp = new THREE.Vector3();
  return sweepGeometry(
    (t, out) => path.at(t, out),
    (t, a, out) => {
      path.at(t, tmp);
      const [w, top, bot, e] = section(tmp, t);
      // a = 0 at the top, PI/2 at the right side (local +x of the sweep's (side, up) frame).
      const s = Math.sin(a);
      const c = Math.cos(a);
      const ex = 2 / e;
      out.set(w * sgnPow(s, ex), (c >= 0 ? top : bot) * sgnPow(c, ex));
    },
    rows,
    cols,
    new THREE.Vector3(0, 1, 0),
  );
}

/** A tapered limb tube along `path`; `radius(t)` -> [side radius, fore-aft radius]. */
export function tubeSpec(path: RigPath, radius: (t: number) => readonly [number, number], rows: number, cols: number, upRef = new THREE.Vector3(1, 0, 0)): GridSpec {
  return sweepGeometry(
    (t, out) => path.at(t, out),
    (t, a, out) => {
      const [rs, rf] = radius(t);
      out.set(rs * Math.sin(a), rf * Math.cos(a));
    },
    rows,
    cols,
    upRef,
  );
}

/**
 * One face of a membrane between a leading edge le(s) and a trailing edge te(s) (s in 0..1 along the span),
 * offset by `lift` along +y (top face lift > 0, facing up; bottom face lift < 0, facing down).
 */
export function membraneSpec(
  le: (s: number, out: THREE.Vector3) => void,
  te: (s: number, out: THREE.Vector3) => void,
  rows: number,
  cols: number,
  lift: number,
  mirror: boolean,
): GridSpec {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  // Rows run outward along the span, columns rearward along the chord. For the right wing (+z) that grid's
  // cross(d/drow, d/dcol) = cross(+z, -x) = -y, so the top face is flipped; the left wing mirrors it.
  const up = lift > 0;
  return {
    rows,
    cols,
    flip: mirror ? !up : up,
    position(i, j, out) {
      const s = i / (rows - 1);
      le(s, a);
      te(s, b);
      out.lerpVectors(a, b, j / (cols - 1));
      out.y += lift;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Skinning helpers

/** A joint along a part's coordinate: vertices past `at` (within +-blend) move to `bone`. */
export interface Joint {
  at: number;
  bone: number;
  blend: number;
}

/**
 * Bone and weight of a vertex at coordinate `x` along a chain of joints sorted by `at` (ascending), starting
 * on `rootBone`. The 2-bone blend: around a joint the child takes a smoothstep weight, the rest goes to its
 * parent (the previous bone of the chain, which must be the child's parent in the pivots).
 */
export function chainWeight(x: number, rootBone: number, joints: readonly Joint[], out: RigVertex): void {
  out.bone = rootBone;
  out.w = 1;
  for (const j of joints) {
    if (x <= j.at - j.blend) break;
    const w = smoothstep(j.at - j.blend, j.at + j.blend, x);
    out.bone = j.bone;
    out.w = w;
  }
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------------------------------------
// Pivots

export interface PivotDef {
  bone: number;
  at: Vec3;
  parent: number;
}

/** BONE_COUNT x vec4 (pivot xyz, parent index); bones not listed sit on their default parent's pivot. */
export function packPivots(defs: readonly PivotDef[], defaults: Readonly<Record<number, number>>): Float32Array {
  const out = new Float32Array(BONE_COUNT * 4);
  const set = new Set<number>();
  for (const d of defs) {
    out.set([d.at[0], d.at[1], d.at[2], d.parent], d.bone * 4);
    set.add(d.bone);
  }
  for (let b = 0; b < BONE_COUNT; b++) {
    if (set.has(b)) continue;
    const parent = defaults[b] ?? 0;
    out.set([out[parent * 4], out[parent * 4 + 1], out[parent * 4 + 2], b === 0 ? -1 : parent], b * 4);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Colour

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1 (period-free), for mottling. */
export function valueNoise(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const s = seed * 131;
  const c = (dx: number, dy: number, dz: number): number => hash3(xi + dx + s, yi + dy, zi + dz);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), sx), l(c(0, 1, 0), c(1, 1, 0), sx), sy),
    l(l(c(0, 0, 1), c(1, 0, 1), sx), l(c(0, 1, 1), c(1, 1, 1), sx), sy),
    sz,
  );
}

/** Two-octave mottling in 0..1 at body position p, feature size `size` m. */
export function mottle(p: THREE.Vector3, size: number, seed = 0): number {
  const f = 1 / size;
  return 0.65 * valueNoise(p.x * f, p.y * f, p.z * f, seed) + 0.35 * valueNoise(p.x * f * 2.7, p.y * f * 2.7, p.z * f * 2.7, seed + 1);
}

export function mixRGB(a: readonly number[], b: readonly number[], t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scaleRGB(c: readonly number[], k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** Clamp a baked albedo into the scene's linear range (photometric lighting: brighter would glow). */
export function clampAlbedo(c: RGB, lo = 0.025, hi = 0.16): RGB {
  return [Math.min(hi, Math.max(lo, c[0])), Math.min(hi, Math.max(lo, c[1])), Math.min(hi, Math.max(lo, c[2]))];
}

// ---------------------------------------------------------------------------------------------------------
// Limb sub-joints (knee/ankle, elbow/wrist, wing elbow/wrist/knuckle): pivots and limb-coordinate thresholds
// for the material's uSub[9] (right-side pivots; the left limbs mirror z).

export const SUB_FORE = 0;
export const SUB_HIND = 3;
export const SUB_WING = 6;
export const SUB_COUNT = 9;

/** uSub[9]: xyz pivot (right side), w limb coordinate where the joint sits (1e6 = unused). */
export function packSubJoints(groups: Readonly<Record<number, readonly { at: Vec3; coord: number }[]>>): Float32Array {
  const out = new Float32Array(SUB_COUNT * 4);
  for (let k = 0; k < SUB_COUNT; k++) out[k * 4 + 3] = 1e6;
  for (const [base, joints] of Object.entries(groups))
    joints.forEach((j, i) => out.set([j.at[0], j.at[1], j.at[2], j.coord], (Number(base) + i) * 4));
  return out;
}

/** A body plan built at one detail level: geometry and its triangle count. */
export interface BuiltLod {
  geometry: THREE.BufferGeometry;
  triangles: number;
}

/** Grid resolution helper: scale a base count by detail, never below `min`. */
export function res(base: number, detail: number, min: number): number {
  return Math.max(min, Math.round(base * detail));
}

/** uFold[4] for a rig without a wing fold: four identity quaternions. */
export function identityFold(): Float32Array {
  return new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
}
