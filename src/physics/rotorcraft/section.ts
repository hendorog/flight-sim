// Main-rotor blade section model for high advance ratio (AH-56A stage 5). Owner: AH. Plan revision 2, section 7.4;
// docs/ah56-high-speed.md section 2 has the sources, every number's tag and the checks.
//
// RC (stage 1) makes both the BEM (rotor.ts) and the hinge forcing (articulated.ts hubForcing, aerodynamicHubMoment) call
// sectionCoefficients() when `RotorDefinition.section` is set; absent, the legacy analytic polar and the legacy call text stay.
//
// Two models share the one contract:
// - without `polar`: the S0 stub's arithmetic, kept verbatim (the attached-flow analytic polar with an optional Prandtl-Glauert
//   cap and a quadratic drag rise). AC's provisional placeholder (compound.ts PROVISIONAL_SECTION, the C4 "with the Mach
//   placeholder" row) flies it unchanged.
// - with `polar` (AH): the section through the whole incidence circle, -pi < alpha <= pi:
//   * attached flow: Prandtl-Glauert lift slope with a cap; the drag rise past the drag-divergence Mach number (Lock's
//     fourth-power law about the critical Mach number, which falls with lift); Cm0 (no subcritical change, P NACA WR L-357)
//     and the supercritical Mach tuck;
//   * static stall at the Mach-dependent maximum lift: lift falls towards the separated flat plate, drag rises to it, and the
//     centre of pressure moves aft of the quarter chord, which is the MOMENT STALL (the sudden nose-down Cm break of a
//     cambered section, P NACA Report 530 Table IV);
//   * the separated flat plate at large incidence (normal force cn90 sin alpha, centre of pressure moving to 0.5 c at
//     90 deg and 0.75 c at 180 deg, P NACA TN 3361);
//   * reversed flow (|alpha| > 90 deg): the section seen from its trailing edge, a thin-airfoil lift slope about the reversed
//     zero (alpha -/+ pi) up to its own small stall, twice the forward profile drag (P NACA TN 3361), and the moment of that
//     lift about the feathering axis from its own quarter chord, 0.75 c from the leading edge (cm = +0.5 cl to first order in
//     this function's sign convention). With the lift slope of the attached forward flow it reproduces the linear hub forcing's
//     reverse-flow lift to first order (the callers' normal force is q c (cl cos phi - cd sin phi) with cos phi < 0).
// Sign convention (the callers'): alpha is the incidence of the relative wind to the zero-lift chord line, nose up +; cl along
// the lift direction; cm about the quarter chord (the feathering axis), nose up +.
//
// The returned object is REUSED: read it before the next call (every caller does). No allocation per call.

export interface SectionPolar {
  /** Prandtl-Glauert: the lift-slope factor 1/sqrt(1 - M^2) is held at this value above the Mach number that reaches it. */
  machCap: number;
  /** Maximum lift against Mach number: the table `value` at `mach` (ascending, linear between, held beyond both ends; its
   *  first value is the definition's maxCl); the negative stall at -negativeFraction x that. */
  clMax: { mach: readonly number[]; value: readonly number[]; negativeFraction: number };
  /** Past the stall angle (clMax / slope), lift fades to the flat plate over `liftFade` rad and drag rises to it over
   *  `dragFade` rad (smoothsteps). */
  liftFade: number; dragFade: number;
  /** Separated flat plate: normal-force coefficient at 90 deg. */
  cn90: number;
  /** Moment stall: past the stall angle the centre of pressure moves aft of the quarter chord by `shift` (fraction of chord)
   *  over `over` rad; further on, the flat plate's 0.5 |alpha| / pi where larger. The shift is the low-speed (leading-edge)
   *  stall's: it fades out between machFade[0] and machFade[1], where the separation is shock-induced and the drag rise and the
   *  tuck carry the Mach effects. */
  momentStall: { shift: number; over: number; machFade: readonly [number, number] };
  /** Drag divergence (attached flow): M_dd = mach0 - perCl |cl|; M_crit = M_dd - offset; cd += rise (M - M_crit)^4. */
  dragDivergence: { mach0: number; perCl: number; offset: number; rise: number };
  /** Supercritical Mach tuck: cm -= slope (M - M_crit), at most `max`. */
  machTuck: { slope: number; max: number };
  /** Reversed flow: lift slope, /rad, about the reversed zero; its maximum lift; its profile drag as a multiple of cd0. */
  reverse: { liftSlope: number; clMax: number; dragFactor: number };
}

