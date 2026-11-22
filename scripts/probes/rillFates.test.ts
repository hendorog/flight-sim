// Rill fates (probe): on a 16 m ground raster with plain steepest descent and a bounded pit spill (rillGrid.ts), where
// does each rill (from RILL_MIN km²) end: on a global line (Hydrology.rivers: within its half-width + a cell + 5 m) or in
// standing / river water ('handoff'), in a pit deeper than the spill allows ('sink'), at RILL_MAX km² ('amax'), or at the
// window's edge? With the area at the end, and how far each catchment reaches beyond its own 1024 m block (for the
// fixed ring of blocks a rill block reads). Maps: rills coloured by fate, sink basins tinted red, global lines orange.
//   RILL_SEEDS=42,1,777777 RILL_WINDOWS=2 RILL_HALF=8000 RILL_STEP=16 RILL_MIN=0.05 RILL_MAX=40 RILL_DIR=out/rills
import { it } from 'vitest';
import { hydrology, naturalHeightCoarse, naturalHeightRaw, naturalHeightSmooth } from '../../src/world/terrain/heightfield';
import type { FlowHit } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';
import { png } from './png';
import { accumulate, descend, DE, DN, hollow, raster, spillDepth } from './rillGrid';

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: Uint8Array | string): void; mkdirSync(p: string, o: object): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

const hit: FlowHit = { dist: Infinity, side: 0, line: -1, kind: 0, index: 0, s: 0, level: 0, halfWidth: 0, gradient: 0, steepness: 0, regime: 0, speed: 0, dirN: 0, dirE: 0 };
const pct = (a: number[], p: number): number => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN);


