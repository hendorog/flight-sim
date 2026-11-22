// Braids: a plan of what the ribbon draws over a braided bed, from the CPU twin (channelForm.ts braidTwin, the GPU's own
// interpolation): BM_SEED, a box BM_HALF m about (BM_N, BM_E), BM_MPP m a pixel, into BM_OUT. Bed (the ribbon's
// triangles) pale, the main water's columns dark blue, the other threads blue, off the bed green.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { braidAt } from '../../src/world/terrain/channelForm';
import { setWorldSeed } from '../../src/world/worldSeed';
import { png } from './png';
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: Uint8Array): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('braid map', () => {
  setWorldSeed(Number(env.BM_SEED ?? 42));
  terrainHeight(0, 0);
  const cn = Number(env.BM_N ?? -34232);
  const ce = Number(env.BM_E ?? -69461);
  const half = Number(env.BM_HALF ?? 1500);
  const mpp = Number(env.BM_MPP ?? 2);
  const W = Math.round((2 * half) / mpp);
  const rgb = new Uint8Array(W * W * 3);
  const net = hydrology.network!;
  const near: Parameters<typeof net.channels>[2] = [];
  const S = makeSample();
  let high = 0;
  let thr = 0;
  for (let r = 0; r < W; r++)
    for (let c = 0; c < W; c++) {
      const pn = cn + half - r * mpp;
      const pe = ce - half + c * mpp;
      let col = [90, 115, 65];
      const k = net.channels(pn, pe, near);
      for (let q = 0; q < k; q++) {
        const o = near[q];
        if (!(o.braidK! > 1)) {
          if (o.dist < (o.wet ?? o.halfWidth)) col = [60, 90, 110];
          continue;
        }
        const th = braidAt(o.braidU!, o.braidUm!, o.braidHb!, o.braidK!, o.braidPh!, o.braidPs!, o.braidW!) > 0;
        col = th ? [90, 140, 155] : [205, 208, 208];
        // (The bed's ground standing over its water by more than a metre - over the ribbon close in - red; a thread on it, magenta.)
        sampleTerrain(pn, pe, S);
        if (S.ground > o.level + 1) col = th ? [220, 40, 200] : [200, 60, 50];
        if (th) {
          thr++;
          if (S.ground > o.level + 1) high++;
        }
      }
      const i = (r * W + c) * 3;
      rgb[i] = col[0];
      rgb[i + 1] = col[1];
      rgb[i + 2] = col[2];
    }
  fs.writeFileSync(env.BM_OUT ?? 'out/fs/W/B/map.png', png(W, W, rgb));
  console.log(`BM thread pixels ${thr}, on ground over their water by more than 1 m ${high}`);
  setWorldSeed(0);
});
