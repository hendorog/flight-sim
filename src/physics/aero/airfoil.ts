// Two-dimensional aerofoil section model valid over the full -180..180 degree range.
//
// Lift is a Kirchhoff-type blend between attached potential flow and a separated flat plate:
//   cl = w(f) cl_pot(alpha) + (1 - w(f)) cl_plate(alpha)
// where f is the trailing-edge separation point (1 = attached, 0 = fully separated) and
// w(f) = (((1 + sqrt f) / 2)^2 - 1/4) / (3/4) is the Kirchhoff factor rescaled to run from 0 to 1.
// The static separation curve f(alpha) is the exponential fit of Leishman & Beddoes (1989), with the
// "break" angles (f = 0.7 unless the section says otherwise) measured from the zero-lift angle. The flat plate is Hoerner's normal-force
// model: cn = cn90 sin(alpha), so cl = cn90 sin(a) cos(a) (~ sin 2a) and cd = cn90 sin^2(a) (~ 2 sin^2 a).
// cn90 is the 2-D plate value (1.98) at moderate angles and falls to the finite-surface value at 90 deg,
// where flow around the tips relieves the pressure (cn90 = cd90 + (1.98 - cd90) cos^2 a; same limits as
// Viterna & Corrigan's post-stall model).
// Reverse flow (trailing edge first, tail slides) uses a weaker potential branch that stalls early at
// the sharp trailing edge.
//
// Dynamic stall: the model is evaluated with the separation point f supplied by the caller, who lags
// it behind the static curve (see SEPARATION_LAG); at a frozen f the lift slope stays positive through
// the stall, which is what keeps the lifting-line solve well posed.
//
// Flaps and control surfaces use thin-aerofoil theory (Glauert) for the zero-lift shift and the
// quarter-chord moment, with empirical large-deflection effectiveness and a C_l,max gain ratio that
// distinguishes plain from slotted flaps.

import { interp1, wrapPi } from '../../core/math';

export interface AirfoilSection {
  name: string;
  /** Lift-curve slope, 1/rad, incompressible, at reRef. */
  liftSlope: number;
  /** Zero-lift angle of attack, rad. */
  alpha0: number;
  /** Quarter-chord pitching moment coefficient in attached flow. */
  cm0: number;
  /** Minimum profile drag at reRef (smooth surface) and the lift coefficient where it occurs. */
  cdMin: number;
  clCdMin: number;
  /** Drag polar curvature: cd = cdMin + dragBucket (cl - clCdMin)^2 in attached flow (standard-roughness data). */
  dragBucket: number;
  /** Reynolds number the data refer to. */
  reRef: number;
  /** Positive and negative break angles (f = breakSeparation, 0.7) measured from the zero-lift angle at reRef, rad. */
  stallPos: number;
  stallNeg: number;
  /** Change of the break angles per decade of Reynolds number, rad (magnitude grows with Re). */
  stallReSlope: number;
  /** Separation-curve widths before and after the break, rad (Leishman-Beddoes S1, S2). */
  s1: number;
  s2: number;
  /** Reverse-flow lift slope (1/rad) and break angle (rad). */
  reverseLiftSlope: number;
  reverseStall: number;
  /**
   * Leishman-Beddoes centre-of-pressure terms on the attached (Kirchhoff) part of the load, cm += cl_pot (K2 sin(pi f^2)
   * - K1 (1 - f)): as the trailing-edge separation point moves forward the attached load's centre of pressure first
   * moves slightly forward (the moment rises just before the peak) and then aft (Leishman & Beddoes, "A semi-empirical
   * model for dynamic stall", J. AHS 34 (3), 1989, eq. for C_m with K1, K2; their K1 also covers the separated part's
   * shift, which is modelled separately here as the flat plate's centre of pressure). Optional: 0 if not fitted.
   */
  momentK1?: number;
  momentK2?: number;
  /**
   * Separation point f at the break angles (stallPos, stallNeg), default 0.7. A section that stalls from the
   * trailing edge gradually (separation creeping forward from ~8 deg, c_l,max with the flow separated over the aft
   * 40-55 % of the chord, then a collapse: NASA LS(1)-0417, NACA 65(2)-415) peaks at f ~0.45-0.6; with the break at
   * 0.7 its lift would peak 3-4 deg before the measured angle whatever stallPos, s1 and s2 are. Optional: 0.7 if
   * not fitted.
   */
  breakSeparation?: number;
  /**
   * Collapse of a soft stall, rad: beyond stallPos + collapseAfter the separation point also decays with the width
   * collapseWidth, so a section whose measured lift holds a plateau far past its break (Wortmann FX 63-137: within
   * 0.04 of c_l,max from 11 to 20 deg, where the data end) still loses its lift to the separated level beyond it.
   * Positive side only. Optional, both or neither: no collapse if absent.
   */
  collapseAfter?: number;
  collapseWidth?: number;
}

