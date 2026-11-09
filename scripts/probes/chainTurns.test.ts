// Round S: how the gully chains (gullies.ts) turn: at every chain node of CT_MIN km² or more, the angle between the
// main donor's step in and the step out, by class (in a V or on a floor; gentle or steep), per 100 km of chain.
//   CT_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts chainTurns --reporter=verbose
import { it } from 'vitest';
import { gullyNet, inV, receiverOf } from '../../src/world/terrain/gullies';
import { setWorldSeed } from '../../src/world/worldSeed';
import { terrainHeight } from '../../src/world/terrain/heightfield';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('chain turns', () => {
  for (const seed of (env.CT_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const g = gullyNet()!;
    const n = g.n, N = n * n, min = Number(env.CT_MIN ?? 1);
    // Main donor: the biggest catchment draining to each node.
    const main = new Int32Array(N).fill(-1);
    for (let q = 0; q < N; q++) {
      if (!g.dir[q]) continue;
      const r = receiverOf(g, q);
      if (r < 0) continue;
      if (main[r] < 0 || g.area[q] > g.area[main[r]]) main[r] = q;
    }
    const km: Record<string, number> = {}, turns: Record<string, number[]> = {};
    for (let q = 0; q < N; q++) {
      if (!g.dir[q] || g.area[q] < min) continue;
      const r = receiverOf(g, q), d = main[q];
      if (r < 0 || !g.dir[r]) continue;
      const yi = Math.floor(q / n), xi = q % n;
      const oy = Math.floor(r / n) - yi, ox = (r % n) - xi;
      const L = Math.hypot(oy, ox) * g.cell / 1000;
      const slope = (g.h[q] - g.h[r]) / (L * 1000);
      const cls = `${inV(g, q) ? 'V' : 'floor'} ${slope < 0.05 ? 'flat' : slope < 0.15 ? 'gentle' : 'steep'}`;
      km[cls] = (km[cls] ?? 0) + L;
      if (d < 0) continue;
      const iy = yi - Math.floor(d / n), ix = xi - (d % n);
      let a = Math.abs(Math.atan2(oy, ox) - Math.atan2(iy, ix)) * 180 / Math.PI; if (a > 180) a = 360 - a;
      const t = (turns[cls] ??= [0, 0, 0, 0, 0]);
      t[Math.round(a / 45)]++;
    }
    for (const c of Object.keys(km).sort()) {
      const t = turns[c] ?? [0, 0, 0, 0, 0];
      console.log(`seed ${seed} ${c}: ${km[c].toFixed(0)} km; turns per 100 km 0/45/90/135: ${t.map((v) => ((100 * v) / km[c]).toFixed(0)).join(' / ')}`);
    }
  }
  setWorldSeed(0);
});
