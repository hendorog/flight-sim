// Repair probe: what makes the ground at a point (RP_SEED, RP_AT=n,e in m).
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, naturalHeight, naturalHeightSmooth } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('point', () => {
  setWorldSeed(Number(process.env.RP_SEED ?? 1));
  const s = makeSample();
  for (const p of (process.env.RP_AT ?? '-33420,95240').split(';')) {
    const [n, e] = p.split(',').map(Number);
    sampleTerrain(n, e, s);
    const nat = naturalHeight(n, e);
    const fill = hydrology.network!.fill ? hydrology.network!.fill(n, e, nat) : nat;
    console.log(`${n},${e}: natural ${nat.toFixed(1)} smooth ${naturalHeightSmooth(n, e).toFixed(1)} filled ${fill.toFixed(1)} drawn ${s.ground.toFixed(1)} standing ${s.standing.toFixed(1)} river ${s.river.toFixed(1)} lake ${hydrology.lakeMask!.at(n, e).toFixed(1)}`);
  }
  setWorldSeed(0);
});
