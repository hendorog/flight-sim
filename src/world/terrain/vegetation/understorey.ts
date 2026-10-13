// Deep Time, increment 2 (WP0a contract, FROZEN names; WP6 owns the contents): the era's understorey.
//
// PART 1, the far speckle (ships): UNDERSTOREY_SPECKLE_GLSL, spliced into the terrain material's splat
// (terrainMaterial.ts fragmentSplat) right after the ground layers (grass / meadow, mud, ash and sand) and before
// the edge shade, rock and snow, outside the present day only and unless ?eraoff=speckle. It may darken / tint
// acc.albedo (and acc.rough / acc.slope) with cycad rosettes and fern clumps. In scope there: tP, tXZ, tN, tUp, tH,
// tDist, tBio (vBiome), vRiver (signed distance from the river centreline, half-width), landW (the meadow weight,
// after the Flats mud: tMudL under STRIP_MUD),
// grassW, tMarshW (MARSH_CHANNEL), sandW, forestW, the noise samples nA..nD / sB..sD, runwayLocal(tXZ) (the Flats
// strip), hash2f, and ERA_TERRAIN_UNIFORMS_GLSL's uniforms. UNDERSTOREY_HEAD_GLSL goes in the fragment head (after
// the volcano helpers) for its functions. Both empty: nothing is emitted (the stub).
//
// PART 2, the near layer (stretch): createUnderstorey returns an EraLayer (world/terrain/eraLayers.ts) - one
// instanced draw of cycads / tree ferns near the camera - or null. TerrainSystem builds it (through createEraLayers)
// only when era().flora !== 'present'; it is not built when ?eraoff=understorey.

import type { EraLayer, EraLayerContext } from '../eraLayers';

export const UNDERSTOREY_HEAD_GLSL = '';
export const UNDERSTOREY_SPECKLE_GLSL = '';

/** The near understorey layer (stub: none). */
export function createUnderstorey(_ctx: EraLayerContext): EraLayer | null {
  return null;
}
