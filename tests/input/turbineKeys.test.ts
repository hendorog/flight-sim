// The turbine keys (plan 3.1): the power lever aft of the idle gate on a type with beta and reverse (Shift+F2 /
// Shift+Page Down, the lift-over gate, F3 back to the gate, F1 and F4), a throttle quadrant's reverse zone and a held
// Reverse button; the twist grip of a turboshaft (F1 to the idle stop, Shift+F1 CUTOFF, out of CUTOFF by F1 / F3 / F4);
// the governor beep switch on the propeller keys; the stick pusher's interrupt (Shift+D) and STARTER INTERRUPT (Shift+N);
// the condition lever's detents on the mixture keys (M / Shift+M a detent a press, CUT-OFF only by a fresh press held
// at the low idle). None of them does anything on a type without the lever or switch.

import { describe, expect, it } from 'vitest';
import { C172S_INPUT } from '../../src/aircraft/c172s/input';
import { C208_INPUT } from '../../src/aircraft/c208/input';
import { C208_BETA } from '../../src/aircraft/c208/powerplant';
import { PC12_INPUT } from '../../src/aircraft/pc12/input';
import { PC12_GROUND_IDLE } from '../../src/aircraft/pc12/sim';
import { CUTOFF_BELOW } from '../../src/physics/propulsion/turbineEngine';
import { cloneControls } from '../../src/core/types';
import { actionForKey, keyBindingsFor, profileHasAction } from '../../src/input/bindings';
import type { AxisReading } from '../../src/input/gamepads';
import { CONDITION_CUTOFF_HOLD, REVERSE_RATE } from '../../src/input/InputSystem';
import type { InputProfile } from '../../src/input/profile';
import { FRAME, makeInputRig, type InputRig } from './testbed';

/** A turboshaft helicopter's profile (the MD 500E's shape): twist grip, beep switch, no propeller lever. */
const GRIP: InputProfile['twistGrip'] = { cutoffBelow: 0.05, groundIdle: 0.2 };
const TURBOSHAFT_INPUT: InputProfile = {
  ...C172S_INPUT,
  rotorcraft: true,
  twistGrip: GRIP,
  n2Beep: true,
  has: { ...C172S_INPUT.has, mixture: false, propeller: false },
};
/** A turboprop with a stick pusher and a latching start switch (the PC-12's shape). */
const PUSHER_INPUT: InputProfile = { ...C208_INPUT, pusherInterrupt: true, starterInterrupt: true };

const rev = (r: InputRig): number => r.c.reverse ?? 0;
/** Hold a key (with Shift or not) for `s` seconds, then let it go. */
function hold(r: InputRig, code: string, s: number, shift = false): void {
  r.input.keyDown(code, shift);
  r.run(s);
  r.input.keyUp(code);
  r.run(FRAME);
}

