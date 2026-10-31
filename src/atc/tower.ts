// The home tower's controller (docs/atc.md, step 4): the landing sequence and the runway. Every aircraft in the
// home circuit (the player and the AI traffic) is numbered by the distance it still has to fly to touchdown; the
// tower answers circuit calls with that number and the traffic to follow, clears a landing only for number one
// with the runway free (otherwise "continue", and the clearance follows when it is free), holds a departure while
// an arrival is close in, sends an arrival round when the runway is still occupied at 400 ft, and tells an AI
// aircraft on downwind to follow the one ahead (TrafficSystem extends its downwind). Pure: a view of the aircraft
// in, phrases and commands out; node-testable. The other tower and ground answers stay in calls.ts replyTo.

import { HOME_AIRFIELD, type Airfield } from '../world/airfields';
import { runwayInUse, type CallId, type Intent } from './calls';
import type { LegId } from './circuit';
import { both, join, runway, wind, type Authority, type Callsign, type Phrase } from './phrases';

const FT = 0.3048;
/** An arrival not cleared to land by this height on final is sent round, m. */
export const GO_AROUND_HEIGHT = 400 * FT;
/** A departure waits while an arrival is closer than this to touchdown, m (lined up already: the smaller gap). */
const DEPARTURE_GAP = 3000;
const LINED_UP_GAP = 1800;
/** An aircraft on downwind turns base once the one ahead is on final at least this much nearer the runway, m. */
export const FOLLOW_SPACING = 2500;

/** An aircraft as the tower sees it. */
export interface TowerAircraft {
  /** 'player', or the AI aircraft's registration. */
  id: string;
  callsign: Callsign;
  /** The maker's word the tower calls it by ('Cessna'). */
  type: string;
  /** Height above the field, m. */
  height: number;
  onGround: boolean;
  /** On the runway (on the ground within its edges and ends). */
  onRunway: boolean;
  /** The circuit leg, airborne in the circuit; null otherwise. */
  leg: LegId | null;
  /** Distance still to fly to touchdown, m (Infinity: not in the landing sequence). */
  remaining: number;
  /** Along the active runway's take-off direction from the field centre, m (final and downwind run toward -). */
  along: number;
}

export interface TowerView {
  authority: Authority;
  windFromDeg: number;
  windKt: number;
  aircraft: readonly TowerAircraft[];
}

/** What an answer tells the aircraft to do (the AI traffic acts on it). */
export type TowerKind = 'number' | 'land' | 'continue' | 'takeoff' | 'lineUp' | 'hold' | 'goAround';

/** A transmission from the tower to one aircraft, with what it must read back. */
export interface TowerMessage {
  to: string;
  line: Phrase;
  readback?: Phrase;
  kind: TowerKind;
}

export interface TowerReply {
  line: Phrase;
  readback?: Phrase;
  kind: TowerKind;
}

/** What the tower has told an aircraft, by id. */
interface Track {
  intent: Intent;
  /** Cleared to land (or touch and go) on this approach. */
  cleared: boolean;
  /** Told to continue (a landing) or to hold (a departure): the clearance follows when the runway allows. */
  waiting: 'land' | 'depart' | null;
  /** Sent round on this approach. */
  sentRound: boolean;
  /** Departures: the order the ready calls came in, told to line up and wait, cleared and still on the runway. */
  readyAt: number;
  linedUp: boolean;
  departing: boolean;
}

const NUMBERS = ['one', 'two', 'three', 'four', 'five', 'six'];
const cap = (p: Phrase): Phrase => ({ text: p.text[0].toUpperCase() + p.text.slice(1), speak: p.speak });

export class HomeTower {
  private readonly tracks = new Map<string, Track>();
  private readyCount = 0;

  constructor(readonly field: Airfield = HOME_AIRFIELD) {}

  /** A new flight: nobody has been told anything. */
  reset(): void {
    this.tracks.clear();
  }

  /** An aircraft is gone (the home traffic taken away). */
  forget(id: string): void {
    this.tracks.delete(id);
  }

