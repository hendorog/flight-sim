// Lockheed rigid-rotor control gyro (AH-56A): the contract and an S0 stub. Owner after the scaffold: AG (stage 2).
//
// The gyro is a spinning disc on the rotor shaft whose tilt relative to the shaft IS the swashplate (ICS: the gyro X
// drives the blade pitch links; AMCS: an attitude gyro positioned by the pilot's rate command, through the
// swashplate-to-servo linkage). The pilot applies MOMENTS to it through springs; the rotor feeds hub/feathering
// moments back. Plan revision 2, section 7.2.
//
// Integration rule (binding): the ICS feedback loop gain Lambda*K_hub/H is about 49 rad/s, so gyro tilt (2 states) and
// the flap harmonics (2 states) advance as ONE constant-coefficient 4x4 exponential (or fully implicit) step.
// Sequential/explicit coupling of a gyro step and advanceFlap is unstable (0.2 per step at 240 Hz, 2.5 per step at
// settle's 0.05 s). RC wires the call: when `Rotorcraft.gyro` exists, compute's flap branch calls
// `gyro.advanceCoupled(...)` with RC's `FlapSystem` instead of advanceFlap for the harmonics (the cone keeps
// advanceFlap's pole), and settle's relaxation uses the same call.
//
// Plain data only in the definition types (codemap rule 4: no closures; tables as arrays).
import { v3, type Vec3 } from '../../core/math';
import type { ControlInputs } from '../../core/types';
import { cyclicAngles, type RotorcraftDefinition, type RotorcraftState } from './definition';

export type GyroConfigId = 'amcs' | 'ics';

/** Piecewise-linear table y(x), x ascending; clamped at the ends. */
export interface Table1D { readonly x: readonly number[]; readonly y: readonly number[] }

/** Augmentation in stick units (m of stick travel at the grip) and KCAS breakpoints (P ASTA-72 App C, AMCS-73 App C). */
export interface GyroAugmentation {
  /** ICS pitch desensitizer: stick-to-moment gain multiplier vs KCAS (1 = none, 0.5 = twice the stick per response):
   *  1 at <= 100 kt, 0.5 at >= 170 kt; authority +/-0.757 in. */
  pitchDesensitizer?: { gainByKcas: Table1D; authority: number };
  /** ICS pitch/roll decoupler: fraction of the roll-rate signal fed to pitch, 0 at 110 kt -> 1 at 200 kt; the roll-rate
   *  signal saturates at rollRateLimit (30 deg/s); authority in stick m. */
  decoupler?: { gainByKcas: Table1D; rollRateLimit: number; authority: number };
  /** ICS roll compensator: lateral stick offset vs KCAS, hover to 80 KCAS, m (+/-0.329 in). */
  rollCompensator?: { offsetByKcas: Table1D };
  /** AMCS airspeed-scheduled trim motor: longitudinal trim offset vs KCAS, m of stick. */
  trimSchedule?: { offsetByKcas: Table1D };
  /** AMCS lateral sideslip SAS: gain 0 to 40 kt -> 1 at 60 kt; stick m per rad of sideslip (0.5 in at 12.5 deg); authority m. */
  sideslipSas?: { gainByKcas: Table1D; stickPerRad: number; authority: number };
}

export type GyroFeedback =
  /** ICS: swashplate moment from the blade feathering moments (CR-114362: about tan(sweep) x hub flap moment), the
   *  in-plane moments through the droop, the blade pitching moments, and Coulomb friction (28 ft-lb = 38 N m). Angles rad. */
  | { mode: 'featheringMoment'; sweep: number; droop: number; pitchingMomentGain: number; frictionMoment: number }
  /** AMCS: N m on the gyro per rad of first-harmonic flap (K_R), through springs. ESTIMATE, tuned (plan 7.2). */
  | { mode: 'flapping'; gain: number };

export interface ControlGyroConfig {
  /** Polar inertia, kg m^2, and spin relative to the rotor. ICS 61.0 kg m^2 (45 slug-ft^2), rotor-driven (spinRatio 1),
   *  P/INF. AMCS: H fixed at the ICS value, about 1,570 kg m^2/s (inertia x spinRatio x Omega), ESTIMATE (plan 7.2). */
  inertia: number; spinRatio: number;
  /** Tilt stops relative to the shaft, rad (ICS +/-15 deg P; AMCS up 10.11, down 18.05, right 12.27, left 18.08 deg P). */
  maxTilt: { up: number; down: number; left: number; right: number };
  /** Stick travel centre-to-stop, m (ICS 5.5 / 3.75 in; AMCS 4.95 / 2.9 in, P). */
  stickTravel: { longitudinal: number; lateral: number };
  /** Moment on the gyro at full stick, N m (ICS 278 ft-lb/in x 5.5 in, 337 x 3.75 in, P/D; AMCS fitted to G5). */
  stickMoment: { longitudinal: number; lateral: number };
  /** Net positive spring gyro-to-fuselage, N m/rad (ICS 4100 ft-lb/rad = 5559 P); AMCS negative spring, N m/rad. */
  spring: number; negativeSpring?: number;
  /** Non-rotating (swashplate) damping per axis, N m s/rad (ICS 2 x 44 in-lb/(rad/s) = 9.94 P); rotating damping. */
  damping: number; rotatingDamping?: number;
  /** Azimuth advance of the pilot's moment input (ICS 36.0 deg P) and of the rotor feedback (cant 33 deg P), rad. */
  inputRotation: number; feedbackRotation: number;
  /** Blade cyclic per rad of gyro-minus-shaft tilt (the SSL gain G). ICS 1 (the gyro is the swashplate). AMCS: set
   *  so the labelled stops give >= +/-8 deg of blade cyclic (G about 1 or about 10; AG records the reading, plan 7.2). */
  cyclicPerTilt: number;
  feedback: GyroFeedback;
  augmentation?: GyroAugmentation;
  /** Governed rotor speed of this configuration, fraction of referenceRpm (ICS 1.00, AMCS 0.975 P). */
  nominalRpmFraction: number;
  /** Collective indicator offset for the gauge, rad (AMCS +7 deg D from "13 deg = 6 deg ICS"; ICS 0). */
  collectiveIndicatedOffset: number;
}
export interface ControlGyroDef { default: GyroConfigId; configs: { amcs: ControlGyroConfig; ics: ControlGyroConfig } }

