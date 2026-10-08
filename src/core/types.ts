// The simulation contract shared by every module. Physics produces AircraftState; rendering, instruments,
// audio and cameras consume it. All quantities are SI (m, s, kg, N, rad, K, Pa) unless a field says otherwise.
//
// FRAMES
//   World:  NED local tangent plane. x = North, y = East, z = Down. Origin at the airport reference point
//           at mean sea level, so altitude MSL = -position.z. Flat earth.
//   Body:   FRD. x = forward (out the nose), y = right wing, z = down. Origin at the centre of gravity.
//   Angles: roll/pitch/heading are aerospace 3-2-1 Euler angles; heading is true, 0 = north, clockwise positive.
//   Three.js rendering uses a fixed mapping from these frames; see frames.ts.

import type { Quat, Vec3 } from './math';

// ---------------------------------------------------------------------------------------------- identity
export type AircraftId = 'c172s' | 'c152' | 'pa38' | 'da20' | 'pa34' | 'da42' | 'r22';
export const AIRCRAFT_IDS: readonly AircraftId[] = ['c172s', 'c152', 'pa38', 'da20', 'pa34', 'da42', 'r22'];
export const DEFAULT_AIRCRAFT_ID: AircraftId = 'c172s';
export const isAircraftId = (v: unknown): v is AircraftId => AIRCRAFT_IDS.includes(v as AircraftId);

// ---------------------------------------------------------------------------------------------- controls
export type MagnetoPosition = 0 | 1 | 2 | 3; // OFF, R, L, BOTH
/**
 * Superset of every type's fuel selector positions. Which exist on a type, and what each draws from, is
 * PowerplantDef.fuel.feeds[i].positions; a position a type does not define shuts the feed.
 *   C172S  off | left | right | both        C152, DA20  off | on  ('both' is accepted as 'on')
 *   PA-38  off | left | right               PA-34, DA42 per engine: off | on | crossfeed
 */
export type FuelSelector = 'off' | 'left' | 'right' | 'both' | 'on' | 'crossfeed';
export type GearLever = 'up' | 'down';
/** Propeller lever below this value commands FEATHER; [PROP_FEATHER_GATE, 1] is the governing range (low..high rpm). */
export const PROP_FEATHER_GATE = 0.08;

/** The levers and switches that exist once per engine. */
export type EngineControlKey =
  | 'throttle' | 'propeller' | 'mixture' | 'magnetos' | 'starter' | 'fuelPump' | 'fuelSelector' | 'alternator'
  | 'carbHeat' | 'cowlFlaps' | 'alternateAir' | 'engineMaster';
/** Per-engine overrides: a field that is absent follows the scalar of the same name in ControlInputs. */
export type EngineControls = { [K in EngineControlKey]?: ControlInputs[K] };

/** Pilot inputs, written by the input module and read by the flight model. */
export interface ControlInputs {
  /** Helicopters: collective blade pitch [0,1], independent of engine throttle. */
  collective?: number;
  rotorGovernor?: boolean;
  rotorClutch?: boolean;
  /** [-1, 1]. + = yoke back = nose up. */
  elevator: number;
  /** [-1, 1]. + = yoke right = roll right. */
  aileron: number;
  /** [-1, 1]. + = right pedal = nose right. Also steers the nosewheel. */
  rudder: number;
  /**
   * Optional: the pilot's feet are off the pedals (no rudder axis, no rudder key held). The rudder then
   * floats with the fin's local flow and the nosewheel follows it through the steering bungee; `rudder` is
   * ignored. Set by the input module; the simulation shell forwards it to the flight model (never while the
   * autoflight flies). Absent = false.
   */
  feetOffRudder?: boolean;
  /** [0, 1]. ALL ENGINES. On a FADEC type this is the power lever (load demand). */
  throttle: number;
  /** [0, 1]. 1 = full rich, 0 = idle cut-off. ALL ENGINES. Ignored by FADEC types (kept at 1). */
  mixture: number;
  /** Flap lever [0, 1] = deflection / ControlSystemDef.flaps.maxDeflection (linear). Detents come from the definition. */
  flaps: number;
  /** [-1, 1]. + = nose-up trim. */
  elevatorTrim: number;
  /** [0, 1] toe brakes. */
  brakeLeft: number;
  brakeRight: number;
  parkingBrake: boolean;
  /** ALL ENGINES. Ignored by compression-ignition types (kept at 3). */
  magnetos: MagnetoPosition;
  /** Held while the starter is engaged. ALL ENGINES (the input system engages one at a time on twins). */
  starter: boolean;
  /** Electric auxiliary / boost pump. ALL ENGINES. Ignored where there is none (C152). */
  fuelPump: boolean;
  /** ALL ENGINES. Default per type from AircraftDefinition.controlDefaults. */
  fuelSelector: FuelSelector;
  masterBattery: boolean;
  /** ALL alternators. */
  alternator: boolean;
  avionics: boolean;
  pitotHeat: boolean;
  /** Exterior lights, panel flood (0..1) and the overhead cabin dome light (optional; absent = off). */
  lights: { nav: boolean; beacon: boolean; strobe: boolean; landing: boolean; taxi: boolean; panel: number; dome?: boolean };
  // --- Instrument knobs (read by the instrument panel; the flight model ignores them) ---
  /** Altimeter (Kollsman window) setting, hPa. Used when the panel is not slaved to the weather QNH. */
  kollsmanHpa: number;
  /** Heading-indicator bug, degrees [0, 360). */
  headingBugDeg: number;
  /** NAV1 OBS course, degrees [0, 360). */
  obsDeg: number;
  /** Momentary: while true the heading indicator card is aligned to the compass (true heading). */
  dgAlign: boolean;

