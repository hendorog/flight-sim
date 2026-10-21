// AH-56A detail helpers and materials; FRD metres. Decoration never supplies contact or aerodynamic geometry: everything
// the physics reads stays in dimensions.ts. The aerofoil panel, faired strut and rounded fairing loft follow the MD 500E
// exterior's helpers (src/aircraft/md500/exteriorGeometry.ts) generalised to a tapering thickness, cambered sections
// and bodies of revolution; they are kept here so the two types do not share mutable code.
import * as THREE from 'three';
import type { FRD } from '../../render/aircraft/airframe/types';
import { capGeometry, frd, gridGeometry, MeshBatch } from '../../render/aircraft/geometry';

/** Half width of the outer (or lining) skin at body x, z. */
export type AH56SkinWidth = (x: number, z: number) => number;
/** Top and bottom centreline z, the widest-section z and the half width of the loft at body x. */
export type AH56Section = (x: number) => { zTop: number; zBot: number; zMid: number; hw: number; nTop: number; nBot: number };

/** Olive drab of the body (the baked loft colour, palette.base in visual.ts). */
export const OLIVE = 0x686846;

export function ah56Materials() {
  const make = (name: string, color: number, roughness: number, metalness = 0) =>
    new THREE.MeshStandardMaterial({ name: `ah56${name}`, color, roughness, metalness });
  return {
    paint: make('Paint', OLIVE, 0.62), paintDark: make('PaintDark', 0x45472f, 0.66), frame: make('Frame', 0x33352a, 0.6, 0.05),
    metal: make('Metal', 0x9aa0a0, 0.34, 0.7), cast: make('Cast', 0x5d6152, 0.5, 0.35), dark: make('Dark', 0x1d1f1b, 0.7),
    black: make('Black', 0x111211, 0.55), rubber: make('Rubber', 0x141513, 0.92), seat: make('Seat', 0x3b3f33, 0.88),
    yellow: make('Yellow', 0xd9b52a, 0.5), red: make('Red', 0xa42a24, 0.5), white: make('White', 0xe4e4dc, 0.5),
    exhaust: make('Exhaust', 0x4b443b, 0.62, 0.35), soot: make('Soot', 0x181714, 0.95), lens: make('Lens', 0xdfe6ea, 0.08, 0.4),
    sight: make('Sight', 0x1a2328, 0.12, 0.6), grey: make('Grey', 0x7c8180, 0.45, 0.2), panel: make('Panel', 0x262824, 0.75),
  };
}
export type AH56Materials = ReturnType<typeof ah56Materials>;

export function ellipsoid(centre: FRD, radii: FRD, w = 24, h = 16): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, w, h).scale(radii[1], radii[2], radii[0]).translate(...frd(...centre).toArray());
}

/** NACA 4-digit half thickness (t/c `tc`) at chord fraction xc. */
export function nacaThickness(tc: number, xc: number): number {
  return 5 * tc * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc ** 2 + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);
}

/**
 * Aerofoil panel between two chord lines (le/te at the root and at the tip), thickness along `normal` (the upper side
 * of a lifting surface), NACA 00xx thickness tapering from tcRoot to tcTip, an optional 4-digit camber line (m, p).
 * Closed with flat caps at both ends; the winding faces outward whichever way the caller orders the chord lines.
 */
export function aerofoilPanel(rootLe: FRD, rootTe: FRD, tipLe: FRD, tipTe: FRD, normal: FRD, tcRoot: number, tcTip = tcRoot,
  rows = 6, cols = 33, camber?: { m: number; p: number }): THREE.BufferGeometry {
  const n = frd(...normal).normalize();
  const at = (i: number, j: number, out: THREE.Vector3): THREE.Vector3 => {
    const t = i / (rows - 1), a = j / (cols - 1) * Math.PI * 2;
    const xc = (1 - Math.cos(a)) / 2, face = a <= Math.PI ? 1 : -1;
    const half = nacaThickness(THREE.MathUtils.lerp(tcRoot, tcTip, t), xc);
    let yc = 0;
    if (camber && camber.m > 0) yc = xc < camber.p ? camber.m / camber.p ** 2 * (2 * camber.p * xc - xc * xc)
      : camber.m / (1 - camber.p) ** 2 * (1 - 2 * camber.p + 2 * camber.p * xc - xc * xc);
    const le = frd(...rootLe).lerp(frd(...tipLe), t), te = frd(...rootTe).lerp(frd(...tipTe), t);
    const chord = te.distanceTo(le);
    return out.copy(le).lerp(te, xc).addScaledVector(n, (face * half + yc) * chord);
  };
  const span0 = frd(...tipLe).sub(frd(...rootLe)), chord0 = frd(...rootTe).sub(frd(...rootLe));
  const flip = span0.cross(chord0).dot(n) < 0;
  const batch = new MeshBatch(), dummy = new THREE.MeshBasicMaterial();
  batch.add(dummy, gridGeometry({ rows, cols, wrap: true, flip, position: (i, j, out) => void at(i, j, out) }));
  for (const i of [0, rows - 1]) {
    const loop = Array.from({ length: cols - 1 }, (_, j) => at(i, j, new THREE.Vector3()));
    batch.add(dummy, capGeometry(loop, i === 0 ? span0.clone().negate() : span0));
  }
  const mesh = batch.build('panel').children[0] as THREE.Mesh;
  dummy.dispose();
  mesh.geometry.computeVertexNormals();
  return mesh.geometry;
}

