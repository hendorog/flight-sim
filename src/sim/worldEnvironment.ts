// The flight model's view of the world: the terrain module's heightfield with the airport's paved surfaces
// layered on top, the live weather (atmosphere + wind field) from src/physics/environment.
//
// Pure (no DOM, no WebGL), so node tests fly the real aircraft against exactly this environment.

import type { Vec3 } from '../core/math';
import type { SurfaceType, WeatherSettings } from '../core/types';
import { createEnvironment, type SimEnvironment, type TerrainProvider } from '../physics';
import { airportSurface } from '../world/airport/layout';
import { RUNWAY_HEIGHT, TAXIWAY_HEIGHT } from '../world/airport/pavement';
import { terrainHeight, terrainNormal, terrainSurface } from '../world/terrain/heightfield';

/**
 * Ground under a horizontal NED position as the wheels feel it: the drawn pavement is raised above the
 * flat airfield (runway +9 cm, taxiways and apron +5 cm, to avoid z-fighting), so the contact height
 * follows it and the tyres sit on the painted surface instead of a few centimetres inside it.
 */
export const worldTerrain: TerrainProvider = {
  height(north: number, east: number): number {
    const paved = airportSurface(north, east);
    const h = terrainHeight(north, east);
    return paved === 'runway' ? h + RUNWAY_HEIGHT : paved === 'taxiway' ? h + TAXIWAY_HEIGHT : h;
  },
  normal(north: number, east: number): Vec3 {
    return terrainNormal(north, east);
  },
  surface(north: number, east: number): SurfaceType {
    return airportSurface(north, east) ?? terrainSurface(north, east);
  },
};

/** The Environment for the simulator. `weather` must be the live object the UI edits (it is read on every call). */
export function createWorldEnvironment(weather: WeatherSettings, seed = 1): SimEnvironment {
  return createEnvironment({ weather, terrain: worldTerrain, seed });
}
