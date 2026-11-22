// Braids: what covers a braided bed (BC_SEEDS). At points every 2 m across every braided 1 km piece's middle every
// BC_EVERY km, where the ribbon draws the bed (channelForm.ts braidTwin, as the GPU reads its triangles): the land cover
// there (biome.ts computeBiome on sampleTerrain, as the tile builder reads it) - farmland and forest over 0.2 - and the
// bed the ground's paint is given (sampleTerrain's riverDist inside riverHalfWidth: the paint, the trees and the cover keep
// off it), split into the threads' points and the bars'.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainHeight, terrainNormal } from '../../src/world/terrain/heightfield';
import { braidAt } from '../../src/world/terrain/channelForm';
import { computeBiome, makeBiome } from '../../src/world/terrain/biome';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type Line = { north: Float64Array; east: Float64Array; s: Float64Array; bedR: Float32Array; bedL: Float32Array; braidK?: Float32Array };
it('braid cover', () => {
  const S = makeSample();
  const B = makeBiome();
  const every = Number(env.BC_EVERY ?? 3) * 1000;
  for (const seed of (env.BC_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const net = hydrology.network!;
    const near: Parameters<typeof net.channels>[2] = [];
    const L = (hydrology.rivers ?? []) as unknown as Line[];
    const c = { thr: 0, bar: 0, thrFarm: 0, thrForest: 0, barFarm: 0, barForest: 0, thrOff: 0, barOff: 0 };
    for (const r of L) {
      const K = r.braidK;
      const m = r.s.length;
      if (!K || m < 3) continue;
      for (let s0 = 0; s0 + 1000 <= r.s[m - 1]; s0 += every) {
        let im = 0;
        while (im < m - 1 && r.s[im] < s0 + 500) im++;
        if (K[im] < 1.5) continue;
        const a = Math.max(0, im - 1);
        const b = Math.min(m - 1, im + 1);
        const tl = Math.hypot(r.north[b] - r.north[a], r.east[b] - r.east[a]) || 1;
        const rn = -(r.east[b] - r.east[a]) / tl;
        const re = (r.north[b] - r.north[a]) / tl;
        for (let o = -r.bedL[im]; o <= r.bedR[im]; o += 2) {
          const pn = r.north[im] + rn * o;
          const pe = r.east[im] + re * o;
          // On a braided ribbon (any line's), a thread or a bar.
          let on = false;
          let th = false;
          const k = net.channels(pn, pe, near);
          for (let q = 0; q < k; q++) {
            const x = near[q];
            if (!(x.braidK! > 1)) continue;
            on = true;
            if (braidAt(x.braidU!, x.braidUm!, x.braidHb!, x.braidK!, x.braidPh!, x.braidPs!, x.braidW!) > 0) th = true;
          }
          if (!on) continue;
          sampleTerrain(pn, pe, S);
          const nrm = terrainNormal(pn, pe);
          computeBiome(pn, pe, S, -nrm.z, B);
          const farm = B.farmland > 0.2;
          const forest = B.forest > 0.2;
          const off = !(S.riverHalfWidth > 0 && S.riverDist < S.riverHalfWidth);
          if (th) {
            c.thr++;
            if (farm) c.thrFarm++;
            if (forest) c.thrForest++;
            if (off) c.thrOff++;
          } else {
            c.bar++;
            if (farm) c.barFarm++;
            if (forest) c.barForest++;
            if (off) c.barOff++;
          }
        }
      }
    }
    const p = (x: number, n: number): string => `${x} (${((100 * x) / Math.max(1, n)).toFixed(1)} %)`;
    console.log(`BC seed ${seed}: thread points ${c.thr}: farmland ${p(c.thrFarm, c.thr)}, forest ${p(c.thrForest, c.thr)}, off the painted bed ${p(c.thrOff, c.thr)}; bar points ${c.bar}: farmland ${p(c.barFarm, c.bar)}, forest ${p(c.barForest, c.bar)}, off the painted bed ${p(c.barOff, c.bar)}`);
  }
  setWorldSeed(0);
});
