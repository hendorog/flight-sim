// Checker A4p: drawn standing water by area (a union, not lakeStats' sum over pools): every 250 m raster point of the
// domain where the terrain's standing water stands over its ground; against lakeStats' sum. CK_SEEDS.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { DOMAIN_HALF } from '../../src/world/terrain/drainage';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('chk wet area', () => {
  const s = makeSample();
  for (const seed of (env.CK_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const pools = (hydrology.lakeMask as unknown as { pools: Array<{ wet: number }> }).pools;
    const sum = pools.reduce((a, p) => a + p.wet, 0) * 0.0625;
    const STEP = 250;
    let wet = 0;
    for (let n = -DOMAIN_HALF + STEP / 2; n < DOMAIN_HALF; n += STEP)
      for (let e = -DOMAIN_HALF + STEP / 2; e < DOMAIN_HALF; e += STEP) {
        sampleTerrain(n, e, s);
        if (s.ground > 0.5 && s.standing > s.ground + 0.05) wet++;
      }
    console.log(`WA seed ${seed}: pools ${pools.length}, lakeStats sum ${sum.toFixed(0)} km²; drawn standing water over the ground (250 m grid) ${(wet * STEP * STEP / 1e6).toFixed(0)} km²`);
  }
  setWorldSeed(0);
});
