// Araucarian conifer (Late Cretaceous slot 0; flora/index.ts): a tall, straight, bare bole carrying flat
// horizontal tiers of rope-like scale-leaf branches whose tips turn up in tufts, widest two-thirds of the way
// up, under a small umbrella top. Built from the spruce whorl idea (treeModels.ts), with flattened tiers in
// place of drooping cones. Height 1 (instances scale to metres); every vertex inside TREE_BOUND_RADIUS of
// (0, 0.5, 0) (tests/terrain/eraFlora.test.ts). More branches per tier toward the top, so the umbrella closes into a dense
// flat-topped crown rather than a sparse whorl of separate sprays.

import type * as THREE from 'three';
import { mulberry32 } from '../../noise';
import { ERA_ATLAS } from '../foliageTexture';
import type { TreeKit, V3 } from '../treeModels';

/** Horizontal room inside the impostor bound at height y, less a margin for the cards' width. */
const room = (y: number): number => Math.sqrt(Math.max(0, 0.53 * 0.53 - (y - 0.5) * (y - 0.5))) - 0.05;

export function araucaria(kit: TreeKit, lod: number): THREE.BufferGeometry {
  const b = new kit.Builder();
  const rnd = mulberry32(505);
  b.limb([0, -0.02, 0], [0, 0.95, 0], 0.024, 0.005, 6, ERA_ATLAS.bark, 0.6);
  const c: V3 = [0, 0.78, 0];
  const r: V3 = [0.28, 0.2, 0.28];
  const normal = kit.crownNormal(c, r);
  const ao = kit.crownAO(c, r);
  const tiers = lod ? 7 : 11;
  for (let w = 0; w < tiers; w++) {
    const t = w / (tiers - 1);
    const y = 0.5 + 0.36 * t;
    // The umbrella: lower tiers already shed back to stubs, the widest two-thirds up, small at the top.
    const radius = Math.min(room(y), 0.1 + 0.19 * Math.sin(Math.PI * (0.22 + 0.68 * t)));
    const off = rnd() * Math.PI * 2;
    // More branches in the upper tiers (the card budget, tests/terrain/eraFlora.test.ts, caps the total).
    const sprays = (lod ? 5 : 7) + Math.round(2 * t);
    for (let k = 0; k < sprays; k++) {
      const a = off + (k / sprays) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
      const len = radius * (0.85 + 0.15 * rnd());
      // Nearly flat, the tip a little up; only a slight roll, so a tier reads as a flat layer from the side.
      const rise = 0.03 + 0.02 * rnd();
      const roll = (k % 2 === 0 ? 1 : -1) * (0.12 + 0.12 * rnd());
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const width = (0.5 * len + 0.04) * (lod ? 1.35 : 1);
      const px = -dz * Math.cos(roll) * width * 0.5;
      const py = Math.sin(roll) * width * 0.5;
      const pz = dx * Math.cos(roll) * width * 0.5;
      const tip: V3 = [dx * len, y + rise, dz * len];
      b.card([px, y + py, pz], [tip[0] + px, tip[1] + py, tip[2] + pz], [tip[0] - px, tip[1] - py, tip[2] - pz], [-px, y - py, -pz], ERA_ATLAS.needles, normal, ao);
      // The upturned tuft at the branch end (every third branch; every fourth at LOD 1).
      if (k % (lod ? 4 : 3) === 0) {
        const s = (0.07 + 0.03 * rnd()) * (lod ? 1.4 : 1);
        kit.clump(b, [tip[0] * 0.92, tip[1] + 0.25 * s, tip[2] * 0.92], s, ERA_ATLAS.needles, rnd, normal, ao);
      }
    }
  }
  // The umbrella top, closed from above.
  const tops = lod ? 3 : 6;
  for (let k = 0; k < tops; k++) {
    const a = (k / tops) * Math.PI * 2 + rnd();
    const rr = k === 0 ? 0 : 0.1;
    kit.clump(b, [Math.cos(a) * rr, 0.9 + 0.015 * rnd(), Math.sin(a) * rr], 0.09 * (lod ? 1.25 : 1), ERA_ATLAS.needles, rnd, normal, ao);
  }
  return b.build();
}
