import { describe, expect, it } from 'vitest';
import { actionForKey, KEY_BINDINGS, KEY_MAP } from '../../src/input/bindings';
import {
  applyDeadzone,
  defaultCalibration,
  MotionDetector,
  normalizeBipolar,
  normalizeUnipolar,
  widenRange,
} from '../../src/input/axisFilter';
import { classifyDevice, defaultProfile } from '../../src/input/devices';
import { Activity, AXIS_HOLD_TIME, LeverOwner, mixCentring, mouseYokeDeflection } from '../../src/input/mixer';
import { FRAME, makeRig, type Rig } from './keyboardPilot';
import { InputSystem } from '../../src/input/InputSystem';
import {
  CENTRE_RATE,
  GroundSteeringAssist,
  KEY_AXIS_TUNING,
  keyAuthority,
  keyRate,
  leverRate,
  nextFlapDetent,
  stepBrake,
  stepCentre,
  stepKeyAxis,
  wrapDegrees,
} from '../../src/input/virtualYoke';

const run = (steps: number, dt: number, f: (v: number) => number, v0 = 0): number => {
  let v = v0;
  for (let i = 0; i < steps; i++) v = f(v);
  return v;
};

describe('key bindings', () => {
  it('maps the required keys', () => {
    expect(actionForKey('ArrowDown', false)).toBe('pitchUp');
    expect(actionForKey('ArrowUp', false)).toBe('pitchDown');
    expect(actionForKey('KeyB', false)).toBe('brakes');
    expect(actionForKey('KeyB', true)).toBe('parkingBrake');
    expect(actionForKey('KeyM', true)).toBe('mixtureRich');
    expect(actionForKey('KeyC', false)).toBe('cameraNext');
    // Shift-agnostic bindings still work with Shift held; Shift+arrows look around.
    expect(actionForKey('KeyZ', true)).toBe('rudderLeft');
    expect(actionForKey('ArrowLeft', true)).toBe('lookLeft');
    expect(actionForKey('ArrowLeft', false)).toBe('rollLeft');
    // The project owner's bindings: F1 idle, F2 throttle back, F3 forward, F4 full; F5 flaps up, F6 down;
    // Numpad 5 and 5 centre the yoke and rudder (the view recentres on Backspace / middle click).
    expect(['F1', 'F2', 'F3', 'F4', 'F5', 'F6'].map((k) => actionForKey(k, false))).toEqual([
      'throttleIdle',
      'throttleDown',
      'throttleUp',
      'throttleFull',
      'flapsUp',
      'flapsDown',
    ]);
    expect(actionForKey('Numpad5', false)).toBe('centreControls');
    expect(actionForKey('Digit5', false)).toBe('centreControls');
    expect(actionForKey('Backspace', false)).toBe('viewRecentre');
  });

  it('F and the bare [ / ] keys are no longer flap keys (F is left unbound, V recentres the view)', () => {
    for (const code of ['KeyF', 'BracketLeft', 'BracketRight']) expect(actionForKey(code, false)).toBeNull();
    expect(actionForKey('KeyV', false)).toBe('viewRecentre');
    // Shift+[ / Shift+] belong to the shell's time-rate keys.
    expect(actionForKey('BracketLeft', true)).toBeNull();
    expect(KEY_MAP.filter((m) => m.action === 'flapsUp' || m.action === 'flapsDown').map((m) => m.code)).toEqual(['F5', 'F6']);
  });

  it('leaves the UI keys unbound and has no duplicate key+shift pairs', () => {
    // UI (Escape, F8, F9), shell (P, A, Shift+R) and keys kept free (H, F11, Tab).
    for (const code of ['KeyH', 'Escape', 'KeyP', 'F11', 'Tab', 'KeyA', 'KeyR', 'F8', 'F9']) {
      expect(actionForKey(code, false)).toBeNull();
      expect(actionForKey(code, true)).toBeNull();
    }
    const seen = new Set<string>();
    for (const m of KEY_MAP) {
      const k = `${m.code}/${m.shift}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it('binds the keys of the other aircraft types: gear, propeller, feather, carburettor heat, cowl flaps, rudder trim, engine selection', () => {
    // Explicit gear lever positions: F7 can only select DOWN (a slip from F6 on final), Shift+F7 UP.
    expect(actionForKey('F7', false)).toBe('gearDown');
    expect(actionForKey('F7', true)).toBe('gearUp');
    expect(actionForKey('F10', false)).toBe('gearEmergency');
    expect(actionForKey('F10', true)).toBe('gearEmergency');
    expect(actionForKey('Slash', false)).toBe('carbHeat');
    expect(actionForKey('Backslash', false)).toBe('cowlFlapsOpen');
    expect(actionForKey('Backslash', true)).toBe('cowlFlapsClose');
    expect(actionForKey('Semicolon', false)).toBe('propDecrease');
    expect(actionForKey('Semicolon', true)).toBe('propIncrease');
    // Feather is Shift+F only: the bare F stays free.
    expect(actionForKey('KeyF', true)).toBe('propFeather');
    expect(actionForKey('KeyF', false)).toBeNull();
    expect(['Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'].map((k) => actionForKey(k, false))).toEqual([
      'rudderTrimLeft',
      'rudderTrimRight',
      'engineSelect1',
      'engineSelect2',
      'engineSelectAll',
    ]);
    // Held levers and the selection keep working with Shift down.
    expect(actionForKey('Digit6', true)).toBe('rudderTrimLeft');
    expect(actionForKey('Digit0', true)).toBe('engineSelectAll');
  });

  it('no existing key changed: the starter is S in both shift states, and the map gained exactly the new entries', () => {
    expect(actionForKey('KeyS', false)).toBe('starter');
    expect(actionForKey('KeyS', true)).toBe('starter');
    expect(KEY_MAP.filter((m) => m.code === 'KeyS')).toEqual([{ code: 'KeyS', action: 'starter' }]);
    // The magneto keys are what they were (on an ENGINE MASTER type 1 and 4 are its off and on).
    expect(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].map((k) => actionForKey(k, true))).toEqual(['magnetoOff', 'magnetoRight', 'magnetoLeft', 'magnetoBoth', 'centreControls']);
    const added = ['F7', 'F10', 'Slash', 'Backslash', 'Semicolon', 'KeyF', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];
    expect(KEY_MAP.filter((m) => added.includes(m.code)).map((m) => `${m.code}/${m.shift}/${m.action}`)).toEqual([
      'F7/false/gearDown',
      'F7/true/gearUp',
      'F10/undefined/gearEmergency',
      'Digit6/undefined/rudderTrimLeft',
      'Digit7/undefined/rudderTrimRight',
      'Semicolon/false/propDecrease',
      'Semicolon/true/propIncrease',
      'KeyF/true/propFeather',
      'Slash/undefined/carbHeat',
      'Backslash/false/cowlFlapsOpen',
      'Backslash/true/cowlFlapsClose',
      'Digit8/undefined/engineSelect1',
      'Digit9/undefined/engineSelect2',
      'Digit0/undefined/engineSelectAll',
    ]);
    // 71 entries before these fourteen.
    expect(KEY_MAP.length).toBe(71 + 14);
    // A code is bound either once for both shift states or with explicit flags, never both ways (one would shadow the other).
    for (const code of new Set(KEY_MAP.map((m) => m.code))) {
      const entries = KEY_MAP.filter((m) => m.code === code);
      if (entries.some((m) => m.shift === undefined)) expect(entries.length, code).toBe(1);
    }
    // Nothing with a modifier other than Shift, and Space stays reserved.
    expect(KEY_MAP.some((m) => m.code === 'Space' || /^(Control|Alt|Meta)/.test(m.code))).toBe(false);
  });

  it('the Cessna 172S help listing is unchanged by the keys it has nothing for', () => {
    expect(KEY_BINDINGS.length).toBe(61);
    for (const key of ['F7', 'F10', '/', ';', '\\', 'Shift+F', '6', '7', '8', '9', '0']) expect(KEY_BINDINGS.some((b) => b.keys.split(' / ').includes(key)), key).toBe(false);
  });

  it('builds a help listing with categories', () => {
    const flaps = KEY_BINDINGS.find((b) => b.action.startsWith('Flaps up'));
    expect(flaps?.keys).toBe('F5');
    expect(flaps?.category).toBe('Flight controls');
    expect(KEY_BINDINGS.find((b) => b.action.startsWith('Flaps down'))?.keys).toBe('F6');
    expect(KEY_BINDINGS.find((b) => b.action.startsWith('Centre aileron'))?.keys).toBe('Num 5 / 5');
    expect(KEY_BINDINGS.find((b) => b.action === 'Recentre view' && b.keys.includes('V') && b.keys.includes('Backspace'))).toBeDefined();
    expect(KEY_BINDINGS.every((b) => b.keys && b.action && b.category)).toBe(true);
  });
});

describe('virtual yoke (hold position)', () => {
  const t = KEY_AXIS_TUNING.aileron;
  const e = KEY_AXIS_TUNING.elevator;
  /** Hold a key for n frames from a fresh press (held time counted as InputSystem does). */
  const hold = (frames: number, dir: number, ias: number, tun = t, v0 = 0): number => {
    let v = v0;
    for (let i = 1; i <= frames; i++) v = stepKeyAxis(v, dir, ias, 1 / 60, tun, i / 60);
    return v;
  };

  it('a tap is a fine adjustment, holding accelerates and reaches the limit at low speed', () => {
    const tap = hold(5, 1, 20); // ~80 ms
    expect(tap).toBeGreaterThan(0.01);
    expect(tap).toBeLessThan(0.025);
    const second = hold(60, 1, 20);
    expect(second).toBeGreaterThan(0.3);
    expect(second).toBeLessThan(0.45);
    expect(hold(180, 1, 20)).toBeCloseTo(1, 6);
  });

  it('stays where it is when the key is released', () => {
    const v = hold(30, 1, 30);
    for (let i = 0; i < 600; i++) expect(stepKeyAxis(v, 0, 30, 1 / 60, t)).toBe(v);
  });

  it('the rate starts slow and builds up non-linearly while held', () => {
    expect(keyRate(t, 0)).toBeCloseTo(t.baseRate, 9);
    expect(keyRate(t, t.accelTime)).toBeCloseTo(t.maxRate, 9);
    expect(keyRate(t, 10)).toBeCloseTo(t.maxRate, 9);
    // Quadratic build-up: a quarter of the way at half the time.
    expect(keyRate(t, t.accelTime / 2) - t.baseRate).toBeCloseTo((t.maxRate - t.baseRate) / 4, 9);
    const first = stepKeyAxis(0, 1, 20, 1 / 60, t, 1 / 60);
    const late = stepKeyAxis(0, 1, 20, 1 / 60, t, 2);
    expect(first / late).toBeLessThan(0.25);
  });

  it('limits how far a key drives the control at high airspeed, but never moves a held position by itself', () => {
    const cruise = hold(600, 1, 60);
    expect(cruise).toBeCloseTo(keyAuthority(60, t), 6);
    expect(cruise).toBeLessThan(0.6);
    expect(keyAuthority(200, t)).toBe(t.minAuthority);
    // Full deflection set at low speed is held when the airspeed rises; the same key cannot add more,
    // the opposite key moves it back.
    expect(stepKeyAxis(0.9, 1, 60, 1 / 60, t, 1)).toBe(0.9);
    expect(stepKeyAxis(0.9, -1, 60, 1 / 60, t, 1)).toBeLessThan(0.9);
  });

  it('elevator authority falls with dynamic pressure (constant g per key), pushing is limited further', () => {
    expect(keyAuthority(e.fullAuthoritySpeed, e)).toBe(1);
    expect(keyAuthority(2 * e.fullAuthoritySpeed, e)).toBeCloseTo(0.25, 6);
    const push = hold(600, -1, 2 * e.fullAuthoritySpeed, e);
    expect(push).toBeCloseTo(-0.25 * e.negativeScale, 6);
    // A 0.1 s tap at 70 KIAS moves the elevator less than 1% of travel (fine corrections on final).
    const tap = hold(6, 1, 36, e);
    expect(tap).toBeGreaterThan(0.003);
    expect(tap).toBeLessThan(0.01);
  });

  it('moves back toward centre a little faster than away from it', () => {
    const out = stepKeyAxis(0.5, 1, 20, 0.1, t, 2) - 0.5;
    const back = 0.5 - stepKeyAxis(0.5, -1, 20, 0.1, t, 2);
    expect(back / out).toBeCloseTo(t.reverseGain, 6);
  });

  it('centres at a fixed rate (Numpad 5 / 5)', () => {
    let v = -1;
    let n = 0;
    while (v !== 0 && n < 100) {
      v = stepCentre(v, 1 / 60);
      n++;
    }
    expect(n / 60).toBeCloseTo(1 / CENTRE_RATE, 1);
  });

  it('does nothing with dt = 0 (paused)', () => {
    expect(stepKeyAxis(0.5, 1, 20, 0, t)).toBe(0.5);
    expect(stepKeyAxis(0.5, 0, 20, 0, t)).toBe(0.5);
    expect(stepCentre(0.5, 0)).toBe(0.5);
  });

  it('lever keys accelerate while held', () => {
    expect(leverRate(1, 0)).toBeCloseTo(0.25);
    expect(leverRate(1, 2)).toBeCloseTo(1);
  });

  it('brakes ramp rather than switch', () => {
    const b = stepBrake(0, true, 1 / 60);
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThan(0.2);
    // A 0.1 s tap is a gentle touch; holding reaches full braking in about half a second.
    expect(run(6, 1 / 60, (v) => stepBrake(v, true, 1 / 60))).toBeLessThan(0.25);
    expect(run(32, 1 / 60, (v) => stepBrake(v, true, 1 / 60))).toBe(1);
  });

  it('steps flaps between detents', () => {
    expect(nextFlapDetent(0, 1)).toBeCloseTo(1 / 3);
    expect(nextFlapDetent(1 / 3, 1)).toBeCloseTo(2 / 3);
    expect(nextFlapDetent(1, 1)).toBe(1);
    expect(nextFlapDetent(1, -1)).toBeCloseTo(2 / 3);
    expect(nextFlapDetent(0.5, -1)).toBeCloseTo(1 / 3);
    expect(nextFlapDetent(0, -1)).toBe(0);
  });
});

describe('axis conditioning', () => {
  it('dead zone rescales to full range', () => {
    expect(applyDeadzone(0.05, 0.1)).toBe(0);
    expect(applyDeadzone(1, 0.1)).toBe(1);
    expect(applyDeadzone(-0.55, 0.1)).toBeCloseTo(-0.5);
  });

  it('bipolar axis honours an off-centre rest and asymmetric range', () => {
    const c = { ...defaultCalibration(0, 0), min: -0.8, center: 0.1, max: 0.9 };
    expect(normalizeBipolar(0.1, c)).toBe(0);
    expect(normalizeBipolar(0.9, c)).toBe(1);
    expect(normalizeBipolar(-0.8, c)).toBe(-1);
    expect(normalizeBipolar(0.5, c)).toBeCloseTo(0.5);
    expect(normalizeBipolar(0.5, { ...c, invert: true })).toBeCloseTo(-0.5);
  });

  it('response curve softens the centre but keeps the ends', () => {
    const c = defaultCalibration(0, 0.5);
    expect(normalizeBipolar(1, c)).toBeCloseTo(1);
    expect(normalizeBipolar(0.3, c)).toBeLessThan(0.3);
  });

  it('lever axis maps to 0..1 with inversion and reachable ends', () => {
    const c = defaultCalibration(0.02, 0, true);
    expect(normalizeUnipolar(-1, c)).toBe(1); // lever fully forward reads -1 on most hardware
    expect(normalizeUnipolar(0.99, c)).toBe(0);
    expect(normalizeUnipolar(0, c)).toBeCloseTo(0.5);
  });

  it('auto-calibration widens the range', () => {
    const c = { ...defaultCalibration(), min: -0.5, max: 0.5 };
    expect(widenRange(c, 0.7)).toBe(true);
    expect(c.max).toBe(0.7);
    expect(widenRange(c, 0.2)).toBe(false);
  });

  it('motion detector ignores noise and reports real movement', () => {
    const m = new MotionDetector(0.04);
    expect(m.moved(0.5)).toBe(false);
    expect(m.moved(0.52)).toBe(false);
    expect(m.moved(0.6)).toBe(true);
    expect(m.moved(0.61)).toBe(false);
  });
});

describe('devices', () => {
  it('classifies common hardware', () => {
    expect(classifyDevice('Saitek Pro Flight Rudder Pedals (Vendor: 06a3 Product: 0763)', '')).toBe('pedals');
    expect(classifyDevice('Saitek Pro Flight Yoke (Vendor: 06a3 Product: 0bac)', '')).toBe('yoke');
    expect(classifyDevice('Honeycomb Alpha Flight Controls', '')).toBe('yoke');
    expect(classifyDevice('Saitek Pro Flight Throttle Quadrant', '')).toBe('throttle');
    expect(classifyDevice('Thrustmaster T.Flight Hotas X (Vendor: 044f)', '')).toBe('joystick');
    expect(classifyDevice('Xbox Wireless Controller (STANDARD GAMEPAD)', 'standard')).toBe('gamepad');
    expect(classifyDevice('Logitech Extreme 3D pro', '')).toBe('joystick');
  });

  it('default profiles cover the axes present', () => {
    const pedals = defaultProfile('pedals', 3);
    expect(pedals.axes.map((a) => a.control)).toEqual(['brakeLeft', 'brakeRight', 'rudder']);
    const pad = defaultProfile('gamepad', 4);
    expect(pad.axes[1].control).toBe('elevator');
    expect(pad.analogButtons.length).toBe(2);
    expect(defaultProfile('joystick', 6).axes.length).toBe(6);
    expect(defaultProfile('yoke', 2).axes.length).toBe(2);
  });
});

describe('source mixing', () => {
  it('hardware in use overrides keyboard and mouse', () => {
    expect(mixCentring(0.5, 0.2, -0.3)).toBe(-0.3);
    expect(mixCentring(0.5, 0.2, null)).toBeCloseTo(0.7);
    expect(mixCentring(0.9, 0.5, null)).toBe(1);
  });

  it('a hardware axis keeps ownership briefly after returning to centre', () => {
    const a = new Activity();
    a.sample(true, 10);
    a.sample(false, 10.1);
    expect(a.isActive(10.1)).toBe(true);
    expect(a.isActive(10 + AXIS_HOLD_TIME + 0.01)).toBe(false);
  });

  it('levers: last moved wins', () => {
    const o = new LeverOwner();
    expect(o.update(false, false)).toBe('keyboard');
    expect(o.update(false, true)).toBe('hardware');
    expect(o.update(false, false)).toBe('hardware');
    expect(o.update(true, false)).toBe('keyboard');
  });

  it('mouse yoke: centre is neutral, down is yoke back, full travel before the edge', () => {
    expect(mouseYokeDeflection(0, 0)).toEqual({ aileron: 0, elevator: 0 });
    expect(mouseYokeDeflection(0, 0.5).elevator).toBeGreaterThan(0);
    expect(mouseYokeDeflection(-0.85, 0).aileron).toBe(-1);
  });
});

describe('ground steering assist', () => {
  it('holds the heading the pilot left, freezes while the pilot steers, relaxes in the air', () => {
    const a = new GroundSteeringAssist();
    // A steady yaw disturbance: the assist builds up an opposing output and the heading error stays small.
    let hdg = 0;
    let r = 0;
    for (let i = 0; i < 600; i++) {
      const u = a.step(hdg, r, true, 20, false, 1 / 60);
      r = -0.3 * 0.2 + 0.3 * u; // needs u = +0.2 to cancel
      hdg += r / 60;
    }
    expect(a.value).toBeCloseTo(0.2, 2);
    expect(Math.abs(hdg)).toBeLessThan(0.03);
    // Pilot steering: output frozen.
    const frozen = a.value;
    a.step(hdg + 0.5, 0.3, true, 20, true, 1 / 60);
    expect(a.value).toBe(frozen);
    // Airborne: washes out.
    for (let i = 0; i < 600; i++) a.step(0, 0, false, 30, false, 1 / 60);
    expect(Math.abs(a.value)).toBeLessThan(0.01);
  });
});

describe('knob helpers', () => {
  it('wraps degrees into [0, 360)', () => {
    expect(wrapDegrees(-1)).toBe(359);
    expect(wrapDegrees(361)).toBe(1);
    expect(wrapDegrees(0)).toBe(0);
  });
});

describe('InputSystem: knobs and switches from the keyboard', () => {
  const tap = (r: Rig, code: string, shift = false, seconds = 0.05): void => {
    r.input.keyDown(code, shift);
    for (let t = 0; t < seconds; t += FRAME) r.input.update(FRAME, r.ctx);
    r.input.keyUp(code);
    r.input.update(FRAME, r.ctx);
  };

  it('heading bug, OBS and Kollsman: a tap turns one detent, holding turns quickly, values wrap / clamp', () => {
    const r = makeRig();
    const c = r.ctx.controls;
    c.headingBugDeg = 359;
    tap(r, 'KeyG');
    expect(c.headingBugDeg).toBe(0);
    tap(r, 'KeyG', true);
    expect(c.headingBugDeg).toBe(359);
    c.obsDeg = 90;
    tap(r, 'KeyU', false, 1.5);
    expect(c.obsDeg).toBeGreaterThan(110);
    c.kollsmanHpa = 1013.25;
    tap(r, 'KeyK');
    expect(c.kollsmanHpa).toBe(1014);
    c.kollsmanHpa = 1049;
    tap(r, 'KeyK', false, 3);
    expect(c.kollsmanHpa).toBe(1050);
  });

  it('DG align is momentary', () => {
    const r = makeRig();
    r.input.keyDown('KeyD');
    r.input.update(FRAME, r.ctx);
    expect(r.ctx.controls.dgAlign).toBe(true);
    r.input.keyUp('KeyD');
    r.input.update(FRAME, r.ctx);
    expect(r.ctx.controls.dgAlign).toBe(false);
  });

  it('master, alternator, avionics, fuel pump, fuel selector, pitot heat and panel lights', () => {
    const r = makeRig();
    const c = r.ctx.controls;
    Object.assign(c, { masterBattery: false, alternator: false, avionics: false, fuelPump: false, pitotHeat: false, fuelSelector: 'both' });
    tap(r, 'KeyW');
    expect(c.masterBattery && c.alternator).toBe(true);
    tap(r, 'KeyW', true);
    expect(c.alternator).toBe(false);
    expect(c.masterBattery).toBe(true);
    tap(r, 'KeyW');
    expect(c.masterBattery || c.alternator).toBe(false);
    tap(r, 'KeyW', true); // ALT on pulls BAT on with it
    expect(c.masterBattery && c.alternator).toBe(true);
    tap(r, 'KeyI');
    tap(r, 'KeyJ');
    tap(r, 'KeyI', true);
    expect(c.avionics && c.fuelPump && c.pitotHeat).toBe(true);
    const sel: string[] = [];
    for (let i = 0; i < 4; i++) {
      tap(r, 'KeyJ', true);
      sel.push(c.fuelSelector);
    }
    expect(sel).toEqual(['left', 'right', 'off', 'both']);
    c.lights.panel = 0.6;
    tap(r, 'Quote');
    expect(c.lights.panel).toBe(1);
    tap(r, 'Quote');
    expect(c.lights.panel).toBe(0);
  });

  it('a scenario reset recentres the keyboard and takes the trimmed yoke as neutral', () => {
    const r = makeRig({ turbulence: 0 });
    r.input.keyDown('ArrowLeft');
    for (let i = 0; i < 30; i++) r.input.update(FRAME, r.ctx);
    r.input.keyUp('ArrowLeft');
    r.physics.reset('downwind', r.weather);
    const trimmed = r.ctx.controls.rudder;
    r.ctx.events.emit('reset', { scenario: 'downwind' });
    r.input.update(FRAME, r.ctx);
    expect(r.ctx.controls.rudder).toBeCloseTo(trimmed, 6);
    expect(Math.abs(r.ctx.controls.aileron)).toBeLessThan(0.02);
  });
});

describe('InputSystem: hold-position keyboard yoke', () => {
  const run = (r: Rig, seconds: number): void => {
    for (let t = 0; t < seconds; t += FRAME) r.input.update(FRAME, r.ctx);
  };
  const flying = (): Rig => {
    const r = makeRig({ turbulence: 0 });
    r.physics.reset('downwind', r.weather);
    r.ctx.events.emit('reset', { scenario: 'downwind' });
    r.input.assists.rollTrim = false;
    return r;
  };

  it('arrows and rudder keys leave the controls where they are; Numpad 5 and 5 centre all three', () => {
    for (const centreKey of ['Numpad5', 'Digit5']) {
      const r = flying();
      const c = r.ctx.controls;
      const n = { aileron: c.aileron, elevator: c.elevator, rudder: c.rudder };
      for (const k of ['ArrowRight', 'ArrowDown', 'KeyX']) r.input.keyDown(k);
      run(r, 0.5);
      for (const k of ['ArrowRight', 'ArrowDown', 'KeyX']) r.input.keyUp(k);
      run(r, FRAME);
      const held = { aileron: c.aileron, elevator: c.elevator, rudder: c.rudder };
      expect(held.aileron - n.aileron).toBeGreaterThan(0.05);
      expect(held.elevator - n.elevator).toBeGreaterThan(0.01);
      expect(held.rudder - n.rudder).toBeGreaterThan(0.05);
      expect(r.input.getYokeIndicator().keyboardOffCentre).toBe(true);
      run(r, 3);
      expect(c.aileron).toBe(held.aileron);
      expect(c.elevator).toBe(held.elevator);
      expect(c.rudder).toBe(held.rudder);
      // The widget shows the commanded position.
      expect(r.input.getYokeIndicator().aileron).toBe(c.aileron);
      r.input.keyDown(centreKey);
      run(r, FRAME);
      r.input.keyUp(centreKey);
      // A quick glide, not a jump.
      expect(c.aileron).toBeGreaterThan(n.aileron);
      run(r, 0.3);
      expect(c.aileron).toBeCloseTo(n.aileron, 9);
      expect(c.elevator).toBeCloseTo(n.elevator, 9);
      expect(c.rudder).toBeCloseTo(n.rudder, 9);
      expect(r.input.getYokeIndicator().keyboardOffCentre).toBe(false);
    }
  });

  it('the view recentre key no longer touches the controls, and Numpad 5 no longer recentres the view', () => {
    let recentred = 0;
    const view = { recentre: () => void recentred++, zoom() {}, togglePointerLock() {} };
    const r = flying();
    const input = new InputSystem({ view });
    input.attach(r.ctx);
    input.keyDown('ArrowRight');
    run({ ...r, input }, 0.5);
    input.keyUp('ArrowRight');
    input.keyDown('Backspace');
    input.update(FRAME, r.ctx);
    input.keyUp('Backspace');
    const a = r.ctx.controls.aileron;
    input.keyDown('Numpad5');
    input.update(FRAME, r.ctx);
    input.keyUp('Numpad5');
    expect(recentred).toBe(1);
    expect(r.ctx.controls.aileron).toBeLessThan(a);
  });

  it('F5 / F6 step the flaps; the brakes stay hold-to-apply', () => {
    const r = makeRig();
    const c = r.ctx.controls;
    c.flaps = 0;
    const tap = (code: string): void => {
      r.input.keyDown(code);
      r.input.update(FRAME, r.ctx);
      r.input.keyUp(code);
      r.input.update(FRAME, r.ctx);
    };
    tap('F6');
    tap('F6');
    expect(c.flaps).toBeCloseTo(2 / 3);
    tap('F5');
    expect(c.flaps).toBeCloseTo(1 / 3);
    tap('KeyV');
    tap('KeyF');
    expect(c.flaps).toBeCloseTo(1 / 3);
    r.input.keyDown('KeyB');
    run(r, 1);
    expect(c.brakeLeft).toBe(1);
    r.input.keyUp('KeyB');
    run(r, 0.3);
    expect(c.brakeLeft).toBe(0);
  });

  it('the first roll key takes the aileron from the roll trim without a bump', () => {
    const r = makeRig({ turbulence: 0 });
    r.physics.reset('downwind', r.weather);
    r.ctx.events.emit('reset', { scenario: 'downwind' });
    const c = r.ctx.controls;
    // A roll disturbance the trim works against for a while (it only acts within 6 deg of bank).
    r.physics.renderState.angularVelocity.x = 0.02;
    for (let t = 0; t < 4; t += FRAME) {
      r.physics.renderState.angularVelocity.x = 0.02;
      r.input.update(FRAME, r.ctx);
    }
    const before = c.aileron;
    expect(Math.abs(before - (r.input as unknown as { neutral: { aileron: number } }).neutral.aileron)).toBeGreaterThan(0.01);
    r.input.keyDown('ArrowRight');
    r.input.update(FRAME, r.ctx);
    expect(c.aileron - before).toBeGreaterThan(0);
    expect(c.aileron - before).toBeLessThan(0.01);
  });

  it('the keyboard yoke follows a control another writer (the autopilot) moves, so a disconnect is bumpless', () => {
    const r = flying();
    const c = r.ctx.controls;
    run(r, FRAME);
    c.elevator = 0.2; // what the autopilot writes in the physics step
    c.aileron = -0.1;
    run(r, FRAME);
    expect(c.elevator).toBe(0.2);
    expect(c.aileron).toBe(-0.1);
    expect(r.input.getYokeIndicator().elevator).toBe(0.2);
    // The pilot takes over from there.
    r.input.keyDown('ArrowDown');
    run(r, FRAME);
    expect(c.elevator).toBeGreaterThan(0.2);
    expect(c.elevator).toBeLessThan(0.205);
  });
});

describe('InputSystem: keyboard look-around and pilot activity', () => {
  it('Shift+arrow pans the view through ViewControl.lookBy; a yoke key marks the pilot as flying', async () => {
    const looks: [number, number][] = [];
    const view = { recentre() {}, zoom() {}, togglePointerLock() {}, lookBy: (dx: number, dy: number) => void looks.push([dx, dy]) };
    const r = makeRig();
    const input = new InputSystem({ view });
    input.attach(r.ctx);
    input.keyDown('ArrowLeft', true);
    input.update(FRAME, r.ctx);
    await new Promise((res) => setTimeout(res, 20));
    input.update(FRAME, r.ctx);
    expect(looks.length).toBeGreaterThan(0);
    expect(looks.every(([dx, dy]) => dx < 0 && dy === 0)).toBe(true);
    expect(r.ctx.controls.aileron).toBe(0); // looking, not rolling
    expect(input.pilotFlying(1000)).toBe(false);
    input.keyUp('ArrowLeft');
    input.keyDown('ArrowLeft');
    input.update(FRAME, r.ctx);
    expect(input.pilotFlying(50)).toBe(true);
  });
});
