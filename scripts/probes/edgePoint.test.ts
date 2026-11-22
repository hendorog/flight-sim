// Probe (foundation stage 2): the drawn ground along a line through one point (an edge step edgeScan found), with the
// macro model's parts there (heightfield.ts debugMacro). EP_SEED, EP_N, EP_E, EP_DIR (n or e), EP_HALF, EP_STEP.
import { it } from 'vitest';
import { debugMacro, gullyProbe, makeSample, naturalHeightRaw, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

it('edge point', () => {
  setWorldSeed(env.EP_SEED ?? '777777');
  const n0 = Number(env.EP_N ?? 162450);
  const e0 = Number(env.EP_E ?? -37000);
  const half = Number(env.EP_HALF ?? 300);
  const step = Number(env.EP_STEP ?? 25);
  const s = makeSample();
  for (let t = -half; t <= half; t += step) {
    const north = env.EP_DIR === 'e' ? n0 : n0 + t;
    const east = env.EP_DIR === 'e' ? e0 + t : e0;
    sampleTerrain(north, east, s);
    const m = debugMacro(north, east);
    const gp = { ...gullyProbe };
    console.log(`${north} ${east}: river ${s.river.toFixed(1)} rd ${s.riverDist.toFixed(0)} hw ${s.riverHalfWidth.toFixed(0)} ab ${s.airportBlend.toFixed(2)} ground ${s.ground.toFixed(1)} standing ${s.standing.toFixed(1)} raw ${naturalHeightRaw(north, east).toFixed(1)} coarseRaw ${m?.coarseRaw.toFixed(1)} coarse ${m?.coarse.toFixed(1)} natural ${m?.ground.toFixed(1)} d ${m?.s.d.toFixed(1)} c ${m?.s.c.toFixed(1)} f ${m?.s.f.toFixed(2)} w ${m?.s.w.toFixed(2)} r ${m?.s.r.toFixed(0)} | g ${gp.g.toFixed(2)} kCap ${gp.kCap.toFixed(0)} kFull ${gp.kFull.toFixed(0)} fall ${gp.fall.toFixed(3)} up ${gp.up.toFixed(2)} gate ${gp.gate.toFixed(2)}`);
  }
  setWorldSeed(0);
});
