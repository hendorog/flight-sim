// Propeller blade section aerodynamics over the full +-180 degree angle-of-attack range.
//
// The McCauley 1A170E blade uses a Clark-Y-like cambered section (flat lower face) whose thickness falls from
// about 22 % near the shank to 6 % at the tip. The model has four parts:
//   - attached flow: lift slope with the Prandtl-Glauert correction, parabolic profile drag, and a maximum
//     lift coefficient that falls with Mach number as measured on thin sections at high subsonic speed;
//   - post stall up to 90 degrees: Viterna-Corrigan extrapolation (the standard AeroDyn/AirfoilPrep method for
//     rotor BEM codes), matched in value to the attached curve at the stall angle, on both stall sides;
//   - rotational stall delay on the positive side (Snel, 1994): on a rotating blade the centrifugal pumping of
//     the separated boundary layer recovers dcl = 3 (c/r)^2 (cl_potential - cl_2D), faded out by 50 degrees;
//   - reversed flow beyond 90 degrees: the AirfoilPrep mirror rule (lift of the mirrored angle times -0.7).
// Transonic drag rise uses Lock's fourth-power law above a critical Mach number found from the section's peak
// suction (Karman-Tsien). Because the suction peak grows with lift, a highly loaded section goes critical at a
// much lower Mach number than a lightly loaded one. That is what makes a fixed-pitch cruise propeller
// inefficient at static thrust (tips near M 0.7 at cl ~ 1) while still reasonable in cruise (M 0.8 at cl ~ 0.4).

import { DEG, clamp, interp1, smoothstep } from '../../core/math';
import { C172_BLADE_SECTION } from './c172Powerplant';
import type { BladeSectionDef } from './defs';

// The section of the McCauley blade (C172_BLADE_SECTION, where each number is explained) under the names this
// module has always exported. It is also the section of a propeller definition that names none.
export const ALPHA0 = C172_BLADE_SECTION.alpha0;
export const LIFT_SLOPE = C172_BLADE_SECTION.liftSlope;
export const CL_MAX_LOW_SPEED = C172_BLADE_SECTION.clMaxLowSpeed;
export const CL_MAX_MACH_LOSS = C172_BLADE_SECTION.clMaxMachLoss;
export const CL_MIN = C172_BLADE_SECTION.clMin;
export const CD_MAX = C172_BLADE_SECTION.cdMax;
export const CL_MIN_DRAG = C172_BLADE_SECTION.clMinDrag;
export const DRAG_DUE_TO_LIFT = C172_BLADE_SECTION.dragDueToLift;
export const CL_IDEAL = C172_BLADE_SECTION.clIdeal;
/** Half-width of the rounded stall. */
const STALL_BLEND = 3 * DEG;
/** Snel stall delay is applied fully up to this angle and faded out by the next. */
const STALL_DELAY_FULL = 30 * DEG;
const STALL_DELAY_END = 50 * DEG;

export interface SectionCoefficients {
  cl: number;
  cd: number;
}

/** Minimum profile drag versus thickness ratio: skin friction of a production (not polished) blade times a form factor. */
function profileDrag(tOverC: number): number {
  return 0.0085 * (1 + 2 * tOverC + 60 * Math.pow(tOverC, 4));
}

/** Karman-Tsien compressible pressure coefficient from its incompressible value. */
function karmanTsien(cp0: number, mach: number): number {
  const beta = Math.sqrt(1 - mach * mach);
  return cp0 / (beta + ((mach * mach) / (1 + beta)) * (cp0 / 2));
}

/** Pressure coefficient at which the local flow becomes sonic, for freestream Mach `mach`. */
function sonicCp(mach: number): number {
  const g = 1.4;
  return (2 / (g * mach * mach)) * (Math.pow((2 + (g - 1) * mach * mach) / (g + 1), g / (g - 1)) - 1);
}

/** Critical Mach number versus the incompressible peak suction -Cp0, tabulated once by bisection. */
const SUCTION = Array.from({ length: 60 }, (_, i) => 0.05 * Math.pow(1.1, i));
const CRITICAL_MACH = SUCTION.map((s) => {
  let lo = 0.02;
  let hi = 0.999;
  for (let i = 0; i < 50; i++) {
    const m = 0.5 * (lo + hi);
    if (karmanTsien(-s, m) < sonicCp(m)) hi = m;
    else lo = m;
  }
  return 0.5 * (lo + hi);
});

