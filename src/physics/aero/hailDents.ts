// Hail dents on the leading edges (sim/weather/hailDamage.ts leadingEdge, 0..1) as a change of the section data and
// a drag increment of the nose. One level for the whole airframe: the wing, tailplane and fin leading edges and the
// cowl all face the relative wind, where the stones strike.
//
// At level L (0 none, 1 full) every lifting strip with a section of its own (not a carry-over or body section) gets
//   cd0       + DENT_CD0_FULL L                 (profile drag of the roughened nose)
//   stallPos  - DENT_STALL_SHIFT_FULL L, not below 2 s1 (prepareSection's floor); stallNeg toward zero by the same,
//             not above -2 s1; a soft stall's collapse angle moves with stallPos
// and the airframe gets a drag area DENT_BODY_CDA_FULL L along the relative wind at the nose (the dented cowl and
// its cooling inlets). The flight model sets the level with AeroModel.setLeadingEdgeDamage; at 0 nothing here runs.
//
// Unconfirmed: the three constants are chosen for this model. They are of the order of the change standard
// leading-edge roughness gives a 12 % section at R 6e6 in the NACA wing-section reports (a cd,min rise of a few
// thousandths and a c_l,max loss of a few tenths, Abbott & von Doenhoff 1959 appendix IV); those numbers were not
// re-read for this file (the reports could not be fetched), and no data for hail dents themselves were found.

import type { SectionCondition } from './airfoil';

/** Section profile-drag increment at full dent level. Unconfirmed. */
export const DENT_CD0_FULL = 0.003;
/** Reduction of the section break angles at full dent level, rad (3 deg). Unconfirmed. */
export const DENT_STALL_SHIFT_FULL = (3 * Math.PI) / 180;
/** Drag area added at the nose at full dent level, m^2. Unconfirmed. */
export const DENT_BODY_CDA_FULL = 0.02;

/** Apply dent level `level` (> 0) to section constants just prepared (prepareSection) for a section with width s1. */
export function applyLeadingEdgeDents(c: SectionCondition, s1: number, level: number): void {
  c.cd0 += DENT_CD0_FULL * level;
  const shift = DENT_STALL_SHIFT_FULL * level;
  const pos = Math.max(c.stallPos - shift, Math.min(c.stallPos, 2 * s1));
  if (Number.isFinite(c.collapseAt)) c.collapseAt += pos - c.stallPos;
  c.stallPos = pos;
  c.stallNeg = Math.min(c.stallNeg + shift, Math.max(c.stallNeg, -2 * s1));
}
