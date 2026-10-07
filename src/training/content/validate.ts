// The lesson linter (section 6.3, module 6): every signal, var, cue id, demo id, checklist id, vspeed,
// setting, tolerance key and goto target resolves; every phase is reachable; every exercise is fed by a task;
// every task and wait has a timeout; required exercises have a required criterion; prerequisites are
// acyclic; every line is at most 20 words.
//
// Lessons are data (section 2.9). This file is the only thing standing between a typo in a lesson and a
// lesson that hangs or grades nothing at run time, so it checks everything the types cannot:
//   - references: signals, run variables, V-speeds, settings, tolerance keys, events and their payload fields,
//     cue ids and template names, demo scripts (and the variables they read), checklists, exercises, goto
//     targets, areas, ground spots, weather presets, briefing keys;
//   - structure: unique ids, reachable phases, an `end` step, timeouts on every task and wait, criterion
//     fields per kind, required exercises that can actually be graded;
//   - the line table: at most 20 words per line (briefing summaries: per sentence), well-formed templates,
//     known formats, matching variant counts.
// Severity: 'error' is a lesson that cannot run or grade as written; 'warning' is legal but suspicious.

import { KEY_MAP } from '../../input/bindings';
import { FORMATS as RENDER_FORMATS } from '../speech/phraseology';
import { compositeKind } from '../grading/criteria';
import type {
  AircraftTypeDef, AreaId, ChecklistStep, CircuitLeg, CoachLevel, CoachPresetId, CoachRule, Criterion, CueRef, DemoAp,
  DemoScript, ExerciseDef, Holds, InlineCue, InstrumentId, Lesson, LineTable, LintIssue, Outcome, Pattern, Pred, Ref,
  ScenarioId, SigRef, SignalDef, SkillId, StartSpec, StepDef, TaskFeedback, TaskLimit, TaskStep, TolKey, TolRef, TrainingEventName, WeatherSpec,
} from '../types';
import { GROUND_SPOTS } from '../types';
import { WEATHER_PRESETS } from './weatherPresets';

/** What the linter resolves ids against (passed in so the linter stays independent of the registries). */
export interface LintContext {
  signals: readonly SignalDef[];
  lines: LineTable;
  demos: Readonly<Record<string, DemoScript>>;
  aircraft: readonly AircraftTypeDef[];
  /** Briefing key ids beyond the InputActions of bindings.ts and TRAINING_KEY_IDS (later steps). */
  keys?: readonly string[];
  /** Event names added by later steps through TrainingEventMap declaration merging. */
  events?: readonly string[];
  /** Run variables the copilot captures when any demo script starts (content/demos.ts DEMO_START_VARS). */
  demoVars?: readonly string[];
}

// ---- closed vocabularies (exhaustive over the contract's unions, checked by the compiler) ------------------

const TOL_KEYS = {
  altitude: 1, altitudeEngineOut: 1, heading: 1, headingEngineOut: 1, speed: 1, speedClimbApproach: 1, slowFlightSpeed: 1,
  bankMedium: 1, bankSteep: 1, rollout: 1, vs: 1, touchdownZoneFt: 1, touchdownZoneShortFt: 1, centrelineM: 1, glidepathFt: 1,
  stallHeightLossFt: 1, navAltitude: 1, navHeading: 1, xtkNm: 1, etaMin: 1, instrAltitude: 1, instrHeading: 1, turnRate: 1, sinkFpm: 1,
} as const satisfies Record<TolKey, 1>;
const COACH_PRESETS = {
  speed: 1, altitude: 1, heading: 1, bank: 1, ball: 1, trim: 1, levelOff: 1, vs: 1, flapLimit: 1, stallWarning: 1, rpmRedline: 1,
  approachSpeed: 1, centreline: 1, glidepath: 1, flare: 1, crosswindDrift: 1, circuitHeight: 1, downwindSpacing: 1, lookout: 1,
} as const satisfies Record<CoachPresetId, 1>;
const LEGS = { none: 1, ground: 1, upwind: 1, crosswind: 1, downwind: 1, base: 1, final: 1, deadside: 1 } as const satisfies Record<CircuitLeg, 1>;
const COACH_LEVELS = { full: 1, reduced: 1, minimal: 1, silent: 1 } as const satisfies Record<CoachLevel, 1>;
const INSTRUMENTS = { asi: 1, ai: 1, alt: 1, tc: 1, dg: 1, vsi: 1, tach: 1, ball: 1, flaps: 1, fuel: 1, oil: 1 } as const satisfies Record<InstrumentId, 1>;
const AREAS = { trainingArea: 1, fieldOverhead: 1, pflHighKey: 1 } as const satisfies Record<AreaId, 1>;
const SCENARIOS = { runway: 1, apron: 1, final: 1, cruise: 1, downwind: 1 } as const satisfies Record<ScenarioId, 1>;
const PATTERNS = { ok: 1, biasHigh: 1, biasLow: 1, oscillation: 1, drift: 1, late: 1 } as const satisfies Record<Pattern, 1>;
const SKILLS = {
  effectsOfControls: 1, groundOps: 1, straightLevel: 1, climb: 1, descent: 1, turns: 1, slowFlight: 1, stalls: 1, takeoff: 1,
  circuit: 1, approach: 1, landing: 1, goAround: 1, efato: 1, glideApproach: 1, steepTurn: 1, forcedLanding: 1, shortField: 1,
  crosswind: 1, instrument: 1, unusualAttitude: 1, navigation: 1, night: 1, checks: 1, airmanship: 1, radio: 1, transponder: 1,
} as const satisfies Record<SkillId, 1>;
const ACTORS = { instructor: 1, examiner: 1, student: 1, tower: 1, ground: 1, atis: 1, system: 1 } as const;

type FieldKind = 'number' | 'string' | 'boolean';
const TOUCHDOWN_FIELDS: Record<string, FieldKind> = {
  sinkFpm: 'number', kias: 'number', firstWheel: 'string', distAimFt: 'number', rwyAcrossM: 'number', driftDeg: 'number',
  bankDeg: 'number', pitchDeg: 'number', onRunway: 'boolean',
};
/**
 * Payload fields of the core training events (section 2.5), for `atEvent` fields and `event ... where`
 * filters. Exhaustive over the core events; events added by declaration merging come in through
 * LintContext.events and are checked by name only.
 */
const EVENT_FIELDS = {
  touchdown: { wheel: 'string', sinkFpm: 'number' },
  mainsTouchdown: TOUCHDOWN_FIELDS,
  landing: { ...TOUCHDOWN_FIELDS, kiasAt50Ft: 'number', gpDevFtAt300: 'number', bounces: 'number', maxBounceFt: 'number', floatS: 'number',
    rolloutMaxAcrossM: 'number', fullStop: 'boolean', crashed: 'boolean' },
  liftoff: { kias: 'number', rwyAlongM: 'number' },
  stopped: {},
  stallWarnOn: { kias: 'number' },
  stallWarnOff: {},
  stallBreak: { kias: 'number', altFt: 'number' },
  goAround: { aglFt: 'number' },
  crash: { reason: 'string' },
  thresholdCrossed: { heightFt: 'number', kias: 'number' },
  rolloutComplete: { hdgErrDeg: 'number' },
  'student.ack': {}, 'student.handback': {}, 'student.sayAgain': {}, 'student.showMe': {},
  authority: { to: 'string', reason: 'string' },
  intervention: { rule: 'string' },
  'checklist.item': { checklist: 'string', item: 'string', ok: 'boolean' },
  'checklist.done': { checklist: 'string' },
  fault: { id: 'string', severity: 'string' },
  hint: { topic: 'string', rung: 'number' },
  'demo.done': { result: 'string' },
  'step.enter': { phase: 'string', step: 'string' },
  'step.exit': { phase: 'string', step: 'string', result: 'string' },
  'speech.start': { id: 'string', actor: 'string' },
  'speech.end': { id: 'string', result: 'string' },
} as const satisfies Record<TrainingEventName, Record<string, FieldKind>>;

