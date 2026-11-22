// Repair probe: streamGround's measure (water over the natural ground under it, outside lakes and the sea), also
// against the natural ground with the filled hollows' flats laid over it (Hydrology.network.fill), the ground the
// terrain is carved from, and split by kind.
import { it } from 'vitest';
import { hydrology, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('stream ground filled', () => {
  for (const seed of (process.env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const fill = hydrology.network!.fill;
    const n = [0, 0], o2 = [0, 0], f2 = [0, 0], f10 = [0, 0], worst = [0, 0];
    hydrology.rivers!.forEach((r) => {
      const kd = r.kind ?? 0;
      for (let k = 0; k < r.north.length; k += 3) {
        const pn = r.north[k], pe = r.east[k];
        if (hydrology.lakeMask!.at(pn, pe) > -Infinity) continue;
        const g = naturalHeight(pn, pe);
        if (g < 0.5) continue;
        const gf = fill ? fill(pn, pe, g) : g;
        n[kd]++;
        if (r.level[k] - g > 2) o2[kd]++;
        const over = r.level[k] - gf;
        if (over > 2) f2[kd]++;
        if (over > 10) f10[kd]++;
        worst[kd] = Math.max(worst[kd], over);
      }
    });
    const pc = (a: number, b: number) => `${(100 * a / Math.max(1, b)).toFixed(2)} %`;
    console.log(`seed ${seed}: all: over natural >2 m ${pc(o2[0] + o2[1], n[0] + n[1])}; over natural+flats >2 m ${pc(f2[0] + f2[1], n[0] + n[1])}, >10 m ${pc(f10[0] + f10[1], n[0] + n[1])}; rivers ${pc(f2[0], n[0])} (worst ${worst[0].toFixed(0)} m), streams ${pc(f2[1], n[1])} (worst ${worst[1].toFixed(0)} m)`);
  }
  setWorldSeed(0);
});
