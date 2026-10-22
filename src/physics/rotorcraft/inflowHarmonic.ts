// First-harmonic (Pitt-Peters) inflow for a hingeless main rotor: the two harmonic states of the 3-state dynamic
// inflow model. Owner: RC. Plan revision 2, section 4 item 3; docs/rotor-hingeless-model.md.
//
// SOURCE. Chen, R. T. N., "A survey of nonuniform inflow models for rotorcraft flight dynamics and control
// applications", NASA TM-102219 (1989; NTRS 19900006622), section 3-4: the Pitt-Peters gain matrix in wake-skew form
// (eq 13b) with the mass-flow parameter (eq 14), and the apparent-mass matrix (eqs 17-18); P. The plan pointed at
// NASA TM-88327 (Chen & Hindson 1986, NTRS 19870015049), which carries only the UNIFORM mode (its eqs 4-5, the
// M11 = 128/(75 pi) that rotor.ts's inflowTimeConstant already uses); the harmonic rows are in TM-102219.
//
// Pitt-Peters (TM-102219 eqs 13, 17): [M] d/dt{v0, vs, vc} + [L]^-1 {v0, vs, vc} = {CT, Cl, Cm}, nondimensional on
// Omega R and rho pi R^2 (Omega R)^2 (R), time Omega t, with
//   L = [ 1/(2 vT)                  0                   15 pi/(64 vm) tan(chi/2) ]
//       [ 0                         -4/(vm(1+cos chi))   0                        ]
//       [ 15 pi/(64 vT) tan(chi/2)  0                   -4 cos chi/(vm(1+cos chi)) ]
//   vT = (mu^2 + lambda^2)^1/2, vm = (mu^2 + lambda (lambda + v0)) / vT,   M = diag(8/(3 pi), 16/(45 pi), 16/(45 pi)),
// where psi = 0 is DOWNWIND (aft in forward flight), lambda the total inflow ratio through the disc, chi the wake skew
// angle atan(mu / lambda), and Cl, Cm moment coefficients whose sign makes L22, L33 negative.
//
// WHAT THIS MODULE KEEPS (AGENT choices, docs):
//  - The uniform mode stays rotor.ts's momentum inflow and time constant, untouched. So the coupling is ONE-WAY: the
//    harmonics take CT through L31 and the moments through L22/L33; the L13 feedback (pitch moment -> v0) and the
//    v0-rate term of the cosine row are dropped. L31 is the total-value form 15 pi/(64 vT) tan(chi/2) (eq 13b); with
//    momentum v0 = CT/(2 vT) it gives the classic downwind gradient vc/v0 = (15 pi/32) tan(chi/2) (plan R9).
//  - Each harmonic row is integrated in its "time-constant" form: tau_row = |L_row| x 16/(45 pi) / Omega, target
//    L_row x C (L x M with the off-diagonal v0-rate term dropped), exactly (linear) over dt > 0.
//  - Sign convention made physical, not left to the coefficient signs: more lift on one side of the disc gives more
//    downwash on that side; thrust in forward flight gives more downwash at the REAR (downwind) of the disc.
//  - inducedFactor and ground effect act on the uniform state only (plan 4 item 3): the gains use the momentum
//    induced velocity, out of ground effect. The wake skew uses |lambda| (an upward autorotative wake is skewed like a
//    downward one), and vm is floored at 2 v0 (its hover value) and 0.01: momentum theory fails in the vortex ring, and
//    a zero-thrust rotor would otherwise have an infinite gain.
//
// STATE. RotorcraftState.harmonicInflow {cos, sin}, m/s, shaft axes, in the articulated solver's azimuth (psi = 0
// FORWARD, e_r = (cos psi, -sin psi): Pitt-Peters' psi = 0 is aft, so the two differ by pi). A blade element at radius r
// sees the extra normal flow (r/R)(cos cos psi + sin sin psi). As a vector in the shaft plane, the downwash gradient is
// g = (cos, -sin): the extra downwash at the point r e is (r/R) g . e.

/** Apparent mass of the first-harmonic states (TM-102219 eq 18): 16/(45 pi). */
export const HARMONIC_APPARENT_MASS = 16 / (45 * Math.PI);

export interface HarmonicInflowGains {
  /** Wake skew angle chi, rad (0 hover, pi/2 edgewise). */
  skew: number;
  /** vT and vm of TM-102219 eqs 13-14 (nondimensional on Omega R). */
  total: number; massFlow: number;
  /** |L33|: downwind gradient per unit pitch-moment coefficient (4 cos chi / (vm (1 + cos chi))). */
  downwind: number;
  /** |L22|: crosswind gradient per unit roll-moment coefficient (4 / (vm (1 + cos chi))). */
  crosswind: number;
  /** L31: downwind gradient per unit thrust coefficient (15 pi / (64 vT) tan(chi/2)). */
  thrust: number;
}

