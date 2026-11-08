// Foundation stage 4 steps: the rivers' floor gaps in the threshold hillslopes' mountains (ValleyNear.gap: the ground
// the level was read from over the water's floor), by reach class, and how far their channels swing past the
// floodplain. Every 4th channel sample of each river (kind 0) where the slopes' weight (ErosionSample.mw) is over 0.5.
//   GD_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts gapDump
import { it } from 'vitest';
import { debugMacro, hydrology } from '../../src/world/terrain/heightfield';
import type { ValleyNear } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const pct = (a: number[], q: number): number => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(q * a.length))] : NaN);
it('gap dump', () => {
  for (const seed of (env.GD_SEEDS ?? '1,42,777777').split(',')) {
    setWorldSeed(seed);
    const vs: ValleyNear[] = [];
    const cls: Record<string, number[]> = { 'I<700': [], 'I700-1500': [], 'I>1500': [] };
    let n = 0, out = 0, out100 = 0;
    const perLine: Array<[number, number, number, number]> = [];
    const rivers = hydrology.rivers ?? [];
    rivers.forEach((r, li) => {
      if ((r.kind ?? 0) !== 0) return;
      const gaps: number[] = [];
      let I = 0;
      for (let i = 0; i < r.north.length; i += 4) {
        const dm = debugMacro(r.north[i], r.east[i]);
        if (!dm || dm.s.mw < 0.5) continue;
        const k = hydrology.network!.valleys(r.north[i], r.east[i], vs);
        const v = vs.slice(0, k).find((x) => x.line === li);
        if (!v) continue;
        n++;
        I = v.influence;
        gaps.push(v.gap);
        (v.influence < 700 ? cls['I<700'] : v.influence < 1500 ? cls['I700-1500'] : cls['I>1500']).push(v.gap);
        if (v.dist > v.floodplain) out++;
        if (v.dist > v.floodplain + 100) out100++;
      }
      if (gaps.length) perLine.push([li, I, pct(gaps, 0.5), Math.max(...gaps)]);
    });
    console.log(`seed ${seed}: ${n} channel samples in the slopes; past the floodplain ${out}, past it by 100 m ${out100}`);
    for (const [c, g] of Object.entries(cls)) {
      const bins = [0, 10, 25, 50, 100, 200, 400, 1e9];
      const h = bins.slice(0, -1).map((b, j) => g.filter((x) => x >= b && x < bins[j + 1]).length);
      console.log(`  ${c}: n ${g.length}; gap p50 ${pct(g, 0.5).toFixed(0)} p90 ${pct(g, 0.9).toFixed(0)} p99 ${pct(g, 0.99).toFixed(0)}; bins 0/10/25/50/100/200/400: ${h.join(' ')}`);
    }
    perLine.sort((a, b) => b[2] - a[2]);
    console.log(`  lines by median gap (line, I, median, max): ${perLine.slice(0, 15).map((p) => `${p[0]}:${p[1].toFixed(0)}:${p[2].toFixed(0)}:${p[3].toFixed(0)}`).join(' ')}`);
    console.log(`  lines with median gap < 25: ${perLine.filter((p) => p[2] < 25).length} of ${perLine.length}`);
  }
  setWorldSeed(0);
});
