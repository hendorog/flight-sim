// MBB Bo 105 (DLR S-123) identified stability and control derivatives at 80 kt: AGARD AR-280 "Rotorcraft System
// Identification" (FMP WG-18, 1991), section 6.2, Tables 6.2.8-6.2.11 (printed pp 150-153) and the modes of Table 6.2.13
// (p 154). The rate cross-derivatives Lq, Mp are on the page imaged as Table 6.2.9 (p 151). Tag P for both columns
// (DLR time-domain, AFDD frequency-domain); the report itself calls these two (with NAE) the most satisfactory sets.
// Flight condition (AR-280 p 36, p 145): level flight at 80 kt, density altitude about 3000 ft, 2100-2250 kg; the
// aircraft data of Table 6.2.1: 2200 kg, Ixx 1433, Iyy 4973, Izz 4099, Ixz 660 kg m^2.
//
// FORM. The derivatives are "specific" (per unit mass or inertia) STATE-MATRIX entries: the Ixz inertia coupling is
// folded in, as in oh6a.ts's primed L', N'. D: assembled that way (this file's `linearModel`, U0 = 80 kt, theta0 -2 deg)
// the DLR set reproduces the DLR modes of Table 6.2.13 (roll 1/T 8.49 against 8.49; Dutch roll [0.14, 2.53] against
// [0.14, 2.50]; phugoid [-0.16, 0.33] against [-0.15, 0.33]; aperiodic pitch 4.37 / 0.60 against 4.36 / 0.60); read as
// L/Ixx with the Ixz coupling outside, the roll mode would come out at 9.8 (tests/rotorcraft/hingelessAr280.test.ts).
// The trim pitch theta0 is not printed: -2 deg is an ESTIMATE (plan 6.2's 80 KIAS attitude band) that moves only the
// spiral and phugoid in the second decimal.
//
// Rows X, Y, Z (force/mass) and L, M, N (moment/inertia); columns U, W, Q, V, P, R (per m/s and per rad/s) and the
// controls Dcol, Dlon, Dlat, Dped per "%" (assumed % of full control travel, research-bo105 section 8, gap 4). Signs as
// printed: +lon gives M > 0 (aft stick, nose up), +lat gives L > 0 (right), +ped gives N > 0 (right pedal, nose right),
// +col gives Z < 0 (up). Entries the identification eliminated ("0*") are 0. Table 6.2.9 has no Nu row: 0.

export interface Ar280Set {
  name: string;
  /** Trim: speed along x, m/s, and pitch, rad. */
  u0: number; theta0: number;
  /** [U, W, Q, V, P, R, Dcol, Dlon, Dlat, Dped]. */
  X: number[]; Y: number[]; Z: number[]; L: number[]; M: number[]; N: number[];
  /** Equivalent control time delays, s (Table 6.2.12): col, lon, lat, ped. */
  delay: { col: number; lon: number; lat: number; ped: number };
}
const DEG = Math.PI / 180;
const U0 = 80 * 0.514444;

/** DLR column (P AR-280 Tables 6.2.8-6.2.12). */
export const AR280_DLR: Ar280Set = {
  name: 'DLR', u0: U0, theta0: -2 * DEG,
  X: [-0.059, 0.036, 0, 0, 0, 0, 0, -0.028, 0, 0],
  Y: [0, 0, 0, -0.170, 0, 1.332, 0, 0, 0.003, -0.011],
  Z: [0.014, -0.998, 5.012, 0, 0, 0, -0.349, -0.303, 0, 0],
  L: [-0.081, 0.116, 3.037, -0.271, -8.501, 0.410, 0.032, 0.024, 0.185, -0.028],
  M: [0.029, 0.053, -3.496, 0.048, -0.419, -0.117, 0.057, 0.093, -0.009, 0],
  N: [0, 0.034, 0.809, 0.117, -1.057, -0.858, 0, 0, 0.026, 0.049],
  delay: { col: 0.040, lon: 0.100, lat: 0.060, ped: 0.040 },
};
/** AFDD column (P AR-280 Tables 6.2.8-6.2.12). */
export const AR280_AFDD: Ar280Set = {
  name: 'AFDD', u0: U0, theta0: -2 * DEG,
  X: [-0.0385, -0.061, 2.548, 0, 0.756, 0, -0.046, -0.072, 0, 0],
  Y: [0, -0.083, 4.823, -0.221, -2.030, 0.950, -0.032, 0, 0.066, 0.015],
  Z: [0.2457, -1.187, 7.011, 0, 2.622, 0, -0.388, -0.103, 0, 0],
  L: [-0.061, 0.168, 3.182, -0.207, -8.779, 0.991, 0.058, 0.073, 0.179, -0.027],
  M: [0, 0.096, -4.493, 0.050, -0.998, -0.438, 0.073, 0.098, 0, 0.013],
  N: [0, -0.119, 5.432, 0.082, -0.466, -1.070, -0.051, -0.075, 0.033, 0.057],
  delay: { col: 0.158, lon: 0.113, lat: 0.062, ped: 0.044 },
};

