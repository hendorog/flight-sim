// The flight model of an aircraft built from its definition: blade-element aerodynamics, the powerplant, the
// landing gear and the control system, summed on a 6-DOF rigid body and integrated with classical RK4 at a fixed
// rate. The Cessna 172S is physics/c172FlightModel.ts (this class with its definition).
//
// SUB-STEP (h = 1 / physicsRate):
//   1. Mass, CG and inertia from the fuel left in the tanks.
//   2. Atmosphere at the CG; wind sampled at the nose reference point, both wingtips and the tail, from which a
//      linear wind field over the airframe is built (turbulence then rolls and yaws the aircraft correctly
//      while env.wind is called only four times per sub-step).
//   3. Control surfaces move toward the pilot's commands (rate limits, cable stretch, flap motor).
//   4. The retraction system (if any) advances once; the powerplant advances once (its shaft and thermal states
//      are slow), each engine in the air at its own hub; its force, moment and rotor angular momentum (the signed
//      sum over the engines) are held over the step, and so are the jets of every propeller, the gear's
//      extension and the cowl flaps' opening, which scale the drag items that carry a scale.
//   5. RK4: aerodynamics and gear are evaluated at every stage. The aero lag states advance on stage 0
//      only; the gear advances its tyre/wheel states by the elapsed stage time, which keeps the stiff tyre
//      and strut forces consistent with the intermediate states (that is what makes RK4 stable on the
//      ground at this rate).
//
// FRAMES. The integrated state is the CG (NED position and velocity), the body->NED quaternion and the body
// rates. Components work with the reference point (AircraftDefinition, core/c172.ts for the C172S) plus the CG
// offset. AircraftState.position is the REFERENCE POINT (the 3D model origin and the point the gear places
// geometry.restHeight above the ground); the CG is a few centimetres from it.
//
// RATE. 240 Hz: the stiffest loads are the airframe-scrape contacts (~3e5 N/m, heavily damped) and the
// tyres; RK4 at 240 Hz keeps them well inside its stability region (see tests/fdm/robustness.test.ts).
//
// ENGINES. Any number: each hub meets the wind there minus the airframe's motion at that point, plus the
// airframe's upwash at its own disc (one sub-step old). A single keeps the single-engine facade
// (PropulsionSystem) as `propulsion`. An engine that is not running is, in the air, WINDMILLING unless the
// initial conditions say feathered, and on the ground PARKED (engineStopControls() says what each means for its
// levers); on a single the airborne engine-off case is the Cessna 172S's (mixture at cut-off, magnetos on).

import type { AircraftDefinition } from '../aircraft/types';
import { DEG, G0, KT, clamp, quat, v3, wrapTwoPi, type Quat, type Vec3 } from '../core/math';
import {
  applyControls,
  cloneControls,
  copyControls,
  defaultControls,
  emptyEngineState,
  emptyPropellerState,
  emptySurfaceState,
  engineControl,
  fixedGearState,
  setEngineControl,
  type AircraftState,
  type AtmosphereSample,
  type ControlInputs,
  type ControlPatch,
  type EngineControls,
  type Environment,
  type InitialConditions,
  type WheelState,
} from '../core/types';
import { createAirData, slipBall, type AirData } from './airData';
import { AeroModel } from './aero';
import { casFromTas } from './atmosphere';
import { ControlSystem } from './controlSystem';
import { LandingGear, RetractActuator, type RetractInput } from './gear';
import type {
  AeroInput,
  AeroOutput,
  AircraftFlightModel,
  BodyState,
  FlightModelOptions,
  GearInput,
  GearOutput,
  LoadingRequest,
  PropulsionInput,
  PropulsionOutput,
  SystemsSnapshot,
} from './interfaces';
import { createMassModel, type MassModel, type MassProperties } from './massModel';
import { Powerplant, PropulsionSystem } from './propulsion';
import type { SimEnvironment } from './environment';
import { trimFlight, type TrimCondition, type TrimPlant, type TrimResult, type TrimSpec } from './trim';

export const DEFAULT_PHYSICS_RATE = 240;
/** A frame longer than this is simulated only up to it (e.g. after the browser tab was in the background), s. */
const MAX_FRAME = 0.25;
/** Stage times of classical RK4 as fractions of the step. */
const STAGE_TIME = [0, 0.5, 0.5, 1];
const STAGE_WEIGHT = [1 / 6, 1 / 3, 1 / 3, 1 / 6];
/** Mass properties are rebuilt when the fuel load has changed by this much (summed over the tanks), kg. */
const FUEL_REBUILD = 0.05;
/** Below this dynamic pressure times wing area (N) the lift coefficient for the static-port error is taken as 0. */
const MIN_AIR_DATA_QS = 500;

type TouchdownEvent = GearOutput['touchdowns'][number];

/** How an engine that is not running is left: on the ground, in the air with its propeller turning, or secured. */
export type EngineStopMode = 'parked' | 'windmilling' | 'feathered';

/**
 * The lever and switch positions of engine `i` of `def` when it is not running (contract 3.4 "Failed engine"):
 *   'parked'       on the ground: magnetos off and mixture at cut-off (a FADEC engine: ENGINE MASTER off);
 *   'windmilling'  failed in the air, not secured: throttle closed, mixture at cut-off, fuel selector off,
 *                  propeller lever forward, magnetos left on (a FADEC engine: fuel off with ENGINE MASTER on, so
 *                  the ECU keeps the governor driving the blades to the fine stop);
 *   'feathered'    secured: as windmilling with the propeller lever in feather (a FADEC engine: ENGINE MASTER
 *                  off, which feathers it).
 * The result holds only the members that differ from the scalar controls (an EngineControls override).
 */
export function engineStopControls(def: AircraftDefinition, i: number, mode: EngineStopMode): EngineControls {
  const fadec = def.powerplant.engines[i].engine.fadec !== undefined;
  if (mode === 'parked') return fadec ? { engineMaster: false } : { magnetos: 0, mixture: 0 };
  if (fadec) return { throttle: 0, fuelSelector: 'off', engineMaster: mode === 'windmilling' };
  return { throttle: 0, mixture: 0, fuelSelector: 'off', propeller: mode === 'windmilling' ? 1 : 0 };
}

function makeWheel(name: WheelState['name']): WheelState {
  return { name, compression: 0, onGround: false, load: 0, spinRate: 0, rotation: 0, steerAngle: 0, skid: 0 };
}

function makeState(def: AircraftDefinition, retractable: boolean): AircraftState {
  // engines[0] / propellers[0] are the SAME objects as engine / propeller (core/types.ts AircraftState).
  const engine = emptyEngineState();
  const propeller = emptyPropellerState(def.geometry.propellers[0].rotation);
  const engines = [engine];
  const propellers = [propeller];
  for (let i = 1; i < def.powerplant.engines.length; i++) {
    engines.push(emptyEngineState());
    propellers.push(emptyPropellerState(def.geometry.propellers[i]?.rotation ?? def.powerplant.engines[i].rotation));
  }
  const gear = fixedGearState();
  gear.retractable = retractable;
  return {
    aircraft: def.id,
    time: 0,
    position: v3.zero(),
    velocity: v3.zero(),
    orientation: quat.identity(),
    angularVelocity: v3.zero(),
    roll: 0,
    pitch: 0,
    heading: 0,
    track: 0,
    altitudeMSL: 0,
    altitudeAGL: 0,
    verticalSpeed: 0,
    groundSpeed: 0,
    tas: 0,
    ias: 0,
    mach: 0,
    alpha: 0,
    beta: 0,
    airVelocityBody: v3.zero(),
    specificForce: { x: 0, y: 0, z: -1 },
    gLoad: 1,
    slipBall: 0,
    staticPressure: 101325,
    oat: 288.15,
    airDensity: 1.225,
    onGround: false,
    stallWarning: false,
    stallFraction: 0,
    crashed: false,
    crashReason: '',
    surfaces: emptySurfaceState(),
    engine,
    propeller,
    engines,
    propellers,
    wheels: [makeWheel('nose'), makeWheel('left'), makeWheel('right')],
    fuel: {
      left: 0,
      right: 0,
      capacityEach: 0,
      tanks: def.powerplant.fuel.tanks.map((tank) => ({ id: tank.id, quantity: 0, capacity: 0 })),
    },
    gear,
    mass: 0,
    electrical: { busVoltage: 0, batteryCharge: 1, alternatorAmps: 0, batteryAmps: 0, alternators: def.powerplant.electrical.alternators.map(() => 0) },
  };
}

