// Round 7, item 5: flap extended above the top of the white arc (VfeFull) for more than 2 s is a graded fault
// in every lesson (a global rule in the runner, content/globalRules.ts), counted per exercise and shown in the
// debrief with the speed reached: minor in dual lessons, a failed item in the skill test. Real runner, grader
// and debrief; scripted signals.

import { describe, expect, it } from 'vitest';
import { TrainingBus } from '../../src/training/engine/bus';
import { elapsed, hold, task, wait } from '../../src/training/engine/dsl';
import { LessonRunner, type RunnerDeps, type RunnerHost } from '../../src/training/engine/runner';
import { faultSentence } from '../../src/training/grading/debrief';
import { failedTestSections, lessonOutcome } from '../../src/training/grading/results';
import { STANDARDS } from '../../src/training/grading/standards';
import { GLOBAL_FAULT_RULES } from '../../src/training/content/globalRules';
import type { ExerciseDef, Lesson, LessonResult, PhaseDef, SignalFrame, StartSpec, TelemetrySources, TrainingSettings } from '../../src/training/types';
import { FakeHost, ScriptedTelemetry, cruiseSignals, seededRng, testAircraft } from './fakes/runnerFakes';

const GROUND: StartSpec = { kind: 'ground', spot: 'holdA1', engine: 'running' };   // the student has control from the start
const SETTINGS: TrainingSettings = {
  authority: 'easa', talkativeness: 'normal',
  voice: { instructor: null, examiner: null, rate: 1, volume: 0.9, captions: true, captionsOnly: true },
  instructorSaves: true, liveBars: true, autoAck: false, logFreeFlights: false,
};

function exercises(kind: Lesson['kind']): ExerciseDef[] {
  return [
    { id: 'a', title: 'Slow flight', skill: 'slowFlight', mode: kind === 'dual' ? 'practice' : 'assessed', standard: kind === 'test' ? 'test' : 'training', required: true, weight: 1, ...(kind === 'test' ? { testSection: 2 as const } : {}) },
    { id: 'b', title: 'Descent', skill: 'descent', mode: kind === 'dual' ? 'practice' : 'assessed', standard: kind === 'test' ? 'test' : 'training', required: true, weight: 1, ...(kind === 'test' ? { testSection: 3 as const } : {}) },
  ];
}

const flown = (id: string, ex: string) => task({
  id, exercise: ex, brief: { text: `${ex}.` }, pf: 'student', card: { title: ex, targets: [] }, goal: elapsed(20), timeoutS: 60,
  criteria: [hold(`${id}.alt`, 'Altitude', 'altFt', 3000, 200, { required: true, settleS: 0 })],
});

function lesson(kind: Lesson['kind'], flow: PhaseDef[]): Lesson {
  return {
    id: 'T05', version: 1, number: 5, title: 'Flap limit', syllabusRef: { easa: 'Ex 10', faa: 'ACS' }, stage: 'handling',
    kind, persona: kind === 'test' ? 'examiner' : 'instructor', requires: [], aircraft: 'any', estMinutes: 10, start: GROUND, weather: { preset: 'calm' },
    rules: { coachLevel: kind === 'dual' ? 'full' : 'silent', autopilot: 'forbidden', maxTimeScale: 1, instructorSaves: true, maxDurationS: 1500 },
    briefing: { aim: 'Test.', points: ['One.'], numbers: [], tolerances: [], airmanship: [], keys: [], spoken: { text: 'Today.' } },
    exercises: exercises(kind), flow,
  };
}

