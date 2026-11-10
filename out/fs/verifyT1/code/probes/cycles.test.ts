// Checker T1: water-flow cycles through lakes and ponds (outletLoops only follows joins chains).
// Graph: line -> joins; line whose last point lies in pool p -> p; pool p -> every stream whose first point lies in p
// and whose last point does not (an outlet). Any cycle is water going round.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../../../../src/world/terrain/heightfield';
import { DOMAIN_HALF, LAKE_RASTER } from '../../../../../src/world/terrain/drainage';
import { setWorldSeed } from '../../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('cycles', () => {
  for (const seed of (env.SEEDS ?? '1,42,777777,7').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = hydrology.rivers!;
    const mask = hydrology.lakeMask! as unknown as { at(n: number, e: number): number; poolAt(i: number, j: number): number };
    const poolOf = (n: number, e: number): number => {
      const i0 = Math.round((n + DOMAIN_HALF) / LAKE_RASTER), j0 = Math.round((e + DOMAIN_HALF) / LAKE_RASTER);
      const p = mask.poolAt(i0, j0);
      if (p >= 0) return p;
      if (!(mask.at(n, e) > -Infinity)) return -1;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const q = mask.poolAt(i0 + a, j0 + b); if (q >= 0) return q; }
      return -1;
    };
    const nL = L.length;
    const adj: number[][] = [];
    const node = (p: number) => nL + p;
    const addE = (a: number, b: number) => { (adj[a] ??= []).push(b); };
    let outlets = 0;
    L.forEach((r, li) => {
      const m = r.north.length - 1;
      const j = r.joins ?? -1;
      if (j >= 0) addE(li, j);
      const pe = poolOf(r.north[m], r.east[m]);
      const ph = (r.kind ?? 0) === 0 ? -1 : poolOf(r.north[0], r.east[0]);
      if (pe >= 0 && pe !== ph) addE(li, node(pe));
      if (ph >= 0 && pe !== ph) { addE(node(ph), li); outlets++; }
    });
    // Tarjan SCC (iterative).
    const N = adj.length;
    const idx = new Int32Array(N).fill(-1), low = new Int32Array(N), on = new Uint8Array(N);
    const stack: number[] = [];
    let counter = 0;
    const sccs: number[][] = [];
    for (let s0 = 0; s0 < N; s0++) {
      if (idx[s0] >= 0 || !adj[s0]) continue;
      const work: Array<[number, number]> = [[s0, 0]];
      idx[s0] = low[s0] = counter++; stack.push(s0); on[s0] = 1;
      while (work.length) {
        const top = work[work.length - 1];
        const [v, ei] = top;
        const es = adj[v] ?? [];
        if (ei < es.length) {
          top[1]++;
          const w = es[ei];
          if (idx[w] < 0) { idx[w] = low[w] = counter++; stack.push(w); on[w] = 1; work.push([w, 0]); }
          else if (on[w]) low[v] = Math.min(low[v], idx[w]);
        } else {
          work.pop();
          if (work.length) { const u = work[work.length - 1][0]; low[u] = Math.min(low[u], low[v]); }
          if (low[v] === idx[v]) {
            const comp: number[] = [];
            let w: number;
            do { w = stack.pop()!; on[w] = 0; comp.push(w); } while (w !== v);
            if (comp.length > 1 || (adj[v] ?? []).includes(v)) sccs.push(comp);
          }
        }
      }
    }
    const desc = (x: number) => {
      if (x >= nL) return `pool ${x - nL}`;
      const r = L[x]; const m = r.north.length - 1;
      return `line ${x} (${(r.kind ?? 0) === 0 ? 'river' : 'stream'} ${r.end ?? ''} joins ${r.joins} head ${r.north[0].toFixed(0)},${r.east[0].toFixed(0)} lv ${r.level[0].toFixed(1)} end ${r.north[m].toFixed(0)},${r.east[m].toFixed(0)} lv ${r.level[m].toFixed(1)} A ${(r.area?.[m] ?? 0).toFixed(1)} n ${m + 1})`;
    };
    console.log(`seed ${seed}: lines ${nL} outlets ${outlets} cycles ${sccs.length}`);
    for (const c of sccs) console.log('  CYCLE: ' + c.map(desc).join('\n         '));
  }
  setWorldSeed(0);
});
