// Lesson-authoring builders (section 2.4, used throughout section 2.12). Each returns the plain JSON object
// of the contract, nothing more: lessons stay data that the linter, resume and export can read, and a
// builder call is always interchangeable with the literal it produces.
//
// Implemented in wave 0 (not stubbed) because lesson files call these at import time: content can be
// written, imported and linted before the engine exists.

import type {
  AircraftSettingId, BranchStep, CaptureStep, ChecklistId, ChecklistStep, CircuitLeg, Criterion, CueRef, DemoScript,
  DemoStep, EndStep, Grade, HandoverStep, PointFields, Pred, Ref, SayStep, SetupStep, SigRef, SignalId, StepBase, TaskStep,
  TolKey, TolRef, TrainingEventName, VSpeedId, WaitStep,
} from '../types';

type Where = Record<string, [number, number] | string | boolean>;
/** Optional StepBase fields every step builder accepts. */
type StepOpts = Omit<StepBase, 'id'>;

const withAdd = <T extends object>(o: T, add: number | undefined): T & { add?: number } => (add === undefined ? o : { ...o, add });

// ---- refs ---------------------------------------------------------------------------------------------------

/** A run variable, plus an optional offset: v('alt0', 1000). */
export const v = (name: string, add?: number): Ref => withAdd({ var: name }, add);
/** An aircraft V-speed (KIAS): vs('Vy'). */
export const vs = (id: VSpeedId, add?: number): Ref => withAdd({ vspeed: id }, add);
/** An aircraft setting: setting('cruiseRpm'). */
export const setting = (id: AircraftSettingId, add?: number): Ref => withAdd({ setting: id }, add);
/** The aerodrome elevation, ft, plus an offset: fieldElev(1000) = circuit height MSL. */
export const fieldElev = (add?: number): Ref => withAdd({ field: 'elevFt' as const }, add);
/** A signal's current value as a number: sig('altFt', 500). */
export const sig = (id: SignalId, add?: number): Ref => withAdd({ sig: id }, add);
/** A tolerance key, optionally scaled: std('altitude', 0.5). */
export const std = (key: TolKey, scale?: number): TolRef => (scale === undefined ? key : { key, scale });

// ---- predicates ---------------------------------------------------------------------------------------------

export const gt = (s: SigRef, value: Ref, hyst?: number): Pred => (hyst === undefined ? { sig: s, op: '>', v: value } : { sig: s, op: '>', v: value, hyst });
export const ge = (s: SigRef, value: Ref, hyst?: number): Pred => (hyst === undefined ? { sig: s, op: '>=', v: value } : { sig: s, op: '>=', v: value, hyst });
export const lt = (s: SigRef, value: Ref, hyst?: number): Pred => (hyst === undefined ? { sig: s, op: '<', v: value } : { sig: s, op: '<', v: value, hyst });
export const le = (s: SigRef, value: Ref, hyst?: number): Pred => (hyst === undefined ? { sig: s, op: '<=', v: value } : { sig: s, op: '<=', v: value, hyst });
export const eq = (s: SigRef, x: number | string | boolean): Pred => ({ sig: s, eq: x });
/** Angle-aware band: near('hdgDeg', v('hdg0'), 'heading'). */
export const near = (s: SigRef, target: Ref, tol: TolRef, hyst?: number): Pred =>
  hyst === undefined ? { sig: s, near: target, tol } : { sig: s, near: target, tol, hyst };
/** True after `p` held for `s` continuous sim seconds (drop-outs up to graceS pause the timer). */
export const held = (p: Pred, s: number, graceS?: number): Pred => (graceS === undefined ? { held: p, s } : { held: p, s, graceS });
export const all = (...ps: Pred[]): Pred => ({ all: ps });
export const any = (...ps: Pred[]): Pred => ({ any: ps });
export const not = (p: Pred): Pred => ({ not: p });
export const ever = (p: Pred): Pred => ({ ever: p });
/** An event since step entry: ev('liftoff'), ev('touchdown', { wheel: 'nose' }), ev('goAround', undefined, 2). */
export const ev = (name: TrainingEventName, where?: Where, count?: number): Pred => {
  const p: { event: TrainingEventName; where?: Where; count?: number } = { event: name };
  if (where !== undefined) p.where = where;
  if (count !== undefined) p.count = count;
  return p;
};
export const elapsed = (s: number): Pred => ({ elapsed: s });
export const turned = (deg: number): Pred => ({ turned: deg });
export const authority = (who: 'student' | 'instructor'): Pred => ({ authority: who });
export const leg = (...legs: CircuitLeg[]): Pred => ({ leg: legs.length === 1 ? legs[0] : legs });
export const speechIdle = (): Pred => ({ speechIdle: true });
export const exerciseGrade = (id: string, atLeast: Grade): Pred => ({ exerciseGrade: id, atLeast });
export const always = (): Pred => ({ const: true });
export const never = (): Pred => ({ const: false });