/**
 * The harmonic rows of the Pitt-Peters gain matrix (TM-102219 eqs 13b, 14) for advance ratio `mu` (in-plane speed /
 * tip speed), total inflow ratio `lambda` (flow through the disc, positive down) and momentum induced ratio `induced`.
 */
export function harmonicInflowGains(mu: number, lambda: number, induced: number): HarmonicInflowGains {
  const through = Math.abs(lambda), total = Math.max(Math.hypot(mu, through), 1e-9);
  const massFlow = Math.max((mu * mu + through * (through + Math.abs(induced))) / total, 2 * Math.abs(induced), 0.01);
  const skew = Math.atan2(mu, through), c = Math.cos(skew);
  return { skew, total, massFlow, downwind: 4 * c / (massFlow * (1 + c)), crosswind: 4 / (massFlow * (1 + c)),
    thrust: 15 * Math.PI / (64 * total) * Math.tan(skew / 2) };
}

export interface HarmonicInflowInput {
  /** Rotor speed rad/s, radius m, air density kg/m^3. */
  omega: number; radius: number; density: number;
  /** Hub velocity relative to the air in the shaft plane (shaft x forward, y right), m/s. */
  inPlane: { x: number; y: number };
  /** Flow through the disc, m/s, positive down (the momentum induced velocity plus the descent along the shaft). */
  through: number;
  /** Momentum (uniform, out-of-ground-effect, no inducedFactor) induced velocity, m/s. */
  induced: number;
  /** Rotor thrust, N. */
  thrust: number;
  /** Aerodynamic hub moment about the shaft, N m, shaft axes: x roll (+ right), y pitch (+ nose up). */
  moment: { x: number; y: number };
}

/** Steady targets and time constants of the two harmonic states, in the state's own {cos, sin} form (m/s, s). */
export function harmonicInflowTarget(i: HarmonicInflowInput): { cos: number; sin: number;
  tauDownwind: number; tauCrosswind: number; downwind: { x: number; y: number }; gains: HarmonicInflowGains } {
  const tip = i.omega * i.radius, speed = Math.hypot(i.inPlane.x, i.inPlane.y);
  const gains = harmonicInflowGains(speed / tip, i.through / tip, i.induced / tip);
  // Downwind unit vector w (where the wake goes: against the hub's motion); crosswind n = w turned +90 deg.
  const w = speed > 1e-9 ? { x: -i.inPlane.x / speed, y: -i.inPlane.y / speed } : { x: -1, y: 0 };
  const n = { x: -w.y, y: w.x };
  // First moment of lift, m = sum L r e: m.x = pitch moment, m.y = -roll moment (e_r = (cos psi, -sin psi)).
  const scale = i.density * Math.PI * i.radius ** 3 * tip * tip;
  const mx = i.moment.y / scale, my = -i.moment.x / scale;
  const ct = i.thrust / (i.density * Math.PI * i.radius * i.radius * tip * tip);
  const gw = (gains.thrust * ct + gains.downwind * (mx * w.x + my * w.y)) * tip;
  const gn = gains.crosswind * (mx * n.x + my * n.y) * tip;
  // Gradient vector g = gw w + gn n; state {cos, sin} = (g.x, -g.y).
  const gx = gw * w.x + gn * n.x, gy = gw * w.y + gn * n.y;
  return { cos: gx, sin: -gy, tauDownwind: gains.downwind * HARMONIC_APPARENT_MASS / i.omega,
    tauCrosswind: gains.crosswind * HARMONIC_APPARENT_MASS / i.omega, downwind: w, gains };
}

/**
 * Advance the harmonic inflow states over dt > 0: each wind-axis component relaxes exactly to its target with its own
 * time constant (dt = 0 returns the state unchanged). A stopped rotor has no wake: the states are zero.
 */
export function advanceHarmonicInflow(state: { cos: number; sin: number }, dt: number, i: HarmonicInflowInput): { cos: number; sin: number } {
  if (!(dt > 0)) return { ...state };
  if (!(i.omega > 0) || !(i.radius > 0)) return { cos: 0, sin: 0 };
  const t = harmonicInflowTarget(i), w = t.downwind, n = { x: -w.y, y: w.x };
  const g = { x: state.cos, y: -state.sin }, target = { x: t.cos, y: -t.sin };
  const relax = (value: number, goal: number, tau: number) => tau > 0 ? goal + (value - goal) * Math.exp(-dt / tau) : goal;
  const gw = relax(g.x * w.x + g.y * w.y, target.x * w.x + target.y * w.y, t.tauDownwind);
  const gn = relax(g.x * n.x + g.y * n.y, target.x * n.x + target.y * n.y, t.tauCrosswind);
  const gx = gw * w.x + gn * n.x, gy = gw * w.y + gn * n.y;
  return { cos: gx, sin: -gy };
}
