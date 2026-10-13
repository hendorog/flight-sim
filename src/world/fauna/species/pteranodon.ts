// Pteranodon: the body and the material's rig view (WP4 owns this file). The export names are fixed:
// createPteranodon() (species/index.ts FAUNA_SPECIES.pteranodon.build) and PTERANODON_RENDER (.render).
//
// A Look-only variant on the azhdarchid rig (rig 1): WP4 builds it with azhdarchid.ts createAzhdarchidSet(look) (or
// buildAzhdarchid per LOD) and a Look with a long swept crest, and keeps AZHDARCHID_RENDER. lengthM is the
// azhdarchid span; the roster's SPECIES_REFERENCE_M (6.5 m) sets the drawn span.
//
// WP0b STUB: the small azhdarchid.

import type { CreatureMeshSet, SpeciesRender } from '../types';
import { AZHDARCHID_RENDER, createSmallAzhdarchid } from './azhdarchid';

export function createPteranodon(): CreatureMeshSet {
  return createSmallAzhdarchid();
}

export const PTERANODON_RENDER: SpeciesRender = AZHDARCHID_RENDER;
