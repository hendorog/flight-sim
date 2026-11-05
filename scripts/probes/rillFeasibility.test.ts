// Rill feasibility (probe): does a seeded world's detail ground (sampleTerrain) carry coherent small gullies that flow
// accumulation follows, or is it noise? Flow accumulation (priority-flood + D8) on sampleTerrain over 6 x 6 km windows
// on mountain hillsides; maps with the channels from RILL_MIN km² (blue, width by area) over a hill shade, the global
// lines (Hydrology.rivers) in red; and measures of coherence:
//   - stability: the share of the 10 m grid's channel cells that lie within 25 m of a channel on a 20 m grid and on a
//     10 m grid offset by half a cell (terrain-controlled channels survive resampling; noise ones do not);
//   - pits: the share of cells raised by the depression fill, and their mean fill depth;
//   - direction: the mean cosine between a channel's D8 step and the downhill direction of the ground smoothed at 300 m;
//   - spacing: channel cells per km² (drainage density, km/km²).
//   RILL_SEEDS=42,1,777777 RILL_WINDOWS=3 RILL_HALF=3000 RILL_STEP=10 RILL_MIN=0.05 RILL_DIR=out/rills
//   npx vitest run --config scripts/probes/vitest.config.ts scripts/probes/rillFeasibility.test.ts
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeightSmooth, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { png } from './png';

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: Uint8Array | string): void; mkdirSync(p: string, o: object): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

const DN = [-1, -1, 0, 1, 1, 1, 0, -1];
const DE = [0, 1, 1, 1, 0, -1, -1, -1];

interface Acc { n: number; step: number; ground: Float64Array; filled: Float64Array; dir: Int8Array; area: Float64Array; water: Uint8Array }

/** Ground on an n x n grid (row 0 north), priority-flood fill with a small epsilon, D8 directions, accumulation (km²). */
function accumulate(cn: number, ce: number, half: number, step: number, off: number): Acc {
  const n = Math.round((2 * half) / step) + 1;
  const ground = new Float64Array(n * n);
  const water = new Uint8Array(n * n);
  const s = makeSample();
  for (let y = 0; y < n; y++) {
    const north = cn + half - y * step - off;
    for (let x = 0; x < n; x++) {
      const east = ce - half + x * step + off;
      sampleTerrain(north, east, s);
      ground[y * n + x] = s.ground;
      water[y * n + x] = Math.max(s.standing, s.river) > s.ground ? 1 : 0;
    }
  }
  // Priority flood (binary heap on the filled height), seeded from the border and from every water cell.
  const filled = new Float64Array(n * n).fill(Infinity);
  const heap: number[] = [];
  const hv = (i: number): number => filled[i];
  const push = (i: number): void => {
    heap.push(i);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (hv(heap[p]) <= hv(heap[k])) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && hv(heap[l]) < hv(heap[m])) m = l;
        if (r < heap.length && hv(heap[r]) < hv(heap[m])) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  const dir = new Int8Array(n * n).fill(-1);
  for (let i = 0; i < n * n; i++) {
    const x = i % n, y = (i / n) | 0;
    if (x === 0 || y === 0 || x === n - 1 || y === n - 1 || water[i]) { filled[i] = ground[i]; push(i); }
  }
  const done = new Uint8Array(n * n);
  const order: number[] = [];
  while (heap.length) {
    const i = pop();
    if (done[i]) continue;
    done[i] = 1;
    order.push(i);
    const x = i % n, y = (i / n) | 0;
    for (let k = 0; k < 8; k++) {
      const xx = x + DE[k], yy = y + DN[k];
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const j = yy * n + xx;
      if (done[j] || filled[j] !== Infinity) continue;
      filled[j] = Math.max(ground[j], filled[i] + 1e-4);
      // The neighbour drains into the cell it was reached from (the flood's tree): follows the fill's flats too.
      dir[j] = (k + 4) & 7;
      push(j);
    }
  }
  // Steepest descent where the cell is not raised by the fill (the flood tree only inside the filled flats).
  for (let i = 0; i < n * n; i++) {
    if (water[i] || filled[i] > ground[i] + 1e-3) continue;
    const x = i % n, y = (i / n) | 0;
    if (x === 0 || y === 0 || x === n - 1 || y === n - 1) { dir[i] = -1; continue; }
    let best = -1, bs = 0;
    for (let k = 0; k < 8; k++) {
      const j = (y + DN[k]) * n + x + DE[k];
      const s2 = (filled[i] - filled[j]) / (k & 1 ? Math.SQRT2 : 1);
      if (s2 > bs) { bs = s2; best = k; }
    }
    if (best >= 0) dir[i] = best;
  }
  const area = new Float64Array(n * n).fill((step * step) / 1e6);
  for (let o = order.length - 1; o >= 0; o--) {
    const i = order[o];
    const k = dir[i];
    if (k < 0 || water[i]) continue;
    const x = i % n, y = (i / n) | 0;
    const j = (y + DN[k]) * n + x + DE[k];
    area[j] += area[i];
  }
  return { n, step, ground, filled, dir, area, water };
}