/**
 * Transonic wave drag: Lock's fourth-power law above the critical Mach number. The incompressible peak velocity
 * ratio is built as Abbott & von Doenhoff (sec. 4.3) build the velocity distribution, from three parts:
 *   thickness: 1 + 1.6 t/c (0.41 suction on NACA 0012 at zero lift);
 *   camber at its ideal lift: the a = 1 mean-line load is spread evenly along the chord, dv/V = cl_i / 4;
 *   additional lift cl - cl_i: the leading-edge suction peak, 0.5 |dcl| + 0.2 dcl^2 (about -2 at cl = 1 on the
 *     symmetric part of a Clark Y).
 * Measuring the leading-edge term from zero lift instead of from cl_i, as for a symmetric section, charged a
 * propeller tip working near its design lift (climb and cruise, cl 0.4-0.9) with a suction peak it does not have:
 * a critical Mach number of ~0.48 at cl 0.8, against ~0.62 from Korn's equation for a 6 % section (Mason,
 * "Configuration Aerodynamics" ch. 7), and wave drag of 0.05-0.15 over the outer quarter of the blade in a
 * full-throttle climb, which cost ~0.07 of propeller efficiency there and more with altitude (colder air, higher
 * tip Mach). A section far from its design lift (the tips at static thrust, at 10-12 deg) is unaffected.
 */
function waveDrag(mach: number, tOverC: number, cl: number, s: BladeSectionDef): number {
  const ca = Math.min(Math.abs(cl - s.clIdeal), 1.5);
  const peak = 1 + 1.6 * tOverC + s.clIdeal / 4 + 0.5 * ca + 0.2 * ca * ca;
  const mcrit = interp1(SUCTION, CRITICAL_MACH, peak * peak - 1);
  const dm = Math.min(mach, 1.2) - mcrit;
  return dm > 0 ? 20 * dm * dm * dm * dm : 0;
}

/**
 * Viterna-Corrigan post-stall lift and drag at alpha in [alphaStall, 90 deg], anchored to the attached-flow
 * values (clStall, cdStall) so the curve is continuous at the stall angle.
 */
function viterna(alpha: number, alphaStall: number, clStall: number, cdStall: number, cdMax: number, out: SectionCoefficients): void {
  const ss = Math.sin(alphaStall);
  const cs = Math.cos(alphaStall);
  const a2 = ((clStall - cdMax * ss * cs) * ss) / (cs * cs);
  const b2 = (cdStall - cdMax * ss * ss) / cs;
  const sa = Math.sin(alpha);
  const ca = Math.cos(alpha);
  out.cl = (cdMax / 2) * Math.sin(2 * alpha) + (a2 * ca * ca) / Math.max(sa, 1e-6);
  out.cd = cdMax * sa * sa + b2 * ca;
}

/** Attached-flow lift and drag (valid below stall, extrapolated linearly through it for the stall blend). */
function attached(alpha: number, slope: number, cd0: number, s: BladeSectionDef, out: SectionCoefficients): void {
  const cl = slope * (alpha - s.alpha0);
  const dcl = cl - s.clMinDrag;
  out.cl = cl;
  out.cd = cd0 + s.dragDueToLift * dcl * dcl;
}

/**
 * Section coefficients for alpha in [-90, 90] deg. `stallDelay` is Snel's 3 (c/r)^2 (0 for a 2D section).
 * Stall is rounded over +-STALL_BLEND by blending the attached and post-stall curves; a sharp lift break gives
 * the BEM residual several nearby roots and makes rotor loads jump as elements cross it.
 */
