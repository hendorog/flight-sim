// Round V B (items 1-2): the ponds the streams' traces fill (streams.ts trace, fill and spill), per seed: place, level,
// spill, breach allowance, the water it spills into, bottom, depth, raster points, and whether it is a backwater (its
// level the water it spills into, over its spill less the allowance) or a fill (its spill less the allowance).
//   FP_SEEDS=1,42,777777,7 npx vitest run --config scripts/probes/vitest.config.ts filledPonds --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('filled ponds', () => {
  for (const sd of (env.FP_SEEDS ?? '1,42,777777,7').split(',').map(Number)) {
    setWorldSeed(sd);
    terrainHeight(0, 0);
    const r = hydrology.streamReport as unknown as { filledPonds?: number[]; pondsUndone?: number };
    const pools = (hydrology.lakeMask as unknown as { pools: unknown[] }).pools;
    const f = r.filledPonds ?? [];
    let back = 0, km2 = 0, big = 0;
    const rows: string[] = [];
    for (let i = 0; i < f.length; i += 10) {
      const [id, cells, lv, W, n, e, allow, into, bottom, wet] = f.slice(i, i + 10);
      if (id >= pools.length) continue;
      const bw = into >= W - allow;
      if (bw) back++;
      km2 += wet * 0.0625;
      if (wet * 0.0625 > 3) big++;
      rows.push(`FP ${sd} pond ${id} ${n},${e} points ${cells} wet ${wet} (${(wet * 0.0625).toFixed(2)} km2) level ${lv.toFixed(1)} spill ${W.toFixed(1)} allowance ${allow.toFixed(1)} into ${Number.isFinite(into) ? into.toFixed(1) : '-'} bottom ${bottom.toFixed(1)} depth ${(lv - bottom).toFixed(1)} ${bw ? 'backwater' : 'fill'}`);
    }
    console.log(`FP ${sd} TOTAL ponds ${rows.length} (backwater ${back}), ${km2.toFixed(1)} km2, over 3 km2 ${big}; taken back ${r.pondsUndone ?? 0}`);
    for (const x of rows) console.log(x);
  }
  setWorldSeed(0);
});
