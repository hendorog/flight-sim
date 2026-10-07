// The instructor-pilot (section 3.9): flies demos, interventions and "I have control" holds through
// ControlInputs, every physics step, with its own Autoflight (so the student's KAP state is untouched).
// Installed as SimPhysics.copilot; it also applies instructor holds (throttle/flap/mixture) while the
// student flies. Node-safe.
//
// HOW IT FLIES
//   Everything the copilot does is a "program" re-applied every physics step: an autopilot configuration
//   (DemoAp converted to SI), or the existing autoflight (take-off, approach, flare, roll-out), or the
//   ground hold (idle, brakes, centreline rudder), plus control writers (`set`, `raw`, `pulse`). Scripts
//   change the program at segment boundaries.
//   While flying it owns the flight controls: anything else wrote since its last step (the keyboard, a
//   joystick) is overwritten with what the copilot last commanded, so student input during a demo has no
//   effect ("light hands, just follow me through"), and the keyboard yoke follows the copilot's controls.
//
// BUMPLESS
//   Taking control from the student cross-fades the yoke and pedals from the student's positions to the
//   copilot's over TAKEOVER_BLEND_S (the autopilot's roll integrator starts at zero, so its first aileron
//   could otherwise jump); throttle loops start from the present throttle. Handing back leaves every control
//   where the copilot last put it, trimmed. Commanded bank and pitch slew at a pilot's rate rather than
//   stepping, so demos look flown, not snapped.
//
// TIMING
//   Segment `until`s and `abortWhen` are compiled predicates evaluated with the runner's EvalContext. That
//   context is rebuilt once per rendered frame while the copilot runs per physics step, so predicates are
//   evaluated once per context tick (when ctx.simT changes) with the context's own dt: held timers then
//   count sim time exactly once. Segment durations and timeouts are counted in physics steps.

import { DEG, FT, KT, clamp, wrapPi } from '../../core/math';
import type { AircraftState, ControlInputs } from '../../core/types';
import { AIRPORT, runwayCoords } from '../../core/world';
import { Autoflight, centrelineRudder } from '../../sim/autoflight';
import { flapDegForLever, flapLeverFor } from '../aircraft/c172s';
import { RECOVERY, type RecoveryScriptKind } from '../content/demos';
import { compile } from '../engine/predicates';
import { resolveRef } from '../engine/refs';
import type { AircraftTypeDef, CompiledPred, CueRef, DemoAp, DemoControl, DemoScript, DemoSegment, EvalContext, Holds, Ramp, Ref, StepController } from '../types';

export type { StepController } from '../types';

/** What the copilot is doing. */
export type CopilotMode = 'idle' | 'holding' | 'demo' | 'recovery';
/** Recovery script variants (section 3.8); 'auto' picks from the state. 'hold' = nothing urgent, just the hold. */
export type RecoveryKind = 'auto' | 'noseLow' | 'slow' | 'low' | 'ground' | 'hold';

const FPM = FT / 60;
/** Cross-fade of yoke and pedals when taking control from the student, s. */
export const TAKEOVER_BLEND_S = 1;
/** The cross-fade when taking control to recover (a save is not the moment to be gentle), s. */
const RECOVERY_BLEND_S = 0.3;
/** Commanded pitch slews at this rate, rad/s (a smooth hand: about 0.4 g of change at 90 kt). */
const PITCH_SLEW = 5 * DEG;
/** Pitch-slew multiplier in the 'low' recovery. */
const LOW_RECOVERY_PITCH_FACTOR = 2;
/** Roll-rate multiplier in a recovery (an instructor rolls out of a spiral briskly). */
const RECOVERY_ROLL_FACTOR = 2.5;
/** Default autopilot bank limit and roll rate when the aircraft type has no demoTuning. */
const DEFAULT_MAX_BANK_DEG = 25;
const DEFAULT_ROLL_RATE_DPS = 12;
/** Altitude-capture vertical-speed limit when a script gives none, fpm. */
const DEFAULT_CAPTURE_FPM = 700;
/** 'auto' recovery: a pitch above this (deg) below Vy is treated as slow. */
const NOSE_HIGH_DEG = 15;
/** 'auto' recovery: below this height (ft AGL) the 'low' recovery (climb at Vy) is chosen. */
const AUTO_LOW_AGL_FT = 500;
/**
 * Stable condition (spec 3.8 step 3), checked from the state; it ends a recovery. The spec's "VS >= 0" is
 * applied as "not descending by more than 150 fpm": the altitude hold ripples about +-150 fpm in light
 * turbulence, and a strict zero (or the vsFpm signal's 50 fpm hysteresis) can take 40 s to hold for 5 s
 * by chance after a stall recovery that is plainly over.
 */
const STABLE = { bankDeg: 5, minKias: 65, maxKias: 100, minVsFpm: -150, minAglFt: 500, forS: 5 };
/**
 * Restore straight and level (a lesson-limit intervention): "stable" is wings within 3 deg, vertical speed within
 * 200 fpm and the speed within 10 kt of the reference, held 3 s. The attitude stage rolls wings level first and
 * only then pulls (roll before pull keeps the load under 2 g); it hands on to the level stage once the wings are
 * within 10 deg, the pitch is near the horizon and the speed is safe.
 */
const LEVEL = {
  bankDeg: 3, vsFpm: 200, kiasTol: 10, forS: 3,
  /** Stage 1 -> 2. */
  handoverBankDeg: 10, minPitchDeg: -4, maxPitchDeg: 10,
  /** No pull above this bank (deg); the pull grows to full strength as the bank falls to fullPullBankDeg. */
  pullBankDeg: 60, fullPullBankDeg: 30,
  /** Commanded roll rate of the roll-out, deg/s. */
  rollRateDps: 45,
  /** The pull: pitch rate for this much extra load (g), at most maxPitchRateDps. */
  pullG: 0.8, maxPitchRateDps: 10, holdG: 1.85, easeG: 1.9,
  /** Stage 1 -> 2 also needs the descent stopped to this, fpm (the level stage then never pulls hard), unless the
   *  nose has sat at its target this long, s. */
  handoverMinVsFpm: -500, settledS: 2,
  /** Level stage: the climb/descent limit grows from nothing at this rate (no pitch step at the hand-on), fpm/s. */
  vsRampFpmPerS: 1000,
  /** Level stage: bank limit when turning back to the reference heading, deg; altitude capture rate, fpm; within
   *  nearFt of the reference the last of the height is made good at nearFpm (stable while it does). */
  maxBankDeg: 20, captureFpm: 500, fastCaptureFpm: 1000, slowCaptureFpm: 150, nearFt: 150, nearFpm: 100,
  /** A heading change smaller than this during the recovery is kept (wings level is what matters), deg. */
  keepHeadingDeg: 30,
  /** The attitude stage never lasts longer than this, s. */
  attitudeCapS: 20,
};
/** Ground hold: centreline rudder only on the runway (elsewhere it would steer toward the runway). */
const GROUND_CENTRELINE_M = 30;

