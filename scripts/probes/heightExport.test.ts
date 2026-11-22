// Height export for the landform validation (out/landforms/tools/validate.py grid): the drawn surface (ground, or the
// water surface where water stands on it, as lidar sees it) on a square grid, NaN over the sea.
//   EXPORT_SEEDS=1,42 EXPORT_HALF=30000 EXPORT_STEP=20 EXPORT_N=0 EXPORT_E=0 EXPORT_DIR=/path \
//     npx vitest run --config scripts/probes/vitest.config.ts heightExport
// Writes <dir>/seed<S>_<n>_<e>.f32 (row-major, north at the top) and a .json header.
import { it } from 'vitest';
import { makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { setResidualFade } from '../../src/world/terrain/erosion';

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: Uint8Array | string): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

it('height export', () => {
  const half = Number(env.EXPORT_HALF ?? 30000);
  const step = Number(env.EXPORT_STEP ?? 20);
  const cn = Number(env.EXPORT_N ?? 0);
  const ce = Number(env.EXPORT_E ?? 0);
  const dir = env.EXPORT_DIR ?? '.';
  // (foundation stage 1 tuning) EXPORT_RES=lo,hi: erosion.ts setResidualFade before the build.
  if (env.EXPORT_RES) setResidualFade(env.EXPORT_RES.split(',').map(Number));
  for (const seed of (env.EXPORT_SEEDS ?? '42').split(',')) {
    setWorldSeed(seed);
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
        } else {
          z[y * n + x] = Math.max(s.ground, water);
        }
      }
    }
    const base = `${dir}/seed${seed}_${cn}_${ce}${env.EXPORT_TAG ?? ''}`;
    fs.writeFileSync(`${base}.f32`, new Uint8Array(z.buffer));
    fs.writeFileSync(`${base}.json`, JSON.stringify({ seed, n, res: step, north: cn, east: ce, half, sea }));
    console.log(`seed ${seed}: ${n}x${n} at ${step} m, sea ${((100 * sea) / (n * n)).toFixed(1)} %`);
  }
});
