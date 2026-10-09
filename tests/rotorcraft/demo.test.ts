import { describe, expect, it } from 'vitest';
import { KT } from '../../src/core/math';
import { R22_ROTORCRAFT as d } from '../../src/aircraft/r22/rotorcraft';
import { createEventBus } from '../../src/core/context';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { R22_DEMOS, R22Flight } from '../../src/sim/rotorcraft/flights';
import { demoScenario, demoWeather } from '../../src/sim/rotorcraft/starts';
import { FlightRecorder } from './scriptedPilot';

describe('live R22 flights through the app physics and scenery', () => {
  const cases = [...R22_DEMOS.map(id => ({ id, gross: true })), { id: 'autorotation' as const, gross: false }];
  for (const { id, gross } of cases) it(`${id}${gross ? '' : ' solo'}: reaches terminal hold in the app environment`, () => {
    const weather = demoWeather(), events = createEventBus();
    const sim = new SimPhysics({ weather, events, aircraft: R22_DEFINITION });
    const scenario = demoScenario(id, sim.env);
    if (!gross) { scenario.payload = 'typical'; scenario.ic.fuelFraction = 0.5; }
    sim.resetTo(scenario, weather);
    const flight = new R22Flight(id, sim.state, sim.controls, gross);
    sim.copilot = flight;
    const contacts: { time: number; sink: number; groundKts: number; rpm: number }[] = [];
    events.on('touchdown', e => contacts.push({ time: sim.state.time, sink: e.sinkRate,
      groundKts: sim.state.groundSpeed / KT, rpm: sim.state.rotorcraft!.rotorRpm / d.referenceRpm * 100 }));
    sim.stepHold = () => !flight.flying && flight.outcome !== 'taken-over';
    const log = new FlightRecorder({ fm: sim.fm, c: sim.controls });
    let maxVs = -Infinity, maxAltitudeGain = -Infinity;
    while (flight.flying) {
      const flaring = id === 'autorotation' && flight.phase !== 'autorotate' && !contacts.length;
      const altitude = sim.state.altitudeMSL;
      if (flaring && !sim.state.onGround) maxVs = Math.max(maxVs, sim.state.verticalSpeed);
      sim.step(id === 'autorotation' ? 1 / 240 : 0.25);
      if (flaring && !contacts.length && !sim.state.onGround) {
        maxVs = Math.max(maxVs, sim.state.verticalSpeed);
        maxAltitudeGain = Math.max(maxAltitudeGain, sim.state.altitudeMSL - altitude);
      }
      log.observe(flight.time, flight.phase);
    }
    log.touchdowns.push(...contacts);
    log.save(`live-${id}${gross ? '' : '-solo'}`);
    expect({ outcome: flight.outcome, crashed: sim.state.crashed, phase: flight.phase }).toEqual({
      outcome: 'complete', crashed: false,
      phase: id === 'startup' ? 'hover' : id === 'hover' ? 'cruise' : 'park',
    });
    const stoppedAt = sim.state.time;
    sim.step(5); sim.advance(1, 16);
    expect(sim.state.time).toBe(stoppedAt); // terminal hold also applies to accelerated/rendered flight
    if (id === 'approach' || id === 'circuit') {
      const landing = contacts.filter(p => p.time > 100);
      expect(landing.length).toBeGreaterThan(0);
      expect(Math.max(...landing.map(p => p.sink))).toBeLessThan(.5);
      expect(landing[0].groundKts).toBeLessThan(.5);
      expect(landing[0].rpm).toBeGreaterThan(101);
    } else if (id === 'autorotation') {
      expect(flight.phases.slice(0, 4).map(p => p.phase)).toEqual(['autorotate', 'flare', 'level', 'cushion']);
      expect(contacts.length > 0 || sim.state.crashed).toBe(true);
      expect(Number.isFinite(maxVs) && Number.isFinite(maxAltitudeGain)).toBe(true);
      expect(maxVs).toBeLessThanOrEqual(0);
      expect(maxAltitudeGain).toBeLessThanOrEqual(0);
      expect(contacts[0].groundKts).toBeLessThan(10);
      expect(contacts[0].sink).toBeLessThan(1.5);
      expect(sim.state.groundSpeed).toBeLessThan(0.1);
      expect(sim.controls.collective).toBe(0);
    } else if (id === 'startup') {
      expect(sim.state.altitudeAGL - R22_DEFINITION.rotorcraft!.skids.z).toBeCloseTo(3, 0);
      expect(sim.state.rotorcraft!.governorActive).toBe(true);
    } else {
      expect(sim.state.ias / KT).toBeGreaterThan(80);
      expect(sim.state.ias / KT).toBeLessThan(90);
      expect(flight.phases.map(p => p.phase)).toEqual(['hover', 'ETL', 'climb', 'accelerate', 'cruise']);
      const climb = flight.samples.filter(p => p.time > 70 && p.time < 85);
      expect(climb.every(p => p.kias > 58 && p.kias < 63 && p.vs > 2)).toBe(true);
    }
    flight.stop();
    sim.step(.1);
    expect(sim.state.time).toBeGreaterThan(stoppedAt);
  }, 120000);
});
