// Career placement (src/career/placement.ts): a job's leg stands on the same spot as the free-flight 'apron'
// scenario at the home field, a sealed field and a grass strip, cold, with the flight model's mass exactly the empty
// airframe plus the pilot, the items and the dispatch fuel (c152, c172s, pc12, r44, bo105); the helicopters' solo
// pilot mass is the definition's; a stopped job is placed at its stop; the wrong type and an unknown field are refused.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAircraft } from '../../src/aircraft/registry';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { defaultWeather } from '../../src/core/types';
import { fieldStand } from '../../src/career/geo';
import { CAREER_STATIONS } from '../../src/career/stations';
import { careerLoading, careerPilotKg, jobScenario, placementLessonId, placementScenario, usableFuelKgOf } from '../../src/career/placement';
import { OCCUPANT_KG, type ActiveJob, type CareerAircraftId, type PayloadItem } from '../../src/career/types';
import { buildScenario } from '../../src/sim/scenarios';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { setStartField, startField } from '../../src/sim/startField';
import { generatedAirfields, HOME_AIRFIELD, type Airfield } from '../../src/world/airfields';
import { setEra } from '../../src/world/era/eraState';
import '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

const TYPES: readonly CareerAircraftId[] = ['c152', 'c172s', 'pc12', 'r44', 'bo105'];
const defs = new Map<CareerAircraftId, AircraftDefinition>();

/** A passenger beside the pilot and a bag in the type's hold (baggage bay, else cargo). */
function itemsFor(type: CareerAircraftId): PayloadItem[] {
  const st = CAREER_STATIONS[type].stations;
  const hold = st.baggage ? 'baggage' : 'cargo';
  return [
    { kind: 'passenger', label: 'Passenger 1', kg: OCCUPANT_KG, station: 'front' },
    { kind: 'baggage', label: 'Bags', kg: 15, station: hold },
  ];
}

/** A minimal active job (only what placement reads is meaningful). */
function job(type: CareerAircraftId, origin: string, fuelKg: number, extra: Partial<ActiveJob> = {}): ActiveJob {
  return {
    offer: { id: `3-${origin}-2`, origin } as ActiveJob['offer'],
    aircraftUid: 'a1',
    type,
    fuelKg,
    loading: null,
    items: itemsFor(type),
    phase: 'dispatched',
    placed: false,
    acceptedAtMin: 0,
    elapsedBaseS: 0,
    elapsedS: 0,
    lastKnown: { north: 0, east: 0, onGround: true },
    everAirborne: false,
    playerWeather: defaultWeather(),
    ...extra,
  };
}

beforeAll(async () => {
  setEra('present');
  setWorldSeed(0);
  for (const id of TYPES) defs.set(id, await loadAircraft(id));
});

afterAll(() => {
  setStartField(null);
  setWorldSeed(0);
});

