// Round T repairs 2: how deep the streams run under the ground the airfields shape. Every stream (kind 1) within a
// generated field's reach (or the home field's approaches: heightfield.ts nearField's rule), every FB_STEP m: its water
// against the drawn ground at its centre and at hw + 3 / hw + 12 m either side. Lengths where the water is hidden (centre
// ground over it), where the lower bank at hw + 3 stands over the water by > 2.5 / > 4 m (a deep cut), and where the
// lower ground at hw + 12 stands over it by > 4 / > 7 m (a gully), per seed (FB_SEEDS); the worst lines.
import { it } from 'vitest';
import { hydrology, terrainHeight, sampleTerrain, makeSample } from '../../../../src/world/terrain/heightfield';
import { generatedAirfields } from '../../../../src/world/airfields';
import { setWorldSeed } from '../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('field banks', () => {
  const s = makeSample();
  const ST = Number(env.FB_STEP ?? 10);
  for (const seed of (env.FB_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const fields = generatedAirfields();
    const L = hydrology.rivers!;
    const tot = { reach: 0, hidden: 0, bank25: 0, bank4: 0, gully4: 0, gully7: 0 };
    const per: Array<{ li: number; f: string; reach: number; bank4: number; gully7: number; worst: number; at: string }> = [];
    L.forEach((r, li) => {
      if (r.kind !== 1) return;
      const m = r.s.length;
      let fName = '';
      const near = (n: number, e: number): boolean => {
        for (const f of fields) {
          const reach = f.length / 2 + f.approachLength + f.blend;
          if ((n - f.north) ** 2 + (e - f.east) ** 2 <= reach * reach) { fName = f.code; return true; }
        }
        return false;
      };
      const row = { li, f: '', reach: 0, bank4: 0, gully7: 0, worst: 0, at: '' };
      for (let sv = 0; sv <= r.s[m - 1]; sv += ST) {
        let i = 0;
        while (i < m - 2 && r.s[i + 1] < sv) i++;
        const fr = Math.min(1, Math.max(0, (sv - r.s[i]) / ((r.s[i + 1] - r.s[i]) || 1)));
        const n = r.north[i] + fr * (r.north[i + 1] - r.north[i]), e = r.east[i] + fr * (r.east[i + 1] - r.east[i]);
        if (!near(n, e)) continue;
        row.f = fName;
        const W = r.level[i] + fr * (r.level[i + 1] - r.level[i]);
        const hw = r.halfWidth[i];
        const tn0 = r.north[i + 1] - r.north[i], te0 = r.east[i + 1] - r.east[i];
        const tl = Math.hypot(tn0, te0) || 1, tn = tn0 / tl, te = te0 / tl;
        const g = (d: number) => { sampleTerrain(n + te * d, e - tn * d, s); return s; };
        const C = g(0);
        if (C.standing > W) continue;
        const cg = C.ground;
        const b3 = Math.min(g(-(hw + 3)).ground, g(hw + 3).ground) - W;
        const b12 = Math.min(g(-(hw + 12)).ground, g(hw + 12).ground) - W;
        tot.reach += ST; row.reach += ST;
        if (cg > W + 0.05) tot.hidden += ST;
        if (b3 > 2.5) tot.bank25 += ST;
        if (b3 > 4) { tot.bank4 += ST; row.bank4 += ST; }
        if (b12 > 4) tot.gully4 += ST;
        if (b12 > 7) { tot.gully7 += ST; row.gully7 += ST; }
        if (b12 > row.worst) { row.worst = b12; row.at = `${n.toFixed(0)},${e.toFixed(0)} s ${sv}`; }
      }
      if (row.reach > 0) per.push(row);
    });
    console.log(`seed ${seed}: streams in a field's reach ${tot.reach} m; water hidden ${tot.hidden} m; lower bank at hw+3 over the water > 2.5 m ${tot.bank25} m, > 4 m ${tot.bank4} m; lower ground at hw+12 over it > 4 m ${tot.gully4} m, > 7 m ${tot.gully7} m`);
    per.sort((a, b) => b.gully7 + b.bank4 - a.gully7 - a.bank4 || b.worst - a.worst);
    for (const p of per.slice(0, Number(env.FB_TOP ?? 8))) console.log(`  line ${p.li} by ${p.f}: in reach ${p.reach} m, bank > 4 m ${p.bank4} m, gully > 7 m ${p.gully7} m, worst hw+12 ${p.worst.toFixed(1)} m at ${p.at}`);
  }
  setWorldSeed(0);
});
