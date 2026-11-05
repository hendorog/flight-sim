// Probe: cost of a full terrain sample (sampleTerrain: natural ground, lakes, valleys, channels and streams carved)
// on a spread of points over a seeded world, as heightCost times naturalHeight.
import { it } from 'vitest';
import { makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('terrain cost', () => {
  for (const seed of (process.env.STREAM_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    const s = makeSample();
    for (let rep = 0; rep < 3; rep++) {
      let acc = 0; const N = 200000; const t0 = performance.now();
      for (let i = 0; i < N; i++) acc += sampleTerrain((i % 400) * 997 - 150000, Math.floor(i / 400) * 613 - 150000, s).ground;
      console.log(`sampleTerrain seed ${seed}: ${((performance.now() - t0) * 1000 / N).toFixed(2)} us/sample (${acc.toFixed(0)})`);
    }
  }
  setWorldSeed(0);
});
