// Probe: where a river's water stands more than 10 m over the natural ground (outside lakes), and why. For each such
// point: the river (tributary or not), how far from its mouth, whether its level there is held at its mouth's level
// (a tributary raised to its parent's level at the junction), a lake within 1.5 km, the erosion cut and the gully
// relief under it.
//   STREAM_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts overGround --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, naturalHeight, naturalHeightCoarse, naturalHeightRaw } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('over ground', () => {
  for (const seed of (process.env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const mask = hydrology.lakeMask!;
    const rivers = hydrology.rivers!;
    const pts: Array<{ over: number; line: string }> = [];
    const v = { dist: 0, level: 0, floodplain: 0 };
    let offAxis2 = 0, offAxis10 = 0;
    let n = 0, over10 = 0, flatMouth = 0, lakeNear = 0, tribEnd = 0, over2 = 0, flat2 = 0, lake2 = 0;
    rivers.forEach((r, li) => {
      const last = r.level.length - 1;
      const mouth = r.level[last];
      for (let k = 0; k < r.north.length; k += 3) {
        const pn = r.north[k], pe = r.east[k];
        if (mask.at(pn, pe) > -Infinity) continue;
        const g = naturalHeight(pn, pe);
        if (g < 0.5) continue;
        n++;
        const over = r.level[k] - g;
        if (over <= 2) continue;
        // Held at the mouth's level (a tributary raised to its parent's level, or a lake's level carried on).
        const flat = Math.abs(r.level[k] - mouth) < 0.05 && (r.joins ?? -1) >= 0;
        let near = Infinity;
        for (let a = 0; a < 16 && near > 0; a++) for (const d of [250, 500, 1000, 1500]) if (mask.at(pn + d * Math.cos(a * Math.PI / 8), pe + d * Math.sin(a * Math.PI / 8)) > -Infinity) near = Math.min(near, d);
        over2++;
        hydrology.queryValley(pn, pe, v as never);
        const off = v.dist > 200;
        if (off) offAxis2++;
        if (flat) flat2++;
        if (near < Infinity) lake2++;
        if (over <= 10) continue;
        over10++;
        if (off) offAxis10++;
        if (flat) flatMouth++;
        if (near < Infinity) lakeNear++;
        if (last - k < 30) tribEnd++;
        const coarse = naturalHeightCoarse(pn, pe), raw = naturalHeightRaw(pn, pe, true), rawC = naturalHeightRaw(pn, pe, false);
        pts.push({ over, line: `over ${over.toFixed(0)} m at ${(pn / 1000).toFixed(1)},${(pe / 1000).toFixed(1)} river ${li}${(r.joins ?? -1) >= 0 ? ` (joins ${r.joins})` : ''} ${((r.s[last] - r.s[k]) / 1000).toFixed(1)} km from its mouth: level ${r.level[k].toFixed(0)} (mouth ${mouth.toFixed(0)}${flat ? ', held' : ''}) natural ${g.toFixed(0)} coarse ${coarse.toFixed(0)} | raw ${raw.toFixed(0)} raw coarse ${rawC.toFixed(0)} (erosion cut ${(rawC - coarse).toFixed(0)}, gullies ${(g - coarse).toFixed(0)}) lake within ${near === Infinity ? '-' : near} m` });
      }
    });
    pts.sort((a, b) => b.over - a.over);
    console.log(`seed ${seed}: ${n} points; over 2 m ${over2} (held at the mouth ${flat2}, lake within 1.5 km ${lake2}); over 10 m ${over10}: held at the mouth ${flatMouth}, lake within 1.5 km ${lakeNear}, last 30 points ${tribEnd}; over 200 m off the valley axis (meander loops): ${offAxis2} of the >2 m, ${offAxis10} of the >10 m`);
    for (const p of pts.slice(0, Number(process.env.OVER_SHOW ?? 15))) console.log('  ' + p.line);
  }
  setWorldSeed(0);
});
