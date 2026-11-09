// Investigation (junctions): the painted network (rills.ts) in rillGate's patches (20 a seed, same choice):
//  - junctions (a node two or more segments run into): for each tributary (every incoming arm but the biggest), its
//    angle to the course below over JP_ARM m (rillGate's rule at 50), the branch angle to the main arm above
//    (Seybold et al. 2017's measure), whether both the tributary and the course below lie on a grid axis (within 2.5 deg
//    of a multiple of 45 deg over JP_ARM), whether the tributary carries water (rillWaterHalf > 0) and its catchment;
//  - the course's heading over 100 m chords along the wet lines, as a share within 2.5 deg of a multiple of 45 deg
//    (11.1 % for natural headings), and straight grid runs >= 300 m;
//  - rillGate's turns > 60 deg split as junction / spill / course, the junction ones by grid and by wet.
// JP_OUT writes the junction list as JSON lines.
//   JP_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts invJunctionsPainted --reporter=verbose
import { it } from 'vitest';
import { gullyNet } from '../../src/world/terrain/gullies';
import { RILL_PATCH, rillArea, rillPatchLines, rillWaterHalf, type RillSegment } from '../../src/world/terrain/rills';
import { setWorldSeed } from '../../src/world/worldSeed';
import { hash2i } from '../../src/world/terrain/noise';
import { terrainHeight } from '../../src/world/terrain/heightfield';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: string): void; mkdirSync(p: string, o: unknown): void };
const D = 180 / Math.PI;
const TOL = 2.5;
it('junctions: painted network', () => {
  const ARM = Number(env.JP_ARM ?? 100);
  const allJ: string[] = [];
  for (const seed of (env.JP_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const g = gullyNet()!;
    const patches: string[] = [];
    const cand: number[] = [];
    for (let q = 0; q < g.n * g.n; q++) if (g.dir[q] && g.area[q] >= 5 && g.area[q] < 40) cand.push(q);
    cand.sort((a, b) => (hash2i(a, seed) >>> 0) - (hash2i(b, seed) >>> 0));
    const set = new Set<string>();
    for (const q of cand) {
      if (set.size >= Number(env.JP_PATCHES ?? 20)) break;
      const n = g.origin + Math.floor(q / g.n) * g.cell, e = g.origin + (q % g.n) * g.cell;
      const k = `${Math.floor(e / RILL_PATCH)},${Math.floor(n / RILL_PATCH)}`;
      if (!set.has(k)) { set.add(k); patches.push(k); }
    }
    const axis = (h: number): number => { const deg = ((h * D) % 180 + 180) % 180; const k = Math.round(deg / 45); return Math.abs(deg - k * 45); };
    const dAng = (a: number, b: number): number => { let d = Math.abs(a - b) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d; return d; };
    const K = (e: number, n: number): string => `${e.toFixed(2)},${n.toFixed(2)}`;
    let km = 0, wetKm = 0, gridKm = 0, wetGridKm = 0, runKm = 0;
    const turnsBy: Record<string, number> = {};
    const J: { ang: number; ang50: number; branch: number; grid: boolean; wet: boolean; A: number; Am: number; n: number; e: number; rg: boolean }[] = [];
    const runs: string[] = [];
    for (const key of patches) {
      const [pi, pj] = key.split(',').map(Number);
      const { segs } = rillPatchLines({ pi, pj });
      const e0 = pi * RILL_PATCH, n0 = pj * RILL_PATCH;
      const inCore = (e: number, n: number): boolean => e >= e0 && e < e0 + RILL_PATCH && n >= n0 && n < n0 + RILL_PATCH;
      const from = new Map<string, RillSegment[]>(), into = new Map<string, RillSegment[]>(), toSeg = new Map<string, RillSegment>();
      for (const s of segs) {
        (from.get(K(s.e0, s.n0)) ?? from.set(K(s.e0, s.n0), []).get(K(s.e0, s.n0))!).push(s);
        const k1 = K(s.e1, s.n1);
        (into.get(k1) ?? into.set(k1, []).get(k1)!).push(s);
        const o = toSeg.get(k1); if (!o || s.s0 > o.s0) toSeg.set(k1, s);
      }
      // Walk back from a point through the main parent, from a given incoming segment first.
      const back = (first: RillSegment, len0: number): [number, number] | null => { let cur: RillSegment | undefined = first, len = 0, e = first.e1, n = first.n1; for (let i = 0; i < 40 && cur && len < len0; i++) { len += Math.hypot(cur.e1 - cur.e0, cur.n1 - cur.n0); e = cur.e0; n = cur.n0; cur = toSeg.get(K(e, n)); } return len >= len0 * 0.8 ? [e, n] : null; };
      const ahead = (e: number, n: number, len0: number): [number, number] | null => { let len = 0, cur = from.get(K(e, n))?.[0]; for (let i = 0; i < 40 && cur && len < len0; i++) { len += Math.hypot(cur.e1 - cur.e0, cur.n1 - cur.n0); e = cur.e1; n = cur.n1; cur = from.get(K(e, n))?.[0]; } return len >= len0 * 0.8 ? [e, n] : null; };
      const hd = (a: [number, number], b: [number, number]): number => Math.atan2(b[0] - a[0], b[1] - a[1]);
      // Course headings and runs (per segment in the core: the 100 m chord centred on its start).
      const onAxisRun = new Map<RillSegment, number>();
      for (const s of segs) {
        if (!inCore((s.e0 + s.e1) / 2, (s.n0 + s.n1) / 2)) continue;
        const L = Math.hypot(s.e1 - s.e0, s.n1 - s.n0);
        const wet = rillWaterHalf(s.s1) > 0;
        km += L / 1000; if (wet) wetKm += L / 1000;
        const prev = toSeg.get(K(s.e0, s.n0));
        const b = prev ? back(prev, 50) : null, a = ahead(s.e0, s.n0, 50);
        if (b && a) {
          const h = hd(b, a);
          if (axis(h) < TOL) { gridKm += L / 1000; if (wet) wetGridKm += L / 1000; onAxisRun.set(s, Math.round(((h * D) % 180 + 180) % 180 / 45) % 4); }
          // rillGate's turn (50 m either side)
          const h1 = hd(b, [s.e0, s.n0]), h2 = hd([s.e0, s.n0], a);
          if (dAng(h1, h2) > Math.PI / 3) {
            const isJ = (() => { let e = s.e0, n = s.n0, len = 0, cur: RillSegment | undefined = s; if ((into.get(K(e, n))?.length ?? 0) >= 2) return true; for (let i = 0; i < 20 && cur && len < 50; i++) { len += Math.hypot(cur.e1 - cur.e0, cur.n1 - cur.n0); e = cur.e1; n = cur.n1; if ((into.get(K(e, n))?.length ?? 0) >= 2) return true; cur = from.get(K(e, n))?.[0]; } return false; })();
            turnsBy[isJ ? 'junction' : 'other'] = (turnsBy[isJ ? 'junction' : 'other'] ?? 0) + L / 100;
          }
        }
      }
      // Straight grid runs: follow each on-axis segment downstream along the main next while the axis holds.
      for (const [s, ax] of onAxisRun) {
        const prev = toSeg.get(K(s.e0, s.n0));
        if (prev && onAxisRun.get(prev) === ax) continue;
        // (Never a segment twice: the painted graph has out-and-back pairs, round T.)
        let len = 0, cur: RillSegment | undefined = s;
        const vis = new Set<RillSegment>();
        for (let g2 = 0; g2 < 400 && cur && onAxisRun.get(cur) === ax && !vis.has(cur); g2++) { vis.add(cur); len += Math.hypot(cur.e1 - cur.e0, cur.n1 - cur.n0); cur = from.get(K(cur.e1, cur.n1))?.[0]; }
        if (len >= 300) { runKm += len / 1000; if (runs.length < 10) runs.push(`   run ${len.toFixed(0)} m axis ${ax * 45} from ${s.n0.toFixed(0)},${s.e0.toFixed(0)} wet ${rillWaterHalf(s.s1) > 0}`); }
      }
      // Junctions in the core.
      for (const [k, ins] of into) {
        if (ins.length < 2) continue;
        const [je, jn] = k.split(',').map(Number);
        if (!inCore(je, jn)) continue;
        const dn = ahead(je, jn, ARM), dn50 = ahead(je, jn, 50);
        if (!dn || !dn50) continue;
        const hDown = hd([je, jn], dn), hDown50 = hd([je, jn], dn50);
        const main = ins.reduce((a, b) => (b.s1 > a.s1 ? b : a));
        const mb = back(main, ARM);
        const hMain = mb ? hd(mb, [je, jn]) : NaN;
        for (const t of ins) {
          if (t === main) continue;
          const tb = back(t, ARM), tb50 = back(t, 50);
          if (!tb || !tb50) continue;
          const hT = hd(tb, [je, jn]), hT50 = hd(tb50, [je, jn]);
          const ang = dAng(hT, hDown) * D, ang50 = dAng(hT50, hDown50) * D;
          J.push({ ang, ang50, branch: Number.isFinite(hMain) ? dAng(hT, hMain) * D : NaN, grid: axis(hT) < TOL && axis(hDown) < TOL, wet: rillWaterHalf(t.s1) > 0, A: rillArea(t.s1), Am: rillArea(main.s1), n: jn, e: je, rg: ang50 > 60 });
        }
      }
    }
    const stats = (v: number[]): string => { const x = v.filter(Number.isFinite).sort((a, b) => a - b); if (!x.length) return 'n 0'; const mean = x.reduce((a, b) => a + b, 0) / x.length; const sd = Math.sqrt(x.reduce((a, b) => a + (b - mean) ** 2, 0) / x.length); const q = (f: number) => x[Math.min(x.length - 1, Math.floor(f * x.length))].toFixed(0); return `n ${x.length} mean ${mean.toFixed(1)} sd ${sd.toFixed(1)} p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)} >60 ${((100 * x.filter((a) => a > 60).length) / x.length).toFixed(0)} % >80 ${((100 * x.filter((a) => a > 80).length) / x.length).toFixed(0)} % >120 ${((100 * x.filter((a) => a > 120).length) / x.length).toFixed(0)} %`; };
    const near = (x: number[], c: number[], w: number): number => x.filter((a) => c.some((cc) => Math.abs(a - cc) < w)).length;
    console.log(`seed ${seed}: ${patches.length} patches, painted ${km.toFixed(0)} km (wet ${wetKm.toFixed(0)}); course on a grid axis (100 m chord, +-${TOL}) ${((100 * gridKm) / km).toFixed(1)} % (wet ${((100 * wetGridKm) / Math.max(1e-9, wetKm)).toFixed(1)} %; natural 11.1 %); straight grid runs >= 300 m ${runKm.toFixed(1)} km (${((100 * runKm) / km).toFixed(2)} %)`);
    console.log(`seed ${seed}: rillGate turns per 100 km: junction ${((100 * (turnsBy.junction ?? 0)) / km).toFixed(1)}, other ${((100 * (turnsBy.other ?? 0)) / km).toFixed(1)}`);
    for (const [lab, sel] of [['all', J], ['wet', J.filter((j) => j.wet)], ['wet A>0.3', J.filter((j) => j.wet && j.A > 0.3)]] as const) {
      console.log(`seed ${seed} junctions ${lab}: tributary vs course below (${ARM} m): ${stats(sel.map((j) => j.ang))}`);
      console.log(`seed ${seed} junctions ${lab}: tributary vs course below (50 m, rillGate): ${stats(sel.map((j) => j.ang50))}`);
      console.log(`seed ${seed} junctions ${lab}: branch angle (vs main arm above, Seybold): ${stats(sel.map((j) => j.branch))}`);
      const angs = sel.map((j) => j.ang);
      console.log(`seed ${seed} junctions ${lab}: both arms on a grid axis ${sel.filter((j) => j.grid).length} (${((100 * sel.filter((j) => j.grid).length) / Math.max(1, sel.length)).toFixed(1)} %, natural 1.2 %); angle within 3 deg of 45/90/135: ${((100 * near(angs, [45, 90, 135], 3)) / Math.max(1, angs.length)).toFixed(1)} % (natural 6.7 % of 0-180 for a flat spread)`);
      const hist = new Array(18).fill(0); for (const a of angs) hist[Math.min(17, Math.floor(a / 10))]++;
      console.log(`seed ${seed} junctions ${lab} hist10: ${hist.join(' ')}`);
    }
    for (const r of runs) console.log(r);
    for (const j of J) allJ.push(JSON.stringify({ seed, ...j }));
    if (env.JP_OUT) fs.writeFileSync(`${env.JP_OUT}.${seed}`, J.map((j) => JSON.stringify({ seed, ...j })).join('\n') + '\n');
  }
  if (env.JP_OUT) fs.writeFileSync(env.JP_OUT, allJ.join('\n') + '\n');
  setWorldSeed(0);
});
