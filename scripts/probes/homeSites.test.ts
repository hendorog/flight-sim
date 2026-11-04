// Probe: where each seed's home field lands. npx vitest run --config scripts/probes/vitest.config.ts homeSites  (SITE_SEEDS=1,2,3)
import { it } from 'vitest';
import { AIRPORT } from '../../src/core/world';
import { layoutReport } from '../../src/world/terrain/seededLayout';
import { setWorldSeed } from '../../src/world/worldSeed';
import { naturalHeight } from '../../src/world/terrain/heightfield';

const SEEDS = (process.env.SITE_SEEDS ?? '1,7,42,1234,99991,4242,777777,31337,5,6,8,9,10,11,12,13').split(',').map(Number);

it('home sites', () => {
  for (const seed of SEEDS) {
    const t0 = performance.now();
    setWorldSeed(seed);
    const ms = performance.now() - t0;
    const r = layoutReport();
    // Relief around: the highest and lowest natural ground within 10 km.
    let hi = -Infinity, lo = Infinity;
    for (let a = 0; a < 24; a++) for (const d of [3000, 6000, 10000]) {
      const h = naturalHeight(d * Math.cos(a * Math.PI / 12), d * Math.sin(a * Math.PI / 12));
      hi = Math.max(hi, h); lo = Math.min(lo, h);
    }
    console.log(`seed ${seed}: ${AIRPORT.name} (${AIRPORT.icao}) rwy ${AIRPORT.runway.ids.join('/')} elev ${AIRPORT.elevation} m, spread ${r.site?.spread.toFixed(0)}, cand ${r.candidate}, coast ${r.coastKm} km, range ${r.rangeKm} km, inland ${(r.inlandAtField/1000).toFixed(1)} km; within 10 km ${lo.toFixed(0)}..${hi.toFixed(0)} m; build ${ms.toFixed(0)} ms`);
  }
  setWorldSeed(0);
});
