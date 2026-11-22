// Probe: the cost of a terrain sample by a seeded world's lakes (inside 1.5 x each ellipse) and away from them.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('lake cost', () => {
  setWorldSeed(Number(process.env.LC_SEED ?? 42));
  const s = makeSample();
  const pts: number[] = [];
  for (const l of hydrology.lakes) for (let k = 0; k < 400; k++) { const a = k * 2.399, r = 1.5 * Math.max(l.radiusA, l.radiusB) * Math.sqrt((k + 0.5) / 400); pts.push(l.north + r * Math.cos(a), l.east + r * Math.sin(a)); }
  for (let rep = 0; rep < 3; rep++) {
    let acc = 0; const t0 = performance.now();
    for (let i = 0; i < pts.length; i += 2) acc += sampleTerrain(pts[i], pts[i + 1], s).ground;
    const tl = (performance.now() - t0) * 2000 / pts.length;
    const t1 = performance.now();
    for (let i = 0; i < 100000; i++) acc += sampleTerrain((i % 300) * 997 - 150000, Math.floor(i / 300) * 913 - 150000, s).ground;
    console.log(`by lakes ${tl.toFixed(2)} us/sample, anywhere ${((performance.now() - t1) * 10).toFixed(2)} us/sample (${acc.toFixed(0)})`);
  }
  setWorldSeed(0);
});
