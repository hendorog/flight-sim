// What can be said on the radio, and what the home tower says back (docs/atc.md, step 2). Pure functions of where
// the aircraft is relative to the tuned station's field: its position in that field's runway frame, the runway in
// use from the wind, and the authority's phraseology (phrases.ts). The push-to-talk menu (RadioSystem) lists
// callsFor(); the tower's answer is replyTo().

import type { Airfield } from '../world/airfields';
import { fieldCoords } from '../world/airfields';
import { nedToLocal, RUNWAY_CONNECTORS, TAXIWAYS } from '../world/airport/layout';
import type { Station } from '../instruments/dynamics/radios';
import { HOME_GROUND } from '../instruments/dynamics/radios';
import {
  altitudeFt, both, compass, frequency, join, letterWord, miles, pressure, runway, spell, wind,
  type Authority, type Callsign, type Phrase,
} from './phrases';

const DEG = Math.PI / 180;
const NM = 1852;
const FT = 0.3048;

/** Within this distance of the field the aircraft is in its circuit (or on its ground), m. */
export const CIRCUIT_RADIUS = 4500;
/** Inbound and leaving calls are offered out to this distance, m. */
const INBOUND_RADIUS = 30000;
/** A straight-in final is called from this far out, m. */
const LONG_FINAL = 10000;
/** Height above the field below which an aircraft near it counts as in the circuit, m. */
const CIRCUIT_CEILING = 2500 * FT;

export type CallId = 'radioCheck' | 'taxi' | 'ready' | 'departing' | 'inbound' | 'upwind' | 'crosswind' | 'downwind' | 'base' | 'final' | 'goAround' | 'clear' | 'leaving' | 'readback' | 'sayAgain';

export interface RadioSituation {
  authority: Authority;
  callsign: Callsign;
  /** The station on the tuned frequency (radios.ts stationOn). */
  station: Station;
  /** The station has answered this aircraft already: the abbreviated callsign is used. */
  contacted: boolean;
  north: number;
  east: number;
  /** Altitude MSL, m. */
  altitude: number;
  onGround: boolean;
  groundSpeedKt: number;
  /** True heading (track on the ground), rad. */
  heading: number;
  windFromDeg: number;
  windKt: number;
  qnhHpa: number;
  /** Time since the wheels last touched down after flight, s (Infinity: not since the start). */
  landedAgoS: number;
  /** The home field's current ATIS letter ('A'..'Z'), quoted on first contact with its tower or ground. */
  atisLetter: string;
}

/** What a landing will be, as told to the tower or the traffic on downwind and final. */
export type Intent = 'fullStop' | 'touchAndGo';

export interface Call {
  id: CallId;
  /** A landing call's stated intention. */
  intent?: Intent;
  /** Short label for the menu ('Left downwind 25'). */
  label: string;
  /** The transmission, callsign and station included. */
  line: Phrase;
}

/** A runway end in use: 0 = the low-numbered designator (take-off on the field's heading), 1 = the other. */
export type RunwayEnd = 0 | 1;

/** The end with the most headwind; in a calm (under 3 kt) the home field's 07 and the low end elsewhere. */
export function runwayInUse(field: Airfield, windFromDeg: number, windKt: number): RunwayEnd {
  if (windKt < 3) return 0;
  const head0 = Math.cos(windFromDeg * DEG - field.heading);
  return head0 >= 0 ? 0 : 1;
}

