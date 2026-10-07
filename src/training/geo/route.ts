// Route geometry for navigation lessons: the active leg's cross-track error, distance and bearing to go.
// Flat-earth NED like the rest of the simulator (routes are a few tens of NM).

import { NM } from '../../core/math';
import type { NavRoute } from '../types';
import { wrap360 } from './angles';

/** Default radius within which a turning point counts as passed overhead, NM. */
export const DEFAULT_PASS_RADIUS_NM = 1;

export interface LegGeometry {
  /** Cross-track error, NM (+ right of the leg). */
  xtkNm: number;
  /** Distance to the leg's end waypoint, NM. */
  distNm: number;
  /** True bearing to the leg's end waypoint, degrees. */
  bearingDeg: number;
  /** True when within the end waypoint's pass radius. */
  overhead: boolean;
  /**
   * Along-track distance past the leg's end waypoint, NM (negative while short of it). A leg is flown when
   * the aircraft is overhead its end or has gone abeam it (alongPastEndNm >= 0).
   */
  alongPastEndNm: number;
}

/** Number of legs of a route (waypoints - 1, never negative). */
export function legCount(route: NavRoute): number {
  return Math.max(0, route.waypoints.length - 1);
}

/**
 * Geometry of leg `leg` (from waypoints[leg] to waypoints[leg + 1]); `leg` is clamped to the route. A route
 * with fewer than two waypoints gives NaN everywhere.
 */
export function legGeometry(route: NavRoute, leg: number, north: number, east: number): LegGeometry {
  const n = legCount(route);
  if (n === 0) return { xtkNm: NaN, distNm: NaN, bearingDeg: NaN, overhead: false, alongPastEndNm: NaN };
  const i = Math.min(n - 1, Math.max(0, Math.floor(leg)));
  const a = route.waypoints[i];
  const b = route.waypoints[i + 1];
  const dn = b.north - a.north;
  const de = b.east - a.east;
  const len = Math.hypot(dn, de);
  const pn = north - b.north;
  const pe = east - b.east;
  const distM = Math.hypot(pn, pe);
  // Unit leg direction; a zero-length leg has no direction (no cross-track, always "past").
  const un = len > 1e-6 ? dn / len : 0;
  const ue = len > 1e-6 ? de / len : 0;
  // Cross product of the leg direction and the position (+ when the point is to the right of the track).
  const xtkM = len > 1e-6 ? un * (east - a.east) - ue * (north - a.north) : 0;
  const alongPastEndM = len > 1e-6 ? un * pn + ue * pe : 0;
  const passRadius = b.passRadiusNm ?? DEFAULT_PASS_RADIUS_NM;
  return {
    xtkNm: xtkM / NM,
    distNm: distM / NM,
    bearingDeg: wrap360((Math.atan2(-pe, -pn) * 180) / Math.PI),
    overhead: distM / NM <= passRadius,
    alongPastEndNm: alongPastEndM / NM,
  };
}
