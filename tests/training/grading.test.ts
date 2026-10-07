// Grading (section 3.4): the hold grade table on synthetic series, asymmetric and zero-sided tolerances, the
// momentary-deviation rule, the test-standard grade in parallel, sample grades, min-aggregation with fault
// caps, the Grader's task lifecycle, the stall and unusual-attitude graders, lesson outcome and stars, and
// the debrief text.

import { describe, expect, it } from 'vitest';
import { all, check, final, gt, held, hold, lt, peak, binary, atEvent, near, ev } from '../../src/training/engine/dsl';
import { HoldAccumulator, normalisedError } from '../../src/training/grading/accumulators';
import { landing, stallRecovery, unusualAttitude } from '../../src/training/grading/criteria';
import { buildDebrief } from '../../src/training/grading/debrief';
import { Grader, aggregateExercise, gradeHold, gradeSample, isInsufficient } from '../../src/training/grading/grade';
import { lessonOutcome, lessonStars, overallImpression, failedTestSections, type OutcomeInput } from '../../src/training/grading/results';
import { passFailResult, sampleResult } from '../../src/training/grading/rules';
import { StallGrader } from '../../src/training/grading/stall';
import { STANDARDS } from '../../src/training/grading/standards';
import { UnusualAttitudeGrader } from '../../src/training/grading/unusual';
import type { CriterionResult, ExerciseDef, LessonResult, TaskStep, Tol } from '../../src/training/types';
import { Ctx, TEST_AIRCRAFT, ex, exerciseResult, lesson, lessonResult } from './gradingFixtures';

const sym = (x: number): Tol => ({ minus: x, plus: x });

/** Feed an accumulator a deviation series e(t) sampled at `hz` for `s` seconds. */
function series(acc: HoldAccumulator, s: number, e: (t: number) => number, target = 1000, hz = 10): void {
  const dt = 1 / hz;
  for (let i = 0; i < s * hz; i++) {
    const t = i * dt;
    acc.add(target + e(t), target, t, dt);
  }
}

const task = (criteria: TaskStep['criteria'], o: Partial<TaskStep> = {}): TaskStep => ({
  kind: 'task', id: o.id ?? 't1', exercise: o.exercise ?? 'ex1', brief: 'x', card: { title: 'T', targets: [] },
  goal: { const: false }, criteria, ...o,
});

describe('normalised error', () => {
  it('uses the side of the tolerance the error is on, with a 0.5 unit floor on a zero side', () => {
    const tol = { minus: 5, plus: 15 };
    expect(normalisedError(12, tol)).toBeCloseTo(0.8);
    expect(normalisedError(-6, tol)).toBeCloseTo(1.2);
    expect(normalisedError(-0.4, { minus: 0, plus: 10 })).toBeCloseTo(0.8);
    expect(normalisedError(0, { minus: 0, plus: 0 })).toBe(0);
  });
});

describe('hold grade table', () => {
  const tol = sym(100);
  it('grades 4 when within >= 98 % and maxN <= 0.6', () => {
    const acc = new HoldAccumulator(tol, tol, false);
    series(acc, 60, (t) => 50 * Math.sin(t));
    const s = acc.summary();
    expect(s.within).toBe(1);
    expect(s.maxN).toBeCloseTo(0.5, 2);
    expect(gradeHold(s, 'test')).toBe(4);
  });

  it('grades 3 when maxN <= 1', () => {
    const acc = new HoldAccumulator(tol, tol, false);
    series(acc, 60, (t) => 90 * Math.sin(t));
    expect(gradeHold(acc.summary(), 'test')).toBe(3);
  });

  it('grades 2 for a momentary excursion promptly corrected, 1 when it lasts too long', () => {
    const momentary = new HoldAccumulator(tol, tol, false);
    series(momentary, 60, (t) => (t >= 20 && t < 23 ? 130 : 20));
    const s = momentary.summary();
    expect(s.excursions).toHaveLength(1);
    expect(s.longestOutS).toBeCloseTo(3, 1);
    expect(gradeHold(s, 'test')).toBe(2);

    const long = new HoldAccumulator(tol, tol, false);
    series(long, 120, (t) => (t >= 20 && t < 27 ? 130 : 20));
    expect(gradeHold(long.summary(), 'test')).toBe(1);        // 7 s > 5 s at test standard
    expect(gradeHold(long.summary(), 'training')).toBe(2);    // <= 10 s at training standard
  });

  it('grades 1 beyond 1.5 tolerances or below 90 % within', () => {
    const big = new HoldAccumulator(tol, tol, false);
    series(big, 60, (t) => (t >= 30 && t < 31 ? 160 : 0));
    expect(gradeHold(big.summary(), 'training')).toBe(1);
    const often = new HoldAccumulator(tol, tol, false);
    series(often, 60, (t) => (Math.floor(t) % 8 === 0 ? 120 : 0));   // 12.5 % out, in 1 s bursts
    expect(often.summary().excursions).toHaveLength(0);              // each burst is under the 2 s floor
    expect(gradeHold(often.summary(), 'training')).toBe(1);
  });

  it('has no grade with under 5 s sampled', () => {
    const acc = new HoldAccumulator(tol, tol, false);
    series(acc, 4.9, () => 0);
    expect(gradeHold(acc.summary(), 'test')).toBeNull();
  });

  it('counts excursions under 2 s in time-within but never as excursions', () => {
    const acc = new HoldAccumulator(tol, tol, false);
    series(acc, 30, (t) => (t >= 10 && t < 11.5 ? 150 : 0));
    const s = acc.summary();
    expect(s.excursions).toHaveLength(0);
    expect(s.longestOutS).toBe(0);
    expect(s.within).toBeCloseTo(1 - 1.5 / 30, 2);
  });

  it('wraps angles', () => {
    const acc = new HoldAccumulator(sym(10), sym(10), true);
    for (let i = 0; i < 100; i++) acc.add(5, 355, i * 0.1, 0.1);
    expect(acc.summary().meanE).toBeCloseTo(10);
    expect(acc.summary().maxN).toBeCloseTo(1);
  });

  it('grades the same samples against the test tolerance in parallel', () => {
    const acc = new HoldAccumulator(STANDARDS.easa.training.altitude, STANDARDS.easa.test.altitude, false);
    series(acc, 60, () => 160);
    expect(gradeHold(acc.summary(), 'training')).toBe(3);   // 160 / 200
    expect(gradeHold(acc.testSummary(), 'test')).toBe(1);   // 160 / 150, never within
  });

  it('measures the asymmetric climb-speed band on the side of the error', () => {
    const tol = STANDARDS.easa.test.speedClimbApproach;   // -5 / +15
    const fast = new HoldAccumulator(tol, tol, false);
    series(fast, 30, () => 12, 74);
    expect(gradeHold(fast.summary(), 'test')).toBe(3);
    const slow = new HoldAccumulator(tol, tol, false);
    series(slow, 30, () => -6, 74);
    expect(gradeHold(slow.summary(), 'test')).toBe(1);
  });
});

