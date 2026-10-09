import { clamp, quat, v3, type Vec3 } from '../../core/math';
import type { ControlInputs } from '../../core/types';
import type { BodyState, ForceMoment } from '../interfaces';
import type { EngineUnit } from '../propulsion/engineUnit';
import { emptyRotorcraftState, type RotorcraftDefinition } from './definition';
import { bladeElements, inflowTarget, inflowTimeConstant } from './rotor';
import { airframeLoads } from './airframe';
import { placardMap } from './limits';
import { pressureAltitude } from '../atmosphere';
import type { AtmosphereSample } from '../../core/types';

export class Rotorcraft {
  readonly state = emptyRotorcraftState();
  readonly angularMomentum = v3.zero();
  /** Read-only diagnostic output; never fed back to the pilot or used to clamp energy. Power in W; flow/time diagnostics in SI. */
  readonly power = { mainShaft: 0, mainThrust: 0, mainH: 0, mainInduced: 0, mainProfile: 0, vortexCorrection: 0,
    tailShaft: 0, tailThrust: 0, tailH: 0, tailInduced: 0, tailProfile: 0, tailWake: 0,
    fuselage: 0, stabilizer: 0, fins: 0, moments: 0, driveReaction: 0,
    axial: 0, horizontal: 0, inflow: 0, groundEffect: 1, inflowTau: 0 };
  readonly drivePower = { aerodynamic: 0, rotorChange: 0, clutch: 0, integration: 0 };
  private readonly loads: ForceMoment = { force: v3.zero(), moment: v3.zero() };
  constructor(readonly def: RotorcraftDefinition) {}
  reset(running: boolean): void {
    Object.assign(this.state, emptyRotorcraftState());
    this.state.omega = running ? this.def.nominalRpm * Math.PI / 30 : 0;
    this.state.governorThrottle = this.state.governorIntegral = running ? 0.55 : 0;
    this.state.clutchEngagement = running ? 1 : 0;
    this.state.rotorRpm = this.state.omega * 30 / Math.PI;
  }
  /** Collective moves the throttle linkage; governor trims the grip above 80% engine RPM.
   * A moving grip overrides the servo. Full closed is the overtravel stop, defeating correlation.
   */
  throttle(dt: number, c: ControlInputs, engine: EngineUnit): number {
    const s = this.state, d = this.def;
    const collective = clamp(c.collective ?? 0, 0, 1);
    const manual = c.throttle - s.previousThrottle;
    const correlation = d.systems.correlator * (collective - s.previousCollective);
    const override = Math.abs(manual) > 1e-6;
    s.governorIntegral = clamp(s.governorIntegral + manual + correlation, 0, 1);
    s.governorThrottle = clamp(s.governorThrottle + manual + correlation, 0, 1);
    s.previousThrottle = c.throttle; s.previousCollective = collective;
    s.governorActive = c.rotorGovernor !== false && c.masterBattery &&
      engine.rpm > 0.8 * d.referenceRpm * d.engineRatio;
    if (c.throttle <= 0) s.governorThrottle = s.governorIntegral = 0;
    else if (s.governorActive && !override) {
      const coupled = s.clutchEngagement > 0.99 && engine.rpm >= s.rotorRpm * d.engineRatio - 5;
      const reflected = (d.main.inertia + d.tail.inertia * d.tailRatio ** 2) / (d.transmissionEfficiency * d.engineRatio ** 2);
      const acceleration = coupled ? (engine.shaftTorque - s.torque / (d.engineRatio * d.transmissionEfficiency)) /
        (engine.inertia + reflected) * 30 / Math.PI : 0;
      const error = (d.nominalRpm * d.engineRatio - engine.rpm - (d.systems.governorLead ?? 0) * acceleration) /
        (d.referenceRpm * d.engineRatio);
      s.governorIntegral = clamp(s.governorIntegral + (d.systems.governorIntegralGain ?? 1.8) * error * dt, 0, 1);
      const target = clamp(s.governorIntegral + (d.systems.governorGain ?? 1.6) * error, 0, 1);
      s.governorThrottle += clamp(target - s.governorThrottle, -d.systems.governorRate * dt, d.systems.governorRate * dt);
    } else s.governorIntegral = s.governorThrottle;
    return s.governorThrottle;
  }
  /** One-way clutch impulse conserves angular momentum (gear ratio reflected), with transmission loss.
   * Called after the engine's free shaft step. The freewheel cannot back-drive a stopped/slow engine.
   */
  drive(dt: number, c: ControlInputs, engine: EngineUnit, atmosphere?: AtmosphereSample): void {
    const s = this.state, d = this.def;
    const inertia = d.main.inertia + d.tail.inertia * d.tailRatio ** 2;
    const oldOmega = s.omega;
    s.omega = Math.max(0, s.omega - s.torque * dt / inertia);
    const freeOmega = s.omega;
    const target = c.rotorClutch !== false ? 1 : 0;
    if (c.masterBattery) s.clutchEngagement += clamp(target - s.clutchEngagement,
      -dt / d.systems.clutchSeconds, dt / d.systems.clutchSeconds);
    s.clutchLight = c.masterBattery && Math.abs(target - s.clutchEngagement) > 1e-6;
    const excess = engine.omega - s.omega * d.engineRatio;
    const impulse = excess > 0
      ? Math.min(excess / (1 / engine.inertia + d.transmissionEfficiency * d.engineRatio ** 2 / inertia),
        d.systems.beltTorque * s.clutchEngagement ** 2 * dt) : 0;
    engine.omega -= impulse / engine.inertia;
    s.omega += impulse * d.engineRatio * d.transmissionEfficiency / inertia;
    s.driveTorque = dt > 0 ? impulse * d.engineRatio * d.transmissionEfficiency / dt : 0;
    if (dt > 0) {
      this.drivePower.aerodynamic = -s.torque * oldOmega;
      this.drivePower.rotorChange = 0.5 * inertia * (s.omega ** 2 - oldOmega ** 2) / dt;
      this.drivePower.clutch = 0.5 * inertia * (s.omega ** 2 - freeOmega ** 2) / dt;
      this.drivePower.integration = 0.5 * inertia * (freeOmega ** 2 - oldOmega ** 2) / dt - this.drivePower.aerodynamic;
    }
    engine.state.rpm = engine.rpm;
    s.rotorRpm = s.omega * 30 / Math.PI;
    s.lowRpm = s.rotorRpm < d.referenceRpm * 0.97;
    s.lowRpmHorn = s.lowRpm && (c.collective ?? 0) > 0.02 && c.masterBattery;
    const map = d.manifoldLimits && atmosphere ? placardMap(d.manifoldLimits,
      pressureAltitude(atmosphere.pressure), atmosphere.temperature) : Infinity;
    const atOperatingRpm = engine.rpm > 0.97 * d.referenceRpm * d.engineRatio;
    const highMap = atOperatingRpm && engine.state.manifoldPressure > map;
    s.takeoffPowerSeconds = engine.state.power > d.systems.continuousPower || highMap ? s.takeoffPowerSeconds + dt : 0;
    s.powerLimitExceeded = engine.state.power > d.systems.takeoffPower * 1.01 ||
      (atOperatingRpm && engine.state.manifoldPressure > map + (d.manifoldLimits?.takeoffIncrease ?? 0) + 0.05) ||
      s.takeoffPowerSeconds > d.systems.takeoffSeconds;
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
    const tip = Math.max(s.omega * d.main.radius, 1);
    const lambda = (s.inflow - hubAir.z) / tip;
    const blowback = mu * (8 / 3 * (collective - 0.75 * d.main.twist) + 2 * d.main.twist - 2 * lambda) /
      Math.max(0.5, 1 - 0.5 * mu * mu);
    const speed = Math.hypot(hubAir.x, hubAir.y);
    // Coning plus a skewed inflow gradient produce lateral flapping during transition (CCW: right).
    const skew = speed / (Math.hypot(speed, s.inflow - hubAir.z) + Math.abs(s.inflow - hubAir.z) + 1);
    const lateral = d.rotation * (4 / 3 * mu * s.coning + 0.6 * skew * s.inflow / tip) / (1 + 0.5 * mu * mu);
    const ux = speed > 0 ? hubAir.x / speed : 0, uy = speed > 0 ? hubAir.y / speed : 0;
    const cyclicGain = (1 + 1.5 * mu * mu) / Math.max(0.5, 1 - 0.5 * mu * mu);
    const targetForward = -c.elevator * d.cyclicLimit * cyclicGain - (blowback + s.retreatingFlap) * ux - lateral * uy;
    const targetRight = c.aileron * d.cyclicLimit - (blowback + s.retreatingFlap) * uy + lateral * ux;
    // Averaged first-harmonic free-hinge equation: time constant 16/(Lock number × rotor speed).
    // Blade flapping inertia is half the polar inertia for this two-blade rotor. No fitted body damping.
    const lock = density * d.main.liftSlope * d.main.chord * d.main.radius ** 4 / (d.main.inertia / d.main.blades);
    const tau = 16 / Math.max(lock * s.omega, 4);
    if (dt > 0) {
      const lag = 1 - Math.exp(-dt / tau);
      s.flapForward += (targetForward - s.flapForward + (b.angularVelocity.y + b.angularVelocity.z * s.flapRight) * tau) * lag;
      s.flapRight += (targetRight - s.flapRight - (b.angularVelocity.x + b.angularVelocity.z * s.flapForward) * tau) * lag;
      s.teeterAngle = Math.atan(Math.hypot(s.flapForward, s.flapRight));
      if (s.rotorRpm > 0.5 * d.referenceRpm && s.teeterAngle > d.teeterLimit) s.mastBump = true;
    }
    const axis = v3.normalize({ x: s.flapForward, y: s.flapRight, z: -1 });
    const axial = v3.dot(hubAir, axis);
    const inPlane = v3.sub(hubAir, v3.scale(axis, axial));
    const horizontal = v3.len(inPlane);
    const main = bladeElements(d.main, s.omega, collective, axial, horizontal, s.inflow, density, 12, 16, true);
    const h = Math.max(0.3 * d.main.radius, height - quat.rotate(b.orientation, d.main.hub).z);
    // NDARC TP-2015-218751 §12-4.1.2: constant-thrust induced-velocity factor (exponent 3/2).
    // Use the wake's angle to the ground normal; an upward autorotative wake gets no image correction.
    const wake = quat.rotate(b.orientation, v3.add(hubAir, v3.scale(axis, s.inflow)));
    const wakeCos = clamp(-wake.z / Math.max(v3.len(wake), 1e-6), 0, 1);
    const ge = (1 - (d.main.radius * wakeCos / (4 * h)) ** 2) ** 1.5;
    const vh = Math.sqrt(Math.abs(main.thrust) / Math.max(2 * density * Math.PI * d.main.radius ** 2, 1e-6));
    s.vortexRing = clamp(-axial / Math.max(vh, 1) - 0.4, 0, 1) * clamp(2.3 + axial / Math.max(vh, 1), 0, 1) * clamp(1 - horizontal / 12, 0, 1);
    // VRS is represented by the empirical inflow continuation below. A separate thrust-only
    // multiplier broke the blade-element work identity while leaving shaft torque unchanged.
    const thrust = main.thrust;
    const tailArm = v3.sub(d.tail.hub, b.cgOffset);
    const tailAir = v3.add(air, v3.cross(b.angularVelocity, tailArm));
    // Positive tail thrust acts right: tail arm aft makes nose-left anti-torque for CCW main rotor.
    const tailPitch = d.tail.minPitch + (1 - clamp(c.rudder, -1, 1)) * 0.5 * (d.tail.maxPitch - d.tail.minPitch);
    // Tail disc is on the left; the useful anti-torque force is to the right. Main wake enters its
    // in-plane flow, while signed sideslip enters its axial momentum equation (including adverse flow).
    const wakeAtTail = 0.35 * s.inflow / (1 + (air.x / 18) ** 2);
    const tailHorizontal = Math.hypot(tailAir.x, tailAir.z - wakeAtTail);
    const tail = bladeElements(d.tail, s.omega * d.tailRatio, tailPitch,
      tailAir.y * d.rotation, tailHorizontal, s.tailInflow, density);
    const targetInflow = inflowTarget(main.thrust, density, d.main.radius, axial, horizontal);
    const inflowTau = inflowTimeConstant(d.main.radius, axial, horizontal, targetInflow);
    const tailHForce = tailHorizontal > 0 ? { x: -tail.inPlane * tailAir.x / tailHorizontal, y: 0,
      z: -tail.inPlane * (tailAir.z - wakeAtTail) / tailHorizontal } : v3.zero();
    Object.assign(this.power, {
      mainShaft: -main.torque * s.omega, mainThrust: thrust * axial, mainH: -main.inPlane * horizontal,
      mainInduced: -main.thrust * s.inflow, mainProfile: -main.profilePower,
      vortexCorrection: (thrust - main.thrust) * axial,
      tailShaft: -tail.torque * s.omega * d.tailRatio, tailThrust: tail.thrust * tailAir.y * d.rotation,
      tailH: v3.dot(tailHForce, tailAir), tailInduced: -tail.thrust * s.tailInflow, tailProfile: -tail.profilePower,
      tailWake: tailHForce.z * wakeAtTail,
      driveReaction: d.rotation * s.driveTorque * b.angularVelocity.z,
      axial, horizontal, inflow: s.inflow, groundEffect: ge, inflowTau,
    });
    if (dt > 0) {
      const coneTarget = main.coningMoment / Math.max(d.main.inertia * s.omega * s.omega, 1);
      s.coning += (clamp(coneTarget, -0.15, 0.3) - s.coning) * (1 - Math.exp(-dt / tau));
      const stallTarget = 16 * main.stallMoment /
        Math.max(density * d.main.liftSlope * d.main.chord * d.main.radius ** 4 * s.omega ** 2, 1);
      s.retreatingFlap += (clamp(stallTarget, 0, 0.2) - s.retreatingFlap) * (1 - Math.exp(-dt / tau));
      s.inflow += (targetInflow * ge * (d.main.inducedFactor ?? 1) - s.inflow) * (1 - Math.exp(-dt / inflowTau));
      s.tailInflow += (inflowTarget(tail.thrust, density, d.tail.radius, tailAir.y * d.rotation,
        tailHorizontal) - s.tailInflow) * (1 - Math.exp(-dt / 0.08));
    }
    const mainForce = v3.scale(axis, thrust);
    if (horizontal > 0) Object.assign(mainForce, v3.sub(mainForce, v3.scale(inPlane, main.inPlane / horizontal)));
    const tailForce = { x: tailHForce.x, y: tail.thrust * d.rotation, z: tailHForce.z };
    const frame = airframeLoads(d, b, air, density, s.inflow);
    Object.assign(this.power, frame.power);
    const f = this.loads.force, m = this.loads.moment;
    Object.assign(f, v3.add(v3.add(mainForce, tailForce), frame.force));
    Object.assign(m, v3.add(v3.add(v3.cross(mainArm, mainForce), v3.cross(tailArm, tailForce)), frame.moment));
    m.z += d.rotation * s.driveTorque;
    // The freely teetering rotor carries H, but transfers no bending moment through its centre hinge.
    // Its aerodynamic reorientation moment minus body-frame dH/dt equals w×H. Account for both here;
    // the rigid-body Euler term subtracts w×H. Keeping just the latter would invent rigid-hub control.
    Object.assign(this.angularMomentum, v3.scale(axis, d.rotation * d.main.inertia * s.omega));
    Object.assign(m, v3.add(m, v3.cross(b.angularVelocity, this.angularMomentum)));
    s.thrust = thrust; s.tailThrust = tail.thrust; s.torque = main.torque + tail.torque * d.tailRatio;
    s.stalledFraction = main.stalledFraction;
    return this.loads;
  }
  /** Converge the slow aerodynamic states at a held pose/RPM for the numerical trim solver. */
  settle(b: BodyState, wind: Vec3, density: number, height: number, c: ControlInputs, powered = true): ForceMoment {
    const s = this.state, d = this.def;
    s.driveTorque = 0; s.coning = 0; s.retreatingFlap = 0;
    s.flapForward = -c.elevator * d.cyclicLimit; s.flapRight = c.aileron * d.cyclicLimit;
    s.inflow = 5; s.tailInflow = 5;
    for (let i = 0; i < 160; i++) this.compute(b, wind, density, height, c, 0.05);
    s.mastBump = false;
    s.driveTorque = powered ? s.torque : 0;
    return this.compute(b, wind, density, height, c, 0);
  }
}
