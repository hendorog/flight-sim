// Steering with the brakes on a type with a castering nosewheel: the differential-brake law, the toe brake of
// a foot on a pedal past half travel, and both in a closed loop with the real InputSystem on a synthetic
// castering aircraft (the pedals steer nothing; the brakes and, with airspeed, the rudder do). On the Cessna
// 172S profile none of it is reachable.

import { describe, expect, it } from 'vitest';
import { C172S_INPUT } from '../../src/aircraft/c172s/input';
import { RAD, clamp, wrapPi } from '../../src/core/math';
import type { InputProfile } from '../../src/input/profile';
import { DEFAULT_PEDAL_BRAKE_GAIN, DEFAULT_RUDDER_EFFECTIVE_SPEED, GroundSteeringAssist, differentialBrake } from '../../src/input/virtualYoke';
import { CASTER_INPUT, FRAME, makeInputRig, type InputRig } from './testbed';

const brakes = (base: number, demand: number): { left: number; right: number } => differentialBrake(base, demand, { left: 0, right: 0 });

describe('differential-brake law', () => {
  it('with the brakes off the demand is a plain toe brake on the inside of the correction', () => {
    expect(brakes(0, 0.3)).toEqual({ left: 0, right: 0.3 });
    expect(brakes(0, -0.3)).toEqual({ left: 0.3, right: 0 });
    expect(brakes(0, 0)).toEqual({ left: 0, right: 0 });
  });

  it('B held: the assist still steers, by releasing the outside brake', () => {
    // Both brakes full and a demand of 0.3 to the right: the right brake cannot go beyond 1, the left one comes
    // off by 0.3. The difference between the wheels is the same 0.3 as with the brakes off.
    const b = brakes(1, 0.3);
    expect(b.right).toBe(1);
    expect(b.left).toBeCloseTo(0.7, 12);
    expect(b.right - b.left).toBeCloseTo(brakes(0, 0.3).right - brakes(0, 0.3).left, 12);
    // Combining by maximum, as the pedal sources are, would leave no difference at all.
    expect(Math.max(1, 0.3) - Math.max(1, 0)).toBe(0);
    // Full demand lets the outside wheel roll free.
    expect(brakes(1, 1)).toEqual({ left: 0, right: 1 });
  });

  it('the wheel difference never falls short of the demand, at any symmetric brake', () => {
    for (let base = 0; base <= 1.0001; base += 0.125) {
      for (let d = -1; d <= 1.0001; d += 0.125) {
        const b = brakes(base, d);
        // Inside the stops the difference is demand x (1 + base) - it adds AND releases; never less than the
        // demand itself, and of its sign.
        const difference = b.right - b.left;
        expect(Math.abs(difference)).toBeGreaterThanOrEqual(Math.abs(d) - 1e-12);
        expect(difference * d).toBeGreaterThanOrEqual(0);
        expect(Math.min(b.left, b.right)).toBeGreaterThanOrEqual(0);
        expect(Math.max(b.left, b.right)).toBeLessThanOrEqual(1);
        // The pilot never gets MORE braking on the outside wheel than he applied.
        expect(d > 0 ? b.left : b.right).toBeLessThanOrEqual(base + 1e-12);
      }
    }
  });

  it('is mirror-symmetric: the opposite demand swaps the two brakes', () => {
    for (const [base, d] of [[0, 0.4], [0.5, 0.2], [1, 0.7], [0.3, 1]]) {
      const a = brakes(base, d);
      const m = brakes(base, -d);
      expect(m.left).toBe(a.right);
      expect(m.right).toBe(a.left);
    }
  });
});

