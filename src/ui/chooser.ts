// Pure helpers behind the aircraft chooser on the menu's Flight page: which types it lists, whether choosing
// one needs a confirmation first, and the page address the choice reloads into. No DOM here (tests/ui/).

import type { AircraftId, AircraftSummary } from '../aircraft/types';
import type { AircraftState } from '../core/types';

/** URL parameters that would undo or outlive the choice: they are removed when another type is chosen. */
export const CHOICE_DROPPED_PARAMS: readonly string[] = ['aircraft', 'scenario', 'lesson', 'phase', 'brief', 'resume'];

/**
 * The address the page reloads into after a choice (contract 2.5, commands.setAircraft): the current one
 * without `aircraft`, `scenario`, `lesson`, `phase`, `brief` and `resume`, plus `school=1` when the Flight
 * School is to open. The hash and every other parameter are kept.
 */
export function aircraftChoiceUrl(current: string, opts?: { open?: 'school' }): string {
  const url = new URL(current);
  for (const p of CHOICE_DROPPED_PARAMS) url.searchParams.delete(p);
  if (opts?.open === 'school') url.searchParams.set('school', '1');
  return url.toString();
}

/** The chooser's rows: the available types, the one flown first. Empty when there is nothing else to choose. */
export function chooserRows(catalogue: readonly AircraftSummary[], current: AircraftId): AircraftSummary[] {
  const rows = catalogue.filter((r) => r.available || r.id === current);
  if (!rows.some((r) => r.id !== current)) return [];
  return rows.sort((a, b) => Number(b.id === current) - Number(a.id === current));
}

/** Ground speed below which a parked or holding aircraft counts as standing still, m/s. */
const STANDING_STILL = 0.5;

/** What to ask before leaving the current flight for another type, or null to go straight away. */
export interface ChoiceConfirmation {
  kind: 'flight' | 'lesson';
  text: string;
}

/**
 * During a lesson: the lesson's abandon confirmation. Airborne or moving: "Leave this flight?" (the flight is
 * saved under the type's own resume key). Standing still on the ground: no question.
 */
export function choiceConfirmation(
  s: AircraftState,
  lessonActive: boolean,
  current: AircraftSummary,
  chosen: AircraftSummary,
): ChoiceConfirmation | null {
  if (lessonActive) return { kind: 'lesson', text: `Abandon the lesson and fly the ${chosen.shortName}? The flight so far is logged.` };
  const airborne = !s.wheels.some((w) => w.onGround);
  if (airborne || s.groundSpeed > STANDING_STILL) {
    return { kind: 'flight', text: `Leave this flight? It is saved and resumes when you return to the ${current.shortName}.` };
  }
  return null;
}
