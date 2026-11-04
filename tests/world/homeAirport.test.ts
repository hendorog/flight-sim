// The home airfield can move (core/world.ts setHomeAirport): everything derived from it at load follows - the
// layout's NED positions and designators, the flat airfield in the terrain, the home Airfield record, the pattern
// altitude - and putting seed 0's field back gives today's values exactly.

import { afterAll, describe, expect, it } from 'vitest';
import { AIRPORT, runwayCoords, SEED0_HOME, setHomeAirport } from '../../src/core/world';
import { HOME_AIRFIELD } from '../../src/world/airfields';
import { HOLD_SHORT, LINE_UP, PAPIS, PARKING, PARKING_POSITIONS, RUNWAY_CONNECTORS, TOWER, nedToLocal } from '../../src/world/airport/layout';
import { makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { PATTERN_ALTITUDE } from '../../src/sim/scenarios';
import { HOME_RUNWAY } from '../../src/sim/autoflight';
import { DEG } from '../../src/core/math';

const snapshot = (): string => JSON.stringify({ AIRPORT, HOME_AIRFIELD, LINE_UP, HOLD_SHORT, PARKING, PARKING_POSITIONS, PAPIS, RUNWAY_CONNECTORS, TOWER, PATTERN_ALTITUDE, HOME_RUNWAY });

afterAll(() => setHomeAirport(SEED0_HOME));

describe('home airfield', () => {
  it('moves everything derived from it, and back exactly', () => {
    const before = snapshot();
    const local = (p: { north: number; east: number }) => nedToLocal(p.north, p.east);
    const parkingLocal = local(PARKING);
    const lineUpLocal = LINE_UP.map(local);
    setHomeAirport({ name: 'Test Field', icao: 'KTST', elevation: 640, heading: 142 * DEG, ids: ['14', '32'], approachLength: 8000 });
    expect(AIRPORT.runway.ids).toEqual(['14', '32']);
    expect(HOME_AIRFIELD).toMatchObject({ code: 'KTST', name: 'Test Field', elevation: 640, ids: ['14', '32'], heading: 142 * DEG });
    expect(LINE_UP.map((l) => l.runway)).toEqual(['14', '32']);
    expect(LINE_UP.map((l) => l.name)).toEqual(['RWY14', 'RWY32']);
    expect(HOLD_SHORT.map((h) => h.runway)).toEqual(['14', '14', '32', '32']);
    expect(RUNWAY_CONNECTORS.map((c) => c.runway)).toEqual(['14', '14', '32', '32']);
    expect(PAPIS.map((p) => p.runway)).toEqual(['14', '32']);
    // The same places beside the turned runway.
    const pl = local(PARKING);
    expect(pl.u).toBeCloseTo(parkingLocal.u, 6);
    expect(pl.v).toBeCloseTo(parkingLocal.v, 6);
    LINE_UP.forEach((l, i) => {
      expect(local(l).u).toBeCloseTo(lineUpLocal[i].u, 6);
      expect(local(l).v).toBeCloseTo(lineUpLocal[i].v, 6);
    });
    expect(LINE_UP[0].heading).toBeCloseTo(142 * DEG, 9);
    expect(runwayCoords(AIRPORT.apron.north, AIRPORT.apron.east).across).toBeLessThan(-200);
    expect(PATTERN_ALTITUDE).toBeCloseTo(640 + 304.8, 6);
    expect(HOME_RUNWAY).toMatchObject({ heading: 142 * DEG, elevation: 640 });
    // The terrain is flat at the new elevation along the new runway.
    const s = makeSample();
    for (const a of [-0.5, 0, 0.5]) {
      sampleTerrain(Math.cos(142 * DEG) * 900 * a, Math.sin(142 * DEG) * 900 * a, s);
      expect(s.ground).toBe(640);
    }
    setHomeAirport(SEED0_HOME);
    expect(snapshot()).toEqual(before);
  });
});
