import { it } from 'vitest';
import { terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('h at', () => {
  setWorldSeed(env.H_SEED ?? '42');
  for (const p of (env.H_PTS ?? '').split(';')) { const [n, e] = p.split(',').map(Number); console.log(`H ${n},${e}: ${terrainHeight(n, e).toFixed(1)}`); }
});
