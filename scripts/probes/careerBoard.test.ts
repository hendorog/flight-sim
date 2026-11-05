// Probe: time of the first career board build in a seeded world (sites, landmarks and the board itself), after the
// world is built. CB_SEED (default 42).
import { it } from 'vitest';
import { boardFor } from '../../src/career/jobs';
import { airfields } from '../../src/world/airfields';
import { setEra } from '../../src/world/era/eraState';
import '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('career board build', () => {
  setEra('present');
  const seed = Number(process.env.CB_SEED ?? 42);
  let t0 = performance.now();
  setWorldSeed(seed);
  const tw = performance.now() - t0;
  const fields = airfields();
  t0 = performance.now();
  const b = boardFor(seed, 1, fields[0].code, fields);
  const t1 = performance.now() - t0;
  t0 = performance.now();
  let k = 0;
  for (const f of fields) k += boardFor(seed, 1, f.code, fields).length;
  const t2 = performance.now() - t0;
  console.log(`seed ${seed}: world ${tw.toFixed(0)} ms; first board (${fields[0].code}, ${b.length} offers) ${t1.toFixed(0)} ms; all ${fields.length} fields' day-1 boards ${t2.toFixed(0)} ms (${k} offers)`);
  setWorldSeed(0);
});