  // --- Per-type levers and switches. All required; every ControlInputs object originates in defaultControls() ---
  /** Propeller lever [0, 1]; 1 = full fine / high rpm; < PROP_FEATHER_GATE = feather. Ignored by fixed-pitch and FADEC types. Default 1. */
  propeller: number;
  /** Carburettor heat [0, 1], 1 = full hot. Ignored without a carburettor. Default 0. */
  carbHeat: number;
  /** Cowl flaps [0, 1], 1 = open. Ignored without cowl flaps. Default 1. */
  cowlFlaps: number;
  /** Alternate induction air (unfiltered, warm). Ignored where there is none. Default false. */
  alternateAir: boolean;
  /** FADEC ENGINE MASTER. true = ECU and fuel on; false = fuel shut and propeller feathers. Ignored elsewhere. Default true. */
  engineMaster: boolean;
  /** Landing gear selector. Fixed-gear types ignore it. Default 'down'. */
  gearLever: GearLever;
  /** Emergency gear extension knob pulled (latching). Default false. */
  gearEmergency: boolean;
  /** Rudder trim [-1, 1], + = nose right. Ignored without cockpit rudder trim. Default 0. */
  rudderTrim: number;
  /**
   * One entry per engine (length = engine count, 1 on singles); each entry holds only the fields that differ
   * from the scalars. Read ONLY through engineControl(); write ONLY through setEngineControl() /
   * clearEngineControl(); copy ONLY through copyControls() / cloneControls() / applyControls().
   */
  engines: EngineControls[];
}

/** What defaultControls() needs from an aircraft definition (AircraftDefinition satisfies it structurally). */
export interface ControlDefaultsSource {
  engineCount: number;
  /** Overrides of the generic defaults for this type (fuelSelector, cowlFlaps, per-type switches). */
  controlDefaults: Readonly<ControlPatch>;
}

/** The one way to read a per-engine lever or switch: engine i's override if set, else the scalar. */
export function engineControl<K extends EngineControlKey>(c: Readonly<ControlInputs>, i: number, k: K): ControlInputs[K] {
  const o = c.engines[i];
  if (o !== undefined) {
    const v = o[k];
    if (v !== undefined) return v as ControlInputs[K];
  }
  return c[k];
}

/** The one way to give engine i its own lever or switch position (the scalar no longer moves it). */
export function setEngineControl<K extends EngineControlKey>(c: ControlInputs, i: number, k: K, v: ControlInputs[K]): void {
  const o = c.engines[i];
  if (o !== undefined) (o as Record<string, unknown>)[k] = v;
}
/** Remove the override of `k` from engine i (or from every engine): the lever follows the scalar again. */
export function clearEngineControl(c: ControlInputs, k: EngineControlKey, i?: number): void {
  if (i === undefined) for (const o of c.engines) delete o[k];
  else if (c.engines[i] !== undefined) delete c.engines[i][k];
}

