// Section data for the aerofoils of the aircraft types.
//
// The NACA four-digit sections (Cessna 172, and the tails of most types): attached-flow constants are from
// Abbott & von Doenhoff, "Theory of Wing Sections" (1959), appendix IV (NACA Report 824 data, smooth leading
// edge). The separation parameters (break angles, widths) are fitted so that the Kirchhoff model reproduces the
// published c_l,max and stall angle; the reverse-flow constants follow the sharp-trailing-edge data of Critzos,
// Heyson & Boswinkle (NACA TN 3361, 0012 at 0-180 deg), and are reused for every section (nothing else exists).
//
// The three sections after them (NASA LS(1)-0417, NACA 65(2)-415, Wortmann FX 63-137) are fitted from the tables
// collected for this purpose from the primary reports (their rows are named in each comment). These sections lose
// attached flow gradually from about 8 deg and reach their c_l,max with the separation point near mid-chord
// (f = 0.45-0.6), so the LS(1)-0417 and the 65(2)-415 set their break lower than the 0.7 of the NACA records
// (AirfoilSection.breakSeparation): with the break at 0.7 the lift peaked 2-4 deg early whatever the other numbers
// were. The FX 63-137's measured plateau ends with the data at 20 deg; its record collapses there
// (collapseAfter / collapseWidth). A type never edits this file: it calibrates a copy, `{ ...FX_63_137, stallPos:
// ... }`, in its own aero.ts.

import { DEG } from '../../core/math';
import type { AirfoilSection } from './airfoil';

/**
 * NACA 2412: wing. R = 5.7e6: a = 0.105/deg, alpha0 = -2.1 deg, cl,max = 1.67 at 16 deg, cd,min = 0.0060, cm = -0.047.
 * Smooth, the drag rises to ~0.0088 at cl 1.0 (a curvature of ~0.0045 per cl^2); with standard roughness it rises
 * from ~0.010 to ~0.0145 at cl 1.0, a curvature of ~0.007, which is used (see prepareSection).
 */
export const NACA_2412: AirfoilSection = {
  name: 'NACA 2412',
  liftSlope: 0.105 / DEG,
  alpha0: -2.1 * DEG,
  cm0: -0.047,
  cdMin: 0.006,
  clCdMin: 0.2,
  dragBucket: 0.007,
  reRef: 5.7e6,
  stallPos: 18.9 * DEG,
  stallNeg: -14.5 * DEG,
  stallReSlope: 2.0 * DEG,
  s1: 2.0 * DEG,
  s2: 3.0 * DEG,
  reverseLiftSlope: 0.06 / DEG,
  reverseStall: 7 * DEG,
  // Fitted to the section moment of Abbott & von Doenhoff's NACA 2412 data at R = 3.1 and 5.7e6 (fig. in appendix
  // IV): c_m,c/4 rises from -0.045 to about -0.03 at the lift peak (16 deg), then falls to -0.06 at 18 deg and
  // -0.10 at 20-21 deg as the separation spreads forward. With these the model gives -0.030 / -0.073 / -0.089 /
  // -0.092 at 16 / 18 / 20 / 21 deg (R 3.1e6, rms 0.006 over 10-21 deg) where it gave -0.049 / -0.054 / -0.062 /
  // -0.066 without them.
  momentK1: 0.05,
  momentK2: 0.025,
};

/** NACA 0012: fin. R = 6e6: a = 0.108/deg, cl,max = 1.58 at 16 deg, cd,min = 0.0058; rough-surface drag curvature ~0.004. */
export const NACA_0012: AirfoilSection = {
  name: 'NACA 0012',
  liftSlope: 0.108 / DEG,
  alpha0: 0,
  cm0: 0,
  cdMin: 0.0058,
  clCdMin: 0,
  dragBucket: 0.004,
  reRef: 6e6,
  stallPos: 16.6 * DEG,
  stallNeg: -16.6 * DEG,
  stallReSlope: 2.0 * DEG,
  s1: 1.8 * DEG,
  s2: 2.5 * DEG,
  reverseLiftSlope: 0.06 / DEG,
  reverseStall: 7 * DEG,
};

