// DESIGN-LOWLINE: the lines (rivers and streams) passing within LN_R m of points on a segment.
//   LN_SEED=777777 LN_SEG=-2500,-4500,500,-7400 npx vitest run --config scripts/probes/vitest.config.ts scripts/probes/lowLinesBy.test.ts --disableConsoleIntercept
import { it } from 'vitest';
import { hydrology, terrainHeight, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('lines near', () => {
  setWorldSeed(Number(env.LN_SEED ?? 777777));
  terrainHeight(0, 0);
  const [n0, e0, n1, e1] = (env.LN_SEG ?? '-2500,-4500,500,-7400').split(',').map(Number);
  const R = Number(env.LN_R ?? 800);
  type L = { north: Float64Array; east: Float64Array; level: Float64Array; halfWidth: Float64Array; s: Float64Array; kind?: number; area?: Float64Array; joins?: number };
  const L = (hydrology.rivers ?? []) as unknown as L[];
  const S = makeSample();
  const seen = new Map<number, string>();
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const pn = n0 + (n1 - n0) * t, pe = e0 + (e1 - e0) * t;
    L.forEach((r, li) => {
      if (seen.has(li)) return;
      for (let i = 0; i < r.north.length; i += 2) {
        if (Math.hypot(r.north[i] - pn, r.east[i] - pe) < R) {
          sampleTerrain(r.north[i], r.east[i], S);
          seen.set(li, `line ${li} kind ${r.kind ?? 0} len ${(r.s[r.s.length - 1] / 1000).toFixed(1)} km area ${r.area ? r.area[i].toFixed(1) : '?'} at ${r.north[i].toFixed(0)},${r.east[i].toFixed(0)} level ${r.level[i].toFixed(1)} hw ${r.halfWidth[i].toFixed(1)} ground ${S.ground.toFixed(1)} river-at ${S.river === -Infinity ? '-' : S.river.toFixed(1)} joins ${r.joins}`);
          return;
        }
      }
    });
  }
  { let rk = 0, nr = 0; for (const r of L) if ((r.kind ?? 0) === 0) { rk += r.s[r.s.length - 1] / 1000; nr++; } console.log(`LN rivers ${nr} total ${rk.toFixed(0)} km`); }
  console.log(`LN lines ${L.length}`);
  for (const li of (env.LN_LINES ?? '').split(',').filter((x) => x).map(Number)) {
    const r = L[li];
    const m = r.north.length - 1;
    console.log(`LN line ${li} kind ${r.kind ?? 0} samples ${m + 1} len ${(r.s[m] / 1000).toFixed(2)} km from ${r.north[0].toFixed(0)},${r.east[0].toFixed(0)} (level ${r.level[0].toFixed(1)}, area ${r.area ? r.area[0].toFixed(1) : '?'}) to ${r.north[m].toFixed(0)},${r.east[m].toFixed(0)} (level ${r.level[m].toFixed(1)}, area ${r.area ? r.area[m].toFixed(1) : '?'}) joins ${r.joins}`);
  }
  if (env.LN_OUT) {
    const box = (env.LN_BOX ?? '-8000,4000,-12000,0').split(',').map(Number);
    const out: Array<{ li: number; kind: number; n: number[]; e: number[]; a: number }> = [];
    L.forEach((r, li) => {
      const n: number[] = [], e: number[] = [];
      let inside = false;
      for (let i = 0; i < r.north.length; i += 2) { n.push(Math.round(r.north[i])); e.push(Math.round(r.east[i])); if (r.north[i] > box[0] && r.north[i] < box[1] && r.east[i] > box[2] && r.east[i] < box[3]) inside = true; }
      if (inside) out.push({ li, kind: r.kind ?? 0, n, e, a: r.area ? r.area[r.area.length - 1] : 0 });
    });
    (require('node:fs') as typeof import('node:fs')).writeFileSync(env.LN_OUT, JSON.stringify(out));
  }
  for (const v of seen.values()) console.log('LN ' + v);
});
