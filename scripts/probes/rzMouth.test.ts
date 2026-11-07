// Probe (sea-level rivers): riverZero's flagged samples (level < 1 m over natural ground > 30 m) with how far each lies
// from its line's mouth along the channel and in a straight line. RZ_SEEDS.
import { it } from 'vitest';
import { hydrology, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('river zero mouth', () => {
  for (const seed of (env.RZ_SEEDS ?? '1,42,777777').split(',')) {
    setWorldSeed(seed);
    (hydrology.rivers ?? []).forEach((r, li) => {
      const m = r.north.length - 1;
      let lo = Infinity, hi = 0, n = 0;
      for (let k = 0; k < r.north.length; k += 4) {
        if (r.level[k] >= 1 || naturalHeight(r.north[k], r.east[k]) <= 30) continue;
        const d = (r.s[m] - r.s[k]) / 1000;
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
        n++;
      }
      if (n) console.log(`seed ${seed} line ${li} joins ${r.joins}: ${n} flagged samples ${lo.toFixed(1)}-${hi.toFixed(1)} km from the mouth along the channel; mouth level ${r.level[m].toFixed(1)}`);
    });
  }
  setWorldSeed(0);
});
