import { describe, expect, it } from 'vitest';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { R44_DEFINITION } from '../../src/aircraft/r44';
import { S269_DEFINITION } from '../../src/aircraft/s269';
import { clamp } from '../../src/core/math';
import { cloneControls } from '../../src/core/types';
import { mouseAxisFromPickup, mouseYokeDeflection } from '../../src/input/mixer';
import { ScriptedPilot, observePilot } from '../../src/sim/rotorcraft/scriptedPilot';
import { createFlightModelFor } from '../../src/physics';
import { flatEnvironment } from '../fdm/helpers';
import { makeInputRig } from '../input/testbed';

const env = flatEnvironment(undefined, 0);
const aircraftTypes = [R22_DEFINITION, R44_DEFINITION, S269_DEFINITION];
// Optional metrics, with the same node-types-free trace convention as the other rotorcraft tests.
const trace = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.MOUSE_TRACE;
interface TraceFs { mkdirSync(path: string, options: { recursive: boolean }): void; writeFileSync(path: string, data: string): void }
const fs = trace ? await import(/* @vite-ignore */ 'node:fs' as string) as TraceFs : undefined;

describe('mouse cyclic through input and rotor physics', () => {
  for (const aircraft of aircraftTypes) {
    for (const direction of ['right', 'forward'] as const) it(`${aircraft.id}: pointer ${direction} tilts the helicopter ${direction}`, () => {
      const fm = createFlightModelFor(aircraft);
      fm.reset({ position: { x: 0, y: 0, z: -50 }, heading: 0, airspeed: 0,
        onGround: false, engineRunning: true }, env);
      const r = makeInputRig(aircraft.input, fm.trimControls);
      r.ctx.state = fm.state;
      r.ctx.events.emit('reset', { scenario: 'runway' });
      const pointer = r.input as unknown as { mouseNx: number; mouseNy: number; mouseMoves: number };
      r.input.setMouseYoke(true);
      pointer.mouseMoves++; r.input.update(0, r.ctx);
      const trim = { ...r.c };
      pointer.mouseNx = direction === 'right' ? 0.35 : 0;
      pointer.mouseNy = direction === 'forward' ? -0.35 : 0;
      pointer.mouseMoves++;
      r.input.update(1 / 60, r.ctx);
      if (direction === 'right') expect(r.c.aileron).toBeGreaterThan(trim.aileron);
      else expect(r.c.elevator).toBeLessThan(trim.elevator);
      for (let i = 0; i < 72; i++) fm.step(1 / 240, r.c, env);
      if (direction === 'right') expect(fm.state.angularVelocity.x).toBeGreaterThan(0.01);
      else expect(fm.state.angularVelocity.y).toBeLessThan(-0.01);
      expect(fm.state.crashed).toBe(false);
    });
  }

  for (const aircraft of aircraftTypes) it(`${aircraft.id}: 20-second scripted mouse hover`, () => {
    const fm = createFlightModelFor(aircraft), frameDt = 1 / 60, frames = 20 * 60;
    fm.reset({ position: { x: 0, y: 0, z: -50 }, heading: 0, airspeed: 0,
      onGround: false, engineRunning: true, fuelFraction: 0.5 }, env);
    const r = makeInputRig(aircraft.input, fm.trimControls);
    r.ctx.state = fm.state; r.ctx.events.emit('reset', { scenario: 'runway' });
    const pointer = r.input as unknown as { mouseNx: number; mouseNy: number; mouseMoves: number };
    r.input.setMouseYoke(true); pointer.mouseMoves++; r.input.update(0, r.ctx);
    const base = cloneControls(r.c), desired = cloneControls(r.c);
    const pilot = new ScriptedPilot(observePilot(fm.state, aircraft.rotorcraft!), desired);
    // Test pilot asks for ordinary controls. Only cyclic is translated into pointer positions;
    // pedals, collective and manual throttle remain the pilot's other hand/feet.
    const pointerFor = (target: number, pickup: number, span: number) => {
      let lo = -0.8, hi = 0.8;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const raw = mouseYokeDeflection(mid, 0, aircraft.input.mouseYoke).aileron;
        if (mouseAxisFromPickup(raw, 0, pickup) < target) lo = mid; else hi = mid;
      }
      return Math.round((lo + hi) / 2 * span / 2) * 2 / span; // whole pixels, 1600×900 view
    };
    let pitchSum = 0, rollSum = 0, pitchPeak = 0, rollPeak = 0, maxDrift = 0, peakSpeed = 0;
    let oldRpm = fm.state.engine.rpm, rpmTrend = 0;
    const samples = [];
    for (let frame = 0; frame < frames; frame++) {
      const s = fm.state;
      Object.assign(desired, r.c);
      pilot.step(frameDt, observePilot(s, aircraft.rotorcraft!), desired, 0, clamp(0.5 * (50 - s.altitudeAGL), -1, 1));
      pointer.mouseNx = pointerFor(desired.aileron, base.aileron, 1600);
      pointer.mouseNy = pointerFor(desired.elevator, base.elevator, 900);
      pointer.mouseMoves++;
      r.c.rudder = desired.rudder; r.c.collective = desired.collective;
      if (aircraft.input.rotorGovernor === false) {
        // Same estimated hand-rate/RPM-trend policy as s269Flights; never a production governor.
        rpmTrend += ((s.engine.rpm - oldRpm) / frameDt - rpmTrend) * (1 - Math.exp(-frameDt / 0.3));
        oldRpm = s.engine.rpm;
        r.c.throttle = clamp(r.c.throttle + clamp(0.0003 * (2650 - oldRpm) - 0.0004 * rpmTrend, -0.1, 0.1) * frameDt, 0, 1);
      }
      r.input.update(frameDt, r.ctx);
      // At most one pixel of cyclic error; catches bypassed input or a broken pickup/curve.
      expect(Math.abs(r.c.elevator - desired.elevator)).toBeLessThan(0.005);
      expect(Math.abs(r.c.aileron - desired.aileron)).toBeLessThan(0.005);
      pitchSum += Math.abs(r.c.elevator); rollSum += Math.abs(r.c.aileron);
      pitchPeak = Math.max(pitchPeak, Math.abs(r.c.elevator)); rollPeak = Math.max(rollPeak, Math.abs(r.c.aileron));
      for (let step = 0; step < 4; step++) fm.step(1 / 240, r.c, env);
      maxDrift = Math.max(maxDrift, Math.hypot(s.position.x, s.position.y));
      peakSpeed = Math.max(peakSpeed, s.groundSpeed);
      if (frame % 60 === 59) samples.push({ time: (frame + 1) / 60, pitch: r.c.elevator, roll: r.c.aileron,
        north: s.position.x, east: s.position.y, altitude: s.altitudeAGL, groundSpeed: s.groundSpeed });
    }
    const s = fm.state;
    const result = { seconds: 20, viewport: [1600, 900], inputHz: 60, physicsHz: 240,
      meanAbsCyclic: { pitch: pitchSum / frames, roll: rollSum / frames }, peakAbsCyclic: { pitch: pitchPeak, roll: rollPeak },
      drift: { north: s.position.x, east: s.position.y, final: Math.hypot(s.position.x, s.position.y), max: maxDrift,
        altitudeChange: s.altitudeAGL - 50, peakSpeed, finalSpeed: s.groundSpeed }, samples };
    fs?.mkdirSync('work', { recursive: true }); fs?.writeFileSync(`work/${aircraft.id}-mouse-hover.json`, JSON.stringify(result, null, 2));
    expect(s.crashed).toBe(false); expect(s.onGround).toBe(false);
    expect(maxDrift).toBeLessThan(3); expect(Math.abs(s.altitudeAGL - 50)).toBeLessThan(0.5);
    expect(peakSpeed).toBeLessThan(0.5);
    expect(pitchPeak).toBeLessThan(0.5); expect(rollPeak).toBeLessThan(0.5);
  }, 30000);
});
