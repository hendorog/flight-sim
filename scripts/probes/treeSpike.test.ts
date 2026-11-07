// Probe-only spike (out/tree/PLAN.md task 2): a long stream-power evolution of a seeded world's lattice with an uplift
// field, flow routed again every step so rivers can capture their neighbours, then the drainage-tree measures
// (treeMetrics.ts) on the result. Nothing here is wired into the game.
//
// The model, per step (Braun & Willett 2013, the implicit scheme of erosion.ts erodeLattice):
//   1. route: priority flood from the sea and the domain's edge, then steepest descent (distance-weighted D8) on the
//      filled surface; cells in a filled hollow drain toward its spill;
//   2. uplift: h += U dt on land (the sea and the domain's edge are base level, fixed);
//   3. stream power, n = 1, downstream first: h_i <- (h_i + F h_r) / (1 + F), F = K dt A^m / L, never below the
//      receiver plus a minimum grade (GRADE A^-0.45 per km: a graded gravel river, standing in for deposition on the
//      plains, where U is about 0 and a detachment-only model would otherwise plane the land down to the sea);
//   4. threshold slope: no cell stands more than SC x distance above a lower neighbour (at 1 km this only touches
//      ridge cells; hillslope diffusion at real rates, ~0.01 m²/yr, is negligible at 1 km and is left out).
// Units: per step, U dt = SPIKE_U m at the top of the ranges; K dt is set by SPIKE_RIDGE, the steady drop over 1 km of
// a one-cell (1 km²) catchment where U is full: K dt = SPIKE_U / SPIKE_RIDGE (A in km²).
//
// Variants (SPIKE_VARIANTS):
//   low       start from the coast's profile plus 0.1 of the noise relief; U from the ranges (uplift) and the hill
//             country (hill amplitude); K uniform.
//   full      start from the full noise relief (today's ground), same U and K: how much does the start pattern stay?
//   knoise    as low, with erodibility from the noise: where the noise relief stands high the rock is hard (K / 4 ..
//             K x 4), so the old noise ridges become resistant ridges.
//   broad     as low, with a broader uplift: the ranges plus half the foothill belt, so the ranges are wider blocks.
//   widefull  the wide uplift, started from the full noise relief (today's ground and drainage tree).
//   block     the wide orogen for the first half of the run, then a front range rising across the rivers' way out
//             (frontBlock): do the big rivers hold gorges through it while the small ones are turned aside to join
//             them behind it (the Rakaia's gorge through the Mt Hutt front)?
//   wide      as low, with the ranges' uplift spread into wide massifs (a Gaussian blur of the uplift field, sigma
//             WIDE_SIGMA km, scaled so its broad crests rise at full rate): an orogen some 40-80 km across whose
//             highest crests still follow the ridged-noise belts.
// Each result is measured against the generator's field classes (the narrow ridged-noise belts as "mountain"), against
// an uplift class (mountain where the variant's U >= UPLIFT_MTN of its peak rate, so a wider orogen has a wider front)
// and against relief classes on the result.
//   SPIKE_SEEDS=42 SPIKE_VARIANTS=low,full SPIKE_STEPS=1500 npx vitest run --config scripts/probes/vitest.config.ts scripts/probes/treeSpike.test.ts --silent=false
import { it } from 'vitest';
import { buildDrainage, DOMAIN_HALF, DRAIN_CELL } from '../../src/world/terrain/drainage';
import { naturalHeightRaw } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { CLASS_MTN, CLASS_HILL, CLASS_SEA, fieldClasses, macroFields, measureTree, quant, reliefClasses, renderTree, Router, type Fields } from './treeMetrics';
import { png } from './png';

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: Uint8Array | string): void; mkdirSync(p: string, o: { recursive: boolean }): void; appendFileSync(p: string, d: string): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

