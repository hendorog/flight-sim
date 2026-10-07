// The engine keys on aircraft with two engines, a propeller lever, ENGINE MASTER switches, retractable gear or
// a carburettor: engine selection, the levers of two engines, the airborne guard, feathering, one starter at a
// time, controls held by a click. The real InputSystem runs on a mock state with synthetic profiles
// (testbed.ts); on the Cessna 172S profile none of the new keys does anything.

import { describe, expect, it } from 'vitest';
import { C172S_INPUT } from '../../src/aircraft/c172s/input';
import { PROP_FEATHER_GATE, cloneControls, defaultControls, engineControl, setEngineControl, type ControlInputs } from '../../src/core/types';
import { KEY_MAP, keyBindingsFor, profileHasAction, type InputAction } from '../../src/input/bindings';
import { LEVER_REJOIN, MIXTURE_GUARD, moveSplitLevers, rejoinLevers, scalarShared, stepLever, stepThird, writeEngineControl } from '../../src/input/engineControls';
import { keyAuthority } from '../../src/input/virtualYoke';
import { IDLE_CUTOFF } from '../../src/physics/propulsion/combustion';
import { CARB_INPUT, CASTER_INPUT, FADEC_TWIN_INPUT, FRAME, TWIN_INPUT, TWIN_VMCA, makeInputRig } from './testbed';

const SELECT_FIRST = 'Select an engine first (8 left, 9 right)';
const throttles = (c: ControlInputs): [number, number] => [engineControl(c, 0, 'throttle'), engineControl(c, 1, 'throttle')];
const twoEngines = (): ControlInputs => defaultControls({ engineCount: 2, controlDefaults: {} });

describe('per-engine controls: the rules for two engines', () => {
  it('a switch for all engines writes the scalar and every engine follows it again', () => {
    const c = twoEngines();
    setEngineControl(c, 0, 'magnetos', 0);
    writeEngineControl(c, 'all', 'magnetos', 1);
    expect([c.magnetos, engineControl(c, 0, 'magnetos'), engineControl(c, 1, 'magnetos')]).toEqual([1, 1, 1]);
    expect(c.engines).toEqual([{}, {}]);
  });

  it('a switch for one engine leaves the other where it is, and the scalar with the engine that still follows it', () => {
    const c = twoEngines();
    writeEngineControl(c, 0, 'fuelSelector', 'crossfeed');
    expect(engineControl(c, 0, 'fuelSelector')).toBe('crossfeed');
    expect(engineControl(c, 1, 'fuelSelector')).toBe('both');
    expect(c.fuelSelector).toBe('both');
    // The other engine has its own position: the selected one is the only follower of the scalar, which is
    // then its lever (so a writer of the scalar still moves an engine).
    writeEngineControl(c, 1, 'fuelSelector', 'off');
    expect(c.fuelSelector).toBe('off');
    expect(engineControl(c, 0, 'fuelSelector')).toBe('crossfeed');
    expect(engineControl(c, 1, 'fuelSelector')).toBe('off');
    expect(scalarShared(c, 1, 'fuelSelector')).toBe(false);
    // Back to the scalar's position: one control again.
    writeEngineControl(c, 0, 'fuelSelector', 'off');
    expect(c.engines).toEqual([{}, {}]);
  });

  it('with one engine every target is the scalar', () => {
    const c = defaultControls();
    writeEngineControl(c, 0, 'magnetos', 2);
    writeEngineControl(c, 'all', 'fuelPump', true);
    expect(c.magnetos).toBe(2);
    expect(c.fuelPump).toBe(true);
    expect(c.engines).toEqual([{}]);
  });

  it('levers that have left the scalar move by the same amount, each to its own stop, and rejoin within 0.05', () => {
    const c = twoEngines();
    c.throttle = 0.6;
    setEngineControl(c, 0, 'throttle', 0.2);
    // +0.1: 0.6 -> 0.7 and 0.2 -> 0.3 (the same increment: the split stays 0.4).
    moveSplitLevers(c, 'throttle', 0.1, 0, 0.7);
    c.throttle = 0.7;
    expect(throttles(c)[0]).toBeCloseTo(0.3, 12);
    expect(throttles(c)[1] - throttles(c)[0]).toBeCloseTo(0.4, 12);
    // -0.5: the split lever stops at 0, the scalar goes to 0.2; 0.2 apart is still split.
    moveSplitLevers(c, 'throttle', -0.5, 0, 0.2);
    c.throttle = 0.2;
    expect(throttles(c)).toEqual([0, 0.2]);
    // -0.16: the scalar is 0.04 from the lever at its stop: within 0.05, one lever again.
    moveSplitLevers(c, 'throttle', -0.16, 0, 0.04);
    c.throttle = 0.04;
    expect(LEVER_REJOIN).toBe(0.05);
    expect(c.engines).toEqual([{}, {}]);
    expect(throttles(c)).toEqual([0.04, 0.04]);
  });

  it('a lever behind its floor (idle cut-off behind the guard, feather behind the gate) is not carried along', () => {
    const c = twoEngines();
    setEngineControl(c, 0, 'propeller', 0);
    moveSplitLevers(c, 'propeller', -0.3, PROP_FEATHER_GATE, 0.7);
    c.propeller = 0.7;
    moveSplitLevers(c, 'propeller', 0.3, PROP_FEATHER_GATE, 1);
    c.propeller = 1;
    expect(engineControl(c, 0, 'propeller')).toBe(0);
    // stepLever: down to the floor and no further; up from behind it starts at the floor only when asked to.
    expect(stepLever(0.1, -0.5, 0.08, true)).toBe(0.08);
    expect(stepLever(0, -0.5, 0.08, true)).toBe(0);
    expect(stepLever(0, 0.01, 0.08, true)).toBeCloseTo(0.09, 12);
    expect(stepLever(0, 0.01, 0.08, false)).toBeCloseTo(0.01, 12);
    expect(stepLever(0.99, 0.5, 0, false)).toBe(1);
  });

  it('rejoinLevers drops only the levers within 0.05 of the scalar', () => {
    const c = twoEngines();
    c.mixture = 0.8;
    setEngineControl(c, 0, 'mixture', 0.76);
    setEngineControl(c, 1, 'mixture', 0.7);
    rejoinLevers(c, 'mixture');
    expect(c.engines).toEqual([{}, { mixture: 0.7 }]);
  });

  it('a lever in idle cut-off never rejoins one that is next to it but above (the secured engine stays shut down)', () => {
    const c = twoEngines();
    c.mixture = MIXTURE_GUARD;
    setEngineControl(c, 0, 'mixture', 0);
    rejoinLevers(c, 'mixture');
    expect(engineControl(c, 0, 'mixture')).toBe(0);
    // Both in cut-off: one lever.
    c.mixture = 0.01;
    rejoinLevers(c, 'mixture');
    expect(c.engines).toEqual([{}, {}]);
    // The same for a feathered propeller lever and one at the gate, were the gate closer than 0.05.
    c.propeller = PROP_FEATHER_GATE;
    setEngineControl(c, 0, 'propeller', PROP_FEATHER_GATE - 0.01);
    rejoinLevers(c, 'propeller');
    expect(engineControl(c, 0, 'propeller')).toBe(PROP_FEATHER_GATE - 0.01);
  });

  it('a three-position control steps closed, half, open', () => {
    expect([stepThird(1, -1), stepThird(0.5, -1), stepThird(0, -1), stepThird(0, 1), stepThird(0.5, 1), stepThird(1, 1)]).toEqual([0.5, 0, 0, 0.5, 1, 1]);
    expect(stepThird(0.4, 1)).toBe(1);
  });
});

