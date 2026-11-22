// Checker T1: cross-sections of line 720 (seed 777777) at given s: drawn ground (and water fields) across the course.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainHeight } from '../../../../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('xs 720', () => {
  setWorldSeed(Number(env.SEED ?? 777777));
  terrainHeight(0, 0);
  const li = Number(env.LINE ?? 720);
  const r = hydrology.rivers![li];
  const s = makeSample();
  for (const sv of (env.SV ?? '230,270,285,320,400,600,900').split(',').map(Number)) {
    let i = 0;
    while (i < r.s.length - 2 && r.s[i + 1] < sv) i++;
    const tn0 = r.north[i + 1] - r.north[i], te0 = r.east[i + 1] - r.east[i];
    const tl = Math.hypot(tn0, te0) || 1;
    const tn = tn0 / tl, te = te0 / tl;
    const cn = r.north[i], ce = r.east[i];
    const parts: string[] = [];
    for (const d of [-150, -80, -40, -20, -10, -5, -2, 0, 2, 5, 10, 20, 40, 80, 150]) {
      sampleTerrain(cn + te * d, ce - tn * d, s);
      parts.push(`${d}:${s.ground.toFixed(0)}${s.river > -Infinity ? `w${s.river.toFixed(0)}` : ''}`);
    }
    console.log(`s ${r.s[i].toFixed(0)} at ${cn.toFixed(0)},${ce.toFixed(0)} water ${r.level[i].toFixed(1)} hw ${r.halfWidth[i].toFixed(1)} | ${parts.join(' ')}`);
  }
  setWorldSeed(0);
});
