// Lumped thermal model of the engine: exhaust gas, cylinder heads, oil, and the oil and fuel pressures that
// the gauges show.
//
//   EGT  first-order probe lag (~3 s) toward the exhaust temperature of the current mixture and load.
//   CHT  heat balance of the cylinder heads: combustion heat in, forced convection to the cooling air out,
//        with the convective conductance scaling as (rho V)^0.8 (turbulent fin heat transfer).
//   Oil  heat balance of the oil and crankcase: friction heat and piston-underside heat in, oil cooler out,
//        with the cooler bypassed by the vernatherm valve until the oil is warm (opens 70..85 C).
// The capacities and conductances are the engine definition's (ThermalDef; by default the IO-360-L2A's, chosen
// for the temperatures a warm C172S shows).
//
// A liquid-cooled engine (ThermalDef.liquid) replaces the cylinder-head balance by one of the coolant: combustion
// heat in, the radiator out once the thermostat has opened; and adds the reduction gearbox, heated by its own
// losses. Its "CHT" is the coolant temperature, for consumers that read one.

import { clamp, lerp, smoothstep } from '../../core/math';
import { C172_ENGINE } from './c172Powerplant';
import { egtDropFromPeak, headHeatFactor } from './combustion';
import type { ThermalDef } from './defs';

const KELVIN = 273.15;
/** EGT at the peak (stoichiometric) versus load: 430 C + 390 C * sqrt(air flow / rated air flow). */
const EGT_PEAK_BASE = 430;
const EGT_PEAK_LOAD = 390;
/** Extra EGT with a single magneto (slower burn, heat released later in the expansion). */
const SINGLE_MAG_EGT_RISE = 45;
const EGT_TIME_CONSTANT = 3;

const C172_THERMAL = C172_ENGINE.thermal;

// The IO-360-L2A (C172_ENGINE.thermal, where each number is explained) under the names this module has always
// exported.
export const HEAD_HEAT_FRACTION = C172_THERMAL.headHeatFraction;
export const HEAD_CAPACITY = C172_THERMAL.headCapacity;
export const HEAD_CONDUCTANCE = C172_THERMAL.headConductance;
export const REFERENCE_MASS_FLUX = C172_THERMAL.referenceMassFlux;
export const OIL_CAPACITY = C172_THERMAL.oilCapacity;
export const OIL_COOLER_CONDUCTANCE = C172_THERMAL.oilCoolerConductance;
export const CRANKCASE_CONDUCTANCE = C172_THERMAL.crankcaseConductance;
export const OIL_PSI_PER_RPM = C172_THERMAL.oilPsiPerRpm;
export const OIL_RELIEF_PSI = C172_THERMAL.oilReliefPsi;
export const WARM_EGT = C172_THERMAL.warm.egt;
export const WARM_CHT = C172_THERMAL.warm.cht;
export const WARM_OIL_TEMP = C172_THERMAL.warm.oilTemp;
export const WARM_OIL_PRESSURE = C172_THERMAL.warm.oilPressure;

/** Liquid cooling: the thermostat opens over this band below and above its nominal temperature, K. */
const THERMOSTAT_BELOW = 6;
const THERMOSTAT_ABOVE = 8;
/** Radiator conductance with the thermostat shut (the small bypass circuit), as a fraction of the open value. */
const THERMOSTAT_LEAK = 0.03;
/** Fraction of the transmitted power a reduction gearbox turns into heat. */
const GEARBOX_LOSS = 0.015;
/** Exhaust gas temperature of a diesel at idle and its rise to full load, C (no mixture to move it). */
const DIESEL_EGT_IDLE = 220;
const DIESEL_EGT_LOAD = 480;

/** Natural convection and radiation from a stopped engine, W/K. */
const HEAD_CONDUCTANCE_STILL = 10;
/** Oil heat from friction and from piston-underside cooling (fraction of indicated power). */
const OIL_FRICTION_FRACTION = 0.5;
const OIL_INDICATED_FRACTION = 0.06;
const OIL_PRESSURE_TIME_CONSTANT = 0.5;
/** Oil temperature at which the pump's psi per rpm applies, C. */
const OIL_REFERENCE_C = 85;

export interface ThermalInput {
  firing: boolean;
  /** Burning equivalence ratio. */
  phi: number;
  /** Air flow relative to rated. */
  load: number;
  rpm: number;
  singleMagneto: boolean;
  /** W. */
  indicatedPower: number;
  frictionPower: number;
  /** Speed of the air through the cowling (freestream plus slipstream), m/s. */
  coolingSpeed: number;
  density: number;
  /** Outside air temperature, K. */
  oat: number;
  /** Charge (intake) temperature, K. */
  chargeTemperature: number;
  /** Cowl flap opening, 0 closed .. 1 open (engines with cowl flaps). Absent: open. */
  cowlFlap?: number;
  /** Power through the reduction gearbox, W (geared engines). */
  shaftPower?: number;
}

