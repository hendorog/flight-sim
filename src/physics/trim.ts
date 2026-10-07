// Trim: find the attitude and control positions for steady, unaccelerated straight flight.
//
// The unknowns are the angle of attack, the lateral attitude (sideslip with wings level or at a fixed bank, or
// bank with zero sideslip), the elevator, aileron and rudder, and either the throttle (for a requested
// flight-path angle) or the flight-path angle (for a fixed throttle, e.g. a glide). The residuals are the six body-axis
// accelerations. They are driven to zero by Newton's method with a forward-difference Jacobian, a
// backtracking line search and box limits on the variables; the plant supplies the accelerations for a
// flight condition in still air with the powerplant at its steady shaft speed.

import { DEG, clamp, quat, type Quat, type Vec3 } from '../core/math';

/** A candidate flight condition handed to the plant. Angles in rad, speeds in m/s. */
export interface TrimCondition {
  altitude: number;
  /** Velocity relative to the air, body axes. */
  velocityBody: Vec3;
  /** Body -> NED. */
  orientation: Quat;
  /** Elevator deflection command before cable stretch, rad (+ = trailing edge down). */
  elevator: number;
  /** Pilot aileron and rudder inputs, [-1, 1]. */
  aileron: number;
  rudder: number;
  throttle: number;
  /** Flap deflection, rad. */
  flaps: number;
}

export interface TrimPlant {
  /** Body-axis accelerations [du, dv, dw (m/s^2), dp, dq, dr (rad/s^2)] of the condition. */
  accelerations(c: TrimCondition, out: Float64Array): void;
}

export interface TrimSpec {
  /** True airspeed, m/s. */
  tas: number;
  altitude: number;
  /** Ground track (= heading of the velocity in still air), rad. */
  track?: number;
  flaps?: number;
  /** Requested flight-path angle (+ = climb), rad; used when `throttle` is not given. */
  flightPathAngle?: number;
  /** Fixed throttle: the flight-path angle becomes the unknown. */
  throttle?: number;
  /**
   * 'wingsLevel' (default): solve the sideslip with zero bank. 'zeroSideslip': solve the bank angle instead.
   * 'steadySlip': a steady-heading sideslip with the pedal held at `rudder`; sideslip and bank are solved.
   */
  lateral?: 'wingsLevel' | 'zeroSideslip' | 'steadySlip' | 'fixedBank';
  /** Pedal input held in a 'steadySlip' trim, [-1, 1] (+ = right). */
  rudder?: number;
  // The members below are for the multi-engine and retractable types. The solver reads `bank` and seeds the rudder
  // from the asymmetric yawing moment with `engineOut`; the plant (the flight model's solveTrim) applies
  // `engineOut`, `gearDown` and `cowlFlaps` to the controls and the drag it evaluates.
  /** Bank held by 'fixedBank', rad, + = right wing down. ('fixedBank': hold `bank`; sideslip, aileron and rudder are solved.) */
  bank?: number;
  /** One engine inoperative: fuel cut on that engine, propeller windmilling (lever forward) or feathered. */
  engineOut?: { index: number; propeller: 'windmilling' | 'feathered' };
  /** Gear position for the trim (drag and moment). Default: the model's present gear state. */
  gearDown?: boolean;
  /** Cowl flap opening per engine for the trim, 0..1. Default: the present controls. */
  cowlFlaps?: readonly number[];
}

export interface TrimResult {
  converged: boolean;
  iterations: number;
  /** Largest remaining acceleration: translational m/s^2 or angular rad/s^2 times REFERENCE_ARM. */
  residual: number;
  alpha: number;
  beta: number;
  roll: number;
  pitch: number;
  heading: number;
  flightPathAngle: number;
  elevator: number;
  aileron: number;
  rudder: number;
  throttle: number;
  flaps: number;
  orientation: Quat;
  /** Velocity relative to the air, body axes. */
  velocityBody: Vec3;
}

/** Arm (m) that makes angular accelerations comparable with translational ones in the convergence test. */
const REFERENCE_ARM = 3;
const TOLERANCE = 1e-5;

export interface NewtonOptions {
  lower: readonly number[];
  upper: readonly number[];
  /** Finite-difference step per variable. */
  step: readonly number[];
  /** Residual weights for the convergence norm (max-norm of weighted residuals). */
  weight?: readonly number[];
  tolerance?: number;
  maxIterations?: number;
}

export interface NewtonResult {
  x: Float64Array;
  residual: number;
  iterations: number;
  converged: boolean;
}

