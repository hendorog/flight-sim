import { describe, expect, it } from 'vitest';
import { SKID_Z } from '../../src/aircraft/r22/dimensions';
import { R22_INPUT } from '../../src/aircraft/r22/input';
import { cloneControls } from '../../src/core/types';
import { clamp } from '../../src/core/math';
import { makeInputRig } from '../input/testbed';
import { DT, rig, seaLevel } from './helpers';
import { ScriptedPilot, observePilot } from '../../src/sim/rotorcraft/scriptedPilot';
import { FlightRecorder, writeTrace } from './scriptedPilot';

describe('R22 keyboard hover through the real input path', () => {
  for (const gross of [true, false]) it(`${gross ? 'gross' : 'solo'}: 100 ms decisions/presses, no flight assists`, () => {
    const r = rig(0, gross);
    r.fm.reset({ position: { x: 0, y: 0, z: 0 }, heading: 0, airspeed: 0,
      onGround: true, engineRunning: true, fuelFraction: gross ? 1 : 0.5 }, seaLevel);
    const keyboard = makeInputRig(R22_INPUT, r.fm.trimControls);
    keyboard.ctx.state = r.fm.state; r.c = keyboard.c;
    const desired = cloneControls(r.c), pilot = new ScriptedPilot(observePilot(r.fm.state), desired);
    // A patient lift and slower attitude loop suit discrete keys. These are test-pilot choices,
    // not changes to input authority or feedback hidden in the production input/flight model.
    pilot.liftI = 0; pilot.pitchGain = 0.5; pilot.pitchDamping = 0.7; pilot.pitchLearning = 0.05;
    pilot.rollGain = 0.5; pilot.rollDamping = 0.5; pilot.rollLearning = 0.05;
    pilot.speedGain = 0.025; pilot.speedLearning = 0.002; pilot.driftGain = 0.04; pilot.driftLearning = 0.003;
    const log = new FlightRecorder(r), held = new Set<string>();
    let presses = 0;
    const move = (negative: string, positive: string, gap: number, deadband: number): void => {
      const key = gap > deadband ? positive : gap < -deadband ? negative : '';
      for (const k of [negative, positive]) {
        if (k === key) {
          if (!held.has(k)) { keyboard.input.keyDown(k); held.add(k); presses++; }
        } else { keyboard.input.keyUp(k); held.delete(k); }
      }
    };
    for (let frame = 0; frame < 150 * 60; frame++) {
      const t = frame / 60;
      if (frame === 600) { pilot.pitchI = r.c.elevator; pilot.rollI = r.c.aileron; pilot.yawI = r.c.rudder; }
      if (frame % 6 === 0) {
        Object.assign(desired, r.c);
        if (t < 10) {
          // Approximate positions learned by the scripted pilot, entered with keys on the ground.
          // They are deliberately rounded, not taken from the numerical hover trim solver.
          desired.elevator = gross ? 0.1 : -0.05; desired.aileron = gross ? -0.1 : -0.22;
          desired.rudder = -0.25; desired.collective = 0;
        } else pilot.step(0.1, observePilot(r.fm.state), desired, 0, clamp(0.5 * (3 - (r.fm.state.altitudeAGL - SKID_Z)), -0.5, 0.5), undefined, undefined, 0.3);
        move('ArrowUp', 'ArrowDown', desired.elevator - r.c.elevator, 0.015);
        move('ArrowLeft', 'ArrowRight', desired.aileron - r.c.aileron, 0.015);
        move('KeyZ', 'KeyX', desired.rudder - r.c.rudder, 0.025);
        move('F5', 'F6', desired.collective! - r.c.collective!, 0.015);
      }
      keyboard.input.update(1 / 60, keyboard.ctx);
      for (let step = 0; step < 4; step++) r.fm.step(DT, r.c, seaLevel);
      log.observe(t, 'keyboard');
      if (r.fm.state.crashed) break;
    }
    log.save(`keyboard-${gross ? 'gross' : 'solo'}`);
    writeTrace(`keyboard-workload-${gross ? 'gross' : 'solo'}`, { presses, seconds: 150 });
    expect(log.crashed).toBe(false);
    const hover = log.samples.filter(p => p.time > 120);
    expect(hover.length).toBeGreaterThan(100);
    expect(hover.every(p => !p.onGround && p.height > 2.5 && p.height < 3.5 && p.groundKts < 2)).toBe(true);
    expect(presses / 2.5).toBeLessThan(160); // Combined pitch/roll/pedal/collective presses per minute.
    for (const key of held) keyboard.input.keyUp(key);
    const before = [r.c.elevator, r.c.aileron, r.c.rudder, r.c.collective];
    keyboard.input.update(1, keyboard.ctx);
    expect([r.c.elevator, r.c.aileron, r.c.rudder, r.c.collective]).toEqual(before);
  }, 120000);
});
