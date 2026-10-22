import { clamp, smoothstep } from '../../core/math';
import type { RotorDefinition } from './definition';
import { DENT_CD0_FULL, DENT_STALL_SHIFT_FULL } from '../aero/hailDents';
import { sectionCoefficients, type RotorSectionDef } from './section';

/**
 * Hingeless rotor core options (plan revision 2, section 4 items 2, 4, 7; owner RC). Absent: the legacy call, bit for
 * bit. This function's azimuth has psi = 0 DOWNWIND and ut = Omega r + V sin psi (wind axes of the tip-path plane).
 */
export interface BladeElementOptions {
  /** First-harmonic blade pitch RELATIVE TO THE TIP-PATH PLANE, rad, in this function's azimuth: theta +=
   *  cos cos psi + sin sin psi (rotorcraft.ts builds it from the swashplate cyclic and the solved flap harmonics;
   *  pass teetering = false with it). */
  harmonicPitch?: { cos: number; sin: number };
  /** Coning relative to the tip-path plane, rad: the radial-flow term up += coning V cos psi. */
  coning?: number;
  /** Section model (section.ts): coefficients from (alpha in (-pi, pi], Mach, reverse = |alpha| > pi/2) replace the
   *  analytic polar; `stalledFraction` keeps the attached-slope measure. */
  section?: RotorSectionDef;
  /** Speed of sound for the section's Mach number, m/s (default 340.3). */
  soundSpeed?: number;
}
/**
 * The first-harmonic blade pitch RELATIVE TO THE TIP-PATH PLANE in bladeElements' azimuth (psi = 0 downwind,
 * ut = Omega r + V sin psi), from the blade cyclic and flap harmonics in the articulated solver's azimuth (psi = 0
 * forward, e_r = (cos psi, -sin psi); pitchCos/pitchSin as flapForcing, betaC/betaS = cosine/sine harmonics). A tilt of
 * the reference plane changes the section pitch by the plane's slope along the blade's motion,
 * theta_TPP = theta_shaft - rotation d beta / d psi; then psi_BEM = rotation (psi + alpha) + pi, alpha the direction of the
 * hub's motion through the air in the plane (inPlaneX, inPlaneY; absent: forward). The free-hinge limit is the
 * cancellation formula of bladeElements' `teetering` branch (plan R8).
 */
export function tppPitchHarmonic(rotation: 1 | -1, pitchCos: number, pitchSin: number, betaC: number, betaS: number,
  inPlaneX: number, inPlaneY: number): { cos: number; sin: number } {
  const pc = pitchCos - rotation * betaS, ps = pitchSin + rotation * betaC, speed = Math.hypot(inPlaneX, inPlaneY);
  const ca = speed > 1e-9 ? inPlaneX / speed : 1, sa = speed > 1e-9 ? inPlaneY / speed : 0;
  return { cos: -pc * ca + ps * sa, sin: -rotation * (pc * sa + ps * ca) };
}
export interface RotorLoads { thrust: number; torque: number; inPlane: number; stalledFraction: number;
  coningMoment: number; stallMoment: number; profilePower: number;
  /** With BladeElementOptions only: the in-plane force's other component, sum of the tangential force x cos psi (N; this
   *  function's azimuth, psi = 0 downwind): with `inPlane` (= sum x sin psi, the H-force along the flow) it is the whole
   *  in-plane force vector, which a hingeless rotor has even in the hover (rotorcraft.ts turns it back to shaft axes). */
  side?: number }
/** Azimuth-averaged blade elements, including reverse flow and signed aerodynamic shaft torque.
 * axial is aircraft velocity along thrust axis, positive climbing; inflow is wake velocity opposite thrust.
 * A driving region in descent has negative torque: autorotation draws energy from the air, never an RPM servo.
 * Section polar is analytic and unvalidated; this is not a free-wake or elastic-blade solver.
 * dent: hail dents on the blades' leading edges, 0..1 (sim/weather/hailDamage.ts rotor): the profile drag gains
 * DENT_CD0_FULL dent and maxCl falls by liftSlope DENT_STALL_SHIFT_FULL dent (aero/hailDents.ts; unconfirmed).
 * At 0 the arithmetic is the undamaged rotor's.
 */
