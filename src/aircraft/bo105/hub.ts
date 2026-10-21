// MBB Bo 105 CB-4: the hingeless main-rotor hub and blade set the flight model flies. Owner: BO. Plain data (plan
// revision 2, sections 4 and 6.2). The rotor core is RC's (src/physics/rotorcraft/{articulated,hingeless,swashplate,
// inflowHarmonic}.ts, docs/rotor-hingeless-model.md); this file records the Bo 105's numbers for it, each with its tag:
// P primary (pages in docs/bo105-sources.md), F family, S secondary, D derived (arithmetic shown), ESTIMATE judged.
// The calibration of every ESTIMATE and AGENT choice, with before/after numbers: docs/bo105-flight-model.md.
//
// The hingeless blade is flown as a rigid blade on an EQUIVALENT FLAP HINGE with a spring (Ward, NASA; research
// report). Two numbers fix it: the equivalent offset e and the rotating first flap frequency nu at 100 % NR; the spring
// is DERIVED (hingelessSpring(def)), never typed in. The UNVERIFIED Padfield K_beta 113,000 N m/rad is not an input
// (plan section 0 item 3).
import { DEG } from '../../core/math';
import type { HingelessHub, RotorDefinition } from '../../physics/rotorcraft/definition';
import * as D from './dimensions';

/**
 * Main-rotor blade set (four Type 1 blades, NACA 23012, uniform 0.27 m chord; P TCDS p8, MM ch 14 p3, AR-280 p145).
 * The collective's travel, the profile drag and the polar inertia are this package's calibrations (sole knobs, plan
 * 6.2): docs/bo105-flight-model.md "Calibrations".
 */
export const BO105_MAIN_ROTOR: RotorDefinition = {
  radius: D.MAIN_ROTOR_RADIUS, chord: D.MAIN_ROTOR_CHORD, blades: D.MAIN_ROTOR_BLADES,
  /** Aerodynamic root at 1.10 m (F/S METU Table 9 citing Theodore: root cut-out 3.61 ft = 1.10 m). */
  rootCutout: D.MAIN_ROTOR_ROOT_CUTOUT,
  /** Equivalent-linear twist -6.2 deg (P AR-280; AGENT choice over the -8 deg hardware value, plan section 0 item 3). */
  twist: D.MAIN_ROTOR_TWIST_DEG * DEG,
  /** Blade pitch at 0.75 R with the collective fully down: the sole knob of the autorotation NR law (plan 6.2: 104-110 %
   *  at 2200 kg / 75 KIAS, 83-88 % at 1400 kg, 111-117 % at 2500 kg, and NR >= 85 % with the collective down at 1400 kg /
   *  60 KIAS), engines off, SL ISA: 1.35 deg gives 107.4 / 85.4 / 114.6 % and 85.4 % (1.0 deg: 110.9 % at 2200 kg; 1.4 deg:
   *  84.97 % at 1400 kg / 60 KIAS). ESTIMATE. */
  minPitch: 1.35 * DEG,
  /** ... and fully up: the collective range 19.23 deg, the sole knob of Z_col (AR-280 DLR -0.349 m/s^2 per % of travel,
   *  at 80 KCAS, 3000 ft, 2200 kg). ESTIMATE (the rigging was not found). */
  maxPitch: (1.35 + 19.23) * DEG,
  /** Lift slope of the NACA 23012 at the blade Mach numbers (0.3-0.65), 1/rad: 6.0 (2 pi x 0.95; F Padfield a0 6.113,
   *  UNVERIFIED recollection). The value RC's validation flew (fixed once, not a knob). ESTIMATE. */
  liftSlope: 6.0,
  /** NACA 23012 maximum lift coefficient at the retreating-blade Mach number. ESTIMATE (2-D data about 1.5 at M 0.3,
   *  1.2-1.3 above M 0.5: the analytic polar's single value). */
  maxCl: 1.3,
  /** Profile drag (cd0) and the cl^2 term of the analytic polar: the hover-torque knob with inducedFactor (plan 6.2).
   *  ESTIMATE, calibrated to the ceiling-derived torque rows. */
  profileCd: 0.0095, inducedDrag: 0.01,
  /** Non-uniform-wake induced-power factor: the hover-torque knob (plan 6.2), calibrated to the ceiling-derived torque
   *  rows (2500 kg OGE 79-83 %, IGE 72-78 %; 2200 kg OGE 67-74 %, IGE 61-69 %, per engine, SL ISA): 1.11 (1.15 gave
   *  85.1 % at 2500 kg OGE). ESTIMATE. */
  inducedFactor: 1.11,
  /** Polar inertia of the rotor, kg m^2: 850, inside the fitting rule's 850-950 band (Lock number about the shaft 5.47 at
   *  SL with a = 6.0: D rho a c R^4 / (I / B) = 1.225 x 6.0 x 0.27 x 4.92^4 / 212.5). The fitting rule's knob with
   *  controlPhase (plan 4): with this airframe 850 is the one inertia in the band that keeps Lp and the roll mode inside
   *  their AR-280 bands at nu 1.11 (900: Lp -11.59, roll mode 11.67 1/s against the 11.04 edge); the (nu, inertia) grid
   *  is in docs/bo105-flight-model.md. ESTIMATE (no blade or hub mass data). */
  inertia: 850,
  hub: D.MAIN_HUB,
};