/** The channel cells (area >= amin) as points (north, east). */
function channelPoints(a: Acc, cn: number, ce: number, half: number, off: number, amin: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < a.n * a.n; i++) {
    if (a.area[i] < amin || a.water[i]) continue;
    const x = i % a.n, y = (i / a.n) | 0;
    pts.push([cn + half - y * a.step - off, ce - half + x * a.step + off]);
  }
  return pts;
}

/** Share of points in `p` within `r` m of a point in `q` (bucket grid). */
function within(p: Array<[number, number]>, q: Array<[number, number]>, r: number): number {
  const cell = r;
  const map = new Map<number, Array<[number, number]>>();
  const key = (a: number, b: number): number => a * 100003 + b;
  for (const pt of q) {
    const k = key(Math.floor(pt[0] / cell), Math.floor(pt[1] / cell));
    (map.get(k) ?? map.set(k, []).get(k)!).push(pt);
  }
  let hit = 0;
  for (const pt of p) {
    const a = Math.floor(pt[0] / cell), b = Math.floor(pt[1] / cell);
    let ok = false;
    for (let da = -1; da <= 1 && !ok; da++) for (let db = -1; db <= 1 && !ok; db++) {
      for (const o of map.get(key(a + da, b + db)) ?? []) if ((o[0] - pt[0]) ** 2 + (o[1] - pt[1]) ** 2 <= r * r) { ok = true; break; }
    }
    if (ok) hit++;
  }
  return p.length ? hit / p.length : NaN;
}

