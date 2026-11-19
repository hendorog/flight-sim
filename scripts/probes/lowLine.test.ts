// Owner report 2026-11-11 (seed 42, "the river doesn't flow down the valley floor"), measured world-wide and generically:
// does every channel's water run on the lowest line of its own floor, and does every floor's lowest line carry water?
//
// 1. OFF THE LOW LINE. Every line of every kind (hydrology.rivers: rivers, the gully chains' streams, the other streams;
//    chains told apart as cornerGate does), sampled every 100 m of arc; none within 300 m of a line's end or of a
//    confluence (its own mouth, and every tributary's mouth on it), none in standing water. At each sample a transect
//    across the line's direction (the chord over 100 m of arc either way, so a thread's small wiggles do not swing it)
//    walks the drawn ground (sampleTerrain .ground) each side in 10 m steps from its water's edge + 10 m (the larger of
//    halfWidth and the law's wet edges where the line has them) out to 2000 m, stopping at ground over the water + 20 m
//    (a ridge to another floor), at another channel's water (or its own water at a level more than 1 m away: a loop of it)
//    or at standing water. Records the lowest ground (or the other water's level, where that is lower) and its offset,
//    the floor's width (the span about the line out to where the ground first reaches the water + 5 m each side) and
//    the class of the low point: (i) other water lower than this one (a channel, or a lake), (ii) bare ground lower than
//    the water, (iii) nothing lower (the class thresholds 0.5 m). OFF: the low point more than 3 m under the water, beyond
//    the water's edge + 30 m, and more than 3 m under the water abreast of it too (the line's own level at its point
//    nearest the low point: a transect a little oblique to a floor falling down-valley, or a line that bends down to the
//    low point, is not OFF; offRawKm counts without this). Centring: the low point's offset over the floor's half-width;
//    chanPos: where the line lies in its floor (0 the middle, 1 an edge). onFloor: no ground between the line and its low
//    point reaches the water + 5. fall: the drop over the offset (a floor's <= 2 %, a hillside's > 5 %). The line's course
//    (the axis its thread was laid about: channelForm.ts layThread's input, where the tree has one, else a river's valley
//    axis by NetworkQuery.valleys) at each OFF sample; courseToLow its offset toward the low point over the low point's.
//    Runs: consecutive OFF samples of a line (one missing sample allowed), scored by mean drop x length; the 10 worst at
//    least 3 km apart (worst), and the same among runs on a floor (mean fall <= 2 %, the low point on the floor in half
//    the samples: worstFloor), each with a camera.
// 2. DRY FLOORS. A box about the home field (LL_BOX, offsets from it: n0,n1,e0,e1), padded LL_PAD m for the flow: the
//    drawn ground every 50 m, pits filled (priority flood, the padded box's edge the outlet), D8 flow (flats routed by
//    the flood's order), and the km of flow path in the box draining >= 1, 2, 5, 10 km2 with no water within 150 m (the
//    lines' water, at their wet half-width, and standing water). The same over the model's own ground (debugMacro.model).
//
//   LL_SEEDS=1,42,777777 LL_TREE=ccaea8d LL_OUT=out/fs/M [LL_AREA='seed:n1,e1,n2,e2,sum'] \
//     npx vitest run --config scripts/probes/vitest.config.ts scripts/probes/lowLine.test.ts
// LL_AREA: an ellipse (foci and summed distance) on one seed in which every OFF run over LL_AREA_RUN m (300) is listed.
import { it, vi } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';

/** Each line's course as handed to layThread (channelForm.ts), by its id (a river's line + 1; a stream's nR + j + 1). */
const courses = new Map<number, { n: Float64Array; e: Float64Array }>();
vi.mock('../../src/world/terrain/channelForm', async (orig) => {
  const m = (await orig()) as Record<string, unknown>;
  const lay = m.layThread as (...a: unknown[]) => unknown;
  return { ...m, layThread: (n: ArrayLike<number>, e: ArrayLike<number>, p: unknown, id: number) => { courses.set(id, { n: Float64Array.from(n), e: Float64Array.from(e) }); return lay(n, e, p, id); } };
});
import { debugMacro, hydrology, makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import type { ChannelNear, ValleyNear } from '../../src/world/terrain/hydrology';
import { AIRPORT } from '../../src/core/world';
import { setWorldSeed } from '../../src/world/worldSeed';
import { streamDebug, streamHeads } from '../../src/world/terrain/streams';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type Line = { north: Float64Array; east: Float64Array; level: Float64Array; halfWidth: Float64Array; s: Float64Array; kind?: number; joins?: number; area?: Float64Array; wetR?: Float32Array; wetL?: Float32Array };

const STEP = 100, END_SKIP = 300, WALK = 10, WALK_MAX = 2000, RIDGE = 20, FLOOR_TOP = 5, OFF_DROP = 3, OFF_BEYOND = 30, CLS = 0.5;
/** Round W R: the land the owner sees as the floor - up to SLOPE_TOP m over the water, past FLOOR_TOP no steeper than SLOPE_MAX. */
const SLOPE_TOP = 12, SLOPE_MAX = 0.1;
const q = (a: number[], p: number): number => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN);
const r1 = (x: number): number => Math.round(x * 10) / 10;

