// Where and how a Career leg starts (docs/career.md "Placement"): the Scenario the CareerSystem hands to
// commands.startFrom so the player stands parked, cold and dark, at the aircraft's field with the job's payload in
// the mass model and the dispatch fuel in the tanks.
//
// The start is the free-flight 'apron' scenario at that field (scenarios.ts buildScenario after setStartField):
// home, the layout's PARKING stand; a sealed field, its apron spot; a grass strip, beside its hangar; facing the
// runway, with the type's `presets.cold`. Helicopters use the same stands (the free-flight apron start does too).
// The scenario id stays 'apron', so a resume snapshot validates and its `field` brings the generated field back;
// only the title, the exact `loading` (Scenario.loading, a Career addition SimPhysics.resetTo applies in place of
// the named loadings) and `ic.fuelFraction` change. Fuel is one fraction of every tank (per-tank fuel is a later
// stage), taken of the definition's own tank capacities so the mass model holds exactly the kilograms asked for.
//
// The pilot weighs OCCUPANT_KG except in the types whose own solo loading is the pilot alone at the definitions'
// 170 lb (R22, R44, S269, MD 500: `mass.loadings.typical`): there the definition's figure is used, so a pilot-only
// Career loading equals the solo loading the handling was tuned with (lead decision 1, 2026-10-31).
//
// Side effect, by design: setStartField(code) (null at home), the module state buildScenario and the resume
// snapshot read, as the menu's Airfields rows set it before a reset. Node-safe; tests/career/placement.test.ts runs
// it with a real SimPhysics. Not used: the 'runway' and 'final' scenarios (a job always starts cold on a stand).

import type { Environment } from '../core/types';
import type { AircraftDefinition } from '../aircraft/types';
import type { LoadingRequest } from '../physics/interfaces';
import { buildScenario, type Scenario, type ScenarioAircraft } from '../sim/scenarios';
import { setStartField } from '../sim/startField';
import { airfields, HOME_AIRFIELD, type Airfield } from '../world/airfields';
import { requireField } from './geo';
import { loadingFor } from './loading';
import { CAREER_RESET_PREFIX, OCCUPANT_KG, type ActiveJob, type CareerAircraftId, type PayloadItem } from './types';

/** What placement needs of an aircraft definition: the scenario profile, its id, the tanks and the named loadings. */
export type PlacementAircraft = ScenarioAircraft & Pick<AircraftDefinition, 'id' | 'mass' | 'powerplant'>;

/** Types whose `mass.loadings.typical` is the pilot alone at the definition's 170 lb (77.11 kg): their pilot mass. */
const SOLO_PILOT_TYPES: readonly CareerAircraftId[] = ['r22', 'r44', 's269', 'md500'];

/** The curtain label of a Career placement (commands.startFrom's `label`). */
export const PLACEMENT_LABEL = 'Loading job';

/**
 * The pilot's mass in `def`'s type, kg: the definition's solo-loading payload for the R22, R44, S269 and MD 500
 * (170 lb), OCCUPANT_KG (77 kg) for every other type.
 */
export function careerPilotKg(def: PlacementAircraft): number {
  return SOLO_PILOT_TYPES.includes(def.id as CareerAircraftId) ? def.mass.loadings.typical.payload : OCCUPANT_KG;
}

/** The usable fuel of `def`'s tanks together, kg (the flight model's tank capacities). */
export function usableFuelKgOf(def: PlacementAircraft): number {
  let kg = 0;
  for (const t of def.powerplant.fuel.tanks) kg += t.capacity;
  return kg;
}

/** The payload a Career leg loads into `def`: the pilot (careerPilotKg) and `items` at their stations (src/career/loading.ts). */
export function careerLoading(def: PlacementAircraft, items: readonly PayloadItem[]): LoadingRequest {
  return loadingFor(def.id as CareerAircraftId, items, careerPilotKg(def));
}

/** The startFrom `lessonId` of a Career placement: `career:<jobId>`, or `career:hub` for one without a job. */
export function placementLessonId(jobId: string | null): string {
  return `${CAREER_RESET_PREFIX}${jobId ?? 'hub'}`;
}

/** One placement: where, what is loaded and how much fuel, for whose job. */
export interface PlacementSpec {
  /** The field code to stand at (src/world/airfields.ts; the home field's own code is accepted). */
  field: string;
  /** The payload for the mass model (careerLoading, or ActiveJob.loading on a re-placement). */
  loading: LoadingRequest;
  /** Fuel on board, kg (clamped to the tanks: 0..usableFuelKgOf). */
  fuelKg: number;
  /** The job the leg belongs to (its offer id, for the title), or null (the selected aircraft with no job). */
  jobId: string | null;
}

/**
 * The scenario that stands `def` cold on `spec.field`'s stand with `spec`'s payload and fuel. Sets the start field
 * (null at home). Throws for a field code that is neither home nor a generated field of this world. `env` supplies
 * the atmosphere, as for buildScenario; `fields` defaults to airfields().
 */
export function placementScenario(spec: PlacementSpec, def: PlacementAircraft, env: Environment, fields: readonly Airfield[] = airfields()): Scenario {
  const f = spec.field === HOME_AIRFIELD.code ? HOME_AIRFIELD : requireField(spec.field, fields);
  setStartField(f.kind === 'home' ? null : f.code);
  const sc = buildScenario('apron', env, def);
  const usable = usableFuelKgOf(def);
  const fuelFraction = usable > 0 ? Math.min(1, Math.max(0, spec.fuelKg / usable)) : 0;
  return {
    ...sc,
    title: spec.jobId === null ? sc.title : `${f.name} (${f.code}), job ${spec.jobId}`,
    loading: spec.loading,
    ic: { ...sc.ic, fuelFraction },
  };
}

/**
 * The placement of an active job (docs/career.md "Placement"): at the field it is stopped at, else its origin,
 * with `job.loading` (built with careerLoading from `job.items` when still null: the CareerSystem stores the
 * returned scenario's `loading` in `active.loading`) and `job.fuelKg`. Throws when `def` is not the job's type
 * (a type switch reloads into it first).
 */
export function jobScenario(job: ActiveJob, def: PlacementAircraft, env: Environment, fields: readonly Airfield[] = airfields()): Scenario {
  if (def.id !== job.type) throw new Error(`placement: job ${job.offer.id} is for the ${job.type}, not the ${def.id}`);
  const loading = job.loading ?? careerLoading(def, job.items);
  return placementScenario({ field: job.stoppedAt ?? job.offer.origin, loading, fuelKg: job.fuelKg, jobId: job.offer.id }, def, env, fields);
}
