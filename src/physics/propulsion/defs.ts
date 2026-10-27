// The powerplant description of one aircraft type: engine installations (engine + propeller + hub), ONE fuel
// network and ONE electrical bus. Plain data. The Cessna 172S binding is C172_POWERPLANT (c172Powerplant.ts).
//
// Three numeric rules that keep the C172S arithmetic where it is:
//  - Shaft inertia is split as propeller.inertia + gearRatio^2 * engine.rotatingInertia; a unit computes that
//    sum ONCE at construction and uses the one result in the shaft equation, the torque reaction and the
//    angular momentum.
//  - Electrical loads are looked up by name and summed in a fixed order in code; `loads` is never iterated.
//  - Voltage thresholds are stored in volts, not as fractions of the nominal voltage.

import type { Vec3 } from '../../core/math';
import type { FuelSelector } from '../../core/types';

export interface FuelProperties { name: 'avgas' | 'jetA1'; stoichFar: number; /** J/kg */ lhv: number; /** kg/m^3 */ density: number }
/** 100LL: air/fuel 14.8 at stoichiometric, lower heating value, 6.0 lb/US gal. */
export const AVGAS_100LL: FuelProperties = { name: 'avgas', stoichFar: 1 / 14.8, lhv: 43.5e6, density: 719 };
export const JET_A1: FuelProperties = { name: 'jetA1', stoichFar: 0.0686, lhv: 43.1e6, density: 800 };

/** Blade section family (defaults = today's propulsion/airfoil.ts constants). */
export interface BladeSectionDef {
  alpha0: number; liftSlope: number; clMaxLowSpeed: number; clMaxMachLoss: number; clMin: number;
  cdMax: number; clMinDrag: number; dragDueToLift: number; clIdeal: number;
}

export interface GovernorDef {
  /** Governed PROPELLER rpm at lever = PROP_FEATHER_GATE and at lever = 1. With `EngineDef.fadec` they are not read (the set-point is fadec.propRpmVsLever): write the ends of that schedule. */
  minRpm: number; maxRpm: number;
  /** Blade-angle rate per unit speed error, (rad/s) per (rad/s). */
  gain: number;
  /**
   * Rate (acceleration) sensing of the flyweights and pilot valve, s: the speed error the governor acts on is
   * the error plus this time the shaft's angular acceleration, which damps the loop. Absent: 0 (a pure
   * integrator of the speed error, which rings at any gain fast enough to follow a power change).
   */
  dampingTime?: number;
  /**
   * Propeller overspeed governor (PC-12: 1802 rpm, TCDS): above this PROPELLER rpm it dumps governor oil and the
   * blades go coarse regardless of the primary governor. Absent: none (the fuel topping governor is the only
   * backstop). Declared at the scaffold; the turbine-core package implements it.
   */
  overspeedRpm?: number;
}

export interface FeatherDef {
  /** Blade angle at the feather stop, rad (at the propeller's reference station). */
  angle: number;
  /** Centrifugal latches engage below this PROPELLER rpm when the blades are finer than latchAngle (no feathering on shutdown). */
  latchRpm: number; latchAngle: number;
  /** 'starter': oil pressure from cranking drives the blades fine. 'accumulator': stored pressure does, once, when feather is deselected. */
  unfeather: 'starter' | 'accumulator';
}

/**
 * Beta and reverse (PT6 installations: the C208 and the PC-12). Declared at the scaffold; the turbine-core package
 * implements it in governor.ts / engineUnit.ts / turbineEngine.ts. Lever positions are ControlInputs.reverse:
 *   0                     on the gate: blades on the flight low-pitch stop (fineStop, or lowPitchSchedule at lever 0);
 *   0 .. pitchOnlyTravel  the blades move fineStop -> groundFine with Ng at idle (ground fine at pitchOnlyTravel);
 *   pitchOnlyTravel .. 1  groundFine -> reverse, and TurbineDef.reversingCam raises Ng.
 * In beta the flyweight governor is in underspeed and the beta valve sets the blade angle; Np is then held by
 * the fuel topping governor's reset set point (reversingCam.reverseNp). In `steady` (settle) evaluation the
 * blades sit at the commanded beta angle directly (the valve's steady state).
 */
