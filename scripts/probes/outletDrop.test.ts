// Probe: how far a river drops where it leaves a lake (the first point past the lake's water, and 250 / 500 / 1000 m
// on), and the river's catchment there.
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('outlet drop', () => {
  for (const seed of (process.env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const mask = hydrology.lakeMask!;
    const d0: number[] = [], d250: number[] = [], d500: number[] = [], d1000: number[] = [];
    let show = Number(process.env.OUT_SHOW ?? 0);
    for (const r of hydrology.rivers!) {
      let inLake = -Infinity;
      for (let k = 0; k < r.north.length; k++) {
        const L = mask.at(r.north[k], r.east[k]);
        if (L > -Infinity) { inLake = L; continue; }
        if (inLake > -Infinity) {
          const s0 = r.s[k];
          const at = (ds: number) => { let j = k; while (j < r.s.length - 1 && r.s[j] - s0 < ds) j++; return inLake - r.level[j]; };
          d0.push(inLake - r.level[k]); d250.push(at(250)); d500.push(at(500)); d1000.push(at(1000));
          if (show > 0 && inLake - r.level[k] > 20) { show--; console.log(`  outlet at ${r.north[k].toFixed(0)},${r.east[k].toFixed(0)}: lake ${inLake.toFixed(0)}, river ${r.level[k].toFixed(0)}, +500 m ${(inLake - at(500)).toFixed(0)} half-width ${r.halfWidth[k].toFixed(0)}`); }
          inLake = -Infinity;
        }
      }
    }
    const q = (a: number[], f: number) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(1);
    const big = (a: number[], t: number) => a.filter((x) => x > t).length;
    console.log(`seed ${seed}: ${d0.length} outlets; drop at the first point past the water median ${q(d0, 0.5)} p90 ${q(d0, 0.9)} max ${q(d0, 1)} m (${big(d0, 5)} > 5 m, ${big(d0, 20)} > 20 m); 250 m on median ${q(d250, 0.5)} p90 ${q(d250, 0.9)}; 500 m on median ${q(d500, 0.5)} p90 ${q(d500, 0.9)}; 1 km on median ${q(d1000, 0.5)} p90 ${q(d1000, 0.9)}`);
  }
  setWorldSeed(0);
});
