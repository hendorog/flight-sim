// Worker cost of a rill patch (rills.ts buildRillPatch), in this thread: a cold patch (empty block cache), then a row of
// patches flown along (each reusing its neighbour's raster blocks, as the worker that builds them does), per seed.
//   RCOST_SEEDS=42,1,777777 npx vitest run --config scripts/probes/vitest.config.ts scripts/probes/rillCost.test.ts
import { it } from 'vitest';
import { setWorldSeed } from '../../src/world/worldSeed';
import { buildRillPatch, clearRillCache, RILL_PATCH } from '../../src/world/terrain/rills';

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: string): void; mkdirSync(p: string, o: object): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

const SITES: Record<number, [number, number]> = { 42: [-23664, 71632], 1: [-62512, 21712], 777777: [-104992, 37248] };

it('rill cost', () => {
  const rows: string[] = [];
  for (const seed of (env.RCOST_SEEDS ?? '42,1,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const [n, e] = SITES[seed] ?? [0, 0];
    const pi = Math.floor(e / RILL_PATCH), pj = Math.floor(n / RILL_PATCH);
    clearRillCache();
    // (One throwaway build first: JIT warm-up.)
    buildRillPatch({ pi: pi - 3, pj });
    clearRillCache();
    const fmt = (s: ReturnType<typeof buildRillPatch>['stats']): string => `total ${(s.msGround + s.msTrace + s.msLines + s.msRaster).toFixed(0)} ms (ground ${s.msGround.toFixed(0)}, trace ${s.msTrace.toFixed(0)}, lines ${s.msLines.toFixed(0)}, raster ${s.msRaster.toFixed(0)}), sampled ${((100 * s.sampled) / s.cells).toFixed(0)} % of ${s.cells}, km ${s.km.toFixed(1)}`;
    const cold = buildRillPatch({ pi, pj });
    rows.push(`s${seed} cold: ${fmt(cold.stats)}`);
    let tot = 0, k = 0;
    for (let d = 1; d <= 4; d++) {
      const r = buildRillPatch({ pi: pi + d, pj });
      rows.push(`s${seed} next ${d}: ${fmt(r.stats)}`);
      tot += r.stats.msGround + r.stats.msTrace + r.stats.msLines + r.stats.msRaster;
      k++;
    }
    rows.push(`s${seed} mean along a row: ${(tot / k).toFixed(0)} ms per patch`);
  }
  fs.mkdirSync('out/b', { recursive: true });
  fs.writeFileSync('out/b/cost.txt', rows.join('\n') + '\n');
});
