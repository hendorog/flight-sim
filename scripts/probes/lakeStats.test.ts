// Probe: a seeded world's lakes as the raster flood draws them (drainage.ts LakeMask): pools, ponds left dry, how far
// the flood lowered each pond's settled level, and the lakes' sizes.
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('lake stats', () => {
  for (const seed of (process.env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const mask = hydrology.lakeMask as any;
    const d = mask.d;
    const pools = mask.pools as Array<{ lake: number; level: number; bottom: number; wet: number }>;
    let dry = 0, dryRiver = 0;
    const drops: number[] = [];
    for (let k = 0; k < d.lakes.length; k++) {
      const id = mask.main[k];
      if (id < 0) { dry++; if (d.lakes[k].river) dryRiver++; continue; }
      drops.push(d.lakes[k].level - pools[id].level);
    }
    drops.sort((a, b) => a - b);
    const extra = pools.length - (d.lakes.length - dry);
    const wetKm = pools.reduce((s, p) => s + p.wet, 0) * 0.0625;
    const q = (a: number[], f: number) => a[Math.min(a.length - 1, Math.floor(a.length * f))].toFixed(1);
    console.log(`seed ${seed}: ${d.lakes.length} ponds -> ${hydrology.lakes.length} lakes (${dry} left dry, ${dryRiver} of them on a river) + ${extra} extra pools; water ${wetKm.toFixed(0)} km²; level lowered by the flood: median ${q(drops, 0.5)} m, p90 ${q(drops, 0.9)}, max ${q(drops, 1)}, ${drops.filter((x) => x > 10).length} by more than 10 m`);
  }
  setWorldSeed(0);
});
