// Probe: the drainage tree of the seeded worlds as built (task 1 of out/tree/PLAN.md). Where do big branches join
// (mountain, hill or plain), how many rivers leave the ranges and how big are they, and how elongated are the basins
// (Hack h, Re)? Measured on the drainage lattice before the erosion pass (the noise ground), after it (the lattice
// the world's drainage routes over, as heightfield.ts buildWater builds it), and on the drawn river network
// (hydrology.rivers: the lines riverNetwork.ts draws, kind 0 rivers, kind 1 streams).
//   TREE_SEEDS=1,42,777777 TREE_OUT=out/tree npx vitest run --config scripts/probes/vitest.config.ts scripts/probes/treeMeasure.test.ts --silent=false
import { it } from 'vitest';
import { buildDrainage, DOMAIN_HALF, DRAIN_CELL, type Drainage } from '../../src/world/terrain/drainage';
import * as hf from '../../src/world/terrain/heightfield';
import { hydrology, modelMs, naturalHeightRaw, seededDrainage, seededModel } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { AIRPORT } from '../../src/core/world';
import { CLASS_MTN, CLASS_NAMES, CLASS_SEA, fieldClasses, macroFields, measureTree, quant, reliefClasses, renderTree, type Tree } from './treeMetrics';
import { png } from './png';

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: Uint8Array | string): void; mkdirSync(p: string, o: { recursive: boolean }): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

const n = Math.round((2 * DOMAIN_HALF) / DRAIN_CELL) + 1;
const origin = -DOMAIN_HALF;

function treeOf(d: Drainage): Tree {
  return { n, cell: DRAIN_CELL, receiver: d.receiver, area: d.area };
}

