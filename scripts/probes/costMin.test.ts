// Probe: sampleTerrain cost per seed, min of COST_REPS runs of 200k samples (seeds COST_SEEDS).
import { it } from 'vitest';
import { makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('cost min', () => {
  const reps = Number(process.env.COST_REPS ?? 6);
  for (const seed of (process.env.COST_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const s = makeSample();
    let best = Infinity, acc = 0;
    for (let rep = 0; rep < reps; rep++) {
      const N = 200000; const t0 = performance.now();
      for (let i = 0; i < N; i++) acc += sampleTerrain((i % 400) * 997 - 150000, Math.floor(i / 400) * 613 - 150000, s).ground;
      best = Math.min(best, ((performance.now() - t0) * 1000) / N);
    }
    console.log(`COST seed ${seed}: min ${best.toFixed(3)} us/sample (${acc.toFixed(0)})`);
  }
  setWorldSeed(0);
});