it('low line', () => {
  const tree = env.LL_TREE ?? 'tree';
  const outDir = env.LL_OUT ?? 'out/fs/M';
  mkdirSync(outDir, { recursive: true });
  const box = (env.LL_BOX ?? '-12000,4000,-16000,2000').split(',').map(Number);
  const pad = Number(env.LL_PAD ?? 4000);
  const area = env.LL_AREA ? (() => { const [sd, rest] = env.LL_AREA!.split(':'); const v = rest.split(',').map(Number); return { seed: Number(sd), f1: [v[0], v[1]], f2: [v[2], v[3]], sum: v[4] }; })() : null;
  const areaRun = Number(env.LL_AREA_RUN ?? 300);
  // (LW_LOWLAND: the streams' head catchment off the threshold slopes, km² (streams.ts streamHeads); LL_DRYONLY: the dry
  // floors only, no walk along the lines.)
  if (env.LW_LOWLAND) streamHeads.lowland = Number(env.LW_LOWLAND);
  if (env.LW_STEM) streamHeads.stem = env.LW_STEM === '1';
  for (const seed of (env.LL_SEEDS ?? '42').split(',').map(Number)) {
    courses.clear();
    const t0 = performance.now();
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const tBuild = performance.now() - t0;
    const L = (hydrology.rivers ?? []) as unknown as Line[];
    const net = hydrology.network!;
    const S = makeSample();
    const home = { n: AIRPORT.runway.center.north, e: AIRPORT.runway.center.east };
    // --- Kinds (cornerGate's block rule): rivers; the gully chains' streams (report.chains.traced of them from the first
    // stream after the last head or feeder); every other stream.
    const rep = hydrology.streamReport as unknown as { chains?: { traced: number } };
    const nR = L.filter((r) => (r.kind ?? 0) === 0).length;
    let cs = nR;
    for (let i = nR; i < L.length; i++) { const a0 = L[i].area?.[0] ?? 0; if (Math.abs(a0 - 5) < 1e-6 || Math.abs(a0 - 6) < 1e-6) cs = i + 1; else if (a0 >= 9.95 && a0 < 10.05 && i > cs + 30) break; }
    let ce = cs + (rep.chains?.traced ?? 0);
    // (LL_ONEKIND: every line not a river is a 'stream': the prototype's one head rule leaves no chain or feeder signature.)
    if (env.LL_ONEKIND) ce = cs = nR;
    let badChain = 0;
    for (let i = cs; i < ce; i++) { const a0 = L[i]?.area?.[0] ?? 0; if (!(a0 >= 9.95 && a0 < 40)) badChain++; }
    // (Where the trace says which pass built each stream (streams.ts streamDebug.src), a chain is the chain pass's, as
    // organicMap reads it; else cornerGate's block rule.)
    const src = streamDebug.src && streamDebug.src.length === L.length - nR ? streamDebug.src : null;
    const kindOf = (i: number): string => ((L[i].kind ?? 0) === 0 ? 'river' : src ? (src[i - nR] === 'chain' ? 'chain' : 'stream') : i >= cs && i < ce ? 'chain' : 'stream');
    // --- Confluences: each tributary's mouth on its receiver (the receiver's sample nearest its last point).
    const joinS: number[][] = L.map(() => []);
    const nearestS = (r: Line, n: number, e: number): number => { let b = 0, bd = Infinity; for (let i = 0; i < r.north.length; i++) { const d = (r.north[i] - n) ** 2 + (r.east[i] - e) ** 2; if (d < bd) { bd = d; b = i; } } return r.s[b]; };
    L.forEach((r, li) => { const j = r.joins ?? -1; if (j >= 0 && j < L.length) joinS[j].push(nearestS(L[j], r.north[r.north.length - 1], r.east[r.east.length - 1])); void li; });
    const at = (r: Line, sv: number): { i: number; t: number } => {
      let lo = 0, hi = r.s.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.s[m] <= sv) lo = m; else hi = m; }
      return { i: lo, t: Math.min(1, Math.max(0, (sv - r.s[lo]) / Math.max(1e-9, r.s[hi] - r.s[lo]))) };
    };
    const lerp = (a: ArrayLike<number>, p: { i: number; t: number }): number => a[p.i] + (a[Math.min(a.length - 1, p.i + 1)] - a[p.i]) * p.t;
    const chs: ChannelNear[] = [];
    const vs: ValleyNear[] = [];
    /** Water at a point other than line li's own (within 1 m of `own`): its level, line (-2 a lake or the sea); null if none. */
    const otherWater = (n: number, e: number, li: number, own: number): { level: number; line: number } | null => {
      sampleTerrain(n, e, S);
      if (S.standing > S.ground + 0.05) return { level: S.standing, line: -2 };
      if (S.river === -Infinity) return null;
      const g = S.ground;
      const k = net.channels(n, e, chs);
      let best: { level: number; line: number } | null = null;
      for (let j = 0; j < k; j++) {
        const c = chs[j];
        if (!(c.dist < (c.wet ?? c.halfWidth) && g < c.level)) continue;
        if (c.line === li && Math.abs(c.level - own) <= 1) continue;
        if (!best || c.level < best.level) best = { level: c.level, line: c.line };
      }
      return best;
    };
    // --- 1. Every line sampled.
    type Agg = { km: number; off: number; cls: number[]; offCls: number[]; drop: number[]; offs: number[]; cen: number[]; cenOff: number[]; pos: number[]; offFloor: number; raw: number; band: number[]; fall: number[]; c2l: number[] };
    const agg: Record<string, Agg> = {};
    const A = (k: string): Agg => agg[k] ?? (agg[k] = { km: 0, off: 0, cls: [0, 0, 0], offCls: [0, 0, 0], drop: [], offs: [], cen: [], cenOff: [], pos: [], offFloor: 0, raw: 0, band: [0, 0, 0], fall: [0, 0, 0], c2l: [] });
    type Off = { line: number; kind: string; s: number; A: number; n: number; e: number; water: number; abreast: number; low: number; drop: number; dropRaw: number; off: number; lowN: number; lowE: number; floorW: number; floorL: number; floorR: number; cls: string; other: number; onFloor: boolean; centring: number; chanPos: number; fall: number; modelChan: number; modelLow: number; course: { n: number; e: number; off: number; src: string } | null };
    const offs: Off[] = [];
    const pos: Array<{ li: number; s: number; A: number; pos: number; fw: number; bed: number; pos2: number; fw2: number }> = [];
    let skipped = { end: 0, conf: 0, standing: 0 };
    const t1 = performance.now();
    for (let li = 0; li < (env.LL_DRYONLY ? 0 : L.length); li++) {
      const r = L[li];
      const m = r.s.length;
      if (m < 3) continue;
      const kind = kindOf(li);
      const sEnd = r.s[m - 1];
      for (let sv = END_SKIP; sv <= sEnd - END_SKIP; sv += STEP) {
        if (joinS[li].some((j) => Math.abs(j - sv) < END_SKIP)) { skipped.conf++; continue; }
        const p = at(r, sv);
        const cn = lerp(r.north, p), ce2 = lerp(r.east, p), water = lerp(r.level, p);
        sampleTerrain(cn, ce2, S);
        if (S.standing > S.ground + 0.05) { skipped.standing++; continue; }
        const pa = at(r, Math.max(0, sv - 100)), pb = at(r, Math.min(sEnd, sv + 100));
        let dn = lerp(r.north, pb) - lerp(r.north, pa), de = lerp(r.east, pb) - lerp(r.east, pa);
        const dl = Math.hypot(dn, de) || 1;
        dn /= dl;
        de /= dl;
        // (Right of the flow: (-de, dn).)
        const hw = Math.max(lerp(r.halfWidth, p), r.wetR ? lerp(r.wetR, p) : 0, r.wetL ? lerp(r.wetL, p) : 0);
        const ag = A(kind);
        ag.km += STEP / 1000;
        let low = Infinity, lowO = 0, lowCls = 2, lowOther = -1, lowOnFloor = true;
        const fl = [0, 0];
        const fl2 = [0, 0];
        for (const sd of [1, -1]) {
          let floorEnd = -1, maxG = -Infinity, last = hw;
          // (Round W R: and the floor as the land the owner sees as it - the ground up to SLOPE_TOP over the water, rising
          // past FLOOR_TOP no more steeply than SLOPE_MAX over the last 30 m: not the walls.)
          let floorEnd2 = -1;
          const gs: number[] = [];
          for (let o = hw + WALK; o <= WALK_MAX; o += WALK) {
            const pn = cn - de * o * sd, pe = ce2 + dn * o * sd;
            last = o;
            const w = otherWater(pn, pe, li, water);
            if (w) {
              if (w.level < low) { low = w.level; lowO = o * sd; lowCls = 0; lowOther = w.line; lowOnFloor = maxG < water + FLOOR_TOP; }
              if (floorEnd2 < 0) floorEnd2 = o;
              break;
            }
            if (S.river > -Infinity) continue; // (its own water: a braid, a loop's other limb)
            const g = S.ground;
            gs.push(g);
            if (floorEnd2 < 0 && (g > water + SLOPE_TOP || (g > water + FLOOR_TOP && gs.length > 3 && g - gs[gs.length - 4] > SLOPE_MAX * 3 * WALK))) floorEnd2 = o;
            if (g > water + RIDGE) break;
            if (floorEnd < 0 && g >= water + FLOOR_TOP) floorEnd = o;
            if (g < low) { low = g; lowO = o * sd; lowCls = 1; lowOther = -1; lowOnFloor = maxG < water + FLOOR_TOP; }
            maxG = Math.max(maxG, g);
          }
          fl[sd > 0 ? 1 : 0] = floorEnd < 0 ? last : floorEnd;
          fl2[sd > 0 ? 1 : 0] = floorEnd2 < 0 ? last : floorEnd2;
        }
        const drop = water - low;
        const cls = drop > CLS ? lowCls : 2;
        const floorW = fl[0] + fl[1];
        const centring = Math.abs(lowO) / Math.max(1, 0.5 * floorW);
        const chanPos = (fl[1] - fl[0]) / Math.max(1, floorW);
        ag.cls[cls] += STEP / 1000;
        ag.cen.push(centring);
        ag.pos.push(Math.abs(chanPos));
        // (Round W R: every river sample's place in its floor and its bed's share of the floor, for the side measures.)
        if (kind === 'river') { const bw = (r as unknown as { bedR?: Float32Array; bedL?: Float32Array }); const fw2 = fl2[0] + fl2[1]; pos.push({ li, s: sv, A: r.area ? lerp(r.area, p) : 0, pos: chanPos, fw: floorW, bed: bw.bedR && bw.bedL ? lerp(bw.bedR, p) + lerp(bw.bedL, p) : 2 * hw, pos2: (fl2[1] - fl2[0]) / Math.max(1, fw2), fw2 }); }
        if (!(drop > OFF_DROP && Math.abs(lowO) > hw + OFF_BEYOND)) continue;
        ag.raw += STEP / 1000;
        // (Against the water abreast of the low point too - the line's own level at its point nearest the low point - so
        // a transect a little oblique to a falling floor, or a line that bends down to the low point, is not OFF: the
        // drop is from the lower of the two.)
        const lowN = cn - de * lowO, lowE = ce2 + dn * lowO;
        let ab = 0, abD = Infinity;
        for (let i = 0; i < m; i++) { const d = (r.north[i] - lowN) ** 2 + (r.east[i] - lowE) ** 2; if (d < abD) { abD = d; ab = i; } }
        const abreast = r.level[ab];
        const dropRaw = drop;
        const dropA = Math.min(water, abreast) - low;
        if (!(dropA > OFF_DROP)) continue;
        ag.off += STEP / 1000;
        ag.offCls[cls] += STEP / 1000;
        ag.drop.push(dropA);
        ag.offs.push(Math.abs(lowO));
        ag.cenOff.push(centring);
        if (lowOnFloor) ag.offFloor += STEP / 1000;
        // (Where the low point lies: by its offset, and by the ground's mean fall across to it, a floor's (<= 2 %) or a hillside's (> 5 %).)
        const fall = dropA / Math.max(1, Math.abs(lowO));
        ag.band[Math.abs(lowO) <= 500 ? 0 : Math.abs(lowO) <= 1750 ? 1 : 2] += STEP / 1000;
        ag.fall[fall <= 0.02 ? 0 : fall <= 0.05 ? 1 : 2] += STEP / 1000;
        const mc = debugMacro(cn, ce2), ml = debugMacro(lowN, lowE);
        // The course: layThread's input for this line where captured, else a river's valley axis (sign by a step).
        let course: Off['course'] = null;
        const cc = courses.get(li + 1);
        if (cc) {
          let bd = Infinity, bn = 0, be = 0;
          for (let i = 0; i + 1 < cc.n.length; i++) {
            const an = cc.n[i], ae = cc.e[i], bn2 = cc.n[i + 1] - an, be2 = cc.e[i + 1] - ae;
            const l2 = bn2 * bn2 + be2 * be2 || 1;
            const t = Math.min(1, Math.max(0, ((cn - an) * bn2 + (ce2 - ae) * be2) / l2));
            const xn = an + bn2 * t, xe = ae + be2 * t;
            const d = (xn - cn) ** 2 + (xe - ce2) ** 2;
            if (d < bd) { bd = d; bn = xn; be = xe; }
          }
          course = { n: Math.round(bn), e: Math.round(be), off: r1((bn - cn) * -de + (be - ce2) * dn), src: 'layThread' };
        } else if (kind === 'river') {
          const own = (pn: number, pe: number): number => { const k = net.valleys(pn, pe, vs); for (let j = 0; j < k; j++) if (vs[j].line === li) return vs[j].dist; return NaN; };
          const d0 = own(cn, ce2);
          if (Number.isFinite(d0)) {
            const dp = own(cn - de * 20, ce2 + dn * 20);
            const sgn = dp < d0 ? 1 : -1;
            course = { n: Math.round(cn - de * d0 * sgn), e: Math.round(ce2 + dn * d0 * sgn), off: r1(d0 * sgn), src: 'valley' };
          }
        }
        if (course) ag.c2l.push((course.off * Math.sign(lowO)) / Math.abs(lowO));
        offs.push({ line: li, kind, s: Math.round(sv), A: r1(r.area ? lerp(r.area, p) : NaN), n: Math.round(cn), e: Math.round(ce2), water: r1(water), abreast: r1(abreast), low: r1(low), drop: r1(dropA), dropRaw: r1(dropRaw), off: Math.round(lowO), lowN: Math.round(lowN), lowE: Math.round(lowE), floorW: Math.round(floorW), floorL: Math.round(fl[0]), floorR: Math.round(fl[1]), cls: ['i', 'ii', 'iii'][cls] + (cls === 0 ? (lowOther === -2 ? ':lake' : `:line${lowOther}`) : ''), other: lowOther, onFloor: lowOnFloor, fall: Math.round(fall * 1000) / 10, centring: r1(centring * 100) / 100, chanPos: Math.round(chanPos * 100) / 100, modelChan: r1(mc ? mc.model : NaN), modelLow: r1(ml ? ml.model : NaN), course });
      }
    }
    const tWalk = performance.now() - t1;
    // --- Round W R: where each river lies in its floor (no target: the owner's 'a river may hug a wall for a stretch, not
    // consistently'). Thirds: chanPos < -1/3 one side, > 1/3 the other, else the middle. A one-side run: consecutive
    // samples of a line in the same outer third (a gap of one sample allowed), its length in km and in floor widths.
    // At a wall: |chanPos| > 0.67. Bed share: the bed's width over the floor's, by catchment band.
    const side: Record<string, unknown> = {};
    const sideOf = (which: 'pos' | 'pos2'): Record<string, unknown> => {
      const P = pos.map((q) => ({ ...q, pos: which === 'pos' ? q.pos : q.pos2, fw: which === 'pos' ? q.fw : q.fw2 }));
      const runsKm: number[] = [];
      let cur = { li: -1, sd: 0, s0: 0, s1: 0, n: 0 };
      const flushS = (): void => { if (cur.sd !== 0 && cur.n > 0) runsKm.push((cur.s1 - cur.s0 + STEP) / 1000); };
      for (const q of P) {
        const sd = q.pos > 1 / 3 ? 1 : q.pos < -1 / 3 ? -1 : 0;
        if (q.li === cur.li && sd === cur.sd && sd !== 0 && q.s - cur.s1 <= 2 * STEP + 1) { cur.s1 = q.s; cur.n++; continue; }
        flushS();
        cur = { li: q.li, sd, s0: q.s, s1: q.s, n: 1 };
      }
      flushS();
      const thirds = [0, 0, 0];
      let wall = 0;
      for (const q of P) { thirds[q.pos < -1 / 3 ? 0 : q.pos > 1 / 3 ? 2 : 1]++; if (Math.abs(q.pos) > 0.67) wall++; }
      return { thirdsPct: thirds.map((t) => Math.round((1000 * t) / Math.max(1, P.length)) / 10), wallPct: Math.round((1000 * wall) / Math.max(1, P.length)) / 10, runKmP50: r1(q(runsKm, 0.5)), runKmP90: r1(q(runsKm, 0.9)), runKmMax: r1(q(runsKm, 1)), oneSideKmIn2kmPlusRuns: r1(runsKm.filter((x) => x >= 2).reduce((a, b) => a + b, 0)), floorWidthP50: Math.round(q(P.map((x) => x.fw), 0.5)), bedOverFloorP50: Math.round(100 * q(P.map((x) => x.bed / Math.max(1, x.fw)), 0.5)) / 100, bedOverFloorP90: Math.round(100 * q(P.map((x) => x.bed / Math.max(1, x.fw)), 0.9)) / 100 };
    };
    side.slopeFloor = sideOf('pos2');
    {
      const runsKm: number[] = [];
      const runsW: number[] = [];
      let cur = { li: -1, sd: 0, s0: 0, s1: 0, fw: 0, n: 0 };
      const flushS = (): void => { if (cur.sd !== 0 && cur.n > 0) { const len = cur.s1 - cur.s0 + STEP; runsKm.push(len / 1000); runsW.push(len / Math.max(1, cur.fw / cur.n)); } };
      for (const q of pos) {
        const sd = q.pos > 1 / 3 ? 1 : q.pos < -1 / 3 ? -1 : 0;
        if (q.li === cur.li && sd === cur.sd && sd !== 0 && q.s - cur.s1 <= 2 * STEP + 1) { cur.s1 = q.s; cur.fw += q.fw; cur.n++; continue; }
        flushS();
        cur = { li: q.li, sd, s0: q.s, s1: q.s, fw: q.fw, n: 1 };
      }
      flushS();
      const km = pos.length * STEP / 1000;
      const thirds = [0, 0, 0];
      let wall = 0;
      for (const q of pos) { thirds[q.pos < -1 / 3 ? 0 : q.pos > 1 / 3 ? 2 : 1]++; if (Math.abs(q.pos) > 0.67) wall++; }
      const band: Record<string, unknown> = {};
      for (const [lo, hi] of [[0, 100], [100, 500], [500, 2000], [2000, 1e9]]) {
        const b = pos.filter((x) => x.A >= lo && x.A < hi);
        band[`${lo}-${hi === 1e9 ? 'up' : hi}`] = { km: r1(b.length * STEP / 1000), bedOverFloorP50: Math.round(100 * q(b.map((x) => x.bed / Math.max(1, x.fw)), 0.5)) / 100, bedOverFloorP90: Math.round(100 * q(b.map((x) => x.bed / Math.max(1, x.fw)), 0.9)) / 100, wallPct: Math.round((1000 * b.filter((x) => Math.abs(x.pos) > 0.67).length) / Math.max(1, b.length)) / 10 };
      }
      Object.assign(side, { km: r1(km), thirdsPct: thirds.map((t) => Math.round((1000 * t) / Math.max(1, pos.length)) / 10), wallPct: Math.round((1000 * wall) / Math.max(1, pos.length)) / 10, oneSideRuns: runsKm.length, runKmP50: r1(q(runsKm, 0.5)), runKmP90: r1(q(runsKm, 0.9)), runKmMax: r1(q(runsKm, 1)), runWidthsP50: r1(q(runsW, 0.5)), runWidthsP90: r1(q(runsW, 0.9)), oneSideKmIn2kmPlusRuns: r1(runsKm.filter((x) => x >= 2).reduce((a, b) => a + b, 0)), band });
    }
    // --- Runs: consecutive OFF samples of a line (one missing sample allowed), scored by mean drop x length.
    type Run = { line: number; kind: string; s0: number; s1: number; len: number; meanDrop: number; meanFall: number; maxDrop: number; score: number; worst: Off; side: number; cls: string; onFloor: number; n: number; e: number };
    const runs: Run[] = [];
    {
      let cur: Off[] = [];
      const flush = (): void => {
        if (!cur.length) return;
        const len = (cur[cur.length - 1].s - cur[0].s) + STEP;
        const md = cur.reduce((a, o) => a + o.drop, 0) / cur.length;
        const w = cur.reduce((a, o) => (o.drop > a.drop ? o : a), cur[0]);
        const side = Math.sign(cur.reduce((a, o) => a + Math.sign(o.off), 0)) || Math.sign(w.off);
        const cc: Record<string, number> = {};
        for (const o of cur) { const c = o.cls.split(':')[0]; cc[c] = (cc[c] ?? 0) + 1; }
        runs.push({ line: w.line, kind: w.kind, s0: cur[0].s, s1: cur[cur.length - 1].s, len, meanDrop: r1(md), meanFall: r1(cur.reduce((a, o) => a + o.fall, 0) / cur.length), maxDrop: w.drop, score: Math.round(md * len), worst: w, side, cls: Object.entries(cc).map(([k, v]) => `${k}:${v}`).join(' '), onFloor: Math.round((100 * cur.filter((o) => o.onFloor).length) / cur.length), n: w.n, e: w.e });
        cur = [];
      };
      for (const o of offs) {
        const p = cur[cur.length - 1];
        if (p && (p.line !== o.line || o.s - p.s > 2 * STEP + 1)) flush();
        cur.push(o);
      }
      flush();
    }
    // A camera for a run: 1.2 km beyond the midpoint of channel and low point toward the low point, 500 m up; turned
    // up to 60 degrees either way and raised until it stands over the ground with a clear line of sight.
    const camera = (o: Off): string => {
      const mn = 0.5 * (o.n + o.lowN), me = 0.5 * (o.e + o.lowE);
      const mz = terrainHeight(mn, me);
      let un = o.lowN - o.n, ue = o.lowE - o.e;
      const ul = Math.hypot(un, ue) || 1;
      un /= ul;
      ue /= ul;
      for (const turn of [0, 30, -30, 60, -60]) {
        const a = (turn * Math.PI) / 180;
        const vn = un * Math.cos(a) - ue * Math.sin(a), ve = un * Math.sin(a) + ue * Math.cos(a);
        const cn = mn + 1200 * vn, cE = me + 1200 * ve;
        const g = terrainHeight(cn, cE);
        let cz = mz + 500;
        if (cz < g + 150) cz = g + 150;
        let clear = true;
        for (let t = 0.05; t < 0.95 && clear; t += 0.05) if (terrainHeight(cn + (mn - cn) * t, cE + (me - cE) * t) > cz + (mz - cz) * t - 8) clear = false;
        if (clear) return `camPos=${cn.toFixed(0)},${cE.toFixed(0)},${cz.toFixed(0)}&camLook=${mn.toFixed(0)},${me.toFixed(0)},${mz.toFixed(0)}`;
      }
      return '';
    };
    const pick = (rs: Run[]): Run[] => {
      const w: Run[] = [];
      for (const r of [...rs].sort((a, b) => b.score - a.score)) {
        if (w.length >= 10) break;
        if (w.some((x) => Math.hypot(x.n - r.n, x.e - r.e) < 3000)) continue;
        w.push(r);
      }
      return w;
    };
    const worst = pick(runs);
    // (And the worst on a floor: the ground's mean fall across to the low point 2 % or less, the low point on the floor.)
    const worstFloor = pick(runs.filter((r) => r.meanFall <= 2 && r.onFloor >= 50));
    const inArea = (n: number, e: number): boolean => !!area && Math.hypot(n - area.f1[0], e - area.f1[1]) + Math.hypot(n - area.f2[0], e - area.f2[1]) <= area.sum;
    const areaRuns = area && area.seed === seed ? runs.filter((r) => r.len > areaRun && offs.some((o) => o.line === r.line && o.s >= r.s0 && o.s <= r.s1 && inArea(o.n, o.e))).sort((a, b) => b.score - a.score) : [];
    const runOut = (r: Run): Record<string, unknown> => ({ line: r.line, kind: r.kind, s0: r.s0, s1: r.s1, len: r.len, meanDrop: r.meanDrop, meanFallPct: r.meanFall, maxDrop: r.maxDrop, score: r.score, cls: r.cls, onFloorPct: r.onFloor, side: r.side > 0 ? 'right' : 'left', at: [r.worst.n, r.worst.e], low: [r.worst.lowN, r.worst.lowE], water: r.worst.water, lowGround: r.worst.low, off: r.worst.off, floorW: r.worst.floorW, A: r.worst.A, modelChan: r.worst.modelChan, modelLow: r.worst.modelLow, course: r.worst.course, cam: `seed=${seed}&${camera(r.worst)}` });
    // --- 2. Dry floors about the home field.
    const t2 = performance.now();
    const C = 50;
    const N0 = home.n + box[0] - pad, E0 = home.e + box[2] - pad;
    const ni = Math.round((box[1] - box[0] + 2 * pad) / C) + 1, nj = Math.round((box[3] - box[2] + 2 * pad) / C) + 1;
    const NN = ni * nj;
    const gD = new Float64Array(NN), gM = new Float64Array(NN);
    const lake = new Uint8Array(NN), flat = new Uint8Array(NN);
    for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) {
      const n = N0 + i * C, e = E0 + j * C, k = i * nj + j;
      sampleTerrain(n, e, S);
      gD[k] = S.ground;
      lake[k] = S.standing > S.ground + 0.05 ? 1 : 0;
      flat[k] = S.airportBlend < 1 ? 1 : 0;
      const mm = debugMacro(n, e);
      gM[k] = mm ? mm.model : S.ground;
    }
    // Water near: every line's water (its wet half-width) and standing water, grown by 150 m.
    const near = new Uint8Array(NN);
    const mark = (n: number, e: number, rad: number): void => {
      const ci = (n - N0) / C, cj = (e - E0) / C, rr = rad / C;
      for (let i = Math.max(0, Math.floor(ci - rr)); i <= Math.min(ni - 1, Math.ceil(ci + rr)); i++) for (let j = Math.max(0, Math.floor(cj - rr)); j <= Math.min(nj - 1, Math.ceil(cj + rr)); j++) if ((i - ci) ** 2 + (j - cj) ** 2 <= rr * rr) near[i * nj + j] = 1;
    };
    const N1 = N0 + (ni - 1) * C, E1 = E0 + (nj - 1) * C;
    for (const r of L) {
      for (let i = 0; i + 1 < r.north.length; i++) {
        const an = r.north[i], ae = r.east[i], bn = r.north[i + 1], be = r.east[i + 1];
        if (Math.max(an, bn) < N0 - 300 || Math.min(an, bn) > N1 + 300 || Math.max(ae, be) < E0 - 300 || Math.min(ae, be) > E1 + 300) continue;
        const hw = Math.max(r.halfWidth[i], r.wetR ? r.wetR[i] : 0, r.wetL ? r.wetL[i] : 0);
        const k = Math.max(1, Math.ceil(Math.hypot(bn - an, be - ae) / 10));
        for (let t = 0; t <= k; t++) mark(an + ((bn - an) * t) / k, ae + ((be - ae) * t) / k, hw + 150);
      }
    }
    for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) if (lake[i * nj + j]) mark(N0 + i * C, E0 + j * C, 150);
    const DI = [-1, -1, -1, 0, 0, 1, 1, 1], DJ = [-1, 0, 1, -1, 1, -1, 0, 1];
    const flow = (g: Float64Array): { acc: Float64Array; rcv: Int32Array; step: Float64Array } => {
      // Priority flood (min-heap on the filled level), the padded box's edge the outlet.
      const fill = new Float64Array(NN).fill(Infinity);
      const parent = new Int32Array(NN).fill(-1);
      const order = new Int32Array(NN);
      let no = 0;
      const heap: number[] = [];
      const push = (k: number): void => { heap.push(k); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (fill[heap[p]] <= fill[heap[c]]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
      const pop = (): number => { const top = heap[0]; const lst = heap.pop()!; if (heap.length) { heap[0] = lst; let c = 0; for (;;) { const l = 2 * c + 1, rr = l + 1; let m = c; if (l < heap.length && fill[heap[l]] < fill[heap[m]]) m = l; if (rr < heap.length && fill[heap[rr]] < fill[heap[m]]) m = rr; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
      const done = new Uint8Array(NN);
      for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) if (i === 0 || j === 0 || i === ni - 1 || j === nj - 1) { const k = i * nj + j; fill[k] = g[k]; done[k] = 1; push(k); }
      while (heap.length) {
        const k = pop();
        order[no++] = k;
        const i = Math.floor(k / nj), j = k - i * nj;
        for (let d = 0; d < 8; d++) {
          const a = i + DI[d], b = j + DJ[d];
          if (a < 0 || b < 0 || a >= ni || b >= nj) continue;
          const kk = a * nj + b;
          if (done[kk]) continue;
          done[kk] = 1;
          fill[kk] = Math.max(g[kk], fill[k]);
          parent[kk] = k;
          push(kk);
        }
      }
      const rcv = new Int32Array(NN).fill(-1);
      const step = new Float64Array(NN);
      for (let k = 0; k < NN; k++) {
        const i = Math.floor(k / nj), j = k - i * nj;
        let best = -1, bs = 0;
        for (let d = 0; d < 8; d++) {
          const a = i + DI[d], b = j + DJ[d];
          if (a < 0 || b < 0 || a >= ni || b >= nj) continue;
          const kk = a * nj + b;
          const len = DI[d] && DJ[d] ? C * Math.SQRT2 : C;
          const sl = (fill[k] - fill[kk]) / len;
          if (sl > bs) { bs = sl; best = kk; }
        }
        rcv[k] = best >= 0 ? best : parent[k];
        if (rcv[k] >= 0) { const a = Math.floor(rcv[k] / nj), b = rcv[k] - a * nj; step[k] = Math.hypot(a - i, b - j) * C; } else step[k] = C;
      }
      const acc = new Float64Array(NN).fill((C * C) / 1e6);
      for (let x = NN - 1; x >= 0; x--) { const k = order[x]; if (rcv[k] >= 0) acc[rcv[k]] += acc[k]; }
      return { acc, rcv, step };
    };
    const inBox = (k: number): boolean => { const i = Math.floor(k / nj), j = k - i * nj; const n = N0 + i * C - home.n, e = E0 + j * C - home.e; return n >= box[0] && n <= box[1] && e >= box[2] && e <= box[3]; };
    const TH = [1, 2, 5, 10];
    const dry = (g: Float64Array): Record<string, unknown> => {
      const { acc, rcv, step } = flow(g);
      const km = TH.map(() => 0), dryKm = TH.map(() => 0), dryFlat = TH.map(() => 0);
      for (let k = 0; k < NN; k++) {
        if (!inBox(k)) continue;
        for (let t = 0; t < TH.length; t++) {
          if (acc[k] < TH[t]) continue;
          km[t] += step[k] / 1000;
          if (near[k] || lake[k]) continue;
          dryKm[t] += step[k] / 1000;
          if (flat[k]) dryFlat[t] += step[k] / 1000;
        }
      }
      // The longest dry runs draining 5 km2 or more: from each such run's lowest dry cell up its largest dry donor.
      const isDry = (k: number): boolean => inBox(k) && acc[k] >= 5 && !near[k] && !lake[k];
      const donor = new Int32Array(NN).fill(-1);
      for (let k = 0; k < NN; k++) { const r = rcv[k]; if (r >= 0 && isDry(k) && (donor[r] < 0 || acc[k] > acc[donor[r]])) donor[r] = k; }
      const dryRuns: Array<{ len: number; A: number; end: number[]; top: number[]; mid: number[]; drawn: number; model: number }> = [];
      for (let k = 0; k < NN; k++) {
        if (!isDry(k) || (rcv[k] >= 0 && isDry(rcv[k]))) continue;
        let len = 0, x = k;
        const path: number[] = [];
        while (x >= 0 && isDry(x)) { path.push(x); len += step[x]; x = donor[x]; }
        const pos = (c: number): number[] => { const i = Math.floor(c / nj), j = c - i * nj; return [N0 + i * C, E0 + j * C]; };
        const mid = path[path.length >> 1];
        dryRuns.push({ len: Math.round(len), A: r1(acc[k]), end: pos(k), top: pos(path[path.length - 1]), mid: pos(mid), drawn: r1(gD[mid]), model: r1(gM[mid]) });
      }
      dryRuns.sort((a, b) => b.len * Math.sqrt(b.A) - a.len * Math.sqrt(a.A));
      return { th: TH, km: km.map(r1), dryKm: dryKm.map(r1), dryShare: dryKm.map((d, t) => Math.round((1000 * d) / Math.max(1e-9, km[t])) / 10), dryInFieldFlat: dryFlat.map(r1), longest: dryRuns.slice(0, 12) };
    };
    const dryDrawn = dry(gD), dryModel = dry(gM);
    const tDry = performance.now() - t2;
    // --- Summary.
    const sum: Record<string, unknown> = {};
    const all = A('all');
    for (const k of ['river', 'chain', 'stream']) {
      const a = A(k);
      all.km += a.km; all.off += a.off; all.offFloor += a.offFloor; all.raw += a.raw;
      for (let c = 0; c < 3; c++) { all.band[c] += a.band[c]; all.fall[c] += a.fall[c]; }
      const cat = (t: number[], f: number[]): void => { for (const x of f) t.push(x); };
      cat(all.c2l, a.c2l);
      for (let c = 0; c < 3; c++) { all.cls[c] += a.cls[c]; all.offCls[c] += a.offCls[c]; }
      cat(all.drop, a.drop); cat(all.offs, a.offs); cat(all.cen, a.cen); cat(all.cenOff, a.cenOff); cat(all.pos, a.pos);
    }
    for (const k of ['river', 'chain', 'stream', 'all']) {
      const a = A(k);
      sum[k] = { km: r1(a.km), offRawKm: r1(a.raw), offKm: r1(a.off), offPct: Math.round((1000 * a.off) / Math.max(1e-9, a.km)) / 10, offOnFloorKm: r1(a.offFloor), clsKm: a.cls.map(r1), offClsKm: a.offCls.map(r1), dropP50: r1(q(a.drop, 0.5)), dropP90: r1(q(a.drop, 0.9)), offsetP50: Math.round(q(a.offs, 0.5)), offsetP90: Math.round(q(a.offs, 0.9)), centringP50: Math.round(100 * q(a.cen, 0.5)) / 100, centringP90: Math.round(100 * q(a.cen, 0.9)) / 100, centringOffP50: Math.round(100 * q(a.cenOff, 0.5)) / 100, centringOffP90: Math.round(100 * q(a.cenOff, 0.9)) / 100, chanPosP50: Math.round(100 * q(a.pos, 0.5)) / 100, chanPosP90: Math.round(100 * q(a.pos, 0.9)) / 100, offBandKm: a.band.map(r1), offFallKm: a.fall.map(r1), courseToLowP50: Math.round(100 * q(a.c2l, 0.5)) / 100, courseToLowP90: Math.round(100 * q(a.c2l, 0.9)) / 100, courseN: a.c2l.length };
    }
    const out = { tree, seed, home, lines: L.length, rivers: nR, chainBlock: [cs, ce - 1], badChain, coursesCaptured: courses.size, skipped, ms: { build: Math.round(tBuild), walk: Math.round(tWalk), dry: Math.round(tDry) }, defs: { STEP, END_SKIP, WALK, WALK_MAX, RIDGE, FLOOR_TOP, OFF_DROP, OFF_BEYOND, CLS, box, pad }, summary: sum, runs: runs.length, worst: worst.map(runOut), worstFloor: worstFloor.map(runOut), area: area && area.seed === seed ? { ellipse: area, minRun: areaRun, runs: areaRuns.map(runOut) } : null, dryDrawn, dryModel, side, offs };
    const file = `${outDir}/lowline-${tree}-${seed}.json`;
    writeFileSync(file, JSON.stringify(out));
    console.log(`LL ${tree} seed ${seed}: lines ${L.length} (rivers ${nR}, chains ${cs}..${ce - 1}, ${badChain} off-block), courses ${courses.size}; build ${(tBuild / 1000).toFixed(0)} s walk ${(tWalk / 1000).toFixed(0)} s dry ${(tDry / 1000).toFixed(0)} s; skipped ${JSON.stringify(skipped)}`);
    for (const k of ['river', 'chain', 'stream', 'all']) console.log(`LL ${tree} ${seed} ${k}: ${JSON.stringify(sum[k])}`);
    console.log(`LL ${tree} ${seed} river side ${JSON.stringify(side)}`);
    console.log(`LL ${tree} ${seed} dry drawn ${JSON.stringify({ km: dryDrawn.km, dry: dryDrawn.dryKm, share: dryDrawn.dryShare })} model ${JSON.stringify({ km: dryModel.km, dry: dryModel.dryKm, share: dryModel.dryShare })}`);
    console.log(`LL wrote ${file}`);
    skipped = { end: 0, conf: 0, standing: 0 };
  }
  setWorldSeed(0);
});
