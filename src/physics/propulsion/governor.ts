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
//
// Beta and reverse (PitchControlDef.beta, the PT6 installations): the power lever aft of the flight-idle gate
// (ControlInputs.reverse) moves a beta valve that sets the blade angle directly. Its command runs from the flight
// low-pitch stop to beta.groundFine over the pitch-only travel, then on to beta.reverse; the blades' lower limit is
// then the command, not the stop. In beta the propeller runs below its governed speed (the reversing cam's topping
// governor holds it, turbineEngine.ts), so the flyweights sit in underspeed and the valve has the authority: it
// drives the blades to its command at beta.rate (times the oil authority), finer or coarser, and the primary
// governor's coarse signal is not acted on (a windmilling transient through zero thrust at speed would otherwise
// leave the blades parked where the governor holds its speed); only the overspeed governor (below) and feather
// still take them coarse. Back on the gate the governor has them again, above the stop. Forward of the gate
// the low-pitch stop is fineStop, or beta.lowPitchSchedule against the power lever (PC-12); a stop that rises under
// the blades takes them up at beta.rate rather than in one step.
// Overspeed governor (GovernorDef.overspeedRpm, PC-12): a second flyweight valve with a higher set speed that dumps
// the governor oil, so whatever the primary governor does the blades go coarse above it, proportionally, at most
// at the hub's coarse rate.

import { clamp, interp1 } from '../../core/math';
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
/**
 * Overspeed governor (GovernorDef.overspeedRpm): the speed above its set speed, as a fraction of it, at which its dump
 * valve is fully open and the blades go coarse at the hub's full rate. AGENT choice (no published figure): a
 * dedicated overspeed governor holds the propeller within about 1 % of its setting (TCDS: 1802 rpm, below the 1853 rpm
 * fuel topping governor).
 */
const OVERSPEED_BAND = 0.005;
/** PropellerState.beta: blades this far below the flight low-pitch stop are still under the beta valve, rad (0.05 deg). */
const BETA_WITHIN = (0.05 * Math.PI) / 180;

export type ConstantSpeedDef = Extract<PitchControlDef, { kind: 'constantSpeed' }>;

export class PropGovernor {
  /** Blade angle at the propeller's reference station, rad. */
  pitch: number;
  /** The feather latches are engaged: the blades cannot go coarser. */
  latched = false;
  /** Fine-going blade travel the unfeathering accumulator can still drive, rad (0 without one). */
  accumulator: number;
  /** Power lever aft of the gate, [0, 1] (types with beta; else 0). */
  reverse = 0;
  /** Flight low-pitch stop at the present power lever, rad: fineStop, or beta.lowPitchSchedule. */
  stop: number;
  /** Beta-valve command, rad (the stop while the lever is on the gate). */
  commanded: number;
  private readonly stroke: number;
  private readonly featherAngle: number;

  constructor(readonly def: ConstantSpeedDef) {
    this.pitch = def.fineStop;
    this.stop = this.commanded = def.fineStop;
    this.featherAngle = def.feather ? Math.max(def.feather.angle, def.coarseStop) : def.coarseStop;
    this.stroke = def.feather?.unfeather === 'accumulator' ? this.featherAngle - def.fineStop : 0;
    this.accumulator = this.stroke;
  }

  /**
   * The power lever (types with beta; others keep fineStop and ignore it): `reverse` its travel aft of the gate,
   * `throttle` forward of it (the lowPitchSchedule's input).
   */
  setLevers(reverse: number, throttle: number): void {
    const beta = this.def.beta;
    if (!beta) return;
    const r = clamp(reverse, 0, 1);
    const schedule = beta.lowPitchSchedule;
    this.reverse = r;
    this.stop = schedule ? interp1(schedule.lever, schedule.angle, clamp(throttle, 0, 1)) : this.def.fineStop;
    const pot = beta.pitchOnlyTravel;
    this.commanded = r <= 0 ? this.stop
      : r <= pot ? this.stop + (beta.groundFine - this.stop) * (r / pot)
        : beta.groundFine + (beta.reverse - beta.groundFine) * ((r - pot) / (1 - pot));
  }

  /** Lowest blade angle the hub allows now, rad: min(stop, beta command); fineStop on a hub without beta. */
  get floor(): number {
    return Math.min(this.stop, this.commanded);
  }

  /** The power lever is aft of the gate, or the blades are still finer than the flight stop on the way back to it. */
  get inBeta(): boolean {
    return this.def.beta !== undefined && (this.reverse > 0 || this.pitch < this.stop - BETA_WITHIN);
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

  /** Fine stop, unlatched and charged; or on the feather stop. The power lever on the gate. */
  reset(feathered = false): void {
    if (this.def.beta) this.setLevers(0, 0);
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
    // Aft of the gate the beta valve has the authority (the flyweights' coarse signal goes through it and is not
    // acted on): it drives the blades to its command at its rate, finer or coarser; feather and no oil as above.
    if (def.beta && this.reverse > 0 && !(feather && f) && authority >= DRIFT_BELOW_AUTHORITY) {
      const slew = def.beta.rate * authority;
      rate = clamp((this.commanded - this.pitch) / Math.max(dt, 1e-9), -slew, slew);
    }
    const os = def.governor.overspeedRpm;
    if (os !== undefined && !(feather && f)) {
      // Overspeed governor: flyweights about its own, higher set speed (rate-sensing as the primary's) opening a
      // dump valve: the blades go coarse at the hub's full coarse rate by OVERSPEED_BAND above it (coarse only).
      const omegaOs = os * RPM_TO_RAD_S;
      const over = (omega - omegaOs + (def.governor.dampingTime ?? 0) * accel) / (OVERSPEED_BAND * omegaOs);
      if (over > 0) rate = Math.max(rate, Math.min(over, 1) * (def.failsTo === 'feather' ? def.rateToCoarse : def.rateToCoarse * authority));
    }
    if (this.latched && rate > 0) rate = 0;
    if (def.beta) {
      this.stepBeta(dt, rate, authority, coarsest);
      return;
    }
    // A blade beyond the coarse stop (coming out of feather) is not snapped back to it: it moves at its rate.
    this.pitch = clamp(this.pitch + rate * dt, def.fineStop, Math.max(coarsest, this.pitch));
  }

  /**
   * The blades of a hub with beta over dt, given the governor's rate (rad/s, + coarse): the beta valve limits the
   * fine-going rate to beta.rate x the oil authority and takes blades finer than its command (a rising stop, the
   * lever coming forward) up to it at that rate; the lower limit is the floor (stop or command, whichever is finer).
   */
  private stepBeta(dt: number, rate: number, authority: number, coarsest: number): void {
    const beta = this.def.beta!;
    const floor = this.floor;
    const slew = beta.rate * authority;
    const pitch = this.pitch;
    if (pitch < floor) {
      // Below the floor: the valve takes the blades coarse to it at its rate (no step on the shaft).
      // Coarse-going is the springs' and counterweights' on a feathering hub (no oil needed), the oil's otherwise.
      const next = pitch + Math.max(rate, this.def.failsTo === 'feather' ? beta.rate : slew) * dt;
      this.pitch = Math.min(next, Math.max(floor, pitch));
      return;
    }
    this.pitch = clamp(pitch + rate * dt, floor, Math.max(coarsest, pitch));
  }

  /** Steady (settle) evaluation in beta: the blades sit at the valve's command, the valve's steady state. */
  toCommand(): void {
    this.pitch = this.commanded;
  }
}
