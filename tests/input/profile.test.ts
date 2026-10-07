// The input profile of an aircraft type (InputSystemOptions.profile, src/input/profile.ts). The default is the
// Cessna 172S, whose numbers every other test in this directory flies with; here a profile with OTHER numbers
// moves exactly what it names: the flap detents, the fuel selector cycle, the key axis tuning and the assists,
// and the help listing.

import { describe, expect, it } from 'vitest';
import { C172S_INPUT } from '../../src/aircraft/c172s/input';
import { DEG } from '../../src/core/math';
import type { FuelSelector } from '../../src/core/types';
import { KEY_BINDINGS, keyBindingsFor } from '../../src/input/bindings';
import { InputSystem } from '../../src/input/InputSystem';
import type { InputProfile, KeyboardAssistTuning } from '../../src/input/profile';
import { GroundSteeringAssist, RollTrimAssist, RotationGuard, keyAuthority, nextFlapDetent } from '../../src/input/virtualYoke';
import { FRAME, frame, makeRig, type Rig } from './keyboardPilot';

const withAssists = (patch: Partial<KeyboardAssistTuning>): InputProfile => ({ ...C172S_INPUT, assists: { ...C172S_INPUT.assists, ...patch } });

/** A rig whose input system is built for `profile` (the rig's own one is left idle). */
function rigFor(profile: InputProfile | undefined, scenario: 'runway' | 'downwind' = 'runway'): Rig {
  const r = makeRig({ turbulence: 0, windSpeedKt: 0 });
  if (scenario !== 'runway') r.physics.reset(scenario, r.weather);
  const input = new InputSystem(profile ? { profile } : {});
  input.attach(r.ctx);
  input.assists.rollTrim = false;
  return { ...r, input };
}

/** The input system alone, for a number of frames: the aircraft state stays as it is. */
const frames = (r: Rig, n: number): void => {
  for (let i = 0; i < n; i++) r.input.update(FRAME, r.ctx);
};
const run = (r: Rig, seconds: number): void => frames(r, Math.round(seconds / FRAME));

const hold = (r: Rig, code: string, seconds: number, shift = false): void => {
  r.input.keyDown(code, shift);
  run(r, seconds);
  r.input.keyUp(code);
  run(r, FRAME);
};

describe('input profile: the default is the Cessna 172S', () => {
  it('an input system given C172S_INPUT writes the same controls as one given nothing', () => {
    const a = rigFor(undefined);
    const b = rigFor(C172S_INPUT);
    // [pressed at, for, key, with Shift]: parking brake off, flaps 10, full throttle, the tank selector; a rudder key
    // on the roll and the hand-over; the rotation; a roll, centring, a push.
    const script: [number, number, string, boolean][] = [
      [0, FRAME, 'KeyB', true],
      [0.1, FRAME, 'F6', false],
      [0.2, FRAME, 'F4', false],
      [0.3, FRAME, 'KeyJ', true],
      [8, 0.45, 'KeyX', false],
      [8.6, FRAME, 'Numpad5', false],
      [21, 2.5, 'ArrowDown', false],
      [27, 0.5, 'ArrowLeft', false],
      [27.8, FRAME, 'Digit5', false],
      [28, 0.4, 'ArrowUp', false],
    ];
    for (let t = 0, n = 0; t < 30; t += FRAME, n++) {
      for (const [at, duration, code, shift] of script) {
        const down = t >= at && t < at + duration;
        for (const r of [a, b]) {
          if (down) r.input.keyDown(code, shift);
          else r.input.keyUp(code);
        }
      }
      frame(a);
      frame(b);
      const ca = a.ctx.controls;
      const cb = b.ctx.controls;
      for (const k of ['aileron', 'elevator', 'rudder', 'throttle', 'flaps', 'fuelSelector', 'feetOffRudder', 'parkingBrake'] as const) {
        if (ca[k] !== cb[k]) throw new Error(`frame ${n}: ${k} ${String(ca[k])} / ${String(cb[k])}`);
      }
    }
    // The script did fly: off the ground, flaps and selector moved.
    expect(a.physics.renderState.wheels.some((w) => w.onGround)).toBe(false);
    expect(a.ctx.controls.flaps).toBeCloseTo(1 / 3, 12);
    expect(a.ctx.controls.fuelSelector).toBe('left');
  }, 60_000);

  it('the static help listing is the listing of the Cessna 172S', () => {
    expect(keyBindingsFor(C172S_INPUT)).toEqual(KEY_BINDINGS);
    expect(keyBindingsFor(C172S_INPUT)).not.toBe(KEY_BINDINGS);
  });

  it('the assists built without a tuning carry the Cessna 172S limits', () => {
    expect(new GroundSteeringAssist().limit).toBe(GroundSteeringAssist.LIMIT);
    expect(new GroundSteeringAssist(C172S_INPUT.assists.steering).limit).toBe(0.45);
  });
});

