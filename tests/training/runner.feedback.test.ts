// LessonRunner instructor feedback and lesson limits (owner's L01 playtest: "no feedback from the instructor
// while the lesson is in progress"; "the instructor should take control back if the limits are exceeded,
// restore straight and level and then hand back over"). Fake host, scripted signals, recording grader:
//   - TaskFeedback: start line after the brief; milestones once each, in order, 2 s apart; success line before
//     onSuccess; nudges after silence and at most every everyS.
//   - TaskLimit: exceeded for forS -> "I have control" (Safety) + the limit line, queued speech dropped, the
//     copilot restores straight and level at the task reference; stable -> teaching line -> three-way
//     handover -> the task restarts (a new attempt); the attempts-th intervention fails the task with onFail.
//     Not a safety intervention; the safety envelope still takes precedence; saves off -> only a fault.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/training/grading/grade', async () => ({ Grader: (await import('./fakes/runnerFakes')).FakeGrader }));
vi.mock('../../src/training/grading/results', async () => {
  const f = await import('./fakes/runnerFakes');
  return { lessonOutcome: f.fakeLessonOutcome, lessonStars: f.fakeLessonStars, overallImpression: () => '' };
});
vi.mock('../../src/training/grading/debrief', async () => ({ buildDebrief: (await import('./fakes/runnerFakes')).fakeBuildDebrief }));
vi.mock('../../src/training/engine/events', async () => {
  const f = await import('./fakes/runnerFakes');
  return { DerivedEventDetector: f.NullDetector, LandingDetector: f.NullDetector, touchdownData: () => null };
});

import { TrainingBus } from '../../src/training/engine/bus';
import { end, gt, held, task, wait } from '../../src/training/engine/dsl';
import { LessonRunner, RUNNER_LINES, isAbInitio, type RunnerDeps, type RunnerHost } from '../../src/training/engine/runner';
import { STANDARDS } from '../../src/training/grading/standards';
import {
  Priority,
  type ExerciseDef, type Lesson, type PhaseDef, type SignalFrame, type StartSpec, type TaskStep, type TelemetrySources,
  type TrainingEventRecord, type TrainingSettings,
} from '../../src/training/types';
import { FakeGrader, FakeHost, ScriptedTelemetry, cruiseSignals, outcomeCalls, seededRng, testAircraft } from './fakes/runnerFakes';

const EX: ExerciseDef[] = [{ id: 'ex', title: 'Effects of controls', skill: 'effectsOfControls', mode: 'practice', standard: 'training', required: true, weight: 1 }];
const GROUND: StartSpec = { kind: 'ground', spot: 'holdA1', engine: 'running' };   // dual + ground: the student has control

function lesson(flow: PhaseDef[], over: Partial<Lesson> = {}): Lesson {
  return {
    id: 'L01', version: 1, number: 1, title: 'Effects of controls', syllabusRef: { easa: 'Ex 4', faa: 'ACS' }, stage: 'handling',
    kind: 'dual', persona: 'instructor', requires: [], aircraft: 'any', estMinutes: 10, start: GROUND, weather: { preset: 'calm' },
    rules: { coachLevel: 'full', autopilot: 'forbidden', maxTimeScale: 1, instructorSaves: true, maxDurationS: 1500 },
    briefing: { aim: 'Test.', points: ['One.'], numbers: [], tolerances: [], airmanship: [], keys: [], spoken: { text: 'Today.' } },
    exercises: EX, flow, ...over,
  };
}

const SETTINGS: TrainingSettings = {
  authority: 'easa', talkativeness: 'normal',
  voice: { instructor: null, examiner: null, rate: 1, volume: 0.9, captions: true, captionsOnly: true },
  instructorSaves: true, liveBars: true, autoAck: false, logFreeFlights: false,
};

class Harness {
  host = new FakeHost();
  tel = new ScriptedTelemetry();
  bus = new TrainingBus();
  signals: SignalFrame = cruiseSignals();
  events: TrainingEventRecord[] = [];
  runner: LessonRunner;

