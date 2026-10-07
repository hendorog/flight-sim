// Progression (section 4.2): prerequisites, endorsements, the pre-solo (L13) gate, the FAA N1 rule, the
// next lesson, folding results into the career, ranks; and challenge scoring (section 4.3).

import { describe, expect, it } from 'vitest';
import { addBest, medalFor, scoreChallenge, type ChallengeInputs } from '../../src/training/career/challenges';
import { applyResult, lessonStatuses, missingPrerequisites, nextLesson, rank } from '../../src/training/career/progress';
import type { ChallengeBest, LandingData, Lesson, TrainingSave } from '../../src/training/types';
import { ex, exerciseResult, lesson, lessonResult, newSave } from './gradingFixtures';

// A syllabus with the shape of section 4.2.
const L = (id: string, o: Partial<Lesson> = {}): Lesson => lesson({ id, title: `Title ${id}`, ...o });
const SYL: Lesson[] = [
  L('L01'), L('L02', { requires: ['L01'] }),
  L('L10', { requires: ['L02'], exercises: [ex('circ', 'assessed', 'test', { skill: 'circuit' })] }),
  L('L12', { requires: ['L10'] }),
  L('L13', { requires: ['L12'], kind: 'check' }),
  L('L14', { requires: ['L13'], kind: 'solo', awards: [{ id: 'firstSolo', when: 'competent', title: 'First solo' }] }),
  L('L20', { requires: ['L14'] }),
  L('L21', { requires: ['L20'], kind: 'test', persona: 'examiner', awards: [{ id: 'ppl', when: 'testPass', title: 'PPL' }],
    exercises: [ex('s1', 'assessed', 'test', { testSection: 1 }), ex('s2', 'assessed', 'test', { testSection: 2 })] }),
  L('N1', { requires: ['L14'], stage: 'rating', requiredFor: ['faa'], awards: [{ id: 'night', when: 'competent', title: 'Night' }] }),
  L('X1', { requires: ['L01'], requiresEndorsements: ['crosswind15'] }),
];

const competent = (...ids: string[]): TrainingSave['progress'] =>
  Object.fromEntries(ids.map((id) => [id, { status: 'competent' as const, attempts: 1, bestStars: 1, lastOutcome: 'competent' as const, exercises: {}, lessonVersion: 1 }]));
const ALL_BUT = (...skip: string[]) => competent(...SYL.map((l) => l.id).filter((id) => !skip.includes(id)));

describe('lesson availability', () => {
  it('unlocks a lesson when its prerequisites are competent', () => {
    const s = newSave({ progress: competent('L01') });
    const st = lessonStatuses(s, SYL, 'easa');
    expect(st).toMatchObject({ L01: 'competent', L02: 'available', L10: 'locked' });
    expect(missingPrerequisites(s, SYL[2], SYL, 'easa')).toEqual(['L02 Title L02']);
  });

  it('needs endorsements named by the lesson', () => {
    const s = newSave({ progress: competent('L01') });
    const x1 = SYL.find((l) => l.id === 'X1')!;
    expect(missingPrerequisites(s, x1, SYL, 'easa')).toEqual(['Endorsement: Crosswind 15 kt']);
    s.endorsements.push({ id: 'crosswind15', at: '2026-09-01T00:00:00.000Z', lessonId: null });
    expect(missingPrerequisites(s, x1, SYL, 'easa')).toEqual([]);
  });

  it('gates the pre-solo check on 3 safe landings and no intervention in the last two dual lessons', () => {
    const l13 = SYL.find((l) => l.id === 'L13')!;
    const s = newSave({ progress: competent('L01', 'L02', 'L10', 'L12'), records: { safeLandings: 2 } });
    expect(missingPrerequisites(s, l13, SYL, 'easa')).toEqual(['3 safe assessed landings (2 so far)']);
    s.records = { safeLandings: 3 };
    s.results = {
      L10: [lessonResult('L10', { endedAt: '2026-09-01T10:00:00.000Z', interventions: 1 })],
      L12: [lessonResult('L12', { endedAt: '2026-09-02T10:00:00.000Z' })],
    };
    expect(missingPrerequisites(s, l13, SYL, 'easa')).toEqual(['No instructor intervention in the last 2 dual lessons']);
    s.results.L02 = [lessonResult('L02', { endedAt: '2026-09-03T10:00:00.000Z' })];   // two clean dual lessons since
    expect(missingPrerequisites(s, l13, SYL, 'easa')).toEqual([]);
    // A solo lesson does not count as one of the dual lessons.
    s.results.L14 = [lessonResult('L14', { endedAt: '2026-09-04T10:00:00.000Z' })];
    s.results.L02[0].interventions = 2;
    expect(lessonStatuses(s, SYL, 'easa').L13).toBe('locked');
  });

  it('makes N1 a prerequisite of the skill test under FAA only', () => {
    const s = newSave({ progress: ALL_BUT('L21', 'N1') });
    const l21 = SYL.find((l) => l.id === 'L21')!;
    expect(missingPrerequisites(s, l21, SYL, 'easa')).toEqual([]);
    expect(missingPrerequisites(s, l21, SYL, 'faa')).toEqual(['N1 Title N1']);
  });

  it('makes everything available to an experienced pilot', () => {
    const s = newSave({ profile: { ...newSave().profile, experienced: true } });
    expect(Object.values(lessonStatuses(s, SYL, 'faa')).every((x) => x === 'available')).toBe(true);
  });
});

