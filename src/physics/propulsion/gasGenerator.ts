// The gas generator of a gas turbine: one spool (compressor and the turbine that drives it), its combustor and
// the fuel control unit that meters fuel to it. Whatever the gas is used for (a free power turbine here, a
// propelling nozzle or a fan later) is the output stage's business: the gas generator reports the gas POWER the
// output stage can make at its design speed, and the inter-turbine temperature (ITT).
//
// Mean-value model on corrected parameters. With delta and theta the inlet total pressure and temperature over
// sea-level ISA, the steady running line of the definition (GasGeneratorDef.map, sea level) gives the engine
// anywhere: at a corrected speed Nc = Ng / sqrt(theta) the steady fuel flow is delta sqrt(theta) f(Nc), the gas
// power delta sqrt(theta) P(Nc), and the ITT, in kelvin, theta T(Nc). So a hot or high engine at the same Ng
// makes less power at a higher ITT, and the ITT, not Ng, is what limits it.
//
// Spool: J omega domega/dt = eta(Nc) LHV Wf - Pc(N) - P_accessories + Q_starter omega
//   Pc   power the compressor absorbs, delta sqrt(theta) compressorPower Nc^3;
//   eta  the fraction of the fuel's heat that drives the spool, solved from the map so the steady fuel holds the
//        steady speed (eta LHV f(Nc) = compressorPower Nc^3). Below the map (starting) it falls from its value
//        at the map's first speed to nothing at light-off, as (s)^p with s the position between the two; p is
//        solved at construction so that on the acceleration schedule the spool just holds its speed at the
//        self-sustaining Ng: slower, it needs the starter; faster, it accelerates alone.
// Combustor: the gas temperature rise is proportional to the fuel-air ratio. The air flow is derived from the
// map (the flow that gives the map's ITT with the map's fuel) and falls in proportion to Ng below it, so a slow
// start runs hot. Fuel that arrives before the flame lights (below light-off, or without the igniters) pools in
// the combustor and burns off at light-off on top of the metered flow: fuel introduced too early is a hot start.
// Fuel control: a proportional governor on Ng about the steady flow, between the acceleration schedule (the start
// schedule below the map) and the minimum-flow stop; both scale with delta sqrt(theta), as a Wf / P3 schedule
// does. In a quasi-steady evaluation the spool sits at the governed speed.

import { clamp, interp1 } from '../../core/math';
import type { GasGeneratorDef } from './defs';

const SEA_LEVEL_PRESSURE = 101325;
const SEA_LEVEL_TEMPERATURE = 288.15;
const KELVIN = 273.15;
const RPM_TO_RAD_S = (2 * Math.PI) / 60;
/** Bearing and seal drag of the spool, as a fraction of the compressor's torque at Ng = 1 (it brings a coasting spool to rest). */
const BEARING_DRAG = 0.002;
/** The spool's torque equation divides power by speed: not below this fraction of the reference speed. */
const OMEGA_FLOOR = 0.01;
/** Gas power during transients follows the fuel burnt relative to the steady flow, up to this. */
const GAS_POWER_FUEL_RATIO_MAX = 1.5;
/** Less fuel delivered than this fraction of what the FCU metered and the flame goes out (starvation). */
const STARVED_BELOW = 0.25;
/** The ITT probes cool with the engine after shutdown with this time constant, s. */
const ITT_COOL_TIME = 20;
/** ITT the combustor can reach, K (beyond it the flame is too rich to burn more). */
const ITT_MAX = 1500;
/** Unburnt fuel in the combustor: what it can hold, kg; the time the drain valve takes to empty it, s; the time it burns off in once lit, s. */
const POOL_MAX = 0.5;
const POOL_DRAIN_TIME = 30;
const POOL_BURN_TIME = 2.5;
/** The air through a turning engine adds the drain's rate again for every this much Ng. */
const POOL_BLOWN_NG = 0.2;

