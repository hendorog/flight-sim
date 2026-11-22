// Valley straightness, the owner's "many valleys are dead straight" as a ruler (definition: valleyStraight.ts; the
// write-up is Round W's out/fs/W/MEASURE.md). The same code measures the seeded world's drawn surface (terrainHeight on
// the grid) and NZ reference grids (nzDem.py), and the gate is "inside NZ's interquartile range for each class".
//
//   World:  SV_SEEDS=1,42,777777 SV_OUT=out/fs/W/sv npx vitest run --config scripts/probes/vitest.config.ts valleyStraight
//           (about 16 s build + 15 s grid + 3 s measure per seed on a quiet machine). Options: SV_MAP=1 (hill-shade maps),
//           SV_ZOOM='42@n0,n1,e0,e1' (a 40 m map of a box), SV_VIEWS=file of 'name query' lines (axis samples projected
//           into those camera views, for valleyStraightMark.py), SV_TAG (output name).
//   NZ:     python3 -I scripts/probes/nzDem.py out/fs/W/nz      (once: six regions, ~205 MB of tiles, seconds)
//           SV_NZ=out/fs/W/nz SV_OUT=out/fs/W/sv [SV_NZ_REGIONS=scf,nch,rmh,wrp,hbt,gis] [SV_WRITE_REF=path] ... (2 s)
//   Self-test: SV_SELF=1 (synthetic straight and sine valleys at 17 deg to the grid: the tracer's noise floor).
//   SV_CELL (128) must match the reference's; SV_SUB=k averages k x k samples per cell (default 1, cell centres).
//   SV_MIN=km2 (< 30) adds a class below 30 km2, with its own reference (valleyStraightRef-min<km2>.json); the brief's
//   three classes then read differently (lines start further up), so they are gated only by a reference built the same.
//   SV_D='3000:a,5000:b,10000:c' overrides d per window (calibration only: the gate is off when d differs).
import { it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { CLASS_NAMES, D_GRID, LAND_NAMES, P, SEA, bends, longestRun, reaches, route, setClasses, trace, wq, type Axes, type Grid } from './valleyStraight';
import { png } from './png';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const OUT = env.SV_OUT ?? 'out/fs/W/sv';
const CELL = Number(env.SV_CELL ?? 128);
const SUB = Number(env.SV_SUB ?? 1);
// SV_MIN=km2: also trace channels from this area, as an extra class under 30 km2 (the gate's PASS stays on the brief's
// three classes; the extra class is checked against its own NZ range when the reference has one).
if (env.SV_MIN && Number(env.SV_MIN) < 30) setClasses([Number(env.SV_MIN) * 1e6, 30e6, 100e6, 500e6]);
const NC = (): number => P.classes.length;
const BRIEF = ['30-100', '100-500', '500+'];
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : '-');
const f0 = (x: number): string => (Number.isFinite(x) ? x.toFixed(0) : '-');
const pc = (x: number): string => (Number.isFinite(x) ? (100 * x).toFixed(1) : '-');

interface Ref { d: Record<string, number>; cell: number; minArea?: number; nz: Record<string, Record<string, { q1: number; med: number; q3: number; pooled: number; reaches: number; km: number; dead: number }>> }
const refPath = env.SV_REF ?? `scripts/probes/valleyStraightRef${env.SV_MIN && Number(env.SV_MIN) < 30 ? `-min${env.SV_MIN}` : ''}.json`;
const ref: Ref | null = existsSync(refPath) ? (JSON.parse(readFileSync(refPath, 'utf8')) as Ref) : null;
const dOf: Record<number, number> = {};
P.windows.forEach((L, wi) => (dOf[L] = P.dStraight[wi]));

if (env.SV_D) for (const kv of env.SV_D.split(',')) { const [L, d] = kv.split(':').map(Number); dOf[L] = d; }

