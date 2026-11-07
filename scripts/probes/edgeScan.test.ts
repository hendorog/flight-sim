// Probe (foundation stage 1): the drawn ground about the drainage domain's edge (+-160 km): NaN, and steep steps between
// samples 25 m apart, on profiles across the edge from 150 to 180 km out every 500 m along each side. EDGE_SEEDS.
import { it } from 'vitest';
import { makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('edge scan', () => {
  for (const seed of (process.env.EDGE_SEEDS ?? '1,42,777777').split(',')) {
    setWorldSeed(seed);
    const s = makeSample();
    let nan = 0, n = 0, steep = 0, maxStep = 0, where = '';
    const slopes: number[] = [];
    for (let side = 0; side < 4; side++) {
      for (let t = -160000; t <= 160000; t += 500) {
        let prev = NaN;
        for (let r = 150000; r <= 180000; r += 25) {
          const sg = side < 2 ? 1 : -1;
          const north = side % 2 === 0 ? sg * r : t;
          const east = side % 2 === 0 ? t : sg * r;
          sampleTerrain(north, east, s);
          n++;
          const g = s.ground;
          if (!Number.isFinite(g) || !Number.isFinite(s.standing)) { nan++; continue; }
          if (Number.isFinite(prev)) {
            const d = Math.abs(g - prev);
            slopes.push(d / 25);
            if (d > 25) steep++;
            if (d > maxStep) { maxStep = d; where = `${north.toFixed(0)},${east.toFixed(0)}`; }
          }
          prev = g;
        }
      }
    }
    slopes.sort((a, b) => a - b);
    console.log(`seed ${seed}: ${n} samples, NaN ${nan}; steps > 25 m over 25 m: ${steep}; largest ${maxStep.toFixed(1)} m at ${where}; slope p99 ${slopes[Math.floor(0.99 * slopes.length)].toFixed(2)}`);
  }
  setWorldSeed(0);
});
