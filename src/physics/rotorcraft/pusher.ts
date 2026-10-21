// Pusher propeller on the rotor's shared shaft (AH-56A stage 4). Owner: AC. Plan revision 2, section 7.3;
// docs/ah56-compound.md.
//
// Seams placed at S0 in rotorcraft.ts (RC keeps them): compute()'s force and moment are added to the rotor loads
// (between the airframe sum and the drive-torque reaction), `shaftTorque` is added to the rotor shaft torque after the
// hub torque (so the drivetrain and the Nf governor carry the prop), and `h` is added to Rotorcraft.angularMomentum
// before w x H. The prop's inertia enters drivetrainInertia() (definition.ts). flightModel's reset sets
// ControlInputs.propLever = pusherTrimLever(d, airspeed) before the trim Newton.
//
// THE SHAFT REACTION. The engine's torque reaches the airframe in rotorcraft.ts as ONE reaction about the main-rotor shaft
// (rotation x driveTorque), and driveTorque carries the prop's share (shaftTorque) once the drivetrain is steady. The
// prop's share really reacts about the PROP's axis: the gearbox case feels -Q_prop along the prop's spin vector, a
// right-rolling 12.4 kN m for this counter-clockwise (from behind) prop at 3,000 shp, not a 87 kN m yaw. So the moment
// returned here adds the prop-axis reaction and takes the prop's share back out of the mast reaction. In an engine
// failure the mast reaction (driveTorque) falls to zero at once while the prop still draws its torque out of the
// rotor's inertia: the moment left is the -rotation x shaftTorque yaw, the airframe's reaction to the rotor being slowed
// through the gearbox (the left yaw of an engine failure at speed, P ASTA-72 para 68).
import { clamp, interp1, v3, type Vec3 } from '../../core/math';
import type { ControlInputs } from '../../core/types';
import type { BodyState } from '../interfaces';
import type { PropellerDef } from '../propulsion/defs';
import { Propeller } from '../propulsion/propeller';
import { propellerCharacteristicsFor } from '../propulsion/propellerMap';
import type { RotorcraftDefinition, RotorcraftState } from './definition';
import { lookup, type GyroConfigId, type Table1D } from './controlGyro';

export interface PusherDef {
  /** Hamilton Standard, 3 blades, 3.048 m, AF 142, CLi 0.411 (P); analysed through the existing Propeller/BEMT maps, one
   *  slice per pitch node over the blade-angle range (`pitchControl.pitchNodes`, reference station 0.7 R = 42 in). */
  propeller: PropellerDef;
  /** Prop hub, body FRD m (FS 675.7, WL 114.5, BL 0 P; dimensions.ts). */
  hub: Vec3;
  /** Prop rpm / rotor rpm: 6.980 (D from 1717 / 246). */
  ratio: number;
  /** Prop polar inertia, kg m^2 (18.95 = 13.98 slug-ft^2, P). Enters drivetrainInertia() as inertia x ratio^2. */
  inertia: number;
  /** Spin sense about the thrust axis (+x): +1 clockwise viewed from behind (the Propeller maps' sense), -1
   *  counter-clockwise viewed from behind (the AH-56A, P). */
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
  /**
   * Delta-beta (P ASTA-72 paras 66-67): on an engine failure or power chop the blades are cut to `forwardTarget` (+18 deg)
   * from a forward angle above it, or to `reverseTarget` (-8.5 deg AMCS / -7 ICS) from reverse below it, at `rate` rad/s.
   * The model's sensor: the engine's torque at the rotor (RotorcraftState.driveTorque) below `torqueDropFraction` x the
   * prop's rotor-referred torque latches it (the prop would be drawing the rotor down); it releases once the engine
   * carries the prop again (driveTorque above it). It runs on the flight's clock only (the trim holds it off).
   * `armTorque` (prop shaft N m): the sensor arms only while the prop draws more than this, so an engine shutdown with the
   * blades at the hover detent (the prop absorbing about 1,060 N m, 252 shp, static) does not latch it; absent: always armed.
   * The P system senses main-rotor shaft torque AND load factor (ASTA-72 paras 66-67); the load-factor channel is not
   * modelled (docs/ah56-compound.md section 8).
   */
  deltaBeta: { torqueDropFraction: number; forwardTarget: number; reverseTarget: number; rate: number; armTorque?: number };
  /** Main-rotor wake at the prop disc, fraction of the rotor's mean inflow, faded with speed as the tail rotor's
   *  (ESTIMATE). */
  wake: number;
  /** Blade angle (rad) the trim starts from against true airspeed (m/s): pusherTrimLever's schedule. Absent: the hover
   *  detent at every speed. */
  trimSchedule?: Table1D;
  /** The schedule per control-gyro configuration where it differs (the AH-56A's ICS turns the rotor 2.5 % faster than the
   *  AMCS, which moves the high-speed collective by 1-3 deg at the same blade angle). Absent: `trimSchedule`. */
  trimScheduleByConfig?: Partial<Record<GyroConfigId, Table1D>>;
}

