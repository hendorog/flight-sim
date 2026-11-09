// outletLoops (round T, from inv-vends' invVendsJoins): no pond's or lake's outlet may join the stream that fills it, or
// any line upstream of that stream (its water would go round in a circle and the loop doubles the catchment drawn).
// An outlet: a stream whose head lies in a lake's water (it leaves that pool). The lines filling the pool: every line
// whose last point lies in that pool's water. A loop: the outlet's way down (joins, then its receiver's joins, ...)
// reaches one of them. For each loop, the filling line's area just above and below where the outlet's water comes back
// in (the jump the loop adds), and the outlet's own area at its mouth.
//   OL_SEEDS=1,42,777777,7 npx vitest run --config scripts/probes/vitest.config.ts outletLoops --silent=false
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { DOMAIN_HALF, LAKE_RASTER } from '../../src/world/terrain/drainage';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('outlet loops', () => {
  for (const seed of (env.OL_SEEDS ?? '1,42,777777,7').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = hydrology.rivers!;
    const mask = hydrology.lakeMask! as unknown as { at(n: number, e: number): number; poolAt(i: number, j: number): number };
    const poolOf = (n: number, e: number): number => {
      // (The pool whose domain holds the raster point nearest, or one of the four about it where the water stands.)
      const i0 = Math.round((n + DOMAIN_HALF) / LAKE_RASTER), j0 = Math.round((e + DOMAIN_HALF) / LAKE_RASTER);
      const p = mask.poolAt(i0, j0);
      if (p >= 0) return p;
      if (!(mask.at(n, e) > -Infinity)) return -1;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const q = mask.poolAt(i0 + a, j0 + b); if (q >= 0) return q; }
      return -1;
    };
    const fills = new Map<number, number[]>();
    L.forEach((r, li) => {
      const m = r.north.length - 1;
      const p = poolOf(r.north[m], r.east[m]);
      if (p >= 0) (fills.get(p) ?? fills.set(p, []).get(p)!).push(li);
    });
    let outlets = 0;
    const loops: string[] = [];
    L.forEach((r, li) => {
      if ((r.kind ?? 0) === 0) return;
      const P = poolOf(r.north[0], r.east[0]);
      if (P < 0) return;
      outlets++;
      const F = new Set(fills.get(P) ?? []);
      if (F.has(li)) F.delete(li);
      let x = r.joins ?? -1;
      for (let g = 0; x >= 0 && g < 400; g++) {
        if (F.has(x)) {
          const T = L[x];
          const n = r.north.length - 1;
          let bi = 0, bd = Infinity;
          for (let i = 0; i < T.north.length; i++) { const d = Math.hypot(T.north[i] - r.north[n], T.east[i] - r.east[n]); if (d < bd) { bd = d; bi = i; } }
          const tm = T.north.length - 1;
          const a0 = T.area![Math.max(0, bi - 3)], a1 = T.area![Math.min(tm, bi + 3)];
          loops.push(`  ${li} (outlet of pool ${P}, A ${r.area![n].toFixed(1)} at its mouth ${r.north[n].toFixed(0)},${r.east[n].toFixed(0)}) -> ... -> ${x}, which fills the pool; ${x}'s A ${a0.toFixed(1)} -> ${a1.toFixed(1)} about there, ${T.area![tm].toFixed(1)} at its end ${T.north[tm].toFixed(0)},${T.east[tm].toFixed(0)}`);
          break;
        }
        x = L[x].joins ?? -1;
      }
    });
    console.log(`seed ${seed}: outlets ${outlets}; loops ${loops.length}`);
    if (loops.length) console.log(loops.join('\n'));
  }
  setWorldSeed(0);
});
