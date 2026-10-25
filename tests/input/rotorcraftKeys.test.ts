// The new rotorcraft keys (plan revision 2 section 5, T12): the Bo 105's overhead power levers on the engine-select
// keys (OFF - IDLE - FLIGHT per engine), ENGINE TRIM fore/aft and left/right; on a wheeled pusher helicopter (the
// AH-56A's shape, synthetic here: AG builds its profile) the propeller grip on the propeller keys with its snaps and
// the governor beep on the shifted pair, the tail-wheel lock, the gear lever, the wheel brakes, and the re-centring
// keyboard cyclic of a rate-command control gyro. Every key is checked to do nothing on a type without it.
import { describe, expect, it } from 'vitest';
import { BO105_INPUT } from '../../src/aircraft/bo105/input';
import { C172S_INPUT } from '../../src/aircraft/c172s/input';
import { MD500_INPUT } from '../../src/aircraft/md500/input';
import { actionForKey, keyBindingsFor, profileHasAction, type InputAction } from '../../src/input/bindings';
import { CENTRING_MOUSE_DEADZONE, PROP_GRIP_RATE, nextSnap } from '../../src/input/InputSystem';
import { mouseYokeDeflection } from '../../src/input/mixer';
import type { InputProfile } from '../../src/input/profile';
import type { RotorcraftState } from '../../src/physics/rotorcraft/definition';
import { FRAME, makeInputRig, type InputRig } from './testbed';

/** Hold a key (with Shift or not) for `s` seconds, then let it go. */
function hold(r: InputRig, code: string, s: number, shift = false): void {
  r.input.keyDown(code, shift);
  r.run(s);
  r.input.keyUp(code);
  r.run(FRAME);
}
const IDLE = BO105_INPUT.twistGrip!.groundIdle;
const engineThrottle = (r: InputRig, i: number): number => r.c.engines[i]?.throttle ?? r.c.throttle;

/**
 * A wheeled pusher helicopter with a rate-command control gyro (the AH-56A's shape): the propeller keys turn the pusher
 * grip (detent and the three snaps as lever positions), the beep on the shifted pair, a lockable tail wheel, a gear
 * lever, toe and parking brakes, the re-centring keyboard cyclic, spring trim. One engine.
 */
const SNAPS = [0.35, 0.8, 0] as const;
const PUSHER_HELI_INPUT: InputProfile = {
  ...MD500_INPUT,
  propLever: { detent: 0.35, snaps: SNAPS },
  tailWheelLock: true,
  gearLever: true,
  wheelBrakes: true,
  centringCyclic: true,
};

/** The Bo 105 profile without the MD 500E's twist-grip label overrides the S0 stub still carries (BO's input.ts drops
 *  them: contract request), so the help shows the power-lever texts. */
const { throttleDown: _d, throttleUp: _u, throttleIdle: _i, throttleFull: _f, ...BO105_LABELS } = BO105_INPUT.labels ?? {};
const BO105_LEVERS: InputProfile = { ...BO105_INPUT, labels: BO105_LABELS };