/** Modes of Table 6.2.13 (P): [zeta, omega rad/s] oscillations, 1/T (1/s) subsidences (positive = stable). */
export const AR280_MODES = {
  DLR: { phugoid: { zeta: -0.15, omega: 0.33 }, dutchRoll: { zeta: 0.14, omega: 2.50 }, roll: 8.49,
    pitch: [4.36, 0.60], spiral: 0.02 },
  AFDD: { phugoid: { zeta: -0.36, omega: 0.30 }, dutchRoll: { zeta: 0.22, omega: 2.60 }, roll: 8.32,
    pitch: [6.04, 0.49], spiral: 0.03 },
} as const;
/** AGARD LS-178 paper 14 (Tischler, P): the coupled body-roll / rotor-flap mode at 40 m/s, zeta 0.51, 13.7 rad/s. */
export const LS178_ROLL_FLAP = { zeta: 0.51, omega: 13.7 } as const;

/** Column index of each derivative name in the rows above. */
export const COLUMN = { u: 0, w: 1, q: 2, v: 3, p: 4, r: 5, col: 6, lon: 7, lat: 8, ped: 9 } as const;
export type DerivativeName = `${'X' | 'Y' | 'Z' | 'L' | 'M' | 'N'}${'u' | 'w' | 'q' | 'v' | 'p' | 'r'}`;
export function derivative(k: Ar280Set, name: DerivativeName): number {
  const row = k[name[0] as 'X' | 'Y' | 'Z' | 'L' | 'M' | 'N'];
  return row[COLUMN[name[1] as 'u' | 'w' | 'q' | 'v' | 'p' | 'r']];
}

/**
 * The plan's R18 envelope for one derivative: [min(DLR, AFDD) x 0.7, max(DLR, AFDD) x 1.3] in MAGNITUDE (the two sets
 * share a sign for every row R18 checks). Returns [lower, upper] in signed units.
 */
export function envelope(name: DerivativeName): [number, number] {
  const a = derivative(AR280_DLR, name), b = derivative(AR280_AFDD, name);
  if (Math.sign(a) !== Math.sign(b)) throw new Error(`${name}: DLR and AFDD differ in sign`);
  const lo = Math.min(Math.abs(a), Math.abs(b)) * 0.7, hi = Math.max(Math.abs(a), Math.abs(b)) * 1.3;
  return a > 0 ? [lo, hi] : [-hi, -lo];
}

/**
 * The 8-state linear model x = [u w q theta v p r phi] of a derivative set (oh6a.ts's form): the trim's U0/W0 and the
 * gravity terms added to the aerodynamic derivatives. Row-major 8x8.
 */
export function linearModel(k: Pick<Ar280Set, 'u0' | 'theta0' | 'X' | 'Y' | 'Z' | 'L' | 'M' | 'N'>): number[][] {
  const g = 9.80665, ct = Math.cos(k.theta0), st = Math.sin(k.theta0), tt = Math.tan(k.theta0), w0 = k.u0 * tt;
  const at = (R: number[]) => ({ u: R[0], w: R[1], q: R[2], v: R[3], p: R[4], r: R[5] });
  const X = at(k.X), Y = at(k.Y), Z = at(k.Z), L = at(k.L), M = at(k.M), N = at(k.N);
  return [
    [X.u, X.w, X.q - w0, -g * ct, X.v, X.p, X.r, 0],
    [Z.u, Z.w, Z.q + k.u0, -g * st, Z.v, Z.p, Z.r, 0],
    [M.u, M.w, M.q, 0, M.v, M.p, M.r, 0],
    [0, 0, 1, 0, 0, 0, 0, 0],
    [Y.u, Y.w, Y.q, 0, Y.v, Y.p + w0, Y.r - k.u0, g * ct],
    [L.u, L.w, L.q, 0, L.v, L.p, L.r, 0],
    [N.u, N.w, N.q, 0, N.v, N.p, N.r, 0],
    [0, 0, 0, 0, 0, 1, tt, 0],
  ];
}

