// Probe: sampleTerrain at points (PS_SEED, PS_PTS "n,e;n,e"): ground, standing, river, and the lake mask there.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('point sample', () => {
  setWorldSeed(Number(process.env.PS_SEED ?? 42));
  const s = makeSample();
  for (const p of (process.env.PS_PTS ?? '0,0').split(';')) {
    const [n, e] = p.split(',').map(Number);
    sampleTerrain(n, e, s);
    console.log(`${n},${e}: ground ${s.ground.toFixed(1)} standing ${s.standing.toFixed(1)} river ${s.river.toFixed(1)} lakeMask ${hydrology.lakeMask?.at(n, e)} oxbows ${hydrology.oxbows.length}`);
  }
  setWorldSeed(0);
});
