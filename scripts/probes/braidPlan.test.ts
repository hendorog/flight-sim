// Braids: the thread pattern alone (channelForm.ts braidAt) on a straight synthetic bed, in plan at 2.5 m a pixel, to set
// beside the NZ plans (organic-map ref/pics b2, c1) at about their scale: BP2_HB bed half-width (m), BP2_W main water
// width (m), BP2_K threads, BP2_LEN reach (m), BP2_OUT the png. The main thread wanders as layThread's yT does.
import { it } from 'vitest';
import { braidAt, braidStart, braidWander, BRAID_SPAN, BRAID_WAVE, BRAID_WIG, BRAID_WIG_MIN, hSmooth } from '../../src/world/terrain/channelForm';
import { png } from './png';
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: Uint8Array): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('braid plan', () => {
  const hb0 = Number(env.BP2_HB ?? 400);
  const w = Number(env.BP2_W ?? 26);
  const K = Number(env.BP2_K ?? 6);
  const len = Number(env.BP2_LEN ?? 6000);
  const mpp = Number(env.BP2_MPP ?? 2.5);
  const W = Math.round(len / mpp);
  const H = Math.round((2 * hb0 * 1.6) / mpp);
  const rgb = new Uint8Array(W * H * 3);
  let ph = braidStart(Number(env.BP2_SALT ?? 3), 1);
  let ps = braidStart(Number(env.BP2_SALT ?? 3), 2);
  let phM = braidStart(Number(env.BP2_SALT ?? 3), 0);
  let wet = 0;
  let bed = 0;
  for (let c = 0; c < W; c++) {
    const s = c * mpp;
    const hb = hb0 * (1 + 0.12 * hSmooth(s / 700, 0.3, 9) + 0.05 * hSmooth(s / 170, 0.7, 8));
    ph += mpp / (BRAID_WAVE * 2 * hb);
    phM += mpp / (BRAID_WAVE * 2 * hb);
    ps += mpp / Math.max(BRAID_WIG_MIN, BRAID_WIG * w);
    const xm = BRAID_SPAN * (hb - 0.5 * w) * braidWander(phM);
    for (let r = 0; r < H; r++) {
      const x = (r - H / 2) * mpp;
      let col = [0.35, 0.45, 0.25];
      if (Math.abs(x) < hb) {
        bed++;
        col = [0.8, 0.82, 0.82];
        const main = Math.abs(x - xm) < 0.5 * w;
        if (main || braidAt(x / hb, xm / hb, hb, K, ph, ps, w) > 0) {
          col = [0.35, 0.55, 0.6];
          wet++;
        }
      }
      const k = ((H - 1 - r) * W + c) * 3;
      rgb[k] = col[0] * 255;
      rgb[k + 1] = col[1] * 255;
      rgb[k + 2] = col[2] * 255;
    }
  }
  fs.writeFileSync(env.BP2_OUT ?? 'out/fs/W/B/plan.png', png(W, H, rgb));
  console.log(`BP2 wet share ${(wet / bed).toFixed(3)}`);
});
