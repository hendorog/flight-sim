// cornerGate (round T, from inv-junctions' invJunctionsTraced with inv-vjunctions' mouth fix): how far the traced lines (hydrology.rivers: rivers, gully-chain streams, other streams)
// follow the 250 m raster, per class and per ground class (floor / V / no chain, as streamTurns):
//  - grid share: course length whose heading over a 250 m chord (centred) lies within GRID_TOL deg of a multiple of
//    45 deg, against 2.5/22.5 = 11.1 % for a natural course (uniform headings);
//  - straight grid runs: stretches whose 250 m chord heading stays within GRID_TOL of the same axis for >= 500 m;
//  - corners: turns > 60 deg between the 100 m before and after a sample (no junction within 100 m), and those whose legs
//    are each straight (the heading over 250..50 m before agrees with 50..0 m before within 15 deg, same after);
//  - staircases: >= 3 corners (> 35 deg at 100 m chords) alternating in sign, each within 600 m of the last;
//  - raster pin: samples within 1 m of a 250 m raster point;
//  - mouths: angle between a stream's last 100 m and its receiver's next 100 m, with the receiver's 100 m before too.
// Writes out/fs/inv/junctions/traced-<seed>.json (per-site lists) when JT_OUT is set.
// Round T adds a short-wave wiggle term (JT_WIG, m): the course's lateral offset from its own chord over +-25/50/75 m
// (wavelengths about 100-300 m), max of the three, at each sample. A ruler-straight window (G1) or a grid run's sample
// (G2) counts only where that wiggle's rms over it is under JT_WIG ('w' figures): the owner-liked line 517 and f3's
// wandered courses wiggle 5-17 m and read as winding. And a GATE summary per seed: C2's barbed (> 120 deg) and 80-90 deg
// mouths, non-chain floor staircases and grid share; G1/G2 raw and with the wiggle term; line 517's elbow (seed 42).
//   JT_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts cornerGate --reporter=verbose
import { it } from 'vitest';
import { hydrology, naturalHeightSmooth, terrainHeight } from '../../src/world/terrain/heightfield';
import { gullyNear, gullyNet, inV, type GullyHit } from '../../src/world/terrain/gullies';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: string): void; mkdirSync(p: string, o: unknown): void };
type Line = { north: Float64Array; east: Float64Array; s: Float64Array; area?: Float64Array; kind?: number; joins?: number; joinS?: number; chainS?: number; pool?: number; continued?: boolean };
const GRID_TOL = Number(env.JT_TOL ?? 2.5);
const D = 180 / Math.PI;
it('corner gate', () => {
  for (const seed of (env.JT_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const g = gullyNet();
    const L = (hydrology.rivers ?? []) as unknown as Line[];
    const hit: GullyHit = { dist: 0, area: 0, node: -1, t: 0 };
    const keys = new Set<string>();
    for (const r of L) for (const k of Object.keys(r)) keys.add(k);
    console.log(`seed ${seed}: ${L.length} lines; fields ${[...keys].join(',')}`);
    const at = (r: Line, s: number): [number, number] => {
      const m = r.s.length;
      if (s <= 0) return [r.north[0], r.east[0]];
      if (s >= r.s[m - 1]) return [r.north[m - 1], r.east[m - 1]];
      let lo = 0, hi = m - 1; while (hi - lo > 1) { const md = (lo + hi) >> 1; if (r.s[md] <= s) lo = md; else hi = md; }
      const t = (s - r.s[lo]) / Math.max(1e-9, r.s[hi] - r.s[lo]);
      return [r.north[lo] + (r.north[hi] - r.north[lo]) * t, r.east[lo] + (r.east[hi] - r.east[lo]) * t];
    };
    const hd = (a: [number, number], b: [number, number]): number => Math.atan2(b[1] - a[1], b[0] - a[0]);
    const dAng = (a: number, b: number): number => { let d = Math.abs(a - b) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d; return d; };
    const sAng = (a: number, b: number): number => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
    /** Deviation from the nearest multiple of 45 deg, deg; and that axis (0..3, direction folded). */
    const axis = (h: number): [number, number] => { const deg = ((h * D) % 180 + 180) % 180; const k = Math.round(deg / 45); return [Math.abs(deg - k * 45), k % 4]; };
    // The gully-chain streams are one block of the streams (streams.ts traceStreams: after the outlets, headwaters (head
    // 6 km²) and feeders (5 km²), before the continuations): report.chains.traced of them from the first stream after
    // the last head or feeder.
    const rep = hydrology.streamReport as unknown as { chains?: { traced: number } };
    const nR = L.filter((r) => (r.kind ?? 0) === 0).length;
    let cs = nR;
    for (let i = nR; i < L.length; i++) { const a0 = L[i].area?.[0] ?? 0; if (Math.abs(a0 - 5) < 1e-6 || Math.abs(a0 - 6) < 1e-6) cs = i + 1; else if (a0 >= 9.95 && a0 < 10.05 && i > cs + 30) break; }
    const ce = cs + (rep.chains?.traced ?? 0);
    let bad = 0; for (let i = cs; i < ce; i++) { const a0 = L[i]?.area?.[0] ?? 0; if (!(a0 >= 9.95 && a0 < 40)) bad++; }
    console.log(`seed ${seed}: rivers ${nR}, chain block ${cs}..${ce - 1} (${ce - cs}; ${bad} with a head outside 10-40 km²)`);
    const cls = (r: Line): string => {
      if ((r.kind ?? 0) === 0) return 'river';
      const i = L.indexOf(r);
      if (i >= cs && i < ce) return 'chain';
      if (i >= ce) return 'cont';
      const a0 = r.area?.[0] ?? 0;
      return Math.abs(a0 - 6) < 1e-6 ? 'head' : Math.abs(a0 - 5) < 1e-6 ? 'feeder' : 'outlet';
    };
    // Junction points (for "no junction within 100 m"): every stream's mouth on its receiver.
    // (hydrology.rivers carries no joinS: the junction is the receiver's sample nearest the stream's last point.)
    const joinAt = new Map<number, { s: number; d: number }>();
    L.forEach((r, li) => {
      if (r.joins === undefined || r.joins < 0) return;
      const T = L[r.joins]; if (!T) return;
      const m = r.s.length, pn = r.north[m - 1], pe = r.east[m - 1];
      let best = Infinity, bs = 0;
      for (let i = 0; i < T.s.length; i++) { const d = Math.hypot(T.north[i] - pn, T.east[i] - pe); if (d < best) { best = d; bs = T.s[i]; } }
      joinAt.set(li, { s: bs, d: best });
    });
    const mouthsOn = new Map<number, number[]>();
    L.forEach((r, li) => { const j = joinAt.get(li); if (j && j.d < 300) (mouthsOn.get(r.joins!) ?? mouthsOn.set(r.joins!, []).get(r.joins!)!).push(j.s); });
    const acc: Record<string, { km: number; grid: number; run500: number; corners: number; sqCorners: number; stair: number; pin: number; n: number; ruler: number; rulerW: number; run500W: number }> = {};
    const A = (k: string) => (acc[k] ??= { km: 0, grid: 0, run500: 0, corners: 0, sqCorners: 0, stair: 0, pin: 0, n: 0, ruler: 0, rulerW: 0, run500W: 0 });
    const WIG = Number(env.JT_WIG ?? 3);
    let wig: Float64Array = new Float64Array(0);
    const runSites: string[] = [], stairSites: string[] = [], sqSites: string[] = [];
    const runList: { seed: number; line: number; cls: string; ground: string; n: number; e: number; len: number; axis: number; i0: number; i1: number; valley?: string; vdev?: number; vrms?: number; off?: number }[] = [];
    const stairList: { seed: number; line: number; cls: string; ground: string; n: number; e: number; len: number; corners: number }[] = [];
    L.forEach((r, li) => {
      const m = r.s.length; if (m < 3) return;
      const c = cls(r);
      const total = r.s[m - 1];
      const ground: string[] = new Array(m);
      for (let i = 0; i < m; i++) {
        let gc = 'nochain';
        if (g) { gullyNear(g, r.north[i], r.east[i], 1, 200, hit); if (Number.isFinite(hit.dist)) gc = inV(g, hit.node) ? 'V' : 'floor'; }
        ground[i] = gc;
      }
      // Short-wave wiggle at each sample: the lateral offset from the chord over +-25, 50, 75 m (max).
      wig = new Float64Array(m);
      for (let i = 0; i < m; i++) {
        let w = 0;
        for (const hh of [25, 50, 75]) {
          if (r.s[i] < hh || r.s[i] > total - hh) continue;
          const a = at(r, r.s[i] - hh), b = at(r, r.s[i] + hh);
          const cl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          w = Math.max(w, Math.abs((r.north[i] - a[0]) * (b[1] - a[1]) - (r.east[i] - a[1]) * (b[0] - a[0])) / cl);
        }
        wig[i] = w;
      }
      const wigRms = (i0: number, i1: number): number => { let a = 0, c = 0; for (let k = Math.max(0, i0); k <= Math.min(m - 1, i1); k++) { a += wig[k] * wig[k]; c++; } return Math.sqrt(a / Math.max(1, c)); };
      const mo = mouthsOn.get(li) ?? [];
      const nearJ = (s: number): boolean => mo.some((x) => Math.abs(x - s) < 100) || s > total - 100 || s < 100;
      // Per sample: grid share, runs.
      let runAxis = -1, runS0 = 0, runI0 = 0;
      const closeRun = (i: number): void => {
        if (runAxis < 0) return;
        const len = r.s[i] - runS0;
        if (len >= 500) {
          const im = Math.floor((runI0 + i) / 2);
          const gc = ground[im];
          A(`${c} ${gc}`).run500 += len / 1000;
          // (With the wiggle term: the run's samples whose rms wiggle over +-250 m is under WIG.)
          { let w = 0; for (let k = runI0; k < i; k++) { let k0 = k, k1 = k; while (k0 > 0 && r.s[k] - r.s[k0] < 250) k0--; while (k1 < m - 1 && r.s[k1] - r.s[k] < 250) k1++; if (wigRms(k0, k1) < WIG) w += r.s[k + 1] - r.s[k]; } A(`${c} ${gc}`).run500W += w / 1000; }
          runList.push({ seed, line: li, cls: c, ground: gc, n: Math.round(r.north[im]), e: Math.round(r.east[im]), len: Math.round(len), axis: runAxis * 45, i0: runI0, i1: i });
        }
        runAxis = -1;
      };
      for (let i = 0; i < m - 1; i++) {
        const seg = r.s[i + 1] - r.s[i];
        const k = `${c} ${ground[i]}`;
        const a = A(k);
        a.km += seg / 1000; a.n++;
        const px = ((r.north[i] % 250) + 250) % 250, py = ((r.east[i] % 250) + 250) % 250;
        if (Math.min(px, 250 - px) < 1 && Math.min(py, 250 - py) < 1) a.pin++;
        const sm = r.s[i];
        if (sm >= 125 && sm <= total - 125) {
          const h = hd(at(r, sm - 125), at(r, sm + 125));
          const [dev, ax] = axis(h);
          if (dev < GRID_TOL) a.grid += seg / 1000;
          if (dev < GRID_TOL) { if (runAxis !== ax) { closeRun(i); runAxis = ax; runS0 = sm; runI0 = i; } } else closeRun(i);
        } else closeRun(i);
      }
      closeRun(m - 1);
      // Ruler-straight: samples covered by a 1 km window of the course that keeps within RULER_DEV m of its chord.
      {
        const RD = Number(env.JT_RULER ?? 10), WL = 1000;
        const cover = new Uint8Array(m);
        for (let i0 = 0; i0 < m; i0++) {
          let i1 = i0; while (i1 < m - 1 && r.s[i1] - r.s[i0] < WL) i1++;
          if (r.s[i1] - r.s[i0] < WL * 0.95) break;
          const an = r.north[i0], ae = r.east[i0], bn = r.north[i1], be = r.east[i1];
          const cl = Math.hypot(bn - an, be - ae) || 1;
          let ok = true;
          for (let k = i0 + 1; k < i1 && ok; k++) { const d = Math.abs((r.north[k] - an) * (be - ae) - (r.east[k] - ae) * (bn - an)) / cl; if (d > RD) ok = false; }
          if (ok) for (let k = i0; k < i1; k++) cover[k] = 1;
          if (ok && wigRms(i0, i1) < WIG) for (let k = i0; k < i1; k++) cover[k] |= 2;
        }
        for (let i = 0; i < m - 1; i++) if (cover[i] & 1) A(`${c} ${ground[i]}`).ruler += (r.s[i + 1] - r.s[i]) / 1000;
        for (let i = 0; i < m - 1; i++) if (cover[i] & 2) A(`${c} ${ground[i]}`).rulerW += (r.s[i + 1] - r.s[i]) / 1000;
      }
      // Corners and staircases (100 m chords), away from mouths on this line.
      const corners: { s: number; sign: number; i: number }[] = [];
      for (let i = 1; i < m - 1; i++) {
        const sm = r.s[i];
        if (sm < 250 || sm > total - 250) continue;
        const p = at(r, sm);
        const h1 = hd(at(r, sm - 100), p), h2 = hd(p, at(r, sm + 100));
        const t = sAng(h1, h2);
        if (Math.abs(t) > 35 / D) corners.push({ s: sm, sign: Math.sign(t), i });
        if (Math.abs(t) > Math.PI / 3 && !nearJ(sm)) {
          const seg = r.s[i + 1] - r.s[i];
          const k = `${c} ${ground[i]}`;
          A(k).corners += seg / 100;
          const hb1 = hd(at(r, sm - 250), at(r, sm - 50)), hb2 = hd(at(r, sm - 50), p);
          const ha1 = hd(p, at(r, sm + 50)), ha2 = hd(at(r, sm + 50), at(r, sm + 250));
          if (dAng(hb1, hb2) < 15 / D && dAng(ha1, ha2) < 15 / D) {
            A(k).sqCorners += seg / 100;
            if (sqSites.length < 400) sqSites.push(`${seed} line ${li} ${c} ${ground[i]} at ${p[0].toFixed(0)},${p[1].toFixed(0)} turn ${(Math.abs(t) * D).toFixed(0)} legs ${(axis(hb1)[0]).toFixed(0)}/${(axis(ha2)[0]).toFixed(0)} off-axis`);
          }
        }
      }
      // A staircase: >= 3 alternating corners, consecutive ones within 600 m (one corner counted once per 100 m).
      const dedup: typeof corners = [];
      for (const cn of corners) { const l = dedup[dedup.length - 1]; if (l && cn.s - l.s < 100 && l.sign === cn.sign) continue; dedup.push(cn); }
      let j0 = 0;
      for (let j = 1; j <= dedup.length; j++) {
        const legOn = (a: number, b: number): boolean => axis(hd(at(r, dedup[a].s), at(r, dedup[b].s)))[0] < 5;
        const ok = j < dedup.length && dedup[j].s - dedup[j - 1].s <= 600 && dedup[j].sign === -dedup[j - 1].sign && legOn(j - 1, j);
        if (!ok) {
          if (j - j0 >= 3) {
            const len = dedup[j - 1].s - dedup[j0].s;
            const im = dedup[Math.floor((j0 + j - 1) / 2)].i;
            const gc = ground[im];
            A(`${c} ${gc}`).stair += len / 1000;
            stairList.push({ seed, line: li, cls: c, ground: gc, n: Math.round(r.north[im]), e: Math.round(r.east[im]), len: Math.round(len), corners: j - j0 });
          }
          j0 = j;
        }
      }
    });
    console.log(`seed ${seed} class ground: km | grid share % (natural 11.1) | straight grid runs >=500 m km | corners>60 per 100 km | square corners (straight legs) per 100 km | staircase km | raster-pinned samples %`);
    for (const k of Object.keys(acc).sort()) {
      const a = acc[k];
      if (a.km < 1) continue;
      console.log(`seed ${seed} ${k.padEnd(14)} ${a.km.toFixed(0).padStart(5)} km | grid ${((100 * a.grid) / a.km).toFixed(1).padStart(5)} % | runs ${a.run500.toFixed(1).padStart(5)} km | corners ${((100 * a.corners) / a.km).toFixed(1).padStart(5)} | square ${((100 * a.sqCorners) / a.km).toFixed(1).padStart(5)} | stair ${a.stair.toFixed(1).padStart(5)} km | pinned ${((100 * a.pin) / Math.max(1, a.n)).toFixed(1)} % | ruler-straight (1 km within ${env.JT_RULER ?? 10} m) ${((100 * a.ruler) / a.km).toFixed(1)} %`);
    }
    // Mouths.
    const mouthAng: { cls: string; recv: string; ang: number; branch: number; ta: number; ra: number; n: number; e: number; area: number }[] = [];
    let farMouths = 0;
    L.forEach((r, li) => {
      if (r.joins === undefined || r.joins < 0 || (r.kind ?? 0) === 0) return;
      const T = L[r.joins]; const m = r.s.length;
      if (!T || T.s.length < 3 || r.s[m - 1] < 150) return;
      const ja = joinAt.get(li);
      if (!ja || ja.d > 300) { farMouths++; return; }
      const js = ja.s;
      const tTot = T.s[T.s.length - 1];
      if (js + 100 > tTot) return;
      const jp = at(T, js);
      const hTrib = hd(at(r, r.s[m - 1] - 100), [r.north[m - 1], r.east[m - 1]]);
      const hDown = hd(jp, at(T, js + 100));
      const hUp = js >= 100 ? hd(at(T, js - 100), jp) : NaN;
      const ang = dAng(hTrib, hDown) * D;
      const branch = Number.isFinite(hUp) ? dAng(hTrib, hUp) * D : NaN;
      mouthAng.push({ cls: cls(r), recv: cls(T), ang, branch, ta: axis(hTrib)[0], ra: axis(hDown)[0], n: Math.round(jp[0]), e: Math.round(jp[1]), area: r.area?.[m - 1] ?? 0 });
      void li;
    });
    const stats = (v: number[]): string => { const x = v.filter(Number.isFinite).sort((a, b) => a - b); if (!x.length) return 'n 0'; const mean = x.reduce((a, b) => a + b, 0) / x.length; const sd = Math.sqrt(x.reduce((a, b) => a + (b - mean) ** 2, 0) / x.length); const q = (f: number) => x[Math.min(x.length - 1, Math.floor(f * x.length))].toFixed(0); return `n ${x.length} mean ${mean.toFixed(1)} sd ${sd.toFixed(1)} p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)} >60 ${((100 * x.filter((a) => a > 60).length) / x.length).toFixed(0)} % >80 ${((100 * x.filter((a) => a > 80).length) / x.length).toFixed(0)} %`; };
    console.log(`seed ${seed} mouths: ${farMouths} streams end more than 300 m from their receiver's course (not measured)`);
    for (const c of ['chain', 'head', 'feeder', 'outlet', 'cont', 'all']) {
      const sel = mouthAng.filter((m) => c === 'all' || m.cls === c);
      console.log(`seed ${seed} mouths ${c}: angle vs receiver downstream: ${stats(sel.map((m) => m.ang))}`);
      console.log(`seed ${seed} mouths ${c}: branch angle (vs receiver upstream arm): ${stats(sel.map((m) => m.branch))}`);
      const both = sel.filter((m) => m.ta < GRID_TOL && m.ra < GRID_TOL);
      const gridT = both.filter((m) => Math.abs(m.ang - 90) < 5 || Math.abs(m.ang - 45) < 5 || Math.abs(m.ang - 135) < 5);
      console.log(`seed ${seed} mouths ${c}: both arms on a grid axis (+-${GRID_TOL}) ${both.length} (${((100 * both.length) / Math.max(1, sel.length)).toFixed(0)} %, natural ${((100 * (GRID_TOL / 22.5) ** 2)).toFixed(1)} %), of them at 45/90/135 +-5: ${gridT.length}`);
      // 5-deg histogram of angle vs downstream
      const hist = new Array(36).fill(0); for (const m of sel) hist[Math.min(35, Math.floor(m.ang / 5))]++;
      console.log(`seed ${seed} mouths ${c} hist5: ${hist.join(' ')}`);
    }
    // Each straight grid run: is the valley it lies in (the low line of the routing ground, naturalHeightSmooth, in
    // cross-sections every 125 m, +-250 m at 10 m) on the same grid axis and straight? Then the landform itself runs on
    // the grid (hillslopes.ts); else only the stream does.
    const vacc: Record<string, { grid: number; off: number; n: number }> = {};
    for (const run of runList) {
      const r = L[run.line];
      const s0 = r.s[run.i0], s1 = r.s[run.i1];
      const h = hd(at(r, s0), at(r, s1));
      const un = -Math.sin(h), ue = Math.cos(h); // across (north, east of the unit normal)
      const pts: [number, number][] = [];
      let offSum = 0;
      for (let s = s0; s <= s1; s += 125) {
        const [pn, pe] = at(r, s);
        let best = Infinity, bo = 0;
        for (let o = -250; o <= 250; o += 10) { const z = naturalHeightSmooth(pn + un * o, pe + ue * o); if (z < best) { best = z; bo = o; } }
        pts.push([pn + un * bo, pe + ue * bo]);
        offSum += Math.abs(bo);
      }
      if (pts.length < 4) continue;
      // Principal direction of the low points; rms across it.
      const mn = pts.reduce((a, p) => a + p[0], 0) / pts.length, me = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      let snn = 0, see = 0, sne = 0; for (const p of pts) { snn += (p[0] - mn) ** 2; see += (p[1] - me) ** 2; sne += (p[0] - mn) * (p[1] - me); }
      const th = 0.5 * Math.atan2(2 * sne, snn - see); // angle from north
      const vh = Math.atan2(Math.sin(th), Math.cos(th));
      let rms = 0; for (const p of pts) { const d = -(p[0] - mn) * Math.sin(th) + (p[1] - me) * Math.cos(th); rms += d * d; } rms = Math.sqrt(rms / pts.length);
      // (heading as atan2(east, north) for axis(): th is from north towards east)
      const vdev = axis(Math.atan2(Math.sin(vh), Math.cos(vh)))[0];
      run.vdev = vdev; run.vrms = rms; run.off = offSum / pts.length;
      run.valley = vdev < 2.5 && rms < 25 ? 'valley-on-grid' : 'stream-only';
      const k = `${run.cls} ${run.ground} ${run.valley}`;
      const v = (vacc[k] ??= { grid: 0, off: 0, n: 0 }); v.grid += run.len / 1000; v.off += run.off; v.n++;
    }
    for (const k of Object.keys(vacc).sort()) console.log(`seed ${seed} runs ${k.padEnd(34)} ${vacc[k].grid.toFixed(1).padStart(6)} km in ${vacc[k].n} runs, stream off the valley's low line ${(vacc[k].off / vacc[k].n).toFixed(0)} m mean`);
    runList.sort((a, b) => b.len - a.len); stairList.sort((a, b) => b.len - a.len);
    for (const x of runList.slice(0, 16)) runSites.push(`   run ${x.len} m axis ${x.axis} line ${x.line} ${x.cls} ${x.ground} at ${x.n},${x.e} ${x.valley} (valley ${x.vdev?.toFixed(1)} deg off axis, rms ${x.vrms?.toFixed(0)} m)`);
    for (const x of stairList.slice(0, 12)) stairSites.push(`   stair ${x.len} m ${x.corners} corners line ${x.line} ${x.cls} ${x.ground} at ${x.n},${x.e}`);
    for (const s of runSites) console.log(s);
    for (const s of stairSites) console.log(s);
    // ---- GATE summary (round T) ----
    {
      const sum = (f: (k: string) => boolean, key: keyof (typeof acc)[string]): number => Object.keys(acc).filter(f).reduce((x, k) => x + (acc[k][key] as number), 0);
      const isCls = (c: string) => (k: string) => k.split(' ')[0] === c;
      const nonChainFloor = (k: string) => ['head', 'feeder', 'outlet', 'cont'].includes(k.split(' ')[0]) && k.split(' ')[1] === 'floor';
      const streamK = (k: string) => k.split(' ')[0] !== 'river';
      const all = mouthAng;
      const barbed = all.filter((x) => x.ang > 120), barbed20 = barbed.filter((x) => x.area >= 20), m8090 = all.filter((x) => x.ang >= 80 && x.ang < 90);
      console.log(`GATE seed ${seed} C2 mouths ${all.length}: barbed > 120 deg ${barbed.length} (${((100 * barbed.length) / Math.max(1, all.length)).toFixed(1)} %, ${barbed20.length} of them >= 20 km2) aim <= 4 %; 80-90 deg ${((100 * m8090.length) / Math.max(1, all.length)).toFixed(1)} % (NZ 6.5 %)`);
      const ncKm = sum(nonChainFloor, 'km');
      console.log(`GATE seed ${seed} C2 non-chain floor streams ${ncKm.toFixed(0)} km: staircases ${sum(nonChainFloor, 'stair').toFixed(1)} km (aim <= 2), grid share ${((100 * sum(nonChainFloor, 'grid')) / Math.max(1e-9, ncKm)).toFixed(1)} % (aim <= 20, NZ ~11), runs ${sum(nonChainFloor, 'run500').toFixed(1)} km`);
      for (const c of ['chain', 'river']) { const km = sum(isCls(c), 'km'); console.log(`GATE seed ${seed} C4 ${c} ruler-straight ${((100 * sum(isCls(c), 'ruler')) / Math.max(1e-9, km)).toFixed(1)} %, with the wiggle term (< ${WIG} m) ${((100 * sum(isCls(c), 'rulerW')) / Math.max(1e-9, km)).toFixed(1)} %; grid runs ${sum(isCls(c), 'run500').toFixed(0)} km (with wiggle ${sum(isCls(c), 'run500W').toFixed(0)} km)`); }
      { const f = (k: string) => streamK(k) && k.split(' ')[0] !== 'chain'; const km = sum(f, 'km'); console.log(`GATE seed ${seed} C4 non-chain streams ruler-straight ${((100 * sum(f, 'ruler')) / Math.max(1e-9, km)).toFixed(1)} %, with wiggle ${((100 * sum(f, 'rulerW')) / Math.max(1e-9, km)).toFixed(1)} %`); }
      console.log(`GATE seed ${seed} C4 traced streams ${sum(streamK, 'km').toFixed(0)} km: straight grid runs ${sum(streamK, 'run500').toFixed(0)} km, with the wiggle term ${sum(streamK, 'run500W').toFixed(0)} km; rivers ${sum(isCls('river'), 'run500').toFixed(0)} km`);
      if (seed === 42) {
        // Line 517 (the owner's winding stream): the stream line (A >= 50 at its end) passing nearest -13744,-42501.
        let bl = -1, bd = Infinity;
        L.forEach((r, li) => { if ((r.kind ?? 0) === 0 || (r.area?.[r.s.length - 1] ?? 0) < 50) return; for (let i = 0; i < r.s.length; i++) { const d = Math.hypot(r.north[i] + 13744, r.east[i] + 42501); if (d < bd) { bd = d; bl = li; } } });
        if (bl >= 0) {
          const r = L[bl]; const m = r.s.length; const total = r.s[m - 1];
          let kink = 0, kinkAt = '';
          for (let i = 1; i < m - 1; i++) { if (r.s[i] < total - 1500 || r.s[i] < 100 || r.s[i] > total - 100) continue; const p = at(r, r.s[i]); const t = dAng(hd(at(r, r.s[i] - 100), p), hd(p, at(r, r.s[i] + 100))) * D; if (t > kink) { kink = t; kinkAt = `${p[0].toFixed(0)},${p[1].toFixed(0)}`; } }
          const mm = mouthAng.find((x) => Math.hypot(x.n - r.north[m - 1], x.e - r.east[m - 1]) < 400 && x.area === (r.area?.[m - 1] ?? -1));
          console.log(`GATE seed 42 line 517 (now line ${bl}, ${bd.toFixed(0)} m from -13744,-42501; joins ${r.joins} kind ${L[r.joins ?? 0]?.kind}): sharpest turn over its last 1.5 km ${kink.toFixed(0)} deg at ${kinkAt}; mouth at ${r.north[m - 1].toFixed(0)},${r.east[m - 1].toFixed(0)} angle to the receiver downstream ${mm ? mm.ang.toFixed(0) : '?'} deg`);
        }
      }
    }
    if (env.JT_OUT) {
      fs.mkdirSync(env.JT_OUT, { recursive: true });
      fs.writeFileSync(`${env.JT_OUT}/traced-${seed}.json`, JSON.stringify({ acc, runs: runList, stairs: stairList, square: sqSites, mouths: mouthAng }));
    }
  }
  setWorldSeed(0);
});
