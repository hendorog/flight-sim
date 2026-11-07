// Probe (foundation stage 2, task 2): what sets the drawn rivers' 2 km gradient in each level band? For every kind-0
// river sample, the lattice cell under it: its catchment on the world's drainage, the model's uplift rate and grade
// share there (heightfield.ts upliftRate / gradeShare, recomputed from the macro fields), the stream-power slope
// (U/K) u A^-m against the gentlest-gradient floor grade g A^-0.45 (erosion.ts steadyLattice takes the larger), and
// the model lattice's own slope from the cell to its receiver. GF_SEEDS=1,42,777777.
import { it } from 'vitest';
import { DOMAIN_HALF, DRAIN_CELL } from '../../src/world/terrain/drainage';
import { hydrology, seededDrainage, seededInputs } from '../../src/world/terrain/heightfield';
import { STEADY } from '../../src/world/terrain/erosion';
import { macroAt, type Macro } from '../../src/world/terrain/seededLayout';
import { setWorldSeed } from '../../src/world/worldSeed';
import { quant } from './treeMetrics';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const smooth = (e0: number, e1: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const HILL_UPLIFT = Number(env.GF_HILLU ?? 0.5) / 830;
const GRADE_COAST = 0.5;

it('gradient floor', () => {
  for (const seed of (env.GF_SEEDS ?? '1,42,777777').split(',')) {
    setWorldSeed(seed);
    const d = seededDrainage!;
    const n = d.n;
    const T = d.height;
    const m: Macro = { inland: 0, uplift: 0, foothill: 0, hilly: 0 };
    const L = hydrology.rivers!;
    const bands = [[0, 200], [200, 400], [400, 700], [700, 5000]];
    for (const [lo, hi] of bands) {
      for (const [aLo, aHi] of [[0, 1e9], [0, 100], [100, 500], [500, 1e9]]) {
        const g2k: number[] = [], A: number[] = [], sp: number[] = [], fl: number[] = [], lat: number[] = [], us: number[] = [];
        let floorBound = 0, cnt = 0, steep = 0;
        for (const r of L) {
          if ((r.kind ?? 0) !== 0 || !r.area) continue;
          for (let i = 0; i < r.s.length; i++) {
            if (r.level[i] < lo || r.level[i] >= hi) continue;
            let j = i; while (j < r.s.length - 1 && r.s[j] - r.s[i] < 2000) j++;
            if (r.s[j] - r.s[i] <= 1500) continue;
            const ci = Math.max(0, Math.min(n - 1, Math.round((r.north[i] + DOMAIN_HALF) / DRAIN_CELL)));
            const cj = Math.max(0, Math.min(n - 1, Math.round((r.east[i] + DOMAIN_HALF) / DRAIN_CELL)));
            const c = ci * n + cj;
            const a = Math.max(1, d.area[c]);
            if (a < aLo || a >= aHi) continue;
            // (The model's own inputs where the build kept them, stage 2; else stage 1's formula.)
            let u: number, g: number;
            if (seededInputs) {
              u = seededInputs.u[c];
              g = seededInputs.g[c];
            } else {
              macroAt(r.north[i], r.east[i], m);
              const hillAmp = (90 + 260 * smooth(-1000, 7000, m.inland) + 480 * m.foothill) * m.hilly;
              u = Math.max(0, (m.uplift / 1.15 + HILL_UPLIFT * hillAmp) * smooth(0, 15000, m.inland));
              g = GRADE_COAST + (1 - GRADE_COAST) * smooth(0, 15000, m.inland);
            }
            const s1 = (STEADY.ridge / 1000) * u * Math.pow(a, -STEADY.m);
            const s2 = STEADY.grade * g * Math.pow(a, -0.45);
            cnt++;
            if (s2 >= s1) floorBound++;
            if (Math.min(s1 > s2 ? s1 : s2, STEADY.sc) === STEADY.sc) steep++;
            g2k.push((r.level[i] - r.level[j]) / (r.s[j] - r.s[i]));
            A.push(a); sp.push(s1); fl.push(s2); us.push(u);
            const rc = d.receiver[c];
            if (rc >= 0) {
              const di = Math.abs(((rc / n) | 0) - ci) + Math.abs((rc % n) - cj) === 2 ? Math.SQRT2 : 1;
              lat.push((T[c] - T[rc]) / (DRAIN_CELL * di));
            }
          }
        }
        if (!cnt) continue;
        const p = (a: number[], f: number, k = 100): string => (k * quant(a, f)).toFixed(2);
        console.log(`seed ${seed} level ${lo}-${hi} m, A ${aLo}-${aHi >= 1e9 ? 'inf' : aHi} km²: n ${cnt}; 2 km gradient p50/p90 ${p(g2k, 0.5)}/${p(g2k, 0.9)} %; lattice slope p50 ${p(lat, 0.5)} %; A p50 ${quant(A, 0.5).toFixed(0)} km²; u p50 ${quant(us, 0.5).toFixed(3)}; stream-power slope p50 ${p(sp, 0.5)} %, floor p50 ${p(fl, 0.5)} %; floor binds ${((100 * floorBound) / cnt).toFixed(0)} %; Sc binds ${((100 * steep) / cnt).toFixed(0)} %`);
      }
    }
  }
  setWorldSeed(0);
});
