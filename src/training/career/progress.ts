// Progression (section 4.2): availability from prerequisites, endorsements, the pre-solo gate and the FAA
// N1 rule; applying a LessonResult to the career (progress, skills, endorsements, results, records).
//
// Generic rules, so the syllabus stays data:
//   - A lesson with `requiredFor` containing the authority (N1 under FAA) is a prerequisite of every
//     `kind: 'test'` lesson (the skill test) under that authority.
//   - The pre-solo gate (L13) applies to every `kind: 'check'` lesson: at least 3 safe assessed landings and
//     no intervention in the last two dual lessons flown.
//   - Optional lessons (requiredFor set but not for this authority, e.g. N1 under EASA) are offered by
//     nextLesson only once no required lesson is waiting.

import type { AuthorityId, EndorsementId, Grade, Lesson, LessonProgress, LessonResult, LogbookEntry, SkillId, TrainingSave } from '../types';
import { failedTestSections } from '../grading/results';
import { totals } from './totals';

/** Safe assessed landings needed before the pre-solo check (section 4.1, L13). */
export const PRE_SOLO_SAFE_LANDINGS = 3;
/** Dual lessons, most recent first, that must be free of interventions before the pre-solo check. */
export const PRE_SOLO_CLEAN_DUAL_LESSONS = 2;
/** Night landings logged for the night rating (FAA 61.109(a)(2)(ii)). */
export const NIGHT_LANDINGS_FOR_RATING = 10;
/** The pre-solo progress check (rank "solo endorsed" once it is competent). */
export const PRE_SOLO_CHECK_ID = 'L13';
/** Lesson results kept per lesson (section 2.11). */
export const RESULTS_KEPT = 3;

const ENDORSEMENT_TITLES: Record<string, string> = {
  firstSolo: 'First solo', soloAreaSolo: 'Solo area', crosswind15: 'Crosswind 15 kt', night: 'Night', ppl: 'Private pilot licence',
};

const isCompetent = (save: TrainingSave, id: string): boolean => save.progress[id]?.status === 'competent';
const isOptional = (l: Lesson, authority: AuthorityId): boolean => l.requiredFor !== undefined && !l.requiredFor.includes(authority);

/** Prerequisites still missing for a lesson (for "locked" hover text); empty when available. */
export function missingPrerequisites(save: TrainingSave, lesson: Lesson, syllabus: readonly Lesson[], authority: AuthorityId): string[] {
  if (save.profile.experienced) return [];
  const byId = new Map(syllabus.map((l) => [l.id, l]));
  const name = (id: string): string => {
    const l = byId.get(id);
    return l ? `${id} ${l.title}` : id;
  };
  const missing: string[] = [];
  const requires = [...lesson.requires];
  if (lesson.kind === 'test') {
    for (const l of syllabus) if (l.requiredFor?.includes(authority) && !requires.includes(l.id)) requires.push(l.id);
  }
  for (const id of requires) if (!isCompetent(save, id)) missing.push(name(id));
  for (const e of lesson.requiresEndorsements ?? []) {
    if (!save.endorsements.some((x) => x.id === e)) missing.push(`Endorsement: ${ENDORSEMENT_TITLES[e] ?? e}`);
  }
  if (lesson.kind === 'check') {
    const safe = save.records?.safeLandings ?? 0;
    if (safe < PRE_SOLO_SAFE_LANDINGS) missing.push(`${PRE_SOLO_SAFE_LANDINGS} safe assessed landings (${safe} so far)`);
    if (interventionsInRecentDual(save, byId) > 0) missing.push(`No instructor intervention in the last ${PRE_SOLO_CLEAN_DUAL_LESSONS} dual lessons`);
  }
  return missing;
}

/** Interventions in the most recent dual lessons flown (any outcome). */
function interventionsInRecentDual(save: TrainingSave, byId: Map<string, Lesson>): number {
  const dual = Object.values(save.results).flat().filter((r) => byId.get(r.lessonId)?.kind === 'dual');
  dual.sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt));
  return dual.slice(0, PRE_SOLO_CLEAN_DUAL_LESSONS).reduce((n, r) => n + r.interventions, 0);
}

/** Status of every lesson for this profile and authority (`experienced` makes all available). */
export function lessonStatuses(save: TrainingSave, syllabus: readonly Lesson[], authority: AuthorityId): Record<string, LessonProgress['status']> {
  const out: Record<string, LessonProgress['status']> = {};
  for (const l of syllabus) {
    out[l.id] = isCompetent(save, l.id) ? 'competent' : missingPrerequisites(save, l, syllabus, authority).length === 0 ? 'available' : 'locked';
  }
  return out;
}

/** The next lesson to fly (home "Continue" card); null when the course is complete. */
export function nextLesson(save: TrainingSave, syllabus: readonly Lesson[], authority: AuthorityId): Lesson | null {
  const st = lessonStatuses(save, syllabus, authority);
  const open = syllabus.filter((l) => st[l.id] === 'available');
  return open.find((l) => !isOptional(l, authority)) ?? open[0] ?? null;
}