describe('brake share and pedal brake of the steering assist', () => {
  const caster = (): GroundSteeringAssist => new GroundSteeringAssist(CASTER_INPUT.assists.steering);

  it('the brakes make up what the rudder lacks: rudder (V / Veff)^2 plus brake share is 1 up to Veff, then rudder alone', () => {
    const a = caster();
    const veff = CASTER_INPUT.assists.steering.rudderEffectiveSpeed!;
    expect(a.steersWithBrakes).toBe(true);
    expect(a.brakeShare(0)).toBe(1);
    expect(a.brakeShare(veff / 2)).toBeCloseTo(0.75, 12);
    for (let v = 0; v <= veff; v += 0.5) expect((v / veff) ** 2 + a.brakeShare(v)).toBeCloseTo(1, 12);
    for (const v of [veff, veff + 1, 60]) expect(a.brakeShare(v)).toBe(0);
  });

  it('the demand on the brakes is the output x brake gain x share, within [-1, 1]', () => {
    const a = new GroundSteeringAssist({ ...CASTER_INPUT.assists.steering, brakeGain: 2, limit: 0.45 });
    a.handover(0.3);
    expect(a.brakeDemand(0)).toBeCloseTo(0.6, 12);
    expect(a.brakeDemand(7.5)).toBeCloseTo(0.6 * 0.75, 12);
    expect(a.brakeDemand(15)).toBe(0);
    a.handover(-0.45);
    expect(a.brakeDemand(0)).toBeCloseTo(-0.9, 12);
    const strong = new GroundSteeringAssist({ ...CASTER_INPUT.assists.steering, brakeGain: 5, limit: 0.45 });
    strong.handover(0.45);
    expect(strong.brakeDemand(0)).toBe(1);
  });

  it('a pedal past half travel adds its toe brake in proportion, up to the pedal brake gain at the stop', () => {
    const a = caster();
    expect(a.pedalBrake(0.5, 0)).toBe(0);
    expect(a.pedalBrake(0.3, 0)).toBe(0);
    expect(a.pedalBrake(0.75, 0)).toBeCloseTo(0.25, 12);
    expect(a.pedalBrake(1, 0)).toBe(0.5);
    expect(a.pedalBrake(-1, 0)).toBe(-0.5);
    // It fades with airspeed like the assist's brake, and is gone where the rudder steers alone.
    expect(a.pedalBrake(1, 7.5)).toBeCloseTo(0.5 * 0.75, 12);
    expect(a.pedalBrake(1, 15)).toBe(0);
    expect(new GroundSteeringAssist({ ...CASTER_INPUT.assists.steering, pedalBrakeGain: 0.8 }).pedalBrake(1, 0)).toBe(0.8);
  });

  it('defaults: rudder alone from 15 m/s, pedal brake 0.5, brake gain 1', () => {
    const a = new GroundSteeringAssist({ ...C172S_INPUT.assists.steering, kind: 'differentialBrake' });
    expect(DEFAULT_RUDDER_EFFECTIVE_SPEED).toBe(15);
    expect(DEFAULT_PEDAL_BRAKE_GAIN).toBe(0.5);
    expect(a.brakeShare(7.5)).toBeCloseTo(0.75, 12);
    expect(a.pedalBrake(1, 0)).toBe(0.5);
    a.handover(0.2);
    expect(a.brakeDemand(0)).toBeCloseTo(0.2, 12);
  });

  it('a type steered by its pedals (the Cessna 172S) has neither', () => {
    const a = new GroundSteeringAssist();
    a.handover(0.4);
    expect(a.steersWithBrakes).toBe(false);
    expect(a.brakeShare(0)).toBe(0);
    expect(a.brakeDemand(0)).toBe(0);
    expect(a.pedalBrake(1, 0)).toBe(0);
  });
});

// ---- a synthetic castering aircraft --------------------------------------------------------------------------
//
// Yaw and speed on the ground of an aircraft like the DA20-C1 (800 kg; track 1.86 m, AFM; yaw inertia about
// 2400 kg m^2, Roskam's radius-of-gyration estimate): the nosewheel casters, so the pedals steer nothing.
//   brakes   each main wheel carries 45 % of the weight and brakes with a friction coefficient of 0.5 at full
//            pedal: 1766 N a wheel, 1642 N m of yaw per unit of brake difference
//   rudder   its moment grows with dynamic pressure; at RUDDER_SPEED (15 m/s) full rudder is worth full brake
//            difference
//   damping  the main tyres resist yaw: 400 N m per rad/s
// A disturbance moment stands for the weathercock of a crosswind (10 kt across at 15 m/s on the fin and
// fuselage is about 300 N m).
const MASS = 800;
const YAW_INERTIA = 2400;
const TRACK = 1.86;
const WHEEL_BRAKE = 0.5 * 0.45 * MASS * 9.81;
const BRAKE_MOMENT = (WHEEL_BRAKE * TRACK) / 2;
const RUDDER_SPEED = 15;
const YAW_DAMPING = 400;

