// Spark-ignition piston engine, naturally aspirated (by default the Lycoming IO-360-L2A: 180 hp at 2700 rpm, fuel
// injected, direct drive).
//
// Mean-value model: torques are cycle averages expressed as mean effective pressures (torque = mep * Vd / 4 pi
// for a four-stroke), so nothing is singular at zero rpm and the starter, idle and windmilling cases need no
// special treatment:
//   imep = eta_i * LHV * FAR_stoich * g(phi) * rho_trapped      indicated (gas) work per displaced volume
//   fmep = rubbing + accessory friction, rising with rpm and with cold oil
//   pmep = p_exhaust - p_manifold                              pumping loss, large at closed throttle
// The indicated efficiency eta_i is not typed in: it is solved at construction so the model delivers exactly
// the rated power at the rated rpm, full throttle, full rich, sea-level ISA. Two more calibrations are solved
// the same way when the definition gives the handbook figure instead of the model's parameter: the full-rich
// equivalence ratio from the take-off fuel flow, and the idle bypass area from the idle speed (solveIdleArea).
//
// Carburettor heat and alternate air act on the air the engine breathes: warmer, at a lower total pressure and
// without ram. A float carburettor meters on the density of the air at ITS inlet, so heat also enriches.

import { clamp, smoothstep } from '../../core/math';
import type { MagnetoPosition } from '../../core/types';
import type { MoistureSample } from '../interfaces';
import { C172_ENGINE } from './c172Powerplant';
import { leverMetering, meteredPhi, mixturePower } from './combustion';
import type { EngineDef, IgnitionDef } from './defs';
import { ICE_WATER_SECONDS, Induction } from './induction';

const R_AIR = 287.05;
const RPM_PER_RAD_S = 60 / (2 * Math.PI);

/** The magnetos of a spark engine's definition. */
function magnetoIgnition(def: IgnitionDef): Extract<IgnitionDef, { kind: 'magnetos' }> {
  if (def.kind !== 'magnetos') throw new Error('PistonEngine: a spark engine has magnetos');
  return def;
}

const C172_IGNITION = magnetoIgnition(C172_ENGINE.ignition);

// The IO-360-L2A (C172_ENGINE, where each number is explained) under the names this module has always exported.
export const FMEP_COEFFS: readonly number[] = C172_ENGINE.fmep;
export const COLD_FRICTION_FACTOR = C172_ENGINE.coldFrictionFactor;
export const SINGLE_MAG_LOSS = C172_IGNITION.singleLoss;
export const SINGLE_MAG_DILUTION_LOSS = C172_IGNITION.singleDilutionLoss;
export const DILUTION_SENSITIVITY = C172_IGNITION.dilutionSensitivity;
export const COMPRESSION_LOSS_TORQUE = C172_ENGINE.compressionLossTorque;
export const MIN_FIRING_RPM = C172_IGNITION.minFiringRpm;

/** Oil temperature at which the cold-friction factor has faded out, C. */
const HOT_OIL_C = 70;
/** The compression loss at cranking speed fades out by this crank speed, rpm. */
const COMPRESSION_LOSS_FADE_RPM = 400;
/** Oil temperature of the rating, C. */
const OIL_REFERENCE_C = 85;
/** Indicated work lost while melt water from carburettor ice runs through the engine (rough running). */
const ICE_WATER_ROUGHNESS = 0.12;
/** Largest idle bypass area the idle-speed solve considers, as a fraction of the throttle bore. */
const IDLE_AREA_MAX = 0.2;
/** The servo's priming flow fades out by this crank speed, rpm (below cranking speed: air-flow metering from there). */
const PRIME_FADE_RPM = 100;
const SEA_LEVEL_DENSITY = 1.225;