/** RotorcraftState.controlGyro: gyro tilt relative to the shaft, rad, and its rates, rad/s. Created in reset for a type
 *  with `controlGyro`, never lazily. `mode` is read on every call (never cached: a restore overwrites it). */
export interface ControlGyroState { mode: GyroConfigId; pitch: number; roll: number; pitchRate: number; rollRate: number }

/** Row-major 2x2 [m00, m01, m10, m11]. */
export type Mat2 = readonly [number, number, number, number];
/**
 * RC's slow-amplitude first-harmonic flap system for one real step (shaft axes; the rotor's rotation sign folded in;
 * the same harmonics as RotorcraftState: x = [cosine, sine] = [-flapForward, flapRight], rad):
 *   dx/dt = a.x + f + b.(theta - theta0)
 * constant over the step. theta = [pitchCos, pitchSin] is the blade cyclic in flapForcing's convention (rad); theta0
 * is the cyclic f was formed with; b = df/dtheta (exact: the forcing is linear in cyclic). The shaft hub moment
 * [Mx, My] (N m) = hub.x. RC exports `flapSystem(...)` from articulated.ts (stage 1).
 */
export interface FlapSystem { a: Mat2; f: readonly [number, number]; b: Mat2; theta0: readonly [number, number]; hub: Mat2 }
/** First-harmonic blade moments RC returns (only when `controlGyro` exists) for the feathering-moment feedback, shaft
 *  axes: per-blade pitching moment about the feathering axis and in-plane moment, N m, cos/sin of azimuth. */
export interface GyroBladeMoments { pitching: { cos: number; sin: number }; inPlane: { cos: number; sin: number } }

/** Blade cyclic commanded by a gyro tilt, rad, for readers without a ControlGyro instance (swashplate.ts, exteriors).
 *  aft + = disc aft; right + = disc right (cyclicAngles' convention). */
export function gyroBladeCyclic(d: RotorcraftDefinition, g: ControlGyroState): { aft: number; right: number } {
  const k = d.controlGyro?.configs[g.mode].cyclicPerTilt ?? 1;
  return { aft: k * g.pitch, right: k * g.roll };
}

/**
 * S0 STUB (AG replaces the body; the method names and signatures are the contract RC and flightModel call).
 * The stub flies the legacy position-command stick law (cyclicAngles), holds the gyro at zero tilt and throws if the
 * coupled step is reached (no type declares `controlGyro` until AG lands it).
 */
export class ControlGyro {
  /** Gyro angular momentum, body axes, N m s (added to the rotor's H before w x H; plan 3.5). */
  readonly h: Vec3 = v3.zero();
  constructor(readonly def: RotorcraftDefinition, readonly state: RotorcraftState) {}
  /** The active configuration, read from state on every call. */
  config(): ControlGyroConfig {
    const g = this.def.controlGyro!;
    return g.configs[this.state.controlGyro?.mode ?? g.default];
  }
  /** Create RotorcraftState.controlGyro (config: ICS/AMCS selector from InitialConditions.rotorcraftConfig). */
  reset(_running: boolean, config?: GyroConfigId): void {
    this.state.controlGyro = { mode: config ?? this.def.controlGyro!.default, pitch: 0, roll: 0, pitchRate: 0, rollRate: 0 };
  }
  /** Trim seed before settle()'s relaxation (stub: nothing). */
  seed(_c: ControlInputs): void {}
  /** Blade cyclic now, rad (aft, right). Stub: the legacy stick law. */
  cyclic(c: ControlInputs): { aft: number; right: number } {
    return cyclicAngles(this.def, c);
  }
  /**
   * Advance gyro tilt and the flap harmonics together over dt > 0 (one 4x4 exact or implicit step) and return the new
   * flap harmonics. rateShaft: body rates in shaft axes, rad/s. blade: the feathering-moment inputs (ICS).
   */
  advanceCoupled(_dt: number, _c: ControlInputs, _rateShaft: Vec3, _system: FlapSystem,
    _flap: { cosine: number; sine: number }, _blade?: GyroBladeMoments): { cosine: number; sine: number } {
    throw new Error('ControlGyro.advanceCoupled: implemented by AG (plan 7.2)');
  }
}
