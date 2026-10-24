// The Bo 105 flyability pass's keyboard aids (W/bofly/fix-plan.md F1-F3), on the real InputSystem: the STAB ASSIST toggle
// (Shift+A), the hand-rate collective pair (Shift+F5 / Shift+F6), the slower 5-key centring and Shift+5 "keyboard trim
// here". Each is checked to leave every other type as it was: Shift+F5 / F6 stay the fine collective pair, 5 centres at
// 4 travel per second, Shift+5 centres, Shift+A does nothing.
import { describe, expect, it } from 'vitest';
import { BO105_INPUT } from '../../src/aircraft/bo105/input';
import { MD500_INPUT } from '../../src/aircraft/md500/input';
import { R22_INPUT } from '../../src/aircraft/r22/input';
import { C172S_INPUT } from '../../src/aircraft/c172s/input';
import { actionForKey, keyBindingsFor } from '../../src/input/bindings';
import { CENTRE_RATE } from '../../src/input/virtualYoke';
import { FRAME, makeInputRig, type InputRig } from './testbed';

function hold(r: InputRig, code: string, s: number, shift = false): void {
  r.input.keyDown(code, shift);
  r.run(s);
  r.input.keyUp(code);
}

describe('hand-rate collective (InputProfile.collectiveFastRate: Bo 105 Shift+F5 1.0 / Shift+F6 0.5 of the travel per second)', () => {
  it('Shift+F5 lowers at 1.0 per second, Shift+F6 raises at 0.5; bare F5 / F6 stay the fine 0.12 per second', () => {
    const r = makeInputRig(BO105_INPUT, { collective: 0.6 });
    hold(r, 'F5', 0.25, true);
    expect(r.c.collective).toBeCloseTo(0.6 - 0.25, 2);
    hold(r, 'F6', 0.5, true);
    expect(r.c.collective).toBeCloseTo(0.35 + 0.25, 2);
    hold(r, 'F5', 1);
    expect(r.c.collective).toBeCloseTo(0.6 - BO105_INPUT.collectiveRate!, 2);
    expect(BO105_INPUT.collectiveRate).toBe(0.12);
  });
  /**
   * Round 2 (the pilot gate's follow-up; W/bofly/r2 auto.log, autoSteady.log): held to the floor after a double engine
   * failure, Shift+F5 overspun the rotor to 118 % (100 KIAS) / 126 % (120 KIAS), past the power-off limit of 110 % (P5
   * FM 2-8). Its entry stop, 0.08 of the travel, gives about 97 % NR in a steady 75 KIAS autorotation at 2200 kg and 102 %
   * at 2500 kg; bare F5 takes the collective on down.
   */
  it('Shift+F5 stops at the autorotation entry position (0.08 of the travel), held or pressed again; bare F5 goes on to the floor', () => {
    expect(BO105_INPUT.collectiveFastRate?.downStop).toBe(0.08);
    const r = makeInputRig(BO105_INPUT, { collective: 0.45 });
    hold(r, 'F5', 2, true);
    expect(r.c.collective).toBeCloseTo(0.08, 6);
    hold(r, 'F5', 0.5, true);
    expect(r.c.collective).toBeCloseTo(0.08, 6);
    hold(r, 'F5', 0.5);
    expect(r.c.collective).toBeCloseTo(0.08 - 0.5 * BO105_INPUT.collectiveRate!, 2);
    const below = r.c.collective!;
    hold(r, 'F5', 0.5, true);
    expect(r.c.collective).toBe(below);
    hold(r, 'F6', 0.2, true);
    expect(r.c.collective).toBeCloseTo(below + 0.1, 2);
  });
  it('the fast keys count as flying (they take the hover hold back, as F5 / F6 do)', () => {
    const r = makeInputRig(BO105_INPUT, { collective: 0.5 });
    r.input.keyDown('F5', true);
    r.run(FRAME);
    expect(r.input.pilotFlying(1e6)).toBe(true);
    r.input.keyUp('F5');
  });
  it('on the MD 500E and the R22 Shift+F5 / Shift+F6 stay the fine pair (no fast keys, no help row)', () => {
    for (const p of [MD500_INPUT, R22_INPUT]) {
      expect(actionForKey('F5', true, p)).toBe('flapsUp');
      expect(actionForKey('F6', true, p)).toBe('flapsDown');
      const r = makeInputRig(p, { collective: 0.6 });
      hold(r, 'F5', 1, true);
      expect(r.c.collective).toBeCloseTo(0.6 - (p.collectiveRate ?? 0.15), 3);
      expect(keyBindingsFor(p).some((b) => b.keys.split(' / ').includes('Shift+F5'))).toBe(false);
    }
    expect(actionForKey('F5', true, C172S_INPUT)).toBe('flapsUp');
  });
});

