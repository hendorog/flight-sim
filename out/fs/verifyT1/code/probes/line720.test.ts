// Checker T1: line 720 (seed 777777) samples about the held reach: s, level, cut, breach, drawn ground at the sample.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainHeight, naturalHeight } from '../../../../../src/world/terrain/heightfield';
import { generatedAirfields } from '../../../../../src/world/airfields';
import { setWorldSeed } from '../../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('line 720', () => {
  setWorldSeed(Number(env.SEED ?? 777777));
  terrainHeight(0, 0);
  const li = Number(env.LINE ?? 720);
  const r = hydrology.rivers![li] as unknown as { north: Float64Array; east: Float64Array; level: Float64Array; s: Float64Array; cut: Float64Array; breach: Float64Array; halfWidth: Float64Array; gradient: Float32Array };
  const s = makeSample();
  for (const f of generatedAirfields()) if (Math.hypot(f.north - r.north[0], f.east - r.east[0]) < 20000) console.log(`field at ${f.north.toFixed(0)},${f.east.toFixed(0)} elev ${f.elevation.toFixed(1)} heading ${(f.heading * 180 / Math.PI).toFixed(0)} len ${f.length} approach ${f.approachLength} flatMargin ${f.flatMargin} blend ${f.blend}`);
  const s0 = Number(env.S0 ?? 150), s1 = Number(env.S1 ?? 700);
  for (let i = 0; i < r.s.length; i++) {
    if (r.s[i] < s0 || r.s[i] > s1) continue;
    sampleTerrain(r.north[i], r.east[i], s);
    console.log(`i ${i} s ${r.s[i].toFixed(0)} at ${r.north[i].toFixed(0)},${r.east[i].toFixed(0)} level ${r.level[i].toFixed(1)} cut ${r.cut[i].toFixed(1)} breach ${r.breach[i].toFixed(1)} hw ${r.halfWidth[i].toFixed(1)} grad ${r.gradient[i].toFixed(2)} | drawn ${s.ground.toFixed(1)} river ${s.river === -Infinity ? '-' : s.river.toFixed(1)} approach ${s.approach.toFixed(2)} blend ${s.airportBlend.toFixed(2)} natural ${naturalHeight(r.north[i], r.east[i]).toFixed(1)}`);
  }
  setWorldSeed(0);
});
