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
  /** River bank silt and gravel, lighter end of the bank mix (multiplied by the gravel detail). */
  readonly mudLight: string;
  /** River bed under the shallows. */
  readonly riverBed: string;
  /** Rough bankside vegetation strip along the river, the two ends of its mix, and the pale reed beds. */
  readonly bankRoughA: string;
  readonly bankRoughB: string;
  readonly reeds: string;
  /** Thin ground cover above the tree line (`meadow` in the alpine zone). */
  readonly alpine: string;
  /** Scree and broken rock base. */
  readonly scree: string;
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
  mudLight: 'vec3(0.075, 0.068, 0.055)',
  riverBed: 'vec3(0.034, 0.031, 0.025)',
  bankRoughA: 'vec3(0.040, 0.060, 0.022)',
  bankRoughB: 'vec3(0.075, 0.078, 0.036)',
  reeds: 'vec3(0.11, 0.105, 0.05)',
  alpine: 'vec3(0.072, 0.074, 0.040)',
  scree: 'vec3(0.15, 0.145, 0.135)',
  canopyBroadleaf: 'vec3(0.9, 0.92, 0.86)',
  canopyConifer: 'vec3(0.56, 0.62, 0.62)',
  seaAtten: 'vec3(0.46, 0.085, 0.07)',
  seaBodyDeep: 'vec3(0.0035, 0.013, 0.021)',
  seaBodyShallow: 'vec3(0.012, 0.03, 0.026)',
  riverAtten: 'vec3(1.25, 0.95, 1.05)',
  riverBody: 'vec3(0.030, 0.034, 0.021)',
});

/**
 * Late Cretaceous Laramidia, ~67 Ma. No grass before the Cenozoic: the open ground is fern prairie with
 * horsetail and low herbaceous angiosperms, a muted olive (drier and browner where it thins); red-brown
 * laterite where the cover is sparse; warmer sedimentary strata; a tea- and silt-brown river and a greener,
 * siltier shelf sea; darker conifer stands and fresher angiosperm (platanoid, magnolia) woods.
 */
const CRETACEOUS_PALETTE: TerrainPalette = Object.freeze({
  meadowWet: 'vec3(0.040, 0.044, 0.022)',
  meadowDry: 'vec3(0.092, 0.074, 0.036)',
  floor: 'vec3(0.034, 0.036, 0.020)',
  // Unused while the airport zone is the Flats (STRIP_MUD); fern cover in case an era keeps an airfield.
  turfA: 'vec3(0.034, 0.062, 0.026)',
  turfB: 'vec3(0.066, 0.068, 0.034)',
  rockA: 'vec3(0.108, 0.088, 0.068)',
  rockB: 'vec3(0.205, 0.168, 0.128)',
  strataTintA: 'vec3(0.88, 0.84, 0.80)',
  strataTintB: 'vec3(1.14, 1.02, 0.88)',
  sand: 'vec3(0.31, 0.27, 0.20)',
  snow: 'vec3(0.74, 0.76, 0.80)',
  mud: 'vec3(0.060, 0.046, 0.030)',
  mudLight: 'vec3(0.095, 0.078, 0.056)',
  riverBed: 'vec3(0.042, 0.034, 0.024)',
  bankRoughA: 'vec3(0.034, 0.046, 0.024)',
  bankRoughB: 'vec3(0.066, 0.068, 0.036)',
  reeds: 'vec3(0.088, 0.088, 0.044)',
  alpine: 'vec3(0.070, 0.066, 0.040)',
  scree: 'vec3(0.150, 0.135, 0.118)',
  canopyBroadleaf: 'vec3(0.60, 0.72, 0.50)',
  canopyConifer: 'vec3(0.36, 0.44, 0.44)',
  seaAtten: 'vec3(0.42, 0.10, 0.13)',
  seaBodyDeep: 'vec3(0.0045, 0.016, 0.016)',
  seaBodyShallow: 'vec3(0.016, 0.036, 0.024)',
  riverAtten: 'vec3(0.95, 1.35, 2.3)',
  riverBody: 'vec3(0.048, 0.036, 0.019)',
});

/**
 * Ground colours that exist only outside the present day (emitted only when !isPresent(), under the capability
 * defines of terrainMaterial.ts): the marsh channel, bare soil showing through sparse cover and the Flats.
 * GLSL vec3 text, linear albedo.
 */
export interface EraGroundPalette {
  /** Bare soil where the ground cover is sparse (laterite in the Cretaceous). */
  readonly soil: string;
  /** Marsh cover (MARSH_CHANNEL): horsetail brakes, and the darker wet ground between them. */
  readonly marsh: string;
  readonly marshWet: string;
  /** The Flats (STRIP_MUD): dry mud plates, the cracks between them, and the trampled game trail. */
  readonly mudFlat: string;
  readonly mudCrack: string;
  readonly trail: string;
}

export const ERA_GROUND: Readonly<Record<PaletteId, EraGroundPalette | null>> = Object.freeze({
  present: null,
  cretaceous: Object.freeze({
    soil: 'vec3(0.120, 0.070, 0.045)',
    marsh: 'vec3(0.056, 0.062, 0.030)',
    marshWet: 'vec3(0.026, 0.032, 0.020)',
    mudFlat: 'vec3(0.118, 0.098, 0.060)',
    mudCrack: 'vec3(0.045, 0.034, 0.024)',
    trail: 'vec3(0.070, 0.056, 0.040)',
  }),
});

export const PALETTES: Readonly<Record<PaletteId, TerrainPalette>> = Object.freeze({
  present: PRESENT_PALETTE,
  cretaceous: CRETACEOUS_PALETTE,
});
