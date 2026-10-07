// The AutoStudent (spec section 6.4.3): a scripted student that flies a lesson's student tasks by reading
// what a student is given - the task card (targets and tolerances), the checklist on the card - and that
// acknowledges handovers and checklist items with Enter, as a person at the keyboard would. It is how the
// conformance suite proves that every lesson can be passed, and (student=auto) how the browser smoke runs
// fly a lesson.
//
// HOW IT FLIES
//   Its hands are its own Autoflight (the sim's two-axis autopilot with autothrottle and auto-trim; never the
//   sim's own instance, so the shell's AP annunciation and disconnect rules stay out of it), configured per
//   task and per moment as "attitude, power, trim" modes, plus direct control laws where an autopilot cannot
//   do the job: taxiing and lining up, the take-off roll with a chosen rotation speed, the flare (with the
//   wing down and the nose straightened in a crosswind), the roll-out with into-wind aileron, switches and
//   levers. It runs per physics step in front of the instructor-pilot (TrainingSystem and headlessHost
//   install it so), so whenever the instructor has control, or holds a lever, the instructor's writes win -
//   exactly as with a human student.
//
//   Each task is classified by its card (the lesson builders give every kind of task a fixed card title) into
//   a Program. A program reads targets through the runner's EvalContext (run variables, V-speeds, the
//   tolerance table) and aims at the middle of each tolerance band. Programs that span tasks (the circuit:
//   take-off, crosswind, downwind, base, final, landing) keep flying across step boundaries.
//
// NEGLIGENCE (the NegligentStudent of section 6.4.3): `negligence` biases each card target by +k x tol, or
//   oscillates around it with amplitude k x tol, or over-banks every turn: lessons must then end notYet, the
//   coach must speak about it, and a 70 degree bank must make the instructor intervene. Programs that read the
//   card fly the biased target directly; the ones that fly their own numbers (the circuit's climb, downwind
//   height and speed, approach speed, glides, the taxi speed, the run-up rpm) add the same error (`slop`).
//
// Browser- and node-safe: no DOM, no node APIs.

import { C172 } from '../../src/core/c172';
import { clamp, DEG, FT, KT, wrapPi } from '../../src/core/math';
import { fixOnRoute } from '../../src/training/geo/taxiRoute';
import type { AircraftState, ControlInputs } from '../../src/core/types';
import { AIRPORT, runwayCoords } from '../../src/core/world';
import { Autoflight } from '../../src/sim/autoflight';
import { AIM_POINT, GLIDE_PATH, PATTERN_ALTITUDE } from '../../src/sim/scenarios';
import type { SimPhysics } from '../../src/sim/SimPhysics';
import { APRON_TAXILANE_V, HOLD_LINE_V, localToNed, nedToLocal, PARALLEL_TAXIWAY_V, TAXIWAYS, type LocalXY } from '../../src/world/airport/layout';
import { flapLeverFor } from '../../src/training/aircraft/c172s';
import { DIVERSION } from '../../src/training/content/syllabus/route';
import { compile } from '../../src/training/engine/predicates';
import { resolveRef, resolveTol } from '../../src/training/engine/refs';
import type { LessonRunner } from '../../src/training/engine/runner';
import type {
  AircraftTypeDef, CardModel, ChecklistDef, ChecklistItem, CompiledPred, EvalContext, Pred, SignalFrame, StepDef, TaskStep, TaxiRoute, TolRef, WaitStep,
} from '../../src/training/types';

const FPM_MS = FT / 60;
const RWY = AIRPORT.runway;
const HALF = RWY.length / 2;
const FIELD = AIRPORT.elevation;
const RWY_HDG_DEG = RWY.heading / DEG;
/** Rest height of the reference point above the ground on the wheels, m (autoflight.ts REST_HEIGHT). */
const REST_HEIGHT = 1.25;
/** Where the circuit's downwind leg is flown: 0.84 NM left of the centreline (inside the 0.6-1.1 NM band). */
const DOWNWIND_ACROSS = -1550;
/**
 * Turn base this far before the 07 threshold, m: the downwind is held at circuit height throughout (it is
 * graded there) and extended so that the base-leg descent meets the 3 degree path on final.
 */
const BASE_TURN_ALONG = -2800;
/** Fuel pump on to prime the injector lines before a cold start, s. */
const PRIME_S = 4;
/** Seconds of "reading" before Enter after an offer. */
const ACK_DELAY_S = 0.8;
/** Seconds between Enter presses during a checklist. */
const CHECKLIST_ENTER_EVERY_S = 1.5;
/** Throttle lever travel per second when the student moves it. */
const THROTTLE_RATE = 0.8;
/** Taxi speed, kt (the old corner-to-corner path law). */
const TAXI_KT = 8;
/** The route-following taxi driver: speed on the straights and in the turns, kt (item 8: 8-12 kt). */
const TAXI_STRAIGHT_KT = 10.5;
const TAXI_TURN_KT = 8.5;
/** Nose to main wheel base, m, and the pedal steering limit, rad (core/c172.ts gear). */
const WHEELBASE_M = C172.gear.nose.x - C172.gear.leftMain.x;
const PEDAL_STEER = C172.gear.maxNoseSteer;
/** Local-frame u of the A1 and B1 connector centrelines (layout.ts). */
const A1_U = TAXIWAYS.find((t) => t.name === 'A1')!.a.u;
const B1_U = TAXIWAYS.find((t) => t.name === 'B1')!.a.u;

export type Negligence =
  | { kind: 'bias'; scale: number }
  | { kind: 'oscillate'; scale: number; periodS: number }
  | { kind: 'overbank'; bankDeg: number };

export interface AutoStudentOptions {
  /** The aircraft: its state is read; its controls are where the student's hands write. */
  physics: Pick<SimPhysics, 'state' | 'controls'>;
  aircraft: AircraftTypeDef;
  negligence?: Negligence | null;
  /** How Enter is pressed (default: runner.input('ack'); the --keys browser mode presses the real key). */
  onAck?: () => void;
  /**
   * Flown through the keyboard (keyStudent.ts): the round-out starts higher (10 m, as the keyboard pilot's) and
   * the power stays on until 3 m, because the keyboard yoke raises the nose more slowly than a hand.
   */
  keyboard?: boolean;
}

/** Autopilot targets in pilot units (indicated), converted to SI and true values per physics step. */
interface ApTarget {
  lateral: 'heading' | 'bank' | 'wingLeveler';
  hdgDeg?: number;
  bankDeg?: number;
  maxBankDeg?: number;
  vertical: 'altitude' | 'verticalSpeed' | 'airspeed' | 'pitch';
  altFt?: number;
  vsFpm?: number;
  /** Altitude-capture rate limit, fpm. */
  captureFpm?: number;
  pitchDeg?: number;
  kias?: number;
  /** Autothrottle at `kias` (not in 'airspeed' mode). */
  autothrottle?: boolean;
  /** The yaw damper (the student's feet keeping the ball centred); default on. */
  yawDamper?: boolean;
}

/** What a program asks the hands for this frame. */
interface Command {
  /** Autopilot targets ('ap') or no autopilot ('none'). */
  mode: 'ap' | 'none';
  ap?: ApTarget;
  /** Direct throttle target 0..1 (null or absent: the autothrottle owns it, or nobody). */
  throttle?: number | null;
  /** Flap angle wanted, degrees. */
  flapsDeg?: number;
  brakes?: number;
  /** Per-step control law for what the autopilot cannot do (taxi, take-off roll, flare, roll-out). */
  law?: (h: number, s: AircraftState, c: ControlInputs) => void;
}

interface Program {
  kind: string;
  t: number;
  phase: string;
  /** Phase entry time (program clock), s. */
  phaseT: number;
  /** Values captured or computed along the way. */
  m: Record<string, number>;
  tick(p: Program, k: Tick): Command;
}

/** Everything a program may read this frame. */
interface Tick {
  ctx: EvalContext;
  f: Readonly<SignalFrame>;
  s: AircraftState;
  c: ControlInputs;
  step: TaskStep | WaitStep | null;
  dt: number;
  /** A card target (aimed at the middle of its tolerance band), or NaN. */
  target(sig: string): number;
  num(sig: string): number;
}

export class AutoStudent {
  private readonly af = new Autoflight();
  private readonly physics: Pick<SimPhysics, 'state' | 'controls'>;
  private readonly onAck: ((runner: LessonRunner) => void);
  private readonly aircraft: AircraftTypeDef;
  private readonly negligence: Negligence | null;
  private readonly keyboard: boolean;
  private prog: Program | null = null;
  /** The starter as the last tick() left it (null before the first tick); re-applied every physics step. */
  private starterWanted: boolean | null = null;
  private cmd: Command = { mode: 'none' };
  private apEngaged = false;
  private active = false;
  private offerT = 0;
  private enterT = 0;
  /** Seconds the fuel pump has been on for the priming item of the before-start checklist. */
  /** Simulation time the prime started (0: not priming). */
  private primeT = 0;
  private lastStepKey = '';
  private lastStepT = 0;
  private wallT = 0;
  private flapsTarget: number | null = null;
  private frameRef: (() => Readonly<SignalFrame>) | null = null;
  /** Compiled checklist checks (by list and item id). */
  private readonly checks = new Map<string, CompiledPred>();
  /** Ground rpm wanted while a checklist or ground task asks for one (null: none). */
  private groundRpm: number | null = null;
  /** Throttle the ground rpm controller holds. */
  private groundThrottle = 0.1;
  /** The taxi route the runner is guiding along (the taxi driver follows its centreline), or null. */
  private taxiRoute: TaxiRoute | null = null;

  constructor(opts: AutoStudentOptions) {
    this.physics = opts.physics;
    this.aircraft = opts.aircraft;
    this.negligence = opts.negligence ?? null;
    this.keyboard = opts.keyboard === true;
    const ack = opts.onAck;
    this.onAck = ack ? () => ack() : (runner) => runner.input('ack');
  }

  /** The student is working the controls (TelemetrySources.studentInput). */
  get flying(): boolean {
    return this.active && this.cmd.mode !== 'none';
  }

  /** Elevator at the end of the last physics step (a control law that limits how fast the yoke moves). */
  private lastElevator = 0;

  /** The student has control (a key translator flies whatever the program asks, ground laws included). */
  get inControl(): boolean {
    return this.active;
  }

  /**
   * The attitude the student's autopilot is flying toward, rad, or null when a control law (or nothing) flies
   * instead: the keyboard student (keyStudent.ts) flies this attitude with keyboard laws rather than chasing
   * the autopilot's surface positions, which the hold-position keyboard yoke cannot follow fast enough.
   */
  get attitudeTarget(): { pitch: number; bank: number; law: boolean } | null {
    if (!this.active || this.cmd.mode !== 'ap' || !this.apEngaged) return null;
    const ap = this.af.autopilot;
    // `law`: a control law works the aileron and rudder on top (the crosswind flare): follow those surfaces.
    return { pitch: ap.lastPitchTarget, bank: ap.lastBankTarget, law: this.cmd.law !== undefined };
  }

  /** The program flying now (tests and logs). */
  get programKind(): string | null {
    return this.prog?.kind ?? null;
  }

  get programPhase(): string | null {
    return this.prog?.phase ?? null;
  }

  /** A reposition or restore: drop everything in progress. */
  reset(): void {
    this.prog = null;
    this.cmd = { mode: 'none' };
    this.af.disengage();
    this.apEngaged = false;
    this.flapsTarget = null;
    this.lastStepKey = '';
    this.groundRpm = null;
    this.starterWanted = null;
  }

  // ---- per frame: decisions ---------------------------------------------------------------------------------

  tick(runner: LessonRunner, frameDt: number): void {
    const FRAME = 1 / 30;
    this.wallT += FRAME;
    const ctx = runner.evalContext;
    const f = ctx.frame;
    this.frameRef = () => ctx.frame;
    const s = this.physics.state;
    const c = this.physics.controls;
    const fsm = runner.authority;

    // Handover offers: read it, then Enter ("I have control").
    if (fsm.handover !== 'none') {
      this.offerT += FRAME;
      if (this.offerT >= ACK_DELAY_S) {
        this.onAck(runner);
        this.offerT = 0;
      }
    } else {
      this.offerT = 0;
    }

    const cur = runner.currentStep;
    const def = cur?.def ?? null;
    this.taxiRoute = runner.activeTaxiRoute;
    this.groundRpm = null;
    if (def?.kind === 'checklist' && cur?.status === 'active') this.doChecklist(runner, def.checklist, def.mode, cur.checklist, ctx);

    this.active = fsm.who === 'student' && fsm.handover === 'none';
    if (!this.active) {
      if (this.cmd.mode !== 'none' || this.prog) this.release();
      this.starterWanted = c.starter;
      return;
    }

    // A new step (or the same step entered again): maybe a new program.
    const key = `${runner.position.phaseId}/${def?.id ?? ''}`;
    const reentered = ctx.stepT + 1e-9 < this.lastStepT && key === this.lastStepKey;
    this.lastStepT = ctx.stepT;
    if ((key !== this.lastStepKey || reentered) && def && cur?.status === 'active') {
      this.lastStepKey = key;
      this.onNewStep(def, ctx);
    }
    if (!this.prog) this.prog = this.holdProgram(f);

    const step = def && (def.kind === 'task' || def.kind === 'wait') ? def : null;
    const k: Tick = {
      ctx, f, s, c, step, dt: frameDt,
      num: (sig) => num(f[sig]),
      target: (sig) => (step?.kind === 'task' ? this.cardTarget(step, sig, ctx) : NaN),
    };
    this.prog.t += frameDt;
    this.cmd = this.prog.tick(this.prog, k);
    // Hands off the starter outside the start itself (a start task that timed out mid-crank left it engaged).
    if (this.prog.kind !== 'engineStart' && def?.kind !== 'checklist') c.starter = false;
    this.starterWanted = c.starter;
    if (this.cmd.flapsDeg !== undefined) this.flapsTarget = this.cmd.flapsDeg;
  }