interface Roll {
  /** Largest heading deviation, degrees. */
  worst: number;
  /** Heading change at the end, degrees (+ = right). */
  turned: number;
  /** Distance to the stop, m. */
  distance: number;
  seconds: number;
}

/** Roll the synthetic aircraft from `speed` until it stops (or `seconds`) with the keys of `keys` held. */
function roll(profile: InputProfile, speed: number, disturbance: number, keys: readonly string[], seconds = 30, thrust = 0): Roll {
  const r: InputRig = makeInputRig(profile);
  const { s, c } = r;
  const heading0 = s.heading;
  let yawRate = 0;
  let v = speed;
  let worst = 0;
  let distance = 0;
  let t = 0;
  s.groundSpeed = s.ias = s.tas = v;
  // The assist takes over (and holds the heading) on its first frames, before the keys go down.
  r.run(2 * FRAME);
  for (const k of keys) r.input.keyDown(k);
  for (; t < seconds && v > 0.3; t += FRAME) {
    r.input.update(FRAME, r.ctx);
    const q = clamp(v / RUDDER_SPEED, 0, 1) ** 2;
    const moment = (c.brakeRight - c.brakeLeft) * BRAKE_MOMENT + c.rudder * q * BRAKE_MOMENT + disturbance - YAW_DAMPING * yawRate;
    yawRate += (moment / YAW_INERTIA) * FRAME;
    s.heading = wrapPi(s.heading + yawRate * FRAME);
    v = Math.max(0, v + ((thrust - (c.brakeLeft + c.brakeRight) * WHEEL_BRAKE) / MASS) * FRAME);
    distance += v * FRAME;
    s.angularVelocity.z = yawRate;
    s.groundSpeed = s.ias = s.tas = v;
    worst = Math.max(worst, Math.abs(wrapPi(s.heading - heading0)) * RAD);
  }
  return { worst, turned: wrapPi(s.heading - heading0) * RAD, distance, seconds: t };
}