/** RotorcraftState.pusher (created in reset for a type with `pusher`). Angles rad, N, N m (prop shaft), rpm. */
export interface PusherState {
  lever: number; beta: number; betaCommand: number; deltaBeta: boolean; rpm: number; thrust: number; torque: number;
}

/** Loads of a component outside the rotor solver, body axes about the CG. */
export interface ExtraLoads {
  force: Vec3;
  /** Includes the thrust-offset moment AND the shaft reaction torque (-Q_prop about the prop axis), and takes the
   *  prop's share back out of rotorcraft.ts's mast reaction (file header). */
  moment: Vec3;
  /** Rotor-referred shaft torque, N m: Q_prop x ratio (the transmission's efficiency applies to the whole drive in
   *  rotorcraft.ts). Added to RotorcraftState.torque. */
  shaftTorque: number;
  /** Prop shaft power, W (diagnostic: Rotorcraft.compoundPower.pusher; negative when windmilling). */
  power: number;
}

/** The pusher's blade angle for a grip position, rad (the definition's table). */
export function pusherLeverBeta(d: PusherDef, lever: number): number {
  return interp1(d.beta.lever, d.beta.angle, clamp(lever, 0, 1));
}
/** The grip position for a blade angle (the table inverted; it is monotonic). */
export function pusherBetaLever(d: PusherDef, beta: number): number {
  return interp1(d.beta.angle, d.beta.lever, beta);
}

