// The hand primer of the C152 and the PA-38 in the whole simulation (SimPhysics): a cold-and-dark start that follows
// the start card works, an unprimed one does not catch in a normal start, the scenarios that begin with the engine
// running still do, the primer's state survives a resume (the film, the puddle and the stroke count, which a reload
// does not inject again), and the keys exist on these two types only. The engine physics is pinned in
// tests/propulsion/primer.test.ts.

import { describe, expect, it } from 'vitest';
import C152_DEFINITION from '../../src/aircraft/c152/index';
import PA38_DEFINITION from '../../src/aircraft/pa38/index';
import { C152_INPUT } from '../../src/aircraft/c152/input';
import { PA38_INPUT } from '../../src/aircraft/pa38/input';
import { C172S_INPUT } from '../../src/aircraft/c172s/input';
import { R22_INPUT } from '../../src/aircraft/r22/input';
import { R44_INPUT } from '../../src/aircraft/r44/input';
import { MD500_INPUT } from '../../src/aircraft/md500/input';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import { actionForKey, keyBindingsFor, profileHasAction } from '../../src/input/bindings';
import { parseSnapshot } from '../../src/sim/resume';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { makeInputRig } from '../input/testbed';
import { C152_PANEL } from '../../src/aircraft/c152/panel';
import { PA38_PANEL } from '../../src/aircraft/pa38/panel';
import { C172S_PANEL } from '../../src/aircraft/c172s/panel';
import { buildHotspots, hotspotAt } from '../../src/instruments/hotspots';
import { panelLayoutProblems } from '../../src/instruments/panelLayout';
import { defaultControls as defaults } from '../../src/core/types';

const NOW = 1_800_000_000_000;

function apron(def: AircraftDefinition): { p: SimPhysics; weather: WeatherSettings } {
  const weather = { ...defaultWeather(), turbulence: 0 };
  const p = new SimPhysics({ weather, aircraft: def });
  p.reset('apron');
  return { p, weather };
}

/** The start card's set-up: fuel on, mixture rich, carburettor heat cold, throttle about half an inch, master on. */
function setUp(p: SimPhysics, def: AircraftDefinition): void {
  const c = p.controls;
  c.fuelSelector = def.id === 'pa38' ? 'left' : 'on';
  c.mixture = 1;
  c.carbHeat = 0;
  c.throttle = 0.1;
  c.masterBattery = c.alternator = true;
  c.magnetos = 3;
  c.parkingBrake = true;
  if (def.id === 'pa38') c.fuelPump = true;
}

/** Strokes as the E key makes them (one a frame), then Shift+E. */
function prime(p: SimPhysics, strokes: number): void {
  const c = p.controls;
  for (let k = 0; k < strokes; k++) {
    c.primerStrokes = (c.primerStrokes ?? 0) + 1;
    c.primerLocked = false;
    p.step(1 / 30);
  }
  c.primerLocked = true;
  p.step(0.5);
}

/** Hold the starter until the engine has caught (running above 600 rpm), at most `seconds`; the time it took (NaN: not). */
function crank(p: SimPhysics, seconds: number): number {
  p.controls.starter = true;
  for (let t = 0; t < seconds; t += 0.05) {
    p.step(0.05);
    const e = p.fm.state.engine;
    if (e.running && e.rpm > 600) {
      p.controls.starter = false;
      return t;
    }
  }
  p.controls.starter = false;
  return NaN;
}

function reload(a: { p: SimPhysics; weather: WeatherSettings }, def: AircraftDefinition): SimPhysics {
  const snap = parseSnapshot(JSON.stringify(a.p.captureSnapshot({ weather: a.weather, cameraMode: 'chase', quality: 'high', renderScale: null, resume: true, now: NOW })));
  expect(snap).not.toBeNull();
  const q = new SimPhysics({ weather: { ...snap!.weather }, aircraft: def });
  q.restore(snap!);
  return q;
}

