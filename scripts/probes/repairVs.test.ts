// Repair probe (the streams verifier's structure checks): widths, catchment, junction steps, levels, terrain following, falls, regime, lake outflow, outlet causeways. VS_PART=struct|det ; VS_SEEDS=1,42,777777
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeight, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

const seeds = (process.env.VS_SEEDS ?? '1,42,777777').split(',').map(Number);
const part = process.env.VS_PART ?? 'struct';
const pct = (a: number, b: number) => `${(100 * a / Math.max(1, b)).toFixed(2)}%`;
const q = (arr: number[], p: number) => { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

function fnv(h: number, x: number): number {
  const f = new Float64Array([x]); const u = new Uint32Array(f.buffer);
  for (const w of u) { h ^= w; h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
function worldHash(): string {
  let h = 2166136261;
  const rs: any[] = (hydrology as any).rivers ?? [];
  h = fnv(h, rs.length);
  for (const r of rs) {
    for (const k of ['north', 'east', 'level', 'halfWidth', 's', 'area', 'gradient', 'steepness', 'regime', 'speed']) {
      const a = r[k]; if (!a) continue; h = fnv(h, a.length); for (let i = 0; i < a.length; i++) h = fnv(h, a[i]);
    }
    h = fnv(h, r.joins ?? -9); h = fnv(h, r.kind ?? -9);
  }
  const falls: any[] = (hydrology as any).falls ?? [];
  h = fnv(h, falls.length);
  for (const f of falls) for (const k of ['line', 'index', 'north', 'east', 'top', 'bottom', 'width']) h = fnv(h, f[k]);
  let g = 2166136261;
  const s = makeSample();
  for (let i = 0; i < 160; i++) for (let j = 0; j < 160; j++) {
    sampleTerrain(-150000 + i * 1877 + 13, -150000 + j * 1871 + 7, s);
    g = fnv(g, s.ground); g = fnv(g, s.standing); g = fnv(g, s.river);
  }
  return `rivers/falls ${h.toString(16)} terrain ${g.toString(16)}`;
}

it('verify', () => {
  if (part === 'det') {
    const order = (process.env.VS_ORDER ?? '42').split(',').map(Number);
    for (const sd of order) { setWorldSeed(sd); console.log(`DET order-step seed ${sd}: ${worldHash()}`); }
    setWorldSeed(0);
    return;
  }
  for (const seed of seeds) {
    setWorldSeed(seed);
    const rs: any[] = (hydrology as any).rivers;
    const falls: any[] = (hydrology as any).falls ?? [];
    const mask = (hydrology as any).lakeMask;
    const inLake = (n: number, e: number) => mask.at(n, e) > -Infinity;
    const S = makeSample();
    const nR = rs.filter((r) => (r.kind ?? 0) === 0).length;
    console.log(`\n===== seed ${seed}: ${rs.length} lines (${nR} rivers, ${rs.length - nR} streams), ${falls.length} falls, ${hydrology.lakes.length} lakes`);

    // ---- width along lines
    for (const kind of [0, 1]) {
      let samples = 0, dec = 0, dec05 = 0, worst = 0, worstAt = '', linesDec = 0;
      rs.forEach((r, li) => {
        if ((r.kind ?? 0) !== kind) return;
        let any = false;
        for (let i = 0; i + 1 < r.halfWidth.length; i++) {
          samples++;
          const d = r.halfWidth[i] - r.halfWidth[i + 1];
          if (d > 0.01) { dec++; any = true; if (d > 0.5) dec05++; if (d > worst) { worst = d; worstAt = `line ${li} i ${i} @${(r.north[i] / 1000).toFixed(2)},${(r.east[i] / 1000).toFixed(2)} ${r.halfWidth[i].toFixed(2)}->${r.halfWidth[i + 1].toFixed(2)}`; } }
        }
        if (any) linesDec++;
      });
      console.log(`WIDTH kind ${kind}: ${samples} steps, narrowing >0.01 m ${dec} (${pct(dec, samples)}), >0.5 m ${dec05}; lines with any narrowing ${linesDec}; worst ${worst.toFixed(2)} m at ${worstAt}`);
    }
    // area monotone
    {
      let dec = 0, n = 0, worst = 0;
      for (const r of rs) if (r.area) for (let i = 0; i + 1 < r.area.length; i++) { n++; const d = r.area[i] - r.area[i + 1]; if (d > 0.01) { dec++; worst = Math.max(worst, d); } }
      console.log(`AREA catchment decreasing downstream: ${dec}/${n} steps, worst ${worst.toFixed(2)} km2`);
    }
    // ---- junctions
    {
      const steps: number[] = []; let neg = 0, narrowRecv = 0, uphill = 0, uphillBig = 0, tot = 0; const negAt: string[] = []; const upAt: string[] = []; const nrAt: string[] = [];
      const stepsRR: number[] = [];
      rs.forEach((r, li) => {
        const p = r.joins ?? -1; if (p < 0) return;
        const P = rs[p]; const m = r.north.length; const en = r.north[m - 1], ee = r.east[m - 1];
        let bj = 0, bd = Infinity;
        for (let j = 0; j < P.north.length; j++) { const d = Math.hypot(P.north[j] - en, P.east[j] - ee); if (d < bd) { bd = d; bj = j; } }
        if (bd > 300) return;
        tot++;
        const sj = P.s[bj];
        let ju = bj, jd = bj;
        while (ju > 0 && P.s[ju] > sj - 300) ju--;
        while (jd < P.s.length - 1 && P.s[jd] < sj + 300) jd++;
        const st = P.halfWidth[jd] - P.halfWidth[ju];
        steps.push(st);
        if ((r.kind ?? 0) === 0 && (P.kind ?? 0) === 0) stepsRR.push(st);
        if (st < -0.05) { neg++; if (negAt.length < 6) negAt.push(`${li}->${p} ${P.halfWidth[ju].toFixed(1)}->${P.halfWidth[jd].toFixed(1)} @${(en / 1000).toFixed(1)},${(ee / 1000).toFixed(1)}`); }
        if (P.halfWidth[jd] + 0.05 < r.halfWidth[m - 1]) { narrowRecv++; if (nrAt.length < 6) nrAt.push(`${li}(k${r.kind}) hw ${r.halfWidth[m - 1].toFixed(1)} into ${p}(k${P.kind}) hw ${P.halfWidth[jd].toFixed(1)} @${(en / 1000).toFixed(1)},${(ee / 1000).toFixed(1)}`); }
        const dl = P.level[bj] - r.level[m - 1];
        if (dl > 0.5) { uphill++; if (dl > 3) uphillBig++; if (upAt.length < 6) upAt.push(`${li}(k${r.kind})->${p} trib ${r.level[m - 1].toFixed(1)} recv ${P.level[bj].toFixed(1)} @${(en / 1000).toFixed(1)},${(ee / 1000).toFixed(1)}`); }
      });
      console.log(`JUNCTION ${tot} joins: receiver width step (+-300 m) p10/p50/p90 ${q(steps, 0.1).toFixed(2)}/${q(steps, 0.5).toFixed(2)}/${q(steps, 0.9).toFixed(2)} m; negative (narrower below) ${neg}: ${negAt.join('; ')}`);
      console.log(`  river-river joins ${stepsRR.length}: step p10/p50/p90 ${q(stepsRR, 0.1).toFixed(2)}/${q(stepsRR, 0.5).toFixed(2)}/${q(stepsRR, 0.9).toFixed(2)}`);
      console.log(`  receiver narrower than tributary below join: ${narrowRecv}: ${nrAt.join('; ')}`);
      console.log(`  tributary end level below receiver water (>0.5 m, i.e. flows uphill into it): ${uphill} (>3 m ${uphillBig}): ${upAt.join('; ')}`);
    }
    // ---- level rising downstream
    for (const kind of [0, 1]) {
      let n = 0, rise = 0, rise1 = 0, worst = 0, at = ''; const lines = new Set<number>();
      rs.forEach((r, li) => {
        if ((r.kind ?? 0) !== kind) return;
        for (let i = 0; i + 1 < r.level.length; i++) {
          n++;
          const d = r.level[i + 1] - r.level[i];
          if (d > 0.05) { rise++; lines.add(li); if (d > 1) rise1++; if (d > worst) { worst = d; at = `line ${li} i ${i}/${r.level.length} @${(r.north[i] / 1000).toFixed(2)},${(r.east[i] / 1000).toFixed(2)} ${r.level[i].toFixed(1)}->${r.level[i + 1].toFixed(1)} end ${r.end}`; } }
        }
      });
      console.log(`LEVEL kind ${kind}: ${n} steps, rising downstream >0.05 m ${rise} (${lines.size} lines), >1 m ${rise1}; worst +${worst.toFixed(2)} m at ${at}`);
    }
    // ---- terrain following: stream water vs lowest ground across
    for (const kind of [0, 1]) {
      let n = 0, natLow2 = 0, natLow10 = 0, drawLow2 = 0, drawLow10 = 0, notLowest = 0; const off: number[] = [];
      let wAt = '', wv = 0;
      rs.forEach((r, li) => {
        if ((r.kind ?? 0) !== kind) return;
        for (let k = 2; k < r.north.length - 2; k += 4) {
          const pn = r.north[k], pe = r.east[k];
          if (inLake(pn, pe)) continue;
          sampleTerrain(pn, pe, S); if (S.ground < 1) continue;
          const bedC = S.ground;
          n++;
          const dn = r.north[k + 1] - r.north[k - 1], de = r.east[k + 1] - r.east[k - 1]; const len = Math.hypot(dn, de) || 1;
          const nx = -de / len, ny = dn / len;
          const L = r.level[k];
          let natMin = Infinity, natArg = 0, drawMin = Infinity, drawBelowBed = Infinity;
          for (let o = -200; o <= 200; o += 20) {
            const x = pn + nx * o, y = pe + ny * o;
            const g = naturalHeight(x, y);
            if (g < natMin) { natMin = g; natArg = o; }
            if (Math.abs(o) >= r.halfWidth[k] + 15 && Math.abs(o) <= 150) {
              sampleTerrain(x, y, S);
              const wet = (S.standing > S.ground + 0.05 && S.standing > 0.5) || S.river > -Infinity;
              if (!wet) { drawMin = Math.min(drawMin, S.ground); drawBelowBed = Math.min(drawBelowBed, S.ground); }
            }
          }
          off.push(Math.abs(natArg));
          if (natMin < L - 2) natLow2++;
          if (natMin < L - 10) { natLow10++; if (L - natMin > wv) { wv = L - natMin; wAt = `line ${li} @${(pn / 1000).toFixed(2)},${(pe / 1000).toFixed(2)} level ${L.toFixed(0)} natural min ${natMin.toFixed(0)} at ${natArg} m`; } }
          if (drawMin < L - 2) drawLow2++;
          if (drawMin < L - 10) drawLow10++;
          if (drawBelowBed < bedC - 2) notLowest++;
        }
      });
      console.log(`FOLLOW kind ${kind}: ${n} pts; natural ground within 200 m across lower than water by >2 m ${pct(natLow2, n)}, >10 m ${pct(natLow10, n)} (worst ${wv.toFixed(0)} m: ${wAt}); |offset of natural low| p50/p90 ${q(off, 0.5)}/${q(off, 0.9)} m`);
      console.log(`  drawn dry ground beside (hw+15..150 m) below water >2 m ${pct(drawLow2, n)}, >10 m ${pct(drawLow10, n)}; drawn ground beside lower than the channel bed by >2 m ${pct(notLowest, n)}`);
    }
    // ---- falls
    {
      const drops: number[] = []; let over = 0, conf = 0, inLk = 0, noPool = 0, footHang = 0, lipHang = 0, mismatch = 0; const overAt: string[] = []; const after20: number[] = [];
      const byKind = [0, 0];
      falls.forEach((f) => {
        const r = rs[f.line]; const d = f.top - f.bottom; drops.push(d); byKind[r.kind ?? 0]++;
        if (d > 12.01) { over++; if (overAt.length < 6) overAt.push(`${d.toFixed(1)} m line ${f.line}(k${r.kind}) @${(f.north / 1000).toFixed(2)},${(f.east / 1000).toFixed(2)}`); }
        const i = f.index; const m = r.level.length;
        if (i >= m - 2) conf++;
        if (Math.abs(r.level[i] - f.top) > 0.01) mismatch++;
        if (inLake(f.north, f.east)) inLk++;
        // pool: level drop over 20 m after the foot sample (i+1)
        const sF = r.s[Math.min(m - 1, i + 1)]; let j = i + 1; while (j < m - 1 && r.s[j] < sF + 20) j++;
        if (j < m && i + 1 < m) { const dd = r.level[i + 1] - r.level[j]; after20.push(dd / Math.max(1, r.s[j] - sF)); if (dd / Math.max(1, r.s[j] - sF) > 0.02) noPool++; }
        sampleTerrain(f.north, f.east, S); if (f.top - S.ground > 2) lipHang++;
        if (i + 1 < m) { sampleTerrain(r.north[i + 1], r.east[i + 1], S); if (f.bottom - S.ground > 2) footHang++; }
      });
      const hist = [0, 3, 5, 8, 12, 12.01, 20, 50, 1e9]; const hc = new Array(hist.length - 1).fill(0);
      for (const d of drops) for (let h = 0; h < hist.length - 1; h++) if (d >= hist[h] && d < hist[h + 1]) hc[h]++;
      console.log(`FALLS ${falls.length} (rivers ${byKind[0]}, streams ${byKind[1]}); confluence-type (lip at last-but-one sample) ${conf}; drop max ${Math.max(...drops).toFixed(1)} m p50 ${q(drops, 0.5).toFixed(1)}; hist [0,3,5,8,12,12.01,20,50,inf): ${hc.join('/')}; >12 m ${over}: ${overAt.join('; ')}`);
      console.log(`  in a lake ${inLk}; top != line level ${mismatch}; lip water >2 m over drawn ground ${lipHang}; foot pool >2 m over drawn ground ${footHang}; no flat pool (level falls >2 % in 20 m after foot) ${noPool}/${after20.length}, gradient after foot p10/p50/p90 ${q(after20, 0.1).toFixed(3)}/${q(after20, 0.5).toFixed(3)}/${q(after20, 0.9).toFixed(3)}`);
    }
    // ---- regime by elevation and relief
    {
      const bands = [0, 100, 300, 700, 1200, 1e9];
      const km = bands.slice(0, -1).map(() => [0, 0, 0, 0, 0]);
      const flat = [0, 0, 0, 0, 0]; let flatTot = 0;
      const steepMtn = [0, 0, 0, 0, 0];
      for (const r of rs) {
        if (!r.regime) continue;
        for (let i = 0; i + 1 < r.north.length; i++) {
          const ds = (r.s[i + 1] - r.s[i]) / 1000;
          const L = r.level[i]; let b = 0; while (L >= bands[b + 1]) b++;
          km[b][r.regime[i]] += ds;
          if (i % 6 === 0) {
            // relief: natural ground range within 1 km (8 points + centre), weighted by 6 samples
            let lo = Infinity, hi = -Infinity;
            for (let a = 0; a < 8; a++) { const g = naturalHeight(r.north[i] + 1000 * Math.cos(a * Math.PI / 4), r.east[i] + 1000 * Math.sin(a * Math.PI / 4)); lo = Math.min(lo, g); hi = Math.max(hi, g); }
            const w = (r.s[Math.min(r.s.length - 1, i + 6)] - r.s[i]) / 1000;
            if (hi - lo < 20) { flat[r.regime[i]] += w; flatTot += w; }
            if (hi - lo > 300) steepMtn[r.regime[i]] += w;
          }
        }
      }
      console.log(`REGIME km [placid,riffle,rapids,steppool,lip] by water level band:`);
      for (let b = 0; b < km.length; b++) console.log(`  ${bands[b]}-${bands[b + 1]} m: ${km[b].map((v) => v.toFixed(0)).join(' / ')}`);
      console.log(`  flat ground (range <20 m within 1 km): ${flat.map((v) => v.toFixed(0)).join(' / ')} of ${flatTot.toFixed(0)} km; rugged (>300 m): ${steepMtn.map((v) => v.toFixed(0)).join(' / ')}`);
    }
    // ---- lakes: outflow
    {
      const lakes = hydrology.lakes;
      let noExit = 0, reachRiver = 0, sinkOnly = 0, total = 0; const noExitAt: string[] = []; const sinkAt: string[] = [];
      const chainEnd = (li: number): string => {
        let c = li; for (let g = 0; g < 200; g++) { const r = rs[c]; if ((r.kind ?? 0) === 0) return 'river'; const e = r.end; if (e === 'channel' && (r.joins ?? -1) >= 0) { c = r.joins; continue; } return e ?? 'none'; } return 'loop';
      };
      for (const l of lakes) {
        total++;
        const R = Math.max(l.radiusA, l.radiusB);
        const inThis = (n: number, e: number) => Math.hypot(n - l.north, e - l.east) < l.bound + 50 && Math.abs(mask.at(n, e) - l.level) < 1;
        let exits: number[] = [];
        rs.forEach((r, li) => {
          let wasIn = false;
          for (let i = 0; i < r.north.length; i++) {
            if (Math.hypot(r.north[i] - l.north, r.east[i] - l.east) > l.bound + 600) { if (wasIn) { exits.push(li); return; } continue; }
            const inn = inThis(r.north[i], r.east[i]);
            if (inn) wasIn = true; else if (wasIn && r.level[i] < l.level + 0.5) { exits.push(li); return; }
          }
        });
        if (!exits.length) { noExit++; if (noExitAt.length < 12) noExitAt.push(`${(l.north / 1000).toFixed(1)},${(l.east / 1000).toFixed(1)} lvl ${l.level.toFixed(0)} r ${R.toFixed(0)}`); continue; }
        const ends = exits.map(chainEnd);
        if (ends.some((e) => e === 'river' || e === 'sea' || e === 'edge' || e === 'lake')) reachRiver++;
        else { sinkOnly++; if (sinkAt.length < 8) sinkAt.push(`${(l.north / 1000).toFixed(1)},${(l.east / 1000).toFixed(1)} lvl ${l.level.toFixed(0)} -> ${ends.join(',')}`); }
      }
      console.log(`LAKES ${total}: no line leaving the lake ${noExit}; outflow reaches river/lake/sea ${reachRiver}; outflow only ends in sink/stuck ${sinkOnly}`);
      console.log(`  no exit: ${noExitAt.join('; ')}`);
      console.log(`  sink-only: ${sinkAt.join('; ')}`);
      const ends: Record<string, number> = {}; for (let li = 0; li < rs.length; li++) if (rs[li].kind === 1) { const e = rs[li].end; ends[e] = (ends[e] ?? 0) + 1; }
      console.log(`  stream ends: ${JSON.stringify(ends)}`);
    }
    // ---- outlet causeway: stream samples inside a lake where drawn ground stands above the lake water
    {
      let n = 0, cause = 0, worst = 0, at = '', raised = 0, rworst = 0, rat = '';
      rs.forEach((r, li) => {
        if (r.kind !== 1) return;
        for (let i = 0; i < r.north.length; i++) {
          const lv = mask.at(r.north[i], r.east[i]); if (!(lv > -Infinity)) continue;
          n++;
          for (const o of [0, r.halfWidth[i] + 3]) {
            sampleTerrain(r.north[i], r.east[i] + o, S);
            const d = S.ground - lv;
            // Raised: the natural ground there lies under the water, the drawn ground over it (a causeway built).
            if (d > 0.2 && naturalHeight(r.north[i], r.east[i] + o) < lv) { raised++; if (d > rworst) { rworst = d; rat = `line ${li} @${(r.north[i] / 1000).toFixed(2)},${(r.east[i] / 1000).toFixed(2)}`; } }
            if (d > 0.2) { cause++; if (d > worst) { worst = d; at = `line ${li} @${(r.north[i] / 1000).toFixed(2)},${(r.east[i] / 1000).toFixed(2)}`; } break; }
          }
        }
      });
      console.log(`CAUSEWAY stream samples inside lake water ${n}; drawn ground above the lake surface there ${cause}; worst ${worst.toFixed(1)} m at ${at}; raised over natural ground under the water ${raised}, worst ${rworst.toFixed(1)} m at ${rat}`);
    }
  }
  setWorldSeed(0);
});