  /** Whether the tower has spoken with this aircraft (the player is followed only once it has called). */
  knows(id: string): boolean {
    return this.tracks.has(id);
  }

  /** Cleared to land (or touch and go) on this approach. */
  cleared(id: string): boolean {
    return this.tracks.get(id)?.cleared ?? false;
  }

  /** The arrivals in landing order, number one first. */
  sequence(v: TowerView): TowerAircraft[] {
    return v.aircraft.filter((a) => !a.onGround && Number.isFinite(a.remaining)).sort((x, y) => x.remaining - y.remaining);
  }

  /** The aircraft ahead of this one in the sequence, and its number (1 = none ahead). */
  private place(v: TowerView, a: TowerAircraft): { number: number; ahead: TowerAircraft | null } {
    const seq = this.sequence(v);
    const i = seq.findIndex((x) => x.id === a.id);
    const n = i < 0 ? seq.length : i;
    return { number: n + 1, ahead: n > 0 ? seq[n - 1] : null };
  }

  private occupied(v: TowerView, except: string): boolean {
    return v.aircraft.some((x) => x.id !== except && x.onRunway);
  }

  /** Number one with the runway free. */
  canLand(v: TowerView, a: TowerAircraft): boolean {
    return this.place(v, a).ahead === null && !this.occupied(v, a.id);
  }

  /** No arrival close in (closer still once lined up). */
  private arrivalsClear(v: TowerView, a: TowerAircraft): boolean {
    const gap = a.onRunway ? LINED_UP_GAP : DEPARTURE_GAP;
    return !this.sequence(v).some((x) => x.id !== a.id && x.remaining < gap);
  }

  /** First of the departures waiting on the ground (by their ready calls). */
  private firstToGo(v: TowerView, a: TowerAircraft): boolean {
    const mine = this.tracks.get(a.id)?.readyAt ?? Infinity;
    return !v.aircraft.some((x) => {
      const t = this.tracks.get(x.id);
      return x.id !== a.id && x.onGround && t?.waiting === 'depart' && t.readyAt < mine;
    });
  }

  /** Nothing else on the runway, no arrival close in, and first in the queue. */
  canDepart(v: TowerView, a: TowerAircraft): boolean {
    return !this.occupied(v, a.id) && this.arrivalsClear(v, a) && this.firstToGo(v, a);
  }

  /** Line up and wait: first in the queue, the runway held only by a departure on its take-off roll, no arrival close in. */
  private canLineUp(v: TowerView, a: TowerAircraft): boolean {
    const others = v.aircraft.filter((x) => x.id !== a.id && x.onRunway);
    return others.length > 0 && others.every((x) => this.tracks.get(x.id)?.departing) && this.arrivalsClear(v, a) && this.firstToGo(v, a);
  }

  private track(id: string, intent?: Intent): Track {
    let t = this.tracks.get(id);
    if (!t) this.tracks.set(id, (t = { intent: intent ?? 'fullStop', cleared: false, waiting: null, sentRound: false, readyAt: Infinity, linedUp: false, departing: false }));
    if (intent) t.intent = intent;
    return t;
  }

  // -- Phrases ----------------------------------------------------------------------------------------------------

  private rw(v: TowerView): Phrase {
    return runway(this.field.ids[runwayInUse(this.field, v.windFromDeg, v.windKt)]);
  }

  private clearedWord(v: TowerView, intent: Intent): Phrase {
    const faa = v.authority === 'faa';
    return intent === 'touchAndGo' ? both(faa ? 'cleared touch-and-go' : 'cleared touch and go', 'cleared touch and go') : both('cleared to land');
  }

  /** The landing clearance and its readback. */
  private landing(v: TowerView, a: TowerAircraft, t: Track): TowerReply {
    t.cleared = true;
    t.waiting = null;
    const rw = this.rw(v);
    const cl = this.clearedWord(v, t.intent);
    return { line: join([a.callsign.short, rw, cl, wind(v.windFromDeg, v.windKt, v.authority)]), readback: cap(join([rw, cl, a.callsign.short])), kind: 'land' };
  }