  private release(): void {
    this.cmd = { mode: 'none' };
    this.prog = null;
    this.af.disengage();
    this.apEngaged = false;
    this.flapsTarget = null;
    this.lastStepKey = '';
  }

  /** Pick the program for a step the student flies; a running circuit keeps going through its own steps. */
  private onNewStep(def: StepDef, ctx: EvalContext): void {
    const f = ctx.frame;
    if (def.kind === 'task') {
      const next = this.classify(def, ctx);
      if (this.prog && next.kind === this.prog.kind && CONTINUOUS.has(next.kind)) {
        // Same circuit: an approach task may change the approach (flapless) but does not restart it.
        Object.assign(this.prog.m, next.m);
        return;
      }
      this.prog = next;
    } else if (def.kind === 'wait' && def.pf === 'student' && f.onGround === true) {
      // "Climb to 500 ft" from the runway (EFATO), "airborne" (navigation): a take-off.
      this.prog = this.takeoffProgram('circuit');
    } else if (def.kind === 'wait' && /landing/.test(JSON.stringify(def.until))) {
      this.prog = this.circuitProgram();
    } else if (def.kind === 'checklist' && this.prog && GROUND_HOLDS.has(this.prog.kind)) {
      // A checklist after a ground task: the task's hold (parking brake, run-up rpm) ends with it.
      this.prog = null;
    }
  }

  // ---- per physics step: the hands ---------------------------------------------------------------------------

  update(h: number, s: AircraftState, c: ControlInputs): void {
    // The starter is decided per frame (tick) but held per physics step: in the browser the input system
    // writes the starter key's state (released) before every frame's physics, so a starter set only in tick()
    // never reached the engine and the browser start "took 85 s" (wave-3 calibration).
    if (this.starterWanted !== null) c.starter = this.starterWanted;
    if (!this.active) return;
    const cmd = this.cmd;
    if (cmd.mode === 'ap' && cmd.ap) {
      if (!this.apEngaged) {
        this.af.engage({ kind: 'hold', heading: s.heading, altitude: s.altitudeMSL, kias: s.ias / KT, autothrottle: false }, s, c);
        this.apEngaged = true;
      }
      this.applyAp(cmd.ap);
      this.af.update(h, s, c);
    } else if (this.apEngaged) {
      this.af.disengage();
      this.apEngaged = false;
    }
    // A checklist rpm (the run-up's 1,800 rpm) wins over a program when stopped on the ground: feet on the
    // brakes, and the throttle to the rpm (the taxi law would otherwise hold it at idle).
    const rpmHold = this.groundRpm !== null && s.onGround && s.groundSpeed < 1.5;
    if (rpmHold) c.brakeLeft = c.brakeRight = 1;
    else cmd.law?.(h, s, c);
    const thr = rpmHold || (this.groundRpm !== null && cmd.mode === 'none') ? this.groundThrottle : cmd.throttle ?? null;
    if (thr !== null && thr !== undefined) {
      const d = thr - c.throttle;
      c.throttle = clamp(c.throttle + clamp(d, -THROTTLE_RATE * h, THROTTLE_RATE * h), 0, 1);
    }
    if (this.flapsTarget !== null) {
      // Flap goes down only at the top of the white arc or below (item 5: flapOverspeed is above VfeFull for 2 s,
      // and the speed falls through it as the flap extends); it always comes up.
      const want = flapLeverFor(this.aircraft, this.flapsTarget);
      if (want <= c.flaps || s.ias / KT <= this.aircraft.vspeeds.VfeFull + 2) c.flaps = want;
    }
    this.lastElevator = c.elevator;
    if (cmd.brakes !== undefined) c.brakeLeft = c.brakeRight = cmd.brakes;
    // Feet off the brakes in the air (the instructor's ground hold may have left them on after a handover).
    else if (!s.onGround && cmd.law === undefined) c.brakeLeft = c.brakeRight = 0;
  }

  /** Autopilot settings from pilot-unit targets (indicated values corrected to truth with the frame). */
  private applyAp(t: ApTarget): void {
    const ap = this.af.autopilot.settings;
    const f = this.frameRef?.() ?? {};
    const fin = (x: number): number => (Number.isFinite(x) ? x : 0);
    const hdgOff = fin(wrap180(num(f.hdgTrueDeg) - num(f.hdgDeg)));
    const altOff = fin((num(f.altMslFt) - num(f.altFt)) * FT);
    const iasOff = fin(num(f.kias) - num(f.asiKt));
    ap.lateral = t.lateral;
    if (t.hdgDeg !== undefined) ap.heading = wrapPi((t.hdgDeg + hdgOff) * DEG);
    if (t.bankDeg !== undefined) ap.bank = t.bankDeg * DEG;
    ap.maxBank = (t.maxBankDeg ?? 25) * DEG;
    ap.vertical = t.vertical;
    if (t.altFt !== undefined) ap.altitude = t.altFt * FT + altOff;
    if (t.vertical === 'verticalSpeed' && t.vsFpm !== undefined) ap.verticalSpeed = t.vsFpm * FPM_MS;
    else if (t.vertical === 'altitude') ap.verticalSpeed = (t.captureFpm ?? 700) * FPM_MS;
    if (t.pitchDeg !== undefined) ap.pitch = t.pitchDeg * DEG;
    if (t.kias !== undefined) ap.airspeed = (t.kias + iasOff) * KT;
    ap.autothrottle = t.vertical !== 'airspeed' && t.autothrottle === true;
    ap.yawDamper = t.yawDamper ?? true;
    ap.autoTrim = true;
  }

  // ---- checklists -------------------------------------------------------------------------------------------

  /**
   * Do what the checklist asks: the active item in challenge/response (every open item in a flow or silently),
   * then Enter to confirm. A flow is closed with Enter only once its checkable items are done: Enter closes
   * the whole flow and would mark the rest missed.
   */
  private doChecklist(runner: LessonRunner, id: string, mode: 'challengeResponse' | 'flow' | 'silent', card: CardModel['checklist'], ctx: EvalContext): void {
    const list = this.aircraft.checklists[id] as ChecklistDef | undefined;
    if (!list || !card) return;
    const c = this.physics.controls;
    const states = new Map(card.items.map((it) => [it.id, it.state]));
    const todo = list.items.filter((it) => (mode === 'challengeResponse' ? states.get(it.id) === 'active' : states.get(it.id) !== 'done' && states.get(it.id) !== 'missed'));
    // Items that set an rpm are done one at a time, in list order (the run-up asks for 1,800 rpm, then idle).
    const firstRpm = todo.find((it) => rpmBand(it.check) !== null);
    for (const item of todo) if (rpmBand(item.check) === null || item === firstRpm) this.doItem(item, c);
    // Priming ("Fuel pump: on, then off"): pump on for PRIME_S, then off, and only then the response.
    const prime = todo.find((it) => it.id === 'fuelPumpPrime');
    if (prime) {
      // Timed on the simulation clock (round 7: counted as 1/30 s a call, in the real app at 60 frames a second
      // the pump was on for under 2 s, the prime never counted and the item hung until she set it herself). If
      // the item is still open well after the pump went off (a key press lost), prime again.
      if (this.primeT <= 0 || ctx.simT - this.primeT > PRIME_S + 4) this.primeT = ctx.simT;
      const el = ctx.simT - this.primeT;
      c.fuelPump = el < PRIME_S;
      if (el < PRIME_S + 0.5) return;
    } else this.primeT = 0;
    if (mode === 'silent') return;
    this.enterT += 1 / 30;
    if (this.enterT < CHECKLIST_ENTER_EVERY_S || runner.authority.handover !== 'none') return;
    if (mode === 'flow' && todo.some((it) => it.check && !this.checkTrue(id, it, ctx))) return;
    this.enterT = 0;
    this.onAck(runner);
  }

  private checkTrue(listId: string, it: ChecklistItem, ctx: EvalContext): boolean {
    if (!it.check) return true;
    const key = `${listId}.${it.id}`;
    let p = this.checks.get(key);
    if (!p) this.checks.set(key, (p = compile(it.check)));
    return p.eval(ctx);
  }

  /** One item: switches and levers directly; an rpm through the ground throttle; the starter held. */
  private doItem(item: ChecklistItem, c: ControlInputs): void {
    if (item.id === 'start') {
      // Key to START: magnetos on, mixture rich, fuel on, the throttle cracked, the starter until it fires.
      const running = this.physics.state.engine.running;
      c.masterBattery = true;
      c.fuelSelector = 'both';
      c.mixture = 1;
      c.magnetos = 3;
      if (!running) c.throttle = 0.08;
      c.starter = !running;
      return;
    }
    const rpm = rpmBand(item.check);
    if (rpm !== null) {
      this.holdRpm(rpm);
      return;
    }
    if (item.check) satisfy(item.check, c, this.aircraft);
  }

  /** The throttle that gives `rpm` on the ground (a slow integral, like a hand easing the lever). */
  private holdRpm(rpm: number): void {
    const now = this.physics.state.engine.rpm;
    this.groundThrottle = clamp(this.groundThrottle + 0.00006 * (rpm - now), 0.02, 0.6);
    this.groundRpm = rpm;
  }

  // ---- classification ---------------------------------------------------------------------------------------

  private classify(def: TaskStep, ctx: EvalContext): Program {
    const title = def.card.title;
    const f = ctx.frame;
    let m: RegExpMatchArray | null;
    if (/^Pitch up/.test(title)) return this.pitchExercise(f);
    if (/^Bank 15/.test(title)) return this.rollExercise(f);
    if (/^Yaw/.test(title)) return this.yawExercise(f);
    if (/^Trim hands-off/.test(title)) return this.levelProgram('trim', f);
    if (title === 'Straight and level' || /^\d+ kt clean/.test(title) || /^Flap 20, 70 kt/.test(title) || /^Flap up, back to cruise/.test(title)) {
      const flaps = /^Flap 20/.test(title) ? 20 : /^Flap up/.test(title) ? 0 : undefined;
      return this.levelProgram('level', f, flaps);
    }
    if (title === 'Climb and level off') return this.climbProgram();
    if (/^Full power climb/.test(title)) return this.powerClimbProgram();
    if (/^Cruise: /.test(title)) return this.rpmProgram(f);
    if (title === 'Glide and level off') return this.descentProgram(true);
    if (/500 fpm descent/.test(title)) return this.descentProgram(false);
    if ((m = title.match(/^(\d+)° turn (left|right), (\d+)°/))) return this.turnProgram(+m[1], m[2] === 'left' ? -1 : 1, +m[3], f);
    if ((m = title.match(/^(Right|Left) onto (\d+)/))) return this.ontoProgram(m[1] === 'Left' ? -1 : 1, +m[2], f);
    if ((m = title.match(/^Climbing turn (left|right) at Vy, (\d+)°/))) return this.climbGlideTurn('climb', m[1] === 'left' ? -1 : 1, +m[2], f);
    if ((m = title.match(/^Gliding turn (left|right), (\d+)°/))) return this.climbGlideTurn('glide', m[1] === 'left' ? -1 : 1, +m[2], f);
    if (/^Slow flight/.test(title)) return this.slowProgram(def, f);
    if (/^Full power, flap up/.test(title)) return this.cleanUpProgram(f);
    if ((m = title.match(/^Clearing turn, (\d+)°/))) return this.clearingTurn(+m[1], f);
    if ((m = title.match(/stall, recover at the (warning|break)/))) return this.stallProgram(/Flap 30/.test(title), m[1] === 'warning' ? 'stallWarnOn' : 'stallBreak', f);
    if (/^Spiral dive/.test(title)) return this.spiralRecovery();
    if (/^Recover: nose (high|low)/.test(title)) return this.unusualRecovery(/high/.test(title));
    if ((m = title.match(/^Rate-one turn (left|right), (\d+)°/))) return this.rateOneTurn(m[1] === 'left' ? -1 : 1, +m[2], f);
    if (title === 'Take-off and climb') return this.takeoffProgram('circuit');
    if (title === 'Short-field take-off') return this.takeoffProgram('short');
    if (/^Circuit: downwind/.test(title)) return this.circuitProgram();
    if (title === 'Approach and landing') return this.circuitProgram(def);
    if (title === 'Your decision') return this.goAroundProgram(470);
    if (/^Approach/.test(title)) return this.circuitProgram(def);
    if (title === 'Go around') return this.goAroundProgram(null);
    if (title === 'Glide approach') return this.glideApproachProgram('glide');
    if (/^Engine failure after take-off/.test(title)) return this.efatoProgram();
    if (/^Engine failure: reach the runway/.test(title)) return this.glideApproachProgram('failure');
    if (/^Forced landing: to the high key/.test(title) || /^Dead-stick/.test(title)) return this.pflProgram();
    if (/^Forced landing|^Base and final: security/.test(title) && this.prog?.kind === 'pfl') return this.prog;
    if (/^Climb to [\d,]+ ft over the field/.test(title)) return this.navProgram('climbOverhead');
    if (/^Overhead: set course/.test(title)) return this.navProgram('leg');
    if (/^Leg \d+: to /.test(title) || /^Turning point: /.test(title)) return this.navProgram('leg');
    if (/^Diversion: /.test(title)) return this.navProgram('diversion');
    if (/^Direct to /.test(title)) return this.navProgram('direct');
    if (/^Overhead at /.test(title)) return this.navProgram('overhead');
    if (/^Dead-side descent/.test(title)) {
      const p = this.circuitProgram();
      p.phase = 'deadside';
      return p;
    }
    if (title === 'Start the engine') return this.engineStartProgram();
    if (title === 'Oil pressure rising') return this.groundRpmProgram(1000);
    if (/^Taxi to holding point A1/.test(title)) return this.taxiToA1Program();
    if (/^Run-up/.test(title)) return this.groundRpmProgram(1800);
    if (/^Magnetos:/.test(title)) return this.magnetoProgram();
    return this.holdProgram(f);
  }

