// Probe (stage S): the streams' shape - km by water gradient (over 200 m) and width, samples, segments per index cell.
//   SS_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts streamStats --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

it('stream stats', () => {
  for (const seed of (process.env.SS_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    const t0 = performance.now();
    setWorldSeed(seed);
    const ms = performance.now() - t0;
    const rs: any[] = (hydrology as any).rivers;
    const bins = [0, 0.005, 0.02, 0.05, 0.08, 0.15, 0.3, 9];
    for (const kind of [0, 1]) {
      const km = new Array(bins.length - 1).fill(0);
      const wkm = new Array(bins.length - 1).fill(0);
      let samples = 0;
      let lines = 0;
      for (const r of rs) {
        if ((r.kind ?? 0) !== kind) continue;
        lines++;
        samples += r.s.length;
        for (let i = 0; i + 1 < r.s.length; i++) {
          const g = r.gradient[i];
          const ds = r.s[i + 1] - r.s[i];
          let b = 0;
          while (g >= bins[b + 1]) b++;
          km[b] += ds / 1000;
          wkm[b] += (ds / 1000) * 2 * r.halfWidth[i];
        }
      }
      console.log(`SS seed ${seed} kind ${kind}: ${lines} lines ${samples} samples; km by gradient ${bins.slice(0, -1).map((b, i) => `>=${b}:${km[i].toFixed(0)}(w${(wkm[i] / Math.max(1e-9, km[i])).toFixed(1)})`).join(' ')}; build ${ms.toFixed(0)} ms`);
    }
  }
});
