// Round S: what makes a point "network" for the rills (rills.ts: standing water, a channel's water, an airfield's pad).
import { it } from 'vitest';
import { makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('pt net', () => {
  setWorldSeed(Number(env.PN_SEED ?? 1));
  const s = makeSample();
  for (const p of (env.PN_PTS ?? '').split(';')) {
    const [n, e] = p.split(',').map(Number);
    for (const [dn, de] of [[0, 0], [16, 0], [-16, 0], [0, 16], [0, -16]]) {
      sampleTerrain(n + dn, e + de, s);
      console.log(`PT ${n + dn},${e + de}: ground ${s.ground.toFixed(1)} standing ${s.standing.toFixed(1)} river ${s.river.toFixed(1)} riverDist ${s.riverDist.toFixed(1)} hw ${s.riverHalfWidth.toFixed(1)} airport ${s.airportBlend.toFixed(2)}`);
    }
  }
});
