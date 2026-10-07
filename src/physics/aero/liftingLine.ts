// Nonlinear lifting-line solver on a horseshoe-vortex lattice (one horseshoe per strip).
//
// Unknowns are the strip circulations G. With U_i the air velocity at control point i,
//   U_i = U0_i + sum_j A_ij G_j                    (A: Biot-Savart influence of unit horseshoes)
// the Kutta-Joukowski condition in section form is
//   R_i(G) = G_i - 0.5 c_i Q_i cl_i(alpha_i) = 0   (Q_i, alpha_i from U_i in the section plane)
// solved by Newton's method with the analytic Jacobian. The section lift is evaluated at a frozen
// separation point (dynamic-stall state), so its slope stays positive through the stall region and the
// system stays well posed; a trust region caps each step and the solve is warm-started from the previous
// call, so one or two iterations per call are enough in normal flight.
//
// The 2-D self-induction of each strip's own bound vortex at its 3/4-chord point, Gamma/(pi c), is
// removed from A: that effect is already inside the 2-D section data. What remains is the 3-D induced
// velocity (trailing legs, finite bound segments, neighbours).
//
// Carry-over strips (fuselage centre sections) replace the section condition by G_i = (G_i-1 + G_i+1)/2.
//
// Separated strips: beyond the stall the discrete lifting line admits saw-tooth solutions in which
// isolated strips stall and their neighbours' trailing vortices hold them there. Following Chattot
// (2004, "Analysis and design of wings and wing/winglet combinations at low speeds") an artificial
// spanwise viscosity mu_i (G_i-1 - 2 G_i + G_i+1) is added to R_i on separated strips only; the caller
// sets mu_i from the separation state. Attached strips are unaffected.
//
// Ground effect: the lattice is mirrored in the ground plane with opposite circulation (image method),
// weighted by GroundPlane.weight so the caller can fade the images out with height.
//
// The caller chooses the trailing-leg direction and ground plane for each rebuild of the influence
// matrices and rebuilds only when they change noticeably.

import { v3, type Vec3 } from '../../core/math';
import type { SectionCoefficients } from './airfoil';
import { luFactor, luSolve } from './linalg';
import type { Strip } from './strips';
import { addChordwiseHorseshoe, addHorseshoeVelocity, type MutableVec3 } from './vortex';

/** Ground plane in body axes: height of point p above ground = normal . p + height. */
export interface GroundPlane {
  /** Unit normal pointing away from the ground (up), body axes. */
  normal: Vec3;
  /** Height of the reference point above the ground, m. */
  height: number;
  /** 0..1 weight of the image system. */
  weight: number;
}

/** Callback giving section coefficients (at least cl and dcl) of strip i at angle of attack alpha. */
export interface SectionLift {
  sectionLift(i: number, alpha: number, out: SectionCoefficients): void;
}

function reflectPoint(p: Vec3, g: GroundPlane): Vec3 {
  const d = 2 * (g.normal.x * p.x + g.normal.y * p.y + g.normal.z * p.z + g.height);
  return { x: p.x - d * g.normal.x, y: p.y - d * g.normal.y, z: p.z - d * g.normal.z };
}

function reflectDir(u: Vec3, g: GroundPlane): Vec3 {
  const d = 2 * v3.dot(g.normal, u);
  return { x: u.x - d * g.normal.x, y: u.y - d * g.normal.y, z: u.z - d * g.normal.z };
}

const tmp: MutableVec3 = { x: 0, y: 0, z: 0 };

/** Trailing-edge ends of a strip's trailing legs: the bound-vortex ends moved 3/4 chord along the section chord. */
function trailingEdge(s: Strip): { a: Vec3; b: Vec3 } {
  const d = 0.75 * s.chord;
  return {
    a: { x: s.a.x + d * s.t.x, y: s.a.y + d * s.t.y, z: s.a.z + d * s.t.z },
    b: { x: s.b.x + d * s.t.x, y: s.b.y + d * s.t.y, z: s.b.z + d * s.t.z },
  };
}