describe('input profile: flap detents and fuel selector', () => {
  it('nextFlapDetent steps through the detents it is given', () => {
    const detents = [0, 0.25, 0.625, 1];
    expect(nextFlapDetent(0, 1, detents)).toBe(0.25);
    expect(nextFlapDetent(0.25, 1, detents)).toBe(0.625);
    expect(nextFlapDetent(0.3, 1, detents)).toBe(0.625);
    expect(nextFlapDetent(1, 1, detents)).toBe(1);
    expect(nextFlapDetent(1, -1, detents)).toBe(0.625);
    expect(nextFlapDetent(0.3, -1, detents)).toBe(0.25);
    expect(nextFlapDetent(0, -1, detents)).toBe(0);
    // Without a list: the Cessna 172S thirds, as before.
    expect(nextFlapDetent(0.3, 1)).toBe(1 / 3);
    expect(nextFlapDetent(0.3, 1, C172S_INPUT.flapDetents)).toBe(1 / 3);
  });

  it('the flap keys step through the detents of the profile', () => {
    const r = rigFor({ ...C172S_INPUT, flapDetents: [0, 0.25, 0.625, 1] });
    const c = r.ctx.controls;
    const seen: number[] = [];
    for (const code of ['F6', 'F6', 'F6', 'F6', 'F5', 'F5', 'F5', 'F5']) {
      hold(r, code, FRAME);
      seen.push(c.flaps);
    }
    expect(seen).toEqual([0.25, 0.625, 1, 1, 0.625, 0.25, 0, 0]);
  });

  it('the fuel selector key cycles through the positions of the profile', () => {
    const cycle: FuelSelector[] = ['left', 'right', 'off'];
    const r = rigFor({ ...C172S_INPUT, fuelSelectorCycle: cycle });
    const c = r.ctx.controls;
    const seen: FuelSelector[] = [];
    // BOTH is not a position of this selector: the first press goes to the first one.
    expect(c.fuelSelector).toBe('both');
    for (let i = 0; i < 5; i++) {
      hold(r, 'KeyJ', FRAME, true);
      seen.push(c.fuelSelector);
    }
    expect(seen).toEqual(['left', 'right', 'off', 'left', 'right']);
  });
});

