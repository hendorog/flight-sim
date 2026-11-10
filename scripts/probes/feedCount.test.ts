// Probe (Round V step 0, PLAN-V section 2 item 3): feedCount - "one stream for each gully", per river.
//   FC_SEEDS=1,42,777777 FC_OUT=dir npx vitest run --config scripts/probes/vitest.config.ts feedCount --silent=false --disable-console-intercept
//
// For every river (hydrology.rivers, kind 0):
//   - km of channel;
//   - the stream and chain lines (kind 1) ending on it: `joins` is the river (exact), and, as a cross-check, a kind-1
//     line whose last point lies within FC_END (300) m of the river's channel (feeds.py's rule); per 10 river km;
//     stream and chain told apart as onStreams / cornerGate do (the chain block follows the outlets, heads and feeders);
//   - its gullies: pass channels (gullies.ts gullyNet: the slopes' own 250 m D8 routing and catchment) of FC_GULLY
//     (1.5) km² or more meeting it. A gully meets a river at a node q of the net with that catchment that lies more
//     than FC_REACH (300) m from every river's channel while its receiver lies within FC_REACH m of this river's (the
//     nearest) - or (Round V A3 fix) while its receiver is a node the pass holds fixed (no routing of its own: a model's
//     floor, which the river's floor is since A3, 450 m and more either side) within FC_FLOOR (1000) m of this river's
//     channel (the nearest): the gully's last node before the river's floor. One such node is one gully.
//     It has a drawn stream when a kind-1 line passes within FC_DRAWN (200) m of q.
//   Caveats: the net exists only inside the slopes' mask (the mountains), so the gully half covers the mountain rivers
//   only; the lines-per-10-km half is domain-wide. The net's catchment counts only nodes inside the pass, so a gully
//   by the mask's edge reads small.
// Printed per seed: totals, by gully band (1.5-10 km², >= 10 km²: the old CHAIN_AREA), by river
// catchment band, and the rivers with the most gullies that have no drawn stream. FC_OUT gets the per-river table.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { gullyNet, receiverOf } from '../../src/world/terrain/gullies';
import { streamDebug } from '../../src/world/terrain/streams';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: string): void; mkdirSync(p: string, o: unknown): void };
type Line = { north: Float64Array; east: Float64Array; s: Float64Array; area?: Float64Array; kind?: number; joins?: number; end?: string };
const END = Number(env.FC_END ?? 300);
const GULLY = Number(env.FC_GULLY ?? 1.5);
const REACH = Number(env.FC_REACH ?? 300);
const DRAWN = Number(env.FC_DRAWN ?? 200);
const FLOOR = Number(env.FC_FLOOR ?? 1000);

/** Points of lines in square buckets; nearest point (and its line) within a reach. */
class Pts {
  b = new Map<number, number[]>();
  constructor(readonly cell: number) {}
  key(n: number, e: number): number {
    return Math.floor(n / this.cell) * 65536 + Math.floor(e / this.cell);
  }
  add(n: number, e: number, tag: number): void {
    const k = this.key(n, e);
    let a = this.b.get(k);
    if (!a) this.b.set(k, (a = []));
    a.push(n, e, tag);
  }
  near(n: number, e: number, reach: number, out: { d: number; tag: number }): { d: number; tag: number } {
    out.d = Infinity;
    out.tag = -1;
    const r = Math.ceil(reach / this.cell);
    const y0 = Math.floor(n / this.cell), x0 = Math.floor(e / this.cell);
    for (let y = y0 - r; y <= y0 + r; y++)
      for (let x = x0 - r; x <= x0 + r; x++) {
        const a = this.b.get(y * 65536 + x);
        if (!a) continue;
        for (let i = 0; i < a.length; i += 3) {
          const d = Math.hypot(a[i] - n, a[i + 1] - e);
          if (d < out.d) (out.d = d), (out.tag = a[i + 2]);
        }
      }
    return out;
  }
}
/** Every point of a line, and points between them no more than `step` m apart. */
function along(L: Line, step: number, f: (n: number, e: number) => void): void {
  for (let i = 0; i < L.north.length; i++) {
    f(L.north[i], L.east[i]);
    if (i + 1 < L.north.length) {
      const d = Math.hypot(L.north[i + 1] - L.north[i], L.east[i + 1] - L.east[i]);
      const k = Math.floor(d / step);
      for (let j = 1; j <= k; j++) f(L.north[i] + ((L.north[i + 1] - L.north[i]) * j) / (k + 1), L.east[i] + ((L.east[i + 1] - L.east[i]) * j) / (k + 1));
    }
  }
}