/** Solve A x = b in place by Gaussian elimination with partial pivoting; false if singular. */
function solveLinear(A: Float64Array, b: Float64Array, n: number): boolean {
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[p * n + c])) p = r;
    if (!(Math.abs(A[p * n + c]) > 1e-14)) return false;
    if (p !== c) {
      for (let k = 0; k < n; k++) [A[c * n + k], A[p * n + k]] = [A[p * n + k], A[c * n + k]];
      [b[c], b[p]] = [b[p], b[c]];
    }
    for (let r = c + 1; r < n; r++) {
      const f = A[r * n + c] / A[c * n + c];
      if (f === 0) continue;
      for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k];
      b[r] -= f * b[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r * n + k] * b[k];
    b[r] = s / A[r * n + r];
  }
  return true;
}

/**
 * Damped Newton's method for a square system f(x) = 0 with box limits: forward-difference Jacobian, kept up to
 * date between evaluations by Broyden's rank-one update (each fresh finite-difference Jacobian costs n
 * evaluations, and near the solution the update is as good), with step halving until the weighted residual
 * norm decreases. The Jacobian is rebuilt by finite differences whenever an updated one fails to give a step
 * that at least halves the residual.
 */
export function solveNewton(f: (x: Float64Array, out: Float64Array) => void, x0: ArrayLike<number>, o: NewtonOptions): NewtonResult {
  const n = x0.length;
  const w = o.weight ?? new Array<number>(n).fill(1);
  const tol = o.tolerance ?? TOLERANCE;
  const maxIter = o.maxIterations ?? 40;
  const x = Float64Array.from(x0);
  const r = new Float64Array(n);
  const rt = new Float64Array(n);
  const J = new Float64Array(n * n);
  const A = new Float64Array(n * n);
  const dx = new Float64Array(n);
  const xt = new Float64Array(n);
  const norm = (v: Float64Array) => {
    let m = 0;
    for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(v[i] * w[i]));
    return Number.isFinite(m) ? m : Infinity;
  };
  const project = (v: Float64Array) => {
    for (let i = 0; i < n; i++) v[i] = clamp(v[i], o.lower[i], o.upper[i]);
  };
  const finiteDifferences = () => {
    for (let j = 0; j < n; j++) {
      xt.set(x);
      // Step away from a bound rather than across it.
      const h = x[j] + o.step[j] > o.upper[j] ? -o.step[j] : o.step[j];
      xt[j] += h;
      f(xt, rt);
      for (let i = 0; i < n; i++) J[i * n + j] = (rt[i] - r[i]) / h;
    }
  };
  project(x);
  f(x, r);
  let res = norm(r);
  let it = 0;
  let fresh = false;
  for (; it < maxIter && res > tol; it++) {
    if (!fresh) finiteDifferences();
    A.set(J);
    for (let i = 0; i < n; i++) dx[i] = -r[i];
    if (!solveLinear(A, dx, n)) {
      if (!fresh) break;
      fresh = false;
      continue;
    }
    let lambda = 1;
    let improved = false;
    for (let k = 0; k < 12; k++, lambda *= 0.5) {
      for (let i = 0; i < n; i++) xt[i] = x[i] + lambda * dx[i];
      project(xt);
      f(xt, rt);
      const rtNorm = norm(rt);
      if (rtNorm < res) {
        // Broyden: J += (dr - J ds) ds^T / (ds^T ds) along the step actually taken.
        let ss = 0;
        for (let i = 0; i < n; i++) {
          dx[i] = xt[i] - x[i];
          ss += dx[i] * dx[i];
        }
        if (ss > 0) {
          for (let i = 0; i < n; i++) {
            let jd = 0;
            for (let j = 0; j < n; j++) jd += J[i * n + j] * dx[j];
            const c = (rt[i] - r[i] - jd) / ss;
            for (let j = 0; j < n; j++) J[i * n + j] += c * dx[j];
          }
        }
        const good = lambda === 1 && rtNorm < 0.5 * res;
        x.set(xt);
        r.set(rt);
        res = rtNorm;
        improved = true;
        // Keep the updated Jacobian only while it keeps delivering full, effective steps.
        fresh = good;
        break;
      }
    }
    if (!improved) {
      if (!fresh) break;
      // The updated Jacobian led nowhere: rebuild it by finite differences and try again.
      fresh = false;
    }
  }
  return { x, residual: res, iterations: it, converged: res <= tol };
}

/**
 * Body attitude for a flight condition: angle of attack, sideslip and bank, with the velocity climbing at
 * `gamma` along `track` (Stevens & Lewis, "Aircraft Control and Simulation", rate-of-climb constraint).
 */