/**
 * Training key ids a briefing may list besides the InputActions (section 5.9): Enter (ack), Shift+Enter
 * (handback), R (sayAgain), [ (showMe), Tab (cycleCard), Shift+R (retryPhase). The shell's TRAINING_KEYS
 * (wave 2) should use these ids.
 */
export const TRAINING_KEY_IDS: readonly string[] = ['ack', 'handback', 'sayAgain', 'showMe', 'cycleCard', 'retryPhase'];

/** Template formats: exactly what the phraseology renderer implements (section 2.6 plus `rwy`, `freq`). */
const FORMATS: ReadonlySet<string> = new Set(RENDER_FORMATS);
/**
 * Template names the engine supplies to its own lines (engine/runner.ts RUNNER_LINES, e.g. "You have the
 * {lever}."): allowed in overrides of those lines.
 */
export const ENGINE_TEMPLATE_NAMES: readonly string[] = ['lever', 'target', 'dev', 'side', 'Side', 'dir', 'lead', 'limit', 'item', 'response', 'checklist', 'name'];
/**
 * Variables the coach supplies with every remark (engine/coach.ts remarkVars): allowed in the lines of a coach
 * rule written in lesson data (a gated preset, or a rule of its own).
 */
export const COACH_REMARK_VARS: readonly string[] = ['value', 'target', 'dev', 'dir', 'side', 'Side', 'nose', 'lead', 'limit'];
/** Cue-id namespaces spoken by the engine (never named by a lesson): engine template names are allowed. */
const ENGINE_NAMESPACES = ['runner.'];

export const MAX_LINE_WORDS = 20;
const TEMPLATE_RE = /\{([^{}:]+)(?::([^{}]+))?\}/g;

/** Words in a caption line: a template counts as one word; tokens without a letter or digit do not count. */
export function countWords(text: string): number {
  return text.replace(TEMPLATE_RE, ' X ').split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}

/** Sentences of a long-form line (briefing summaries are split at sentence boundaries by the backend). */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

const asArray = <T>(x: T | T[]): T[] => (Array.isArray(x) ? x : [x]);
const isFiniteNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

// ---- the per-lesson linter ------------------------------------------------------------------------------------

class LessonLinter {
  readonly issues: LintIssue[] = [];
  private readonly signals: Map<string, SignalDef>;
  private readonly events: Set<string>;
  private readonly keys: Set<string>;
  private readonly aircraft: readonly AircraftTypeDef[];
  /** Run variables: lesson vars plus every capture step's vars (a lesson may jump, so order is not checked). */
  private readonly vars = new Set<string>();
  private readonly exercises = new Map<string, ExerciseDef>();
  private readonly stepIds = new Map<string, number>();
  private readonly phaseIds = new Set<string>();
  private readonly criterionIds = new Map<string, Criterion>();
  private readonly lintedDemos = new Set<string>();
  /** Variables in scope besides the run's: the demo start variables while a demo script is linted. */
  private scopeVars: ReadonlySet<string> = new Set();
  private usesNav = false;

  constructor(private readonly lesson: Lesson, private readonly ctx: LintContext) {
    this.signals = new Map(ctx.signals.map((d) => [d.id, d]));
    this.events = new Set([...Object.keys(EVENT_FIELDS), ...(ctx.events ?? [])]);
    this.keys = new Set([...KEY_MAP.map((k) => k.action), 'pause', ...TRAINING_KEY_IDS, ...(ctx.keys ?? [])]);
    this.aircraft = lesson.aircraft === 'any' ? ctx.aircraft : ctx.aircraft.filter((a) => (lesson.aircraft as readonly string[]).includes(a.id));
  }

  private issue(severity: LintIssue['severity'], path: string, message: string): void {
    this.issues.push({ lessonId: this.lesson.id, path, message, severity });
  }
  private err(path: string, message: string): void { this.issue('error', path, message); }
  private warn(path: string, message: string): void { this.issue('warning', path, message); }

  run(): LintIssue[] {
    const l = this.lesson;
    this.collect();
    if (!l.id) this.err('id', 'lesson id is empty');
    if (!(l.version >= 1) || !Number.isInteger(l.version)) this.err('version', 'version must be a positive integer');
    if (!l.title) this.err('title', 'title is empty');
    if (l.aircraft !== 'any') {
      for (const id of l.aircraft) if (!this.ctx.aircraft.some((a) => a.id === id)) this.err('aircraft', `unknown aircraft type '${id}'`);
    }
    if (this.aircraft.length === 0) this.err('aircraft', 'no aircraft type to lint against');
    if (!(l.estMinutes > 0)) this.err('estMinutes', 'estMinutes must be positive');
    if ((l.kind === 'test') !== (l.persona === 'examiner')) this.warn('persona', `a ${l.kind} lesson normally uses the ${l.kind === 'test' ? 'examiner' : 'instructor'}`);
    this.lintRules();
    this.lintStart('start', l.start);
    this.lintWeather('weather', l.weather);
    if (l.vars) for (const [k, r] of Object.entries(l.vars)) this.lintRef(`vars.${k}`, r);
    this.lintBriefing();
    this.lintExercises();
    this.lintFlow();
    this.lintFeeding();
    this.lintReachability();
    this.lintDebriefTips();
    if (l.route) this.lintRoute();
    if (this.usesNav && !l.route) this.err('route', 'the lesson uses nav.* signals but has no route');
    const awards = new Set<string>();
    for (const [i, a] of (l.awards ?? []).entries()) {
      if (awards.has(a.id)) this.err(`awards[${i}]`, `duplicate award '${a.id}'`);
      awards.add(a.id);
      if (a.when === 'testPass' && l.kind !== 'test') this.err(`awards[${i}]`, 'a testPass award needs a test lesson');
    }
    return this.issues;
  }

  /** First pass: ids and run variables, so references can be checked in any order. */
  private collect(): void {
    const l = this.lesson;
    for (const k of Object.keys(l.vars ?? {})) this.vars.add(k);
    for (const [i, e] of l.exercises.entries()) {
      if (this.exercises.has(e.id)) this.err(`exercises[${i}]`, `duplicate exercise id '${e.id}'`);
      this.exercises.set(e.id, e);
    }
    for (const [pi, p] of l.flow.entries()) {
      if (this.phaseIds.has(p.id)) this.err(`flow[${pi}]`, `duplicate phase id '${p.id}'`);
      this.phaseIds.add(p.id);
      for (const [si, s] of p.steps.entries()) {
        const path = `flow.${p.id}.steps[${si}]`;
        if (!s.id) this.err(path, 'step id is empty');
        else if (s.id.startsWith('phase:')) this.err(path, `step id '${s.id}' uses the reserved 'phase:' prefix`);
        else if (this.stepIds.has(s.id)) this.err(path, `duplicate step id '${s.id}' (goto targets must be unique)`);
        this.stepIds.set(s.id, pi);
        if (s.kind === 'capture') for (const k of Object.keys(s.vars)) this.vars.add(k);
        if (s.kind === 'task') {
          for (const c of s.criteria) {
            if (this.criterionIds.has(c.id)) this.warn(`${path}.criteria`, `criterion id '${c.id}' is used by more than one task (debrief tips and charts are keyed by it)`);
            this.criterionIds.set(c.id, c);
          }
        }
      }
    }
  }

  // ---- rules, start, weather, briefing ------------------------------------------------------------------------

