// Headless conformance (spec section 6.4.3): the real flight model, LessonRunner, copilot, telemetry,
// grader and speech scheduler (captions backend on a simulated clock), no DOM.
//
//   - AutoStudent: every lesson and challenge, flown by the scripted student, ends competent (the skill test
//     testPass) within its maxDurationS, without a crash or an instructor intervention, and every
//     demonstration it contains completes ('done').
//   - NegligentStudent: biased targets (+1.3 x tolerance) and oscillation (+-2 x tolerance) end notYet with the
//     matching coach topics in the transcript; a 70 degree bank brings the instructor's intervention.
//   - Reload mid-lesson: the resume block taken mid-practice rebuilds the runner at the same step on a restored
//     flight, which then finishes the lesson.
//
// The lessons themselves are flown in conformance.stage{1,2,3,4}.test.ts (one file per stage so the vitest
// workers fly them in parallel). Running time: each lesson is several sim minutes of 240 Hz physics (about
// 15-60 s of CPU); the default run flies a representative set (conformanceRun.ts QUICK) and FS_CONFORMANCE=1
// flies every lesson and challenge (about 15 minutes of CPU).

import { describe, expect, it } from 'vitest';
import type { FlightSnapshot } from '../../src/sim/resume';
import type { RunSnapshot } from '../../src/training/types';
import { describeResult } from './headlessHost';
import { flyLesson, lesson, LESSON_TIMEOUT_MS } from './conformanceRun';

describe('NegligentStudent', () => {
  it('flying 1.3 tolerances off every target ends L03 notYet, with the coach on altitude and speed', async () => {
    const run = await flyLesson(lesson('L03'), { student: { kind: 'bias', scale: 1.3 } });
    expect(run.result?.outcome, describeResult(run.result)).toBe('notYet');
    expect(run.hints).toContain('altitude');
    expect(run.hints).toContain('speed');
  }, LESSON_TIMEOUT_MS);

  it('oscillating two tolerances either side of the targets ends L04 notYet, with the coach on speed', async () => {
    const run = await flyLesson(lesson('L04'), { student: { kind: 'oscillate', scale: 2, periodS: 40 } });
    expect(run.result?.outcome, describeResult(run.result)).toBe('notYet');
    expect(run.hints).toContain('speed');
  }, LESSON_TIMEOUT_MS);

  it('a 70 degree bank in the medium turns brings the instructor in ("I have control!")', async () => {
    const run = await flyLesson(lesson('L05'), {
      student: { kind: 'overbank', bankDeg: 70 },
      onFrame: (h) => h.log.some((r) => r.type === 'intervention'),
    });
    expect(run.interventions.map((i) => i.rule)).toContain('bank');
    expect(run.h.captions).toContain('I have control!');
  }, LESSON_TIMEOUT_MS);
});

describe('reload mid-lesson (section 3.10)', () => {
  it('L04: the flight and the run snapshot taken mid-practice resume at the same step and finish competent', async () => {
    const l = lesson('L04');
    // Fly until the student is well into the first practice climb, then "reload": snapshot and stop.
    let snap: { flight: FlightSnapshot; run: RunSnapshot } | null = null;
    const first = await flyLesson(l, {
      onFrame: (h) => {
        const step = h.runner.currentStep;
        if (step?.def.id === 'climb' && step.status === 'active' && h.runner.evalContext.stepT > 30) {
          // Through JSON, as localStorage holds them.
          snap = { flight: JSON.parse(JSON.stringify(h.capture())) as FlightSnapshot, run: JSON.parse(JSON.stringify(h.runner.snapshot())) as RunSnapshot };
          return true;
        }
        return false;
      },
    });
    expect(first.result).toBeNull();
    expect(snap).not.toBeNull();
    const s = snap as unknown as { flight: FlightSnapshot; run: RunSnapshot };
    const resumed = await flyLesson(l, { resume: { flight: s.flight, run: s.run }, maxSimS: 1200 - s.run.elapsedSimS });
    expect(resumed.h.runner.resumed).toBe(true);
    expect(resumed.h.captions[0]).toBe('Right, where were we.');
    // The same step, entered again.
    const enters = resumed.h.log.filter((r) => r.type === 'step.enter').map((r) => (r.data as { step: string }).step);
    expect(enters[0]).toBe('climb');
    expect(resumed.result?.outcome, describeResult(resumed.result)).toBe('competent');
    expect(resumed.result?.exercises.find((e) => e.exerciseId === 'assessedClimb')?.grade).toBeGreaterThanOrEqual(2);
  }, LESSON_TIMEOUT_MS);
});
