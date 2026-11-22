// Round T repairs 2: the drawn ground on a grid (GR_AT north,east centre, GR_HALF m each way, GR_STEP m) on seed GR_SEED,
// written as float32 rows (north descending, east ascending) to GR_OUT, with the blend weight in a second file.
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { terrainHeight, sampleTerrain, makeSample } from '../../../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('grid', () => {
  setWorldSeed(Number(env.GR_SEED ?? 777777));
  terrainHeight(0, 0);
  const [n0, e0] = (env.GR_AT ?? '-14950,32700').split(',').map(Number);
  const H = Number(env.GR_HALF ?? 300), S = Number(env.GR_STEP ?? 4);
  const N = Math.round((2 * H) / S) + 1;
  const g = new Float32Array(N * N), b = new Float32Array(N * N);
  const s = makeSample();
  for (let a = 0; a < N; a++) for (let c = 0; c < N; c++) {
    sampleTerrain(n0 + H - a * S, e0 - H + c * S, s);
    g[a * N + c] = s.ground;
    b[a * N + c] = s.airportBlend;
  }
  writeFileSync(env.GR_OUT ?? 'grid.f32', Buffer.from(g.buffer));
  writeFileSync((env.GR_OUT ?? 'grid.f32') + '.blend', Buffer.from(b.buffer));
  console.log(`grid ${N} x ${N}`);
  setWorldSeed(0);
});
