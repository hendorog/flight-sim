// Pilot head dynamics for the cockpit camera.
//
// The head is modelled as a mass on a damped spring (the neck and seat) attached to the cabin. Its
// equilibrium displacement is proportional to the specific force at the eye relative to steady 1 g, so it
// sinks under positive g, slides sideways in skids and roll transients, and moves forward under braking.
// On top of that come small vibrations: turbulence, stall buffet and ground roll. Everything is in body
// axes (FRD, metres / radians) with no three.js dependency.

import { clamp, G0, type Vec3 } from '../../core/math';
import type { AircraftState, SurfaceType } from '../../core/types';
import { C172S_CAMERA } from './aircraft';

/** Head displacement per g of specific-force change, m/g (seat cushion and neck compliance). */
const GAIN = { x: 0.035, y: 0.05, z: 0.03 };
/** Travel limits, m. */
const LIMIT = { x: 0.08, y: 0.08, z: 0.07 };
/** Neck/seat natural frequency (Hz) and damping ratio. */
const OMEGA = 2 * Math.PI * 2.0;
const ZETA = 0.65;
/** Lateral lean toward the inside of a turn per unit sin(bank), m. */
const TURN_LEAN = 0.05;

/** Ground-roll vibration by surface: rougher surfaces shake more. */
const SURFACE_ROUGHNESS: Record<SurfaceType, number> = {
  runway: 0.25,
  taxiway: 0.35,
  grass: 1,
  dirt: 1.2,
  rock: 1.5,
  snow: 0.6,
  water: 0.8,
};

/** Smooth band-limited pseudo-noise from incommensurate sines; `seed` decorrelates channels. Range ~[-1, 1]. */
export function smoothNoise(t: number, freq: number, seed: number): number {
  const w = 2 * Math.PI * freq * t;
  return (
    0.5 * Math.sin(w + seed * 1.7) +
    0.3 * Math.sin(w * 1.618 + seed * 4.1) +
    0.2 * Math.sin(w * 2.718 + seed * 2.3)
  );
}

export interface HeadOutput {
  /** Eye displacement from the design eye point, body FRD, m. */
  offset: Vec3;
  /** Small rotational shake, rad: about body x (roll), y (pitch), z (yaw). */
  shake: Vec3;
}

export class HeadMotion {
  readonly out: HeadOutput = { offset: { x: 0, y: 0, z: 0 }, shake: { x: 0, y: 0, z: 0 } };
  /** Spring state: head position and velocity relative to the design eye point. */
  private readonly pos = { x: 0, y: 0, z: 0 };
  private readonly vel = { x: 0, y: 0, z: 0 };
  private readonly target = { x: 0, y: 0, z: 0 };
  private readonly prevOmega = { x: 0, y: 0, z: 0 };
  private readonly omegaDot = { x: 0, y: 0, z: 0 };
  private t = 0;
  private primed = false;

  /** @param eye the pilot's design eye point, body FRD, m: where the cabin's rotation is felt */
  constructor(public eye: Readonly<Vec3> = C172S_CAMERA.pilotEye) {}

  /** Vertical velocity kick (m/s, + = down) for a touchdown thump. */
  bump(sinkRate: number): void {
    this.vel.z += clamp(sinkRate * 0.12, 0, 0.4);
  }

  reset(): void {
    this.pos.x = this.pos.y = this.pos.z = 0;
    this.primed = false;
    this.vel.x = this.vel.y = this.vel.z = 0;
  }

  update(dt: number, s: AircraftState, turbulence: number, surface: SurfaceType): HeadOutput {
    if (dt <= 0) return this.out;
    this.t += dt;
    const target = this.equilibrium(dt, s);
    const p = this.pos;

    // Semi-implicit Euler in sub-steps of at most 5 ms keeps the 2 Hz spring stable at any frame rate.
    const n = Math.ceil(dt / 0.005);
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.vel.x += (-OMEGA * OMEGA * (p.x - target.x) - 2 * ZETA * OMEGA * this.vel.x) * h;
      this.vel.y += (-OMEGA * OMEGA * (p.y - target.y) - 2 * ZETA * OMEGA * this.vel.y) * h;
      this.vel.z += (-OMEGA * OMEGA * (p.z - target.z) - 2 * ZETA * OMEGA * this.vel.z) * h;
      p.x += this.vel.x * h;
      p.y += this.vel.y * h;
      p.z += this.vel.z * h;
    }
    p.x = clamp(p.x, -LIMIT.x, LIMIT.x);
    p.y = clamp(p.y, -LIMIT.y, LIMIT.y);
    p.z = clamp(p.z, -LIMIT.z, LIMIT.z);

