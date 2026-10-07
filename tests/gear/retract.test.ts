// The retraction system (src/physics/gear/retract.ts RetractActuator) stepped at the physics rate with
// prescribed inputs: transit times, sequencing, the pump's voltage, the squat switch, emergency free fall,
// sag without up-locks, the lights and the horn. The two systems are the PA-34 and DA42 data of testbed.ts;
// the source of each number is given where it is asserted.

import { describe, expect, test } from 'vitest';
import type { GearLever, GearState } from '../../src/core/types';
import { RetractActuator, SQUAT_DELAY, type RetractConfig, type RetractInput } from '../../src/physics/gear';
import { DT } from './rig';
import { DA42_RETRACT, PA34_RETRACT } from './testbed';

/** In flight, bus alive, throttles open, flaps up, selector down. */
const FLYING: RetractInput = { lever: 'down', emergency: false, busVoltage: 28, weightOnWheels: false, minThrottle: 0.7, flapLever: 0, onGround: false };
const PARKED: RetractInput = { ...FLYING, weightOnWheels: true, onGround: true };

/** Step until `done` (or `limit` seconds); returns the time taken, s. */
function until(a: RetractActuator, input: RetractInput, done: (s: GearState) => boolean, limit = 120): number {
  let steps = 0;
  while (!done(a.state) && steps * DT < limit) {
    a.update(DT, input);
    steps++;
  }
  return steps * DT;
}

function run(a: RetractActuator, input: RetractInput, seconds: number): GearState {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) a.update(DT, input);
  return a.state;
}

const allUp = (s: GearState) => s.extension.every((e) => e === 0);
const allLocked = (s: GearState) => s.locked.every(Boolean);
/** A gear that has been retracted in flight. */
function retracted(cfg: RetractConfig): RetractActuator {
  const a = new RetractActuator(cfg);
  a.reset(false);
  return a;
}