  constructor(readonly lesson: Lesson, settings: Partial<TrainingSettings> = {}) {
    this.bus.on('*', (r) => this.events.push(r));
    const deps: RunnerDeps = {
      aircraft: testAircraft(), standards: STANDARDS, authority: 'easa', lines: {}, rng: seededRng(7),
      telemetry: this.tel.asTelemetry(), bus: this.bus, settings: { ...SETTINGS, ...settings }, demos: {}, progress: null, attempt: 1,
    };
    this.runner = new LessonRunner(lesson, this.host as unknown as RunnerHost, deps);
  }

  async start(): Promise<this> {
    await this.runner.begin();
    this.runner.startFlight();
    return this;
  }

  tick(dt = 0.1): void {
    this.runner.update(dt, dt, { studentInput: false, signals: this.signals } as unknown as TelemetrySources);
  }

  run(seconds: number, dt = 0.1): void {
    for (let i = 0, n = Math.round(seconds / dt); i < n; i++) this.tick(dt);
  }

  set(s: Partial<SignalFrame>): void {
    Object.assign(this.signals, s);
  }

  get step(): string {
    return this.runner.position.stepId;
  }

  get grader(): FakeGrader {
    return FakeGrader.last;
  }

  get captions(): string[] {
    return this.host.speech.captions;
  }

  /** Sim time each caption was said at (transcript order). */
  at(text: string): number[] {
    return this.host.speech.transcript.filter((c) => c.text === text).map((c) => c.atSim);
  }

  said(text: string): number {
    return this.captions.filter((c) => c === text).length;
  }

  stepExits(): { step: string; result: string }[] {
    return this.events.filter((e) => e.type === 'step.exit').map((e) => {
      const d = e.data as { step: string; result: string };
      return { step: d.step, result: d.result };
    });
  }

  /** Steady straight and level at the reference (what the copilot's restore produces). */
  level(): void {
    this.set({ bankDeg: 0, aiBankDeg: 0, vsFpm: 0, vsiFpm: 0, kias: 100, asiKt: 100, pitchDeg: 2, aiPitchDeg: 2 });
  }

  /** Stable for 3 s, the teaching line, then Enter on "You have control" and the release frame. */
  async restoreAndTakeBack(): Promise<void> {
    this.level();
    this.run(3.2);
    this.run(0.7);   // the explanation is heard (speech idle), then the offer
    expect(this.runner.authority.handover).toBe('offered');
    this.runner.input('ack');
    this.tick();
  }
}

beforeEach(() => {
  FakeGrader.instances.length = 0;
  outcomeCalls.length = 0;
});

// =============================================================================================================

