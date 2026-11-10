// design-V MAP 1 (reader/measurer, no src change): how far the drawn rivers lie from the water routings the ground was
// shaped by, and how far the lakes lie from the model's own closed lows.
//   RA_SEEDS=1,42,777777 RA_OUT=out/routeAgree npx vitest run --config scripts/probes/vitest.config.ts routeAgree
//
// "The model's own channel" is rebuilt here from the cached model cells T (heightfield.ts seededModel().lattice) the way
// erosion.ts buildErosion lays its carve: SteadyRouter over T with the model's fixed cells, channel cells from
// CHANNEL_AREA (30 cells), the course smoothed by COURSE_PASSES (3) [1 2 1] passes along the main donor and the
// receiver, one quadratic B-spline piece per donor (PIECE_SAMPLES 6). Those constants are not exported: copied here
// (erosion.ts:184-186, :586-650). drainByHome (erosion.ts:1240) is not exported and not replayed: within ~3 km of the
// home field the course may differ (flagged by `home` below).
//
// The slopes' channels are gullies.ts's net (hillslopes.ts SlopeField.dir/area, 250 m D8): its area counts only nodes
// inside the pass, so it is not comparable to a lattice catchment; reported both banded (x0.5-2) and as any chain from
// CHAIN_AREA (10 km²).
// (Round V step 0: ported unchanged from design-V/map/probe (map 1)).
import { it } from 'vitest';
import { hydrology, seededDrainage, seededInputs, seededModel } from '../../src/world/terrain/heightfield';
import { levelProbe } from '../../src/world/terrain/riverNetwork';
import { SteadyRouter, bicubic, CUT_N, CUT_CELL } from '../../src/world/terrain/erosion';
import { gullyNet, receiverOf } from '../../src/world/terrain/gullies';
import { DOMAIN_HALF, DRAIN_CELL } from '../../src/world/terrain/drainage';
import { AIRPORT } from '../../src/core/world';
import { setWorldSeed } from '../../src/world/worldSeed';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';

const env = process.env;
const CHANNEL_AREA = 30;
const COURSE_PASSES = 3;
const PIECE_SAMPLES = 6;
const DI8 = [-1, -1, -1, 0, 0, 1, 1, 1];
const DJ8 = [-1, 0, 1, -1, 1, -1, 0, 1];
const ORIGIN = -DOMAIN_HALF;
const BANDS = [100, 250, 500];

/** A bucketed segment index: nearest segment within reach, filtered by its area. */
class SegIndex {
  seg: number[] = [];
  buckets = new Map<number, number[]>();
  constructor(readonly cell = 500, readonly reach = 1500) {}
  add(n0: number, e0: number, n1: number, e1: number, area: number, tag: number, depth = 0): void {
    const k = this.seg.length / 7;
    this.seg.push(n0, e0, n1, e1, area, tag, depth);
    const R = this.reach;
    const c = this.cell;
    const y0 = Math.floor((Math.min(n0, n1) - R - ORIGIN) / c);
    const y1 = Math.floor((Math.max(n0, n1) + R - ORIGIN) / c);
    const x0 = Math.floor((Math.min(e0, e1) - R - ORIGIN) / c);
    const x1 = Math.floor((Math.max(e0, e1) + R - ORIGIN) / c);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const key = y * 4096 + x;
        let b = this.buckets.get(key);
        if (!b) this.buckets.set(key, (b = []));
        b.push(k);
      }
  }
  /** Nearest segment with area in [lo, hi] (and depth >= minDepth); out: [dist, area, tag, depth]. */
  near(pn: number, pe: number, lo: number, hi: number, out: number[], minDepth = -1, skipTag = -1): number {
    out[0] = Infinity;
    out[1] = 0;
    out[2] = -1;
    out[3] = 0;
    const b = this.buckets.get(Math.floor((pn - ORIGIN) / this.cell) * 4096 + Math.floor((pe - ORIGIN) / this.cell));
    if (!b) return Infinity;
    const s = this.seg;
    let best = this.reach * this.reach;
    for (const k of b) {
      const o = 7 * k;
      const a = s[o + 4];
      if (a < lo || a > hi || s[o + 6] < minDepth || s[o + 5] === skipTag) continue;
      const n0 = s[o];
      const e0 = s[o + 1];
      const dn = s[o + 2] - n0;
      const de = s[o + 3] - e0;
      const l2 = dn * dn + de * de || 1e-9;
      const t = Math.min(1, Math.max(0, ((pn - n0) * dn + (pe - e0) * de) / l2));
      const qn = n0 + dn * t - pn;
      const qe = e0 + de * t - pe;
      const d2 = qn * qn + qe * qe;
      if (d2 < best) {
        best = d2;
        out[0] = Math.sqrt(d2);
        out[1] = a;
        out[2] = s[o + 5];
        out[3] = s[o + 6];
      }
    }
    return out[0];
  }
}