  /**
   * A card target aimed at the middle of its tolerance band; when negligent (and not `honest`), biased k x tol
   * above it (below for a band with no upper side), or oscillating k x tol either side (each side its own
   * tolerance: -10/+30 kt for a -5/+15 band at k = 2).
   */
  private cardTarget(step: TaskStep, sig: string, ctx: EvalContext, honest = false): number {
    const t = step.card.targets.find((x) => x.sig === sig);
    if (!t) return NaN;
    const v = resolveRef(t.value, ctx);
    if (!Number.isFinite(v)) return NaN;
    const tol = t.tol !== undefined ? resolveTol(t.tol as TolRef, ctx) : { minus: 0, plus: 0 };
    const n = honest ? null : this.negligence;
    if (n?.kind === 'bias') return tol.plus > 0 ? v + n.scale * tol.plus : v - n.scale * tol.minus;
    if (n?.kind === 'oscillate') {
      const w = Math.sin((2 * Math.PI * this.wallT) / n.periodS);
      return v + n.scale * w * (w >= 0 ? tol.plus : tol.minus);
    }
    return v + (tol.plus - tol.minus) / 2;
  }

  /**
   * The negligent student's error on a card target: how far its biased or oscillating aim is from the honest
   * one (0 for a careful student, or when the card has no such target). Programs that fly their own numbers
   * rather than the card's (circuits, glides, taxiing) add it to the number the card target stands for.
   */
  private slop(k: Tick, sig: string): number {
    const step = k.step;
    if (!this.negligence || this.negligence.kind === 'overbank' || step?.kind !== 'task') return 0;
    const d = this.cardTarget(step, sig, k.ctx) - this.cardTarget(step, sig, k.ctx, true);
    return Number.isFinite(d) ? d : 0;
  }

  // ---- programs: handling ------------------------------------------------------------------------------------

  private program(kind: string, tick: Program['tick'], m: Record<string, number> = {}): Program {
    return { kind, t: 0, phase: 'start', phaseT: 0, m, tick };
  }

