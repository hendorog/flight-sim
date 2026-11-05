// Probe: lakes whose water drains (lattice receivers) into a lake standing higher than they do (the river would run
// uphill between them; the higher one's river is held below its water).
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('lake order', () => {
  for (const seed of (process.env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const m = hydrology.lakeMask as any;
    const d = m.d;
    const pondOf = new Int32Array(d.n * d.n).fill(-1);
    d.lakes.forEach((l: any, k: number) => { for (const c of l.cells) pondOf[c] = k; });
    const lvl = (k: number) => (m.main[k] >= 0 ? m.pools[m.main[k]].level : NaN);
    let bad = 0, worst = 0, where = '';
    d.lakes.forEach((l: any, k: number) => {
      if (m.main[k] < 0) return;
      let c = l.cells[0];
      for (let g = 0; g < 100000 && c >= 0; g++) { const r = d.receiver[c]; if (r < 0) break; c = r; if (pondOf[c] >= 0 && pondOf[c] !== k) break; }
      if (c < 0 || pondOf[c] < 0 || pondOf[c] === k) return;
      const down = pondOf[c];
      const dl = lvl(down);
      if (dl > lvl(k) + 0.5) { bad++; if (dl - lvl(k) > worst) { worst = dl - lvl(k); where = `lake ${k} (${lvl(k).toFixed(0)}) into ${down} (${dl.toFixed(0)}) at ${-160000 + Math.floor(c / d.n) * 1000},${-160000 + (c % d.n) * 1000}`; } }
    });
    console.log(`seed ${seed}: ${bad} lakes drain into a higher lake; worst ${worst.toFixed(0)} m: ${where}`);
  }
  setWorldSeed(0);
});
