// Proves the Career's field geometry (src/career/geo.ts): a field by code, distances in NM and bearings, the nearest
// field, the stands (the home field's PARKING, the generated fields' 'apron' scenario spots), and fieldArea: the home
// field's apron is its APRON_RECT and PARKING_SPOTS stands, so PARKING is on the apron and the point at the dummy
// apronAlong is not; a sealed field's apron box and a grass strip's stand circle; the runway, the rest of the field
// and outside, each at its COMPLETION_RULES limit.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearingDeg, compassName, distanceNm, fieldArea, fieldAt, fieldByCode, fieldStand, nearestField, placeName, requireField,
} from '../../src/career/geo';
import { COMPLETION_RULES } from '../../src/career/types';
import { NM } from '../../src/core/math';
import { setGpsTarget } from '../../src/instruments/dynamics/navigation';
import { buildScenario } from '../../src/sim/scenarios';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { setStartField } from '../../src/sim/startField';
import { defaultWeather } from '../../src/core/types';
import { airfields, fieldPoint, HOME_AIRFIELD, type Airfield } from '../../src/world/airfields';
import { APRON_RECT, localToNed, PARKING, PARKING_POSITIONS } from '../../src/world/airport/layout';
import { setEra } from '../../src/world/era/eraState';
import '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

const R = COMPLETION_RULES;

beforeAll(() => {
  setEra('present');
  setWorldSeed(0);
});
afterAll(() => {
  setStartField(null);
  setGpsTarget(null);
  setWorldSeed(0);
});

describe('field lookup, distance and bearing', () => {
  it('finds a field by code and refuses an unknown one', () => {
    const fields = airfields();
    const g = fields.find((f) => f.kind === 'grass')!;
    expect(fieldByCode(g.code, fields)).toBe(g);
    expect(fieldByCode('KZZZ', fields)).toBeUndefined();
    expect(requireField(fields[0].code, fields)).toBe(HOME_AIRFIELD);
    expect(() => requireField('KZZZ', fields)).toThrow();
  });

  it('measures NM and true bearings on the flat NED world', () => {
    const o = { north: 0, east: 0 };
    expect(distanceNm(o, { north: 3 * NM, east: 4 * NM })).toBeCloseTo(5, 12);
    expect(bearingDeg(o, { north: 1, east: 0 })).toBeCloseTo(0, 12);
    expect(bearingDeg(o, { north: 0, east: 1 })).toBeCloseTo(90, 12);
    expect(bearingDeg(o, { north: -1, east: 0 })).toBeCloseTo(180, 12);
    expect(bearingDeg(o, { north: 0, east: -1 })).toBeCloseTo(270, 12);
    expect(compassName(44)).toBe('north-east');
    expect(compassName(359)).toBe('north');
    expect(compassName(-90)).toBe('west');
    expect(compassName(200)).toBe('south');
  });

  it('names the nearest field to a point, and none with no fields', () => {
    const fields = airfields();
    for (const f of fields) {
      const p = fieldPoint(f, 100, 300);
      expect(nearestField(p.north, p.east, fields)!.field).toBe(f);
    }
    expect(nearestField(0, 0, [])).toBeNull();
  });

  it('shortens field names for titles', () => {
    expect(placeName(HOME_AIRFIELD)).toBe('Fable');
    for (const f of airfields().slice(1)) expect(placeName(f)).not.toMatch(/Aerodrome|Airstrip/);
  });
});

describe('stands', () => {
  it('put the job at the home PARKING and at each generated field’s apron start', () => {
    const env = new SimPhysics({ weather: defaultWeather() }).env;
    expect(fieldStand(HOME_AIRFIELD)).toEqual({ north: PARKING.north, east: PARKING.east, heading: PARKING.heading });
    for (const f of airfields().slice(1)) {
      setStartField(f.code);
      const sc = buildScenario('apron', env);
      const s = fieldStand(f);
      expect(s.north).toBeCloseTo(sc.ic.position.x, 9);
      expect(s.east).toBeCloseTo(sc.ic.position.y, 9);
      expect(s.heading).toBeCloseTo(sc.ic.heading, 9);
      expect(fieldArea(f, s.north, s.east)).toBe('apron');
    }
    setStartField(null);
  });
});