  private lintRules(): void {
    const r = this.lesson.rules;
    if (!(r.coachLevel in COACH_LEVELS)) this.err('rules.coachLevel', `unknown coach level '${r.coachLevel}'`);
    if (!(r.maxTimeScale >= 1)) this.err('rules.maxTimeScale', 'maxTimeScale must be at least 1');
    if (!(r.maxDurationS > 0)) this.err('rules.maxDurationS', 'maxDurationS must be positive (no lesson may run forever)');
    if ((this.lesson.kind === 'solo' || this.lesson.kind === 'test') && r.instructorSaves) {
      this.err('rules.instructorSaves', `instructor saves must be off in a ${this.lesson.kind} lesson (section 1.6)`);
    }
    const e = r.envelope;
    if (e) {
      for (const [k, x] of Object.entries(e)) {
        if (k === 'lowAndSlow' || k === 'stallAllowed') continue;
        if (!isFiniteNum(x)) this.err(`rules.envelope.${k}`, 'envelope limits must be finite numbers');
      }
      if (e.lowAndSlow) this.lintRef('rules.envelope.lowAndSlow.belowKias', e.lowAndSlow.belowKias);
    }
  }

  private lintStart(path: string, s: StartSpec): void {
    switch (s.kind) {
      case 'scenario':
        if (!(s.id in SCENARIOS)) this.err(path, `unknown scenario '${s.id}'`);
        break;
      case 'ground':
        if (!GROUND_SPOTS.includes(s.spot)) this.err(path, `unknown ground spot '${s.spot}'`);
        if (s.engine !== 'running' && s.engine !== 'cold') this.err(path, `engine must be 'running' or 'cold'`);
        break;
      case 'air':
        if (typeof s.at === 'string') { if (!(s.at in AREAS)) this.err(path, `unknown area '${s.at}'`); }
        else if (!isFiniteNum(s.at.north) || !isFiniteNum(s.at.east)) this.err(path, 'start position must be finite');
        if (!(s.altFt > 0)) this.err(path, 'altFt must be positive');
        if (s.altRef !== 'msl' && s.altRef !== 'field') this.err(path, `altRef must be 'msl' or 'field'`);
        this.lintHeading(path, s.hdgDeg);
        this.lintRef(`${path}.kias`, s.kias);
        if (s.flapsDeg !== undefined) this.lintFlaps(path, s.flapsDeg);
        break;
      case 'final':
        if (!(s.distNm > 0)) this.err(path, 'distNm must be positive');
        this.lintRef(`${path}.kias`, s.kias);
        this.lintFlaps(path, s.flapsDeg);
        break;
      case 'circuit':
        if (s.leg !== 'downwind' && s.leg !== 'base') this.err(path, `unknown circuit leg '${s.leg}'`);
        if (!['early', 'abeamMid', 'abeamThr'].includes(s.position)) this.err(path, `unknown circuit position '${s.position}'`);
        this.lintRef(`${path}.kias`, s.kias);
        if (s.flapsDeg !== undefined) this.lintFlaps(path, s.flapsDeg);
        break;
      case 'attitude':
        if (!(s.at in AREAS)) this.err(path, `unknown area '${s.at}'`);
        if (!(s.altFt > 0) || !(s.kias > 0)) this.err(path, 'altFt and kias must be positive');
        if (!(Math.abs(s.pitchDeg) <= 60) || !(Math.abs(s.bankDeg) <= 90)) this.err(path, 'attitude out of range (pitch within 60, bank within 90)');
        this.lintHeading(path, s.hdgDeg);
        break;
      default:
        this.err(path, `unknown start kind '${(s as { kind: string }).kind}'`);
    }
  }

  private lintHeading(path: string, h: number): void {
    if (!(h >= 0 && h <= 360)) this.err(path, `heading ${h} outside 0-360`);
  }

  private lintFlaps(path: string, deg: number): void {
    for (const a of this.aircraft) if (!a.flapDetentsDeg.includes(deg)) this.err(path, `flap ${deg}° is not a detent of ${a.id}`);
  }

  private lintWeather(path: string, w: WeatherSpec): void {
    if (!(w.preset in WEATHER_PRESETS)) { this.err(`${path}.preset`, `unknown weather preset '${w.preset}'`); return; }
    for (const k of ['windDirDeg', 'windKt', 'gustKt', 'turbulence'] as const) {
      const r = w[k];
      if (!r) continue;
      if (r.length !== 2 || !r.every(isFiniteNum)) this.err(`${path}.${k}`, 'a range is [low, high]');
      else if (k !== 'windDirDeg' && !(r[0] >= 0 && r[0] <= r[1])) this.err(`${path}.${k}`, 'range must be 0 <= low <= high');
    }
    // v1: runway 07 always into wind (section 2.8).
    const dirs = w.windDirDeg ?? WEATHER_PRESETS[w.preset].ranges?.windDirDeg;
    if (dirs && dirs.some((d) => d < 40 || d > 160)) this.err(`${path}.windDirDeg`, 'v1 winds must stay within 040-160 so runway 07 is into wind');
    const fixedDir = w.override?.windDirectionDeg ?? (dirs ? undefined : WEATHER_PRESETS[w.preset].settings.windDirectionDeg);
    if (fixedDir !== undefined && (fixedDir < 40 || fixedDir > 160)) this.err(`${path}`, 'v1 winds must stay within 040-160 so runway 07 is into wind');
  }

  private lintBriefing(): void {
    const b = this.lesson.briefing;
    if (!b.aim) this.err('briefing.aim', 'the aim is empty');
    if (b.points.length < 3 || b.points.length > 5) this.warn('briefing.points', `${b.points.length} key points (section 2.9: 3-5)`);
    for (const [i, n] of b.numbers.entries()) this.lintRef(`briefing.numbers[${i}]`, n.value);
    for (const [i, k] of b.tolerances.entries()) if (!(k in TOL_KEYS)) this.err(`briefing.tolerances[${i}]`, `unknown tolerance key '${k}'`);
    for (const [i, k] of b.keys.entries()) if (!this.keys.has(k)) this.err(`briefing.keys[${i}]`, `unknown key id '${k}' (an InputAction or a training key)`);
    this.lintCue('briefing.spoken', b.spoken, true);
  }

  private lintExercises(): void {
    for (const [i, e] of this.lesson.exercises.entries()) {
      const path = `exercises[${i}]`;
      if (!(e.skill in SKILLS)) this.err(path, `unknown skill '${e.skill}'`);
      if (!['demo', 'practice', 'assessed'].includes(e.mode)) this.err(path, `unknown mode '${e.mode}'`);
      if (!['training', 'test', 'commercial'].includes(e.standard)) this.err(path, `unknown standard '${e.standard}'`);
      if (!(e.weight >= 0)) this.err(path, 'weight must be >= 0');
      if (e.mode === 'demo' && e.required) this.err(path, 'a demonstration cannot be required (it is never graded)');
      if (e.testSection !== undefined && this.lesson.kind !== 'test') this.warn(path, 'testSection outside a test lesson');
      if (this.lesson.kind === 'test' && e.testSection === undefined) this.err(path, 'every skill-test exercise needs a testSection');
    }
  }

  private lintRoute(): void {
    const r = this.lesson.route!;
    if (r.waypoints.length < 2) this.err('route', 'a route needs at least two waypoints');
    const ids = new Set<string>();
    for (const [i, w] of r.waypoints.entries()) {
      if (ids.has(w.id)) this.err(`route.waypoints[${i}]`, `duplicate waypoint id '${w.id}'`);
      ids.add(w.id);
      if (!isFiniteNum(w.north) || !isFiniteNum(w.east)) this.err(`route.waypoints[${i}]`, 'waypoint position must be finite');
    }
    const legs = r.waypoints.length - 1;
    if (r.legMinutes.length !== legs) this.err('route.legMinutes', `${r.legMinutes.length} times for ${legs} legs`);
    if (r.legHeadingsDeg.length !== legs) this.err('route.legHeadingsDeg', `${r.legHeadingsDeg.length} headings for ${legs} legs`);
    if (!(r.altFt > 0)) this.err('route.altFt', 'route altitude must be positive');
  }

  // ---- flow -----------------------------------------------------------------------------------------------------

