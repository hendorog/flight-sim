// Flight School glue (spec sections 1.1, 3.1, 3.10, 3.11, 5.9 and 5.10): a Subsystem that owns the career
// store, the speech scheduler and its backends, the instructor-pilot, one LessonRunner at a time and the
// school UI, and implements RunnerHost for the runner. Created by Simulator after the UI; update() runs after
// panel.update (indicated signals need fresh InstrumentReadings). Free flight is unchanged while no lesson is
// active: every hook below is a no-op without a runner.
//
// WHAT LIVES WHERE
//   - The runner never touches the simulator: repositions, checkpoints, weather, hood, time-scale cap and the
//     autopilot gate come through the RunnerHost methods here, which go through TrainingShell (Simulator's
//     curtain and physics) and the SchoolUi.
//   - SimEvents touchdown / crash are handled synchronously inside the physics step, so TouchdownData is
//     step-exact (section 3.1). A crash in a dual lesson freezes the runner until the pilot picks an action
//     on the lesson crash panel (section 3.10).
//   - Speech: one SpeechScheduler; WebSpeechBackend when the browser has voices, else (or after its error
//     downgrade, or with voice=0 / "captions only") the CaptionBackend with the same pacing. Captions are
//     drawn when a line starts; engine audio is ducked while the cabin speaks.
//   - Persistence: results, logbook, traces and the latest checkpoint through TrainingStore; the reload block
//     (FlightSnapshot.training, schema 2) is built by resumeBlock() for Simulator.persist().
//
// Choices where the spec is silent (reported): opening the home screen does not move the aircraft to the
// apron (the player's free flight would be lost), it holds the sim where it is; the welcome card and home
// are not opened automatically in an automated browser (navigator.webdriver) unless school=1, as the
// first-flight hints card already behaves, so scripted free-flight runs keep working.

import * as THREE from 'three';
import type { CameraMode, SimContext, Subsystem } from '../core/context';
import { FPM } from '../core/math';
import { aircraftSummary, isAircraftId } from '../aircraft/registry';
import { applyControls, type AircraftId, type WeatherSettings } from '../core/types';
import { trainingKeyFor } from '../input/bindings';
import { mulberry32 } from '../physics/weather/random';
import { COCKPIT_CONTROLS, cockpitControls } from '../render/aircraft/cockpit';
import { setCockpitGlance } from '../render/cameras/cockpitRig';
import type { SchoolParams } from '../sim/params';
import type { FlightSnapshot } from '../sim/resume';
import type { Scenario } from '../sim/scenarios';
import type { SimPhysics } from '../sim/SimPhysics';
import { buildStart } from '../sim/starts';
import type { UISystem } from '../ui';
import type { CrashAction } from '../ui/overlays';
import type { SchoolAircraft, SchoolCareer, SchoolImportPreview, SchoolVoice } from '../ui/school/models';
import { SchoolUi } from '../ui/school/schoolUi';
import { DEFAULT_AIRCRAFT, getAircraftType, hasAircraftType, SCHOOL_AIRCRAFT, schoolSupports } from './aircraft/registry';
import { addBest, scoreChallenge } from './career/challenges';
import { DEFAULT_INSTRUCTOR, DEFAULT_STUDENT, defaultSettings } from './career/defaults';
import { logbookEntryFor } from './career/logbook';
import { applyResult, lessonStatuses, nextLesson } from './career/progress';
import { exportFileName, memoryStore, TrainingStore } from './career/store';
import { validateTrainingBlock } from './career/validate';
import { DEMOS } from './content/demos';
import { LINES } from './content/lines';
import { PERSONAS } from './content/personas';
import { CHALLENGES, lessonById, SYLLABUS } from './content/syllabus/index';
import { buildWeather, weatherLine } from './content/weatherPresets';
import { InstructorPilot } from './copilot/instructorPilot';
import { TrainingBus } from './engine/bus';
import { touchdownData } from './engine/events';
import { resolveRef, resolveTol } from './engine/refs';
import { LessonRunner, type DebriefExtras, type RunnerDeps, type RunnerHost } from './engine/runner';
import { normalisedError } from './grading/accumulators';
import { STANDARDS } from './grading/standards';
import { CaptionBackend } from './speech/captionBackend';
import { SpeechScheduler } from './speech/scheduler';
import { pickVoice, type VoiceInfo } from './speech/voices';
import { WebSpeechBackend } from './speech/webSpeech';
import { Telemetry } from './telemetry/telemetry';
import {
  Priority,
  type AuthorityId, type BriefingModel, type Caption, type CardModel, type ChallengeDef, type CheckpointBlob, type CueRef,
  type CalloutModel, type DebriefModel, type LandingData, type Lesson, type PointTarget, type TaxiGuideModel, type LessonResult, type LessonStripModel, type RunnerCommand, type SchoolCommand,
  type SpeechRequest, type StartOptions, type StartSpec, type StepController, type TaskStep, type TelemetrySources,
  type TraceData, type TrainingResumeBlock, type TrainingSave, type TrainingUiPort, type WeatherSpec,
  type AircraftTypeDef, type AircraftTypeId,
} from './types';

/** Options for starting a lesson (URL lesson=, phase=, brief=, standard=; __sim.training.start). */
export interface LessonStartOptions { phase?: string; brief?: boolean; standard?: 'easa' | 'faa' }

/** What Simulator gives the Flight School (its curtain, physics and shell state). */
export interface TrainingShell {
  readonly physics: SimPhysics;
  /** The live weather object (shared with the physics, the sky and the UI). */
  readonly weather: WeatherSettings;
  readonly params: SchoolParams;
  readonly ui: UISystem;
  /** Indicated readings of the panel (null before the panel exists). */
  readings(): TelemetrySources['readings'];
  /** The pilot is working the flight controls (keys held, hardware moved): InputSystem.pilotFlying(). */
  pilotFlying(): boolean;
  /** Keyboard assists on (logbook flag) and the input in use. */
  inputFlags(): Pick<LessonResult['flags'], 'kbdAssists' | 'inputDevice'>;
  /** Curtain, physics.resetTo(sc), the 'reset' event with the lesson id; resolves once flying again. */
  startFrom(sc: Scenario, opts: { lessonId: string; label: string }): Promise<void>;
  /** Curtain, then restore a saved flight (checkpoint retry); resolves once flying again. */
  restoreFlight(snap: FlightSnapshot, opts: { lessonId: string; label: string }): Promise<void>;
  /** The flight now, as a resume snapshot (the checkpoint's flight part). */
  captureFlight(): FlightSnapshot;
  /** Hold the simulation (dt 0) while a school screen is open. */
  setHold(on: boolean): void;
  setCameraMode(mode: CameraMode): void;
  /** Speech chime and ducking (AudioSystem.setDuck / chime), absent in tests. */
  audio?: { setDuck(amount: number): void; chime(kind: 'intercom' | 'caption' | 'radio'): void };
  /** Write the reload snapshot now (lesson start, phase entries). */
  persist(): void;
  /** The type being flown (chosen at boot, fixed for the session). Absent = 'c172s'. */
  aircraftId?(): AircraftId;
}

