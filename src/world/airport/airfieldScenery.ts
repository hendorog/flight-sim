// Scenery for the generated airfields (airfields.ts): the runway and a hangar or two on each field's flat ground,
// in one vertex-coloured mesh for the flat parts and one for the solid ones.
//   sealed: an asphalt runway with edge lines, threshold bars, the designators and a dashed centreline, a small
//           apron on a short taxiway, hangars behind it;
//   grass:  white edge and threshold markers along the mown strip the ground shader paints, a hangar beside it.
// The terrain under them is exactly level at the field elevation (heightfield.ts), so everything sits on flat
// quads a few centimetres up. Windsocks come from windsock.ts (AirportSystem passes it the positions).

import * as THREE from 'three';
import { nedToThree } from '../../core/frames';
import type { Airfield } from '../airfields';
import { rng } from './noise';

const ASPHALT = new THREE.Color(0.075, 0.075, 0.072);
const APRON = new THREE.Color(0.1, 0.1, 0.095);
const PAINT = new THREE.Color(0.62, 0.62, 0.6);
const MARKER = new THREE.Color(0.75, 0.75, 0.72);
const WALLS = [0xb8bcc0, 0x9aa4ac, 0xc8c0b0, 0x7a8a80].map((c) => new THREE.Color(c));
const ROOFS = [0x5a5e62, 0x6a4a3a, 0x4a5a6a].map((c) => new THREE.Color(c));
const DOOR = new THREE.Color(0.18, 0.19, 0.2);

/** Seven-segment layout of the digits: segments a b c d e f g (top, top right, bottom right, bottom, bottom left, top left, middle). */
const DIGITS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
};

/** Where to put each field's windsock (beside the runway, mid-field). */
export function airfieldWindsocks(fields: readonly Airfield[]): { north: number; east: number; elevation: number }[] {
  return fields.map((f) => {
    const off = -(f.width / 2 + 25);
    return { north: f.north - Math.sin(f.heading) * off, east: f.east + Math.cos(f.heading) * off, elevation: f.elevation };
  });
}