  private lintFlow(): void {
    const l = this.lesson;
    if (l.flow.length === 0) { this.err('flow', 'the lesson has no phases'); return; }
    let ends = 0;
    for (const p of l.flow) {
      const pp = `flow.${p.id}`;
      if (p.steps.length === 0) this.err(pp, 'phase has no steps');
      if (p.repeat) {
        if (!(p.repeat.max >= 1) || !Number.isInteger(p.repeat.max)) this.err(`${pp}.repeat`, 'repeat.max must be a positive integer');
        if (p.repeat.until) this.lintPred(`${pp}.repeat.until`, p.repeat.until);
      }
      if (p.retryFrom) this.lintStart(`${pp}.retryFrom`, p.retryFrom);
      if (p.coachLevel && !(p.coachLevel in COACH_LEVELS)) this.err(`${pp}.coachLevel`, `unknown coach level '${p.coachLevel}'`);
      if (p.maxTimeScale !== undefined && !(p.maxTimeScale >= 1)) this.err(`${pp}.maxTimeScale`, 'maxTimeScale must be at least 1');
      for (const [si, s] of p.steps.entries()) {
        if (s.kind === 'end') ends++;
        this.lintStep(`${pp}.${s.id || `steps[${si}]`}`, s);
      }
    }
    if (ends === 0) this.err('flow', 'the lesson has no end step');
  }

  private lintStep(path: string, s: StepDef): void {
    if (s.when) this.lintPred(`${path}.when`, s.when);
    if (s.whenPrompt) {
      if (!s.when) this.warn(`${path}.whenPrompt`, 'whenPrompt without when');
      if (!(s.whenPrompt.afterS >= 0)) this.err(`${path}.whenPrompt.afterS`, 'afterS must be >= 0');
      this.lintCue(`${path}.whenPrompt.cue`, s.whenPrompt.cue);
    }
    if (s.timeoutS !== undefined && !(s.timeoutS > 0)) this.err(`${path}.timeoutS`, 'timeoutS must be positive');
    if (s.onTimeout !== undefined) this.lintOutcome(`${path}.onTimeout`, s.onTimeout);
    if (s.when && s.timeoutS === undefined && s.kind !== 'task' && s.kind !== 'wait') this.warn(`${path}.when`, 'a pending step without timeoutS waits until maxDurationS');
    switch (s.kind) {
      case 'say': this.lintCue(`${path}.cue`, s.cue); break;
      case 'wait':
        this.lintPred(`${path}.until`, s.until);
        if (s.cue) this.lintCue(`${path}.cue`, s.cue);
        if (s.prompt) this.lintCue(`${path}.prompt`, s.prompt);
        if (s.timeoutS === undefined) this.err(`${path}.timeoutS`, 'every wait step needs a timeoutS');
        break;
      case 'capture':
        for (const [k, r] of Object.entries(s.vars)) {
          if (typeof r === 'string') this.lintSigRef(`${path}.vars.${k}`, r);
          else this.lintRef(`${path}.vars.${k}`, r);
        }
        break;
      case 'setup':
        if (s.reposition) this.lintStart(`${path}.reposition`, s.reposition);
        if (s.weather) this.lintWeather(`${path}.weather`, s.weather);
        if (s.holds) this.lintHolds(`${path}.holds`, s.holds);
        if (s.hood && !this.lesson.rules.hood) this.err(`${path}.hood`, 'the hood is used but rules.hood is not set');
        if (s.timeScaleMax !== undefined && !(s.timeScaleMax >= 1)) this.err(`${path}.timeScaleMax`, 'timeScaleMax must be at least 1');
        if (s.cue) this.lintCue(`${path}.cue`, s.cue);
        break;
      case 'handover':
        if (s.to !== 'student' && s.to !== 'instructor') this.err(path, `handover to '${s.to}'`);
        if (s.ackTimeoutS !== undefined && !(s.ackTimeoutS > 0)) this.err(`${path}.ackTimeoutS`, 'ackTimeoutS must be positive');
        break;
      case 'demo':
        this.lintDemoRef(`${path}.script`, s.script);
        if (s.intro) this.lintCue(`${path}.intro`, s.intro);
        for (const id of s.highlight ?? []) if (!(id in INSTRUMENTS)) this.err(`${path}.highlight`, `unknown instrument '${id}'`);
        break;
      case 'checklist': this.lintChecklist(path, s); break;
      case 'branch':
        if (s.cases.length === 0) this.warn(path, 'a branch without cases always takes else');
        for (const [i, c] of s.cases.entries()) { this.lintPred(`${path}.cases[${i}].when`, c.when); this.lintTarget(`${path}.cases[${i}].goto`, c.goto); }
        this.lintTarget(`${path}.else`, s.else);
        break;
      case 'end': if (s.cue) this.lintCue(`${path}.cue`, s.cue); break;
      case 'task': this.lintTask(path, s); break;
      default: this.err(path, `unknown step kind '${(s as { kind: string }).kind}'`);
    }
  }

  private lintChecklist(path: string, s: ChecklistStep): void {
    for (const a of this.aircraft) if (!a.checklists[s.checklist]) this.err(`${path}.checklist`, `checklist '${s.checklist}' is not defined for ${a.id}`);
    if (!['challengeResponse', 'flow', 'silent'].includes(s.mode)) this.err(`${path}.mode`, `unknown checklist mode '${s.mode}'`);
    if (s.exercise !== undefined && !this.exercises.has(s.exercise)) this.err(`${path}.exercise`, `unknown exercise '${s.exercise}'`);
    if ((this.lesson.kind === 'solo' || this.lesson.kind === 'test') && s.mode === 'challengeResponse') {
      this.warn(`${path}.mode`, `nobody reads the challenges in a ${this.lesson.kind} lesson: use 'silent'`);
    }
  }

  private lintTask(path: string, t: TaskStep): void {
    if (!this.exercises.has(t.exercise)) this.err(`${path}.exercise`, `unknown exercise '${t.exercise}'`);
    else if (this.exercises.get(t.exercise)!.mode === 'demo') this.err(`${path}.exercise`, `task scores the demonstration exercise '${t.exercise}'`);
    if (t.timeoutS === undefined) this.err(`${path}.timeoutS`, 'every task needs a timeoutS');
    this.lintCue(`${path}.brief`, t.brief);
    if (t.prompt) this.lintCue(`${path}.prompt`, t.prompt);
    if (!t.card.title) this.warn(`${path}.card.title`, 'the task card has no title');
    if (t.card.targets.length > 4) this.warn(`${path}.card.targets`, 'more than 4 targets: the strip shows only 4 chips');
    for (const [i, tg] of t.card.targets.entries()) {
      const tp = `${path}.card.targets[${i}]`;
      this.lintSigRef(tp, tg.sig);
      this.lintRef(`${tp}.value`, tg.value);
      if (tg.tol !== undefined) this.lintTol(`${tp}.tol`, tg.tol);
    }
    this.lintPred(`${path}.goal`, t.goal);
    if (t.minS !== undefined && !(t.minS >= 0)) this.err(`${path}.minS`, 'minS must be >= 0');
    const ids = new Set<string>();
    for (const [i, c] of t.criteria.entries()) {
      if (ids.has(c.id)) this.err(`${path}.criteria[${i}]`, `duplicate criterion id '${c.id}' in the task`);
      ids.add(c.id);
      this.lintCriterion(`${path}.criteria.${c.id || i}`, c);
    }
    for (const [i, c] of (t.coach ?? []).entries()) {
      if (typeof c === 'string') { if (!(c in COACH_PRESETS)) this.err(`${path}.coach[${i}]`, `unknown coach preset '${c}'`); }
      else this.lintCoachRule(`${path}.coach[${i}]`, c);
    }
    for (const [i, f] of (t.faults ?? []).entries()) {
      const fp = `${path}.faults[${i}]`;
      if (!f.id) this.err(fp, 'fault id is empty');
      if (!['minor', 'major', 'critical'].includes(f.severity)) this.err(fp, `unknown severity '${f.severity}'`);
      this.lintPred(`${fp}.when`, f.when);
      if (f.cue) this.lintCue(`${fp}.cue`, f.cue);
    }
    if (t.holds) this.lintHolds(`${path}.holds`, t.holds);
    for (const id of t.highlight ?? []) if (!(id in INSTRUMENTS)) this.err(`${path}.highlight`, `unknown instrument '${id}'`);
    for (const [i, h] of (t.on ?? []).entries()) {
      const hp = `${path}.on[${i}]`;
      this.lintEvent(hp, h.event, h.where);
      if (h.cue) this.lintCue(`${hp}.cue`, h.cue);
      this.lintTarget(`${hp}.goto`, h.goto);
    }
    if (t.feedback) this.lintFeedback(`${path}.feedback`, t.feedback);
    if (t.limits) this.lintLimits(`${path}.limits`, t.limits);
    if (t.attempts !== undefined && !(t.attempts >= 1 && Number.isInteger(t.attempts))) this.err(`${path}.attempts`, 'attempts must be a positive integer');
    for (const k of ['onSuccess', 'onFail'] as const) {
      const o = t[k];
      if (!o) continue;
      if (o.cue) this.lintCue(`${path}.${k}.cue`, o.cue);
      if (o.next !== undefined) this.lintOutcome(`${path}.${k}.next`, o.next);
    }
  }