/** What the gas generator needs from its output stage and the aircraft each step. */
export interface GasGeneratorInput {
  /** Inlet total pressure, Pa, and total temperature, K. */
  inletPressure: number;
  inletTemperature: number;
  /** Physical Ng the fuel control governs to (fraction). */
  ngDemand: number;
  /** Fuel shut off (condition lever at CUT-OFF). */
  cutoff: boolean;
  /** The igniters are sparking. */
  igniters: boolean;
  /** Shaft power the accessories (generator) take from the spool, W. */
  accessoryPower: number;
  /** Starter torque at the gas-generator shaft, N m. */
  starterTorque: number;
  dt: number;
  /** Quasi-steady evaluation: the spool sits at the governed speed and the ITT at its target. */
  steady: boolean;
}

export class GasGenerator {
  /** Gas-generator speed, rad/s. */
  omega = 0;
  /** Combustion is alight. */
  lit = false;
  /** ITT, K. */
  itt = SEA_LEVEL_TEMPERATURE;
  /** Fuel flow the fuel control meters, kg/s. */
  fuelDemand = 0;
  /** Gas power the output stage can make at its design speed, W. */
  gasPower = 0;
  /** Fuel burning, kg/s. */
  fuelBurnt = 0;
  /** Unburnt fuel lying in the combustor, kg. */
  pooled = 0;

  /** Speed at Ng = 1, rad/s. */
  readonly omegaRef: number;
  /** Exponent of the efficiency in the start region (solved). */
  readonly startExponent: number;
  private readonly mapNg: readonly number[];
  private readonly mapFuel: readonly number[];
  private readonly mapPower: readonly number[];
  /** Per map speed: the fraction of the fuel heat that drives the spool, and the corrected air flow (kg/s per kelvin of ITT rise, scaled). */
  private readonly eta: number[];
  private readonly air: number[];
  private readonly bearingTorque: number;
  private readonly lhv: number;

  constructor(readonly def: GasGeneratorDef, lhv: number) {
    const { map, fcu } = def;
    const n = map.ng.length;
    if (n < 2 || map.fuelFlow.length !== n || map.itt.length !== n || map.power.length !== n) throw new Error('GasGenerator: map columns of one length, two rows at least');
    for (let i = 1; i < n; i++) if (!(map.ng[i] > map.ng[i - 1])) throw new Error('GasGenerator: map speeds ascending');
    const ng0 = map.ng[0];
    if (!(def.lightOffNg < def.selfSustainingNg && def.selfSustainingNg < ng0)) throw new Error('GasGenerator: lightOffNg < selfSustainingNg < the map\'s first speed');
    if (!(fcu.lowIdleNg >= ng0 && fcu.highIdleNg >= fcu.lowIdleNg && fcu.maxNg > fcu.highIdleNg)) throw new Error('GasGenerator: map start <= low idle <= high idle < max');
    this.lhv = lhv;
    this.omegaRef = def.referenceRpm * RPM_TO_RAD_S;
    this.mapNg = map.ng;
    this.mapFuel = map.fuelFlow;
    this.mapPower = map.power;
    this.eta = map.ng.map((ng, i) => (def.compressorPower * ng * ng * ng) / (lhv * map.fuelFlow[i]));
    this.air = map.ng.map((_, i) => {
      const rise = map.itt[i] + KELVIN - SEA_LEVEL_TEMPERATURE;
      if (!(rise > 0)) throw new Error('GasGenerator: map ITT above the inlet temperature');
      return map.fuelFlow[i] / rise;
    });
    this.bearingTorque = (BEARING_DRAG * def.compressorPower) / this.omegaRef;

    // The start region: on the acceleration schedule the spool holds its speed at the self-sustaining Ng.
    const nss = def.selfSustainingNg;
    const s = (nss - def.lightOffNg) / (ng0 - def.lightOffNg);
    const need = (def.compressorPower * nss * nss * nss) / (this.eta[0] * lhv * this.accelFuel(nss));
    if (!(need > 0 && need < 1)) throw new Error('GasGenerator: the acceleration schedule cannot sustain the spool at selfSustainingNg (or sustains it at light-off)');
    this.startExponent = Math.log(need) / Math.log(s);
  }