  /** Nothing specific: hold what the aircraft is doing (wings level, this altitude, this speed). */
  private holdProgram(f: Readonly<SignalFrame>): Program {
    // On the ground: feet on the brakes, throttle back toward idle (a checklist rpm overrides it).
    // The aircraft's own state decides as well: in the browser the first tick of a lesson can come before the
    // runner's first telemetry frame, whose signals are then missing (an airborne hold on NaN targets).
    const st = this.physics.state;
    if (f.onGround === true || st.onGround) return this.program('ground', () => ({ mode: 'none', throttle: 0.05, brakes: 1 }));
    const alt = orElse(num(f.altFt), st.altitudeMSL / FT);
    const kias = clamp(orElse(num(f.asiKt), st.ias / KT), 65, 110);
    const hdg = orElse(num(f.hdgDeg), st.heading / DEG);
    return this.program('hold', () => ({ mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg, vertical: 'altitude', altFt: alt, autothrottle: true, kias } }));
  }

  /** Straight and level (and the trim and speed-change tasks): heading, altitude and speed from the card. */
  private levelProgram(kind: string, f: Readonly<SignalFrame>, flapsDeg?: number): Program {
    const hdg0 = num(f.hdgDeg);
    const alt0 = num(f.altFt);
    return this.program(kind, (_p, k) => {
      const hdg = orElse(k.target('hdgDeg'), hdg0);
      const alt = orElse(k.target('altFt'), alt0);
      const kias = orElse(k.target('asiKt'), clamp(k.num('asiKt'), 70, 110));
      return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg, maxBankDeg: 15, vertical: 'altitude', altFt: alt, captureFpm: 400, autothrottle: true, kias }, flapsDeg };
    });
  }

  /** Climb at the card speed with full power, level off with a 10 % lead. */
  private climbProgram(): Program {
    return this.program('climb', (p, k) => {
      const tgt = k.target('altFt');
      const hdg = orElse(k.target('hdgDeg'), k.num('hdgDeg'));
      const vy = orElse(k.target('asiKt'), this.aircraft.vspeeds.Vy + 5);
      const lead = Math.max(40, 0.12 * Math.abs(k.num('vsFpm')));
      if (p.phase !== 'level' && k.num('altFt') >= tgt - lead) p.phase = 'level';
      // From cruise speed: raise the nose gradually (a climb rate first, not the airspeed mode, which would
      // zoom), then hold the climb speed with the attitude once it has bled off.
      if (p.phase === 'start' && k.num('asiKt') < vy + 8) p.phase = 'climb';
      if (p.phase === 'start') return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg, maxBankDeg: 15, vertical: 'pitch', pitchDeg: Math.min(12, k.num('pitchDeg') + 3) }, throttle: 1, flapsDeg: 0 };
      if (p.phase === 'climb') return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg, maxBankDeg: 15, vertical: 'airspeed', kias: vy }, throttle: 1, flapsDeg: 0 };
      return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg, maxBankDeg: 15, vertical: 'altitude', altFt: tgt, captureFpm: 400, autothrottle: true, kias: this.aircraft.vspeeds.Vcruise } };
    });
  }

  /**
   * L01 power and yaw (item 9): full power with the feet off and the wings held level, so the nose swings left
   * and the ball goes out to the right; after a few seconds, right rudder until the ball is in the middle
   * (the yaw damper; through the keys, the keyboard pilot's ball law), the nose pitched for Vy.
   */
  private powerClimbProgram(): Program {
    const feetOff = (_h: number, _s: AircraftState, c: ControlInputs): void => {
      c.rudder = 0;
    };
    return this.program('powerClimb', (p, k) => {
      const vy = orElse(k.target('asiKt'), this.aircraft.vspeeds.Vy);
      // Hear the brief and the "Go ahead" first, holding the attitude as handed over.
      if (p.phase === 'start' && !p.m.heard) {
        if (k.ctx.speechIdle && p.t > 1) p.m.heard = 1;
        else {
          if (p.m.pitch0 === undefined) p.m.pitch0 = orElse(k.num('pitchDeg'), 7);
          return { mode: 'ap', ap: { lateral: 'wingLeveler', vertical: 'pitch', pitchDeg: p.m.pitch0, yawDamper: false }, law: feetOff };
        }
      }
      if (p.phase === 'start' && k.num('throttle') >= 0.95) {
        p.phase = 'feetOff';
        p.phaseT = p.t;
      }
      if (p.phase === 'feetOff' && p.t - p.phaseT > 4) p.phase = 'balance';
      const pitchUp = p.phase !== 'balance' && k.num('asiKt') > vy - 2;
      const vertical: ApTarget = pitchUp ? { lateral: 'wingLeveler', vertical: 'pitch', pitchDeg: 8 } : { lateral: 'wingLeveler', vertical: 'airspeed', kias: vy };
      if (p.phase !== 'balance') return { mode: 'ap', ap: { ...vertical, yawDamper: false }, throttle: 1, flapsDeg: 0, law: feetOff };
      // Through the keys: the keyboard student's ball law, firmer in this exercise (keyStudent.ts).
      return { mode: 'ap', ap: { lateral: 'wingLeveler', vertical: 'airspeed', kias: vy }, throttle: 1, flapsDeg: 0 };
    });
  }

  /** Hold the altitude and set an rpm with the throttle (the "cruise power and trim" step). */
  private rpmProgram(f: Readonly<SignalFrame>): Program {
    const alt = num(f.altFt);
    const hdg = num(f.hdgDeg);
    let thr = num(f.throttle);
    return this.program('rpm', (_p, k) => {
      const rpm = orElse(k.target('rpm'), 2300);
      thr = clamp(thr + 0.00025 * (rpm - k.num('rpm')) * Math.max(k.dt, 1 / 60), 0.2, 1);
      return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg, maxBankDeg: 15, vertical: 'altitude', altFt: alt, captureFpm: 300 }, throttle: thr };
    });
  }

  /** Glide (idle, best glide) or a 500 fpm descent at 90 kt, then level off with a lead. */
  private descentProgram(glide: boolean): Program {
    return this.program(glide ? 'glide' : 'descent', (p, k) => {
      const tgt = k.target('altFt');
      const hdg = orElse(k.target('hdgDeg'), k.num('hdgDeg'));
      const kias = orElse(k.target('asiKt'), glide ? this.aircraft.vspeeds.Vglide : this.aircraft.vspeeds.Vdescent);
      const lead = Math.max(40, 0.12 * Math.abs(k.num('vsFpm')));
      if (p.phase === 'start') {
        p.m.alt0 = k.num('altFt');
        p.phase = glide ? 'slow' : 'down';
      }
      if (p.phase !== 'level' && k.num('altFt') <= tgt + lead) p.phase = 'level';
      const lat = { lateral: 'heading' as const, hdgDeg: hdg, maxBankDeg: 15 };
      if (p.phase === 'slow') {
        // Hold the height with the throttle closed until the speed is near best glide, then lower the nose.
        if (k.num('asiKt') < kias + 4) p.phase = 'down';
        return { mode: 'ap', ap: { ...lat, vertical: 'altitude', altFt: p.m.alt0 }, throttle: 0 };
      }
      if (p.phase === 'down') {
        if (glide) return { mode: 'ap', ap: { ...lat, vertical: 'airspeed', kias }, throttle: 0 };
        return { mode: 'ap', ap: { ...lat, vertical: 'verticalSpeed', vsFpm: orElse(k.target('vsiFpm'), -500), autothrottle: true, kias } };
      }
      return { mode: 'ap', ap: { ...lat, vertical: 'altitude', altFt: tgt, captureFpm: 400, autothrottle: true, kias: this.aircraft.vspeeds.Vdescent } };
    });
  }

  /** A level turn through `deg` at `bank` (30 medium, 45 steep), rolling out on the entry heading. */
  private turnProgram(bank: number, sign: number, deg: number, f: Readonly<SignalFrame>): Program {
    const hdg0 = num(f.hdgDeg);
    const alt0 = num(f.altFt);
    const over = this.negligence?.kind === 'overbank' ? this.negligence.bankDeg : null;
    return this.program('turn', (p, k) => {
      const hdgTarget = orElse(k.target('hdgDeg'), hdg0);
      const alt = orElse(k.target('altFt'), alt0);
      const kias = orElse(k.target('asiKt'), 100);
      const bankAim = over ?? Math.abs(orElse(k.target('aiBankDeg'), sign * bank));
      const turned = Math.abs(k.num('step.turnDeg'));
      if (p.phase === 'start' && turned >= deg - (bank / 2 + 3)) p.phase = 'out';
      const vert = { vertical: 'altitude' as const, altFt: alt, captureFpm: 500, autothrottle: true, kias };
      if (p.phase === 'start') return { mode: 'ap', ap: { lateral: 'bank', bankDeg: sign * bankAim, maxBankDeg: bankAim + 3, ...vert } };
      return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdgTarget, maxBankDeg: bank, ...vert } };
    });
  }

  /** A turn onto a heading in a named direction (bank 30 until close, then the heading mode). */
  private ontoProgram(sign: number, hdg: number, f: Readonly<SignalFrame>): Program {
    const alt0 = num(f.altFt);
    return this.program('onto', (p, k) => {
      const alt = orElse(k.target('altFt'), alt0);
      const err = wrap180(hdg - k.num('hdgDeg'));
      if (p.phase === 'start' && Math.abs(err) < 25 && Math.sign(err) === sign) p.phase = 'capture';
      const vert = { vertical: 'altitude' as const, altFt: alt, captureFpm: 500, autothrottle: true, kias: clamp(k.num('asiKt'), 90, 105) };
      if (p.phase === 'start') return { mode: 'ap', ap: { lateral: 'bank', bankDeg: sign * 30, maxBankDeg: 32, ...vert } };
      return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg, maxBankDeg: 30, ...vert } };
    });
  }

  /** A climbing turn at Vy (full power) or a gliding turn (idle, best glide) through about 180 degrees. */
  private climbGlideTurn(kind: 'climb' | 'glide', sign: number, bank: number, f: Readonly<SignalFrame>): Program {
    const hdg0 = num(f.hdgDeg);
    return this.program(`${kind}Turn`, (p, k) => {
      const kias = orElse(k.target('asiKt'), kind === 'climb' ? this.aircraft.vspeeds.Vy + 5 : this.aircraft.vspeeds.Vglide);
      const turned = Math.abs(k.num('step.turnDeg'));
      if (p.phase === 'start' && turned >= 178 - bank / 2) p.phase = 'out';
      const vert = { vertical: 'airspeed' as const, kias };
      const throttle = kind === 'climb' ? 1 : 0;
      if (p.phase === 'start') return { mode: 'ap', ap: { lateral: 'bank', bankDeg: sign * bank, maxBankDeg: bank + 3, ...vert }, throttle };
      return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg0 + sign * 185, maxBankDeg: bank, ...vert }, throttle };
    });
  }

  /** Slow flight: hold the height, speed on the power, the card's flap; a gentle turn when the card has a bank. */
  private slowProgram(def: TaskStep, f: Readonly<SignalFrame>): Program {
    const hdg0 = num(f.hdgDeg);
    const alt0 = num(f.altFt);
    const flapsDeg = flapsFromCriteria(def) ?? (num(f.flapsDeg) > 2 ? nearestDetent(num(f.flapsDeg)) : 0);
    return this.program('slow', (_p, k) => {
      const alt = orElse(k.target('altFt'), alt0);
      const kias = orElse(k.target('asiKt'), this.aircraft.vspeeds.Vslow + 5);
      const bank = k.target('aiBankDeg');
      const vert = { vertical: 'altitude' as const, altFt: alt, captureFpm: 300, autothrottle: true, kias };
      if (Number.isFinite(bank)) return { mode: 'ap', ap: { lateral: 'bank', bankDeg: bank, maxBankDeg: 18, ...vert }, flapsDeg };
      return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: orElse(k.target('hdgDeg'), hdg0), maxBankDeg: 10, ...vert }, flapsDeg };
    });
  }

  /** From slow flight back to cruise: full power, flap up in stages, then cruise speed. */
  private cleanUpProgram(f: Readonly<SignalFrame>): Program {
    const alt0 = num(f.altFt);
    const hdg0 = num(f.hdgDeg);
    return this.program('cleanUp', (_p, k) => {
      const kias = k.num('kias');
      const flaps = k.num('flapsDeg');
      const flapsDeg = flaps > 15 && kias > 60 ? 10 : flaps > 2 && kias > 68 ? 0 : nearestDetent(flaps);
      const alt = orElse(k.target('altFt'), alt0);
      return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg0, maxBankDeg: 10, vertical: 'altitude', altFt: alt, captureFpm: 400, autothrottle: true, kias: orElse(k.target('asiKt'), 105) }, flapsDeg };
    });
  }

  /** A clearing turn (lookout) through `deg`, then wings level on the new heading. */
  private clearingTurn(deg: number, f: Readonly<SignalFrame>): Program {
    const hdg0 = num(f.hdgDeg);
    const alt0 = num(f.altFt);
    return this.program('clearing', (p, k) => {
      const turned = Math.abs(k.num('step.turnDeg'));
      if (p.phase === 'start' && turned >= deg - 12) p.phase = 'out';
      const vert = { vertical: 'altitude' as const, altFt: alt0, captureFpm: 500, autothrottle: true, kias: clamp(k.num('asiKt'), 85, 100) };
      if (p.phase === 'start') return { mode: 'ap', ap: { lateral: 'bank', bankDeg: -30, maxBankDeg: 32, ...vert } };
      return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg0 - deg - 3, maxBankDeg: 30, ...vert } };
    });
  }

  /**
   * A stall task: the entry (below) until the warning or the break (`ref`) is on the bus, then the recovery
   * (stallRecovery) from the heading at that moment.
   */
  private stallProgram(approachConfig: boolean, ref: 'stallWarnOn' | 'stallBreak', f: Readonly<SignalFrame>): Program {
    const entry = this.stallEntry(approachConfig, f);
    let recovery: Program | null = null;
    let buffetS = 0;
    return this.program('stall', (p, k) => {
      // The break is also felt: a wing letting go (a fifth of it stalled) for half a second starts the recovery
      // as the event would (round 7: with flap 30 the wing mushed a third stalled for 1.5 s on full back yoke
      // before the nose fell, a deep stall that dropped a wing 40 deg and ended in a secondary stall). The
      // recovery's push drops the nose with the horn on, which is the break the grader times.
      buffetS = ref === 'stallBreak' && k.s.stallFraction >= 0.15 ? buffetS + k.dt : 0;
      if (!recovery && (buffetS >= 0.5 || k.ctx.events.since(k.ctx.stepMark).some((r) => r.type === ref))) recovery = this.stallRecovery(k.f);
      const prog = recovery ?? entry;
      prog.t = p.t;
      return prog.tick(prog, k);
    });
  }

  /** Stall entry: power off (or 1,500 rpm with flap 30), hold the height and heading until the stall. */
  private stallEntry(approachConfig: boolean, f: Readonly<SignalFrame>): Program {
    const stallingLaw = (_h: number, st: AircraftState, ct: ControlInputs): void => {
      if (st.stallFraction <= 0.05) return;
      ct.aileron = 0;
      ct.rudder = clamp(0.2 - 2 * st.roll - 2 * st.angularVelocity.z, -1, 1);
    };
    const alt0 = num(f.altFt);
    let thr = approachConfig ? 0.35 : 0;
    return this.program('stallEntry', (_p, k) => {
      const hdg = orElse(k.target('hdgDeg'), k.num('hdgDeg'));
      if (approachConfig) thr = clamp(thr + 0.00025 * (1500 - k.num('rpm')) * Math.max(k.dt, 1 / 60), 0.1, 0.6);
      return {
        mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg, maxBankDeg: 10, vertical: 'altitude', altFt: alt0, captureFpm: 300 },
        throttle: thr, flapsDeg: approachConfig ? (k.num('kias') < 84 ? 30 : 10) : 0,
        // Once the wing starts to stall: ailerons neutral, a dropping wing held with opposite rudder (aileron
        // on a stalling wing deepens the stall on the low side: physics round 7, the flap-30 entry rolled 50 deg).
        law: stallingLaw,
      };
    });
  }

  /** Recover at the warning or the break: unload, full power, wings level; climb away at Vy; flap up in stages. */
  private stallRecovery(f: Readonly<SignalFrame>): Program {
    const hdg0 = num(f.hdgDeg);
    const vx = this.aircraft.vspeeds.Vx;
    // While the horn sounds or the wing is stalled the student flies the textbook recovery on top of the
    // autopilot's pitch-down: never aft of the elevator already held (the autopilot's attitude hold pulled again
    // as soon as the nose went below its -2 deg, which held the wing stalled into a spin), the yoke eased forward
    // smoothly while the horn sounds (a sharp push reads as the nose dropping at the break), ailerons neutral and
    // rudder against the yaw while the wing is stalled (aileron on a stalled wing deepens the stall on the
    // dropping side; physics round 7: the approach-configuration stall dropped a wing and rolled past 70 deg).
    let held: number | null = null;
    let since = Infinity;
    const unstallLaw = (h: number, st: AircraftState, ct: ControlInputs): void => {
      const stalled = st.stallFraction > 0.05;
      since = st.stallWarning || stalled ? 0 : since + h;
      // The yoke is flown smoothly for a few seconds after the horn stops too: the pull-out back to the attitude
      // is limited to below the warning's angle of attack, 2 g and a gentle pitch rate, so it does not stall the wing again.
      if (since > 3) {
        held = null;
        return;
      }
      held ??= this.lastElevator;
      const q = st.angularVelocity.y;
      let e: number;
      if (stalled) e = clamp(ct.elevator, held - 1.5 * h, held);
      else if (st.stallWarning) e = clamp(ct.elevator, held - 0.3 * h, held);
      // With flap 30 the pull-out is slower still (half the rate, and only while the nose is not already rising):
      // at the full rate the yoke came back 0.55 in half a second as the nose fell through the horizon after the
      // break, pitched it up at 22 deg/s and stalled the wing again at 40 KIAS.
      else if (ct.flaps > 0.5) e = clamp(ct.elevator, held - h, st.alpha < 8 * DEG && q < 2 * DEG && st.gLoad < 2 ? held + 0.5 * h : held);
      else e = clamp(ct.elevator, held - h, st.alpha < 13 * DEG && q < 6 * DEG && st.gLoad < 2 ? held + h : held);
      // Firm but not violent: no further forward once the nose is coming down briskly or is at the horizon.
      if (q < (stalled ? -12 : st.stallWarning ? -1.5 : -3) * DEG || st.pitch < -3 * DEG) e = Math.max(e, held);
      // With the horn still sounding the nose must not drop fast (that is the break): ease back a touch.
      if (!stalled && st.stallWarning && q < -3 * DEG) e = Math.min(held + 0.5 * h, 0.3);
      ct.elevator = held = e;
      if (stalled) {
        ct.aileron = 0;
        ct.rudder = clamp(0.2 - 2 * st.roll - 3 * st.angularVelocity.z, -1, 1);
      } else {
        // Feet: stop the yaw (the right rudder full power needs), not chase the ball the stall threw out.
        ct.rudder = clamp(0.25 - 3 * st.angularVelocity.z, -1, 1);
      }
    };
    return this.program('stallRecovery', (p, k) => {
      const kias = k.num('kias');
      if (p.phase === 'start' && kias > this.aircraft.vspeeds.Vs1 + 16) p.phase = 'climb';
      const flaps = k.num('flapsDeg');
      let flapsDeg = nearestDetent(flaps);
      if (flaps > 25 && kias > vx + 2) flapsDeg = 20;
      else if (flaps > 15 && flaps < 25 && kias > vx + 6 && k.num('vsFpm') > 0) flapsDeg = 10;
      else if (flaps > 5 && flaps < 15 && kias > vx + 10 && k.num('vsFpm') > 0) flapsDeg = 0;
      if (p.phase === 'start') return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg0, maxBankDeg: 10, vertical: 'pitch', pitchDeg: -2 }, throttle: 1, flapsDeg, law: unstallLaw };
      // Climb away: hold a climb attitude until the aircraft is climbing, then the speed (going straight to the
      // airspeed hold at 64 KIAS pushed the nose 14 deg down to accelerate to Vy + 5 and lost 150 ft).
      if (p.phase === 'climb' && k.num('vsFpm') > 300) p.phase = 'speed';
      if (p.phase === 'climb') return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg0, maxBankDeg: 10, vertical: 'pitch', pitchDeg: 6 }, throttle: 1, flapsDeg };
      return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg0, maxBankDeg: 10, vertical: 'airspeed', kias: this.aircraft.vspeeds.Vy + 5 }, throttle: 1, flapsDeg };
    });
  }

  /** Spiral dive: power off, roll wings level, then ease out of the dive (no pull in the bank). */
  private spiralRecovery(): Program {
    return this.program('spiral', (p, k) => {
      const bank = Math.abs(k.num('bankDeg'));
      if (p.phase === 'start' && bank < 10) p.phase = 'pull';
      if (p.phase === 'pull' && k.num('pitchDeg') > -1) p.phase = 'level';
      if (p.phase === 'start') return { mode: 'ap', ap: { lateral: 'bank', bankDeg: 0, maxBankDeg: 60, vertical: 'pitch', pitchDeg: Math.min(k.num('pitchDeg'), -5) }, throttle: 0 };
      if (p.phase === 'pull') return { mode: 'ap', ap: { lateral: 'wingLeveler', vertical: 'pitch', pitchDeg: 2 }, throttle: 0 };
      return { mode: 'ap', ap: { lateral: 'wingLeveler', vertical: 'verticalSpeed', vsFpm: 0, autothrottle: true, kias: 100 } };
    });
  }

  /** Unusual attitude: nose high = full power, nose down, wings level; nose low = power off, wings level, ease out. */
  private unusualRecovery(noseHigh: boolean): Program {
    return this.program('unusual', (p, k) => {
      const bank = Math.abs(k.num('bankDeg'));
      const pitch = k.num('pitchDeg');
      if (p.phase === 'start' && (noseHigh ? pitch < 5 && bank < 15 : bank < 10)) p.phase = 'level';
      if (p.phase === 'start') {
        if (noseHigh) return { mode: 'ap', ap: { lateral: 'bank', bankDeg: 0, maxBankDeg: 45, vertical: 'pitch', pitchDeg: 0 }, throttle: 1 };
        // Nose low: unload (a little forward of the entry attitude, under 1.5 g) while the power comes off and
        // the wings roll level; only then ease out of the dive.
        p.m.p0 ??= Math.min(pitch, -5) - 5;
        return { mode: 'ap', ap: { lateral: 'bank', bankDeg: 0, maxBankDeg: 60, vertical: 'pitch', pitchDeg: p.m.p0 }, throttle: 0 };
      }
      return { mode: 'ap', ap: { lateral: 'wingLeveler', vertical: 'pitch', pitchDeg: 2 }, throttle: noseHigh ? 0.75 : clamp((105 - k.num('kias')) / 20, 0.3, 0.75) };
    });
  }

  /** A rate-one turn (3°/s) through `deg`, rolling out on the entry heading plus `deg`. */
  private rateOneTurn(sign: number, deg: number, f: Readonly<SignalFrame>): Program {
    const hdg0 = num(f.hdgDeg);
    const alt0 = num(f.altFt);
    const thr0 = this.physics.controls.throttle;
    return this.program('rateOne', (p, k) => {
      const tas = k.num('tasKt') || k.num('kias');
      const bank = Math.atan((3 * DEG * tas * KT) / 9.81) / DEG;
      const turned = Math.abs(k.num('step.turnDeg'));
      if (p.phase === 'start' && turned >= deg - bank / 2 - 2) p.phase = 'out';
      const alt = orElse(k.target('altFt'), alt0);
      // The power stays where it was set (a pilot does not work the throttle through a rate-one turn): the
      // autothrottle swung it 0.33-0.49 against the turbulence, and each swing yawed the turn coordinator by
      // 0.3 of rate one through the slipstream on the fin.
      const vert = { vertical: 'altitude' as const, altFt: alt, captureFpm: 400 };
      if (p.phase === 'start') return { mode: 'ap', ap: { lateral: 'bank', bankDeg: sign * bank, maxBankDeg: bank + 3, ...vert }, throttle: thr0 };
      return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg0 + sign * deg, maxBankDeg: bank, ...vert }, throttle: thr0 };
    });
  }

  /** L01 pitch: 7° up, 7° down, back to the start attitude. */
  private pitchExercise(f: Readonly<SignalFrame>): Program {
    const p0 = num(f.aiPitchDeg);
    const hdg = num(f.hdgDeg);
    return this.program('pitchEx', (p, k) => {
      const pitch = k.num('aiPitchDeg');
      if (p.phase === 'start' && pitch >= p0 + 5.5) p.phase = 'down';
      if (p.phase === 'down' && pitch <= p0 - 5.5) p.phase = 'level';
      const target = p.phase === 'start' ? p0 + 7 : p.phase === 'down' ? p0 - 7 : p0;
      return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg, maxBankDeg: 10, vertical: 'pitch', pitchDeg: target } };
    });
  }

  /** L01 roll: 16° left, 16° right, level. */
  private rollExercise(f: Readonly<SignalFrame>): Program {
    const alt = num(f.altFt);
    return this.program('rollEx', (p, k) => {
      const bank = k.num('aiBankDeg');
      if (p.phase === 'start' && bank <= -13) p.phase = 'right';
      if (p.phase === 'right' && bank >= 13) p.phase = 'level';
      const target = p.phase === 'start' ? -16 : p.phase === 'right' ? 16 : 0;
      return { mode: 'ap', ap: { lateral: 'bank', bankDeg: target, maxBankDeg: 20, vertical: 'altitude', altFt: alt, captureFpm: 300 } };
    });
  }

  /** L01 yaw: rudder until the ball is well out, then centre it. */
  private yawExercise(f: Readonly<SignalFrame>): Program {
    const alt = num(f.altFt);
    return this.program('yawEx', (p, k) => {
      if (p.phase === 'start' && Math.abs(k.num('ball')) > 0.6) p.phase = 'centre';
      const ap: ApTarget = { lateral: 'wingLeveler', vertical: 'altitude', altFt: alt, captureFpm: 300 };
      if (p.phase === 'start') return { mode: 'ap', ap, law: (_h, _s, c) => (c.rudder = 0.8) };
      return { mode: 'ap', ap };
    });
  }

  // ---- programs: navigation -----------------------------------------------------------------------------------

  /**
   * Cross-country flying by the nav log: the planned heading of the leg (corrected back toward the track when
   * it drifts off), the planned altitude at cruise speed; turning points and "direct to" on the bearing with
   * the drift laid off; the diversion on the heading worked out for it; the rejoin descending to 2,000 ft
   * above the field overhead.
   */
  private navProgram(kind: 'climbOverhead' | 'leg' | 'diversion' | 'direct' | 'overhead'): Program {
    const vs = this.aircraft.vspeeds;
    return this.program(`nav.${kind}`, (p, k) => {
      const xtk = k.num('nav.xtkNm');
      const correction = Number.isFinite(xtk) ? clamp(xtk * 12, -8, 8) : 0;
      const direct = orElse(k.num('nav.bearingDeg') + k.num('driftDeg'), k.num('hdgDeg'));
      let hdg: number;
      if (kind === 'diversion') hdg = DIVERSION.headingDeg;
      else if (kind === 'direct' || kind === 'overhead') hdg = direct;
      else hdg = Number.isFinite(k.target('hdgDeg')) ? k.target('hdgDeg') - correction : direct;
      const haf = k.target('hafFt');
      const alt = Number.isFinite(haf) ? haf + FIELD / FT : orElse(k.target('altFt'), p.m.alt ?? k.num('altFt'));
      p.m.alt = alt;
      const lat = { lateral: 'heading' as const, hdgDeg: hdg, maxBankDeg: 25 };
      if (kind === 'climbOverhead') {
        // A left-hand climbing orbit about 700 m round the field (inside the route's 1 NM start radius, so the
        // clock does not start), then straight to overhead at cruise altitude.
        const n = k.s.position.x;
        const e = k.s.position.y;
        const toCentre = Math.atan2(-e, -n) / DEG;
        const dist = Math.hypot(n, e);
        if (k.num('altFt') < alt - 80) {
          const orbit = toCentre + 90 - clamp((dist - 700) * 0.08, -45, 45);
          return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: orbit + (k.num('hdgDeg') - k.num('hdgTrueDeg')), maxBankDeg: 25, vertical: 'airspeed', kias: vs.Vy + 5 }, throttle: 1, flapsDeg: 0 };
        }
        return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: toCentre + (k.num('hdgDeg') - k.num('hdgTrueDeg')), maxBankDeg: 25, vertical: 'altitude', altFt: alt, captureFpm: 600, autothrottle: true, kias: vs.Vcruise }, flapsDeg: 0 };
      }
      return { mode: 'ap', ap: { ...lat, vertical: 'altitude', altFt: alt, captureFpm: 600, autothrottle: true, kias: vs.Vcruise }, flapsDeg: 0 };
    });
  }

  /**
   * Practice forced landing (L16, L21 section 5) with the throttle held closed: touch drills at once, best
   * glide; fly away from the field along the dead side until the height left will just bring the aircraft
   * back to the high key (abeam the upwind end, 2,000 ft) after a 180° turn, then the dead-side "downwind"
   * with flap as the energy plan to the low key (abeam the threshold, 1,000 ft) asks, a base leg cut to the
   * field, and final with the security checks, to the go-around at 200 ft.
   */
  private pflProgram(): Program {
    const vs = this.aircraft.vspeeds;
    /** Dead-side downwind line, m right of the centreline. */
    const LINE = 800;
    return this.program('pfl', (p, k) => {
      const s = k.s;
      const c = k.c;
      const rc = runwayCoords(s.position.x, s.position.y);
      const thr = rc.along + HALF;
      const haf = (s.altitudeMSL - FIELD) / FT;
      const hdg = k.num('hdgTrueDeg');
      const glide: ApTarget = { lateral: 'heading', maxBankDeg: 30, vertical: 'airspeed', kias: vs.Vglide + 2 + this.slop(k, 'asiKt') };
      if (p.phase === 'start') {
        p.phase = 'slow';
      }
      if (p.phase === 'slow' || p.phase === 'out' || p.phase === 'orbit') touchDrills(c);
      const deadLine = (h: number): number => h + clamp((rc.across - LINE) * 0.04, -25, 25) + k.num('driftDeg');
      if (p.phase === 'slow') {
        // Throttle closed (held): keep the height while the speed bleeds to best glide (no zoom), then glide.
        if (k.num('asiKt') < vs.Vglide + 6) p.phase = Math.abs(wrap180(hdg - 250)) < 60 && thr < 1900 ? 'downwind' : 'out';
        // From cruise speed a gentle 6° nose-up attitude trades the excess for height in about 10 s (level, it
        // takes half a minute out of the glide-speed band); below Vglide + 15 kt, hold the height.
        if (k.num('asiKt') > vs.Vglide + 15) return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: k.num('hdgDeg'), maxBankDeg: 15, vertical: 'pitch', pitchDeg: 6 }, throttle: 0, flapsDeg: 0 };
        p.m.alt1 ??= k.num('altFt');
        return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: k.num('hdgDeg'), maxBankDeg: 15, vertical: 'altitude', altFt: p.m.alt1 }, throttle: 0, flapsDeg: 0 };
      }
      if (p.phase === 'out') {
        // Toward the high-key box (beyond the upwind end, on the dead-side line), converging on the line on the
        // way, then orbit off the spare height there. With no height to spare for the keys at all (a dead-stick
        // start well out), straight onto the dead-side leg instead.
        const spare = haf - Math.max(0, thr - 1900) / 9 / FT - 2000;
        const dAlong = 2300 - thr;
        const dAcross = LINE - rc.across;
        if (spare < -150) p.phase = 'downwind';
        else if (Math.hypot(dAlong, dAcross) < 600 || (thr > 1900 && spare < 350 && Math.abs(dAcross) < 900)) p.phase = 'orbit';
        const toward = Math.atan2(dAcross, dAlong) / DEG;
        return { mode: 'ap', ap: { ...glide, hdgDeg: RWY_HDG_DEG + toward + k.num('driftDeg') }, throttle: 0, flapsDeg: 0 };
      }
      if (p.phase === 'orbit') {
        // Right-hand descending orbits (about 500 ft each); leave on 250 when the rest of the height will
        // just bring the aircraft to the high key at about 2,000 ft.
        // The height at the high key: what is left after gliding (about 9:1) back to abeam the upwind end.
        const atHighKey = haf - Math.max(0, thr - 1900) / 9 / FT;
        if (Math.abs(wrap180(hdg - 250)) < 12 && atHighKey < 2250) p.phase = 'downwind';
        return { mode: 'ap', ap: { ...glide, lateral: 'bank', bankDeg: 30, maxBankDeg: 32 }, throttle: 0, flapsDeg: 0 };
      }
      if (p.phase === 'downwind') {
        // Energy plan along the dead side: 2,000 ft at the upwind end down to 1,000 ft abeam the threshold.
        // That is steeper than even a full-flap glide over the runway's length, so when high the downwind is
        // flown wider (diverging from the line): a longer path to the low key, and a longer base after it.
        // (Beyond the upwind end, the height a glide needs to reach the high key.)
        const plan = thr > 1900 ? 2000 + (thr - 1900) / 9 / FT : 1000 + (Math.max(thr, 0) / 1900) * 1000;
        const dev = haf - plan;
        // Full flap from the high key unless already low on the plan: the plan needs about 6:1 over the ground.
        const flapsDeg = thr > 1900 ? 0 : dev > -40 ? 30 : dev > -120 ? 20 : dev > -200 ? 10 : 0;
        // A diverging dead-side leg (1,200 m out by the threshold unless already low), wider still when high.
        p.m.wide = Math.max(p.m.wide ?? 0, (1 - clamp(thr, 0, 1900) / 1900) * 1200 * clamp((dev + 100) / 200, 0, 1) + clamp((dev - 60) * 8, 0, 1500));
        const line = (h: number): number => h + clamp((rc.across - LINE - (p.m.wide ?? 0)) * 0.04, -45, 30) + k.num('driftDeg');
        const reach = haf * FT * (flapsDeg >= 20 ? 6.5 : 8);
        const need = Math.abs(rc.across) + Math.abs(thr - AIM_POINT) + 250;
        if (thr < -150 && (reach < need + 200 || thr < -1200)) p.phase = 'base';
        return { mode: 'ap', ap: { ...glide, hdgDeg: line(250) }, throttle: 0, flapsDeg };
      }
      if (p.phase === 'base') {
        if (rc.across < 230) p.phase = 'final';
        const toN = -HALF - 300 - rc.along;
        const brg = Math.atan2(-rc.across, toN) / DEG;
        return { mode: 'ap', ap: { ...glide, hdgDeg: RWY_HDG_DEG + clamp(brg, -120, -60) + k.num('driftDeg') }, throttle: 0, flapsDeg: 10 };
      }
      // Final: the security checks (fuel off, mixture cut-off, magnetos off) once the field is made.
      c.fuelSelector = 'off';
      c.mixture = 0;
      c.magnetos = 0;
      // A real dead-stick landing (C02; a PFL ends at the go-around call instead): a power-off flare on the sink
      // rate and the roll-out, as the glide approach flies them.
      const aglM = s.altitudeMSL - FIELD - REST_HEIGHT;
      if (p.phase === 'final' && aglM < Math.max(10, -6 * s.verticalSpeed)) p.phase = 'flare';
      if (p.phase === 'flare' && (s.wheels[1].onGround || s.wheels[2].onGround)) p.phase = 'rollout';
      if (p.phase === 'flare') {
        const vsFpm = -Math.max(70, aglM * 0.16 * 197);
        return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: RWY_HDG_DEG - (Math.atan2(rc.across, 150) * 0.8) / DEG + k.num('driftDeg'), maxBankDeg: 8, vertical: 'verticalSpeed', vsFpm }, throttle: 0 };
      }
      if (p.phase === 'rollout') {
        if (s.groundSpeed < 0.3) c.parkingBrake = true;
        return { mode: 'none', throttle: 0, flapsDeg: 0, brakes: s.ias / KT < 45 ? 0.7 : 0, law: (_h, st, ct) => rolloutLaw(st, ct, k.num('crosswindKt')) };
      }
      const dist = Math.max(30, AIM_POINT - thr);
      const angle = Math.atan2(haf * FT, dist) / DEG;
      let flapsDeg = angle > 10 ? 30 : angle > 8.5 ? 20 : angle > 7.3 ? 10 : 0;
      // Below 450 ft no new flap beyond 10, below 300 ft none at all, and none taken away on final: with full
      // flap low down, or flap retracted there, the idle sink passes 1,000 fpm, which below 200 ft is the safety
      // envelope's sink limit (seen in the skill test's forced landing).
      const had = Math.max(p.m.pflFlaps ?? 0, nearestDetent(k.num('flapsDeg')));
      if (haf < 450 && flapsDeg > Math.max(10, had)) flapsDeg = Math.max(10, had);
      if (haf < 300) flapsDeg = had;
      flapsDeg = Math.max(flapsDeg, had);
      p.m.pflFlaps = flapsDeg;
      const h = RWY_HDG_DEG - (Math.atan2(rc.across, 200) * 0.8) / DEG + k.num('driftDeg');
      return { mode: 'ap', ap: { ...glide, hdgDeg: h, kias: (flapsDeg >= 20 ? vs.Vref + 5 : vs.Vglide + 2) + this.slop(k, 'asiKt') }, throttle: 0, flapsDeg };
    });
  }

  // ---- programs: on the ground --------------------------------------------------------------------------------

  /** Engine start: master, fuel, mixture rich, throttle cracked, magnetos, then the starter until it runs. */
  private engineStartProgram(): Program {
    return this.program('engineStart', (p, k) => {
      const c = k.c;
      c.masterBattery = true;
      c.fuelSelector = 'both';
      c.mixture = 1;
      c.magnetos = 3;
      c.parkingBrake = true;
      const running = this.physics.state.engine.running;
      // Cranks of 8 s (under the 10 s limit); if it has not caught, a pause with the fuel pump on to prime,
      // and again.
      const cycle = (p.t - 1) % 14;
      c.starter = !running && p.t > 1 && cycle < 8;
      if (!running && p.t > 9) c.fuelPump = cycle >= 9 && cycle < 13;
      else if (running) c.fuelPump = false;
      if (running) this.holdRpm(1000);
      return { mode: 'none', throttle: running ? this.groundThrottle : 0.08 };
    });
  }

  /** Hold an rpm on the ground with the parking brake set (oil pressure, run-up). */
  private groundRpmProgram(rpm: number): Program {
    return this.program('groundRpm', (_p, k) => {
      k.c.parkingBrake = true;
      this.holdRpm(rpm + this.slop(k, 'rpm'));
      return { mode: 'none', throttle: this.groundThrottle };
    });
  }

  /** Magneto check at the run-up rpm: right, both, left, both (4.5 s each), never OFF. */
  private magnetoProgram(): Program {
    return this.program('mags', (p, k) => {
      k.c.parkingBrake = true;
      this.holdRpm(1800);
      const seq = [1, 3, 2, 3] as const;
      k.c.magnetos = seq[Math.min(seq.length - 1, Math.floor(p.t / 4.5))];
      return { mode: 'none', throttle: this.groundThrottle };
    });
  }

  /**
   * Taxi from the apron to holding point A1: out of the parking row onto the apron taxilane, along it to B1,
   * B1 to the parallel taxiway A, west to A1 and up A1 to stop short of the hold line. The brakes are tested as
   * the aircraft moves off.
   */
  private taxiToA1Program(): Program {
    let path: LocalXY[] | null = null;
    // Item 8: the route the instructor calls, followed on its centreline (pure pursuit), once the runner has it.
    const pursuit = { s: NaN, route: null as TaxiRoute | null, iThr: 0 };
    return this.program('taxi', (p, k) => {
      const s = k.s;
      const c = k.c;
      // Off the brakes once the instructor has finished the taxi brief ("Go ahead"), as a student does (item 8:
      // rolling during the brief, the first turn came before its call could be heard).
      if (!p.m.cleared) {
        if (k.ctx.speechIdle && p.t > 1) p.m.cleared = 1;
        else return { mode: 'none', law: (_h, _st, ct) => { ct.brakeLeft = ct.brakeRight = 1; ct.throttle = Math.min(ct.throttle, 0.05); } };
      }
      c.parkingBrake = false;
      c.lights.taxi = true;
      if (!path) {
        const here = nedToLocal(s.position.x, s.position.y);
        path = [
          here,
          { u: here.u, v: APRON_TAXILANE_V },
          { u: B1_U, v: APRON_TAXILANE_V },
          { u: B1_U, v: PARALLEL_TAXIWAY_V },
          { u: A1_U, v: PARALLEL_TAXIWAY_V },
          { u: A1_U, v: HOLD_LINE_V - 12 },
        ];
      }
      const gs = s.groundSpeed / KT;
      if (p.phase === 'start' && gs > 2) {
        p.phase = 'brakeTest';
        p.phaseT = p.t;
      }
      if (p.phase === 'brakeTest' && p.t - p.phaseT > 1.5) p.phase = 'taxi';
      const route = this.taxiRoute;
      if (route && route !== pursuit.route) {
        pursuit.route = route;
        pursuit.s = NaN;
      }
      const law = route ? taxiPursuitLaw(route, this.slop(k, 'gsKt'), pursuit) : pathLaw(path, TAXI_KT + this.slop(k, 'gsKt'), true);
      if (p.phase === 'brakeTest') {
        return { mode: 'none', law: (h, st, ct) => {
          law(h, st, ct);
          ct.brakeLeft = ct.brakeRight = 0.6;
          ct.throttle = 0.05;
        } };
      }
      return { mode: 'none', law };
    });
  }

  // ---- programs: circuits -----------------------------------------------------------------------------------

  /**
   * Take-off from the 07 line-up (or from the hold, lining up first): full power, centreline on the rudder,
   * into-wind aileron early in the roll, rotate (51 kt with flap 10 for a short-field take-off), Vx or Vy, then
   * the circuit.
   */
  private takeoffProgram(kind: 'circuit' | 'short'): Program {
    const short = kind === 'short';
    const vs = this.aircraft.vspeeds;
    // Through the keyboard the nose comes up more slowly, so the rotation starts a little earlier (keyboard L13:
    // lift-off 11 kt above Vr from a rotation at Vr + 2).
    const rotate = short ? 51 : vs.Vr + (this.keyboard ? -2 : 2);
    return this.program(short ? 'shortTakeoff' : 'circuit', (p, k) => {
      const s = k.s;
      const c = k.c;
      const rc = runwayCoords(s.position.x, s.position.y);
      const agl = s.altitudeMSL - FIELD - REST_HEIGHT;
      const xwind = k.num('crosswindKt');
      c.lights.landing = true;
      c.lights.strobe = true;
      c.mixture = 1;
      if (p.phase === 'start') {
        c.parkingBrake = false;
        const lined = Math.abs(rc.across) < 10 && Math.abs(wrap180(k.num('hdgTrueDeg') - RWY_HDG_DEG)) < 15;
        p.phase = lined ? (short ? 'brakes' : 'roll') : 'lineup';
        p.m.u0 = rc.along;
      }
      if (p.phase === 'lineup') {
        const u = Math.max(p.m.u0, -HALF + 10);
        // Straight up the connector onto the runway, then a turn onto the centreline (cutting the corner would
        // cross the grass and the edge lights).
        const lineup: LocalXY[] = [{ u, v: Math.min(rc.across, -20) }, { u, v: -6 }, { u: u + 12, v: -1 }, { u: u + 35, v: 0 }, { u: u + 250, v: 0 }];
        if (rc.along > u + 30 && Math.abs(rc.across) < 3 && Math.abs(wrap180(k.num('hdgTrueDeg') - RWY_HDG_DEG)) < 8) p.phase = short ? 'brakes' : 'roll';
        return { mode: 'none', flapsDeg: short ? 10 : 0, law: pathLaw(lineup, 6, false) };
      }
      if (p.phase === 'brakes') {
        if (p.t > 3 && k.num('rpm') > 2200) p.phase = 'roll';
        return { mode: 'none', throttle: 1, flapsDeg: 10, brakes: 1, law: (_h, st, ct) => rollLaw(st, ct, rotate, xwind) };
      }
      if (p.phase === 'roll') {
        // A short-field lift-off hands over to the speed-on-attitude law at once (it must accelerate to Vx in
        // ground effect before 20 ft); a normal one after the first few metres.
        if (!s.onGround && agl > (short ? 1 : 4)) p.phase = 'climb';
        return { mode: 'none', throttle: 1, flapsDeg: short ? 10 : 0, brakes: 0, law: (_h, st, ct) => rollLaw(st, ct, rotate, xwind) };
      }
      if (!short && (agl < 15 || k.num('kias') < vs.Vy - 4) && p.phase === 'climb' && p.m.initial !== 1) {
        // Just airborne: hold the climb attitude while the speed builds (an airspeed mode at lift-off speed
        // would lower the nose onto the runway again).
        if (agl > 15 && k.num('kias') >= vs.Vy - 4) p.m.initial = 1;
        const hdg = RWY_HDG_DEG - clamp(rc.across * 0.08, -15, 15) + k.num('driftDeg');
        return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg, maxBankDeg: 10, vertical: 'pitch', pitchDeg: 7 }, throttle: 1, flapsDeg: 0 };
      }
      if (short) {
        // Accelerate to Vx in ground effect with the nose low, Vx to 300 ft, then Vy with the flap up.
        const hdg = RWY_HDG_DEG - clamp(rc.across * 0.08, -15, 15) + k.num('driftDeg');
        const kias = (agl > 300 * FT ? vs.Vy + 5 : vs.Vx + 5) + this.slop(k, 'asiKt');
        const flapsDeg = agl > 250 * FT && k.num('kias') > vs.Vx + 2 ? 0 : 10;
        // The speed on the attitude directly (a pilot's "pitch for Vx"): a low nose while slow, about 8° at Vx.
        const pitch = clamp(8 + 0.8 * (k.num('kias') - kias), 1, 13);
        return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg, maxBankDeg: 15, vertical: 'pitch', pitchDeg: pitch }, throttle: 1, flapsDeg };
      }
      return this.circuitTick(p, k);
    });
  }

  /**
   * The left-hand circuit for 07 from wherever the aircraft is (climb-out, crosswind, downwind, base, final),
   * ending with the approach, flare and roll-out. `def` (an approach task) sets the kind of landing.
   */
  private circuitProgram(def?: TaskStep): Program {
    const p = this.program('circuit', (pp, k) => this.circuitTick(pp, k));
    if (def) {
      const ias = def.card.targets.find((t) => t.sig === 'asiKt');
      const vsp = ias && typeof ias.value === 'object' && 'vspeed' in ias.value ? ias.value.vspeed : '';
      p.m.flapless = vsp === 'VappFlapsUp' ? 1 : 0;
      p.m.short = vsp === 'VshortField' ? 1 : 0;
    }
    return p;
  }

  private circuitTick(p: Program, k: Tick): Command {
    const s = k.s;
    const rc = runwayCoords(s.position.x, s.position.y);
    /** Along the 07 centreline from the 07 threshold, m (the runway is 0..1800). */
    const thr = rc.along + HALF;
    const haf = (s.altitudeMSL - FIELD) / FT;
    const vs = this.aircraft.vspeeds;
    const flapless = p.m.flapless === 1;
    const hdgNow = k.num('hdgTrueDeg');
    if (p.phase === 'start') {
      if (s.onGround) p.phase = 'climb';
      else if (rc.across > -400 && Math.abs(wrap180(hdgNow - RWY_HDG_DEG)) < 40 && thr < 0) p.phase = 'final';
      else if (rc.across < -700 && Math.abs(wrap180(hdgNow - 250)) < 60) p.phase = 'downwind';
      else if (rc.across < -400 && Math.abs(wrap180(hdgNow - 160)) < 50 && thr < 0) p.phase = 'base';
      else p.phase = haf > 450 ? 'crosswind' : 'climb';
    }
    const c = k.c;
    c.lights.landing = true;
    c.mixture = 1;
    switch (p.phase) {
      case 'deadside': {
        // Rejoin from overhead: out to the dead side (right of 07), descend there to circuit height flying
        // toward the upwind end, then cross the upwind end onto the crosswind leg.
        if (rc.across > 600 && thr > HALF) p.phase = 'deadsideUpwind';
        const toN = HALF + 400 - rc.along;
        const brg = Math.atan2(900 - rc.across, toN) / DEG;
        return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: RWY_HDG_DEG + brg, maxBankDeg: 25, vertical: 'altitude', altFt: PATTERN_ALTITUDE / FT, captureFpm: 600, autothrottle: true, kias: vs.Vdownwind }, flapsDeg: 0 };
      }
      case 'deadsideUpwind': {
        if (thr > RWY.length + 250 && haf < 1150) p.phase = 'crosswind';
        const hdg = RWY_HDG_DEG - clamp((rc.across - 900) * 0.04, -25, 25) + k.num('driftDeg');
        return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg, maxBankDeg: 25, vertical: 'altitude', altFt: PATTERN_ALTITUDE / FT, captureFpm: 600, autothrottle: true, kias: vs.Vdownwind }, flapsDeg: 0 };
      }
      case 'climb': {
        // Upwind to 500 ft above the field (and past the runway's far half), then crosswind.
        if (haf > 520 && thr > HALF) p.phase = 'crosswind';
        const hdg = RWY_HDG_DEG - clamp(rc.across * 0.08, -15, 15) + k.num('driftDeg');
        return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg, maxBankDeg: 15, vertical: 'airspeed', kias: vs.Vy + 5 + this.slop(k, 'asiKt') }, throttle: 1, flapsDeg: 0 };
      }
      case 'crosswind': {
        if (rc.across < DOWNWIND_ACROSS + 350) p.phase = 'downwind';
        const cct = PATTERN_ALTITUDE / FT + this.slop(k, 'hafFt');
        const level = s.altitudeMSL / FT > cct - 15;
        const ap: ApTarget = level
          ? { lateral: 'heading', hdgDeg: 340, maxBankDeg: 20, vertical: 'altitude', altFt: cct, captureFpm: 500, autothrottle: true, kias: vs.Vdownwind + this.slop(k, 'asiKt') }
          : { lateral: 'heading', hdgDeg: 340, maxBankDeg: 20, vertical: 'airspeed', kias: vs.Vy + 5 };
        return { mode: 'ap', ap, throttle: level ? null : 1, flapsDeg: 0 };
      }
      case 'downwind': {
        if (thr < BASE_TURN_ALONG) p.phase = 'base';
        const hdg = 250 + clamp((rc.across - DOWNWIND_ACROSS) * 0.04, -25, 25) + k.num('driftDeg');
        const abeam = thr < 200;
        const kias = (abeam ? 80 : vs.Vdownwind) + this.slop(k, 'asiKt');
        return {
          mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg, maxBankDeg: 20, vertical: 'altitude', altFt: PATTERN_ALTITUDE / FT + this.slop(k, 'hafFt'), captureFpm: 450, autothrottle: true, kias },
          flapsDeg: abeam && !flapless ? 10 : 0,
        };
      }
      case 'base': {
        if (rc.across > -380) p.phase = 'final';
        return {
          mode: 'ap', ap: { lateral: 'heading', hdgDeg: 160 + k.num('driftDeg'), maxBankDeg: 20, vertical: 'altitude', altFt: FIELD / FT + 520, captureFpm: 750, autothrottle: true, kias: flapless ? vs.VappFlapsUp + 5 : vs.Vapp + 3 },
          flapsDeg: flapless ? 0 : 20,
        };
      }
      default:
        return this.approachTick(p, k, flapless ? 'flapless' : p.m.short === 1 ? 'short' : 'normal');
    }
  }

  /**
   * Final approach, flare and roll-out (the autoflight's approach law with this student's own numbers): the
   * centreline crabbed into wind, the 3 degree path to an aim point chosen for the landing, the speed on the
   * power; the flare from about 20 ft with the throttle closed, the into-wind wing lowered and the nose
   * straightened with rudder; the roll-out on the centreline with into-wind aileron, braking to a stop.
   */
  private approachTick(p: Program, k: Tick, kind: 'normal' | 'flapless' | 'short'): Command {
    const s = k.s;
    const rc = runwayCoords(s.position.x, s.position.y);
    const vs = this.aircraft.vspeeds;
    const agl = s.altitudeMSL - FIELD - REST_HEIGHT;
    const xwind = k.num('crosswindKt');
    // Approach speed and aim point (m beyond the threshold): flapless and short landings float differently.
    const kias = (kind === 'flapless' ? vs.VappFlapsUp + 1 : kind === 'short' ? vs.VshortField + 2 : vs.Vref + 1) + this.slop(k, 'asiKt');
    // Through the keyboard the round-out sets in earlier and the wheels touch sooner: aim 50 m further on.
    // Into a headwind the float covers less ground, so the path aims 3 m further on per knot of headwind: aiming
    // 10 m short of the aim point put the wheels on it at best, and in L20's 8 kt headwind 34 ft short of the
    // touchdown zone once the idle propeller absorbed its proper power (a shorter float). A fixed later aim does
    // not do: the night circuits (calm) already touch down ~370 ft into the 400 ft zone. L20 now +30 ft.
    const headwind = Math.max(0, k.num('headwindKt') || 0);
    const aim = (kind === 'flapless' ? AIM_POINT - 95 : kind === 'short' ? AIM_POINT - 35 : AIM_POINT - 10 + 3 * headwind) + (this.keyboard ? 50 : 0);
    const flapsDeg = kind === 'flapless' ? 0 : 30;
    if (p.phase !== 'flare' && p.phase !== 'rollout' && p.phase !== 'stopped') p.phase = 'final';
    const flareAt = this.keyboard ? Math.max(10, -4 * s.verticalSpeed) : Math.max(6, -3 * s.verticalSpeed);
    if (p.phase === 'final' && agl < flareAt) {
      p.phase = 'flare';
      p.m.flarePitch = s.pitch / DEG;
      p.m.flareH = Math.max(flareAt, agl);
    }
    if (p.phase === 'flare' && (s.wheels[1].onGround || s.wheels[2].onGround)) p.phase = 'rollout';
    if (p.phase === 'rollout' && s.groundSpeed < 0.3) p.phase = 'stopped';
    k.c.lights.landing = true;
    // A little integral on the centreline offset: a crosswind the drift estimate does not quite cancel would
    // otherwise leave the touchdown a few metres to one side (the skill test allows 5 m).
    if (p.phase === 'final' || p.phase === 'flare') p.m.ix = clamp((p.m.ix ?? 0) + rc.across * k.dt, -300, 300);
    else p.m.ix = 0;
    const trim = -0.02 * (p.m.ix ?? 0);
    if (p.phase === 'final') {
      const toAim = -HALF + aim - rc.along;
      const pathH = Math.max(toAim, 0) * Math.tan(GLIDE_PATH);
      const vsMs = -s.groundSpeed * Math.tan(GLIDE_PATH) + 0.1 * (pathH - agl);
      const hdg = RWY_HDG_DEG - (Math.atan2(rc.across, 250) * 0.8) / DEG + k.num('driftDeg') + trim;
      return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg, maxBankDeg: 15, vertical: 'verticalSpeed', vsFpm: vsMs / FPM_MS, autothrottle: true, kias }, flapsDeg };
    }
    if (p.phase === 'flare') {
      const start = p.m.flarePitch;
      const touch = Math.min(start + 8, 10);
      const pitch = start + (touch - start) * clamp(1 - agl / p.m.flareH, 0, 1);
      const hdg = RWY_HDG_DEG - (Math.atan2(rc.across, 80) * 0.8) / DEG + k.num('driftDeg') + trim;
      return {
        mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg, maxBankDeg: 10, vertical: 'pitch', pitchDeg: pitch }, throttle: this.keyboard && agl > 3 ? undefined : 0, flapsDeg,
        law: Math.abs(xwind) > 3 ? (_h, st, ct) => crosswindFlareLaw(st, ct, xwind) : undefined,
      };
    }
    // On the runway: flap up (no more lift: a gust cannot lift it off again), then brakes as it slows.
    if (p.phase === 'rollout') return { mode: 'none', throttle: 0, flapsDeg: 0, brakes: s.ias / KT < 45 ? 0.7 : 0, law: (_h, st, ct) => rolloutLaw(st, ct, xwind) };
    k.c.parkingBrake = true;
    return { mode: 'none', throttle: 0, flapsDeg: 0, brakes: 0, law: (_h, st, ct) => rolloutLaw(st, ct, 0) };
  }

  /**
   * Go around (on the call; or, deciding an unstable approach will not do, as soon as the aircraft is below
   * `belowAglFt`): full power, stop the descent, flap 20 at once then up in stages, keeping above Vx.
   */
  private goAroundProgram(belowAglFt: number | null): Program {
    return this.program('goAround', (p, k) => {
      if (p.phase === 'start' && belowAglFt !== null && p.m.waited !== 1) {
        if (k.num('aglFt') >= belowAglFt) return this.approachTick({ ...p, phase: 'final' }, k, 'normal');
        p.m.waited = 1;
        p.t = 0;
      }
      const kias = k.num('kias');
      const flaps = k.num('flapsDeg');
      const climbing = k.num('vsFpm') > 100;
      let flapsDeg = nearestDetent(flaps);
      if (flaps > 25) flapsDeg = 20;
      else if (flaps > 15 && kias > 66 && climbing) flapsDeg = 10;
      else if (flaps > 5 && kias > 70 && climbing && k.num('hafFt') > 250) flapsDeg = 0;
      const s = k.s;
      const rc = runwayCoords(s.position.x, s.position.y);
      const hdg = RWY_HDG_DEG - clamp(rc.across * 0.05, -8, 8) + k.num('driftDeg');
      if (p.phase === 'start' && p.t > 2.5) p.phase = 'climb';
      if (p.phase === 'start') return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg, maxBankDeg: 10, vertical: 'pitch', pitchDeg: 4 }, throttle: 1, flapsDeg };
      const vx = this.aircraft.vspeeds.Vx;
      return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg, maxBankDeg: 10, vertical: 'airspeed', kias: Math.max(vx + 6, Math.min(kias + 2, this.aircraft.vspeeds.Vy + 3)) }, throttle: 1, flapsDeg };
    });
  }

  /** Engine failure after take-off: nose down to best glide straight ahead, touch drills, wait for the call. */
  private efatoProgram(): Program {
    return this.program('efato', (_p, k) => {
      touchDrills(k.c);
      const s = k.s;
      const rc = runwayCoords(s.position.x, s.position.y);
      const hdg = RWY_HDG_DEG - clamp(rc.across * 0.05, -10, 10);
      return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg, maxBankDeg: 10, vertical: 'airspeed', kias: this.aircraft.vspeeds.Vglide + this.slop(k, 'asiKt') }, throttle: 0, flapsDeg: 0 };
    });
  }

  /**
   * A glide to the runway with the throttle closed (L11 glide approach from the downwind; L12 engine failure
   * on the downwind): close the throttle abeam the aim point (at once for a failure), best glide, turn base
   * when the glide that is left just reaches the field, final with flap as the angle to the aim point asks,
   * and a power-off flare and landing (the failure ends at 200 ft with the go-around call).
   */
  private glideApproachProgram(kind: 'glide' | 'failure'): Program {
    const vs = this.aircraft.vspeeds;
    return this.program(kind === 'failure' ? 'efDownwind' : 'glideApproach', (p, k) => {
      const s = k.s;
      const rc = runwayCoords(s.position.x, s.position.y);
      const thr = rc.along + HALF;
      const haf = s.altitudeMSL - FIELD;
      if (kind === 'failure') touchDrills(k.c);
      if (p.phase === 'start') p.phase = kind === 'failure' ? 'downwind' : 'powered';
      if (p.phase === 'powered') {
        // Glide approach: power on, downwind until abeam the aim point.
        if (thr < AIM_POINT + 30) p.phase = 'downwind';
        const hdg = 250 + clamp((rc.across + 900) * 0.04, -20, 20) + k.num('driftDeg');
        return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: hdg, maxBankDeg: 20, vertical: 'altitude', altFt: PATTERN_ALTITUDE / FT, captureFpm: 400, autothrottle: true, kias: vs.Vdownwind } };
      }
      // Turn base when the height left would bring a clean idle glide (about 6°, L/D 9) just to the aim point
      // over the base leg and final still to fly (a little high in hand: flap can take it off, nothing adds it).
      const aimThr = AIM_POINT;
      const remaining = Math.abs(rc.across) + Math.abs(thr - aimThr) + 100;
      if (p.phase === 'downwind' && (haf <= 0.11 * remaining + 30 || thr < -1500)) p.phase = 'base';
      if (p.phase === 'base' && rc.across > -230) p.phase = 'final';
      const agl = haf - REST_HEIGHT;
      // (Through the keyboard the round-out starts higher: the yoke raises the nose more slowly.)
      if (p.phase === 'final' && agl < (this.keyboard ? Math.max(16, -7 * s.verticalSpeed) : Math.max(12, -6 * s.verticalSpeed))) p.phase = 'flare';
      if (p.phase === 'flare' && (s.wheels[1].onGround || s.wheels[2].onGround)) p.phase = 'rollout';
      // Flap by the angle down to the aim point: the clean idle glide is about 6.3° (L/D 9); flap 10, 20 and
      // 30 steepen it to about 7, 8 and 9.5°. Below 250 ft no more than flap 20 (full flap sinks past 1,000 fpm).
      const dist = Math.max(30, aimThr - thr);
      const angle = Math.atan2(haf, dist) / DEG;
      let flapsDeg = p.phase === 'final' || p.phase === 'flare' ? (angle > 10 ? 30 : angle > 8.5 ? 20 : angle > 7.3 ? 10 : 0) : 0;
      // Low down no more than flap 10: with more the idle sink passes 1,000 fpm (a safety breach below 200 ft).
      if (haf < 300 * FT && flapsDeg > 10) flapsDeg = 10;
      // And no change below 350 ft: a new stage low down pitches the nose down for the speed, and one taken away
      // drops the wing's lift; either way the sink passes 1,000 fpm just as the ground comes up (seen in the
      // browser: flap 10 retracted at 100 ft as the angle to the aim point flattened, and a crash).
      const had = p.m.glFlaps ?? 0;
      if (haf < 350 * FT && (p.phase === 'final' || p.phase === 'flare')) flapsDeg = had;
      p.m.glFlaps = flapsDeg;
      const sloppy = this.slop(k, 'asiKt');
      const glide: ApTarget = { lateral: 'heading', maxBankDeg: 25, vertical: 'airspeed', kias: vs.Vglide + 1 + sloppy };
      if (p.phase === 'downwind') {
        const hdg = 250 + clamp((rc.across + 900) * 0.03, -20, 20) + k.num('driftDeg');
        return { mode: 'ap', ap: { ...glide, hdgDeg: hdg }, throttle: 0, flapsDeg: 0 };
      }
      if (p.phase === 'base') {
        // Toward a point on the extended centreline 300 m before the threshold (a base angled in when close).
        const toN = -HALF - 300 - rc.along;
        const brg = Math.atan2(-rc.across, toN) / DEG;
        return { mode: 'ap', ap: { ...glide, hdgDeg: RWY_HDG_DEG + clamp(brg, 60, 120) + k.num('driftDeg') }, throttle: 0, flapsDeg: 0 };
      }
      if (p.phase === 'final') {
        const hdg = RWY_HDG_DEG - (Math.atan2(rc.across, 200) * 0.8) / DEG + k.num('driftDeg');
        // Low on final a few knots under the best-glide speed: nearer the minimum-sink speed, so a gust or a
        // stage of flap does not take the sink past 1,000 fpm close to the ground.
        // (Through the keyboard the best glide speed to the end: the slower keyboard flare needs the energy.)
        const kias = (flapsDeg >= 20 ? vs.Vref + 3 : haf < 350 * FT && !this.keyboard ? vs.Vglide - 3 : vs.Vglide + 1) + sloppy;
        return { mode: 'ap', ap: { ...glide, hdgDeg: hdg, kias }, throttle: 0, flapsDeg };
      }
      if (p.phase === 'flare') {
        // A glide arrives sinking at 700-900 fpm: flare on the sink rate (a vertical speed that shrinks with
        // the height, 100 fpm at the wheels), not a fixed attitude change, so the arrival is gentle.
        const vsFpm = -Math.max(70, agl * 0.16 * 197);
        return { mode: 'ap', ap: { lateral: 'heading', hdgDeg: RWY_HDG_DEG - (Math.atan2(rc.across, 150) * 0.8) / DEG + k.num('driftDeg'), maxBankDeg: 8, vertical: 'verticalSpeed', vsFpm }, throttle: 0, flapsDeg };
      }
      if (s.groundSpeed < 0.3) k.c.parkingBrake = true;
      return { mode: 'none', throttle: 0, flapsDeg: 0, brakes: s.ias / KT < 45 ? 0.7 : 0, law: (_h, st, ct) => rolloutLaw(st, ct, k.num('crosswindKt')) };
    });
  }
}

