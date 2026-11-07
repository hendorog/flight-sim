// Foundation stage 4: steep steps in the drawn ground over the whole drainage domain (edgeScan's measure, everywhere):
// profiles every SC_EVERY m along north and east at 25 m, the steps over 25 / 50 / 100 m between neighbouring samples,
// and the worst ones.  SC_SEEDS=1,42,777777 SC_EVERY=2000 npx vitest run --config scripts/probes/vitest.config.ts stepScan
import { it } from 'vitest';
import { makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('step scan', () => {
  const every = Number(env.SC_EVERY ?? 2000);
  for (const seed of (env.SC_SEEDS ?? '1,42,777777').split(',')) {
    setWorldSeed(seed);
    const s = makeSample();
    let n = 0, s25 = 0, s50 = 0, s100 = 0;
    const worst: Array<[number, string]> = [];
    for (let dir = 0; dir < 2; dir++) {
      for (let t = -150000; t <= 150000; t += every) {
        let prev = NaN;
        for (let r = -150000; r <= 150000; r += 25) {
          const north = dir === 0 ? t : r;
          const east = dir === 0 ? r : t;
          sampleTerrain(north, east, s);
          const g = s.ground;
          n++;
          if (Number.isFinite(prev)) {
            const d = Math.abs(g - prev);
            if (d > 25) s25++;
            if (d > 50) s50++;
            if (d > 100) s100++;
            if (d > 50) {
              worst.push([d, `${north},${east}`]);
              if (worst.length > 40) {
                worst.sort((a, b) => b[0] - a[0]);
                worst.length = 20;
              }
            }
          }
          prev = g;
        }
      }
    }
    worst.sort((a, b) => b[0] - a[0]);
    console.log(`seed ${seed}: ${n} samples; steps over 25 m in 25 m ${s25}, over 50 m ${s50}, over 100 m ${s100}; worst ${worst.slice(0, 6).map(([d, w]) => `${d.toFixed(0)} m at ${w}`).join(', ')}`);
  }
  setWorldSeed(0);
});
