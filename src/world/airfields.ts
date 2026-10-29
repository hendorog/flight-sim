// Every airfield in the world: the home field (core/world.ts AIRPORT, hand-built at the origin) first, then the
// fields generated for the world seed (terrain/airfieldSiting.ts, present day only). Pure and three.js-free, so the
// terrain workers, physics, scenery, maps and later ATC all read the same list.
//
// heightfield.ts sites the generated fields against the natural terrain at load and again when the seed changes,
// and hands them here (setGeneratedAirfields); nothing else writes the list.

import { AIRPORT } from '../core/world';
import { isPresent } from './era/eraState';

export type AirfieldKind = 'home' | 'grass' | 'sealed';

export interface Airfield {
  /** Four-letter code, unique in the world (the home field: its ICAO code). */
  code: string;
  name: string;
  kind: AirfieldKind;
  /** Runway centre, NED horizontal position, m. */
  north: number;
  east: number;
  /** Field elevation MSL, m: the whole flattened area is level at it. */
  elevation: number;
  /** True heading of the low-numbered end's take-off direction, rad (0..pi). */
  heading: number;
  /** Runway designators, low-numbered end first ('07', '25'). */
  ids: [string, string];
  length: number;
  width: number;
  /** The terrain is flat within this distance of the runway rectangle, then blends to natural ground over `blend`, m. */
  flatMargin: number;
  blend: number;
  /** Protected approach length beyond each runway end, m (terrain trimmed under a gentle gradient, no trees). */
  approachLength: number;
  /** Traffic circuit direction for both runway ends (the side the circuit is flown on, seen on take-off). */
  circuit: 'left' | 'right';
  /** Common traffic frequency, MHz. */
  frequency: number;
}

/** The home field, as an Airfield (its constants stay in core/world.ts AIRPORT, which most of the sim reads). */
export const HOME_AIRFIELD: Airfield = {
  code: AIRPORT.icao,
  name: AIRPORT.name,
  kind: 'home',
  north: AIRPORT.runway.center.north,
  east: AIRPORT.runway.center.east,
  elevation: AIRPORT.elevation,
  heading: AIRPORT.runway.heading,
  ids: AIRPORT.runway.ids,
  length: AIRPORT.runway.length,
  width: AIRPORT.runway.width,
  flatMargin: AIRPORT.flatMargin,
  blend: AIRPORT.blendDistance,
  approachLength: 12000,
  circuit: 'left',
  frequency: 118.3,
};

let generated: readonly Airfield[] = [];

/** heightfield.ts only: the fields sited for the current seed. */
export function setGeneratedAirfields(list: readonly Airfield[]): void {
  generated = list;
}

/** The generated fields of the current world (none outside the present day). */
export function generatedAirfields(): readonly Airfield[] {
  return isPresent() ? generated : [];
}

/** Every airfield: the home field first, then the generated ones (present day only). */
export function airfields(): readonly Airfield[] {
  return isPresent() ? [HOME_AIRFIELD, ...generated] : [HOME_AIRFIELD];
}

/** Signed distances of a point from a field's runway: along the centreline (+ toward the high end) and across. */
export function fieldCoords(f: Airfield, north: number, east: number): { along: number; across: number } {
  const dn = north - f.north;
  const de = east - f.east;
  const c = Math.cos(f.heading);
  const s = Math.sin(f.heading);
  return { along: dn * c + de * s, across: -dn * s + de * c };
}

/** Runway designators for a take-off heading (rad, true, 0..pi): '07' and '25' for 070. */
export function runwayIds(heading: number): [string, string] {
  const deg = ((heading * 180) / Math.PI + 360) % 360;
  const lo = Math.round(deg / 10) % 36 || 36;
  const hi = ((lo + 17) % 36) + 1;
  const f = (n: number) => String(n).padStart(2, '0');
  return [f(lo), f(hi)];
}

/** Pavement of a generated field at a point, for tyre friction: 'runway' on a sealed runway (apron and taxiway: the terrain's own surface for now), else null. */
export function airfieldSurface(north: number, east: number): 'runway' | null {
  if (generated.length === 0 || !isPresent()) return null;
  for (const f of generated) {
    if (f.kind !== 'sealed') continue;
    const dn = north - f.north, de = east - f.east;
    if (dn * dn + de * de > (f.length / 2 + 50) ** 2) continue;
    const { along, across } = fieldCoords(f, north, east);
    if (Math.abs(along) <= f.length / 2 && Math.abs(across) <= f.width / 2) return 'runway';
  }
  return null;
}
