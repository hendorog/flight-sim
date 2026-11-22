// (foundation stage 1 pictures) Sites per seed: the densest lake cluster (lakes within 15 km), a big river reach at
// 250-600 m level, the highest mountain ground within 60 km of home.
import { it } from 'vitest';
import { hydrology, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('view sites', () => {
  for (const seed of [1, 42, 777777]) {
    setWorldSeed(seed);
    const L = hydrology.lakes;
    let best = 0, bl = 0;
    L.forEach((a, i) => { const k = L.filter((b) => b.level < Number(process.env.VS_MAXLEVEL ?? 1e9) && Math.hypot(a.north - b.north, a.east - b.east) < 15000).length; if (k > best && a.level < Number(process.env.VS_MAXLEVEL ?? 1e9) && Math.hypot(a.north, a.east) < 90000) (best = k), (bl = i); });
    const c = L[bl];
    if (c) console.log(`seed ${seed} lakes: cluster of ${best} at ${c.north.toFixed(0)},${c.east.toFixed(0)} level ${c.level.toFixed(0)}`);
    let rb: string | null = null, ra = 0;
    (hydrology.rivers ?? []).forEach((r, li) => {
      if (r.kind !== 0 || !r.area) return;
      for (let k = 0; k < r.s.length; k += 20) {
        if (r.level[k] < 250 || r.level[k] > 600 || r.area[k] < ra || Math.hypot(r.north[k], r.east[k]) > 70000) continue;
        ra = r.area[k];
        const k2 = Math.min(r.s.length - 1, k + 40);
        rb = `line ${li} at ${r.north[k].toFixed(0)},${r.east[k].toFixed(0)} level ${r.level[k].toFixed(0)} area ${ra.toFixed(0)}; downstream ${r.north[k2].toFixed(0)},${r.east[k2].toFixed(0)}`;
      }
    });
    console.log(`seed ${seed} river: ${rb}`);
    let hi = -1, hp = '';
    for (let n = -60000; n <= 60000; n += 1000) for (let e = -60000; e <= 60000; e += 1000) { const h = naturalHeight(n, e); if (h > hi) (hi = h), (hp = `${n},${e}`); }
    console.log(`seed ${seed} peak: ${hp} ${hi.toFixed(0)} m`);
  }
  setWorldSeed(0);
});