/** Ground programs that hold the aircraft for one task only (the next checklist releases them). */
const GROUND_HOLDS = new Set(['engineStart', 'groundRpm', 'mags']);

/** Programs that span several tasks: a new task of the same kind does not restart them. */
const CONTINUOUS = new Set(['circuit', 'pfl']);

// ---- control laws ------------------------------------------------------------------------------------------------

/**
 * Take-off roll: the centreline on the rudder, into-wind aileron while slow then wings level, and the rotation
 * at `rotateKias` to about 8° nose up.
 */
function rollLaw(s: AircraftState, c: ControlInputs, rotateKias: number, xwindKt: number): void {
  const rc = runwayCoords(s.position.x, s.position.y);
  const kias = s.ias / KT;
  const desired = RWY.heading - Math.atan2(rc.across, 60);
  c.rudder = clamp(4 * wrapPi(desired - s.heading) - 1.5 * s.angularVelocity.z, -1, 1);
  // Wings level, plus into-wind aileron that is full when slow and fades out toward the rotation speed.
  const intoWind = Math.abs(xwindKt) > 3 ? Math.sign(xwindKt) * clamp((45 - kias) / 30, 0, 0.6) : 0;
  c.aileron = clamp((kias > 25 ? -2 * s.roll - 0.3 * s.angularVelocity.x : 0) + intoWind, -1, 1);
  c.elevator = kias > rotateKias ? clamp(5 * (8 * DEG - s.pitch) - 1.5 * s.angularVelocity.y + 0.3, -1, 1) : 0;
}

