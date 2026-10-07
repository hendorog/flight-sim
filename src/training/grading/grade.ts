// The grader (section 3.4): per task attempt it samples the task's criteria, closes them into
// CriterionResults at task exit, and aggregates exercise grades by minimum over required criteria, with
// fault caps, safety criteria and interventions. Pure: it is fed an EvalContext and bus records.
//
// Lifecycle (driven by the runner): beginPhaseRun on every phase entry; beginTask on task entry; sample once
// per frame while the task runs and the student has control; onEvent for every bus record during the task;
// endTask (or abortTask) on exit. Checklist steps that score an exercise close their rows with addResult.
//
// Attempts (section 3.4: "minimum over its required criteria across the task steps that scored it in the
// attempt"): an attempt of an exercise is everything that scored it during one run of a phase, so an assessed
// circuit is graded on all its legs, not its best one. A step flown again within the run (a `retry` outcome,
// or "show me" then try again) replaces its own earlier rows: the instructor repeats a task to see it flown
// (in check and test lessons the first flight stands instead).
// A new run of the phase (a repeat, Shift+R, the next phase) starts a new attempt; the best attempt counts
// (the first in check and test lessons). After a reload the attempt in progress is closed: the resumed
// phase starts a new one.
//
// Aggregation choices where section 3.4 leaves room (see also the module report):
//   - Passed pass/fail criteria (check, binary and the pass/fail items of the composite graders) are gates:
//     they never lower a measured grade; a capped gate (grade 2) caps, a failed one (1) fails. An exercise
//     made only of gates grades 3 when they all pass (the spec's "check: 3").
//   - A criterion without enough data is flagged `insufficient`; a required one makes the attempt ungraded.

import { compile } from '../engine/predicates';
import { resolveRef, resolveTol } from '../engine/refs';
import type {
  AuthorityId, CompiledPred, Criterion, CriterionResult, EvalContext, ExerciseDef, ExerciseResult, FaultRecord,
  Grade, LandingData, SignalId, Standard, TaskStep, Tol, ToleranceTable, TraceBand, TrainingEventRecord,
} from '../types';
import { HoldAccumulator, normalisedError, wrap180 } from './accumulators';
import { compositeKind } from './criteria';
import { gradeLanding } from './landing';
import { diagnose } from './patterns';
import { holdResult, insufficientResult, isInsufficient, passFailResult, sampleResult } from './rules';
import { StallGrader } from './stall';
import { UnusualAttitudeGrader } from './unusual';

export { gradeHold, gradeSample, isInsufficient, type GradedCriterion } from './rules';

export interface GraderOptions {
  standards: ToleranceTable;
  authority: AuthorityId;
  exercises: readonly ExerciseDef[];
  /** Check and test lessons: the first flight of each item counts, not the best (section 3.4). */
  firstAttemptCounts: boolean;
}

/** Default settle time of a hold criterion, s (section 3.3). Peaks sample from task entry unless set. */
export const DEFAULT_SETTLE_S = 8;

const ZERO_TOL: Tol = { minus: 0, plus: 0 };

/** A numeric reading of a frame value; booleans read 1/0 and anything else NaN. */
function reading(v: unknown): number {
  return typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : NaN;
}

