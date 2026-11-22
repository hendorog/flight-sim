// Probe (debug): a river's first few km: level, natural ground, lake. HP_SEED, HP_LINE, HP_KM.
import { it } from 'vitest';
import { hydrology, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('head profile', () => {
  setWorldSeed(Number(process.env.HP_SEED ?? 42));
  const r = hydrology.rivers![Number(process.env.HP_LINE ?? 104)];
  const mask = hydrology.lakeMask!;
  const km = Number(process.env.HP_KM ?? 3) * 1000;
  for (let i = 0; i < r.s.length && r.s[i] <= km; i += 4) {
    const lk = mask.at(r.north[i], r.east[i]);
    console.log(`s ${r.s[i].toFixed(0)} at ${r.north[i].toFixed(0)},${r.east[i].toFixed(0)} level ${r.level[i].toFixed(1)} ground ${naturalHeight(r.north[i], r.east[i]).toFixed(1)} hw ${r.halfWidth[i].toFixed(1)} lake ${lk > -Infinity ? lk.toFixed(1) + ' pool ' + mask.poolHit : '-'}`);
  }
  setWorldSeed(0);
});
