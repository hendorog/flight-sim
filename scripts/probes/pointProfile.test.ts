// Probe: a ground profile through a point along north or east (PP_SEED, PP_N, PP_E, PP_AXIS n|e, PP_HALF, PP_STEP),
// with the macro model's parts (heightfield.ts debugMacro) at each sample.
import { it } from 'vitest';
import { debugMacro, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('point profile', () => {
  const env = process.env;
  setWorldSeed(Number(env.PP_SEED ?? 1));
  const pn = Number(env.PP_N), pe = Number(env.PP_E), half = Number(env.PP_HALF ?? 300), step = Number(env.PP_STEP ?? 25);
  const s = makeSample();
  for (let t = -half; t <= half; t += step) {
    const n = env.PP_AXIS === 'n' ? pn + t : pn, e = env.PP_AXIS === 'n' ? pe : pe + t;
    sampleTerrain(n, e, s);
    const m = debugMacro(n, e);
    console.log(`${n.toFixed(0)},${e.toFixed(0)} ground ${s.ground.toFixed(1)} natural ${m?.ground.toFixed(1)} river ${Number.isFinite(s.river) ? s.river.toFixed(1) : '-'} | raw ${m?.coarseRaw.toFixed(1)} macro ${m?.coarse.toFixed(1)} d ${m?.s.d.toFixed(1)} c ${m?.s.c.toFixed(1)} f ${m?.s.f.toFixed(2)} w ${m?.s.w.toFixed(2)}`);
  }
  setWorldSeed(0);
});
