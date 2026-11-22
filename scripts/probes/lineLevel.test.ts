// Probe (foundation stage 2): a drawn river line's water level against the natural ground (centre, and the lowest of
// +-80 m across, as riverNetwork.ts samples it), every LL_STEP samples. LL_SEED, LL_LINE, LL_FROM, LL_TO (km).
import { it } from 'vitest';
import { hydrology, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('line level', () => {
  setWorldSeed(env.LL_SEED ?? '42');
  const r = hydrology.rivers![Number(env.LL_LINE ?? 0)];
  const from = Number(env.LL_FROM ?? 0) * 1000, to = Number(env.LL_TO ?? 1e9) * 1000;
  const out: string[] = [];
  for (let k = 1; k < r.north.length - 1; k += Number(env.LL_STEP ?? 10)) {
    if (r.s[k] < from || r.s[k] > to) continue;
    const tl = Math.hypot(r.north[k + 1] - r.north[k - 1], r.east[k + 1] - r.east[k - 1]) || 1;
    const qn = (-(r.east[k + 1] - r.east[k - 1]) / tl) * 80, qe = ((r.north[k + 1] - r.north[k - 1]) / tl) * 80;
    const g = naturalHeight(r.north[k], r.east[k]);
    const lo = Math.min(g, naturalHeight(r.north[k] + qn, r.east[k] + qe), naturalHeight(r.north[k] - qn, r.east[k] - qe));
    out.push(`${(r.s[k] / 1000).toFixed(1)} (${r.north[k].toFixed(0)},${r.east[k].toFixed(0)}) lv ${r.level[k].toFixed(0)} g ${g.toFixed(0)} lo ${lo.toFixed(0)}`);
  }
  console.log(out.join('\n'));
  setWorldSeed(0);
});
