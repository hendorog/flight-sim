// Probe: sampleTerrain cost in mountain country only (8 x 8 km windows round the gully probe's mountain sites), min of
// COST_REPS runs of 200k samples per window: costMin's world-wide grid is mostly gentler ground.
import { it } from 'vitest';
import { makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('cost mountain', () => {
  const reps = Number(process.env.COST_REPS ?? 5);
  const wins: Array<[number, number, number]> = [[42, -23664, 71632], [42, -44992, -9504], [777777, -20752, -20992], [777777, -104992, 37248]];
  for (const [seed, cn, ce] of wins) {
    setWorldSeed(seed);
    const s = makeSample();
    let best = Infinity, acc = 0;
    for (let rep = 0; rep < reps; rep++) {
      const N = 200000; const t0 = performance.now();
      for (let i = 0; i < N; i++) acc += sampleTerrain(cn - 4000 + (i % 400) * 20.03, ce - 4000 + Math.floor(i / 400) * 16.01, s).ground;
      best = Math.min(best, ((performance.now() - t0) * 1000) / N);
    }
    console.log(`COSTMTN seed ${seed} ${cn},${ce}: min ${best.toFixed(3)} us/sample (${acc.toFixed(0)})`);
  }
  setWorldSeed(0);
});
