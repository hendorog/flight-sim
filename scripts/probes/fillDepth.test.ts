// Probe: how much of the river network runs through filled hollows (drainage.ts priority flood).
import { it } from 'vitest';
import { buildDrainage } from '../../src/world/terrain/drainage';
import { naturalHeightCoarse } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('fill depth', () => {
  for (const seed of [1, 42, 777777]) {
    setWorldSeed(seed);
    const d = buildDrainage(naturalHeightCoarse);
    let cells = 0; const over = [0, 0, 0, 0];
    for (const L of d.lines) for (const c of L.cells) {
      cells++;
      const f = d.filled[c] - d.height[c];
      if (f > 5) over[0]++;
      if (f > 30) over[1]++;
      if (f > 60) over[2]++;
      if (f > 150) over[3]++;
    }
    let landCells = 0, filled30 = 0;
    for (let c = 0; c < d.height.length; c++) if (d.height[c] > 0) { landCells++; if (d.filled[c] - d.height[c] > 30) filled30++; }
    console.log(`seed ${seed}: river cells ${cells}; in fill >5 m ${(100 * over[0] / cells).toFixed(1)} %, >30 m ${(100 * over[1] / cells).toFixed(1)} %, >60 m ${(100 * over[2] / cells).toFixed(1)} %, >150 m ${(100 * over[3] / cells).toFixed(1)} %; land filled >30 m ${(100 * filled30 / landCells).toFixed(1)} %`);
  }
  setWorldSeed(0);
});
