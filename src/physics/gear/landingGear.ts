// Tricycle landing gear and airframe ground contact.
//
// Each wheel: the extended contact point is projected along its leg axis onto the local terrain plane
// (env.groundElevation / groundNormal, so slopes work) to give the total compression; the strut and tyre
// springs in series (SeriesSpring) and the strut damper give the axial leg force; the in-plane tyre force
// comes from WheelDynamics (transient-slip brush model, wheel spin, brakes, steering).
//
// RK4 COMPATIBILITY. compute() may be called at every Runge-Kutta stage. The leg forces are algebraic in the
// stage state. The stiff internal states (tyre transient slips, wheel spin, steering) are advanced by the
// increase of body.time since the previous call, using that call's kinematics: with RK4 stage times
// t, t+h/2, t+h/2, t+h they advance h/2 at stage 1 and h/2 at stage 3; with a once-per-step integrator they
// advance h per call. body.time must therefore advance with simulated time.
//
// EVENTS. `crash` latches the first crash reason until reset(), with its classification in `crashKind`; an
// overloaded leg also stops carrying load, so the airframe then comes down on its structural contact points.
// A touchdown event stays in the output of every call for one physics step (input.dt) after it is detected,
// so an integrator that reads events from one call per step (e.g. RK stage 0, or its final stage) sees each
// exactly once.
//
// RETRACTABLE GEAR. GearInput.extension gives each leg's position (0 up .. 1 down and locked), constant over a
// sub-step; the retraction system itself is retract.ts. Only a locked leg carries load. A leg caught between
// its stops by the ground collapses ("... gear collapsed (not locked down)"). With no leg down the aircraft
// arrives on its propeller discs and `belly` points: at landing-like energy that is a "Gear-up landing", and
// like every other crash it ends the flight at the first contact.
//
// LANDING DAMAGE (GearConfig.damage, opt-in; absent: everything above, unchanged). Each leg has a hard-landing
// load (an inspection note), a yield load (a spring leg takes a permanent set that lowers its contact point and
// toes the wheel out, so the aircraft pulls; an oleo bottoms and damages the structure behind it) and an
// ultimate load (the leg collapses: it carries nothing and reports full compression so it is drawn folded). An
// airframe point with an `item`, a propeller disc, a leg caught between its stops and a gear-up arrival then
// DAMAGE the aircraft (physics/damage.ts) instead of ending the flight; the airframe points keep their penalty
// contact and scrape friction, so the aircraft slides to a stop on them. Still a crash: a terrain impact (the
// energy test comes first), a point without an item ("flipped over"), and water. Damage is judged on committed
// calls only (GearInput.commit), on the state then, so RK4's provisional stages never write it.

import { G0, type Quat, type Vec3 } from '../../core/math';
import type { WheelState } from '../../core/types';
import { DamageModel, LEG_ITEMS, type AirframeItem, type DamageSeverity, type DamageState, type LegDamage, type LegStatus } from '../damage';
import type { CrashKind, GearInput, GearOutput } from '../interfaces';
import { C172_GEAR } from './c172Gear';
import type { GearConfig, GearDamageConfig, ImpactThresholds, LegDamageConfig, PropellerDisc, StructuralPoint, WheelConfig } from './gearConfig';
import { OleoPneumaticSpring, SeriesSpring, type SeriesSpringPoint } from './springs';
import { STRUCTURE_CONTACT } from './structure';
import { SURFACES, surfaceUndulation } from './surfaces';
import { WheelDynamics, type TyreForce, type WheelContact } from './tyre';

type WheelName = WheelState['name'];

/** A wheel must have been airborne this long for a new contact to count as a touchdown, s. */
const TOUCHDOWN_AIRBORNE_TIME = 0.1;
/** Legs whose axis is within ~72 degrees of the ground plane cannot carry load (aircraft on its side). */
const MIN_AXIS_NORMAL = 0.3;
/** Speed scale of the smooth sliding-friction law for airframe scrapes, m/s. */
const SCRAPE_SLIP = 0.3;

const LABELS: Record<WheelName, string> = { nose: 'Nose', left: 'Left main', right: 'Right main' };
/** Order of the leg statuses (a leg only moves up it). */
const STATUS_RANK: Record<LegStatus, number> = { ok: 0, hard: 1, bent: 2, bottomed: 2, collapsed: 3 };
/** Default airframe-contact severity by item (GearDamageConfig; StructuralPoint.damage overrides it). */
const ITEM_SEVERITY: Record<AirframeItem, DamageSeverity> = { wingtipLeft: 'damage', wingtipRight: 'damage', tail: 'damage', nose: 'disabling', belly: 'disabling' };

/**
 * Crash classification. A ground contact that ends the flight is reported as a terrain impact, not as the
 * first part that happened to touch, when the aircraft arrives with energy no landing has: a sink rate beyond
 * what the gear is certified to absorb with margin (CS/FAR 23.473 limit descent velocity ~3 m/s for this
 * class; a spring-steel C172 gear fails between ~4.5 and 6 m/s), a speed well beyond any landing (the flare is
 * flown at ~1.3 V_so, ~31 m/s), or a faster-than-approach arrival on a steep descent path. These are the
 * Cessna 172S figures, used by a configuration that gives no `impact` of its own.
 */
