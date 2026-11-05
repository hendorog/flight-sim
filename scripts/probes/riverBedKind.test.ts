// Probe (verifier): river ribbons hanging over the drawn ground. streamGround compares the river level with
// naturalHeight; this one compares it with sampleTerrain ground (what the tiles draw) under the centreline and beside it.
//   SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts riverBed --silent=false --disable-console-intercept
// River water over its own bed / banks as sampleTerrain draws it (not naturalHeight): for every 3rd river point
// outside lakes and the sea, the river surface minus the ground at the centreline, and minus the lowest ground
// 1.5 half-widths + 30 m to either side (the banks). Counts of points hanging > 5/10/30 m.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { AIRPORT } from '../../src/core/world';
it('river bed by kind', () => {
  const KIND = process.env.RB_KIND === undefined ? -1 : Number(process.env.RB_KIND);
  for (const seed of (process.env.SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const s = makeSample();
    const rivers: any[] = (hydrology as any).rivers ?? [hydrology.river];
    let n = 0; const bed = [0, 0, 0, 0], bank = [0, 0, 0, 0]; let worst = 0, at = '', worstB = 0, atB = '';
    let near = 0, nearBad = 0, nearWorst = 0, nearAt = '';
    const rc = AIRPORT.runway.center;
    const tops: Array<[number, string]> = [];
    for (const r of rivers) for (let k = 1; k < r.north.length - 1; k += 3) {
      if (KIND >= 0 && (r.kind ?? 0) !== KIND) continue;
      const pn = r.north[k], pe = r.east[k];
      sampleTerrain(pn, pe, s);
      if (s.standing > s.ground + 0.05 && s.standing > 0.5) continue; // in a lake / sea
      if (s.ground < 0.5) continue;
      n++;
      const L = r.level[k];
      const d = L - s.ground;
      [5, 10, 30, 100].forEach((t, i) => { if (d > t) bed[i]++; });
      if (d > worst) { worst = d; at = `${pn.toFixed(0)},${pe.toFixed(0)}`; }
      const dn = r.north[k + 1] - r.north[k - 1], de = r.east[k + 1] - r.east[k - 1];
      const len = Math.hypot(dn, de) || 1;
      const off = 1.5 * r.halfWidth[k] + 30;
      let lo = Infinity;
      for (const sg of [-1, 1]) { sampleTerrain(pn - (de / len) * off * sg, pe + (dn / len) * off * sg, s); lo = Math.min(lo, s.standing > s.ground + 0.05 && s.standing > 0.5 ? s.standing : Math.max(s.ground, s.river)); }
      const b = L - lo;
      [2, 10, 30, 100].forEach((t, i) => { if (b > t) bank[i]++; });
      if (b > worstB) { worstB = b; atB = `${pn.toFixed(0)},${pe.toFixed(0)} (level ${L.toFixed(0)}, bank ${lo.toFixed(0)}, hw ${r.halfWidth[k].toFixed(0)})`; }
      if (b > 10) tops.push([b, `${(pn / 1000).toFixed(1)},${(pe / 1000).toFixed(1)}`]);
      if (Math.hypot(pn - rc.north, pe - rc.east) < 30000) { near++; if (b > 10) nearBad++; if (b > nearWorst) { nearWorst = b; nearAt = `${pn.toFixed(0)},${pe.toFixed(0)}`; } }
    }
    const pc = (v: number) => (100 * v / Math.max(1, n)).toFixed(2);
    tops.sort((a, b) => b[0] - a[0]);
    const seen = new Set<string>(); const spots: string[] = [];
    for (const [b, w] of tops) { const key = w.split(',').map((v) => Math.round(Number(v) / 2)).join(','); if (seen.has(key)) continue; seen.add(key); spots.push(`${b.toFixed(0)}@${w}`); if (spots.length >= 10) break; }
    console.log(`RIVERBED seed ${seed}: ${n} river pts; surface over centreline ground >5/10/30/100 m: ${bed.map(pc).join('/')} % (worst ${worst.toFixed(0)} at ${at}); over lower bank >2/10/30/100 m: ${bank.map(pc).join('/')} % (worst ${worstB.toFixed(0)} at ${atB})`);
    console.log(`  within 30 km of home: ${near} pts, ${nearBad} hang >10 m over a bank (worst ${nearWorst.toFixed(0)} at ${nearAt}); worst spots (km): ${spots.join(' ')}`);
  }
  setWorldSeed(0);
});
