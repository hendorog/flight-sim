// Generated airfields (src/world/airfields.ts, terrain/airfieldSiting.ts): sited per seed in the present day, flat,
// dry and spaced apart, with the terrain levelled under them and paved runways felt by the wheels.

import { afterAll, describe, expect, it } from 'vitest';
import { airfields, airfieldSurface, fieldCoords, generatedAirfields, HOME_AIRFIELD, runwayIds } from '../../src/world/airfields';
import { setEra } from '../../src/world/era/eraState';
import { AIRFIELD_COUNT, AIRFIELD_RING } from '../../src/world/terrain/airfieldSiting';
import { makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

afterAll(() => {
  setWorldSeed(0);
  setEra('present');
});

describe('generated airfields', () => {
  it('runway designators follow the heading', () => {
    expect(runwayIds((70 * Math.PI) / 180)).toEqual(['07', '25']);
    expect(runwayIds(0)).toEqual(['36', '18']);
    expect(runwayIds((135 * Math.PI) / 180)).toEqual(['14', '32']);
  });

  for (const seed of [0, 7]) {
    it(`seed ${seed}: a full set, in the ring, spaced, unique codes, flat and dry under the runway`, () => {
      setEra('present');
      setWorldSeed(seed);
      const fields = generatedAirfields();
      expect(fields.length).toBe(AIRFIELD_COUNT);
      expect(airfields()[0]).toBe(HOME_AIRFIELD);
      expect(new Set(fields.map((f) => f.code)).size).toBe(fields.length);
      const s = makeSample();
      for (const f of fields) {
        const d = Math.hypot(f.north, f.east);
        expect(d).toBeGreaterThanOrEqual(AIRFIELD_RING[0]);
        expect(d).toBeLessThanOrEqual(AIRFIELD_RING[1]);
        for (const g of fields) if (g !== f) expect(Math.hypot(g.north - f.north, g.east - f.east)).toBeGreaterThan(10000);
        for (const t of [-0.5, 0, 0.5]) {
          for (const w of [-1, 0, 1]) {
            const along = t * f.length;
            const across = w * (f.width / 2 + 20);
            const n = f.north + Math.cos(f.heading) * along - Math.sin(f.heading) * across;
            const e = f.east + Math.sin(f.heading) * along + Math.cos(f.heading) * across;
            sampleTerrain(n, e, s);
            expect(s.ground).toBe(f.elevation);
            expect(s.airportBlend).toBe(0);
            expect(s.ground).toBeGreaterThan(Math.max(s.standing, s.river));
            expect(fieldCoords(f, n, e).along).toBeCloseTo(along, 6);
          }
        }
        // Wheels: a sealed runway is pavement, a grass strip is not.
        expect(airfieldSurface(f.north, f.east)).toBe(f.kind === 'sealed' ? 'runway' : null);
      }
      expect(fields.some((f) => f.kind === 'sealed')).toBe(true);
    });
  }

  it('differs between seeds and repeats for the same seed', () => {
    setEra('present');
    setWorldSeed(7);
    const a = JSON.stringify(generatedAirfields());
    setWorldSeed(0);
    const b = JSON.stringify(generatedAirfields());
    setWorldSeed(7);
    expect(JSON.stringify(generatedAirfields())).toBe(a);
    expect(a).not.toBe(b);
  });

  it('none in the Cretaceous', () => {
    setWorldSeed(0);
    setEra('cretaceous');
    expect(generatedAirfields()).toEqual([]);
    expect(airfields()).toEqual([HOME_AIRFIELD]);
    setEra('present');
  });
});