const n = Math.round((2 * DOMAIN_HALF) / DRAIN_CELL) + 1;
const N = n * n;
const origin = -DOMAIN_HALF;
const U = Number(env.SPIKE_U ?? 5);
const RIDGE = Number(env.SPIKE_RIDGE ?? 450);
const WIDE_SIGMA = Number(env.SPIKE_WIDE_SIGMA ?? 12);
const UPLIFT_MTN = 0.3;
const M = Number(env.SPIKE_M ?? 0.45);
const SC = Number(env.SPIKE_SC ?? 0.6);
const GRADE = Number(env.SPIKE_GRADE ?? 0.06);
const STEPS = Number(env.SPIKE_STEPS ?? 800);
const LAND_MIN = 0.5;
const MODE = env.SPIKE_MODE ?? 'time';
const SS_ITER = Number(env.SPIKE_SS_ITER ?? 30);
const DI = [-1, -1, -1, 0, 0, 1, 1, 1];
const DJ = [-1, 0, 1, -1, 1, -1, 0, 1];

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
/** heightfield.ts coastProfile (the seeded ground's broad rise inland), m. */
function coastProfile(inland: number): number {
  if (inland >= 0) return 150 * (1 - Math.exp(-inland / 7000));
  const off = -inland;
  return -80 * (1 - Math.exp(-off / 5000)) - 320 * smooth(8000, 40000, off);
}

interface Run {
  h: Float32Array;
  msRoute: number;
  msSolve: number;
  steps: number;
  log: string[];
}

/** Separable Gaussian blur of a lattice field, sigma in cells. */
function blur(v: Float32Array, sigma: number): Float32Array {
  const R = Math.ceil(3 * sigma);
  const w = Array.from({ length: 2 * R + 1 }, (_, k) => Math.exp(-((k - R) ** 2) / (2 * sigma * sigma)));
  const tmp = new Float32Array(N);
  const out = new Float32Array(N);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    let s = 0, ws = 0;
    for (let k = -R; k <= R; k++) { const jj = j + k; if (jj < 0 || jj >= n) continue; s += w[k + R] * v[i * n + jj]; ws += w[k + R]; }
    tmp[i * n + j] = s / ws;
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    let s = 0, ws = 0;
    for (let k = -R; k <= R; k++) { const ii = i + k; if (ii < 0 || ii >= n) continue; s += w[k + R] * tmp[ii * n + j]; ws += w[k + R]; }
    out[i * n + j] = s / ws;
  }
  return out;
}

/**
 * The 'block' variant's late front range: land outside the wide orogen (wide uplift < UPLIFT_MTN of peak) lying
 * BLOCK_NEAR..BLOCK_FAR km from it, away from the coast (inland > 15 km). It rises at BLOCK_RATE of the peak rate,
 * but only over the second half of the run: the rivers already flowing out of the orogen across it either keep their
 * course (an antecedent gorge, where their stream power outpaces its rise) or are turned aside along its back.
 */
const BLOCK_NEAR = 3;
const BLOCK_FAR = 12;
const BLOCK_RATE = 0.6;
function frontBlock(f: Fields): Uint8Array {
  const wide = rangeUplift('wide', f);
  const d = new Float32Array(N).fill(Infinity);
  for (let c = 0; c < N; c++) if (wide[c] >= UPLIFT_MTN) d[c] = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let k0 = 0; k0 < N; k0++) {
      const c = pass === 0 ? k0 : N - 1 - k0;
      if (d[c] === 0) continue;
      const i = (c / n) | 0, j = c - i * n;
      for (let q = 0; q < 8; q++) {
        const ii = i + DI[q], jj = j + DJ[q];
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const v = d[ii * n + jj] + (DI[q] && DJ[q] ? Math.SQRT2 : 1);
        if (v < d[c]) d[c] = v;
      }
    }
  }
  const b = new Uint8Array(N);
  for (let c = 0; c < N; c++) if (d[c] >= BLOCK_NEAR && d[c] <= BLOCK_FAR && f.inland[c] > 15000) b[c] = 1;
  return b;
}

/** The variant's range uplift, 0..1 of the peak rate ('block': the wide orogen; its front block is added in evolve). */
function rangeUplift(variant: string, f: Fields): Float32Array {
  if (variant === 'widefull') return rangeUplift('wide', f);
  if (variant === 'block') {
    const w = rangeUplift('wide', f);
    const b = frontBlock(f);
    for (let c = 0; c < N; c++) if (b[c]) w[c] = Math.max(w[c], BLOCK_RATE);
    return w;
  }
  const r = new Float32Array(N);
  for (let c = 0; c < N; c++) r[c] = variant === 'broad' ? Math.min(1, f.uplift[c] / 1.15 + 0.5 * f.foothill[c]) : f.uplift[c] / 1.15;
  if (variant !== 'wide') return r;
  const b = blur(r, WIDE_SIGMA);
  let top = 0;
  for (let c = 0; c < N; c++) top = Math.max(top, b[c]);
  // Broad crests at full rate: the blurred field scaled so its upper part saturates, the belts themselves kept.
  for (let c = 0; c < N; c++) r[c] = Math.max(r[c], Math.min(1, (2.2 * b[c]) / top));
  return r;
}

