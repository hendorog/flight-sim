// Probe (Round V A4'+B join): the JS heap after a seeded world's build (HJ_SEED), and the hydrology's line samples -
// a browser tab's V8 heap is capped near 4 GB.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined>; memoryUsage(): { heapUsed: number; external: number; arrayBuffers: number; rss: number } } }).process;
it('heap', () => {
  const g = globalThis as unknown as { gc?: () => void };
  const seed = Number(env.env.HJ_SEED ?? 42);
  const m0 = env.memoryUsage();
  setWorldSeed(seed);
  terrainHeight(0, 0);
  g.gc?.();
  const m1 = env.memoryUsage();
  const L = hydrology.rivers as unknown as Array<{ s: Float64Array }>;
  let n = 0;
  for (const r of L) n += r.s.length;
  console.log(`HJ seed ${seed}: heapUsed ${(m1.heapUsed / 1e9).toFixed(2)} GB (before ${(m0.heapUsed / 1e9).toFixed(2)}), arrayBuffers ${(m1.arrayBuffers / 1e9).toFixed(2)} GB, rss ${(m1.rss / 1e9).toFixed(2)} GB; lines ${L.length}, samples ${n}`);
});
