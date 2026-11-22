// junctionGate (round T repairs, after verifyR1's junctions probe): water may not run uphill where one line joins another.
// At every junction (a line's last sample on the line it joins, within 60 m), the joining line's last water against
// the receiver's water interpolated at the point of the receiver's course nearest that sample (not its nearest sample:
// a steep receiver's samples are tens of metres apart). Counts step-ups (the receiver's water over the joining water)
// over 0.5 / 2 / 5 m, apart for junctions outside and inside a lake's domain, and lists those over JN_MIN m (default 2),
// per seed (JN_SEEDS). Rule (battery): no more than before AT_THE_SURFACE (f654e1c); a step-up in a lake is the drowned
// mouth of a blocked inflow (its water under the lake's surface on the way in), listed.
//   JN_SEEDS=1,42,777777,7,1234,99991 npx vitest run --config scripts/probes/vitest.config.ts junctionGate --silent=false
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('junctionGate', () => {
  const MIN = Number(env.JN_MIN ?? 2);
  for (const seed of (env.JN_SEEDS ?? '1,42,777777,7,1234,99991').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = hydrology.rivers!;
    const mask = hydrology.lakeMask!;
    const rows: string[] = [];
    const out = [0, 0, 0], inn = [0, 0, 0];
    L.forEach((r, li) => {
      const J = r.joins;
      if (!(J >= 0) || J >= L.length) return;
      const P = L[J];
      const m = r.north.length - 1;
      const pn = r.north[m], pe = r.east[m];
      let bd = Infinity, lev = NaN, bk = 0;
      for (let k = 0; k < P.north.length - 1; k++) {
        const an = P.north[k], ae = P.east[k];
        const dn = P.north[k + 1] - an, de = P.east[k + 1] - ae;
        const l2 = dn * dn + de * de;
        const t = l2 > 0 ? Math.min(1, Math.max(0, ((pn - an) * dn + (pe - ae) * de) / l2)) : 0;
        const d = Math.hypot(an + t * dn - pn, ae + t * de - pe);
        if (d < bd) { bd = d; lev = P.level[k] + t * (P.level[k + 1] - P.level[k]); bk = k; }
      }
      if (P.north.length === 1) { bd = Math.hypot(P.north[0] - pn, P.east[0] - pe); lev = P.level[0]; }
      if (!(bd < 60)) return;
      const step = lev - r.level[m];
      const lv = mask.at(pn, pe);
      const c = lv > -Infinity ? inn : out;
      if (step > 0.5) c[0]++;
      if (step > 2) c[1]++;
      if (step > 5) c[2]++;
      if (step > MIN) rows.push(`  line ${li} (kind ${r.kind}) into ${J} (kind ${P.kind}) at its s ${P.s[bk].toFixed(0)}, ${pn.toFixed(0)},${pe.toFixed(0)}: joining ${r.level[m].toFixed(2)} receiver ${lev.toFixed(2)} step up ${step.toFixed(2)} m${lv > -Infinity ? ` (in a lake at ${lv.toFixed(1)})` : ''}`);
    });
    console.log(`seed ${seed}: step-ups > 0.5 / 2 / 5 m: outside lakes ${out.join(' / ')}; in a lake ${inn.join(' / ')}`);
    for (const r of rows) console.log(r);
  }
  setWorldSeed(0);
});
