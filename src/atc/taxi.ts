// The home field's taxi routes for its AI traffic (docs/atc.md, step 4): from a parking spot to the holding point of
// the runway in use and onto the runway, and from a runway exit to a spot. Routes are kept apart so that two AI
// aircraft never meet nose to nose on the single parallel taxiway Alpha: a departure from 07 leaves the apron by
// B1 and goes west to A1, while a landing on 07 vacates at A3 or A4 (east of B2) and comes in by B2; mirrored for 25.
// Only one AI aircraft moves on the apron at a time (TrafficSystem holds the others). Pure: NED points from the
// airport layout (world/airport/layout.ts).

import {
  APRON_RECT, APRON_TAXILANE_V, HOLD_LINE_V, localHeading, localToNed, nedToLocal, PARALLEL_TAXIWAY_V, PARKING, PARKING_SPOTS,
  RUNWAY_HALF_LENGTH, TAXIWAYS, type NedXY, type ParkingSpot,
} from '../world/airport/layout';
import { rng } from '../world/airport/noise';
import { staticParkedSpots } from '../world/airport/props';
import type { RunwayEnd } from './calls';

const taxiU = (name: string): number => TAXIWAYS.find((t) => t.name === name)!.a.u;

/** A departure's holding point and its link from the apron, by the runway end in use. */
export const DEPARTURE_ROUTE: Record<RunwayEnd, { hold: string; link: string }> = {
  0: { hold: 'A1', link: 'B1' },
  1: { hold: 'A4', link: 'B2' },
};
/** A landing's exits in the order the roll reaches them, and its link to the apron. */
export const ARRIVAL_ROUTE: Record<RunwayEnd, { exits: string[]; link: string }> = {
  0: { exits: ['A3', 'A4'], link: 'B2' },
  1: { exits: ['A2', 'A1'], link: 'B1' },
};

/** The holding point: 4 m behind the hold line on the connector. */
const HOLD_V = HOLD_LINE_V - 4;
/** Where a landed aircraft stops clear of the runway to call Ground, past the hold line. */
const CLEAR_V = HOLD_LINE_V - 14;

const ned = (u: number, v: number): NedXY => localToNed(u, v);

/** The radius a pilot rounds a taxiway corner off with, m: wider than the painted centreline's, inside the fillets. */
const TURN_RADIUS = 18;
/** Points per rounded corner. */
const ARC_POINTS = 8;

/**
 * The route with its corners rounded off: each corner between two straights becomes an arc of TURN_RADIUS (less where
 * the straights are short), so the aircraft stays central in the taxiway rather than turning on the spot at the
 * line's corner. The first point (reached from wherever the aircraft is) and the last are kept.
 */
