// Constant-speed propeller hub: the blade angle, the governor that moves it, the feather stop with its
// centrifugal latches, and the two ways back out of feather.
//
// The governor is a flyweight valve: while the propeller turns faster than the speed the lever asks for it lets
// the blades go coarser, while slower, finer, at a rate proportional to the speed error up to what the hub can
// do. The flyweights also sense the shaft's acceleration (governor.dampingTime): a propeller speeding up toward
// its set speed is already sent coarser before it gets there, which keeps it from overshooting. On a feathering hub (failsTo 'feather') oil pressure drives the blades FINE against counterweights, a
// spring and an air charge that drive them coarse, so:
//   - the fine-going rate is limited by the oil pressure there is (a slow or stopped engine has little or none);
//   - with no oil pressure at all the blades drift coarse, to feather: an engine that stops in the air feathers
//     itself unless its latches have engaged;
//   - the latches are pins thrown out by a spring when the propeller turns slowly; they engage when it falls
//     below latchRpm with the blades still fine and then hold them from going coarse, which is what keeps a
//     shutdown on the ground from feathering the propeller. Above latchRpm they are flung clear.
// Out of feather: 'starter': cranking the engine builds oil pressure, the blades come fine and the propeller
// starts to windmill; 'accumulator': a stored charge of oil does the same once, as soon as feather is no longer
// selected, and is recharged by the running engine.
// A non-feathering hub (failsTo 'fine') is the mirror image: oil drives the blades coarse.

import { clamp } from '../../core/math';
import { PROP_FEATHER_GATE } from '../../core/types';
import type { PitchControlDef } from './defs';

const RPM_TO_RAD_S = (2 * Math.PI) / 60;
/** Oil pressure at which the governor has its full rate, psi. */
const FULL_AUTHORITY_PSI = 25;
/**
 * Oil authority (0 .. 1) below which the springs and counterweights start to win; at none they move the blades at
 * the full rate. It is small: the pressure of an engine being cranked (2 to 3 psi) must be enough to bring the
 * blades out of feather, which is how a propeller without an accumulator is unfeathered.
 */
const DRIFT_BELOW_AUTHORITY = 0.05;
/** PropellerState.feathered: the blades are within this of the feather stop, rad. */
const FEATHERED_WITHIN = (2 * Math.PI) / 180;

export type ConstantSpeedDef = Extract<PitchControlDef, { kind: 'constantSpeed' }>;

export class PropGovernor {
  /** Blade angle at the propeller's reference station, rad. */
  pitch: number;
  /** The feather latches are engaged: the blades cannot go coarser. */
  latched = false;
  /** Fine-going blade travel the unfeathering accumulator can still drive, rad (0 without one). */
  accumulator: number;
  private readonly stroke: number;
  private readonly featherAngle: number;

  constructor(readonly def: ConstantSpeedDef) {
    this.pitch = def.fineStop;
    this.featherAngle = def.feather ? Math.max(def.feather.angle, def.coarseStop) : def.coarseStop;
    this.stroke = def.feather?.unfeather === 'accumulator' ? this.featherAngle - def.fineStop : 0;
    this.accumulator = this.stroke;
  }

  /** Governed propeller speed for a propeller lever position, rad/s: [PROP_FEATHER_GATE, 1] spans minRpm .. maxRpm. */
  leverSpeed(lever: number): number {
    const g = this.def.governor;
    const t = clamp((lever - PROP_FEATHER_GATE) / (1 - PROP_FEATHER_GATE), 0, 1);
    return (g.minRpm + (g.maxRpm - g.minRpm) * t) * RPM_TO_RAD_S;
  }

  /** The lever position is in the feather range of a hub that can feather. */
  leverFeathers(lever: number): boolean {
    return this.def.feather !== undefined && lever < PROP_FEATHER_GATE;
  }

  /** Blades at (within 2 degrees of) the feather stop. */
  get feathered(): boolean {
    return this.def.feather !== undefined && this.pitch >= this.featherAngle - FEATHERED_WITHIN;
  }

  get accumulatorCharged(): boolean {
    return this.accumulator > 0;
  }

  set accumulatorCharged(charged: boolean) {
    this.accumulator = charged ? this.stroke : 0;
  }

  /** The latch state that goes with propeller speed `omega` (rad/s) and the present blade angle. */
  relatch(omega: number): void {
    const f = this.def.feather;
    this.latched = f !== undefined && omega < f.latchRpm * RPM_TO_RAD_S && this.pitch < f.latchAngle;
  }

  /** Put the blades on the feather stop (a hub that cannot feather: on its coarse stop). */
  toFeather(): void {
    this.pitch = this.featherAngle;
  }

  /** Fine stop, unlatched and charged; or on the feather stop. */
  reset(feathered = false): void {
    this.pitch = feathered && this.def.feather ? this.featherAngle : this.def.fineStop;
    this.latched = false;
    this.accumulator = this.stroke;
  }

  /**
   * Move the blades over dt: propeller speed `omega` and governed speed `omegaSet` (rad/s), whether feather is
   * selected, the oil pressure the governor works with, psi, and the shaft's angular acceleration, rad/s^2.
   */
  step(dt: number, omega: number, omegaSet: number, feather: boolean, oilPsi: number, accel = 0): void {
    const def = this.def;
    const f = def.feather;
    const sensed = def.governor.dampingTime ? omega - omegaSet + def.governor.dampingTime * accel : omega - omegaSet;
    if (f) {
      // Latches: engaged below latchRpm if the blades are still finer than the latch angle, flung clear above it.
      if (omega >= f.latchRpm * RPM_TO_RAD_S) this.latched = false;
      else if (this.pitch < f.latchAngle) this.latched = true;
    }
    let authority = clamp(oilPsi / FULL_AUTHORITY_PSI, 0, 1);
    let rate: number;
    let coarsest = def.coarseStop;
    if (feather && f) {
      // The feathering valve dumps the oil: springs, counterweights and air charge take the blades all the way.
      rate = def.rateToCoarse;
      coarsest = this.featherAngle;
    } else if (def.failsTo === 'feather') {
      const error = def.governor.gain * sensed;
      // The accumulator stands in for the oil pressure a slow engine lacks, for as long as its charge lasts.
      const stored = authority < 1 && this.accumulator > 0;
      const oil = authority;
      if (stored) authority = 1;
      rate = clamp(error, -def.rateToFine * authority, def.rateToCoarse);
      const drift = def.rateToCoarse * clamp(1 - authority / DRIFT_BELOW_AUTHORITY, 0, 1);
      if (drift > 0) {
        rate = Math.min(def.rateToCoarse, Math.max(rate, 0) + drift);
        coarsest = this.featherAngle;
      }
      if (stored && rate < 0 && this.pitch > def.fineStop) this.accumulator = Math.max(0, this.accumulator + rate * dt * (1 - oil));
      else if (oil >= 1) this.accumulator = this.stroke;
    } else {
      // Oil drives these blades coarse; without it the blade's own twisting moment takes them to the fine stop.
      rate = clamp(def.governor.gain * sensed, -def.rateToFine, def.rateToCoarse * authority);
      const drift = def.rateToFine * clamp(1 - authority / DRIFT_BELOW_AUTHORITY, 0, 1);
      if (drift > 0) rate = Math.max(-def.rateToFine, Math.min(rate, 0) - drift);
    }
    if (this.latched && rate > 0) rate = 0;
    // A blade beyond the coarse stop (coming out of feather) is not snapped back to it: it moves at its rate.
    this.pitch = clamp(this.pitch + rate * dt, def.fineStop, Math.max(coarsest, this.pitch));
  }
}
