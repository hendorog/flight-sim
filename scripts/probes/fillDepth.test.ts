// Probe: how much of the river network runs through filled hollows (drainage.ts: priority flood over the routed
// terrain, after breaching), how deep the breach cuts go, and the lakes left.
import { it } from 'vitest';
import { buildDrainage } from '../../src/world/terrain/drainage';
import { naturalHeight, naturalHeightCoarse } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('fill depth', () => {
  for (const seed of (process.env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const t0 = performance.now();
    // Routed as the world routes it (the detailed ground settles the lakes).
    const d = buildDrainage(naturalHeightCoarse, naturalHeight);
    const ms = performance.now() - t0;
    // Fill: water level over the routed terrain; cut: routed terrain below the natural lattice.
    const routed = d.routed ?? d.height;
    let cells = 0; const over = [0, 0, 0, 0]; const cut = [0, 0, 0];
    for (const L of d.lines) for (const c of L.cells) {
      cells++;
      const f = d.filled[c] - routed[c];
      if (f > 5) over[0]++;
      if (f > 30) over[1]++;
      if (f > 60) over[2]++;
      if (f > 150) over[3]++;
      const k = d.height[c] - routed[c];
      if (k > 30) cut[0]++;
      if (k > 60) cut[1]++;
      if (k > 150) cut[2]++;
    }
    let landCells = 0, filled30 = 0, cutCells = 0;
    for (let c = 0; c < d.height.length; c++) if (d.height[c] > 0) {
      landCells++;
      if (d.filled[c] - routed[c] > 30) filled30++;
      if (d.height[c] - routed[c] > 1) cutCells++;
    }
    const pct = (a: number, b: number): string => (100 * a / b).toFixed(1);
    console.log(`seed ${seed}: drainage ${ms.toFixed(0)} ms; river cells ${cells}; in fill >5 m ${pct(over[0], cells)} %, >30 m ${pct(over[1], cells)} %, >60 m ${pct(over[2], cells)} %, >150 m ${pct(over[3], cells)} %; cut >30 m ${pct(cut[0], cells)} %, >60 m ${pct(cut[1], cells)} %, >150 m ${pct(cut[2], cells)} %; land filled >30 m ${pct(filled30, landCells)} %, land cut ${pct(cutCells, landCells)} %`);
    const lk = d.lakes.map((l) => `${l.cells.length}${l.river ? 'r' : ''}/${l.depth.toFixed(0)}m`);
    console.log(`  ${d.lakes.length} lakes (cells/depth, r = river): ${lk.join(' ')}`);
  }
  setWorldSeed(0);
});
