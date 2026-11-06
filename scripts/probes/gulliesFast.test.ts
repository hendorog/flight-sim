// Probe (A1b): gulliesFast against gullies (largest difference of the value and derivative) and their cost, ns.
import { it } from 'vitest';
import { gullies, gulliesFast } from '../../src/world/terrain/noise';
it('gullies fast', () => {
  const D = { dx: 0, dy: 0 }, E = { dx: 0, dy: 0 };
  let mv = 0, md = 0;
  for (let k = 0; k < 400000; k++) {
    const x = (k * 0.6180339) % 500 - 250, y = (k * 0.4142135) % 300 - 150, a = k * 0.001, m = 0.5 + (k % 7) * 0.1;
    const v1 = gullies(x, y, m * Math.cos(a), m * Math.sin(a), D), v2 = gulliesFast(x, y, m * Math.cos(a), m * Math.sin(a), E);
    mv = Math.max(mv, Math.abs(v1 - v2)); md = Math.max(md, Math.abs(D.dx - E.dx), Math.abs(D.dy - E.dy));
  }
  for (const [name, f] of [['gullies', gullies], ['gulliesFast', gulliesFast]] as const) {
    let best = Infinity, acc = 0;
    for (let r = 0; r < 5; r++) { const t0 = performance.now(); for (let i = 0; i < 200000; i++) acc += f((i % 400) * 0.0133, Math.floor(i / 400) * 0.011, 0.6, 0.67, D); best = Math.min(best, ((performance.now() - t0) * 1e6) / 200000); }
    console.log(`GFAST ${name}: ${best.toFixed(0)} ns (${acc.toFixed(1)})`);
  }
  console.log(`GFAST max |dv| ${mv.toExponential(2)} |dD| ${md.toExponential(2)}`);
});
