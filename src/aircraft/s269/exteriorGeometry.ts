// Small 300CB detail helpers; FRD metres. Decoration never supplies contact/aerodynamic geometry.
import * as THREE from 'three';
import type { FRD } from '../../render/aircraft/airframe/types';
import { frd, gridGeometry } from '../../render/aircraft/geometry';
export type S269SkinWidth = (x: number, z: number) => number;
export function s269Materials() {
  const make = (name: string, color: number, roughness: number, metalness = 0) =>
    new THREE.MeshStandardMaterial({ name: `s269${name}`, color, roughness, metalness });
  return {
    paint: make('Paint', 0xedefeb, 0.34), blue: make('Blue', 0x26586a, 0.38), red: make('Red', 0xbe2e2c, 0.42),
    frame: make('Frame', 0xc4cbc6, 0.44, 0.15), metal: make('Metal', 0x9ca3a5, 0.33, 0.65),
    cast: make('Cast', 0x687378, 0.53, 0.33), dark: make('Dark', 0x252b2e, 0.73),
    rubber: make('Rubber', 0x161a1c, 0.89), leather: make('Seat', 0xa4aaa7, 0.86),
    stitch: make('Piping', 0x536773, 0.88), exhaust: make('Exhaust', 0x726253, 0.70, 0.25),
  };
}
export type S269Materials = ReturnType<typeof s269Materials>;
export function ellipsoid(centre: FRD, radii: FRD): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, 24, 16).scale(radii[1], radii[2], radii[0]).translate(...frd(...centre).toArray());
}
export function skinPath(width: S269SkinWidth, side: number, points: readonly (readonly [number, number])[], offset = 0): FRD[] {
  const out: FRD[] = [];
  for (let i = 0; i < points.length - 1; i++) for (let j = 0; j < 8; j++) {
    const x = THREE.MathUtils.lerp(points[i][0], points[i + 1][0], j / 8);
    const z = THREE.MathUtils.lerp(points[i][1], points[i + 1][1], j / 8);
    out.push([x, side * (width(x, z) + offset), z]);
  }
  const [x, z] = points[points.length - 1]; out.push([x, side * (width(x, z) + offset), z]); return out;
}
/** Side-project a texture on a rounded body. Supplied width must describe the same surface. */
export function sidePatch(width: S269SkinWidth, side: number, front: number, rear: number, top: number, bottom: number,
  centre: (x: number) => number = () => 0) {
  return gridGeometry({ rows: 25, cols: 13, flip: side < 0,
    position(i, j, out) {
      const x = THREE.MathUtils.lerp(front, rear, i / 24), z = centre(x) + THREE.MathUtils.lerp(top, bottom, j / 12);
      frd(x, side * (width(x, z) + 0.002), z, out);
    }, uv(i, j, out) { out.set(side < 0 ? i / 24 : 1 - i / 24, 1 - j / 12); },
  });
}
/** A unit cylinder positioned between two model-space points, used by rods and dampers every frame. */
const axis = new THREE.Vector3(0, 1, 0), delta = new THREE.Vector3();
export function fitRod(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
  delta.subVectors(b, a); mesh.scale.y = delta.length();
  mesh.quaternion.setFromUnitVectors(axis, delta.normalize()); mesh.position.copy(a).add(b).multiplyScalar(0.5);
}
