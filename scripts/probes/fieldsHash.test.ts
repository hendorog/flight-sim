// Probe: the generated airfields of seeds 0 and 7 (the career boards' fields), printed so two trees can be compared.
import { it } from 'vitest';
import { setWorldSeed } from '../../src/world/worldSeed';
import { airfields } from '../../src/world/airfields';
import '../../src/world/terrain/heightfield';
it('fields', () => {
  for (const seed of [0, 7]) {
    setWorldSeed(seed);
    const f = airfields();
    console.log(`FIELDS seed ${seed}: ${f.map((a: any) => `${a.code}@${a.north.toFixed(1)},${a.east.toFixed(1)},${a.elevation.toFixed(2)},${a.heading.toFixed(4)},${a.length}`).join(' ')}`);
  }
  setWorldSeed(0);
});
