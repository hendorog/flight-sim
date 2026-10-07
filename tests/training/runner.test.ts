// LessonRunner (spec 3.2, 3.5, 3.8, 3.10) with a fake host and scripted signal timelines: step lifecycle,
// pending/prompt, timeouts and every outcome, branch/goto/repeat, handover (ack, no ack, input without ack,
// handback, interference, throttle match), intervention fails an assessed exercise, checkpoint retry,
// snapshot/restore equality, checklists, crash/abandon/time-up, and the UI models. Also the AuthorityFsm and
// ChecklistRunner units.
//
// The grading modules are replaced by recording stand-ins (fakes/runnerFakes.ts) so these tests pin the
// runner's own behaviour; predicates, refs, the bus, phraseology, the trace and the flight timer are real.

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

import { AuthorityFsm, type AuthorityOutput } from '../../src/training/engine/authority';
import { TrainingBus } from '../../src/training/engine/bus';
import { ChecklistRunner } from '../../src/training/engine/checklists';
import {
  branch, capture, checklist, demo, end, ev, gt, handover, held, hold, lt, near, say, setup, task, v, vs, wait,
} from '../../src/training/engine/dsl';
import { LessonRunner, RUNNER_LINES, chipFor, type RunnerDeps, type RunnerHost } from '../../src/training/engine/runner';
import { STANDARDS } from '../../src/training/grading/standards';
import { SAFETY_CALLS } from '../../src/training/engine/safety';
import {
  Priority,
  type DemoScript, type EvalContext, type ExerciseDef, type Lesson, type PhaseDef, type SignalFrame, type StartSpec,
  type TaskStep, type TelemetrySources, type TrainingEventRecord, type TrainingSettings,
} from '../../src/training/types';
import { FakeGrader, FakeHost, ScriptedTelemetry, cruiseSignals, outcomeCalls, seededRng, testAircraft } from './fakes/runnerFakes';

// ---- fixtures ---------------------------------------------------------------------------------------------------

const EX: ExerciseDef[] = [
  { id: 'ex', title: 'Practice', skill: 'climb', mode: 'practice', standard: 'training', required: false, weight: 1 },
  { id: 'assessed', title: 'Assessed', skill: 'climb', mode: 'assessed', standard: 'test', required: true, weight: 2 },
];
const AIR: StartSpec = { kind: 'air', at: 'trainingArea', altFt: 3000, altRef: 'msl', hdgDeg: 100, kias: 100 };
const GROUND: StartSpec = { kind: 'ground', spot: 'holdA1', engine: 'running' };
const CLIMB_DEMO: DemoScript = { id: 'climb', segments: [{ kind: 'pause', s: 1 }] };

function lesson(flow: PhaseDef[], over: Partial<Lesson> = {}): Lesson {
  return {
    id: 'T01', version: 1, number: 1, title: 'Test lesson', syllabusRef: { easa: 'Ex 0', faa: 'ACS 0' }, stage: 'handling',
    kind: 'dual', persona: 'instructor', requires: [], aircraft: 'any', estMinutes: 10, start: AIR, weather: { preset: 'calm' },
    rules: { coachLevel: 'full', autopilot: 'forbidden', maxTimeScale: 1, instructorSaves: true, maxDurationS: 1500 },
    briefing: {
      aim: 'Test.', points: ['One.'], numbers: [{ label: 'Vy', value: vs('Vy'), unit: 'kt' }, { label: 'Cruise', value: { setting: 'cruiseRpm' }, unit: 'rpm' }],
      tolerances: ['altitude', 'bankSteep'], airmanship: [], keys: [], spoken: { text: 'Today we test.' },
    },
    exercises: EX, flow, ...over,
  };
}

/** A task flown at 3,000 ft: success once altitude is held near `alt` for 2 s. */
function altTask(id: string, exercise: string, alt = 3000, extra: Partial<TaskStep> = {}): TaskStep {
  return task({
    id, exercise, brief: { id: 'T.hold', vars: { alt } }, prompt: { text: 'Hold it there.' },
    card: { title: 'Hold altitude', targets: [{ label: 'ALT', sig: 'altFt', value: alt, tol: 'altitude', unit: 'ft' }] },
    goal: held(near('altFt', alt, 50), 2), timeoutS: 60,
    criteria: [hold(`${id}Alt`, 'Altitude', 'altFt', alt, 'altitude', { required: true })],
    ...extra,
  });
}

const SETTINGS: TrainingSettings = {
  authority: 'easa', talkativeness: 'normal',
  voice: { instructor: null, examiner: null, rate: 1, volume: 0.9, captions: true, captionsOnly: true },
  instructorSaves: true, liveBars: true, autoAck: false, logFreeFlights: false,
};

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

class Harness {
  host = new FakeHost();
  tel = new ScriptedTelemetry();
  bus = new TrainingBus();
  signals: SignalFrame = cruiseSignals();
  studentInput = false;
  events: TrainingEventRecord[] = [];
  runner: LessonRunner;
  deps: RunnerDeps;

  constructor(readonly lesson: Lesson, over: Partial<RunnerDeps> = {}, settings: Partial<TrainingSettings> = {}) {
    this.bus.on('*', (r) => this.events.push(r));
    this.deps = {
      aircraft: testAircraft(), standards: STANDARDS, authority: 'easa', lines: { 'T.hold': { text: 'Hold {alt:alt}.' } }, rng: seededRng(7),
      telemetry: this.tel.asTelemetry(), bus: this.bus, settings: { ...SETTINGS, ...settings }, demos: { climb: CLIMB_DEMO },
      progress: null, attempt: 1, ...over,
    };
    this.runner = new LessonRunner(lesson, this.host as unknown as RunnerHost, this.deps);
  }

  async start(): Promise<this> {
    await this.runner.begin();
    this.runner.startFlight();
    return this;
  }

  tick(dt = 0.1): void {
    this.runner.update(dt, dt, { studentInput: this.studentInput, signals: this.signals } as unknown as TelemetrySources);
  }

  run(seconds: number, dt = 0.1): void {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) this.tick(dt);
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