export function buildAirfieldScenery(fields: readonly Airfield[]): { group: THREE.Group; materials: THREE.Material[] } {
  const group = new THREE.Group();
  group.name = 'airfields';
  const flatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  flatMat.name = 'airfield-ground';
  const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1 });
  solidMat.name = 'airfield-buildings';
  const flat: { pos: number[]; col: number[] } = { pos: [], col: [] };
  const solid: { pos: number[]; col: number[] } = { pos: [], col: [] };
  const v = new THREE.Vector3();

  for (const f of fields) {
    const r = rng((Math.imul(f.north | 0, 73856093) ^ Math.imul(f.east | 0, 19349663)) >>> 0);
    const c = Math.cos(f.heading), s = Math.sin(f.heading);
    // Field frame: along the runway (+ toward the high-numbered end), across (+ right on take-off), up.
    const put = (into: { pos: number[]; col: number[] }, along: number, across: number, up: number, col: THREE.Color) => {
      nedToThree({ x: f.north + c * along - s * across, y: f.east + s * along + c * across, z: -(f.elevation + up) }, v);
      into.pos.push(v.x, v.y, v.z);
      into.col.push(col.r, col.g, col.b);
    };
    /** A flat rectangle [a0, a1] x [c0, c1] at `up`, facing the sky. */
    const rect = (a0: number, a1: number, c0: number, c1: number, up: number, col: THREE.Color) => {
      for (const [a, x] of [[a0, c0], [a1, c0], [a1, c1], [a0, c0], [a1, c1], [a0, c1]]) put(flat, a, x, up, col);
    };
    /** A box on the ground: centre (along, across), size along x across x height, with a gable roof of `roof` m. */
    const box = (ca: number, cx: number, la: number, lx: number, h: number, wall: THREE.Color, roofH = 0, roof = wall) => {
      const A = [ca - la / 2, ca + la / 2], X = [cx - lx / 2, cx + lx / 2];
      const corners: [number, number][] = [[A[0], X[0]], [A[1], X[0]], [A[1], X[1]], [A[0], X[1]]];
      for (let k = 0; k < 4; k++) {
        const [a0, x0] = corners[k], [a1, x1] = corners[(k + 1) % 4];
        for (const [a, x, z] of [[a0, x0, 0], [a1, x1, 0], [a1, x1, h], [a0, x0, 0], [a1, x1, h], [a0, x0, h]]) put(solid, a, x, z, wall);
      }
      if (roofH <= 0) {
        for (const [a, x] of [[A[0], X[0]], [A[1], X[1]], [A[1], X[0]], [A[0], X[0]], [A[0], X[1]], [A[1], X[1]]]) put(solid, a, x, h, roof);
        return;
      }
      // Ridge along the `along` axis; gable ends at A[0] and A[1].
      const ridge = (X[0] + X[1]) / 2;
      for (const a of A) for (const [x, z] of [[X[0], h], [X[1], h], [ridge, h + roofH]]) put(solid, a, x, z, wall);
      for (const [x0, x1] of [[X[0], ridge], [ridge, X[1]]]) {
        const z0 = x0 === ridge ? h + roofH : h, z1 = x1 === ridge ? h + roofH : h;
        for (const [a, x, z] of [[A[0], x0, z0], [A[1], x0, z0], [A[1], x1, z1], [A[0], x0, z0], [A[1], x1, z1], [A[0], x1, z1]]) put(solid, a, x, z, roof);
      }
    };
    /** A hangar facing the runway: door on the side toward it. */
    const hangar = (ca: number, cx: number, side: number) => {
      const la = 22 + r() * 10, lx = 16 + r() * 6, h = 5.5 + r() * 1.5;
      box(ca, cx, la, lx, h, WALLS[Math.floor(r() * WALLS.length)], 2 + r(), ROOFS[Math.floor(r() * ROOFS.length)]);
      // The door: a dark panel on the runway-facing wall.
      const x = cx - side * (lx / 2 + 0.05);
      for (const [a, z] of [[ca - la * 0.4, 0], [ca + la * 0.4, 0], [ca + la * 0.4, h * 0.85], [ca - la * 0.4, 0], [ca + la * 0.4, h * 0.85], [ca - la * 0.4, h * 0.85]]) put(solid, a, x, z, DOOR);
    };
    const L = f.length / 2, W = f.width / 2;

    if (f.kind === 'sealed') {
      rect(-L, L, -W, W, 0.09, ASPHALT);
      // Edge lines, and a dashed centreline between the designators.
      for (const side of [-1, 1]) rect(-L, L, side * (W - 0.9), side * (W - 0.45), 0.1, PAINT);
      for (let a = -L + 75; a + 30 < L - 75; a += 50) rect(a, a + 30, -0.25, 0.25, 0.1, PAINT);
      // Each end: threshold bars, then the designator read from the approach.
      for (const end of [0, 1] as const) {
        const dir = end === 0 ? 1 : -1;
        const at = (d: number) => dir * (-L + d);
        for (let k = 0; k < 3; k++) {
          for (const side of [-1, 1]) {
            const x = side * (2.25 + k * 3);
            rect(Math.min(at(6), at(36)), Math.max(at(6), at(36)), x - 0.75, x + 0.75, 0.1, PAINT);
          }
        }
        const id = f.ids[end];
        const H = 9, Wd = 4.5, T = 1;
        for (let i = 0; i < id.length; i++) {
          // Digit i, left to right as the pilot on approach reads it (right = +across for the low end).
          const cx = (i - (id.length - 1) / 2) * 6;
          const seg = (a0: number, a1: number, x0: number, x1: number) => {
            // a: up the digit (toward the far end), x: to the right, both from the digit's lower-left corner.
            const A0 = at(48 + a0), A1 = at(48 + a1);
            const X0 = dir * (cx - Wd / 2 + x0), X1 = dir * (cx - Wd / 2 + x1);
            rect(Math.min(A0, A1), Math.max(A0, A1), Math.min(X0, X1), Math.max(X0, X1), 0.1, PAINT);
          };
          for (const sgm of DIGITS[id[i]] ?? '') {
            if (sgm === 'a') seg(H - T, H, 0, Wd);
            if (sgm === 'b') seg(H / 2, H, Wd - T, Wd);
            if (sgm === 'c') seg(0, H / 2, Wd - T, Wd);
            if (sgm === 'd') seg(0, T, 0, Wd);
            if (sgm === 'e') seg(0, H / 2, 0, T);
            if (sgm === 'f') seg(H / 2, H, 0, T);
            if (sgm === 'g') seg(H / 2 - T / 2, H / 2 + T / 2, 0, Wd);
          }
        }
      }
      // Taxiway to a small apron on the right of the runway, hangars behind the apron.
      const ap = (r() - 0.5) * L * 0.6;
      rect(ap - 6, ap + 6, W, W + 28, 0.05, APRON);
      rect(ap - 35, ap + 35, W + 28, W + 58, 0.05, APRON);
      hangar(ap - 18, W + 78, 1);
      if (r() < 0.7) hangar(ap + 18, W + 78, 1);
    } else {
      // The mown strip is the ground shader's (terrainMaterial fieldAt); white markers along both edges and across
      // each end.
      for (let a = -L; a <= L + 1e-6; a += f.length / Math.round(f.length / 75)) {
        for (const side of [-1, 1]) box(a, side * (W + 0.5), 2.5, 0.6, 0.35, MARKER);
      }
      for (const end of [-1, 1]) for (const x of [-W + 3, -W / 3, W / 3, W - 3]) box(end * L, x, 0.6, 2.5, 0.35, MARKER);
      hangar((r() - 0.5) * L * 0.5, W + 35, 1);
    }
  }

  for (const [part, mat, name] of [[flat, flatMat, 'airfield-ground'], [solid, solidMat, 'airfield-buildings']] as const) {
    if (part.pos.length === 0) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(part.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(part.col, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.castShadow = part === solid;
    group.add(mesh);
  }
  solidMat.side = THREE.DoubleSide;
  flatMat.side = THREE.DoubleSide;
  return { group, materials: [flatMat, solidMat] };
}
