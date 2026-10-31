// The Career's hooks in the sim (docs/career.md "Integration"): career= and cstore= are parsed and default to the
// plain path; a Scenario's exact `loading` reaches the mass model through resetTo while scenarios without one still
// get the named loadings; restore(snap, loading) rebuilds the same mass for a resumed leg and keeps the loading on
// its scenario, and restore without the argument is unchanged; the snapshot carries the opaque career block.

import { describe, expect, it } from 'vitest';
import { loadAircraft } from '../../src/aircraft/registry';
import { defaultWeather } from '../../src/core/types';
import { careerLoading, placementScenario, usableFuelKgOf } from '../../src/career/placement';
import { OCCUPANT_KG, type PayloadItem } from '../../src/career/types';
import { parseParams } from '../../src/sim/params';
import { parseSnapshot, type FlightSnapshot } from '../../src/sim/resume';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { setStartField } from '../../src/sim/startField';
import { HOME_AIRFIELD } from '../../src/world/airfields';

const NOW = 1_800_000_000_000;
const ITEMS: PayloadItem[] = [
  { kind: 'passenger', label: 'Passenger 1', kg: OCCUPANT_KG, station: 'front' },
  { kind: 'passenger', label: 'Passenger 2', kg: OCCUPANT_KG, station: 'rear' },
  { kind: 'baggage', label: 'Bags', kg: 22, station: 'baggage' },
];

function capture(p: SimPhysics): FlightSnapshot {
  return p.captureSnapshot({ weather: defaultWeather(), cameraMode: 'cockpit', quality: 'high', renderScale: null, resume: true, now: NOW });
}

describe('career URL parameters', () => {
  it('parses career=0|1 and cstore=mem|session, and defaults to no hub and the local store', () => {
    expect(parseParams('').career).toEqual({ open: null, store: 'local' });
    expect(parseParams('?career=1').career.open).toBe(true);
    expect(parseParams('?career=0').career.open).toBe(false);
    expect(parseParams('?career=yes').career.open).toBeNull();
    expect(parseParams('?cstore=mem').career.store).toBe('mem');
    expect(parseParams('?cstore=session').career.store).toBe('session');
    expect(parseParams('?cstore=local').career.store).toBe('local');
    expect(parseParams('?cstore=disk').career.store).toBe('local');
    // The school's own parameters are untouched by the career ones.
    const p = parseParams('?career=1&cstore=mem&tstore=mem&unlock=1');
    expect(p.school.memoryStore).toBe(true);
    expect(p.school.unlock).toBe(true);
    expect(p.school.open).toBeNull();
  });
});

describe('a scenario with an exact loading', () => {
  it('loads the Career payload through resetTo and leaves later plain resets on the named loadings', async () => {
    const def = await loadAircraft('c172s');
    const weather = defaultWeather();
    const p = new SimPhysics({ weather, aircraft: def });
    p.reset('apron', weather);
    const typicalMass = p.state.mass;
    expect(typicalMass).toBeCloseTo(def.mass.empty + def.mass.loadings.typical.payload + usableFuelKgOf(def), 6);

    const fuelKg = 80;
    p.resetTo(placementScenario({ field: HOME_AIRFIELD.code, loading: careerLoading(def, ITEMS), fuelKg, jobId: '1-X-0' }, def, p.env), weather);
    expect(Math.abs(p.state.mass - (def.mass.empty + OCCUPANT_KG * 3 + 22 + fuelKg))).toBeLessThan(0.01);

    // A scenario without `loading` applies its named loading again (the default path).
    p.reset('apron', weather);
    expect(p.state.mass).toBe(typicalMass);
    setStartField(null);
  });
});

describe('restore with the Career loading', () => {
  it('rebuilds the same mass for a resumed leg and keeps the loading on the restored scenario', async () => {
    for (const id of ['c172s', 'r44'] as const) {
      const def = await loadAircraft(id);
      const weather = defaultWeather();
      const items = id === 'r44' ? ITEMS.slice(0, 1) : ITEMS;
      const loading = careerLoading(def, items);
      const p = new SimPhysics({ weather, aircraft: def });
      p.resetTo(placementScenario({ field: HOME_AIRFIELD.code, loading, fuelKg: 0.5 * usableFuelKgOf(def), jobId: '1-X-0' }, def, p.env), weather);
      p.step(1);
      const snap = parseSnapshot(JSON.stringify(capture(p)))!;
      expect(snap).not.toBeNull();

      const q = new SimPhysics({ weather: { ...snap.weather }, aircraft: def });
      const sc = q.restore(snap, loading);
      expect(Math.abs(q.state.mass - p.state.mass)).toBeLessThan(0.01);
      expect(sc.loading).toBe(loading);
      expect(q.scenario.loading).toBe(loading);

      // Without the argument the restore is as before: the definition's default loading, no `loading` on the scenario.
      const r = new SimPhysics({ weather: { ...snap.weather }, aircraft: def });
      const plain = r.restore(snap);
      expect(plain.loading).toBeUndefined();
      const fuel = r.state.fuel.tanks.reduce((a, t) => a + t.quantity, 0);
      expect(r.state.mass).toBeCloseTo(def.mass.empty + def.mass.loadings.typical.payload + fuel, 6);
      setStartField(null);
    }
  });
});

describe('the career block in the snapshot', () => {
  it('survives the JSON round trip opaque, and a null block is deleted', () => {
    const p = new SimPhysics({ weather: defaultWeather() });
    p.reset('apron');
    const s = capture(p);
    expect('career' in s).toBe(false);
    const block = { v: 1, jobId: '3-KELM-2', aircraftUid: 'a1', monitor: { phase: 'ground' } };
    expect(parseSnapshot(JSON.stringify({ ...s, career: block }))?.career).toEqual(block);
    expect('career' in parseSnapshot(JSON.stringify({ ...s, career: null }))!).toBe(false);
  });
});
