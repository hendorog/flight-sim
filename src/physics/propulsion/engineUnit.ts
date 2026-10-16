// One engine installation: engine, propeller, the shaft between them (with its reduction gear, if any), the
// propeller governor and the engine's temperatures. No tanks and no bus: the fuel system and the electrical
// system belong to the aircraft (powerplant.ts), which steps a unit in two halves with the fuel delivery in
// between:
//   breathe()  induction -> manifold pressure, air flow, the fuel the servo (or the ECU) demands
//   finish()   combustion -> propeller -> shaft -> governor -> temperatures -> loads on the airframe, gauges
//
// Shaft integration: the unit integrates the PROPELLER shaft. The crank turns gearRatio times as fast and its
// torques reach the shaft multiplied by gearRatio, so the shaft equation carries the crank-side inertia times
// gearRatio squared (shaftInertia). The stiffest term is the propeller torque, dQ/domega ~ 2Q/omega, which gives
// a time constant I omega / 2Q >= 0.3 s, so explicit Euler is stable with a wide margin at 1/120 s. Friction is
// Coulomb-like at rest, so the shaft sticks at zero until the driving torque beats the breakaway torque.
//
// Loads reported to the airframe: thrust and in-plane force act at the hub and are taken about the CG; the
// asymmetric-disc (P-factor) moment is added; and the engine block receives the reaction of the torque it
// applies to the rotating parts, -(dH/dt + Q_prop) about the shaft axis. The propeller's aerodynamic torque
// itself acts on the rotor, whose angular momentum H is reported separately: the rigid-body integrator must add
// the gyroscopic term -omega x H and must not add Q_prop again. H is the sum of what the parts carry, propeller
// and crank each at its own speed (momentInertia): with a reduction gear that is NOT the shaft equation's
// inertia times the shaft speed. Direct drive: the two are the same number.
//
// A gas turbine (turbineEngine.ts) fits the same frame with its POWER TURBINE as the crank: the starter's torque
// goes to its gas generator instead of the shaft, and the alternator, the engine-driven pumps and the oil pressure
// follow the gas generator's speed (driveRpm).
//
// Beta and reverse (PitchControlDef.beta): the unit reads ControlInputs.reverse and hands it to the governor (the
// beta valve, governor.ts) and to a gas turbine (the reversing cam and the topping reset, turbineEngine.ts). A
// propeller selected by the condition lever (selectedBy 'conditionLever', PC-12) is governed at maxRpm and
// feathers with the condition lever at CUT-OFF/FEATHER. A latching start switch (EngineDef.starterLatch) keeps the
// starter engaged after one press until its cut-out (see starterCommand).
//
// Rotation sense: a propeller turning counter-clockwise seen from the cockpit reverses the torque reaction and
// the angular momentum here, and the P-factor moment and the swirl in propeller.ts; thrust and the in-plane
// force do not change. Such a unit is the mirror image, in the aircraft's plane of symmetry, of a clockwise one.

import { INHG, clamp, interp1, type Vec3 } from '../../core/math';
import { emptyEngineState, emptyPropellerState, engineControl, type ControlInputs, type EngineState, type PropellerState } from '../../core/types';
import type { EngineSnapshot, PropulsionInput, Slipstream } from '../interfaces';
import { PROP_REFERENCE_STATION, bladeAngleAt } from './bladeGeometry';
import type { EngineInstallation } from './defs';
import { DieselEngine } from './dieselEngine';
import { PistonEngine, type EngineInput } from './engine';
import { EngineThermal, type ThermalInput } from './engineThermal';
import { PropGovernor } from './governor';
import { CUTOFF_BELOW, TurbineEngine } from './turbineEngine';
import { Propeller } from './propeller';
import { propellerCharacteristicsFor } from './propellerMap';

const RAD_S_TO_RPM = 60 / (2 * Math.PI);
/** Time a cowl flap takes from closed to open, s (a manual lever and its cable). */
const COWL_FLAP_SECONDS = 2;
/** Sea-level ISA density and speed of sound: the air the idle speed of a definition is quoted in. */
const SEA_LEVEL_DENSITY = 1.225;
const SEA_LEVEL_SOUND_SPEED = 340.294;

/**
 * Polar moment of inertia of everything that turns with the propeller shaft, as the shaft equation sees it,
 * kg*m^2: propeller and spinner, plus the crank side reflected through the gearbox. A unit computes it ONCE.
 */
export function shaftInertia(install: EngineInstallation): number {
  const { engine, propeller } = install;
  return propeller.inertia + engine.gearRatio * engine.gearRatio * engine.rotatingInertia;
}

/**
 * Angular momentum of the rotating parts per unit PROPELLER speed, kg*m^2: the propeller's inertia plus the
 * crank side's times the gear ratio (the crank turns that much faster), the same way as the propeller or, behind
 * a single spur stage (EngineDef.gearReverses), the other way. Direct drive: exactly shaftInertia().
 */
