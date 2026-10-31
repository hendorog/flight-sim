// Where the Career seats the pilot and stows a job's payload in each type (docs/career.md "Stations and
// positions"): literal body-axis positions per type, the seat count of each seat station, the fuel's centroid, the
// station assignment for a job's payload (assignStations) and the take-off CG (cgOf).
//
// Positions are reference-point body axes of the type's definition (x forward, y right, z down, m), written as
// literals: this module imports no aircraft module (each type is a lazy chunk). tests/career/stations.test.ts loads
// every definition and proves each position that the definition holds equal to it (1e-9): the pilot sits where
// the type's own solo or crew loading puts the pilot (R22_SOLO, R44_SOLO (the right seat), S269_SOLO (PILOT_SEAT),
// MD500_SOLO, the Bo 105's bo105Payload seat 1 (the right seat), the aeroplanes' left front seat: their crew
// centroid at -seatY), the front passenger in the other front seat, and the rear, cabin and cargo stations at the
// seats and compartments the definitions use (the C172S's rear seats, the C152's baggage area, the C208's and
// PC-12's cabin centroids, the R44's and MD 500's aft seats, the Bo 105's rear bench and cargo compartment). The
// stations the definitions do not hold are ESTIMATES from the POH arms, marked below; the test checks them only
// for being inside the airframe's length. `fuel` is the tanks' capacity-weighted centroid (every tank holds the
// same fraction: the Career fuels by `ic.fuelFraction`), so it places any fuel load exactly.
//
// assignStations is the one seating rule: passengers (and patients) first, front, then rear, then cabin (patients
// cabin first); then bags, freight, mail and equipment: baggage, then cargo, then a free seat (rear, cabin, then
// the seat beside the pilot), each item whole (never split) up to the station's stationMaxKg (src/career/perf.ts)
// and a seat station's free seats (a freight item on a seat takes the seat).

import type { Vec3 } from '../core/math';
import { CAREER_PERF } from './perf';
import { OCCUPANT_KG, type CareerAircraftId, type OfferItem, type PayloadItem, type PayloadKind, type Station } from './types';

/** One type's seating and stowage. */
export interface CareerStationSet {
  /** The pilot's seat (OCCUPANT_KG there), body axes, m. */
  pilot: Vec3;
  /** Each station the type has, body axes, m (a station with several seats: their centroid). */
  stations: Partial<Readonly<Record<Station, Vec3>>>;
  /** Passenger seats of each seat station (front, rear, cabin); they sum to CareerPerf.paxSeats. */
  seats: Partial<Readonly<Record<Station, number>>>;
  /** Centroid of the usable fuel (tanks weighted by capacity), body axes, m. */
  fuel: Vec3;
}

