// Probe (sea-level rivers): a seeded world's build time, min of RT_ROUNDS builds per seed (setWorldSeed, model cells
// handed over after the first, as the cache does). RT_SEEDS.
import { it } from 'vitest';
import { setWorldSeed } from '../../src/world/worldSeed';
import { provideSeededModel, seededModel } from '../../src/world/terrain/heightfield';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('build time', () => {
  for (const seed of (env.RT_SEEDS ?? '1,42,777777').split(',')) {
    let best = Infinity;
    for (let r = 0; r < Number(env.RT_ROUNDS ?? 3); r++) {
      setWorldSeed(0);
      provideSeededModel(r > 0 ? seededModel() : null);
      const t = performance.now();
      setWorldSeed(seed);
      const ms = performance.now() - t;
      if (r > 0) best = Math.min(best, ms);
      provideSeededModel(seededModel());
    }
    console.log(`seed ${seed}: build ${best.toFixed(0)} ms`);
  }
  setWorldSeed(0);
});
