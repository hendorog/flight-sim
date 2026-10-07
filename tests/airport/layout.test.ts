import { describe, expect, it } from 'vitest';
import { DEG } from '../../src/core/math';
import { AIRPORT, runwayThreshold } from '../../src/core/world';
import {
  airportSurface,
  APRON_RECT,
  BUILDINGS,
  centrelineLayout,
  FENCE_RECT,
  FLAT_ZONE,
  HOLD_LINE_V,
  HOLD_SHORT,
  LINE_UP,
  localHeading,
  localToNed,
  MARKINGS,
  nedToLocal,
  PAPIS,
  PAPI_GLIDE_PATH,
  PAPI_TCH,
  PARKING,
  PARKING_POSITIONS,
  pavedSD,
  RUNWAY_HALF_LENGTH,
  TAXIWAYS,
  TOWER,
} from '../../src/world/airport/layout';

const inside = (u: number, v: number, r: { u0: number; u1: number; v0: number; v1: number }) =>
  u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1;

describe('local frame', () => {
  it('round-trips NED <-> local', () => {
    for (const [u, v] of [[0, 0], [100, -50], [-873, 12.5], [3, 400]]) {
      const n = localToNed(u, v);
      const l = nedToLocal(n.north, n.east);
      expect(l.u).toBeCloseTo(u, 9);
      expect(l.v).toBeCloseTo(v, 9);
    }
  });
  it('+u points along 070 and thresholds sit at the runway ends', () => {
    const t07 = runwayThreshold(0);
    const l = nedToLocal(t07.x, t07.y);
    expect(l.u).toBeCloseTo(-RUNWAY_HALF_LENGTH, 6);
    expect(l.v).toBeCloseTo(0, 6);
    expect(localHeading(1, 0) / DEG).toBeCloseTo(70, 9);
    expect(localHeading(-1, 0) / DEG).toBeCloseTo(250, 9);
    expect(localHeading(0, 1) / DEG).toBeCloseTo(160, 9);
  });
  it('the apron is centred on AIRPORT.apron', () => {
    const c = localToNed((APRON_RECT.u0 + APRON_RECT.u1) / 2, (APRON_RECT.v0 + APRON_RECT.v1) / 2);
    expect(c.north).toBeCloseTo(AIRPORT.apron.north, 6);
    expect(c.east).toBeCloseTo(AIRPORT.apron.east, 6);
  });
});

describe('airportSurface', () => {
  const at = (u: number, v: number) => {
    const n = localToNed(u, v);
    return airportSurface(n.north, n.east);
  };
  it('classifies the runway, including its edges and ends', () => {
    expect(at(0, 0)).toBe('runway');
    expect(at(-899.9, 14.9)).toBe('runway');
    expect(at(899.9, -14.9)).toBe('runway');
    expect(at(0, 15.5)).toBeNull();
    expect(at(905, 0)).toBeNull();
  });
  it('classifies taxiways, connectors and the apron as taxiway', () => {
    expect(at(0, -120)).toBe('taxiway');
    expect(at(-300, -50)).toBe('taxiway');
    expect(at(-300, -16)).toBe('taxiway');
    expect(at(-60, -170)).toBe('taxiway');
    expect(at(0, -275)).toBe('taxiway');
  });
  it('fills the junction fillets but not open grass', () => {
    // just outside the corner of connector A2 and the parallel taxiway, inside the fillet
    expect(at(-300 - 5.35 - 1, -120 + 5.35 + 1)).toBe('taxiway');
    expect(at(-200, -60)).toBeNull();
    expect(at(0, 100)).toBeNull();
    expect(at(0, -180)).toBeNull();
    expect(at(5000, 5000)).toBeNull();
  });
  it('pavedSD is a distance near straight edges', () => {
    expect(pavedSD(0, -120 + 5.335 + 2)).toBeCloseTo(2, 1);
    expect(pavedSD(0, -120)).toBeLessThan(-5);
  });
});