/** In the flare in a crosswind: the into-wind wing down a little, the nose straightened along the runway. */
function crosswindFlareLaw(s: AircraftState, c: ControlInputs, xwindKt: number): void {
  const rc = runwayCoords(s.position.x, s.position.y);
  const acrossRate = runwayCoords(s.position.x + s.velocity.x, s.position.y + s.velocity.y).across - rc.across;
  // Into-wind wing down by the crosswind, trimmed by the offset and the sideways drift so the wheels touch on
  // the centreline whichever side the wind is from.
  const bankTarget = clamp(0.3 * xwindKt - 0.4 * rc.across - 1.5 * acrossRate, -6, 6) * DEG;
  c.aileron = clamp(3 * (bankTarget - s.roll) - 0.4 * s.angularVelocity.x, -1, 1);
  c.rudder = clamp(3 * wrapPi(RWY.heading - s.heading) - 1 * s.angularVelocity.z, -1, 1);
}

/** After touchdown: centreline on the rudder, into-wind aileron, the yoke easing forward. */
function rolloutLaw(s: AircraftState, c: ControlInputs, xwindKt: number): void {
  const rc = runwayCoords(s.position.x, s.position.y);
  const desired = RWY.heading - Math.atan2(rc.across, 60);
  c.rudder = clamp(4 * wrapPi(desired - s.heading) - 1.5 * s.angularVelocity.z, -1, 1);
  const kias = s.ias / KT;
  const intoWind = Math.abs(xwindKt) > 3 ? Math.sign(xwindKt) * clamp((55 - kias) / 30, 0, 0.6) : 0;
  c.aileron = clamp((kias > 25 ? -2 * s.roll - 0.3 * s.angularVelocity.x : 0) + intoWind, -1, 1);
  // Little back pressure while fast (a firm pull at touchdown speed would lift it off again), more as it
  // slows to keep the nosewheel light.
  c.elevator = clamp(0.5 - (kias - 45) * 0.05, 0, 0.5);
}

