// The creature art behind FaunaSystem's FaunaArt seam (Deep Time): WP4's procedural species meshes
// (species/index.ts) and their animated instanced materials (faunaMaterial.ts).
//
// The instance layout is the one in types.ts (FAUNA_STRIDE 12: aInstA/B/C at 0/4/8), written by FaunaSystem; the
// channel meanings per rig are documented in species/index.ts. The materials are created here, inside
// FaunaSystem.init, which the Simulator runs before cloudShadows.scan and warmUpShaders.

import type { FaunaArt, FaunaMaterials } from './FaunaSystem';
import { createFaunaMaterials } from './faunaMaterial';
import { buildFaunaSpecies } from './species/index';
import type { FaunaSpeciesId } from './types';

/**
 * Look-gate albedo lifts (Deep Time inc 2, WP8), multiplied into a species' variant tints when its materials are
 * made. The Edmontosaurus herd is the first minute's stampede, judged from the door window at 450-1300 m against the
 * olive marsh, where its inc-1 vertex palette (back 0.085/0.066/0.038, belly 0.16/0.142/0.105) measured a herd /
 * ground contrast of 1.0-1.2 against the plan's 1.3. Its vertex palette and createFaunaMaterials' tints are pinned by
 * tests/fauna/inc1Freeze.test.ts (the inc-1 creature as built), so the lift is applied here, at the seam, as a warm
 * multiplier: back ~0.11/0.083/0.043, belly ~0.21/0.18/0.12.
 */
export const ART_ALBEDO_LIFT: Readonly<Partial<Record<FaunaSpeciesId, readonly [number, number, number]>>> = Object.freeze({
  edmontosaurus: Object.freeze([1.3, 1.25, 1.12] as const),
});

export const CREATURE_ART: FaunaArt = {
  build: (species) => buildFaunaSpecies(species),
  materials(species, set): FaunaMaterials {
    const m = createFaunaMaterials(species, set);
    const lift = ART_ALBEDO_LIFT[species];
    if (lift) for (const t of m.uniforms.uVariantTint.value) t.set(t.x * lift[0], t.y * lift[1], t.z * lift[2]);
    return {
      material: m.material,
      depthMaterial: m.depth,
      setTime(t: number) {
        m.uniforms.uTime.value = t;
      },
      dispose() {
        m.material.dispose();
        m.depth.dispose();
      },
    };
  },
};
