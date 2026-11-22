// Probe (foundation stage 2): what became of the noise ground's hollows the model kept for lakes (erosion.ts
// keptHollows): for each, its depth on the noise ground, on the model's cells and on the lattice the drainage routes,
// its catchment there, and whether the drainage made a lake of it. LKP_SEEDS.
import { it } from 'vitest';
import { DOMAIN_HALF, DRAIN_CELL } from '../../src/world/terrain/drainage';
import { seededDrainage, seededInputs, seededModel } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { quant, Router } from './treeMetrics';
it('lake keep', () => {
  for (const seed of (process.env.LKP_SEEDS ?? '42').split(',')) {
    setWorldSeed(seed);
    const d = seededDrainage!;
    const inp = seededInputs!;
    const T = seededModel()!.lattice;
    const n = d.n, N = n * n;
    const fixedOf = (h: Float32Array): Uint8Array => Uint8Array.from(h, (v, c) => (v <= 0 || c < n || c >= N - n || c % n === 0 || c % n === n - 1 ? 1 : 0));
    const R0 = new Router(n, DRAIN_CELL); R0.route(inp.h0, inp.fixed);
    const R1 = new Router(n, DRAIN_CELL); R1.route(T, inp.fixed);
    const R2 = new Router(n, DRAIN_CELL); R2.route(d.height, fixedOf(d.height));
    const lakeOf = new Int32Array(N).fill(-1);
    d.lakes.forEach((l, k) => { for (const c of l.cells) lakeOf[c] = k; });
    const seen = new Uint8Array(N);
    const rows: Array<{ d0: number; d1: number; d2: number; a: number; cells: number; lake: boolean; river: boolean; pit: number }> = [];
    for (let c0 = 0; c0 < N; c0++) {
      if (seen[c0] || inp.cap[c0] < 1 || R0.filled[c0] - inp.h0[c0] <= 0.5) continue;
      const st = [c0]; seen[c0] = 1; const cells: number[] = [];
      while (st.length) {
        const c = st.pop()!; cells.push(c);
        const i = (c / n) | 0, j = c % n;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
          const q = ii * n + jj; if (!seen[q] && inp.cap[q] >= 1 && R0.filled[q] - inp.h0[q] > 0.5) (seen[q] = 1), st.push(q);
        }
      }
      let pit = cells[0];
      for (const c of cells) if (inp.h0[c] < inp.h0[pit]) pit = c;
      if (R0.filled[pit] - inp.h0[pit] < 15) continue;
      const lake = cells.some((c) => lakeOf[c] >= 0);
      rows.push({ d0: R0.filled[pit] - inp.h0[pit], d1: R1.filled[pit] - T[pit], d2: R2.filled[pit] - d.height[pit], a: R2.area[pit], cells: cells.length, lake, river: lake && d.lakes[lakeOf[cells.find((c) => lakeOf[c] >= 0)!]].river, pit });
    }
    const q = (a: number[]): string => [0.1, 0.5, 0.9].map((f) => quant(a, f).toFixed(0)).join('/');
    const lost = rows.filter((r) => !r.lake);
    console.log(`seed ${seed}: kept hollows ${rows.length} (inputs say ${inp.lakes}); drainage lakes ${d.lakes.length}; kept hollows with a lake ${rows.length - lost.length}`);
    for (const [name, rs] of [['with a lake', rows.filter((r) => r.lake)], ['lost', lost]] as const) {
      if (!rs.length) continue;
      console.log(`  ${name} ${rs.length}: depth p10/50/90 noise ${q(rs.map((r) => r.d0))}, model ${q(rs.map((r) => r.d1))}, drained lattice ${q(rs.map((r) => r.d2))} m; catchment ${q(rs.map((r) => r.a))} km²; cells ${q(rs.map((r) => r.cells))}`);
    }
    for (const r of lost.slice(0, 12)) console.log(`    lost at N ${-DOMAIN_HALF + Math.floor(r.pit / n) * DRAIN_CELL} E ${-DOMAIN_HALF + (r.pit % n) * DRAIN_CELL}: depth ${r.d0.toFixed(0)}/${r.d1.toFixed(0)}/${r.d2.toFixed(0)} m, A ${r.a.toFixed(0)}, cells ${r.cells}`);
  }
  setWorldSeed(0);
});