/** NACA 0009: horizontal stabiliser. R = 6e6: a = 0.109/deg, cl,max = 1.32 at 13.5 deg, cd,min = 0.0052; rough-surface drag curvature ~0.0045. */
export const NACA_0009: AirfoilSection = {
  name: 'NACA 0009',
  liftSlope: 0.109 / DEG,
  alpha0: 0,
  cm0: 0,
  cdMin: 0.0052,
  clCdMin: 0,
  dragBucket: 0.0045,
  reRef: 6e6,
  stallPos: 13.8 * DEG,
  stallNeg: -13.8 * DEG,
  stallReSlope: 1.5 * DEG,
  s1: 1.5 * DEG,
  s2: 2.0 * DEG,
  reverseLiftSlope: 0.06 / DEG,
  reverseStall: 7 * DEG,
};

/**
 * NASA LS(1)-0417 (GA(W)-1), 17 % thick: Piper PA-38 wing. McGhee & Beasley, NASA TN D-7428 (1973), the runs with
 * a narrow transition strip at 0.08c (fig. 12(b), the report's own recommendation for a wing in service), M 0.15;
 * coefficients reduced by the 2 % the report estimates for its uncorrected tunnel walls. Referred to R = 2.1e6,
 * the stall Reynolds number of a 1.2 m chord at 50 kt.
 *  - Lift: a = 0.118/deg (0.120 uncorrected), alpha0 = -3.7 deg (cl 0.43 at alpha 0).
 *  - Stall: breakSeparation 0.38 (sections.md 5.2: f 0.44 at the measured peak). cl,max 1.56 at 14.2 deg (measured
 *    1.58 x 0.98 = 1.55 at 16 deg; Wichita, corrected, 1.53-1.58 at 15-16 deg: NASA CR-2443, CR-2833), 1.51 at 16;
 *    then 1.27 / 1.11 at 18 / 20 deg (measured 1.34 / 1.18 less 2 %). The measured curve is within 0.03 of its peak
 *    from 14 to 16 deg; the record peaks at the start of that range. GIVEN UP: the level after the stall falls on
 *    to 1.01 / 0.96 at 22 / 24 deg (the smooth run holds a plateau of 1.18-1.22 there; the rough one stops at 20):
 *    one exponential out of the break cannot drop 0.3 in 2 deg and then hold.
 *  - Reynolds number: cl,max 1.76 at 16.1 deg (4.3e6) and 1.87 at 17.1 deg (6.3e6) (measured 1.745 flat from 16 to
 *    18.5 and 1.92 at 19: the rise is steeper than the 2412's and not log-linear, it saturates above 9e6).
 *  - Negative stall: NOT MEASURED (the tests stop at -10 deg, still linear). cl,min -1.10 at -17 deg, against -1.0
 *    to -1.1 at -15.5 to -17 deg computed (XFOIL, R 1e6).
 *  - Drag: cdMin is the FULLY TURBULENT smooth value (0.0080 measured at R 5.7e6, flat from cl 0 to 0.75, scaled
 *    by Re^-0.2 to 2.1e6); the laminar bucket of the smooth model at R 1.9e6 (0.0062) "should not be expected" in
 *    service (the report) and is not represented. With skinFactor 1.28 the record is the strip-roughness polar:
 *    0.0126 at R 2.1e6 and 0.0101 at 6.3e6 at cl 0.4 (measured 0.0126, 0.0102), within 0.001 from cl 0 to 1.24.
 *  - Moment: -0.105 at zero lift, -0.11 at 0-4 deg; the measured rise to -0.07 at the peak is not followed (the
 *    model stays near -0.10 to -0.12), the fall to -0.15 after it only in part (rms 0.02).
 * A stall strip (Planform.sectionBands) is a copy with stallPos reduced: no lower than 2 s1 = 13.4 deg, where
 * prepareSection holds it.
 */