type Base = { c: Criterion; active: CompiledPred | null };
type HoldSt = Base & {
  kind: 'hold'; sig: SignalId; angle: boolean; settleS: number; acc: HoldAccumulator; tol: Tol; testTol: Tol;
  target: number | null; band: TraceBand | null;
};
type PeakSt = Base & {
  kind: 'peak'; sig: SignalId; angle: boolean; settleS: number; tol: Tol; testTol: Tol; target: number;
  max: { e: number; value: number; atS: number } | null; min: { e: number; value: number; atS: number } | null;
  band: TraceBand | null;
};
type FinalSt = Base & { kind: 'final'; sig: SignalId; angle: boolean; tol: Tol; testTol: Tol };
type AtEventSt = Base & { kind: 'atEvent'; angle: boolean; tol: Tol; testTol: Tol; row: CriterionResult | null };
type CheckSt = Base & { kind: 'check'; pred: CompiledPred; done: boolean; doneAtS: number | null };
type BinarySt = Base & { kind: 'binary'; pred: CompiledPred; failed: boolean; failedAtS: number | null };
type LandingSt = Base & { kind: 'landing'; vrefKt: number; zone: 'touchdownZoneFt' | 'touchdownZoneShortFt'; standard: Standard; rows: CriterionResult[] | null };
type StallSt = Base & { kind: 'stall'; g: StallGrader };
type UnusualSt = Base & { kind: 'unusual'; g: UnusualAttitudeGrader };
type CritSt = HoldSt | PeakSt | FinalSt | AtEventSt | CheckSt | BinarySt | LandingSt | StallSt | UnusualSt;

interface OpenTask {
  step: TaskStep; def: ExerciseDef; states: CritSt[];
  faults: FaultRecord[]; interventions: number; startS: number; bands: TraceBand[];
}

/** What one step contributed to an attempt. */
interface Part { criteria: CriterionResult[]; faults: FaultRecord[]; interventions: number }
/** The attempt being built for an exercise in a phase run: its parts by step. */
interface Building { run: number; parts: Map<string, Part> }

export class Grader {
  private readonly opts: GraderOptions;
  private readonly defs = new Map<string, ExerciseDef>();
  private open: OpenTask | null = null;
  private closedAttempts: Record<string, ExerciseResult[]> = {};
  /** Faults named for an exercise that had no open attempt: attached to its next closed attempt. */
  private pendingFaults: Record<string, FaultRecord[]> = {};
  /** Faults outside any exercise (lesson level: the skill test's critical-fault rule reads these). */
  private readonly lessonLevelFaults: FaultRecord[] = [];
  /** Exercises whose next attempt replaces the first in check/test lessons (the examiner's one repeat). */
  private readonly repeatAllowed = new Set<string>();
  private bands: TraceBand[] = [];
  /** Phase-run counter (beginPhaseRun) and the attempt being built per exercise in the current run. */
  private phaseRun = 0;
  private building = new Map<string, Building>();
  /** Lesson-limit interventions by exercise (TaskLimit ids, in order): cap the exercise at grade 3. */
  private limitHits = new Map<string, string[]>();
  /** Attempts discarded by a limit intervention (the task restarted), by exercise: they still count as attempts. */
  private limitDiscarded = new Map<string, number>();

  constructor(opts: GraderOptions) {
    this.opts = opts;
    for (const e of opts.exercises) this.defs.set(e.id, e);
  }

  /** The open task's exercise id (null between tasks). */
  get openExercise(): string | null {
    return this.open?.def.id ?? null;
  }

  /** A phase is entered (first time, repeat, retry or resume): what scores from now on is a new attempt. */
  beginPhaseRun(): void {
    this.phaseRun++;
    this.building.clear();
  }

  /** Task entry: compile the criteria for this task (targets are resolved per sample). */
  beginTask(step: TaskStep, ctx: EvalContext): void {
    if (this.open) this.abortTask();
    const def = this.defOf(step.exercise, ctx.standard);
    const standard = def.standard;
    const states = step.criteria.map((c) => this.makeState(c, standard, ctx));
    const faults = this.pendingFaults[def.id] ?? [];
    delete this.pendingFaults[def.id];
    this.open = { step, def, states, faults: [...faults], interventions: 0, startS: ctx.simT, bands: [] };
  }

  private defOf(id: string, standard: Standard): ExerciseDef {
    return this.defs.get(id) ?? { id, title: id, skill: 'airmanship', mode: 'practice', standard, required: false, weight: 0 };
  }