  /** Running instruction (TaskFeedback): every cue and predicate resolves; milestone ids are unique. */
  private lintFeedback(path: string, f: TaskFeedback): void {
    if (f.start) this.lintCue(`${path}.start`, f.start);
    if (f.success) this.lintCue(`${path}.success`, f.success);
    const ids = new Set<string>();
    for (const [i, m] of (f.milestones ?? []).entries()) {
      const mp = `${path}.milestones.${m.id || i}`;
      if (!m.id) this.err(mp, 'milestone id is empty');
      else if (ids.has(m.id)) this.err(mp, `duplicate milestone id '${m.id}'`);
      ids.add(m.id);
      this.lintPred(`${mp}.when`, m.when);
      this.lintCue(`${mp}.cue`, m.cue);
      if (m.minT !== undefined && !(m.minT >= 0)) this.err(`${mp}.minT`, 'minT must be >= 0');
    }
    if (f.nudge) {
      // {missing} names the first missing item (TaskFeedback.nudge.missing).
      this.lintCue(`${path}.nudge.cue`, f.nudge.cue, false, f.nudge.missing?.length ? ['missing'] : []);
      for (const [i, m] of (f.nudge.missing ?? []).entries()) {
        this.lintPred(`${path}.nudge.missing.${i}.when`, m.when);
        if (m.cue) this.lintCue(`${path}.nudge.missing.${i}.cue`, m.cue);
      }
      if (f.nudge.afterS !== undefined && !(f.nudge.afterS > 0)) this.err(`${path}.nudge.afterS`, 'afterS must be positive');
      if (f.nudge.everyS !== undefined && !(f.nudge.everyS > 0)) this.err(`${path}.nudge.everyS`, 'everyS must be positive');
    }
  }

  /** Lesson limits (TaskLimit): a known signal, at least one bound, a sensible band, a cue. */
  private lintLimits(path: string, limits: readonly TaskLimit[]): void {
    const ids = new Set<string>();
    for (const [i, l] of limits.entries()) {
      const lp = `${path}.${l.id || i}`;
      if (!l.id) this.err(lp, 'limit id is empty');
      else if (ids.has(l.id)) this.err(lp, `duplicate limit id '${l.id}'`);
      ids.add(l.id);
      const def = this.lintSigRef(`${lp}.sig`, l.sig);
      if (def && (def.kind === 'bool' || def.kind === 'enum')) this.err(`${lp}.sig`, `'${def.id}' is a ${def.kind} signal: a limit needs a number`);
      if (l.min === undefined && l.max === undefined) this.err(lp, 'a limit needs min or max');
      if (l.min !== undefined) this.lintRef(`${lp}.min`, l.min);
      if (l.max !== undefined) this.lintRef(`${lp}.max`, l.max);
      if (typeof l.min === 'number' && typeof l.max === 'number' && !(l.min < l.max)) this.err(lp, 'min must be below max');
      if (l.forS !== undefined && !(l.forS > 0)) this.err(`${lp}.forS`, 'forS must be positive');
      this.lintCue(`${lp}.cue`, l.cue);
    }
  }

  private lintCriterion(path: string, c: Criterion): void {
    if (!c.id) this.err(path, 'criterion id is empty');
    if (!c.label) this.warn(path, 'criterion has no label');
    // A composite grader (grading/criteria.ts: an atEvent on 'landing', 'stallBreak', 'stallWarnOn' or
    // 'authority' with neither sig nor field) reads its own signals; its tolerance is still checked.
    const composite = compositeKind(c);
    if (composite !== null && c.tol !== undefined) this.lintTol(`${path}.tol`, c.tol);
    const needsTarget = composite === null && (c.kind === 'hold' || c.kind === 'peak' || c.kind === 'final' || c.kind === 'atEvent');
    if (needsTarget) {
      if (c.kind !== 'atEvent' || c.field === undefined) {
        if (c.sig === undefined) this.err(`${path}.sig`, `a ${c.kind} criterion needs a signal`);
      }
      if (c.sig !== undefined) this.lintSigRef(`${path}.sig`, c.sig);
      if (c.target === undefined) this.err(`${path}.target`, `a ${c.kind} criterion needs a target`);
      else this.lintRef(`${path}.target`, c.target);
      if (c.tol === undefined) this.err(`${path}.tol`, `a ${c.kind} criterion needs a tolerance`);
      else this.lintTol(`${path}.tol`, c.tol);
    }
    switch (c.kind) {
      case 'hold': case 'final': break;
      case 'peak':
        if (c.peakOf !== undefined && !['abs', 'max', 'min'].includes(c.peakOf)) this.err(`${path}.peakOf`, `unknown peakOf '${c.peakOf}'`);
        break;
      case 'atEvent':
        if (!c.event) this.err(`${path}.event`, 'an atEvent criterion needs an event');
        else {
          this.lintEvent(path, c.event, undefined);
          const fields = (EVENT_FIELDS as Record<string, Record<string, FieldKind>>)[c.event];
          if (c.field !== undefined && fields && fields[c.field] !== 'number') this.err(`${path}.field`, `'${c.field}' is not a numeric field of '${c.event}'`);
        }
        break;
      case 'check':
        if (!c.pred) this.err(`${path}.pred`, 'a check criterion needs a pred');
        else this.lintPred(`${path}.pred`, c.pred);
        if (c.withinS !== undefined && !(c.withinS > 0)) this.err(`${path}.withinS`, 'withinS must be positive');
        break;
      case 'binary':
        if (!c.failIf) this.err(`${path}.failIf`, 'a binary criterion needs failIf');
        else this.lintPred(`${path}.failIf`, c.failIf);
        break;
      default: this.err(path, `unknown criterion kind '${(c as { kind: string }).kind}'`);
    }
    if (c.settleS !== undefined && !(c.settleS >= 0)) this.err(`${path}.settleS`, 'settleS must be >= 0');
    if (c.activeWhen) this.lintPred(`${path}.activeWhen`, c.activeWhen);
    if (c.safety && !c.required) this.warn(path, 'a safety criterion that is not required still fails the exercise');
  }

  private lintCoachRule(path: string, r: CoachRule): void {
    if (!r.id || !r.topic) this.err(path, 'a coach rule needs an id and a topic');
    this.lintPred(`${path}.when`, r.when);
    if (!(r.afterS >= 0)) this.err(`${path}.afterS`, 'afterS must be >= 0');
    if (r.correcting) { this.lintSigRef(`${path}.correcting.sig`, r.correcting.sig); this.lintRef(`${path}.correcting.target`, r.correcting.target); }
    r.say.forEach((c, i) => { if (c !== undefined) this.lintCue(`${path}.say[${i}]`, c, false, COACH_REMARK_VARS); });
    if (r.praise) this.lintCue(`${path}.praise`, r.praise, false, COACH_REMARK_VARS);
    if (!(r.minLevel in COACH_LEVELS)) this.err(`${path}.minLevel`, `unknown coach level '${r.minLevel}'`);
  }

