// Round V A3: every drawn line (river or stream) within LN_R m of LN_AT (n,e): its points there (every ~100 m) with water level,
// drawn ground at the point and the lowest drawn ground within 150 m across. LN_SEED.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('lines near', () => {
  setWorldSeed(Number(env.LN_SEED ?? 42));
  const s = makeSample();
  const g = (n: number, e: number): number => sampleTerrain(n, e, s).ground;
  const [an, ae] = (env.LN_AT ?? '0,0').split(',').map(Number);
  const R = Number(env.LN_R ?? 600);
  const rivers = hydrology.rivers as unknown as Array<{ north: Float64Array; east: Float64Array; level: Float64Array; s: Float64Array; kind?: number; area?: Float64Array; halfWidth: Float64Array }>;
  rivers.forEach((L, li) => {
    const rows: string[] = [];
    let last = -1e9;
    for (let i = 0; i < L.north.length; i++) {
      if (Math.hypot(L.north[i] - an, L.east[i] - ae) > R || L.s[i] - last < 100) continue;
      last = L.s[i];
      let dn = L.north[Math.min(L.north.length - 1, i + 1)] - L.north[Math.max(0, i - 1)], de = L.east[Math.min(L.north.length - 1, i + 1)] - L.east[Math.max(0, i - 1)];
      const dl = Math.hypot(dn, de) || 1;
      dn /= dl;
      de /= dl;
      let lo = Infinity;
      for (const sd of [-1, 1]) for (let o = L.halfWidth[i] + 10; o <= 150; o += 10) lo = Math.min(lo, g(L.north[i] - de * o * sd, L.east[i] + dn * o * sd));
      rows.push(`    s ${L.s[i].toFixed(0)} ${L.north[i].toFixed(0)},${L.east[i].toFixed(0)} level ${L.level[i].toFixed(1)} ground ${g(L.north[i], L.east[i]).toFixed(1)} lowest beside ${lo.toFixed(1)} A ${L.area ? L.area[i].toFixed(1) : '-'}`);
    }
    if (rows.length) console.log(`line ${li} kind ${L.kind ?? 0} (${L.north.length} points, ${(L.s[L.s.length - 1] / 1000).toFixed(1)} km)\n${rows.join('\n')}`);
  });
  setWorldSeed(0);
});
