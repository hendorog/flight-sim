// Checker T1: the lines ending in the flagged ponds - end kind, joins, area, where.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../../../../src/world/terrain/heightfield';
import { DOMAIN_HALF, LAKE_RASTER } from '../../../../../src/world/terrain/drainage';
import { setWorldSeed } from '../../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('pond in', () => {
  for (const spec of (env.SPEC ?? '42:85,42:87,42:95,777777:73,777777:76,777777:85,7:30,7:37').split(',')) {
    const [seed, pond] = spec.split(':').map(Number);
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = hydrology.rivers!;
    const rep = (hydrology as unknown as { streamReport?: { endWhy?: Record<number, string>; filled?: number[] } }).streamReport ?? {};
    const mask = hydrology.lakeMask! as unknown as { poolAt(i: number, j: number): number; pools: Array<{ level: number }> };
    const poolOf = (n: number, e: number): number => mask.poolAt(Math.round((n + DOMAIN_HALF) / LAKE_RASTER), Math.round((e + DOMAIN_HALF) / LAKE_RASTER));
    console.log(`seed ${seed} pond ${pond} level ${mask.pools[pond].level.toFixed(1)} filled ${JSON.stringify(rep.filled)}`);
    L.forEach((r, li) => {
      if ((r.kind ?? 0) === 0) return;
      const m = r.north.length - 1;
      const pe = poolOf(r.north[m], r.east[m]), ph = poolOf(r.north[0], r.east[0]);
      if (pe !== pond && ph !== pond) return;
      console.log(`  line ${li}: ${ph === pond ? 'HEAD in' : ''} ${pe === pond ? 'END in' : ''} end ${r.end} joins ${r.joins} n ${m + 1} area ${r.area![0].toFixed(1)}..${r.area![m].toFixed(1)} level ${r.level[0].toFixed(1)}..${r.level[m].toFixed(1)} head ${r.north[0].toFixed(0)},${r.east[0].toFixed(0)} end ${r.north[m].toFixed(0)},${r.east[m].toFixed(0)} why ${rep.endWhy?.[li] ?? '-'}`);
    });
  }
  setWorldSeed(0);
});