function evolve(variant: string, raw: Float32Array, f: Fields, fixed: Uint8Array): Run {
  const h = new Float32Array(N);
  const up = new Float32Array(N);
  const rngU = rangeUplift(variant === 'block' || variant === 'widefull' ? 'wide' : variant, f);
  const block = variant === 'block' ? frontBlock(f) : null;
  const upBlock = new Float32Array(N);
  const kf = new Float32Array(N).fill(1);
  for (let c = 0; c < N; c++) {
    const coast = coastProfile(f.inland[c]);
    if (fixed[c]) {
      h[c] = raw[c];
      continue;
    }
    h[c] = variant === 'full' || variant === 'widefull' ? raw[c] : Math.max(LAND_MIN, coast + 0.1 * (raw[c] - coast));
    up[c] = U * (rngU[c] + (0.2 * f.hillAmp[c]) / 830) * smooth(0, 15000, f.inland[c]);
    if (block && block[c]) upBlock[c] = Math.max(0, U * BLOCK_RATE - up[c]);
    if (variant === 'knoise') {
      const z = Math.max(-1, Math.min(1, (raw[c] - coast) / (100 + 3100 * f.uplift[c] + f.hillAmp[c])));
      kf[c] = Math.pow(2, -2 * (z - 0.25));
    }
  }
  const kdt = U / RIDGE;
  const R = new Router(n, DRAIN_CELL);
  const prevRec = new Int32Array(N).fill(-2);
  const snap = h.slice();
  const log: string[] = [];
  let msRoute = 0, msSolve = 0, changed = 0;
  let land = 0;
  let upSum = 0;
  for (let c = 0; c < N; c++) if (!fixed[c]) (land++, (upSum += up[c]));
  // SPIKE_MODE=ss: no time stepping; route, then set every cell to its steady-state height above its receiver
  // (n = 1: erosion = uplift, so S = U / (K A^m), downstream first), and route again, SS_ITER times (the fast
  // steady-state iteration of Cordonnier et al. 2016). Captures happen between iterations as the heights change.
  if (MODE === 'ss') {
    for (let s = 1; s <= SS_ITER; s++) {
      const t0 = performance.now();
      R.route(h, fixed);
      const t1 = performance.now();
      const { receiver, order, area } = R;
      for (let c = 0; c < N; c++) {
        if (!fixed[c] && prevRec[c] !== -2 && prevRec[c] !== receiver[c] && area[c] >= 10) changed++;
        prevRec[c] = receiver[c];
      }
      for (let k = 0; k < N; k++) {
        const c = order[k];
        const r = receiver[c];
        if (r < 0 || fixed[c]) continue;
        const ci = (c / n) | 0, ri = (r / n) | 0;
        const dist = ci !== ri && c - ci * n !== r - ri * n ? Math.SQRT2 : 1;
        const a = area[c];
        const rise = Math.max(up[c] / (kdt * kf[c] * Math.pow(a, M)), GRADE * Math.pow(a, -0.45) * DRAIN_CELL / 1000) * dist;
        h[c] = Math.max(h[r], LAND_MIN) + Math.min(rise, SC * DRAIN_CELL * dist);
      }
      const t2 = performance.now();
      msRoute += t1 - t0;
      msSolve += t2 - t1;
      let top = 0;
      for (let c = 0; c < N; c++) if (!fixed[c]) top = Math.max(top, h[c]);
      log.push(`    iteration ${s}: highest ${top.toFixed(0)} m; receivers changed (A >= 10 km²) ${changed}`);
      changed = 0;
    }
    return { h, msRoute, msSolve, steps: SS_ITER, log };
  }
  for (let s = 1; s <= STEPS; s++) {
    const t0 = performance.now();
    R.route(h, fixed);
    const t1 = performance.now();
    const { receiver, order, area } = R;
    for (let c = 0; c < N; c++) {
      if (!fixed[c] && prevRec[c] !== -2 && prevRec[c] !== receiver[c] && area[c] >= 10) changed++;
      prevRec[c] = receiver[c];
    }
    for (let c = 0; c < N; c++) if (!fixed[c]) h[c] += up[c];
    if (block && s > STEPS / 2) for (let c = 0; c < N; c++) if (!fixed[c]) h[c] += upBlock[c];
    for (let k = 0; k < N; k++) {
      const c = order[k];
      const r = receiver[c];
      if (r < 0 || fixed[c]) continue;
      const hr = Math.max(h[r], LAND_MIN);
      const hc = h[c];
      if (hc <= hr) continue;
      const ci = (c / n) | 0, ri = (r / n) | 0;
      const diag = ci !== ri && c - ci * n !== r - ri * n;
      const a = area[c];
      const F = (diag ? kdt / Math.SQRT2 : kdt) * kf[c] * Math.pow(a, M);
      const floor = hr + GRADE * Math.pow(a, -0.45) * (diag ? Math.SQRT2 : 1) * DRAIN_CELL / 1000 * 1;
      if (hc <= floor) continue;
      h[c] = Math.max(floor, (hc + F * hr) / (1 + F));
    }
    // Threshold slope, downstream first.
    for (let k = 0; k < N; k++) {
      const c = order[k];
      if (fixed[c]) continue;
      const i = (c / n) | 0, j = c - i * n;
      let hc = h[c];
      for (let q = 0; q < 8; q++) {
        const ii = i + DI[q], jj = j + DJ[q];
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const v = h[ii * n + jj] + SC * DRAIN_CELL * (DI[q] && DJ[q] ? Math.SQRT2 : 1);
        if (v < hc) hc = v;
      }
      h[c] = Math.max(LAND_MIN, hc);
    }
    const t2 = performance.now();
    msRoute += t1 - t0;
    msSolve += t2 - t1;
    if (s % 100 === 0 || s === STEPS) {
      let dh = 0, top = 0;
      for (let c = 0; c < N; c++) if (!fixed[c]) (dh += h[c] - snap[c]), (top = Math.max(top, h[c]));
      const rate = dh / 100 / upSum;
      log.push(`    step ${s}: mean rise per step ${(100 * rate).toFixed(1)} % of mean uplift; highest ${top.toFixed(0)} m; receivers changed (A >= 10 km²) ${changed} in the last 100 steps`);
      snap.set(h);
      changed = 0;
    }
  }
  return { h, msRoute, msSolve, steps: STEPS, log };
}