/** A unit cylinder positioned between two model-space points (moving rods, every frame). */
const yAxis = new THREE.Vector3(0, 1, 0), delta = new THREE.Vector3();
export function fitRod(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3): void {
  delta.subVectors(b, a); mesh.scale.y = Math.max(1e-6, delta.length());
  mesh.quaternion.setFromUnitVectors(yAxis, delta.normalize()); mesh.position.copy(a).add(b).multiplyScalar(0.5);
}

/**
 * Lofted rounded-box fairing: rows of super-elliptic sections [x, zTop, zBottom, halfWidth], exponent n; the bottom is
 * open (it sits on the skin) unless `closed`.
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
  const descending = xs[xs.length - 1] < xs[0];
  const shell = gridGeometry({ rows, cols, flip: !descending,
    position(i, j, out) {
      const x = xAt(i), a = THREE.MathUtils.lerp(-Math.PI / 2, Math.PI / 2, j / (cols - 1));
      const top = lerpKey(x, 1), bottom = lerpKey(x, 2), hw = lerpKey(x, 3);
      const s = Math.sin(a), c = Math.cos(a);
      frd(x, hw * Math.sign(s) * Math.pow(Math.abs(s), 2 / n), bottom - (bottom - top) * Math.pow(Math.max(0, c), 2 / n), out);
    } });
  if (!closed) return shell;
  const floor = gridGeometry({ rows, cols: 2, flip: descending,
    position(i, j, out) { const x = xAt(i); frd(x, (j === 0 ? -1 : 1) * lerpKey(x, 3), lerpKey(x, 2), out); } });
  const batch = new MeshBatch(), dummy = new THREE.MeshBasicMaterial();
  batch.add(dummy, shell); batch.add(dummy, floor);
  const mesh = batch.build('fairing').children[0] as THREE.Mesh;
  dummy.dispose(); return mesh.geometry;
}

/**
 * Body of revolution about an axis parallel to body x through (y, z): profile [x, radius] front to rear (radii 0 at the
 * ends close it). `squash` scales the vertical radius (an oval section).
 */
export function revolve(profile: readonly (readonly [number, number])[], y: number, z: number, segments = 32, squash = 1): THREE.BufferGeometry {
  const rows = profile.length, cols = segments + 1;
  // Rows run front (x large) to rear; columns round from the bottom through the right side.
  return gridGeometry({ rows, cols, wrap: true, flip: true,
    position(i, j, out) {
      const [x, r] = profile[i], a = j / segments * Math.PI * 2;
      frd(x, y + r * Math.sin(a), z + r * squash * Math.cos(a), out);
    } });
}

/** Points on the skin side `side` (+1 right) at the given (x, z) side-projection points, densified, lifted `offset`. */
export function skinPath(width: AH56SkinWidth, side: number, points: readonly (readonly [number, number])[], offset = 0, steps = 8): FRD[] {
  const out: FRD[] = [];
  for (let i = 0; i < points.length - 1; i++) for (let j = 0; j < steps; j++) {
    const x = THREE.MathUtils.lerp(points[i][0], points[i + 1][0], j / steps);
    const z = THREE.MathUtils.lerp(points[i][1], points[i + 1][1], j / steps);
    out.push([x, side * (width(x, z) + offset), z]);
  }
  const [x, z] = points[points.length - 1]; out.push([x, side * (width(x, z) + offset), z]); return out;
}

/** A point on the loft ring at body x and ring angle a (0 = bottom centre, pi/2 = widest point, pi = top), right side. */
export function ringPoint(section: AH56Section, x: number, a: number, lift = 0): FRD {
  const s = section(x);
  const sn = Math.sin(a), c = Math.cos(a);
  let y: number, z: number;
  if (a <= Math.PI / 2) {
    y = s.hw * Math.pow(Math.max(0, sn), 2 / s.nBot); z = s.zMid + (s.zBot - s.zMid) * Math.pow(Math.max(0, c), 2 / s.nBot);
  } else {
    y = s.hw * Math.pow(Math.max(0, sn), 2 / s.nTop); z = s.zMid - (s.zMid - s.zTop) * Math.pow(Math.max(0, -c), 2 / s.nTop);
  }
  return [x, y + lift * sn, z + lift * c];
}

