// Electrical system of one bus: battery, one alternator with its voltage regulator per engine that drives one,
// the bus loads selected by the switches, and a starter motor per engine (by default the C172S: 28 V, 24 V
// lead-acid battery, one 60 A alternator).
//
// Each step the bus voltage is found by nodal balance (a monotonic function of V, solved by bisection):
//   battery (OCV - V) / R  +  alternators  =  loads (conductances)  +  starters (V - k omega) / Ra
// Alternators in parallel on one bus share the load through their regulators' droop: equal machines carry equal
// currents, and one alone carries everything up to its rating.
// The starter is a series-wound DC motor through a reduction gear and an overrunning clutch, modelled at the
// crankshaft as torque = k I^2 with back-EMF k I omega; parameters give ~200 A and ~200 rpm while cranking a
// cold engine, which is typical of a Sky-Tec/Prestolite starter on an IO-360.

import { clamp, smoothstep } from '../../core/math';
import { engineControl, type ControlInputs } from '../../core/types';
import { C172_ENGINE, C172_POWERPLANT } from './c172Powerplant';
import type { ElectricalDef, EngineDef } from './defs';

const C172_ELECTRICAL = C172_POWERPLANT.electrical;
const C172_ALTERNATOR = C172_ELECTRICAL.alternators[0];

// The Cessna 172S (C172_POWERPLANT.electrical and C172_ENGINE.starter, where each number is explained) under the
// names this module has always exported.
export const BATTERY_CAPACITY_AH = C172_ELECTRICAL.battery.capacityAh;
export const OCV_EMPTY = C172_ELECTRICAL.battery.ocvEmpty;
export const OCV_SPAN = C172_ELECTRICAL.battery.ocvSpan;
export const R_DISCHARGE = C172_ELECTRICAL.battery.rDischarge;
export const R_CHARGE_BASE = C172_ELECTRICAL.battery.rChargeBase;
export const R_CHARGE_FULL = C172_ELECTRICAL.battery.rChargeFull;
export const REGULATOR_VOLTS = C172_ELECTRICAL.regulatorVolts;
export const ALTERNATOR_MAX_AMPS = C172_ALTERNATOR.maxAmps;
export const ALTERNATOR_EFFICIENCY = C172_ALTERNATOR.efficiency;
export const ALTERNATOR_CUT_IN_RPM = C172_ALTERNATOR.cutInRpm;
export const ALTERNATOR_FULL_RPM = C172_ALTERNATOR.fullRpm;
export const STARTER_K = C172_ENGINE.starter.k;
export const STARTER_R = C172_ENGINE.starter.r;
export const LOAD_AMPS = C172_ELECTRICAL.loads;
export const NOMINAL_VOLTS = C172_ELECTRICAL.nominalVolts;

/** Fraction of the charging current that is stored. */
const CHARGE_EFFICIENCY = 0.9;
/** Regulator droop, V/A: a stiff set point. */
const REGULATOR_DROOP = 0.005;

export interface ElectricalResult {
  busVoltage: number;
  /** State of charge 0..1. */
  batteryCharge: number;
  /** Output of all alternators together, A. */
  alternatorAmps: number;
  /** Battery current, A (+ = discharging). */
  batteryAmps: number;
  /** Current of all starters together, A. */
  starterAmps: number;
  /** Starter torque at the crankshaft of engine 0, N*m. */
  starterTorque: number;
  /** Mechanical power the alternator(s) of engine 0 take from it, W. */
  alternatorShaftPower: number;
  /** Per alternator, in the definition's order: output, A. */
  alternators: number[];
  /** Per engine: starter torque at its crankshaft, N*m, and the mechanical power its alternator(s) take, W. */
  starterTorques: number[];
  alternatorShaftPowers: number[];
}

export class ElectricalSystem {
  charge = 1;
  /** Result of the last step (also returned by step()). */
  readonly state: ElectricalResult;
  /** The hydraulic power pack of a retractable gear is running (set by whoever runs it; its load is `gearPump`). */
  gearPump = false;
  /** Per engine: its glow plugs are heating / its engine control unit is drawing from the bus (set by the powerplant). */
  readonly glowing: boolean[];
  readonly ecuOn: boolean[];

  // Operating point of the current step, used by the branch-current functions during the voltage solve.
  private ocv: number;
  private rCharge: number;
  /** Per alternator: output limit by rating and rpm, A. */
  private readonly alternatorLimit: number[];
  /** Per engine: starter back-EMF per ampere (k omega), ohm, and whether the starter is engaged. */
  private readonly backEmfPerAmp: number[];
  private readonly starterOn: boolean[];

