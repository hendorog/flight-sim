// Lesson-limit interventions in grading and the debrief: recorded on the exercise (count and limit ids),
// a discarded attempt still counts as an attempt, no grade 4 on that exercise (but no fail either: it is not a
// safety intervention), carried through closed()/restore(); the debrief names it in the main point. Also the
// ab initio coach timing (stage 1: first remark after 3 s, cooldowns halved).

import { describe, expect, it } from 'vitest';
import { Coach } from '../../src/training/engine/coach';
import { hold, task } from '../../src/training/engine/dsl';
import { buildDebrief, limitSentence } from '../../src/training/grading/debrief';
import { Grader } from '../../src/training/grading/grade';
import { STANDARDS } from '../../src/training/grading/standards';
import type { CoachRule, EvalContext, LessonResult, SignalFrame, TaskStep } from '../../src/training/types';
import { cruiseSignals, testAircraft } from './fakes/runnerFakes';
import { Ctx, ex, exerciseResult, lesson, lessonResult } from './gradingFixtures';

const step = (): TaskStep => ({
  kind: 'task', id: 't1', exercise: 'ex1', brief: 'x', card: { title: 'T', targets: [] }, goal: { const: false },
  criteria: [hold('alt', 'Altitude', 'altFt', 3000, 'altitude', { settleS: 0, required: true })],
});

/** Fly the task 20 s exactly on 3,000 ft (a grade 4) and close it. */
function flyPerfect(g: Grader, ctx: Ctx) {
  ctx.enterStep();
  g.beginTask(step(), ctx);
  for (let i = 0; i < 200; i++) {
    ctx.tick(0.1, { altFt: 3000 });
    g.sample(ctx);
  }
  return g.endTask('success', ctx);
}

describe('Grader: lesson-limit interventions', () => {
  const newGrader = () => new Grader({ standards: STANDARDS, authority: 'easa', exercises: [ex('ex1', 'practice', 'training', { required: true })], firstAttemptCounts: false });

  it('a perfect attempt after a limit intervention grades 3, not 4; the discarded attempt counts; not a fail', () => {
    const plain = newGrader();
    expect(flyPerfect(plain, new Ctx()).grade).toBe(4);

    const g = newGrader();
    const ctx = new Ctx();
    ctx.enterStep();
    g.beginTask(step(), ctx);
    ctx.tick(0.1, { altFt: 3000 });
    g.sample(ctx);
    g.abortTask();                                   // the limit intervention discards the attempt...
    g.recordLimitIntervention('ex1', 'bank');        // ...and is recorded
    const r = flyPerfect(g, ctx);
    expect(r.grade).toBe(3);
    expect(r.limitInterventions).toBe(1);
    expect(r.limitIds).toEqual(['bank']);
    const [res] = g.exerciseResults();
    expect(res.grade).toBe(3);
    expect(res.attempts).toBe(2);                    // the restarted attempt counts as one
    expect(res.interventions).toBe(0);               // not a safety intervention
    expect(g.limitInterventions).toBe(1);
  });

  it('caps attempts already closed, and survives closed() -> restore()', () => {
    const g = newGrader();
    const ctx = new Ctx();
    expect(flyPerfect(g, ctx).grade).toBe(4);
    g.recordLimitIntervention('ex1', 'pitch', false);
    expect(g.exerciseGrade('ex1')).toBe(3);
    const snap = g.closed();
    const h = newGrader();
    h.restore(snap);
    expect(h.exerciseResults()[0].limitInterventions).toBe(1);
    expect(h.exerciseResults()[0].grade).toBe(3);
    expect(h.exerciseResults()[0].attempts).toBe(1);   // not discarded: the attempt was closed
  });
});

