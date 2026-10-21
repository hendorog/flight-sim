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
    hold(r, 'F5', 2, true);
    expect(r.c.collective).toBe(0);
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