/**
 * Fill ax/ay/az (row-major, rows = targets) with the velocity at each target point induced by unit
 * horseshoes on `sources` (plus their ground images). With `chordwiseLegs` the trailing legs run along the
 * section chord to the trailing edge and leave it along the wake direction (the standard vortex-lattice
 * horseshoe): that is where the vortex sheet actually starts, which matters for points well behind the
 * surface (the tail) at high angle of attack, where the sheet rises away from them.
 */
function fillInfluence(
  targets: readonly Vec3[],
  sources: readonly Strip[],
  wake: Vec3,
  core: number,
  ground: GroundPlane | null,
  ax: Float64Array,
  ay: Float64Array,
  az: Float64Array,
  chordwiseLegs = false,
): void {
  const ns = sources.length;
  const imageWake = ground ? reflectDir(wake, ground) : wake;
  const images = ground && ground.weight > 0 ? sources.map((s) => ({ a: reflectPoint(s.a, ground), b: reflectPoint(s.b, ground) })) : null;
  const te = chordwiseLegs ? sources.map(trailingEdge) : null;
  const imageTe = te && ground && images ? te.map((e) => ({ a: reflectPoint(e.a, ground), b: reflectPoint(e.b, ground) })) : null;
  for (let i = 0; i < targets.length; i++) {
    const p = targets[i];
    for (let j = 0; j < ns; j++) {
      tmp.x = tmp.y = tmp.z = 0;
      if (te) {
        addChordwiseHorseshoe(p, sources[j].a, sources[j].b, te[j].a, te[j].b, wake, 1, core, tmp);
        if (images && imageTe) addChordwiseHorseshoe(p, images[j].a, images[j].b, imageTe[j].a, imageTe[j].b, imageWake, -ground!.weight, core, tmp);
      } else {
        addHorseshoeVelocity(p, sources[j].a, sources[j].b, wake, 1, core, tmp);
        if (images) addHorseshoeVelocity(p, images[j].a, images[j].b, imageWake, -ground!.weight, core, tmp);
      }
      ax[i * ns + j] = tmp.x;
      ay[i * ns + j] = tmp.y;
      az[i * ns + j] = tmp.z;
    }
  }
}

export class LiftingLine {
  readonly n: number;
  readonly strips: readonly Strip[];
  /** Circulation of each strip, m^2/s (+ produces lift along the strip normal). */
  readonly gamma: Float64Array;
  /** Results of the last solve at each control point. */
  readonly alpha: Float64Array;
  /** Air speed in the section plane, m/s. */
  readonly speed: Float64Array;
  /** Total local air velocity (free stream + induced), body axes, xyz interleaved. */
  readonly velocity: Float64Array;
  readonly cl: Float64Array;
  /** Spanwise artificial viscosity per strip (set by the caller before solve; 0 = none). */
  readonly viscosity: Float64Array;
  /**
   * Rotation of each strip's section against its fixed chord, rad (an all-moving surface's deflection), kept
   * current by the caller; null when no strip turns. The section lift callback applies it to the section
   * itself; here it only enters the angle that fades the bound circulation out (circulatoryWeight).
   */
  sectionRotation: Float64Array | null = null;
  /** Index of the spanwise neighbours on the same surface, -1 at a free end. */
  private readonly prev: Int32Array;
  private readonly next: Int32Array;

  private readonly core: number;
  private readonly controlPoints: Vec3[];
  private readonly ax: Float64Array;
  private readonly ay: Float64Array;
  private readonly az: Float64Array;
  /** Influences projected on each target's chord and normal directions. */
  private readonly at: Float64Array;
  private readonly an: Float64Array;
  private readonly jac: Float64Array;
  private readonly rhs: Float64Array;
  private readonly ut: Float64Array;
  private readonly un: Float64Array;
  private readonly dcl: Float64Array;
  /** Circulatory weight and circulation cap of each strip for the current solve; Newton step bookkeeping. */
  private readonly weight: Float64Array;
  private readonly cap: Float64Array;
  private readonly gammaPrev: Float64Array;
  private readonly step: Float64Array;
  private readonly result = { maxRes: 0, scale: 0 };
  /** LU factorisation of the Jacobian (in `jac`) and its pivots, and whether they are valid. */
  private readonly piv: Int32Array;
  private factored = false;
  private readonly coeffs: SectionCoefficients = { cl: 0, cd: 0, cm: 0, dcl: 0 };
  /** Influence of unit horseshoes at the bound-vortex midpoints (row-major), when a strip has forceAtBound; else null. */
  private readonly bx: Float64Array | null = null;
  private readonly by: Float64Array | null = null;
  private readonly bz: Float64Array | null = null;

