// Foundation stage 4: a validation box inside the orogen's mountains per seed: the 60 km square (on a 2 km step) with
// the largest mean mountain weight (the ranges' uplift share ur over 0.3-0.4, hillslopes.ts), ties by mean elevation.
// OB_MODE=hill: a hill-country box instead (no mountain weight, mean ground 250-650 m, the highest).
//   OB_SEEDS=1,777777 OB_HALF=30000 npx vitest run --config scripts/probes/vitest.config.ts orogenBox
import { it } from 'vitest';
import { seededInputs } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { DOMAIN_HALF, DRAIN_CELL } from '../../src/world/terrain/drainage';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('orogen box', () => {
  const half = Number(env.OB_HALF ?? 30000);
  for (const seed of (env.OB_SEEDS ?? '1,777777').split(',')) {
    setWorldSeed(seed);
    const inp = seededInputs;
    if (!inp) continue;
    const n = inp.n;
    const r = Math.round(half / DRAIN_CELL);
    let best = { w: -1, h: 0, i: 0, j: 0 };
    for (let i = r + 15; i < n - r - 15; i += 2) {
      for (let j = r + 15; j < n - r - 15; j += 2) {
        let w = 0;
        let h = 0;
        let k = 0;
        for (let a = i - r; a <= i + r; a += 2) for (let b = j - r; b <= j + r; b += 2) {
          const c = a * n + b;
          const t = Math.min(1, Math.max(0, (inp.ur[c] - 0.3) / 0.1));
          w += t * t * (3 - 2 * t);
          h += Math.max(0, inp.h0[c]);
          k++;
        }
        w /= k;
        h /= k;
        if (env.OB_MODE === 'hill') {
          // (Hill country: no mountain weight, mean ground 250-650 m: the highest such box.)
          if (w < 0.01 && h >= 250 && h <= 650 && h > best.h) best = { w, h, i, j };
        } else if (w > best.w + 1e-3 || (Math.abs(w - best.w) <= 1e-3 && h > best.h)) best = { w, h, i, j };
      }
    }
    console.log(`seed ${seed}: box centre N ${-DOMAIN_HALF + best.i * DRAIN_CELL} E ${-DOMAIN_HALF + best.j * DRAIN_CELL}, mean weight ${best.w.toFixed(3)}, mean noise ground ${best.h.toFixed(0)} m`);
  }
});
