// Turbocharged common-rail diesel under full-authority digital control (by definition data; the pattern is the
// Austro AE300 of the DA42). There is no throttle plate, no mixture and no magnetos: one power lever asks the
// engine control unit for a LOAD, a fraction of rated POWER, and the ECU injects the fuel that delivers it at
// whatever speed the propeller is governed to (it schedules that speed as well, below the rated speed everywhere
// except at 100 %). So the law demands power, not torque: a torque law would deliver 84 % at the 92 % setting.
//
// Each step:
//   1. load = loadVsLever(power lever); demanded shaft power = load x rated power;
//   2. demanded crank torque = that power / crank speed (not below the idle speed);
//   3. limited to the full-load torque at this speed, reduced above the critical altitude with the density;
//   4. lagged by the turbocharger (torqueLag) into the DELIVERED torque;
//   5. below the idle speed the idle governor adds torque;
//   6. fuel flow = delivered power x specific consumption at the delivered load, and never less than idling
//      takes.
// The demand is BRAKE torque: the ECU injects for it on top of the engine's own friction and accessory load.
// With the lever closed above the idle speed it injects (almost) nothing, as on any diesel on the overrun: the
// propeller, sent to its fine stop by a speed schedule it cannot meet, then turns the engine against its
// friction and brakes the aircraft. The friction make-up fades in over the first few per cent of load.
//
// The engine fires only while the ENGINE MASTER is on, its ECU has power (the bus, its own alternator if the
// definition says so, or the backup battery for backupSeconds), fuel arrives, the crank turns faster than
// minFiringRpm, and, on a cold engine, the glow plugs have had their time. With the master on and the fuel
// gone the ECU stays alive: such an engine is failed, not secured, and its propeller windmills.

import { clamp, interp1, smoothstep } from '../../core/math';
import type { EngineDef, FadecDef, IgnitionDef } from './defs';
import type { EngineCore, EngineInput } from './engine';

const R_AIR = 287.05;
const RPM_PER_RAD_S = 60 / (2 * Math.PI);
/** Sea-level ISA density, and the ISA troposphere: temperature, lapse rate and the density exponent. */
const SEA_LEVEL_DENSITY = 1.225;
const ISA_T0 = 288.15;
const ISA_LAPSE = 0.0065;
const ISA_DENSITY_EXPONENT = 4.25588;
/** Oil temperature at which the cold-friction factor has faded out, C. */
const HOT_OIL_C = 70;
/** The compression loss at cranking speed fades out by this crank speed, rpm. */
const COMPRESSION_LOSS_FADE_RPM = 400;
/** Idle governor: it reaches the full-load torque when the crank is this fraction of the idle speed slow. */
const IDLE_DROOP = 0.08;
/** Load demand below which the ECU makes up less and less of the engine's own losses (none with the lever closed). */
const OVERRUN_BELOW_LOAD = 0.05;
/** Fraction of the demanded fuel below which the injection no longer sustains combustion. */
const STARVED_BELOW = 0.25;
/** Intake-air heating by the charge cooler's residual and the manifold, K (for the charge temperature reported). */
const CHARGE_HEATING = 25;
/** Time to recharge the ECU backup battery from empty, as a multiple of the time it lasts (da42.md: charged from the aircraft system). */
const BACKUP_RECHARGE = 1;

/** Columns of a [x, y] table as two arrays (the tables are a few rows: built once). */
function columns(table: readonly (readonly [number, number])[]): [number[], number[]] {
  return [table.map((row) => row[0]), table.map((row) => row[1])];
}

function compressionIgnition(def: IgnitionDef): Extract<IgnitionDef, { kind: 'compression' }> {
  if (def.kind !== 'compression') throw new Error('DieselEngine: a diesel has compression ignition');
  return def;
}

export class DieselEngine implements EngineCore {
  // Results of the last breathe()/burn() pair.
  fuelDemand = 0;
  readonly phi = 0;
  firing = false;
  indicatedTorque = 0;
  lossTorque = 0;
  frictionTorque = 0;
  readonly carbIce = 0;
  manifoldPressure = 101325;
  chargeTemperature = ISA_T0 + CHARGE_HEATING;