describe('transit', () => {
  test('lever to up and lever to locked take the configured times, linearly', () => {
    // PA-34: 6 to 7 s either way (handbook); DA42: extension 6 to 10 s (AFM 7.5).
    for (const [name, cfg, band] of [['PA-34', PA34_RETRACT, [6, 7]], ['DA42', DA42_RETRACT, [6, 10]]] as const) {
      const a = new RetractActuator(cfg);
      expect(a.state).toEqual({ retractable: true, lever: 'down', extension: [1, 1, 1], locked: [true, true, true], inTransit: false, warning: false });
      const up = until(a, { ...FLYING, lever: 'up' }, allUp);
      const down = until(a, FLYING, allLocked);
      console.log(`[retract] ${name}: up in ${up.toFixed(3)} s, down and locked in ${down.toFixed(3)} s`);
      expect(Math.abs(up - cfg.retractTime)).toBeLessThanOrEqual(DT);
      expect(Math.abs(down - cfg.extendTime)).toBeLessThanOrEqual(DT);
      expect(up).toBeGreaterThanOrEqual(band[0]);
      expect(down).toBeLessThanOrEqual(band[1]);

      a.reset(true);
      const half = run(a, { ...FLYING, lever: 'up' }, cfg.retractTime / 2);
      for (const e of half.extension) expect(e).toBeCloseTo(0.5, 9);
    }
  });

  test('retraction and extension may take different times', () => {
    const a = new RetractActuator({ ...PA34_RETRACT, extendTime: 5, retractTime: 9 });
    expect(until(a, { ...FLYING, lever: 'up' }, allUp)).toBeCloseTo(9, 1);
    expect(until(a, FLYING, allLocked)).toBeCloseTo(5, 1);
  });

  test('the lights: greens go out as the legs unlock, red while in transit, three greens only when locked', () => {
    const a = new RetractActuator(PA34_RETRACT);
    const s = a.update(DT, { ...FLYING, lever: 'up' });
    expect(s.lever).toBe('up');
    expect(s.locked).toEqual([false, false, false]);
    expect(s.inTransit).toBe(true);
    run(a, { ...FLYING, lever: 'up' }, 3);
    expect(s.inTransit).toBe(true);
    until(a, { ...FLYING, lever: 'up' }, allUp);
    expect(s.inTransit).toBe(false);
    expect(s.locked).toEqual([false, false, false]);

    // Reversed in mid-travel, the legs come back from where they are.
    run(a, FLYING, 2);
    const e = s.extension[0];
    expect(e).toBeCloseTo(2 / PA34_RETRACT.extendTime, 6);
    run(a, { ...FLYING, lever: 'up' }, 1);
    expect(s.extension[0]).toBeCloseTo(e - 1 / PA34_RETRACT.retractTime, 6);
    expect(s.inTransit).toBe(true);
    until(a, FLYING, allLocked);
    expect(s.inTransit).toBe(false);
    expect(s.extension).toEqual([1, 1, 1]);
  });

  test('a leg with a delay starts that long after the pump and locks that much later', () => {
    const cfg: RetractConfig = { ...PA34_RETRACT, legDelay: [0, 0.5, 1.5] };
    const a = retracted(cfg);
    run(a, FLYING, 0.5 - 2 * DT);
    expect(a.state.extension[0]).toBeGreaterThan(0);
    expect(a.state.extension[1]).toBe(0);
    run(a, FLYING, 1);
    expect(a.state.extension[1]).toBeGreaterThan(0);
    expect(a.state.extension[2]).toBe(0);
    const locked: number[] = [NaN, NaN, NaN];
    let t = 1.5 - 2 * DT;
    while (!allLocked(a.state)) {
      a.update(DT, FLYING);
      t += DT;
      a.state.locked.forEach((l, k) => {
        if (l && Number.isNaN(locked[k])) locked[k] = t;
      });
    }
    for (let k = 0; k < 3; k++) expect(Math.abs(locked[k] - (cfg.extendTime + cfg.legDelay![k]))).toBeLessThanOrEqual(2 * DT);
    expect(a.state.inTransit).toBe(false);
  });

  test('update() changes the one state object in place', () => {
    const a = new RetractActuator(DA42_RETRACT);
    const { state } = a;
    const { extension, locked } = state;
    expect(a.update(DT, { ...FLYING, lever: 'up' })).toBe(state);
    run(a, { ...FLYING, lever: 'up' }, 3);
    expect(a.state).toBe(state);
    expect(a.state.extension).toBe(extension);
    expect(a.state.locked).toBe(locked);
    a.reset(true);
    expect(a.state.extension).toBe(extension);
    expect(extension).toEqual([1, 1, 1]);
  });
});

