// The keyboard student of `scripts/fly-lesson.mjs --keys` (spec section 6.4.4): the AutoStudent decides, real
// key presses fly. Loaded into the page through the vite dev server.
//
// The AutoStudent works on a SHADOW copy of the controls: it reads the real aircraft and writes where it wants
// each control. Every 0.1 s a translator compares the real controls (what the keys have set through the
// InputSystem, the hold-position keyboard yoke) with the shadow and queues presses toward it, with the same
// human limits as the scripted keyboard pilot (tests/input/keyboardPilot.ts): whole frames, at least 60 ms a
// press, the yoke key held for the time the keyboard model needs to move the yoke that far. The script sends the
// queued presses to the page as real keystrokes, so everything goes through the app's own keyboard listeners.
// Acknowledgements (handover, checklist items) are Enter presses.
//
// Where the AutoStudent flies with its autopilot, the translator does not chase the autopilot's yoke positions
// (an autopilot moves the yoke faster than the hold-position keyboard yoke can, and chasing it oscillates):
// it takes the attitude the autopilot is aiming for and flies that with the keyboard pilot's own attitude laws
// (gains in units of the key authority, a slowly learned held position, trim taps for a steady yoke force).
// Control laws (take-off roll, flare, rollout, taxi) are followed surface by surface.

import { clamp, DEG, KT } from '../../src/core/math';
import { AIRPORT } from '../../src/core/world';
import type { ControlInputs } from '../../src/core/types';
import { KEY_AXIS_TUNING, keyAuthority, type KeyAxisTuning } from '../../src/input/virtualYoke';
import type { SimPhysics } from '../../src/sim/SimPhysics';
import { C172S } from '../../src/training/aircraft/c172s';
import type { LessonRunner } from '../../src/training/engine/runner';
import { GAINS, pressTime } from '../input/keyboardPilot';
import { AutoStudent } from './autoStudent';

interface KeyEvent { down: boolean; code: string; shift?: boolean }

/** What the page's automation API offers (window.__sim). */
interface SimApi {
  physics: SimPhysics;
  ctx: { controls: ControlInputs };
  training: { runner: LessonRunner | null };
}

const DECIDE_S = 0.1;
const MIN_PRESS_S = 0.06;
/** Physics sub-steps per rendered frame for the shadow autopilot (it was tuned at 240 Hz). */
const SUBSTEPS = 4;
/** Keyboard throttle and trim rates (InputSystem THROTTLE_RATE, TRIM_RATE), per second. */
const THROTTLE_RATE = 0.5;
const TRIM_RATE = 0.25;

/**
 * Seconds to hold a lever key (throttle, F2/F3) to move it `gap`: the key moves the lever at a quarter of its
 * rate when first pressed, rising to the full rate over a second (InputSystem leverRate), so a short tap moves
 * it far less than rate x time. `heldS`: how long the key has already been held.
 */
export function leverPress(gap: number, rate: number, heldS = 0): number {
  // Lever travel from heldS to heldS + x: rate * integral of (0.25 + 0.75 * min(t, 1)) dt.
  const travel = (x: number): number => {
    const ramp = (a: number): number => (a <= 1 ? 0.25 * a + 0.375 * a * a : 0.625 + (a - 1));
    return rate * (ramp(heldS + x) - ramp(heldS));
  };
  let lo = 0;
  let hi = 3;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (travel(mid) < gap) lo = mid;
    else hi = mid;
  }
  return clamp(hi, MIN_PRESS_S, 0.5);
}

