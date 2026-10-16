// OH-6A stability and control derivatives (Heffley et al., NASA CR-3144, 1979, Table II-3, SI units, body-fixed FRL
// axes; read from the rendered pages 27-28, printed numbering), cases 4 (hover) and 8 (60 kt level), sea level,
// 1157 kg, mid CG. Tag F: the 4-blade OH-6A is the MD 500E's family reference, not the 500E itself.
//
// Rows X, Z, M (force/mass, moment/inertia), Y, L', N' (primed: inertia-coupled); columns U, W, Q, V, P, R (per m/s
// and per rad/s) and the controls DC, DB, DA, DP per cm of cockpit control (Fig II-2: full travel collective 22.9,
// longitudinal 31.8, lateral 29.2, pedal 9.3 cm). Signs as printed: +DB = stick forward (M_DB < 0), +DA = stick right,
// +DP = left pedal (N_DP < 0: nose left).
//
// `respond` integrates the full 8-state linear model (u w q theta v p r phi, the trim's U0/W0 and gravity terms) for
// a step of one control, so the reference includes the couplings a 1-DOF L_delta / L_p reading would miss.

export interface Oh6aCase {
  name: string; theta0: number; u0: number; w0: number;
  /** [U, W, Q, V, P, R, DC, DB, DA, DP] per row. */
  X: number[]; Z: number[]; M: number[]; Y: number[]; L: number[]; N: number[];
}
const DEG = Math.PI / 180;
export const OH6A_HOVER: Oh6aCase = {
  name: 'Case 4, hover', theta0: 1.66 * DEG, u0: 0, w0: 0,
  X: [-0.0257, 0.0113, 0.3972, 0.0004, -0.2494, -0.0185, 0.0260, 0.1032, -0.0034, -0.0039],
  Z: [-0.0422, -0.3404, 0.0050, -0.0440, 0.0177, 0.4495, -0.8812, -0.0019, 0.0013, -0.0046],
  M: [0.0414, -0.0196, -1.7645, -0.0086, 0.3763, 0.0719, -0.0309, -0.2916, 0.0138, -0.0038],
  Y: [0.0158, -0.0194, -0.2573, -0.0435, -0.4104, 0.1045, -0.0069, 0.0046, 0.0617, 0.1841],
  L: [0.0010, -0.0064, -1.1360, -0.1516, -4.9198, -0.2873, 0.0475, 0.0738, 0.5037, -0.0308],
  N: [-0.0861, 0.1018, -0.1724, -0.0054, -1.0748, -0.8645, 0.3743, 0.0194, 0.0780, -1.0109],
};
export const OH6A_60KT: Oh6aCase = {
  name: 'Case 8, 60 kt', theta0: 0.58 * DEG, u0: 30.87, w0: 0.31,
  X: [-0.0314, 0.0107, 0.5506, 0.0015, -0.2234, -0.0156, -0.0057, 0.0930, -0.0044, -0.0072],
  Z: [-0.0371, -0.7150, -0.2152, -0.0210, -0.2914, 0.4056, -0.9955, 0.2211, 0.0032, 0.0052],
  M: [0.0345, -0.0130, -2.4843, -0.0611, 0.2077, 0.2636, 0.1083, -0.2938, 0.0144, 0.0314],
  Y: [0.0009, -0.0186, -0.3047, -0.0836, -0.5919, 0.2062, -0.0039, 0.0062, 0.0602, 0.1912],
  L: [-0.0083, -0.0844, -1.3056, -0.1642, -5.4853, -0.1582, 0.0477, 0.0729, 0.4941, -0.0323],
  N: [-0.0240, -0.0800, 0.5060, 0.2120, -1.1022, -1.4412, 0.1822, 0.0566, 0.0741, -1.0514],
};
/** Fig II-2: full travel, cm. */
export const OH6A_TRAVEL_CM = { DC: 22.9, DB: 31.8, DA: 29.2, DP: 9.3 } as const;
const CONTROL = { DC: 6, DB: 7, DA: 8, DP: 9 } as const;

/**
 * Body rates (rad/s) after a step of `fraction` of the full travel of `control` (signs as Heffley's), integrated
 * from trim; returns p, q, r at `times` and the initial angular accelerations (rad/s^2).
 */
export function respond(k: Oh6aCase, control: keyof typeof CONTROL, fraction: number, times: readonly number[]) {
  const d = fraction * OH6A_TRAVEL_CM[control], j = CONTROL[control], g = 9.80665;
  const ct = Math.cos(k.theta0), st = Math.sin(k.theta0), tt = Math.tan(k.theta0);
  // x = [u, w, q, theta, v, p, r, phi]
  const f = (x: number[]): number[] => {
    const [u, w, q, th, v, p, r, ph] = x, s = [u, w, q, v, p, r];
    const row = (R: number[]) => R.slice(0, 6).reduce((sum, c, i) => sum + c * s[i], 0) + R[j] * d;
    return [
      row(k.X) - k.w0 * q - g * ct * th,
      row(k.Z) + k.u0 * q - g * st * th,
      row(k.M),
      q,
      row(k.Y) + k.w0 * p - k.u0 * r + g * ct * ph,
      row(k.L),
      row(k.N),
      p + tt * r,
    ];
  };
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
