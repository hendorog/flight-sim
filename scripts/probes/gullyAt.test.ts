// Foundation streams: the gully chains about a point (gullies.ts): each node's catchment, direction, pass ground and
// how far its two side nodes (across its flow) stand over it; and the drawn lines near.
//   GA_SEED=42 GA_AT=-13000,-42000 GA_R=8 npx vitest run --config scripts/probes/vitest.config.ts gullyAt
import { it } from 'vitest';
import { hydrology, seededModel } from '../../src/world/terrain/heightfield';
import { gullyNet, receiverOf } from '../../src/world/terrain/gullies';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('gully at', async () => {
  setWorldSeed(env.GA_SEED ?? '42');
  const g = gullyNet()!;
  const h = seededModel()!.slopes!.h;
  const [N0, E0] = (env.GA_AT ?? '-13000,-42000').split(',').map(Number);
  const R = Number(env.GA_R ?? 8);
  const y0 = Math.round((N0 - g.origin) / g.cell), x0 = Math.round((E0 - g.origin) / g.cell);
  const arrows = ['↙', '↓', '↘', '←', '→', '↖', '↑', '↗'];
  for (let y = y0 + R; y >= y0 - R; y--) {
    let row = `${(g.origin + y * g.cell).toString().padStart(7)} `;
    for (let x = x0 - R; x <= x0 + R; x++) {
      const q = y * g.n + x;
      const d = g.dir[q];
      const a = g.area[q];
      row += d ? `${arrows[d - 1]}${a >= 5 ? '#' : a >= 1 ? '+' : a >= 0.25 ? '.' : ' '}${h[q].toFixed(0).padStart(5)} ` : `  ${h[q].toFixed(0).padStart(5)}*`;
    }
    console.log(row);
  }
  const hit = { dist: 0, level: 0, halfWidth: 0, s: 0, side: 0, beyondSource: 0 };
  for (let k = -R; k <= R; k += 2) {
    const n = N0, e = E0 + k * g.cell;
    hydrology.queryRiver(n, e, hit);
    console.log(`  river at ${n},${e}: dist ${hit.dist.toFixed(0)} hw ${hit.halfWidth.toFixed(1)} level ${hit.level.toFixed(1)}`);
  }
  if (env.GA_LINE) {
    const { sampleTerrain, makeSample } = await import('../../src/world/terrain/heightfield');
    const smp = makeSample();
    const [a, b, c, d] = env.GA_LINE.split(',').map(Number);
    for (let t = 0; t <= 1.0001; t += 1 / 60) {
      const n = a + (c - a) * t, e = b + (d - b) * t;
      sampleTerrain(n, e, smp);
      const fl = hydrology.queryFlow ? (() => { const hh = { dist: Infinity, side: 0, line: -1, kind: 0, index: 0, s: 0, level: 0, halfWidth: 0, gradient: 0, steepness: 0, regime: 0, speed: 0, dirN: 0, dirE: 0 }; hydrology.queryFlow!(n, e, hh as never); return hh; })() : null;
      console.log(`  ${n.toFixed(0)},${e.toFixed(0)} ground ${smp.ground.toFixed(1)} river ${Number.isFinite(smp.river) ? smp.river.toFixed(1) : '-'} rd ${Number.isFinite(smp.riverDist) ? smp.riverDist.toFixed(0) : '-'} hw ${smp.riverHalfWidth.toFixed(1)} flow line ${fl?.line} kind ${fl?.kind} d ${fl && Number.isFinite(fl.dist) ? fl.dist.toFixed(0) : '-'}`);
    }
  }
  void receiverOf;
  setWorldSeed(0);
});