/** First-order lag step that stays exact for any dt. */
const relax = (value: number, target: number, dt: number, tau: number): number =>
  target + (value - target) * Math.exp(-dt / tau);

export class EngineThermal {
  /** Degrees C. */
  egt = 15;
  cht = 15;
  oilTemp = 15;
  /** psi. */
  oilPressure = 0;
  /** What the oil-pressure gauge reads, psi: the pressure above, behind the gauge line's lag if the definition has one. */
  oilGaugePsi = 0;
  /** Liquid-cooled engines: coolant and gearbox oil, degrees C (they stay at their reset values on an air-cooled one). */
  coolantTemp = 15;
  gearboxTemp = 15;
  /** Liquid cooling (the definition's `liquid` numbers). */
  readonly liquid: ThermalDef['liquid'];

  constructor(private readonly def: ThermalDef = C172_THERMAL) {
    if (def.cooling === 'liquid' && !def.liquid) throw new Error('EngineThermal: a liquid-cooled engine needs ThermalDef.liquid');
    this.liquid = def.cooling === 'liquid' ? def.liquid : undefined;
  }

  update(dt: number, t: ThermalInput): void {
    if (this.liquid) {
      this.updateLiquid(dt, t, this.liquid);
      return;
    }
    const def = this.def;
    const oatC = t.oat - KELVIN;

    // Exhaust gas temperature.
    let egtTarget = t.chargeTemperature - KELVIN;
    if (t.firing) {
      const peak = EGT_PEAK_BASE + EGT_PEAK_LOAD * Math.sqrt(clamp(t.load, 0, 1.3));
      egtTarget = peak - egtDropFromPeak(t.phi) + (t.singleMagneto ? SINGLE_MAG_EGT_RISE : 0);
    }
    // With no gas flowing the probe cools with the exhaust stack instead of tracking the gas.
    const egtTau = t.rpm > 50 ? EGT_TIME_CONSTANT : 60;
    this.egt = relax(this.egt, t.rpm > 50 ? egtTarget : Math.max(this.cht, oatC), dt, egtTau);

    // Cylinder heads.
    const flux = Math.max(t.density * t.coolingSpeed, 0) / def.referenceMassFlux;
    // A closed cowl flap throttles the cooling air through the baffles (factor 1: no cowl flaps).
    const cowl = t.cowlFlap === undefined ? 1 : lerp(def.cowlFlapClosedFactor, 1, clamp(t.cowlFlap, 0, 1));
    const headConductance = def.headConductance * Math.pow(flux, 0.8) * cowl + HEAD_CONDUCTANCE_STILL;
    const headHeat = t.firing ? def.headHeatFraction * t.indicatedPower * headHeatFactor(t.phi) : 0;
    this.cht = this.integrate(this.cht, headHeat, headConductance, oatC, def.headCapacity, dt);

    // Oil.
    const valve = 0.1 + 0.9 * smoothstep(70, 85, this.oilTemp);
    const oilConductance = def.oilCoolerConductance * Math.pow(flux, 0.8) * valve + def.crankcaseConductance;
    const oilHeat = OIL_FRICTION_FRACTION * t.frictionPower + OIL_INDICATED_FRACTION * t.indicatedPower;
    this.oilTemp = this.integrate(this.oilTemp, oilHeat, oilConductance, oatC, def.oilCapacity, dt);

    // Oil pressure: pump delivery grows with rpm and viscosity (cold oil); the relief valve caps it, though a
    // cold, thick oil still overdrives the relief valve (by up to 25 psi unless the definition says otherwise).
    const viscosity = clamp(Math.exp((OIL_REFERENCE_C - this.oilTemp) / 45), 0.7, 4);
    const relief = def.oilReliefPsi + (def.oilColdOverdrivePsi ?? 25) * clamp((60 - this.oilTemp) / 60, 0, 1);
    const pressure = Math.min(def.oilPsiPerRpm * t.rpm * viscosity, relief);
    this.oilPressure = relax(this.oilPressure, pressure, dt, OIL_PRESSURE_TIME_CONSTANT);
    this.updateGauge(dt);
  }

  /** The gauge follows the pressure through its capillary line, slower the colder (thicker) the oil. */
  private updateGauge(dt: number): void {
    const gauge = this.def.oilGauge;
    if (!gauge) {
      this.oilGaugePsi = this.oilPressure;
      return;
    }
    const cold = clamp((OIL_REFERENCE_C - this.oilTemp) / OIL_REFERENCE_C, 0, 1);
    this.oilGaugePsi = relax(this.oilGaugePsi, this.oilPressure, dt, gauge.time * Math.pow(gauge.coldTime / gauge.time, cold));
  }