/** The flight controls the copilot owns while it flies (switches, lights and knobs stay the pilot's). */
const OWNED = ['elevator', 'aileron', 'rudder', 'throttle', 'mixture', 'flaps', 'elevatorTrim', 'brakeLeft', 'brakeRight'] as const;
type Owned = (typeof OWNED)[number];
const BLENDED = ['elevator', 'aileron', 'rudder'] as const;

/** A DemoAp resolved to SI (true heading, MSL altitude, IAS), merged across segments. */
interface ApProgram {
  lateral: NonNullable<DemoAp['lateral']>;
  vertical: NonNullable<DemoAp['vertical']>;
  heading: number;
  bank: number;
  maxBank: number;
  pitch: number;
  vs: number;
  altitude: number;
  ias: number;
  autothrottle: boolean;
  yawDamper: boolean;
  autoTrim: boolean;
}

/**
 * Writes one control every step: a fixed value (for its segment) or a linear ramp from the value at segment
 * start. `t` is the writer's own clock, s.
 */
interface Writer { control: DemoControl; from: number; to: number; overS: number; t: number }
/**
 * Levers whose unfinished ramp carries into the next segment (a pilot moves the flap lever to the next stage
 * and leaves it; cutting the move at a segment boundary would leave it part-way). A new segment that sets
 * the same control, an autoflight segment, or (throttle) an engaged autothrottle replaces the carried ramp.
 */
const CARRIED: ReadonlySet<DemoControl> = new Set<DemoControl>(['flapsDeg', 'throttle', 'mixture', 'brakes']);

/**
 * Where restoreLevel() levels the aircraft: indicated altitude (ft), DG heading (deg; null: wings level on
 * whatever heading results) and indicated airspeed (kt), as the student reads them.
 */
export interface LevelReference { altFt: number; hdgDeg: number | null; kias: number }

/** Optional dependencies (tests and the integration pass the defaults). */
export interface InstructorPilotOptions {
  /** The runner's EvalContext provider, used by recover() and holdHere(); run() also sets it. */
  evalCtx?: () => EvalContext;
}

export class InstructorPilot implements StepController {
  /** Own instance (owns its own Autopilot); the student's KAP state is untouched. */
  readonly autoflight = new Autoflight();
  /**
   * Called when a segment with `say` starts (inside the physics step): the runner speaks the cue.
   * Null: cues are dropped.
   */
  onSay: ((cue: CueRef, scriptId: string) => void) | null = null;
  /** Problems met while flying a script (an unresolvable ref fell back to the present value). For tests and logs. */
  readonly warnings: string[] = [];

  private readonly aircraft: AircraftTypeDef;
  private ctxFn: (() => EvalContext) | null;
  private modeV: CopilotMode = 'idle';

  // Script state.
  private script: DemoScript | null = null;
  private segIdx = 0;
  private segTime = 0;
  private segStarted = false;
  private until: CompiledPred | null = null;
  private abort: CompiledPred | null = null;
  private untilMet = false;
  private lastEvalT = NaN;
  private demoVars: Record<string, number> = {};
  private ctxCache: { base: EvalContext; baseVars: Readonly<Record<string, number>>; demoVars: Record<string, number>; ctx: EvalContext } | null = null;
  private result: 'done' | 'aborted' | 'timeout' | null = null;
  /** The running recovery was started by a demo's abortWhen (its completion must not overwrite 'aborted'). */
  private recoveryAfterAbort = false;
  private recoveryKind: RecoveryKind | null = null;

  // Program state (what is flown every step).
  private ap: ApProgram | null = null;
  private apOn = false;
  private afOn = false;
  private groundHold = false;
  private writers: Writer[] = [];
  private pulseBase: { control: DemoControl; value: number } | null = null;
  private bankCmd = 0;
  private pitchCmd = 0;
  /** What to set up on the next update (needs the state): a takeover, a hold or a recovery. */
  private pending: 'run' | 'hold' | 'recover' | 'restore' | null = null;
  private pendingRecovery: RecoveryKind = 'auto';

  // Control ownership and blending.
  private readonly out: Record<Owned, number> = { elevator: 0, aileron: 0, rudder: 0, throttle: 0, mixture: 1, flaps: 0, elevatorTrim: 0, brakeLeft: 0, brakeRight: 0 };
  private outParkingBrake = false;
  private haveOut = false;
  private blendT = Infinity;
  private readonly blendFrom: Record<(typeof BLENDED)[number], number> = { elevator: 0, aileron: 0, rudder: 0 };

  // Holds and the stable monitor.
  private holds: Holds | null = null;
  private stableS = 0;

  // Restore straight and level (restoreLevel).
  private restore: { ref: LevelReference; stage: 'attitude' | 'level'; t: number; refKias: number; settledS: number; vsLimitFpm: number } | null = null;
  private levelS = 0;

  constructor(aircraft: AircraftTypeDef, opts: InstructorPilotOptions = {}) {
    this.aircraft = aircraft;
    this.ctxFn = opts.evalCtx ?? null;
  }

  /** Authority instructor, or a demo/recovery running: the copilot writes the flight controls. */
  get flying(): boolean {
    return this.modeV !== 'idle';
  }

  get mode(): CopilotMode {
    return this.modeV;
  }

  /** The script being flown (a demo or a recovery), or null. */
  get scriptId(): string | null {
    return this.script?.id ?? null;
  }

  /** The recovery variant flown by the last recover() (resolved from 'auto'), or null. */
  get recovery(): RecoveryKind | null {
    return this.recoveryKind;
  }

  /** Replace the EvalContext provider (the runner's, rebuilt per frame). */
  setContext(evalCtx: (() => EvalContext) | null): void {
    this.ctxFn = evalCtx;
  }

