// The creature art behind FaunaSystem's FaunaArt seam (Deep Time): WP4's procedural species meshes
// (species/index.ts) and their animated instanced materials (faunaMaterial.ts).
//
// The instance layout is the one in types.ts (FAUNA_STRIDE 12: aInstA/B/C at 0/4/8), written by FaunaSystem; the
// channel meanings per rig are documented in species/index.ts. The materials are created here, inside
// FaunaSystem.init, which the Simulator runs before cloudShadows.scan and warmUpShaders.

import type { FaunaArt, FaunaMaterials } from './FaunaSystem';
import { createFaunaMaterials } from './faunaMaterial';
import { buildFaunaSpecies } from './species/index';

export const CREATURE_ART: FaunaArt = {
  build: (species) => buildFaunaSpecies(species),
  materials(species, set): FaunaMaterials {
    const m = createFaunaMaterials(species, set);
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
