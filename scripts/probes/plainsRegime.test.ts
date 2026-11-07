// Probe: rivers' regime and gradient by level band; local (200 m) vs reach (2 km) gradient. PR_SEEDS, PR_LINE.
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('plains regime', () => {
  for (const seed of (process.env.PR_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    const L = hydrology.rivers!;
    const bands = [[0, 200], [200, 400], [400, 700], [700, 5000]];
    for (const [lo, hi] of bands) {
      const reg = [0, 0, 0, 0, 0]; let n = 0; const g2k: number[] = []; const g200: number[] = [];
      L.forEach((r) => {
        if (r.kind !== 0 || !r.regime) return;
        for (let i = 0; i < r.s.length; i++) {
          if (r.level[i] < lo || r.level[i] >= hi) continue;
          reg[r.regime[i]]++; n++;
          let j = i; while (j < r.s.length - 1 && r.s[j] - r.s[i] < 2000) j++;
          if (r.s[j] - r.s[i] > 1500) g2k.push((r.level[i] - r.level[j]) / (r.s[j] - r.s[i]));
          g200.push(r.gradient![i]);
        }
      });
      const q = (a: number[], f: number) => { const b = a.slice().sort((x, y) => x - y); return (100 * b[Math.floor(f * b.length)]).toFixed(2); };
      console.log(`seed ${seed} level ${lo}-${hi} m: n ${n}, placid ${(100 * reg[0] / n).toFixed(0)} % riffle ${(100 * reg[1] / n).toFixed(0)} % rapids ${(100 * reg[2] / n).toFixed(0)} % steppool ${(100 * reg[3] / n).toFixed(0)} % fall ${(100 * reg[4] / n).toFixed(1)} %; gradient 200 m p50/p90 ${q(g200, 0.5)}/${q(g200, 0.9)} %, over 2 km p50/p90 ${q(g2k, 0.5)}/${q(g2k, 0.9)} %`);
    }
    const li = Number(process.env.PR_LINE ?? 308);
    if (seed === 42 && L[li]) {
      const r = L[li];
      const out: string[] = [];
      for (let i = 0; i < r.s.length; i += Math.max(1, Math.floor(r.s.length / 25))) out.push(`${(r.s[i] / 1000).toFixed(1)}km ${r.level[i].toFixed(0)}m g${(100 * r.gradient![i]).toFixed(1)}% R${r.regime![i]} A${r.area![i].toFixed(0)}`);
      console.log(`line ${li}: ` + out.join(' | '));
    }
  }
  setWorldSeed(0);
});
