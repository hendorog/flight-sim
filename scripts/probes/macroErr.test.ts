import { it } from 'vitest';
import { macroAt, macroCachedAt } from '/home/roger/github/fs-exp/streams3/src/world/terrain/seededLayout';
import { naturalHeight } from '/home/roger/github/fs-exp/streams3/src/world/terrain/heightfield';
import { setWorldSeed } from '/home/roger/github/fs-exp/streams3/src/world/worldSeed';
it('macro err', () => {
  for (const seed of [42, 1, 777777]) {
    setWorldSeed(seed);
    void naturalHeight;
    const a = { inland: 0, uplift: 0, foothill: 0, hilly: 0 }, b = { ...a };
    let mi = 0, mu = 0, mf = 0, mh = 0;
    for (let k = 0; k < 200000; k++) {
      const n = -150000 + ((k * 7919) % 300000), e = -150000 + ((k * 104729) % 300000) + 0.37 * k % 1000;
      macroAt(n, e, a); macroCachedAt(n, e, b);
      mi = Math.max(mi, Math.abs(a.inland - b.inland)); mu = Math.max(mu, Math.abs(a.uplift - b.uplift)); mf = Math.max(mf, Math.abs(a.foothill - b.foothill)); mh = Math.max(mh, Math.abs(a.hilly - b.hilly));
    }
    console.log(`MACROERR seed ${seed}: max |d inland| ${mi.toFixed(2)} m, uplift ${mu.toFixed(4)}, foothill ${mf.toFixed(4)}, hilly ${mh.toFixed(4)}`);
  }
  setWorldSeed(0);
});
