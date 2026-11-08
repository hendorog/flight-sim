// Foundation streams gate: does every gully carry water? On a seeded world's threshold-hillslope chains (gullies.ts:
// the pass's own routing) at least GG_START km² (default 0.25), in GG_PATCHES rill patches (2 km) spread over the
// mountains: the share of chain nodes whose cell carries drawn water - a traced line (ribbon: queryRiver within its
// half-width + GG_REACH m, default 125: half a node spacing) or a painted stream (a wet rill segment within GG_REACH:
// rills.ts, as the ground shader draws it) -
// by catchment band; and how the wet painted lines end (in the network, in a sink, at the window).
//   GG_SEEDS=1,42,777777 GG_PATCHES=24 npx vitest run --config scripts/probes/vitest.config.ts gullyGate
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { gullyNet, receiverOf } from '../../src/world/terrain/gullies';
import { seededModel } from '../../src/world/terrain/heightfield';
import { RILL_CELL, RILL_PATCH, rillArea, rillPatchLines, rillSize, rillWaterHalf, RILL_WET_AREA } from '../../src/world/terrain/rills';
import { setWorldSeed } from '../../src/world/worldSeed';
import { hash2i } from '../../src/world/terrain/noise';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('gully gate', () => {
  const start = Number(env.GG_START ?? 0.25);
  /** A node's cell carries water: drawn water within half a node spacing of it, m. */
  const REACH = Number(env.GG_REACH ?? 125);
  const bins = [start, 1, 5, 20, 1e9];
  for (const seed of (env.GG_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    const g = gullyNet();
    if (!g) { console.log(`seed ${seed}: no gully net`); continue; }
    // Patches: chain nodes picked by hash among those >= 5 km² (in the mountains' valleys), one patch each.
    const cand: number[] = [];
    for (let q = 0; q < g.n * g.n; q++) if (g.dir[q] && g.area[q] >= 5 && g.area[q] < 40) cand.push(q);
    cand.sort((a, b) => (hash2i(a, seed) >>> 0) - (hash2i(b, seed) >>> 0));
    const P = Number(env.GG_PATCHES ?? 24);
    const seen = new Set<string>();
    const tot = bins.map(() => 0), wetR = bins.map(() => 0), wetP = bins.map(() => 0);
    let ends = { net: 0, sink: 0, open: 0 };
    const sinkRise: number[] = [];
    const sinkAt: string[] = [];
    let wetKm = 0;
    const hit = { dist: 0, level: 0, halfWidth: 0, s: 0, side: 0, beyondSource: 0 };
    const missAt: string[] = [];
    let done = 0;
    let uncut = 0;
    const H = seededModel()!.slopes!.h;
    const VCUT = Number(env.GG_V ?? 10);
    for (const q of cand) {
      if (done >= P) break;
      const north = g.origin + Math.floor(q / g.n) * g.cell, east = g.origin + (q % g.n) * g.cell;
      const pi = Math.floor(east / RILL_PATCH), pj = Math.floor(north / RILL_PATCH);
      const key = `${pi},${pj}`;
      if (seen.has(key)) continue;
      seen.add(key);
      done++;
      const { graph, segs } = rillPatchLines({ pi, pj });
      const wet = rillSize(RILL_WET_AREA);
      // Wet segments in a 32 m grid for the lookups.
      const grid = new Map<number, number[]>();
      const GK = (e: number, n: number): number => Math.floor(e / 32) * 100003 + Math.floor(n / 32);
      segs.forEach((sg, k) => {
        if (Math.max(rillWaterHalf(sg.s0), rillWaterHalf(sg.s1)) <= 0) return;
        const L = Math.hypot(sg.e1 - sg.e0, sg.n1 - sg.n0);
        const me = (sg.e0 + sg.e1) / 2, mn = (sg.n0 + sg.n1) / 2;
        if (me >= pi * RILL_PATCH && me < (pi + 1) * RILL_PATCH && mn >= pj * RILL_PATCH && mn < (pj + 1) * RILL_PATCH) wetKm += L / 1000;
        for (let t = 0; t <= 1; t += 8 / Math.max(8, L)) {
          const kk = GK(sg.e0 + (sg.e1 - sg.e0) * t, sg.n0 + (sg.n1 - sg.n0) * t);
          const l = grid.get(kk); if (l) { if (l[l.length - 1] !== k) l.push(k); } else grid.set(kk, [k]);
        }
      });
      const nearWet = (e: number, n: number, r: number): boolean => {
        const span = Math.ceil(r / 32) + 1;
        for (let a = -span; a <= span; a++) for (let b = -span; b <= span; b++) {
          for (const k of grid.get((Math.floor(e / 32) + a) * 100003 + Math.floor(n / 32) + b) ?? []) {
            const sg = segs[k];
            const de = sg.e1 - sg.e0, dn = sg.n1 - sg.n0, l2 = de * de + dn * dn || 1e-9;
            const t = Math.max(0, Math.min(1, ((e - sg.e0) * de + (n - sg.n0) * dn) / l2));
            if (Math.hypot(sg.e0 + de * t - e, sg.n0 + dn * t - n) < r) return true;
          }
        }
        return false;
      };
      // Chain nodes in the patch's core.
      const y0 = Math.ceil((pj * RILL_PATCH - g.origin) / g.cell), y1 = Math.floor(((pj + 1) * RILL_PATCH - g.origin) / g.cell);
      const x0 = Math.ceil((pi * RILL_PATCH - g.origin) / g.cell), x1 = Math.floor(((pi + 1) * RILL_PATCH - g.origin) / g.cell);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const c = y * g.n + x;
        if (!g.dir[c] || g.area[c] < start) continue;
        // (Only where the pass cut a V: the slopes' ground either side across the chain's flow stands GG_V m over it.
        // Elsewhere the pass left the ground as it stood and its routing is a line down an even slope.)
        const rc = receiverOf(g, c);
        const dy = Math.floor(rc / g.n) - y, dx = (rc % g.n) - x;
        if (!(H[(y + dx) * g.n + x - dy] - H[c] > VCUT && H[(y - dx) * g.n + x + dy] - H[c] > VCUT)) { uncut++; continue; }
        const n0 = g.origin + y * g.cell, e0 = g.origin + x * g.cell;
        const b = bins.findIndex((v, i) => g.area[c] >= v && g.area[c] < bins[i + 1]);
        tot[b]++;
        hydrology.queryRiver(n0, e0, hit);
        if (hit.dist < hit.halfWidth + REACH) { wetR[b]++; continue; }
        if (nearWet(e0, n0, REACH)) wetP[b]++;
        else if (missAt.length < 40) missAt.push(`${n0},${e0} A ${g.area[c].toFixed(2)}`);
      }
      // How the wet painted lines end (a line's last cell: its receiver a network cell, a sink, or none in the window).
      const { nx, to, persist, net } = graph;
      for (let i = 0; i < to.length; i++) {
        if (!persist[i]) continue;
        const x = i % nx, y = (i / nx) | 0;
        const ge = (graph.gx0 + x) * RILL_CELL, gnn = (graph.gy0 + y) * RILL_CELL;
        if (ge < pi * RILL_PATCH || ge >= (pi + 1) * RILL_PATCH || gnn < pj * RILL_PATCH || gnn >= (pj + 1) * RILL_PATCH) continue;
        const j = to[i];
        const last = j === -2 || (j >= 0 && net[j]) || j === -1;
        if (!last) continue;
        // (Wet: its near catchment past the wet threshold.)
        if ((graph.areaR[i] * RILL_CELL * RILL_CELL) / 1e6 < RILL_WET_AREA && graph.cells[i] <= graph.areaR[i]) continue;
        if (j === -2) {
          ends.sink++;
          // (How far the water must rise to leave the pit, and how far away the lower ground is: a flood from it.)
          if (env.GG_SINKS) {
            const gr = graph.ground;
            const h0 = gr[i];
            const seenF = new Set<number>([i]);
            const open: number[] = [i];
            let rise = Infinity, far = 0;
            while (open.length && seenF.size < 20000) {
              let m = 0; for (let k = 1; k < open.length; k++) if (gr[open[k]] < gr[open[m]]) m = k;
              const c = open[m]; open[m] = open[open.length - 1]; open.pop();
              far = Math.max(far, gr[c] - h0);
              if (gr[c] < h0 - 0.01) { rise = far; break; }
              const cx = c % nx, cy = (c / nx) | 0;
              for (let k = 0; k < 8; k++) { const xx = cx + [-1, 0, 1, 1, 1, 0, -1, -1][k], yy = cy + [-1, -1, -1, 0, 1, 1, 1, 0][k]; if (xx < 0 || yy < 0 || xx >= nx || yy >= graph.ny) continue; const q = yy * nx + xx; if (seenF.has(q)) continue; seenF.add(q); open.push(q); }
            }
            sinkRise.push(rise);
            if (sinkAt.length < 10) sinkAt.push(`${gnn},${ge} rise ${rise.toFixed(1)} cells ${seenF.size}`);
          }
        }
        else if (j >= 0) ends.net++;
        else ends.open++;
      }
      void rillArea; void wet;
    }
    const pct = (a: number, b: number): string => (b ? ((100 * a) / b).toFixed(1) : '-');
    console.log(`seed ${seed}: ${done} patches, wet painted km ${wetKm.toFixed(0)}`);
    for (let b = 0; b + 1 < bins.length; b++) console.log(`  A ${bins[b]}-${bins[b + 1]} km2: nodes ${tot[b]}, water ${pct(wetR[b] + wetP[b], tot[b])} % (traced ${pct(wetR[b], tot[b])} %, painted ${pct(wetP[b], tot[b])} %)`);
    const all = tot.reduce((a, b) => a + b, 0), allW = wetR.reduce((a, b) => a + b, 0) + wetP.reduce((a, b) => a + b, 0);
    console.log(`  (chain nodes >= ${start} not in a V the pass cut, left out: ${uncut})`);
    console.log(`  all >= ${start}: ${pct(allW, all)} % of ${all}; wet painted line ends: network ${ends.net}, sink ${ends.sink} (${pct(ends.net, ends.net + ends.sink)} % to the network)`);
    if (env.GG_MISS) for (const m of missAt) console.log(`    miss ${m}`);
    if (sinkRise.length) { sinkRise.sort((a, b) => a - b); const q = (f: number) => sinkRise[Math.min(sinkRise.length - 1, Math.floor(f * sinkRise.length))].toFixed(1); console.log(`  wet sinks: rise to spill p25 ${q(0.25)} p50 ${q(0.5)} p75 ${q(0.75)} p90 ${q(0.9)}`); for (const a of sinkAt) console.log(`    sink ${a}`); }
  }
  setWorldSeed(0);
});