/** The AutoStudent's surface (tests/training/autoStudent.ts), loaded only with student=auto. */
interface AutoPilotStudent {
  readonly flying: boolean;
  update(h: number, s: SimPhysics['state'], c: SimPhysics['controls']): void;
  tick(runner: LessonRunner, frameDt: number): void;
  reset(): void;
}

/** Captions-only toast (section 3.7.2), shown once per session. */
const NO_VOICE_TOAST = 'No speech voices available. The instructor will use captions. (Linux: install speech-dispatcher and a voice.)';
/** The welcome card waits this long after the first user gesture for voices before going captions-only, ms. */
const VOICE_GRACE_MS = 3000;
/** Build string written into exports (the save format carries it; this is not a release number). */
const APP_BUILD = 'fs-dev';

const uuid = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
};

/** Per-lesson session state (cleared when the lesson's debrief closes or it is abandoned). */
interface Session {
  lesson: Lesson;
  runner: LessonRunner;
  challenge: ChallengeDef | null;
  practiceOnly: boolean;
  authority: AuthorityId;
  /** Started from phase= / "Try one exercise": no logbook credit. */
  partial: boolean;
  /** Challenge scoring collected while flying. */
  score: { landing: LandingData | null; nSum: number; nT: number; glideIn: number; glideT: number; stallWarning: boolean };
  /** Unsubscribers of the run's bus listeners. */
  unsub: (() => void)[];
  /** Coach remarks so far and the last one's topic (automation: the fly-lesson script's coaching screenshot). */
  hints: { count: number; topic: string | null };
  /** Last authority and phase announced on the SimEvents 'lesson' channel. */
  lastAuthority: string;
  lastPhaseId: string;
  started: boolean;
}

export class TrainingSystem implements Subsystem {
  readonly store: TrainingStore;
  readonly speech: SpeechScheduler;
  readonly copilot: InstructorPilot;
  school!: SchoolUi;

  private ctx!: SimContext;
  private save: TrainingSave | null;
  private web: WebSpeechBackend | null = null;
  private captionsBackend = new CaptionBackend(() => performance.now());
  private session: Session | null = null;
  /** The player's weather before the lesson changed it (restored when the lesson ends). */
  private playerWeather: WeatherSettings | null = null;
  private timeCap = Number.POSITIVE_INFINITY;
  private apAllowed = true;
  private hoodOn = false;
  /** A crash in a dual lesson waiting for the pilot's choice on the lesson crash panel. */
  private crashPending: string | null = null;
  private lastWall = -1;
  private noVoiceToastShown = false;
  private autoStudent: AutoPilotStudent | null = null;
  private readonly unsub: (() => void)[] = [];
  private lastStrip: LessonStripModel | null = null;
  private lastCard: CardModel | null = null;
  private lastBriefing: BriefingModel | null = null;
  private lastDebrief: DebriefModel | null = null;
  private lastCallout: CalloutModel | null = null;
  private lastTaxi: TaxiGuideModel | null = null;
  /** The cockpit group (render/aircraft/cockpit.ts) whose model space the control points are in. */
  private cockpitObj: THREE.Object3D | null = null;
  /** Control and instrument positions of the flown type's cockpit (COCKPIT_CONTROLS without a presentation). */
  private controlPoints: Readonly<Record<PointTarget, { x: number; y: number; z: number }>> = COCKPIT_CONTROLS;
  private readonly pv = new THREE.Vector3();
  private readonly pc = new THREE.Vector3();

  /** The display port the runner publishes to: SchoolUi, with the last models kept for the automation API. */
  private readonly port: TrainingUiPort = {
    showBriefing: (m) => {
      this.lastBriefing = m;
      this.school.showBriefing(m);
    },
    hideBriefing: () => this.school.hideBriefing(),
    setStrip: (m) => {
      this.lastStrip = m;
      this.school.setStrip(m);
    },
    setCard: (m) => {
      this.lastCard = m;
      this.school.setCard(m);
    },
    showDebrief: (m) => {
      this.lastDebrief = m;
      this.school.showDebrief(m);
    },
    hideDebrief: () => this.school.hideDebrief(),
    showCaption: (c) => this.school.showCaption(c),
    setHighlight: (ids) => this.school.setHighlight(ids),
    setFollowMeThrough: (on) => this.school.setFollowMeThrough(on),
    toast: (t) => this.school.toast(t),
    setCallout: (c) => {
      this.lastCallout = c;
      this.school.setCallout(c);
    },
    setTaxiGuide: (m) => {
      this.lastTaxi = m;
      this.school.setTaxiGuide(m);
    },
  };

  constructor(private readonly shell: TrainingShell) {
    const p = shell.params;
    this.store = new TrainingStore(p.memoryStore ? memoryStore() : browserKv());
    this.save = this.store.load();
    this.speech = new SpeechScheduler(this.captionsBackend, () => performance.now());
    this.copilot = new InstructorPilot(this.aircraftDef);
  }

  /** The type being flown ('c172s' when the shell does not say). */
  get aircraftId(): AircraftTypeId {
    return this.shell.aircraftId?.() ?? DEFAULT_AIRCRAFT;
  }

  /**
   * The flown type's school data. Lessons run only in a school type (D5), so inside a lesson this is that
   * type's def; outside one, a type the school holds no def for reads as the default (nothing uses it then:
   * the instructor-pilot is idle).
   */
  private get aircraftDef(): AircraftTypeDef {
    const id = this.aircraftId;
    return getAircraftType(hasAircraftType(id) ? id : DEFAULT_AIRCRAFT);
  }

  // ---- Subsystem -------------------------------------------------------------------------------------------

