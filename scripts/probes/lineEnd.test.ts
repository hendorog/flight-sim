// lineEnd (round T): a line's last samples, its end, and the lake water at them. LE_SEED, LE_LINE, LE_N (samples).
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('line end', () => {
  setWorldSeed(Number(env.LE_SEED ?? 99991));
  terrainHeight(0, 0);
  const r = hydrology.rivers![Number(env.LE_LINE ?? 642)];
  const mask = hydrology.lakeMask!;
  const m = r.north.length;
  console.log(`line ${env.LE_LINE} kind ${r.kind} end ${r.end} joins ${r.joins} samples ${m} A ${r.area?.[m - 1]?.toFixed(1)}`);
  for (let i = Math.max(0, m - Number(env.LE_N ?? 12)); i < m; i++) console.log(`  ${i} ${r.north[i].toFixed(0)},${r.east[i].toFixed(0)} lvl ${r.level[i].toFixed(1)} lake ${mask.at(r.north[i], r.east[i]).toFixed(1)}`);
  setWorldSeed(0);
});