describe('input profile: key axis tuning and assists', () => {
  it('a held key runs to the authority limit of the profile axis', () => {
    const aileron = { ...C172S_INPUT.assists.axes.aileron, fullAuthoritySpeed: 12, minAuthority: 0.1 };
    const r = rigFor(withAssists({ axes: { ...C172S_INPUT.assists.axes, aileron } }), 'downwind');
    const d = rigFor(undefined, 'downwind');
    const ias = r.physics.renderState.ias;
    for (const rig of [r, d]) {
      const neutral = rig.ctx.controls.aileron;
      hold(rig, 'ArrowRight', 4);
      const tuning = rig === r ? aileron : C172S_INPUT.assists.axes.aileron;
      expect(rig.ctx.controls.aileron - neutral).toBeCloseTo(keyAuthority(ias, tuning), 9);
    }
    expect(keyAuthority(ias, aileron)).toBeLessThan(0.5 * keyAuthority(ias, C172S_INPUT.assists.axes.aileron));
  });

  it('on the mains the elevator keys move at the ground rate of the profile', () => {
    const moved = (profile: InputProfile | undefined): number => {
      const r = rigFor(profile);
      const neutral = r.ctx.controls.elevator;
      hold(r, 'ArrowDown', 0.5);
      return r.ctx.controls.elevator - neutral;
    };
    const standard = moved(undefined);
    expect(standard).toBeGreaterThan(0.01);
    expect(moved(withAssists({ groundElevatorRate: 0.3 })) / standard).toBeCloseTo(0.5, 9);
  });

  it('the soft g stops are those of the profile', () => {
    const eased = (profile: InputProfile | undefined): number => {
      const r = rigFor(profile, 'downwind');
      hold(r, 'ArrowDown', 2);
      const before = r.ctx.controls.elevator;
      r.physics.renderState.gLoad = 1.8;
      frames(r, 30);
      return before - r.ctx.controls.elevator;
    };
    // 1.8 g is inside the Cessna 172S stop (2.2) and 0.3 g beyond a stop at 1.5: 0.6 of travel per second per g.
    expect(eased(undefined)).toBe(0);
    expect(eased(withAssists({ gStops: { pull: 1.5, push: 0.35 } }))).toBeCloseTo(0.3 * 0.6 * 30 * FRAME, 9);
  });

  it('Numpad 5 on the roll hands the rudder over above the hand-over speed and within the steering limit of the profile', () => {
    const centred = (profile: InputProfile | undefined): { held: number; after: number } => {
      const r = rigFor(profile);
      const s = r.physics.renderState;
      const neutral = r.ctx.controls.rudder;
      s.groundSpeed = 12;
      hold(r, 'KeyX', 0.4);
      const held = r.ctx.controls.rudder - neutral;
      hold(r, 'Numpad5', FRAME);
      run(r, 0.4);
      return { held, after: r.ctx.controls.rudder - neutral };
    };
    // The Cessna 172S: 12 m/s is above 8 m/s, so the auto-rudder takes the held rudder over and holds the heading.
    const standard = centred(undefined);
    expect(standard.held).toBeGreaterThan(0.05);
    expect(standard.held).toBeLessThan(0.45);
    expect(standard.after).toBeCloseTo(standard.held, 3);
    // Below the hand-over speed of the type the rudder glides back to centre.
    expect(centred(withAssists({ handoverSpeed: 20 })).after).toBeCloseTo(0, 3);
    // A held rudder beyond the assist's limit is not handed over either.
    const tight = centred(withAssists({ steering: { ...C172S_INPUT.assists.steering, limit: 0.03 } }));
    expect(tight.held).toBeCloseTo(standard.held, 3);
    expect(tight.after).toBeCloseTo(0, 3);
  });
});