export function roundCorners(points: readonly NedXY[], radius = TURN_RADIUS): NedXY[] {
  const out: NedXY[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], p = points[i], b = points[i + 1];
    const l1 = Math.hypot(p.north - a.north, p.east - a.east);
    const l2 = Math.hypot(b.north - p.north, b.east - p.east);
    const u1 = { n: (p.north - a.north) / l1, e: (p.east - a.east) / l1 };
    const u2 = { n: (b.north - p.north) / l2, e: (b.east - p.east) / l2 };
    const turn = Math.acos(Math.max(-1, Math.min(1, u1.n * u2.n + u1.e * u2.e)));
    if (turn < 0.05 || turn > 3) {
      out.push(p);
      continue;
    }
    // Where the arc leaves the first straight and joins the second, at most half way along either.
    const t = Math.min(radius * Math.tan(turn / 2), l1 / 2, l2 / 2);
    const from = { north: p.north - u1.n * t, east: p.east - u1.e * t };
    const to = { north: p.north + u2.n * t, east: p.east + u2.e * t };
    // A quadratic Bezier with the corner as its control point: tangent to both straights.
    for (let k = 0; k <= ARC_POINTS; k++) {
      const f = k / ARC_POINTS;
      const w0 = (1 - f) * (1 - f), w1 = 2 * f * (1 - f), w2 = f * f;
      out.push({ north: w0 * from.north + w1 * p.north + w2 * to.north, east: w0 * from.east + w1 * p.east + w2 * to.east });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Spot to holding point: out to the apron taxilane, along it to the link, down to Alpha, along to the holding point. */
export function taxiOutRoute(spot: ParkingSpot, end: RunwayEnd): NedXY[] {
  const { hold, link } = DEPARTURE_ROUTE[end];
  const l = taxiU(link);
  const h = taxiU(hold);
  return roundCorners([ned(spot.u, spot.v), ned(spot.u, APRON_TAXILANE_V), ned(l, APRON_TAXILANE_V), ned(l, PARALLEL_TAXIWAY_V), ned(h, PARALLEL_TAXIWAY_V), ned(h, HOLD_V)]);
}

/** On the apron or the link down to Alpha within `margin` of it, m (where one AI aircraft moves at a time). */
export function nearApron(north: number, east: number, margin = 0): boolean {
  return nedToLocal(north, east).v < APRON_RECT.v1 + margin;
}

/** Holding point onto the runway, lined up a little way in from the threshold. */
export function lineUpRoute(end: RunwayEnd): NedXY[] {
  const h = taxiU(DEPARTURE_ROUTE[end].hold);
  const dir = end === 0 ? 1 : -1;
  return roundCorners([ned(h, HOLD_V), ned(h, 0), ned(h + dir * 40, 0)]);
}

/** The take-off heading from a runway end, rad. */
export function runwayHeading(end: RunwayEnd): number {
  return localHeading(end === 0 ? 1 : -1, 0);
}

/** The exit a landing rolling at `u` (layout frame) toward `end`'s far end turns off at: the first ahead it can make. */
export function arrivalExit(end: RunwayEnd, north: number, east: number): string {
  const { u } = nedToLocal(north, east);
  const dir = end === 0 ? 1 : -1;
  const exits = ARRIVAL_ROUTE[end].exits;
  return exits.find((e) => (taxiU(e) - u) * dir > 30) ?? exits[exits.length - 1];
}

/** From where it is on the runway, off at the exit, to a stop just past the hold line. */
export function vacateRoute(exit: string, from: NedXY): NedXY[] {
  const x = taxiU(exit);
  return roundCorners([from, ned(x, 0), ned(x, CLEAR_V)]);
}

/** From clear of the runway to a spot: Alpha to the link, up to the apron taxilane, along it, into the spot. */
export function taxiInRoute(exit: string, end: RunwayEnd, spot: ParkingSpot): NedXY[] {
  const x = taxiU(exit);
  const l = taxiU(ARRIVAL_ROUTE[end].link);
  return roundCorners([ned(x, CLEAR_V), ned(x, PARALLEL_TAXIWAY_V), ned(l, PARALLEL_TAXIWAY_V), ned(l, APRON_TAXILANE_V), ned(spot.u, APRON_TAXILANE_V), ned(spot.u, spot.v)]);
}

/** The parking spots the traffic may use: those the scenery's parked aircraft leave free, never the player's own. */
export function freeSpots(): readonly ParkingSpot[] {
  if (!spots) {
    const taken = staticParkedSpots();
    const mine = nedToLocal(PARKING.north, PARKING.east);
    spots = PARKING_SPOTS.filter((s) => !taken.has(s.name) && Math.hypot(s.u - mine.u, s.v - mine.v) > 1);
  }
  return spots;
}
let spots: readonly ParkingSpot[] | null = null;

/** On the runway: within its edges (and a margin) and its ends. */
export function onRunway(north: number, east: number): boolean {
  const { u, v } = nedToLocal(north, east);
  return Math.abs(v) < 25 && Math.abs(u) < RUNWAY_HALF_LENGTH + 30;
}

/** A small seeded random stream: the traffic's choices are the same each run. */
export const seededRandom = rng;