  constructor(strips: readonly Strip[], coreRadius: number) {
    const n = strips.length;
    this.n = n;
    this.strips = strips;
    this.core = coreRadius;
    this.controlPoints = strips.map((s) => s.cp);
    this.gamma = new Float64Array(n);
    this.alpha = new Float64Array(n);
    this.speed = new Float64Array(n);
    this.velocity = new Float64Array(3 * n);
    this.cl = new Float64Array(n);
    this.viscosity = new Float64Array(n);
    this.prev = new Int32Array(n).fill(-1);
    this.next = new Int32Array(n).fill(-1);
    for (let i = 0; i + 1 < n; i++) {
      if (strips[i].surface === strips[i + 1].surface) {
        this.next[i] = i + 1;
        this.prev[i + 1] = i;
      }
    }
    this.ax = new Float64Array(n * n);
    this.ay = new Float64Array(n * n);
    this.az = new Float64Array(n * n);
    this.at = new Float64Array(n * n);
    this.an = new Float64Array(n * n);
    this.jac = new Float64Array(n * n);
    this.rhs = new Float64Array(n);
    this.ut = new Float64Array(n);
    this.un = new Float64Array(n);
    this.dcl = new Float64Array(n);
    this.weight = new Float64Array(n).fill(1);
    this.cap = new Float64Array(n);
    this.gammaPrev = new Float64Array(n);
    this.step = new Float64Array(n);
    this.piv = new Int32Array(n);
    if (strips.some((s) => s.forceAtBound)) {
      this.bx = new Float64Array(n * n);
      this.by = new Float64Array(n * n);
      this.bz = new Float64Array(n * n);
    }
  }

  /** Recompute the influence matrices for a wake direction (unit, body axes) and optional ground plane. */
  rebuild(wake: Vec3, ground: GroundPlane | null): void {
    const { n, strips, ax, ay, az } = this;
    this.factored = false;
    fillInfluence(this.controlPoints, strips, wake, this.core, ground, ax, ay, az);
    // A strip's own bound segment induces nothing at its midpoint (on the filament), so no term is removed here.
    if (this.bx && this.by && this.bz) fillInfluence(strips.map((s) => s.mid), strips, wake, this.core, ground, this.bx, this.by, this.bz);
    for (let i = 0; i < n; i++) {
      const st = strips[i];
      // Remove the 2-D self-induction of the strip's own bound vortex (already in the section data):
      // in the section plane a unit vortex at the quarter chord induces 1/(pi c) along -n at 3/4 chord.
      const k = 1 / (Math.PI * st.chord);
      ax[i * n + i] += k * st.n.x;
      ay[i * n + i] += k * st.n.y;
      az[i * n + i] += k * st.n.z;
      for (let j = 0; j < n; j++) {
        const m = i * n + j;
        this.at[m] = ax[m] * st.t.x + ay[m] * st.t.y + az[m] * st.t.z;
        this.an[m] = ax[m] * st.n.x + ay[m] * st.n.y + az[m] * st.n.z;
      }
    }
  }