  /**
   * Run a demo script. Segment `until`s are evaluated with the runner's context (`evalCtx`) each physics
   * step; the result is reported through `demoResult` (the runner emits demo.done). Takes control on the
   * next physics step if the student had it.
   */
  run(script: DemoScript, evalCtx: () => EvalContext): void {
    this.restore = null;
    this.ctxFn = evalCtx;
    this.result = null;
    this.recoveryAfterAbort = false;
    this.startScript(script, 'demo');
    this.pending = 'run';
  }

  /**
   * Wings level, hold the present altitude and speed ("I have control"). On the ground: idle and brakes.
   * A demo in progress ends 'aborted'.
   */
  holdHere(): void {
    this.restore = null;
    this.abandonDemo();
    this.clearScript();
    this.modeV = 'holding';
    this.pending = 'hold';
  }

  /**
   * Recover (section 3.8): 'auto' chooses from the state on the next step (ground, slow or stalled, nose
   * low, low, else just the hold). Ends 'done' when stable; the copilot then keeps holding.
   */
  recover(kind: RecoveryKind = 'auto'): void {
    this.restore = null;
    this.result = null;
    this.recoveryAfterAbort = false;
    this.clearScript();
    this.modeV = 'recovery';
    this.pending = 'recover';
    this.pendingRecovery = kind;
  }

  /**
   * Restore straight and level at `ref` (a lesson-limit intervention, not a safety save): roll wings level and
   * bring the nose to the horizon (idle if fast and nose low, full power if slow), then hold the reference
   * altitude, heading and speed. `levelStable` reports wings level, vertical speed and speed within limits for
   * 3 s; the copilot keeps holding until handed back. Never exceeds 2 g from the attitudes lesson limits allow
   * (bank to 60 deg, pitch +-30 deg, 50-130 kt).
   */
  restoreLevel(ref: LevelReference): void {
    this.result = null;
    this.recoveryAfterAbort = false;
    this.abandonDemo();
    this.clearScript();
    this.modeV = 'recovery';
    this.pending = 'restore';
    const vs = this.aircraft.vspeeds;
    this.restore = { ref: { ...ref }, stage: 'attitude', t: 0, refKias: clamp(ref.kias, vs.Vs1 + 17, vs.Vno - 10), settledS: 0, vsLimitFpm: 0 };
    this.levelS = 0;
  }

  /** restoreLevel(): wings within 3 deg, VS within 200 fpm and speed within 10 kt of the reference for 3 s. */
  get levelStable(): boolean {
    return this.restore !== null && this.levelS >= LEVEL.forS;
  }

  /** The speed restoreLevel() holds (the reference clamped to a safe band), kt; null when not restoring. */
  get levelReferenceKias(): number | null {
    return this.restore?.refKias ?? null;
  }

  /**
   * The aircraft was put somewhere new (a reposition or a checkpoint restore): what the copilot last wrote to
   * the controls belongs to the old flight. Take the controls as the new start set them (its flap lever,
   * throttle, trim) and, when holding, hold the new state. Without this the next step wrote the old controls
   * back: after the L09 landing demo the reposition onto final had its flap lever put back to 0 (wave-3
   * playtest).
   */
  resync(): void {
    this.haveOut = false;
    this.blendT = Infinity;
    if (this.modeV === 'holding' && !this.script) this.pending = 'hold';
  }

  /** Applied every step, even while the student flies; null releases. (The runner evaluates `release`.) */
  setHolds(h: Holds | null): void {
    this.holds = h ? { ...h } : null;
  }

  get currentHolds(): Holds | null {
    return this.holds;
  }

  /** Release the controls (the student has control); holds stay. Controls stay where the copilot left them. */
  stop(): void {
    this.restore = null;
    this.abandonDemo();
    this.clearScript();
    this.autoflight.disengage();
    this.ap = null;
    this.apOn = this.afOn = this.groundHold = false;
    this.pending = null;
    this.blendT = Infinity;
    this.haveOut = false;
    this.modeV = 'idle';
  }

  update(h: number, s: AircraftState, c: ControlInputs): void {
    if (this.modeV !== 'idle' && !s.crashed) {
      if (this.haveOut) this.restoreOwned(c);
      else this.beginTakeover(c);
      if (this.pending) this.resolvePending(s, c);
      if (this.restore) this.updateRestore(h, s, c);
      if (this.script) this.advanceScript(s, c);
      this.fly(h, s, c);
      this.blend(h, c);
      if (this.script) this.segTime += h;
      this.trackStable(h, s);
    }
    this.applyHolds(c);
    if (this.modeV !== 'idle') this.saveOwned(c);
  }

  get segmentIndex(): number {
    return this.segIdx;
  }

  /** Sim time in the current segment, s. */
  get segmentT(): number {
    return this.segTime;
  }

  /** Outcome of the last demo or recovery: null while running or idle. Cleared by run()/recover(). */
  get demoResult(): 'done' | 'aborted' | 'timeout' | null {
    return this.result;
  }

  /** Stable for 5 s: wings ±5°, IAS 65-100 kt, not descending (see STABLE), above 500 ft AGL. Ends a recovery. */
  get stable(): boolean {
    return this.stableS >= STABLE.forS;
  }

  // ---- setup ---------------------------------------------------------------------------------------------

  /** A demo cut short by stop() or holdHere() reports 'aborted' (the runner is waiting for a result). */
  private abandonDemo(): void {
    if (this.script && this.result === null && this.modeV === 'demo') this.result = 'aborted';
  }

  private startScript(script: DemoScript, mode: 'demo' | 'recovery'): void {
    this.script = script;
    this.segIdx = 0;
    this.segTime = 0;
    this.segStarted = false;
    this.until = null;
    this.untilMet = false;
    this.lastEvalT = NaN;
    this.abort = script.abortWhen ? compile(script.abortWhen) : null;
    this.demoVars = {};
    this.writers = [];
    this.pulseBase = null;
    this.groundHold = false;
    this.modeV = mode;
  }

  private clearScript(): void {
    this.script = null;
    this.until = this.abort = null;
    this.untilMet = false;
    this.writers = [];
    this.pulseBase = null;
    this.segIdx = 0;
    this.segTime = 0;
    this.segStarted = false;
  }

  /** First step with control: own the controls from where the student left them, and cross-fade. */
  private beginTakeover(c: ControlInputs): void {
    this.saveOwned(c);
    for (const k of BLENDED) this.blendFrom[k] = c[k];
    this.blendT = 0;
  }