  said(text: string): number {
    return this.captions.filter((c) => c === text).length;
  }

  stepExits(): { step: string; result: string }[] {
    return this.events.filter((e) => e.type === 'step.exit').map((e) => {
      const d = e.data as { step: string; result: string };
      return { step: d.step, result: d.result };
    });
  }
}

beforeEach(() => {
  FakeGrader.instances.length = 0;
  outcomeCalls.length = 0;
});

// =============================================================================================================

describe('LessonRunner lifecycle', () => {
  it('positions behind the curtain, seeds the weather and shows the briefing with resolved numbers', async () => {
    const h = new Harness(lesson([{ id: 'p', title: 'P', steps: [end('fin')] }]));
    await h.runner.begin();
    expect(h.runner.phase).toBe('briefing');
    expect(h.host.repositions).toEqual(['air']);
    expect(h.host.weatherSeeds).toHaveLength(1);
    const b = h.host.ui.briefing;
    expect(b?.numbers).toEqual([{ label: 'Vy', value: 74, unit: 'kt' }, { label: 'Cruise', value: 2300, unit: 'rpm' }]);
    // The lesson standard is 'training' (an exercise uses it); the test column is EASA test.
    expect(b?.tolerances[0]).toEqual({ key: 'altitude', lesson: { minus: 200, plus: 200 }, test: { minus: 150, plus: 150 } });
    expect(b?.tolerances[1].note).toMatch(/Examiner practice/);
    expect(b?.weatherLine).toBe('Wind 090/5');
    h.runner.startFlight();
    expect(h.runner.phase).toBe('running');
    expect(h.host.ui.briefing).toBeNull();
    expect(h.host.autopilotAllowed).toBe(false);
  });

  it('chains instant steps in one frame, captures vars, waits, and ends in the debrief', async () => {
    const L = lesson([{ id: 'p1', title: 'Phase one', steps: [
      say('hello', { text: 'Climb from {alt0:alt}.' }),
      capture('cap', { alt0: 'altFt', tgt: v('alt0', 500) }),
      say('hello2', { text: 'Target {tgt:alt}.' }),
      wait('w', gt('altFt', v('tgt')), { timeoutS: 60 }),
      end('fin', { text: 'Done.' }),
    ] }], { exercises: [] });
    const h = await new Harness(L).start();
    h.tick();
    expect(h.step).toBe('w');
    expect(h.runner.position.vars).toEqual({ alt0: 3000, tgt: 3500 });
    expect(h.captions).toContain('Target 3,500 ft.');
    h.run(1);
    expect(h.step).toBe('w');
    h.set({ altFt: 3510 });
    h.tick();
    expect(h.runner.phase).toBe('debrief');
    expect(h.stepExits().map((e) => e.step)).toEqual(['hello', 'cap', 'hello2', 'w', 'fin']);
    expect(h.host.ended[0].outcome).toBe('competent');
    expect(h.host.ui.debrief?.result.outcome).toBe('competent');
    expect(h.host.ui.strip).toBeNull();
    expect(h.captions).toContain('Done.');
    expect(h.captions).toContain('Competent. Main point: level-offs.');   // spoken debrief summary
    expect(h.host.timeCap).toBe(Number.POSITIVE_INFINITY);
  });

  it('a say step with wait finishes on its speech end, not before', async () => {
    const L = lesson([{ id: 'p', title: 'P', steps: [say('s', { text: 'Listen carefully.' }, { wait: true }), wait('w', { const: false }, { timeoutS: 100 })] }], { exercises: [] });
    const h = new Harness(L);
    h.host.speech.hold = true;
    await h.start();
    h.run(0.5);
    expect(h.step).toBe('s');
    h.host.speech.finishAll();
    h.tick();
    expect(h.step).toBe('w');
  });

  it('a pending `when` prompts after afterS and every everyS, and times out to its onTimeout', async () => {
    const L = lesson([{ id: 'p', title: 'P', steps: [
      wait('w', { const: true }, { when: gt('altFt', 9000), whenPrompt: { afterS: 5, cue: { text: 'Climb when ready.' }, everyS: 10 }, timeoutS: 30, onTimeout: { goto: 'fallback' } }),
      end('done'),
      say('fallback', { text: 'Fell back.' }),
      wait('hold', { const: false }, { timeoutS: 999 }),
    ] }], { exercises: [] });
    const h = await new Harness(L).start();
    h.run(4.9);
    expect(h.said('Climb when ready.')).toBe(0);
    h.run(0.3);
    expect(h.said('Climb when ready.')).toBe(1);
    h.run(10);
    expect(h.said('Climb when ready.')).toBe(2);
    h.run(15);
    expect(h.stepExits()[0]).toEqual({ step: 'w', result: 'timeout' });
    expect(h.step).toBe('hold');
    expect(h.captions).toContain('Fell back.');
  });

  it('respects maxDurationS: the lesson ends incomplete', async () => {
    const L = lesson([{ id: 'p', title: 'P', steps: [wait('w', { const: false })] }], { exercises: [] });
    L.rules = { ...L.rules, maxDurationS: 10 };
    const h = await new Harness(L).start();
    h.run(11);
    expect(h.runner.phase).toBe('debrief');
    expect(h.host.ended[0].outcome).toBe('incomplete');
    expect(outcomeCalls[0].ended).toBe('timeUp');
  });

  it('abandon ends the lesson with a result and no debrief', async () => {
    const L = lesson([{ id: 'p', title: 'P', steps: [altTask('t', 'ex')] }], { kind: 'solo' });
    const h = await new Harness(L).start();
    h.run(1);
    h.runner.input('abandon');
    expect(h.runner.phase).toBe('ended');
    expect(h.host.ended[0].outcome).toBe('abandoned');
    expect(h.host.ui.debrief).toBeNull();
    expect(h.grader.calls).toContain('abort:t');
  });

  it('a crash ends the lesson crashed and the debrief offers the checkpointed phases', async () => {
    const L = lesson([{ id: 'p', title: 'Practice', steps: [altTask('t', 'ex', 5000)] }], { kind: 'solo' });
    const h = await new Harness(L).start();
    h.run(1);
    h.runner.onCrash('terrain');
    expect(h.runner.phase).toBe('debrief');
    expect(h.host.ended[0].outcome).toBe('crashed');
    expect(h.host.ui.debrief?.retryPhases).toEqual([{ phaseId: 'p', title: 'Practice' }]);
    expect(h.grader.calls).toContain('end:t:crash');
    expect(h.events.some((e) => e.type === 'crash')).toBe(true);
  });
});

