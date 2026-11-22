// Probe: the erosion pass (erosion.ts) on the drainage lattice, tuned outside the world build.
//   EROSION_SEEDS=1,42,777777 EROSION_STEPS=12 EROSION_REROUTE=3 EROSION_K=0.004 EROSION_M=0.5 npx vitest run --config scripts/probes/vitest.config.ts erosion --silent=false --disable-console-intercept
import { it } from 'vitest';
import { buildDrainage, DOMAIN_HALF, DRAIN_CELL } from '../../src/world/terrain/drainage';
import { EROSION, erodeLattice } from '../../src/world/terrain/erosion';
import { naturalHeightRaw } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
function stats(h: Float32Array, n: number): string {
  const d = buildDrainage((north, east) => h[Math.round((north + DOMAIN_HALF) / DRAIN_CELL) * n + Math.round((east + DOMAIN_HALF) / DRAIN_CELL)]);
  let cells = 0, r30 = 0, land = 0, f30 = 0;
  for (const L of d.lines) for (const c of L.cells) { cells++; if (d.filled[c] - d.height[c] > 30) r30++; }
  for (let c = 0; c < d.height.length; c++) if (d.height[c] > 0) { land++; if (d.filled[c] - d.height[c] > 30) f30++; }
  return `land fill>30 ${(100 * f30 / land).toFixed(1)} %, river cells fill>30 ${(100 * r30 / cells).toFixed(1)} %, lakes ${d.lakes.length}, lines ${d.lines.length}`;
}
it('erosion', () => {
  // EROSION_SETS="steps,reroute,k,m;..." tries several settings per seed.
  const sets = (env.EROSION_SETS ?? `${EROSION.steps},${EROSION.reroute},${EROSION.k},${EROSION.m},${EROSION.blur},${EROSION.settle},${EROSION.grade}`).split(';').map((t) => { const [steps, reroute, k, m, blur, settle, grade] = t.split(',').map(Number); return { steps, reroute, k, m, blur, settle, grade }; });
  for (const seed of (env.EROSION_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const n = Math.round((2 * DOMAIN_HALF) / DRAIN_CELL) + 1;
    const h0 = new Float32Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) h0[i * n + j] = naturalHeightRaw(-DOMAIN_HALF + i * DRAIN_CELL, -DOMAIN_HALF + j * DRAIN_CELL, false);
    console.log(`seed ${seed} before: ${stats(h0, n)}`);
    const idx = Array.from(h0.keys()).sort((a, b) => h0[b] - h0[a]);
    const top = idx.slice(0, Math.floor(idx.length / 100));
    for (const p of sets) {
    const h = h0.slice();
    const t0 = performance.now();
    erodeLattice(h, n, p);
    const ms = performance.now() - t0;
    // Peak preservation: lowering of the top 1 % of cells, and the deepest lowering.
    const topLow = top.reduce((s, c) => s + h0[c] - h[c], 0) / top.length;
    let maxLow = 0, sumLow = 0, land = 0;
    for (let c = 0; c < h.length; c++) if (h0[c] > 0) { land++; sumLow += h0[c] - h[c]; maxLow = Math.max(maxLow, h0[c] - h[c]); }
    const lows: number[] = [];
    for (let c = 0; c < h.length; c++) if (h0[c] > 0) lows.push(h0[c] - h[c]);
    lows.sort((a, b) => a - b);
    const q = (f: number): string => lows[Math.floor(f * (lows.length - 1))].toFixed(0);
    console.log(`  ${JSON.stringify(p)} lowering p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} p99.9 ${q(0.999)}; ${ms.toFixed(0)} ms; top1% (${h0[top[top.length - 1]].toFixed(0)} m+) lowered ${topLow.toFixed(1)} m; mean ${(sumLow / land).toFixed(1)} m, max ${maxLow.toFixed(0)} m`);
    console.log(`     after:  ${stats(h, n)}`);
    if (env.EROSION_HOLLOWS) hollows(h, n);
    }
  }
  setWorldSeed(0);
});

/** The largest remaining filled hollows (> 30 m deep): cells, depth, floor, catchment at the spill. */
function hollows(h: Float32Array, n: number): void {
  const d = buildDrainage((north, east) => h[Math.round((north + DOMAIN_HALF) / DRAIN_CELL) * n + Math.round((east + DOMAIN_HALF) / DRAIN_CELL)]);
  const seen = new Uint8Array(h.length);
  const out: string[] = [];
  const found: Array<{ cells: number; depth: number; floor: number; level: number; spillA: number; at: string }> = [];
  for (let c = 0; c < h.length; c++) {
    if (seen[c] || d.filled[c] - d.height[c] < 1) continue;
    const st = [c]; seen[c] = 1; let cells = 0, depth = 0, floor = Infinity, level = 0, spillA = 0, ci = 0;
    while (st.length) {
      const q = st.pop()!; cells++;
      const dd = d.filled[q] - d.height[q]; if (dd > depth) { depth = dd; ci = q; } floor = Math.min(floor, d.height[q]); level = Math.max(level, d.filled[q]);
      const r = d.receiver[q]; if (r >= 0 && d.filled[r] - d.height[r] < 1) spillA = Math.max(spillA, d.area[r]);
      const i = Math.floor(q / n), j = q % n;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue; const nb = ii * n + jj; if (!seen[nb] && d.filled[nb] - d.height[nb] >= 1) { seen[nb] = 1; st.push(nb); } }
    }
    if (depth > 30) found.push({ cells, depth, floor, level, spillA, at: `${(Math.floor(ci / n) - (n - 1) / 2)},${(ci % n) - (n - 1) / 2}` });
  }
  found.sort((a, b) => b.cells * b.depth - a.cells * a.depth);
  for (const f of found.slice(0, 12)) out.push(`      hollow ${f.cells} cells, ${f.depth.toFixed(0)} m deep, floor ${f.floor.toFixed(0)}, level ${f.level.toFixed(0)}, spill area ${f.spillA.toFixed(0)} km2 at km ${f.at}`);
  console.log(`     ${found.length} hollows >30 m\n` + out.join('\n'));
}
