// Fixed facts about the simulated world that several modules must agree on: where the airport is,
// how the runway lies, and where the sun is. Terrain flattens itself around AIRPORT; the scenery module
// builds the runway on it; the flight model spawns the aircraft on it.

import { DEG, v3, type Vec3 } from './math';

export interface RunwayDef {
  /** Designators of the two ends, low heading first. */
  ids: [string, string];
  /** Centre of the runway, NED horizontal position (m). */
  center: { north: number; east: number };
  /** True heading of the low-numbered end's take-off direction, rad. */
  heading: number;
  length: number;
  width: number;
}

export const AIRPORT = {
  name: 'Fable Regional',
  icao: 'KFBL',
  /** Field elevation MSL, m. The whole airfield is level at this elevation. */
  elevation: 120,
  latitudeDeg: 46.5,
  /** Terrain is exactly flat within this distance of the runway centreline rectangle, then blends to natural terrain. */
  flatMargin: 450,
  blendDistance: 900,
  runway: {
    ids: ['07', '25'],
    center: { north: 0, east: 0 },
    heading: 70 * DEG,
    length: 1800,
    width: 30,
  } as RunwayDef,
  /** Apron / parking area centre, NED horizontal position. North-west side of the runway, abeam midfield. */
  apron: { north: 260, east: -90 },
} as const;

/** Unit vector along the runway's low-numbered take-off direction (NED, horizontal). */
export function runwayDirection(rw: RunwayDef = AIRPORT.runway): Vec3 {
  return { x: Math.cos(rw.heading), y: Math.sin(rw.heading), z: 0 };
}

/** NED position (on the ground) of a runway threshold. end = 0 for the low-numbered end (e.g. 07), 1 for the other. */
export function runwayThreshold(end: 0 | 1, rw: RunwayDef = AIRPORT.runway): Vec3 {
  const d = runwayDirection(rw);
  const s = end === 0 ? -rw.length / 2 : rw.length / 2;
  return { x: rw.center.north + d.x * s, y: rw.center.east + d.y * s, z: -AIRPORT.elevation };
}

/**
 * Signed distances of a point from the runway: `along` the centreline from the centre (+ toward the
 * high-numbered end) and `across` (+ to the right when facing the low-numbered take-off direction).
 */
export function runwayCoords(north: number, east: number, rw: RunwayDef = AIRPORT.runway): { along: number; across: number } {
  const dn = north - rw.center.north;
  const de = east - rw.center.east;
  const c = Math.cos(rw.heading);
  const s = Math.sin(rw.heading);
  return { along: dn * c + de * s, across: -dn * s + de * c };
}

/**
 * Direction TO the sun as a unit NED vector, from local solar time. Every module that needs the sun
 * position uses this so lighting, sky and shadows agree.
 */
export function sunDirectionNED(timeOfDayHours: number, dayOfYear: number, latitudeDeg: number = AIRPORT.latitudeDeg): Vec3 {
  const decl = 23.44 * DEG * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81));
  const lat = latitudeDeg * DEG;
  const hourAngle = (timeOfDayHours - 12) * 15 * DEG;
  // Equatorial -> horizontal
  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const north = Math.cos(lat) * Math.sin(decl) - Math.sin(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const east = -Math.cos(decl) * Math.sin(hourAngle);
  return v3.normalize({ x: north, y: east, z: -sinAlt });
}
