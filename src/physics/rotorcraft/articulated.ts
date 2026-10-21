import { v3, type Vec3 } from '../../core/math';
import { sectionCoefficients, type RotorSectionDef } from './section';
import type { RotorDefinition } from './definition';
import type { FlapSystem, GyroBladeMoments } from './controlGyro';

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
/**
 * Hingeless hub (plan revision 2, section 4 item 1): the flap spring at the equivalent hinge, N m/rad (Kbeta,
 * hingelessSpring), its zero (precone, rad), and the mean delta-3 aerodynamic stiffness, N m/rad (sum of
 * k|ut|.ut.arm.tan(delta3): it stiffens the flap equations but is not a structural hub moment).
 */
export interface FlapSpring { stiffness: number; precone: number; aerodynamic?: number }

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
 * The off-diagonal terms carry precession. Reversing rotation mirrors the phase, not control sense.
 * `spring` (hingeless hub): K gains Kbeta (+ the mean delta-3 stiffness), the cone forcing Kbeta x precone; at
 * Omega = 0 this is the static spring solution. Absent: the legacy text. */
export function harmonicFlap(p: ArticulatedGeometry, omega: number, forcing: HingeForcing,
  rotation: 1 | -1, spring?: FlapSpring): FlapHarmonics {
  if (spring) {
    const extra = spring.stiffness + (spring.aerodynamic ?? 0);
    const stiffness = omega * omega * (p.blade.flapInertia + p.flapOffset * p.blade.flapFirst) + extra;
    const delta = p.flapOffset * p.blade.flapFirst * omega * omega + extra;
    const cross = rotation * forcing.damping * omega, determinant = delta * delta + cross * cross;
    // A stopped hub with no spring and no delta-3 has no static cone solution: it holds the precone (the pose reset
    // seeds), so the solver's cone does not jump to 0 at Omega = 0.
    return { cone: stiffness > 0 ? (forcing.cone + spring.stiffness * spring.precone) / stiffness : spring.precone,
      cosine: determinant > 0 ? (delta * forcing.cosine - cross * forcing.sine) / determinant : 0,
      sine: determinant > 0 ? (cross * forcing.cosine + delta * forcing.sine) / determinant : 0 };
  }
  const stiffness = omega * omega * (p.blade.flapInertia + p.flapOffset * p.blade.flapFirst);
  const delta = stiffness - p.blade.flapInertia * omega * omega;
  const cross = rotation * forcing.damping * omega, determinant = delta * delta + cross * cross;
  return { cone: stiffness > 0 ? forcing.cone / stiffness : 0,
    cosine: determinant > 0 ? (delta * forcing.cosine - cross * forcing.sine) / determinant : 0,
    sine: determinant > 0 ? (cross * forcing.cosine + delta * forcing.sine) / determinant : 0 };
}

/** Offset hinge reaction, averaged over equally spaced blades. The common vertical root reaction
 * cancels in roll/pitch. B/2 multiplies the first harmonic. This is not proportional to rotor thrust.
 * Hingeless hub (`spring`): k = (B/2)(e Mbeta Omega^2 + Kbeta); the spring carries moment at zero thrust and at zero
 * rpm. The delta-3 stiffness is aerodynamic and never enters the hub moment; the precone constant has no first
 * harmonic. Absent: the legacy text. */