it('feed count', () => {
  const OUT = env.FC_OUT;
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  for (const seed of (env.FC_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = (hydrology.rivers ?? []) as unknown as Line[];
    const rep = hydrology.streamReport as unknown as { chains?: { traced: number } };
    const nR = L.filter((r) => (r.kind ?? 0) === 0).length;
    // The chain lines: by the pass that built each (streams.ts streamDebug.src, Round V B); else the chain block (as
    // onStreams / cornerGate): after the outlets, heads (6 km²) and feeders (5 km²).
    const src = streamDebug.src;
    let cs = nR;
    for (let i = nR; i < L.length; i++) {
      const a0 = L[i].area?.[0] ?? 0;
      if (Math.abs(a0 - 5) < 1e-6 || Math.abs(a0 - 6) < 1e-6) cs = i + 1;
      else if (a0 >= 9.95 && a0 < 10.05 && i > cs + 30) break;
    }
    const ce = cs + (rep.chains?.traced ?? 0);
    const isChain = (i: number): boolean => (src && src.length === L.length - nR ? src[i - nR] === 'chain' : i >= cs && i < ce);
    const riv = new Pts(250);
    for (let li = 0; li < nR; li++) along(L[li], 50, (n, e) => riv.add(n, e, li));
    const str = new Pts(200);
    for (let li = nR; li < L.length; li++) along(L[li], 50, (n, e) => str.add(n, e, li));
    type Row = { li: number; km: number; area: number; joins: number; streams: number; chains: number; near: number; gullies: number; gulliesBig: number; dry: number; dryBig: number };
    const rows: Row[] = [];
    for (let li = 0; li < nR; li++) {
      const r = L[li];
      rows.push({ li, km: r.s[r.s.length - 1] / 1000, area: r.area?.[r.area.length - 1] ?? 0, joins: r.joins ?? -1, streams: 0, chains: 0, near: 0, gullies: 0, gulliesBig: 0, dry: 0, dryBig: 0 });
    }
    const hit = { d: 0, tag: -1 };
    for (let i = nR; i < L.length; i++) {
      const s = L[i];
      const j = s.joins ?? -1;
      if (j >= 0 && j < nR) rows[j][isChain(i) ? 'chains' : 'streams']++;
      riv.near(s.north[s.north.length - 1], s.east[s.east.length - 1], END, hit);
      if (hit.d <= END) rows[hit.tag].near++;
    }
    // Gullies meeting a river.
    const g = gullyNet();
    let nodes = 0;
    if (g) {
      const at = (q: number): [number, number] => [g.origin + Math.floor(q / g.n) * g.cell, g.origin + (q % g.n) * g.cell];
      const h2 = { d: 0, tag: -1 };
      for (let q = 0; q < g.area.length; q++) {
        if (!g.dir[q] || g.area[q] < GULLY) continue;
        nodes++;
        const [qn, qe] = at(q);
        riv.near(qn, qe, REACH, hit);
        if (hit.d <= REACH) continue;
        const r = receiverOf(g, q);
        if (r < 0) continue;
        const [rn, re] = at(r);
        riv.near(rn, re, g.dir[r] ? REACH : FLOOR, h2);
        if (h2.d > (g.dir[r] ? REACH : FLOOR)) continue;
        const row = rows[h2.tag];
        const big = g.area[q] >= 10;
        row.gullies++;
        if (big) row.gulliesBig++;
        str.near(qn, qe, DRAWN, hit);
        if (hit.d > DRAWN) {
          row.dry++;
          if (big) row.dryBig++;
        }
      }
    }
    const sum = (f: (r: Row) => number, rs = rows): number => rs.reduce((a, r) => a + f(r), 0);
    const km = sum((r) => r.km);
    const ends = sum((r) => r.streams + r.chains);
    const gul = sum((r) => r.gullies), dry = sum((r) => r.dry), gulB = sum((r) => r.gulliesBig), dryB = sum((r) => r.dryBig);
    console.log(`seed ${seed}: rivers ${nR}, ${km.toFixed(0)} km; lines ending on a river (joins) ${ends} = streams ${sum((r) => r.streams)} + chains ${sum((r) => r.chains)}: ${((10 * ends) / km).toFixed(2)} per 10 river km; ending within ${END} m of a river ${sum((r) => r.near)} (${((10 * sum((r) => r.near)) / km).toFixed(2)} per 10 km)`);
    console.log(`  gullies (pass channels >= ${GULLY} km², ${nodes} nodes) meeting a river: ${gul}, with no drawn stream within ${DRAWN} m ${dry} (${((100 * dry) / Math.max(1, gul)).toFixed(1)} %); 1.5-10 km² ${gul - gulB} (no stream ${dry - dryB}); >= 10 km² ${gulB} (no stream ${dryB}); rivers with a gully ${rows.filter((r) => r.gullies > 0).length}`);
    for (const [lo, hi] of [[45, 150], [150, 500], [500, 1e9]]) {
      const rs = rows.filter((r) => r.area >= lo && r.area < hi);
      const k = sum((r) => r.km, rs);
      console.log(`  rivers ${lo}-${hi >= 1e9 ? '' : hi} km² at the mouth: ${rs.length}, ${k.toFixed(0)} km; lines ending ${((10 * sum((r) => r.streams + r.chains, rs)) / Math.max(1e-9, k)).toFixed(2)} per 10 km; gullies ${sum((r) => r.gullies, rs)}, no stream ${sum((r) => r.dry, rs)}`);
    }
    const worst = rows.filter((r) => r.dry > 0).sort((a, b) => b.dry - a.dry).slice(0, Number(env.FC_TOP ?? 10));
    console.log(`  most gullies with no drawn stream: ${worst.map((r) => `${r.li} (${r.km.toFixed(1)} km, A ${r.area.toFixed(0)}: ${r.dry}/${r.gullies}, ${r.dryBig} >= 10 km²)`).join('; ')}`);
    const bare = rows.filter((r) => r.km >= 5 && r.streams + r.chains === 0);
    console.log(`  rivers >= 5 km with no line ending on them: ${bare.length}${bare.length ? ` (${bare.slice(0, 12).map((r) => `${r.li}:${r.km.toFixed(0)} km`).join(' ')})` : ''}`);
    if (OUT) fs.writeFileSync(`${OUT}/feedCount-s${seed}.json`, JSON.stringify({ seed, nR, chains: [cs, ce], params: { END, GULLY, REACH, FLOOR, DRAWN }, rows }));
  }
  setWorldSeed(0);
});
