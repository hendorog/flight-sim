// The keyboard beginner of the flyability pilot gates (W/bofly/pilot-r1 simRig.ts, the round-2 gate's lift-off and
// deceleration, W/bofly/pilot-r3): the REAL SimPhysics and InputSystem, keys going in as the browser sends them, 60
// frames per second, the STAB ASSIST linked as the Simulator links it. The beginner looks at the state 0.3 s late every
// `interval` s and taps the arrow keys (0.1-0.6 s, about 9 deg of attitude per 1 s tap), the pedal keys on a heading
// error and F5 / F6 on height and sink, then waits: see, tap, wait. Pilot units throughout.
import { DEG, KT, clamp } from '../../src/core/math';
import { createEventBus, type SimContext } from '../../src/core/context';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { BO105_DEFINITION } from '../../src/aircraft/bo105';
import { InputSystem } from '../../src/input/InputSystem';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { hoverScenario } from '../../src/sim/rotorcraft/starts';

export const FRAME = 1 / 60;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * 'hover15': the hover scenario (2500 kg, about 16 m). 'ige3': the same at a 3 ft skid height. 'runway': on the ground,
 * engines running. 'level': the hover scenario's place at `kias` and `heightM`, 2200 kg. The input module is told of
 * the reset after it, as the Simulator does (the pilot-r2 rig reset the physics after attaching it and kept the hover's
 * keyboard pedal, -0.42 against the 45 KIAS trim's +0.18).
 */
export function keyRig(o: { start: 'hover15' | 'ige3' | 'runway' | 'level'; kias?: number; heightM?: number; dd?: AircraftDefinition; assist?: boolean }) {
  const dd = o.dd ?? BO105_DEFINITION;
  const w: WeatherSettings = { ...defaultWeather(), windSpeedKt: 0, gustKt: 0, turbulence: 0, isaDeviation: 0, cloudCover: 0 };
  const events = createEventBus(), physics = new SimPhysics({ aircraft: dd, weather: w, events });
  if (o.start === 'runway') physics.reset('runway', w);
  else {
    const sc = hoverScenario(physics.env, dd.rotorcraft!);
    const z = o.start === 'ige3' ? sc.ic.position.z + 12 : o.start === 'level' ? sc.ic.position.z - ((o.heightM ?? 30) - 15) : sc.ic.position.z;
    physics.resetTo({ ...sc, ...(o.start === 'level' ? { payload: 'typical' as const } : {}),
      ic: { ...sc.ic, airspeed: (o.kias ?? 0) * KT, position: { ...sc.ic.position, z } } }, w);
  }
  const noop = (): void => {};
  const ctx = { state: physics.renderState, controls: physics.controls, weather: w, env: physics.env, events, paused: false, timeScale: 1,
    cameraMode: 'cockpit', simTime: 0, commands: { reset: noop, setPaused: noop, setCameraMode: noop, setTimeScale: noop, setQuality: noop } } as unknown as SimContext;
  const input = new InputSystem({ profile: dd.input });
  input.attach(ctx);
  input.assists.stabilityAssist = o.assist ?? true;
  physics.stabilityAssistOn = () => input.assists.stabilityAssist === true;
  return { physics, input, ctx, c: physics.controls, t: 0 };
}
export type KeyRig = ReturnType<typeof keyRig>;

/** One 60 Hz frame: the input module writes the controls, the physics advances. */
export function frame(r: KeyRig): void { r.input.update(FRAME, r.ctx); r.physics.advance(FRAME); r.t += FRAME; }

/** Key presses with a hold time, released at the frame they run out (call update() before each frame). */
export class Keys {
  private readonly down = new Map<string, number>();
  constructor(private readonly r: KeyRig) {}
  tap(code: string, hold: number): void {
    if (this.down.has(code)) { this.down.set(code, Math.max(this.down.get(code)!, this.r.t + hold)); return; }
    this.r.input.keyDown(code);
    this.down.set(code, this.r.t + hold);
  }
  update(): void {
    for (const [code, until] of this.down) if (this.r.t >= until - FRAME / 2) { this.r.input.keyUp(code); this.down.delete(code); }
  }
  releaseAll(): void { for (const code of this.down.keys()) this.r.input.keyUp(code); this.down.clear(); }
}

interface Snap { pitch: number; roll: number; hdg: number; p: number; q: number; r: number; vx: number; vy: number; vz: number; x: number; y: number; z: number }
const snap = (r: KeyRig): Snap => {
  const s = r.physics.state;
  return { pitch: s.pitch, roll: s.roll, hdg: s.heading, p: s.angularVelocity.x, q: s.angularVelocity.y, r: s.angularVelocity.z,
    vx: s.velocity.x, vy: s.velocity.y, vz: s.velocity.z, x: s.position.x, y: s.position.y, z: s.position.z };
};

/**
 * The tapping beginner holding a hover where it is (pilot-r1 simRig.ts tapPilot): position and ground velocity to an
 * attitude, the attitude change to a tap, the pedal keys on the heading error (|e| / 60 s), F5 / F6 on height and sink.
 */
export function hoverBeginner(r: KeyRig, keys: Keys, interval = 0.8, lag = 0.3) {
  const s0 = snap(r), buf: Snap[] = [], nLag = Math.round(lag / FRAME);
  let next = r.t + interval;
  return (): void => {
    buf.push(snap(r));
    if (r.t < next) return;
    next += interval;
    const s = buf.length > nLag ? buf[buf.length - 1 - nLag] : buf[0];
    const ch = Math.cos(s.hdg), sh = Math.sin(s.hdg);
    const vf = s.vx * ch + s.vy * sh, vr = -s.vx * sh + s.vy * ch;
    const xf = (s.x - s0.x) * ch + (s.y - s0.y) * sh, xr = -(s.x - s0.x) * sh + (s.y - s0.y) * ch;
    const pitchCmd = clamp(s0.pitch + 0.03 * vf + 0.015 * xf, s0.pitch - 10 * DEG, s0.pitch + 10 * DEG);
    const rollCmd = clamp(s0.roll - 0.03 * vr - 0.015 * xr, s0.roll - 10 * DEG, s0.roll + 10 * DEG);
    const dPitch = (pitchCmd - s.pitch - 0.4 * s.q) / DEG, dRoll = (rollCmd - s.roll - 0.3 * s.p) / DEG;
    const tapFor = (deg: number): number => clamp(Math.abs(deg) / 9, 0.1, 0.6);
    if (Math.abs(dPitch) > 1) keys.tap(dPitch > 0 ? 'ArrowDown' : 'ArrowUp', tapFor(dPitch));
    if (Math.abs(dRoll) > 1) keys.tap(dRoll > 0 ? 'ArrowRight' : 'ArrowLeft', tapFor(dRoll));
    const e = wrap(s.hdg - s0.hdg) / DEG + 0.7 * s.r / DEG;
    if (Math.abs(e) > 3) keys.tap(e > 0 ? 'KeyZ' : 'KeyX', clamp(Math.abs(e) / 60, 0.1, 0.5));
    const hold = clamp(-(0.1 * (s0.z - s.z) - 0.2 * s.vz), -0.5, 0.5);
    if (Math.abs(hold) > 0.08) keys.tap(hold > 0 ? 'F6' : 'F5', Math.abs(hold));
  };
}

/** Lost: crashed, more than `driftLimitM` (30 m) from where it started, or more than 30 deg of attitude. */
export interface HoverResult { lostS: number | null; crashed: boolean; flownS: number; driftM: number; maxAttDeg: number; maxHdgDeg: number }

/** Fly `seconds` with `step` (the beginner, or nothing) before each frame; measured from now. */
export function flyHover(r: KeyRig, keys: Keys, seconds: number, step?: () => void, driftLimitM = 30): HoverResult {
  const s0 = snap(r), t0 = r.t;
  let driftM = 0, maxAttDeg = 0, maxHdgDeg = 0, lostS: number | null = null;
  while (r.t - t0 < seconds - FRAME / 2) {
    step?.(); keys.update(); frame(r);
    const s = r.physics.state;
    driftM = Math.max(driftM, Math.hypot(s.position.x - s0.x, s.position.y - s0.y));
    maxAttDeg = Math.max(maxAttDeg, Math.abs(s.roll) / DEG, Math.abs(s.pitch) / DEG);
    maxHdgDeg = Math.max(maxHdgDeg, Math.abs(wrap(s.heading - s0.hdg)) / DEG);
    if (s.crashed || driftM > driftLimitM || maxAttDeg > 30) { lostS = r.t - t0; break; }
  }
  keys.releaseAll();
  return { lostS, crashed: r.physics.state.crashed, flownS: r.t - t0, driftM, maxAttDeg, maxHdgDeg };
}

/** Runway start: F6 held (and KeyZ for the first `pedalS` s) until the CG is 0.9 m up; the lift-off time, s. */
export function liftOffKeys(r: KeyRig, keys: Keys, pedalS = 0): number {
  while (r.t < 30) {
    keys.tap('F6', FRAME * 2);
    if (pedalS > 0 && r.t < pedalS) keys.tap('KeyZ', FRAME * 2);
    keys.update(); frame(r);
    const s = r.physics.state;
    if (s.crashed) return NaN;
    if (!s.onGround && s.altitudeAGL > 0.9) { keys.releaseAll(); return r.t; }
  }
  return NaN;
}

/**
 * The round-2 gate's keyboard deceleration (pilot-r2 decel.test.ts): from `kias` level at 30 m the beginner taps the
 * nose up `noseUpDeg` while the ground speed is over 8 kt (trim + 2 deg under it), keeps the wings level, the heading
 * and the height with taps every `interval` s (0.3 s late). `stopKt`: the ground speed (magnitude) below which it stops
 * (returns); `onStop` may then press A (the hover hold) instead of letting go. Returns the stop time, or null.
 */
export function decelKeys(r: KeyRig, keys: Keys, o: { interval: number; noseUpDeg: number; stopKt: number; maxS?: number }): number | null {
  const s0 = snap(r), buf: Snap[] = [], nLag = Math.round(0.3 / FRAME);
  let next = r.t + 1;
  while (r.t < (o.maxS ?? 60)) {
    buf.push(snap(r));
    const sNow = r.physics.state;
    if (Math.hypot(sNow.velocity.x, sNow.velocity.y) / KT < o.stopKt && r.t > 3) return r.t;
    if (r.t >= next) {
      next += o.interval;
      const s = buf.length > nLag ? buf[buf.length - 1 - nLag] : buf[0];
      const gs = (s.vx * Math.cos(s.hdg) + s.vy * Math.sin(s.hdg)) / KT;
      const dPitch = (s0.pitch + (gs > 8 ? o.noseUpDeg : 2) * DEG - s.pitch - 0.4 * s.q) / DEG;
      if (Math.abs(dPitch) > 1) keys.tap(dPitch > 0 ? 'ArrowDown' : 'ArrowUp', clamp(Math.abs(dPitch) / 9, 0.1, 0.6));
      const dRoll = (-s.roll - 0.3 * s.p) / DEG;
      if (Math.abs(dRoll) > 1.5) keys.tap(dRoll > 0 ? 'ArrowRight' : 'ArrowLeft', clamp(Math.abs(dRoll) / 9, 0.1, 0.4));
      const e = wrap(s.hdg - s0.hdg) / DEG + 0.7 * s.r / DEG;
      if (Math.abs(e) > 3) keys.tap(e > 0 ? 'KeyZ' : 'KeyX', clamp(Math.abs(e) / 60, 0.1, 0.5));
      const hold = clamp(-(0.1 * (s0.z - s.z) - 0.2 * s.vz), -0.5, 0.5);
      if (Math.abs(hold) > 0.08) keys.tap(hold > 0 ? 'F6' : 'F5', Math.abs(hold));
    }
    keys.update(); frame(r);
    if (r.physics.state.crashed) return null;
  }
  return null;
}