describe('brake steering in a closed loop on a synthetic castering aircraft', { timeout: 20_000 }, () => {
  /** Heading error at which the assist's proportional term alone balances 300 N m, degrees. */
  const DROOP = (300 / BRAKE_MOMENT / CASTER_INPUT.assists.steering.kp) * RAD;
  /** The same aircraft flown with a profile that steers by rudder only (what a castering type had before). */
  const RUDDER_ONLY: InputProfile = { ...CASTER_INPUT, assists: { ...CASTER_INPUT.assists, steering: { ...CASTER_INPUT.assists.steering, kind: 'rudder' } } };

  it('roll-out with B held in a crosswind: the assist holds the heading by releasing a brake; without the law the aircraft swings', () => {
    const steered = roll(CASTER_INPUT, 20, 300, ['KeyB']);
    const unsteered = roll(RUDDER_ONLY, 20, 300, ['KeyB']);
    console.log('[input] castering roll-out, B held, 300 N m: with the brake law', steered, 'rudder only', unsteered);
    // Both stop: 20 m/s at up to 0.45 g is 45 m and about 4.5 s; the brake law gives up a little of it.
    expect(steered.seconds).toBeLessThan(8);
    expect(unsteered.seconds).toBeLessThan(8);
    // The heading error stays inside the proportional droop of the assist (the demand that balances the
    // crosswind, 300 / 1642 = 0.18, over its gain of 3 per rad: 3.5 degrees) and is worked off by its integral.
    expect(steered.worst).toBeLessThan(DROOP);
    expect(Math.abs(steered.turned)).toBeLessThan(1);
    // The rudder dies with the airspeed (a ninth of its power at 5 m/s) and both brakes are full: nothing
    // opposes the crosswind over the last seconds.
    expect(unsteered.worst).toBeGreaterThan(3 * DROOP);
    // Steering costs little stopping distance: one brake is eased by the demand, never both.
    expect(steered.distance).toBeLessThan(unsteered.distance * 1.15);
  });

  it('coasting at 6 m/s in the same crosswind, brakes off: the assist adds a toe brake on one side', () => {
    // At 6 m/s the rudder has 16 % of its power: 0.45 of it is worth 118 N m against 300.
    const steered = roll(CASTER_INPUT, 6, 300, [], 5);
    const unsteered = roll(RUDDER_ONLY, 6, 300, [], 5);
    console.log('[input] castering, coasting at 6 m/s, 300 N m, 5 s: with the brake law', steered, 'rudder only', unsteered);
    expect(steered.worst).toBeLessThan(DROOP);
    expect(Math.abs(steered.turned)).toBeLessThan(1);
    expect(unsteered.worst).toBeGreaterThan(10 * DROOP);
    // The brake that steers also slows the aircraft a little; without it nothing does.
    expect(steered.distance).toBeLessThan(unsteered.distance);
    expect(unsteered.distance).toBeCloseTo(6 * unsteered.seconds, 9);
  });

  it('mirror: the opposite crosswind gives the mirrored track', () => {
    const right = roll(CASTER_INPUT, 20, 300, ['KeyB']);
    const left = roll(CASTER_INPUT, 20, -300, ['KeyB']);
    expect(left.turned).toBeCloseTo(-right.turned, 9);
    expect(left.worst).toBeCloseTo(right.worst, 9);
    expect(left.distance).toBeCloseTo(right.distance, 9);
  });

  it('taxi: the rudder keys steer through the toe brake of the pedal; the pedal alone hardly does', () => {
    // 3 m/s held by a little power, the right rudder key held for 4 s.
    const withBrake = roll(CASTER_INPUT, 3, 0, ['KeyX'], 4, WHEEL_BRAKE * 0.5);
    const pedalOnly = roll(RUDDER_ONLY, 3, 0, ['KeyX'], 4, 0);
    console.log('[input] castering taxi turn, right rudder key 4 s: with the pedal brake', withBrake.turned, 'deg, rudder only', pedalOnly.turned, 'deg');
    expect(withBrake.turned).toBeGreaterThan(45);
    // The rudder at 3 m/s has 4 % of its power at 15 m/s.
    expect(pedalOnly.turned).toBeGreaterThan(0);
    expect(pedalOnly.turned).toBeLessThan(withBrake.turned / 5);
    // And to the left.
    expect(roll(CASTER_INPUT, 3, 0, ['KeyZ'], 4, WHEEL_BRAKE * 0.5).turned).toBeCloseTo(-withBrake.turned, 9);
  });
});

