// Probe: what feeds each river's head. For every river (kind 0) whose head is not in a lake: whether any line joins it,
// how far down it the first one joins (the stub above it), the width step there; the streams' count, length and ends,
// stream water over the natural ground, the trace time and the head feeders' report (streams.ts StreamReport.feed).
//   HF_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts headFeed --silent=false
import { it } from 'vitest';
import { hydrology, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { streamHeads } from '../../src/world/terrain/streams';
it('head feed', () => {
  // (HF_LOWLAND, HF_STEM: streams.ts streamHeads, for a head rule's trade.)
  if (process.env.HF_LOWLAND) streamHeads.lowland = Number(process.env.HF_LOWLAND);
  if (process.env.HF_STEM) streamHeads.stem = process.env.HF_STEM === '1';
  for (const seed of (process.env.HF_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const L = hydrology.rivers!;
    const mask = hydrology.lakeMask!;
    const rep = hydrology.streamReport!;
    let rivers = 0, lakeHead = 0, none = 0, trickle = 0, streams = 0, km = 0, sinks = 0, stuck = 0, outletSinks = 0;
    const first: number[] = [];
    const stepRatio: number[] = [];
    const tribs: number[][] = L.map(() => []);
    L.forEach((q, lj) => { if ((q.joins ?? -1) >= 0) tribs[q.joins!].push(lj); });
    const unfedRows: string[] = [];
    L.forEach((r, li) => {
      if (r.kind !== 0) {
        streams++;
        km += r.s[r.s.length - 1] / 1000;
        if (r.end === 'sink') sinks++;
        if (r.end === 'stuck') stuck++;
        return;
      }
      rivers++;
      if (mask.at(r.north[0], r.east[0]) > -Infinity) { lakeHead++; return; }
      let m = Infinity, mw = 0;
      for (const lj of tribs[li]) {
        const q = L[lj];
        const en = q.north[q.north.length - 1], ee = q.east[q.east.length - 1];
        let bd = Infinity, bs = 0;
        for (let i = 0; i < r.north.length; i++) { const d = Math.hypot(r.north[i] - en, r.east[i] - ee); if (d < bd) { bd = d; bs = r.s[i]; } }
        if (bs < m) { m = bs; mw = q.halfWidth[q.halfWidth.length - 1]; }
      }
      if (r.halfWidth[0] < 2) trickle++;
      if (m === Infinity) { none++; if (unfedRows.length < 8) unfedRows.push(`    line ${li} head ${r.north[0].toFixed(0)},${r.east[0].toFixed(0)} hw0 ${r.halfWidth[0].toFixed(1)} area0 ${(r as { area?: Float64Array }).area?.[0]?.toFixed(1)}`); return; }
      first.push(m);
      // The river's width just below the first junction against the feeder's at its end.
      const j = r.s.findIndex((s) => s >= m);
      if (j >= 0 && mw > 0) stepRatio.push(r.halfWidth[j] / mw);
    });
    first.sort((a, b) => a - b);
    stepRatio.sort((a, b) => a - b);
    const q = (a: number[], f: number, d = 0) => (a.length ? a[Math.min(a.length - 1, Math.floor(f * a.length))].toFixed(d) : '-');
    // Stream water over the natural ground (outside lakes, every third sample), m.
    let n = 0, o2 = 0, o5 = 0, o10 = 0, fn = 0, f2 = 0, f5 = 0, f10 = 0;
    const ff = ((rep as unknown as { feed?: { firstFeeder?: number } }).feed?.firstFeeder) ?? Infinity;
    const worst: string[] = [];
    const worstLines = new Set<number>();
    L.forEach((r, li) => {
      if (r.kind === 0) return;
      for (let k = 0; k < r.north.length; k += 3) {
        const pn = r.north[k], pe = r.east[k];
        if (mask.at(pn, pe) > -Infinity) continue;
        const g = naturalHeight(pn, pe);
        if (g < 0.5) continue;
        n++;
        const over = r.level[k] - g;
        if (over > 2) o2++;
        if (over > 5) o5++;
        if (over > 10) o10++;
        if (li >= ff) {
          fn++;
          if (over > 2) f2++;
          if (over > 5) f5++;
          if (over > 10) f10++;
          if (over > 5) worstLines.add(li);
          if (over > 5 && worst.length < 6) worst.push(`${over.toFixed(1)} m at ${pn.toFixed(0)},${pe.toFixed(0)} line ${li} s ${r.s[k].toFixed(0)}/${r.s[r.s.length - 1].toFixed(0)}`);
        }
      }
    });
    console.log(`seed ${seed}: trace ${rep.ms.toFixed(0)} ms; rivers ${rivers} (head in a lake ${lakeHead}); dry heads with no feeder at all ${none}, head hw < 2 m ${trickle}; first junction from the head (stub) p50/p75/p90/p95 ${q(first, 0.5)}/${q(first, 0.75)}/${q(first, 0.9)}/${q(first, 0.95)} m, at 0-50 m ${first.filter((x) => x <= 50).length}/${first.length}; river hw below / feeder hw at the first junction p5/p50/p95 ${q(stepRatio, 0.05, 2)}/${q(stepRatio, 0.5, 2)}/${q(stepRatio, 0.95, 2)}`);
    console.log(`  samples ${rep.samples} levelSamples ${rep.levelSamples} phases ${rep.tracePhases.map((x) => x.toFixed(0))} net ${rep.phases?.map((x) => x.toFixed(0))}`);
    console.log(`  streams ${streams} ${km.toFixed(0)} km; sinks ${sinks} stuck ${stuck} (report sinks ${rep.sinks} hollows ${rep.hollows}); ends ${JSON.stringify(rep.ends)}; stream samples over ground >2 m ${o2} >5 m ${o5} >10 m ${o10} of ${n}; feeders' >2 m ${f2} >5 m ${f5} (on ${worstLines.size} feeders) >10 m ${f10} of ${fn}`);
    if (process.env.HF_SHOW) console.log('  feeders over ground: ' + worst.join('; '));
    const feed = (rep as unknown as { feed?: unknown }).feed;
    if (feed) console.log(`  feed ${JSON.stringify(feed)}`);
    if (process.env.HF_SHOW) console.log(unfedRows.join('\n'));
    void outletSinks;
  }
  setWorldSeed(0);
});
