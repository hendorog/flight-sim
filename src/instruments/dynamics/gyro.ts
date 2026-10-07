// Gyro rotors and the engine-driven vacuum system that spins the air-driven ones.

import { C172S_INSTRUMENT_SYSTEMS } from '../../aircraft/c172s/panel';
import { clamp, smoothstep } from '../../core/math';
import { lagStep } from './filters';

/** The C172S vacuum system (one engine-driven dry pump), under the names it had here. */
const C172S_VACUUM = C172S_INSTRUMENT_SYSTEMS.vacuum!;
/** Regulated suction in the C172S green arc (POH 4.5 - 5.5 inHg); the regulator is set to 5.0. */
export const SUCTION_REGULATED_INHG = C172S_VACUUM.regulatedInHg;
/** Suction at which an air-driven gyro reaches rated speed (bottom of the green arc). */
export const SUCTION_RATED_INHG = C172S_VACUUM.ratedInHg;
/** Suction of the C172S pump at an engine speed, inHg: about 3.8 at a 600 rpm idle, regulated above ~1300 rpm. */
export const vacuumSuction: (engineRpm: number) => number = C172S_VACUUM.suction;

/**
 * A gyro rotor's speed as a fraction of rated speed. Drive torque spins it up quickly; with no drive
 * only bearing and windage friction slow it, so it coasts for minutes.
 */
export class GyroRotor {
  constructor(
    /** Spin-up time constant, s. */
    private readonly spinUpTau: number,
    /** Coast-down time constant, s. */
    private readonly spinDownTau: number,
    /** Fraction of rated speed, 0..1. */
    public spin = 1,
  ) {}

  /** @param drive Fraction of rated drive available (suction / rated suction, or 1 when powered). */
  step(dt: number, drive: number): void {
    const target = clamp(drive, 0, 1);
    this.spin = lagStep(this.spin, target, dt, target > this.spin ? this.spinUpTau : this.spinDownTau);
  }

  /**
   * How firmly the rotor holds its axis, 0..1. Gyroscopic rigidity is proportional to angular momentum,
   * but the instrument works normally until the rotor is well below rated speed, so this is a smooth
   * threshold rather than a linear scale.
   */
  get rigidity(): number {
    return smoothstep(0.3, 0.72, this.spin);
  }
}
