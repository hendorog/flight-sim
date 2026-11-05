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
    // Before breaching: the priority flood over the terrain the drainage starts from (the eroded lattice in a world
    // with the erosion pass), the closed hollows as they are.
    const pre = floodFill(d.height, d.n);
    let preLand30 = 0, preRiver30 = 0;
    for (let c = 0; c < d.height.length; c++) if (d.height[c] > 0 && pre[c] - d.height[c] > 30) preLand30++;
    for (const L of d.lines) for (const c of L.cells) if (pre[c] - d.height[c] > 30) preRiver30++;
    const pct = (a: number, b: number): string => (100 * a / b).toFixed(1);
    console.log(`seed ${seed}: before breaching: land in hollows filled >30 m ${pct(preLand30, landCells)} %, river cells in fill >30 m ${pct(preRiver30, cells)} %`);
    console.log(`seed ${seed}: drainage ${ms.toFixed(0)} ms; river cells ${cells}; in fill >5 m ${pct(over[0], cells)} %, >30 m ${pct(over[1], cells)} %, >60 m ${pct(over[2], cells)} %, >150 m ${pct(over[3], cells)} %; cut >30 m ${pct(cut[0], cells)} %, >60 m ${pct(cut[1], cells)} %, >150 m ${pct(cut[2], cells)} %; land filled >30 m ${pct(filled30, landCells)} %, land cut ${pct(cutCells, landCells)} %`);
    const lk = d.lakes.map((l) => `${l.cells.length}${l.river ? 'r' : ''}/${l.depth.toFixed(0)}m`);
    console.log(`  ${d.lakes.length} lakes (cells/depth, r = river): ${lk.join(' ')}`);
  }
  setWorldSeed(0);
});

/** Priority-flood fill (Barnes et al. 2014) from the sea (<= 0 m) and the lattice edge: the filled level per cell. */
function floodFill(h: Float32Array, n: number): Float32Array {
  const N = n * n;
  const filled = new Float32Array(N);
  const done = new Uint8Array(N);
  const ids: number[] = [];
  const keys: number[] = [];
  const push = (id: number, k: number): void => {
    let i = ids.length; ids.push(id); keys.push(k);
    while (i > 0) { const p = (i - 1) >> 1; if (keys[p] <= k) break; ids[i] = ids[p]; keys[i] = keys[p]; i = p; }
    ids[i] = id; keys[i] = k;
  };
  const pop = (): number => {
    const top = ids[0]; const id = ids.pop()!; const k = keys.pop()!;
    if (ids.length) {
      let i = 0;
      for (;;) { const l = 2 * i + 1; if (l >= ids.length) break; let m = l; if (l + 1 < ids.length && keys[l + 1] < keys[l]) m = l + 1; if (keys[m] >= k) break; ids[i] = ids[m]; keys[i] = keys[m]; i = m; }
      ids[i] = id; keys[i] = k;
    }
    return top;
  };
  for (let c = 0; c < N; c++) {
    const i = Math.floor(c / n), j = c % n;
    if (h[c] <= 0 || i === 0 || j === 0 || i === n - 1 || j === n - 1) { filled[c] = h[c]; done[c] = 1; push(c, h[c]); }
  }
  while (ids.length) {
    const c = pop();
    const i = Math.floor(c / n), j = c % n;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const ii = i + a, jj = j + b;
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const q = ii * n + jj;
      if (done[q]) continue;
      done[q] = 1;
      filled[q] = Math.max(h[q], filled[c]);
      push(q, filled[q]);
    }
  }
  return filled;
}
