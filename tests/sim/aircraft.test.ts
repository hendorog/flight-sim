// The simulation shell and the type flown (contract 2.5, 3.7): the choice of aircraft at boot, one resume
// snapshot per type (schema 3, with the schema-2 migration and the refusal of another type's snapshot), SimPhysics
// on another definition, scenarios and the scripted pilot from a sim profile, the gear events and the
// carburettor-icing switch.

import { describe, expect, it, vi } from 'vitest';
import { AIRCRAFT_CATALOGUE, AIRCRAFT_PREF_KEY, loadAircraft } from '../../src/aircraft/registry';
import { C172S_DEFINITION } from '../../src/aircraft/c172s/index';
import { C172S_SIM } from '../../src/aircraft/c172s/sim';
import type { AircraftDefinition, AutoflightProfile } from '../../src/aircraft/types';
import { KT } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';
import { createEventBus, type SimEvents } from '../../src/core/context';
import { defaultControls, defaultWeather, fixedGearState, setEngineControl, engineControl } from '../../src/core/types';
import { AIRPORT, runwayDirection } from '../../src/core/world';
import { createEnvironment, type SimEnvironment } from '../../src/physics';
import { aircraftSwitchUrl, chooseAircraft, loadCarbIcing, saveAircraftPreference, saveCarbIcing, CARB_ICING_KEY } from '../../src/sim/aircraftChoice';
import { Autoflight, centrelineRudder } from '../../src/sim/autoflight';
import { parseParams } from '../../src/sim/params';
import {
  SNAPSHOT_KEY,
  clearSnapshot,
  decideBoot,
  loadSnapshot,
  parseSnapshot,
  saveSnapshot,
  snapshotKey,
  type FlightSnapshot,
  type KeyValueStore,
} from '../../src/sim/resume';
import { buildScenario, flapLever, FINAL_FLAPS } from '../../src/sim/scenarios';
import { GearEvents, SimPhysics } from '../../src/sim/SimPhysics';

const NOW = 1_800_000_000_000;
const LONG = 60_000;

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

function capture(p: SimPhysics): FlightSnapshot {
  return p.captureSnapshot({ weather: defaultWeather(), cameraMode: 'chase', quality: 'high', renderScale: null, resume: true, now: NOW });
}

/** The snapshot as schema 2 wrote it: no `aircraft`, no `systems`. */
function asSchema2(s: FlightSnapshot): unknown {
  const old = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
  delete old.aircraft;
  delete old.systems;
  old.schema = 2;
  return old;
}

function restored(text: string, aircraft?: AircraftDefinition): SimPhysics {
  const snap = parseSnapshot(text);
  expect(snap).not.toBeNull();
  const q = new SimPhysics({ weather: { ...snap!.weather }, aircraft });
  q.restore(snap!);
  return q;
}

describe('the aircraft of a session', () => {
  const params = (search: string) => parseParams(search);

  it('aircraft= in the URL, else the stored preference of an available type, else the C172S', () => {
    const store = memoryStore();
    expect(chooseAircraft(params(''), store)).toEqual({ id: 'c172s', source: 'default' });
    expect(chooseAircraft(params('?aircraft=c152'), store)).toEqual({ id: 'c152', source: 'url' });
    expect(chooseAircraft(params('?aircraft=b747'), store)).toEqual({ id: 'c172s', source: 'default' });
    // A preference for a type that is not available yet (a placeholder) is not followed; a known available one is.
    const unavailable = AIRCRAFT_CATALOGUE.find((a) => !a.available);
    if (unavailable) {
      store.setItem(AIRCRAFT_PREF_KEY, unavailable.id);
      expect(chooseAircraft(params(''), store).id).toBe('c172s');
    }
    store.setItem(AIRCRAFT_PREF_KEY, 'nonsense');
    expect(chooseAircraft(params(''), store).id).toBe('c172s');
    saveAircraftPreference(store, 'c172s');
    expect(store.map.get(AIRCRAFT_PREF_KEY)).toBe('c172s');
    expect(chooseAircraft(params(''), store)).toEqual({ id: 'c172s', source: 'preference' });
    // A lesson link without aircraft= flies the C172S whatever is stored.
    expect(chooseAircraft(params('?lesson=L04'), store)).toEqual({ id: 'c172s', source: 'default' });
    // Storage that throws is no storage.
    const throwing: KeyValueStore = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('x'); }, removeItem: () => {} };
    expect(chooseAircraft(params(''), throwing).id).toBe('c172s');
    expect(() => saveAircraftPreference(throwing, 'c172s')).not.toThrow();
  });

  it('a change of aircraft reloads without the parameters that would undo it', () => {
    const href = 'https://x.test/index.html?aircraft=c152&scenario=final&lesson=L04&phase=climb&brief=0&resume=1&cam=chase&tod=9';
    expect(aircraftSwitchUrl(href)).toBe('https://x.test/index.html?cam=chase&tod=9');
    expect(aircraftSwitchUrl(href, { open: 'school' })).toBe('https://x.test/index.html?cam=chase&tod=9&school=1');
  });

  it('carburettor icing is on unless switched off', () => {
    const store = memoryStore();
    expect(loadCarbIcing(store)).toBe(true);
    saveCarbIcing(store, false);
    expect(store.map.get(CARB_ICING_KEY)).toBe('0');
    expect(loadCarbIcing(store)).toBe(false);
    saveCarbIcing(store, true);
    expect(loadCarbIcing(store)).toBe(true);
    expect(loadCarbIcing(null)).toBe(true);
  });
});

