// Foundation stage 4 steps: how high the drawn ground stands over a river's water just beside its channel (the lower of
// the two banks, BH_OFF m past the channel's half-width), every 4th channel sample of every river (kind 0) where the
// threshold hillslopes stand (ErosionSample.m over 0.5 at the channel, or BH_ALL): a trench where it is tens of metres.
//   BH_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts bankHeight
import { it } from 'vitest';
import { debugMacro, hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const pct = (a: number[], q: number): number => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(q * a.length))] : NaN);
it('bank height', () => {
  const off = Number(env.BH_OFF ?? 40);
  for (const seed of (env.BH_SEEDS ?? '1,42,777777').split(',')) {
    setWorldSeed(seed);
    const s = makeSample();
    const hs: number[] = [];
    const worst: Array<[number, string]> = [];
    (hydrology.rivers ?? []).forEach((r, li) => {
      if ((r.kind ?? 0) !== 0) return;
      for (let i = 1; i < r.north.length - 1; i += 4) {
        const dm = debugMacro(r.north[i], r.east[i]);
        if (!env.BH_ALL && (!dm || dm.s.mw < 0.5)) continue;
        const dn = r.north[i + 1] - r.north[i - 1];
        const de = r.east[i + 1] - r.east[i - 1];
        const l = Math.hypot(dn, de) || 1;
        const d = r.halfWidth[i] + off;
        const a = sampleTerrain(r.north[i] - (de / l) * d, r.east[i] + (dn / l) * d, s).ground;
        const b = sampleTerrain(r.north[i] + (de / l) * d, r.east[i] - (dn / l) * d, s).ground;
        const hgt = Math.min(a, b) - r.level[i];
        hs.push(hgt);
        if (hgt > 30) worst.push([hgt, `L${li}@${r.north[i].toFixed(0)},${r.east[i].toFixed(0)}`]);
      }
    });
    worst.sort((x, y) => y[0] - x[0]);
    console.log(`seed ${seed}: ${hs.length} samples; lower bank over the water p50 ${pct(hs, 0.5).toFixed(1)} p90 ${pct(hs, 0.9).toFixed(1)} p99 ${pct(hs, 0.99).toFixed(1)} max ${Math.max(...hs).toFixed(0)}; over 10 m ${hs.filter((x) => x > 10).length}, over 30 m ${hs.filter((x) => x > 30).length}; worst ${worst.slice(0, 5).map(([h, w]) => `${h.toFixed(0)} ${w}`).join(', ')}`);
  }
  setWorldSeed(0);
});
