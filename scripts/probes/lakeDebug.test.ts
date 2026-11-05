// Probe (debugging): the lake raster round a point. DBG_SEED, DBG_AT=north,east.
import { it } from 'vitest';
import { hydrology, naturalHeightCoarse } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('lake debug', () => {
  setWorldSeed(Number(process.env.DBG_SEED ?? 42));
  const [pn, pe] = (process.env.DBG_AT ?? '45900,133850').split(',').map(Number);
  const m = hydrology.lakeMask as any;
  console.log(`at ${m.at(pn, pe)} field ${m.field} smooth ${m.smooth(pn, pe)} coarse ${naturalHeightCoarse(pn, pe).toFixed(1)}`);
  const ri = Math.floor((pn + 160000) / 250), rj = Math.floor((pe + 160000) / 250);
  m.rasters.forEach((R: any, k: number) => {
    const li = ri - R.gi, lj = rj - R.gj;
    if (li < -3 || lj < -3 || li > R.rows + 2 || lj > R.cols + 2) return;
    console.log(`pond ${k} box ${R.gi},${R.gj} ${R.rows}x${R.cols}`);
    for (let a = -2; a <= 3; a++) {
      let line = '';
      for (let b = -2; b <= 3; b++) {
        const qi = li + a, qj = lj + b;
        if (qi < 0 || qj < 0 || qi >= R.rows || qj >= R.cols) { line += '   ----   '; continue; }
        const p = qi * R.cols + qj;
        const id = R.pool[p];
        const g = R.ground[p];
        const true_ = naturalHeightCoarse(-160000 + (ri + a) * 250, -160000 + (rj + b) * 250);
        line += ` ${id >= 0 ? id.toString().padStart(3) : '  .'}:${Number.isNaN(g) ? '  nan' : g.toFixed(0).padStart(5)}/${true_.toFixed(0).padStart(5)}`;
      }
      console.log(line);
    }
    for (const id of new Set(Array.from(R.pool as Int16Array).filter((x) => x >= 0))) console.log(`  pool ${id} level ${m.pools[id].level.toFixed(1)}`);
  });
  setWorldSeed(0);
});