/** Normal-force coefficient of an infinitely long flat plate broadside to the flow (Hoerner). */
export const PLATE_CN90_2D = 1.98;

/** Leishman-Beddoes time constants, in semichord travel times (tau = T c / (2 V)). */
export const SEPARATION_LAG = {
  /** Leading-edge pressure lag applied to the angle of attack that drives separation. */
  pressure: 1.7,
  /** Boundary-layer lag of the separation point itself. */
  boundaryLayer: 3.0,
} as const;

// --- Flaps and control surfaces ---

/**
 * 'allMoving': the deflection ROTATES the strip (a stabilator): its section is evaluated at (local alpha +
 * deflection) on every branch, see allMovingRotation(); nothing of the trailing-edge flap model applies to it.
 */
export type FlapKind = 'plain' | 'slotted' | 'allMoving';

export interface FlapGeometry {
  kind: FlapKind;
  /** Flap chord / section chord. */
  chordFraction: number;
  /** Fowler chord extension at `fowlerDeflection` as a fraction of the section chord (0 for a simple hinge). */
  fowler?: number;
  fowlerDeflection?: number;
  /**
   * Fraction of the thin-aerofoil lift effectiveness the surface achieves at small deflection (default 1).
   * Boundary-layer growth over the hinge line costs a plain flap 10-35 %, more for thick sections and small
   * flap-chord ratios (DATCOM 6.1.1.1, fig. 6.1.1.1-39, against c_l_alpha / c_l_alpha,theory and cf/c).
   */
  viscousEffectiveness?: number;
  /**
   * Frise aileron: the balance nose of a surface deflected trailing edge up protrudes below the wing's lower
   * surface into the high-pressure flow and adds profile drag on that side (the up-going aileron's, i.e. the
   * descending wing's), which is what opposes the adverse yaw. Section drag coefficient per unit sin(up
   * deflection) per unit flap-chord ratio (NACA TR 598 / Wenzinger: nose drag ~0.02-0.035 of the wing chord at
   * 15-20 deg up for 0.25c Frise ailerons, i.e. ~0.35). 0 for a plain surface.
   */
  friseNoseDrag?: number;
  /**
   * Measured large-deflection effectiveness, replacing the kind's DATCOM table (EFFECT): fractions of the
   * small-deflection effectiveness at 0, 10, 20, 30, 45, 60 and 90 deg (7 values, the first two normally 1). For a
   * surface whose section has its own data: a 0.20c sealed plain flap on the NASA LS(1)-0417 keeps 0.86 / 0.80 /
   * 0.71 / 0.57 of its 10-deg effectiveness at 20 / 30 / 40 / 60 deg (sections.md 1.6, NASA CR-2833), where the
   * plain table falls to 0.8 / 0.64 / 0.55 / 0.42. Absent: the table.
   */
  largeDeflection?: readonly number[];
}

/** Pre-computed thin-aerofoil constants for one flap geometry. */
export interface FlapModel {
  kind: FlapKind;
  chordFraction: number;
  /** Flap effectiveness d(alpha0)/d(delta) = -tau (Glauert). */
  tau: number;
  /** Fraction of the thin-aerofoil effectiveness a real flap of this kind achieves at small deflection. */
  viscous: number;
  /** d(cm_c/4)/d(delta) = -0.5 sin(th)(1 - cos(th)). */
  cmPerRad: number;
  fowler: number;
  fowlerDeflection: number;
  friseNoseDrag: number;
  /** Equivalent-inclination coupling k of a plain surface: its loss is looked up at delta + k alpha (see flapAlphaCoupling). */
  alphaCoupling: number;
  /** FlapGeometry.largeDeflection, when given (absent: the kind's table). */
  effect?: readonly number[];
}