/** Every number the report and the reference need, for one dataset or a pool of them. */
function summary(list: Axes[]) {
  const km = P.classes.map(() => [0, 0, 0]);
  const S: Record<string, Record<string, number[]>> = {};
  const tally = (key: string, wi: number, m: number) => {
    const row = ((S[key] ??= {})[P.windows[wi]] ??= Array(D_GRID.length + 2).fill(0));
    row[D_GRID.length]++; // eligible samples
    D_GRID.forEach((d, di) => { if (m <= d) row[di]++; });
    if (m <= dOf[P.windows[wi]]) row[D_GRID.length + 1]++;
  };
  const mq: Record<string, number[][]> = {};
  for (const ax of list) for (let k = 0; k < ax.n.length; k++) {
    km[ax.cls[k]][ax.landC[k]] += P.ds / 1000;
    P.windows.forEach((_, wi) => {
      const m = ax.m[wi][k];
      if (Number.isNaN(m)) return;
      for (const key of [`c${ax.cls[k]}`, `l${ax.landC[k]}`, `c${ax.cls[k]}l${ax.landC[k]}`, 'all']) tally(key, wi, m);
      ((mq[`c${ax.cls[k]}`] ??= P.windows.map(() => []))[wi]).push(m);
    });
  }
  const share = (key: string, L: number, di: number): number => { const r = S[key]?.[L]; return r && r[D_GRID.length] ? r[di] / r[D_GRID.length] : NaN; };
  // Reaches and their quartiles, length-weighted, at the chosen d and on the d grid.
  const R = list.flatMap((ax) => reaches(ax));
  const rq: Record<string, Record<string, { n: number; km: number; q: number[][]; at: number[] }>> = {};
  for (let c = 0; c < NC(); c++) P.windows.forEach((L, wi) => {
    const rs = R.filter((r) => r.cls === c && (r.elig[wi] * P.ds) >= P.minReach);
    const w = rs.map((r) => r.elig[wi]);
    const q = D_GRID.map((_, di) => { const v = rs.map((r) => r.under[wi][di] / r.elig[wi]); return [wq(v, w, 0.25), wq(v, w, 0.5), wq(v, w, 0.75)]; });
    const at = q[D_GRID.indexOf(dOf[L])] ?? [NaN, NaN, NaN];
    (rq[`c${c}`] ??= {})[L] = { n: rs.length, km: w.reduce((a, b) => a + b, 0) * P.ds / 1000, q, at };
  });
  const B = list.flatMap((ax) => bends(ax).map((b) => ({ ...b, cell: ax.cell })));
  const bend = P.classes.map((_, c) => {
    const bs = B.filter((b) => b.cls === c);
    const wide = bs.filter((b) => b.floor >= 3 * b.cell);
    const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : NaN);
    return { n: bs.length, amp: med(bs.map((b) => b.amp)), wave: med(bs.map((b) => b.wave)), floor: med(bs.map((b) => b.floor)), nWide: wide.length, ampW: med(wide.map((b) => b.amp / b.floor)), waveW: med(wide.map((b) => b.wave / b.floor)) };
  });
  const lr = P.windows.map((L, wi) => { const best = P.classes.map(() => 0); for (const ax of list) longestRun(ax, wi, dOf[L]).forEach((v, c) => (best[c] = Math.max(best[c], v))); return best; });
  const lrDead = P.windows.map((_, wi) => { const best = P.classes.map(() => 0); for (const ax of list) longestRun(ax, wi, P.dDead[wi]).forEach((v, c) => (best[c] = Math.max(best[c], v))); return best; });
  const mQ: Record<string, number[][]> = {};
  for (const [k, arr] of Object.entries(mq)) mQ[k] = arr.map((a) => { const s = [...a].sort((x, y) => x - y); return [0.1, 0.25, 0.5].map((p) => s[Math.floor(p * (s.length - 1))] ?? NaN); });
  return { km, S, share, rq, bend, lr, lrDead, mQ, lines: list.reduce((a, b) => a + b.lines, 0) };
}
type Sum = ReturnType<typeof summary>;

