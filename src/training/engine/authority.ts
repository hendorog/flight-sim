// Control authority (section 1.5): instructor <-> student with the three-way handover, repeats and prompts,
// auto-acknowledge, input-without-ack and fighting-the-controls detection, handback, hardware throttle match.
//
// The FSM is pure bookkeeping: it never touches the copilot or the speech scheduler. It emits `authority`
// events on the training bus (the record every other module reads) and queues outputs - lines to say, student
// captions, faults and authority changes - that the runner drains once per frame and turns into speech,
// copilot commands and fault records. That keeps every rule of section 1.5 testable with a fake clock.

import type { TrainingBus } from './bus';

export type HandoverState = 'none' | 'offered' | 'matchThrottle' | 'confirming';

export interface AuthorityUpdate {
  dt: number;
  /** Deliberate student flight-control input this frame. */
  studentInput: boolean;
  /** Hardware throttle position, or null when none is in use. */
  hardwareThrottle: number | null;
  copilotThrottle: number;
  autoAck: boolean;
  simT: number;
  /** A demonstration is being flown ("light hands" and the fightingControls fault apply only then). */
  demo?: boolean;
}

/** What the instructor says because of an authority rule (the runner maps these to lines). */
export type AuthorityLine =
  | 'offer'          // "You have control."
  | 'offerRepeat'    // the offer repeated once after 6 s
  | 'offerPrompt'    // "Press Enter when you're ready to take it." after 15 s
  | 'confirm'        // "You have control." after the student's "I have control"
  | 'iHaveControl'   // a planned take
  | 'ackFirst'       // "Say 'I have control' first: press Enter."
  | 'lightHands'     // "Light hands, just follow me through."
  | 'takeBreath'     // after a handback
  | 'matchThrottle'; // a hardware throttle must match before the handover completes

export type AuthorityOutput =
  | { kind: 'say'; line: AuthorityLine }
  /** A `YOU:` caption (never voiced). */
  | { kind: 'student'; text: string }
  | { kind: 'fault'; id: 'handoverProtocol' | 'fightingControls'; severity: 'minor' }
  | { kind: 'changed'; to: 'student' | 'instructor'; reason: 'plan' | 'intervention' | 'handback' };

/** Section 3.3 durations, s. */
export const OFFER_REPEAT_S = 6;
export const OFFER_PROMPT_S = 15;
export const INTERFERENCE_S = 1;
/** A hardware throttle further than this from the copilot's blocks the handover ("Match the throttle"). */
export const THROTTLE_MATCH = 0.05;

export class AuthorityFsm {
  private _who: 'student' | 'instructor';
  private _handover: HandoverState = 'none';
  /** What Enter means when no offer is open. */
  private awaiting: 'none' | 'afterTake' | 'afterHandback' = 'none';
  private offerS = 0;
  private repeated = false;
  private prompted = false;
  private inputS = 0;
  private protocolFaulted = false;
  private fightS = 0;
  private fightFaulted = false;
  private wasDemo = false;
  private mismatch = false;
  private simT = 0;
  private outbox: AuthorityOutput[] = [];

  constructor(private readonly bus: TrainingBus, initial: 'student' | 'instructor') {
    this._who = initial;
  }

  get who(): 'student' | 'instructor' {
    return this._who;
  }

  get handover(): HandoverState {
    return this._handover;
  }

  /** Hardware throttle mismatch at the last update (the strip's "Match the throttle" bar). */
  get throttleMismatch(): boolean {
    return this.mismatch;
  }

  /**
   * Start over with `who` in control and no handover open (lesson restart, checkpoint restore, resume). No
   * event is emitted: the authority is restored, not changed.
   */
  reset(who: 'student' | 'instructor'): void {
    this._who = who;
    this._handover = 'none';
    this.awaiting = 'none';
    this.offerS = this.inputS = this.fightS = 0;
    this.repeated = this.prompted = this.protocolFaulted = this.fightFaulted = this.wasDemo = false;
    this.outbox = [];
  }

