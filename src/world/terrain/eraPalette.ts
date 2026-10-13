// Terrain and water colours per era (Deep Time). Owned by the terrain look (WP1 fills the Cretaceous entry and
// substitutes these into terrainMaterial.ts / water.ts); WP0 created it with the present entry and the
// Cretaceous one aliased to it.
//
// Every entry is GLSL expression TEXT (a vec3 literal), not numbers: the present strings are today's literals
// copied byte for byte, so substituting them leaves the present shader text identical by construction (no float
// formatting risk; tests/era/eraState.test.ts checks each present string occurs in today's patched shader, and
// tests/era/presentGuard.test.ts pins the shader text). Values are linear albedo (or 1/m attenuation for water).
//
// Consumers pick PALETTES[era().palette]. Keys may be added (additively, with the present literal) by the owner;
// a present value must never differ from the shader literal it replaces.
//
// Pure (no three.js): node tests read it.

import type { PaletteId } from '../era/types';

export interface TerrainPalette {
  /** Meadow / ground cover, wet end of the dryness mix (terrainMaterial FRAGMENT_SPLAT `meadow`). */
  readonly meadowWet: string;
  /** Meadow / ground cover, dry end of the dryness mix. */
  readonly meadowDry: string;
  /** Forest floor under the near trees (`floorCol`). */
  readonly floor: string;
  /** Airfield turf inside the fence, the two ends of its mix (`turf`). */
  readonly turfA: string;
  readonly turfB: string;
  /** Rock base albedo, the two ends of its mix (`base` of the rock layer). */
  readonly rockA: string;
  readonly rockB: string;
  /** Strata band tint, the two ends of its mix (`tint` of the bedding bands). */
  readonly strataTintA: string;
  readonly strataTintB: string;
  /** Beach sand. */
  readonly sand: string;
  /** Snow. */
  readonly snow: string;
  /** Bare wet ground at the river banks (`mud`, dry end of its first mix). */
  readonly mud: string;
  /** Canopy shell stand tint: broadleaf and conifer ends of its mix. */
  readonly canopyBroadleaf: string;
  readonly canopyConifer: string;
  /** water.ts FRAGMENT_MAIN, sea and lakes: attenuation (1/m) and the deep / shallow body colours. */
  readonly seaAtten: string;
  readonly seaBodyDeep: string;
  readonly seaBodyShallow: string;
  /** water.ts FRAGMENT_MAIN, river (#ifdef RIVER): attenuation (1/m) and body colour. */
  readonly riverAtten: string;
  readonly riverBody: string;
}

/** Today's literals, byte for byte. */
const PRESENT_PALETTE: TerrainPalette = Object.freeze({
  meadowWet: 'vec3(0.038, 0.072, 0.020)',
  meadowDry: 'vec3(0.105, 0.098, 0.045)',
  floor: 'vec3(0.036, 0.042, 0.022)',
  turfA: 'vec3(0.046, 0.084, 0.028)',
  turfB: 'vec3(0.078, 0.092, 0.038)',
  rockA: 'vec3(0.098, 0.089, 0.075)',
  rockB: 'vec3(0.19, 0.174, 0.148)',
  strataTintA: 'vec3(0.86, 0.86, 0.86)',
  strataTintB: 'vec3(1.08, 1.04, 0.98)',
  sand: 'vec3(0.38, 0.33, 0.24)',
  snow: 'vec3(0.74, 0.76, 0.80)',
  mud: 'vec3(0.045, 0.040, 0.030)',
  canopyBroadleaf: 'vec3(0.9, 0.92, 0.86)',
  canopyConifer: 'vec3(0.56, 0.62, 0.62)',
  seaAtten: 'vec3(0.46, 0.085, 0.07)',
  seaBodyDeep: 'vec3(0.0035, 0.013, 0.021)',
  seaBodyShallow: 'vec3(0.012, 0.03, 0.026)',
  riverAtten: 'vec3(1.25, 0.95, 1.05)',
  riverBody: 'vec3(0.030, 0.034, 0.021)',
});

export const PALETTES: Readonly<Record<PaletteId, TerrainPalette>> = Object.freeze({
  present: PRESENT_PALETTE,
  // STUB (WP0): aliased to the present day until WP1 authors the fern prairie, laterite, warm strata, tea/silt
  // river and greener shelf sea.
  cretaceous: PRESENT_PALETTE,
});
