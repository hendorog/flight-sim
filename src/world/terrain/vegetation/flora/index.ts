// Tree species per era (Deep Time). Owned by the flora package (WP2: the four Cretaceous species and their
// builders); WP0 created it with the present set and the Cretaceous one aliased to it.
//
// An era's trees occupy the SAME four slots as today's (index-aligned with placement.ts SPECIES: spruce 0,
// pine 1, oak 2, birch 3), so SPECIES_COUNT, uSpeciesTint[4], the 2x2 impostor quadrants, the 4-rect foliage
// atlas, TREE_STRIDE, TREE_BOUND_RADIUS and CANOPY_HEIGHT are unchanged. The present set is today's trees;
// the present code paths (treeModels.ts, placement.ts, foliageTexture.ts) stay byte-identical and do not
// consult this table.
//
// Consumers pick FLORA[era().flora]. The owner may add fields to FloraSlot (builder references, height ranges,
// habitat weights), keeping the present entry describing today's trees.
//
// Pure data today (workers read it through placement.ts).

import type { FloraId } from '../../../era/types';

/** Slots per flora set: placement.ts SPECIES_COUNT (asserted in tests/era/eraState.test.ts). */
export const FLORA_SLOTS = 4;

export interface FloraSlot {
  /** Stable key of the species, e.g. 'spruce', 'araucaria'. */
  readonly key: string;
  /** Display name. */
  readonly name: string;
  /** Conifer-like crown (scale-leaf / needle atlas rect, darker bluer tint) rather than broadleaf. */
  readonly conifer: boolean;
}

export interface FloraSet {
  readonly id: FloraId;
  /** Exactly FLORA_SLOTS species, index-aligned with placement.ts SPECIES. */
  readonly slots: readonly [FloraSlot, FloraSlot, FloraSlot, FloraSlot];
}

const PRESENT_FLORA: FloraSet = Object.freeze({
  id: 'present',
  slots: Object.freeze([
    { key: 'spruce', name: 'Norway spruce', conifer: true },
    { key: 'pine', name: 'Scots pine', conifer: true },
    { key: 'oak', name: 'Oak', conifer: false },
    { key: 'birch', name: 'Birch', conifer: false },
  ] as const),
});

export const FLORA: Readonly<Record<FloraId, FloraSet>> = Object.freeze({
  present: PRESENT_FLORA,
  // STUB (WP0): aliased to the present day until WP2 adds araucaria (0), taxodioid swamp conifer (1),
  // platanoid broadleaf (2) and Sabalites fan palm (3).
  cretaceous: PRESENT_FLORA,
});
