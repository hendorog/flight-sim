// Blade-element momentum theory for the propeller, valid at every operating point: static (V = 0), normal
// thrust, windmilling, stopped, and flow arriving from behind (negative advance ratio).
//
// Each blade element (radius r, azimuth psi) sees an axial inflow Va and a tangential inflow Vt. With the
// inflow angle phi as the only unknown, the induced velocities follow from momentum balance over the annulus
// (mass flux |V + u|, Prandtl tip loss F), and the element is solved when the kinematics close:
//
//   Va = W sin(phi) - u,   Vt = W cos(phi) + v,
//   u = sigma' cn W / (4 F |sin phi|),   v = sigma' ct W / (4 F |sin phi|),   sigma' = B c / (2 pi r).
//
// Eliminating W and multiplying through by |sin phi| gives the residual
//
//   R(phi) = Vt (sin phi |sin phi| - sigma' cn / 4F) - Va (cos phi |sin phi| + sigma' ct / 4F),
//
// which, unlike the usual a / a' iteration, is continuous for every phi and every sign of Va, so a bracketing
// root finder always converges (the idea of Ning, "A simple solution method to the blade element momentum
// equations with guaranteed convergence", Wind Energy 2014, rewritten here in velocities rather than induction
// factors so V = 0 needs no special case). The physical root is the one nearest the geometric inflow angle
// atan2(Va, Vt), where R = -sigma' (cn Vt + ct Va) / 4F; roots whose W would be negative are rejected.
//
// Inclined inflow (P-factor): the annulus induction is solved for the azimuth-averaged loading and every azimuth
// station is a blade element in that inflow with its own tangential speed (see rotorLoads), so the asymmetric disc
// loading, the in-plane force and the yawing moment come out directly.

import { sectionCoefficients, type SectionCoefficients } from './airfoil';
import { bladeElements, type BladeElement } from './bladeGeometry';
import { C172_BLADE_SECTION, C172_PROPELLER } from './c172Powerplant';
import type { BladeSectionDef, PropellerDef } from './defs';

/** Aerodynamic loads per unit span on one blade element, plus its induced velocities. */
export interface ElementSolution {
  /** Force along the propeller axis (thrust direction), N/m. */
  normalForce: number;
  /** Force opposing the blade's motion (torque direction), N/m. */
  tangentialForce: number;
  /** Axial induced velocity at the disc, m/s (+ = accelerates the flow aft). */
  u: number;
  /** Swirl induced velocity at the disc, m/s (+ = in the direction of rotation). */
  v: number;
  /** Inflow angle, rad. */
  phi: number;
  alpha: number;
}

/** Loads of the whole rotor with the in-plane airflow moving toward body -z (air arriving from below). */
export interface RotorLoads {
  /** N, along body +x. */
  thrust: number;
  /** Aerodynamic torque resisting rotation, N*m. */
  torque: number;
  /** In-plane force along body z, N. By symmetry the y component is zero for this inflow direction. */
  forceZ: number;
  /** Moment about body z at the hub, N*m. By symmetry the y component is zero for this inflow direction. */
  momentZ: number;
}

const SEARCH_STEP = 1.5 * (Math.PI / 180);
const MAX_ITER = 60;
const PHI_TOL = 1e-10;

export class BemtSolver {
  readonly elements: readonly BladeElement[];
  /** Tip radius, m, and number of blades of the propeller the elements belong to. */
  readonly radius: number;
  readonly blades: number;
  private readonly section: BladeSectionDef;
  private readonly coeffs: SectionCoefficients = { cl: 0, cd: 0 };
  private readonly scratch: ElementSolution = { normalForce: 0, tangentialForce: 0, u: 0, v: 0, phi: 0, alpha: 0 };
  /** Annulus-averaged axial and swirl induced velocity of each element for the current rotorLoads call. */
  private readonly uAnn: Float64Array;
  private readonly vAnn: Float64Array;

  // Per-evaluation context, set by solveElement so the residual can be a cheap method call.
  private el!: BladeElement;
  private va = 0;
  private vt = 0;
  private mach = 0;
  private sigma = 0;
  private cn = 0;
  private ct = 0;
  private quarterOverF = 0;

