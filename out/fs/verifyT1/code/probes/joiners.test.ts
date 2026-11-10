// Checker T1: lines joining the closed lake outlets (seed 42 line 450, seed 777777 line 431) and the last straight reach
// truncate() appended to them.
import { it } from 'vitest';
import { hydrology, terrainHeight, makeSample, sampleTerrain } from '../../../../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../../../../src/world/worldSeed';
it('joiners', () => {
  const s = makeSample();
  for (const [seed, target] of [[42, 450], [777777, 431]]) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = hydrology.rivers!;
    const T = L[target];
    console.log(`seed ${seed} line ${target}: n ${T.north.length} end ${T.end} joins ${T.joins} at ${T.north[0].toFixed(0)},${T.east[0].toFixed(0)} -> ${T.north[T.north.length - 1].toFixed(0)},${T.east[T.east.length - 1].toFixed(0)} levels ${T.level[0].toFixed(1)}..${T.level[T.level.length - 1].toFixed(1)} hw ${T.halfWidth[0].toFixed(1)}`);
    for (let li = 0; li < L.length; li++) {
      const r = L[li];
      if (r.joins !== target) continue;
      const m = r.north.length - 1;
      // the straight tail: walk back while direction is constant
      const dn = r.north[m] - r.north[m - 1], de = r.east[m] - r.east[m - 1];
      let k = m - 1;
      while (k > 0) { const an = r.north[k] - r.north[k - 1], ae = r.east[k] - r.east[k - 1]; if (Math.abs(an * de - ae * dn) > 1e-3 * Math.hypot(an, ae) * Math.hypot(dn, de)) break; k--; }
      let maxOver = -Infinity, maxUnder = -Infinity;
      for (let i = k; i <= m; i++) { sampleTerrain(r.north[i], r.east[i], s); maxOver = Math.max(maxOver, r.level[i] - s.ground); maxUnder = Math.max(maxUnder, s.ground - r.level[i]); }
      console.log(`  joiner ${li}: n ${m + 1} straight tail ${(r.s[m] - r.s[k]).toFixed(0)} m from ${r.north[k].toFixed(0)},${r.east[k].toFixed(0)} to ${r.north[m].toFixed(0)},${r.east[m].toFixed(0)}; level ${r.level[k].toFixed(1)} -> ${r.level[m].toFixed(1)}; water up to ${maxUnder.toFixed(1)} m under the drawn ground, ${maxOver.toFixed(1)} over; area end ${r.area![m].toFixed(1)}`);
    }
  }
  setWorldSeed(0);
});
