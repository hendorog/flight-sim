// Integration: the real flight model flying in the real world environment (terrain heightfield + airport
// pavement + wind field), through the same SimPhysics the browser runs. Every scenario is spawned and flown
// for 30 s by the autoflight; the final approach is flown to a full stop on the runway.

import { describe, expect, it } from 'vitest';
import { C172 } from '../../src/core/c172';
import type { ScenarioId } from '../../src/core/context';
import { FT, KT, quat } from '../../src/core/math';
import { defaultWeather, type AircraftState } from '../../src/core/types';
import { AIRPORT, runwayCoords } from '../../src/core/world';
import { PATTERN_ALTITUDE, SCENARIO_IDS } from '../../src/sim/scenarios';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { worldTerrain } from '../../src/sim/worldEnvironment';
import { airportSurface } from '../../src/world/airport/layout';
import { RUNWAY_HEIGHT } from '../../src/world/airport/pavement';

function finite(s: AircraftState): boolean {
  const p = s.position;
  const q = s.orientation;
  return [p.x, p.y, p.z, q.w, q.x, q.y, q.z, s.ias, s.engine.rpm, s.verticalSpeed].every(Number.isFinite);
}

/** NED position of a wheel's tyre contact point (strut compression applied along body z). */
function contactPoint(s: AircraftState, i: 0 | 1 | 2) {
  const g = [C172.gear.nose, C172.gear.leftMain, C172.gear.rightMain][i];
  const body = { x: g.x, y: g.y, z: g.z - s.wheels[i].compression };
  const r = quat.rotate(s.orientation, body);
  return { x: s.position.x + r.x, y: s.position.y + r.y, z: s.position.z + r.z };
}

function sim(id: ScenarioId, autoflight = true): SimPhysics {
  const p = new SimPhysics({ weather: defaultWeather() });
  p.autoflightOnReset = autoflight;
  p.reset(id);
  return p;
}

