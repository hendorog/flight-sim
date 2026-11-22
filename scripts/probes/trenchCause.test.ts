// Probe: why river points are cut deep below the natural ground: the coarse (macro) ground over the water, or the
// gullies and small relief on top of it.  STREAM_SEEDS=42 npx vitest run --config scripts/probes/vitest.config.ts trenchCause
import { it } from 'vitest';
import { hydrology, naturalHeight, naturalHeightCoarse, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { macroAt } from '../../src/world/terrain/seededLayout';
it('trench cause', () => {
  for (const seed of (process.env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const s = makeSample();
    let n = 0, deep = 0, coarseDeep = 0, detailBump = 0, both = 0, edge = 0, mtn = 0, mtnAll = 0, flat = 0;
    const M = { inland: 0, uplift: 0, foothill: 0, hilly: 0 };
    const lv: number[] = [];
    for (const r of hydrology.rivers!) {
      for (let k = 0; k < r.north.length; k += 3) {
        const pn = r.north[k], pe = r.east[k];
        if (hydrology.lakes.some((l) => Math.hypot(l.north - pn, l.east - pe) < l.bound)) continue;
        const g = naturalHeight(pn, pe);
        if (g < 0.5) continue;
        n++;
        sampleTerrain(pn, pe, s);
        macroAt(pn, pe, M);
        const isMtn = M.uplift > 0.25;
        if (isMtn) mtnAll++;
        if (g - s.ground <= 60) continue;
        deep++;
        if (isMtn) mtn++;
        // A trench: the water held level (under 3 m drop over the next 3 km) while the ground stands high.
        let k2 = k;
        while (k2 < r.north.length - 1 && r.s[k2] - r.s[k] < 3000) k2++;
        if (r.s[k2] - r.s[k] >= 2900 && r.level[k] - r.level[k2] < 3) flat++;
        if (Math.max(Math.abs(pn), Math.abs(pe)) > 146000) edge++;
        const gc = naturalHeightCoarse(pn, pe);
        const a = gc - r.level[k] > 50, b = g - gc > 30;
        if (a && b) both++; else if (a) coarseDeep++; else if (b) detailBump++;
        lv.push(g - s.ground);
      }
    }
    lv.sort((x, y) => x - y);
    console.log(`seed ${seed}: ${n} pts, cut >60 m ${(100 * deep / n).toFixed(1)} % (in outer 14 km ${(100 * edge / n).toFixed(1)} %): coarse ground >50 m over water only ${(100 * coarseDeep / n).toFixed(1)} %, gullies/small relief >30 m only ${(100 * detailBump / n).toFixed(1)} %, both ${(100 * both / n).toFixed(1)} %; in mountains (uplift >0.25, ${(100 * mtnAll / n).toFixed(0)} % of points) ${(100 * mtn / n).toFixed(1)} %, on a level run ${(100 * flat / n).toFixed(1)} %; cut median ${lv[lv.length >> 1]?.toFixed(0)} p90 ${lv[Math.floor(lv.length * 0.9)]?.toFixed(0)} m`);
  }
  setWorldSeed(0);
});
