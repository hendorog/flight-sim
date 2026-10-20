// Hail dents on the leading edges (sim/weather/hailDamage.ts leadingEdge, 0..1) as a change of the section data and
// a drag increment of the nose. One level for the whole airframe: the wing, tailplane and fin leading edges and the
// cowl all face the relative wind, where the stones strike.
//
// At level L (0 none, 1 full) every lifting strip with a section of its own (not a carry-over or body section) gets,
// with k the section's dentFactor (AirfoilSection, default 1; DENT_LAMINAR_FACTOR on a laminar section)
//   cd0       + DENT_CD0_FULL k L                 (profile drag of the roughened nose)
//   stallPos  - DENT_STALL_SHIFT_FULL k L, not below 2 s1 (prepareSection's floor); stallNeg toward zero by the
//             same, not above -2 s1; a soft stall's collapse angle moves with stallPos
// and the airframe gets a drag area DENT_BODY_CDA_FULL L along the relative wind at the nose (the dented cowl and
// its cooling inlets). The strips are the wing's, the tailplane's and the fin's (AeroModel.strips), so the break
// angles of the tail surfaces move as the wing's do. The flight model sets the level with
// AeroModel.setLeadingEdgeDamage, which rounds it to DENT_LEVEL_STEP; at 0 nothing here runs.
//
// Unconfirmed: the four constants are values chosen for this model. The standard leading-edge roughness data of the
// NACA wing-section reports (Abbott & von Doenhoff 1959, appendix IV) could not be fetched to compare them with, and
// no data for hail dents were found. That a laminar section loses 1.5 times as much is also unconfirmed.

import type { SectionCondition } from './airfoil';

/** Section profile-drag increment at full dent level. Unconfirmed. */
export const DENT_CD0_FULL = 0.002;
/** Reduction of the section break angles at full dent level, rad (2 deg). Unconfirmed. */
export const DENT_STALL_SHIFT_FULL = (2 * Math.PI) / 180;
/** Drag area added at the nose at full dent level, m^2. Unconfirmed. */
export const DENT_BODY_CDA_FULL = 0.02;
/** Dent factor of a laminar section (AirfoilSection.dentFactor): Wortmann FX 63-137. Unconfirmed. */
export const DENT_LAMINAR_FACTOR = 1.5;
/** Step the dent level is rounded to, so a growing level prepares the sections again at most 128 times. */
export const DENT_LEVEL_STEP = 1 / 128;

/** A dent level 0..1 rounded to DENT_LEVEL_STEP (0 for anything not finite). */
export function quantiseDentLevel(level: number): number {
  const l = Number.isFinite(level) ? Math.min(Math.max(level, 0), 1) : 0;
  return Math.round(l / DENT_LEVEL_STEP) * DENT_LEVEL_STEP;
}

/**
 * Apply dent level `level` (> 0) to section constants that prepareSection has filled, for a section with width s1 and
 * dent factor `factor` (AirfoilSection.dentFactor).
 */
export function applyLeadingEdgeDents(c: SectionCondition, s1: number, level: number, factor = 1): void {
  const l = level * factor;
  c.cd0 += DENT_CD0_FULL * l;
  const shift = DENT_STALL_SHIFT_FULL * l;
  const pos = Math.max(c.stallPos - shift, Math.min(c.stallPos, 2 * s1));
  if (Number.isFinite(c.collapseAt)) c.collapseAt += pos - c.stallPos;
  c.stallPos = pos;
  c.stallNeg = Math.min(c.stallNeg + shift, Math.max(c.stallNeg, -2 * s1));
}
