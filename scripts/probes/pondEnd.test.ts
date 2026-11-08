// Streams ending in a lake: whether the lake mask holds their last point (with and without the drawn ground).
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('pond end', () => {
  setWorldSeed(env.PE_SEED ?? '1');
  const m = hydrology.lakeMask!;
  for (const li of (env.PE_LINES ?? '').split(',').map(Number)) {
    const r = hydrology.rivers![li];
    const k = r.north.length - 1;
    const a = m.at(r.north[k], r.east[k]);
    const b = m.at(r.north[k], r.east[k], terrainHeight(r.north[k], r.east[k]));
    const ri = Math.round((r.north[k] + 160000) / 250), rj = Math.round((r.east[k] + 160000) / 250);
    console.log(`PE ${li} poolAt ${m.poolAt(ri, rj)} pools ${m.pools.length} end ${r.end} n ${r.north.length} last ${r.north[k].toFixed(0)},${r.east[k].toFixed(0)} lvl ${r.level[k].toFixed(1)} ground ${terrainHeight(r.north[k], r.east[k]).toFixed(1)} mask ${a} maskG ${b}; prev ${r.north[k - 1].toFixed(0)},${r.east[k - 1].toFixed(0)}`);
  }
});
