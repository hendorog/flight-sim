// Probe (design-V one-network, box): ONE flow routing of the ground the water shaped (heightfield naturalHeight: the
// model, its carve and the threshold slopes, no channel carved by the network), priority flood + D8 + one catchment
// field at STEP m over a box, and how the drawn lines (rivers and streams as built) sit on its channels.
//   OR_SEED=42 OR_BOX=-12500,-41500,15000 OR_STEP=50 npx vitest run --config scripts/probes/vitest.config.ts onRoute --silent=false --disable-console-intercept
// (Round V step 0: ported unchanged from design-V/one-network/prototype.patch).
import { it } from 'vitest';
import { hydrology, terrainHeight, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: string | Uint8Array): void; mkdirSync(p: string, o: unknown): void };
type Line = { north: Float64Array; east: Float64Array; s: Float64Array; level: Float64Array; area?: Float64Array; kind?: number };
it('one routing in a box', () => {
  const seed = Number(env.OR_SEED ?? 42);
  const [cn, ce, half] = (env.OR_BOX ?? '-12500,-41500,15000').split(',').map(Number);
  const step = Number(env.OR_STEP ?? 50);
  setWorldSeed(seed);
  terrainHeight(0, 0);
  const N = Math.round((2 * half) / step) + 1;
  const n0 = cn - half;
  const e0 = ce - half;
  const t0 = performance.now();
  const H = new Float64Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) H[y * N + x] = naturalHeight(n0 + y * step, e0 + x * step);
  const tS = performance.now() - t0;
  // Priority flood (Barnes 2014, epsilon) from the box's edge and the sea: the filled surface F; D8 steepest descent on F.
  const F = Float64Array.from(H);
  const done = new Uint8Array(N * N);
  const heap: number[] = [];
  const hk: number[] = [];
  const push = (k: number, v: number): void => {
    heap.push(k); hk.push(v);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= hk[i]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; [hk[p], hk[i]] = [hk[i], hk[p]]; i = p; }
  };
  const pop = (): number => {
    const top = heap[0];
    const lk = heap.pop() as number; const lv = hk.pop() as number;
    if (heap.length) {
      heap[0] = lk; hk[0] = lv;
      let i = 0;
      for (;;) { const l = 2 * i + 1; const r = l + 1; let m = i; if (l < heap.length && hk[l] < hk[m]) m = l; if (r < heap.length && hk[r] < hk[m]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; [hk[m], hk[i]] = [hk[i], hk[m]]; i = m; }
    }
    return top;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = y * N + x;
    if (y === 0 || x === 0 || y === N - 1 || x === N - 1 || H[k] <= 0.5) { done[k] = 1; push(k, F[k]); }
  }
  const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
  const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
  const order: number[] = [];
  const filled = new Float64Array(N * N);
  while (heap.length) {
    const k = pop();
    order.push(k);
    const y = (k / N) | 0; const x = k - y * N;
    for (let d = 0; d < 8; d++) {
      const yy = y + DY[d]; const xx = x + DX[d];
      if (yy < 0 || xx < 0 || yy >= N || xx >= N) continue;
      const q = yy * N + xx;
      if (done[q]) continue;
      done[q] = 1;
      if (F[q] <= F[k]) { filled[q] = F[k] + 1e-4 - F[q]; F[q] = F[k] + 1e-4; }
      push(q, F[q]);
    }
  }
  const rec = new Int32Array(N * N).fill(-1);
  for (let k = 0; k < N * N; k++) {
    const y = (k / N) | 0; const x = k - y * N;
    if (y === 0 || x === 0 || y === N - 1 || x === N - 1) continue;
    let best = 0; let bq = -1;
    for (let d = 0; d < 8; d++) {
      const q = (y + DY[d]) * N + x + DX[d];
      const g = (F[k] - F[q]) / (DY[d] && DX[d] ? Math.SQRT2 : 1);
      if (g > best) { best = g; bq = q; }
    }
    rec[k] = bq;
  }
  const A = new Float64Array(N * N).fill((step * step) / 1e6);
  for (let i = order.length - 1; i >= 0; i--) { const k = order[i]; if (rec[k] >= 0) A[rec[k]] += A[k]; }
  const tR = performance.now() - t0 - tS;
  // Pits the flood filled (closed lows on this ground), by depth.
  let pits = 0; let pits5 = 0; let pitCells = 0;
  for (let k = 0; k < N * N; k++) if (filled[k] > 0.5) { pitCells++; if (filled[k] > 5) pits5++; }
  // The drawn lines in the box (not within 1 km of its edge), every 25 m.
  const L = (hydrology.rivers ?? []) as unknown as Line[];
  const inner = half - 1000;
  const cell = (pn: number, pe: number): number => { const y = Math.round((pn - n0) / step); const x = Math.round((pe - e0) / step); return y < 0 || x < 0 || y >= N || x >= N ? -1 : y * N + x; };
  // distance from a point to the nearest routed channel cell of catchment >= amin (search radius R m)
  const nearChan = (pn: number, pe: number, amin: number, R: number): number => {
    const r = Math.ceil(R / step); const k = cell(pn, pe); if (k < 0) return Infinity;
    const y0 = (k / N) | 0; const x0 = k - y0 * N; let best = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const y = y0 + dy; const x = x0 + dx; if (y < 0 || x < 0 || y >= N || x >= N) continue;
      if (A[y * N + x] < amin) continue;
      const d = Math.hypot(n0 + y * step - pn, e0 + x * step - pe); if (d < best) best = d;
    }
    return best;
  };
  const bands = [[1, 10], [10, 45], [45, 1e9]];
  const lineStats = bands.map(() => ({ km: 0, near50: 0, near100: 0, near250: 0 }));
  const pts: Array<[number, number, number]> = [];
  for (const r of L) {
    let last = -1e9;
    for (let i = 0; i < r.s.length; i++) {
      if (r.s[i] - last < 25 && i < r.s.length - 1) continue;
      last = r.s[i];
      const pn = r.north[i]; const pe = r.east[i];
      if (Math.abs(pn - cn) > inner || Math.abs(pe - ce) > inner) continue;
      const a = r.area?.[i] ?? 0;
      pts.push([pn, pe, a]);
      const b = bands.findIndex(([lo, hi]) => a >= lo && a < hi);
      if (b < 0) continue;
      const d = nearChan(pn, pe, Math.max(0.5, a / 4), 300);
      const st = lineStats[b];
      st.km += 0.025;
      if (d <= 50) st.near50 += 0.025; if (d <= 100) st.near100 += 0.025; if (d <= 250) st.near250 += 0.025;
    }
  }
  // Routed channels (cells >= amin, inside) and how many have a drawn line within 100 m.
  const grid = new Map<number, Array<[number, number, number]>>();
  for (const p of pts) { const g = Math.floor(p[0] / 250) * 100000 + Math.floor(p[1] / 250); (grid.get(g) ?? grid.set(g, []).get(g)!).push(p); }
  const nearLine = (pn: number, pe: number): number => { let best = Infinity; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const p of grid.get((Math.floor(pn / 250) + a) * 100000 + Math.floor(pe / 250) + b) ?? []) { const d = Math.hypot(p[0] - pn, p[1] - pe); if (d < best) best = d; } return best; };
  const chanStats = bands.map(() => ({ km: 0, drawn100: 0, drawn250: 0 }));
  const img = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) {
    const y = (k / N) | 0; const x = k - y * N;
    const pn = n0 + y * step; const pe = e0 + x * step;
    if (A[k] >= 1) img[k] = 1;
    if (Math.abs(pn - cn) > inner || Math.abs(pe - ce) > inner) continue;
    const b = bands.findIndex(([lo, hi]) => A[k] >= lo && A[k] < hi);
    if (b < 0) continue;
    const len = rec[k] >= 0 && Math.abs(rec[k] - k) !== 1 && Math.abs(rec[k] - k) !== N ? step * Math.SQRT2 : step;
    const d = nearLine(pn, pe);
    chanStats[b].km += len / 1000; if (d <= 100) chanStats[b].drawn100 += len / 1000; if (d <= 250) chanStats[b].drawn250 += len / 1000;
  }
  const pc = (a: number, b: number): string => (b > 0 ? ((100 * a) / b).toFixed(0) : '-');
  console.log(`seed ${seed} box ${cn},${ce} half ${half} step ${step}: ${N}x${N} samples ${tS.toFixed(0)} ms, routing ${tR.toFixed(0)} ms; filled cells ${pitCells} (> 5 m ${pits5})`);
  bands.forEach(([lo, hi], b) => {
    const s = lineStats[b]; const c = chanStats[b];
    console.log(`  A ${lo}-${hi >= 1e9 ? '' : hi} km2: drawn ${s.km.toFixed(1)} km, on a routed channel (x0.25 its A) within 50/100/250 m ${pc(s.near50, s.km)}/${pc(s.near100, s.km)}/${pc(s.near250, s.km)} %; routed ${c.km.toFixed(1)} km, a drawn line within 100/250 m ${pc(c.drawn100, c.km)}/${pc(c.drawn250, c.km)} %`);
  });
  if (env.OR_OUT) {
    fs.mkdirSync(env.OR_OUT, { recursive: true });
    const lg = new Uint8Array(N * N);
    for (let k = 0; k < N * N; k++) lg[k] = A[k] <= 0 ? 0 : Math.min(255, Math.round(40 * Math.log10(A[k] / ((step * step) / 1e6)) ));
    fs.writeFileSync(`${env.OR_OUT}/route-s${seed}.u8`, lg);
    fs.writeFileSync(`${env.OR_OUT}/route-s${seed}.json`, JSON.stringify({ N, n0, e0, step, lines: pts.map((p) => [Math.round(p[0]), Math.round(p[1]), Math.round(p[2] * 10) / 10]) }));
  }
});
