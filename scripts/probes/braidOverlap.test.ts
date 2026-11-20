// Braids: where a braided ribbon covers another line's water (OV_SEEDS). On a 20 m grid over boxes 1 km about the middle
// of every braided 1 km piece every OV_EVERY km: points on a braided ribbon (channelForm.ts braidTwin) inside another line's
// water (its nearest distance under its wet half-width) - there the ribbon's bars draw over that water.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type Line = { north: Float64Array; east: Float64Array; s: Float64Array; braidK?: Float32Array };
it('braid overlap', () => {
  const every = Number(env.OV_EVERY ?? 5) * 1000;
  for (const seed of (env.OV_SEEDS ?? '1').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const net = hydrology.network!;
    const near: Parameters<typeof net.channels>[2] = [];
    let onRibbon = 0, covered = 0, boxes = 0;
    const sites: string[] = [];
    for (const r of hydrology.rivers as unknown as Line[]) {
      const K = r.braidK; const m = r.s.length;
      if (!K) continue;
      for (let s0 = 0; s0 + 1000 <= r.s[m - 1]; s0 += every) {
        let im = 0; while (im < m - 1 && r.s[im] < s0 + 500) im++;
        if (K[im] < 1.5) continue;
        boxes++;
        let hit = 0;
        for (let dn = -500; dn <= 500; dn += 20) for (let de = -500; de <= 500; de += 20) {
          const k = net.channels(r.north[im] + dn, r.east[im] + de, near);
          let rib = -1;
          for (let q = 0; q < k; q++) if (near[q].braidK! > 1) rib = near[q].line;
          if (rib < 0) continue;
          onRibbon++;
          for (let q = 0; q < k; q++) { const o = near[q]; if (o.line !== rib && o.dist < (o.wet ?? o.halfWidth)) { covered++; hit++; break; } }
        }
        if (hit > 0 && sites.length < 5) sites.push(`${Math.round(r.north[im])},${Math.round(r.east[im])}`);
      }
    }
    console.log(`OV seed ${seed}: boxes ${boxes}; ribbon points ${onRibbon}, over another line's water ${covered} (${(100 * covered / Math.max(1, onRibbon)).toFixed(2)} %); e.g. ${sites.join(' ')}`);
  }
  setWorldSeed(0);
});
