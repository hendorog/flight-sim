// The lesson runner (section 3.2): interprets a Lesson's phases and steps once per rendered frame with sim
// dt (0 while paused or behind the curtain). Per update while running: telemetry and derived events, step
// `on` handlers and pending `when`, the authority FSM, the current step, the grader (student authority only),
// coach and faults, the safety envelope, timeouts and outcomes, the trace and the UI models.
//
// The runner never touches the simulator directly: everything goes through RunnerHost (TrainingSystem in the
// browser, headlessHost in the conformance tests).
//
// Structure of this file
//   - RunnerHost / RunnerDeps: the ports (contract, plus optional hooks marked "module 5 addition").
//   - RUNNER_LINES: what the engine itself says (handovers, interventions...). Content may override any id in
//     LINES; these are the fallbacks so the engine never depends on a content edit to speak.
//   - RunContext: the EvalContext, one mutable object per run updated in place every frame.
//   - LessonRunner: lifecycle (begin, startFlight, finish), the per-frame update, the step machine
//     (enter -> pending `when` -> pilot-flying handover -> active -> exit -> outcome), tasks, demos, checklists,
//     interventions and recovery, checkpoints and retries, snapshot/restore, speech and UI publication.

import type { ControlInputs } from '../../core/types';
import { AIRPORT } from '../../core/world';
import { FlightTimer, logbookEntryFor } from '../career/logbook';
import type { TrainingStore } from '../career/store';
import type { InstructorPilot } from '../copilot/instructorPilot';
import { normalisedError } from '../grading/accumulators';
import { buildDebrief } from '../grading/debrief';
import { Grader } from '../grading/grade';
import { lessonOutcome, lessonStars, type OutcomeInput } from '../grading/results';
import { STANDARD_NOTES } from '../grading/standards';
import { TraceRecorder } from '../grading/trace';
import { render } from '../speech/phraseology';
import type { SpeechScheduler } from '../speech/scheduler';
import type { Telemetry } from '../telemetry/telemetry';
import {
  Priority,
  type AircraftTypeDef, type AuthorityId, type BriefingModel, type CardModel, type CardTargetModel, type CheckpointBlob,
  type ChecklistStep, type CompiledPred, type CriterionResult, type CueRef, type DebriefModel, type DemoScript, type DemoStep, type EndorsementId,
  type EvalContext, type ExerciseDef, type FaultRecord, type FaultRule, type Grade, type Holds, type InlineCue,
  type LandingData, type Lesson, type LessonProgress, type LessonResult, type LessonStripModel, type LineTable,
  type LogbookEntry, type Outcome, type PhaseDef, type Pred, type Ref, type Rng, type RunnerCommand, type RunSnapshot,
  type SignalDef, type SignalFrame, type SignalId, type SpeechRequest, type Standard, type StartOptions, type StartSpec,
  type StepDef, type TaskLimit, type TaskStep, type TelemetrySources, type Tol, type TouchdownData, type ToleranceChip, type ToleranceTable, type TraceData,
  type TrainingEventRecord, type TrainingSettings, type TrainingUiPort, type WeatherSpec,
  type CalloutModel, type ChecklistDef, type ChecklistItem, type PointTarget, type TaxiDestination, type TaxiGuideModel, type TaxiRoute,
} from '../types';
import { AuthorityFsm, type AuthorityLine } from './authority';
import type { TrainingBus } from './bus';
import { ChecklistRunner, GUIDED_TTL_S, type ChecklistPointer, type GuidedOptions } from './checklists';
import { Coach, type CoachRemark } from './coach';
import { keyFor, predSignals, stateKey, targetKey, targetLabel, type KeyInfo } from './controls';
import { GROUND_RPM_MAX, GroundCoach } from './groundCoach';
import { ReminderLadder } from './reminders';
import { TaxiGuide } from './taxiGuide';
import { buildTaxiRoute } from '../geo/taxiRoute';
import { DerivedEventDetector, LandingDetector } from './events';
import { compile } from './predicates';
import { resolveRef, resolveTol } from './refs';
import { SAFETY_CALLS, SafetyMonitor, type SafetyBreach, type SafetyRuleId } from './safety';
import { GLOBAL_FAULT_RULES, type GlobalFaultRule } from '../content/globalRules';
import { held } from './dsl';

/** A global fault rule in a run: `pred` holds for the rule's time, `raw` is the bare condition. */
interface GlobalFaultRun { rule: GlobalFaultRule; pred: CompiledPred; raw: CompiledPred; rec: FaultRecord | null }
const globalFaultRun = (rule: GlobalFaultRule): GlobalFaultRun =>
  ({ rule, pred: compile(held(rule.when, rule.forS, 0)), raw: compile(rule.when), rec: null });

export type { RunSnapshot } from '../types';

/** What the host may add to the debrief (module 5 addition: the runner cannot know progress or stored traces). */
export interface DebriefExtras {
  nextLessonId?: string | null;
  milestone?: EndorsementId | null;
  bestTrace?: TraceData | null;
  logbookPreview?: LogbookEntry | null;
}

export interface RunnerHost {                       // implemented by TrainingSystem and by the headless test host
  reposition(spec: StartSpec, opts?: StartOptions): Promise<void>;   // curtain + resetTo; resolves when flying
  checkpoint(): CheckpointBlob; restore(cp: CheckpointBlob): Promise<void>;
  applyWeather(w: WeatherSpec, seed: number): void;
  copilot: InstructorPilot;
  speech: SpeechScheduler;
  setHood(on: boolean): void; setTimeScaleCap(max: number): void; setAutopilotAllowed(on: boolean): void;
  ui: TrainingUiPort;                               // publishes LessonStripModel, CardModel, DebriefModel
  now(): number;                                    // wall ms
  /** (module 5 addition) SetupStep.controls without a reposition. Absent: the controls are not set. */
  setControls?(c: Partial<ControlInputs>): void;
  /** (module 5 addition) Hardware throttle axis position when one is in use, else null (handover match). */
  hardwareThrottle?(): number | null;
  /** (module 5 addition) Weather line for the briefing and the result ('Wind 090/7, CAVOK, 09:30'). */
  describeWeather?(): string;
  /**
   * (module 5 addition) The lesson ended (any outcome, also 'abandoned'): persist the result and the trace,
   * and return what the debrief should show beyond the runner's own knowledge.
   */
  onLessonEnd?(result: LessonResult, trace: TraceData): DebriefExtras | void;
}

/**
 * (contract: section 3.2 lists the members in a comment) What the runner needs besides the host.
 * Telemetry and the bus are per run; the rest is shared configuration.
 */
export interface RunnerDeps {
  aircraft: AircraftTypeDef;
  standards: ToleranceTable;
  authority: AuthorityId;
  lines: LineTable;
  /** Seeded for variants; seed derived from (lessonId, attempt). */
  rng: Rng;
  telemetry: Telemetry;
  bus: TrainingBus;
  settings: TrainingSettings;
  /** Demo scripts by id (content/demos.ts DEMOS) for DemoStep.script and Outcome { demo }. */
  demos: Readonly<Record<string, DemoScript>>;
  /** This lesson's progress before the run (exercise sign-offs carry over); null if never flown. */
  progress: LessonProgress | null;
  /** Attempt number of this lesson (weather seed). */
  attempt: number;
  /** URL phase= / "Try one exercise again": start at this phase (no logbook credit). */
  startPhase?: string;
  /** Calm-air variant (result flag; Phase 1 only). */
  calmAir?: boolean;
  /** Persistence of the latest checkpoint (`fs.training.v1.checkpoint`); null in tests. */
  store?: TrainingStore | null;
  /**
   * Input facts only the host knows, read when the result is built (LessonResult.flags). Absent: keyboard,
   * assists on.
   */
  inputFlags?: () => Pick<LessonResult['flags'], 'kbdAssists' | 'inputDevice'>;
  /** (module 5 addition) The instructor's name for the logbook signature (profile.instructorName). */
  instructorName?: string;
  /** (module 5 addition) Opened through lesson= / unlock= while not available: practice credit only. */
  practiceOnly?: boolean;
}

export type RunPhase = 'briefing' | 'positioning' | 'running' | 'debrief' | 'ended';

// =============================================================================================================
// Engine lines (fallbacks; LINES may override any id)
// =============================================================================================================

const safety = (text: string): InlineCue => ({ text, priority: Priority.Safety, interrupt: true });

export const RUNNER_LINES: Readonly<Record<string, InlineCue>> = {
  'runner.youHaveControl': { text: 'You have control.' },
  'runner.pressEnterWhenReady': { text: "Press Enter when you're ready to take it." },
  'runner.iHaveControl': { text: 'I have control.' },
  'runner.iHaveControlSafety': safety('I have control!'),
  'runner.ackFirst': { text: "Say 'I have control' first: press Enter." },
  'runner.lightHands': { text: 'Light hands, just follow me through.' },
  'runner.takeBreath': { text: "I have control. Take a breath; press Enter when you're ready." },
  'runner.matchThrottle': { text: 'Match the throttle to mine, then it is yours.' },
  'runner.gettingAway': { text: 'OK, that was getting away from us.' },
  'runner.tryAgain': { text: ["Let's try that again.", "Let's set that up again."] },
  'runner.enoughForToday': { text: "That's enough for today; we'll talk it through on the ground." },
  'runner.offerDemo': { text: 'Want me to show you again? Press the left bracket.' },
  'runner.showYou': { text: "I'll show you. I have control; follow me through." },
  'runner.noDemo': { text: 'Nothing to show you here. Have another go.' },
  'runner.whereWereWe': { text: 'Right, where were we.' },
  'runner.outOfTime': { text: "We're out of time for today. Let's head back." },
  'runner.examinerStop': { text: "I have control. We'll stop the test there.", actor: 'examiner', priority: Priority.Safety, interrupt: true },
  'runner.onceMore': { text: ["Let's do that once more.", 'Once more, from the top.'] },
  'runner.holdReleased': { text: 'You have the {lever}.' },
  // Lesson-limit interventions (TaskLimit): calm, not the Safety "I have control!".
  'runner.limit.iHaveControl': { text: 'I have control.', priority: Priority.Safety, interrupt: true },
  'runner.limit.teach': { text: ["Straight and level again. Small, gentle inputs this time.", "That's us level again. Smaller movements, and give it time to respond."] },
  'runner.limit.teach.bank': { text: ["Wings level again. Keep the bank gentle: small aileron, then centre it.", "Level again. Small aileron inputs, and centre the yoke once the bank is set."] },
  'runner.limit.teach.pitch': { text: ["Nose back on the horizon. Small pitch changes: a couple of degrees at a time.", "Back to level. Ease the nose a little at a time and let it settle."] },
  'runner.limit.teach.speed': { text: ["Speed back where we want it. Watch the speed as you change the attitude.", "We're settled again. Keep an eye on the airspeed as the nose moves."] },
  'runner.limit.teach.height': { text: ["Back at our height. Keep the altitude in your scan as you work.", "Height restored. Attitude first, then check the altimeter."] },
  'runner.limit.teach.yaw': { text: ["Straight again. Gentle rudder, and keep the ball in view.", "Back in balance. Smooth rudder pressure, a little at a time."] },
  'runner.limit.again': { text: ["Let's try that one again.", "Have another go at that."] },
  /** The last allowed limit intervention on a task: the task is left (failed) and the lesson moves on. */
  'runner.limit.moveOn': { text: ["We'll leave that one there for today and come back to it next time. On to the next exercise.",
    "Let's put that one aside for now; we'll come back to it. On to the next exercise."] },
  /** Talk-through while she restores straight and level (an ab-initio FI talks while she flies). */
  'runner.limit.talk.wings': { text: ['Wings coming level...', 'Rolling the wings level...'], priority: Priority.Coach, ttlS: 4 },
  'runner.limit.talk.attitude': { text: ['Nose on the horizon, and let the speed settle.', 'Attitude back on the horizon; now the speed settles.'], priority: Priority.Coach, ttlS: 4 },
  'runner.limit.talk.height': { text: ['Easing back to our height.', 'Back to the height we started at.'], priority: Priority.Coach, ttlS: 4 },
  // Guided checklists: why each C172S item is set as it is (said once per run; content may override
  // `why.<item>` or `why.<checklist>.<item>` in LINES, or give ChecklistItem.why). At most 15 words each.
  'why.parkingBrake': { text: 'Parking brake set: the aircraft must not roll when the engine fires.' },
  'why.avionicsOff': { text: "Avionics off for the start: the starter's voltage dip can damage the radios." },
  'why.master': { text: 'Master on: it powers the starter, the beacon and the instruments.' },
  'why.beacon': { text: 'Beacon on: it warns anyone outside that the engine is about to start.' },
  'why.fuelSelector': { text: 'Fuel selector on both: the engine feeds from both tanks.' },
  'why.mixture': { text: 'Mixture fully rich: the engine needs a rich mixture to start and run on the ground.' },
  'why.throttleOpen': { text: 'Throttle open a quarter inch: enough air to start without racing the engine.' },
  'why.propArea': { text: 'Nobody near the propeller: look both sides and call "clear prop".' },
  'why.rpm': { text: '1,000 rpm after the start lets the oil reach everything before more power.' },
  'why.ammeter': { text: 'Ammeter charging: the alternator is now carrying the electrics, not the battery.' },
  'why.avionicsOn': { text: 'Avionics on now: the start is over, so the radios are safe.' },
  'why.navLights': { text: 'Navigation lights on: other traffic can see us.' },
  'why.flapsUp': { text: 'Flaps up for taxiing: down, they pick up stones from the propeller.' },
  'why.runupRpm': { text: '1,800 rpm is where the magneto and engine checks are made.' },
  'why.suction': { text: 'Suction in the green: the vacuum pump drives the attitude and heading gyros.' },
  'why.idle': { text: 'An idle check proves the engine will not stop when we close the throttle.' },
  'why.trim': { text: 'Trim set for take-off, or the nose rises too early or too late.' },
  'why.flaps': { text: 'Flaps up for a normal take-off.' },
  'why.mags': { text: 'Both magnetos: two independent ignition systems, both working.' },
  'why.strobes': { text: 'Strobes on as we enter the runway, so we are seen.' },
  'why.landingLight': { text: 'Landing light on for the runway: we are easier to see.' },
  'why.parkingBrakeOff': { text: 'Parking brake off, or we will not roll on the take-off.' },
  'why.fuelPumpPrime': { text: 'A few seconds of fuel pump primes the cylinders; then off, or it floods.' },
  // Shutdown: its own reasons (the before-start ones are about the start).
  'why.shutdown.parkingBrake': { text: 'Parking brake set: the aircraft stays put once we leave it.' },
  'why.shutdown.throttleIdle': { text: 'Throttle closed: the engine stops cleanly from idle.' },
  'why.shutdown.avionicsOff': { text: 'Avionics off before the engine stops: no voltage spike reaches the radios.' },
  'why.shutdown.mixtureCutoff': { text: 'Mixture to cut-off stops the engine by starving it of fuel.' },
  'why.shutdown.magsOff': { text: 'Magnetos off and the key out: a live magneto can fire the engine.' },
  'why.shutdown.masterOff': { text: 'Master off, or the battery is flat by tomorrow.' },
  'why.shutdown.fuelSelectorTank': { text: 'One tank selected stops fuel crossfeeding between the tanks when parked.' },
  'runner.checklistHelp': { text: 'Would you like me to show you? Press the left bracket.', priority: Priority.Coach, ttlS: 8 },
  'runner.taskHelp': { text: 'Would you like me to show you? Press the left bracket.', priority: Priority.Coach, ttlS: 8 },
  'runner.taskHelpSayAgain': { text: "Take your time. Press R and I'll say it again.", priority: Priority.Coach, ttlS: 8 },
  /** The student handed back during their task: a reminder while she holds it. */
  'runner.handedBackPrompt': { text: ["Whenever you're ready, press Enter and I'll hand it back.", "Press Enter when you'd like control back."], priority: Priority.Coach, ttlS: 6 },
};

const AUTHORITY_LINE: Readonly<Record<AuthorityLine, string>> = {
  offer: 'runner.youHaveControl',
  offerRepeat: 'runner.youHaveControl',
  offerPrompt: 'runner.pressEnterWhenReady',
  confirm: 'runner.youHaveControl',
  iHaveControl: 'runner.iHaveControl',
  ackFirst: 'runner.ackFirst',
  lightHands: 'runner.lightHands',
  takeBreath: 'runner.takeBreath',
  matchThrottle: 'runner.matchThrottle',
};

// =============================================================================================================
// Constants
// =============================================================================================================

