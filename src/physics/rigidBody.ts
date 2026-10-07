// 6-DOF rigid-body dynamics over plain state objects, for an assembler that integrates with RK4.
//
// Translational motion is integrated in the NED frame (flat, non-rotating earth), rotational motion in
// body axes (FRD) about the centre of gravity:
//   m dV/dt      = R(q) F_body + m g
//   I dw/dt      = M - w x (I w + h_rotor)
//   dq/dt        = 0.5 q (0, w)
// h_rotor is the angular momentum of spinning parts (engine + propeller) relative to the airframe; the
// w x h_rotor term is the gyroscopic coupling that makes the nose yaw when a propeller-driven aircraft
// pitches. The reaction to a CHANGE of rotor speed (engine torque) is a real moment that the propulsion
// model reports in its own moment output, so it is not duplicated here.
//
// The inertia tensor is that of an aircraft with a plane of symmetry: only the Ixz product is non-zero,
// with the aerospace sign convention  I = [[Ixx, 0, -Ixz], [0, Iyy, 0], [-Ixz, 0, Izz]],  Ixz = sum(m x z).

import { G0, quat, type Quat, type Vec3 } from '../core/math';

export interface Inertia {
  Ixx: number;
  Iyy: number;
  Izz: number;
  Ixz: number;
}

export interface RigidBodyState {
  /** CG position, NED m. */
  position: Vec3;
  /** CG velocity, NED m/s. */
  velocity: Vec3;
  /** Body -> NED. */
  orientation: Quat;
  /** Body angular velocity (p, q, r), rad/s. */
  angularVelocity: Vec3;
}

/** Time derivative of a RigidBodyState; the fields mirror the state fields. */
export interface RigidBodyDerivative {
  position: Vec3;
  velocity: Vec3;
  orientation: Quat;
  angularVelocity: Vec3;
}

export interface RigidBodyLoads {
  /** Total external force except gravity, body axes, N. */
  force: Vec3;
  /** Total moment about the CG, body axes, N m. */
  moment: Vec3;
  /** Angular momentum of spinning rotors relative to the airframe, body axes, kg m^2/s. */
  rotorAngularMomentum?: Vec3;
}

/** Derivative of the rigid-body state under the given loads. Gravity acts along NED +z. */
export function rigidBodyDerivative(
  s: RigidBodyState,
  mass: number,
  inertia: Inertia,
  loads: RigidBodyLoads,
  gravity: number = G0,
): RigidBodyDerivative {
  const fNed = quat.rotate(s.orientation, loads.force);
  const { x: p, y: q, z: r } = s.angularVelocity;
  const { Ixx, Iyy, Izz, Ixz } = inertia;
  const h = loads.rotorAngularMomentum;
  // Total angular momentum H = I w + h_rotor.
  const Hx = Ixx * p - Ixz * r + (h ? h.x : 0);
  const Hy = Iyy * q + (h ? h.y : 0);
  const Hz = Izz * r - Ixz * p + (h ? h.z : 0);
  // Right-hand side M - w x H.
  const mx = loads.moment.x - (q * Hz - r * Hy);
  const my = loads.moment.y - (r * Hx - p * Hz);
  const mz = loads.moment.z - (p * Hy - q * Hx);
  // Invert the x-z block of the inertia tensor.
  const det = Ixx * Izz - Ixz * Ixz;
  return {
    position: { x: s.velocity.x, y: s.velocity.y, z: s.velocity.z },
    velocity: { x: fNed.x / mass, y: fNed.y / mass, z: fNed.z / mass + gravity },
    orientation: quat.derivative(s.orientation, s.angularVelocity),
    angularVelocity: { x: (Izz * mx + Ixz * mz) / det, y: my / Iyy, z: (Ixz * mx + Ixx * mz) / det },
  };
}

