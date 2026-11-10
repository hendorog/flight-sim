// Probe (design-V one-network): drawn-ground slope in a box (share over 30 / 35 / 40 degrees) and a coarse map of it.
//   OS_SEED=42 OS_BOX=-12200,-41300,3000 npx vitest run --config scripts/probes/vitest.config.ts onSlope --silent=false --disable-console-intercept
// (Round V step 0: ported unchanged from design-V/one-network/prototype.patch (for the owner-box slope map, tools2/slopemap.py)).
import { it } from 'vitest';
import { terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: string | Uint8Array): void; mkdirSync(p: string, o: unknown): void };
it('slope box', () => {
  const seed = Number(env.OS_SEED ?? 42);
  const [cn, ce, half] = (env.OS_BOX ?? '-12200,-41300,3000').split(',').map(Number);
  const step = Number(env.OS_STEP ?? 25);
  setWorldSeed(seed);
  terrainHeight(0, 0);
  const N = Math.round((2 * half) / step) + 1;
  const H = new Float64Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) H[y * N + x] = terrainHeight(cn - half + y * step, ce - half + x * step);
  let n = 0, s30 = 0, s35 = 0, s40 = 0;
  const deg = new Uint8Array(N * N);
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    const k = y * N + x;
    const gn = (H[k + N] - H[k - N]) / (2 * step);
    const ge = (H[k + 1] - H[k - 1]) / (2 * step);
    const d = (Math.atan(Math.hypot(gn, ge)) * 180) / Math.PI;
    deg[k] = Math.min(255, Math.round(d * 4));
    n++; if (d > 30) s30++; if (d > 35) s35++; if (d > 40) s40++;
  }
  console.log(`seed ${seed} box ${cn},${ce} half ${half}: slope > 30 / 35 / 40 deg ${(100 * s30 / n).toFixed(1)} / ${(100 * s35 / n).toFixed(1)} / ${(100 * s40 / n).toFixed(1)} %`);
  if (env.OS_OUT) { fs.mkdirSync(env.OS_OUT, { recursive: true }); fs.writeFileSync(`${env.OS_OUT}/slope-s${seed}.u8`, deg); fs.writeFileSync(`${env.OS_OUT}/slope-s${seed}.f64`, new Uint8Array(H.buffer)); }
});