/** Priority-flood fill depth of each cell of a raster's ground (its edge open), m. */
function fillDepth(g: Float64Array, n: number): Float64Array {
  const f = new Float64Array(n * n).fill(Infinity);
  const heap: number[] = [];
  const up = (k: number): void => { while (k > 0) { const p = (k - 1) >> 1; if (f[heap[p]] <= f[heap[k]]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = (): number => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l; if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  for (let i = 0; i < n * n; i++) { const x = i % n, y = (i / n) | 0; if (x === 0 || y === 0 || x === n - 1 || y === n - 1) { f[i] = g[i]; heap.push(i); up(heap.length - 1); } }
  while (heap.length) {
    const c = pop();
    const cx = c % n, cy = (c / n) | 0;
    for (let k = 0; k < 8; k++) {
      const xx = cx + DE[k], yy = cy + DN[k];
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const j = yy * n + xx;
      if (f[j] !== Infinity) continue;
      f[j] = Math.max(g[j], f[c]);
      heap.push(j);
      up(heap.length - 1);
    }
  }
  for (let i = 0; i < n * n; i++) f[i] -= g[i];
  return f;
}

it('rill fates', () => {
  const seeds = (env.RILL_SEEDS ?? '42,1,777777').split(',').map(Number);
  const nWin = Number(env.RILL_WINDOWS ?? 2);
  const half = Number(env.RILL_HALF ?? 8000);
  const step = Number(env.RILL_STEP ?? 16);
  const amin = Number(env.RILL_MIN ?? 0.05);
  const amax = Number(env.RILL_MAX ?? 40);
  const radius = Number(env.RILL_SPILL_R ?? 6);
  const depth = Number(env.RILL_SPILL_D ?? 2);
  const dir = env.RILL_DIR ?? 'out/rills';
  fs.mkdirSync(dir, { recursive: true });
  const out: string[] = [];
  const BLOCK = 1024;
  for (const seed of seeds) {
    setWorldSeed(seed);
    const rivers = hydrology.rivers ?? [];
    const cand: Array<{ n: number; e: number; relief: number }> = [];
    for (const r of rivers) {
      if (r.kind !== 1 || r.level[0] < 900) continue;
      let j = 0;
      while (j < r.s.length - 1 && r.s[j] < 1500) j++;
      const n0 = r.north[j], e0 = r.east[j];
      if (Math.abs(n0) > 140000 || Math.abs(e0) > 140000) continue;
      let lo = Infinity, hi = -Infinity;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
        const h = naturalHeightSmooth(n0 + a * 1000, e0 + b * 1000);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      cand.push({ n: n0, e: e0, relief: hi - lo });
    }
    cand.sort((a, b) => b.relief - a.relief);
    const wins: typeof cand = [];
    for (const c of cand) {
      if (wins.length >= nWin) break;
      if (wins.every((w) => Math.hypot(w.n - c.n, w.e - c.e) > 20000)) wins.push(c);
    }
    // RILL_WINS='42@-44992,-9504 42@-23664,71632 ...': these windows instead (the same ground before and after a change).
    if (env.RILL_WINS) {
      wins.length = 0;
      for (const w of env.RILL_WINS.split(/\s+/)) {
        const [sd, at] = w.split('@');
        if (Number(sd) !== seed) continue;
        const [wn, we] = at.split(',').map(Number);
        wins.push({ n: wn, e: we, relief: 0 });
      }
    }
    for (const [wi, w] of wins.entries()) {
      const cn = Math.round(w.n / step) * step, ce = Math.round(w.e / step) * step;
      const t0 = performance.now();
      // RILL_ROUTE: route over another ground instead of sampleTerrain's: 'smooth' naturalHeightSmooth (no small relief,
      // 3 gully octaves), 'coarse' naturalHeightCoarse (no gullies nor small relief, eroded), 'raw' naturalHeightRaw (all the
      // detail, before the erosion pass cut the valleys).
      const route = { smooth: naturalHeightSmooth, coarse: naturalHeightCoarse, raw: naturalHeightRaw } as Record<string, (n: number, e: number) => number>;
      const g = raster(cn, ce, half, step, env.RILL_ROUTE ? route[env.RILL_ROUTE] : undefined);
      const tR = performance.now() - t0;
      const t1 = performance.now();
      const pit = descend(g, radius, depth);
      const box = new Int32Array(g.n * g.n * 4);
      accumulate(g, box);
      const tD = performance.now() - t1;
      // The smooth ground (no small relief, no finest gullies) for the pit comparison.
      const gs = raster(cn, ce, half, step * 2, naturalHeightSmooth);
      const pitS = descend(gs, radius, depth);
      const n = g.n;
      // The eroded macro ground (no gullies nor small relief): a sink in one of its own closed basins (filled > 0.25 m
      // there, RILL_MACRO) is the macro ground's hollow, not the detail's.
      const macroBasin = fillDepth(raster(cn, ce, half, step, naturalHeightCoarse).ground, n);
      let sinkMacro = 0;
      const big = new Uint8Array(n * n);
      for (let i = 0; i < n * n; i++) if (g.area[i] >= amin && g.to[i] >= 0) big[g.to[i]] = 1;
      // Heads in the inner half of the window (their catchment inside it).
      const inner = (i: number): boolean => { const x = i % n, y = (i / n) | 0; return x > n / 4 && x < (3 * n) / 4 && y > n / 4 && y < (3 * n) / 4; };
      const fate = new Uint8Array(n * n); // 0 none, 1 handoff, 2 sink, 3 amax, 4 edge
      const fates = [0, 0, 0, 0, 0];
      const endArea: number[][] = [[], [], [], [], []];
      const endLen: number[] = [];
      let heads = 0, hollowHeads = 0;
      const pathOf: number[][] = [];
      const sinkRise: number[] = [];
      const sinkNear: number[] = [];
      for (let i = 0; i < n * n; i++) {
        if (g.area[i] < amin || big[i] || g.water[i] || !inner(i)) continue;
        heads++;
        if (hollow(g, i, 2) > 0.3) hollowHeads++;
        let j = i, len = 0;
        const path = [i];
        let f = 0;
        for (;;) {
          if (g.water[j]) { f = 1; break; }
          const north = g.north0 - ((j / n) | 0) * step, east = g.east0 + (j % n) * step;
          hydrology.queryFlow!(north, east, hit);
          if (hit.line >= 0 && hit.dist <= hit.halfWidth + step + 5) { f = 1; break; }
          if (g.area[j] >= amax) { f = 3; break; }
          const t = g.to[j];
          if (t === -2) { f = 2; break; }
          if (t < 0) { f = 4; break; }
          len += Math.hypot(((t / n) | 0) - ((j / n) | 0), (t % n) - (j % n)) * step;
          j = t;
          path.push(j);
        }
        fates[f]++;
        if (f === 2) {
          if (macroBasin[j] > Number(env.RILL_MACRO ?? 0.25)) sinkMacro++;
          const sp = spillDepth(g, j, 60, 80);
          sinkRise.push(sp.rise);
          const north = g.north0 - ((j / n) | 0) * step, east = g.east0 + (j % n) * step;
          hydrology.queryFlow!(north, east, hit);
          let wd = Infinity;
          const jx = j % n, jy = (j / n) | 0;
          for (let dy = -40; dy <= 40; dy++) for (let dx = -40; dx <= 40; dx++) {
            const xx = jx + dx, yy = jy + dy;
            if (xx >= 0 && yy >= 0 && xx < n && yy < n && g.water[yy * n + xx]) wd = Math.min(wd, Math.hypot(dx, dy) * step);
          }
          sinkNear.push(Math.min(wd, hit.line >= 0 ? hit.dist - hit.halfWidth : Infinity));
        }
        endArea[f].push(g.area[j]);
        if (f === 1) endLen.push(len);
        for (const p of path) if (!fate[p] || f === 1) fate[p] = f;
        pathOf.push(path);
      }
      // Catchment reach beyond the cell's own block, m, by area class (cells in the inner half whose box is inside).
      const bins = [0.2, 1, 3, 10, 40];
      const reach: number[][] = bins.map(() => []);
      for (let i = 0; i < n * n; i++) {
        if (!inner(i) || g.water[i] || g.area[i] < amin) continue;
        const b = bins.findIndex((v) => g.area[i] < v);
        if (b < 0) continue;
        if (box[i * 4] === 0 || box[i * 4 + 1] === 0 || box[i * 4 + 2] === n - 1 || box[i * 4 + 3] === n - 1) continue;
        const x = i % n, y = (i / n) | 0;
        const east = g.east0 + x * step, north = g.north0 - y * step;
        const bx0 = Math.floor(east / BLOCK) * BLOCK, by0 = Math.floor(north / BLOCK) * BLOCK;
        const e0 = g.east0 + box[i * 4] * step, e1 = g.east0 + box[i * 4 + 2] * step;
        const n1 = g.north0 - box[i * 4 + 1] * step, n0 = g.north0 - box[i * 4 + 3] * step;
        reach[b].push(Math.max(0, bx0 - e0, e1 - (bx0 + BLOCK), by0 - n0, n1 - (by0 + BLOCK)));
      }
      const line = `seed ${seed} win ${wi} centre ${cn},${ce} (${n}² cells of ${step} m; raster ${tR.toFixed(0)} ms = ${((tR * 1000) / (n * n)).toFixed(2)} µs/sample, descend+accumulate ${tD.toFixed(0)} ms)\n` +
        `  pits ${pit.pits} (${((100 * pit.pits) / (n * n)).toFixed(2)} % of cells): spilled ${pit.spilled}, sinks ${pit.sinks}; smooth ground (${step * 2} m): pits ${pitS.pits}, sinks ${pitS.sinks}\n` +
        `  heads (>= ${amin} km², inner half) ${heads}, in a hollow ${hollowHeads}; fates: handoff ${fates[1]}, sink ${fates[2]} (${((100 * fates[2]) / heads).toFixed(0)} %; in a basin of the eroded macro ground ${sinkMacro}, detail hollows ${((100 * (fates[2] - sinkMacro)) / heads).toFixed(0)} %), amax ${fates[3]}, edge ${fates[4]}\n` +
        `  area at handoff km²: p10 ${pct(endArea[1], 0.1).toFixed(2)} p50 ${pct(endArea[1], 0.5).toFixed(2)} p90 ${pct(endArea[1], 0.9).toFixed(2)} max ${pct(endArea[1], 1).toFixed(1)}; length p50 ${pct(endLen, 0.5).toFixed(0)} p90 ${pct(endLen, 0.9).toFixed(0)} m\n` +
        `  area at sink km²: p50 ${pct(endArea[2], 0.5).toFixed(2)} p90 ${pct(endArea[2], 0.9).toFixed(2)}; spill rise m: p25 ${pct(sinkRise, 0.25).toFixed(1)} p50 ${pct(sinkRise, 0.5).toFixed(1)} p75 ${pct(sinkRise, 0.75).toFixed(1)} p90 ${pct(sinkRise, 0.9).toFixed(1)}; to water/line m: p25 ${pct(sinkNear, 0.25).toFixed(0)} p50 ${pct(sinkNear, 0.5).toFixed(0)} p75 ${pct(sinkNear, 0.75).toFixed(0)}\n` +
        bins.map((b, k) => `  catchment reach beyond its 1024 m block, A < ${b} km²: p50 ${pct(reach[k], 0.5).toFixed(0)} p90 ${pct(reach[k], 0.9).toFixed(0)} p99 ${pct(reach[k], 0.99).toFixed(0)} max ${pct(reach[k], 1).toFixed(0)} m (${reach[k].length})`).join('\n');
      console.log(line);
      out.push(line);
      // Map.
      const rgb = new Uint8Array(n * n * 3);
      // Cells draining to a sink (follow each cell; memo).
      const toSink = new Int8Array(n * n).fill(-1);
      const sinkOf = (i: number): number => {
        const stack: number[] = [];
        let j = i;
        while (toSink[j] < 0) {
          stack.push(j);
          const t = g.to[j];
          if (t === -2) { toSink[j] = 1; stack.pop(); break; }
          if (t < 0) { toSink[j] = 0; stack.pop(); break; }
          j = t;
        }
        const v = toSink[j];
        for (const s of stack) toSink[s] = v;
        return v;
      };
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const hx = g.ground[y * n + Math.min(n - 1, x + 1)] - g.ground[y * n + Math.max(0, x - 1)];
        const hy = g.ground[Math.max(0, y - 1) * n + x] - g.ground[Math.min(n - 1, y + 1) * n + x];
        const shade = Math.min(1.25, Math.max(0.35, 0.8 + ((-hx + hy) / (2 * step)) * 0.6));
        let c = [205 * shade, 195 * shade, 175 * shade];
        if (g.water[i]) c = [90, 130, 200];
        else if (sinkOf(i)) c = [c[0] * 0.7 + 70, c[1] * 0.7, c[2] * 0.7];
        rgb.set(c.map((v) => Math.max(0, Math.min(255, v))), i * 3);
      }
      const col = [[0, 0, 0], [20, 70, 230], [200, 0, 0], [160, 0, 200], [90, 90, 90]];
      for (const path of pathOf) for (const p of path) {
        const r = g.area[p] > 2 ? 1 : 0;
        const x = p % n, y = (p / n) | 0;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < n && yy < n) rgb.set(col[fate[p]], (yy * n + xx) * 3);
        }
      }
      for (const r of rivers) {
        for (let j = 0; j + 1 < r.north.length; j++) {
          const segs = Math.ceil(Math.hypot(r.north[j + 1] - r.north[j], r.east[j + 1] - r.east[j]) / (step / 2));
          for (let t = 0; t <= segs; t++) {
            const nn = r.north[j] + ((r.north[j + 1] - r.north[j]) * t) / segs;
            const ee = r.east[j] + ((r.east[j + 1] - r.east[j]) * t) / segs;
            const x = Math.round((ee - g.east0) / step), y = Math.round((g.north0 - nn) / step);
            if (x >= 0 && y >= 0 && x < n && y < n) rgb.set([255, 140, 0], (y * n + x) * 3);
          }
        }
      }
      fs.writeFileSync(`${dir}/fates-s${seed}-w${wi}.png`, png(n, n, rgb));
    }
  }
  fs.writeFileSync(`${dir}/fates.txt`, out.join('\n') + '\n');
  setWorldSeed(0);
});
