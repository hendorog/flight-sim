// Checklist runner (section 3.5): challenge/response, flow and silent modes; item checks from state or Enter;
// missed items reported on the bus; grade 4 / 3 / 1.
//
// - challengeResponse: the instructor reads one challenge at a time ("Mixture?"). The item completes when its
//   check becomes true within the response window, or on Enter for items without a check (caption `YOU: Rich`).
//   An item whose check is already true when it is read needs one Enter to confirm; if the window passes
//   without that Enter it still counts, as "late". A missed item is recorded and the instructor says the
//   response ("Mixture rich, please").
// - flow: every item is open at once, in any order; complete when all checks are true or on Enter (which
//   confirms the unverifiable items and closes the flow: anything still false is missed and called out).
// - silent (solo, check, test): observed only; items without a check cannot be observed and are assumed done.
//   finish() at step exit records what was never done.
// - guided (challenge/response in a dual lesson, owner playtest: "the instructor should state whether something
//   needs to be on or off for startup and why"): the instructor reads the item with its required state
//   ("Avionics switch: OFF."), says where the control is and which key works it the first time that control
//   comes up, and why the first time the item is read in the run; the UI points at it (callout). The item is
//   done the moment its state holds, no Enter ("Checked."); one already in its state when read is verified
//   aloud ("Master switch: on. Checked.") and done once the line has been said. Unverifiable items still take
//   Enter. While the student is looking for it, reminders say what is still wrong and never repeat themselves;
//   after two the instructor offers to show ([), which sets it for them. Left too long, she sets it herself
//   (an rpm too: she sets the throttle for it) and it counts as missed. An item is read only once she has
//   finished speaking about the last one, and her lines are never dropped as stale (playtest 3: the cursor ran
//   ahead of the speech and "Beacon: ON" was never said). An Enter item gets reminders and help too.

import type { ControlInputs } from '../../core/types';
import type { ChecklistDef, ChecklistItem, ChecklistItemModel, ChecklistStep, CompiledPred, CueRef, EvalContext, Grade, InlineCue, PointTarget } from '../types';
import type { TrainingBus } from './bus';
import { controlsFor, currentStateWord, isControlId, itemKey, itemStateLabel, itemTarget, targetLabel, targetWhere, type KeyInfo } from './controls';
import { compile } from './predicates';
import { differentLine } from './reminders';

export type ChecklistItemState = 'pending' | 'active' | 'done' | 'missed';

/** Challenge/response: how long the student has to do an item once it is read, s (section 3.5). */
export const RESPONSE_WINDOW_S = 10;
/** A lookout item is satisfied by a clearing turn (|step.turnDeg| >= 90), which takes far longer than 10 s. */
export const LOOKOUT_WINDOW_S = 60;
const LOOKOUT_TURN_DEG = 90;
/** Guided: an item already in its state is shown for at least this long before the next one, s. */
export const GUIDED_DWELL_S = 1.2;
/** Guided: quiet seconds (no speech) before the first reminder, and between reminders. */
export const GUIDED_REMIND_S = 9;
/** Guided: the instructor sets the item herself (missed) after this long, s. */
export const GUIDED_WINDOW_S = 75;
/**
 * Guided: the next item is not read until the instructor has finished speaking about the last one (playtest 3:
 * the cursor moved on while an item's challenge, where and why were still queued, and the speech TTL dropped
 * them, so "Beacon: ON" was never said). Never longer than this, s.
 */
export const GUIDED_READ_WAIT_S = 12;
/** Guided lines are never dropped as stale while the student works through the list, s. */
export const GUIDED_TTL_S = 30;
/** Guided: the student's "Checked" acknowledgements, rotated so the same word never comes twice running. */
const CHECKED = ['Checked.', 'Good.', "That's it.", 'Good, checked.'];

/** What a guided checklist needs from its run: lines resolved by the runner, and memory shared by every list. */
export interface GuidedOptions {
  /** Why an item is set as it is (item.why, else the lines table); null: no reason given. */
  why(item: ChecklistItem, list: ChecklistDef): CueRef | null;
  /** Keys already explained in this run: `why:<item id>` and `where:<control>` are said once each. */
  explained: Set<string>;
}