describe('engine selection', () => {
  it('8 / 9 / 0 select left, right and both, each with a message; a reset selects both again', () => {
    const r = makeInputRig(TWIN_INPUT);
    expect(r.input.engineSelection).toBe('all');
    r.tap('Digit8');
    expect(r.input.engineSelection).toBe(0);
    expect(r.ctx.engineSelection).toBe(0);
    r.tap('Digit9');
    expect(r.input.engineSelection).toBe(1);
    r.tap('Digit0');
    expect(r.input.engineSelection).toBe('all');
    expect(r.toasts).toEqual(['Left engine selected', 'Right engine selected', 'Both engines selected']);
    r.tap('Digit9');
    r.ctx.events.emit('reset', { scenario: 'runway' });
    r.run(FRAME);
    expect(r.input.engineSelection).toBe('all');
    expect(r.ctx.engineSelection).toBe('all');
  });

  it('with one engine the selection keys do nothing', () => {
    const r = makeInputRig(C172S_INPUT);
    for (const code of ['Digit8', 'Digit9', 'Digit0']) r.tap(code);
    expect(r.input.engineSelection).toBe('all');
    expect(r.toasts).toEqual([]);
    expect('engineSelection' in r.ctx).toBe(false);
  });
});

describe('the levers of two engines', () => {
  it('with both selected the throttle keys move both engines together', () => {
    const r = makeInputRig(TWIN_INPUT);
    r.tap('F3', false, 0.5);
    const [left, right] = throttles(r.c);
    expect(left).toBeGreaterThan(0.1);
    expect(right).toBe(left);
    expect(r.c.engines).toEqual([{}, {}]);
  });

  it('with one selected only that lever moves; then with both selected the two move by the same amount without a jump', () => {
    const r = makeInputRig(TWIN_INPUT, { throttle: 0.6 });
    r.tap('Digit8');
    r.tap('F1'); // left throttle closed
    expect(throttles(r.c)).toEqual([0, 0.6]);
    r.tap('Digit0');
    let before = throttles(r.c);
    let biggest = 0;
    r.input.keyDown('F3');
    for (let i = 0; i < 30; i++) {
      r.run(FRAME);
      const now = throttles(r.c);
      // The same increment on both levers, every frame.
      expect(now[0] - before[0]).toBeCloseTo(now[1] - before[1], 12);
      biggest = Math.max(biggest, now[0] - before[0]);
      before = now;
    }
    r.input.keyUp('F3');
    r.run(FRAME);
    // No jump: the first frame is the 0.02 tap plus a frame at the slow rate, later ones at most 0.5 / s.
    expect(biggest).toBeLessThan(0.02 + 0.5 * FRAME + 1e-9);
    expect(before[1] - before[0]).toBeCloseTo(0.6, 9);
    expect(before[0]).toBeGreaterThan(0.1);
  });

  it('a lever stops at its own stop while the other goes on, and they rejoin within 0.05', () => {
    const r = makeInputRig(TWIN_INPUT, { throttle: 0.6 });
    r.tap('Digit8');
    r.tap('F1');
    r.tap('Digit0');
    // Throttles back with both selected: the left one is at its stop, the right one comes down to it.
    r.input.keyDown('F2');
    let split = 0.6;
    let rejoinedAt = -1;
    for (let i = 0; i < 240 && rejoinedAt < 0; i++) {
      r.run(FRAME);
      const [left, right] = throttles(r.c);
      expect(left).toBe(right > 0.05 ? 0 : right);
      if (left === right) rejoinedAt = split;
      split = right - left;
    }
    r.input.keyUp('F2');
    // The frame before they became one lever they were just over 0.05 apart.
    expect(rejoinedAt).toBeGreaterThan(LEVER_REJOIN);
    expect(rejoinedAt).toBeLessThan(LEVER_REJOIN + 0.5 * FRAME + 1e-9);
    expect(r.c.engines).toEqual([{}, {}]);
    // One lever again: a writer of the scalar (autothrottle, a preset) moves both engines.
    r.c.throttle = 0.5;
    expect(throttles(r.c)).toEqual([0.5, 0.5]);
  });

  it('one engine selected: its lever passes the other without sticking, and rejoins it when let go within 0.05', () => {
    const r = makeInputRig(TWIN_INPUT, { throttle: 0.5 });
    r.tap('Digit8');
    r.tap('F1');
    // Held from 0 through 0.5 and beyond: it does not stop at the other lever.
    r.tap('F3', false, 2.5);
    expect(throttles(r.c)[0]).toBeGreaterThan(0.6);
    expect(throttles(r.c)[1]).toBe(0.5);
    // Brought back next to the other one and let go: one lever again.
    for (let i = 0; i < 400 && throttles(r.c)[0] - 0.5 > 0.04; i++) r.tap('F2');
    expect(throttles(r.c)).toEqual([0.5, 0.5]);
    expect(r.c.engines).toEqual([{}, {}]);
    // Let go more than 0.05 away it stays its own lever.
    setEngineControl(r.c, 0, 'throttle', 0.6);
    r.tap('F2');
    const left = throttles(r.c)[0];
    expect(left).toBeLessThan(0.6);
    expect(left - 0.5).toBeGreaterThan(LEVER_REJOIN);
    expect(r.c.engines).toEqual([{ throttle: left }, {}]);
  });

  it('F1 / F4 with both selected bring the levers together', () => {
    const r = makeInputRig(TWIN_INPUT, { throttle: 0.6 });
    r.tap('Digit9');
    r.tap('F4');
    expect(throttles(r.c)).toEqual([0.6, 1]);
    r.tap('Digit0');
    r.tap('F1');
    expect(throttles(r.c)).toEqual([0, 0]);
    expect(r.c.engines).toEqual([{}, {}]);
  });

  it('with one engine secured, the keys of the other move the scalar: the lever every "all engines" writer moves', () => {
    const r = makeInputRig(TWIN_INPUT, { throttle: 0.6 });
    r.tap('Digit8');
    r.tap('F1');
    r.tap('Digit9');
    r.tap('F3', false, 0.5);
    expect(r.c.throttle).toBeGreaterThan(0.7);
    expect(throttles(r.c)).toEqual([0, r.c.throttle]);
    expect(r.c.engines).toEqual([{ throttle: 0 }, {}]);
  });

  it('mixture and propeller levers follow the same rules', () => {
    const r = makeInputRig(TWIN_INPUT);
    r.tap('Digit8');
    r.tap('KeyM', false, 5); // left mixture to idle cut-off
    r.tap('Semicolon', false, 1); // left propeller back
    expect(engineControl(r.c, 0, 'mixture')).toBe(0);
    expect(engineControl(r.c, 1, 'mixture')).toBe(1);
    expect(engineControl(r.c, 0, 'propeller')).toBeLessThan(0.9);
    expect(engineControl(r.c, 1, 'propeller')).toBe(1);
    // A single with neither lever: the keys do nothing.
    const single = makeInputRig({ ...C172S_INPUT, has: { ...C172S_INPUT.has, mixture: false } });
    single.tap('KeyM', false, 2);
    single.tap('Semicolon', false, 2);
    expect(single.c.mixture).toBe(1);
    expect(single.c.propeller).toBe(1);
  });
});