const IMPACT: ImpactThresholds = {
  /** Sink rate above which any first contact is a terrain impact, m/s (~1400 fpm). */
  sinkRate: 7,
  /** Speed above which any first contact is a terrain impact, m/s (~78 kt, 1.6 V_so). */
  speed: 40,
  /** A contact above `steepSpeed` (~68 kt) on a descent path steeper than `steepPath` is a terrain impact. */
  steepSpeed: 35,
  steepPath: 12 * (Math.PI / 180),
};
/** Leg loads above this multiple of the limit load are not quoted (penalty contact deep in the ground). */
const QUOTED_LOAD_LIMIT = 3;
const MS_TO_KT = 3600 / 1852;
const MS_TO_FPM = 60 / 0.3048;

/** Short impact description from the CG velocity (NED) and pitch attitude, or '' for a landing-like arrival. */
export function classifyImpact(velocityNed: Vec3, pitch: number, thresholds: ImpactThresholds = IMPACT): string {
  const speed = Math.hypot(velocityNed.x, velocityNed.y, velocityNed.z);
  const sink = velocityNed.z;
  const path = Math.atan2(sink, Math.hypot(velocityNed.x, velocityNed.y));
  const impact = sink > thresholds.sinkRate || speed > thresholds.speed || (speed > thresholds.steepSpeed && path > thresholds.steepPath);
  if (!impact) return '';
  const nose = pitch < -10 * (Math.PI / 180) ? `, ${Math.round((-pitch * 180) / Math.PI)}\u00b0 nose down` : '';
  return `Terrain impact at ${Math.round(speed * MS_TO_KT)} kt, ${Math.round(Math.max(sink, 0) * MS_TO_FPM)} fpm descent${nose}`;
}

interface WheelRuntime {
  cfg: WheelConfig;
  spring: SeriesSpring;
  dyn: WheelDynamics;
  airborneTime: number;
  /** Set when the leg was overloaded: it no longer supports the aircraft until reset(). */
  failed: boolean;
  /**
   * GearConfig.damage: how far the ground is above the extended contact point along the leg axis in the last call,
   * m (0 clear of it); a collapsed leg reports at least this compression, so its wheel is drawn folded above the
   * ground the aircraft rests on.
   */
  depth?: number;
  /** Tyre force of the previous call on the unsteered in-plane axes, N (for the leg-axis load split). */
  fa: number;
  fb: number;
  /** GearConfig.damage: this leg's limits, its record, and its stroke (oleo), m. */
  dmg?: LegDamageConfig;
  leg?: LegDamage;
  stroke?: number;
  /** A bottomed oleo has been airborne since: its reduced ultimate load applies. */
  weakened?: boolean;
  /** Extended contact point moved by the leg's permanent set, body axes, m. */
  setPosition?: Vec3;
}

interface PendingTouchdown {
  wheel: WheelName;
  sinkRate: number;
  time: number;
}

export interface RestingPose {
  /** Height of the reference point above level ground, m. */
  height: number;
  /** Pitch attitude, rad (+ = nose up). */
  pitch: number;
}

export class LandingGear {
  private readonly wheels: WheelRuntime[];
  /** Radius around the reference point that contains every contact point, plus margin, m. */
  private readonly reach: number;
  /** One disc per propeller. */
  private readonly discs: readonly PropellerDisc[];
  /** Energy beyond which a first contact is a terrain impact. */
  private readonly impact: ImpactThresholds;
  /** Penalty contact parameters of the airframe points. */
  private readonly structureContact: NonNullable<GearConfig['contact']>;
  private lastTime: number | null = null;
  /** Last terrain height queried under the reference point, and where. */
  private readonly groundCheck = { x: NaN, y: NaN, height: 0 };
  private crashReason = '';
  private crashKind: CrashKind | undefined = undefined;
  /** Body state of the current call (for classifying a crash). */
  private body: GearInput['body'] | null = null;
  /** No leg is down and locked in the current call. */
  private gearUp = false;
  private touchdowns: PendingTouchdown[] = [];
  /** GearConfig.damage: the damage record (null without), and what the present call may write. */
  private readonly damage: DamageModel | null;
  private readonly damageCfg: GearDamageConfig | undefined;
  private commit = true;
  /** Seconds each propeller disc has spent in the ground (committed calls). */
  private readonly propTime: Float64Array;
  /** An airframe point carried load in the present call (damage only: the aircraft is on the ground on it). */
  private airframeContact = false;
  private input: GearInput | null = null;
  /** impactDescription() of the present call, once asked (null: not yet). */
  private impactNow: string | null = null;

