import { v3, type Vec3 } from '../../core/math';
import type { RotorDefinition } from './definition';

/** Per-blade mass integrals about distinct flap/lag pins, SI. Polar inertia is about the mast.
 * These must come from a blade mass survey; uniformBladeMoments is an explicitly estimated fallback. */
export interface BladeMassMoments {
  mass: number; polar: number; flapFirst: number; flapInertia: number; lagFirst: number; lagInertia: number;
}
export function uniformBladeMoments(mass: number, root: number, tip: number, flap: number, lag: number): BladeMassMoments {
  const mean = (root + tip) / 2, square = (root * root + root * tip + tip * tip) / 3;
  return { mass, polar: mass * square,
    flapFirst: mass * (mean - flap), flapInertia: mass * (square - 2 * flap * mean + flap * flap),
    lagFirst: mass * (mean - lag), lagInertia: mass * (square - 2 * lag * mean + lag * lag) };
}
export interface ArticulatedGeometry {
  flapOffset: number; lagOffset: number; blade: BladeMassMoments;
}
export interface ArticulatedParameters extends ArticulatedGeometry {
  /** Kelvin–Voigt approximation at a local tangential attachment; N/m, Ns/m and metres.
   * Not a measured elastomer hysteresis law. Positive coefficients dissipate energy. */
  damper: { arm: number; stiffness: number; damping: number };
}
export interface FlapHarmonics { cone: number; cosine: number; sine: number }
export interface HingeForcing extends FlapHarmonics { damping: number }

/** Pitch/normal-force quadrature about the actual flap pin. Azimuth increases CCW viewed above:
 * er=(cos psi,-sin psi,0), beta positive up; disc axis=(-betaCos,+betaSin,-1).
 * betaDot includes azimuth transport and body p/q, so body-rate coupling is aerodynamic/inertial,
 * not a separately fitted fuselage damper. Linear attached-flow reduction, not a stall model. */
export function flapForcing(d: RotorDefinition, p: ArticulatedGeometry, omega: number, density: number,
  collective: number, pitchCos: number, pitchSin: number, air: Vec3, inflow: number, bodyRate: Vec3, rotation: 1 | -1 = 1): HingeForcing {
  let cone = 0, cosine = 0, sine = 0, damping = 0;
  const n = 12, azimuths = 16, dr = (d.radius - d.rootCutout) / n;
  for (let j = 0; j < azimuths; j++) {
    const psi = (j + 0.5) * 2 * Math.PI / azimuths, cs = Math.cos(psi), sn = Math.sin(psi);
    for (let i = 0; i < n; i++) {
      const r = d.rootCutout + (i + 0.5) * dr, arm = r - p.flapOffset;
      const ut = omega * r - rotation * (air.x * sn + air.y * cs);
      const up = inflow - air.z + r * (bodyRate.y * cs + bodyRate.x * sn);
      const theta = collective + d.twist * (r / d.radius - 0.75) + pitchCos * cs + pitchSin * sn;
      const k = 0.5 * density * d.liftSlope * d.chord * dr / azimuths;
      // Signed tangential relative speed keeps this linear normal-flow reduction finite through
      // startup/reversed root flow. A Taylor expansion in advance ratio is singular at zero RPM.
      // Stall remains in the mean-load BEM; this harmonic hinge forcing is attached-flow only.
      const moment = k * Math.abs(ut) * (ut * theta - up) * arm;
      cone += moment; cosine += 2 * moment * cs; sine += 2 * moment * sn;
      damping += k * Math.abs(ut) * arm * arm;
    }
  }
  // 2 w_body × v_blade supplies the inertial p/q forcing, integrated about the flap pin.
  const transport = 2 * rotation * omega * (p.blade.flapInertia + p.flapOffset * p.blade.flapFirst);
  cosine -= transport * bodyRate.x;
  sine += transport * bodyRate.y;
  return { cone, cosine, sine, damping };
}

/** Steady rotating first harmonic: [K-IΩ²,CΩ;-CΩ,K-IΩ²] beta = M.
 * The off-diagonal terms carry precession. Reversing rotation mirrors the phase, not control sense. */
