// Test doubles for the module-5 tests (runner, coach, safety): a scripted telemetry, a fake host (copilot,
// speech, UI), a test aircraft profile, and stand-ins for the grading modules that the runner tests mock with
// vi.mock (Grader, lesson outcome/stars, debrief text, derived-event detectors). The stand-ins follow the
// contract semantics closely enough to exercise the runner, and record every call so the tests can assert
// what the runner asked for. Nothing here imports a mocked module, so the vi.mock factories can load it.

import type { FlightSnapshot } from '../../../src/sim/resume';
import type { InstructorPilot } from '../../../src/training/copilot/instructorPilot';
import type { SpeechScheduler } from '../../../src/training/speech/scheduler';
import type { Telemetry } from '../../../src/training/telemetry/telemetry';
import type {
  AircraftTypeDef, BriefingModel, Caption, CardModel, CheckpointBlob, CriterionResult, DebriefModel, DemoScript, EvalContext,
  ExerciseDef, ExerciseResult, FaultRecord, Grade, Holds, InstrumentId, LessonResult, LessonStripModel, SignalDef,
  SignalFrame, SignalId, SignalValue, SpeechRequest, TaskStep, TelemetrySources, TrainingEventRecord, TrainingUiPort,
} from '../../../src/training/types';
import { STANDARDS } from '../../../src/training/grading/standards';

// ---- aircraft ---------------------------------------------------------------------------------------------------

/** A C172S-like profile (the real one is module 4's; these tests only need the numbers the engine reads). */
export function testAircraft(): AircraftTypeDef {
  return {
    id: 'c172s', name: 'Test 172', icaoType: 'C172', registration: 'G-TEST', classRating: 'SEP',
    vspeeds: {
      Vs0: 40, Vs1: 48, Vr: 55, Vx: 62, Vy: 74, Vcc: 85, Vglide: 68, Va: 105, Vfe10: 110, VfeFull: 85, Vno: 129, Vne: 163,
      Vapp: 70, VappFlapsUp: 75, Vref: 65, VshortField: 61, Vcruise: 105, Vslow: 55, VsteepTurn: 95, Vdescent: 90, Vdownwind: 90, Vtaxi: 15,
    },
    settings: {
      patternAglFt: 1000, cruiseRpm: 2300, descentRpm: 1900, circuitRpm: 2200, runupRpm: 1800, magDropMaxRpm: 150, magDiffMaxRpm: 50,
      approachFlapLever: 1, takeoffFlapLever: 0, shortFieldFlapLever: 1 / 3, maxDemoCrosswindKt: 15,
    },
    flapDetentsDeg: [0, 10, 20, 30], flapLeverForDeg: { 0: 0, 10: 1 / 3, 20: 2 / 3, 30: 1 },
    limits: { gPos: 3.8, gNeg: -1.52, maxDemoCrosswindKt: 15 },
    checklists: {
      beforeTakeoff: {
        id: 'beforeTakeoff', title: 'Before take-off', items: [
          { id: 'mixture', challenge: 'Mixture', response: 'Rich', check: { sig: 'mixture', op: '>', v: 0.9 }, critical: true },
          { id: 'flaps', challenge: 'Flaps', response: 'Set', check: { sig: 'flapsDeg', op: '<', v: 1 } },
          { id: 'controls', challenge: 'Controls', response: 'Full and free' },
        ],
      },
    } as AircraftTypeDef['checklists'],   // only the lists the tests use
    envelope: {
      maxBankDeg: 60, maxPitchUpDeg: 25, maxPitchDownDeg: -25, maxKias: 140, maxG: 3.3, minG: 0, minAglFt: 1000,
      lowAndSlow: { aglFt: 300, belowKias: { vspeed: 'Vs1', add: 5 } }, maxSinkFpmBelow200: 1000, stallAllowed: false, runwayExcursionM: 13,
    },
  };
}

// ---- telemetry --------------------------------------------------------------------------------------------------

const ANGLES = new Set(['hdgDeg', 'hdgTrueDeg', 'trackDeg']);