describe('the propeller lever and feathering', () => {
  it('the lever key stops at the feather gate; Shift+F goes through it, and is not a toggle', () => {
    const r = makeInputRig(TWIN_INPUT);
    r.tap('Digit8');
    r.tap('Semicolon', false, 6);
    // Full travel takes under 3 s at 0.35 / s: held twice as long, the lever is AT the gate, still governing.
    expect(engineControl(r.c, 0, 'propeller')).toBe(PROP_FEATHER_GATE);
    r.tap('KeyF', true);
    expect(engineControl(r.c, 0, 'propeller')).toBe(0);
    expect(engineControl(r.c, 0, 'propeller')).toBeLessThan(PROP_FEATHER_GATE);
    r.tap('KeyF', true);
    expect(engineControl(r.c, 0, 'propeller')).toBe(0);
    expect(engineControl(r.c, 1, 'propeller')).toBe(1);
    // The bare F key is still free.
    r.c.propeller = 1;
    r.tap('KeyF');
    expect(engineControl(r.c, 1, 'propeller')).toBe(1);
  });

  it('the propeller is unfeathered with the lever forward: from feather it returns to the gate and on', () => {
    const r = makeInputRig(TWIN_INPUT);
    r.tap('Digit8');
    r.tap('KeyF', true);
    // The lever back key does nothing behind the gate.
    r.tap('Semicolon', false, 0.5);
    expect(engineControl(r.c, 0, 'propeller')).toBe(0);
    r.input.keyDown('Semicolon', true);
    r.run(FRAME);
    const first = engineControl(r.c, 0, 'propeller');
    expect(first).toBeGreaterThan(PROP_FEATHER_GATE);
    expect(first).toBeLessThan(PROP_FEATHER_GATE + 0.03);
    r.run(4);
    r.input.keyUp('Semicolon');
    r.run(FRAME);
    expect(engineControl(r.c, 0, 'propeller')).toBe(1);
    expect(r.c.engines).toEqual([{}, {}]);
  });

  it('with both selected the lever keys leave a feathered propeller feathered', () => {
    const r = makeInputRig(TWIN_INPUT);
    r.tap('Digit8');
    r.tap('KeyF', true);
    r.tap('Digit0');
    r.tap('Semicolon', false, 1);
    r.tap('Semicolon', true, 3);
    expect(engineControl(r.c, 0, 'propeller')).toBe(0);
    expect(engineControl(r.c, 1, 'propeller')).toBe(1);
  });
});

