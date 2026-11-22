// Round T repairs: E3 at the receivers - the area (and half-width) a pond outlet's receiver carries from the outlet's
// junction down, every ~500 m for RV_KM km (RV_PAIRS seed:outlet,...).
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('receivers', () => {
  const pairs = (env.RV_PAIRS ?? '1:2181,1:2188,1:2185,42:2250,777777:2299,777777:2297').split(',').map((p) => p.split(':').map(Number));
  let cur = -1;
  for (const [seed, o] of pairs) {
    if (seed !== cur) { setWorldSeed(seed); terrainHeight(0, 0); cur = seed; }
    const L = hydrology.rivers!;
    const r = L[o];
    const n = r.north.length;
    const P = L[r.joins];
    let bi = 0, bd = Infinity;
    for (let i = 0; i < P.north.length; i++) { const d = Math.hypot(P.north[i] - r.north[n - 1], P.east[i] - r.east[n - 1]); if (d < bd) { bd = d; bi = i; } }
    const row: string[] = [];
    const s0 = P.s[bi];
    let next = s0;
    for (let i = bi; i < P.s.length && P.s[i] <= s0 + 1000 * Number(env.RV_KM ?? 3); i++) if (P.s[i] >= next) { row.push(`${((P.s[i] - s0) / 1000).toFixed(1)} km ${P.area![i].toFixed(1)} (hw ${P.halfWidth[i].toFixed(1)})`); next += 500; }
    console.log(`seed ${seed} outlet ${o} (A ${r.area![0].toFixed(1)}..${r.area![n - 1].toFixed(1)}) into ${r.joins}: just above ${P.area![Math.max(0, bi - 1)].toFixed(1)}; ${row.join('  ')}`);
  }
  setWorldSeed(0);
});
