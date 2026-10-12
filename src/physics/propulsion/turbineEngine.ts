// Free-turbine turboprop (by definition data; the pattern is the Pratt & Whitney Canada PT6A): a gas generator
// (gasGenerator.ts) whose gas drives a separate POWER TURBINE on its own shaft, geared down to the propeller. The
// two shafts are coupled by the gas alone, so the propeller governor holds the propeller speed while the power
// lever sets the gas generator's speed, and with it the power.
//
// The engine unit (engineUnit.ts) sees this as it sees a piston engine: its "crank" is the power turbine, and
// breathe() / burn() give the fuel the fuel control meters and the torque on that shaft. What is different:
//   - the starter, the generator and the engine-driven pumps are on the GAS GENERATOR, which carries its own
//     state (Ng, ITT, whether it is alight); the unit routes the starter's torque to it, not to the propeller;
//   - power lever -> the Ng the fuel control governs to, from the idle Ng (condition lever LOW / HIGH IDLE) to
//     maxNg; mixture lever = condition lever: below CUTOFF_BELOW the fuel is shut off;
//   - the igniters spark while the starter is engaged with the IGNITION (magneto) switch at NORM (0), and
//     continuously at ON (any other position); a dry motoring run (to blow out the fuel a failed start left in the
//     combustor) is the starter with the condition lever at CUT-OFF;
//   - power-turbine torque falls linearly with its speed for a given gas power, from stallTorqueRatio times the
//     design-speed torque with the power turbine held still: a free turbine gives the most torque stalled;
//   - the fuel topping governor takes Ng off when the power turbine overspeeds (a failed propeller governor).
// Beta and reverse (the power lever below flight idle moving the blades directly) are not modelled yet.

import { clamp } from '../../core/math';
import type { EngineDef, TurbineDef } from './defs';
import type { EngineCore, EngineInput } from './engine';
import { GasGenerator, type GasGeneratorInput } from './gasGenerator';

const RPM_PER_RAD_S = 60 / (2 * Math.PI);
/** Mixture (condition) lever below this: fuel cut-off; from it to 1: LOW IDLE to HIGH IDLE. */
export const CUTOFF_BELOW = 0.1;
/** cp / R of air, for the inlet's ram temperature rise from its ram pressure rise (isentropic). */
const GAMMA_RATIO = 0.4 / 1.4;

export class TurbineEngine implements EngineCore {
  readonly gasGenerator: GasGenerator;
  // Results of the last breathe()/burn() pair.
  fuelDemand = 0;
  readonly phi = 0;
  firing = false;
  /** Power-turbine torque, N m at the power-turbine shaft, >= 0; its friction; the same. */
  indicatedTorque = 0;
  lossTorque = 0;
  frictionTorque = 0;
  readonly carbIce = 0;
  /** Inlet total pressure, Pa, and temperature, K. */
  manifoldPressure = 101325;
  chargeTemperature = 288.15;
  /** Ng the fuel control is governing to, fraction. */
  ngDemand = 0;

  private readonly turbine: TurbineDef;
  private readonly ratedPower: number;
  /** Power-turbine design speed, rad/s. */
  private readonly omegaDesign: number;
  /** Power-turbine speed of the last breathe(), rad/s. */
  private omegaPt = 0;
  private readonly gg: GasGeneratorInput = {
    inletPressure: 101325, inletTemperature: 288.15, ngDemand: 0, cutoff: true, igniters: false,
    accessoryPower: 0, starterTorque: 0, dt: 0, steady: false,
  };

  constructor(readonly def: EngineDef) {
    if (def.kind !== 'freeTurbine' || !def.turbine) throw new Error(`${def.name}: TurbineEngine is a free turbine (kind 'freeTurbine' with turbine data)`);
    this.turbine = def.turbine;
    this.gasGenerator = new GasGenerator(def.turbine.gasGenerator, def.fuel.lhv);
    this.ratedPower = def.ratedPower;
    this.omegaDesign = (def.ratedRpm * 2 * Math.PI) / 60;
  }

  /** Power-turbine output relative to rated (the thermal model's load). */
  get load(): number {
    return (this.indicatedTorque * this.omegaPt) / this.ratedPower;
  }

  /** Ng, fraction; ITT, C; gas-generator rpm. */
  get ng(): number {
    return this.gasGenerator.ng;
  }

  get ittC(): number {
    return this.gasGenerator.ittC;
  }

  get ngRpm(): number {
    return this.gasGenerator.rpm;
  }

  breathe(input: EngineInput): void {
    const def = this.turbine;
    const fcu = def.gasGenerator.fcu;
    const gg = this.gg;
    const ram = input.ramPressure;
    gg.inletPressure = input.ambientPressure + ram;
    gg.inletTemperature = input.ambientTemperature * Math.pow(gg.inletPressure / input.ambientPressure, GAMMA_RATIO);
    this.manifoldPressure = gg.inletPressure;
    this.chargeTemperature = gg.inletTemperature;
    this.omegaPt = input.omega;

    // Levers: the condition lever's idle, the power lever's span above it, the topping governor's cut.
    const condition = input.mixture;
    gg.cutoff = condition < CUTOFF_BELOW;
    const idle = fcu.lowIdleNg + (fcu.highIdleNg - fcu.lowIdleNg) * clamp((condition - CUTOFF_BELOW) / (1 - CUTOFF_BELOW), 0, 1);
    let demand = idle + (fcu.maxNg - idle) * clamp(input.throttle, 0, 1);
    const overspeed = input.omega / this.omegaDesign - def.powerTurbine.topping.np;
    if (overspeed > 0) demand -= def.powerTurbine.topping.gain * overspeed;
    this.ngDemand = gg.ngDemand = Math.max(demand, 0);
    gg.igniters = input.igniters === true;
    gg.accessoryPower = input.accessoryPower;
    gg.dt = input.steady ? 0 : (input.dt ?? 0);
    gg.steady = input.steady === true;
    this.fuelDemand = this.gasGenerator.breathe(gg);

    // Power-turbine and gearbox friction.
    const [constant, perKrpm] = def.powerTurbine.friction;
    this.frictionTorque = input.omega > 0 ? constant + (perKrpm * input.omega * RPM_PER_RAD_S) / 1000 : 0;
    this.lossTorque = this.frictionTorque;
  }

  burn(input: EngineInput, fuelDelivered: number): void {
    const gg = this.gg;
    gg.starterTorque = input.starterTorque ?? 0;
    this.gasGenerator.burn(gg, fuelDelivered);
    this.firing = this.gasGenerator.lit;
    // The power turbine: the gas power's torque at the design speed, more when slower, less when faster.
    const a = this.turbine.powerTurbine.stallTorqueRatio;
    const designTorque = this.gasGenerator.gasPower / this.omegaDesign;
    this.indicatedTorque = Math.max(0, designTorque * (a - (a - 1) * (input.omega / this.omegaDesign)));
  }

  /** Stopped, cold-soaked at `ambientTemp` (K). */
  reset(ambientPressure: number, ambientTemp: number): void {
    this.gasGenerator.reset(ambientTemp);
    this.fuelDemand = this.indicatedTorque = this.lossTorque = this.frictionTorque = 0;
    this.firing = false;
    this.manifoldPressure = ambientPressure;
    this.chargeTemperature = ambientTemp;
  }

  /** Alight at low idle (or `ng`) with a warm ITT: a running engine at a reset. */
  light(ng?: number): void {
    this.gasGenerator.reset(this.chargeTemperature, true, ng);
    this.firing = true;
  }
}
