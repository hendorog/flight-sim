// Tyrannosaurus: the body and the material's rig view (WP1 owns this file). The export names are fixed:
// createTyrannosaurus() (species/index.ts FAUNA_SPECIES.tyrannosaurus.build) and TYRANNOSAURUS_RENDER (.render).
//
// WP0b STUB: the Edmontosaurus body on the theropod rig, whose pose (poses/theropod.ts) is a verbatim copy of the hadrosaur
// pose until WP1 replaces both. WP1 builds a 12.3 m theropod (rig 2: legFL/FR are the arms, the jaw roars), with lengthM = its nose-to-tail length (the roster's
// SPECIES_REFERENCE_M sets the drawn size), and stays inside its PROFILE.render.tris budget.

import type { CreatureMeshSet, SpeciesRender } from '../types';
import { EDMONTOSAURUS_RENDER, createEdmontosaurus } from './edmontosaurus';

export function createTyrannosaurus(): CreatureMeshSet {
  return createEdmontosaurus();
}

export const TYRANNOSAURUS_RENDER: SpeciesRender = Object.freeze({ ...EDMONTOSAURUS_RENDER, rig: 'theropod' });