export function momentInertia(install: EngineInstallation): number {
  const { engine, propeller } = install;
  if (engine.gearReverses) return propeller.inertia - engine.gearRatio * engine.rotatingInertia;
  return propeller.inertia + engine.gearRatio * engine.rotatingInertia;
}

export class EngineUnit {
  readonly engine: PistonEngine | DieselEngine | TurbineEngine;
  readonly propeller: Propeller;
  readonly thermal: EngineThermal;
  /** The hub of a constant-speed propeller (absent: fixed pitch). */
  readonly governor: PropGovernor | undefined;

  /** PROPELLER shaft speed, rad/s (the crank turns gearRatio times as fast). */
  omega = 0;
  /** External drivetrain owns loads and coupling; engine integrates a free crank, without a propeller. */
  externalDrive = false;
  /** See shaftInertia() and momentInertia(). */
  readonly inertia: number;
  readonly momentInertia: number;
  /** Crank speed / propeller speed. */
  readonly gearRatio: number;
  /** Propeller disc centre, reference-point body axes. */
  readonly hub: Vec3;

  // Results of the last finish(): owned by the unit and overwritten by the next.
  /** Force and moment on the airframe about the CG, body axes. */
  readonly force: Vec3 = { x: 0, y: 0, z: 0 };
  readonly moment: Vec3 = { x: 0, y: 0, z: 0 };
  /** Angular momentum of the rotating assembly, body axes, kg*m^2/s. */
  readonly angularMomentum: Vec3 = { x: 0, y: 0, z: 0 };
  /** Gauge values. The fuel flow and fuel pressure are the fuel system's: the powerplant writes them. */
  readonly state: EngineState = emptyEngineState();
  readonly propState: PropellerState;
  readonly slipstream: Slipstream;

  /**
   * Quasi-steady evaluation (Powerplant.settle): the slow states of the unit hold (blade angle, carburettor
   * ice, cowl flap, ECU and glow timers) and the lagged ones sit at their targets.
   */
  steady = false;
  /** The shaft speed is held (settle solves the blade angle for it instead of integrating). */
  shaftHeld = false;
  /** Torque of engine and starter on the propeller shaft in the last finish(), losses taken off, N*m. */
  shaftTorque = 0;
  /** Cowl flap position reached, 0 closed .. 1 open. */
  cowlFlap = 1;

  /** Shaft angular acceleration of the last step, rad/s^2 (its reaction acts on the engine block). */
  private shaftAccel = 0;
  private rotation = 0;
  /** +1 clockwise seen from the cockpit, -1 the other way. */
  private readonly direction: 1 | -1;
  private readonly ramRecovery: number;
  /** Torque that holds the stopped shaft, N*m at the propeller shaft. */
  private readonly breakawayTorque: number;
  private readonly runningRpm: number;
  private readonly ratedPower: number;
  /** Blade angle at the reference station of a fixed-pitch propeller, rad. */
  private readonly fixedPitch: number;
  // What the unit has beyond a fixed-pitch, injected, air-cooled engine with no cowl flaps (each read only then).
  private readonly extras: boolean;
  private readonly diesel: DieselEngine | undefined;
  private readonly turbine: TurbineEngine | undefined;
  private readonly hasCarbHeat: boolean;
  private readonly hasAlternateAir: boolean;
  private readonly hasCowlFlaps: boolean;
  private readonly scheduleLever: number[] = [];
  private readonly scheduleRpm: number[] = [];
  /** Governed propeller speed (rad/s) and feather selection of the present controls. */
  private omegaSet = 0;
  private featherSelected = false;
  /** Latching start switch (EngineDef.starterLatch): engaged, seconds since it latched, the switch as last seen. */
  private starterLatched = false;
  private starterLatchTime = 0;
  private starterWas = false;
  /** The starter is engaged: the switch held (hold-to-run) or the latch (starterLatch), as of the last starterCommand(). */
  starterEngaged = false;
  /** Thrust-line tilt: rows of the shaft-to-body rotation (absent: the shaft lies along body x). */
  private readonly tilt: readonly [Vec3, Vec3, Vec3] | undefined;
  private readonly shaftAir: Vec3 = { x: 0, y: 0, z: 0 };
  /** Inflow and air of the last finish() (settle evaluates the propeller again in them). */
  private lastAir: Vec3 = this.shaftAir;
  private lastDensity = SEA_LEVEL_DENSITY;
  private lastSoundSpeed = SEA_LEVEL_SOUND_SPEED;
  private readonly engineInput: EngineInput = {
    omega: 0,
    throttle: 0,
    mixture: 1,
    magnetos: 3,
    ambientPressure: 101325,
    ambientTemperature: 288.15,
    ambientDensity: 1.225,
    ramPressure: 0,
    oilTemperature: 15,
    accessoryPower: 0,
    carbHeat: 0,
    alternateAir: false,
    dt: 0,
    moisture: undefined,
    steady: false,
    engineMaster: true,
    busVoltage: Infinity,
    alternatorLive: false,
    coolantTemperature: Infinity,
  };
  private readonly thermalInput: ThermalInput = {
    firing: false,
    phi: 0,
    load: 0,
    rpm: 0,
    singleMagneto: false,
    indicatedPower: 0,
    frictionPower: 0,
    coolingSpeed: 0,
    density: 1.225,
    oat: 288.15,
    chargeTemperature: 288.15,
    cowlFlap: undefined,
    shaftPower: 0,
  };