  private resolvePending(s: AircraftState, c: ControlInputs): void {
    const what = this.pending;
    this.pending = null;
    this.stableS = 0;
    if (what === 'hold') {
      this.configureHold(s, c);
    } else if (what === 'recover') {
      const kind = this.pendingRecovery === 'auto' ? chooseRecovery(s, this.aircraft) : this.pendingRecovery;
      this.beginRecovery(kind, s, c);
    } else if (what === 'restore') {
      this.beginRestore(s, c);
    }
    // 'run': the script's first segment starts in advanceScript (same step).
  }

  private beginRecovery(kind: RecoveryKind, s: AircraftState, c: ControlInputs): void {
    this.recoveryKind = kind;
    this.autoflight.disengage();
    this.afOn = false;
    if (kind === 'ground' || kind === 'auto') {
      this.clearScript();
      this.modeV = 'recovery';
      this.apOn = false;
      this.groundHold = true;
      return;
    }
    if (!this.ctxFn) {
      // No runner context to evaluate the script's predicates: the plain hold is the safe fallback.
      this.warnings.push(`recover(${kind}): no EvalContext, holding instead`);
      this.clearScript();
      this.modeV = 'recovery';
      this.configureHold(s, c);
      return;
    }
    this.startScript(RECOVERY[kind as RecoveryScriptKind], 'recovery');
  }

  // ---- restore straight and level --------------------------------------------------------------------------

  private beginRestore(s: AircraftState, c: ControlInputs): void {
    const r = this.restore!;
    this.recoveryKind = 'hold';
    this.autoflight.disengage();
    this.afOn = false;
    this.writers = [];
    if (onGround(s)) {
      this.restore = null;
      this.configureHold(s, c);
      return;
    }
    r.stage = 'attitude';
    r.t = 0;
    this.ap = {
      ...this.defaultAp(s), lateral: 'bank', bank: 0, maxBank: 60 * DEG, vertical: 'pitch', pitch: s.pitch,
      autothrottle: false, yawDamper: true, autoTrim: true,
    };
    this.apOn = false;
    this.activateAp(s);
    if (this.attitudeDone(s)) this.beginLevelStage(s);
  }

  /** Stage 1 is over: wings nearly level, the nose near the horizon, a safe speed. */
  private attitudeDone(s: AircraftState, pitchSettled = false): boolean {
    const vs = this.aircraft.vspeeds;
    const kias = s.ias / KT;
    return Math.abs(s.roll) < LEVEL.handoverBankDeg * DEG && s.pitch > LEVEL.minPitchDeg * DEG && s.pitch < LEVEL.maxPitchDeg * DEG
      && kias > vs.Vs1 + 12 && kias < vs.Vno + 5 && s.stallFraction < 0.05
      && (pitchSettled || s.verticalSpeed / FPM > LEVEL.handoverMinVsFpm);
  }

  private beginLevelStage(s: AircraftState): void {
    const r = this.restore!;
    r.stage = 'level';
    r.vsLimitFpm = 0;
    this.writers = [];
    const off = this.readOffsets(s);
    const p = this.ap ?? this.defaultAp(s);
    const refHdg = r.ref.hdgDeg === null ? null : (r.ref.hdgDeg - off.hdg) * DEG;
    const turnBack = refHdg !== null && Math.abs(wrapPi(refHdg - s.heading)) > LEVEL.keepHeadingDeg * DEG;
    this.ap = {
      ...p,
      lateral: 'heading',
      heading: turnBack ? (refHdg as number) : s.heading,
      bank: 0,
      maxBank: LEVEL.maxBankDeg * DEG,
      vertical: 'altitude',
      altitude: (r.ref.altFt - off.alt) * FT,
      vs: 50 * FPM,
      ias: r.refKias * KT,
      autothrottle: true,
      yawDamper: true,
      autoTrim: true,
    };
  }

  private updateRestore(h: number, s: AircraftState, c: ControlInputs): void {
    const r = this.restore!;
    if (this.pending) return;
    r.t += h;
    if (r.stage === 'attitude') {
      const vs = this.aircraft.vspeeds;
      const kias = s.ias / KT;
      const slow = kias < vs.Vs1 + 12 || s.stallFraction > 0.1 || (s.pitch > 12 * DEG && kias < vs.Vy);
      const fast = kias > Math.max(r.refKias + 10, vs.Vcruise + 10);
      // Slow or stalling: nose just below the horizon, full power. Otherwise the horizon; power off when nose
      // low or fast (a spiral is flown out at idle).
      const target = slow ? -3 * DEG : 0;
      if (slow) c.throttle = 1;
      else if (fast || (s.pitch < -5 * DEG && kias > vs.Vy + 10)) c.throttle = 0;
      else if (kias < vs.Vy) c.throttle = 1;
      const ap = this.ap!;
      ap.lateral = 'bank';
      ap.bank = 0;
      ap.vertical = 'pitch';
      // Roll before pull: with the wings steeply banked a pull only tightens the spiral and loads the wing.
      // Lowering the nose (slow) is always allowed.
      const pullUp = target > this.pitchCmd;
      const bankDeg = Math.abs(s.roll) / DEG;
      const strength = pullUp ? clamp((LEVEL.pullBankDeg - bankDeg) / (LEVEL.pullBankDeg - LEVEL.fullPullBankDeg), 0, 1) : 1;
      // g limiter: hold the pull at 1.85 g and ease it above 1.9 g (never 2 g in a training save).
      const gEase = pullUp && s.gLoad > LEVEL.easeG;
      const rate = (pullUp && s.gLoad > LEVEL.holdG ? 0 : strength) * Math.min(LEVEL.maxPitchRateDps * DEG, (LEVEL.pullG * 9.81) / Math.max(s.tas, 20));
      if (gEase) this.pitchCmd = Math.max(s.pitch - 2 * DEG, this.pitchCmd - LEVEL.maxPitchRateDps * DEG * h);
      else this.pitchCmd += clamp(target - this.pitchCmd, -rate * h, rate * h);
      ap.pitch = this.pitchCmd;
      // The nose is where it was going (a slow descent at the horizon is the level stage's to fix).
      const settled = Math.abs(this.pitchCmd - target) < 0.1 * DEG && Math.abs(s.pitch - target) < 1.5 * DEG;
      r.settledS = settled ? r.settledS + h : 0;
      if (this.attitudeDone(s, r.settledS >= LEVEL.settledS) || r.t > LEVEL.attitudeCapS) this.beginLevelStage(s);
    } else if (this.ap) {
      // Near the reference the last of the height comes back slowly enough to count as level.
      // Well below the reference: climb back at full power (or at idle while the dive's excess speed lasts,
      // traded for height at the faster rate); near it the autothrottle takes the speed (bumpless).
      const errFt = Math.abs(this.ap.altitude - s.altitudeMSL) / FT;
      const below = this.ap.altitude > s.altitudeMSL && errFt >= LEVEL.nearFt;
      const kias = s.ias / KT;
      this.ap.autothrottle = !below;
      if (below && kias < r.refKias + 10) c.throttle = 1;
      // Slow (after a stall recovery), accelerate first: climb only gently until the speed is back.
      const fpm = errFt < LEVEL.nearFt ? LEVEL.nearFpm
        : below && kias > r.refKias + 5 ? LEVEL.fastCaptureFpm
        : below && kias < r.refKias - 8 ? LEVEL.slowCaptureFpm : LEVEL.captureFpm;
      r.vsLimitFpm = Math.min(fpm, r.vsLimitFpm + LEVEL.vsRampFpmPerS * h);
      this.ap.vs = Math.max(r.vsLimitFpm, 50) * FPM;
    }
  }

