// Organic map: the wet crossings of every reach-middle transect (out/om/reaches-s<seed>.json), +-1500 m every 2 m:
// for each run of wet points on one line, its offset range, line, arc at the hit and the line's length.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { readFileSync(p: string, e: string): string; writeFileSync(p: string, d: string): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('om braid', () => {
  const OUT = env.OM_OUT ?? 'out/om';
  const S = makeSample();
  const hit = { dist: Infinity, side: 0, line: -1, kind: 0, index: 0, s: 0, level: 0, halfWidth: 0, gradient: 0, steepness: 0, regime: 0, speed: 0, dirN: 0, dirE: 0 };
  for (const seed of (env.OM_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = hydrology.rivers!;
    const RC = JSON.parse(fs.readFileSync(`${OUT}/reaches-s${seed}.json`, 'utf8')) as { li: number; k: number; n: number; e: number; dn: number; de: number }[];
    const out: unknown[] = [];
    for (const r of RC) {
      const nn = r.de, ne = -r.dn;
      const runs: number[][] = [];
      let cur: number[] | null = null;
      for (let o = -1500; o <= 1500; o += 2) {
        const qn = r.n + nn * o, qe = r.e + ne * o;
        hydrology.queryFlow!(qn, qe, hit as never);
        let wet = hit.line >= 0 && hit.dist <= hit.halfWidth;
        if (wet) { sampleTerrain(qn, qe, S); wet = S.ground < hit.level; }
        if (wet && cur && cur[2] === hit.line && o - cur[1] <= 4) cur[1] = o;
        else if (wet) { cur = [o, o, hit.line, Math.round(hit.s), Math.round(L[hit.line].s[L[hit.line].s.length - 1])]; runs.push(cur); }
      }
      out.push({ li: r.li, k: r.k, runs });
    }
    fs.writeFileSync(`${OUT}/braid-s${seed}.json`, JSON.stringify(out));
    console.log(`seed ${seed}: ${out.length} transects`);
  }
  setWorldSeed(0);
});