describe('InputSystem: brakes of a castering type', () => {
  it('B held with a heading error: one brake eases; in the air, and on the Cessna 172S, the brakes are the keys alone', () => {
    const r = makeInputRig(CASTER_INPUT);
    r.s.groundSpeed = r.s.ias = 8;
    r.run(2 * FRAME);
    r.input.keyDown('KeyB');
    // The nose has swung 3 degrees left of the heading the assist holds: it wants the nose right.
    r.s.heading -= 3 / RAD;
    r.run(1);
    expect(r.c.brakeRight).toBe(1);
    expect(r.c.brakeLeft).toBeLessThan(0.95);
    expect(r.c.brakeLeft).toBeGreaterThan(0);
    expect(r.c.rudder).toBeGreaterThan(0);
    // Airborne: no weight on the wheels, nothing to steer with.
    r.setAirborne(true);
    r.run(FRAME);
    expect([r.c.brakeLeft, r.c.brakeRight]).toEqual([1, 1]);
    // The Cessna 172S in the same situation: both brakes as held, the rudder alone steers.
    const cessna = makeInputRig(C172S_INPUT);
    cessna.s.groundSpeed = cessna.s.ias = 8;
    cessna.run(2 * FRAME);
    cessna.input.keyDown('KeyB');
    cessna.s.heading -= 3 / RAD;
    cessna.run(1);
    expect([cessna.c.brakeLeft, cessna.c.brakeRight]).toEqual([1, 1]);
    expect(cessna.c.rudder).toBeGreaterThan(0);
    // Its rudder keys never touch the brakes.
    cessna.input.keyUp('KeyB');
    cessna.tap('KeyX', false, 3);
    expect(cessna.c.rudder).toBe(1);
    expect([cessna.c.brakeLeft, cessna.c.brakeRight]).toEqual([0, 0]);
  });

  it('a toe-brake key of the pilot stays on top of the law, and freezes the assist as on every type', () => {
    const r = makeInputRig(CASTER_INPUT);
    r.s.groundSpeed = r.s.ias = 8;
    r.run(2 * FRAME);
    r.input.keyDown('Comma'); // left toe brake
    r.run(1);
    expect(r.c.brakeLeft).toBe(1);
    expect(r.c.brakeRight).toBe(0);
    // The heading moves under the pilot's brake: the assist does not fight it.
    r.s.heading -= 10 / RAD;
    r.run(0.5);
    expect(r.c.brakeRight).toBe(0);
    expect(r.c.rudder).toBe(0);
  });

  it('with the auto-rudder off the pedal brake still works: the feet are the pilot`s', () => {
    const r = makeInputRig(CASTER_INPUT);
    r.input.assists.groundSteering = false;
    r.s.groundSpeed = r.s.ias = 3;
    r.tap('KeyZ', false, 3);
    expect(r.c.rudder).toBe(-1);
    // The keyboard rudder's own brake (the assist's law within its authority, 0.45) plus the foot's past half
    // travel (0.5), both faded by the brake share at 3 m/s (review Bm F2).
    expect(r.c.brakeLeft).toBeCloseTo((0.45 + 0.5) * (1 - (3 / 15) ** 2), 12);
    expect(r.c.brakeRight).toBe(0);
  });
});

// ---- review Bm F2 / F3: the hand-overs between the assist and the pilot ----------------------------------------
//
// At taxi speed the brakes do nearly all the steering (96 % at 3 m/s). Whoever has the pedals, the brakes must not
// jump when they change hands: the first rudder key press, Numpad 5 on the roll, a toe-brake key of the pilot.

