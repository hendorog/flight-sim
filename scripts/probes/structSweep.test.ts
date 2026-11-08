// Probe (foundation stage 3): the macro model over a seed's own inputs (heightfield.ts seededInputs) with a choice of
// structure settings (structure.ts), measured on the lattice alone: the drainage-tree gates in relief classes
// (treeMetrics.ts, routed by steepest descent on T as orogenSweep does), heights, the hollows left (kept lakes), the
// front block's area and the rivers held through it.
//   SW_SEEDS=1,42,777777 SW_SETS='{};{"blockRate":0.6}' SW_OUT=out/f3/sweep
import { it } from 'vitest';
import { buildDrainage, DOMAIN_HALF, DRAIN_CELL } from '../../src/world/terrain/drainage';
import * as ero from '../../src/world/terrain/erosion';
const { steadyLattice, STEADY } = ero;
import * as hf from '../../src/world/terrain/heightfield';
import { buildFaults } from '../../src/world/terrain/faults';
import { STRUCT, structureFor, type StructParams } from '../../src/world/terrain/structure';
import { setWorldSeed, seeded } from '../../src/world/worldSeed';
import { CLASS_MTN, measureTree, quant, reliefClasses, renderTree, Router } from './treeMetrics';
import { png } from './png';

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: Uint8Array | string): void; mkdirSync(p: string, o: { recursive: boolean }): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const n = Math.round((2 * DOMAIN_HALF) / DRAIN_CELL) + 1;
const N = n * n;
const f0 = (x: number): string => (Number.isFinite(x) ? x.toFixed(0) : '-');

it('structure sweep', () => {
  const sets = (env.SW_SETS ?? '{}').split(';').map((s) => JSON.parse(s) as Partial<StructParams>);
  const out = env.SW_OUT;
  if (out) fs.mkdirSync(out, { recursive: true });
  const summary: string[] = [];
  const pooled = new Map<string, number[]>();
  for (const seed of (env.SW_SEEDS ?? '42').split(',')) {
    setWorldSeed(Number(seed));
    const inp0 = hf.seededInputs;
    if (!inp0) throw new Error('no seeded inputs');
    const faults = buildFaults();
    for (const set of sets) {
      const p: StructParams = { ...STRUCT, ...set };
      const inp = { ...inp0, struct: structureFor(inp0, faults, seeded(0x57c3), p) };
      const t0 = performance.now();
      const T = steadyLattice(inp, STEADY);
      const ms = performance.now() - t0;
      for (let c = 0; c < N; c++) T[c] -= inp.mound[c];
      const label = `s${seed} ${JSON.stringify(set)}`;
      const fixed = new Uint8Array(N);
      for (let c = 0; c < N; c++) fixed[c] = T[c] <= 0 || c < n || c >= N - n || c % n === 0 || c % n === n - 1 ? 1 : 0;
      const R = new Router(n, DRAIN_CELL);
      R.route(T, fixed);
      // The tree as the world's drainage routes it (drainage.ts, over T: what treeMeasure's gate measures), or with
      // SW_ROUTER=1 the steepest-descent router (orogenSweep's).
      const tree = env.SW_ROUTER ? { n, cell: DRAIN_CELL, receiver: R.receiver, area: R.area } : (() => {
        const d = buildDrainage(() => 0, () => 0, undefined, T);
        return { n, cell: DRAIN_CELL, receiver: d.receiver, area: d.area };
      })();
      const cls = reliefClasses(n, T);
      const st = measureTree(`  [relief classes] ${label}`, tree, cls, (c) => T[c] <= 0);
      const land: number[] = [];
      let blockKm = 0;
      for (let c = 0; c < N; c++) {
        if (T[c] > 0) land.push(T[c]);
        if (ero.lastBlock && ero.lastBlock[c] > 0.5) blockKm++;
      }
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
            const pp = ii * n + jj;
            if (!seen[pp] && R.filled[pp] - T[pp] > 0.5) (seen[pp] = 1), st2.push(pp);
          }
        }
      }
      let mtn = 0;
      for (let c = 0; c < N; c++) if (T[c] > 0 && cls[c] === CLASS_MTN) mtn++;
      const txt = st.text.split('\n');
      const pick = (re: RegExp): string => (txt.find((l) => re.test(l)) ?? '').trim();
      console.log(`${label} (${ms.toFixed(0)} ms): land p50/p99/max ${[0.5, 0.99, 1].map((x) => f0(quant(land, x))).join('/')} m; mountain ${f0(mtn)} km²; block ${blockKm} km²; hollows > 15 m ${holes} (kept ${inp.lakes})`);
      console.log(st.text);
      const ex = pick(/largest exit/).match(/p25\/p50\/p75 ([\d.]+)\/([\d.]+)\/([\d.]+)/);
      const j45 = pick(/both >= 45 km²/).match(/inside the ranges (\d+) %/);
      const fr = txt[0].match(/p50\/p90\/p99\/max [\d.]+\/([\d.]+)/);
      const top = pick(/water crossing/).match(/top 1\/3\/5\/10 carry (\d+)\/(\d+)/);
      const nr = pick(/largest exit/).match(/ranges: (\d+);/);
      const mo = (st as unknown as { mouths: Array<{ sea: boolean; topExit: number; area: number; exitSum: number; exits10: number; outlet: number }> }).mouths.filter((m) => m.sea);
      const shares = mo.map((m) => m.topExit / m.area);
      if (env.SW_RIVERS) for (const m of mo) console.log(`  river mouth ${m.outlet} (N ${-DOMAIN_HALF + Math.floor(m.outlet / n) * DRAIN_CELL} E ${-DOMAIN_HALF + (m.outlet % n) * DRAIN_CELL}): ${f0(m.area)} km²; top exit ${f0(m.topExit)} (${((100 * m.topExit) / m.area).toFixed(0)} %), all exits ${f0(m.exitSum)} (${((100 * m.exitSum) / m.area).toFixed(0)} %), top / all exits ${((100 * m.topExit) / m.exitSum).toFixed(0)} %, exits >= 10: ${m.exits10}`);
      const key = JSON.stringify(set);
      pooled.set(key, [...(pooled.get(key) ?? []), ...shares]);
      summary.push(`${label}: exit/mouth p50 ${ex ? ex[2] : '-'} (p25 ${ex ? ex[1] : '-'}, n ${nr ? nr[1] : '-'}); joins45 in ${j45 ? j45[1] : '-'} %; front p90 ${fr ? fr[1] : '-'} km; top3 ${top ? top[2] : '-'} %; hollows ${holes}; block ${blockKm} km²; p99 ${f0(quant(land, 0.99))} m`);
      if (out) {
        const pic = renderTree(n, T, tree, cls, st, 2);
        const tag = Object.entries(set).map(([k, v]) => `${k}${v}`).join('-') || 'base';
        fs.writeFileSync(`${out}/s${seed}-${tag}.png`, png(pic.w, pic.w, pic.rgb));
      }
    }
  }
  console.log('SUMMARY\n' + summary.join('\n'));
  for (const [k, v] of pooled) console.log(`POOLED ${k}: exit/mouth p50 ${quant(v, 0.5).toFixed(2)} mean ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)} n ${v.length}`);
  setWorldSeed(0);
});