  private makeState(c: Criterion, standard: Standard, ctx: EvalContext): CritSt {
    const active = c.activeWhen ? compile(c.activeWhen) : null;
    const tols = (): { tol: Tol; testTol: Tol } => (c.tol === undefined
      ? { tol: ZERO_TOL, testTol: ZERO_TOL }
      : { tol: resolveTol(c.tol, ctx, standard), testTol: resolveTol(c.tol, ctx, 'test') });
    const isAngle = (sig: SignalId | undefined): boolean => sig !== undefined && ctx.signalDef(sig)?.kind === 'angle';
    const composite = compositeKind(c);
    if (composite === 'landing') {
      const zone = c.tol === 'touchdownZoneShortFt' ? 'touchdownZoneShortFt' : 'touchdownZoneFt';
      return { kind: 'landing', c, active, vrefKt: resolveRef(c.target ?? { vspeed: 'Vref' }, ctx), zone, standard, rows: null };
    }
    if (composite === 'stall' || composite === 'stallIncipient') {
      const t = c.tol === undefined
        ? { tol: ctx.standards[ctx.authority][standard].stallHeightLossFt, testTol: ctx.standards[ctx.authority].test.stallHeightLossFt }
        : tols();
      return { kind: 'stall', c, active, g: new StallGrader({ ...t, standard, incipient: composite === 'stallIncipient', idPrefix: c.id, required: c.required }) };
    }
    if (composite === 'unusualAttitude') {
      return { kind: 'unusual', c, active, g: new UnusualAttitudeGrader({ kind: null, aircraft: ctx.aircraft, standard, idPrefix: c.id, required: c.required }) };
    }
    switch (c.kind) {
      case 'hold': {
        const { tol, testTol } = tols();
        const sig = c.sig as SignalId;
        const angle = isAngle(sig);
        const acc = new HoldAccumulator(tol, testTol, angle);
        acc.targetChanged(ctx.simT);   // `late` is measured from task entry
        return { kind: 'hold', c, active, sig, angle, settleS: c.settleS ?? DEFAULT_SETTLE_S, acc, tol, testTol, target: null, band: null };
      }
      case 'peak': {
        const { tol, testTol } = tols();
        const sig = c.sig as SignalId;
        return { kind: 'peak', c, active, sig, angle: isAngle(sig), settleS: c.settleS ?? 0, tol, testTol, target: NaN, max: null, min: null, band: null };
      }
      case 'final': {
        const sig = c.sig as SignalId;
        return { kind: 'final', c, active, sig, angle: isAngle(sig), ...tols() };
      }
      case 'atEvent':
        return { kind: 'atEvent', c, active, angle: isAngle(c.sig), ...tols(), row: null };
      case 'check':
        return { kind: 'check', c, active, pred: compile(c.pred ?? { const: false }), done: false, doneAtS: null };
      case 'binary':
        return { kind: 'binary', c, active, pred: compile(c.failIf ?? { const: false }), failed: false, failedAtS: null };
    }
  }

  /** Once per frame while the task is active. The runner calls it only while the student has control. */
  sample(ctx: EvalContext): void {
    const t = this.open;
    if (!t || !(ctx.dt > 0)) return;
    for (const s of t.states) {
      // activeWhen is evaluated every frame so its own timers stay right, then gates the sampling.
      const active = s.active ? s.active.eval(ctx) : true;
      switch (s.kind) {
        case 'check':
          if (s.pred.eval(ctx) && active && !s.done && (s.c.withinS === undefined || ctx.stepT <= s.c.withinS)) {
            s.done = true;
            s.doneAtS = ctx.simT;
          }
          break;
        case 'binary':
          if (s.pred.eval(ctx) && active && !s.failed) {
            s.failed = true;
            s.failedAtS = ctx.simT;
          }
          break;
        case 'hold':
          if (active && ctx.stepT >= s.settleS) this.sampleHold(s, ctx, t);
          break;
        case 'peak':
          if (active && ctx.stepT >= s.settleS) this.samplePeak(s, ctx, t);
          break;
        case 'stall':
          if (active) s.g.update(ctx.frame, ctx.simT, ctx.dt);
          break;
        case 'unusual':
          if (active) s.g.update(ctx.frame, ctx.simT, ctx.dt);
          break;
        default:
          break;
      }
    }
  }