function report(title: string, sm: Sum): string {
  const o: string[] = [`== ${title}`];
  o.push(`  axis km (measured), class x landscape [plain / hill / mountain]: ${sm.km.map((r, c) => `${CLASS_NAMES[c]}: ${r.map(f0).join(' / ')}`).join('; ')}; lines ${sm.lines}`);
  const dl = P.windows.map((L) => `S${L / 1000}(${dOf[L]} m)`).join(' ');
  o.push(`  straight share at the chosen d, % of axis length: ${dl}`);
  const di = D_GRID.length + 1;
  const row = (key: string, name: string) => `    ${name.padEnd(18)} ${P.windows.map((L) => pc(sm.share(key, L, di)).padStart(6)).join(' ')}   (eligible km ${P.windows.map((L) => f0(((sm.S[key]?.[L]?.[D_GRID.length] ?? 0) * P.ds) / 1000)).join(' / ')})`;
  o.push(row('all', 'all'));
  for (let c = 0; c < NC(); c++) o.push(row(`c${c}`, `${CLASS_NAMES[c]} km2`));
  for (let l = 0; l < 3; l++) o.push(row(`l${l}`, LAND_NAMES[l]));
  for (let c = 0; c < NC(); c++) for (let l = 0; l < 3; l++) o.push(row(`c${c}l${l}`, `${CLASS_NAMES[c]} ${LAND_NAMES[l]}`));
  o.push(`  dead straight (m_L <= ${P.windows.map((L, wi) => `${P.dDead[wi]} m at ${L / 1000} km`).join(', ')}), % of axis length, by class [${CLASS_NAMES.join(' / ')}]: ${P.windows.map((L, wi) => `S${L / 1000} ${P.classes.map((_, c) => pc(sm.share(`c${c}`, L, D_GRID.indexOf(P.dDead[wi])))).join(' / ')}`).join('; ')}`);
  o.push(`  reaches (one class along one line, >= ${P.minReach / 1000} km eligible), per-reach share at the chosen d, length-weighted Q1 / median / Q3:`);
  for (let c = 0; c < NC(); c++) o.push(`    ${CLASS_NAMES[c].padEnd(8)} ${P.windows.map((L) => { const r = sm.rq[`c${c}`][L]; return `S${L / 1000}: n ${r.n} (${f0(r.km)} km) ${r.at.map(pc).join(' / ')}`; }).join('; ')}`);
  o.push(`  longest straight run at the chosen d, km [${CLASS_NAMES.join(' / ')}]: ${P.windows.map((L, wi) => `L ${L / 1000}: ${sm.lr[wi].map(f1).join(' / ')}`).join('; ')}`);
  o.push(`  longest dead-straight run, km [${CLASS_NAMES.join(' / ')}]: ${P.windows.map((L, wi) => `L ${L / 1000}: ${sm.lrDead[wi].map(f1).join(' / ')}`).join('; ')}`);
  o.push(`  m_L (least chord deviation of an L window through the point), m, p10 / p25 / p50:`);
  for (let c = 0; c < NC(); c++) o.push(`    ${CLASS_NAMES[c].padEnd(8)} ${P.windows.map((L, wi) => `L ${L / 1000}: ${(sm.mQ[`c${c}`]?.[wi] ?? []).map(f0).join(' / ')}`).join('; ')}`);
  o.push(`  S_L(d) on the d grid [${D_GRID.join(', ')} m], pooled % by class:`);
  for (let c = 0; c < NC(); c++) o.push(`    ${CLASS_NAMES[c].padEnd(8)} ${P.windows.map((L) => `L ${L / 1000}: ${D_GRID.map((_, i) => pc(sm.share(`c${c}`, L, i))).join(' ')}`).join(' | ')}`);
  o.push(`  per-reach Q1 / median / Q3 on the d grid, %:`);
  for (let c = 0; c < NC(); c++) for (const L of P.windows) o.push(`    ${CLASS_NAMES[c].padEnd(8)} L ${String(L / 1000).padStart(2)}: ${sm.rq[`c${c}`][L].q.map((q) => q.map(pc).join('/')).join('  ')}`);
  o.push(`  bends (secondary): n, median amplitude m, wavelength m, floor width m; where the floor is >= 3 cells: n, amplitude/floor, wavelength/floor`);
  for (let c = 0; c < NC(); c++) { const b = sm.bend[c]; o.push(`    ${CLASS_NAMES[c].padEnd(8)} n ${b.n}, amp ${f0(b.amp)}, wave ${f0(b.wave)}, floor ${f0(b.floor)}; wide n ${b.nWide}, amp/W ${f1(b.ampW)}, wave/W ${f1(b.waveW)}`); }
  return o.join('\n');
}

