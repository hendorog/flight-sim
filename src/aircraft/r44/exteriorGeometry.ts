// R44 detail helpers. All coordinates are FRD metres; these visual estimates do not supply physics.
import * as THREE from 'three';
import type { FRD } from '../../render/aircraft/airframe/types';
import { frd, gridGeometry } from '../../render/aircraft/geometry';

/** Supplied by the shared renderer, so geometry leaves do not load another aircraft's default loft. */
export type R44SkinWidth = (x: number, z: number) => number;

export function r44DetailMaterials() {
  const make = (name: string, color: number, roughness: number, metalness = 0) =>
    new THREE.MeshStandardMaterial({ name: `r44${name}`, color, roughness, metalness });
  return {
    paint: make('DetailPaint', 0xefefe9, 0.32), red: make('DetailRed', 0x971822, 0.34),
    metal: make('DetailMetal', 0x969d9f, 0.36, 0.65), cast: make('HeadGrey', 0x939b9e, 0.46, 0.30),
    dark: make('DetailDark', 0x25282b, 0.7), rubber: make('Rubber', 0x121519, 0.88),
    leather: make('Upholstery', 0x45433e, 0.85), stitch: make('Stitch', 0x70695c, 0.9),
  };
}
export type R44DetailMaterials = ReturnType<typeof r44DetailMaterials>;

/** A shallow patch conforming to the cabin; prevents louvers/placards floating beside the curved skin. */
export function skinPatch(width: R44SkinWidth, side: number, front: number, rear: number,
  top: number, bottom: number, offset = 0.003): THREE.BufferGeometry {
  return gridGeometry({ rows: 17, cols: 9, flip: side < 0,
    position(i, j, out) {
      const x = THREE.MathUtils.lerp(front, rear, i / 16), z = THREE.MathUtils.lerp(top, bottom, j / 8);
      frd(x, side * (width(x, z) + offset), z, out);
    },
    uv(i, j, out) { out.set(side < 0 ? i / 16 : 1 - i / 16, 1 - j / 8); },
  });
}

export function skinPath(width: R44SkinWidth, side: number, outline: readonly (readonly [number, number])[],
  offset = 0.004): FRD[] {
  const path: FRD[] = [];
  for (let i = 0; i < outline.length - 1; i++) {
    const a = outline[i], b = outline[i + 1];
    for (let j = 0; j < 8; j++) {
      const x = THREE.MathUtils.lerp(a[0], b[0], j / 8), z = THREE.MathUtils.lerp(a[1], b[1], j / 8);
      path.push([x, side * (width(x, z) + offset), z]);
    }
  }
  const [x, z] = outline[outline.length - 1];
  path.push([x, side * (width(x, z) + offset), z]);
  return path;
}

export function ellipsoid(centre: FRD, radii: FRD): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 20, 12);
  g.scale(radii[1], radii[2], radii[0]);
  return g.translate(...frd(...centre).toArray());
}