export function hingeMoment(p: ArticulatedGeometry, blades: number, omega: number, flap: FlapHarmonics,
  spring?: FlapSpring): Vec3 {
  const k = spring ? blades / 2 * (p.flapOffset * p.blade.flapFirst * omega * omega + spring.stiffness)
    : blades / 2 * p.flapOffset * p.blade.flapFirst * omega * omega;
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
 * This is an averaged airborne model, not blade droop/stop or transient lag simulation.
 *
 * Hingeless hub (`spring`, plan revision 2 section 4 item 1): K gains the flap spring Kbeta (and the mean delta-3
 * aerodynamic stiffness), so delta = e Mbeta Omega^2 + Kbeta (+ Ka); the cone forcing gains Kbeta x precone. At
 * Omega <= 0 a spring hub takes the static spring solution (no rotor air motion: about zero), so a stopped rotor or a
 * save resumed at Omega = 0 carries no frozen hub moment. Absent: the legacy text, bit for bit. */
export function advanceFlap(p: ArticulatedGeometry, omega: number, forcing: HingeForcing,
  previous: FlapHarmonics, rotation: 1 | -1, dt: number, bodyYawRate = 0, spring?: FlapSpring): FlapHarmonics {
  if (!(dt > 0)) return { ...previous };
  if (spring) {
    if (!(omega > 0)) return harmonicFlap(p, 0, forcing, rotation, spring);
    const inertia = p.blade.flapInertia, extra = spring.stiffness + (spring.aerodynamic ?? 0);
    return stepFlap(inertia, forcing.damping, omega ** 2 * (inertia + p.flapOffset * p.blade.flapFirst) + extra,
      p.flapOffset * p.blade.flapFirst * omega ** 2 + extra, forcing.cone + spring.stiffness * spring.precone,
      omega, forcing, previous, rotation, dt, bodyYawRate);
  }
  if (!(omega > 0)) return { ...previous };
  const inertia = p.blade.flapInertia, c = forcing.damping;
  const stiffness = omega ** 2 * (inertia + p.flapOffset * p.blade.flapFirst);
  const delta = stiffness - inertia * omega ** 2;
  return stepFlap(inertia, c, stiffness, delta, forcing.cone, omega, forcing, previous, rotation, dt, bodyYawRate);
}
/** The exact step of advanceFlap for given stiffness (cone divisor), detuning delta and cone forcing. */
function stepFlap(inertia: number, c: number, stiffness: number, delta: number, coneForcing: number, omega: number,
  forcing: HingeForcing, previous: FlapHarmonics, rotation: 1 | -1, dt: number, bodyYawRate: number): FlapHarmonics {
  const transport = 2 * rotation * inertia * omega;
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
  const coneDrive = coneForcing * coneGain;
  return { cone: previous.cone * Math.exp(-coneRate * dt) + coneDrive * coneIntegral,
    cosine: exponent * (cos * previous.cosine - sin * previous.sine) + real * driveCos - imaginary * driveSin,
    sine: exponent * (sin * previous.cosine + cos * previous.sine) + imaginary * driveCos + real * driveSin };
}

// ---------------------------------------------------------------------------------------------------------------------
// Hingeless rotor core (plan revision 2, section 4; owner RC). Everything below is opt-in: the legacy articulated hubs
// (S269, MD 500E) keep flapForcing / advanceFlap / harmonicFlap / hingeMoment above, bit for bit.

/** Options of the extended hinge forcing (hubForcing). Each absent = that term off. */
export interface HubForcingOptions {
  /** First-harmonic (Pitt-Peters) inflow, m/s, shaft axes in this module's azimuth (psi = 0 forward, e_r = (cos psi,
   *  -sin psi)): the element's normal flow gains (r/R)(cos cos psi + sin sin psi) (inflowHarmonic.ts). */
  harmonicInflow?: { cos: number; sin: number };
  /** The previous step's flap harmonics (rad): beta(psi) for the radial-flow term, the periodic flap damping and the
   *  periodic delta-3 part, all explicit (gamma Omega / 16 x dt is about 0.06 at 240 Hz). */
  flap?: FlapHarmonics;
  /** mu beta cos(psi): the radial component of the hub's air velocity seen normal to a flapped blade,
   *  up += -beta(psi) (V . e_r). With the full beta(psi) it also carries the coning-harmonic coupling terms. */
  radialFlow?: boolean;
  /** RotorDefinition.periodicFlapDamping: the azimuth-periodic part of the flap-rate aerodynamic moment, from the
   *  previous harmonics' beta-dot(psi) = rotation Omega (beta_s cos psi - beta_c sin psi), minus its azimuth mean (the
   *  mean C already sits in the implicit matrix). */
  periodicDamping?: boolean;
  /** tan(delta-3): theta -= tan(delta3) beta. Its mean stiffness sum k|ut| ut arm tan(delta3) is returned as
   *  `stiffness` for the exact matrix (FlapSpring.aerodynamic); the periodic remainder is explicit. */
  tanDelta3?: number;
  /** Section model (section.ts, AH): alpha is the incidence of the relative wind to the chord line in (-pi, pi], the
   *  Mach number |(ut, up)| / soundSpeed, `reverse` = |alpha| > pi/2 (flow from the trailing edge). The normal force
   *  is q c (cl cos phi - cd sin phi). The damping C and the cyclic Jacobian stay the attached-flow linear ones. */
  section?: RotorSectionDef;
  soundSpeed?: number;
  /** Section pitching moment about the quarter chord when no section model is set (RotorDefinition.cm0). */
  cm0?: number;
  /** Return d(cosine, sine)/d(pitchCos, pitchSin) (exact for the linear forcing) for flapSystem. */
  jacobian?: boolean;
  /** Return the first-harmonic blade pitching and in-plane moments (the control gyro's feathering-moment feedback). */
  gyro?: boolean;
}
/** Row-major 2x2 [m00, m01, m10, m11]. */
export type Matrix2 = readonly [number, number, number, number];
export interface HubForcing extends HingeForcing {
  /** Mean delta-3 aerodynamic flap stiffness, N m/rad (0 without delta-3). */
  stiffness: number;
  jacobian?: Matrix2;
  /** Per-blade first harmonics, N m, this module's azimuth (controlGyro.ts GyroBladeMoments): pitching moment about
   *  the feathering axis (+ nose up) and the in-plane (lag) moment of the tangential force about the shaft (+ opposing
   *  rotation). */
  blade?: GyroBladeMoments;
}

/** Wrap an angle to (-pi, pi]. */
function wrap(a: number): number { return Math.atan2(Math.sin(a), Math.cos(a)); }

/**
 * flapForcing's quadrature with the hingeless rotor core's terms (HubForcingOptions): the radial/azimuth grid of
 * RotorDefinition (legacy 12 x 16), harmonic inflow, radial flow, periodic flap damping, delta-3, the section model and
 * the gyro's blade moments. With every option off it is flapForcing's arithmetic on the legacy grid.
 */
export function hubForcing(d: RotorDefinition, p: ArticulatedGeometry, omega: number, density: number,
  collective: number, pitchCos: number, pitchSin: number, air: Vec3, inflow: number, bodyRate: Vec3,
  rotation: 1 | -1, o: HubForcingOptions = {}): HubForcing {
  let cone = 0, cosine = 0, sine = 0, damping = 0, stiffness = 0;
  let jcc = 0, jcs = 0, jss = 0, pc = 0, ps = 0, ic = 0, is = 0;
  const n = d.radialStations ?? 12, azimuths = d.azimuthStations ?? 16, dr = (d.radius - d.rootCutout) / n;
  const hi = o.harmonicInflow, b = o.flap, t3 = o.tanDelta3 ?? 0, section = o.section;
  const radial = !!(o.radialFlow && b), periodic = !!(o.periodicDamping && b), delta3 = !!(t3 && b);
  const sound = o.soundSpeed ?? 340.3, cm0 = o.cm0 ?? 0;
  for (let j = 0; j < azimuths; j++) {
    const psi = (j + 0.5) * 2 * Math.PI / azimuths, cs = Math.cos(psi), sn = Math.sin(psi);
    const beta = b ? b.cone + b.cosine * cs + b.sine * sn : 0;
    const betaDot = b ? rotation * omega * (b.sine * cs - b.cosine * sn) : 0;
    const gradient = hi ? (hi.cos * cs + hi.sin * sn) / d.radius : 0;
    const radialAir = air.x * cs - air.y * sn;
    for (let i = 0; i < n; i++) {
      const r = d.rootCutout + (i + 0.5) * dr, arm = r - p.flapOffset;
      const ut = omega * r - rotation * (air.x * sn + air.y * cs);
      let up = inflow - air.z + r * (bodyRate.y * cs + bodyRate.x * sn);
      if (hi) up += r * gradient;
      if (radial) up -= beta * radialAir;
      let theta = collective + d.twist * (r / d.radius - 0.75) + pitchCos * cs + pitchSin * sn;
      if (delta3) theta -= t3 * beta;
      const k = 0.5 * density * d.liftSlope * d.chord * dr / azimuths;
      let lift: number, cl = 0, cd = 0, phi = 0;
      if (section || o.gyro) {
        phi = Math.atan2(up, ut);
        const alpha = wrap(theta - phi);
        if (section) {
          const coefficients = sectionCoefficients(section, alpha, Math.hypot(ut, up) / sound, Math.abs(alpha) > Math.PI / 2);
          cl = coefficients.cl; cd = coefficients.cd;
          if (o.gyro) { const q = 0.5 * density * (ut * ut + up * up) * d.chord * dr / azimuths;
            const pm = q * d.chord * coefficients.cm; pc += 2 * pm * cs; ps += 2 * pm * sn; }
        } else {
          cl = clampValue(d.liftSlope * alpha, -d.maxCl, d.maxCl); cd = d.profileCd + d.inducedDrag * cl * cl;
          const pm = 0.5 * density * (ut * ut + up * up) * d.chord * d.chord * dr / azimuths * cm0;
          pc += 2 * pm * cs; ps += 2 * pm * sn;
        }
        if (o.gyro) {
          const tangential = 0.5 * density * (ut * ut + up * up) * d.chord * dr / azimuths *
            (cl * Math.sin(phi) + cd * Math.cos(phi)) * r;
          ic += 2 * tangential * cs; is += 2 * tangential * sn;
        }
      }
      if (section) lift = 0.5 * density * (ut * ut + up * up) * d.chord * dr / azimuths * (cl * Math.cos(phi) - cd * Math.sin(phi));
      else lift = k * Math.abs(ut) * (ut * theta - up);
      // The full flap-rate moment; its azimuth mean is put back below (the implicit matrix carries it).
      if (periodic) lift -= k * Math.abs(ut) * arm * betaDot;
      const moment = lift * arm;
      cone += moment; cosine += 2 * moment * cs; sine += 2 * moment * sn;
      damping += k * Math.abs(ut) * arm * arm;
      if (t3) stiffness += k * Math.abs(ut) * ut * arm * t3;
      if (o.jacobian) { const g = 2 * k * Math.abs(ut) * ut * arm; jcc += g * cs * cs; jcs += g * cs * sn; jss += g * sn * sn; }
    }
  }
  // Only the azimuth-periodic part stays explicit: the mean damping C and the mean delta-3 stiffness are exact in the
  // matrix (cosine row: + rotation C Omega beta_s on the left; delta + Ka on the diagonal).
  if (periodic) { cosine += damping * rotation * omega * b!.sine; sine -= damping * rotation * omega * b!.cosine; }
  if (delta3) { cone += stiffness * b!.cone; cosine += stiffness * b!.cosine; sine += stiffness * b!.sine; }
  // 2 w_body × v_blade supplies the inertial p/q forcing, integrated about the flap pin.
  const transport = 2 * rotation * omega * (p.blade.flapInertia + p.flapOffset * p.blade.flapFirst);
  cosine -= transport * bodyRate.x;
  sine += transport * bodyRate.y;
  const out: HubForcing = { cone, cosine, sine, damping, stiffness };
  if (o.jacobian) out.jacobian = [jcc, jcs, jcs, jss];
  if (o.gyro) out.blade = { pitching: { cos: pc, sin: ps }, inPlane: { cos: ic, sin: is } };
  return out;
}

function clampValue(x: number, lo: number, hi: number): number { return x < lo ? lo : x > hi ? hi : x; }

/**
 * The rotor's aerodynamic hub moment about the SHAFT, N m, shaft axes (x roll, y pitch): the first moment of the blade
 * normal force, sum of L r e_r over the blades, with the actual flap and flap rate (beta-dot(psi) = rotation Omega
 * (beta_s cos psi - beta_c sin psi) + the harmonics' own rates `rate`), the radial flow, harmonic inflow and delta-3
 * as in hubForcing. Aerodynamic loads only: the inertial Coriolis transport is not a wake load. This forces the
 * first-harmonic inflow (inflowHarmonic.ts); it is not applied to the body (the hub moment is hingeMoment).
 */
export function aerodynamicHubMoment(d: RotorDefinition, p: ArticulatedGeometry, omega: number, density: number,
  collective: number, pitchCos: number, pitchSin: number, air: Vec3, inflow: number, bodyRate: Vec3,
  rotation: 1 | -1, blades: number, flap: FlapHarmonics, rate: FlapHarmonics, o: HubForcingOptions = {}): { x: number; y: number } {
  let cosine = 0, sine = 0;
  const n = d.radialStations ?? 12, azimuths = d.azimuthStations ?? 16, dr = (d.radius - d.rootCutout) / n;
  const hi = o.harmonicInflow, t3 = o.tanDelta3 ?? 0, section = o.section, sound = o.soundSpeed ?? 340.3;
  for (let j = 0; j < azimuths; j++) {
    const psi = (j + 0.5) * 2 * Math.PI / azimuths, cs = Math.cos(psi), sn = Math.sin(psi);
    const beta = flap.cone + flap.cosine * cs + flap.sine * sn;
    const betaDot = rotation * omega * (flap.sine * cs - flap.cosine * sn) + rate.cone + rate.cosine * cs + rate.sine * sn;
    const gradient = hi ? (hi.cos * cs + hi.sin * sn) / d.radius : 0;
    const radialAir = air.x * cs - air.y * sn;
    for (let i = 0; i < n; i++) {
      const r = d.rootCutout + (i + 0.5) * dr, arm = r - p.flapOffset;
      const ut = omega * r - rotation * (air.x * sn + air.y * cs);
      let up = inflow - air.z + r * (bodyRate.y * cs + bodyRate.x * sn) + arm * betaDot + r * gradient;
      if (o.radialFlow) up -= beta * radialAir;
      const theta = collective + d.twist * (r / d.radius - 0.75) + pitchCos * cs + pitchSin * sn - t3 * beta;
      let lift: number;
      if (section) {
        const phi = Math.atan2(up, ut), alpha = wrap(theta - phi);
        const c = sectionCoefficients(section, alpha, Math.hypot(ut, up) / sound, Math.abs(alpha) > Math.PI / 2);
        lift = 0.5 * density * (ut * ut + up * up) * d.chord * dr / azimuths * (c.cl * Math.cos(phi) - c.cd * Math.sin(phi));
      } else lift = 0.5 * density * d.liftSlope * d.chord * dr / azimuths * Math.abs(ut) * (ut * theta - up);
      cosine += 2 * lift * r * cs; sine += 2 * lift * r * sn;
    }
  }
  // e_r = (cos psi, -sin psi): roll x = sum L r sin psi, pitch y = sum L r cos psi; B blades average B/2 per harmonic.
  return { x: blades / 2 * sine, y: blades / 2 * cosine };
}

/**
 * The slow-amplitude first-harmonic flap equations of one real step in first-order form (the control-gyro coupling
 * contract, controlGyro.ts FlapSystem): dx/dt = a.x + f + b.(theta - theta0), x = [cosine, sine] (rad, this module's
 * azimuth; = [-flapForward, flapRight]), theta = [pitchCos, pitchSin] in hubForcing's convention, theta0 the cyclic
 * the forcing was formed with, b = d f / d theta (exact for the linear forcing: needs `forcing.jacobian`), and
 * hub = the 2x2 map from x to the SHAFT hub moment [Mx, My] (N m) = hingeMoment. `a` carries the body yaw transport.
 * The cone keeps advanceFlap's pole. Returns null where the reduction is singular: Omega <= 0, or no aerodynamic
 * damping and no rotation; the caller then takes advanceFlap's harmonics (the static spring solution) for that step.
 */
export function flapSystem(p: ArticulatedGeometry, omega: number, forcing: HubForcing, rotation: 1 | -1,
  bodyYawRate: number, theta0: readonly [number, number], blades: number, spring?: FlapSpring): FlapSystem | null {
  if (!(omega > 0)) return null;
  const inertia = p.blade.flapInertia, c = forcing.damping;
  const delta = spring ? p.flapOffset * p.blade.flapFirst * omega ** 2 + spring.stiffness + (spring.aerodynamic ?? 0)
    : omega ** 2 * (inertia + p.flapOffset * p.blade.flapFirst) - inertia * omega ** 2;
  const transport = 2 * rotation * inertia * omega, determinant = c * c + transport * transport;
  if (!(determinant > 0)) return null;
  const decay = (c * delta + transport * rotation * c * omega) / determinant;
  const spin = (rotation * c * c * omega - transport * delta) / determinant + bodyYawRate;
  // P^-1 with P = [C, T; -T, C]: [C, -T; T, C] / (C^2 + T^2).
  const pinv = (x: number, y: number): [number, number] => [(c * x - transport * y) / determinant, (transport * x + c * y) / determinant];
  const f = pinv(forcing.cosine, forcing.sine);
  const J = forcing.jacobian ?? [0, 0, 0, 0];
  const b0 = pinv(J[0], J[2]), b1 = pinv(J[1], J[3]);
  const k = blades / 2 * (p.flapOffset * p.blade.flapFirst * omega * omega + (spring ? spring.stiffness : 0));
  return { a: [-decay, -spin, spin, -decay], f, b: [b0[0], b1[0], b0[1], b1[1]], theta0, hub: [0, k, k, 0] };
}
