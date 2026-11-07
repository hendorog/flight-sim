// Probe (foundation stage 2): the macro model over a seed's lattice with a choice of orogen and U/K settings, measured
// on the lattice alone (no world build per set): the drainage-tree gates in relief classes (treeMetrics.ts; the tree
// routed by steepest descent on T, as the spike did), the heights, 1 km slopes by relief class, the lattice channels'
// slope by level and catchment band, and the closed hollows left on T (the kept lakes).
//   OS_SEEDS=1,42,777777 OS_SETS="12000,2.2,450,0.5;0,0,450,0.5" (sigma m (0: no orogen), gain, ridge, hill share)
import { it } from 'vitest';
import { DOMAIN_HALF, DRAIN_CELL } from '../../src/world/terrain/drainage';
import { modelInputs, steadyLattice, STEADY } from '../../src/world/terrain/erosion';
import { naturalHeightRaw } from '../../src/world/terrain/heightfield';
import { macroAt, seededOrogen, type Macro } from '../../src/world/terrain/seededLayout';
import { setWorldSeed } from '../../src/world/worldSeed';
import { AIRPORT } from '../../src/core/world';
import { CLASS_HILL, CLASS_MTN, CLASS_PLAIN, measureTree, quant, reliefClasses, renderTree, Router } from './treeMetrics';
import { png } from './png';

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: Uint8Array | string): void; mkdirSync(p: string, o: { recursive: boolean }): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const n = Math.round((2 * DOMAIN_HALF) / DRAIN_CELL) + 1;
const N = n * n;
const smooth = (e0: number, e1: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const f0 = (x: number): string => (Number.isFinite(x) ? x.toFixed(0) : '-');

it('orogen sweep', () => {
  const sets = (env.OS_SETS ?? '12000,2.2,450,0.5').split(';').map((s) => s.split(',').map(Number));
  const out = env.OS_OUT;
  if (out) fs.mkdirSync(out, { recursive: true });
  for (const seed of (env.OS_SEEDS ?? '42').split(',')) {
    setWorldSeed(seed);
    console.log(`seed ${seed}: seed's own orogen ${JSON.stringify(seededOrogen())}`);
    const m: Macro = { inland: 0, uplift: 0, foothill: 0, hilly: 0 };
    const raw = new Float32Array(N);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) raw[i * n + j] = naturalHeightRaw(-DOMAIN_HALF + i * DRAIN_CELL, -DOMAIN_HALF + j * DRAIN_CELL, false);
    for (const [sigma, gain, ridge, hillU, sc, mExp] of sets) {
      let k = 0;
      const inp = modelInputs((pn, pe, o) => {
        o.h = raw[k++];
        macroAt(pn, pe, m);
        const hillAmp = (90 + 260 * smooth(-1000, 7000, m.inland) + 480 * m.foothill) * m.hilly;
        o.u = m.uplift / 1.15;
        o.hill = (hillU / 830) * hillAmp;
        o.fade = smooth(0, 15000, m.inland);
        o.g = 0.5 + 0.5 * smooth(0, 15000, m.inland);
      }, { ...AIRPORT.runway.center, heading: AIRPORT.runway.heading }, sigma > 0 ? { sigma, gain } : null, true);
      const t0 = performance.now();
      const T = steadyLattice(inp, { ...STEADY, ridge, sc: sc || STEADY.sc, m: mExp || STEADY.m });
      const ms = performance.now() - t0;
      for (let c = 0; c < N; c++) T[c] -= inp.mound[c];
      const label = `s${seed} sigma ${sigma} gain ${gain} ridge ${ridge} hillU ${hillU}${sc ? ` sc ${sc}` : ''}${mExp ? ` m ${mExp}` : ''}`;
      const fixed = new Uint8Array(N);
      for (let c = 0; c < N; c++) fixed[c] = T[c] <= 0 || c < n || c >= N - n || c % n === 0 || c % n === n - 1 ? 1 : 0;
      const R = new Router(n, DRAIN_CELL);
      R.route(T, fixed);
      const tree = { n, cell: DRAIN_CELL, receiver: R.receiver, area: R.area };
      const cls = reliefClasses(n, T);
      const st = measureTree(`  [relief classes] ${label}`, tree, cls, (c) => T[c] <= 0);
      // Uplift classes: mountain where the ranges' share (with the envelope) is >= 0.3, hill / plain by relief.
      const clsU = cls.slice();
      for (let c = 0; c < N; c++) if (T[c] > 0) clsU[c] = inp.ur[c] >= 0.3 ? CLASS_MTN : cls[c] === CLASS_MTN ? CLASS_HILL : cls[c];
      const su = measureTree(`  [uplift classes] ${label}`, tree, clsU, (c) => T[c] <= 0);
      // Heights and 1 km slopes.
      const land: number[] = [];
      const sl: number[][] = [[], [], [], []];
      for (let c = 0; c < N; c++) {
        if (T[c] <= 0) continue;
        land.push(T[c]);
        const i = (c / n) | 0, j = c % n;
        if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) continue;
        sl[cls[c]].push((Math.atan(Math.hypot((T[c + 1] - T[c - 1]) / 2000, (T[c + n] - T[c - n]) / 2000)) * 180) / Math.PI);
      }
      const ka = [0, 0, 0, 0];
      for (let c = 0; c < N; c++) if (T[c] > 0) ka[cls[c]]++;
      const lt = ka[1] + ka[2] + ka[3];
      // Channel slope on the lattice by level band and catchment (A >= 45 km²: the drawn rivers).
      const bands: string[] = [];
      for (const [lo, hi] of [[200, 400], [400, 700]]) {
        const parts: string[] = [];
        for (const [aLo, aHi] of [[45, 1e9], [45, 100], [100, 500], [500, 1e9]]) {
          const g: number[] = [];
          for (let c = 0; c < N; c++) {
            const r = R.receiver[c];
            if (r < 0 || R.area[c] < aLo || R.area[c] >= aHi || T[c] < lo || T[c] >= hi) continue;
            const d = ((r / n) | 0) !== ((c / n) | 0) && r % n !== c % n ? Math.SQRT2 : 1;
            g.push((T[c] - Math.max(0, T[r])) / (1000 * d));
          }
          parts.push(`A ${aLo}-${aHi >= 1e9 ? 'inf' : aHi} ${(100 * quant(g, 0.5)).toFixed(2)} % (n ${g.length})`);
        }
        bands.push(`${lo}-${hi} m: ${parts.join(', ')}`);
      }
      // Hollows left on T (> 15 m deep): the kept lakes.
      let holes = 0;
      const seen = new Uint8Array(N);
      for (let c = 0; c < N; c++) {
        if (seen[c] || R.filled[c] - T[c] < 15) continue;
        holes++;
        const st2 = [c];
        seen[c] = 1;
        while (st2.length) {
          const q = st2.pop() as number;
          const i = (q / n) | 0, j = q % n;
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
            const ii = i + a, jj = j + b;
            if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
            const p = ii * n + jj;
            if (!seen[p] && R.filled[p] - T[p] > 0.5) (seen[p] = 1), st2.push(p);
          }
        }
      }
      let above = 0;
      for (let c = 0; c < N; c++) if (raw[c] > 0 && T[c] > raw[c] + 1) above++;
      console.log(`${label} (${ms.toFixed(0)} ms): land h p50/p90/p99/p99.9/max ${[0.5, 0.9, 0.99, 0.999, 1].map((x) => f0(quant(land, x))).join('/')} m; relief classes m/h/p ${f0((100 * ka[3]) / lt)}/${f0((100 * ka[2]) / lt)}/${f0((100 * ka[1]) / lt)} %; 1 km slope p50/p90 mtn ${quant(sl[CLASS_MTN], 0.5).toFixed(1)}/${quant(sl[CLASS_MTN], 0.9).toFixed(1)}°, hill ${quant(sl[CLASS_HILL], 0.5).toFixed(1)}/${quant(sl[CLASS_HILL], 0.9).toFixed(1)}°, plain ${quant(sl[CLASS_PLAIN], 0.5).toFixed(1)}°; above noise ${f0((100 * above) / land.length)} %; kept hollows ${inp.lakes}, hollows > 15 m on T ${holes}`);
      console.log(`  channel slope p50 ${bands.join(' | ')}`);
      console.log(st.text);
      console.log(su.text.split('\n').filter((l) => /largest exit|45 km²: |front cells|Re p50/.test(l)).join('\n'));
      if (out) {
        const pic = renderTree(n, T, tree, cls, st, 2);
        fs.writeFileSync(`${out}/s${seed}-${sigma}-${gain}-${ridge}-${hillU}.png`, png(pic.w, pic.w, pic.rgb));
      }
    }
  }
  setWorldSeed(0);
});
