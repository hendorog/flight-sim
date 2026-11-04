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

/** The home airfield: always at the world origin. Seed 0's is fixed (Fable Regional); a seeded world sites its own. */
export interface HomeAirport {
  name: string;
  icao: string;
  /** Field elevation MSL, m. The whole airfield is level at this elevation. */
  elevation: number;
  latitudeDeg: number;
  /** Terrain is exactly flat within this distance of the runway centreline rectangle, then blends to natural terrain. */
  flatMargin: number;
  blendDistance: number;
  /** Length of the protected approach corridors beyond each runway end, m (terrain trimmed under a gentle gradient). */
  approachLength: number;
  runway: RunwayDef;
  /** Apron / parking area centre, NED horizontal position. Seed 0: north-west side of the runway, abeam midfield. */
  apron: { north: number; east: number };
}

/** The apron centre in runway coordinates (along, across): the same place beside the runway in every world. */
const APRON_ALONG = 260 * Math.cos(70 * DEG) - 90 * Math.sin(70 * DEG);
const APRON_ACROSS = -260 * Math.sin(70 * DEG) - 90 * Math.cos(70 * DEG);

/**
 * The home airfield of the current world (one object for the life of the thread: modules keep the reference).
 * Seed 0's values below; a seeded world's are written by setHomeAirport (terrain/seededLayout.ts, the only writer).
 */
export const AIRPORT: HomeAirport = {
  name: 'Fable Regional',
  icao: 'KFBL',
  elevation: 120,
  latitudeDeg: 46.5,
  flatMargin: 450,
  blendDistance: 900,
  approachLength: 12000,
  runway: {
    ids: ['07', '25'],
    center: { north: 0, east: 0 },
    heading: 70 * DEG,
    length: 1800,
    width: 30,
  },
  apron: { north: 260, east: -90 },
};

/** What a world may change of the home airfield (the rest - position, runway size, apron place - stays). */
export interface HomeAirportSite {
  name: string;
  icao: string;
  elevation: number;
  /** True heading of the low-numbered end's take-off direction, rad, [0, pi). */
  heading: number;
  ids: [string, string];
  approachLength: number;
}

/** Seed 0's home airfield (Fable Regional). */
export const SEED0_HOME: Readonly<HomeAirportSite> = {
  name: AIRPORT.name,
  icao: AIRPORT.icao,
  elevation: AIRPORT.elevation,
  heading: AIRPORT.runway.heading,
  ids: [...AIRPORT.runway.ids] as [string, string],
  approachLength: AIRPORT.approachLength,
};

const homeHooks: Array<() => void> = [];

/**
 * Call `f` (in registration order) whenever the home airfield changes: modules that derive positions or constants
 * from AIRPORT at load re-derive them. Called synchronously inside setHomeAirport.
 */
export function onHomeAirport(f: () => void): void {
  homeHooks.push(f);
}

/** Move the home airfield to `site` (terrain/seededLayout.ts at a seed change; SEED0_HOME restores today's). */
export function setHomeAirport(site: Readonly<HomeAirportSite>): void {
  const a = AIRPORT;
  const same = a.name === site.name && a.icao === site.icao && a.elevation === site.elevation && a.runway.heading === site.heading
    && a.runway.ids[0] === site.ids[0] && a.runway.ids[1] === site.ids[1] && a.approachLength === site.approachLength;
  if (same) return;
  a.name = site.name;
  a.icao = site.icao;
  a.elevation = site.elevation;
  a.approachLength = site.approachLength;
  a.runway.heading = site.heading;
  a.runway.ids = [site.ids[0], site.ids[1]];
  const c = Math.cos(site.heading);
  const s = Math.sin(site.heading);
  a.apron.north = site.heading === SEED0_HOME.heading ? 260 : a.runway.center.north + APRON_ALONG * c - APRON_ACROSS * s;
  a.apron.east = site.heading === SEED0_HOME.heading ? -90 : a.runway.center.east + APRON_ALONG * s + APRON_ACROSS * c;
  for (const h of homeHooks) h();
}

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
