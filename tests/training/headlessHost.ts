// The headless Flight School host (spec section 6.4.3): the real SimPhysics, LessonRunner, InstructorPilot,
// Telemetry, Grader and SpeechScheduler (with the CaptionBackend on a simulated clock) and an in-memory
// career store, without a DOM. It implements RunnerHost the way src/training/TrainingSystem.ts does in the
// browser, minus the curtain: repositions and checkpoint restores happen at once, between frames.
//
// FRAME LOOP (HeadlessLesson.run): every frame (FRAME_DT of sim time) the physics advances in whole 240 Hz
// steps (the copilot and the student's hands run inside each step), then the runner updates with the same
// dt, then speech advances on a wall clock that runs with the simulation (1x). Touchdown and crash SimEvents
// are delivered from inside the physics step exactly as in the browser, so landings are step-exact.
//
// The student: an AutoStudent (tests/training/autoStudent.ts) installed in front of the copilot, as
// TrainingSystem does for student=auto, or nobody (a lesson flown by the instructor alone).

import { createEventBus, type EventBus } from '../../src/core/context';
import { FPM } from '../../src/core/math';
import { applyControls, defaultWeather, type WeatherSettings } from '../../src/core/types';
import { mulberry32 } from '../../src/physics/weather/random';
import type { FlightSnapshot } from '../../src/sim/resume';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { buildStart, type StartOptions, type StartSpec } from '../../src/sim/starts';
import { C172S } from '../../src/training/aircraft/c172s';
import { defaultSettings } from '../../src/training/career/defaults';
import { memoryStore, TrainingStore } from '../../src/training/career/store';
import { DEMOS } from '../../src/training/content/demos';
import { LINES } from '../../src/training/content/lines';
import { buildWeather, weatherLine } from '../../src/training/content/weatherPresets';
import { InstructorPilot } from '../../src/training/copilot/instructorPilot';
import { TrainingBus } from '../../src/training/engine/bus';
import { touchdownData } from '../../src/training/engine/events';
import { resolveRef } from '../../src/training/engine/refs';
import { LessonRunner, type RunnerDeps, type RunnerHost } from '../../src/training/engine/runner';
import { STANDARDS } from '../../src/training/grading/standards';
import { CaptionBackend } from '../../src/training/speech/captionBackend';
import { SpeechScheduler } from '../../src/training/speech/scheduler';
import { Telemetry } from '../../src/training/telemetry/telemetry';
import type {
  AuthorityId, BriefingModel, Caption, CardModel, CheckpointBlob, DebriefModel, RunSnapshot, InstrumentId, Lesson, LessonProgress,
  LessonResult, LessonStripModel, StepController, TelemetrySources, TraceData, TrainingEventRecord, TrainingSettings,
  TrainingUiPort, WeatherSpec,
} from '../../src/training/types';

/** Rendered-frame period of the headless loop, s (the recorded fixtures use 30 Hz too). */
export const FRAME_DT = 1 / 30;

/** The UI port, recording what the runner publishes. */
export class RecordingUi implements TrainingUiPort {
  briefing: BriefingModel | null = null;
  strip: LessonStripModel | null = null;
  card: CardModel | null = null;
  debrief: DebriefModel | null = null;
  highlight: readonly InstrumentId[] = [];
  followMe = false;
  toasts: string[] = [];
  showBriefing(m: BriefingModel): void { this.briefing = m; }
  hideBriefing(): void { this.briefing = null; }
  setStrip(m: LessonStripModel | null): void { this.strip = m; }
  setCard(m: CardModel | null): void { this.card = m; }
  showDebrief(m: DebriefModel): void { this.debrief = m; }
  hideDebrief(): void { this.debrief = null; }
  showCaption(c: Caption): void { void c; }
  setHighlight(ids: readonly InstrumentId[]): void { this.highlight = ids; }
  setFollowMeThrough(on: boolean): void { this.followMe = on; }
  toast(text: string): void { this.toasts.push(text); }
}

/** What flies the student's side: the AutoStudent and its variants (see autoStudent.ts). */
export interface HeadlessStudent {
  readonly flying: boolean;
  update(h: number, s: SimPhysics['state'], c: SimPhysics['controls']): void;
  tick(runner: LessonRunner, frameDt: number): void;
  reset(): void;
}

