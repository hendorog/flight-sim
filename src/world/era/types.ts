// Deep Time: the era a session is set in (the present day, or a prehistoric world on the same continent).
//
// CONTRACT (WP0; the parallel packages build on it and do not change it):
//   - The era is BOOT-TIME data. It is chosen once (src/sim/eraChoice.ts: URL era=, then localStorage 'fs.era',
//     then 'present'), set with eraState.setEra() before anything era-dependent is built, and never changes while
//     the page lives: another era is a reload (SimCommands.setEra), like another aircraft. Nothing caches per era.
//   - Every thread sets it: the main thread in the Simulator constructor (right after parseParams), the terrain
//     workers from their setup message (terrainWorker.ts WorkerSetup.era) before any job, dev pages from
//     src/dev/harness.ts (?era=), node tests explicitly.
//   - Code reads it through eraState.era() / isPresent(), at construction or call time, NEVER at module load
//     (a module body runs before the shell or the harness has set the era). A present-day path must stay byte-identical to the code
//     before eras existed (tests/era/presentGuard.test.ts): branch with `if (isPresent())` keeping today's code
//     verbatim, add shader defines / uniforms / cache-key suffixes only when !isPresent(), and give new random
//     draws new hash salts.
//   - The era's data is split by owner: this file holds the scalars and flags every subsystem may read; the
//     look and the inhabitants live in subsystem-owned tables keyed by the ids below (PALETTES in
//     world/terrain/eraPalette.ts, FLORA in world/terrain/vegetation/flora/index.ts, ROSTERS in
//     world/fauna/roster.ts), so a package changes its own table without touching the others.
//
// Pure data: no three.js, no DOM; every value is structured-clone safe (workers, node tests).

import type { ScenarioId } from '../../core/context';
import type { SurfaceType, WeatherSettings } from '../../core/types';

/** The eras of increment 1. 'pleistocene' is reserved for increment 3 and deliberately not listed yet. */
export const ERA_IDS = ['present', 'cretaceous'] as const;
export type EraId = (typeof ERA_IDS)[number];

/** Key of a terrain/water colour palette (world/terrain/eraPalette.ts PALETTES). */
export type PaletteId = 'present' | 'cretaceous';
/** Key of a four-species tree set (world/terrain/vegetation/flora/index.ts FLORA). */
export type FloraId = 'present' | 'cretaceous';
/** Key of a fauna roster (world/fauna/roster.ts ROSTERS). 'none' (the present day) builds no fauna system at all. */
export type RosterId = 'none' | 'cretaceous';

/**
 * A stratovolcano cone added to the natural terrain (world/terrain/volcano.ts, WP6): an additive, flag-gated term
 * in naturalHeight placed clear of every hydrology sample point, the approach corridors and the airport blend.
 * Positions NED relative to the runway centre (core/world.ts AIRPORT), metres.
 */
export interface VolcanoSpec {
  readonly north: number;
  readonly east: number;
  /** Radius of the cone's foot, m. */
  readonly baseRadius: number;
  /** Rim height MSL, m. */
  readonly summit: number;
  readonly craterRadius: number;
  /** Depth of the crater below the rim, m. */
  readonly craterDepth: number;
}

/**
 * How the land looks and what covers it. Offsets and flags only: the SHAPE of the land (naturalHeight's literals,
 * SEA_LEVEL, the coast, valley, river, lakes, the airport flat and the hydrology singleton) is the same in every
 * era, except for the one additive volcano term.
 */
export interface EraTerrain {
  /** Added to biome.ts treeLine() and to the shader's tree-line threshold, m (present 0). */
  readonly treeLineOffset: number;
  /** Added to heightfield.ts snowLine() and to the shader's snow-line threshold, m (present 0; +6000 = no snow). */
  readonly snowLineOffset: number;
  /** Cultivated field patchwork, hedgerows and their trees (false: the farmland biome channel is 0 everywhere). */
  readonly farmland: boolean;
  /** The valley town: its land-cover clearing (TerrainSystem town option) and its buildings (AirportSystem). */
  readonly town: boolean;
  /** Reuse the farmland biome channel (aBiome.y) as marsh weight: horsetail flats on the wet floodplain. */
  readonly marsh: boolean;
  readonly volcano: VolcanoSpec | null;
}

/** The made world: airfield, training, cameras, start. */
export interface EraWorld {
  /**
   * 'modern': today's airport (pavement, buildings, lights, the pavement surface and lift in the physics).
   * 'flats': no airport at all; the flat airport zone is bare ground of `flatSurface` (AirportSystem bare mode,
   * no AirfieldGrass, worldEnvironment uses the terrain surface everywhere).
   */
  readonly airport: 'modern' | 'flats';
  /** terrainSurface() inside the flat airport zone (airportBlend === 0). Present 'grass'. */
  readonly flatSurface: SurfaceType;
  /** The Flight School exists (TrainingSystem constructed, School tab shown). */
  readonly school: boolean;
  /** The tower camera mode is offered (it stands in the airport's tower). */
  readonly towerCamera: boolean;
  /** Start scenario when the URL names none and the boot is not a resume. Absent: the usual default. */
  readonly defaultScenario?: ScenarioId;
}

export interface EraParams {
  readonly id: EraId;
  /** Display name, e.g. 'Late Cretaceous Laramidia'. */
  readonly label: string;
  /** Short age, e.g. '~67 Ma' ('' for the present). */
  readonly epoch: string;
  /** One or two sentences for the chooser and the loading screen. */
  readonly blurb: string;
  readonly terrain: EraTerrain;
  readonly palette: PaletteId;
  readonly flora: FloraId;
  readonly fauna: RosterId;
  readonly world: EraWorld;
  /**
   * Weather preset merged over defaultWeather() at boot, BEFORE the URL's weather (vis=, cover=... still win) and
   * before a resumed snapshot's weather (which wins too). cloudBaseM is MSL (windField zi = base - terrain);
   * a preset that moves the base without cloudTopM keeps the default layer depth. Present {}.
   */
  readonly weather: Readonly<Partial<WeatherSettings>>;
}
