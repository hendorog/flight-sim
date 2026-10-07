// Fable Regional (KFBL) airport layout: pure data and geometry, no three.js, so physics and node tests can use it.
//
// LOCAL FRAME. Everything here is laid out in runway coordinates (see runwayCoords in core/world.ts):
//   u = along the centreline from the runway centre, + toward the 25 end (the 07 take-off direction, 070 deg true)
//   v = across, + to the right when facing 070 (south-east side). The apron and buildings are on the -v side.
// Heights are metres above AIRPORT.elevation.
//
// Dimensions follow FAA AC 150/5300-13 (design) and AC 150/5340-1M (markings) for an ADG II precision runway,
// scaled where the 30 m (98 ft) width needs it; the source is noted next to each constant.

import { DEG, FT } from '../../core/math';
import { AIRPORT, runwayCoords } from '../../core/world';

export interface LocalXY {
  u: number;
  v: number;
}
export interface NedXY {
  north: number;
  east: number;
}
/** Axis-aligned rectangle in the local frame. */
export interface LocalRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}
/** A named position in NED with a true heading (rad), e.g. a parking spot or hold-short point. */
export interface NamedPosition extends NedXY {
  name: string;
  heading: number;
}

const COS_H = Math.cos(AIRPORT.runway.heading);
const SIN_H = Math.sin(AIRPORT.runway.heading);

export function localToNed(u: number, v: number): NedXY {
  return {
    north: AIRPORT.runway.center.north + u * COS_H - v * SIN_H,
    east: AIRPORT.runway.center.east + u * SIN_H + v * COS_H,
  };
}

export function nedToLocal(north: number, east: number): LocalXY {
  const r = runwayCoords(north, east);
  return { u: r.along, v: r.across };
}

