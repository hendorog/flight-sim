// outletLoops (round T, from inv-vends' invVendsJoins): no pond's or lake's outlet may join the stream that fills it, or
// any line upstream of that stream (its water would go round in a circle and the loop doubles the catchment drawn).
// An outlet: a stream whose head lies in a lake's water (it leaves that pool). The lines filling the pool: every line
// whose last point lies in that pool's water. A loop: the outlet's way down (joins, then its receiver's joins, ...)
// reaches one of them. For each loop, the filling line's area just above and below where the outlet's water comes back
// in (the jump the loop adds), and the outlet's own area at its mouth.
// Then any loop through lakes and ponds too (a pond's outlet into a lake whose outlet fills the pond): water-flow cycles in
// the graph line -> the line it joins, line -> the pool its last point lies in, pool -> each line leaving it (first point
// in it, last point not); every strongly connected part with more than one node is water going round.
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
    // Cycles through lakes and ponds (Tarjan's strongly connected parts, iterative).
    const nL = L.length;
    const adj: number[][] = [];
    const addE = (a: number, b: number): void => {
      (adj[a] ??= []).push(b);
    };
    L.forEach((r, li) => {
      const m = r.north.length - 1;
      const j = r.joins ?? -1;
      if (j >= 0) addE(li, j);
      const pe = poolOf(r.north[m], r.east[m]);
      const ph = (r.kind ?? 0) === 0 ? -1 : poolOf(r.north[0], r.east[0]);
      if (pe >= 0 && pe !== ph) addE(li, nL + pe);
      if (ph >= 0 && pe !== ph) addE(nL + ph, li);
    });
    const N = adj.length;
    const idx = new Int32Array(N).fill(-1);
    const low = new Int32Array(N);
    const on = new Uint8Array(N);
    const stack: number[] = [];
    let counter = 0;
    const cycles: number[][] = [];
    for (let s0 = 0; s0 < N; s0++) {
      if (idx[s0] >= 0 || !adj[s0]) continue;
      const work: Array<[number, number]> = [[s0, 0]];
      idx[s0] = low[s0] = counter++;
      stack.push(s0);
      on[s0] = 1;
      while (work.length) {
        const top = work[work.length - 1];
        const v = top[0];
        const es = adj[v] ?? [];
        if (top[1] < es.length) {
          const w = es[top[1]++];
          if (idx[w] < 0) {
            idx[w] = low[w] = counter++;
            stack.push(w);
            on[w] = 1;
            work.push([w, 0]);
          } else if (on[w]) low[v] = Math.min(low[v], idx[w]);
        } else {
          work.pop();
          if (work.length) {
            const u = work[work.length - 1][0];
            low[u] = Math.min(low[u], low[v]);
          }
          if (low[v] === idx[v]) {
            const comp: number[] = [];
            let w: number;
            do {
              w = stack.pop()!;
              on[w] = 0;
              comp.push(w);
            } while (w !== v);
            if (comp.length > 1 || (adj[v] ?? []).includes(v)) cycles.push(comp);
          }
        }
      }
    }
    const desc = (x: number): string => {
      if (x >= nL) return `pool ${x - nL}`;
      const r = L[x];
      const m = r.north.length - 1;
      return `line ${x} (${r.end ?? ''}, joins ${r.joins}, ${r.north[0].toFixed(0)},${r.east[0].toFixed(0)} lv ${r.level[0].toFixed(1)} to ${r.north[m].toFixed(0)},${r.east[m].toFixed(0)} lv ${r.level[m].toFixed(1)}, A ${(r.area?.[m] ?? 0).toFixed(1)})`;
    };
    console.log(`seed ${seed}: outlets ${outlets}; loops ${loops.length}; cycles through lakes and ponds ${cycles.length}`);
    if (loops.length) console.log(loops.join('\n'));
    for (const c of cycles) console.log(`  cycle: ${c.map(desc).join(' <- ')}`);
  }
  setWorldSeed(0);
});
