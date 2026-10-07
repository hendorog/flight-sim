// Tyre, wheel-spin and nosewheel-steering dynamics of one landing-gear wheel.
//
// TYRE FORCES. Brush model with a parabolic contact pressure (Pacejka, "Tire and Vehicle Dynamics", 3rd ed.,
// ch. 3) in its isotropic combined-slip form: with slip "stiffness forces" sx = Cx kappa, sy = Cy alpha and
// theta = |s| / (3 mu Fz), the resultant is F = mu Fz (1 - (1 - theta)^3) along s, saturating at the friction
// circle mu Fz when the whole contact patch slides (theta >= 1).
//
// LOW-SPEED SINGULARITY. The steady-state slips kappa = -Vsx/|Vx| and alpha = -Vy/|Vx| are singular at rest.
// Instead the slips are first-order "transient" states with relaxation lengths (Pacejka ch. 7, the
// stretched-string approximation):
//     sigma_x dkappa/dt + |Vx| kappa = -Vsx        sigma_y dalpha/dt + |Vx| alpha = -Vy
// At speed they relax to the steady slips within about one relaxation length of travel; at rest they become
// the tyre's elastic deflection (kappa * sigma_x is the tread displacement, in metres), i.e. a spring that
// holds the aircraft without creep. A viscous term on the slip velocity, faded out above a few m/s, damps
// that spring (Pacejka's low-speed damping). The relaxation term is integrated exactly (exponential), so the
// scheme is unconditionally stable in it.
//
// WHEEL SPIN. I dOmega/dt = -R Fx - T, with the brake, rolling-resistance and bearing torques T applied as
// Coulomb friction: if they can stop the wheel within the step it is held at exactly zero (locked brakes and
// a parked aircraft stay perfectly still), otherwise they oppose the spin at full strength. The low-speed
// damping term is treated implicitly because the wheel's own inertia is tiny.
//
// NOSEWHEEL STEERING (C172). The rudder pedals drive the nosewheel through a spring bungee: stiff up to a
// breakout torque, then soft, so differential braking can swing the wheel to its caster stops. The steer
// angle has no inertia; it is governed by the shimmy damper:  c delta' = M_link + M_align, M_align = -Fy * trail.
// A first-order castering wheel without inertia cannot shimmy (the tyre/caster loop has positive damping at
// every speed), which is what the hydraulic shimmy damper achieves on the real aircraft.
//
// FREE-CASTERING NOSEWHEEL (SteeringParams.mode 'castering'). No linkage: the pedals do not reach the wheel.
// c delta' = M_align - M_friction, where the Coulomb friction of the swivel holds the wheel (zero rate) while
// the aligning moment is below it and opposes the motion at full strength otherwise. With the tyre in its
// steady state M_align = -C_alpha N trail delta, so the loop's rate is C_alpha N trail / c; with the lateral
// relaxation it is the second-order system s^2 + (V/sigma) s + (V/sigma)(C_alpha N trail / c) = 0, whose
// coefficients are positive at every speed. The contact patch trails the pivot, so a swivel rate delta' moves
// it sideways: the lateral slip velocity is vy - trail delta' (Pacejka ch. 6, the shimmy equations), which
// adds the trailing wheel's own damping trail K / sigma: s^2 + ((V + trail K) / sigma) s + V K / sigma = 0,
// K = C_alpha N trail / c. At walking pace it dominates (the wheel follows its track like a shopping cart,
// within about a trail length, without swinging through), and at rest it lets the swivel unwind the tread
// deflection instead of turning on it. The rate and the slip are solved together in each internal step
// (implicitly), so the term is stable at any trail. The swivel's own inertia is not modelled, and the linked
// wheel leaves the patch term out (its linkage holds the wheel).

import { smoothstep } from '../../core/math';
import type { SurfaceProperties } from './surfaces';

export interface TyreParams {
  /** Rolling radius, m. */
  radius: number;
  /** Spin inertia of wheel, tyre and brake disc, kg m^2. */
  inertia: number;
  /** Longitudinal slip stiffness per unit load, dFx/dkappa / Fz. */
  slipStiffness: number;
  /** Cornering stiffness per unit load, dFy/dalpha / Fz, 1/rad. */
  corneringStiffness: number;
  /** Relaxation lengths, m. */
  relaxationLong: number;
  relaxationLat: number;
  /** Low-speed viscous damping of the tread deflection per unit load, s/m. Faded out above LOW_SPEED_FADE. */
  lowSpeedDamping: number;
}

