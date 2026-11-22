// Probe: how often a river's water stands above the ground under it (outside lakes and the sea).
//   STREAM_SEEDS=1,42 npx vitest run --config scripts/probes/vitest.config.ts streamGround
import { it } from 'vitest';
import { hydrology, naturalHeight, naturalHeightCoarse, naturalHeightRaw, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('stream ground', () => {
  for (const seed of (process.env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    const t0 = performance.now();
    setWorldSeed(seed);
    const ms = performance.now() - t0;
    const s = makeSample();
    let n = 0, over2 = 0, over10 = 0, worst = 0, km = 0, carvedDeep = 0;
    for (const r of hydrology.rivers!) {
      km += r.s[r.s.length - 1] / 1000;
      for (let k = 0; k < r.north.length; k += 3) {
        const pn = r.north[k], pe = r.east[k];
        if (hydrology.lakeMask ? hydrology.lakeMask.at(pn, pe) > -Infinity : hydrology.lakes.some((l) => Math.hypot(l.north - pn, l.east - pe) < l.bound)) continue;
        const g = naturalHeight(pn, pe);
        if (g < 0.5) continue;
        n++;
        const over = r.level[k] - g;
        if (over > 2) over2++;
        if (over > 10) over10++;
        worst = Math.max(worst, over);
        sampleTerrain(pn, pe, s);
        if (g - s.ground > 60) carvedDeep++;
      }
    }
    console.log(`seed ${seed}: ${hydrology.lakes.length} lakes, ${hydrology.rivers!.length} rivers, ${km.toFixed(0)} km; ${n} points: water >2 m over ground ${(100 * over2 / n).toFixed(2)} %, >10 m ${(100 * over10 / n).toFixed(2)} %, worst ${worst.toFixed(0)} m; cut >60 m deep ${(100 * carvedDeep / n).toFixed(2)} %; build ${ms.toFixed(0)} ms`);
  }
  setWorldSeed(0);
});
it('deep profile', () => {
  setWorldSeed(Number(process.env.STREAM_SEEDS ?? 42));
  const rs = hydrology.rivers!;
  let best = -1, bestDeep = 0;
  rs.forEach((r, li) => {
    let deep = 0;
    const skip = Number(process.env.SKIP_EDGE ?? 0);
    for (let k = 0; k < r.north.length; k += 10) if (naturalHeight(r.north[k], r.east[k]) - r.level[k] > 60 && Math.max(Math.abs(r.north[k]), Math.abs(r.east[k])) < 160000 - skip) deep++;
    if (deep > bestDeep && r.north.length < 2000) { bestDeep = deep; best = li; }
  });
  const r = rs[best];
  const n = r.north.length;
  console.log(`line ${best}: ${n} pts, ${(r.s[n - 1] / 1000).toFixed(1)} km, joins ${r.joins}`);
  for (let k = 0; k < n; k += Math.max(1, Math.floor(n / 40))) {
    const g = naturalHeight(r.north[k], r.east[k]);
    // lowest natural ground within 600 m across
    let lo = Infinity; for (let a = 0; a < 16; a++) for (const d of [150, 300, 600]) lo = Math.min(lo, naturalHeight(r.north[k] + d * Math.cos(a * Math.PI / 8), r.east[k] + d * Math.sin(a * Math.PI / 8)));
    console.log(`  s ${(r.s[k] / 1000).toFixed(1)} km at ${(r.north[k] / 1000).toFixed(1)},${(r.east[k] / 1000).toFixed(1)}: level ${r.level[k].toFixed(0)} coarse ${naturalHeightCoarse(r.north[k], r.east[k]).toFixed(0)} raw coarse ${naturalHeightRaw(r.north[k], r.east[k], false).toFixed(0)} natural ${g.toFixed(0)} lowest within 600 m ${lo.toFixed(0)} hw ${r.halfWidth[k].toFixed(0)}`);
  }
  setWorldSeed(0);
});
