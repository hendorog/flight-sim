// Foundation streams: a rill patch's lines (wet blue, dry brown, by the painted width) over the relief, the gully
// chains (red: >= 0.25 km², their catchment as the dot) and the traced lines (cyan).
//   RC_SEED=42 RC_AT=72500,-18750 RC_OUT=out/fs/shots/rc.png npx vitest run --config scripts/probes/vitest.config.ts rillChainMap
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { gullyNet, receiverOf } from '../../src/world/terrain/gullies';
import { RILL_PATCH, rillPatchLines, rillWaterHalf, rillBedHalf } from '../../src/world/terrain/rills';
import { setWorldSeed } from '../../src/world/worldSeed';
import { png } from './png';
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: Uint8Array | string): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('rill chain map', () => {
  setWorldSeed(env.RC_SEED ?? '42');
  const [N0, E0] = (env.RC_AT ?? '72500,-18750').split(',').map(Number);
  const pi = Math.floor(E0 / RILL_PATCH), pj = Math.floor(N0 / RILL_PATCH);
  const e0 = pi * RILL_PATCH, n0 = pj * RILL_PATCH, step = 4, W = RILL_PATCH / step;
  const s = makeSample();
  const g = new Float64Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { sampleTerrain(n0 + RILL_PATCH - (y + 0.5) * step, e0 + (x + 0.5) * step, s); g[y * W + x] = s.ground; }
  const rgb = new Uint8Array(W * W * 3);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const hx = g[y * W + Math.min(W - 1, x + 1)] - g[y * W + Math.max(0, x - 1)];
    const hy = g[Math.max(0, y - 1) * W + x] - g[Math.min(W - 1, y + 1) * W + x];
    const sh = Math.min(1.2, Math.max(0.2, 0.8 + ((-hx + hy) / (2 * step)) * 0.6));
    const i = (y * W + x) * 3; rgb[i] = 190 * sh; rgb[i + 1] = 180 * sh; rgb[i + 2] = 160 * sh;
  }
  const plot = (e: number, n: number, r: number, c: number[]): void => {
    const cx = (e - e0) / step, cy = (n0 + RILL_PATCH - n) / step, rr = Math.max(0.6, r / step);
    for (let y = Math.floor(cy - rr); y <= Math.ceil(cy + rr); y++) for (let x = Math.floor(cx - rr); x <= Math.ceil(cx + rr); x++) {
      if (x < 0 || y < 0 || x >= W || y >= W || (x - cx) ** 2 + (y - cy) ** 2 > rr * rr) continue;
      const i = (y * W + x) * 3; rgb[i] = c[0]; rgb[i + 1] = c[1]; rgb[i + 2] = c[2];
    }
  };
  const { segs } = rillPatchLines({ pi, pj });
  for (const sg of segs) {
    const L = Math.hypot(sg.e1 - sg.e0, sg.n1 - sg.n0);
    for (let t = 0; t <= 1; t += 1 / Math.max(1, L / 2)) {
      const sz = sg.s0 + (sg.s1 - sg.s0) * t, wh = rillWaterHalf(sz);
      plot(sg.e0 + (sg.e1 - sg.e0) * t, sg.n0 + (sg.n1 - sg.n0) * t, Math.max(2, wh > 0 ? wh : rillBedHalf(sz)), wh > 0 ? [30, 80, 230] : [110, 80, 40]);
    }
  }
  for (const r of hydrology.rivers ?? []) for (let i = 0; i < r.north.length; i++) if (r.north[i] > n0 && r.north[i] < n0 + RILL_PATCH && r.east[i] > e0 && r.east[i] < e0 + RILL_PATCH) plot(r.east[i], r.north[i], Math.max(3, r.halfWidth[i]), [0, 200, 220]);
  const gn = gullyNet()!;
  for (let y = 0; y < gn.n; y++) for (let x = 0; x < gn.n; x++) {
    const q = y * gn.n + x; if (!gn.dir[q] || gn.area[q] < 0.25) continue;
    const n = gn.origin + y * gn.cell, e = gn.origin + x * gn.cell;
    if (n < n0 || n > n0 + RILL_PATCH || e < e0 || e > e0 + RILL_PATCH) continue;
    const r = receiverOf(gn, q), rn = gn.origin + Math.floor(r / gn.n) * gn.cell, re = gn.origin + (r % gn.n) * gn.cell;
    for (let t = 0; t <= 1; t += 0.02) plot(e + (re - e) * t, n + (rn - n) * t, 1, [220, 30, 30]);
    plot(e, n, 3 + 2 * Math.log2(1 + gn.area[q]), [220, 30, 30]);
  }
  fs.writeFileSync(env.RC_OUT ?? 'out/fs/shots/rc.png', png(W, W, rgb));
});