/**
 * Follow a path of local-frame points on the ground at `kt` (slower in turns): nosewheel steering on the
 * rudder toward a point 15 m ahead along the path, speed on throttle and brakes; `stop` brakes to a stop at
 * the last point and sets the parking brake.
 */
function pathLaw(path: readonly LocalXY[], kt: number, stop: boolean) {
  return (_h: number, s: AircraftState, c: ControlInputs): void => {
    const here = nedToLocal(s.position.x, s.position.y);
    // The nearest segment, then a look-ahead point 15 m further along the path.
    let best = 0;
    let bestD = Infinity;
    let bestT = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const du = b.u - a.u;
      const dv = b.v - a.v;
      const len2 = du * du + dv * dv || 1;
      const t = clamp(((here.u - a.u) * du + (here.v - a.v) * dv) / len2, 0, 1);
      const d = Math.hypot(a.u + du * t - here.u, a.v + dv * t - here.v);
      if (d < bestD - 1e-6) {
        bestD = d;
        best = i;
        bestT = t;
      }
    }
    let ahead = 15;
    let i = best;
    let t = bestT;
    let target = path[path.length - 1];
    while (i < path.length - 1) {
      const a = path[i];
      const b = path[i + 1];
      const segLen = Math.hypot(b.u - a.u, b.v - a.v);
      const left = segLen * (1 - t);
      if (left >= ahead) {
        const fr = t + ahead / Math.max(segLen, 1e-6);
        target = { u: a.u + (b.u - a.u) * fr, v: a.v + (b.v - a.v) * fr };
        break;
      }
      ahead -= left;
      i++;
      t = 0;
    }
    const tgt = localToNed(target.u, target.v);
    const brg = Math.atan2(tgt.east - s.position.y, tgt.north - s.position.x);
    const err = wrapPi(brg - s.heading);
    c.rudder = clamp(2.2 * err - 0.8 * s.angularVelocity.z, -1, 1);
    c.aileron = 0;
    c.elevator = 0;
    const last = path[path.length - 1];
    const toEnd = Math.hypot(last.u - here.u, last.v - here.v);
    const atEnd = stop && toEnd < 3;
    const want = atEnd ? 0 : Math.min(kt, Math.abs(err) > 0.35 ? 4 : kt, stop ? 1.5 + toEnd * 0.2 : kt);
    const gs = s.groundSpeed / KT;
    c.throttle = clamp(0.08 + 0.04 * (want - gs), 0, 0.3);
    c.brakeLeft = c.brakeRight = atEnd ? 1 : gs > want + 2 ? 0.4 : 0;
    if (atEnd && gs < 0.5) c.parkingBrake = true;
  };
}