describe('the airborne guard of a twin', () => {
  /** Press every key that can shut an engine down. */
  const shutDownKeys = (r: ReturnType<typeof makeInputRig>): void => {
    r.tap('Digit1'); // magnetos OFF
    r.tap('KeyF', true); // feather
    r.tap('KeyJ', true); // fuel selector on -> crossfeed
    r.tap('KeyJ', true); // -> off
    r.tap('KeyM', false, 6); // mixture lean, held
  };

  it('in the air with both selected the shut-down keys do nothing and say why; the mixture stops above idle cut-off', () => {
    const r = makeInputRig(TWIN_INPUT, { fuelSelector: 'on' });
    r.setAirborne(true);
    shutDownKeys(r);
    for (const i of [0, 1]) {
      expect(engineControl(r.c, i, 'magnetos')).toBe(3);
      expect(engineControl(r.c, i, 'propeller')).toBe(1);
      // CROSSFEED is not a shut-down: the selector goes there and no further.
      expect(engineControl(r.c, i, 'fuelSelector')).toBe('crossfeed');
      expect(engineControl(r.c, i, 'mixture')).toBe(MIXTURE_GUARD);
    }
    // The stop is above the idle cut-off of the engine model: both engines keep running.
    expect(MIXTURE_GUARD).toBeGreaterThan(IDLE_CUTOFF);
    expect(r.toasts).toEqual([SELECT_FIRST, SELECT_FIRST, SELECT_FIRST]);
    // At the stop a further press says why nothing happens.
    r.tap('KeyM');
    expect(r.toasts.length).toBe(4);
    expect(r.toasts[3]).toBe(SELECT_FIRST);
  });

  it('on the ground both selected is a normal shut-down of both engines', () => {
    const r = makeInputRig(TWIN_INPUT, { fuelSelector: 'on' });
    shutDownKeys(r);
    for (const i of [0, 1]) {
      expect(engineControl(r.c, i, 'magnetos')).toBe(0);
      expect(engineControl(r.c, i, 'propeller')).toBe(0);
      expect(engineControl(r.c, i, 'fuelSelector')).toBe('off');
      expect(engineControl(r.c, i, 'mixture')).toBe(0);
    }
    expect(r.toasts).toEqual([]);
  });

  it('in the air with ONE engine selected the keys secure that engine and leave the other alone', () => {
    const r = makeInputRig(TWIN_INPUT, { fuelSelector: 'on' });
    r.setAirborne(true);
    r.tap('Digit8');
    shutDownKeys(r);
    expect([engineControl(r.c, 0, 'magnetos'), engineControl(r.c, 0, 'propeller'), engineControl(r.c, 0, 'fuelSelector'), engineControl(r.c, 0, 'mixture')]).toEqual([0, 0, 'off', 0]);
    expect([engineControl(r.c, 1, 'magnetos'), engineControl(r.c, 1, 'propeller'), engineControl(r.c, 1, 'fuelSelector'), engineControl(r.c, 1, 'mixture')]).toEqual([3, 1, 'on', 1]);
    expect(r.toasts).toEqual(['Left engine selected']);
    // Both selected again: leaning the live engine stops at the guard and leaves the secured one in cut-off.
    r.tap('Digit0');
    r.tap('KeyM', false, 6);
    expect(engineControl(r.c, 0, 'mixture')).toBe(0);
    expect(engineControl(r.c, 1, 'mixture')).toBe(MIXTURE_GUARD);
    r.tap('KeyM', true, 6);
    expect(engineControl(r.c, 0, 'mixture')).toBe(0);
    expect(engineControl(r.c, 1, 'mixture')).toBe(1);
  });

  it('ENGINE MASTER switches: 1 is off, 4 is on, 2 and 3 do nothing; off in the air wants one engine selected', () => {
    const r = makeInputRig(FADEC_TWIN_INPUT);
    r.setAirborne(true);
    r.tap('Digit1');
    expect([engineControl(r.c, 0, 'engineMaster'), engineControl(r.c, 1, 'engineMaster')]).toEqual([true, true]);
    expect(r.toasts).toEqual([SELECT_FIRST]);
    r.tap('Digit9');
    r.tap('Digit1');
    expect([engineControl(r.c, 0, 'engineMaster'), engineControl(r.c, 1, 'engineMaster')]).toEqual([true, false]);
    r.tap('Digit2');
    r.tap('Digit3');
    expect(r.c.magnetos).toBe(3);
    expect(engineControl(r.c, 1, 'magnetos')).toBe(3);
    r.tap('Digit4');
    expect([engineControl(r.c, 0, 'engineMaster'), engineControl(r.c, 1, 'engineMaster')]).toEqual([true, true]);
    // The starter of such a type does not touch the magnetos either.
    r.c.magnetos = 0;
    r.tap('KeyS');
    expect(r.c.magnetos).toBe(0);
  });

  it('a single has no guard', () => {
    const r = makeInputRig(C172S_INPUT);
    r.setAirborne(true);
    r.tap('Digit1');
    r.tap('KeyM', false, 6);
    r.tap('KeyJ', true);
    r.tap('KeyJ', true);
    r.tap('KeyJ', true);
    expect([r.c.magnetos, r.c.mixture, r.c.fuelSelector]).toEqual([0, 0, 'off']);
    expect(r.toasts).toEqual([]);
  });
});

