// Probe: a seeded world's falls as the water renderer sees them (lip to foot run against drop), and sites for shots:
// the tallest falls, long step-pool cascades and placid lowland reaches, with a cockpit-like camera for each.
//   FALL_SEEDS=42 npx vitest run --config scripts/probes/vitest.config.ts fallSites --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

const q = (a: number[], f: number): number => (a.length ? a[Math.min(a.length - 1, Math.floor(f * a.length))] : NaN);
it('fall sites', () => {
  for (const seed of (process.env.FALL_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    const lines = hydrology.rivers!;
    const falls = hydrology.falls!;
    const runs: number[] = [];
    const ratio: number[] = [];
    let steep = 0;
    for (const f of falls) {
      const r = lines[f.line];
      const j = Math.min(r.s.length - 1, f.index + 1);
      const run = r.s[j] - r.s[f.index];
      runs.push(run);
      ratio.push(run / Math.max(0.1, f.top - f.bottom));
      if (run / Math.max(0.1, f.top - f.bottom) < 1.5) steep++;
    }
    runs.sort((a, b) => a - b);
    ratio.sort((a, b) => a - b);
    console.log(`seed ${seed}: ${falls.length} falls; run p10 ${q(runs, 0.1).toFixed(1)} p50 ${q(runs, 0.5).toFixed(1)} p90 ${q(runs, 0.9).toFixed(1)} max ${runs[runs.length - 1].toFixed(1)}; run/drop p50 ${q(ratio, 0.5).toFixed(2)} p90 ${q(ratio, 0.9).toFixed(2)}; sheet-steep (<1.5) ${steep}`);
    // Ground at the lip, the foot and in between, relative to the straight chord (how the sheet sits on the terrain).
    const over: number[] = [];
    for (const f of falls.slice(0, 400)) {
      const r = lines[f.line];
      const j = Math.min(r.s.length - 1, f.index + 1);
      for (const u of [0.25, 0.5, 0.75]) {
        const n = r.north[f.index] + (r.north[j] - r.north[f.index]) * u;
        const e = r.east[f.index] + (r.east[j] - r.east[f.index]) * u;
        const chord = r.level[f.index] + (r.level[j] - r.level[f.index]) * u;
        over.push(terrainHeight(n, e) - chord);
      }
    }
    over.sort((a, b) => a - b);
    console.log(`  ground minus chord between lip and foot: p50 ${q(over, 0.5).toFixed(2)} p90 ${q(over, 0.9).toFixed(2)} p99 ${q(over, 0.99).toFixed(2)} max ${over[over.length - 1].toFixed(2)}`);
    // Tallest flights: falls within 300 m of each other summed.
    const tall = falls.map((f, i) => ({ f, i, drop: f.top - f.bottom })).sort((a, b) => b.drop - a.drop || a.i - b.i).slice(0, 6);
    for (const t of tall) {
      const r = lines[t.f.line];
      console.log(`  fall ${t.i} line ${t.f.line} kind ${r.kind} hw ${(t.f.width / 2).toFixed(1)} drop ${t.drop.toFixed(1)} at (${(t.f.north / 1000).toFixed(3)}, ${(t.f.east / 1000).toFixed(3)}) top ${t.f.top.toFixed(0)} dir (${t.f.dirN.toFixed(2)}, ${t.f.dirE.toFixed(2)})`);
    }
    // Rivers (kind 0, wide) with falls: the most visible ones.
    const big = falls.map((f, i) => ({ f, i })).filter((x) => x.f.width > 12).sort((a, b) => b.f.width - a.f.width).slice(0, 6);
    for (const t of big) console.log(`  wide fall ${t.i} line ${t.f.line} width ${t.f.width.toFixed(1)} drop ${(t.f.top - t.f.bottom).toFixed(1)} at (${(t.f.north / 1000).toFixed(3)}, ${(t.f.east / 1000).toFixed(3)}) dir (${t.f.dirN.toFixed(2)}, ${t.f.dirE.toFixed(2)})`);
    // Longest step-pool/rapids reach (regime 2-3) on a river.
    let best = { len: 0, li: -1, a: 0, b: 0 };
    for (let li = 0; li < lines.length; li++) {
      const r = lines[li];
      if (!r.regime) continue;
      let a = -1;
      for (let i = 0; i <= r.s.length; i++) {
        const on = i < r.s.length && r.regime[i] >= 2 && r.halfWidth[i] > 6;
        if (on && a < 0) a = i;
        if (!on && a >= 0) {
          const len = r.s[i - 1] - r.s[a];
          if (len > best.len) best = { len, li, a, b: i - 1 };
          a = -1;
        }
      }
    }
    {
      const r = lines[best.li];
      const m = (best.a + best.b) >> 1;
      console.log(`  longest rapids/step-pool river reach: line ${best.li} ${best.len.toFixed(0)} m, hw ${r.halfWidth[m].toFixed(1)}, from (${(r.north[best.a] / 1000).toFixed(3)}, ${(r.east[best.a] / 1000).toFixed(3)}) ${r.level[best.a].toFixed(0)} m to (${(r.north[best.b] / 1000).toFixed(3)}, ${(r.east[best.b] / 1000).toFixed(3)}) ${r.level[best.b].toFixed(0)} m`);
      let nf = 0;
      for (const f of falls) if (f.line === best.li && f.index >= best.a && f.index <= best.b) nf++;
      console.log(`    falls on it: ${nf}`);
    }
    // A placid lowland reach on a big river: regime 0, hw > 20, level 20-200 m.
    for (let li = 0; li < lines.length; li++) {
      const r = lines[li];
      if (!r.regime) continue;
      const m = r.s.length >> 1;
      if (r.regime[m] === 0 && r.halfWidth[m] > 25 && r.level[m] > 20 && r.level[m] < 150) {
        const k = Math.min(r.s.length - 1, m + 20);
        console.log(`  placid: line ${li} hw ${r.halfWidth[m].toFixed(1)} at (${(r.north[m] / 1000).toFixed(3)}, ${(r.east[m] / 1000).toFixed(3)}) level ${r.level[m].toFixed(0)} -> (${(r.north[k] / 1000).toFixed(3)}, ${(r.east[k] / 1000).toFixed(3)})`);
        break;
      }
    }
  }
});
