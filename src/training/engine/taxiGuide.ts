// Taxi guidance (decision 3 of the owner playtest fixes): what a flight instructor says while the student taxis
// a route (geo/taxiRoute.ts), from the taxi.* signals. Calls are tied to positions along the route, each made
// once, and each built from the geometry ahead, so no two are the same words:
//   - the route brief when it starts ("Our route: right onto the apron line, left onto B1, ...");
//   - out of the stand ("Straight ahead out of the stand to the yellow line, then turn right along it");
//   - a junction coming up, 30-60 m before it ("B1 is the next left, in about 40 metres"), and at it, 4-18 m
//     before its middle ("Turn left now onto B1"); each once, never late;
//   - after a turn onto a long leg ("Now follow Alpha ahead, about 800 metres. A1 will be on the left");
//   - half way down a long leg ("A1 is about 300 metres ahead, on the left");
//   - the hold ("Holding point A1 ahead: stop before the double yellow lines"; "Start slowing now").
// A student who leaves the route (a wrong turn) is stopped and given a new route from where they are.
// The HUD model (TaxiGuideModel) is the same information for the eye.

import type { InlineCue, SignalFrame, TaxiAction, TaxiGuideModel, TaxiRoute, TaxiWaypoint } from '../types';
import { Priority } from '../types';
import { spokenTaxiway } from '../geo/taxiRoute';

/**
 * The advance call for a junction ("B1 is the next left, in about 40 metres") is made 30-60 m before it (round 7,
 * item 8, checked against position with a student on the line): from PREP_MAX_M, or from just after the turn
 * before it when that leg is shorter, while the instructor is not speaking; from PREP_FORCE_M it is made even if
 * she is (it cuts a coaching remark), and below PREP_MIN_M it is not made at all. Along-route distances: a
 * student 10-15 m off the line gets the same calls at the same places.
 */
const PREP_MIN_M = 30;
const PREP_MAX_M = 55;
const PREP_FORCE_M = 38;
/** "Turn now": from this far before the middle of the turn when quiet, from TURN_FORCE_M regardless; never late. */
const TURN_CALL_M = 18;
const TURN_FORCE_M = 12;
const TURN_LATE_M = 4;
/** A leg this long gets a "now follow ..." call after the turn onto it, m. */
const FOLLOW_LEG_M = 120;
/** And this long, a reminder this far before its end, m. */
const MID_LEG_M = 450;
const MID_CALL_M = 300;
/** Hold-short calls, m along the route to the hold point. */
const HOLD_FAR_M = 60;
const HOLD_NEAR_M = 18;
/** Off the route by this much for this long: stop, new route, m / s. */
const OFF_ROUTE_M = 22;
const OFF_ROUTE_S = 3;

const num = (x: unknown): number => (typeof x === 'number' ? x : NaN);
/** A spoken distance: to 10 m close in, to 50 m beyond 200 m (nobody says "about 750 metres" to the metre). */
const round10 = (m: number): number => (m >= 200 ? Math.round(m / 50) * 50 : Math.max(10, Math.round(m / 10) * 10));
const capFirst = (x: string): string => x.charAt(0).toUpperCase() + x.slice(1);
const turnWord = (a: TaxiAction): string => (a === 'left' ? 'left' : a === 'right' ? 'right' : 'straight on');

/** The taxiway as the HUD writes it. */
export function displayTaxiway(name: string): string {
  if (name === 'A') return 'Alpha';
  if (name === 'apron') return 'Apron line';
  if (name === 'stand') return 'Stand';
  return name;
}

export interface TaxiCall { id: string; cue: InlineCue }

export class TaxiGuide {
  private readonly fired = new Set<string>();
  private offS = 0;
  /** The student left the route: the runner rebuilds it from here. */
  needsReroute = false;

  constructor(public route: TaxiRoute, private readonly calls: boolean, brief = true) {
    // Briefed already (a say step before the taxi): straight to the calls.
    if (!brief) this.fired.add('brief');
  }

  /** A new route (after a wrong turn): briefed again, its junction calls afresh. */
  reroute(r: TaxiRoute): void {
    this.route = r;
    this.needsReroute = false;
    this.offS = 0;
    // The new route is briefed again; the stand is behind us.
    this.fired.clear();
    this.fired.add('stand');
  }

  /**
   * The call to make as the taxi begins, before the student is told to go ahead: the way out of the stand when
   * the route starts on one (its first turn is too close for an advance call once moving). Null: none.
   */
  opening(): TaxiCall | null {
    const w0 = this.route.waypoints[0];
    if (!this.calls || this.fired.has('stand') || !w0 || w0.name !== 'apron' || !this.fired.has('brief')) return null;
    this.fired.add('stand');
    this.fired.add('prep:0');
    return this.make('stand', this.standText(w0), Priority.Instruction, 15);
  }