  private sampleHold(s: HoldSt, ctx: EvalContext, t: OpenTask): void {
    const x = reading(ctx.frame[s.sig]);
    const target = resolveRef(s.c.target ?? 0, ctx);
    if (!Number.isFinite(x) || !Number.isFinite(target)) return;
    if (s.target !== null && Math.abs(target - s.target) > 1e-6) {
      s.acc.targetChanged(ctx.simT);
      this.closeBand(s, t);
    }
    s.target = target;
    s.acc.add(x, target, ctx.simT, ctx.dt);
    this.extendBand(s, ctx, t, target);
  }

  private samplePeak(s: PeakSt, ctx: EvalContext, t: OpenTask): void {
    const x = reading(ctx.frame[s.sig]);
    const target = resolveRef(s.c.target ?? 0, ctx);
    if (!Number.isFinite(x) || !Number.isFinite(target)) return;
    if (Number.isFinite(s.target) && Math.abs(target - s.target) > 1e-6) this.closeBand(s, t);
    s.target = target;
    const e = s.angle ? wrap180(x - target) : x - target;
    if (!s.max || e > s.max.e) s.max = { e, value: x, atS: ctx.simT };
    if (!s.min || e < s.min.e) s.min = { e, value: x, atS: ctx.simT };
    this.extendBand(s, ctx, t, target);
  }

  private extendBand(s: HoldSt | PeakSt, ctx: EvalContext, t: OpenTask, target: number): void {
    if (!(s.c.chart ?? s.kind === 'hold')) return;
    if (!s.band) s.band = { sig: s.sig, fromS: ctx.simT, toS: ctx.simT, target, minus: s.tol.minus, plus: s.tol.plus, taskId: t.step.id };
    s.band.toS = ctx.simT;
  }

  private closeBand(s: HoldSt | PeakSt, t: OpenTask): void {
    if (s.band && s.band.toS > s.band.fromS) t.bands.push(s.band);
    s.band = null;
  }

  /** Bus events (atEvent criteria, landing / stall / unusual-attitude graders). */
  onEvent(r: TrainingEventRecord, ctx: EvalContext): void {
    const t = this.open;
    if (!t) return;
    for (const s of t.states) {
      if (s.kind === 'stall') {
        s.g.onEvent(r);
      } else if (s.kind === 'landing') {
        if (r.type === 'landing' && !s.rows) {
          s.rows = gradeLanding(r.data as LandingData, {
            standards: this.opts.standards, authority: this.opts.authority, standard: s.standard,
            vrefKt: s.vrefKt, zone: s.zone, idPrefix: s.c.id, required: s.c.required,
          });
        }
      } else if (s.kind === 'atEvent' && !s.row && r.type === s.c.event) {
        s.row = this.eventRow(s, r, ctx, t.def.standard);
      }
    }
  }

  private eventRow(s: AtEventSt, r: TrainingEventRecord, ctx: EvalContext, standard: Standard): CriterionResult {
    const c = s.c;
    const raw = c.field !== undefined ? (r.data as Record<string, unknown>)[c.field] : c.sig !== undefined ? ctx.frame[c.sig] : undefined;
    const x = reading(raw);
    const target = resolveRef(c.target ?? 0, ctx);
    if (!Number.isFinite(x) || !Number.isFinite(target)) return insufficientResult(head(c), `No value at the ${c.event} event`);
    const dev = s.angle ? wrap180(x - target) : x - target;
    return sampleResult(head(c), x, target, dev, s.tol, s.testTol, standard, { atS: r.simT, sig: c.sig, what: `At ${eventWords(c.event)}` });
  }

