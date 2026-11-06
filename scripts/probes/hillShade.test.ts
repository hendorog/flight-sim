// Probe (verify3): a plain hill shade of the detailed ground (HS_AT='seed@north,east', HS_HALF m, HS_STEP m, HS_GAIN
// shading gain), lit from the north-west, no contours: for seams and steps. -> HS_OUT-<seed>-<n>-<e>.png
import { it } from 'vitest';
import { naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { png } from './png';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const fs = (globalThis as unknown as { process: { getBuiltinModule(m: string): { writeFileSync(p: string, d: Uint8Array): void } } }).process.getBuiltinModule('node:fs');
it('hill shade', () => {
  for (const at of (env.HS_AT ?? '777777@-105800,35850').split(/\s+/)) {
    const [sd, p] = at.split('@');
    const [cn, ce] = p.split(',').map(Number);
    setWorldSeed(Number(sd));
    const half = Number(env.HS_HALF ?? 1200), step = Number(env.HS_STEP ?? 4), gain = Number(env.HS_GAIN ?? 2);
    const n = Math.round((2 * half) / step) + 1;
    const h = new Float64Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = naturalHeight(cn + half - y * step, ce - half + x * step);
    const rgb = new Uint8Array(n * n * 3);
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      const hx = (h[i + 1] - h[i - 1]) / (2 * step), hy = (h[i - n] - h[i + n]) / (2 * step);
      const v = Math.max(0, Math.min(255, 160 + gain * 60 * (-hx + hy)));
      rgb.set([v, v, v], i * 3);
    }
    fs.writeFileSync(`${env.HS_OUT ?? 'out/verify3/probe/hs'}-${sd}-${cn}-${ce}.png`, png(n, n, rgb));
  }
  setWorldSeed(0);
});