export interface RotorSectionDef {
  /** Incompressible lift slope, 1/rad, and attached-flow limits (polar: the low-Mach maximum lift). */
  liftSlope: number; maxCl: number;
  /** Profile drag polar: cd = cd0 + cd2 * cl^2 (attached). */
  cd0: number; cd2: number;
  /** Pitching moment about 1/4 chord, attached flow. */
  cm0: number;
  /** S0 stub: Prandtl-Glauert lift slope with this cap on 1/sqrt(1 - M^2). */
  machCap?: number;
  /** S0 stub: drag rise past `divergence` Mach: cd += rise * (M - divergence)^2 (AC's provisional placeholder). */
  machDragRise?: { divergence: number; rise: number };
  /** S0 stub: constant reverse-flow coefficients. */
  reverseFlow?: { cl: number; cd: number; cm: number };
  /** S0 stub field (not read by the stub; `polar.momentStall` is the model's). */
  momentStall?: { alpha: number; cmBreak: number };
  /** AH: the full section model (see the file header). Absent: the S0 stub arithmetic. */
  polar?: SectionPolar;
}

export interface SectionCoefficients { cl: number; cd: number; cm: number }
const OUT: SectionCoefficients = { cl: 0, cd: 0, cm: 0 };
const HALF_PI = Math.PI / 2;

function smoothstep(x: number): number { return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x); }

/** Maximum lift at Mach m from the table (ascending Mach, linear between, held beyond both ends); `low` with no table. */
function maxLift(low: number, mach: readonly number[], value: readonly number[], m: number): number {
  const n = mach.length;
  if (n === 0) return low;
  if (m <= mach[0]) return value[0];
  if (m >= mach[n - 1]) return value[n - 1];
  let i = 1;
  while (mach[i] < m) i++;
  return value[i - 1] + (m - mach[i - 1]) / (mach[i] - mach[i - 1]) * (value[i] - value[i - 1]);
}

/** Section coefficients at angle of attack alpha (rad, (-pi, pi]), Mach, and whether the flow is reversed (|alpha| > pi/2).
 *  The returned object is reused: read it before the next call. */