/** Seats and stations per type (docs/career.md "Stations and positions"). */
export const CAREER_STATIONS: Readonly<Record<CareerAircraftId, CareerStationSet>> = {
  c152: {
    // The seats at FS 39, either side at the pilot eye's 0.24 m; baggage area 1, FS 64 (c152/systems.ts).
    pilot: { x: -0.1397, y: -0.24, z: 0.13 },
    stations: { front: { x: -0.1397, y: 0.24, z: 0.13 }, baggage: { x: -0.7747, y: 0, z: 0.23 } },
    seats: { front: 1 },
    fuel: { x: -0.22, y: 0, z: -0.64 },
  },
  pa38: {
    // The seats at STA 85.5, WL 40 (pa38/systems.ts). Baggage: ESTIMATE, the shelf at STA 115 (POH fig 6-14), at the
    // seats' height.
    pilot: { x: -0.20955, y: -0.27, z: -0.0889 },
    stations: { front: { x: -0.20955, y: 0.27, z: -0.0889 }, baggage: { x: -0.95885, y: 0, z: -0.0889 } },
    seats: { front: 1 },
    fuel: { x: 0.047, y: 0, z: 0.29 },
  },
  da20: {
    // The seats 0.143 m aft of RD (da20/systems.ts). Baggage: ESTIMATE, AFM 6 arm 0.824 m aft of RD, at the seats'
    // height.
    pilot: { x: 0.1545, y: -0.27, z: 0.01 },
    stations: { front: { x: 0.1545, y: 0.27, z: 0.01 }, baggage: { x: -0.5265, y: 0, z: 0.01 } },
    seats: { front: 1 },
    fuel: { x: -0.5265, y: 0, z: 0.18 },
  },
  c172s: {
    // The front seats at core/c172.ts crewPos; the rear seats at REAR_X (the `aft` loading); the bags 1.3 m behind
    // the front seats (the `typical` loading).
    pilot: { x: -0.1, y: -0.27, z: -0.05 },
    stations: {
      front: { x: -0.1, y: 0.27, z: -0.05 },
      rear: { x: -0.8, y: 0, z: -0.05 },
      baggage: { x: -1.4, y: 0, z: -0.05 },
    },
    seats: { front: 1, rear: 2 },
    fuel: { x: 0, y: 0, z: -0.62 },
  },
  pa34: {
    // The front seats at arm 85.5 in (pa34/systems.ts). Cabin: ESTIMATE, the centroid of the centre row (118.1 in,
    // the definition's) and the rear row (155.7 in, weight and balance report VB-424): 136.9 in. Baggage: ESTIMATE,
    // the forward (22.5 in) and aft (178.7 in) compartments taken half each: 100.6 in.
    pilot: { x: 0.21971, y: -0.28, z: -0.03 },
    stations: {
      front: { x: 0.21971, y: 0.28, z: -0.03 },
      cabin: { x: -1.08585, y: 0, z: -0.03 },
      baggage: { x: -0.16383, y: 0, z: -0.03 },
    },
    seats: { front: 1, cabin: 4 },
    fuel: { x: 0.01397, y: 0, z: 0.02 },
  },
  c208: {
    // The crew seats and the cabin centroid of c208/systems.ts. Cargo pod: ESTIMATE, under the cabin, 0.575 m below
    // the cabin centroid (the pod's four bays span the cabin's length).
    pilot: { x: 1.25, y: -0.38, z: 0.375 },
    stations: {
      front: { x: 1.25, y: 0.38, z: 0.375 },
      cabin: { x: -1.2, y: 0, z: 0.475 },
      cargo: { x: -1.2, y: 0, z: 1.05 },
    },
    seats: { front: 1, cabin: 8 },
    fuel: { x: -0.05, y: 0, z: -0.895 },
  },
  pc12: {
    // The pilot arm and the cabin centroid (station 7.0) of pc12/systems.ts. Aft cargo area: ESTIMATE, station 8.9
    // (behind the last seat row, which ends at 344 in = 8.74 m), at the cabin's height.
    pilot: { x: 1.929142, y: -0.4, z: -0.19 },
    stations: {
      front: { x: 1.929142, y: 0.4, z: -0.19 },
      cabin: { x: -1, y: 0, z: -0.19 },
      cargo: { x: -2.9, y: 0, z: -0.19 },
    },
    seats: { front: 1, cabin: 8 },
    fuel: { x: 0.14, y: 0, z: 0.3 },
  },
  r22: {
    // R22_SOLO: the pilot in the right seat (BL +10.7 in); the left seat at BL -9.3 in (the two-seat crew loading's
    // centroid, +0.7 in). Baggage: ESTIMATE, the under-seat compartments, 0.3 m below the seated occupants.
    pilot: { x: 0.5588, y: 0.27178, z: 0 },
    stations: { front: { x: 0.5588, y: -0.23622, z: 0 }, baggage: { x: 0.5588, y: 0, z: 0.3 } },
    seats: { front: 1 },
    fuel: { x: -0.174864, y: -0.077861, z: -0.1 },
  },
  s269: {
    // S269_SOLO: the pilot in SEAT_CENTRES[PILOT_SEAT] (the right seat); the passenger in the left. Baggage:
    // ESTIMATE, the compartment behind and below the seats.
    pilot: { x: 0.42672, y: 0.32512, z: 0.05 },
    stations: { front: { x: 0.42672, y: -0.35052, z: 0.05 }, baggage: { x: 0.2, y: 0, z: 0.3 } },
    seats: { front: 1 },
    fuel: { x: -0.2159, y: -0.4318, z: -0.1 },
  },
  r44: {
    // R44_SOLO: the pilot in the front right seat (SEAT_CENTRES[1]); the front left seat; the rear seats' centroid.
    // Baggage: ESTIMATE, the under-seat compartments of the front seats (POH 6-4), 0.3 m below the occupants.
    pilot: { x: 1.2827, y: 0.30988, z: 0.1 },
    stations: {
      front: { x: 1.2827, y: -0.26416, z: 0.1 },
      rear: { x: 0.5207, y: 0, z: 0.1 },
      baggage: { x: 1.2827, y: 0, z: 0.4 },
    },
    seats: { front: 1, rear: 2 },
    fuel: { x: -0.115256, y: -0.09682, z: -0.1 },
  },
  md500: {
    // MD500_SOLO: the pilot in MD500_SEATS[0] (front left, the command seat); the front right seat; the aft seats'
    // centroid. Baggage: ESTIMATE, under the aft seats, 0.33 m below the occupants.
    pilot: { x: 0.6731, y: -0.3302, z: -0.02428 },
    stations: {
      front: { x: 0.6731, y: 0.3937, z: -0.02428 },
      cabin: { x: -0.127, y: 0, z: -0.02428 },
      baggage: { x: -0.127, y: 0, z: 0.3 },
    },
    seats: { front: 1, cabin: 3 },
    fuel: { x: 0.05842, y: 0, z: 0.66152 },
  },
  bo105: {
    // bo105Payload: the pilot in BO105_SEATS[0] (front right); the front left seat; the rear bench's centre
    // (BO105_SEATS[3], the three seats' centroid); the cargo compartment (BO105_SEATS[5]).
    pilot: { x: 1.3, y: 0.36, z: 0.77 },
    stations: {
      front: { x: 1.3, y: -0.36, z: 0.77 },
      cabin: { x: 0.53, y: 0, z: 0.84 },
      cargo: { x: -1.05, y: 0, z: 0.89 },
    },
    seats: { front: 1, cabin: 3 },
    fuel: { x: -0.321491, y: 0, z: 1.44 },
  },
};