describe('sample grades (peak, final, atEvent)', () => {
  it('follows the table, with "nearly" only at the training standard', () => {
    expect(gradeSample(0.6, 'test')).toBe(4);
    expect(gradeSample(0.61, 'test')).toBe(3);
    expect(gradeSample(1, 'test')).toBe(3);
    expect(gradeSample(1.2, 'training')).toBe(2);
    expect(gradeSample(1.2, 'test')).toBe(1);
    expect(gradeSample(1.2, 'commercial')).toBe(1);
    expect(gradeSample(1.3, 'training')).toBe(1);
    expect(gradeSample(NaN, 'training')).toBe(1);
  });
});

describe('exercise aggregation', () => {
  const def: ExerciseDef = ex('a', 'assessed', 'test');
  const row = (id: string, grade: 1 | 2 | 3 | 4, o: Partial<CriterionResult> = {}): CriterionResult =>
    ({ ...sampleResult({ id, label: id, kind: 'hold', required: true, safety: false }, 0, 0, 0, sym(1), sym(1), 'test'), grade, testGrade: grade, ...o });

  it('takes the minimum over required criteria, not an average', () => {
    expect(aggregateExercise([row('a', 4), row('b', 4), row('c', 2)], [], false, def)).toBe(2);
    expect(aggregateExercise([row('a', 4), row('b', 1, { required: false })], [], false, def)).toBe(4);
  });

  it('fails outright on a failed safety criterion or a critical fault', () => {
    expect(aggregateExercise([row('a', 4), row('s', 1, { safety: true, required: false })], [], false, def)).toBe(1);
    expect(aggregateExercise([row('a', 4)], [{ id: 'f', severity: 'critical', atS: 1 }], false, def)).toBe(1);
  });

  it('caps at 2 for a major fault and at 3 for two minor faults', () => {
    expect(aggregateExercise([row('a', 4)], [{ id: 'f', severity: 'major', atS: 1 }], false, def)).toBe(2);
    expect(aggregateExercise([row('a', 4)], [{ id: 'f', severity: 'minor', atS: 1 }], false, def)).toBe(4);
    expect(aggregateExercise([row('a', 4)], [{ id: 'f', severity: 'minor', atS: 1 }, { id: 'g', severity: 'minor', atS: 2 }], false, def)).toBe(3);
  });

  it('grades an assessed exercise 1 after an intervention, a practice exercise normally', () => {
    expect(aggregateExercise([row('a', 4)], [], true, def)).toBe(1);
    expect(aggregateExercise([row('a', 4)], [], true, ex('p', 'practice', 'training'))).toBe(4);
  });

  it('treats passed gates as neutral, capped gates as caps and failed gates as fails', () => {
    const gate = (g: 1 | 2 | 3) => passFailResult({ id: `g${g}`, label: 'g', kind: 'check', required: true, safety: false }, g === 3, 'x', g);
    expect(aggregateExercise([row('a', 4), gate(3)], [], false, def)).toBe(4);
    expect(aggregateExercise([row('a', 4), gate(2)], [], false, def)).toBe(2);
    expect(aggregateExercise([row('a', 4), gate(1)], [], false, def)).toBe(1);
    expect(aggregateExercise([gate(3)], [], false, def)).toBe(3);
  });

  it('is ungraded when a required criterion has no data, and for demos', () => {
    const missing = { ...row('m', 1), insufficient: true } as CriterionResult;
    expect(aggregateExercise([row('a', 4), missing], [], false, def)).toBeNull();
    expect(aggregateExercise([row('a', 4), { ...missing, required: false }], [], false, def)).toBe(4);
    expect(aggregateExercise([row('a', 4)], [], false, ex('d', 'demo', 'training'))).toBeNull();
  });

  it('aggregates the test-standard grade separately', () => {
    const r = { ...row('a', 3), testGrade: 1 as const };
    expect(aggregateExercise([r], [], false, def, 'grade')).toBe(3);
    expect(aggregateExercise([r], [], false, def, 'testGrade')).toBe(1);
  });
});

