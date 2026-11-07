// Probe (foundation stage 2): every river line passing within LN_R m of a point: its nearest sample, level, catchment,
// kind. LN_SEED, LN_N, LN_E, LN_R.
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('lines near', () => {
  setWorldSeed(env.LN_SEED ?? '42');
  const n0 = Number(env.LN_N ?? 60055), e0 = Number(env.LN_E ?? -23361), R = Number(env.LN_R ?? 4000);
  (hydrology.rivers ?? []).forEach((r, li) => {
    let best = Infinity, bk = -1;
    for (let k = 0; k < r.north.length; k++) { const d = Math.hypot(r.north[k] - n0, r.east[k] - e0); if (d < best) (best = d), (bk = k); }
    if (best > R) return;
    console.log(`line ${li} kind ${r.kind} joins ${r.joins} at ${best.toFixed(0)} m: sample ${bk}/${r.north.length} (${r.north[bk].toFixed(0)},${r.east[bk].toFixed(0)}) level ${r.level[bk].toFixed(1)} A ${r.area?.[bk].toFixed(0)} hw ${r.halfWidth?.[bk]?.toFixed(0)}`);
  });
  setWorldSeed(0);
});
