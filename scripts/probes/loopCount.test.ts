// Round V A3 fix: the big rivers' loops world-wide (no site named): every river (kind 0) where its catchment is at least
// LC_MIN (300) km², 3 km windows along it every point: the path over the chord (sinuosity); the windows over 1.5 (a loop
// in them) and the median, per seed and by catchment band. The A3 checker's chkSin, over every river. LC_SEEDS.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type Line = { north: Float64Array; east: Float64Array; s: Float64Array; kind?: number; area?: Float64Array };
it('loop count', () => {
  const minA = Number(env.LC_MIN ?? 300);
  for (const seed of (env.LC_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed); terrainHeight(0, 0);
    const bands = [[300, 1500], [1500, Infinity]];
    const tot = bands.map(() => ({ n: 0, loops: 0, sins: [] as number[], km: 0 }));
    (hydrology.rivers as unknown as Line[]).forEach((r) => {
      if ((r.kind ?? 0) !== 0 || !r.area) return;
      for (let i = 0; i < r.north.length; i++) {
        if (r.area[i] < minA) continue;
        let j = i;
        while (j < r.s.length - 1 && r.s[j] - r.s[i] < 3000) j++;
        if (r.s[j] - r.s[i] < 2900) continue;
        const b = bands.findIndex(([lo, hi]) => r.area![i] >= lo && r.area![i] < hi);
        const v = (r.s[j] - r.s[i]) / Math.max(1, Math.hypot(r.north[j] - r.north[i], r.east[j] - r.east[i]));
        tot[b].n++;
        tot[b].sins.push(v);
        if (v > 1.5) tot[b].loops++;
      }
    });
    bands.forEach(([lo, hi], b) => {
      const t = tot[b];
      t.sins.sort((x, y) => x - y);
      console.log(`LC seed ${seed} rivers ${lo}-${hi === Infinity ? '' : hi} km²: 3 km windows ${t.n}, sinuosity p50 ${t.sins.length ? t.sins[Math.floor(t.sins.length / 2)].toFixed(3) : '-'} p90 ${t.sins.length ? t.sins[Math.floor(0.9 * t.sins.length)].toFixed(3) : '-'}, windows over 1.5 ${t.loops} (${((100 * t.loops) / Math.max(1, t.n)).toFixed(2)} %)`);
    });
  }
  setWorldSeed(0);
});
