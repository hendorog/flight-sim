// Probe: how much of the streams runs in a broad breach (RiverLine.breach) and how deep their cuts are.
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
it('breach stats', () => {
  for (const seed of (process.env.H2_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    let n = 0, b = 0, km = 0, bkm = 0; const cuts: number[] = []; const bw: number[] = [];
    for (const r of hydrology.rivers!) {
      if (r.kind !== 1 || !r.breach) continue;
      for (let i = 0; i < r.s.length - 1; i++) { n++; const ds = r.s[i + 1] - r.s[i]; km += ds; cuts.push(r.cut![i]); if (r.breach[i] > 0) { b++; bkm += ds; bw.push(r.breach[i]); } }
    }
    console.log(`BREACH seed ${seed}: stream samples ${n}, in a breach ${b} (${(100 * b / n).toFixed(0)} %), ${(bkm / 1000).toFixed(0)} of ${(km / 1000).toFixed(0)} km; cut p50/p75/p90/p99 ${q(cuts, 0.5).toFixed(1)}/${q(cuts, 0.75).toFixed(1)}/${q(cuts, 0.9).toFixed(1)}/${q(cuts, 0.99).toFixed(1)} m; breach half-width p50/p90/max ${q(bw, 0.5).toFixed(0)}/${q(bw, 0.9).toFixed(0)}/${Math.max(...bw).toFixed(0)} m`);
  }
  setWorldSeed(0);
});