for (const def of [C152_DEFINITION, PA38_DEFINITION]) {
  describe(`${def.shortName}: the hand primer in the simulation`, () => {
    it('cold and dark, the start card with two strokes starts the engine, which keeps running', () => {
      const { p } = apron(def);
      expect(p.controls.primerLocked).toBe(true);
      expect(p.controls.primerStrokes).toBe(0);
      expect(p.fm.state.engine.running).toBe(false);
      setUp(p, def);
      prime(p, 2);
      expect(crank(p, 10)).toBeLessThan(3);
      p.step(30);
      expect(p.fm.state.engine.running).toBe(true);
      expect(p.fm.state.engine.roughness ?? 0).toBe(0);
    }, 60_000);

    it('strokes made at once after the reset, before the physics has stepped (paused), all count', () => {
      const { p } = apron(def);
      setUp(p, def);
      p.controls.primerStrokes = 2;
      p.controls.primerLocked = true;
      p.step(0.5);
      expect(p.fm.captureSystems().engines[0].primer!.ports).toBeCloseTo(2 * def.powerplant.engines[0].engine.primer!.stroke, 9);
      expect(crank(p, 10)).toBeLessThan(3);
    }, 60_000);

    it('cold and dark without the prime, a normal ten-second start does not catch', () => {
      const { p } = apron(def);
      setUp(p, def);
      expect(crank(p, 7)).toBeNaN();
    }, 60_000);

    it('a scenario that begins with the engine running needs no prime, and its primer is locked', () => {
      const weather = { ...defaultWeather(), turbulence: 0 };
      const p = new SimPhysics({ weather, aircraft: def });
      p.reset('runway');
      p.step(5);
      expect(p.fm.state.engine.running).toBe(true);
      expect(p.controls.primerLocked).toBe(true);
      expect(p.fm.state.engine.roughness ?? 0).toBe(0);
    }, 60_000);

    it('a resume keeps the prime (film, puddle, stroke count) and does not inject the strokes again', () => {
      const a = apron(def);
      setUp(a.p, def);
      prime(a.p, 3);
      const before = a.p.fm.captureSystems().engines[0];
      expect(before.primer!.ports).toBeGreaterThan(0.003);
      const b = reload(a, def);
      expect(b.controls.primerStrokes).toBe(3);
      expect(b.controls.primerLocked).toBe(true);
      b.step(0.5);
      const after = b.fm.captureSystems().engines[0];
      expect(after.primer!.ports).toBeCloseTo(before.primer!.ports, 9);
      expect(crank(b, 10)).toBeLessThan(3);
    }, 60_000);
  });
}

describe('the primer keys', () => {
  it('E strokes and Shift+E locks, on the C152 and the PA-38 only (the R22, R44 and MD 500 spread the C152 profile)', () => {
    expect(actionForKey('KeyE', false)).toBe('primerStroke');
    expect(actionForKey('KeyE', true)).toBe('primerLock');
    for (const profile of [C152_INPUT, PA38_INPUT]) {
      expect(profileHasAction(profile, 'primerStroke')).toBe(true);
      expect(profileHasAction(profile, 'primerLock')).toBe(true);
      const rows = keyBindingsFor(profile).filter((r) => r.keys === 'E' || r.keys === 'Shift+E');
      expect(rows.map((r) => r.category)).toEqual(['Engine', 'Engine']);
    }
    for (const profile of [C172S_INPUT, R22_INPUT, R44_INPUT, MD500_INPUT]) {
      expect(profileHasAction(profile, 'primerStroke')).toBe(false);
      expect(keyBindingsFor(profile).some((r) => r.keys === 'E' || r.keys === 'Shift+E')).toBe(false);
    }
    // The R44's ignition-key PRIME is untouched.
    expect(profileHasAction(R44_INPUT, 'fuelPrime')).toBe(true);
  });

  it('on the C152 each press of E is one stroke and unlocks the knob; Shift+E turns it locked and back; held, E strokes once', () => {
    const r = makeInputRig(C152_INPUT, { primerStrokes: 0, primerLocked: true });
    r.tap('KeyE');
    expect(r.c.primerStrokes).toBe(1);
    expect(r.c.primerLocked).toBe(false);
    r.tap('KeyE', false, 1);
    expect(r.c.primerStrokes).toBe(2);
    r.tap('KeyE', true);
    expect(r.c.primerLocked).toBe(true);
    r.tap('KeyE', true);
    expect(r.c.primerLocked).toBe(false);
    expect(r.c.primerStrokes).toBe(2);
  });
});

describe('the primer knob on the panel', () => {
  it('is clickable on the C152 and the PA-38: right half one stroke (unlocked), left half the lock', () => {
    for (const panel of [C152_PANEL, PA38_PANEL]) {
      expect(panelLayoutProblems(panel)).toEqual([]);
      const spots = buildHotspots(panel);
      const [x, y] = panel.primer!.at;
      const spot = hotspotAt(x, y, spots)!;
      expect(spot.id).toBe('primer');
      const c = { ...defaults(), primerStrokes: 0, primerLocked: true };
      spot.turn!(1, c, 1);
      spot.turn!(1, c, 1);
      expect(c.primerStrokes).toBe(2);
      expect(c.primerLocked).toBe(false);
      expect(spot.value(c)).toBe('UNLOCKED, 2 strokes');
      spot.turn!(-1, c, 1);
      expect(c.primerLocked).toBe(true);
      expect(spot.value(c)).toBe('LOCKED');
    }
    expect(buildHotspots(C172S_PANEL).some((h) => h.id === 'primer')).toBe(false);
  });
});
