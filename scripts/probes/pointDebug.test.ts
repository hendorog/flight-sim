// Probe (debugging): everything the terrain knows along a short east-west line through PT_AT=north,east (PT_SEED).
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeight, naturalHeightCoarse, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('point debug', () => {
  setWorldSeed(Number(process.env.PT_SEED ?? 777777));
  const [pn, pe] = (process.env.PT_AT ?? '33100,-140250').split(',').map(Number);
  const s = makeSample();
  const v = { dist: 0, level: 0, floodplain: 0 };
  const m = hydrology.lakeMask as any;
  for (const [dn, de] of [[0, -100], [0, -50], [0, 0], [0, 50], [0, 100], [-50, 0], [50, 0], [-100, 0], [100, 0]]) {
    const n = pn + dn, e = pe + de;
    sampleTerrain(n, e, s);
    hydrology.queryValley(n, e, v);
    const r = { dist: 0, level: 0, halfWidth: 0, s: 0, side: 0, beyondSource: 0 } as any;
    hydrology.queryRiver(n, e, r);
    console.log(`${n},${e}: ground ${s.ground.toFixed(1)} standing ${s.standing.toFixed(1)} river ${s.river.toFixed(1)} nat ${naturalHeight(n, e).toFixed(1)} coarse ${naturalHeightCoarse(n, e).toFixed(1)} | valley d ${v.dist.toFixed(0)} lvl ${v.level.toFixed(1)} fp ${v.floodplain.toFixed(0)} | chan d ${r.dist.toFixed(0)} lvl ${r.level.toFixed(1)} w ${r.halfWidth.toFixed(0)} | mask ${m.at(n, e).toFixed(1)} f ${m.field.toFixed(1)} hold ${m.holds(n, e).toFixed(2)}`);
  }
  setWorldSeed(0);
});
