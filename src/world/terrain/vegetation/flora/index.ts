// Tree species per era (Deep Time). Owned by the flora package (WP2).
//
// An era's trees occupy the SAME four slots as today's (index-aligned with placement.ts SPECIES: spruce 0,
// pine 1, oak 2, birch 3), so SPECIES_COUNT, uSpeciesTint[4], the 2x2 impostor quadrants, the 4-rect foliage
// atlas, TREE_STRIDE, TREE_BOUND_RADIUS and CANOPY_HEIGHT are unchanged. The present set is today's trees;
// the present code paths (treeModels.ts, placement.ts, foliageTexture.ts, treeMaterials.ts) stay
// byte-identical in what they produce and do not consult this table.
//
// Consumers pick FLORA[era().flora] at call time:
//   placement.ts       buildTreeCellEra: habitats and the height ranges below (worker side)
//   treeModels.ts      the builders by slot key, the shadow proxies from `proxy`, the tints
//   foliageTexture.ts  the era atlas (scale-leaf spray, broad leaf, bark, palm fan + fibre in the same 4 rects)
//
// Pure data (no three.js): the workers import it through placement.ts.

import type { FloraId } from '../../../era/types';

/** Slots per flora set: placement.ts SPECIES_COUNT (asserted in tests/era/eraState.test.ts). */
export const FLORA_SLOTS = 4;

/**
 * A solid of the shadow caster (treeModels.ts createShadowProxies), in tree heights: a cone from y0 to y1 of
 * base radius rx, or an ellipsoid centred at (0, y0, 0) with radii (rx, ry, rx).
 */
export interface ProxyPart {
  readonly kind: 'cone' | 'ellipsoid';
  readonly y0: number;
  readonly y1: number;
  readonly rx: number;
}

export interface FloraSlot {
  /** Stable key of the species, e.g. 'spruce', 'araucaria' (treeModels.ts picks the builder by it). */
  readonly key: string;
  /** Display name. */
  readonly name: string;
  /** Conifer-like crown (scale-leaf / needle atlas rect, darker bluer tint) rather than broadleaf. */
  readonly conifer: boolean;
  /** Tree heights placement gives this species, m [min, max]. */
  readonly height: readonly [number, number];
  /** Foliage tint (linear multipliers on the atlas colour; uSpeciesTint). */
  readonly tint: readonly [number, number, number];
  /** Shadow caster: crown solids plus a trunk [top, base radius], in tree heights. */
  readonly proxy: { readonly crown: readonly ProxyPart[]; readonly trunk: readonly [number, number] };
}

export interface FloraSet {
  readonly id: FloraId;
  /** Exactly FLORA_SLOTS species, index-aligned with placement.ts SPECIES. */
  readonly slots: readonly [FloraSlot, FloraSlot, FloraSlot, FloraSlot];
}

// Today's trees, described (the present code paths use their own literals, which these mirror).
const PRESENT_FLORA: FloraSet = Object.freeze({
  id: 'present',
  slots: Object.freeze([
    {
      key: 'spruce',
      name: 'Norway spruce',
      conifer: true,
      height: [3.5, 28],
      tint: [0.8, 0.88, 0.95],
      proxy: { crown: [{ kind: 'cone', y0: 0.12, y1: 0.97, rx: 0.17 }], trunk: [0.2, 0.014] },
    },
    {
      key: 'pine',
      name: 'Scots pine',
      conifer: true,
      height: [10.5, 28],
      tint: [1.0, 0.92, 0.82],
      proxy: { crown: [{ kind: 'ellipsoid', y0: 0.76, y1: 0.1275, rx: 0.1785 }], trunk: [0.72, 0.018] },
    },
    {
      key: 'oak',
      name: 'Oak',
      conifer: false,
      height: [3.5, 22],
      tint: [0.92, 0.95, 0.95],
      proxy: { crown: [{ kind: 'ellipsoid', y0: 0.62, y1: 0.255, rx: 0.289 }], trunk: [0.5, 0.03] },
    },
    {
      key: 'birch',
      name: 'Birch',
      conifer: false,
      height: [3.5, 22],
      tint: [1.08, 1.12, 0.92],
      proxy: { crown: [{ kind: 'ellipsoid', y0: 0.64, y1: 0.272, rx: 0.1445 }], trunk: [0.5, 0.012] },
    },
  ] as const),
});

// Late Cretaceous Laramidia (~67 Ma). Heights are tuned to the terrain's unchanged 10 m canopy shell (the
// forest floor raised under closed forest): the lowland broadleaf canopy averages about the present one.
// For an ellipsoid, y0 is the centre and y1 the vertical radius.
const CRETACEOUS_FLORA: FloraSet = Object.freeze({
  id: 'cretaceous',
  slots: Object.freeze([
    {
      // Araucarian conifer (Araucarioxylon/Agathis-like): a tall bare bole, flat tiers of ropy scale-leaf
      // branches and an umbrella top. Uplands and slopes.
      key: 'araucaria',
      name: 'Araucarian conifer',
      conifer: true,
      height: [18, 28],
      tint: [0.48, 0.58, 0.62],
      proxy: {
        crown: [
          { kind: 'ellipsoid', y0: 0.84, y1: 0.1, rx: 0.24 },
          { kind: 'ellipsoid', y0: 0.66, y1: 0.1, rx: 0.17 },
        ],
        trunk: [0.9, 0.024],
      },
    },
    {
      // Taxodioid swamp conifer (Glyptostrobus/Taxodium-like): a buttressed, flared base and a narrow
      // conical crown of feathery sprays. Riverbanks and marsh.
      key: 'taxodioid',
      name: 'Swamp cypress',
      conifer: true,
      height: [16, 26],
      tint: [0.78, 0.88, 0.76],
      proxy: { crown: [{ kind: 'cone', y0: 0.33, y1: 0.95, rx: 0.18 }], trunk: [0.5, 0.032] },
    },
    {
      // Platanoid / magnolialean broadleaf: the angiosperms dominated Hell Creek's lowland forest.
      key: 'platanoid',
      name: 'Platanoid broadleaf',
      conifer: false,
      height: [10, 18],
      tint: [0.86, 0.92, 0.56],
      proxy: { crown: [{ kind: 'ellipsoid', y0: 0.6, y1: 0.22, rx: 0.27 }], trunk: [0.42, 0.03] },
    },
    {
      // Sabalites fan palm: a fibrous trunk and a round head of costapalmate fronds. Lone trees and clumps on
      // the open floodplain, and with the cypresses along the river.
      key: 'sabal',
      name: 'Sabalites fan palm',
      conifer: false,
      height: [8, 15],
      tint: [1.0, 1.02, 0.70],
      proxy: { crown: [{ kind: 'ellipsoid', y0: 0.7, y1: 0.1, rx: 0.26 }], trunk: [0.68, 0.03] },
    },
  ] as const),
});

export const FLORA: Readonly<Record<FloraId, FloraSet>> = Object.freeze({
  present: PRESENT_FLORA,
  cretaceous: CRETACEOUS_FLORA,
});
