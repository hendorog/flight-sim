// Probe (verify3): find steps in the seeded detail ground (WF_AT='seed@north,east', WF_HALF m, WF_STEP m): the largest
// height differences between neighbouring samples, with the gully terms (gullyProbe) on both sides.
import { it } from 'vitest';
import * as HF from '../../src/world/terrain/heightfield';
const naturalHeight = HF.naturalHeight;
const gullyProbe = ((HF as Record<string, unknown>).gullyProbe ?? {}) as Record<string, number>;
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('wall find', () => {
  for (const at of (env.WF_AT ?? '42@-44142,-7154').split(/\s+/)) {
    const [sd, p] = at.split('@');
    const [cn, ce] = p.split(',').map(Number);
    setWorldSeed(Number(sd));
    const half = Number(env.WF_HALF ?? 2000), step = Number(env.WF_STEP ?? 8);
    const n = Math.round((2 * half) / step) + 1;
    const h = new Float64Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = naturalHeight(cn + half - y * step, ce - half + x * step);
    const hits: { d: number; i: number; j: number }[] = [];
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
      const i = y * n + x;
      const d = Math.max(Math.abs(h[i + 1] - h[i]), Math.abs(h[i + n] - h[i]));
      if (d > step * Number(env.WF_SLOPE ?? 3)) hits.push({ d, i, j: Math.abs(h[i + 1] - h[i]) > Math.abs(h[i + n] - h[i]) ? i + 1 : i + n });
    }
    hits.sort((a, b) => b.d - a.d);
    console.log(`WF ${at} samples ${n * n} steps>${env.WF_SLOPE ?? 3}x: ${hits.length}`);
    const seen: number[][] = [];
    for (const t of hits) {
      const N = cn + half - Math.floor(t.i / n) * step, E = ce - half + (t.i % n) * step;
      if (seen.some(([a, b]) => Math.hypot(a - N, b - E) < 150)) continue;
      seen.push([N, E]);
      const N2 = cn + half - Math.floor(t.j / n) * step, E2 = ce - half + (t.j % n) * step;
      const a = naturalHeight(N, E); const pa = { ...gullyProbe };
      const b = naturalHeight(N2, E2); const pb = { ...gullyProbe };
      const f = (q: typeof pa) => Object.entries(q).map(([k, v]) => `${k}=${(+v).toFixed(3)}`).join(' ');
      console.log(`WF  ${N},${E} -> ${N2},${E2}: ${a.toFixed(1)} -> ${b.toFixed(1)} (${t.d.toFixed(1)} m)\n     A ${f(pa)}\n     B ${f(pb)}`);
      if (seen.length >= Number(env.WF_TOP ?? 8)) break;
    }
  }
  setWorldSeed(0);
});