  /** Wings level, present altitude and speed (or the ground hold). */
  private configureHold(s: AircraftState, c: ControlInputs): void {
    this.autoflight.disengage();
    this.afOn = false;
    this.writers = [];
    if (onGround(s)) {
      this.apOn = false;
      this.groundHold = true;
      return;
    }
    this.groundHold = false;
    const vs = this.aircraft.vspeeds;
    if (onFinal07(s)) {
      // Established on final, "hold here" means keep flying the approach: an altitude hold during a handover
      // offer left the aircraft 380 ft high and off the centreline by the time the student took it (wave-3
      // playtest). The autoflight approach tracks the centreline and the 3° path at the present speed.
      this.apOn = false;
      this.autoflight.engage({ kind: 'approach', kias: clamp(s.ias / KT, vs.Vs1 + 12, vs.VfeFull) }, s, c);
      this.afOn = true;
      return;
    }
    this.ap = {
      ...this.defaultAp(s),
      lateral: 'wingLeveler',
      vertical: 'altitude',
      altitude: s.altitudeMSL,
      autothrottle: true,
      ias: clamp(s.ias, (vs.Vs1 + 12) * KT, (vs.Vno - 10) * KT),
    };
    this.activateAp(s);
  }

  // ---- scripts -------------------------------------------------------------------------------------------

  private advanceScript(s: AircraftState, c: ControlInputs): void {
    const script = this.script!;
    if (!this.segStarted) {
      if (this.segIdx === 0) this.captureDemoVars(s, c);
      this.startSegment(script.segments[this.segIdx], s, c);
    }
    this.evaluate();
    if (this.modeV === 'recovery' && this.stable) {
      this.endScript('done', s, c);
      return;
    }
    if (this.abort?.value && this.modeV === 'demo') {
      this.result = 'aborted';
      this.recoveryAfterAbort = true;
      this.beginRecovery(chooseRecovery(s, this.aircraft), s, c);
      if (this.script) this.startSegment(this.script.segments[0], s, c);
      return;
    }
    // A segment may end on the step it starts only through its own duration; until-predicates need a tick.
    for (let guard = 0; guard < 4 && this.script; guard++) {
      const seg = this.script.segments[this.segIdx];
      const end = this.segmentEnd(seg);
      if (end === null) return;
      this.finishSegment(seg, c);
      // A recovery never stops part-way: a stage that times out hands on to the next (ending in the hold).
      if (end === 'timeout' && this.modeV !== 'recovery') {
        this.endScript('timeout', s, c);
        return;
      }
      this.segIdx++;
      if (this.segIdx >= this.script.segments.length) {
        this.endScript('done', s, c);
        return;
      }
      this.startSegment(this.script.segments[this.segIdx], s, c);
    }
  }

  /** Evaluate until/abort once per EvalContext tick (see TIMING). */
  private evaluate(): void {
    if (!this.ctxFn || (!this.until && !this.abort)) return;
    const ctx = this.scriptContext();
    if (!ctx || ctx.simT === this.lastEvalT) return;
    this.lastEvalT = ctx.simT;
    if (this.until) this.untilMet = this.until.eval(ctx);
    if (this.abort) this.abort.eval(ctx);
  }

  private segmentEnd(seg: DemoSegment): 'next' | 'timeout' | null {
    switch (seg.kind) {
      case 'ap':
      case 'autoflight':
        if (this.untilMet) return 'next';
        return this.segTime >= seg.timeoutS ? 'timeout' : null;
      case 'raw':
        return this.segTime >= seg.forS ? 'next' : null;
      case 'pulse':
        return this.segTime >= seg.holdS ? 'next' : null;
      case 'pause':
        return this.segTime >= seg.s ? 'next' : null;
    }
  }

  private finishSegment(seg: DemoSegment, c: ControlInputs): void {
    if (seg.kind === 'pulse' && this.pulseBase) {
      writeControl(c, this.pulseBase.control, this.pulseBase.value, this.aircraft);
      this.pulseBase = null;
    }
    // Unfinished lever ramps carry on (CARRIED); everything else ends with its segment.
    this.writers = this.writers.filter((w) => CARRIED.has(w.control) && w.overS > 0 && w.t < w.overS);
  }

  private endScript(result: 'done' | 'timeout', s: AircraftState, c: ControlInputs): void {
    const wasRecovery = this.modeV === 'recovery';
    if (!(wasRecovery && this.recoveryAfterAbort)) this.result = result;
    this.clearScript();
    // Keep flying what the last segment set up (a demo's final state, a recovery's hold) until handed back;
    // with nothing running, hold here.
    if (!this.apOn && !this.afOn && !this.groundHold) this.configureHold(s, c);
    if (!wasRecovery) this.modeV = 'holding';
  }