  /**
   * `index`: which engine of the aircraft this is (its controls are read with engineControl). `propeller`:
   * the propeller to use instead of one made from the installation's definition (of the same rotation sense).
   */
  constructor(
    readonly install: EngineInstallation,
    readonly index = 0,
    propeller: Propeller = new Propeller(propellerCharacteristicsFor(install.propeller), install.rotation),
  ) {
    const def = install.engine;
    if (propeller.rotation !== install.rotation) throw new Error(`${install.propeller.name}: the propeller supplied turns the other way`);
    this.diesel = def.kind === 'dieselFadec' ? new DieselEngine(def) : undefined;
    const control = install.propeller.pitchControl;
    this.turbine = def.kind === 'freeTurbine' ? new TurbineEngine(def, control.kind === 'constantSpeed' ? control.beta : undefined) : undefined;
    this.engine = this.diesel ?? this.turbine ?? new PistonEngine(def);
    this.propeller = propeller;
    this.thermal = new EngineThermal(def.thermal);
    this.inertia = shaftInertia(install);
    this.momentInertia = momentInertia(install);
    this.gearRatio = def.gearRatio;
    this.direction = install.rotation;
    this.hub = { ...install.hub };
    this.ramRecovery = def.induction.ramRecovery;
    this.breakawayTorque = def.breakawayTorque * def.gearRatio;
    this.runningRpm = def.runningRpm;
    this.ratedPower = def.ratedPower;
    this.governor = control.kind === 'constantSpeed' ? new PropGovernor(control) : undefined;
    // A fixed-pitch propeller reports its geometric blade angle at the reference station.
    const station = install.propeller.referenceStation ?? PROP_REFERENCE_STATION;
    this.fixedPitch = control.kind === 'constantSpeed' ? control.fineStop : bladeAngleAt(install.propeller, station);
    this.hasCarbHeat = def.induction.carburettor !== undefined;
    this.hasAlternateAir = def.induction.alternateAir !== undefined;
    this.hasCowlFlaps = def.thermal.cowlFlapClosedFactor !== 1;
    if (def.fadec) for (const [lever, rpm] of def.fadec.propRpmVsLever) {
      this.scheduleLever.push(lever);
      this.scheduleRpm.push(rpm);
    }
    this.extras = this.governor !== undefined || this.diesel !== undefined || this.turbine !== undefined || this.hasCarbHeat || this.hasAlternateAir || this.hasCowlFlaps;
    const tilt = install.tilt;
    if (tilt && (tilt.up !== 0 || tilt.right !== 0)) {
      // Body from shaft axes: yaw `right` about body z, then pitch `up` about the new y.
      const ct = Math.cos(tilt.up), st = Math.sin(tilt.up), cp = Math.cos(tilt.right), sp = Math.sin(tilt.right);
      this.tilt = [{ x: cp * ct, y: -sp, z: cp * st }, { x: sp * ct, y: cp, z: sp * st }, { x: -st, y: 0, z: ct }];
    }
    // No carburettor and no cowl flaps (carbIce 0, cowlFlap 1).
    this.propState = { ...emptyPropellerState(install.rotation), bladePitch: this.fixedPitch };
    // PropellerState.beta only on a hub that has it (the state of every other type is unchanged).
    if (control.kind === 'constantSpeed' && control.beta) this.propState.beta = false;
    this.slipstream = { origin: { ...install.hub }, radius: this.propeller.radius, inducedVelocity: 0, swirlRate: 0 };

    // The idle bypass of a definition that gives the idle speed instead: what the engine must deliver to turn
    // THIS propeller (blades on the fine stop) at that speed, standing still at sea level.
    if (this.engine instanceof PistonEngine && def.induction.idleArea === undefined) {
      const omegaIdle = (def.idleRpm * 2 * Math.PI) / 60 / def.gearRatio;
      const load = this.propeller.evaluate({ x: 0, y: 0, z: 0 }, omegaIdle, SEA_LEVEL_DENSITY, SEA_LEVEL_SOUND_SPEED, this.fixedPitch).torque;
      this.engine.solveIdleArea(load / def.gearRatio);
    }
  }