  /** Brake torque the ECU is delivering at the crank, N*m: the demand behind the turbocharger's lag. A fast state. */
  deliveredTorque = 0;
  /** Seconds of the ECU backup battery used so far. */
  backupUsed = 0;
  /** Seconds of glow-plug pre-heat done. */
  glowSeconds = 0;
  /** The ECU has power (false with the ENGINE MASTER off). */
  ecuPowered = false;
  /** The glow plugs are heating (the GLOW advisory). */
  glowing = false;

  private readonly fadec: FadecDef;
  private readonly ratedPower: number;
  private readonly omegaIdle: number;
  private readonly minFiringRpm: number;
  private readonly glow: Extract<IgnitionDef, { kind: 'compression' }>['glow'];
  private readonly mepToTorque: number;
  private readonly ramRecovery: number;
  private readonly alternateRise: number;
  private readonly alternatePressureLoss: number;
  /** Density ratio at the critical altitude: the full-load torque is held up to it. */
  private readonly criticalDensityRatio: number;
  private readonly loadX: number[];
  private readonly loadY: number[];
  private readonly torqueX: number[];
  private readonly torqueY: number[];
  private readonly bsfcX: number[];
  private readonly bsfcY: number[];
  /** The ECU wants the engine to fire (set by breathe, read by burn). */
  private commanded = false;
  /** Fraction of the engine's own losses the ECU makes up (0 on the overrun, 1 from a few per cent of load). */
  private makeUp = 1;
  private power = 0;

  constructor(readonly def: EngineDef) {
    if (def.kind !== 'dieselFadec' || !def.fadec) throw new Error(`${def.name}: DieselEngine is a FADEC diesel (kind 'dieselFadec' with fadec schedules)`);
    const fadec = def.fadec;
    const ignition = compressionIgnition(def.ignition);
    this.fadec = fadec;
    this.ratedPower = def.ratedPower;
    this.omegaIdle = ((fadec.idleRpm ?? def.idleRpm) * 2 * Math.PI) / 60;
    this.minFiringRpm = ignition.minFiringRpm;
    this.glow = ignition.glow;
    this.mepToTorque = def.displacement / (4 * Math.PI);
    this.ramRecovery = def.induction.ramRecovery;
    this.alternateRise = def.induction.alternateAir?.heatRise ?? 0;
    this.alternatePressureLoss = def.induction.alternateAir?.pressureLoss ?? 0;
    this.criticalDensityRatio = Math.pow(1 - (ISA_LAPSE * fadec.criticalAltitude) / ISA_T0, ISA_DENSITY_EXPONENT);
    [this.loadX, this.loadY] = columns(fadec.loadVsLever);
    [this.torqueX, this.torqueY] = columns(fadec.fullLoadTorque);
    [this.bsfcX, this.bsfcY] = columns(fadec.bsfcVsLoad);
  }

  /** Delivered shaft power relative to rated (the LOAD figure as a fraction; the thermal model's load). */
  get load(): number {
    return this.power / this.ratedPower;
  }

  /** Largest brake torque available at crank speed `rpm` in air of density ratio `sigma` (the ECU's limit), N*m. */
  fullLoadTorque(rpm: number, sigma: number): number {
    return interp1(this.torqueX, this.torqueY, rpm) * Math.min(1, sigma / this.criticalDensityRatio);
  }