/** Level cruise in the training area: what every test starts from (pilot units, as the providers produce). */
export function cruiseSignals(): SignalFrame {
  return {
    asiKt: 100, kias: 100, altFt: 3000, altMslFt: 3000, aglFt: 2600, hafFt: 2600, vsiFpm: 0, vsFpm: 0, hdgDeg: 100,
    hdgTrueDeg: 100, trackDeg: 100, aiBankDeg: 0, bankDeg: 0, aiPitchDeg: 2, pitchDeg: 2, gLoad: 1, ball: 0, rpm: 2300,
    throttle: 0.65, mixture: 1, flapsDeg: 0, stallWarn: false, stallFrac: 0, onGround: false, gsKt: 100, rwyAcrossM: 3000,
    rwyAlongM: 5000, circuitLeg: 'none', untrimmedS: 0, night: false, studentInput: false,
  };
}

/** Telemetry whose providers are the test: `sample` copies the scripted signals into the frame. */
export class ScriptedTelemetry {
  readonly frame: SignalFrame = {};
  /** Filtered rates the coach reads (set by tests). */
  rates: Record<string, number> = {};
  markSteps = 0;

  def(id: SignalId): SignalDef | undefined {
    return { id, kind: ANGLES.has(id) ? 'angle' : 'number', unit: '', hyst: 0, describe: id };
  }

  defs(): readonly SignalDef[] {
    return [];
  }

  sample(src: TelemetrySources, dt: number): SignalFrame {
    Object.assign(this.frame, (src as unknown as { signals: SignalFrame }).signals);
    this.frame['step.t'] = (typeof this.frame['step.t'] === 'number' ? this.frame['step.t'] : 0) + dt;
    return this.frame;
  }

  markStep(): void {
    this.markSteps++;
    this.frame['step.t'] = 0;
    this.frame['step.turnDeg'] = 0;
  }

  rate(id: SignalId): number {
    return this.rates[id] ?? 0;
  }

  asTelemetry(): Telemetry {
    return this as unknown as Telemetry;
  }
}

// ---- host -------------------------------------------------------------------------------------------------------

export class FakeCopilot {
  mode: 'idle' | 'holding' | 'demo' | 'recovery' = 'idle';
  demoResult: 'done' | 'aborted' | 'timeout' | null = null;
  stable = false;
  holds: Holds | null = null;
  script: DemoScript | null = null;
  recoveries: string[] = [];
  log: string[] = [];

  get flying(): boolean {
    return this.mode !== 'idle';
  }

  run(script: DemoScript, evalCtx: () => EvalContext): void {
    void evalCtx;
    this.mode = 'demo';
    this.script = script;
    this.demoResult = null;
    this.log.push(`run:${script.id}`);
  }

  holdHere(): void {
    this.mode = 'holding';
    this.log.push('hold');
  }

  recover(kind?: string): void {
    this.mode = 'recovery';
    this.demoResult = null;
    this.recoveries.push(kind ?? 'auto');
    this.log.push(`recover:${kind ?? 'auto'}`);
  }

  /** restoreLevel() references, in order (lesson-limit interventions). */
  restores: { altFt: number; hdgDeg: number | null; kias: number }[] = [];
  restoreLevel(ref: { altFt: number; hdgDeg: number | null; kias: number }): void {
    this.mode = 'recovery';
    this.demoResult = null;
    this.restores.push({ ...ref });
    this.log.push('restoreLevel');
  }

  setHolds(h: Holds | null): void {
    this.holds = h;
    this.log.push(h ? `holds:${Object.keys(h).filter((k) => k !== 'release' && k !== 'cue').join(',')}` : 'holds:none');
  }

  stop(): void {
    this.mode = 'idle';
    this.log.push('stop');
  }

  update(): void {}
}

/**
 * Speech that finishes every line at once (start then end, synchronously) unless `hold` is set, in which
 * case lines stay queued until finishAll(). Captions go to the transcript as the scheduler would.
 */
export class FakeSpeech {
  onCaption?: (c: Caption) => void;
  onEvent?: (e: 'start' | 'end', r: SpeechRequest, result?: 'done' | 'interrupted' | 'dropped') => void;
  requests: SpeechRequest[] = [];
  queue: SpeechRequest[] = [];
  transcript: Caption[] = [];
  hold = false;
  flushes = 0;
  simT = 0;
  private n = 0;

  enqueue(r: Omit<SpeechRequest, 'id'> & { id?: string }): string {
    const req: SpeechRequest = { ...r, id: r.id ?? `sp${++this.n}` };
    this.requests.push(req);
    this.queue.push(req);
    if (!this.hold) this.finishAll();
    return req.id;
  }

