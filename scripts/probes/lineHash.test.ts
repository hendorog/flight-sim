// Probe (Round W S): a hash of a seeded world's lines (every river's and stream's north, east, level, halfWidth) and of
// its terrain on a coarse grid, so a speed-up can be shown to build the same world value for value.
//   LH_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts lineHash
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const fnv = (h: number, x: number): number => {
  const b = new Float64Array([x]);
  const u = new Uint32Array(b.buffer);
  for (const w of u) for (let k = 0; k < 4; k++) h = Math.imul(h ^ ((w >>> (8 * k)) & 255), 16777619) >>> 0;
  return h;
};
it('line hash', () => {
  for (const seed of (env.LH_SEEDS ?? '42').split(',').map(Number)) {
    const t0 = performance.now();
    setWorldSeed(seed);
    const ms = performance.now() - t0;
    const L = (hydrology.rivers ?? []) as unknown as Array<{ north: Float64Array; east: Float64Array; level: Float64Array; halfWidth: Float64Array }>;
    let h = 2166136261;
    let n = 0;
    for (const r of L) for (const k of ['north', 'east', 'level', 'halfWidth'] as const) for (let i = 0; i < r[k].length; i++) (h = fnv(h, r[k][i])), n++;
    let t = 2166136261;
    for (let i = -150000; i <= 150000; i += 7500) for (let j = -150000; j <= 150000; j += 7500) t = fnv(t, terrainHeight(i + 37, j + 11));
    console.log(`LH seed ${seed}: lines ${L.length} values ${n} hash ${h.toString(16)} terrain ${t.toString(16)} build ${(ms / 1000).toFixed(1)} s`);
  }
  setWorldSeed(0);
});