describe('the power lever aft of the idle gate (types with beta and reverse)', () => {
  it('binds Shift+F2 / Shift+Page Down to it, and leaves the bare keys the throttle', () => {
    expect(actionForKey('F2', true)).toBe('powerLeverReverse');
    expect(actionForKey('PageDown', true)).toBe('powerLeverReverse');
    expect(actionForKey('F2', false)).toBe('throttleDown');
    expect(actionForKey('F1', false)).toBe('throttleIdle');
    expect(actionForKey('F1', true)).toBe('gripCutoff');
    expect(profileHasAction(C208_INPUT, 'powerLeverReverse')).toBe(true);
    expect(profileHasAction(C172S_INPUT, 'powerLeverReverse')).toBe(false);
    expect(keyBindingsFor(C208_INPUT).find((b) => b.keys === 'Shift+F2 / Shift+Page Down')).toBeDefined();
  });

  it('held from forward of the gate, the lever comes back to the gate and stops there', () => {
    const r = makeInputRig(C208_INPUT, { throttle: 0.3 });
    hold(r, 'F2', 2, true);
    expect(r.c.throttle).toBe(0);
    expect(rev(r)).toBe(0);
  });

  it('a fresh press on the gate lifts it: the lever goes aft at the steady rate, to ground fine and on to reverse', () => {
    const r = makeInputRig(C208_INPUT, { throttle: 0 });
    // 0.78 s at 0.5 / s plus the press's tap: ground fine (0.4).
    hold(r, 'F2', 0.78, true);
    expect(rev(r)).toBeCloseTo(0.02 + REVERSE_RATE * 0.78, 1);
    expect(rev(r)).toBeGreaterThanOrEqual(C208_BETA.pitchOnlyTravel - 0.01);
    expect(r.c.throttle).toBe(0);
    hold(r, 'PageDown', 2, true);
    expect(rev(r)).toBe(1);
  });

  it('F3 from aft of the gate brings the lever forward to the gate and stops there; a fresh press goes on', () => {
    const r = makeInputRig(C208_INPUT, { throttle: 0 });
    hold(r, 'F2', 1, true);
    const aft = rev(r);
    hold(r, 'F3', 0.3);
    expect(rev(r)).toBeLessThan(aft - 0.1);
    expect(r.c.throttle).toBe(0);
    hold(r, 'F3', 2);
    expect(rev(r)).toBe(0);
    expect(r.c.throttle).toBe(0);
    hold(r, 'F3', 0.5);
    expect(r.c.throttle).toBeGreaterThan(0.05);
  });

  it('the bare F2 never takes the lever over the gate', () => {
    const r = makeInputRig(C208_INPUT, { throttle: 0.1 });
    hold(r, 'F2', 2);
    expect(r.c.throttle).toBe(0);
    expect(rev(r)).toBe(0);
  });

  it('F1 puts the lever on the gate at idle and F4 forward to full, from anywhere aft', () => {
    const r = makeInputRig(C208_INPUT, { throttle: 0 });
    hold(r, 'F2', 1, true);
    expect(rev(r)).toBeGreaterThan(0.3);
    r.tap('F1');
    expect([rev(r), r.c.throttle]).toEqual([0, 0]);
    hold(r, 'F2', 1, true);
    r.tap('F4');
    expect([rev(r), r.c.throttle]).toEqual([0, 1]);
  });

  it('a gamepad button held as Reverse works as the key', () => {
    const r = makeInputRig(C208_INPUT, { throttle: 0 });
    const g = r.input.gamepads;
    g.poll = () => {};
    g.held.add('powerLeverReverse');
    g.pressed.push('powerLeverReverse');
    r.run(FRAME);
    g.pressed.length = 0;
    r.run(1);
    expect(rev(r)).toBeGreaterThan(0.45);
  });

  it("a quadrant's reverse zone: below the detent the lever is aft of the gate, above it the throttle spans the rest", () => {
    const r = makeInputRig(C208_INPUT, { throttle: 0 });
    const g = r.input.gamepads;
    g.poll = () => {};
    const reading: AxisReading = { control: 'throttle', value: 0.15, moved: true, takeover: false, reverseZone: 0.15 };
    g.readings.push(reading);
    r.run(FRAME);
    expect([r.c.throttle, rev(r)]).toEqual([0, 0]);
    reading.value = 0;
    r.run(FRAME);
    expect(r.c.throttle).toBe(0);
    expect(rev(r)).toBeCloseTo(1, 6);
    reading.value = 0.075;
    r.run(FRAME);
    expect(rev(r)).toBeCloseTo(0.5, 6);
    reading.value = 0.575;
    r.run(FRAME);
    expect(r.c.throttle).toBeCloseTo(0.5, 6);
    expect(rev(r)).toBe(0);
  });

  it('a held Reverse button, let go, is cancelled by a throttle axis without a reverse zone moved forward', () => {
    const r = makeInputRig(C208_INPUT, { throttle: 0 });
    const g = r.input.gamepads;
    g.poll = () => {};
    const reading: AxisReading = { control: 'throttle', value: 0, moved: true, takeover: false };
    g.readings.push(reading);
    r.run(FRAME);
    reading.moved = false;
    g.held.add('powerLeverReverse');
    g.pressed.push('powerLeverReverse');
    r.run(FRAME);
    g.pressed.length = 0;
    r.run(1);
    g.held.delete('powerLeverReverse');
    r.run(FRAME);
    expect(rev(r)).toBeGreaterThan(0.4);
    expect(r.c.throttle).toBe(0);
    // Left at idle the axis does not take the lever out of reverse; moved forward it does.
    reading.moved = true;
    r.run(FRAME);
    expect(rev(r)).toBeGreaterThan(0.4);
    reading.value = 0.6;
    r.run(FRAME);
    expect(r.c.throttle).toBeCloseTo(0.6, 6);
    expect(rev(r)).toBe(0);
  });

  it("a gamepad's throttle rate stick pushed forward brings the lever out of reverse to the gate, then opens the throttle", () => {
    const r = makeInputRig(C208_INPUT, { throttle: 0, reverse: 0.5 });
    const g = r.input.gamepads;
    g.poll = () => {};
    const reading: AxisReading = { control: 'throttleRate', value: 1, moved: true, takeover: false };
    g.readings.push(reading);
    // Half the travel aft at REVERSE_RATE: the lever reaches the gate, and the throttle stays at 0 until it does.
    r.run(0.5 / REVERSE_RATE - 0.1);
    expect(rev(r)).toBeGreaterThan(0);
    expect(rev(r)).toBeLessThan(0.1);
    expect(r.c.throttle).toBe(0);
    r.run(2);
    expect(rev(r)).toBe(0);
    expect(r.c.throttle).toBeGreaterThan(0);
    // Pulled back, the stick stops at idle: it does not lift the gate.
    reading.value = -1;
    r.run(10);
    expect(r.c.throttle).toBe(0);
    expect(rev(r)).toBe(0);
  });

  it('taking over from the scripted pilot, a reverse-zone throttle picks up at the detent with the lever at idle, not deep in reverse', () => {
    for (const [start, at] of [[{ throttle: 0 }, 0.15], [{ throttle: 0.5 }, 0.575], [{ throttle: 0, reverse: 0.4 }, 0.09]] as const) {
      const r = makeInputRig(C208_INPUT, start);
      const g = r.input.gamepads;
      g.poll = () => {};
      const reading: AxisReading = { control: 'throttle', value: 1, moved: true, takeover: false, reverseZone: 0.15 };
      g.readings.push(reading);
      (r.input as unknown as { pickup: Set<string> }).pickup.add('throttle');
      // Well away from the lever: no pickup, the controls stay where the pilot left them.
      reading.value = at > 0.5 ? 0.1 : 0.9;
      r.run(FRAME);
      expect([r.c.throttle, rev(r)]).toEqual([start.throttle, 'reverse' in start ? start.reverse : 0]);
      // At the lever's place in the axis's travel: picked up, and the lever stays where it was.
      reading.value = at;
      r.run(FRAME);
      expect(r.c.throttle).toBeCloseTo(start.throttle, 6);
      expect(rev(r)).toBeCloseTo('reverse' in start ? start.reverse : 0, 6);
      expect((r.input as unknown as { pickup: Set<string> }).pickup.has('throttle')).toBe(false);
    }
  });

  it('the reverse zone does nothing on a type without reverse: the whole travel is throttle', () => {
    const r = makeInputRig(C172S_INPUT, { throttle: 0 });
    const g = r.input.gamepads;
    g.poll = () => {};
    g.readings.push({ control: 'throttle', value: 0.1, moved: true, takeover: false, reverseZone: 0.15 });
    r.run(FRAME);
    expect(r.c.throttle).toBeCloseTo(0.1, 6);
    expect(r.c.reverse).toBeUndefined();
  });
});