/** The control the active item is about, for the callout. */
export interface ChecklistPointer {
  itemId: string; target: PointTarget; state: string; key: KeyInfo | null; why: CueRef | null; done: boolean;
  /** Counts the items read (guided): changes when a new item is pointed at. */
  seq: number;
}

interface ItemRun {
  def: ChecklistItem;
  state: ChecklistItemState;
  check: CompiledPred | null;
  /** Sim time since the item became active (challengeResponse). */
  activeS: number;
  /** Check already true when the challenge was read: Enter confirms it. */
  needsConfirm: boolean;
  late: boolean;
  // guided
  target: PointTarget | null;
  /** Quiet (speech idle) seconds since the last line about this item. */
  quietS: number;
  reminders: number;
  helpOffered: boolean;
  /** Already in its state when read: done once the reading has been heard. */
  preset: boolean;
}

export class ChecklistRunner {
  private readonly items_: ItemRun[];
  private cursor = 0;
  private finished = false;
  private simT = 0;
  private pendingAck = false;
  private outbox: CueRef[] = [];
  private controlsOut: Partial<ControlInputs>[] = [];
  private lastReminder: string | null = null;
  private checkedIdx = 0;
  private pointerSeq = 0;
  private frame: Readonly<Record<string, unknown>> = {};
  /** Guided: seconds the next item has waited for the instructor to finish speaking. */
  private readWaitS = 0;

  /** `guided` (challenge/response only): the talk-through described at the top of this file. */
  constructor(private readonly def: ChecklistDef, private readonly mode: ChecklistStep['mode'], private readonly bus: TrainingBus,
    private readonly guided: GuidedOptions | null = null) {
    this.items_ = def.items.map((it) => {
      const verify = it.state ?? it.check;
      return {
        def: it, state: 'pending', check: verify ? compile(verify) : null, activeS: 0, needsConfirm: false, late: false,
        target: itemTarget(it), quietS: 0, reminders: 0, helpOffered: false, preset: false,
      };
    });
    if (mode !== 'challengeResponse') for (const it of this.items_) it.state = 'active';
    if (mode !== 'challengeResponse') this.guided = null;
  }

  /** True when the instructor talks the student through it (guided challenge/response). */
  get isGuided(): boolean {
    return this.guided !== null;
  }

  /**
   * The control to point at: the item being read (challenge/response), or in a flow the first open item with
   * a control (`queued` counts the others). Null when there is none.
   */
  pointer(): (ChecklistPointer & { queued: number }) | null {
    if (this.finished) return null;
    const open = this.mode === 'challengeResponse'
      ? [this.items_[this.cursor]].filter((it): it is ItemRun => !!it && it.state === 'active')
      : this.items_.filter((it) => it.state === 'active');
    const withTarget = open.filter((it) => it.target !== null);
    const it = withTarget[0];
    if (!it || !it.target) return null;
    return {
      itemId: it.def.id, target: it.target, state: itemStateLabel(it.def), key: itemKey(it.def, it.target, this.frame),
      why: this.guided?.why(it.def, this.def) ?? null, done: it.preset, seq: this.pointerSeq, queued: withTarget.length - 1,
    };
  }

  /** Controls the instructor sets (a missed guided item, "show me"); drained by the runner each frame. */
  drainControls(): Partial<ControlInputs>[] {
    const out = this.controlsOut;
    this.controlsOut = [];
    return out;
  }

  /** "Show me" ([) on a guided item: she sets it, says what she did, and it counts as late. False: nothing to show. */
  showMe(): boolean {
    if (!this.guided || this.finished) return false;
    const it = this.items_[this.cursor];
    if (!it || it.state !== 'active' || !it.target) return false;
    const set = controlsFor(it.def.state ?? it.def.check);
    const where = targetWhere(it.target);
    if (!set) {
      this.say(`It's ${where}. ${keyPhrase(itemKey(it.def, it.target, this.frame))}`.trim());
      return true;
    }
    this.controlsOut.push(set);
    this.say(`Here: ${where}. ${targetLabel(it.target)} ${itemStateLabel(it.def).toLowerCase()}, like that.`);
    it.helpOffered = true;
    it.late = true;
    return true;
  }

  get title(): string {
    return this.def.title;
  }