function hillshade(g: Grid, list: Axes | null, scale = 1): Uint8Array {
  const { rows: R, cols: C, h } = g;
  const rgb = new Uint8Array(R * C * 3);
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
    const k = i * C + j;
    if (!(h[k] > SEA)) { rgb.set([150, 175, 205], k * 3); continue; }
    const a = h[Math.min(R - 1, i + 1) * C + j], b = h[Math.max(0, i - 1) * C + j], c2 = h[i * C + Math.min(C - 1, j + 1)], d = h[i * C + Math.max(0, j - 1)];
    const gx = (scale * ((c2 > SEA ? c2 : h[k]) - (d > SEA ? d : h[k]))) / (2 * g.cell), gy = (scale * ((b > SEA ? b : h[k]) - (a > SEA ? a : h[k]))) / (2 * g.cell);
    // Lambert, sun from the north-west at 45 deg.
    const lit = (0.5 * gx - 0.5 * gy + 0.7071) / Math.sqrt(1 + gx * gx + gy * gy);
    const v = 70 + 180 * Math.max(0, lit);
    rgb.set([v, v, v * 0.95], k * 3);
  }
  if (list) paint(g, rgb, list, 1);
  return rgb;
}

/** Axis samples over a hill shade, by m_5: red dead straight (<= dDead), orange straight at the gate's d, blue bending, grey not measured at 5 km. */
function paint(g: Grid, rgb: Uint8Array, ax: Axes, r: number): void {
  const wi = P.windows.indexOf(5000);
  const d5 = dOf[5000], dd = P.dDead[wi];
  for (let k = 0; k < ax.n.length; k++) {
    const i = Math.floor((g.north0 - ax.n[k]) / g.cell), j = Math.floor((ax.e[k] - g.east0) / g.cell);
    const m = ax.m[wi][k];
    const col = Number.isNaN(m) ? [120, 120, 120] : m <= dd ? [220, 20, 20] : m <= d5 ? [240, 150, 20] : [30, 80, 220];
    const rad = r + ax.cls[k];
    for (let a = -rad + 1; a < rad; a++) for (let b = -rad + 1; b < rad; b++) {
      const ii = i + a, jj = j + b;
      if (ii < 0 || jj < 0 || ii >= g.rows || jj >= g.cols) continue;
      rgb.set(col, (ii * g.cols + jj) * 3);
    }
  }
}

function loadNZ(dir: string, name: string, cell: number): Grid {
  const meta = JSON.parse(readFileSync(`${dir}/${name}-${cell}.json`, 'utf8')) as { rows: number; cols: number; cell: number; north0: number; east0: number };
  const buf = readFileSync(`${dir}/${name}-${cell}.f32`);
  const h = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return { name, rows: meta.rows, cols: meta.cols, cell: meta.cell, north0: meta.north0, east0: meta.east0, h };
}

function measure(g: Grid): { ax: Axes; ms: number } {
  const t = performance.now();
  const R = route(g);
  const ax = trace(g, R);
  return { ax, ms: performance.now() - t };
}

// Per-reach share at the chosen d: reaches() counts on the d grid; add the chosen d by patching the grid lookup.
// (The chosen d is put on the grid below when it is not already there, so `at` reads straight from it.)
for (const L of P.windows) if (!D_GRID.includes(dOf[L])) D_GRID.push(dOf[L]);
D_GRID.sort((a, b) => a - b);

function fixAt(sm: Sum): void {
  for (let c = 0; c < NC(); c++) for (const L of P.windows) { const r = sm.rq[`c${c}`][L]; r.at = r.q[D_GRID.indexOf(dOf[L])]; }
}