describe('fieldArea', () => {
  it('says apron at the home PARKING, at every home stand and in APRON_RECT, and not at the dummy apronAlong', () => {
    const home = HOME_AIRFIELD;
    expect(fieldArea(home, PARKING.north, PARKING.east)).toBe('apron');
    for (const s of PARKING_POSITIONS) expect(fieldArea(home, s.north, s.east)).toBe('apron');
    const c = localToNed((APRON_RECT.u0 + APRON_RECT.u1) / 2, (APRON_RECT.v0 + APRON_RECT.v1) / 2);
    expect(fieldArea(home, c.north, c.east)).toBe('apron');
    // Where a generated field's apron would be (apronAlong 0, w + 43): beside the home runway on the far side, grass.
    const dummy = fieldPoint(home, home.apronAlong, home.width / 2 + 43);
    expect(fieldArea(home, dummy.north, dummy.east)).toBe('inside');
    // Just outside the rectangle and more than homeStandM from every stand.
    const out = localToNed(APRON_RECT.u0 - R.homeStandM - 1, APRON_RECT.v0 - 1);
    expect(fieldArea(home, out.north, out.east)).not.toBe('apron');
  });

  it('finds the runway, the rest of the field and outside at their limits', () => {
    for (const f of airfields()) {
      const at = (along: number, across: number) => {
        const p = fieldPoint(f, along, across);
        return fieldArea(f, p.north, p.east);
      };
      const w = f.width / 2;
      expect(at(0, 0)).toBe('runway');
      expect(at(f.length / 2 - 1e-6, w - 1e-6)).toBe('runway');
      expect(at(f.length / 2 + 1, 0)).toBe('inside');
      // (Near the runway's end: a grass strip's stand circle, grassSpotM round a stand w + 16 out, reaches across it.)
      expect(at(-(f.length / 2 - 1), -(w + 1)), f.code).toBe('inside');
      expect(at(f.length / 2 + R.alongMarginM - 0.01, R.acrossM - 0.01)).toBe('inside');
      expect(at(f.length / 2 + R.alongMarginM + 0.01, 0)).toBeNull();
      // (The far side: the home apron lies beyond acrossM on the near side and counts as the field.)
      expect(at(0, R.acrossM + 0.01)).toBeNull();
    }
  });

  it('bounds a sealed field’s apron by the along and across limits', () => {
    const f = airfields().find((x) => x.kind === 'sealed')!;
    const w = f.width / 2;
    const at = (along: number, across: number) => {
      const p = fieldPoint(f, along, across);
      return fieldArea(f, p.north, p.east);
    };
    expect(at(f.apronAlong + R.apronAlongM - 0.01, w + R.apronAcrossMin + 0.01)).toBe('apron');
    expect(at(f.apronAlong - R.apronAlongM + 0.01, w + R.apronAcrossMax - 0.01)).toBe('apron');
    expect(at(f.apronAlong + R.apronAlongM + 0.01, w + 40)).toBe('inside');
    expect(at(f.apronAlong, w + R.apronAcrossMin - 0.01)).toBe('inside');
    expect(at(f.apronAlong, w + R.apronAcrossMax + 0.01)).toBe('inside');
  });

  it('makes a grass strip’s apron the circle round its stand', () => {
    const f = airfields().find((x) => x.kind === 'grass')!;
    const s = fieldStand(f);
    expect(fieldArea(f, s.north + R.grassSpotM - 0.01, s.east)).toBe('apron');
    expect(fieldArea(f, s.north, s.east - R.grassSpotM - 0.01)).not.toBe('apron');
  });

  it('places a point at the first field that contains it, or none', () => {
    const fields: readonly Airfield[] = airfields();
    for (const f of fields) {
      const p = fieldPoint(f, 0, 0);
      expect(fieldAt(p.north, p.east, fields)).toEqual({ field: f, area: 'runway' });
    }
    expect(fieldAt(1e6, 1e6, fields)).toBeNull();
  });
});