export const NASA_LS1_0417: AirfoilSection = {
  name: 'NASA LS(1)-0417',
  liftSlope: 0.118 / DEG,
  alpha0: -3.7 * DEG,
  cm0: -0.12,
  cdMin: 0.0098,
  clCdMin: 0.4,
  dragBucket: 0.005,
  reRef: 2.1e6,
  stallPos: 20.0 * DEG,
  stallNeg: -13.4 * DEG,
  stallReSlope: 7.6 * DEG,
  s1: 6.7 * DEG,
  s2: 2.5 * DEG,
  reverseLiftSlope: 0.06 / DEG,
  reverseStall: 7 * DEG,
  momentK1: 0.045,
  momentK2: 0.02,
  breakSeparation: 0.38,
};

/**
 * NACA 65(2)-415, a = 1.0 mean line: Piper PA-34 wing. NACA Report 824 (Abbott, von Doenhoff & Stivers 1945),
 * the page of this section, R = 3.0, 6.0 and 8.9e6; referred to 6.0e6.
 *  - Lift: a = 0.107/deg, alpha0 = -2.8 deg measured (cl 0.31 at alpha 0; the book's table has -2.6). The record's
 *    0.109 and -2.95 are the attached-flow (potential) values: the gradual separation below the break (s1 6 deg)
 *    already takes 2-3 % off the lift at small angles, and with them the record has cl 0.31 at 0 and 0.107/deg.
 *  - Stall from the SMOOTH lift curves (standard roughness costs this section 0.33 in cl,max, which no wing in
 *    service shows), breakSeparation 0.35 (sections.md 5.2: f 0.48-0.60 at the peaks): cl,max 1.43 at 14.5 deg /
 *    1.57 at 15.9 / 1.65 at 16.6 at R 3.0 / 6.0 / 8.9e6 (measured 1.43 at 16 / 1.58 at 18 / 1.61 at 16, all within
 *    0.03 of the peak over 2-3 deg). GIVEN UP: at 6e6 the record falls 2 deg early (1.37 at 19 deg against 1.545),
 *    the price of following the 3e6 column, which is the PA-34's stall Reynolds number; after the stall 1.03 /
 *    0.95 / 0.91 at 20 / 22 / 24 deg at R 3e6 (measured 1.12 / 1.06 / 1.01).
 *  - Negative stall: cl,min -1.05 at -16 deg (measured -1.04 at -13 deg, then an abrupt loss the record rounds).
 *  - Drag: the smooth polar is a laminar bucket (0.0042 from cl 0.07 to 0.7, 0.0061 just below it and 0.0086 above),
 *    which the record cannot represent and a riveted wing behind a propeller does not have. cdMin is the smooth
 *    value at the bucket's edge; the curvature is the standard-roughness polar's (cdMin 0.0101 there: with
 *    skinFactor 1.66 the record follows it within 0.0007 from cl 0 to 1.06; the curvature is lower than the polar's
 *    0.013-0.016 because the separation below the break adds its own drag). With the 1.35 of riveted aluminium:
 *    0.0082, between the two as for the 2412.
 *  - Moment: -0.071 at zero lift and 2 deg (measured -0.065 / -0.073), then the model's own break (rms 0.016).
 */
export const NACA_65_2_415: AirfoilSection = {
  name: 'NACA 65(2)-415',
  liftSlope: 0.109 / DEG,
  alpha0: -2.95 * DEG,
  cm0: -0.077,
  cdMin: 0.0061,
  clCdMin: 0.25,
  dragBucket: 0.0115,
  reRef: 6.0e6,
  stallPos: 21.4 * DEG,
  stallNeg: -14.0 * DEG,
  stallReSlope: 5.5 * DEG,
  s1: 6.0 * DEG,
  s2: 2.2 * DEG,
  reverseLiftSlope: 0.06 / DEG,
  reverseStall: 7 * DEG,
  momentK1: 0.045,
  momentK2: 0.02,
  breakSeparation: 0.35,
};

