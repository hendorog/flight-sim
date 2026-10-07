// The coach (section 3.6): candidates from the task's coach rules (presets bound to card targets), spoken
// only when persistent, not already being corrected, within topic/global gaps and the coach level; escalation
// rungs; rationed praise. It returns remarks; the runner enqueues them with the scheduler.
//
// All timing is sim time (ctx.simT / ctx.dt), so pause, curtains and time acceleration need no special cases.
// Every rule's `when` is evaluated every frame (also while the criteria settle, while the voice is busy and in
// quiet zones) so its persistence timer and any `held` timers inside it stay true to the flight.

import { bindPreset } from '../content/coachPresets';
import { normalisedError } from '../grading/accumulators';
import type { CoachLevel, CoachRule, CompiledPred, CueRef, EvalContext, PointTarget, Ref, SignalId, TaskStep, Tol, TolRef, TrainingSettings } from '../types';
import { compile } from './predicates';
import { resolveRef, resolveTol } from './refs';

export interface CoachRemark {
  ruleId: string; topic: string; cue: CueRef; rung: 1 | 2 | 3; priority: CoachRule['priority'];
  praise: boolean; offerDemo: boolean;
  /** Extra template variables (target, dev, side, dir...). */
  vars: Record<string, number | string>;
  /** The control the remark names (CoachRule.point): the UI points at it. */
  point?: PointTarget;
  /** The rule's last line, after an earlier one (it will not be said again until the problem clears). */
  final?: boolean;
}

export interface CoachDeps {
  talkativeness: TrainingSettings['talkativeness'];
  /** Filtered rate of a signal (Telemetry.rate) for the "already correcting" test. */
  rate(sig: SignalId): number;
  /**
   * Ab initio lesson (stage 1, L01-L08): cooldowns are halved, the per-minute cap doubled, and a rule's first
   * remark (rung 1, not safety) comes after AB_INITIO_FIRST_S instead of its afterS. Talkativeness still scales
   * both.
   */
  abInitio?: boolean;
}

// ---- Section 3.6.1 constants (sim seconds) ------------------------------------------------------------------

/** Rule 1: target-based presets speak after 1.5 s instead of afterS when the error is this large (n > 1.5). */
const FAST_N = 1.5;
const FAST_AFTER_S = 1.5;
/** Rule 3: suppressed while the error shrinks and would be back inside tolerance within this time. */
const CORRECTING_HORIZON_S = 6;
/** Rule 4: per-topic gap. */
const TOPIC_GAP_S = 25;
/** Rule 5: global gap and rate cap. */
const GLOBAL_GAP_S = 8;
const MAX_PER_MINUTE = 3;
/** Rule 6: minimum gap at the reduced and minimal levels. */
const LEVEL_GAP_S: Record<CoachLevel, number> = { full: 0, reduced: 10, minimal: 15, silent: 0 };
/** Highest (least important) priority each level allows. */
const LEVEL_MAX_PRIORITY: Record<CoachLevel, number> = { full: 3, reduced: 2, minimal: 1, silent: 0 };
const LEVEL_RANK: Record<CoachLevel, number> = { silent: 0, minimal: 1, reduced: 2, full: 3 };
/** Escalation resets after the condition has been clear this long. */
const RUNG_RESET_S = 20;
/** Praise: once per phase and per 90 s; after a fix held this long, or 30 s with every chip green. */
const PRAISE_GAP_S = 90;
const FIX_HELD_S = 3;
const ALL_GREEN_S = 30;
const GREEN_N = 0.6;
/** Ab initio: the first remark on a deviation after this long (talkativeness-scaled), s; cooldowns times this. */
export const AB_INITIO_FIRST_S = 3;
export const AB_INITIO_COOLDOWN_FACTOR = 0.5;
/** Talkativeness scales every cooldown (section 1.4 rule 9). */
const TALK_FACTOR: Record<TrainingSettings['talkativeness'], number> = { quiet: 2, normal: 1, chatty: 0.7 };

/** Words for the sign of an error, by signal (`{dir}` in the preset lines). */
const DIR_WORDS: Partial<Record<SignalId, [string, string]>> = {
  asiKt: ['fast', 'slow'], kias: ['fast', 'slow'], downwindOffsetNm: ['wide', 'close'],
};
const SPEED_SIGS: ReadonlySet<string> = new Set(['asiKt', 'kias']);

const num = (x: unknown): number => (typeof x === 'number' ? x : NaN);
const wrap180 = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;

