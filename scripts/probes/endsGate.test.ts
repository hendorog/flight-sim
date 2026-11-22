// endsGate (round T, from inv-ends' invEndsGate): the honest gate for "the bigger streams stop short". Every line (river or stream) carrying IG_MIN km² or
// more at its last point must end in water a pilot sees: another line's channel (its end within the receiver's
// half-width + 60 m of the receiver's course), a lake or pond (lake water within 60 m of its end), the sea, or the
// world's edge. Anything else is a dead end; each is listed with its relief class (sinkCases' rule).
// Also: the streams' trace-time sink ends (StreamReport.ends.sink) against the lines that still end 'sink' now, by
// catchment; and the "climbed" reaches: a line's water more than 10 m under the routing ground (streams.ts route)
// along 500 m or more in a row (a notch cut uphill: the trace's pit climb), A >= IG_MIN.
// Also every pond the stream pass made (LakeMask pools past the drainage's): its area, centre and level (owner decision 3).
//   IG_SEEDS=1,42,777777,7 IG_MIN=10 npx vitest run --config scripts/probes/vitest.config.ts endsGate --silent=false
import { it } from 'vitest';
import { hydrology, terrainHeight, naturalHeight } from '../../src/world/terrain/heightfield';
import { DOMAIN_HALF } from '../../src/world/terrain/drainage';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
let routeOf: ((n: number, e: number) => number) | null = null;
it('ends gate', async () => {
  const MIN = Number(env.IG_MIN ?? 10);
  const sd = ((await import('../../src/world/terrain/streams')) as unknown as { streamDebug?: { route?: (n: number, e: number) => number } }).streamDebug;
  for (const seed of (env.IG_SEEDS ?? '1,42,777777,7').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    routeOf = sd?.route ?? null;
    const L = hydrology.rivers!;
    const mask = hydrology.lakeMask!;
    const rep = hydrology.streamReport!;
    const counts: Record<string, number> = {};
    const fails: string[] = [];
    const sinkNow: string[] = [];
    let n = 0;
    const relief = (N: number, E: number): string => {
      const n0 = Math.round(N / 1000) * 1000, e0 = Math.round(E / 1000) * 1000;
      let lo = Infinity, hi = -Infinity;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const h = Math.max(0, terrainHeight(n0 + a * 1000, e0 + b * 1000)); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      return hi - lo >= 500 ? 'mountain' : hi - lo >= 150 ? 'hill' : 'plain';
    };
    const waterNear = (N: number, E: number, r: number): boolean => {
      for (let a = -r; a <= r; a += 20) for (let b = -r; b <= r; b += 20) if (a * a + b * b <= r * r && mask.at(N + a, E + b) > -Infinity) return true;
      return false;
    };
    let climbLines = 0, climbKm = 0;
    const climbRows: string[] = [];
    L.forEach((r, li) => {
      const m = r.north.length - 1;
      const A = r.area ? r.area[m] : Infinity;
      const N = r.north[m], E = r.east[m];
      if (r.kind === 1 && (r.end === 'sink' || r.end === 'stuck')) sinkNow.push(`line ${li} A ${A.toFixed(1)} at ${N.toFixed(0)},${E.toFixed(0)} (${relief(N, E)})`);
      // Climbed reaches.
      if (routeOf && A >= MIN) {
        let run = 0, best = 0, bestAt = -1, deep = 0;
        for (let i = 1; i <= m; i++) {
          const c = routeOf(r.north[i], r.east[i]) - r.level[i];
          if (c > 10 && mask.at(r.north[i], r.east[i]) === -Infinity) { run += r.s[i] - r.s[i - 1]; deep = Math.max(deep, c); if (run > best) { best = run; bestAt = i; } } else run = 0;
        }
        if (best >= 500) { climbLines++; climbKm += best / 1000; if (climbRows.length < 40) climbRows.push(`line ${li} kind ${r.kind} A ${A.toFixed(1)} ${(best / 1000).toFixed(2)} km under the ground by > 10 m (max ${deep.toFixed(0)} m) ending at ${r.north[bestAt].toFixed(0)},${r.east[bestAt].toFixed(0)}, end ${r.end ?? '-'}`); }
      }
      if (!(A >= MIN)) return;
      n++;
      let k = '';
      const j = r.joins ?? -1;
      if (j >= 0) {
        const T = L[j];
        let bd = Infinity, bi = 0;
        for (let i = 0; i < T.north.length; i++) { const d = Math.hypot(T.north[i] - N, T.east[i] - E); if (d < bd) { bd = d; bi = i; } }
        k = bd <= T.halfWidth[bi] + r.halfWidth[m] + 60 ? 'join' : waterNear(N, E, 60) ? 'lake' : `join-gap ${bd.toFixed(0)} m`;
      }
      if (!k && (mask.at(N, E) > -Infinity || waterNear(N, E, 60))) k = 'lake';
      if (!k && (naturalHeight(N, E) <= 0.5 || r.end === 'sea' || (terrainHeight(N, E) <= 0.5 && r.level[m] <= 0.5))) k = 'sea';
      if (!k && (Math.abs(N) >= DOMAIN_HALF - 1500 || Math.abs(E) >= DOMAIN_HALF - 1500)) k = 'edge';
      if (!k) {
        // Another line's water within 60 m of the end (a stream ending on a river's bank without `joins`).
        for (let lj = 0; lj < L.length && !k; lj++) { if (lj === li) continue; const T = L[lj]; for (let i = 0; i < T.north.length; i += 1) if (Math.hypot(T.north[i] - N, T.east[i] - E) <= T.halfWidth[i] + 60) { k = 'touches'; break; } }
      }
      if (!k) k = 'DRY';
      const key = k.startsWith('join-gap') ? 'join-gap' : k;
      counts[key] = (counts[key] ?? 0) + 1;
      if (key === 'DRY' || key === 'join-gap' || key === 'touches') fails.push(`  ${key}: line ${li} kind ${r.kind} end ${r.end ?? '-'} A ${A.toFixed(1)} at ${N.toFixed(0)},${E.toFixed(0)} (${relief(N, E)}) ${k}; why: ${rep.endWhy?.[li] ?? '-'}`);
    });
    console.log(`seed ${seed}: lines with A >= ${MIN} km2 at their end: ${n}; ends ${JSON.stringify(counts)}; trace-time ends ${JSON.stringify(rep.ends)}`);
    console.log(fails.join('\n'));
    console.log(`  streams ending 'sink'/'stuck' now (any A): ${sinkNow.length}\n    ${sinkNow.join('\n    ')}`);
    { const ps = (await import('../../src/world/terrain/streams') as unknown as { pitStats?: { escapes: number; backs: number; ponds: number; fails: number; backCells: number; depths: number[] } }).pitStats; if (ps) { const d = ps.depths.slice().sort((x, y) => x - y); console.log(`  pitStats escapes ${ps.escapes} backs ${ps.backs} (cells ${ps.backCells}) ponds ${ps.ponds} fails ${ps.fails}; notch depth p50/p90/p99/max ${d[d.length >> 1]?.toFixed(1)}/${d[Math.floor(d.length * 0.9)]?.toFixed(1)}/${d[Math.floor(d.length * 0.99)]?.toFixed(1)}/${d[d.length - 1]?.toFixed(1)} of ${d.length}`); ps.escapes = ps.backs = ps.ponds = ps.fails = ps.backCells = 0; ps.depths.length = 0; } }
    { const fsx = (await import('../../src/world/terrain/streams') as unknown as { fillStats?: Record<string, number> }).fillStats; if (fsx) { console.log(`  fillStats ${JSON.stringify(fsx)}`); for (const k of Object.keys(fsx)) delete fsx[k]; } }
    { const pd = (rep as unknown as { ponds?: number[] }).ponds ?? []; const sz: number[] = []; for (let i = 1; i < pd.length; i += 2) sz.push(pd[i]); sz.sort((x, y) => y - x); console.log(`  pond sizes (raster points of 6.25 ha), largest: ${sz.slice(0, 8).join(' ')}; total ${(sz.reduce((x, y) => x + y, 0) * 0.0625).toFixed(1)} km2`); }
    { const pd = (rep as unknown as { ponds?: number[] }).ponds ?? []; const pools = (mask as unknown as { pools: { level: number; wet: number; north: number; east: number }[] }).pools; const rows: string[] = []; for (let i = 0; i < pd.length; i += 2) { const P = pools[pd[i]]; if (P) rows.push(`pond ${pd[i]} ${(pd[i + 1] * 0.0625).toFixed(2)} km2 at ${P.north.toFixed(0)},${P.east.toFixed(0)} level ${P.level.toFixed(1)}`); } rows.sort((a, b) => Number(b.split(' ')[2]) - Number(a.split(' ')[2])); console.log(`  ponds (largest first): ${rows.slice(0, 12).join('; ')}`); }
    { const fl = (rep as unknown as { filled?: number[]; pondInflow?: number }); console.log(`  filled by the dead-end rule (FILL_DEAD_ENDS): ${(fl.filled ?? []).map((li) => `${li} (${rep.endWhy?.[li]?.split('; ').pop() ?? ''})`).join(', ') || 'none'}; pond outlets given their inflow ${fl.pondInflow ?? 0}`); }
    console.log(`  ponds closed (no outlet): ${((rep as unknown as { pondClosed?: string[] }).pondClosed ?? []).join(' | ') || 'none'}`);
    console.log(`  ponds made ${((rep as unknown as { ponds?: number[] }).ponds?.length ?? 0) / 2}; pondWhy ${JSON.stringify((rep as unknown as { pondWhy?: unknown }).pondWhy)}`);
    if (routeOf) console.log(`  climbed reaches (A >= ${MIN}, water > 10 m under the routing ground for >= 500 m): ${climbLines} lines, ${climbKm.toFixed(1)} km\n    ${climbRows.join('\n    ')}`);
  }
  setWorldSeed(0);
});
