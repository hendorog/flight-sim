// Gates on what is drawn (coordinator's D):
//  (i)  every stream (kind 1) of 1 km² or more, sampled every DG_EVERY m (not within 150 m of its ends, nor within
//       300 m of a river, a lake or another line's water): the drawn channel's width across it - the run about the line
//       where the drawn surface stands within DG_TOL m of the water and lies carved under the natural ground (or is
//       water) - against the bed-width law (streams.ts bedWidth): ratio quantiles, share within x0.6-1.6, correlation
//       of log width with log catchment;
//  (ii) junctions: lines ending on another line, the receiver's water half-width at its nearest sample against the
//       joining line's at its mouth: count under 0.8x, worst cases;
// (iii) breach: non-outlet streams' samples with a breach wider than their bed (half-width over half the bed + 0.5 m).
//   DG_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts drawnGate
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeight, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const bedWidth = (A: number): number => (A >= 45 ? 2 * Math.min(45, Math.max(3, 1.5 + 0.85 * Math.sqrt(A))) : 2.594 * Math.pow(Math.max(0, A), 0.45));
it('drawn gate', () => {
  const EVERY = Number(env.DG_EVERY ?? 400), TOL = Number(env.DG_TOL ?? 1.0);
  for (const seed of (env.DG_SEEDS ?? '42').split(',')) {
    setWorldSeed(seed);
    const R = hydrology.rivers!;
    const sm = makeSample();
    const hit = { dist: 0, level: 0, halfWidth: 0, s: 0, side: 0, beyondSource: 0 };
    const ratios: number[] = [];
    const lw: number[] = [], la: number[] = [];
    const mask = hydrology.lakeMask;
    R.forEach((r, li) => {
      if ((r.kind ?? 0) !== 1 || !r.area) return;
      const sEnd = r.s[r.s.length - 1];
      let next = 150;
      for (let i = 1; i + 1 < r.s.length; i++) {
        if (r.s[i] < next || r.s[i] > sEnd - 150) continue;
        next = r.s[i] + EVERY;
        const A = r.area[i];
        if (A < 1) continue;
        const n0 = r.north[i], e0 = r.east[i];
        if (mask && mask.at(n0, e0) > -Infinity) continue;
        const tn = r.north[i + 1] - r.north[i - 1], te = r.east[i + 1] - r.east[i - 1], tl = Math.hypot(tn, te) || 1;
        const pn = -te / tl, pe = tn / tl;
        // (Not near a river or another line: their carving would count.)
        let clear = true;
        for (const o of [-300, -150, 0, 150, 300]) {
          hydrology.queryRiver(n0 + pn * o, e0 + pe * o, hit);
          if (hit.dist < 300 && hit.halfWidth > 0) {
            // queryRiver reports the nearest line; a stream's own is fine, a river or other line is not.
            if (hit.level < r.level[i] - 0.5 || hit.level > r.level[i] + 0.5 || Math.abs(o) > 0) {
              if (Math.abs(hit.level - r.level[i]) > 0.5) { clear = false; break; }
            }
          }
        }
        if (!clear) continue;
        const lvl = r.level[i];
        let width = 0;
        for (const side of [-1, 1]) {
          for (let d = 0; d <= 120; d += 0.5) {
            const n = n0 + pn * d * side, e = e0 + pe * d * side;
            sampleTerrain(n, e, sm);
            const water = sm.river > sm.ground;
            const carved = sm.ground < naturalHeight(n, e) - 0.3;
            if (!(water || (sm.ground <= lvl + TOL && carved))) break;
            width += 0.5;
          }
        }
        const law = bedWidth(A);
        ratios.push(width / law);
        if (width > 0) { lw.push(Math.log(width)); la.push(Math.log(A)); }
      }
    });
    ratios.sort((a, b) => a - b);
    const q = (f: number): string => (ratios[Math.min(ratios.length - 1, Math.floor(f * ratios.length))] ?? NaN).toFixed(2);
    const within = ratios.filter((x) => x >= 0.6 && x <= 1.6).length;
    const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    const mw = mean(lw), ma = mean(la);
    let cov = 0, vw = 0, va = 0;
    for (let k = 0; k < lw.length; k++) { cov += (lw[k] - mw) * (la[k] - ma); vw += (lw[k] - mw) ** 2; va += (la[k] - ma) ** 2; }
    const corr = cov / Math.sqrt(vw * va || 1);
    console.log(`seed ${seed} (i): ${ratios.length} profiles; drawn width / law p10 ${q(0.1)} p25 ${q(0.25)} p50 ${q(0.5)} p75 ${q(0.75)} p90 ${q(0.9)}; within x0.6-1.6 ${((100 * within) / Math.max(1, ratios.length)).toFixed(1)} %; corr(log width, log A) ${corr.toFixed(2)}`);
    // (ii)
    let joins = 0, thin = 0;
    const worst: Array<[number, string]> = [];
    R.forEach((r, li) => {
      const j = r.joins ?? -1;
      if (j < 0 || (r.kind === 1 && r.end !== 'channel')) return;
      const P = R[j];
      const m = r.north.length - 1;
      let bk = 0, bd = Infinity;
      for (let k = 0; k < P.north.length; k++) { const d = Math.hypot(P.north[k] - r.north[m], P.east[k] - r.east[m]); if (d < bd) { bd = d; bk = k; } }
      if (bd > 60) return;
      joins++;
      const ratio = P.halfWidth[bk] / Math.max(1e-6, r.halfWidth[m]);
      if (ratio < 0.8) { thin++; worst.push([ratio, `line ${li} (hw ${r.halfWidth[m].toFixed(1)}, A ${r.area?.[m]?.toFixed(1)}) into ${j} (kind ${P.kind}, hw ${P.halfWidth[bk].toFixed(1)}, A ${P.area?.[bk]?.toFixed(1)}) at ${r.north[m].toFixed(0)},${r.east[m].toFixed(0)}`]); }
    });
    worst.sort((a, b) => a[0] - b[0]);
    console.log(`seed ${seed} (ii): ${joins} junctions; receiver water under 0.8x the joining line's: ${thin}`);
    for (const [x, s] of worst.slice(0, 5)) console.log(`   ${x.toFixed(2)} ${s}`);
    // (iii)
    let br = 0, brLines = 0, brMax = 0, samples = 0;
    R.forEach((r) => {
      if ((r.kind ?? 0) !== 1 || !r.breach || !r.area) return;
      if (mask && mask.at(r.north[0], r.east[0]) > -Infinity) return; // a lake's outlet
      let any = false;
      for (let i = 0; i < r.s.length; i++) {
        samples++;
        const over = r.breach[i] - (0.5 * bedWidth(r.area[i]) + 0.5);
        if (r.breach[i] > 0 && over > 0) { br++; any = true; brMax = Math.max(brMax, r.breach[i]); }
      }
      if (any) brLines++;
    });
    // (iv) streams ending in a sink, by the relief class where they end (5 km window on a 1 km lattice: plain < 150 m,
    // hill < 500 m, mountain).
    const cls: Record<string, number> = { plain: 0, hill: 0, mountain: 0 };
    const where: string[] = [];
    R.forEach((r, li) => {
      if ((r.kind ?? 0) !== 1 || (r.end !== 'sink' && r.end !== 'stuck')) return;
      const m = r.north.length - 1;
      const n0 = Math.round(r.north[m] / 1000) * 1000, e0 = Math.round(r.east[m] / 1000) * 1000;
      let lo = Infinity, hi = -Infinity;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const h = Math.max(0, terrainHeight(n0 + a * 1000, e0 + b * 1000)); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      const k = hi - lo >= 500 ? 'mountain' : hi - lo >= 150 ? 'hill' : 'plain';
      cls[k]++;
      if (k !== 'plain') { const ch = (r.area?.[0] ?? 0) >= 9.9 ? 'chain' : 'f3'; cls[ch] = (cls[ch] ?? 0) + 1; }
      if (k !== 'plain' && where.length < 8) where.push(`line ${li} (A0 ${r.area?.[0]?.toFixed(1)} A ${r.area?.[m]?.toFixed(1)}) at ${r.north[m].toFixed(0)},${r.east[m].toFixed(0)} relief ${(hi - lo).toFixed(0)}`);
    });
    console.log(`seed ${seed} (iv): stream sink ends: plain ${cls.plain}, hill ${cls.hill}, mountain ${cls.mountain} (of the hill and mountain ones: chain streams ${cls.chain ?? 0}, f3's ${cls.f3 ?? 0})`);
    for (const w of where) console.log(`   ${w}`);
    console.log(`seed ${seed} (iii): non-outlet stream samples with a breach wider than the bed: ${br} of ${samples} on ${brLines} lines; widest breach half-width ${brMax.toFixed(0)} m`);
  }
  setWorldSeed(0);
});
