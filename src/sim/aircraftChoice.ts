// Which aircraft a session flies, and the per-browser settings that go with the choice (contract 2.5). Node-safe:
// tests/sim/aircraftChoice.test.ts runs it with a fake store.
//
//   at boot     aircraft=<id> in the URL if it is a known id; else the stored preference ('fs.aircraft') if it is
//               a known id of a type that is available; else the Cessna 172S. A URL with lesson= and no
//               aircraft= flies the C172S (the Flight School teaches in it). A type chosen by URL is not stored:
//               dev and test links do not change what the owner flies next.
//   the chooser commands.setAircraft stores the preference and reloads without the URL parameters that would
//               undo the choice (aircraftSwitchUrl).
//   carb icing  the realism switch ('fs.carbIcing', '0' = off, absent = on).

import { AIRCRAFT_PREF_KEY, aircraftSummary } from '../aircraft/registry';
import { DEFAULT_AIRCRAFT_ID, isAircraftId, type AircraftId } from '../core/types';
import type { SimParams } from './params';
import type { KeyValueStore } from './resume';

/** localStorage key of the carburettor-icing realism switch ('0' = off; absent = on). */
export const CARB_ICING_KEY = 'fs.carbIcing';

/** URL parameters a change of aircraft removes: each would bring the old type or its flight back. */
export const AIRCRAFT_SWITCH_DROPS = ['aircraft', 'scenario', 'lesson', 'phase', 'brief', 'resume'] as const;

export interface AircraftChoice {
  id: AircraftId;
  /** Where the choice came from. */
  source: 'url' | 'preference' | 'default';
}

function read(store: KeyValueStore | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(store: KeyValueStore | null, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** The type this session flies (see the header for the order). */
export function chooseAircraft(params: Pick<SimParams, 'aircraft' | 'school'>, store: KeyValueStore | null): AircraftChoice {
  if (params.aircraft) return { id: params.aircraft, source: 'url' };
  if (params.school.lesson === null) {
    const pref = read(store, AIRCRAFT_PREF_KEY);
    if (isAircraftId(pref) && aircraftSummary(pref).available) return { id: pref, source: 'preference' };
  }
  return { id: DEFAULT_AIRCRAFT_ID, source: 'default' };
}

/** Store the type the pilot chose in the menu. */
export function saveAircraftPreference(store: KeyValueStore | null, id: AircraftId): void {
  write(store, AIRCRAFT_PREF_KEY, id);
}

/**
 * The page a change of aircraft reloads into: the current URL without AIRCRAFT_SWITCH_DROPS, plus school=1 when
 * the Flight School is to open after the reload.
 */
export function aircraftSwitchUrl(href: string, opts: { open?: 'school' } = {}): string {
  const url = new URL(href);
  for (const k of AIRCRAFT_SWITCH_DROPS) url.searchParams.delete(k);
  if (opts.open === 'school') url.searchParams.set('school', '1');
  return url.toString();
}

/** Carburettor icing on (the default) or off. */
export function loadCarbIcing(store: KeyValueStore | null): boolean {
  return read(store, CARB_ICING_KEY) !== '0';
}

export function saveCarbIcing(store: KeyValueStore | null, on: boolean): void {
  write(store, CARB_ICING_KEY, on ? '1' : '0');
}