describe('TaskFeedback', () => {
  const START = 'Go ahead: raise the nose ten degrees.';
  const M1 = "That's it, the nose is coming up.";
  const M2 = 'Nearly there.';
  const M3 = 'Watch the speed falling as the nose rises.';
  const SUCCESS = "Good. That's the primary effect of elevator.";
  const ON_SUCCESS = 'Now lower it again.';
  const NUDGE = 'Keep going: a little more back pressure.';

  const feedbackTask = (): TaskStep => task({
    id: 'raise', exercise: 'ex', brief: { text: 'Raise the nose.' },
    card: { title: 'Elevator', targets: [{ label: 'PITCH', sig: 'pitchDeg', value: 10, unit: 'deg' }] },
    goal: held(gt('pitchDeg', 10), 1), timeoutS: 120, criteria: [],
    feedback: {
      start: { text: START },
      milestones: [
        { id: 'up', when: gt('pitchDeg', 4), cue: { text: M1 } },
        { id: 'nearly', when: gt('pitchDeg', 7), cue: { text: M2 } },
        { id: 'speed', when: gt('pitchDeg', 4), cue: { text: M3 }, minT: 30 },
      ],
      success: { text: SUCCESS },
      nudge: { cue: { text: NUDGE }, afterS: 4, everyS: 6 },
    },
    onSuccess: { cue: { text: ON_SUCCESS } },
  });

  it('start after the brief; nudges after silence and no closer than everyS; milestones once, in order, 2 s apart; success before onSuccess', async () => {
    const h = await new Harness(lesson([{ id: 'p', title: 'P', steps: [feedbackTask(), wait('after', { const: false })] }])).start();
    h.tick();
    expect(h.step).toBe('raise');
    expect(h.captions.slice(0, 2)).toEqual(['Raise the nose.', START]);

    // Nothing happens: a nudge after 4 s of silence. The next one, 6 s later, may not repeat its words
    // (owner playtest, decision 4): with nothing new to say she offers help instead, once.
    h.run(11);
    const nudges = h.at(NUDGE);
    expect(nudges).toHaveLength(1);
    expect(nudges[0]).toBeGreaterThanOrEqual(4);
    expect(nudges[0]).toBeLessThan(4.5);
    const help = h.at(RUNNER_LINES['runner.taskHelpSayAgain'].text as string);
    expect(help).toHaveLength(1);
    expect(help[0] - nudges[0]).toBeGreaterThanOrEqual(6);
    const nudgeReq = h.host.speech.requests.find((r) => r.caption === NUDGE);
    expect(nudgeReq?.priority).toBe(Priority.Coach);

    // One condition, then the next: each said, in order, at least 2 s apart.
    h.set({ pitchDeg: 5 });
    h.run(0.2);
    expect(h.said(M1)).toBe(1);
    h.set({ pitchDeg: 8 });
    h.run(0.2);
    expect(h.said(M2)).toBe(0);
    h.run(2);
    expect(h.said(M2)).toBe(1);
    const [m1] = h.at(M1);
    const [m2] = h.at(M2);
    expect(m2 - m1).toBeGreaterThanOrEqual(2);
    expect(h.captions.indexOf(M1)).toBeLessThan(h.captions.indexOf(M2));
    expect(h.host.speech.requests.find((r) => r.caption === M1)?.priority).toBe(Priority.Coach);

    // Once each: down and up again says nothing new; the minT milestone waits for 30 s into the task.
    h.set({ pitchDeg: 2 });
    h.run(1);
    h.set({ pitchDeg: 8 });
    h.run(3);
    expect(h.said(M1)).toBe(1);
    expect(h.said(M2)).toBe(1);
    expect(h.said(M3)).toBe(0);
    h.run(14);
    expect(h.said(M3)).toBe(1);
    const nudgesBefore = h.at(NUDGE).length;

    // Goal: the success line, then onSuccess's cue; no nudge after the goal.
    h.set({ pitchDeg: 11 });
    h.run(1.3);
    expect(h.step).toBe('after');
    const iS = h.captions.indexOf(SUCCESS);
    const iO = h.captions.indexOf(ON_SUCCESS);
    expect(iS).toBeGreaterThan(-1);
    expect(iS).toBeLessThan(iO);
    h.run(20);
    expect(h.at(NUDGE).length).toBe(nudgesBefore);
    expect(h.said(M1)).toBe(1);
  });

  it('milestones wait for a quiet moment instead of queueing behind the brief; only the latest is then said', async () => {
    const h = new Harness(lesson([{ id: 'p', title: 'P', steps: [feedbackTask()] }]));
    await h.start();
    h.host.speech.hold = true;      // the brief is still being spoken
    h.set({ pitchDeg: 8 });
    h.run(3);
    expect(h.said(M1)).toBe(0);
    h.host.speech.hold = false;
    h.host.speech.finishAll();
    h.run(0.2);
    // Both hold: the student is already past the first, so only the second is said, and the first never is.
    expect(h.said(M2)).toBe(1);
    h.run(5);
    expect(h.said(M1)).toBe(0);
  });

  it('a milestone met while she talked and no longer true is dropped after a few seconds (owner playtest: stale praise)', async () => {
    const h = new Harness(lesson([{ id: 'p', title: 'P', steps: [feedbackTask()] }]));
    await h.start();
    h.host.speech.hold = true;
    h.set({ pitchDeg: 5 });          // M1 met...
    h.run(1);
    h.set({ pitchDeg: 2 });          // ...and gone again while she is still talking
    h.run(4);
    h.host.speech.hold = false;
    h.host.speech.finishAll();
    h.run(3);
    expect(h.said(M1)).toBe(0);
  });

  it("the task's queued brief, start and feedback lines are dropped when it ends; the success line is kept", async () => {
    const h = new Harness(lesson([{ id: 'p', title: 'P', steps: [feedbackTask(), wait('after', { const: false })] }]));
    h.host.speech.hold = true;       // nothing has been spoken yet
    await h.start();
    h.set({ pitchDeg: 11 });
    h.run(1.5);
    expect(h.step).toBe('after');
    h.host.speech.hold = false;
    h.host.speech.finishAll();
    const heard = h.host.speech.transcript.map((c) => c.text);
    expect(heard).not.toContain(START);
    expect(heard).toContain(SUCCESS);
  });
});