describe('the twist grip of a turboshaft', () => {
  it('F1 closes it to the idle stop, Shift+F1 through the release to CUTOFF, F3 / F1 / F4 out of CUTOFF', () => {
    const r = makeInputRig(TURBOSHAFT_INPUT, { throttle: 1 });
    r.tap('F1');
    expect(r.c.throttle).toBe(GRIP.groundIdle);
    hold(r, 'F2', 2);
    expect(r.c.throttle).toBe(GRIP.groundIdle);
    r.tap('F1', true);
    expect(r.c.throttle).toBe(0);
    hold(r, 'F2', 1);
    expect(r.c.throttle).toBe(0);
    r.tap('F3');
    expect(r.c.throttle).toBeGreaterThanOrEqual(GRIP.groundIdle);
    r.tap('F1', true);
    r.tap('F1');
    expect(r.c.throttle).toBe(GRIP.groundIdle);
    r.tap('F1', true);
    r.tap('F4');
    expect(r.c.throttle).toBe(1);
  });

  it('labels the grip keys as the grip, and has no CUTOFF key on a type without a grip', () => {
    const rows = keyBindingsFor(TURBOSHAFT_INPUT);
    expect(rows.find((b) => b.keys === 'Shift+F1')?.action).toMatch(/CUTOFF/);
    expect(rows.find((b) => b.keys.startsWith('F1'))?.action).toMatch(/GROUND IDLE/);
    expect(profileHasAction(C208_INPUT, 'gripCutoff')).toBe(false);
  });
});

