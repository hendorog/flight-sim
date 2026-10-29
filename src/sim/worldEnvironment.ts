// The flight model's view of the world: the terrain module's heightfield with the airport's paved surfaces
// layered on top, the live weather (atmosphere + wind field) from src/physics/environment.
//
// Pure (no DOM, no WebGL), so node tests fly the real aircraft against exactly this environment.

import type { Vec3 } from '../core/math';
import type { SurfaceType, WeatherSettings } from '../core/types';
import { createEnvironment, type SimEnvironment, type TerrainProvider } from '../physics';
import { airportSurface } from '../world/airport/layout';
import { airfieldSurface } from '../world/airfields';
import { RUNWAY_HEIGHT, TAXIWAY_HEIGHT } from '../world/airport/pavement';
import { isPresent, era } from '../world/era/eraState';
import { makeSample, sampleTerrain, terrainHeight, terrainNormal, terrainSurface } from '../world/terrain/heightfield';

// Deep Time: an era with no airport ('flats') has neither the pavement surface nor its lift: the ground is the
// terrain (terrainSurface gives the era's flat surface inside the airport zone). Read per call (era is boot data,
// never at module load); the present day takes today's code verbatim.
const noAirport = (): boolean => !isPresent() && era().world.airport === 'flats';

const scratch = makeSample();
/** terrainSurface, with the era's flat surface ('dirt') inside the flat airport zone (the terrain gives 'grass' there). */
function flatsSurface(north: number, east: number): SurfaceType {
  const t = terrainSurface(north, east);
  if (t !== 'grass') return t;
  return sampleTerrain(north, east, scratch).airportBlend === 0 ? era().world.flatSurface : t;
}

/**
 * Ground under a horizontal NED position as the wheels feel it: the drawn pavement is raised above the
 * flat airfield (runway +9 cm, taxiways and apron +5 cm, to avoid z-fighting), so the contact height
 * follows it and the tyres sit on the painted surface instead of a few centimetres inside it.
 */
export const worldTerrain: TerrainProvider = {
  height(north: number, east: number): number {
    if (noAirport()) return terrainHeight(north, east);
    const paved = airportSurface(north, east) ?? airfieldSurface(north, east);
    const h = terrainHeight(north, east);
    return paved === 'runway' ? h + RUNWAY_HEIGHT : paved === 'taxiway' ? h + TAXIWAY_HEIGHT : h;
  },
  normal(north: number, east: number): Vec3 {
    return terrainNormal(north, east);
  },
  surface(north: number, east: number): SurfaceType {
    if (noAirport()) return flatsSurface(north, east);
    return airportSurface(north, east) ?? airfieldSurface(north, east) ?? terrainSurface(north, east);
  },
};

/** The Environment for the simulator. `weather` must be the live object the UI edits (it is read on every call). */
export function createWorldEnvironment(weather: WeatherSettings, seed = 1): SimEnvironment {
  return createEnvironment({ weather, terrain: worldTerrain, seed });
}