describe('pump and squat switch', () => {
  test('the pump needs its bus voltage; with up-locks the legs wait where they are', () => {
    const cfg: RetractConfig = { ...PA34_RETRACT, upLocks: true };
    const a = new RetractActuator(cfg);
    run(a, { ...FLYING, lever: 'up' }, 2);
    const e = a.state.extension[1];
    run(a, { ...FLYING, lever: 'up', busVoltage: cfg.minBusVolts - 0.01 }, 30);
    expect(a.state.extension).toEqual([e, e, e]);
    expect(a.state.inTransit).toBe(true);
    // Exactly at the threshold it runs again and finishes the retraction in the time that was left.
    const rest = until(a, { ...FLYING, lever: 'up', busVoltage: cfg.minBusVolts }, allUp);
    expect(rest).toBeCloseTo(cfg.retractTime - 2, 1);
    // Up and locked up, a dead bus changes nothing.
    run(a, { ...FLYING, lever: 'up', busVoltage: 0 }, 60);
    expect(a.state.extension).toEqual([0, 0, 0]);
  });

  test('the squat switch holds the gear down on the ground with the selector UP; it retracts at lift-off', () => {
    const a = new RetractActuator(PA34_RETRACT);
    const s = run(a, { ...PARKED, lever: 'up' }, 20);
    expect(s.extension).toEqual([1, 1, 1]);
    expect(s.locked).toEqual([true, true, true]);
    // Red light and horn: the gear does not agree with the selector (PA-34 from s/n 34-7250046).
    expect(s.inTransit).toBe(true);
    expect(s.warning).toBe(true);
    // The switch opens at lift-off; the legs go once it has stayed open SQUAT_DELAY (review Bm F5).
    const up = until(a, { ...FLYING, lever: 'up' }, allUp);
    expect(up).toBeCloseTo(SQUAT_DELAY + PA34_RETRACT.retractTime, 1);

    // Without the inhibit the same selection retracts the gear on the ground.
    const b = new RetractActuator({ ...PA34_RETRACT, squatInhibit: false });
    run(b, { ...PARKED, lever: 'up' }, 1);
    expect(b.state.extension[0]).toBeCloseTo(1 - 1 / PA34_RETRACT.retractTime, 6);
  });

  test('a bounce does not unlock the gear: the squat switch must stay open SQUAT_DELAY before a retraction starts (review Bm F5)', () => {
    // Selector UP on the take-off roll; the mains leave the ground for one sub-step, then for 0.08 s (a 2 mm bump).
    for (const open of [DT, 0.08, SQUAT_DELAY - 2 * DT]) {
      const a = new RetractActuator(PA34_RETRACT);
      run(a, { ...PARKED, lever: 'up' }, 1);
      run(a, { ...FLYING, lever: 'up' }, open);
      run(a, { ...PARKED, lever: 'up' }, 1);
      expect(a.state.extension).toEqual([1, 1, 1]);
      expect(a.state.locked).toEqual([true, true, true]);
    }
    // A lift-off: the legs go after the delay, and take the configured time from then.
    const a = new RetractActuator(PA34_RETRACT);
    run(a, { ...PARKED, lever: 'up' }, 1);
    expect(Math.abs(until(a, { ...FLYING, lever: 'up' }, (s) => !s.locked[0]) - SQUAT_DELAY)).toBeLessThanOrEqual(1.5 * DT);
    // In flight the switch has been open long since: a selection there is not delayed (fresh, reset or restored).
    const b = new RetractActuator(PA34_RETRACT);
    b.reset(true);
    expect(until(b, { ...FLYING, lever: 'up' }, (s) => !s.locked[0])).toBeCloseTo(DT, 9);
    // Without the inhibit there is nothing to wait for.
    const c = new RetractActuator({ ...PA34_RETRACT, squatInhibit: false });
    run(c, { ...PARKED, lever: 'up' }, DT);
    expect(c.state.locked[0]).toBe(false);
  });

  test('the squat switch does not stop an extension', () => {
    const a = retracted(PA34_RETRACT);
    expect(until(a, PARKED, allLocked)).toBeCloseTo(PA34_RETRACT.extendTime, 1);
  });
});

describe('emergency extension', () => {
  test('all legs fall together in the free-fall time with a dead bus and the selector still UP', () => {
    // DA42: "emergency extension up to 20 s" (AFM 3.9.2); its free-fall time is 15 s.
    const cfg: RetractConfig = { ...DA42_RETRACT, upLocks: true, legDelay: [0, 1, 2] };
    const a = retracted(cfg);
    const dead: RetractInput = { ...FLYING, lever: 'up', busVoltage: 0 };
    run(a, dead, 5);
    expect(a.state.extension).toEqual([0, 0, 0]);
    run(a, { ...dead, emergency: true }, 3);
    const [n, l, r] = a.state.extension;
    expect(n).toBeCloseTo(3 / cfg.emergency.freeFallTime, 6);
    expect(l).toBe(n);
    expect(r).toBe(n);
    const fall = 3 + until(a, { ...dead, emergency: true }, allLocked);
    console.log(`[retract] free fall: locked after ${fall.toFixed(3)} s`);
    expect(Math.abs(fall - cfg.emergency.freeFallTime)).toBeLessThanOrEqual(DT);
    expect(fall).toBeLessThanOrEqual(20);
    // Three greens; the red light stays on because the selector is still UP.
    expect(a.state.locked).toEqual([true, true, true]);
    expect(a.state.inTransit).toBe(true);
    a.update(DT, { ...dead, lever: 'down', emergency: true });
    expect(a.state.inTransit).toBe(false);
  });

  test('the pressure stays dumped: the gear cannot be retracted again until reset()', () => {
    const a = retracted(PA34_RETRACT);
    a.update(DT, { ...FLYING, lever: 'up', emergency: true });
    // Knob pushed back in, bus alive, selector UP: the legs keep falling and stay down.
    const fall = DT + until(a, { ...FLYING, lever: 'up' }, allLocked);
    expect(fall).toBeCloseTo(PA34_RETRACT.emergency.freeFallTime, 1);
    run(a, { ...FLYING, lever: 'up' }, 20);
    expect(a.state.extension).toEqual([1, 1, 1]);
    expect(a.capture().emergency).toBe(true);
    a.reset(true);
    expect(a.capture().emergency).toBe(false);
    expect(until(a, { ...FLYING, lever: 'up' }, allUp)).toBeCloseTo(PA34_RETRACT.retractTime, 1);
  });

  test('free fall overrides a retraction in progress and the squat switch', () => {
    const a = new RetractActuator(PA34_RETRACT);
    run(a, { ...FLYING, lever: 'up' }, 3);
    const e = a.state.extension[0];
    run(a, { ...FLYING, lever: 'up', emergency: true }, 1);
    expect(a.state.extension[0]).toBeCloseTo(e + 1 / PA34_RETRACT.emergency.freeFallTime, 6);
  });
});