  private startSegment(seg: DemoSegment, s: AircraftState, c: ControlInputs): void {
    this.segStarted = true;
    this.segTime = 0;
    this.untilMet = false;
    const carried = this.writers;
    this.writers = [];
    this.pulseBase = null;
    if (seg.say !== undefined) this.onSay?.(seg.say, this.script?.id ?? '');
    const ctx = this.scriptContext();
    const R = (r: Ref, fallback: number, what: string): number => this.resolve(r, ctx, fallback, what);
    switch (seg.kind) {
      case 'ap':
        this.until = compile(seg.until);
        this.leaveAutoflight();
        this.ap = this.mergeAp(seg.ap, s, c, R);
        this.activateAp(s);
        if (seg.set) this.writers = this.makeWriters(seg.set, c, R);
        // Setting a lever is one movement: it happens now, even if the segment ends on this very step (an
        // `until` already true). Otherwise "Flap thirty" left the flaps at 20 for the whole landing demo.
        for (const w of this.writers) if (w.overS === 0 && CARRIED.has(w.control)) writeControl(c, w.control, w.to, this.aircraft, s.ias / KT);
        break;
      case 'autoflight':
        this.until = compile(seg.until);
        this.apOn = false;
        this.groundHold = false;
        this.autoflight.engage(seg.plan, s, c);
        this.afOn = true;
        break;
      case 'raw':
        this.until = null;
        this.leaveAutoflight();
        if (seg.ap) {
          this.ap = this.mergeAp(seg.ap, s, c, R);
          this.activateAp(s);
        } else this.apOn = false;
        this.writers = Object.entries(seg.hold).map(([k, v]) => ({ control: k as DemoControl, from: v, to: v, overS: 0, t: 0 }));
        break;
      case 'pulse': {
        this.until = null;
        this.leaveAutoflight();
        this.apOn = false;
        const base = readControl(c, seg.control, this.aircraft);
        this.pulseBase = { control: seg.control, value: base };
        const v = base + seg.amount;
        this.writers = [{ control: seg.control, from: v, to: v, overS: 0, t: 0 }];
        break;
      }
      case 'pause':
        this.until = null;
        break;
    }
    if (seg.kind !== 'autoflight') {
      const autothrottle = this.apOn && !!this.ap?.autothrottle;
      for (const w of carried) {
        if (this.writers.some((n) => n.control === w.control)) continue;
        if (w.control === 'throttle' && autothrottle) continue;
        this.writers.push(w);
      }
    }
  }

  private leaveAutoflight(): void {
    if (this.afOn) {
      this.autoflight.disengage();
      this.afOn = false;
      this.ap = null;
    }
    this.groundHold = false;
  }

  /** Demo-start captures (DEMO_START_VARS): from the telemetry frame when there is one, else the state. */
  private captureDemoVars(s: AircraftState, c: ControlInputs): void {
    const f = this.ctxFn?.().frame;
    const num = (id: string, fallback: number): number => {
      const v = f?.[id];
      return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    };
    this.demoVars = {
      'demo.altFt': num('altFt', s.altitudeMSL / FT),
      'demo.hdgDeg': num('hdgDeg', ((s.heading / DEG) % 360 + 360) % 360),
      'demo.kias': num('kias', s.ias / KT),
      'demo.aglFt': num('aglFt', s.altitudeAGL / FT),
      'demo.throttle': c.throttle,
      'demo.flapsDeg': flapDegForLever(this.aircraft, c.flaps),
    };
  }

  /**
   * The runner's context with the demo-start captures layered over its vars, for the script's refs and
   * predicates. Cached while the runner's context object and its vars object are unchanged.
   */
  private scriptContext(): EvalContext | null {
    const ctx = this.ctxFn?.();
    if (!ctx) return null;
    const c = this.ctxCache;
    if (c && c.base === ctx && c.baseVars === ctx.vars && c.demoVars === this.demoVars) return c.ctx;
    const vars = { ...ctx.vars, ...this.demoVars };
    const wrapped = Object.create(ctx, { vars: { value: vars, enumerable: true } }) as EvalContext;
    this.ctxCache = { base: ctx, baseVars: ctx.vars, demoVars: this.demoVars, ctx: wrapped };
    return wrapped;
  }

  private resolve(r: Ref, ctx: EvalContext | null, fallback: number, what: string): number {
    let v = NaN;
    if (typeof r === 'number') v = r;
    else if (ctx) v = resolveRef(r, ctx);
    if (Number.isFinite(v)) return v;
    this.warnings.push(`${this.script?.id ?? '?'}[${this.segIdx}] ${what}: ${JSON.stringify(r)} unresolved, using the present value`);
    return fallback;
  }

  /** Offsets between what the student reads and the truth: DG minus true heading (deg), indicated minus MSL altitude (ft). */
  private readOffsets(s: AircraftState): { hdg: number; alt: number } {
    const f = this.ctxFn?.().frame;
    const n = (id: string): number => {
      const v = f?.[id];
      return typeof v === 'number' ? v : NaN;
    };
    const hdg = n('hdgDeg') - n('hdgTrueDeg');
    const alt = n('altFt') - s.altitudeMSL / FT;
    return { hdg: Number.isFinite(hdg) ? hdg : 0, alt: Number.isFinite(alt) ? alt : 0 };
  }

  /** The starting point of a script: wings level, altitude hold here, no autothrottle. */
  private defaultAp(s: AircraftState): ApProgram {
    const tuning = this.aircraft.demoTuning;
    return {
      lateral: 'wingLeveler',
      vertical: 'altitude',
      heading: s.heading,
      bank: 0,
      maxBank: (tuning?.maxBankDeg ?? DEFAULT_MAX_BANK_DEG) * DEG,
      pitch: s.pitch,
      vs: DEFAULT_CAPTURE_FPM * FPM,
      altitude: s.altitudeMSL,
      ias: s.ias,
      autothrottle: false,
      yawDamper: true,
      autoTrim: true,
    };
  }