  private lintHolds(path: string, h: Holds): void {
    for (const k of ['throttle', 'mixture'] as const) {
      const x = h[k];
      if (x !== undefined && !(x >= 0 && x <= 1)) this.err(`${path}.${k}`, `${k} hold must be within 0..1`);
    }
    if (h.flapsDeg !== undefined) this.lintFlaps(path, h.flapsDeg);
    if (h.release) this.lintPred(`${path}.release`, h.release);
    if (h.cue) this.lintCue(`${path}.cue`, h.cue);
  }

  private lintOutcome(path: string, o: Outcome): void {
    if (typeof o === 'string') {
      if (!['next', 'retry', 'fail', 'end', 'instructorTakes'].includes(o)) this.err(path, `unknown outcome '${o}'`);
    } else if ('goto' in o) this.lintTarget(path, o.goto);
    else if ('demo' in o) this.lintDemoRef(path, o.demo);
    else this.err(path, 'unknown outcome');
  }

  private lintTarget(path: string, target: string): void {
    if (target.startsWith('phase:')) {
      if (!this.phaseIds.has(target.slice(6))) this.err(path, `goto target phase '${target.slice(6)}' does not exist`);
    } else if (!this.stepIds.has(target)) this.err(path, `goto target step '${target}' does not exist`);
  }

  // ---- demos --------------------------------------------------------------------------------------------------

  private lintDemoRef(path: string, script: string | DemoScript): void {
    if (typeof script !== 'string') { this.lintDemo(path, script); return; }
    const d = this.ctx.demos[script];
    if (!d) { this.err(path, `unknown demo script '${script}'`); return; }
    if (this.lintedDemos.has(script)) return;
    this.lintedDemos.add(script);
    // The script reads run variables of the lesson that runs it (hdg0, alt0...): check them here.
    this.lintDemo(`demos.${script}`, d);
  }

  private lintDemo(path: string, d: DemoScript): void {
    const outer = this.scopeVars;
    this.scopeVars = new Set(this.ctx.demoVars ?? []);
    try { this.lintDemoBody(path, d); } finally { this.scopeVars = outer; }
  }

  private hasVar(name: string): boolean {
    return this.vars.has(name) || this.scopeVars.has(name);
  }

  private lintDemoBody(path: string, d: DemoScript): void {
    if (d.segments.length === 0) this.err(path, 'demo script has no segments');
    if (d.abortWhen) this.lintPred(`${path}.abortWhen`, d.abortWhen);
    for (const [i, s] of d.segments.entries()) {
      const sp = `${path}.segments[${i}]`;
      if (s.say) this.lintCue(`${sp}.say`, s.say);
      switch (s.kind) {
        case 'ap':
          this.lintDemoAp(sp, s.ap);
          for (const [k, x] of Object.entries(s.set ?? {})) {
            if (typeof x === 'number') continue;
            if (x) { this.lintRef(`${sp}.set.${k}`, x.to); if (!(x.overS >= 0)) this.err(`${sp}.set.${k}`, 'ramp overS must be >= 0'); }
          }
          this.lintPred(`${sp}.until`, s.until);
          if (!(s.timeoutS > 0)) this.err(`${sp}.timeoutS`, 'every until segment needs a positive timeoutS');
          break;
        case 'autoflight':
          if (!['takeoff', 'hold', 'approach', 'parked'].includes(s.plan.kind)) this.err(`${sp}.plan`, `unknown autoflight plan '${s.plan.kind}'`);
          this.lintPred(`${sp}.until`, s.until);
          if (!(s.timeoutS > 0)) this.err(`${sp}.timeoutS`, 'every until segment needs a positive timeoutS');
          break;
        case 'raw':
          if (!(s.forS > 0)) this.err(`${sp}.forS`, 'forS must be positive');
          if (s.ap) this.lintDemoAp(sp, s.ap);
          break;
        case 'pulse':
          if (!(s.holdS > 0)) this.err(`${sp}.holdS`, 'holdS must be positive');
          if (!(Math.abs(s.amount) <= 1)) this.err(`${sp}.amount`, 'amount must be within -1..1');
          break;
        case 'pause':
          if (!(s.s >= 0)) this.err(`${sp}.s`, 'pause must be >= 0');
          break;
        default: this.err(sp, `unknown segment kind '${(s as { kind: string }).kind}'`);
      }
    }
  }

  private lintDemoAp(path: string, ap: DemoAp): void {
    for (const k of ['hdgDeg', 'bankDeg', 'pitchDeg', 'vsFpm', 'altFt', 'kias'] as const) {
      const r = ap[k];
      if (r !== undefined) this.lintRef(`${path}.ap.${k}`, r);
    }
  }

  // ---- predicates, refs, tolerances, cues ---------------------------------------------------------------------

  private lintPred(path: string, p: Pred): void {
    if (p === null || typeof p !== 'object') { this.err(path, 'not a predicate'); return; }
    if ('all' in p || 'any' in p) {
      const list = 'all' in p ? p.all : p.any;
      if (!Array.isArray(list) || list.length === 0) this.err(path, 'all/any needs at least one predicate');
      else list.forEach((q, i) => this.lintPred(`${path}[${i}]`, q));
    } else if ('not' in p) this.lintPred(`${path}.not`, p.not);
    else if ('held' in p) {
      if (!(p.s > 0)) this.err(path, 'held needs s > 0');
      if (p.graceS !== undefined && !(p.graceS >= 0)) this.err(path, 'graceS must be >= 0');
      this.lintPred(`${path}.held`, p.held);
    } else if ('ever' in p) this.lintPred(`${path}.ever`, p.ever);
    else if ('event' in p) {
      this.lintEvent(path, p.event, p.where);
      if (p.count !== undefined && !(p.count >= 1 && Number.isInteger(p.count))) this.err(path, 'count must be a positive integer');
    } else if ('elapsed' in p) { if (!(p.elapsed >= 0)) this.err(path, 'elapsed must be >= 0'); }
    else if ('turned' in p) { if (!(p.turned > 0)) this.err(path, 'turned must be > 0'); }
    else if ('authority' in p) { if (p.authority !== 'student' && p.authority !== 'instructor') this.err(path, `unknown authority '${p.authority}'`); }
    else if ('speechIdle' in p) { if (p.speechIdle !== true) this.err(path, 'speechIdle must be true'); }
    else if ('leg' in p) { for (const l of asArray(p.leg)) if (!(l in LEGS)) this.err(path, `unknown circuit leg '${l}'`); }
    else if ('exerciseGrade' in p) {
      if (!this.exercises.has(p.exerciseGrade)) this.err(path, `unknown exercise '${p.exerciseGrade}'`);
      if (![1, 2, 3, 4].includes(p.atLeast)) this.err(path, 'atLeast must be a grade 1-4');
    } else if ('const' in p) { if (typeof p.const !== 'boolean') this.err(path, 'const must be a boolean'); }
    else if ('sig' in p) {
      const def = this.lintSigRef(path, p.sig);
      if ('op' in p) {
        if (!['<', '<=', '>', '>='].includes(p.op)) this.err(path, `unknown operator '${p.op}'`);
        this.lintRef(`${path}.v`, p.v);
        if (p.hyst !== undefined && !(p.hyst >= 0)) this.err(path, 'hyst must be >= 0');
        if (def && (def.kind === 'bool' || def.kind === 'enum')) this.err(path, `'${def.id}' is a ${def.kind} signal: compare it with eq`);
      } else if ('eq' in p) {
        const want = def?.kind === 'bool' ? 'boolean' : def?.kind === 'enum' ? 'string' : def ? 'number' : null;
        if (want && typeof p.eq !== want) this.err(path, `'${def!.id}' is a ${def!.kind} signal: eq needs a ${want}`);
      } else if ('near' in p) {
        this.lintRef(`${path}.near`, p.near);
        this.lintTol(`${path}.tol`, p.tol);
        if (p.hyst !== undefined && !(p.hyst >= 0)) this.err(path, 'hyst must be >= 0');
        if (def && (def.kind === 'bool' || def.kind === 'enum')) this.err(path, `'${def.id}' is a ${def.kind} signal: compare it with eq`);
      } else this.err(path, 'a signal predicate needs op, eq or near');
    } else this.err(path, `unknown predicate ${JSON.stringify(p).slice(0, 60)}`);
  }