// =============================================================================================================

describe('LessonRunner tasks and outcomes', () => {
  it('runs a task: brief, grader samples while the student flies, goal + minS, onSuccess cue', async () => {
    const t = altTask('t', 'ex', 3000, { minS: 3, onSuccess: { cue: { text: 'Nicely done.' } } });
    const L = lesson([{ id: 'p', title: 'P', steps: [t, wait('after', { const: false }, { timeoutS: 99 })] }], { kind: 'solo' });
    const h = await new Harness(L).start();
    h.tick();
    expect(h.captions).toContain('Hold 3,000 ft.');
    expect(h.grader.calls).toEqual(['begin:t']);
    h.run(2.5);
    expect(h.step).toBe('t');          // goal true after 2 s, but minS is 3
    h.run(1);
    expect(h.step).toBe('after');
    expect(h.grader.calls).toEqual(['begin:t', 'end:t:success']);
    expect(h.captions).toContain('Nicely done.');
    expect(h.runner.grader.exerciseGrade('ex')).toBe(3);
  });

  it('timeout -> fail -> onFail cue; retry re-enters up to `attempts`; two failures offer a demo; [ flies it and hands back', async () => {
    const t = altTask('t', 'ex', 5000, { timeoutS: 5, attempts: 3, onFail: { cue: { text: 'Not quite.' }, next: 'retry' } });
    const L = lesson([{ id: 'p', title: 'P', steps: [demo('d', 'climb'), handover('h', 'student'), t, end('fin')] }], { start: GROUND });
    const h = await new Harness(L).start();
    h.tick();
    expect(h.step).toBe('d');
    h.host.copilot.demoResult = 'done';
    h.tick();
    h.runner.input('ack');
    h.run(0.2);
    expect(h.step).toBe('t');
    h.run(5.1);
    expect(h.stepExits().filter((e) => e.step === 't')).toEqual([{ step: 't', result: 'timeout' }]);
    expect(h.said('Not quite.')).toBe(1);
    expect(h.said(RUNNER_LINES['runner.offerDemo'].text as string)).toBe(0);
    h.run(5.1);
    expect(h.said(RUNNER_LINES['runner.offerDemo'].text as string)).toBe(1);   // after the second failure
    // "Show me": the demo, a handover, then the task again.
    h.runner.input('showMe');
    expect(h.host.copilot.log.at(-1)).toBe('run:climb');
    expect(h.step).toBe('t.demo');
    expect(h.runner.snapshot().stepId).toBe('t');   // a reload resumes the interrupted task, not the demo
    h.host.copilot.demoResult = 'done';
    h.tick();
    expect(h.runner.authority.handover).toBe('offered');
    h.runner.input('ack');
    h.run(0.3);
    // Attempts 1 and 2 timed out, attempt 3 was interrupted by "Show me" (discarded), attempt 4 runs now.
    expect(h.grader.calls.filter((c) => c === 'begin:t')).toHaveLength(4);
    expect(h.grader.calls.filter((c) => c.startsWith('end:t') || c.startsWith('abort:t'))).toEqual(['end:t:timeout', 'end:t:timeout', 'abort:t']);
    // The third failure exhausts the attempts: retry becomes next.
    h.run(5.1);
    expect(h.runner.phase).toBe('debrief');
  });

  it('onTimeout { demo, thenRetry } runs the demo, hands back and re-enters the task', async () => {
    const t = altTask('t', 'ex', 5000, { timeoutS: 3, onTimeout: { demo: 'climb', thenRetry: true } });
    const L = lesson([{ id: 'p', title: 'P', steps: [t, end('fin')] }], { start: GROUND });
    const h = await new Harness(L).start();
    h.run(3.1);
    expect(h.host.copilot.mode).toBe('demo');
    expect(h.runner.authority.who).toBe('instructor');
    expect(h.captions).toContain(RUNNER_LINES['runner.showYou'].text);
    expect(h.host.ui.followMe).toBe(true);
    h.host.copilot.demoResult = 'done';
    h.tick();
    expect(h.events.some((e) => e.type === 'demo.done')).toBe(true);
    expect(h.host.ui.followMe).toBe(false);
    h.runner.input('ack');
    h.run(0.3);
    expect(h.runner.authority.who).toBe('student');
    expect(h.step).toBe('t');
    expect(h.grader.calls.filter((c) => c === 'begin:t')).toHaveLength(2);
  });

  it('branch picks the first matching case; goto jumps by step id and by phase', async () => {
    const L = lesson([
      { id: 'a', title: 'A', steps: [
        branch('b', [{ when: gt('altFt', 9000), goto: 'high' }, { when: lt('altFt', 9000), goto: 'phase:c' }], 'high'),
        say('high', { text: 'High.' }),
      ] },
      { id: 'b2', title: 'B', steps: [say('never', { text: 'Never.' })] },
      { id: 'c', title: 'C', steps: [
        wait('w', { const: true }, { onTimeout: 'next' }),
        task({ ...altTask('jump', 'ex'), goal: { const: false }, on: [{ event: 'goAround', cue: { text: 'Going around.' }, goto: 'ga' }] }),
        say('skipped', { text: 'Skipped.' }),
        say('ga', { text: 'Go-around flown.' }),
        wait('rest', { const: false }),
      ] },
    ], { kind: 'solo' });
    const h = await new Harness(L).start();
    h.tick();
    expect(h.step).toBe('jump');
    expect(h.captions).not.toContain('High.');
    h.bus.emit('goAround', { aglFt: 200 }, 1);
    h.tick();
    expect(h.captions).toContain('Going around.');
    expect(h.captions).toContain('Go-around flown.');
    expect(h.captions).not.toContain('Skipped.');
    expect(h.step).toBe('rest');
  });

  it('instructorTakes takes control with "I have control" and the copilot holds', async () => {
    const L = lesson([{ id: 'p', title: 'P', steps: [
      altTask('t', 'ex', 5000, { timeoutS: 2, onTimeout: 'instructorTakes' }), wait('w', { const: false }),
    ] }], { start: GROUND });
    const h = await new Harness(L).start();
    h.run(2.1);
    expect(h.runner.authority.who).toBe('instructor');
    expect(h.captions).toContain('I have control.');
    expect(h.host.copilot.mode).toBe('holding');
    expect(h.step).toBe('w');
  });

  it('repeat re-runs the phase from its checkpoint until `until` holds, keeping the grades', async () => {
    const L = lesson([
      { id: 'prac', title: 'Practice', repeat: { max: 3, until: { exerciseGrade: 'ex', atLeast: 3 } }, steps: [altTask('t', 'ex')] },
      { id: 'next', title: 'Next', steps: [wait('w', { const: false })] },
    ], { kind: 'solo' });
    const h = await new Harness(L).start();
    h.tick();
    h.grader.successGrade = 2;
    h.run(2.2);
    await settle();
    expect(h.host.restores).toBe(1);            // the repeat restored the phase checkpoint
    expect(h.captions.some((c) => c.startsWith("Let's do that once more") || c.startsWith('Once more'))).toBe(true);
    h.grader.successGrade = 3;
    h.run(2.3);
    await settle();
    h.tick();
    expect(h.step).toBe('w');
    expect(h.host.restores).toBe(1);
    expect(h.host.checkpoints).toBe(1);          // the repeat reuses the phase's checkpoint
  });

  it('a fault rule records once and endTask fails the task', async () => {
    const t = altTask('t', 'ex', 5000, {
      faults: [{ id: 'flapsUp', when: gt('flapsDeg', 5), severity: 'major', cue: { text: 'Flaps!' }, once: true, action: 'endTask' }],
    });
    const L = lesson([{ id: 'p', title: 'P', steps: [t, wait('w', { const: false })] }], { kind: 'solo' });
    const h = await new Harness(L).start();
    h.run(1);
    h.set({ flapsDeg: 10 });
    h.tick();
    expect(h.captions).toContain('Flaps!');
    expect(h.grader.calls).toContain('end:t:fail');
    expect(h.grader.faults.map((f) => [f.f.id, f.exerciseId])).toEqual([['flapsUp', 'ex']]);
    expect(h.runner.snapshot().faults).toHaveLength(1);
    expect(h.step).toBe('w');
  });

  it('skipStep discards the open attempt and moves on', async () => {
    const L = lesson([{ id: 'p', title: 'P', steps: [altTask('t', 'ex', 5000), wait('w', { const: false })] }], { kind: 'solo' });
    const h = await new Harness(L).start();
    h.run(1);
    h.runner.input('skipStep');
    expect(h.step).toBe('w');
    expect(h.grader.calls).toEqual(['begin:t', 'abort:t']);
    expect(h.stepExits()[0]).toEqual({ step: 't', result: 'skipped' });
  });

  it('say again repeats the task prompt; setup applies holds, hood and the time-scale cap', async () => {
    const L = lesson([{ id: 'p', title: 'P', maxTimeScale: 4, steps: [
      setup('s', { holds: { throttle: 0, release: ev('goAround'), cue: { text: 'I have the throttle.' } }, hood: true, timeScaleMax: 2 }),
      altTask('t', 'ex', 5000),
    ] }], { kind: 'solo' });
    const h = await new Harness(L).start();
    h.tick();
    expect(h.host.timeCap).toBe(2);
    expect(h.host.hood).toBe(true);
    expect(h.host.copilot.holds?.throttle).toBe(0);
    expect(h.captions).toContain('I have the throttle.');
    h.runner.input('sayAgain');
    expect(h.captions.at(-1)).toBe('Hold it there.');
    h.run(0.2);
    expect(h.host.ui.strip?.holds).toEqual(['THROTTLE: INSTRUCTOR']);
    h.bus.emit('goAround', { aglFt: 200 }, 1);
    h.tick();
    expect(h.host.copilot.holds).toBeNull();
    expect(h.captions).toContain('You have the throttle.');
  });
});