/** Rotate (x, y, z) by q into out (body -> NED). */
function rotateInto(q: Quat, x: number, y: number, z: number, out: Vec3): Vec3 {
  const cx = q.y * z - q.z * y;
  const cy = q.z * x - q.x * z;
  const cz = q.x * y - q.y * x;
  out.x = x + 2 * (q.w * cx + q.y * cz - q.z * cy);
  out.y = y + 2 * (q.w * cy + q.z * cx - q.x * cz);
  out.z = z + 2 * (q.w * cz + q.x * cy - q.y * cx);
  return out;
}

/** Rotate (x, y, z) by the inverse of q into out (NED -> body). */
function rotateInvInto(q: Quat, x: number, y: number, z: number, out: Vec3): Vec3 {
  const cx = -q.y * z + q.z * y;
  const cy = -q.z * x + q.x * z;
  const cz = -q.x * y + q.y * x;
  out.x = x + 2 * (q.w * cx - q.y * cz + q.z * cy);
  out.y = y + 2 * (q.w * cy - q.z * cx + q.x * cz);
  out.z = z + 2 * (q.w * cz - q.x * cy + q.y * cx);
  return out;
}

export class BladeElementFlightModel implements AircraftFlightModel, TrimPlant {
  readonly state: AircraftState;
  /**
   * Control positions that match the state produced by the last reset(): trimmed yoke, trim wheel, throttle,
   * aileron and rudder in the air; idle, take-off trim and the parking brake on the ground. Copy them into
   * the live ControlInputs after a reset so the aircraft continues as trimmed.
   */
  readonly trimControls: ControlInputs;
  /** Result of the trim solve of the last in-air reset (null after a ground reset). */
  lastTrim: TrimResult | null = null;
  /** Touchdowns detected during the last step() call (one entry per wheel contact). */
  readonly touchdowns: TouchdownEvent[] = [];
  /** Calibrated airspeed, m/s (AircraftState.ias is what the airspeed indicator shows, with position error). */
  cas = 0;
  /** Last aerodynamic output (stage 0 of the last sub-step), for diagnostics. */
  lastAero: AeroOutput | null = null;

  readonly aero: AeroModel;
  /** The powerplant; with one engine the single-engine facade, whose legacy members C172FlightModel exposes. */
  readonly propulsion: Powerplant;
  readonly gear: LandingGear;
  /** The retraction system (stepped once per sub-step); null on fixed gear. */
  readonly retract: RetractActuator | null;
  readonly controlSystem: ControlSystem;
  /**
   * The overspeed rules of LimitsDef with consequence 'warn': true while the calibrated airspeed has been above the
   * flap limit of the present flap deflection (or the gear's extended / operating limit) times (1 + margin) for
   * longer than the rule's time. Nothing else follows from it in the physics; a rule 'none' leaves it false.
   */
  readonly overspeed = { flaps: false, gear: false };
  get physicsRate(): number {
    return this.rate;
  }
  private rate: number;

  private readonly structuralFailure: boolean;
  private readonly trimAero: AeroModel;
  private readonly massModel: MassModel;
  private readonly airData: AirData;
  /** Payload for the next reset() and the fuel the mass properties were last built with (one entry per tank). */
  private readonly loading: { payload: number; payloadPosition: Vec3; tanks: number[] };
  private mp: MassProperties;
  private env: Environment | null = null;
  private time = 0;
  private accumulator = 0;
  private crashReason = '';

  // From the definition.
  /** Body points (reference-point axes) where the wind is sampled: half span and the tailplane. */
  private readonly halfSpan: number;
  private readonly tailArm: number;
  /** Hub of the propeller, reference-point body axes (engine 0's), and every engine's. */
  private readonly hub: Vec3;
  private readonly hubs: readonly Vec3[];
  /** Air velocity at every hub (index 0 is propIn.airVelocityBody); null on a single. */
  private readonly hubAir: Vec3[] | null;
  /** Some engine has a carburettor: the air's moisture is passed to the powerplant (icing). */
  private readonly carburetted: boolean;
  /** Drag scales of the flight (the gear's extension, the cowl flaps' opening) and of the trim; null when nothing scales. */
  private readonly dragScales: { gear: ArrayLike<number>; cowlFlaps: Float64Array } | null;
  private readonly trimDragScales: { gear: Float64Array; cowlFlaps: Float64Array } | null;
  /** A castering nosewheel: the gear gets no pedal position from a free rudder. */
  private readonly castering: boolean;
  /** An electric stall warner (StallSensor.needsBus) is dead at or below this bus voltage, V; null: it needs no bus. */
  private readonly stallWarnerDeadVolts: number | null;
  /** Input of the retraction system, reused. */
  private readonly retractIn: RetractInput = { lever: 'down', emergency: false, busVoltage: 0, weightOnWheels: false, minThrottle: 0, flapLever: 0, onGround: false };
  /** Seconds above the flap and gear overspeed limits (the 'warn' rules). */
  private flapOverspeedTime = 0;
  private gearOverspeedTime = 0;
  /** Rotor speed used for an in-flight start before the powerplant settles, and on the ground, rpm. */
  private readonly airStartRpm: number;
  private readonly groundStartRpm: number;
  private readonly ultimatePositive: number;
  private readonly ultimateNegative: number;
  private readonly ultimatePositiveFlaps: number;
  private readonly ultimateNegativeFlaps: number;
  /** Usable capacity of all tanks / 2, kg (AircraftState.fuel.capacityEach). */
  private readonly capacityEach: number;

  // Rigid-body state [pos NED (3), vel NED (3), quat w x y z (4), body rates (3)] and RK4 scratch.
  private readonly x = new Float64Array(13);
  private readonly xs = new Float64Array(13);
  private readonly k = [new Float64Array(13), new Float64Array(13), new Float64Array(13), new Float64Array(13)];

  // Per-sub-step inputs, reused.
  private readonly body: BodyState = {
    time: 0,
    position: v3.zero(),
    orientation: quat.identity(),
    velocityBody: v3.zero(),
    angularVelocity: v3.zero(),
    cgOffset: v3.zero(),
    mass: 0,
  };
  private atmosphere: AtmosphereSample;
  private controlsIn: ControlInputs;
  private readonly aeroIn: AeroInput;
  private readonly gearIn: GearInput;
  private readonly propIn: PropulsionInput;
  private prop: PropulsionOutput;
  private gearOut: GearOutput | null = null;
  private groundElevation = 0;
  /** Non-gravitational force at each RK stage of the last evaluation, body axes, N. */
  private readonly stageForce = [v3.zero(), v3.zero(), v3.zero(), v3.zero()];
  /** Specific force for the outputs: RK-weighted mean over the last sub-step, body axes, N. */
  private readonly meanForce = v3.zero();
  /** Aerodynamic normal force (body z) at each RK stage, N, and its low-passed value for the structure, N. */
  private readonly stageAeroZ = new Float64Array(4);
  private wingLoad = 0;
  // Linear wind field over the airframe: wind at the reference point and its change per metre along body x, y.
  private readonly wind0 = v3.zero();
  private readonly windDx = v3.zero();
  private readonly windDy = v3.zero();
  private readonly windOut = v3.zero();
  private readonly windAt = (p: Vec3): Vec3 => {
    const o = this.windOut;
    o.x = this.wind0.x + this.windDx.x * p.x + this.windDy.x * p.y;
    o.y = this.wind0.y + this.windDx.y * p.x + this.windDy.y * p.y;
    o.z = this.wind0.z + this.windDx.z * p.x + this.windDy.z * p.y;
    return o;
  };
  private readonly scratch = v3.zero();
  private readonly scratch2 = v3.zero();
  private readonly trimInputs: ControlInputs;
  /** Controls handed to the gear when the rudder is free (rudder = the floated pedal position). */
  private readonly freeRudderControls: ControlInputs;
  private lastTrimAltitude = 0;
  /** Trim-wheel setting for the take-off, solved by a ground reset. */
  private takeoffTrim = 0;
  /** Tail angle of attack of the last trim evaluation (for the elevator float), rad. */
  private trimTailAlpha = 0;
  private readonly trimSurfaces = { elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0, flaps: 0, elevatorTrim: 0, rudderTrim: 0 };

