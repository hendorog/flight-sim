// Keyboard flying against the REAL flight model (src/sim/SimPhysics, real terrain and airport), through the
// real InputSystem, driven only by key presses: the test blocks, for any aircraft type.
//
// describeKeyboardFlight(options) registers them for the type of `options` (its input profile, reference speeds,
// flap detents, rest height and physics: KeyboardPilotOptions of keyboardPilot.ts) with the acceptance bands of
// `options.bands`. Without options it is the Cessna 172S with the numbers its keyboard was tuned to
// (keyboardFlight.test.ts and rotation.test.ts call it that way).
//
// The blocks guard the hold-position virtual-yoke tuning: taps must be fine enough for precise corrections,
// holds strong enough for manoeuvres and the flare without being abrupt, and the response must feel the same at
// every airspeed; a key held for a human reaction time must give a smooth rotation, and holding it through
// lift-off must keep the take-off attitude. The scripted pilot (keyboardPilot.ts) then flies whole circuits.
//
// This file imports the test runner; keyboardPilot.ts must not (the real page loads it).

import { describe, expect, it } from 'vitest';
import type { ScenarioId } from '../../src/core/context';
import { clamp, DEG, KT, RAD, wrapPi } from '../../src/core/math';
import type { WeatherSettings } from '../../src/core/types';
import { AIRPORT, runwayCoords } from '../../src/core/world';
import { flyCircuit, frame, FRAME, makeRig, resolvePilotOptions, type KeyboardPilotOptions, type Rig } from './keyboardPilot';

/** The blocks describeKeyboardFlight can register. */
export type KeyboardFlightBlock = 'handling' | 'flare' | 'takeoffRoll' | 'feetOff' | 'coldStart' | 'circuit' | 'rotation';

/** The blocks of keyboardFlight.test.ts (everything but the rotation, which has its own file). */
export const FLIGHT_BLOCKS: readonly KeyboardFlightBlock[] = ['handling', 'flare', 'takeoffRoll', 'feetOff', 'coldStart', 'circuit'];

/** One key of a cold-start sequence: [KeyboardEvent.code, seconds held, with Shift, times pressed]. */
export type StartKey = readonly [code: string, seconds: number, shift?: boolean, times?: number];

/** The acceptance bands, [low, high] where both ends are checked. The values are those of the Cessna 172S. */
export interface KeyboardFlightBands {
  handling: {
    /** In-air scenarios the handling is checked at (slow to fast). */
    scenarios: readonly ScenarioId[];
    /** Roll rate, deg/s, left by an 80 ms tap, a 0.5 s hold and a 1 s hold of a roll key. */
    rollTap: readonly [number, number];
    rollHalf: readonly [number, number];
    rollHold: readonly [number, number];
    /** Roll rate left 3.5 s after centring, deg/s. */
    rollStopped: number;
    /** An 80 ms nose-up tap: highest load factor, and the pitch change after 3 s, degrees. */
    pitchTapG: number;
    pitchTap: readonly [number, number];
    /** Load factor in the first second of a held nose-up key: at least, at most in the slowest scenario, at most in the others. */
    holdG: readonly [number, number, number];
    /** A 1 s hold left for 3 s; a 2 s hold; a 1 s push (lowest); five 0.1 s taps (load factor, pitch change in degrees). */
    heldG: number;
    longG: readonly [number, number];
    pushG: number;
    tapsG: number;
    tapsPitch: number;
  };
  flare: { scenario: ScenarioId; sinkBefore: number; maxG: number };
  takeoffRoll: { seconds: number; kias: number; across: number };
  feetOff: { kias: number; swing: readonly [number, number] };
  coldStart: { scenario: ScenarioId; keys: readonly StartKey[]; rpm: number; busVolts: number };
  circuit: { across: number; sinkRate: number; stopAcross: number; takeoffAcross: number; bank: number; maxG: number; minG: number };
  rotation: {
    /** The key pilot's target attitude, degrees. */
    target: number;
    /** A 1 s hold: highest pitch rate (deg/s), lift-off time (s) and attitude (deg). */
    holdRate: number;
    holdLiftoff: readonly [number, number];
    holdPitch: readonly [number, number];
    /** Held through the rotation: time to leave the ground (s), and the least attitude reached (deg). */
    throughLiftoff: readonly [number, number];
    throughPitch: number;
    /** Held for 3 and 6 s: attitude (deg), elevator, elevator step per frame, lowest airspeed in the air (KIAS). */
    longPitch: number;
    longElevator: number;
    longStep: number;
    longKias: number;
    /** The closed-loop key pilot: attitude in calm air; on the mains and in the air in the gusty crosswind (deg). */
    calmPitch: number;
    gustPitchOnMains: number;
    gustPitch: number;
    gustWeather: Partial<WeatherSettings>;
  };
}

