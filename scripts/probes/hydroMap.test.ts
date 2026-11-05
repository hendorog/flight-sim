// Probe: a relief map with the channel network drawn over it (every line, coloured by its kind of flow, streams thin),
// the lakes and the falls (white dots), for looking at how streams leave lakes and run down to the rivers.
//   HM_SEED=42 HM_N=-47500 HM_E=40000 HM_HALF=15000 HM_STEP=30 HM_OUT=out/hydro/map.png npx vitest run --config scripts/probes/vitest.config.ts hydroMap
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { png } from './png';
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: Uint8Array | string): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('hydro map', () => {
  const seed = Number(env.HM_SEED ?? 42);
  const cn = Number(env.HM_N ?? -47500), ce = Number(env.HM_E ?? 40000);
  const half = Number(env.HM_HALF ?? 15000), step = Number(env.HM_STEP ?? 30);
  setWorldSeed(seed);
  const n = Math.round((2 * half) / step);
  const g = new Float64Array(n * n);
  const wet = new Uint8Array(n * n);
  const s = makeSample();
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    sampleTerrain(cn + half - (y + 0.5) * step, ce - half + (x + 0.5) * step, s);
    g[y * n + x] = s.ground;
    wet[y * n + x] = s.standing > s.ground + 0.05 ? 1 : 0;
  }
  const rgb = new Uint8Array(n * n * 3);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    const hx = g[y * n + Math.min(n - 1, x + 1)] - g[y * n + Math.max(0, x - 1)];
    const hy = g[Math.max(0, y - 1) * n + x] - g[Math.min(n - 1, y + 1) * n + x];
    const shade = Math.min(1.3, Math.max(0.35, 0.9 + ((-hx + hy) / (2 * step)) * 0.9));
    const h = g[i];
    const base = h < 300 ? [150, 170, 120] : h < 1000 ? [175, 160, 120] : h < 2000 ? [160, 140, 120] : [215, 215, 215];
    let c = base.map((v) => v * shade);
    if (wet[i]) c = [60, 100, 180];
    rgb.set(c.map((v) => Math.max(0, Math.min(255, v))), i * 3);
  }
  const put = (pn: number, pe: number, col: number[], r: number) => {
    const x = Math.floor((pe - (ce - half)) / step), y = Math.floor((cn + half - pn) / step);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < n && yy < n && dx * dx + dy * dy <= r * r) rgb.set(col, (yy * n + xx) * 3);
    }
  };
  // placid, riffle, rapids, step-pool, fall
  const COL = [[30, 60, 230], [0, 170, 230], [0, 220, 120], [240, 200, 0], [255, 0, 0]];
  for (const r of hydrology.rivers!) {
    const rad = r.kind === 1 ? 0 : Math.max(1, Math.round(r.halfWidth[0] / step));
    for (let i = 0; i < r.north.length - 1; i++) {
      const L = Math.hypot(r.north[i + 1] - r.north[i], r.east[i + 1] - r.east[i]);
      const k = Math.max(1, Math.ceil(L / (step / 2)));
      for (let j = 0; j < k; j++) put(r.north[i] + ((r.north[i + 1] - r.north[i]) * j) / k, r.east[i] + ((r.east[i + 1] - r.east[i]) * j) / k, COL[r.regime![i]], r.kind === 1 ? 0 : Math.max(1, Math.round(r.halfWidth[i] / step)));
    }
    void rad;
  }
  for (const f of hydrology.falls!) put(f.north, f.east, [255, 255, 255], 1);
  fs.writeFileSync(env.HM_OUT ?? 'out/hydro/map.png', png(n, n, rgb));
  setWorldSeed(0);
});
