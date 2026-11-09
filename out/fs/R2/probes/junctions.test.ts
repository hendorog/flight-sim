// (Copied from out/fs/verifyR1/gates-code/probes; run with out/fs/R2/probes/vitest.config.ts.) Checker (verifyR1 gates-code): every junction (a line's last sample on the line it joins): the joining line's last water
// against the receiver's water at its nearest sample; lists the step-ups (receiver over the joining water) over JN_MIN m,
// with whether the junction lies in a lake, per seed (JN_SEEDS).
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('junctions', () => {
  const MIN = Number(env.JN_MIN ?? 2);
  for (const seed of (env.JN_SEEDS ?? '1,42,777777,7,1234,99991').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = hydrology.rivers!;
    const mask = hydrology.lakeMask!;
    const rows: string[] = [];
    let n = 0;
    L.forEach((r, li) => {
      const J = r.joins;
      if (!(J >= 0) || J >= L.length) return;
      const P = L[J];
      const m = r.north.length - 1;
      let bk = 0, bd = Infinity;
      for (let k = 0; k < P.north.length; k++) { const d = Math.hypot(P.north[k] - r.north[m], P.east[k] - r.east[m]); if (d < bd) { bd = d; bk = k; } }
      const step = P.level[bk] - r.level[m];
      if (step > MIN && bd < 60) {
        n++;
        const lv = mask.at(r.north[m], r.east[m]);
        rows.push(`  line ${li} (kind ${r.kind}) into ${J} (kind ${P.kind}) sample ${bk} at ${r.north[m].toFixed(0)},${r.east[m].toFixed(0)}: joining ${r.level[m].toFixed(2)} receiver ${P.level[bk].toFixed(2)} step up ${step.toFixed(2)} m${lv > -Infinity ? ` (in a lake at ${lv.toFixed(1)})` : ''}`);
      }
    });
    console.log(`seed ${seed}: junctions with the receiver's water over the joining water by > ${MIN} m: ${n}`);
    for (const r of rows) console.log(r);
  }
  setWorldSeed(0);
});