  constructor(readonly definition: AircraftDefinition, options: FlightModelOptions = {}) {
    const def = definition;
    const n = def.powerplant.engines.length;
    if (def.engineCount !== n) throw new Error(`BladeElementFlightModel: ${def.id} says ${def.engineCount} engines, its powerplant has ${n}`);
    const gearConfig = def.gear();
    if (def.geometry.gear.retractable !== (gearConfig.retract !== undefined)) {
      throw new Error(`BladeElementFlightModel: ${def.id}: geometry.gear.retractable and gear().retract disagree`);
    }
    this.state = makeState(def, gearConfig.retract !== undefined);
    this.trimControls = defaultControls(def);
    this.controlsIn = defaultControls(def);
    this.trimInputs = defaultControls(def);
    this.freeRudderControls = defaultControls(def);
    const aeroDef = def.aero();
    this.aero = new AeroModel(aeroDef);
    const sensors = aeroDef.stallWarning;
    this.stallWarnerDeadVolts = (Array.isArray(sensors) ? sensors : [sensors]).some((w) => w.needsBus) ? def.powerplant.electrical.busDeadVolts : null;
    // Each propeller's jet and inflow is the aero station of the same index.
    if (this.aero.propellerInflows.length !== n) throw new Error(`BladeElementFlightModel: ${def.id} has ${n} engines and ${this.aero.propellerInflows.length} aero propeller stations`);
    this.propulsion = n === 1 ? new PropulsionSystem(undefined, def.powerplant) : new Powerplant(def.powerplant);
    this.gear = new LandingGear(gearConfig);
    this.retract = gearConfig.retract ? new RetractActuator(gearConfig.retract) : null;
    this.controlSystem = new ControlSystem(def.controls);
    this.castering = def.controls.steering.kind === 'castering';
    this.trimAero = new AeroModel(def.aero(), { quasiSteady: true });
    this.massModel = createMassModel(def.mass, def.powerplant.fuel.tanks);
    this.airData = createAirData(def.airData, def.geometry.wing.area, def.controls.flaps.maxDeflection);

    const g = def.geometry;
    this.halfSpan = g.wing.span / 2;
    this.tailArm = -g.hTail.quarterChord.x;
    this.hub = this.propulsion.hubs[0];
    this.hubs = this.propulsion.hubs;
    this.carburetted = def.powerplant.engines.some((e) => e.engine.induction.carburettor !== undefined);
    const cowlFlaps = def.powerplant.engines.some((e) => e.engine.thermal.cowlFlapClosedFactor !== 1);
    this.dragScales = this.retract || cowlFlaps ? { gear: this.retract ? this.retract.state.extension : [1, 1, 1], cowlFlaps: new Float64Array(n).fill(1) } : null;
    this.trimDragScales = this.dragScales ? { gear: new Float64Array(3).fill(1), cowlFlaps: new Float64Array(n).fill(1) } : null;
    const engine = def.powerplant.engines[0].engine;
    this.airStartRpm = engine.airStartRpm;
    this.groundStartRpm = engine.groundStartRpm;
    const lim = def.limits;
    this.ultimatePositive = lim.loadFactorPositive * lim.ultimateFactor;
    this.ultimateNegative = lim.loadFactorNegative * lim.ultimateFactor;
    this.ultimatePositiveFlaps = (lim.loadFactorPositiveFlaps ?? lim.loadFactorPositive) * lim.ultimateFactor;
    this.ultimateNegativeFlaps = (lim.loadFactorNegativeFlaps ?? lim.loadFactorNegative) * lim.ultimateFactor;
    let capacity = 0;
    for (const c of this.propulsion.tankCapacities) capacity += c;
    this.capacityEach = capacity / 2;

    this.rate = options.physicsRate ?? DEFAULT_PHYSICS_RATE;
    this.structuralFailure = options.structuralFailure ?? true;
    const typical = def.mass.loadings.typical;
    this.loading = {
      payload: options.payload ?? typical.payload,
      payloadPosition: options.payloadPosition ?? typical.payloadPosition,
      tanks: Array.from(this.propulsion.tankQuantities),
    };
    this.mp = this.massModel.properties(this.loading);
    this.atmosphere = { temperature: 288.15, pressure: 101325, density: 1.225, speedOfSound: 340.3, viscosity: 1.79e-5 };
    this.aeroIn = {
      body: this.body,
      atmosphere: this.atmosphere,
      windNED: this.wind0,
      windAt: undefined,
      surfaces: this.controlSystem.surfaces,
      slipstream: null,
      heightAGL: 1000,
      dt: 0,
    };
    if (this.dragScales) this.aeroIn.dragScales = this.dragScales;
    // The environment arrives with reset() / step(); nothing reads gearIn before then.
    this.gearIn = { body: this.body, controls: this.controlsIn, env: null as unknown as Environment, dt: 0 };
    if (this.retract) this.gearIn.extension = this.retract.state.extension;
    this.propIn = { body: this.body, atmosphere: this.atmosphere, airVelocityBody: v3.zero(), controls: this.controlsIn, dt: 0 };
    this.hubAir = n > 1 ? this.hubs.map((_, i) => (i === 0 ? this.propIn.airVelocityBody : v3.zero())) : null;
    if (this.hubAir) this.propIn.airVelocityAt = this.hubAir;
    // Engines warm, as every in-air reset leaves them: a trim solved before the first reset() runs the engines its
    // controls run (cold-soaked, a FADEC engine does not light and a spark engine is down on power).
    this.propulsion.reset({ running: false, tanks: this.loading.tanks, warm: true });
    this.prop = this.propulsion.settle(this.propIn);
    this.x[6] = 1;
  }

  /** The powerplant (AircraftFlightModel). */
  get powerplant(): Powerplant {
    return this.propulsion;
  }

  /** Feet off the pedals: the rudder floats (ControlSystem.rudderFree). */
  get rudderFree(): boolean {
    return this.controlSystem.rudderFree;
  }

  set rudderFree(free: boolean) {
    this.controlSystem.rudderFree = free;
  }

  /** Current mass properties (mass, CG offset from the reference point, inertia about the CG). */
  get massProperties(): Readonly<MassProperties> {
    return this.mp;
  }

  // ---------------------------------------------------------------------------------------------------
  // Reset and trim

  /**
   * Change the sub-step rate used by the following step() calls (Hz, > 0). Time acceleration lowers it while
   * airborne; the state carries over unchanged.
   */
  setPhysicsRate(rate: number): void {
    if (!(rate > 0) || !Number.isFinite(rate)) throw new Error(`physics rate must be positive, got ${rate}`);
    this.rate = rate;
  }

  /** Payload (occupants and baggage) for the next reset(). */
  setLoading(l: LoadingRequest): void {
    this.loading.payload = l.payload;
    this.loading.payloadPosition = { ...l.payloadPosition };
  }

  /** Set the model clock (the wind field's time), s, changing nothing else. */
  setClock(t: number): void {
    this.time = t;
  }