export function trimAttitude(alpha: number, beta: number, roll: number, gamma: number, track: number): { orientation: Quat; pitch: number; heading: number } {
  const a = Math.cos(alpha) * Math.cos(beta);
  const b = Math.sin(roll) * Math.sin(beta) + Math.cos(roll) * Math.sin(alpha) * Math.cos(beta);
  const sg = Math.sin(gamma);
  const pitch = Math.atan2(a * b + sg * Math.sqrt(Math.max(a * a - sg * sg + b * b, 0)), a * a - sg * sg);
  // Heading that puts the velocity on the requested track.
  const v = { x: a, y: Math.sin(beta), z: Math.sin(alpha) * Math.cos(beta) };
  const ned = quat.rotate(quat.fromEuler(roll, pitch, 0), v);
  const heading = track - Math.atan2(ned.y, ned.x);
  const orientation = quat.fromEuler(roll, pitch, heading);
  return { orientation, pitch, heading: quat.toEuler(orientation).heading };
}

/** Trim for steady straight flight. */
export function trimFlight(plant: TrimPlant, spec: TrimSpec): TrimResult {
  const fixedThrottle = spec.throttle !== undefined;
  const zeroSideslip = spec.lateral === 'zeroSideslip';
  const slip = spec.lateral === 'steadySlip';
  const bank = spec.lateral === 'fixedBank' ? (spec.bank ?? 0) : 0;
  const track = spec.track ?? 0;
  const flaps = spec.flaps ?? 0;
  const V = spec.tas;
  const cond: TrimCondition = {
    altitude: spec.altitude,
    velocityBody: { x: V, y: 0, z: 0 },
    orientation: quat.identity(),
    elevator: 0,
    aileron: 0,
    rudder: 0,
    throttle: spec.throttle ?? 0,
    flaps,
  };
  // x = [alpha, beta or roll, elevator, aileron, rudder (or roll in a steady slip), throttle or gamma]
  const apply = (x: ArrayLike<number>) => {
    const alpha = x[0];
    const beta = zeroSideslip ? 0 : x[1];
    const roll = zeroSideslip ? x[1] : slip ? x[4] : bank;
    const gamma = fixedThrottle ? x[5] : (spec.flightPathAngle ?? 0);
    const att = trimAttitude(alpha, beta, roll, gamma, track);
    cond.orientation = att.orientation;
    cond.velocityBody = { x: V * Math.cos(alpha) * Math.cos(beta), y: V * Math.sin(beta), z: V * Math.sin(alpha) * Math.cos(beta) };
    cond.elevator = x[2];
    cond.aileron = x[3];
    cond.rudder = slip ? (spec.rudder ?? 0) : x[4];
    if (!fixedThrottle) cond.throttle = x[5];
    return { alpha, beta, roll, gamma, ...att };
  };
  const residual = (x: Float64Array, out: Float64Array) => {
    apply(x);
    plant.accelerations(cond, out);
  };
  const lastLower = fixedThrottle ? -30 * DEG : 0;
  const lastUpper = fixedThrottle ? 30 * DEG : 1;
  const x0 = [4 * DEG, 0, -3 * DEG, 0, 0, fixedThrottle ? -3 * DEG : 0.6];
  if (spec.engineOut && !slip) {
    // One engine out: start with half the pedal against the asymmetric yawing moment (right pedal, +, against a
    // nose-left yaw acceleration), so Newton does not start on the wrong side of a rudder near its stop.
    const r = new Float64Array(6);
    residual(Float64Array.from(x0), r);
    if (r[5] !== 0 && Number.isFinite(r[5])) x0[4] = -0.5 * Math.sign(r[5]);
  }
  const sol = solveNewton(residual, x0, {
    lower: [-10 * DEG, slip ? -30 * DEG : -20 * DEG, -40 * DEG, -1, slip ? -45 * DEG : -1, lastLower],
    upper: [30 * DEG, slip ? 30 * DEG : 20 * DEG, 30 * DEG, 1, slip ? 45 * DEG : 1, lastUpper],
    step: [1e-4, 1e-4, 1e-4, 1e-4, 1e-4, 1e-4],
    weight: [1, 1, 1, REFERENCE_ARM, REFERENCE_ARM, REFERENCE_ARM],
  });
  // Leave the plant (e.g. the powerplant's shaft speed) at the solution.
  residual(sol.x, new Float64Array(6));
  const s = apply(sol.x);
  return {
    converged: sol.converged,
    iterations: sol.iterations,
    residual: sol.residual,
    alpha: s.alpha,
    beta: s.beta,
    roll: s.roll,
    pitch: s.pitch,
    heading: s.heading,
    flightPathAngle: s.gamma,
    elevator: cond.elevator,
    aileron: cond.aileron,
    rudder: cond.rudder,
    throttle: cond.throttle,
    flaps,
    orientation: s.orientation,
    velocityBody: cond.velocityBody,
  };
}