describe('markings', () => {
  it('fits an integer number of centreline stripes with a legal gap', () => {
    const c = centrelineLayout();
    const gap = c.period - MARKINGS.centreline.stripe;
    expect(gap).toBeGreaterThan(MARKINGS.centreline.nominalGap * 0.9);
    expect(gap).toBeLessThan(MARKINGS.centreline.nominalGap * 1.1);
    const lastEnd = c.first + (c.count - 1) * c.period + MARKINGS.centreline.stripe;
    expect(lastEnd).toBeCloseTo(RUNWAY_HALF_LENGTH - MARKINGS.centreline.start, 6);
  });
});

describe('named positions', () => {
  it('parks the player on the apron facing the runway', () => {
    const l = nedToLocal(PARKING.north, PARKING.east);
    expect(inside(l.u, l.v, APRON_RECT)).toBe(true);
    expect(PARKING.heading / DEG).toBeCloseTo(160, 6);
    expect(airportSurface(PARKING.north, PARKING.east)).toBe('taxiway');
  });
  it('keeps parking spots on the apron and apart', () => {
    for (const p of PARKING_POSITIONS) expect(airportSurface(p.north, p.east)).toBe('taxiway');
    const names = new Set(PARKING_POSITIONS.map((p) => p.name));
    expect(names.size).toBe(PARKING_POSITIONS.length);
  });
  it('holds short on taxiway pavement behind the hold line', () => {
    for (const h of HOLD_SHORT) {
      const l = nedToLocal(h.north, h.east);
      expect(l.v).toBeLessThan(HOLD_LINE_V);
      expect(airportSurface(h.north, h.east)).toBe('taxiway');
    }
    expect(HOLD_SHORT.map((h) => h.runway)).toEqual(['07', '07', '25', '25']);
  });
  it('lines up on the runway', () => {
    for (const p of LINE_UP) expect(airportSurface(p.north, p.east)).toBe('runway');
  });
  it('places PAPIs on the left, where the 3 degree path crosses the threshold at TCH', () => {
    for (const papi of PAPIS) {
      const landingDir = papi.runway === '07' ? 1 : -1;
      const threshold = -landingDir * RUNWAY_HALF_LENGTH;
      for (const unit of papi.units) {
        // left of the landing direction
        expect(Math.sign(unit.v)).toBe(-landingDir);
        expect(Math.abs(unit.u - threshold) * Math.tan(PAPI_GLIDE_PATH)).toBeCloseTo(PAPI_TCH, 6);
      }
      // innermost unit has the highest angle, so on the path the inner two show red
      const angles = papi.units.map((x) => x.angle);
      expect([...angles].sort((a, b) => b - a)).toEqual(angles);
      expect((angles[1] + angles[2]) / 2).toBeCloseTo(PAPI_GLIDE_PATH, 9);
    }
  });
  it('puts the tower eye above the cab floor', () => {
    expect(TOWER.eyeHeight).toBeGreaterThan(TOWER.cabFloor);
    expect(TOWER.roofHeight).toBeGreaterThan(TOWER.eyeHeight);
  });
});

describe('everything fits the flat zone and avoids pavement', () => {
  it('keeps buildings and the fence inside the flat zone and off the pavement', () => {
    for (const b of BUILDINGS) {
      expect(inside(b.u0, b.v0, FLAT_ZONE) && inside(b.u1, b.v1, FLAT_ZONE)).toBe(true);
      for (const [u, v] of [[b.u0, b.v0], [b.u1, b.v0], [b.u0, b.v1], [b.u1, b.v1]]) expect(pavedSD(u, v)).toBeGreaterThan(0);
    }
    expect(inside(FENCE_RECT.u0, FENCE_RECT.v0, FLAT_ZONE) && inside(FENCE_RECT.u1, FENCE_RECT.v1, FLAT_ZONE)).toBe(true);
  });
  it('keeps taxiways inside the fence', () => {
    for (const t of TAXIWAYS) for (const p of [t.a, t.b]) expect(inside(p.u, p.v, FENCE_RECT)).toBe(true);
  });
});