describe('resume snapshot schema 3', () => {
  it('one key per type: the C172S keeps the old key, another type does not touch it', () => {
    expect(snapshotKey('c172s')).toBe(SNAPSHOT_KEY);
    expect(snapshotKey('c152')).toBe('fs.resume.snapshot.c152');
    const p = new SimPhysics({ weather: defaultWeather() });
    p.reset('cruise');
    const store = memoryStore();
    const snap = capture(p);
    expect(saveSnapshot(store, snap)).toBe(true);
    expect(saveSnapshot(store, { ...snap, simTime: 1 }, 'c152')).toBe(true);
    expect(loadSnapshot(store)?.simTime).toBe(snap.simTime);
    expect(loadSnapshot(store, 'c152')?.simTime).toBe(1);
    clearSnapshot(store, 'c152');
    expect(loadSnapshot(store, 'c152')).toBeNull();
    expect(loadSnapshot(store)).not.toBeNull();
    // Still well inside the bound the storage test sets.
    expect(store.map.get(SNAPSHOT_KEY)!.length).toBeLessThan(6000);
  }, LONG);

  it('carries the type and the systems, and still the schema-2 fields', () => {
    const p = new SimPhysics({ weather: defaultWeather() });
    p.reset('runway');
    p.step(1);
    const s = capture(p);
    expect(s.schema).toBe(3);
    expect(s.aircraft).toBe('c172s');
    expect(s.systems.engines).toHaveLength(1);
    expect(s.systems.engines[0].rpm).toBe(s.engine.rpm);
    expect(s.systems.tanks).toEqual([s.fuel.left, s.fuel.right]);
    expect(s.systems.batteryCharge).toBe(s.batteryCharge);
    expect(s.systems.gear).toEqual({ extension: [1, 1, 1], emergency: false });
  }, LONG);

  it('a schema-2 snapshot restores as a C172S, to the same flight as its schema-3 form', () => {
    const a = new SimPhysics({ weather: defaultWeather() });
    a.autoflightOnReset = true;
    a.reset('cruise');
    a.step(5);
    const s3 = capture(a);
    const back2 = parseSnapshot(JSON.stringify(asSchema2(s3)));
    expect(back2?.aircraft).toBe('c172s');
    expect(back2?.systems.engines[0].rpm).toBe(s3.engine.rpm);
    const q3 = restored(JSON.stringify(s3));
    const q2 = restored(JSON.stringify(asSchema2(s3)));
    expect(q2.state).toEqual(q3.state);
    q3.step(1);
    q2.step(1);
    expect(q2.state).toEqual(q3.state);
    expect(q2.controls).toEqual(q3.controls);
  }, LONG);

  it('a snapshot of another type is refused: by the boot decision, by validation (unknown type) and by restore', () => {
    const p = new SimPhysics({ weather: defaultWeather() });
    p.reset('cruise');
    p.step(1);
    const other = { ...capture(p), aircraft: 'c152' as const };
    const opts = { param: null, explicitScenario: false, enabled: true, now: NOW + 1000 };
    expect(decideBoot(other, opts)).toEqual({ kind: 'normal', reason: 'snapshot is for another aircraft' });
    expect(decideBoot(other, { ...opts, param: true })).toEqual({ kind: 'normal', reason: 'snapshot is for another aircraft' });
    expect(decideBoot(other, { ...opts, aircraft: 'c152' }).kind).toBe('resume');
    expect(decideBoot(capture(p), { ...opts, aircraft: 'c152' }).kind).toBe('normal');
    expect(parseSnapshot(JSON.stringify({ ...other, aircraft: 'b747' }))).toBeNull();
    expect(() => p.restore(other)).toThrow(/c152/);
  }, LONG);

  it('a malformed systems block makes the snapshot unreadable', () => {
    const p = new SimPhysics({ weather: defaultWeather() });
    p.reset('cruise');
    const s = JSON.parse(JSON.stringify(capture(p)));
    s.systems.engines[0].rpm = null;
    expect(parseSnapshot(JSON.stringify(s))).toBeNull();
  }, LONG);
});

