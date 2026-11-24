// Landing damage through the simulation shell (physics/damage.ts; docs/simulator.md "Landing damage"): SimPhysics
// emits one 'damage' SimEvent per new item and disengages the autoflight on disabling damage, never a 'crash'; the
// render state's damage list follows a reset; the resume snapshot carries the damage in its `damage.landing` block
// (restored after setKinematics, so folded legs and seized engines come back, and nothing is re-reported); an old or
// malformed block loads as an undamaged aircraft; disabling damage blocks the aircraft hot swap (as a crash does).

import { describe, expect, it } from 'vitest';
import { quat } from '../../src/core/math';
import { localHeading, localToNed, PARALLEL_TAXIWAY_V, RUNWAY_HALF_WIDTH } from '../../src/world/airport/layout';
import { createEventBus, type SimEvents } from '../../src/core/context';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import { loadAircraft } from '../../src/aircraft/registry';
import { damaged, damageLines, disabled } from '../../src/physics/damage';
import { parseSnapshot, type FlightSnapshot } from '../../src/sim/resume';
import { SimPhysics } from '../../src/sim/SimPhysics';

const NOW = 1_800_000_000_000;

/** The first engine is seized (a propeller strike that dug in). */
const seized = (p: SimPhysics): boolean => (p.fm as unknown as { powerplant: { units: { seized: boolean }[] } }).powerplant.units[0].seized;

interface Rig {
  p: SimPhysics;
  weather: WeatherSettings;
  damage: SimEvents['damage'][];
  crashes: string[];
}

function rig(weather: WeatherSettings = defaultWeather()): Rig {
  const events = createEventBus();
  const r: Rig = { p: new SimPhysics({ weather, events }), weather, damage: [], crashes: [] };
  events.on('damage', (e) => r.damage.push(e));
  events.on('crash', (e) => r.crashes.push(e.reason));
  return r;
}

/** On the runway, then dropped flat from 0.6 m at 26 m/s and `sink` m/s: the nose leg folds (the C172S). */
function hardLanding(r: Rig, sink = 5, seconds = 10): void {
  const p = r.p;
  p.reset('runway');
  const s = p.state;
  const heading = s.heading;
  p.fm.setKinematics({
    position: { ...s.position, z: s.position.z - 0.6 },
    orientation: quat.fromEuler(0, 0, heading),
    velocity: { x: 26 * Math.cos(heading), y: 26 * Math.sin(heading), z: sink },
    angularVelocity: { x: 0, y: 0, z: 0 },
  });
  p.controls.throttle = 0;
  p.step(seconds);
}

function snapshot(r: Rig): FlightSnapshot {
  return r.p.captureSnapshot({ weather: r.weather, cameraMode: 'chase', quality: 'high', renderScale: null, resume: true, now: NOW });
}

/** Through JSON into a new SimPhysics with its own event bus. */
function reload(s: FlightSnapshot | Record<string, unknown>): Rig {
  const back = parseSnapshot(JSON.stringify(s));
  expect(back).not.toBeNull();
  const weather = { ...back!.weather };
  const r = rig(weather);
  r.p.restore(back!);
  return r;
}

