import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createMaterials, forInstancing } from '../../src/world/airport/materials';
import { createSharedUniforms } from '../../src/world/airport/shared';
import { makeBuildingTextures } from '../../src/world/airport/textures';
import { createProps } from '../../src/world/airport/props';
import { createLandside } from '../../src/world/airport/landside';

// three.js keys a program on USE_INSTANCING and on the side being drawn. A material shared by an InstancedMesh and
// a plain Mesh, or a transparent DoubleSide material drawn in two passes, is re-keyed (getParameters, cache key,
// garbage) on every draw of every frame.
describe('airport materials', () => {
  const mats = createMaterials(makeBuildingTextures(1), createSharedUniforms());
  const objects: THREE.Object3D[] = [...createProps(mats).meshes, ...createLandside(mats, 1, new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()).meshes];
  const instanced = new Set<THREE.Material>();
  const plain = new Set<THREE.Material>();
  const all: THREE.Material[] = [];
  for (const root of objects) {
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        (o instanceof THREE.InstancedMesh ? instanced : plain).add(m);
        all.push(m);
      }
    });
  }

  it('never shares a material between an InstancedMesh and a plain Mesh', () => {
    expect(instanced.size).toBeGreaterThan(0);
    for (const m of instanced) expect(plain.has(m)).toBe(false);
  });

  it('draws transparent double-sided materials in a single pass', () => {
    const doubleTransparent = all.filter((m) => m.transparent && m.side === THREE.DoubleSide);
    expect(doubleTransparent.length).toBeGreaterThan(0); // the fence fabric
    for (const m of doubleTransparent) expect(m.forceSinglePass).toBe(true);
  });

  it('gives instanced users one cached clone that keeps the shader patch and program key', () => {
    const a = forInstancing(mats.paint);
    expect(a).not.toBe(mats.paint);
    expect(forInstancing(mats.paint)).toBe(a);
    expect(a.onBeforeCompile).toBe(mats.paint.onBeforeCompile);
    expect(a.customProgramCacheKey()).toBe(mats.paint.customProgramCacheKey());
  });
});
