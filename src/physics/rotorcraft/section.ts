// Main-rotor blade section model for high advance ratio (AH-56A stage 5): the contract and an S0 stub. Owner after
// the scaffold: AH. Plan revision 2, section 7.4.
//
// RC (stage 1) makes both the BEM (rotor.ts) and the hinge forcing (articulated.ts flapForcing) call
// sectionCoefficients() when `RotorDefinition.section` is set; absent, the legacy analytic polar and the legacy call
// text stay. The S0 stub is the attached-flow analytic polar plus an optional provisional Mach drag rise, which AC
// uses to calibrate the AH-56 drag area before AH writes the real section (plan 7.3, drag budget).

export interface RotorSectionDef {
  /** Incompressible lift slope, 1/rad, and attached-flow limits. */
  liftSlope: number; maxCl: number;
  /** Profile drag polar: cd = cd0 + cd2 * cl^2 (attached). */
  cd0: number; cd2: number;
  /** Pitching moment about 1/4 chord, attached flow. */
  cm0: number;
  /** Prandtl-Glauert lift slope with this cap on 1/sqrt(1 - M^2). */
  machCap?: number;
  /** Drag rise past `divergence` Mach: cd += rise * (M - divergence)^2 (provisional placeholder, M_dd 0.78 ESTIMATE). */
  machDragRise?: { divergence: number; rise: number };
  /** AH: reverse-flow polar, static stall, Cm(alpha, M) with moment stall (the (4.6)3012 root / (0.6)3006 tip). */
  reverseFlow?: { cl: number; cd: number; cm: number };
  momentStall?: { alpha: number; cmBreak: number };
}

/** Section coefficients at angle of attack alpha (rad), Mach, and whether the flow is reversed. S0 STUB. */
export function sectionCoefficients(s: RotorSectionDef, alpha: number, mach: number, reverse: boolean): { cl: number; cd: number; cm: number } {
  if (reverse && s.reverseFlow) return { ...s.reverseFlow };
  const pg = 1 / Math.sqrt(Math.max(1 - mach * mach, 1e-6));
  const slope = s.liftSlope * Math.min(pg, s.machCap ?? 1);
  const cl = Math.max(-s.maxCl, Math.min(s.maxCl, slope * alpha));
  const rise = s.machDragRise && mach > s.machDragRise.divergence ? s.machDragRise.rise * (mach - s.machDragRise.divergence) ** 2 : 0;
  return { cl, cd: s.cd0 + s.cd2 * cl * cl + rise, cm: s.cm0 };
}