export interface BetaDef {
  /** Blade angle at the end of the pitch-only aft travel (ground fine: about zero static thrust), rad at referenceStation. */
  groundFine: number;
  /** Blade angle at full reverse, rad (< groundFine, negative). */
  reverse: number;
  /** Part of the aft travel (ControlInputs.reverse) that moves the blades only, Ng at idle: fineStop -> groundFine. */
  pitchOnlyTravel: number;
  /** Beta-valve slew, rad/s (oil-driven; scaled by oil authority as rateToFine is). */
  rate: number;
  /**
   * The beta cam over the pitch-only travel: how far the blades have gone from the low-pitch stop toward groundFine
   * (`fraction`, 0 at the stop .. 1 at groundFine, ascending) against the lever as a part of pitchOnlyTravel (`lever`,
   * 0 .. 1, ascending). Absent: linear (the blade angle proportional to the lever).
   */
  pitchOnlySchedule?: { lever: readonly number[]; fraction: readonly number[] };
  /**
   * Flight low-pitch stop scheduled against the power lever FORWARD of the gate (throttle 0..1), rad (PC-12 POH:
   * the stop rises with the PCL). Absent: fineStop throughout. Below the stop in flight a type may show PROP LOW P.
   */
  lowPitchSchedule?: { lever: readonly number[]; angle: readonly number[] };
}

export type PitchControlDef =
  | { kind: 'fixed' }
  | {
      kind: 'constantSpeed';
      /** Blade-angle stops at the reference station, rad. With `feather`: coarseStop is the feather angle (a full-feathering hub has no stop short of it). */
      fineStop: number; coarseStop: number;
      feather?: FeatherDef;
      /** Blade-angle rates, rad/s: toward fine (governor oil; scaled by oil pressure) and toward coarse / feather (counterweights, spring, air charge). */
      rateToFine: number; rateToCoarse: number;
      governor: GovernorDef;
      /** With no oil pressure the blades go to: */
      failsTo: 'fine' | 'feather';
      /**
       * Blade angles at which map slices are tabulated, rad, ascending from beta.reverse (types with beta) or
       * fineStop, to the feather (or coarse) stop. At most PROP_MAX_SLICES (propellerMap.ts).
       */
      pitchNodes: readonly number[];
      /** Beta and reverse range aft of the gate. Absent: the power lever stops at flight idle (every type before the scaffold). */
      beta?: BetaDef;
      /**
       * Which cockpit control selects governing and feather. 'propellerLever' (default): ControlInputs.propeller.
       * 'conditionLever': there is no propeller lever; the governor holds governor.maxRpm (minRpm must equal
       * maxRpm) and the blades feather when the condition lever (ControlInputs.mixture) is at CUT-OFF/FEATHER
       * (PC-12). Declared at the scaffold; the turbine-core package implements it.
       */
      selectedBy?: 'propellerLever' | 'conditionLever';
    };

export interface PropellerDef {
  name: string;
  diameter: number; blades: number;
  /** m, absolute (C172: 0.14). */
  hubRadius: number;
  /** Planform: chord / R and thickness / chord against r / R. */
  stationX: readonly number[]; chordOverR: readonly number[];
  thicknessX: readonly number[]; thickness: readonly number[];
  /**
   * 'helix': constant geometric pitch (m) measured to the flat face (fixed-pitch designations).
   * 'table': blade angle relative to the reference station, rad, against r / R (variable pitch).
   */
  twist: { kind: 'helix'; pitch: number } | { kind: 'table'; x: readonly number[]; angle: readonly number[] };
  /**
   * r / R at which fineStop, coarseStop, feather.angle, pitchNodes and PropellerState.bladePitch are measured.
   * Default 0.75. Hartzell quotes angles at the 30 in station (PA-34: 0.79 R), MT at 0.75 R.
   */
  referenceStation?: number;
  section?: BladeSectionDef;
  /** Polar inertia of propeller and spinner, kg m^2. */
  inertia: number;
  pitchControl: PitchControlDef;
}