describe('SimPhysics flies another definition', () => {
  it('the C152 placeholder: scenarios, flight and a resume of its own type', async () => {
    const def = await loadAircraft('c152');
    const p = new SimPhysics({ weather: defaultWeather(), aircraft: def });
    expect(p.definition).toBe(def);
    expect(p.fm.definition).toBe(def);
    p.autoflightOnReset = true;
    p.reset('runway');
    p.step(3);
    expect(p.state.groundSpeed).toBeGreaterThan(2);
    const s = capture(p);
    expect(s.aircraft).toBe('c152');
    const q = restored(JSON.stringify(s), def);
    expect(q.state.position).toEqual(p.state.position);
    expect(q.definition.id).toBe('c152');
  }, LONG);
});

describe('scenarios from the sim profile', () => {
  const env = createEnvironment({
    weather: defaultWeather(),
    terrain: { height: () => AIRPORT.elevation, normal: () => ({ x: 0, y: 0, z: -1 }), surface: () => 'runway' },
  });

  it('a flap setting that is a detent gives that detent lever exactly', () => {
    const flaps = C172S_DEFINITION.controls.flaps;
    expect(flapLever(flaps, 20)).toBe(2 / 3);
    expect(FINAL_FLAPS).toBe(2 / 3);
    expect(flapLever(flaps, 0)).toBe(0);
    expect(flapLever(flaps, 30)).toBe(1);
    expect(flapLever(flaps, 15)).toBeCloseTo(0.5, 12);
    expect(flapLever(flaps, 40)).toBe(1);
  });

  it('another profile changes the speeds, flaps and switches; a retractable gear is down on final, up in the cruise', () => {
    const sim = {
      ...C172S_SIM,
      scenario: { ...C172S_SIM.scenario, finalKias: 80, finalFlapsDeg: 30, cruiseKias: 140, cruiseAltFt: 6500 },
      presets: { ...C172S_SIM.presets, approach: { ...C172S_SIM.presets.approach, fuelPump: true } },
    };
    const geometry = { ...C172S_DEFINITION.geometry, gear: { ...C172S_DEFINITION.geometry.gear, retractable: true } };
    const def = { ...C172S_DEFINITION, sim, geometry };
    const final = buildScenario('final', env, def);
    expect(final.ic.flaps).toBe(1);
    expect(final.ic.gearDown).toBe(true);
    expect(final.autoflight).toEqual({ kind: 'approach', kias: 80 });
    expect(final.controls?.fuelPump).toBe(true);
    const cruise = buildScenario('cruise', env, def);
    expect(cruise.ic.gearDown).toBe(false);
    expect(cruise.title).toBe('Cruise at 6500 ft along the Alps');
    expect(-cruise.ic.position.z / 0.3048).toBeCloseTo(6500, 6);
    // Fixed gear (the C172S): nothing said about the gear.
    expect(buildScenario('final', env).ic.gearDown).toBeUndefined();
  });
});

