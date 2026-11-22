// Checker A4p: the generated airfields of a seed (code, place), to diff two trees. CK_SEEDS.
import { it } from 'vitest';
import { terrainHeight } from '../../src/world/terrain/heightfield';
import { generatedAirfields } from '../../src/world/airfields';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('fields', () => {
  for (const seed of (env.CK_SEEDS ?? '7').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    for (const f of generatedAirfields()) console.log(`AF seed ${seed} ${f.code} ${f.north.toFixed(0)},${f.east.toFixed(0)} elev ${(f as unknown as { elevation?: number }).elevation?.toFixed?.(0) ?? '-'}`);
  }
  setWorldSeed(0);
});