export interface CarburettorDef {
  /**
   * Inlet air temperature rise at full carburettor heat, K, and the fraction of inlet total pressure lost in the
   * hot-air duct AT THE RATED AIR FLOW (a duct loss: it falls with the square of the flow; unfiltered, no ram).
   */
  heatRise: number; heatPressureLoss: number;
  /** Temperature drop in the venturi at closed / full throttle, K. */
  venturiDropIdle: number; venturiDropFull: number;
  /** Ice build-up per minute at the worst condition; melt per minute at full heat; flow area lost at ice = 1 (fraction). */
  iceRatePerMin: number; meltRatePerMin: number; iceBlockage: number;
}

/** kind 'dieselFadec': only ramRecovery and alternateAir are read; write the rest as for a spark engine or 0. */
export interface InductionDef {
  throttleBoreArea: number; throttleCd: number; closedAngle: number;
  /** Idle bypass area, m^2. Absent: solved at construction so the unit idles at EngineDef.idleRpm with its propeller. */
  idleArea?: number;
  inletArea: number; exhaustCoeff: number; inductionHeating: number; ramRecovery: number;
  veReferenceT: number; veRpm: readonly number[]; ve: readonly number[];
  carburettor?: CarburettorDef;
  /** Alternate air door: temperature rise, K, and pressure loss fraction when selected (spark engines: at the rated air flow, as heatPressureLoss). */
  alternateAir?: { heatRise: number; pressureLoss: number };
}

// fullRichPhi absent => solved at construction from takeoffFuelFlow (kg/s at rated power, sea level).
// primeFlow (injection): fuel the servo passes at full rich with the engine at rest and fuel pressure on it (the
// electric pump: priming), kg/s; it fades out as the shaft turns, where the air-flow metering takes over. Absent:
// none (no fuel flows without air flow).
export type FuelMeteringDef =
  /** RSA servo injection (C172S, PA-34): fuel ~ air / sqrt(ambient density). */
  | { kind: 'rsaInjection'; fullRichPhi?: number; takeoffFuelFlow?: number; leanestFraction: number; primeFlow?: number }
  /** Continental continuous-flow injection (DA20): same law in this round. */
  | { kind: 'continuousInjection'; fullRichPhi?: number; takeoffFuelFlow?: number; leanestFraction: number; primeFlow?: number }
  /** Float carburettor (C152, PA-38): the same law on CARBURETTOR-INLET density, so heat enriches. */
  | { kind: 'floatCarburettor'; fullRichPhi?: number; takeoffFuelFlow?: number; leanestFraction: number }
  /** FADEC diesel: fuel commanded by the ECU; no mixture. */
  | { kind: 'fadecDiesel' }
  /** Gas turbine: fuel metered by the fuel control unit (TurbineDef.gasGenerator.fcu); the mixture lever is the condition lever. */
  | { kind: 'turbineFcu' };

export type IgnitionDef =
  | { kind: 'magnetos'; minFiringRpm: number; singleLoss: number; singleDilutionLoss: number; dilutionSensitivity: number }
  | { kind: 'compression'; minFiringRpm: number; glow: { preheatSeconds: number; amps: number; neededBelowC: number } }
  /** Gas turbine: the igniters spark while the starter is engaged (TurbineDef.gasGenerator.lightOffNg says when fuel lights). */
  | { kind: 'igniters' };

export interface ThermalDef {
  cooling: 'air' | 'liquid';
  /** Lumped capacities (J/K), conductances (W/K) and heat split; defaults = today's engineThermal.ts constants. */
  headCapacity: number; headConductance: number; headHeatFraction: number; referenceMassFlux: number;
  oilCapacity: number; oilCoolerConductance: number; crankcaseConductance: number;
  oilPsiPerRpm: number; oilReliefPsi: number;
  /** How far cold, thick oil overdrives the relief valve at 0 C and below, psi (fading out by 60 C). Absent: 25. */
  oilColdOverdrivePsi?: number;
  /**
   * The gauge's capillary line: time constant of the oil-pressure reading behind the engine's pressure with hot
   * (85 C) oil and at 0 C, s (geometric between, held beyond). Absent: the gauge reads the engine's pressure.
   */
  oilGauge?: { time: number; coldTime: number };
  /** Cooling conductance multiplier with the cowl flap closed (1 = no cowl flaps). */
  cowlFlapClosedFactor: number;
  /** Liquid cooling: thermostat opening temperature, radiator conductance, coolant capacity; gearbox capacity and conductance. */
  liquid?: { thermostatC: number; radiatorConductance: number; coolantCapacity: number; gearboxCapacity: number; gearboxConductance: number };
  /** Values reset(warm = true) starts from, degrees C / psi. */
  warm: { egt: number; cht: number; oilTemp: number; oilPressure: number; coolantTemp?: number; gearboxTemp?: number };
}

