// Round V A3 fix: line BA_LINE's points within BA_R m of each BA_PTS site (seed BA_SEED): its water, and the drawn ground
// across it at +-(half-width + 15), +-100, +-200 m (left / right of the flow): how high the banks stand over the water.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type Line = { north: Float64Array; east: Float64Array; s: Float64Array; level: Float64Array; halfWidth: Float64Array };
it('bank at', () => {
  setWorldSeed(Number(env.BA_SEED ?? 777777)); terrainHeight(0, 0);
  const r = (hydrology.rivers as unknown as Line[])[Number(env.BA_LINE ?? 0)];
  const R = Number(env.BA_R ?? 600);
  for (const t of (env.BA_PTS ?? '').split(';').filter(Boolean)) {
    const [pn, pe] = t.split(':').map(Number);
    let worst = -Infinity, txt = '';
    let last = -1e9;
    for (let i = 1; i < r.north.length - 1; i++) {
      if (Math.hypot(r.north[i] - pn, r.east[i] - pe) > R || r.s[i] - last < 25) continue;
      last = r.s[i];
      const dn = r.north[i + 1] - r.north[i - 1], de = r.east[i + 1] - r.east[i - 1], dl = Math.hypot(dn, de) || 1;
      const un = -de / dl, ue = dn / dl;
      const at = (d: number): number => terrainHeight(r.north[i] + un * d, r.east[i] + ue * d) - r.level[i];
      const hw = r.halfWidth[i] + 15;
      const v = Math.min(at(hw), at(-hw));
      const row = `${r.north[i].toFixed(0)},${r.east[i].toFixed(0)} level ${r.level[i].toFixed(1)} banks L/R +${hw.toFixed(0)}: ${at(hw).toFixed(1)} / ${at(-hw).toFixed(1)}, 100: ${at(100).toFixed(1)} / ${at(-100).toFixed(1)}, 200: ${at(200).toFixed(1)} / ${at(-200).toFixed(1)}`;
      const mx = Math.max(at(hw), at(-hw));
      if (mx > worst) { worst = mx; txt = row; }
      void v;
    }
    console.log(`BA site ${pn},${pe}: highest bank: ${txt}`);
  }
  setWorldSeed(0);
});