function stats(h: Float32Array, raw: Float32Array, cls: Uint8Array, fixed: Uint8Array): string {
  const mt: number[] = [];
  const sl: number[] = [];
  let above = 0, aboveSum = 0, land = 0;
  for (let c = 0; c < N; c++) {
    if (fixed[c]) continue;
    land++;
    if (h[c] > raw[c]) (above++, (aboveSum += h[c] - raw[c]));
    if (cls[c] !== CLASS_MTN) continue;
    mt.push(h[c]);
    const i = (c / n) | 0, j = c - i * n;
    if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) continue;
    const gx = (h[c + 1] - h[c - 1]) / 2000, gy = (h[c + n] - h[c - n]) / 2000;
    sl.push((Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI);
  }
  return `mountain ground p50/p90/max ${quant(mt, 0.5).toFixed(0)}/${quant(mt, 0.9).toFixed(0)}/${quant(mt, 1).toFixed(0)} m, 1 km slope p50/p90 ${quant(sl, 0.5).toFixed(1)}/${quant(sl, 0.9).toFixed(1)}°; land above today's noise ground ${((100 * above) / land).toFixed(0)} % (mean ${(aboveSum / Math.max(1, above)).toFixed(0)} m there)`;
}

it('tree spike', () => {
  const dir = env.SPIKE_OUT ?? 'out/tree';
  fs.mkdirSync(`${dir}/png`, { recursive: true });
  const report = `${dir}/spike.txt`;
  for (const seed of (env.SPIKE_SEEDS ?? '42').split(',')) {
    setWorldSeed(seed);
    const f = macroFields(n, origin, DRAIN_CELL);
    const raw = new Float32Array(N);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) raw[i * n + j] = naturalHeightRaw(origin + i * DRAIN_CELL, origin + j * DRAIN_CELL, false);
    const fixed = new Uint8Array(N);
    for (let c = 0; c < N; c++) {
      const i = (c / n) | 0, j = c - i * n;
      if (raw[c] <= 0 || i === 0 || j === 0 || i === n - 1 || j === n - 1) fixed[c] = 1;
    }
    const isSea = (c: number): boolean => raw[c] <= 0;
    const clsF = fieldClasses(n, f, raw);
    // Before, routed the same way as the spike (the world's breach-and-fill drainage is measured in treeMeasure).
    const R0 = new Router(n, DRAIN_CELL);
    R0.route(raw, fixed);
    const t0 = { n, cell: DRAIN_CELL, receiver: Int32Array.from(R0.receiver), area: Float32Array.from(R0.area) };
    const s0 = measureTree(`seed ${seed} BEFORE (noise ground, steepest-descent routing) [field classes]`, t0, clsF, isSea);
    const s0r = measureTree(`seed ${seed} BEFORE [relief classes]`, t0, reliefClasses(n, raw), isSea);
    const out = [s0.text, s0r.text, `  ${stats(raw, raw, clsF, fixed)}`];
    console.log(out.join('\n'));
    fs.appendFileSync(report, out.join('\n') + '\n');
    const p0 = renderTree(n, raw, t0, clsF, s0, 3);
    fs.writeFileSync(`${dir}/png/s${seed}-spike-before.png`, png(p0.w, p0.w, p0.rgb));
    // (The world's breach-and-fill drainage over the same ground, for reference: Router vs buildDrainage.)
    void buildDrainage;
    for (const variant of (env.SPIKE_VARIANTS ?? 'low').split(',')) {
      const run = evolve(variant, raw, f, fixed);
      const R = new Router(n, DRAIN_CELL);
      R.route(run.h, fixed);
      const t1 = { n, cell: DRAIN_CELL, receiver: Int32Array.from(R.receiver), area: Float32Array.from(R.area) };
      const s1 = measureTree(`seed ${seed} AFTER ${variant}${MODE === 'ss' ? ' STEADY-STATE ITERATION' : ''} (${run.steps} ${MODE === 'ss' ? 'iterations' : 'steps'}; route ${(run.msRoute / run.steps).toFixed(1)} ms + solve ${(run.msSolve / run.steps).toFixed(1)} ms per step) [field classes]`, t1, clsF, isSea);
      const s1r = measureTree(`seed ${seed} AFTER ${variant} [relief classes]`, t1, reliefClasses(n, run.h), isSea);
      // Uplift class: mountain where this variant's range uplift is at least UPLIFT_MTN of the peak.
      const ru = rangeUplift(variant, f);
      const clsU = Uint8Array.from(clsF, (v, c) => (v === CLASS_SEA ? v : ru[c] >= UPLIFT_MTN ? CLASS_MTN : v === CLASS_MTN ? CLASS_HILL : v));
      const s1u = variant === 'low' || variant === 'full' || variant === 'knoise' ? null : measureTree(`seed ${seed} AFTER ${variant} [uplift classes: mountain where U >= ${UPLIFT_MTN} of peak]`, t1, clsU, isSea);
      // The noise ground's tree against the same wider front (the control: is the change the model's or the front's?).
      const s0u = s1u ? measureTree(`seed ${seed} BEFORE (noise ground) [uplift classes of ${variant}]`, t0, clsU, isSea) : null;
      const o = [...(s0u ? [s0u.text] : []), `  params U ${U} m/step, ridge ${RIDGE} m/km, m ${M}, Sc ${SC}, grade ${GRADE}${variant === 'wide' ? `, sigma ${WIDE_SIGMA} km` : ''}`, ...run.log, s1.text, ...(s1u ? [s1u.text] : []), s1r.text, `  ${stats(run.h, raw, clsF, fixed)}`];
      console.log(o.join('\n'));
      fs.appendFileSync(report, o.join('\n') + '\n');
      const p1 = s1u ? renderTree(n, run.h, t1, clsU, s1u, 3) : renderTree(n, run.h, t1, clsF, s1, 3);
      fs.writeFileSync(`${dir}/png/s${seed}-spike-${variant}${MODE === 'ss' ? '-ss' : ''}.png`, png(p1.w, p1.w, p1.rgb));
      // SPIKE_DUMP=1: the evolved lattice as float32 rows (north row last), for further study.
      if (env.SPIKE_DUMP) fs.writeFileSync(`${dir}/spike-s${seed}-${variant}${MODE === 'ss' ? '-ss' : ''}.f32`, new Uint8Array(run.h.buffer));
    }
  }
  setWorldSeed(0);
});
