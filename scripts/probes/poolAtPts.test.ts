// Round V A3r: the lake mask's pool at raster points (PA_PTS n,e;n,e...): pool id, its lake, level, drained, spill. PA_SEED.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { LAKE_RASTER, DOMAIN_HALF } from '../../src/world/terrain/drainage';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('pool at', () => {
  setWorldSeed(Number(env.PA_SEED ?? 42));
  terrainHeight(0, 0);
  const m = hydrology.lakeMask as unknown as { poolAt(a: number, b: number): number; pools: Array<{ lake: number; level: number; drained?: boolean; spill: number; wet: number }> };
  const pts = (env.PA_PTS ?? '0,0').split(';');
  if (env.PA_GRID) {
    // (PA_GRID=n,e,half,step: every raster point of a box instead, listing only the pools found.)
    const [gn, ge, gh, gs] = env.PA_GRID.split(',').map(Number);
    const seen = new Map<number, number>();
    for (let n = gn - gh; n <= gn + gh; n += gs) for (let e = ge - gh; e <= ge + gh; e += gs) {
      const id = m.poolAt(Math.round((n + DOMAIN_HALF) / LAKE_RASTER), Math.round((e + DOMAIN_HALF) / LAKE_RASTER));
      if (id >= 0) seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    for (const [id, c] of seen) console.log(`PA grid pool ${id} lake ${m.pools[id].lake} level ${m.pools[id].level.toFixed(1)} drained ${!!m.pools[id].drained} wet ${m.pools[id].wet}: ${c} points in the box`);
    if (!seen.size) console.log('PA grid: no pool in the box');
    pts.length = 0;
  }
  for (const p of pts) {
    const [n, e] = p.split(',').map(Number);
    const ri = Math.round((n + DOMAIN_HALF) / LAKE_RASTER), rj = Math.round((e + DOMAIN_HALF) / LAKE_RASTER);
    const id = m.poolAt(ri, rj);
    const P = id >= 0 ? m.pools[id] : null;
    const sp = P && P.spill >= 0 ? `${(Math.floor(P.spill / 1281) * LAKE_RASTER - DOMAIN_HALF)},${((P.spill % 1281) * LAKE_RASTER - DOMAIN_HALF)}` : '-';
    console.log(`PA ${n},${e} terrain ${terrainHeight(n, e).toFixed(1)} pool ${id}${P ? ` lake ${P.lake} level ${P.level.toFixed(1)} drained ${!!P.drained} wet ${P.wet} spill ${sp}` : ''}`);
  }
  setWorldSeed(0);
});
