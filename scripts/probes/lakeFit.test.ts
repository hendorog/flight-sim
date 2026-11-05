// Probe: how well each seeded lake's ellipse (hydrology.lakes, used by fauna, landmarks and sites) fits its water:
// the share of the ellipse (lakeRadius < 1) over this lake's water, and the share of the lake's water inside it.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { lakeRadius } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';
it('lake fit', () => {
  for (const seed of (process.env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const mask = hydrology.lakeMask!;
    const s = makeSample();
    const inside: number[] = [];
    const covered: number[] = [];
    let centreDry = 0;
    for (const l of hydrology.lakes) {
      const R = Math.max(l.radiusA, l.radiusB) * 1.6 + 1500;
      const step = Math.max(50, Math.round(R / 40));
      let e = 0, ew = 0, w = 0, we = 0;
      for (let pn = l.north - R; pn <= l.north + R; pn += step) for (let pe = l.east - R; pe <= l.east + R; pe += step) {
        const inE = lakeRadius(l, pn, pe) < 1;
        const L = mask.at(pn, pe);
        let wet = false;
        if (L === l.level) { sampleTerrain(pn, pe, s); wet = s.ground < L; }
        if (inE) { e++; if (wet) ew++; }
        if (wet) { w++; if (inE) we++; }
      }
      inside.push(e ? ew / e : 0);
      covered.push(w ? we / w : 0);
      sampleTerrain(l.north, l.east, s);
      if (!(mask.at(l.north, l.east) === l.level && s.ground < l.level)) centreDry++;
    }
    const med = (a: number[]) => a.slice().sort((x, y) => x - y)[a.length >> 1];
    const p10 = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * 0.1)];
    console.log(`seed ${seed}: ${hydrology.lakes.length} lakes; ellipse over water: median ${(100 * med(inside)).toFixed(0)} %, p10 ${(100 * p10(inside)).toFixed(0)} %; water inside the ellipse: median ${(100 * med(covered)).toFixed(0)} %, p10 ${(100 * p10(covered)).toFixed(0)} %; centre not on water ${centreDry}`);
  }
  setWorldSeed(0);
});
