// Foundation stage 4: the threshold hillslopes' fine-grid nodes about a point (H, weight, channel), and the coarse
// ground at 25 m about it.  SLOPE_AT=north,east PIT_SEED=42 SLOPE_PARAMS='{}' npx vitest run --config scripts/probes/vitest.config.ts slopeAt
import { it } from 'vitest';
import { naturalHeightCoarse, seededModel } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { setSlopeParams } from '../../src/world/terrain/hillslopes';
import { CUT_N, CUT_CELL } from '../../src/world/terrain/erosion';
import { DOMAIN_HALF } from '../../src/world/terrain/drainage';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('slope at', () => {
  if (env.SLOPE_PARAMS) setSlopeParams(JSON.parse(env.SLOPE_PARAMS));
  setWorldSeed(env.PIT_SEED ?? '42');
  const [pn, pe] = (env.SLOPE_AT as string).split(',').map(Number);
  const sl = seededModel()?.slopes;
  if (!sl) throw new Error('no slopes');
  const y0 = Math.round((pn + DOMAIN_HALF) / CUT_CELL);
  const x0 = Math.round((pe + DOMAIN_HALF) / CUT_CELL);
  const R = 3;
  console.log(`nodes about ${y0},${x0} (north up): H / chan`);
  for (let y = y0 + R; y >= y0 - R; y--) {
    let row = '';
    for (let x = x0 - R; x <= x0 + R; x++) row += `${sl.h[y * CUT_N + x].toFixed(0).padStart(6)}/${String(sl.chan[y * CUT_N + x]).padStart(3)}`;
    console.log(`${(-DOMAIN_HALF + y * CUT_CELL).toString().padStart(8)} ${row}`);
  }
  console.log('coarse ground at 50 m (north up), relative to the min');
  const S = 50;
  const K = 12;
  const v: number[][] = [];
  let mn = Infinity;
  for (let i = K; i >= -K; i--) {
    const r: number[] = [];
    for (let j = -K; j <= K; j++) {
      const h = naturalHeightCoarse(pn + i * S, pe + j * S);
      r.push(h);
      mn = Math.min(mn, h);
    }
    v.push(r);
  }
  for (const r of v) console.log(r.map((h) => (h - mn).toFixed(0).padStart(4)).join(''));
});