  // Scratch storage for the hot path.
  private readonly sp: SeriesSpringPoint = { force: 0, strut: 0, strutRatio: 0 };
  private readonly tf: TyreForce = { fa: 0, fb: 0, skid: 0 };
  private readonly und = { height: 0, dNorth: 0, dEast: 0 };
  private readonly contact: WheelContact = { va: 0, vb: 0, load: 0, surface: SURFACES.runway, brakeTorque: 0, steerCommand: 0, locked: false };
  private readonly t0: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly t1: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly t2: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly t3: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly force: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly moment: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(readonly config: GearConfig = C172_GEAR) {
    this.wheels = config.wheels.map((cfg) => ({
      cfg,
      spring: new SeriesSpring(cfg.strut, cfg.tyreSpring),
      dyn: new WheelDynamics(cfg.tyre, cfg.steering),
      airborneTime: 0,
      failed: false,
      fa: 0,
      fb: 0,
    }));
    this.discs = config.propellers ?? [];
    this.damageCfg = config.damage;
    this.damage = config.damage ? new DamageModel(this.discs.length) : null;
    this.propTime = new Float64Array(this.discs.length);
    if (this.damage) {
      this.wheels.forEach((w, i) => {
        w.dmg = config.damage!.legs[i];
        w.leg = this.damage!.state.legs[i];
        w.stroke = w.cfg.strut instanceof OleoPneumaticSpring ? w.cfg.strut.stroke : undefined;
        w.weakened = false;
        w.setPosition = { ...w.cfg.position };
      });
    }
    this.impact = config.impact ?? IMPACT;
    this.structureContact = config.contact ?? STRUCTURE_CONTACT;
    const pts = [...config.wheels.map((w) => w.position), ...config.wheels.flatMap((w) => (w.stowed ? [w.stowed] : [])), ...config.structure.map((s) => s.position)];
    this.reach = Math.max(...this.discs.map((d) => Math.hypot(d.hub.x, d.hub.y, d.hub.z) + d.radius), ...pts.map((p) => Math.hypot(p.x, p.y, p.z))) + 1;
    this.reset();
  }

  /** Clear all internal state (wheel spin, tyre deflection, steering, events, crash latch, damage). */
  reset(): void {
    for (const w of this.wheels) {
      w.dyn.reset();
      w.airborneTime = 0;
      w.failed = false;
      w.fa = w.fb = 0;
    }
    if (this.damage) {
      this.damage.reset();
      this.propTime.fill(0);
      this.applyDamage();
    }
    this.lastTime = null;
    this.groundCheck.x = this.groundCheck.y = NaN;
    this.crashReason = '';
    this.crashKind = undefined;
    this.touchdowns = [];
  }

  /** GearConfig.damage: the live damage record (null without a damage block). */
  get damageState(): DamageState | null {
    return this.damage ? this.damage.state : null;
  }

  /**
   * Put a captured damage record back (after reset(): a resumed or restored flight). Collapsed legs carry nothing,
   * bent legs keep their set and toe, a bottomed oleo is weak on its next contact.
   */
  restoreDamage(s: DamageState): void {
    if (!this.damage) return;
    this.damage.restore(s);
    for (let i = 0; i < this.discs.length; i++) this.propTime[i] = this.damage.state.props[i].stopped ? Infinity : 0;
    this.applyDamage();
  }

  /** The damage record as plain data (null without a damage block). */
  captureDamage(): DamageState | null {
    return this.damage ? this.damage.capture() : null;
  }

  /** Leg latches and contact points from the damage record. */
  private applyDamage(): void {
    for (const w of this.wheels) {
      const leg = w.leg!;
      w.failed = leg.status === 'collapsed';
      w.weakened = leg.status === 'bottomed';
      const p = w.cfg.position;
      const a = w.cfg.axis;
      w.setPosition!.x = p.x + a.x * leg.set;
      w.setPosition!.y = p.y + a.y * leg.set;
      w.setPosition!.z = p.z + a.z * leg.set;
    }
  }

  compute(input: GearInput): GearOutput {
    const { body, env } = input;
    const t = body.time;
    if (this.damage) {
      this.commit = input.commit !== false;
      this.input = input;
      this.airframeContact = false;
      this.impactNow = null;
    }
    const dt = this.lastTime !== null && t > this.lastTime ? Math.min(t - this.lastTime, 4 * input.dt) : 0;
    this.lastTime = t;
    this.body = body;
    const ext = input.extension;
    this.gearUp = ext !== undefined && ext[0] < 1 && ext[1] < 1 && ext[2] < 1;
    this.force.x = this.force.y = this.force.z = 0;
    this.moment.x = this.moment.y = this.moment.z = 0;

    const pos = body.position;
    // Well clear of the ground the wheels and airframe points need no terrain queries at all; the terrain
    // height under the aircraft is re-queried only when it has moved (a height from up to 2 m away is used
    // with a 2 m allowance for the slope in between).
    const g = this.groundCheck;
    const near = Math.abs(pos.x - g.x) < 2 && Math.abs(pos.y - g.y) < 2;
    if (!near) {
      g.x = pos.x;
      g.y = pos.y;
      g.height = env.groundElevation(pos.x, pos.y);
    }
    let high = -pos.z - g.height > this.reach + (near ? 2 : 0);
    if (!high && near) high = -pos.z - env.groundElevation(pos.x, pos.y) > this.reach;
    const states = this.wheels.map((w, i) =>
      high ? this.airborneWheel(w, input, dt) : ext !== undefined && ext[i] < 1 ? this.unlockedWheel(w, input, dt, ext[i]) : this.contactWheel(w, input, dt),
    ) as [WheelState, WheelState, WheelState];
    if (!high) this.structuralContacts(input);

    this.touchdowns = this.touchdowns.filter((e) => t < e.time + input.dt - 1e-9 && t >= e.time - 1e-9);
    const out: GearOutput = {
      force: { ...this.force },
      moment: { ...this.moment },
      wheels: states,
      onGround: states.some((s) => s.onGround),
      crash: this.crashReason,
      touchdowns: this.touchdowns.map((e) => ({ wheel: e.wheel, sinkRate: e.sinkRate })),
    };
    if (this.crashKind !== undefined) out.crashKind = this.crashKind;
    if (this.damage) {
      out.damage = this.damage.state;
      // A folded leg is drawn folded; an aircraft sliding on its belly or nose is on the ground.
      for (let i = 0; i < 3; i++) {
        const w = this.wheels[i];
        if (w.leg!.status !== 'collapsed') continue;
        // Folded at least to its drawn stop, and never through the ground under it (the aircraft on its nose or belly).
        states[i].compression = high || (ext !== undefined && ext[i] < 1) ? w.dmg!.collapsedCompression : Math.max(w.dmg!.collapsedCompression, w.depth ?? 0);
      }
      if (this.airframeContact) out.onGround = true;
    }
    return out;
  }

