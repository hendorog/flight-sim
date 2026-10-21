import { clamp, quat, v3, type Vec3 } from '../../core/math';
import type { ControlInputs } from '../../core/types';
import type { BodyState, ForceMoment } from '../interfaces';
import type { EngineUnit } from '../propulsion/engineUnit';
import { cyclicAngles, drivetrainInertia, emptyRotorcraftState, governedRpm, type RotorcraftDefinition } from './definition';
import { emptyTurboshaftState, TurboshaftControl } from './turboshaft';
import { bladeElements, inflowTarget, inflowTimeConstant, tppPitchHarmonic, type RotorLoads } from './rotor';
import { airframeLoads } from './airframe';
import { placardMap } from './limits';
import { estimatedArticulatedGeometry, flapForcing, advanceFlap, harmonicFlap, hingeMoment, hubForcing, flapSystem, aerodynamicHubMoment,
  type ArticulatedGeometry, type FlapHarmonics, type FlapSpring, type HubForcing, type HubForcingOptions } from './articulated';
import { hingelessBlade, hingelessSpring } from './hingeless';
import { swashplateCyclic } from './swashplate';
import { advanceHarmonicInflow } from './inflowHarmonic';
import { pressureAltitude } from '../atmosphere';
import type { AtmosphereSample } from '../../core/types';
import { articulatedBladeConing, bladeConing } from './coning';
import { toBody, toShaft } from './shaftFrame';
import { ControlGyro, type FlapSystem, type GyroAir, type GyroConfigId } from './controlGyro';
import { PusherDrive } from './pusher';
import { HalfPHop } from './halfPHop';
import { emptyTwinTurboshaftState, jointFreewheelImpulse, publishTwin } from './twinTurboshaft';

const NO_H: Readonly<Vec3> = { x: 0, y: 0, z: 0 };

/** Hingeless hub constants (plan revision 2, section 4; RC), fixed by the definition. */
interface HingelessConstants {
  /** Equivalent hinge and the blade moments about it (hingelessBlade: the hub's set, else the uniform estimate). */
  geometry: ArticulatedGeometry;
  /** Kbeta (hingelessSpring) and precone. */
  spring: FlapSpring;
  tanDelta3: number; harmonicInflow: boolean; radialFlow: boolean; bemFromFlap: boolean;
}

/**
 * Add the BEM's in-plane force to `force` (shaft axes): H along the hub's flow through the disc (bladeElements' psi = 0 downwind
 * axis) and the side component along the advancing blade's side. u is the in-plane flow direction (the TPP-plane part of the
 * hub's air velocity; with its (x, y) below 1e-9 m/s the TPP-plane forward direction, as tppPitchHarmonic), s = rotation u x
 * axis (the advancing side: right of the flow for a counter-clockwise rotor); force -= u H + s side.
 */