  private readonly battery: ElectricalDef['battery'];
  private readonly rDischarge: number;
  /** Battery capacity, C. */
  private readonly capacity: number;
  private readonly alternators: ElectricalDef['alternators'];
  private readonly regulatorVolts: number;
  private readonly loads: ElectricalDef['loads'];
  private readonly nominalVolts: number;
  private readonly overVolts: number;
  private readonly engineCount: number;
  private readonly starterK: readonly number[];
  private readonly starterR: readonly number[];
  private readonly oneRpm = [0];
  private readonly oneOmega = [0];

  /** `starter`: the starter motor of each engine (or of the one engine), referred to its crankshaft. */
  constructor(def: ElectricalDef = C172_ELECTRICAL, starter: EngineDef['starter'] | readonly EngineDef['starter'][] = C172_ENGINE.starter) {
    const starters = 'k' in starter ? [starter] : starter;
    for (const a of def.alternators) if (!(a.engine >= 0 && a.engine < starters.length)) throw new Error(`ElectricalSystem: an alternator is driven by engine ${a.engine} of ${starters.length}`);
    this.battery = def.battery;
    this.rDischarge = def.battery.rDischarge;
    this.capacity = def.battery.capacityAh * 3600;
    this.alternators = def.alternators;
    this.regulatorVolts = def.regulatorVolts;
    // Every consumer the sum names is there: one a type does not have draws nothing.
    this.loads = { master: 0, avionics: 0, nav: 0, beacon: 0, strobe: 0, landing: 0, taxi: 0, panelFull: 0, pitotHeat: 0, fuelPump: 0, ...def.loads };
    this.nominalVolts = def.nominalVolts;
    this.overVolts = def.overVolts;
    this.engineCount = starters.length;
    this.starterK = starters.map((motor) => motor.k);
    this.starterR = starters.map((motor) => motor.r);
    this.ocv = def.battery.ocvEmpty + def.battery.ocvSpan;
    this.rCharge = def.battery.rChargeBase;
    this.alternatorLimit = def.alternators.map(() => 0);
    this.backEmfPerAmp = starters.map(() => 0);
    this.starterOn = starters.map(() => false);
    this.glowing = starters.map(() => false);
    this.ecuOn = starters.map(() => false);
    this.state = {
      busVoltage: 0,
      batteryCharge: 1,
      alternatorAmps: 0,
      batteryAmps: 0,
      starterAmps: 0,
      starterTorque: 0,
      alternatorShaftPower: 0,
      alternators: def.alternators.map(() => 0),
      starterTorques: starters.map(() => 0),
      alternatorShaftPowers: starters.map(() => 0),
    };
  }

  /** Battery current at bus voltage v, A (+ = discharging). */
  private batteryAmps(v: number): number {
    return v < this.ocv ? (this.ocv - v) / this.rDischarge : -(v - this.ocv) / this.rCharge;
  }

  /** Output of alternator `a`: regulated to the set point, current-limited by rating and rpm, never negative. */
  private alternatorAmps(v: number, a: number): number {
    return clamp((this.regulatorVolts - v) / REGULATOR_DROOP, 0, this.alternatorLimit[a]);
  }

  /** Current of the starter of engine `i`, V / (k omega + R) (series motor; it never regenerates, and the clutch overruns). */
  private starterAmps(v: number, i: number): number {
    return this.starterOn[i] ? Math.max(0, v) / (this.backEmfPerAmp[i] + this.starterR[i]) : 0;
  }

  /** Current into the bus node at voltage v, A: battery and alternators in, loads (conductance g) and starters out. */
  private netAmps(v: number, g: number): number {
    let amps = this.batteryAmps(v);
    for (let a = 0; a < this.alternatorLimit.length; a++) amps += this.alternatorAmps(v, a);
    amps -= g * v;
    for (let i = 0; i < this.engineCount; i++) amps -= this.starterAmps(v, i);
    return amps;
  }