  /** Once per frame; returns cues to speak (challenges, "Mixture rich, please", `YOU:` responses). */
  update(ctx: EvalContext): CueRef[] {
    this.simT = ctx.simT;
    this.frame = ctx.frame;
    if (!this.finished) {
      if (this.guided) this.updateGuided(ctx);
      else if (this.mode === 'challengeResponse') this.updateChallenge(ctx);
      else this.updateFlow(ctx);
    }
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  /** Enter: confirm the active item (or the whole flow). */
  ack(): void {
    if (!this.finished) this.pendingAck = true;
  }

  /** Say again: the active challenge read once more (challenge/response only); null when there is none. */
  repeat(): CueRef | null {
    if (this.finished || this.mode !== 'challengeResponse') return null;
    const it = this.items_[this.cursor];
    return it && it.state === 'active' ? { text: `${it.def.challenge}?` } : null;
  }

  /** Step exit: whatever is still open is missed (silent mode: never done before the step moved on). */
  finish(): void {
    if (this.finished) return;
    for (const it of this.items_) if (it.state === 'pending' || it.state === 'active') this.resolve(it, false, false);
    this.complete();
  }

  get done(): boolean {
    return this.finished;
  }

  get items(): readonly ChecklistItemModel[] {
    return this.items_.map((it) => {
      const m: ChecklistItemModel = { id: it.def.id, label: `${it.def.challenge}: ${it.def.response}`, state: it.state };
      if (this.guided && it.target) {
        if (isControlId(it.target)) m.control = it.target;
        m.required = itemStateLabel(it.def);
        m.key = itemKey(it.def, it.target, this.frame)?.label ?? null;
      }
      return m;
    });
  }

  get missed(): readonly string[] {
    return this.items_.filter((it) => it.state === 'missed').map((it) => it.def.id);
  }

  /** True when a critical item was missed (a silent-mode checklist then records a major fault). */
  get criticalMissed(): boolean {
    return this.items_.some((it) => it.state === 'missed' && it.def.critical === true);
  }

  /** 4 none missed; 3 one non-critical missed or late; 1 a critical item missed; 2 more than one slip. */
  grade(): Grade {
    if (this.criticalMissed) return 1;
    const slips = this.items_.filter((it) => it.state === 'missed' || it.late).length;
    if (slips === 0) return 4;
    return slips === 1 ? 3 : 2;
  }

  // ---- modes ------------------------------------------------------------------------------------------------

  private updateChallenge(ctx: EvalContext): void {
    const ack = this.consumeAck();
    const it = this.items_[this.cursor];
    if (!it) return this.complete();
    const ok = this.evalCheck(it, ctx);
    if (it.state === 'pending') {
      it.state = 'active';
      it.activeS = 0;
      it.needsConfirm = it.check !== null && ok;
      this.say(`${it.def.challenge}?`);
      return;   // the Enter that read this frame belongs to the previous item
    }
    it.activeS += ctx.dt;
    const windowS = it.def.lookout ? LOOKOUT_WINDOW_S : RESPONSE_WINDOW_S;
    if (it.check === null || it.needsConfirm) {
      if (ack) this.resolve(it, true, false, true);
      else if (it.activeS >= windowS) this.resolve(it, it.needsConfirm && ok, it.needsConfirm && ok);
    } else if (ok) {
      this.resolve(it, true, false);
    } else if (it.activeS >= windowS) {
      this.resolve(it, false, false);
    }
    if (it.state === 'done' || it.state === 'missed') {
      this.cursor++;
      if (this.cursor >= this.items_.length) this.complete();
    }
  }

  private updateFlow(ctx: EvalContext): void {
    const ack = this.consumeAck();
    for (const it of this.items_) {
      if (it.state !== 'active') continue;
      if (this.evalCheck(it, ctx)) this.resolve(it, true, false);
      else if (it.check === null && this.mode === 'silent') this.resolve(it, true, false);
    }
    if (ack) {
      for (const it of this.items_) if (it.state === 'active') this.resolve(it, it.check === null, false, it.check === null);
    }
    if (this.items_.every((it) => it.state === 'done' || it.state === 'missed')) this.complete();
  }

  /** Guided challenge/response (see the top of the file). */
  private updateGuided(ctx: EvalContext): void {
    const g = this.guided as GuidedOptions;
    const ack = this.consumeAck();
    const it = this.items_[this.cursor];
    if (!it) return this.complete();
    const ok = this.evalCheck(it, ctx);
    if (it.state === 'pending') {
      // One item at a time: its lines are heard before the next is read.
      if (!ctx.speechIdle && this.readWaitS < GUIDED_READ_WAIT_S) {
        this.readWaitS += ctx.dt;
        return;
      }
      this.readWaitS = 0;
      it.state = 'active';
      it.activeS = 0;
      it.quietS = 0;
      this.pointerSeq++;
      this.readGuided(it, ok, g);
      return;
    }
    it.activeS += ctx.dt;
    it.quietS = ctx.speechIdle ? it.quietS + ctx.dt : 0;
    if (it.preset) {
      // Verified aloud when read: on once the line has been heard (and shown for a moment).
      if (it.activeS >= GUIDED_DWELL_S && ctx.speechIdle) this.resolve(it, true, false);
    } else if (it.check === null) {
      if (ack) this.resolve(it, true, false, true);
      else if (it.activeS >= GUIDED_WINDOW_S) this.resolve(it, true, true);
      else if (it.quietS >= GUIDED_REMIND_S && !it.helpOffered) {
        // Nothing to verify, but never silence (playtest 3: 55 s without a word on the prime item).
        this.remindConfirm(it);
        it.quietS = 0;
      }
    } else if (ok) {
      this.resolve(it, true, it.late);
      this.say(CHECKED[this.checkedIdx++ % CHECKED.length]);
    } else if (it.activeS >= GUIDED_WINDOW_S) {
      const set = controlsFor(it.def.state ?? it.def.check);
      if (set) {
        this.controlsOut.push(set);
        this.say(`I'll set the ${lowerFirst(targetLabel(it.target ?? 'yoke'))} ${itemStateLabel(it.def).toLowerCase()} for you.`);
        this.resolveSilently(it, false);
      } else {
        this.resolve(it, false, false);
      }
    } else if (it.quietS >= GUIDED_REMIND_S && !it.helpOffered) {
      this.remindGuided(it, ctx);
      it.quietS = 0;
    }
    if (it.state === 'done' || it.state === 'missed') {
      this.cursor++;
      if (this.cursor >= this.items_.length) this.complete();
    }
  }

  /** The reading: challenge with its state, where and how (first time for that control), and why (first time). */
  private readGuided(it: ItemRun, ok: boolean, g: GuidedOptions): void {
    const d = it.def;
    const state = itemStateLabel(d);
    if (it.check === null) {
      this.say(`${d.challenge}: ${lowerFirst(d.response)}? Press Enter when it is.`);
    } else if (ok) {
      it.preset = true;
      this.say(`${d.challenge}: ${lowerFirst(d.response)}. ${CHECKED[this.checkedIdx++ % CHECKED.length]}`);
    } else {
      this.say(`${d.challenge}: ${state}.`);
      const t = it.target;
      if (t && !g.explained.has(`where:${t}`)) {
        g.explained.add(`where:${t}`);
        const key = keyPhrase(itemKey(d, t, this.frame));
        this.say(`That's ${targetWhere(t)}.${key ? ` ${key}` : ''}`);
      }
    }
    const why = g.why(d, this.def);
    // Said once per reason: a list-specific reason (the shutdown's avionics) is a different reason.
    const whyKey = `why:${whyIdentity(why, d.id)}`;
    if (why && !g.explained.has(whyKey)) {
      g.explained.add(whyKey);
      this.outbox.push(why);
    }
  }

  /** Reminder on an item with nothing to verify (Enter confirms it): the item, where to look, then help. */
  private remindConfirm(it: ItemRun): void {
    const d = it.def;
    it.reminders++;
    const t = it.target;
    if (it.reminders >= 3) {
      it.helpOffered = true;
      this.say(`${d.challenge}: ${lowerFirst(d.response)}. Press Enter once you've checked it, or the left bracket and I'll help.`);
      return;
    }
    const candidates = [
      `Still waiting on the ${lowerFirst(d.challenge)}: ${lowerFirst(d.response)}. Then press Enter.`,
      t ? `Look at ${targetWhere(t)}: ${lowerFirst(d.challenge)}, ${lowerFirst(d.response)}. Enter when done.` : `${d.challenge}, ${lowerFirst(d.response)}: press Enter when you have.`,
    ];
    const line = differentLine(candidates.slice(it.reminders - 1), this.lastReminder) ?? differentLine(candidates, this.lastReminder);
    if (!line) return;
    this.lastReminder = line;
    this.say(line);
  }

  /**
   * A reminder from the state: what is still wrong ("The avionics switch is still on: set it OFF, key I."),
   * then where to look; never the previous wording. The third is an offer to show ([).
   */
  private remindGuided(it: ItemRun, ctx: EvalContext): void {
    const d = it.def;
    const t = it.target;
    it.reminders++;
    if (it.reminders >= 3 || !t) {
      it.helpOffered = true;
      this.say(t ? `Would you like me to show you where the ${lowerFirst(targetLabel(t))} is? Press the left bracket.` : `${d.challenge}: ${lowerFirst(d.response)}, please.`);
      return;
    }
    const label = targetLabel(t);
    const now = currentStateWord(t, ctx.frame);
    const want = itemStateLabel(d).toLowerCase();
    const key = itemKey(d, t, ctx.frame);
    const k = key ? `, key ${key.label}` : '';
    const candidates = [
      now ? `The ${lowerFirst(label)} is still ${now}: it needs to be ${want}${k}.` : `The ${lowerFirst(label)} isn't ${want} yet${k}.`,
      `Look at ${targetWhere(t)}. ${label}: ${want}.`,
      `${label} to ${want}${key ? `: press ${key.label}` : ''}.`,
    ];
    const line = differentLine(candidates.slice(it.reminders - 1), this.lastReminder) ?? differentLine(candidates, this.lastReminder);
    if (!line) return;
    this.lastReminder = line;
    this.say(line);
  }

  /** Missed without the "..., please" line (she set it herself). */
  private resolveSilently(it: ItemRun, ok: boolean): void {
    it.state = ok ? 'done' : 'missed';
    this.bus.emit('checklist.item', { checklist: this.def.id, item: it.def.id, ok }, this.simT);
  }

  // ---- helpers ----------------------------------------------------------------------------------------------

  private evalCheck(it: ItemRun, ctx: EvalContext): boolean {
    if (it.def.lookout) return Math.abs(Number(ctx.frame['step.turnDeg'])) >= LOOKOUT_TURN_DEG || (it.check?.eval(ctx) ?? false);
    return it.check?.eval(ctx) ?? false;
  }

  private consumeAck(): boolean {
    const a = this.pendingAck;
    this.pendingAck = false;
    return a;
  }

  private resolve(it: ItemRun, ok: boolean, late: boolean, byEnter = false): void {
    it.state = ok ? 'done' : 'missed';
    it.late = ok && late;
    this.bus.emit('checklist.item', { checklist: this.def.id, item: it.def.id, ok }, this.simT);
    if (byEnter && ok) this.outbox.push(studentLine(it.def.response));
    if (!ok && this.mode !== 'silent') this.say(`${it.def.challenge} ${lowerFirst(it.def.response)}, please.`);
  }

  private complete(): void {
    if (this.finished) return;
    this.finished = true;
    this.bus.emit('checklist.done', { checklist: this.def.id, missed: [...this.missed] }, this.simT);
  }

  private say(text: string): void {
    if (this.mode !== 'silent') this.outbox.push(this.guided ? { text, ttlS: GUIDED_TTL_S } : { text });
  }
}

/** What makes two reasons the same reason: the cue id, or an inline line's words (the shutdown's avionics is not the start's). */
function whyIdentity(why: CueRef | null, itemId: string): string {
  if (!why) return itemId;
  if (typeof why === 'string') return why;
  if ('text' in why) return Array.isArray(why.text) ? why.text.join('|') : why.text;
  if ('id' in why) return why.id;
  return itemId;
}

/** "Key I." / "Keys F2 / F3." / '' */
function keyPhrase(k: KeyInfo | null): string {
  if (!k) return '';
  return k.label.includes('/') ? `Keys ${k.label}.` : `Key ${k.label}.`;
}

function studentLine(text: string): InlineCue {
  return { text, actor: 'student' };
}

/** "Rich" -> "rich", but keep acronyms ("ON", "BOTH") as written. */
function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
