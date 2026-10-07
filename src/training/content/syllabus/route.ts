// The navigation route of L20 (and the first leg of the skill test, L21): KFBL -> Foothill Lake -> Valley Lake
// -> the town -> KFBL at 3,500 ft MSL, with the diversion target, and the nav log solved from the wind.
//
// Positions are the world's own features (NED metres from the runway midpoint): the lake centres of
// src/world/terrain/hydrology.ts and the town site of src/world/airport/valley.ts (findTownSite on the
// default terrain). A terrain survey (tests/training/syllabus.test.ts) proves every leg clears the ground by
// 1,000 ft within 1 NM either side at the route altitude.
//
// Diversion: section 4.1 names the alpine tarn, but it lies at 4,200 ft in a cirque with ground to 6,600 ft,
// impossible at the route's 3,500 ft with a 1,000 ft margin. The diversion goes to the glacial lake up the
// valley instead (terrain under 2,500 ft along the way).
//
// Wind: section 4.1 gives 270/15 at 3,500 ft, but the sim has one surface wind that strengthens and veers with
// height (src/physics/weather/boundaryLayer.ts). A west wind would put a tailwind on runway 07 for the landing
// that ends the lesson, which v1 forbids (winds 040-160). The lesson uses a surface wind of 100/9, which the
// boundary layer makes about 125/14 at cruise height: the same navigation problem, mirrored.

import { windSpeedFactor, windVeer } from '../../../physics/weather/boundaryLayer';
import type { NavRoute, NavWaypoint } from '../../types';

const NM = 1852;
const DEG = Math.PI / 180;

export const ROUTE_ALT_FT = 3500;
/** Planned cruise, KIAS. */
export const ROUTE_KIAS = 105;
/** Surface (10 m) wind the lesson flies in: degrees true from, knots. */
export const SURFACE_WIND = { dirDeg: 100, kt: 9 } as const;

export const WAYPOINTS = {
  kfbl: { id: 'kfbl', name: 'KFBL', north: 0, east: 0 },
  foothillLake: { id: 'foothillLake', name: 'Foothill Lake', north: 6405, east: -8716 },
  valleyLake: { id: 'valleyLake', name: 'Valley Lake', north: 6461, east: 7226 },
  town: { id: 'town', name: 'the town', north: -643, east: -3339 },
  glacialLake: { id: 'glacialLake', name: 'the glacial lake', north: 12986, east: 27199 },
} as const satisfies Record<string, NavWaypoint>;

/** The cruise wind, from the surface wind and the boundary-layer profile at about 2,500 ft above the ground. */
export function cruiseWind(): { dirDeg: number; kt: number } {
  const agl = 2500 * 0.3048;
  return { dirDeg: (SURFACE_WIND.dirDeg + windVeer(agl) / DEG) % 360, kt: SURFACE_WIND.kt * windSpeedFactor(agl) };
}

/** True airspeed from IAS with the 2 % per 1,000 ft rule of thumb a pilot uses on a nav log (ISA). */
export const tasFor = (kias: number, altFt: number): number => kias * (1 + 0.02 * altFt / 1000);

/** Course (degrees true) and distance (NM) from a to b. */
export function courseTo(a: { north: number; east: number }, b: { north: number; east: number }): { courseDeg: number; distNm: number } {
  const dn = b.north - a.north;
  const de = b.east - a.east;
  return { courseDeg: ((Math.atan2(de, dn) / DEG) + 360) % 360, distNm: Math.hypot(dn, de) / NM };
}

/** The E6B wind triangle: heading to steer and ground speed for a course at a true airspeed. */
export function windTriangle(courseDeg: number, tasKt: number, wind: { dirDeg: number; kt: number }): { headingDeg: number; gsKt: number } {
  const rel = (wind.dirDeg - courseDeg) * DEG;
  const wca = Math.asin(Math.max(-1, Math.min(1, (wind.kt * Math.sin(rel)) / tasKt)));
  const gs = tasKt * Math.cos(wca) - wind.kt * Math.cos(rel);
  return { headingDeg: (((courseDeg + wca / DEG) % 360) + 360) % 360, gsKt: gs };
}

/** A nav-log line: heading to steer (rounded to a degree; the sim has no magnetic variation) and minutes. */
function navLine(a: NavWaypoint, b: NavWaypoint): { headingDeg: number; minutes: number; distNm: number } {
  const { courseDeg, distNm } = courseTo(a, b);
  const { headingDeg, gsKt } = windTriangle(courseDeg, tasFor(ROUTE_KIAS, ROUTE_ALT_FT), cruiseWind());
  const hdg = Math.round(headingDeg) % 360;
  return { headingDeg: hdg === 0 ? 360 : hdg, minutes: Math.round((distNm / gsKt) * 600) / 10, distNm };
}

const W = WAYPOINTS;
// The route closes on the field; the last point gets its own id so waypoint ids stay unique.
const ROUTE_POINTS: NavWaypoint[] = [W.kfbl, W.foothillLake, W.valleyLake, W.town, { ...W.kfbl, id: 'kfblReturn' }].map((p) => ({ ...p }));
const LINES = ROUTE_POINTS.slice(1).map((p, i) => navLine(ROUTE_POINTS[i], p));

export const NAV_ROUTE: NavRoute = {
  id: 'kfblLakes', name: 'KFBL - Foothill Lake - Valley Lake - town - KFBL',
  waypoints: ROUTE_POINTS,
  altFt: ROUTE_ALT_FT,
  legMinutes: LINES.map((l) => l.minutes),
  legHeadingsDeg: LINES.map((l) => l.headingDeg),
};

/** Distance of each leg, NM (the leg-2 diversion starts at half of leg 2). */
export const LEG_NM: readonly number[] = LINES.map((l) => Math.round(l.distNm * 10) / 10);

/** The diversion from the middle of leg 2 to the glacial lake: heading, minutes and distance from the midpoint. */
export const DIVERSION = (() => {
  const mid: NavWaypoint = { id: 'leg2mid', name: 'mid leg 2', north: (W.foothillLake.north + W.valleyLake.north) / 2, east: (W.foothillLake.east + W.valleyLake.east) / 2 };
  return navLine(mid, W.glacialLake);
})();