  /**
   * Solve for the circulation given the free-stream air velocity at each control point (`u0`, xyz
   * interleaved, body axes). Returns the number of Newton steps taken.
   *
   * Robustness beyond the lifting line's range of validity:
   *  - A strip whose free-stream flow meets it far from its leading edge (post-stall beyond ~45 deg, broadside,
   *    or trailing edge first in a tail slide or a tailwind run-up) is no longer a lifting line: its trailing
   *    vorticity does not leave along the body axis, and its "circulation" is a separated normal-force flow.
   *    Its bound circulation is faded out with the free-stream angle of attack (circulatoryWeight), so such a
   *    strip carries its section load without inducing velocity on its neighbours (and the Newton system
   *    keeps a well-conditioned identity row for it instead of one that changes sign with the post-stall
   *    lift slope).
   *  - Circulation is capped at the most a section can carry in its free stream (Kutta-Joukowski with
   *    |cl| <= CL_CAP), which bounds the induced velocities.
   *  - A Newton step that raises the residual is halved (up to MAX_BACKTRACK times) before it is accepted.
   *
   * `reuseJacobian`: start from the factorised Jacobian of the previous solve (chord method) instead of
   * rebuilding it. Between the stages of one integration step the flow hardly changes, so the old Jacobian
   * still converges fast; it is rebuilt as soon as an iteration fails to halve the residual.
   */
  solve(u0: Float64Array, sections: SectionLift, maxSteps: number, tolerance = 1e-4, reuseJacobian = false): number {
    const { n, strips, gamma, at, an, jac, rhs, ut, un, dcl, viscosity, prev, next, weight, cap, gammaPrev, step, piv } = this;
    const rot = this.sectionRotation;
    // Circulatory weight and circulation cap from the free stream at each strip (independent of gamma).
    for (let i = 0; i < n; i++) {
      const st = strips[i];
      const ux = u0[3 * i], uy = u0[3 * i + 1], uz = u0[3 * i + 2];
      const vt = ux * st.t.x + uy * st.t.y + uz * st.t.z;
      const vn = ux * st.n.x + uy * st.n.y + uz * st.n.z;
      const q0 = Math.sqrt(vt * vt + vn * vn);
      weight[i] = st.carryover ? 1 : circulatoryWeight(rot ? Math.atan2(vn, vt) + rot[i] : Math.atan2(vn, vt));
      cap[i] = 0.5 * st.chord * q0 * CL_CAP + 1e-6;
      if (!(Math.abs(gamma[i]) <= cap[i])) gamma[i] = Number.isFinite(gamma[i]) ? Math.sign(gamma[i]) * cap[i] : 0;
    }
    let steps = 0;
    let backtracks = 0;
    let lastRes = Infinity;
    let fresh = !(reuseJacobian && this.factored);
    for (;;) {
      const { maxRes, scale } = this.residuals(u0, sections);
      if (!Number.isFinite(maxRes)) {
        // Non-finite input or state: drop the warm start so the next call can recover.
        gamma.fill(0);
        return steps;
      }
      if (steps > 0 && maxRes > lastRes * (1 + 1e-9) + 1e-9 * scale && backtracks < MAX_BACKTRACK) {
        // The last step made things worse: go back and take half of it.
        backtracks++;
        for (let i = 0; i < n; i++) {
          step[i] *= 0.5;
          gamma[i] = gammaPrev[i] + step[i];
        }
        continue;
      }
      if (steps >= maxSteps || maxRes <= tolerance * scale) return steps;
      // A reused Jacobian that no longer halves the residual is rebuilt.
      if (!fresh && steps > 0 && maxRes > 0.5 * lastRes) fresh = true;
      lastRes = maxRes;
      backtracks = 0;
      steps++;
      if (fresh) this.factored = this.factorJacobian();
      fresh = false;
      const ok = this.factored;
      if (ok) luSolve(n, jac, piv, rhs);
      // Trust region: no strip may change by more than the circulation of a unit lift coefficient
      // (or half its present value, so that circulation can always decay when the flow stops).
      let limit = 1;
      for (let i = 0; i < n && ok; i++) {
        const c = 0.5 * strips[i].chord * this.speed[i] + 0.5 * Math.abs(gamma[i]) + 1e-6;
        const d = Math.abs(rhs[i]);
        if (!(d <= c * 1e6)) limit = 0;
        else if (d > c) limit = Math.min(limit, c / d);
      }
      gammaPrev.set(gamma);
      if (ok && limit > 0) {
        for (let i = 0; i < n; i++) step[i] = limit * rhs[i];
      } else {
        // Singular or non-finite step: fall back to a relaxed fixed-point update.
        this.factored = false;
        for (let i = 0; i < n; i++) {
          const target = strips[i].carryover ? 0.5 * (gamma[i - 1] + gamma[i + 1]) : weight[i] * 0.5 * strips[i].chord * this.speed[i] * this.cl[i];
          step[i] = 0.3 * (target - gamma[i]);
        }
      }
      for (let i = 0; i < n; i++) {
        let g = gamma[i] + step[i];
        if (g > cap[i]) g = cap[i];
        else if (g < -cap[i]) g = -cap[i];
        step[i] = g - gamma[i];
        gamma[i] = g;
      }
    }
  }