function inPlaneForce(force: Vec3, axis: Vec3, inPlane: Vec3, h: number, side: number, rotation: 1 | -1): void {
  let ux: number, uy: number, uz: number;
  if (Math.hypot(inPlane.x, inPlane.y) > 1e-9) {
    const n = v3.len(inPlane); ux = inPlane.x / n; uy = inPlane.y / n; uz = inPlane.z / n;
  } else {
    // Forward (shaft x) projected on the tip-path plane.
    const k = axis.x; ux = 1 - k * axis.x; uy = -k * axis.y; uz = -k * axis.z;
    const n = Math.hypot(ux, uy, uz); ux /= n; uy /= n; uz /= n;
  }
  const sx = rotation * (uy * axis.z - uz * axis.y), sy = rotation * (uz * axis.x - ux * axis.z), sz = rotation * (ux * axis.y - uy * axis.x);
  force.x -= ux * h + sx * side; force.y -= uy * h + sy * side; force.z -= uz * h + sz * side;
}

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
  /** Momentum-theory tail inflow for the last compute()'s tail thrust, m/s (settle() solves tailInflow = this). */
  private tailInflowTarget = 0;
  /** Turboshaft fuel control and N2 governor (systems.turboshaft): the flight model calls its stepTurboshaft()
   * in place of throttle(). Null on piston installations. */
  readonly turboshaft: TurboshaftControl | null;
  /**
   * Hingeless / rigid-rotor programme seams (plan revision 2, section 2.4; placed at S0, RC keeps them). Each is null
   * unless the definition declares the feature, so every legacy type runs the old text. controlGyro.ts (AG),
   * pusher.ts (AC), halfPHop.ts (AH).
   */
  readonly gyro: ControlGyro | null;
  readonly pusher: PusherDrive | null;
  readonly halfP: HalfPHop | null;
  /** Compound diagnostics (wing and pusher shaft power, W), separate from the legacy `power` object. */
  readonly compoundPower = { wings: 0, pusher: 0 };
  /** Hingeless hub constants; null on every other hub, whose arithmetic is the legacy text. */
  private readonly hingeless: HingelessConstants | null;
  /**
   * The rotor core's extended path (hubForcing, the BEM options): a hingeless hub, a control gyro or any of the main
   * rotor's grid/section/periodic-damping/cm0 options. False on every legacy type.
   */
  private readonly extended: boolean;
  constructor(readonly def: RotorcraftDefinition) {
    this.turboshaft = def.systems.turboshaft ? new TurboshaftControl(def, this.state) : null;
    this.gyro = def.controlGyro ? new ControlGyro(def, this.state) : null;
    this.pusher = def.pusher ? new PusherDrive(def, this.state) : null;
    this.halfP = def.halfPHop ? new HalfPHop(def, this.state) : null;
    const hub = def.hubModel?.kind === 'hingeless' ? def.hubModel : undefined, m = def.main;
    this.hingeless = hub ? {
      geometry: { flapOffset: hub.equivalentHingeOffset, lagOffset: hub.equivalentHingeOffset, blade: hingelessBlade(def) },
      spring: { stiffness: hingelessSpring(def), precone: hub.precone }, tanDelta3: Math.tan(hub.delta3 ?? 0),
      harmonicInflow: !!hub.harmonicInflow, radialFlow: !!hub.radialFlow, bemFromFlap: hub.bemFromFlap ?? true,
    } : null;
    this.extended = !!(hub || def.controlGyro || m.radialStations !== undefined || m.azimuthStations !== undefined ||
      m.section || m.periodicFlapDamping || m.cm0 !== undefined);
  }
  /** config: the control-gyro configuration (InitialConditions.rotorcraftConfig); forceHalfPHop: the halfp=1 hook. */
  reset(running: boolean, config?: GyroConfigId, forceHalfPHop?: boolean): void {
    delete this.state.harmonicInflow; delete this.state.mastMoment; delete this.state.twinTurboshaft;
    delete this.state.controlGyro; delete this.state.pusher; delete this.state.events;
    delete this.state.turboshaft;
    delete this.state.articulated; delete this.state.contactRotor;
    delete this.state.transmission; delete this.state.springTrim; delete this.state.clutchDisengaged;
    Object.assign(this.state, emptyRotorcraftState());
    this.state.omega = running ? this.def.nominalRpm * Math.PI / 30 : 0;
    if (running && this.def.controlGyro) this.state.omega = governedRpm(this.def, config) * Math.PI / 30;
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
    // Hingeless hub (RC): the per-blade pose block (exterior, resume ARTICULATED_BLADES), the harmonic inflow states
    // and the mast-moment reading, created here and never lazily (plan 3.3).
    const hub = this.def.hubModel;
    if (hub?.kind === 'hingeless') {
      const flap = hub.coning ? bladeConing(hub.coning, this.state.omega, 0).angle : hub.precone;
      this.state.articulated = { blades: Array.from({ length: this.def.main.blades }, () => ({ flap, lag: 0, pitch: 0 })) };
      if (hub.harmonicInflow) this.state.harmonicInflow = { cos: 0, sin: 0 };
      this.state.mastMoment = 0;
      this.state.coning = hub.precone;
    }
    // New optional blocks are created here for the types that declare them, never lazily (plan 3.3).
    if (this.def.systems.twinTurboshaft) this.state.twinTurboshaft = emptyTwinTurboshaftState(this.def, running);
    this.gyro?.reset(running, config);
    this.pusher?.reset(running);
    this.halfP?.reset(forceHalfPHop);
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
    clutchCommand?: 'engage' | 'hold' | 'release', busVoltage?: number, onGround = false,
    extraEngines?: readonly EngineUnit[]): void {
    if (this.def.systems.drive === 'freewheel') { this.driveFreewheel(dt, c, engine, atmosphere, busVoltage, onGround, extraEngines); return; }
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
    onGround = false, extraEngines?: readonly EngineUnit[]): void {
    const s = this.state, d = this.def;
    const inertia = d.pusher ? drivetrainInertia(d) : d.main.inertia + d.tail.inertia * d.tailRatio ** 2;
    const oldOmega = s.omega;
    s.omega = Math.max(0, s.omega - s.torque * dt / inertia);
    const freeOmega = s.omega;
    s.clutchEngagement = 1; s.clutchLight = false;
    // The twin's engine list and impulses live in instance scratch (no allocation per step).
    const twin = d.systems.twinTurboshaft && extraEngines ? this.twinEngines(engine, extraEngines) : null;
    if (twin) {
      // Twin turboshaft (TW's jointFreewheelImpulse): one joint one-way impulse over every engaged engine.
      const impulses = jointFreewheelImpulse(s.omega, inertia, twin, d.engineRatio, d.transmissionEfficiency,
        d.systems.transmissionTorqueLimit ?? Infinity, dt, this.twinImpulses);
      let total = 0;
      for (let i = 0; i < twin.length; i++) { twin[i].omega -= impulses[i] / twin[i].inertia; total += impulses[i]; }
      s.omega += total * d.engineRatio * d.transmissionEfficiency / inertia;
      s.driveTorque = dt > 0 ? total * d.engineRatio * d.transmissionEfficiency / dt : 0;
      for (let i = 1; i < twin.length; i++) twin[i].state.rpm = twin[i].rpm;
    } else {
      const excess = engine.omega - s.omega * d.engineRatio;
      const impulse = excess > 0
        ? Math.min(excess / (1 / engine.inertia + d.transmissionEfficiency * d.engineRatio ** 2 / inertia),
          (d.systems.transmissionTorqueLimit ?? Infinity) * dt) : 0;
      engine.omega -= impulse / engine.inertia;
      s.omega += impulse * d.engineRatio * d.transmissionEfficiency / inertia;
      s.driveTorque = dt > 0 ? impulse * d.engineRatio * d.transmissionEfficiency / dt : 0;
    }
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
    if (this.turboshaft && twin) publishTwin(this.turboshaft, s, dt, c, twin, volts, onGround);
    else if (this.turboshaft) this.turboshaft.publish(dt, c, engine, volts, onGround);
    else {
      s.lowRpm = s.rotorRpm < d.referenceRpm * d.systems.lowRpmWarning;
      s.lowRpmLight = s.lowRpm && volts > 18;
      s.lowRpmHorn = s.lowRpmLight && (c.collective ?? 0) > d.systems.hornCollectiveMin;
    }
  }
  /** [engine, ...extraEngines] in a retained array (written by index: no allocation after the first step). */
  private twinEngines(engine: EngineUnit, extraEngines: readonly EngineUnit[]): EngineUnit[] {
    const list = this.twinList;
    list[0] = engine;
    for (let i = 0; i < extraEngines.length; i++) list[i + 1] = extraEngines[i];
    if (list.length !== extraEngines.length + 1) list.length = extraEngines.length + 1;
    return list;
  }
  private readonly twinList: EngineUnit[] = [];
  /** The extended path's per-step objects, reused (each is read only inside one compute call). */
  private readonly scratch = {
    previous: { cone: 0, cosine: 0, sine: 0 } as FlapHarmonics,
    now: { cone: 0, cosine: 0, sine: 0 } as FlapHarmonics,
    flapRate: { cone: 0, cosine: 0, sine: 0 } as FlapHarmonics,
    options: {} as HubForcingOptions,
    momentOptions: {} as HubForcingOptions,
    forcing: { cone: 0, cosine: 0, sine: 0, damping: 0, stiffness: 0 } as HubForcing,
    spring: { stiffness: 0, precone: 0, aerodynamic: 0 } as FlapSpring,
    theta0: [0, 0] as readonly [number, number],
    system: { a: [0, 0, 0, 0], f: [0, 0], b: [0, 0, 0, 0], theta0: [0, 0], hub: [0, 0, 0, 0] } as FlapSystem,
    air: { hub: NO_H, density: 0 } as GyroAir,
    moment: { x: 0, y: 0 },
  };
  private readonly twinImpulses: number[] = [];
  /** The thrust axis follows cyclic with a finite teetering response and aerodynamic blowback.
   * Each RK stage sees its own air velocity. Only stage zero advances flap/inflow states.
   */
  compute(b: BodyState, wind: Vec3, density: number, height: number, c: ControlInputs, dt: number, soundSpeed?: number): ForceMoment {
    const d = this.def, s = this.state;
    const air = v3.sub(b.velocityBody, quat.rotateInv(b.orientation, wind));
    const mainArm = v3.sub(d.main.hub, b.cgOffset);
    // A tilted shaft: the main rotor works in the shaft frame (toShaft / toBody); untilted types use the body's
    // vectors themselves, so their arithmetic is unchanged.
    const tilt = d.shaftTilt ?? 0;
    const hubAir = tilt ? toShaft(v3.add(air, v3.cross(b.angularVelocity, mainArm)), tilt) : v3.add(air, v3.cross(b.angularVelocity, mainArm));
    const rate = tilt ? toShaft(b.angularVelocity, tilt) : b.angularVelocity;
    // Control gyro (AG): the blade cyclic comes from the gyro, not the stick position.
    // Hingeless hub (RC): the one swashplate law (swashplate.ts), with the control phase.
    const cyclic = this.gyro ? this.gyro.cyclic(c) : this.hingeless ? swashplateCyclic(d, c, s)
      : d.cyclicLimits ? cyclicAngles(d, c) : undefined;
    const hl = this.hingeless;
    const articulated = d.hubModel?.kind === 'articulated'
      ? estimatedArticulatedGeometry(d.main, d.hubModel.flapHingeOffset, d.hubModel.lagHingeOffset) : hl?.geometry;
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
    // Extended path (hingeless hub, control gyro, main-rotor options): the blade cyclic in flapForcing's convention,
    // the spring, and the previous harmonics for the explicit terms and the inflow forcing's flap rates.
    let spring: FlapSpring | undefined, previousFlap: FlapHarmonics | undefined, stoppedFlap: FlapHarmonics | undefined;
    const pitchCos = cyclic ? d.rotation * cyclic.right : d.rotation * c.aileron * d.cyclicLimit;
    const pitchSin = cyclic ? -d.rotation * cyclic.aft : -d.rotation * c.elevator * d.cyclicLimit;
    if (articulated && this.extended) {
      // Per-instance scratch (no allocation per step; each is read only inside this call).
      const x = this.scratch, previous = x.previous, o = x.options;
      previous.cone = s.coning; previous.cosine = -s.flapForward; previous.sine = s.flapRight;
      o.harmonicInflow = s.harmonicInflow; o.flap = previous; o.radialFlow = hl?.radialFlow; o.periodicDamping = d.main.periodicFlapDamping;
      o.tanDelta3 = hl?.tanDelta3; o.section = d.main.section; o.soundSpeed = soundSpeed; o.cm0 = d.main.cm0;
      // The blade feathering moments only where the gyro reads them (the ICS feathering-moment feedback; the AMCS's flapping
      // feedback ignores them): they cost a second section evaluation per element (the flap-rate incidence).
      o.jacobian = !!this.gyro; o.gyro = !!this.gyro && this.gyro.config().feedback.mode === 'featheringMoment';
      const forcing = hubForcing(d.main, articulated, s.omega, density, collective, pitchCos, pitchSin, hubAir, s.inflow,
        rate, d.rotation, o, x.forcing);
      if (hl) { x.spring.stiffness = hl.spring.stiffness; x.spring.precone = hl.spring.precone; x.spring.aerodynamic = forcing.stiffness; }
      spring = hl ? x.spring : undefined;
      // A stopped spring hub carries only its static deflection, also on dt = 0 queries (a resumed save's stale
      // harmonics never reach the hub moment).
      if (spring && !(s.omega > 0)) stoppedFlap = harmonicFlap(articulated, 0, forcing, d.rotation, spring);
      let flap = advanceFlap(articulated, s.omega, forcing, previous, d.rotation, dt, rate.z, spring);
      // Control gyro (AG implements advanceCoupled): gyro tilt and the flap harmonics advance as ONE coupled step in
      // place of advanceFlap's harmonics (never a sequential explicit gyro step: loop gain about 49 rad/s); the cone
      // keeps advanceFlap's pole. A singular reduction (stopped rotor) keeps advanceFlap's static solution.
      if (this.gyro && dt > 0) {
        const theta0 = x.theta0 as [number, number];
        theta0[0] = pitchCos; theta0[1] = pitchSin;
        const system = flapSystem(articulated, s.omega, forcing, d.rotation, rate.z, theta0, d.main.blades, spring, x.system);
        if (system) {
          x.air.hub = hubAir; x.air.density = density;
          const coupled = this.gyro.advanceCoupled(dt, c, rate, system, previous, forcing.blade, x.air);
          // advanceFlap's result is this call's own object: its harmonics are replaced, its cone kept.
          flap.cosine = coupled.cosine; flap.sine = coupled.sine;
        }
      }
      if (dt > 0) {
        s.flapForward = -flap.cosine; s.flapRight = flap.sine; s.coning = flap.cone;
        s.teeterAngle = 0; s.retreatingFlap = 0;
        previousFlap = previous;
      }
    } else if (articulated) {
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
      stoppedFlap ?? { cone: s.coning, cosine: -s.flapForward, sine: s.flapRight }, spring) : v3.zero();
    // Mast-moment indicator (hingeless): |hub moment| in the shaft frame, published on real steps only.
    if (hl && dt > 0) s.mastMoment = Math.hypot(shaftHubMoment.x, shaftHubMoment.y);
    const hubMoment = tilt ? toBody(shaftHubMoment, tilt) : shaftHubMoment;
    this.articulatedPower.hub = v3.dot(shaftHubMoment, rate);
    this.articulatedPower.shaft = -this.articulatedPower.hub;
    const hubTorque = s.omega > 0 ? this.articulatedPower.hub / s.omega : 0;
    const main = this.extended ? this.mainLoads(rate, collective, axial, inPlane, horizontal, density, pitchCos, pitchSin, soundSpeed)
      : bladeElements(d.main, d.yawInRotorSpeed ? Math.max(0, s.omega - d.rotation * rate.z) : s.omega, collective, axial, horizontal, s.inflow, density, 12, 16, true);
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
    const rigged = d.tail.minPitch + (1 - clamp(c.rudder, -1, 1) * d.rotation) * 0.5 * (d.tail.maxPitch - d.tail.minPitch);
    // Control-system flexibility (controlFlex): the blade reaches a fraction of the linkage's travel from the centre.
    const tailPitch = d.controlFlex
      ? (d.tail.minPitch + d.tail.maxPitch) / 2 + d.controlFlex.pedal * (rigged - (d.tail.minPitch + d.tail.maxPitch) / 2) : rigged;
    // Tail disc is on the left; the useful anti-torque force is to the right. Main wake enters its
    // in-plane flow, while signed sideslip enters its axial momentum equation (including adverse flow).
    const wakeAtTail = 0.35 * s.inflow / (1 + (air.x / 18) ** 2);
    const tailHorizontal = Math.hypot(tailAir.x, tailAir.z - wakeAtTail);
    const tail = bladeElements(d.tail, s.omega * d.tailRatio, tailPitch,
      tailAir.y * d.rotation, tailHorizontal, s.tailInflow, density);
    const targetInflow = inflowTarget(main.thrust, density, d.main.radius, axial, horizontal);
    const tailTarget = inflowTarget(tail.thrust, density, d.tail.radius, tailAir.y * d.rotation, tailHorizontal);
    this.tailInflowTarget = tailTarget;
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
      // First-harmonic inflow (RC, inflowHarmonic.ts): forced by the aerodynamic hub moment with this step's flap and
      // flap rates, and the thrust; before the uniform update, which is unchanged.
      if (s.harmonicInflow && articulated) {
        const x = this.scratch, now = x.now, flapRate = x.flapRate, o = x.momentOptions;
        now.cone = s.coning; now.cosine = -s.flapForward; now.sine = s.flapRight;
        const was = previousFlap ?? now;
        flapRate.cone = (now.cone - was.cone) / dt; flapRate.cosine = (now.cosine - was.cosine) / dt; flapRate.sine = (now.sine - was.sine) / dt;
        o.harmonicInflow = s.harmonicInflow; o.radialFlow = hl?.radialFlow; o.tanDelta3 = hl?.tanDelta3; o.section = d.main.section;
        o.soundSpeed = soundSpeed;
        const moment = aerodynamicHubMoment(d.main, articulated, s.omega, density, collective, pitchCos, pitchSin, hubAir,
          s.inflow, rate, d.rotation, d.main.blades, now, flapRate, o, x.moment);
        Object.assign(s.harmonicInflow, advanceHarmonicInflow(s.harmonicInflow, dt, { omega: s.omega, radius: d.main.radius,
          density, inPlane: { x: hubAir.x, y: hubAir.y }, through: targetInflow - hubAir.z, induced: targetInflow,
          thrust: main.thrust, moment }));
      }
      if (!articulated) {
        const coneTarget = main.coningMoment / Math.max(d.main.inertia * s.omega * s.omega, 1);
        s.coning += (clamp(coneTarget, -0.15, 0.3) - s.coning) * lag;
        const stallTarget = 16 * main.stallMoment /
          Math.max(density * d.main.liftSlope * d.main.chord * d.main.radius ** 4 * s.omega ** 2, 1);
        s.retreatingFlap += (clamp(stallTarget, 0, 0.2) - s.retreatingFlap) * lag;
      }
      s.inflow += (targetInflow * ge * (d.main.inducedFactor ?? 1) - s.inflow) * (1 - Math.exp(-dt / inflowTau));
      const tailTau = d.tail.pittPetersInflow
        ? inflowTimeConstant(d.tail.radius, tailAir.y * d.rotation, tailHorizontal, tailTarget) : 0.08;
      s.tailInflow += (tailTarget - s.tailInflow) * (1 - Math.exp(-dt / tailTau));
    }
    const shaftForce = v3.scale(axis, thrust);
    if (this.hingeless?.bemFromFlap && main.side !== undefined) {
      // Hingeless BEM from the solved flap (RC): the whole in-plane force vector, in the same wind frame the harmonic pitch was
      // turned into (tppPitchHarmonic's direction; forward below 1e-9 m/s). A hingeless rotor has a real in-plane force in the
      // hover (its disc tilt against the shaft); the scalar form below pointed it along whatever the first tiny drift was.
      inPlaneForce(shaftForce, axis, inPlane, main.inPlane, main.side, d.rotation);
    } else if (horizontal > 0) Object.assign(shaftForce, v3.sub(shaftForce, v3.scale(inPlane, main.inPlane / horizontal)));
    const mainForce = tilt ? toBody(shaftForce, tilt) : shaftForce;
    const tailForce = { x: tailHForce.x, y: tail.thrust * d.rotation, z: tailHForce.z };
    const frame = airframeLoads(d, b, air, density, s.inflow, s.tailInflow);
    Object.assign(this.power, frame.power);
    if (frame.wings !== undefined) this.compoundPower.wings = frame.wings;
    const f = this.loads.force, m = this.loads.moment;
    Object.assign(f, v3.add(v3.add(mainForce, tailForce), frame.force));
    Object.assign(m, v3.add(v3.add(v3.cross(mainArm, mainForce), v3.cross(tailArm, tailForce)), frame.moment));
    // Pusher propeller (AC): thrust, thrust-offset moment and the shaft reaction torque; its torque joins the shaft below.
    const extra = this.pusher ? this.pusher.compute(b, air, s.omega, density, soundSpeed ?? 340.3, c, dt) : null;
    if (extra) {
      Object.assign(f, v3.add(f, extra.force)); Object.assign(m, v3.add(m, extra.moment));
      this.compoundPower.pusher = extra.power;
    }
    // Scripted half-P hop (AH): body forcing while the event runs.
    if (this.halfP) {
      const e = this.halfP.forcing(b, hubAir, density, c, s.azimuth, dt);
      Object.assign(f, v3.add(f, e.force)); Object.assign(m, v3.add(m, e.moment));
    }
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
    // The control gyro's spin momentum joins the rotor's before the w x H compensation: it is gimballed, so (like the free
    // rotor) it puts no gyroscopic moment on the airframe; its own precession equation carries the body rate, and its gimbal
    // reactions are neglected (docs/control-gyro-model.md).
    if (this.gyro) Object.assign(this.angularMomentum, v3.add(this.angularMomentum, this.gyro.h));
    Object.assign(m, v3.add(m, v3.cross(b.angularVelocity, this.angularMomentum)));
    // The pusher is rigidly mounted: its spin momentum joins the angular momentum the rigid-body equation turns (-w x H) AFTER
    // the compensation, so the airframe feels its gyroscopic reaction -w x h_prop (3,400 N m s at 1,717 rpm: about 1 kN m of
    // yaw-pitch coupling at 0.3 rad/s).
    if (this.pusher) Object.assign(this.angularMomentum, v3.add(this.angularMomentum, this.pusher.h));
    s.thrust = thrust; s.tailThrust = tail.thrust; s.torque = main.torque + tail.torque * d.tailRatio;
    // The massless harmonic reduction retains no flap kinetic-energy store. Offset hinge work
    // therefore exchanges with shaft work explicitly. This preserves the reduced work budget;
    // it is not a full transient blade/body energy or angular-momentum solution.
    if (articulated) s.torque += hubTorque;
    if (extra) s.torque += extra.shaftTorque;
    s.stalledFraction = main.stalledFraction;
    // BEM integrates moment about the shaft. Transfer it to ONE blade's flap hinge.
    const coning = d.hubModel?.kind === 'articulated' || d.hubModel?.kind === 'hingeless' ? d.hubModel.coning : undefined;
    // Like the harmonic coordinates, poses advance only on a real step. RK force queries
    // and snapshot restoration must not replace the published pose with a different stage.
    if (dt > 0) this.publishBlades(c, quat.rotateInv(b.orientation, { x: 0, y: 0, z: 9.80665 }).z,
      coning ? (main.coningMoment - coning.hingeRadius * main.thrust) / d.main.blades : undefined);
    return this.loads;
  }
  /**
   * Main-rotor blade elements on the extended path: the definition's grid (legacy 12 x 16) and section; on a hingeless
   * hub with bemFromFlap (the default) the first-harmonic pitch RELATIVE TO THE TIP-PATH PLANE from the swashplate
   * cyclic and the solved flap harmonics (theta_TPP(psi) = theta_shaft(psi) - rotation d beta / d psi, so a free hinge
   * gets the cancellation of rotor.ts's teetering formula and a stiff hub its real lift moment), turned into the BEM's
   * wind-axis azimuth: psi_BEM = rotation (psi + alpha) + pi with alpha the direction of the tip-path-plane flow; plus
   * the coning's radial-flow term with radialFlow. Other hubs keep the free-hinge cancellation (teetering = true).
   */
  private mainLoads(rate: Vec3, collective: number, axial: number, inPlane: Vec3, horizontal: number, density: number,
    pitchCos: number, pitchSin: number, soundSpeed: number | undefined): RotorLoads {
    const s = this.state, d = this.def, h = this.hingeless, rot = d.rotation;
    const omega = d.yawInRotorSpeed ? Math.max(0, s.omega - d.rotation * rate.z) : s.omega;
    const radial = d.main.radialStations ?? 12, azimuthal = d.main.azimuthStations ?? 16;
    if (!h || !h.bemFromFlap) return bladeElements(d.main, omega, collective, axial, horizontal, s.inflow, density, radial,
      azimuthal, true, { section: d.main.section, soundSpeed });
    return bladeElements(d.main, omega, collective, axial, horizontal, s.inflow, density, radial, azimuthal, false, {
      harmonicPitch: tppPitchHarmonic(rot, pitchCos, pitchSin, -s.flapForward, s.flapRight, inPlane.x, inPlane.y),
      coning: h.radialFlow ? s.coning : 0, section: d.main.section, soundSpeed });
  }
  /** Physical poses around the load solver's harmonic flap, without changing its load coordinates.
   * Explicit mean moment is per blade, about the flap hinge. Fixtures without BEM use thrust at .75R. */
  publishBlades(c: ControlInputs, normalGravity = 9.80665, meanMoment?: number): void {
    const s = this.state, d = this.def, a = s.articulated;
    if (!a) return;
    const coning = d.hubModel?.kind === 'articulated' || d.hubModel?.kind === 'hingeless' ? d.hubModel.coning : undefined;
    a.blades.forEach((b, i) => {
      const phase = i * 2 * Math.PI / d.main.blades, psi = s.azimuth + phase - Math.PI / 2;
      const harmonic = -s.flapForward * Math.cos(psi) + s.flapRight * Math.sin(psi);
      b.flap = coning ? articulatedBladeConing(coning, s.omega, s.thrust / d.main.blades,
        harmonic, normalGravity, meanMoment).angle : s.coning + harmonic;
      b.lag = 0; // Coupled lag experiment rejected; see docs/s269-integration.md.
      const cyclic = this.gyro ? this.gyro.cyclic(c) : this.hingeless ? swashplateCyclic(d, c, s)
        : d.cyclicLimits ? cyclicAngles(d, c) : undefined;
      b.pitch = d.main.minPitch + clamp(c.collective ?? 0, 0, 1) * (d.main.maxPitch - d.main.minPitch) +
        (cyclic ? d.rotation * (cyclic.right * Math.cos(psi) - cyclic.aft * Math.sin(psi))
          : d.rotation * d.cyclicLimit * (c.aileron * Math.cos(psi) - c.elevator * Math.sin(psi)));
    });
  }
  /** settle() with Pitt-Peters tail inflow: its small time constant makes the 50 ms relaxation
   * step a 2-cycle (tail thrust alternating -659/+1102 N about a 100 N trim, MD 500E hover, pedal 0.3).
   * With the body, RPM and main inflow held, the tail's inflow is the root of target(inflow) - inflow;
   * bisect for it. The time constant does not move that root, so the fixed point is the time-stepped one. */
  private solveTailInflow(b: BodyState, wind: Vec3, density: number, height: number, c: ControlInputs, soundSpeed?: number): void {
    const s = this.state;
    const residual = (x: number) => { s.tailInflow = x; this.compute(b, wind, density, height, c, 0, soundSpeed); return this.tailInflowTarget - x; };
    const start = s.tailInflow;
    let lo = -60, hi = 60;
    if (!(residual(lo) > 0 && residual(hi) < 0)) { s.tailInflow = start; return; }
    for (let i = 0; i < 40; i++) {
      const mid = 0.5 * (lo + hi);
      if (residual(mid) > 0) lo = mid; else hi = mid;
    }
    s.tailInflow = 0.5 * (lo + hi);
  }
  /** Converge the slow aerodynamic states at a held pose/RPM for the numerical trim solver. soundSpeed: the atmosphere's, m/s, as
   *  compute() takes it (the section model's and the pusher's Mach numbers); absent, their 340.3 default. */
  settle(b: BodyState, wind: Vec3, density: number, height: number, c: ControlInputs, powered = true, soundSpeed?: number): ForceMoment {
    const s = this.state, d = this.def;
    s.driveTorque = 0; s.coning = 0; s.retreatingFlap = 0;
    this.gyro?.seed(c);
    if (this.gyro) { const cyclic = this.gyro.cyclic(c); s.flapForward = -cyclic.aft; s.flapRight = cyclic.right; }
    else if (this.hingeless) {
      // Hingeless: the control phase through the one swashplate law.
      const cyclic = swashplateCyclic(d, c, s); s.flapForward = -cyclic.aft; s.flapRight = cyclic.right;
    } else if (d.cyclicLimits) { const cyclic = cyclicAngles(d, c); s.flapForward = -cyclic.aft; s.flapRight = cyclic.right; }
    else { s.flapForward = -c.elevator * d.cyclicLimit; s.flapRight = c.aileron * d.cyclicLimit; }
    // Hingeless (with or without a gyro): the cone from its precone, the harmonic inflow re-seeded.
    if (this.hingeless) {
      s.coning = this.hingeless.spring.precone;
      if (s.harmonicInflow) { s.harmonicInflow.cos = 0; s.harmonicInflow.sin = 0; }
    }
    s.inflow = s.tailInflow = s.omega > 0 ? 5 : 0;
    for (let i = 0; i < 160; i++) this.compute(b, wind, density, height, c, 0.05, soundSpeed);
    if (d.tail.pittPetersInflow) this.solveTailInflow(b, wind, density, height, c, soundSpeed);
    s.mastBump = false;
    s.driveTorque = powered ? s.torque : 0;
    return this.compute(b, wind, density, height, c, 0, soundSpeed);
  }
}
