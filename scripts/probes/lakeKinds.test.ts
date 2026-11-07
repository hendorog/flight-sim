// Probe (foundation stages 1-2): the seeded world's lakes by kind: field class at the lake's middle (treeMetrics.ts
// fieldClasses: mountain / hill / plain), relief class there on the lattice the drainage routes (reliefClasses), the
// orogen's class (the model's ranges' uplift share with the wide orogen's envelope >= 0.25 / 1.15: mountain; stage 2),
// tarn or not, on a river or not, level band; count and lattice area. With the model inputs, the kept hollows too.
import { it } from 'vitest';
import { DOMAIN_HALF, DRAIN_CELL } from '../../src/world/terrain/drainage';
import * as hf from '../../src/world/terrain/heightfield';
import { seededDrainage } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { CLASS_NAMES, fieldClasses, macroFields, reliefClasses } from './treeMetrics';
it('lake kinds', () => {
  for (const seed of (process.env.LK_SEEDS ?? '1,42,777777').split(',')) {
    setWorldSeed(seed);
    const d = seededDrainage!;
    const n = d.n;
    const cls = fieldClasses(n, macroFields(n, -DOMAIN_HALF, DRAIN_CELL), d.height);
    const rel = reliefClasses(n, d.height);
    const inp = (hf as unknown as { seededInputs?: { ur: Float32Array; lakes: number } | null }).seededInputs ?? null;
    const k = new Map<string, { n: number; cells: number }>();
    const add = (key: string, cells: number) => { const v = k.get(key) ?? { n: 0, cells: 0 }; v.n++; v.cells += cells; k.set(key, v); };
    for (const l of d.lakes) {
      add(`class ${CLASS_NAMES[cls[l.centre]]}`, l.cells.length);
      add(`relief ${CLASS_NAMES[rel[l.centre]]}`, l.cells.length);
      if (inp) add(`orogen ${inp.ur[l.centre] >= 0.25 / 1.15 ? 'mountain' : 'off'}`, l.cells.length);
      add(l.tarn ? 'tarn' : l.river ? 'on a river' : 'no river', l.cells.length);
      add(`level ${l.level < 300 ? '<300' : l.level < 800 ? '300-800' : l.level < 1500 ? '800-1500' : '>1500'} m`, l.cells.length);
    }
    // Land off the ranges (lowland: field classes hill + plain; and off the orogen, with it), km², for lakes per area.
    let lowF = 0, lowO = 0;
    for (let c = 0; c < n * n; c++) {
      if (d.height[c] <= 0) continue;
      if (cls[c] !== 3) lowF++;
      if (inp && inp.ur[c] < 0.25 / 1.15) lowO++;
    }
    console.log(`seed ${seed}: lowland ${lowF} km² (field classes)${inp ? `, ${lowO} km² off the orogen` : ''}; lowland lakes per 1000 km² ${((1000 * d.lakes.filter((l) => cls[l.centre] !== 3).length) / lowF).toFixed(2)} (field)${inp ? `, ${((1000 * d.lakes.filter((l) => inp.ur[l.centre] < 0.25 / 1.15).length) / lowO).toFixed(2)} (off the orogen)` : ''}`);
    console.log(`seed ${seed}: ${d.lakes.length} lakes, ${d.lakes.reduce((s, l) => s + l.cells.length, 0)} lattice cells${inp ? `; kept hollows ${inp.lakes}` : ''}; ` + [...k.entries()].sort().map(([a, v]) => `${a} ${v.n} (${v.cells} cells)`).join(', '));
  }
  setWorldSeed(0);
});