describe('a Career leg is placed cold on the field stand with its exact mass', () => {
  const places = (): { name: string; field: Airfield }[] => [
    { name: 'the home field', field: HOME_AIRFIELD },
    { name: 'a sealed field', field: generatedAirfields().find((f) => f.kind === 'sealed')! },
    { name: 'a grass strip', field: generatedAirfields().find((f) => f.kind === 'grass')! },
  ];

  for (const type of TYPES) {
    it(`places the ${type} at the home field, a sealed field and a grass strip with empty + pilot + items + fuel on board`, () => {
      const def = defs.get(type)!;
      const weather = defaultWeather();
      const physics = new SimPhysics({ weather, aircraft: def });
      const usable = usableFuelKgOf(def);
      for (const { field } of places()) {
        expect(field).toBeDefined();
        const fuelKg = 0.6 * usable;
        const j = job(type, field.code, fuelKg);
        const sc = jobScenario(j, def, physics.env);
        // The same spot, heading and switches as the free-flight apron start there.
        expect(sc.id).toBe('apron');
        expect(startField()?.code ?? HOME_AIRFIELD.code).toBe(field.code);
        const apron = buildScenario('apron', physics.env, def);
        expect(sc.ic.position).toEqual(apron.ic.position);
        expect(sc.ic.heading).toBe(apron.ic.heading);
        expect(sc.ic.engineRunning).toBe(false);
        expect(sc.controls).toEqual(apron.controls);
        const stand = fieldStand(field);
        expect(Math.hypot(sc.ic.position.x - stand.north, sc.ic.position.y - stand.east)).toBeLessThan(1e-6);
        expect(sc.title).toBe(`${field.name} (${field.code}), job ${j.offer.id}`);

        physics.resetTo(sc, weather);
        const s = physics.state;
        const tanks = s.fuel.tanks.reduce((a, t) => a + t.quantity, 0);
        expect(Math.abs(tanks - fuelKg)).toBeLessThan(0.01);
        const itemsKg = j.items.reduce((a, it) => a + it.kg, 0);
        expect(Math.abs(s.mass - (def.mass.empty + careerPilotKg(def) + itemsKg + fuelKg))).toBeLessThan(0.01);
        expect(s.onGround).toBe(true);
        expect(s.engines.some((e) => e.running)).toBe(false);
        expect(Math.hypot(s.position.x - sc.ic.position.x, s.position.y - sc.ic.position.y)).toBeLessThan(0.05);
      }
    });
  }

  it('gives the R44 its solo loading pilot (170 lb) and the fixed-wing types and Bo 105 the 77 kg occupant', () => {
    const r44 = defs.get('r44')!;
    expect(careerPilotKg(r44)).toBe(r44.mass.loadings.typical.payload);
    expect(careerPilotKg(r44)).toBeCloseTo(77.11, 2);
    const solo = careerLoading(r44, []);
    expect(solo.payload).toBe(r44.mass.loadings.typical.payload);
    for (const id of ['c152', 'c172s', 'pc12', 'bo105'] as const) expect(careerPilotKg(defs.get(id)!)).toBe(OCCUPANT_KG);
  });

  it('makes a pilot-only leg in the R22, R44, S269 and MD 500 the solo loading their handling was tuned with', async () => {
    for (const id of ['r22', 'r44', 's269', 'md500'] as const) {
      const def = await loadAircraft(id);
      const solo = def.mass.loadings.typical;
      const leg = careerLoading(def, []);
      expect(Math.abs(leg.payload - solo.payload)).toBeLessThan(1e-9);
      for (const k of ['x', 'y', 'z'] as const) expect(Math.abs(leg.payloadPosition[k] - solo.payloadPosition[k])).toBeLessThan(1e-9);
    }
  });

  it('places a stopped job at its stop field, reuses its stored loading and clamps the fuel to the tanks', () => {
    const def = defs.get('c172s')!;
    const physics = new SimPhysics({ weather: defaultWeather(), aircraft: def });
    const [a, b] = generatedAirfields();
    const stored = careerLoading(def, []);
    const sc = jobScenario(job('c172s', a.code, 1e6, { stoppedAt: b.code, loading: stored }), def, physics.env);
    expect(startField()?.code).toBe(b.code);
    expect(sc.loading).toBe(stored);
    expect(sc.ic.fuelFraction).toBe(1);
  });

  it('refuses a job of another type and a field that is not in this world', () => {
    const def = defs.get('c152')!;
    const env = new SimPhysics({ weather: defaultWeather(), aircraft: def }).env;
    expect(() => jobScenario(job('c172s', HOME_AIRFIELD.code, 50), def, env)).toThrow(/c172s/);
    expect(() => placementScenario({ field: 'KZZZ', loading: careerLoading(def, []), fuelKg: 10, jobId: null }, def, env)).toThrow(/KZZZ/);
  });

  it('keeps the plain apron title for a placement without a job and names its lessonId career:hub', () => {
    const def = defs.get('c152')!;
    const env = new SimPhysics({ weather: defaultWeather(), aircraft: def }).env;
    const sc = placementScenario({ field: HOME_AIRFIELD.code, loading: careerLoading(def, []), fuelKg: 30, jobId: null }, def, env);
    expect(startField()).toBeNull();
    expect(sc.title).toBe(buildScenario('apron', env, def).title);
    expect(placementLessonId(null)).toBe('career:hub');
    expect(placementLessonId('3-KELM-2')).toBe('career:3-KELM-2');
  });
});
