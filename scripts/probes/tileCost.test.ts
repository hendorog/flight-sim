// Probe: buildTile cost on tiles along a seed's steep streams and across open country (level 0..3, grid 64), min of 3 rounds.
//   npx vitest run --config scripts/probes/vitest.config.ts tileCost --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { buildTile, type TileRequest } from '../../src/world/terrain/tileBuilder';
it('tile cost', () => {
  setWorldSeed(Number(process.env.TILE_SEED ?? 42));
  const reqs: TileRequest[] = [];
  const rs = hydrology.rivers!;
  for (let li = rs.length - 1; li >= 0 && reqs.length < 48; li -= 7) {
    const r = rs[li];
    const k = Math.floor(r.north.length / 2);
    for (const level of [0, 1, 2, 3]) {
      const size = 128 * 2 ** level;
      reqs.push({ level, ix: Math.floor(r.east[k] / size), iz: Math.floor(r.north[k] / size), grid: 64, leafSize: 128 });
    }
  }
  for (let i = 0; i < 16; i++) reqs.push({ level: i % 4, ix: 37 * i - 300, iz: 23 * i - 200, grid: 64, leafSize: 128 });
  let best = Infinity;
  for (let round = 0; round < 3; round++) {
    const t0 = performance.now();
    for (const q of reqs) buildTile(q);
    best = Math.min(best, performance.now() - t0);
  }
  console.log(`tileCost: ${reqs.length} tiles, ${(best / reqs.length).toFixed(2)} ms per tile (min of 3 rounds)`);
  setWorldSeed(0);
});
