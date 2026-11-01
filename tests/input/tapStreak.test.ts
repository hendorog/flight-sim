// Quick taps on an aeroplane's yoke keys build the rate as a held key does (InputSystem TAP_WINDOW): a run of taps
// with short gaps moves the aileron and elevator further than the same taps with long gaps, and a single tap after a
// pause is still the fine first-press step.

import { describe, expect, it } from 'vitest';
import { C172S_INPUT } from '../../src/aircraft/c172s/input';
import { makeInputRig } from './testbed';

/** Six 0.1 s taps of `code` with `gap` s between them, in the air at 70 KIAS; the axis travel moved. */
function taps(code: string, gap: number, axis: 'aileron' | 'elevator'): number {
  const r = makeInputRig(C172S_INPUT);
  r.setAirborne(true);
  r.s.ias = 36;
  r.run(0.5);
  const start = r.c[axis];
  for (let i = 0; i < 6; i++) {
    r.input.keyDown(code);
    r.run(0.1);
    r.input.keyUp(code);
    r.run(gap);
  }
  return Math.abs(r.c[axis] - start);
}

describe('rapid taps on the yoke keys', () => {
  it('move the aileron further with short gaps than with long ones', () => {
    const quick = taps('ArrowRight', 0.1, 'aileron');
    const slow = taps('ArrowRight', 0.6, 'aileron');
    expect(quick).toBeGreaterThan(slow * 1.5);
  });

  it('move the elevator further with short gaps than with long ones', () => {
    const quick = taps('ArrowDown', 0.1, 'elevator');
    const slow = taps('ArrowDown', 0.6, 'elevator');
    expect(quick).toBeGreaterThan(slow * 1.5);
  });

  it('start a tap after a pause at the fine first-press rate', () => {
    const r = makeInputRig(C172S_INPUT);
    r.setAirborne(true);
    r.s.ias = 36;
    r.tap('ArrowRight', false, 0.1);
    r.run(1);
    const before = r.c.aileron;
    r.tap('ArrowRight', false, 0.1);
    const step = r.c.aileron - before;
    const first = before;
    expect(step).toBeCloseTo(first, 3);
  });
});
