// Probe: the stones within a radius of a point, by where they lie (in the bed, up the bank), and the steep segments there.
//   SPOT=42:-17790:6400:150 npx vitest run --config scripts/probes/vitest.config.ts boulderSpot --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { BOULDER_STRIDE, buildBoulderCell } from '../../src/world/terrain/vegetation/boulders';
import type { FlowHit } from '../../src/world/terrain/hydrology';
it('boulder spot', () => {
  const [seed, n, e, rad] = (process.env.SPOT ?? '42:-17790:6400:150').split(':').map(Number);
  setWorldSeed(seed);
  const hit = {} as FlowHit;
  const s = makeSample();
  let total = 0, wet = 0, bank = 0, above = 0;
  const heights: number[] = [];
  for (let cz = Math.floor((n - rad) / 256); cz <= Math.floor((n + rad) / 256); cz++)
    for (let cx = Math.floor((e - rad) / 256); cx <= Math.floor((e + rad) / 256); cx++) {
      const c = buildBoulderCell({ cx, cz, size: 256 });
      for (let i = 0; i < c.count; i++) {
        const o = i * BOULDER_STRIDE;
        const b = c.boulders;
        if (Math.hypot(b[o] - e, b[o + 2] - n) > rad) continue;
        total++;
        if (b[o + 7] > 0.99) wet++;
        else bank++;
        hydrology.queryFlow!(b[o + 2], b[o], hit);
        const h = b[o + 1] - hit.level;
        heights.push(h);
        if (h > 3) above++;
      }
    }
  heights.sort((a, b) => a - b);
  const q = (p: number): string => (heights.length ? heights[Math.floor(p * (heights.length - 1))].toFixed(1) : '-');
  hydrology.queryFlow!(n, e, hit);
  sampleTerrain(n, e, s);
  console.log(`within ${rad} m of ${n},${e}: ${total} stones, ${wet} in the bed, ${bank} on the banks; base over the water p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)} m, ${above} more than 3 m up; nearest line ${hit.line} hw ${hit.halfWidth.toFixed(1)} steep ${hit.steepness.toFixed(2)} level ${hit.level.toFixed(1)} ground ${s.ground.toFixed(1)}`);
  setWorldSeed(0);
});