/** True heading (rad, [0, 2PI)) of a direction given in the local frame. */
export function localHeading(du: number, dv: number): number {
  const h = AIRPORT.runway.heading + Math.atan2(dv, du);
  return ((h % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

// ---------------------------------------------------------------------------------------------------------------
// Runway 07/25 and its markings (AC 150/5340-1M, precision instrument runway)

export const RUNWAY_HALF_LENGTH = AIRPORT.runway.length / 2;
export const RUNWAY_HALF_WIDTH = AIRPORT.runway.width / 2;
export const RUNWAY_RECT: LocalRect = { u0: -RUNWAY_HALF_LENGTH, u1: RUNWAY_HALF_LENGTH, v0: -RUNWAY_HALF_WIDTH, v1: RUNWAY_HALF_WIDTH };

/**
 * Marking positions measured from each threshold (s, inward) and laterally from the centreline (x), metres.
 * Standard FAA dimensions; the lateral layout of aiming point / touchdown zone bars is compressed to fit a
 * 100 ft runway inside the side stripes.
 */
export const MARKINGS = {
  sideStripe: { width: 3 * FT, edgeInset: 0.05 },
  /** 8 stripes for a 100 ft wide runway, 150 ft long, 5.75 ft wide and apart, starting 20 ft from the threshold. */
  threshold: { start: 20 * FT, length: 150 * FT, stripeWidth: 5.75 * FT, count: 8, outerEdge: RUNWAY_HALF_WIDTH - 1.5 },
  /** Designation numbers: 60 ft tall, 20 ft wide, 5 ft strokes, 20 ft beyond the threshold stripes. */
  designation: { start: 190 * FT, height: 60 * FT, digitWidth: 20 * FT, stroke: 5 * FT, gap: 10 * FT },
  /** Centreline: 36 in wide (precision), 120 ft stripes with ~80 ft gaps, starting 40 ft past the numbers. */
  centreline: { width: 36 * FT / 12, stripe: 120 * FT, nominalGap: 80 * FT, start: 290 * FT },
  /** Aiming point: begins 1020 ft from the threshold, 150 ft long. */
  aimingPoint: { start: 1020 * FT, length: 150 * FT, innerX: 5.0, width: 20 * FT },
  /** Touchdown zone bars: 75 ft long, 6 ft wide, 5 ft apart; groups of 3, 2, 2, 1 at 500 ft intervals. */
  touchdownZone: { length: 75 * FT, barWidth: 6 * FT, barGap: 5 * FT, innerX: 5.0, groups: [[500 * FT, 3], [1500 * FT, 2], [2000 * FT, 2], [2500 * FT, 1]] as [number, number][] },
} as const;

/** Centreline stripe layout: integer number of stripes between the two start points, gap adjusted to fit. */
export function centrelineLayout(): { first: number; count: number; period: number } {
  const c = MARKINGS.centreline;
  const span = AIRPORT.runway.length - 2 * c.start;
  const count = Math.round((span + c.nominalGap) / (c.stripe + c.nominalGap));
  const gap = (span - count * c.stripe) / (count - 1);
  return { first: -RUNWAY_HALF_LENGTH + c.start, count, period: c.stripe + gap };
}

// ---------------------------------------------------------------------------------------------------------------
// Taxiways and apron. Taxiways are straight, axis-aligned segments with a width; the paved area is their union
// with the apron, joined by circular-ish fillets (polynomial smooth-min of the rectangle distance fields).

/** ADG II taxiway width, 35 ft (AC 150/5300-13 table 4-2). */
export const TAXIWAY_WIDTH = 35 * FT;
/** Runway centreline to parallel taxiway centreline. 120 m leaves room for the 250 ft hold lines. */
export const PARALLEL_TAXIWAY_V = -120;
/** Fillet radius of the smooth union at taxiway junctions, m. */
export const FILLET_RADIUS = 12;
/** Radius of the taxiway centreline curves at junctions, m. */
export const CENTRELINE_TURN_RADIUS = 14;
/** Hold-short lines are 250 ft from the runway centreline (precision approach runway, ADG I-II). */
export const HOLD_LINE_V = -250 * FT;

export interface TaxiwaySegment {
  name: string;
  /** Centreline end points in the local frame; always parallel to u or v. */
  a: LocalXY;
  b: LocalXY;
  width: number;
}

const TW = TAXIWAY_WIDTH;
const A_END = RUNWAY_HALF_LENGTH - 15;
/** v where connectors end, under the runway so the runway surface covers the join. */
const UNDER_RUNWAY_V = -RUNWAY_HALF_WIDTH + 5;

export const APRON_RECT: LocalRect = (() => {
  const c = nedToLocal(AIRPORT.apron.north, AIRPORT.apron.east);
  return { u0: c.u - 165, u1: c.u + 165, v0: c.v - 50, v1: c.v + 50 };
})();

export const TAXIWAYS: readonly TaxiwaySegment[] = [
  { name: 'A', a: { u: -A_END - TW / 2, v: PARALLEL_TAXIWAY_V }, b: { u: A_END + TW / 2, v: PARALLEL_TAXIWAY_V }, width: TW },
  { name: 'A1', a: { u: -A_END, v: PARALLEL_TAXIWAY_V }, b: { u: -A_END, v: UNDER_RUNWAY_V }, width: TW },
  { name: 'A2', a: { u: -300, v: PARALLEL_TAXIWAY_V }, b: { u: -300, v: UNDER_RUNWAY_V }, width: TW },
  { name: 'A3', a: { u: 300, v: PARALLEL_TAXIWAY_V }, b: { u: 300, v: UNDER_RUNWAY_V }, width: TW },
  { name: 'A4', a: { u: A_END, v: PARALLEL_TAXIWAY_V }, b: { u: A_END, v: UNDER_RUNWAY_V }, width: TW },
  { name: 'B1', a: { u: -60, v: PARALLEL_TAXIWAY_V }, b: { u: -60, v: APRON_RECT.v1 - 5 }, width: TW },
  { name: 'B2', a: { u: 70, v: PARALLEL_TAXIWAY_V }, b: { u: 70, v: APRON_RECT.v1 - 5 }, width: TW },
];

/** Connectors that cross a hold line onto the runway, with the runway end they normally serve. */
export const RUNWAY_CONNECTORS: readonly { name: string; runway: '07' | '25' }[] = [
  { name: 'A1', runway: '07' },
  { name: 'A2', runway: '07' },
  { name: 'A3', runway: '25' },
  { name: 'A4', runway: '25' },
];

/** Apron taxilane along u, midway between the two parking rows. */
export const APRON_TAXILANE_V = (APRON_RECT.v0 + APRON_RECT.v1) / 2;

export function segmentRect(s: TaxiwaySegment): LocalRect {
  const h = s.width / 2;
  return {
    u0: Math.min(s.a.u, s.b.u) - (s.a.u === s.b.u ? h : 0),
    u1: Math.max(s.a.u, s.b.u) + (s.a.u === s.b.u ? h : 0),
    v0: Math.min(s.a.v, s.b.v) - (s.a.v === s.b.v ? h : 0),
    v1: Math.max(s.a.v, s.b.v) + (s.a.v === s.b.v ? h : 0),
  };
}

/** Signed distance to an axis-aligned rectangle (negative inside). */
export function rectSD(u: number, v: number, r: LocalRect): number {
  const cu = (r.u0 + r.u1) / 2, cv = (r.v0 + r.v1) / 2;
  const du = Math.abs(u - cu) - (r.u1 - r.u0) / 2;
  const dv = Math.abs(v - cv) - (r.v1 - r.v0) / 2;
  const ou = Math.max(du, 0), ov = Math.max(dv, 0);
  return Math.hypot(ou, ov) + Math.min(Math.max(du, dv), 0);
}

/** Polynomial smooth minimum (Quilez); adds a fillet of about radius k where two shapes meet. Never exceeds min(a, b). */
export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** All rectangles making up the taxiway + apron union, apron first. Shared with the GLSL generator. */
export const PAVED_RECTS: readonly LocalRect[] = [APRON_RECT, ...TAXIWAYS.map(segmentRect)];

/** Signed distance to the taxiway/apron paved area (m, negative on pavement), including fillets. */
export function pavedSD(u: number, v: number): number {
  let d = rectSD(u, v, PAVED_RECTS[0]);
  for (let i = 1; i < PAVED_RECTS.length; i++) d = smin(d, rectSD(u, v, PAVED_RECTS[i]), FILLET_RADIUS);
  return d;
}

/** Bounding box of everything paved (runway included), for quick rejection. */
const PAVED_BOUNDS: LocalRect = PAVED_RECTS.reduce(
  (b, r) => ({ u0: Math.min(b.u0, r.u0), u1: Math.max(b.u1, r.u1), v0: Math.min(b.v0, r.v0), v1: Math.max(b.v1, r.v1) }),
  { ...RUNWAY_RECT },
);

export function isOnRunway(u: number, v: number): boolean {
  return Math.abs(u) <= RUNWAY_HALF_LENGTH && Math.abs(v) <= RUNWAY_HALF_WIDTH;
}

/**
 * Pavement type at a horizontal NED position, for tyre friction: 'runway' (asphalt runway), 'taxiway'
 * (taxiways and the concrete apron) or null (not paved; use the terrain's own surface).
 */
export function airportSurface(north: number, east: number): 'runway' | 'taxiway' | null {
  const { u, v } = nedToLocal(north, east);
  const m = FILLET_RADIUS;
  if (u < PAVED_BOUNDS.u0 - m || u > PAVED_BOUNDS.u1 + m || v < PAVED_BOUNDS.v0 - m || v > PAVED_BOUNDS.v1 + m) return null;
  if (isOnRunway(u, v)) return 'runway';
  return pavedSD(u, v) <= 0 ? 'taxiway' : null;
}

/** Taxiway centreline curves at junctions: quarter circles joining the parallel taxiway to each connector. */
export interface CentrelineArc {
  /** Circle centre. */
  cu: number;
  cv: number;
  r: number;
  /** The arc is the quarter of the circle toward (cu - su*r, cv - sv*r), i.e. toward the junction corner. */
  su: number;
  sv: number;
}

export const CENTRELINE_ARCS: readonly CentrelineArc[] = (() => {
  const arcs: CentrelineArc[] = [];
  const R = CENTRELINE_TURN_RADIUS;
  const parallel = TAXIWAYS[0];
  const uMin = Math.min(parallel.a.u, parallel.b.u) + TW / 2;
  const uMax = Math.max(parallel.a.u, parallel.b.u) - TW / 2;
  for (const t of TAXIWAYS.slice(1)) {
    const sv = Math.sign(t.b.v - t.a.v); // connector heads toward +v (runway) or -v (apron)
    for (const su of [-1, 1]) {
      const cu = t.a.u + su * R;
      if (cu < uMin - 1 || cu > uMax + 1) continue; // outer corner of an end connector: no turn that way
      arcs.push({ cu, cv: PARALLEL_TAXIWAY_V + sv * R, r: R, su, sv });
    }
  }
  return arcs;
})();

// ---------------------------------------------------------------------------------------------------------------
// Parking, hold-short points and other named positions

/** Parking rows: row A faces +v (toward the runway) near the buildings, row B faces -v near the taxiway. */
export const PARKING_ROW_A_V = APRON_RECT.v0 + 22;
export const PARKING_ROW_B_V = APRON_RECT.v1 - 18;
export const PARKING_SPACING = 15;
/** Fuel island on the east end of the apron. */
export const FUEL_ISLAND: LocalXY = { u: APRON_RECT.u1 - 18, v: APRON_RECT.v0 + 22 };

export interface ParkingSpot extends LocalXY {
  name: string;
  /** +1 = nose toward +v, -1 = nose toward -v. */
  facing: 1 | -1;
}

export const PARKING_SPOTS: readonly ParkingSpot[] = (() => {
  const spots: ParkingSpot[] = [];
  const first = APRON_RECT.u0 + 15;
  const last = FUEL_ISLAND.u - 20;
  let n = 1;
  for (let u = first; u <= last; u += PARKING_SPACING) spots.push({ name: `A${n++}`, u, v: PARKING_ROW_A_V, facing: 1 });
  n = 1;
  for (let u = first; u <= APRON_RECT.u1 - 12; u += PARKING_SPACING) {
    // keep the entries from taxiways B1/B2 clear
    if (TAXIWAYS.some((t) => t.name.startsWith('B') && Math.abs(t.a.u - u) < 14)) continue;
    spots.push({ name: `B${n++}`, u, v: PARKING_ROW_B_V, facing: -1 });
  }
  return spots;
})();

function spotToNamed(s: ParkingSpot): NamedPosition {
  return { name: s.name, ...localToNed(s.u, s.v), heading: localHeading(0, s.facing) };
}

/** Default spawn spot for the player: row A, in front of the terminal. The AircraftState position is the CG. */
export const PARKING: NamedPosition = spotToNamed(
  PARKING_SPOTS.filter((s) => s.facing === 1).reduce((best, s) => (Math.abs(s.u + 10) < Math.abs(best.u + 10) ? s : best)),
);

/** Every parking spot as an NED position + heading. */
export const PARKING_POSITIONS: readonly NamedPosition[] = PARKING_SPOTS.map(spotToNamed);

/** Aircraft CG position when holding short: on the connector centreline, 4 m behind the hold line, facing the runway. */
export const HOLD_SHORT: readonly (NamedPosition & { runway: '07' | '25' })[] = RUNWAY_CONNECTORS.map((c) => {
  const t = TAXIWAYS.find((s) => s.name === c.name)!;
  return { name: c.name, runway: c.runway, ...localToNed(t.a.u, HOLD_LINE_V - 4), heading: localHeading(0, 1) };
});

/** Runway line-up positions: on the centreline 20 m inside each threshold, facing the take-off direction. */
export const LINE_UP: readonly (NamedPosition & { runway: '07' | '25' })[] = [
  { name: 'RWY07', runway: '07', ...localToNed(-RUNWAY_HALF_LENGTH + 20, 0), heading: localHeading(1, 0) },
  { name: 'RWY25', runway: '25', ...localToNed(RUNWAY_HALF_LENGTH - 20, 0), heading: localHeading(-1, 0) },
];

// ---------------------------------------------------------------------------------------------------------------
// PAPI (AC 150/5345-28): four units on the left of each runway, abeam the point where a 3 degree path gives the
// design threshold crossing height; units 50 ft from the runway edge, 30 ft apart.

export const PAPI_GLIDE_PATH = 3 * DEG;
/** Threshold crossing height of the 3 degree path, m (40 ft, a typical small-aircraft value). */
export const PAPI_TCH = 40 * FT;
/** Unit setting angles, innermost (nearest the runway) first: 3.5, 3.1667, 2.8333, 2.5 degrees. */
export const PAPI_ANGLES = [3.5 * DEG, (3 + 10 / 60) * DEG, (2 + 50 / 60) * DEG, 2.5 * DEG];
export const PAPI_LIGHT_HEIGHT = 0.9;

export interface PapiUnit extends NedXY {
  u: number;
  v: number;
  /** Height of the light centre above the field, m. */
  height: number;
  /** Viewers below this elevation angle (rad) see red, above it white. */
  angle: number;
}
export interface Papi {
  runway: '07' | '25';
  /** Unit vector (local) from the lights toward the approaching aircraft. */
  facingU: 1 | -1;
  units: PapiUnit[];
}

export const PAPIS: readonly Papi[] = (['07', '25'] as const).map((runway) => {
  const end = runway === '07' ? -1 : 1; // which end of u the threshold is at
  const distance = PAPI_TCH / Math.tan(PAPI_GLIDE_PATH);
  const u = end * (RUNWAY_HALF_LENGTH - distance);
  // Left of the landing direction: landing on 07 heads +u so left is -v; landing on 25 heads -u so left is +v.
  const side = runway === '07' ? -1 : 1;
  const units = PAPI_ANGLES.map((angle, i) => {
    const v = side * (RUNWAY_HALF_WIDTH + 50 * FT + i * 30 * FT);
    return { u, v, ...localToNed(u, v), height: PAPI_LIGHT_HEIGHT, angle };
  });
  return { runway, facingU: (runway === '07' ? -1 : 1) as 1 | -1, units };
});

// ---------------------------------------------------------------------------------------------------------------
// Buildings and landside

export type BuildingKind = 'hangar' | 'tHangar' | 'terminal' | 'tower' | 'maintenance' | 'fuelFarm';

export interface BuildingFootprint extends LocalRect {
  name: string;
  kind: BuildingKind;
  /** Eave / roof height above the field, m. */
  height: number;
}

/** Front wall line of the buildings: on the apron edge so hangar doors open onto the pavement. */
const BUILDING_LINE = APRON_RECT.v0 - 0.2;

export const BUILDINGS: readonly BuildingFootprint[] = [
  { name: 'T-hangars', kind: 'tHangar', u0: APRON_RECT.u0 + 4, u1: APRON_RECT.u0 + 70, v0: BUILDING_LINE - 14, v1: BUILDING_LINE, height: 4.2 },
  { name: 'Hangar 1', kind: 'hangar', u0: -88, u1: -52, v0: BUILDING_LINE - 32, v1: BUILDING_LINE, height: 9.5 },
  { name: 'Terminal', kind: 'terminal', u0: -42, u1: 18, v0: BUILDING_LINE - 20, v1: BUILDING_LINE, height: 6.5 },
  { name: 'Tower', kind: 'tower', u0: 25, u1: 31, v0: BUILDING_LINE - 16, v1: BUILDING_LINE - 10, height: 17.5 },
  { name: 'Hangar 2', kind: 'hangar', u0: 44, u1: 86, v0: BUILDING_LINE - 34, v1: BUILDING_LINE, height: 11 },
  { name: 'Maintenance', kind: 'maintenance', u0: 96, u1: 132, v0: BUILDING_LINE - 26, v1: BUILDING_LINE, height: 8.5 },
  { name: 'Fuel farm', kind: 'fuelFarm', u0: 142, u1: 162, v0: BUILDING_LINE - 16, v1: BUILDING_LINE - 4, height: 3.2 },
];

export function buildingByName(name: string): BuildingFootprint {
  const b = BUILDINGS.find((x) => x.name === name);
  if (!b) throw new Error(`no building ${name}`);
  return b;
}

/** Control tower: cab floor height and the controller's eye height above the field, m. */
export const TOWER = (() => {
  const b = buildingByName('Tower');
  const u = (b.u0 + b.u1) / 2, v = (b.v0 + b.v1) / 2;
  return { u, v, ...localToNed(u, v), cabFloor: 14, eyeHeight: 15.7, roofHeight: b.height };
})();

/** Rotating aerodrome beacon on a lattice mast beside the fuel farm. */
export const BEACON = (() => {
  const u = APRON_RECT.u1 + 12, v = BUILDING_LINE - 22;
  return { u, v, ...localToNed(u, v), height: 18 };
})();

/** Perimeter fence (local rectangle). The terminal forms part of the line at `gate`. */
export const FENCE_RECT: LocalRect = { u0: -1000, u1: 1000, v0: BUILDING_LINE - 40, v1: 170 };

export const CAR_PARK: LocalRect = { u0: -50, u1: 26, v0: FENCE_RECT.v0 - 52, v1: FENCE_RECT.v0 - 6 };

/** Car park bay rows (v relative to CAR_PARK.v0): cars park facing +v (facing 1) or -v, bays 2.6 m x 5 m. */
export const CAR_BAY_WIDTH = 2.6;
export const CAR_PARK_ROWS: readonly { v0: number; v1: number; facing: 1 | -1 }[] = [
  { v0: 3, v1: 8, facing: -1 },
  { v0: 15, v1: 20, facing: 1 },
  { v0: 20, v1: 25, facing: -1 },
  { v0: 32, v1: 37, facing: 1 },
];

/** Access road: from the car park straight away from the runway to the edge of the flat airfield zone. */
export const ACCESS_ROAD = {
  width: 7,
  start: { u: (CAR_PARK.u0 + CAR_PARK.u1) / 2, v: CAR_PARK.v0 },
  end: { u: (CAR_PARK.u0 + CAR_PARK.u1) / 2, v: -RUNWAY_HALF_WIDTH - AIRPORT.flatMargin + 5 },
};

/** Apron floodlight masts along the building line, lighting the parking rows. */
export const FLOODLIGHTS: readonly (LocalXY & { height: number })[] = [-130, -60, 10, 80, 150].map((u) => ({
  u,
  v: APRON_RECT.v0 + 4,
  height: 14,
}));

/** Windsocks: the main one inside the segmented circle south of the runway, plus one near each touchdown zone. */
export const SEGMENTED_CIRCLE = { u: -120, v: 95, radius: 50 * FT };
export const WINDSOCKS: readonly (LocalXY & { main: boolean })[] = [
  { u: SEGMENTED_CIRCLE.u, v: SEGMENTED_CIRCLE.v, main: true },
  { u: -RUNWAY_HALF_LENGTH + 250, v: 60, main: false },
  { u: RUNWAY_HALF_LENGTH - 250, v: -60, main: false },
];

/** Everything built here must lie within this local rectangle (the terrain's flat zone). */
export const FLAT_ZONE: LocalRect = {
  u0: -RUNWAY_HALF_LENGTH - AIRPORT.flatMargin,
  u1: RUNWAY_HALF_LENGTH + AIRPORT.flatMargin,
  v0: -RUNWAY_HALF_WIDTH - AIRPORT.flatMargin,
  v1: RUNWAY_HALF_WIDTH + AIRPORT.flatMargin,
};