// =============================================================================================================

describe('TaskLimit: the limit intervention', () => {
  const LIMIT_CUE = "That's a bit much bank for now.";
  const FAIL_CUE = "We'll come back to that one.";
  const limitTask = (over: Partial<TaskStep> = {}): TaskStep => task({
    id: 't', exercise: 'ex', brief: { text: 'Roll gently left and right.' },
    card: { title: 'Ailerons', targets: [{ label: 'BANK', sig: 'bankDeg', value: 0, unit: 'deg' }] },
    goal: { const: false }, timeoutS: 900, criteria: [],
    limits: [{ id: 'bank', sig: 'bankDeg', max: 45, cue: { text: LIMIT_CUE } }, { id: 'bankL', sig: 'bankDeg', min: -45, cue: { text: LIMIT_CUE } }],
    feedback: { start: { text: 'Off you go.' } },
    onFail: { cue: { text: FAIL_CUE }, next: 'next' },
    ...over,
  });
  const limitLesson = (over: Partial<TaskStep> = {}, l: Partial<Lesson> = {}): Lesson =>
    lesson([{ id: 'p', title: 'P', steps: [limitTask(over), wait('w', { const: false }), end('fin')] }], l);

  it('takes control after forS, restores straight and level at the task reference, explains, hands back, and restarts the task', async () => {
    const h = await new Harness(limitLesson()).start();
    h.tick();
    expect(h.step).toBe('t');
    expect(h.runner.authority.who).toBe('student');
    h.run(1);

    // A brief excursion that comes back inside resets the timer.
    h.set({ bankDeg: 50 });
    h.run(1);
    h.set({ bankDeg: 30 });
    h.run(0.5);
    h.set({ bankDeg: 50 });
    h.run(1.3);
    expect(h.host.copilot.restores).toEqual([]);
    // Queued coaching must not survive the take-over: hold the voice so a line is waiting.
    h.host.speech.hold = true;
    h.host.speech.enqueue({ actor: 'instructor', channel: 'cabin', caption: 'Coach remark', speak: 'Coach remark', priority: Priority.Coach, interrupt: false, resumable: false, ttlMs: 3000 });
    h.run(0.3);
    h.host.speech.hold = false;

    // Taken.
    expect(h.host.copilot.restores).toEqual([{ altFt: 3000, hdgDeg: 100, kias: 100 }]);
    const take = h.host.speech.requests.find((r) => r.caption === 'I have control.');
    expect(take?.priority).toBe(Priority.Safety);
    expect(h.host.speech.cancels).toContainEqual({ priorityAtLeast: Priority.Instruction });
    expect(h.host.speech.requests.findIndex((r) => r.caption === 'I have control.'))
      .toBeLessThan(h.host.speech.requests.findIndex((r) => r.caption === LIMIT_CUE));
    h.host.speech.finishAll();
    expect(h.host.speech.transcript.some((c) => c.text === 'Coach remark')).toBe(false);   // dropped, never said
    expect(h.runner.authority.who).toBe('instructor');
    expect(h.events.find((e) => e.type === 'intervention')?.data).toEqual({ rule: 'limit.bank', kind: 'limit', limitId: 'bank' });
    expect(h.grader.calls).toContain('abort:t');
    expect(h.grader.limits).toEqual([['ex', 'bank', true]]);
    expect(h.runner.limitIntervention).toEqual({ limitId: 'bank', phase: 'restoring', count: 1 });
    h.run(0.2);
    expect(h.host.ui.strip?.authority).toBe('instructor');
    expect(h.host.ui.strip?.taskTitle).toBe('Restoring straight and level');

    // Not yet stable (still banked): nothing more is said.
    const n = h.captions.length;
    h.run(5);
    expect(h.captions.length).toBe(n);
    // Stable 3 s: the teaching line (bank), then "You have control"; Enter; the task restarts.
    h.level();
    h.run(3.2);
    const teach = RUNNER_LINES['runner.limit.teach.bank'].text as string[];
    expect(h.captions.some((c) => teach.includes(c))).toBe(true);
    h.run(0.7);
    expect(h.runner.authority.handover).toBe('offered');
    expect(h.captions.at(-1)).toBe('You have control.');
    expect(h.step).toBe('t');
    h.runner.input('ack');
    h.tick();
    expect(h.runner.authority.who).toBe('student');
    expect(h.host.copilot.mode).toBe('idle');
    expect(h.grader.calls.filter((c) => c === 'begin:t')).toHaveLength(2);
    expect(h.said('Roll gently left and right.')).toBe(2);
    expect(h.said('Off you go.')).toBe(2);
    expect(h.runner.limitIntervention).toBeNull();
    // Not a safety intervention.
    expect(h.runner.snapshot().interventions).toBe(0);
  });

  it('counts attempts: the third limit intervention fails the task with onFail once control is handed back', async () => {
    const h = await new Harness(limitLesson()).start();
    h.tick();
    for (let i = 1; i <= 3; i++) {
      h.set({ bankDeg: i === 2 ? -50 : 50 });
      h.run(1.7);
      expect(h.host.copilot.restores).toHaveLength(i);
      await h.restoreAndTakeBack();
      if (i < 3) expect(h.step).toBe('t');
    }
    expect(h.grader.limits).toEqual([['ex', 'bank', true], ['ex', 'bankL', true], ['ex', 'bank', false]]);
    expect(h.grader.calls.filter((c) => c.startsWith('end:t') || c.startsWith('abort:t'))).toEqual(['abort:t', 'abort:t', 'end:t:fail']);
    expect(h.said(FAIL_CUE)).toBe(1);
    expect(h.said("Let's try that one again.") + h.said('Have another go at that.')).toBe(2);
    // The third time she says she is moving on, rather than moving on in silence (release playtest).
    const moveOn = RUNNER_LINES['runner.limit.moveOn'].text as string[];
    expect(h.captions.filter((c) => moveOn.includes(c))).toHaveLength(1);
    expect(h.stepExits()).toContainEqual({ step: 't', result: 'fail' });
    expect(h.step).toBe('w');
    expect(h.runner.authority.who).toBe('student');
    // The lesson goes on; the result records three limit interventions and no safety intervention.
    h.runner.input('skipStep');
    h.tick();
    expect(h.runner.phase).toBe('debrief');
    expect(h.host.ended[0].limitInterventions).toBe(3);
    expect(h.host.ended[0].interventions).toBe(0);
  });

  it('TaskStep.attempts sets how many limit interventions a task allows', async () => {
    const h = await new Harness(limitLesson({ attempts: 1 })).start();
    h.tick();
    h.set({ bankDeg: 50 });
    h.run(1.7);
    await h.restoreAndTakeBack();
    expect(h.step).toBe('w');
    expect(h.said(FAIL_CUE)).toBe(1);
  });

  it('the safety envelope still takes precedence: past 60 degrees it is a safety intervention, not a limit one', async () => {
    const h = await new Harness(limitLesson()).start();
    h.tick();
    h.set({ bankDeg: 70 });
    h.run(0.7);
    expect(h.host.copilot.recoveries).toEqual(['noseLow']);
    expect(h.host.copilot.restores).toEqual([]);
    expect(h.said('I have control!')).toBe(1);
    expect(h.runner.snapshot().interventions).toBe(1);
  });

  it('a breach while restoring switches the copilot to the matching recovery and the restore still ends in the handback', async () => {
    const h = await new Harness(limitLesson()).start();
    h.tick();
    h.set({ bankDeg: 50 });
    h.run(1.7);
    h.set({ pitchDeg: -30 });
    h.run(0.7);
    expect(h.host.copilot.recoveries).toEqual(['noseLow']);
    expect(h.runner.snapshot().interventions).toBe(0);
    await h.restoreAndTakeBack();
    expect(h.step).toBe('t');
    expect(h.runner.authority.who).toBe('student');
  });

  it('with instructor saves off a limit is a minor fault and the line, no take-over', async () => {
    const h = await new Harness(limitLesson(), { instructorSaves: false }).start();
    h.tick();
    h.set({ bankDeg: 50 });
    h.run(1.7);
    expect(h.host.copilot.restores).toEqual([]);
    expect(h.runner.authority.who).toBe('student');
    expect(h.runner.snapshot().faults.map((f) => [f.id, f.severity])).toEqual([['limit.bank', 'minor']]);
    expect(h.said(LIMIT_CUE)).toBe(1);
  });

  it('a limit line that itself says "I have control" is the take (no double "I have control")', async () => {
    const h = await new Harness(limitLesson({ limits: [{ id: 'bank', sig: 'bankDeg', max: 45, cue: { text: "I have control. That's a bit much bank for now." } }] })).start();
    h.tick();
    h.set({ bankDeg: 50 });
    h.run(1.7);
    expect(h.said('I have control.')).toBe(0);
    const req = h.host.speech.requests.find((r) => r.caption === "I have control. That's a bit much bank for now.");
    expect(req?.priority).toBe(Priority.Safety);
  });
});

