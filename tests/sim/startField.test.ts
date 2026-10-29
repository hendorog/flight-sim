// Starting at a generated airfield (src/sim/startField.ts): the runway, apron and final scenarios move to the chosen
// field; the others, and no choice, stay at the home field.

import { afterAll, describe, expect, it } from 'vitest';
import { defaultWeather } from '../../src/core/types';
import { AIRPORT } from '../../src/core/world';
import { buildScenario } from '../../src/sim/scenarios';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { setStartField, startField } from '../../src/sim/startField';
import { airfieldSurface, fieldCoords, generatedAirfields } from '../../src/world/airfields';
import { setWorldSeed } from '../../src/world/worldSeed';

afterAll(() => setStartField(null));

describe('start field', () => {
  setWorldSeed(0);
  const env = new SimPhysics({ weather: defaultWeather() }).env;

  it('unknown or no field: the home field', () => {
    setStartField('KZZZ');
    expect(startField()).toBeNull();
    setStartField(null);
    const sc = buildScenario('runway', env);
    expect(Math.hypot(sc.ic.position.x, sc.ic.position.y)).toBeLessThan(AIRPORT.runway.length);
  });

  for (const kind of ['sealed', 'grass'] as const) {
    it(`a ${kind} field: lined up on its runway, parked beside it, on its final`, () => {
      const f = generatedAirfields().find((a) => a.kind === kind)!;
      setStartField(f.code);
      const rw = buildScenario('runway', env);
      const c = fieldCoords(f, rw.ic.position.x, rw.ic.position.y);
      expect(Math.abs(c.across)).toBeLessThan(1);
      expect(c.along).toBeLessThan(-f.length / 2 + 50);
      expect(rw.ic.heading).toBeCloseTo(f.heading, 6);
      expect(-rw.ic.position.z).toBe(f.elevation);
      if (kind === 'sealed') expect(airfieldSurface(rw.ic.position.x, rw.ic.position.y)).toBe('runway');
      const ap = buildScenario('apron', env);
      const a = fieldCoords(f, ap.ic.position.x, ap.ic.position.y);
      expect(a.across).toBeGreaterThan(f.width / 2 + 5);
      expect(a.across).toBeLessThan(f.width / 2 + f.flatMargin);
      expect(ap.ic.engineRunning).toBe(false);
      if (kind === 'sealed') expect(airfieldSurface(ap.ic.position.x, ap.ic.position.y)).toBe('taxiway');
      const fin = buildScenario('final', env);
      const fc = fieldCoords(f, fin.ic.position.x, fin.ic.position.y);
      expect(fc.along).toBeLessThan(-f.length / 2 - 5000);
      expect(-fin.ic.position.z).toBeGreaterThan(f.elevation + 250);
      // The others stay at home.
      const dw = buildScenario('downwind', env);
      expect(Math.hypot(dw.ic.position.x, dw.ic.position.y)).toBeLessThan(5000);
      setStartField(null);
    });
  }
});
