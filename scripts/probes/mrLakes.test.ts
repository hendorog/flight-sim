// design V: every lake (hydrology.lakes ellipses) and every LakeMask pool, as JSON, to match lakes before / after by place.
//   ML_SEEDS=1,42,777777 ML_OUT=dir npx vitest run --config scripts/probes/vitest.config.ts mrLakes --silent=false --disable-console-intercept
// (Round V step 0: ported unchanged from design-V/model-rivers/prototype.patch).
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { writeFileSync, mkdirSync } from 'node:fs';
it('lakes dump', () => {
  const OUT = process.env.ML_OUT ?? 'out/mrLakes';
  mkdirSync(OUT, { recursive: true });
  for (const seed of (process.env.ML_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const mask = hydrology.lakeMask as any;
    const d = mask.d;
    const lakes = (hydrology.lakes as any[]).map((l) => ({ n: Math.round(l.north ?? l.centre?.north ?? 0), e: Math.round(l.east ?? l.centre?.east ?? 0), level: +(l.level ?? 0).toFixed(1), keys: Object.keys(l).join('|') }));
    const ponds = d.lakes.map((L: any, k: number) => {
      let n = 0, e = 0;
      for (const c of L.cells) { n += -d.origin * -1 + 0; n += 0; }
      const cn = L.cells.reduce((s: number, c: number) => s + (d.origin + Math.floor(c / d.n) * 1000), 0) / L.cells.length;
      const ce = L.cells.reduce((s: number, c: number) => s + (d.origin + (c % d.n) * 1000), 0) / L.cells.length;
      const id = mask.main[k];
      return { k, n: Math.round(cn), e: Math.round(ce), cells: L.cells.length, level: +L.level.toFixed(1), river: !!L.river, tarn: !!L.tarn, pool: id, wetKm2: id >= 0 ? +(mask.pools[id].wet * 0.0625).toFixed(2) : 0, poolLevel: id >= 0 ? +mask.pools[id].level.toFixed(1) : null };
    });
    const pools = (mask.pools as any[]).map((p: any, i: number) => ({ i, lake: p.lake, level: +p.level.toFixed(1), wetKm2: +(p.wet * 0.0625).toFixed(2) }));
    writeFileSync(`${OUT}/lakes-s${seed}.json`, JSON.stringify({ lakes, ponds, pools }));
    console.log(`seed ${seed}: lakes ${lakes.length}, ponds ${ponds.length} (dry ${ponds.filter((p: any) => p.pool < 0).length}), pools ${pools.length}`);
  }
  setWorldSeed(0);
});