export interface SteeringParams {
  /** Nosewheel deflection at full pedal, rad. */
  maxCommand: number;
  /** Mechanical caster stops, rad. */
  casterLimit: number;
  /** Distance the contact patch trails the steering axis, m. */
  trail: number;
  /** Stiffness of the linkage below the bungee breakout, N m/rad. */
  linkStiffness: number;
  /** Bungee preload torque, N m. */
  breakoutTorque: number;
  /** Bungee stiffness beyond breakout, N m/rad. */
  bungeeStiffness: number;
  /** Shimmy damper, N m s/rad. Castering: the viscous drag of the swivel, which sets how fast it follows (> 0). */
  damper: number;
  /** Time constant of the centring cam that straightens the wheel when the strut extends, s. */
  centeringTime: number;
  /** 'linked' (default): pedals drive the wheel through linkStiffness / breakout / bungee. 'castering': free swivel; maxCommand, linkStiffness, breakoutTorque, bungeeStiffness are ignored (write 0). */
  mode?: 'linked' | 'castering';
  /** Coulomb friction of the swivel, N m (castering). Default 0. */
  friction?: number;
}

/** Kinematics and loads at the contact patch, produced by the landing-gear assembly. */
export interface WheelContact {
  /** Contact-point velocity in the ground plane along the unsteered wheel heading, m/s. */
  va: number;
  /** ...and to its right, m/s. */
  vb: number;
  /** Normal load, N (0 = airborne). */
  load: number;
  surface: SurfaceProperties;
  /** Brake torque available, N m. */
  brakeTorque: number;
  /** Pedal steering command, rad (ignored by unsteerable and by castering wheels). */
  steerCommand: number;
}

/** Tyre force in the ground plane, resolved on the unsteered wheel axes (a forward, b right), N. */
export interface TyreForce {
  fa: number;
  fb: number;
  /** 0..1 sliding intensity. */
  skid: number;
}

/** Above this rolling speed the slip dynamics are well damped by relaxation alone, m/s. */
const LOW_SPEED_FADE = 2.5;
/** Sliding speed over which friction falls from peak toward the sliding value, m/s. */
const SLIDE_SPEED = 5;
/** Wheel-bearing friction torque, N m. */
const BEARING_TORQUE = 0.5;
/** Time constant for the tread to spring back once the tyre leaves the ground, s. */
const UNLOADED_RELAX = 0.02;
/** Maximum internal substeps per advance. */
const MAX_SUBSTEPS = 16;

export class WheelDynamics {
  /** Transient longitudinal slip ratio. */
  kappa = 0;
  /** Transient slip angle (tangent). */
  alpha = 0;
  /** Spin rate, rad/s (+ = rolling forward). */
  spin = 0;
  /** Accumulated rotation, rad in [0, 2 PI). */
  rotation = 0;
  /** Steering angle, rad (+ = right). */
  steer = 0;
  /** Swivel rate of the last internal step, rad/s (castering wheels; 0 otherwise). */
  steerRate = 0;

  private readonly force0: TyreForce = { fa: 0, fb: 0, skid: 0 };

  constructor(
    readonly tyre: TyreParams,
    readonly steering: SteeringParams | null,
  ) {}

  reset(): void {
    this.kappa = this.alpha = this.spin = this.rotation = this.steer = this.steerRate = 0;
  }

