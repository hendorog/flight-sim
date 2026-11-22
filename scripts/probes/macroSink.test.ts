// Probe (A1b): the rill heads' sinks in closed basins of the eroded macro ground (naturalHeightCoarse filled > 0.25 m
// on a 16 m raster, as rillFates): does the 1 km drainage lattice see the basin (its cell, or one of its neighbours, in
// a filled region of the lattice before the drainage's breach cuts: `height`), and was it cut in the routing (`routed`
// below `height` on the cells round it)? Per window: heads by class, and the basins' fill depth on the 16 m raster.
//   RILL_WINS='42@-23664,71632 ...' MS_HALF=8000
import { it } from 'vitest';
import { hydrology, naturalHeightCoarse } from '../../src/world/terrain/heightfield';
import type { FlowHit } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';
import { accumulate, descend, raster, DN, DE } from './rillGrid';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const hit: FlowHit = { dist: Infinity, side: 0, line: -1, kind: 0, index: 0, s: 0, level: 0, halfWidth: 0, gradient: 0, steepness: 0, regime: 0, speed: 0, dirN: 0, dirE: 0 };
function fill(g: Float64Array | Float32Array, n: number): Float64Array {
  const f = new Float64Array(n * n).fill(Infinity);
  const heap: number[] = [];
  const up = (k: number): void => { while (k > 0) { const p = (k - 1) >> 1; if (f[heap[p]] <= f[heap[k]]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = (): number => { const t = heap[0]; const l = heap.pop()!; if (heap.length) { heap[0] = l; let k = 0; for (;;) { const a = 2 * k + 1, b = a + 1; let m = k; if (a < heap.length && f[heap[a]] < f[heap[m]]) m = a; if (b < heap.length && f[heap[b]] < f[heap[m]]) m = b; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return t; };
  for (let i = 0; i < n * n; i++) { const x = i % n, y = (i / n) | 0; if (x === 0 || y === 0 || x === n - 1 || y === n - 1 || g[i] <= 0) { f[i] = g[i]; heap.push(i); up(heap.length - 1); } }
  while (heap.length) { const c = pop(); const cx = c % n, cy = (c / n) | 0; for (let k = 0; k < 8; k++) { const xx = cx + DE[k], yy = cy + DN[k]; if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue; const j = yy * n + xx; if (f[j] !== Infinity) continue; f[j] = Math.max(g[j], f[c]); heap.push(j); up(heap.length - 1); } }
  for (let i = 0; i < n * n; i++) f[i] -= g[i];
  return f;
}
it('macro sinks', () => {
  const half = Number(env.MS_HALF ?? 8000), step = 16;
  const wins = (env.RILL_WINS ?? '42@-23664,71632').split(/\s+/).map((w) => { const [sd, at] = w.split('@'); const [n, e] = at.split(',').map(Number); return { seed: Number(sd), n, e }; });
  let lastSeed = -1;
  let latFill: Float64Array | null = null;
  for (const w of wins) {
    if (w.seed !== lastSeed) { setWorldSeed(w.seed); lastSeed = w.seed; latFill = null; }
    const d = (hydrology.lakeMask as unknown as { d: { n: number; origin: number; height: Float32Array; routed: Float32Array; cutWhy: Uint8Array } }).d;
    latFill ??= fill(d.height, d.n);
    const cn = Math.round(w.n / step) * step, ce = Math.round(w.e / step) * step;
    const g = raster(cn, ce, half, step);
    descend(g, 6, 2);
    accumulate(g);
    const n = g.n;
    const basin = fill(raster(cn, ce, half, step, naturalHeightCoarse).ground, n);
    const big = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) if (g.area[i] >= 0.05 && g.to[i] >= 0) big[g.to[i]] = 1;
    const inner = (i: number): boolean => { const x = i % n, y = (i / n) | 0; return x > n / 4 && x < (3 * n) / 4 && y > n / 4 && y < (3 * n) / 4; };
    const cls: Record<string, number> = {};
    let heads = 0;
    const depths: number[] = [];
    for (let i = 0; i < n * n; i++) {
      if (g.area[i] < 0.05 || big[i] || g.water[i] || !inner(i)) continue;
      heads++;
      let j = i;
      for (;;) {
        if (g.water[j]) break;
        hydrology.queryFlow!(g.north0 - ((j / n) | 0) * step, g.east0 + (j % n) * step, hit);
        if (hit.line >= 0 && hit.dist <= hit.halfWidth + step + 5) break;
        const t = g.to[j];
        if (t === -2) {
          if (basin[j] > 0.25) {
            const north = g.north0 - ((j / n) | 0) * step, east = g.east0 + (j % n) * step;
            const ci = Math.round((north - d.origin) / 1000), cj = Math.round((east - d.origin) / 1000);
            let lf = 0, cut = 0;
            for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const c = (ci + a) * d.n + cj + b; lf = Math.max(lf, latFill![c]); cut = Math.min(cut, d.routed[c] - d.height[c]); }
            const k = lf > 0.25 ? (cut < -0.25 ? 'lattice-hollow-cut' : 'lattice-hollow-uncut') : 'sub-lattice';
            cls[k] = (cls[k] ?? 0) + 1;
            depths.push(basin[j]);
          } else cls.detail = (cls.detail ?? 0) + 1;
          break;
        }
        if (t < 0) break;
        j = t;
      }
    }
    depths.sort((a, b) => a - b);
    const q = (f: number): string => (depths.length ? depths[Math.floor(f * (depths.length - 1))].toFixed(1) : '-');
    console.log(`MACROSINK seed ${w.seed} ${cn},${ce}: heads ${heads}; ${JSON.stringify(cls)}; macro basin fill at sink m p25 ${q(0.25)} p50 ${q(0.5)} p90 ${q(0.9)}`);
  }
  setWorldSeed(0);
});
