// Probe (Round V A4'+B join): the line nearest a point (LW_PT n,e; LW_SEED) sample by sample about it (LW_N samples
// either side): arc, place, level, natural ground (overGround's), drawn ground, half-width; and the line's pass
// (streams.ts streamDebug.src, where the tree has it), ends and length.
import { it } from 'vitest';
import { hydrology, naturalHeight, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import * as ST from '../../src/world/terrain/streams';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('line walk', () => {
  const seed = Number(env.LW_SEED ?? 42);
  setWorldSeed(seed);
  const S = makeSample();
  const L = hydrology.rivers as unknown as Array<{ north: Float64Array; east: Float64Array; level: Float64Array; halfWidth: Float64Array; s: Float64Array; kind?: number; joins?: number; end?: string; area?: Float64Array }>;
  const nR = L.filter((r) => (r.kind ?? 0) === 0).length;
  const src = (ST as unknown as { streamDebug?: { src?: string[] } }).streamDebug?.src;
  for (const pt of (env.LW_PT ?? '0,0').split(';')) {
    const [pn, pe] = pt.split(',').map(Number);
    let best = -1, bk = 0, bd = Infinity;
    L.forEach((r, li) => { for (let k = 0; k < r.north.length; k++) { const d = Math.hypot(r.north[k] - pn, r.east[k] - pe); if (d < bd) { bd = d; best = li; bk = k; } } });
    const r = L[best];
    const m = r.north.length - 1;
    console.log(`LW seed ${seed} pt ${pt}: line ${best} (${best < nR ? 'river' : src?.[best - nR] ?? 'stream'}) dist ${bd.toFixed(0)} m, sample ${bk}/${m}, len ${r.s[m].toFixed(0)}, joins ${r.joins}, end ${r.end}, A ${r.area?.[0].toFixed(1)}..${r.area?.[m].toFixed(1)}, from ${r.north[0].toFixed(0)},${r.east[0].toFixed(0)} to ${r.north[m].toFixed(0)},${r.east[m].toFixed(0)}`);
    const N = Number(env.LW_N ?? 30), step = Number(env.LW_STEP ?? 1);
    for (let k = Math.max(0, bk - N * step); k <= Math.min(m, bk + N * step); k += step) {
      sampleTerrain(r.north[k], r.east[k], S);
      console.log(`  k ${k} s ${r.s[k].toFixed(0)} at ${r.north[k].toFixed(0)},${r.east[k].toFixed(0)} level ${r.level[k].toFixed(1)} natural ${naturalHeight(r.north[k], r.east[k]).toFixed(1)} drawn ${S.ground.toFixed(1)} hw ${r.halfWidth[k].toFixed(1)}`);
    }
  }
  setWorldSeed(0);
});
