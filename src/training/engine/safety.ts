// The safety envelope monitor (section 3.8): breaches that last 0.5 s (0 s for low-and-slow and g) trigger an
// intervention in lessons with instructor saves; otherwise they are recorded as faults.
//
// Every rule reads truth signals (not the instruments: the instructor looks outside and feels the aircraft).
// Each rule has its own timer; when one meets its duration the monitor reports it once and latches that rule
// until its condition clears, so a breach is one event however long it lasts, and a lesson without saves
// records one fault per excursion rather than one per frame.

import type { EvalContext, SafetyEnvelope } from '../types';
import { resolveRef } from './refs';

export type { SafetyEnvelope } from '../types';

export interface SafetyBreach {
  /** A SafetyRuleId. */
  rule: string;
  /** Recovery the copilot should fly. */
  recovery: 'noseLow' | 'slow' | 'low' | 'ground';
  /** One-sentence reason spoken once the aircraft is safe. */
  reason: string;
  /** Imminent danger (low-and-slow, terrain): the examiner stops the test. */
  imminent: boolean;
}

export type SafetyRuleId =
  | 'bank' | 'pitchUp' | 'pitchDown' | 'speed' | 'g' | 'minHeight' | 'lowAndSlow' | 'sink' | 'stall' | 'runwayExcursion'
  | 'taxiSpeed';

/** Section 3.3: a breach must last this long; low-and-slow and g limits act at once. */
export const BREACH_S = 0.5;
const IMMEDIATE: ReadonlySet<SafetyRuleId> = new Set<SafetyRuleId>(['lowAndSlow', 'g']);
/** Close to the ground in the flare and touchdown, slow flight and stall-warner noise are normal. */
const FLARE_AGL_FT = 30;
/** The `stallAllowed` envelope flag applies only this high (section 3.8: "L06/L07 above 2,000 ft AGL"). */
const STALL_ALLOWED_ABOVE_AGL_FT = 2000;
/** The ground run where a runway excursion is checked; off the runway, the taxi speed limit. */
const EXCURSION_MIN_GS_KT = 15;
/**
 * A runway excursion is leaving the runway: the aircraft must have been on it this recently. Elsewhere on the
 * ground (apron, taxiways) the same speed is a taxi-speed breach, with its own reason.
 */
const LEFT_RUNWAY_WITHIN_S = 5;
/** stallFrac beyond which the wing is stalling (the recovery rule's "stalled" threshold, section 3.8). */
const STALL_FRAC = 0.1;
/** Below this height a breach that is neither nose-low nor slow is recovered with the 'low' (full power) script. */
const LOW_RECOVERY_AGL_FT = 1000;

export const SAFETY_REASONS: Readonly<Record<SafetyRuleId, string>> = {
  bank: "The bank was getting too steep; that's how a spiral starts.",
  pitchUp: 'The nose was far too high; the speed was going.',
  pitchDown: 'The nose was far too low; the speed was building fast.',
  speed: 'We were well over the speed limit for this aircraft.',
  g: 'That was too much g for the airframe.',
  minHeight: 'We were getting too low for this exercise.',
  lowAndSlow: 'Low and slow is how people stall near the ground.',
  sink: 'The sink rate was far too high that close to the ground.',
  stall: "That was a stall we didn't plan for.",
  runwayExcursion: 'We were about to leave the runway.',
  taxiSpeed: 'That was far too fast for taxiing; a brisk walking pace, and slower near other aircraft.',
};

/**
 * What the instructor calls out when instructor saves are off (she does not take control, but she does not
 * sit silent either): the corrective action, at Safety priority.
 */
export const SAFETY_CALLS: Readonly<Record<SafetyRuleId, string>> = {
  bank: 'Too much bank! Roll the wings level!',
  pitchUp: 'Nose too high! Lower the nose, add power!',
  pitchDown: 'Nose too low! Throttle closed, wings level, ease it up!',
  speed: 'Too fast! Throttle back, ease the nose up!',
  g: 'Ease off, too much g!',
  minHeight: "We're too low! Climb!",
  lowAndSlow: 'Low and slow! Nose down, full power!',
  sink: 'Sink rate! Full power, raise the nose!',
  stall: "You're stalling! Nose down, full power!",
  runwayExcursion: 'Straighten up! Throttle closed, brakes!',
  taxiSpeed: 'Slow down! Throttle closed, brakes.',
};

const ORDER: readonly SafetyRuleId[] = [
  'lowAndSlow', 'g', 'sink', 'runwayExcursion', 'taxiSpeed', 'minHeight', 'stall', 'bank', 'pitchDown', 'pitchUp', 'speed',
];

const num = (x: unknown): number => (typeof x === 'number' ? x : NaN);

export class SafetyMonitor {
  private env: SafetyEnvelope;
  private lowLevel = false;
  private readonly timers = new Map<SafetyRuleId, number>();
  private readonly latched = new Set<SafetyRuleId>();
  private violating = false;
  /** Sim time the aircraft was last over the runway surface (-Infinity: not yet). */
  private onRunwayT = Number.NEGATIVE_INFINITY;

  constructor(envelope: SafetyEnvelope) {
    this.env = envelope;
  }

