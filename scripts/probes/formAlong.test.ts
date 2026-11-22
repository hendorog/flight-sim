// Round V A4': a line's form along it near a point (FA2_PT n,e; FA2_SEED; FA2_N samples): arc, wet and bed edges,
// half-width, depth, level - the drawn form sample by sample.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('form along', () => {
  setWorldSeed(Number(env.FA2_SEED ?? 1));
  terrainHeight(0, 0);
  const [n, e] = (env.FA2_PT ?? '0,0').split(',').map(Number);
  let best = -1, bi = -1, bd = Infinity;
  hydrology.rivers!.forEach((r, li) => { for (let i = 0; i < r.north.length; i++) { const d = Math.hypot(r.north[i] - n, r.east[i] - e); if (d < bd) (bd = d), (best = li), (bi = i); } });
  const r = hydrology.rivers![best] as unknown as Record<string, Float64Array & Float32Array> & { kind: number };
  console.log(`line ${best} kind ${r.kind} at ${bd.toFixed(0)} m, sample ${bi}/${r.north.length}`);
  const N = Number(env.FA2_N ?? 40);
  for (let i = Math.max(0, bi - N); i < Math.min(r.north.length, bi + N); i++) console.log(`  ${i} s ${r.s[i].toFixed(0)} wet ${r.wetL[i].toFixed(1)}/${r.wetR[i].toFixed(1)} bed ${r.bedL[i].toFixed(1)}/${r.bedR[i].toFixed(1)} hw ${r.halfWidth[i].toFixed(1)} d ${r.depth[i].toFixed(2)} lv ${r.level[i].toFixed(1)}`);
  setWorldSeed(0);
});
