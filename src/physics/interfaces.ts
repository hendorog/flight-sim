// Seams between the flight-model components (aerodynamics, propulsion, landing gear) and the assembly
// that integrates them. Each component is a pure-ish function of the instantaneous rigid-body state plus
// its own internal state; the assembly sums the forces and integrates.
//
// All vectors are in body axes (FRD) unless named otherwise. Component geometry is expressed relative to
// the aircraft reference point (see core/c172.ts); each component receives the current CG offset from that
// point and must report its moment about the actual CG.

import type { Quat, Vec3 } from '../core/math';
import type {
  AtmosphereSample, ControlInputs, ControlPatch, EngineState, Environment, FlightModel, PropellerState,
  SurfaceState, WheelState,
} from '../core/types';
import type { AircraftDefinition } from '../aircraft/types';
import type { MassProperties } from './massModel';
import type { TrimResult, TrimSpec } from './trim';

export interface ForceMoment {
  /** N, body axes. */
  force: Vec3;
  /** N*m about the CG, body axes. */
  moment: Vec3;
}

/** Instantaneous rigid-body state handed to every component. */
export interface BodyState {
  /** Simulation time of this evaluation, s. When an integrator evaluates components at every RK stage this is the stage time. */
  time: number;
  /** Reference-point position, NED m. */
  position: Vec3;
  /** Body -> NED. */
  orientation: Quat;
  /** Ground-relative velocity of the CG, body axes, m/s. */
  velocityBody: Vec3;
  /** Body angular velocity (p, q, r), rad/s. */
  angularVelocity: Vec3;
  /** CG position relative to the reference point, body axes, m. */
  cgOffset: Vec3;
  mass: number;
}

/** Propeller slipstream, produced by propulsion and consumed by aerodynamics (tail and inner-wing elements). */
export interface Slipstream {
  /** Propeller disc centre, body axes relative to the reference point. */
  origin: Vec3;
  /** Slipstream radius far downstream (contracted), m. */
  radius: number;
  /** Axial velocity increment of the air at the disc, m/s (air accelerated toward -x body). The far-wake increment is twice this. */
  inducedVelocity: number;
  /**
   * Mean swirl rate of the slipstream about the body x axis, rad/s (+ = same sense as a clockwise-from-cockpit
   * propeller, i.e. right-hand rule about +x): the solid-body rate that would carry the shaft torque over the
   * contracted wake, 2 Q / (mdot R_far^2).
   */
  swirlRate: number;
  /**
   * Radial distribution of the swirl's angular momentum: k(xi) at xi = (j + 0.5) / n (xi = radius over the
   * slipstream radius), with r v_theta = (swirlRate R_far^2 / 2) k(xi) and the integral of k(xi) 2 xi dxi = 1.
   * Absent: solid-body rotation, k = 2 xi^2.
   */
  swirlProfile?: ArrayLike<number>;
}

// ------------------------------------------------------------------------------------------------ aero
/** Run-time multipliers for DragItems that carry a `scale` (see aero/bodies.ts DragItem). Reused typed arrays. */
export interface DragScales {
  /** Gear extension per leg (nose, left, right), 0 up .. 1 down. */
  gear: ArrayLike<number>;
  /** Cowl flap opening per engine, 0 closed .. 1 open. */
  cowlFlaps: ArrayLike<number>;
}

export interface AeroInput {
  body: BodyState;
  atmosphere: AtmosphereSample;
  /** Air-mass velocity at the aircraft, NED m/s. */
  windNED: Vec3;
  /** Optional air-mass velocity (NED, m/s) sampled at a point given in body axes relative to the reference point. */
  windAt?: (pointBody: Vec3) => Vec3;
  surfaces: SurfaceState;
  /** Slipstream of propeller 0. Single-propeller callers set only this (unchanged). */
  slipstream: Slipstream | null;
  /**
   * Slipstream of every propeller, index = AircraftAeroDefinition.propellers index; null = no jet (stopped,
   * feathered). When present it is used and `slipstream` is ignored.
   */
  slipstreams?: readonly (Slipstream | null)[];
  /** Absent = every scaled drag item at full area (fixed gear, cowl flaps open). */
  dragScales?: DragScales;
  /** Height of the reference point above the ground, m (for ground effect). */
  heightAGL: number;
  dt: number;
}

export interface AeroOutput extends ForceMoment {
  /** Fuselage-reference angle of attack and sideslip, rad. */
  alpha: number;
  beta: number;
  /** 0..1 area fraction of the main wing beyond its stall angle. */
  stallFraction: number;
  /** True when the stall-warning vane would sound (about 5-10 kt above the stall). */
  stallWarning: boolean;
  /** Total lift and drag magnitudes in wind axes (diagnostics, N). */
  lift: number;
  drag: number;
  /**
   * Velocity the airframe induces at each propeller disc (wing upwash, body blockage), body axes, m/s; index as
   * `slipstreams`. Always set by AeroModel (optional only for hand-built outputs in tests). The object is owned
   * and overwritten by the model.
   */
  propellerInflows?: readonly Vec3[];
}

