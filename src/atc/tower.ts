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
export const FOLLOW_SPACING = 900;

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

/** A transmission from the tower to one aircraft, with what it must read back. */
export interface TowerMessage {
  to: string;
  line: Phrase;
  readback?: Phrase;
}

export interface TowerReply {
  line: Phrase;
  readback?: Phrase;
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
}

const cap = (p: Phrase): Phrase => ({ text: p.text[0].toUpperCase() + p.text.slice(1), speak: p.speak });

export class HomeTower {
  private readonly tracks = new Map<string, Track>();

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

  /** Nothing else on the runway and no arrival close in. */
  canDepart(v: TowerView, a: TowerAircraft): boolean {
    const gap = a.onRunway ? LINED_UP_GAP : DEPARTURE_GAP;
    return !this.occupied(v, a.id) && !this.sequence(v).some((x) => x.id !== a.id && x.remaining < gap);
  }

  private track(id: string, intent?: Intent): Track {
    let t = this.tracks.get(id);
    if (!t) this.tracks.set(id, (t = { intent: intent ?? 'fullStop', cleared: false, waiting: null, sentRound: false }));
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
    return { line: join([a.callsign.short, rw, cl, wind(v.windFromDeg, v.windKt, v.authority)]), readback: cap(join([rw, cl, a.callsign.short])) };
  }

  private takeOff(v: TowerView, a: TowerAircraft, t: Track): TowerReply {
    t.waiting = null;
    const rw = this.rw(v);
    const w = wind(v.windFromDeg, v.windKt, v.authority);
    const faa = v.authority === 'faa';
    const cl = both(faa ? 'cleared for takeoff' : 'cleared for take-off');
    return {
      line: faa ? join([a.callsign.short, w, rw, cl]) : join([a.callsign.short, rw, cl, w]),
      readback: cap(join([rw, cl, a.callsign.short])),
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
    const num = both(`number ${['one', 'two', 'three', 'four'][number - 1] ?? number}`);
    const cs = a.callsign.short;
    if (faa) {
      // An FAA tower clears the landing in sequence; the runway is checked again on short final.
      if (call === 'base' && t.cleared) return { line: join([cs, both('roger')]) };
      const rw = this.rw(v);
      const cl = this.clearedWord(v, t.intent);
      t.cleared = true;
      if (!ahead) return { line: join([cs, num, rw, cl]), readback: cap(join([cl, rw, cs])) };
      return { line: join([cs, num, this.follow(ahead), rw, cl]), readback: cap(join([both(`following the ${ahead.type}`), cl, rw, cs])) };
    }
    const report = both('report final');
    if (!ahead) return { line: join([cs, num, report]) };
    return { line: join([cs, num, this.follow(ahead), report]), readback: cap(join([num, both(`following the ${ahead.type}`), cs])) };
  }

  /**
   * The tower's answer to a call from an aircraft in the view, or null where calls.ts replyTo answers instead (the
   * calls that are not about the circuit or the runway).
   */
  call(v: TowerView, id: string, call: CallId, intent?: Intent): TowerReply | null {
    const a = v.aircraft.find((x) => x.id === id);
    if (!a) return null;
    const t = this.track(id, intent);
    const faa = v.authority === 'faa';
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
        const reason = this.occupied(v, id) ? 'runway occupied' : faa ? 'traffic landing ahead' : 'one ahead';
        return { line: join([cs, both(faa ? 'continue' : 'continue approach'), both(reason)]) };
      }
      case 'ready': {
        t.cleared = false;
        if (this.canDepart(v, a)) return this.takeOff(v, a, t);
        t.waiting = 'depart';
        const rw = this.rw(v);
        if (a.onRunway) return { line: join([cs, both('hold position'), both('traffic on final')]), readback: cap(join([both('holding position'), cs])) };
        return faa
          ? { line: join([cs, join([both('hold short'), rw], ' '), both('traffic on final')]), readback: cap(join([join([both('holding short'), rw], ' '), cs])) }
          : { line: join([cs, both('hold position'), both('traffic on final')]), readback: cap(join([both('holding position'), cs])) };
      }
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
        if (a.onGround || a.leg !== 'final') t.waiting = null;
        else if (this.canLand(v, a)) messages.push({ to: a.id, ...this.landing(v, a, t) });
      } else if (t?.waiting === 'depart') {
        if (!a.onGround) t.waiting = null;
        else if (this.canDepart(v, a)) messages.push({ to: a.id, ...this.takeOff(v, a, t) });
      }
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
          messages.push({ to: a.id, line: join([a.callsign.short, both('go around'), both(this.occupied(v, a.id) ? 'runway occupied' : 'traffic ahead')]) });
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
