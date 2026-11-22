// Probe (Round W S): a seeded world's build as a browser thread does it after the first load - its model cells, threshold
// slopes and streams' raster handed over (macroCache.ts: the model worker or the cache) - against a build that works them
// out itself; and that both build the same world (lineHash's hash).
//   HB_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts handedBuild
import { it } from 'vitest';
import { computeSeededModel, hydrology, provideSeededModel } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const fnv = (h: number, x: number): number => {
  const b = new Float64Array([x]);
  const u = new Uint32Array(b.buffer);
  for (const w of u) for (let k = 0; k < 4; k++) h = Math.imul(h ^ ((w >>> (8 * k)) & 255), 16777619) >>> 0;
  return h;
};
const hashLines = (): string => {
  const L = (hydrology.rivers ?? []) as unknown as Array<{ north: Float64Array; east: Float64Array; level: Float64Array; halfWidth: Float64Array }>;
  let h = 2166136261;
  for (const r of L) for (const k of ['north', 'east', 'level', 'halfWidth'] as const) for (let i = 0; i < r[k].length; i++) h = fnv(h, r[k][i]);
  return `${L.length} lines ${h.toString(16)}`;
};
it('handed build', () => {
  for (const seed of (env.HB_SEEDS ?? '42').split(',').map(Number)) {
    const t0 = performance.now();
    setWorldSeed(seed);
    const full = performance.now() - t0;
    const a = hashLines();
    setWorldSeed(0);
    const t1 = performance.now();
    const m = computeSeededModel(seed);
    const model = performance.now() - t1;
    setWorldSeed(0);
    provideSeededModel(m);
    const t2 = performance.now();
    setWorldSeed(seed);
    const handed = performance.now() - t2;
    const b = hashLines();
    provideSeededModel(null);
    console.log(`HB seed ${seed}: full build ${(full / 1000).toFixed(1)} s (${a}); model worker ${(model / 1000).toFixed(1)} s; build with the model handed over ${(handed / 1000).toFixed(1)} s (${b}); same world ${a === b}`);
  }
  setWorldSeed(0);
});
