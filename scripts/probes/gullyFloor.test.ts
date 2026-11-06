// Gully floors (probe): on the rill windows (rillFates.test.ts's choice), the share of rill heads (0.05 km², 16 m raster,
// 96 m / 2 m spill) ending in a closed hollow, how many of those hollows lie in a basin of the eroded macro ground
// (naturalHeightCoarse, filled > 1 m there), and how rugged the ground is by that ground's slope (RMS of the detail over it
// and of the relief finer than 80 m). Quick (half-size windows) for trying variants of the detail ground.
//   GF_SEEDS=42,1,777777 GF_WINDOWS=2 GF_HALF=4000 GF_OUT=file GF_PNG=prefix
import { it } from 'vitest';
import { hydrology, naturalHeightCoarse, naturalHeightSmooth } from '../../src/world/terrain/heightfield';
import type { FlowHit } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';
import { accumulate, descend, raster, DN, DE } from './rillGrid';
import { png } from './png';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const hit: FlowHit = { dist: Infinity, side: 0, line: -1, kind: 0, index: 0, s: 0, level: 0, halfWidth: 0, gradient: 0, steepness: 0, regime: 0, speed: 0, dirN: 0, dirE: 0 };

/** Priority-flood fill depth of each cell (edges open). */
function fillDepth(g: Float64Array, n: number): Float64Array {
  const f = new Float64Array(n * n).fill(Infinity);
  const heap: number[] = [];
  const key = (i: number): number => f[i];
  const push = (i: number): void => { heap.push(i); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (key(heap[p]) <= key(heap[k])) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = (): number => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && key(heap[l]) < key(heap[m])) m = l; if (r < heap.length && key(heap[r]) < key(heap[m])) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  for (let i = 0; i < n * n; i++) { const x = i % n, y = (i / n) | 0; if (x === 0 || y === 0 || x === n - 1 || y === n - 1) { f[i] = g[i]; push(i); } }
  while (heap.length) {
    const c = pop();
    const cx = c % n, cy = (c / n) | 0;
    for (let k = 0; k < 8; k++) {
      const xx = cx + DE[k], yy = cy + DN[k];
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const j = yy * n + xx;
      if (f[j] !== Infinity) continue;
      f[j] = Math.max(g[j], f[c]);
      push(j);
    }
  }
  for (let i = 0; i < n * n; i++) f[i] -= g[i];
  return f;
}

const fs = (globalThis as unknown as { process: { getBuiltinModule(m: string): { writeFileSync(p: string, d: string): void } } }).process.getBuiltinModule('node:fs');