/** Copy every control from src into dst; `lights` and `engines` are deep-copied (never shared). Returns dst. */
export function copyControls(dst: ControlInputs, src: Readonly<ControlInputs>): ControlInputs {
  Object.assign(dst, src);
  dst.lights = { ...src.lights };
  dst.engines = src.engines.map((e) => ({ ...e }));
  return dst;
}
export const cloneControls = (src: Readonly<ControlInputs>): ControlInputs => copyControls({} as ControlInputs, src);

/** A partial set of controls; `lights` may itself be partial (the Flight School sends single lamps). */
export type ControlPatch = Partial<Omit<ControlInputs, 'lights'>> & { lights?: Partial<ControlInputs['lights']> };

/**
 * Apply a partial set of controls (scenario presets, trim `fixed` controls, snapshots, lesson actions). Scalars
 * are assigned; `lights`, when present, is MERGED into a fresh lights object (a partial `lights` keeps the other
 * lamps and `panel`: replacing it would put `undefined` loads on the bus); `engines`, when present, REPLACES
 * the array with a deep copy padded / truncated to dst's engine count.
 */
export function applyControls(dst: ControlInputs, p: Readonly<ControlPatch>): ControlInputs {
  const n = dst.engines.length;
  const lights = p.lights ? { ...dst.lights, ...p.lights } : dst.lights;
  Object.assign(dst, p);
  dst.lights = lights;
  if (p.engines) dst.engines = Array.from({ length: n }, (_, i) => ({ ...(p.engines![i] ?? {}) }));
  return dst;
}

/** Compose two patches without a destination (sim/starts.ts layers a lesson's controls on a preset): b wins; `lights` merge; `engines` of b replace a's. */
export function mergeControlPatches(a: Readonly<ControlPatch> | undefined, b: Readonly<ControlPatch> | undefined): ControlPatch {
  const out: ControlPatch = { ...a, ...b };
  if (a?.lights || b?.lights) out.lights = { ...a?.lights, ...b?.lights };
  if (out.engines) out.engines = out.engines.map((e) => ({ ...e }));
  return out;
}

export interface WheelState {
  name: 'nose' | 'left' | 'right';
  /** Strut compression, m (0 = fully extended). */
  compression: number;
  onGround: boolean;
  /** Normal load on the tyre, N. */
  load: number;
  /** Wheel spin rate, rad/s (+ = rolling forward). */
  spinRate: number;
  /** Accumulated wheel rotation for animation, rad. */
  rotation: number;
  /** Steering angle, rad (+ = turning right). Nonzero only for the nosewheel. */
  steerAngle: number;
  /** 0..1 how hard the tyre is sliding (drives tyre squeal / smoke). */
  skid: number;
}

// ---------------------------------------------------------------------------------------------- state
export interface EngineState {
  running: boolean;
  /** CRANKSHAFT speed, rev/min. Equals propRpm on a direct-drive engine. */
  rpm: number;
  /** Manifold absolute pressure, inHg. */
  manifoldPressure: number;
  /** Shaft power delivered to the propeller, W. */
  power: number;
  /** Shaft torque, N*m. */
  torque: number;
  /** Fuel flow, kg/s. */
  fuelFlow: number;
  /** Exhaust gas temperature, degrees C. */
  egt: number;
  /** Cylinder head temperature, degrees C. */
  cht: number;
  /** Oil temperature, degrees C. */
  oilTemp: number;
  /** Oil pressure, psi. */
  oilPressure: number;
  /** Fuel pressure, psi. */
  fuelPressure: number;
  /** Propeller shaft speed, rev/min (rpm / gear ratio). */
  propRpm: number;
  /** Shaft power as a percentage of rated power (the FADEC LOAD figure; computed for every engine). */
  loadPercent: number;
  /** Carburettor ice, 0 (none) .. 1 (venturi choked). 0 on engines without a carburettor or with icing off. */
  carbIce: number;
  /** Cowl flap position reached, 0 closed .. 1 open (1 on types without cowl flaps). */
  cowlFlap: number;
  /** Liquid-cooled engines only, degrees C. */
  coolantTemp?: number;
  gearboxTemp?: number;
  /** FADEC engines only. */
  ecuPowered?: boolean;
  glow?: boolean;
  /** Rough running beyond what the mixture and magnetos give (melt water from carburettor ice), 0 .. 1. Absent: 0. */
  roughness?: number;
}
export function emptyEngineState(): EngineState {
  return { running: false, rpm: 0, manifoldPressure: 29.92, power: 0, torque: 0, fuelFlow: 0, egt: 15, cht: 15,
    oilTemp: 15, oilPressure: 0, fuelPressure: 0, propRpm: 0, loadPercent: 0, carbIce: 0, cowlFlap: 1 };
}

