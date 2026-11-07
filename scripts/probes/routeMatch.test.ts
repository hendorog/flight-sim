// Probe (foundation stage 1): does the drainage (drainage.ts, routed over the model's cells) follow the model's own
// routing (erosion.ts SteadyRouter)? Share of channel cells (A >= 10 / 45 km²) whose receivers differ.
import { it } from 'vitest';
import { SteadyRouter } from '../../src/world/terrain/erosion';
import { seededDrainage } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('route match', () => {
  for (const seed of (process.env.SEEDS ?? '42').split(',')) {
    setWorldSeed(seed);
    const d = seededDrainage!;
    const n = d.n, N = n * n;
    const fixed = new Uint8Array(N);
    for (let c = 0; c < N; c++) { const i = (c / n) | 0, j = c % n; if (d.height[c] <= 0 || i === 0 || j === 0 || i === n - 1 || j === n - 1) fixed[c] = 1; }
    const R = new SteadyRouter(n);
    R.route(d.routed, fixed);
    for (const T of [1, 10, 45]) {
      let k = 0, diff = 0;
      for (let c = 0; c < N; c++) { if (fixed[c] || d.area[c] < T) continue; k++; if (d.receiver[c] !== R.receiver[c]) diff++; }
      console.log(`seed ${seed}: cells A >= ${T} km² ${k}, receivers differ ${((100 * diff) / k).toFixed(1)} %`);
    }
  }
  setWorldSeed(0);
});
