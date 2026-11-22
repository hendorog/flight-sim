// Probe: steepness and regime of the channels in the calm-river view (seed 42, around line 0 near -33136,-73025), to
// tell whether the look round's stones (from steepness 0.5) reach any water there.
//   npx vitest run --config scripts/probes/vitest.config.ts calmConfluence --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import type { FlowHit } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';

it('calm confluence', () => {
  setWorldSeed(42);
  const hit = {} as FlowHit;
  const byLine = new Map<number, { max: number; n: number; over: number; regimes: Set<number> }>();
  for (let dn = -1500; dn <= 1500; dn += 10)
    for (let de = -1500; de <= 1500; de += 10) {
      hydrology.queryFlow!(-33136 + dn, -73025 + de, hit);
      if (hit.line < 0 || hit.dist > hit.halfWidth) continue;
      const b = byLine.get(hit.line) ?? { max: 0, n: 0, over: 0, regimes: new Set<number>() };
      b.max = Math.max(b.max, hit.steepness);
      b.n++;
      if (hit.steepness >= 0.5) b.over++;
      b.regimes.add(hit.regime);
      byLine.set(hit.line, b);
    }
  for (const [l, b] of byLine) console.log(`line ${l} kind ${hydrology.rivers![l].kind}: ${b.n} water points, max steepness ${b.max.toFixed(3)}, ${b.over} at >= 0.5, regimes ${[...b.regimes].join(',')}`);
  setWorldSeed(0);
});