describe('hand-overs of the brake steering (review Bm F2, F3)', () => {
  /** The assist holding a correction to the right at `speed`: the nose 6 degrees left of the held heading. */
  const correcting = (speed: number, degrees = 6): InputRig => {
    const r = makeInputRig(CASTER_INPUT);
    r.s.groundSpeed = r.s.ias = speed;
    r.run(0.1);
    r.s.heading -= degrees / RAD;
    r.run(1.5);
    return r;
  };
  const brakes = (r: InputRig): [number, number] => [r.c.brakeLeft, r.c.brakeRight];

  it('the first rudder key press takes the brake over with the rudder: no step in either brake', () => {
    for (const speed of [3, 8]) {
      for (const key of ['KeyX', 'KeyZ']) {
        const r = correcting(speed);
        const before = brakes(r);
        expect(before[1]).toBeGreaterThan(0.1);
        r.input.keyDown(key);
        r.run(FRAME);
        const after = brakes(r);
        console.log(`[input] first ${key} at ${speed} m/s: brakes ${before.map((b) => b.toFixed(3))} -> ${after.map((b) => b.toFixed(3))}`);
        expect(Math.abs(after[0] - before[0])).toBeLessThan(0.02);
        expect(Math.abs(after[1] - before[1])).toBeLessThan(0.02);
        // Let go: the keyboard rudder stays where it was left, and so does its brake.
        r.input.keyUp(key);
        r.run(FRAME);
        const held = brakes(r);
        r.run(1);
        expect(brakes(r)).toEqual(held);
      }
    }
  });

  it('Numpad 5 on the roll hands the held rudder AND its brake to the assist: no step in either brake', () => {
    for (const speed of [9, 12]) {
      for (const [key, sign] of [['KeyX', 1], ['KeyZ', -1]] as const) {
        const r = makeInputRig(CASTER_INPUT);
        r.s.groundSpeed = r.s.ias = speed;
        r.run(0.1);
        r.input.keyDown(key);
        while (Math.abs(r.c.rudder) < 0.4) r.run(FRAME);
        r.input.keyUp(key);
        r.run(FRAME);
        const before = brakes(r);
        expect(sign > 0 ? before[1] : before[0]).toBeGreaterThan(0.1);
        r.tap('Numpad5');
        const after = brakes(r);
        console.log(`[input] Numpad 5 at ${speed} m/s, rudder ${sign * 0.4}: brakes ${before.map((b) => b.toFixed(3))} -> ${after.map((b) => b.toFixed(3))}`);
        expect(r.c.rudder * sign).toBeGreaterThan(0.39);
        expect(Math.abs(after[0] - before[0])).toBeLessThan(0.02);
        expect(Math.abs(after[1] - before[1])).toBeLessThan(0.02);
      }
    }
  });

  it('the keyboard rudder brakes as the assist does within its authority, and the foot adds its toe brake past half travel', () => {
    const a = new GroundSteeringAssist(CASTER_INPUT.assists.steering);
    const r = makeInputRig(CASTER_INPUT);
    r.input.assists.groundSteering = false;
    r.s.groundSpeed = r.s.ias = 3;
    r.run(FRAME);
    let previous = 0;
    r.input.keyDown('KeyX');
    for (let i = 0; i < 120; i++) {
      r.run(FRAME);
      const rudder = r.c.rudder;
      const expected = clamp(clamp(rudder, -a.limit, a.limit) * a.brakeShare(3) + a.pedalBrake(rudder, 3), -1, 1);
      expect(r.c.brakeRight).toBeCloseTo(expected, 12);
      expect(r.c.brakeLeft).toBe(0);
      // It only ever grows while the key is held.
      expect(r.c.brakeRight).toBeGreaterThanOrEqual(previous);
      previous = r.c.brakeRight;
    }
    expect(r.c.rudder).toBe(1);
  });

  it('a toe brake of the pilot against the assist: the assist`s brake comes off, smoothly, and comes back when he lets go', () => {
    for (const speed of [3, 5]) {
      const r = correcting(speed, 4);
      expect(r.c.brakeRight).toBeGreaterThan(0.2);
      r.input.keyDown('Comma'); // the pilot turns left
      const start = r.c.brakeRight;
      let previous = start;
      let worstStep = 0;
      for (let i = 0; i < 40; i++) {
        r.run(FRAME);
        // (until his brake difference passes 0.05 the assist still runs, and may add a trace)
        expect(r.c.brakeRight).toBeLessThanOrEqual(start + 0.005);
        worstStep = Math.max(worstStep, previous - r.c.brakeRight);
        previous = r.c.brakeRight;
      }
      console.log(`[input] left toe brake against the assist at ${speed} m/s: brakes ${brakes(r).map((b) => b.toFixed(3))}, largest release per frame ${worstStep.toFixed(3)}`);
      expect(r.c.brakeLeft).toBe(1);
      expect(r.c.brakeRight).toBe(0);
      expect(worstStep).toBeLessThanOrEqual(6 * FRAME + 1e-12);
      // He lets go: the left brake comes off at the key's release rate and the assist's brake goes back on gently.
      r.input.keyUp('Comma');
      previous = r.c.brakeRight;
      for (let i = 0; i < 60; i++) {
        r.run(FRAME);
        expect(Math.abs(r.c.brakeRight - previous)).toBeLessThanOrEqual(2 * FRAME + 0.02);
        previous = r.c.brakeRight;
      }
      expect(r.c.brakeRight).toBeGreaterThan(0.1);
    }
  });

  it('a toe brake of the pilot on the side the assist already brakes: no dip, his brake takes over from the assist`s', () => {
    const r = correcting(3, 4);
    const start = r.c.brakeRight;
    expect(start).toBeGreaterThan(0.2);
    r.input.keyDown('Period');
    let previous = start;
    for (let i = 0; i < 40; i++) {
      r.run(FRAME);
      expect(r.c.brakeRight).toBeGreaterThanOrEqual(previous - 0.02);
      previous = r.c.brakeRight;
    }
    expect(r.c.brakeRight).toBe(1);
    expect(r.c.brakeLeft).toBe(0);
  });
});