export function installKeyStudent(sim: SimApi): { trace(): string; drain(): KeyEvent[]; stop(): void } {
  const queue: KeyEvent[] = [];
  const held = new Map<string, { until: number; since: number }>();
  const lastTap = new Map<string, number>();
  const shadow: ControlInputs = structuredClone(sim.ctx.controls);
  let pendingEnter = 0;
  const student = new AutoStudent({
    physics: { get state() { return sim.physics.state; }, controls: shadow } as Pick<SimPhysics, 'state' | 'controls'>,
    aircraft: C172S,
    onAck: () => pendingEnter++,
    keyboard: true,
  });
  let stopped = false;
  let t = 0;
  // The keyboard pilot's state for flying an attitude: the held yoke positions it has learned, and the
  // average yoke force it trims away.
  let elevRef = 0;
  let ailRef = 0;
  let rudRef = 0;
  let elevAvg = 0;
  let lastTrimAt = -1e9;
  let attitudeMode = false;
  let flareStart: number | null = null;
  let nextDecision = 0;
  let lastSimT = -1;

  const down = (code: string, seconds: number, shift = false): void => {
    const h = held.get(code);
    if (h) {
      h.until = Math.max(h.until, t + Math.max(MIN_PRESS_S, seconds));
      return;
    }
    queue.push({ down: true, code, shift });
    held.set(code, { until: t + Math.max(MIN_PRESS_S, seconds), since: t });
  };
  const up = (code: string): void => {
    if (!held.has(code)) return;
    held.delete(code);
    queue.push({ down: false, code });
  };
  const tap = (code: string, shift = false, every = 0.5): void => {
    if (t - (lastTap.get(code + shift) ?? -1e9) < every) return;
    lastTap.set(code + shift, t);
    down(code, MIN_PRESS_S, shift);
  };
  /** Move a hold-position yoke axis toward `want` with the key pair, as the keyboard pilot does. */
  const axis = (neg: string, pos: string, current: number, want: number, tuning: KeyAxisTuning, dead: number): void => {
    const gap = want - current;
    if (Math.abs(gap) <= dead) {
      up(neg);
      up(pos);
      return;
    }
    const [key, other] = gap > 0 ? [pos, neg] : [neg, pos];
    up(other);
    const h = held.get(key);
    const heldS = h ? t - h.since : 0;
    down(key, pressTime(gap, sim.physics.state.ias, tuning, heldS, DECIDE_S + 0.02));
  };

  const L = (tuning: KeyAxisTuning): number => keyAuthority(sim.physics.state.ias, tuning);
  /** Pitch toward an attitude (keyboardPilot flyPitch). */
  const flyPitch = (target: number, gain = 1): void => {
    const st = sim.physics.state;
    const Le = L(KEY_AXIS_TUNING.elevator);
    const err = target - st.pitch;
    elevRef = clamp(elevRef + Le * GAINS.ki * gain * err * DECIDE_S, -0.5, 0.6);
    const want = elevRef + Le * clamp(gain * (GAINS.kp * err - GAINS.kd * st.angularVelocity.y), -0.25, 0.3);
    axis('ArrowUp', 'ArrowDown', sim.ctx.controls.elevator, want, KEY_AXIS_TUNING.elevator, GAINS.de);
  };
  /** Bank toward a target (keyboardPilot flyBank). */
  const flyBank = (target: number): void => {
    const st = sim.physics.state;
    const La = L(KEY_AXIS_TUNING.aileron);
    const err = target - st.roll;
    ailRef = clamp(ailRef + GAINS.rki * err * DECIDE_S, -0.1, 0.1);
    const want = ailRef + clamp(La * (GAINS.rkp * err - GAINS.rkd * st.angularVelocity.x), -GAINS.rcap * La, GAINS.rcap * La);
    axis('ArrowLeft', 'ArrowRight', sim.ctx.controls.aileron, want, KEY_AXIS_TUNING.aileron, GAINS.da);
  };
  /** Feet: keep the ball in the middle (keyboardPilot ball). */
  const ball = (): void => {
    const slip = sim.physics.state.slipBall;
    // "Step on the ball" (L01 power and yaw, item 9): firmer, so the ball is centred rather than left at the edge
    // of the tolerance with half the pedal (real-key run: 0.10 ball, 0.13 pedal after 10 s). Following the yaw
    // damper's pedal instead oscillated (the key lag in its loop).
    const firm = student.programKind === 'powerClimb';
    rudRef = clamp(rudRef + (firm ? 0.5 : 0.06) * slip * DECIDE_S, -0.4, 0.4);
    axis('KeyZ', 'KeyX', sim.ctx.controls.rudder, rudRef + (firm ? 0.3 : 0.12) * slip, KEY_AXIS_TUNING.rudder, 0.02);
  };
  /** Trim away a steady yoke force: a tap every 1.5 s while the average yoke is held off centre. */
  const trimTaps = (): void => {
    if (t - lastTrimAt < 1.5) return;
    if (elevAvg > 0.03) down('End', elevAvg > 0.12 ? 0.25 : MIN_PRESS_S);
    else if (elevAvg < -0.03) down('Home', elevAvg < -0.12 ? 0.25 : MIN_PRESS_S);
    else return;
    lastTrimAt = t;
  };

  /** Translate the shadow (or the attitude the student aims for) into key presses. */
  const decide = (): void => {
    const c = sim.ctx.controls;
    const s = shadow;
    if (pendingEnter > 0) {
      pendingEnter = 0;
      tap('Enter', false, 0.3);
    }
    if (!student.inControl) return;
    const att = student.attitudeTarget;
    const flyAtt = att !== null && Number.isFinite(att.pitch);
    if (flyAtt && !attitudeMode) {
      // Bumpless: the learned positions start where the yoke and pedals are.
      elevRef = c.elevator;
      ailRef = clamp(c.aileron, -0.1, 0.1);
      rudRef = clamp(c.rudder, -0.3, 0.3);
    }
    attitudeMode = flyAtt;
    const st = sim.physics.state;
    const airborne = !st.wheels.some((w) => w.onGround);
    const flaring = flyAtt && airborne && student.programPhase === 'flare';
    if (!flaring) flareStart = null;
    if (flaring) {
      // The round-out as the keyboard pilot flies it: arrest the sink progressively toward the runway and raise
      // the nose toward the landing attitude as the height goes.
      flareStart ??= st.pitch;
      const agl = st.altitudeMSL - AIRPORT.elevation - 1.25;
      const vsWant = -clamp(agl * 0.22, 0.3, 2);
      const attitude = (1 - clamp(agl / 3, 0, 1)) * 6 * DEG;
      flyPitch(clamp(Math.max(st.pitch + (vsWant - st.verticalSpeed) * 3 * DEG, attitude), flareStart, 10 * DEG), 1.2);
    } else if (flyAtt) {
      flyPitch(att.pitch);
    }
    if (flyAtt) {
      if (att.law) {
        axis('ArrowLeft', 'ArrowRight', c.aileron, s.aileron, KEY_AXIS_TUNING.aileron, 0.015);
        axis('KeyZ', 'KeyX', c.rudder, s.rudder, KEY_AXIS_TUNING.rudder, 0.02);
      } else {
        flyBank(Number.isFinite(att.bank) ? att.bank : 0);
        ball();
      }
      trimTaps();
    } else {
      axis('ArrowUp', 'ArrowDown', c.elevator, s.elevator, KEY_AXIS_TUNING.elevator, 0.01);
      axis('ArrowLeft', 'ArrowRight', c.aileron, s.aileron, KEY_AXIS_TUNING.aileron, 0.015);
      axis('KeyZ', 'KeyX', c.rudder, s.rudder, KEY_AXIS_TUNING.rudder, 0.02);
      // Trim: hold the trim key for the time the gap takes at the trim rate.
      const trimGap = s.elevatorTrim - c.elevatorTrim;
      if (Math.abs(trimGap) > 0.01) down(trimGap > 0 ? 'End' : 'Home', clamp(Math.abs(trimGap) / TRIM_RATE, MIN_PRESS_S, DECIDE_S + 0.02));
    }
    // Throttle: idle and full have their own keys; otherwise F2 / F3 held for the gap.
    const thrGap = s.throttle - c.throttle;
    if (s.throttle <= 0.005 && c.throttle > 0.01) tap('F1', false, 0.3);
    else if (s.throttle >= 0.995 && c.throttle < 0.99) tap('F4', false, 0.3);
    else if (Math.abs(thrGap) > 0.015) {
      const key = thrGap > 0 ? 'F3' : 'F2';
      up(thrGap > 0 ? 'F2' : 'F3');
      const h = held.get(key);
      down(key, leverPress(Math.abs(thrGap), THROTTLE_RATE, h ? t - h.since : 0));
    }
    // Flaps one notch at a time.
    if (s.flaps > c.flaps + 0.1) tap('F6', false, 0.6);
    else if (s.flaps < c.flaps - 0.1) tap('F5', false, 0.6);
    // Mixture, brakes, starter.
    if (s.mixture >= 0.95 && c.mixture < 0.95) down('KeyM', DECIDE_S + 0.02, true);
    else if (s.mixture <= 0.05 && c.mixture > 0.05) down('KeyM', DECIDE_S + 0.02);
    // Toe brakes from the key build up at 2 per second (InputSystem stepBrake): hold for the pressure wanted.
    // One toe brake (the taxi driver's inside brake in a tight turn): , left, . right.
    const diffBrake = Math.abs(s.brakeLeft - s.brakeRight) > 0.15;
    if (Math.max(s.brakeLeft, s.brakeRight) > 0.3 && !diffBrake) down('KeyB', Math.max(DECIDE_S + 0.02, Math.max(s.brakeLeft, s.brakeRight) / 2));
    else up('KeyB');
    if (diffBrake && s.brakeLeft > s.brakeRight) down('Comma', Math.max(DECIDE_S + 0.02, (s.brakeLeft - s.brakeRight) / 2));
    else up('Comma');
    if (diffBrake && s.brakeRight > s.brakeLeft) down('Period', Math.max(DECIDE_S + 0.02, (s.brakeRight - s.brakeLeft) / 2));
    else up('Period');
    if (s.starter) down('KeyS', DECIDE_S + 0.02);
    else up('KeyS');
    // Switches and selectors: one toggle per half second until they agree.
    if (s.parkingBrake !== c.parkingBrake) tap('KeyB', true);
    if (s.magnetos !== c.magnetos) tap(`Digit${s.magnetos + 1}`);
    if (s.masterBattery !== c.masterBattery) tap('KeyW');
    if (s.alternator !== c.alternator && s.masterBattery === c.masterBattery) tap('KeyW', true);
    if (s.avionics !== c.avionics) tap('KeyI');
    if (s.fuelPump !== c.fuelPump) tap('KeyJ');
    if (s.fuelSelector !== c.fuelSelector) tap('KeyJ', true, 0.7);
    if (s.lights.landing !== c.lights.landing) tap('KeyL');
    if (s.lights.taxi !== c.lights.taxi) tap('KeyL', true);
    if (s.lights.nav !== c.lights.nav) tap('KeyN');
    if (s.lights.strobe !== c.lights.strobe) tap('KeyO');
    if (s.lights.beacon !== c.lights.beacon) tap('KeyO', true);
  };

  const frame = (): void => {
    if (stopped) return;
    requestAnimationFrame(frame);
    const runner = sim.training.runner;
    const simT = sim.physics.state.time;
    if (!runner || runner.phase !== 'running' || simT === lastSimT) return;
    const dt = lastSimT < 0 ? 0 : Math.max(0, simT - lastSimT);
    lastSimT = simT;
    t += dt;
    for (const [code, h] of held) if (t >= h.until) up(code);
    // While the student does not have control, the shadow follows the aircraft (nothing to translate); when
    // flying an attitude, the shadow's trim is the real one (the keyboard pilot trims by feel instead).
    // The first flown frame starts from the aircraft as it is (the shadow was copied at the briefing, before the
    // lesson set the controls up), and so does any control the shadow has no number for: in L02 and the skill
    // test the student has control from the first frame, and a NaN shadow sent the yoke to its stops.
    if (!student.inControl || dt === 0) Object.assign(shadow, structuredClone(sim.ctx.controls));
    else {
      const real = sim.ctx.controls as unknown as Record<string, unknown>;
      const sh = shadow as unknown as Record<string, unknown>;
      for (const k of Object.keys(sh)) if (typeof sh[k] === 'number' && !Number.isFinite(sh[k] as number)) sh[k] = real[k];
      if (attitudeMode) shadow.elevatorTrim = sim.ctx.controls.elevatorTrim;
    }
    elevAvg += (sim.ctx.controls.elevator - elevAvg) * Math.min(1, dt / 3);
    student.tick(runner, dt);
    for (let i = 0; i < SUBSTEPS && dt > 0; i++) student.update(dt / SUBSTEPS, sim.physics.state, shadow);
    if (t >= nextDecision) {
      nextDecision = t + DECIDE_S;
      decide();
    }
  };
  requestAnimationFrame(frame);

  return {
    /** One line of state for `fly-lesson.mjs --trace`: the real and wanted controls and the keys held. */
    trace: () => {
      const c = sim.ctx.controls;
      const st = sim.physics.state;
      const r = (x: number): string => x.toFixed(3);
      return `t=${t.toFixed(1)} ctl=${student.inControl} att=${attitudeMode} ele=${r(c.elevator)}/${r(shadow.elevator)} ail=${r(c.aileron)}/${r(shadow.aileron)} rud=${r(c.rudder)}/${r(shadow.rudder)} trim=${r(c.elevatorTrim)}/${r(shadow.elevatorTrim)} thr=${r(c.throttle)}/${r(shadow.throttle)} g=${st.gLoad.toFixed(2)} pitch=${(st.pitch * 57.3).toFixed(1)} bank=${(st.roll * 57.3).toFixed(1)} kias=${(st.ias / KT).toFixed(0)} mix=${r(c.mixture)}/${r(shadow.mixture)} mags=${c.magnetos}/${shadow.magnetos} master=${c.masterBattery} fuel=${c.fuelSelector} starter=${c.starter}/${shadow.starter} rpm=${st.engine.rpm.toFixed(0)} pbrake=${c.parkingBrake}/${shadow.parkingBrake} held=${[...held.keys()].join('+')}`;
    },
    drain: () => queue.splice(0),
    stop: () => {
      stopped = true;
      for (const code of [...held.keys()]) up(code);
    },
  };
}
