// The course: L01-L20, the skill test L21, and the N1 night rating (section 4.1), in syllabus order.
// Challenges (section 4.3) are separate lessons, exported as CHALLENGES and not part of SYLLABUS.

import type { Lesson } from '../../types';
import { RATINGS } from './ratings';
import { STAGE1 } from './stage1';
import { STAGE2 } from './stage2';
import { STAGE3 } from './stage3';
import { STAGE4 } from './stage4';

import { CHALLENGES } from './challenges';

export { CHALLENGES };
export { RATINGS } from './ratings';
export { STAGE1 } from './stage1';
export { STAGE2 } from './stage2';
export { STAGE3 } from './stage3';
export { STAGE4 } from './stage4';

export const SYLLABUS: readonly Lesson[] = [...STAGE1, ...STAGE2, ...STAGE3, ...STAGE4, ...RATINGS];

/** A lesson by id (the course, the rating, or a challenge's lesson); undefined when unknown. */
export function lessonById(id: string): Lesson | undefined {
  return SYLLABUS.find((l) => l.id === id) ?? CHALLENGES.find((c) => c.lesson.id === id)?.lesson;
}
