// Probe (foundation stage 2): rivers whose water level reaches the sea's (< 1 m) while the natural ground under them
// stands well above it (> 30 m): where the level first drops to it, and the ground there. RZ_SEEDS.
import { it } from 'vitest';
import { hydrology, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('river zero', () => {
  for (const seed of (env.RZ_SEEDS ?? '1,42,777777').split(',')) {
    setWorldSeed(seed);
    let bad = 0, km = 0;
    (hydrology.rivers ?? []).forEach((r, li) => {
      let first = -1, worst = 0;
      for (let k = 0; k < r.north.length; k += 4) {
        if (r.level[k] >= 1) continue;
        const g = naturalHeight(r.north[k], r.east[k]);
        if (g > 30) {
          if (first < 0) first = k;
          worst = Math.max(worst, g);
          km += (r.s[Math.min(r.s.length - 1, k + 4)] - r.s[k]) / 1000;
        }
      }
      if (first < 0) return;
      bad++;
      if (bad <= 8) {
        const k0 = Math.max(0, first - 40);
        const pts: string[] = [];
        for (let k = k0; k <= first; k += 8) pts.push(`${r.level[k].toFixed(0)}/${naturalHeight(r.north[k], r.east[k]).toFixed(0)}`);
        console.log(`seed ${seed} line ${li} kind ${r.kind} A ${r.area?.[first].toFixed(0)}: level 0 over ground up to ${worst.toFixed(0)} m from s ${(r.s[first] / 1000).toFixed(1)} km at ${r.north[first].toFixed(0)},${r.east[first].toFixed(0)}; level/ground before: ${pts.join(' ')}`);
      }
    });
    console.log(`seed ${seed}: ${bad} lines with the level at the sea's over ground > 30 m, ${km.toFixed(1)} km`);
  }
  setWorldSeed(0);
});