  /** CRANK speed, rev/min. */
  get rpm(): number {
    return this.omega * RAD_S_TO_RPM * this.gearRatio;
  }

  /**
   * Speed of the shaft that drives the starter, the alternators and the engine-driven pumps, rev/min and rad/s:
   * the crank, or a gas turbine's gas generator.
   */
  get driveRpm(): number {
    return this.turbine ? this.turbine.ngRpm : this.omega * RAD_S_TO_RPM * this.gearRatio;
  }

  get driveOmega(): number {
    return this.turbine ? this.turbine.gasGenerator.omega : this.omega * this.gearRatio;
  }

  /** Blade angle at the propeller's reference station, rad. */
  get bladePitch(): number {
    return this.governor ? this.governor.pitch : this.fixedPitch;
  }

  /** Blades on the feather stop (false for a propeller that cannot feather). */
  get feathered(): boolean {
    return this.governor !== undefined && this.governor.feathered;
  }

  /**
   * Crank speed `rpm`; temperatures warm (as after running) or cold-soaked at `oat`, K. `feathered`: a
   * feathering propeller starts on its feather stop, stopped, whatever `rpm` says. `running`: a gas turbine
   * starts alight at low idle (a piston engine's running follows from its speed).
   */
  reset(rpm: number, warm: boolean, oat: number, feathered = false, running = false): void {
    this.thermal.reset(warm, oat);
    this.engine.reset(101325, oat);
    if (running) this.turbine?.light();
    this.omega = (rpm * 2 * Math.PI) / 60 / this.gearRatio;
    this.rotation = 0;
    this.starterLatched = this.starterWas = this.starterEngaged = false;
    this.starterLatchTime = 0;
    if (this.install.engine.starterLatch) this.state.starter = false;
    if (!this.extras) return;
    this.cowlFlap = 1;
    const governor = this.governor;
    if (governor) {
      const secured = feathered && governor.def.feather !== undefined;
      governor.reset(secured);
      if (secured) this.omega = 0;
      governor.relatch(this.omega);
      this.propState.bladePitch = governor.pitch;
      this.propState.feathered = governor.feathered;
      if (governor.def.beta) this.propState.beta = false;
    }
  }

  /**
   * Starting point of a trim evaluation (Powerplant.primeForTrim): turning at propeller speed `omega`, rad/s,
   * with the blades where settle() starts from; a feathered propeller stopped on its feather stop; a gas turbine alight.
   */
  prime(omega: number): void {
    // A gas turbine is primed alight, as a turning spark engine fires: the controls of the evaluation put it out
    // again (condition lever at cut-off, no fuel).
    this.turbine?.light();
    const governor = this.governor;
    if (governor?.feathered) {
      this.omega = 0;
      governor.toFeather();
    } else this.omega = omega;
    governor?.relatch(this.omega);
  }

  /**
   * The governor's orders: governed propeller speed, rad/s, and whether feather is selected. The propeller lever
   * gives both; on a FADEC engine the ECU schedules the speed from the power lever (`lever`) and ENGINE MASTER
   * off (`master` false) feathers.
   */
  private readGovernor(controls: ControlInputs, lever: number, master: boolean): void {
    const governor = this.governor;
    if (!governor) return;
    if (this.diesel) {
      this.omegaSet = interp1(this.scheduleLever, this.scheduleRpm, clamp(lever, 0, 1)) / RAD_S_TO_RPM;
      this.featherSelected = governor.def.feather !== undefined && !master;
    } else if (governor.def.selectedBy === 'conditionLever') {
      // No propeller lever: governed at maxRpm (= minRpm), feathered with the condition lever at CUT-OFF/FEATHER.
      this.omegaSet = governor.leverSpeed(1);
      this.featherSelected = governor.def.feather !== undefined && engineControl(controls, this.index, 'mixture') < CUTOFF_BELOW;
    } else {
      const propLever = engineControl(controls, this.index, 'propeller');
      this.omegaSet = governor.leverSpeed(propLever);
      this.featherSelected = governor.leverFeathers(propLever);
    }
    // The beta valve: the power lever aft of the gate, and forward of it for a scheduled low-pitch stop.
    if (governor.def.beta) governor.setLevers(engineControl(controls, this.index, 'reverse') ?? 0, lever);
  }

  /** Read the governor's orders from the controls without stepping (settle() needs them before its first step). */
  command(controls: ControlInputs): void {
    if (this.governor) this.readGovernor(controls, engineControl(controls, this.index, 'throttle'), engineControl(controls, this.index, 'engineMaster'));
  }

  /** The power lever is aft of the gate (beta or reverse commanded) as of the last breathe() / command(). */
  get betaCommanded(): boolean {
    return this.governor !== undefined && this.governor.reverse > 0;
  }