  init(ctx: SimContext): void {
    this.ctx = ctx;
    const shell = this.shell;
    // Test contexts are built by cast and may lack the presentation.
    const pres = (ctx as Partial<SimContext>).presentation;
    if (pres) this.controlPoints = cockpitControls(pres.visual.cockpit, pres.panel);
    this.school = new SchoolUi(shell.ui.schoolLayer, {
      loadTrace: (id) => this.store.getTrace(id),
      previewImport: (json) => this.previewImport(json),
      testVoice: (persona, voiceURI) => this.testVoice(persona, voiceURI),
      updateProfile: (p) => this.updateProfile(p),
      playDebrief: (lines) => {
        for (const text of lines) this.enqueueSystemLine(text);
      },
    });
    shell.ui.attachSchool(this.school);
    this.school.setCalloutView((t) => this.projectControl(t), (t) => this.glance(t));
    this.school.onCommand = (cmd) => this.command(cmd);
    // Every school screen (home, briefing, debrief...) holds the simulation behind it.
    this.school.onScreenChange = (screen) => shell.setHold(screen !== null);
    shell.ui.crashActions = (reason) => this.crashActions(reason);
    this.installSpeech();
    this.installCopilot();
    const ev = ctx.events;
    this.unsub.push(
      ev.on('touchdown', (e) => {
        const r = this.session?.runner;
        if (!r || r.phase !== 'running') return;
        const sinkFpm = e.sinkRate / FPM;
        r.onTouchdown(e.wheel, sinkFpm, touchdownData(shell.physics.fm.state, e.wheel, sinkFpm));
      }),
      ev.on('crash', (e) => this.onCrash(e.reason)),
      ev.on('paused', (e) => (e.paused ? this.speech.pause() : this.speech.resume())),
    );
    this.refreshCareer();
  }

  update(dt: number, ctx: SimContext): void {
    const now = performance.now();
    const wallDt = this.lastWall < 0 ? 0 : Math.min(0.25, (now - this.lastWall) / 1000);
    this.lastWall = now;
    const s = this.session;
    const physics = this.shell.physics;
    if (s && !this.crashPending) {
      const r = s.runner;
      // The instructor flying means the student's own autopilot is off (it would fight the copilot).
      if (this.copilot.flying && physics.autoflight.engaged) physics.setAutoflight(false);
      if (this.hoodOn && ctx.cameraMode !== 'cockpit') this.shell.setCameraMode('cockpit');
      r.update(dt, wallDt, this.sources(s.lesson, ctx));
      if (this.autoStudent && r.phase === 'running') this.autoStudent.tick(r, dt);
      if (dt > 0) this.collectScore(s, r);
      this.announce(s);
      this.afterRunnerFrame(s);
    }
    this.speech.setSimTime(s?.runner.evalContext.simT ?? ctx.simTime);
    this.speech.update();
  }

  dispose(): void {
    for (const u of this.unsub) u();
    this.shell.physics.copilot = null;
    this.shell.ui.crashActions = null;
    this.shell.ui.attachSchool(null);
    this.web?.dispose();
    this.school.dispose();
    this.store.flush();
  }

  // ---- State for the shell -----------------------------------------------------------------------------------

  /** True while a lesson is running (key routing, time-scale clamp, autopilot gate). */
  get active(): boolean {
    return this.session?.runner.phase === 'running';
  }

  /** A lesson exists in any phase (briefing, running, debrief): scenario resets ask before abandoning it. */
  get inLesson(): boolean {
    return this.session !== null;
  }

  /** The lesson's time-acceleration cap (Infinity outside a lesson). */
  get timeScaleCap(): number {
    return this.active ? this.timeCap : Number.POSITIVE_INFINITY;
  }

  /** The A key engages the autopilot (false when the exercise forbids it). */
  get autopilotAllowed(): boolean {
    return !this.active || this.apAllowed;
  }

  get runner(): LessonRunner | null {
    return this.session?.runner ?? null;
  }

  profile(): TrainingSave | null {
    return this.save;
  }

  /** FlightSnapshot.training for a reload (null when no lesson is being flown). */
  resumeBlock(): TrainingResumeBlock | null {
    const s = this.session;
    if (!s || s.runner.phase !== 'running' || s.challenge) return null;
    return {
      lessonId: s.lesson.id, lessonVersion: s.lesson.version, run: s.runner.snapshot(), start: s.lesson.start,
      checkpoint: this.store.loadCheckpoint(), aircraftId: this.aircraftId,
    };
  }

  /** window.__sim.training.state() (section 5.10): where the lesson is, the card and the last captions. */
  state(): Record<string, unknown> {
    const s = this.session;
    const r = s?.runner;
    const step = r?.currentStep ?? null;
    return {
      lesson: s?.lesson.id ?? null,
      title: s?.lesson.title ?? null,
      phase: r?.phase ?? null,
      phaseId: r?.position.phaseId ?? null,
      stepId: r?.position.stepId ?? null,
      stepKind: step?.def.kind ?? null,
      stepStatus: step?.status ?? null,
      authority: r?.authority.who ?? null,
      handover: r?.authority.handover ?? null,
      limitIntervention: r?.limitIntervention ?? null,
      vars: r ? { ...r.position.vars } : {},
      simT: r?.evalContext.simT ?? 0,
      strip: this.lastStrip,
      card: this.lastCard,
      briefing: this.lastBriefing ? { lessonId: this.lastBriefing.lesson.id, weatherLine: this.lastBriefing.weatherLine } : null,
      outcome: r?.result()?.outcome ?? null,
      crashPending: this.crashPending,
      hints: s ? { ...s.hints } : null,
      screen: this.school.screen,
      callout: this.lastCallout,
      taxi: this.lastTaxi,
      glancing: this.school.guidanceState.glancing,
      captions: this.speech.transcript.slice(-10).map((c) => `${c.actor}: ${c.text}`),
    };
  }

  // ---- Boot (section 1.1) --------------------------------------------------------------------------------------

  /**
   * After the loading screen lifts: lesson= opens its briefing; a resumed snapshot with a training block
   * resumes the lesson; otherwise the welcome card or the home opens (unless scenario=, school=0, a resumed
   * free flight or an automated browser).
   */
  afterBoot(o: { resumed: FlightSnapshot | null; explicitScenario: boolean }): void {
    const sp = this.shell.params;
    const block = o.resumed?.training !== undefined ? validateTrainingBlock(o.resumed.training) : null;
    // A reload of a lesson= URL mid-lesson resumes that lesson (section 3.10); another lesson= starts fresh.
    if (sp.lesson && !(block && block.lessonId === sp.lesson)) {
      void this.start(sp.lesson, { phase: sp.phase ?? undefined, brief: sp.brief, standard: sp.standard ?? undefined });
      return;
    }
    if (block) {
      void this.resume(block);
      return;
    }
    if (sp.open === false) return;
    const automated = typeof navigator !== 'undefined' && !!navigator.webdriver;
    if (sp.open !== true && (o.resumed || o.explicitScenario || automated)) return;
    if (!this.save) {
      if (sp.open === true || !this.store.welcomeDismissed) this.school.open('welcome');
    } else {
      this.school.open('home');
    }
  }

