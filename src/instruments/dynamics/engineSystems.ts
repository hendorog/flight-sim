// Engine and systems indications: tachometer with hour meter, electrically driven gauge needles, the
// ammeter's battery-current estimate and the annunciator logic.

import { C172S_ANNUNCIATOR_THRESHOLDS, C172S_INSTRUMENT_SYSTEMS } from '../../aircraft/c172s/panel';
import type { ControlInputs } from '../../core/types';
import { lagStep } from './filters';

/** 100LL avgas, kg per US gallon (6.0 lb/gal): the C172S's. */
export const KG_PER_GAL = C172S_INSTRUMENT_SYSTEMS.fuel.kgPerGal;
/** DC bus voltage below which electric gauges and lamps are dead: the C172S's 28 V system. */
export const BUS_DEAD_VOLTS = C172S_INSTRUMENT_SYSTEMS.busDeadVolts;

/**
 * Mechanical tachometer (flexible drive from the engine, needs no electrical power). The built-in hour
 * meter advances at a rate proportional to rpm and is calibrated so one hour at `hourRpm` (a typical
 * cruise; 2400 rpm on the C172S) records one tach hour.
 */
export class Tachometer {
  static readonly HOUR_RPM = C172S_INSTRUMENT_SYSTEMS.tachHourRpm;
  rpm = 0;

  constructor(
    public hours = 2847.3,
    private readonly hourRpm = Tachometer.HOUR_RPM,
  ) {}

  step(dt: number, engineRpm: number): void {
    this.rpm = lagStep(this.rpm, Math.max(0, engineRpm), dt, 0.15);
    this.hours += (dt * this.rpm) / this.hourRpm / 3600;
  }
}

/**
 * An electrically driven indicator (fuel quantity, oil temperature/pressure, EGT, fuel flow): the
 * needle follows its signal with a damping time constant while the bus is powered and falls back to its
 * rest stop when power is lost.
 */
export class ElectricNeedle {
  constructor(
    private readonly tau: number,
    private readonly restValue: number,
    public value = restValue,
  ) {}

  step(dt: number, signal: number, powered: boolean): number {
    this.value = lagStep(this.value, powered ? signal : this.restValue, dt, powered ? this.tau : 1.0);
    return this.value;
  }
}

/**
 * Steady DC loads of the C172S electrical equipment, amps at 28 V (typical figures from equipment
 * data: strobe average, halogen landing/taxi lamps, heated pitot probe).
 */
export function electricalLoadAmps(c: ControlInputs, avionicsPowered: boolean): number {
  if (!c.masterBattery) return 0;
  let a = 2.0; // instruments, annunciators, engine gauges, turn coordinator
  if (avionicsPowered) a += 6.5;
  if (c.fuelPump) a += 2.5;
  if (c.lights.beacon) a += 2.0;
  if (c.lights.strobe) a += 3.5;
  if (c.lights.nav) a += 2.4;
  if (c.lights.landing) a += 7.5;
  if (c.lights.taxi) a += 6.5;
  if (c.pitotHeat) a += 10;
  a += 1.5 * c.lights.panel;
  return a;
}

/**
 * Battery ammeter (the C172S ammeter reads battery charge/discharge current, centre zero). The alternator
 * supplies the loads first; whatever is left charges the battery. With the starter engaged the battery
 * discharge pegs the needle.
 */
export function batteryCurrentAmps(c: ControlInputs, alternatorAmps: number, avionicsPowered: boolean): number {
  if (!c.masterBattery) return 0;
  if (c.starter) return -80;
  return alternatorAmps - electricalLoadAmps(c, avionicsPowered);
}

export interface AnnunciatorInputs {
  busVolts: number;
  fuelLeftGal: number;
  fuelRightGal: number;
  oilPressurePsi: number;
  suctionInHg: number;
}

export interface Annunciators {
  lowFuelLeft: boolean;
  lowFuelRight: boolean;
  oilPress: boolean;
  lowVolts: boolean;
  vacuum: boolean;
}

/** C172S annunciator thresholds: usable fuel in a tank, US gal; oil pressure, psi; bus voltage, V; suction, inHg. */
export const LOW_FUEL_GAL = C172S_ANNUNCIATOR_THRESHOLDS.lowFuelGal;
export const LOW_OIL_PRESSURE_PSI = C172S_ANNUNCIATOR_THRESHOLDS.oilPressurePsi;
export const LOW_VOLTS = C172S_ANNUNCIATOR_THRESHOLDS.lowVolts;
export const LOW_VACUUM_INHG = C172S_ANNUNCIATOR_THRESHOLDS.vacuumInHg;

/**
 * The C172S annunciator logic (POH section 7): LOW FUEL below 5 gal in a tank, OIL PRESS below 20 psi,
 * LOW VOLTS below 24.5 V, VAC below 3.0 inHg. The lamps need bus power. InstrumentSet lights its lamps from
 * the systems definition; this is the same rule for callers that hold the five inputs.
 */
export function evaluateAnnunciators(i: AnnunciatorInputs, out: Annunciators): Annunciators {
  const lit = i.busVolts > BUS_DEAD_VOLTS;
  out.lowFuelLeft = lit && i.fuelLeftGal < LOW_FUEL_GAL;
  out.lowFuelRight = lit && i.fuelRightGal < LOW_FUEL_GAL;
  out.oilPress = lit && i.oilPressurePsi < LOW_OIL_PRESSURE_PSI;
  out.lowVolts = lit && i.busVolts < LOW_VOLTS;
  out.vacuum = lit && i.suctionInHg < LOW_VACUUM_INHG;
  return out;
}
