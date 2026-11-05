// Repair probe: a line's profile. RL_SEED, RL_LINES=a,b ; RL_EVERY
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, naturalHeight, naturalHeightSmooth } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('line profile', () => {
  setWorldSeed(Number(process.env.RL_SEED ?? 777777));
  const rs = hydrology.rivers!;
  const s = makeSample();
  for (const li of (process.env.RL_LINES ?? '457').split(',').map(Number)) {
    const r = rs[li];
    console.log(`line ${li} kind ${r.kind} end ${r.end} joins ${r.joins} n ${r.north.length} len ${(r.s[r.s.length - 1] / 1000).toFixed(2)} km`);
    const every = Number(process.env.RL_EVERY ?? Math.max(1, Math.floor(r.north.length / 40)));
    for (let i = 0; i < r.north.length; i += every) {
      sampleTerrain(r.north[i], r.east[i], s);
      console.log(`  i ${i} s ${r.s[i].toFixed(0)} @${(r.north[i] / 1000).toFixed(3)},${(r.east[i] / 1000).toFixed(3)} lvl ${r.level[i].toFixed(1)} smooth ${naturalHeightSmooth(r.north[i], r.east[i]).toFixed(1)} nat ${naturalHeight(r.north[i], r.east[i]).toFixed(1)} ground ${s.ground.toFixed(1)} hw ${r.halfWidth[i].toFixed(1)} area ${r.area?.[i].toFixed(1)} reg ${r.regime?.[i]}`);
    }
  }
  setWorldSeed(0);
});
