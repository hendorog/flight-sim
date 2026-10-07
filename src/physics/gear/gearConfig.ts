// The landing gear and ground-contact description of one aircraft type, as LandingGear consumes it: three
// wheels (nose, left main, right main), the airframe points that must not touch the ground, the propeller
// discs, and for a retractable type the retraction system. A config holds spring objects and damping closures
// (c172Gear.ts C172_GEAR for the Cessna 172S), so it is not plain data.

import type { Vec3 } from '../../core/math';
import type { WheelState } from '../../core/types';
import type { StrutSpring, TyreSpring } from './springs';
import type { SteeringParams, TyreParams } from './tyre';

export interface StructuralPoint {
  position: Vec3;
  /** Crash message when this point hits the ground. */
  message: string;
  /** Normal impact speed a scrape tolerates without being reported as a crash, m/s (0 = any contact). */
  tolerance: number;
  /** Wording for "(<part> first)" in a terrain-impact message. Absent: derived from `message` as today. */
  part?: string;
  /** Sliding friction. Absent: the config's contact friction. */
  friction?: number;
  /** Lower-surface point that takes the weight in a gear-up arrival (belly, nacelle underside). */
  belly?: boolean;
}

export interface PropellerDisc { hub: Vec3; radius: number; message: string; part?: string }

export interface ImpactThresholds { sinkRate: number; speed: number; steepSpeed: number; steepPath: number }

export interface RetractConfig {
  /** Lever to locked, s. */
  extendTime: number; retractTime: number;
  /** Start delay per leg (nose, left, right), s. */
  legDelay?: readonly [number, number, number];
  /** Electro-hydraulic pump: needs this bus voltage to move the gear either way (free fall excepted). */
  minBusVolts: number;
  /** No retraction with weight on a main wheel. */
  squatInhibit: boolean;
  /** false: the gear is held up by pump pressure only and sags down when the bus is dead (see deadBusSagTime). */
  upLocks: boolean;
  /**
   * upLocks false: seconds for the legs to sag from up to down with the bus dead. Absent: emergency.freeFallTime
   * (DA42). Infinity: the pressure stays trapped and nothing moves (PA-34: only a leak drops its gear).
   */
  deadBusSagTime?: number;
  emergency: { freeFallTime: number };
  /**
   * Horn when any leg is not down-and-locked and: the LOWEST throttle / power lever (of any engine, running or
   * not: both aircraft use a lever microswitch, so closing a dead engine's lever sounds it) is below
   * `throttleBelow`, or the flap lever is at or beyond `flapsAtOrBeyond`; or the lever is UP on the ground
   * (`leverUpOnGround`). There is no manifold-pressure rule: the PA-34 sets `throttleBelow` to the lever
   * position that gives 14 inHg at sea level and 2000 rpm.
   */
  warning: { throttleBelow?: number; flapsAtOrBeyond?: number; leverUpOnGround: boolean };
}

export interface WheelConfig {
  name: WheelState['name'];
  /** Tyre contact point with the strut fully extended (gear down), body axes relative to the reference point, m. */
  position: Vec3;
  /** Unit vector (body) along which the contact point moves toward the airframe as the leg compresses. */
  axis: Vec3;
  strut: StrutSpring; tyreSpring: TyreSpring;
  /** Strut + tyre damping force (N, + resists compression) from the strut and total compression rates, m/s. */
  damping(strutRate: number, totalRate: number): number;
  tyre: TyreParams; steering: SteeringParams | null;
  /** Which toe brake acts on this wheel; brake torque at full pedal, N m; axial leg force beyond which the gear fails, N. */
  brake: 'left' | 'right' | null; maxBrakeTorque: number; limitLoad: number;
  /** Contact point with the leg stowed (for partial-extension contact tests and the render). Retractable legs only. */
  stowed?: Vec3;
}

export interface GearConfig {
  /** Order: nose, left main, right main (matches AircraftState.wheels). */
  wheels: readonly [WheelConfig, WheelConfig, WheelConfig];
  structure: readonly StructuralPoint[];
  /** One disc per propeller. */
  propellers: readonly PropellerDisc[];
  /** Default: the present IMPACT constant (C172S). Rule of thumb: speed 1.6 Vs0, steepSpeed 1.4 Vs0. */
  impact?: ImpactThresholds;
  /** Default: STRUCTURE_CONTACT. */
  contact?: { stiffness: number; damping: number; friction: number };
  /** Absent = fixed gear. */
  retract?: RetractConfig;
}
