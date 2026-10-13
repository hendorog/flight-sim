// Triceratops: the body and the material's rig view (WP2 owns this file). The export names are fixed:
// createTriceratops() (species/index.ts FAUNA_SPECIES.triceratops.build) and TRICERATOPS_RENDER (.render).
//
// WP0b STUB: the Edmontosaurus body on the ceratopsian rig, whose pose (poses/ceratopsian.ts) is a verbatim copy of the hadrosaur
// pose until WP2 replaces both. WP2 builds an 8.5 m ceratopsian (rig 3: frill and horns rigid on the head, the beak on the jaw), with lengthM = its nose-to-tail length (the roster's
// SPECIES_REFERENCE_M sets the drawn size), and stays inside its PROFILE.render.tris budget.

import type { CreatureMeshSet, SpeciesRender } from '../types';
import { EDMONTOSAURUS_RENDER, createEdmontosaurus } from './edmontosaurus';

export function createTriceratops(): CreatureMeshSet {
  return createEdmontosaurus();
}

export const TRICERATOPS_RENDER: SpeciesRender = Object.freeze({ ...EDMONTOSAURUS_RENDER, rig: 'ceratopsian' });
