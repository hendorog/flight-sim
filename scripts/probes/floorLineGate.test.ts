// Round V A3 fix: the model's floors' lines (hillslopes.ts FloorLines, the courses and the rivers' own) world-wide, by the
// line's half-width class (thin: under half a pass node, 125 m; wide), every FG_STEP m along each line inside the pass
// (weight m > 0.05):
//  - the drawn ground on the line against the model's own ground there (debugMacro.model): km over by > 10 / > 30 m;
//  - the streams' tracing ground (streamDebug.route) on the line at its nearest 100 m raster point against the lowest it
//    read upstream on the same line: km where it stands > 20 / > 50 m over it (a hollow the streams see along the floor);
//  - the pass's nodes within 125 m of the line: km of line with none fixed on it (SlopeField.floor).
// Worst sites per seed. FG_SEEDS, FG_STEP.
import { it } from 'vitest';
import { terrainHeight, debugMacro, seededModel } from '../../src/world/terrain/heightfield';
import { streamDebug } from '../../src/world/terrain/streams';
import { slopeStats } from '../../src/world/terrain/hillslopes';
import { DOMAIN_HALF } from '../../src/world/terrain/drainage';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('floor line gate', () => {
  const step = Number(env.FG_STEP ?? 80);
  for (const seed of (env.FG_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed); terrainHeight(0, 0);
    const L = slopeStats.lines!;
    const sl = seededModel()!.slopes!;
    const nn = Math.round(Math.sqrt(sl.h.length)), cell = 250, R = 100;
    const km = { thin: [0, 0, 0, 0, 0, 0], wide: [0, 0, 0, 0, 0, 0] } as Record<string, number[]>;
    const worst: { v: number; t: string; n: number; e: number }[] = [];
    for (let p = 0; p < L.start.length - 1; p++) {
      let s = 0, last = -1e9, low = Infinity;
      for (let k = L.start[p]; k < L.start[p + 1]; k++) {
        if (k > L.start[p]) s += Math.hypot(L.north[k] - L.north[k - 1], L.east[k] - L.east[k - 1]);
        if (s - last < step) continue;
        last = s;
        const n = L.north[k], e = L.east[k];
        const x = debugMacro(n, e)!;
        if (!(x.s.m > 0.05)) { low = Infinity; continue; }
        const cls = L.half[k] < cell / 2 ? 'thin' : 'wide';
        const a = km[cls];
        a[0] += step / 1000;
        const dr = terrainHeight(n, e) - x.model;
        if (dr > 10) a[1] += step / 1000;
        if (dr > 30) a[2] += step / 1000;
        const rn = Math.round((n + DOMAIN_HALF) / R) * R - DOMAIN_HALF, re = Math.round((e + DOMAIN_HALF) / R) * R - DOMAIN_HALF;
        const r = streamDebug.route ? streamDebug.route(rn, re) : NaN;
        const up = r - low;
        if (up > 20) a[3] += step / 1000;
        if (up > 50) a[4] += step / 1000;
        low = Math.min(low, r);
        // (A fixed node within 125 m of the point.)
        let fixed = false;
        const y0 = Math.floor((n + DOMAIN_HALF) / cell), x0 = Math.floor((e + DOMAIN_HALF) / cell);
        for (let yy = y0 - 1; yy <= y0 + 2 && !fixed; yy++) for (let xx = x0 - 1; xx <= x0 + 2; xx++) {
          if (Math.hypot(yy * cell - DOMAIN_HALF - n, xx * cell - DOMAIN_HALF - e) <= cell / 2 && sl.floor[yy * nn + xx]) { fixed = true; break; }
        }
        if (!fixed) a[5] += step / 1000;
        const v = Math.max(dr, up);
        if (v > 30) worst.push({ v, n, e, t: `line ${p} half ${L.half[k].toFixed(0)} drawn-model ${dr.toFixed(1)} route-over-low ${up.toFixed(1)} m ${x.s.m.toFixed(2)} fixed ${fixed}` });
      }
    }
    for (const c of ['thin', 'wide']) {
      const a = km[c];
      console.log(`FG seed ${seed} ${c}: ${a[0].toFixed(1)} km in the pass; drawn over the model > 10 / > 30 m: ${a[1].toFixed(1)} / ${a[2].toFixed(1)} km; streams' ground over its low upstream > 20 / > 50 m: ${a[3].toFixed(1)} / ${a[4].toFixed(1)} km; no fixed node within 125 m: ${a[5].toFixed(1)} km`);
    }
    worst.sort((x, y) => y.v - x.v);
    const out: typeof worst = [];
    for (const w of worst) { if (out.length >= 6) break; if (out.some((o) => Math.hypot(o.n - w.n, o.e - w.e) < 3000)) continue; out.push(w); }
    for (const w of out) console.log(`FG seed ${seed} worst: ${w.t} at ${w.n.toFixed(0)},${w.e.toFixed(0)}`);
  }
  setWorldSeed(0);
});