describe('Grader', () => {
  const exercises = [ex('ex1', 'practice', 'training'), ex('ex2', 'assessed', 'test')];
  const newGrader = (firstAttemptCounts = false) => new Grader({ standards: STANDARDS, authority: 'easa', exercises, firstAttemptCounts });

  /** Fly a task: `frame(t)` gives the values each 0.1 s for `s` seconds. */
  function fly(g: Grader, ctx: Ctx, step: TaskStep, s: number, frame: (t: number) => Record<string, number | boolean>) {
    ctx.enterStep();
    g.beginTask(step, ctx);
    for (let i = 0; i < s * 10; i++) {
      ctx.tick(0.1, frame(ctx.stepT));
      g.sample(ctx);
    }
    return g.endTask('success', ctx);
  }

  it('grades hold, peak, final, check and binary criteria of a climb task', () => {
    const g = newGrader();
    const ctx = new Ctx();
    ctx.vars = { tgt: 3500, hdg0: 100 };
    const step = task([
      hold('ias', 'Climb speed', 'asiKt', { vspeed: 'Vy' }, 'speedClimbApproach', { settleS: 5, activeWhen: lt('altFt', { var: 'tgt', add: -150 }), required: true }),
      hold('hdg', 'Heading', 'hdgDeg', { var: 'hdg0' }, 'heading', { required: true }),
      peak('lvl', 'Level-off overshoot', 'altFt', { var: 'tgt' }, 'altitude', { peakOf: 'max', required: true }),
      final('alt', 'Final altitude', 'altFt', { var: 'tgt' }, 'altitude', { required: true }),
      check('trim', 'Trimmed', { pred: held(lt('untrimmedS', 1), 2), required: false }),
      binary('stall', 'No stall warning', { sig: 'stallWarn', eq: true }, { required: true }),
    ]);
    // Climb 2500 -> 3650 (150 ft overshoot) then settle at 3500; 80 kt (+6 on Vy 74); heading 100 +- 3.
    const r = fly(g, ctx, step, 150, (t) => ({
      altFt: t < 115 ? 2500 + t * 10 : Math.max(3500, 3650 - (t - 115) * 10),
      asiKt: 80, hdgDeg: 100 + 3 * Math.sin(t / 5), untrimmedS: 0, stallWarn: false,
    }));
    const by = Object.fromEntries(r.criteria.map((c) => [c.id, c]));
    expect(by.ias.grade).toBe(4);                 // +6 on +15 = 0.4
    expect(by.ias.testGrade).toBe(4);             // EASA test band is the same -5/+15
    expect(by.hdg.grade).toBe(4);                 // 3 on 15
    expect(by.lvl.grade).toBe(3);                 // 150 on the training 200 = 0.75
    expect(by.lvl.pattern).toBe('late');          // an overshoot is a late level-off
    expect(by.alt.grade).toBe(4);
    expect(by.trim.grade).toBe(3);
    expect(by.stall.grade).toBe(3);
    expect(r.grade).toBe(3);                      // min of measured (lvl) with passed gates neutral
    expect(r.attempts).toBe(1);
  });

  it('samples a hold only after settleS, while activeWhen holds and the frame advances', () => {
    const g = newGrader();
    const ctx = new Ctx();
    const step = task([hold('a', 'Alt', 'altFt', 1000, 100, { settleS: 8, activeWhen: gt('aglFt', 500), required: true })]);
    ctx.enterStep();
    g.beginTask(step, ctx);
    for (let i = 0; i < 200; i++) {
      // 300 ft off during the settle time and while below 500 ft AGL: neither may count.
      const t = (i + 1) * 0.1;
      ctx.tick(0.1, { altFt: t < 8 || t > 14 ? 1300 : 1010, aglFt: t > 14 ? 400 : 600 });
      g.sample(ctx);
    }
    ctx.tick(0, {});
    g.sample(ctx);   // dt 0 (paused): ignored
    const r = g.endTask('success', ctx);
    expect(r.criteria[0].grade).toBe(4);
    expect(r.criteria[0].within).toBe(1);
  });

  it('flags a hold with under 5 s of data and leaves the exercise ungraded', () => {
    const g = newGrader();
    const ctx = new Ctx();
    const r = fly(g, ctx, task([hold('a', 'Alt', 'altFt', 1000, 100, { settleS: 8, required: true })]), 12, () => ({ altFt: 1000 }));
    expect(isInsufficient(r.criteria[0])).toBe(true);
    expect(r.grade).toBeNull();
  });

  it('samples atEvent criteria from the event payload or a signal at that moment', () => {
    const g = newGrader();
    const ctx = new Ctx();
    const step = task([
      atEvent('vr', 'Rotation speed', 'liftoff', 'kias', { vspeed: 'Vr' }, { minus: 0, plus: 10 }, { field: 'kias', required: true }),
      atEvent('hdg', 'Heading at lift-off', 'liftoff', 'hdgDeg', 70, 'heading', { required: true }),
    ]);
    ctx.enterStep();
    g.beginTask(step, ctx);
    ctx.tick(0.1, { hdgDeg: 66 });
    const rec = ctx.events.emit('liftoff', { kias: 58, rwyAlongM: 400 }, ctx.simT);
    g.onEvent(rec, ctx);
    ctx.tick(0.1, { hdgDeg: 90 });
    g.onEvent(ctx.events.emit('liftoff', { kias: 70, rwyAlongM: 900 }, ctx.simT), ctx);   // only the first counts
    const r = g.endTask('success', ctx);
    expect(r.criteria[0].worst?.value).toBe(58);
    expect(r.criteria[0].grade).toBe(4);         // +3 on +10
    expect(r.criteria[1].worst?.value).toBe(66);
    expect(r.criteria[1].grade).toBe(4);         // -4 on 15 (training)
  });

  it('flags an atEvent criterion whose event never came', () => {
    const g = newGrader();
    const ctx = new Ctx();
    const r = fly(g, ctx, task([atEvent('vr', 'Vr', 'liftoff', 'kias', 55, 5, { field: 'kias', required: true })]), 2, () => ({}));
    expect(isInsufficient(r.criteria[0])).toBe(true);
    expect(r.grade).toBeNull();
  });

  it('respects a check within withinS of entry', () => {
    const g = newGrader();
    const ctx = new Ctx();
    const step = task([check('ias', 'IAS below 78 within 4 s', { pred: lt('asiKt', 78), withinS: 4, required: true })]);
    const late = fly(g, ctx, step, 10, (t) => ({ asiKt: t < 6 ? 90 : 70 }));
    expect(late.criteria[0].grade).toBe(1);
    const inTime = fly(g, ctx, step, 10, (t) => ({ asiKt: t < 3 ? 90 : 70 }));
    expect(inTime.criteria[0].grade).toBe(3);
  });

  it('evaluates event predicates against the bus since the step mark', () => {
    const g = newGrader();
    const ctx = new Ctx();
    ctx.events.emit('goAround', { aglFt: 300 }, 0);   // before the step: must not count
    const step = task([check('ga', 'Go around', { pred: ev('goAround'), required: true })]);
    const r = fly(g, ctx, step, 2, () => ({}));
    expect(r.criteria[0].grade).toBe(1);
  });

  it('counts the best attempt in a dual lesson and the first in a check lesson, unless the examiner allows a repeat', () => {
    const step = task([final('alt', 'Alt', 'altFt', 1000, 100, { required: true })], { exercise: 'ex2' });
    // Each flight is its own run of the phase (a repeat or a retry from the checkpoint).
    const run = (g: Grader, alts: number[]) => {
      const ctx = new Ctx();
      for (const a of alts) {
        g.beginPhaseRun();
        fly(g, ctx, step, 1, () => ({ altFt: a }));
      }
    };
    const dual = newGrader();
    run(dual, [1090, 1020, 1070]);         // 0.9 -> 3, 0.2 -> 4, 0.7 -> 3: the best counts
    expect(dual.exerciseGrade('ex2')).toBe(4);
    const dual2 = newGrader();
    run(dual2, [1140, 1020]);
    expect(dual2.exerciseGrade('ex2')).toBe(4);
    expect(dual2.exerciseResults()[0].attempts).toBe(2);

    const check1 = newGrader(true);
    run(check1, [1140, 1020]);             // 1.4 at test standard -> 1, and the first flight counts
    expect(check1.exerciseGrade('ex2')).toBe(1);
    const check2 = newGrader(true);
    check2.allowRepeat('ex2');
    run(check2, [1200, 1020]);
    expect(check2.exerciseGrade('ex2')).toBe(4);
  });

  it('grades an attempt as the minimum over every task of the exercise in one phase run (section 3.4)', () => {
    const leg = (id: string) => task([final(`${id}.alt`, 'Alt', 'altFt', 1000, 100, { required: true })], { id, exercise: 'ex2' });
    const g = newGrader();
    const ctx = new Ctx();
    g.beginPhaseRun();
    fly(g, ctx, leg('upwind'), 1, () => ({ altFt: 1020 }));     // 4
    fly(g, ctx, leg('downwind'), 1, () => ({ altFt: 1090 }));   // 0.9 -> 3
    const r = fly(g, ctx, leg('base'), 1, () => ({ altFt: 1010 }));
    expect(r.grade).toBe(3);
    expect(r.criteria.map((c) => c.id)).toEqual(['upwind.alt', 'downwind.alt', 'base.alt']);
    expect(g.exerciseGrade('ex2')).toBe(3);   // not the best leg
    expect(g.exerciseResults()[0].attempts).toBe(1);

    // A new run of the phase is a new attempt; the best attempt counts.
    g.beginPhaseRun();
    fly(g, ctx, leg('upwind'), 1, () => ({ altFt: 1030 }));
    fly(g, ctx, leg('downwind'), 1, () => ({ altFt: 1050 }));   // 0.5 -> 4
    expect(g.exerciseGrade('ex2')).toBe(4);
    expect(g.exerciseResults()[0].attempts).toBe(2);
  });

  it('lets a step flown again within the phase run (a retry) replace its own earlier rows', () => {
    const step = task([final('alt', 'Alt', 'altFt', 1000, 100, { required: true })], { exercise: 'ex2' });
    const g = newGrader();
    const ctx = new Ctx();
    g.beginPhaseRun();
    fly(g, ctx, step, 1, () => ({ altFt: 1300 }));   // 1
    const again = fly(g, ctx, step, 1, () => ({ altFt: 1020 }));
    expect(again.grade).toBe(4);
    expect(again.criteria).toHaveLength(1);
    expect(g.exerciseResults()[0].attempts).toBe(1);
  });

  it('applies faults and interventions to the open attempt and keeps others pending', () => {
    const g = newGrader();
    const ctx = new Ctx();
    g.recordFault({ id: 'early', severity: 'major', atS: 0 }, 'ex2');         // waits for ex2
    g.recordFault({ id: 'lesson', severity: 'critical', atS: 0 }, null);    // no task open: lesson level
    const step = task([final('alt', 'Alt', 'altFt', 1000, 100, { required: true })], { exercise: 'ex2' });
    ctx.enterStep();
    g.beginTask(step, ctx);
    ctx.tick(0.1, { altFt: 1000 });
    g.sample(ctx);
    g.recordIntervention();
    const r = g.endTask('success', ctx);
    expect(r.faults.map((f) => f.id)).toEqual(['early']);
    expect(r.interventions).toBe(1);
    expect(r.grade).toBe(1);                       // assessed + intervention
    expect(g.lessonFaults().map((f) => f.id)).toEqual(['lesson']);
  });

  it('round-trips its closed attempts through a snapshot and discards an aborted task', () => {
    const g = newGrader();
    const ctx = new Ctx();
    const step = task([final('alt', 'Alt', 'altFt', 1000, 100, { required: true })]);
    fly(g, ctx, step, 1, () => ({ altFt: 1030 }));
    const snap = JSON.parse(JSON.stringify(g.closed()));
    const h = newGrader();
    h.restore(snap);
    expect(h.exerciseGrade('ex1')).toBe(g.exerciseGrade('ex1'));
    ctx.enterStep();
    h.beginTask(step, ctx);
    h.abortTask();
    expect(h.exerciseResults()[0].attempts).toBe(1);
    expect(() => h.endTask('success', ctx)).toThrow();
  });

  it('produces trace bands for charted holds, split at target changes', () => {
    const g = newGrader();
    const ctx = new Ctx();
    ctx.vars = { tgt: 3000 };
    const step = task([hold('a', 'Alt', 'altFt', { var: 'tgt' }, 'altitude', { settleS: 0, required: true })]);
    ctx.enterStep();
    g.beginTask(step, ctx);
    for (let i = 0; i < 100; i++) {
      if (i === 50) ctx.vars = { tgt: 3500 };
      ctx.tick(0.1, { altFt: ctx.vars.tgt });
      g.sample(ctx);
    }
    g.endTask('success', ctx);
    const bands = g.takeBands();
    expect(bands.map((b) => b.target)).toEqual([3000, 3500]);
    expect(bands[0]).toMatchObject({ sig: 'altFt', minus: 200, plus: 200, taskId: 't1' });
    expect(g.takeBands()).toEqual([]);
  });

  it('closes a checklist attempt through addResult', () => {
    const g = newGrader();
    const r = g.addResult('ex1', [passFailResult({ id: 'cl', label: 'Checklist', kind: 'check', required: true, safety: false }, true, 'ok', 4)]);
    expect(r.grade).toBe(4);   // a checklist with nothing missed grades 4 (section 3.5)
    expect(g.exerciseGrade('ex1')).toBe(4);
  });

  it('runs the composite landing grader from the landing event', () => {
    const g = new Grader({ standards: STANDARDS, authority: 'easa', exercises: [ex('land', 'assessed', 'test')], firstAttemptCounts: false });
    const ctx = new Ctx();
    const step = task([landing('ldg', 'Landing', { required: true })], { exercise: 'land' });
    ctx.enterStep();
    g.beginTask(step, ctx);
    ctx.tick(0.1);
    g.onEvent(ctx.events.emit('landing', {
      sinkFpm: 150, kias: 60, firstWheel: 'left', distAimFt: 100, rwyAcrossM: 1, driftDeg: 1, bankDeg: 0, pitchDeg: 4, onRunway: true,
      kiasAt50Ft: 67, gpDevFtAt300: 10, bounces: 0, maxBounceFt: 0, floatS: 3, rolloutMaxAcrossM: 2, fullStop: true, crashed: false,
    }, ctx.simT), ctx);
    const r = g.endTask('success', ctx);
    expect(r.criteria.map((c) => c.id)).toContain('ldg.sink');
    expect(r.criteria[0].safety).toBe(true);    // safety rows first
    expect(r.grade).toBe(4);
  });
});

