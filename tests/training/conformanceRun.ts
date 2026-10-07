// Shared harness of the headless conformance suite (spec section 6.4.3): fly one lesson with the real
// engine (tests/training/headlessHost.ts) and a scripted student (tests/training/autoStudent.ts), and collect
// what the assertions need: the result, the sim time flown, every demonstration's result, crashes,
// interventions and the coach's remark topics.

import { expect } from 'vitest';
import { C172S } from '../../src/training/aircraft/c172s';
import { lessonById } from '../../src/training/content/syllabus/index';
import type { ExerciseResult, Grade, Lesson, LessonResult, TrainingEventRecord } from '../../src/training/types';
import { AutoStudent, type Negligence } from './autoStudent';
import { describeResult, HeadlessLesson, type HeadlessOptions } from './headlessHost';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
/** Fly every lesson (opt-in: FS_CONFORMANCE=1); otherwise only the QUICK set. */
export const FULL_CONFORMANCE = env.FS_CONFORMANCE === '1';
/**
 * The default set, one of each kind of flying: upper-air work with level-offs (L04), a landing from final (L09),
 * engine failures in the circuit (L12) and steep turns with a spiral-dive recovery (L15).
 */
export const QUICK = new Set(['L04', 'L09', 'L12', 'L15']);
/** Per-lesson wall-clock budget of a test, ms (the longest lessons fly about an hour of sim time). */
export const LESSON_TIMEOUT_MS = 300_000;

export function lesson(id: string): Lesson {
  const l = lessonById(id);
  if (!l) throw new Error(`no lesson ${id}`);
  return l;
}

export interface LessonRun {
  h: HeadlessLesson;
  student: AutoStudent | null;
  result: LessonResult | null;
  /** Sim time flown, s (the runner's run time). */
  simS: number;
  demos: ('done' | 'aborted' | 'timeout')[];
  interventions: { rule: string }[];
  /** Coach remark topics, in order (the 'hint' events). */
  hints: string[];
  crashes: string[];
  /** Sim time in task steps with the student in control, s (the coach's audience). */
  studentTaskS: number;
  /** Every closed attempt, tagged with the run of its phase it was flown in (1, 2, ...). */
  attempts: { ex: string; run: number; r: ExerciseResult }[];
  /** The exercise grades and outcome aggregated as section 3.4 states them (see specGrades). */
  spec: { grades: Record<string, Grade | null>; outcome: LessonResult['outcome'] };
}

/**
 * Section 3.4 aggregation, computed independently of the engine as a cross-check: "exercise grade = minimum
 * over its required criteria across the task steps that scored it in the attempt", the attempt being one run
 * of the phase; the best run counts (the first in check and test lessons). An attempt with no required
 * criterion scores nothing; one with a required criterion short of data leaves its run ungraded. Since the
 * release pass the engine's Grader (src/training/grading/grade.ts) applies the same rule itself (an attempt
 * per phase run, re-graded as its tasks close), so here each run normally holds one attempt.
 */
export function specGrades(l: Lesson, attempts: { ex: string; run: number; r: ExerciseResult }[]): LessonRun['spec'] {
  const grades: Record<string, Grade | null> = {};
  const firstCounts = l.kind === 'check' || l.kind === 'test';
  for (const ex of new Set(attempts.map((a) => a.ex))) {
    const runs = new Map<number, (Grade | null)[]>();
    for (const a of attempts) {
      if (a.ex !== ex || !a.r.criteria.some((c) => c.required)) continue;
      runs.set(a.run, [...(runs.get(a.run) ?? []), a.r.grade]);
    }
    const perRun = [...runs.values()].map((gs) => (gs.some((g) => g === null) ? null : (Math.min(...(gs as number[])) as Grade)));
    grades[ex] = firstCounts ? (perRun[0] ?? null) : perRun.reduce<Grade | null>((b, g) => (g !== null && (b === null || g > b) ? g : b), null);
  }
  const ok = l.exercises.filter((e) => e.required).every((e) => (grades[e.id] ?? 0) >= 2);
  return { grades, outcome: ok ? passOutcome(l) : l.kind === 'test' ? 'testFail' : 'notYet' };
}

export interface FlyOptions extends HeadlessOptions {
  /** The student: the AutoStudent (default), a negligent one, or nobody. */
  student?: 'auto' | Negligence | null;
  /** Stop after this much sim time even if the lesson is still running (default: maxDurationS + 120). */
  maxSimS?: number;
  /** Called every frame (e.g. to snapshot for a reload). Return true to stop flying. */
  onFrame?: (h: HeadlessLesson, t: number) => boolean | void;
}

