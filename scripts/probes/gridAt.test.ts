// gridAt (round T): sampleTerrain over a small grid: ground, standing water, river water, approach.
//   GA_SEED=777777 GA_C=-13700,31300 GA_R=600 GA_STEP=100
import { it } from 'vitest';
import { makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('grid at', () => {
  setWorldSeed(Number(env.GA_SEED ?? 777777));
  terrainHeight(0, 0);
  const s = makeSample();
  const [cn, ce] = (env.GA_C ?? '-13700,31300').split(',').map(Number);
  const R = Number(env.GA_R ?? 600), D = Number(env.GA_STEP ?? 100);
  for (let n = cn + R; n >= cn - R; n -= D) {
    const row: string[] = [];
    for (let e = ce - R; e <= ce + R; e += D) {
      sampleTerrain(n, e, s);
      const w = Math.max(s.standing, s.river);
      row.push(w > s.ground + 0.05 ? `${s.standing > s.ground + 0.05 ? 'L' : 'R'}${(w - s.ground).toFixed(0)}` : `.${(s as unknown as { approach: number }).approach > 0 ? 'a' : ''}`);
    }
    console.log(`${n}: ${row.map((x) => x.padStart(5)).join('')}`);
  }
  setWorldSeed(0);
});
