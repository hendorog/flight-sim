// Rills (rills.ts) over a window: maps (hill shade at RMAP_PX m with the rill beds and water), drainage density, the
// fates of the rill heads (followed down to the network, a sink, or out of a wider window), how many line points sit
// off the gully floor, and the tracer's cost.
//   RILL_WINS='42@-44992,-9504 ...' RMAP_HALF=3000 RMAP_PX=4 RMAP_DIR=out/b/maps RMAP_TAG=b
//   npx vitest run --config scripts/probes/vitest.config.ts scripts/probes/rillMap.test.ts
import { it } from 'vitest';
import { makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { RILL_CELL, rillBedHalf, rillSegments, rillSize, rillWaterHalf, traceRillGraph, RILL_TUNE, RILL_WET_AREA, type RillStats } from '../../src/world/terrain/rills';
import { png } from './png';

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: Uint8Array | string): void; mkdirSync(p: string, o: object): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

export const DEFAULT_WINS = '42@-44992,-9504 42@-23664,71632 1@-62512,21712 1@-28912,76960 777777@-20752,-20992 777777@-104992,37248';

it('rill map', () => {
  const wins = (env.RILL_WINS ?? DEFAULT_WINS).split(/\s+/).filter(Boolean);
  const half = Number(env.RMAP_HALF ?? 3000);
  const px = Number(env.RMAP_PX ?? 4);
  const follow = Number(env.RMAP_FOLLOW ?? 6000);
  const dir = env.RMAP_DIR ?? 'out/b/maps';
  const tag = env.RMAP_TAG ?? 'b';
  const draw = env.RMAP_DRAW !== '0';
  fs.mkdirSync(dir, { recursive: true });
  if (env.RMAP_CONVERGE) RILL_TUNE.converge = Number(env.RMAP_CONVERGE);
  if (env.RMAP_NOISE) RILL_TUNE.noise = Number(env.RMAP_NOISE);
  if (env.RMAP_AREA) RILL_TUNE.area = Number(env.RMAP_AREA);
  const rows: string[] = [];
  const s = makeSample();
  for (const w of wins) {
    const [sd, at] = w.split('@');
    const seed = Number(sd);
    setWorldSeed(seed);
    const [wn, we] = at.split(',').map(Number);
    const cn = Math.round(wn / RILL_CELL);
    const ce = Math.round(we / RILL_CELL);
    // Trace over the follow window (+ margin) so heads in the map window can be followed down.
    const F = Math.round(follow / RILL_CELL) + 80;
    const stats: RillStats = { cells: 0, sampled: 0, channelCells: 0, km: 0, wetKm: 0, toNetwork: 0, toSink: 0, msGround: 0, msTrace: 0, msLines: 0, msRaster: 0 };
    const H = Math.round(half / RILL_CELL);
    const x0 = F - H, x1 = F + H + 1;
    const g = traceRillGraph(ce - F, cn - F, 2 * F + 1, 2 * F + 1, 100, 100, 2 * F - 99, 2 * F - 99, stats);
    const t0 = performance.now();
    const segs = rillSegments(g, x0, x0, x1, x1, stats);
    const msSeg = performance.now() - t0;
    const area = (2 * half / 1000) ** 2;
    let km = 0, wetKm = 0;
    const wet = rillSize(RILL_WET_AREA);
    for (const sg of segs) {
      const l = Math.hypot(sg.e1 - sg.e0, sg.n1 - sg.n0) / 1000;
      km += l;
      if ((sg.s0 + sg.s1) / 2 > wet) wetKm += l;
    }
    // Heads in the map window: followed down.
    const { nx, to, main, net } = g;
    const chan = g.persist;
    let heads = 0;
    const fate = { network: 0, sink: 0, fade: 0, out: 0 };
    const sinkCells = new Set<number>();
    for (let y = x0; y < x1; y++) for (let x = x0; x < x1; x++) {
      const i = y * nx + x;
      if (!chan[i] || main[i] >= 0) continue;
      heads++;
      let j = i;
      for (;;) {
        const t = to[j];
        if (t >= 0 && net[t]) { fate.network++; break; }
        if (t === -2) { fate.sink++; sinkCells.add(j); break; }
        if (t < 0) { fate.out++; break; }
        if (!chan[t]) { fate.fade++; sinkCells.add(j); break; }
        j = t;
      }
    }
    // Off the floor: for each segment's start point, the ground 6 m either side across the segment.
    let pts = 0, ridge = 0, side = 0;
    for (const sg of segs) {
      const de = sg.e1 - sg.e0, dn = sg.n1 - sg.n0;
      const l = Math.hypot(de, dn) || 1;
      const ae = -dn / l, an = de / l;
      const h0 = sampleTerrain(sg.n0, sg.e0, s).ground;
      const ha = sampleTerrain(sg.n0 + an * 6, sg.e0 + ae * 6, s).ground;
      const hb = sampleTerrain(sg.n0 - an * 6, sg.e0 - ae * 6, s).ground;
      pts++;
      if (ha < h0 - 0.3 && hb < h0 - 0.3) ridge++;
      else if (Math.min(ha, hb) < h0 - 1) side++;
    }
    const row = `${tag} s${seed} ${at}: density ${(km / area).toFixed(2)} km/km2 (wet ${(wetKm / area).toFixed(2)}), heads ${heads}: network ${fate.network} (${((100 * fate.network) / heads).toFixed(0)} %), sink ${fate.sink} (${((100 * fate.sink) / heads).toFixed(0)} %), fade ${fate.fade} (${((100 * fate.fade) / heads).toFixed(0)} %), out ${fate.out}; points ${pts}: ridge ${((100 * ridge) / pts).toFixed(1)} %, off-floor >1 m ${((100 * side) / pts).toFixed(1)} %; ms ground ${stats.msGround.toFixed(0)} trace ${stats.msTrace.toFixed(0)} lines ${msSeg.toFixed(0)} (cells ${stats.cells})`;
    rows.push(row);
    console.log(row);
    if (!draw) continue;
    // Map: hill shade at px m, the beds (brown, by width) and water (blue), sinks red.
    const n = Math.round((2 * half) / px);
    const img = new Uint8ClampedArray(n * n * 3);
    const north0 = cn * RILL_CELL + half, east0 = ce * RILL_CELL - half;
    const hRow = new Float64Array((n + 1) * (n + 1));
    for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) hRow[y * (n + 1) + x] = sampleTerrain(north0 - y * px, east0 + x * px, s).ground;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const h = hRow[y * (n + 1) + x];
      const hx = hRow[y * (n + 1) + x + 1] - h;
      const hy = hRow[(y + 1) * (n + 1) + x] - h;
      const sh = Math.min(1.3, Math.max(0.3, 0.85 + (-hx + hy) / px * 0.7));
      sampleTerrain(north0 - y * px, east0 + x * px, s);
      const water = s.standing > s.ground || s.river > s.ground;
      const o = (y * n + x) * 3;
      if (water) { img[o] = 60; img[o + 1] = 110; img[o + 2] = 200; continue; }
      img[o] = 205 * sh; img[o + 1] = 198 * sh; img[o + 2] = 180 * sh;
    }
    const plot = (e: number, nn: number, r: number, c: [number, number, number], a: number): void => {
      const fx = (e - east0) / px, fy = (north0 - nn) / px;
      const rr = Math.max(0.5, r / px);
      for (let y = Math.floor(fy - rr - 1); y <= Math.ceil(fy + rr + 1); y++) for (let x = Math.floor(fx - rr - 1); x <= Math.ceil(fx + rr + 1); x++) {
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const d = Math.hypot(x + 0.5 - fx, y + 0.5 - fy);
        const cov = Math.min(1, Math.max(0, rr + 0.5 - d)) * a;
        if (cov <= 0) continue;
        const o = (y * n + x) * 3;
        for (let k = 0; k < 3; k++) img[o + k] = img[o + k] * (1 - cov) + c[k] * cov;
      }
    };
    for (const pass of [0, 1]) for (const sg of segs) {
      const l = Math.hypot(sg.e1 - sg.e0, sg.n1 - sg.n0);
      const steps = Math.max(1, Math.ceil(l / (px * 0.5)));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const sz = sg.s0 + (sg.s1 - sg.s0) * t;
        const e = sg.e0 + (sg.e1 - sg.e0) * t, nn = sg.n0 + (sg.n1 - sg.n0) * t;
        if (pass === 0) plot(e, nn, rillBedHalf(sz), [70, 55, 35], 0.75);
        else if (rillWaterHalf(sz) > 0) plot(e, nn, Math.max(rillWaterHalf(sz), px * 0.3), [20, 70, 230], 1);
      }
    }
    if (env.RMAP_DEBUG) for (let y = x0; y < x1; y++) for (let x = x0; x < x1; x++) {
      const i = y * nx + x;
      const e = (g.gx0 + x) * RILL_CELL, nn = (g.gy0 + y) * RILL_CELL;
      if (g.net[i]) plot(e, nn, 3, [0, 200, 255], 0.6);
      else if (g.to[i] === -2) plot(e, nn, 4, [255, 0, 255], 1);
      else if (g.cells[i] >= 20 && !chan[i]) plot(e, nn, 1.5, [255, 140, 0], 0.8);
      else if (g.cells[i] >= 196 && !chan[i]) plot(e, nn, 3, [0, 200, 0], 0.8);
    }
    for (const c of sinkCells) {
      const e = (g.gx0 + (c % nx)) * RILL_CELL, nn = (g.gy0 + ((c / nx) | 0)) * RILL_CELL;
      if (Math.abs(e - ce * RILL_CELL) < half && Math.abs(nn - cn * RILL_CELL) < half) plot(e, nn, 10, [230, 30, 30], 1);
    }
    fs.writeFileSync(`${dir}/${tag}-s${seed}-${at.replace(',', '_')}.png`, png(n, n, img));
  }
  fs.writeFileSync(`${dir}/${tag}-metrics.txt`, rows.join('\n') + '\n');
});