describe('the starter of a twin', () => {
  const starters = (c: ControlInputs): boolean[] => [engineControl(c, 0, 'starter'), engineControl(c, 1, 'starter')];

  it('with both selected one starter turns at a time: the left engine, then the right one once the left runs', () => {
    const r = makeInputRig(TWIN_INPUT);
    r.s.engines[0].running = r.s.engines[1].running = false;
    r.input.keyDown('KeyS');
    r.run(1);
    expect(starters(r.c)).toEqual([true, false]);
    r.s.engines[0].running = true;
    r.run(FRAME);
    expect(starters(r.c)).toEqual([false, true]);
    r.run(1);
    r.s.engines[1].running = true;
    r.run(FRAME);
    // Both run: neither starter is engaged although the key is still down.
    expect(starters(r.c)).toEqual([false, false]);
    r.input.keyUp('KeyS');
    r.run(FRAME);
    expect(starters(r.c)).toEqual([false, false]);
    expect(r.c.starter).toBe(false);
    expect(r.c.engines).toEqual([{}, {}]);
    // Toggle magnetos: the starter key does not move them.
    expect(r.c.magnetos).toBe(3);
  });

  it('with one selected, and from a click that names its engine, only that starter turns', () => {
    const r = makeInputRig(TWIN_INPUT);
    r.s.engines[0].running = r.s.engines[1].running = false;
    r.tap('Digit9');
    r.input.keyDown('KeyS', true); // Shift+S is the starter too
    r.run(FRAME);
    expect(starters(r.c)).toEqual([false, true]);
    r.input.keyUp('KeyS');
    r.run(FRAME);
    expect(starters(r.c)).toEqual([false, false]);
    // The left engine's start button, with the RIGHT engine selected on the keyboard.
    r.input.hold('starter', true, 0);
    r.run(FRAME);
    expect(starters(r.c)).toEqual([true, false]);
    r.input.hold('starter', false, 0);
    r.run(FRAME);
    expect(starters(r.c)).toEqual([false, false]);
  });

  it('the Cessna 172S key switch: the starter is the scalar and passes through BOTH', () => {
    const r = makeInputRig(C172S_INPUT, { magnetos: 0 });
    r.input.keyDown('KeyS');
    r.run(FRAME);
    expect(r.c.starter).toBe(true);
    expect(r.c.magnetos).toBe(3);
    expect(r.c.engines).toEqual([{}]);
    r.input.keyUp('KeyS');
    r.run(FRAME);
    expect(r.c.starter).toBe(false);
  });
});

