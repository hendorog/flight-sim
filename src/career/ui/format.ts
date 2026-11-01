// Text formatting for the Career pages (docs/career.md "UI pages"): money ("$1,240", "-$300", "+$28"), the career
// clock ("Day 3 · 10:40"), durations, masses, distances, wind, and the pilot-facing names of the Career's ids
// (kinds, classes, weather, outcomes, aircraft types). Pure strings in and out, so every page and the strip say a
// figure the same way, and the tests can pin the wording without a DOM.
//
// Conventions (the school's): sentence case, a middle dot "·" between items, whole dollars, en-GB digit grouping,
// a real minus sign avoided in favour of "-" (the shell font has tabular figures for both).

import { aircraftSummary } from '../../aircraft/registry';
import { CLASS_RULES, FUEL_RULES, type AircraftClass, type CareerAircraftId, type CareerWeatherId, type FuelGrade, type JobKind, type JobPhase, type SettledOutcome, type Station } from '../types';

/** "1,240" (whole, en-GB grouping). */
export function groupNum(n: number): string {
  return Math.round(n).toLocaleString('en-GB');
}

/** Money in whole dollars: "$1,240", "-$300". */
export function usd(n: number): string {
  const r = Math.round(n);
  const s = `$${Math.abs(r).toLocaleString('en-GB')}`;
  return r < 0 ? `-${s}` : s;
}

/** Money with an explicit sign: "+$28", "-$43", "$0". */
export function signedUsd(n: number): string {
  const r = Math.round(n);
  return r > 0 ? `+${usd(r)}` : usd(r);
}

/** A signed whole number: "+2", "-4", "0". */
export function signed(n: number): string {
  const r = Math.round(n);
  return r > 0 ? `+${r}` : String(r);
}

/** Two digits. */
const pad2 = (n: number): string => String(n).padStart(2, '0');

