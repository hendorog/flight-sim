// Foundation streams: the pass's weight (SlopeField.w) over the chains' nodes (gullies.ts), by catchment.
import { it } from 'vitest';
import { seededModel } from '../../src/world/terrain/heightfield';
import { gullyNet } from '../../src/world/terrain/gullies';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('gully w', () => {
  setWorldSeed(env.GW_SEED ?? '42');
  const g = gullyNet()!, w = seededModel()!.slopes!.w;
  for (const a0 of [0, 0.25, 5]) {
    const h = new Array(11).fill(0); let n = 0;
    for (let q = 0; q < g.n * g.n; q++) if (g.dir[q] && g.area[q] >= a0) { h[Math.min(10, Math.floor(w[q] / 25.5))]++; n++; }
    console.log(`A>=${a0}: n ${n}; w deciles ${h.map((v) => ((100 * v) / n).toFixed(1)).join(' ')}`);
  }
  if (env.GW_AT) { const [N0, E0] = env.GW_AT.split(',').map(Number); const y0 = Math.round((N0 - g.origin) / g.cell), x0 = Math.round((E0 - g.origin) / g.cell);
    for (let y = y0 + 4; y >= y0 - 4; y--) { let r = ''; for (let x = x0 - 4; x <= x0 + 4; x++) r += String(w[y * g.n + x]).padStart(4); console.log(r); } }
});