export function sectionCoefficients(s: RotorSectionDef, alpha: number, mach: number, reverse: boolean): SectionCoefficients {
  const p = s.polar;
  if (!p) {
    // The S0 stub, verbatim.
    if (reverse && s.reverseFlow) { OUT.cl = s.reverseFlow.cl; OUT.cd = s.reverseFlow.cd; OUT.cm = s.reverseFlow.cm; return OUT; }
    const pg = 1 / Math.sqrt(Math.max(1 - mach * mach, 1e-6));
    const slope = s.liftSlope * Math.min(pg, s.machCap ?? 1);
    const cl = Math.max(-s.maxCl, Math.min(s.maxCl, slope * alpha));
    const rise = s.machDragRise && mach > s.machDragRise.divergence ? s.machDragRise.rise * (mach - s.machDragRise.divergence) ** 2 : 0;
    OUT.cl = cl; OUT.cd = s.cd0 + s.cd2 * cl * cl + rise; OUT.cm = s.cm0;
    return OUT;
  }
  const a = Math.abs(alpha), sign = alpha < 0 ? -1 : 1;
  if (reverse || a > HALF_PI) {
    // Reversed flow: incidence about the reversed zero, alphaR in (-pi/2, pi/2]; Mach effects are not modelled (the dynamic
    // pressure there is a few per cent of the tip's).
    const sinA = Math.sin(alpha), cosA = Math.cos(alpha);
    const r = p.reverse, alphaR = alpha - sign * Math.PI, ar = Math.abs(alphaR);
    const stall = r.clMax / r.liftSlope;
    let cl: number, cd: number;
    const cdAttached = r.dragFactor * s.cd0;
    if (ar <= stall) { cl = r.liftSlope * alphaR; cd = cdAttached + s.cd2 * cl * cl; }
    else {
      // Towards the separated flat plate (normal force cn90 sin alpha).
      const fade = smoothstep((ar - stall) / p.liftFade), dfade = smoothstep((ar - stall) / p.dragFade);
      cl = (1 - fade) * (alphaR < 0 ? -r.clMax : r.clMax) + fade * p.cn90 * sinA * cosA;
      cd = (1 - dfade) * (cdAttached + s.cd2 * cl * cl) + dfade * (s.cd0 + p.cn90 * sinA * sinA);
    }
    // Normal force (towards the forward section's upper surface) and its moment about the quarter chord from the centre of
    // pressure at 0.25 + 0.5 |alpha| / pi of the chord (0.75 c at 180 deg: the reversed section's quarter chord).
    OUT.cl = cl; OUT.cd = cd; OUT.cm = -0.5 * a / Math.PI * (cl * cosA + cd * sinA);
    return OUT;
  }
  const m = mach < 0 ? 0 : mach > 0.99 ? 0.99 : mach;
  const pg = Math.min(1 / Math.sqrt(1 - m * m), p.machCap);
  const slope = s.liftSlope * pg;
  const c = p.clMax;
  const clMax = maxLift(s.maxCl, c.mach, c.value, m);
  const clMaxSide = alpha >= 0 ? clMax : c.negativeFraction * clMax;
  const dd = p.dragDivergence;
  if (slope * a <= clMaxSide) {
    // Attached: no trigonometry.
    const cl = slope * alpha;
    const over = m - (dd.mach0 - dd.perCl * (cl < 0 ? -cl : cl) - dd.offset);
    let cd = s.cd0 + s.cd2 * cl * cl, cm = s.cm0;
    if (over > 0) {
      const o2 = over * over;
      cd += dd.rise * o2 * o2;
      cm -= Math.min(p.machTuck.max, p.machTuck.slope * over);
    }
    OUT.cl = cl; OUT.cd = cd; OUT.cm = cm;
    return OUT;
  }
  // Stalled: lift fades to the flat plate, drag rises to it, and the centre of pressure moves aft of the quarter chord (the
  // MOMENT STALL, P NACA Report 530 Table IV), then follows the plate.
  const sinA = Math.sin(alpha), cosA = Math.cos(alpha);
  const past = a - clMaxSide / slope;
  const fade = smoothstep(past / p.liftFade), fadeD = smoothstep(past / p.dragFade);
  const cl = (1 - fade) * sign * clMaxSide + fade * p.cn90 * sinA * cosA;
  const ms = p.momentStall, lowSpeed = 1 - smoothstep((m - ms.machFade[0]) / (ms.machFade[1] - ms.machFade[0]));
  const shift = Math.max(lowSpeed * ms.shift * Math.min(1, past / ms.over), fade * 0.5 * a / Math.PI);
  const over = m - (dd.mach0 - dd.perCl * Math.abs(cl) - dd.offset);
  const o2 = over * over;
  const cd = (1 - fadeD) * (s.cd0 + s.cd2 * cl * cl + (over > 0 ? dd.rise * o2 * o2 : 0)) + fadeD * (s.cd0 + p.cn90 * sinA * sinA);
  const tuck = over > 0 ? Math.min(p.machTuck.max, p.machTuck.slope * over) : 0;
  // Attached moment (Cm0 and the tuck) fading with the lift; the stall's centre-of-pressure shift on the normal force.
  OUT.cl = cl; OUT.cd = cd; OUT.cm = (1 - fade) * (s.cm0 - tuck) - shift * (cl * cosA + cd * sinA);
  return OUT;
}

/** The section's attached-flow limits at a Mach number, for reports and tests: lift slope (/rad), maximum lift, the stall
 *  angle (rad), and the drag-divergence and critical Mach numbers at a lift coefficient. Needs `polar`. */
export function sectionLimits(s: RotorSectionDef, mach: number, cl = 0): { slope: number; clMax: number; stall: number; dragDivergence: number; critical: number } {
  const p = s.polar!;
  const m = Math.min(Math.max(mach, 0), 0.99);
  const slope = s.liftSlope * Math.min(1 / Math.sqrt(1 - m * m), p.machCap);
  const clMax = maxLift(s.maxCl, p.clMax.mach, p.clMax.value, m);
  const dd = p.dragDivergence.mach0 - p.dragDivergence.perCl * Math.abs(cl);
  return { slope, clMax, stall: clMax / slope, dragDivergence: dd, critical: dd - p.dragDivergence.offset };
}
