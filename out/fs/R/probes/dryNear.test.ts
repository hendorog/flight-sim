// verifyT2: for every line, the length of its course within a generated field's reach (centre distance <= length/2 +
// approachLength + blend, heightfield.ts nearField) where the terrain's ground at the centreline stands over the terrain's
// water (water hidden: the stream vanishes), and where the water stands > 3 m over the centre ground. DN_SEEDS.
import { it } from 'vitest';
import { hydrology, terrainHeight, sampleTerrain, makeSample } from '../../../../src/world/terrain/heightfield';
import { generatedAirfields } from '../../../../src/world/airfields';
import { setWorldSeed } from '../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('dry near fields', () => {
  const s = makeSample();
  for (const seed of (env.DN_SEEDS ?? '777777').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const rivers = hydrology.rivers ?? [];
    let totDry = 0, totHigh = 0, totIn = 0;
    for (let li = 0; li < rivers.length; li++) {
      const r = rivers[li];
      let dry = 0, high = 0, inR = 0, code = '', wn = 0, we = 0, worst = 0;
      for (let i = 1; i < r.north.length; i++) {
        let f0 = null as null | { code: string };
        for (const f of generatedAirfields()) {
          const reach = f.length / 2 + f.approachLength + f.blend;
          if ((r.north[i] - f.north) ** 2 + (r.east[i] - f.east) ** 2 <= reach * reach) { f0 = f; break; }
        }
        if (!f0) continue;
        const ds = r.s[i] - r.s[i - 1];
        inR += ds; code = f0.code;
        sampleTerrain(r.north[i], r.east[i], s);
        if (s.ground > s.river + 0.05) { dry += ds; if (s.ground - s.river > worst) { worst = s.ground - s.river; wn = r.north[i]; we = r.east[i]; } }
        else if (s.river - s.ground > 3) high += ds;
      }
      if (inR > 0) {
        totDry += dry; totHigh += high; totIn += inR;
        if (dry > 30 || high > 30) console.log(`seed ${seed} line ${li} kind ${r.kind} field ${code}: in reach ${inR.toFixed(0)} m, hidden ${dry.toFixed(0)} m (worst ${worst.toFixed(1)} m under at ${wn.toFixed(0)},${we.toFixed(0)}), water >3 m over centre ground ${high.toFixed(0)} m`);
      }
    }
    console.log(`seed ${seed} TOTAL in reach ${totIn.toFixed(0)} m, hidden ${totDry.toFixed(0)} m, water >3 m over centre ground ${totHigh.toFixed(0)} m`);
  }
  setWorldSeed(0);
});
