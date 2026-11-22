// Probe (Round V A4'+B join): which lines' ribbon pieces water.ts builds eagerly (a piece with any sample's ribbon
// half-width >= SMALL_RIBBON_HW, or level < 0.3), by kind and pass: samples, km. RW_SEED.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import * as ST from '../../src/world/terrain/streams';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('ribbon wide', () => {
  setWorldSeed(Number(env.RW_SEED ?? 1));
  terrainHeight(0, 0);
  const L = hydrology.rivers as unknown as Array<{ kind?: number; s: Float64Array; level: Float64Array; halfWidth: Float64Array; wetR?: Float32Array; wetL?: Float32Array }>;
  const nR = L.filter((r) => (r.kind ?? 0) === 0).length;
  const src = (ST as unknown as { streamDebug?: { src?: string[] } }).streamDebug?.src;
  const PIECE = Number(env.RW_PIECE ?? 16);
  const agg = new Map<string, { n: number; km: number; wideN: number; wideKm: number; lowN: number }>();
  L.forEach((r, li) => {
    const kind = li < nR ? 'river' : src?.[li - nR] ?? 'stream';
    const a = agg.get(kind) ?? { n: 0, km: 0, wideN: 0, wideKm: 0, lowN: 0 };
    const m = r.s.length;
    a.n += m;
    a.km += r.s[m - 1] / 1000;
    for (let p = 0; p < m - 1; p += PIECE) {
      const end = Math.min(m, p + PIECE + 1);
      let wide = false, low = false;
      for (let i = p; i < end; i++) {
        const h = r.wetR && r.wetL ? 0.5 * (r.wetR[i] + r.wetL[i]) : r.halfWidth[i];
        if (h >= 4) wide = true;
        if (r.level[i] < 0.3) low = true;
      }
      if (wide || low) { a.wideN += end - p; a.wideKm += (r.s[end - 1] - r.s[p]) / 1000; }
      if (low && !wide) a.lowN += end - p;
    }
    agg.set(kind, a);
  });
  for (const [k, a] of agg) console.log(`RW ${k}: samples ${a.n}, ${a.km.toFixed(0)} km; eager (wide or low) samples ${a.wideN}, ${a.wideKm.toFixed(0)} km (low only ${a.lowN})`);
});