    this.vibrate(s, turbulence, surface);
    return this.out;
  }

  /**
   * Spring equilibrium: specific force at the eye (CG specific force plus the rotational terms
   * omega_dot x r + omega x (omega x r)) minus steady 1 g, scaled by the compliance gains.
   */
  private equilibrium(dt: number, s: AircraftState): Readonly<Vec3> {
    const w = s.angularVelocity;
    if (!this.primed) {
      // Differentiate from the first sample on, not from an assumed zero rate.
      Object.assign(this.prevOmega, w);
      this.primed = true;
    }
    const a = clamp(dt / 0.05, 0, 1); // low-pass the differentiated rates: physics rates are sampled per frame
    this.omegaDot.x += ((w.x - this.prevOmega.x) / dt - this.omegaDot.x) * a;
    this.omegaDot.y += ((w.y - this.prevOmega.y) / dt - this.omegaDot.y) * a;
    this.omegaDot.z += ((w.z - this.prevOmega.z) / dt - this.omegaDot.z) * a;
    this.prevOmega.x = w.x;
    this.prevOmega.y = w.y;
    this.prevOmega.z = w.z;

    const r = this.eye;
    const wd = this.omegaDot;
    // omega_dot x r
    let ax = wd.y * r.z - wd.z * r.y;
    let ay = wd.z * r.x - wd.x * r.z;
    let az = wd.x * r.y - wd.y * r.x;
    // omega x (omega x r)
    const cx = w.y * r.z - w.z * r.y;
    const cy = w.z * r.x - w.x * r.z;
    const cz = w.x * r.y - w.y * r.x;
    ax += w.y * cz - w.z * cy;
    ay += w.z * cx - w.x * cz;
    az += w.x * cy - w.y * cx;

    const f = s.specificForce;
    const dfx = clamp(f.x + ax / G0, -3, 3);
    const dfy = clamp(f.y + ay / G0, -3, 3);
    const dfz = clamp(f.z + az / G0 + 1, -3, 3);
    // The head moves opposite to the specific force (it is left behind by the accelerating cabin).
    const tg = this.target;
    tg.x = -dfx * GAIN.x;
    tg.y = -dfy * GAIN.y + TURN_LEAN * Math.sin(clamp(s.roll, -1.2, 1.2));
    tg.z = -dfz * GAIN.z;
    return tg;
  }

  private vibrate(s: AircraftState, turbulence: number, surface: SurfaceType): void {
    const t = this.t;
    const q = clamp(s.ias / 50, 0, 1.5);
    const turb = turbulence * q * (s.onGround ? 0.3 : 1);
    const buffet = s.stallFraction;
    const ground = s.onGround ? clamp(s.groundSpeed / 20, 0, 1.2) * SURFACE_ROUGHNESS[surface] : 0;
    const p = this.pos;
    const o = this.out.offset;
    o.x = p.x + 0.004 * turb * smoothNoise(t, 1.9, 1) + 0.002 * buffet * smoothNoise(t, 11, 2);
    o.y = p.y + 0.007 * turb * smoothNoise(t, 2.3, 3) + 0.003 * buffet * smoothNoise(t, 9, 4) + 0.0015 * ground * smoothNoise(t, 13, 9);
    o.z = p.z + 0.009 * turb * smoothNoise(t, 2.9, 5) + 0.006 * buffet * smoothNoise(t, 8.5, 6) + 0.004 * ground * smoothNoise(t, 15, 7);
    const sh = this.out.shake;
    sh.x = 0.006 * turb * smoothNoise(t, 1.3, 11) + 0.004 * buffet * smoothNoise(t, 7, 12) + 0.0015 * ground * smoothNoise(t, 11, 17);
    sh.y = 0.004 * turb * smoothNoise(t, 1.7, 13) + 0.005 * buffet * smoothNoise(t, 10, 14) + 0.002 * ground * smoothNoise(t, 14, 18);
    sh.z = 0.003 * turb * smoothNoise(t, 1.1, 15) + 0.002 * buffet * smoothNoise(t, 6, 16);
  }
}