  /**
   * The beta valve has the blades as of the last breathe() / command(): the lever aft of the gate, feather not
   * selected, and the oil to move them (PropGovernor.betaHasAuthority).
   */
  get betaHolds(): boolean {
    const governor = this.governor;
    return governor !== undefined && governor.betaHasAuthority(this.featherSelected, this.thermal.oilPressure);
  }

  /**
   * The starter's state for this step, from the switch: hold-to-run (the switch itself), or with
   * EngineDef.starterLatch a press latches it until the gas generator reaches cutoutNg, cutoutSeconds pass, or
   * the switch is pressed again (the interrupt: there is no STARTER INTERRUPT control yet). Advanced by `dt`;
   * held still in a steady evaluation. Powerplant.step calls it once per step, before the bus.
   */
  starterCommand(controls: ControlInputs, dt: number): boolean {
    const pressed = engineControl(controls, this.index, 'starter');
    const latch = this.install.engine.starterLatch;
    if (!latch) return (this.starterEngaged = pressed);
    if (this.steady) return this.starterEngaged;
    const press = pressed && !this.starterWas;
    this.starterWas = pressed;
    if (press) {
      this.starterLatched = !this.starterLatched;
      this.starterLatchTime = 0;
    } else if (this.starterLatched) {
      this.starterLatchTime += dt;
      const ng = this.turbine ? this.turbine.ng : 0;
      if (ng >= latch.cutoutNg || this.starterLatchTime >= latch.cutoutSeconds) this.starterLatched = false;
    }
    return (this.starterEngaged = this.starterLatched);
  }

  /** Governed propeller speed of the last breathe(), rad/s. */
  get governedSpeed(): number {
    return this.omegaSet;
  }

  /** The controls of the last breathe() select feather. */
  get featherCommanded(): boolean {
    return this.featherSelected;
  }

  /**
   * First half of a step: the induction system at the present shaft speed, with `air` the air velocity relative
   * to the hub (body axes) and `accessoryPower` the shaft power the alternator takes, W. `busVoltage` and
   * `alternatorLive` (this engine's own alternator is delivering) are what a FADEC engine's ECU lives on.
   * Returns the fuel flow demanded, kg/s.
   */
  breathe(input: PropulsionInput, air: Vec3, accessoryPower: number, busVoltage = Infinity, alternatorLive = false): number {
    const { atmosphere: atm, controls } = input;
    const axial = Math.max(-air.x, 0);
    const ei = this.engineInput;
    ei.omega = this.omega * this.gearRatio;
    ei.throttle = engineControl(controls, this.index, 'throttle');
    ei.mixture = engineControl(controls, this.index, 'mixture');
    ei.magnetos = engineControl(controls, this.index, 'magnetos');
    ei.ambientPressure = atm.pressure;
    ei.ambientTemperature = atm.temperature;
    ei.ambientDensity = atm.density;
    ei.ramPressure = this.ramRecovery * 0.5 * atm.density * axial * axial;
    ei.oilTemperature = this.thermal.oilTemp;
    ei.accessoryPower = accessoryPower;
    if (this.extras) {
      ei.dt = input.dt;
      ei.steady = this.steady;
      ei.moisture = input.moisture;
      if (this.hasCarbHeat) ei.carbHeat = engineControl(controls, this.index, 'carbHeat');
      if (this.hasAlternateAir) ei.alternateAir = engineControl(controls, this.index, 'alternateAir');
      // A gas turbine's igniters: with the IGNITION (magneto) switch at NORM (0) they spark while the starter runs;
      // at ON (any other position) continuously.
      if (this.turbine) {
        const starter = this.install.engine.starterLatch ? this.starterEngaged : engineControl(controls, this.index, 'starter');
        ei.igniters = starter || ei.magnetos !== 0;
        ei.reverse = engineControl(controls, this.index, 'reverse') ?? 0;
      }
      if (this.diesel) {
        ei.engineMaster = engineControl(controls, this.index, 'engineMaster');
        ei.busVoltage = busVoltage;
        ei.alternatorLive = alternatorLive;
        ei.coolantTemperature = this.thermal.coolantTemp;
      }
      this.readGovernor(controls, ei.throttle, ei.engineMaster !== false);
      // Steady (settle) evaluation in beta: the blades at the valve's command (finish() does not step the governor).
      // Feather (condition lever at CUT-OFF/FEATHER) and a hub without oil keep the blades, as governor.step() does.
      if (this.steady && this.betaHolds) this.governor!.toCommand();
      if (this.hasCowlFlaps && !this.steady) {
        const travel = input.dt / COWL_FLAP_SECONDS;
        this.cowlFlap += clamp(clamp(engineControl(controls, this.index, 'cowlFlaps'), 0, 1) - this.cowlFlap, -travel, travel);
      }
    }
    this.engine.breathe(ei);
    return this.engine.fuelDemand;
  }