/**
 * Deflection-dependent effectiveness for large deflections (after DATCOM 6.1.1.1 / Roskam VI fig. 8.17). For
 * single-slotted flaps the fraction is DATCOM's section lift effectiveness alpha_delta for a 0.3c flap (about
 * 0.55, 0.50 and 0.45 at 10, 20 and 30 deg) over thin-aerofoil theory's 0.66: below one already at small
 * deflection, where the slot is still nearly closed and the flap acts like a plain one.
 */
const EFFECT_DEG = [0, 10, 20, 30, 45, 60, 90];
const EFFECT = {
  plain: [1, 1, 0.8, 0.64, 0.5, 0.42, 0.3],
  slotted: [1, 0.85, 0.77, 0.7, 0.58, 0.48, 0.35],
} as const;
/** Fraction of the linear lift increment that is also gained in c_l,max (slot re-energises the flap). */
const CLMAX_RATIO = { plain: 0.6, slotted: 0.8 } as const;
/** Profile-drag increment dcd = K cf sin^2(delta) (fit to Young's method as given by ESDU 87024). */
const FLAP_DRAG_K = { plain: 0.8, slotted: 0.45 } as const;

/**
 * Angle by which an all-moving surface deflected by `delta` (rad, + = trailing edge down) rotates its section
 * against the flow, rad; 0 for a trailing-edge flap. The caller evaluates the section at alpha + this angle
 * everywhere (attached branch, separation point and the separated flat plate), with lift and drag still resolved
 * about the local wind. A zero-lift shift would be right only while the flow is attached: the separated branch of
 * evaluateSection uses the raw angle, so a stabilator on its stop at -12.5 deg in -8 deg of tail angle of attack
 * would get the plate force of -8 instead of -20.5 deg, about 40 % of it. No hinge line: no large-deflection
 * loss, no flap profile drag, no moment increment, no change of the break angles.
 */
export function allMovingRotation(m: FlapModel, delta: number): number {
  return m.kind === 'allMoving' ? delta : 0;
}

export function makeFlapModel(g: FlapGeometry): FlapModel {
  const th = Math.acos(2 * g.chordFraction - 1);
  if (g.largeDeflection && g.largeDeflection.length !== EFFECT_DEG.length) {
    throw new Error(`makeFlapModel: largeDeflection needs ${EFFECT_DEG.length} values (at ${EFFECT_DEG.join(', ')} deg)`);
  }
  const m: FlapModel = {
    kind: g.kind,
    chordFraction: g.chordFraction,
    tau: 1 - (th - Math.sin(th)) / Math.PI,
    viscous: g.viscousEffectiveness ?? 1,
    cmPerRad: -0.5 * Math.sin(th) * (1 - Math.cos(th)),
    fowler: g.fowler ?? 0,
    fowlerDeflection: g.fowlerDeflection ?? 1,
    friseNoseDrag: g.friseNoseDrag ?? 0,
    alphaCoupling: g.kind === 'plain' ? flapAlphaCoupling(g.chordFraction) : 0,
  };
  if (g.largeDeflection) m.effect = g.largeDeflection;
  return m;
}

/** Thin-aerofoil loading per radian (Delta Cp) of the flat section at x (alpha) and of a flap hinged at xh (delta). */
function loadingAlpha(x: number): number {
  const th = Math.acos(1 - 2 * x);
  return (4 * (1 + Math.cos(th))) / Math.sin(th);
}
function loadingFlap(x: number, xh: number): number {
  const th = Math.acos(1 - 2 * x), thh = Math.acos(1 - 2 * xh);
  return 4 * ((1 - thh / Math.PI) * (1 + Math.cos(th)) / Math.sin(th) + Math.log(Math.abs(Math.sin((th + thh) / 2) / Math.sin((th - thh) / 2))) / Math.PI);
}

/** Coupling k of the section angle of attack into a plain flap's large-deflection loss (see the note above addFlapDeflection). */
export function flapAlphaCoupling(chordFraction: number): number {
  const cf = Math.min(Math.max(chordFraction, 0.05), 0.6);
  const xh = 1 - cf, x1 = xh + 0.1 * cf, x2 = 1 - 0.05 * cf;
  return (loadingAlpha(x1) - loadingAlpha(x2)) / (loadingFlap(x1, xh) - loadingFlap(x2, xh));
}

/** Sum of the section changes produced by all deflected surfaces on one strip. */
export interface FlapIncrement {
  /** Zero-lift angle shift, rad. */
  dAlpha0: number;
  /** Shift of both break angles relative to the new zero-lift angle, rad. */
  dStall: number;
  dCd: number;
  dCm: number;
  /** Extra chord from Fowler travel, as a fraction of the section chord. */
  chordExtension: number;
}

