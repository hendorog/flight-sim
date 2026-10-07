// The logbook timer and logbook lines (section 3.11). Block, airborne, night and instrument time are sim
// time; landings come from `landing` events and take-offs from `liftoff` events.
//
// Timer rules: block = engine running with movement (or from lesson start when the lesson starts airborne or
// running) until the engine stops on the ground or the lesson ends; airborne = no wheel on the ground for 2 s
// (the 2 s count retroactively) until the next touchdown; night = sun elevation below -6° while the block
// runs; instrument = hood or IMC while airborne.

import type { AircraftTypeDef, AuthorityId, FlightTimerState, FlightTimes, Lesson, LessonResult, LogbookEntry, SignalFrame } from '../types';
import { EXAMINER_NAME } from './defaults';

/** No wheel on the ground for this long counts as airborne (from lift-off), s. */
export const AIRBORNE_AFTER_S = 2;
/** Ground speed above which a running engine starts the block, kt. */
const MOVING_KT = 1;
/** Civil twilight: night below this sun elevation, deg. */
export const NIGHT_SUN_ELEV_DEG = -6;
/** A free flight is logged only with at least this much airborne time, s. */
export const FREE_FLIGHT_MIN_AIRBORNE_S = 60;

const zeroTimes = (): FlightTimes => ({ blockS: 0, airborneS: 0, nightS: 0, instrumentS: 0, landingsDay: 0, landingsNight: 0, takeoffs: 0 });

export class FlightTimer {
  private s: FlightTimerState;

  /** `started`: the lesson starts airborne or with the engine running (block time from lesson start). */
  constructor(started: boolean, state?: FlightTimerState) {
    this.s = state ? structuredClone(state) : { times: zeroTimes(), blockOn: started, airborne: false, offGroundS: 0, onGroundS: 0 };
  }

  /** Once per frame with the signal frame; `instrument`: the hood is on or the weather is IMC. */
  update(frame: Readonly<SignalFrame>, dt: number, instrument: boolean): void {
    if (!(dt > 0)) return;
    const s = this.s;
    const engine = frame.engineRunning === true;
    const onGround = frame.onGround === true;
    const gs = typeof frame.gsKt === 'number' ? frame.gsKt : 0;

    if (!s.blockOn && engine && (gs > MOVING_KT || !onGround)) s.blockOn = true;
    else if (s.blockOn && !engine && onGround) s.blockOn = false;

    if (onGround) {
      s.airborne = false;
      s.offGroundS = 0;
      s.onGroundS += dt;
    } else {
      s.offGroundS += dt;
      s.onGroundS = 0;
      if (s.airborne) {
        s.times.airborneS += dt;
        if (instrument) s.times.instrumentS += dt;
      } else if (s.offGroundS >= AIRBORNE_AFTER_S) {
        // The confirmation time was flown too (an instrument flag is assumed to have held through it).
        s.airborne = true;
        s.times.airborneS += s.offGroundS;
        if (instrument) s.times.instrumentS += s.offGroundS;
      }
    }

    if (s.blockOn) {
      s.times.blockS += dt;
      const sun = typeof frame.sunElevDeg === 'number' ? frame.sunElevDeg : NaN;
      const night = Number.isFinite(sun) ? sun < NIGHT_SUN_ELEV_DEG : frame.night === true;
      if (night) s.times.nightS += dt;
    }
  }

  /** A `landing` event (night = sun elevation < -6°). */
  landing(night: boolean): void {
    if (night) this.s.times.landingsNight++;
    else this.s.times.landingsDay++;
  }

  /** Take back the last landing (it ended in a crash: a logbook counts a landing only when it was one). */
  retractLanding(night: boolean): void {
    const t = this.s.times;
    if (night && t.landingsNight > 0) t.landingsNight--;
    else if (!night && t.landingsDay > 0) t.landingsDay--;
  }

  /** A `liftoff` event. */
  takeoff(): void {
    this.s.times.takeoffs++;
  }

  /** The lesson ended: stop the block (an engine left running is not timed any further). */
  stop(): void {
    this.s.blockOn = false;
  }

  get state(): FlightTimerState {
    return structuredClone(this.s);
  }
}

// ---- logbook lines ----------------------------------------------------------------------------------------

/** Fictitious registrations by authority (section 2.1); other types name theirs in `registrations`, else use `registration`. */
const REGISTRATION: Partial<Record<string, Record<AuthorityId, string>>> = { c172s: { faa: 'N172FS', easa: 'G-FSCK' } };

