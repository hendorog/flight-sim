// Probe (debugging): the tributaries joining river TRIB_LINE (TRIB_SEED): where each joins, its level along its last
// kilometres and the natural ground there (a tributary arriving far below its parent's ground cuts the parent down).
import { it } from 'vitest';
import { hydrology, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('trib debug', () => {
  setWorldSeed(Number(process.env.TRIB_SEED ?? 1));
  const P = Number(process.env.TRIB_LINE ?? 8);
  const rivers: any[] = (hydrology as any).rivers;
  for (let li = 0; li < rivers.length; li++) {
    const r = rivers[li];
    if (r.joins !== P) continue;
    const m = r.north.length - 1;
    const pts: string[] = [];
    for (const back of [6000, 4000, 2000, 1000, 500, 0]) {
      let k = m; while (k > 0 && r.s[m] - r.s[k] < back) k--;
      pts.push(`-${back}: lvl ${r.level[k].toFixed(0)} nat ${naturalHeight(r.north[k], r.east[k]).toFixed(0)}`);
    }
    console.log(`trib ${li} -> ${P} at (${r.north[m].toFixed(0)},${r.east[m].toFixed(0)}) len ${r.s[m].toFixed(0)} hw ${r.halfWidth[m].toFixed(0)} | ${pts.join(' | ')}`);
  }
  const r = rivers[P];
  const parts: string[] = [];
  for (let k = 0; k < r.north.length; k += 40) parts.push(`${(r.s[k] / 1000).toFixed(1)}:${r.level[k].toFixed(0)}/${naturalHeight(r.north[k], r.east[k]).toFixed(0)}`);
  console.log(`line ${P} s km: level/nat  ${parts.join(' ')}`);
  setWorldSeed(0);
});
