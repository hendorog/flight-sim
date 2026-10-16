// MD 500E detail helpers; FRD metres. Decoration never supplies contact or aerodynamic geometry: everything that
// the physics reads stays in dimensions.ts.
import * as THREE from 'three';
import type { FRD } from '../../render/aircraft/airframe/types';
import { capGeometry, frd, gridGeometry, MeshBatch } from '../../render/aircraft/geometry';

/** Half width of the outer (or lining) skin at body x, z. */
export type MD500SkinWidth = (x: number, z: number) => number;
/** Top and bottom centreline z and the widest-section z of the loft at body x. */
export type MD500Section = (x: number) => { zTop: number; zBot: number; zMid: number; hw: number; nTop: number; nBot: number };

export function md500Materials() {
  const make = (name: string, color: number, roughness: number, metalness = 0) =>
    new THREE.MeshStandardMaterial({ name: `md500${name}`, color, roughness, metalness });
  return {
    paint: make('Paint', 0xeef0ed, 0.32), band: make('Band', 0x1c325c, 0.36), red: make('Red', 0xb22628, 0.42),
    frame: make('Frame', 0x24282b, 0.55, 0.1), metal: make('Metal', 0x9ca3a5, 0.32, 0.7),
    cast: make('Cast', 0x6b7479, 0.5, 0.35), dark: make('Dark', 0x1f2326, 0.7),
    rubber: make('Rubber', 0x151719, 0.9), seat: make('Seat', 0x2c3540, 0.88), seatTrim: make('SeatTrim', 0x8f979c, 0.6, 0.2),
    exhaust: make('Exhaust', 0x5e554c, 0.62, 0.35), soot: make('Soot', 0x191714, 0.95),
    grey: make('Grey', 0x8a9095, 0.45, 0.2), lens: make('Lens', 0xdfe6ea, 0.08, 0.4), orange: make('Orange', 0xd65f2f, 0.5),
  };
}
export type MD500Materials = ReturnType<typeof md500Materials>;

export function ellipsoid(centre: FRD, radii: FRD, w = 24, h = 16): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, w, h).scale(radii[1], radii[2], radii[0]).translate(...frd(...centre).toArray());
}

/** Points on the skin side `side` (+1 right) at the given (x, z) side-projection points, densified, lifted `offset`. */
export function skinPath(width: MD500SkinWidth, side: number, points: readonly (readonly [number, number])[], offset = 0, steps = 8): FRD[] {
  const out: FRD[] = [];
  for (let i = 0; i < points.length - 1; i++) for (let j = 0; j < steps; j++) {
    const x = THREE.MathUtils.lerp(points[i][0], points[i + 1][0], j / steps);
    const z = THREE.MathUtils.lerp(points[i][1], points[i + 1][1], j / steps);
    out.push([x, side * (width(x, z) + offset), z]);
  }
  const [x, z] = points[points.length - 1]; out.push([x, side * (width(x, z) + offset), z]); return out;
}

/** A closed rounded polygon (x, z), sampled densely: the same convex outline the window mask uses, as a path. */
export function roundedLoop(pts: readonly (readonly [number, number])[], r: number, perCorner = 6): [number, number][] {
  const out: [number, number][] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]), db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ra = Math.min(r, da / 2), rb = Math.min(r, db / 2);
    const s: [number, number] = [p[0] + (a[0] - p[0]) * ra / da, p[1] + (a[1] - p[1]) * ra / da];
    const e: [number, number] = [p[0] + (b[0] - p[0]) * rb / db, p[1] + (b[1] - p[1]) * rb / db];
    for (let k = 0; k <= perCorner; k++) {
      const t = k / perCorner, u = 1 - t;
      out.push([u * u * s[0] + 2 * u * t * p[0] + t * t * e[0], u * u * s[1] + 2 * u * t * p[1] + t * t * e[1]]);
    }
  }
  out.push(out[0]);
  return out;
}

/** A point on the loft ring at body x and ring angle a (0 = bottom centre, pi/2 = widest point, pi = top), right side. */
export function ringPoint(section: MD500Section, x: number, a: number, lift = 0): FRD {
  const s = section(x);
  const sn = Math.sin(a), c = Math.cos(a);
  let y: number, z: number;
  if (a <= Math.PI / 2) {
    y = s.hw * Math.pow(Math.max(0, sn), 2 / s.nBot); z = s.zMid + (s.zBot - s.zMid) * Math.pow(Math.max(0, c), 2 / s.nBot);
  } else {
    y = s.hw * Math.pow(Math.max(0, sn), 2 / s.nTop); z = s.zMid - (s.zMid - s.zTop) * Math.pow(Math.max(0, -c), 2 / s.nTop);
  }
  // Lift along the approximate outward normal of the superellipse section.
  const ny = sn, nz = c, l = Math.hypot(ny, nz) || 1;
  return [x, y + lift * ny / l, z + lift * nz / l];
}

/**
 * A thin painted overlay that follows the loft over a range of x and of the lateral half width |y| < halfY about
 * the top (top = true) or bottom centreline, lifted `lift` off the skin (a strip of paint or a frame cap).
 */
export function centreStrip(section: MD500Section, x0: number, x1: number, halfY: number, top: boolean, lift = 0.002, rows = 24): THREE.BufferGeometry {
  return gridGeometry({ rows, cols: 9, flip: !top,
    position(i, j, out) {
      const x = THREE.MathUtils.lerp(x0, x1, i / (rows - 1)), s = section(x);
      const y = THREE.MathUtils.lerp(-1, 1, j / 8) * Math.min(halfY, s.hw * 0.98);
      // Invert y = hw sin^(2/n) for the ring angle; keep z on the skin.
      const n = top ? s.nTop : s.nBot, sn = Math.min(1, Math.pow(Math.abs(y) / s.hw, n / 2));
      const a = top ? Math.PI - Math.asin(sn) : Math.asin(sn);
      const p = ringPoint(section, x, a, lift);
      frd(p[0], Math.sign(y) * p[1], p[2], out);
    } });
}