  /** `pitch`: the blade angle at the reference station of a variable-pitch blade, rad (see bladeElements). */
  constructor(elementCount = 20, def: PropellerDef = C172_PROPELLER, pitch?: number) {
    this.elements = bladeElements(elementCount, def, pitch);
    this.radius = def.diameter / 2;
    this.blades = def.blades;
    this.section = def.section ?? C172_BLADE_SECTION;
    this.uAnn = new Float64Array(this.elements.length);
    this.vAnn = new Float64Array(this.elements.length);
  }

  /** Residual R(phi); also leaves cn, ct and sigma'/(4F) of that phi in the instance fields. */
  private residual(phi: number): number {
    const e = this.el;
    const s = Math.sin(phi);
    const c = Math.cos(phi);
    const as = Math.abs(s);
    // Prandtl tip loss.
    const f = (this.blades / 2) * (this.radius - e.r) / (e.r * Math.max(as, 1e-9));
    const tipLoss = Math.max((2 / Math.PI) * Math.acos(Math.exp(-f)), 1e-4);
    sectionCoefficients(e.theta - phi, this.mach, e.tOverC, e.stallDelay, this.coeffs, this.section);
    const { cl, cd } = this.coeffs;
    this.cn = cl * c - cd * s;
    this.ct = cl * s + cd * c;
    this.quarterOverF = this.sigma / (4 * tipLoss);
    return this.vt * (s * as - this.quarterOverF * this.cn) - this.va * (c * as + this.quarterOverF * this.ct);
  }

  /** Relative speed W at a converged phi, or -1 if the root is the spurious (W < 0) branch. */
  private relativeSpeed(phi: number): number {
    const s = Math.sin(phi);
    const as = Math.abs(s);
    const a = s * as - this.quarterOverF * this.cn;
    const b = Math.cos(phi) * as + this.quarterOverF * this.ct;
    const dot = a * this.va + b * this.vt;
    if (dot <= 0) return -1;
    return (as * Math.hypot(this.va, this.vt)) / Math.max(Math.hypot(a, b), 1e-12);
  }

  /** Illinois false-position refinement of a bracketed root. */
  private refine(lo: number, rlo: number, hi: number, rhi: number): number {
    const tol = 1e-10 * Math.hypot(this.va, this.vt);
    let side = 0;
    let x = lo;
    for (let i = 0; i < MAX_ITER; i++) {
      x = (lo * rhi - hi * rlo) / (rhi - rlo);
      const rx = this.residual(x);
      if (Math.abs(hi - lo) < PHI_TOL || Math.abs(rx) <= tol) break;
      if (rx * rhi > 0) {
        hi = x;
        rhi = rx;
        if (side === -1) rlo *= 0.5;
        side = -1;
      } else {
        lo = x;
        rlo = rx;
        if (side === 1) rhi *= 0.5;
        side = 1;
      }
    }
    return x;
  }

  /**
   * Solve one element with axial inflow `va` and tangential inflow `vt` (m/s), air density `rho` and speed of
   * sound `a`. The returned object is reused by the next call.
   */
  solveElement(e: BladeElement, va: number, vt: number, rho: number, a: number): ElementSolution {
    const out = this.scratch;
    const speed = Math.hypot(va, vt);
    if (speed < 1e-6) {
      out.normalForce = out.tangentialForce = out.u = out.v = 0;
      out.phi = out.alpha = 0;
      return out;
    }
    this.el = e;
    this.va = va;
    this.vt = vt;
    this.mach = speed / a;
    this.sigma = (this.blades * e.chord) / (2 * Math.PI * e.r);

    // Search outward from the geometric inflow angle for the nearest valid sign change.
    const phi0 = Math.atan2(va, vt);
    const r0 = this.residual(phi0);
    let phi = phi0;
    let w = -1;
    if (r0 === 0) {
      w = this.relativeSpeed(phi0);
    } else {
      let upPrev = phi0;
      let rUp = r0;
      let downPrev = phi0;
      let rDown = r0;
      for (let k = 1; k * SEARCH_STEP <= Math.PI && w < 0; k++) {
        const up = phi0 + k * SEARCH_STEP;
        const ru = this.residual(up);
        if (ru * rUp <= 0) {
          phi = this.refine(upPrev, rUp, up, ru);
          this.residual(phi);
          w = this.relativeSpeed(phi);
        }
        upPrev = up;
        rUp = ru;
        if (w >= 0) break;
        const down = phi0 - k * SEARCH_STEP;
        const rd = this.residual(down);
        if (rd * rDown <= 0) {
          phi = this.refine(down, rd, downPrev, rDown);
          this.residual(phi);
          w = this.relativeSpeed(phi);
        }
        downPrev = down;
        rDown = rd;
      }
    }
    if (w < 0) {
      // No valid root (not observed in practice): fall back to blade-element theory without induction.
      phi = phi0;
      this.residual(phi);
      w = speed;
    }
    const q = 0.5 * rho * w * w * e.chord;
    out.normalForce = q * this.cn;
    out.tangentialForce = q * this.ct;
    out.u = w * Math.sin(phi) - va;
    out.v = vt - w * Math.cos(phi);
    out.phi = phi;
    out.alpha = e.theta - phi;
    return out;
  }