/**
 * Wortmann FX 63-137, 13.7 % thick, strongly aft-cambered: Diamond DA20 and DA42 wings.
 *
 * PROVISIONAL (provisional: true). The only measured polars are at Re 0.35e6 and 0.5e6 (Selig & McGranahan,
 * NREL/SR-500-34515, UIUC low-speed tunnel, clean model, tabulated); the aircraft fly at 1.5-6e6, where nothing
 * measured could be found. The record is the fit to the Re 0.5e6 run and reaches flight Reynolds number by its
 * own laws alone: drag as Re^-0.2 (0.0066 at 2e6, 0.0057 at 4e6; XFOIL has 0.0073 at 1e6) and NO change of the
 * stall (measured cl,max 1.76 at both Reynolds numbers; with early transition 1.53). The first type to use it
 * owns the refit in its copy: expect stallPos to move within cl,max 1.5-1.8 and cdMin within 0.0055-0.011.
 *  - Lift: a = 0.112/deg, alpha0 = -7.3 deg; cl 0.80 at alpha 0 (measured 0.82), rms 0.013 from -5 to 20 deg.
 *  - Stall: very soft, cl within 0.04 of 1.75 from 11 deg to the last measured point at 20.3 deg, which the
 *    record follows. BEYOND THE DATA the record collapses (collapseAfter 8.7 deg past the break, i.e. from 20.3 deg,
 *    width 3 deg): cl 1.44 / 1.16 / 1.00 at 22 / 25 / 30 deg, about the level of thick cambered sections after
 *    their stall (LS(1)-0417 1.20-1.25 at 22-24 deg, sections.md 1.2). Without it the slow separation held 1.72 /
 *    1.68 at 25 / 30 deg: no lift break at all. Where the collapse starts and how fast is NOT measured: the type's
 *    copy moves it with the handbook's stall behaviour (collapseAfter, collapseWidth).
 *  - Negative side: the measured lower-surface stall lies 0.6 deg below zero lift at Re 0.5e6 (cl -0.09 at -7.6,
 *    -0.24 at -10 deg) and moves to more negative angles with Reynolds number (XFOIL at 1e6: -0.26 at -10,
 *    -0.59 at -12 deg). The record has -0.30 at -10 and -0.51 at -12 deg and then NO cl,min (-0.74 at -14.5,
 *    -1.0 at -20 deg): its one s2 serves both sides. Pushovers and inverted flight are low-fidelity.
 *  - Drag: cd,min 0.0087 at cl 0.63, within 0.0008 from cl 0.5 to 1.67; 0.002-0.005 low below cl 0.4, where the
 *    lower surface is about to separate.
 *  - Moment: -0.20 at low angles, -0.147 at 10 deg, -0.125 at 14-16 deg (rms 0.004).
 */
export const FX_63_137: AirfoilSection = {
  name: 'Wortmann FX 63-137',
  liftSlope: 0.112 / DEG,
  alpha0: -7.3 * DEG,
  cm0: -0.2,
  cdMin: 0.0087,
  clCdMin: 0.63,
  dragBucket: 0.0045,
  reRef: 0.5e6,
  stallPos: 18.9 * DEG,
  stallNeg: -7.2 * DEG,
  stallReSlope: 0,
  s1: 3.6 * DEG,
  s2: 10.5 * DEG,
  reverseLiftSlope: 0.06 / DEG,
  reverseStall: 7 * DEG,
  momentK1: 0.01,
  momentK2: 0.025,
  collapseAfter: 8.7 * DEG,
  collapseWidth: 3 * DEG,
};
