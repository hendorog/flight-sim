// Foundation streams, task B: clipped hedge walls (placement.ts TreeCellData.walls) on and off the plains. A world's
// tree cells sampled every HW_STEP cells over +-HW_HALF m about the home field; each wall piece classed by the relief
// over its 5 km window (terrainHeight on a 1 km lattice within 2 km either way, highest less lowest: plain under 150 m,
// as scripts/probes/treeMetrics.ts reliefClasses). Prints counts and km, by class, and where the off-plain ones are.
//   HW_SEEDS=0,42,777777 HW_HALF=40000 HW_STEP=3 npx vitest run --config scripts/probes/vitest.config.ts hedgeWalls
import { it } from 'vitest';
import { terrainHeight } from '../../src/world/terrain/heightfield';
import { buildTreeCell, WALL_STRIDE } from '../../src/world/terrain/vegetation/placement';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('hedge walls', () => {
  const CELL = 256;
  const half = Number(env.HW_HALF ?? 40000), step = Number(env.HW_STEP ?? 3);
  for (const seed of (env.HW_SEEDS ?? '0').split(',')) {
    setWorldSeed(seed);
    const relief = new Map<string, number>();
    const reliefAt = (n: number, e: number): number => {
      const k = `${Math.round(n / 1000)},${Math.round(e / 1000)}`;
      let r = relief.get(k);
      if (r === undefined) {
        let lo = Infinity, hi = -Infinity;
        for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const h = Math.max(0, terrainHeight(Math.round(n / 1000) * 1000 + a * 1000, Math.round(e / 1000) * 1000 + b * 1000)); lo = Math.min(lo, h); hi = Math.max(hi, h); }
        r = hi - lo; relief.set(k, r);
      }
      return r;
    };
    const cls = { plain: { n: 0, km: 0 }, hill: { n: 0, km: 0 }, mtn: { n: 0, km: 0 } };
    const off: string[] = [];
    let cells = 0;
    const span = Math.ceil(half / CELL);
    for (let cz = -span; cz <= span; cz += step) for (let cx = -span; cx <= span; cx += step) {
      const c = buildTreeCell({ cx, cz, size: CELL, spacing: 5.5 });
      cells++;
      const w = c.walls;
      for (let i = 0; i < w.length; i += WALL_STRIDE) {
        const e = (w[i] + w[i + 3]) / 2, n = (w[i + 1] + w[i + 4]) / 2;
        const L = Math.hypot(w[i + 3] - w[i], w[i + 4] - w[i + 1]) / 1000;
        const r = reliefAt(n, e);
        const k = r >= 500 ? 'mtn' : r >= 150 ? 'hill' : 'plain';
        cls[k].n++; cls[k].km += L;
        if (k !== 'plain' && off.length < 15) off.push(`${n.toFixed(0)},${e.toFixed(0)} relief ${r.toFixed(0)} m species ${w[i + 8]} tall ${w[i + 6].toFixed(1)}`);
      }
    }
    console.log(`seed ${seed}: ${cells} cells (1 in ${step * step} of +-${half / 1000} km); wall pieces plain ${cls.plain.n} (${cls.plain.km.toFixed(2)} km), hill ${cls.hill.n} (${cls.hill.km.toFixed(2)} km), mountain ${cls.mtn.n} (${cls.mtn.km.toFixed(2)} km)`);
    for (const o of off) console.log(`  off the plains: ${o}`);
  }
  setWorldSeed(0);
});