  /**
   * Air velocity at the midpoint of strip i's bound vortex for the present circulation into `out`: the free stream
   * of its control point (`u0`, as passed to solve) plus the velocity the lattice induces there. Only for a line
   * with a forceAtBound strip; otherwise `out` gets the control point's velocity.
   */
  boundVelocity(i: number, u0: Float64Array, out: MutableVec3): void {
    const { n, gamma, bx, by, bz } = this;
    if (!bx || !by || !bz) {
      out.x = this.velocity[3 * i];
      out.y = this.velocity[3 * i + 1];
      out.z = this.velocity[3 * i + 2];
      return;
    }
    let x = u0[3 * i], y = u0[3 * i + 1], z = u0[3 * i + 2];
    const row = i * n;
    for (let j = 0; j < n; j++) {
      const g = gamma[j];
      x += bx[row + j] * g;
      y += by[row + j] * g;
      z += bz[row + j] * g;
    }
    out.x = x;
    out.y = y;
    out.z = z;
  }

  /** Build the Jacobian dR/dG at the state of the last residual evaluation and factorise it; false if singular. */
  private factorJacobian(): boolean {
    const { n, strips, at, an, jac, ut, un, dcl, viscosity, prev, next, weight, piv } = this;
    {
      // Jacobian dR/dG = I - 0.5 c w (cl dQ/dG + Q cl' dalpha/dG).
      for (let i = 0; i < n; i++) {
        const row = i * n;
        if (strips[i].carryover) {
          jac.fill(0, row, row + n);
          jac[row + i] = 1;
          jac[row + i - 1] = -0.5;
          jac[row + i + 1] = -0.5;
          continue;
        }
        const hc = 0.5 * strips[i].chord * weight[i];
        const vt = ut[i], vn = un[i];
        const q = Math.max(this.speed[i], 1e-3);
        const clq = this.cl[i] / q;
        const dq = dcl[i] / q;
        for (let j = 0; j < n; j++) {
          const a_t = at[row + j], a_n = an[row + j];
          // dQ = (vt a_t + vn a_n)/Q, dalpha = (vt a_n - vn a_t)/Q^2
          jac[row + j] = -hc * (clq * (vt * a_t + vn * a_n) + dq * (vt * a_n - vn * a_t));
        }
        jac[row + i] += 1;
        const mu = viscosity[i];
        if (mu > 0) {
          if (prev[i] >= 0) {
            jac[row + i] += mu;
            jac[row + prev[i]] -= mu;
          }
          if (next[i] >= 0) {
            jac[row + i] += mu;
            jac[row + next[i]] -= mu;
          }
        }
      }
    }
    return luFactor(n, jac, piv);
  }