// =============================================================================================================

describe('LessonRunner handover (section 1.5)', () => {
  const handLesson = (): Lesson => lesson([{ id: 'p', title: 'P', steps: [handover('h', 'student'), wait('w', { const: false })] }]);

  it('three-way handover: offer, Enter, "I have control" caption, confirm, release on the next frame', async () => {
    const h = await new Harness(handLesson()).start();
    expect(h.host.copilot.mode).toBe('holding');      // dual airborne start: the instructor flies first
    h.run(0.2);
    expect(h.captions).toEqual(['You have control.']);
    expect(h.host.ui.strip?.authority).toBe('offered');
    h.runner.input('ack');
    const student = h.host.speech.requests.find((r) => r.actor === 'student');
    expect(student?.caption).toBe('I have control.');
    expect(h.captions.at(-1)).toBe('You have control.');
    expect(h.runner.authority.who).toBe('instructor');   // released on the next frame
    h.tick();
    expect(h.runner.authority.who).toBe('student');
    expect(h.host.copilot.mode).toBe('idle');
    expect(h.step).toBe('w');
    h.run(0.2);
    expect(h.host.ui.strip?.authority).toBe('student');
    expect(h.events.find((e) => e.type === 'authority')?.data).toEqual({ to: 'student', reason: 'plan' });
  });

  it('no Enter: the offer repeats once at 6 s, prompts at 15 s, and the step times out at 20 s', async () => {
    const h = await new Harness(handLesson()).start();
    h.run(6.1);
    expect(h.said('You have control.')).toBe(2);
    h.run(9);
    expect(h.captions).toContain("Press Enter when you're ready to take it.");
    expect(h.said('You have control.')).toBe(2);
    h.run(5);
    expect(h.stepExits()[0]).toEqual({ step: 'h', result: 'timeout' });
    expect(h.runner.authority.who).toBe('instructor');   // the copilot keeps flying
  });

  it('flying without acknowledging: one "say I have control first" and a minor handoverProtocol fault', async () => {
    const h = await new Harness(handLesson()).start();
    h.tick();
    h.studentInput = true;
    h.run(1.5);
    expect(h.said("Say 'I have control' first: press Enter.")).toBe(1);
    expect(h.runner.snapshot().faults.map((f) => [f.id, f.severity])).toEqual([['handoverProtocol', 'minor']]);
    h.run(3);
    expect(h.said("Say 'I have control' first: press Enter.")).toBe(1);
  });

  it('auto-acknowledge treats the first deliberate input as Enter', async () => {
    const h = await new Harness(handLesson(), {}, { autoAck: true }).start();
    h.tick();
    h.studentInput = true;
    h.run(0.2);
    expect(h.runner.authority.who).toBe('student');
    expect(h.runner.snapshot().faults).toHaveLength(0);
  });

  it('handback: Shift+Enter gives control to the instructor, Enter starts a new offer; counted, not a fault', async () => {
    const L = lesson([{ id: 'p', title: 'P', steps: [wait('w', { const: false })] }], { start: GROUND });
    const h = await new Harness(L).start();
    h.tick();
    h.runner.input('handback');
    expect(h.runner.authority.who).toBe('instructor');
    expect(h.host.speech.requests.find((r) => r.actor === 'student')?.caption).toBe('You have control.');
    expect(h.captions).toContain(RUNNER_LINES['runner.takeBreath'].text);
    expect(h.host.copilot.mode).toBe('holding');
    h.runner.input('ack');
    expect(h.runner.authority.handover).toBe('offered');
    h.runner.input('ack');
    h.tick();
    expect(h.runner.authority.who).toBe('student');
    const snap = h.runner.snapshot();
    expect(snap.handbacks).toBe(1);
    expect(snap.faults).toHaveLength(0);
  });

  it('student input during a demo: "light hands" and one fightingControls fault per demo', async () => {
    const L = lesson([{ id: 'p', title: 'P', steps: [demo('d', 'climb', { followMeThrough: true, highlight: ['ai'] })] }]);
    const h = await new Harness(L).start();
    h.tick();
    expect(h.host.ui.highlight).toEqual(['ai']);
    h.run(0.2);
    expect(h.host.ui.strip?.authority).toBe('followMe');
    h.studentInput = true;
    h.run(1.2);
    expect(h.said('Light hands, just follow me through.')).toBe(1);
    h.run(3);
    expect(h.said('Light hands, just follow me through.')).toBe(1);
    expect(h.runner.snapshot().faults.map((f) => f.id)).toEqual(['fightingControls']);
  });

  it('a hardware throttle must match the copilot before the handover completes', async () => {
    const h = await new Harness(handLesson()).start();
    h.host.hardware = 0.95;    // copilot throttle 0.65
    h.tick();
    h.runner.input('ack');
    expect(h.runner.authority.handover).toBe('matchThrottle');
    h.run(0.3);
    expect(h.runner.authority.who).toBe('instructor');
    expect(h.host.ui.strip?.matchThrottle).not.toBeNull();
    h.host.hardware = 0.66;
    h.run(0.3);
    expect(h.runner.authority.who).toBe('student');
  });
});