  /**
   * Static attitude on level ground for a given mass and CG, so an integrator can spawn the aircraft
   * already at rest on its wheels. Ignores tyre side-load preload, so it agrees with the settled
   * simulation to a few millimetres. All three legs down and locked.
   */
  restingPose(mass: number, cgOffset: Vec3, gravity: number = G0): RestingPose {
    const [nose, left] = this.wheels;
    const W = mass * gravity;
    const xn = nose.cfg.position.x - cgOffset.x;
    const xm = left.cfg.position.x - cgOffset.x;
    const noseLoad = (W * -xm) / (xn - xm);
    const mainLoad = (W - noseLoad) / 2;
    // Vertical deflection of a contact point = axial deflection * cos(tilt); axial force = load * cos(tilt).
    const drop = (w: WheelRuntime, load: number) => {
      const c = -w.cfg.axis.z;
      return w.spring.deflectionAt(load * c) * c;
    };
    const zn = nose.cfg.position.z - drop(nose, noseLoad);
    const zm = left.cfg.position.z - drop(left, mainLoad);
    const pitch = Math.atan2(zn - zm, nose.cfg.position.x - left.cfg.position.x);
    const height = -nose.cfg.position.x * Math.sin(pitch) + zn * Math.cos(pitch);
    return { height, pitch };
  }

  private airborneWheel(w: WheelRuntime, input: GearInput, dt: number): WheelState {
    const c = this.contact;
    c.va = c.vb = c.load = 0;
    c.brakeTorque = this.brakeTorque(w.cfg, input);
    c.steerCommand = 0;
    if (dt > 0) w.dyn.advance(c, dt);
    w.fa = w.fb = 0;
    w.airborneTime += dt;
    return this.wheelState(w, 0, false, 0, 0);
  }

  /**
   * A leg that is not down and locked (extension < 1) carries nothing. Between its stops its tyre is where the
   * retraction has brought it, on the line from the stowed to the extended contact point: if the ground reaches
   * it there, the leg folds. Fully up, the wheel is inside the airframe and the airframe points speak for it.
   */
  private unlockedWheel(w: WheelRuntime, input: GearInput, dt: number, extension: number): WheelState {
    if (extension > 0 && !w.failed) {
      const { body, env } = input;
      const down = w.cfg.position;
      const up = w.cfg.stowed ?? down;
      const X = rotateXYZ(body.orientation, up.x + (down.x - up.x) * extension, up.y + (down.y - up.y) * extension, up.z + (down.z - up.z) * extension, this.t0);
      X.x += body.position.x;
      X.y += body.position.y;
      X.z += body.position.z;
      const surfaceType = env.surface(X.x, X.y);
      const und = this.und;
      surfaceUndulation(SURFACES[surfaceType], X.x, X.y, und);
      if (-X.z - env.groundElevation(X.x, X.y) - und.height < 0) {
        const reason = `${w.cfg.label ?? LABELS[w.cfg.name]} gear collapsed (not locked down)`;
        if (this.damage && surfaceType !== 'water') {
          // Landing energy: the leg folds under the aircraft (damage); impact energy: a crash as before.
          if (this.impactDescription()) {
            w.failed = true;
            this.latchCrash(reason, 'gearCollapse');
          } else if (this.commit) this.collapseLeg(w, reason);
        } else {
          w.failed = true;
          if (surfaceType === 'water') this.latchCrash('Ditched: the landing gear touched water', 'ditching');
          else this.latchCrash(reason, 'gearCollapse');
        }
      }
    }
    return this.airborneWheel(w, input, dt);
  }

