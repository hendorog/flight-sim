// The AH-56A keyboard beginner (tuning round 2, the Fable pilot gate's beginner side): the REAL SimPhysics and InputSystem of
// the Bo 105 lane's rig (tests/rotorcraft/bo105KeyPilot.ts keyRig, 60 frames per second, the STAB ASSIST linked as the
// Simulator links it), flown by a WATCHING beginner rather than a timed tapper. The Bo 105 helper's 0.1-0.6 s taps were sized for
// a position-command cyclic (about 9 deg per 1 s tap); on the AH-56A's re-centring, rate-command keyboard cyclic a 0.3 s tap is
// nothing at all, so the helper measures the aid alone. A first-time laptop pilot instead presses a key and WATCHES: holds it
// until the nose (wings, heading, climb) looks right, then lets go. Here:
//  - the pilot sees the state `lag` s late (0.3 s), decides to press only every `interval` s (0.8 s), one key per axis;
//  - a pressed key is held until the seen error, led by the seen rate, comes inside the release band, or `maxHold` s pass
//    (2 s for the cyclic and pedals, 1 s for the collective), and then not pressed again on that axis for `gap` s (0.3 s);
//  - outer loops in pilot terms: the speed by the pitch (0.25 deg per kt from the hover attitude, +/- 10 deg), a position by
//    the attitude (the Bo 105 helper's law), the heading by the pedals below 25 kt and by a bank above it, the height by a
//    climb rate (0.15 m/s per m, +/- 2 m/s) on F5 / F6.
// Deliberately no trim keys, no snaps, no anticipation beyond the seen rate: what the owner (no helicopter experience,
// keyboard and trackpad) does on the first day. Pilot units throughout (deg, kt, m).
import { DEG, KT, clamp } from '../../src/core/math';
import { FRAME, frame, type KeyRig } from './bo105KeyPilot';

const wrapDeg = (a: number): number => Math.atan2(Math.sin(a * DEG), Math.cos(a * DEG)) / DEG;

/** What the pilot reads, pilot units; positions in m (north, east, up). */
export interface Seen { t: number; kias: number; gs: number; vf: number; vr: number; agl: number; up: number; climb: number; north: number; east: number;
  pitch: number; roll: number; hdg: number; p: number; q: number; r: number; onGround: boolean; crashed: boolean }
export function see(r: KeyRig): Seen {
  const s = r.physics.state, h = s.heading, ch = Math.cos(h), sh = Math.sin(h);
  return { t: r.t, kias: s.ias / KT, gs: s.groundSpeed / KT, vf: (s.velocity.x * ch + s.velocity.y * sh) / KT, vr: (-s.velocity.x * sh + s.velocity.y * ch) / KT,
    agl: s.altitudeAGL, up: -s.position.z, climb: -s.velocity.z, north: s.position.x, east: s.position.y,
    pitch: s.pitch / DEG, roll: s.roll / DEG, hdg: s.heading / DEG, p: s.angularVelocity.x / DEG, q: s.angularVelocity.y / DEG, r: s.angularVelocity.z / DEG,
    onGround: s.onGround, crashed: s.crashed };
}

/** The targets; any left undefined is not flown (its keys stay up). */
export interface Targets {
  /** Hold this attitude, deg. */
  pitch?: number; roll?: number;
  /** Hold this indicated airspeed by the pitch, kt (from the hover attitude, 0.25 deg per kt, +/- 10 deg). */
  kias?: number;
  /** Slow to a hover: the nose `stopDeg` (6) above the hover attitude while the ground speed is over 10 kt, 2 deg under it; below
   *  the bank-for-heading speed the sideways drift is stopped too (the wings from the hover roll by the seen sideways speed, the
   *  holdPos law without the position: tune round 3; before it nothing held the sideways drift in the stop). */
  stop?: boolean;
  /** Hold the position where the pilot was built (the Bo 105 helper's law: ground velocity and offset to an attitude). */
  holdPos?: boolean;
  /** Hold this heading, deg: by the pedals below `pedalKt` (25), by a bank (1 deg per deg, +/- 15) above it. */
  hdg?: number;
  /** Hold this height above the ground, m, or this climb rate, m/s (up positive). */
  agl?: number; climb?: number;
  /** Feet off the pedal keys (the STAB ASSIST's heading hold left to hold the heading below `pedalKt`). */
  feetOff?: boolean;
}

