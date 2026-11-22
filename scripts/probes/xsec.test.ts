// Round V A3r: a straight transect XS_A -> XS_B (n,e:n,e) every XS_STEP m: drawn ground, natural ground, the model's
// ground and the slopes' ground (debugMacro), the slopes' weight m and floor state, the river sample. XS_SEED.
import { it } from 'vitest';
import { makeSample, sampleTerrain, naturalHeight, debugMacro, hydrology } from '../../src/world/terrain/heightfield';
import type { ValleyNear } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('xsec', () => {
  setWorldSeed(Number(env.XS_SEED ?? 42));
  const s = makeSample();
  for (const tr of (env.XS ?? '0,0:0,1000').split(';')) {
    const [A, B] = tr.split(':').map((p) => p.split(',').map(Number));
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const st = Number(env.XS_STEP ?? 25);
    console.log(`XS ${tr}`);
    for (let d = 0; d <= L + 1e-6; d += st) {
      const n = A[0] + ((B[0] - A[0]) * d) / L, e = A[1] + ((B[1] - A[1]) * d) / L;
      sampleTerrain(n, e, s);
      const m = debugMacro(n, e);
      const vs: ValleyNear[] = [];
      const nv = hydrology.network ? hydrology.network.valleys(n, e, vs) : 0;
      const vv = vs.slice(0, nv).map((v) => `[v${v.line} d ${v.dist.toFixed(0)} f ${v.floodplain.toFixed(0)} I ${v.influence.toFixed(0)} sw ${v.swing.toFixed(0)} gap ${v.gap.toFixed(0)} lv ${v.level.toFixed(1)}]`).join('');
      console.log(`  ${d.toFixed(0)} ${n.toFixed(0)},${e.toFixed(0)} g ${s.ground.toFixed(1)} nat ${naturalHeight(n, e).toFixed(1)} model ${m ? m.model.toFixed(1) : '-'} slope ${m ? m.slope.toFixed(1) : '-'} m ${m ? m.s.m.toFixed(2) : '-'} fin ${m ? m.s.fin : '-'} fw ${m ? m.s.fw.toFixed(2) : '-'} river ${Number.isFinite(s.river) ? s.river.toFixed(1) : '-'} rd ${Number.isFinite(s.riverDist) ? s.riverDist.toFixed(0) : '-'} hw ${s.riverHalfWidth.toFixed(1)} st ${s.standing.toFixed(1)} ${env.XS_V ? vv : ''}`);
    }
  }
  setWorldSeed(0);
});
