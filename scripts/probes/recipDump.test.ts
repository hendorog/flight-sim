// recipDump (round T): the painted segments forming out-and-back pairs in one patch, with their sizes and targets.
//   RD_SEED=777777 RD_PATCH=-66,39 npx vitest run --config scripts/probes/vitest.config.ts recipDump --silent=false
import { it } from 'vitest';
import { rillPatchLines } from '../../src/world/terrain/rills';
import { setWorldSeed } from '../../src/world/worldSeed';
import { terrainHeight } from '../../src/world/terrain/heightfield';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('recip dump', () => {
  setWorldSeed(Number(env.RD_SEED ?? 777777));
  terrainHeight(0, 0);
  const [pi, pj] = (env.RD_PATCH ?? '-66,39').split(',').map(Number);
  const { segs } = rillPatchLines({ pi, pj });
  const K = (e: number, n: number): string => `${e.toFixed(2)},${n.toFixed(2)}`;
  const by = new Map<string, number[]>();
  segs.forEach((s, i) => { const k = `${K(s.e0, s.n0)}>${K(s.e1, s.n1)}`; (by.get(k) ?? by.set(k, []).get(k)!).push(i); });
  for (const [k, ids] of by) {
    const [a, b] = k.split('>');
    if (a < b && by.has(`${b}>${a}`)) {
      for (const i of [...ids, ...by.get(`${b}>${a}`)!]) { const s = segs[i]; console.log(`seg ${i}: ${s.n0.toFixed(1)},${s.e0.toFixed(1)} -> ${s.n1.toFixed(1)},${s.e1.toFixed(1)} s ${s.s0.toFixed(3)}->${s.s1.toFixed(3)} cj ${s.cj} hid ${s.hid}`); }
      // neighbours in index order (the line it belongs to)
      const i0 = ids[0];
      for (let q = Math.max(0, i0 - 3); q <= Math.min(segs.length - 1, i0 + 3); q++) { const s = segs[q]; console.log(`   near ${q}: ${s.n0.toFixed(1)},${s.e0.toFixed(1)} -> ${s.n1.toFixed(1)},${s.e1.toFixed(1)} cj ${s.cj}`); }
    }
  }
  setWorldSeed(0);
});