export interface ApplyResultOutput {
  save: TrainingSave;
  /** Endorsements newly awarded by this result (ceremony cards). */
  awarded: EndorsementId[];
}

/**
 * Fold a result into the career (progress, skills last5, endorsements, results last 3, records, testHistory).
 * `entry`, when given, is appended to the logbook first (the night rating counts logged night landings);
 * without it the result's own night landings are counted. `practiceOnly` (a lesson opened through lesson= or
 * unlock= while locked) records the attempt and the result but signs nothing off.
 */
export function applyResult(save: TrainingSave, lesson: Lesson, result: LessonResult, practiceOnly: boolean, entry?: LogbookEntry): ApplyResultOutput {
  const s: TrainingSave = structuredClone(save);
  if (entry) s.logbook.push(structuredClone(entry));
  s.updatedAt = result.endedAt;

  const list = [...(s.results[lesson.id] ?? []), structuredClone(result)];
  s.results[lesson.id] = list.slice(-RESULTS_KEPT);

  const passed = result.outcome === 'competent' || result.outcome === 'testPass';
  const prev = s.progress[lesson.id];
  const p: LessonProgress = prev ? structuredClone(prev) : { status: 'available', attempts: 0, bestStars: 0, lastOutcome: null, exercises: {}, lessonVersion: lesson.version };
  p.attempts++;
  p.lastOutcome = result.outcome;
  const awarded: EndorsementId[] = [];

  if (!practiceOnly) {
    if (p.lessonVersion !== lesson.version) {
      // Exercise sign-offs carry over only within one lesson version; a competency already earned stays.
      p.exercises = {};
      p.lessonVersion = lesson.version;
    }
    for (const ex of result.exercises) {
      if (ex.grade === null) continue;
      const old = p.exercises[ex.exerciseId];
      const rec: LessonProgress['exercises'][string] = { best: (old ? Math.max(old.best, ex.grade) : ex.grade) as Grade, last: ex.grade };
      const competentAt = old?.competentAt ?? (ex.grade >= 2 ? result.endedAt : undefined);
      if (competentAt) rec.competentAt = competentAt;
      p.exercises[ex.exerciseId] = rec;
    }
    if (passed) {
      if (result.traceId && (p.bestTraceId === undefined || result.stars > p.bestStars)) p.bestTraceId = result.traceId;
      p.status = 'competent';
      p.completedAt ??= result.endedAt;
    }
    p.bestStars = Math.max(p.bestStars, result.stars);

    // Skills: the last five graded exercise results per skill.
    const skillOf = new Map(lesson.exercises.map((e) => [e.id, e.skill]));
    for (const ex of result.exercises) {
      const skill = skillOf.get(ex.exerciseId) as SkillId | undefined;
      if (!skill || ex.grade === null || ex.mode === 'demo') continue;
      const last5 = [...(s.skills[skill]?.last5 ?? []), ex.grade].slice(-5);
      s.skills[skill] = { last5 };
    }

    // Awards.
    for (const a of lesson.awards ?? []) {
      const earned = a.when === 'testPass' ? result.outcome === 'testPass' : passed;
      if (!earned || s.endorsements.some((e) => e.id === a.id)) continue;
      if (a.id === 'night') {
        const nightLandings = totals(s.logbook).landingsNight + (entry ? 0 : result.flight.landingsNight);
        if (nightLandings < NIGHT_LANDINGS_FOR_RATING) continue;
      }
      s.endorsements.push({ id: a.id, at: result.endedAt, lessonId: lesson.id });
      awarded.push(a.id);
    }

    if (result.safeLandings) s.records = { safeLandings: (s.records?.safeLandings ?? 0) + result.safeLandings };
  }
  s.progress[lesson.id] = p;

  if (result.outcome === 'testPass' || result.outcome === 'testPartial' || result.outcome === 'testFail') {
    s.testHistory.push({ at: result.endedAt, outcome: result.outcome, failedSections: failedTestSections(lesson, result.exercises) });
  }
  return { save: s, awarded };
}

/** Licence-card rank (Student Pilot ... Private Pilot (A), SEP land, + Night). */
export function rank(save: TrainingSave, authority: AuthorityId): string {
  const has = (id: EndorsementId): boolean => save.endorsements.some((e) => e.id === id);
  let r: string;
  if (has('ppl')) r = authority === 'easa' ? 'Private Pilot (A), SEP land' : 'Private Pilot ASEL';
  else if (has('firstSolo')) r = 'First Solo';
  else if (isCompetent(save, PRE_SOLO_CHECK_ID)) r = 'Student Pilot (solo endorsed)';
  else r = 'Student Pilot';
  return has('night') ? `${r} + Night` : r;
}