describe('controls held by a click', () => {
  it('a click on one engine acts on that engine whatever is selected, without the guard', () => {
    const r = makeInputRig(TWIN_INPUT);
    r.setAirborne(true);
    r.input.hold('magnetoOff', true, 1);
    r.run(FRAME);
    r.input.hold('magnetoOff', false, 1);
    expect([engineControl(r.c, 0, 'magnetos'), engineControl(r.c, 1, 'magnetos')]).toEqual([3, 0]);
    expect(r.toasts).toEqual([]);
    // Without an engine it is the key: both selected in the air is refused.
    r.input.hold('magnetoOff', true);
    r.run(FRAME);
    r.input.hold('magnetoOff', false);
    expect(engineControl(r.c, 0, 'magnetos')).toBe(3);
    expect(r.toasts).toEqual([SELECT_FIRST]);
  });

  it('a held action is applied once and stays held until released; losing the focus releases it', () => {
    const r = makeInputRig(C172S_INPUT);
    r.input.hold('dgAlign', true);
    r.input.hold('dgAlign', true);
    r.run(0.5);
    expect(r.c.dgAlign).toBe(true);
    r.input.hold('dgAlign', false);
    r.run(FRAME);
    expect(r.c.dgAlign).toBe(false);
    r.input.hold('fuelPump', true);
    r.run(0.5);
    expect(r.c.fuelPump).toBe(true); // toggled once, not every frame
    r.input.hold('starter', true);
    r.run(FRAME);
    expect(r.c.starter).toBe(true);
    r.input.releaseAll();
    r.run(FRAME);
    expect(r.c.starter).toBe(false);
    // An action the type has nothing for is ignored.
    r.input.hold('gearUp', true);
    r.run(FRAME);
    expect(r.c.gearLever).toBe('down');
  });
});

