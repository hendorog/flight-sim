// Repair probe: steep drops of the water between consecutive samples that are not a fall (lip to foot), by kind.
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('steps', () => {
  for (const seed of (process.env.REPAIR_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const lips = new Set(hydrology.falls!.map((f) => `${f.line}:${f.index}`));
    const c = [[0, 0, 0], [0, 0, 0]];
    let worst = 0;
    hydrology.rivers!.forEach((r, li) => {
      for (let i = 0; i + 1 < r.level.length; i++) {
        const d = r.level[i] - r.level[i + 1];
        if (lips.has(`${li}:${i}`)) continue;
        const k = r.kind ?? 0;
        if (d > 5) c[k][0]++;
        if (d > 12) c[k][1]++;
        if (d > 30) c[k][2]++;
        worst = Math.max(worst, d);
      }
    });
    console.log(`seed ${seed}: drops between samples not at a lip >5/12/30 m: rivers ${c[0].join('/')}, streams ${c[1].join('/')}; worst ${worst.toFixed(1)} m`);
  }
  setWorldSeed(0);
});