describe('stall-recovery grader', () => {
  const tol = STANDARDS.easa.test.stallHeightLossFt;   // 0/+200

  /** A power-off stall at 4500 ft: warning at t=2, break at t=5, elevator forward at `recoverAt`, climb after `climbAt`. */
  function fly(o: { recoverAt: number; climbAt: number; minAlt: number; bank?: number; secondAt?: number; incipient?: boolean }) {
    const g = new StallGrader({ tol, testTol: tol, standard: 'test', incipient: o.incipient ?? false });
    const ctx = new Ctx();
    let t = 0;
    const frame = () => {
      const alt = t < 5 ? 4500 : t < o.climbAt ? 4500 - (4500 - o.minAlt) * Math.min(1, (t - 5) / (o.climbAt - 5)) : o.minAlt + (t - o.climbAt) * 8;
      return { altFt: alt, elevator: t < o.recoverAt ? 0.6 : 0.1, pitchRateDps: 0, bankDeg: o.bank ?? 3, vsFpm: t < o.climbAt ? -800 : 400 };
    };
    for (let i = 0; i < 300; i++) {
      t = i * 0.1;
      if (Math.abs(t - 2) < 1e-9) g.onEvent(ctx.events.emit('stallWarnOn', { kias: 52 }, t));
      if (Math.abs(t - 5) < 1e-9) g.onEvent(ctx.events.emit('stallBreak', { kias: 45, altFt: 4500 }, t));
      if (o.secondAt !== undefined && Math.abs(t - o.secondAt) < 1e-9) g.onEvent(ctx.events.emit('stallBreak', { kias: 47, altFt: 4400 }, t));
      g.update(frame(), t, 0.1);
    }
    return g.result() ?? g.close() ?? [];
  }
  const grade = (rows: CriterionResult[]) => aggregateExercise(rows, [], false, ex('s', 'assessed', 'test'));

  it('grades a prompt recovery with little height loss as 4', () => {
    const rows = fly({ recoverAt: 5.3, climbAt: 9, minAlt: 4420 });
    expect(rows.find((r) => r.id === 'stall.heightLoss')?.worst?.value).toBeCloseTo(80, 0);
    expect(grade(rows)).toBe(4);
  });

  it('fails a height loss beyond the limit at test standard', () => {
    expect(grade(fly({ recoverAt: 5.3, climbAt: 12, minAlt: 4250 }))).toBe(1);
  });

  it('caps a late recovery start and a wing drop at 2', () => {
    expect(grade(fly({ recoverAt: 7.5, climbAt: 9, minAlt: 4420 }))).toBe(2);   // 2.5 s after the break
    expect(grade(fly({ recoverAt: 5.3, climbAt: 9, minAlt: 4420, bank: 30 }))).toBe(2);
  });

  it('fails a secondary stall within 10 s as a safety item', () => {
    const rows = fly({ recoverAt: 5.3, climbAt: 9, minAlt: 4420, secondAt: 11 });
    expect(rows.find((r) => r.id === 'stall.secondary')).toMatchObject({ grade: 1, safety: true });
    expect(grade(rows)).toBe(1);
  });

  it('measures an incipient recovery from the warning and fails it when the wing stalls', () => {
    const rows = fly({ recoverAt: 2.5, climbAt: 9, minAlt: 4420, incipient: true });
    expect(rows.find((r) => r.id === 'stall.recoveryStart')?.grade).toBe(3);   // 0.5 s after the warning
    expect(rows.find((r) => r.id === 'stall.atWarning')?.grade).toBe(1);       // but the wing still stalled at 5 s
    const late = fly({ recoverAt: 4.5, climbAt: 9, minAlt: 4420, incipient: true });
    expect(late.find((r) => r.id === 'stall.recoveryStart')?.grade).toBe(2);
  });

  it('has no result before a stall happened', () => {
    const g = new StallGrader({ tol, testTol: tol, standard: 'test', incipient: false });
    g.update({ altFt: 4500 }, 1, 0.1);
    expect(g.result()).toBeNull();
    expect(g.close()).toBeNull();
  });
});