export function clearFlapIncrement(inc: FlapIncrement): FlapIncrement {
  inc.dAlpha0 = 0;
  inc.dStall = 0;
  inc.dCd = 0;
  inc.dCm = 0;
  inc.chordExtension = 0;
  return inc;
}

/**
 * The large-deflection loss of a plain surface comes from separation on its suction side (the lower surface for a
 * trailing-edge-up deflection), where the boundary layer meets the pressure recovery from the hinge line to the
 * trailing edge. DATCOM 6.1.1.1 tabulates the loss for the section at zero angle of attack. The section's own angle
 * of attack adds a recovery of its own over the flap chord: it steepens the flap's recovery when it loads the same
 * surface as the deflection and relieves it when it opposes it (Hoerner & Borst, "Fluid-Dynamic Lift", sec. 5-10).
 * The two recoveries are not equal per degree: the flap's comes from the kink at the hinge, while the angle of
 * attack's loading is concentrated near the leading edge and has largely decayed by the hinge. From thin-aerofoil
 * theory (Glauert), with the loadings
 *   dCp_alpha = 4 alpha (1 + cos th) / sin th,
 *   dCp_delta = 4 delta [(1 - th_h / pi)(1 + cos th) / sin th + ln|sin((th + th_h)/2) / sin((th - th_h)/2)| / pi]
 * (x = (1 - cos th) / 2, hinge at th_h), the recovery over the flap from 0.1 flap chord behind the hinge (the
 * hinge-line singularity is rounded off by the gap and the nose radius) to 0.95 of the way to the trailing edge is
 * k times as large per degree of alpha as per degree of deflection: k = 0.54 for the C172's 0.42c elevator, 0.41 for
 * its 0.26c ailerons, 0.52 for the 0.40c rudder (checked against a 800-panel discrete-vortex solution, which also
 * reproduces tau). The loss is looked up at the equivalent inclination delta + k alpha while that has the
 * deflection's sign. (A coupling of 1, the flap's inclination to the free stream, overstated the relief: with the
 * yoke held fully back it let the elevator hold the wing ~2.5 deg deeper into the stall, alpha 20.9 against 18.6 deg
 * at the typical CG and 23.7 against 21.3 deg at the aft limit, where the wing autorotates in roll.)
 * Slotted flaps keep their tabulated values: the slot flow controls their boundary layer.
 */
/** Largest section angle of attack used for the coupling (beyond it the section is stalled anyway), rad. */
const COUPLING_ALPHA_LIMIT = 0.5;

/**
 * Accumulate the effect of flap `m` deflected by `delta` (rad, + = trailing edge toward the lower surface) on a
 * section at angle of attack `alpha` (rad, relative to its chord; only plain surfaces use it).
 */
