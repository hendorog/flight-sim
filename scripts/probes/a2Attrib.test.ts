// Round V A2 (PLAN-V A2, probes only): attribute the floor-edge bands (> 40 degree faces), the seed-42 pits and the floor
// height to the term that makes each, by build variant (src/world/terrain/a2Probe.ts, the only caller of setA2):
//   A2_VAR  a: A1 as built; b: no river core held in the slope pass; c: the corner fix out of the drawn delta only;
//           c2: the corner fix not applied at all; d: markCourse off; e: the network's second valley off (RN19 / HF12,
//           valleyInfluence 1 m); f: c + d + e
//   A2_SEED (42)
//   A2_TR   'name=n0,e0:n1,e1;...': transects every A2_STEP (50) m, the drawn ground in parts that sum to it
//           (heightfield.ts debugA2) and, per step, its slope and each part's share of the step:
//             noise (1-m) d coarseRaw | dR (1-m) d(change without the corner fix) | corner (1-m) d(the corner fix's
//             share of the change) | carve (1-m) dc | resid -(1-m) d(w (coarseRaw - r)) | macO (1-m) d(the rest of the
//             model's offset: home pad, coast) | hs m d(hs) (the pass's ground's own slope) | blend dm (hs - G) (the
//             pass's weight changing: the held core's taper) | gul (gullies, small relief) | pre (airfields, a stream's
//             smoothing) | valley (the network's second valley) | chan (its channels)
//           and every band (a run of steps steeper than 40 degrees, with the steps over 30 degrees beside it) summed.
//   A2_OUT  dir: A2_BOX (cn,ce,half; onSlope's owner box -12200,-41300,3000) at 25 m into DIR/slope (slopemap.py);
//           A2_EXPORT ('cn,ce,half;...') at 20 m (slopeTry's format) into DIR; A2_DUMP=1: DIR/dump-s<seed>.json, the
//           lattice cells the corner fix lowered by more than 5 m and the fine nodes on a river core's taper
//           (0 < core < held) inside the first export box (pits: tools2/pitnear3.py).
//   A2_RAY  'pn,pe,alt:ln,le,lalt' and A2_PX 'x,y;...': the ground point under each pixel of a 1600 x 900 shot with a
//           60 degree vertical field of view (to place the sites seen in the pictures).
//   npx vitest run --config scripts/probes/vitest.config.ts a2Attrib --silent=false --disable-console-intercept
import { it } from 'vitest';
import { debugA2, hydrology, makeSample, sampleTerrain, seededModel, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { A2rec, setA2, type A2Variant } from '../../src/world/terrain/a2Probe';
import { CUT_N, CUT_CELL } from '../../src/world/terrain/erosion';
import { DOMAIN_HALF, DRAIN_CELL } from '../../src/world/terrain/drainage';
import { slopeParams } from '../../src/world/terrain/hillslopes';

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: string | Uint8Array): void; mkdirSync(p: string, o: unknown): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

const VARIANTS: Record<string, Partial<A2Variant>> = {
  a: {},
  b: { noCore: true },
  c: { cornerOff: 'delta' },
  c2: { cornerOff: 'all' },
  d: { noMarkCourse: true },
  e: { noValley: true },
  f: { cornerOff: 'delta', noMarkCourse: true, noValley: true },
};
const TERMS = ['noise', 'dR', 'corner', 'carve', 'resid', 'macO', 'hs', 'blend', 'gul', 'pre', 'valley', 'chan'] as const;
type Row = Record<string, number>;

/** The parts of one step a -> b (they sum to the drawn ground's change exactly). */
function stepParts(a: Row, b: Row): Record<string, number> {
  const ma = a.m, mb = b.m;
  const mm = 0.5 * (ma + mb);
  const k = 1 - mm;
  // (hs is only read where the pass's weight is over 0: at an end without it, its offset over the model's ground is the
  // other end's, which leaves m (hs - G) there 0 whatever it is.)
  let ha = a.hs, hb = b.hs;
  if (!(ma > 1e-4) && mb > 1e-4) ha = a.gModel + (b.hs - b.gModel);
  if (!(mb > 1e-4) && ma > 1e-4) hb = b.gModel + (a.hs - a.gModel);
  if (!(ma > 1e-4) && !(mb > 1e-4)) ha = hb = 0;
  const macA = a.gModel - a.coarseRaw - (a.d + a.c - a.res);
  const macB = b.gModel - b.coarseRaw - (b.d + b.c - b.res);
  const p: Record<string, number> = {
    noise: k * (b.coarseRaw - a.coarseRaw),
    dR: k * (b.dRouted - a.dRouted),
    corner: k * (b.corner - a.corner),
    carve: k * (b.c - a.c),
    resid: -k * (b.res - a.res),
    macO: k * (macB - macA),
    hs: mm * (hb - ha),
    blend: (mb - ma) * 0.5 * (ha - a.gModel + hb - b.gModel),
    gul: b.gullies - a.gullies,
    pre: b.pre - a.pre,
    valley: b.valley - a.valley,
    chan: b.chan - a.chan,
  };
  return p;
}
const deg = (dz: number, dx: number): number => (Math.atan(Math.abs(dz) / dx) * 180) / Math.PI;
const f0 = (v: number): string => (Number.isFinite(v) ? v.toFixed(0) : 'nan');
const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : 'nan');
const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : 'nan');