  private lintEvent(path: string, name: string, where: Record<string, [number, number] | string | boolean> | undefined): void {
    if (!this.events.has(name)) { this.err(path, `unknown event '${name}'`); return; }
    const fields = (EVENT_FIELDS as Record<string, Record<string, FieldKind>>)[name];
    if (!where || !fields) return;
    for (const [k, x] of Object.entries(where)) {
      const kind = fields[k];
      if (!kind) { this.err(`${path}.where.${k}`, `'${name}' has no field '${k}'`); continue; }
      const got = Array.isArray(x) ? 'number' : typeof x;
      if (got !== kind) this.err(`${path}.where.${k}`, `'${k}' is a ${kind}: filter it with ${kind === 'number' ? 'a [low, high] range' : `a ${kind}`}`);
      if (Array.isArray(x) && !(x.length === 2 && x[0] <= x[1])) this.err(`${path}.where.${k}`, 'a range is [low, high]');
    }
  }

  /** Checks a signal reference; returns the signal's definition when it names one directly. */
  private lintSigRef(path: string, s: SigRef): SignalDef | undefined {
    if (typeof s === 'string') {
      const def = this.signals.get(s);
      if (!def) this.err(path, `unknown signal '${s}'`);
      if (s.startsWith('nav.')) this.usesNav = true;
      return def;
    }
    if (!this.hasVar(s.var)) this.err(path, `unknown run variable '${s.var}'`);
    return undefined;
  }

  private lintRef(path: string, r: Ref): void {
    if (typeof r === 'number') { if (!Number.isFinite(r)) this.err(path, 'not a finite number'); return; }
    if (r === null || typeof r !== 'object') { this.err(path, 'not a value reference'); return; }
    if (r.add !== undefined && !Number.isFinite(r.add)) this.err(path, 'add must be finite');
    if ('var' in r) { if (!this.hasVar(r.var)) this.err(path, `unknown run variable '${r.var}' (not in lesson vars or any capture step)`); }
    else if ('vspeed' in r) { for (const a of this.aircraft) if (!isFiniteNum(a.vspeeds[r.vspeed])) this.err(path, `V-speed '${r.vspeed}' is not defined for ${a.id}`); }
    else if ('setting' in r) { for (const a of this.aircraft) if (!isFiniteNum(a.settings[r.setting])) this.err(path, `setting '${r.setting}' is not defined for ${a.id}`); }
    else if ('field' in r) { if (r.field !== 'elevFt') this.err(path, `unknown field value '${r.field}'`); }
    else if ('sig' in r) this.lintSigRef(path, r.sig);
    else this.err(path, 'unknown value reference');
  }

  private lintTol(path: string, t: TolRef): void {
    if (typeof t === 'string') { if (!(t in TOL_KEYS)) this.err(path, `unknown tolerance key '${t}'`); }
    else if (typeof t === 'number') { if (!(t > 0) || !Number.isFinite(t)) this.err(path, 'a literal tolerance must be a positive number'); }
    else if ('key' in t) {
      if (!(t.key in TOL_KEYS)) this.err(path, `unknown tolerance key '${t.key}'`);
      if (!(t.scale > 0)) this.err(path, 'scale must be positive');
    } else if (!isFiniteNum(t.minus) || !isFiniteNum(t.plus) || t.minus < 0 || t.plus < 0) this.err(path, 'a band needs finite minus and plus >= 0');
    else if (t.minus === 0 && t.plus === 0) this.err(path, 'a band of zero width');
  }

  /**
   * A cue: the line exists, inline lines are well formed, and every template name resolves here. Lines from
   * the table are checked for length and syntax once, by validateLines.
   */
  /** `extraVars`: template names the speaker supplies besides the cue's own vars (the coach's remark vars). */
  private lintCue(path: string, c: CueRef, longForm = false, extraVars: readonly string[] = []): void {
    let line: InlineCue | undefined;
    let cueVars: string[] = [];
    let id: string | null = null;
    if (typeof c === 'string') id = c;
    else if ('id' in c) {
      id = c.id;
      cueVars = Object.keys(c.vars);
      for (const [k, r] of Object.entries(c.vars)) this.lintRef(`${path}.vars.${k}`, r);
    } else {
      line = c;
      for (const issue of lintLine(c, { longForm })) this.err(path, issue);
    }
    if (id !== null) {
      line = this.ctx.lines[id];
      if (!line) { this.err(path, `unknown cue id '${id}'`); return; }
    }
    if (!line) return;
    if (line.actor !== undefined && !(line.actor in ACTORS)) this.err(path, `unknown actor '${line.actor}'`);
    const names = new Set([...cueVars, ...extraVars]);
    for (const text of [...asArray(line.text), ...(line.speak !== undefined ? asArray(line.speak) : [])]) {
      for (const m of text.matchAll(TEMPLATE_RE)) {
        const name = m[1].trim();
        if (!names.has(name) && !this.templateNameResolves(name)) this.err(path, `template {${m[0].slice(1, -1)}} in '${id ?? 'inline'}': '${name}' is not a cue var, run variable, signal, vspeed.*, setting.* or tol.*`);
      }
    }
  }

  private templateNameResolves(name: string): boolean {
    if (this.hasVar(name) || this.signals.has(name)) return true;
    const dot = name.indexOf('.');
    if (dot < 0) return false;
    const [ns, key] = [name.slice(0, dot), name.slice(dot + 1)];
    if (ns === 'vspeed') return this.aircraft.every((a) => isFiniteNum(a.vspeeds[key as keyof typeof a.vspeeds]));
    if (ns === 'setting') return this.aircraft.every((a) => isFiniteNum(a.settings[key as keyof typeof a.settings]));
    if (ns === 'tol') return key in TOL_KEYS;
    return false;
  }

  // ---- whole-lesson checks ------------------------------------------------------------------------------------

  /** Every graded exercise is fed by a task (or a checklist step), and every required one can be graded. */
  private lintFeeding(): void {
    const fedBy = new Map<string, { tasks: TaskStep[]; checklists: number }>();
    for (const p of this.lesson.flow) {
      for (const s of p.steps) {
        const ex = s.kind === 'task' ? s.exercise : s.kind === 'checklist' ? s.exercise : undefined;
        if (!ex) continue;
        const f = fedBy.get(ex) ?? { tasks: [], checklists: 0 };
        if (s.kind === 'task') f.tasks.push(s); else f.checklists++;
        fedBy.set(ex, f);
      }
    }
    for (const [i, e] of this.lesson.exercises.entries()) {
      const f = fedBy.get(e.id);
      if (e.mode === 'demo') continue;
      if (!f) { this.err(`exercises[${i}]`, `exercise '${e.id}' is not scored by any task or checklist`); continue; }
      if (e.required && f.checklists === 0 && !f.tasks.some((t) => t.criteria.some((c) => c.required))) {
        this.err(`exercises[${i}]`, `required exercise '${e.id}' has no required criterion in any of its tasks`);
      }
    }
  }