/** Seat stations in the order passengers fill them. */
const PASSENGER_ORDER: readonly Station[] = ['front', 'rear', 'cabin'];
/** Patients (wave 4) lie in the cabin first. */
const PATIENT_ORDER: readonly Station[] = ['cabin', 'rear', 'front'];
/** Bags, freight, mail and equipment: the holds, then a free seat (the one beside the pilot last). */
const STOWAGE_ORDER: readonly Station[] = ['baggage', 'cargo', 'rear', 'cabin', 'front'];

/** Kinds that take a seat as a person. */
function seated(kind: PayloadKind): boolean {
  return kind === 'passenger' || kind === 'patient';
}

/** Why a payload does not fit a type: no free seat for a person ('seats'), or no station left with room ('stationLimit'). */
export type StationRefusal = 'seats' | 'stationLimit';

/** assignStations's answer: every item with its station (in the offer's order), or the first item that does not fit. */
export type StationAssignment =
  | { ok: true; items: PayloadItem[] }
  | { ok: false; code: StationRefusal; item: OfferItem; index: number };

/**
 * Seat and stow a job's payload in a type (docs/career.md): passengers (and patients) first in the offer's order,
 * then everything else in the offer's order, each item whole to the first station in its order with room under
 * stationMaxKg (kg) and, for a seat station, a free seat. A person with no free seat anywhere is refused 'seats';
 * one whose free seats are all too full by mass, and any other item with nowhere to go, 'stationLimit'. Items are
 * returned in the offer's order.
 */
export function assignStations(items: readonly OfferItem[], type: CareerAircraftId): StationAssignment {
  const set = CAREER_STATIONS[type];
  const limits = CAREER_PERF[type].stationMaxKg;
  const kg: Partial<Record<Station, number>> = {};
  const used: Partial<Record<Station, number>> = {};
  const out: (PayloadItem | undefined)[] = items.map(() => undefined);
  const has = (s: Station) => set.stations[s] !== undefined && limits[s] !== undefined;
  const seatFree = (s: Station) => (used[s] ?? 0) < (set.seats[s] ?? 0);
  const room = (s: Station, m: number) => (kg[s] ?? 0) + m <= (limits[s] ?? 0);
  const isSeat = (s: Station) => (set.seats[s] ?? 0) > 0;
  const place = (i: number, s: Station) => {
    kg[s] = (kg[s] ?? 0) + items[i].kg;
    if (isSeat(s)) used[s] = (used[s] ?? 0) + 1;
    out[i] = { ...items[i], station: s };
  };

  const people = items.map((_, i) => i).filter((i) => seated(items[i].kind));
  const goods = items.map((_, i) => i).filter((i) => !seated(items[i].kind));
  for (const i of people) {
    const order = items[i].kind === 'patient' ? PATIENT_ORDER : PASSENGER_ORDER;
    const free = order.filter((s) => has(s) && seatFree(s));
    const s = free.find((st) => room(st, items[i].kg));
    if (s === undefined) return { ok: false, code: free.length === 0 ? 'seats' : 'stationLimit', item: items[i], index: i };
    place(i, s);
  }
  for (const i of goods) {
    const s = STOWAGE_ORDER.find((st) => has(st) && (!isSeat(st) || seatFree(st)) && room(st, items[i].kg));
    if (s === undefined) return { ok: false, code: 'stationLimit', item: items[i], index: i };
    place(i, s);
  }
  return { ok: true, items: out as PayloadItem[] };
}

/**
 * Take-off CG of a type, body x m (the definition's frame, + forward): the empty airframe at CareerPerf.cg.emptyX,
 * the pilot (OCCUPANT_KG) at the pilot's seat, each item at its station and `fuelKg` of fuel at the tanks'
 * centroid. Throws on an item whose station the type does not have.
 */
export function cgOf(type: CareerAircraftId, items: readonly PayloadItem[], fuelKg: number): number {
  const perf = CAREER_PERF[type];
  const set = CAREER_STATIONS[type];
  let mass = perf.emptyKg + OCCUPANT_KG + fuelKg;
  let moment = perf.emptyKg * perf.cg.emptyX + OCCUPANT_KG * set.pilot.x + fuelKg * set.fuel.x;
  for (const it of items) {
    const p = set.stations[it.station];
    if (!p) throw new Error(`cgOf: the ${type} has no ${it.station} station`);
    mass += it.kg;
    moment += it.kg * p.x;
  }
  return moment / mass;
}