  private contactWheel(w: WheelRuntime, input: GearInput, dt: number): WheelState {
    const { body, env, controls } = input;
    const q = body.orientation;
    const cfg = w.cfg;
    const r0 = w.leg !== undefined && w.leg.set !== 0 ? w.setPosition! : cfg.position;

    // Extended contact point and the local ground plane under it.
    const X0 = rotate(q, r0, this.t0);
    X0.x += body.position.x;
    X0.y += body.position.y;
    X0.z += body.position.z;
    const surfaceType = env.surface(X0.x, X0.y);
    const surface = SURFACES[surfaceType];
    const n = env.groundNormal(X0.x, X0.y);
    const und = this.und;
    surfaceUndulation(surface, X0.x, X0.y, und);
    const up = -n.z;
    const height = (-X0.z - env.groundElevation(X0.x, X0.y) - und.height) * up;
    const A = rotate(q, cfg.axis, this.t1);
    const nA = n.x * A.x + n.y * A.y + n.z * A.z;
    if (w.dmg) w.depth = height < 0 && nA >= MIN_AXIS_NORMAL ? -height / nA : 0;
    if (height >= 0 || nA < MIN_AXIS_NORMAL || w.failed) return this.airborneWheel(w, input, dt);

    // Total compression along the leg axis and its rate.
    const xTot = -height / nA;
    const V0 = this.pointVelocity(input, r0.x, r0.y, r0.z, this.t2);
    const heightRate = n.x * V0.x + n.y * V0.y + n.z * V0.z - (und.dNorth * V0.x + und.dEast * V0.y) * up;
    const xRate = -heightRate / nA;
    const sp = w.spring.evaluate(xTot, this.sp);
    const strutRate = xRate * sp.strutRatio;
    const axial = Math.max(0, sp.force + cfg.damping(strutRate, xRate));

    // In-plane wheel axes: a = body x projected on the ground plane, b = a x n (to the right).
    const fwd = rotate(q, X_AXIS, this.t3);
    const fn = fwd.x * n.x + fwd.y * n.y + fwd.z * n.z;
    let ax = fwd.x - fn * n.x;
    let ay = fwd.y - fn * n.y;
    let az = fwd.z - fn * n.z;
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al;
    ay /= al;
    az /= al;
    if (w.leg !== undefined && w.leg.toe !== 0) {
      // A bent leg's wheel is toed out: a turned toward its own side (b points right).
      const side = cfg.name === 'left' ? -1 : 1;
      const c = Math.cos(w.leg.toe);
      const sn = side * Math.sin(w.leg.toe);
      const rx = ay * n.z - az * n.y;
      const ry = az * n.x - ax * n.z;
      const rz = ax * n.y - ay * n.x;
      ax = c * ax + sn * rx;
      ay = c * ay + sn * ry;
      az = c * az + sn * rz;
    }
    const bx = ay * n.z - az * n.y;
    const by = az * n.x - ax * n.z;
    const bz = ax * n.y - ay * n.x;

    // Ground normal load: the leg carries its axial force; the part of the in-plane tyre force lying along
    // the leg axis also loads the spring (spring-leg scrub), the rest is taken by the leg in bending.
    const tyreAlongAxis = w.fa * (ax * A.x + ay * A.y + az * A.z) + w.fb * (bx * A.x + by * A.y + bz * A.z);
    const load = Math.max(0, (axial - tyreAlongAxis) / nA);

    // Contact velocity: the airframe point plus the wheel's motion along the leg as it compresses.
    const vcx = V0.x + A.x * strutRate;
    const vcy = V0.y + A.y * strutRate;
    const vcz = V0.z + A.z * strutRate;
    const c = this.contact;
    c.va = vcx * ax + vcy * ay + vcz * az;
    c.vb = vcx * bx + vcy * by + vcz * bz;
    c.load = load;
    c.surface = surface;
    c.brakeTorque = this.brakeTorque(cfg, input);
    c.steerCommand = controls.rudder * (cfg.steering?.maxCommand ?? 0);
    c.locked = cfg.steering?.lock !== undefined && controls.tailWheelLock === true;
    if (dt > 0) w.dyn.advance(c, dt);
    const tf = w.dyn.force(c, this.tf);
    w.fa = tf.fa;
    w.fb = tf.fb;

    // Resultant at the point where the leg axis meets the ground plane.
    const F = this.t0;
    F.x = load * n.x + tf.fa * ax + tf.fb * bx;
    F.y = load * n.y + tf.fa * ay + tf.fb * by;
    F.z = load * n.z + tf.fa * az + tf.fb * bz;
    const cg = body.cgOffset;
    this.applyNedForce(q, F, r0.x + cfg.axis.x * xTot - cg.x, r0.y + cfg.axis.y * xTot - cg.y, r0.z + cfg.axis.z * xTot - cg.z);

    if (w.dmg !== undefined) {
      if (w.airborneTime >= TOUCHDOWN_AIRBORNE_TIME && w.leg!.status === 'bottomed') w.weakened = true;
      this.judgeLeg(w, axial, sp.strut);
    } else if (axial > cfg.limitLoad) {
      w.failed = true;
      const quoted = axial <= QUOTED_LOAD_LIMIT * cfg.limitLoad ? ` (${(axial / 1000).toFixed(0)} kN)` : ' (overloaded)';
      this.latchCrash(`${cfg.label ?? LABELS[cfg.name]} gear collapsed${quoted}`, 'gearCollapse');
    }
    if (surfaceType === 'water') this.latchCrash('Ditched: the landing gear touched water', 'ditching');
    if (w.airborneTime >= TOUCHDOWN_AIRBORNE_TIME) {
      this.touchdowns.push({ wheel: cfg.name, sinkRate: Math.max(0, -heightRate), time: body.time });
    }
    w.airborneTime = 0;
    return this.wheelState(w, sp.strut, load > 0, load, tf.skid);
  }

