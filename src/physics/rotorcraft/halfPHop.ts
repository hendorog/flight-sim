// The AH-56A "half-P hop" as a SCRIPTED EVENT (ICS configuration only; never AMCS): the contract and an S0 stub.
// Owner after the scaffold: AH. Plan revision 2, section 7.4; owner note O1 ("scripted as an event, not emergent").
//
// Seams placed at S0: rotorcraft.ts adds forcing()'s force and moment to the rotor loads; flightModel.ts sets the crash
// "Main rotor struck the fuselage (half-P hop)" when RotorcraftState.events.halfPHop.strike. The detector reads
// state.controlGyro.mode on every call (never caches the configuration: a restore overwrites it).
import { v3, type Vec3 } from '../../core/math';
import type { ControlInputs } from '../../core/types';
import type { BodyState } from '../interfaces';
import type { RotorcraftDefinition, RotorcraftState } from './definition';
import type { GyroConfigId } from './controlGyro';

export interface HalfPHopDef {
  /** Configurations it can occur in: ['ics']. */
  configs: readonly GyroConfigId[];
  /** Forcing frequency per rotor revolution: 0.5 (0.55P was also reported; P APE-I). */
  perRev: number;
  /**
   * A STIR is two-axis stick motion about the trim point with about 90 deg phase between the longitudinal and lateral
   * components: >= `cycles` (3) cycles above `stirHz` (0.5 Hz) with radius >= `stirRadius` (0.75 in, as m of stick),
   * at >= `minKcas` (150) with collective at or below `maxCollective`. Single-axis reversals need `doubletCycles` (4).
   */
  trigger: { stirHz: number; stirRadius: number; minKcas: number; maxCollective: number; cycles: number; doubletCycles: number };
  /** The cue runs at least this long before growth can reach a strike, s (3). */
  cueSeconds: number;
  growthPerCycle: number; decayPerCycle: number; strikeAmplitude: number;
  /** Roll moment, N m, and vertical force, N, per unit amplitude (onset +/-3 deg roll needs about 94 kN m on
   *  Ixx 10,850 kg m^2; ESTIMATE). */
  rollMomentPerUnit: number; plungeForcePerUnit: number;
}

/** RotorcraftState.events.halfPHop (created in reset for a type with `halfPHop`, never lazily). `phase` is the
 *  continuous (unwrapped) forcing phase, rad: azimuth/2 is 4 pi periodic, so the wrapped azimuth cannot drive it. */
export interface HalfPHopState { active: boolean; amplitude: number; phase: number; stirs: number; strike: boolean }

/** S0 STUB: never fires. AH replaces the body. */
export class HalfPHop {
  private readonly out = { force: v3.zero(), moment: v3.zero() };
  constructor(readonly def: RotorcraftDefinition, readonly state: RotorcraftState) {}
  /** force: InitialConditions.forceHalfPHop (URL halfp=1), the demo/test hook. */
  reset(_force = false): void {
    this.state.events = { ...this.state.events, halfPHop: { active: false, amplitude: 0, phase: 0, stirs: 0, strike: false } };
  }
  /** Body loads about the CG at this RK stage; advances the detector and growth only when dt > 0. */
  forcing(_b: BodyState, _hubAir: Vec3, _density: number, _c: ControlInputs, _azimuth: number, _dt: number): { force: Vec3; moment: Vec3 } {
    return this.out;
  }
}