  /** Merge a segment's DemoAp onto the program: given fields resolved, newly engaged modes hold the present value. */
  private mergeAp(a: DemoAp, s: AircraftState, c: ControlInputs, R: (r: Ref, fallback: number, what: string) => number): ApProgram {
    const prev = this.ap ?? this.defaultAp(s);
    const next: ApProgram = { ...prev };
    const off = this.readOffsets(s);
    if (a.lateral) next.lateral = a.lateral;
    if (a.vertical) next.vertical = a.vertical;
    const newLat = next.lateral !== prev.lateral || !this.ap;
    const newVert = next.vertical !== prev.vertical || !this.ap;
    // Lateral targets.
    if (a.hdgDeg !== undefined) next.heading = (R(a.hdgDeg, s.heading / DEG + off.hdg, 'hdgDeg') - off.hdg) * DEG;
    else if (newLat && next.lateral === 'heading') next.heading = s.heading;
    if (a.bankDeg !== undefined) next.bank = R(a.bankDeg, s.roll / DEG, 'bankDeg') * DEG;
    else if (newLat && next.lateral === 'bank') next.bank = s.roll;
    if (a.maxBankDeg !== undefined) next.maxBank = a.maxBankDeg * DEG;
    // Vertical targets.
    if (a.pitchDeg !== undefined) next.pitch = R(a.pitchDeg, s.pitch / DEG, 'pitchDeg') * DEG;
    else if (newVert && next.vertical === 'pitch') next.pitch = s.pitch;
    if (a.vsFpm !== undefined) next.vs = R(a.vsFpm, s.verticalSpeed / FPM, 'vsFpm') * FPM;
    else if (newVert && next.vertical === 'verticalSpeed') next.vs = s.verticalSpeed;
    else if (newVert && next.vertical === 'altitude' && !(prev.vertical === 'altitude' || prev.vertical === 'verticalSpeed')) next.vs = DEFAULT_CAPTURE_FPM * FPM;
    if (a.altFt !== undefined) next.altitude = (R(a.altFt, s.altitudeMSL / FT + off.alt, 'altFt') - off.alt) * FT;
    else if (newVert && next.vertical === 'altitude') next.altitude = s.altitudeMSL;
    // Speed: 'airspeed' mode or the autothrottle.
    if (a.autothrottle !== undefined) next.autothrottle = a.autothrottle;
    if (a.kias !== undefined) next.ias = R(a.kias, s.ias / KT, 'kias') * KT;
    else if ((newVert && next.vertical === 'airspeed') || (next.autothrottle && !prev.autothrottle)) next.ias = s.ias;
    if (a.yawDamper !== undefined) next.yawDamper = a.yawDamper;
    if (a.autoTrim !== undefined) next.autoTrim = a.autoTrim;
    // Slewed commands restart from the present attitude when their mode is newly engaged.
    if (next.lateral === 'bank' && (newLat || !this.apOn)) this.bankCmd = s.roll;
    if (next.vertical === 'pitch' && (newVert || !this.apOn)) this.pitchCmd = s.pitch;
    return next;
  }

  private activateAp(s: AircraftState): void {
    if (!this.apOn) {
      // Bumpless (re-)engagement: the autopilot's loops start from the present controls and attitude.
      this.autoflight.autopilot.reset();
      this.bankCmd = s.roll;
      this.pitchCmd = s.pitch;
    }
    this.apOn = true;
    this.groundHold = false;
  }

  private makeWriters(set: Partial<Record<DemoControl, number | Ramp>>, c: ControlInputs, R: (r: Ref, fallback: number, what: string) => number): Writer[] {
    const out: Writer[] = [];
    for (const [key, spec] of Object.entries(set) as [DemoControl, number | Ramp][]) {
      const from = readControl(c, key, this.aircraft);
      if (typeof spec === 'number') out.push({ control: key, from: spec, to: spec, overS: 0, t: 0 });
      else out.push({ control: key, from, to: R(spec.to, from, `set.${key}`), overS: Math.max(0, spec.overS), t: 0 });
    }
    return out;
  }

  // ---- flying --------------------------------------------------------------------------------------------

  private fly(h: number, s: AircraftState, c: ControlInputs): void {
    if (this.groundHold) this.flyGroundHold(s, c);
    else if (this.afOn) this.autoflight.update(h, s, c);
    else if (this.apOn && this.ap) this.flyAp(h, s, c, this.ap);
    for (const w of this.writers) {
      const v = w.overS > 0 ? w.from + (w.to - w.from) * Math.min(1, w.t / w.overS) : w.to;
      // A flap extension held back by the speed gate keeps its ramp where it is until the speed allows it.
      if (writeControl(c, w.control, v, this.aircraft, s.ias / KT)) w.t += h;
    }
  }

  private flyAp(h: number, s: AircraftState, c: ControlInputs, p: ApProgram): void {
    const st = this.autoflight.autopilot.settings;
    const rollRate = this.restore?.stage === 'attitude' ? LEVEL.rollRateDps * DEG
      : (this.aircraft.demoTuning?.rollRateDps ?? DEFAULT_ROLL_RATE_DPS) * DEG * (this.modeV === 'recovery' ? RECOVERY_ROLL_FACTOR : 1);
    if (p.lateral === 'bank') this.bankCmd += clamp(p.bank - this.bankCmd, -rollRate * h, rollRate * h);
    // Near the ground (the 'low' recovery) the nose comes up twice as briskly: at 1,000 fpm below 300 ft
    // every second counts, and at approach speeds the extra rate costs well under 1 g.
    const slew = PITCH_SLEW * (this.modeV === 'recovery' && this.recoveryKind === 'low' ? LOW_RECOVERY_PITCH_FACTOR : 1);
    if (p.vertical === 'pitch') this.pitchCmd += clamp(p.pitch - this.pitchCmd, -slew * h, slew * h);
    st.lateral = p.lateral;
    st.vertical = p.vertical;
    st.heading = wrapPi(p.heading);
    st.bank = this.bankCmd;
    st.maxBank = Math.max(p.maxBank, Math.abs(p.lateral === 'bank' ? p.bank : 0) + 1 * DEG);
    st.pitch = this.pitchCmd;
    st.altitude = p.altitude;
    st.verticalSpeed = p.vertical === 'altitude' ? Math.abs(p.vs) : p.vs;
    st.airspeed = p.ias;
    st.autothrottle = p.autothrottle;
    st.yawDamper = p.yawDamper;
    st.autoTrim = p.autoTrim;
    this.autoflight.autopilot.update(h, s, c);
  }

  /** On the ground: idle, brakes, wings level, and the autoflight's centreline rudder while on the runway. */
  private flyGroundHold(s: AircraftState, c: ControlInputs): void {
    c.throttle = 0;
    c.brakeLeft = c.brakeRight = 1;
    c.aileron = 0;
    const rc = runwayCoords(s.position.x, s.position.y);
    const rwy = AIRPORT.runway;
    const onRunway = Math.abs(rc.across) < GROUND_CENTRELINE_M && Math.abs(rc.along) < rwy.length / 2 + 50;
    if (onRunway && s.groundSpeed > 1) {
      const course = Math.cos(s.heading - rwy.heading) >= 0 ? rwy.heading : rwy.heading + Math.PI;
      c.rudder = centrelineRudder(s, course);
    } else c.rudder = 0;
    if (this.modeV === 'recovery' && s.groundSpeed < 0.5 && this.result === null && !this.recoveryAfterAbort) this.result = 'done';
  }

