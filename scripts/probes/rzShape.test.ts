// Probe (sea-level rivers): where shapeLines (falls.ts) first lowers a river's channel level by over 1 m, and the
// profile there before and after (levelProbe chan / shape). RS_SEED, RS_LINES.
import { it } from 'vitest';
import { naturalHeight } from '../../src/world/terrain/heightfield';
import { levelProbe } from '../../src/world/terrain/riverNetwork';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('river zero shape', () => {
  const want = new Set((env.RS_LINES ?? '1').split(',').map(Number));
  const chan = new Map<number, { n: Float64Array; e: Float64Array; level: Float64Array }>();
  levelProbe.on = (ph, li, L) => {
    if (!want.has(li)) return;
    const { north: n, east: e, level } = L;
    if (ph === 'chan') { chan.set(li, { n: Float64Array.from(n), e: Float64Array.from(e), level: level.slice() }); return; }
    if (ph !== 'shape') return;
    const c = chan.get(li)!;
    // Shape inserts and removes samples about falls: match by position.
    let j = 0;
    for (let k = 0; k < n.length; k++) {
      let bd = Infinity;
      for (let q = Math.max(0, j - 5); q < Math.min(c.n.length, j + 40); q++) { const d = Math.hypot(c.n[q] - n[k], c.e[q] - e[k]); if (d < bd) (bd = d), (j = q); }
      if (level[k] < c.level[j] - 1) {
        const rows: string[] = [];
        for (let q = Math.max(0, k - 6); q < Math.min(n.length, k + 40); q += 3) rows.push(`${q}: ${level[q].toFixed(1)}`);
        console.log(`line ${li}: shape lowers from k ${k} (chan ${j}) at ${n[k].toFixed(0)},${e[k].toFixed(0)}: chan ${c.level[j].toFixed(1)} -> ${level[k].toFixed(1)}, natural ${naturalHeight(n[k], e[k]).toFixed(1)}; shaped ${rows.join(' ')}`);
        const crow: string[] = [];
        for (let q = Math.max(0, j - 6); q < Math.min(c.n.length, j + 40); q += 3) crow.push(`${q}: ${c.level[q].toFixed(1)}`);
        console.log(`   chan ${crow.join(' ')}`);
        return;
      }
    }
  };
  setWorldSeed(env.RS_SEED ?? '42');
  levelProbe.on = undefined;
  setWorldSeed(0);
});