export interface HeadlessOptions {
  /** Authority of the run (default EASA). */
  authority?: AuthorityId;
  /** Training settings (defaults for the authority). */
  settings?: Partial<TrainingSettings>;
  /** This lesson's progress before the run (sign-offs carry over), or null. */
  progress?: LessonProgress | null;
  /** The player's weather the lesson's preset is applied over (default: defaultWeather()). */
  weather?: Partial<WeatherSettings>;
  /** Attempt number (weather seed). */
  attempt?: number;
  /** Start at this phase (phase=). */
  startPhase?: string;
  /** Wall clock at the start, ms (results' startedAt). */
  wallStartMs?: number;
  /**
   * Resume a lesson as after a page reload (section 3.10): the flight is restored from the snapshot and the
   * runner rebuilt with LessonRunner.restore (the current step restarts).
   */
  resume?: { flight: FlightSnapshot; run: RunSnapshot; checkpoint?: CheckpointBlob | null };
}

/**
 * One lesson flown headless. `host` is the RunnerHost; `runner` the real LessonRunner. Call begin(), then
 * run() (or step frames yourself with frame()).
 */
export class HeadlessLesson {
  readonly physics: SimPhysics;
  readonly weather: WeatherSettings;
  readonly events: EventBus;
  readonly copilot: InstructorPilot;
  readonly speech: SpeechScheduler;
  readonly ui = new RecordingUi();
  readonly store = new TrainingStore(memoryStore());
  readonly telemetry = new Telemetry();
  readonly bus = new TrainingBus();
  readonly runner: LessonRunner;
  readonly host: RunnerHost;
  /** Every training event of the run, in order (the bus itself is trimmed by the runner). */
  readonly log: TrainingEventRecord[] = [];
  /** The lesson's end (any outcome). */
  ended: { result: LessonResult; trace: TraceData } | null = null;
  /** Crashes seen (SimEvents). */
  crashes: string[] = [];
  repositions = 0;
  restores = 0;
  /** The time-scale cap and autopilot gate the runner asked for (for assertions). */
  timeCap = Number.POSITIVE_INFINITY;
  autopilotAllowed = true;
  hood = false;
  /** Simulated wall clock, ms. */
  wallMs: number;
  private student: HeadlessStudent | null = null;
  private readonly baseWeather: WeatherSettings;

  constructor(readonly lesson: Lesson, opts: HeadlessOptions = {}) {
    this.baseWeather = { ...defaultWeather(), ...opts.weather };
    this.weather = { ...this.baseWeather };
    this.events = createEventBus();
    this.physics = new SimPhysics({ weather: this.weather, events: this.events });
    if (opts.resume) {
      Object.assign(this.weather, opts.resume.flight.weather);
      this.physics.restore(opts.resume.flight);
    } else {
      this.physics.reset('runway', this.weather);
    }
    this.wallMs = opts.wallStartMs ?? Date.UTC(2026, 5, 1, 9, 0, 0);
    this.copilot = new InstructorPilot(C172S);
    this.speech = new SpeechScheduler(new CaptionBackend(() => this.wallMs), () => this.wallMs);
    this.bus.on('*', (r) => this.log.push(r));
    this.host = this.makeHost();
    const settings: TrainingSettings = { ...defaultSettings(opts.authority ?? 'easa'), ...opts.settings };
    const deps: RunnerDeps = {
      aircraft: C172S, standards: STANDARDS, authority: opts.authority ?? 'easa', lines: LINES, rng: mulberry32(opts.attempt ?? 1),
      telemetry: this.telemetry, bus: this.bus, settings, demos: DEMOS, progress: opts.progress ?? null, attempt: opts.attempt ?? 1,
      startPhase: opts.startPhase, store: this.store, instructorName: 'Kate Mercer',
    };
    this.runner = opts.resume ? LessonRunner.restore(lesson, this.host, deps, opts.resume.run) : new LessonRunner(lesson, this.host, deps);
    if (opts.resume?.checkpoint) this.runner.adoptCheckpoint(opts.resume.checkpoint);
    this.copilot.setContext(() => this.runner.evalContext);
    this.copilot.onSay = (cue) => this.runner.say(cue);
    const copilot = this.copilot;
    const self = this;
    const controller: StepController = {
      get flying() {
        return copilot.flying;
      },
      update(h, s, c) {
        if (self.student && !copilot.flying) self.student.update(h, s, c);
        copilot.update(h, s, c);
      },
    };
    this.physics.copilot = controller;
    this.events.on('touchdown', (e) => {
      const sinkFpm = e.sinkRate / FPM;
      this.runner.onTouchdown(e.wheel, sinkFpm, touchdownData(this.physics.fm.state, e.wheel, sinkFpm));
    });
    this.events.on('crash', (e) => {
      this.crashes.push(e.reason);
      this.runner.onCrash(e.reason);
    });
  }

  /** Install the student (before begin()). */
  setStudent(s: HeadlessStudent | null): void {
    this.student = s;
  }

  /** Captions so far, oldest first. */
  get captions(): string[] {
    return this.speech.transcript.map((c) => c.text);
  }