  /**
   * Residuals R(G) of the current circulation into `rhs` (with the local flow, alpha, cl and cl' of every strip
   * left in the instance arrays); returns the largest |R| and the circulation scale it is judged against.
   */
  private residuals(u0: Float64Array, sections: SectionLift): { maxRes: number; scale: number } {
    const { n, strips, gamma, ax, ay, az, rhs, ut, un, dcl, coeffs, viscosity, prev, next, weight, result } = this;
    let maxRes = 0;
    let scale = 1e-6;
    for (let i = 0; i < n; i++) {
      const st = strips[i];
      let ux = u0[3 * i], uy = u0[3 * i + 1], uz = u0[3 * i + 2];
      const row = i * n;
      for (let j = 0; j < n; j++) {
        const g = gamma[j];
        ux += ax[row + j] * g;
        uy += ay[row + j] * g;
        uz += az[row + j] * g;
      }
      const vt = ux * st.t.x + uy * st.t.y + uz * st.t.z;
      const vn = ux * st.n.x + uy * st.n.y + uz * st.n.z;
      const q = Math.sqrt(vt * vt + vn * vn);
      const alpha = Math.atan2(vn, vt);
      const half = 0.5 * st.chord * q;
      if (st.carryover) {
        coeffs.cl = half > 1e-9 ? gamma[i] / half : 0;
        coeffs.dcl = 0;
        rhs[i] = 0.5 * (gamma[i - 1] + gamma[i + 1]) - gamma[i];
      } else {
        sections.sectionLift(i, alpha, coeffs);
        rhs[i] = weight[i] * half * coeffs.cl - gamma[i];
        const mu = viscosity[i];
        if (mu > 0) {
          if (prev[i] >= 0) rhs[i] += mu * (gamma[prev[i]] - gamma[i]);
          if (next[i] >= 0) rhs[i] += mu * (gamma[next[i]] - gamma[i]);
        }
      }
      this.velocity[3 * i] = ux;
      this.velocity[3 * i + 1] = uy;
      this.velocity[3 * i + 2] = uz;
      this.alpha[i] = alpha;
      this.speed[i] = q;
      this.cl[i] = coeffs.cl;
      ut[i] = vt;
      un[i] = vn;
      dcl[i] = coeffs.dcl;
      maxRes = Math.max(maxRes, Math.abs(rhs[i]));
      scale = Math.max(scale, half);
    }
    result.maxRes = maxRes;
    result.scale = scale;
    return result;
  }
}

/** Largest section lift coefficient used to cap a strip's circulation in its free stream. */
const CL_CAP = 3.5;
/** Halvings of a Newton step that raised the residual before it is accepted anyway. */
const MAX_BACKTRACK = 3;
/** Free-stream angle of attack (from the leading edge) over which the bound circulation fades out, rad. */
const CIRCULATION_FADE_START = (45 * Math.PI) / 180;
const CIRCULATION_FADE_END = (75 * Math.PI) / 180;

/**
 * Fraction of a strip's section lift that is represented by bound circulation (and so induces velocity on the
 * rest of the lattice): 1 in the lifting line's range, fading to 0 as the flow turns broadside and beyond
 * (reverse flow included).
 */
export function circulatoryWeight(alpha: number): number {
  const a = Math.abs(alpha);
  if (a <= CIRCULATION_FADE_START) return 1;
  if (a >= CIRCULATION_FADE_END) return 0;
  const x = (CIRCULATION_FADE_END - a) / (CIRCULATION_FADE_END - CIRCULATION_FADE_START);
  return x * x * (3 - 2 * x);
}

/**
 * Induced velocity of one lattice (the wing) at arbitrary points (tail control points, fuselage
 * stations), using a separately supplied circulation (e.g. lagged by the convection time). The trailing legs run
 * along each strip's chord to its trailing edge before following the wake direction, so the sheet the tail sees
 * starts where the real one does.
 *
 * The influence depends on the direction of the trailing legs (the wake). Rebuilding the matrices for every
 * small change of that direction is too costly, and rebuilding only past a threshold makes the tail load
 * jump. So each rebuild also builds the matrices for the wake turned by a small angle in two directions normal
 * to it, and addInduced() corrects linearly for the wake's current direction: the induced field is
 * continuous in the wake direction and exact at the built one.
 */
export class WakeCoupling {
  private readonly nt: number;
  private readonly ns: number;
  /** Base matrices (x, y, z) and their changes per radian of wake turn along e1 and e2. */
  private readonly m: Float64Array[];
  private built: Vec3 = { x: -1, y: 0, z: 0 };
  /** Unit vectors normal to the built wake direction along which the derivatives were taken. */
  private e1: Vec3 = { x: 0, y: 0, z: 1 };
  private e2: Vec3 = { x: 0, y: 1, z: 0 };
  private ground: GroundPlane | null = null;
  private derivativesBuilt = false;
  /** Current wake direction's offsets from the built one along e1 and e2 (tangent of the angle). */
  private dEl = 0;
  private dAz = 0;

  constructor(
    private readonly sources: readonly Strip[],
    private readonly targets: readonly Vec3[],
    private readonly core: number,
  ) {
    this.nt = targets.length;
    this.ns = sources.length;
    this.m = Array.from({ length: 9 }, () => new Float64Array(this.nt * this.ns));
  }