export interface Eigen { re: number; im: number }
/**
 * Eigenvalues of a real square matrix: balancing, Householder-free elimination to upper Hessenberg form and the shifted
 * (Francis double-step) QR iteration (the classic balanc / elmhes / hqr sequence). Test helper.
 */
export function eigenvalues(input: readonly (readonly number[])[]): Eigen[] {
  const n = input.length, a = input.map((row) => [...row]);
  // Balance.
  const RADIX = 2;
  for (let done = false; !done;) {
    done = true;
    for (let i = 0; i < n; i++) {
      let r = 0, c = 0;
      for (let j = 0; j < n; j++) if (j !== i) { c += Math.abs(a[j][i]); r += Math.abs(a[i][j]); }
      if (c !== 0 && r !== 0) {
        let g = r / RADIX, f = 1;
        const s = c + r;
        while (c < g) { f *= RADIX; c *= RADIX * RADIX; }
        g = r * RADIX;
        while (c > g) { f /= RADIX; c /= RADIX * RADIX; }
        if ((c + r) / f < 0.95 * s) {
          done = false;
          for (let j = 0; j < n; j++) a[i][j] /= f;
          for (let j = 0; j < n; j++) a[j][i] *= f;
        }
      }
    }
  }
  // Reduce to Hessenberg form by elimination with pivoting.
  for (let m = 1; m < n - 1; m++) {
    let x = 0, i = m;
    for (let j = m; j < n; j++) if (Math.abs(a[j][m - 1]) > Math.abs(x)) { x = a[j][m - 1]; i = j; }
    if (i !== m) {
      for (let j = m - 1; j < n; j++) [a[i][j], a[m][j]] = [a[m][j], a[i][j]];
      for (let j = 0; j < n; j++) [a[j][i], a[j][m]] = [a[j][m], a[j][i]];
    }
    if (x !== 0) {
      for (i = m + 1; i < n; i++) {
        let y = a[i][m - 1];
        if (y !== 0) {
          y /= x; a[i][m - 1] = y;
          for (let j = m; j < n; j++) a[i][j] -= y * a[m][j];
          for (let j = 0; j < n; j++) a[j][m] += y * a[j][i];
        }
      }
    }
  }
  for (let i = 2; i < n; i++) for (let j = 0; j < i - 1; j++) a[i][j] = 0;
  // QR iteration on the Hessenberg matrix.
  const wr = new Array<number>(n).fill(0), wi = new Array<number>(n).fill(0);
  let anorm = 0;
  for (let i = 0; i < n; i++) for (let j = Math.max(i - 1, 0); j < n; j++) anorm += Math.abs(a[i][j]);
  let nn = n - 1, t = 0;
  while (nn >= 0) {
    let its = 0, l: number;
    do {
      for (l = nn; l >= 1; l--) {
        const s = Math.abs(a[l - 1][l - 1]) + Math.abs(a[l][l]);
        if (Math.abs(a[l][l - 1]) + (s === 0 ? anorm : s) === (s === 0 ? anorm : s)) { a[l][l - 1] = 0; break; }
      }
      const x = a[nn][nn];
      if (l === nn) { wr[nn] = x + t; wi[nn--] = 0; }
      else {
        const y = a[nn - 1][nn - 1], w = a[nn][nn - 1] * a[nn - 1][nn];
        if (l === nn - 1) {
          const p = 0.5 * (y - x), q = p * p + w, z = Math.sqrt(Math.abs(q));
          const xx = x + t;
          if (q >= 0) {
            const zz = p + (p >= 0 ? Math.abs(z) : -Math.abs(z));
            wr[nn - 1] = wr[nn] = xx + zz;
            if (zz !== 0) wr[nn] = xx - w / zz;
            wi[nn - 1] = wi[nn] = 0;
          } else {
            wr[nn - 1] = wr[nn] = xx + p;
            wi[nn - 1] = -(wi[nn] = z);
          }
          nn -= 2;
        } else {
          if (its === 60) throw new Error('eigenvalues: no convergence');
          let xs = x, ys = y, ws = w;
          if (its === 10 || its === 20) {
            t += xs;
            for (let i = 0; i <= nn; i++) a[i][i] -= xs;
            const s = Math.abs(a[nn][nn - 1]) + Math.abs(a[nn - 1][nn - 2]);
            ys = xs = 0.75 * s; ws = -0.4375 * s * s;
          }
          ++its;
          let m: number, p = 0, q = 0, r = 0, z: number;
          for (m = nn - 2; m >= l; m--) {
            z = a[m][m];
            r = xs - z;
            const s2 = ys - z;
            p = (r * s2 - ws) / a[m + 1][m] + a[m][m + 1];
            q = a[m + 1][m + 1] - z - r - s2;
            r = a[m + 2][m + 1];
            const s = Math.abs(p) + Math.abs(q) + Math.abs(r);
            p /= s; q /= s; r /= s;
            if (m === l) break;
            const u = Math.abs(a[m][m - 1]) * (Math.abs(q) + Math.abs(r));
            const v = Math.abs(p) * (Math.abs(a[m - 1][m - 1]) + Math.abs(z) + Math.abs(a[m + 1][m + 1]));
            if (u + v === v) break;
          }
          for (let i = m + 2; i <= nn; i++) { a[i][i - 2] = 0; if (i !== m + 2) a[i][i - 3] = 0; }
          for (let k = m; k <= nn - 1; k++) {
            let scale = 0;
            if (k !== m) {
              p = a[k][k - 1]; q = a[k + 1][k - 1]; r = 0;
              if (k !== nn - 1) r = a[k + 2][k - 1];
              scale = Math.abs(p) + Math.abs(q) + Math.abs(r);
              if (scale !== 0) { p /= scale; q /= scale; r /= scale; }
            }
            const s0 = Math.sqrt(p * p + q * q + r * r), s = p >= 0 ? s0 : -s0;
            if (s !== 0) {
              if (k === m) { if (l !== m) a[k][k - 1] = -a[k][k - 1]; }
              else a[k][k - 1] = -s * scale;
              p += s;
              const xk = p / s, yk = q / s, zk = r / s;
              q /= p; r /= p;
              for (let j = k; j <= nn; j++) {
                p = a[k][j] + q * a[k + 1][j];
                if (k !== nn - 1) { p += r * a[k + 2][j]; a[k + 2][j] -= p * zk; }
                a[k + 1][j] -= p * yk; a[k][j] -= p * xk;
              }
              const mmin = nn < k + 3 ? nn : k + 3;
              for (let i = l; i <= mmin; i++) {
                p = xk * a[i][k] + yk * a[i][k + 1];
                if (k !== nn - 1) { p += zk * a[i][k + 2]; a[i][k + 2] -= p * r; }
                a[i][k + 1] -= p * q; a[i][k] -= p;
              }
            }
          }
        }
      }
    } while (l < nn - 1);
  }
  return wr.map((re, i) => ({ re, im: wi[i] }));
}