describe('next lesson', () => {
  it('is the first available lesson in syllabus order', () => {
    expect(nextLesson(newSave(), SYL, 'easa')?.id).toBe('L01');
    expect(nextLesson(newSave({ progress: competent('L01') }), SYL, 'easa')?.id).toBe('L02');
  });

  it('offers an optional rating only when no required lesson waits, and the required one under FAA first', () => {
    const afterSolo = newSave({ progress: competent('L01', 'L02', 'L10', 'L12', 'L13', 'L14') });
    expect(nextLesson(afterSolo, SYL, 'easa')?.id).toBe('L20');
    const beforeTest = newSave({ progress: ALL_BUT('L21', 'N1') });
    expect(nextLesson(beforeTest, SYL, 'faa')?.id).toBe('N1');
    expect(nextLesson(beforeTest, SYL, 'easa')?.id).toBe('L21');
    expect(nextLesson(newSave({ progress: ALL_BUT('N1') }), SYL, 'easa')?.id).toBe('N1');
    expect(nextLesson(newSave({ progress: ALL_BUT('X1') }), SYL, 'easa')).toBeNull();
  });
});

describe('applyResult', () => {
  const l10 = SYL.find((l) => l.id === 'L10')!;

  it('records the attempt, signs off exercises, keeps the last 3 results and the skills last 5', () => {
    let s = newSave();
    for (let i = 0; i < 4; i++) {
      const r = lessonResult('L10', { attemptId: `a${i}`, outcome: i < 3 ? 'notYet' : 'competent', stars: i < 3 ? 0 : 2,
        endedAt: `2026-09-0${i + 1}T10:00:00.000Z`, exercises: [exerciseResult('circ', i < 3 ? 1 : 3)], safeLandings: 1 });
      s = applyResult(s, l10, r, false).save;
    }
    const p = s.progress.L10;
    expect(p).toMatchObject({ status: 'competent', attempts: 4, bestStars: 2, lastOutcome: 'competent', completedAt: '2026-09-04T10:00:00.000Z' });
    expect(p.exercises.circ).toEqual({ best: 3, last: 3, competentAt: '2026-09-04T10:00:00.000Z' });
    expect(s.results.L10.map((r) => r.attemptId)).toEqual(['a1', 'a2', 'a3']);
    expect(s.skills.circuit?.last5).toEqual([1, 1, 1, 3]);
    expect(s.records?.safeLandings).toBe(4);
  });

  it('does not mutate its input', () => {
    const s = newSave();
    const copy = JSON.parse(JSON.stringify(s));
    applyResult(s, l10, lessonResult('L10', { exercises: [exerciseResult('circ', 3)] }), false);
    expect(s).toEqual(copy);
  });

  it('resets exercise sign-offs when the lesson version changed but keeps a competency earned', () => {
    let s = newSave({ progress: { L10: { status: 'competent', attempts: 1, bestStars: 1, lastOutcome: 'competent', lessonVersion: 1, exercises: { old: { best: 3, last: 3 } } } } });
    s = applyResult(s, { ...l10, version: 2 }, lessonResult('L10', { outcome: 'notYet', stars: 0, lessonVersion: 2, exercises: [exerciseResult('circ', 1)] }), false).save;
    expect(s.progress.L10).toMatchObject({ status: 'competent', lessonVersion: 2, exercises: { circ: { best: 1, last: 1 } } });
    expect(s.progress.L10.exercises.old).toBeUndefined();
  });

  it('gives practice-only runs no credit', () => {
    const s = applyResult(newSave(), l10, lessonResult('L10', { exercises: [exerciseResult('circ', 4)], safeLandings: 2 }), true).save;
    expect(s.progress.L10).toMatchObject({ status: 'available', attempts: 1, exercises: {} });
    expect(s.records?.safeLandings).toBe(0);
    expect(s.results.L10).toHaveLength(1);
  });

  it('awards endorsements once, with the night rating needing 10 logged night landings', () => {
    const l14 = SYL.find((l) => l.id === 'L14')!;
    const first = applyResult(newSave(), l14, lessonResult('L14'), false);
    expect(first.awarded).toEqual(['firstSolo']);
    expect(applyResult(first.save, l14, lessonResult('L14', { attemptId: 'b' }), false).awarded).toEqual([]);

    const n1 = SYL.find((l) => l.id === 'N1')!;
    const night = (n: number) => lessonResult('N1', { flight: { ...lessonResult('N1').flight, landingsNight: n } });
    const r1 = applyResult(newSave(), n1, night(3), false);
    expect(r1.awarded).toEqual([]);
    const entry = { id: 'e', date: '2026-09-01', aircraftType: 'C172', registration: 'N172FS', from: 'KFBL' as const, to: 'KFBL' as const,
      role: 'dual' as const, times: { ...night(7).flight }, lessonId: 'N1', lessonVersion: 1, exercise: 'Night', outcome: 'competent' as const,
      stars: 1, remarks: '', signedBy: null };
    const r2 = applyResult({ ...r1.save, logbook: [{ ...entry, id: 'e0', times: { ...entry.times, landingsNight: 3 } }] }, n1, night(7), false, entry);
    expect(r2.awarded).toEqual(['night']);
    expect(r2.save.logbook.map((e) => e.id)).toEqual(['e0', 'e']);
  });

  it('records skill-test outcomes and failed sections', () => {
    const l21 = SYL.find((l) => l.id === 'L21')!;
    const out = applyResult(newSave(), l21, lessonResult('L21', { outcome: 'testPartial', stars: 0, exercises: [exerciseResult('s1', 3), exerciseResult('s2', 1)] }), false);
    expect(out.save.testHistory).toEqual([{ at: '2026-09-01T10:20:00.000Z', outcome: 'testPartial', failedSections: [2] }]);
    expect(out.awarded).toEqual([]);
    const pass = applyResult(out.save, l21, lessonResult('L21', { outcome: 'testPass', exercises: [exerciseResult('s1', 3), exerciseResult('s2', 3)] }), false);
    expect(pass.awarded).toEqual(['ppl']);
    expect(pass.save.progress.L21.status).toBe('competent');
  });

  it('keeps the best trace of the best-starred competent run', () => {
    let s = applyResult(newSave(), l10, lessonResult('L10', { stars: 1, traceId: 't1' }), false).save;
    s = applyResult(s, l10, lessonResult('L10', { attemptId: 'b', stars: 1, traceId: 't2' }), false).save;
    expect(s.progress.L10.bestTraceId).toBe('t1');
    s = applyResult(s, l10, lessonResult('L10', { attemptId: 'c', stars: 3, traceId: 't3' }), false).save;
    expect(s.progress.L10.bestTraceId).toBe('t3');
  });
});

