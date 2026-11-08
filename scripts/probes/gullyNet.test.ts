// Foundation streams: the threshold hillslopes' channel network (hillslopes.ts) on the 250 m fine grid, by steepest
// descent on the ground the pass built (SlopeField.h, where its weight w > 0): how many nodes and km pass each
// catchment, and how much of it the drawn water (rivers, streams) covers now.
//   GN_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts gullyNet
import { it } from 'vitest';
import { hydrology, seededModel } from '../../src/world/terrain/heightfield';
import { CUT_CELL, CUT_N } from '../../src/world/terrain/erosion';
import { DOMAIN_HALF } from '../../src/world/terrain/drainage';
import { setWorldSeed } from '../../src/world/worldSeed';
import { gullyNet, receiverOf } from '../../src/world/terrain/gullies';
import type { RiverHit } from '../../src/world/terrain/hydrology';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('gully net', async () => {
  for (const seed of (env.GN_SEEDS ?? '42').split(',')) {
    const t0 = performance.now();
    setWorldSeed(seed);
    const tb = performance.now() - t0;
    const sl = seededModel()?.slopes;
    if (!sl) { console.log(`seed ${seed}: no slopes`); continue; }
    const n = CUT_N, N = n * n, h = sl.h, w = sl.w;
    const t1 = performance.now();
    const gn = gullyNet();
    if (!gn) { console.log('no gully net'); continue; }
    const rec = new Int32Array(N).fill(-1);
    const ids: number[] = [];
    let act = 0, pits = 0;
    for (let q = 0; q < N; q++) if (gn.dir[q]) { act++; ids.push(q); rec[q] = receiverOf(gn, q); }
    const area = gn.area;
    const tr = performance.now() - t1;
    const th = [0.0625, 0.125, 0.25, 0.5, 1, 1.5, 3, 5, 10, 20, 35];
    const cnt = th.map(() => 0), km = th.map(() => 0), heads = th.map(() => 0), wet = th.map(() => 0);
    const hasDonorAbove = th.map(() => new Uint8Array(0));
    const hit: RiverHit = { dist: Infinity } as unknown as RiverHit;
    for (const q of ids) {
      const r = rec[q];
      const L = r < 0 ? 0 : (Math.abs(r - q) === 1 || Math.abs(r - q) === n ? CUT_CELL : CUT_CELL * Math.SQRT2);
      for (let i = 0; i < th.length; i++) if (area[q] >= th[i]) { cnt[i]++; km[i] += L / 1000; }
    }
    // Heads per threshold: a node over it none of whose donors is.
    for (let i = 0; i < th.length; i++) {
      const up = new Uint8Array(N);
      for (const q of ids) if (area[q] >= th[i] && rec[q] >= 0) up[rec[q]] = 1;
      for (const q of ids) if (area[q] >= th[i] && !up[q]) heads[i]++;
    }
    // Drawn water now: a node within its own half cell (125 m) + channel half-width of a drawn line (queryRiver).
    const flow = hydrology.queryFlow;
    let probe = 0;
    for (let i = 0; i < th.length; i++) wet[i] = 0;
    const org = -DOMAIN_HALF;
    let tested = 0;
    const missD: number[] = [];
    for (const q of ids) {
      if (area[q] < th[0]) continue;
      if ((q * 2654435761 >>> 0) % 7 !== 0) continue; // a sample
      tested++;
      const y = Math.floor(q / n), x = q % n;
      const nn = org + y * CUT_CELL, ee = org + x * CUT_CELL;
      hydrology.queryRiver(nn, ee, hit);
      const d = (hit as unknown as { dist: number }).dist;
      const hw = (hit as unknown as { halfWidth?: number }).halfWidth ?? 0;
      const ok = d < 150 + hw;
      if (!ok && area[q] >= 5 && env.GN_MISS) {
        const lk = hydrology.lakeMask?.at(nn, ee) ?? -Infinity;
        missD.push(Math.min(9999, d - hw));
        if (missD.length <= Number(env.GN_MISS)) console.log(`    miss ${nn},${ee} A ${area[q].toFixed(1)} d ${(d - hw).toFixed(0)} lake ${lk > -Infinity ? 1 : 0} w ${w[q]} dir ${sl.dir?.[q]}`);
      }
      if (ok) for (let i = 0; i < th.length; i++) if (area[q] >= th[i]) wet[i]++;
      probe++;
    }
    if (missD.length) { missD.sort((a, b) => a - b); console.log(`  misses A>=5: ${missD.length}; dist p25 ${missD[missD.length >> 2].toFixed(0)} p50 ${missD[missD.length >> 1].toFixed(0)} p75 ${missD[(3 * missD.length) >> 2].toFixed(0)}`); }
    const tot = th.map((t) => 0);
    for (const q of ids) { if ((q * 2654435761 >>> 0) % 7 !== 0) continue; for (let i = 0; i < th.length; i++) if (area[q] >= th[i]) tot[i]++; }
    if (env.GN_SNAP) {
      const { sampleTerrain, makeSample } = await import('../../src/world/terrain/heightfield');
      const smp = makeSample();
      const bins = [0.25, 1, 5, 20, 1e9];
      for (let b = 0; b + 1 < bins.length; b++) {
        const offs: number[] = [], drops: number[] = [];
        let k = 0;
        for (const q of ids) {
          if (area[q] < bins[b] || area[q] >= bins[b + 1] || rec[q] < 0) continue;
          if ((q * 2654435761 >>> 0) % 97 !== 0) continue;
          if (++k > 400) break;
          const y = Math.floor(q / n), x = q % n, r = rec[q], ry = Math.floor(r / n), rx = r % n;
          const n0 = org + (y + ry) / 2 * CUT_CELL, e0 = org + (x + rx) / 2 * CUT_CELL;
          const dn = ry - y, de = rx - x, L = Math.hypot(dn, de);
          const pn = -de / L, pe = dn / L;
          const prof: number[] = [];
          for (let o = -60; o <= 60; o += 2) prof.push(sampleTerrain(n0 + pn * o, e0 + pe * o, smp).ground);
          const c = 30;
          const g0 = prof[c];
          let i = c;
          const dir = prof[c - 1] < prof[c + 1] ? -1 : 1;
          while (i + dir >= 0 && i + dir < prof.length && prof[i + dir] < prof[i]) i += dir;
          const best = prof[i], bo = (i - c) * 2;
          offs.push(Math.abs(bo)); drops.push(g0 - best);
        }
        offs.sort((a, c) => a - c); drops.sort((a, c) => a - c);
        const qq = (a: number[], f: number) => a[Math.min(a.length - 1, Math.floor(f * a.length))]?.toFixed(1);
        console.log(`  snap A ${bins[b]}-${bins[b + 1]}: n ${offs.length} |offset| p50 ${qq(offs, 0.5)} p90 ${qq(offs, 0.9)} m; chain over floor p50 ${qq(drops, 0.5)} p90 ${qq(drops, 0.9)} m`);
      }
    }
    const sr = hydrology.streamReport;
    console.log(`  streams: traced ${sr?.traced} km ${sr?.km.toFixed(0)} chains ${JSON.stringify(sr?.chains)} ends ${JSON.stringify(sr?.ends)} ms ${sr?.ms.toFixed(0)} phases ${sr?.phases?.map((x) => x.toFixed(0)).join('/')}`);
    if (sr) {
      const q = (a: number[], f: number) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(f * b.length))].toFixed(1) : '-'; };
      console.log(`  sinks ${sr.sinks} hollows ${sr.hollows} pits ${sr.pits} floods ${sr.floods}; sinkGap p50/p90 ${q(sr.sinkGap, 0.5)}/${q(sr.sinkGap, 0.9)} (n ${sr.sinkGap.length}) lake ${sr.sinkGapLake.length}; samples ${sr.samples} levelSamples ${sr.levelSamples} crossSamples ${sr.crossSamples} net ${JSON.stringify(sr.netMs)} build ${sr.buildMs?.map((x) => x.toFixed(0)).join('/')} passWalks ${sr.passWalks} connects ${sr.connects} hollowWhy ${JSON.stringify(sr.hollowWhy)} at ${(sr.hollowAt ?? []).slice(0, 16).map((v) => v.toFixed(0)).join(',')}`);
    }
    if (sr?.sinkAt) {
      const a = sr.sinkAt; const c = [0, 0, 0, 0];
      for (let i = 0; i < a.length; i += 5) c[a[i + 2] + 2 * a[i + 4]]++;
      console.log(`  line sinks: lattice-stream->river ${c[0]} ->stream ${c[1]}; chain->river ${c[2]} ->stream ${c[3]}`);
      for (let i = 0; i < Math.min(a.length, 5 * 12); i += 5) console.log(`    ${a[i].toFixed(0)},${a[i + 1].toFixed(0)} into ${a[i + 2] ? 'stream' : 'river'} gap ${a[i + 3].toFixed(1)} chain ${a[i + 4]}`);
    }
    if (env.GN_GH) {
      const { naturalHeightSmooth, naturalHeight } = await import('../../src/world/terrain/heightfield');
      const dif: number[] = [], difN: number[] = [];
      let k = 0;
      for (const q of ids) {
        if (area[q] < 5 || (q * 2654435761 >>> 0) % 13 !== 0) continue;
        if (++k > 3000) break;
        const y = Math.floor(q / n), x = q % n;
        dif.push(naturalHeightSmooth(org + y * CUT_CELL, org + x * CUT_CELL) - h[q]);
        difN.push(naturalHeight(org + y * CUT_CELL, org + x * CUT_CELL) - h[q]);
      }
      const qq = (a: number[], f: number) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(f * b.length))].toFixed(1); };
      console.log(`  smooth-h at chain nodes A>=5: p1 ${qq(dif, 0.01)} p10 ${qq(dif, 0.1)} p50 ${qq(dif, 0.5)} p90 ${qq(dif, 0.9)} p99 ${qq(dif, 0.99)}; natural-h p1 ${qq(difN, 0.01)} p50 ${qq(difN, 0.5)} p99 ${qq(difN, 0.99)}`);
    }
    console.log(`seed ${seed}: build ${tb.toFixed(0)} ms; pass nodes ${act} (${(act * 0.0625).toFixed(0)} km2), outlets/pits ${pits}; routing ${tr.toFixed(0)} ms; drawn water ${hydrology.rivers?.length} lines; flow ${!!flow}`);
    for (let i = 0; i < th.length; i++) console.log(`  A>=${th[i]} km2: nodes ${cnt[i]} km ${km[i].toFixed(0)} heads ${heads[i]}; within 150 m of drawn water ${(100 * wet[i] / Math.max(1, tot[i])).toFixed(1)} % (of ${tot[i]} sampled)`);
  }
  setWorldSeed(0);
});