it('gully floors', () => {
  const seeds = (env.GF_SEEDS ?? '42,1,777777').split(',').map(Number);
  const nWin = Number(env.GF_WINDOWS ?? 2);
  const half = Number(env.GF_HALF ?? 4000);
  const step = 16;
  const variants = ['ground'];
  const out: string[] = [];
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
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const h = naturalHeightSmooth(n0 + a * 1000, e0 + b * 1000); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      cand.push({ n: n0, e: e0, relief: hi - lo });
    }
    cand.sort((a, b) => b.relief - a.relief);
    const wins: typeof cand = [];
    for (const c of cand) { if (wins.length >= nWin) break; if (wins.every((w) => Math.hypot(w.n - c.n, w.e - c.e) > 20000)) wins.push(c); }
    // GF_WINS='42@-44992,-9504 ...': these windows instead.
    if (env.GF_WINS) {
      wins.length = 0;
      for (const w of env.GF_WINS.split(/\s+/)) { const [sd, at] = w.split('@'); if (Number(sd) !== seed) continue; const [wn, we] = at.split(',').map(Number); wins.push({ n: wn, e: we, relief: 0 }); }
    }
    for (const [wi, w] of wins.entries()) {
      const cn = Math.round(w.n / step) * step, ce = Math.round(w.e / step) * step;
      const gb = raster(cn, ce, half, step, naturalHeightCoarse);
      const n = gb.n;
      const basin = fillDepth(gb.ground, n);
      const row: string[] = [];
      for (const v of variants) {
        const g = raster(cn, ce, half, step);
        const pit = descend(g, 6, 2);
        accumulate(g);
        const big = new Uint8Array(n * n);
        for (let i = 0; i < n * n; i++) if (g.area[i] >= 0.05 && g.to[i] >= 0) big[g.to[i]] = 1;
        const inner = (i: number): boolean => { const x = i % n, y = (i / n) | 0; return x > n / 4 && x < (3 * n) / 4 && y > n / 4 && y < (3 * n) / 4; };
        let heads = 0, sink = 0, sinkB = 0;
        for (let i = 0; i < n * n; i++) {
          if (g.area[i] < 0.05 || big[i] || g.water[i] || !inner(i)) continue;
          heads++;
          let j = i;
          for (;;) {
            if (g.water[j]) break;
            hydrology.queryFlow!(g.north0 - ((j / n) | 0) * step, g.east0 + (j % n) * step, hit);
            if (hit.line >= 0 && hit.dist <= hit.halfWidth + step + 5) break;
            const t = g.to[j];
            if (t === -2) { sink++; if (basin[j] > 1) sinkB++; break; }
            if (t < 0) break;
            j = t;
          }
        }
        if (env.GF_PNG) {
          const rgb = new Uint8Array(n * n * 3);
          for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            const i = y * n + x;
            const hx = g.ground[y * n + Math.min(n - 1, x + 1)] - g.ground[y * n + Math.max(0, x - 1)];
            const hy = g.ground[Math.max(0, y - 1) * n + x] - g.ground[Math.min(n - 1, y + 1) * n + x];
            const sh = Math.min(1.25, Math.max(0.3, 0.8 + ((-hx + hy) / (2 * step)) * 0.6));
            let c = [205 * sh, 195 * sh, 175 * sh];
            if (g.water[i]) c = [90, 130, 200];
            else if (g.to[i] === -2) c = [230, 0, 0];
            else if (g.area[i] >= 0.05) c = [20, 70, 230];
            rgb.set(c.map((q) => Math.max(0, Math.min(255, q))), i * 3);
          }
          for (let i = 0; i < n * n; i++) {
            if (g.to[i] !== -2 || g.area[i] < 0.01) continue;
            const x = i % n, y = (i / n) | 0;
            for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) if (x + b >= 0 && y + a >= 0 && x + b < n && y + a < n && Math.abs(a) + Math.abs(b) >= 3) rgb.set([255, 0, 0], ((y + a) * n + x + b) * 3);
          }
          fs.writeFileSync(`${env.GF_PNG}-s${seed}-w${wi}-${v.replace(/[^a-z0-9.=]+/gi, '_')}.png`, png(n, n, rgb) as unknown as string);
        }
        // Ruggedness by the eroded macro ground's slope: RMS of the detail (ground - macro) and of the fine relief
        // (ground - its 80 m box mean).
        const cls = [0.15, 0.35, 0.6, Infinity];
        const sd = cls.map(() => 0), sf = cls.map(() => 0), cnt = cls.map(() => 0);
        for (let y = 2; y < n - 2; y++) for (let x = 2; x < n - 2; x++) {
          const i = y * n + x;
          if (g.water[i]) continue;
          const sl = Math.hypot(gb.ground[i + 1] - gb.ground[i - 1], gb.ground[i + n] - gb.ground[i - n]) / (2 * step);
          const c = cls.findIndex((q) => sl < q);
          let m = 0;
          for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) m += g.ground[i + a * n + b];
          m /= 25;
          sd[c] += (g.ground[i] - gb.ground[i]) ** 2;
          sf[c] += (g.ground[i] - m) ** 2;
          cnt[c]++;
        }
        const rug = cls.map((q, c) => `${Math.sqrt(sd[c] / Math.max(1, cnt[c])).toFixed(1)}/${Math.sqrt(sf[c] / Math.max(1, cnt[c])).toFixed(2)}`).join(' ');
        row.push(`${v}: rug(<.15 <.35 <.6 >.6: detail/fine m) ${rug}; heads ${heads} sink ${sink} (${((100 * sink) / heads).toFixed(0)} %; in macro basin ${sinkB}, other ${((100 * (sink - sinkB)) / heads).toFixed(0)} %) pits ${pit.pits} sinks ${pit.sinks}`);
      }
      const line = `seed ${seed} win ${wi} ${cn},${ce}\n  ` + row.join('\n  ');
      console.log(line);
      out.push(line);
    }
  }
  setWorldSeed(0);
  if (env.GF_OUT) fs.writeFileSync(env.GF_OUT, out.join('\n') + '\n');
});
