// The Career's cost and planning arithmetic (docs/career.md "Dispatch and the load sheet", "Pay", "Settlement"):
// fuel price by grade and field, landing fees, hourly rates, the wind components, ground speed, the fuel plan
// (trip, climb, taxi, reserve, required), flight time and block hours, uplift and defuel, the pay (formula, floor
// and the $5 rounding) and the insurance excess. Pure numbers in and out: jobs.ts (pay), loadsheet.ts (the
// dispatch sheet), economy.ts (settlement) and fit.ts all compute with these, so a figure means the same everywhere.
//
// Planning is deliberately simple (a game's dispatch, not a flight planner): ground speed is the cruise TAS less
// the headwind component along the track (no crosswind correction), never below DEADLINE_RULES.minGsFraction of the
// TAS; a scenic loop is flown into and out of the wind alike, so it takes off loopWindFactor x the wind speed.
// Money helpers named "...Cost", "...Fee", "...Credit", "...Excess", payFloor and offerPay return whole dollars
// (every money line is rounded); payFormula and the planning quantities (kg, min, h, kt) are left unrounded.

import type { AirfieldKind } from '../world/airfields';
import { isRotorcraftClass } from './perf';
import {
  CLASS_RULES, DEADLINE_RULES, DEFUEL_RULES, FUEL_PLAN_RULES, FUEL_RULES, LANDING_FEES, PAY_FLOOR, PAY_RULES,
  RESERVE_MIN, RESERVE_MIN_HELI, SCORING_RULES, TAXI_FUEL_MIN, WEATHER_PAY, type AircraftClass, type CareerPerf,
  type CareerWeatherId, type FuelGrade, type JobKind, type Tenure,
} from './types';

/** Where fuel is bought or a landing fee paid: an airfield's kind, or (wave 4) an off-field helicopter site. */
export type PlaceKind = AirfieldKind | 'site';

/** Departure and arrival allowance added to the airborne time at cruise ground speed, min. */
export const FLIGHT_TIME_ALLOWANCE_MIN = 10;

// --------------------------------------------------------------------------------------------- fuel price

/** True when the place sells this grade itself (sealed fields and home: both; grass: avgas only; sites: none). */
export function sellsGrade(place: PlaceKind, grade: FuelGrade): boolean {
  if (place === 'site') return false;
  return place === 'grass' ? grade === 'avgas' : true;
}

/** Fuel price at a place, $ per kg (unrounded), and whether it comes by fuel truck (FUEL_RULES: grass +10 %, truck +50 %). */
export function fuelPricePerKg(grade: FuelGrade, place: PlaceKind): { perKg: number; truck: boolean } {
  const base = FUEL_RULES.pricePerL[grade] / FUEL_RULES.densityKgL[grade];
  if (!sellsGrade(place, grade)) return { perKg: base * (1 + FUEL_RULES.truckSurcharge), truck: true };
  return { perKg: place === 'grass' ? base * (1 + FUEL_RULES.grassSurcharge) : base, truck: false };
}

/** The grade's list price with no surcharge, $ per kg (the pay floor and the defuel credit use it). */
export function basePricePerKg(grade: FuelGrade): number {
  return FUEL_RULES.pricePerL[grade] / FUEL_RULES.densityKgL[grade];
}

/** Cost of `kg` of fuel bought at a place, whole $ (a fuel truck's surcharge included). */
export function fuelCost(kg: number, grade: FuelGrade, place: PlaceKind): number {
  return Math.round(Math.max(0, kg) * fuelPricePerKg(grade, place).perKg);
}

/** Credit for `kg` of fuel drained, whole $: DEFUEL_RULES.creditFraction of its list price. */
export function defuelCredit(kg: number, grade: FuelGrade): number {
  return Math.round(Math.max(0, kg) * basePricePerKg(grade) * DEFUEL_RULES.creditFraction);
}

/** Fuel to buy and to drain for a wanted load, kg: uplift = wanted less aboard, defuel = the reverse, neither below 0. */
export function upliftAndDefuel(wantedKg: number, aboardKg: number): { upliftKg: number; defuelKg: number } {
  return { upliftKg: Math.max(0, wantedKg - aboardKg), defuelKg: Math.max(0, aboardKg - wantedKg) };
}