export interface EngineInput {
  /** Crank speed, rad/s. */
  omega: number;
  throttle: number;
  mixture: number;
  magnetos: MagnetoPosition;
  ambientPressure: number;
  /** K. */
  ambientTemperature: number;
  ambientDensity: number;
  /** Dynamic pressure recovered by the inlet, Pa. */
  ramPressure: number;
  /** Oil temperature, C (friction depends on it). */
  oilTemperature: number;
  /** Mechanical power absorbed by the alternator and other accessories, W. */
  accessoryPower: number;
  /** Carburettor heat, 0 .. 1 (engines with a carburettor). Absent: cold. */
  carbHeat?: number;
  /** Alternate induction air selected (engines that have it). */
  alternateAir?: boolean;
  /** Step length, s: what the engine's own slow states (carburettor ice, ECU timers, torque lag) advance by. Absent or 0: they hold. */
  dt?: number;
  /** Moisture of the air, for carburettor icing. Absent: dry. */
  moisture?: MoistureSample;
  /** Quasi-steady evaluation (settle): slow states hold, lagged ones sit at their targets. */
  steady?: boolean;
  /** FADEC engines: the ENGINE MASTER switch, the bus voltage, whether the engine's own alternator is delivering, and the coolant temperature, C. */
  engineMaster?: boolean;
  busVoltage?: number;
  alternatorLive?: boolean;
  coolantTemperature?: number;
}

/**
 * What an engine unit needs of its engine, spark or diesel: breathe() at the present crank speed gives the fuel
 * it asks for, burn() with the fuel that arrived gives the torques.
 */
export interface EngineCore {
  readonly def: EngineDef;
  /** Fuel flow demanded, kg/s. */
  readonly fuelDemand: number;
  /** Equivalence ratio burning (0 on a diesel, which runs lean of anything the spark curves describe). */
  readonly phi: number;
  readonly firing: boolean;
  /** Indicated (gas) torque at the crank, N*m, >= 0; friction + pumping + accessory torque opposing rotation; and its friction part. */
  readonly indicatedTorque: number;
  readonly lossTorque: number;
  readonly frictionTorque: number;
  /** Load for the thermal model: air flow (spark) or power (diesel) relative to rated. */
  readonly load: number;
  /** Manifold absolute pressure, Pa, and charge temperature, K. */
  readonly manifoldPressure: number;
  readonly chargeTemperature: number;
  /** Carburettor ice, 0 .. 1 (0 without a carburettor). */
  readonly carbIce: number;
  breathe(input: EngineInput): void;
  burn(input: EngineInput, fuelDelivered: number): void;
  reset(ambientPressure: number, ambientTemp: number): void;
}

export class PistonEngine implements EngineCore {
  readonly induction: Induction;
  /** Indicated efficiency at stoichiometric with both magnetos and no dilution (solved at construction). */
  private etaI = 1;
  /** Cylinder air mass flow at rated conditions, kg/s (reference for loads and temperatures). */
  private airFlowAtRating = 0;

  // Results of the last breathe()/burn() pair.
  /** Metered fuel flow demanded by the servo, kg/s. */
  fuelDemand = 0;
  /** Equivalence ratio actually burning (after any fuel starvation). */
  phi = 0;
  firing = false;
  /** Combustion efficiency relative to ideal ignition (magnetos and misfire), 0..1. */
  combustionQuality = 0;
  /** Indicated (gas) torque, N*m, >= 0. */
  indicatedTorque = 0;
  /** Friction + pumping + accessory torque opposing rotation, N*m. */
  lossTorque = 0;
  /** Friction part of the loss (heats the oil), N*m. */
  frictionTorque = 0;

  private readonly mepToTorque: number;
  private readonly compressionRatio: number;
  private readonly stoichFar: number;
  private readonly fuelLhv: number;
  private fullRichPhi: number;
  private readonly leanestFraction: number;
  private readonly minFiringRpm: number;
  private readonly singleMagLoss: number;
  private readonly singleMagDilutionLoss: number;
  private readonly dilutionSensitivity: number;
  private readonly fmep: readonly [number, number, number];
  private readonly coldFrictionFactor: number;
  private readonly compressionLossTorque: number;
  /** The air reaches the cylinders as the atmosphere supplies it: no carburettor (heat, inlet-density metering, ice) and no alternate air. */
  private readonly plainInlet: boolean;
  /** A float carburettor meters on the density at its own inlet. */
  private readonly inletMetering: boolean;
  private readonly heatRise: number;
  private readonly heatPressureLoss: number;
  private readonly alternateRise: number;
  private readonly alternatePressureLoss: number;
  /** Servo flow at rest at full rich, kg/s (0: none). */
  private readonly primeFlow: number;