describe('debrief: limit interventions', () => {
  it('limitSentence names how often and where', () => {
    const one = { ...exerciseResult('ex1', 3), title: 'Effects of controls', limitInterventions: 1 };
    expect(limitSentence([one])).toBe('I took control once when it went past the lesson limits (Effects of controls). Smaller, smoother inputs.');
    expect(limitSentence([{ ...one, limitInterventions: 3, limitIds: ['bankLeft', 'bankRight', 'bankLeft'] }]))
      .toBe('I took control three times when the bank went past the lesson limit (Effects of controls). Smaller, smoother inputs.');
    expect(limitSentence([{ ...one, limitInterventions: 2, limitIds: ['bankLeft', 'pitchUp'] }])).toMatch(/^I took control twice when the bank and the pitch went past the lesson limits \(Effects/);
    expect(limitSentence([one, { ...one, exerciseId: 'ex2' }])).toMatch(/^I took control twice when it went past the lesson limits\. /);
    expect(limitSentence([{ ...one, limitInterventions: 0 }])).toBeNull();
  });

  it('the main point carries it', () => {
    const L = lesson({ id: 'L01', exercises: [ex('ex1', 'practice', 'training')] });
    const r: Omit<LessonResult, 'debrief'> = { ...lessonResult('L01'), exercises: [{ ...exerciseResult('ex1', 3), limitInterventions: 2 }], limitInterventions: 2 };
    const d = buildDebrief(L, r);
    expect(d.main).toMatch(/I took control twice/);
  });
});

// ---- ab initio coach --------------------------------------------------------------------------------------

function ctxOf(frame: SignalFrame): EvalContext & { frame: SignalFrame; simT: number; dt: number; stepT: number } {
  return {
    frame, vars: {}, aircraft: testAircraft(), fieldElevFt: 394, standards: STANDARDS, authority: 'easa', standard: 'training',
    events: { mark: () => 0, since: () => [] }, stepMark: 0, stepT: 0, dt: 0, simT: 0, pilot: 'student', speechIdle: true, exerciseGrade: () => null,
    signalDef: (id) => ({ id, kind: 'number', unit: '', hyst: 0, describe: '' }),
  };
}

describe('Coach: ab initio timing', () => {
  const rule = (id: string, topic: string): CoachRule => ({
    id, topic, when: { sig: 'altFt', op: '>', v: 3100 }, afterS: 8, say: [{ text: `${id} high` }], priority: 2, minLevel: 'full',
  });

  function remarkTimes(abInitio: boolean, talk: 'normal' | 'quiet' = 'normal'): number[] {
    const ctx = ctxOf({ ...cruiseSignals(), altFt: 3000 });
    const coach = new Coach({ talkativeness: talk, rate: () => 0, abInitio });
    coach.setLevel('full');
    coach.beginPhase();
    coach.beginTask(task({ id: 't', exercise: 'ex', brief: 'x', card: { title: 'T', targets: [] }, goal: { const: false }, criteria: [], coach: [rule('a', 'alt'), rule('b', 'alt2')] }), ctx);
    const out: number[] = [];
    ctx.frame.altFt = 3200;
    for (let i = 0; i < 200; i++) {
      ctx.dt = 0.1;
      ctx.simT = Math.round((ctx.simT + 0.1) * 1000) / 1000;
      ctx.stepT += 0.1;
      if (coach.update(ctx, true, true)) out.push(ctx.simT);
    }
    return out;
  }

  it('the first remark on a deviation comes after 3 s instead of afterS, and the global gap is halved', () => {
    const normal = remarkTimes(false);
    const ab = remarkTimes(true);
    const near = (x: number, v: number) => expect(Math.abs(x - v)).toBeLessThanOrEqual(0.15);
    near(normal[0], 8);
    near(ab[0], 3);
    // Two topics: the second waits the global gap (8 s normally, 4 s ab initio).
    near(normal[1] - normal[0], 8);
    near(ab[1] - ab[0], 4);
  });

  it('talkativeness still scales it', () => {
    expect(Math.abs(remarkTimes(true, 'quiet')[0] - 6)).toBeLessThanOrEqual(0.15);
  });
});
