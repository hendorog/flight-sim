// Probe: where a seeded world's build time goes (drainage, lakes, network) - per seed, after a warm-up build.
import { it } from 'vitest';
import { buildDrainage, LakeMask } from '../../src/world/terrain/drainage';
import { naturalHeight, naturalHeightCoarse } from '../../src/world/terrain/heightfield';
import { buildNetworkHydrology, networkLakes } from '../../src/world/terrain/riverNetwork';
import { setWorldSeed } from '../../src/world/worldSeed';
it('build time', () => {
  for (const seed of (process.env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    let t = performance.now();
    setWorldSeed(seed);
    const world = performance.now() - t;
    t = performance.now();
    const d = buildDrainage(naturalHeightCoarse, naturalHeight);
    const td = performance.now() - t;
    t = performance.now();
    const lakes = networkLakes(d);
    const mask = new LakeMask(d);
    const tl = performance.now() - t;
    t = performance.now();
    buildNetworkHydrology(naturalHeight, d, lakes, mask);
    const tn = performance.now() - t;
    console.log(`seed ${seed}: world ${world.toFixed(0)} ms; drainage ${td.toFixed(0)}, lakes ${tl.toFixed(0)}, network ${tn.toFixed(0)} ms`);
  }
  setWorldSeed(0);
});