describe('switches and selectors per engine', () => {
  it('fuel selector, fuel pump and cowl flaps act on the selected engine(s)', () => {
    const r = makeInputRig(TWIN_INPUT, { fuelSelector: 'on' });
    r.tap('Digit9');
    r.tap('KeyJ', true);
    r.tap('KeyJ');
    r.tap('Backslash', true);
    expect([engineControl(r.c, 0, 'fuelSelector'), engineControl(r.c, 1, 'fuelSelector')]).toEqual(['on', 'crossfeed']);
    expect([engineControl(r.c, 0, 'fuelPump'), engineControl(r.c, 1, 'fuelPump')]).toEqual([false, true]);
    expect([engineControl(r.c, 0, 'cowlFlaps'), engineControl(r.c, 1, 'cowlFlaps')]).toEqual([1, 0.5]);
    // Both selected: the switch goes by the scalar and every engine follows it again.
    r.tap('Digit0');
    r.tap('KeyJ');
    r.tap('Backslash', true);
    r.tap('Backslash', true);
    r.tap('Backslash', true);
    expect([engineControl(r.c, 0, 'fuelPump'), engineControl(r.c, 1, 'fuelPump')]).toEqual([true, true]);
    expect([engineControl(r.c, 0, 'cowlFlaps'), engineControl(r.c, 1, 'cowlFlaps')]).toEqual([0, 0]);
    r.tap('Backslash');
    expect(r.c.cowlFlaps).toBe(0.5);
  });

  it('the / key is carburettor heat, or alternate air where there is no carburettor; one lever for both engines stays one', () => {
    const carb = makeInputRig(CARB_INPUT);
    carb.tap('Slash');
    expect([carb.c.carbHeat, carb.c.alternateAir]).toEqual([1, false]);
    carb.tap('Slash');
    expect(carb.c.carbHeat).toBe(0);
    // No electric pump on this type: its key does nothing.
    carb.tap('KeyJ');
    expect(carb.c.fuelPump).toBe(false);
    const injected = makeInputRig(CASTER_INPUT);
    injected.tap('Slash');
    expect([injected.c.carbHeat, injected.c.alternateAir]).toEqual([0, true]);
    // Per engine on the piston twin, common on the FADEC twin (InputProfile.commonControls).
    const twin = makeInputRig(TWIN_INPUT);
    twin.tap('Digit8');
    twin.tap('Slash');
    expect([engineControl(twin.c, 0, 'alternateAir'), engineControl(twin.c, 1, 'alternateAir')]).toEqual([true, false]);
    const fadec = makeInputRig(FADEC_TWIN_INPUT);
    fadec.tap('Digit8');
    fadec.tap('Slash');
    expect([engineControl(fadec.c, 0, 'alternateAir'), engineControl(fadec.c, 1, 'alternateAir')]).toEqual([true, true]);
    expect(fadec.c.engines).toEqual([{}, {}]);
  });
});

describe('gear lever and rudder trim', () => {
  it('F7 is DOWN, Shift+F7 is UP (two positions, not a toggle), F10 pulls the emergency knob, which latches', () => {
    const r = makeInputRig(TWIN_INPUT);
    r.tap('F7', true);
    expect(r.c.gearLever).toBe('up');
    r.tap('F7', true);
    expect(r.c.gearLever).toBe('up');
    r.tap('F7');
    r.tap('F7');
    expect(r.c.gearLever).toBe('down');
    expect(r.c.gearEmergency).toBe(false);
    r.tap('F10');
    r.tap('F10');
    expect(r.c.gearEmergency).toBe(true);
  });

  it('6 / 7 hold the rudder trim left / right at the trim wheel rate, to the stops', () => {
    const r = makeInputRig(TWIN_INPUT);
    r.tap('Digit7', false, 1);
    // A second of holding: 0.01 for the tap, then 0.25 / s building up from a quarter of that over the second.
    expect(r.c.rudderTrim).toBeGreaterThan(0.1);
    expect(r.c.rudderTrim).toBeLessThan(0.01 + 0.25 * (1 + FRAME));
    r.tap('Digit6', false, 12);
    expect(r.c.rudderTrim).toBe(-1);
  });
});

describe('the Cessna 172S: none of the new keys does anything', () => {
  it('pressing and holding every new key leaves every control as it was', () => {
    const fresh = KEY_MAP.filter((m) => !profileHasAction(C172S_INPUT, m.action));
    // The fourteen key entries of the levers and switches this type has not, and nothing it had before.
    expect(fresh.map((m) => `${m.shift === true ? 'Shift+' : ''}${m.code}`)).toEqual([
      'F7', 'Shift+F7', 'F10', 'Digit6', 'Digit7', 'Semicolon', 'Shift+Semicolon', 'Shift+KeyF', 'Slash', 'Backslash', 'Shift+Backslash', 'Digit8', 'Digit9', 'Digit0',
    ]);
    for (const airborne of [false, true]) {
      const r = makeInputRig(C172S_INPUT);
      r.setAirborne(airborne);
      r.run(FRAME);
      const before = cloneControls(r.c);
      for (const m of fresh) {
        expect(r.input.keyDown(m.code, m.shift === true)).toBe(m.action);
        r.run(0.3);
        r.input.keyUp(m.code);
        r.run(FRAME);
        r.input.hold(m.action, true, 0);
        r.run(FRAME);
        r.input.hold(m.action, false, 0);
      }
      expect(r.c).toEqual(before);
      expect(r.toasts).toEqual([]);
      expect(r.input.engineSelection).toBe('all');
    }
  });
});

