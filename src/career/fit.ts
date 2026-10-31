// Whether a job's load fits a type (docs/career.md "Job generation", "Dispatch and the load sheet"): the single
// fit rule that jobs.ts uses for an offer's refType and eligibility and loadsheet.ts for its blocking codes, so the
// board and the dispatch never disagree.
//
// fitOffer checks, in order: the seats and stations (assignStations), the take-off mass at the required fuel
// against MTOW (empty + pilot + payload + required fuel, the fuel plan of src/career/costs.ts at the offer's wind),
// then the runways at both ends (length against minRunwayM, a grass strip against grassOk; an off-field site, wave
// 4, has no runway to check). It does not look at the class, ratings, reputation or where the aircraft is: those
// are the load sheet's. Pure: the fields are passed in (src/world/airfields.ts airfields() in the game, synthetic
// ones in tests).

import type { Airfield } from '../world/airfields';
import { bearingDeg, fuelPlan, groundSpeedKt, type FuelPlan, type RouteWind } from './costs';
import { CAREER_PERF } from './perf';
import { assignStations } from './stations';
import { OCCUPANT_KG, type CareerAircraftId, type JobOffer, type JobPlace } from './types';

/** Why a type cannot take an offer's load (each is also a blocking LoadSheetCode). */
export type FitCode = 'seats' | 'stationLimit' | 'overMtow' | 'runwayShort' | 'grass';

/** The field with this code; throws if it is not in `fields` (an offer always names fields of its world). */
function field(code: string, fields: readonly Airfield[]): Airfield {
  const f = fields.find((x) => x.code === code);
  if (!f) throw new Error(`fit: no field ${code}`);
  return f;
}

/** A job end's position, NED m. */
function placePoint(p: JobPlace, fields: readonly Airfield[]): { north: number; east: number } {
  return p.kind === 'site' ? p : field(p.code, fields);
}

/** How the offer's wind acts on its route: a loop for a scenic flight (turning points), else the leg's track. */
export function routeWindOf(offer: JobOffer, fields: readonly Airfield[]): RouteWind {
  if (offer.waypoints && offer.waypoints.length > 0) return { kind: 'loop' };
  return { kind: 'leg', trackDeg: bearingDeg(field(offer.origin, fields), placePoint(offer.destination, fields)) };
}

/** A type's planning ground speed on the offer's route in the offer's wind, kt. */
export function offerGroundSpeedKt(offer: JobOffer, type: CareerAircraftId, fields: readonly Airfield[]): number {
  return groundSpeedKt(CAREER_PERF[type].cruiseTasKt, routeWindOf(offer, fields), offer.windDirDeg, offer.windKt);
}

/** A type's fuel plan for the offer (distance, its ground speed in the offer's wind), kg. */
export function offerFuelPlan(offer: JobOffer, type: CareerAircraftId, fields: readonly Airfield[]): FuelPlan {
  return fuelPlan(CAREER_PERF[type], offer.distanceNm, offerGroundSpeedKt(offer, type, fields));
}

/** Take-off mass with the offer's payload and the required fuel, kg: empty + pilot + payload + required fuel. */
export function takeoffMassAtRequired(offer: JobOffer, type: CareerAircraftId, fields: readonly Airfield[]): number {
  const payload = offer.payload.reduce((s, it) => s + it.kg, 0);
  return CAREER_PERF[type].emptyKg + OCCUPANT_KG + payload + offerFuelPlan(offer, type, fields).requiredKg;
}

/** The runway code for one end, or null when the type may use it (a site, or a helicopter, always may). */
function runwayFit(place: JobPlace, type: CareerAircraftId, fields: readonly Airfield[]): 'runwayShort' | 'grass' | null {
  if (place.kind === 'site') return null;
  const perf = CAREER_PERF[type];
  const f = field(place.code, fields);
  if (f.length < perf.minRunwayM) return 'runwayShort';
  if (f.kind === 'grass' && !perf.grassOk) return 'grass';
  return null;
}

/**
 * Whether `type` can take the offer's load (docs/career.md): null when it fits, else the first refusal in the
 * order seats / stationLimit (assignStations), overMtow (take-off mass at the required fuel above MTOW; equal is
 * allowed), runwayShort / grass (the origin, then the destination; a runway exactly minRunwayM long is allowed).
 */
export function fitOffer(offer: JobOffer, type: CareerAircraftId, fields: readonly Airfield[]): FitCode | null {
  const seating = assignStations(offer.payload, type);
  if (!seating.ok) return seating.code;
  if (takeoffMassAtRequired(offer, type, fields) > CAREER_PERF[type].mtowKg) return 'overMtow';
  return runwayFit({ kind: 'field', code: offer.origin }, type, fields) ?? runwayFit(offer.destination, type, fields);
}
