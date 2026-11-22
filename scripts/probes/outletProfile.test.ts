// Probe (debugging): a river's level and ground for 4 km past the lake outlet nearest OUT_AT=north,east (seed OUT_SEED).
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeight, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('outlet profile', () => {
  setWorldSeed(Number(process.env.OUT_SEED ?? 1));
  const [an, ae] = (process.env.OUT_AT ?? '-28500,-135150').split(',').map(Number);
  const mask = hydrology.lakeMask!;
  const s = makeSample();
  let best = Infinity, br = -1, bk = -1;
  hydrology.rivers!.forEach((r, ri) => { for (let k = 1; k < r.north.length; k++) {
    if (!(mask.at(r.north[k - 1], r.east[k - 1]) > -Infinity && mask.at(r.north[k], r.east[k]) === -Infinity)) continue;
    const dd = Math.hypot(r.north[k] - an, r.east[k] - ae); if (dd < best) { best = dd; br = ri; bk = k; } } });
  const r = hydrology.rivers![br];
  console.log(`river ${br} outlet ${bk} at ${r.north[bk].toFixed(0)},${r.east[bk].toFixed(0)} (${best.toFixed(0)} m away); half-width ${r.halfWidth[bk].toFixed(0)}`);
  for (let k = Math.max(0, bk - 3); k < r.north.length && r.s[k] - r.s[bk] < 4000; k += 2) {
    sampleTerrain(r.north[k], r.east[k], s);
    console.log(`  s ${(r.s[k] - r.s[bk]).toFixed(0).padStart(5)}: level ${r.level[k].toFixed(1)} natural ${naturalHeight(r.north[k], r.east[k]).toFixed(1)} ground ${s.ground.toFixed(1)} lake ${mask.at(r.north[k], r.east[k]).toFixed(0)}`);
  }
  setWorldSeed(0);
});
