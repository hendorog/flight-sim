// Probe (A1b): a hill-shaded map of the detailed ground round a point (SL_AT='seed@north,east', SL_HALF m, SL_STEP m),
// the first gully octave's trough band tinted (gullyProbe.c0 <= 0), the descent's pits red, contours every SL_CONTOUR m.
import { it } from 'vitest';
import { gullyDebug, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { png } from './png';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const fs = (globalThis as unknown as { process: { getBuiltinModule(m: string): { writeFileSync(p: string, d: Uint8Array): void } } }).process.getBuiltinModule('node:fs');
it('sink look', () => {
  for (const at of (env.SL_AT ?? '42@-25280,71168').split(/\s+/)) {
    const [sd, p] = at.split('@');
    const [cn, ce] = p.split(',').map(Number);
    setWorldSeed(Number(sd));
    const half = Number(env.SL_HALF ?? 1000), step = Number(env.SL_STEP ?? 8), ci = Number(env.SL_CONTOUR ?? 5);
    const n = Math.round((2 * half) / step) + 1;
    const h = new Float64Array(n * n), band = new Float64Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { h[y * n + x] = naturalHeight(cn + half - y * step, ce - half + x * step); band[y * n + x] = gullyDebug.c0; }
    const rgb = new Uint8Array(n * n * 3);
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      const hx = h[i + 1] - h[i - 1], hy = h[i - n] - h[i + n];
      const sh = Math.min(1.3, Math.max(0.2, 0.8 + ((-hx + hy) / (2 * step)) * 0.5));
      let c = [200 * sh, 190 * sh, 170 * sh];
      if (band[i] <= 0) c = [c[0] * 0.75, c[1] * 0.85, c[2] * 1.15];
      if (Math.floor(h[i] / ci) !== Math.floor(h[i + 1] / ci) || Math.floor(h[i] / ci) !== Math.floor(h[i + n] / ci)) c = c.map((v) => v * 0.6);
      let pit = true;
      for (const d of [-n - 1, -n, -n + 1, -1, 1, n - 1, n, n + 1]) if (h[i + d] < h[i]) { pit = false; break; }
      if (pit) c = [255, 0, 0];
      rgb.set(c.map((v) => Math.max(0, Math.min(255, v))), i * 3);
    }
    const k = Number(env.SL_SCALE ?? 3), m = n * k;
    const big = new Uint8Array(m * m * 3);
    for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) big.set(rgb.subarray((((y / k) | 0) * n + ((x / k) | 0)) * 3, (((y / k) | 0) * n + ((x / k) | 0)) * 3 + 3), (y * m + x) * 3);
    fs.writeFileSync(`${env.SL_OUT ?? 'out/a1b/look'}-${sd}-${cn}-${ce}.png`, png(m, m, big));
  }
  setWorldSeed(0);
});
