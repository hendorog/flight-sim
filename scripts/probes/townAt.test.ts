// Round V A3r: the home town's site (airport/valley.ts findTownSite, as career/sites.ts and the roads use it) per seed
// TA_SEEDS: its centre and radius.
import { it } from 'vitest';
import { terrainHeight } from '../../src/world/terrain/heightfield';
import { findTownSite } from '../../src/world/airport/valley';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('town at', () => {
  for (const seed of (env.TA_SEEDS ?? '777777').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const t = findTownSite(terrainHeight) as unknown as { north: number; east: number; radius?: number };
    console.log(`TA seed ${seed}: town at ${t.north.toFixed(0)},${t.east.toFixed(0)}${t.radius ? ` radius ${t.radius.toFixed(0)}` : ''}`);
  }
  setWorldSeed(0);
});