  /**
   * Bus load conductance (A/V) from the switch positions. The consumers are looked up by name and summed in
   * this order (the sum is not associative in floating point); a new consumer goes after the last one.
   */
  private loadConductance(c: ControlInputs): number {
    const load = this.loads;
    let amps = load.master;
    if (c.avionics) amps += load.avionics;
    if (c.lights.nav) amps += load.nav;
    if (c.lights.beacon) amps += load.beacon;
    if (c.lights.strobe) amps += load.strobe;
    if (c.lights.landing) amps += load.landing;
    if (c.lights.taxi) amps += load.taxi;
    amps += load.panelFull * clamp(c.lights.panel, 0, 1);
    if (c.pitotHeat) amps += load.pitotHeat;
    if (engineControl(c, 0, 'fuelPump')) amps += load.fuelPump;
    // Consumers a Cessna 172S does not have: the pumps of further engines, the gear's power pack, glow plugs, ECUs.
    for (let i = 1; i < this.engineCount; i++) if (engineControl(c, i, 'fuelPump')) amps += load.fuelPump;
    if (this.gearPump) amps += load.gearPump ?? 0;
    for (let i = 0; i < this.engineCount; i++) {
      if (this.glowing[i]) amps += load.glow ?? 0;
      if (this.ecuOn[i]) amps += load.ecu ?? 0;
    }
    return amps / this.nominalVolts;
  }

  /**
   * Advance by dt with the CRANK speed of each engine (`rpm`, and `omega` in rad/s): one number each for a
   * single-engine aircraft, one per engine otherwise. The returned object is reused.
   */
  step(dt: number, controls: ControlInputs, rpm: number | ArrayLike<number>, omega: number | ArrayLike<number>): ElectricalResult {
    const r = this.state;
    if (typeof rpm === 'number') {
      this.oneRpm[0] = rpm;
      rpm = this.oneRpm;
    }
    if (typeof omega === 'number') {
      this.oneOmega[0] = omega;
      omega = this.oneOmega;
    }
    if (!controls.masterBattery) {
      // The battery contactor is open and the alternator field is fed through the master switch: bus dead.
      r.busVoltage = r.alternatorAmps = r.batteryAmps = r.starterAmps = r.starterTorque = r.alternatorShaftPower = 0;
      r.alternators.fill(0);
      r.starterTorques.fill(0);
      r.alternatorShaftPowers.fill(0);
      r.batteryCharge = this.charge;
      return r;
    }

    const battery = this.battery;
    const alternators = this.alternators;
    this.ocv = battery.ocvEmpty + battery.ocvSpan * this.charge;
    this.rCharge = battery.rChargeBase + battery.rChargeFull * Math.pow(this.charge, 8);
    for (let a = 0; a < alternators.length; a++) {
      const alternator = alternators[a];
      this.alternatorLimit[a] = engineControl(controls, alternator.engine, 'alternator')
        ? alternator.maxAmps * smoothstep(alternator.cutInRpm, alternator.fullRpm, rpm[alternator.engine])
        : 0;
    }
    for (let i = 0; i < this.engineCount; i++) {
      this.backEmfPerAmp[i] = this.starterK[i] * Math.max(omega[i], 0);
      this.starterOn[i] = engineControl(controls, i, 'starter');
    }
    const g = this.loadConductance(controls);

    // The bus cannot rise above the definition's over-voltage threshold: the top of the search.
    let lo = 0;
    let hi = this.overVolts;
    for (let i = 0; i < 40; i++) {
      const v = 0.5 * (lo + hi);
      if (this.netAmps(v, g) > 0) lo = v;
      else hi = v;
    }
    const v = 0.5 * (lo + hi);
    r.busVoltage = v;
    r.batteryAmps = this.batteryAmps(v);
    r.alternatorAmps = 0;
    r.alternatorShaftPowers.fill(0);
    for (let a = 0; a < alternators.length; a++) {
      const amps = this.alternatorAmps(v, a);
      r.alternators[a] = amps;
      r.alternatorAmps += amps;
      r.alternatorShaftPowers[alternators[a].engine] += (v * amps) / alternators[a].efficiency;
    }
    r.starterAmps = 0;
    for (let i = 0; i < this.engineCount; i++) {
      const amps = this.starterAmps(v, i);
      r.starterAmps += amps;
      r.starterTorques[i] = this.starterK[i] * amps * amps;
    }
    r.starterTorque = r.starterTorques[0];
    r.alternatorShaftPower = r.alternatorShaftPowers[0];

    const coulombs = r.batteryAmps > 0 ? r.batteryAmps : r.batteryAmps * CHARGE_EFFICIENCY;
    this.charge = clamp(this.charge - (coulombs * dt) / this.capacity, 0, 1);
    r.batteryCharge = this.charge;
    return r;
  }

  reset(charge = 1): void {
    this.charge = clamp(charge, 0, 1);
  }
}