  breathe(input: EngineInput): void {
    const fadec = this.fadec;
    const dt = input.steady ? 0 : (input.dt ?? 0);
    const omega = input.omega;
    const rpm = omega * RPM_PER_RAD_S;

    // ECU supply: the bus, the engine's own alternator, or the backup battery while it lasts.
    const master = input.engineMaster !== false;
    const busUp = (input.busVoltage ?? Infinity) >= fadec.minBusVolts;
    const supplied = busUp || (fadec.alternatorFed === true && input.alternatorLive === true);
    if (master && !supplied) this.backupUsed = Math.min(this.backupUsed + dt, fadec.backupSeconds);
    // The backup battery is charged from the bus: back to full in BACKUP_RECHARGE x the time it lasts.
    else if (busUp && this.backupUsed > 0) this.backupUsed = Math.max(0, this.backupUsed - dt / BACKUP_RECHARGE);
    this.ecuPowered = master && (supplied || this.backupUsed < fadec.backupSeconds);

    // Glow plugs: automatic on a cold engine, for the pre-heat time, from when the ECU comes alive.
    const cold = (input.coolantTemperature ?? Infinity) < this.glow.neededBelowC;
    if (!this.ecuPowered) this.glowSeconds = 0;
    this.glowing = this.ecuPowered && cold && this.glowSeconds < this.glow.preheatSeconds;
    if (this.glowing) this.glowSeconds += dt;
    const glowDone = !cold || this.glowSeconds >= this.glow.preheatSeconds;

    // Air the turbocharger breathes: ram recovered, alternate air warm and at a loss.
    let inletTemp = input.ambientTemperature;
    let p0 = input.ambientPressure + input.ramPressure;
    if (input.alternateAir) {
      inletTemp += this.alternateRise;
      p0 = input.ambientPressure * (1 - this.alternatePressureLoss);
    }
    const sigma = p0 / (R_AIR * inletTemp) / SEA_LEVEL_DENSITY;
    this.manifoldPressure = p0;
    this.chargeTemperature = inletTemp + CHARGE_HEATING;

    // 1-3, 5: the brake torque the ECU asks for.
    const limit = this.fullLoadTorque(rpm, sigma);
    const load = clamp(interp1(this.loadX, this.loadY, clamp(input.throttle, 0, 1)), 0, 1);
    let demand = (load * this.ratedPower) / Math.max(omega, this.omegaIdle);
    this.makeUp = clamp(load / OVERRUN_BELOW_LOAD, 0, 1);
    if (omega < this.omegaIdle) demand += (limit * (this.omegaIdle - omega)) / (IDLE_DROOP * this.omegaIdle);
    this.commanded = this.ecuPowered && glowDone && rpm >= this.minFiringRpm;
    demand = this.commanded ? Math.min(demand, limit) : 0;

    // 4: the turbocharger's lag. In a quasi-steady evaluation the delivered torque IS the demand.
    if (input.steady || !this.commanded) this.deliveredTorque = demand;
    else if (dt > 0) this.deliveredTorque += (demand - this.deliveredTorque) * (1 - Math.exp(-dt / fadec.torqueLag));
    if (this.deliveredTorque > limit) this.deliveredTorque = limit;

    // Friction and motoring losses (they are needed for the fuel the idle takes).
    const n = rpm / 1000;
    const fm = this.def.fmep;
    const coldFriction = 1 + (this.def.coldFrictionFactor - 1) * clamp((HOT_OIL_C - input.oilTemperature) / HOT_OIL_C, 0, 1);
    this.frictionTorque = (fm[0] + fm[1] * n + fm[2] * n * n) * coldFriction * this.mepToTorque;
    const compression = this.def.compressionLossTorque * (1 - smoothstep(0, COMPRESSION_LOSS_FADE_RPM, rpm));
    this.lossTorque = this.frictionTorque + compression + input.accessoryPower / Math.max(omega, 20);

    // 6: fuel for the delivered power at the specific consumption of that load; never less than idling takes
    // (the pilot quantity that keeps the engine alight on the overrun).
    this.power = this.deliveredTorque * omega;
    const bsfc = interp1(this.bsfcX, this.bsfcY, this.power / this.ratedPower);
    this.fuelDemand = this.commanded ? Math.max(this.power * bsfc, this.frictionTorque * this.omegaIdle * this.bsfcY[0]) : 0;
  }

  burn(input: EngineInput, fuelDelivered: number): void {
    // Less fuel than asked for gives proportionally less torque; too little and the engine stops firing.
    const supply = this.fuelDemand > 0 ? Math.min(1, fuelDelivered / this.fuelDemand) : 0;
    this.firing = this.commanded && supply > STARVED_BELOW;
    if (!this.firing) {
      this.indicatedTorque = 0;
      this.power = 0;
      this.deliveredTorque = 0;
      return;
    }
    // The ECU closes the loop on shaft torque: gas torque = the delivered brake torque plus the losses it makes up.
    this.indicatedTorque = Math.max(0, this.deliveredTorque * supply + this.lossTorque * this.makeUp);
    this.power = (this.indicatedTorque - this.lossTorque) * input.omega;
  }

  reset(ambientPressure: number, ambientTemp: number): void {
    this.manifoldPressure = ambientPressure;
    this.chargeTemperature = ambientTemp + CHARGE_HEATING;
    this.fuelDemand = this.indicatedTorque = this.lossTorque = this.frictionTorque = 0;
    this.deliveredTorque = this.power = 0;
    this.firing = this.commanded = false;
    this.backupUsed = 0;
    this.glowSeconds = 0;
    this.ecuPowered = this.glowing = false;
  }
}
