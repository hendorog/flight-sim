// Foundation stage 4 tuning: build a seeded world with the threshold-hillslope settings in SLOPE_PARAMS (JSON, merged
// over hillslopes.ts SLOPES), print what the pass did, and export the validation box(es) at 20 m (heightExport's format).
//   SLOPE_SEEDS=42 SLOPE_PARAMS='{"sc":0.73}' SLOPE_BOX=-44250,6250,30000 SLOPE_STEP=20 SLOPE_DIR=out/f4/data/seeded \
//     SLOPE_TAG=-try npx vitest run --config scripts/probes/vitest.config.ts slopeTry
import { it } from 'vitest';
import { makeSample, modelMs, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { setSlopeParams, slopeStats } from '../../src/world/terrain/hillslopes';

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: Uint8Array | string): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

it('slope try', () => {
  if (env.SLOPE_PARAMS) setSlopeParams(JSON.parse(env.SLOPE_PARAMS));
  const step = Number(env.SLOPE_STEP ?? 20);
  const dir = env.SLOPE_DIR ?? '.';
  for (const seed of (env.SLOPE_SEEDS ?? '42').split(',')) {
    const t0 = performance.now();
    setWorldSeed(seed);
    const tb = performance.now() - t0;
    console.log(`seed ${seed}: build ${tb.toFixed(0)} ms (model ${modelMs.toFixed(0)} ms); slopes active ${slopeStats.active} sampled ${slopeStats.sampled} corners ${slopeStats.corners} changed ${slopeStats.changed.join(',')} sample ${slopeStats.msSample.toFixed(0)} ms pass ${slopeStats.msPass.toFixed(0)} ms`);
    if (!env.SLOPE_BOX) continue;
    for (const box of env.SLOPE_BOX.split(';')) {
      const [cn, ce, half] = box.split(',').map(Number);
      const n = Math.round((2 * half) / step);
      const z = new Float32Array(n * n);
      const s = makeSample();
      let sea = 0;
      for (let y = 0; y < n; y++) {
        const north = cn + half - (y + 0.5) * step;
        for (let x = 0; x < n; x++) {
          const east = ce - half + (x + 0.5) * step;
          sampleTerrain(north, east, s);
          const water = Math.max(s.standing, s.river);
          if (s.standing > s.ground && s.standing <= 0.5 && s.ground < 0) {
            z[y * n + x] = NaN;
            sea++;
          } else z[y * n + x] = Math.max(s.ground, water);
        }
      }
      const base = `${dir}/seed${seed}_${cn}_${ce}${env.SLOPE_TAG ?? ''}`;
      fs.writeFileSync(`${base}.f32`, new Uint8Array(z.buffer));
      fs.writeFileSync(`${base}.json`, JSON.stringify({ seed: Number(seed), n, res: step, north: cn, east: ce, half, sea }));
      console.log(`  box ${box}: ${n}x${n} at ${step} m -> ${base}.f32`);
    }
  }
});