/** FADEC schedules. Tables are [x, y] pairs, linear between. LOAD is a fraction of rated POWER, never of torque. */
export interface FadecDef {
  /** Power lever (0..1) -> demanded shaft POWER as a fraction of EngineDef.ratedPower (0..1). DA42: the identity. */
  loadVsLever: readonly (readonly [number, number])[];
  /** Power lever (0..1) -> governed PROPELLER rpm (not monotonic on the DA42: 2150 at idle, 1800 at 20 %, 2100 at 92 %, 2300 at 100 %). */
  propRpmVsLever: readonly (readonly [number, number])[];
  /**
   * Largest CRANK torque the engine can deliver against CRANK rpm, ABSOLUTE N m, at or below the critical
   * altitude. It may exceed ratedPower / ratedOmega below rated rpm, and must where the schedule asks for
   * high load at reduced rpm (AE300: 92 % = 113.6 kW at 3550 crank rpm needs 306 N m against 304 N m at the
   * rated point).
   */
  fullLoadTorque: readonly (readonly [number, number])[];
  /** Density altitude up to which the full-load torque is held, m; above it the torque limit falls with the density ratio. */
  criticalAltitude: number;
  /** Brake specific fuel consumption against DELIVERED load (delivered power / rated power), kg/J. */
  bsfcVsLoad: readonly (readonly [number, number])[];
  /** First-order lag of delivered torque behind demand (turbocharger), s. */
  torqueLag: number;
  /** Crank idle rpm the ECU holds. Absent: EngineDef.idleRpm. */
  idleRpm?: number;
  /** The ECU needs this bus voltage, or its backup battery, which lasts this long, s. */
  minBusVolts: number; backupSeconds: number;
  /**
   * The ECU is also fed by this engine's own alternator: the backup timer runs only while the bus is below
   * minBusVolts AND that alternator is below its cut-in speed (DA42). Absent: false.
   */
  alternatorFed?: boolean;
}

/**
 * Gas generator of a gas turbine (turbineEngine.ts, gasGenerator.ts): one spool, compressor and the turbine that
 * drives it. Speeds are fractions of referenceRpm (Ng 1 = 100 %). The map is the engine's steady running line at
 * sea-level ISA, written CORRECTED (speed / sqrt(theta), flow / (delta sqrt(theta)), power / (delta sqrt(theta)),
 * absolute temperature / theta, with delta and theta the inlet total pressure and temperature over sea-level
 * ISA), so the same table gives the engine on a hot day and at altitude.
 */