describe('5-key centring rate (InputProfile.centreRate) and Shift+5 keyboard trim here (InputProfile.setTrimHere)', () => {
  it('the Bo 105 recentres at 1 travel per second (0.44 of the travel aft takes about 0.9 s); the MD 500E at 4', () => {
    for (const [p, rate] of [[BO105_INPUT, 1], [MD500_INPUT, CENTRE_RATE]] as const) {
      const r = makeInputRig(p);
      r.setAirborne(true);
      // At cruise (the untrimmed 120 KIAS pilot this rate is for): the Bo 105's keyboard cyclic limit is a hover and
      // low-speed aid (StabilityAssistTuning.keyboardLimit, open above 30 kt of ground speed).
      r.s.groundSpeed = 120 * 0.514444;
      const e0 = r.c.elevator;
      hold(r, 'ArrowUp', 3);
      const pushed = e0 - r.c.elevator;
      expect(pushed).toBeGreaterThan(0.3);
      r.tap('Digit5');
      r.run(0.1 - FRAME);
      // 0.1 s after the press (two frames of the tap included): moved back by about rate x 0.1.
      expect((e0 - r.c.elevator) / pushed).toBeCloseTo(Math.max(0, pushed - rate * (0.1 + FRAME)) / pushed, 1);
      r.run(1.5);
      expect(r.c.elevator).toBeCloseTo(e0, 6);
    }
  });
  it('Shift+5 makes the stick as it is the keyboard centre: nothing moves, and 5 then returns there (Bo 105 only)', () => {
    const r = makeInputRig(BO105_INPUT);
    r.setAirborne(true);
    hold(r, 'ArrowUp', 1);
    hold(r, 'ArrowRight', 0.5);
    const here = { e: r.c.elevator, a: r.c.aileron };
    r.tap('Digit5', true);
    expect([r.c.elevator, r.c.aileron]).toEqual([here.e, here.a]);
    expect(r.toasts.at(-1)).toMatch(/Keyboard trim set here/);
    hold(r, 'ArrowDown', 0.5);
    expect(r.c.elevator).toBeGreaterThan(here.e);
    r.tap('Digit5');
    r.run(2);
    expect(r.c.elevator).toBeCloseTo(here.e, 6);
    expect(r.c.aileron).toBeCloseTo(here.a, 6);
  });
  it('on the MD 500E Shift+5 centres, as 5 does', () => {
    expect(actionForKey('Digit5', true, MD500_INPUT)).toBe('centreControls');
    const r = makeInputRig(MD500_INPUT);
    r.setAirborne(true);
    const e0 = r.c.elevator;
    hold(r, 'ArrowUp', 1);
    r.tap('Digit5', true);
    r.run(1);
    expect(r.c.elevator).toBeCloseTo(e0, 6);
  });
});

describe('the pedals worked (ControlInputs.pedalWorked: the STAB ASSIST heading hold waits for it to clear)', () => {
  it('on the Bo 105 it is set while a pedal key is held and cleared when the keys rest', () => {
    const r = makeInputRig(BO105_INPUT);
    r.setAirborne(true);
    r.run(FRAME);
    expect(r.c.pedalWorked).toBe(false);
    r.input.keyDown('KeyX');
    r.run(0.2);
    expect(r.c.pedalWorked).toBe(true);
    r.input.keyUp('KeyX');
    r.run(FRAME);
    expect(r.c.pedalWorked).toBe(false);
  });
  it('types without a STAB ASSIST never set it (MD 500E, R22)', () => {
    for (const p of [MD500_INPUT, R22_INPUT]) {
      const r = makeInputRig(p);
      r.setAirborne(true);
      r.input.keyDown('KeyX');
      r.run(0.2);
      expect(r.c.pedalWorked).toBeUndefined();
      r.input.keyUp('KeyX');
    }
  });
});

