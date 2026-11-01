// InputSystem.setProfile, the input side of the aircraft hot swap (src/sim/Simulator.ts swapAircraft): the same
// instance takes another type's profile in flight. The pilot's assists object keeps its identity and its own choices,
// STAB ASSIST comes and goes with the profile, keys held across the switch are let go, the keys of levers the new
// type lacks do nothing (a single's engine selection), and the keyboard controls start again from the trimmed controls.

import { describe, expect, it } from 'vitest';
import { InputSystem } from '../../src/input/InputSystem';
import { C172S_INPUT } from '../../src/aircraft/c172s/input';
import { PA34_INPUT } from '../../src/aircraft/pa34/input';
import { BO105_INPUT } from '../../src/aircraft/bo105/input';
import { FRAME, makeRig } from './keyboardPilot';

describe('InputSystem.setProfile (aircraft hot swap)', () => {
  const flying = () => {
    const r = makeRig({ turbulence: 0 });
    r.physics.reset('downwind', r.weather);
    r.ctx.events.emit('reset', { scenario: 'downwind' });
    return r;
  };

  it('keeps the assists object and the pilot choices; STAB ASSIST follows the profile', () => {
    const r = flying();
    const input = new InputSystem({ profile: C172S_INPUT });
    input.attach(r.ctx);
    const assists = input.assists;
    assists.rollTrim = false;
    expect('stabilityAssist' in assists).toBe(false);
    input.setProfile(BO105_INPUT);
    expect(input.assists).toBe(assists);
    expect(assists.rollTrim).toBe(false);
    expect(assists.groundSteering).toBe(true);
    expect(assists.stabilityAssist).toBe(BO105_INPUT.stabilityAssist!.default);
    input.setProfile(C172S_INPUT);
    expect('stabilityAssist' in assists).toBe(false);
    expect(assists.rollTrim).toBe(false);
  });

  it('lets go of the keys held across the switch and starts from the trimmed controls', () => {
    const r = flying();
    const input = new InputSystem({ profile: C172S_INPUT });
    input.attach(r.ctx);
    input.keyDown('ArrowLeft');
    for (let i = 0; i < 30; i++) input.update(FRAME, r.ctx);
    const rolled = r.ctx.controls.aileron;
    expect(rolled).toBeLessThan(-0.05);
    // The new type is trimmed (here: the same type re-trimmed by a reset of the physics, as setAircraft does).
    r.physics.reset('downwind', r.weather);
    const trimmed = r.ctx.controls.aileron;
    input.setProfile(PA34_INPUT);
    for (let i = 0; i < 30; i++) input.update(FRAME, r.ctx);
    // The held arrow went with the switch: the aileron stays at the trim instead of running on to full deflection.
    expect(Math.abs(r.ctx.controls.aileron - trimmed)).toBeLessThan(0.02);
    expect(input.pilotFlying(0)).toBe(false);
  });

  it('the engine selection keys work only on a twin, and the selection goes back to both engines', () => {
    const r = flying();
    const input = new InputSystem({ profile: C172S_INPUT });
    input.attach(r.ctx);
    input.keyDown('Digit8');
    input.update(FRAME, r.ctx);
    input.keyUp('Digit8');
    expect(input.engineSelection).toBe('all');
    input.setProfile(PA34_INPUT);
    input.keyDown('Digit8');
    input.update(FRAME, r.ctx);
    input.keyUp('Digit8');
    expect(input.engineSelection).toBe(0);
    input.setProfile(C172S_INPUT);
    expect(input.engineSelection).toBe('all');
  });
});
