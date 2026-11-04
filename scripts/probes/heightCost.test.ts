import { it } from 'vitest';
import { naturalHeight, naturalHeightCoarse, naturalHeightRaw } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('height cost', () => {
  setWorldSeed(42);
  // 'raw': the same terrain without the erosion pass's correction (erosion.ts), timed in the same run.
  const fns = [['detail', naturalHeight], ['coarse', naturalHeightCoarse], ['raw detail', (n: number, e: number) => naturalHeightRaw(n, e, true)], ['raw coarse', (n: number, e: number) => naturalHeightRaw(n, e, false)]] as const;
  for (let rep = 0; rep < 3; rep++) {
    for (const [name, f] of fns) {
      let acc = 0; const N = 200000; const t0 = performance.now();
      for (let i = 0; i < N; i++) acc += f((i % 400) * 997 - 150000, Math.floor(i / 400) * 613 - 150000);
      console.log(`${name}: ${((performance.now() - t0) * 1000 / N).toFixed(2)} us/sample (${acc.toFixed(0)})`);
    }
  }
  setWorldSeed(0);
});