// --------------------------------------------------------------------------------------------- fees, rates

/** Landing fee at a place for a type of `mtowKg`, whole $ (LANDING_FEES: flat + per tonne of MTOW). */
export function landingFee(place: PlaceKind, mtowKg: number): number {
  const f = LANDING_FEES[place];
  return Math.round(f.flat + f.perTonne * (mtowKg / 1000));
}

/** The type's cost per block hour for the company, $ (owned: CareerPerf.ownedHourly; leased: leaseHourly), fuel excluded. */
export function hourlyRate(perf: CareerPerf, tenure: Tenure): number {
  return tenure === 'owned' ? perf.ownedHourly : perf.leaseHourly;
}

/** Aircraft hours cost of `blockH` block hours, whole $. */
export function hoursCost(blockH: number, perf: CareerPerf, tenure: Tenure): number {
  return Math.round(Math.max(0, blockH) * hourlyRate(perf, tenure));
}

/** Insurance excess after a crash, owned or leased, whole $: excessFraction of the list price within [excessMin, excessMax]. */
export function insuranceExcess(perf: CareerPerf): number {
  const S = SCORING_RULES;
  return Math.round(Math.min(S.excessMax, Math.max(S.excessMin, S.excessFraction * perf.listPrice)));
}

// --------------------------------------------------------------------------------------------- wind, speed, time

/** Normalise an angle to [0, 360) deg. */
function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Wind components on a track, kt: `headwind` (negative: a tailwind) and `crosswind` (unsigned). `windFromDeg` is
 * the direction the wind blows from, true, as JobOffer.windDirDeg; `trackDeg` the direction flown, true.
 */
export function windComponents(trackDeg: number, windFromDeg: number, windKt: number): { headwind: number; crosswind: number } {
  const a = (wrap360(windFromDeg - trackDeg) * Math.PI) / 180;
  return { headwind: windKt * Math.cos(a), crosswind: Math.abs(windKt * Math.sin(a)) };
}

/** True bearing from one NED point to another, deg [0, 360) (x north, y east, as Airfield north / east). */
export function bearingDeg(from: { north: number; east: number }, to: { north: number; east: number }): number {
  return wrap360((Math.atan2(to.east - from.east, to.north - from.north) * 180) / Math.PI);
}

/** A route for the wind: one leg flown on a track (deg true), or a loop (a scenic flight, round and back). */
export type RouteWind = { kind: 'leg'; trackDeg: number } | { kind: 'loop' };

/**
 * Planning ground speed, kt: `tasKt` less the headwind component along a leg (or loopWindFactor x the wind speed
 * on a loop), at least minGsFraction x tasKt (DEADLINE_RULES; the deadline uses the same rule on the class's refTas).
 */
export function groundSpeedKt(tasKt: number, route: RouteWind, windFromDeg: number, windKt: number): number {
  const head = route.kind === 'loop' ? windKt * DEADLINE_RULES.loopWindFactor : windComponents(route.trackDeg, windFromDeg, windKt).headwind;
  return Math.max(tasKt - head, tasKt * DEADLINE_RULES.minGsFraction);
}

/** Planned flight time, min: airborne at ground speed plus FLIGHT_TIME_ALLOWANCE_MIN for departure and arrival. */
export function flightTimeMin(distanceNm: number, gsKt: number): number {
  return (60 * distanceNm) / gsKt + FLIGHT_TIME_ALLOWANCE_MIN;
}

/** Estimated block hours, h: the flight time plus the class's start, taxi and shutdown allowance (CLASS_RULES.taxiMin). */
export function blockHours(flightMin: number, cls: AircraftClass): number {
  return (flightMin + CLASS_RULES[cls].taxiMin) / 60;
}

// --------------------------------------------------------------------------------------------- fuel plan

