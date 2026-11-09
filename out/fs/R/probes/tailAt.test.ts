// Round T repairs: one line's samples from TA_FROM m on (seed TA_SEED, line TA_LINE): natural ground, the lake mask's
// level and field there, the drawn ground / stream water / standing water.
import { it } from 'vitest';
import { hydrology, terrainHeight, sampleTerrain, makeSample, naturalHeight } from '../../../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('tail', () => {
  const s = makeSample();
  setWorldSeed(Number(env.TA_SEED ?? 1));
  terrainHeight(0, 0);
  const li = Number(env.TA_LINE ?? 2283);
  const r = hydrology.rivers![li];
  const mask = hydrology.lakeMask!;
  const from = Number(env.TA_FROM ?? 0);
  console.log(`line ${li} kind ${r.kind} end ${r.end} joins ${r.joins} n ${r.north.length} len ${r.s[r.s.length - 1].toFixed(0)}`);
  for (let i = 0; i < r.north.length; i++) {
    if (r.s[i] < from) continue;
    const n = r.north[i], e = r.east[i];
    const h = naturalHeight(n, e);
    const lv = mask.at(n, e, h);
    const f = mask.field;
    sampleTerrain(n, e, s);
    console.log(`  ${i} s ${r.s[i].toFixed(0)} at ${n.toFixed(0)},${e.toFixed(0)} level ${r.level[i].toFixed(1)} cut ${(r as unknown as { cut: Float64Array }).cut[i].toFixed(1)} breach ${(r as unknown as { breach: Float64Array }).breach[i].toFixed(1)} hw ${r.halfWidth[i].toFixed(1)} | natural ${h.toFixed(1)} mask ${lv === -Infinity ? '-' : lv.toFixed(1)} field ${f.toFixed(1)} | ground ${s.ground.toFixed(1)} river ${s.river.toFixed(1)} standing ${s.standing.toFixed(1)}`);
  }
  setWorldSeed(0);
});