  /** Advance the internal states by dt with the contact held constant. */
  advance(c: WheelContact, dt: number): void {
    const p = this.tyre;
    const R = p.radius;
    const N = c.load;
    // Substeps resolve the wheel-spin/tread-spring mode, omega = sqrt(Cx/sigma_x * R^2 / I), and the steering loop.
    let rate = N > 0 ? Math.sqrt(((p.slipStiffness * N) / p.relaxationLong) * ((R * R) / p.inertia)) : 0;
    const st = this.steering;
    if (st) rate = Math.max(rate, st.mode === 'castering' ? (p.corneringStiffness * N * st.trail) / st.damper : st.linkStiffness / st.damper);
    const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil((dt * rate) / 0.5)));
    const h = dt / n;
    const resist = c.brakeTorque + BEARING_TORQUE + (N > 0 ? c.surface.rollingResistance * N * R : 0);
    for (let k = 0; k < n; k++) {
      if (N > 0) this.substepLoaded(c, h, resist);
      else this.substepAirborne(h, resist);
      this.rotation = (this.rotation + this.spin * h) % (2 * Math.PI);
      if (this.rotation < 0) this.rotation += 2 * Math.PI;
    }
  }

  /** Tyre force at the current state and contact kinematics. */
  force(c: WheelContact, out: TyreForce = this.force0): TyreForce {
    const N = c.load;
    if (N <= 0) {
      out.fa = out.fb = out.skid = 0;
      return out;
    }
    const cs = Math.cos(this.steer);
    const sn = Math.sin(this.steer);
    const vx = c.va * cs + c.vb * sn;
    const vy = -c.va * sn + c.vb * cs + this.patchVelocity();
    const vsx = vx - this.spin * this.tyre.radius;
    const slide = Math.hypot(vsx, vy);
    const mu = this.friction(c.surface, slide);
    const theta = this.brushTheta(mu);
    const t = 1 - Math.min(1, theta);
    const brush = (mu * N * (1 - t * t * t)) / Math.max(theta * 3 * mu, 1e-12);
    const cd = this.dampingCoefficient(N, vx);
    let fx = brush * this.tyre.slipStiffness * this.kappa - cd * vsx;
    let fy = brush * this.tyre.corneringStiffness * this.alpha - cd * vy;
    const mag = Math.hypot(fx, fy);
    const cap = mu * N;
    if (mag > cap) {
      fx *= cap / mag;
      fy *= cap / mag;
    }
    out.fa = fx * cs - fy * sn;
    out.fb = fx * sn + fy * cs;
    out.skid = smoothstep(0.85, 1, theta) * Math.min(1, slide / 2);
    return out;
  }

  private substepLoaded(c: WheelContact, h: number, resist: number): void {
    const p = this.tyre;
    const R = p.radius;
    const N = c.load;
    const cs = Math.cos(this.steer);
    const sn = Math.sin(this.steer);
    const vx = c.va * cs + c.vb * sn;
    // The castering patch's own sideways motion is added implicitly below (the swivel); not here.
    const vy = -c.va * sn + c.vb * cs;
    const slide0 = Math.hypot(vx - this.spin * R, vy);
    const mu = this.friction(c.surface, slide0);
    const theta = this.brushTheta(mu);
    const t = 1 - Math.min(1, theta);
    const brush = (mu * N * (1 - t * t * t)) / Math.max(theta * 3 * mu, 1e-12);
    const fxSpring = brush * p.slipStiffness * this.kappa;

    // Wheel spin: implicit in the low-speed damping, Coulomb friction for brake + rolling resistance + bearing.
    const cd = this.dampingCoefficient(N, vx);
    const den = p.inertia + h * cd * R * R;
    const free = (p.inertia * this.spin + h * R * (cd * vx - fxSpring)) / den;
    const stop = (h * resist) / den;
    this.spin = Math.abs(free) <= stop ? 0 : free - Math.sign(free) * stop;

    // Transient slips: exact integration of the relaxation term.
    const vsx = vx - this.spin * R;
    const speed = Math.abs(vx);
    this.kappa = relax(this.kappa, -vsx, speed, p.relaxationLong, h);
    this.alpha = relax(this.alpha, -vy, speed, p.relaxationLat, h);
    // Beyond full sliding the tread cannot deflect further: clamp to the friction circle so a reversal of
    // the slip direction releases the tyre immediately rather than first unwinding a fictitious deflection.
    this.clampSlip(mu);

    const st = this.steering;
    if (st) {
      const theta1 = this.brushTheta(mu);
      const t1 = 1 - Math.min(1, theta1);
      const brush1 = (mu * N * (1 - t1 * t1 * t1)) / Math.max(theta1 * 3 * mu, 1e-12);
      let fy = brush1 * p.corneringStiffness * this.alpha - cd * vy;
      fy = Math.max(-mu * N, Math.min(mu * N, fy));
      if (st.mode === 'castering') {
        // Free swivel: the aligning moment alone, against the Coulomb friction of the pivot. The rate r moves
        // the patch sideways by -trail r, which adds g trail r to the slip just relaxed (g = d alpha / d u of the
        // step) and (B g + cd) trail r to the side force: c r = align - friction - trail^2 (B g + cd) r, solved
        // for r. Saturated, the side force no longer grows with the slip and only the swivel's drag remains.
        const align = -fy * st.trail;
        const friction = st.friction ?? 0;
        const g = relaxGain(speed, p.relaxationLat, h);
        let rate = 0;
        if (Math.abs(align) > friction) {
          const stiff = Math.abs(fy) < mu * N ? brush1 * p.corneringStiffness * g + cd : 0;
          rate = (align - Math.sign(align) * friction) / (st.damper + st.trail * st.trail * stiff);
        }
        const before = this.steer;
        this.steer = Math.max(-st.casterLimit, Math.min(st.casterLimit, before + h * rate));
        this.steerRate = (this.steer - before) / h;
        if (this.steerRate !== 0) {
          this.alpha += g * st.trail * this.steerRate;
          this.clampSlip(mu);
        }
      } else {
        const command = Math.max(-1, Math.min(1, c.steerCommand / st.maxCommand)) * st.maxCommand;
        const torque = linkTorque(st, command - this.steer) - fy * st.trail;
        this.steer += (h * torque) / st.damper;
        this.steer = Math.max(-st.casterLimit, Math.min(st.casterLimit, this.steer));
      }
    }
  }

  /** Sideways velocity of a castering wheel's contact patch from its swivel rate, m/s (+ = right; 0 otherwise). */
  private patchVelocity(): number {
    const st = this.steering;
    return st && st.mode === 'castering' ? -st.trail * this.steerRate : 0;
  }

  /** The slips clamped to the friction circle. */
  private clampSlip(mu: number): void {
    const p = this.tyre;
    const s = Math.hypot(p.slipStiffness * this.kappa, p.corneringStiffness * this.alpha);
    const cap = 3 * mu;
    if (s > cap) {
      this.kappa *= cap / s;
      this.alpha *= cap / s;
    }
  }

  private substepAirborne(h: number, resist: number): void {
    const decay = Math.exp(-h / UNLOADED_RELAX);
    this.kappa *= decay;
    this.alpha *= decay;
    const stop = (h * resist) / this.tyre.inertia;
    this.spin = Math.abs(this.spin) <= stop ? 0 : this.spin - Math.sign(this.spin) * stop;
    if (this.steering) this.steer *= Math.exp(-h / this.steering.centeringTime);
    this.steerRate = 0;
  }

  /** Normalised brush slip theta = |s| / (3 mu); >= 1 means the whole contact patch slides. */
  private brushTheta(mu: number): number {
    const p = this.tyre;
    return Math.hypot(p.slipStiffness * this.kappa, p.corneringStiffness * this.alpha) / (3 * mu);
  }

  /** Friction coefficient: peak while the patch adheres, falling toward the sliding value as it slides. */
  private friction(surface: SurfaceProperties, slideSpeed: number): number {
    const sliding = smoothstep(0.8, 1, this.brushTheta(surface.muPeak));
    const drop = (surface.muPeak - surface.muSlide) * (1 - Math.exp(-slideSpeed / SLIDE_SPEED));
    return surface.muPeak - drop * sliding;
  }

  private dampingCoefficient(load: number, vx: number): number {
    return this.tyre.lowSpeedDamping * load * Math.max(0, 1 - Math.abs(vx) / LOW_SPEED_FADE);
  }
}