  private standText(w0: TaxiWaypoint): string {
    return `Straight ahead out of the stand to the yellow line, then turn ${turnWord(w0.action)} along it.`;
  }

  /**
   * Once per frame with the taxi signals. Returns the call to make now (at most one), or null. `idle`: the
   * instructor is not speaking (approach and follow calls wait for a gap; turn and hold calls do not).
   */
  update(f: Readonly<SignalFrame>, dt: number, idle: boolean): TaxiCall | null {
    if (f['taxi.active'] !== true) return null;
    const r = this.route;
    const s = num(f['taxi.alongM']);
    const i = num(f['taxi.nextWp']);
    const toWp = num(f['taxi.nextWpDistM']);
    const gs = num(f.gsKt);
    const xt = num(f['taxi.xtrackM']);
    if (!Number.isFinite(s) || !Number.isFinite(i)) return null;

    // Off the route (a wrong turn): stop and re-plan.
    this.offS = Math.abs(xt) > OFF_ROUTE_M ? this.offS + dt : 0;
    if (this.offS >= OFF_ROUTE_S && !this.needsReroute) {
      this.needsReroute = true;
      return this.calls ? this.make(`offRoute:${Math.round(s)}`, "That's not our way. Stop there, and I'll give you a new route.", Priority.Instruction) : null;
    }
    if (!this.calls) return null;

    const wps = r.waypoints;
    if (!this.fired.has('brief')) {
      if (!idle) return null;
      this.fired.add('brief');
      return this.make('brief', this.briefText(), Priority.Instruction);
    }
    const w0 = wps[0];
    if (!this.fired.has('stand') && w0 && w0.name === 'apron' && s < w0.sM - TURN_CALL_M) {
      // The first turn is only a few metres from the stand: said straight after the taxi brief, before moving off.
      this.fired.add('stand');
      this.fired.add('prep:0');
      return this.make('stand', this.standText(w0), Priority.Instruction, 12);
    }
    const w = wps[i];
    if (!w) return null;
    // A junction already behind us is never called late (a real run: "Turn left now onto B1" after "Now follow
    // B1 ahead"), even if a weave brings the next waypoint back to it.
    for (let j = 0; j < i; j++) {
      this.fired.add(`turn:${j}`);
      this.fired.add(`prep:${j}`);
      this.fired.add(`mid:${j}`);
    }
    const last = i === wps.length - 1;
    if (!last) {
      const legBefore = w.sM - (i > 0 ? wps[i - 1].sM : 0);
      if (toWp <= TURN_CALL_M && !this.fired.has(`turn:${i}`)) {
        if (toWp < TURN_LATE_M) {
          // Too late to be useful: never said in the turn or after it.
          this.fired.add(`turn:${i}`);
        } else if (idle || toWp <= TURN_FORCE_M) {
          this.fired.add(`turn:${i}`);
          this.fired.add(`prep:${i}`);
          return this.make(`turn:${i}`, this.turnText(w), Priority.Instruction, 2.5, true);
        }
      }
      const prepAt = Math.min(PREP_MAX_M, legBefore - 2);
      if (toWp <= prepAt && toWp >= PREP_MIN_M && (idle || toWp <= PREP_FORCE_M) && !this.fired.has(`prep:${i}`)) {
        this.fired.add(`prep:${i}`);
        return this.make(`prep:${i}`, `${spokenTaxiway(w.name)} is the next ${turnWord(w.action)}, in about ${round10(toWp)} metres.`.replace(/^the /, 'The '),
          Priority.Instruction, 2.5, true);
      }
      const legMid = w.sM - (i > 0 ? wps[i - 1].sM : 0);
      if (legMid >= MID_LEG_M && toWp <= MID_CALL_M && toWp > PREP_MAX_M + 40 && !this.fired.has(`mid:${i}`) && idle) {
        this.fired.add(`mid:${i}`);
        return this.make(`mid:${i}`, `Keep going: ${spokenTaxiway(w.name)} is about ${round10(toWp)} metres ahead, on the ${turnWord(w.action)}.`);
      }
    }
    // After a turn: what this leg is and what comes at its end.
    if (i > 0) {
      const prev = wps[i - 1];
      const leg = w.sM - prev.sM;
      if (leg >= FOLLOW_LEG_M && s > prev.sM + 8 && toWp > 60 && !this.fired.has(`follow:${i - 1}`) && idle) {
        this.fired.add(`follow:${i - 1}`);
        // The junction at the end is named only on a long leg; on a short one its advance call comes soon enough
        // (a turn is called once).
        const end = last
          ? (r.holdShort ? ` The holding point is at the end.` : ' The stand is at the end.')
          : leg >= MID_LEG_M ? ` ${capFirst(spokenTaxiway(w.name))} will be on the ${turnWord(w.action)}.` : '';
        return this.make(`follow:${i - 1}`, `Now follow ${spokenTaxiway(prev.name)} ahead, about ${round10(leg)} metres.${end}`);
      }
    }
    if (last) {
      if (r.holdShort) {
        if (toWp <= HOLD_FAR_M && !this.fired.has('hold:far')) {
          this.fired.add('hold:far');
          return this.make('hold:far', `Holding point ${w.name} ahead: stop before the double yellow lines across the taxiway.`, Priority.Instruction, 6);
        }
        if (toWp <= HOLD_NEAR_M && gs > 4 && !this.fired.has('hold:near')) {
          this.fired.add('hold:near');
          return this.make('hold:near', 'Start slowing now: close the throttle and stop short of the lines.', Priority.Instruction, 4);
        }
      } else if (toWp <= HOLD_FAR_M && !this.fired.has('stop:far')) {
        this.fired.add('stop:far');
        return this.make('stop:far', 'Our stand is just ahead: follow the lead-in line and stop at the tee.', Priority.Instruction, 6);
      }
    }
    return null;
  }