/** Fly a lesson headless and collect what the conformance assertions read. */
export async function flyLesson(lesson: Lesson, opts: FlyOptions = {}): Promise<LessonRun> {
  const h = new HeadlessLesson(lesson, opts);
  const kind = opts.student === undefined ? 'auto' : opts.student;
  const student = kind === null ? null : new AutoStudent({ physics: h.physics, aircraft: C172S, negligence: kind === 'auto' ? null : kind });
  h.setStudent(student);
  await h.begin();
  let stop = false;
  const max = opts.maxSimS ?? lesson.rules.maxDurationS + 120;
  let t = 0;
  // Attempts close at task exits, which are step changes: collect them there, tagged with the phase run in
  // which each first appeared. The Grader re-grades an attempt in place as later tasks of the same phase run
  // add to it (section 3.4), so a known attempt is refreshed rather than added again.
  const attempts: LessonRun['attempts'] = [];
  const known = new Map<string, LessonRun['attempts'][number]>();
  const collect = (run: number): void => {
    for (const [ex, list] of Object.entries(h.runner.grader.closed())) {
      list.forEach((r, i) => {
        const a = known.get(`${ex}#${i}`);
        if (a && a.run === run) a.r = r;
        // Same slot, another phase run: unchanged, or a new attempt after a retry rewound the closed list.
        else if (a && JSON.stringify(a.r) === JSON.stringify(r)) return;
        else {
          const fresh = { ex, run, r };
          known.set(`${ex}#${i}`, fresh);
          attempts.push(fresh);
        }
      });
    }
  };
  let phaseRun = 0;
  let stepRun = 0;
  let lastPhase = '';
  let lastStep = '';
  let lastIdx = -1;
  let studentTaskS = 0;
  while (!stop && t < max && h.runner.phase === 'running') {
    h.frame();
    t += 1 / 30;
    const st = h.runner.currentStep;
    const pos = h.runner.position;
    const key = st ? `${pos.phaseId}/${st.def.id}` : '';
    if (key !== lastStep) {
      collect(stepRun);
      // A new run of a phase: another phase, or the same phase from an earlier step (repeat, retry).
      const idx = lesson.flow.find((p) => p.id === pos.phaseId)?.steps.findIndex((x) => x.id === st?.def.id) ?? -1;
      if (pos.phaseId !== lastPhase || idx < lastIdx) phaseRun++;
      [lastPhase, lastStep, lastIdx, stepRun] = [pos.phaseId, key, idx, phaseRun];
    }
    if (st?.def.kind === 'task' && st.status === 'active' && h.runner.authority.who === 'student') studentTaskS += 1 / 30;
    if (opts.onFrame?.(h, t)) stop = true;
    await Promise.resolve();
    await Promise.resolve();
  }
  collect(stepRun);
  const of = <K extends TrainingEventRecord['type']>(type: K) => h.log.filter((r) => r.type === type) as TrainingEventRecord<K>[];
  return {
    h, student,
    result: h.ended?.result ?? h.runner.result(),
    simS: h.runner.evalContext.simT,
    demos: of('demo.done').map((r) => r.data.result),
    interventions: of('intervention').map((r) => r.data),
    hints: of('hint').map((r) => r.data.topic),
    crashes: [...h.crashes],
    studentTaskS, attempts, spec: specGrades(lesson, attempts),
  };
}

/** The outcome a lesson must reach when flown well. */
export function passOutcome(lesson: Lesson): LessonResult['outcome'] {
  return lesson.kind === 'test' ? 'testPass' : 'competent';
}

/**
 * The AutoStudent's assertions for one lesson: competent (testPass) within maxDurationS, no crash, no
 * intervention, every demonstration done.
 */
export async function expectCompetent(l: Lesson): Promise<void> {
  const run = await flyLesson(l);
  const why = describeResult(run.result);
  expect(run.crashes, why).toEqual([]);
  expect(run.result?.outcome, why).toBe(passOutcome(l));
  expect(run.simS, why).toBeLessThanOrEqual(l.rules.maxDurationS);
  expect(run.interventions, why).toEqual([]);
  expect(run.demos.every((d) => d === 'done'), `${why}\ndemos: ${run.demos.join(', ')}`).toBe(true);
  // Passable as section 3.4 aggregates the grades, not only by the engine's best single task.
  expect(run.spec.outcome, `${why}\nsection 3.4 grades: ${JSON.stringify(run.spec.grades)}`).toBe(passOutcome(l));
  // The coach does not nag a student who flies well (wave-3 calibration: at most one remark per two minutes).
  const perMin = run.studentTaskS > 0 ? run.hints.length / (run.studentTaskS / 60) : 0;
  expect(perMin, `${why}\ncoach remarks: ${run.hints.join(', ')}`).toBeLessThanOrEqual(MAX_REMARKS_PER_MIN_GOOD);
}

/** The most coach remarks per minute of student flying a lesson flown well may draw. */
export const MAX_REMARKS_PER_MIN_GOOD = 0.5;
