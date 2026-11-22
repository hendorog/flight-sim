// Probe: the same seed builds the same lakes and terrain after other seeds were built in the same process.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const print = () => {
  const s = makeSample();
  let h = 0;
  for (const l of hydrology.lakes) h = (h * 31 + Math.round(l.level * 1000) + Math.round(l.north) * 7 + Math.round(l.radiusA)) % 1e12;
  for (const p of (hydrology.lakeMask as any).pools) h = (h * 31 + Math.round(p.level * 1000) + p.wet) % 1e12;
  for (let i = 0; i < 4000; i++) { sampleTerrain((i % 63) * 2311 - 70000, Math.floor(i / 63) * 2203 - 70000, s); h = (h * 31 + Math.round(s.ground * 100) + Math.round(s.standing * 100)) % 1e12; }
  return h;
};
it('lake determinism', () => {
  const seeds = (process.env.STREAM_SEEDS ?? '1,42,777777,4242').split(',').map(Number);
  const first: Record<number, number> = {};
  for (const s of seeds) { setWorldSeed(s); first[s] = print(); }
  for (const s of seeds) { setWorldSeed(0); setWorldSeed(7); setWorldSeed(s); const again = print(); console.log(`seed ${s}: ${first[s] === again ? 'same' : 'DIFFERENT'} (${first[s]} / ${again})`); }
  setWorldSeed(0);
});
