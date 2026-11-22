// Probe (foundation stage 1): the home runway's check on the finished ground (heightfield.ts homeRecheck) per seed.
import { it } from 'vitest';
import { homeRecheck } from '../../src/world/terrain/heightfield';
import { layoutReport } from '../../src/world/terrain/seededLayout';
import { setWorldSeed } from '../../src/world/worldSeed';
it('home check', () => {
  for (const seed of (process.env.HC_SEEDS ?? '1,7,42,1234,99991,777777').split(',')) {
    setWorldSeed(seed);
    const r = homeRecheck!;
    const site = layoutReport().site;
    console.log(`seed ${seed}: ${r.ok ? 'ok' : 'FAILS'}; elevation ${r.elevation} (sited ${site?.elevation}), spread ${r.spread.toFixed(0)} (sited ${site?.spread.toFixed(0)}), approach ${r.approach.toFixed(0)}, far end ${r.open.toFixed(0)}, circuit ${r.circuit.toFixed(0)} m`);
  }
  setWorldSeed(0);
});