describe('dead bus without up-locks', () => {
  const dead: RetractInput = { ...FLYING, lever: 'up', busVoltage: 0 };

  test('DA42: with the electrical master off the gear extends slowly and locks', () => {
    // AFM 3.8 note. "Slowly" is the configuration's deadBusSagTime (25 s here, against 8 s under power).
    const a = retracted(DA42_RETRACT);
    const sag = until(a, dead, allLocked);
    console.log(`[retract] DA42 dead-bus sag: locked after ${sag.toFixed(3)} s`);
    expect(Math.abs(sag - DA42_RETRACT.deadBusSagTime!)).toBeLessThanOrEqual(DT);
    expect(sag).toBeGreaterThan(DA42_RETRACT.extendTime);
    // Down on its spring-loaded locks it stays, with the red light for the selector that is still UP.
    run(a, dead, 30);
    expect(a.state.locked).toEqual([true, true, true]);
    expect(a.state.inTransit).toBe(true);
  });

  test('without a sag time the legs come down at the free-fall rate', () => {
    const cfg: RetractConfig = { ...DA42_RETRACT, deadBusSagTime: undefined };
    const a = retracted(cfg);
    expect(Math.abs(until(a, dead, allLocked) - cfg.emergency.freeFallTime)).toBeLessThanOrEqual(DT);
  });

  test('PA-34: the pressure stays trapped (sag time Infinity) and nothing moves; the knob still drops the gear', () => {
    const a = retracted(PA34_RETRACT);
    run(a, dead, 120);
    expect(a.state.extension).toEqual([0, 0, 0]);
    expect(a.state.inTransit).toBe(false);
    const fall = until(a, { ...dead, emergency: true }, allLocked);
    expect(Math.abs(fall - PA34_RETRACT.emergency.freeFallTime)).toBeLessThanOrEqual(DT);
  });

  test('the sag only ever lowers the legs, and the pump takes them up again when the bus returns', () => {
    const a = retracted(DA42_RETRACT);
    run(a, dead, 10);
    const sagged = a.state.extension[0];
    expect(sagged).toBeCloseTo(10 / DA42_RETRACT.deadBusSagTime!, 6);
    // Selector DOWN with the bus dead: the legs keep coming down at the sag rate, no faster.
    run(a, { ...dead, lever: 'down' }, 5);
    expect(a.state.extension[0]).toBeCloseTo(15 / DA42_RETRACT.deadBusSagTime!, 6);
    const up = until(a, { ...FLYING, lever: 'up' }, allUp);
    expect(up).toBeCloseTo(DA42_RETRACT.retractTime * (15 / DA42_RETRACT.deadBusSagTime!), 1);
  });
});

