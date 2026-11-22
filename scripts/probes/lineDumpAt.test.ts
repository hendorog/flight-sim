// Round V A3r: one line's points LD_FROM..LD_TO (every point) with level, drawn ground, standing water and the lake mask
// there; its kind, end, join. LD_SEED, LD_LINE.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('line dump at', () => {
  setWorldSeed(Number(env.LD_SEED ?? 42));
  const s = makeSample();
  const L = (hydrology.rivers as unknown as Array<{ north: Float64Array; east: Float64Array; level: Float64Array; s: Float64Array; kind?: number; end?: string; joins: number; halfWidth: Float64Array }>)[Number(env.LD_LINE ?? 0)];
  const m = L.north.length;
  console.log(`line ${env.LD_LINE} kind ${L.kind ?? 0} end ${L.end ?? '-'} joins ${L.joins} points ${m}`);
  const a = Number(env.LD_FROM ?? 0), b = Math.min(m - 1, Number(env.LD_TO ?? m - 1));
  for (let i = a; i <= b; i++) {
    sampleTerrain(L.north[i], L.east[i], s);
    const lk = hydrology.lakeMask ? hydrology.lakeMask.at(L.north[i], L.east[i], s.ground) : -Infinity;
    console.log(`  ${i} s ${L.s[i].toFixed(0)} ${L.north[i].toFixed(0)},${L.east[i].toFixed(0)} level ${L.level[i].toFixed(1)} hw ${L.halfWidth[i].toFixed(1)} ground ${s.ground.toFixed(1)} standing ${s.standing.toFixed(1)} mask ${Number.isFinite(lk) ? lk.toFixed(1) : '-'}`);
  }
  setWorldSeed(0);
});