function forwardFlow(alpha: number, mach: number, tOverC: number, stallDelay: number, s: BladeSectionDef, out: SectionCoefficients): void {
  // Prandtl-Glauert on the lift slope, held constant above M 0.7 where the linear theory stops applying.
  const m = Math.min(mach, 0.7);
  const slope = s.liftSlope / Math.sqrt(1 - m * m);
  const clMax = s.clMaxLowSpeed - s.clMaxMachLoss * clamp(mach - 0.3, 0, 0.5);
  const cd0 = profileDrag(tOverC);
  const alphaStallPos = s.alpha0 + clMax / slope;
  const alphaStallNeg = s.alpha0 + s.clMin / slope;
  if (alpha > alphaStallNeg + STALL_BLEND && alpha < alphaStallPos - STALL_BLEND) {
    attached(alpha, slope, cd0, s, out);
  } else if (alpha >= alphaStallPos - STALL_BLEND) {
    const d = clMax - s.clMinDrag;
    // Inside the blend zone the post-stall curve is held at its stall-angle value.
    const a = Math.max(alpha, alphaStallPos);
    viterna(a, alphaStallPos, clMax, cd0 + s.dragDueToLift * d * d, s.cdMax, out);
    if (stallDelay > 0 && a < STALL_DELAY_END) {
      const fade = a <= STALL_DELAY_FULL ? 1 : (STALL_DELAY_END - a) / (STALL_DELAY_END - STALL_DELAY_FULL);
      out.cl += fade * stallDelay * (slope * (a - s.alpha0) - out.cl);
    }
    blendWithAttached(alpha, alphaStallPos, 1, slope, cd0, s, out);
  } else {
    // Mirror the negative-stall side into the Viterna form, then flip the sign of lift back.
    const d = s.clMin - s.clMinDrag;
    viterna(-Math.min(alpha, alphaStallNeg), -alphaStallNeg, -s.clMin, cd0 + s.dragDueToLift * d * d, s.cdMax, out);
    out.cl = -out.cl;
    blendWithAttached(alpha, alphaStallNeg, -1, slope, cd0, s, out);
  }
  // The suction peak that sets the critical Mach number is that of the loading the section is trying to carry
  // (shock-induced separation is what stalls it at high subsonic speed), so use the potential-flow lift.
  out.cd += waveDrag(mach, tOverC, slope * (alpha - s.alpha0), s);
}

/**
 * Blend the post-stall coefficients in `out` with the attached curve across alphaStall +- STALL_BLEND.
 * `side` is +1 for the positive stall (stalled above alphaStall) and -1 for the negative stall.
 */
function blendWithAttached(
  alpha: number,
  alphaStall: number,
  side: 1 | -1,
  slope: number,
  cd0: number,
  s: BladeSectionDef,
  out: SectionCoefficients,
): void {
  const x = side * (alpha - alphaStall);
  if (x >= STALL_BLEND) return;
  // Weight of the post-stall curve: 0 at STALL_BLEND before the stall angle, 1/2 at it, 1 at STALL_BLEND beyond.
  const w = smoothstep(-STALL_BLEND, STALL_BLEND, x);
  const cl = out.cl;
  const cd = out.cd;
  attached(alpha, slope, cd0, s, out);
  out.cl += w * (cl - out.cl);
  out.cd += w * (cd - out.cd);
}

/**
 * Lift and drag coefficients of a blade section at any angle of attack (rad, any value; wrapped internally),
 * local Mach number, thickness ratio and Snel stall-delay factor 3 (c/r)^2. Writes into `out` and returns it.
 * `section` is the blade's section family (default: the McCauley blade's).
 */
export function sectionCoefficients(
  alpha: number,
  mach: number,
  tOverC: number,
  stallDelay: number,
  out: SectionCoefficients,
  section: BladeSectionDef = C172_BLADE_SECTION,
): SectionCoefficients {
  let a = alpha % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  else if (a < -Math.PI) a += 2 * Math.PI;
  const half = Math.PI / 2;
  if (a >= -half && a <= half) {
    forwardFlow(a, mach, tOverC, stallDelay, section, out);
  } else {
    // Flow from the trailing edge: AirfoilPrep mirror rule. The mirrored angle lies in [-90, 90] deg.
    forwardFlow(a > 0 ? Math.PI - a : -Math.PI - a, mach, tOverC, 0, section, out);
    out.cl *= -0.7;
  }
  return out;
}