/** Modes of a set of eigenvalues: oscillations as {zeta, omega} (upper half plane), real roots as 1/T = -re. */
export function modes(e: readonly Eigen[]): { oscillations: { zeta: number; omega: number }[]; subsidences: number[] } {
  const oscillations = e.filter((x) => x.im > 1e-9).map((x) => {
    const omega = Math.hypot(x.re, x.im);
    return { zeta: -x.re / omega, omega };
  }).sort((a, b) => a.omega - b.omega);
  const subsidences = e.filter((x) => Math.abs(x.im) <= 1e-9).map((x) => -x.re).sort((a, b) => a - b);
  return { oscillations, subsidences };
}

/**
 * Body rates (rad/s) after a step of `percent` of full travel of one control, integrated through the 8-state model of
 * the set from trim (RK4, 1 ms); returns p, q, r at `times` and the initial angular accelerations (rad/s^2).
 */
export function respond(k: Ar280Set, control: 'col' | 'lon' | 'lat' | 'ped', percent: number, times: readonly number[]) {
  const A = linearModel(k), j = COLUMN[control];
  const b = [k.X[j], k.Z[j], k.M[j], 0, k.Y[j], k.L[j], k.N[j], 0].map((x) => x * percent);
  const f = (x: number[]) => A.map((row, i) => row.reduce((s, aij, c) => s + aij * x[c], 0) + b[i]);
  let x = [0, 0, 0, 0, 0, 0, 0, 0], t = 0;
  const h = 0.001, out: { t: number; p: number; q: number; r: number }[] = [];
  const accel = f(x);
  for (const end of times) {
    while (t < end - 1e-12) {
      const k1 = f(x), k2 = f(x.map((xi, i) => xi + h / 2 * k1[i])), k3 = f(x.map((xi, i) => xi + h / 2 * k2[i])),
        k4 = f(x.map((xi, i) => xi + h * k3[i]));
      x = x.map((xi, i) => xi + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
      t += h;
    }
    out.push({ t: end, p: x[5], q: x[2], r: x[6] });
  }
  return { pDot: accel[5], qDot: accel[2], rDot: accel[6], at: out };
}
