// The home field's taxi routes for its AI traffic (docs/atc.md, step 4): from a parking spot to the holding point of
// the runway in use and onto the runway, and from a runway exit to a spot. Routes are kept apart so that two AI
// aircraft never meet nose to nose on the single parallel taxiway Alpha: a departure from 07 leaves the apron by
// B1 and goes west to A1, while a landing on 07 vacates at A3 or A4 (east of B2) and comes in by B2; mirrored for 25.
// Only one AI aircraft moves on the apron at a time (TrafficSystem holds the others). Pure: NED points from the
// airport layout (world/airport/layout.ts).

import {
  APRON_TAXILANE_V, HOLD_LINE_V, localHeading, localToNed, nedToLocal, PARALLEL_TAXIWAY_V, PARKING, PARKING_SPOTS,
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

/** Spot to holding point: out to the apron taxilane, along it to the link, down to Alpha, along to the holding point. */
export function taxiOutRoute(spot: ParkingSpot, end: RunwayEnd): NedXY[] {
  const { hold, link } = DEPARTURE_ROUTE[end];
  const l = taxiU(link);
  const h = taxiU(hold);
  return [ned(spot.u, APRON_TAXILANE_V), ned(l, APRON_TAXILANE_V), ned(l, PARALLEL_TAXIWAY_V), ned(h, PARALLEL_TAXIWAY_V), ned(h, HOLD_V)];
}
/** taxiOutRoute's waypoint at which the aircraft is back on Alpha, off the apron. */
export const TAXI_OUT_OFF_APRON = 3;

/** Holding point onto the runway, lined up a little way in from the threshold. */
export function lineUpRoute(end: RunwayEnd): NedXY[] {
  const h = taxiU(DEPARTURE_ROUTE[end].hold);
  const dir = end === 0 ? 1 : -1;
  return [ned(h, -10), ned(h + dir * 14, -1), ned(h + dir * 35, 0)];
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

/** Off the runway at the exit, to a stop just past the hold line. */
export function vacateRoute(exit: string): NedXY[] {
  const x = taxiU(exit);
  return [ned(x, 0), ned(x, -20), ned(x, CLEAR_V)];
}

/** From clear of the runway to a spot: Alpha to the link, up to the apron taxilane, along it, into the spot. */
export function taxiInRoute(exit: string, end: RunwayEnd, spot: ParkingSpot): NedXY[] {
  const x = taxiU(exit);
  const l = taxiU(ARRIVAL_ROUTE[end].link);
  return [ned(x, PARALLEL_TAXIWAY_V), ned(l, PARALLEL_TAXIWAY_V), ned(l, APRON_TAXILANE_V), ned(spot.u, APRON_TAXILANE_V), ned(spot.u, spot.v)];
}
/** taxiInRoute's waypoint from which the aircraft is on the apron (it waits for it to be clear before going on). */
export const TAXI_IN_ON_APRON = 2;

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
