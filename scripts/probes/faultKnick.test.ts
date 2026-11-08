// Probe (foundation stage 3): are the drawn fault falls at the model's knickpoints? For every fall a fault makes
// (falls.ts, cause 'fault'), the model's macro ground T (the B-spline of the lattice, erosion.ts bicubic) along the
// river's own course, its gradient over KN_RUN m above the lip and below the foot, the faults' uplift factor
// (structure.ts) above and below (which side rose faster), and the drawn level's gradient over the same runs; and
// the same for the front block's gorges: where each held big river crosses the block band.
//   KN_SEEDS=1,42,777777 KN_RUN=2500
import { it } from 'vitest';
import { DOMAIN_HALF, DRAIN_CELL } from '../../src/world/terrain/drainage';
import { bicubic } from '../../src/world/terrain/erosion';
import * as hf from '../../src/world/terrain/heightfield';
import { hydrology, seededModel } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { quant } from './treeMetrics';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const n = Math.round((2 * DOMAIN_HALF) / DRAIN_CELL) + 1;

it('fault falls at the model knickpoints', () => {
  const RUN = Number(env.KN_RUN ?? 2500);
  for (const seed of (env.KN_SEEDS ?? '42').split(',')) {
    setWorldSeed(Number(seed));
    const T = seededModel()?.lattice;
    const inp = hf.seededInputs;
    if (!T || !inp) continue;
    const st = inp.struct ?? null;
    const lat = (pn: number, pe: number): number => bicubic(T, n, -DOMAIN_HALF, DRAIN_CELL, pn, pe, true);
    const cellOf = (pn: number, pe: number): number => Math.round((pn + DOMAIN_HALF) / DRAIN_CELL) * n + Math.round((pe + DOMAIN_HALF) / DRAIN_CELL);
    const falls = hydrology.falls.filter((f) => f.cause === 'fault');
    const ratios: number[] = [];
    const rows: string[] = [];
    let upAbove = 0;
    let convex = 0;
    const seenFlight = new Set<string>();
    for (const f of falls) {
      const key = `${f.line}:${f.flight}`;
      if (f.flight >= 0 && seenFlight.has(key)) continue;
      seenFlight.add(key);
      const r = hydrology.rivers[f.line];
      const sLip = r.s[f.index];
      const at = (sv: number): { n: number; e: number; lv: number } => {
        let i = 0;
        while (i < r.s.length - 2 && r.s[i + 1] < sv) i++;
        const t = Math.max(0, Math.min(1, (sv - r.s[i]) / Math.max(1e-9, r.s[i + 1] - r.s[i])));
        return { n: r.north[i] + (r.north[i + 1] - r.north[i]) * t, e: r.east[i] + (r.east[i + 1] - r.east[i]) * t, lv: r.level[i] + (r.level[i + 1] - r.level[i]) * t };
      };
      const total = r.s[r.s.length - 1];
      const s0 = Math.max(0, sLip - RUN);
      const s1 = Math.min(total, sLip + RUN);
      if (sLip - s0 < 0.6 * RUN || s1 - sLip < 0.6 * RUN) continue;
      const a = at(s0), l = at(sLip), b = at(s1);
      const gAbove = (lat(a.n, a.e) - lat(l.n, l.e)) / (sLip - s0);
      const gBelow = (lat(l.n, l.e) - lat(b.n, b.e)) / (s1 - sLip);
      const fa = st ? st.fault[cellOf(a.n, a.e)] : 1;
      const fb = st ? st.fault[cellOf(b.n, b.e)] : 1;
      if (fa > fb) upAbove++;
      if (gBelow > gAbove) convex++;
      ratios.push(gBelow / Math.max(1e-5, gAbove));
      rows.push(`  line ${f.line} at ${f.north.toFixed(0)},${f.east.toFixed(0)}: fall ${f.height.toFixed(1)} m${f.flight >= 0 ? ' (flight)' : ''}; model gradient above/below ${(100 * gAbove).toFixed(2)}/${(100 * gBelow).toFixed(2)} %; uplift factor above/below ${fa.toFixed(2)}/${fb.toFixed(2)}; drawn level ${(100 * (a.lv - l.lv - f.height) / (sLip - s0)).toFixed(2)} % above`);
    }
    console.log(`seed ${seed}: fault falls ${falls.length} (${rows.length} measured, flights once); up side above the fall ${upAbove}, steeper below (convex break) ${convex}; model gradient below / above p25/p50/p75 ${[0.25, 0.5, 0.75].map((x) => quant(ratios, x).toFixed(2)).join('/')}`);
    console.log(rows.join('\n'));
    // The front block's gorges: each drawn river (kind 0) crossing the block band (weight >= 0.5), its catchment and the
    // model's gradient through the block against 3 km above it.
    if (st) {
      const gor: string[] = [];
      for (let li = 0; li < hydrology.rivers.length; li++) {
        const r = hydrology.rivers[li];
        if ((r.kind ?? 0) !== 0) continue;
        let inB = -1;
        for (let k = 0; k < r.s.length; k++) {
          const w = st.block[cellOf(r.north[k], r.east[k])];
          if (w >= 0.5 && inB < 0) inB = k;
          if (inB >= 0 && (w < 0.5 || k === r.s.length - 1)) {
            const len = r.s[k] - r.s[inB];
            if (len > 2000) {
              const c = cellOf(r.north[inB], r.east[inB]);
              const area = seededModel() ? hf.seededDrainage?.area[c] ?? 0 : 0;
              gor.push(`  line ${li} crosses the block over ${(len / 1000).toFixed(1)} km from ${r.north[inB].toFixed(0)},${r.east[inB].toFixed(0)} to ${r.north[k].toFixed(0)},${r.east[k].toFixed(0)}: catchment ${area.toFixed(0)} km²; level ${r.level[inB].toFixed(0)} -> ${r.level[k].toFixed(0)} m; ground beside (1.5 km either side, max) ${Math.max(...[-1, 1].map((sd) => { const m = Math.floor((inB + k) / 2); const dn = r.east[m + 1] - r.east[m], de = -(r.north[m + 1] - r.north[m]); const L = Math.hypot(dn, de) || 1; return lat(r.north[m] + (sd * 1500 * dn) / L, r.east[m] + (sd * 1500 * de) / L); })).toFixed(0)} m`);
            }
            inB = -1;
          }
        }
      }
      console.log(`seed ${seed}: rivers through the front block\n${gor.join('\n')}`);
    }
  }
  setWorldSeed(0);
});