  finishAll(): void {
    for (const r of this.queue.splice(0)) {
      this.transcript.push({ id: r.id, actor: r.actor, channel: r.channel, text: r.caption, atWall: 0, atSim: this.simT, spoken: r.actor !== 'student' });
      this.onEvent?.('start', r);
      this.onEvent?.('end', r, 'done');
    }
  }

  /** Every cancel() match, in order. */
  cancels: { priorityAtLeast?: number; key?: string; id?: string }[] = [];
  /** As the scheduler: queued lines matching the filter are dropped. */
  cancel(match: { id?: string; key?: string; priorityAtLeast?: number }): void {
    this.cancels.push({ ...match });
    const hit = (r: SpeechRequest): boolean => (match.id === undefined || r.id === match.id) && (match.key === undefined || r.key === match.key)
      && (match.priorityAtLeast === undefined || r.priority >= match.priorityAtLeast);
    for (let i = this.queue.length - 1; i >= 0; i--) if (hit(this.queue[i])) this.onEvent?.('end', this.queue.splice(i, 1)[0], 'dropped');
  }
  update(): void {}
  pause(): void {}
  resume(): void {}
  flush(): void {
    this.flushes++;
    for (const r of this.queue.splice(0)) this.onEvent?.('end', r, 'dropped');
  }
  busy(): boolean {
    return this.queue.length > 0;
  }
  idle(): boolean {
    return this.queue.length === 0;
  }
  setBackend(): void {}
  setSimTime(t: number): void {
    this.simT = t;
  }

  /** Captions said so far, in order. */
  get captions(): string[] {
    return this.requests.map((r) => r.caption);
  }

  asScheduler(): SpeechScheduler {
    return this as unknown as SpeechScheduler;
  }
}

export class FakeUi implements TrainingUiPort {
  briefing: BriefingModel | null = null;
  strip: LessonStripModel | null = null;
  card: CardModel | null = null;
  debrief: DebriefModel | null = null;
  highlight: readonly InstrumentId[] = [];
  followMe = false;
  toasts: string[] = [];
  strips: LessonStripModel[] = [];
  showBriefing(m: BriefingModel): void { this.briefing = m; }
  hideBriefing(): void { this.briefing = null; }
  setStrip(m: LessonStripModel | null): void { this.strip = m; if (m) this.strips.push(m); }
  setCard(m: CardModel | null): void { this.card = m; }
  showDebrief(m: DebriefModel): void { this.debrief = m; }
  hideDebrief(): void { this.debrief = null; }
  showCaption(): void {}
  setHighlight(ids: readonly InstrumentId[]): void { this.highlight = ids; }
  setFollowMeThrough(on: boolean): void { this.followMe = on; }
  toast(text: string): void { this.toasts.push(text); }
}

export class FakeHost {
  copilot = new FakeCopilot();
  speech = new FakeSpeech();
  ui = new FakeUi();
  repositions: string[] = [];
  restores = 0;
  checkpoints = 0;
  hood = false;
  timeCap = 1;
  autopilotAllowed = true;
  weatherSeeds: number[] = [];
  ended: LessonResult[] = [];
  hardware: number | null = null;
  wall = 1_700_000_000_000;

  reposition(spec: { kind: string }): Promise<void> {
    this.repositions.push(spec.kind);
    return Promise.resolve();
  }
  checkpoint(): CheckpointBlob {
    this.checkpoints++;
    return { flight: { schema: 2 } as unknown as FlightSnapshot, runner: null as unknown as CheckpointBlob['runner'], traceOffset: 0 };
  }
  restore(): Promise<void> {
    this.restores++;
    return Promise.resolve();
  }
  applyWeather(_w: unknown, seed: number): void {
    this.weatherSeeds.push(seed);
  }
  setHood(on: boolean): void { this.hood = on; }
  setTimeScaleCap(max: number): void { this.timeCap = max; }
  setAutopilotAllowed(on: boolean): void { this.autopilotAllowed = on; }
  now(): number { return this.wall; }
  hardwareThrottle(): number | null { return this.hardware; }
  describeWeather(): string { return 'Wind 090/5'; }
  onLessonEnd(result: LessonResult): void { this.ended.push(result); }

