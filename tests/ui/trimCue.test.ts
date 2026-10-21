// The control-position widget's trim suggestion: shown after the stick is held off its neutral for 2.5 s in flight;
// its direction is read from the keyboard yoke's offset (a helicopter's neutral is its spring-trim anchor, not zero),
// it speaks of the cyclic on a helicopter, and it stays hidden while someone else flies (the demo, the instructor, or
// an engaged autopilot / hover hold, which the UI reports as othersFlying). Built on a stand-in DOM (fakeDom.ts).

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import C172S_DEFINITION from '../../src/aircraft/c172s/index';
import type { SimContext } from '../../src/core/context';
import { makeMockEnvironment, makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather } from '../../src/core/types';
import { ControlsWidget, type YokeSource } from '../../src/ui/status';
import { FakeElement, installFakeDom } from './fakeDom';

beforeAll(installFakeDom);
afterAll(() => vi.unstubAllGlobals());
afterEach(() => vi.restoreAllMocks());

/** Run the widget for 4 s of held stick and return the hint (null while hidden). */
function hintAfterHold(yoke: YokeSource, elevator: number, rotorcraft = false): string | null {
  const parent = new FakeElement('div');
  const w = new ControlsWidget(parent as unknown as HTMLElement);
  w.setAircraft({ engines: 1, levers: ['throttle'], rudderTrim: false, rotorcraft });
  w.yoke = () => yoke;
  const s = makeMockState({ heightAGL: 300, tas: 50 });
  for (const wheel of s.wheels) wheel.onGround = false;
  const c = defaultControls(C172S_DEFINITION);
  c.elevator = elevator;
  const ctx = { state: s, controls: c, env: makeMockEnvironment(), simTime: 0, weather: defaultWeather() } as unknown as SimContext;
  let t = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => t);
  for (let k = 0; k <= 40; k++, t += 100) w.update(ctx, true);
  const hint = parent.findAll('ctlw-hint')[0];
  return hint.classList.contains('hidden') ? null : hint.textContent;
}

describe('the trim suggestion', () => {
  const keyboard = (keyboardElevator: number, othersFlying = false): YokeSource =>
    ({ mouseYoke: false, source: 'keyboard', keyboardOffCentre: true, keyboardElevator, othersFlying });

  it('suggests nose-up trim for a yoke held back on an aeroplane', () => {
    expect(hintAfterHold(keyboard(0.2), 0.2)).toBe('Yoke held back: trim nose up (End)');
    expect(hintAfterHold(keyboard(-0.2), -0.2)).toBe('Yoke held forward: trim nose down (Home)');
  });

  it('reads the direction from the offset to the keyboard neutral, not the absolute elevator', () => {
    // A helicopter's stick held 0.126 forward of a spring-trim anchor at 0.459: the elevator itself is positive.
    expect(hintAfterHold(keyboard(-0.126), 0.333, true)).toBe('Cyclic held forward: trim forward (Home)');
    expect(hintAfterHold(keyboard(0.1), 0.559, true)).toBe('Cyclic held aft: trim aft (End)');
  });

  it('stays hidden while someone else flies (demo, instructor, autopilot or hover hold)', () => {
    expect(hintAfterHold(keyboard(-0.126, true), 0.333, true)).toBeNull();
    expect(hintAfterHold(keyboard(0.2, true), 0.2)).toBeNull();
  });
});