  constructor(readonly def: EngineDef = C172_ENGINE) {
    if (def.kind !== 'sparkPiston') throw new Error(`${def.name}: PistonEngine is a spark engine`);
    const metering = leverMetering(def.metering);
    const ignition = magnetoIgnition(def.ignition);
    this.induction = new Induction(def);
    this.mepToTorque = def.displacement / (4 * Math.PI);
    this.compressionRatio = def.compressionRatio;
    this.stoichFar = def.fuel.stoichFar;
    this.fuelLhv = def.fuel.lhv;
    this.fullRichPhi = metering.fullRichPhi;
    this.leanestFraction = metering.leanestFraction;
    this.minFiringRpm = ignition.minFiringRpm;
    this.singleMagLoss = ignition.singleLoss;
    this.singleMagDilutionLoss = ignition.singleDilutionLoss;
    this.dilutionSensitivity = ignition.dilutionSensitivity;
    this.fmep = def.fmep;
    this.coldFrictionFactor = def.coldFrictionFactor;
    this.compressionLossTorque = def.compressionLossTorque;
    const carburettor = def.induction.carburettor;
    const alternate = def.induction.alternateAir;
    this.inletMetering = def.metering.kind === 'floatCarburettor';
    this.plainInlet = !carburettor && !alternate && !this.inletMetering;
    this.heatRise = carburettor?.heatRise ?? 0;
    this.heatPressureLoss = carburettor?.heatPressureLoss ?? 0;
    this.alternateRise = alternate?.heatRise ?? 0;
    this.alternatePressureLoss = alternate?.pressureLoss ?? 0;
    this.primeFlow = def.metering.kind === 'rsaInjection' || def.metering.kind === 'continuousInjection' ? (def.metering.primeFlow ?? 0) : 0;
    this.rate();
  }

  /**
   * Solve eta_i from the rating: brake mep + losses = eta_i * (indicated mep per unit efficiency). With no
   * full-rich equivalence ratio in the definition, that is solved first: the one at which the rated air flow
   * takes the definition's take-off fuel flow.
   */
  private rate(): void {
    const def = this.def;
    this.etaI = 1;
    const omega = (def.ratedRpm * 2 * Math.PI) / 60;
    const probe: EngineInput = {
      omega,
      throttle: 1,
      mixture: 1,
      magnetos: 3,
      ambientPressure: 101325,
      ambientTemperature: 288.15,
      ambientDensity: 1.225,
      ramPressure: 0,
      oilTemperature: OIL_REFERENCE_C,
      accessoryPower: 0,
    };
    // Two passes so the lagged exhaust back pressure has settled.
    this.breathe(probe);
    this.breathe(probe);
    if (def.metering.kind !== 'fadecDiesel' && def.metering.fullRichPhi === undefined) {
      // The lever is full rich and the air is at sea-level density, so the metered ratio is fullRichPhi itself
      // but for the density the metering law sees: solve with that factor in, then meter again.
      this.fullRichPhi = 1;
      this.breathe(probe);
      this.fullRichPhi = def.metering.takeoffFuelFlow! / this.fuelDemand;
      this.breathe(probe);
    }
    this.burn(probe, this.fuelDemand);
    const brakeTorque = def.ratedPower / omega;
    this.etaI = (brakeTorque + this.lossTorque) / this.indicatedTorque;
    this.airFlowAtRating = this.induction.state.airFlow;
    this.induction.reset(101325, 288.15);
  }

  /** Cylinder air mass flow at rated conditions, kg/s (reference for loads and temperatures). */
  get ratedAirFlow(): number {
    return this.airFlowAtRating;
  }