export function addFlapDeflection(m: FlapModel, delta: number, inc: FlapIncrement, alpha = 0): void {
  if (delta === 0) return;
  // An all-moving surface changes no section constant: its deflection is a rotation (allMovingRotation).
  if (m.kind === 'allMoving') return;
  let ad = Math.abs(delta);
  if (m.kind === 'plain' && Number.isFinite(alpha)) {
    const rel = delta + m.alphaCoupling * Math.max(-COUPLING_ALPHA_LIMIT, Math.min(COUPLING_ALPHA_LIMIT, alpha));
    ad = rel * delta > 0 ? Math.abs(rel) : 0;
  }
  const eta = m.viscous * interp1(EFFECT_DEG, m.effect ?? EFFECT[m.kind], (ad * 180) / Math.PI);
  const da0 = -m.tau * eta * delta;
  inc.dAlpha0 += da0;
  // Flap down raises c_l,max by a fraction of the lift increment: the break angle, measured from the
  // shifted zero-lift angle, moves out by that fraction of |da0| (and in for a flap deflected up).
  inc.dStall -= CLMAX_RATIO[m.kind] * da0;
  const s = Math.sin(delta);
  // A plain surface's profile-drag increment comes from the same separated flow and grows with its inclination
  // to the oncoming flow: the increment over the undeflected section, sin^2(delta + alpha) - sin^2(alpha) (a down
  // aileron on a wing near the stall adds much more drag than at cruise). At zero angle of attack it is the
  // tabulated sin^2(delta), and it vanishes with the deflection.
  let drag = s * s;
  if (m.kind === 'plain' && Number.isFinite(alpha)) {
    const a = m.alphaCoupling * Math.max(-COUPLING_ALPHA_LIMIT, Math.min(COUPLING_ALPHA_LIMIT, alpha));
    const sr = Math.sin(delta + a), sa = Math.sin(a);
    drag = Math.max(sr * sr - sa * sa, 0);
  }
  inc.dCd += FLAP_DRAG_K[m.kind] * m.chordFraction * drag;
  if (delta < 0 && m.friseNoseDrag > 0) inc.dCd -= m.friseNoseDrag * m.chordFraction * s;
  const extension = fowlerExtension(m, delta);
  // Quarter-chord moment. A plain flap loses lift at large deflection because the flow separates over it,
  // which unloads the aft chord: moment and lift fall together. A slotted flap keeps its own element loaded
  // (the slot re-energises its boundary layer) while the main element's circulation falls short of the
  // thin-aerofoil value, so much less of the moment than of the lift is lost: Wenzinger & Harris (NACA TR
  // 664, 0.2566c slotted flap on a 23012) measure at 30 deg 58 % of the thin-aerofoil lift increment but ~83 %
  // of its moment, i.e. the flap load's centre of pressure lies near mid-chord (TR 664, 679: dcm/dcl ~ -0.22
  // to -0.28) rather than thin-aerofoil theory's 0.40 c. Fowler travel moves the flap aft on an extended chord
  // c' = c (1 + extension): a moment coefficient on c' is (c'/c)^2 larger on c.
  const etaMoment = m.kind === 'slotted' ? m.viscous * (1 - SLOTTED_MOMENT_LOSS * (1 - eta / m.viscous)) : eta;
  inc.dCm += m.cmPerRad * etaMoment * delta * (1 + extension) * (1 + extension);
  inc.chordExtension += extension;
}

/** Fowler chord extension (fraction of the section chord) at deflection `delta`: linear up to fowlerDeflection. */
export function fowlerExtension(m: FlapModel, delta: number): number {
  if (!(m.fowler > 0) || !(delta > 0)) return 0;
  return m.fowler * Math.min(delta / m.fowlerDeflection, 1);
}

/** Fraction of the large-deflection lift loss of a slotted flap that is also lost in its moment (TR 664). */
const SLOTTED_MOMENT_LOSS = 0.4;

/**
 * The section a fraction f of the way from a to b: linear in every field (an absent moment constant counts as 0,
 * an absent breakSeparation as 0.7; a collapse present on one side only is taken from that side).
 * For strips between two planform stations that carry different sections (a wing lofted from one section at the
 * root to another at the tip), and for a strip only partly covered by a section band.
 */
export function blendSections(a: AirfoilSection, b: AirfoilSection, f: number): AirfoilSection {
  if (f <= 0 || a === b) return a;
  if (f >= 1) return b;
  const mix = (x: number, y: number) => x + (y - x) * f;
  const s: AirfoilSection = {
    name: `${a.name} > ${b.name} ${f.toFixed(2)}`,
    liftSlope: mix(a.liftSlope, b.liftSlope),
    alpha0: mix(a.alpha0, b.alpha0),
    cm0: mix(a.cm0, b.cm0),
    cdMin: mix(a.cdMin, b.cdMin),
    clCdMin: mix(a.clCdMin, b.clCdMin),
    dragBucket: mix(a.dragBucket, b.dragBucket),
    reRef: mix(a.reRef, b.reRef),
    stallPos: mix(a.stallPos, b.stallPos),
    stallNeg: mix(a.stallNeg, b.stallNeg),
    stallReSlope: mix(a.stallReSlope, b.stallReSlope),
    s1: mix(a.s1, b.s1),
    s2: mix(a.s2, b.s2),
    reverseLiftSlope: mix(a.reverseLiftSlope, b.reverseLiftSlope),
    reverseStall: mix(a.reverseStall, b.reverseStall),
  };
  if (a.momentK1 !== undefined || b.momentK1 !== undefined) s.momentK1 = mix(a.momentK1 ?? 0, b.momentK1 ?? 0);
  if (a.momentK2 !== undefined || b.momentK2 !== undefined) s.momentK2 = mix(a.momentK2 ?? 0, b.momentK2 ?? 0);
  if (a.breakSeparation !== undefined || b.breakSeparation !== undefined) s.breakSeparation = mix(a.breakSeparation ?? 0.7, b.breakSeparation ?? 0.7);
  const ca = a.collapseAfter !== undefined && a.collapseWidth !== undefined;
  const cb = b.collapseAfter !== undefined && b.collapseWidth !== undefined;
  if (ca || cb) {
    s.collapseAfter = ca && cb ? mix(a.collapseAfter!, b.collapseAfter!) : ca ? a.collapseAfter : b.collapseAfter;
    s.collapseWidth = ca && cb ? mix(a.collapseWidth!, b.collapseWidth!) : ca ? a.collapseWidth : b.collapseWidth;
  }
  return s;
}

