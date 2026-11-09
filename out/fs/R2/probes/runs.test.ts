// Round T repairs 2: every stream's runs through a lake's domain (LakeMask) that it leaves again (seeds RN_SEEDS): the
// run's samples and length, the lake's level, the line's water just before it comes in and just after it leaves, how
// many samples on to its end; those leaving more than RN_BELOW m under the lake's level listed (the AT_THE_SURFACE
// LEAVE_BELOW rule's cases). Run on a tree before AT_THE_SURFACE (out/fs/trees/R1), the levels as traced.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('runs', () => {
  const B = Number(env.RN_BELOW ?? 1);
  for (const seed of (env.RN_SEEDS ?? '1,42,777777,7').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = hydrology.rivers!;
    const mask = hydrology.lakeMask! as unknown as { at(n: number, e: number): number; poolHit: number };
    const rows: string[] = [];
    let n = 0;
    L.forEach((r, li) => {
      if (r.kind !== 1) return;
      const m = r.north.length;
      let i = 0;
      const x = r as unknown as { pool?: number };
      if ((x.pool ?? -1) >= 0) while (i < m && mask.at(r.north[i], r.east[i]) > -Infinity) i++;
      let wasIn = i > 0;
      for (; i < m; i++) {
        const lv = mask.at(r.north[i], r.east[i]);
        const pool = mask.poolHit;
        const inside = lv > -Infinity;
        if (inside && !wasIn) {
          let e = i;
          while (e + 1 < m && mask.at(r.north[e + 1], r.east[e + 1]) > -Infinity) e++;
          if (e + 1 < m && r.level[e + 1] < lv - B) {
            n++;
            rows.push(`  line ${li} pool ${pool} lake ${lv.toFixed(2)}: in at i ${i} (s ${r.s[i].toFixed(0)}) to i ${e} (${(r.s[e] - r.s[i]).toFixed(0)} m, ${e - i + 1} samples); water before ${i > 0 ? r.level[i - 1].toFixed(2) : '-'}, in ${r.level[i].toFixed(2)}..${r.level[e].toFixed(2)}, after ${r.level[e + 1].toFixed(2)} (${(lv - r.level[e + 1]).toFixed(1)} m under); ${m - 1 - e} samples on to its end`);
          }
        }
        wasIn = inside;
      }
    });
    console.log(`seed ${seed}: stream runs through a lake left more than ${B} m under its level: ${n}`);
    for (const r of rows) console.log(r);
  }
  setWorldSeed(0);
});