/** One axis: a key pair, the press and release bands and the holds. */
interface Axis { plus: string; minus: string; on: number; off: number; maxHold: number; down: string | null; since: number; lastUp: number }

export class WatchingBeginner {
  private readonly buf: Seen[] = [];
  private readonly nLag: number;
  private next: number;
  private readonly s0: Seen;
  readonly axes: Record<'pitch' | 'roll' | 'yaw' | 'coll', Axis>;
  /** Presses so far, by axis. */
  readonly presses = { pitch: 0, roll: 0, yaw: 0, coll: 0 };
  /** The hover attitude the speed law works from, deg. */
  pitchRef: number;
  /** The hover roll the stop's sideways law works from, deg (default: the roll when the pilot was built). */
  rollRef: number;
  /** Below this ground speed the heading is held by the pedals, kt. */
  pedalKt = 25;
  /** The deceleration attitude above the hover attitude, deg (Targets.stop). */
  stopDeg = 6;

  constructor(private readonly r: KeyRig, public cmd: Targets, readonly interval = 0.8, readonly lag = 0.3, readonly gap = 0.3,
    o: { cyclicHold?: number; pedalHold?: number; collHold?: number } = {}) {
    this.nLag = Math.round(lag / FRAME);
    this.next = r.t + interval;
    this.s0 = see(r);
    this.pitchRef = this.s0.pitch;
    this.rollRef = this.s0.roll;
    const ax = (plus: string, minus: string, on: number, off: number, maxHold: number): Axis => ({ plus, minus, on, off, maxHold, down: null, since: 0, lastUp: -1e9 });
    this.axes = {
      // + = nose up (ArrowDown), roll right, nose right, collective up.
      pitch: ax('ArrowDown', 'ArrowUp', 1.5, 0.5, o.cyclicHold ?? 2),
      roll: ax('ArrowRight', 'ArrowLeft', 2, 0.5, o.cyclicHold ?? 2),
      yaw: ax('KeyX', 'KeyZ', 3, 1, o.pedalHold ?? 2),
      coll: ax('F6', 'F5', 0.5, 0.15, o.collHold ?? 1),
    };
  }

  /** The errors (target minus seen, led by the seen rate) of the axes being flown, from what the pilot sees. */
  private errors(s: Seen): Partial<Record<keyof WatchingBeginner['axes'], number>> {
    const c = this.cmd, e: Partial<Record<keyof WatchingBeginner['axes'], number>> = {};
    let pitch = c.pitch, roll = c.roll;
    if (c.kias !== undefined) pitch = clamp(this.pitchRef - 0.25 * (c.kias - s.kias), this.pitchRef - 10, this.pitchRef + 10);
    if (c.stop) {
      pitch = this.pitchRef + (s.gs > 10 ? this.stopDeg : 2);
      if (s.gs <= this.pedalKt) roll = clamp(this.rollRef - 0.03 * s.vr * KT / DEG, this.rollRef - 10, this.rollRef + 10);
    }
    if (c.holdPos) {
      const s0 = this.s0, ch = Math.cos(s.hdg * DEG), sh = Math.sin(s.hdg * DEG);
      const xf = (s.north - s0.north) * ch + (s.east - s0.east) * sh, xr = -(s.north - s0.north) * sh + (s.east - s0.east) * ch;
      pitch = clamp(s0.pitch + (0.03 * s.vf * KT + 0.015 * xf) / DEG, s0.pitch - 10, s0.pitch + 10);
      roll = clamp(s0.roll - (0.03 * s.vr * KT + 0.015 * xr) / DEG, s0.roll - 10, s0.roll + 10);
    }
    if (c.hdg !== undefined && s.gs > this.pedalKt) roll = clamp(-wrapDeg(s.hdg - c.hdg), -15, 15);
    if (pitch !== undefined) e.pitch = pitch - s.pitch - 0.4 * s.q;
    if (roll !== undefined) e.roll = roll - s.roll - 0.3 * s.p;
    if (c.hdg !== undefined && s.gs <= this.pedalKt && !c.feetOff) e.yaw = -(wrapDeg(s.hdg - c.hdg) + 0.7 * s.r);
    let climb = c.climb;
    if (c.agl !== undefined) climb = clamp(0.15 * (c.agl - s.agl), -2, 2);
    if (climb !== undefined) e.coll = climb - s.climb;
    return e;
  }