/** Aerodrome elevation, ft (`{ field: 'elevFt' }`). */
const FIELD_ELEV_FT = Math.round(AIRPORT.elevation / 0.3048);
/** Drop if not started within (InlineCue.ttlS defaults), s. */
const TTL_S: Record<Priority, number> = { [Priority.Safety]: 2, [Priority.Instruction]: 8, [Priority.Coach]: 3, [Priority.Praise]: 3 };
/** Section 3.3 default settle time of a criterion, s. */
const DEFAULT_SETTLE_S = 8;
/** Handover step default acknowledgement timeout, s. */
const DEFAULT_ACK_TIMEOUT_S = 20;
/** Retry outcome: attempts before it becomes fail -> next. */
const DEFAULT_ATTEMPTS = 2;
/** The task's goal, criteria or event handlers name the rolloutComplete event. */
function mentionsRollout(def: TaskStep): boolean {
  return JSON.stringify([def.goal, def.criteria, def.on ?? null]).includes('"rolloutComplete"');
}

/** A crash this soon after a logged landing means that landing was not one (the logbook takes it back), s. */
const CRASH_VOIDS_LANDING_S = 30;
/** Anti-frustration rule 4: failures of a task before the instructor offers a demonstration. */
const FAILURES_BEFORE_DEMO_OFFER = 2;
/** A say step with `wait` never blocks longer than this even if the speech end never arrives, s. */
const SAY_WAIT_CAP_S = 30;
/** Give up waiting for the copilot's "stable" after this long and carry on, s. */
const RECOVERY_CAP_S = 60;
/** After an intervention, the explanation may hold up the retry at most this long, s. */
const EXPLAIN_CAP_S = 12;
/** Two interventions in one lesson end it (section 3.8). */
const MAX_INTERVENTIONS = 2;
/** TaskLimit: default time outside before the instructor takes control, s. */
const LIMIT_FOR_S = 1.5;
/** Limit interventions on one task before it fails (TaskStep.attempts overrides). */
const LIMIT_ATTEMPTS = 3;
/** Stable after a limit intervention: wings, vertical speed and speed (against the reference), held this long. */
const LIMIT_STABLE = { bankDeg: 3, vsFpm: 200, kiasTol: 10, forS: 3 };
/** Give up waiting for that and carry on after this long, s. */
const LIMIT_RESTORE_CAP_S = 60;
/** TaskFeedback: gap between milestone remarks, s; nudge defaults, s. */
const MILESTONE_GAP_S = 2;
/**
 * A milestone met while she was still talking is said afterwards only if it still holds, or it was met within
 * this long; and only the latest such one (the earlier ones are stale: a fast student is already past them), s.
 */
const MILESTONE_TTL_S = 3;
/** While the student has handed back mid-task, the "press Enter" reminder, s. */
const HANDBACK_PROMPT_S = 30;
const NUDGE_AFTER_S = 12;
const NUDGE_EVERY_S = 15;
/** Feedback lines wait in the queue this long (a Coach line's default 3 s drops them behind a long brief), s. */
const FEEDBACK_TTL_S = 8;
const TALK_FACTOR: Record<TrainingSettings['talkativeness'], number> = { quiet: 2, normal: 1, chatty: 0.7 };
/** A coach remark or reminder points at its control this long, s. */
const POINT_REMARK_S = 6;
/** UI publication period (strip and card at 10 Hz of wall time), s. */
const UI_PERIOD_S = 0.1;
/** Same-frame step transitions (instant steps: capture, branch, say without wait...). */
const MAX_TRANSITIONS_PER_FRAME = 64;
const AIRBORNE_STARTS: ReadonlySet<StartSpec['kind']> = new Set(['air', 'final', 'circuit', 'attitude']);
const HOLD_NAMES: Record<'throttle' | 'flapsDeg' | 'mixture', [chip: string, lever: string]> = {
  throttle: ['THROTTLE: INSTRUCTOR', 'throttle'], flapsDeg: ['FLAPS: INSTRUCTOR', 'flaps'], mixture: ['MIXTURE: INSTRUCTOR', 'mixture'],
};

const num = (x: unknown): number => (typeof x === 'number' ? x : NaN);
const wrap180 = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;
const iso = (ms: number): string => new Date(ms).toISOString();