  /**
   * Task exit: close the task's rows (final criteria sample now) into its attempt and return the attempt.
   * The criteria grade what was flown however the task ended, except after a crash ('crash'): a pass/fail
   * item that was never broken proves nothing then (the flight ended before it could be), nor does the value
   * at the end of the task, so those are left ungraded, and a landing that never happened is a crash (section 3.4: "A crash ends the landing as grade 1").
   */
  endTask(result: 'success' | 'fail' | 'timeout' | 'crash', ctx: EvalContext): ExerciseResult {
    const t = this.open;
    if (!t) throw new Error('Grader.endTask without an open task');
    const rows: CriterionResult[] = [];
    for (const s of t.states) rows.push(...(result === 'crash' ? this.closeCrashed(s, ctx, t) : this.close(s, ctx, t)));
    for (const s of t.states) if (s.kind === 'hold' || s.kind === 'peak') this.closeBand(s, t);
    this.bands.push(...t.bands);
    this.open = null;
    return this.store(t.def, `task:${t.step.id}`, { criteria: rows, faults: t.faults, interventions: t.interventions });
  }

  private close(s: CritSt, ctx: EvalContext, t: OpenTask): CriterionResult[] {
    const c = s.c;
    const standard = t.def.standard;
    switch (s.kind) {
      case 'hold': {
        const sum = s.acc.summary();
        return [holdResult(head(c), sum, s.acc.testSummary(), s.target ?? NaN, s.tol, s.testTol, standard,
          diagnose(sum, s.tol, s.settleS), s.sig)];
      }
      case 'peak': {
        if (!s.max || !s.min) return [{ ...insufficientResult(head(c), 'Never sampled'), tol: s.tol, testTol: s.testTol }];
        const peakOf = c.peakOf ?? 'abs';
        let pick: { e: number; value: number; atS: number };
        if (peakOf === 'max') pick = s.max.e > 0 ? s.max : { ...s.max, e: 0 };
        else if (peakOf === 'min') pick = s.min.e < 0 ? s.min : { ...s.min, e: 0 };
        else pick = normalisedError(s.max.e, s.tol) >= normalisedError(s.min.e, s.tol) ? s.max : s.min;
        // The test-standard grade of an 'abs' peak takes the worse side against the test band.
        const testDev = peakOf === 'abs'
          ? (normalisedError(s.max.e, s.testTol) >= normalisedError(s.min.e, s.testTol) ? s.max.e : s.min.e)
          : pick.e;
        const row = sampleResult(head(c), pick.value, s.target, pick.e, s.tol, s.testTol, standard,
          { atS: pick.atS, sig: s.sig, peakOf, what: peakOf === 'abs' ? 'Worst' : peakOf === 'max' ? 'Highest' : 'Lowest' });
        return [{ ...row, testGrade: sampleResult(head(c), pick.value, s.target, testDev, s.testTol, s.testTol, 'test').grade }];
      }
      case 'final': {
        const x = reading(ctx.frame[s.sig]);
        const target = resolveRef(c.target ?? 0, ctx);
        if (!Number.isFinite(x) || !Number.isFinite(target)) return [insufficientResult(head(c), 'No value at the end of the task')];
        const dev = s.angle ? wrap180(x - target) : x - target;
        return [sampleResult(head(c), x, target, dev, s.tol, s.testTol, standard, { atS: ctx.simT, sig: s.sig, what: 'At the end' })];
      }
      case 'atEvent':
        return [s.row ?? insufficientResult(head(c), `No ${eventWords(c.event)} during the task`)];
      case 'check':
        return [passFailResult(head(c), s.done, s.done
          ? `Done${s.doneAtS !== null ? ` at ${Math.round(s.doneAtS - t.startS)} s` : ''}`
          : c.withinS !== undefined ? `Not done within ${c.withinS} s` : 'Not done')];
      case 'binary':
        return [passFailResult(head(c), !s.failed, s.failed ? `Failed at ${Math.round((s.failedAtS ?? t.startS) - t.startS)} s` : 'Never broken')];
      case 'landing':
        return s.rows ?? [insufficientResult(head(c), 'No landing during the task')];
      case 'stall':
        return s.g.close() ?? [insufficientResult(head(c), 'No stall during the task')];
      case 'unusual':
        return s.g.close() ?? [insufficientResult(head(c), 'The recovery was not flown')];
    }
  }