/** A position in the active runway's frame: along the take-off direction from the field centre, across (+ right). */
export function activeFrame(field: Airfield, end: RunwayEnd, north: number, east: number): { along: number; across: number } {
  const c = fieldCoords(field, north, east);
  return end === 0 ? c : { along: -c.along, across: -c.across };
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** The circuit leg an airborne aircraft near the field is on, or null when it fits none. */
export function circuitLeg(field: Airfield, end: RunwayEnd, north: number, east: number, heading: number): 'upwind' | 'crosswind' | 'downwind' | 'base' | 'final' | null {
  const { along, across } = activeFrame(field, end, north, east);
  const hdg = field.heading + (end === 1 ? Math.PI : 0);
  const side = field.circuit === 'left' ? -1 : 1;
  const out = across * side; // + on the circuit side
  const dh = wrap(heading - hdg);
  const near = (target: number, tol: number): boolean => Math.abs(wrap(dh - target)) < tol * DEG;
  const threshold = -field.length / 2;
  if (along < threshold + 300 && Math.abs(across) < Math.max(500, (threshold - along) * 0.15) && near(0, 35)) return 'final';
  if (out > 300 && near(Math.PI, 50)) return 'downwind';
  if (along < threshold + 600 && out > 0 && near(-side * Math.PI / 2, 50)) return 'base';
  if (along > threshold && near(side * Math.PI / 2, 50)) return 'crosswind';
  if (along > threshold && Math.abs(across) < 700 && near(0, 35)) return 'upwind';
  return null;
}

/** The field's name as spoken on the radio ('Bramcombe', 'Fable Regional'). */
export function stationName(field: Airfield): string {
  return field.name.replace(/ (Aerodrome|Airstrip)$/, '');
}

function stationCall(s: RadioSituation): string {
  const name = stationName(s.station.field);
  switch (s.station.kind) {
    case 'tower': return `${name} Tower`;
    case 'ground': return `${name} Ground`;
    case 'atis': return `${name} Information`;
    case 'traffic': return `${name} Traffic`;
  }
}

/** The holding point for a runway end at the home field (layout.ts): the outermost connector serving it. */
function holdingPoint(end: RunwayEnd): string {
  const ids = RUNWAY_CONNECTORS.filter((c) => c.runway === (end === 0 ? '07' : '25')).map((c) => c.name);
  return end === 0 ? ids[0] : ids[ids.length - 1];
}

/** A taxiway name: 'A4' / 'Alpha four'. */
const taxiway = (name: string): Phrase => ({ text: name, speak: spell(name) });

/** Where a home-field connector meets the runway, m along it (layout u, + toward the 25 end). */
const connectorU = (name: string): number => TAXIWAYS.find((t) => t.name === name)!.a.u;

/**
 * The home field's runway exit for an aircraft rolling out at `u` (layout frame) toward `end`'s far end at this
 * speed: the first connector it can make with gentle braking, else the one at the end of the runway.
 */
export function vacateVia(end: RunwayEnd, u: number, speedMs: number): string {
  const dir = end === 0 ? 1 : -1;
  const need = (speedMs * speedMs) / (2 * 1.5) + 30;
  const ahead = RUNWAY_CONNECTORS.map((c) => ({ name: c.name, d: (connectorU(c.name) - u) * dir })).sort((x, y) => x.d - y.d);
  return (ahead.find((e) => e.d >= need) ?? ahead[ahead.length - 1]).name;
}

/** The home-field connector nearest a position (the one an aircraft just left the runway by). */
function nearestExit(north: number, east: number): string {
  const { u } = nedToLocal(north, east);
  return RUNWAY_CONNECTORS.map((c) => c.name).sort((x, y) => Math.abs(connectorU(x) - u) - Math.abs(connectorU(y) - u))[0];
}

/** The landing end from the direction of the roll. */
const rollingToward = (field: Airfield, heading: number): RunwayEnd => (Math.cos(heading - field.heading) >= 0 ? 0 : 1);

/**
 * The home tower's instruction to an aircraft slowing on the runway after a full-stop landing: which way and where
 * to turn off, and to call Ground. The apron is left of runway 07, right of 25. Null off the home runway.
 */
export function vacateInstruction(s: RadioSituation, via?: string): Phrase | null {
  const f = s.station.field;
  if (s.station.kind !== 'tower' || f.kind !== 'home' || !s.onGround) return null;
  const end = rollingToward(f, s.heading);
  const { along, across } = activeFrame(f, end, s.north, s.east);
  if (Math.abs(across) > f.width / 2 + 3 || Math.abs(along) > f.length / 2) return null;
  const side = end === 0 ? 'left' : 'right';
  const exit = taxiway(via ?? vacateVia(end, nedToLocal(s.north, s.east).u, s.groundSpeedKt * 0.514444));
  const ground = join([both('contact Ground'), frequency(HOME_GROUND, s.authority)], ' ');
  return s.authority === 'faa'
    ? join([s.callsign.short, join([both(`turn ${side} at`), exit], ' '), ground])
    : join([s.callsign.short, join([both(`vacate ${side} at`), exit], ' '), join([both('when vacated'), ground], ' ')]);
}

/** The calls that fit the moment, the likeliest first. Empty when the station takes no calls (an ATIS). */
export function callsFor(s: RadioSituation): Call[] {
  const st = s.station;
  if (st.kind === 'atis') return [];
  const f = st.field;
  const a = s.authority;
  const end = runwayInUse(f, s.windFromDeg, s.windKt);
  const rwy = f.ids[end];
  const rw = runway(rwy);
  const ctaf = st.kind === 'traffic';
  const towered = st.kind === 'tower';
  const dist = Math.hypot(s.north - f.north, s.east - f.east);
  const height = s.altitude - f.elevation;
  const side = f.circuit === 'left' ? 'left' : 'right';
  const hand = a === 'easa' ? `${side} hand` : side;
  const info = s.atisLetter && !ctaf && f.kind === 'home' ? both(`information ${s.atisLetter}`, `information ${letterWord(s.atisLetter)}`) : null;
  const out: Call[] = [];
  const add = (id: CallId, label: string, body: Phrase[], intent?: Intent): void => {
    const cs = s.contacted && !ctaf ? s.callsign.short : s.callsign.full;
    const head = both(stationCall(s));
    // FAA common-frequency calls end with the field's name again.
    const parts = [head, cs, ...body];
    if (ctaf && a === 'faa') parts.push(both(stationName(f)));
    out.push({ id, label, line: join(parts), ...(intent ? { intent } : {}) });
  };

  const { along, across } = activeFrame(f, end, s.north, s.east);
  const onRunway = Math.abs(across) <= f.width / 2 + 3 && Math.abs(along) <= f.length / 2 + 30;
  // Just landed: the runway-vacated call first.
  const landed = s.landedAgoS < 180;

  if (s.onGround && dist < CIRCUIT_RADIUS) {
    if (onRunway && s.groundSpeedKt < 15) {
      if (ctaf) add('departing', `Departing ${rwy}`, [both(`departing ${rw.text}`, `departing ${rw.speak}`)]);
      else if (towered) add('ready', `Ready ${rwy}`, a === 'faa' ? [both(`holding short ${rw.text}`, `holding short ${rw.speak}`), both('ready for departure')] : [both('ready for departure')]);
    }
    if (landed && !onRunway) {
      const clearOf = both(`clear of ${rw.text}`, `clear of ${rw.speak}`);
      if (st.kind === 'ground') {
        const exit = taxiway(nearestExit(s.north, s.east));
        const at = join([both(a === 'faa' ? `clear of ${rw.text} at` : `vacated ${rw.text} at`, a === 'faa' ? `clear of ${rw.speak} at` : `vacated ${rw.speak} at`), exit], ' ');
        add('clear', 'Request taxi to the apron', [at, both(a === 'faa' ? 'taxi to the ramp' : 'request taxi to the apron')]);
      } else add('clear', `Clear of ${rwy}`, ctaf ? [clearOf, both('taxiing to parking')] : [clearOf]);
    }
    if (!onRunway) {
      if (ctaf) add('taxi', `Taxiing to ${rwy}`, [both(`taxiing to ${rw.text}`, `taxiing to ${rw.speak}`)]);
      else if (st.kind === 'ground' || towered) {
        const body = a === 'faa' ? [both('at the ramp, ready to taxi, VFR')] : [both('at the apron, request taxi for VFR flight')];
        if (info) body.push(info);
        add('taxi', 'Request taxi', body);
      }
      if (towered) add('ready', `Ready ${rwy}`, a === 'faa' ? [both(`holding short ${rw.text}`, `holding short ${rw.speak}`), both('ready for departure')] : [both(`at holding point, ${rw.text}`, `at holding point, ${rw.speak}`), both('ready for departure')]);
    }
  } else if (!s.onGround && height < CIRCUIT_CEILING && (dist < CIRCUIT_RADIUS || (dist < LONG_FINAL && circuitLeg(f, end, s.north, s.east, s.heading) === 'final'))) {
    const leg = circuitLeg(f, end, s.north, s.east, s.heading);
    const legs: { id: CallId; label: string; body: Phrase }[] = [
      { id: 'downwind', label: `${side[0].toUpperCase()}${side.slice(1)} downwind ${rwy}`, body: a === 'faa' && towered ? both(`midfield ${side} downwind ${rw.text}`, `midfield ${side} downwind ${rw.speak}`) : both(`${hand} downwind ${rw.text}`, `${hand} downwind ${rw.speak}`) },
      { id: 'base', label: `${side[0].toUpperCase()}${side.slice(1)} base ${rwy}`, body: both(`${hand} base ${rw.text}`, `${hand} base ${rw.speak}`) },
      { id: 'final', label: `Final ${rwy}`, body: both(`final ${rw.text}`, `final ${rw.speak}`) },
      { id: 'crosswind', label: `Crosswind ${rwy}`, body: both(`${hand} crosswind ${rw.text}`, `${hand} crosswind ${rw.speak}`) },
      { id: 'upwind', label: `Upwind ${rwy}`, body: both(`upwind ${rw.text}`, `upwind ${rw.speak}`) },
    ];
    // Downwind and final carry the intention: a full stop or a touch and go.
    const intents: { intent: Intent; label: string; say: Phrase }[] = [
      { intent: 'fullStop', label: 'full stop', say: both('full stop') },
      { intent: 'touchAndGo', label: 'touch and go', say: both(a === 'faa' ? 'touch-and-go' : 'touch and go', 'touch and go') },
    ];
    // The leg it is on first, then the others in circuit order.
    legs.sort((x, y) => Number(y.id === leg) - Number(x.id === leg));
    // A straight-in final from outside the circuit is called as just that.
    for (const l of dist < CIRCUIT_RADIUS ? legs.slice(0, 4) : legs.filter((x) => x.id === 'final')) {
      if (l.id === 'downwind' || l.id === 'final') for (const i of intents) add(l.id, `${l.label}, ${i.label}`, [l.body, i.say], i.intent);
      else add(l.id, l.label, [l.body]);
    }
    add('goAround', 'Going around', [both('going around')]);
  } else if (!s.onGround && dist < INBOUND_RADIUS) {
    const brg = Math.atan2(s.east - f.east, s.north - f.north) / DEG;
    const where = join([miles(dist / NM), both(compass(brg))], ' ');
    const alt = altitudeFt(s.altitude / FT);
    const closing = Math.cos(s.heading - Math.atan2(f.east - s.east, f.north - s.north)) > 0.3;
    if (closing) {
      const join1 = a === 'faa' ? `will enter ${side} downwind` : `joining ${hand} downwind`;
      if (ctaf) add('inbound', `Inbound, ${stationName(f)}`, [where, alt, both(`inbound, ${join1} ${rw.text}`, `inbound, ${join1} ${rw.speak}`)]);
      else if (towered) {
        const body = [where, alt, a === 'faa' ? both('inbound for landing') : both('request joining instructions')];
        if (info) body.push(info);
        add('inbound', 'Inbound for landing', body);
      }
    } else if (dist < CIRCUIT_RADIUS * 3) {
      add('leaving', 'Leaving the circuit', [both(`leaving the circuit to the ${compass(brg)}`), alt]);
    }
  }
  if (!ctaf) add('radioCheck', 'Radio check', [join([both('radio check on'), frequency(st.frequency, a)], ' ')]);
  return out;
}

/** What the home tower or ground says back (null: no answer, as on a common frequency). */
export function replyTo(s: RadioSituation, call: CallId, intent?: Intent): Phrase | null {
  const st = s.station;
  if (st.kind !== 'tower' && st.kind !== 'ground') return null;
  const f = st.field;
  const a = s.authority;
  const end = runwayInUse(f, s.windFromDeg, s.windKt);
  const rw = runway(f.ids[end]);
  const cs = s.callsign.short;
  const w = wind(s.windFromDeg, s.windKt, a);
  const p = pressure(s.qnhHpa, a);
  const side = f.circuit;
  const hand = a === 'easa' ? `${side} hand` : side;
  const ground = join([both('contact Ground'), frequency(HOME_GROUND, a)], ' ');
  const say = (...parts: Phrase[]): Phrase => join([cs, ...parts]);
  const cleared = intent === 'touchAndGo' ? both(a === 'faa' ? 'cleared touch-and-go' : 'cleared touch and go', 'cleared touch and go') : both('cleared to land');
  switch (call) {
    case 'radioCheck':
      return say(both(`${stationName(f)} ${st.kind === 'tower' ? 'Tower' : 'Ground'}`), both(a === 'faa' ? 'loud and clear' : 'readability five'));
    case 'taxi': {
      if (st.kind === 'tower') return say(ground);
      const hp = taxiway(holdingPoint(end));
      return a === 'faa'
        ? say(rw, join([both('taxi via Alpha, hold short at'), hp], ' '), p)
        : say(join([both('taxi to holding point'), hp], ' '), rw, p);
    }
    case 'ready':
      if (st.kind === 'ground') return say(join([both('contact Tower'), frequency(f.frequency, a)], ' '));
      return a === 'faa' ? say(w, rw, both('cleared for takeoff')) : say(rw, both('cleared for take-off'), w);
    case 'inbound':
      return a === 'faa'
        ? say(both(`enter ${side} downwind ${rw.text}`, `enter ${side} downwind ${rw.speak}`), both('report midfield downwind'), p)
        : say(both(`join ${hand} downwind ${rw.text}`, `join ${hand} downwind ${rw.speak}`), p, both('report downwind'));
    case 'downwind':
    case 'crosswind':
    case 'upwind':
      return a === 'faa' ? say(both('number one'), rw, cleared) : say(both('number one, report final'));
    case 'base':
      return a === 'faa' ? say(rw, cleared) : say(both('report final'));
    case 'final':
      return say(rw, cleared, w);
    case 'goAround':
      return say(both(a === 'faa' ? `roger, make ${side} traffic, report downwind` : 'roger, report downwind'));
    case 'clear':
      if (st.kind === 'tower') return say(ground);
      {
        // From the connector it left by along Alpha to the apron link on that side.
        const link = taxiway(connectorU(nearestExit(s.north, s.east)) < 0 ? 'B1' : 'B2');
        return a === 'faa'
          ? say(join([both('taxi to the ramp via Alpha,', 'taxi to the ramp via Alpha'), link], ' '))
          : say(join([both('taxi to the apron via Alpha and'), link], ' '));
      }
    case 'leaving':
      return say(both('frequency change approved'));
    case 'departing':
    case 'readback':
    case 'sayAgain':
      return null;
  }
}

const capital = (p: Phrase): Phrase => ({ text: p.text[0].toUpperCase() + p.text.slice(1), speak: p.speak });

/**
 * What the pilot reads back of replyTo's answer: the clearance, the runway, the holding point, the pressure setting and
 * a new frequency, the callsign last; null where an acknowledgement will do.
 */
export function readbackFor(s: RadioSituation, call: CallId, intent?: Intent): Phrase | null {
  const st = s.station;
  if (st.kind !== 'tower' && st.kind !== 'ground') return null;
  const f = st.field;
  const a = s.authority;
  const end = runwayInUse(f, s.windFromDeg, s.windKt);
  const rw = runway(f.ids[end]);
  const cs = s.callsign.short;
  const p = pressure(s.qnhHpa, a);
  const side = f.circuit;
  const hand = a === 'easa' ? `${side} hand` : side;
  const back = (...parts: Phrase[]): Phrase => capital(join([...parts, cs]));
  const contact = (name: string, mhz: number): Phrase => join([both(name), frequency(mhz, a)], ' ');
  switch (call) {
    case 'taxi': {
      if (st.kind === 'tower') return back(contact('Ground', HOME_GROUND));
      const hp = taxiway(holdingPoint(end));
      return a === 'faa' ? back(rw, join([both('taxi via Alpha, hold short at'), hp], ' '), p) : back(join([both('taxi to holding point'), hp], ' '), rw, p);
    }
    case 'ready':
      if (st.kind === 'ground') return back(contact('Tower', f.frequency));
      return back(rw, both(a === 'faa' ? 'cleared for takeoff' : 'cleared for take-off'));
    case 'inbound':
      return a === 'faa'
        ? back(both(`enter ${side} downwind ${rw.text}`, `enter ${side} downwind ${rw.speak}`), p)
        : back(both(`join ${hand} downwind ${rw.text}`, `join ${hand} downwind ${rw.speak}`), p);
    case 'downwind':
    case 'crosswind':
    case 'upwind':
    case 'base':
    case 'final':
      if (a === 'easa' && call !== 'final') return null;
      return back(rw, intent === 'touchAndGo' ? both(a === 'faa' ? 'cleared touch-and-go' : 'cleared touch and go', 'cleared touch and go') : both('cleared to land'));
    case 'clear':
      if (st.kind === 'tower') return back(contact('Ground', HOME_GROUND));
      return back(join([both(a === 'faa' ? 'taxi to the ramp via Alpha,' : 'taxi to the apron via Alpha and', a === 'faa' ? 'taxi to the ramp via Alpha' : 'taxi to the apron via Alpha and'), taxiway(connectorU(nearestExit(s.north, s.east)) < 0 ? 'B1' : 'B2')], ' '));
    default:
      return null;
  }
}

/** The readback of vacateInstruction: where to turn off, and the frequency to call. */
export function vacateReadback(s: RadioSituation, via?: string): Phrase | null {
  const msg = vacateInstruction(s, via);
  if (!msg) return null;
  const end = rollingToward(s.station.field, s.heading);
  const side = end === 0 ? 'left' : 'right';
  const exit = taxiway(via ?? vacateVia(end, nedToLocal(s.north, s.east).u, s.groundSpeedKt * 0.514444));
  const ground = join([both('Ground'), frequency(HOME_GROUND, s.authority)], ' ');
  return capital(join([join([both(s.authority === 'faa' ? `${side} at` : `vacate ${side} at`), exit], ' '), ground, s.callsign.short]));
}

/** A clearance or instruction the tower expects read back (an acknowledgement will not do). */
export function mustReadBack(readback: Phrase): boolean {
  return /cleared|hold|taxi|vacate|join|enter|QNH|altimeter|\d{3}\.\d/i.test(readback.text);
}

/** The home field's ATIS broadcast. */
export function atisText(field: Airfield, letter: string, s: { windFromDeg: number; windKt: number; qnhHpa: number; visibilityM: number; authority: Authority }): Phrase {
  const a = s.authority;
  const end = runwayInUse(field, s.windFromDeg, s.windKt);
  const vis = s.visibilityM >= 10000 ? both('visibility 10 kilometres or more', 'visibility one zero kilometres or more') : both(`visibility ${Math.round(s.visibilityM / 100) * 100} metres`);
  const visFaa = both(`visibility ${Math.min(10, Math.round(s.visibilityM / 1609))}`);
  return join([
    both(`${stationName(field)} information ${letter}`, `${stationName(field)} information ${letterWord(letter)}`),
    both(`runway in use ${field.ids[end]}`, `runway in use ${spell(field.ids[end])}`),
    wind(s.windFromDeg, s.windKt, a),
    a === 'faa' ? visFaa : vis,
    pressure(s.qnhHpa, a),
    both(`advise on initial contact you have information ${letter}`, `advise on initial contact you have information ${letterWord(letter)}`),
  ]);
}
