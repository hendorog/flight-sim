// Field geometry for the Career (docs/career.md "Job generation", "The job runtime"): an airfield by its code, the
// flat-earth distance (NM) and true bearing between NED points, the nearest field to a point, the stand a job is
// placed at, and which part of a field a point is on (fieldArea: runway, apron, elsewhere inside, or outside).
//
// Pure and three.js-free: the fields are passed in (src/world/airfields.ts airfields() in the game, synthetic ones in
// tests), as fit.ts does. The numbers come from COMPLETION_RULES. The home field's own layout (src/world/airport/
// layout.ts) supplies its apron: inside APRON_RECT or within homeStandM of a PARKING_SPOTS stand, because the home
// field's `apronAlong` is a dummy 0 and its apron lies more than COMPLETION_RULES.acrossM from the centreline. The
// generated fields' stands are scenarios.ts's 'apron' spots (sealed: (apronAlong, w + 43); grass: (apronAlong + 30,
// w + 16), w the runway's half width).

import { NM } from '../core/math';
import { fieldCoords, fieldPoint, type Airfield } from '../world/airfields';
import { APRON_RECT, nedToLocal, PARKING, PARKING_POSITIONS } from '../world/airport/layout';
import { bearingDeg } from './costs';
import { COMPLETION_RULES } from './types';

export { bearingDeg };

/** A point in the world's NED frame, m (x north, y east), as Airfield's north / east. */
export interface NedPoint {
  north: number;
  east: number;
}

/** The field with this code, or undefined. */
export function fieldByCode(code: string, fields: readonly Airfield[]): Airfield | undefined {
  return fields.find((f) => f.code === code);
}

/** The field with this code; throws if it is not in `fields`. */
export function requireField(code: string, fields: readonly Airfield[]): Airfield {
  const f = fieldByCode(code, fields);
  if (!f) throw new Error(`geo: no field ${code}`);
  return f;
}

/** Horizontal distance between two NED points, m. */
export function distanceM(a: NedPoint, b: NedPoint): number {
  return Math.hypot(b.north - a.north, b.east - a.east);
}

/** Horizontal distance between two NED points, NM. */
export function distanceNm(a: NedPoint, b: NedPoint): number {
  return distanceM(a, b) / NM;
}

/** The field whose runway centre is nearest a point, with its distance (m); null with no fields. Ties: the first. */
export function nearestField(north: number, east: number, fields: readonly Airfield[]): { field: Airfield; distanceM: number } | null {
  let best: { field: Airfield; distanceM: number } | null = null;
  for (const f of fields) {
    const d = Math.hypot(f.north - north, f.east - east);
    if (!best || d < best.distanceM) best = { field: f, distanceM: d };
  }
  return best;
}

/**
 * Where a job is placed at a field and where a helicopter lands back, NED m, with the heading it faces, rad true:
 * home, PARKING; a sealed field, its apron spot (apronAlong, w + 43); a grass strip, beside its hangar
 * (apronAlong + 30, w + 16); both facing the runway (scenarios.ts's 'apron' start).
 */
export function fieldStand(f: Airfield): NedPoint & { heading: number } {
  if (f.kind === 'home') return { north: PARKING.north, east: PARKING.east, heading: PARKING.heading };
  const w = f.width / 2;
  const p = f.kind === 'sealed' ? fieldPoint(f, f.apronAlong, w + 43) : fieldPoint(f, f.apronAlong + 30, w + 16);
  const heading = (((f.heading - Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return { ...p, heading };
}

/**
 * The part of a field a point is on, most specific first:
 * - 'runway': |along| <= length/2 and |across| <= width/2;
 * - 'apron': sealed, |along - apronAlong| <= apronAlongM and across in [w + apronAcrossMin, w + apronAcrossMax];
 *   grass, within grassSpotM of the stand; home, inside APRON_RECT or within homeStandM of a PARKING_SPOTS stand;
 * - 'inside': elsewhere with |along| <= length/2 + alongMarginM and |across| <= acrossM;
 * - null: outside the field.
 * An apron point counts as inside the field even where it lies beyond acrossM (the home apron does).
 */
export type FieldArea = 'runway' | 'apron' | 'inside' | null;

/** Which part of field `f` the NED point (north, east), m, is on (FieldArea; COMPLETION_RULES). */
export function fieldArea(f: Airfield, north: number, east: number): FieldArea {
  const R = COMPLETION_RULES;
  const { along, across } = fieldCoords(f, north, east);
  if (Math.abs(along) <= f.length / 2 && Math.abs(across) <= f.width / 2) return 'runway';
  if (onApron(f, north, east, along, across)) return 'apron';
  if (Math.abs(along) <= f.length / 2 + R.alongMarginM && Math.abs(across) <= R.acrossM) return 'inside';
  return null;
}

/** The apron test of fieldArea (field-frame coordinates already worked out). */
function onApron(f: Airfield, north: number, east: number, along: number, across: number): boolean {
  const R = COMPLETION_RULES;
  const w = f.width / 2;
  if (f.kind === 'home') {
    const l = nedToLocal(north, east);
    if (l.u >= APRON_RECT.u0 && l.u <= APRON_RECT.u1 && l.v >= APRON_RECT.v0 && l.v <= APRON_RECT.v1) return true;
    return PARKING_POSITIONS.some((s) => Math.hypot(s.north - north, s.east - east) <= R.homeStandM);
  }
  if (f.kind === 'sealed') {
    return Math.abs(along - f.apronAlong) <= R.apronAlongM && across >= w + R.apronAcrossMin && across <= w + R.apronAcrossMax;
  }
  const stand = fieldStand(f);
  return Math.hypot(stand.north - north, stand.east - east) <= R.grassSpotM;
}

/** The field a point is at (inside, on its apron or runway) and the area, or null when it is at none. The first field in `fields` order wins an overlap. */
export function fieldAt(north: number, east: number, fields: readonly Airfield[]): { field: Airfield; area: Exclude<FieldArea, null> } | null {
  for (const f of fields) {
    const area = fieldArea(f, north, east);
    if (area) return { field: f, area };
  }
  return null;
}

/** A short place name for titles: a field's name without "Aerodrome", "Airstrip" or "Regional" ("Holthurst"). */
export function placeName(f: Airfield): string {
  return f.name.replace(/\s+(Aerodrome|Airstrip|Regional|Airfield|Airport)$/u, '');
}

/** The eight-point compass name of a true bearing, deg ("north-east"). */
export function compassName(bearing: number): string {
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const i = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
  return names[i];
}