// ------------------------------------------------------------------------------------------------ propulsion
/** Moisture of the air, derived from WeatherSettings by SimEnvironment.moisture() (never from AtmosphereSample). */
export interface MoistureSample {
  /** Temperature minus dew point, K, >= 0. 0 = saturated. */
  dewPointSpread: number;
  /** Inside the cloud layer. */
  inCloud: boolean;
}

export interface PropulsionInput {
  body: BodyState;
  atmosphere: AtmosphereSample;
  /**
   * Velocity of the air relative to the aircraft at the propeller hub (hub 0), body axes, m/s (so the x
   * component is NEGATIVE in forward flight; axial inflow speed = -x). Includes the rotation term:
   * -(v_cg + omega x (hub - cgOffset)) + wind.
   */
  airVelocityBody: Vec3;
  /** Air velocity at every hub, index = engine. Required when the powerplant has more than one engine. */
  airVelocityAt?: readonly Vec3[];
  controls: ControlInputs;
  /** Absent = dry air (no carburettor icing). */
  moisture?: MoistureSample;
  dt: number;
}

/**
 * `moment` already contains the engine torque reaction on the airframe. The integrator adds only the
 * gyroscopic term -omega x angularMomentum and must not add the propeller torque again.
 */
export interface PropulsionOutput extends ForceMoment {
  /** Engine 0 / propeller 0 / slipstream 0 (unchanged). */
  engine: EngineState;
  propeller: PropellerState;
  slipstream: Slipstream;
  /** Every engine, left to right. engines[0] holds the same values as `engine`. Objects are owned and reused. */
  engines: EngineState[];
  propellers: PropellerState[];
  slipstreams: Slipstream[];
  /**
   * Angular momentum of the rotating engine/propeller assemblies, body axes, kg*m^2/s (for gyroscopic coupling):
   * the SIGNED vector sum over all rotors (a counter-rotating pair cancels).
   */
  angularMomentum: Vec3;
  /** Legacy two-tank view of the fuel burned this step, kg. */
  fuelUsed: { left: number; right: number };
  /** Usable fuel per tank after this step, kg, in PowerplantDef.fuel.tanks order. */
  tanks: number[];
  /** batteryAmps: + = charging (AircraftState convention). alternators: per alternator, A. */
  electrical: { busVoltage: number; batteryCharge: number; alternatorAmps: number; batteryAmps: number; alternators: number[] };
}

export interface PowerplantResetOptions {
  /** One flag for all engines, or one per engine. */
  running: boolean | readonly boolean[];
  /** Usable fuel per tank, kg, in definition order. */
  tanks: readonly number[];
  /**
   * Initial CRANK speed, rpm (all engines or per engine). Default: EngineDef.groundStartRpm when running (the
   * C172S facade keeps today's 1000), else 0. The flight model always passes it: airStartRpm for every engine
   * in the air that is not feathered, running or not.
   */
  rpm?: number | readonly number[];
  /** Per engine: start with the blades at the feather stop and the latch state that goes with it (constant-speed feathering propellers); such a unit starts at 0 rpm whatever `rpm` says. */
  feathered?: readonly boolean[];
  oat?: number;
  batteryCharge?: number;
  /** Start with engine temperatures at their warm values even if not running (an engine that just failed). */
  warm?: boolean;
}

/** Per-engine state the resume snapshot keeps. */
export interface EngineSnapshot {
  running: boolean; rpm: number; propRpm: number;
  bladePitch: number; featherLatched: boolean;
  egt: number; cht: number; oilTemp: number; oilPressure: number;
  coolantTemp?: number; gearboxTemp?: number;
  carbIce: number; cowlFlap: number;
  /** FADEC: seconds of ECU backup battery already used. Absent: 0. */
  ecuBackupUsed?: number;
  /** The unfeathering accumulator still holds its stroke. Absent: true. */
  accumulatorCharged?: boolean;
  /** Glow pre-heat seconds done. Absent: 0. */
  glowSeconds?: number;
}

