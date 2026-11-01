// The landing gear and ground-contact description of one aircraft type, as LandingGear consumes it: three
// wheels (nose, left main, right main), the airframe points that must not touch the ground, the propeller
// discs, and for a retractable type the retraction system. A config holds spring objects and damping closures
// (c172Gear.ts C172_GEAR for the Cessna 172S), so it is not plain data.

import type { Vec3 } from '../../core/math';
import type { WheelState } from '../../core/types';
import type { AirframeItem, DamageSeverity } from '../damage';
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
  /**
   * With GearConfig.damage: the airframe item a contact at landing energy damages (no crash). Absent: the contact
   * stays a crash ("Aircraft flipped over"). Ignored without GearConfig.damage.
   */
  item?: AirframeItem;
  /**
   * With `item`: what the contact does and says. Absent: by item (wingtip and tail 'damage', nose and belly
   * 'disabling'); a contact within `tolerance` is an 'inspection' scrape.
   */
  damage?: { severity: DamageSeverity; text: string };
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
  warning: {
    throttleBelow?: number; flapsAtOrBeyond?: number; leverUpOnGround: boolean;
    /**
     * PC-12 (47E): the throttle rule applies only below this IAS, kt (horn below 130 KIAS with the PCL at idle).
     * Absent: at any speed (every type before the PC-12). Declared at the scaffold; the PC-12 package implements it.
     */
    kiasBelow?: number;
  };
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
  /**
   * Which toe brake acts on this wheel; brake torque at full pedal, N m; axial leg force beyond which the gear fails
   * and the flight ends, N (ignored with GearConfig.damage, whose legs carry their own limits).
   */
  brake: 'left' | 'right' | null; maxBrakeTorque: number; limitLoad: number;
  /** Contact point with the leg stowed (for partial-extension contact tests and the render). Retractable legs only. */
  stowed?: Vec3;
  /** The leg's name in crash messages ("<label> gear collapsed"). Absent: Nose / Left main / Right main by the slot (a
   *  tail wheel in the "nose" slot, AH-56A, says "Tail"). */
  label?: string;
}

/**
 * Damage limits of one leg (GearDamageConfig). Loads are AXIAL leg loads, N, set by drops of the type at MTOW
 * (tests/gear/damage.test.ts), not scaled with weight: a lighter aircraft loads its legs less by itself.
 */
export interface LegDamageConfig {
  /** 'spring': steel tube or leaf, takes a permanent set; 'oleo': air/oil strut, bottoms. */
  kind: 'spring' | 'oleo';
  /** First "hard landing: inspection required" note: the load of a drop at the type's limit descent velocity. */
  hardLoad: number;
  /**
   * Spring: permanent set begins ('bent'). Oleo: the stroke is used up and the load goes into the structure
   * ('bottomed': trunnion, drag link, firewall or engine mount damage); a strut at the end of its stroke counts too.
   */
  yieldLoad: number;
  /** The leg fractures or folds ('collapsed'): it carries nothing more. */
  ultimateLoad: number;
  /** Oleo: once bottomed, the leg folds above this on any LATER contact. Absent: ultimateLoad. */
  bottomedUltimate?: number;
  /** Spring: permanent set reached at the ultimate load (linear from the yield load), m. Absent: 0.04. */
  maxSet?: number;
  /** Spring: toe-out per metre of set, rad/m (the bent leg makes the aircraft pull). Absent: 0.9 (0.5 deg/cm). */
  toePerSet?: number;
  /** WheelState.compression a collapsed leg reports, so the gear renderer draws it folded, m. */
  collapsedCompression: number;
  /** Text and airframe item of the yield damage (nose leg: the firewall). Absent: "<Leg> gear bent / bottomed". */
  yield?: { text: string; item?: AirframeItem };
}

/**
 * Landing damage instead of a crash (physics/damage.ts). Absent on a GearConfig: every overload and airframe
 * contact is a crash, as before (AH-56A and the rotorcraft).
 */
export interface GearDamageConfig {
  /** Nose (or tail wheel), left main, right main. */
  legs: readonly [LegDamageConfig, LegDamageConfig, LegDamageConfig];
  /**
   * A propeller strike digs in (the engine stops) when the disc stays in the ground longer than this (summed over
   * the strikes), s, when it goes deeper than `propDigDepth`, m, when the shaft power is above `propDigPower`
   * (fraction of rated), with a collapsed leg or with the gear up. Otherwise it is a tip strike and the engine runs
   * on. Absent: 0.12 s, 0.04 m, 0.4.
   */
  propDigTime?: number;
  propDigDepth?: number;
  propDigPower?: number;
  /** Event text of a propeller strike that stops the propeller. Absent: "Propeller strike: engine stopped". */
  propStopText?: string;
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
  /** Landing damage limits. Absent: every gear overload or airframe contact is a crash (see GearDamageConfig). */
  damage?: GearDamageConfig;
}