// --- Section evaluation ---

/** Section constants for the current Reynolds number, Mach number and flap setting. */
export interface SectionCondition {
  liftSlope: number;
  alpha0: number;
  stallPos: number;
  stallNeg: number;
  s1: number;
  s2: number;
  cm0: number;
  /**
   * Aft shift of the aerodynamic centre in section chords: a Fowler flap's travel extends the chord aft, so
   * the extended section's quarter chord lies 0.25 x the extension behind the original one.
   */
  acShift: number;
  cd0: number;
  clCdMin: number;
  dragBucket: number;
  reverseLiftSlope: number;
  reverseStall: number;
  cd90: number;
  momentK1: number;
  momentK2: number;
  /** Separation point at the break (AirfoilSection.breakSeparation) and 1 minus it. */
  breakSeparation: number;
  breakDrop: number;
  /** Angle from zero lift where a soft stall collapses (Infinity: never) and the collapse width, rad. */
  collapseAt: number;
  collapseWidth: number;
}

export function makeSectionCondition(): SectionCondition {
  return {
    liftSlope: 0, alpha0: 0, stallPos: 0, stallNeg: 0, s1: 1, s2: 1, cm0: 0, acShift: 0, cd0: 0,
    clCdMin: 0, dragBucket: 0, reverseLiftSlope: 0, reverseStall: 0, cd90: 0, momentK1: 0, momentK2: 0,
    breakSeparation: 0.7, breakDrop: 0.3, collapseAt: Infinity, collapseWidth: 1,
  };
}

/**
 * Fill `out` with the section constants at Reynolds number `re` and Mach `mach`.
 * `cd90` is the separated normal-force coefficient at 90 deg of the finite surface (<= 1.98) and
 * `skinFactor` scales the attached-flow profile drag for a production (riveted, painted) surface and
 * `liftSlopeFactor` the attached lift slope (hinge-gap leakage).
 */
export function prepareSection(
  s: AirfoilSection,
  re: number,
  mach: number,
  flap: FlapIncrement,
  cd90: number,
  skinFactor: number,
  out: SectionCondition,
  liftSlopeFactor = 1,
): SectionCondition {
  const reC = Math.min(Math.max(re, 1e5), 3e7);
  const decades = Math.log10(reC / s.reRef);
  // Prandtl-Glauert in the attached range; the C172 stays far below the limit.
  const m = Math.min(Math.abs(mach), 0.75);
  const pg = 1 / Math.sqrt(1 - m * m);
  const ext = 1 + flap.chordExtension;
  out.liftSlope = s.liftSlope * pg * ext * liftSlopeFactor;
  out.alpha0 = s.alpha0 + flap.dAlpha0;
  out.stallPos = Math.max(s.stallPos + s.stallReSlope * decades + flap.dStall, 2 * s.s1);
  out.stallNeg = Math.min(s.stallNeg - s.stallReSlope * decades + flap.dStall, -2 * s.s1);
  out.s1 = s.s1;
  out.s2 = s.s2;
  out.cm0 = s.cm0 * pg + flap.dCm;
  out.acShift = 0.25 * flap.chordExtension;
  // Turbulent skin friction scales as Re^-0.2 (Schlichting).
  out.cd0 = s.cdMin * skinFactor * Math.pow(reC / s.reRef, -0.2) + flap.dCd;
  out.clCdMin = s.clCdMin;
  // The curvature is taken from the standard-roughness polars (AirfoilSection.dragBucket): on a production
  // wing, transition moves forward toward the leading edge as the lift rises, so its polar steepens like the
  // rough one even where its minimum drag lies between the smooth and rough values.
  out.dragBucket = s.dragBucket;
  out.reverseLiftSlope = s.reverseLiftSlope * pg;
  out.reverseStall = s.reverseStall;
  out.cd90 = cd90;
  out.momentK1 = s.momentK1 ?? 0;
  out.momentK2 = s.momentK2 ?? 0;
  // The default's 0.3 is written out: 1 - 0.7 is not 0.3 in floating point.
  out.breakSeparation = s.breakSeparation ?? 0.7;
  out.breakDrop = s.breakSeparation === undefined ? 0.3 : 1 - s.breakSeparation;
  const collapse = s.collapseAfter !== undefined && s.collapseWidth !== undefined;
  out.collapseAt = collapse ? out.stallPos + s.collapseAfter! : Infinity;
  out.collapseWidth = collapse ? s.collapseWidth! : 1;
  return out;
}