it('rill feasibility', () => {
  const seeds = (env.RILL_SEEDS ?? '42,1,777777').split(',').map(Number);
  const nWin = Number(env.RILL_WINDOWS ?? 3);
  const half = Number(env.RILL_HALF ?? 3000);
  const step = Number(env.RILL_STEP ?? 10);
  const amin = Number(env.RILL_MIN ?? 0.05);
  const dir = env.RILL_DIR ?? 'out/rills';
  fs.mkdirSync(dir, { recursive: true });
  const report: string[] = [];
  for (const seed of seeds) {
    setWorldSeed(seed);
    const rivers = hydrology.rivers ?? [];
    // Windows: centred a little below the heads of streams starting high (> 900 m), on the steepest smooth ground,
    // spread at least 20 km apart, inside +-140 km.
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
    for (const [wi, w] of wins.entries()) {
      const cn = Math.round(w.n / 10) * 10, ce = Math.round(w.e / 10) * 10;
      const t0 = performance.now();
      const A = accumulate(cn, ce, half, step, 0);
      const tA = performance.now() - t0;
      const B = accumulate(cn, ce, half, step * 2, 0);
      const C = accumulate(cn, ce, half, step, step / 2);
      const stats: string[] = [];
      for (const am of [amin, 0.1, 0.2, 0.5]) {
        const pa = channelPoints(A, cn, ce, half, 0, am);
        const pb = channelPoints(B, cn, ce, half, 0, am);
        const pc = channelPoints(C, cn, ce, half, step / 2, am);
        stats.push(`A>=${am}: cells ${pa.length} (${((pa.length * step) / 1000 / ((2 * half) / 1000) ** 2).toFixed(2)} km/km²), within 25/10 m of 20 m grid ${(100 * within(pa, pb, 25)).toFixed(0)}/${(100 * within(pa, pb, 10)).toFixed(0)} %, of offset grid ${(100 * within(pa, pc, 25)).toFixed(0)}/${(100 * within(pa, pc, 10)).toFixed(0)} %`);
      }
      // Pits: cells raised by the fill.
      let raised = 0, depth = 0, land = 0;
      for (let i = 0; i < A.n * A.n; i++) {
        if (A.water[i]) continue;
        land++;
        const d = A.filled[i] - A.ground[i];
        if (d > 0.01) { raised++; depth += d; }
      }
      // Direction vs the 300 m smoothed downhill.
      let cs = 0, cnt = 0;
      const sm = 300;
      for (let i = 0; i < A.n * A.n; i++) {
        if (A.area[i] < amin || A.water[i] || A.dir[i] < 0) continue;
        const x = i % A.n, y = (i / A.n) | 0;
        const north = cn + half - y * step, east = ce - half + x * step;
        const gN = (naturalHeightSmooth(north + sm, east) - naturalHeightSmooth(north - sm, east)) / (2 * sm);
        const gE = (naturalHeightSmooth(north, east + sm) - naturalHeightSmooth(north, east - sm)) / (2 * sm);
        const g = Math.hypot(gN, gE);
        if (g < 0.05) continue;
        const k = A.dir[i];
        const l = Math.hypot(DN[k], DE[k]);
        cs += ((DN[k] / l) * gN - (DE[k] / l) * gE) / g; // a step of DN rows goes -DN north
        cnt++;
      }
      // Sinuosity of the paths from each A>=amin head to A>=1 km² (or the edge).
      let sinu = 0, nh = 0;
      for (let i = 0; i < A.n * A.n; i++) {
        if (A.area[i] < amin || A.water[i]) continue;
        // A head: no upstream neighbour at >= amin.
        const x = i % A.n, y = (i / A.n) | 0;
        let head = true;
        for (let k = 0; k < 8 && head; k++) {
          const xx = x + DE[k], yy = y + DN[k];
          if (xx < 0 || yy < 0 || xx >= A.n || yy >= A.n) continue;
          const j = yy * A.n + xx;
          if (A.dir[j] === ((k + 4) & 7) && A.area[j] >= amin) head = false;
        }
        if (!head) continue;
        let j = i, len = 0;
        while (A.area[j] < 1 && A.dir[j] >= 0 && !A.water[j]) {
          const k = A.dir[j];
          len += k & 1 ? Math.SQRT2 : 1;
          j += DN[k] * A.n + DE[k];
        }
        const dx = (j % A.n) - x, dy = ((j / A.n) | 0) - y;
        const straight = Math.hypot(dx, dy);
        if (straight > 30) { sinu += len / straight; nh++; }
      }
      let lo = Infinity, hi = -Infinity;
      for (const g of A.ground) { lo = Math.min(lo, g); hi = Math.max(hi, g); }
      const line = `seed ${seed} win ${wi} centre ${cn},${ce} ground ${lo.toFixed(0)}..${hi.toFixed(0)} m (accumulate ${tA.toFixed(0)} ms)\n  ` +
        stats.join('\n  ') +
        `\n  pits: ${((100 * raised) / land).toFixed(1)} % of land cells raised by the fill, mean ${(depth / Math.max(1, raised)).toFixed(2)} m` +
        `\n  direction: mean cos(channel step, 300 m downhill) ${(cs / Math.max(1, cnt)).toFixed(2)} over ${cnt} cells` +
        `\n  sinuosity head (${amin} km²) -> 1 km²: ${(sinu / Math.max(1, nh)).toFixed(2)} over ${nh} heads`;
      console.log(line);
      report.push(line);
      // Map: hill shade (from the north-west) of the ground, channels blue (width by area), global lines red.
      const n = A.n;
      const rgb = new Uint8Array(n * n * 3);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const hx = A.ground[y * n + Math.min(n - 1, x + 1)] - A.ground[y * n + Math.max(0, x - 1)];
        const hy = A.ground[Math.max(0, y - 1) * n + x] - A.ground[Math.min(n - 1, y + 1) * n + x];
        const shade = Math.min(1.3, Math.max(0.25, 0.85 + ((-hx + hy) / (2 * step)) * 0.8));
        let c = [200 * shade, 190 * shade, 170 * shade];
        if (A.water[i]) c = [90, 130, 200];
        if (A.filled[i] - A.ground[i] > 0.3) c = [c[0] * 0.8 + 50, c[1] * 0.8, c[2] * 0.8 + 50];
        rgb.set(c.map((v) => Math.max(0, Math.min(255, v))), i * 3);
      }
      for (let i = 0; i < n * n; i++) {
        const a = A.area[i];
        if (a < amin || A.water[i]) continue;
        const x = i % n, y = (i / n) | 0;
        const r = a > 2 ? 2 : a > 0.5 ? 1 : 0;
        const t = Math.min(1, Math.log10(a / amin) / 2);
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < n && yy < n) rgb.set([20, 60 + 60 * (1 - t), 140 + 100 * t], (yy * n + xx) * 3);
        }
      }
      for (const r of rivers) {
        for (let j = 0; j + 1 < r.north.length; j++) {
          const segs = Math.ceil(Math.hypot(r.north[j + 1] - r.north[j], r.east[j + 1] - r.east[j]) / (step / 2));
          for (let t = 0; t <= segs; t++) {
            const nn = r.north[j] + ((r.north[j + 1] - r.north[j]) * t) / segs;
            const ee = r.east[j] + ((r.east[j + 1] - r.east[j]) * t) / segs;
            const x = Math.round((ee - (ce - half)) / step), y = Math.round((cn + half - nn) / step);
            if (x >= 0 && y >= 0 && x < n && y < n) rgb.set(r.kind === 1 ? [230, 40, 40] : [255, 120, 0], (y * n + x) * 3);
          }
        }
      }
      fs.writeFileSync(`${dir}/feas-s${seed}-w${wi}.png`, png(n, n, rgb));
    }
  }
  fs.writeFileSync(`${dir}/feasibility.txt`, report.join('\n') + '\n');
  setWorldSeed(0);
});