/**
 * The hub parameters (the hub set RC recorded in docs/rotor-hingeless-model.md section 8, adopted here):
 * - equivalent hinge offset 0.12 R = 0.590 m (P BK117-ERF7: "an effective flap hinge offset of 12 percent (zero
 *   spring), and a corresponding flap frequency ratio of 1.10");
 * - rotating first flap frequency 1.11/rev, AGENT choice inside the plan's 1.10-1.12 (P NASA TM-85990 Table 1: 1.10
 *   calculated at 425 rpm; P NASA TM-103867: 1.12); with e = 0.12 R the spring makes up the rest (K_beta about 13 % of
 *   (nu^2 - 1) I_beta Omega^2, hingelessSpring);
 * - precone 2.5 deg (P NASA TM-85990; METU);
 * - control phase 28 deg (calibrated: the sole knob of the off-axis control ratios, plan 6.2): the settled off-axis
 *   moment ratios of +/-0.02 cyclic steps at 80 KCAS / 3000 ft / 2200 kg fitted by least squares on a 1 deg grid to the
 *   means of the DLR and AFDD control derivatives (AR-280 Table 6.2.11: lateral-step M/L -0.084, longitudinal-step L/M
 *   +0.145), RC's method on this airframe (RC's fixture fitted 30 deg; tests/rotorcraft/bo105Derivatives.test.ts). D
 *   check: Ward's "control phasing retarded to about 60 deg" is a 30 deg lead on the articulated 90 deg;
 * - delta-3 0 (no droop or sweep outboard of the feathering bearing);
 * - the 3-state Pitt-Peters inflow, the radial-flow terms and the hub-aware blade elements ON (plan 6.2, the fitting
 *   rule: R18-R20 are met with them on).
 * The mast-moment marks are set from the slope-landing rows (plan 6.2; AGENT/ESTIMATE): see BO105_MAST_MOMENT.
 */
export const BO105_HUB_SET = {
  equivalentHingeOffset: 0.12 * D.MAIN_ROTOR_RADIUS,
  flapFrequency: 1.11,
  precone: D.MAIN_ROTOR_PRECONE_DEG * DEG,
  controlPhase: 28 * DEG,
  delta3: 0,
  harmonicInflow: true,
  radialFlow: true,
  bemFromFlap: true,
} as const satisfies Omit<HingelessHub, 'kind' | 'coning' | 'mastMomentLimit' | 'mastMomentYellow'>;

/**
 * Mast-moment indicator (P5 FM 2-16, 7-18..7-20: four strain gauges in the mast; colour bands and a LIMIT light, no
 * number published). AGENT/ESTIMATE, set from the plan's rows (6.2) as measured on this definition (tests/rotorcraft/
 * bo105Handling.test.ts, standard-technique landings at 2200 kg mid-CG, the lateral cyclic keeping the disc level):
 *  - LIMIT 15.5 kN m: the 15 deg left-down and 8 deg right-down landings peak at 14.4 and 14.2 kN m (LIMIT off), the
 *    20 deg left-down at 16.8 kN m (LIMIT on). The slope peaks are set by the lateral cyclic stop (about 4.1 deg each way,
 *    fitted to AR-280): the plan's "LIMIT at about 16-17 deg of TPP-to-shaft tilt" (about 40 kN m) assumed a disc held
 *    level on a 15 deg slope, which the fitted travel cannot do;
 *  - yellow from 0.17 of it (2.6 kN m): a smooth 2.5 g pull at 100 KIAS peaks at 3.1 kN m (yellow), a steady 60 deg turn at
 *    100 KIAS (2.2 g) at 2.0 kN m (green), a full lateral stick reversal at 80 KIAS at 13.3 kN m (yellow, not LIMIT); the
 *    slope landings then sit in the top third of yellow (above 11.2 kN m). Level flight reads 1.6 kN m at 100 KIAS
 *    and 4.8 kN m (yellow) at 145 KIAS, 2200 kg mid-CG.
 * docs/bo105-flight-model.md "Mast moment".
 */
export const BO105_MAST_MOMENT = { limit: 15_500, yellow: 0.17 } as const;
