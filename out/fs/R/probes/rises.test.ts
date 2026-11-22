// Round T repairs: lines whose water rises downstream (seededWorld's check), with the levels about the rise (RS_SEEDS).
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('rises', () => {
  for (const seed of (env.RS_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const mask = hydrology.lakeMask!;
    hydrology.rivers!.forEach((r, li) => {
      for (let k = 1; k < r.level.length; k++) if (r.level[k] > r.level[k - 1]) {
        const row: string[] = [];
        for (let q = Math.max(0, k - 3); q <= Math.min(r.level.length - 1, k + 2); q++) row.push(`${q}: ${r.level[q].toFixed(6)}${mask.at(r.north[q], r.east[q]) > -Infinity ? ` in ${mask.at(r.north[q], r.east[q]).toFixed(4)}` : ''}`);
        console.log(`seed ${seed} line ${li} (joins ${r.joins}) rises at ${k}: ${row.join(', ')}`);
      }
    });
    console.log(`seed ${seed} done; surface ${JSON.stringify((hydrology.streamReport as unknown as { surface?: unknown }).surface)}`);
  }
  setWorldSeed(0);
});
