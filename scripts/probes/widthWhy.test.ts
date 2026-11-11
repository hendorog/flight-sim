// Round W R: drawnGate (i)'s profiles, each with what the law drew there - the bed (bedR + bedL), the water (wetR + wetL)
// - so the spread of the drawn width against catchment can be laid at its causes. WW_SEEDS.
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeight, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('width why', () => {
  for (const seed of (env.WW_SEEDS ?? '42').split(',')) {
    setWorldSeed(seed);
    type L = { north: Float64Array; east: Float64Array; level: Float64Array; s: Float64Array; kind?: number; area?: Float64Array; bedR?: Float32Array; bedL?: Float32Array; wetR?: Float32Array; wetL?: Float32Array };
    const R = hydrology.rivers! as unknown as L[];
    const sm = makeSample();
    const hit = { dist: 0, level: 0, halfWidth: 0, s: 0, side: 0, beyondSource: 0 };
    const mask = hydrology.lakeMask;
    const rows: number[][] = [];
    R.forEach((r) => {
      if ((r.kind ?? 0) !== 1 || !r.area) return;
      const sEnd = r.s[r.s.length - 1];
      let next = 150;
      for (let i = 1; i + 1 < r.s.length; i++) {
        if (r.s[i] < next || r.s[i] > sEnd - 150) continue;
        next = r.s[i] + 400;
        const A = r.area[i];
        if (A < 1) continue;
        const n0 = r.north[i], e0 = r.east[i];
        if (mask && mask.at(n0, e0) > -Infinity) continue;
        const tn = r.north[i + 1] - r.north[i - 1], te = r.east[i + 1] - r.east[i - 1], tl = Math.hypot(tn, te) || 1;
        const pn = -te / tl, pe = tn / tl;
        let clear = true;
        for (const o of [-300, -150, 0, 150, 300]) {
          hydrology.queryRiver(n0 + pn * o, e0 + pe * o, hit);
          if (hit.dist < 300 && hit.halfWidth > 0 && (hit.level < r.level[i] - 0.5 || hit.level > r.level[i] + 0.5 || Math.abs(o) > 0) && Math.abs(hit.level - r.level[i]) > 0.5) { clear = false; break; }
        }
        if (!clear) continue;
        const lvl = r.level[i];
        let width = 0;
        for (const side of [-1, 1]) for (let d = 0; d <= 120; d += 0.5) {
          const n = n0 + pn * d * side, e = e0 + pe * d * side;
          sampleTerrain(n, e, sm);
          if (!(sm.river > sm.ground || (sm.ground <= lvl + 1 && sm.ground < naturalHeight(n, e) - 0.3))) break;
          width += 0.5;
        }
        if (width > 0) rows.push([A, width, (r.bedR?.[i] ?? 0) + (r.bedL?.[i] ?? 0), (r.wetR?.[i] ?? 0) + (r.wetL?.[i] ?? 0)]);
      }
    });
    const corr = (x: number[], y: number[]): number => { const mx = x.reduce((a, b) => a + b, 0) / x.length, my = y.reduce((a, b) => a + b, 0) / y.length; let c = 0, vx = 0, vy = 0; for (let k = 0; k < x.length; k++) { c += (x[k] - mx) * (y[k] - my); vx += (x[k] - mx) ** 2; vy += (y[k] - my) ** 2; } return c / Math.sqrt(vx * vy || 1); };
    const la = rows.map((r) => Math.log(r[0]));
    const q = (a: number[], p: number): number => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
    const ratio = rows.map((r) => r[1] / Math.max(0.1, r[2]));
    console.log(`WW seed ${seed}: ${rows.length} profiles; corr(log drawn, log A) ${corr(rows.map((r) => Math.log(r[1])), la).toFixed(2)}; corr(log bed, log A) ${corr(rows.map((r) => Math.log(Math.max(0.1, r[2]))), la).toFixed(2)}; corr(log water, log A) ${corr(rows.map((r) => Math.log(Math.max(0.1, r[3]))), la).toFixed(2)}; drawn/bed p10 ${q(ratio, 0.1).toFixed(2)} p50 ${q(ratio, 0.5).toFixed(2)} p90 ${q(ratio, 0.9).toFixed(2)} p99 ${q(ratio, 0.99).toFixed(2)}; drawn at the 120 m walk's end ${rows.filter((r) => r[1] >= 240).length}`);
    const trimmed = rows.filter((r, k) => ratio[k] < q(ratio, 0.9));
    console.log(`WW seed ${seed}: without the widest tenth (drawn/bed): corr(log drawn, log A) ${corr(trimmed.map((r) => Math.log(r[1])), trimmed.map((r) => Math.log(r[0]))).toFixed(2)}`);
  }
  setWorldSeed(0);
});