export function bladeElements(d: RotorDefinition, omega: number, pitch: number, axial: number,
  inPlaneSpeed: number, inflow: number, density: number, radial = 12, azimuthal = 16, teetering = false, dent = 0,
  options?: BladeElementOptions): RotorLoads {
  const maxCl = dent > 0 ? d.maxCl - d.liftSlope * DENT_STALL_SHIFT_FULL * dent : d.maxCl;
  const profileCd = dent > 0 ? d.profileCd + DENT_CD0_FULL * dent : d.profileCd;
  let thrust = 0, torque = 0, inPlane = 0, side = 0, stalled = 0, coningMoment = 0, stallMoment = 0, profilePower = 0;
  const tip = Math.max(omega * d.radius, 1), mu = inPlaneSpeed / tip;
  // Free first-harmonic flapping unloads the advancing side. Equivalent feathering in disc axes
  // cancels the first lift moment in linear theory; section stall then breaks that balance naturally.
  const harmonic = teetering ? -mu * (8 / 3 * (pitch - 0.75 * d.twist) + 2 * d.twist -
    2 * (axial + inflow) / tip) / (1 + 1.5 * mu * mu) : 0;
  const dr = (d.radius - d.rootCutout) / radial;
  const o = options, hp = o?.harmonicPitch, coning = o?.coning ?? 0, section = o?.section;
  for (let j = 0; j < azimuthal; j++) {
    const sin = Math.sin(2 * Math.PI * (j + 0.5) / azimuthal);
    const cos = o ? Math.cos(2 * Math.PI * (j + 0.5) / azimuthal) : 0;
    for (let i = 0; i < radial; i++) {
      const r = d.rootCutout + (i + 0.5) * dr;
      const ut = omega * r + inPlaneSpeed * sin;
      const up = o ? axial + inflow + coning * inPlaneSpeed * cos : axial + inflow;
      const phi = Math.atan2(up, ut);
      const theta = o ? pitch + d.twist * (r / d.radius - 0.75) + harmonic * sin + (hp ? hp.cos * cos + hp.sin * sin : 0)
        : pitch + d.twist * (r / d.radius - 0.75) + harmonic * sin;
      const alpha = Math.atan2(Math.sin(theta - phi), Math.cos(theta - phi));
      const linear = d.liftSlope * alpha;
      const stall = Math.abs(linear) > maxCl;
      // Smooth saturation, then separated flat-plate flow at large incidence, including reverse flow.
      const blend = clamp((Math.abs(alpha) - 0.25) / 0.35, 0, 1);
      const coefficients = section ? sectionCoefficients(section, alpha, Math.hypot(ut, up) / (o?.soundSpeed ?? 340.3),
        Math.abs(alpha) > Math.PI / 2) : undefined;
      // The section model takes the dents as profile drag only (its stall break is its own table).
      const cl = coefficients ? coefficients.cl : (1 - blend) * clamp(linear, -maxCl, maxCl) + blend * Math.sin(2 * alpha);
      const cd = coefficients ? coefficients.cd + (profileCd - d.profileCd)
        : profileCd + d.inducedDrag * cl * cl + blend * 1.8 * Math.sin(alpha) ** 2;
      const scale = 0.5 * density * (ut * ut + up * up) * d.chord * dr * d.blades / azimuthal;
      const lift = scale * cl, drag = scale * cd;
      profilePower += drag * Math.hypot(ut, up);
      const normal = lift * Math.cos(phi) - drag * Math.sin(phi);
      thrust += normal;
      coningMoment += normal * r;
      // Loss on the lifting outer retreating blade leaves a first-harmonic moment. It drives flapping,
      // not a rigid-hub bending torque. Reverse-flow root elements are excluded from this stall measure.
      if (teetering && sin < 0 && r > 0.5 * d.radius && ut > 0 && linear > maxCl)
        stallMoment += (lift - scale * linear) * Math.cos(phi) * r * sin;
      const tangential = lift * Math.sin(phi) + drag * Math.cos(phi);
      torque += tangential * r;
      inPlane += tangential * sin;
      if (o) side += tangential * cos;
      if (stall) stalled++;
    }
  }
  if (o) return { thrust, torque, inPlane, side, stalledFraction: stalled / (radial * azimuthal), coningMoment, stallMoment, profilePower };
  return { thrust, torque, inPlane, stalledFraction: stalled / (radial * azimuthal), coningMoment, stallMoment, profilePower };
}

/** Uniform momentum inflow. Relaxing this target gives dynamic inflow and translational lift.
 * Through the vortex-ring region use a bounded empirical continuation; no singular axial momentum root.
 */
export function inflowTarget(thrust: number, density: number, radius: number, axial: number, horizontal: number): number {
  const vh = Math.sqrt(Math.abs(thrust) / Math.max(2 * density * Math.PI * radius * radius, 1e-6));
  if (vh < 1e-6) return 0;
  // Damped fixed-point solve of vi = T / (2 rho A sqrt(Vh² + (Va+vi)²)).
  let vi = vh;
  for (let i = 0; i < 24; i++) {
    const speed = Math.max(Math.hypot(horizontal, axial + vi), 0.5 * vh);
    vi = 0.75 * vi + 0.25 * vh * vh / speed;
  }
  // VRS develops over a finite descent/speed interval. Switching models at Va = 0 used to
  // give two different inflows for the same level-flight trim either side of zero disc incidence.
  const descent = -axial / vh;
  const vortex = smoothstep(0, 0.5, descent) * (1 - smoothstep(1.5, 2, descent)) *
    (1 - smoothstep(1, 2, horizontal / vh));
  const recirculation = vh * (1 + 0.35 * Math.sin(Math.PI * descent / 2) ** 2) /
    Math.sqrt(1 + (horizontal / vh) ** 2);
  return Math.sign(thrust) * (vi + vortex * (recirculation - vi));
}

/** Uniform Pitt–Peters apparent-mass response, linearized about the momentum inflow.
 * M00 = 128/(75 pi); d(2 vi |V+vi|)/dvi = 2 Veff, hence tau = M00 R/(2 Veff).
 * NASA TM-88327, eqs. 4–5 (https://ntrs.nasa.gov/citations/19870015049).
 * This is only the uniform mode, not the three-state wake. Momentum theory fails in VRS;
 * retain a bounded positive relaxation there instead of a negative/singular time constant.
 */
export function inflowTimeConstant(radius: number, axial: number, horizontal: number, induced: number): number {
  const through = axial + induced, speed = Math.hypot(horizontal, through);
  const effective = speed + induced * through / Math.max(speed, 1e-6);
  return Math.min(1.5, 64 / (75 * Math.PI) * radius / Math.max(effective, 0.5 * Math.abs(induced), 0.1));
}
