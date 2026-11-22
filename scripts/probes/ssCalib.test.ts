// Probe (foundation stage 1): calibrate the steady-state macro model (erosion.ts steadyLattice) against today's eroded
// lattice (out/f1/before/lat-s<seed>-{raw,eroded,delta}.f32, dumped from cea3349): heights, 5 km relief and 1 km slope
// by field class, and the valley depth on river cells against today's cut there (riverNetwork.ts PIN_CUT).
//   CAL_SEEDS=1,42,777777 CAL_SETS="450,0.2,0.03,0.6;600,0.2,0.03,0.6" npx vitest run --config scripts/probes/vitest.config.ts ssCalib --silent=false
import { it } from 'vitest';
import { DOMAIN_HALF, DRAIN_CELL } from '../../src/world/terrain/drainage';
import { modelInputs, steadyLattice, SteadyRouter, STEADY } from '../../src/world/terrain/erosion';
import { naturalHeightRaw } from '../../src/world/terrain/heightfield';
import { macroAt, type Macro } from '../../src/world/terrain/seededLayout';
import { setWorldSeed } from '../../src/world/worldSeed';
import { AIRPORT } from '../../src/core/world';
import { CLASS_HILL, CLASS_MTN, CLASS_PLAIN, fieldClasses, macroFields, quant, reliefClasses } from './treeMetrics';

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { readFileSync(p: string): Uint8Array };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const GC = Number(env.CAL_GC ?? 0.2);
const n = Math.round((2 * DOMAIN_HALF) / DRAIN_CELL) + 1;
const N = n * n;
const smooth = (e0: number, e1: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const load = (p: string): Float32Array => { const b = fs.readFileSync(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

function relief5(h: Float32Array): Float32Array {
  const out = new Float32Array(N);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    let lo = Infinity, hi = -Infinity;
    for (let a = Math.max(0, i - 2); a <= Math.min(n - 1, i + 2); a++) for (let b = Math.max(0, j - 2); b <= Math.min(n - 1, j + 2); b++) { lo = Math.min(lo, h[a * n + b]); hi = Math.max(hi, h[a * n + b]); }
    out[i * n + j] = hi - lo;
  }
  return out;
}
function stats(label: string, h: Float32Array, cls: Uint8Array, raw: Float32Array): string {
  const rel = relief5(h);
  const parts: string[] = [];
  for (const [name, k] of [['mtn', CLASS_MTN], ['hill', CLASS_HILL], ['plain', CLASS_PLAIN]] as Array<[string, number]>) {
    const hs: number[] = [], rs: number[] = [], ss: number[] = [];
    for (let c = 0; c < N; c++) {
      if (cls[c] !== k) continue;
      hs.push(h[c]); rs.push(rel[c]);
      const i = (c / n) | 0, j = c % n;
      if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) continue;
      ss.push((Math.atan(Math.hypot((h[c + 1] - h[c - 1]) / 2000, (h[c + n] - h[c - n]) / 2000)) * 180) / Math.PI);
    }
    parts.push(`${name} h p50/p90/max ${quant(hs, 0.5).toFixed(0)}/${quant(hs, 0.9).toFixed(0)}/${quant(hs, 1).toFixed(0)} relief5 p50 ${quant(rs, 0.5).toFixed(0)} slope p50 ${quant(ss, 0.5).toFixed(1)}°`);
  }
  let above = 0, land = 0;
  for (let c = 0; c < N; c++) if (raw[c] > 0) (land++, h[c] > raw[c] + 1 && above++);
  const rc = reliefClasses(n, h);
  const k = [0, 0, 0, 0];
  for (let c = 0; c < N; c++) if (raw[c] > 0) k[rc[c]]++;
  const lt = k[1] + k[2] + k[3];
  return `  ${label}: ${parts.join(' | ')} | above noise ${((100 * above) / land).toFixed(0)} % | relief classes m/h/p ${((100 * k[3]) / lt).toFixed(0)}/${((100 * k[2]) / lt).toFixed(0)}/${((100 * k[1]) / lt).toFixed(0)} %`;
}

it('ss calibration', () => {
  const sets = (env.CAL_SETS ?? `${STEADY.ridge},0.2,${STEADY.grade},${STEADY.sc}`).split(';').map((s) => s.split(',').map(Number));
  for (const seed of (env.CAL_SEEDS ?? '42').split(',')) {
    setWorldSeed(seed);
    const raw = load(`out/f1/before/lat-s${seed}-raw.f32`);
    const eroded = load(`out/f1/before/lat-s${seed}-eroded.f32`);
    const delta = load(`out/f1/before/lat-s${seed}-delta.f32`);
    const f = macroFields(n, -DOMAIN_HALF, DRAIN_CELL);
    const cls = fieldClasses(n, f, raw);
    console.log(`seed ${seed}`);
    console.log(stats('noise ground', raw, cls, raw));
    console.log(stats('today eroded', eroded, cls, raw));
    const m: Macro = { inland: 0, uplift: 0, foothill: 0, hilly: 0 };
    for (const [ridge, hillU, grade, sc, mExp] of sets) {
      const inp = modelInputs((pn, pe, out) => {
        out.h = naturalHeightRaw(pn, pe, false);
        macroAt(pn, pe, m);
        const hillAmp = (90 + 260 * smooth(-1000, 7000, m.inland) + 480 * m.foothill) * m.hilly;
        out.u = (m.uplift / 1.15 + (hillU / 830) * hillAmp) * smooth(0, 15000, m.inland);
        out.g = GC + (1 - GC) * smooth(0, 15000, m.inland);
      }, { ...AIRPORT.runway.center, heading: AIRPORT.runway.heading });
      const t0 = performance.now();
      const T = steadyLattice(inp, { ...STEADY, ridge, grade, sc, m: mExp ?? STEADY.m });
      const ms = performance.now() - t0;
      for (let c = 0; c < N; c++) T[c] -= inp.mound[c];
      console.log(stats(`ss ridge ${ridge} hillU ${hillU} grade ${grade} sc ${sc} m ${mExp ?? STEADY.m} (${ms.toFixed(0)} ms)`, T, cls, raw));
      // River cells (>= 45 km² on the model's routing): today's cut there and the model's valley depth (mean of the
      // 5x5 window less the cell, VALLEY_R 2) and the 3x3 one.
      const R = new SteadyRouter(n);
      R.route(T, inp.fixed);
      const cut: number[] = [], v2: number[] = [], v1: number[] = [];
      for (let c = 0; c < N; c++) {
        if (inp.fixed[c] || R.area[c] < 45) continue;
        cut.push(-delta[c]);
        const i = (c / n) | 0, j = c % n;
        for (const [R0, arr] of [[2, v2], [1, v1]] as Array<[number, number[]]>) {
          let s = 0, k = 0;
          for (let a = Math.max(0, i - R0); a <= Math.min(n - 1, i + R0); a++) for (let b = Math.max(0, j - R0); b <= Math.min(n - 1, j + R0); b++) (s += Math.max(0, T[a * n + b])), k++;
          arr.push(Math.max(0, s / k - T[c]));
        }
      }
      const q = (a: number[]): string => [0.25, 0.5, 0.75, 0.9].map((x) => quant(a, x).toFixed(0)).join('/');
      const pinned = (a: number[]): string => `${((100 * a.filter((x) => x >= 50).length) / a.length).toFixed(0)} % >= 50 m`;
      console.log(`    river cells ${cut.length}: today's cut p25/50/75/90 ${q(cut)} (${pinned(cut)}); valley depth R2 ${q(v2)} (${pinned(v2)}); R1 ${q(v1)} (${pinned(v1)})`);
    }
  }
  setWorldSeed(0);
});