export interface PropellerState {
  /** PROPELLER shaft speed, rev/min, >= 0. */
  rpm: number;
  /** Thrust along body +x, N. */
  thrust: number;
  /** Advance ratio J = V / (n D). */
  advanceRatio: number;
  /** Accumulated blade rotation for animation, rad, SIGNED clockwise-from-cockpit (decreases on a -1 propeller). */
  rotation: number;
  /** Blade angle at the propeller's reference station (PropellerDef.referenceStation, default 0.75 R), rad (the fixed geometric angle on a fixed-pitch propeller). */
  bladePitch: number;
  /** Blades at (within 2 degrees of) the feather stop. */
  feathered: boolean;
  /** +1 clockwise seen from the cockpit, -1 counter-clockwise. */
  direction: 1 | -1;
}
export function emptyPropellerState(direction: 1 | -1 = 1): PropellerState {
  return { rpm: 0, thrust: 0, advanceRatio: 0, rotation: 0, bladePitch: 0, feathered: false, direction };
}

/** Actual deflections of the control surfaces (after linkage/rate limits), rad. */
export interface SurfaceState {
  /** + = trailing edge down (nose-down moment). Yoke back gives a negative value. */
  elevator: number;
  /** + = trailing edge down on that side. Roll-right input gives left + / right -. */
  aileronLeft: number;
  aileronRight: number;
  /** + = trailing edge left (nose left). Right pedal gives a negative value. */
  rudder: number;
  /** Actual flap deflection, rad, 0 .. the type's maximum. Flaps travel at a finite rate. */
  flaps: number;
  /**
   * Pitch trim tab, rad, + = tab TE down = nose-up trim. Tab-trimmed elevator: the tab angle. Stabilator with
   * anti-servo tab: the TRIM OFFSET of the tab (the tab's total angle is gearing x elevator + elevatorTrim).
   * Spring-trimmed types: always 0 (no tab).
   */
  elevatorTrim: number;
  /** Rudder trim tab, rad, + = tab TE left (which floats the rudder TE right = nose right). 0 without cockpit rudder trim. */
  rudderTrim: number;
}
export function emptySurfaceState(): SurfaceState {
  return { elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0, flaps: 0, elevatorTrim: 0, rudderTrim: 0 };
}

export interface TankState { id: string; /** usable fuel, kg */ quantity: number; /** usable capacity, kg */ capacity: number }

export interface GearState {
  retractable: boolean;
  lever: GearLever;
  /** Per leg (nose, left, right): 0 = up, 1 = down and locked. Always [1, 1, 1] on fixed gear. */
  extension: [number, number, number];
  /** The three green lights. */
  locked: [boolean, boolean, boolean];
  /** Red / "unsafe": any leg neither up nor down-and-locked. */
  inTransit: boolean;
  /** Gear warning horn sounding. */
  warning: boolean;
}
export function fixedGearState(): GearState {
  return { retractable: false, lever: 'down', extension: [1, 1, 1], locked: [true, true, true], inTransit: false, warning: false };
}

/** Complete observable state of the aircraft. Produced by FlightModel; treat as read-only elsewhere. */
export interface AircraftState {
  /** Present only on a rotorcraft. Persistent dynamic inflow, flapping and drivetrain state. */
  rotorcraft?: import('../physics/rotorcraft/definition').RotorcraftState;
  /** The type this state belongs to. */
  aircraft: AircraftId;
  /** Simulation time, s. */
  time: number;

  // --- Rigid-body state ---
  /** Position of the aircraft reference point (core/c172.ts; the 3D model origin, within a few cm of the CG) in NED, m. */
  position: Vec3;
  /** CG velocity relative to the ground in NED, m/s. */
  velocity: Vec3;
  /** Body -> NED rotation. */
  orientation: Quat;
  /** Body angular velocity (p, q, r), rad/s. */
  angularVelocity: Vec3;