describe('rank', () => {
  const at = '2026-09-01T00:00:00.000Z';
  it('climbs from student pilot to private pilot by authority', () => {
    expect(rank(newSave(), 'easa')).toBe('Student Pilot');
    expect(rank(newSave({ progress: competent('L13') }), 'easa')).toBe('Student Pilot (solo endorsed)');
    expect(rank(newSave({ endorsements: [{ id: 'firstSolo', at, lessonId: 'L14' }] }), 'easa')).toBe('First Solo');
    const ppl = newSave({ endorsements: [{ id: 'firstSolo', at, lessonId: 'L14' }, { id: 'ppl', at, lessonId: 'L21' }] });
    expect(rank(ppl, 'easa')).toBe('Private Pilot (A), SEP land');
    expect(rank(ppl, 'faa')).toBe('Private Pilot ASEL');
    ppl.endorsements.push({ id: 'night', at, lessonId: 'N1' });
    expect(rank(ppl, 'easa')).toBe('Private Pilot (A), SEP land + Night');
  });
});

describe('challenges', () => {
  const landing = (o: Partial<LandingData> = {}): LandingData => ({
    sinkFpm: 200, kias: 58, firstWheel: 'left', distAimFt: 0, rwyAcrossM: 0, driftDeg: 0, bankDeg: 0, pitchDeg: 5, onRunway: true,
    kiasAt50Ft: 65, gpDevFtAt300: 0, bounces: 0, maxBounceFt: 0, floatS: 3, rolloutMaxAcrossM: 1, fullStop: true, crashed: false, ...o,
  });
  const inputs = (o: Partial<ChallengeInputs> = {}): ChallengeInputs => ({ landing: landing(), meanNormalisedError: 0, glideWithin: 1, stallWarning: false, ...o });

  it('scores a spot landing from the distance to the aim point and the sink', () => {
    expect(scoreChallenge('spotLanding', inputs())).toBe(100);
    expect(scoreChallenge('spotLanding', inputs({ landing: landing({ distAimFt: -80 }) }))).toBe(80);
    expect(scoreChallenge('spotLanding', inputs({ landing: landing({ distAimFt: 40, sinkFpm: 500 }) }))).toBe(70);
    expect(scoreChallenge('spotLanding', inputs({ landing: landing({ firstWheel: 'nose' }) }))).toBe(0);
    expect(scoreChallenge('spotLanding', inputs({ landing: landing({ onRunway: false }) }))).toBe(0);
    expect(scoreChallenge('spotLanding', inputs({ landing: landing({ distAimFt: 900 }) }))).toBe(0);
    expect(scoreChallenge('spotLanding', inputs({ landing: null }))).toBe(0);
  });

  it('scores the dead-stick from zone, glide, stall warning and sink', () => {
    expect(scoreChallenge('deadStick', inputs({ landing: landing({ distAimFt: 200 }) }))).toBe(100);
    expect(scoreChallenge('deadStick', inputs({ landing: landing({ distAimFt: 200 }), glideWithin: 0.5, stallWarning: true }))).toBe(70);
    expect(scoreChallenge('deadStick', inputs({ landing: landing({ distAimFt: 500, sinkFpm: 500 }) }))).toBe(20 + 30 + 15 + 8);
    expect(scoreChallenge('deadStick', inputs({ landing: landing({ crashed: true }) }))).toBe(0);
  });

  it('scores the crosswind master from centreline, drift, sink and zone', () => {
    expect(scoreChallenge('crosswindMaster', inputs({ landing: landing({ distAimFt: 100 }) }))).toBe(100);
    expect(scoreChallenge('crosswindMaster', inputs({ landing: landing({ distAimFt: 100, rwyAcrossM: 5, driftDeg: -5 }) }))).toBe(70);
  });

  it('scores the precision circuit from the mean normalised error', () => {
    expect(scoreChallenge('precisionCircuit', inputs({ meanNormalisedError: 0.3 }))).toBe(85);
    expect(scoreChallenge('precisionCircuit', inputs({ meanNormalisedError: 2.5 }))).toBe(0);
  });

  it('awards medals at 60, 80 and 92', () => {
    expect([59, 60, 80, 92].map(medalFor)).toEqual([null, 'bronze', 'silver', 'gold']);
  });

  it('keeps the top 5 bests per authority', () => {
    const flags = { calmAir: false, kbdAssists: true, instructorSaves: true, inputDevice: 'keyboard' as const };
    let list: ChallengeBest[] = [{ score: 99, at: '2026-08-01T00:00:00.000Z', authority: 'faa', flags }];
    for (const [i, score] of [60, 90, 70, 80, 75, 65].entries()) list = addBest(list, { score, at: `2026-09-0${i + 1}T00:00:00.000Z`, authority: 'easa', flags });
    expect(list.filter((b) => b.authority === 'easa').map((b) => b.score)).toEqual([90, 80, 75, 70, 65]);
    expect(list.filter((b) => b.authority === 'faa')).toHaveLength(1);
    list = addBest(list, { score: 80, at: '2026-09-09T00:00:00.000Z', authority: 'easa', flags });
    const easa = list.filter((b) => b.authority === 'easa');
    expect(easa.map((b) => b.at)[1]).toBe('2026-09-04T00:00:00.000Z');   // the earlier 80 keeps its place
  });
});
