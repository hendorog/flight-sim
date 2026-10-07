import { describe, expect, it } from 'vitest';
import { G0, quat, v3, type Vec3 } from '../../src/core/math';
import {
  inertiaAboutCG,
  rigidBodyDerivative,
  rk4Step,
  rotationalEnergy,
  type Inertia,
  type RigidBodyLoads,
  type RigidBodyState,
} from '../../src/physics/rigidBody';

const I: Inertia = { Ixx: 1285, Iyy: 1825, Izz: 2667, Ixz: 120 };
const noLoads: RigidBodyLoads = { force: v3.zero(), moment: v3.zero() };

function state(w: Vec3 = v3.zero()): RigidBodyState {
  return { position: v3.zero(), velocity: { x: 50, y: 0, z: 0 }, orientation: quat.fromEuler(0.1, 0.05, 1), angularVelocity: w };
}

function angularMomentumNED(s: RigidBodyState, inertia: Inertia): Vec3 {
  const { x: p, y: q, z: r } = s.angularVelocity;
  return quat.rotate(s.orientation, { x: inertia.Ixx * p - inertia.Ixz * r, y: inertia.Iyy * q, z: inertia.Izz * r - inertia.Ixz * p });
}

describe('rigid body', () => {
  it('falls at g with no loads', () => {
    const d = rigidBodyDerivative(state(), 1000, I, noLoads);
    expect(d.velocity.z).toBeCloseTo(G0, 9);
    expect(d.velocity.x).toBeCloseTo(0, 9);
    expect(d.position.x).toBe(50);
  });

  it('rotates body forces into NED', () => {
    const s = { ...state(), orientation: quat.fromEuler(0, 0, Math.PI / 2) };
    const d = rigidBodyDerivative(s, 1000, I, { force: { x: 1000, y: 0, z: 0 }, moment: v3.zero() }, 0);
    // Heading east: body x is NED y.
    expect(d.velocity.y).toBeCloseTo(1, 9);
    expect(d.velocity.x).toBeCloseTo(0, 9);
  });

  it('conserves energy and angular momentum in torque-free tumbling (with Ixz)', () => {
    let s = state({ x: 0.8, y: 0.3, z: -0.5 });
    const e0 = rotationalEnergy(s.angularVelocity, I);
    const h0 = angularMomentumNED(s, I);
    for (let k = 0; k < 4000; k++) s = rk4Step(s, 0.0025, (st) => rigidBodyDerivative(st, 1000, I, noLoads, 0));
    expect(rotationalEnergy(s.angularVelocity, I) / e0).toBeCloseTo(1, 6);
    const h1 = angularMomentumNED(s, I);
    expect(v3.len(v3.sub(h1, h0)) / v3.len(h0)).toBeLessThan(1e-6);
    expect(Math.hypot(s.orientation.w, s.orientation.x, s.orientation.y, s.orientation.z)).toBeCloseTo(1, 12);
  });

  it('couples pitch into yaw through the propeller angular momentum (clockwise from the cockpit)', () => {
    // Clockwise seen from the cockpit = right-handed about +x.
    const h = { x: 0.3 * 280, y: 0, z: 0 };
    const pitchUp = rigidBodyDerivative(state({ x: 0, y: 0.3, z: 0 }), 1000, { ...I, Ixz: 0 }, { ...noLoads, rotorAngularMomentum: h });
    expect(pitchUp.angularVelocity.z).toBeGreaterThan(0); // nose-up pitch -> yaw right
    const yawLeft = rigidBodyDerivative(state({ x: 0, y: 0, z: -0.3 }), 1000, { ...I, Ixz: 0 }, { ...noLoads, rotorAngularMomentum: h });
    expect(yawLeft.angularVelocity.y).toBeGreaterThan(0); // yaw left -> pitch up
  });

  it('shifts inertia to the CG with the parallel-axis theorem', () => {
    const m = 1000;
    const shifted = inertiaAboutCG(I, m, { x: 0.1, y: 0, z: 0.2 });
    expect(shifted.Ixx).toBeCloseTo(I.Ixx - m * 0.04, 9);
    expect(shifted.Iyy).toBeCloseTo(I.Iyy - m * 0.05, 9);
    expect(shifted.Izz).toBeCloseTo(I.Izz - m * 0.01, 9);
    expect(shifted.Ixz).toBeCloseTo(I.Ixz - m * 0.02, 9);
  });
});