describe('keyboard rudder of a twin', () => {
  it('keeps more travel than an engine failure needs at every speed from Vmca up', () => {
    // At Vmca full rudder just balances the live engine. The yawing moment of the rudder grows with dynamic
    // pressure and the thrust asymmetry does not grow with speed, so above Vmca the travel needed falls at
    // least as (Vmca / V)^2; the keyboard limit falls as Vfull / V.
    const rudder = TWIN_INPUT.assists.axes.rudder;
    expect(rudder.fullAuthoritySpeed).toBeGreaterThanOrEqual(TWIN_VMCA);
    expect(rudder.authorityExponent).toBeLessThanOrEqual(1);
    for (let v = TWIN_VMCA; v < 3 * TWIN_VMCA; v += 0.5) {
      expect(keyAuthority(v, rudder)).toBeGreaterThanOrEqual(Math.min(1, (TWIN_VMCA / v) ** 2));
    }
    // The single's tuning (full travel to 30 m/s only) would be short at this Vmca of 35.5 m/s: 85 % of travel.
    expect(keyAuthority(TWIN_VMCA, C172S_INPUT.assists.axes.rudder)).toBeCloseTo(30 / TWIN_VMCA, 12);
    expect(keyAuthority(TWIN_VMCA, C172S_INPUT.assists.axes.rudder)).toBeLessThan(0.86);
  });
});

describe('help listing of other types', () => {
  const keysOf = (profile: typeof TWIN_INPUT): Map<string, string> => new Map(keyBindingsFor(profile).map((b) => [b.action, b.keys]));

  it('lists the keys of the levers and switches a type has, in their categories', () => {
    const twin = keysOf(TWIN_INPUT);
    expect(twin.get('Landing gear lever DOWN')).toBe('F7');
    expect(twin.get('Landing gear lever UP')).toBe('Shift+F7');
    expect(twin.get('Emergency gear extension (pull the knob)')).toBe('F10');
    expect(twin.get('Rudder trim nose left (hold)')).toBe('6');
    expect(twin.get('Rudder trim nose right (hold)')).toBe('7');
    expect(twin.get('Propeller lever back (lower rpm), as far as the feather gate')).toBe(';');
    expect(twin.get('Propeller lever forward (higher rpm); out of feather')).toBe('Shift+;');
    expect(twin.get('Feather the propeller of the selected engine')).toBe('Shift+F');
    expect(twin.get('Cowl flaps open one step')).toBe('\\');
    expect(twin.get('Cowl flaps close one step')).toBe('Shift+\\');
    expect(twin.get('Engine keys act on the LEFT engine')).toBe('8');
    expect(twin.get('Engine keys act on the RIGHT engine')).toBe('9');
    expect(twin.get('Engine keys act on both engines')).toBe('0');
    // No carburettor: the / key is the alternate air.
    expect(twin.get('Alternate air off / on')).toBe('/');
    expect(twin.has('Carburettor heat cold / hot')).toBe(false);
    expect(keysOf(CARB_INPUT).get('Carburettor heat cold / hot')).toBe('/');
    const rows = keyBindingsFor(TWIN_INPUT);
    const category = (action: string): string | undefined => rows.find((b) => b.action === action)?.category;
    expect(category('Landing gear lever DOWN')).toBe('Flight controls');
    expect(category('Rudder trim nose left (hold)')).toBe('Flight controls');
    for (const a of ['Feather the propeller of the selected engine', 'Alternate air off / on', 'Cowl flaps open one step', 'Engine keys act on the LEFT engine']) expect(category(a)).toBe('Engine');
  });

  it('a FADEC twin lists neither mixture, propeller, feather nor single magnetos, and carries its own labels', () => {
    const rows = keyBindingsFor(FADEC_TWIN_INPUT).map((b) => b.action);
    for (const absent of ['Mixture lean', 'Mixture rich', 'Magnetos R', 'Magnetos L', 'Cowl flaps open one step']) expect(rows).not.toContain(absent);
    expect(rows.some((a) => a.startsWith('Propeller lever') || a.startsWith('Feather'))).toBe(false);
    for (const present of ['Power lever forward', 'Engine master OFF', 'Engine master ON', 'Landing gear lever UP', 'Engine keys act on both engines']) expect(rows).toContain(present);
  });

  it('every action has a label and a key, and an action is listed exactly where its lever exists', () => {
    const actions = new Set<InputAction>(KEY_MAP.map((m) => m.action));
    const all = keyBindingsFor({ ...TWIN_INPUT, has: { mixture: true, propeller: true, feather: true, carbHeat: true, alternateAir: true, cowlFlaps: true, gear: true, rudderTrim: true, fuelPump: true } });
    // One row per action plus the four mouse rows.
    expect(all.length).toBe(actions.size + 4);
    expect(all.every((b) => b.keys && b.action && b.category)).toBe(true);
  });
});