/** The aircraft-level powerplant the assembly programs against: N engine units + ONE fuel network + ONE bus. */
export interface Powerplant {
  readonly engineCount: number;
  /** Hub positions, reference-point body axes. */
  readonly hubs: readonly Vec3[];
  /** Live usable fuel per tank, kg. */
  readonly tankQuantities: ArrayLike<number>;
  readonly tankCapacities: readonly number[];
  batteryCharge: number;
  reset(o: PowerplantResetOptions): void;
  /** Advance by input.dt. Called ONCE per physics sub-step, never inside an RK stage. Returns an owned, reused object. */
  step(input: PropulsionInput): PropulsionOutput;
  /**
   * Steady state for the given input. LEFT AT THE SOLUTION (the fast states; reset and trim rely on it, as on
   * the shaft speed today): shaft speed, blade angle, delivered (lagged) torque of every unit. RESTORED to
   * their values before the call (the consumables and slow states): tank contents, battery charge,
   * temperatures, carburettor ice, glow timer, unfeathering-accumulator charge, ECU backup timer. The feather
   * latch is re-derived from the converged rpm and blade angle. Deterministic: the result depends only on the
   * input and on the last primeForTrim().
   */
  settle(input: PropulsionInput, maxSeconds?: number): PropulsionOutput;
  /**
   * Starting point of settle(): every unit that is NOT feathered, running or not, is set to `crankRpm` and to
   * the blade angle settle() iterates from (a windmilling propeller has two steady states near its stopping
   * speed; today's unconditional priming is what picks "turning"); a feathered unit is set to 0 rpm at the
   * feather angle.
   */
  primeForTrim(crankRpm: number): void;
  /** Shaft power of engine i at its present state, W. */
  brakePower(i?: number): number;
  capture(): EngineSnapshot[];
  restore(engines: readonly EngineSnapshot[]): void;
}

// ------------------------------------------------------------------------------------------------ gear
export type CrashKind = 'structure' | 'gearCollapse' | 'propStrike' | 'impact' | 'ditching' | 'gearUp';

export interface GearInput {
  body: BodyState;
  controls: ControlInputs;
  env: Environment;
  dt: number;
  /** Per-leg extension (nose, left, right), 0 .. 1. Absent = all down and locked. Held constant over a sub-step. */
  extension?: ArrayLike<number>;
}

export interface GearOutput extends ForceMoment {
  wheels: [WheelState, WheelState, WheelState];
  onGround: boolean;
  /** Non-empty when a structural point (wingtip, prop, belly, tail) hit the ground or a gear leg was overloaded. */
  crash: string;
  /** Classification of `crash` (absent while crash is ''). 'gearUp': "Gear-up landing ..." (D7). */
  crashKind?: CrashKind;
  /** Touchdown events detected this step. */
  touchdowns: { wheel: WheelState['name']; sinkRate: number }[];
}

// ------------------------------------------------------------------------------------------------ flight model
export interface LoadingRequest { payload: number; payloadPosition: Vec3 }

export interface FlightModelOptions {
  /** Occupants and baggage, kg. Default: definition.mass.loadings.typical. */
  payload?: number;
  payloadPosition?: Vec3;
  /** Physics sub-step rate, Hz. Default 240. */
  physicsRate?: number;
  /** Destroy the aircraft beyond the ultimate load factor or the dive speed. Default true. */
  structuralFailure?: boolean;
}

/** Everything SimPhysics restores besides the rigid body and the controls. */
export interface SystemsSnapshot {
  engines: EngineSnapshot[];
  /** Usable fuel per tank, kg, definition order. */
  tanks: number[];
  batteryCharge: number;
  surfaces: SurfaceState;
  gear: { extension: [number, number, number]; emergency: boolean };
}

/** What the simulation shell, the test rigs and the tools use. The concrete class is BladeElementFlightModel (physics/flightModel.ts). */
export interface AircraftFlightModel extends FlightModel {
  readonly definition: AircraftDefinition;
  /** Controls matching the state the last reset() produced (see C172FlightModel today). Copy with copyControls. */
  readonly trimControls: ControlInputs;
  readonly touchdowns: readonly { wheel: WheelState['name']; sinkRate: number }[];
  readonly physicsRate: number;
  setPhysicsRate(hz: number): void;
  /** Feet off the pedals (replaces fm.controlSystem.rudderFree for the shell). */
  rudderFree: boolean;
  /** Payload for the NEXT reset() (replaces the private-field write in SimPhysics.applyLoading). */
  setLoading(l: LoadingRequest): void;
  /** Set the model clock (wind-field time) without changing anything else (replaces the private-field write in restore). */
  setClock(t: number): void;
  setKinematics(k: { position: Vec3; orientation: Quat; velocity: Vec3; angularVelocity: Vec3 }): void;
  captureSystems(): SystemsSnapshot;
  /** `dynamicPressure`: for setting the surfaces immediately, Pa (today: 0.5 rho |v|^2 of the saved velocity). */
  restoreSystems(s: SystemsSnapshot, controls: ControlInputs, dynamicPressure: number): void;
  solveTrim(spec: TrimSpec, env: Environment, fixed?: Readonly<ControlPatch>): TrimResult;
  pitchControlsAtTrim(t: TrimResult): { elevatorTrim: number; elevator: number };
  lastTrim: TrimResult | null;
  /** Calibrated airspeed, m/s. */
  readonly cas: number;
  readonly lastAero: AeroOutput | null;
  readonly massProperties: Readonly<MassProperties>;
  readonly powerplant: Powerplant;
}
