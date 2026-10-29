// The airfield the scenarios start at (the menu's Airfields rows): null for the home field. The runway, apron and
// final scenarios then start at that generated field (scenarios.ts); the others stay at home. Module state, like
// the era: set by the menu before a reset, and by SimPhysics.restore from a resumed snapshot.

import { generatedAirfields, type Airfield } from '../world/airfields';

let code: string | null = null;

export function setStartField(c: string | null): void {
  code = c;
}

/** The chosen generated field, or null (none chosen, or no such field in this world). */
export function startField(): Airfield | null {
  return code === null ? null : (generatedAirfields().find((f) => f.code === code) ?? null);
}