/**
 * One step of  sigma dx/dt + v x = u  with u, v held constant, integrated exactly:
 * x(h) = x e^-a + (u/v)(1 - e^-a), a = v h / sigma. Written so that v -> 0 gives x + u h / sigma.
 */
function relax(x: number, u: number, v: number, sigma: number, h: number): number {
  const a = (v * h) / sigma;
  const phi = a < 1e-6 ? 1 - 0.5 * a : -Math.expm1(-a) / a;
  return x * Math.exp(-a) + ((u * h) / sigma) * phi;
}

/** d x(h) / d u of relax(): how much of a change of the slip input one step passes on to the slip. */
function relaxGain(v: number, sigma: number, h: number): number {
  const a = (v * h) / sigma;
  const phi = a < 1e-6 ? 1 - 0.5 * a : -Math.expm1(-a) / a;
  return (h / sigma) * phi;
}

/** Torque of the pedal-to-nosewheel linkage for a steering error (command - actual), N m. */
function linkTorque(s: SteeringParams, error: number): number {
  const breakout = s.breakoutTorque / s.linkStiffness;
  const e = Math.abs(error);
  const m = e <= breakout ? s.linkStiffness * e : s.breakoutTorque + s.bungeeStiffness * (e - breakout);
  return Math.sign(error) * m;
}