  /** The next action as a short spoken reminder, for a nudge ("Next: left onto A1, in about 300 metres."). */
  reminder(f: Readonly<SignalFrame>): string | null {
    const i = num(f['taxi.nextWp']);
    const w = this.route.waypoints[i];
    const d = num(f['taxi.nextWpDistM']);
    if (!w || !Number.isFinite(d)) return null;
    if (w.action === 'holdShort') return `Holding point ${w.name} is about ${round10(d)} metres ahead: stop before the lines.`;
    if (w.action === 'stop') return `The stand is about ${round10(d)} metres ahead.`;
    // Close to a junction its own calls are coming: a nudge would only say it twice.
    if (d <= PREP_MAX_M + 60) return null;
    return `Next: ${turnWord(w.action)} onto ${spokenTaxiway(w.name)}, in about ${round10(d)} metres.`;
  }

  /** The HUD. */
  model(f: Readonly<SignalFrame>): TaxiGuideModel | null {
    if (f['taxi.active'] !== true) return null;
    const r = this.route;
    const i = num(f['taxi.nextWp']);
    const w: TaxiWaypoint | undefined = r.waypoints[i];
    if (!w) return null;
    const hold = num(f['taxi.holdShortDistM']);
    return {
      action: w.action, name: displayTaxiway(w.name), distM: Math.max(0, num(f['taxi.nextWpDistM'])),
      // HOLD SHORT once the last junction is behind (on the connector), so "left onto A1" is never hidden.
      holdShort: r.holdShort && w.action === 'holdShort' && Number.isFinite(hold) && hold <= 80, holdShortDistM: Number.isFinite(hold) ? Math.max(0, hold) : null,
      xtrackM: num(f['taxi.xtrackM']), gsKt: num(f.gsKt), routeDistM: num(f['taxi.routeDistM']),
      then: r.waypoints.slice(i + 1, i + 3).map((x) => ({ action: x.action, name: displayTaxiway(x.name) })), to: r.to,
    };
  }

  private briefText(): string {
    const turns = this.route.waypoints.filter((w) => w.action === 'left' || w.action === 'right' || w.action === 'straight');
    const parts = turns.map((w) => `${turnWord(w.action)} onto ${spokenTaxiway(w.name)}`);
    const end = this.route.holdShort ? 'and hold short' : 'to the stand';
    if (parts.length === 0) return this.route.holdShort ? `Holding point ${this.route.to} is straight ahead: stop before the double yellow lines.` : 'The stand is straight ahead.';
    const last = parts.pop();
    return `Our route: ${parts.length ? `${parts.join(', ')}, then ` : ''}${last} ${end}.`;
  }

  private turnText(w: TaxiWaypoint): string {
    const name = spokenTaxiway(w.name);
    if (w.action === 'straight') return `Straight on here onto ${name}.`;
    if (w.name === 'apron') return `Turn ${w.action} now, onto the yellow line.`;
    return `Turn ${w.action} now onto ${name}; follow the yellow line round.`;
  }

  /** `interrupt`: a call tied to a place cuts a coaching remark rather than waiting behind it. */
  private make(id: string, text: string, priority: Priority = Priority.Coach, ttlS = 6, interrupt = false): TaxiCall {
    return { id, cue: { text, priority, ttlS, key: `taxi.${id}`, ...(interrupt ? { interrupt: true } : {}) } };
  }
}