function transect(name: string, n0: number, e0: number, n1: number, e1: number, step: number): void {
  const L = Math.hypot(n1 - n0, e1 - e0);
  const K = Math.round(L / step);
  const dx = L / K;
  const rows: Row[] = [];
  for (let i = 0; i <= K; i++) {
    const t = i / K;
    const r = debugA2(n0 + (n1 - n0) * t, e0 + (e1 - e0) * t) as Row;
    const sum = r.coarseRaw + r.off + r.pass + r.gullies + r.pre + r.valley + r.chan;
    r.check = r.drawn - sum - (r.gModel - r.coarseRaw - r.off);
    rows.push(r);
  }
  console.log(`\nTR ${name} ${n0},${e0}:${n1},${e1} (${K + 1} points, ${dx.toFixed(1)} m)`);
  console.log('     x  drawn slope |  coarseRaw      d     dR corner      c   res     f    g    k     w |  gModel    m    hs   kr held  pass |  gul   pre valley  chan | river  check');
  for (let i = 0; i <= K; i++) {
    const r = rows[i];
    const sl = i > 0 ? deg(r.drawn - rows[i - 1].drawn, dx) : 0;
    console.log(`  ${(i * dx).toFixed(0).padStart(5)} ${f0(r.drawn).padStart(5)} ${sl.toFixed(1).padStart(5)} | ${f0(r.coarseRaw).padStart(6)} ${f0(r.d).padStart(6)} ${f0(r.dRouted).padStart(6)} ${f0(r.corner).padStart(6)} ${f0(r.c).padStart(6)} ${f0(r.res).padStart(5)} ${f2(r.f)} ${f2(r.g)} ${f2(r.k)} ${f2(r.w)} | ${f0(r.gModel).padStart(6)} ${f2(r.m)} ${f0(r.m > 1e-4 ? r.hs : NaN).padStart(5)} ${f2(r.kr)} ${r.held ? 'H' : '.'}   ${f0(r.pass).padStart(5)} | ${f0(r.gullies).padStart(4)} ${f0(r.pre).padStart(5)} ${f0(r.valley).padStart(5)} ${f0(r.chan).padStart(5)} | ${f0(r.river > -1e9 ? r.river : NaN).padStart(5)} ${f1(r.check)}`);
  }
  // The bands: runs of steps steeper than 40 degrees, with the steps over 30 degrees either side.
  const sl = rows.map((r, i) => (i > 0 ? deg(r.drawn - rows[i - 1].drawn, dx) : 0));
  let lo = 0;
  let max = 0;
  for (let i = 1; i <= K; i++) max = Math.max(max, sl[i]);
  console.log(`  steepest step ${max.toFixed(1)} deg; lowest drawn ${f0(Math.min(...rows.map((r) => r.drawn)))} m at ${(rows.findIndex((r) => r.drawn === Math.min(...rows.map((q) => q.drawn))) * dx).toFixed(0)} m`);
  for (let i = 1; i <= K; i++) {
    if (!(sl[i] > 40) || i < lo) continue;
    let a = i;
    let b = i;
    while (a > 1 && sl[a - 1] > 30 && Math.sign(rows[a - 1].drawn - rows[a - 2].drawn) === Math.sign(rows[i].drawn - rows[i - 1].drawn)) a--;
    while (b < K && sl[b + 1] > 30 && Math.sign(rows[b + 1].drawn - rows[b].drawn) === Math.sign(rows[i].drawn - rows[i - 1].drawn)) b++;
    lo = b + 1;
    const tot: Record<string, number> = Object.fromEntries(TERMS.map((t) => [t, 0]));
    let steep = a;
    for (let j = a; j <= b; j++) {
      const p = stepParts(rows[j - 1], rows[j]);
      for (const t of TERMS) tot[t] += p[t];
      if (sl[j] > sl[steep]) steep = j;
    }
    const dz = rows[b].drawn - rows[a - 1].drawn;
    const ps = stepParts(rows[steep - 1], rows[steep]);
    const dzs = rows[steep].drawn - rows[steep - 1].drawn;
    const share = (o: Record<string, number>, z: number): string => TERMS.map((t) => `${t} ${(100 * o[t] / z).toFixed(0)}%`).join(' ');
    const sum = TERMS.reduce((s, t) => s + tot[t], 0);
    console.log(`  BAND ${name} ${((a - 1) * dx).toFixed(0)}-${(b * dx).toFixed(0)} m: drawn ${f0(rows[a - 1].drawn)} -> ${f0(rows[b].drawn)} (${f0(dz)} m over ${((b - a + 1) * dx).toFixed(0)} m, mean ${deg(dz, (b - a + 1) * dx).toFixed(1)} deg, steepest ${sl[steep].toFixed(1)} deg at ${(steep * dx).toFixed(0)} m)`);
    console.log(`    parts, m: ${TERMS.map((t) => `${t} ${f1(tot[t])}`).join(' ')} (sum ${f1(sum)})`);
    console.log(`    shares of the band: ${share(tot, dz)}`);
    console.log(`    shares of its steepest step (${f1(dzs)} m): ${share(ps, dzs)}`);
  }
}

