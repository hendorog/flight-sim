// Round T repairs, item 2: the (line, pool) pairs where a line's water runs more than DC_X m under a lake's or pond's
// surface inside its domain: how long, how deep, whether the line ends there, enters more than once, and whether the
// pool is a pond the stream pass made (report.ponds) or a drainage lake.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('drown cases', () => {
  const X = Number(env.DC_X ?? 3);
  for (const seed of (env.DC_SEEDS ?? '1').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = hydrology.rivers!;
    const mask = hydrology.lakeMask! as unknown as { at(n: number, e: number): number; poolHit: number; pools: Array<{ level: number }> };
    const rep = hydrology.streamReport as unknown as { ponds?: number[] };
    const pondSet = new Set<number>();
    for (let i = 0; i < (rep.ponds ?? []).length; i += 2) pondSet.add(rep.ponds![i]);
    const cases = new Map<string, { li: number; pool: number; len: number; deep: number; entries: number; endsIn: boolean; kind: number; end: string }>();
    let byKind = { endPond: 0, endLake: 0, thruPond: 0, thruLake: 0 };
    for (let li = 0; li < L.length; li++) {
      const r = L[li];
      const n = r.north.length;
      let prevPool = -1;
      for (let i = 0; i < n; i++) {
        const lv = mask.at(r.north[i], r.east[i]);
        const pool = lv > -Infinity ? mask.poolHit : -1;
        if (pool >= 0 && lv - r.level[i] > X) {
          const key = `${li}:${pool}`;
          const c = cases.get(key) ?? { li, pool, len: 0, deep: 0, entries: 0, endsIn: false, kind: r.kind, end: String(r.end ?? '-') };
          c.len += i > 0 ? r.s[i] - r.s[i - 1] : 0;
          c.deep = Math.max(c.deep, lv - r.level[i]);
          if (prevPool !== pool) c.entries++;
          if (i === n - 1) c.endsIn = true;
          cases.set(key, c);
        }
        prevPool = pool;
      }
    }
    const all = [...cases.values()].sort((a, b) => b.len - a.len);
    for (const c of all) {
      const pond = pondSet.has(c.pool);
      const k = c.endsIn ? (pond ? 'endPond' : 'endLake') : pond ? 'thruPond' : 'thruLake';
      byKind[k as keyof typeof byKind] += c.len;
    }
    console.log(`seed ${seed}: ${all.length} (line, pool) pairs with water > ${X} m under the surface; km by case: ends in a pond ${(byKind.endPond / 1000).toFixed(2)}, ends in a lake ${(byKind.endLake / 1000).toFixed(2)}, through a pond ${(byKind.thruPond / 1000).toFixed(2)}, through a lake ${(byKind.thruLake / 1000).toFixed(2)}`);
    for (const c of all.slice(0, Number(env.DC_TOP ?? 25))) console.log(`  ${c.kind ? 'stream' : 'river'} ${c.li} (end ${c.end}) in ${pondSet.has(c.pool) ? 'pond' : 'lake'} ${c.pool} (level ${mask.pools[c.pool].level.toFixed(1)}): ${c.len.toFixed(0)} m, up to ${c.deep.toFixed(1)} m under, ${c.entries} entr${c.entries === 1 ? 'y' : 'ies'}, ${c.endsIn ? 'ends in it' : 'runs through'}`);
  }
  setWorldSeed(0);
});
