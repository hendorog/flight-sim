// Round W R: how often each row the river part added or changed fires, per seed: the belt off its course (axis samples
// whose belt line lies more than a metre off the axis), the belt kept off a side that falls away (fell), the floor read
// past its bank by its slope (stations whose floor stands over FLOOR_OVER + bank + 1 at its edge), the floors laid
// (axis samples with a floor beyond the belt's sweep), the wide gravel bed (samples whose pattern share passes 0.2,
// BED_BIG), the junction blend (lines ending on another), the pitch-pool samples put in at a foot, the half-bends scaled
// into their room. RW_SEEDS.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { formProbe } from '../../src/world/terrain/riverNetwork';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('rule fires W', () => {
  for (const seed of (env.RW_SEEDS ?? '42').split(',').map(Number)) {
    let ax = 0, off = 0, wide = 0, floored = 0, fell = 0, slope = 0;
    formProbe.on = (li, a) => {
      const b = (a as unknown as { belt?: Float64Array; fellL?: Float64Array; fellR?: Float64Array; edgeL?: Float64Array; edgeR?: Float64Array }) ;
      for (let i = 0; i < a.s.length; i++) {
        ax++;
        if (b.belt && Math.abs(b.belt[i]) > 1) off++;
        if (a.roomL[i] + a.roomR[i] > a.Wa[i] + 1) floored++;
        if (b.fellL && (b.fellL[i] > 0.5 || (b.fellR && b.fellR[i] > 0.5))) fell++;
        if (b.edgeL && b.edgeR && Math.max(b.edgeL[i], b.edgeR[i]) > 2.5 + 1 + 1.6) slope++;
      }
      void li;
    };
    setWorldSeed(seed);
    terrainHeight(0, 0);
    formProbe.on = undefined;
    const rep = hydrology.streamReport as unknown as { form?: { samples: number; wideBed: number; white: number }; pitch?: { found: number; units: number; inserted: number } };
    const L = hydrology.rivers!;
    let joins = 0;
    for (const r of L) if ((r.joins ?? -1) >= 0) joins++;
    wide = rep.form?.wideBed ?? 0;
    console.log(`RW seed ${seed}: river axis samples ${ax}; belt off its course ${off} (${((100 * off) / Math.max(1, ax)).toFixed(0)} %); with a floor beyond its bed ${floored}; kept off a side falling away ${fell}; floor read past its bank by its slope ${slope}; form samples ${rep.form?.samples}, wide gravel bed ${wide}, white ${rep.form?.white}; junction blends ${joins}; pitch units ${rep.pitch?.found}, shaped ${rep.pitch?.units}, samples put in ${rep.pitch?.inserted}`);
  }
  setWorldSeed(0);
});
