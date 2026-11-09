// The rill segments of the patch holding RS_AT with catchment over RS_MIN km² (probes).
import { it } from 'vitest';
import { RILL_PATCH, rillArea, rillPatchLines, rillWaterHalf, rillBedHalf } from '../../src/world/terrain/rills';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('rill segs', () => {
  setWorldSeed(env.RS_SEED ?? '42');
  const [n, e] = (env.RS_AT ?? '').split(',').map(Number);
  const { segs, graph } = rillPatchLines({ pi: Math.floor(e / RILL_PATCH), pj: Math.floor(n / RILL_PATCH) });
  let k = 0;
  for (const s of segs) {
    const A = rillArea(s.s0);
    if (A < Number(env.RS_MIN ?? 1) || Math.hypot(s.n0 - n, s.e0 - e) > Number(env.RS_R ?? 800)) continue;
    if (k++ < 40) console.log(`RS ${s.n0.toFixed(0)},${s.e0.toFixed(0)} -> ${s.n1.toFixed(0)},${s.e1.toFixed(0)} A ${A.toFixed(2)} bedHalf ${rillBedHalf(s.s0).toFixed(2)} waterHalf ${rillWaterHalf(s.s0).toFixed(2)}`);
  }
  void graph;
});
