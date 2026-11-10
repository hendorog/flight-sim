// Round V A3r: seededWorld's "ends in a lake" check at points LE_PTS: terrainHeight, the sample, and lakeMask.at(n, e, h).
import { it } from 'vitest';
import { hydrology, terrainHeight, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('lake at end', () => {
  setWorldSeed(Number(env.LE_SEED ?? 1));
  const s = makeSample();
  for (const p of (env.LE_PTS ?? '0,0').split(';')) {
    const [n, e] = p.split(',').map(Number);
    const h = terrainHeight(n, e);
    sampleTerrain(n, e, s);
    console.log(`LE ${n},${e} terrainHeight ${h.toFixed(2)} ground ${s.ground.toFixed(2)} standing ${s.standing.toFixed(2)} river ${s.river.toFixed(2)} at(h) ${hydrology.lakeMask!.at(n, e, h)} at(ground) ${hydrology.lakeMask!.at(n, e, s.ground)} at() ${hydrology.lakeMask!.at(n, e)}`);
  }
  setWorldSeed(0);
});