function gateTable(title: string, sm: Sum): string {
  if (!ref) return `  (no reference ${refPath}: no gate)`;
  if (ref.cell !== CELL) return `  (reference made at ${ref.cell} m cells, this run ${CELL} m: no gate)`;
  if ((ref.minArea ?? 30) !== P.minArea / 1e6) return `  (reference traced from ${ref.minArea ?? 30} km2, this run from ${P.minArea / 1e6} km2: no gate)`;
  if (P.windows.some((L) => ref.d[String(L)] !== dOf[L])) return `  (reference made at d ${JSON.stringify(ref.d)}, this run ${JSON.stringify(dOf)}: no gate)`;
  const o = [`  GATE ${title}: pooled straight share inside NZ's per-reach IQR (cell ${ref.cell} m), per class and window`];
  let pass = true;
  for (let c = 0; c < NC(); c++) {
    const cells = P.windows.map((L) => {
      const nz = ref.nz[CLASS_NAMES[c]]?.[String(L)];
      const v = sm.share(`c${c}`, L, D_GRID.indexOf(dOf[L]));
      if (!nz) return `S${L / 1000} ${pc(v)} (no NZ)`;
      const ok = v >= nz.q1 - 1e-9 && v <= nz.q3 + 1e-9;
      if (!ok && BRIEF.includes(CLASS_NAMES[c])) pass = false;
      const dead = sm.share(`c${c}`, L, D_GRID.indexOf(P.dDead[P.windows.indexOf(L)]));
      return `S${L / 1000} ${pc(v)} in [${pc(nz.q1)}, ${pc(nz.q3)}] ${ok ? 'ok ' : 'OUT'} (NZ ${pc(nz.pooled)}; dead straight ${pc(dead)}, NZ ${pc(nz.dead)})`;
    });
    o.push(`    ${CLASS_NAMES[c].padEnd(8)} ${cells.join('; ')}${BRIEF.includes(CLASS_NAMES[c]) ? '' : '  (extra class, not in PASS)'}`);
  }
  o.push(`    => ${pass ? 'PASS' : 'FAIL'} (PASS is on the brief's classes, ${BRIEF.join(', ')} km2)`);
  return o.join('\n');
}

