import { clamp, quat, v3, type Vec3 } from '../../core/math';
import type { ControlInputs } from '../../core/types';
import type { BodyState, ForceMoment } from '../interfaces';
import type { EngineUnit } from '../propulsion/engineUnit';
import { cyclicAngles, emptyRotorcraftState, type RotorcraftDefinition } from './definition';
import { emptyTurboshaftState, TurboshaftControl } from './turboshaft';
import { bladeElements, inflowTarget, inflowTimeConstant } from './rotor';
import { airframeLoads } from './airframe';
import { placardMap } from './limits';
import { estimatedArticulatedGeometry, flapForcing, advanceFlap, hingeMoment } from './articulated';
import { pressureAltitude } from '../atmosphere';
import type { AtmosphereSample } from '../../core/types';
import { articulatedBladeConing, bladeConing } from './coning';
import { toBody, toShaft } from './shaftFrame';

export class Rotorcraft {
  readonly state = emptyRotorcraftState();
  readonly angularMomentum = v3.zero();
  /** Read-only diagnostic output; never fed back to the pilot or used to clamp energy. Power in W; flow/time diagnostics in SI. */
  readonly power = { mainShaft: 0, mainThrust: 0, mainH: 0, mainInduced: 0, mainProfile: 0, vortexCorrection: 0,
    tailShaft: 0, tailThrust: 0, tailH: 0, tailInduced: 0, tailProfile: 0, tailWake: 0,
    fuselage: 0, stabilizer: 0, fins: 0, moments: 0, driveReaction: 0,
    axial: 0, horizontal: 0, inflow: 0, groundEffect: 1, inflowTau: 0 };
  /** Articulated hub work exchanged with the shaft. Separate diagnostics keep the legacy
   * power/state objects byte-for-byte compatible. Not an extra force or attitude damping. */
  readonly articulatedPower = { hub: 0, shaft: 0 };
  readonly drivePower = { aerodynamic: 0, rotorChange: 0, clutch: 0, integration: 0 };
  private readonly loads: ForceMoment = { force: v3.zero(), moment: v3.zero() };
  /** Turboshaft fuel control and N2 governor (systems.turboshaft): the flight model calls its stepTurboshaft()
   * in place of throttle(). Null on piston installations. */
  readonly turboshaft: TurboshaftControl | null;
  constructor(readonly def: RotorcraftDefinition) {
    this.turboshaft = def.systems.turboshaft ? new TurboshaftControl(def, this.state) : null;
  }
  reset(running: boolean): void {
    delete this.state.turboshaft;
    delete this.state.articulated; delete this.state.contactRotor;
    delete this.state.transmission; delete this.state.springTrim; delete this.state.clutchDisengaged;
    Object.assign(this.state, emptyRotorcraftState());
    this.state.omega = running ? this.def.nominalRpm * Math.PI / 30 : 0;
    this.state.governorThrottle = this.state.governorIntegral = running ? 0.55 : 0;
    this.state.clutchEngagement = running ? 1 : 0;
    this.state.rotorRpm = this.state.omega * 30 / Math.PI;
    if (this.def.transmission) {
      this.state.transmission = { oilPressurePsi: running ? this.def.transmission.pressurePsi : 0,
        oilTemperatureC: 15, tailChips: false };
      this.state.clutchDisengaged = !running;
    }
    if (this.def.systems.drive === 'freewheel') {
      // A sprag clutch has no actuator: always engaged, no light, no disengaged switch.
      this.state.clutchEngagement = 1;
      delete this.state.clutchDisengaged;
    }
    if (this.def.systems.turboshaft) this.state.turboshaft = emptyTurboshaftState(this.def.systems.turboshaft, running);
    if (this.def.controlSystem.springTrim) this.state.springTrim = { pitch: 0, roll: 0, pitchForce: 0, rollForce: 0 };
    if (this.def.hubModel?.kind === 'articulated') this.state.articulated = {
      blades: Array.from({ length: this.def.main.blades }, () => ({
        flap: this.def.hubModel?.kind === 'articulated' && this.def.hubModel.coning
          ? bladeConing(this.def.hubModel.coning, this.state.omega, 0).angle : 0,
        lag: 0, pitch: 0 })),
    };
  }
  /** Collective moves the throttle linkage; governor trims the grip above its engagement RPM.
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
    s.governorActive = d.systems.governorInstalled !== false && c.rotorGovernor !== false && c.masterBattery &&
      engine.rpm > d.systems.governorEngage * d.referenceRpm * d.engineRatio;
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
  /** Mechanical switch estimate; panel must combine with bus power. Separate from actuator light.
   * The actual 269 microswitch rigging threshold has not been measured. */
  get clutchDisengaged(): boolean { return this.state.clutchEngagement < 0.999; }
  /** One-way clutch impulse conserves angular momentum (gear ratio reflected), with transmission loss.
   * Called after the engine's free shaft step. The freewheel cannot back-drive a stopped/slow engine.
   */
  drive(dt: number, c: ControlInputs, engine: EngineUnit, atmosphere?: AtmosphereSample,
    clutchCommand?: 'engage' | 'hold' | 'release', busVoltage?: number, onGround = false): void {
    if (this.def.systems.drive === 'freewheel') { this.driveFreewheel(dt, c, engine, atmosphere, busVoltage, onGround); return; }
    const s = this.state, d = this.def;
    clutchCommand ??= c.rotorClutchCommand;
    const inertia = d.main.inertia + d.tail.inertia * d.tailRatio ** 2;
    const oldOmega = s.omega;
    s.omega = Math.max(0, s.omega - s.torque * dt / inertia);
    const freeOmega = s.omega;
    // Optional three-position command: explicit HOLD retains the current belt tension.
    // The boolean path is unchanged for existing controls/saves. The 269 UI bridge must supply
    // this command each step; it is not private state and never repurposes clutchLight.
    const actuatorPower = clutchCommand !== undefined && busVoltage !== undefined ? busVoltage > 18 : c.masterBattery;
    const target = clutchCommand === 'hold' ? s.clutchEngagement : clutchCommand === 'engage' ? 1 :
      clutchCommand === 'release' ? 0 : c.rotorClutch !== false ? 1 : 0;
    if (actuatorPower) s.clutchEngagement += clamp(target - s.clutchEngagement,
      -dt / d.systems.clutchSeconds, dt / d.systems.clutchSeconds);
    s.clutchLight = actuatorPower && Math.abs(target - s.clutchEngagement) > 1e-6;
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
    s.lowRpm = s.rotorRpm < d.referenceRpm * d.systems.lowRpmWarning;
    s.lowRpmLight = s.lowRpm && c.masterBattery;
    s.lowRpmHorn = s.lowRpmLight && (c.collective ?? 0) > d.systems.hornCollectiveMin;
    const map = d.manifoldLimits && atmosphere ? placardMap(d.manifoldLimits,
      pressureAltitude(atmosphere.pressure), atmosphere.temperature) : Infinity;
    const atOperatingRpm = engine.rpm > d.systems.powerCheckMinRpm * d.referenceRpm * d.engineRatio;
    const highMap = atOperatingRpm && engine.state.manifoldPressure > map;
    s.takeoffPowerSeconds = engine.state.power > d.systems.continuousPower || highMap ? s.takeoffPowerSeconds + dt : 0;
    s.powerLimitExceeded = engine.state.power > d.systems.takeoffPower * 1.01 ||
      (atOperatingRpm && engine.state.manifoldPressure > map + (d.manifoldLimits?.takeoffIncrease ?? 0) + 0.05) ||
      s.takeoffPowerSeconds > d.systems.takeoffSeconds;
    s.azimuth = (s.azimuth + d.rotation * s.omega * dt) % (2 * Math.PI);
    if (s.transmission && d.transmission && dt > 0) {
      const t = s.transmission, p = d.transmission;
      // Rotor-driven pump keeps pressure in autorotation, independent of engine oil/bus.
      t.oilPressurePsi += (p.pressurePsi * clamp(s.rotorRpm / p.pumpRpm, 0, 1) - t.oilPressurePsi) *
        (1 - Math.exp(-dt / p.pressureSeconds));
      const heat = Math.abs(s.torque * s.omega) * (1 / d.transmissionEfficiency - 1);
      const target = (atmosphere?.temperature ?? 288.15) - 273.15 + heat / p.cooling;
      t.oilTemperatureC += (target - t.oilTemperatureC) * (1 - Math.exp(-dt * p.cooling / p.heatCapacity));
      s.clutchDisengaged = this.clutchDisengaged;
    }
    if (s.springTrim && d.controlSystem.springTrim && dt > 0) {
      const t = s.springTrim, p = d.controlSystem.springTrim;
      if (busVoltage !== undefined ? busVoltage > 18 : c.masterBattery) {
        t.pitch = clamp(t.pitch + clamp(c.cyclicTrimPitch ?? 0, -1, 1) * p.rate * dt, -1, 1);
        t.roll = clamp(t.roll + clamp(c.cyclicTrimRoll ?? 0, -1, 1) * p.rate * dt, -1, 1);
      }
      // Force on the stick, not an aerodynamic moment. Position-controlled hardware holds
      // its commanded position; the keyboard's released centre follows these spring anchors.
      t.pitchForce = p.force * (t.pitch - c.elevator);
      t.rollForce = p.force * (t.roll - c.aileron);
    }
  }
  /**
   * Overrunning (sprag) clutch between the engine output shaft and the transmission (systems.drive 'freewheel', the
   * MD 500E): the same one-way impulse coupling as the belt path, with no actuator (always engaged) and the
   * transmission torque limit as the cap. The engine can drive the rotor but never be driven by it: in autorotation
   * and at shutdown the rotor overruns and the needles split. Then the turboshaft's gauges and warnings.
   */
  private driveFreewheel(dt: number, c: ControlInputs, engine: EngineUnit, atmosphere?: AtmosphereSample, busVoltage?: number,
    onGround = false): void {
    const s = this.state, d = this.def;
    const inertia = d.main.inertia + d.tail.inertia * d.tailRatio ** 2;
    const oldOmega = s.omega;
    s.omega = Math.max(0, s.omega - s.torque * dt / inertia);
    const freeOmega = s.omega;
    s.clutchEngagement = 1; s.clutchLight = false;
    const excess = engine.omega - s.omega * d.engineRatio;
    const impulse = excess > 0
      ? Math.min(excess / (1 / engine.inertia + d.transmissionEfficiency * d.engineRatio ** 2 / inertia),
        (d.systems.transmissionTorqueLimit ?? Infinity) * dt) : 0;
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
    s.azimuth = (s.azimuth + d.rotation * s.omega * dt) % (2 * Math.PI);
    if (s.transmission && d.transmission && dt > 0) {
      const t = s.transmission, p = d.transmission;
      t.oilPressurePsi += (p.pressurePsi * clamp(s.rotorRpm / p.pumpRpm, 0, 1) - t.oilPressurePsi) *
        (1 - Math.exp(-dt / p.pressureSeconds));
      const heat = Math.abs(s.torque * s.omega) * (1 / d.transmissionEfficiency - 1);
      const target = (atmosphere?.temperature ?? 288.15) - 273.15 + heat / p.cooling;
      t.oilTemperatureC += (target - t.oilTemperatureC) * (1 - Math.exp(-dt * p.cooling / p.heatCapacity));
    }
    const volts = busVoltage ?? (c.masterBattery ? 24 : 0);
    if (s.springTrim && d.controlSystem.springTrim && dt > 0) {
      const t = s.springTrim, p = d.controlSystem.springTrim;
      if (volts > 18) {
        t.pitch = clamp(t.pitch + clamp(c.cyclicTrimPitch ?? 0, -1, 1) * p.rate * dt, -1, 1);
        t.roll = clamp(t.roll + clamp(c.cyclicTrimRoll ?? 0, -1, 1) * p.rate * dt, -1, 1);
      }
      t.pitchForce = p.force * (t.pitch - c.elevator);
      t.rollForce = p.force * (t.roll - c.aileron);
    }
    if (this.turboshaft) this.turboshaft.publish(dt, c, engine, volts, onGround);
    else {
      s.lowRpm = s.rotorRpm < d.referenceRpm * d.systems.lowRpmWarning;
      s.lowRpmLight = s.lowRpm && volts > 18;
      s.lowRpmHorn = s.lowRpmLight && (c.collective ?? 0) > d.systems.hornCollectiveMin;
    }
  }
  /** The thrust axis follows cyclic with a finite teetering response and aerodynamic blowback.
   * Each RK stage sees its own air velocity. Only stage zero advances flap/inflow states.
   */
  compute(b: BodyState, wind: Vec3, density: number, height: number, c: ControlInputs, dt: number): ForceMoment {
    const d = this.def, s = this.state;
    const air = v3.sub(b.velocityBody, quat.rotateInv(b.orientation, wind));
    const mainArm = v3.sub(d.main.hub, b.cgOffset);
    // A tilted shaft: the main rotor works in the shaft frame (toShaft / toBody); untilted types use the body's
    // vectors themselves, so their arithmetic is unchanged.
    const tilt = d.shaftTilt ?? 0;
    const hubAir = tilt ? toShaft(v3.add(air, v3.cross(b.angularVelocity, mainArm)), tilt) : v3.add(air, v3.cross(b.angularVelocity, mainArm));
    const rate = tilt ? toShaft(b.angularVelocity, tilt) : b.angularVelocity;
    const cyclic = d.cyclicLimits ? cyclicAngles(d, c) : undefined;
    const articulated = d.hubModel?.kind === 'articulated'
      ? estimatedArticulatedGeometry(d.main, d.hubModel.flapHingeOffset, d.hubModel.lagHingeOffset) : undefined;
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
    const targetForward = (cyclic ? -cyclic.aft : -c.elevator * d.cyclicLimit) * cyclicGain - (blowback + s.retreatingFlap) * ux - lateral * uy;
    const targetRight = (cyclic ? cyclic.right : c.aileron * d.cyclicLimit) - (blowback + s.retreatingFlap) * uy + lateral * ux;
    // Averaged first-harmonic free-hinge equation: time constant 16/(Lock number × rotor speed).
    // Blade flapping inertia is half the polar inertia for this two-blade rotor. No fitted body damping.
    const lock = density * d.main.liftSlope * d.main.chord * d.main.radius ** 4 / (d.main.inertia / d.main.blades);
    // No rotating-rotor aerodynamic response at zero RPM. The articulated solver also
    // preserves its stopped pose; it has separate flap pins and no centre teeter stop.
    const tau = s.omega > 0 ? 16 / (lock * s.omega) : Infinity;
    const lag = 1 - Math.exp(-dt / tau);
    if (articulated) {
      // Small-angle, attached-flow harmonic articulated hub. The physical 90-degree pitch-link
      // mapping is an installation estimate; centrifugal detuning produces the actual flap phase.
      // This deliberately does not claim per-blade transient lag or blade-stop/ground resonance.
      const forcing = flapForcing(d.main, articulated, s.omega, density, collective,
        cyclic ? d.rotation * cyclic.right : d.rotation * c.aileron * d.cyclicLimit,
        cyclic ? -d.rotation * cyclic.aft : -d.rotation * c.elevator * d.cyclicLimit,
        hubAir, s.inflow, rate, d.rotation);
      const flap = advanceFlap(articulated, s.omega, forcing,
        { cone: s.coning, cosine: -s.flapForward, sine: s.flapRight }, d.rotation, dt, rate.z);
      if (dt > 0) {
        // Slow-amplitude reduction: all persistent coordinates already belong to RotorcraftState.
        // Zero-dt RK queries do not advance them; no private array can escape snapshot/reset.
        s.flapForward = -flap.cosine; s.flapRight = flap.sine; s.coning = flap.cone;
        s.teeterAngle = 0; s.retreatingFlap = 0;
      }
    } else if (dt > 0) {
      if (s.omega > 0) {
        s.flapForward += (targetForward - s.flapForward + (rate.y + rate.z * s.flapRight) * tau) * lag;
        s.flapRight += (targetRight - s.flapRight - (rate.x + rate.z * s.flapForward) * tau) * lag;
      } else {
        // Finite zero-speed limit of body-axis transport: lim(tau * (1 - exp(-dt/tau))) = dt.
        s.flapForward += (rate.y + rate.z * s.flapRight) * dt;
        s.flapRight -= (rate.x + rate.z * s.flapForward) * dt;
      }
      s.teeterAngle = Math.atan(Math.hypot(s.flapForward, s.flapRight));
      if (s.teeterAngle > d.teeterLimit) {
        if (s.rotorRpm > 0.5 * d.referenceRpm) s.mastBump = true;
        // Mechanical stops bound the undamaged hub at low RPM too. Preserve the existing rotating
        // stop-impact damage above, before limiting its pose. The stop angle remains an estimate;
        // stop friction and azimuth-resolved blade sailing are not modelled (R22 POH 7-2).
        const scale = Math.tan(d.teeterLimit) / Math.hypot(s.flapForward, s.flapRight);
        s.flapForward *= scale; s.flapRight *= scale; s.teeterAngle = d.teeterLimit;
      }
    }
    const axis = v3.normalize({ x: s.flapForward, y: s.flapRight, z: -1 });
    const axial = v3.dot(hubAir, axis);
    const inPlane = v3.sub(hubAir, v3.scale(axis, axial));
    const horizontal = v3.len(inPlane);
    const shaftHubMoment = articulated ? hingeMoment(articulated, d.main.blades, s.omega,
      { cone: s.coning, cosine: -s.flapForward, sine: s.flapRight }) : v3.zero();
    const hubMoment = tilt ? toBody(shaftHubMoment, tilt) : shaftHubMoment;
    this.articulatedPower.hub = v3.dot(shaftHubMoment, rate);
    this.articulatedPower.shaft = -this.articulatedPower.hub;
    const hubTorque = s.omega > 0 ? this.articulatedPower.hub / s.omega : 0;
    const main = bladeElements(d.main, s.omega, collective, axial, horizontal, s.inflow, density, 12, 16, true);
    const h = Math.max(0.3 * d.main.radius, height - quat.rotate(b.orientation, d.main.hub).z);
    // NDARC TP-2015-218751 §12-4.1.2: constant-thrust induced-velocity factor (exponent 3/2).
    // Use the wake's angle to the ground normal; an upward autorotative wake gets no image correction.
    const wake = quat.rotate(b.orientation, tilt ? toBody(v3.add(hubAir, v3.scale(axis, s.inflow)), tilt) : v3.add(hubAir, v3.scale(axis, s.inflow)));
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
    const tailPitch = d.tail.minPitch + (1 - clamp(c.rudder, -1, 1) * d.rotation) * 0.5 * (d.tail.maxPitch - d.tail.minPitch);
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
      driveReaction: d.rotation * s.driveTorque * rate.z,
      axial, horizontal, inflow: s.inflow, groundEffect: ge, inflowTau,
    });
    if (dt > 0) {
      if (!articulated) {
        const coneTarget = main.coningMoment / Math.max(d.main.inertia * s.omega * s.omega, 1);
        s.coning += (clamp(coneTarget, -0.15, 0.3) - s.coning) * lag;
        const stallTarget = 16 * main.stallMoment /
          Math.max(density * d.main.liftSlope * d.main.chord * d.main.radius ** 4 * s.omega ** 2, 1);
        s.retreatingFlap += (clamp(stallTarget, 0, 0.2) - s.retreatingFlap) * lag;
      }
      s.inflow += (targetInflow * ge * (d.main.inducedFactor ?? 1) - s.inflow) * (1 - Math.exp(-dt / inflowTau));
      s.tailInflow += (inflowTarget(tail.thrust, density, d.tail.radius, tailAir.y * d.rotation,
        tailHorizontal) - s.tailInflow) * (1 - Math.exp(-dt / 0.08));
    }
    const shaftForce = v3.scale(axis, thrust);
    if (horizontal > 0) Object.assign(shaftForce, v3.sub(shaftForce, v3.scale(inPlane, main.inPlane / horizontal)));
    const mainForce = tilt ? toBody(shaftForce, tilt) : shaftForce;
    const tailForce = { x: tailHForce.x, y: tail.thrust * d.rotation, z: tailHForce.z };
    const frame = airframeLoads(d, b, air, density, s.inflow, s.tailInflow);
    Object.assign(this.power, frame.power);
    const f = this.loads.force, m = this.loads.moment;
    Object.assign(f, v3.add(v3.add(mainForce, tailForce), frame.force));
    Object.assign(m, v3.add(v3.add(v3.cross(mainArm, mainForce), v3.cross(tailArm, tailForce)), frame.moment));
    if (tilt) {
      // The drive torque reacts about the tilted shaft.
      m.x -= d.rotation * s.driveTorque * Math.sin(tilt); m.z += d.rotation * s.driveTorque * Math.cos(tilt);
    } else m.z += d.rotation * s.driveTorque;
    if (articulated) {
      Object.assign(m, v3.add(m, hubMoment));
    }
    // The freely teetering rotor carries H, but transfers no bending moment through its centre hinge.
    // Its aerodynamic reorientation moment minus body-frame dH/dt equals w×H. Account for both here;
    // the rigid-body Euler term subtracts w×H. Keeping just the latter would invent rigid-hub control.
    Object.assign(this.angularMomentum, v3.scale(tilt ? toBody(axis, tilt) : axis, d.rotation * d.main.inertia * s.omega));
    Object.assign(m, v3.add(m, v3.cross(b.angularVelocity, this.angularMomentum)));
    s.thrust = thrust; s.tailThrust = tail.thrust; s.torque = main.torque + tail.torque * d.tailRatio;
    // The massless harmonic reduction retains no flap kinetic-energy store. Offset hinge work
    // therefore exchanges with shaft work explicitly. This preserves the reduced work budget;
    // it is not a full transient blade/body energy or angular-momentum solution.
    if (articulated) s.torque += hubTorque;
    s.stalledFraction = main.stalledFraction;
    // BEM integrates moment about the shaft. Transfer it to ONE blade's flap hinge.
    const coning = d.hubModel?.kind === 'articulated' ? d.hubModel.coning : undefined;
    // Like the harmonic coordinates, poses advance only on a real step. RK force queries
    // and snapshot restoration must not replace the published pose with a different stage.
    if (dt > 0) this.publishBlades(c, quat.rotateInv(b.orientation, { x: 0, y: 0, z: 9.80665 }).z,
      coning ? (main.coningMoment - coning.hingeRadius * main.thrust) / d.main.blades : undefined);
    return this.loads;
  }
  /** Physical poses around the load solver's harmonic flap, without changing its load coordinates.
   * Explicit mean moment is per blade, about the flap hinge. Fixtures without BEM use thrust at .75R. */
  publishBlades(c: ControlInputs, normalGravity = 9.80665, meanMoment?: number): void {
    const s = this.state, d = this.def, a = s.articulated;
    if (!a) return;
    const coning = d.hubModel?.kind === 'articulated' ? d.hubModel.coning : undefined;
    a.blades.forEach((b, i) => {
      const phase = i * 2 * Math.PI / d.main.blades, psi = s.azimuth + phase - Math.PI / 2;
      const harmonic = -s.flapForward * Math.cos(psi) + s.flapRight * Math.sin(psi);
      b.flap = coning ? articulatedBladeConing(coning, s.omega, s.thrust / d.main.blades,
        harmonic, normalGravity, meanMoment).angle : s.coning + harmonic;
      b.lag = 0; // Coupled lag experiment rejected; see docs/s269-integration.md.
      const cyclic = d.cyclicLimits ? cyclicAngles(d, c) : undefined;
      b.pitch = d.main.minPitch + clamp(c.collective ?? 0, 0, 1) * (d.main.maxPitch - d.main.minPitch) +
        (cyclic ? d.rotation * (cyclic.right * Math.cos(psi) - cyclic.aft * Math.sin(psi))
          : d.rotation * d.cyclicLimit * (c.aileron * Math.cos(psi) - c.elevator * Math.sin(psi)));
    });
  }
  /** Converge the slow aerodynamic states at a held pose/RPM for the numerical trim solver. */
  settle(b: BodyState, wind: Vec3, density: number, height: number, c: ControlInputs, powered = true): ForceMoment {
    const s = this.state, d = this.def;
    s.driveTorque = 0; s.coning = 0; s.retreatingFlap = 0;
    if (d.cyclicLimits) { const cyclic = cyclicAngles(d, c); s.flapForward = -cyclic.aft; s.flapRight = cyclic.right; }
    else { s.flapForward = -c.elevator * d.cyclicLimit; s.flapRight = c.aileron * d.cyclicLimit; }
    s.inflow = s.tailInflow = s.omega > 0 ? 5 : 0;
    for (let i = 0; i < 160; i++) this.compute(b, wind, density, height, c, 0.05);
    s.mastBump = false;
    s.driveTorque = powered ? s.torque : 0;
    return this.compute(b, wind, density, height, c, 0);
  }
}
