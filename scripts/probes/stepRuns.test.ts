// Probe: how a steep channel's fall is spread along it - the gradient over 50 m against the reach's over 1 km, on
// reaches falling 2 % or more over the km (rapids and steeper): the share of length in pitches (over 1.5x the reach's
// gradient) and in calm runs (under 0.5x), and how long those pitches and runs are (m), at a 25 m resampling.
//   SR_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts stepRuns --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const q = (a: number[], p: number): number => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
it('step runs', () => {
  for (const seed of (process.env.SR_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const mask: any = hydrology.lakeMask;
    for (const kind of [0, 1]) {
      const pitchRuns: number[] = [], calmRuns: number[] = [];
      let lenSteep = 0, lenPitch = 0, lenCalm = 0;
      const ratios: number[] = [];
      for (const r of hydrology.rivers!) {
        if ((r.kind ?? 0) !== kind) continue;
        const total = r.s[r.s.length - 1];
        const D = 25;
        const m = Math.floor(total / D) + 1;
        if (m < 60) continue;
        const lv = new Float64Array(m);
        const wet = new Uint8Array(m);
        let j = 0;
        for (let k = 0; k < m; k++) {
          const sv = k * D;
          while (j < r.s.length - 2 && r.s[j + 1] < sv) j++;
          const t = Math.min(1, Math.max(0, (sv - r.s[j]) / Math.max(1e-6, r.s[j + 1] - r.s[j])));
          lv[k] = r.level[j] + (r.level[j + 1] - r.level[j]) * t;
          const n = r.north[j] + (r.north[j + 1] - r.north[j]) * t, e = r.east[j] + (r.east[j + 1] - r.east[j]) * t;
          wet[k] = mask.at(n, e) > -Infinity ? 1 : 0;
        }
        let cls = -9, runStart = 0;
        const flush = (k: number) => { if (cls === 1) pitchRuns.push((k - runStart) * D); if (cls === -1) calmRuns.push((k - runStart) * D); };
        for (let k = 20; k < m - 21; k++) {
          const g50 = (lv[k - 1] - lv[k + 1]) / (2 * D);
          const g1k = (lv[k - 20] - lv[k + 20]) / (40 * D);
          let c = -9;
          if (g1k >= 0.02 && !wet[k - 20] && !wet[k + 20] && !wet[k]) {
            lenSteep += D;
            const ratio = g50 / g1k;
            ratios.push(ratio);
            c = ratio > 1.5 ? 1 : ratio < 0.5 ? -1 : 0;
            if (c === 1) lenPitch += D;
            if (c === -1) lenCalm += D;
          }
          if (c !== cls) { flush(k); cls = c; runStart = k; }
        }
        flush(m - 21);
      }
      const mean = ratios.reduce((a, b) => a + b, 0) / Math.max(1, ratios.length);
      const sd = Math.sqrt(ratios.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, ratios.length));
      console.log(`STEPRUNS seed ${seed} kind ${kind}: steep reach length ${(lenSteep / 1000).toFixed(0)} km; 50 m / 1 km gradient ratio mean ${mean.toFixed(2)} sd ${sd.toFixed(2)} p10/p50/p90 ${q(ratios, 0.1).toFixed(2)}/${q(ratios, 0.5).toFixed(2)}/${q(ratios, 0.9).toFixed(2)}; pitches (>1.5x) ${((100 * lenPitch) / Math.max(1, lenSteep)).toFixed(0)} % of length, run length p50/p90 ${q(pitchRuns, 0.5)}/${q(pitchRuns, 0.9)} m (${pitchRuns.length}); calm runs (<0.5x) ${((100 * lenCalm) / Math.max(1, lenSteep)).toFixed(0)} %, length p50/p90 ${q(calmRuns, 0.5)}/${q(calmRuns, 0.9)} m (${calmRuns.length})`);
    }
  }
  setWorldSeed(0);
});
