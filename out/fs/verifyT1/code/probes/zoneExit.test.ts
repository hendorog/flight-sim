// Checker T1: for lines inside an airfield's reach, (a) streams: water under the drawn ground at samples OUTSIDE the
// reach downstream of it (the hold's falling-downstream pass lowers them without touching their cut); (b) rivers in
// the reach: water over both banks (holdUnder skips rivers).
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainHeight } from '../../../../../src/world/terrain/heightfield';
import { generatedAirfields } from '../../../../../src/world/airfields';
import { AIRPORT } from '../../../../../src/core/world';
import { setWorldSeed } from '../../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('zone exit', () => {
  for (const seed of (env.SEEDS ?? '777777,1,42').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const RW = AIRPORT.runway;
    const C = Math.cos(RW.heading), S = Math.sin(RW.heading);
    const near = (n: number, e: number): boolean => {
      for (const f of generatedAirfields()) { const fn = n - f.north, fe = e - f.east; const reach = f.length / 2 + f.approachLength + f.blend; if (fn * fn + fe * fe <= reach * reach) return true; }
      const dn = n - RW.center.north, de = e - RW.center.east;
      const along = dn * C + de * S, across = -dn * S + de * C;
      return Math.abs(along) - RW.length / 2 < AIRPORT.approachLength && Math.abs(across) < 2 * (300 + 0.12 * AIRPORT.approachLength);
    };
    const L = hydrology.rivers!;
    const s = makeSample();
    const out: string[] = [];
    let riverOver = 0;
    for (let li = 0; li < L.length; li++) {
      const r = L[li];
      const m = r.north.length;
      let first = -1;
      for (let i = 0; i < m && first < 0; i++) if (near(r.north[i], r.east[i])) first = i;
      if (first < 0) continue;
      if ((r.kind ?? 0) === 0) {
        for (let i = first; i < m; i++) {
          if (!near(r.north[i], r.east[i])) continue;
          sampleTerrain(r.north[i], r.east[i], s);
          if (s.standing > s.ground + 0.05) continue;
          if (r.level[i] - s.ground > 5) riverOver++;
        }
        continue;
      }
      let worst = -Infinity, at = '', len = 0;
      for (let i = first + 1; i < m; i++) {
        if (near(r.north[i], r.east[i])) continue;
        sampleTerrain(r.north[i], r.east[i], s);
        const under = s.ground - r.level[i];
        if (under > 5) len += r.s[i] - r.s[i - 1];
        if (under > worst) { worst = under; at = `${r.north[i].toFixed(0)},${r.east[i].toFixed(0)} s ${r.s[i].toFixed(0)}`; }
      }
      if (worst > 5) out.push(`line ${li}: outside the reach downstream, water up to ${worst.toFixed(1)} m under the drawn ground at ${at}; ${len.toFixed(0)} m > 5 m under`);
    }
    console.log(`seed ${seed}: river samples in reach > 5 m over centre ground: ${riverOver}`);
    for (const o of out) console.log('  ' + o);
  }
  setWorldSeed(0);
});