/**
 * Round 3 (W/bofly/pilot-r3): the STAB ASSIST's trim follow-up moves only what the keyboard holds
 * (ControlInputs.keyboardCyclic / keyboardPedals), and hands its pedal movement to the input module
 * (ControlInputs.pedalFollowUp), which moves its pedal centre with the pedals (round 2's "5 once after lift-off" trap
 * threw the whole lift-off pedal away). The tune pass (W/tune/bo105, item 3): on the Bo 105 5 leaves the pedals where they
 * are (InputProfile.centreKeepsPedals), so a pedal set with the keys is kept too (round 3: KeyZ 2 s at lift-off then 5,
 * 62 deg/s of yaw); the MD 500E's 5 still centres them.
 */
describe('the keyboard controls the trim follow-up may move (keyboardCyclic, keyboardPedals, pedalFollowUp)', () => {
  it('on the Bo 105 the keyboard flags are set; other types never set them', () => {
    const r = makeInputRig(BO105_INPUT);
    r.run(FRAME);
    expect(r.c.keyboardCyclic).toBe(true); expect(r.c.keyboardPedals).toBe(true);
    for (const p of [MD500_INPUT, R22_INPUT]) {
      const o = makeInputRig(p);
      o.run(FRAME);
      expect(o.c.keyboardCyclic).toBeUndefined(); expect(o.c.keyboardPedals).toBeUndefined();
    }
  });
  it('a follow-up of the pedals moves the keyboard pedal centre with them; a pedal key still moves from it; 5 leaves the pedals where they are and centres the cyclic', () => {
    const r = makeInputRig(BO105_INPUT);
    r.setAirborne(true);
    r.run(FRAME);
    const p0 = r.c.rudder, e0 = r.c.elevator;
    // As the assist leaves it after a physics step: the pedal moved, and the movement handed over.
    r.c.rudder = p0 - 0.1; r.c.pedalFollowUp = -0.1;
    r.run(FRAME);
    expect(r.c.rudder).toBeCloseTo(p0 - 0.1, 9);
    expect(r.c.pedalFollowUp).toBe(0);
    hold(r, 'KeyX', 0.5);
    const keyed = r.c.rudder;
    expect(keyed).toBeGreaterThan(p0 - 0.1);
    hold(r, 'ArrowUp', 1);
    expect(r.c.elevator).toBeLessThan(e0 - 0.05);
    r.tap('Digit5');
    r.run(2);
    expect(r.c.rudder).toBe(keyed);
    expect(r.c.elevator).toBeCloseTo(e0, 6);
    expect(r.input.getYokeIndicator().keyboardOffCentre).toBe(false);
  });
  it('the MD 500E\'s 5 still centres the pedals (centreKeepsPedals is the Bo 105\'s alone)', () => {
    expect(MD500_INPUT.centreKeepsPedals).toBeUndefined();
    const r = makeInputRig(MD500_INPUT);
    r.setAirborne(true);
    r.run(FRAME);
    const p0 = r.c.rudder;
    hold(r, 'KeyX', 0.5);
    expect(r.c.rudder).toBeGreaterThan(p0 + 0.02);
    r.tap('Digit5');
    r.run(1);
    expect(r.c.rudder).toBeCloseTo(p0, 6);
  });
});

/**
 * The tune pass (W/tune/bo105, item 1): the STAB ASSIST's height hold walks only a keyboard collective
 * (ControlInputs.keyboardCollective) and waits while a collective key is held (collectiveWorked); the input module sets
 * both on a type with a STAB ASSIST. Tune round 2: collectiveFastWorked marks the hand-rate keys (Shift+F5 / Shift+F6),
 * which the hold leaves raw while a bare F5 / F6 held airborne is its climb-rate command.
 */
