// Round T repairs 2: the steepest bank face of the lines in an airfield's blend. Every line (Round V A3r: rivers too, every
// kind; the airfields follow the terrain, so no field or line is named) within a
// generated field's reach, every FF_STEP m where the field's blend acts (airportBlend < 1 at its centre): the steepest
// slope of the drawn ground across hw .. hw + 15 m either side (1 m steps). Lengths where it is over 0.7 (35 degrees)
// and over 1 (45 degrees) - a cut face, not a bank - per seed (FF_SEEDS); the worst lines.
import { it } from 'vitest';
import { hydrology, terrainHeight, sampleTerrain, makeSample } from '../../../../src/world/terrain/heightfield';
import { generatedAirfields } from '../../../../src/world/airfields';
import { setWorldSeed } from '../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('field faces', () => {
  const s = makeSample();
  const ST = Number(env.FF_STEP ?? 10);
  for (const seed of (env.FF_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const fields = generatedAirfields();
    const L = hydrology.rivers!;
    const tot = { reach: 0, f07: 0, f10: 0 };
    const per: Array<{ li: number; f: string; reach: number; f07: number; f10: number; worst: number; at: string }> = [];
    L.forEach((r, li) => {
      const m = r.s.length;
      let fName = '';
      const near = (n: number, e: number): boolean => {
        for (const f of fields) {
          const reach = f.length / 2 + f.approachLength + f.blend;
          if ((n - f.north) ** 2 + (e - f.east) ** 2 <= reach * reach) { fName = f.code; return true; }
        }
        return false;
      };
      const row = { li, f: '', reach: 0, f07: 0, f10: 0, worst: 0, at: '' };
      for (let sv = 0; sv <= r.s[m - 1]; sv += ST) {
        let i = 0;
        while (i < m - 2 && r.s[i + 1] < sv) i++;
        const fr = Math.min(1, Math.max(0, (sv - r.s[i]) / ((r.s[i + 1] - r.s[i]) || 1)));
        const n = r.north[i] + fr * (r.north[i + 1] - r.north[i]), e = r.east[i] + fr * (r.east[i + 1] - r.east[i]);
        if (!near(n, e)) continue;
        const hw = r.halfWidth[i];
        const tn0 = r.north[i + 1] - r.north[i], te0 = r.east[i + 1] - r.east[i];
        const tl = Math.hypot(tn0, te0) || 1, tn = tn0 / tl, te = te0 / tl;
        const g = (d: number) => { sampleTerrain(n + te * d, e - tn * d, s); return s.ground; };
        sampleTerrain(n, e, s);
        if (!(s.airportBlend < 1) || s.standing > r.level[i]) continue;
        row.f = fName;
        let steep = 0;
        for (const sd of [-1, 1]) {
          let prev = g(sd * hw);
          for (let d = hw + 1; d <= hw + 15; d += 1) { const v = g(sd * d); steep = Math.max(steep, Math.abs(v - prev)); prev = v; }
        }
        tot.reach += ST; row.reach += ST;
        if (steep > 0.7) { tot.f07 += ST; row.f07 += ST; }
        if (steep > 1) { tot.f10 += ST; row.f10 += ST; }
        if (steep > row.worst) { row.worst = steep; row.at = `${n.toFixed(0)},${e.toFixed(0)} s ${sv}`; }
      }
      if (row.reach > 0) per.push(row);
    });
    console.log(`seed ${seed}: streams in a field's blend ${tot.reach} m; steepest bank face over 0.7 ${tot.f07} m, over 1 ${tot.f10} m`);
    per.sort((a, b) => b.f07 - a.f07 || b.worst - a.worst);
    for (const p of per.slice(0, Number(env.FF_TOP ?? 8))) console.log(`  line ${p.li} by ${p.f}: in the blend ${p.reach} m, face > 0.7 ${p.f07} m, > 1 ${p.f10} m, steepest ${p.worst.toFixed(2)} at ${p.at}`);
  }
  setWorldSeed(0);
});
