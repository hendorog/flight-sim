// repKeys (round T): selected StreamReport fields per seed. RK_SEEDS, RK_KEYS (comma-separated field names).
import { it } from 'vitest';
import { hydrology, terrainHeight, fieldHeldCount } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('report keys', () => {
  for (const seed of (env.RK_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const rep = hydrology.streamReport as unknown as Record<string, unknown>;
    console.log(`seed ${seed}: fieldHeld ${fieldHeldCount()}; ${(env.RK_KEYS ?? 'barbed').split(',').map((k) => `${k} ${JSON.stringify(rep[k])}`).join('; ')}`);
  }
  setWorldSeed(0);
});