  /**
   * Solve the idle bypass area so that the warm engine, throttle closed and full rich at sea level, delivers
   * `loadTorque` (N*m at the crank: what its propeller takes at the definition's idle speed) at that speed, and
   * rate the engine again with it (the bypass is open at full throttle too). Returns the area, m^2. The unit
   * calls it when the definition gives the idle speed and no area.
   */
  solveIdleArea(loadTorque: number): number {
    const def = this.def;
    const idle: EngineInput = {
      omega: (def.idleRpm * 2 * Math.PI) / 60,
      throttle: 0,
      mixture: 1,
      magnetos: 3,
      ambientPressure: 101325,
      ambientTemperature: 288.15,
      ambientDensity: 1.225,
      ramPressure: 0,
      oilTemperature: OIL_REFERENCE_C,
      accessoryPower: 0,
    };
    // Brake torque at idle rises with the bypass area: bisection.
    let lo = 0;
    let hi = IDLE_AREA_MAX * def.induction.throttleBoreArea;
    for (let i = 0; i < 40; i++) {
      const area = 0.5 * (lo + hi);
      this.induction.idleBypassArea = area;
      this.rate();
      this.breathe(idle);
      this.breathe(idle);
      this.burn(idle, this.fuelDemand);
      if (this.indicatedTorque - this.lossTorque < loadTorque) lo = area;
      else hi = area;
    }
    this.induction.idleBypassArea = 0.5 * (lo + hi);
    this.rate();
    this.reset(101325, 288.15);
    return this.induction.idleBypassArea;
  }

  /** Solve the induction system and the fuel the servo meters for it. */
  breathe(input: EngineInput): void {
    const rpm = input.omega * RPM_PER_RAD_S;
    if (!this.plainInlet) this.breatheThroughInlet(input, rpm);
    else {
      const ind = this.induction.update(
        input.throttle,
        rpm,
        input.ambientPressure + input.ramPressure,
        input.ambientPressure,
        input.ambientTemperature,
      );
      this.fuelDemand = ind.airFlow * this.stoichFar * meteredPhi(input.mixture, input.ambientDensity, this.fullRichPhi, this.leanestFraction);
    }
    // Priming: with no air flow the servo still passes fuel at the mixture lever's setting once the electric pump
    // pressurises it (the fuel system gates the flow on pressure).
    if (this.primeFlow > 0 && !input.steady && rpm < PRIME_FADE_RPM) {
      const prime = this.primeFlow * meteredPhi(input.mixture, SEA_LEVEL_DENSITY, 1, this.leanestFraction) * (1 - smoothstep(0, PRIME_FADE_RPM, rpm));
      this.fuelDemand = Math.max(this.fuelDemand, prime);
    }
  }

  /**
   * breathe() for an engine with carburettor heat or alternate air. Either source is unfiltered air from
   * inside the cowling: warmer by the definition's rise, with no ram recovery, and through a narrower duct, which
   * costs the definition's fraction of the total pressure at the rated air flow and less in proportion to the
   * square of the flow (a duct loss; like the exhaust back pressure it is taken from the air flow of the step
   * before). A partly pulled heat knob mixes the two streams in proportion. The ice in a carburettor grows or
   * melts at the inlet temperature that results.
   */
  private breatheThroughInlet(input: EngineInput, rpm: number): void {
    const heat = clamp(input.carbHeat ?? 0, 0, 1);
    const alternate = input.alternateAir === true;
    const inletTemp = input.ambientTemperature + this.heatRise * heat + (alternate ? this.alternateRise : 0);
    const ram = alternate ? 0 : input.ramPressure * (1 - heat);
    let loss = 0;
    if (heat > 0 || alternate) {
      const flow = this.induction.state.airFlow / this.airFlowAtRating;
      loss = (this.heatPressureLoss * heat + (alternate ? this.alternatePressureLoss : 0)) * flow * flow;
    }
    const p0 = (input.ambientPressure + ram) * (1 - loss);
    // The venturi sees the air flow and the fuel of the step before (none on a stopped engine or at cut-off).
    if (!input.steady) this.induction.updateIce(input.dt ?? 0, input.throttle, inletTemp, input.ambientTemperature, input.moisture, this.load, this.phi);
    const ind = this.induction.update(input.throttle, rpm, p0, input.ambientPressure, inletTemp);
    const meteringDensity = this.inletMetering ? p0 / (R_AIR * inletTemp) : input.ambientDensity;
    this.fuelDemand = ind.airFlow * this.stoichFar * meteredPhi(input.mixture, meteringDensity, this.fullRichPhi, this.leanestFraction);
  }