describe('unusual-attitude grader', () => {
  const run = (kind: 'noseLow' | 'noseHigh', frames: (t: number) => Record<string, number>) => {
    const g = new UnusualAttitudeGrader({ kind: null, aircraft: TEST_AIRCRAFT, standard: 'test' });
    for (let i = 0; i < 200 && !g.result(); i++) g.update(frames(i * 0.1), 100 + i * 0.1, 0.1);
    void kind;
    return g.result() ?? g.close() ?? [];
  };

  it('passes a nose-low recovery flown power off, wings level, then pull', () => {
    const rows = run('noseLow', (t) => ({ pitchDeg: t < 4 ? -20 + t * 2 : -12 + (t - 4) * 4, bankDeg: Math.max(0, 45 - t * 20), gLoad: t < 3 ? 1.1 : 2.2, kias: 130, throttle: t < 0.5 ? 0.7 : 0 }));
    expect(rows.map((r) => r.grade)).toEqual([3, 3, 3, 3]);
    expect(rows[0].label).toMatch(/Nose-low/);
  });

  it('fails a nose-low recovery that pulls before levelling the wings', () => {
    const rows = run('noseLow', (t) => ({ pitchDeg: -20 + t * 3, bankDeg: 45, gLoad: 2.0, kias: 130, throttle: 0 }));
    expect(rows.find((r) => r.id === 'unusual.sequence')?.grade).toBe(1);
  });

  it('fails a nose-high recovery that lets the speed decay below Vs1 + 5', () => {
    const rows = run('noseHigh', (t) => ({ pitchDeg: 25 - t, bankDeg: 30, gLoad: 1, kias: 60 - t * 2, throttle: 0.6 }));
    expect(rows.find((r) => r.id === 'unusual.sequence')?.grade).toBe(1);
    expect(rows.find((r) => r.id === 'unusual.level')?.grade).toBe(1);
  });

  it('fails an overspeed as a safety item', () => {
    const rows = run('noseLow', (t) => ({ pitchDeg: -20 + t * 6, bankDeg: 0, gLoad: 1.2, kias: 170, throttle: 0 }));
    expect(rows.find((r) => r.id === 'unusual.vne')).toMatchObject({ grade: 1, safety: true });
  });

  it('runs inside the Grader from the first student frame', () => {
    const g = new Grader({ standards: STANDARDS, authority: 'easa', exercises: [ex('ua', 'assessed', 'test')], firstAttemptCounts: false });
    const ctx = new Ctx();
    ctx.enterStep();
    g.beginTask(task([unusualAttitude('ua', 'Recovery', { required: true }), stallRecovery('st', 'Stall', { required: false })], { exercise: 'ua' }), ctx);
    for (let i = 0; i < 100; i++) {
      ctx.tick(0.1, { pitchDeg: 25 - i, bankDeg: 0, gLoad: 1, kias: 80, throttle: 1 });
      g.sample(ctx);
    }
    const r = g.endTask('success', ctx);
    expect(r.criteria.filter((c) => c.id.startsWith('ua.')).every((c) => c.grade === 3)).toBe(true);
    expect(isInsufficient(r.criteria.find((c) => c.id === 'st')!)).toBe(true);
    expect(r.grade).toBe(3);
  });
});

