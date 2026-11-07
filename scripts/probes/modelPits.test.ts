// Probe (foundation stage 1): closed hollows on the model's cells (heightfield.ts seededModel) and on the lattice the
// drainage routes (seededDrainage.height): cells with no lower neighbour, and the priority-flood fill depth.
import { it } from 'vitest';
import { seededDrainage, seededModel } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('model pits', () => {
  for (const seed of (process.env.MP_SEEDS ?? '1').split(',')) {
    setWorldSeed(seed);
    const d = seededDrainage!;
    const n = d.n;
    for (const [name, h] of [['model', seededModel()!.lattice], ['drainage height', d.height]] as Array<[string, Float32Array]>) {
      let pits = 0;
      const ex: string[] = [];
      for (let i = 1; i < n - 1; i++) for (let j = 1; j < n - 1; j++) {
        const c = i * n + j;
        if (d.height[c] <= 0) continue;
        let lower = false;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if ((a || b) && h[(i + a) * n + j + b] < h[c]) lower = true;
        if (!lower) { pits++; if (ex.length < 8) ex.push(`(${i},${j}) ${h[c].toFixed(0)}`); }
      }
      console.log(`seed ${seed} ${name}: pits ${pits}: ${ex.join(' ')}`);
    }
    const c0 = (Math.round((-31000 + 160000) / 1000)) * n + Math.round((-157000 + 160000) / 1000);
    const m = seededModel()!.lattice;
    const row = (i: number) => Array.from({ length: 7 }, (_, k) => m[(Math.floor(c0 / n) + i) * n + k].toFixed(0)).join(' ');
    console.log(`around cell 0 of line 22 (rows -2..2, cols 0..6):\n${[-2, -1, 0, 1, 2].map(row).join('\n')}`);
  }
  setWorldSeed(0);
});