  /** Call before every frame: presses on the decision beat, releases whenever the seen error comes inside the band. */
  step(): void {
    const r = this.r;
    this.buf.push(see(r));
    if (this.buf.length > 240) this.buf.shift();
    const s = this.buf.length > this.nLag ? this.buf[this.buf.length - 1 - this.nLag] : this.buf[0];
    const e = this.errors(s);
    const decide = r.t >= this.next - FRAME / 2;
    if (decide) this.next += this.interval;
    for (const k of Object.keys(this.axes) as (keyof WatchingBeginner['axes'])[]) {
      const a = this.axes[k], err = e[k];
      if (a.down !== null) {
        const dir = a.down === a.plus ? 1 : -1;
        if (err === undefined || err * dir < a.off || r.t - a.since >= a.maxHold - FRAME / 2) { r.input.keyUp(a.down); a.down = null; a.lastUp = r.t; }
      } else if (decide && err !== undefined && Math.abs(err) > a.on && r.t - a.lastUp >= this.gap - FRAME / 2) {
        a.down = err > 0 ? a.plus : a.minus; a.since = r.t; this.presses[k]++;
        r.input.keyDown(a.down);
      }
    }
  }

  /** Let go of every key. */
  releaseAll(): void {
    for (const a of Object.values(this.axes)) if (a.down !== null) { this.r.input.keyUp(a.down); a.down = null; a.lastUp = this.r.t; }
  }
}

/** The extremes of a flight segment, pilot units, against a heading and a start position. */
export class Extremes {
  maxAtt = 0; maxRoll = 0; minPitch = 90; maxPitch = -90; maxHdgErr = 0; minAgl = Infinity; maxAgl = 0; maxKias = 0; maxR = 0; drift = 0; maxSinkFpm = 0;
  constructor(private readonly r: KeyRig, readonly hdg0: number, private readonly at = see(r)) {}
  see(): Seen {
    const g = see(this.r), a = this.at;
    this.maxRoll = Math.max(this.maxRoll, Math.abs(g.roll)); this.minPitch = Math.min(this.minPitch, g.pitch); this.maxPitch = Math.max(this.maxPitch, g.pitch);
    this.maxAtt = Math.max(this.maxAtt, Math.abs(g.roll), Math.abs(g.pitch));
    this.maxHdgErr = Math.max(this.maxHdgErr, Math.abs(wrapDeg(g.hdg - this.hdg0)));
    this.minAgl = Math.min(this.minAgl, g.agl); this.maxAgl = Math.max(this.maxAgl, g.agl); this.maxKias = Math.max(this.maxKias, g.kias);
    this.maxR = Math.max(this.maxR, Math.abs(g.r)); this.drift = Math.max(this.drift, Math.hypot(g.north - a.north, g.east - a.east));
    this.maxSinkFpm = Math.max(this.maxSinkFpm, -g.climb * 196.85);
    return g;
  }
}

/** Fly with `pilot` (or hands off) until `until` or `maxS`; a crash ends it. */
export function fly(r: KeyRig, maxS: number, pilot: WatchingBeginner | null, ex?: Extremes, until?: (s: Seen) => boolean): { why: 'done' | 'timeout' | 'crash'; t: number } {
  const t0 = r.t;
  while (r.t - t0 < maxS - FRAME / 2) {
    pilot?.step(); frame(r);
    const s = ex ? ex.see() : see(r);
    if (s.crashed) return { why: 'crash', t: r.t - t0 };
    if (until?.(s)) return { why: 'done', t: r.t - t0 };
  }
  return { why: 'timeout', t: r.t - t0 };
}

/** Runway start: F6 held until the wheels first leave the ground (the lift-off a beginner makes); the time, s, or NaN. */
export function liftToUnload(r: KeyRig, maxS = 40): number {
  r.input.keyDown('F6');
  const t0 = r.t;
  while (r.t - t0 < maxS) {
    frame(r);
    const s = r.physics.state;
    if (s.crashed) break;
    if (!s.onGround) { r.input.keyUp('F6'); return r.t; }
  }
  r.input.keyUp('F6');
  return NaN;
}

export { wrapDeg };