/** The loft ring at station x from ring angle a0 on the left side over the top to a0 on the right, lifted off the skin. */
export function loftArc(section: AH56Section, x: number, a0: number, lift: number, steps = 24): FRD[] {
  const out: FRD[] = [];
  for (let k = 0; k <= steps; k++) { const p = ringPoint(section, x, THREE.MathUtils.lerp(a0, Math.PI, k / steps), lift); out.push([p[0], -p[1], p[2]]); }
  for (let k = steps - 1; k >= 0; k--) out.push(ringPoint(section, x, THREE.MathUtils.lerp(a0, Math.PI, k / steps), lift));
  return out;
}

/**
 * A decal following the loft side `side` over stations x0 (forward) .. x1 (aft) and heights zTop .. zBottom, lifted
 * `lift` off the skin, with uv such that the texture reads left to right as the viewer of that side sees it.
 */
export function loftDecal(width: AH56SkinWidth, side: number, x0: number, x1: number, zTop: number, zBottom: number, lift = 0.003,
  rows = 16, cols = 8): THREE.BufferGeometry {
  return gridGeometry({ rows, cols, flip: side < 0,
    position(i, j, out) {
      const x = THREE.MathUtils.lerp(x0, x1, i / (rows - 1)), z = THREE.MathUtils.lerp(zTop, zBottom, j / (cols - 1));
      frd(x, side * (width(x, z) + lift), z, out);
    },
    uv(i, j, out) { const u = i / (rows - 1); out.set(side > 0 ? 1 - u : u, 1 - j / (cols - 1)); } });
}

/** A ring band round the loft between stations x0 and x1 (all the way round), lifted off the skin. */
export function loftBand(section: AH56Section, x0: number, x1: number, lift = 0.0025, rows = 4, cols = 49): THREE.BufferGeometry {
  return gridGeometry({ rows, cols, wrap: true, flip: true,
    position(i, j, out) {
      const x = THREE.MathUtils.lerp(x0, x1, i / (rows - 1)), a = j / (cols - 1) * Math.PI * 2;
      const p = ringPoint(section, x, a <= Math.PI ? a : 2 * Math.PI - a, lift);
      frd(p[0], a <= Math.PI ? p[1] : -p[1], p[2], out);
    } });
}

/** A canvas texture of w x h px drawn by `draw` (a blank canvas under the test runner). */
export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.Texture {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.clearRect(0, 0, w, h);
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** A transparent decal material over `map` (polygon offset keeps it off the skin it lies on). */
export function decalMaterial(name: string, map: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ name: `ah56${name}`, map, transparent: true, alphaTest: 0.05, roughness: 0.6,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
}

/**
 * A flat frame strip along `path` (FRD points on the skin): `width` across the path in the skin's tangent plane, standing
 * `thickness` off the skin along the outward normal, which is taken from the loft axis (body x, centreline, `axisZ(x)`)
 * through each point. A closed rectangular section, open at the two ends; faces outward.
 */
export function frameStrip(path: readonly FRD[], axisZ: (x: number) => number, width: number, thickness: number): THREE.BufferGeometry {
  const n = path.length, pos: number[] = [], index: number[] = [];
  const p = (i: number) => frd(...path[i]);
  const t = new THREE.Vector3(), out = new THREE.Vector3(), w = new THREE.Vector3(), axis = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    t.subVectors(p(Math.min(n - 1, i + 1)), p(Math.max(0, i - 1))).normalize();
    const [x] = path[i];
    out.subVectors(p(i), frd(x, 0, axisZ(x), axis));
    out.addScaledVector(t, -out.dot(t)).normalize();
    w.crossVectors(t, out).normalize().multiplyScalar(width / 2);
    const base = p(i);
    for (const [a, b] of [[-1, 0], [-1, 1], [1, 1], [1, 0]] as const)
      pos.push(...base.clone().addScaledVector(w, a).addScaledVector(out, b * thickness).toArray());
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < 4; k++) {
    const a = i * 4 + k, b = i * 4 + (k + 1) % 4, c = a + 4, d = b + 4;
    index.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  // Face the first top quad outward (along the skin normal); flip every triangle when it points inward.
  const v = (i: number) => new THREE.Vector3(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
  const tri = new THREE.Vector3().subVectors(v(index[7]), v(index[6])).cross(new THREE.Vector3().subVectors(v(index[8]), v(index[6])));
  const n0 = new THREE.Vector3().subVectors(v(1), v(0));
  if (tri.dot(n0) < 0) { for (let k = 0; k < index.length; k += 3) [index[k + 1], index[k + 2]] = [index[k + 2], index[k + 1]]; g.setIndex(index); }
  const flat = g.toNonIndexed(); flat.computeVertexNormals(); g.dispose();
  return flat;
}