export function harmonicFlap(p: ArticulatedGeometry, omega: number, forcing: HingeForcing,
  rotation: 1 | -1): FlapHarmonics {
  const stiffness = omega * omega * (p.blade.flapInertia + p.flapOffset * p.blade.flapFirst);
  const delta = stiffness - p.blade.flapInertia * omega * omega;
  const cross = rotation * forcing.damping * omega, determinant = delta * delta + cross * cross;
  return { cone: stiffness > 0 ? forcing.cone / stiffness : 0,
    cosine: determinant > 0 ? (delta * forcing.cosine - cross * forcing.sine) / determinant : 0,
    sine: determinant > 0 ? (cross * forcing.cosine + delta * forcing.sine) / determinant : 0 };
}

/** Offset hinge reaction, averaged over equally spaced blades. The common vertical root reaction
 * cancels in roll/pitch. B/2 multiplies the first harmonic. This is not proportional to rotor thrust. */
export function hingeMoment(p: ArticulatedGeometry, blades: number, omega: number, flap: FlapHarmonics): Vec3 {
  const k = blades / 2 * p.flapOffset * p.blade.flapFirst * omega * omega;
  return { x: k * flap.sine, y: k * flap.cosine, z: 0 };
}

export interface LagState { angle: number; rate: number }
/** centrifugalEnergy is an effective rotating-frame potential, not total inertial rotor energy. */
export interface LagStep { state: LagState; elasticEnergy: number; centrifugalEnergy: number; dissipation: number; forcingWork: number }
/** Small-angle lag DOF integrated with implicit midpoint. This exact discrete work balance is
 * useful for testing the damper; it does NOT establish rotor/body or ground-resonance coupling.
 * Applied forcing includes aerodynamic hinge torque and shaft acceleration; coning supplies the
 * leading Coriolis term 2 I Ω beta betaDot. Positive lag follows the rotation direction. */
export function stepLag(p: ArticulatedParameters, state: LagState, omega: number, omegaDot: number,
  beta: number, betaDot: number, aerodynamicTorque: number, dt: number): LagStep {
  const inertia = p.blade.lagInertia, arm2 = p.damper.arm ** 2;
  const elastic = p.damper.stiffness * arm2, centrifugal = omega * omega * p.lagOffset * p.blade.lagFirst;
  const stiffness = elastic + centrifugal, damping = p.damper.damping * arm2;
  const forcing = aerodynamicTorque - (inertia + p.lagOffset * p.blade.lagFirst) * omegaDot +
    2 * inertia * omega * beta * betaDot;
  const rate = ((inertia - dt * damping / 2 - dt * dt * stiffness / 4) * state.rate +
    dt * (forcing - stiffness * state.angle)) / (inertia + dt * damping / 2 + dt * dt * stiffness / 4);
  const meanRate = (state.rate + rate) / 2, angle = state.angle + dt * meanRate;
  return { state: { angle, rate }, elasticEnergy: 0.5 * elastic * angle * angle,
    centrifugalEnergy: 0.5 * centrifugal * angle * angle,
    dissipation: damping * meanRate * meanRate * dt, forcingWork: forcing * meanRate * dt };
}

/** Rotor angular momentum for the small-angle harmonic disc, excluding hub/body locked inertia.
 * Loads passed to the existing body integrator must include w×H once to cancel its rigid-disc
 * subtraction when hinge reactions are supplied explicitly; otherwise bending is double-counted. */
export function discMomentum(polarInertia: number, omega: number, rotation: 1 | -1, flap: FlapHarmonics): Vec3 {
  return v3.scale(v3.normalize({ x: -flap.cosine, y: flap.sine, z: -1 }), rotation * polarInertia * omega);
}

/** Estimate blade mass moments from total polar inertia and a uniform radial distribution.
 * Only used by the reduced articulated path: its installation must identify that assumption.
 * Teetering aircraft never enter here. No hidden mutable blade state is introduced. */