describe('the assists take a tuning', () => {
  it('RotationGuard: the rotation rate and the attitude stops', () => {
    const slow = new RotationGuard({ ...C172S_INPUT.assists.rotation, rate: 2 * DEG });
    const standard = new RotationGuard();
    // 3 deg/s on the mains with the key held: within the standard 5 deg/s, beyond a 2 deg/s tuning.
    for (const g of [slow, standard]) g.step(0.2, 0.2, 3 * DEG, 2 * DEG, true, FRAME, true);
    expect(standard.step(0.21, 0.2, 3 * DEG, 2 * DEG, true, FRAME, true)).toBe(0.21);
    expect(slow.step(0.21, 0.2, 3 * DEG, 2 * DEG, true, FRAME, true)).toBeCloseTo(0.2 - 4 * (1 * DEG) * FRAME, 12);
    // A lower attitude stop in the air than on the ground.
    const low = new RotationGuard({ ...C172S_INPUT.assists.rotation, pitchLimitAir: 6 * DEG });
    low.step(0.2, 0.2, 0, 8 * DEG, true, FRAME, true);
    expect(low.step(0.2, 0.2, 0, 8 * DEG, true, FRAME, true)).toBe(0.2);
    expect(low.step(0.2, 0.2, 0, 8 * DEG, false, FRAME, true)).toBeLessThan(0.2);
  });

  it('GroundSteeringAssist: gains, limit and fade-in speeds', () => {
    const tuning: KeyboardAssistTuning['steering'] = { kind: 'rudder', kp: 2, ki: 0, kd: 0, limit: 0.2, fadeInSpeed: [5, 10] };
    const output = (groundSpeed: number, error: number): number => {
      const a = new GroundSteeringAssist(tuning);
      a.step(0, 0, true, groundSpeed, false, FRAME);
      return a.step(-error, 0, true, groundSpeed, false, FRAME);
    };
    expect(output(5, 0.05)).toBe(0);
    expect(output(7.5, 0.05)).toBeCloseTo(2 * 0.05 * 0.5, 12);
    expect(output(10, 0.05)).toBeCloseTo(2 * 0.05, 12);
    expect(output(30, 0.5)).toBe(0.2);
    const a = new GroundSteeringAssist(tuning);
    expect(a.limit).toBe(0.2);
    a.handover(0.4);
    expect(a.value).toBe(0.2);
  });

  it('RollTrimAssist: gains and limit', () => {
    const tuning = { ki: 2.4, kb: 0, limit: 0.02 };
    const a = new RollTrimAssist(tuning);
    const standard = new RollTrimAssist();
    // Past the hold-off, a steady roll rate to the right: the bias builds to the left at twice the standard rate.
    for (let i = 0; i < 60; i++) for (const t of [a, standard]) t.step(0, 0, true, false, FRAME);
    a.step(0.1, 0, true, false, FRAME);
    standard.step(0.1, 0, true, false, FRAME);
    expect(a.value).toBeCloseTo(2 * standard.value, 12);
    expect(standard.value).toBeCloseTo(-1.2 * 0.1 * FRAME, 12);
    for (let i = 0; i < 600; i++) a.step(0.1, 0, true, false, FRAME);
    expect(a.value).toBe(-0.02);
  });
});

describe('keyBindingsFor', () => {
  const actions = (profile: InputProfile): string[] => keyBindingsFor(profile).map((b) => b.action);
  const without = (...labels: string[]): string[] => KEY_BINDINGS.map((b) => b.action).filter((a) => !labels.includes(a));

  it('leaves out the actions a type has nothing for, and nothing else', () => {
    expect(actions({ ...C172S_INPUT, has: { ...C172S_INPUT.has, mixture: false } })).toEqual(without('Mixture lean', 'Mixture rich'));
    expect(actions({ ...C172S_INPUT, has: { ...C172S_INPUT.has, fuelPump: false } })).toEqual(without('Auxiliary fuel pump on/off'));
    // ENGINE MASTER switches: off and on only.
    expect(actions({ ...C172S_INPUT, ignition: 'engineMaster' })).toEqual(without('Magnetos R', 'Magnetos L'));
    expect(actions({ ...C172S_INPUT, ignition: 'toggles' })).toEqual(without());
    // A lever the type has that the Cessna 172S has not adds the rows of its keys (engines.test.ts has their texts),
    // and takes none away.
    const more = actions({ ...C172S_INPUT, has: { ...C172S_INPUT.has, gear: true, propeller: true } });
    expect(more.filter((a) => KEY_BINDINGS.some((b) => b.action === a))).toEqual(without());
    expect(more.length).toBe(KEY_BINDINGS.length + 5);
  });

  it('applies the label overrides of the profile and keeps keys, categories and order', () => {
    const rows = keyBindingsFor({ ...C172S_INPUT, labels: { pitchUp: 'Stick back (nose up)', throttleUp: 'Power lever forward' } });
    expect(rows.length).toBe(KEY_BINDINGS.length);
    rows.forEach((row, i) => {
      const standard = KEY_BINDINGS[i];
      expect(row.keys).toBe(standard.keys);
      expect(row.category).toBe(standard.category);
      if (standard.action.startsWith('Yoke back')) expect(row.action).toBe('Stick back (nose up)');
      else if (standard.action === 'Throttle forward') expect(row.action).toBe('Power lever forward');
      else expect(row.action).toBe(standard.action);
    });
    expect(rows.filter((row) => row.action === 'Stick back (nose up)' || row.action === 'Power lever forward').length).toBe(2);
  });
});
