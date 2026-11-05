// Probe: a seeded world's lake edges (LakeMask). Where the water stops at the edge of a lake's mask while the ground
// just beyond lies below its level, the water ends in a vertical wall. Scans every lake's surroundings at 50 m.
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeight, naturalHeightCoarse, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('lake edge', () => {
  for (const seed of (process.env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const mask = hydrology.lakeMask!;
    const s = makeSample();
    const STEP = 50;
    let nearRiver = 0, natLow = 0, shore = 0, wall2 = 0, wall10 = 0, worst = 0, where = '';
    for (const l of hydrology.lakes) {
      const R = Math.max(l.radiusA, l.radiusB) * 2.2 + 1500;
      const n0 = Math.round((l.north - R) / STEP) * STEP, e0 = Math.round((l.east - R) / STEP) * STEP;
      const m = Math.ceil((2 * R) / STEP);
      const wet = new Int8Array(m * m);
      const ground = new Float32Array(m * m);
      const nat = new Float32Array(m * m);
      const rd = new Float32Array(m * m);
      for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
        const pn = n0 + i * STEP, pe = e0 + j * STEP;
        const L = mask.at(pn, pe);
        sampleTerrain(pn, pe, s);
        ground[i * m + j] = s.ground;
        nat[i * m + j] = naturalHeight(pn, pe);
        rd[i * m + j] = s.riverDist;
        wet[i * m + j] = L === l.level ? (s.ground < L ? 1 : 0) : -1; // -1: outside this lake's mask
      }
      for (let i = 1; i < m - 1; i++) for (let j = 1; j < m - 1; j++) {
        if (wet[i * m + j] !== 1) continue;
        for (const [a, b] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
          const q = (i + a) * m + j + b;
          if (wet[q] !== -1) continue;
          shore++;
          const h = l.level - ground[q];
          if (h > 2 && process.env.EDGE_SHOW && wall2 % 400 === 0) console.log(`  wall ${h.toFixed(0)} m at ${(n0 + (i + a) * STEP).toFixed(0)},${(e0 + (j + b) * STEP).toFixed(0)}: level ${l.level.toFixed(0)} natural ${nat[q].toFixed(0)} coarse ${naturalHeightCoarse(n0 + (i + a) * STEP, e0 + (j + b) * STEP).toFixed(0)} river ${rd[q].toFixed(0)} other lake ${mask.at(n0 + (i + a) * STEP, e0 + (j + b) * STEP).toFixed(0)}`);
          if (h > 2) { wall2++; if (rd[q] < 600) nearRiver++; if (l.level - nat[q] > 2) natLow++; }
          if (h > 10) wall10++;
          if (h > worst) { worst = h; where = `${(n0 + (i + a) * STEP).toFixed(0)},${(e0 + (j + b) * STEP).toFixed(0)} (lake level ${l.level.toFixed(0)}, inside ${(n0 + i * STEP).toFixed(0)},${(e0 + j * STEP).toFixed(0)} ground ${ground[i * m + j].toFixed(0)}, outside ground ${ground[q].toFixed(0)} natural ${nat[q].toFixed(0)})`; }
        }
      }
    }
    console.log(`seed ${seed}: ${hydrology.lakes.length} lakes; mask-edge water points ${shore}: wall >2 m ${wall2} (${(100 * wall2 / Math.max(1, shore)).toFixed(1)} %), >10 m ${wall10}; of the >2 m: within 600 m of a river ${nearRiver}, natural ground already under the level ${natLow}; worst ${worst.toFixed(1)} m at ${where}`);
  }
  setWorldSeed(0);
});