/** Length-weighted shares within each band, and p50 / p90. */
function summary(d: number[], w: number[]): string {
  let tot = 0;
  const within = BANDS.map(() => 0);
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < d.length; i++) {
    tot += w[i];
    BANDS.forEach((b, k) => {
      if (d[i] <= b) within[k] += w[i];
    });
    pairs.push([d[i], w[i]]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const q = (f: number): string => {
    let acc = 0;
    for (const [v, ww] of pairs) {
      acc += ww;
      if (acc >= f * tot) return v === Infinity ? '>1500' : String(Math.round(v));
    }
    return '-';
  };
  return `${(tot / 1000).toFixed(0)} km: ${within.map((x, k) => `<=${BANDS[k]} ${((100 * x) / Math.max(tot, 1e-9)).toFixed(1)}%`).join(', ')}; p50 ${q(0.5)} p90 ${q(0.9)} m`;
}

it('route agreement', () => {
  const OUT = env.RA_OUT ?? 'out/routeAgree';
  mkdirSync(OUT, { recursive: true });
  for (const seedS of (env.RA_SEEDS ?? '42').split(',')) {
    const seed = Number(seedS);
    const log: string[] = [];
    const say = (s: string): void => {
      log.push(s);
      console.log(s);
    };
    // The valley axes as laid (riverNetwork.ts stage A: after the wander, before the levels' later stages).
    const axes = new Map<number, { north: Float64Array; east: Float64Array; s: Float64Array }>();
    levelProbe.on = (stage, li, line) => {
      if (stage !== 'A' || axes.has(li)) return;
      axes.set(li, { north: Float64Array.from(line.north), east: Float64Array.from(line.east), s: Float64Array.from(line.s) });
    };
    const t0 = performance.now();
    setWorldSeed(seed);
    levelProbe.on = undefined;
    say(`=== seed ${seed} (world built in ${((performance.now() - t0) / 1000).toFixed(1)} s)`);
    const d = seededDrainage!;
    const inp = seededInputs!;
    const model = seededModel()!;
    const T = model.lattice;
    const n = d.n;
    const N = n * n;
    const home = AIRPORT.runway.center;
    const cellN = (c: number): number => ORIGIN + Math.floor(c / n) * DRAIN_CELL;
    const cellE = (c: number): number => ORIGIN + (c % n) * DRAIN_CELL;
    const nearHome = (pn: number, pe: number): boolean => Math.hypot(pn - home.north, pe - home.east) < 3500;

    // --- 1. Routings on the 1 km lattice: the model's (SteadyRouter over T), the same router over the drainage's own
    // heights (d.height: T after buildErosion's corner lowering, applyMacro's cushion and the volcano, with the mound),
    // and the drainage's final receivers (after its breach cuts, on d.routed).
    const RM = new SteadyRouter(n);
    RM.route(T, inp.fixed);
    const mRec = Int32Array.from(RM.receiver);
    const mArea = Float32Array.from(RM.area);
    const mFilled = Float32Array.from(RM.filledLevels);
    const fixedD = new Uint8Array(N);
    for (let c = 0; c < N; c++) {
      const i = Math.floor(c / n);
      const j = c % n;
      fixedD[c] = d.height[c] <= 0 || i === 0 || j === 0 || i === n - 1 || j === n - 1 ? 1 : 0;
    }
    const RH = new SteadyRouter(n);
    RH.route(d.height, fixedD);
    let riverCells = 0;
    let sameMD = 0;
    let sameMH = 0;
    let sameHD = 0;
    let areaClose = 0;
    const why = { cut: 0, corner: 0, home: 0, sea: 0, lake: 0, other: 0 };
    const lakeCell = new Uint8Array(N);
    for (const l of d.lakes) for (const c of l.cells) lakeCell[c] = 1;
    // Corner cells buildErosion lowers (beside a diagonal step of a channel cell, area >= CORNER_AREA 10).
    const corner = new Uint8Array(N);
    for (let c = 0; c < N; c++) {
      const r = mRec[c];
      if (r < 0 || mArea[c] < 10) continue;
      const ic = Math.floor(c / n);
      const ir = Math.floor(r / n);
      if (ic === ir || c % n === r % n) continue;
      corner[ir * n + (c % n)] = 1;
      corner[ic * n + (r % n)] = 1;
    }
    for (const L of d.lines) {
      const last = L.joins >= 0 ? L.cells.length - 2 : L.cells.length - 1;
      for (let k = 0; k < last; k++) {
        const c = L.cells[k];
        if (d.area[c] < 45) continue;
        riverCells++;
        const next = L.cells[k + 1];
        const mOk = mRec[c] === next;
        if (mOk) sameMD++;
        if (mRec[c] === RH.receiver[c]) sameMH++;
        if (RH.receiver[c] === next) sameHD++;
        if (mArea[c] >= 0.9 * d.area[c] && mArea[c] <= 1.1 * d.area[c]) areaClose++;
        if (!mOk) {
          if (d.cutWhy[c] || d.cutWhy[next]) why.cut++;
          else if (lakeCell[c]) why.lake++;
          else if (nearHome(cellN(c), cellE(c))) why.home++;
          else if (corner[c] || corner[next]) why.corner++;
          else if (d.height[c] < 5) why.sea++;
          else why.other++;
        }
      }
    }
    say(`LATTICE ROUTE: drainage line steps (cells >= 45 km2) ${riverCells}; receiver = model's (SteadyRouter over T) ${((100 * sameMD) / riverCells).toFixed(2)}%; model on T vs SteadyRouter on d.height ${((100 * sameMH) / riverCells).toFixed(2)}%; d.height router vs drainage final ${((100 * sameHD) / riverCells).toFixed(2)}%; model area within 10% ${((100 * areaClose) / riverCells).toFixed(2)}%`);
    say(`  disagreements by place: ${JSON.stringify(why)}`);
    // buildErosion's corner lowering (erosion.ts:564-577) replayed on T after its routing: the cells beside each
    // diagonal step of a cell of >= CORNER_AREA (10) come down to the step's middle. The drainage gets T so lowered
    // (eroded = h - mound, heightfield.ts:897-906, the mound added back at drainage.ts:134-137).
    {
      const h = Float32Array.from(T);
      const R0 = new SteadyRouter(n);
      R0.route(h, inp.fixed);
      let lowered = 0;
      let sumDrop = 0;
      const lowMark = new Uint8Array(N);
      for (let k = 0; k < R0.order.length; k++) {
        const c = R0.order[k];
        const r = R0.receiver[c];
        if (r < 0 || !R0.diag[c] || R0.area[c] < 10) continue;
        const mid = 0.5 * (h[c] + Math.max(h[r], 0.5));
        const ic = Math.floor(c / n);
        const ir = Math.floor(r / n);
        const a = ir * n + (c - ic * n);
        const b = ic * n + (r - ir * n);
        for (const q of [a, b]) {
          if (!inp.fixed[q] && h[q] > mid) {
            const nv = Math.max(Math.min(h[q], inp.sill[q]), h[q] - (h[q] - mid) * inp.hard[q]);
            if (nv < h[q]) {
              lowered++;
              sumDrop += h[q] - nv;
              lowMark[q] = 1;
            }
            h[q] = nv;
          }
        }
      }
      const RC = new SteadyRouter(n);
      RC.route(h, inp.fixed);
      let same = 0;
      let sameD = 0;
      let tot = 0;
      for (const L of d.lines) {
        const last = L.joins >= 0 ? L.cells.length - 2 : L.cells.length - 1;
        for (let k = 0; k < last; k++) {
          const c = L.cells[k];
          if (d.area[c] < 45) continue;
          tot++;
          if (RC.receiver[c] === RH.receiver[c]) same++;
          if (RC.receiver[c] === L.cells[k + 1]) sameD++;
        }
      }
      let maxDiff = 0;
      for (let c = 0; c < N; c++) if (!fixedD[c]) maxDiff = Math.max(maxDiff, Math.abs(h[c] - d.height[c]));
      let cellsMoved = 0;
      for (let c = 0; c < N; c++) if (!inp.fixed[c] && R0.receiver[c] !== RC.receiver[c]) cellsMoved++;
      say(`  CORNER REPLAY: ${lowered} cells lowered (mean ${(sumDrop / Math.max(1, lowered)).toFixed(1)} m); river steps routed alike on corner-lowered T and on d.height ${((100 * same) / tot).toFixed(2)}%, = drainage's final receiver ${((100 * sameD) / tot).toFixed(2)}%; |corner-lowered T - d.height| max ${maxDiff.toFixed(2)} m on land; cells whose receiver the lowering changes ${cellsMoved} of ${N}`);
      // Model channel cells (>= 30) the drainage lines run on at all.
      let onChan = 0;
      let lineCells = 0;
      for (const L of d.lines) {
        const last = L.joins >= 0 ? L.cells.length - 1 : L.cells.length;
        for (let k = 0; k < last; k++) {
          if (d.area[L.cells[k]] < 45) continue;
          lineCells++;
          if (mArea[L.cells[k]] >= CHANNEL_AREA) onChan++;
        }
      }
      say(`  drainage line cells (>= 45 km2) that are model channel cells (>= 30 km2): ${((100 * onChan) / lineCells).toFixed(1)}% of ${lineCells}`);
      let onLow = 0;
      let lowNotChan = 0;
      for (const L of d.lines) {
        const last = L.joins >= 0 ? L.cells.length - 1 : L.cells.length;
        for (let k = 0; k < last; k++) {
          const c = L.cells[k];
          if (d.area[c] < 45) continue;
          if (lowMark[c]) onLow++;
          if (lowMark[c] && mArea[c] < CHANNEL_AREA) lowNotChan++;
        }
      }
      // Model channel cells (>= 45) whose water the drainage takes elsewhere (its catchment there under half the model's).
      let mc = 0;
      let robbed = 0;
      for (let c = 0; c < N; c++) {
        if (inp.fixed[c] || mArea[c] < 45) continue;
        mc++;
        if (d.area[c] < 0.5 * mArea[c]) robbed++;
      }
      say(`  drainage line cells on corner-lowered cells ${((100 * onLow) / lineCells).toFixed(1)}% (of which not model channel cells ${((100 * lowNotChan) / lineCells).toFixed(1)}%); model channel cells >= 45 km2 left with under half their catchment by the drainage ${((100 * robbed) / mc).toFixed(1)}% of ${mc}`);
    }

    if (env.RA_DUMP && seed === Number(env.RA_DUMP.split(',')[0])) {
      // A window of lattice cells: T, the drainage's height (T after the corner lowering, with the mound), the model's
      // receiver and the drainage's, the model's and the drainage's catchment, and the drainage lines through it.
      const [, dn0, de0, rr] = env.RA_DUMP.split(',').map(Number);
      const ci = Math.round((dn0 - ORIGIN) / DRAIN_CELL);
      const cj = Math.round((de0 - ORIGIN) / DRAIN_CELL);
      const dirName = (c: number, r: number): string => {
        if (r < 0) return '.';
        const di = Math.floor(r / n) - Math.floor(c / n);
        const dj = (r % n) - (c % n);
        return (di > 0 ? 'N' : di < 0 ? 'S' : '') + (dj > 0 ? 'E' : dj < 0 ? 'W' : '');
      };
      const lineAt = new Map<number, number>();
      d.lines.forEach((L, li) => L.cells.forEach((c) => lineAt.has(c) || lineAt.set(c, li)));
      say(`DUMP cells about ${dn0},${de0} (north up; each: T / drainage height | model rec+area | drainage rec+area | line):`);
      for (let i = ci + rr; i >= ci - rr; i--) {
        const row: string[] = [];
        for (let j = cj - rr; j <= cj + rr; j++) {
          const c = i * n + j;
          row.push(`${T[c].toFixed(0)}/${d.height[c].toFixed(0)} ${dirName(c, mRec[c])}${mArea[c].toFixed(0)} ${dirName(c, d.receiver[c])}${d.area[c].toFixed(0)}${lineAt.has(c) && d.area[c] >= 45 ? ` L${lineAt.get(c)}` : ''}`.padEnd(28));
        }
        say(`  N ${ORIGIN + i * DRAIN_CELL}: ${row.join('|')}`);
      }
      say(`  (columns E ${ORIGIN + (cj - rr) * DRAIN_CELL} .. ${ORIGIN + (cj + rr) * DRAIN_CELL}, 1 km apart)`);
    }

    // --- 2. The model's carved courses (buildErosion: smoothed, B-spline pieces), with their carve depth (eroded = T - mound).
    const eroded = new Float32Array(N);
    for (let c = 0; c < N; c++) eroded[c] = T[c] - inp.mound[c];
    const channel: number[] = [];
    const main = new Int32Array(N).fill(-1);
    for (let c = 0; c < N; c++) {
      const r = mRec[c];
      if (mArea[c] < CHANNEL_AREA) continue;
      channel.push(c);
      if (r >= 0 && (main[r] < 0 || mArea[c] > mArea[main[r]])) main[r] = c;
    }
    const pn = new Float64Array(N);
    const pe = new Float64Array(N);
    for (let c = 0; c < N; c++) {
      pn[c] = cellN(c);
      pe[c] = cellE(c);
    }
    const qn = new Float64Array(N);
    const qe = new Float64Array(N);
    for (let pass = 0; pass < COURSE_PASSES; pass++) {
      for (const c of channel) {
        const r = mRec[c];
        const m = main[c];
        if (r < 0 || m < 0) {
          qn[c] = pn[c];
          qe[c] = pe[c];
          continue;
        }
        qn[c] = 0.25 * pn[m] + 0.5 * pn[c] + 0.25 * pn[r];
        qe[c] = 0.25 * pe[m] + 0.5 * pe[c] + 0.25 * pe[r];
      }
      for (const c of channel) {
        pn[c] = qn[c];
        pe[c] = qe[c];
      }
    }
    const MC = new SegIndex(500, 1500);
    const smooth = (e0: number, e1: number, v: number): number => {
      const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    const piece = (a: number, c: number, r: number): void => {
      const strength = smooth(CHANNEL_AREA, 2 * CHANNEL_AREA, mArea[c]);
      const pn0 = 0.5 * (pn[a] + pn[c]);
      const pe0 = 0.5 * (pe[a] + pe[c]);
      const pn2 = 0.5 * (pn[c] + pn[r]);
      const pe2 = 0.5 * (pe[c] + pe[r]);
      const f0 = 0.5 * (eroded[a] + eroded[c]);
      const f1 = eroded[c];
      const f2 = 0.5 * (eroded[c] + Math.max(eroded[r], 0.5));
      let ln = pn0;
      let le = pe0;
      let lx = 0;
      for (let k = 0; k <= PIECE_SAMPLES; k++) {
        const t = k / PIECE_SAMPLES;
        const w0 = (1 - t) * (1 - t);
        const w1 = 2 * t * (1 - t);
        const w2 = t * t;
        const sn = w0 * pn0 + w1 * pn[c] + w2 * pn2;
        const se = w0 * pe0 + w1 * pe[c] + w2 * pe2;
        const fl = w0 * f0 + w1 * f1 + w2 * f2;
        const ex = Math.max(0, bicubic(eroded, n, ORIGIN, DRAIN_CELL, sn, se, true) - fl) * strength;
        if (k > 0) MC.add(ln, le, sn, se, mArea[c], c, Math.max(lx, ex));
        ln = sn;
        le = se;
        lx = ex;
      }
    };
    for (const c of channel) {
      const r = mRec[c];
      if (r < 0) continue;
      let donors = 0;
      const ic = Math.floor(c / n);
      const jc = c % n;
      for (let k = 0; k < 8; k++) {
        const i = ic + DI8[k];
        const j = jc + DJ8[k];
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const q = i * n + j;
        if (mRec[q] !== c || mArea[q] < CHANNEL_AREA) continue;
        donors++;
        piece(q, c, r);
      }
      if (donors === 0) piece(c, c, r);
    }
    // The drainage lines' raw lattice routes (cell centres), each tagged with its line.
    const LR = new SegIndex(500, 1500);
    d.lines.forEach((L, li) => {
      for (let k = 0; k + 1 < L.cells.length; k++) LR.add(cellN(L.cells[k]), cellE(L.cells[k]), cellN(L.cells[k + 1]), cellE(L.cells[k + 1]), L.area[k], li);
    });
    // The slopes' chains (250 m D8), from 1.5 km² (SlopeParams.ac).
    const g = gullyNet();
    const CH = new SegIndex(250, 1500);
    const slopes = model.slopes;
    if (g) {
      for (let q = 0; q < g.dir.length; q++) {
        if (!g.dir[q] || g.area[q] < 1.5) continue;
        const r = receiverOf(g, q);
        CH.add(g.origin + Math.floor(q / g.n) * g.cell, g.origin + (q % g.n) * g.cell, g.origin + Math.floor(r / g.n) * g.cell, g.origin + (r % g.n) * g.cell, g.area[q], 0);
      }
    }
    const wAt = (pnn: number, pee: number): number => {
      if (!slopes) return 0;
      const y = Math.round((pnn - ORIGIN) / CUT_CELL);
      const x = Math.round((pee - ORIGIN) / CUT_CELL);
      if (y < 0 || x < 0 || y >= CUT_N || x >= CUT_N) return 0;
      return slopes.w[y * CUT_N + x] / 255;
    };
    const coreAt = (pnn: number, pee: number): number => {
      if (!slopes) return 0;
      const y = Math.round((pnn - ORIGIN) / CUT_CELL);
      const x = Math.round((pee - ORIGIN) / CUT_CELL);
      if (y < 0 || x < 0 || y >= CUT_N || x >= CUT_N) return 0;
      return slopes.core[y * CUT_N + x] / 255;
    };
    say(`model courses: ${channel.length} channel cells (>= ${CHANNEL_AREA} km2), ${MC.seg.length / 7} piece segments; lattice routes ${LR.seg.length / 7} segments; slope chains (>= 1.5 km2) ${CH.seg.length / 7} segments`);
    {
      // The drainage's own lattice routes (before any wander) against the model's courses.
      const ld: number[] = [];
      const lw: number[] = [];
      const o2 = [0, 0, 0, 0];
      for (const L of d.lines) {
        for (let k = 0; k + 1 < L.cells.length; k++) {
          const a = L.area[k];
          if (a < 45) continue;
          const n0 = cellN(L.cells[k]);
          const e0 = cellE(L.cells[k]);
          const n1 = cellN(L.cells[k + 1]);
          const e1 = cellE(L.cells[k + 1]);
          const len = Math.hypot(n1 - n0, e1 - e0);
          const m = Math.max(1, Math.round(len / 100));
          for (let t = 0; t < m; t++) {
            const f = (t + 0.5) / m;
            const p0 = n0 + (n1 - n0) * f;
            const p1 = e0 + (e1 - e0) * f;
            if (nearHome(p0, p1)) continue;
            ld.push(MC.near(p0, p1, 0.5 * a, 2 * a, o2));
            lw.push(len / m);
          }
        }
      }
      say(`  drainage lattice route (cell centres) -> model course x0.5-2: ${summary(ld, lw)}`);
    }

    // --- 3. Distances, river by river: the drawn channel (hydrology.rivers kind 0, outside lakes) and the valley axis.
    const rivers = hydrology.rivers ?? [];
    const mask = hydrology.lakeMask;
    const o = [0, 0, 0, 0];
    type Acc = { d: number[]; w: number[] };
    const acc = (): Acc => ({ d: [], w: [] });
    const A = {
      chModel: acc(), chModel10: acc(), chModelAny: acc(), chLat: acc(), chLatAny: acc(),
      axModel: acc(), axModel10: acc(), axModelAny: acc(), axLat: acc(),
      mtnChModel: acc(), mtnChChainBand: acc(), mtnChChain10: acc(), mtnAxModel: acc(), mtnAxChain10: acc(), mtnAxChainBand: acc(),
      offChModel: acc(), homeKm: 0, lakeKm: 0,
    } as Record<string, Acc> & { homeKm: number; lakeKm: number };
    const byClass = new Map<string, Acc>();
    const cls = (a: number): string => (a < 100 ? '45-100' : a < 300 ? '100-300' : a < 1000 ? '300-1000' : '>=1000');
    const push = (x: Acc, dist: number, w: number): void => {
      x.d.push(dist);
      x.w.push(w);
    };
    const nR = d.lines.length;
    const perLine: Array<{ li: number; area: number; km: number; off500: number; mtn: number }> = [];
    for (let li = 0; li < Math.min(nR, rivers.length); li++) {
      const r = rivers[li];
      if ((r.kind ?? 0) !== 0 || !r.area) continue;
      let km = 0;
      let off500 = 0;
      let mtn = 0;
      for (let i = 0; i < r.north.length; i++) {
        const w = 0.5 * ((r.s[Math.min(i + 1, r.s.length - 1)] - r.s[Math.max(i - 1, 0)]));
        if (!(w > 0)) continue;
        const pnn = r.north[i];
        const pee = r.east[i];
        if (mask && mask.at(pnn, pee) > -Infinity) {
          A.lakeKm += w;
          continue;
        }
        if (nearHome(pnn, pee)) {
          A.homeKm += w;
          continue;
        }
        const a = r.area[i];
        const dm = MC.near(pnn, pee, 0.5 * a, 2 * a, o);
        push(A.chModel, dm, w);
        push(A.chModel10, MC.near(pnn, pee, 0.5 * a, 2 * a, o, 10), w);
        push(A.chModelAny, MC.near(pnn, pee, CHANNEL_AREA, Infinity, o), w);
        push(A.chLat, nearOwn(LR, pnn, pee, li), w);
        push(A.chLatAny, LR.near(pnn, pee, 0.5 * a, 2 * a, o), w);
        const k = cls(a);
        if (!byClass.has(k)) byClass.set(k, acc());
        push(byClass.get(k)!, dm, w);
        km += w;
        if (dm > 500) off500 += w;
        if (wAt(pnn, pee) > 0) {
          mtn += w;
          push(A.mtnChModel, dm, w);
          push(A.mtnChChainBand, CH.near(pnn, pee, 0.5 * a, 2 * a, o), w);
          push(A.mtnChChain10, CH.near(pnn, pee, 10, Infinity, o), w);
        } else push(A.offChModel, dm, w);
      }
      perLine.push({ li, area: r.area[r.area.length - 1], km, off500, mtn });
    }
    // Axes: area from the line's own lattice route (projected), as riverNetwork.ts interpolates L.area along it.
    for (const [li, ax] of axes) {
      const L = d.lines[li];
      if (!L) continue;
      for (let i = 0; i < ax.north.length; i++) {
        const w = 0.5 * (ax.s[Math.min(i + 1, ax.s.length - 1)] - ax.s[Math.max(i - 1, 0)]);
        if (!(w > 0)) continue;
        const pnn = ax.north[i];
        const pee = ax.east[i];
        if (mask && mask.at(pnn, pee) > -Infinity) continue;
        if (nearHome(pnn, pee)) continue;
        // (Own route: nearest segment of this line, and its area.)
        let best = Infinity;
        let a = L.area[0];
        for (let k = 0; k + 1 < L.cells.length; k++) {
          const n0 = cellN(L.cells[k]);
          const e0 = cellE(L.cells[k]);
          const dn = cellN(L.cells[k + 1]) - n0;
          const de = cellE(L.cells[k + 1]) - e0;
          const l2 = dn * dn + de * de || 1e-9;
          const t = Math.min(1, Math.max(0, ((pnn - n0) * dn + (pee - e0) * de) / l2));
          const dd = Math.hypot(n0 + dn * t - pnn, e0 + de * t - pee);
          if (dd < best) {
            best = dd;
            a = L.area[k] + ((L.area[k + 1] ?? L.area[k]) - L.area[k]) * t;
          }
        }
        push(A.axLat, best, w);
        const dm = MC.near(pnn, pee, 0.5 * a, 2 * a, o);
        push(A.axModel, dm, w);
        push(A.axModel10, MC.near(pnn, pee, 0.5 * a, 2 * a, o, 10), w);
        push(A.axModelAny, MC.near(pnn, pee, CHANNEL_AREA, Infinity, o), w);
        if (wAt(pnn, pee) > 0) {
          push(A.mtnAxModel, dm, w);
          push(A.mtnAxChain10, CH.near(pnn, pee, 10, Infinity, o), w);
          push(A.mtnAxChainBand, CH.near(pnn, pee, 0.5 * a, 2 * a, o), w);
        }
      }
    }
    say(`RIVERS (kind 0) outside lakes and 3.5 km of home; skipped ${(A.lakeKm / 1000).toFixed(0)} km in lakes, ${(A.homeKm / 1000).toFixed(0)} km by home`);
    say(`  drawn channel -> model course x0.5-2 catchment:   ${summary(A.chModel.d, A.chModel.w)}`);
    say(`  drawn channel -> ... with carve >= 10 m there:    ${summary(A.chModel10.d, A.chModel10.w)}`);
    say(`  drawn channel -> any model course (>= 30 km2):    ${summary(A.chModelAny.d, A.chModelAny.w)}`);
    say(`  drawn channel -> own lattice route (cell centres): ${summary(A.chLat.d, A.chLat.w)}`);
    say(`  drawn channel -> any lattice route x0.5-2:        ${summary(A.chLatAny.d, A.chLatAny.w)}`);
    say(`  valley axis   -> model course x0.5-2 catchment:   ${summary(A.axModel.d, A.axModel.w)}`);
    say(`  valley axis   -> ... with carve >= 10 m there:    ${summary(A.axModel10.d, A.axModel10.w)}`);
    say(`  valley axis   -> any model course (>= 30 km2):    ${summary(A.axModelAny.d, A.axModelAny.w)}`);
    say(`  valley axis   -> own lattice route (cell centres): ${summary(A.axLat.d, A.axLat.w)}`);
    for (const k of ['45-100', '100-300', '300-1000', '>=1000']) {
      const x = byClass.get(k);
      if (x) say(`  channel -> model x0.5-2, catchment ${k} km2: ${summary(x.d, x.w)}`);
    }
    say(`  IN THE SLOPES' MASK (w > 0): channel -> model x0.5-2 ${summary(A.mtnChModel.d, A.mtnChModel.w)}`);
    say(`     channel -> slopes' chain x0.5-2 (pass-only area) ${summary(A.mtnChChainBand.d, A.mtnChChainBand.w)}`);
    say(`     channel -> slopes' chain >= 10 km2              ${summary(A.mtnChChain10.d, A.mtnChChain10.w)}`);
    say(`     axis    -> model x0.5-2                         ${summary(A.mtnAxModel.d, A.mtnAxModel.w)}`);
    say(`     axis    -> slopes' chain x0.5-2                 ${summary(A.mtnAxChainBand.d, A.mtnAxChainBand.w)}`);
    say(`     axis    -> slopes' chain >= 10 km2              ${summary(A.mtnAxChain10.d, A.mtnAxChain10.w)}`);
    say(`  OUTSIDE THE MASK: channel -> model x0.5-2 ${summary(A.offChModel.d, A.offChModel.w)}`);
    perLine.sort((a, b) => b.off500 - a.off500);
    say(`  lines with most channel > 500 m off the model course: ${perLine.slice(0, 12).map((p) => `${p.li} (${p.area.toFixed(0)} km2, ${(p.off500 / 1000).toFixed(1)}/${(p.km / 1000).toFixed(1)} km${p.mtn > 0 ? `, mtn ${(p.mtn / 1000).toFixed(1)}` : ''})`).join('; ')}`);

    // Why a river sample is off the model's course: its own lattice route is already off it there (the routing), or the
    // route is on it and the wander / meander took the channel off (the laying). Every river km, and the shelf reaches
    // wallsGate found (finalR walls-s<seed>.json, river reaches whose worst point stands > 30 m over the floor beside).
    {
      const proj = [0, 0, 0];
      const classify = (li: number, pnn: number, pee: number, a: number): number => {
        if (MC.near(pnn, pee, 0.5 * a, 2 * a, o) <= 250) return 0;
        ownProj(LR, pnn, pee, li, proj);
        if (proj[2] === Infinity) return 3;
        return MC.near(proj[0], proj[1], 0.5 * a, 2 * a, o) > 250 ? 1 : 2;
      };
      const names = ['on the model course (<= 250 m)', 'off: its lattice route is off too', 'off: route on it, laid off (wander/meander)', 'no own route in reach'];
      const all = [0, 0, 0, 0];
      for (let li = 0; li < Math.min(nR, rivers.length); li++) {
        const r = rivers[li];
        if ((r.kind ?? 0) !== 0 || !r.area) continue;
        let last = -Infinity;
        for (let i = 0; i < r.north.length; i++) {
          if (r.s[i] - last < 50) continue;
          const w = last === -Infinity ? 0 : r.s[i] - last;
          last = r.s[i];
          if ((mask && mask.at(r.north[i], r.east[i]) > -Infinity) || nearHome(r.north[i], r.east[i])) continue;
          all[classify(li, r.north[i], r.east[i], r.area[i])] += w;
        }
      }
      const tot = all.reduce((x, y) => x + y, 0);
      say(`WHY OFF (every river km, 50 m steps, ${(tot / 1000).toFixed(0)} km): ${all.map((v, k) => `${names[k]} ${((100 * v) / tot).toFixed(1)}%`).join('; ')}`);
      const wf = `${env.RA_WALLS ?? ''}/walls-s${seed}.json`;
      if (env.RA_WALLS && existsSync(wf)) {
        const reaches = (JSON.parse(readFileSync(wf, 'utf8')).part2.reaches as Array<{ kind: string; line: number; s0: number; len: number; valley: number }>).filter((x) => x.kind === 'river' && x.valley > 30);
        const sh = [0, 0, 0, 0];
        for (const x of reaches) {
          const r = rivers[x.line];
          if (!r || !r.area) continue;
          let i = 0;
          for (let s = x.s0; s <= x.s0 + x.len; s += 50) {
            while (i < r.s.length - 1 && r.s[i + 1] <= s) i++;
            sh[classify(x.line, r.north[i], r.east[i], r.area[i])] += 50;
          }
        }
        const t2 = sh.reduce((x, y) => x + y, 0);
        say(`WHY OFF (shelf reaches, worst > 30 m over the floor: ${reaches.length} reaches, ${(t2 / 1000).toFixed(0)} km): ${sh.map((v, k) => `${names[k]} ${((100 * v) / t2).toFixed(1)}%`).join('; ')}`);
      }
    }

    // Doubled valleys: traced streams (kind 1) of >= 20 km² running beside a river (kind 0) of x0.5-2 their catchment,
    // more than 1.5 km above their own mouth; and whether the stream or the river lies on the model's course there.
    {
      const RV = new SegIndex(500, 1500);
      for (let li = 0; li < rivers.length; li++) {
        const r = rivers[li];
        if ((r.kind ?? 0) !== 0 || !r.area) continue;
        for (let i = 0; i + 1 < r.north.length; i++) RV.add(r.north[i], r.east[i], r.north[i + 1], r.east[i + 1], r.area[i], li);
      }
      let near300 = 0;
      let par = 0;
      let parStreamOnModel = 0;
      let parRiverOnModel = 0;
      let streamKm = 0;
      const o3 = [0, 0, 0, 0];
      for (let li = 0; li < rivers.length; li++) {
        const r = rivers[li];
        if ((r.kind ?? 0) !== 1 || !r.area) continue;
        const end = r.s[r.s.length - 1];
        for (let i = 0; i < r.north.length; i++) {
          const a = r.area[i];
          if (a < 20 || end - r.s[i] < 1500) continue;
          const w = 0.5 * (r.s[Math.min(i + 1, r.s.length - 1)] - r.s[Math.max(i - 1, 0)]);
          if (!(w > 0)) continue;
          if (mask && mask.at(r.north[i], r.east[i]) > -Infinity) continue;
          streamKm += w;
          const dv = RV.near(r.north[i], r.east[i], 0.5 * a, 2 * a, o3);
          if (dv <= 300) near300 += w;
          else if (dv <= 1000) {
            par += w;
            if (MC.near(r.north[i], r.east[i], 0.5 * a, 2 * a, o) <= 150) parStreamOnModel += w;
            // The river's sample nearest: on the model's course?
            const rl = rivers[o3[2]];
            let bi = 0;
            let bd = Infinity;
            for (let k = 0; k < rl.north.length; k += 2) {
              const dd = Math.hypot(rl.north[k] - r.north[i], rl.east[k] - r.east[i]);
              if (dd < bd) (bd = dd), (bi = k);
            }
            const ra = rl.area?.[bi] ?? a;
            if (MC.near(rl.north[bi], rl.east[bi], 0.5 * ra, 2 * ra, o) <= 150) parRiverOnModel += w;
          }
        }
      }
      say(`DOUBLED: traced streams >= 20 km2 (not their last 1.5 km, not in lakes) ${(streamKm / 1000).toFixed(0)} km; within 300 m of a river of x0.5-2 their catchment ${(near300 / 1000).toFixed(0)} km; 300-1000 m beside one ${(par / 1000).toFixed(0)} km, of which the stream is on the model's course (<= 150 m) ${(parStreamOnModel / 1000).toFixed(0)} km and the river is ${(parRiverOnModel / 1000).toFixed(0)} km`);
    }

    // --- 4. The owner's valley (seed 42): river 64 and line 517.
    if (seed === 42) {
      const box = (pnn: number, pee: number): boolean => pnn > -15000 && pnn < -10000 && pee > -44500 && pee < -39000;
      for (const li of [64, 517]) {
        const r = rivers[li];
        if (!r) continue;
        say(`OWNER line ${li} kind ${r.kind} (N, E, area, model x0.5-2 dist/area, any model dist/area/carve, slopes' chain >= 10 dist/area, w, core, other line 64/517 dist):`);
        let last = -Infinity;
        const other = rivers[li === 64 ? 517 : 64];
        for (let i = 0; i < r.north.length; i++) {
          if (!box(r.north[i], r.east[i]) || r.s[i] - last < 250) continue;
          last = r.s[i];
          const a = r.area![i];
          const dm = MC.near(r.north[i], r.east[i], 0.5 * a, 2 * a, o);
          const am = o[1];
          const da = MC.near(r.north[i], r.east[i], CHANNEL_AREA, Infinity, o);
          const aa = o[1];
          const xa = o[3];
          const dc = CH.near(r.north[i], r.east[i], 10, Infinity, o);
          const ac = o[1];
          let dOther = Infinity;
          if (other) for (let k = 0; k < other.north.length; k++) dOther = Math.min(dOther, Math.hypot(other.north[k] - r.north[i], other.east[k] - r.east[i]));
          say(`  ${Math.round(r.north[i])},${Math.round(r.east[i])} A ${a.toFixed(1)} | model ${fmt(dm)} (${am.toFixed(0)}) | any ${fmt(da)} (${aa.toFixed(0)}, carve ${xa.toFixed(0)} m) | chain ${fmt(dc)} (${ac.toFixed(0)}) | w ${wAt(r.north[i], r.east[i]).toFixed(2)} core ${coreAt(r.north[i], r.east[i]).toFixed(2)} | other ${fmt(dOther)}`);
        }
      }
      const ax = axes.get(64);
      if (ax) {
        say('OWNER river 64 axis vs channel vs model (every 500 m in the box):');
        let last = -Infinity;
        for (let i = 0; i < ax.north.length; i++) {
          if (!box(ax.north[i], ax.east[i]) || ax.s[i] - last < 500) continue;
          last = ax.s[i];
          const dm = MC.near(ax.north[i], ax.east[i], CHANNEL_AREA, Infinity, o);
          say(`  axis ${Math.round(ax.north[i])},${Math.round(ax.east[i])}: any model course ${fmt(dm)} (${o[1].toFixed(0)} km2, carve ${o[3].toFixed(0)} m); own lattice route ${fmt(nearOwn(LR, ax.north[i], ax.east[i], 64))}`);
        }
      }
    }

    // --- 5. Lakes: the model's own closed lows on T (filled over T by > 0.5 m), against the drainage's lakes, and the
    // pools LakeMask draws (the drainage's ponds flooded on the 250 m raster, and the stream ponds added after).
    const low = new Int32Array(N).fill(-1);
    const lows: Array<{ cells: number[]; depth: number; area: number }> = [];
    for (let c0 = 0; c0 < N; c0++) {
      if (low[c0] >= 0 || inp.fixed[c0] || mFilled[c0] - T[c0] <= 0.5) continue;
      const id = lows.length;
      const cells: number[] = [];
      const st = [c0];
      low[c0] = id;
      let depth = 0;
      let area = 0;
      while (st.length) {
        const c = st.pop()!;
        cells.push(c);
        depth = Math.max(depth, mFilled[c] - T[c]);
        area = Math.max(area, mArea[c]);
        const i = Math.floor(c / n);
        const j = c % n;
        for (let k = 0; k < 8; k++) {
          const ii = i + DI8[k];
          const jj = j + DJ8[k];
          if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
          const q = ii * n + jj;
          if (low[q] >= 0 || inp.fixed[q] || mFilled[q] - T[q] <= 0.5) continue;
          low[q] = id;
          st.push(q);
        }
      }
      lows.push({ cells, depth, area });
    }
    const deepLows = lows.filter((l) => l.depth >= 15).length;
    // Distance from a point to the nearest model-low cell's square (+-500 m; 0 inside one).
    const lowDist = (pnn: number, pee: number): number => {
      const ci = Math.round((pnn - ORIGIN) / DRAIN_CELL);
      const cj = Math.round((pee - ORIGIN) / DRAIN_CELL);
      let best = Infinity;
      for (let di = -3; di <= 3; di++)
        for (let dj = -3; dj <= 3; dj++) {
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= n || j >= n || low[i * n + j] < 0) continue;
          const dn = Math.max(0, Math.abs(pnn - (ORIGIN + i * DRAIN_CELL)) - 500);
          const de = Math.max(0, Math.abs(pee - (ORIGIN + j * DRAIN_CELL)) - 500);
          best = Math.min(best, Math.hypot(dn, de));
        }
      return best;
    };
    say(`LAKES: model closed lows on T (filled > 0.5 m) ${lows.length} (>= 15 m deep ${deepLows}); kept hollows (modelInputs) ${inp.lakes}`);
    const kinds = { river: 0, tarn: 0, dry: 0 };
    const inLow = { river: 0, tarn: 0, dry: 0 };
    const lowsUsed = new Set<number>();
    for (const l of d.lakes) {
      const k = l.tarn ? 'tarn' : l.river ? 'river' : 'dry';
      kinds[k]++;
      let hit = -1;
      for (const c of l.cells) if (low[c] >= 0) hit = low[c];
      if (hit >= 0) {
        inLow[k]++;
        lowsUsed.add(hit);
      }
    }
    {
      // The model's lows the drainage holds no lake in: why (cut through by its breach, cut out as too shallow/small, or other).
      const why2 = { breached: 0, cutOut: 0, pondCap: 0, other: 0 };
      let otherDepth = 0;
      lows.forEach((l, id) => {
        if (lowsUsed.has(id)) return;
        let w = 0;
        for (const c of l.cells) w = Math.max(w, d.cutWhy[c]);
        // (Its rim: the cells about it that the drainage cut.)
        if (!w)
          for (const c of l.cells) {
            const i = Math.floor(c / n);
            const j = c % n;
            for (let k = 0; k < 8; k++) {
              const q = (i + DI8[k]) * n + j + DJ8[k];
              if (q >= 0 && q < N && low[q] !== id) w = Math.max(w, d.cutWhy[q]);
            }
          }
        if (w === 1) why2.breached++;
        else if (w === 3) why2.cutOut++;
        else if (w === 2) why2.pondCap++;
        else {
          why2.other++;
          otherDepth = Math.max(otherDepth, l.depth);
        }
      });
      say(`  model lows with no drainage lake: ${JSON.stringify(why2)} (cutWhy 1 breach within allowance, 3 pond cut out to its bottom, 2 cut to keep a pond within POND_MAX_CELLS); deepest 'other' ${otherDepth.toFixed(1)} m`);
    }
    say(`  drainage lakes ${d.lakes.length}: river ${kinds.river}, tarn ${kinds.tarn}, no river ${kinds.dry}; with a cell in a model low: river ${inLow.river}, tarn ${inLow.tarn}, no river ${inLow.dry}; model lows holding a drainage lake ${lowsUsed.size}/${lows.length}`);
    if (mask) {
      const pd: number[] = [];
      const pw: number[] = [];
      const sd: number[] = [];
      const sw: number[] = [];
      let poolsD = 0;
      let poolsS = 0;
      let areaD = 0;
      let areaS = 0;
      let subPools = 0;
      const mainSet = new Set<number>(Array.from(mask.main).filter((x) => x >= 0));
      mask.pools.forEach((p, id) => {
        if (p.drained || p.wet <= 0) return;
        const a = (p.wet * 250 * 250) / 1e6;
        const dist = lowDist(p.centreNorth, p.centreEast);
        if (p.lake < d.lakes.length) {
          poolsD++;
          areaD += a;
          if (!mainSet.has(id)) subPools++;
          pd.push(dist);
          pw.push(1);
        } else {
          poolsS++;
          areaS += a;
          sd.push(dist);
          sw.push(1);
        }
      });
      const share = (x: number[], b: number): string => `${((100 * x.filter((v) => v <= b).length) / Math.max(1, x.length)).toFixed(0)}%`;
      say(`  LakeMask pools from the drainage's ponds: ${poolsD} (${subPools} sub-pools), ${areaD.toFixed(1)} km2; centre in a model low ${share(pd, 0)}, within 250 m ${share(pd, 250)}, 500 m ${share(pd, 500)}, 1000 m ${share(pd, 1000)}`);
      say(`  LakeMask pools added after (streams.ts ponds): ${poolsS}, ${areaS.toFixed(1)} km2; centre in a model low ${share(sd, 0)}, within 250 m ${share(sd, 250)}, 500 m ${share(sd, 500)}, 1000 m ${share(sd, 1000)}`);
      const drained = mask.pools.filter((p) => p.drained).length;
      say(`  pools drained by the river levels (drainPond): ${drained}; LakeMask leaky (left dry): ${mask.leaky.length}`);
    }
    const report = hydrology.streamReport as unknown as { pools?: number; riverPools?: number } | undefined;
    if (report) say(`  streams.ts report: pools ${report.pools}, riverPools ${report.riverPools}`);
    writeFileSync(`${OUT}/s${seed}.log`, log.join('\n') + '\n');
  }
  setWorldSeed(0);
});

function fmt(x: number): string {
  return x === Infinity ? '>1500' : `${Math.round(x)}`;
}
/** Distance to line li's own lattice route (any segment tagged li within reach). */
function nearOwn(ix: SegIndex, pn: number, pe: number, li: number): number {
  const b = ix.buckets.get(Math.floor((pn - ORIGIN) / ix.cell) * 4096 + Math.floor((pe - ORIGIN) / ix.cell));
  if (!b) return Infinity;
  let best = Infinity;
  const s = ix.seg;
  for (const k of b) {
    const o = 7 * k;
    if (s[o + 5] !== li) continue;
    const n0 = s[o];
    const e0 = s[o + 1];
    const dn = s[o + 2] - n0;
    const de = s[o + 3] - e0;
    const l2 = dn * dn + de * de || 1e-9;
    const t = Math.min(1, Math.max(0, ((pn - n0) * dn + (pe - e0) * de) / l2));
    best = Math.min(best, Math.hypot(n0 + dn * t - pn, e0 + de * t - pe));
  }
  return best;
}
/** The nearest point of line li's own lattice route: out [north, east, dist]. */
function ownProj(ix: SegIndex, pn: number, pe: number, li: number, out: number[]): void {
  out[0] = pn;
  out[1] = pe;
  out[2] = Infinity;
  const b = ix.buckets.get(Math.floor((pn - ORIGIN) / ix.cell) * 4096 + Math.floor((pe - ORIGIN) / ix.cell));
  if (!b) return;
  const s = ix.seg;
  for (const k of b) {
    const o = 7 * k;
    if (s[o + 5] !== li) continue;
    const n0 = s[o];
    const e0 = s[o + 1];
    const dn = s[o + 2] - n0;
    const de = s[o + 3] - e0;
    const l2 = dn * dn + de * de || 1e-9;
    const t = Math.min(1, Math.max(0, ((pn - n0) * dn + (pe - e0) * de) / l2));
    const dd = Math.hypot(n0 + dn * t - pn, e0 + de * t - pe);
    if (dd < out[2]) {
      out[0] = n0 + dn * t;
      out[1] = e0 + de * t;
      out[2] = dd;
    }
  }
}