  private lineUp(v: TowerView, a: TowerAircraft, t: Track): TowerReply {
    t.linedUp = true;
    const rw = this.rw(v);
    const luaw = both('line up and wait');
    return { line: join([a.callsign.short, rw, luaw]), readback: cap(join([rw, luaw, a.callsign.short])), kind: 'lineUp' };
  }

  /** The answer to a departure: cleared, line up and wait, or hold. */
  private departure(v: TowerView, a: TowerAircraft, t: Track): TowerReply {
    if (this.canDepart(v, a)) return this.takeOff(v, a, t);
    t.waiting = 'depart';
    if (!a.onRunway && !t.linedUp && this.canLineUp(v, a)) return this.lineUp(v, a, t);
    const cs = a.callsign.short;
    const why = both(this.sequence(v).some((x) => x.remaining < DEPARTURE_GAP) ? 'traffic on final' : this.occupied(v, a.id) ? 'runway occupied' : 'traffic departing');
    if (a.onRunway) return { line: join([cs, both('hold position'), why]), readback: cap(join([both('holding position'), cs])), kind: 'hold' };
    const rw = this.rw(v);
    return v.authority === 'faa'
      ? { line: join([cs, join([both('hold short'), rw], ' '), why]), readback: cap(join([join([both('holding short'), rw], ' '), cs])), kind: 'hold' }
      : { line: join([cs, both('hold position'), why]), readback: cap(join([both('holding position'), cs])), kind: 'hold' };
  }

  private takeOff(v: TowerView, a: TowerAircraft, t: Track): TowerReply {
    t.waiting = null;
    t.departing = true;
    t.linedUp = false;
    const rw = this.rw(v);
    const w = wind(v.windFromDeg, v.windKt, v.authority);
    const faa = v.authority === 'faa';
    const cl = both(faa ? 'cleared for takeoff' : 'cleared for take-off');
    return {
      line: faa ? join([a.callsign.short, w, rw, cl]) : join([a.callsign.short, rw, cl, w]),
      readback: cap(join([rw, cl, a.callsign.short])),
      kind: 'takeoff',
    };
  }

  /** 'follow the Cessna on base'. */
  private follow(ahead: TowerAircraft): Phrase {
    return both(`follow the ${ahead.type} on ${ahead.leg ?? 'final'}`);
  }

  /** The answer to a circuit call (downwind, base, crosswind, upwind): the number, the traffic to follow. */
  private numbered(v: TowerView, a: TowerAircraft, t: Track, call: CallId): TowerReply {
    const { number, ahead } = this.place(v, a);
    const faa = v.authority === 'faa';
    const num = both(`number ${NUMBERS[number - 1] ?? number}`);
    const cs = a.callsign.short;
    if (faa) {
      // An FAA tower clears the landing in sequence; the runway is checked again on short final.
      if (call === 'base' && t.cleared) return { line: join([cs, both('roger')]), kind: 'number' };
      const rw = this.rw(v);
      const cl = this.clearedWord(v, t.intent);
      t.cleared = true;
      if (!ahead) return { line: join([cs, num, rw, cl]), readback: cap(join([cl, rw, cs])), kind: 'land' };
      return { line: join([cs, num, this.follow(ahead), rw, cl]), readback: cap(join([both(`following the ${ahead.type}`), cl, rw, cs])), kind: 'land' };
    }
    const report = both('report final');
    if (!ahead) return { line: join([cs, num, report]), kind: 'number' };
    return { line: join([cs, num, this.follow(ahead), report]), readback: cap(join([num, both(`following the ${ahead.type}`), cs])), kind: 'number' };
  }

