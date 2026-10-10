import { describe, expect, it } from 'vitest';
import { R22_INPUT } from '../../src/aircraft/r22/input';
import { cloneControls } from '../../src/core/types';
import { makeInputRig } from '../input/testbed';
import { demoViewKey } from '../../src/input/InputSystem';
import { parseParams } from '../../src/sim/params';

function demoInput() {
  const r = makeInputRig(R22_INPUT);
  let flying = true;
  r.input.scriptedPilot = { flying: () => flying, stop: () => { flying = false; } };
  // The demo has moved all controls well away from their reset positions, and holds START.
  Object.assign(r.c, { elevator: .21, aileron: -.14, rudder: -.31, collective: .53, throttle: .29, starter: true, feetOffRudder: false });
  return { ...r, flying: () => flying };
}

describe('R22 demonstration authority uses the normal input path', () => {
  it('leaves every control untouched during idle polling, including START and pause', () => {
    const r = demoInput(), before = cloneControls(r.c);
    r.run(.5); r.input.update(0, r.ctx);
    expect(r.flying()).toBe(true);
    expect(r.c).toEqual(before);
  });

  it('takes over on Enter with no change in held cyclic, pedals, collective or grip', () => {
    const r = demoInput(), before = cloneControls(r.c);
    r.input.keyDown('Enter'); r.input.update(0, r.ctx);
    expect(r.flying()).toBe(false);
    for (const k of ['elevator', 'aileron', 'rudder', 'collective', 'throttle'] as const) expect(r.c[k]).toBe(before[k]);
  });

  for (const code of ['ArrowUp', 'KeyZ', 'F3', 'F2', 'F5', 'F6', 'KeyW', 'KeyQ']) it(`takes over on ${code}`, () => {
    const r = demoInput(); r.tap(code);
    expect(r.flying()).toBe(false);
    if (code === 'ArrowUp') { expect(r.c.elevator).toBeLessThan(.21); expect(r.c.elevator).toBeGreaterThan(.19); }
  });

  it('ignores resting hardware, then disconnects on motion and waits for the axis to match', () => {
    const r = demoInput();
    r.input.gamepads.poll = () => {};
    const axis = { control: 'aileron' as const, value: .6, moved: false, takeover: false };
    r.input.gamepads.readings.push(axis);
    r.run(.1);
    expect(r.flying()).toBe(true); expect(r.c.aileron).toBe(-.14);
    axis.value = .7; axis.moved = true; r.run(1 / 60);
    expect(r.flying()).toBe(false); expect(r.c.aileron).toBe(-.14);
    axis.value = -.14; r.run(1 / 60); expect(r.c.aileron).toBe(-.14);
    axis.value = -.2; r.run(1 / 60); expect(r.c.aileron).toBe(-.2);
  });

  for (const control of ['collective', 'throttle', 'throttleRate', 'rudder', 'elevator', 'mixture'] as const) it(`detects ${control} hardware movement`, () => {
    const r = demoInput(); r.input.gamepads.poll = () => {};
    r.input.gamepads.readings.push({ control, value: .9, moved: true, takeover: false });
    r.run(1 / 60);
    expect(r.flying()).toBe(false);
    expect(r.c.collective).toBe(.53); expect(r.c.throttle).toBe(.29);
    expect(r.c.elevator).toBe(.21); expect(r.c.rudder).toBe(-.31);
  });

  it('keeps pause, time acceleration and camera keys available', () => {
    for (const [key, shift] of [['KeyP', false], ['Escape', false], ['BracketRight', true], ['ArrowLeft', true], ['KeyC', false]] as const)
      expect(demoViewKey(key, shift)).toBe(true);
    const r = demoInput(); r.input.keyDown('KeyP'); r.input.keyDown('BracketRight', true);
    expect(r.flying()).toBe(true);
  });

  it('validates the URL demo name independently of the airplane selection', () => {
    expect(parseParams('?aircraft=r22&demo=autorotation&trace=1')).toMatchObject({ demo: 'autorotation', demoTrace: true });
    expect(parseParams('?demo=unknown').demo).toBeNull();
    expect(parseParams('?aircraft=c152').demo).toBeNull();
  });
});
