// Pusher propeller on the rotor's shared shaft (AH-56A stage 4): the contract and an S0 stub. Owner after the
// scaffold: AC. Plan revision 2, section 7.3.
//
// Seams placed at S0 in rotorcraft.ts (RC keeps them): `compute()`'s force and moment are added to the rotor loads
// (between the airframe sum and the drive-torque reaction), `shaftTorque` is added to the rotor shaft torque after the
// articulated hub torque (so the N2 governor sees the prop), and `h` is added to Rotorcraft.angularMomentum before
// w x H. The prop's inertia enters drivetrainInertia() (definition.ts). flightModel's reset sets
// ControlInputs.propLever = pusherTrimLever(d, airspeed) before the trim Newton.
import { v3, type Vec3 } from '../../core/math';
import type { ControlInputs } from '../../core/types';
import type { BodyState } from '../interfaces';
import type { PropellerDef } from '../propulsion/defs';
import type { RotorcraftDefinition, RotorcraftState } from './definition';

export interface PusherDef {
  /** Hamilton Standard, 3 blades, 3.048 m, AF 142, CLi 0.411 (P); analysed through the existing Propeller/BEMT. */
  propeller: PropellerDef;
  /** Prop hub, body FRD m (FS 675.7, WL 114.5, BL 0 P; dimensions.ts). */
  hub: Vec3;
  /** Prop rpm / rotor rpm: 6.980 (D from 1717 / 246). */
  ratio: number;
  /** Prop polar inertia, kg m^2 (18.95 = 13.98 slug-ft^2, P). Enters drivetrainInertia() as inertia x ratio^2. */
  inertia: number;
  /** Rotation about the thrust axis: CCW viewed from behind (P). */
  rotation: 1 | -1;
  /**
   * Twist grip [0, 1] (ControlInputs.propLever) to blade angle at 0.7 R (42 in station), rad: piecewise-linear table
   * (`lever` ascending, `angle` rad; 2:1 grip deg / beta deg from -10 to -5 deg, 3:1 from 35 to 40 deg; 140 deg of grip
   * for 58 deg of beta ICS, about 130 deg for 52.8 AMCS, P). Detents and snaps, rad: flightMin (-12 deg), hoverDetent
   * (-2.2 deg), autorotation (+8 deg), reverse (-12 deg on the ground). rate: blade-angle slew, rad/s.
   * creep: above `above` rad with the grip untouched beta creeps down at `rate` rad/s (ASTA-72 para 43; ESTIMATE rate).
   */
  beta: { lever: readonly number[]; angle: readonly number[]; flightMin: number; hoverDetent: number; autorotation: number;
    reverse: number; rate: number; creep?: { above: number; rate: number } };
  /** Delta-beta: shaft-torque-drop / load-factor sensing; cut to +18 deg from forward or -8.5 (AMCS) / -7 (ICS) deg from
   *  reverse, rad (P). torqueDropFraction: the trigger; rate: rad/s. */
  deltaBeta: { torqueDropFraction: number; forwardTarget: number; reverseTarget: number; rate: number };
  /** Main-rotor wake at the prop disc, fraction of the rotor's mean inflow, faded with speed (ESTIMATE). */
  wake: number;
}

/** RotorcraftState.pusher (created in reset for a type with `pusher`). Angles rad, N, N m (prop shaft), rpm. */
export interface PusherState {
  lever: number; beta: number; betaCommand: number; deltaBeta: boolean; rpm: number; thrust: number; torque: number;
}

/** Loads of a component outside the rotor solver, body axes about the CG. */
export interface ExtraLoads {
  force: Vec3;
  /** Includes the thrust-offset moment AND the shaft reaction torque (-Q_prop about the prop axis). */
  moment: Vec3;
  /** Rotor-referred shaft torque, N m (Q_prop x ratio / efficiency as AC defines), added to RotorcraftState.torque. */
  shaftTorque: number;
  /** Prop shaft power, W (diagnostic: Rotorcraft.compoundPower.pusher). */
  power: number;
}

/** S0 STUB: no loads, no torque, no angular momentum. AC replaces the body. */
export class PusherDrive {
  /** Prop angular momentum, body axes, N m s. */
  readonly h: Vec3 = v3.zero();
  private readonly out: ExtraLoads = { force: v3.zero(), moment: v3.zero(), shaftTorque: 0, power: 0 };
  constructor(readonly def: RotorcraftDefinition, readonly state: RotorcraftState) {}
  reset(_running: boolean): void {
    this.state.pusher = { lever: 0, beta: this.def.pusher!.beta.hoverDetent, betaCommand: this.def.pusher!.beta.hoverDetent,
      deltaBeta: false, rpm: 0, thrust: 0, torque: 0 };
  }
  /** Loads at this RK stage; advances the blade-angle and delta-beta states only when dt > 0. omega: rotor rad/s. */
  compute(_b: BodyState, _air: Vec3, _omega: number, _density: number, _soundSpeed: number, _c: ControlInputs,
    _dt: number): ExtraLoads {
    return this.out;
  }
}

/** The pusher lever the trim starts from at `airspeed` (m/s TAS): the schedule that puts the trimmed collective on
 *  the SoF value (AMCS 13 deg indicated above 80 KCAS; ICS 5-7 deg). S0 stub: the hover detent's lever (0). */
export function pusherTrimLever(_d: RotorcraftDefinition, _airspeed: number): number {
  return 0;
}