  /**
   * Place the aircraft per the initial conditions: at rest on its wheels (ic.onGround), or trimmed for
   * steady straight flight at ic.airspeed (TAS) and ic.flightPathAngle. With an engine running the throttle
   * is solved for (and pinned at full or idle if the requested path cannot be held, in which case the flight
   * path is solved instead); with every engine stopped the aircraft is trimmed in a glide with the propellers
   * windmilling. A stopped engine (ic.enginesRunning) is, in the air, windmilling with the fuel cut (or
   * feathered, ic.feathered), on the ground parked (engineStopControls); on a single in the air its mixture is
   * at idle cut-off with the magnetos on. A retractable gear is down on the ground and per ic.gearDown in the
   * air. ic.flaps is the flap lever position 0..1. ic.position is the reference point. Takes 20-100 ms (trim
   * solves with the full component models).
   */
  reset(ic: InitialConditions, env: Environment): void {
    this.env = env;
    // A new flight starts its clock at 0: restart the wind field's frozen-turbulence advection with it.
    (env as Partial<SimEnvironment>).windField?.reset();
    this.gearIn.env = env;
    this.time = 0;
    this.accumulator = 0;
    this.crashReason = '';
    this.touchdowns.length = 0;
    this.gear.reset();
    this.aero.reset();
    // A new flight computes as on a new model: no influence matrices kept from an earlier flight or trim.
    this.aero.resetInfluence();
    this.trimAero.resetInfluence();
    this.gearOut = null;

    const fraction = clamp(ic.fuelFraction ?? 1, 0, 1);
    const tanks = this.loading.tanks;
    const capacities = this.propulsion.tankCapacities;
    for (let k = 0; k < tanks.length; k++) tanks[k] = fraction * capacities[k];
    this.mp = this.massModel.properties(this.loading);
    const flapLever = clamp(ic.flaps ?? 0, 0, 1);
    const altitude = -ic.position.z;
    this.groundElevation = env.groundElevation(ic.position.x, ic.position.y);
    this.updateAtmosphere(ic.onGround ? this.groundElevation : altitude);

    const c = this.trimControls;
    copyControls(c, defaultControls(this.definition));
    c.flaps = flapLever;
    const def = this.definition;
    const n = this.propulsion.engineCount;
    const running = (i: number): boolean => ic.enginesRunning?.[i] ?? ic.engineRunning;
    const air = this.airStartRpm;
    let powerplant: { running: boolean | boolean[]; tanks: number[]; rpm: number | number[]; oat: number; feathered?: boolean[] };
    if (n === 1) {
      const on = running(0);
      // A stopped engine: shut down when parked; in the air, failed with the magnetos still on and the
      // mixture at idle cut-off (a restart needs only the mixture).
      c.magnetos = on || !ic.onGround ? 3 : 0;
      c.mixture = on ? 1 : 0;
      powerplant = {
        running: on,
        tanks: tanks.slice(),
        rpm: on ? (ic.onGround ? this.groundStartRpm : air) : ic.onGround ? 0 : air,
        oat: this.atmosphere.temperature,
      };
    } else {
      const flags = Array.from({ length: n }, (_, i) => running(i));
      const feathered = flags.map((on, i) => !on && !ic.onGround && ic.feathered?.[i] === true);
      const engines = def.powerplant.engines;
      powerplant = {
        running: flags,
        tanks: tanks.slice(),
        rpm: flags.map((on, i) => (on ? (ic.onGround ? engines[i].engine.groundStartRpm : engines[i].engine.airStartRpm) : ic.onGround ? 0 : engines[i].engine.airStartRpm)),
        oat: this.atmosphere.temperature,
        feathered,
      };
      // In the air a stopped engine has just failed: its levers are set before the trim, so the trim is made with
      // it windmilling or feathered. (On the ground they are set after the take-off trim, which wants all engines.)
      if (!ic.onGround) flags.forEach((on, i) => on || Object.assign(c.engines[i], engineStopControls(def, i, feathered[i] ? 'feathered' : 'windmilling')));
    }
    if (this.retract) {
      if (ic.onGround && ic.gearDown === false) throw new Error('BladeElementFlightModel.reset: the gear must be down on the ground');
      const down = ic.onGround || (ic.gearDown ?? flapLever > 0);
      this.retract.reset(down);
      c.gearLever = down ? 'down' : 'up';
    }
    if (ic.onGround) {
      // The take-off trim is the trim for the full-power climb the aircraft will make, with a warm, running
      // engine whatever state it is parked in (a cold-and-dark engine with dry fuel lines cannot deliver power).
      this.propulsion.reset({ ...powerplant, running: true, rpm: air });
      const t = this.definition.sim.takeoffTrim;
      const takeoff = this.solveTrim(
        { tas: t.kias * KT, altitude: this.groundElevation + 300, throttle: 1, flaps: t.flapsDeg * DEG, track: ic.heading },
        env,
        { magnetos: 3, mixture: 1 },
      );
      this.takeoffTrim = takeoff.converged ? this.pitchControlsAtTrim(takeoff).elevatorTrim : 0;
      this.propulsion.reset(powerplant);
      if (n > 1) for (let i = 0; i < n; i++) if (!running(i)) Object.assign(c.engines[i], engineStopControls(def, i, 'parked'));
    } else {
      // An engine that is off in the air has just stopped: it is still warm.
      this.propulsion.reset({ ...powerplant, warm: true });
    }

    if (ic.onGround) this.resetOnGround(ic, env);
    else this.resetInAir(ic, env, altitude, flapLever);

    this.controlsIn = cloneControls(c);
    this.gearIn.controls = this.controlsIn;
    this.propIn.controls = this.controlsIn;
    this.sampleWind(env);
    this.controlSystem.setImmediate(c, this.dynamicPressure());
    this.evaluateInitial(env);
  }

  /** Populate the outputs for the current state without advancing anything. */
  private evaluateInitial(env: Environment): void {
    this.derivative(this.x, 0, 0, this.k[0]);
    this.wingLoad = this.stageAeroZ[0];
    Object.assign(this.meanForce, this.stageForce[0]);
    this.publish(env);
  }

  private resetOnGround(ic: InitialConditions, env: Environment): void {
    const pose = this.gear.restingPose(this.mp.mass, this.mp.cgOffset);
    const q = quat.fromEuler(0, pose.pitch, ic.heading);
    const ref = { x: ic.position.x, y: ic.position.y, z: -(this.groundElevation + pose.height) };
    this.setRigidBody(ref, q, v3.zero(), v3.zero());
    const c = this.trimControls;
    c.throttle = 0;
    c.parkingBrake = true;
    // Take-off trim: what a climb at full power needs (solved in reset()).
    c.elevatorTrim = this.takeoffTrim;
    this.controlSystem.tailAlpha = 0;
    this.lastTrim = null;
    // Powerplant at its steady ground speed for the parked controls.
    this.controlsIn = cloneControls(c);
    this.propIn.controls = this.controlsIn;
    this.propIn.airVelocityBody.x = this.propIn.airVelocityBody.y = this.propIn.airVelocityBody.z = 0;
    this.prop = this.propulsion.settle(this.propIn);
  }

  private resetInAir(ic: InitialConditions, env: Environment, altitude: number, flapLever: number): void {
    const flaps = flapLever * this.definition.controls.flaps.maxDeflection;
    const spec: TrimSpec = { tas: ic.airspeed, altitude, track: ic.heading, flaps, flightPathAngle: ic.flightPathAngle ?? 0 };
    let trim: TrimResult;
    const anyRunning = Array.from({ length: this.propulsion.engineCount }, (_, i) => ic.enginesRunning?.[i] ?? ic.engineRunning).includes(true);
    if (!anyRunning) {
      trim = this.solveTrim({ ...spec, throttle: 0 }, env);
    } else {
      trim = this.solveTrim(spec, env);
      if (!trim.converged && (trim.throttle > 0.999 || trim.throttle < 0.001)) {
        trim = this.solveTrim({ ...spec, throttle: trim.throttle > 0.5 ? 1 : 0 }, env);
      }
    }
    this.lastTrim = trim;
    const c = this.trimControls;
    Object.assign(c, this.pitchControlsAtTrim(trim));
    this.controlSystem.tailAlpha = this.trimTailAlpha;
    c.aileron = trim.aileron;
    c.rudder = trim.rudder;
    c.throttle = trim.throttle;
    const vb = trim.velocityBody;
    const vNed = quat.rotate(trim.orientation, vb);
    const wind = env.wind(ic.position, 0);
    this.setRigidBody(ic.position, trim.orientation, v3.add(vNed, wind), v3.zero());
  }

