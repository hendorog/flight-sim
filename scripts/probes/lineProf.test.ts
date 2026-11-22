// A line's profile: level, the drawn natural ground (naturalHeight), the smooth ground the streams are routed over
// (naturalHeightSmooth, before the rivers' carve), the drawn surface (sampleTerrain), breach, cut, half-width, catchment.
//   LP_SEED=42 LP_LINE=1074 LP_EVERY=2 npx vitest run --config scripts/probes/vitest.config.ts lineProf
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeight, naturalHeightSmooth, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('line prof', () => {
  setWorldSeed(env.LP_SEED ?? '42');
  const sm = makeSample();
  for (const li of (env.LP_LINE ?? '1074').split(',').map(Number)) {
    const r = hydrology.rivers![li] as unknown as Record<string, Float64Array> & { kind: number; end: string; joins: number };
    console.log(`line ${li} kind ${r.kind} end ${r.end} joins ${r.joins} samples ${r.s.length}`);
    for (let i = 0; i < r.s.length; i += Number(env.LP_EVERY ?? 2)) {
      sampleTerrain(r.north[i], r.east[i], sm);
      console.log(`  s ${r.s[i].toFixed(0).padStart(5)} ${r.north[i].toFixed(0)},${r.east[i].toFixed(0)} lvl ${r.level[i].toFixed(1)} nat ${naturalHeight(r.north[i], r.east[i]).toFixed(1)} smooth ${naturalHeightSmooth(r.north[i], r.east[i]).toFixed(1)} drawn ${sm.ground.toFixed(1)} br ${r.breach?.[i]?.toFixed(0)} cut ${r.cut?.[i]?.toFixed(1)} hw ${r.halfWidth[i].toFixed(1)} A ${r.area?.[i]?.toFixed(1)}`);
    }
  }
});