class Harness {
  host = new FakeHost();
  tel = new ScriptedTelemetry();
  signals: SignalFrame = cruiseSignals();
  runner: LessonRunner;
  constructor(l: Lesson) {
    const deps: RunnerDeps = {
      aircraft: testAircraft(), standards: STANDARDS, authority: 'easa', lines: {}, rng: seededRng(5), telemetry: this.tel.asTelemetry(),
      bus: new TrainingBus(), settings: SETTINGS, demos: {}, progress: null, attempt: 1,
    };
    this.runner = new LessonRunner(l, this.host as unknown as RunnerHost, deps);
  }
  async start(): Promise<this> {
    await this.runner.begin();
    this.runner.startFlight();
    return this;
  }
  run(s: number, set: Partial<SignalFrame> = {}): void {
    Object.assign(this.signals, set);
    for (let i = 0; i < Math.round(s / 0.1); i++) this.runner.update(0.1, 0.1, { studentInput: false, signals: this.signals } as unknown as TelemetrySources);
  }
  finish(): LessonResult {
    this.runner.input('abandon');
    const r = this.runner.result();
    expect(r).not.toBeNull();
    return r!;
  }
}

const CLEAN = { flapsDeg: 0, kias: 100, asiKt: 100 };

describe('flapOverspeed: a global graded fault (item 5)', () => {
  it('is data: flap out above VfeFull for more than 2 s, minor in dual, failing the item in the test', () => {
    const r = GLOBAL_FAULT_RULES.find((g) => g.id === 'flapOverspeed')!;
    expect(r.forS).toBe(2);
    expect(r.severity).toEqual({ dual: 'minor', solo: 'minor', check: 'minor', test: 'failItem' });
    expect(testAircraft().vspeeds.VfeFull).toBe(85);
  });

  it('dual: 2 s or less is no fault; longer is one minor fault per episode, on the exercise, with the speed reached', async () => {
    const h = await new Harness(lesson('dual', [{ id: 'p', title: 'P', steps: [flown('t1', 'a'), flown('t2', 'b'), wait('w', { const: false })] }])).start();
    h.run(3, CLEAN);
    // 1.5 s at 95 KIAS with flap 10: inside the 2 s allowance.
    h.run(1.5, { flapsDeg: 10, kias: 95, asiKt: 95 });
    h.run(1, CLEAN);
    expect(h.runner.snapshot().faults.filter((f) => f.id === 'flapOverspeed')).toHaveLength(0);
    // 3 s with the speed rising to 99 KIAS: one fault, the worst speed kept up to date.
    h.run(1, { flapsDeg: 10, kias: 92, asiKt: 92 });
    h.run(1.5, { kias: 97, asiKt: 97 });
    h.run(1, { kias: 99, asiKt: 99 });
    h.run(1, { kias: 94, asiKt: 94 });
    h.run(1, CLEAN);
    // A second episode in the same exercise: a second fault.
    h.run(3, { flapsDeg: 20, kias: 90, asiKt: 90 });
    h.run(1, CLEAN);
    // Flap in the white arc is no fault.
    h.run(4, { flapsDeg: 30, kias: 84, asiKt: 84 });
    h.run(20, CLEAN);
    const res = h.finish();
    const a = res.exercises.find((e) => e.exerciseId === 'a')!;
    const faults = a.faults.filter((f) => f.id === 'flapOverspeed');
    expect(faults).toHaveLength(2);
    expect(faults.every((f) => f.severity === 'minor' && !f.failsItem)).toBe(true);
    expect(faults[0].value).toBe(99);
    expect(faults[0].detail).toBe('Flap extended at 99 KIAS, above the flap limit speed of 85 KIAS');
    expect(faults[1].value).toBe(90);
    // Two minor faults cap the exercise at 3 (spec fault handling); the hold itself was perfect.
    expect(a.grade).toBe(3);
    // The debrief names it with the speed.
    expect(res.debrief.main).toContain('The flap was out at 99 KIAS, above the flap limit of 85, in slow flight (twice).');
  });

  it('a lesson otherwise flown well: the fault is the main point, not "Nothing to fix today"', async () => {
    const h = await new Harness(lesson('dual', [{ id: 'p', title: 'P', steps: [flown('t1', 'a'), wait('w', { const: false })] }])).start();
    h.run(5, CLEAN);
    h.run(3, { flapsDeg: 10, kias: 97, asiKt: 97 });
    h.run(40, CLEAN);
    const res = h.finish();
    expect(res.debrief.main).toBe('The flap was out at 97 KIAS, above the flap limit of 85, in slow flight. Slow into the white arc before the flap goes down.');
  });

  it('the instructor flying is never the student\'s fault', async () => {
    const h = await new Harness(lesson('dual', [{ id: 'p', title: 'P', steps: [
      task({ id: 'demo', exercise: 'a', brief: { text: 'Watch.' }, pf: 'instructor', card: { title: 'a', targets: [] }, goal: elapsed(10), timeoutS: 30, criteria: [] }),
      wait('w', { const: false })] }])).start();
    h.run(1, CLEAN);
    expect(h.runner.authority.who).toBe('instructor');
    h.run(5, { flapsDeg: 10, kias: 100, asiKt: 100 });
    expect(h.runner.snapshot().faults.filter((f) => f.id === 'flapOverspeed')).toHaveLength(0);
  });

  it('between exercises it is charged to the exercise last flown, which is re-graded', async () => {
    const h = await new Harness(lesson('dual', [{ id: 'p', title: 'P', steps: [flown('t1', 'a'), wait('w', { const: false })] }])).start();
    h.run(25, CLEAN);
    expect(h.runner.position.stepId).toBe('w');
    h.run(3, { flapsDeg: 10, kias: 96, asiKt: 96 });
    h.run(1, CLEAN);
    const a = h.finish().exercises.find((e) => e.exerciseId === 'a')!;
    expect(a.faults.map((f) => f.id)).toEqual(['flapOverspeed']);
    expect(a.faults[0].value).toBe(96);
  });

  it('skill test: the item it happens in fails (and so its section), without the whole-test fail of a critical fault', async () => {
    const h = await new Harness(lesson('test', [{ id: 'p', title: 'P', steps: [flown('t1', 'a'), flown('t2', 'b'), wait('w', { const: false })] }])).start();
    h.run(5, CLEAN);
    h.run(3, { flapsDeg: 10, kias: 95, asiKt: 95 });
    h.run(60, CLEAN);
    const res = h.finish();
    const a = res.exercises.find((e) => e.exerciseId === 'a')!;
    const b = res.exercises.find((e) => e.exerciseId === 'b')!;
    expect(a.faults[0]).toMatchObject({ id: 'flapOverspeed', severity: 'minor', failsItem: true, value: 95 });
    expect(a.grade).toBe(1);
    expect(a.testGrade).toBe(1);
    expect(b.faults).toHaveLength(0);
    expect(b.grade).toBeGreaterThanOrEqual(3);
    expect(a.faults.some((f) => f.severity === 'critical')).toBe(false);
    // Section 2 (the item's) fails, section 3 passes: EASA partial pass, not a whole-test fail.
    const l = lesson('test', []);
    expect(failedTestSections(l, res.exercises)).toEqual([2]);
    expect(lessonOutcome({ lesson: l, exercises: res.exercises, previous: null, assessedInterventions: 0, ended: 'completed', criticalFault: false })).toBe('testPartial');
  });

  it('the debrief sentence counts episodes and names the worst', () => {
    const f = (value: number, atS: number) => ({ id: 'flapOverspeed', severity: 'minor' as const, atS, value, detail: `Flap extended at ${value} KIAS, above the flap limit speed of 85 KIAS` });
    expect(faultSentence([])).toBeNull();
    const ex = { exerciseId: 'x', title: 'Circuit', mode: 'practice' as const, standard: 'training' as const, grade: 3 as const, testGrade: 3 as const, criteria: [], attempts: 1, interventions: 0, faults: [f(91, 1), f(104, 9)] };
    expect(faultSentence([ex])).toBe('The flap was out at 104 KIAS, above the flap limit of 85, in circuit (twice). Slow into the white arc before the flap goes down.');
    expect(faultSentence([], [f(90, 2)])).toBe('The flap was out at 90 KIAS, above the flap limit of 85. Slow into the white arc before the flap goes down.');
  });
});
