// Lesson-level results (section 3.4): outcome (with exercise sign-offs carried over from earlier runs of the
// same lesson version), stars, and the overall-impression line.

import type { AuthorityId, ExerciseResult, Grade, Lesson, LessonProgress, LessonResult } from '../types';

export interface OutcomeInput {
  lesson: Lesson;
  exercises: readonly ExerciseResult[];
  /** Progress before this run (exercise sign-offs carry over for dual and solo kinds). */
  previous: LessonProgress | null;
  /** Interventions during assessed exercises in this run. */
  assessedInterventions: number;
  ended: 'completed' | 'abandoned' | 'crashed' | 'timeUp';
  /** Skill test: failed section numbers (derived from the exercises when absent) and whether a critical fault occurred. */
  failedSections?: number[]; criticalFault?: boolean;
  /** Skill test: EASA allows one failed section (partial pass); FAA fails on any. Default 'easa'. */
  authority?: AuthorityId;
}

export const GRADE_WORDS: Record<Grade, string> = { 1: 'Not yet', 2: 'Satisfactory', 3: 'Good', 4: 'Excellent' };

/**
 * Skill-test sections failed in this run: a section fails when one of its items (exercises with a
 * testSection) graded below 2, was ungraded, or was never flown.
 */
export function failedTestSections(lesson: Lesson, exercises: readonly ExerciseResult[]): number[] {
  const byId = new Map(exercises.map((e) => [e.exerciseId, e]));
  const failed = new Set<number>();
  for (const def of lesson.exercises) {
    if (def.testSection === undefined || def.mode === 'demo') continue;
    if (!def.required) continue;
    const g = byId.get(def.id)?.grade ?? null;
    if (g === null || g < 2) failed.add(def.testSection);
  }
  return [...failed].sort((a, b) => a - b);
}

/** The grade an exercise counts with for competency: this run, or a signed-off grade of the same version. */
function effectiveGrade(i: OutcomeInput, id: string, carryOver: boolean): Grade | null {
  const now = i.exercises.find((e) => e.exerciseId === id)?.grade ?? null;
  const prev = carryOver && i.previous && i.previous.lessonVersion === i.lesson.version ? i.previous.exercises[id]?.best ?? null : null;
  if (now === null) return prev;
  if (prev === null) return now;
  return (Math.max(now, prev) as Grade);
}

export function lessonOutcome(i: OutcomeInput): LessonResult['outcome'] {
  const kind = i.lesson.kind;
  if (i.ended === 'abandoned') return 'abandoned';
  if (i.ended === 'crashed') return kind === 'test' ? 'testFail' : 'crashed';
  if (i.ended === 'timeUp') return kind === 'test' ? 'testFail' : 'incomplete';
  if (kind === 'test') {
    if (i.criticalFault) return 'testFail';
    const failed = i.failedSections ?? failedTestSections(i.lesson, i.exercises);
    if (failed.length === 0) return 'testPass';
    return (i.authority ?? 'easa') === 'easa' && failed.length === 1 ? 'testPartial' : 'testFail';
  }
  // Check lessons need everything in one run; dual and solo lessons carry sign-offs over.
  const carryOver = kind !== 'check';
  const required = i.lesson.exercises.filter((e) => e.required && e.mode !== 'demo');
  const allSigned = required.every((e) => (effectiveGrade(i, e.id, carryOver) ?? 0) >= 2);
  return allSigned && i.assessedInterventions === 0 ? 'competent' : 'notYet';
}

export function lessonStars(i: OutcomeInput & { outcome: LessonResult['outcome']; phaseRetries: number; calmAir: boolean; assessedRemarks: number; interventions: number }): LessonResult['stars'] {
  if (i.outcome !== 'competent' && i.outcome !== 'testPass') return 0;
  const carryOver = i.lesson.kind === 'dual' || i.lesson.kind === 'solo';
  const grades = i.lesson.exercises
    .filter((e) => e.required && e.mode !== 'demo')
    .map((e) => effectiveGrade(i, e.id, carryOver) ?? 2);
  let stars: 1 | 2 | 3 = 1;
  if (grades.every((g) => g >= 3)) stars = 2;
  if (grades.every((g) => g === 4) && i.assessedRemarks === 0 && i.phaseRetries === 0 && i.interventions === 0) stars = 3;
  // Calm air and retries cap at 2 (anti-frustration rule 3: still Competent, but not a perfect lesson).
  if ((i.calmAir || i.phaseRetries > 0) && stars > 2) stars = 2;
  return stars;
}

/** Weighted mean of graded exercises (null when nothing was graded). */
export function weightedMean(lesson: Lesson, exercises: readonly ExerciseResult[]): number | null {
  const weight = new Map(lesson.exercises.map((e) => [e.id, e.weight]));
  let sw = 0, sg = 0;
  for (const e of exercises) {
    const w = weight.get(e.exerciseId) ?? 0;
    if (e.grade === null || !(w > 0)) continue;
    sw += w;
    sg += w * e.grade;
  }
  return sw > 0 ? sg / sw : null;
}

/** Weighted mean of exercise grades, as one labelled line ("Overall impression: Good (68/100)"). */
export function overallImpression(lesson: Lesson, exercises: readonly ExerciseResult[]): string {
  const m = weightedMean(lesson, exercises);
  if (m === null) return 'Overall impression: not assessed';
  const g = Math.min(4, Math.max(1, Math.round(m))) as Grade;
  const score = Math.round(((m - 1) / 3) * 100);
  return `Overall impression: ${GRADE_WORDS[g]} (${score}/100)`;
}
