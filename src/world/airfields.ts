// Every airfield in the world: the home field (core/world.ts AIRPORT, hand-built at the origin) first, then the
// fields generated for the world seed (terrain/airfieldSiting.ts, present day only). Pure and three.js-free, so the
// terrain workers, physics, scenery, maps and later ATC all read the same list.
//
// heightfield.ts sites the generated fields against the natural terrain at load and again when the seed changes,
// and hands them here (setGeneratedAirfields); nothing else writes the list.

import { AIRPORT, onHomeAirport } from '../core/world';
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
  /** Along the runway from its centre to the apron (sealed) or hangar (grass), on the right of the runway, m. */
  apronAlong: number;
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
  approachLength: AIRPORT.approachLength,
  circuit: 'left',
  frequency: 118.3,
  apronAlong: 0,
};

// Another world's home field (core/world.ts setHomeAirport): the same object, its values brought up to date.
onHomeAirport(() => {
  const h = HOME_AIRFIELD;
  h.code = AIRPORT.icao;
  h.name = AIRPORT.name;
  h.elevation = AIRPORT.elevation;
  h.heading = AIRPORT.runway.heading;
  h.ids = AIRPORT.runway.ids;
  h.approachLength = AIRPORT.approachLength;
});

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

/** A point in a field's frame (along the runway from its centre, across it: + right on take-off), NED. */
export function fieldPoint(f: Airfield, along: number, across: number): { north: number; east: number } {
  const c = Math.cos(f.heading);
  const s = Math.sin(f.heading);
  return { north: f.north + c * along - s * across, east: f.east + s * along + c * across };
}

/**
 * Where a generated field's access road arrives (`end`: the apron's outer edge, or beside the hangar of a grass strip)
 * and where it leaves the levelled ground (`gate`, square to the runway beyond the blend), NED.
 */
export function airfieldAccess(f: Airfield): { end: { north: number; east: number }; gate: { north: number; east: number } } {
  const w = f.width / 2;
  const end = f.kind === 'sealed' ? fieldPoint(f, f.apronAlong, w + 58) : fieldPoint(f, f.apronAlong + 26, w + 30);
  return { end, gate: fieldPoint(f, f.kind === 'sealed' ? f.apronAlong : f.apronAlong + 26, w + f.flatMargin + f.blend + 60) };
}

/** Runway designators for a take-off heading (rad, true, 0..pi): '07' and '25' for 070. */
export function runwayIds(heading: number): [string, string] {
  const deg = ((heading * 180) / Math.PI + 360) % 360;
  const lo = Math.round(deg / 10) % 36 || 36;
  const hi = ((lo + 17) % 36) + 1;
  const f = (n: number) => String(n).padStart(2, '0');
  return [f(lo), f(hi)];
}

/**
 * Pavement of a generated field at a point, for tyre friction and the wheels' height: 'runway' on a sealed runway,
 * 'taxiway' on its taxiway and apron (as airfieldScenery.ts draws them), else null.
 */
export function airfieldSurface(north: number, east: number): 'runway' | 'taxiway' | null {
  if (generated.length === 0 || !isPresent()) return null;
  for (const f of generated) {
    if (f.kind !== 'sealed') continue;
    const dn = north - f.north, de = east - f.east;
    if (dn * dn + de * de > (f.length / 2 + 100) ** 2) continue;
    const { along, across } = fieldCoords(f, north, east);
    const w = f.width / 2;
    if (Math.abs(along) <= f.length / 2 && Math.abs(across) <= w) return 'runway';
    const a = along - f.apronAlong;
    if ((Math.abs(a) <= 6 && across > w && across <= w + 28) || (Math.abs(a) <= 35 && across > w + 28 && across <= w + 58)) return 'taxiway';
  }
  return null;
}

function boxSD(u: number, v: number, u0: number, u1: number, v0: number, v1: number): number {
  const du = Math.abs(u - (u0 + u1) * 0.5) - (u1 - u0) * 0.5;
  const dv = Math.abs(v - (v0 + v1) * 0.5) - (v1 - v0) * 0.5;
  const ou = du > 0 ? du : 0, ov = dv > 0 ? dv : 0;
  return Math.hypot(ou, ov) + Math.min(Math.max(du, dv), 0);
}

function rampWeight(sd: number, rampM: number): number {
  if (sd <= 0) return 1;
  if (sd >= rampM) return 0;
  const t = sd / rampM;
  return 1 - t * t * (3 - 2 * t);
}

/** Smoothly ramped pavement contact height at generated sealed airfields (`runwayH` / `taxiwayH` inside, 0 beyond `rampM`). */
export function airfieldPavementLift(north: number, east: number, runwayH: number, taxiwayH: number, rampM: number): number {
  if (generated.length === 0 || !isPresent()) return 0;
  for (const f of generated) {
    if (f.kind !== 'sealed') continue;
    const dn = north - f.north, de = east - f.east;
    const bound = f.length / 2 + 100 + rampM;
    if (dn * dn + de * de > bound * bound) continue;
    const { along, across } = fieldCoords(f, north, east);
    const w = f.width / 2;
    const rSd = boxSD(along, across, -f.length / 2, f.length / 2, -w, w);
    if (rSd <= 0) return runwayH;
    const a = along - f.apronAlong;
    const tSd = Math.min(boxSD(a, across, -6, 6, w, w + 28), boxSD(a, across, -35, u1Apron(), w + 28, w + 58));
    if (rSd < rampM || tSd < rampM) {
      const rr = rampWeight(rSd, rampM) * runwayH;
      const tr = rampWeight(tSd, rampM) * taxiwayH;
      return rr > tr ? rr : tr;
    }
  }
  return 0;
}

function u1Apron(): number {
  return 35;
}
