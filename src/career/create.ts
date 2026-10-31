// A new Career save from the first-open form (docs/career.md "What the player sees", "First open"): the pilot
// and company names, the radio callsign word (by default the first word of the company name) and the first
// aircraft, a leased Cessna 152 or Cessna 172S. The career starts on day 1 at 08:00 (CLOCK_RULES.startMin) at the
// home field with START_RULES.cash and START_RULES.reputation, holding the single-engine piston rating.
//
// The first aircraft is airframe 'a1', registered by registrationFor('a1', authority) (src/career/registration.ts),
// delivered with its type's deliveryFuelKg (half tanks). It is the starting lease: no sign-on fee is charged (the
// form's promise is "$5,000 to start") and no logbook line is written; later leases go through progression.ts.
// Pure: the caller passes the world seed, the time and the home field's code (the world's code is never written
// literally here); nothing is stored until CareerStore.save.

import type { AuthorityId } from '../training/types';
import { CAREER_PERF } from './perf';
import { registrationFor } from './registration';
import { CAREER_SCHEMA, CLOCK_RULES, START_RULES, type CareerSave, type LicenceSource } from './types';
import { defaultCareerSettings } from './validate';

/** What the new-career form collects. Empty names fall back to the defaults below. */
export interface CareerForm {
  /** As typed; white space is tidied. */
  pilotName: string;
  /** As typed; white space is tidied. */
  companyName: string;
  /** Radio callsign word; empty: the first word of the company name. */
  callsign: string;
  /** The first aircraft, leased: a Cessna 152 or a Cessna 172S. */
  start: 'c152' | 'c172s';
}

/** Everything else a new career needs, from the shell. */
export interface CareerCreateContext {
  /** World seed the career lives in (src/world/worldSeed.ts). */
  seed: number;
  /** How the player came to hold a licence (the school's ppl, declared on the first open, or `unlock=1`). */
  licence: LicenceSource;
  /** The school's registration authority (default EASA). */
  authority: AuthorityId;
  /** Code of the home field (HOME_AIRFIELD.code), where the first aircraft is delivered. */
  homeCode: string;
  /** Creation time, ms since the epoch. */
  now: number;
}

/** Pilot name when the form's is empty. */
export const DEFAULT_PILOT_NAME = 'Pilot';
/** Company name when the form's is empty. */
export const DEFAULT_COMPANY_NAME = 'Fable Air';
/** The uid of a new career's first aircraft. */
export const FIRST_AIRCRAFT_UID = 'a1';

/** Collapse runs of white space and trim. */
const tidy = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * The radio callsign word for a company name: its first word, letters only, capitalised ("fable air" -> "Fable");
 * the default company's word when the name has no letters.
 */
export function defaultCallsign(companyName: string): string {
  for (const word of tidy(companyName).split(' ')) {
    const w = word.replace(/[^A-Za-z]/g, '');
    if (w) return w[0].toUpperCase() + w.slice(1).toLowerCase();
  }
  return defaultCallsign(DEFAULT_COMPANY_NAME);
}

/** A callsign word as typed, tidied the same way (first word, letters only, capitalised); empty: the company's. */
export function normaliseCallsign(callsign: string, companyName: string): string {
  return /[A-Za-z]/.test(callsign) ? defaultCallsign(callsign) : defaultCallsign(companyName);
}

/** A new Career save (not yet stored). */
export function createCareer(form: CareerForm, ctx: CareerCreateContext): CareerSave {
  const companyName = tidy(form.companyName) || DEFAULT_COMPANY_NAME;
  const perf = CAREER_PERF[form.start];
  const day = Math.floor(CLOCK_RULES.startMin / 1440);
  return {
    format: 'fs-career', schema: CAREER_SCHEMA,
    createdAt: ctx.now, updatedAt: ctx.now,
    seed: ctx.seed,
    pilot: { name: tidy(form.pilotName) || DEFAULT_PILOT_NAME, licence: ctx.licence },
    company: { name: companyName, callsign: normaliseCallsign(form.callsign, companyName) },
    cash: START_RULES.cash,
    reputation: START_RULES.reputation,
    clockMin: CLOCK_RULES.startMin,
    ratings: ['sep'],
    fleet: [{
      uid: FIRST_AIRCRAFT_UID, type: form.start, tenure: 'leased',
      registration: registrationFor(FIRST_AIRCRAFT_UID, ctx.authority),
      field: ctx.homeCode, fuelKg: perf.deliveryFuelKg, hours: 0, acquiredDay: day,
    }],
    selectedUid: FIRST_AIRCRAFT_UID,
    inCareer: true,
    taken: [],
    active: null,
    lastSettlement: null,
    logbook: [],
    flightNo: 1,
    ownNo: 1,
    settings: defaultCareerSettings(),
  };
}
