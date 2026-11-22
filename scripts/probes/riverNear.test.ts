// Probe (foundation stage 2): the river line nearest a point: its level, the natural ground and the catchment along it
// about the nearest sample. RN_SEED, RN_N, RN_E, RN_SPAN (samples either side).
import { it } from 'vitest';
import { hydrology, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('river near', () => {
  setWorldSeed(env.RN_SEED ?? '42');
  const n0 = Number(env.RN_N ?? 58300), e0 = Number(env.RN_E ?? -21500);
  let best = Infinity, bl = -1, bk = -1;
  (hydrology.rivers ?? []).forEach((r, li) => { for (let k = 0; k < r.north.length; k++) { const d = Math.hypot(r.north[k] - n0, r.east[k] - e0); if (d < best) (best = d), (bl = li), (bk = k); } });
  const r = hydrology.rivers![bl];
  console.log(`line ${bl} kind ${r.kind} joins ${r.joins} samples ${r.north.length}, nearest ${bk} at ${best.toFixed(0)} m`);
  const span = Number(env.RN_SPAN ?? 30);
  for (let k = Math.max(0, bk - span); k < Math.min(r.north.length, bk + span); k += Number(env.RN_EVERY ?? 3)) console.log(`  ${k} s ${r.s[k].toFixed(0)} at ${r.north[k].toFixed(0)},${r.east[k].toFixed(0)} level ${r.level[k].toFixed(1)} natural ${naturalHeight(r.north[k], r.east[k]).toFixed(1)} A ${r.area?.[k].toFixed(0)}`);
  const last = r.north.length - 1;
  console.log(`  end ${last} at ${r.north[last].toFixed(0)},${r.east[last].toFixed(0)} level ${r.level[last].toFixed(1)}`);
  setWorldSeed(0);
});
