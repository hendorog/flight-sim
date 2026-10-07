// Aircraft types available to lessons. The C172S is built in; the simulator registers the type it flies
// (its presentation's `training`) with registerAircraftType. Lessons are flown only in SCHOOL_AIRCRAFT
// (decision D5): another type's def is data for the logbook and the school's refusal, not a syllabus.

import type { AircraftTypeDef, AircraftTypeId } from '../types';
import { C172S } from './c172s';

export const DEFAULT_AIRCRAFT: AircraftTypeId = 'c172s';

/** The types the PPL syllabus is written, flown and conformance-tested in (D5: the C172S only). Lint context. */
export const SCHOOL_AIRCRAFT: readonly AircraftTypeId[] = ['c172s'];

const TYPES = new Map<AircraftTypeId, AircraftTypeDef>([['c172s', C172S]]);

/** The type definition for an id; throws for an unknown type (lesson data is linted, so this is a bug). */
export function getAircraftType(id: AircraftTypeId = DEFAULT_AIRCRAFT): AircraftTypeDef {
  const t = TYPES.get(id);
  if (!t) throw new Error(`unknown aircraft type '${id}'`);
  return t;
}

/** Make a type's def available under its own id (the simulator, after loadPresentation; tests). A def already
 *  registered under that id is replaced, except the built-in C172S, which a different object may not replace. */
export function registerAircraftType(def: AircraftTypeDef): void {
  const had = TYPES.get(def.id);
  if (had === def) return;
  if (had === C172S) throw new Error(`registerAircraftType: '${def.id}' is the built-in C172S`);
  TYPES.set(def.id, def);
}

export function hasAircraftType(id: string): boolean {
  return TYPES.has(id);
}

/** Every registered def, the C172S first. */
export function listAircraftTypes(): readonly AircraftTypeDef[] {
  return [...TYPES.values()];
}

/** Lessons may be flown in this type. */
export function schoolSupports(id: AircraftTypeId): boolean {
  return SCHOOL_AIRCRAFT.includes(id);
}