  /**
   * Add a step's rows to the exercise's attempt in this phase run (replacing that step's earlier rows) and
   * re-grade the attempt over all of them. Returns the attempt as it now stands.
   */
  /** close() after a crash: see endTask. */
  private closeCrashed(s: CritSt, ctx: EvalContext, t: OpenTask): CriterionResult[] {
    // A never-broken binary and the value at the end of the task say nothing about a flight cut short.
    if ((s.kind === 'binary' && !s.failed) || s.kind === 'final') return [insufficientResult(head(s.c), 'Not judged: the flight ended in a crash')];
    if (s.kind === 'landing' && !s.rows) {
      return [passFailResult({ ...head(s.c), safety: true }, false, 'The approach ended in a crash')];
    }
    return this.close(s, ctx, t);
  }

  private store(def: ExerciseDef, key: string, part: Part): ExerciseResult {
    const list = (this.closedAttempts[def.id] ??= []);
    let b = this.building.get(def.id);
    const extend = b !== undefined && b.run === this.phaseRun && list.length > 0;
    if (!extend) {
      b = { run: this.phaseRun, parts: new Map() };
      this.building.set(def.id, b);
    }
    // A step flown again in the run replaces its earlier try, except in check and test lessons, where the
    // first flight of each item counts.
    if (!(this.opts.firstAttemptCounts && b!.parts.has(key))) {
      b!.parts.set(key, { criteria: [...part.criteria], faults: [...part.faults], interventions: part.interventions });
    }
    const parts = [...b!.parts.values()];
    const criteria = parts.flatMap((p) => p.criteria);
    const faults = parts.flatMap((p) => p.faults);
    const interventions = parts.reduce((n, p) => n + p.interventions, 0);
    // Safety rows are listed first (section 2.10).
    const ordered = [...criteria.filter((c) => c.safety), ...criteria.filter((c) => !c.safety)];
    const intervened = interventions > 0;
    const r: ExerciseResult = {
      exerciseId: def.id, title: def.title, mode: def.mode, standard: def.standard,
      grade: aggregateExercise(ordered, faults, intervened, def, 'grade'),
      testGrade: aggregateExercise(ordered, faults, intervened, def, 'testGrade'),
      criteria: ordered, attempts: extend ? list.length : list.length + 1, interventions, faults,
    };
    this.applyLimits(r);
    if (extend) list[list.length - 1] = r;
    else list.push(r);
    return r;
  }

  /** Lesson-limit interventions on the exercise: recorded on the result and no grade 4 (spec: limit intervention). */
  private applyLimits(r: ExerciseResult): void {
    const ids = this.limitHits.get(r.exerciseId);
    if (!ids?.length) return;
    r.limitInterventions = ids.length;
    r.limitIds = [...ids];
    if (r.grade === 4) r.grade = 3;
    if (r.testGrade === 4) r.testGrade = 3;
  }

  /**
   * A lesson-limit intervention (TaskLimit) on an exercise: the instructor took control, restored straight and
   * level and handed back. Not a safety intervention: it never fails the exercise, but it prevents a grade 4.
   * Attempts already closed for the exercise are capped too. `discarded`: the open attempt was dropped
   * (abortTask) because the task restarts; it still counts as an attempt in exerciseResults().
   */
  recordLimitIntervention(exerciseId: string, limitId: string, discarded = true): void {
    if (discarded) this.limitDiscarded.set(exerciseId, (this.limitDiscarded.get(exerciseId) ?? 0) + 1);
    const ids = this.limitHits.get(exerciseId) ?? [];
    ids.push(limitId);
    this.limitHits.set(exerciseId, ids);
    for (const r of this.closedAttempts[exerciseId] ?? []) this.applyLimits(r);
  }

  /** Lesson-limit interventions recorded so far (all exercises). */
  get limitInterventions(): number {
    let n = 0;
    for (const ids of this.limitHits.values()) n += ids.length;
    return n;
  }

