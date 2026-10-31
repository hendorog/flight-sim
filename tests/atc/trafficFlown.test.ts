// Circuit traffic on the real flight model (src/atc/trafficPilot.ts, TrafficSystem's physics LOD): each type flies
// touch-and-go circuits at a generated field, landing in the touchdown zone and lifting off before the runway's end,
// in calm air and in a crosswind; near the player an aircraft changes over to its flight model on the same leg
// and back again as the player leaves. Slow (minutes of simulated flight on the 240 Hz model): tests/slow-tests.txt.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import C172 from '../../src/aircraft/c172s/index';
import C152 from '../../src/aircraft/c152/index';
import PA38 from '../../src/aircraft/pa38/index';
import DA20 from '../../src/aircraft/da20/index';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { activeFrame } from '../../src/atc/calls';
import { circuitPath, placeOnLeg } from '../../src/atc/circuit';
import { TrafficPilot } from '../../src/atc/trafficPilot';
import { TrafficSystem, type Transmission } from '../../src/atc/TrafficSystem';
import { createEnvironment } from '../../src/physics';
import { generatedAirfields, HOME_AIRFIELD as H, type Airfield } from '../../src/world/airfields';
import { setWorldSeed } from '../../src/world/worldSeed';
import { setEra } from '../../src/world/era/eraState';
import '../../src/world/terrain/heightfield';
import { calmWeather, flatEnvironment } from '../fdm/helpers';

/** Fly `seconds` of circuits; the touchdowns and lift-offs, along the runway in use from its centre. */
function circuits(def: AircraftDefinition, field: Airfield, wind: { from: number; kt: number }, seconds: number) {
  const env = flatEnvironment(calmWeather({ windDirectionDeg: wind.from, windSpeedKt: wind.kt }), field.elevation);
  const path = circuitPath(field, 1);
  const pilot = new TrafficPilot(def, path);
  pilot.start(env, path, placeOnLeg(path, 2, 0.3));
  const touch: number[] = [], lift: number[] = [];
  let maxBank = 0, maxAcross = 0, ground = false;
  for (let t = 0; t < seconds; t += 1 / 30) {
    pilot.step(1 / 30, env);
    const s = pilot.state;
    const f = activeFrame(field, 1, s.position.x, s.position.y);
    if (s.onGround !== ground) (s.onGround ? touch : lift).push(f.along);
    ground = s.onGround;
    if (!s.onGround) maxBank = Math.max(maxBank, Math.abs(s.roll));
    if (s.onGround) maxAcross = Math.max(maxAcross, Math.abs(f.across));
    expect(s.crashed).toBe(false);
  }
  return { touch, lift, maxBank, maxAcross };
}

describe.each([
  ['C172', C172, 1100],
  ['C152', C152, 650],
  ['PA38', PA38, 650],
  ['DA20', DA20, 650],
] as const)('%s circuits', (_name, def, length) => {
  const field: Airfield = { ...H, length };
  it.each([
    ['calm', { from: 250, kt: 0 }],
    ['15 kt crosswind', { from: 340, kt: 15 }],
  ] as const)('%s: touch and go in the touchdown zone, lift-off before the end, on the centreline', (_w, wind) => {
    const r = circuits(def, field, wind, 420);
    const thr = -length / 2;
    // The first touchdown (the first lift-off, of the touch and go, follows it).
    const touchdowns = r.touch.filter((_, i) => i === 0 || r.touch[i] - r.touch[i - 1] > 200 || r.lift[i - 1] === undefined);
    expect(touchdowns.length).toBeGreaterThanOrEqual(1);
    expect(r.touch[0]).toBeGreaterThan(thr + 30);
    expect(r.touch[0]).toBeLessThan(thr + 450);
    expect(r.lift[r.lift.length - 1]).toBeLessThan(length / 2 - 60);
    expect(r.maxBank).toBeLessThan(32 * Math.PI / 180);
    expect(r.maxAcross).toBeLessThan(field.width / 2 - 2);
  }, 120_000);
});