  private structuralContacts(input: GearInput): void {
    const { body, env } = input;
    const q = body.orientation;
    const friction = this.structureContact.friction;
    for (const p of this.config.structure) {
      this.scrape(input, p.position.x, p.position.y, p.position.z, p.message, p.tolerance, p.friction ?? friction, p.part, 'structure', p.belly === true, p);
    }

    // Lowest point of each propeller disc (a disc is normal to body x): hub + R * (the ground-ward
    // direction projected on the disc plane).
    const discs = this.discs;
    if (discs.length === 0) return;
    const n = env.groundNormal(body.position.x, body.position.y);
    const nb = rotateInv(q, n, this.t3);
    // scrape() reuses the scratch vector, so the direction is taken out of it first.
    const ny = nb.y;
    const nz = nb.z;
    const dl = Math.hypot(ny, nz);
    if (dl > 1e-6) {
      for (let i = 0; i < discs.length; i++) {
        const prop = discs[i];
        const s = prop.radius / dl;
        this.scrape(input, prop.hub.x, prop.hub.y - ny * s, prop.hub.z - nz * s, prop.message, 0, friction, prop.part, 'propStrike', true, undefined, i);
      }
    }
  }

  /**
   * Penalty contact of one airframe point (body coordinates relative to the reference point). `part` is the
   * point's own wording for a terrain-impact message, `kind` what its message is, and `underside` whether an
   * aircraft arriving with its gear up lands on it (see latchCrash). On water any contact ends the flight,
   * whatever the point tolerates. With GearConfig.damage, `point` (an airframe point) or `disc` (a propeller's
   * index) say what a contact at landing energy damages instead.
   */
  private scrape(
    input: GearInput, px: number, py: number, pz: number,
    message: string, tolerance: number, friction: number, part: string | undefined, kind: CrashKind, underside: boolean,
    point?: StructuralPoint, disc = -1,
  ): void {
    const { body, env } = input;
    const X = this.t0;
    rotateXYZ(body.orientation, px, py, pz, X);
    X.x += body.position.x;
    X.y += body.position.y;
    X.z += body.position.z;
    const elevation = env.groundElevation(X.x, X.y);
    if (-X.z > elevation) return;
    const n = env.groundNormal(X.x, X.y);
    const depth = (elevation + X.z) * -n.z;
    const V = this.pointVelocity(input, px, py, pz, this.t1);
    const vn = V.x * n.x + V.y * n.y + V.z * n.z;
    const k = this.structureContact;
    const normal = Math.max(0, k.stiffness * depth - k.damping * vn);
    const tx = V.x - vn * n.x;
    const ty = V.y - vn * n.y;
    const tz = V.z - vn * n.z;
    const slip = Math.hypot(tx, ty, tz);
    const f = slip > 1e-9 ? (friction * normal * Math.tanh(slip / SCRAPE_SLIP)) / slip : 0;
    const F = this.t2;
    F.x = normal * n.x - f * tx;
    F.y = normal * n.y - f * ty;
    F.z = normal * n.z - f * tz;
    const cg = body.cgOffset;
    this.applyNedForce(body.orientation, F, px - cg.x, py - cg.y, pz - cg.z);
    if (this.damage && normal > 0) this.airframeContact = true;
    if (this.crashReason) return;
    const water = env.surface(X.x, X.y) === 'water';
    if (this.damage && !water && (disc >= 0 || point?.item !== undefined) && !this.impactDescription()) {
      if (this.commit) this.contactDamage(message, tolerance, part, -vn, depth, point, disc);
      return;
    }
    if (water || tolerance === 0 || -vn > tolerance) this.latchCrash(message, kind, part, underside, water);
  }

  /** Commit one leg's load to its damage record: hard, bent / bottomed, collapsed. */
  private judgeLeg(w: WheelRuntime, axial: number, strut: number): void {
    if (!this.commit) return;
    const leg = w.leg!;
    const c = w.dmg!;
    if (axial > leg.peakLoad) leg.peakLoad = axial;
    const label = w.cfg.label ?? LABELS[w.cfg.name];
    const ultimate = w.weakened ? c.bottomedUltimate ?? c.ultimateLoad : c.ultimateLoad;
    if (axial > ultimate) {
      if (this.impactDescription()) {
        // Impact energy: a crash, as without damage limits.
        w.failed = true;
        const quoted = axial <= QUOTED_LOAD_LIMIT * c.ultimateLoad ? ` (${(axial / 1000).toFixed(0)} kN)` : ' (overloaded)';
        this.latchCrash(`${label} gear collapsed${quoted}`, 'gearCollapse');
      } else this.collapseLeg(w, `${label} gear collapsed`);
      return;
    }
    const time = this.body!.time;
    const damage = this.damage!;
    if (axial > c.hardLoad && leg.status === 'ok') {
      leg.status = 'hard';
      if (!damage.state.events.some((e) => e.item === 'hardLanding')) damage.note(time, 'hardLanding', 'inspection', 'Hard landing: inspection required');
    }
    const item = LEG_ITEMS[this.wheels.indexOf(w)];
    if (c.kind === 'spring') {
      if (axial <= c.yieldLoad) return;
      const set = (c.maxSet ?? 0.04) * Math.min(1, (axial - c.yieldLoad) / (c.ultimateLoad - c.yieldLoad));
      if (set > leg.set) {
        leg.set = set;
        if (w.cfg.name !== 'nose') leg.toe = (c.toePerSet ?? 0.9) * set;
        const p = w.cfg.position;
        const a = w.cfg.axis;
        w.setPosition!.x = p.x + a.x * set;
        w.setPosition!.y = p.y + a.y * set;
        w.setPosition!.z = p.z + a.z * set;
      }
      if (STATUS_RANK[leg.status] < STATUS_RANK.bent) {
        leg.status = 'bent';
        this.yieldDamage(c, item, `${label} gear bent`);
      }
    } else if ((axial > c.yieldLoad || (w.stroke !== undefined && strut >= w.stroke - 1e-4)) && STATUS_RANK[leg.status] < STATUS_RANK.bottomed) {
      leg.status = 'bottomed';
      this.yieldDamage(c, item, `${label} gear bottomed: structural damage`);
    }
  }