  /**
   * Integrate the rotor at axial inflow `va` (m/s, + = air arriving from ahead), in-plane inflow `vip` (m/s,
   * air moving toward body -z), shaft speed `omega` (rad/s, >= 0), density `rho` and speed of sound `a`.
   * `azimuths` is the number of azimuth stations per revolution (even); 0 in-plane speed needs only one.
   *
   * Inclined inflow: the induced velocity is a property of the wake of the whole annulus, not of the blade
   * passing a given azimuth (the wake is fed by every blade passage, and the momentum balance holds for the
   * annulus: Glauert). So the axial and swirl induction of each annulus is solved once, for the
   * azimuth-averaged loading, and every azimuth station is then a blade element in that inflow with its own
   * tangential speed omega r + vip cos psi. The advancing blade's extra dynamic pressure and angle of attack are
   * therefore not absorbed by a locally larger induced velocity, which is what makes the thrust asymmetric
   * (P-factor) at every advance ratio, growing with power and angle of attack.
   */
  rotorLoads(va: number, vip: number, omega: number, rho: number, a: number, azimuths = 8, out?: RotorLoads): RotorLoads {
    const res = out ?? { thrust: 0, torque: 0, forceZ: 0, momentZ: 0 };
    const els = this.elements;
    const { uAnn, vAnn, blades, section } = this;
    let thrust = 0;
    let torque = 0;
    // Annulus induction (and the axisymmetric loads, which are the answer when there is no in-plane flow).
    for (let k = 0; k < els.length; k++) {
      const e = els[k];
      const s = this.solveElement(e, va, omega * e.r, rho, a);
      uAnn[k] = s.u;
      vAnn[k] = s.v;
      thrust += s.normalForce * e.dr;
      torque += s.tangentialForce * e.dr * e.r;
    }
    if (vip === 0) {
      res.thrust = thrust * blades;
      res.torque = torque * blades;
      res.forceZ = res.momentZ = 0;
      return res;
    }
    thrust = torque = 0;
    let forceZ = 0;
    let momentZ = 0;
    // Loads at psi and -psi are equal (the tangential inflow omega r + vip cos psi is even in psi),
    // so only 0..pi is evaluated, with the interior stations counted twice.
    const half = azimuths / 2;
    const c = this.coeffs;
    for (let j = 0; j <= half; j++) {
      const psi = (j * Math.PI) / half;
      const weight = (j === 0 || j === half ? 1 : 2) / azimuths;
      const cp = Math.cos(psi);
      for (let k = 0; k < els.length; k++) {
        const e = els[k];
        const through = va + uAnn[k];
        const tangential = omega * e.r + vip * cp - vAnn[k];
        const w2 = through * through + tangential * tangential;
        if (w2 < 1e-12) continue;
        const w = Math.sqrt(w2);
        const phi = Math.atan2(through, tangential);
        sectionCoefficients(e.theta - phi, w / a, e.tOverC, e.stallDelay, c, section);
        const sp = Math.sin(phi), cph = Math.cos(phi);
        const q = 0.5 * rho * w2 * e.chord;
        const fn = q * (c.cl * cph - c.cd * sp) * e.dr * weight;
        const ft = q * (c.cl * sp + c.cd * cph) * e.dr * weight;
        thrust += fn;
        torque += ft * e.r;
        // Blade radial unit vector (0, cos psi, sin psi); direction of motion (0, -sin psi, cos psi).
        forceZ -= ft * cp;
        momentZ -= fn * e.r * cp;
      }
    }
    res.thrust = thrust * blades;
    res.torque = torque * blades;
    res.forceZ = forceZ * blades;
    res.momentZ = momentZ * blades;
    return res;
  }
}