  /**
   * The tower's answer to a call from an aircraft in the view, or null where calls.ts replyTo answers instead (the
   * calls that are not about the circuit or the runway).
   */
  call(v: TowerView, id: string, call: CallId, intent?: Intent): TowerReply | null {
    const a = v.aircraft.find((x) => x.id === id);
    if (!a) return null;
    const t = this.track(id, intent);
    const cs = a.callsign.short;
    switch (call) {
      case 'downwind':
      case 'base':
      case 'crosswind':
      case 'upwind':
        t.sentRound = false;
        return this.numbered(v, a, t, call);
      case 'final': {
        t.sentRound = false;
        if (this.canLand(v, a)) return this.landing(v, a, t);
        t.cleared = false;
        t.waiting = 'land';
        // Behind traffic: "continue, number two"; number one with the runway still occupied: "continue, runway occupied".
        const { number } = this.place(v, a);
        const reason = number > 1 ? `number ${NUMBERS[number - 1] ?? number}` : 'runway occupied';
        return { line: join([cs, both('continue'), both(reason)]), kind: 'continue' };
      }
      case 'ready':
        t.cleared = false;
        t.linedUp = a.onRunway;
        t.readyAt = ++this.readyCount;
        return this.departure(v, a, t);
      case 'goAround':
        t.cleared = false;
        t.waiting = null;
        t.sentRound = true;
        return null;
      default:
        return null;
    }
  }

  /**
   * The tower's own transmissions now: a held landing or departure cleared once the runway allows, an arrival still
   * not clear to land at 400 ft sent round. The AI aircraft also get `follow` (keep extending downwind) and
   * `goAround`; the player is spoken to only once it has called the tower.
   */
  update(v: TowerView): { messages: TowerMessage[]; goAround: string[]; follow: string[] } {
    const messages: TowerMessage[] = [];
    const goAround: string[] = [];
    const follow: string[] = [];
    const seq = this.sequence(v);
    for (const a of v.aircraft) {
      const t = this.tracks.get(a.id);
      const ai = a.id !== 'player';
      if (t?.waiting === 'land') {
        if (a.onGround || (a.leg !== null && a.leg !== 'final')) t.waiting = null;
        else if (this.canLand(v, a)) messages.push({ to: a.id, ...this.landing(v, a, t) });
      } else if (t?.waiting === 'depart') {
        if (!a.onGround) t.waiting = null;
        else if (this.canDepart(v, a)) messages.push({ to: a.id, ...this.takeOff(v, a, t) });
        else if (!a.onRunway && !t.linedUp && this.canLineUp(v, a)) messages.push({ to: a.id, ...this.lineUp(v, a, t) });
      }
      if (t?.departing && !a.onGround) t.departing = false;
      if (t && (a.onGround || (a.leg !== 'final' && a.leg !== null))) {
        // Landed, or round again: the next approach starts afresh.
        if (a.onGround) t.cleared = false;
        if (a.leg !== 'final') t.sentRound = false;
      }
      // Short final: still not clear to land, or the runway occupied after all.
      if (a.leg === 'final' && !a.onGround && a.height < GO_AROUND_HEIGHT && (ai || t) && !t?.sentRound) {
        const blocked = this.occupied(v, a.id) || (!t?.cleared && !this.canLand(v, a));
        if (blocked) {
          const tr = this.track(a.id);
          tr.sentRound = true;
          tr.cleared = false;
          tr.waiting = null;
          messages.push({ to: a.id, line: join([a.callsign.short, both('go around'), both(this.occupied(v, a.id) ? 'runway occupied' : 'traffic ahead')]), kind: 'goAround' });
          if (ai) goAround.push(a.id);
        }
      }
      // An AI aircraft on downwind turns base only once the one ahead is established on final, abeam and beyond.
      if (ai && a.leg === 'downwind') {
        const i = seq.findIndex((x) => x.id === a.id);
        const ahead = i > 0 ? seq[i - 1] : null;
        if (ahead && !(ahead.leg === 'final' && ahead.along - a.along > FOLLOW_SPACING)) follow.push(a.id);
      }
    }
    return { messages, goAround, follow };
  }
}
