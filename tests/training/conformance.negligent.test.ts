// Headless conformance, the NegligentStudent across the course (spec section 6.4.3; harness in
// conformanceRun.ts): every lesson flown 1.3 tolerances off its targets must not pass. L01 is excluded (a
// familiarisation lesson never fails on technique, section 4.1) and so are the challenges (they score, they
// never fail). Opt-in with the full suite (FS_CONFORMANCE=1): about 30 sim minutes per lesson.
//
// The outcome is checked both as the engine grades it and as section 3.4 aggregates the grades
// (conformanceRun.ts specGrades). Until the release pass the engine's Grader kept the best single task of an
// exercise, and a negligent student passed L07, L08, L10 and L14 on the task the bias did not touch; it now
// grades an attempt over every task of the phase run, as the spec says.
// Where the lesson's coach speaks (airwork with a coach level above silent), the transcript must show it
// speaking about the targets the student is missing.

import { describe, expect, it } from 'vitest';
import { lessonById } from '../../src/training/content/syllabus/index';
import { describeResult } from './headlessHost';
import { flyLesson, FULL_CONFORMANCE, LESSON_TIMEOUT_MS, passOutcome } from './conformanceRun';

/** Lessons and the coach topics a 1.3-tolerance bias must draw. */
const COACHED: Record<string, string[]> = {
  L03: ['altitude', 'speed'], L04: ['speed'], L05: ['altitude', 'speed'], L06: ['speed'], L12: ['speed'],
  L15: ['altitude'], L19: ['speed'], L20: ['altitude'], N1: ['circuitHeight'],
};
const IDS = ['L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09', 'L10', 'L11', 'L12', 'L13', 'L14', 'L15', 'L16', 'L17', 'L18', 'L19', 'L20', 'L21', 'N1'];

describe('NegligentStudent across the course (1.3 x tolerance bias)', () => {
  for (const id of IDS) {
    const l = lessonById(id);
    if (!l) throw new Error(`no lesson ${id}`);
    const run = FULL_CONFORMANCE ? it : it.skip;
    run(`${id} ${l.title} is not passed`, async () => {
      const r = await flyLesson(l, { student: { kind: 'bias', scale: 1.3 } });
      const why = `${describeResult(r.result)}\nsection 3.4 grades: ${JSON.stringify(r.spec.grades)}\ncoach: ${r.hints.join(', ')}`;
      expect(r.result?.outcome, why).not.toBe(passOutcome(l));
      expect(r.spec.outcome, why).not.toBe(passOutcome(l));
      for (const topic of COACHED[id] ?? []) expect(r.hints, why).toContain(topic);
    }, LESSON_TIMEOUT_MS * 2);
  }
});
