// Probe: a river's channel profile round a point (OVER_AT=north,east km; OVER_SEED): level, natural ground under the
// channel, the lowest ground within 300 m, and the river's valley query (axis level, distance to the axis).
import { it } from 'vitest';
import { hydrology, naturalHeight, naturalHeightRaw } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('over profile', () => {
  setWorldSeed(Number(process.env.OVER_SEED ?? 1));
  const [an, ae] = (process.env.OVER_AT ?? '5.3,59.6').split(',').map((v) => Number(v) * 1000);
  let best = Infinity, bl = -1, bk = -1;
  hydrology.rivers!.forEach((r, li) => { for (let k = 0; k < r.north.length; k++) { const d = Math.hypot(r.north[k] - an, r.east[k] - ae); if (d < best) { best = d; bl = li; bk = k; } } });
  const r = hydrology.rivers![bl];
  const v = { dist: 0, level: 0, floodplain: 0 } as { dist: number; level: number; floodplain: number };
  console.log(`river ${bl}, ${r.north.length} points, nearest ${best.toFixed(0)} m at k ${bk}`);
  for (let k = Math.max(0, bk - 60); k < Math.min(r.north.length, bk + 60); k += 4) {
    const pn = r.north[k], pe = r.east[k];
    let lo = Infinity; for (let a = 0; a < 16; a++) for (const d of [100, 200, 300]) lo = Math.min(lo, naturalHeight(pn + d * Math.cos(a * Math.PI / 8), pe + d * Math.sin(a * Math.PI / 8)));
    hydrology.queryValley(pn, pe, v as never);
    console.log(`  k ${k} s ${(r.s[k] / 1000).toFixed(2)} at ${(pn / 1000).toFixed(2)},${(pe / 1000).toFixed(2)}: level ${r.level[k].toFixed(0)} natural ${naturalHeight(pn, pe).toFixed(0)} raw ${naturalHeightRaw(pn, pe).toFixed(0)} low300 ${lo.toFixed(0)} | valley axis dist ${v.dist.toFixed(0)} level ${v.level.toFixed(0)} fp ${v.floodplain.toFixed(0)}`);
  }
  setWorldSeed(0);
});
