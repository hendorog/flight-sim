// Probe: a seeded world's streams and flow (streams.ts): how they were traced, how much of each kind of flow, the
// falls, widths along the lines and at confluences, and the build time.
//   STREAM_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts streamNet --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, siteMs } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('stream network', () => {
  setWorldSeed(3);
  for (const seed of (process.env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(0);
    const t0 = performance.now();
    setWorldSeed(seed);
    const ms = performance.now() - t0;
    const lines = hydrology.rivers!;
    const rep = hydrology.streamReport!;
    const kindKm = [0, 0];
    const regKm = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
    let jumps = 0, jumpMax = 0, startHw: number[][] = [[], []];
    const jumpAt: string[] = [];
    // The samples of each line where another joins it (and the two either side).
    const joinNear = lines.map(() => new Set<number>());
    for (const r of lines) {
      if (r.joins === undefined || r.joins < 0) continue;
      const p = lines[r.joins];
      const en = r.north[r.north.length - 1], ee = r.east[r.east.length - 1];
      let j = 0, bd = Infinity;
      for (let i = 0; i < p.north.length; i++) { const dd = (p.north[i] - en) ** 2 + (p.east[i] - ee) ** 2; if (dd < bd) { bd = dd; j = i; } }
      for (let d = -2; d <= 2; d++) joinNear[r.joins].add(j + d);
    }
    for (let li = 0; li < lines.length; li++) {
      const r = lines[li];
      const k = r.kind ?? 0;
      const n = r.s.length;
      kindKm[k] += r.s[n - 1] / 1000;
      startHw[k].push(r.halfWidth[0]);
      for (let i = 0; i < n - 1; i++) regKm[k][r.regime![i] === 4 ? 4 : r.regime![i]] += (r.s[i + 1] - r.s[i]) / 1000;
      // Width steps along a line away from its confluences (those are counted below).
      for (let i = 0; i < n - 1; i++) {
        const dw = Math.abs(r.halfWidth[i + 1] - r.halfWidth[i]);
        if (dw > 0.5 && !joinNear[li].has(i) && !joinNear[li].has(i + 1)) { jumps++; jumpMax = Math.max(jumpMax, dw); if (jumpAt.length < 5) jumpAt.push(`${k ? 's' : 'r'}${li}@${i}/${n} ${r.halfWidth[i].toFixed(1)}->${r.halfWidth[i + 1].toFixed(1)}`); }
      }
    }
    // Confluence steps: the joined line's width just above and below the join.
    const steps: number[] = [];
    let below = 0;
    const belowAt: string[] = [];
    for (const r of lines) {
      if (r.joins === undefined || r.joins < 0) continue;
      const p = lines[r.joins];
      const en = r.north[r.north.length - 1], ee = r.east[r.east.length - 1];
      let j = 0, bd = Infinity;
      for (let i = 0; i < p.north.length; i++) { const dd = (p.north[i] - en) ** 2 + (p.east[i] - ee) ** 2; if (dd < bd) { bd = dd; j = i; } }
      if (j > 2 && j < p.north.length - 3) steps.push(p.halfWidth[j + 2] - p.halfWidth[j - 2]);
      const under = p.level[j] - r.level[r.level.length - 1];
      if (under > 2) { below++; if (belowAt.length < 6) belowAt.push(`${(r.kind ?? 0) ? 's' : 'r'}${lines.indexOf(r)}:${under.toFixed(0)}m@${(en / 1000).toFixed(1)},${(ee / 1000).toFixed(1)}`); }
    }
    const falls = hydrology.falls!;
    const hist = [0, 0, 0, 0, 0];
    for (const f of falls) { const dr = f.top - f.bottom; hist[dr < 5 ? 0 : dr < 8 ? 1 : dr < 11 ? 2 : dr < 13 ? 3 : 4]++; }
    const fk = [0, 0];
    for (const f of falls) fk[lines[f.line].kind ?? 0]++;
    const med = (a: number[]) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
    const q = (a: number[], f: number) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) * f)] : NaN; };
    console.log(`SEED ${seed}: phases (river falls, trace + stream falls, flow, index) ${(rep.phases ?? []).map((x) => x.toFixed(0)).join(' / ')} ms; airfield siting ${siteMs.toFixed(0)} ms; trace phases (mark, outlets, heads, total) ${rep.tracePhases.map((x) => x.toFixed(0)).join(' / ')} / ${rep.ms.toFixed(0)}`);
    console.log(`SEED ${seed}: build ${ms.toFixed(0)} ms; streams traced in ${rep.ms.toFixed(0)} ms (${rep.samples} ground samples, ${rep.outletSamples} of them by outlets, ${rep.levelSamples} level checks, ${rep.steps} steps (outlets ${rep.outletSteps}), ${rep.pits} pits, ${rep.floods} flood escapes, ${rep.forced} forced steps)`);
    console.log(`  pools ${rep.pools} (${rep.riverPools} with a river), outlet streams ${rep.outlets}, straight into a lake ${rep.outletToLake}, onto the sea ${rep.outletToSea}, no spill ${rep.outletNone}; heads ${rep.heads}; ends ${JSON.stringify(rep.ends)} (${rep.hollows} of the sinks in a hollow, the rest short of higher water); outlets end ${JSON.stringify(rep.outletEnds)}`);
    console.log(`  rivers ${lines.filter((l) => !l.kind).length} lines ${kindKm[0].toFixed(0)} km; streams ${lines.filter((l) => l.kind === 1).length} lines ${kindKm[1].toFixed(0)} km`);
    console.log(`  start half-width rivers median ${med(startHw[0]).toFixed(1)} min ${q(startHw[0], 0).toFixed(1)}; streams median ${med(startHw[1]).toFixed(1)} min ${q(startHw[1], 0).toFixed(1)} max ${q(startHw[1], 1).toFixed(1)}`);
    const names = ['placid', 'riffle', 'rapids', 'step-pool', 'fall'];
    for (const k of [0, 1]) console.log(`  ${k ? 'streams' : 'rivers '} km by regime: ${names.map((nm, i) => `${nm} ${regKm[k][i].toFixed(0)}`).join(', ')}`);
    console.log(`  width steps > 0.5 m between samples along a line away from confluences: ${jumps} (max ${jumpMax.toFixed(1)} m: ${jumpAt.join(', ')}); at confluences (2 samples either side) median ${med(steps).toFixed(2)} p10 ${q(steps, 0.1).toFixed(2)} p90 ${q(steps, 0.9).toFixed(2)} m over ${steps.length}`);
    for (const [nm, g] of [['line', rep.sinkGap], ['line (at its last point)', rep.sinkGapLast], ['lake', rep.sinkGapLake]] as const) console.log(`  sinks short of a ${nm}: ${g.length}; its water over the stream's p25 ${q(g, 0.25).toFixed(1)} p50 ${q(g, 0.5).toFixed(1)} p75 ${q(g, 0.75).toFixed(1)} p90 ${q(g, 0.9).toFixed(1)} m`);
    console.log(`  lines ending more than 2 m under the water they join: ${below} (${belowAt.join(' ')})`);
    console.log(`  falls ${falls.length} (rivers ${fk[0]}, streams ${fk[1]}); drop <5/5-8/8-11/11-13/>=13 m: ${hist.join('/')}`);
  }
  setWorldSeed(0);
});
it('notch', () => {
  for (const seed of (process.env.STREAM_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    for (const [name, arr] of [['headwaters', hydrology.streamReport!.notch], ['outlets', hydrology.streamReport!.notchOutlet]] as const) {
      const a = arr.slice().sort((x, y) => x - y);
      const q = (f: number) => a[Math.floor((a.length - 1) * f)].toFixed(1);
      console.log(`NOTCH seed ${seed} ${name}: ${a.length} raster pts; ground over water p50 ${q(0.5)} p75 ${q(0.75)} p90 ${q(0.9)} p99 ${q(0.99)} max ${q(1)}; >10 m ${(100 * a.filter((x) => x > 10).length / a.length).toFixed(1)} %, >30 m ${(100 * a.filter((x) => x > 30).length / a.length).toFixed(1)} %`);
    }
  }
  setWorldSeed(0);
});
