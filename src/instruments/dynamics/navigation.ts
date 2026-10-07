// Navigation signals the panel displays: the ILS to runway 07 (NAV1, 110.30) and GPS quantities
// relative to the airport. Pure geometry on the flat-earth NED frame.

import { DEG, KT, NM, RAD, clamp, wrapTwoPi, type Vec3 } from '../../core/math';
import { AIRPORT, runwayCoords } from '../../core/world';

/** ICAO Annex 10 ILS geometry. */
const LOC_ANTENNA_BEYOND_END = 300; // m past the far (stop) end
const LOC_HALF_WIDTH = 2.5 * DEG; // full-scale deflection
const LOC_RANGE = 18 * NM;
const LOC_COVERAGE = 35 * DEG;
const GS_ANGLE = 3 * DEG;
const GS_HALF_WIDTH = 0.7 * DEG; // full-scale deflection
const GS_ORIGIN_FROM_THRESHOLD = 300; // m, glide path intercept point past the threshold
const GS_RANGE = 10 * NM;
const GS_COVERAGE = 8 * DEG;

export interface IlsSignal {
  locValid: boolean;
  gsValid: boolean;
  /** Needle deflection as a fraction of full scale, -1..1 (+ = needle right = runway centreline is right). */
  loc: number;
  /** + = needle up = glide path above the aircraft. */
  gs: number;
}

/** ILS runway 07 as received at a NED position. */
export function ils07(position: Vec3, out: IlsSignal): IlsSignal {
  const rw = AIRPORT.runway;
  const { along, across } = runwayCoords(position.x, position.y);
  // Localizer antenna beyond the 25 end; the aircraft approaches from the 07 threshold side (along < 0).
  const toAntenna = rw.length / 2 + LOC_ANTENNA_BEYOND_END - along;
  const locAngle = Math.atan2(across, toAntenna);
  const dist = Math.hypot(toAntenna, across);
  out.locValid = toAntenna > 0 && Math.abs(locAngle) < LOC_COVERAGE && dist < LOC_RANGE;
  // Aircraft right of the centreline -> fly left -> needle left.
  out.loc = out.locValid ? clamp(-locAngle / LOC_HALF_WIDTH, -1, 1) : 0;

  const gsAlong = -rw.length / 2 + GS_ORIGIN_FROM_THRESHOLD - along;
  const height = -position.z - AIRPORT.elevation;
  const gsDist = Math.hypot(gsAlong, across);
  const elevation = Math.atan2(height, gsDist);
  out.gsValid = out.locValid && gsAlong > 0 && gsDist < GS_RANGE && Math.abs(elevation - GS_ANGLE) < GS_COVERAGE;
  // Aircraft below the path -> fly up -> needle up.
  out.gs = out.gsValid ? clamp((GS_ANGLE - elevation) / GS_HALF_WIDTH, -1, 1) : 0;
  return out;
}

export interface GpsData {
  /** Distance to the airport reference point, NM. */
  distanceNm: number;
  /** Bearing to the airport, degrees true [0, 360). */
  bearingDeg: number;
  /** Degrees true. */
  trackDeg: number;
  groundSpeedKt: number;
}

export function gpsToAirport(position: Vec3, track: number, groundSpeedMs: number, out: GpsData): GpsData {
  const dn = AIRPORT.runway.center.north - position.x;
  const de = AIRPORT.runway.center.east - position.y;
  out.distanceNm = Math.hypot(dn, de) / NM;
  out.bearingDeg = wrapTwoPi(Math.atan2(de, dn)) * RAD;
  out.trackDeg = wrapTwoPi(track) * RAD;
  out.groundSpeedKt = groundSpeedMs / KT;
  return out;
}