  /**
   * Second half: burn the fuel that was delivered (kg/s), turn the propeller in the same `air`, advance the
   * shaft with the starter's torque on it (N*m at the crankshaft), then the governor, the temperatures, the
   * loads on the airframe and the gauges.
   */
  finish(input: PropulsionInput, air: Vec3, fuelDelivered: number, starterTorque: number): void {
    const { atmosphere: atm, dt } = input;
    const engine = this.engine;
    const gear = this.gearRatio;
    const omega = this.omega;
    const crankOmega = omega * gear;
    const rpm = omega * RAD_S_TO_RPM * gear;
    const axial = Math.max(-air.x, 0);
    const ei = this.engineInput;
    // A gas turbine's starter turns its gas generator, not this shaft.
    const turbine = this.turbine;
    if (turbine) {
      ei.starterTorque = starterTorque;
      starterTorque = 0;
    }
    engine.burn(ei, fuelDelivered);

    // Propeller, in the air as its own shaft sees it.
    const governor = this.governor;
    const tilt = this.tilt;
    let shaftAir = air;
    if (tilt) {
      shaftAir = this.shaftAir;
      shaftAir.x = tilt[0].x * air.x + tilt[1].x * air.y + tilt[2].x * air.z;
      shaftAir.y = tilt[0].y * air.x + tilt[1].y * air.y + tilt[2].y * air.z;
      shaftAir.z = tilt[0].z * air.x + tilt[1].z * air.y + tilt[2].z * air.z;
    }
    const pitch = governor ? governor.pitch : this.fixedPitch;
    // External shafts (helicopter transmission) carry no compatibility propeller aerodynamics.
    const prop = this.externalDrive ? this.propeller.loads : this.propeller.evaluate(shaftAir, omega, atm.density, atm.speedOfSound, pitch);
    if (this.externalDrive) {
      prop.thrust = prop.torque = prop.advanceRatio = prop.axialSpeed = 0;
      prop.inPlaneForce.x = prop.inPlaneForce.y = prop.inPlaneForce.z = 0;
      prop.hubMoment.x = prop.hubMoment.y = prop.hubMoment.z = 0;
    }
    this.lastAir = shaftAir;
    this.lastDensity = atm.density;
    this.lastSoundSpeed = atm.speedOfSound;

    // Shaft dynamics.
    const drive = (engine.indicatedTorque + starterTorque) * gear - (this.externalDrive ? 0 : prop.torque);
    const resist = engine.lossTorque * gear;
    this.shaftTorque = (engine.indicatedTorque + starterTorque) * gear - resist;
    let omegaNext: number;
    if (this.shaftHeld) {
      omegaNext = omega;
    } else if (omega <= 0 && drive < Math.max(this.breakawayTorque, resist)) {
      omegaNext = 0; // held by compression and static friction
    } else {
      omegaNext = Math.max(0, omega + ((drive - resist) / this.inertia) * dt);
    }
    this.shaftAccel = dt > 0 ? (omegaNext - omega) / dt : 0;
    this.omega = omegaNext;
    this.rotation = (this.rotation + this.direction * omegaNext * dt) % (2 * Math.PI);

    // Governor: the blades move on the speed this step started from.
    if (governor && !this.steady) governor.step(dt, omega, this.omegaSet, this.featherSelected, this.thermal.oilPressure, this.shaftAccel);

    // Temperatures and pressures.
    const slip = this.propeller.slipstream(this.hub, this.slipstream);
    const ti = this.thermalInput;
    ti.firing = engine.firing;
    ti.phi = engine.phi;
    ti.load = engine.load;
    // A gas turbine's oil pump is on its gas generator.
    ti.rpm = turbine ? turbine.ngRpm : rpm;
    ti.singleMagneto = ei.magnetos === 1 || ei.magnetos === 2;
    ti.indicatedPower = engine.indicatedTorque * crankOmega;
    ti.frictionPower = engine.frictionTorque * crankOmega;
    ti.coolingSpeed = axial + (this.externalDrive ? 12 : Math.max(slip.inducedVelocity, 0));
    ti.density = atm.density;
    ti.oat = atm.temperature;
    ti.chargeTemperature = engine.chargeTemperature;
    if (this.extras) {
      if (this.hasCowlFlaps) ti.cowlFlap = this.cowlFlap;
      ti.shaftPower = (engine.indicatedTorque - engine.lossTorque) * crankOmega;
    }
    this.thermal.update(dt, ti);

    // Forces and moments about the CG.
    this.airframeLoads(input.body.cgOffset);
    if (this.externalDrive) {
      this.force.x = this.force.y = this.force.z = 0;
      this.moment.x = this.moment.y = this.moment.z = 0;
      slip.inducedVelocity = slip.swirlRate = 0;
    }
    if (tilt) {
      const h = this.direction * (this.momentInertia * omegaNext);
      this.angularMomentum.x = tilt[0].x * h;
      this.angularMomentum.y = tilt[1].x * h;
      this.angularMomentum.z = tilt[2].x * h;
    } else this.angularMomentum.x = this.direction * (this.momentInertia * omegaNext);

    // Gauges and state.
    const brakeTorque = engine.indicatedTorque - engine.lossTorque;
    const propRpm = omegaNext * RAD_S_TO_RPM;
    const e = this.state;
    e.running = engine.firing && (turbine ? turbine.ngRpm : rpm) > this.runningRpm;
    e.rpm = propRpm * gear;
    e.manifoldPressure = engine.manifoldPressure / INHG;
    e.torque = brakeTorque;
    e.power = brakeTorque * crankOmega;
    e.egt = this.thermal.egt;
    e.cht = this.thermal.cht;
    e.oilTemp = this.thermal.oilTemp;
    e.oilPressure = this.thermal.oilGaugePsi;
    e.propRpm = propRpm;
    e.loadPercent = (100 * e.power) / this.ratedPower;

    const p = this.propState;
    p.rpm = propRpm;
    p.thrust = prop.thrust;
    p.advanceRatio = prop.advanceRatio;
    p.rotation = this.rotation;

    if (this.extras) {
      e.carbIce = engine.carbIce;
      if (this.hasCarbHeat && engine instanceof PistonEngine) e.roughness = engine.roughness;
      e.cowlFlap = this.cowlFlap;
      const diesel = this.diesel;
      if (diesel) {
        e.ecuPowered = diesel.ecuPowered;
        e.glow = diesel.glowing;
      }
      if (this.install.engine.starterLatch) e.starter = this.starterEngaged;
      if (turbine) {
        e.ng = 100 * turbine.ng;
        e.itt = e.egt = turbine.ittC;
        e.lit = turbine.firing;
      }
      if (this.thermal.liquid) {
        e.coolantTemp = this.thermal.coolantTemp;
        e.gearboxTemp = this.thermal.gearboxTemp;
      }
      if (governor) {
        p.bladePitch = governor.pitch;
        p.feathered = governor.feathered;
        if (governor.def.beta) p.beta = governor.inBeta;
      }
    }
  }