  /** update() of a liquid-cooled engine: exhaust gas, coolant, gearbox, oil. */
  private updateLiquid(dt: number, t: ThermalInput, liquid: NonNullable<ThermalDef['liquid']>): void {
    const def = this.def;
    const oatC = t.oat - KELVIN;

    // Exhaust gas temperature follows the load alone.
    const egtTarget = t.firing ? DIESEL_EGT_IDLE + DIESEL_EGT_LOAD * clamp(t.load, 0, 1.2) : t.chargeTemperature - KELVIN;
    const egtTau = t.rpm > 50 ? EGT_TIME_CONSTANT : 60;
    this.egt = relax(this.egt, t.rpm > 50 ? egtTarget : Math.max(this.coolantTemp, oatC), dt, egtTau);

    // Coolant: the radiator carries the heat away once the thermostat has opened, so a warm engine sits a few
    // degrees above the thermostat temperature over a wide range of power and airspeed.
    const flux = Math.max(t.density * t.coolingSpeed, 0) / def.referenceMassFlux;
    const open = THERMOSTAT_LEAK + (1 - THERMOSTAT_LEAK) * smoothstep(liquid.thermostatC - THERMOSTAT_BELOW, liquid.thermostatC + THERMOSTAT_ABOVE, this.coolantTemp);
    const radiator = liquid.radiatorConductance * Math.pow(flux, 0.8) * open + HEAD_CONDUCTANCE_STILL;
    const coolantHeat = t.firing ? def.headHeatFraction * t.indicatedPower : 0;
    this.coolantTemp = this.integrate(this.coolantTemp, coolantHeat, radiator, oatC, liquid.coolantCapacity, dt);
    this.cht = this.coolantTemp;

    // Gearbox oil: its own losses in, its casing (in the cooling air) out.
    const gearboxConductance = liquid.gearboxConductance * (0.3 + 0.7 * Math.pow(flux, 0.8));
    const gearboxHeat = GEARBOX_LOSS * Math.abs(t.shaftPower ?? 0);
    this.gearboxTemp = this.integrate(this.gearboxTemp, gearboxHeat, gearboxConductance, oatC, liquid.gearboxCapacity, dt);

    // Engine oil and its pressure, as on an air-cooled engine.
    const valve = 0.1 + 0.9 * smoothstep(70, 85, this.oilTemp);
    const oilConductance = def.oilCoolerConductance * Math.pow(flux, 0.8) * valve + def.crankcaseConductance;
    const oilHeat = OIL_FRICTION_FRACTION * t.frictionPower + OIL_INDICATED_FRACTION * t.indicatedPower;
    this.oilTemp = this.integrate(this.oilTemp, oilHeat, oilConductance, oatC, def.oilCapacity, dt);
    const viscosity = clamp(Math.exp((OIL_REFERENCE_C - this.oilTemp) / 45), 0.7, 4);
    const relief = def.oilReliefPsi + (def.oilColdOverdrivePsi ?? 25) * clamp((60 - this.oilTemp) / 60, 0, 1);
    const pressure = Math.min(def.oilPsiPerRpm * t.rpm * viscosity, relief);
    this.oilPressure = relax(this.oilPressure, pressure, dt, OIL_PRESSURE_TIME_CONSTANT);
    this.updateGauge(dt);
  }

  /**
   * Exact step of C dT/dt = Q - G (T - Tamb) over dt for constant Q and G (unconditionally stable, so
   * large time steps or a very hot engine in a fast dive cannot overshoot).
   */
  private integrate(temp: number, heat: number, conductance: number, ambient: number, capacity: number, dt: number): number {
    const equilibrium = ambient + heat / conductance;
    return relax(temp, equilibrium, dt, capacity / conductance);
  }

  /** Warm (running) or cold-soaked initial temperatures. */
  reset(running: boolean, oat: number): void {
    const oatC = oat - KELVIN;
    const warm = this.def.warm;
    this.egt = running ? warm.egt : oatC;
    this.cht = running ? warm.cht : oatC;
    this.oilTemp = running ? warm.oilTemp : oatC;
    this.oilPressure = this.oilGaugePsi = running ? warm.oilPressure : 0;
    this.coolantTemp = running ? (warm.coolantTemp ?? warm.cht) : oatC;
    this.gearboxTemp = running ? (warm.gearboxTemp ?? warm.oilTemp) : oatC;
  }
}
