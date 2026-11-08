// Probe (foundation stage 3): the front block's weight (structure.ts), the ranges' share and the ground at points.
//   BA_SEED=777777 BA_AT="73537,-46431;..." npx vitest run --config scripts/probes/vitest.config.ts blockAt
import { it } from 'vitest';
import { DOMAIN_HALF, DRAIN_CELL } from '../../src/world/terrain/drainage';
import * as hf from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const n = Math.round((2 * DOMAIN_HALF) / DRAIN_CELL) + 1;
it('block at', () => {
  setWorldSeed(Number(env.BA_SEED ?? 42));
  const inp = hf.seededInputs;
  const T = hf.seededModel()?.lattice;
  for (const p of (env.BA_AT ?? '0,0').split(';')) {
    const [pn, pe] = p.split(',').map(Number);
    const i = Math.round((pn + DOMAIN_HALF) / DRAIN_CELL), j = Math.round((pe + DOMAIN_HALF) / DRAIN_CELL);
    let best = 0;
    for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) best = Math.max(best, inp?.struct?.block[(i + di) * n + j + dj] ?? 0);
    const c = i * n + j;
    const ev = (hf as unknown as { debugValley?: (n: number, e: number) => number }).debugValley;
    console.log(`${p}: valley ${ev ? ev(pn, pe).toFixed(0) : "-"}, block ${(inp?.struct?.block[c] ?? 0).toFixed(2)} (max within 2 cells ${best.toFixed(2)}), ur ${inp?.ur[c].toFixed(2)}, fade ${inp?.fade?.[c].toFixed(2)}, T ${T?.[c].toFixed(0)}, h0 ${inp?.h0[c].toFixed(0)}, natural ${hf.naturalHeight(pn, pe).toFixed(0)}`);
  }
  setWorldSeed(0);
});