  /**
   * Close an attempt from rows graded elsewhere (a checklist step that scores an exercise, section 3.5).
   * Faults pending for the exercise are attached.
   */
  addResult(exerciseId: string, criteria: CriterionResult[], standard: Standard = 'training', stepId = exerciseId): ExerciseResult {
    const def = this.defOf(exerciseId, standard);
    const faults = this.pendingFaults[exerciseId] ?? [];
    delete this.pendingFaults[exerciseId];
    return this.store(def, `checklist:${stepId}`, { criteria, faults, interventions: 0 });
  }

  /** Discard the open attempt without a result (checkpoint retry, reload: "trace interrupted"). */
  abortTask(): void {
    this.open = null;
  }

  /**
   * A fault. `exerciseId` null: the open task's exercise, or the lesson level when no task is open. A fault
   * named for another exercise waits for that exercise's next attempt.
   */
  recordFault(f: FaultRecord, exerciseId: string | null): void {
    const t = this.open;
    if (t && (exerciseId === null || exerciseId === t.def.id)) t.faults.push(f);
    else if (exerciseId === null) this.lessonLevelFaults.push(f);
    else (this.pendingFaults[exerciseId] ??= []).push(f);
  }

  /**
   * A fault between tasks, charged to the exercise last flown (global fault rules: the student is still flying
   * it). With a task of that exercise open it goes there; else onto its latest attempt, which is re-graded (and
   * kept by the attempt being built, so a later step of the same run still carries it); with no attempt yet it
   * waits for the next one.
   */
  recordFaultOnLatest(f: FaultRecord, exerciseId: string): void {
    const t = this.open;
    if (t && t.def.id === exerciseId) {
      t.faults.push(f);
      return;
    }
    const list = this.closedAttempts[exerciseId];
    const r = list?.at(-1);
    if (!r) {
      (this.pendingFaults[exerciseId] ??= []).push(f);
      return;
    }
    const b = this.building.get(exerciseId);
    const lastPart = b && b.run === this.phaseRun ? [...b.parts.values()].at(-1) : undefined;
    lastPart?.faults.push(f);
    r.faults = [...r.faults, f];
    const def = this.defs.get(exerciseId) ?? this.defOf(exerciseId, r.standard);
    r.grade = aggregateExercise(r.criteria, r.faults, r.interventions > 0, def, 'grade');
    r.testGrade = aggregateExercise(r.criteria, r.faults, r.interventions > 0, def, 'testGrade');
    this.applyLimits(r);
  }

  /** Faults recorded outside any exercise. */
  lessonFaults(): readonly FaultRecord[] {
    return this.lessonLevelFaults;
  }

  /** An intervention during the open task (an assessed exercise then grades 1). */
  recordIntervention(): void {
    if (this.open) this.open.interventions++;
  }

  /** Check/test lessons: the examiner allows one repeat; the next attempt of this exercise counts instead. */
  allowRepeat(exerciseId: string): void {
    this.repeatAllowed.add(exerciseId);
  }

  /** Counting grade of an exercise so far in this run (best attempt, or first in check/test); null: none. */
  exerciseGrade(id: string): Grade | null {
    return this.counting(id)?.grade ?? null;
  }

  private counting(id: string): ExerciseResult | null {
    const list = this.closedAttempts[id];
    if (!list || list.length === 0) return null;
    if (this.opts.firstAttemptCounts) {
      const graded = list.filter((r) => r.grade !== null);
      if (graded.length === 0) return list[0];
      return this.repeatAllowed.has(id) && graded.length > 1 ? graded[1] : graded[0];
    }
    // Instructors grade the standard achieved: the best attempt (test grade breaks ties; the earliest wins).
    let best = list[0];
    const key = (r: ExerciseResult): number => (r.grade ?? 0) * 10 + (r.testGrade ?? 0);
    for (const r of list) if (key(r) > key(best)) best = r;
    return best;
  }

  /** Closed attempts by exercise id (RunSnapshot.exercises). */
  closed(): Record<string, ExerciseResult[]> {
    return structuredClone(this.closedAttempts);
  }

