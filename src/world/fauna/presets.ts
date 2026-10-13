// Fauna performance presets per render quality (Deep Time), like TerrainSystem's PRESETS. FaunaSystem allocates
// every buffer at FAUNA_MAX (the ultra row) in init() and only changes counts when the quality changes.
//
// Budget (plan "fauna" section): fauna CPU <= 0.4 ms/frame on high, <= 200k fauna triangles, <= 200
// terrainHeight calls per frame, <= 1 habitat cell (<= 40 terrain samples) per frame, zero per-frame allocations.
//
// Pure data.

import type { QualityLevel } from '../../core/context';

export interface FaunaPreset {
  /** Ground animals drawn at most (all herd species together). */
  groundVisible: number;
  /** Flyers simulated and drawn at most. */
  flyers: number;
  /** Herds are streamed in around the camera to this distance, m (and released 15% beyond it). */
  activeRadius: number;
  /** Ground animals use LOD0 nearer than this, LOD1 nearer than lod1Range, LOD2 to lod2Range; none beyond, m. */
  lod0Range: number;
  lod1Range: number;
  lod2Range: number;
  /** LOD0 instances at most per species; further near animals fall to LOD1. */
  lod0Max: number;
  /** LOD0 animals that also cast a shadow, at most per species (0 = no fauna shadows). */
  casters: number;
}

export const FAUNA_PRESETS: Readonly<Record<QualityLevel, FaunaPreset>> = Object.freeze({
  low: { groundVisible: 120, flyers: 8, activeRadius: 4000, lod0Range: 250, lod1Range: 1500, lod2Range: 5000, lod0Max: 20, casters: 0 },
  medium: { groundVisible: 250, flyers: 16, activeRadius: 6000, lod0Range: 300, lod1Range: 2000, lod2Range: 6000, lod0Max: 40, casters: 8 },
  high: { groundVisible: 500, flyers: 24, activeRadius: 8000, lod0Range: 400, lod1Range: 2500, lod2Range: 7000, lod0Max: 60, casters: 16 },
  ultra: { groundVisible: 900, flyers: 32, activeRadius: 10000, lod0Range: 500, lod1Range: 3000, lod2Range: 8000, lod0Max: 100, casters: 32 },
});

/** The allocation maximum (the ultra row): buffers sized to this never reallocate on a quality change. */
export const FAUNA_MAX: FaunaPreset = FAUNA_PRESETS.ultra;

/** Flyers are silhouetted against the sky, so they draw out to this multiple of the LOD2 range. */
export const FLYER_RANGE_FACTOR = 1.2;

/** Simulated ground animals at most (more than are drawn: herds behind the camera keep living). */
export const MAX_GROUND_ANIMALS = 1200;
/** Herds alive at once at most. */
export const MAX_HERDS = 24;
/** Members per herd at most. */
export const MAX_HERD_SIZE = 80;
/** terrainHeight-equivalent calls per frame at most, over everything the fauna does. */
export const TERRAIN_CALLS_PER_FRAME = 200;
