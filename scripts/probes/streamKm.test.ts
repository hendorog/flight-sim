// Probe: how much channel the drainage lattice holds below RIVER_AREA (km of channel cells per catchment threshold),
// and how many lake pools no river line runs through.
import { it } from 'vitest';
import { buildDrainage, DRAIN_CELL } from '../../src/world/terrain/drainage';
import { hydrology, naturalHeight, naturalHeightCoarse } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('stream km', () => {
  for (const seed of (process.env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const d = buildDrainage(naturalHeightCoarse, naturalHeight);
    const N = d.n * d.n;
    const out: string[] = [];
    for (const A of [3, 5, 8, 10, 15, 20, 30, 45]) {
      let km = 0, heads = 0;
      const isCh = (c: number) => d.area[c] >= A;
      const hasDonor = new Uint8Array(N);
      for (let c = 0; c < N; c++) {
        if (!isCh(c) || d.receiver[c] < 0) continue;
        const r = d.receiver[c];
        hasDonor[r] = 1;
        const di = Math.abs(Math.floor(c / d.n) - Math.floor(r / d.n)), dj = Math.abs((c % d.n) - (r % d.n));
        km += (di && dj ? Math.SQRT2 : 1) * DRAIN_CELL / 1000;
      }
      for (let c = 0; c < N; c++) if (isCh(c) && !hasDonor[c]) heads++;
      out.push(`A>=${A}: ${km.toFixed(0)} km, ${heads} heads`);
    }
    console.log(`seed ${seed}: ${out.join('; ')}; lines ${hydrology.rivers!.length}, pools ${hydrology.lakeMask!.pools.length}`);
  }
  setWorldSeed(0);
});