  /** Combustion and losses given the fuel actually delivered to the injectors, kg/s. */
  burn(input: EngineInput, fuelDelivered: number): void {
    const ind = this.induction.state;
    const rpm = input.omega * RPM_PER_RAD_S;
    this.phi = ind.airFlow > 1e-9 ? fuelDelivered / (ind.airFlow * this.stoichFar) : 0;

    const excessResidual = Math.max(0, ind.residualFraction - 1 / this.compressionRatio);
    const sparks =
      input.magnetos === 3 ? 1 : input.magnetos === 0 ? 0 : 1 - this.singleMagLoss - this.singleMagDilutionLoss * excessResidual;
    const power = mixturePower(this.phi);
    this.firing = sparks > 0 && power > 0 && rpm >= this.minFiringRpm;
    const dilution = 1 - this.dilutionSensitivity * excessResidual;
    this.combustionQuality = this.firing ? sparks * dilution : 0;
    const water = this.induction.meltWater;
    if (water > 0) this.combustionQuality *= 1 - ICE_WATER_ROUGHNESS * Math.min(1, water / ICE_WATER_SECONDS);

    const trappedDensity = (ind.volumetricEfficiency * ind.manifoldPressure) / (R_AIR * ind.chargeTemperature);
    const imep = this.firing
      ? this.etaI * this.combustionQuality * this.fuelLhv * this.stoichFar * power * trappedDensity
      : 0;
    this.indicatedTorque = imep * this.mepToTorque;

    const n = rpm / 1000;
    const cold = 1 + (this.coldFrictionFactor - 1) * clamp((HOT_OIL_C - input.oilTemperature) / HOT_OIL_C, 0, 1);
    const fmep = (this.fmep[0] + this.fmep[1] * n + this.fmep[2] * n * n) * cold;
    const pmep = ind.exhaustPressure - ind.manifoldPressure;
    this.frictionTorque = fmep * this.mepToTorque;
    const compression = this.compressionLossTorque * (1 - smoothstep(0, COMPRESSION_LOSS_FADE_RPM, rpm));
    this.lossTorque = (fmep + pmep) * this.mepToTorque + compression + input.accessoryPower / Math.max(input.omega, 20);
  }

  get indicatedEfficiency(): number {
    return this.etaI;
  }

  /** Air mass flow relative to the rated flow (engine load for the thermal model). */
  get load(): number {
    return this.induction.state.airFlow / this.airFlowAtRating;
  }

  get manifoldPressure(): number {
    return this.induction.state.manifoldPressure;
  }

  get chargeTemperature(): number {
    return this.induction.state.chargeTemperature;
  }

  get carbIce(): number {
    return this.induction.ice;
  }

  /**
   * Rough running beyond what the mixture and the magnetos give, 0 (none) .. 1: melt water from carburettor ice
   * going through the cylinders. Published as EngineState.roughness (engines with a carburettor); the audio adds
   * it to its own roughness(mixture, magnetos).
   */
  get roughness(): number {
    return Math.min(1, this.induction.meltWater / ICE_WATER_SECONDS);
  }

  reset(ambientPressure: number, ambientTemp: number): void {
    this.induction.reset(ambientPressure, ambientTemp);
    this.fuelDemand = this.phi = this.indicatedTorque = this.lossTorque = this.frictionTorque = 0;
    this.combustionQuality = 0;
    this.firing = false;
    this.induction.ice = this.induction.meltWater = 0;
  }
}