  // ---- Lessons -------------------------------------------------------------------------------------------------

  /** Open a lesson: position behind the curtain and show its briefing (`brief: false` starts flying at once). */
  async start(lessonId: string, opts: LessonStartOptions = {}): Promise<void> {
    const challenge = CHALLENGES.find((c) => c.id === lessonId || c.lesson.id === lessonId) ?? null;
    const lesson = challenge?.lesson ?? lessonById(lessonId);
    if (!lesson) {
      this.school.toast(`No lesson '${lessonId}'`);
      return;
    }
    if (this.refuseType()) return;
    this.endSession();
    const save = this.ensureSave();
    const authority = opts.standard ?? this.shell.params.standard ?? save.settings.authority;
    const status = lessonStatuses(save, SYLLABUS, authority)[lesson.id];
    const partial = opts.phase !== undefined;
    const practiceOnly = !challenge && (partial || this.shell.params.unlock || (status !== 'available' && status !== 'competent'));
    const deps = this.runnerDeps(lesson, save, authority, { startPhase: opts.phase, practiceOnly });
    const runner = new LessonRunner(lesson, this.host(lesson), deps);
    this.session = this.newSession(lesson, runner, deps, challenge, practiceOnly, authority, partial);
    this.school.close();
    await this.loadAutoStudent();
    await runner.begin();
    if (opts.brief === false && this.session?.runner === runner) this.startFlight();
  }

  /** Rebuild a lesson after a reload (section 3.10): the current step restarts; a new version re-briefs. */
  async resume(block: TrainingResumeBlock): Promise<void> {
    const lesson = lessonById(block.lessonId);
    if (!lesson) return;
    if (this.refuseType()) return;
    // A block of another type than the one flown is discarded (the flight itself is the shell's to refuse).
    if ((block.aircraftId ?? DEFAULT_AIRCRAFT) !== this.aircraftId) return;
    const save = this.ensureSave();
    const authority = this.shell.params.standard ?? save.settings.authority;
    const status = lessonStatuses(save, SYLLABUS, authority)[lesson.id];
    const practiceOnly = this.shell.params.unlock || (status !== 'available' && status !== 'competent');
    const deps = this.runnerDeps(lesson, save, authority, { practiceOnly });
    await this.loadAutoStudent();
    const runner = LessonRunner.restore(lesson, this.host(lesson), deps, block.run);
    this.session = this.newSession(lesson, runner, deps, null, practiceOnly, authority, false);
    if (!runner.resumed) {
      await runner.begin();
      return;
    }
    if (block.checkpoint) runner.adoptCheckpoint(block.checkpoint);
    // The lesson's weather is what the snapshot restored; the player's own is not known any more.
    this.session.started = true;
    this.ctx.events.emit('lesson', { kind: 'start', lessonId: lesson.id, detail: 'resumed' });
  }

  /**
   * Decision D5: lessons are flown in the school's type only. In another type the school says so and offers to
   * change aircraft (the home screen's banner, SchoolCareer.aircraft); true when refused.
   */
  private refuseType(): boolean {
    if (schoolSupports(this.aircraftId)) return false;
    this.refreshCareer();
    this.school.toast(`Lessons are flown in the ${typeName(SCHOOL_AIRCRAFT[0])}`);
    this.school.open('home');
    return true;
  }

  /** "Start flight" on the briefing. */
  startFlight(): void {
    const s = this.session;
    if (!s || s.runner.phase !== 'briefing') return;
    s.runner.startFlight();
    s.started = true;
    this.ctx.events.emit('lesson', { kind: 'start', lessonId: s.lesson.id });
    this.shell.persist();
  }

  /** A student or menu command for the runner (keys, the menu's School tab, the automation API). */
  input(cmd: RunnerCommand): void {
    const r = this.session?.runner;
    if (!r) return;
    if (cmd === 'abandon' && r.phase === 'debrief') {
      this.closeDebrief();
      return;
    }
    r.input(cmd);
    if (cmd === 'abandon') this.afterRunnerFrame(this.session!);
  }

  /** End the lesson now ('abandoned' with a logbook line when flying; the briefing simply closes). */
  end(): void {
    const s = this.session;
    if (!s) return;
    if (s.runner.phase === 'running' || s.runner.phase === 'briefing') s.runner.input('abandon');
    this.endSession();
  }

