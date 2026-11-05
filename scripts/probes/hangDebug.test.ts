// Probe (debugging): why a river ribbon hangs over the drawn ground. For the river points within HANG_R m of
// HANG_AT=north,east (HANG_SEED), the river level against the natural ground, the drawn ground, and every valley
// whose carve reaches the point (its line, level, distance, floodplain).
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeight, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('hang debug', () => {
  setWorldSeed(Number(process.env.HANG_SEED ?? 42));
  const [pn0, pe0] = (process.env.HANG_AT ?? '16260,2708').split(',').map(Number);
  const R = Number(process.env.HANG_R ?? 500);
  const s = makeSample();
  const rivers: any[] = (hydrology as any).rivers;
  const net: any = hydrology.network;
  const vn: any[] = [];
  for (let li = 0; li < rivers.length; li++) {
    const r = rivers[li];
    for (let k = 0; k < r.north.length; k += 4) {
      const pn = r.north[k], pe = r.east[k];
      if (Math.hypot(pn - pn0, pe - pe0) > R) continue;
      sampleTerrain(pn, pe, s);
      const nat = naturalHeight(pn, pe);
      const nv = net.valleys(pn, pe, vn);
      const vs: string[] = [];
      for (let j = 0; j < nv; j++) vs.push(`[lvl ${vn[j].level.toFixed(1)} d ${vn[j].dist.toFixed(0)} fp ${vn[j].floodplain.toFixed(0)} I ${vn[j].influence.toFixed(0)}]`);
      console.log(`line ${li} joins ${r.joins} k ${k} s ${r.s[k].toFixed(0)} (${pn.toFixed(0)},${pe.toFixed(0)}) level ${r.level[k].toFixed(1)} hw ${r.halfWidth[k].toFixed(0)} nat ${nat.toFixed(1)} ground ${s.ground.toFixed(1)} standing ${s.standing.toFixed(1)} river ${s.river.toFixed(1)} mask ${(hydrology.lakeMask as any).at(pn, pe).toFixed(1)} valleys ${vs.join(' ')}`);
    }
  }
  setWorldSeed(0);
});
