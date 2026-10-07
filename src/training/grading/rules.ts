// The grade tables of section 3.4 and the builders of CriterionResult rows shared by the grader and the
// landing, stall and unusual-attitude graders. Kept apart from grade.ts so those graders can use the rules
// without an import cycle; grade.ts re-exports the public functions.

import type { CriterionResult, Grade, Pattern, SignalId, Standard, Tol } from '../types';
import type { HoldSummary } from './accumulators';
import { normalisedError } from './accumulators';
import { clock, devText, pct, tolText, unitOf, type UnitInfo } from './format';
import { samplePattern } from './patterns';

/** Below this much sampled time a hold criterion has no grade ("insufficient data"), s. */
export const MIN_SAMPLED_S = 5;

/**
 * (contract addition carried as an optional field; see the module report) A criterion that could not be
 * graded: a hold with < 5 s sampled, a peak never sampled, an event that never came. Its `grade` and
 * `testGrade` read 1 for type-compatibility but MUST NOT be shown as a grade: a required criterion in this
 * state makes the exercise ungraded (null) and the instructor repeats the task.
 */
export type GradedCriterion = CriterionResult & { insufficient?: boolean };

export function isInsufficient(c: CriterionResult): boolean {
  return (c as GradedCriterion).insufficient === true;
}

/** Hold grade table (4: within >= 0.98 and maxN <= 0.6; 3: maxN <= 1; 2: momentary rule; else 1); null < 5 s. */
export function gradeHold(s: HoldSummary, standard: Standard): Grade | null {
  if (s.sampledS < MIN_SAMPLED_S) return null;
  if (s.within >= 0.98 && s.maxN <= 0.6) return 4;
  if (s.maxN <= 1) return 3;
  // "Deviations recognised and promptly corrected": momentary excursions are tolerated at grade 2.
  const longest = standard === 'training' ? 10 : 5;
  if (s.maxN <= 1.5 && s.within >= 0.9 && s.longestOutS <= longest) return 2;
  return 1;
}

/** Peak, final and atEvent: n <= 0.6 -> 4; <= 1 -> 3; training only <= 1.25 -> 2; else 1 (a check ride has no "nearly"). */
export function gradeSample(n: number, standard: Standard): Grade {
  if (!Number.isFinite(n)) return 1;
  if (n <= 0.6) return 4;
  if (n <= 1) return 3;
  return standard === 'training' && n <= 1.25 ? 2 : 1;
}

/** Base fields of a row. */
interface Head { id: string; label: string; kind: CriterionResult['kind']; required: boolean; safety: boolean }

export function insufficientResult(h: Head, detail = 'Insufficient data'): GradedCriterion {
  return { ...h, grade: 1, testGrade: 1, within: 0, maxN: 0, excursions: 0, longestOutS: 0, pattern: 'ok', detail, insufficient: true };
}

/** A pass/fail row: check (3 if done, 1 if not) and binary (3 unless failIf held). */
export function passFailResult(h: Head, passed: boolean, detail: string, grade?: Grade): GradedCriterion {
  const g: Grade = grade ?? (passed ? 3 : 1);
  return { ...h, grade: g, testGrade: g, within: passed ? 1 : 0, maxN: passed ? 0 : 1, excursions: 0, longestOutS: 0, pattern: 'ok', detail };
}

/**
 * A one-sample row (peak, final, atEvent and the measured landing / stall items): value against target
 * with the lesson and the test tolerance. `peakOf` only shapes the pattern.
 */
export function sampleResult(
  h: Head, value: number, target: number, dev: number, tol: Tol, testTol: Tol, standard: Standard,
  o: { atS?: number; peakOf?: 'abs' | 'max' | 'min' | null; sig?: SignalId; unit?: UnitInfo; what?: string } = {},
): GradedCriterion {
  const n = normalisedError(dev, tol);
  const nTest = normalisedError(dev, testTol);
  const u = o.unit ?? unitOf(o.sig);
  const grade = gradeSample(n, standard);
  const at = o.atS !== undefined ? ` at ${clock(o.atS)}` : '';
  const detail = `${o.what ?? 'Measured'} ${devText(dev, u)}${at} (tolerance ${tolText(tol, u)})`;
  return {
    ...h, target, tol, testTol, grade, testGrade: gradeSample(nTest, 'test'),
    within: n <= 1 ? 1 : 0, maxN: n,
    worst: { value, dev, atS: o.atS ?? 0 },
    excursions: 0, longestOutS: 0, pattern: samplePattern(dev, n, o.peakOf ?? null), detail,
  };
}

/** A hold row from the two summaries (lesson and test tolerance). */
export function holdResult(
  h: Head, s: HoldSummary, ts: HoldSummary, target: number, tol: Tol, testTol: Tol, standard: Standard, pattern: Pattern, sig: SignalId,
): GradedCriterion {
  const grade = gradeHold(s, standard);
  const testGrade = gradeHold(ts, 'test');
  const u = unitOf(sig);
  if (grade === null || testGrade === null) {
    const row: GradedCriterion = { ...insufficientResult(h, `Insufficient data (${Math.round(s.sampledS)} s sampled)`), tol, testTol };
    if (Number.isFinite(target)) row.target = target;
    return row;
  }
  const worst = s.worst ? `; worst ${devText(s.worst.dev, u)} at ${clock(s.worst.atS)}` : '';
  return {
    ...h, target, tol, testTol, grade, testGrade,
    within: s.within, maxN: s.maxN,
    ...(s.worst ? { worst: s.worst } : {}),
    excursions: s.excursions.length, longestOutS: s.longestOutS, pattern,
    detail: `Within ${tolText(tol, u)} for ${pct(s.within)}${worst}`,
  };
}