describe('Bo 105 overhead power levers on the engine-select keys (OFF - IDLE - FLIGHT)', () => {
  it('9 then F1: engine 2 to IDLE, engine 1 stays at FLIGHT; Shift+F1 OFF (on the ground); F3 out of OFF onto IDLE; F4 FLIGHT; 8 / 0 likewise', () => {
    const r = makeInputRig(BO105_INPUT, { throttle: 1 });
    r.tap('Digit9');
    r.tap('F1');
    expect(engineThrottle(r, 1)).toBe(IDLE); expect(engineThrottle(r, 0)).toBe(1);
    hold(r, 'F2', 1);
    expect(engineThrottle(r, 1)).toBe(IDLE);
    r.tap('F1', true);
    expect(engineThrottle(r, 1)).toBe(0); expect(engineThrottle(r, 0)).toBe(1);
    r.tap('F3');
    expect(engineThrottle(r, 1)).toBeGreaterThanOrEqual(IDLE);
    r.tap('F4');
    expect(engineThrottle(r, 1)).toBe(1);
    r.tap('Digit8');
    r.tap('F1');
    expect(engineThrottle(r, 0)).toBe(IDLE); expect(engineThrottle(r, 1)).toBe(1);
    r.tap('Digit0');
    r.tap('F4');
    expect([engineThrottle(r, 0), engineThrottle(r, 1)]).toEqual([1, 1]);
  });

  it('in the air, OFF wants one lever selected: Shift+F1 with both selected does nothing and says so; with 9 it cuts engine 2 only', () => {
    const r = makeInputRig(BO105_INPUT, { throttle: 1 });
    r.setAirborne(true);
    r.tap('F1', true);
    expect([engineThrottle(r, 0), engineThrottle(r, 1)]).toEqual([1, 1]);
    expect(r.toasts.at(-1)).toMatch(/Select an engine/);
    r.tap('Digit9');
    r.tap('F1', true);
    expect([engineThrottle(r, 0), engineThrottle(r, 1)]).toEqual([1, 0]);
  });

  it('lists the levers as power levers in the help', () => {
    const rows = keyBindingsFor(BO105_LEVERS);
    expect(rows.find((b) => b.keys === 'Shift+F1')?.action).toMatch(/Power lever to OFF/);
    expect(rows.find((b) => b.keys.startsWith('F1'))?.action).toMatch(/IDLE/);
    expect(rows.find((b) => b.keys === 'F4')?.action).toMatch(/FLIGHT/);
    expect(rows.find((b) => b.keys === '9')?.action).toMatch(/RIGHT power lever/);
  });
});

describe("ENGINE TRIM (Bo 105): fore/aft on ; / ', left/right on Shift+, / Shift+.", () => {
  it("Shift+, / Shift+. drive n2BeepSplit -1 / +1 while held, 0 when let go; ; / ' the common beep", () => {
    const r = makeInputRig(BO105_INPUT);
    r.input.keyDown('Comma', true); r.run(0.2);
    expect(r.c.n2BeepSplit).toBe(-1);
    r.input.keyUp('Comma'); r.run(FRAME);
    expect(r.c.n2BeepSplit).toBe(0);
    r.input.keyDown('Period', true); r.run(0.2);
    expect(r.c.n2BeepSplit).toBe(1);
    r.input.keyUp('Period'); r.run(FRAME);
    expect(r.c.n2BeepSplit).toBe(0);
    r.input.keyDown('Quote'); r.run(0.2);
    expect(r.c.n2Beep).toBe(1); expect(r.c.n2BeepSplit).toBe(0);
    r.input.keyUp('Quote'); r.run(FRAME);
    const rows = keyBindingsFor(BO105_INPUT);
    expect(rows.find((b) => b.keys === 'Shift+,')?.action).toMatch(/ENGINE TRIM left/);
    expect(rows.find((b) => b.keys === 'Shift+.')?.action).toMatch(/ENGINE TRIM right/);
    expect(rows.find((b) => b.keys === ';')?.action).toMatch(/ENGINE TRIM aft/);
  });

  it('Shift+, stays the left toe brake on an aeroplane (the shift-agnostic binding), and does nothing on the MD 500E', () => {
    expect(actionForKey('Comma', true, C172S_INPUT)).toBe('brakeLeft');
    expect(actionForKey('Period', true, C172S_INPUT)).toBe('brakeRight');
    expect(actionForKey('Comma', true, BO105_INPUT)).toBe('engineTrimLeft');
    const a = makeInputRig(C172S_INPUT);
    a.input.keyDown('Comma', true); a.run(0.5);
    expect(a.c.brakeLeft).toBeGreaterThan(0);
    a.input.keyUp('Comma');
    const m = makeInputRig(MD500_INPUT);
    m.input.keyDown('Comma', true); m.run(0.3);
    expect(m.c.n2BeepSplit ?? 0).toBe(0); expect(m.c.brakeLeft).toBe(0);
    expect(profileHasAction(MD500_INPUT, 'engineTrimLeft')).toBe(false);
    expect(keyBindingsFor(C172S_INPUT).some((b) => b.keys.includes('Shift+,'))).toBe(false);
  });

  it('the brakes stay hidden on a helicopter on skids (Bo 105, MD 500E)', () => {
    for (const p of [BO105_INPUT, MD500_INPUT]) for (const a of ['brakes', 'brakeLeft', 'brakeRight', 'parkingBrake'] as InputAction[]) expect(profileHasAction(p, a)).toBe(false);
  });
});