describe('scenarios in the real world environment', () => {
  it.each(SCENARIO_IDS)('%s: spawns sane and flies 30 s on autoflight', (id) => {
    const p = sim(id);
    const s = p.state;
    const start = { ...s.position };
    const startGround = worldTerrain.height(s.position.x, s.position.y);
    expect(finite(s)).toBe(true);
    if (s.onGround) expect(s.altitudeMSL - startGround).toBeCloseTo(1.25, 1);
    else expect(s.altitudeMSL - startGround).toBeGreaterThan(150);

    p.step(30);
    expect(finite(s)).toBe(true);
    expect(s.crashed).toBe(false);
    const moved = Math.hypot(s.position.x - start.x, s.position.y - start.y);
    const ground = worldTerrain.height(s.position.x, s.position.y);
    switch (id) {
      case 'apron':
        expect(moved).toBeLessThan(0.05);
        expect(s.engine.running).toBe(false);
        expect(s.electrical.busVoltage).toBe(0);
        expect(s.wheels.every((w) => w.onGround)).toBe(true);
        break;
      case 'runway':
        // Take-off roll, rotation and the start of the climb, still over the runway heading.
        expect(s.onGround).toBe(false);
        expect(s.altitudeMSL - ground).toBeGreaterThan(20);
        expect(Math.abs(runwayCoords(s.position.x, s.position.y).across)).toBeLessThan(15);
        break;
      case 'final': {
        const rc = runwayCoords(s.position.x, s.position.y);
        const toThreshold = -AIRPORT.runway.length / 2 - rc.along;
        const glidePathHeight = (toThreshold + 150) * Math.tan(3 * (Math.PI / 180));
        expect(Math.abs(s.altitudeMSL - AIRPORT.elevation - glidePathHeight)).toBeLessThan(25);
        expect(Math.abs(s.ias / KT - 70)).toBeLessThan(8);
        // 3 kt of crosswind (default weather): the centreline tracker converges slowly.
        expect(Math.abs(rc.across)).toBeLessThan(45);
        break;
      }
      case 'cruise':
        expect(Math.abs(s.altitudeMSL - 4500 * FT)).toBeLessThan(25);
        expect(Math.abs(s.ias / KT - 110)).toBeLessThan(6);
        break;
      case 'downwind':
        expect(Math.abs(s.altitudeMSL - PATTERN_ALTITUDE)).toBeLessThan(25);
        expect(Math.abs(s.ias / KT - 90)).toBeLessThan(6);
        break;
    }
  }, 60000);

  it('final: lands on runway 07 and stands still on the drawn pavement at the right height', () => {
    const p = sim('final');
    const s = p.state;
    let t = 0;
    let touchdownAcross = NaN;
    while (p.autoflight.phase !== 'stopped' && !s.crashed && t < 300) {
      p.step(0.25);
      t += 0.25;
      if (Number.isNaN(touchdownAcross) && (s.wheels[1].onGround || s.wheels[2].onGround)) touchdownAcross = runwayCoords(s.position.x, s.position.y).across;
    }
    expect(s.crashed).toBe(false);
    expect(p.autoflight.phase).toBe('stopped');
    // The default 6 kt wind from 100 is ~3 kt across runway 07: the tracker must correct for the drift and
    // put the wheels near the centreline (the runway is 30 m wide).
    expect(Math.abs(touchdownAcross)).toBeLessThan(5);
    // Settle on the parking brake, then check it stands still.
    p.step(5);
    const before = { ...s.position };
    p.step(10);
    expect(Math.hypot(s.position.x - before.x, s.position.y - before.y)).toBeLessThan(0.02);
    expect(s.groundSpeed).toBeLessThan(0.05);
    // Resting on all three wheels, nose slightly up (as spawned on the apron), not propped on the nose strut.
    expect((s.pitch * 180) / Math.PI).toBeGreaterThan(-0.5);
    expect((s.pitch * 180) / Math.PI).toBeLessThan(2);

    const rc = runwayCoords(s.position.x, s.position.y);
    expect(Math.abs(rc.along)).toBeLessThan(AIRPORT.runway.length / 2);
    expect(Math.abs(rc.across)).toBeLessThan(5);
    const pavement = AIRPORT.elevation + RUNWAY_HEIGHT;
    for (const i of [0, 1, 2] as const) {
      const c = contactPoint(s, i);
      expect(s.wheels[i].onGround).toBe(true);
      expect(airportSurface(c.x, c.y)).toBe('runway');
      // Tyre contact within 3 cm of the painted surface (tyre deflection is not in the strut compression).
      expect(Math.abs(-c.z - pavement)).toBeLessThan(0.03);
    }
    expect(s.altitudeMSL - pavement).toBeGreaterThan(1.2);
    expect(s.altitudeMSL - pavement).toBeLessThan(1.3);
  }, 120000);

  it('fixed-step advance with interpolation matches exact stepping', () => {
    const a = sim('cruise', false);
    const b = sim('cruise', false);
    // Irregular frame times (e.g. a 144 Hz display with jitter) against exact steps of the same total.
    let total = 0;
    for (let i = 0; i < 300; i++) {
      const dt = 1 / 144 + (i % 7) * 0.0007;
      a.advance(dt);
      total += dt;
    }
    b.step(Math.floor(total / b.stepSize) * b.stepSize);
    expect(a.steps).toBe(b.steps);
    expect(a.state.position.x).toBeCloseTo(b.state.position.x, 6);
    // The render state lags the physics state by less than one step.
    const lag = Math.hypot(a.renderState.position.x - a.state.position.x, a.renderState.position.y - a.state.position.y);
    expect(lag).toBeLessThan(a.state.groundSpeed * a.stepSize + 1e-6);
  }, 60000);

  it('a huge frame time is clamped (no spiral of death)', () => {
    const p = sim('cruise', false);
    const n = p.advance(5);
    expect(n).toBeLessThanOrEqual(Math.ceil(0.1 / p.stepSize) + 1);
  }, 60000);
});
