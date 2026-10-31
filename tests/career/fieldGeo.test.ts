// Field geometry of the job runtime (src/career/runtime/fieldGeo.ts): at the home field, landing on 07, the field
// geo provider gives every one of the school's geo signals (src/training/telemetry/providers/geo.ts) to 1e-6 over a
// circuit's worth of positions in the air and on the ground, and fieldTouchdownData with the C172S's own main gear
// equals the school's touchdownData; at a generated field the frame is the landing end's (the reciprocal end flips
// along and across), the aim point is min(150 m, 0.15 x length), the end follows the heading in the air and is
// frozen on the ground, and with no field every signal is undefined rather than wrong.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { C172S_DEFINITION } from '../../src/aircraft/c172s';
import {
  aimPointM, createFieldGeoProvider, fieldRunwayFrame, fieldTouchdownData, landingEndFor, mainsMidpoint,
} from '../../src/career/runtime/fieldGeo';
import { DEG, FT, KT } from '../../src/core/math';
import { makeMockEnvironment, makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather, type AircraftState } from '../../src/core/types';
import { setGpsTarget } from '../../src/instruments/dynamics/navigation';
import { setStartField } from '../../src/sim/startField';
import { touchdownData } from '../../src/training/engine/events';
import { createGeoProvider, GEO_SIGNALS } from '../../src/training/telemetry/providers/geo';
import type { AircraftTypeDef, SignalFrame, TelemetrySources } from '../../src/training/types';
import { fieldPoint, generatedAirfields, HOME_AIRFIELD, type Airfield } from '../../src/world/airfields';
import { setEra } from '../../src/world/era/eraState';
import '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

const AIRCRAFT = { id: 'test' } as unknown as AircraftTypeDef;

function sources(state: AircraftState): TelemetrySources {
  return {
    state, controls: defaultControls(), readings: null, weather: { ...defaultWeather(), windDirectionDeg: 40, windSpeedKt: 12 },
    env: makeMockEnvironment(), aircraft: AIRCRAFT, studentInput: false, timeScale: 1, route: null,
  };
}

/** A mock state at a field-frame point of `f` (along, across from the centre), height above the field (m), heading (rad). */
function at(f: Airfield, along: number, across: number, height: number, heading: number): AircraftState {
  const p = fieldPoint(f, along, across);
  const s = makeMockState({ north: p.north, east: p.east, heading, heightAGL: height });
  s.altitudeMSL = f.elevation + (height <= 0 ? 1.25 : height);
  s.position.z = -s.altitudeMSL;
  return s;
}

beforeAll(() => {
  setEra('present');
  setWorldSeed(0);
});
afterAll(() => {
  setStartField(null);
  setGpsTarget(null);
  setWorldSeed(0);
});

describe('home field, landing on 07', () => {
  it('gives every school geo signal to 1e-6 around a circuit, in the air and on the ground', () => {
    const school = createGeoProvider();
    const field = createFieldGeoProvider(() => HOME_AIRFIELD, { noseX: C172S_DEFINITION.geometry.fuselage.noseX });
    const hdg = HOME_AIRFIELD.heading;
    // Take-off roll, upwind, crosswind, downwind (heading 250, 1 km out: still landing on 07), base, final,
    // threshold, roll-out, a vacate to the apron side.
    const points: [number, number, number, number][] = [
      [-875, 0, 0, hdg], [-300, 2, 0, hdg], [600, 5, 0, hdg], [1400, 0, 150, hdg], [1700, -300, 250, hdg - 70 * DEG],
      [600, -1000, 300, hdg + Math.PI], [-1500, -1000, 300, hdg + Math.PI], [-2200, -500, 200, hdg + 100 * DEG], [-3000, 30, 150, hdg],
      [-1050, 3, 15, hdg], [-850, -2, 0, hdg], [-300, 6, 0, hdg], [-200, 20, 0, hdg + 60 * DEG], [-150, 60, 0, hdg + 90 * DEG],
    ];
    for (const [along, across, height, heading] of points) {
      const s = at(HOME_AIRFIELD, along, across, height, heading);
      const a: SignalFrame = {};
      const b: SignalFrame = {};
      school.sample(a, sources(s), 0.1);
      field.sample(b, sources(s), 0.1);
      for (const d of GEO_SIGNALS) {
        const x = a[d.id];
        const y = b[d.id];
        if (typeof x === 'number') expect(y as number, `${d.id} at ${along},${across}`).toBeCloseTo(x, 6);
        else expect(y, `${d.id} at ${along},${across}`).toBe(x);
      }
      expect(field.landingEnd()).toBe(0);
    }
  });

  it('builds the same touchdown data as the school with the C172S main gear', () => {
    const mains = mainsMidpoint(C172S_DEFINITION.geometry.gear);
    for (const [along, across, pitch, roll] of [[-820, 1.5, 5, 0], [-700, -4, 8, 3], [-910, 0, 2, -2]]) {
      const s = at(HOME_AIRFIELD, along, across, 0.5, HOME_AIRFIELD.heading + 4 * DEG);
      s.pitch = pitch * DEG;
      s.roll = roll * DEG;
      s.track = HOME_AIRFIELD.heading;
      s.groundSpeed = 60 * KT;
      const a = touchdownData(s, 'left', 240);
      const b = fieldTouchdownData(s, 'left', 240, HOME_AIRFIELD, mains);
      for (const k of Object.keys(a) as (keyof typeof a)[]) {
        if (typeof a[k] === 'number') expect(b[k] as number, k).toBeCloseTo(a[k] as number, 6);
        else expect(b[k], k).toBe(a[k]);
      }
    }
  });
});