/** "HH:MM" of a clock reading (minutes since day 0 00:00, or a minute of the day). */
export function clockHm(clockMin: number): string {
  const m = ((Math.floor(clockMin) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** The career clock: "Day 3 · 10:40". */
export function careerClock(clockMin: number): string {
  return `Day ${Math.floor(clockMin / 1440)} · ${clockHm(clockMin)}`;
}

/** A duration in minutes: "45 min", "1 h 05 min", "2 h". */
export function minutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${pad2(r)} min`;
}

/** Hours with one decimal: "0.6 h", "12.4 h". */
export function hoursDec(h: number): string {
  return `${(Math.round(h * 10) / 10).toFixed(1)} h`;
}

/** Seconds as logbook hours and minutes: "0:38", "12:05". */
export function hm(seconds: number): string {
  const m = Math.round(Math.max(0, seconds) / 60);
  return `${Math.floor(m / 60)}:${pad2(m % 60)}`;
}

/** A mass, whole kg: "1,157 kg". */
export function kg(n: number): string {
  return `${groupNum(n)} kg`;
}

/** Fuel as kg and litres of its grade: "41 kg · 57 L". */
export function fuelKgL(kgAmount: number, grade: FuelGrade): string {
  return `${groupNum(kgAmount)} kg · ${groupNum(kgAmount / FUEL_RULES.densityKgL[grade])} L`;
}

/** A distance: "12.4 NM" (one decimal below 100, whole above). */
export function nm(n: number): string {
  return n < 100 ? `${n.toFixed(1)} NM` : `${Math.round(n)} NM`;
}

/** A true bearing, three digits: "087°". */
export function bearing(deg: number): string {
  const d = ((Math.round(deg) % 360) + 360) % 360;
  return `${String(d === 0 ? 360 : d).padStart(3, '0')}°`;
}

/** Surface wind: "270° / 12 kt", "Calm" below 1 kt. */
export function wind(fromDeg: number, kt: number): string {
  return kt < 1 ? 'Calm' : `${bearing(fromDeg)} / ${Math.round(kt)} kt`;
}

/** A body-axis CG position, m with two decimals: "-0.12 m". */
export function cgM(x: number): string {
  return `${x.toFixed(2)} m`;
}

const KIND_LABELS: Readonly<Record<JobKind, string>> = {
  charter: 'Charter', freight: 'Freight', mail: 'Mail', scenic: 'Scenic', positioning: 'Positioning', medevac: 'Medevac', utility: 'Utility',
};

/** "Charter", "Freight"... */
export function kindLabel(k: JobKind): string {
  return KIND_LABELS[k];
}

/** Short class names for tables ("Trainer", "Twin", "Turbine heli"). */
const CLASS_SHORT: Readonly<Record<AircraftClass, string>> = {
  trainer: 'Trainer', tourer: 'Tourer', twin: 'Twin', turbine: 'Turboprop', heli: 'Helicopter', heliTurbine: 'Turbine heli',
};

/** A class's short name ("Trainer", "Turboprop"). */
export function classShort(c: AircraftClass): string {
  return CLASS_SHORT[c];
}

/** A class's long name (CLASS_RULES.label: "Two-seat trainer"). */
export function classLabel(c: AircraftClass): string {
  return CLASS_RULES[c].label;
}

/** "a twin", "a turboprop", "a helicopter": for "Needs a twin". */
export function classArticle(c: AircraftClass): string {
  const s = CLASS_SHORT[c].toLowerCase();
  return /^[aeiou]/.test(s) ? `an ${s}` : `a ${s}`;
}

const WEATHER_LABELS: Readonly<Record<CareerWeatherId, string>> = {
  clear: 'Clear', fair: 'Fair', overcast: 'Overcast', gusty: 'Gusty', drizzle: 'Drizzle', rain: 'Rain',
};

/** "Clear", "Gusty"... */
export function weatherLabel(w: CareerWeatherId): string {
  return WEATHER_LABELS[w];
}

const OUTCOME_LABELS: Readonly<Record<SettledOutcome, string>> = {
  completed: 'Completed', diverted: 'Diverted', outlanded: 'Outlanded', crashed: 'Crashed', abandoned: 'Abandoned', lost: 'Lost',
  routeMissed: 'Route missed',
};

/** "Completed", "Route missed"... */
export function outcomeLabel(o: SettledOutcome): string {
  return OUTCOME_LABELS[o];
}

/** Tone of an outcome for badges and the debrief headline. */
export function outcomeTone(o: SettledOutcome): 'ok' | 'warn' | 'bad' {
  if (o === 'completed') return 'ok';
  if (o === 'diverted' || o === 'abandoned') return 'warn';
  return 'bad';
}

const PHASE_LABELS: Readonly<Record<JobPhase, string>> = {
  dispatched: 'Dispatched', ground: 'On the ground', airborne: 'Airborne', landed: 'Landed', stopped: 'Stopped', done: 'Done',
};

/** "Airborne", "Stopped"... */
export function phaseLabel(p: JobPhase): string {
  return PHASE_LABELS[p];
}

const STATION_LABELS: Readonly<Record<Station, string>> = {
  front: 'Front seat', rear: 'Rear seats', cabin: 'Cabin', baggage: 'Baggage', cargo: 'Cargo',
};

/** "Front seat", "Baggage"... */
export function stationLabel(s: Station): string {
  return STATION_LABELS[s];
}

/** The type's short name from the aircraft catalogue ("Cessna 152", "R44 Raven II"). */
export function typeName(t: CareerAircraftId): string {
  return aircraftSummary(t).shortName;
}

/** "1 passenger", "3 passengers". */
export function paxText(n: number): string {
  return `${n} passenger${n === 1 ? '' : 's'}`;
}

/** An offer's load in a few characters: "2 pax", "140 kg", "Empty". */
export function loadText(pax: number, payloadKg: number): string {
  if (pax > 0) return `${pax} pax`;
  return payloadKg > 0 ? `${groupNum(payloadKg)} kg` : 'Empty';
}