/** FNV-1a: the weather seed = hash(lessonId, attemptNumber) (section 2.8). */
export function weatherSeed(lessonId: string, attempt: number): number {
  let h = 0x811c9dc5;
  for (const ch of `${lessonId}#${attempt}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// =============================================================================================================
// Evaluation context
// =============================================================================================================

class RunContext implements EvalContext {
  readonly frame: Readonly<SignalFrame>;
  vars: Record<string, number> = {};
  readonly fieldElevFt = FIELD_ELEV_FT;
  standard: Standard = 'training';
  stepMark = 0;
  stepT = 0;
  dt = 0;
  simT = 0;
  pilot: 'student' | 'instructor' = 'instructor';
  speechIdle = true;

  constructor(
    readonly aircraft: AircraftTypeDef,
    readonly standards: ToleranceTable,
    readonly authority: AuthorityId,
    readonly events: TrainingBus,
    private readonly telemetry: Telemetry,
    private readonly gradeOf: (id: string) => Grade | null,
  ) {
    this.frame = telemetry.frame;
  }

  signalDef(id: SignalId): SignalDef | undefined {
    return this.telemetry.def(id);
  }

  exerciseGrade(id: string): Grade | null {
    return this.gradeOf(id);
  }
}

// =============================================================================================================
// Step state
// =============================================================================================================

type StepResult = 'success' | 'fail' | 'timeout' | 'skipped';
interface StepExit { result: StepResult; outcome?: Outcome }

interface StepRun {
  def: StepDef;
  status: 'pending' | 'pf' | 'active' | 'busy';
  when: CompiledPred | null;
  pendingS: number;
  nextPromptS: number;
  /** An exit decided outside the frame's step tick (async completion, demo abort...). */
  done: StepExit | null;
  // say
  sayId: string | null;
  // wait
  until: CompiledPred | null;
  // task
  exercise: ExerciseDef | null;
  goal: CompiledPred | null;
  faults: { rule: FaultRule; pred: CompiledPred; was: boolean; fired: boolean }[];
  onSeq: number;
  taskOpen: boolean;
  startedSimT: number;
  settleS: number;
  taskHolds: boolean;
  // demo
  demo: boolean;
  demoFromS: number;
  followMe: boolean;
  // checklist
  checklist: ChecklistRunner | null;
  // task feedback and limits
  fb: TaskFeedbackRun | null;
  limits: { def: TaskLimit; outS: number }[];
  /** Straight-and-level reference for a limit intervention (indicated, pilot units at task start). */
  ref: { altFt: number; hdgDeg: number | null; kias: number } | null;
  /** The feedback's start line ("Go ahead: ..."), held until the student has control. */
  startCue: CueRef | null;
  /** Speech ids of this step's brief and feedback lines: still queued when it exits, they are dropped. */
  lineIds: string[];
  /** The step's `point` callout until `pointWhen` holds (null: none or done). */
  point: { target: PointTarget; state: string | null; until: CompiledPred | null; done: boolean } | null;
  /** Nudges of this step: state-driven, never the same words twice running, help offered after two. */
  ladder: ReminderLadder;
  /** Taxi guidance of a task (TaskStep.taxi). */
  taxi: { to: TaxiDestination; calls: boolean; coach: boolean; brief: boolean; guide: TaxiGuide | null } | null;
}

interface TaskFeedbackRun {
  /** TaskFeedback.nudge.missing conditions, evaluated every frame. */
  missing: CompiledPred[];
  milestones: { id: string; pred: CompiledPred; minT: number; due: boolean; dueT: number; now: boolean; fired: boolean; cue: CueRef }[];
  /** Sim time of the last milestone remark. */
  lastMilestoneT: number;
  /** Instructor silence (speech idle), s; and the sim time of the last nudge. */
  quietS: number;
  lastNudgeT: number;
}

/**
 * A lesson-limit intervention in progress (TaskStep.limits): the instructor has control and restores straight
 * and level ('restoring'), says why ('explaining'), offers control back ('offering'); the task then restarts
 * or, after `attempts` interventions, fails with onFail.
 */
interface LimitRecovery {
  step: StepRun; limit: TaskLimit; phase: 'restoring' | 'explaining' | 'offering';
  t: number; stableS: number; explainT: number; refKias: number; fail: boolean; safetySave: boolean;
  /** Talk-through already said while restoring (wings, attitude, height). */
  talk: Set<string>;
}

interface Interlude { steps: StepDef[]; index: number }
/**
 * The copilot is recovering. `explained`: the aircraft is stable and the instructor has said why; the runner
 * then waits for those lines to finish before retrying the phase (a retry flushes speech).
 */
interface Recovery { intervention: boolean; breach: SafetyBreach | null; t: number; explained: boolean; explainT: number }

// =============================================================================================================
// The runner
// =============================================================================================================

export class LessonRunner {
  private _phase: RunPhase = 'briefing';
  private readonly fsm: AuthorityFsm;
  private _grader!: Grader;
  private _coach!: Coach;
  private safetyMon!: SafetyMonitor;
  private detector!: DerivedEventDetector;
  private landing!: LandingDetector;
  private trace!: TraceRecorder;
  private timer!: FlightTimer;
  private readonly ctx: RunContext;

  // ---- run identity and position ----
  private attempt: number;
  private attemptId = '';
  private startedAt = '';
  private seed = 0;
  private simT = 0;
  private phaseIdx = 0;
  private stepIdx = 0;
  private phaseRepeat = 0;
  private stepAttempt = 0;
  private interlude: Interlude | null = null;
  private step: StepRun | null = null;
  /** First running frame does the work that needs a sampled frame (lesson vars, the first step). */
  private init: 'fresh' | 'resume' | 'retry' | null = null;
  private busy = false;
  private recovery: Recovery | null = null;
  private limitRec: LimitRecovery | null = null;
  private _resumed = false;
  /**
   * The student handed control back (Shift+Enter) and has not taken it again: the clock of a task they fly
   * stands still meanwhile (it must not time out, nor the next one begin, while she holds it).
   */
  private handedBack = false;
  private handedBackS = 0;

  // ---- run records ----
  private holds: Holds | null = null;
  private holdsRelease: CompiledPred | null = null;
  private checkpoints = new Map<string, CheckpointBlob>();
  private faults: FaultRecord[] = [];
  /** Global fault rules (content/globalRules.ts) with their episode state; and the exercise last flown in the phase. */
  private globalFaults: GlobalFaultRun[] = GLOBAL_FAULT_RULES.map(globalFaultRun);
  private lastExercise: string | null = null;
  private interventions = 0;
  /** Lesson-limit interventions (TaskLimit) in the run; and per task step id, reset when the step exits. */
  private limitInterventions = 0;
  private limitCounts = new Map<string, number>();
  private assessedInterventions = 0;
  private handbacks = 0;
  private phaseRetries = 0;
  private assessedRemarks = 0;
  private safeLandings = 0;
  /** The last landing logged (a crash soon after takes it back). */
  private lastLanding: { t: number; night: boolean } | null = null;
  /** The simulation's crash reason, for the debrief. */
  private crashReason: string | null = null;
  /** The next retry initialisation says "Let's try that again" (a retry the student asked for). */
  private retryLine = false;
  private taskFailures = new Map<string, number>();
  private demoOffer: string | DemoScript | null = null;
  private hoodOn = false;
  private timeCap = 1;
  private _result: LessonResult | null = null;

  // ---- plumbing ----
  private processedSeq = 0;
  private readonly endedSpeech = new Set<string>();
  private readonly lastVariant = new Map<string, number>();
  private unhookSpeech: (() => void) | null = null;
  private uiClockS = UI_PERIOD_S;
  private lastStripKey = '';
  private lastCardKey = '';
  // ---- guidance (owner playtest fixes: callouts, guided checklists, taxi guidance, ground coaching) ----
  /** Checklist items and controls already explained in this run ("why" and "where" are said once). */
  private explained = new Set<string>();
  private readonly ground = new GroundCoach();
  /** A remark or reminder pointing at a control for a few seconds. */
  private remarkPoint: { target: PointTarget; until: number; source: CalloutModel['source']; seq: number; key?: KeyInfo | null } | null = null;
  private pointSeq = 0;
  private lastCalloutKey = '';
  private lastTaxiKey = '';
  /** The aircraft's last position (NED, m) and the taxi route the telemetry follows. */
  private lastPos: { north: number; east: number } | null = null;
  private taxiRoute: TaxiRoute | null = null;
  private taxiSeq = 0;

  constructor(private readonly lesson: Lesson, private readonly host: RunnerHost, private readonly deps: RunnerDeps) {
    this.attempt = deps.attempt;
    this.fsm = new AuthorityFsm(deps.bus, this.initialAuthority());
    this.ctx = new RunContext(deps.aircraft, deps.standards, deps.authority, deps.bus, deps.telemetry, (id) => this._grader.exerciseGrade(id));
    this.resetRun();
  }

  // ---- public surface (section 3.2) -------------------------------------------------------------------------

  /** The taxi route the student is following (the taxi.* signals track it), or null. */
  get activeTaxiRoute(): TaxiRoute | null {
    return this.taxiRoute;
  }

  get phase(): RunPhase {
    return this._phase;
  }

  get authority(): AuthorityFsm {
    return this.fsm;
  }

  get grader(): Grader {
    return this._grader;
  }

  get coach(): Coach {
    return this._coach;
  }

  /** True when this runner was rebuilt from a snapshot (LessonRunner.restore) and has not begun afresh. */
  get resumed(): boolean {
    return this._resumed;
  }

  /** Positions behind the curtain, shows the briefing. */
  async begin(): Promise<void> {
    this._phase = 'positioning';
    this.seed = weatherSeed(this.lesson.id, this.attempt);
    this.host.applyWeather(this.lesson.weather, this.seed);
    const phase = this.deps.startPhase ? this.lesson.flow.find((p) => p.id === this.deps.startPhase) : undefined;
    await this.host.reposition(phase?.retryFrom ?? this.lesson.start, this.lesson.startOptions);
    this._phase = 'briefing';
    this.host.ui.showBriefing(this.briefingModel());
  }

  /** From the briefing. */
  startFlight(): void {
    if (this._phase !== 'briefing') return;
    this.host.ui.hideBriefing();
    this._phase = 'running';
    this.startedAt = iso(this.host.now());
    this.host.setAutopilotAllowed(this.lesson.rules.autopilot === 'allowed');
    this.host.setHood(false);
    if (this.fsm.who === 'instructor') this.host.copilot.holdHere();
    else this.host.copilot.stop();
    this.installSpeechHook();
    this.init = 'fresh';
  }

  /** "Listen" on the briefing: the 30-45 s spoken summary. */
  speakBriefing(): void {
    this.speak(this.lesson.briefing.spoken);
  }

  update(simDt: number, wallDt: number, src: TelemetrySources): void {
    if (this._phase !== 'running') return;
    this.uiClockS += wallDt;
    if (this.busy || simDt <= 0) {
      this.publishUi();
      return;
    }
    const dt = simDt;
    const pos0 = (src.state as Partial<TelemetrySources['state']> | undefined)?.position;
    if (pos0) this.lastPos = { north: pos0.x, east: pos0.y };
    // The taxi route the student is following (taxi.* signals): the runner owns it, the telemetry tracks it.
    if (this.taxiRoute && src.taxiRoute === undefined) src = { ...src, taxiRoute: this.taxiRoute };
    const frame = this.deps.telemetry.sample(src, dt);
    this.simT += dt;
    const ctx = this.ctx;
    ctx.dt = dt;
    ctx.simT = this.simT;
    if (this.taskPausedByHandback()) {
      this.handedBackS += dt;
      if (this.handedBackS >= HANDBACK_PROMPT_S && this.fsm.handover === 'none') {
        this.handedBackS = 0;
        this.speak('runner.handedBackPrompt');
      }
    } else {
      ctx.stepT += dt;
      this.handedBackS = 0;
    }
    ctx.pilot = this.fsm.who;
    ctx.speechIdle = this.host.speech.idle();
    this.host.speech.setSimTime(this.simT);
    this.detector.update(frame, this.simT, dt);
    this.landing.update(frame, this.simT, dt);
    this.timer.update(frame, dt, this.hoodOn || this.lesson.weather.preset === 'imc');

    if (this.init) this.initialise();
    this.processBus();
    if (this._phase !== 'running') return;   // a crash or the end came through the bus

    // 3. Authority (handover offers, acknowledgements, interference).
    this.fsm.update({
      dt, studentInput: src.studentInput, hardwareThrottle: this.host.hardwareThrottle?.() ?? null,
      copilotThrottle: num(frame.throttle), autoAck: this.deps.settings.autoAck, simT: this.simT, demo: this.step?.demo === true,
    });
    this.handleAuthority();
    ctx.pilot = this.fsm.who;
    this.checkHoldsRelease();

    if (this.recovery) {
      this.updateRecovery(dt);
    } else if (this.limitRec) {
      this.updateLimitRecovery(dt);
      if (this.limitRec && this._phase === 'running') this.checkLimitSafety();
      this.settleTransitions();
    } else {
      // 2, 4-6: the current step; 7: safety (may preempt the exit); 8: timeout and outcome.
      const exit = this.tickStep();
      if (!this.checkSafety() && this._phase === 'running') {
        const e = exit ?? this.checkTimeout();
        if (e) this.exitStep(e);
        this.settleTransitions();
      }
    }
    if (this._phase !== 'running') return;
    this.tickGlobalFaults();
    this.tickGuidance(dt);

    if (this.simT >= this.lesson.rules.maxDurationS) {
      this.speak('runner.outOfTime');
      this.finish('timeUp');
      return;
    }
    // 9. Trace and UI.
    // The frame has no position signal: the ground track comes from the state (absent in headless fakes).
    const pos = (src.state as Partial<TelemetrySources['state']> | undefined)?.position;
    this.trace.sample(frame, this.simT, this.fsm.who === 'instructor', pos ? { x: pos.x, y: pos.y } : undefined);
    this.publishUi();
  }

  input(cmd: RunnerCommand): void {
    switch (cmd) {
      case 'retryPhase':
        void this.retryPhase(undefined, true);
        return;
      case 'restartLesson':
        void this.restart();
        return;
      case 'abandon':
        if (this._phase === 'running') this.finish('abandoned');
        else if (this._phase === 'briefing') this._phase = 'ended';
        return;
      default:
        break;
    }
    if (this._phase !== 'running' || this.busy) return;
    switch (cmd) {
      case 'ack':
        this.deps.bus.emit('student.ack', {}, this.simT);
        if (!this.fsm.ack()) this.step?.checklist?.ack();
        this.handleAuthority();
        break;
      case 'handback':
        this.deps.bus.emit('student.handback', {}, this.simT);
        this.fsm.handback();
        this.handleAuthority();
        break;
      case 'sayAgain':
        this.deps.bus.emit('student.sayAgain', {}, this.simT);
        this.sayAgain();
        break;
      case 'showMe':
        this.deps.bus.emit('student.showMe', {}, this.simT);
        this.showMe();
        break;
      case 'skipStep':
        if (this.step && !this.recovery && !this.limitRec) {
          this.exitStep({ result: 'skipped', outcome: 'next' });
          this.settleTransitions();
        }
        break;
      default:
        break;
    }
  }

  /** Resume (section 3.10). */
  snapshot(): RunSnapshot {
    const phase = this.lesson.flow[this.phaseIdx];
    return {
      lessonId: this.lesson.id, lessonVersion: this.lesson.version, attemptId: this.attemptId,
      phaseId: phase?.id ?? '', phaseRepeat: this.phaseRepeat, stepId: phase?.steps[this.stepIdx]?.id ?? '',
      stepAttempt: this.stepAttempt, vars: { ...this.ctx.vars }, authority: this.fsm.who, holds: this.holds,
      exercises: this._grader.closed(), faults: this.faults.map((f) => ({ ...f })), interventions: this.interventions,
      handbacks: this.handbacks, phaseRetries: this.phaseRetries, flightTimer: this.timer.state,
      startedAt: this.startedAt, elapsedSimS: this.simT, weatherSeed: this.seed,
    };
  }

  /**
   * Rebuild after a reload: the current step restarts (its open accumulators are discarded) and the instructor
   * says "Right, where were we.". The host restores the flight first. When the lesson changed version (or the
   * snapshot is for another lesson) the returned runner has not begun: the host calls begin() for a fresh
   * briefing (`resumed` is false).
   */
  static restore(lesson: Lesson, host: RunnerHost, deps: RunnerDeps, snap: RunSnapshot): LessonRunner {
    const r = new LessonRunner(lesson, host, deps);
    if (snap.lessonId !== lesson.id || snap.lessonVersion !== lesson.version) return r;
    r.applySnapshot(snap);
    r.trace.markInterrupted();
    r._phase = 'running';
    r._resumed = true;
    r.installSpeechHook();
    r.init = 'resume';
    return r;
  }

  result(): LessonResult | null {
    return this._result;
  }

  /**
   * (wave 2 addition) The run's EvalContext, refreshed in place every frame. The host gives it to the copilot
   * (InstructorPilot.setContext) so a recovery can evaluate its script before any demo has run, and the
   * AutoStudent reads the run variables through it.
   */
  get evalContext(): EvalContext {
    return this.ctx;
  }

  /**
   * (wave 2 addition) The step being run (an interlude's demo or handback included) and its status, or null
   * between steps. For the host's state API and the AutoStudent; never mutate it.
   */
  get currentStep(): { def: StepDef; status: 'pending' | 'pf' | 'active' | 'busy'; checklist: CardModel['checklist'] } | null {
    const s = this.step;
    if (!s) return null;
    const cl = s.checklist;
    return { def: s.def, status: s.status, checklist: cl ? { title: cl.title, items: cl.items.map((it) => ({ ...it })) } : null };
  }

  /**
   * (wave 2 addition) Speak a cue the copilot asked for (InstructorPilot.onSay: a demo segment's `say`),
   * rendered with the run's variables like any other line. Ignored outside a running lesson.
   */
  say(cue: CueRef): void {
    if (this._phase === 'running') this.speak(cue);
  }

  /**
   * (wave 2 addition) A phase checkpoint from before a reload (TrainingResumeBlock.checkpoint), so "try again
   * from the start of this phase" still works after the page was reloaded mid-phase.
   */
  adoptCheckpoint(cp: CheckpointBlob): void {
    if (this.lesson.flow.some((p) => p.id === cp.runner.phaseId)) this.checkpoints.set(cp.runner.phaseId, cp);
  }

  /**
   * (limit-intervention addition) A lesson-limit intervention in progress: the limit, where the flow is
   * (restoring straight and level, explaining, offering control back) and the run's count; null otherwise.
   */
  get limitIntervention(): { limitId: string; phase: 'restoring' | 'explaining' | 'offering'; count: number } | null {
    const r = this.limitRec;
    return r ? { limitId: r.limit.id, phase: r.phase, count: this.limitInterventions } : null;
  }

  /** Current position (window.__sim.training.state(), menu School tab). */
  get position(): { phaseId: string; stepId: string; vars: Readonly<Record<string, number>> } {
    const phase = this.lesson.flow[this.phaseIdx];
    const def = this.step?.def ?? phase?.steps[this.stepIdx];
    return { phaseId: phase?.id ?? '', stepId: def?.id ?? '', vars: this.ctx.vars };
  }

  /**
   * (module 5 addition) A wheel contact from the SimEvents touchdown handler, which runs inside the physics
   * step: `td` is the step-exact TouchdownData (events.ts touchdownData) for the landing detector.
   */
  onTouchdown(wheel: 'nose' | 'left' | 'right', sinkFpm: number, td: TouchdownData | null): void {
    if (this._phase !== 'running') return;
    this.deps.bus.emit('touchdown', { wheel, sinkFpm }, this.simT);
    if (td) this.landing.onTouchdown(td, this.simT);
  }

  /** (module 5 addition) The SimEvents crash: the lesson ends 'crashed' (debrief offers "Try again"). */
  onCrash(reason: string): void {
    if (this._phase !== 'running') return;
    this.deps.bus.emit('crash', { reason }, this.simT);
    this.crashReason = reason;
    this.finish('crashed');
  }

  /**
   * "Try again from the start of this phase" (Shift+R), or from a named phase's checkpoint ("Try one
   * exercise again" on the debrief, which reopens the run). `counted` adds to phaseRetries (stars cap at 2).
   */
  async retryPhase(phaseId?: string, counted = true): Promise<void> {
    if ((this._phase !== 'running' && this._phase !== 'debrief') || this.busy) return;
    const cp = phaseId ? this.checkpoints.get(phaseId) : this.latestCheckpoint();
    if (!cp) return;
    if (this._phase === 'debrief') {
      this.host.ui.hideDebrief();
      this._result = null;
      this._phase = 'running';
      this.installSpeechHook();
      this.host.setAutopilotAllowed(this.lesson.rules.autopilot === 'allowed');
    }
    this.busy = true;
    this.dropOpenStep();
    this.recovery = null;
    this.limitRec = null;
    this.host.speech.flush();
    this.setHolds(null);
    const phase = this.lesson.flow.find((p) => p.id === cp.runner.phaseId);
    const keep = {
      interventions: this.interventions, limits: this.limitInterventions, assessed: this.assessedInterventions, handbacks: this.handbacks,
      retries: this.phaseRetries + (counted ? 1 : 0), remarks: this.assessedRemarks, landings: this.safeLandings,
    };
    try {
      if (phase?.retryFrom) await this.host.reposition(phase.retryFrom, this.lesson.startOptions);
      else await this.host.restore(cp);
    } finally {
      this.applySnapshot(cp.runner);
      // Counters survive the rewind: two interventions end a lesson however many retries lie between them.
      this.interventions = Math.max(this.interventions, keep.interventions);
      this.limitInterventions = keep.limits;
      this.limitCounts = new Map();
      this.assessedInterventions = keep.assessed;
      this.handbacks = Math.max(this.handbacks, keep.handbacks);
      this.phaseRetries = keep.retries;
      this.assessedRemarks = keep.remarks;
      this.safeLandings = keep.landings;
      this.trace.truncate(cp.traceOffset);
      this.safetyMon.reset();
      this.detector.reset();
      this.landing.reset();
      this.lastLanding = null;
      // A retry the student asked for (Shift+R, the debrief) is acknowledged; after an intervention the
      // instructor has already said "Let's try that again".
      this.retryLine = counted;
      this.init = 'retry';
      this.busy = false;
    }
  }

  // ---- lifecycle internals ----------------------------------------------------------------------------------

  /** Per-run objects and records (constructor and restartLesson). */
  private resetRun(): void {
    const d = this.deps;
    this.attemptId = `${this.lesson.id}-${this.host.now().toString(36)}-${Math.floor(d.rng() * 1e6).toString(36)}`;
    this._grader = new Grader({
      standards: d.standards, authority: d.authority, exercises: this.lesson.exercises,
      firstAttemptCounts: this.lesson.kind === 'check' || this.lesson.kind === 'test',
    });
    this._coach = new Coach({ talkativeness: d.settings.talkativeness, rate: (id) => d.telemetry.rate(id), abInitio: isAbInitio(this.lesson) });
    this.safetyMon = new SafetyMonitor(this.envelope());
    this.detector = new DerivedEventDetector(d.bus);
    this.landing = new LandingDetector(d.bus);
    this.trace = new TraceRecorder(`trace-${this.attemptId}`, this.lesson.id);
    this.timer = new FlightTimer(this.startsFlying());
    this.fsm.reset(this.initialAuthority());
    d.bus.clear();
    this.processedSeq = d.bus.mark();
    this.simT = 0;
    this.phaseIdx = this.stepIdx = this.phaseRepeat = this.stepAttempt = 0;
    this.interlude = null;
    this.step = null;
    this.init = null;
    this.recovery = null;
    this.limitRec = null;
    this.limitInterventions = 0;
    this.limitCounts = new Map();
    this.handedBack = false;
    this.holds = null;
    this.holdsRelease = null;
    this.checkpoints = new Map();
    this.faults = [];
    this.globalFaults = GLOBAL_FAULT_RULES.map(globalFaultRun);
    this.lastExercise = null;
    this.interventions = this.assessedInterventions = this.handbacks = this.phaseRetries = 0;
    this.assessedRemarks = this.safeLandings = 0;
    this.lastLanding = null;
    this.crashReason = null;
    this.taskFailures = new Map();
    this.demoOffer = null;
    this.hoodOn = false;
    this._result = null;
    this._resumed = false;
    this.ctx.vars = {};
    this.ctx.stepT = 0;
    this.ctx.simT = 0;
  }

  /** "Restart lesson": back to the briefing at the lesson start, a new attempt. */
  private async restart(): Promise<void> {
    if (this.busy || this._phase === 'positioning') return;
    if (this._phase === 'debrief') this.host.ui.hideDebrief();
    this.dropOpenStep();
    this.host.speech.flush();
    this.host.copilot.setHolds(null);
    this.host.copilot.stop();
    this.clearInFlightUi();
    this.unhook();
    this.attempt++;
    this.resetRun();
    await this.begin();
  }

  /** Lesson vars, then the first step: needs a sampled frame (vars may name signals). */
  private initialise(): void {
    const mode = this.init;
    this.init = null;
    if (mode === 'fresh') {
      for (const [k, ref] of Object.entries(this.lesson.vars ?? {})) this.ctx.vars[k] = resolveRef(ref, this.ctx);
      const start = this.deps.startPhase ? this.lesson.flow.findIndex((p) => p.id === this.deps.startPhase) : 0;
      this.enterPhase(Math.max(0, start), 0, 0, true);
    } else {
      // Resume and retry restart the step the snapshot names (a checkpoint names its phase's first step).
      // After a reload the instructor picks up the thread first, then the step's own lines follow.
      if (mode === 'resume') this.speak('runner.whereWereWe');
      if (mode === 'retry' && this.retryLine) this.speak('runner.tryAgain');
      this.retryLine = false;
      this.enterPhase(this.phaseIdx, this.phaseRepeat, this.stepIdx, false);
      // A reload during a limit intervention's restore resumes with the instructor flying a student task: the
      // task restarts, so offer control back (a task without `pf` is only ever met by the student).
      const st = this.step;
      if (mode === 'resume' && st?.def.kind === 'task' && st.status === 'active' && st.def.pf === undefined
        && this.fsm.who === 'instructor' && this.lesson.kind === 'dual') {
        this.fsm.offer();
        this.handleAuthority();
      }
    }
    this.settleTransitions();
  }

  private finish(ended: OutcomeInput['ended']): void {
    if (this._phase !== 'running') return;
    const s = this.step;
    if (s?.taskOpen) {
      if (ended === 'abandoned') this.closeTask(s, null);
      else this.closeTask(s, ended === 'timeUp' ? 'timeout' : ended === 'crashed' ? 'crash' : 'fail');
    }
    s?.checklist?.finish();
    if (s?.demo) this.endDemoVisuals(s);
    this.step = null;
    this.interlude = null;
    this.recovery = null;
    this.limitRec = null;
    this.setHolds(null);
    const airborne = this.deps.telemetry.frame.onGround === false;
    if ((ended === 'completed' || ended === 'timeUp') && airborne) {
      this.fsm.take('plan', true);   // "OK, I have control. Let's head back."
      this.host.copilot.holdHere();
    } else {
      this.host.copilot.stop();
    }
    this.clearInFlightUi();
    this.deps.store?.saveCheckpoint(null);
    if (ended === 'crashed' && this.lastLanding && this.simT - this.lastLanding.t < CRASH_VOIDS_LANDING_S) {
      this.timer.retractLanding(this.lastLanding.night);
    }
    this.timer.stop();

    const result = this.buildResult(ended);
    this._result = result;
    const trace = this.trace.data();
    const extras = this.host.onLessonEnd?.(result, trace) ?? {};
    if (ended === 'abandoned') {
      this._phase = 'ended';
      this.unhook();
      return;
    }
    this._phase = 'debrief';
    this.host.ui.showDebrief(this.debriefModel(result, trace, extras));
    for (const line of result.debrief.spoken) this.speak({ text: line });
    this.unhook();
  }

  private clearInFlightUi(): void {
    this.host.setHood(false);
    this.hoodOn = false;
    this.host.setTimeScaleCap(Number.POSITIVE_INFINITY);
    this.host.setAutopilotAllowed(true);
    this.host.ui.setStrip(null);
    this.host.ui.setCard(null);
    this.host.ui.setHighlight([]);
    this.host.ui.setFollowMeThrough(false);
    this.host.ui.setCallout?.(null);
    this.host.ui.setTaxiGuide?.(null);
    this.lastCalloutKey = this.lastTaxiKey = '';
    this.taxiRoute = null;
    this.lastStripKey = this.lastCardKey = '';
  }

  private buildResult(ended: OutcomeInput['ended']): LessonResult {
    const lesson = this.lesson;
    const exercises = this._grader.exerciseResults();
    const input: OutcomeInput = {
      lesson, exercises, previous: this.deps.progress, assessedInterventions: this.assessedInterventions, ended,
      criticalFault: this.faults.some((f) => f.severity === 'critical'),
    };
    if (lesson.kind === 'test') input.failedSections = this.failedSections(exercises);
    const outcome = lessonOutcome(input);
    const calmAir = this.deps.calmAir === true;
    const stars = lessonStars({
      ...input, outcome, phaseRetries: this.phaseRetries, calmAir, assessedRemarks: this.assessedRemarks, interventions: this.interventions,
    });
    const flags: LessonResult['flags'] = {
      calmAir, ...(this.deps.inputFlags?.() ?? { kbdAssists: true, inputDevice: 'keyboard' }), instructorSaves: this.savesOn(),
    };
    const partial: Omit<LessonResult, 'debrief'> = {
      lessonId: lesson.id, lessonVersion: lesson.version, attemptId: this.attemptId, authority: this.deps.authority,
      startedAt: this.startedAt || iso(this.host.now()), endedAt: iso(this.host.now()), outcome, stars, exercises,
      interventions: this.interventions, handbacks: this.handbacks, phaseRetries: this.phaseRetries, flags,
      weatherLine: this.host.describeWeather?.() ?? '', flight: this.timer.state.times, traceId: this.trace.data().id,
      safeLandings: this.safeLandings,
      ...(this.limitInterventions > 0 ? { limitInterventions: this.limitInterventions } : {}),
    };
    return { ...partial, debrief: buildDebrief(lesson, partial, ended === 'crashed' ? this.crashReason ?? undefined : undefined, this._grader.lessonFaults()) };
  }

  /** Skill test: a section fails when any required item in it is below 2 or was never flown. */
  private failedSections(exercises: readonly LessonResult['exercises'][number][]): number[] {
    const failed = new Set<number>();
    for (const def of this.lesson.exercises) {
      if (!def.testSection || !def.required) continue;
      const r = exercises.find((e) => e.exerciseId === def.id);
      if (!r || r.grade === null || r.grade < 2) failed.add(def.testSection);
    }
    return [...failed].sort((a, b) => a - b);
  }

  // ---- phases -----------------------------------------------------------------------------------------------

  private enterPhase(idx: number, repeat: number, atStep: number, takeCheckpoint: boolean): void {
    const phase = this.lesson.flow[idx];
    if (!phase) {
      this.finish('completed');
      return;
    }
    this.phaseIdx = idx;
    this.phaseRepeat = repeat;
    this.stepIdx = atStep;
    this.stepAttempt = 0;
    this.interlude = null;
    this._grader.beginPhaseRun();
    this.lastExercise = null;
    this._coach.beginPhase();
    this._coach.setLevel(this.coachLevel(phase));
    this.safetyMon.configure(this.envelope(), phase.lowLevel === true);
    this.timeCap = phase.maxTimeScale ?? this.lesson.rules.maxTimeScale ?? 1;
    this.host.setTimeScaleCap(this.timeCap);
    if (atStep === 0 && repeat === 0) this.trace.phase(this.simT, phase.title);
    if (takeCheckpoint && atStep === 0 && repeat === 0 && (phase.checkpoint ?? phase.steps.some((s) => s.kind === 'task'))) {
      this.takeCheckpoint(phase);
    }
    this.enterStep();
  }

  private takeCheckpoint(phase: PhaseDef): void {
    // The host captures the flight; the runner's own part is filled in here so the blob is always coherent.
    const cp: CheckpointBlob = { ...this.host.checkpoint(), runner: this.snapshot(), traceOffset: this.trace.length };
    this.checkpoints.set(phase.id, cp);
    this.deps.store?.saveCheckpoint(cp);
  }

  /** The checkpoint of the current phase, else the latest earlier one. */
  private latestCheckpoint(): CheckpointBlob | null {
    for (let i = this.phaseIdx; i >= 0; i--) {
      const cp = this.checkpoints.get(this.lesson.flow[i].id);
      if (cp) return cp;
    }
    return null;
  }

  private endOfPhase(): void {
    const phase = this.lesson.flow[this.phaseIdx];
    const rep = phase.repeat;
    if (rep && this.phaseRepeat + 1 < rep.max && !(rep.until && this.evalOnce(rep.until))) {
      this.repeatPhase(phase);
      return;
    }
    this.enterPhase(this.phaseIdx + 1, 0, 0, true);
  }

  /** Re-run the phase from its checkpoint position, keeping this run's grades (repeat.until reads them). */
  private repeatPhase(phase: PhaseDef): void {
    const cp = this.checkpoints.get(phase.id);
    const next = this.phaseRepeat + 1;
    this.speak('runner.onceMore');
    if (!cp && !phase.retryFrom) {
      this.enterPhase(this.phaseIdx, next, 0, false);
      return;
    }
    this.busy = true;
    this.step = null;
    const done = (): void => {
      this.busy = false;
      this.detector.reset();
      this.landing.reset();
      this.safetyMon.reset();
      this.handedBack = false;
      if (cp) {
        this.fsm.reset(cp.runner.authority);
        if (cp.runner.authority === 'instructor') this.host.copilot.holdHere();
        else this.host.copilot.stop();
        this.setHolds(cp.runner.holds);
      }
      this.enterPhase(this.phaseIdx, next, 0, false);
    };
    const p = phase.retryFrom ? this.host.reposition(phase.retryFrom, this.lesson.startOptions) : this.host.restore(cp as CheckpointBlob);
    p.then(done, (e: unknown) => {
      console.warn('[training] phase repeat: repositioning failed', e);
      done();
    });
  }

  // ---- steps ------------------------------------------------------------------------------------------------

  private currentDef(): StepDef | null {
    if (this.interlude) return this.interlude.steps[this.interlude.index] ?? null;
    return this.lesson.flow[this.phaseIdx]?.steps[this.stepIdx] ?? null;
  }

  private enterStep(): void {
    const def = this.currentDef();
    if (!def) {
      this.advance();
      return;
    }
    const s: StepRun = {
      def, status: 'pending', when: def.when ? compile(def.when) : null, pendingS: 0,
      nextPromptS: def.whenPrompt?.afterS ?? Infinity, done: null, sayId: null, until: null, exercise: null, goal: null,
      faults: [], onSeq: 0, taskOpen: false, startedSimT: this.simT, settleS: 0, taskHolds: false, demo: false,
      demoFromS: 0, followMe: false, checklist: null, fb: null, limits: [], ref: null, startCue: null, lineIds: [],
      point: null, ladder: new ReminderLadder(), taxi: null,
    };
    this.step = s;
    this.ctx.stepT = 0;
    this.ctx.stepMark = this.deps.bus.mark();
    const phase = this.lesson.flow[this.phaseIdx];
    this.deps.bus.emit('step.enter', { phase: phase?.id ?? '', step: def.id }, this.simT);
    if (!s.when) this.beginPilotFlying(s);
  }

  /** After `when`: the handover the step's `pf` asks for, then activation. */
  private beginPilotFlying(s: StepRun): void {
    const pf = s.def.pf;
    if (!pf || pf === this.fsm.who) {
      this.activate(s);
      return;
    }
    s.status = 'pf';
    if (pf === 'student') this.fsm.offer();
    else this.takeControl('plan');
  }

  private activate(s: StepRun): void {
    s.status = 'active';
    this.ctx.stepT = 0;
    this.deps.telemetry.markStep();
    const mark = this.deps.bus.mark();
    this.ctx.stepMark = mark;
    s.onSeq = mark;
    this.deps.bus.trim(Math.min(mark, this.processedSeq));
    this.ctx.standard = this.lessonStandard();
    const def = s.def;
    if ((def.kind === 'say' || def.kind === 'wait' || def.kind === 'task') && def.point) {
      s.point = { target: def.point, state: def.pointState ?? null, until: def.pointWhen ? compile(def.pointWhen) : null, done: false };
    }
    switch (def.kind) {
      case 'say':
        s.sayId = this.speak(def.cue)?.id ?? null;
        if (!def.wait || s.sayId === null) s.done = { result: 'success' };
        break;
      case 'wait':
        s.until = compile(def.until);
        if (def.cue) this.speak(def.cue);
        break;
      case 'capture':
        for (const [k, v] of Object.entries(def.vars)) this.ctx.vars[k] = this.captureValue(v);
        s.done = { result: 'success' };
        break;
      case 'setup':
        this.runSetup(s, def);
        break;
      case 'handover':
        if (def.to === 'student') this.fsm.offer();
        else this.takeControl('plan');
        break;
      case 'demo':
        this.startDemo(s, def);
        break;
      case 'checklist':
        this.startChecklist(s, def);
        break;
      case 'branch': {
        const hit = def.cases.find((c) => this.evalOnce(c.when));
        s.done = { result: 'success', outcome: { goto: hit ? hit.goto : def.else } };
        break;
      }
      case 'end': {
        // Airborne in a dual lesson she takes control for the trip home before the wrap-up; the debrief then
        // waits until that line has been heard (it opened at once before, and the line was never spoken).
        const airborne = this.deps.telemetry.frame.onGround === false;
        if (airborne && this.fsm.who === 'student' && this.lesson.kind === 'dual') {
          const own = def.cue ? this.resolveCue(def.cue) : null;
          const ownText = own ? (Array.isArray(own.line.text) ? own.line.text.join(' ') : own.line.text) : '';
          this.takeControl('plan', /i have control/i.test(ownText));
        }
        // A long time-to-live: it may queue behind the last task's confirmation and a coaching remark.
        s.sayId = def.cue ? this.speak(def.cue, undefined, { ttlS: SAY_WAIT_CAP_S })?.id ?? null : null;
        if (s.sayId === null) s.done = { result: 'success', outcome: 'end' };
        break;
      }
      case 'task':
        this.startTask(s, def);
        break;
    }
  }

  /** Steps 2 and 4-6 of the frame for the current step. Returns an exit when the step finished. */
  private tickStep(): StepExit | null {
    const s = this.step;
    if (!s) return null;
    if (s.done) return s.done;
    const def = s.def;
    if (s.status === 'pending') {
      s.pendingS += this.ctx.dt;
      if (s.when?.eval(this.ctx)) {
        this.beginPilotFlying(s);
      } else {
        const wp = def.whenPrompt;
        if (wp && s.pendingS >= s.nextPromptS) {
          this.speak(wp.cue);
          s.nextPromptS = wp.everyS ? s.pendingS + wp.everyS : Infinity;
        }
        return null;
      }
    }
    if (s.status === 'pf') {
      if (this.fsm.who !== def.pf) return null;
      this.activate(s);
    }
    if (s.status !== 'active') return null;
    if (s.done) return s.done;
    switch (def.kind) {
      case 'say':
        if ((s.sayId !== null && this.endedSpeech.has(s.sayId)) || this.ctx.stepT >= SAY_WAIT_CAP_S || (this.ctx.stepT > 1 && this.host.speech.idle())) {
          return { result: 'success' };
        }
        return null;
      case 'wait':
        return s.until?.eval(this.ctx) ? { result: 'success' } : null;
      case 'handover':
        return this.fsm.who === def.to ? { result: 'success' } : null;
      case 'end':
        if ((s.sayId !== null && this.endedSpeech.has(s.sayId)) || this.ctx.stepT >= SAY_WAIT_CAP_S || (this.ctx.stepT > 1 && this.host.speech.idle())) {
          return { result: 'success', outcome: 'end' };
        }
        return null;
      case 'demo':
        return this.tickDemo(s);
      case 'checklist':
        return this.tickChecklist(s);
      case 'task':
        return this.tickTask(s, def);
      default:
        return null;
    }
  }

  /** Step 8: the step's timeout (pending time counts too, so a `when` can never hang a lesson). */
  private checkTimeout(): StepExit | null {
    const s = this.step;
    if (!s || s.status === 'busy') return null;
    const def = s.def;
    if (def.kind === 'handover' && s.status === 'active') {
      return this.ctx.stepT >= (def.ackTimeoutS ?? DEFAULT_ACK_TIMEOUT_S) ? { result: 'timeout' } : null;
    }
    if (def.timeoutS === undefined) return null;
    const t = s.status === 'active' ? this.ctx.stepT : s.pendingS;
    return t >= def.timeoutS ? { result: 'timeout' } : null;
  }

  /** Instant steps (capture, branch, say without wait, ...) chain within the frame with dt = 0. */
  private settleTransitions(): void {
    const dt = this.ctx.dt;
    this.ctx.dt = 0;
    for (let i = 0; i < MAX_TRANSITIONS_PER_FRAME; i++) {
      if (this._phase !== 'running' || this.busy || this.recovery || this.limitRec || !this.step) break;
      const e = this.tickStep();
      if (!e) break;
      this.exitStep(e);
    }
    this.ctx.dt = dt;
  }

  private exitStep(e: StepExit): void {
    const s = this.step;
    if (!s) return;
    const def = s.def;
    let outcome: Outcome = e.outcome ?? 'next';
    let failed = e.result === 'fail';
    if (def.kind === 'task') {
      if (s.taskOpen) this.closeTask(s, e.result === 'skipped' ? null : e.result);
      this.dropStepLines(s);
      this.limitCounts.delete(def.id);
      if (!e.outcome) {
        if (e.result === 'success') {
          // The feedback's success line comes first ("Good. That's the primary effect of elevator."), then onSuccess.
          if (def.feedback?.success) this.speak(def.feedback.success);
          if (def.onSuccess?.cue) this.speak(def.onSuccess.cue);
          outcome = def.onSuccess?.next ?? 'next';
        } else if (e.result === 'timeout') {
          outcome = def.onTimeout ?? 'fail';
        } else if (e.result === 'fail') {
          outcome = 'fail';
        }
      }
      if (outcome === 'fail') {
        failed = true;
        if (def.onFail?.cue) this.speak(def.onFail.cue);
        outcome = def.onFail?.next ?? 'next';
        if (outcome === 'fail') outcome = 'next';
      }
      if (failed) this.noteTaskFailure(def);
    } else {
      if (!e.outcome && e.result === 'timeout') outcome = def.onTimeout ?? 'next';
      if (outcome === 'fail') outcome = 'next';
    }
    if (def.kind === 'checklist') this.closeChecklist(s, def);
    if (s.demo) this.endDemoVisuals(s);
    this.endTaxi(s);
    const phase = this.lesson.flow[this.phaseIdx];
    this.deps.bus.emit('step.exit', { phase: phase?.id ?? '', step: def.id, result: e.result }, this.simT);
    this.step = null;
    this.applyOutcome(outcome, def);
  }

  private applyOutcome(o: Outcome, def: StepDef): void {
    if (o === 'next') return this.advance();
    if (o === 'end') return this.finish('completed');
    if (o === 'instructorTakes') {
      this.takeControl('plan');
      return this.advance();
    }
    if (o === 'retry') {
      const max = def.kind === 'task' ? def.attempts ?? DEFAULT_ATTEMPTS : DEFAULT_ATTEMPTS;
      if (this.stepAttempt + 1 < max) {
        this.stepAttempt++;
        return this.enterStep();
      }
      return this.advance();
    }
    if (o === 'fail') return this.advance();
    if ('goto' in o) return this.goto(o.goto);
    if ('demo' in o) return this.demoThenRetry(o.demo, def);
  }

  private advance(): void {
    if (this.interlude) {
      this.interlude.index++;
      if (this.interlude.index < this.interlude.steps.length) return this.enterStep();
      // The interlude (demo + handback) is over: the step it interrupted runs again.
      this.interlude = null;
      this.stepAttempt++;
      return this.enterStep();
    }
    this.stepAttempt = 0;
    this.stepIdx++;
    const phase = this.lesson.flow[this.phaseIdx];
    if (!phase || this.stepIdx >= phase.steps.length) return this.endOfPhase();
    this.enterStep();
  }

  /** `goto`: a step id (this phase first, then any phase) or 'phase:<id>'. */
  private goto(target: string): void {
    this.interlude = null;
    if (target.startsWith('phase:')) {
      const idx = this.lesson.flow.findIndex((p) => p.id === target.slice(6));
      if (idx >= 0) return this.enterPhase(idx, 0, 0, true);
    } else {
      const here = this.lesson.flow[this.phaseIdx]?.steps.findIndex((st) => st.id === target) ?? -1;
      if (here >= 0) {
        this.stepIdx = here;
        this.stepAttempt = 0;
        return this.enterStep();
      }
      for (let p = 0; p < this.lesson.flow.length; p++) {
        const i = this.lesson.flow[p].steps.findIndex((st) => st.id === target);
        if (i >= 0) return this.enterPhase(p, 0, i, true);
      }
    }
    console.warn(`[training] ${this.lesson.id}: goto target '${target}' not found; continuing`);
    this.advance();
  }

  /** Outcome { demo, thenRetry } and "Show me": the demo, a handback, then the same step again. */
  private demoThenRetry(script: string | DemoScript, def: StepDef): void {
    const demoStep: DemoStep = { kind: 'demo', id: `${def.id}.demo`, script, followMeThrough: true, intro: 'runner.showYou' };
    this.interlude = { steps: [demoStep, { kind: 'handover', id: `${def.id}.handback`, to: 'student' }], index: 0 };
    this.enterStep();
  }

  /** Abandon the open step without an outcome (intervention, retry, restart, show me). */
  private dropOpenStep(): void {
    const s = this.step;
    if (!s) return;
    if (s.taskOpen) this.closeTask(s, null);
    this.dropStepLines(s);
    s.checklist?.finish();
    if (s.demo) this.endDemoVisuals(s);
    this.endTaxi(s);
    this.step = null;
  }

  // ---- tasks ------------------------------------------------------------------------------------------------

  private startTask(s: StepRun, def: TaskStep): void {
    s.exercise = this.lesson.exercises.find((x) => x.id === def.exercise) ?? null;
    this.ctx.standard = s.exercise?.standard ?? this.lessonStandard();
    s.goal = compile(def.goal);
    s.faults = (def.faults ?? []).map((rule) => ({ rule, pred: compile(rule.when), was: false, fired: false }));
    s.startedSimT = this.simT;
    s.settleS = Math.min(DEFAULT_SETTLE_S, ...def.criteria.filter((c) => c.kind === 'hold').map((c) => c.settleS ?? DEFAULT_SETTLE_S));
    this._grader.beginTask(def, this.ctx);
    this.lastExercise = def.exercise;
    this._coach.beginTask(def, this.ctx);
    s.taskOpen = true;
    if (def.holds) {
      this.setHolds(def.holds);
      s.taskHolds = true;
    }
    const brief = this.speak(def.brief);
    if (brief) s.lineIds.push(brief.id);
    // The taxi route first: its opening call goes before a deferred "Go ahead" (sayDeferredStart).
    this.beginTaxi(s, def);
    this.beginTaskFeedback(s, def);
    if (def.feedback?.start) {
      // "Go ahead" goes to a student who has control; otherwise it waits until they take it.
      s.startCue = def.feedback.start;
      if (def.pf === 'instructor') {
        const r = this.speak(def.feedback.start);
        s.startCue = null;
        if (r) s.lineIds.push(r.id);
      } else {
        this.sayDeferredStart();
      }
    }
    this.host.ui.setHighlight(def.highlight ?? []);
    const hdg = def.card.targets.find((t) => t.sig === 'hdgDeg');
    const target = hdg ? resolveRef(hdg.value, this.ctx) : NaN;
    if (Number.isFinite(target)) this.detector.armRollout(target);
    // A task that waits for the roll-out without a heading on its card (a 360, a clearing turn) still gets
    // the event; its heading error is then NaN. (Before, such a goal could never be met: wave-3 calibration.)
    else if (mentionsRollout(def)) this.detector.armRollout(NaN);
  }

  private tickTask(s: StepRun, def: TaskStep): StepExit | null {
    const ctx = this.ctx;
    // 2. Event handlers: an event since the task began jumps elsewhere.
    if (def.on?.length) {
      for (const r of this.deps.bus.since(s.onSeq)) {
        s.onSeq = r.seq + 1;
        const h = def.on.find((x) => x.event === r.type && whereMatches(x.where, r));
        if (h) {
          if (h.cue) this.speak(h.cue);
          return { result: 'success', outcome: { goto: h.goto } };
        }
      }
    }
    const student = this.fsm.who === 'student';
    // A zero-time tick (a task entered while instant steps chain within one frame) samples nothing: the
    // grader ignores it, so the goal and the fault rules wait too. Otherwise a `held` goal starts its timer one
    // frame before the criteria that mirror it (L01 "trimmed for 30 s") and ends the task a frame too early.
    if (!(ctx.dt > 0)) return null;
    // 5. Grader: instructor time is never graded.
    if (student) this._grader.sample(ctx);
    const goal = s.goal?.eval(ctx) === true;
    // 6. Faults, then the coach.
    for (const f of s.faults) {
      const v = f.pred.eval(ctx);
      const rising = v && !f.was;
      f.was = v;
      if (!rising || (f.rule.once && f.fired)) continue;
      f.fired = true;
      this.recordFault(f.rule.id, f.rule.severity);
      if (f.rule.cue) this.speak(f.rule.cue);
      if (f.rule.action === 'endTask') return { result: 'fail' };
      if (f.rule.action === 'takeover') {
        this.takeControl('plan');
        return { result: 'fail' };
      }
    }
    // Lesson limits: past one for its time, the instructor takes control (the task restarts afterwards).
    if (student && this.fsm.handover === 'none' && this.checkLimits(s)) return null;
    if (student) {
      const remark = this._coach.update(ctx, ctx.stepT >= s.settleS, ctx.speechIdle);
      if (remark) this.speakRemark(remark, s);
    }
    // Success needs the goal, the minimum time, and the student flying (a goal met by the copilot's hold
    // after a handback is not the student's).
    const success = goal && ctx.stepT >= (def.minS ?? 0) && (student || def.pf === 'instructor');
    if (student && !success) this.tickTaskFeedback(s, def);
    if (success) return { result: 'success' };
    return null;
  }

  // ---- task feedback (TaskFeedback) -------------------------------------------------------------------------

  private beginTaskFeedback(s: StepRun, def: TaskStep): void {
    const f = this.ctx.frame;
    const n = (k: string): number => num(f[k]);
    const hdg = n('hdgDeg');
    s.ref = { altFt: n('altFt'), hdgDeg: Number.isFinite(hdg) ? hdg : null, kias: Number.isFinite(n('asiKt')) ? n('asiKt') : n('kias') };
    s.limits = (def.limits ?? []).map((l) => ({ def: l, outS: 0 }));
    const fb = def.feedback;
    s.fb = fb ? {
      missing: (fb.nudge?.missing ?? []).map((m) => compile(m.when)),
      milestones: (fb.milestones ?? []).map((m) => ({ id: m.id, pred: compile(m.when), minT: m.minT ?? 0, due: false, dueT: 0, now: false, fired: false, cue: m.cue })),
      lastMilestoneT: -Infinity, quietS: 0, lastNudgeT: -Infinity,
    } : null;
  }

  /**
   * Milestones (once each, in list order, 2 s apart, Coach priority) and nudges (after `afterS` of silence
   * while the goal is not met, at most every `everyS`). Only while the student flies; they wait for a quiet
   * moment rather than queue behind the brief.
   */
  private tickTaskFeedback(s: StepRun, def: TaskStep): void {
    const fb = s.fb;
    if (!fb) return;
    const ctx = this.ctx;
    for (const m of fb.missing) m.eval(ctx);
    for (const m of fb.milestones) {
      // Every predicate is evaluated every frame so `held` timers inside stay true to the flight.
      const v = m.pred.eval(ctx);
      m.now = v;
      if (!m.due && !m.fired && v && ctx.stepT >= m.minT) {
        m.due = true;
        m.dueT = this.simT;
      }
    }
    // Live, not the frame's snapshot: the brief may have been queued earlier in this very frame.
    const idle = this.host.speech.idle();
    fb.quietS = idle ? fb.quietS + ctx.dt : 0;
    if (!idle) return;
    // Only the latest milestone that is still true (or was met moments ago) is said; the ones before it are
    // stale and dropped, so she never praises the left bank once the student is already rolling right.
    let pick = -1;
    for (let i = fb.milestones.length - 1; i >= 0; i--) {
      const m = fb.milestones[i];
      if (m.due && !m.fired && (m.now || this.simT - m.dueT <= MILESTONE_TTL_S)) {
        pick = i;
        break;
      }
    }
    for (let i = 0; i < fb.milestones.length; i++) {
      const m = fb.milestones[i];
      // Earlier than the pick, or due but expired: never said.
      if (m.due && !m.fired && (i < pick || (pick < 0 && !m.now && this.simT - m.dueT > MILESTONE_TTL_S))) m.fired = true;
    }
    const next = pick >= 0 ? fb.milestones[pick] : null;
    if (next && this.simT - fb.lastMilestoneT >= MILESTONE_GAP_S) {
      next.fired = true;
      fb.lastMilestoneT = this.simT;
      fb.quietS = 0;
      const spoken = this.speak(next.cue, undefined, { priority: Priority.Coach, ttlS: MILESTONE_TTL_S });
      if (spoken) {
        s.lineIds.push(spoken.id);
        this.trace.event({ t: this.simT, type: 'coach', label: spoken.caption });
      }
      return;
    }
    const nudge = def.feedback?.nudge;
    if (!nudge) return;
    const talk = TALK_FACTOR[this.deps.settings.talkativeness];
    const afterS = (nudge.afterS ?? NUDGE_AFTER_S) * talk;
    const everyS = (nudge.everyS ?? NUDGE_EVERY_S) * talk;
    if (fb.quietS >= afterS && this.simT - fb.lastNudgeT >= everyS) {
      fb.lastNudgeT = this.simT;
      fb.quietS = 0;
      this.nudge(s, def);
    }
  }

  /**
   * A nudge (decision 4 of the owner playtest fixes): built from the student's state, best first - the first
   * thing still missing (TaskFeedback.nudge.missing), the next taxi action, then the lesson's own nudge with
   * {missing} - and never the previous nudge's words. With nothing new to say, or after two, the instructor
   * offers help instead (the left bracket shows), once.
   */
  private nudge(s: StepRun, def: TaskStep): void {
    const L = s.ladder;
    if (L.helpOffered) return;
    const nudge = def.feedback?.nudge;
    const candidates: string[] = [];
    const missing = (nudge?.missing ?? []).find((m, i) => s.fb?.missing[i]?.value === true) ?? null;
    if (missing?.cue) candidates.push(...this.renderVariants(missing.cue));
    const taxiLine = s.taxi?.guide?.reminder(this.ctx.frame);
    if (taxiLine) candidates.push(taxiLine);
    // With a `missing` list, the general nudge is only for when something on it is missing: with nothing missing
    // the student is doing it (playtest 3: "Throttle up slowly until the tachometer reads 1,800" at 1,800).
    if (nudge && (missing || !nudge.missing?.length)) candidates.push(...this.renderVariants(nudge.cue, missing ? { missing: missing.text } : undefined));
    const line = L.dueForHelp ? null : L.next(candidates);
    if (line) {
      if (missing?.point) this.pointAt(missing.point, 'reminder');
      const r = this.speak({ text: line }, undefined, { priority: Priority.Coach, ttlS: FEEDBACK_TTL_S });
      if (r) s.lineIds.push(r.id);
      return;
    }
    if (L.count === 0) return;
    L.offerHelp();
    const demo = this.lesson.kind === 'dual' ? this.demoFor(def) : null;
    if (demo) this.demoOffer = demo;
    const r = this.speak(demo ? 'runner.taskHelp' : 'runner.taskHelpSayAgain');
    if (r) s.lineIds.push(r.id);
  }

  /** Every variant of a cue rendered with the run's values (for choosing a line that differs from the last). */
  private renderVariants(cue: CueRef, extra?: Record<string, number | string>): string[] {
    const resolved = this.resolveCue(cue);
    if (!resolved) return [];
    const { line, vars } = resolved;
    const texts = Array.isArray(line.text) ? line.text : [line.text];
    const lookup = (name: string): number | string | undefined => {
      if (extra && name in extra) return extra[name];
      if (name in vars) return resolveRef(vars[name], this.ctx);
      return this.lookupName(name);
    };
    return texts.filter((t) => t !== '').map((t) => render(t, { lookup }).caption);
  }

  /** The step is over: its brief and feedback lines still waiting in the queue are stale (a playing one ends). */
  private dropStepLines(s: StepRun): void {
    for (const id of s.lineIds) this.host.speech.cancel({ id, queuedOnly: true });
    s.lineIds = [];
  }

  // ---- lesson limits (TaskLimit) ----------------------------------------------------------------------------

  /** Returns true when a limit intervention began this frame. */
  private checkLimits(s: StepRun): boolean {
    const ctx = this.ctx;
    for (const l of s.limits) {
      const x = num(ctx.frame[l.def.sig]);
      const min = l.def.min !== undefined ? resolveRef(l.def.min, ctx) : NaN;
      const max = l.def.max !== undefined ? resolveRef(l.def.max, ctx) : NaN;
      const out = Number.isFinite(x) && ((Number.isFinite(min) && x < min) || (Number.isFinite(max) && x > max));
      l.outS = out ? l.outS + ctx.dt : 0;
      if (l.outS < (l.def.forS ?? LIMIT_FOR_S)) continue;
      l.outS = 0;
      if (!this.savesOn()) {
        // No takeover without instructor saves: the excursion is a fault, and in a dual lesson she says so.
        this.recordFault(`limit.${l.def.id}`, 'minor');
        if (this.lesson.kind === 'dual') this.speak(l.def.cue);
        continue;
      }
      this.startLimitIntervention(s, l.def);
      return true;
    }
    return false;
  }

  /**
   * The instructor takes control at once ("I have control", Safety priority; everything queued below it is
   * dropped, coaching included), says the limit's line, and restores straight and level at the task's
   * reference. The open attempt is discarded (the task restarts) unless this was the last allowed, which
   * closes it as a fail. Not a safety intervention: recorded on the exercise (no grade 4) and in the debrief.
   */
  private startLimitIntervention(s: StepRun, limit: TaskLimit): void {
    const def = s.def as TaskStep;
    const count = (this.limitCounts.get(def.id) ?? 0) + 1;
    this.limitCounts.set(def.id, count);
    const fail = count >= (def.attempts ?? LIMIT_ATTEMPTS);
    // A limit line that already says "I have control" is spoken as the take itself.
    const own = this.resolveCue(limit.cue);
    const ownText = own ? (Array.isArray(own.line.text) ? own.line.text[0] : own.line.text) : '';
    const selfTaking = /^\s*i have control/i.test(ownText);
    if (!selfTaking) this.speak('runner.limit.iHaveControl');
    this.host.speech.cancel({ priorityAtLeast: Priority.Instruction });
    this.speak(limit.cue, undefined, selfTaking ? { priority: Priority.Safety, interrupt: true } : undefined);
    this.fsm.take('intervention', true);
    this.handleAuthority();
    this.limitInterventions++;
    this.deps.bus.emit('intervention', { rule: `limit.${limit.id}`, kind: 'limit', limitId: limit.id }, this.simT);
    this.trace.event({ t: this.simT, type: 'intervention', label: `limit: ${limit.id}` });
    if (s.taskOpen) {
      if (fail) this.closeTask(s, 'fail');
      else this.closeTask(s, null);
    }
    this._grader.recordLimitIntervention(def.exercise, limit.id, !fail);
    s.status = 'busy';
    const vs = this.deps.aircraft.vspeeds;
    const ref = s.ref ?? { altFt: num(this.ctx.frame.altFt), hdgDeg: null, kias: num(this.ctx.frame.kias) };
    const kias = Number.isFinite(ref.kias) ? ref.kias : vs.Vcruise;
    // As InstructorPilot.restoreLevel clamps it: never restore to a speed near the stall or above Vno.
    const refKias = Math.min(Math.max(kias, vs.Vs1 + 17), vs.Vno - 10);
    this.host.copilot.restoreLevel({ altFt: ref.altFt, hdgDeg: ref.hdgDeg, kias: refKias });
    this.limitRec = { step: s, limit, phase: 'restoring', t: 0, stableS: 0, explainT: 0, refKias, fail, safetySave: false, talk: new Set() };
  }

  /** Restore -> stable -> teaching line -> offer control back -> restart the task (or fail it). */
  private updateLimitRecovery(dt: number): void {
    const r = this.limitRec as LimitRecovery;
    const f = this.ctx.frame;
    r.t += dt;
    if (r.phase === 'restoring') {
      const ok = Math.abs(num(f.bankDeg)) <= LIMIT_STABLE.bankDeg && Math.abs(num(f.vsFpm)) <= LIMIT_STABLE.vsFpm
        && Math.abs(num(f.kias) - r.refKias) <= LIMIT_STABLE.kiasTol && f.onGround !== true;
      r.stableS = ok ? r.stableS + dt : 0;
      if (r.stableS < LIMIT_STABLE.forS && r.t < LIMIT_RESTORE_CAP_S) {
        this.limitTalkThrough(r);
        return;
      }
      this.safetyMon.reset();
      this.speak(this.limitTeachLine(r.limit));
      // The last allowed intervention: say so, rather than move on in silence.
      this.speak(r.fail ? 'runner.limit.moveOn' : 'runner.limit.again');
      r.phase = 'explaining';
      return;
    }
    if (r.phase === 'explaining') {
      r.explainT += dt;
      if (!(this.ctx.speechIdle && r.explainT > 0.5) && r.explainT < EXPLAIN_CAP_S) return;
      r.phase = 'offering';
      this.fsm.offer();
      this.handleAuthority();
      return;
    }
    // Offering: the three-way handover (section 1.5); the task goes on once the student has control.
    if (this.fsm.who !== 'student') return;
    this.limitRec = null;
    const s = r.step;
    if (this.step !== s) return;
    if (r.fail) {
      this.exitStep({ result: 'fail' });
      return;
    }
    // A new attempt of the same step: criteria, feedback and limit timers start again.
    this.step = null;
    this.enterStep();
  }

  /**
   * She talks while she flies the recovery (an ab-initio FI narrates it: it is a demonstration too): wings
   * level, then the attitude, then the height. Each once, only when she is otherwise quiet.
   */
  private limitTalkThrough(r: LimitRecovery): void {
    if (r.t < 3 || !this.host.speech.idle()) return;
    const f = this.ctx.frame;
    const bank = Math.abs(num(f.bankDeg));
    const ref = r.step.ref;
    const say = (k: string): void => {
      r.talk.add(k);
      this.speak(`runner.limit.talk.${k}`);
    };
    if (!r.talk.has('wings')) {
      // Wings first only after a bank excursion; otherwise straight to the attitude.
      if (!/bank|roll/i.test(r.limit.sig)) {
        r.talk.add('wings');
      } else {
        if (bank <= 8) say('wings');
        return;
      }
    }
    if (!r.talk.has('attitude')) {
      if (bank <= LIMIT_STABLE.bankDeg + 2 && Math.abs(num(f.vsFpm)) <= 600) say('attitude');
      return;
    }
    if (!r.talk.has('height') && ref && Number.isFinite(ref.altFt) && Math.abs(num(f.altFt) - ref.altFt) > 80) say('height');
  }

  /** While the instructor restores: the envelope still rules (a breach switches to the matching recovery). */
  private checkLimitSafety(): void {
    const r = this.limitRec as LimitRecovery;
    const b = this.safetyMon.update(this.ctx);
    if (!b || r.safetySave || r.phase !== 'restoring') return;
    r.safetySave = true;
    this.host.copilot.recover(b.recovery);
    this.trace.event({ t: this.simT, type: 'intervention', label: b.rule });
  }

  /** The teaching point after a limit intervention: content `limit.teach.<limitId>`, else by the signal. */
  private limitTeachLine(limit: TaskLimit): CueRef {
    const own = `limit.teach.${limit.id}`;
    if (this.deps.lines[own]) return own;
    const sig = limit.sig;
    const group = /bank|aileron|roll/i.test(sig) ? 'bank'
      : /pitch|elevator/i.test(sig) ? 'pitch'
        : /kias|asi|tas/i.test(sig) ? 'speed'
          : /alt|agl|haf|vs/i.test(sig) ? 'height'
            : /ball|rudder|yaw|beta/i.test(sig) ? 'yaw' : null;
    return group ? `runner.limit.teach.${group}` : 'runner.limit.teach';
  }

  /** Task exit: close the attempt (null: discard it), the coach, the task's holds, its UI and trace bands. */
  private closeTask(s: StepRun, result: 'success' | 'fail' | 'timeout' | 'crash' | null): void {
    const def = s.def as TaskStep;
    s.taskOpen = false;
    if (result === null) this._grader.abortTask();
    else this._grader.endTask(result, this.ctx);
    this._coach.endTask();
    if (s.taskHolds) this.setHolds(null);
    this.host.ui.setHighlight([]);
    if (result === null) return;
    for (const c of def.criteria) {
      if (c.kind !== 'hold' || c.chart === false || !c.sig || c.target === undefined || c.tol === undefined) continue;
      const target = resolveRef(c.target, this.ctx);
      const tol = resolveTol(c.tol, this.ctx);
      if (!Number.isFinite(target) || !Number.isFinite(tol.minus) || !Number.isFinite(tol.plus)) continue;
      this.trace.band({ sig: c.sig, fromS: s.startedSimT, toS: this.simT, target, minus: tol.minus, plus: tol.plus, taskId: def.id });
    }
  }

  /** Anti-frustration rule 4: after two failures of a task, offer a demonstration ("[" accepts). */
  private noteTaskFailure(def: TaskStep, offer = true): void {
    const n = (this.taskFailures.get(def.id) ?? 0) + 1;
    this.taskFailures.set(def.id, n);
    if (offer && n >= FAILURES_BEFORE_DEMO_OFFER && this.lesson.kind === 'dual' && !this.demoOffer) {
      const script = this.demoFor(def);
      if (script) {
        this.demoOffer = script;
        this.speak('runner.offerDemo');
      }
    }
  }

  private speakRemark(r: CoachRemark, s: StepRun): void {
    if (r.point && !r.praise) this.pointAt(r.point, 'coach');
    const priority = r.priority === 0 ? Priority.Safety : r.praise ? Priority.Praise : Priority.Coach;
    const spoken = this.speak(r.cue, r.vars, { priority, key: `coach.${r.topic}` });
    if (!r.praise) this.deps.bus.emit('hint', { topic: r.topic, rung: r.rung }, this.simT);
    if (spoken) this.trace.event({ t: this.simT, type: r.praise ? 'praise' : 'coach', label: spoken.caption });
    if (this.assessedNow(s) && !r.praise) this.assessedRemarks++;
    if (r.offerDemo) {
      const script = this.demoFor(s.def);
      if (script) {
        this.demoOffer = script;
        this.speak('runner.offerDemo');
      }
    } else if (r.final && r.priority > 0 && !s.ladder.helpOffered && this.lesson.kind === 'dual') {
      // Decision 4: after the rule's reminders, help is offered (once per step) when there is a demo to show.
      const script = this.demoFor(s.def);
      if (script) {
        s.ladder.offerHelp();
        this.demoOffer = script;
        this.speak('runner.taskHelp');
      }
    }
  }

  /**
   * Global fault rules (content/globalRules.ts), every frame the student has control (never during a
   * demonstration, a recovery or her own flying): a fault once the condition has held for the rule's time,
   * once per episode, with the worst value of the episode kept up to date on the record while it lasts.
   */
  private tickGlobalFaults(): void {
    const ctx = this.ctx;
    const studentFlying = this.fsm.who === 'student' && !this.recovery && !this.limitRec && this.step?.demo !== true;
    for (const g of this.globalFaults) {
      const raw = g.raw.eval(ctx);
      const on = studentFlying && g.pred.eval(ctx);
      if (!studentFlying) g.pred.reset();
      const v = num(ctx.frame[g.rule.peak.sig]);
      if (on && !g.rec) {
        const sev = g.rule.severity[this.lesson.kind];
        g.rec = this.recordFault(g.rule.id, sev === 'failItem' ? 'minor' : sev, this.lastExercise, sev === 'failItem');
        if (Number.isFinite(v)) g.rec.value = v;
        g.rec.detail = this.globalFaultDetail(g.rule, v);
      } else if (g.rec && raw && Number.isFinite(v) && v > (g.rec.value ?? -Infinity)) {
        g.rec.value = v;
        g.rec.detail = this.globalFaultDetail(g.rule, v);
      } else if (g.rec && !raw) {
        g.rec = null;   // the episode is over: the next one is a new fault
      }
    }
  }

  private globalFaultDetail(rule: GlobalFaultRule, value: number): string {
    const limit = resolveRef(rule.peak.limit, this.ctx);
    return rule.detail.replace('{value}', String(Math.round(value))).replace('{limit}', String(Math.round(limit)));
  }

  private recordFault(id: string, severity: FaultRecord['severity'], fallbackExercise: string | null = null, failsItem = false): FaultRecord {
    const f: FaultRecord = { id, severity, atS: this.simT };
    if (failsItem) f.failsItem = true;
    this.faults.push(f);
    const s = this.step;
    const open = s?.taskOpen && s.def.kind === 'task' ? s.def.exercise : null;
    if (open || !fallbackExercise) this._grader.recordFault(f, open);
    // Between tasks: the exercise last flown in this phase (its latest attempt, re-graded).
    else this._grader.recordFaultOnLatest(f, fallbackExercise);
    this.deps.bus.emit('fault', { id, severity }, this.simT);
    this.trace.event({ t: this.simT, type: 'fault', label: id });
    return f;
  }

  // ---- demos ------------------------------------------------------------------------------------------------

  private startDemo(s: StepRun, def: DemoStep): void {
    const script = typeof def.script === 'string' ? this.deps.demos[def.script] : def.script;
    if (!script) {
      console.warn(`[training] ${this.lesson.id}: demo script '${String(def.script)}' not found; step skipped`);
      s.done = { result: 'skipped' };
      return;
    }
    this.fsm.take('plan', true);   // the intro (or the lesson's own line) says "I have control"
    if (def.intro) this.speak(def.intro);
    s.demo = true;
    s.demoFromS = this.simT;
    s.followMe = def.followMeThrough !== false;
    this.host.ui.setHighlight(def.highlight ?? []);
    this.host.ui.setFollowMeThrough(s.followMe);
    this.host.copilot.run(script, () => this.ctx);
  }

  private tickDemo(s: StepRun): StepExit | null {
    const res = this.host.copilot.demoResult;
    if (res === null) return null;
    this.deps.bus.emit('demo.done', { result: res }, this.simT);
    this.endDemoVisuals(s);
    if (res === 'aborted') {
      // abortWhen fired: the copilot is already flying its recovery; the step fails once it is stable.
      s.done = { result: 'fail' };
      this.recovery = { intervention: false, breach: null, t: 0, explained: false, explainT: 0 };
      return null;
    }
    this.host.copilot.holdHere();
    return { result: 'success' };
  }

  private endDemoVisuals(s: StepRun): void {
    if (!s.demo) return;
    s.demo = false;
    this.trace.demoSpan(s.demoFromS, this.simT);
    this.host.ui.setFollowMeThrough(false);
    this.host.ui.setHighlight([]);
  }

  /** The demonstration for "Show me" at a step: its retry demo, else the latest demo flown before it. */
  private demoFor(def: StepDef): string | DemoScript | null {
    if (def.kind === 'task') {
      for (const o of [def.onTimeout, def.onFail?.next]) if (o && typeof o === 'object' && 'demo' in o) return o.demo;
    }
    for (let p = this.phaseIdx; p >= 0; p--) {
      const steps = this.lesson.flow[p].steps;
      const from = p === this.phaseIdx ? this.stepIdx : steps.length - 1;
      for (let i = from; i >= 0; i--) {
        const st = steps[i];
        if (st.kind === 'demo') return st.script;
      }
    }
    return null;
  }

  private showMe(): void {
    const s = this.step;
    if (!s || this.recovery || this.limitRec || s.demo || this.interlude) return;
    // A guided checklist item: she shows where it is and sets it ("Here: ...").
    const cl = s.checklist;
    if (cl?.isGuided && cl.showMe()) {
      for (const cue of cl.update(this.ctx)) this.speak(cue);
      for (const c of cl.drainControls()) this.host.setControls?.(c);
      this.pointSeq++;
      return;
    }
    const script = this.demoOffer ?? this.demoFor(s.def);
    this.demoOffer = null;
    if (!script || this.lesson.kind !== 'dual') {
      this.speak('runner.noDemo');
      return;
    }
    const def = s.def;
    this.dropOpenStep();
    this.demoThenRetry(script, def);
  }

  // ---- checklists -------------------------------------------------------------------------------------------

  private startChecklist(s: StepRun, def: ChecklistStep): void {
    const list = this.deps.aircraft.checklists[def.checklist];
    if (!list) {
      console.warn(`[training] ${this.lesson.id}: checklist '${def.checklist}' not found; step skipped`);
      s.done = { result: 'skipped' };
      return;
    }
    // Guided (owner playtest): in a dual lesson the instructor talks the student through a challenge/response
    // list, pointing at each control with its state, key and reason.
    const guided = def.mode === 'challengeResponse' && this.lesson.kind === 'dual' && this._coach.currentLevel !== 'silent';
    s.checklist = new ChecklistRunner(list, def.mode, this.deps.bus, guided ? this.guidedOptions() : null);
  }

  private guidedOptions(): GuidedOptions {
    return {
      explained: this.explained,
      why: (item: ChecklistItem, list: ChecklistDef): CueRef | null => {
        if (item.why) return item.why;
        for (const id of [`why.${list.id}.${item.id}`, `why.${item.id}`]) if (this.deps.lines[id] ?? RUNNER_LINES[id]) return id;
        return null;
      },
    };
  }

  private tickChecklist(s: StepRun): StepExit | null {
    const cl = s.checklist;
    if (!cl) return { result: 'skipped' };
    // Guided: the reading, where and why are heard in order, never dropped as stale (playtest 3).
    for (const cue of cl.update(this.ctx)) this.speak(cue, undefined, cl.isGuided ? { ttlS: GUIDED_TTL_S } : undefined);
    for (const c of cl.drainControls()) this.host.setControls?.(c);
    return cl.done ? { result: 'success' } : null;
  }

  private closeChecklist(s: StepRun, def: ChecklistStep): void {
    const cl = s.checklist;
    if (!cl) return;
    cl.finish();
    for (const cue of cl.update(this.ctx)) this.speak(cue);   // the "..., please" calls for items missed at exit
    if (def.mode === 'silent' && cl.missed.length > 0) {
      // Section 3.5: a checklist not done when it was due is a fault; missing a critical item is major.
      this.recordFault(`checklist.${def.checklist}`, cl.criticalMissed ? 'major' : 'minor');
    }
    if (def.exercise) this.recordChecklistGrade(def, cl);
    s.checklist = null;
  }

  /**
   * A checklist that scores an exercise adds to its attempt directly (Grader.addResult): a single
   * pass/fail row whose grade is the checklist grade (4 none missed, 3 one slip, 2 several, 1 a critical item).
   */
  private recordChecklistGrade(def: ChecklistStep, cl: ChecklistRunner): void {
    const grade = cl.grade();
    const missed = cl.missed;
    const row: CriterionResult = {
      id: `checklist.${def.checklist}`, label: `${cl.title} checklist`, kind: 'check', required: true, safety: false,
      grade, testGrade: grade, within: grade >= 3 ? 1 : 0, maxN: 0, excursions: 0, longestOutS: 0, pattern: 'ok',
      detail: missed.length ? `Missed: ${missed.join(', ')}` : 'Every item done',
    };
    const standard = this.lesson.exercises.find((e) => e.id === def.exercise)?.standard ?? this.lessonStandard();
    this._grader.addResult(def.exercise as string, [row], standard, def.id);
  }

  // ---- setup ------------------------------------------------------------------------------------------------

  private runSetup(s: StepRun, def: Extract<StepDef, { kind: 'setup' }>): void {
    if (def.weather) this.host.applyWeather(def.weather, this.seed);
    if (def.holds !== undefined) this.setHolds(def.holds);
    if (def.hood !== undefined) {
      this.hoodOn = def.hood;
      this.host.setHood(def.hood);
    }
    if (def.timeScaleMax !== undefined) {
      this.timeCap = def.timeScaleMax;
      this.host.setTimeScaleCap(def.timeScaleMax);
    }
    if (def.cue) this.speak(def.cue);
    if (!def.reposition) {
      if (def.controls) this.host.setControls?.(def.controls);
      const trim = num(this.ctx.frame.trim);
      if (def.trimDelta !== undefined && Number.isFinite(trim)) {
        this.host.setControls?.({ elevatorTrim: Math.min(1, Math.max(-1, trim + def.trimDelta)) });
      }
      s.done = { result: 'success' };
      return;
    }
    s.status = 'busy';
    this.busy = true;
    this.host.speech.flush();
    const opts: StartOptions = { ...this.lesson.startOptions, ...(def.controls ? { controls: def.controls } : {}) };
    const done = (): void => {
      this.busy = false;
      this.detector.reset();
      this.landing.reset();
      this.safetyMon.reset();
      if (this.fsm.who === 'instructor') this.host.copilot.holdHere();
      s.status = 'active';
      s.done = { result: 'success' };
    };
    this.host.reposition(def.reposition, opts).then(done, (e: unknown) => {
      console.warn('[training] setup reposition failed', e);
      done();
    });
  }

  /** Instructor holds (section 1.5): written by the copilot every physics step until released. */
  private setHolds(h: Holds | null): void {
    this.holds = h;
    this.holdsRelease = h?.release ? compile(h.release) : null;
    this.host.copilot.setHolds(h);
    if (h?.cue) this.speak(h.cue);
  }

  private checkHoldsRelease(): void {
    const h = this.holds;
    if (!h || !this.holdsRelease?.eval(this.ctx)) return;
    const levers = (Object.keys(HOLD_NAMES) as (keyof typeof HOLD_NAMES)[]).filter((k) => h[k] !== undefined).map((k) => HOLD_NAMES[k][1]);
    this.setHolds(null);
    if (this.step?.taskHolds) this.step.taskHolds = false;
    if (levers.length) this.speak('runner.holdReleased', { lever: levers.join(' and ') });
  }

  // ---- authority ----------------------------------------------------------------------------------------------

  private takeControl(reason: 'plan' | 'intervention', silent = false): void {
    this.fsm.take(reason, silent);
    this.host.copilot.holdHere();
    this.handleAuthority();
  }

  /** Turn the FSM's outputs into speech, copilot commands and fault records. */
  private handleAuthority(): void {
    for (const o of this.fsm.drain()) {
      switch (o.kind) {
        case 'say':
          this.speak(AUTHORITY_LINE[o.line]);
          break;
        case 'student':
          this.speak({ text: o.text, actor: 'student' });
          break;
        case 'fault':
          this.recordFault(o.id, o.severity);
          break;
        case 'changed':
          this.trace.event({ t: this.simT, type: 'authority', label: o.to === 'student' ? 'Student has control' : 'Instructor has control' });
          if (o.to === 'student') {
            this.handedBack = false;
            this.host.copilot.stop();
          } else if (o.reason === 'handback') {
            this.handbacks++;
            this.handedBack = true;
            this.handedBackS = 0;
            this.host.copilot.holdHere();
          } else {
            this.handedBack = false;
          }
          break;
      }
    }
    this.sayDeferredStart();
  }

  /** The step is a task the student flies, and they have handed it back: its clock stands still. */
  private taskPausedByHandback(): boolean {
    const s = this.step;
    return this.handedBack && this.fsm.who === 'instructor' && !this.limitRec && !this.recovery
      && s !== null && s.def.kind === 'task' && s.status === 'active' && s.def.pf !== 'instructor';
  }

  /** "Go ahead: ..." only to a student who has control (held while she has it, e.g. after a handback). */
  private sayDeferredStart(): void {
    const s = this.step;
    if (!s?.startCue || s.status !== 'active' || this.fsm.who !== 'student' || this.fsm.handover !== 'none') return;
    // A taxi with guidance: the route's opening call ("Straight ahead out of the stand...") comes before "Go
    // ahead" (round 7, item 8: queued after it, it was dropped before it was heard, the student long gone).
    if (s.taxi && !s.taxi.guide) return;
    const cue = s.startCue;
    s.startCue = null;
    const r = this.speak(cue);
    if (r) s.lineIds.push(r.id);
  }

  // ---- safety and recovery ----------------------------------------------------------------------------------

  private savesOn(): boolean {
    const k = this.lesson.kind;
    return this.lesson.rules.instructorSaves && this.deps.settings.instructorSaves && (k === 'dual' || k === 'check');
  }

  /** Step 7. Returns true when a breach preempted the frame's step exit. */
  private checkSafety(): boolean {
    if (this.recovery) return true;   // a demo abort began a recovery this frame
    const b = this.safetyMon.update(this.ctx);
    if (!b) return false;
    if (this.fsm.who === 'instructor') {
      // The instructor is flying (a demo or a hold) and it got away: recover; nothing is held against the student.
      const s = this.step;
      if (s?.demo) {
        this.deps.bus.emit('demo.done', { result: 'aborted' }, this.simT);
        this.endDemoVisuals(s);
        s.done = { result: 'fail' };
      }
      this.host.copilot.recover(b.recovery);
      this.recovery = { intervention: false, breach: b, t: 0, explained: false, explainT: 0 };
      return true;
    }
    if (this.lesson.kind === 'test') {
      if (!b.imminent) {
        this.recordFault(`safety.${b.rule}`, 'major');
        return false;
      }
      this.recordFault(`safety.${b.rule}`, 'critical');
      this.speak('runner.examinerStop');
      this.fsm.take('intervention', true);
      this.host.copilot.recover(b.recovery);
      this.deps.bus.emit('intervention', { rule: b.rule }, this.simT);
      this.finish('completed');
      return true;
    }
    if (!this.savesOn()) {
      this.recordFault(`safety.${b.rule}`, 'major');
      // Saves off removes the takeover, not the instructor: in a dual lesson she still calls the danger.
      if (this.lesson.kind === 'dual') {
        this.host.speech.cancel({ priorityAtLeast: Priority.Coach });
        this.speak(safety(SAFETY_CALLS[b.rule as SafetyRuleId] ?? b.reason));
      }
      return false;
    }
    this.intervene(b);
    return true;
  }

  private intervene(b: SafetyBreach): void {
    this.speak('runner.iHaveControlSafety');
    // Everything queued below Safety goes, task instructions included: nothing about the exercise may be
    // said in the middle of a rescue (wave-3 playtest: "A level 360 to the left" 1.8 s after "I have control!").
    this.host.speech.cancel({ priorityAtLeast: Priority.Instruction });
    this.fsm.take('intervention', true);
    this.handleAuthority();
    this.host.copilot.recover(b.recovery);
    this.interventions++;
    this.deps.bus.emit('intervention', { rule: b.rule }, this.simT);
    this.trace.event({ t: this.simT, type: 'intervention', label: b.rule });
    const s = this.step;
    if (s?.taskOpen && s.def.kind === 'task') {
      this._grader.recordIntervention();
      if (s.exercise?.mode === 'assessed') this.assessedInterventions++;
      this.closeTask(s, 'fail');
      this.noteTaskFailure(s.def, false);
    }
    this.dropOpenStep();
    this.recovery = { intervention: true, breach: b, t: 0, explained: false, explainT: 0 };
  }

  /**
   * While the copilot recovers (section 3.8 step 3): wait for stable (or the cap); then, after an
   * intervention, say why, let it be heard, and either end the lesson (second intervention) or try again.
   */
  private updateRecovery(dt: number): void {
    const r = this.recovery as Recovery;
    if (!r.explained) {
      r.t += dt;
      if (!this.host.copilot.stable && r.t < RECOVERY_CAP_S) return;
      this.safetyMon.reset();
      this.host.copilot.holdHere();
      if (!r.intervention) {
        this.recovery = null;
        return;   // a failed demo step exits on the next frame through its `done`
      }
      this.speak('runner.gettingAway');
      if (r.breach) this.speak({ text: r.breach.reason });
      this.speak(this.interventions >= MAX_INTERVENTIONS ? 'runner.enoughForToday' : 'runner.tryAgain');
      r.explained = true;
      return;
    }
    r.explainT += dt;
    if (!(this.ctx.speechIdle && r.explainT > 0.5) && r.explainT < EXPLAIN_CAP_S) return;
    this.recovery = null;
    if (this.interventions >= MAX_INTERVENTIONS) {
      this.finish('completed');
    } else if (this.latestCheckpoint()) {
      void this.retryPhase(undefined, false);
    } else {
      this.enterPhase(this.phaseIdx, this.phaseRepeat, 0, false);
    }
  }

  // ---- guidance: callouts, taxi guidance, ground coaching ---------------------------------------------------

  /** Per frame after the step: the step's point, the taxi route and its calls, and the ground coach. */
  private tickGuidance(dt: number): void {
    const s = this.step;
    const f = this.ctx.frame;
    if (s?.point && !s.point.done && s.status === 'active' && s.point.until?.eval(this.ctx)) s.point.done = true;
    const student = this.fsm.who === 'student' && this.fsm.handover === 'none';
    const tx = s?.status === 'active' ? s.taxi : null;
    if (s && tx) {
      if (!tx.guide) {
        if (this.lastPos && f.onGround === true) {
          const r = buildTaxiRoute(this.lastPos.north, this.lastPos.east, tx.to, `taxi-${++this.taxiSeq}`);
          if (r) {
            this.taxiRoute = r;
            tx.guide = new TaxiGuide(r, tx.calls, tx.brief);
            this.ground.resetTaxi();
          } else {
            s.taxi = null;
          }
          // The route's opening call (when it has one now) goes before the deferred "Go ahead".
          const first = s.taxi?.guide && student ? s.taxi.guide.opening() : null;
          if (first) {
            const said = this.speak(first.cue);
            if (said) this.trace.event({ t: this.simT, type: 'coach', label: said.caption });
          }
          this.sayDeferredStart();
        }
      } else if (student) {
        const call = tx.guide.update(f, dt, this.host.speech.idle());
        if (call) {
          const r = this.speak(call.cue);
          if (r) this.trace.event({ t: this.simT, type: 'coach', label: r.caption });
        }
        if (tx.guide.needsReroute && num(f.gsKt) < 1 && this.lastPos) {
          const r = buildTaxiRoute(this.lastPos.north, this.lastPos.east, tx.to, `taxi-${++this.taxiSeq}`);
          if (r) {
            this.taxiRoute = r;
            tx.guide.reroute(r);
          }
        }
      }
    }
    const active = this.lesson.kind === 'dual' && student && this._coach.currentLevel !== 'silent' && !this.recovery && !this.limitRec
      && this.holds?.throttle === undefined && !(s?.demo ?? false);
    const rem = this.ground.update(f, dt, {
      active, highRpmWanted: this.highRpmWanted(), taxiing: !!(tx?.guide && tx.coach) && f['taxi.active'] === true, speechIdle: this.host.speech.idle(),
    });
    if (rem) {
      if (rem.point) this.pointAt(rem.point, 'coach', rem.key ? keyFor(rem.key) : undefined);
      if (rem.set) this.host.setControls?.(rem.set);
      const r = this.speak(rem.cue);
      this.deps.bus.emit('hint', { topic: `ground.${rem.topic}`, rung: rem.help ? 3 : 1 }, this.simT);
      if (r) this.trace.event({ t: this.simT, type: 'coach', label: r.caption });
    }
  }

  /**
   * The ground rpm rule stands down: the step asks for more than ground idle power (a run-up), its own coach
   * rules already watch the rpm, or a checklist item is about the throttle right now.
   */
  private highRpmWanted(): boolean {
    const s = this.step;
    if (!s) return false;
    if (s.def.kind === 'task') {
      if (s.def.holds?.throttle !== undefined) return true;
      if ((s.def.coach ?? []).some((r) => typeof r !== 'string' && predSignals(r.when).includes('rpm'))) return true;
      return s.def.card.targets.some((t) => t.sig === 'rpm' && resolveRef(t.value, this.ctx) > GROUND_RPM_MAX);
    }
    const cl = s.checklist;
    if (cl) {
      if (cl.pointer()?.target === 'throttle') return true;
      const list = this.deps.aircraft.checklists[(s.def as ChecklistStep).checklist];
      // A list that checks an rpm above ground idle (the run-up) wants the power up while it runs.
      const above = (p: Pred | undefined): boolean => {
        if (!p) return false;
        if ('sig' in p && p.sig === 'rpm' && 'op' in p && (p.op === '>' || p.op === '>=')) return typeof p.v === 'number' && p.v > GROUND_RPM_MAX;
        if ('all' in p) return p.all.some(above);
        if ('any' in p) return p.any.some(above);
        return false;
      };
      return (list?.items ?? []).some((it) => above(it.state ?? it.check));
    }
    return false;
  }

  /** Point at a control for a few seconds (a coach remark, a reminder, "show me"). */
  private pointAt(target: PointTarget, source: CalloutModel['source'], key?: KeyInfo | null): void {
    this.remarkPoint = { target, until: this.simT + POINT_REMARK_S, source, seq: ++this.pointSeq, ...(key !== undefined ? { key } : {}) };
  }

  /**
   * TaskStep.taxi: the route, the HUD, and in a dual lesson the instructor's calls and the taxi coach rules.
   * A task without it whose card names a holding point ("Taxi to holding point A1") gets the route and the
   * HUD only: its own milestones and coach rules do the talking, and two voices calling turns would be noise.
   */
  private beginTaxi(s: StepRun, def: TaskStep): void {
    const dual = this.lesson.kind === 'dual';
    if (def.taxi) {
      s.taxi = { to: def.taxi.to, calls: def.taxi.calls ?? dual, coach: def.taxi.coach ?? dual, brief: def.taxi.brief ?? true, guide: null };
      return;
    }
    const m = /holding point (A[1-4])\b/i.exec(def.card.title);
    if (m) s.taxi = { to: m[1].toUpperCase() as TaxiDestination, calls: false, coach: false, brief: false, guide: null };
  }

  private endTaxi(s: StepRun): void {
    if (!s.taxi) return;
    s.taxi = null;
    this.taxiRoute = null;
    this.lastTaxiKey = '';
    this.host.ui.setTaxiGuide?.(null);
  }

  /** The callout now: the guided checklist's item, else a remark's control, else the step's `point`. */
  private calloutModel(): CalloutModel | null {
    const s = this.step;
    if (!s || this.lesson.kind !== 'dual' || this.recovery || this.limitRec) return null;
    const glance = this.deps.settings.glance !== false;
    const cl = s.checklist;
    const p: (ChecklistPointer & { queued: number }) | null = cl && (cl.isGuided || s.def.kind === 'checklist') ? cl.pointer() : null;
    if (cl && p && (cl.isGuided || (s.def as ChecklistStep).mode === 'flow')) {
      return this.callout(`${s.def.id}@${s.startedSimT.toFixed(2)}:${p.itemId}:${this.pointSeq}`, p.target, p.state, p.key, p.why, p.done, glance, 'checklist', p.queued);
    }
    const r = this.remarkPoint;
    if (r && this.simT < r.until) return this.callout(`r${r.seq}`, r.target, null, r.key !== undefined ? r.key : targetKey(r.target), null, false, glance, r.source, 0);
    const sp = s.point;
    if (sp && !sp.done && s.status === 'active') {
      return this.callout(`${s.def.id}@${s.startedSimT.toFixed(2)}:${this.pointSeq}`, sp.target, sp.state, stateKey(sp.target, sp.state), null, false, glance, 'step', 0);
    }
    return null;
  }

  private callout(id: string, target: PointTarget, state: string | null, key: KeyInfo | null, why: CueRef | null, done: boolean, glance: boolean,
    source: CalloutModel['source'], queued: number): CalloutModel {
    const whyText = why ? this.renderVariants(why)[0] ?? null : null;
    return { id, target, label: targetLabel(target), state, key: key?.label ?? null, keyCode: key?.code ?? null, why: whyText, done, glance, source, queued };
  }

  // ---- bus ----------------------------------------------------------------------------------------------------

  private processBus(): void {
    for (const r of this.deps.bus.since(this.processedSeq)) {
      this.processedSeq = r.seq + 1;
      const s = this.step;
      if (s?.taskOpen) this._grader.onEvent(r, this.ctx);
      this.onBusEvent(r, s);
    }
  }

  private onBusEvent(r: TrainingEventRecord, s: StepRun | null): void {
    const t = r.simT;
    switch (r.type) {
      case 'liftoff':
        this.timer.takeoff();
        this.trace.event({ t, type: 'liftoff', label: 'Lift-off' });
        break;
      case 'mainsTouchdown': {
        const d = r.data as TrainingEventRecord<'mainsTouchdown'>['data'];
        this.trace.event({ t, type: 'touchdown', label: `Touchdown ${Math.round(d.sinkFpm)} fpm` });
        break;
      }
      case 'landing': {
        const d = r.data as LandingData;
        const night = this.deps.telemetry.frame.night === true;
        this.timer.landing(night);
        this.lastLanding = { t, night };
        if (s?.exercise?.mode === 'assessed' && safeLanding(d)) this.safeLandings++;
        break;
      }
      case 'stallWarnOn':
        this.trace.event({ t, type: 'stallWarning', label: 'Stall warning' });
        break;
      default:
        break;
    }
  }

  // ---- speech -------------------------------------------------------------------------------------------------

  private installSpeechHook(): void {
    if (this.unhookSpeech) return;
    const sp = this.host.speech;
    const prev = sp.onEvent;
    const mine = (e: 'start' | 'end', r: SpeechRequest, res?: 'done' | 'interrupted' | 'dropped'): void => {
      prev?.(e, r, res);
      this.onSpeech(e, r, res);
    };
    sp.onEvent = mine;
    this.unhookSpeech = () => {
      if (sp.onEvent === mine) sp.onEvent = prev;
    };
  }

  private unhook(): void {
    this.unhookSpeech?.();
    this.unhookSpeech = null;
  }

  private onSpeech(e: 'start' | 'end', r: SpeechRequest, res?: 'done' | 'interrupted' | 'dropped'): void {
    if (e === 'end') {
      this.endedSpeech.add(r.id);
      if (this.endedSpeech.size > 256) this.endedSpeech.delete(this.endedSpeech.values().next().value as string);
    }
    if (this._phase !== 'running') return;
    if (e === 'start') this.deps.bus.emit('speech.start', { id: r.id, actor: r.actor }, this.simT);
    else this.deps.bus.emit('speech.end', { id: r.id, result: res ?? 'done' }, this.simT);
  }

  /** The line behind a cue reference: LINES first (content may override engine lines), then RUNNER_LINES. */
  private resolveCue(cue: CueRef): { line: InlineCue; key: string; vars: Record<string, Ref> } | null {
    if (typeof cue === 'string') {
      const line = this.deps.lines[cue] ?? RUNNER_LINES[cue];
      return line ? { line, key: cue, vars: {} } : null;
    }
    if ('id' in cue) {
      const line = this.deps.lines[cue.id] ?? RUNNER_LINES[cue.id];
      return line ? { line, key: cue.id, vars: cue.vars } : null;
    }
    return { line: cue, key: Array.isArray(cue.text) ? cue.text[0] : cue.text, vars: {} };
  }

  /** Render and enqueue a cue. Returns the request id and caption, or null for an unknown cue. */
  private speak(cue: CueRef, extra?: Record<string, number | string>, opts?: { priority?: Priority; key?: string; ttlS?: number; interrupt?: boolean }): { id: string; caption: string } | null {
    const resolved = this.resolveCue(cue);
    if (!resolved) {
      console.warn(`[training] ${this.lesson.id}: unknown cue ${JSON.stringify(cue)}`);
      return null;
    }
    const { line, key, vars } = resolved;
    const texts = Array.isArray(line.text) ? line.text : [line.text];
    if (texts.length === 0 || texts.every((t) => t === '')) return null;
    const i = this.pickVariant(key, texts.length);
    const speaks = line.speak === undefined ? undefined : Array.isArray(line.speak) ? line.speak : [line.speak];
    const lookup = (name: string): number | string | undefined => {
      if (extra && name in extra) return extra[name];
      if (name in vars) return resolveRef(vars[name], this.ctx);
      return this.lookupName(name);
    };
    const r = render(texts[i], { lookup }, speaks?.[i % speaks.length]);
    const actor = line.actor ?? (this.lesson.persona === 'examiner' ? 'examiner' : 'instructor');
    const priority = opts?.priority ?? line.priority ?? Priority.Instruction;
    const id = this.host.speech.enqueue({
      actor, channel: line.channel ?? (actor === 'tower' || actor === 'ground' || actor === 'atis' ? 'radio' : 'cabin'),
      caption: r.caption, speak: r.speak, priority, interrupt: opts?.interrupt ?? line.interrupt ?? priority === Priority.Safety,
      resumable: priority === Priority.Instruction, ttlMs: (opts?.ttlS ?? line.ttlS ?? TTL_S[priority]) * 1000,
      key: opts?.key ?? line.key, cooldownMs: line.cooldownS !== undefined ? line.cooldownS * 1000 : undefined,
    });
    return { id, caption: r.caption };
  }

  /** Variants rotate with the seeded RNG and never repeat the previous one. */
  private pickVariant(key: string, n: number): number {
    if (n <= 1) return 0;
    const prev = this.lastVariant.get(key);
    let i = Math.floor(this.deps.rng() * (prev === undefined ? n : n - 1));
    if (prev !== undefined && i >= prev) i++;
    i = Math.min(n - 1, Math.max(0, i));
    this.lastVariant.set(key, i);
    return i;
  }

  /** Template names: run vars, `vspeed.X`, `setting.X`, `tol.X` (the + side), then live signals. */
  private lookupName(name: string): number | string | undefined {
    if (name in this.ctx.vars) return this.ctx.vars[name];
    const dot = name.indexOf('.');
    if (dot > 0) {
      const head = name.slice(0, dot);
      const tail = name.slice(dot + 1);
      if (head === 'vspeed') return (this.deps.aircraft.vspeeds as Record<string, number>)[tail];
      if (head === 'setting') return (this.deps.aircraft.settings as Record<string, number>)[tail];
      if (head === 'tol') {
        const t = resolveTol(tail as Parameters<typeof resolveTol>[0], this.ctx);
        return Number.isFinite(t.plus) ? t.plus : undefined;
      }
    }
    const v = this.deps.telemetry.frame[name];
    return typeof v === 'number' || typeof v === 'string' ? v : undefined;
  }

  private sayAgain(): void {
    if (this.fsm.handover === 'offered') {
      this.speak('runner.youHaveControl');
      return;
    }
    const def = this.step?.def;
    if (!def) return;
    switch (def.kind) {
      case 'task':
        this.speak(def.prompt ?? def.brief);
        break;
      case 'wait': {
        const cue = def.prompt ?? def.cue;
        if (cue) this.speak(cue);
        break;
      }
      case 'say':
        this.speak(def.cue);
        break;
      case 'checklist': {
        const p = this.step?.checklist?.isGuided ? this.step.checklist.pointer() : null;
        if (p && !p.done) {
          this.speak({ text: `${targetLabel(p.target)}: ${p.state}.${p.key ? ` Key ${p.key.label}.` : ''}` });
          this.pointSeq++;
          break;
        }
        const cue = this.step?.checklist?.repeat();
        if (cue) this.speak(cue);
        break;
      }
      default:
        if (def.whenPrompt && this.step?.status === 'pending') this.speak(def.whenPrompt.cue);
        break;
    }
  }

  // ---- UI models ----------------------------------------------------------------------------------------------

  private publishUi(): void {
    if (this.uiClockS < UI_PERIOD_S) return;
    this.uiClockS = 0;
    const strip = this.stripModel();
    const sk = JSON.stringify(strip);
    if (sk !== this.lastStripKey) {
      this.lastStripKey = sk;
      this.host.ui.setStrip(strip);
    }
    const card = this.cardModel();
    const ck = JSON.stringify(card);
    if (ck !== this.lastCardKey) {
      this.lastCardKey = ck;
      this.host.ui.setCard(card);
    }
    if (this.host.ui.setCallout) {
      const c = this.calloutModel();
      const k = JSON.stringify(c);
      if (k !== this.lastCalloutKey) {
        this.lastCalloutKey = k;
        this.host.ui.setCallout(c);
      }
    }
    if (this.host.ui.setTaxiGuide) {
      const g = this.step?.taxi?.guide?.model(this.ctx.frame) ?? null;
      const k = g ? JSON.stringify({ ...g, distM: Math.round(g.distM), xtrackM: Math.round(g.xtrackM * 10), gsKt: Math.round(g.gsKt), routeDistM: Math.round(g.routeDistM), holdShortDistM: g.holdShortDistM === null ? null : Math.round(g.holdShortDistM) }) : '';
      if (k !== this.lastTaxiKey) {
        this.lastTaxiKey = k;
        this.host.ui.setTaxiGuide(g);
      }
    }
  }

  private liveFeedback(): boolean {
    const s = this.step;
    if (!this.deps.settings.liveBars || this.lesson.kind === 'test') return false;
    if (s && coached(s.def)) return true;
    return !(s?.exercise?.mode === 'assessed' || this._coach.currentLevel === 'silent');
  }

  /** An assessed exercise flown silently (a task she talks the student through is not an assessment). */
  private assessedNow(s: StepRun | null): boolean {
    return s?.exercise?.mode === 'assessed' && !coached(s.def);
  }

  private cardTargets(): (CardTargetModel & { sig: SignalId })[] {
    const s = this.step;
    if (!s || s.def.kind !== 'task' || s.status !== 'active') return [];
    const out: (CardTargetModel & { sig: SignalId })[] = [];
    for (const t of s.def.card.targets) {
      const target = resolveRef(t.value, this.ctx);
      const value = num(this.ctx.frame[t.sig]);
      const tol: Tol = t.tol !== undefined ? resolveTol(t.tol, this.ctx) : { minus: 0, plus: 0 };
      let e = value - target;
      if (this.ctx.signalDef(t.sig)?.kind === 'angle') e = wrap180(e);
      const n = t.tol !== undefined && Number.isFinite(e) && Number.isFinite(tol.plus) ? normalisedError(e, tol) : 0;
      out.push({ label: t.label, unit: t.unit, target, value, tol, n, sig: t.sig });
    }
    return out;
  }

  private stripModel(): LessonStripModel {
    const s = this.step;
    const fsm = this.fsm;
    let authority: LessonStripModel['authority'];
    if (this.lesson.kind === 'test') authority = 'skillTest';
    else if (this.lesson.kind === 'solo') authority = 'solo';
    else if (fsm.handover !== 'none') authority = 'offered';
    else if (fsm.who === 'instructor') authority = s?.demo && s.followMe ? 'followMe' : 'instructor';
    else authority = 'student';
    const holds = this.holds;
    const holdChips = holds ? (Object.keys(HOLD_NAMES) as (keyof typeof HOLD_NAMES)[]).filter((k) => holds[k] !== undefined).map((k) => HOLD_NAMES[k][0]) : [];
    let matchThrottle: number | null = null;
    if (fsm.handover === 'matchThrottle') {
      const hw = this.host.hardwareThrottle?.() ?? null;
      const diff = hw === null ? 0 : Math.abs(hw - num(this.ctx.frame.throttle));
      matchThrottle = Math.min(1, Math.max(0, 1 - (diff - 0.05) / 0.5));
    }
    const live = this.liveFeedback();
    const chips: ToleranceChip[] = live
      ? this.cardTargets().filter((t) => Number.isFinite(t.value) && Number.isFinite(t.target)).slice(0, 4).map((t) => chipFor(t, t.sig))
      : [];
    return {
      lessonId: this.lesson.id, lessonTitle: this.lesson.title, authority, holds: holdChips, matchThrottle,
      taskTitle: this.taskTitle(), chips, assessed: this.assessedNow(s),
    };
  }

  private taskTitle(): string {
    const s = this.step;
    const phase = this.lesson.flow[this.phaseIdx];
    if (this.recovery) return 'Instructor recovering';
    if (this.limitRec) return this.limitRec.phase === 'offering' ? 'Your turn again' : 'Restoring straight and level';
    if (!s) return phase?.title ?? '';
    if (s.def.kind === 'task') return s.def.card.title;
    if (s.demo) return 'Demonstration';
    if (s.checklist) return `${s.checklist.title} checklist`;
    return phase?.title ?? '';
  }

  private cardModel(): CardModel {
    const s = this.step;
    const phase = this.lesson.flow[this.phaseIdx];
    const cl = s?.checklist ?? null;
    return {
      lessonTitle: this.lesson.title, phaseTitle: phase?.title ?? '', taskTitle: this.taskTitle(),
      stepT: Math.round(this.ctx.stepT * 10) / 10, targets: this.cardTargets().map(({ sig: _sig, ...t }) => t), liveFeedback: this.liveFeedback(),
      captions: this.host.speech.transcript.slice(-5),
      checklist: cl ? { title: cl.title, items: cl.items.map((it) => ({ ...it })) } : null,
    };
  }

  private briefingModel(): BriefingModel {
    const ctx = this.ctx;
    const lessonStd = this.lessonStandard();
    const auth = this.deps.authority;
    return {
      lesson: this.lesson, aircraft: this.deps.aircraft, authority: auth,
      numbers: this.lesson.briefing.numbers.map((n) => ({ label: n.label, value: resolveRef(n.value, ctx), unit: n.unit })),
      tolerances: this.lesson.briefing.tolerances.map((key) => {
        const note = STANDARD_NOTES[key]?.[auth];
        const row = { key, lesson: this.deps.standards[auth][lessonStd][key], test: this.deps.standards[auth].test[key] };
        return note ? { ...row, note } : row;
      }),
      weatherLine: this.host.describeWeather?.() ?? '',
      practiceOnly: this.deps.practiceOnly === true,
    };
  }

  private debriefModel(result: LessonResult, trace: TraceData, extras: DebriefExtras): DebriefModel {
    const id = `log-${this.attemptId}`;
    const preview = extras.logbookPreview !== undefined
      ? extras.logbookPreview
      : logbookEntryFor(this.lesson, result, this.deps.aircraft, this.deps.authority, this.deps.instructorName ?? 'Kate Mercer', id);
    return {
      lesson: this.lesson, result, trace, bestTrace: extras.bestTrace ?? null, logbookPreview: preview,
      retryPhases: this.lesson.flow.filter((p) => this.checkpoints.has(p.id)).map((p) => ({ phaseId: p.id, title: p.title })),
      nextLessonId: extras.nextLessonId ?? null, milestone: extras.milestone ?? null,
    };
  }

  // ---- small helpers ----------------------------------------------------------------------------------------

  private initialAuthority(): 'student' | 'instructor' {
    return this.lesson.kind === 'dual' && AIRBORNE_STARTS.has(this.lesson.start.kind) ? 'instructor' : 'student';
  }

  private startsFlying(): boolean {
    const st = this.lesson.start;
    return AIRBORNE_STARTS.has(st.kind) || (st.kind === 'ground' && st.engine === 'running');
  }

  private envelope() {
    return { ...this.deps.aircraft.envelope, ...this.lesson.rules.envelope };
  }

  /** Check and test kinds are silent; otherwise the phase's level, else the lesson's. */
  private coachLevel(phase: PhaseDef) {
    if (this.lesson.kind === 'check' || this.lesson.kind === 'test') return 'silent' as const;
    return phase.coachLevel ?? this.lesson.rules.coachLevel;
  }

  /** The briefing's "lesson standard": training when any exercise is graded against it, else the first's. */
  private lessonStandard(): Standard {
    const ex = this.lesson.exercises;
    return ex.some((e) => e.standard === 'training') ? 'training' : ex[0]?.standard ?? 'test';
  }

  private captureValue(v: Ref | string | { var: string }): number {
    if (typeof v === 'string') {
      const x = this.ctx.frame[v];
      return typeof x === 'number' ? x : typeof x === 'boolean' ? Number(x) : NaN;
    }
    return resolveRef(v as Ref, this.ctx);
  }

  private evalOnce(p: Pred): boolean {
    return compile(p).eval(this.ctx);
  }

  /** Restore the run records a snapshot holds (resume and checkpoint retry). */
  private applySnapshot(snap: RunSnapshot): void {
    let pi = this.lesson.flow.findIndex((p) => p.id === snap.phaseId);
    let si = pi >= 0 ? this.lesson.flow[pi].steps.findIndex((st) => st.id === snap.stepId) : -1;
    if (pi < 0) pi = 0;
    if (si < 0) si = 0;
    this.phaseIdx = pi;
    this.stepIdx = si;
    this.phaseRepeat = snap.phaseRepeat;
    this.stepAttempt = snap.stepAttempt;
    this.interlude = null;
    this.step = null;
    this.ctx.vars = { ...snap.vars };
    this.fsm.reset(snap.authority);
    this.handedBack = false;
    if (snap.authority === 'instructor') this.host.copilot.holdHere();
    else this.host.copilot.stop();
    this.setHolds(snap.holds);
    this._grader.restore(snap.exercises);
    this.faults = snap.faults.map((f) => ({ ...f }));
    this.interventions = snap.interventions;
    this.handbacks = snap.handbacks;
    this.phaseRetries = snap.phaseRetries;
    this.timer = new FlightTimer(true, snap.flightTimer);
    this.attemptId = snap.attemptId;
    this.startedAt = snap.startedAt;
    this.simT = snap.elapsedSimS;
    this.ctx.simT = snap.elapsedSimS;
    this.seed = snap.weatherSeed;
    this.processedSeq = this.deps.bus.mark();
  }
}

// =============================================================================================================
// Pure helpers
// =============================================================================================================

/**
 * Ab initio lessons (stage 1, L01-L08 dual): the coach talks sooner and more often (Coach abInitio). L08 is in
 * the circuits stage by syllabus but still an early dual lesson.
 */
export function isAbInitio(lesson: Lesson): boolean {
  return lesson.kind === 'dual' && (lesson.stage === 'handling' || /^L0[1-8]$/.test(lesson.id));
}

/**
 * A task she talks the student through (TaskFeedback with a start line, milestones or a nudge): live feedback
 * on the card and no "assessment" tag, whatever its exercise's mode. A success line alone ("Thank you.") is
 * the assessed tasks' closing and does not count.
 */
export function coached(def: StepDef): boolean {
  if (def.kind !== 'task' || !def.feedback) return false;
  const f = def.feedback;
  return f.start !== undefined || (f.milestones?.length ?? 0) > 0 || f.nudge !== undefined;
}

/** TaskStep.on `where`: number ranges inclusive, strings and booleans exact. */
function whereMatches(where: Record<string, [number, number] | string | boolean> | undefined, r: TrainingEventRecord): boolean {
  if (!where) return true;
  const data = r.data as Record<string, unknown>;
  for (const [k, cond] of Object.entries(where)) {
    const v = data[k];
    if (Array.isArray(cond)) {
      if (typeof v !== 'number' || v < cond[0] || v > cond[1]) return false;
    } else if (v !== cond) {
      return false;
    }
  }
  return true;
}

/** A safe landing for the L13 gate: not crashed, on the runway, mains first, sink <= 600 fpm (L14's standard). */
export function safeLanding(d: LandingData): boolean {
  return !d.crashed && d.onRunway && d.firstWheel !== 'nose' && d.sinkFpm <= 600;
}

/** A tolerance chip: `ALT +40`, `IAS −3`, `HDG 2°`, `BANK 44°` (bank shows the value, other angles the error). */
export function chipFor(t: CardTargetModel, sig: SignalId): ToleranceChip {
  const state: ToleranceChip['state'] = t.n <= 0.6 ? 'green' : t.n <= 1 ? 'amber' : 'red';
  let text: string;
  if (t.unit === 'deg' && /bank/i.test(sig)) {
    text = `${t.label} ${Math.round(t.value)}°`;
  } else {
    let dev = t.value - t.target;
    if (t.unit === 'deg') {
      dev = wrap180(dev);
      text = `${t.label} ${Math.abs(Math.round(dev))}°`;
    } else {
      const r = Math.round(dev);
      text = `${t.label} ${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r)}`;
    }
  }
  return { label: t.label, text, n: t.n, state };
}