  /** The event of a leg's yield: on the airframe item it damages (LegDamageConfig.yield), else on the leg. */
  private yieldDamage(c: LegDamageConfig, item: (typeof LEG_ITEMS)[number], text: string): void {
    const time = this.body!.time;
    if (c.yield?.item) this.damage!.airframe(time, c.yield.item, 'damage', c.yield.text);
    else this.damage!.note(time, item, 'damage', c.yield?.text ?? text);
  }

  /** A leg folds at landing energy: it carries nothing from now on (damage, not a crash). */
  private collapseLeg(w: WheelRuntime, text: string): void {
    w.failed = true;
    const leg = w.leg!;
    if (leg.status === 'collapsed') return;
    leg.status = 'collapsed';
    this.damage!.note(this.body!.time, LEG_ITEMS[this.wheels.indexOf(w)], 'disabling', text);
  }

  /**
   * A committed airframe or propeller contact at landing energy. A propeller: struck (a tip strike, the engine runs
   * on) or, dug in (GearDamageConfig.propDig*), stopped. An airframe point: its item takes the point's severity, or an
   * 'inspection' scrape within its tolerance; with no leg down a belly point or a disc makes it a gear-up landing.
   */
  private contactDamage(message: string, tolerance: number, part: string | undefined, sink: number, depth: number, point: StructuralPoint | undefined, disc: number): void {
    const damage = this.damage!;
    const time = this.body!.time;
    const cfg = this.damageCfg!;
    if (this.gearUp && (disc >= 0 || point?.belly === true)) {
      damage.airframe(time, 'belly', 'disabling', `Gear-up landing (${part !== undefined ? `${part} first` : firstContact(message)})`);
    }
    if (disc >= 0) {
      const prop = damage.state.props[disc];
      this.propTime[disc] += this.input!.dt;
      const power = this.input!.propPower?.[disc] ?? 0;
      const collapsed = this.wheels.some((w) => w.leg!.status === 'collapsed');
      const dig = this.gearUp || collapsed || power > (cfg.propDigPower ?? 0.4) || this.propTime[disc] > (cfg.propDigTime ?? 0.12) || depth > (cfg.propDigDepth ?? 0.04);
      const item = `propeller${disc}` as const;
      const which = this.discs.length > 1 ? (part !== undefined ? `${part[0].toUpperCase()}${part.slice(1)} strike` : message) : 'Propeller strike';
      if (!prop.struck) {
        prop.struck = true;
        if (!dig) damage.note(time, item, 'damage', `${which}: engine and propeller inspection required`);
      }
      if (dig && !prop.stopped) {
        prop.stopped = true;
        const stop = cfg.propStopText ?? 'Propeller strike: engine stopped';
        damage.note(time, item, 'disabling', this.discs.length > 1 ? stop.replace(/^Propeller strike/, which) : stop);
      }
      return;
    }
    const p = point!;
    const item = p.item!;
    if (p.damage) damage.airframe(time, item, p.damage.severity, p.damage.text);
    else if (tolerance > 0 && sink <= tolerance) damage.airframe(time, item, 'inspection', `${message}: inspection required`);
    else damage.airframe(time, item, ITEM_SEVERITY[item], message);
  }

  /** Terrain-impact description of the present arrival ('' for landing energy; see classifyImpact), once per call. */
  private impactDescription(): string {
    if (this.impactNow !== null) return this.impactNow;
    const b = this.body;
    if (!b) return '';
    const v = rotateXYZ(b.orientation, b.velocityBody.x, b.velocityBody.y, b.velocityBody.z, { x: 0, y: 0, z: 0 });
    const fwd = rotateXYZ(b.orientation, 1, 0, 0, { x: 0, y: 0, z: 0 });
    this.impactNow = classifyImpact(v, Math.asin(Math.max(-1, Math.min(1, -fwd.z))), this.impact);
    return this.impactNow;
  }

  /** Ground-relative velocity (NED) of an airframe point given in body coordinates relative to the reference point. */
  private pointVelocity(input: GearInput, px: number, py: number, pz: number, out: Vec3): Vec3 {
    const { velocityBody: v, angularVelocity: w, cgOffset: cg } = input.body;
    const rx = px - cg.x;
    const ry = py - cg.y;
    const rz = pz - cg.z;
    return rotateXYZ(input.body.orientation, v.x + w.y * rz - w.z * ry, v.y + w.z * rx - w.x * rz, v.z + w.x * ry - w.y * rx, out);
  }