// =============================================================================================================

describe('LessonRunner safety interventions (section 3.8)', () => {
  const assessedLesson = (): Lesson => lesson([
    { id: 'warm', title: 'Warm-up', steps: [altTask('t0', 'ex')] },
    { id: 'test', title: 'Assessed', steps: [altTask('t1', 'assessed', 3000, { goal: { const: false }, timeoutS: 500 }), end('fin')] },
  ], { start: GROUND });

  async function toAssessed(h: Harness): Promise<void> {
    await h.start();
    h.run(2.3);
    expect(h.step).toBe('t1');
  }

  it('a breach in an assessed task: "I have control!", recovery, the exercise fails, explanation, then the phase checkpoint', async () => {
    const h = new Harness(assessedLesson());
    await toAssessed(h);
    h.set({ bankDeg: 70 });
    h.run(0.4);
    expect(h.host.copilot.recoveries).toEqual([]);      // 0.5 s breach rule
    h.run(0.2);
    expect(h.host.copilot.recoveries).toEqual(['noseLow']);
    const safetyLine = h.host.speech.requests.find((r) => r.caption === 'I have control!');
    expect(safetyLine?.priority).toBe(Priority.Safety);
    expect(safetyLine?.interrupt).toBe(true);
    expect(h.grader.calls).toContain('intervention');
    expect(h.grader.calls).toContain('end:t1:fail');
    // Nothing below Safety may follow "I have control!": queued task instructions are dropped too.
    expect(h.host.speech.cancels).toContainEqual({ priorityAtLeast: Priority.Instruction });
    expect(h.events.find((e) => e.type === 'intervention')?.data).toEqual({ rule: 'bank' });
    expect(h.runner.authority.who).toBe('instructor');
    // Recovering: nothing else happens until the copilot reports stable.
    h.set({ bankDeg: 0 });
    h.run(2);
    expect(h.host.restores).toBe(0);
    h.host.copilot.stable = true;
    h.tick();
    expect(h.captions).toContain('OK, that was getting away from us.');
    expect(h.captions.some((c) => c.startsWith("The bank was getting too steep"))).toBe(true);
    h.run(1);
    await settle();
    expect(h.host.restores).toBe(1);
    h.tick();
    expect(h.step).toBe('t1');
    expect(h.runner.snapshot().interventions).toBe(1);
    expect(h.runner.snapshot().phaseRetries).toBe(0);   // an instructor-initiated retry is not the student's
    // Even a perfect retry cannot make the lesson competent: the assessment had an intervention.
    h.runner.input('skipStep');
    expect(h.runner.phase).toBe('debrief');
    expect(outcomeCalls.at(-1)?.assessedInterventions).toBe(1);
    expect(h.host.ended[0].outcome).toBe('notYet');
  });

  it('a second intervention ends the lesson', async () => {
    const h = new Harness(assessedLesson());
    await toAssessed(h);
    for (let i = 0; i < 2; i++) {
      h.host.copilot.stable = false;
      h.set({ bankDeg: 70 });
      h.run(0.6);
      h.set({ bankDeg: 0 });
      h.host.copilot.stable = true;
      h.run(1);
      await settle();
      h.tick();
    }
    expect(h.captions).toContain("That's enough for today; we'll talk it through on the ground.");
    expect(h.runner.phase).toBe('debrief');
    expect(h.host.ended[0].interventions).toBe(2);
  });

  it('low and slow is immediate; without instructor saves a breach is only a fault', async () => {
    const h = new Harness(assessedLesson(), {}, { instructorSaves: false });
    await toAssessed(h);
    h.set({ aglFt: 250, kias: 50 });
    h.tick();
    expect(h.host.copilot.recoveries).toEqual([]);
    expect(h.runner.snapshot().faults.map((f) => [f.id, f.severity])).toEqual([['safety.lowAndSlow', 'major']]);
    // No takeover, but the instructor still calls it, at Safety priority.
    const call = h.host.speech.requests.find((r) => r.caption === SAFETY_CALLS.lowAndSlow);
    expect(call?.priority).toBe(Priority.Safety);
    h.run(2);
    // 250 ft is also below the 1,000 ft minimum of a non-low-level phase (after its 0.5 s), and that is all:
    // each rule records one fault per excursion, not one per frame.
    h.run(2);
    expect(h.runner.snapshot().faults.map((f) => f.id)).toEqual(['safety.lowAndSlow', 'safety.minHeight']);
  });

  it('in the skill test an imminent breach stops the test (critical fault)', async () => {
    const L = lesson([{ id: 'p', title: 'P', steps: [altTask('t', 'assessed', 3000, { goal: { const: false } })] }], {
      kind: 'test', persona: 'examiner', start: GROUND,
      exercises: [{ ...EX[1], testSection: 2 }],
    });
    const h = await new Harness(L).start();
    h.run(1);
    h.set({ aglFt: 250, kias: 50 });
    h.tick();
    const stop = h.host.speech.requests.find((r) => r.caption === "I have control. We'll stop the test there.");
    expect(stop?.actor).toBe('examiner');
    expect(h.runner.phase).toBe('debrief');
    expect(h.host.ended[0].outcome).toBe('testFail');
    expect(outcomeCalls.at(-1)?.criticalFault).toBe(true);
    expect(outcomeCalls.at(-1)?.failedSections).toEqual([2]);
  });

  it('a breach while the instructor flies a demo aborts it into a recovery without counting against the student', async () => {
    const L = lesson([{ id: 'p', title: 'P', steps: [demo('d', 'climb'), wait('w', { const: false })] }]);
    const h = await new Harness(L).start();
    h.tick();
    h.set({ pitchDeg: -30 });
    h.run(0.6);
    expect(h.host.copilot.recoveries).toEqual(['noseLow']);
    expect((h.events.find((e) => e.type === 'demo.done')?.data as { result: string }).result).toBe('aborted');
    h.set({ pitchDeg: 0 });
    h.host.copilot.stable = true;
    h.run(0.3);
    expect(h.step).toBe('w');
    expect(h.stepExits()[0]).toEqual({ step: 'd', result: 'fail' });
    expect(h.runner.snapshot().interventions).toBe(0);
  });
});

