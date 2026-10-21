// Lockheed AH-56A Cheyenne: high-advance-ratio rotor aerodynamics (the blade section model, finer grids, periodic flap damping)
// and the scripted half-P hop. Owner: AH (stage 5). Plan revision 2, section 7.4; docs/ah56-high-speed.md has the sources,
// the derivations and every measured row.
//
// Tags: P primary (NACA reports and the Army test reports, pages in docs/ah56-high-speed.md), D derived (arithmetic shown),
// ESTIMATE judged, FITTED (an ESTIMATE set to a named acceptance row). AGENT choices are marked; none is an owner decision.
import { DEG } from '../../core/math';
import type { RotorDefinition } from '../../physics/rotorcraft/definition';
import type { HalfPHopDef } from '../../physics/rotorcraft/halfPHop';
import type { RotorSectionDef } from '../../physics/rotorcraft/section';
import { AH56_BASE } from './base';
import { AH56_INERTIA, AH56_MASS_LB, AH56_NR_100 } from './facts';

const IN = 0.0254;
const LB = 0.45359237;

/**
 * The blade section (P ASTA-72 p 48: a droop-nose NACA (4.6)3012 mod at the root, a NACA (0.6)3006 mod at the tip, constant
 * chord, "varying thickness and section"). One section serves the whole span (the section contract has no radius): its
 * attached polar is the base's (lift slope 5.73, Cd 0.0085 + 0.01 Cl^2: AG's ESTIMATES that give the P Lock number 6.4), and its
 * Mach terms are the TIP's, where the Mach numbers are (the advancing tip reaches M 0.84-0.92 at 154-194 KTAS):
 * - Cm0 -0.012: P NACA Report 530 Table IV (the 23012 in the full-scale tunnel: -0.011 to -0.014 from zero lift to Cl max),
 *   unchanged at subcritical Mach (P NACA WR L-357, Becker 1941: "negligibly small" variation for these low-moment airfoils).
 * - Maximum lift 1.3 at low Mach (base.ts, ESTIMATE; P Report 530 Table IV: 1.26 at Re 1.7 million), 1.26 / 1.14 / 0.95 / 0.88 /
 *   0.80 at M 0.3 / 0.4 / 0.5 / 0.6 / 0.7 (ESTIMATE: no 23012 or 23006 data through the stall above M 0.3 were found). The low-speed
 *   value held to M 0.3 (-3 %), the fall concentrated between M 0.4 and 0.5 (where the leading-edge suction peak of a 12 % section
 *   goes supersonic at the stall); not fitted to H4 (the moment break carries that fit). M 0.5-0.7 set so the hover tip (M 0.56)
 *   keeps 2 deg of stall margin at 18,300 lb SL and the C2 / C3 ceilings stay unstalled. Negative stall at 0.8 of it (ESTIMATE).
 * - Past the stall, lift fades to the flat plate over 15 deg and drag rises to it over 3 deg: FITTED to P Report 530 Table IV
 *   (Cl 1.26 -> 1.1 / 1.0 / 0.9 at +3.2 / +6.5 / +10 deg past Cl max; section drag 0.127 / 0.195 / 0.275 there).
 * - MOMENT STALL. Flown: past the stall the centre of pressure moves 0.4 c aft of the quarter chord within 1.5 deg (ESTIMATE,
 *   FITTED to H4: the retreating blade's dynamic moment stall at reduced frequency about 0.1, a sudden break of about -0.45 in cm at
 *   cn 1.1; no primary dynamic-stall data for this section were downloaded), faded out between M 0.45 and 0.6 (the
 *   advancing side's separation is shock-induced; the drag rise and the tuck carry it). The static P shape, 0.14 c over 12 deg (D
 *   from P Report 530 Table IV, cm_c/4 -0.012 at Cl max, -0.056 / -0.086 / -0.107 / -0.118 at +3.2 / +6.5 / +10 / +11.6 deg),
 *   gives under 1 deg of uncommanded roll at 1.7 g (docs section 2): too small for HQRS 10.
 * - The separated flat plate: normal force 2.0 sin(alpha) (P NACA TN 3361, the 0012 through 180 deg: 2.08 at 90 deg, Re 1.8e6),
 *   centre of pressure 0.5 c at 90 deg (P TN 3361 Fig 1: cm about -0.5).
 * - Reversed flow: lift slope 5.73 /rad about 180 deg up to Cl 0.77 (P TN 3361 Fig 4(a): 0.10 per deg from 174 to 186 deg, peak
 *   +/-0.77 at 8 deg past 180), drag twice the forward minimum (P TN 3361: "about twice"), lift at the reversed quarter chord
 *   (0.75 c).
 * - Drag divergence of the TIP: M_dd 0.83 at zero lift, falling 0.1 per unit Cl (D: the Korn form; P Becker: lower critical
 *   speeds at higher lift), between the 6 % sections of P NACA ACR L5E21 (Ferri 1945) Fig 75(a): the cambered 2306 diverges near
 *   0.82 and the 0006-34 near 0.85; the (0.6)3006 has a fifth of the 2306's camber. The rise 20 (M - M_crit)^4 with
 *   M_crit = M_dd - 0.1 (Lock's fourth-power law) FITTED to both P curves: Becker Fig 3(a) (23012 at 0 deg: +0.001 at M 0.69,
 *   +0.004 at 0.71, +0.0105 at 0.745 above the 0.0085 minimum; the law gives 0.0020 / 0.0041 / 0.0115 with M_dd 0.69) and
 *   Ferri Fig 75(a) (6 %: +0.004-0.006 at M 0.86, +0.010-0.016 at 0.90; the law with 0.83 gives 0.0057 / 0.0167). The root's
 *   12 % section (M_dd 0.69, P Becker) is never above M 0.6 at the speeds flown.
 * - Prandtl-Glauert lift slope capped at its value at M_dd 0.83, 1.79 (D).
 * - Supercritical Mach tuck: cm falls 0.1 per unit Mach past M_crit, at most 0.03 (ESTIMATE: P Becker Fig 5(a) gives the 23012
 *   about -0.15 to -0.2 per unit Mach past its critical speed; the tip has a fifth of its camber and half its thickness).
 */