export interface GasGeneratorDef {
  /** Gas-generator speed at Ng = 1, rpm. */
  referenceRpm: number;
  /** Polar inertia of the gas-generator rotor (compressor, its turbine, the accessory drive reflected to it), kg m^2. */
  inertia: number;
  /** Power the compressor absorbs at Ng = 1, sea-level ISA, W (it scales as the cube of the corrected speed). */
  compressorPower: number;
  /**
   * Steady running line, sea-level ISA, corrected: Ng (ascending; the first entry is the lowest steady speed, at
   * or below low idle), fuel flow, kg/s, inter-turbine temperature, C, and the gas power the output stage makes
   * of it at its design speed, W.
   */
  map: { ng: readonly number[]; fuelFlow: readonly number[]; itt: readonly number[]; power: readonly number[] };
  /** The igniters light the fuel from this Ng. */
  lightOffNg: number;
  /** Above this Ng the engine accelerates on its acceleration schedule without the starter (solved into the start region). */
  selfSustainingNg: number;
  /** Below this Ng the fuel control meters nothing (no fuel pressure from the engine-driven pump). */
  minFuelNg: number;
  fcu: {
    /** Ng the fuel control governs to with the power lever at idle: condition lever at LOW IDLE and at HIGH IDLE; and with the power lever at its maximum. */
    lowIdleNg: number; highIdleNg: number; maxNg: number;
    /** Acceleration schedule, sea-level ISA, corrected: the most fuel the FCU meters at each Ng, kg/s (the start schedule below the map). */
    accelFuel: { ng: readonly number[]; fuelFlow: readonly number[] };
    /** The least fuel it meters when decelerating, as a fraction of the steady flow at that Ng (minimum-flow stop). */
    decelFraction: number;
    /** Governor gain: fuel per unit Ng error, as a fraction of the steady flow at Ng = 1 per unit Ng. */
    gain: number;
  };
  /** The flame goes out below this fraction of the steady fuel flow at the speed (lean blow-out). */
  leanBlowout: number;
  /** Time constant of the ITT thermocouples, s. */
  ittLag: number;
  /** ITT the engine reset() warm reads before its first step, C. */
  warmItt: number;
}

/**
 * A gas turbine (EngineDef.kind 'freeTurbine'). Its EngineDef "crank" is the POWER TURBINE: ratedRpm is the
 * power turbine's design speed, gearRatio is power-turbine rpm / propeller rpm, rotatingInertia is the power
 * turbine and gear train, and runningRpm and the starter, alternators and engine-driven pumps are on the GAS
 * GENERATOR (its rpm). Of the piston fields only induction.ramRecovery and the thermal oil model are read.
 */
export interface TurbineDef {
  kind: 'freeTurbine';
  gasGenerator: GasGeneratorDef;
  powerTurbine: {
    /** Torque with the power turbine held still over its torque at the design speed, for the same gas power (about 2). */
    stallTorqueRatio: number;
    /** Power-turbine and reduction-gearbox friction at the power-turbine shaft, N m: a constant and a part per 1000 power-turbine rpm. */
    friction: readonly [number, number];
    /** Fuel topping governor: above this power-turbine speed (fraction of ratedRpm) it takes `gain` Ng per unit overspeed off the FCU's set point. */
    topping: { np: number; gain: number };
  };
  /**
   * Reversing cam and the beta-mode topping reset (types with PitchControlDef.beta). Aft of the pitch-only travel
   * the cam raises the Ng demand linearly from idle to maxReverseNg at full reverse, and the fuel topping
   * governor's set point drops to reverseNp (fraction of ratedRpm) so that it, not the propeller governor,
   * holds Np in reverse. Absent: no reverse. Declared at the scaffold; turbine-core package.
   */
  reversingCam?: { maxReverseNg: number; reverseNp: number };
  /**
   * Torque limiter (PC-12, 47E sect. 7-10; ESTIMATE for the /47): an Ng-demand cap that holds the PROPELLER-shaft
   * torque at `psi` x lapse. `lapse` is the limit against pressure altitude (ft, psi; linear between points);
   * `ngTaper` = [Ng from, Ng to] over which the limit falls by a further `taperPsi`. `psiPerNm` converts
   * propeller-shaft torque (power-turbine torque x gearRatio) to psi. Implemented as a cut on the Ng demand in the
   * same path as the topping governor. Absent: none (the pilot sets torque, as on the C208).
   */
  torqueLimiter?: {
    psi: number; psiPerNm: number;
    lapse: { altFt: readonly number[]; psi: readonly number[] };
    ngTaper: readonly [number, number]; taperPsi: number;
  };
}