/** The dispatch fuel plan, kg (docs/career.md): what each part burns at the type's planning flow. */
export interface FuelPlan {
  /** distance / ground speed x flow. */
  tripKg: number;
  /** FUEL_PLAN_RULES.climbMin of flow. */
  climbKg: number;
  /** TAXI_FUEL_MIN of flow. */
  taxiKg: number;
  /** RESERVE_MIN (helicopters RESERVE_MIN_HELI) of flow. */
  reserveKg: number;
  /** tripFactor x trip + climb + taxi + reserve. */
  requiredKg: number;
}

/** Planning reserve of a type, min of cruise flow (aeroplanes RESERVE_MIN, helicopters RESERVE_MIN_HELI). */
export function reserveMin(perf: CareerPerf): number {
  return isRotorcraftClass(perf.cls) ? RESERVE_MIN_HELI : RESERVE_MIN;
}

/** The fuel plan of a type for `distanceNm` at `gsKt` ground speed. */
export function fuelPlan(perf: CareerPerf, distanceNm: number, gsKt: number): FuelPlan {
  const perMin = perf.fuelFlowKgH / 60;
  const tripKg = (distanceNm / gsKt) * perf.fuelFlowKgH;
  const climbKg = FUEL_PLAN_RULES.climbMin * perMin;
  const taxiKg = TAXI_FUEL_MIN * perMin;
  const reserveKg = reserveMin(perf) * perMin;
  return { tripKg, climbKg, taxiKg, reserveKg, requiredKg: FUEL_PLAN_RULES.tripFactor * tripKg + climbKg + taxiKg + reserveKg };
}

/** Fuel the plan expects to burn (everything but the reserve), kg: tripFactor x trip + climb + taxi. */
export function burnKg(plan: FuelPlan): number {
  return plan.requiredKg - plan.reserveKg;
}

/** Endurance of `fuelKg` at the type's cruise flow, min. */
export function enduranceMin(perf: CareerPerf, fuelKg: number): number {
  return (Math.max(0, fuelKg) / perf.fuelFlowKgH) * 60;
}

// --------------------------------------------------------------------------------------------- pay

/**
 * The pay floor of an offer for its reference type, whole $ (before jobs.ts's $5 rounding): PAY_FLOOR.costFactor x
 * (block hours x leaseHourly + the planned burn's cost at the grade's list price) x `floorPremium` (the kind's
 * PAY_RULES floorPremium; 1 for the bare floor), the planned burn being tripFactor x trip + climb + taxi.
 * docs/career.md's example: a C152 charter of 20 NM in calm air at the doc's planning figures (100 kt, 17 kg/h):
 * 1.3 x (0.78 h x $120 + $25) x 1.15 = $178.
 */
export function payFloor(ref: CareerPerf, distanceNm: number, gsKt: number, floorPremium = 1): number {
  const block = blockHours(flightTimeMin(distanceNm, gsKt), ref.cls);
  const fuel = burnKg(fuelPlan(ref, distanceNm, gsKt)) * basePricePerKg(ref.fuel);
  return Math.round(PAY_FLOOR.costFactor * (block * ref.leaseHourly + fuel) * floorPremium);
}

/**
 * An offer's pay by the formula, $ (unrounded): (base + perNm x d + perPax x pax + perKg x cargoKg) x the least
 * class's payMult x the weather's mult x `premiumMult` (PREMIUM_RULES.payMult for a regular client's job, else 1),
 * with PAY_RULES of the kind. docs/career.md's example: a trainer charter, 1 passenger, 20 NM, clear: $280.
 */
export function payFormula(kind: JobKind, distanceNm: number, pax: number, cargoKg: number, minClass: AircraftClass, weather: CareerWeatherId, premiumMult = 1): number {
  const r = PAY_RULES[kind];
  return (r.base + r.perNm * distanceNm + r.perPax * pax + r.perKg * cargoKg) * CLASS_RULES[minClass].payMult * WEATHER_PAY[weather].mult * premiumMult;
}

/** An offer's pay, whole $: the formula or the floor (payFloor with the kind's floorPremium), whichever is more, rounded to $5. */
export function offerPay(formulaUsd: number, floorUsd: number): number {
  return Math.round(Math.max(formulaUsd, floorUsd) / 5) * 5;
}