describe('a wheeled pusher helicopter (propLever, tailWheelLock, gearLever, wheelBrakes)', () => {
  it("; / ' turn the propeller grip (a tap 0.02, held at PROP_GRIP_RATE), not the beep", () => {
    const r = makeInputRig(PUSHER_HELI_INPUT);
    r.c.propLever = 0.35;
    // A tap: the press's 0.02 and one frame held.
    r.tap('Quote');
    expect(r.c.propLever).toBeCloseTo(0.37 + PROP_GRIP_RATE * FRAME, 9);
    const before = r.c.propLever!;
    hold(r, 'Semicolon', 1);
    expect(r.c.propLever).toBeCloseTo(before - 0.02 - PROP_GRIP_RATE, 2);
    expect(r.c.n2Beep ?? 0).toBe(0);
    hold(r, 'Semicolon', 10);
    expect(r.c.propLever).toBe(0);
    hold(r, 'Quote', 10);
    expect(r.c.propLever).toBe(1);
  });

  it('Shift+/ steps the grip through its snaps (hover detent, autorotation, full reverse), from anywhere to the first', () => {
    const r = makeInputRig(PUSHER_HELI_INPUT);
    r.c.propLever = 0.6;
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) { r.tap('Slash', true); seen.push(r.c.propLever!); }
    expect(seen).toEqual([0.35, 0.8, 0, 0.35]);
    expect(nextSnap(0.8, SNAPS)).toBe(0);
    expect(keyBindingsFor(PUSHER_HELI_INPUT).find((b) => b.keys === 'Shift+/')?.action).toMatch(/snap/);
    // An aeroplane's Shift+/ is still carburettor heat.
    expect(actionForKey('Slash', true, C172S_INPUT)).toBe('carbHeat');
  });

  it('the governor beep moves to Shift+, / Shift+. (held), no ENGINE TRIM split on one engine', () => {
    const r = makeInputRig(PUSHER_HELI_INPUT);
    r.input.keyDown('Comma', true); r.run(0.2);
    expect(r.c.n2Beep).toBe(-1); expect(r.c.n2BeepSplit).toBeUndefined();
    r.input.keyUp('Comma'); r.run(FRAME);
    r.input.keyDown('Period', true); r.run(0.2);
    expect(r.c.n2Beep).toBe(1);
    r.input.keyUp('Period'); r.run(FRAME);
    expect(r.c.n2Beep).toBe(0);
    const rows = keyBindingsFor(PUSHER_HELI_INPUT);
    expect(rows.find((b) => b.keys === 'Shift+,')?.action).toMatch(/beep \(RPM SET\) DECR/);
    expect(rows.find((b) => b.keys === ';')?.action).toMatch(/Propeller grip back/);
  });

  it("Shift+' toggles the tail-wheel lock; F7 / Shift+F7 the gear lever; B / Shift+B the brakes (wheelBrakes)", () => {
    const r = makeInputRig(PUSHER_HELI_INPUT);
    r.tap('Quote', true);
    expect(r.c.tailWheelLock).toBe(true);
    r.tap('Quote', true);
    expect(r.c.tailWheelLock).toBe(false);
    r.tap('F7', true);
    expect(r.c.gearLever).toBe('up');
    r.tap('F7');
    expect(r.c.gearLever).toBe('down');
    r.input.keyDown('KeyB'); r.run(0.5);
    expect(r.c.brakeLeft).toBeGreaterThan(0); expect(r.c.brakeRight).toBeGreaterThan(0);
    r.input.keyUp('KeyB'); r.run(FRAME);
    const parked = r.c.parkingBrake;
    r.tap('KeyB', true);
    expect(r.c.parkingBrake).toBe(!parked);
    const rows = keyBindingsFor(PUSHER_HELI_INPUT);
    expect(rows.find((b) => b.keys === "Shift+'")?.action).toMatch(/Tail-wheel lock/);
    expect(rows.some((b) => b.action === 'Landing gear lever UP')).toBe(true);
    expect(rows.some((b) => b.category === 'Brakes' && /Both brakes/.test(b.action))).toBe(true);
    // None of them on the Bo 105 (skids, no tail wheel, no gear lever).
    for (const a of ['tailWheelLock', 'gearUp', 'gearDown', 'propLeverSnap'] as InputAction[]) expect(profileHasAction(BO105_INPUT, a)).toBe(false);
    const b = makeInputRig(BO105_INPUT);
    b.tap('Quote', true); b.tap('F7', true);
    expect(b.c.tailWheelLock).toBeUndefined(); expect(b.c.gearLever).toBe('down');
  });
});

