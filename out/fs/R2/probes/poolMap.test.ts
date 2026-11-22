// Round T repairs 2: a map of the lake raster (250 m) around PM_AT (north,east) +- PM_R points on seed PM_SEED: per raster
// point the pool there (poolAt), the pond raster's ground (rasterGround), the natural ground, and whether line PM_LINE
// passes within 125 m. Two grids: pool ids, then ground (natural; raster ground in brackets where it differs by > 2 m).
import { it } from 'vitest';
import { hydrology, naturalHeight, terrainHeight } from '../../../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../../../src/world/worldSeed';
import { LAKE_RASTER, RASTER_N, DOMAIN_HALF } from '../../../../src/world/terrain/drainage';
import { streamDebug } from '../../../../src/world/terrain/streams';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('pool map', () => {
  setWorldSeed(Number(env.PM_SEED ?? 7));
  terrainHeight(0, 0);
  const mask = hydrology.lakeMask! as unknown as { poolAt(ri: number, rj: number): number; rasterGround(ri: number, rj: number): number; pools: Array<{ level: number }> };
  const [n0, e0] = (env.PM_AT ?? '-14200,124700').split(',').map(Number);
  const RR = Number(env.PM_R ?? 8);
  const O = -DOMAIN_HALF;
  const ci = Math.round((n0 - O) / LAKE_RASTER), cj = Math.round((e0 - O) / LAKE_RASTER);
  const r = hydrology.rivers![Number(env.PM_LINE ?? 567)];
  const near = (n: number, e: number): boolean => { for (let i = 0; i < r.north.length; i++) if (Math.hypot(r.north[i] - n, r.east[i] - e) < 125) return true; return false; };
  console.log(`centre raster ${ci},${cj} = ${O + ci * LAKE_RASTER},${O + cj * LAKE_RASTER}; rows north up, columns east; * = line passes`);
  for (let a = RR; a >= -RR; a--) {
    let row1 = '', row2 = '';
    for (let b = -RR; b <= RR; b++) {
      const ri = ci + a, rj = cj + b;
      const n = O + ri * LAKE_RASTER, e = O + rj * LAKE_RASTER;
      const p = mask.poolAt(ri, rj);
      const g = env.PM_ROUTE ? streamDebug.route!(n, e) : naturalHeight(n, e);
      const rg = mask.rasterGround(ri, rj);
      const st = near(n, e) ? '*' : ' ';
      row1 += (p >= 0 ? String(p) : '.').padStart(5) + st;
      row2 += (g.toFixed(0) + (rg === rg && Math.abs(rg - g) > 2 ? `[${rg.toFixed(0)}]` : '')).padStart(9) + st;
    }
    console.log(`${String(O + (ci + a) * LAKE_RASTER).padStart(8)} ${row1}`);
    console.log(`${''.padStart(8)} ${row2}`);
  }
  for (const id of (env.PM_POOLS ?? '26').split(',').map(Number)) console.log(`pool ${id} level ${mask.pools[id].level.toFixed(2)}`);
  setWorldSeed(0);
});