  /** Lesson and phase overrides (rules.envelope; lowLevel phases disable the minimum-height rule). */
  configure(envelope: SafetyEnvelope, lowLevel: boolean): void {
    this.env = envelope;
    this.lowLevel = lowLevel;
  }

  get envelope(): Readonly<SafetyEnvelope> {
    return this.env;
  }

  /** Some rule is currently violated (whether or not it has fired). */
  get anyViolated(): boolean {
    return this.violating;
  }

  /** Once per frame; returns a breach once its duration rule is met (then latched until it clears or reset). */
  update(ctx: EvalContext): SafetyBreach | null {
    const violated = this.violations(ctx);
    this.violating = violated.size > 0;
    let fired: SafetyRuleId | null = null;
    for (const id of ORDER) {
      if (!violated.has(id)) {
        this.timers.delete(id);
        this.latched.delete(id);
        continue;
      }
      const t = (this.timers.get(id) ?? 0) + ctx.dt;
      this.timers.set(id, t);
      // An immediate rule fires on the first frame it is seen; the others need BREACH_S of sim time.
      const due = IMMEDIATE.has(id) || t >= BREACH_S;
      if (due && !this.latched.has(id) && fired === null) fired = id;
    }
    if (fired === null) return null;
    this.latched.add(fired);
    return { rule: fired, recovery: this.recoveryFor(fired, ctx), reason: SAFETY_REASONS[fired], imminent: fired === 'lowAndSlow' || fired === 'sink' };
  }

  reset(): void {
    this.timers.clear();
    this.latched.clear();
    this.violating = false;
    this.onRunwayT = Number.NEGATIVE_INFINITY;
  }

  /** The rules violated by the current frame. */
  private violations(ctx: EvalContext): Set<SafetyRuleId> {
    const f = ctx.frame;
    const e = this.env;
    const out = new Set<SafetyRuleId>();
    const onGround = f.onGround === true;
    const agl = num(f.aglFt);
    const kias = num(f.kias);
    const airborne = !onGround;

    // Without the geo provider's onRunway, being within the excursion limit of the centreline stands for it.
    const overRunway = typeof f.onRunway === 'boolean' ? f.onRunway : Math.abs(num(f.rwyAcrossM)) <= e.runwayExcursionM;
    if (overRunway) this.onRunwayT = ctx.simT;
    if (onGround) {
      if (num(f.gsKt) > EXCURSION_MIN_GS_KT) {
        const leftRunway = ctx.simT - this.onRunwayT <= LEFT_RUNWAY_WITHIN_S;
        if (leftRunway && Math.abs(num(f.rwyAcrossM)) > e.runwayExcursionM) out.add('runwayExcursion');
        else if (!leftRunway) out.add('taxiSpeed');
      }
      return out;
    }

    if (Math.abs(num(f.bankDeg)) > e.maxBankDeg) out.add('bank');
    if (num(f.pitchDeg) > e.maxPitchUpDeg) out.add('pitchUp');
    if (num(f.pitchDeg) < e.maxPitchDownDeg) out.add('pitchDown');
    if (kias > e.maxKias) out.add('speed');
    const g = num(f.gLoad);
    if (g > e.maxG || g < e.minG) out.add('g');
    if (airborne && !this.lowLevel && agl < e.minAglFt) out.add('minHeight');
    // The flare is low and slow by design; the rule guards the approach and the climb-out above it.
    const slowBelow = resolveRef(e.lowAndSlow.belowKias, ctx);
    if (agl > FLARE_AGL_FT && agl < e.lowAndSlow.aglFt && kias < slowBelow) out.add('lowAndSlow');
    if (agl < 200 && num(f.vsFpm) < -e.maxSinkFpmBelow200) out.add('sink');
    const stalling = num(f.stallFrac) > STALL_FRAC;
    const stallOk = e.stallAllowed && agl >= STALL_ALLOWED_ABOVE_AGL_FT;
    if (stalling && agl > FLARE_AGL_FT && !stallOk) out.add('stall');
    return out;
  }

  /** Section 3.8 recovery selection: ground, then the low-energy cases, then nose low, then slow. */
  private recoveryFor(rule: SafetyRuleId, ctx: EvalContext): SafetyBreach['recovery'] {
    const f = ctx.frame;
    if (f.onGround === true || rule === 'runwayExcursion' || rule === 'taxiSpeed') return 'ground';
    if (rule === 'minHeight' || rule === 'lowAndSlow' || rule === 'sink') return 'low';
    const vs1 = ctx.aircraft.vspeeds.Vs1;
    if (num(f.pitchDeg) < -10 || num(f.kias) > ctx.aircraft.vspeeds.Vno) return 'noseLow';
    if (num(f.stallFrac) > STALL_FRAC || num(f.kias) < vs1 || rule === 'pitchUp' || rule === 'stall') return 'slow';
    // Near the ground a bank or g breach with the nose not low gets full power and a climb, never the
    // nose-low idle: just after take-off that idle flew the aircraft into the ground (wave-3 calibration).
    if (num(f.aglFt) < LOW_RECOVERY_AGL_FT) return 'low';
    return 'noseLow';
  }
}
