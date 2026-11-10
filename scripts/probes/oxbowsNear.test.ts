// Round V A4': oxbows within OX_R m of OX_PT (n,e), seed OX_SEED: their extent, half-width, level; and the count.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('oxbows near', () => {
  for (const seed of (env.OX_SEEDS ?? '777777').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const [n, e] = (env.OX_PT ?? '0,0').split(',').map(Number);
    const R = Number(env.OX_R ?? 3000);
    const ox = hydrology.oxbows;
    let near = 0;
    let len = 0;
    ox.forEach((o, k) => {
      let L = 0;
      for (let i = 1; i < o.north.length; i++) L += Math.hypot(o.north[i] - o.north[i - 1], o.east[i] - o.east[i - 1]);
      len += L;
      let d = Infinity;
      for (let i = 0; i < o.north.length; i++) d = Math.min(d, Math.hypot(o.north[i] - n, o.east[i] - e));
      if (d > R) return;
      near++;
      console.log(`  oxbow ${k} d ${d.toFixed(0)} pts ${o.north.length} len ${L.toFixed(0)} hw ${o.halfWidth.toFixed(1)} level ${o.level.toFixed(1)} from ${o.north[0].toFixed(0)},${o.east[0].toFixed(0)}`);
    });
    console.log(`seed ${seed}: ${ox.length} oxbows, ${(len / 1000).toFixed(1)} km; ${near} within ${R} m`);
  }
  setWorldSeed(0);
});
