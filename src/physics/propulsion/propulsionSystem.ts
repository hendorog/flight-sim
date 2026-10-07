// The powerplant of a single-engine aircraft under the names its users have always called it by: a Powerplant
// (powerplant.ts) with one engine unit, and that unit's engine, propeller, shaft speed and temperatures, the two
// tanks and the bus as members of the system itself. By default the Cessna 172S.

import type { PowerplantResetOptions } from '../interfaces';
import { C172_ENGINE, C172_POWERPLANT } from './c172Powerplant';
import type { PowerplantDef } from './defs';
import { shaftInertia } from './engineUnit';
import type { PistonEngine } from './engine';
import type { EngineThermal } from './engineThermal';
import { Powerplant } from './powerplant';
import type { Propeller } from './propeller';

// The Cessna 172S (C172_POWERPLANT, where each number is explained) under the names this module has always
// exported.
/** Polar moment of inertia of propeller, spinner, crankshaft, rods and flywheel ring gear, kg*m^2. */
export const ROTOR_INERTIA = shaftInertia(C172_POWERPLANT.engines[0]);
export const BREAKAWAY_TORQUE = C172_ENGINE.breakawayTorque;
export const RUNNING_RPM = C172_ENGINE.runningRpm;
export const RAM_RECOVERY = C172_ENGINE.induction.ramRecovery;

export interface PropulsionResetOptions {
  running: boolean;
  /** Usable fuel per tank, kg. */
  fuelLeft: number;
  fuelRight: number;
  /** Initial crank speed, rpm. Defaults to 1000 when running (it settles within a couple of seconds), else 0. */
  rpm?: number;
  /** Outside air temperature for cold-soaked temperatures, K. Defaults to ISA sea level. */
  oat?: number;
  /** Battery state of charge 0..1. Defaults to 1. */
  batteryCharge?: number;
}

export class PropulsionSystem extends Powerplant {
  /** `propeller`: a propeller to use instead of one made from the definition. */
  constructor(propeller?: Propeller, def: PowerplantDef = C172_POWERPLANT) {
    super(def, [propeller]);
  }

  /** The spark engine of the single (a FADEC diesel has none of what its users reach for: use units[0].engine). */
  get engine(): PistonEngine {
    return this.units[0].engine as PistonEngine;
  }

  get propeller(): Propeller {
    return this.units[0].propeller;
  }

  get thermal(): EngineThermal {
    return this.units[0].thermal;
  }

  /** Crank / propeller speed, rad/s. */
  get omega(): number {
    return this.units[0].omega;
  }

  set omega(omega: number) {
    this.units[0].omega = omega;
  }

  get rpm(): number {
    return this.units[0].rpm;
  }

  get fuelLeft(): number {
    return this.fuel.left;
  }

  get fuelRight(): number {
    return this.fuel.right;
  }

  /** Usable capacity of each tank, kg. */
  get fuelCapacityEach(): number {
    return this.tankCapacities[0];
  }

  /** The two-tank form, or the Powerplant's own (which the constructor uses). */
  reset(options: PropulsionResetOptions | PowerplantResetOptions): void {
    if ('tanks' in options) super.reset(options);
    else {
      super.reset({
        running: options.running,
        tanks: [options.fuelLeft, options.fuelRight],
        rpm: options.rpm ?? (options.running ? 1000 : 0),
        oat: options.oat,
        batteryCharge: options.batteryCharge,
      });
    }
  }
}
