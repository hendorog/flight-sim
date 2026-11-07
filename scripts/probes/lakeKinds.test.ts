// Probe (foundation stage 1): the seeded world's lakes by kind: field class at the lake's middle (treeMetrics.ts
// fieldClasses: mountain / hill / plain), tarn or not, on a river or not, level band; count and lattice area.
import { it } from 'vitest';
import { DOMAIN_HALF, DRAIN_CELL } from '../../src/world/terrain/drainage';
import { seededDrainage } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { CLASS_NAMES, fieldClasses, macroFields } from './treeMetrics';
it('lake kinds', () => {
  for (const seed of (process.env.LK_SEEDS ?? '1,42,777777').split(',')) {
    setWorldSeed(seed);
    const d = seededDrainage!;
    const n = d.n;
    const cls = fieldClasses(n, macroFields(n, -DOMAIN_HALF, DRAIN_CELL), d.height);
    const k = new Map<string, { n: number; cells: number }>();
    const add = (key: string, cells: number) => { const v = k.get(key) ?? { n: 0, cells: 0 }; v.n++; v.cells += cells; k.set(key, v); };
    for (const l of d.lakes) {
      const c = CLASS_NAMES[cls[l.centre]];
      add(`class ${c}`, l.cells.length);
      add(l.tarn ? 'tarn' : l.river ? 'on a river' : 'no river', l.cells.length);
      add(`level ${l.level < 300 ? '<300' : l.level < 800 ? '300-800' : l.level < 1500 ? '800-1500' : '>1500'} m`, l.cells.length);
    }
    console.log(`seed ${seed}: ${d.lakes.length} lakes, ${d.lakes.reduce((s, l) => s + l.cells.length, 0)} lattice cells; ` + [...k.entries()].sort().map(([a, v]) => `${a} ${v.n} (${v.cells} cells)`).join(', '));
  }
  setWorldSeed(0);
});
