// Water and bed in boxes (WB_SEED; boxes WB_HALF m about each point of WB_PTS, a JSON list of [n, e]; every WB_STEP m):
// one byte per point into WB_OUT - bit 0 water over the ground (a line's or standing), bit 1 on a painted bed (sampleTerrain's
// riverDist inside riverHalfWidth). Run on two trees and compared (out/fs/W/B/tools/wetboxes.py): water added, and where.
import { it } from 'vitest';
import { makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { readFileSync(p: string, e: string): string; writeFileSync(p: string, d: Uint8Array): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('wet boxes', () => {
  setWorldSeed(Number(env.WB_SEED ?? 42));
  terrainHeight(0, 0);
  const pts = JSON.parse(fs.readFileSync(env.WB_PTS!, 'utf8')) as number[][];
  const half = Number(env.WB_HALF ?? 1000);
  const step = Number(env.WB_STEP ?? 10);
  const n1 = Math.round((2 * half) / step);
  const out = new Uint8Array(pts.length * n1 * n1);
  const S = makeSample();
  let k = 0;
  for (const [pn, pe] of pts)
    for (let r = 0; r < n1; r++)
      for (let c = 0; c < n1; c++) {
        sampleTerrain(pn - half + (r + 0.5) * step, pe - half + (c + 0.5) * step, S);
        const wet = (S.river > -Infinity && S.ground < S.river) || S.standing > S.ground + 0.05;
        const bed = S.riverHalfWidth > 0 && S.riverDist < S.riverHalfWidth;
        out[k++] = (wet ? 1 : 0) | (bed ? 2 : 0);
      }
  fs.writeFileSync(env.WB_OUT!, out);
  console.log(`WB ${pts.length} boxes, ${out.length} points`);
  setWorldSeed(0);
});