/** s + d * h (quaternion left un-normalised; normalise once per completed step). */
export function advanceState(s: RigidBodyState, d: RigidBodyDerivative, h: number): RigidBodyState {
  return {
    position: { x: s.position.x + d.position.x * h, y: s.position.y + d.position.y * h, z: s.position.z + d.position.z * h },
    velocity: { x: s.velocity.x + d.velocity.x * h, y: s.velocity.y + d.velocity.y * h, z: s.velocity.z + d.velocity.z * h },
    orientation: {
      w: s.orientation.w + d.orientation.w * h,
      x: s.orientation.x + d.orientation.x * h,
      y: s.orientation.y + d.orientation.y * h,
      z: s.orientation.z + d.orientation.z * h,
    },
    angularVelocity: {
      x: s.angularVelocity.x + d.angularVelocity.x * h,
      y: s.angularVelocity.y + d.angularVelocity.y * h,
      z: s.angularVelocity.z + d.angularVelocity.z * h,
    },
  };
}

/**
 * One classical Runge-Kutta 4 step. `derivative(state, stage)` evaluates the loads at an intermediate
 * state; `stage` is 0..3 and the time offsets are 0, h/2, h/2, h. The returned quaternion is normalised.
 */
export function rk4Step(
  s: RigidBodyState,
  h: number,
  derivative: (state: RigidBodyState, stage: number) => RigidBodyDerivative,
): RigidBodyState {
  const k1 = derivative(s, 0);
  const k2 = derivative(advanceState(s, k1, h / 2), 1);
  const k3 = derivative(advanceState(s, k2, h / 2), 2);
  const k4 = derivative(advanceState(s, k3, h), 3);
  const w = h / 6;
  const comb = (a: number, b: number, c: number, d: number) => (a + 2 * b + 2 * c + d) * w;
  const v = (f: (k: RigidBodyDerivative) => Vec3): Vec3 => {
    const a = f(k1), b = f(k2), c = f(k3), d = f(k4);
    return { x: comb(a.x, b.x, c.x, d.x), y: comb(a.y, b.y, c.y, d.y), z: comb(a.z, b.z, c.z, d.z) };
  };
  const dp = v((k) => k.position);
  const dv = v((k) => k.velocity);
  const dw = v((k) => k.angularVelocity);
  const q1 = k1.orientation, q2 = k2.orientation, q3 = k3.orientation, q4 = k4.orientation;
  return {
    position: { x: s.position.x + dp.x, y: s.position.y + dp.y, z: s.position.z + dp.z },
    velocity: { x: s.velocity.x + dv.x, y: s.velocity.y + dv.y, z: s.velocity.z + dv.z },
    orientation: quat.normalize({
      w: s.orientation.w + comb(q1.w, q2.w, q3.w, q4.w),
      x: s.orientation.x + comb(q1.x, q2.x, q3.x, q4.x),
      y: s.orientation.y + comb(q1.y, q2.y, q3.y, q4.y),
      z: s.orientation.z + comb(q1.z, q2.z, q3.z, q4.z),
    }),
    angularVelocity: { x: s.angularVelocity.x + dw.x, y: s.angularVelocity.y + dw.y, z: s.angularVelocity.z + dw.z },
  };
}

/**
 * Parallel-axis shift of an inertia tensor known about a reference point to the CG, where the CG lies at
 * `cgOffset` from that point and `mass` is the total mass.
 */
export function inertiaAboutCG(inertiaAboutRef: Inertia, mass: number, cgOffset: Vec3): Inertia {
  const { x, y, z } = cgOffset;
  return {
    Ixx: inertiaAboutRef.Ixx - mass * (y * y + z * z),
    Iyy: inertiaAboutRef.Iyy - mass * (x * x + z * z),
    Izz: inertiaAboutRef.Izz - mass * (x * x + y * y),
    Ixz: inertiaAboutRef.Ixz - mass * x * z,
  };
}

/** Rotational kinetic energy 0.5 w.I.w, J (useful for integrator checks). */
export function rotationalEnergy(w: Vec3, I: Inertia): number {
  return 0.5 * (I.Ixx * w.x * w.x + I.Iyy * w.y * w.y + I.Izz * w.z * w.z - 2 * I.Ixz * w.x * w.z);
}
