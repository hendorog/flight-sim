// Checker T1: why seed 1's pool 48 / pool 79 cycle exists (report fields).
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../../../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('loop why', () => {
  const seed = Number(env.SEED ?? 1);
  setWorldSeed(seed);
  terrainHeight(0, 0);
  const rep = (hydrology as unknown as { streamReport?: Record<string, unknown> }).streamReport ?? {};
  const L = hydrology.rivers!;
  const nR = L.filter((r) => (r.kind ?? 0) === 0).length;
  const mask = hydrology.lakeMask! as unknown as { pools: Array<{ level: number; north: number; east: number; wet: number; lake: number; spill: number; drained?: boolean }> };
  const lines = (env.LINES ?? '434,2178').split(',').map(Number);
  const pools = (env.POOLS ?? '48,79').split(',').map(Number);
  console.log(`nR ${nR}; pools total ${mask.pools.length}`);
  for (const p of pools) { const P = mask.pools[p]; console.log(`pool ${p}: level ${P.level.toFixed(2)} at ${P.north.toFixed(0)},${P.east.toFixed(0)} wet ${P.wet} lake ${P.lake} drained ${P.drained}`); }
  const ew = (rep.endWhy ?? {}) as Record<number, string>;
  for (const li of lines) {
    const r = L[li];
    const m = r.north.length - 1;
    console.log(`line ${li}: end ${r.end} joins ${r.joins} n ${m + 1} levels ${r.level[0].toFixed(1)}..${r.level[m].toFixed(1)} area ${r.area![0].toFixed(1)}..${r.area![m].toFixed(1)} hw ${r.halfWidth[0].toFixed(1)}..${r.halfWidth[m].toFixed(1)} len ${r.s[m].toFixed(0)}`);
    console.log(`   endWhy: ${ew[li] ?? '-'}`);
    const pts: string[] = [];
    for (let i = 0; i <= m; i += Math.max(1, Math.floor(m / 12))) pts.push(`${r.north[i].toFixed(0)},${r.east[i].toFixed(0)}@${r.level[i].toFixed(1)}`);
    console.log(`   course: ${pts.join(' ')}`);
  }
  console.log(`filled: ${JSON.stringify(rep.filled)}`);
  console.log(`pondWhy: ${JSON.stringify(rep.pondWhy)}`);
  console.log(`pondClosed: ${JSON.stringify(rep.pondClosed, null, 1)}`);
  console.log(`ponds: ${JSON.stringify(rep.ponds)}`);
  console.log(`pondInflow: ${rep.pondInflow}`);
  // Who else ends in / starts in those pools (by stream report not available): lines whose joins is any of LINES.
  for (let li = 0; li < L.length; li++) if (lines.includes(L[li].joins ?? -1)) console.log(`  line ${li} joins ${L[li].joins} (end ${L[li].end}) area end ${L[li].area![L[li].area!.length - 1].toFixed(1)}`);
  setWorldSeed(0);
});