  /** begin() and startFlight() (the briefing is skipped, as brief=0); a resumed runner is already flying. */
  async begin(): Promise<void> {
    if (this.runner.resumed) return;
    await this.runner.begin();
    this.runner.startFlight();
  }

  /** One rendered frame: physics, runner, student decisions, speech. */
  frame(): void {
    const p = this.physics;
    if (this.runner.phase === 'running' && !p.state.crashed) p.step(FRAME_DT);
    else p.lastAdvance = 0;
    const dt = p.lastAdvance;
    this.wallMs += FRAME_DT * 1000;
    this.runner.update(dt, FRAME_DT, this.sources());
    if (this.student && this.runner.phase === 'running') this.student.tick(this.runner, dt);
    this.speech.update();
  }

  /**
   * Fly until the lesson ends (debrief or ended) or `maxSimS` passes. Microtasks run between frames, so the
   * runner's awaited repositions and restores complete as they do in the browser.
   */
  async run(maxSimS = this.lesson.rules.maxDurationS + 120, onFrame?: (t: number) => void): Promise<LessonResult | null> {
    let t = 0;
    while (t < maxSimS && this.runner.phase === 'running') {
      this.frame();
      t += FRAME_DT;
      onFrame?.(t);
      // Let resolved promises (reposition, restore, retry) settle before the next frame.
      await Promise.resolve();
      await Promise.resolve();
    }
    return this.ended?.result ?? this.runner.result();
  }

  sources(): TelemetrySources {
    const p = this.physics;
    return {
      state: p.state, controls: p.controls, readings: null, weather: this.weather, env: p.env, aircraft: C172S,
      studentInput: this.student?.flying ?? false, timeScale: 1, route: this.lesson.route ?? null,
    };
  }

  private makeHost(): RunnerHost {
    const p = this.physics;
    return {
      reposition: (spec: StartSpec, opts?: StartOptions) => {
        this.repositions++;
        this.speech.flush();
        if (spec.kind === 'scenario') p.reset(spec.id, this.weather);
        else {
          const ctx = this.runner?.evalContext;
          p.resetTo(buildStart(spec, p.env, opts ?? this.lesson.startOptions ?? {}, ctx ? (r) => resolveRef(r, ctx) : undefined), this.weather);
        }
        this.copilot.resync();
        this.student?.reset();
        return Promise.resolve();
      },
      checkpoint: (): CheckpointBlob => ({ flight: this.capture(), runner: null as unknown as CheckpointBlob['runner'], traceOffset: 0 }),
      restore: (cp) => {
        this.restores++;
        this.speech.flush();
        Object.assign(this.weather, cp.flight.weather);
        p.restore(cp.flight);
        this.copilot.resync();
        this.student?.reset();
        return Promise.resolve();
      },
      applyWeather: (w: WeatherSpec, seed: number) => {
        Object.assign(this.weather, buildWeather(w, this.baseWeather, mulberry32(seed)));
      },
      copilot: this.copilot,
      speech: this.speech,
      setHood: (on) => (this.hood = on),
      setTimeScaleCap: (max) => (this.timeCap = max),
      setAutopilotAllowed: (on) => (this.autopilotAllowed = on),
      ui: this.ui,
      now: () => this.wallMs,
      setControls: (c) => {
        applyControls(p.controls, c);
      },
      hardwareThrottle: () => null,
      describeWeather: () => weatherLine(this.weather),
      onLessonEnd: (result, trace) => {
        this.ended = { result, trace };
      },
    };
  }

  /** The flight as a resume snapshot (checkpoints, the reload test). */
  capture(): FlightSnapshot {
    return this.physics.captureSnapshot({ weather: this.weather, cameraMode: 'cockpit', quality: 'high', renderScale: null, resume: true, now: this.wallMs });
  }
}

/** Short text of a result for test failure messages: outcome, then each exercise and its failing criteria. */
export function describeResult(r: LessonResult | null): string {
  if (!r) return 'no result';
  const lines = [`${r.lessonId} ${r.outcome} stars=${r.stars} interventions=${r.interventions} retries=${r.phaseRetries}`];
  for (const e of r.exercises) {
    const bad = e.criteria.filter((c) => c.required && c.grade < 2).map((c) => `${c.id}=${c.grade} (${c.detail})`);
    lines.push(`  ${e.exerciseId} grade=${e.grade} test=${e.testGrade} attempts=${e.attempts}${bad.length ? ` failing: ${bad.join('; ')}` : ''}${e.faults.length ? ` faults: ${e.faults.map((f) => f.id).join(',')}` : ''}`);
  }
  return lines.join('\n');
}
