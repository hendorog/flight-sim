// Ground coaching in dual lessons (owner playtest: "The RPM was well above 1000 and no action taken"): rules
// that watch the student on the ground whatever the step is, so nothing the lesson's own steps forget goes
// unremarked. Each rule needs its condition to persist, has its own reminder ladder (never the same words
// twice running, help offered after two) and a gap; one remark at a time.
//   - rpm: stationary with the engine above 1,200 rpm for 5 s -> "Bring the power back to 1,000 rpm".
//     Not while a step asks for more (the run-up, a checklist item checking an rpm above 1,200).
//   - taxi rules, only while a taxi route is followed: faster than 15 kt (2 s), more than 3 m off the yellow
//     line (3 s), and the brake test not done 15 s after moving off.

import type { ControlInputs } from '../../core/types';
import { keyLabelForAction, type InputAction } from '../../input/bindings';
import type { InlineCue, PointTarget, SignalFrame } from '../types';
import { groundThrottleFor } from './controls';
import { Priority } from '../types';
import { REMINDERS_BEFORE_HELP, ReminderLadder } from './reminders';

/** Above this the engine is not at idle / taxi power when stationary, rpm. */
export const GROUND_RPM_MAX = 1200;
const RPM_FOR_S = 5;
/** Taxi speed limit (C172S Vtaxi), kt, and how long over it before a remark, s. */
export const TAXI_GS_MAX_KT = 15;
const FAST_FOR_S = 2;
/** Off the centreline, m, for this long, s. */
export const TAXI_XTRACK_MAX_M = 3;
const XTRACK_FOR_S = 3;
/** The brake test is due this long after moving off, s. */
const BRAKE_DUE_S = 15;
/** Gap between remarks on one topic, and between any two ground remarks, s. */
const TOPIC_GAP_S = 14;
const GLOBAL_GAP_S = 5;
/** Off the paved surface for this long: stop (a safety call, repeated while it lasts), s. */
const OFF_PAVED_FOR_S = 1.5;
const OFF_PAVED_GAP_S = 10;

const num = (x: unknown): number => (typeof x === 'number' ? x : NaN);

export interface GroundRemark {
  topic: string; cue: InlineCue; point: PointTarget | null; help: boolean;
  /** The key the callout shows for `point` when it is not the control's main key (throttle back: F2). */
  key?: InputAction;
  /** Controls she sets herself (the rpm still high after the offer of help: she brings it back). */
  set?: Partial<ControlInputs>;
}

export interface GroundContext {
  /** Coaching applies now (dual lesson, student flying, coach level not silent). */
  active: boolean;
  /** The current step wants more than ground idle power (a run-up). */
  highRpmWanted: boolean;
  /** A taxi route is being followed (taxi rules on). */
  taxiing: boolean;
  /** The instructor is speaking. */
  speechIdle: boolean;
}

interface Topic { id: string; s: number; ladder: ReminderLadder; lastAt: number }

export class GroundCoach {
  private readonly topics = new Map<string, Topic>();
  private t = 0;
  private lastAt = -Infinity;
  private movedS = 0;
  private braked = false;

  /** A new taxi (a new task): the brake test is due again. */
  resetTaxi(): void {
    this.movedS = 0;
    this.braked = false;
    for (const id of ['fast', 'xtrack', 'brakes']) this.topics.delete(id);
  }

  update(f: Readonly<SignalFrame>, dt: number, g: GroundContext): GroundRemark | null {
    this.t += dt;
    const onGround = f.onGround === true;
    const running = f.engineRunning === true;
    const rpm = num(f.rpm);
    const gs = num(f.gsKt);
    const xt = num(f['taxi.xtrackM']);
    const brakes = num(f.brakes);
    if (g.taxiing && gs > 2) this.movedS += dt;
    if (gs > 1 && brakes > 0.3) this.braked = true;

    const conds: [string, boolean, number][] = [
      // Safety first: on the grass (playtest 3: three minutes 20 m off Alpha toward the runway, not a word).
      ['offPaved', onGround && running && f.onPaved === false && (g.taxiing || gs > 1), OFF_PAVED_FOR_S],
      ['rpm', onGround && running && !g.highRpmWanted && rpm > GROUND_RPM_MAX && gs < 3, RPM_FOR_S],
      ['fast', g.taxiing && onGround && gs > TAXI_GS_MAX_KT, FAST_FOR_S],
      ['xtrack', g.taxiing && onGround && gs > 2 && Math.abs(xt) > TAXI_XTRACK_MAX_M, XTRACK_FOR_S],
      ['brakes', g.taxiing && onGround && !this.braked && this.movedS >= BRAKE_DUE_S, 0],
    ];
    let pick: Topic | null = null;
    for (const [id, on, forS] of conds) {
      const tp = this.topic(id);
      tp.s = on ? tp.s + dt : 0;
      if (!on && tp.s === 0 && this.t - tp.lastAt > 30) tp.ladder.reset();
      const gap = id === 'offPaved' ? OFF_PAVED_GAP_S : TOPIC_GAP_S;
      if (!pick && on && tp.s >= forS && this.t - tp.lastAt >= gap) pick = tp;
    }
    // The off-paved call does not wait for a gap in the talk.
    const urgent = pick?.id === 'offPaved';
    if (!g.active || !pick || (!urgent && (!g.speechIdle || this.t - this.lastAt < GLOBAL_GAP_S))) return null;
    const r = this.say(pick, f);
    if (!r) return null;
    pick.lastAt = this.t;
    this.lastAt = this.t;
    return r;
  }