describe('the governor beep switch', () => {
  it('; and Shift+; drive n2Beep -1 / +1 while held, 0 when let go', () => {
    const r = makeInputRig(TURBOSHAFT_INPUT);
    r.input.keyDown('Semicolon');
    r.run(0.2);
    expect(r.c.n2Beep).toBe(-1);
    r.input.keyUp('Semicolon');
    r.run(FRAME);
    expect(r.c.n2Beep).toBe(0);
    r.input.keyDown('Semicolon', true);
    r.run(0.2);
    expect(r.c.n2Beep).toBe(1);
    r.input.keyUp('Semicolon');
    r.run(FRAME);
    expect(r.c.n2Beep).toBe(0);
    expect(keyBindingsFor(TURBOSHAFT_INPUT).find((b) => b.keys === ';')?.action).toMatch(/beep DECR/);
  });
});

describe('the held interrupt switches', () => {
  it('Shift+D holds the pusher interrupt and Shift+N STARTER INTERRUPT on a type that has them', () => {
    const r = makeInputRig(PUSHER_INPUT);
    r.input.keyDown('KeyD', true);
    r.run(0.1);
    expect(r.c.pusherInterrupt).toBe(true);
    r.input.keyUp('KeyD');
    r.run(FRAME);
    expect(r.c.pusherInterrupt).toBe(false);
    r.input.keyDown('KeyN', true);
    r.run(0.1);
    expect((r.c as { starterInterrupt?: boolean }).starterInterrupt).toBe(true);
    r.input.keyUp('KeyN');
    r.run(FRAME);
    expect((r.c as { starterInterrupt?: boolean }).starterInterrupt).toBe(false);
    // The bare keys are what they were.
    expect(actionForKey('KeyD', false)).toBe('dgAlign');
    expect(actionForKey('KeyN', false)).toBe('navLights');
  });

  it('writes none of the new controls on the Caravan (no pusher, no latching start, no beep, no grip)', () => {
    const r = makeInputRig(C208_INPUT, { throttle: 0.2 });
    r.run(FRAME);
    const before = cloneControls(r.c);
    for (const [code, shift] of [['KeyD', true], ['KeyN', true], ['F1', true], ['Semicolon', false]] as const) hold(r, code, 0.2, shift);
    expect(r.c.pusherInterrupt).toBeUndefined();
    expect(r.c.n2Beep).toBeUndefined();
    expect('starterInterrupt' in r.c).toBe(false);
    // ; moved the propeller lever (the Caravan has one), nothing else.
    expect({ ...r.c, propeller: before.propeller }).toEqual(before);
  });
});