describe('lesson outcome, stars and impression', () => {
  const L = lesson({
    id: 'L04', exercises: [ex('demo', 'demo', 'training', { required: false, weight: 0 }), ex('p', 'practice', 'training', { required: false }),
      ex('a1', 'assessed', 'test'), ex('a2', 'assessed', 'test')],
  });
  const base = (o: Partial<OutcomeInput> = {}): OutcomeInput => ({
    lesson: L, exercises: [exerciseResult('a1', 3), exerciseResult('a2', 2)], previous: null, assessedInterventions: 0, ended: 'completed', ...o,
  });

  it('is competent when every required exercise is at least 2, including sign-offs of the same version', () => {
    expect(lessonOutcome(base())).toBe('competent');
    expect(lessonOutcome(base({ exercises: [exerciseResult('a1', 3), exerciseResult('a2', 1)] }))).toBe('notYet');
    expect(lessonOutcome(base({ exercises: [exerciseResult('a1', 3)] }))).toBe('notYet');
    const previous = { status: 'available' as const, attempts: 1, bestStars: 0, lastOutcome: 'notYet' as const, exercises: { a2: { best: 2 as const, last: 2 as const } }, lessonVersion: 1 };
    expect(lessonOutcome(base({ exercises: [exerciseResult('a1', 3)], previous }))).toBe('competent');
    expect(lessonOutcome(base({ exercises: [exerciseResult('a1', 3)], previous: { ...previous, lessonVersion: 0 } }))).toBe('notYet');
    expect(lessonOutcome(base({ assessedInterventions: 1 }))).toBe('notYet');
  });

  it('needs everything within one run in a check lesson', () => {
    const previous = { status: 'available' as const, attempts: 1, bestStars: 0, lastOutcome: 'notYet' as const, exercises: { a2: { best: 3 as const, last: 3 as const } }, lessonVersion: 1 };
    expect(lessonOutcome(base({ lesson: { ...L, kind: 'check' }, exercises: [exerciseResult('a1', 3)], previous }))).toBe('notYet');
  });

  it('names abandoned, crashed and incomplete runs', () => {
    expect(lessonOutcome(base({ ended: 'abandoned' }))).toBe('abandoned');
    expect(lessonOutcome(base({ ended: 'crashed' }))).toBe('crashed');
    expect(lessonOutcome(base({ ended: 'timeUp' }))).toBe('incomplete');
    expect(lessonOutcome(base({ ended: 'crashed', lesson: { ...L, kind: 'test' } }))).toBe('testFail');
  });

  it('applies the skill-test section rules by authority', () => {
    const T = lesson({ id: 'L21', kind: 'test', exercises: [
      ex('s1', 'assessed', 'test', { testSection: 1 }), ex('s2', 'assessed', 'test', { testSection: 2 }), ex('s2b', 'assessed', 'test', { testSection: 2 }), ex('s3', 'assessed', 'test', { testSection: 3 })] });
    const all3 = ['s1', 's2', 's2b', 's3'].map((id) => exerciseResult(id, 3));
    const t = (exs: typeof all3, o: Partial<OutcomeInput> = {}) => lessonOutcome({ lesson: T, exercises: exs, previous: null, assessedInterventions: 0, ended: 'completed', ...o });
    expect(t(all3)).toBe('testPass');
    const oneSection = all3.map((e) => (e.exerciseId === 's2b' ? { ...e, grade: 1 as const } : e));
    expect(failedTestSections(T, oneSection)).toEqual([2]);
    expect(t(oneSection)).toBe('testPartial');
    expect(t(oneSection, { authority: 'faa' })).toBe('testFail');
    const twoSections = oneSection.map((e) => (e.exerciseId === 's3' ? { ...e, grade: null } : e));
    expect(t(twoSections)).toBe('testFail');
    expect(t(all3, { criticalFault: true })).toBe('testFail');
  });

  it('derives stars from the grades', () => {
    const stars = (grades: [1 | 2 | 3 | 4, 1 | 2 | 3 | 4], o: Partial<Parameters<typeof lessonStars>[0]> = {}) => {
      const i = base({ exercises: [exerciseResult('a1', grades[0]), exerciseResult('a2', grades[1])] });
      return lessonStars({ ...i, outcome: lessonOutcome(i), phaseRetries: 0, calmAir: false, assessedRemarks: 0, interventions: 0, ...o });
    };
    expect(stars([3, 2])).toBe(1);
    expect(stars([3, 3])).toBe(2);
    expect(stars([4, 4])).toBe(3);
    expect(stars([4, 4], { phaseRetries: 1 })).toBe(2);
    expect(stars([4, 4], { calmAir: true })).toBe(2);
    expect(stars([4, 4], { assessedRemarks: 1 })).toBe(2);
    expect(stars([4, 1])).toBe(0);
  });

  it('writes the overall impression as one labelled line', () => {
    expect(overallImpression(L, [exerciseResult('p', 2), exerciseResult('a1', 4), exerciseResult('a2', 3)])).toBe('Overall impression: Good (73/100)');
    expect(overallImpression(L, [])).toBe('Overall impression: not assessed');
  });
});