/** The pusher on the rotor's shaft: blade-angle states, delta-beta, and its loads at each RK stage. */
export class PusherDrive {
  /** Prop angular momentum, body axes, N m s. */
  readonly h: Vec3 = v3.zero();
  private readonly out: ExtraLoads = { force: v3.zero(), moment: v3.zero(), shaftTorque: 0, power: 0 };
  private readonly prop: Propeller;
  private readonly air = v3.zero();
  private readonly arm = v3.zero();
  private readonly detentLever: number;
  constructor(readonly def: RotorcraftDefinition, readonly state: RotorcraftState) {
    const p = def.pusher!;
    const characteristics = propellerCharacteristicsFor(p.propeller);
    // Tabulate every blade-angle slice now (about a second, once per definition), never inside the frame loop.
    characteristics.prebuild();
    this.prop = new Propeller(characteristics, p.rotation);
    this.detentLever = pusherBetaLever(p, p.beta.hoverDetent);
  }
  reset(running: boolean): void {
    const p = this.def.pusher!;
    this.state.pusher = { lever: this.detentLever, beta: p.beta.hoverDetent, betaCommand: p.beta.hoverDetent,
      deltaBeta: false, rpm: running ? this.state.omega * p.ratio * 30 / Math.PI : 0, thrust: 0, torque: 0 };
    this.h.x = p.rotation * p.inertia * p.ratio * this.state.omega; this.h.y = this.h.z = 0;
  }
  /**
   * Loads at this RK stage; advances the grip, creep, delta-beta and blade-angle states only when dt > 0. omega: rotor
   * rad/s. The creep, the delta-beta and the blade-angle slew run on the flight's clock (b.time > 0); the trim's settle
   * (BodyState.time 0) sets the blades on the grip's angle at once and never creeps (its relaxation steps are not time).
   */
  compute(b: BodyState, air: Vec3, omega: number, density: number, soundSpeed: number, c: ControlInputs,
    dt: number): ExtraLoads {
    const p = this.def.pusher!, s = this.state.pusher!, rs = this.state;
    if (dt > 0) {
      const lever = clamp(c.propLever ?? this.detentLever, 0, 1), clock = b.time > 0;
      if (!clock || Math.abs(lever - s.lever) > 1e-9) { s.lever = lever; s.betaCommand = pusherLeverBeta(p, lever); }
      else if (p.beta.creep && s.betaCommand > p.beta.creep.above)
        s.betaCommand = Math.max(p.beta.creep.above, s.betaCommand - p.beta.creep.rate * dt);
      if (clock) {
        const propShaft = s.torque * p.ratio;
        const armed = s.torque > (p.deltaBeta.armTorque ?? 0);
        if (!s.deltaBeta && armed && propShaft > 0 && rs.driveTorque < p.deltaBeta.torqueDropFraction * propShaft) s.deltaBeta = true;
        else if (s.deltaBeta && rs.driveTorque > 0 && rs.driveTorque >= Math.abs(propShaft)) s.deltaBeta = false;
      }
      const limited = s.deltaBeta ? clamp(s.betaCommand, p.deltaBeta.reverseTarget, p.deltaBeta.forwardTarget) : s.betaCommand;
      if (clock) {
        const rate = limited !== s.betaCommand ? p.deltaBeta.rate : p.beta.rate;
        s.beta += clamp(limited - s.beta, -rate * dt, rate * dt);
      } else s.beta = limited;
    }
    // The hub's velocity through the air (body axes), with the main rotor's wake moving the air down through the disc.
    const arm = this.arm, w = b.angularVelocity, hub = this.air;
    arm.x = p.hub.x - b.cgOffset.x; arm.y = p.hub.y - b.cgOffset.y; arm.z = p.hub.z - b.cgOffset.z;
    hub.x = air.x + w.y * arm.z - w.z * arm.y;
    hub.y = air.y + w.z * arm.x - w.x * arm.z;
    // The wake moves the air DOWN past the disc, so the hub moves UP through it: -wake in z (as wings.ts and the tail
    // rotor's tailAir.z - wakeAtTail).
    hub.z = air.z + w.x * arm.y - w.y * arm.x - p.wake * rs.inflow / (1 + (air.x / 18) ** 2);
    const propOmega = Math.max(0, omega) * p.ratio;
    // Propeller.evaluate takes the AIR's velocity relative to the hub.
    hub.x = -hub.x; hub.y = -hub.y; hub.z = -hub.z;
    const l = this.prop.evaluate(hub, propOmega, density, soundSpeed, s.beta);
    const o = this.out, f = o.force, m = o.moment;
    f.x = l.thrust; f.y = l.inPlaneForce.y; f.z = l.inPlaneForce.z;
    // Thrust and in-plane force at the hub's arm, the disc's own moment (P-factor), the prop-axis reaction, and the
    // prop's share taken out of the mast reaction (file header).
    const shaftTorque = l.torque * p.ratio, tilt = this.def.shaftTilt ?? 0, rot = this.def.rotation;
    m.x = arm.y * f.z - arm.z * f.y - p.rotation * l.torque + rot * shaftTorque * Math.sin(tilt);
    m.y = arm.z * f.x - arm.x * f.z + l.hubMoment.y;
    m.z = arm.x * f.y - arm.y * f.x + l.hubMoment.z - rot * shaftTorque * Math.cos(tilt);
    o.shaftTorque = shaftTorque;
    o.power = l.torque * propOmega;
    this.h.x = p.rotation * p.inertia * propOmega;
    if (dt > 0) { s.rpm = propOmega * 30 / Math.PI; s.thrust = l.thrust; s.torque = l.torque; }
    return o;
  }
}

/**
 * The pusher lever the trim starts from at `airspeed` (m/s TAS): the schedule that puts the trimmed collective on the SoF
 * value (AMCS 13 deg indicated above 80 KCAS; ICS 5-7 deg). `config`: the control-gyro configuration being trimmed (its
 * own schedule when it has one; absent: the definition's default configuration). Without a schedule: the hover detent.
 */
export function pusherTrimLever(d: RotorcraftDefinition, airspeed: number, config?: GyroConfigId): number {
  const p = d.pusher;
  if (!p) return 0;
  const mode = config ?? d.controlGyro?.default;
  const schedule = (mode && p.trimScheduleByConfig?.[mode]) || p.trimSchedule;
  return pusherBetaLever(p, schedule ? lookup(schedule, airspeed) : p.beta.hoverDetent);
}