interface RuleRun {
  rule: CoachRule;
  when: CompiledPred;
  /** Card tolerance for the rule's correcting signal (n and the correcting horizon); null: none. */
  tol: TolRef | null;
  activeS: number;
  clearS: number;
  rung: 0 | 1 | 2 | 3;
  /** Spoken since its condition last cleared: a fix is praiseworthy. */
  remarked: boolean;
}

interface Target { sig: SignalId; value: Ref; tol: TolRef }

export class Coach {
  private level: CoachLevel = 'full';
  private rules: RuleRun[] = [];
  private targets: Target[] = [];
  private lastTopicAt = new Map<string, number>();
  private remarkTimes: number[] = [];
  private lastRemarkAt = -Infinity;
  private lastPraiseAt = -Infinity;
  private praisedThisPhase = false;
  private phaseRemarks = 0;
  private allGreenS = 0;
  private fixedRule: RuleRun | null = null;

  constructor(private readonly deps: CoachDeps) {}

  setLevel(level: CoachLevel): void {
    this.level = level;
  }

  get currentLevel(): CoachLevel {
    return this.level;
  }

  /** Bind the task's rules and presets to its card. */
  beginTask(step: TaskStep, ctx: EvalContext): void {
    void ctx;   // targets and tolerances resolve per frame: vars and the standard may change within a task
    this.targets = step.card.targets.filter((t) => t.tol !== undefined).map((t) => ({ sig: t.sig, value: t.value, tol: t.tol as TolRef }));
    this.rules = [];
    for (const entry of step.coach ?? []) {
      const rule = typeof entry === 'string' ? bindPreset(entry, step.card) : entry;
      if (!rule) continue;
      const card = rule.correcting ? step.card.targets.find((t) => t.sig === rule.correcting?.sig) : undefined;
      this.rules.push({ rule, when: compile(rule.when), tol: card?.tol ?? null, activeS: 0, clearS: 0, rung: 0, remarked: false });
    }
    this.allGreenS = 0;
    this.fixedRule = null;
  }

  endTask(): void {
    this.rules = [];
    this.targets = [];
    this.allGreenS = 0;
    this.fixedRule = null;
  }

  /** Phase entry resets the once-per-phase praise allowance. */
  beginPhase(): void {
    this.praisedThisPhase = false;
    this.phaseRemarks = 0;
  }

  /**
   * Once per frame. `criteriaSettled`: the task's criteria are past their settle time. `voiceIdle`: nothing is
   * playing (Safety remarks may preempt). Returns at most one remark.
   */
  update(ctx: EvalContext, criteriaSettled: boolean, voiceIdle: boolean): CoachRemark | null {
    const dt = ctx.dt;
    for (const r of this.rules) {
      if (r.when.eval(ctx)) {
        r.activeS += dt;
        r.clearS = 0;
      } else {
        r.activeS = 0;
        r.clearS += dt;
        if (r.clearS >= RUNG_RESET_S) r.rung = 0;
        if (r.remarked && r.clearS >= FIX_HELD_S) {
          r.remarked = false;
          this.fixedRule = r;
        }
      }
    }
    this.allGreenS = this.allGreen(ctx) ? this.allGreenS + dt : 0;
    if (!criteriaSettled || dt <= 0) return null;

    const now = ctx.simT;
    const talk = TALK_FACTOR[this.deps.talkativeness];
    const factor = talk * (this.deps.abInitio ? AB_INITIO_COOLDOWN_FACTOR : 1);
    const quiet = quietZone(ctx);
    let best: RuleRun | null = null;
    for (const r of this.rules) {
      const p = r.rule.priority;
      if (r.activeS <= 0 || !this.levelAllows(r.rule)) continue;
      // Owner playtest (decision 4): a reminder never repeats itself. Once the last rung has been said the rule
      // stays quiet until the problem has cleared (RUNG_RESET_S); safety calls keep calling.
      if (p > 0 && r.rung > 0 && r.rung >= lastRung(r.rule)) continue;
      if (p > 0 && (quiet || !voiceIdle || !this.globalGateOpen(now, factor))) continue;
      const n = this.normalised(r, ctx);
      let afterS = n !== null && n > FAST_N ? Math.min(r.rule.afterS, FAST_AFTER_S) : r.rule.afterS;
      if (this.deps.abInitio && p > 0 && r.rung === 0) afterS = Math.min(afterS, AB_INITIO_FIRST_S * talk);
      if (r.activeS < afterS) continue;
      if (this.correcting(r, ctx)) continue;
      const lastTopic = this.lastTopicAt.get(r.rule.topic);
      if (lastTopic !== undefined && now - lastTopic < TOPIC_GAP_S * factor) continue;
      if (!best || p < best.rule.priority || (p === best.rule.priority && r.activeS > best.activeS)) best = r;
    }
    if (best) return this.remark(best, ctx, now);
    return this.praise(ctx, now, voiceIdle && !quiet, factor);
  }