// ---- steps --------------------------------------------------------------------------------------------------

export const say = (id: string, cue: CueRef, opts: StepOpts & { wait?: boolean } = {}): SayStep => ({ ...opts, id, kind: 'say', cue });
export const wait = (id: string, until: Pred, opts: StepOpts & PointFields & { cue?: CueRef; prompt?: CueRef } = {}): WaitStep => ({ ...opts, id, kind: 'wait', until });
export const capture = (id: string, vars: CaptureStep['vars'], opts: StepOpts = {}): CaptureStep => ({ ...opts, id, kind: 'capture', vars });
export const setup = (id: string, opts: StepOpts & Omit<SetupStep, 'id' | 'kind' | keyof StepOpts> = {}): SetupStep => ({ ...opts, id, kind: 'setup' });
export const handover = (id: string, to: 'student' | 'instructor', opts: StepOpts & { ackTimeoutS?: number } = {}): HandoverStep => ({ ...opts, id, kind: 'handover', to });
export const demo = (id: string, script: string | DemoScript, opts: StepOpts & Omit<DemoStep, 'id' | 'kind' | 'script' | keyof StepOpts> = {}): DemoStep =>
  ({ ...opts, id, kind: 'demo', script });
export const checklist = (id: string, list: ChecklistId, mode: ChecklistStep['mode'], opts: StepOpts & { exercise?: string } = {}): ChecklistStep =>
  ({ ...opts, id, kind: 'checklist', checklist: list, mode });
export const branch = (id: string, cases: BranchStep['cases'], otherwise: string, opts: StepOpts = {}): BranchStep =>
  ({ ...opts, id, kind: 'branch', cases, else: otherwise });
export const end = (id: string, cue?: CueRef, opts: StepOpts = {}): EndStep => (cue === undefined ? { ...opts, id, kind: 'end' } : { ...opts, id, kind: 'end', cue });
export const task = (def: Omit<TaskStep, 'kind'>): TaskStep => ({ ...def, kind: 'task' });

// ---- criteria -----------------------------------------------------------------------------------------------

/** Options shared by the criterion builders; `required` is always stated explicitly in lesson data. */
export type CriterionOpts = Partial<Pick<Criterion, 'settleS' | 'activeWhen' | 'safety' | 'chart' | 'advice'>> & { required: boolean };

export const hold = (id: string, label: string, s: SignalId, target: Ref, tol: TolRef, opts: CriterionOpts): Criterion =>
  ({ ...opts, id, label, kind: 'hold', sig: s, target, tol });
export const peak = (id: string, label: string, s: SignalId, target: Ref, tol: TolRef, opts: CriterionOpts & { peakOf?: Criterion['peakOf'] }): Criterion =>
  ({ ...opts, id, label, kind: 'peak', sig: s, target, tol });
export const final = (id: string, label: string, s: SignalId, target: Ref, tol: TolRef, opts: CriterionOpts): Criterion =>
  ({ ...opts, id, label, kind: 'final', sig: s, target, tol });
/** One sample at an event: `field` of the payload, or (field omitted) signal `s` at that moment. */
export const atEvent = (id: string, label: string, event: TrainingEventName, s: SignalId, target: Ref, tol: TolRef, opts: CriterionOpts & { field?: string }): Criterion =>
  ({ ...opts, id, label, kind: 'atEvent', event, sig: s, target, tol });
export const check = (id: string, label: string, opts: CriterionOpts & { pred: Pred; withinS?: number }): Criterion => ({ ...opts, id, label, kind: 'check' });
export const binary = (id: string, label: string, failIf: Pred, opts: CriterionOpts): Criterion => ({ ...opts, id, label, kind: 'binary', failIf });