describe('debrief', () => {
  const step = task([
    hold('climbIas', 'Climb speed', 'asiKt', { vspeed: 'Vy' }, 'speedClimbApproach', { required: true }),
    peak('levelOff', 'Level-off overshoot', 'altFt', 3500, 'altitude', { peakOf: 'max', required: true, advice: { high: 'Start levelling at 10 % of the climb rate.' } }),
    binary('gate', 'Unstable below 200 ft', { const: false }, { required: true, safety: true, advice: { fail: 'You continued an unstable approach below 200 feet: go around every time.' } }),
  ], { exercise: 'a1' });
  const L = lesson({ id: 'L04', exercises: [ex('a1', 'assessed', 'test')], flow: [{ id: 'p', title: 'P', steps: [step] }],
    debriefTips: { 'levelOff.late': 'Anticipate: at 500 fpm start levelling 50 ft before the target.' }, lookAhead: 'Next lesson: medium turns.' });
  const ias = { ...sampleResult({ id: 'climbIas', label: 'Climb speed', kind: 'hold', required: true, safety: false }, 78, 74, 4, { minus: 5, plus: 15 }, { minus: 5, plus: 15 }, 'test'), grade: 4 as const, within: 1 };
  const lvl = sampleResult({ id: 'levelOff', label: 'Level-off overshoot', kind: 'peak', required: true, safety: false }, 3660, 3500, 160, sym(150), sym(150), 'test', { peakOf: 'max', sig: 'altFt' });
  const result = (outcome: LessonResult['outcome'], extra: CriterionResult[] = []): Omit<LessonResult, 'debrief'> => {
    const { debrief: _d, ...r } = lessonResult('L04', { outcome, exercises: [exerciseResult('a1', 1, { criteria: [...extra, ias, lvl] })] });
    void _d;
    return r;
  };

  it('praises the best criterion, makes the weakest the main point with the lesson tip, and looks ahead', () => {
    const d = buildDebrief(L, result('notYet'));
    expect(d.strength).toBe('Climb speed held within 4 kt.');
    expect(d.main).toBe('Level-off overshoot: 160 ft high against ±150 ft. Anticipate: at 500 fpm start levelling 50 ft before the target.');
    expect(d.next).toMatch(/concentrate on the level-off overshoot/);
    expect(d.spoken[0]).toMatch(/^Not yet competent/);
    expect(d.spoken.join(' ')).toContain('160 ft high');
    expect(d.spoken.join(' ').split(/\s+/).length).toBeLessThanOrEqual(60);
    expect(buildDebrief(L, result('competent')).next).toBe('Next lesson: medium turns.');
  });

  it('puts safety items first and never praises below grade 3', () => {
    const unsafe = passFailResult({ id: 'gate', label: 'Unstable below 200 ft', kind: 'binary', required: true, safety: true }, false, 'Failed at 40 s');
    const d = buildDebrief(L, result('notYet', [unsafe]));
    expect(d.main.startsWith('You continued an unstable approach below 200 feet')).toBe(true);
    const weak = buildDebrief(L, { ...result('notYet'), exercises: [exerciseResult('a1', 1, { criteria: [lvl] })] });
    expect(weak.strength).toBe('You kept at it.');
  });

  // Wave-3 playtest: "Nose raised 5°: done at 30 s" as the main point, and praise for "Unstable approach
  // continued below 200 ft: well done".
  it('never makes a passed pass/fail item the main point, and never praises a binary (fault-named) item', () => {
    const done = passFailResult({ id: 'nose', label: 'Nose raised 5°', kind: 'check', required: true, safety: false }, true, 'Done at 30 s');
    const kept = passFailResult({ id: 'gate', label: 'Unstable below 200 ft', kind: 'binary', required: true, safety: true }, true, 'Never broken');
    const onlyGates = buildDebrief(L, { ...result('competent'), exercises: [exerciseResult('a1', 3, { criteria: [kept, done] })] });
    expect(onlyGates.main).toBe('Nothing to fix today: keep flying it this accurately.');
    expect(onlyGates.strength).toBe('Nose raised 5°: well done.');
    const binaryOnly = buildDebrief(L, { ...result('competent'), exercises: [exerciseResult('a1', 3, { criteria: [kept] })] });
    expect(binaryOnly.strength).toBe('You kept at it.');
  });

  it('leads a crash debrief with what happened', () => {
    const d = buildDebrief(L, result('crashed'), 'Terrain impact at 80 kt, 987 fpm');
    expect(d.main.startsWith('What happened: terrain impact at 80 kt, 987 fpm.')).toBe(true);
    expect(d.spoken.slice(0, 2)).toEqual(["That flight ended in a crash. Let's talk about why.", 'What happened: terrain impact at 80 kt, 987 fpm.']);
  });
});