  /** Ng, fraction of the reference speed. */
  get ng(): number {
    return this.omega / this.omegaRef;
  }

  /** Ng, rpm. */
  get rpm(): number {
    return this.ng * this.def.referenceRpm;
  }

  /** ITT, C. */
  get ittC(): number {
    return this.itt - KELVIN;
  }

  /** Steady fuel flow at corrected speed nc, sea level, kg/s (below the map: in proportion to the speed, for the governor only). */
  steadyFuel(nc: number): number {
    const ng0 = this.mapNg[0];
    return nc >= ng0 ? interp1(this.mapNg, this.mapFuel, nc) : (this.mapFuel[0] * nc) / ng0;
  }

  /** The acceleration (and start) schedule at corrected speed nc, sea level, kg/s. */
  accelFuel(nc: number): number {
    const a = this.def.fcu.accelFuel;
    return interp1(a.ng, a.fuelFlow, nc);
  }

  /** Fraction of the fuel heat that drives the spool at corrected speed nc. */
  efficiency(nc: number): number {
    const ng0 = this.mapNg[0];
    if (nc >= ng0) return interp1(this.mapNg, this.eta, nc);
    const s = clamp((nc - this.def.lightOffNg) / (ng0 - this.def.lightOffNg), 0, 1);
    return this.eta[0] * Math.pow(s, this.startExponent);
  }

  /** Corrected air flow at nc, in the map's units (fuel flow per kelvin of ITT rise). */
  private airFlow(nc: number): number {
    const ng0 = this.mapNg[0];
    return nc >= ng0 ? interp1(this.mapNg, this.air, nc) : (this.air[0] * Math.max(nc, 0)) / ng0;
  }

  /** Gas power at nc for fuel burning at `ratio` x the steady flow, sea level, W. */
  private power(nc: number, ratio: number): number {
    const ng0 = this.mapNg[0];
    if (nc >= ng0) return interp1(this.mapNg, this.mapPower, nc) * ratio;
    const s = clamp((nc - this.def.lightOffNg) / (ng0 - this.def.lightOffNg), 0, 1);
    return this.mapPower[0] * s * s;
  }

  /** First half of a step: the fuel the control meters at the present speed (kg/s, in fuelDemand). */
  breathe(input: GasGeneratorInput): number {
    const def = this.def;
    const delta = input.inletPressure / SEA_LEVEL_PRESSURE;
    const sqrtTheta = Math.sqrt(input.inletTemperature / SEA_LEVEL_TEMPERATURE);
    const scale = delta * sqrtTheta;
    if (input.cutoff) this.lit = false;
    // In a quasi-steady evaluation a lit engine sits at its governed speed (no lower than it can run).
    if (input.steady) {
      if (this.lit) this.omega = Math.max(input.ngDemand, this.mapNg[0] * sqrtTheta) * this.omegaRef;
      else this.omega = 0;
    }
    const ng = this.ng;
    const nc = ng / sqrtTheta;
    if (input.cutoff || ng < def.minFuelNg) {
      this.fuelDemand = 0;
      return 0;
    }
    const steady = this.steadyFuel(nc) * scale;
    if (input.steady && this.lit) {
      this.fuelDemand = steady;
      return steady;
    }
    const governed = steady + def.fcu.gain * this.mapFuelAt1() * scale * (input.ngDemand - ng);
    const accel = this.accelFuel(nc) * scale;
    const decel = def.fcu.decelFraction * Math.min(steady, accel);
    this.fuelDemand = clamp(governed, decel, accel);
    return this.fuelDemand;
  }

  private mapFuelAt1(): number {
    return interp1(this.mapNg, this.mapFuel, 1);
  }