  /**
   * Key routing during a lesson (section 5.9): Enter, Shift+Enter, R, [, Tab and Shift+R. True when the key
   * was consumed (the caller prevents the default; Tab must not move focus).
   */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.active || this.crashPending) return false;
    const id = trainingKeyFor(e.code, e.shiftKey);
    if (!id) return false;
    if (id === 'cycleCard') this.school.cycleCard();
    else this.input(id);
    return true;
  }

  // ---- RunnerHost -------------------------------------------------------------------------------------------

  private host(lesson: Lesson): RunnerHost {
    const shell = this.shell;
    return {
      reposition: (spec, opts) => this.reposition(lesson, spec, opts),
      checkpoint: (): CheckpointBlob => ({ flight: shell.captureFlight(), runner: null as unknown as CheckpointBlob['runner'], traceOffset: 0 }),
      restore: async (cp) => {
        this.speech.flush();
        await shell.restoreFlight(cp.flight, { lessonId: lesson.id, label: `${lesson.title}: try again` });
        this.copilot.resync();
      },
      applyWeather: (w, seed) => this.applyWeather(w, seed),
      copilot: this.copilot,
      speech: this.speech,
      setHood: (on) => {
        this.hoodOn = on;
        this.school.setHood(on ? 'hood' : 'off');
        if (on) shell.setCameraMode('cockpit');
      },
      setTimeScaleCap: (max) => {
        this.timeCap = max;
        if (this.ctx.timeScale > max) this.ctx.commands.setTimeScale(max);
      },
      setAutopilotAllowed: (on) => {
        this.apAllowed = on;
        if (!on && shell.physics.autoflight.engaged) shell.physics.setAutoflight(false);
      },
      ui: this.port,
      now: () => Date.now(),
      setControls: (c) => {
        applyControls(shell.physics.controls, c);
      },
      hardwareThrottle: () => null,
      describeWeather: () => weatherLine(shell.weather),
      onLessonEnd: (result, trace) => this.onLessonEnd(lesson, result, trace),
    };
  }

  private async reposition(lesson: Lesson, spec: StartSpec, opts?: StartOptions): Promise<void> {
    this.speech.flush();
    const physics = this.shell.physics;
    if (spec.kind === 'scenario') {
      const sc = { ...physics.scenario };
      physics.reset(spec.id, this.shell.weather);
      await this.shell.startFrom(physics.scenario, { lessonId: lesson.id, label: sc.title });
      this.copilot.resync();
      return;
    }
    const ctx = this.session?.runner.evalContext;
    const sc = buildStart(spec, physics.env, opts ?? lesson.startOptions ?? {}, ctx ? (r) => resolveRef(r, ctx) : undefined, this.aircraftDef);
    await this.shell.startFrom(sc, { lessonId: lesson.id, label: `${lesson.title}: ${sc.title}` });
    this.copilot.resync();
    this.autoStudent?.reset();
  }

  private applyWeather(w: WeatherSpec, seed: number): void {
    this.playerWeather ??= { ...this.shell.weather };
    const wx = buildWeather(w, this.playerWeather, mulberry32(seed));
    Object.assign(this.shell.weather, wx);
    this.ctx.events.emit('weatherChanged', {});
  }

  private sources(lesson: Lesson, ctx: SimContext): TelemetrySources {
    const physics = this.shell.physics;
    return {
      state: physics.state, controls: physics.controls, readings: this.shell.readings(), weather: this.shell.weather,
      env: physics.env, aircraft: this.aircraftDef,
      studentInput: this.autoStudent ? this.autoStudent.flying : this.shell.pilotFlying(),
      timeScale: ctx.timeScale, route: lesson.route ?? null,
    };
  }

  private runnerDeps(lesson: Lesson, save: TrainingSave, authority: AuthorityId, o: { startPhase?: string; practiceOnly: boolean }): RunnerDeps {
    const progress = save.progress[lesson.id] ?? null;
    const attempt = (progress?.attempts ?? 0) + 1;
    return {
      aircraft: this.aircraftDef, standards: STANDARDS, authority, lines: LINES, rng: mulberry32(hashSeed(`${lesson.id}:${attempt}:${Date.now()}`)),
      telemetry: new Telemetry(), bus: new TrainingBus(), settings: save.settings, demos: DEMOS, progress, attempt,
      startPhase: o.startPhase, calmAir: false, store: this.store, inputFlags: () => this.shell.inputFlags(),
      instructorName: save.profile.instructorName, practiceOnly: o.practiceOnly,
    };
  }

  private newSession(lesson: Lesson, runner: LessonRunner, deps: RunnerDeps, challenge: ChallengeDef | null, practiceOnly: boolean, authority: AuthorityId, partial: boolean): Session {
    this.voiceForPersona(lesson.persona);
    this.copilot.stop();
    this.copilot.setHolds(null);
    this.copilot.setContext(() => runner.evalContext);
    this.copilot.onSay = (cue: CueRef) => runner.say(cue);
    this.crashPending = null;
    this.lastStrip = this.lastCard = null;
    this.lastDebrief = null;
    const score: Session['score'] = { landing: null, nSum: 0, nT: 0, glideIn: 0, glideT: 0, stallWarning: false };
    const hints: Session['hints'] = { count: 0, topic: null };
    const unsub = [
      deps.bus.on('hint', (r) => {
        hints.count++;
        hints.topic = r.data.topic;
      }),
    ];
    if (challenge) unsub.push(deps.bus.on('landing', (r) => (score.landing = r.data)), deps.bus.on('stallWarnOn', () => (score.stallWarning = true)));
    return { lesson, runner, challenge, practiceOnly, authority, partial, score, unsub, hints, lastAuthority: '', lastPhaseId: '', started: false };
  }

  /** Per frame after the runner: lesson end, and the end of the session when the runner says 'ended'. */
  private afterRunnerFrame(s: Session): void {
    if (s.runner.phase === 'ended' && this.session === s) this.endSession();
  }

  /** SimEvents 'lesson' (audio ducking, UI): authority changes and phase entries. */
  private announce(s: Session): void {
    if (s.runner.phase !== 'running') return;
    const who = s.runner.authority.who;
    if (who !== s.lastAuthority) {
      s.lastAuthority = who;
      this.ctx.events.emit('lesson', { kind: 'authority', lessonId: s.lesson.id, detail: who });
    }
    const phaseId = s.runner.position.phaseId;
    if (phaseId !== s.lastPhaseId) {
      s.lastPhaseId = phaseId;
      this.ctx.events.emit('lesson', { kind: 'phase', lessonId: s.lesson.id, detail: phaseId });
      // A phase entry is a checkpoint: write the reload snapshot with it.
      this.shell.persist();
    }
  }

  /** The lesson is over (or abandoned): restore the player's world and forget the runner. */
  private endSession(): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    for (const u of s.unsub) u();
    if (s.started) this.ctx.events.emit('lesson', { kind: 'end', lessonId: s.lesson.id });
    this.copilot.stop();
    this.copilot.setHolds(null);
    this.copilot.onSay = null;
    this.copilot.setContext(null);
    this.crashPending = null;
    this.hoodOn = false;
    this.school.setHood('off');
    this.school.setStrip(null);
    this.school.setCard(null);
    this.school.setHighlight([]);
    this.school.setFollowMeThrough(false);
    this.school.setCallout(null);
    this.school.setTaxiGuide(null);
    this.lastCallout = this.lastTaxi = null;
    setCockpitGlance(null);
    this.timeCap = Number.POSITIVE_INFINITY;
    this.apAllowed = true;
    this.speech.cancel({ priorityAtLeast: Priority.Instruction });
    if (this.playerWeather) {
      Object.assign(this.shell.weather, this.playerWeather);
      this.playerWeather = null;
      this.ctx.events.emit('weatherChanged', {});
    }
    this.autoStudent?.reset();
  }

  // ---- Lesson end, persistence ------------------------------------------------------------------------------

  private onLessonEnd(lesson: Lesson, result: LessonResult, trace: TraceData): DebriefExtras {
    const s = this.session;
    const save = this.ensureSave();
    const authority = s?.authority ?? save.settings.authority;
    const entry = logbookEntryFor(lesson, result, this.aircraftDef, authority, save.profile.instructorName, uuid());
    if (s?.partial) entry.remarks = [entry.remarks, 'part lesson (no credit)'].filter(Boolean).join('; ');
    const practiceOnly = s?.practiceOnly ?? true;
    let next = save;
    let awarded: string[] = [];
    if (s?.challenge) {
      next = this.recordChallenge(save, s, result, trace);
    } else {
      const out = applyResult(save, lesson, result, practiceOnly || (s?.partial ?? false), entry);
      next = out.save;
      awarded = out.awarded;
    }
    if (!s?.challenge) entry.traceId = trace.id;
    const isBest = next.progress[lesson.id]?.bestTraceId === trace.id;
    if (!s?.challenge) this.store.putTrace(trace, isBest ? 'best' : 'latest');
    this.save = next;
    this.store.save(next);
    this.store.saveCheckpoint(null);
    this.refreshCareer();
    const bestId = next.progress[lesson.id]?.bestTraceId;
    return {
      nextLessonId: s?.challenge ? null : nextLesson(next, SYLLABUS, authority)?.id ?? null,
      milestone: (awarded[0] as DebriefExtras['milestone']) ?? null,
      bestTrace: bestId && bestId !== trace.id ? this.store.getTrace(bestId) : null,
      logbookPreview: entry,
    };
  }

  /** A challenge flight: score, local best five per authority, a logbook line; never competency. */
  private recordChallenge(save: TrainingSave, s: Session, result: LessonResult, trace: TraceData): TrainingSave {
    const ch = s.challenge as ChallengeDef;
    const sc = s.score;
    const score = scoreChallenge(ch.scoring, {
      landing: sc.landing,
      meanNormalisedError: sc.nT > 0 ? sc.nSum / sc.nT : Number.NaN,
      glideWithin: sc.glideT > 0 ? sc.glideIn / sc.glideT : 0,
      stallWarning: sc.stallWarning,
    });
    const next = structuredClone(save);
    const entry = logbookEntryFor(s.lesson, result, this.aircraftDef, s.authority, save.profile.instructorName, uuid());
    entry.remarks = `${ch.title}: ${score}`;
    next.logbook.push(entry);
    next.bests[ch.id] = addBest(next.bests[ch.id] ?? [], { score, at: result.endedAt, authority: s.authority, flags: result.flags, traceId: trace.id });
    if (next.bests[ch.id].some((b) => b.traceId === trace.id)) this.store.putTrace(trace, 'challenge');
    next.updatedAt = result.endedAt;
    this.school.toast(`${ch.title}: ${score} points`);
    return next;
  }

  /** Challenge inputs gathered per frame: the landing, the card targets' normalised error, the glide, the stall warning. */
  private collectScore(s: Session, r: LessonRunner): void {
    if (!s.challenge || r.phase !== 'running') return;
    const ctx = r.evalContext;
    const f = ctx.frame;
    const sc = s.score;
    const step = r.currentStep;
    if (step?.status !== 'active' || step.def.kind !== 'task') return;
    const def = step.def as TaskStep;
    for (const t of def.card.targets) {
      if (t.tol === undefined) continue;
      const target = resolveRef(t.value, ctx);
      const v = f[t.sig];
      if (typeof v !== 'number' || !Number.isFinite(target)) continue;
      const tol = resolveTol(t.tol, ctx);
      sc.nSum += normalisedError(v - target, tol) * ctx.dt;
      sc.nT += ctx.dt;
      if (t.sig === 'asiKt' && f.onGround === false) {
        sc.glideT += ctx.dt;
        if (normalisedError(v - target, tol) <= 1) sc.glideIn += ctx.dt;
      }
    }
  }

  /** The career file, creating a default profile for a dev start (lesson=) without one. */
  private ensureSave(): TrainingSave {
    if (this.save) return this.save;
    const authority = this.shell.params.standard ?? 'easa';
    const settings = defaultSettings(authority);
    if (!this.shell.params.voice) settings.voice.captionsOnly = true;
    this.save = this.store.create({ studentName: DEFAULT_STUDENT, instructorName: DEFAULT_INSTRUCTOR, licenceNo: '', experienced: false }, settings, new Date());
    this.store.save(this.save);
    this.refreshCareer();
    return this.save;
  }

  private refreshCareer(): void {
    if (!this.school) return;
    const save = this.save;
    const cp = this.store.loadCheckpoint();
    const cpLesson = cp ? lessonById(cp.runner.lessonId) : undefined;
    const career: SchoolCareer = {
      save, syllabus: SYLLABUS, challenges: CHALLENGES,
      authority: this.shell.params.standard ?? save?.settings.authority ?? 'easa',
      storage: this.storageStatus(),
      resume: cpLesson && !this.session ? { lessonId: cpLesson.id, title: cpLesson.title } : null,
      voices: this.voices().map((v): SchoolVoice => ({ voiceURI: v.voiceURI, name: v.name, lang: v.lang })),
      unlockAll: this.shell.params.unlock,
      aircraft: this.schoolAircraft(),
    };
    this.school.setCareer(career);
  }

  /** The flown type and whether lessons can be flown in it (the home screen's banner and its offer). */
  private schoolAircraft(): SchoolAircraft {
    const id = this.aircraftId;
    const school = SCHOOL_AIRCRAFT[0];
    return { flown: { id, name: typeName(id) }, supported: schoolSupports(id), school: { id: school, name: typeName(school) } };
  }

  private storageStatus(): SchoolCareer['storage'] {
    if (!this.shell.params.memoryStore && !browserKv()) return 'unavailable';
    return this.store.status;
  }

  // ---- School commands -------------------------------------------------------------------------------------

  /** What the school screens ask for (SchoolUi.onCommand). */
  command(cmd: SchoolCommand): void {
    switch (cmd.kind) {
      case 'openHome':
      case 'home':
        if (this.session && this.session.runner.phase !== 'running') {
          if (this.session.runner.phase === 'briefing') this.session.runner.input('abandon');
          this.endSession();
        }
        this.refreshCareer();
        this.school.open('home');
        break;
      case 'closeSchool':
        this.store.flush();
        break;
      case 'openLesson':
        void this.start(cmd.lessonId);
        break;
      case 'startFlight':
        this.startFlight();
        break;
      case 'listenBriefing':
        this.session?.runner.speakBriefing();
        break;
      case 'backFromBriefing':
        this.session?.runner.input('abandon');
        this.endSession();
        this.speech.flush();
        this.school.open('home');
        break;
      case 'nextLesson': {
        const id = this.lastDebrief?.nextLessonId ?? (this.save ? nextLesson(this.save, SYLLABUS, this.authority())?.id : undefined);
        this.closeDebrief();
        if (id) void this.start(id);
        else this.school.open('home');
        break;
      }
      case 'flyAgain': {
        const id = this.session?.challenge?.id ?? this.session?.lesson.id;
        this.closeDebrief();
        if (id) void this.start(id);
        break;
      }
      case 'retryPhase':
        void this.session?.runner.retryPhase(cmd.phaseId, true);
        break;
      case 'runner':
        if (cmd.cmd === 'restartLesson' && this.session) {
          this.crashPending = null;
          this.session.runner.input('restartLesson');
        } else {
          this.input(cmd.cmd);
        }
        break;
      case 'startChallenge':
        void this.start(cmd.challengeId);
        break;
      case 'createProfile': {
        const settings = defaultSettings(cmd.authority);
        settings.voice.instructor = cmd.voice;
        settings.voice.captionsOnly = cmd.captionsOnly || !this.shell.params.voice;
        this.save = this.store.create({ studentName: cmd.studentName.trim() || DEFAULT_STUDENT, instructorName: DEFAULT_INSTRUCTOR, licenceNo: '', experienced: cmd.experienced }, settings, new Date());
        this.store.save(this.save);
        this.applyVoiceSettings();
        this.refreshCareer();
        break;
      }
      case 'dismissWelcome':
        this.store.welcomeDismissed = true;
        break;
      case 'updateSettings':
        if (!this.save) break;
        this.save = { ...this.save, settings: { ...this.save.settings, ...cmd.settings, voice: { ...this.save.settings.voice, ...(cmd.settings.voice ?? {}) } } };
        this.store.saveSoon(this.save);
        this.applyVoiceSettings();
        this.refreshCareer();
        break;
      case 'editRemarks': {
        if (!this.save) break;
        const save = structuredClone(this.save);
        const line = save.logbook.find((l) => l.id === cmd.entryId);
        if (!line) break;
        line.remarks = cmd.remarks;
        this.save = save;
        this.store.saveSoon(save);
        this.refreshCareer();
        break;
      }
      case 'export':
        this.exportFile(cmd.includeTraces);
        break;
      case 'import':
        this.importJson(cmd.json, cmd.mode);
        break;
      case 'resetProgress':
        this.endSession();
        this.store.reset();
        this.save = null;
        this.refreshCareer();
        this.school.open('welcome');
        break;
      case 'switchAircraft':
        this.store.flush();
        // Reloads the page into the school (absent in older shells and tests: nothing happens).
        if (isAircraftId(cmd.aircraftId)) this.ctx.commands.setAircraft?.(cmd.aircraftId, { open: 'school' });
        break;
    }
  }

  private closeDebrief(): void {
    this.school.hideDebrief();
    this.endSession();
  }

  private authority(): AuthorityId {
    return this.shell.params.standard ?? this.save?.settings.authority ?? 'easa';
  }

  /** Export file download (section 3.11). Returns the JSON text (also for the automation API). */
  exportFile(includeTraces = true, download = true): string | null {
    if (!this.save) return null;
    const json = this.store.exportJson(this.save, includeTraces, APP_BUILD, new Date());
    if (download && typeof document !== 'undefined') {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = exportFileName(this.save, new Date());
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
    return json;
  }

  /** Import (Replace or Merge): nothing is written when the file is invalid. Returns an error text or null. */
  importJson(json: string, mode: 'replace' | 'merge'): string | null {
    try {
      const preview = this.store.previewImport(json);
      const next = this.store.applyImport(preview, mode, this.save);
      this.save = next;
      this.store.save(next);
      this.applyVoiceSettings();
      this.refreshCareer();
      this.school.toast(mode === 'merge' ? 'Training records merged' : 'Training records imported');
      return null;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      this.school.toast(`Import failed: ${why}`);
      return why;
    }
  }

  private previewImport(json: string): SchoolImportPreview {
    const p = this.store.previewImport(json);
    return { studentName: p.studentName, lessonsCompetent: p.lessonsCompetent, hours: p.hours, landings: p.landings };
  }

  private updateProfile(p: Partial<Pick<TrainingSave['profile'], 'studentName' | 'instructorName' | 'experienced'>>): void {
    if (!this.save) return;
    this.save = { ...this.save, profile: { ...this.save.profile, ...p } };
    this.store.saveSoon(this.save);
    this.refreshCareer();
  }

  // ---- Crash -----------------------------------------------------------------------------------------------

  /**
   * The shell's crash dialog during a lesson (section 3.10): dual lessons get the lesson crash panel (the
   * runner waits for the choice); solo, check and test lessons end without a dialog (debrief on the ground).
   */
  private crashActions(reason: string): CrashAction[] | 'none' | null {
    const s = this.session;
    if (!s || s.runner.phase !== 'running') return null;
    if (s.lesson.kind !== 'dual') return 'none';
    void reason;
    return [
      { label: 'Debrief', primary: true, keys: ['Enter', 'NumpadEnter'], run: () => this.resolveCrash('debrief') },
      { label: 'Try again from checkpoint', keys: ['KeyR'], run: () => this.resolveCrash('retry') },
      { label: 'Restart lesson', run: () => this.resolveCrash('restart') },
    ];
  }

  private onCrash(reason: string): void {
    const s = this.session;
    if (!s || s.runner.phase !== 'running') return;
    if (s.lesson.kind === 'dual') {
      this.crashPending = reason;
      this.copilot.stop();
      return;
    }
    s.runner.onCrash(reason);
  }

  private resolveCrash(choice: 'debrief' | 'retry' | 'restart'): void {
    const s = this.session;
    const reason = this.crashPending;
    this.crashPending = null;
    if (!s || reason === null) return;
    if (choice === 'debrief') s.runner.onCrash(reason);
    else if (choice === 'retry') void s.runner.retryPhase(undefined, true);
    else s.runner.input('restartLesson');
  }

  // ---- Speech ----------------------------------------------------------------------------------------------

  private installSpeech(): void {
    const sp = this.speech;
    const shell = this.shell;
    sp.onEvent = (e, r, result) => this.onSpeechEvent(e, r, result);
    this.applyVoiceSettings();
    // Voices often appear only after the first user gesture (Chrome): give them a moment, then go
    // captions-only with one toast if there are none (section 3.7.2).
    const firstGesture = (): void => {
      window.removeEventListener('keydown', firstGesture, true);
      window.removeEventListener('pointerdown', firstGesture, true);
      setTimeout(() => {
        const web = this.web;
        if (!web) return;
        void web.ready().then((ok) => {
          if (!ok && this.web === web) this.downgradeToCaptions();
        });
      }, VOICE_GRACE_MS);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', firstGesture, true);
      window.addEventListener('pointerdown', firstGesture, true);
    }
    void shell;
  }

  /** Backend and voices from the settings: voice=0 or "captions only" means the caption backend. */
  private applyVoiceSettings(): void {
    const v = this.save?.settings.voice;
    const wantVoice = this.shell.params.voice && !v?.captionsOnly;
    if (wantVoice && !this.web) {
      const web = new WebSpeechBackend();
      if (web.available) {
        web.onDowngrade = () => this.downgradeToCaptions();
        this.web = web;
      } else {
        this.noVoices();
      }
    } else if (!wantVoice && this.web) {
      this.web.dispose();
      this.web = null;
    }
    this.speech.setBackend(this.web ?? this.captionsBackend);
    this.voiceForPersona(this.session?.lesson.persona ?? 'instructor');
  }

  private downgradeToCaptions(): void {
    this.web?.dispose();
    this.web = null;
    this.speech.setBackend(this.captionsBackend);
    this.noVoices();
  }

  private noVoices(): void {
    if (this.noVoiceToastShown) return;
    this.noVoiceToastShown = true;
    this.school?.toast(NO_VOICE_TOAST);
  }

  private voices(): VoiceInfo[] {
    return (this.web?.voices() ?? []).map((v) => ({ voiceURI: v.voiceURI, name: v.name, lang: v.lang, default: v.default }));
  }

  /** Voice per actor: the instructor's or the examiner's persona, the player's choice, rate and volume. */
  private voiceForPersona(persona: Lesson['persona']): void {
    const settings = this.save?.settings.voice ?? defaultSettings().voice;
    const voices = this.voices();
    this.speech.voiceFor = (actor) => {
      const who = actor === 'examiner' ? 'examiner' : actor === 'instructor' ? 'instructor' : persona;
      return pickVoice(voices, who, settings[who], settings);
    };
  }

  private onSpeechEvent(e: 'start' | 'end', r: SpeechRequest, result?: 'done' | 'interrupted' | 'dropped'): void {
    void result;
    const audio = this.shell.audio;
    if (e === 'start') {
      // The caption appears when the line starts (the scheduler has just put it in the transcript).
      const cap = this.speech.transcript[this.speech.transcript.length - 1] as Caption | undefined;
      if (cap && cap.id === r.id) this.school.showCaption(cap, { safety: r.priority === Priority.Safety });
      if (r.channel === 'cabin' && r.actor !== 'student') {
        audio?.setDuck(1);
        const captions = this.speech.backendKind === 'captions';
        if (!captions) audio?.chime('intercom');
        else if (r.priority <= Priority.Instruction) audio?.chime('caption');
      }
    } else if (this.speech.idle()) {
      audio?.setDuck(0);
    }
  }

  /** A line outside the lesson flow (debrief "Play", "Test voice"). */
  private enqueueSystemLine(text: string, actor: 'instructor' | 'examiner' = 'instructor'): void {
    this.speech.enqueue({ actor, channel: 'cabin', caption: text, speak: text, priority: Priority.Instruction, interrupt: false, resumable: true, ttlMs: 30_000 });
  }

  private testVoice(persona: Lesson['persona'], voiceURI: string | null): void {
    const settings = this.save?.settings.voice ?? defaultSettings().voice;
    const before = this.speech.voiceFor;
    const voice = pickVoice(this.voices(), persona, voiceURI, settings);
    this.speech.voiceFor = (actor) => (actor === persona ? voice : before(actor));
    const name = persona === 'examiner' ? PERSONAS.examiner.name : this.save?.profile.instructorName ?? PERSONAS.instructor.name;
    this.enqueueSystemLine(`Hello, I'm ${name}. This is how I sound.`, persona);
    setTimeout(() => (this.speech.voiceFor = before), 8000);
  }

  // ---- Callouts: control positions on screen, and the camera glance ----------------------------------------------

  /** Canvas position (CSS px) of a control or instrument in the cockpit view; `behind` the camera. */
  private projectControl(t: PointTarget): { x: number; y: number; behind: boolean } | null {
    const p = this.controlPoints[t];
    const ctx = this.ctx;
    if (!p || !ctx) return null;
    let obj = this.cockpitObj;
    if (!obj || !obj.parent) {
      obj = null;
      ctx.scene.traverse((o) => {
        if (!obj && o.name === 'cockpit') obj = o;
      });
      this.cockpitObj = obj;
    }
    if (!obj) return null;
    const cam = ctx.camera;
    // This frame's camera and aircraft, not the last render's: during a glance the ring trailed the control
    // (playtest 3: the master switch ring sat 60 px right of the rocker in a screenshot taken mid-glance).
    (obj as THREE.Object3D).updateWorldMatrix(true, false);
    cam.updateMatrixWorld();
    const v = this.pv.set(p.x, p.y, p.z).applyMatrix4((obj as THREE.Object3D).matrixWorld);
    const behind = this.pc.copy(v).applyMatrix4(cam.matrixWorldInverse).z > 0;
    v.project(cam);
    const el = ctx.renderer.domElement;
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, behind };
  }

  /** The cockpit camera glances at a control (null: looks back), unless the student turned glances off. */
  private glance(t: PointTarget | null): boolean {
    if (t && this.save?.settings.glance === false) return false;
    setCockpitGlance(t ? this.controlPoints[t] ?? null : null);
    return true;
  }

  // ---- Copilot and the AutoStudent ---------------------------------------------------------------------------

  /** The instructor-pilot runs every physics step (section 3.1); the AutoStudent, when loaded, before it. */
  private installCopilot(): void {
    const copilot = this.copilot;
    const ts = this;
    const controller: StepController = {
      get flying() {
        return copilot.flying;
      },
      update(h, s, c) {
        const auto = ts.autoStudent;
        if (auto && ts.active && !copilot.flying) auto.update(h, s, c);
        copilot.update(h, s, c);
      },
    };
    this.shell.physics.copilot = controller;
  }

  /**
   * student=auto (dev server only): the scripted student of the conformance suite flies the student's tasks.
   * The production build leaves the test code out (the import is dead code there).
   */
  private async loadAutoStudent(): Promise<void> {
    if (!this.shell.params.autoStudent || this.autoStudent) return;
    if (import.meta.env.PROD) {
      console.warn('[training] student=auto is only available on the dev server');
      return;
    }
    try {
      const mod = await import('../../tests/training/autoStudent');
      this.autoStudent = new mod.AutoStudent({ physics: this.shell.physics, aircraft: this.aircraftDef });
    } catch (e) {
      console.warn('[training] student=auto: the AutoStudent could not be loaded', e);
    }
  }
}

// ---- helpers ------------------------------------------------------------------------------------------------

/** 'Cessna 172S' for an aircraft id (the catalogue's short name), else the school def's name. */
function typeName(id: AircraftTypeId): string {
  if (isAircraftId(id)) return aircraftSummary(id).shortName;
  return hasAircraftType(id) ? getAircraftType(id).name : id;
}

/** localStorage, or null where it is unavailable (the store then keeps everything in memory). */
function browserKv(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** FNV-1a of a string (the variant RNG seed). */
function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