describe('the keyboard collective the height hold may walk (keyboardCollective, collectiveWorked, collectiveFastWorked)', () => {
  it('on the Bo 105: keyboardCollective set; collectiveWorked while F5 / F6 or Shift+F5 / Shift+F6 is held, collectiveFastWorked for the Shift pair only, cleared when they rest', () => {
    const r = makeInputRig(BO105_INPUT, { collective: 0.4 });
    r.setAirborne(true);
    r.run(FRAME);
    expect(r.c.keyboardCollective).toBe(true); expect(r.c.collectiveWorked).toBe(false);
    for (const [code, shift] of [['F6', false], ['F5', false], ['F6', true], ['F5', true]] as const) {
      r.input.keyDown(code, shift);
      r.run(0.1);
      expect(r.c.collectiveWorked, `${shift ? 'Shift+' : ''}${code}`).toBe(true);
      expect(r.c.collectiveFastWorked, `${shift ? 'Shift+' : ''}${code}`).toBe(shift);
      r.input.keyUp(code);
      r.run(FRAME);
      expect(r.c.collectiveWorked).toBe(false); expect(r.c.collectiveFastWorked).toBe(false);
    }
  });
  it('a hardware collective lever in use: keyboardCollective false (the pilot\'s hand is never walked)', () => {
    const r = makeInputRig(BO105_INPUT, { collective: 0.4 });
    const g = r.input.gamepads;
    g.poll = () => {};
    g.readings.push({ control: 'collective', value: 0.4, moved: true, takeover: false } as never);
    r.run(FRAME * 2);
    expect(r.c.collective).toBeCloseTo(0.4, 6);
    expect(r.c.keyboardCollective).toBe(false);
  });
  it('types without a STAB ASSIST never set them (MD 500E, R22)', () => {
    for (const p of [MD500_INPUT, R22_INPUT]) {
      const r = makeInputRig(p, { collective: 0.4 });
      r.input.keyDown('F6');
      r.run(0.2);
      expect(r.c.keyboardCollective).toBeUndefined(); expect(r.c.collectiveWorked).toBeUndefined(); expect(r.c.collectiveFastWorked).toBeUndefined();
      r.input.keyUp('F6');
    }
  });
});

describe('STAB ASSIST toggle (InputProfile.stabilityAssist; the physics side is tests/rotorcraft/bo105Assist.test.ts)', () => {
  it('on by default on the Bo 105; Shift+A switches it off and on, with a toast that calls it a sim aid; the yoke indicator carries it', () => {
    const r = makeInputRig(BO105_INPUT);
    expect(BO105_INPUT.stabilityAssist?.default).toBe(true);
    expect(r.input.assists.stabilityAssist).toBe(true);
    r.tap('KeyA', true);
    expect(r.input.assists.stabilityAssist).toBe(false);
    expect(r.toasts.at(-1)).toMatch(/STAB ASSIST off/);
    expect(r.input.getYokeIndicator().stabilityAssist).toBe(false);
    r.tap('KeyA', true);
    expect(r.input.assists.stabilityAssist).toBe(true);
    expect(r.toasts.at(-1)).toMatch(/STAB ASSIST on.*sim aid/);
    expect(r.input.getYokeIndicator().stabilityAssist).toBe(true);
  });
  it('absent on the other helicopters: no assist field, Shift+A does nothing, no help row', () => {
    for (const p of [MD500_INPUT, R22_INPUT]) {
      const r = makeInputRig(p);
      r.tap('KeyA', true);
      expect(r.input.assists.stabilityAssist).toBeUndefined();
      expect(r.input.getYokeIndicator().stabilityAssist).toBeUndefined();
      expect(r.toasts).toEqual([]);
      expect(keyBindingsFor(p).some((b) => b.keys.split(' / ').includes('Shift+A'))).toBe(false);
    }
  });
  it('the Bo 105 help lists Shift+A, Shift+F5, Shift+F6 and Shift+5 with their labels', () => {
    const rows = keyBindingsFor(BO105_INPUT);
    const row = (k: string) => rows.find((b) => b.keys.split(' / ').includes(k));
    expect(row('Shift+A')?.action).toMatch(/STAB ASSIST.*sim aid/);
    expect(row('Shift+F5')?.action).toMatch(/hand speed/);
    expect(row('Shift+F6')?.action).toMatch(/hand speed/);
    expect(row('Shift+5')?.action).toMatch(/Keyboard trim here/);
  });
});
