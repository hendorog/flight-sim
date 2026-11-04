import { it } from 'vitest';
import { naturalHeight, naturalHeightCoarse } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('height cost', () => {
  setWorldSeed(42);
  for (const [name, f] of [['detail', naturalHeight], ['coarse', naturalHeightCoarse]] as const) {
    let acc = 0; const N = 200000; const t0 = performance.now();
    for (let i = 0; i < N; i++) acc += f((i % 400) * 997 - 150000, Math.floor(i / 400) * 613 - 150000);
    console.log(`${name}: ${((performance.now() - t0) * 1000 / N).toFixed(2)} us/sample (${acc.toFixed(0)})`);
  }
  setWorldSeed(0);
});