/** Static trailing-edge separation point f(alpha) (1 attached, 0 fully separated). */
export function staticSeparation(c: SectionCondition, alpha: number): number {
  let x: number, hi: number, lo: number, collapse: number;
  if (Math.cos(alpha) >= 0) {
    x = wrapPi(alpha - c.alpha0);
    hi = c.stallPos;
    lo = c.stallNeg;
    collapse = c.collapseAt;
  } else {
    x = wrapPi(alpha - Math.PI);
    hi = c.reverseStall;
    lo = -c.reverseStall;
    collapse = Infinity;
  }
  const fb = c.breakSeparation;
  if (x > hi) {
    const f = fb * Math.exp((hi - x) / c.s2);
    return x > collapse ? f * Math.exp((collapse - x) / c.collapseWidth) : f;
  }
  if (x < lo) return fb * Math.exp((x - lo) / c.s2);
  return Math.max(1 - c.breakDrop * (Math.exp((x - hi) / c.s1) + Math.exp((lo - x) / c.s1)), fb);
}

export interface SectionCoefficients {
  cl: number;
  cd: number;
  cm: number;
  /** d(cl)/d(alpha) at frozen separation point, 1/rad. */
  dcl: number;
}

export function makeSectionCoefficients(): SectionCoefficients {
  return { cl: 0, cd: 0, cm: 0, dcl: 0 };
}

/** Section coefficients at angle of attack `alpha` (any value) with separation point `f`. */
export function evaluateSection(c: SectionCondition, alpha: number, f: number, out: SectionCoefficients): SectionCoefficients {
  const sa = Math.sin(alpha);
  const ca = Math.cos(alpha);
  let clPot: number, dPot: number, cdAtt: number, cmAtt: number;
  if (ca >= 0) {
    const x = alpha - c.alpha0;
    clPot = c.liftSlope * Math.sin(x);
    dPot = c.liftSlope * Math.cos(x);
    const e = clPot - c.clCdMin;
    cdAtt = c.cd0 + c.dragBucket * e * e;
    cmAtt = c.cm0 - c.acShift * clPot;
    if (c.momentK1 !== 0 || c.momentK2 !== 0) {
      const fc = Math.min(Math.max(f, 0), 1);
      cmAtt += clPot * (c.momentK2 * Math.sin(Math.PI * fc * fc) - c.momentK1 * (1 - fc));
    }
  } else {
    const x = wrapPi(alpha - Math.PI);
    clPot = c.reverseLiftSlope * Math.sin(x);
    dPot = c.reverseLiftSlope * Math.cos(x);
    cdAtt = 2 * c.cd0 + c.dragBucket * clPot * clPot;
    // In reverse flow the attached lift acts near the three-quarter chord.
    cmAtt = -0.5 * clPot;
  }
  const sf = Math.sqrt(Math.min(Math.max(f, 0), 1));
  const w = (((1 + sf) * (1 + sf)) / 4 - 0.25) / 0.75;
  // Flat plate: normal force cn90 sin(a) acting at a centre of pressure moving from ~0.35c through
  // mid-chord at 90 deg to 0.65c in reverse flow (Hoerner, Fluid-Dynamic Lift ch. 21).
  const relief = PLATE_CN90_2D - c.cd90;
  const cn90 = c.cd90 + relief * ca * ca;
  const cn = cn90 * sa;
  const xcp = 0.5 - 0.15 * ca;
  out.cl = w * clPot + (1 - w) * cn * ca;
  out.dcl = w * dPot + (1 - w) * (cn90 * (ca * ca - sa * sa) - 2 * relief * ca * ca * sa * sa);
  out.cd = w * cdAtt + (1 - w) * (c.cd0 + cn * sa);
  out.cm = w * cmAtt - (1 - w) * cn * (xcp - 0.25);
  return out;
}
