// Probe: the hydrology round 2 metrics in one world build per seed - water hanging over the drawn ground (riverBed's
// measure, split by kind), water over the natural ground (streamGround's), mountain lake outflow, falls by cause and
// height, filled hollows and tarns. Runs on older trees too (falls without a cause count as 'gradient').
//   H2_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts hydro2Metrics --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeight, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

const q = (a: number[], p: number): number => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

it('hydro2 metrics', () => {
  for (const seed of (process.env.H2_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    const t0 = performance.now();
    setWorldSeed(seed);
    const ms = performance.now() - t0;
    const h: any = hydrology;
    const rs: any[] = h.rivers;
    const falls: any[] = h.falls ?? [];
    const mask = h.lakeMask;
    const s = makeSample();
    // --- riverBed (every 3rd point outside lakes and the sea): water over the centreline ground and the lower bank.
    for (const kind of [0, 1, -1]) {
      let n = 0;
      const bed = [0, 0, 0];
      const bank = [0, 0, 0, 0];
      for (const r of rs) {
        if (kind >= 0 && (r.kind ?? 0) !== kind) continue;
        for (let k = 1; k < r.north.length - 1; k += 3) {
          const pn = r.north[k], pe = r.east[k];
          sampleTerrain(pn, pe, s);
          if (s.standing > s.ground + 0.05 && s.standing > 0.5) continue;
          if (s.ground < 0.5) continue;
          n++;
          const L = r.level[k];
          const d = L - s.ground;
          [5, 10, 30].forEach((t, i) => { if (d > t) bed[i]++; });
          const dn = r.north[k + 1] - r.north[k - 1], de = r.east[k + 1] - r.east[k - 1];
          const len = Math.hypot(dn, de) || 1;
          const off = 1.5 * r.halfWidth[k] + 30;
          let lo = Infinity;
          for (const sg of [-1, 1]) {
            sampleTerrain(pn - (de / len) * off * sg, pe + (dn / len) * off * sg, s);
            lo = Math.min(lo, s.standing > s.ground + 0.05 && s.standing > 0.5 ? s.standing : Math.max(s.ground, s.river));
          }
          const b = L - lo;
          [0.5, 2, 10, 30].forEach((t, i) => { if (b > t) bank[i]++; });
        }
      }
      const pc = (v: number) => ((100 * v) / Math.max(1, n)).toFixed(2);
      console.log(`H2 seed ${seed} RIVERBED kind ${kind < 0 ? 'all' : kind}: ${n} pts; over centreline ground >5/10/30 m ${bed.map(pc).join('/')} %; over lower bank >0.5/2/10/30 m ${bank.map(pc).join('/')} %`);
    }
    // --- streamGround: water over the natural ground (every 3rd point outside lakes).
    for (const kind of [0, 1, -1]) {
      let n = 0, o2 = 0, o10 = 0;
      for (const r of rs) {
        if (kind >= 0 && (r.kind ?? 0) !== kind) continue;
        for (let k = 0; k < r.north.length; k += 3) {
          const pn = r.north[k], pe = r.east[k];
          if (mask.at(pn, pe) > -Infinity) continue;
          const g = naturalHeight(pn, pe);
          if (g < 0.5) continue;
          n++;
          if (r.level[k] - g > 2) o2++;
          if (r.level[k] - g > 10) o10++;
        }
      }
      console.log(`H2 seed ${seed} STREAMGROUND kind ${kind < 0 ? 'all' : kind}: ${n} pts; water over natural ground >2 m ${((100 * o2) / Math.max(1, n)).toFixed(2)} %, >10 m ${((100 * o10) / Math.max(1, n)).toFixed(2)} %`);
    }
    // --- Mountain lakes: outlet streams from a lake over 700 m and where they end; and per lake (any line leaving it).
    const outs = rs.filter((r) => r.kind === 1 && mask.at(r.north[0], r.east[0]) > -Infinity);
    const mtn = outs.filter((r) => r.level[0] > 700);
    const ends: Record<string, number> = {};
    for (const r of mtn) ends[r.end ?? '?'] = (ends[r.end ?? '?'] ?? 0) + 1;
    const good = (ends.channel ?? 0) + (ends.lake ?? 0) + (ends.sea ?? 0);
    console.log(`H2 seed ${seed} MOUNTAIN outlets ${mtn.length}: reach channel/lake/sea ${good} (${((100 * good) / Math.max(1, mtn.length)).toFixed(0)} %) ${JSON.stringify(ends)}`);
    {
      // Per lake over 700 m: the chain of lines leaving it reaches a river, the sea, the edge or another lake.
      const chainEnd = (li: number): string => {
        let c = li;
        for (let g = 0; g < 400; g++) {
          const r = rs[c];
          if ((r.kind ?? 0) === 0) return 'river';
          if (r.end === 'channel' && (r.joins ?? -1) >= 0) { c = r.joins; continue; }
          return r.end ?? 'none';
        }
        return 'loop';
      };
      let total = 0, ok = 0, none = 0, sunk = 0;
      const startsIn = new Map<string, number[]>();
      rs.forEach((r, li) => {
        const lv = mask.at(r.north[0], r.east[0]);
        if (!(lv > -Infinity)) return;
        const key = lv.toFixed(3);
        (startsIn.get(key) ?? startsIn.set(key, []).get(key)!).push(li);
      });
      const seen = new Set<string>();
      for (const l of h.lakes) {
        if (l.level <= 700) continue;
        const key = l.level.toFixed(3);
        if (seen.has(key)) continue;
        seen.add(key);
        total++;
        // Lines through it (a river runs through: counts as reaching) or starting in it.
        let through = false;
        for (const r of rs) {
          if ((r.kind ?? 0) !== 0) continue;
          for (let i = 0; i < r.north.length && !through; i += 4) if (Math.abs(r.level[i] - l.level) < 0.01 && Math.hypot(r.north[i] - l.north, r.east[i] - l.east) < l.bound) through = true;
          if (through) break;
        }
        if (through) { ok++; continue; }
        const st = startsIn.get(key) ?? [];
        if (!st.length) { none++; continue; }
        const e = st.map(chainEnd);
        if (e.some((x) => x === 'river' || x === 'sea' || x === 'lake' || x === 'edge')) ok++;
        else sunk++;
      }
      console.log(`H2 seed ${seed} MOUNTAIN lakes (level > 700 m) ${total}: outflow reaches a river/lake/sea ${ok} (${((100 * ok) / Math.max(1, total)).toFixed(0)} %), no line leaving ${none}, ends sunk ${sunk}`);
    }
    // --- Falls by cause and height.
    const byCause: Record<string, number[]> = {};
    for (const f of falls) (byCause[f.cause ?? 'gradient'] ??= []).push(f.top - f.bottom);
    for (const [c, hs] of Object.entries(byCause)) console.log(`H2 seed ${seed} FALLS ${c}: ${hs.length}; height p10/p50/p90/max ${q(hs, 0.1).toFixed(1)}/${q(hs, 0.5).toFixed(1)}/${q(hs, 0.9).toFixed(1)}/${Math.max(...hs).toFixed(1)} m`);
    if (!falls.length) console.log(`H2 seed ${seed} FALLS none`);
    const rep: any = h.streamReport;
    console.log(`H2 seed ${seed} STREAMS lines ${rs.length} (${rs.filter((r) => r.kind === 1).length} streams); fills ${rep?.fills ?? '-'} tarns ${rep?.tarns ?? '-'} breaches ${rep?.breaches ?? '-'}; ends ${JSON.stringify(rep?.ends ?? {})}; build ${ms.toFixed(0)} ms`);
  }
  setWorldSeed(0);
});
it('shape report', () => {
  for (const seed of (process.env.H2_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const h: any = hydrology;
    console.log(`H2 seed ${seed} SHAPE ${JSON.stringify(h.streamReport?.shape)} faults ${h.faults?.length} (${(h.faults ?? []).map((f: any) => `${((f.north.length - 1)).toFixed(0)}km/${Math.max(...f.throw).toFixed(0)}m`).join(' ')})`);
    const falls: any[] = h.falls ?? [];
    for (const c of ['hanging', 'outlet']) console.log(`  ${c}: ${falls.filter((f) => f.cause === c).map((f) => `${f.height.toFixed(0)}m@${(f.north / 1000).toFixed(2)},${(f.east / 1000).toFixed(2)} run ${Math.hypot(f.footNorth - f.north, f.footEast - f.east).toFixed(0)}`).join('; ')}`);
  }
  setWorldSeed(0);
});
it('outlet sinks and tarns', () => {
  for (const seed of (process.env.H2_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const h: any = hydrology;
    const rep = h.streamReport;
    const td: number[] = rep.tarnDepth ?? [];
    const tarns: any[] = (h.lakeMask?.pools ?? []).slice((h.lakeMask?.pools?.length ?? 0) - (rep.tarns ?? 0));
    const hi = tarns.filter((t) => t.level > 700).length;
    const wet = tarns.filter((t: any) => true).length; void wet;
    console.log(`H2 seed ${seed} OUTLETSINK ${JSON.stringify(rep.outletSinkWhy)}; tarns ${rep.tarns} drained ${rep.tarnsDrained} holding water ${rep.tarnsWet} (over 700 m ${hi}), depth p10/p50/p90/max ${q(td, 0.1).toFixed(0)}/${q(td, 0.5).toFixed(0)}/${q(td, 0.9).toFixed(0)}/${Math.max(0, ...td).toFixed(0)} m; breach samples ${rep.breachSamples}; outlets ${rep.outlets} to lake ${rep.outletToLake} to sea ${rep.outletToSea} none ${rep.outletNone} high ${rep.outletHigh}`);
  }
  setWorldSeed(0);
});
it('grain', () => {
  for (const seed of (process.env.H2_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const by: number[][] = [[], [], [], [], []];
    const head: number[] = [], low: number[] = [];
    for (const r of (hydrology as any).rivers) {
      if (!r.grain) continue;
      for (let i = 0; i < r.s.length; i += 2) {
        by[r.regime[i]].push(r.grain[i]);
        if (r.s[i] < 500 && r.kind === 1) head.push(r.grain[i]);
        if (r.area[i] > 1000) low.push(r.grain[i]);
      }
    }
    const f = (a: number[]) => `${q(a, 0.1).toFixed(2)}/${q(a, 0.5).toFixed(2)}/${q(a, 0.9).toFixed(2)}`;
    console.log(`H2 seed ${seed} GRAIN p10/p50/p90 m by regime: placid ${f(by[0])} riffle ${f(by[1])} rapids ${f(by[2])} steppool ${f(by[3])} lip ${f(by[4])}; stream heads (first 500 m) ${f(head)}; rivers over 1000 km2 ${f(low)}`);
  }
  setWorldSeed(0);
});
