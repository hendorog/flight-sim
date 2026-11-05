// Probe: the flow attribute (bare rock along fast water) of the tiles around a point, and the query behind it.
//   FLOW_AT=42:-5100:-35420 npx vitest run --config scripts/probes/vitest.config.ts flowTile --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { buildTile } from '../../src/world/terrain/tileBuilder';
import type { FlowHit } from '../../src/world/terrain/hydrology';
it('flow tile', () => {
  const [seed, n, e] = (process.env.FLOW_AT ?? '42:-5100:-35420').split(':').map(Number);
  setWorldSeed(seed);
  const hit = {} as FlowHit;
  hydrology.queryFlow!(n, e, hit);
  const s = makeSample();
  sampleTerrain(n, e, s);
  console.log(`queryFlow: line ${hit.line} kind ${hit.kind} dist ${hit.dist.toFixed(1)} hw ${hit.halfWidth.toFixed(1)} steep ${hit.steepness.toFixed(2)} regime ${hit.regime}; sample riverDist ${s.riverDist.toFixed(1)} hw ${s.riverHalfWidth.toFixed(1)}`);
  for (const level of [0, 1, 2, 3]) {
    const size = 128 * 2 ** level;
    const t = buildTile({ level, ix: Math.floor(e / size), iz: Math.floor(n / size), grid: 64, leafSize: 128 });
    let nz = 0;
    let max = 0;
    for (const v of t.flow ?? []) {
      if (v > 0) nz++;
      max = Math.max(max, v);
    }
    let known = 0;
    for (let v = 0; v < t.river.length / 2; v++) if (t.river[v * 2 + 1] > 8) known++;
    console.log(`level ${level}: flow ${t.flow ? 'present' : 'null'}, nonzero ${nz}, max ${max}; river half-width > 1 m at ${known} vertices`);
  }
  setWorldSeed(0);
});