  /**
   * Trim for steady straight flight in `env` at the current mass. Controls the trim does not solve for
   * (mixture, magnetos, switches) come from trimControls, overridden by `fixed`. `spec.engineOut` cuts the fuel
   * of that engine with its propeller windmilling or feathered (engineStopControls); `spec.gearDown` and
   * `spec.cowlFlaps` set the drag of the gear and the cowl flaps for the trim (default: the gear as it is, the
   * cowl flaps as the controls say). The aircraft's own state is not changed, except that the powerplant is
   * left settled at the solution.
   */
  solveTrim(spec: TrimSpec, env: Environment, fixed: Readonly<ControlPatch> = {}): TrimResult {
    // Before the first reset() the ground is the environment's at the origin (afterwards: where the aircraft is).
    if (this.env === null) this.groundElevation = env.groundElevation(0, 0);
    this.env = env;
    const t = this.trimInputs;
    copyControls(t, this.trimControls);
    t.parkingBrake = false;
    applyControls(t, fixed);
    const out = spec.engineOut;
    if (out) Object.assign(t.engines[out.index], engineStopControls(this.definition, out.index, out.propeller));
    if (spec.cowlFlaps) spec.cowlFlaps.forEach((v, i) => i < t.engines.length && setEngineControl(t, i, 'cowlFlaps', v));
    // The trim's controls say which propellers are feathered: one that is feathered now (a feathered engine, or the
    // last trim's) but not commanded to feather starts from the fine stop, as primeForTrim() would leave it stopped.
    for (const unit of this.propulsion.units) {
      if (!unit.governor?.feathered) continue;
      unit.command(t);
      if (!unit.featherCommanded) unit.governor.reset(false);
    }
    const scales = this.trimDragScales;
    if (scales) {
      const extension = this.retract?.state.extension;
      for (let k = 0; k < 3; k++) scales.gear[k] = spec.gearDown === undefined ? (extension ? extension[k] : 1) : spec.gearDown ? 1 : 0;
      for (let i = 0; i < scales.cowlFlaps.length; i++) scales.cowlFlaps[i] = clamp(engineControl(t, i, 'cowlFlaps'), 0, 1);
    }
    this.lastTrimAltitude = spec.altitude;
    return trimFlight(this, spec);
  }

  /**
   * Trim wheel and yoke for a trim solution: the wheel is set so that the elevator floats hands-off at the
   * solved deflection, given the tail's angle of attack at that condition.
   */
  pitchControlsAtTrim(trim: TrimResult): { elevatorTrim: number; elevator: number } {
    const env = this.env!;
    const spec = this.lastTrimAltitude;
    const atm = env.atmosphere(spec);
    const V = v3.len(trim.velocityBody);
    const q = 0.5 * atm.density * V * V;
    const scratch = new Float64Array(6);
    this.accelerations(
      {
        altitude: spec,
        velocityBody: trim.velocityBody,
        orientation: trim.orientation,
        elevator: trim.elevator,
        aileron: trim.aileron,
        rudder: trim.rudder,
        throttle: trim.throttle,
        flaps: trim.flaps,
      },
      scratch,
    );
    const law = this.controlSystem.law;
    return law.pitchControlsFor(trim.elevator, law.alphaFloat(this.trimTailAlpha, q), q);
  }

  /** TrimPlant: body accelerations in still air with the powerplant settled (quasi-steady aerodynamics). */
  accelerations(c: TrimCondition, out: Float64Array): void {
    const env = this.env!;
    const atm = env.atmosphere(c.altitude);
    const V = v3.len(c.velocityBody);
    const qbar = 0.5 * atm.density * V * V;
    const law = this.controlSystem.law;
    const t = this.trimInputs;
    Object.assign(t, law.pitchControlsFor(c.elevator, 0, qbar));
    t.aileron = c.aileron;
    t.rudder = c.rudder;
    t.throttle = c.throttle;
    t.flaps = c.flaps / this.definition.controls.flaps.maxDeflection;
    const surfaces = law.surfaceTargets(t, qbar, this.trimSurfaces);
    // The trim wheel that floats the elevator to the requested deflection depends on the tail's angle of
    // attack; the aerodynamics sets the matching tab deflection (its own small lift) once that is known.
    this.trimAero.tailHook = (tailAlpha, s) => {
      const tab = law.trimTabDeflection(law.pitchControlsFor(c.elevator, law.alphaFloat(tailAlpha, qbar), qbar).elevatorTrim);
      if (tab === s.elevatorTrim) return false;
      s.elevatorTrim = tab;
      return true;
    };

    const mp = this.mp;
    const body: BodyState = {
      time: 0,
      position: { x: 0, y: 0, z: -c.altitude },
      orientation: c.orientation,
      velocityBody: c.velocityBody,
      angularVelocity: v3.zero(),
      cgOffset: mp.cgOffset,
      mass: mp.mass,
    };
    // Every evaluation settles from the same shaft speed, so the result is a function of the condition alone
    // (a windmilling propeller has two steady states near its stopping speed: turning or stopped).
    this.propulsion.primeForTrim(this.airStartRpm);
    // The propeller meets the free stream plus the wing's upwash at the disc, which is known only once the
    // aerodynamics has been solved: a first pass without it, then the powerplant is settled again in the upwash
    // of the first pass (a small correction, converged to well within the trim tolerance) and the
    // aerodynamics repeated with that slipstream.
    const hubAir = v3.neg(c.velocityBody);
    // Every hub of a twin meets the same free stream plus the upwash at its own disc.
    const hubAirs = this.hubAir ? this.hubs.map((_, i) => (i === 0 ? hubAir : v3.neg(c.velocityBody))) : undefined;
    const twin = hubAirs !== undefined;
    let prop!: PropulsionOutput;
    let aero!: AeroOutput;
    for (let pass = 0; pass < 2; pass++) {
      const propInput: PropulsionInput = { body, atmosphere: atm, airVelocityBody: hubAir, controls: t, dt: 0 };
      if (twin) propInput.airVelocityAt = hubAirs;
      prop = this.propulsion.settle(propInput);
      const aeroInput: AeroInput = {
        body,
        atmosphere: atm,
        windNED: v3.zero(),
        surfaces,
        slipstream: prop.slipstream,
        heightAGL: c.altitude - this.groundElevation,
        dt: 0,
      };
      if (twin) aeroInput.slipstreams = prop.slipstreams;
      if (this.trimDragScales) aeroInput.dragScales = this.trimDragScales;
      aero = this.trimAero.compute(aeroInput);
      const up = this.trimAero.propellerInflow;
      hubAir.x = up.x - c.velocityBody.x;
      hubAir.y = up.y - c.velocityBody.y;
      hubAir.z = up.z - c.velocityBody.z;
      if (twin) {
        for (let i = 1; i < hubAirs.length; i++) {
          const u = this.trimAero.propellerInflows[i];
          hubAirs[i].x = u.x - c.velocityBody.x;
          hubAirs[i].y = u.y - c.velocityBody.y;
          hubAirs[i].z = u.z - c.velocityBody.z;
        }
      }
    }
    this.trimTailAlpha = this.trimAero.tailplaneAlpha();
    const g = quat.rotateInv(c.orientation, { x: 0, y: 0, z: G0 });
    out[0] = (aero.force.x + prop.force.x) / mp.mass + g.x;
    out[1] = (aero.force.y + prop.force.y) / mp.mass + g.y;
    out[2] = (aero.force.z + prop.force.z) / mp.mass + g.z;
    const { Ixx, Iyy, Izz, Ixz } = mp.inertia;
    const mx = aero.moment.x + prop.moment.x;
    const my = aero.moment.y + prop.moment.y;
    const mz = aero.moment.z + prop.moment.z;
    const det = Ixx * Izz - Ixz * Ixz;
    out[3] = (Izz * mx + Ixz * mz) / det;
    out[4] = my / Iyy;
    out[5] = (Ixz * mx + Ixx * mz) / det;
  }

  /**
   * Move the aircraft to an arbitrary kinematic state (reference-point position NED, attitude, ground
   * velocity NED, body rates), keeping the engine, fuel and control surfaces as they are: for teleports,
   * scenario editors and tests. Aerodynamic lag states and the gear's tyre states restart from rest.
   */
  setKinematics(k: { position: Vec3; orientation: Quat; velocity: Vec3; angularVelocity: Vec3 }): void {
    this.aero.reset();
    this.gear.reset();
    this.crashReason = '';
    this.setRigidBody(k.position, quat.normalize(k.orientation), k.velocity, k.angularVelocity);
    const env = this.env;
    if (env) {
      this.groundElevation = env.groundElevation(k.position.x, k.position.y);
      this.updateAtmosphere(-k.position.z);
      this.sampleWind(env);
      this.evaluateInitial(env);
    }
  }

  /** What a resume snapshot keeps besides the rigid body and the controls. */
  captureSystems(): SystemsSnapshot {
    const pp = this.propulsion;
    const ext = this.state.gear.extension;
    return {
      engines: pp.capture(),
      tanks: Array.from(pp.tankQuantities),
      batteryCharge: pp.batteryCharge,
      surfaces: { ...this.controlSystem.surfaces },
      gear: this.retract ? this.retract.capture() : { extension: [ext[0], ext[1], ext[2]], emergency: false },
    };
  }