describe('handback during a task, and the end of the lesson', () => {
  const flyTask = (): TaskStep => task({
    id: 't', exercise: 'ex', brief: { text: 'Hold it level.' },
    card: { title: 'Level', targets: [] }, goal: { const: false }, timeoutS: 20, onTimeout: 'next', criteria: [],
    feedback: { start: { text: 'Go ahead.' } },
  });

  it("the task's clock stands still while the student has handed back; 'Go ahead' waits for them to take control", async () => {
    const h = await new Harness(lesson([{ id: 'p', title: 'P', steps: [flyTask(), task({ ...flyTask(), id: 't2' })] }])).start();
    h.tick();
    expect(h.step).toBe('t');
    h.run(5);
    h.runner.input('handback');
    h.tick();
    expect(h.runner.authority.who).toBe('instructor');
    h.run(40);                    // well past the 20 s timeout
    expect(h.step).toBe('t');
    expect(h.said(RUNNER_LINES['runner.handedBackPrompt'].text[0]) + h.said(RUNNER_LINES['runner.handedBackPrompt'].text[1])).toBeGreaterThan(0);
    // Enter: she offers, Enter again: the student has it; the clock runs on and the task times out.
    h.runner.input('ack');
    h.tick();
    expect(h.runner.authority.handover).toBe('offered');
    h.runner.input('ack');
    h.run(0.3);
    expect(h.runner.authority.who).toBe('student');
    h.run(16);
    expect(h.step).toBe('t2');
    expect(h.said('Go ahead.')).toBe(2);
  });

  it('the end line is heard before the debrief opens, and airborne she takes control first', async () => {
    const AIR: StartSpec = { kind: 'air', altFt: 3000, hdgDeg: 100, kias: 100 } as StartSpec;
    const WRAP = "Good. I have control; let's talk about it on the ground.";
    const h = new Harness(lesson([{ id: 'p', title: 'P', steps: [end('fin', { text: WRAP })] }], { start: AIR }));
    h.set({ onGround: false });
    await h.start();
    h.host.speech.hold = true;
    h.run(2);
    expect(h.runner.phase).toBe('running');
    h.host.speech.hold = false;
    h.host.speech.finishAll();
    h.tick();
    expect(h.runner.phase).toBe('debrief');
    expect(h.said(WRAP)).toBe(1);
    expect(h.said('I have control.')).toBe(0);
  });
});

describe('ab initio lessons', () => {
  it('stage 1 (and L01-L08) dual lessons are ab initio; checks, tests and later lessons are not', () => {
    const base = lesson([]);
    expect(isAbInitio(base)).toBe(true);
    expect(isAbInitio({ ...base, id: 'L08', stage: 'circuits' })).toBe(true);
    expect(isAbInitio({ ...base, id: 'L09', stage: 'circuits' })).toBe(false);
    expect(isAbInitio({ ...base, id: 'L13', stage: 'circuits', kind: 'check' })).toBe(false);
  });
});