it('valley straightness', { timeout: 3_600_000 }, async () => {
  mkdirSync(OUT, { recursive: true });
  const lines: string[] = [];
  const say = (s: string) => { lines.push(s); (globalThis as unknown as { process: { stderr: { write(s: string): void } } }).process.stderr.write(s + '\n'); };
  say(`valleyStraight: cell ${CELL} m, sub ${SUB}, d ${P.windows.map((L) => `${L / 1000} km ${dOf[L]} m`).join(', ')}, reference ${ref ? refPath : 'none'}; ${new Date().toISOString()}`);
  const dumps: Record<string, unknown> = {};
  // Self-test (SV_SELF=1): synthetic valleys 60 km long at 17 deg off the grid, V-shaped and flat-floored (300 m),
  // straight and sine-bent (amplitude 200 m, wavelength 4 km). The straight ones give the tracer's noise floor.
  if (env.SV_SELF) {
    for (const [kind, amp] of [['straight V', 0], ['straight flat', 0], ['sine V', 200], ['sine flat', 200]] as [string, number][]) {
      const th = (17 * Math.PI) / 180, Lx = 64000, Ly = 24000;
      const R = Math.round(Ly / CELL), C = Math.round(Lx / CELL);
      const h = new Float32Array(R * C);
      for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
        const n = Ly / 2 - (i + 0.5) * CELL, e = -Lx / 2 + (j + 0.5) * CELL;
        const along = e * Math.cos(th) + n * Math.sin(th), across = -e * Math.sin(th) + n * Math.cos(th);
        const off = across - amp * Math.sin((2 * Math.PI * along) / 4000);
        const a = Math.abs(off);
        const v = 10 + 0.004 * (along + Lx) + 0.12 * (kind.includes('flat') ? Math.max(0, a - 150) : a) + 0.00002 * a * a;
        h[i * C + j] = along < -28000 || i < 2 || j < 2 || i >= R - 2 || j >= C - 2 ? NaN : v; // sea past the mouth and round the box
      }
      const g: Grid = { name: kind, rows: R, cols: C, cell: CELL, north0: Ly / 2, east0: -Lx / 2, h };
      const { ax } = measure(g);
      const main = ax.line[ax.n.findIndex((_, k) => ax.cls[k] === 2)] ?? ax.line[0];
      const ks = [...ax.n.keys()].filter((k) => ax.line[k] === main);
      const qs = P.windows.map((L, wi) => { const v = ks.map((k) => ax.m[wi][k]).filter((x) => !Number.isNaN(x)).sort((x, y) => x - y); return `L ${L / 1000}: p50 ${f1(v[v.length >> 1])} p90 ${f1(v[Math.floor(0.9 * (v.length - 1))])} max ${f1(v[v.length - 1])} m`; });
      // Lateral error of the trace against the true axis (straight cases).
      const err = ks.map((k) => { const n = ax.n[k], e = ax.e[k]; const along = e * Math.cos(th) + n * Math.sin(th), across = -e * Math.sin(th) + n * Math.cos(th); return Math.abs(across - amp * Math.sin((2 * Math.PI * along) / 4000)); }).sort((x, y) => x - y);
      say(`self-test ${kind} (cell ${CELL}): main line ${f1((ks.length * P.ds) / 1000)} km; m_L ${qs.join('; ')}; trace off the true axis p50 ${f1(err[err.length >> 1])} p90 ${f1(err[Math.floor(0.9 * (err.length - 1))])} m`);
    }
  }
  if (env.SV_NZ) {
    const regions = (env.SV_NZ_REGIONS ?? 'scf,nch,rmh,wrp,hbt,gis').split(',');
    const all: Axes[] = [];
    for (const name of regions) {
      const g = loadNZ(env.SV_NZ, name, CELL);
      const { ax, ms } = measure(g);
      all.push(ax);
      const sm = summary([ax]); fixAt(sm);
      say(`NZ ${name}: ${g.cols}x${g.rows} cells, measured in ${(ms / 1000).toFixed(1)} s`);
      say(report(`NZ ${name}`, sm));
      if (env.SV_MAP) writeFileSync(`${OUT}/map-nz-${name}-${CELL}.png`, png(g.cols, g.rows, hillshade(g, ax)));
      dumps[name] = { km: sm.km, rq: sm.rq };
    }
    const sm = summary(all); fixAt(sm);
    say(report(`NZ pooled (${regions.join(', ')})`, sm));
    say(gateTable('NZ pooled against itself', sm));
    if (env.SV_WRITE_REF) {
      const out: Ref = { d: Object.fromEntries(P.windows.map((L) => [String(L), dOf[L]])), cell: CELL, minArea: P.minArea / 1e6, nz: {} };
      for (let c = 0; c < NC(); c++) for (const L of P.windows) {
        const r = sm.rq[`c${c}`][L];
        (out.nz[CLASS_NAMES[c]] ??= {})[String(L)] = { q1: r.at[0], med: r.at[1], q3: r.at[2], pooled: sm.share(`c${c}`, L, D_GRID.indexOf(dOf[L])), reaches: r.n, km: Math.round(r.km), dead: sm.share(`c${c}`, L, D_GRID.indexOf(P.dDead[P.windows.indexOf(L)])) };
      }
      (out as unknown as Record<string, unknown>).regions = regions;
      (out as unknown as Record<string, unknown>).source = 'LINZ NZ 8 m DEM (CC BY 4.0), 16 m overview block-averaged; scripts/probes/nzDem.py';
      writeFileSync(env.SV_WRITE_REF, JSON.stringify(out, null, 1) + '\n');
      say(`wrote ${env.SV_WRITE_REF}`);
    }
  }
  if (env.SV_SEEDS) {
    const { setWorldSeed } = await import('../../src/world/worldSeed');
    const { terrainHeight } = await import('../../src/world/terrain/heightfield');
    const { DOMAIN_HALF } = await import('../../src/world/terrain/drainage');
    const all: Axes[] = [];
    for (const seed of env.SV_SEEDS.split(',').map(Number)) {
      const t0 = performance.now();
      setWorldSeed(seed);
      terrainHeight(0, 0);
      const tBuild = performance.now() - t0;
      // The drawn surface on the grid (water surface where water covers the ground, as the DEM has it).
      const t1 = performance.now();
      const half = DOMAIN_HALF, n = Math.round((2 * half) / CELL);
      const nb = Math.round((2 * half) / 1000) + 1;
      const coarse = new Float32Array(nb * nb);
      for (let i = 0; i < nb; i++) for (let j = 0; j < nb; j++) coarse[i * nb + j] = terrainHeight(half - i * 1000, -half + j * 1000);
      const h = new Float32Array(n * n);
      let samples = 0;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const north = half - (i + 0.5) * CELL, east = -half + (j + 0.5) * CELL;
        const bi = Math.min(nb - 2, Math.floor((half - north) / 1000)), bj = Math.min(nb - 2, Math.floor((east + half) / 1000));
        if (coarse[bi * nb + bj] <= SEA && coarse[bi * nb + bj + 1] <= SEA && coarse[(bi + 1) * nb + bj] <= SEA && coarse[(bi + 1) * nb + bj + 1] <= SEA) { h[i * n + j] = NaN; continue; }
        let s = 0;
        for (let a = 0; a < SUB; a++) for (let b = 0; b < SUB; b++) { s += terrainHeight(north + CELL / 2 - ((a + 0.5) * CELL) / SUB, east - CELL / 2 + ((b + 0.5) * CELL) / SUB); samples++; }
        s /= SUB * SUB;
        h[i * n + j] = s > SEA ? s : NaN;
      }
      const tGrid = performance.now() - t1;
      const g: Grid = { name: `seed ${seed}`, rows: n, cols: n, cell: CELL, north0: half, east0: -half, h };
      const { ax, ms } = measure(g);
      all.push(ax);
      const sm = summary([ax]); fixAt(sm);
      say(`seed ${seed}: build ${(tBuild / 1000).toFixed(1)} s, grid ${n}x${n} (${samples} samples) ${(tGrid / 1000).toFixed(1)} s, measure ${(ms / 1000).toFixed(1)} s`);
      say(report(`seed ${seed}`, sm));
      say(gateTable(`seed ${seed}`, sm));
      dumps[`seed${seed}`] = { km: sm.km, rq: sm.rq };
      if (env.SV_MAP) writeFileSync(`${OUT}/map-seed${seed}-${CELL}.png`, png(n, n, hillshade(g, ax)));
      // A finer map of a box on this seed (SV_ZOOM='seed@n0,n1,e0,e1'), straight reaches marked.
      for (const z of (env.SV_ZOOM ?? '').split(' ').filter(Boolean)) {
        const [zs, box] = z.split('@');
        if (Number(zs) !== seed) continue;
        const [n0, n1, e0, e1] = box.split(',').map(Number);
        const zc = 40, R = Math.round((n1 - n0) / zc), C = Math.round((e1 - e0) / zc);
        const zh = new Float32Array(R * C);
        for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) { const v = terrainHeight(n1 - (i + 0.5) * zc, e0 + (j + 0.5) * zc); zh[i * C + j] = v > SEA ? v : NaN; }
        const zg: Grid = { name: 'zoom', rows: R, cols: C, cell: zc, north0: n1, east0: e0, h: zh };
        const rgb = hillshade(zg, null, 1);
        paint(zg, rgb, ax, 2);
        writeFileSync(`${OUT}/zoom-seed${seed}-${n0}_${n1}_${e0}_${e1}.png`, png(C, R, rgb));
        writeFileSync(`${OUT}/zoom-seed${seed}-${n0}_${n1}_${e0}_${e1}.json`, JSON.stringify({ n0, n1, e0, e1, cell: zc, rows: R, cols: C }));
      }
      // The owner's views (SV_VIEWS: lines 'name query'), seed 42: every axis sample in each view projected to the
      // 1600 x 900 frame (three.js: x east, y up, z -north; vertical fov; up +y), visible or hidden behind the ground.
      if (env.SV_VIEWS) {
        const views: Record<string, unknown> = {};
        for (const ln of readFileSync(env.SV_VIEWS, 'utf8').split('\n').filter((l) => l.trim())) {
          const [name, q] = ln.trim().split(/\s+/);
          const qs = new URLSearchParams(q);
          if (Number(qs.get('seed')) !== seed) continue;
          const cp = qs.get('camPos')!.split(',').map(Number), cl = qs.get('camLook')!.split(',').map(Number);
          const fov = Number(qs.get('fov') ?? 60), W = 1600, H = 900;
          const pos = [cp[1], cp[2], -cp[0]], look = [cl[1], cl[2], -cl[0]];
          const f = [look[0] - pos[0], look[1] - pos[1], look[2] - pos[2]];
          const fl = Math.hypot(...f); f.forEach((_, i) => (f[i] /= fl));
          let r = [f[1] * 0 - f[2] * 1, f[2] * 0 - f[0] * 0, f[0] * 1 - f[1] * 0]; // f x (0,1,0)
          const rl = Math.hypot(...r); r = r.map((x) => x / rl);
          const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
          const foc = H / 2 / Math.tan((fov * Math.PI) / 360);
          const proj = (N: number, E: number, A: number): [number, number, number] | null => {
            const v = [E - pos[0], A - pos[1], -N - pos[2]];
            const zc2 = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
            if (zc2 <= 1) return null;
            return [W / 2 + ((v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) / zc2) * foc, H / 2 - ((v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / zc2) * foc, zc2];
          };
          const pts: number[][] = [];
          for (let k = 0; k < ax.n.length; k++) {
            const A = terrainHeight(ax.n[k], ax.e[k]) + 3;
            const p = proj(ax.n[k], ax.e[k], A);
            if (!p || p[0] < -50 || p[0] > W + 50 || p[1] < -50 || p[1] > H + 50 || p[2] > 40000) continue;
            // Visible: no ground over the sight line (marched every 1 % of the distance, at least 15 m).
            const dn = ax.n[k] - cp[0], de = ax.e[k] - cp[1], da = A - cp[2];
            const dist = Math.hypot(dn, de, da);
            let vis = 1;
            for (let t = Math.max(15, 0.01 * dist); t < dist - 30; t += Math.max(15, 0.01 * t)) {
              const fr = t / dist;
              if (terrainHeight(cp[0] + dn * fr, cp[1] + de * fr) > cp[2] + da * fr + 1) { vis = 0; break; }
            }
            pts.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, vis, ax.line[k], ax.cls[k], Math.round(ax.m[1][k]), Math.round(ax.m[2][k]), Math.round(ax.n[k]), Math.round(ax.e[k]), Math.round(ax.area[k]), Math.round(ax.m[0][k])]);
          }
          views[name] = { q, fov, W, H, pts };
        }
        writeFileSync(`${OUT}/views-seed${seed}${env.SV_MIN ? `-min${env.SV_MIN}` : ''}.json`, JSON.stringify({ d: dOf, fields: 'x,y,visible,line,class,m5,m10,north,east,area_km2,m3', minArea: P.minArea / 1e6, views }));
      }
    }
    if (all.length > 1) {
      const sm = summary(all); fixAt(sm);
      say(report(`seeds ${env.SV_SEEDS} pooled`, sm));
    }
  }
  writeFileSync(`${OUT}/valleyStraight-${env.SV_TAG ?? (env.SV_NZ ? 'nz' : 'world')}-${CELL}.txt`, lines.join('\n') + '\n');
  writeFileSync(`${OUT}/valleyStraight-${env.SV_TAG ?? (env.SV_NZ ? 'nz' : 'world')}-${CELL}.json`, JSON.stringify(dumps));
});