  private topic(id: string): Topic {
    let tp = this.topics.get(id);
    if (!tp) this.topics.set(id, (tp = { id, s: 0, ladder: new ReminderLadder(), lastAt: -Infinity }));
    return tp;
  }

  private say(tp: Topic, f: Readonly<SignalFrame>): GroundRemark | null {
    const L = tp.ladder;
    const help = L.dueForHelp;
    const k = (a: Parameters<typeof keyLabelForAction>[0]): string => keyLabelForAction(a) ?? '';
    let candidates: string[];
    let point: PointTarget | null = null;
    let key: InputAction | undefined;
    let set: Partial<ControlInputs> | undefined;
    const rpm = Math.round(num(f.rpm) / 10) * 10;
    const rpmText = String(rpm).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    switch (tp.id) {
      case 'offPaved':
        point = 'toeBrakes';
        candidates = L.count % 2 === 0
          ? ["Stop! We're off the taxiway. Throttle closed, brakes on."]
          : ["Stop there: we're on the grass. Close the throttle and hold the brakes."];
        L.last = null;   // a safety call is repeated while it lasts (its two wordings alternate)
        break;
      case 'rpm':
        point = L.count === 0 ? 'throttle' : 'tach';
        key = 'throttleDown';
        if (L.helpOffered) {
          // Asked, reminded and offered help: she does it (owner: "the RPM was well above 1000 and no action taken").
          point = 'throttle';
          set = { throttle: groundThrottleFor(1000) };
          candidates = [`I'll bring the throttle back to 1,000 rpm for you: that's ${k('throttleDown')}, a little at a time.`];
          L.reset();
          break;
        }
        candidates = help
          ? ['Watch the tachometer, right of your control column, as you bring the throttle back: 1,000 rpm.']
          : [`Bring the power back to 1,000 rpm: throttle out a little, key ${k('throttleDown')}.`,
            `That's ${rpmText} rpm: ease the throttle back until the tachometer shows about 1,000.`,
            `Still ${rpmText} rpm. Throttle back to 1,000; it keeps the engine and the brakes happy.`];
        break;
      case 'fast':
        point = 'throttle';
        candidates = help
          ? ['Throttle fully closed, then gentle brakes. Brisk walking pace only: about 10 knots.']
          : ['Too fast for taxiing: close the throttle and brake gently. Walking pace.',
            `${Math.round(num(f.gsKt))} knots is too quick on the ground: throttle closed, a squeeze of brake.`];
        break;
      case 'xtrack': {
        const xt = num(f['taxi.xtrackM']);
        const side = xt > 0 ? 'right' : 'left';
        const fix = xt > 0 ? 'left' : 'right';
        point = 'rudderPedals';
        candidates = help
          ? [`Look well ahead along the yellow line, not over the nose: small ${fix} rudder.`]
          : [`You're ${Math.round(Math.abs(xt))} metres ${side} of the yellow line: a little ${fix} rudder, key ${k(fix === 'left' ? 'rudderLeft' : 'rudderRight')}.`,
            `Drifting ${side} of the line: steer back with ${fix} rudder, then straighten up.`];
        break;
      }
      case 'brakes':
        point = 'toeBrakes';
        candidates = help
          ? [`A brief squeeze of both brakes while rolling slowly: hold ${k('brakes')} for a moment.`]
          : [`Test the brakes now: a gentle squeeze, key ${k('brakes')}.`, "We still haven't tested the brakes: squeeze them gently while we roll."];
        break;
      default:
        return null;
    }
    const line = L.next(candidates);
    if (!line) return null;
    if (help && !set) L.offerHelp();
    const safety = tp.id === 'offPaved';
    const r: GroundRemark = {
      topic: tp.id, point, help: help && !set,
      cue: { text: line, priority: safety ? Priority.Instruction : Priority.Coach, ttlS: safety ? 3 : 5, key: `ground.${tp.id}`, ...(safety ? { interrupt: true } : {}) },
    };
    if (key) r.key = key;
    if (set) r.set = set;
    return r;
  }
}

export { REMINDERS_BEFORE_HELP };
