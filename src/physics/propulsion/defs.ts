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
}

export interface FeatherDef {
  /** Blade angle at the feather stop, rad (at the propeller's reference station). */
  angle: number;
  /** Centrifugal latches engage below this PROPELLER rpm when the blades are finer than latchAngle (no feathering on shutdown). */
  latchRpm: number; latchAngle: number;
  /** 'starter': oil pressure from cranking drives the blades fine. 'accumulator': stored pressure does, once, when feather is deselected. */
  unfeather: 'starter' | 'accumulator';
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
      /** Blade angles at which map slices are tabulated, rad, ascending from fineStop to the feather (or coarse) stop. At most 16. */
      pitchNodes: readonly number[];
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
  | { kind: 'fadecDiesel' };

export type IgnitionDef =
  | { kind: 'magnetos'; minFiringRpm: number; singleLoss: number; singleDilutionLoss: number; dilutionSensitivity: number }
  | { kind: 'compression'; minFiringRpm: number; glow: { preheatSeconds: number; amps: number; neededBelowC: number } };

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

export interface EngineDef {
  name: string;
  kind: 'sparkPiston' | 'dieselFadec';
  cylinders: 4 | 6;
  /** W at ratedRpm (crank), sea level ISA. */
  ratedPower: number; ratedRpm: number;
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
  fadec?: FadecDef;
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
  auxPump?: { psi: number; minVolts: number };
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
  nominalVolts: 14 | 28;
  regulatorVolts: number;
  battery: { capacityAh: number; ocvEmpty: number; ocvSpan: number; rDischarge: number; rChargeBase: number; rChargeFull: number };
  /** One per alternator. `engine` = index of the engine that drives it; cutInRpm and fullRpm are CRANK rpm (geared engines too). */
  alternators: readonly { engine: number; maxAmps: number; cutInRpm: number; fullRpm: number; efficiency: number }[];
  /** Load currents at nominal volts, A, by consumer name (today's LOAD_AMPS keys plus 'gearPump', 'glow', 'ecu'). Looked up by name; never iterated (the order of the sum is fixed in code). */
  loads: Readonly<Record<string, number>>;
  /** Thresholds in VOLTS (C172S: 24.5 low-voltage lamp, 32 over-voltage; 14 V systems: 12.5, 16). */
  lowVoltsLamp: number; overVolts: number;
  /** Bus-powered equipment (flap motor, horn, gyros, avionics fan) is dead below this, V (28 V: 18-20; 14 V: 9-10). */
  busDeadVolts: number;
}

export interface PowerplantDef {
  engines: readonly EngineInstallation[];
  fuel: FuelSystemDef;
  electrical: ElectricalDef;
}