  rebuild(wake: Vec3, ground: GroundPlane | null): void {
    const [ax, ay, az] = this.m;
    fillInfluence(this.targets, this.sources, wake, this.core, ground, ax, ay, az, true);
    this.built = wake;
    this.ground = ground;
    this.derivativesBuilt = false;
    this.dEl = this.dAz = 0;
  }

  /** The derivative matrices, built on first use after a rebuild (a rebuild for a ground change alone rarely needs them). */
  private buildDerivatives(): void {
    const { built: wake, ground } = this;
    const [ax, ay, az, ex, ey, ez, zx, zy, zz] = this.m;
    // Two directions normal to the wake (any orthonormal pair; the correction is a tangent-plane expansion).
    const ref = Math.abs(wake.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
    const e1 = v3.normalize(v3.cross(wake, ref));
    const e2 = v3.cross(wake, e1);
    fillInfluence(this.targets, this.sources, v3.normalize(v3.addScaled(wake, e1, PERTURBATION)), this.core, ground, ex, ey, ez, true);
    fillInfluence(this.targets, this.sources, v3.normalize(v3.addScaled(wake, e2, PERTURBATION)), this.core, ground, zx, zy, zz, true);
    for (let k = 0; k < ax.length; k++) {
      ex[k] = (ex[k] - ax[k]) / PERTURBATION;
      ey[k] = (ey[k] - ay[k]) / PERTURBATION;
      ez[k] = (ez[k] - az[k]) / PERTURBATION;
      zx[k] = (zx[k] - ax[k]) / PERTURBATION;
      zy[k] = (zy[k] - ay[k]) / PERTURBATION;
      zz[k] = (zz[k] - az[k]) / PERTURBATION;
    }
    this.e1 = e1;
    this.e2 = e2;
    this.derivativesBuilt = true;
  }

  /** Direction the matrices were built for. */
  get builtWake(): Vec3 {
    return this.built;
  }

  /** Current wake direction (unit, body axes); addInduced() corrects the built influence for it. */
  setWake(wake: Vec3): void {
    const along = v3.dot(wake, this.built);
    // Within ~0.05 deg of the built direction no correction is needed (nor the derivative matrices).
    if (!(along > 0.5) || along > 1 - 4e-7) {
      this.dEl = this.dAz = 0;
      return;
    }
    if (!this.derivativesBuilt) this.buildDerivatives();
    this.dEl = v3.dot(wake, this.e1) / along;
    this.dAz = v3.dot(wake, this.e2) / along;
  }

  /** Add the velocity induced by source circulations `gamma` to the target velocities `u` (xyz interleaved). */
  addInduced(gamma: Float64Array, u: Float64Array): void {
    const { nt, ns, dEl, dAz } = this;
    const [ax, ay, az, ex, ey, ez, zx, zy, zz] = this.m;
    if (dEl === 0 && dAz === 0) {
      for (let i = 0; i < nt; i++) {
        const row = i * ns;
        let x = 0, y = 0, z = 0;
        for (let j = 0; j < ns; j++) {
          const g = gamma[j];
          x += ax[row + j] * g;
          y += ay[row + j] * g;
          z += az[row + j] * g;
        }
        u[3 * i] += x;
        u[3 * i + 1] += y;
        u[3 * i + 2] += z;
      }
      return;
    }
    for (let i = 0; i < nt; i++) {
      const row = i * ns;
      let x = 0, y = 0, z = 0;
      for (let j = 0; j < ns; j++) {
        const g = gamma[j];
        const k = row + j;
        x += (ax[k] + dEl * ex[k] + dAz * zx[k]) * g;
        y += (ay[k] + dEl * ey[k] + dAz * zy[k]) * g;
        z += (az[k] + dEl * ez[k] + dAz * zz[k]) * g;
      }
      u[3 * i] += x;
      u[3 * i + 1] += y;
      u[3 * i + 2] += z;
    }
  }
}

/** Finite-difference step of the wake-direction derivatives, rad. */
const PERTURBATION = 1 * (Math.PI / 180);