  /** Outputs queued since the last drain, oldest first. */
  drain(): AuthorityOutput[] {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  /** Offer control to the student ("You have control"); completes on ack. No-op while one is open. */
  offer(): void {
    if (this._who === 'student' || this._handover !== 'none') return;
    this._handover = 'offered';
    this.awaiting = 'none';
    this.offerS = 0;
    this.repeated = false;
    this.prompted = false;
    this.inputS = 0;
    this.protocolFaulted = false;
    this.say('offer');
  }

  /**
   * The instructor takes control on the same physics step ('plan' or 'intervention'). `silent`: the caller
   * speaks its own line (a demo intro, the Safety "I have control!").
   */
  take(reason: 'plan' | 'intervention', silent = false): void {
    this._handover = 'none';
    if (this._who === 'instructor') return;
    this.change('instructor', reason);
    if (!silent) this.say('iHaveControl');
    // Enter afterwards is the student's "You have control": good protocol, captioned, optional.
    this.awaiting = 'afterTake';
    this.fightS = 0;
  }

  /** Enter. Returns true when the key meant something to the authority FSM. */
  ack(): boolean {
    switch (this._handover) {
      case 'offered':
        if (this.mismatch) {
          this._handover = 'matchThrottle';
          this.say('matchThrottle');
        } else {
          this.confirm();
        }
        return true;
      case 'matchThrottle':
      case 'confirming':
        return true;
      default:
        break;
    }
    if (this.awaiting === 'afterTake') {
      this.awaiting = 'none';
      this.student('You have control.');
      return true;
    }
    if (this.awaiting === 'afterHandback') {
      this.awaiting = 'none';
      this.offer();
      return true;
    }
    return false;
  }

  /** Shift+Enter: the student gives control back. Returns false when the student did not have it. */
  handback(): boolean {
    if (this._who !== 'student') return false;
    this.student('You have control.');
    this.change('instructor', 'handback');
    this.say('takeBreath');
    this.awaiting = 'afterHandback';
    return true;
  }

  update(u: AuthorityUpdate): void {
    this.simT = u.simT;
    this.mismatch = u.hardwareThrottle !== null && Math.abs(u.hardwareThrottle - u.copilotThrottle) > THROTTLE_MATCH;

    switch (this._handover) {
      case 'offered':
        this.offerS += u.dt;
        if (!this.repeated && this.offerS >= OFFER_REPEAT_S) {
          this.repeated = true;
          this.say('offerRepeat');
        }
        if (!this.prompted && this.offerS >= OFFER_PROMPT_S) {
          this.prompted = true;
          this.say('offerPrompt');
        }
        if (u.studentInput) {
          if (u.autoAck) {
            this.ack();
          } else {
            this.inputS += u.dt;
            if (this.inputS > INTERFERENCE_S && !this.protocolFaulted) {
              this.protocolFaulted = true;
              this.say('ackFirst');
              this.outbox.push({ kind: 'fault', id: 'handoverProtocol', severity: 'minor' });
            }
          }
        } else {
          this.inputS = 0;
        }
        break;
      case 'matchThrottle':
        if (!this.mismatch) this.confirm();
        break;
      case 'confirming':
        // The copilot releases on the step after the student's "I have control".
        this._handover = 'none';
        this.change('student', 'plan');
        break;
      default:
        break;
    }

    const demo = u.demo === true;
    if (demo && !this.wasDemo) this.fightFaulted = false;   // once per demo
    this.wasDemo = demo;
    if (this._who === 'instructor' && this._handover === 'none' && demo && u.studentInput) {
      this.fightS += u.dt;
      if (this.fightS >= INTERFERENCE_S && !this.fightFaulted) {
        this.fightFaulted = true;
        this.say('lightHands');
        this.outbox.push({ kind: 'fault', id: 'fightingControls', severity: 'minor' });
      }
    } else {
      this.fightS = 0;
    }
  }

  /** The student's "I have control", then the instructor's "You have control"; release on the next update. */
  private confirm(): void {
    this.student('I have control.');
    this.say('confirm');
    this._handover = 'confirming';
  }

  private change(to: 'student' | 'instructor', reason: 'plan' | 'intervention' | 'handback'): void {
    this._who = to;
    this.bus.emit('authority', { to, reason }, this.simT);
    this.outbox.push({ kind: 'changed', to, reason });
  }

  private say(line: AuthorityLine): void {
    this.outbox.push({ kind: 'say', line });
  }

  private student(text: string): void {
    this.outbox.push({ kind: 'student', text });
  }
}
