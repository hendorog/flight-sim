import { clamp, quat, v3, type Vec3 } from '../../core/math';
import type { ControlInputs } from '../../core/types';
import type { BodyState, ForceMoment } from '../interfaces';
import type { EngineUnit } from '../propulsion/engineUnit';
import { emptyRotorcraftState, type RotorcraftDefinition } from './definition';
import { bladeElements, inflowTarget } from './rotor';

export class Rotorcraft {
  readonly state = emptyRotorcraftState();
  readonly angularMomentum = v3.zero();
  private readonly loads: ForceMoment = { force: v3.zero(), moment: v3.zero() };
  constructor(readonly def: RotorcraftDefinition) {}
  reset(running: boolean): void {
    Object.assign(this.state, emptyRotorcraftState());
    this.state.omega = running ? this.def.nominalRpm * Math.PI / 30 : 0;
    this.state.governorThrottle = running ? 0.55 : 0;
  }
  /** Governor moves the throttle, never the rotor speed. Pilot throttle limits available opening. */
  throttle(dt: number, c: ControlInputs, engine: EngineUnit): number {
    const s = this.state, d = this.def;
    if (c.rotorGovernor !== false && engine.rpm > 1600) {
      const error = 1 - engine.rpm / (d.nominalRpm * d.engineRatio);
      s.governorThrottle = clamp(s.governorThrottle + clamp(8 * error, -0.6, 0.6) * dt, 0, 1);
      return Math.min(c.throttle, s.governorThrottle);
    }
    s.governorThrottle = c.throttle;
    return c.throttle;
  }
  /** One-way clutch impulse conserves angular momentum (gear ratio reflected), with transmission loss.
   * Called after the engine's free shaft step. The freewheel cannot back-drive a stopped/slow engine.
   */
  drive(dt: number, c: ControlInputs, engine: EngineUnit): void {
    const s = this.state, d = this.def;
    const inertia = d.main.inertia + d.tail.inertia * d.tailRatio ** 2;
    s.omega = Math.max(0, s.omega - s.torque * dt / inertia);
    const excess = engine.omega - s.omega * d.engineRatio;
    const impulse = c.rotorClutch !== false && excess > 0
      ? excess / (1 / engine.inertia + d.transmissionEfficiency * d.engineRatio ** 2 / inertia) : 0;
    engine.omega -= impulse / engine.inertia;
    s.omega += impulse * d.engineRatio * d.transmissionEfficiency / inertia;
    s.driveTorque = dt > 0 ? impulse * d.engineRatio * d.transmissionEfficiency / dt : 0;
    engine.state.rpm = engine.rpm;
    s.rotorRpm = s.omega * 30 / Math.PI;
    s.lowRpm = s.rotorRpm < d.nominalRpm / 1.04 * 0.97 && (c.collective ?? 0) > 0.1;
    s.azimuth = (s.azimuth + d.rotation * s.omega * dt) % (2 * Math.PI);
  }
  /** The thrust axis follows cyclic with a finite teetering response and aerodynamic blowback.
   * Each RK stage sees its own air velocity. Only stage zero advances flap/inflow states.
   */
  compute(b: BodyState, wind: Vec3, density: number, height: number, c: ControlInputs, dt: number): ForceMoment {
    const d = this.def, s = this.state;
    const air = v3.sub(b.velocityBody, quat.rotateInv(b.orientation, wind));
    const mainArm = v3.sub(d.main.hub, b.cgOffset);
    const hubAir = v3.add(air, v3.cross(b.angularVelocity, mainArm));
    const mu = Math.hypot(hubAir.x, hubAir.y) / Math.max(s.omega * d.main.radius, 1);
    const collective = d.main.minPitch + clamp(c.collective ?? 0, 0, 1) * (d.main.maxPitch - d.main.minPitch);
    const blowback = Math.min(0.18, 2 * mu * Math.max(collective, 0));
    const speed = Math.hypot(hubAir.x, hubAir.y);
    const targetForward = -c.elevator * d.cyclicLimit - (speed > 0 ? blowback * hubAir.x / speed : 0);
    const targetRight = c.aileron * d.cyclicLimit - (speed > 0 ? blowback * hubAir.y / speed : 0);
    const tau = d.flapTime * d.nominalRpm / Math.max(100, s.rotorRpm);
    if (dt > 0) {
      const lag = 1 - Math.exp(-dt / tau);
      s.flapForward += (targetForward - s.flapForward + b.angularVelocity.y * tau) * lag;
      s.flapRight += (targetRight - s.flapRight - b.angularVelocity.x * tau) * lag;
    }
    const axis = v3.normalize({ x: s.flapForward, y: s.flapRight, z: -1 });
    const axial = v3.dot(hubAir, axis);
    const inPlane = v3.sub(hubAir, v3.scale(axis, axial));
    const horizontal = v3.len(inPlane);
    const main = bladeElements(d.main, s.omega, collective, axial, horizontal, s.inflow, density);
    const h = Math.max(0.3 * d.main.radius, height - d.main.hub.z);
    // Image-rotor ground effect lowers induced velocity; washes out with translational speed.
    const ge = Math.sqrt(Math.max(0.55, 1 - (d.main.radius / (4 * h)) ** 2 / (1 + (horizontal / 10) ** 2)));
    const vh = Math.sqrt(Math.abs(main.thrust) / Math.max(2 * density * Math.PI * d.main.radius ** 2, 1e-6));
    s.vortexRing = clamp(-axial / Math.max(vh, 1) - 0.4, 0, 1) * clamp(2.3 + axial / Math.max(vh, 1), 0, 1) * clamp(1 - horizontal / 12, 0, 1);
    // Empirical VRS loss: bounded, continuous, no artificial energy supplied to the shaft.
    const thrust = main.thrust * (1 - 0.3 * s.vortexRing);
    const tailArm = v3.sub(d.tail.hub, b.cgOffset);
    const tailAir = v3.add(air, v3.cross(b.angularVelocity, tailArm));
    // Positive tail thrust acts right: tail arm aft makes nose-left anti-torque for CCW main rotor.
    const tailPitch = d.tail.minPitch + (1 - clamp(c.rudder, -1, 1)) * 0.5 * (d.tail.maxPitch - d.tail.minPitch);
    const tail = bladeElements(d.tail, s.omega * d.tailRatio, tailPitch,
      tailAir.y * d.rotation, Math.hypot(tailAir.x, tailAir.z), s.tailInflow, density);
    if (dt > 0) {
      const inflowTau = clamp(d.main.radius / Math.max(2 * vh, 1), 0.06, 1.5);
      s.inflow += (inflowTarget(main.thrust, density, d.main.radius, axial, horizontal) * ge - s.inflow) * (1 - Math.exp(-dt / inflowTau));
      s.tailInflow += (inflowTarget(tail.thrust, density, d.tail.radius, tailAir.y * d.rotation,
        Math.hypot(tailAir.x, tailAir.z)) - s.tailInflow) * (1 - Math.exp(-dt / 0.08));
    }
    const mainForce = v3.scale(axis, thrust);
    if (horizontal > 0) Object.assign(mainForce, v3.sub(mainForce, v3.scale(inPlane, main.inPlane / horizontal)));
    const tailForce = { x: 0, y: tail.thrust * d.rotation, z: 0 };
    const dragAir = v3.add(air, v3.cross(b.angularVelocity, v3.sub(d.dragCentre, b.cgOffset)));
    const drag = { x: -0.5 * density * d.dragArea.x * dragAir.x * Math.abs(dragAir.x),
      y: -0.5 * density * d.dragArea.y * dragAir.y * Math.abs(dragAir.y),
      z: -0.5 * density * d.dragArea.z * dragAir.z * Math.abs(dragAir.z) };
    const f = this.loads.force, m = this.loads.moment;
    Object.assign(f, v3.add(v3.add(mainForce, tailForce), drag));
    Object.assign(m, v3.add(v3.add(v3.cross(mainArm, mainForce), v3.cross(tailArm, tailForce)), v3.cross(v3.sub(d.dragCentre, b.cgOffset), drag)));
    m.z += d.rotation * s.driveTorque;
    // Teetering rotor carries very little hub bending moment. Its attitude follows the body only with lag;
    // effective rate damping is generated by the hub-offset force above, not a stability derivative.
    // Angular momentum is omitted here: a rigid-disc gyro term without dH/dt from flapping double-counts it.
    s.thrust = thrust; s.tailThrust = tail.thrust; s.torque = main.torque + tail.torque * d.tailRatio;
    s.stalledFraction = main.stalledFraction;
    return this.loads;
  }
  /** Converge the slow aerodynamic states at a held pose/RPM for the numerical trim solver. */
  settle(b: BodyState, wind: Vec3, density: number, height: number, c: ControlInputs): ForceMoment {
    const s = this.state, d = this.def;
    s.flapForward = -c.elevator * d.cyclicLimit; s.flapRight = c.aileron * d.cyclicLimit;
    s.inflow = 5; s.tailInflow = 5;
    for (let i = 0; i < 160; i++) this.compute(b, wind, density, height, c, 0.05);
    s.driveTorque = s.torque;
    return this.compute(b, wind, density, height, c, 0);
  }
}