  /**
   * Put the systems into the state of a snapshot: the powerplant reset to the saved shaft speeds, tanks and
   * battery with the saved temperatures (and blade angle, latch, carburettor ice, cowl flap and ECU timers where
   * the engine has them), the retractable gear's legs where they were, then the surfaces set for `controls` at
   * `dynamicPressure` (Pa) and moved to where they were saved. Call setKinematics() afterwards for the rigid body.
   */
  restoreSystems(s: SystemsSnapshot, controls: ControlInputs, dynamicPressure: number): void {
    const pp = this.propulsion;
    pp.reset({
      running: s.engines.map((e) => e.running),
      tanks: s.tanks,
      rpm: s.engines.map((e) => e.rpm),
      oat: this.state.oat,
      batteryCharge: s.batteryCharge,
    });
    for (const unit of pp.units) {
      const e = s.engines[unit.index];
      if (!e) continue;
      const th = unit.thermal;
      th.egt = e.egt;
      th.cht = e.cht;
      th.oilTemp = e.oilTemp;
      th.oilPressure = th.oilGaugePsi = e.oilPressure;
      if (e.coolantTemp !== undefined) th.coolantTemp = e.coolantTemp;
      if (e.gearboxTemp !== undefined) th.gearboxTemp = e.gearboxTemp;
      unit.cowlFlap = e.cowlFlap;
      const engine = unit.engine;
      if ('induction' in engine && unit.install.engine.induction.carburettor !== undefined) engine.induction.ice = clamp(e.carbIce, 0, 1);
      if ('backupUsed' in engine) {
        engine.backupUsed = e.ecuBackupUsed ?? 0;
        engine.glowSeconds = e.glowSeconds ?? 0;
      }
      const governor = unit.governor;
      if (governor) {
        governor.pitch = clamp(e.bladePitch, governor.def.fineStop, Math.max(governor.def.coarseStop, governor.def.feather?.angle ?? 0));
        governor.latched = e.featherLatched;
        governor.accumulatorCharged = e.accumulatorCharged ?? true;
      }
    }
    if (this.retract) {
      this.retract.restore(s.gear);
      this.publishGear();
    }
    const cs = this.controlSystem;
    cs.setImmediate(controls, dynamicPressure);
    Object.assign(cs.surfaces, s.surfaces);
  }

  /** Set the rigid-body state from the reference-point position, attitude, CG velocity and body rates. */
  private setRigidBody(ref: Vec3, q: Quat, velocity: Vec3, rates: Vec3): void {
    const cg = quat.rotate(q, this.mp.cgOffset);
    const x = this.x;
    x[0] = ref.x + cg.x;
    x[1] = ref.y + cg.y;
    x[2] = ref.z + cg.z;
    x[3] = velocity.x;
    x[4] = velocity.y;
    x[5] = velocity.z;
    x[6] = q.w;
    x[7] = q.x;
    x[8] = q.y;
    x[9] = q.z;
    x[10] = rates.x;
    x[11] = rates.y;
    x[12] = rates.z;
  }

  // ---------------------------------------------------------------------------------------------------
  // Time stepping

  step(dt: number, controls: ControlInputs, env: Environment): void {
    this.touchdowns.length = 0;
    if (!(dt > 0)) return;
    this.env = env;
    this.gearIn.env = env;
    // With the feet off the pedals the nosewheel follows the floating rudder through the steering bungee: the
    // gear sees the pedal position the rudder implies (a copy of the controls, refreshed every sub-step).
    if (this.controlSystem.rudderFree) {
      // Not copyControls(): that allocates, and this runs every step. The copy SHARES `lights` and `engines`
      // with the caller's object and is only read (by the gear); never write a per-engine control through it.
      Object.assign(this.freeRudderControls, controls);
      this.gearIn.controls = this.freeRudderControls;
    } else this.gearIn.controls = controls;
    this.propIn.controls = controls;
    if (this.crashReason) {
      this.time += dt;
      this.state.time = this.time;
      return;
    }
    const h = 1 / this.physicsRate;
    this.accumulator += Math.min(dt, MAX_FRAME);
    while (this.accumulator >= h && !this.crashReason) {
      this.accumulator -= h;
      this.substep(h, controls, env);
    }
    this.publish(env);
  }

