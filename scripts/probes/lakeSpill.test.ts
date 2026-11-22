// Probe (A1b): does each standing lake spill naturally? For every lake pool (not drained), a minimax flood on a fine
// raster (LS_STEP m) of the routing ground (naturalHeightSmooth: no small relief, which the streams take away) from its
// water outward, to the first point that leads on lower: ground LS_DROP under its level outside its water, a line
// (river or stream) whose water stands lower, another lake standing lower, or the sea. The sill's rise over the level,
// per pool, by what leaves it (a river through it, an outlet stream, nothing).
//   STREAM_SEEDS=1,42,777777 LS_STEP=40 LS_DROP=1 LS_OUT=file
import { it } from 'vitest';
import { hydrology, naturalHeight, naturalHeightCoarse, naturalHeightSmooth } from '../../src/world/terrain/heightfield';
import type { FlowHit } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const fs = (globalThis as unknown as { process: { getBuiltinModule(m: string): { writeFileSync(p: string, d: string): void } } }).process.getBuiltinModule('node:fs');
const hit: FlowHit = { dist: Infinity, side: 0, line: -1, kind: 0, index: 0, s: 0, level: 0, halfWidth: 0, gradient: 0, steepness: 0, regime: 0, speed: 0, dirN: 0, dirE: 0 };

it('lake spill', () => {
  const step = Number(env.LS_STEP ?? 40);
  const drop = Number(env.LS_DROP ?? 1);
  const out: string[] = [];
  for (const seed of (env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const mask = hydrology.lakeMask as unknown as { pools: Array<{ lake: number; level: number; wet: number; north: number; east: number; snn: number; see: number; drained?: boolean; spill: number }>; at(n: number, e: number, g?: number): number; poolHit: number; rasterGround(ri: number, rj: number): number; d: { lakes: Array<{ tarn?: boolean; spill: number; level: number; river: boolean }> } };
    const RN = 1281;
    const groundFn = env.LS_GROUND === 'full' ? naturalHeight : env.LS_GROUND === 'coarse' ? naturalHeightCoarse : naturalHeightSmooth;
    const rs = hydrology.rivers ?? [];
    const bins = [0, 1, 2, 3, 5, 10, 25, Infinity];
    const tab: Record<string, number[]> = {};
    const rows: string[] = [];
    mask.pools.forEach((p, id) => {
      if (p.drained) return;
      // What leaves it: a river at its level through it, or a line starting in it.
      let what = 'none';
      for (const r of rs) {
        const lv0 = mask.at(r.north[0], r.east[0]);
        if (lv0 > -Infinity && mask.poolHit === id) { what = (r.kind ?? 0) === 0 ? 'river' : 'outlet'; if (what === 'river') break; }
        if ((r.kind ?? 0) !== 0) continue;
        let thru = false;
        for (let i = 0; i < r.north.length; i += 3) if (Math.abs(r.level[i] - p.level) < 0.05 && mask.at(r.north[i], r.east[i]) > -Infinity && mask.poolHit === id) { thru = true; break; }
        if (thru) { what = 'river'; break; }
      }
      const rad = 3 * Math.sqrt(Math.max(p.snn, p.see)) + 2500;
      const n = Math.round((2 * rad) / step) + 1;
      const n0 = p.north + rad, e0 = p.east - rad;
      const g = new Float64Array(n * n).fill(NaN);
      const G = (i: number): number => { if (g[i] !== g[i]) g[i] = groundFn(n0 - Math.floor(i / n) * step, e0 + (i % n) * step); return g[i]; };
      const key = new Float64Array(n * n).fill(Infinity);
      const heap: number[] = [];
      const up = (k: number): void => { while (k > 0) { const q = (k - 1) >> 1; if (key[heap[q]] <= key[heap[k]]) break; [heap[q], heap[k]] = [heap[k], heap[q]]; k = q; } };
      const pop = (): number => { const t = heap[0]; const l = heap.pop()!; if (heap.length) { heap[0] = l; let k = 0; for (;;) { const a = 2 * k + 1, b = a + 1; let m = k; if (a < heap.length && key[heap[a]] < key[heap[m]]) m = a; if (b < heap.length && key[heap[b]] < key[heap[m]]) m = b; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return t; };
      const own = new Uint8Array(n * n);
      for (let i = 0; i < n * n; i++) {
        const pn = n0 - Math.floor(i / n) * step, pe = e0 + (i % n) * step;
        const lv = mask.at(pn, pe, G(i));
        if (lv > -Infinity && mask.poolHit === id) { own[i] = 1; if (G(i) < p.level) { key[i] = p.level; heap.push(i); up(heap.length - 1); } }
      }
      let sill = Infinity, at = -1, how = '';
      while (heap.length) {
        const i = pop();
        const k = key[i];
        const x = i % n, y = (i / n) | 0;
        if (!own[i]) {
          const pn = n0 - y * step, pe = e0 + x * step;
          const gi = G(i);
          let end = '';
          if (gi <= 0.5) end = 'sea';
          else if (gi < p.level - drop) end = 'lower';
          else {
            const lv = mask.at(pn, pe, gi);
            if (lv > -Infinity && mask.poolHit !== id && lv < p.level) end = 'lake';
            else { hydrology.queryFlow!(pn, pe, hit); if (hit.line >= 0 && hit.dist < hit.halfWidth + 10 && hit.level < p.level - 0.5) end = 'line'; }
          }
          if (end) { sill = k - p.level; at = i; how = end; break; }
        }
        if (x === 0 || y === 0 || x === n - 1 || y === n - 1) continue;
        for (const [a, b] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          const j = (y + a) * n + x + b;
          if (key[j] !== Infinity) continue;
          key[j] = Math.max(k, G(j));
          heap.push(j); up(heap.length - 1);
        }
      }
      const tarn = mask.d.lakes[p.lake].tarn ? 'tarn' : 'lake';
      const cls = `${what}`;
      (tab[cls] ??= bins.map(() => 0))[bins.findIndex((b) => sill <= b)]++;
      (tab[`${cls}-${tarn}`] ??= bins.map(() => 0))[bins.findIndex((b) => sill <= b)]++;
      const L = mask.d.lakes[p.lake];
      const sg = p.spill >= 0 ? mask.rasterGround(Math.floor(p.spill / RN), p.spill % RN) : NaN;
      const why = `lattice spill ${L.spill.toFixed(1)} settled ${L.level.toFixed(1)} raster spill ${sg.toFixed(1)}`;
      if (what === 'none') rows.push(`  ${why} | pool ${id} ${tarn} at ${p.north.toFixed(0)},${p.east.toFixed(0)} level ${p.level.toFixed(1)} sill +${sill.toFixed(1)} (${how}) at ${at < 0 ? '-' : `${(n0 - Math.floor(at / n) * step).toFixed(0)},${(e0 + (at % n) * step).toFixed(0)}`}`);
    });
    const line = `LAKESPILL seed ${seed} (sill rise m, bins <=0/1/2/3/5/10/25/more):\n` + Object.entries(tab).sort().map(([k, v]) => `  ${k}: ${v.join(' ')} (total ${v.reduce((a, b) => a + b, 0)})`).join('\n') + '\n' + rows.join('\n');
    console.log(line);
    out.push(line);
  }
  if (env.LS_OUT) fs.writeFileSync(env.LS_OUT, out.join('\n') + '\n');
  setWorldSeed(0);
});