describe('landing damage in SimPhysics', () => {
  it('emits a damage event per new item (no crash), disengages the autoflight on disabling damage, and a reset clears it', () => {
    const r = rig();
    const p = r.p;
    // The autoflight engaged just above the runway, the aircraft dropping onto it.
    hardLanding(r, 5, 0);
    p.setAutoflight(true);
    expect(p.autoflight.engaged).toBe(true);
    p.step(10);
    const d = p.state.damage!;
    expect(r.crashes).toEqual([]);
    expect(p.state.crashed).toBe(false);
    expect(d.legs[0].status).toBe('collapsed');
    expect(r.damage.map((e) => e.text)).toEqual(d.events.map((e) => e.text));
    expect(r.damage.some((e) => e.severity === 'disabling')).toBe(true);
    expect(p.autoflight.engaged).toBe(false);
    expect(disabled(d)).toBe(true);
    expect(damaged(d)).toBe(true);
    // The render state (what the UI reads) carries the list.
    expect(damageLines(p.renderState.damage)).toEqual(damageLines(d));
    expect(damageLines(d)).toContain('Nose gear collapsed');
    // A restart clears it, the render state too (copyInto never shortens an array by itself).
    p.reset('runway');
    expect(p.state.damage!.events).toEqual([]);
    expect(p.renderState.damage!.events).toEqual([]);
    expect(disabled(p.state.damage)).toBe(false);
  }, 60000);

  it('a resume snapshot carries the damage: restored after setKinematics (folded leg, seized engine), not re-reported', () => {
    const r = rig();
    hardLanding(r);
    const before = r.p.state.damage!;
    expect(before.props[0].stopped).toBe(true);
    const s = snapshot(r);
    expect(s.damage!.landing).toEqual(before);
    const q = reload(s);
    expect(q.p.state.damage).toEqual(before);
    expect(seized(q.p)).toBe(true);
    expect(damageLines(q.p.renderState.damage)).toEqual(damageLines(before));
    q.p.step(2);
    expect(q.damage).toEqual([]);
    expect(q.p.state.crashed).toBe(false);
    expect(q.p.state.damage!.legs[0].status).toBe('collapsed');
    expect(q.p.state.wheels[0].load).toBe(0);
    expect(q.p.state.engine.rpm).toBe(0);
    expect(disabled(q.p.state.damage)).toBe(true);
  }, 60000);

  it('an undamaged flight writes no landing block; an old snapshot or a malformed block loads undamaged', () => {
    const clean = rig();
    clean.p.reset('runway');
    clean.p.step(1);
    expect(snapshot(clean).damage!.landing).toBeUndefined();

    const r = rig();
    hardLanding(r);
    const s = snapshot(r);
    const old = JSON.parse(JSON.stringify(s)) as FlightSnapshot;
    delete old.damage!.landing;
    const fromOld = reload(old);
    expect(fromOld.p.state.damage!.events).toEqual([]);
    expect(seized(fromOld.p)).toBe(false);

    const bad = JSON.parse(JSON.stringify(s)) as Record<string, any>;
    bad.damage.landing.legs[0].status = 'squashed';
    const parsed = parseSnapshot(JSON.stringify(bad))!;
    expect(parsed).not.toBeNull();
    expect(parsed.damage!.landing).toBeUndefined();
    expect(parsed.damage!.windscreen).toBe(s.damage!.windscreen);
  }, 60000);

  it('lesser damage does not disable: a hard landing on the mains is an inspection note, no chip, hot swap allowed', () => {
    const r = rig();
    const p = r.p;
    p.reset('runway');
    const s = p.state;
    const heading = s.heading;
    // Mains first (5 degrees nose up) at 3 m/s: past V_lim, short of a bent leg.
    p.fm.setKinematics({
      position: { ...s.position, z: s.position.z - 0.4 },
      orientation: quat.fromEuler(0, 5 * Math.PI / 180, heading),
      velocity: { x: 25 * Math.cos(heading), y: 25 * Math.sin(heading), z: 3 },
      angularVelocity: { x: 0, y: 0, z: 0 },
    });
    p.controls.throttle = 0;
    p.step(4);
    const d = p.state.damage!;
    expect(r.damage.length).toBeGreaterThan(0);
    expect(r.damage[0]).toEqual({ item: 'hardLanding', severity: 'inspection', text: 'Hard landing: inspection required' });
    expect(disabled(d)).toBe(false);
  }, 60000);

  it('helicopters carry no landing damage and emit none', async () => {
    for (const id of ['r22', 'r44'] as const) {
      const weather = defaultWeather();
      const events = createEventBus();
      const seen: unknown[] = [];
      events.on('damage', (e) => seen.push(e));
      const p = new SimPhysics({ weather, events, aircraft: await loadAircraft(id) });
      p.reset('runway');
      p.step(2);
      expect(p.state.damage).toBeUndefined();
      expect(p.fm.captureDamage()).toBeNull();
      const s = p.captureSnapshot({ weather, cameraMode: 'chase', quality: 'high', renderScale: null, resume: true, now: NOW });
      expect(s.damage!.landing).toBeUndefined();
      expect(seen).toEqual([]);
      expect(disabled(p.state.damage)).toBe(false);
    }
  }, 60000);

  it('taxiing from grass onto a taxiway or runway causes no gear damage or skid crash', async () => {
    // Fixed-wing tricycle gear (C172S) rolling at ~16 kt from grass across the +5 cm taxiway edge and +9 cm runway edge.
    for (const [edgeV, dirV, targetSurface] of [
      [RUNWAY_HALF_WIDTH + 8, -1, 'runway'],
      [PARALLEL_TAXIWAY_V - 18, 1, 'taxiway'],
    ] as const) {
      const r = rig();
      const p = r.p;
      p.reset('runway');
      const start = localToNed(0, edgeV);
      const hdg = localHeading(0, dirV);
      p.fm.reset({ position: { x: start.north, y: start.east, z: 0 }, heading: hdg, airspeed: 0, onGround: true, engineRunning: true }, p.env);
      p.fm.setKinematics({
        position: { ...p.state.position },
        orientation: { ...p.state.orientation },
        velocity: { x: 8 * Math.cos(hdg), y: 8 * Math.sin(hdg), z: 0 },
        angularVelocity: { x: 0, y: 0, z: 0 },
      });
      p.controls.throttle = 0.35;
      p.controls.parkingBrake = false;
      expect(p.env.surface(start.north, start.east)).toBe('grass');
      let reachedPavement = false;
      for (let i = 0; i < 40; i++) {
        p.step(0.1);
        if (p.env.surface(p.state.position.x, p.state.position.y) === targetSurface) reachedPavement = true;
      }
      expect(reachedPavement).toBe(true);
      expect(r.damage).toEqual([]);
      expect(r.crashes).toEqual([]);
      expect(p.state.damage!.events).toEqual([]);
      expect(p.state.crashed).toBe(false);
    }

    // Skid helicopter (R44) sliding onto the runway from the grass across the pavement edge.
    const weather = defaultWeather();
    const events = createEventBus();
    const crashes: string[] = [];
    events.on('crash', (e) => crashes.push(e.reason));
    const heli = new SimPhysics({ weather, events, aircraft: await loadAircraft('r44') });
    heli.reset('runway');
    const start = localToNed(0, RUNWAY_HALF_WIDTH + 6);
    const hdg = localHeading(0, -1);
    heli.fm.reset({ position: { x: start.north, y: start.east, z: 0 }, heading: hdg, airspeed: 0, onGround: true, engineRunning: true }, heli.env);
    heli.fm.setKinematics({
      position: { ...heli.state.position },
      orientation: { ...heli.state.orientation },
      velocity: { x: 6 * Math.cos(hdg), y: 6 * Math.sin(hdg), z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
    });
    heli.controls.collective = 0;
    heli.step(2.5);
    expect(heli.env.surface(heli.state.position.x, heli.state.position.y)).toBe('runway');
    expect(crashes).toEqual([]);
    expect(heli.state.crashed).toBe(false);
  }, 60000);
});