export function registrationFor(aircraft: AircraftTypeDef, authority: AuthorityId): string {
  return aircraft.registrations?.[authority] ?? REGISTRATION[aircraft.id]?.[authority] ?? aircraft.registration;
}

/** 'Kate Mercer' -> 'K. Mercer'; a single name stays as it is. */
export function signatureName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0][0].toUpperCase()}. ${parts.slice(1).join(' ')}`;
}

/** The instructor's signature: 'K. Mercer FI(A)' (EASA) or 'K. Mercer CFI' (FAA). */
export function instructorSignature(name: string, authority: AuthorityId): string {
  return `${signatureName(name)} ${authority === 'easa' ? 'FI(A)' : 'CFI'}`;
}

/** The examiner's signature: 'D. Hale FE(A)' (EASA) or 'D. Hale DPE' (FAA). */
export function examinerSignature(authority: AuthorityId): string {
  return `${signatureName(EXAMINER_NAME)} ${authority === 'easa' ? 'FE(A)' : 'DPE'}`;
}

function remarksFor(r: LessonResult, lesson: Lesson): string {
  const parts: string[] = [];
  if (r.flags.calmAir) parts.push('calm air');
  if (r.flags.kbdAssists) parts.push('kbd assists');
  // Saves are forced off in solo and test flights; only a dual lesson flown without them is notable.
  if (!r.flags.instructorSaves && lesson.kind === 'dual') parts.push('saves off');
  if (r.phaseRetries > 0) parts.push(`${r.phaseRetries} retr${r.phaseRetries > 1 ? 'ies' : 'y'}`);
  return parts.join('; ');
}

/** The logbook line for a lesson result (role from the lesson kind, signature from the persona). */
export function logbookEntryFor(lesson: Lesson, result: LessonResult, aircraft: AircraftTypeDef, authority: AuthorityId, instructorName: string, id: string): LogbookEntry {
  const role: LogbookEntry['role'] = lesson.kind === 'solo' ? 'solo' : lesson.kind === 'test' ? 'test' : 'dual';
  const passed = result.outcome === 'competent' || result.outcome === 'testPass';
  const awards = new Set((lesson.awards ?? []).filter((a) => (a.when === 'testPass' ? result.outcome === 'testPass' : passed)).map((a) => a.id));
  const stamp: LogbookEntry['stamp'] = awards.has('ppl') ? 'SKILL TEST PASS' : awards.has('firstSolo') ? 'FIRST SOLO' : awards.has('night') ? 'NIGHT' : undefined;
  const entry: LogbookEntry = {
    id,
    date: result.startedAt.slice(0, 10),
    aircraftType: aircraft.icaoType,
    registration: registrationFor(aircraft, authority),
    from: 'KFBL', to: 'KFBL',
    role,
    times: { ...result.flight },
    lessonId: lesson.id, lessonVersion: lesson.version,
    exercise: `${lesson.syllabusRef[authority]} ${lesson.title}`,
    outcome: result.outcome,
    stars: result.stars > 0 ? result.stars : null,
    remarks: remarksFor(result, lesson),
    signedBy: role === 'solo' ? null : role === 'test' ? examinerSignature(authority) : instructorSignature(instructorName, authority),
  };
  if (stamp) entry.stamp = stamp;
  if (result.traceId) entry.traceId = result.traceId;
  return entry;
}

/**
 * The logbook line of a free flight, or null when it should not be logged (< 60 s airborne). Role: PIC after
 * the PPL, solo before; remark "free flight".
 */
export function freeFlightEntryFor(times: FlightTimes, aircraft: AircraftTypeDef, authority: AuthorityId, hasPpl: boolean, id: string, date: Date): LogbookEntry | null {
  if (times.airborneS < FREE_FLIGHT_MIN_AIRBORNE_S) return null;
  return {
    id, date: date.toISOString().slice(0, 10),
    aircraftType: aircraft.icaoType, registration: registrationFor(aircraft, authority),
    from: 'KFBL', to: 'KFBL', role: hasPpl ? 'pic' : 'solo', times: { ...times },
    lessonId: null, lessonVersion: null, exercise: 'Free flight', outcome: 'freeFlight', stars: null,
    remarks: 'free flight', signedBy: null,
  };
}