  /**
   * Aerodynamic torque of the propeller at blade angle `pitch` (rad) in the air and at the shaft speed of the
   * last finish(), N*m. Overwrites the propeller's loads: settle() calls it between steps, not after the last.
   */
  propellerTorqueAt(pitch: number): number {
    return this.propeller.evaluate(this.lastAir, this.omega, this.lastDensity, this.lastSoundSpeed, pitch).torque;
  }

  /** Force and moment of the last propeller evaluation on the airframe, about the CG. */
  private airframeLoads(cg: Vec3): void {
    const prop = this.propeller.loads;
    const f = this.force;
    const m = this.moment;
    // On the engine block: the reaction of what it does to the rotating parts, about the shaft, by its sense.
    const reaction = this.direction * (this.momentInertia * this.shaftAccel + prop.torque);
    const rx = this.hub.x - cg.x;
    const ry = this.hub.y - cg.y;
    const rz = this.hub.z - cg.z;
    const tilt = this.tilt;
    if (tilt) {
      // Loads in shaft axes (thrust, in-plane force; reaction, hub moment) turned into body axes.
      const fy = prop.inPlaneForce.y, fz = prop.inPlaneForce.z, my = prop.hubMoment.y, mz = prop.hubMoment.z;
      f.x = tilt[0].x * prop.thrust + tilt[0].y * fy + tilt[0].z * fz;
      f.y = tilt[1].x * prop.thrust + tilt[1].y * fy + tilt[1].z * fz;
      f.z = tilt[2].x * prop.thrust + tilt[2].y * fy + tilt[2].z * fz;
      m.x = ry * f.z - rz * f.y + (tilt[0].x * -reaction + tilt[0].y * my + tilt[0].z * mz);
      m.y = rz * f.x - rx * f.z + (tilt[1].x * -reaction + tilt[1].y * my + tilt[1].z * mz);
      m.z = rx * f.y - ry * f.x + (tilt[2].x * -reaction + tilt[2].y * my + tilt[2].z * mz);
      return;
    }
    f.x = prop.thrust;
    f.y = prop.inPlaneForce.y;
    f.z = prop.inPlaneForce.z;
    m.x = ry * f.z - rz * f.y - reaction;
    m.y = rz * f.x - rx * f.z + prop.hubMoment.y;
    m.z = rx * f.y - ry * f.x + prop.hubMoment.z;
  }