describe('a task cut short by a crash', () => {
  it('leaves never-broken binaries and end-of-task values ungraded, and grades a landing that never came as a crash', () => {
    const g = new Grader({ standards: STANDARDS, authority: 'easa', exercises: [ex('ex1', 'practice', 'training')], firstAttemptCounts: false });
    const ctx = new Ctx();
    const step = task([
      binary('rwy', 'Landed on the runway', { const: false }, { required: true, safety: true }),
      final('hdg', 'Roll-out heading', 'hdgDeg', 70, 'heading', { required: true }),
      landing('ldg', 'Landing', { required: true }),
    ]);
    ctx.enterStep();
    g.beginTask(step, ctx);
    for (let i = 0; i < 50; i++) {
      ctx.tick(0.1, { hdgDeg: 70 });
      g.sample(ctx);
    }
    const r = g.endTask('crash', ctx);
    expect(isInsufficient(r.criteria.find((c) => c.id === 'rwy')!)).toBe(true);
    expect(isInsufficient(r.criteria.find((c) => c.id === 'hdg')!)).toBe(true);
    const ldg = r.criteria.find((c) => c.id === 'ldg')!;
    expect(ldg.grade).toBe(1);
    expect(ldg.safety).toBe(true);
  });
});

describe('predicate integration', () => {
  it('evaluates activeWhen with nested timers every frame', () => {
    const g = new Grader({ standards: STANDARDS, authority: 'easa', exercises: [ex('ex1', 'practice', 'training')], firstAttemptCounts: false });
    const ctx = new Ctx();
    const step = task([hold('h', 'Hdg', 'hdgDeg', 90, 'heading', { settleS: 0, activeWhen: held(all(gt('asiKt', 60), near('altFt', 3000, 100)), 3), required: true })]);
    ctx.enterStep();
    g.beginTask(step, ctx);
    for (let i = 0; i < 100; i++) {
      // 40° off for the first 2.5 s (the 3 s held timer is still running), then on heading.
      ctx.tick(0.1, { asiKt: 90, altFt: 3000, hdgDeg: ctx.stepT <= 2.5 ? 130 : 90 });
      g.sample(ctx);
    }
    const r = g.endTask('success', ctx);
    expect(r.criteria[0].maxN).toBe(0);
  });
});

describe('debrief focus phrases (playtest 3: "concentrate on stayed on the paved surface")', () => {
  it('turns a done-label into the activity and gives a noun label its article', async () => {
    const { focusPhrase } = await import('../../src/training/grading/debrief');
    expect(focusPhrase('Stayed on the paved surface')).toBe('staying on the paved surface');
    expect(focusPhrase('Stopped before the hold line')).toBe('stopping before the hold line');
    expect(focusPhrase('Never switched to OFF')).toBe('never switching to OFF');
    expect(focusPhrase('Ball centred')).toBe('the ball centred');
    expect(focusPhrase('Run-up rpm')).toBe('the run-up rpm');
    expect(focusPhrase('Held the altitude')).toBe('holding the altitude');
  });
});