/** The drawn network's confluences and range exits (hydrology.rivers), classed by the lattice cell under each sample. */
function drawn(cls: Uint8Array, withStreams: boolean, d: Drainage): string {
  const L = hydrology.rivers ?? [];
  const use = L.map((r) => (r.kind ?? 0) === 0 || (withStreams && r.kind === 1));
  const cellOf = (pn: number, pe: number): number => {
    const i = Math.max(0, Math.min(n - 1, Math.round((pn - origin) / DRAIN_CELL)));
    const j = Math.max(0, Math.min(n - 1, Math.round((pe - origin) / DRAIN_CELL)));
    return i * n + j;
  };
  const clsAt = L.map((r) => Uint8Array.from(r.north, (_, k) => cls[cellOf(r.north[k], r.east[k])]));
  const areaBefore = (li: number, k: number, back: number): number => {
    const r = L[li];
    const s0 = r.s[k] - back;
    let a = r.area ? r.area[0] : 0;
    for (let m = 0; m <= k; m++) if (r.s[m] <= s0 && r.area) a = r.area[m];
    return a;
  };
  const nearest = (li: number, pn: number, pe: number): number => {
    const r = L[li];
    let best = 0, bd = Infinity;
    for (let k = 0; k < r.north.length; k++) {
      const d = (r.north[k] - pn) ** 2 + (r.east[k] - pe) ** 2;
      if (d < bd) (bd = d), (best = k);
    }
    return best;
  };
  // Junction index on the parent of each line.
  const joinAt = L.map((r, li) => (use[li] && r.joins !== undefined && r.joins >= 0 && use[r.joins] ? nearest(r.joins, r.north[r.north.length - 1], r.east[r.east.length - 1]) : -1));
  // Exits: the last mountain sample of a line whose water (the rest of the line, then its parent from the junction
  // on) never meets mountain ground again, and does not go straight into the sea.
  const suffix = clsAt.map((c) => {
    const s = new Uint8Array(c.length + 1);
    for (let k = c.length - 1; k >= 0; k--) s[k] = c[k] === CLASS_MTN || s[k + 1] ? 1 : 0;
    return s;
  });
  const downMemo = new Map<number, boolean>();
  const downMtn = (li: number): boolean => {
    if (downMemo.has(li)) return downMemo.get(li) as boolean;
    const p = L[li].joins ?? -1;
    const v = joinAt[li] >= 0 ? suffix[p][joinAt[li] + 1] === 1 || downMtn(p) : false;
    downMemo.set(li, v);
    return v;
  };
  const out: string[] = [];
  for (const T of [10, 45, 200]) {
    const by = [0, 0, 0, 0];
    let inside = 0;
    for (let li = 0; li < L.length; li++) {
      const r = L[li];
      if (joinAt[li] < 0 || !r.area) continue;
      const p = r.joins as number;
      // (1.5 km back: the last lattice step of a line interpolates toward the junction cell's area, which holds both.)
      // Rivers (kind 0) are the lattice lines one for one (checked below): their branch areas are the lattice's, the
      // tributary's last own cell and the parent's cell above the junction.
      const aT = li < d.lines.length ? d.lines[li].area[d.lines[li].area.length - 2] : areaBefore(li, r.north.length - 1, 1500);
      const aP = p < d.lines.length && li < d.lines.length ? d.lines[p].area[Math.max(0, d.lines[li].joinAt - 1)] : areaBefore(p, joinAt[li], 1500);
      if (Math.min(aT, aP) < T) continue;
      by[clsAt[p][joinAt[li]]]++;
      if (clsAt[p][joinAt[li]] === CLASS_MTN || suffix[p][joinAt[li] + 1] === 1 || downMtn(p)) inside++;
    }
    const tot = by[1] + by[2] + by[3] || 1;
    out.push(`    confluences both >= ${T} km²: ${by[1] + by[2] + by[3]}; mountain ${by[3]} (${((100 * by[3]) / tot).toFixed(0)} %), hill ${by[2]} (${((100 * by[2]) / tot).toFixed(0)} %), plain ${by[1]} (${((100 * by[1]) / tot).toFixed(0)} %); mountain+hill ${((100 * (by[3] + by[2])) / tot).toFixed(0)} %; inside the ranges ${((100 * inside) / tot).toFixed(0)} %`);
  }
  const rootOf = (li: number): number => (joinAt[li] >= 0 ? rootOf(L[li].joins as number) : li);
  const exits: Array<{ n: number; e: number; a: number; root: number }> = [];
  for (let li = 0; li < L.length; li++) {
    if (!use[li] || !L[li].area) continue;
    const c = clsAt[li];
    let k = -1;
    for (let m = c.length - 2; m >= 0; m--) if (c[m] === CLASS_MTN) { k = m; break; }
    if (k < 0 || c[k + 1] === CLASS_SEA || downMtn(li)) continue;
    exits.push({ n: L[li].north[k + 1], e: L[li].east[k + 1], a: (L[li].area as Float64Array)[k + 1], root: rootOf(li) });
  }
  exits.sort((a, b) => b.a - a.a);
  const f0 = (x: number): string => (Number.isFinite(x) ? x.toFixed(0) : '-');
  for (const T of [10, 45, 200]) {
    const es = exits.filter((x) => x.a >= T);
    const nn = es.map((a) => Math.min(...es.filter((b) => b !== a).map((b) => Math.hypot(a.n - b.n, a.e - b.e) / 1000)));
    const ar = es.map((x) => x.a);
    out.push(`    exits >= ${T} km²: ${es.length}; NN spacing p25/p50/p75 ${f0(quant(nn, 0.25))}/${f0(quant(nn, 0.5))}/${f0(quant(nn, 0.75))} km; area p25/p50/p75/max ${f0(quant(ar, 0.25))}/${f0(quant(ar, 0.5))}/${f0(quant(ar, 0.75))}/${f0(quant(ar, 1))} km²`);
  }
  const sum = exits.reduce((s, x) => s + x.a, 0);
  const top = (k: number): string => ((100 * exits.slice(0, k).reduce((s, x) => s + x.a, 0)) / Math.max(1, sum)).toFixed(0);
  out.push(`    water crossing the front: ${f0(sum)} km² in ${exits.length} exits; top 1/3/5/10 carry ${top(1)}/${top(3)}/${top(5)}/${top(10)} %`);
  const roots = new Map<number, number[]>();
  for (const x of exits) roots.set(x.root, [...(roots.get(x.root) ?? []), x.a]);
  const share: number[] = [];
  const cnt: number[] = [];
  for (const [root, as] of roots) {
    const r = L[root];
    if (!r.area || r.joins !== undefined && r.joins >= 0) continue;
    const mouth = r.area[r.area.length - 1];
    if (mouth < 500 || clsAt[root][clsAt[root].length - 1] === CLASS_MTN) continue;
    share.push(Math.max(...as) / mouth);
    cnt.push(as.filter((a) => a >= 10).length);
  }
  out.push(`    rivers >= 500 km² fed from the ranges: ${share.length}; largest exit / mouth p25/p50/p75 ${quant(share, 0.25).toFixed(2)}/${quant(share, 0.5).toFixed(2)}/${quant(share, 0.75).toFixed(2)}; exits >= 10 km² per river p50 ${f0(quant(cnt, 0.5))} max ${f0(quant(cnt, 1))}`);
  return out.join('\n');
}

