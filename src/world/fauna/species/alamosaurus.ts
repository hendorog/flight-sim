// Alamosaurus: the body and the material's rig view (WP3 owns this file). The export names are fixed:
// createAlamosaurus() (species/index.ts FAUNA_SPECIES.alamosaurus.build) and ALAMOSAURUS_RENDER (.render).
//
// WP0b STUB: the Edmontosaurus body on the sauropod rig, whose pose (poses/sauropod.ts) is a verbatim copy of the hadrosaur
// pose until WP3 replaces both. WP3 builds a 26 m sauropod (rig 4: neck3/neck4 on wingL/wingR, BONE_ALIAS; pivots acyclic, chain depth <= 8), with lengthM = its nose-to-tail length (the roster's
// SPECIES_REFERENCE_M sets the drawn size), and stays inside its PROFILE.render.tris budget.

import type { CreatureMeshSet, SpeciesRender } from '../types';
import { EDMONTOSAURUS_RENDER, createEdmontosaurus } from './edmontosaurus';

export function createAlamosaurus(): CreatureMeshSet {
  return createEdmontosaurus();
}

export const ALAMOSAURUS_RENDER: SpeciesRender = Object.freeze({ ...EDMONTOSAURUS_RENDER, rig: 'sauropod' });