describe('warning horn', () => {
  /** Horn with the gear up, for the throttle / power levers of the two engines. */
  const horn = (cfg: RetractConfig, levers: readonly number[], flapLever = 0) =>
    retracted(cfg).update(DT, { ...FLYING, lever: 'up', minThrottle: Math.min(...levers), flapLever }).warning;

  test('gear up and the LOWEST lever of any engine below the microswitch position', () => {
    // PA-34: the microswitch position is that of 14 inHg at sea level and 2000 rpm (0.3 on this test-bed).
    expect(horn(PA34_RETRACT, [0.7, 0.7])).toBe(false);
    expect(horn(PA34_RETRACT, [0.31, 0.31])).toBe(false);
    expect(horn(PA34_RETRACT, [0.29, 0.29])).toBe(true);
    // Identify / verify drill: the dead engine's lever closed, the live engine at full throttle.
    expect(horn(PA34_RETRACT, [0, 1])).toBe(true);
    expect(horn(PA34_RETRACT, [1, 0])).toBe(true);
    // DA42: either power lever below about 20 % (AFM 7.5).
    expect(horn(DA42_RETRACT, [0.25, 0.25])).toBe(false);
    expect(horn(DA42_RETRACT, [0.15, 0.9])).toBe(true);
  });

  test('there is no manifold-pressure, rpm or bus input: the levers alone decide', () => {
    const a = retracted(PA34_RETRACT);
    for (const busVoltage of [0, 14, 28]) {
      expect(a.update(DT, { ...FLYING, lever: 'up', busVoltage, minThrottle: 0.1 }).warning).toBe(true);
      expect(a.update(DT, { ...FLYING, lever: 'up', busVoltage, minThrottle: 0.9 }).warning).toBe(false);
    }
  });

  test('silent with three greens, sounding for any leg that is not locked', () => {
    const a = new RetractActuator(PA34_RETRACT);
    const closed: RetractInput = { ...FLYING, minThrottle: 0 };
    expect(a.update(DT, closed).warning).toBe(false);
    // Selected up and back down: it sounds through the whole transit and stops at the third green.
    run(a, { ...closed, lever: 'up' }, 2);
    expect(a.state.warning).toBe(true);
    let sounding = 0;
    const t = until(a, closed, (s) => {
      if (s.warning) sounding += DT;
      return allLocked(s);
    });
    expect(a.state.warning).toBe(false);
    expect(sounding).toBeCloseTo(t, 6);
  });

  test('landing flap with the gear up, where the type has that switch', () => {
    // DA42: flaps LDG (lever 1). The PA-34 has no flap switch in its warning.
    expect(horn(DA42_RETRACT, [0.6, 0.6], 0.5)).toBe(false);
    expect(horn(DA42_RETRACT, [0.6, 0.6], 1)).toBe(true);
    expect(horn(PA34_RETRACT, [0.6, 0.6], 1)).toBe(false);
    const down = new RetractActuator(DA42_RETRACT);
    expect(down.update(DT, { ...FLYING, flapLever: 1, minThrottle: 0 }).warning).toBe(false);
  });

  test('selector UP on the ground, where the type has that switch', () => {
    const on = new RetractActuator(PA34_RETRACT);
    expect(on.update(DT, { ...PARKED, lever: 'up', minThrottle: 1 }).warning).toBe(true);
    expect(on.update(DT, { ...PARKED, lever: 'down', minThrottle: 1 }).warning).toBe(false);
    const off = new RetractActuator({ ...PA34_RETRACT, warning: { ...PA34_RETRACT.warning, leverUpOnGround: false } });
    expect(off.update(DT, { ...PARKED, lever: 'up', minThrottle: 1 }).warning).toBe(false);
  });
});