describe('generated fields', () => {
  it('measures from the landing end: the reciprocal flips along and across', () => {
    const f = generatedAirfields().find((x) => x.kind === 'grass')!;
    const p = fieldPoint(f, -100, 10);
    const e0 = fieldRunwayFrame(f, 0, p.north, p.east);
    const e1 = fieldRunwayFrame(f, 1, p.north, p.east);
    expect(e0.alongThr).toBeCloseTo(f.length / 2 - 100, 9);
    expect(e0.across).toBeCloseTo(10, 9);
    expect(e1.alongThr).toBeCloseTo(f.length / 2 + 100, 9);
    expect(e1.across).toBeCloseTo(-10, 9);
    expect(landingEndFor(f, f.heading + 0.2)).toBe(0);
    expect(landingEndFor(f, f.heading + Math.PI - 0.2)).toBe(1);
  });

  it('puts the aim point at min(150 m, 0.15 x length)', () => {
    expect(aimPointM({ length: 1800 })).toBe(150);
    expect(aimPointM({ length: 650 })).toBeCloseTo(97.5, 9);
    expect(aimPointM({ length: 1000 })).toBe(150);
  });

  it('changes the end in the air only when lined up with the other one, and never on the ground', () => {
    const f = generatedAirfields().find((x) => x.kind === 'sealed')!;
    const geo = createFieldGeoProvider(() => f);
    const out: SignalFrame = {};
    // On final for the reciprocal end, 1 km out.
    geo.sample(out, sources(at(f, f.length / 2 + 1000, 0, 60, f.heading + Math.PI)), 0.1);
    expect(geo.landingEnd()).toBe(1);
    expect(out.rwyAlongM as number).toBeCloseTo(-1000, 6);
    expect(out.distAimFt as number).toBeCloseTo((-1000 - 150) / FT, 6);
    expect(out.gpDevFt as number).toBeCloseTo(60 / FT - (1150 * Math.tan(3 * DEG)) / FT, 6);
    // Landed, then turned off the runway the other way: the end stays.
    geo.sample(out, sources(at(f, 100, 5, 0, f.heading + 10 * DEG)), 0.1);
    expect(geo.landingEnd()).toBe(1);
    expect(out.onRunway).toBe(true);
    expect(out.circuitLeg).toBe('ground');
    // Airborne on the other heading but 1 km out (a downwind leg): kept.
    geo.sample(out, sources(at(f, 100, 1000, 300, f.heading)), 0.1);
    expect(geo.landingEnd()).toBe(1);
    // Lined up with the other end (a climb-out over the runway): the end follows.
    geo.sample(out, sources(at(f, 100, 0, 30, f.heading)), 0.1);
    expect(geo.landingEnd()).toBe(0);
  });

  it('reads a sealed runway as paved and a grass strip as not', () => {
    const sealed = generatedAirfields().find((x) => x.kind === 'sealed')!;
    const grass = generatedAirfields().find((x) => x.kind === 'grass')!;
    const out: SignalFrame = {};
    createFieldGeoProvider(() => sealed).sample(out, sources(at(sealed, 0, 0, 0, sealed.heading)), 0.1);
    expect(out.onPaved).toBe(true);
    createFieldGeoProvider(() => grass).sample(out, sources(at(grass, 0, 0, 0, grass.heading)), 0.1);
    expect(out.onPaved).toBe(false);
    expect(out.onRunway).toBe(true);
  });

  it('leaves every signal undefined with no field', () => {
    const out: SignalFrame = {};
    const geo = createFieldGeoProvider(() => null);
    geo.sample(out, sources(makeMockState()), 0.1);
    expect(geo.landingEnd()).toBeNull();
    for (const d of GEO_SIGNALS) {
      if (d.kind === 'bool') expect(out[d.id]).toBe(false);
      else if (d.kind === 'enum') expect(out[d.id]).toBe('none');
      else expect(Number.isNaN(out[d.id] as number), d.id).toBe(true);
    }
  });
});
