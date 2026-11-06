// Probe (A1b): rough cost of the parts of a seeded terrain sample, ns per call (200k calls, min of 5).
import { it } from 'vitest';
import { macroAt, macroGradAt } from '../../src/world/terrain/seededLayout';
import { gnoise, gullies } from '../../src/world/terrain/noise';
import { makeSample, naturalHeight, naturalHeightCoarse, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('cost parts', () => {
  setWorldSeed(42);
  const m = { inland: 0, uplift: 0, foothill: 0, hilly: 0 };
  const g = { inlandE: 0, inlandN: 0, upliftE: 0, upliftN: 0, foothillE: 0, foothillN: 0, hillyE: 0, hillyN: 0 };
  const D = { dx: 0, dy: 0 };
  const s = makeSample();
  const cn = -23664, ce = 71632;
  const parts: Array<[string, (i: number) => number]> = [
    ['macroAt', (i) => macroAt(cn + (i % 400) * 20.03, ce + Math.floor(i / 400) * 16.01, m).uplift],
    ['macroGradAt', (i) => macroGradAt(cn + (i % 400) * 20.03, ce + Math.floor(i / 400) * 16.01, m, g).uplift],
    ['gnoise', (i) => gnoise((i % 400) * 0.0133, Math.floor(i / 400) * 0.011, D)],
    ['gullies', (i) => gullies((i % 400) * 0.0133, Math.floor(i / 400) * 0.011, 0.6, 0.67, D)],
    ['sin+cos', (i) => Math.sin(i * 0.37) + Math.cos(i * 0.29)],
    ['coarse', (i) => naturalHeightCoarse(cn + (i % 400) * 20.03, ce + Math.floor(i / 400) * 16.01)],
    ['natural', (i) => naturalHeight(cn + (i % 400) * 20.03, ce + Math.floor(i / 400) * 16.01)],
    ['sampleTerrain', (i) => sampleTerrain(cn + (i % 400) * 20.03, ce + Math.floor(i / 400) * 16.01, s).ground],
  ];
  for (const [name, f] of parts) {
    let best = Infinity, acc = 0;
    for (let r = 0; r < 5; r++) { const t0 = performance.now(); for (let i = 0; i < 200000; i++) acc += f(i); best = Math.min(best, ((performance.now() - t0) * 1e6) / 200000); }
    console.log(`COSTPART ${name}: ${best.toFixed(0)} ns (${acc.toFixed(0)})`);
  }
  setWorldSeed(0);
});