  /** Second half: light, burn the fuel that arrived (kg/s), turn the spool, and the ITT. */
  burn(input: GasGeneratorInput, fuelDelivered: number): void {
    const def = this.def;
    const delta = input.inletPressure / SEA_LEVEL_PRESSURE;
    const theta = input.inletTemperature / SEA_LEVEL_TEMPERATURE;
    const sqrtTheta = Math.sqrt(theta);
    const scale = delta * sqrtTheta;
    const omega = this.omega;
    const nc = this.ng / sqrtTheta;
    const steadyFlow = this.steadyFuel(nc) * scale;

    // Light-off, starvation, lean blow-out.
    if (!this.lit && input.igniters && !input.cutoff && fuelDelivered > 0 && nc >= def.lightOffNg) this.lit = true;
    if (this.lit) {
      const starved = fuelDelivered < STARVED_BELOW * this.fuelDemand || fuelDelivered <= 0;
      const blownOut = nc >= this.mapNg[0] && fuelDelivered < def.leanBlowout * steadyFlow;
      if (starved || blownOut) this.lit = false;
    }
    // Fuel that reaches an unlit combustor pools in it (and drains overboard slowly); at light-off it burns off
    // on top of the metered flow, late and out of place (the torching of a wet start): it heats the turbines
    // and the ITT probes but does no work on the spool.
    const burnt = this.lit ? fuelDelivered : 0;
    let torching = 0;
    if (input.steady) this.pooled = 0;
    else if (this.lit) {
      const off = this.pooled * (1 - Math.exp(-input.dt / POOL_BURN_TIME));
      this.pooled -= off;
      torching = input.dt > 0 ? off / input.dt : 0;
    } else if (input.dt > 0) {
      // Air through a motoring engine blows it out faster than the drain alone.
      const drain = (1 + this.ng / POOL_BLOWN_NG) / POOL_DRAIN_TIME;
      this.pooled = Math.min(POOL_MAX, this.pooled * Math.exp(-input.dt * drain) + fuelDelivered * input.dt);
    }
    this.fuelBurnt = burnt;
    const ratio = steadyFlow > 0 ? clamp(burnt / steadyFlow, 0, GAS_POWER_FUEL_RATIO_MAX) : 0;
    this.gasPower = this.lit ? this.power(nc, ratio) * scale : 0;

    // ITT: the gas temperature rise follows the fuel-air ratio; unlit, the probes cool toward the inlet air.
    const air = this.airFlow(nc);
    let target = input.inletTemperature;
    if (this.lit) target = Math.min(ITT_MAX, input.inletTemperature + (air > 0 ? (theta * (burnt + torching)) / (scale * air) : ITT_MAX));
    if (input.steady) this.itt = target;
    else if (input.dt > 0) {
      const tau = this.lit ? def.ittLag : ITT_COOL_TIME;
      this.itt = target + (this.itt - target) * Math.exp(-input.dt / tau);
    }

    // The spool.
    if (input.steady) return;
    const floor = OMEGA_FLOOR * this.omegaRef;
    const compressor = def.compressorPower * scale * nc * nc * nc;
    const net = this.efficiency(nc) * this.lhv * burnt - compressor - input.accessoryPower;
    let torque = net / Math.max(omega, floor) + input.starterTorque;
    if (omega > 0) torque -= this.bearingTorque;
    else if (torque <= this.bearingTorque) torque = 0;
    this.omega = Math.max(0, omega + (torque / def.inertia) * input.dt);
  }

  /** Stopped and cold-soaked at inlet temperature `ambientTemp` (K); or, `running`, alight at `ng` with a warm ITT. */
  reset(ambientTemp: number, running = false, ng = this.def.fcu.lowIdleNg): void {
    this.lit = running;
    this.omega = running ? ng * this.omegaRef : 0;
    this.itt = running ? this.def.warmItt + KELVIN : ambientTemp;
    this.fuelDemand = this.fuelBurnt = this.gasPower = this.pooled = 0;
  }
}