/** The bands of the Cessna 172S. */
export const C172S_KEYBOARD_BANDS: KeyboardFlightBands = {
  handling: {
    scenarios: ['final', 'downwind', 'cruise'], // 70, 93 and 113 KIAS
    rollTap: [0.2, 1.5],
    rollHalf: [2.5, 6],
    rollHold: [8, 16],
    rollStopped: 2.5,
    pitchTapG: 1.05,
    pitchTap: [0.1, 2.5],
    holdG: [1.1, 1.3, 1.4],
    heldG: 1.6,
    longG: [1.7, 2.5],
    pushG: 0.5,
    tapsG: 1.25,
    tapsPitch: 8,
  },
  flare: { scenario: 'final', sinkBefore: -1.5, maxG: 1.3 },
  takeoffRoll: { seconds: 14, kias: 40, across: 3 },
  feetOff: { kias: 50, swing: [2, 90] },
  coldStart: {
    scenario: 'apron',
    keys: [
      ['KeyW', 0.1], // master
      ['KeyO', 0.1, true], // beacon
      ['KeyM', 4, true], // mixture rich
      ['PageUp', 0.08, false, 5], // crack the throttle
      ['Digit4', 0.1], // magnetos BOTH
      ['KeyS', 3], // starter
    ],
    rpm: 800,
    busVolts: 26,
  },
  circuit: { across: 6, sinkRate: 1.8, stopAcross: 8, takeoffAcross: 4, bank: 35, maxG: 1.8, minG: 0.3 },
  rotation: {
    target: 8,
    holdRate: 9,
    holdLiftoff: [2, 5],
    holdPitch: [5, 11],
    throughLiftoff: [0.8, 3],
    throughPitch: 8,
    longPitch: 13,
    longElevator: 0.4,
    longStep: 0.02,
    longKias: 50,
    calmPitch: 11.5,
    gustPitchOnMains: 12,
    gustPitch: 17,
    gustWeather: { windDirectionDeg: 160, windSpeedKt: 15, gustKt: 10, turbulence: 0.5 },
  },
};

export interface KeyboardFlightOptions extends KeyboardPilotOptions {
  /** Appended to the suite titles (another type than the Cessna 172S). */
  name?: string;
  /** Which blocks to register. Default: FLIGHT_BLOCKS. */
  blocks?: readonly KeyboardFlightBlock[];
  /** Bands that differ from the Cessna 172S ones, by group. */
  bands?: { [G in keyof KeyboardFlightBands]?: Partial<KeyboardFlightBands[G]> };
}

function resolveBands(o: KeyboardFlightOptions['bands'] = {}): KeyboardFlightBands {
  const d = C172S_KEYBOARD_BANDS;
  return {
    handling: { ...d.handling, ...o.handling },
    flare: { ...d.flare, ...o.flare },
    takeoffRoll: { ...d.takeoffRoll, ...o.takeoffRoll },
    feetOff: { ...d.feetOff, ...o.feetOff },
    coldStart: { ...d.coldStart, ...o.coldStart },
    circuit: { ...d.circuit, ...o.circuit },
    rotation: { ...d.rotation, ...o.rotation },
  };
}

