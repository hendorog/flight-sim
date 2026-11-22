// Probe: a seeded world's build time per thread (setWorldSeed: noise, layout, terrain flag, erosion, drainage, rivers,
// airfields), after a warm-up build; each seed built WB_ROUNDS times (seed 0 in between).
import { it } from 'vitest';
import { setWorldSeed } from '../../src/world/worldSeed';
import '../../src/world/terrain/heightfield';
it('world build', () => {
  setWorldSeed(3);
  setWorldSeed(0);
  const seeds = (process.env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number);
  const rounds = Number(process.env.WB_ROUNDS ?? 3);
  const out: Record<number, number[]> = {};
  for (let r = 0; r < rounds; r++) for (const s of seeds) {
    const t0 = performance.now();
    setWorldSeed(s);
    (out[s] ??= []).push(performance.now() - t0);
    setWorldSeed(0);
  }
  for (const s of seeds) console.log(`world build seed ${s}: ${out[s].map((v) => v.toFixed(0)).join(' ')} ms (min ${Math.min(...out[s]).toFixed(0)})`);
});