describe('the physics LOD', () => {
  setEra('present');
  setWorldSeed(0);
  it('flies the aircraft near the player on its flight model and hands it back as the player leaves', async () => {
    const f = generatedAirfields()[0];
    const env = createEnvironment({ weather: calmWeather(), terrain: { height: () => f.elevation, normal: () => ({ x: 0, y: 0, z: -1 }), surface: () => 'runway' } });
    const defs: Record<string, AircraftDefinition> = { c172s: C172, c152: C152, pa38: PA38, da20: DA20 };
    const traffic = new TrafficSystem({ authority: () => 'easa', env: () => env, exteriors: false, loadDefinition: async (id) => defs[id] });
    const state = { position: { x: f.north, y: f.east }, onGround: false };
    const ctx = { state, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), weather: { windDirectionDeg: 250, windSpeedKt: 0, qnhHpa: 1013 }, timeScale: 1 };
    traffic.init(ctx as never);
    traffic.update(0.1);
    await Promise.resolve();
    await Promise.resolve();
    const heard: Transmission[] = [];
    for (let t = 0; t < 300; t += 0.1) {
      traffic.update(0.1);
      heard.push(...traffic.drain());
    }
    const near = traffic.states.find((a) => a.field.code === f.code)!;
    expect(near.pilot).not.toBeNull();
    expect(traffic.states.filter((a) => a.pilot).length).toBeLessThanOrEqual(2);
    expect(heard.some((h) => h.line.text.startsWith(`${f.name.replace(/ (Aerodrome|Airstrip)$/, '')} Traffic`))).toBe(true);
    const leg = near.state.leg;
    // The player flies away: back to the kinematic circuit, on the same leg, where it was.
    const before = { north: near.state.north, east: near.state.east };
    state.position.x += 100000;
    traffic.update(0.001);
    expect(near.pilot).toBeNull();
    expect(near.state.leg).toBe(leg);
    expect(Math.hypot(near.state.north - before.north, near.state.east - before.east)).toBeLessThan(1);
  }, 120_000);

  it('goes around on its flight model when the player is on its runway, and does not land', async () => {
    const f = generatedAirfields()[0];
    const env = createEnvironment({ weather: calmWeather(), terrain: { height: () => f.elevation, normal: () => ({ x: 0, y: 0, z: -1 }), surface: () => 'runway' } });
    const defs: Record<string, AircraftDefinition> = { c172s: C172, c152: C152, pa38: PA38, da20: DA20 };
    const traffic = new TrafficSystem({ authority: () => 'easa', env: () => env, exteriors: false, loadDefinition: async (id) => defs[id] });
    const state = { position: { x: f.north, y: f.east }, onGround: true };
    const ctx = { state, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), weather: { windDirectionDeg: 250, windSpeedKt: 0, qnhHpa: 1013 }, timeScale: 1 };
    traffic.init(ctx as never);
    traffic.update(0.1);
    await Promise.resolve();
    await Promise.resolve();
    const near = traffic.states.find((a) => a.field.code === f.code)!;
    let goneAround = false, landed = false;
    for (let t = 0; t < 420 && !goneAround; t += 0.1) {
      traffic.update(0.1);
      if (traffic.drain().some((h) => h.line.text.includes(near.registration) && h.line.text.endsWith('going around'))) goneAround = true;
      if (near.pilot?.state.onGround) landed = true;
    }
    expect(goneAround).toBe(true);
    for (let t = 0; t < 30; t += 0.1) {
      traffic.update(0.1);
      if (near.pilot?.state.onGround) landed = true;
    }
    expect(landed).toBe(false);
    expect(['climb', 'cruise', 'roll']).toContain(near.pilot!.autoflight.phase);
    expect(near.pilot!.state.verticalSpeed).toBeGreaterThan(0);
  }, 180_000);
});

describe('taking over low on short final', () => {
  it('trims with the landing flap and lands in the touchdown zone', () => {
    const field: Airfield = { ...H, length: 1100 };
    const env = flatEnvironment(calmWeather(), field.elevation);
    const path = circuitPath(field, 1);
    const pilot = new TrafficPilot(C172, path);
    pilot.start(env, path, placeOnLeg(path, 4, 0.85));
    let touch = NaN;
    for (let t = 0; t < 120 && Number.isNaN(touch); t += 1 / 30) {
      pilot.step(1 / 30, env);
      if (pilot.state.onGround) touch = activeFrame(field, 1, pilot.state.position.x, pilot.state.position.y).along;
      expect(pilot.state.crashed).toBe(false);
    }
    expect(touch).toBeGreaterThan(-550 + 30);
    expect(touch).toBeLessThan(-550 + 450);
  }, 60_000);
});


describe('the home field on the flight model', () => {
  it('flies the departures, circuits and arrivals near the player without a crash, handing a full stop over to the vacate', async () => {
    const env = flatEnvironment(calmWeather({ windDirectionDeg: 250, windSpeedKt: 10 }), H.elevation);
    const defs: Record<string, AircraftDefinition> = { c172s: C172, c152: C152, pa38: PA38, da20: DA20 };
    const traffic = new TrafficSystem({ authority: () => 'easa', env: () => env, exteriors: false, loadDefinition: async (id) => defs[id], homeTraffic: () => true, player: () => ({ registration: 'G-ABFS', icaoType: 'C152' }) });
    const state = { position: { x: H.north + 600, y: H.east }, altitudeMSL: H.elevation, onGround: true, groundSpeed: 0, heading: 0, track: 0 };
    traffic.init({ state, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), weather: { windDirectionDeg: 250, windSpeedKt: 10, qnhHpa: 1015, timeOfDay: 10 }, timeScale: 1 } as never);
    let flownTakeOff = false, flownLanding = false;
    const was = new Map<string, string>();
    for (let k = 0; k < 6000; k++) {
      traffic.update(0.1);
      traffic.drain();
      if (k % 10 === 0) {
        await Promise.resolve();
        await Promise.resolve();
      }
      for (const a of traffic.states) {
        if (!a.ops) continue;
        expect(a.pilot?.state.crashed ?? false).toBe(false);
        const before = was.get(a.registration);
        if (a.ops.phase === 'air' && a.state.onGround && a.pilot) flownTakeOff ||= a.pilot.state.groundSpeed > 10 && a.pilot.state.position.z < 0;
        if (before === 'air' && a.ops.phase === 'vacate' && was.get(`${a.registration}*`) === 'flown') flownLanding = true;
        was.set(a.registration, a.ops.phase);
        was.set(`${a.registration}*`, a.pilot ? 'flown' : 'kinematic');
      }
    }
    expect(flownTakeOff).toBe(true);
    expect(flownLanding).toBe(true);
  }, 600_000);
});
