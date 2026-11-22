// Probe (foundation stage 2): a lake-shore wall waterWalls found: the lakes near the point, their levels and kinds, and
// the ground and water along a line through it. LW_SEED, LW_N, LW_E.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, seededDrainage, seededInputs } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('lake wall', () => {
  setWorldSeed(env.LW_SEED ?? '42');
  const n0 = Number(env.LW_N ?? 58450), e0 = Number(env.LW_E ?? -21500);
  const d = seededDrainage!;
  hydrology.lakes.forEach((l, k) => {
    if (Math.hypot(l.north - n0, l.east - e0) > 8000) return;
    const dl = d.lakes[k];
    const cap = dl ? dl.cells.filter((c) => seededInputs!.cap[c] >= 1).length : -1;
    console.log(`lake ${k} at ${l.north.toFixed(0)},${l.east.toFixed(0)} level ${l.level.toFixed(1)} spill ${dl?.spill.toFixed(1)} cells ${dl?.cells.length} capped ${cap} river ${dl?.river} tarn ${dl?.tarn}`);
  });
  const s = makeSample();
  for (const [dn, de] of [[1, 0], [0, 1]]) {
    const row: string[] = [];
    for (let t = -400; t <= 400; t += 50) {
      sampleTerrain(n0 + dn * t, e0 + de * t, s);
      row.push(`${t}: g ${s.ground.toFixed(0)} w ${s.standing.toFixed(0)}`);
    }
    console.log(`${dn ? 'N' : 'E'} line: ${row.join(' | ')}`);
  }
  setWorldSeed(0);
});
