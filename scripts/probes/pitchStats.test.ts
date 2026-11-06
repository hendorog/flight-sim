// Probe (stage S): the streams' pitches and pools (pitchPool.ts): units, spacing (lip to lip) in channel widths by
// reach gradient, drops, how far the pools' heads lie under the old level; samples added; build time.
//   SS_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts pitchStats --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

const q = (a: number[], p: number): number => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const qs = (a: number[], d = 1): string => [0.1, 0.5, 0.9].map((p) => q(a, p).toFixed(d)).join('/');

it('pitch stats', () => {
  setWorldSeed(3);
  setWorldSeed(0);
  for (const seed of (process.env.SS_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    const t0 = performance.now();
    setWorldSeed(seed);
    const ms = performance.now() - t0;
    const r: any = (hydrology as any).streamReport;
    const p = r.pitch;
    if (!p) { console.log(`PS seed ${seed}: no pitch report; build ${ms.toFixed(0)} ms`); setWorldSeed(0); continue; }
    const cls = (lo: number, hi: number) => {
      const idx = p.gradient.map((g: number, i: number) => (g >= lo && g < hi ? i : -1)).filter((i: number) => i >= 0);
      const pick = (a: number[]) => idx.map((i: number) => a[i]);
      return `n ${idx.length} spacing W ${qs(pick(p.spacingW))} m ${qs(pick(p.spacingM), 0)} drop ${qs(pick(p.drop), 2)} deepen ${qs(pick(p.deepen), 2)}`;
    };
    console.log(`PS seed ${seed}: units ${p.units} inserted ${p.inserted}; build ${ms.toFixed(0)} ms`);
    console.log(`PS seed ${seed} gentle 0.02-0.08: ${cls(0.0, 0.08)}`);
    console.log(`PS seed ${seed} steep >=0.08: ${cls(0.08, 9)}`);
    const rs: any[] = (hydrology as any).rivers;
    let samples = 0;
    for (const l of rs) if (l.kind === 1) samples += l.s.length;
    console.log(`PS seed ${seed}: stream samples ${samples}`);
    setWorldSeed(0);
  }
});