  private substep(h: number, controls: ControlInputs, env: Environment): void {
    const x = this.x;
    const quantities = this.propulsion.fuel.quantities;
    const tanks = this.loading.tanks;
    let change = 0;
    for (let k = 0; k < tanks.length; k++) change += Math.abs(quantities[k] - tanks[k]);
    if (change > FUEL_REBUILD) {
      for (let k = 0; k < tanks.length; k++) tanks[k] = quantities[k];
      this.mp = this.massModel.properties(this.loading);
    }
    this.updateAtmosphere(-x[2]);
    this.groundElevation = env.groundElevation(x[0], x[1]);
    this.sampleWind(env);
    this.controlSystem.update(h, controls, this.dynamicPressure(), this.prop.electrical.busVoltage);
    // A castering nosewheel is not linked to the pedals: the gear gets the pilot's (ignored) input.
    if (this.gearIn.controls === this.freeRudderControls && !this.castering) this.freeRudderControls.rudder = this.controlSystem.pedalPosition;
    // Retraction system: once per step, on the bus and the wheel loads of the step before.
    if (this.retract) this.stepRetract(h, controls);

    // Powerplant: once per step at the start-of-step state.
    this.loadBody(x, 0, 0);
    const b = this.body;
    const w = b.angularVelocity;
    const cg = this.mp.cgOffset;
    const hubs = this.hubs;
    const hubAir = this.hubAir;
    for (let i = 0; i < hubs.length; i++) {
      const hub = hubs[i];
      const rx = hub.x - cg.x, ry = hub.y - cg.y, rz = hub.z - cg.z;
      const windHub = this.windAt(hub);
      const wb = rotateInvInto(b.orientation, windHub.x, windHub.y, windHub.z, this.scratch);
      const air = hubAir ? hubAir[i] : this.propIn.airVelocityBody;
      air.x = wb.x - (b.velocityBody.x + w.y * rz - w.z * ry);
      air.y = wb.y - (b.velocityBody.y + w.z * rx - w.x * rz);
      air.z = wb.z - (b.velocityBody.z + w.x * ry - w.y * rx);
      // Plus the wing's upwash at the disc (from the last aerodynamic evaluation, one sub-step old).
      const up = this.aero.propellerInflows[i];
      air.x += up.x;
      air.y += up.y;
      air.z += up.z;
    }
    // The moisture of the air at this altitude (an environment without weather: dry air, no icing).
    if (this.carburetted) this.propIn.moisture = (env as Partial<SimEnvironment>).moisture?.(-x[2]);
    this.propIn.dt = h;
    this.prop = this.propulsion.step(this.propIn);
    const scales = this.dragScales;
    if (scales) {
      const units = this.propulsion.units;
      for (let i = 0; i < units.length; i++) scales.cowlFlaps[i] = units[i].cowlFlap;
    }

    // RK4.
    const [k1, k2, k3, k4] = this.k;
    const xs = this.xs;
    this.derivative(x, 0, h, k1);
    for (let i = 0; i < 13; i++) xs[i] = x[i] + 0.5 * h * k1[i];
    this.derivative(xs, 1, h, k2);
    for (let i = 0; i < 13; i++) xs[i] = x[i] + 0.5 * h * k2[i];
    this.derivative(xs, 2, h, k3);
    for (let i = 0; i < 13; i++) xs[i] = x[i] + h * k3[i];
    this.derivative(xs, 3, h, k4);
    for (let i = 0; i < 13; i++) x[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    const m = this.meanForce;
    m.x = m.y = m.z = 0;
    for (let i = 0; i < 4; i++) {
      const f = this.stageForce[i];
      m.x += STAGE_WEIGHT[i] * f.x;
      m.y += STAGE_WEIGHT[i] * f.y;
      m.z += STAGE_WEIGHT[i] * f.z;
    }
    const n = 1 / Math.hypot(x[6], x[7], x[8], x[9]);
    x[6] *= n;
    x[7] *= n;
    x[8] *= n;
    x[9] *= n;
    this.time += h;
    this.checkStructure(h);
  }

  /**
   * Advance the retraction system by h: the selector and the emergency knob, the bus voltage and the squat switch
   * (weight on a main wheel) of the step before, the lowest throttle / power lever of any engine (running or
   * not) and the flap lever for the warning horn. The legs' extension is GearInput.extension and the drag scale.
   */
  private stepRetract(h: number, controls: ControlInputs): void {
    const g = this.gearOut;
    const r = this.retractIn;
    let minThrottle = Infinity;
    for (let i = 0; i < this.hubs.length; i++) minThrottle = Math.min(minThrottle, engineControl(controls, i, 'throttle'));
    r.lever = controls.gearLever;
    r.emergency = controls.gearEmergency;
    r.busVoltage = this.prop.electrical.busVoltage;
    r.weightOnWheels = g !== null && (g.wheels[1].load > 0 || g.wheels[2].load > 0);
    r.minThrottle = minThrottle;
    r.flapLever = controls.flaps;
    r.onGround = g !== null && g.onGround;
    this.retract!.update(h, r);
  }

  /** Copy the retraction system's state into this.state.gear. */
  private publishGear(): void {
    const r = this.retract!.state;
    const g = this.state.gear;
    g.lever = r.lever;
    for (let k = 0; k < 3; k++) {
      g.extension[k] = r.extension[k];
      g.locked[k] = r.locked[k];
    }
    g.inTransit = r.inTransit;
    g.warning = r.warning;
  }

  /** Fill this.body from a state vector at RK stage `stage` of a step of length h. */
  private loadBody(s: Float64Array, stage: number, h: number): void {
    const b = this.body;
    const q = b.orientation;
    const n = 1 / Math.hypot(s[6], s[7], s[8], s[9]);
    q.w = s[6] * n;
    q.x = s[7] * n;
    q.y = s[8] * n;
    q.z = s[9] * n;
    rotateInvInto(q, s[3], s[4], s[5], b.velocityBody);
    b.angularVelocity.x = s[10];
    b.angularVelocity.y = s[11];
    b.angularVelocity.z = s[12];
    const cg = this.mp.cgOffset;
    b.cgOffset.x = cg.x;
    b.cgOffset.y = cg.y;
    b.cgOffset.z = cg.z;
    b.mass = this.mp.mass;
    const r = rotateInto(q, cg.x, cg.y, cg.z, this.scratch2);
    b.position.x = s[0] - r.x;
    b.position.y = s[1] - r.y;
    b.position.z = s[2] - r.z;
    b.time = this.time + STAGE_TIME[stage] * h;
  }

  /** State derivative at RK stage `stage` (aero lags advance on stage 0 when h > 0). */
  private derivative(s: Float64Array, stage: number, h: number, out: Float64Array): void {
    this.loadBody(s, stage, h);
    const b = this.body;
    const ai = this.aeroIn;
    ai.atmosphere = this.atmosphere;
    ai.slipstream = this.prop.slipstream;
    if (this.hubAir) ai.slipstreams = this.prop.slipstreams;
    ai.heightAGL = -b.position.z - this.groundElevation;
    ai.dt = stage === 0 ? h : 0;
    const a = this.aero.compute(ai);
    this.gearIn.dt = h > 0 ? h : 1 / this.physicsRate;
    const g = this.gear.compute(this.gearIn);
    if (stage === 0) {
      this.lastAero = a;
      this.controlSystem.tailAlpha = this.aero.tailplaneAlpha();
      this.controlSystem.finAlpha = this.aero.finAlpha();
      this.controlSystem.finDynamicPressure = this.aero.finDynamicPressure();
      this.controlSystem.noseLoad = g.wheels[0].load;
      this.gearOut = g;
      if (h > 0) for (const e of g.touchdowns) this.touchdowns.push(e);
    }
    if (g.crash && !this.crashReason) this.crashReason = g.crash;

    const p = this.prop;
    const fx = a.force.x + p.force.x + g.force.x;
    const fy = a.force.y + p.force.y + g.force.y;
    const fz = a.force.z + p.force.z + g.force.z;
    const mx = a.moment.x + p.moment.x + g.moment.x;
    const my = a.moment.y + p.moment.y + g.moment.y;
    const mz = a.moment.z + p.moment.z + g.moment.z;
    this.stageAeroZ[stage] = a.force.z;
    const sf = this.stageForce[stage];
    sf.x = fx;
    sf.y = fy;
    sf.z = fz;

    const { mass, inertia } = this.mp;
    const q = b.orientation;
    const f = rotateInto(q, fx, fy, fz, this.scratch);
    out[0] = s[3];
    out[1] = s[4];
    out[2] = s[5];
    out[3] = f.x / mass;
    out[4] = f.y / mass;
    out[5] = f.z / mass + G0;
    // Quaternion kinematics on the un-normalised stage quaternion.
    const P = s[10], Q = s[11], R = s[12];
    out[6] = 0.5 * (-s[7] * P - s[8] * Q - s[9] * R);
    out[7] = 0.5 * (s[6] * P + s[8] * R - s[9] * Q);
    out[8] = 0.5 * (s[6] * Q + s[9] * P - s[7] * R);
    out[9] = 0.5 * (s[6] * R + s[7] * Q - s[8] * P);
    // Euler's equations with the rotor's angular momentum (gyroscopic coupling): I dw/dt = M - w x (I w + h).
    const { Ixx, Iyy, Izz, Ixz } = inertia;
    const hr = p.angularMomentum;
    const Hx = Ixx * P - Ixz * R + hr.x;
    const Hy = Iyy * Q + hr.y;
    const Hz = Izz * R - Ixz * P + hr.z;
    const ex = mx - (Q * Hz - R * Hy);
    const ey = my - (R * Hx - P * Hz);
    const ez = mz - (P * Hy - Q * Hx);
    const det = Ixx * Izz - Ixz * Ixz;
    out[10] = (Izz * ex + Ixz * ez) / det;
    out[11] = ey / Iyy;
    out[12] = (Ixz * ex + Ixx * ez) / det;
  }

  private updateAtmosphere(altitude: number): void {
    this.atmosphere = this.env ? this.env.atmosphere(altitude) : this.atmosphere;
    this.aeroIn.atmosphere = this.atmosphere;
    this.propIn.atmosphere = this.atmosphere;
  }

  /** Dynamic pressure of the current state (for the cable-stretch model), Pa. */
  private dynamicPressure(): number {
    const x = this.x;
    const vx = x[3] - this.wind0.x, vy = x[4] - this.wind0.y, vz = x[5] - this.wind0.z;
    return 0.5 * this.atmosphere.density * (vx * vx + vy * vy + vz * vz);
  }

  /** Sample the wind at the reference point, both wingtips and the tailplane; build the linear field. */
  private sampleWind(env: Environment): void {
    const x = this.x;
    const t = this.time;
    const q = this.body.orientation;
    const n = 1 / Math.hypot(x[6], x[7], x[8], x[9]);
    q.w = x[6] * n;
    q.x = x[7] * n;
    q.y = x[8] * n;
    q.z = x[9] * n;
    const cg = this.mp.cgOffset;
    const r = rotateInto(q, cg.x, cg.y, cg.z, this.scratch);
    const ref = { x: x[0] - r.x, y: x[1] - r.y, z: x[2] - r.z };
    const at = (bx: number, by: number) => {
      const d = rotateInto(q, bx, by, 0, this.scratch);
      return env.wind({ x: ref.x + d.x, y: ref.y + d.y, z: ref.z + d.z }, t);
    };
    const halfSpan = this.halfSpan;
    const tailArm = this.tailArm;
    const w0 = env.wind(ref, t);
    const wl = at(0, -halfSpan);
    const wr = at(0, halfSpan);
    const wt = at(-tailArm, 0);
    this.wind0.x = w0.x;
    this.wind0.y = w0.y;
    this.wind0.z = w0.z;
    this.windDy.x = (wr.x - wl.x) / (2 * halfSpan);
    this.windDy.y = (wr.y - wl.y) / (2 * halfSpan);
    this.windDy.z = (wr.z - wl.z) / (2 * halfSpan);
    this.windDx.x = (w0.x - wt.x) / tailArm;
    this.windDx.y = (w0.y - wt.y) / tailArm;
    this.windDx.z = (w0.z - wt.z) / tailArm;
    const uniform = v3.lenSq(this.windDx) + v3.lenSq(this.windDy) < 1e-12;
    this.aeroIn.windAt = uniform ? undefined : this.windAt;
  }

  /**
   * Structural failure beyond the ultimate load factor (the flaps-extended limits while any flap is out) or the
   * design dive speed; ground impact from the gear. The wing load is the RK-weighted mean aerodynamic normal
   * force over the step, low-passed with the wing's structural response time (a wing does not fail on a load
   * applied for a few milliseconds).
   */
  private checkStructure(h: number): void {
    let mean = 0;
    for (let i = 0; i < 4; i++) mean += STAGE_WEIGHT[i] * this.stageAeroZ[i];
    if (Number.isFinite(mean)) this.wingLoad += (1 - Math.exp(-h / this.definition.limits.structureTime)) * (mean - this.wingLoad);
    const lim = this.definition.limits;
    if (lim.flapOverspeed.consequence === 'warn' || lim.gearOverspeed.consequence === 'warn') this.checkOverspeed(h);
    if (this.crashReason || !this.structuralFailure || !this.lastAero) return;
    const n = -this.wingLoad / (this.mp.mass * G0);
    const flaps = this.controlSystem.surfaces.flaps > 0;
    if (n > (flaps ? this.ultimatePositiveFlaps : this.ultimatePositive) || n < (flaps ? this.ultimateNegativeFlaps : this.ultimateNegative)) {
      this.crashReason = `Structural failure: wing overstressed at ${n.toFixed(1)} g`;
      return;
    }
    const x = this.x;
    const vx = x[3] - this.wind0.x, vy = x[4] - this.wind0.y, vz = x[5] - this.wind0.z;
    const cas = casFromTas(Math.hypot(vx, vy, vz), this.atmosphere);
    if (cas > this.definition.limits.diveSpeedCas) this.crashReason = `Structural failure: overspeed at ${(cas / KT).toFixed(0)} KCAS`;
  }

  /**
   * The 'warn' overspeed rules: the flap limit is that of the detent the flaps have reached or passed (between two
   * detents, the next one's), the gear's the extended limit with every leg locked down and the extend / retract
   * limit while a leg travels. A rule counts the time above limit x (1 + margin) and warns past its `time`.
   */
  private checkOverspeed(h: number): void {
    const lim = this.definition.limits;
    const x = this.x;
    const vx = x[3] - this.wind0.x, vy = x[4] - this.wind0.y, vz = x[5] - this.wind0.z;
    const cas = casFromTas(Math.hypot(vx, vy, vz), this.atmosphere);
    const flaps = lim.flapOverspeed;
    if (flaps.consequence === 'warn') {
      const deflection = this.controlSystem.surfaces.flaps;
      const detents = this.definition.controls.flaps.detents;
      let k = 0;
      while (k < detents.length - 1 && detents[k] < deflection - 1e-6) k++;
      const vfe = deflection > 1e-6 ? (lim.vfeCas[Math.max(k, 1)] ?? Infinity) : Infinity;
      this.flapOverspeedTime = cas > vfe * (1 + flaps.margin) ? this.flapOverspeedTime + h : 0;
      this.overspeed.flaps = this.flapOverspeedTime > flaps.time;
    }
    const gear = lim.gearOverspeed;
    if (gear.consequence === 'warn' && this.retract) {
      const r = this.retract.state;
      const up = r.extension[0] === 0 && r.extension[1] === 0 && r.extension[2] === 0;
      const limit = up ? Infinity : r.inTransit ? ((r.lever === 'down' ? lim.vloExtendCas : lim.vloRetractCas) ?? lim.vleCas ?? Infinity) : (lim.vleCas ?? Infinity);
      this.gearOverspeedTime = cas > limit * (1 + gear.margin) ? this.gearOverspeedTime + h : 0;
      this.overspeed.gear = this.gearOverspeedTime > gear.time;
    }
  }

  // ---------------------------------------------------------------------------------------------------
  // Outputs

  /** Copy the rigid-body state and the component outputs into this.state. */
  private publish(env: Environment): void {
    const s = this.state;
    const x = this.x;
    const mp = this.mp;
    const q = s.orientation;
    q.w = x[6];
    q.x = x[7];
    q.y = x[8];
    q.z = x[9];
    const cg = quat.rotate(q, mp.cgOffset);
    s.time = this.time;
    s.position.x = x[0] - cg.x;
    s.position.y = x[1] - cg.y;
    s.position.z = x[2] - cg.z;
    s.velocity.x = x[3];
    s.velocity.y = x[4];
    s.velocity.z = x[5];
    s.angularVelocity.x = x[10];
    s.angularVelocity.y = x[11];
    s.angularVelocity.z = x[12];
    const e = quat.toEuler(q);
    s.roll = e.roll;
    s.pitch = e.pitch;
    s.heading = e.heading;
    s.track = wrapTwoPi(Math.atan2(x[4], x[3]));
    s.groundSpeed = Math.hypot(x[3], x[4]);
    s.verticalSpeed = -x[5];
    s.altitudeMSL = -x[2];
    s.altitudeAGL = -x[2] - env.groundElevation(x[0], x[1]);

    const atm = this.atmosphere;
    const air = quat.rotateInv(q, { x: x[3] - this.wind0.x, y: x[4] - this.wind0.y, z: x[5] - this.wind0.z });
    s.airVelocityBody.x = air.x;
    s.airVelocityBody.y = air.y;
    s.airVelocityBody.z = air.z;
    const tas = v3.len(air);
    s.tas = tas;
    s.mach = tas / atm.speedOfSound;
    s.alpha = Math.atan2(air.z, air.x);
    s.beta = tas > 1e-6 ? Math.asin(clamp(air.y / tas, -1, 1)) : 0;
    this.cas = casFromTas(tas, atm);
    const qS = 0.5 * atm.density * tas * tas * this.definition.geometry.wing.area;
    const cl = this.lastAero && qS > MIN_AIR_DATA_QS ? this.lastAero.lift / qS : 0;
    s.ias = this.airData.indicatedAirspeed(this.cas, this.controlSystem.surfaces.flaps, cl);
    s.staticPressure = atm.pressure;
    s.oat = atm.temperature;
    s.airDensity = atm.density;

    const f = this.meanForce;
    const k = 1 / (mp.mass * G0);
    s.specificForce.x = f.x * k;
    s.specificForce.y = f.y * k;
    s.specificForce.z = f.z * k;
    s.gLoad = -s.specificForce.z;
    s.slipBall = slipBall(s.specificForce.y, s.specificForce.z);

    const a = this.lastAero;
    s.stallWarning = a ? a.stallWarning && (this.stallWarnerDeadVolts === null || this.prop.electrical.busVoltage > this.stallWarnerDeadVolts) : false;
    s.stallFraction = a ? a.stallFraction : 0;
    const g = this.gearOut;
    if (g) {
      for (let i = 0; i < 3; i++) Object.assign(s.wheels[i], g.wheels[i]);
      s.onGround = g.onGround;
    }
    s.crashed = this.crashReason !== '';
    s.crashReason = this.crashReason;

    Object.assign(s.surfaces, this.controlSystem.surfaces);
    const p = this.prop;
    // engines[0] / propellers[0] are s.engine / s.propeller themselves; the tanks and the alternator list follow
    // the legacy fields.
    Object.assign(s.engine, p.engine);
    Object.assign(s.propeller, p.propeller);
    for (let i = 1; i < s.engines.length; i++) {
      Object.assign(s.engines[i], p.engines[i]);
      Object.assign(s.propellers[i], p.propellers[i]);
    }
    const el = s.electrical;
    el.busVoltage = p.electrical.busVoltage;
    el.batteryCharge = p.electrical.batteryCharge;
    el.alternatorAmps = p.electrical.alternatorAmps;
    el.batteryAmps = p.electrical.batteryAmps;
    if (el.alternators.length === 1) el.alternators[0] = el.alternatorAmps;
    else for (let a = 0; a < el.alternators.length; a++) el.alternators[a] = p.electrical.alternators[a];
    if (this.retract) this.publishGear();
    const fuel = this.propulsion.fuel;
    s.fuel.left = fuel.left;
    s.fuel.right = fuel.right;
    s.fuel.capacityEach = this.capacityEach;
    const tanks = s.fuel.tanks;
    const quantities = fuel.quantities;
    const capacities = this.propulsion.tankCapacities;
    for (let i = 0; i < tanks.length; i++) {
      tanks[i].quantity = quantities[i];
      tanks[i].capacity = capacities[i];
    }
    s.mass = mp.mass;
  }
}