describe('the pusher grip trim-schedule assist (InputAssists.propSchedule, off by default)', () => {
  const SCHEDULED: InputProfile = { ...PUSHER_HELI_INPUT, propLever: { ...PUSHER_HELI_INPUT.propLever!, schedule: { kias: [0, 100, 200], lever: [0.35, 0.6, 0.9] } } };
  it('off by default: the grip stays where it is; on: it follows the schedule with airspeed until a propeller key is touched', () => {
    const off = makeInputRig(SCHEDULED);
    off.c.propLever = 0.35; off.s.ias = 150 * 0.514444;
    off.run(0.2);
    expect(off.c.propLever).toBe(0.35);
    const r = makeInputRig(SCHEDULED);
    r.input.assists.propSchedule = true;
    r.c.propLever = 0.35; r.s.ias = 150 * 0.514444;
    r.run(0.2);
    expect(r.c.propLever).toBeCloseTo(0.75, 3);
    r.tap('Semicolon');
    const touched = r.c.propLever!;
    r.s.ias = 50 * 0.514444;
    r.run(0.5);
    expect(r.c.propLever).toBe(touched);
    // A reset hands the grip back to the assist.
    r.ctx.events.emit('reset', { scenario: 'runway' });
    r.run(0.2);
    expect(r.c.propLever).toBeCloseTo(0.475, 3);
  });
});

describe('re-centring keyboard cyclic (InputProfile.centringCyclic)', () => {
  it('a 0.3 s cyclic tap returns to the trim anchor at the Numpad 5 rate once the key is let go; the anchor follows the spring trim', () => {
    const r = makeInputRig(PUSHER_HELI_INPUT, { aileron: 0, elevator: 0 });
    const a0 = r.c.aileron, e0 = r.c.elevator;
    r.input.keyDown('ArrowRight'); r.run(0.3);
    const deflected = r.c.aileron;
    r.input.keyUp('ArrowRight');
    r.run(0.5);
    expect(deflected).toBeGreaterThan(a0 + 0.01);
    expect(r.c.aileron).toBe(a0);
    hold(r, 'ArrowDown', 0.3);
    r.run(0.5);
    expect(r.c.elevator).toBe(e0);
    // The spring-trim anchor moves (the trim motor's state): the stick comes back to the new anchor.
    r.s.rotorcraft = { springTrim: { pitch: 0.1, roll: -0.05, pitchForce: 0, rollForce: 0 } } as RotorcraftState;
    r.run(FRAME);
    hold(r, 'ArrowRight', 0.3);
    r.run(0.5);
    expect(r.c.aileron).toBeCloseTo(a0 - 0.05, 12);
  });

  it('a position-command cyclic (the Bo 105, MD 500E) stays where the tap left it', () => {
    const r = makeInputRig(BO105_INPUT, { aileron: 0 });
    hold(r, 'ArrowRight', 0.3);
    const after = r.c.aileron;
    r.run(1);
    expect(after).toBeGreaterThan(0.01);
    expect(r.c.aileron).toBe(after);
  });

  it('the mouse yoke rests in a 0.03 deadzone on a re-centring cyclic without its own tuning', () => {
    expect(CENTRING_MOUSE_DEADZONE).toBe(0.03);
    const tuning = { expo: 0.3, deadzone: CENTRING_MOUSE_DEADZONE };
    expect(mouseYokeDeflection(0.02, -0.02, tuning)).toEqual({ aileron: 0, elevator: -0 });
    expect(mouseYokeDeflection(0.02, 0).aileron).toBeGreaterThan(0);
  });
});

describe('the new actions are documented', () => {
  it('every new action has a key and a help row on a type that has it', () => {
    const rows = [...keyBindingsFor(BO105_INPUT), ...keyBindingsFor(PUSHER_HELI_INPUT)];
    for (const keys of ['Shift+,', 'Shift+.', 'Shift+/', "Shift+'", 'Shift+F1', 'F7']) expect(rows.some((b) => b.keys.split(' / ').includes(keys))).toBe(true);
  });
});
