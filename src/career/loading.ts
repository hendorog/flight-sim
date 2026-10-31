// The Career's payload for the flight model (docs/career.md "Loading"): turns the pilot and a job's seated and
// stowed items into the LoadingRequest that `fm.setLoading` takes, for the type the sim has booted.
//
// The pilot (OCCUPANT_KG) sits at CAREER_STATIONS[type].pilot and every item at its station's position; the
// request's payloadPosition is their mass-weighted centroid and its payloadDistribution one point per mass (the
// pilot first, then the items in load-sheet order), fractions summing to one and weighted offsets to zero, as
// PayloadDistribution requires. Several items at one station each keep their own point at the station's position.
// Fuel is not part of a LoadingRequest: the placement sets `ic.fuelFraction` from the dispatch fuel.
//
// The request is built at placement (after any type-switch reload) and stored in ActiveJob.loading, the only copy
// of the payload, so a resumed leg rebuilds the same mass. This module reads only src/career/stations.ts (literal
// positions) and imports no aircraft module (each type is a lazy chunk). The definitions' empty masses exclude the
// crew (the C208's CREW payload is two occupants on top of empty), so exactly one pilot is added.

import type { Vec3 } from '../core/math';
import type { LoadingRequest } from '../physics/interfaces';
import { CAREER_STATIONS } from './stations';
import { OCCUPANT_KG, type CareerAircraftId, type PayloadItem } from './types';

/**
 * The flight model's payload for the pilot and `items` in `type`: payload kg (pilot + items), its centroid in
 * reference-point body axes (m) and one distribution point per mass. `pilotKg` (kg, default OCCUPANT_KG) exists so a
 * test can compare against a definition's own solo loading at its 170 lb pilot; the Career always uses the default.
 * A zero total (pilotKg 0, no items) gives the centroid at the origin and a single point there. Throws on an item
 * whose station the type does not have.
 */
export function loadingFor(type: CareerAircraftId, items: readonly PayloadItem[], pilotKg: number = OCCUPANT_KG): LoadingRequest {
  const set = CAREER_STATIONS[type];
  const points: { kg: number; p: Vec3 }[] = [{ kg: pilotKg, p: set.pilot }];
  for (const it of items) {
    const p = set.stations[it.station];
    if (!p) throw new Error(`loadingFor: the ${type} has no ${it.station} station`);
    points.push({ kg: it.kg, p });
  }
  const payload = points.reduce((s, q) => s + q.kg, 0);
  if (!(payload > 0)) return { payload: 0, payloadPosition: { x: 0, y: 0, z: 0 }, payloadDistribution: [{ fraction: 1, offset: { x: 0, y: 0, z: 0 } }] };
  const c = { x: 0, y: 0, z: 0 };
  for (const q of points) {
    c.x += q.kg * q.p.x;
    c.y += q.kg * q.p.y;
    c.z += q.kg * q.p.z;
  }
  const payloadPosition = { x: c.x / payload, y: c.y / payload, z: c.z / payload };
  const payloadDistribution = points.map((q) => ({
    fraction: q.kg / payload,
    offset: { x: q.p.x - payloadPosition.x, y: q.p.y - payloadPosition.y, z: q.p.z - payloadPosition.z },
  }));
  return { payload, payloadPosition, payloadDistribution };
}