  /** Remarks made in the current phase (stars: no coaching remark in assessed phases). */
  get remarksThisPhase(): number {
    return this.phaseRemarks;
  }

  // ---- gates ------------------------------------------------------------------------------------------------

  private levelAllows(rule: CoachRule): boolean {
    return rule.priority <= LEVEL_MAX_PRIORITY[this.level] && LEVEL_RANK[this.level] >= LEVEL_RANK[rule.minLevel];
  }

  /** Rule 5 (and the level gaps of rule 6): unprompted remarks are rationed. Safety remarks bypass this. */
  private globalGateOpen(now: number, factor: number): boolean {
    const gap = Math.max(GLOBAL_GAP_S, LEVEL_GAP_S[this.level]) * factor;
    if (now - this.lastRemarkAt < gap) return false;
    this.remarkTimes = this.remarkTimes.filter((t) => now - t < 60);
    return this.remarkTimes.length < (this.deps.abInitio ? MAX_PER_MINUTE * 2 : MAX_PER_MINUTE);
  }

  /** Rule 3: the error is shrinking and would be back inside tolerance within the horizon. */
  private correcting(r: RuleRun, ctx: EvalContext): boolean {
    const c = r.rule.correcting;
    if (!c) return false;
    const e = this.error(c.sig, c.target, ctx);
    if (!Number.isFinite(e)) return false;
    const dAbsE = Math.sign(e) * this.deps.rate(c.sig);
    if (!(dAbsE < 0)) return false;
    const side = r.tol ? this.tolSide(r.tol, e, ctx) : 0;
    return (Math.abs(e) - side) / -dAbsE < CORRECTING_HORIZON_S;
  }

  // ---- remarks ----------------------------------------------------------------------------------------------

  private remark(r: RuleRun, ctx: EvalContext, now: number): CoachRemark {
    const say = r.rule.say;
    const last = lastRung(r.rule);
    const rung = Math.min(r.rung + 1, last) as 1 | 2 | 3;
    r.rung = rung;
    r.remarked = true;
    this.note(r.rule.topic, now);
    this.phaseRemarks++;
    const cue = say[rung - 1] ?? say[0];
    return {
      ruleId: r.rule.id, topic: r.rule.topic, cue, rung, priority: r.rule.priority, praise: false,
      offerDemo: rung === 3 && r.rule.offerDemo === true, vars: this.remarkVars(r.rule, ctx),
      ...(r.rule.point ? { point: r.rule.point } : {}),
      ...(rung === last && rung > 1 ? { final: true } : {}),
    };
  }

  /** Section 3.6.1 praise: once per phase and per 90 s, after a fix or 30 s of green chips; never when quiet. */
  private praise(ctx: EvalContext, now: number, canSpeak: boolean, factor: number): CoachRemark | null {
    if (!canSpeak || this.deps.talkativeness === 'quiet' || this.praisedThisPhase) return null;
    if (this.level !== 'full' && this.level !== 'reduced') return null;
    if (now - this.lastPraiseAt < PRAISE_GAP_S * (this.deps.abInitio ? AB_INITIO_COOLDOWN_FACTOR : 1) || !this.globalGateOpen(now, factor)) return null;
    // Never praise a taxi that is off the yellow line or on the grass (playtest 3: "Nicely done." 20 m off it).
    const f = ctx.frame;
    if (f.onGround === true && (f.onPaved === false || Math.abs(Number(f['taxi.xtrackM'])) > 3)) return null;
    const fixed = this.fixedRule;
    const green = this.targets.length > 0 && this.allGreenS >= ALL_GREEN_S;
    if (!fixed && !green) return null;
    this.fixedRule = null;
    this.allGreenS = 0;
    this.praisedThisPhase = true;
    this.lastPraiseAt = now;
    this.lastRemarkAt = now;
    this.remarkTimes.push(now);
    // On the ground (taxiing) "tidy flying" is the wrong word.
    const generic = ctx.frame.onGround === true ? ['Nicely done.', 'Good, all within limits.', 'Good, nice and steady.'] : ['Nicely held.', 'Good, all within limits.', "That's tidy flying."];
    const cue: CueRef = fixed?.rule.praise ?? (fixed ? { text: "That's better." } : { text: generic });
    return {
      ruleId: fixed?.rule.id ?? 'allGreen', topic: fixed?.rule.topic ?? 'praise', cue, rung: 1, priority: 3, praise: true,
      offerDemo: false, vars: fixed ? this.remarkVars(fixed.rule, ctx) : {},
    };
  }