  /** What a resume snapshot keeps of this unit. */
  capture(): EngineSnapshot {
    const th = this.thermal;
    const governor = this.governor;
    const snap: EngineSnapshot = {
      running: this.state.running,
      rpm: this.rpm,
      propRpm: this.omega * RAD_S_TO_RPM,
      bladePitch: this.bladePitch,
      featherLatched: governor !== undefined && governor.latched,
      egt: th.egt,
      cht: th.cht,
      oilTemp: th.oilTemp,
      oilPressure: th.oilPressure,
      carbIce: this.engine.carbIce,
      cowlFlap: this.cowlFlap,
    };
    if (th.liquid) {
      snap.coolantTemp = th.coolantTemp;
      snap.gearboxTemp = th.gearboxTemp;
    }
    if (this.diesel) {
      snap.ecuBackupUsed = this.diesel.backupUsed;
      snap.glowSeconds = this.diesel.glowSeconds;
    }
    if (this.turbine) {
      const gg = this.turbine.gasGenerator;
      snap.gasGenerator = { ng: gg.ng, itt: gg.ittC, lit: gg.lit };
    }
    if (governor?.def.feather?.unfeather === 'accumulator') snap.accumulatorCharged = governor.accumulatorCharged;
    if (this.install.engine.starterLatch) snap.starterLatch = { latched: this.starterLatched, seconds: this.starterLatchTime, pressed: this.starterWas };
    return snap;
  }

  /** Put the unit into the state of a snapshot (shaft speed, blade angle and latch, temperatures, ice, timers, start switch latch). */
  restore(snap: EngineSnapshot): void {
    const th = this.thermal;
    this.engine.reset(101325, 288.15);
    this.omega = snap.propRpm / RAD_S_TO_RPM;
    this.rotation = 0;
    th.egt = snap.egt;
    th.cht = snap.cht;
    th.oilTemp = snap.oilTemp;
    th.oilPressure = th.oilGaugePsi = snap.oilPressure;
    th.coolantTemp = snap.coolantTemp ?? snap.cht;
    th.gearboxTemp = snap.gearboxTemp ?? snap.oilTemp;
    this.cowlFlap = snap.cowlFlap;
    if (this.engine instanceof PistonEngine) this.engine.induction.ice = this.hasCarbHeat ? clamp(snap.carbIce, 0, 1) : 0;
    const diesel = this.diesel;
    if (diesel) {
      diesel.backupUsed = snap.ecuBackupUsed ?? 0;
      diesel.glowSeconds = snap.glowSeconds ?? 0;
    }
    this.restoreSpoolAndPitch(snap);
    const e = this.state;
    e.running = snap.running;
    e.rpm = snap.rpm;
    e.propRpm = snap.propRpm;
    e.egt = snap.egt;
    e.cht = snap.cht;
    e.oilTemp = snap.oilTemp;
    e.oilPressure = snap.oilPressure;
    e.carbIce = snap.carbIce;
    e.cowlFlap = snap.cowlFlap;
    this.propState.rpm = snap.propRpm;
  }

  /**
   * The parts of a snapshot that live outside the shaft speed and temperatures: the gas generator (Ng, ITT, alight),
   * the governor's blade angle (down to the reverse angle in beta), feather latch and accumulator, and the latching
   * start switch. restore() calls it; so does the fixed-wing FlightModel.restoreSystems() after Powerplant.reset(),
   * which would otherwise leave a turbine at low idle, a beta blade on the fine stop and a start without its latch.
   */
  restoreSpoolAndPitch(snap: EngineSnapshot): void {
    const turbine = this.turbine;
    if (turbine && snap.gasGenerator) {
      const gg = turbine.gasGenerator;
      gg.lit = turbine.firing = snap.gasGenerator.lit;
      gg.omega = snap.gasGenerator.ng * gg.omegaRef;
      gg.itt = snap.gasGenerator.itt + 273.15;
    }
    const governor = this.governor;
    if (governor) {
      // A snapshot taken in beta holds a blade angle below the fine stop (down to the reverse angle).
      governor.pitch = clamp(snap.bladePitch, governor.def.beta?.reverse ?? governor.def.fineStop, Math.max(governor.def.coarseStop, governor.def.feather?.angle ?? 0));
      governor.latched = snap.featherLatched;
      governor.accumulatorCharged = snap.accumulatorCharged ?? true;
      this.propState.bladePitch = governor.pitch;
      this.propState.feathered = governor.feathered;
      if (governor.def.beta) this.propState.beta = governor.inBeta;
    }
    // The latching start switch as it was (a start resumed mid-way runs on to its cut-out); hold-to-run has no state.
    const latch = this.install.engine.starterLatch ? snap.starterLatch : undefined;
    this.starterLatched = this.starterEngaged = latch?.latched ?? false;
    this.starterWas = latch?.pressed ?? false;
    this.starterLatchTime = latch?.seconds ?? 0;
    if (this.install.engine.starterLatch) this.state.starter = this.starterEngaged;
  }
}