// =============================================================================================================

describe('LessonRunner checkpoints, snapshot and restore (section 3.10)', () => {
  const twoPhase = (): Lesson => lesson([
    { id: 'one', title: 'One', steps: [altTask('a', 'ex')] },
    { id: 'two', title: 'Two', steps: [capture('c', { mark: 'altFt' }), altTask('b', 'assessed', 5000), end('fin')] },
  ], { kind: 'solo' });

  it('Shift+R restores the phase checkpoint, rewinds the trace, counts a phase retry', async () => {
    const h = await new Harness(twoPhase()).start();
    h.run(2.3);
    expect(h.step).toBe('b');
    expect(h.host.checkpoints).toBe(2);
    h.run(3);
    h.set({ altFt: 3333 });
    h.runner.input('retryPhase');
    await settle();
    expect(h.host.restores).toBe(1);
    expect(h.host.speech.flushes).toBe(1);
    expect(h.grader.calls).toContain('abort:b');
    h.tick();
    expect(h.step).toBe('b');
    expect(h.runner.position.vars.mark).toBe(3333);   // the phase re-ran from its first step
    const snap = h.runner.snapshot();
    expect(snap.phaseRetries).toBe(1);
    expect(snap.phaseId).toBe('two');
    expect(snap.exercises.ex).toHaveLength(1);         // attempts closed before the checkpoint survive
    h.runner.input('abandon');
    expect(h.host.ended[0].phaseRetries).toBe(1);
  });

  it('snapshot -> restore -> snapshot is the identity, and the restored run restarts the current step', async () => {
    const h = await new Harness(twoPhase()).start();
    h.run(2.3);
    h.run(1.1);
    const snap = h.runner.snapshot();
    expect(snap.stepId).toBe('b');
    expect(snap.vars).toEqual({ mark: 3000 });
    expect(snap.exercises.ex[0].grade).toBe(3);

    const h2 = new Harness(twoPhase());
    const r2 = LessonRunner.restore(h2.lesson, h2.host as unknown as RunnerHost, h2.deps, JSON.parse(JSON.stringify(snap)));
    expect(r2.resumed).toBe(true);
    expect(r2.phase).toBe('running');
    expect(r2.snapshot()).toEqual(snap);
    h2.runner = r2;
    h2.tick();
    expect(h2.step).toBe('b');
    expect(h2.captions).toContain('Right, where were we.');
    expect(FakeGrader.last.calls).toEqual(['restore', 'begin:b']);
    expect(r2.grader.exerciseGrade('ex')).toBe(3);
  });

  it('a snapshot of another lesson version is not resumed: the runner waits for begin()', async () => {
    const h = await new Harness(twoPhase()).start();
    h.run(1);
    const snap = { ...h.runner.snapshot(), lessonVersion: 0 };
    const h2 = new Harness(twoPhase());
    const r2 = LessonRunner.restore(h2.lesson, h2.host as unknown as RunnerHost, h2.deps, snap);
    expect(r2.resumed).toBe(false);
    expect(r2.phase).toBe('briefing');
  });

  it('restart goes back to the briefing as a new attempt with a new weather seed', async () => {
    const h = await new Harness(twoPhase()).start();
    h.run(1);
    const first = h.runner.snapshot().attemptId;
    h.runner.input('restartLesson');
    await settle();
    expect(h.runner.phase).toBe('briefing');
    expect(h.host.weatherSeeds).toHaveLength(2);
    expect(h.host.weatherSeeds[0]).not.toBe(h.host.weatherSeeds[1]);
    h.runner.startFlight();
    h.tick();
    expect(h.runner.snapshot().attemptId).not.toBe(first);
    expect(h.step).toBe('a');
  });
});