  private note(topic: string, now: number): void {
    this.lastTopicAt.set(topic, now);
    this.lastRemarkAt = now;
    this.remarkTimes.push(now);
  }

  /**
   * Template variables for a remark: value, target, dev (signed error), dir (high/low, fast/slow, wide/close),
   * side/Side (right for a positive error), nose (the pitch change that fixes it), lead (10 % of the vertical
   * speed, ft) and limit (the flap limit speed for the current flap).
   */
  private remarkVars(rule: CoachRule, ctx: EvalContext): Record<string, number | string> {
    const f = ctx.frame;
    const vars: Record<string, number | string> = {};
    const vsi = num(f.vsiFpm);
    if (Number.isFinite(vsi)) vars.lead = Math.max(20, Math.round(Math.abs(vsi) * 0.1 / 10) * 10);
    const flaps = num(f.flapsDeg);
    vars.limit = flaps > 10.5 ? ctx.aircraft.vspeeds.VfeFull : ctx.aircraft.vspeeds.Vfe10;
    const c = rule.correcting;
    if (c) {
      const x = num(f[c.sig]);
      const target = resolveRef(c.target, ctx);
      const e = this.error(c.sig, c.target, ctx);
      if (Number.isFinite(x)) vars.value = x;
      if (Number.isFinite(target)) vars.target = target;
      if (Number.isFinite(e)) {
        vars.dev = e;
        const words = DIR_WORDS[c.sig] ?? ['high', 'low'];
        vars.dir = e >= 0 ? words[0] : words[1];
        vars.side = e >= 0 ? 'right' : 'left';
        vars.Side = e >= 0 ? 'Right' : 'Left';
        // Too fast: nose up. Too high (or any other positive error): nose down.
        vars.nose = SPEED_SIGS.has(c.sig) ? (e >= 0 ? 'up' : 'down') : (e >= 0 ? 'down' : 'up');
      }
    }
    return vars;
  }

  // ---- measurement ------------------------------------------------------------------------------------------

  /** x - target, wrapped for angle signals; NaN when either is missing. */
  private error(sig: SignalId, target: Ref, ctx: EvalContext): number {
    const x = num(ctx.frame[sig]);
    const t = resolveRef(target, ctx);
    const e = x - t;
    return ctx.signalDef(sig)?.kind === 'angle' ? wrap180(e) : e;
  }

  private tolSide(tol: TolRef, e: number, ctx: EvalContext): number {
    const t: Tol = resolveTol(tol, ctx);
    const side = e >= 0 ? t.plus : t.minus;
    return Number.isFinite(side) ? side : 0;
  }

  /** Normalised error of a target-based rule against its card tolerance; null when not target-based. */
  private normalised(r: RuleRun, ctx: EvalContext): number | null {
    const c = r.rule.correcting;
    if (!c || !r.tol) return null;
    const e = this.error(c.sig, c.target, ctx);
    if (!Number.isFinite(e)) return null;
    return normalisedError(e, resolveTol(r.tol, ctx));
  }

  private allGreen(ctx: EvalContext): boolean {
    if (this.targets.length === 0) return false;
    for (const t of this.targets) {
      const e = this.error(t.sig, t.value, ctx);
      if (!Number.isFinite(e) || normalisedError(e, resolveTol(t.tol, ctx)) > GREEN_N) return false;
    }
    return true;
  }
}

/** The highest escalation rung a rule has (its number of lines). */
function lastRung(rule: CoachRule): 1 | 2 | 3 {
  return (rule.say[2] ? 3 : rule.say[1] ? 2 : 1) as 1 | 2 | 3;
}

/**
 * Section 1.4 rule 4: below 300 ft AGL on final, in the flare and on the take-off roll only Safety calls (and
 * the steps' own short calls) are made.
 */
export function quietZone(ctx: EvalContext): boolean {
  const f = ctx.frame;
  const agl = num(f.aglFt);
  if (f.circuitLeg === 'final' && agl < 300) return true;
  if (f.onGround !== true && agl < 50) return true;
  return f.onGround === true && num(f.gsKt) > 20 && num(f.throttle) > 0.8;
}
