// Training areas (section 2.8). areas.test.ts surveys the terrain under each area at the lowest working
// altitude flown there and asserts at least 2,000 ft of clearance (terrain <= altitude - 2,000 ft over the
// whole radius).
//
// trainingArea: the spec places it at (4000 N, -8000 E), the cruise scenario's start, with a 3 NM radius,
//   and asks for the centre to move along the cruise track (heading 100 true from that start) to the
//   nearest point that passes if the survey fails. It fails there: the highest terrain within 3 NM is
//   1,727 ft MSL, so the 3,500 ft lessons (L01, L03, L05) would have 1,773 ft. Surveyed in 250 m steps
//   along the track, with 50 ft kept in hand for the sampling resolution, the nearest passing point is
//   12.75 km east of the start, (1786 N, 4556 E): highest terrain 1,442 ft MSL, 2,058 ft below 3,500 ft.
//   (No point on the track passes for 2,500 ft, L04's start in section 2.12: the lowest 3 NM circle on it
//   peaks at 1,280 ft. See the survey in areas.test.ts.)
// fieldOverhead: over the runway midpoint; the radius stays inside the airfield's flat ground (terrain is
//   exactly flat within 450 m of the runway rectangle), so it clears 2,000 ft AAL by construction.
// pflHighKey: abeam the upwind (25) end of runway 07 on the dead side (south-east, right of 07), offset
//   like the downwind leg on the other side (DOWNWIND_OFFSET, 900 m).

import { NM } from '../../core/math';
import { AIRPORT } from '../../core/world';
import { DOWNWIND_OFFSET } from '../../sim/scenarios';
import { localToNed } from '../../world/airport/layout';
import type { AreaDef, AreaId } from '../types';

const pflHighKey = localToNed(AIRPORT.runway.length / 2, DOWNWIND_OFFSET);

export const AREAS: Readonly<Record<AreaId, AreaDef>> = Object.freeze({
  trainingArea: { id: 'trainingArea', name: 'Training area', north: 1786, east: 4556, radiusNm: 3 },
  fieldOverhead: {
    id: 'fieldOverhead',
    name: 'Overhead the field',
    north: AIRPORT.runway.center.north,
    east: AIRPORT.runway.center.east,
    radiusNm: 0.25,
  },
  pflHighKey: { id: 'pflHighKey', name: 'High key (dead side, upwind end)', north: pflHighKey.north, east: pflHighKey.east, radiusNm: 1 },
});

/** Horizontal distance from an area's centre, NM. */
export function distFromAreaNm(area: AreaDef, north: number, east: number): number {
  return Math.hypot(north - area.north, east - area.east) / NM;
}

/** True when a NED point is inside an area's radius. */
export function inArea(area: AreaDef, north: number, east: number): boolean {
  return distFromAreaNm(area, north, east) <= area.radiusNm;
}