it('a2 attribution', () => {
  const v = env.A2_VAR ?? 'a';
  const seed = Number(env.A2_SEED ?? 42);
  setA2({ ...VARIANTS[v], record: true });
  const t0 = performance.now();
  setWorldSeed(seed);
  const m = seededModel();
  const lk = hydrology.lakes;
  console.log(`variant ${v} ${JSON.stringify(VARIANTS[v])} seed ${seed}: built in ${(performance.now() - t0).toFixed(0)} ms; slopes ${m && m.slopes ? 'built' : 'none'}; courseHold ${slopeParams().courseHold}; ${lk.length} lakes, ${(hydrology.rivers ?? []).filter((r) => !r.kind).length} rivers`);
  const out = env.A2_OUT;
  if (out) fs.mkdirSync(out, { recursive: true });
  if (env.A2_RAY) {
    const [p, l] = env.A2_RAY.split(':').map((s) => s.split(',').map(Number));
    // x east, y north, z up.
    const F = [l[1] - p[1], l[0] - p[0], l[2] - p[2]];
    const nf = Math.hypot(...F);
    for (let i = 0; i < 3; i++) F[i] /= nf;
    const R = [F[1], -F[0], 0];
    const nr = Math.hypot(...R);
    for (let i = 0; i < 3; i++) R[i] /= nr;
    const U = [R[1] * F[2] - R[2] * F[1], R[2] * F[0] - R[0] * F[2], R[0] * F[1] - R[1] * F[0]];
    const ty = Math.tan((30 * Math.PI) / 180);
    const tx = ty * (1600 / 900);
    for (const px of (env.A2_PX ?? '800,450').split(';')) {
      const [x, y] = px.split(',').map(Number);
      const sx = (2 * x) / 1600 - 1;
      const sy = 1 - (2 * y) / 900;
      const D = [0, 1, 2].map((i) => F[i] + sx * tx * R[i] + sy * ty * U[i]);
      const nd = Math.hypot(...D);
      let hit = '';
      for (let s = 0; s < 40000; s += 5) {
        const e = p[1] + (D[0] / nd) * s;
        const n = p[0] + (D[1] / nd) * s;
        const z = p[2] + (D[2] / nd) * s;
        if (z < terrainHeight(n, e)) {
          hit = `${n.toFixed(0)},${e.toFixed(0)} ground ${terrainHeight(n, e).toFixed(0)} m, ${s} m away`;
          break;
        }
      }
      console.log(`RAY ${env.A2_RAY} px ${x},${y}: ${hit || 'sky'}`);
    }
  }
  if (env.A2_TR) {
    const step = Number(env.A2_STEP ?? 50);
    for (const item of env.A2_TR.split(';')) {
      const [name, pair] = item.includes('=') ? item.split('=') : [item, item];
      const [a, b] = pair.split(':');
      const [n0, e0] = a.split(',').map(Number);
      const [n1, e1] = b.split(',').map(Number);
      transect(name, n0, e0, n1, e1, step);
    }
  }
  if (out && env.A2_BOX) {
    // onSlope's owner box: the drawn ground and its slope (degrees x 4), N x N, row 0 the south edge.
    const [cn, ce, half] = env.A2_BOX.split(',').map(Number);
    const step = 25;
    const N = Math.round((2 * half) / step) + 1;
    const H = new Float64Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) H[y * N + x] = terrainHeight(cn - half + y * step, ce - half + x * step);
    const dg = new Uint8Array(N * N);
    let n = 0, s40 = 0;
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      const k = y * N + x;
      const d = (Math.atan(Math.hypot((H[k + N] - H[k - N]) / (2 * step), (H[k + 1] - H[k - 1]) / (2 * step))) * 180) / Math.PI;
      dg[k] = Math.min(255, Math.round(d * 4));
      n++;
      if (d > 40) s40++;
    }
    fs.mkdirSync(`${out}/slope`, { recursive: true });
    fs.writeFileSync(`${out}/slope/slope-s${seed}.u8`, dg);
    fs.writeFileSync(`${out}/slope/slope-s${seed}.f64`, new Uint8Array(H.buffer));
    console.log(`BOX ${env.A2_BOX} seed ${seed}: over 40 deg ${(100 * s40 / n).toFixed(1)} % (${((s40 * step * step) / 1e6).toFixed(2)} km2)`);
  }
  if (out && env.A2_EXPORT) {
    const step = 20;
    const s = makeSample();
    for (const box of env.A2_EXPORT.split(';')) {
      const [cn, ce, half] = box.split(',').map(Number);
      const n = Math.round((2 * half) / step);
      const z = new Float32Array(n * n);
      let sea = 0;
      for (let y = 0; y < n; y++) {
        const north = cn + half - (y + 0.5) * step;
        for (let x = 0; x < n; x++) {
          const east = ce - half + (x + 0.5) * step;
          sampleTerrain(north, east, s);
          const water = Math.max(s.standing, s.river);
          if (s.standing > s.ground && s.standing <= 0.5 && s.ground < 0) {
            z[y * n + x] = NaN;
            sea++;
          } else z[y * n + x] = Math.max(s.ground, water);
        }
      }
      const base = `${out}/seed${seed}_${cn}_${ce}`;
      fs.writeFileSync(`${base}.f32`, new Uint8Array(z.buffer));
      fs.writeFileSync(`${base}.json`, JSON.stringify({ seed, n, res: step, north: cn, east: ce, half, sea }));
      console.log(`EXPORT ${box}: ${n}x${n} at ${step} m -> ${base}.f32`);
    }
  }
  if (out && env.A2_DUMP && (env.A2_EXPORT || env.A2_DUMPBOX) && m && m.slopes) {
    const [cn, ce, half] = (env.A2_DUMPBOX ?? (env.A2_EXPORT as string).split(';')[0]).split(',').map(Number);
    const inBox = (north: number, east: number): boolean => Math.abs(north - cn) <= half + 1000 && Math.abs(east - ce) <= half + 1000;
    const corner: number[][] = [];
    const nL = Math.round((2 * DOMAIN_HALF) / DRAIN_CELL) + 1;
    const low = A2rec.lowered as Float32Array;
    for (let c = 0; c < nL * nL; c++) {
      if (!(low[c] > 5)) continue;
      const north = -DOMAIN_HALF + Math.floor(c / nL) * DRAIN_CELL;
      const east = -DOMAIN_HALF + (c % nL) * DRAIN_CELL;
      if (inBox(north, east)) corner.push([north, east, Math.round(low[c])]);
    }
    const held = Math.round(255 * slopeParams().courseHold);
    const core = m.slopes.core;
    const taper: number[][] = [];
    const heldN: number[][] = [];
    for (let q = 0; q < CUT_N * CUT_N; q++) {
      if (!(core[q] > 0)) continue;
      const north = -DOMAIN_HALF + Math.floor(q / CUT_N) * CUT_CELL;
      const east = -DOMAIN_HALF + (q % CUT_N) * CUT_CELL;
      if (inBox(north, east)) (core[q] < held ? taper : heldN).push([north, east]);
    }
    fs.writeFileSync(`${out}/dump-s${seed}.json`, JSON.stringify({ corner, taper, held: heldN }));
    console.log(`DUMP: ${corner.length} corner-lowered cells (> 5 m), ${taper.length} core-taper nodes, ${heldN.length} held nodes`);
  }
  setWorldSeed(0);
});
