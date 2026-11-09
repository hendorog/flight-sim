// Points: the drawn surface's standing water, river and distances (probes).
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('pt info', () => {
  setWorldSeed(env.PT_SEED ?? '42');
  const s = makeSample();
  for (const p of (env.PT_PTS ?? '').split(';')) {
    const [n, e] = p.split(',').map(Number);
    sampleTerrain(n, e, s);
    console.log(`PT ${n},${e}: ground ${s.ground.toFixed(1)} standing ${s.standing.toFixed(1)} river ${s.river} riverDist ${s.riverDist.toFixed(0)} hw ${s.riverHalfWidth.toFixed(1)} airport ${s.airportBlend.toFixed(2)} lake ${hydrology.lakeMask?.at(n, e, s.ground)}`);
  }
});
