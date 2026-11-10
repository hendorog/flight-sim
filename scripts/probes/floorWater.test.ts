// Round V A3: does a river's water stand at the model's floor? Walk the river nearest FW_AT within its box every
// ~100 m: the water level, the model's own ground at the axis (heightfield.ts debugMacro.model: the floor the model
// carved, without the slopes), the drawn ground there, and the lowest drawn ground across (out to 400 m beyond the
// channel each side); then the water over the model's floor (p50 / max) and the water's gradient over the box.
//   FW_SEED=42 FW_AT='n,e,n0,e0,n1,e1[,name];...' npx vitest run --config scripts/probes/vitest.config.ts floorWater
import { it } from 'vitest';
import { debugMacro, hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('floor water', () => {
  setWorldSeed(Number(env.FW_SEED ?? 42));
  const s = makeSample();
  const g = (n: number, e: number): number => sampleTerrain(n, e, s).ground;
  const hit = { dist: Infinity, side: 0, line: -1, kind: 0, index: 0, s: 0, level: 0, halfWidth: 0, gradient: 0, steepness: 0, regime: 0, speed: 0, dirN: 0, dirE: 0 };
  for (const spec of (env.FW_AT ?? '').split(';').filter(Boolean)) {
    const parts = spec.split(',');
    const [an, ae, n0, e0, n1, e1] = parts.slice(0, 6).map(Number);
    const name = parts[6] ?? '';
    hydrology.queryFlow!(an, ae, hit as never);
    const L = hydrology.rivers[hit.line] as unknown as { north: Float64Array; east: Float64Array; level: Float64Array; halfWidth: Float64Array; s: Float64Array; kind?: number };
    let last = -1e9;
    const over: number[] = [];
    const besideLow: number[] = [];
    let first: { s: number; lv: number } | null = null;
    let end: { s: number; lv: number } | null = null;
    let near = Infinity;
    let nearRow = '';
    const rows: string[] = [];
    for (let i = 1; i < L.north.length - 1; i++) {
      const pn = L.north[i], pe = L.east[i];
      if (pn < Math.min(n0, n1) || pn > Math.max(n0, n1) || pe < Math.min(e0, e1) || pe > Math.max(e0, e1)) continue;
      if (L.s[i] - last < 100) continue;
      last = L.s[i];
      const m = debugMacro(pn, pe);
      if (!m) continue;
      let dn = L.north[i + 1] - L.north[i - 1], de = L.east[i + 1] - L.east[i - 1];
      const dl = Math.hypot(dn, de);
      dn /= dl;
      de /= dl;
      let lo = Infinity;
      for (const sd of [-1, 1]) for (let o = L.halfWidth[i] + 15; o <= 400; o += 10) lo = Math.min(lo, g(pn - de * o * sd, pe + dn * o * sd));
      const lv = L.level[i];
      over.push(lv - m.model);
      besideLow.push(lo - lv);
      if (!first) first = { s: L.s[i], lv };
      end = { s: L.s[i], lv };
      const row = `  s ${L.s[i].toFixed(0)} at ${pn.toFixed(0)},${pe.toFixed(0)}: water ${lv.toFixed(1)} model floor ${m.model.toFixed(1)} (water ${(lv - m.model >= 0 ? '+' : '')}${(lv - m.model).toFixed(1)}) drawn ${g(pn, pe).toFixed(1)} lowest beside ${lo.toFixed(1)}`;
      rows.push(row);
      const d = Math.hypot(pn - an, pe - ae);
      if (d < near) {
        near = d;
        nearRow = row;
      }
    }
    const q = (a: number[], p: number): number => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
    const grad = first && end && end.s > first.s ? (100 * (first.lv - end.lv)) / (end.s - first.s) : NaN;
    console.log(`FW ${name} seed ${env.FW_SEED ?? 42} line ${hit.line} near ${an},${ae}: ${over.length} samples; water over the model's floor p50 ${q(over, 0.5).toFixed(1)} p90 ${q(over, 0.9).toFixed(1)} max ${Math.max(...over).toFixed(1)} min ${Math.min(...over).toFixed(1)} m; lowest ground beside - water p10 ${q(besideLow, 0.1).toFixed(1)} min ${Math.min(...besideLow).toFixed(1)} m; gradient ${grad.toFixed(2)} % over ${first && end ? ((end.s - first.s) / 1000).toFixed(2) : 0} km`);
    console.log(`FW ${name} nearest ${near.toFixed(0)} m: ${nearRow.trim()}`);
    if (env.FW_ROWS) console.log(rows.join('\n'));
  }
  setWorldSeed(0);
});