// =============================================================================================================

describe('LessonRunner checklists (section 3.5)', () => {
  it('challenge/response through the runner: read, confirm with Enter, verify from state; Say again re-reads', async () => {
    const L = lesson([{ id: 'p', title: 'P', steps: [checklist('cl', 'beforeTakeoff', 'challengeResponse', { exercise: 'ex', timeoutS: 120 }), end('fin')] }], { kind: 'solo' });
    const h = await new Harness(L).start();
    h.set({ mixture: 1, flapsDeg: 20 });
    h.tick();
    expect(h.captions).toEqual(['Mixture?']);
    h.runner.input('sayAgain');
    expect(h.captions).toEqual(['Mixture?', 'Mixture?']);
    h.run(0.3);
    expect(h.host.ui.card?.checklist?.items.map((i) => i.state)).toEqual(['active', 'pending', 'pending']);
    h.runner.input('ack');                 // already rich when read: one Enter confirms it
    h.tick();
    h.tick();
    expect(h.captions.slice(-2)).toEqual(['Rich', 'Flaps?']);
    h.run(2);
    h.set({ flapsDeg: 0 });                // done from state, no Enter needed
    h.tick();
    h.tick();
    expect(h.captions.at(-1)).toBe('Controls?');
    h.runner.input('ack');
    h.tick();
    expect(h.captions).toContain('Full and free');
    h.tick();
    expect(h.runner.phase).toBe('debrief');
    expect(h.host.ended[0].exercises.find((e) => e.exerciseId === 'ex')?.grade).toBe(4);
    expect(h.events.filter((e) => e.type === 'checklist.item').map((e) => (e.data as { ok: boolean }).ok)).toEqual([true, true, true]);
  });
});

describe('ChecklistRunner', () => {
  const bus = new TrainingBus();
  const ctx = (frame: SignalFrame, dt = 0.5): EvalContext => ({
    frame, signalDef: () => undefined, vars: {}, aircraft: testAircraft(), fieldElevFt: 394, standards: STANDARDS,
    authority: 'easa', standard: 'training', events: bus, stepMark: 0, stepT: 0, dt, simT: 0, pilot: 'student',
    speechIdle: true, exerciseGrade: () => null,
  });
  const def = testAircraft().checklists.beforeTakeoff;

  it('challenge/response: reads each challenge, items true when read need Enter, Enter-only items caption YOU, misses are called', () => {
    const cl = new ChecklistRunner(def, 'challengeResponse', bus);
    const f: SignalFrame = { mixture: 1, flapsDeg: 20 };
    expect(cl.update(ctx(f))).toEqual([{ text: 'Mixture?' }]);
    cl.ack();
    expect(cl.update(ctx(f))).toEqual([{ text: 'Rich', actor: 'student' }]);
    expect(cl.update(ctx(f))).toEqual([{ text: 'Flaps?' }]);
    let out: unknown[] = [];
    for (let i = 0; i < 21; i++) out = out.concat(cl.update(ctx(f)));
    expect(out).toContainEqual({ text: 'Flaps set, please.' });
    expect(cl.items.map((i) => i.state)).toEqual(['done', 'missed', 'active']);
    cl.ack();
    cl.update(ctx(f));
    expect(cl.done).toBe(true);
    expect(cl.missed).toEqual(['flaps']);
    expect(cl.grade()).toBe(3);
  });

  it('a critical item missed grades 1; nothing missed grades 4', () => {
    const bad = new ChecklistRunner(def, 'flow', bus);
    bad.update(ctx({ mixture: 0.5, flapsDeg: 0 }));
    bad.ack();
    bad.update(ctx({ mixture: 0.5, flapsDeg: 0 }));
    expect(bad.done).toBe(true);
    expect(bad.criticalMissed).toBe(true);
    expect(bad.grade()).toBe(1);

    const good = new ChecklistRunner(def, 'flow', bus);
    good.update(ctx({ mixture: 1, flapsDeg: 0 }));
    expect(good.done).toBe(false);          // 'controls' has no check: Enter confirms it
    good.ack();
    good.update(ctx({ mixture: 1, flapsDeg: 0 }));
    expect(good.done).toBe(true);
    expect(good.grade()).toBe(4);
  });

  it('silent mode only observes, says nothing, and finish() marks what was never done', () => {
    const cl = new ChecklistRunner(def, 'silent', bus);
    expect(cl.update(ctx({ mixture: 0.2, flapsDeg: 0 }))).toEqual([]);
    cl.finish();
    expect(cl.update(ctx({}))).toEqual([]);
    expect(cl.missed).toEqual(['mixture']);
    expect(cl.grade()).toBe(1);
  });

  it('a checklist step feeds its 4/3/2/1 grade to the exercise; a silent miss is a fault', async () => {
    const L = lesson([{ id: 'p', title: 'P', steps: [checklist('cl', 'beforeTakeoff', 'flow', { exercise: 'ex', timeoutS: 30 }), end('fin')] }], { kind: 'solo' });
    const h = await new Harness(L).start();
    h.set({ mixture: 1, flapsDeg: 0 });
    h.tick();
    h.runner.input('ack');
    h.tick();
    expect(h.runner.phase).toBe('debrief');
    expect(h.host.ended[0].exercises.find((e) => e.exerciseId === 'ex')?.grade).toBe(4);
    expect(h.captions).toContain('Full and free');

    const S = lesson([{ id: 'p', title: 'P', steps: [checklist('cl', 'beforeTakeoff', 'silent', { timeoutS: 5 }), end('fin')] }], { kind: 'solo' });
    const s = await new Harness(S).start();
    s.set({ mixture: 0.2 });
    s.run(5.5);
    expect(s.host.ended[0]).toBeDefined();
    expect(s.events.filter((e) => e.type === 'fault').map((e) => e.data)).toEqual([{ id: 'checklist.beforeTakeoff', severity: 'major' }]);
  });
});