export interface EngineDef {
  name: string;
  kind: 'sparkPiston' | 'dieselFadec' | 'freeTurbine';
  cylinders: 4 | 6;
  /** W at ratedRpm (crank), sea level ISA. */
  ratedPower: number; ratedRpm: number;
  /** Optional sea-level ISA brake-power calibration at a specified MAP/RPM. For a derated engine,
   * the placarded rating is a pilot limitation, not its wide-open-throttle output. Pa, W, crank rpm. */
  calibration?: { manifoldPressure: number; power: number; rpm: number };
  /** Crank idle rpm with the installed propeller, throttle closed, warm. */
  idleRpm: number;
  /** m^3 */
  displacement: number; compressionRatio: number;
  fuel: FuelProperties;
  induction: InductionDef; metering: FuelMeteringDef; ignition: IgnitionDef; thermal: ThermalDef;
  /** Friction mean effective pressure polynomial (Pa) and its temperature factors; torque to turn the engine over compression, N m. */
  fmep: readonly [number, number, number];
  coldFrictionFactor: number; compressionLossTorque: number; breakawayTorque: number;
  /** Crank-side rotating inertia, kg m^2. */
  rotatingInertia: number;
  /** Crank rpm / propeller rpm (1 = direct drive). */
  gearRatio: number;
  /**
   * The reduction gear turns the crank the other way from the propeller (a single offset spur stage): the crank
   * side's angular momentum then subtracts from the propeller's. Absent: false (same sense).
   */
  gearReverses?: boolean;
  /** Counts as running when firing above this crank rpm. */
  runningRpm: number;
  /** Crank rpm an in-air start / trim is primed with, and the ground value. */
  airStartRpm: number; groundStartRpm: number;
  starter: { k: number; r: number };
  /**
   * Latching start switch (PC-12): one press engages the starter, which then runs until the gas generator reaches
   * cutoutNg (fraction) or cutoutSeconds have passed, or the STARTER INTERRUPT is pressed. Absent: hold-to-run
   * (ControlInputs.starter held), as on every type before the PC-12 including the C208. Declared at the scaffold;
   * the turbine-core package implements it in engineUnit.
   */
  starterLatch?: { cutoutNg: number; cutoutSeconds: number };
  fadec?: FadecDef;
  /** kind 'freeTurbine': the gas generator and power turbine. */
  turbine?: TurbineDef;
  /** Hand primer on the panel (spark engines with a float carburettor: C152, PA-38). Absent: none. */
  primer?: PrimerDef;
}

/**
 * Hand primer (Cessna 152 POH 7-16: "a small pump which draws fuel from the fuel strainer when the plunger is pulled
 * out, and injects it into the cylinder intake ports when the plunger is pushed back in"; the knob locks in). Each
 * stroke (ControlInputs.primerStrokes) takes `stroke` kg from the feed's lines and puts it on the intake port walls,
 * which the cranking air evaporates into the cylinders (fuelSystem.ts). With the member the engine's feed takes `cold`
 * as its cold film (the feed's own, if it has one, wins): a carburettor's spray wets a cold induction, and a cold
 * engine needs the prime. Too much floods it: the over-rich charge wets the plugs (PistonEngine). Unlocked, the
 * primer lets manifold vacuum draw fuel through it into the primed cylinders while the engine runs: they run rich
 * and the engine rough.
 */
export interface PrimerDef {
  /** Fuel one full stroke injects, kg. */
  stroke: number;
  /** Cylinders the primer lines reach, of EngineDef.cylinders. */
  primedCylinders: number;
  /** Fuel an unlocked primer passes under 50 kPa of manifold vacuum (about idle), kg/s; as the root of the vacuum. */
  unlockedFlow: number;
  /** The carburettor's spray on a cold induction, against cylinder-head temperature (ColdFilmDef). */
  cold: ColdFilmDef;
  /** Manifold vacuum, Pa, by which the carburettor's spray is atomised and wets the walls no more than warm ones. */
  atomisingVacuum: number;
  /**
   * The primer's charge on the port walls: its evaporation time at cranking speed (200 rpm; faster in proportion to
   * the shaft speed) against cylinder-head temperature (C, ascending), s; and what the ports hold, kg.
   */
  ports: { temperatureC: readonly number[]; time: readonly number[]; capacity: number };
}