export function estimatedArticulatedGeometry(d: RotorDefinition, flapOffset: number, lagOffset: number): ArticulatedGeometry {
  const square = (d.rootCutout ** 2 + d.rootCutout * d.radius + d.radius ** 2) / 3;
  return { flapOffset, lagOffset,
    blade: uniformBladeMoments(d.inertia / d.blades / square, d.rootCutout, d.radius, flapOffset, lagOffset) };
}

/** Slow-amplitude flap reduction. Substitute beta=beta0+bc cos(psi)+bs sin(psi)
 * in I betaDDot+C betaDot+K beta=M and neglect only amplitude second derivatives:
 * [C,2sIΩ;-2sIΩ,C] bDot + [K-IΩ²,sCΩ;-sCΩ,K-IΩ²] b = M.
 * The constant-coefficient matrix exponential is stable without numerical damping and remains
 * finite as RPM tends to zero. Coning retains the aerodynamic decay envelope only; its
 * oscillatory second-order mode is absent. Zero density causes no coning damping.
 * This is an averaged airborne model, not blade droop/stop or transient lag simulation. */
export function advanceFlap(p: ArticulatedGeometry, omega: number, forcing: HingeForcing,
  previous: FlapHarmonics, rotation: 1 | -1, dt: number, bodyYawRate = 0): FlapHarmonics {
  if (!(dt > 0) || !(omega > 0)) return { ...previous };
  const inertia = p.blade.flapInertia, c = forcing.damping;
  const stiffness = omega ** 2 * (inertia + p.flapOffset * p.blade.flapFirst);
  const delta = stiffness - inertia * omega ** 2, transport = 2 * rotation * inertia * omega;
  const determinant = c * c + transport * transport;
  const decay = (c * delta + transport * rotation * c * omega) / determinant;
  // Yaw transports the disc harmonics through body axes (betaCdot=-r betaS,
  // betaSdot=+r betaC). The p/q inertial forcing already enters flapForcing above.
  const spin = (rotation * c * c * omega - transport * delta) / determinant + bodyYawRate;
  const driveCos = (c * forcing.cosine - transport * forcing.sine) / determinant;
  const driveSin = (transport * forcing.cosine + c * forcing.sine) / determinant;
  const exponent = Math.exp(-decay * dt), cos = Math.cos(spin * dt), sin = Math.sin(spin * dt);
  // Complex integral of exp((-decay+i spin)t). Use the Taylor limit at low speed to
  // avoid forming an enormous steady-state target or subtracting nearly equal exponentials.
  const norm = decay * decay + spin * spin;
  let real: number, imaginary: number;
  if (Math.sqrt(norm) * dt < 1e-5) {
    real = dt - decay * dt * dt / 2 + (decay * decay - spin * spin) * dt ** 3 / 6;
    imaginary = spin * dt * dt / 2 - decay * spin * dt ** 3 / 3;
  } else {
    real = (decay * (1 - exponent * cos) + spin * exponent * sin) / norm;
    imaginary = (spin * (1 - exponent * cos) - decay * exponent * sin) / norm;
  }
  // Retain the slow decay pole of I betaDDot+C betaDot+K beta=M. In the overdamped
  // low-RPM limit use the rationalized root K/C, so a static aerodynamic load cannot
  // become M/K -> infinity during startup. No RPM threshold or angle clamp is needed.
  const discriminant = c * c - 4 * inertia * stiffness;
  const coneGain = discriminant > 0 ? 2 / (c + Math.sqrt(discriminant)) : c / (2 * inertia * stiffness);
  const coneRate = stiffness * coneGain;
  const coneIntegral = coneRate > 0 ? -Math.expm1(-coneRate * dt) / coneRate : dt;
  const coneDrive = forcing.cone * coneGain;
  return { cone: previous.cone * Math.exp(-coneRate * dt) + coneDrive * coneIntegral,
    cosine: exponent * (cos * previous.cosine - sin * previous.sine) + real * driveCos - imaginary * driveSin,
    sine: exponent * (sin * previous.cosine + cos * previous.sine) + imaginary * driveCos + real * driveSin };
}
