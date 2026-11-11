// Probe: a checksum of every line a seeded world's hydrology holds (every typed array, every value), per seed
// (HH_SEEDS), and the build time - two trees built alike give the same sums.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('hydro hash', () => {
  for (const seed of (env.HH_SEEDS ?? '42').split(',').map(Number)) {
    const t0 = performance.now();
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const ms = performance.now() - t0;
    let h = 0;
    let n = 0;
    for (const r of hydrology.rivers as unknown as Array<Record<string, unknown>>) {
      for (const k of Object.keys(r).sort()) {
        const v = r[k];
        if (!ArrayBuffer.isView(v)) continue;
        const a = v as unknown as ArrayLike<number>;
        for (let i = 0; i < a.length; i++) {
          h = (h * 31 + Math.round(a[i] * 1000)) % 2147483647;
          n++;
        }
      }
    }
    console.log(`HH seed ${seed}: values ${n}, hash ${h}, build ${ms.toFixed(0)} ms`);
  }
  setWorldSeed(0);
});