/**
 * Aerofoil-section panel between two chord lines (le/te at the root and at the tip), thickness along `normal`,
 * NACA 00xx thickness `tc`. Closed with flat caps at both ends.
 */
export function aerofoilPanel(rootLe: FRD, rootTe: FRD, tipLe: FRD, tipTe: FRD, normal: FRD, tc: number, rows = 6, cols = 25): THREE.BufferGeometry {
  const n = frd(...normal).normalize();
  const at = (i: number, j: number, out: THREE.Vector3): THREE.Vector3 => {
    const t = i / (rows - 1), a = j / (cols - 1) * Math.PI * 2;
    const xc = (1 - Math.cos(a)) / 2, face = a <= Math.PI ? 1 : -1;
    const half = 5 * tc * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc ** 2 + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);
    const le = frd(...rootLe).lerp(frd(...tipLe), t), te = frd(...rootTe).lerp(frd(...tipTe), t);
    const chord = te.distanceTo(le);
    return out.copy(le).lerp(te, xc).addScaledVector(n, face * half * chord);
  };
  const batch = new MeshBatch(), dummy = new THREE.MeshBasicMaterial();
  const skin = gridGeometry({ rows, cols, wrap: true, position: (i, j, out) => void at(i, j, out) });
  batch.add(dummy, skin);
  for (const i of [0, rows - 1]) {
    const loop = Array.from({ length: cols - 1 }, (_, j) => at(i, j, new THREE.Vector3()));
    const span = frd(...tipLe).sub(frd(...rootLe));
    batch.add(dummy, capGeometry(loop, i === 0 ? span.clone().negate() : span));
  }
  const mesh = batch.build('panel').children[0] as THREE.Mesh;
  dummy.dispose();
  // Wrapped grid winding depends on the chord direction: render both faces' lighting correctly by recomputing normals.
  mesh.geometry.computeVertexNormals();
  return mesh.geometry;
}

/** An elliptical faired strut from a to b: chord along FRD x (the airflow), thickness across. */
export function fairedStrut(a: FRD, b: FRD, chord: number, thickness: number, segments = 16): THREE.BufferGeometry {
  const p = frd(...a), q = frd(...b), u = q.clone().sub(p);
  const length = u.length(); u.normalize();
  const flow = new THREE.Vector3(0, 0, -1); // FRD +x
  const c = flow.clone().addScaledVector(u, -flow.dot(u)).normalize();
  const w = new THREE.Vector3().crossVectors(u, c).normalize();
  const g = new THREE.CylinderGeometry(1, 1, 1, segments, 1);
  const m = new THREE.Matrix4().makeBasis(w.multiplyScalar(thickness / 2), u.multiplyScalar(length), c.multiplyScalar(chord / 2));
  m.setPosition(p.add(q).multiplyScalar(0.5));
  return g.applyMatrix4(m);
}

/** A unit cylinder positioned between two model-space points (moving rods and dampers, every frame). */
const axis = new THREE.Vector3(0, 1, 0), delta = new THREE.Vector3();
export function fitRod(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3): void {
  delta.subVectors(b, a); mesh.scale.y = delta.length();
  mesh.quaternion.setFromUnitVectors(axis, delta.normalize()); mesh.position.copy(a).add(b).multiplyScalar(0.5);
}

/**
 * Lofted rounded-box fairing (the engine air-inlet fairing over the mast): rows of super-elliptic sections
 * [x, zTop, zBottom, halfWidth], exponent n (2 = ellipse, larger = boxier); the bottom is open (it sits on the skin).
 */
export function fairingLoft(keys: readonly (readonly [number, number, number, number])[], n: number, closed = false, rows = 40, cols = 41): THREE.BufferGeometry {
  const xs = keys.map(k => k[0]);
  const lerpKey = (x: number, c: number): number => {
    for (let i = 0; i < keys.length - 1; i++) if ((x - xs[i]) * (x - xs[i + 1]) <= 0) {
      const t = (x - xs[i]) / (xs[i + 1] - xs[i] || 1);
      return THREE.MathUtils.lerp(keys[i][c], keys[i + 1][c], t);
    }
    return keys[x > xs[0] ? 0 : keys.length - 1][c];
  };
  const xAt = (i: number) => THREE.MathUtils.lerp(xs[0], xs[xs.length - 1], i / (rows - 1));
  const shell = gridGeometry({ rows, cols, flip: true,
    position(i, j, out) {
      const x = xAt(i), a = THREE.MathUtils.lerp(-Math.PI / 2, Math.PI / 2, j / (cols - 1));
      const top = lerpKey(x, 1), bottom = lerpKey(x, 2), hw = lerpKey(x, 3);
      const s = Math.sin(a), c = Math.cos(a);
      const y = hw * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
      const z = bottom - (bottom - top) * Math.pow(Math.max(0, c), 2 / n);
      frd(x, y, z, out);
    } });
  if (!closed) return shell;
  // Flat floor between the two lower edges, facing down.
  const floor = gridGeometry({ rows, cols: 2,
    position(i, j, out) { const x = xAt(i); frd(x, (j === 0 ? -1 : 1) * lerpKey(x, 3), lerpKey(x, 2), out); } });
  const batch = new MeshBatch(), dummy = new THREE.MeshBasicMaterial();
  batch.add(dummy, shell); batch.add(dummy, floor);
  const mesh = batch.build('fairing').children[0] as THREE.Mesh;
  dummy.dispose(); return mesh.geometry;
}