describe('the scripted pilot of another type', () => {
  const RWY = AIRPORT.runway;
  const takeoff = { kind: 'takeoff' as const, heading: RWY.heading, climbTo: AIRPORT.elevation + 300, cruiseKias: 90 };
  /** On the runway, 5 m right of the centreline, at `kias`. */
  const rolling = (kias: number) => {
    const d = runwayDirection();
    const s = makeMockState({ north: RWY.center.north - 5 * d.y, east: RWY.center.east + 5 * d.x, heightAGL: 0 });
    s.ias = kias * KT;
    return s;
  };
  const castering: AutoflightProfile = {
    ...C172S_SIM.autoflight,
    steering: { kind: 'differentialBrake', rudderEffectiveKias: 30, brakeGain: 1 },
    climb: { ...C172S_SIM.autoflight.climb, throttle: 0.92 },
    phaseControls: { takeoff: { fuelPump: true }, rollout: { fuelPump: false, cowlFlaps: 1 } },
  };

  it('steers with the brakes below the speed where the rudder steers, fading out toward it', () => {
    for (const kias of [10, 20, 35]) {
      const s = rolling(kias);
      const c = defaultControls();
      const af = new Autoflight(castering);
      af.engage(takeoff, s, c);
      af.update(1 / 240, s, c);
      const r = centrelineRudder(s, RWY.heading);
      expect(r).not.toBe(0);
      expect(c.rudder).toBe(r);
      const v = kias / 30;
      const d = v < 1 ? r * (1 - v * v) : 0;
      expect(c.brakeRight).toBeCloseTo(Math.max(0, d), 12);
      expect(c.brakeLeft).toBeCloseTo(Math.max(0, -d), 12);
    }
  });

  it('sets the phase controls as a phase begins, the climb power of the profile, and every engine\'s throttle', () => {
    const s = rolling(10);
    const c = defaultControls({ engineCount: 2, controlDefaults: {} });
    setEngineControl(c, 1, 'throttle', 0.3);
    const af = new Autoflight(castering);
    af.engage(takeoff, s, c);
    expect(c.fuelPump).toBe(true);
    af.update(1 / 240, s, c);
    expect(engineControl(c, 0, 'throttle')).toBe(1);
    expect(engineControl(c, 1, 'throttle')).toBe(1);
    // Airborne above the hand-over height: the climb, at the profile's power.
    const air = makeMockState({ north: RWY.center.north, east: RWY.center.east, heightAGL: af.restHeight + castering.takeoff.handoverM + 1, tas: 70 * KT });
    af.update(1 / 240, air, c);
    expect(af.phase).toBe('climb');
    af.update(1 / 240, air, c);
    expect(c.throttle).toBe(0.92);
  });

  it('the C172S profile by default, with the C172S\'s rest height', () => {
    const af = new Autoflight();
    expect(af.profile).toBe(C172S_SIM.autoflight);
    expect(af.restHeight).toBe(1.25);
    expect(af.reference).toBe(C172S_DEFINITION.reference);
    expect(af.autopilot.gains).toBe(C172S_DEFINITION.autopilot);
  });
});

describe('gear events and carburettor icing', () => {
  it('a retractable gear: unlock, up, then down and locked; a fixed gear never', () => {
    const g = { ...fixedGearState(), retractable: true, extension: [1, 1, 1] as [number, number, number], locked: [true, true, true] as [boolean, boolean, boolean] };
    const seen: string[] = [];
    const emit = (kind: string, leg: number) => void seen.push(`${kind}${leg}`);
    const w = new GearEvents();
    w.sync(g);
    w.update(g, emit);
    expect(seen).toEqual([]);
    g.locked = [false, false, false];
    g.extension = [0.9, 0.9, 0.9];
    w.update(g, emit);
    expect(seen).toEqual(['unlock0', 'unlock1', 'unlock2']);
    g.extension = [0, 0.1, 0];
    w.update(g, emit);
    expect(seen.slice(3)).toEqual(['up0', 'up2']);
    g.extension = [1, 1, 1];
    g.locked = [true, true, true];
    w.update(g, emit);
    expect(seen.slice(5)).toEqual(['downLocked0', 'downLocked1', 'downLocked2']);
    const fixed = fixedGearState();
    fixed.locked = [false, false, false];
    w.update(fixed, emit);
    expect(seen).toHaveLength(8);
  });

  it('SimPhysics emits them on the event bus only when the gear moves (the C172S: none)', () => {
    const events = createEventBus();
    const got: SimEvents['gear'][] = [];
    events.on('gear', (e) => void got.push(e));
    const p = new SimPhysics({ weather: defaultWeather(), events });
    p.reset('runway');
    p.step(1);
    expect(got).toEqual([]);
  }, LONG);

  it('with icing off the flight model meets the air without its moisture, otherwise the environment itself', () => {
    const p = new SimPhysics({ weather: defaultWeather() });
    p.reset('cruise');
    const step = vi.spyOn(p.fm, 'step');
    p.step(1 / 240);
    expect(step.mock.calls[0][2]).toBe(p.env);
    p.carbIcing = false;
    p.step(1 / 240);
    const dry = step.mock.calls[1][2] as Partial<SimEnvironment>;
    expect(dry).not.toBe(p.env);
    expect(dry.moisture).toBeUndefined();
    expect(dry.atmosphere!(1000)).toEqual(p.env.atmosphere(1000));
    expect(dry.wind!({ x: 0, y: 0, z: -1000 }, 1)).toEqual(p.env.wind({ x: 0, y: 0, z: -1000 }, 1));
    expect(typeof p.env.moisture).toBe('function');
  }, LONG);
});