  asHost(): { copilot: InstructorPilot; speech: SpeechScheduler } & Omit<FakeHost, 'copilot' | 'speech'> {
    return this as unknown as { copilot: InstructorPilot; speech: SpeechScheduler } & Omit<FakeHost, 'copilot' | 'speech'>;
  }
}

/** A seeded RNG (mulberry32) so variant choice is deterministic. */
export function seededRng(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TEST_STANDARDS = STANDARDS;

// ---- grading stand-ins (vi.mock targets) ------------------------------------------------------------------------

interface OpenAttempt { step: TaskStep; samples: number; intervened: boolean; faults: FaultRecord[]; events: string[] }

/**
 * Grader stand-in: an attempt grades 3 on success and 1 otherwise; an intervention makes it 1; a `final`
 * criterion on `checklist.score` grades by the gradeSample table so the checklist path is exercised. Counting
 * grade is the best attempt (first in check/test lessons), as the contract says.
 */
export class FakeGrader {
  static instances: FakeGrader[] = [];
  static get last(): FakeGrader {
    return FakeGrader.instances[FakeGrader.instances.length - 1];
  }
  calls: string[] = [];
  open: OpenAttempt | null = null;
  closedMap: Record<string, ExerciseResult[]> = {};
  faults: { f: FaultRecord; exerciseId: string | null }[] = [];
  /** Grade the next successful attempt gets (tests lower it to simulate a poor attempt). */
  successGrade: Grade = 3;

  constructor(readonly opts: { exercises: readonly ExerciseDef[]; firstAttemptCounts: boolean }) {
    FakeGrader.instances.push(this);
  }

  /** Phase runs are counted (not recorded in `calls`, whose sequences the tests assert). */
  phaseRuns = 0;
  beginPhaseRun(): void {
    this.phaseRuns++;
  }

  beginTask(step: TaskStep, ctx: EvalContext): void {
    void ctx;
    this.calls.push(`begin:${step.id}`);
    this.open = { step, samples: 0, intervened: false, faults: [], events: [] };
  }

  sample(ctx: EvalContext): void {
    void ctx;
    if (this.open) this.open.samples++;
  }

  onEvent(r: TrainingEventRecord): void {
    this.open?.events.push(r.type);
  }

  endTask(result: 'success' | 'fail' | 'timeout', ctx: EvalContext): ExerciseResult {
    const o = this.open;
    if (!o) throw new Error('endTask without beginTask');
    this.calls.push(`end:${o.step.id}:${result}`);
    this.open = null;
    let grade: Grade = result === 'success' ? this.successGrade : 1;
    const criteria: CriterionResult[] = [];
    for (const c of o.step.criteria) {
      if (c.kind === 'final' && c.sig === 'checklist.score') {
        const n = Number(ctx.frame[c.sig]);
        grade = n <= 0.6 ? 4 : n <= 1 ? 3 : n <= 1.25 ? 2 : 1;
      }
      criteria.push({ id: c.id, label: c.label, kind: c.kind, required: c.required, safety: c.safety === true, grade, testGrade: grade, within: 1, maxN: 0, excursions: 0, longestOutS: 0, pattern: 'ok', detail: '' });
    }
    if (o.intervened) grade = 1;
    const def = this.opts.exercises.find((e) => e.id === o.step.exercise);
    const r: ExerciseResult = {
      exerciseId: o.step.exercise, title: def?.title ?? o.step.exercise, mode: def?.mode ?? 'practice', standard: def?.standard ?? 'training',
      grade, testGrade: grade, criteria, attempts: 1, interventions: o.intervened ? 1 : 0, faults: o.faults,
    };
    (this.closedMap[r.exerciseId] ??= []).push(r);
    return r;
  }

  /** A checklist step closes an attempt directly (Grader.addResult): the exercise takes the rows' lowest grade. */
  addResult(exerciseId: string, criteria: CriterionResult[]): ExerciseResult {
    this.calls.push(`addResult:${exerciseId}`);
    const def = this.opts.exercises.find((e) => e.id === exerciseId);
    const grade = criteria.reduce<Grade>((g, c) => (c.grade < g ? c.grade : g), 4);
    const r: ExerciseResult = {
      exerciseId, title: def?.title ?? exerciseId, mode: def?.mode ?? 'practice', standard: def?.standard ?? 'training',
      grade, testGrade: grade, criteria, attempts: 1, interventions: 0, faults: [],
    };
    (this.closedMap[exerciseId] ??= []).push(r);
    return r;
  }

  abortTask(): void {
    if (this.open) this.calls.push(`abort:${this.open.step.id}`);
    this.open = null;
  }

  recordFaultOnLatest(f: FaultRecord, exerciseId: string): void {
    this.faults.push({ f, exerciseId });
  }

  lessonFaults(): readonly FaultRecord[] {
    return this.faults.filter((x) => x.exerciseId === null).map((x) => x.f);
  }

  recordFault(f: FaultRecord, exerciseId: string | null): void {
    this.faults.push({ f, exerciseId });
    this.open?.faults.push(f);
  }

  /** Lesson-limit interventions: [exerciseId, limitId, discarded]. */
  limits: [string, string, boolean][] = [];
  recordLimitIntervention(exerciseId: string, limitId: string, discarded = true): void {
    this.calls.push(`limit:${limitId}`);
    this.limits.push([exerciseId, limitId, discarded]);
  }

  recordIntervention(): void {
    this.calls.push('intervention');
    if (this.open) this.open.intervened = true;
  }

  exerciseGrade(id: string): Grade | null {
    const list = this.closedMap[id];
    if (!list?.length) return null;
    if (this.opts.firstAttemptCounts) return list[0].grade;
    return list.reduce<Grade | null>((best, r) => (r.grade !== null && (best === null || r.grade > best) ? r.grade : best), null);
  }

  closed(): Record<string, ExerciseResult[]> {
    return JSON.parse(JSON.stringify(this.closedMap)) as Record<string, ExerciseResult[]>;
  }

  restore(closed: Record<string, ExerciseResult[]>): void {
    this.calls.push('restore');
    this.closedMap = JSON.parse(JSON.stringify(closed)) as Record<string, ExerciseResult[]>;
  }

  exerciseResults(): ExerciseResult[] {
    return this.opts.exercises.map((def) => {
      const list = this.closedMap[def.id] ?? [];
      const best = this.opts.firstAttemptCounts ? list[0] : [...list].sort((a, b) => (b.grade ?? 0) - (a.grade ?? 0))[0];
      return best ?? { exerciseId: def.id, title: def.title, mode: def.mode, standard: def.standard, grade: null, testGrade: null, criteria: [], attempts: 0, interventions: 0, faults: [] };
    });
  }
}

export interface OutcomeArgs {
  lesson: { kind: string; exercises: ExerciseDef[] };
  exercises: readonly ExerciseResult[];
  assessedInterventions: number;
  ended: 'completed' | 'abandoned' | 'crashed' | 'timeUp';
  failedSections?: number[]; criticalFault?: boolean;
}

export const outcomeCalls: OutcomeArgs[] = [];

/** The section 3.4 outcome rule, without the carry-over of earlier runs (module 2 owns that detail). */
export function fakeLessonOutcome(i: OutcomeArgs): LessonResult['outcome'] {
  outcomeCalls.push(i);
  if (i.ended === 'crashed') return 'crashed';
  if (i.ended === 'abandoned') return 'abandoned';
  if (i.ended === 'timeUp') return 'incomplete';
  if (i.lesson.kind === 'test') {
    if (i.criticalFault || (i.failedSections?.length ?? 0) > 1) return 'testFail';
    return i.failedSections?.length ? 'testPartial' : 'testPass';
  }
  const required = i.lesson.exercises.filter((e) => e.required);
  const ok = required.every((d) => (i.exercises.find((r) => r.exerciseId === d.id)?.grade ?? 0) >= 2);
  return ok && i.assessedInterventions === 0 ? 'competent' : 'notYet';
}

export function fakeLessonStars(i: { outcome: string; phaseRetries: number }): 0 | 1 | 2 | 3 {
  return i.outcome === 'competent' ? (i.phaseRetries > 0 ? 1 : 2) : 0;
}

export function fakeBuildDebrief(): LessonResult['debrief'] {
  return { strength: 'Good climbs.', main: 'Level-offs.', next: 'Turns next.', spoken: ['Competent. Main point: level-offs.'] };
}

/** Derived-event detectors stand-in: the tests emit events on the bus themselves. */
export class NullDetector {
  resets = 0;
  armed: number[] = [];
  update(): null { return null; }
  armRollout(h: number): void { this.armed.push(h); }
  onTouchdown(): void {}
  reset(): void { this.resets++; }
}

export type { SignalValue };
