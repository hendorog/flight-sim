// Orography worker: solves mountain-wave tiles (physics/weather/orography/tileSolve.ts) off the main thread for
// orographyPrefetch.ts. The setup message carries the era, world seed and town site, as the terrain workers' does
// (world/terrain/terrainWorker.ts), so terrainHeight here returns what the main thread's does. Results are posted
// with their buffers transferred.

import { setEra } from '../../world/era/eraState';
import { setTownSite } from '../../world/terrain/townMask';
import { provideSeededModel, setSnowShift, terrainGenerationTag, terrainHeight } from '../../world/terrain/heightfield';
import { setWorldSeed } from '../../world/worldSeed';
import { setTerrainTag, tileTerrainOf } from '../../physics/weather/orography/orographyField';
import { detachableSolution, solutionBuffers, solveTile } from '../../physics/weather/orography/tileSolve';
import type { OrographyJob, OrographyReply } from './orographyPrefetch';
import type { WorkerSetup } from '../../world/terrain/terrainWorker';

setTerrainTag(terrainHeight, terrainGenerationTag);

self.onmessage = (e: MessageEvent<OrographyJob | WorkerSetup>) => {
  const m = e.data;
  if (m.kind === 'setup') {
    setEra(m.era);
    setSnowShift(m.snowShift ?? 0);
    provideSeededModel(m.model ?? null);
    setWorldSeed(m.seed);
    setTownSite(m.town);
    return;
  }
  const t0 = performance.now();
  const terrain = tileTerrainOf(terrainHeight, m.ti, m.tj);
  const terrainMs = performance.now() - t0;
  const sol = detachableSolution(solveTile(terrain, m.ww));
  const reply: OrographyReply = { id: m.id, key: m.key, sol, terrainMs };
  (self as unknown as Worker).postMessage(reply, solutionBuffers(sol));
};