/** The point of a taxi route `sM` metres along it (clamped to its ends), NED. */
function routePointAt(r: TaxiRoute, sM: number): { north: number; east: number } {
  const pts = r.points;
  if (sM <= 0) return pts[0];
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    if (b.sM >= sM) {
      const f = (sM - a.sM) / Math.max(1e-6, b.sM - a.sM);
      return { north: a.north + (b.north - a.north) * f, east: a.east + (b.east - a.east) * f };
    }
  }
  return pts[pts.length - 1];
}

/** Heading of the route at `sM`, rad (true, NED). */
function routeHeadingAt(r: TaxiRoute, sM: number): number {
  const a = routePointAt(r, sM - 1);
  const b = routePointAt(r, sM + 1);
  return Math.atan2(b.east - a.east, b.north - a.north);
}

/**
 * The route-following taxi driver (item 8): pure pursuit on the centreline the instructor's calls are measured
 * along. A look-ahead point 5-9 m on (further at speed) gives the path curvature to steer, nosewheel angle =
 * atan(curvature x wheelbase); the pedals (rudder) steer the nosewheel up to its 10 degree stop, with yaw-rate
 * feedback, and the inside toe brake takes the rest in the tight apron tees. Speed 10.5 kt on the straights,
 * 8.5 kt where the route turns within the next 20 m, with an integral on the throttle; at the end of a hold-short
 * route it stops a few metres short of the route end (the CG 4 m behind the hold line). `slopKt`: the student's
 * speed error.
 */
function taxiPursuitLaw(route: TaxiRoute, slopKt: number, mem: { s: number; iThr: number }) {
  return (h: number, s: AircraftState, c: ControlInputs): void => {
    const n = s.position.x, e = s.position.y;
    const fix = fixOnRoute(route, n, e, Number.isFinite(mem.s) ? mem.s : undefined);
    mem.s = fix.sM;
    const v = s.groundSpeed;
    const ld = clamp(4 + 0.9 * v, 5, 9);
    const tgt = routePointAt(route, fix.sM + ld);
    const dn = tgt.north - n, de = tgt.east - e;
    const dist = Math.max(1, Math.hypot(dn, de));
    const alpha = wrapPi(Math.atan2(de, dn) - s.heading);
    const kappa = (2 * Math.sin(alpha)) / dist;
    const delta = Math.atan(kappa * WHEELBASE_M);
    const rWant = kappa * Math.max(v, 0.5);
    const r = s.angularVelocity.z;
    c.rudder = clamp(delta / PEDAL_STEER + 1.2 * (rWant - r), -1, 1);
    c.aileron = 0;
    c.elevator = 0;
    // The inside toe brake where the pedals are not enough (the 9 m apron tees).
    const excess = Math.abs(delta) - PEDAL_STEER * 0.9;
    const diff = excess > 0 && v > 1 ? clamp(excess * 6, 0, 0.6) : 0;
    // Speed: slower where the route turns within the next 20 m.
    let bend = 0;
    for (let a = 0; a <= 20; a += 4) bend = Math.max(bend, Math.abs(wrapPi(routeHeadingAt(route, fix.sM + a + 4) - routeHeadingAt(route, fix.sM + a))));
    const toEnd = route.lengthM - fix.sM;
    const stop = route.holdShort ? 3 : 1;
    const cruise = (bend > 0.12 ? TAXI_TURN_KT : TAXI_STRAIGHT_KT) + slopKt;
    const want = toEnd <= stop ? 0 : Math.min(cruise, 1.5 + Math.max(0, toEnd - stop) * 0.35);
    const gs = v / KT;
    mem.iThr = clamp(mem.iThr + 0.012 * (want - gs) * h, -0.05, 0.08);
    c.throttle = want === 0 ? 0 : clamp(0.07 + mem.iThr + 0.03 * (want - gs), 0, 0.3);
    const slow = gs > want + 1.5 ? clamp(0.15 * (gs - want), 0, 0.6) : 0;
    c.brakeLeft = slow + (delta < 0 ? diff : 0);
    c.brakeRight = slow + (delta > 0 ? diff : 0);
    if (want === 0) {
      c.brakeLeft = c.brakeRight = 1;
      if (gs < 0.5) c.parkingBrake = true;
    }
  };
}

/** Engine-failure touch drills: fuel selector BOTH, mixture RICH, magnetos BOTH, fuel pump ON. */
function touchDrills(c: ControlInputs): void {
  c.fuelSelector = 'both';
  c.mixture = 1;
  c.magnetos = 3;
  c.fuelPump = true;
}

// ---- small helpers ---------------------------------------------------------------------------------------------

function num(x: unknown): number {
  return typeof x === 'number' ? x : typeof x === 'boolean' ? (x ? 1 : 0) : NaN;
}

function orElse(x: number, fallback: number): number {
  return Number.isFinite(x) ? x : fallback;
}

function wrap180(a: number): number {
  return ((((a + 180) % 360) + 360) % 360) - 180;
}

function nearestDetent(deg: number): number {
  return [0, 10, 20, 30].reduce((b, d) => (Math.abs(d - deg) < Math.abs(b - deg) ? d : b), 0);
}

/** The flap a task's criteria ask for (`check`: held(near('flapsDeg', X))), or null. */
function flapsFromCriteria(def: TaskStep): number | null {
  for (const c of def.criteria) {
    const x = c.kind === 'check' ? findNear(c.pred, 'flapsDeg') : null;
    if (x !== null) return x;
  }
  return null;
}

function findNear(p: Pred | undefined, sig: string): number | null {
  if (!p) return null;
  if ('near' in p && p.sig === sig && typeof p.near === 'number') return p.near;
  if ('held' in p) return findNear(p.held, sig);
  if ('all' in p) {
    for (const q of p.all) {
      const x = findNear(q, sig);
      if (x !== null) return x;
    }
  }
  return null;
}

/** The rpm a checklist item checks (all(ge(rpm, a), le(rpm, b)) or lt(rpm, b)), or null. */
function rpmBand(p: Pred | undefined): number | null {
  if (!p) return null;
  const parts = 'all' in p ? p.all : [p];
  let lo = NaN;
  let hi = NaN;
  for (const q of parts) {
    if (!('sig' in q) || q.sig !== 'rpm' || !('op' in q) || typeof q.v !== 'number') continue;
    if (q.op === '>' || q.op === '>=') lo = q.v;
    else hi = q.v;
  }
  if (Number.isFinite(lo) && Number.isFinite(hi)) return (lo + hi) / 2;
  if (Number.isFinite(hi)) return Math.max(900, hi - 200);
  if (Number.isFinite(lo)) return lo + 100;
  return null;
}

/** Write the controls that make a checklist item's check true (switches and levers only). */
function satisfy(p: Pred, c: ControlInputs, aircraft: AircraftTypeDef): void {
  if ('all' in p) {
    for (const q of p.all) satisfy(q, c, aircraft);
    return;
  }
  if ('not' in p) {
    const q = p.not;
    if ('sig' in q && 'eq' in q && q.sig === 'fuelSel' && q.eq === 'both') c.fuelSelector = 'left';
    return;
  }
  if (!('sig' in p) || typeof p.sig !== 'string') return;
  const sig = p.sig;
  if ('eq' in p) {
    const v = p.eq;
    switch (sig) {
      case 'fuelSel': c.fuelSelector = v as ControlInputs['fuelSelector']; break;
      case 'mags': c.magnetos = v as ControlInputs['magnetos']; break;
      case 'fuelPump': c.fuelPump = v === true; break;
      case 'parkingBrake': c.parkingBrake = v === true; break;
      case 'avionics': c.avionics = v === true; break;
      case 'master': c.masterBattery = v === true; if (v !== true) c.alternator = false; break;
      case 'alternator': c.alternator = v === true; break;
      case 'lightLanding': c.lights.landing = v === true; break;
      case 'lightStrobe': c.lights.strobe = v === true; break;
      case 'lightNav': c.lights.nav = v === true; break;
      case 'lightBeacon': c.lights.beacon = v === true; break;
      case 'lightTaxi': c.lights.taxi = v === true; break;
      default: break;
    }
    return;
  }
  if ('op' in p && typeof p.v === 'number') {
    const v = p.v;
    const up = p.op === '>' || p.op === '>=';
    switch (sig) {
      case 'mixture': c.mixture = up ? 1 : 0; break;
      case 'throttle': c.throttle = up ? Math.max(c.throttle, v + 0.03) : Math.min(c.throttle, v - 0.03); break;
      case 'trim': c.elevatorTrim = up ? Math.max(c.elevatorTrim, v + 0.05) : Math.min(c.elevatorTrim, v - 0.05); break;
      case 'flapsDeg': if (!up) c.flaps = flapLeverFor(aircraft, 0); break;
      default: break;
    }
  }
}