interface RotationResult {
  maxPitch: number;
  /** Highest pitch while a main wheel is on the runway (what a tail strike depends on), deg. */
  maxPitchOnMains: number;
  liftoffPitch: number | null;
  crashed: boolean;
  reason: string;
  maxRate: number;
}

/** Register the keyboard-flight test blocks for an aircraft type (default: the Cessna 172S and its numbers). */
export function describeKeyboardFlight(options: KeyboardFlightOptions = {}): void {
  const B = resolveBands(options.bands);
  const blocks = options.blocks ?? FLIGHT_BLOCKS;
  const has = (b: KeyboardFlightBlock): boolean => blocks.includes(b);
  const title = (t: string): string => (options.name ? `${t}: ${options.name}` : t);
  const type = resolvePilotOptions(options);
  // Without type options the rig is built exactly as before (makeRig's own defaults).
  const typed = options.profile || options.reference || options.flapDetents || options.restHeight !== undefined || options.makePhysics || options.targets;
  const rig = (weather: Partial<WeatherSettings> = {}): Rig => (typed ? makeRig(weather, options) : makeRig(weather));

  function scenario(id: ScenarioId, weather = { turbulence: 0, windSpeedKt: 0 }): Rig {
    const r = rig(weather);
    r.physics.reset(id, r.weather);
    r.ctx.events.emit('reset', { scenario: id });
    return r;
  }

  /** Hold a key for `hold` s, then fly hands-off (the yoke stays where the key left it) until `total` s. */
  function pulse(id: ScenarioId, code: string, hold: number, total = 3) {
    return presses(id, code, [[0, hold]], total);
  }

  /** Press a key over the given [start, end) intervals (s) and fly on until `total` s; `centreAt` presses Numpad 5. */
  function presses(id: ScenarioId, code: string, intervals: [number, number][], total = 3, centreAt = Infinity) {
    const r = scenario(id);
    const s = r.physics.renderState;
    const roll0 = s.roll;
    const pitch0 = s.pitch;
    const vs0 = s.verticalSpeed;
    let maxG = 1;
    let minG = 1;
    let maxG1 = 1;
    let maxPitch = 0;
    let maxVs = -Infinity;
    for (let t = 0; t < total; t += FRAME) {
      if (intervals.some(([a, b]) => t >= a && t < b)) r.input.keyDown(code);
      else r.input.keyUp(code);
      if (t >= centreAt && t < centreAt + FRAME) r.input.keyDown('Numpad5');
      else r.input.keyUp('Numpad5');
      frame(r);
      maxG = Math.max(maxG, s.gLoad);
      minG = Math.min(minG, s.gLoad);
      if (t < 1) maxG1 = Math.max(maxG1, s.gLoad);
      maxPitch = Math.max(maxPitch, (s.pitch - pitch0) * RAD);
      maxVs = Math.max(maxVs, s.verticalSpeed);
    }
    return {
      roll: (s.roll - roll0) * RAD,
      rollRate: s.angularVelocity.x * RAD,
      pitch: (s.pitch - pitch0) * RAD,
      maxPitch,
      maxG,
      maxG1,
      minG,
      vs0,
      maxVs,
    };
  }

  if (blocks.some((b) => b !== 'rotation')) {
    describe(title('keyboard flying with the real flight model (hold-position yoke)'), { timeout: 30_000 }, () => {
      const speeds = B.handling.scenarios;

      // Roll: the aileron stays where the key leaves it, so a key sets a roll RATE. Taps give a fraction of a
      // degree per second (precise), a 1 s hold a moderate ~11-13 deg/s at every speed.
      if (has('handling')) it.each(speeds)('%s: roll taps set a small roll rate, a 1 s hold a moderate one', (id) => {
        const h = B.handling;
        const tap = pulse(id, 'ArrowLeft', 0.08, 1.2);
        expect(-tap.rollRate).toBeGreaterThan(h.rollTap[0]);
        expect(-tap.rollRate).toBeLessThan(h.rollTap[1]);
        const half = pulse(id, 'ArrowLeft', 0.5, 1.2);
        expect(-half.rollRate).toBeGreaterThan(h.rollHalf[0]);
        expect(-half.rollRate).toBeLessThan(h.rollHalf[1]);
        const hold = pulse(id, 'ArrowLeft', 1, 1.6);
        expect(-hold.rollRate).toBeGreaterThan(h.rollHold[0]);
        expect(-hold.rollRate).toBeLessThan(h.rollHold[1]);
        // Centring (Numpad 5) stops the roll.
        const stop = presses(id, 'ArrowLeft', [[0, 1]], 5, 1.5);
        expect(Math.abs(stop.rollRate)).toBeLessThan(h.rollStopped);
      });

      // Pitch: fine taps, a held key builds up gently (the owner's limit: at 70 KIAS no more than ~1.3 g in the
      // first second of holding), a longer hold reaches a proper pull, and pushing stays well positive.
      if (has('handling')) it.each(speeds)('%s: pitch taps are fine, a held key builds up gently, a long hold pulls ~2 g, pushing stays positive', (id) => {
        const h = B.handling;
        const tap = pulse(id, 'ArrowDown', 0.08);
        expect(tap.maxG).toBeLessThan(h.pitchTapG);
        expect(tap.pitch).toBeGreaterThan(h.pitchTap[0]);
        expect(tap.pitch).toBeLessThan(h.pitchTap[1]); // over 3 s: the tap's deflection stays
        const hold = pulse(id, 'ArrowDown', 1, 1);
        expect(hold.maxG1).toBeGreaterThan(h.holdG[0]);
        // The owner's limit is ~1.3 g at 70 KIAS; the faster short-period response at higher speed adds a little.
        expect(hold.maxG1).toBeLessThan(id === speeds[0] ? h.holdG[1] : h.holdG[2]);
        console.log(id, 'g in the first second of a held nose-up key', hold.maxG1.toFixed(3));
        // Held on (the yoke stays back), the pull levels out at a moderate load factor.
        expect(pulse(id, 'ArrowDown', 1, 3).maxG).toBeLessThan(h.heldG);
        const long = presses(id, 'ArrowDown', [[0, 2]], 4, 2.5);
        expect(long.maxG).toBeGreaterThan(h.longG[0]);
        expect(long.maxG).toBeLessThan(h.longG[1]);
        const push = presses(id, 'ArrowUp', [[0, 1]], 3, 1.5);
        expect(push.minG).toBeGreaterThan(h.pushG);
        // Five 0.1 s taps 0.3 s apart: a small, predictable change.
        const taps = presses(id, 'ArrowDown', [[0, 0.1], [0.3, 0.4], [0.6, 0.7], [0.9, 1.0], [1.2, 1.3]], 3);
        expect(taps.maxG).toBeLessThan(h.tapsG);
        expect(taps.maxPitch).toBeLessThan(h.tapsPitch);
      });

      if (has('flare')) it('final: a short hold of the nose-up key arrests the approach sink (the flare)', () => {
        // The final scenario sinks at ~2 m/s (400 fpm) at 70 KIAS: a 0.6 s hold of nose-up arrests it within
        // ~1.6 s at a gentle ~1.2 g (and the yoke then stays back, holding the flare attitude).
        const flare = pulse(B.flare.scenario, 'ArrowDown', 0.6, 2);
        expect(flare.vs0).toBeLessThan(B.flare.sinkBefore);
        expect(flare.maxVs).toBeGreaterThan(0);
        expect(flare.maxG).toBeLessThan(B.flare.maxG);
      });

      if (has('takeoffRoll')) it('take-off roll: full power with hands and feet off stays on the centreline (steering assist)', () => {
        const r = rig({ turbulence: 0.1 });
        const s = r.physics.renderState;
        r.input.keyDown('KeyB', true); // parking brake off
        frame(r);
        r.input.keyUp('KeyB');
        r.input.keyDown('F4');
        let worst = 0;
        for (let t = 0; t < B.takeoffRoll.seconds; t += FRAME) {
          frame(r);
          worst = Math.max(worst, Math.abs(runwayCoords(s.position.x, s.position.y).across));
        }
        expect(s.ias / KT).toBeGreaterThan(B.takeoffRoll.kias);
        expect(worst).toBeLessThan(B.takeoffRoll.across);
      });

      if (has('feetOff')) it('with the steering assist off, feet-off on the ground frees the rudder: a gentle drift, not a swerve', () => {
        // Calm air (the crosswind cases are in tests/fdm/ground).
        const r = rig({ turbulence: 0, windSpeedKt: 0, gustKt: 0 });
        r.input.assists.groundSteering = false;
        const s = r.physics.renderState;
        const c = r.physics.controls;
        r.input.keyDown('KeyB', true); // parking brake off
        frame(r);
        r.input.keyUp('KeyB');
        r.input.keyDown('F4');
        const h0 = s.heading;
        let worst = 0;
        for (let t = 0; t < 30 && s.ias / KT < B.feetOff.kias; t += FRAME) {
          frame(r);
          expect(c.feetOffRudder).toBe(true);
          worst = Math.max(worst, Math.abs(wrapPi(s.heading - h0)) * RAD);
        }
        expect(s.ias / KT).toBeGreaterThan(B.feetOff.kias - 1);
        // Feet off, the loaded nosewheel holds the floating rudder (see tests/fdm/ground): the aircraft wanders
        // left with the propeller's yaw, as with the pedals held centred. Since the left-turning tendency was
        // restored (decision 5: a fifth of right pedal holds the roll straight, every 0.1 of pedal away from it is
        // ~40 deg by 50 KIAS) the feet-off swing is ~70 deg, as tests/fdm/ground reports; with the rudder keys the
        // take-off stays on the centreline (scripts/fly-keyboard.mjs with assist=0: 0.55 m). It must not turn round.
        expect(worst).toBeGreaterThan(B.feetOff.swing[0]);
        expect(worst).toBeLessThan(B.feetOff.swing[1]);
        // A rudder key puts the feet back on the pedals.
        r.input.keyDown('KeyX');
        frame(r);
        expect(c.feetOffRudder).toBe(false);
        r.input.keyUp('KeyX');
        // With the assist on (the default) the keyboard pilot's feet stay on the pedals.
        const r2 = rig({ turbulence: 0 });
        frame(r2);
        expect(r2.physics.controls.feetOffRudder).toBe(false);
      });

      if (has('coldStart')) it('cold and dark: the engine can be started from the keyboard alone', () => {
        const r = scenario(B.coldStart.scenario);
        const s = r.physics.renderState;
        const c = r.physics.controls;
        expect(s.engine.running).toBe(false);
        const hold = (code: string, seconds: number, shift = false): void => {
          r.input.keyDown(code, shift);
          for (let t = 0; t < seconds; t += FRAME) frame(r);
          r.input.keyUp(code);
          frame(r);
        };
        for (const [code, seconds, shift, times] of B.coldStart.keys) for (let i = 0; i < (times ?? 1); i++) hold(code, seconds, shift);
        for (let t = 0; t < 3; t += FRAME) frame(r);
        hold('KeyI', 0.1); // avionics
        expect(c.masterBattery && c.alternator && c.avionics && c.lights.beacon).toBe(true);
        expect(c.mixture).toBe(1);
        expect(s.engine.running).toBe(true);
        expect(s.engine.rpm).toBeGreaterThan(B.coldStart.rpm);
        expect(s.electrical.busVoltage).toBeGreaterThan(B.coldStart.busVolts);
      });

      // The scripted pilot flies the hold-position yoke as a person would: it looks at the attitude and the
      // control-position widget and taps or holds keys to move each control where it wants it.
      if (has('circuit')) it.each([
        ['light turbulence', { turbulence: 0.1 }],
        ['a 10 kt crosswind from the right, turbulence 0.2', { turbulence: 0.2, windDirectionDeg: 160, windSpeedKt: 10 }],
      ])('a whole left-hand circuit on runway 07, keyboard only, in %s', (_name, weather) => {
        const r = rig(weather);
        const res = flyCircuit(r);
        const { log: _log, ...summary } = res;
        console.log(JSON.stringify(summary));
        expect(res.crashed).toBe(false);
        expect(res.phaseTimes.stopped).toBeDefined();
        const td = res.touchdown!;
        expect(td).not.toBeNull();
        const half = AIRPORT.runway.length / 2;
        expect(td.along).toBeGreaterThan(-half);
        expect(td.along).toBeLessThan(0);
        expect(Math.abs(td.across)).toBeLessThan(B.circuit.across);
        expect(td.sinkRate).toBeLessThan(B.circuit.sinkRate);
        expect(Math.abs(res.stop!.across)).toBeLessThan(B.circuit.stopAcross);
        expect(res.takeoffMaxAcross).toBeLessThan(B.circuit.takeoffAcross);
        expect(res.maxBank).toBeLessThan(B.circuit.bank);
        expect(res.maxG).toBeLessThan(B.circuit.maxG);
        expect(res.minG).toBeGreaterThan(B.circuit.minG);
      }, 60_000);
    });
  }

  if (!has('rotation')) return;

  // Keyboard rotation on take-off against the real flight model, with the hold-position keyboard yoke: a key
  // held for a human reaction time must give a smooth rotation, holding the key through lift-off must keep the
  // take-off attitude (the rotation guard acts while that key is held), and a simple closed-loop key pilot must
  // be able to rotate and lift off in calm air and in a gusty crosswind.
  const R = B.rotation;
  /** The speed the nose-up key goes down at: Vr. */
  const vr = type.reference.vr;

  /** Release the parking brake, full power, hands off (the steering assist holds the line) up to `kias`. */
  function rollTo(weather: Partial<WeatherSettings>, kias: number, seed = 0): Rig {
    const r = rig({ turbulence: 0, windSpeedKt: 0, gustKt: 0, ...weather });
    const s = r.physics.renderState;
    // Different turbulence realisations: advance the clock a little before brake release.
    for (let i = 0; i < seed * 7; i++) frame(r);
    r.input.keyDown('KeyB', true);
    frame(r);
    r.input.keyUp('KeyB');
    r.input.keyDown('F4');
    frame(r);
    r.input.keyUp('F4');
    for (let t = 0; t < 40 && s.ias / KT < kias; t += FRAME) {
      // Keep the wings level with taps, as the reviewer's pilot does.
      const bankErr = -s.roll;
      if (bankErr > 2 * DEG) r.input.keyDown('ArrowRight');
      else r.input.keyUp('ArrowRight');
      if (bankErr < -2 * DEG) r.input.keyDown('ArrowLeft');
      else r.input.keyUp('ArrowLeft');
      frame(r);
    }
    r.input.keyUp('ArrowRight');
    r.input.keyUp('ArrowLeft');
    return r;
  }

  /**
   * The reviewer's key pilot: every 150 ms it reads the pitch and pitch rate (with ~30 ms of latency) and holds
   * the nose-up or nose-down key for a fraction of the tick proportional to the attitude error (0.35 per degree)
   * less the pitch rate (0.3 per deg/s: with a yoke that stays where it is put, a pilot eases forward as soon
   * as the nose is coming up at a normal rotation rate).
   */
  function keyPilotRotate(r: Rig, target = R.target, seconds = 8): RotationResult {
    const s = r.physics.renderState;
    let maxPitch = -Infinity;
    let maxPitchOnMains = -Infinity;
    let maxRate = 0;
    let liftoffPitch: number | null = null;
    let seen = s.pitch;
    let seenQ = s.angularVelocity.y;
    let downUntil = -1;
    let upUntil = -1;
    let nextTick = 0;
    for (let t = 0; t < seconds && !s.crashed; t += FRAME) {
      if (t >= nextTick - 0.03 && t < nextTick - 0.03 + FRAME) {
        seen = s.pitch;
        seenQ = s.angularVelocity.y;
      }
      if (t >= nextTick) {
        nextTick += 0.15;
        const cmd = clamp((target - seen * RAD) * 0.35 - seenQ * RAD * 0.3, -1, 1);
        if (Math.abs(cmd) >= 0.08) {
          const until = t + Math.abs(cmd) * 0.15 * 0.9;
          if (cmd > 0) downUntil = until;
          else upUntil = until;
        }
      }
      if (t < downUntil) r.input.keyDown('ArrowDown');
      else r.input.keyUp('ArrowDown');
      if (t < upUntil) r.input.keyDown('ArrowUp');
      else r.input.keyUp('ArrowUp');
      // Wings level.
      if (-s.roll > 2 * DEG) r.input.keyDown('ArrowRight');
      else r.input.keyUp('ArrowRight');
      if (-s.roll < -2 * DEG) r.input.keyDown('ArrowLeft');
      else r.input.keyUp('ArrowLeft');
      frame(r);
      maxPitch = Math.max(maxPitch, s.pitch * RAD);
      if (s.wheels[1].onGround || s.wheels[2].onGround) maxPitchOnMains = Math.max(maxPitchOnMains, s.pitch * RAD);
      maxRate = Math.max(maxRate, s.angularVelocity.y * RAD);
      if (liftoffPitch === null && !s.wheels[0].onGround && !s.wheels[1].onGround && !s.wheels[2].onGround) liftoffPitch = s.pitch * RAD;
    }
    return { maxPitch, maxPitchOnMains, liftoffPitch, crashed: s.crashed, reason: s.crashReason, maxRate };
  }

  describe(title('keyboard rotation on take-off'), { timeout: 30_000 }, () => {
    it(`a 1 s hold of nose-up at ${vr} KIAS starts a smooth rotation and lifts off; the yoke stays where it was left`, () => {
      const r = rollTo({}, vr);
      const s = r.physics.renderState;
      const c = r.physics.controls;
      let maxRate = 0;
      let liftoff = -1;
      let liftoffPitch = 0;
      let released = 0;
      r.input.keyDown('ArrowDown');
      for (let t = 0; t < 6 && !s.crashed; t += FRAME) {
        if (t >= 1 && !released) {
          r.input.keyUp('ArrowDown');
          released = c.elevator;
        }
        frame(r);
        maxRate = Math.max(maxRate, s.angularVelocity.y * RAD);
        if (liftoff < 0 && !s.wheels[1].onGround && !s.wheels[2].onGround) {
          liftoff = t;
          liftoffPitch = s.pitch * RAD;
        }
      }
      console.log('hold1s', { maxRate, liftoff, liftoffPitch, released, elevator: c.elevator });
      expect(s.crashed).toBe(false);
      expect(maxRate).toBeLessThan(R.holdRate);
      expect(liftoff).toBeGreaterThan(R.holdLiftoff[0]);
      expect(liftoff).toBeLessThan(R.holdLiftoff[1]);
      expect(liftoffPitch).toBeGreaterThan(R.holdPitch[0]);
      expect(liftoffPitch).toBeLessThan(R.holdPitch[1]);
      expect(c.elevator).toBe(released);
    });

    it('holding nose-up through the rotation lifts off without dragging the tail', () => {
      const r = rollTo({}, vr);
      const s = r.physics.renderState;
      let maxPitch = 0;
      let airborne = -1;
      r.input.keyDown('ArrowDown');
      for (let t = 0; t < 4 && !s.crashed; t += FRAME) {
        frame(r);
        maxPitch = Math.max(maxPitch, s.pitch * RAD);
        if (airborne < 0 && !s.wheels[1].onGround && !s.wheels[2].onGround) airborne = t;
      }
      expect(s.crashed).toBe(false);
      expect(airborne).toBeGreaterThan(R.throughLiftoff[0]);
      expect(airborne).toBeLessThan(R.throughLiftoff[1]);
      expect(maxPitch).toBeGreaterThan(R.throughPitch);
    });

    // The reviewer's new-user take-off: hold nose-up from 55 KIAS through lift-off and beyond, then let go. The
    // aircraft must keep roughly the take-off attitude (not zoom to 25+ deg as the elevator sweeps to full travel
    // once the wheels leave the ground), and the keyboard elevator must never jump.
    it.each([3, 6])(`holding nose-up for %s s from ${vr} KIAS keeps the take-off attitude through lift-off`, (hold) => {
      const r = rollTo({}, vr);
      const s = r.physics.renderState;
      const c = r.physics.controls;
      let maxPitch = 0;
      let maxElevator = -1;
      let maxStep = 0;
      let lastElevator = c.elevator;
      let liftoff = -1;
      let minIasAir = Infinity;
      r.input.keyDown('ArrowDown');
      for (let t = 0; t < hold + 0.5 && !s.crashed; t += FRAME) {
        if (t >= hold) r.input.keyUp('ArrowDown');
        frame(r);
        maxPitch = Math.max(maxPitch, s.pitch * RAD);
        maxElevator = Math.max(maxElevator, c.elevator);
        maxStep = Math.max(maxStep, Math.abs(c.elevator - lastElevator));
        lastElevator = c.elevator;
        const airborne = !s.wheels[0].onGround && !s.wheels[1].onGround && !s.wheels[2].onGround;
        if (airborne && liftoff < 0) liftoff = t;
        if (liftoff >= 0) minIasAir = Math.min(minIasAir, s.ias / KT);
      }
      console.log('hold-through', hold, { maxPitch, maxElevator, maxStep, liftoff, minIasAir });
      expect(s.crashed).toBe(false);
      expect(liftoff).toBeGreaterThan(0);
      expect(liftoff).toBeLessThan(hold);
      expect(maxPitch).toBeLessThan(R.longPitch);
      expect(maxElevator).toBeLessThan(R.longElevator);
      expect(maxStep).toBeLessThan(R.longStep);
      expect(minIasAir).toBeGreaterThan(R.longKias);
    });

    it(`the closed-loop key pilot rotates to ~${R.target} degrees in calm air`, () => {
      const r = rollTo({}, vr);
      const res = keyPilotRotate(r);
      console.log('calm', res);
      expect(res.crashed).toBe(false);
      expect(res.maxPitch).toBeLessThan(R.calmPitch);
      expect(res.liftoffPitch).not.toBeNull();
    });

    it.each([0, 1, 2, 3])('the closed-loop key pilot rotates without a tail strike in the gusty crosswind preset (seed %i)', (seed) => {
      const r = rollTo(R.gustWeather, vr, seed);
      const res = keyPilotRotate(r);
      console.log('xw', seed, res);
      expect(res.crashed).toBe(false);
      expect(res.liftoffPitch).not.toBeNull();
      // Tail strike: the tie-down ring touches at ~13 deg nose-up on the mains (gear/structure.ts), so the
      // attitude that matters is the one reached while a main wheel is still on the runway.
      expect(res.maxPitchOnMains).toBeLessThan(R.gustPitchOnMains);
      // Once airborne the attitude may run past 12 deg for a moment. This preset is a 90 deg crosswind of 15 kt
      // gusting 25, so the aircraft leaves the ground in 15-24 deg of sideslip (atan(15..25 / 55)); this pilot has
      // no rudder, and the auto-rudder's left (downwind) pedal decaying after lift-off at full power yaws it
      // further left. In right sideslip the slipstream (which at take-off angles of attack passes along the
      // tailplane, Perkins & Hage sec. 5-8) slides left, and the tailplane then sits mostly in the half of the jet
      // where the propeller's swirl (~10 deg, momentum theory r v_theta = Q / mdot) blows down: a nose-up pitching
      // moment of about +0.09 Cm at 20 deg of sideslip, 55 KIAS and full power (none with the jet centred, where
      // the two halves cancel). The hold-position keyboard yoke catches it a second or two later, so the climb
      // attitude peaks at 12-16 deg (seeds 0-3), a metre or two above the runway; it must stay short of a zoom.
      expect(res.maxPitch).toBeLessThan(R.gustPitch);
    });
  });
}
