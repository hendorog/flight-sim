// Probe: ground held flat at a lake's level off the water (the lake guard's plateau): over each lake's lattice cells and
// a ring of 1.5 km round them, at 100 m, the dry points whose ground sits flat (it and the ground 100 m round it) within
// 0.3-0.6 m of level + 0.5 while the natural ground there stands more than 5 m higher (the carve was held up), and the
// largest drop within 300 m of such ground.
//   MESA_AT=north,east,halfwidth prints a 100 m ground profile grid summary there.
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeight, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { AIRPORT } from '../../src/core/world';
it('mesa', () => {
  for (const seed of (process.env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const s = makeSample();
    const rc = AIRPORT.runway.center;
    let held = 0, held40 = 0, cliff = 0, where = '';
    const seen = new Set<number>();
    for (const l of hydrology.lakes) {
      const R = Math.max(l.radiusA, l.radiusB) * 2 + 1500;
      for (let pn = Math.round((l.north - R) / 100) * 100; pn <= l.north + R; pn += 100) for (let pe = Math.round((l.east - R) / 100) * 100; pe <= l.east + R; pe += 100) {
        const key = Math.round(pn / 100) * 100000 + Math.round(pe / 100);
        if (seen.has(key)) continue;
        seen.add(key);
        sampleTerrain(pn, pe, s);
        if (s.standing > s.ground || s.river > -Infinity) continue;
        if (Math.abs(s.ground - (l.level + 0.5)) > 0.3) continue;
        if (naturalHeight(pn, pe) < l.level + 5) continue;
        // Flat: the ground 100 m round it at the same height (a shelf, not a slope crossing that height).
        let flat = true;
        for (let k = 0; k < 4 && flat; k++) { sampleTerrain(pn + 100 * Math.cos(k * Math.PI / 2), pe + 100 * Math.sin(k * Math.PI / 2), s); flat = Math.abs(s.ground - (l.level + 0.5)) < 0.6 && s.standing <= s.ground; }
        if (!flat) continue;
        held++;
        if (Math.hypot(pn - rc.north, pe - rc.east) < 40000) held40++;
        // The drop to the lowest ground 300 m away.
        let low = Infinity;
        for (let k = 0; k < 8; k++) { sampleTerrain(pn + 300 * Math.cos(k * Math.PI / 4), pe + 300 * Math.sin(k * Math.PI / 4), s); low = Math.min(low, s.ground); }
        if (l.level - low > cliff) { cliff = l.level - low; where = `${pn},${pe} (lake ${l.level.toFixed(0)})`; }
      }
    }
    console.log(`seed ${seed}: ground held at lake level + 0.5 over higher natural ground: ${(held / 100).toFixed(2)} km² (${(held40 / 100).toFixed(2)} km² within 40 km of home); deepest drop within 300 m of it ${cliff.toFixed(0)} m at ${where}`);
  }
  setWorldSeed(0);
});