  // --- Derived kinematics ---
  roll: number;
  pitch: number;
  /** True heading, [0, 2PI). */
  heading: number;
  /** Ground track, [0, 2PI). */
  track: number;
  altitudeMSL: number;
  /** Height of the CG above the terrain directly below, m. */
  altitudeAGL: number;
  /** + = climbing, m/s. */
  verticalSpeed: number;
  groundSpeed: number;
  /** True airspeed, m/s. */
  tas: number;
  /** Indicated (calibrated) airspeed, m/s. */
  ias: number;
  mach: number;
  /** Angle of attack of the fuselage reference line, rad. */
  alpha: number;
  /** Sideslip, rad. + = wind from the right (nose left of the relative wind). */
  beta: number;
  /** Velocity of the aircraft relative to the air mass, body axes, m/s (+x in forward flight; includes wind). */
  airVelocityBody: Vec3;
  /** Specific force in body axes in g (what an accelerometer reads / G0). Level unaccelerated flight = (0, 0, -1). */
  specificForce: Vec3;
  /** Normal load factor felt by the pilot: 1 in level flight, >1 pulling up. */
  gLoad: number;
  /** Slip/skid ball deflection, -1..1 (+ = ball right). */
  slipBall: number;

  // --- Air data ---
  /** Ambient static pressure, Pa. */
  staticPressure: number;
  /** Outside air temperature, K. */
  oat: number;
  airDensity: number;

  // --- Status ---
  onGround: boolean;
  stallWarning: boolean;
  /** 0..1 fraction of the wing that is stalled (buffet intensity). */
  stallFraction: number;
  crashed: boolean;
  crashReason: string;

  // --- Subsystems ---
  surfaces: SurfaceState;
  /**
   * Engine 0 (the left engine on a twin). Same VALUES as engines[0]. Every state FACTORY (`makeState`,
   * `makeMockState`) returns `engines[0] === engine` and `propellers[0] === propeller` (tests and dev pages
   * mutate mocks through the legacy fields); only COPIES (`renderState`, restored snapshots) are equal by value.
   */
  engine: EngineState;
  /** Propeller 0. Same values as propellers[0] (same identity rule). */
  propeller: PropellerState;
  /** All engines, left to right. Length = engine count. */
  engines: EngineState[];
  propellers: PropellerState[];
  /** Always three entries (nose, left, right). A retracted or in-transit leg reports onGround false, load 0. */
  wheels: [WheelState, WheelState, WheelState];
  fuel: {
    /** Legacy two-tank view, kg: left = left-side tanks + half of centre tanks; right likewise. */
    left: number; right: number;
    /** Total usable capacity / 2, so (left + right) / (2 capacityEach) is the fuel fraction on every type. */
    capacityEach: number;
    /**
     * Authoritative, in PowerplantDef.fuel.tanks order. The flight model keeps it and the legacy pair in step in
     * publish(). `makeMockState` defines `tanks[i].quantity` (and `electrical.alternators[0]`) as accessor
     * properties over `left` / `right` (and `alternatorAmps`), so a mock mutated through the legacy fields is
     * consistent; the C172S instrument bindings read the legacy fields.
     */
    tanks: TankState[];
  };
  gear: GearState;
  mass: number;
  /** batteryAmps: battery current, A, + = charging (what the C172 ammeter shows). */
  electrical: {
    busVoltage: number; batteryCharge: number;
    /** Sum over alternators, A. */
    alternatorAmps: number;
    batteryAmps: number;
    /** Per alternator, A (length = number of alternators). */
    alternators: number[];
  };
}

export type SurfaceType = 'runway' | 'taxiway' | 'grass' | 'dirt' | 'rock' | 'snow' | 'water';

export interface AtmosphereSample {
  temperature: number; // K
  pressure: number; // Pa
  density: number; // kg/m^3
  speedOfSound: number; // m/s
  /** Dynamic viscosity, Pa*s. */
  viscosity: number;
}

/** Everything the flight model needs to know about the outside world. */
export interface Environment {
  atmosphere(altitudeMSL: number): AtmosphereSample;
  /** Velocity of the air mass (steady wind + gusts + turbulence) at a point, NED m/s. */
  wind(positionNED: Vec3, time: number): Vec3;
  /** Terrain (or runway) elevation MSL at a horizontal position, m. */
  groundElevation(north: number, east: number): number;
  /** Unit terrain normal in NED (points up, so z < 0). */
  groundNormal(north: number, east: number): Vec3;
  surface(north: number, east: number): SurfaceType;
}