  /** Accumulate an NED force applied at body arm r (from the CG) into the body-axis force and moment. */
  private applyNedForce(q: Quat, F: Vec3, rx: number, ry: number, rz: number): void {
    const fb = rotateInv(q, F, this.t3);
    this.force.x += fb.x;
    this.force.y += fb.y;
    this.force.z += fb.z;
    this.moment.x += ry * fb.z - rz * fb.y;
    this.moment.y += rz * fb.x - rx * fb.z;
    this.moment.z += rx * fb.y - ry * fb.x;
  }

  private brakeTorque(cfg: WheelConfig, input: GearInput): number {
    if (!cfg.brake) return 0;
    const { controls } = input;
    const pedal = cfg.brake === 'left' ? controls.brakeLeft : controls.brakeRight;
    const applied = controls.parkingBrake ? 1 : Math.max(0, Math.min(1, pedal));
    return applied * cfg.maxBrakeTorque;
  }

  /**
   * Latch the first crash reason. A high-energy arrival is reported as a terrain impact whichever part touched
   * first (see IMPACT); the first part is kept as a detail, in the words of `part` when the point that touched
   * carries its own, otherwise derived from the reason. Below that energy an airframe point in the water
   * (`water`) is a ditching, and an aircraft with no leg down that arrives on a propeller disc or a belly point
   * (`underside`) has made a gear-up landing.
   */
  private latchCrash(reason: string, kind: CrashKind, part?: string, underside = false, water = false): void {
    if (this.crashReason) return;
    const b = this.body;
    let impact = '';
    let speed = 0;
    if (b && reason.indexOf('water') < 0) {
      const v = rotateXYZ(b.orientation, b.velocityBody.x, b.velocityBody.y, b.velocityBody.z, { x: 0, y: 0, z: 0 });
      const fwd = rotateXYZ(b.orientation, 1, 0, 0, { x: 0, y: 0, z: 0 });
      impact = classifyImpact(v, Math.asin(Math.max(-1, Math.min(1, -fwd.z))), this.impact);
      speed = Math.hypot(v.x, v.y, v.z);
    }
    if (impact) {
      this.crashReason = `${impact} (${part !== undefined ? `${part} first` : firstContact(reason)})`;
      this.crashKind = 'impact';
    } else if (water) {
      this.crashReason = DITCHED_AIRFRAME;
      this.crashKind = 'ditching';
    } else if (underside && this.gearUp) {
      this.crashReason = `Gear-up landing at ${Math.round(speed * MS_TO_KT)} kt (${part !== undefined ? `${part} first` : firstContact(reason)})`;
      this.crashKind = 'gearUp';
    } else {
      this.crashReason = reason;
      this.crashKind = kind;
    }
  }

  private wheelState(w: WheelRuntime, compression: number, onGround: boolean, load: number, skid: number): WheelState {
    const d = w.dyn;
    return {
      name: w.cfg.name,
      compression,
      onGround,
      load,
      spinRate: d.spin,
      rotation: d.rotation,
      steerAngle: d.steer,
      skid,
    };
  }
}

const X_AXIS: Vec3 = { x: 1, y: 0, z: 0 };
/** An airframe point in the water at less than impact energy (a wheel in the water has its own wording). */
const DITCHED_AIRFRAME = 'Ditched: the airframe touched water';

/** 'Nose gear collapsed (181 kN)' -> 'nose gear first'; 'Propeller strike' -> 'propeller first'. */
function firstContact(reason: string): string {
  const r = reason.replace(/ \(.*\)$/, '').toLowerCase();
  if (r.startsWith('propeller')) return 'propeller first';
  const gear = r.match(/^(.*gear) collapsed/);
  if (gear) return `${gear[1]} first`;
  const struck = r.match(/^(.*) struck the ground/);
  if (struck) return `${struck[1]} first`;
  if (r === 'tail strike') return 'tail first';
  return r;
}

function rotate(q: Quat, v: Vec3, out: Vec3): Vec3 {
  return rotateXYZ(q, v.x, v.y, v.z, out);
}

/** out = q v q* (body -> NED); allocation-free version of quat.rotate. */
function rotateXYZ(q: Quat, x: number, y: number, z: number, out: Vec3): Vec3 {
  return rotateBy(q.w, q.x, q.y, q.z, x, y, z, out);
}

/** out = q* v q (NED -> body). */
function rotateInv(q: Quat, v: Vec3, out: Vec3): Vec3 {
  return rotateBy(q.w, -q.x, -q.y, -q.z, v.x, v.y, v.z, out);
}

function rotateBy(w: number, ux: number, uy: number, uz: number, x: number, y: number, z: number, out: Vec3): Vec3 {
  const cx = uy * z - uz * y;
  const cy = uz * x - ux * z;
  const cz = ux * y - uy * x;
  out.x = x + 2 * (w * cx + uy * cz - uz * cy);
  out.y = y + 2 * (w * cy + uz * cx - ux * cz);
  out.z = z + 2 * (w * cz + ux * cy - uy * cx);
  return out;
}
