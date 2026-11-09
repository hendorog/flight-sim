// wallsGate (round T, from inv-walls' invWalls; part 1 off unless SCAN=1): where a river's water stands above the dry
// ground beside it. Group the JSON with out/fs/tools2/group.py.
//   SEED=42 OUT=out/fs/T0/walls-s42.json npx vitest run --config scripts/probes/vitest.config.ts wallsGate --silent=false --disable-console-intercept
// Default ACID spots: the owner's valley (-12000,-41933; -11800,-41800) and line 141 (-21504,-26494) on seed 42.
// Part 1 re-derives waterWalls' river edges > 10 m (a 50 m grid point in a channel, its 4-neighbour dry and > 10 m
// under the water) and splits them by what the neighbour really is:
//   sea-surface: the neighbour is the sea (ground < 0.5) and the water is within 10 m of the sea's surface (0 m);
//   fall: the line's own water at the neighbour's place on the course is within 10 m of the neighbour's top surface
//     (the 50 m step is the channel's own fall) and the water is not perched across the course at the wet point;
//   perched: the water stands > 10 m over the top surface 25 m beyond the channel's edge on one side, across the course;
//   both / other as the cross of the two tests.
// Part 2 is the honest gate: every line walked at WALK m; at each sample whose water is drawn (river field set, not
// under a lake), the top surface (max of ground, standing water incl. the sea at 0, any river) beside it against the
// line's own water at the nearest point of its course to each point looked at (so a bend or a fall is compared with
// the water beside it, not upstream of it): 'bank' DELTA m beyond the channel's edge; 'valley' walking out to REACH m
// until a bank CONTAIN m over the water holds it (see Part 2). Perched: > 10 m. Reported as km of course and reaches,
// with each reach's diagnostics and cause. SEED, HALF, STEP, WALK, DELTA, REACH, CONTAIN, GENTLE, ACID, SKIP_SCAN, OUT.
import { it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { hydrology, makeSample, naturalHeight, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

type Line = { north: Float64Array; east: Float64Array; level: Float64Array; halfWidth: Float64Array; s: Float64Array; kind?: number; area?: Float64Array; end?: string; joins?: number; gradient?: Float32Array; regime?: Uint8Array; cut?: Float64Array; breach?: Float64Array };

it('walls gate', () => {
  const seed = Number(process.env.SEED ?? 42);
  const HALF = Number(process.env.HALF ?? 150000);
  const STEP = Number(process.env.STEP ?? 50);
  const WALK = Number(process.env.WALK ?? 20);
  const DELTA = Number(process.env.DELTA ?? 25);
  const SKIP_SCAN = !process.env.SCAN;
  const OUT = process.env.OUT ?? `out/fs/inv/walls/walls-s${seed}.json`;
  if (process.env.NO_SETTLE) (globalThis as { __noSettle?: boolean }).__noSettle = true;
  if (process.env.NO_RAISE) (globalThis as { __noRaise?: boolean }).__noRaise = true;
  setWorldSeed(seed);
  const s = makeSample();
  const L = (hydrology.rivers ?? []) as unknown as Line[];
  const kindOf = (li: number) => ((L[li].kind ?? 0) === 0 ? 'river' : (L[li].area?.[0] ?? 0) >= 9.9 ? 'chain' : 'stream');
  const top = () => Math.max(s.ground, s.standing, s.river);
  // Nearest point of line li to (pn, pe), searched over segments [i0 - win, i0 + win].
  const near = { i: 0, t: 0, d: 0, level: 0, s: 0, hw: 0, side: 0 };
  const nearestOn = (li: number, pn: number, pe: number, i0 = -1, win = 1e9) => {
    const r = L[li];
    const m = r.north.length;
    const a = i0 < 0 ? 0 : Math.max(0, i0 - win);
    const b = i0 < 0 ? m - 2 : Math.min(m - 2, i0 + win);
    let best = Infinity;
    for (let i = a; i <= b; i++) {
      const dn = r.north[i + 1] - r.north[i], de = r.east[i + 1] - r.east[i];
      const l2 = dn * dn + de * de || 1;
      const t = Math.max(0, Math.min(1, ((pn - r.north[i]) * dn + (pe - r.east[i]) * de) / l2));
      const qn = r.north[i] + dn * t - pn, qe = r.east[i] + de * t - pe;
      const d = qn * qn + qe * qe;
      if (d < best) {
        best = d;
        near.i = i; near.t = t; near.d = Math.sqrt(d);
        near.level = r.level[i] + (r.level[i + 1] - r.level[i]) * t;
        near.s = r.s[i] + (r.s[i + 1] - r.s[i]) * t;
        near.hw = r.halfWidth[i] + (r.halfWidth[i + 1] - r.halfWidth[i]) * t;
        near.side = Math.sign(dn * (pe - r.east[i]) - de * (pn - r.north[i]));
      }
    }
    return near;
  };
  const tangent = (li: number, i: number) => {
    const r = L[li];
    const m = r.north.length;
    const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 2);
    const tn = r.north[b] - r.north[a], te = r.east[b] - r.east[a];
    const tl = Math.hypot(tn, te) || 1;
    return [tn / tl, te / tl];
  };
  // The line's water gradient over +-100 m of course about sample i (m/m, positive falling).
  const gradAt = (li: number, i: number) => {
    const r = L[li];
    const m = r.north.length;
    let a = i, b = i;
    while (a > 0 && r.s[i] - r.s[a] < 100) a--;
    while (b < m - 1 && r.s[b] - r.s[i] < 100) b++;
    return (r.level[a] - r.level[b]) / Math.max(1, r.s[b] - r.s[a]);
  };
  // Water over the top surface DELTA m beyond the channel's edge on each side of the course at (li, i, t), against
  // the line's own water nearest the side point. Returns [left, right] and keeps the side points.
  const sidePts: Array<[number, number, number, number]> = [[0, 0, 0, 0], [0, 0, 0, 0]];
  const lateral = (li: number, i: number, cn: number, ce: number, hw: number, delta: number): [number, number] => {
    const [tn, te] = tangent(li, i);
    const res: [number, number] = [0, 0];
    for (let k = 0; k < 2; k++) {
      const sg = k === 0 ? -1 : 1;
      const off = hw + delta;
      const pn = cn + sg * te * off, pe = ce - sg * tn * off;
      sampleTerrain(pn, pe, s);
      const tp = top();
      const lv = nearestOn(li, pn, pe, i, 80).level;
      res[k] = lv - tp;
      sidePts[k] = [pn, pe, tp, s.ground];
    }
    return res;
  };

  const out: Record<string, unknown> = { seed };

  // ---------------- Part 1: waterWalls' river edges > 10 m, re-split ----------------
  if (!SKIP_SCAN) {
    const n = Math.round((2 * HALF) / STEP) + 1;
    const mk = () => ({ g: new Float32Array(n), w: new Float32Array(n), r: new Float32Array(n), st: new Float32Array(n) });
    let prev = mk(), cur = mk();
    const fillRow = (row: ReturnType<typeof mk>, y: number) => {
      const north = HALF - y * STEP;
      for (let x = 0; x < n; x++) {
        sampleTerrain(north, -HALF + x * STEP, s);
        row.g[x] = s.ground;
        row.st[x] = s.standing;
        row.w[x] = s.standing > s.ground + 0.05 && s.standing > 0.5 ? s.standing : -Infinity;
        row.r[x] = s.river;
      }
    };
    const edges: Array<{ pn: number; pe: number; qn: number; qe: number; R: number; gQ: number; topQ: number }> = [];
    const rcheck = (Rv: number, row: ReturnType<typeof mk>, x: number, pn: number, pe: number, qn: number, qe: number) => {
      if (row.r[x] > -Infinity || row.w[x] > -Infinity) return;
      const h = Rv - row.g[x];
      if (h > 10) edges.push({ pn, pe, qn, qe, R: Rv, gQ: row.g[x], topQ: Math.max(row.g[x], row.st[x]) });
    };
    for (let y = 0; y < n; y++) {
      fillRow(cur, y);
      const north = HALF - y * STEP;
      for (let x = 0; x < n; x++) {
        const east = -HALF + x * STEP;
        if (x + 1 < n) {
          if (cur.r[x] > -Infinity) rcheck(cur.r[x], cur, x + 1, north, east, north, east + STEP);
          if (cur.r[x + 1] > -Infinity) rcheck(cur.r[x + 1], cur, x, north, east + STEP, north, east);
        }
        if (y > 0) {
          if (prev.r[x] > -Infinity) rcheck(prev.r[x], cur, x, north + STEP, east, north, east);
          if (cur.r[x] > -Infinity) rcheck(cur.r[x], prev, x, north, east, north + STEP, east);
        }
      }
      [prev, cur] = [cur, prev];
    }
    const hit = { dist: Infinity, side: 0, line: -1, kind: 0, index: 0, s: 0, level: 0, halfWidth: 0, gradient: 0, steepness: 0, regime: 0, speed: 0, dirN: 0, dirE: 0 };
    const cls: Record<string, number> = {};
    const ws: Record<string, number> = {};
    const cross: Record<string, number> = {};
    const fallGrad: number[] = [];
    const perchedPts: Array<[number, string]> = [];
    for (const e of edges) {
      // wallSplit's own class, for the cross table.
      hydrology.queryFlow!(e.pn, e.pe, hit as never);
      let w = 'none', mine = 'none';
      if (hit.line >= 0) {
        const li = hit.line;
        const kind = kindOf(li);
        const lvP = hit.level;
        const h2 = { ...hit };
        hydrology.queryFlow!(e.qn, e.qe, h2 as never);
        const lvlQ = h2.line === li ? h2.level : lvP;
        if (e.gQ < 0.5) w = 'sea';
        else if (lvlQ - e.gQ <= 10) w = 'along';
        else w = 'beside';
        // Mine.
        const f = nearestOn(li, e.pn, e.pe);
        const fi = f.i, ft = f.t, fs = f.s;
        const r = L[li];
        const cn = r.north[fi] + (r.north[fi + 1] - r.north[fi]) * ft;
        const ce = r.east[fi] + (r.east[fi + 1] - r.east[fi]) * ft;
        const hw = f.hw;
        const lat = lateral(li, fi, cn, ce, hw, DELTA);
        const latMax = Math.max(lat[0], lat[1]);
        const q = nearestOn(li, e.qn, e.qe, fi, 80);
        const remaining = q.level - e.topQ;
        const ds = Math.abs(q.s - fs);
        if (e.gQ < 0.5) mine = e.R - Math.max(e.topQ, 0) > 10 ? 'sea-raised' : 'sea-surface';
        else if (remaining <= 10 && latMax <= 10) mine = 'fall';
        else if (remaining <= 10) mine = 'fall+perched';
        else if (latMax > 10) mine = 'perched';
        else {
          // Not perched at the bank: the neighbour ~50 m out is low. Across a face (one side over the water, the other
          // under it, the line steep) or past the bank (both sides low further out: a nose or a bench).
          const l50 = lateral(li, fi, cn, ce, hw, 50);
          const g = Math.abs(gradAt(li, fi));
          const opp = Math.min(lat[0], lat[1]) < -2 && Math.max(l50[0], l50[1]) > 10;
          mine = g >= 0.05 && opp ? 'other-crossSlope' : Math.max(l50[0], l50[1]) > 10 ? 'other-beyondBank' : 'other-rest';
        }
        if (mine === 'fall') fallGrad.push((e.R - q.level) / Math.max(1, ds));
        if (mine === 'perched' || mine === 'fall+perched' || mine === 'other') perchedPts.push([latMax, `${mine} ${e.pn},${e.pe} line ${li} ${kind} lat ${lat[0].toFixed(0)}/${lat[1].toFixed(0)} remQ ${remaining.toFixed(0)} ds ${ds.toFixed(0)}`]);
        mine = `${kind} ${mine}`;
        w = `${kind} ${w}`;
      }
      ws[w] = (ws[w] ?? 0) + 1;
      cls[mine] = (cls[mine] ?? 0) + 1;
      const c = `${w.split(' ')[1]} -> ${mine.split(' ')[1]}`;
      cross[c] = (cross[c] ?? 0) + 1;
    }
    fallGrad.sort((a, b) => a - b);
    perchedPts.sort((a, b) => b[0] - a[0]);
    const q = (p: number) => fallGrad.length ? fallGrad[Math.floor(p * (fallGrad.length - 1))].toFixed(2) : '-';
    console.log(`PART1 seed ${seed}: river edges > 10 m ${edges.length}`);
    console.log(`  wallSplit classes: ${JSON.stringify(Object.fromEntries(Object.entries(ws).sort()))}`);
    console.log(`  re-split: ${JSON.stringify(Object.fromEntries(Object.entries(cls).sort()))}`);
    console.log(`  cross (wallSplit -> mine): ${JSON.stringify(Object.fromEntries(Object.entries(cross).sort()))}`);
    console.log(`  'fall' edges: the line's own drop over the edge per metre of course, p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)}`);
    console.log(`  worst laterally perched edges: ${perchedPts.slice(0, 12).map(([h, a]) => `${h.toFixed(0)} m ${a}`).join('; ')}`);
    out.part1 = { edges: edges.length, wallSplit: ws, mine: cls, cross };
  }

  // ---------------- Part 2: the honest gate, walking every line ----------------
  // bank: the water > 10 m over the top surface DELTA m beyond the channel's edge (either side).
  // valley: walking out from the edge (10, 35, 60 .. REACH m beyond it) until the top surface stands CONTAIN m over the
  //   water (a bank or wall holds it), some walked point lies > 10 m under the line's own water nearest it: the water
  //   stands over a floor it could spill to (a bench, a valley side, a ridge). Rivers everywhere; streams and chains
  //   where their water falls under GENTLE (m/m over +-100 m); steeper ones are counted apart as 'cross' (a stream across
  //   a face rather than down it), not as raised water.
  const CONTAIN = Number(process.env.CONTAIN ?? 10);
  const REACH = Number(process.env.REACH ?? 400);
  const GENTLE = Number(process.env.GENTLE ?? 0.05);
  const W = { h: -Infinity, first: 0, at: 0, pn: 0, pe: 0, top: 0, ground: 0, river: false, standing: false };
  const valleyWalk = (li: number, i: number, cn: number, ce: number, hw: number, lv: number, sg: number, tn: number, te: number, trace?: string[]) => {
    W.h = -Infinity; W.first = 0; W.at = 0;
    for (let d = 10; d <= REACH; d += 25) {
      const off = hw + d;
      const pn = cn + sg * te * off, pe = ce - sg * tn * off;
      sampleTerrain(pn, pe, s);
      const tp = top();
      let h = lv - tp;
      if (h > 10) h = nearestOn(li, pn, pe, i, 400).level - tp;
      if (trace) trace.push(`${d}:${h.toFixed(0)}`);
      if (h > W.h) { W.h = h; W.at = off; W.pn = pn; W.pe = pe; W.top = tp; W.ground = s.ground; W.river = s.river > -Infinity; W.standing = s.standing > s.ground + 0.05; }
      if (h > 10 && !W.first) W.first = off;
      if (tp > lv + CONTAIN) break;
    }
    return W.h;
  };
  // Acid test: the walk at given points (nearest line), printed.
  for (const p of (process.env.ACID ?? (seed === 42 ? '-12000,-41933;-11800,-41800;-21504,-26494' : '')).split(';').filter(Boolean)) {
    const [an, ae] = p.split(',').map(Number);
    let bl = -1, bd = Infinity, bi = 0;
    for (let li = 0; li < L.length; li++) { const q = nearestOn(li, an, ae); if (q.d < bd) { bd = q.d; bl = li; bi = q.i; } }
    const q = nearestOn(bl, an, ae);
    const r = L[bl];
    const cn = r.north[q.i] + (r.north[q.i + 1] - r.north[q.i]) * q.t, ce = r.east[q.i] + (r.east[q.i + 1] - r.east[q.i]) * q.t;
    const lv = q.level, hw = q.hw;
    const [tn, te] = tangent(bl, bi);
    for (const sg of [-1, 1]) {
      const tr: string[] = [];
      const h = valleyWalk(bl, bi, cn, ce, hw, lv, sg, tn, te, tr);
      console.log(`ACID ${p}: line ${bl} ${kindOf(bl)} lvl ${lv.toFixed(1)} hw ${hw.toFixed(1)} grad ${gradAt(bl, bi).toFixed(3)} side ${sg}: worst ${h.toFixed(1)} m at ${W.at.toFixed(0)} m (first > 10 m at ${W.first.toFixed(0)}); walk ${tr.join(' ')}`);
    }
  }
  type Smp = { li: number; i: number; sArc: number; n: number; e: number; lv: number; hw: number; grad: number; bank: number; lat: [number, number]; valley: number; vFirst: number; vAt: number; vPt: [number, number, number, number]; vRiver: boolean; vStanding: boolean; cls: string };
  let drawn = 0, hidden = 0, inLake = 0;
  const kmBy: Record<string, number> = {};
  const add = (k: string, v: number) => { kmBy[k] = (kmBy[k] ?? 0) + v; };
  type Reach = { li: number; kind: string; group: string; s0: number; s1: number; len: number; worst: Smp; h: number; nBank: number; nValley: number; nCross: number };
  const reaches: Reach[] = [];
  for (let li = 0; li < L.length; li++) {
    const r = L[li];
    const m = r.north.length;
    const kind = kindOf(li);
    const open: Record<string, { s0: number; s1: number; worst: Smp; h: number; last: number; nBank: number; nValley: number; nCross: number } | null> = { raised: null, cross: null };
    const close = (g: string) => { const o = open[g]; if (o) { reaches.push({ li, kind, group: g, s0: o.s0, s1: o.s1, len: o.s1 - o.s0 + WALK, worst: o.worst, h: o.h, nBank: o.nBank, nValley: o.nValley, nCross: o.nCross }); open[g] = null; } };
    for (let i = 0; i < m - 1; i++) {
      const seg = r.s[i + 1] - r.s[i];
      const k1 = Math.max(1, Math.ceil(seg / WALK));
      const grad = gradAt(li, i);
      const [tn, te] = tangent(li, i);
      for (let k = 0; k < k1; k++) {
        const t = k / k1;
        const cn = r.north[i] + (r.north[i + 1] - r.north[i]) * t;
        const ce = r.east[i] + (r.east[i + 1] - r.east[i]) * t;
        const lv = r.level[i] + (r.level[i + 1] - r.level[i]) * t;
        const hw = r.halfWidth[i] + (r.halfWidth[i + 1] - r.halfWidth[i]) * t;
        const sArc = r.s[i] + seg * t;
        sampleTerrain(cn, ce, s);
        if (s.standing > s.ground + 0.05) { inLake++; continue; }
        if (s.river === -Infinity) { hidden++; continue; }
        drawn++;
        const step = seg / k1;
        add(`${kind} drawn`, step / 1000);
        const lat = lateral(li, i, cn, ce, hw, DELTA);
        const bank = Math.max(lat[0], lat[1]);
        let valley = -Infinity, vFirst = 0, vAt = 0, vPt: [number, number, number, number] = [0, 0, 0, 0], vRiver = false, vStanding = false;
        for (const sg of [-1, 1]) {
          const h = valleyWalk(li, i, cn, ce, hw, lv, sg, tn, te);
          if (h > valley) { valley = h; vFirst = W.first; vAt = W.at; vPt = [W.pn, W.pe, W.top, W.ground]; vRiver = W.river; vStanding = W.standing; }
        }
        let cls = '';
        if (bank > 10) cls = 'bank';
        else if (valley > 10 && (kind === 'river' || Math.abs(grad) < GENTLE)) cls = 'valley';
        else if (valley > 10) cls = 'cross';
        if (!cls) continue;
        const h = cls === 'bank' ? bank : valley;
        add(`${kind} ${cls} >10`, step / 1000);
        if (h > 30) add(`${kind} ${cls} >30`, step / 1000);
        const smp: Smp = { li, i, sArc, n: cn, e: ce, lv, hw, grad, bank, lat, valley, vFirst, vAt, vPt, vRiver, vStanding, cls };
        const g = cls === 'cross' ? 'cross' : 'raised';
        const o = open[g];
        if (o && sArc - o.last <= 3 * WALK) {
          o.s1 = sArc; o.last = sArc;
          if (h > o.h) { o.h = h; o.worst = smp; }
        } else {
          close(g);
          open[g] = { s0: sArc, s1: sArc, worst: smp, h, last: sArc, nBank: 0, nValley: 0, nCross: 0 };
        }
        const oo = open[g]!;
        if (cls === 'bank') oo.nBank++; else if (cls === 'valley') oo.nValley++; else oo.nCross++;
      }
    }
    close('raised');
    close('cross');
  }
  reaches.sort((a, b) => b.h - a.h);
  const hit = { dist: Infinity, side: 0, line: -1, kind: 0, index: 0, s: 0, level: 0, halfWidth: 0, gradient: 0, steepness: 0, regime: 0, speed: 0, dirN: 0, dirE: 0 };
  const rows = reaches.map((R0) => {
    const w = R0.worst;
    const r = L[w.li];
    const natC = naturalHeight(w.n, w.e);
    sampleTerrain(w.n, w.e, s);
    const gC = s.ground;
    // The flagged point: the bank side point or the valley walk's worst point.
    const bankSide = w.lat[0] >= w.lat[1] ? 0 : 1;
    let fp: [number, number, number, number];
    if (w.cls === 'bank') {
      const [tn, te] = tangent(w.li, w.i);
      const sg = bankSide === 0 ? -1 : 1;
      const off = w.hw + DELTA;
      const pn = w.n + sg * te * off, pe = w.e - sg * tn * off;
      sampleTerrain(pn, pe, s);
      fp = [pn, pe, top(), s.ground];
    } else fp = w.vPt;
    sampleTerrain(fp[0], fp[1], s);
    const fRiver = s.river > -Infinity, fStanding = s.standing > s.ground + 0.05;
    const natF = naturalHeight(fp[0], fp[1]);
    // The cross-section, top surface less the water, every 25 m from -400 to 400 m.
    const [tn, te] = tangent(w.li, w.i);
    const prof: number[] = [];
    for (let o = -400; o <= 400; o += 25) { sampleTerrain(w.n + te * o, w.e - tn * o, s); prof.push(Math.round(top() - w.lv)); }
    hydrology.queryFlow!(w.n, w.e, hit as never);
    let lakeUp = -1, lakeLv = NaN;
    for (let j = w.i; j >= 0 && r.s[w.i] - r.s[j] < 2000; j--) {
      sampleTerrain(r.north[j], r.east[j], s);
      if (s.standing > s.ground + 0.05 && s.standing > 0.5) { lakeUp = r.s[w.i] - r.s[j]; lakeLv = s.standing; break; }
    }
    // Other lines whose channel (within its half-width + 30 m) the reach's worst point or flagged point lies by.
    const others: number[] = [];
    for (let lj = 0; lj < L.length; lj++) {
      if (lj === w.li) continue;
      const a = nearestOn(lj, fp[0], fp[1]);
      if (a.d < a.hw + 30) others.push(lj);
      if (others.length > 3) break;
    }
    let cause = '';
    if (fp[2] <= 0.5 && fp[3] < 0) cause = 'sea';
    else if (gC < w.lv - 10) cause = 'overGround';
    else if (fRiver || fStanding) cause = fStanding ? 'lakeBeside' : 'lowerLineBeside';
    else if (lakeUp >= 0 && Math.abs(lakeLv - w.lv) < 1) cause = 'lakeHeld';
    else if (w.lv > natC + 2) cause = 'aboveNatural';
    else if (w.cls === 'valley') cause = 'bench';
    else if (w.cls === 'cross') cause = 'crossSlope';
    else cause = 'bankLow';
    return {
      seed, group: R0.group, cls: w.cls, cause, line: w.li, kind: R0.kind, end: r.end ?? '', joins: r.joins ?? -1, area: +(r.area?.[w.i] ?? 0).toFixed(2), areaHead: +(r.area?.[0] ?? 0).toFixed(2),
      at: [Math.round(w.n), Math.round(w.e)], flagAt: [Math.round(fp[0]), Math.round(fp[1])], flagDist: Math.round(w.cls === 'bank' ? w.hw + DELTA : w.vAt),
      h: +R0.h.toFixed(1), len: Math.round(R0.len), nBank: R0.nBank, nValley: R0.nValley, nCross: R0.nCross, s0: Math.round(R0.s0), sWorst: Math.round(w.sArc), lineLen: Math.round(r.s[r.s.length - 1]),
      level: +w.lv.toFixed(1), hw: +w.hw.toFixed(1), grad: +w.grad.toFixed(3), bank: w.lat.map((x) => +x.toFixed(1)), valley: +w.valley.toFixed(1), vFirst: Math.round(w.vFirst),
      groundC: +gC.toFixed(1), natC: +natC.toFixed(1), flagTop: +fp[2].toFixed(1), flagGround: +fp[3].toFixed(1), natFlag: +natF.toFixed(1), fRiver, fStanding, others,
      regime: hit.regime, cut: +(r.cut?.[w.i] ?? 0).toFixed(1), lakeUp: Math.round(lakeUp), lakeLv: +lakeLv.toFixed(1), prof: prof.join(' '),
    };
  });
  const tot = (k: string) => (kmBy[k] ?? 0).toFixed(2);
  console.log(`PART2 seed ${seed}: walked at ${WALK} m; samples drawn ${drawn}, hidden (ground over the water) ${hidden}, under a lake ${inLake}`);
  console.log(`  drawn km: river ${tot('river drawn')} stream ${tot('stream drawn')} chain ${tot('chain drawn')}`);
  for (const c of ['bank', 'valley', 'cross']) console.log(`  ${c} > 10 m (km): river ${tot(`river ${c} >10`)} stream ${tot(`stream ${c} >10`)} chain ${tot(`chain ${c} >10`)}; > 30 m: river ${tot(`river ${c} >30`)} stream ${tot(`stream ${c} >30`)} chain ${tot(`chain ${c} >30`)}`);
  const raised = rows.filter((x) => x.group === 'raised');
  const nr = (f: (x: typeof rows[0]) => boolean) => raised.filter(f).length;
  console.log(`  raised reaches (bank or valley) > 10 m: ${raised.length} (river ${nr((x) => x.kind === 'river')}, stream ${nr((x) => x.kind === 'stream')}, chain ${nr((x) => x.kind === 'chain')}); > 30 m: ${nr((x) => x.h > 30)}; >= 100 m long: ${nr((x) => x.len >= 100)}; cross reaches ${rows.length - raised.length}`);
  const byCause: Record<string, number> = {};
  for (const x of raised) byCause[`${x.cause}`] = (byCause[`${x.cause}`] ?? 0) + 1;
  console.log(`  raised reaches by cause: ${JSON.stringify(byCause)}`);
  for (const x of raised.slice(0, 20)) console.log(`   ${x.h} m ${x.cls}/${x.cause} len ${x.len} at ${x.at} flag ${x.flagAt} (${x.flagDist} m) line ${x.line} ${x.kind} A ${x.area} lvl ${x.level} grad ${x.grad} gC ${x.groundC} natC ${x.natC} top ${x.flagTop} natF ${x.natFlag} others ${x.others}`);
  out.part2 = { drawn, hidden, inLake, km: kmBy, reaches: rows };
  mkdirSync(OUT.replace(/\/[^/]*$/, ''), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  setWorldSeed(0);
});