/** The drawn rivers over the lattice picture: each sample a dot coloured by catchment. */
function drawLines(pic: { w: number; rgb: Uint8Array }, scale: number): void {
  for (const r of hydrology.rivers ?? []) {
    if (!r.area) continue;
    for (let k = 0; k < r.north.length; k++) {
      const x = Math.round(((r.east[k] - origin) / DRAIN_CELL) * scale + scale / 2);
      const y = Math.round((n - 1 - (r.north[k] - origin) / DRAIN_CELL) * scale + scale / 2);
      if (x < 0 || y < 0 || x >= pic.w || y >= pic.w) continue;
      const u = Math.min(1, Math.log10(Math.max(1, r.area[k] / 10)) / Math.log10(300));
      const c = r.kind === 1 ? [255, 140, 0] : [Math.round(150 * (1 - u) + 60 * u), Math.round(230 * (1 - u) + 20 * u), Math.round(255 * (1 - u) + 200 * u)];
      pic.rgb.set(c, (y * pic.w + x) * 3);
    }
  }
}

it('tree measure', () => {
  const dir = env.TREE_OUT ?? 'out/tree';
  fs.mkdirSync(`${dir}/png`, { recursive: true });
  for (const seed of (env.TREE_SEEDS ?? '42').split(',')) {
    const t0 = performance.now();
    setWorldSeed(seed);
    const tWorld = performance.now() - t0;
    const fields = macroFields(n, origin, DRAIN_CELL);
    // Before: the noise ground on the lattice (naturalHeightRaw without detail: what the erosion pass starts from).
    const raw = new Float32Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) raw[i * n + j] = naturalHeightRaw(origin + i * DRAIN_CELL, origin + j * DRAIN_CELL, false);
    const dBefore = buildDrainage(() => 0, (pn, pe) => naturalHeightRaw(pn, pe, false), undefined, raw);
    // After: the eroded lattice the world's drainage routes over (heightfield.ts buildWater; without its cushion over
    // the sea's edge, which moves no water).
    // (The world's own drainage, heightfield.ts seededDrainage; its `height` is the eroded lattice it routed, with the
    // home mound.)
    const dAfter = seededDrainage as Drainage;
    const lat = Float32Array.from(dAfter.height);
    const rivers = (hydrology.rivers ?? []).filter((r) => (r.kind ?? 0) === 0).length;
    const streams = (hydrology.rivers ?? []).filter((r) => r.kind === 1).length;
    let same = 0;
    for (let li = 0; li < dAfter.lines.length; li++) if (hydrology.rivers?.[li] && (hydrology.rivers[li].kind ?? 0) === 0 && (hydrology.rivers[li].joins ?? -1) === dAfter.lines[li].joins) same++;
    const lines: string[] = [`seed ${seed}: model ${seededModel()?.key} (${modelMs.toFixed(0)} ms); drawn rivers matching the lattice lines (index and parent) ${same} of ${dAfter.lines.length}`, `seed ${seed} (world ${tWorld.toFixed(0)} ms): lattice lines before ${dBefore.lines.length}, after ${dAfter.lines.length}; drawn rivers ${rivers}, streams ${streams}`];
    // Class sanity.
    for (const [name, h] of [['before', raw], ['after', lat]] as Array<[string, Float32Array]>) {
      const cf = fieldClasses(n, fields, h);
      const cr = reliefClasses(n, h);
      const share = (c: Uint8Array): string => {
        const k = [0, 0, 0, 0];
        for (const v of c) k[v]++;
        const land = k[1] + k[2] + k[3];
        return [3, 2, 1].map((x) => `${CLASS_NAMES[x]} ${((100 * k[x]) / land).toFixed(0)} %`).join(', ');
      };
      let agree = 0, both = 0;
      for (let c = 0; c < cf.length; c++) if (cf[c] !== CLASS_SEA) (both++, cf[c] === cr[c] && agree++);
      lines.push(`  classes on ${name}: fields ${share(cf)}; relief ${share(cr)}; agree ${((100 * agree) / both).toFixed(0)} %`);
    }
    const isSeaB = (c: number): boolean => raw[c] <= 0;
    const isSeaA = (c: number): boolean => lat[c] <= 0;
    const clsB = fieldClasses(n, fields, raw);
    const clsA = fieldClasses(n, fields, lat);
    const sB = measureTree(`  [field classes] lattice before erosion`, treeOf(dBefore), clsB, isSeaB);
    const sA = measureTree(`  [field classes] lattice after erosion`, treeOf(dAfter), clsA, isSeaA);
    lines.push(sB.text, sA.text);
    lines.push(measureTree(`  [relief classes] lattice before erosion`, treeOf(dBefore), reliefClasses(n, raw), isSeaB).text);
    lines.push(measureTree(`  [relief classes] lattice after erosion`, treeOf(dAfter), reliefClasses(n, lat), isSeaA).text);
    // (Stage 2: the model's own orogen classes: mountain where the ranges' uplift share with the wide orogen's envelope
    // is at least 0.3, as the spike's "variant's uplift classes"; hill and plain by relief.)
    const inp = (hf as unknown as { seededInputs?: { ur: Float32Array } | null }).seededInputs;
    if (inp) {
      const ro = reliefClasses(n, lat);
      for (let c = 0; c < n * n; c++) if (lat[c] > 0) ro[c] = inp.ur[c] >= 0.3 ? CLASS_MTN : ro[c] === CLASS_MTN ? 2 : ro[c];
      lines.push(measureTree(`  [orogen classes] lattice after erosion`, treeOf(dAfter), ro, isSeaA).text);
    }
    // Same receivers? (the share of land cells whose receiver differs before/after)
    let diff = 0, land = 0;
    for (let c = 0; c < n * n; c++) if (lat[c] > 0) (land++, dBefore.receiver[c] !== dAfter.receiver[c] && diff++);
    lines.push(`  receivers changed by the erosion pass: ${((100 * diff) / land).toFixed(1)} % of land cells`);
    lines.push(`  [field classes] drawn network, rivers (kind 0):\n${drawn(clsA, false, dAfter)}`);
    lines.push(`  [field classes] drawn network, rivers + streams (kind 0 + 1):\n${drawn(clsA, true, dAfter)}`);
    const text = lines.join('\n');
    console.log(text);
    fs.writeFileSync(`${dir}/measure-${seed}.txt`, text + '\n');
    const scale = 3;
    const pb = renderTree(n, raw, treeOf(dBefore), clsB, sB, scale);
    fs.writeFileSync(`${dir}/png/s${seed}-lattice-before.png`, png(pb.w, pb.w, pb.rgb));
    const pa = renderTree(n, lat, treeOf(dAfter), clsA, sA, scale);
    fs.writeFileSync(`${dir}/png/s${seed}-lattice-after.png`, png(pa.w, pa.w, pa.rgb));
    const pd = renderTree(n, lat, { ...treeOf(dAfter), area: new Float32Array(n * n) }, clsA, null, scale);
    drawLines(pd, scale);
    fs.writeFileSync(`${dir}/png/s${seed}-drawn.png`, png(pd.w, pd.w, pd.rgb));
    void quant;
  }
  setWorldSeed(0);
});
