// Probe (foundation stage 1): why a closed basin of the drawn surface is there. BW_FILE: lines "north east ..." (out/f1
// tools/basinmap.py), BW_SEED. For each: the macro model's parts (heightfield.ts debugMacro), the lattice cells about it
// (the model's T and the drainage area), and whether the noise lattice's B-spline or the residual makes the hollow.
import { it } from 'vitest';
import { debugMacro, seededDrainage } from '../../src/world/terrain/heightfield';
import { DOMAIN_HALF, DRAIN_CELL } from '../../src/world/terrain/drainage';
import { setWorldSeed } from '../../src/world/worldSeed';
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { readFileSync(p: string, e: string): string };
it('basin why', () => {
  setWorldSeed(Number(process.env.BW_SEED ?? 42));
  const d = seededDrainage!;
  const lines = fs.readFileSync(process.env.BW_FILE!, 'utf8').split('\n').filter((l) => l.includes('depth')).slice(0, Number(process.env.BW_N ?? 20));
  for (const l of lines) {
    const [pn, pe] = l.split(' ').map(Number);
    const m = debugMacro(pn, pe)!;
    // The same parts 300 m around: is the floor lower than its surroundings in each part?
    const ring = (f: (a: number, b: number) => number): number => {
      let lo = Infinity;
      for (let k = 0; k < 12; k++) { const a = (k / 12) * 2 * Math.PI; lo = Math.min(lo, f(pn + 400 * Math.cos(a), pe + 400 * Math.sin(a))); }
      return lo - f(pn, pe);
    };
    const part = (which: 'd' | 'c' | 'res' | 'gully' | 'macro') => (a: number, b: number): number => {
      const q = debugMacro(a, b)!;
      if (which === 'd') return q.s.d + q.s.r * 0 + q.coarseRaw - (q.coarseRaw - (q.s.f > 0 ? q.s.r : q.s.r));
      if (which === 'c') return q.s.c;
      if (which === 'res') return q.coarseRaw;
      if (which === 'macro') return q.coarse;
      return q.ground - q.coarse;
    };
    const i = Math.round((pn + DOMAIN_HALF) / DRAIN_CELL), j = Math.round((pe + DOMAIN_HALF) / DRAIN_CELL);
    const c = i * d.n + j;
    console.log(`${l.trim()} | d ${m.s.d.toFixed(0)} c ${m.s.c.toFixed(0)} f ${m.s.f.toFixed(2)} | raw ${m.coarseRaw.toFixed(0)} macro ${m.coarse.toFixed(0)} ground ${m.ground.toFixed(0)} | ring rise: raw ${ring(part('res')).toFixed(0)} macro ${ring(part('macro')).toFixed(0)} carve ${ring(part('c')).toFixed(0)} gully ${ring(part('gully')).toFixed(0)} | cell A ${d.area[c].toFixed(0)} km² T ${d.routed[c].toFixed(0)}`);
  }
  setWorldSeed(0);
});