  private blend(h: number, c: ControlInputs): void {
    const span = this.modeV === 'recovery' ? RECOVERY_BLEND_S : TAKEOVER_BLEND_S;
    if (this.blendT >= span) return;
    this.blendT += h;
    const w = Math.min(1, this.blendT / span);
    for (const k of BLENDED) c[k] = this.blendFrom[k] + (c[k] - this.blendFrom[k]) * w;
  }

  private applyHolds(c: ControlInputs): void {
    const hd = this.holds;
    if (!hd) return;
    if (hd.throttle !== undefined) c.throttle = clamp(hd.throttle, 0, 1);
    if (hd.mixture !== undefined) c.mixture = clamp(hd.mixture, 0, 1);
    if (hd.flapsDeg !== undefined) c.flaps = clamp(flapLeverFor(this.aircraft, hd.flapsDeg), 0, 1);
  }

  private trackStable(h: number, s: AircraftState): void {
    const r = this.restore;
    if (r) {
      const level = r.stage === 'level' && !s.onGround && Math.abs(s.roll) <= LEVEL.bankDeg * DEG
        && Math.abs(s.verticalSpeed / FPM) <= LEVEL.vsFpm && Math.abs(s.ias / KT - r.refKias) <= LEVEL.kiasTol;
      this.levelS = level ? this.levelS + h : 0;
    }
    const kias = s.ias / KT;
    const ok =
      !s.onGround &&
      Math.abs(s.roll) <= STABLE.bankDeg * DEG &&
      kias >= STABLE.minKias &&
      kias <= STABLE.maxKias &&
      s.verticalSpeed / FPM >= STABLE.minVsFpm &&
      s.altitudeAGL / FT > STABLE.minAglFt;
    this.stableS = ok ? this.stableS + h : 0;
  }

  private saveOwned(c: ControlInputs): void {
    for (const k of OWNED) this.out[k] = c[k];
    this.outParkingBrake = c.parkingBrake;
    this.haveOut = true;
  }

  private restoreOwned(c: ControlInputs): void {
    for (const k of OWNED) c[k] = this.out[k];
    c.parkingBrake = this.outParkingBrake;
  }
}

// ---- helpers --------------------------------------------------------------------------------------------------

/** Final for runway 07 (the autoflight's approach): this far out, this close to the centreline, ft/m/deg. */
const FINAL = { maxDistM: 6 * 1852, maxAcrossM: 300, maxHdgDeg: 30, maxAglFt: 2000, maxVsFpm: 200 };

/** Lined up on a 07 final, below circuit-joining height and not climbing away (a go-around). */
function onFinal07(s: AircraftState): boolean {
  const rwy = AIRPORT.runway;
  const rc = runwayCoords(s.position.x, s.position.y);
  const beforeThreshold = -rwy.length / 2 - rc.along;
  return beforeThreshold > 0 && beforeThreshold < FINAL.maxDistM && Math.abs(rc.across) < FINAL.maxAcrossM
    && Math.abs(wrapPi(s.heading - rwy.heading)) < FINAL.maxHdgDeg * DEG
    && s.altitudeAGL / FT < FINAL.maxAglFt && s.verticalSpeed / FPM < FINAL.maxVsFpm;
}

function onGround(s: AircraftState): boolean {
  return s.onGround || s.wheels.some((w) => w.onGround);
}

/**
 * The recovery for the present state (section 3.8 order, with the stall checked before nose-low: a wing
 * drop at the stall is nose-low too, and pulling to the horizon there would stall it again). A nose-high
 * attitude below Vy counts as slow: it is about to be (the L19 nose-high unusual attitude).
 */
export function chooseRecovery(s: AircraftState, type: AircraftTypeDef): Exclude<RecoveryKind, 'auto'> {
  const kias = s.ias / KT;
  const vs = type.vspeeds;
  if (onGround(s)) return 'ground';
  if (s.stallFraction > 0.1 || kias < vs.Vs1 || (s.pitch > NOSE_HIGH_DEG * DEG && kias < vs.Vy)) return 'slow';
  if (s.pitch < -10 * DEG || kias > vs.Vno) return 'noseLow';
  if (s.altitudeAGL / FT < AUTO_LOW_AGL_FT) return 'low';
  return 'hold';
}

/** Current value of a demo control in its own units (flapsDeg in degrees, the rest as ControlInputs). */
function readControl(c: ControlInputs, k: DemoControl, type: AircraftTypeDef): number {
  switch (k) {
    case 'throttle':
      return c.throttle;
    case 'mixture':
      return c.mixture;
    case 'trim':
      return c.elevatorTrim;
    case 'elevator':
      return c.elevator;
    case 'aileron':
      return c.aileron;
    case 'rudder':
      return c.rudder;
    case 'brakes':
      return Math.max(c.brakeLeft, c.brakeRight);
    case 'flapsDeg':
      return flapDegForLever(type, c.flaps);
  }
}

/**
 * Write one demo control. Flap extension is gated on airspeed: the instructor never selects more flap above the
 * top of the white arc (VfeFull), the way she teaches it, even where the POH allows the first stage higher. A
 * blocked extension returns false so a lever ramp can wait instead of jumping once the speed is back.
 */
function writeControl(c: ControlInputs, k: DemoControl, v: number, type: AircraftTypeDef, kias?: number): boolean {
  switch (k) {
    case 'throttle':
      c.throttle = clamp(v, 0, 1);
      return true;
    case 'mixture':
      c.mixture = clamp(v, 0, 1);
      return true;
    case 'trim':
      c.elevatorTrim = clamp(v, -1, 1);
      return true;
    case 'elevator':
      c.elevator = clamp(v, -1, 1);
      return true;
    case 'aileron':
      c.aileron = clamp(v, -1, 1);
      return true;
    case 'rudder':
      c.rudder = clamp(v, -1, 1);
      return true;
    case 'brakes':
      c.brakeLeft = c.brakeRight = clamp(v, 0, 1);
      return true;
    case 'flapsDeg': {
      const current = flapDegForLever(type, c.flaps);
      if (kias !== undefined && v > current + 0.25 && kias > type.vspeeds.VfeFull) return false;
      c.flaps = clamp(flapLeverFor(type, v), 0, 1);
      return true;
    }
  }
  return true;
}