// =============================================================================================================

describe('LessonRunner UI models', () => {
  it('publishes tolerance chips and the card in practice, hides them in assessed tasks', async () => {
    const card = {
      title: 'Climb', targets: [
        { label: 'ALT', sig: 'altFt' as const, value: 3000, tol: 'altitude' as const, unit: 'ft' },
        { label: 'IAS', sig: 'asiKt' as const, value: 74, tol: 'speedClimbApproach' as const, unit: 'kt' },
        { label: 'HDG', sig: 'hdgDeg' as const, value: 358, tol: 'heading' as const, unit: 'deg' },
        { label: 'BANK', sig: 'aiBankDeg' as const, value: 30, tol: 'bankMedium' as const, unit: 'deg' },
      ],
    };
    const L = lesson([{ id: 'p', title: 'Practice', steps: [
      { ...altTask('t', 'ex', 3000, { goal: { const: false } }), card },
      { ...altTask('a', 'assessed', 3000), card },
    ] }], { kind: 'solo' });
    const h = await new Harness(L).start();
    h.set({ altFt: 3040, asiKt: 71, hdgDeg: 2, aiBankDeg: 44 });
    h.run(0.3);
    const strip = h.host.ui.strip;
    expect(strip?.authority).toBe('solo');
    expect(strip?.taskTitle).toBe('Climb');
    expect(strip?.chips.map((c) => c.text)).toEqual(['ALT +40', 'IAS −3', 'HDG 4°', 'BANK 44°']);
    expect(strip?.chips.map((c) => c.state)).toEqual(['green', 'green', 'green', 'red']);
    expect(h.host.ui.card?.liveFeedback).toBe(true);
    expect(h.host.ui.card?.targets[0]).toMatchObject({ label: 'ALT', target: 3000, value: 3040, tol: { minus: 200, plus: 200 } });
    expect(h.host.ui.card?.captions.at(-1)?.text).toBe('Hold 3,000 ft.');
    h.runner.input('skipStep');
    h.run(0.3);
    expect(h.host.ui.strip?.assessed).toBe(true);
    expect(h.host.ui.strip?.chips).toEqual([]);
    expect(h.host.ui.card?.liveFeedback).toBe(false);
  });

  it('chipFor formats deviations and colours by normalised error', () => {
    expect(chipFor({ label: 'ALT', unit: 'ft', target: 3000, value: 3000, tol: { minus: 100, plus: 100 }, n: 0 }, 'altFt').text).toBe('ALT ±0');
    expect(chipFor({ label: 'IAS', unit: 'kt', target: 74, value: 84, tol: { minus: 5, plus: 15 }, n: 0.67 }, 'asiKt')).toMatchObject({ text: 'IAS +10', state: 'amber' });
    expect(chipFor({ label: 'HDG', unit: 'deg', target: 10, value: 350, tol: { minus: 10, plus: 10 }, n: 2 }, 'hdgDeg')).toMatchObject({ text: 'HDG 20°', state: 'red' });
  });
});

// =============================================================================================================

describe('AuthorityFsm', () => {
  const upd = (fsm: AuthorityFsm, o: Partial<Parameters<AuthorityFsm['update']>[0]> = {}): AuthorityOutput[] => {
    fsm.update({ dt: 0.1, studentInput: false, hardwareThrottle: null, copilotThrottle: 0.6, autoAck: false, simT: 0, ...o });
    return fsm.drain();
  };

  it('offer -> ack -> confirming -> student, with one authority event', () => {
    const bus = new TrainingBus();
    const fsm = new AuthorityFsm(bus, 'instructor');
    fsm.offer();
    fsm.offer();   // idempotent while open
    expect(fsm.drain()).toEqual([{ kind: 'say', line: 'offer' }]);
    expect(fsm.ack()).toBe(true);
    expect(fsm.drain()).toEqual([{ kind: 'student', text: 'I have control.' }, { kind: 'say', line: 'confirm' }]);
    expect(fsm.handover).toBe('confirming');
    expect(upd(fsm)).toEqual([{ kind: 'changed', to: 'student', reason: 'plan' }]);
    expect(fsm.who).toBe('student');
    expect(bus.since(0).map((r) => r.type)).toEqual(['authority']);
  });

  it('take() is immediate; Enter afterwards is the optional "You have control"', () => {
    const fsm = new AuthorityFsm(new TrainingBus(), 'student');
    fsm.take('intervention', true);
    expect(fsm.who).toBe('instructor');
    expect(fsm.drain()).toEqual([{ kind: 'changed', to: 'instructor', reason: 'intervention' }]);
    expect(fsm.ack()).toBe(true);
    expect(fsm.drain()).toEqual([{ kind: 'student', text: 'You have control.' }]);
    expect(fsm.ack()).toBe(false);
  });

  it('take() cancels an open offer', () => {
    const fsm = new AuthorityFsm(new TrainingBus(), 'instructor');
    fsm.offer();
    fsm.take('plan');
    expect(fsm.handover).toBe('none');
    expect(fsm.ack()).toBe(false);   // no offer is open any more, and the instructor already had control
    upd(fsm);
    expect(fsm.who).toBe('instructor');
  });
});