describe('the condition lever with detents (PC-12, C208: InputProfile.conditionDetents)', () => {
  it('has its low-idle detent where the engine starts to burn fuel (CUTOFF_BELOW, the PC-12 GROUND IDLE)', () => {
    expect(PC12_INPUT.conditionDetents?.groundIdle).toBe(CUTOFF_BELOW);
    expect(PC12_GROUND_IDLE).toBe(CUTOFF_BELOW);
    expect(C208_INPUT.conditionDetents?.groundIdle).toBe(CUTOFF_BELOW);
    expect(C172S_INPUT.conditionDetents).toBeUndefined();
  });

  it('M from FLIGHT IDLE goes to GROUND IDLE and stays there, tapped or held: the engine keeps running', () => {
    for (const profile of [PC12_INPUT, C208_INPUT]) {
      const r = makeInputRig(profile, { mixture: 1 });
      r.tap('KeyM');
      expect(r.c.mixture).toBe(CUTOFF_BELOW);
      r.tap('KeyM');
      expect(r.c.mixture).toBe(CUTOFF_BELOW);
      // A held key from FLIGHT IDLE stops on the detent, however long it is held.
      r.c.mixture = 1;
      hold(r, 'KeyM', 3);
      expect(r.c.mixture).toBe(CUTOFF_BELOW);
    }
  });

  it('a second press at GROUND IDLE, held for CONDITION_CUTOFF_HOLD, goes on to CUT-OFF; the pilot is told how', () => {
    const r = makeInputRig(PC12_INPUT, { mixture: PC12_GROUND_IDLE });
    hold(r, 'KeyM', CONDITION_CUTOFF_HOLD - 0.2);
    expect(r.c.mixture).toBe(PC12_GROUND_IDLE);
    expect(r.toasts.at(-1)).toMatch(/Hold M for 1 s .* CUT-OFF/);
    hold(r, 'KeyM', CONDITION_CUTOFF_HOLD + 0.05);
    expect(r.c.mixture).toBe(0);
  });

  it('Shift+M steps forward a detent a press: CUT-OFF to GROUND IDLE (the start), then FLIGHT IDLE', () => {
    const r = makeInputRig(PC12_INPUT, { mixture: 0 });
    hold(r, 'KeyM', 1, true);
    expect(r.c.mixture).toBe(PC12_GROUND_IDLE);
    r.tap('KeyM', true);
    expect(r.c.mixture).toBe(1);
    r.tap('KeyM', true);
    expect(r.c.mixture).toBe(1);
  });

  it('a lever left between the detents by a hardware axis steps to the next detent', () => {
    const r = makeInputRig(C208_INPUT, { mixture: 0.5 });
    r.tap('KeyM');
    expect(r.c.mixture).toBe(CUTOFF_BELOW);
    r.c.mixture = 0.5;
    r.tap('KeyM', true);
    expect(r.c.mixture).toBe(1);
    r.c.mixture = 0.05;
    r.tap('KeyM', true);
    expect(r.c.mixture).toBe(CUTOFF_BELOW);
  });

  it('a hardware mixture axis still sets the lever anywhere', () => {
    const r = makeInputRig(PC12_INPUT, { mixture: 1 });
    const g = r.input.gamepads;
    g.poll = () => {};
    const reading: AxisReading = { control: 'mixture', value: 0.4, moved: true, takeover: false };
    g.readings.push(reading);
    r.run(FRAME);
    expect(r.c.mixture).toBeCloseTo(0.4, 6);
  });

  it('the help text describes the detents', () => {
    const rows = keyBindingsFor(PC12_INPUT);
    expect(rows.find((b) => b.keys === 'M')?.action).toMatch(/GROUND IDLE.*held 1 s.*CUT-OFF/);
    expect(rows.find((b) => b.keys === 'Shift+M')?.action).toMatch(/one detent/);
  });

  it('leaves the continuous mixture of a piston type as it was', () => {
    const r = makeInputRig(C172S_INPUT, { mixture: 1 });
    hold(r, 'KeyM', 1);
    expect(r.c.mixture).toBeGreaterThan(0.5);
    expect(r.c.mixture).toBeLessThan(0.9);
  });
});