  /** Rebuild from a snapshot's closed attempts. */
  restore(closed: Record<string, ExerciseResult[]>): void {
    this.open = null;
    this.closedAttempts = structuredClone(closed);
    this.bands = [];
    this.building.clear();
    // Limit interventions travel inside the closed attempts (the latest attempt holds the full list).
    this.limitHits = new Map();
    for (const [id, list] of Object.entries(this.closedAttempts)) {
      const ids = list.reduce<string[]>((best, r) => ((r.limitIds?.length ?? 0) > best.length ? [...(r.limitIds ?? [])] : best), []);
      if (ids.length) this.limitHits.set(id, ids);
    }
  }

  /** Trace bands of the tasks closed since the last call (the runner forwards them to the TraceRecorder). */
  takeBands(): TraceBand[] {
    const b = this.bands;
    this.bands = [];
    return b;
  }

  /** The counting result per exercise, in lesson order (input to the lesson result). */
  exerciseResults(): ExerciseResult[] {
    const ids = [...this.opts.exercises.map((e) => e.id), ...Object.keys(this.closedAttempts).filter((id) => !this.defs.has(id))];
    const out: ExerciseResult[] = [];
    for (const id of ids) {
      const list = this.closedAttempts[id];
      const r = this.counting(id);
      if (!list || !r) continue;
      const x: ExerciseResult = { ...structuredClone(r), attempts: list.length + (this.limitDiscarded.get(id) ?? 0), interventions: list.reduce((n, a) => n + a.interventions, 0) };
      this.applyLimits(x);
      out.push(x);
    }
    return out;
  }
}

function head(c: Criterion): { id: string; label: string; kind: Criterion['kind']; required: boolean; safety: boolean } {
  return { id: c.id, label: c.label, kind: c.kind, required: c.required, safety: c.safety ?? false };
}

function eventWords(e: string | undefined): string {
  switch (e) {
    case 'liftoff': return 'lift-off';
    case 'mainsTouchdown': case 'touchdown': return 'touchdown';
    case 'thresholdCrossed': return 'the threshold';
    case 'goAround': return 'the go-around';
    case 'rolloutComplete': return 'the roll-out';
    default: return e ?? 'the event';
  }
}

const isGate = (c: CriterionResult): boolean => c.kind === 'check' || c.kind === 'binary';

/**
 * Exercise grade: min over required criteria; safety criteria, critical faults and item-failing faults force 1; a major fault caps
 * at 2, two or more minor faults at 3; an intervention in an assessed exercise makes it 1. Passed gates
 * (check / binary) never lower a measured grade. `which` picks the lesson grade or the test-standard grade.
 */
export function aggregateExercise(
  criteria: readonly CriterionResult[], faults: readonly FaultRecord[], intervened: boolean, def: ExerciseDef,
  which: 'grade' | 'testGrade' = 'grade',
): Grade | null {
  if (def.mode === 'demo') return null;
  if (criteria.some((c) => c.required && isInsufficient(c))) return null;
  const graded = criteria.filter((c) => !isInsufficient(c));
  if (graded.some((c) => c.safety && c[which] === 1) || faults.some((f) => f.severity === 'critical')) return 1;
  // A fault that fails the item it is in (the skill test's flap overspeed): 1, whatever was measured.
  if (faults.some((f) => f.failsItem === true)) return 1;
  const req = graded.filter((c) => c.required);
  if (req.length === 0) return null;
  const measured = req.filter((c) => !isGate(c));
  const gates = req.filter(isGate);
  let g: number = measured.length > 0 ? Math.min(...measured.map((c) => c[which])) : Math.min(...gates.map((c) => c[which]));
  for (const c of gates) if (c[which] < 3) g = Math.min(g, c[which]);
  if (faults.some((f) => f.severity === 'major')) g = Math.min(g, 2);
  if (faults.filter((f) => f.severity === 'minor').length >= 2) g = Math.min(g, 3);
  if (intervened && def.mode === 'assessed') g = 1;
  return g as Grade;
}
