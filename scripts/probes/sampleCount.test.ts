// Probe: how many routing-ground samples the streams' tracing takes (streams.ts report.samples), per seed.
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('samples', () => {
  for (const seed of [1, 42, 777777]) { setWorldSeed(seed); const r: any = hydrology.streamReport; console.log(`SAMPLES seed ${seed}: ${r.samples} raster, ${r.levelSamples} level, outlets ${r.outletSamples}, steps ${r.steps}`); }
  setWorldSeed(0);
});