describe('state', () => {
  test('capture and restore carry the legs and the dumped pressure; the motion continues identically', () => {
    const input: RetractInput = { ...FLYING, lever: 'up' };
    const a = new RetractActuator(DA42_RETRACT);
    run(a, input, 3);
    const snapshot = a.capture();
    expect(snapshot).toEqual({ extension: [a.state.extension[0], a.state.extension[1], a.state.extension[2]], emergency: false });
    expect(snapshot.extension).not.toBe(a.state.extension);
    run(a, input, 2);

    const b = new RetractActuator(DA42_RETRACT);
    b.restore(snapshot);
    expect(b.state.locked).toEqual([false, false, false]);
    run(b, input, 2);
    expect(b.state).toEqual(a.state);

    const c = new RetractActuator(DA42_RETRACT);
    c.restore({ extension: [0, 0, 0], emergency: true });
    run(c, { ...input, busVoltage: 0 }, DA42_RETRACT.emergency.freeFallTime + 1);
    expect(c.state.locked).toEqual([true, true, true]);
  });

  test('restored in mid-transit, legs with a delay carry on where they were: the delays are not served twice (review Bm F4)', () => {
    // The snapshot holds the legs, not the pump's running time; the delays already served follow from the legs.
    const cfg: RetractConfig = { ...DA42_RETRACT, legDelay: [0, 0.5, 1.0] };
    for (const [lever, start, seconds] of [['up', true, 2], ['up', true, 0.3], ['down', false, 2], ['down', false, 0.7]] as const) {
      const input: RetractInput = { ...FLYING, lever };
      const a = new RetractActuator(cfg);
      a.reset(start);
      run(a, input, seconds);
      const b = new RetractActuator(cfg);
      b.restore(a.capture());
      run(a, input, 0.6);
      run(b, input, 0.6);
      console.log(`[retract] restore with delays, ${lever} after ${seconds} s: ${a.state.extension.map((e) => e.toFixed(3))} / restored ${b.state.extension.map((e) => e.toFixed(3))}`);
      for (let k = 0; k < 3; k++) expect(b.state.extension[k]).toBeCloseTo(a.state.extension[k], 6);
      // ...and to the stops at the same moment.
      const left = until(a, input, lever === 'up' ? allUp : allLocked);
      expect(until(b, input, lever === 'up' ? allUp : allLocked)).toBeCloseTo(left, 6);
    }
  });

  test('whatever is done to it, each leg stays within its stops and the greens mean locked', () => {
    // 60 s of random selections, bus failures and landings, with the knob pulled somewhere in the last 20 s (fixed seed).
    let seed = 12345;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (const cfg of [PA34_RETRACT, DA42_RETRACT, { ...DA42_RETRACT, upLocks: true, legDelay: [0, 0.4, 0.8] as const }]) {
      const a = new RetractActuator(cfg);
      let lever: GearLever = 'down';
      let busVoltage = 28;
      let emergency = false;
      let weightOnWheels = false;
      const fastest = DT / Math.min(cfg.extendTime, cfg.retractTime, cfg.emergency.freeFallTime);
      const faults: string[] = [];
      let moved = false;
      for (let i = 0; i < 60 / DT; i++) {
        if (random() < 0.004) lever = lever === 'down' ? 'up' : 'down';
        if (random() < 0.002) busVoltage = busVoltage > 0 ? 0 : 28;
        if (i * DT > 40 && random() < 0.001) emergency = true;
        if (random() < 0.002) weightOnWheels = !weightOnWheels;
        const before = [...a.state.extension];
        const s = a.update(DT, { ...FLYING, lever, busVoltage, emergency, weightOnWheels, onGround: weightOnWheels });
        for (let k = 0; k < 3; k++) {
          const e = s.extension[k];
          if (!(e >= 0 && e <= 1)) faults.push(`step ${i}: leg ${k} at ${e}`);
          if (s.locked[k] !== (e === 1)) faults.push(`step ${i}: green ${k} with the leg at ${e}`);
          // No leg ever moves faster than the quickest of its rates, and none retracts without the pump.
          if (Math.abs(e - before[k]) > fastest + 1e-9) faults.push(`step ${i}: leg ${k} jumped`);
          if ((busVoltage < cfg.minBusVolts || emergency) && e < before[k]) faults.push(`step ${i}: leg ${k} retracted without the pump`);
        }
        if (s.inTransit !== s.extension.some((e) => e !== (lever === 'down' ? 1 : 0))) faults.push(`step ${i}: red light`);
        moved ||= s.extension[0] !== before[0];
      }
      expect(faults).toEqual([]);
      expect(moved).toBe(true);
    }
  });
});
