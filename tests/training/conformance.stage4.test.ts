// Headless conformance, stage 4 and ratings (spec section 6.4.3; harness in conformanceRun.ts): the
// AutoStudent flies each lesson with the real engine and flight model and must end competent (the skill test
// testPass) within maxDurationS, with no crash, no intervention and every demonstration done. The default run
// flies the QUICK lessons only; FS_CONFORMANCE=1 flies all of them.

import { describe, it } from 'vitest';
import { CHALLENGES, lessonById } from '../../src/training/content/syllabus/index';
import { expectCompetent, FULL_CONFORMANCE, LESSON_TIMEOUT_MS, QUICK } from './conformanceRun';

const IDS = ['L20', 'L21', 'N1', 'C01', 'C02', 'C03', 'C04'];

describe('AutoStudent: Stage 4 and ratings: navigation, the skill test, night circuits and the challenges', () => {
  for (const id of IDS) {
    const l = lessonById(id) ?? CHALLENGES.find((c) => c.id === id)?.lesson;
    if (!l) throw new Error(`no lesson ${id}`);
    const run = FULL_CONFORMANCE || QUICK.has(id) ? it : it.skip;
    run(`${l.id} ${l.title}`, () => expectCompetent(l), LESSON_TIMEOUT_MS);
  }
});