export const AH56_SECTION: RotorSectionDef = {
  liftSlope: AH56_BASE.main.liftSlope, maxCl: AH56_BASE.main.maxCl,
  cd0: AH56_BASE.main.profileCd, cd2: AH56_BASE.main.inducedDrag, cm0: -0.012,
  polar: {
    machCap: 1 / Math.sqrt(1 - 0.83 * 0.83),
    clMax: { mach: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7], value: [AH56_BASE.main.maxCl, 1.26, 1.14, 0.95, 0.88, 0.8], negativeFraction: 0.8 },
    liftFade: 15 * DEG, dragFade: 3 * DEG,
    cn90: 2.0,
    momentStall: { shift: 0.4, over: 1.5 * DEG, machFade: [0.45, 0.6] },
    dragDivergence: { mach0: 0.83, perCl: 0.1, offset: 0.1, rise: 20 },
    machTuck: { slope: 0.1, max: 0.03 },
    reverse: { liftSlope: AH56_BASE.main.liftSlope, clMax: 0.77, dragFactor: 2 },
  },
};

/**
 * The main rotor at high advance ratio: the section above in the BEM and the hinge forcing; 12 radial x 18 azimuth stations
 * (AGENT deviation from plan 7.4's >= 16 x 36, docs section 3 H10: the fine grid costs 3.7-4.0 x the MD 500E per step against
 * the 2 x budget, and moved the 190 KCAS trim < 0.01 in, H3's torque < 0.1 % and H4's onsets not at all);
 * periodic flap damping on (RC's option, plan 4 item 4: the mu^2 sin^2 psi part of the flap damping; H9).
 */
export const AH56_ROTOR_HIGH_SPEED: Partial<RotorDefinition> = {
  section: AH56_SECTION, radialStations: 12, azimuthStations: 18, periodicFlapDamping: true,
};

/** Rotor speed at 100 % (ICS), rad/s, and the hop's forcing frequency, rad/s: 0.5 P (P And-74: the plunge mode falls to
 *  0.5-0.6 P at high speed), 2.05 Hz (D). */
const OMEGA_ICS = AH56_NR_100 * Math.PI / 30;
const HOP = 0.5 * OMEGA_ICS;

/**
 * The scripted half-P hop (ICS only; owner note O1: scripted, not emergent). Trigger (plan section 0 item 10, AGENT): a stir of
 * >= 3 cycles above 0.5 Hz at >= 0.75 in radius, or >= 4 cycles of single-axis reversals beyond +/-0.5 in (the flight-test
 * excitation was lateral doublets near 1.5 Hz, research-ah56 sect. 5), at >= 150 KCAS with the collective at or below 7.5 deg at
 * 0.75 R (the ICS cruise schedule is 5-7 deg, P SoF). Amplitudes ESTIMATE:
 * - onset (amplitude 1): +/-3 deg of roll at 2.05 Hz on Ixx 10,850 kg m^2 needs Ixx w^2 x 3 deg = 94 kN m (D; about the
 *   rotor's whole hub-moment capacity, K_hub x 0.1 rad = 110 kN m: acceptable for a scripted strike event, plan 7.4) and
 *   +/-0.15 g of plunge on the 18,300 lb test weight, 12.2 kN (D). The roll moment FITTED x 1.06 to the measured cue at
 *   160 KCAS (ah56HalfP.test.ts: the D value gives +/-2.83 deg; the rotor damps the roll), so 100 kN m. The measured vertical
 *   cue is +/-0.18-0.20 g with the plunge anywhere from 0.6 to 1.0 of the D value (the rotor's thrust follows the roll), so the
 *   plunge stays at D;
 * - strike at amplitude 10/3 (+/-10 deg, +/-0.5 g);
 * - the cue holds for 3 s before growth can begin; growth 1.216 per cycle reaches the strike in 6.2 more cycles (3.0 s) of
 *   stirring, about 6 s after onset (plan H7: 4-10 s);
 * - decay 0.82 per cycle with the stick held still halves the amplitude in 3.5 cycles (1.7 s; plan H7: <= 3 s from the hands
 *   coming off, which adds the stick-speed filter's 0.3 s);
 * - the stick counts as held still below 0.5 in/s.
 */
export const AH56_HALF_P: HalfPHopDef | undefined = {
  configs: ['ics'], perRev: 0.5,
  trigger: { stirHz: 0.5, stirRadius: 0.75 * IN, minKcas: 150, maxCollective: 7.5 * DEG, cycles: 3, doubletCycles: 4,
    doubletRadius: 0.5 * IN },
  cueSeconds: 3,
  growthPerCycle: 1.216, decayPerCycle: 0.82, strikeAmplitude: 10 / 3, endAmplitude: 0.05,
  stillRate: 0.5 * IN,
  rollMomentPerUnit: 1.06 * AH56_INERTIA.Ixx * HOP * HOP * 3 * DEG,
  plungeForcePerUnit: 0.15 * 9.80665 * AH56_MASS_LB.test * LB,
};
