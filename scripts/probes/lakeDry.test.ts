// The drainage's ponds the lake raster leaves dry (drainage.ts LakeMask.main < 0): where, level, size, river. LD2_SEEDS.
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('dry lakes', () => {
  for (const seed of (process.env.LD2_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    const mask = hydrology.lakeMask as any;
    const d = mask.d;
    for (let k = 0; k < d.lakes.length; k++) {
      if (mask.main[k] >= 0) continue;
      const l = d.lakes[k];
      console.log(`DRY seed ${seed} pond ${k}: ${JSON.stringify(Object.fromEntries(Object.entries(l).filter(([, v]) => typeof v === 'number' || typeof v === 'boolean')))}; why ${mask.dryWhy?.[k] ?? '-'}`);
    }
  }
  setWorldSeed(0);
});
