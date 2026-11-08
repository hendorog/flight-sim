// Samples per km of the drawn lines by kind (rivers 0, streams 1) and by catchment band (ribbon rows).
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('line density', () => {
  for (const seed of (env.LD_SEEDS ?? '42').split(',')) {
    setWorldSeed(seed);
    const bands = [0, 5, 10, 20, 45, 1e9];
    const n = bands.map(() => 0), km = bands.map(() => 0), nk = [0, 0], kmk = [0, 0];
    for (const r of hydrology.rivers ?? []) {
      const k = r.kind ?? 0;
      for (let i = 0; i + 1 < r.s.length; i++) {
        const ds = (r.s[i + 1] - r.s[i]) / 1000;
        const A = r.area?.[i] ?? 0;
        const b = bands.findIndex((v, j) => A >= v && A < bands[j + 1]);
        n[b]++; km[b] += ds; nk[k]++; kmk[k] += ds;
      }
    }
    console.log(`seed ${seed}: rivers ${nk[0]} samples ${kmk[0].toFixed(0)} km (${(nk[0] / kmk[0]).toFixed(0)}/km); streams ${nk[1]} samples ${kmk[1].toFixed(0)} km (${(nk[1] / kmk[1]).toFixed(0)}/km)`);
    for (let b = 0; b + 1 < bands.length; b++) console.log(`  A ${bands[b]}-${bands[b + 1]}: ${n[b]} samples ${km[b].toFixed(0)} km (${(n[b] / Math.max(1e-9, km[b])).toFixed(0)}/km)`);
  }
});