/** User-adjustable weather and time. Shared by physics (wind, density) and rendering (sky, clouds, haze). */
export interface WeatherSettings {
  /** Direction the wind blows FROM, degrees true. */
  windDirectionDeg: number;
  windSpeedKt: number;
  gustKt: number;
  /** 0 = smooth, 1 = severe. */
  turbulence: number;
  /** Deviation from ISA temperature, K. */
  isaDeviation: number;
  /** Sea-level pressure, hPa. */
  qnhHpa: number;
  /** 0 = clear, 1 = overcast. */
  cloudCover: number;
  /** Cloud layer base and top, m MSL. */
  cloudBaseM: number;
  cloudTopM: number;
  visibilityM: number;
  /** Local solar time, hours [0, 24). */
  timeOfDay: number;
  dayOfYear: number;
  /**
   * Cirrus deck cover 0..1, independent of the cumulus layer (optional; the clouds module uses its default,
   * 0.1, when absent).
   */
  cirrusCover?: number;
}

// ---------------------------------------------------------------------------------------------- initial conditions
export interface InitialConditions {
  /** NED position. If onGround is true, z is ignored and the aircraft is placed on its wheels. */
  position: Vec3;
  heading: number;
  /** True airspeed, m/s (ignored on ground). */
  airspeed: number;
  onGround: boolean;
  /** Applies to every engine. */
  engineRunning: boolean;
  /** Fraction of full fuel, 0..1. */
  fuelFraction?: number;
  /** Flap lever position 0..1, as ControlInputs.flaps. */
  flaps?: number;
  /** Flight path angle, rad (+ = climbing). */
  flightPathAngle?: number;
  /**
   * Per-engine override of engineRunning (index = engine). An engine not running IN THE AIR has just failed:
   * fuel cut, propeller WINDMILLING at the air-start rpm with its lever forward (FADEC: ENGINE MASTER still on),
   * temperatures warm. See 3.4 "Failed engine" for the exact controls.
   */
  enginesRunning?: boolean[];
  /** In-air starts: a non-running engine i with feathered[i] starts secured: 0 rpm, blades at the feather stop (default false = windmilling). */
  feathered?: boolean[];
  /** Default: true on the ground, on fixed gear, or when `flaps` > 0; else false (gear up). */
  gearDown?: boolean;
}

export interface FlightModel {
  readonly state: AircraftState;
  reset(ic: InitialConditions, env: Environment): void;
  /** Advance by dt seconds of simulated time, sub-stepping internally at a fixed rate. */
  step(dt: number, controls: ControlInputs, env: Environment): void;
}

export function defaultControls(def?: ControlDefaultsSource): ControlInputs {
  const c: ControlInputs = {
    elevator: 0,
    aileron: 0,
    rudder: 0,
    throttle: 0,
    mixture: 1,
    flaps: 0,
    elevatorTrim: 0,
    brakeLeft: 0,
    brakeRight: 0,
    parkingBrake: false,
    magnetos: 3,
    starter: false,
    fuelPump: false,
    fuelSelector: 'both',
    masterBattery: true,
    alternator: true,
    avionics: true,
    pitotHeat: false,
    lights: { nav: true, beacon: true, strobe: true, landing: false, taxi: false, panel: 0.6, dome: false },
    kollsmanHpa: 1013.25,
    headingBugDeg: 70,
    obsDeg: 70,
    dgAlign: false,
    propeller: 1,
    carbHeat: 0,
    cowlFlaps: 1,
    alternateAir: false,
    engineMaster: true,
    gearLever: 'down',
    gearEmergency: false,
    rudderTrim: 0,
    engines: [],
  };
  const n = def ? def.engineCount : 1;
  for (let i = 0; i < n; i++) c.engines.push({});
  return def ? applyControls(c, def.controlDefaults) : c;
}

export function defaultWeather(): WeatherSettings {
  return {
    windDirectionDeg: 100,
    windSpeedKt: 6,
    gustKt: 0,
    turbulence: 0.1,
    isaDeviation: 0,
    qnhHpa: 1013.25,
    cloudCover: 0.35,
    cloudBaseM: 1500,
    cloudTopM: 2600,
    visibilityM: 60000,
    timeOfDay: 9.5,
    dayOfYear: 172,
    cirrusCover: 0.1,
  };
}