  /**
   * Phases are entered from the first, by falling through from a phase that does not end the lesson or jump
   * unconditionally, or by a goto into one of their steps.
   */
  private lintReachability(): void {
    const flow = this.lesson.flow;
    const phaseIndex = new Map(flow.map((p, i) => [p.id, i]));
    const targetPhase = (t: string): number | undefined => (t.startsWith('phase:') ? phaseIndex.get(t.slice(6)) : this.stepIds.get(t));
    const reached = new Set<number>();
    const queue = [0];
    while (queue.length) {
      const i = queue.pop()!;
      if (reached.has(i) || i >= flow.length) continue;
      reached.add(i);
      let fallsThrough = true;
      for (const [si, s] of flow[i].steps.entries()) {
        const targets: string[] = [];
        const outcome = (o: Outcome | undefined): void => { if (o && typeof o === 'object' && 'goto' in o) targets.push(o.goto); };
        outcome(s.onTimeout);
        if (s.kind === 'task') { outcome(s.onSuccess?.next); outcome(s.onFail?.next); for (const h of s.on ?? []) targets.push(h.goto); }
        if (s.kind === 'branch') targets.push(...s.cases.map((c) => c.goto), s.else);
        for (const t of targets) { const j = targetPhase(t); if (j !== undefined) queue.push(j); }
        const terminal = (s.kind === 'end' && !s.when) || s.kind === 'branch';
        if (terminal) {
          fallsThrough = false;
          if (si < flow[i].steps.length - 1) this.warn(`flow.${flow[i].id}.${s.id}`, 'steps after this step are never reached in order');
          break;
        }
      }
      if (fallsThrough) queue.push(i + 1);
    }
    for (const [i, p] of flow.entries()) if (!reached.has(i)) this.err(`flow.${p.id}`, `phase '${p.id}' is unreachable`);
  }

  private lintDebriefTips(): void {
    for (const key of Object.keys(this.lesson.debriefTips ?? {})) {
      const dot = key.lastIndexOf('.');
      const [id, pattern] = [key.slice(0, dot), key.slice(dot + 1)];
      const c = this.criterionIds.get(id);
      if (dot < 0 || !c) { this.err(`debriefTips.${key}`, `no criterion '${id}' in the lesson`); continue; }
      if (!(pattern in PATTERNS)) this.err(`debriefTips.${key}`, `unknown pattern '${pattern}'`);
      else if (c.kind !== 'hold') this.warn(`debriefTips.${key}`, `patterns are only diagnosed for hold criteria; '${id}' is ${c.kind}`);
    }
  }
}

// ---- lines --------------------------------------------------------------------------------------------------

/**
 * Problems with one line (as messages): variant counts, the 20-word limit (per sentence for long-form lines,
 * the briefing summaries), template syntax and formats, priorities and timings.
 */
export function lintLine(line: InlineCue, opts: { longForm: boolean }): string[] {
  const out: string[] = [];
  const texts = asArray(line.text);
  if (texts.length === 0) out.push('a line needs at least one variant');
  if (texts.length > 3) out.push(`${texts.length} variants (1-3 per line)`);
  if (Array.isArray(line.speak) && line.speak.length !== texts.length) out.push(`${line.speak.length} speak variants for ${texts.length} text variants`);
  for (const t of [...texts, ...(line.speak !== undefined ? asArray(line.speak) : [])]) {
    if (!t.trim()) { out.push('an empty variant'); continue; }
    const units = opts.longForm ? sentences(t) : [t];
    for (const u of units) {
      const n = countWords(u);
      if (n > MAX_LINE_WORDS) out.push(`${n} words (max ${MAX_LINE_WORDS}${opts.longForm ? ' per sentence' : ''}): "${u.slice(0, 50)}..."`);
    }
    const stripped = t.replace(TEMPLATE_RE, '');
    if (/[{}]/.test(stripped)) out.push(`malformed template in "${t.slice(0, 50)}"`);
    for (const m of t.matchAll(TEMPLATE_RE)) {
      const fmt = m[2]?.trim();
      if (fmt !== undefined && !FORMATS.has(fmt)) out.push(`unknown template format '${fmt}' in {${m[1]}:${fmt}}`);
    }
  }
  if (line.priority !== undefined && ![0, 1, 2, 3].includes(line.priority)) out.push(`unknown priority ${line.priority}`);
  if (line.ttlS !== undefined && !(line.ttlS > 0)) out.push('ttlS must be positive');
  if (line.cooldownS !== undefined && !(line.cooldownS >= 0)) out.push('cooldownS must be >= 0');
  if (line.channel !== undefined && line.channel !== 'cabin' && line.channel !== 'radio') out.push(`unknown channel '${line.channel}'`);
  return out;
}

/**
 * The whole line table. `longForm` ids (briefing summaries) are checked per sentence. Lines in the engine
 * namespace ('runner.*' overrides) are spoken by the runner, never named by a lesson, so their template names
 * are checked here: ENGINE_TEMPLATE_NAMES, a signal, vspeed.*, setting.* or tol.*.
 */
export function validateLines(lines: LineTable, longForm: ReadonlySet<string> = new Set(), signals: readonly SignalDef[] = []): LintIssue[] {
  const out: LintIssue[] = [];
  const sigIds = new Set<string>(signals.map((d) => d.id));
  const engineNames = new Set(ENGINE_TEMPLATE_NAMES);
  const push = (path: string, message: string): void => { out.push({ lessonId: '(lines)', path, message, severity: 'error' }); };
  for (const [id, line] of Object.entries(lines)) {
    for (const m of lintLine(line, { longForm: longForm.has(id) })) push(id, m);
    if (line.actor !== undefined && !(line.actor in ACTORS)) push(id, `unknown actor '${line.actor}'`);
    if (!ENGINE_NAMESPACES.some((ns) => id.startsWith(ns))) continue;
    for (const t of [...asArray(line.text), ...(line.speak !== undefined ? asArray(line.speak) : [])]) {
      for (const m of t.matchAll(TEMPLATE_RE)) {
        const name = m[1].trim();
        const ok = engineNames.has(name) || sigIds.has(name) || /^(vspeed|setting|tol)\./.test(name);
        if (!ok) push(id, `engine line template '${name}' is not an engine-supplied name or a signal`);
      }
    }
  }
  return out;
}

// ---- entry points -------------------------------------------------------------------------------------------

export function validateLesson(lesson: Lesson, ctx: LintContext): LintIssue[] {
  return new LessonLinter(lesson, ctx).run();
}

/**
 * Every lesson plus cross-lesson rules: unique ids, prerequisites that exist and are acyclic, and the line
 * table (word limits, templates, formats), with briefing summaries checked per sentence.
 */
export function validateSyllabus(lessons: readonly Lesson[], ctx: LintContext): LintIssue[] {
  const out: LintIssue[] = [];
  const byId = new Map<string, Lesson>();
  for (const l of lessons) {
    if (byId.has(l.id)) out.push({ lessonId: l.id, path: 'id', message: `duplicate lesson id '${l.id}'`, severity: 'error' });
    byId.set(l.id, l);
  }
  for (const l of lessons) {
    out.push(...validateLesson(l, ctx));
    for (const r of l.requires) {
      if (r === l.id) out.push({ lessonId: l.id, path: 'requires', message: 'a lesson cannot require itself', severity: 'error' });
      else if (!byId.has(r)) out.push({ lessonId: l.id, path: 'requires', message: `unknown prerequisite '${r}'`, severity: 'error' });
    }
  }
  // Prerequisite cycles: depth-first search with an on-stack marker.
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string, chain: string[]): void => {
    const s = state.get(id);
    if (s === 'done') return;
    if (s === 'open') {
      out.push({ lessonId: id, path: 'requires', message: `prerequisite cycle: ${[...chain.slice(chain.indexOf(id)), id].join(' -> ')}`, severity: 'error' });
      return;
    }
    state.set(id, 'open');
    for (const r of byId.get(id)?.requires ?? []) if (byId.has(r)) visit(r, [...chain, id]);
    state.set(id, 'done');
  };
  for (const l of lessons) visit(l.id, []);
  // Lines spoken as briefing summaries may run to several sentences (section 2.6).
  const longForm = new Set<string>();
  for (const l of lessons) {
    const s = l.briefing.spoken;
    if (typeof s === 'string') longForm.add(s);
    else if ('id' in s) longForm.add(s.id);
  }
  out.push(...validateLines(ctx.lines, longForm, ctx.signals));
  return out;
}
