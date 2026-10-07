// Public surface of the terrain module.
export { TerrainSystem, TERRAIN_MAX_DISTANCE, type TerrainSystemOptions } from './TerrainSystem';
export {
  terrainHeight,
  terrainNormal,
  terrainSurface,
  sampleTerrain,
  makeSample,
  snowLine,
  hydrology,
  SEA_LEVEL,
  type TerrainSample,
} from './heightfield';
