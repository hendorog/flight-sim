// The GPS destination (Direct-to, src/instruments/dynamics/navigation.ts): the home field by default, or a generated
// airfield the pilot chose.

import { afterAll, describe, expect, it } from 'vitest';
import { NM } from '../../src/core/math';
import { gpsTarget, gpsToAirport, setGpsTarget, type GpsData } from '../../src/instruments/dynamics/navigation';
import { generatedAirfields, HOME_AIRFIELD } from '../../src/world/airfields';
import { setWorldSeed } from '../../src/world/worldSeed';
import { setEra } from '../../src/world/era/eraState';
// The generated airfields are sited when the terrain module loads.
import '../../src/world/terrain/heightfield';

afterAll(() => setGpsTarget(null));

describe('GPS direct-to', () => {
  setEra('present');
  setWorldSeed(0);
  const out: GpsData = { distanceNm: 0, bearingDeg: 0, trackDeg: 0, groundSpeedKt: 0 };

  it('defaults to the home field, and falls back to it for an unknown code', () => {
    expect(gpsTarget()).toBe(HOME_AIRFIELD);
    setGpsTarget('KZZZ');
    expect(gpsTarget()).toBe(HOME_AIRFIELD);
    gpsToAirport({ x: 0, y: NM, z: 0 }, 0, 0, out);
    expect(out.distanceNm).toBeCloseTo(1, 6);
    expect(out.bearingDeg).toBeCloseTo(270, 6);
  });

  it('measures distance and bearing to the chosen field', () => {
    const f = generatedAirfields()[0];
    setGpsTarget(f.code);
    expect(gpsTarget()).toBe(f);
    gpsToAirport({ x: 0, y: 0, z: 0 }, 0, 0, out);
    expect(out.distanceNm).toBeCloseTo(Math.hypot(f.north, f.east) / NM, 6);
    expect(out.bearingDeg).toBeCloseTo(((Math.atan2(f.east, f.north) * 180) / Math.PI + 360) % 360, 6);
    setGpsTarget(null);
    expect(gpsTarget()).toBe(HOME_AIRFIELD);
  });
});