export interface EngineInstallation {
  engine: EngineDef;
  propeller: PropellerDef;
  /** Propeller disc centre, reference-point body axes. */
  hub: Vec3;
  /** +1 clockwise seen from the cockpit. Applied at evaluation: no mirrored map. */
  rotation: 1 | -1;
  /** Thrust-line tilt from body x, rad: nose-up and nose-right. Default 0, 0. */
  tilt?: { up: number; right: number };
}

export interface TankDef {
  id: string;
  side: 'left' | 'right' | 'centre';
  /** Usable capacity, kg, and centroid (reference-point body axes). */
  capacity: number; position: Vec3;
}

export interface FuelFeedDef {
  /** Tank indices drawn in each selector position (equal shares among those holding fuel). A missing position shuts the feed. */
  positions: Partial<Record<FuelSelector, readonly number[]>>;
  /** Static head at the engine from tank height, psi (0 for a low wing). */
  gravityHeadPsi: number;
  feedCapacity: number; lineCapacity: number; lineUnusable: number;
  enginePump?: { psi: number };
  /** Electric pump; works above minVolts on the bus (volts, not a fraction). */
  auxPump?: { psi: number; minVolts: number;
    /** Absent: manual switch. PRIME bypasses the clutch/oil switch; threshold is installation data. */
    automatic?: { oilPressurePsi: number } };
  delivery:
    | { kind: 'injector'; capacity: number; openPsi: number; fullPsi: number }
    | { kind: 'carburettorBowl'; capacity: number; minHeadPsi: number }
    | { kind: 'commonRail'; minPsi: number };
  /** Port wall film. delivery 'commonRail': not read (write 0, 0). */
  film: { fraction: number; time: number; cold?: ColdFilmDef };
}

/**
 * Port wall film on cold cylinder heads (FuelFeedDef.film.cold): a cold engine needs priming. Against cylinder-head
 * temperature (C, ascending; the last entry is the warm film, film.fraction and film.time): the fraction of the
 * spray that wets the port walls, and the film's evaporation time at cranking speed (200 rpm; faster in
 * proportion to the shaft speed, never faster than the warm film). At rest nothing evaporates and all the spray
 * stays on the walls: the prime. The ports hold `capacity` kg; more runs out of the induction drains. Absent: the
 * film is the warm one at every temperature.
 */
export interface ColdFilmDef {
  temperatureC: readonly number[]; fraction: readonly number[]; time: readonly number[];
  capacity: number;
}

export interface FuelSystemDef {
  tanks: readonly TankDef[];
  /** One per engine, same order as PowerplantDef.engines. */
  feeds: readonly FuelFeedDef[];
}

export interface ElectricalDef {
  lighting?: { landingRequiresClutch?: boolean; panelRequiresNav?: boolean };
  nominalVolts: 14 | 28;
  regulatorVolts: number;
  battery: { capacityAh: number; ocvEmpty: number; ocvSpan: number; rDischarge: number; rChargeBase: number; rChargeFull: number };
  /** One per alternator. `engine` = index of the engine that drives it; cutInRpm and fullRpm are CRANK rpm (geared engines too). */
  alternators: readonly { engine: number; maxAmps: number; cutInRpm: number; fullRpm: number; efficiency: number }[];
  /** Load currents at nominal volts, A, by consumer name (today's LOAD_AMPS keys plus 'gearPump', 'glow', 'ecu'). Looked up by name; never iterated (the order of the sum is fixed in code). */
  loads: Readonly<Record<string, number>>;
  /** Thresholds in VOLTS (C172S: 24.5 low-voltage lamp, 32 over-voltage; 14 V systems: 12.5, 16). */
  lowVoltsLamp: number; overVolts: number;
  /**
   * Over-voltage sensor, V: above it the sensor removes the alternator field (every alternator goes off line) and
   * latches until both halves of the master switch are off (the 1978 Cessna 152: 31.5). Absent: no sensor.
   */
  overVoltageTrip?: number;
  /** Bus-powered equipment (flap motor, horn, gyros, avionics fan) is dead below this, V (28 V: 18-20; 14 V: 9-10). */
  busDeadVolts: number;
}

export interface PowerplantDef {
  engines: readonly EngineInstallation[];
  fuel: FuelSystemDef;
  electrical: ElectricalDef;
}
