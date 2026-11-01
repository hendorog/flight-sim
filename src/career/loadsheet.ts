// The dispatch load sheet (docs/career.md "Dispatch and the load sheet"): for one offer, one aircraft of the fleet
// and a fuel choice, the masses, the take-off CG, the fuel plan, the fuel to buy or drain and its cost or credit,
// the wind components, the time estimates, the estimated costs and net, and the warnings. Blocking codes disable
// Accept; warning codes are shown and Accept stays allowed.
//
// Pure: the save, the aircraft and the fields (src/world/airfields.ts airfields() in the game, synthetic ones in
// tests) are passed in, and every figure comes from 1a's helpers (src/career/costs.ts for the arithmetic,
// src/career/stations.ts for the seating and CG, src/career/fit.ts for the plan in the offer's wind) so the board,
// the sheet and the settlement mean the same thing by each number. fitOffer is called too and its code always
// appears on the sheet, so a load the board calls unfit is never dispatchable (jobs.test relies on that); the
// sheet adds its own checks at the chosen fuel (overMtow above MTOW at that fuel) and checks both runway ends.
//
// Blocking: notHere, grounded, rating, class / heliOnly / fixedWingOnly, reputation, seats, stationLimit, overMtow,
// fuelShort, fuelOverCapacity, runwayShort, grass, lateInDay, cash. Warnings: cg (outside the type's own forward and
// aft loadings, which are example loadings and not the POH envelope), overMlw, deadlineTight, weather, crosswind,
// fuelTruck, losesMoney. 'cash' needs fuel to buy: a sheet that buys none asks nothing of the overdraft. When the
// payload cannot be seated (seats, stationLimit) the sheet lists no items and its CG is that of the empty aircraft,
// pilot and fuel alone (no 'cg' warning: Accept is blocked anyway).

import type { Airfield } from '../world/airfields';
import {
  blockHours, defuelCredit as defuelCreditUsd, enduranceMin as enduranceAt, flightTimeMin as flightTimeAt, fuelCost as fuelCostUsd,
  fuelPricePerKg, hoursCost as hoursCostUsd, landingFee, upliftAndDefuel, windComponents, type PlaceKind,
} from './costs';
import { fitOffer, offerFuelPlan, offerGroundSpeedKt, routeWindOf } from './fit';
import { CAREER_PERF, isRotorcraftClass } from './perf';
import { assignStations, cgOf } from './stations';
import {
  CLASS_RULES, CLOCK_RULES, DEADLINE_RULES, FIXED_WING_CLASS_ORDER, OCCUPANT_KG, ROTORCRAFT_CLASS_ORDER, START_RULES,
  type AircraftClass, type CareerAircraftId, type CareerSave, type FleetAircraft, type JobOffer, type JobPlace,
  type LoadSheet, type LoadSheetCode, type LoadSheetWarning, type PayloadItem,
} from './types';

/** A deadline margin below this warns 'deadlineTight', min. */
export const DEADLINE_TIGHT_MIN = 5;
/** Job weather a trainer is warned about ('weather'). */
const TRAINER_WEATHER_WARN: readonly string[] = ['gusty', 'rain'];
/** Slack on the mass and fuel comparisons, kg (floating point only: a figure equal to its limit is allowed). */
const EPS_KG = 1e-9;
/** Slack on the CG comparison, m. */
const EPS_M = 1e-9;

/** The field with this code; throws if absent (an offer always names fields of its world). */
function fieldOf(code: string, fields: readonly Airfield[]): Airfield {
  const f = fields.find((x) => x.code === code);
  if (!f) throw new Error(`loadSheet: no field ${code}`);
  return f;
}

/** The place kind of a job end, for fees and fuel. */
function placeKind(p: JobPlace, fields: readonly Airfield[]): PlaceKind {
  return p.kind === 'site' ? 'site' : fieldOf(p.code, fields).kind;
}

/** A class's family (aeroplanes or helicopters) and its rank in it. */
function classRank(cls: AircraftClass): { rotor: boolean; rank: number } {
  const rotor = isRotorcraftClass(cls);
  return { rotor, rank: rotor ? (ROTORCRAFT_CLASS_ORDER as readonly AircraftClass[]).indexOf(cls) : (FIXED_WING_CLASS_ORDER as readonly AircraftClass[]).indexOf(cls) };
}

/** The runway refusal at one end for a type (as fitOffer's rule), or null: a site, or a field it may use. */
function runwayCode(place: JobPlace, type: CareerAircraftId, fields: readonly Airfield[]): 'runwayShort' | 'grass' | null {
  if (place.kind === 'site') return null;
  const perf = CAREER_PERF[type];
  const f = fieldOf(place.code, fields);
  if (f.length < perf.minRunwayM) return 'runwayShort';
  if (f.kind === 'grass' && !perf.grassOk) return 'grass';
  return null;
}

/** Crosswind on a field's runway, kt (Airfield.heading is rad; either end gives the same unsigned figure). */
function runwayCrosswindKt(f: Airfield, windFromDeg: number, windKt: number): number {
  return windComponents((f.heading * 180) / Math.PI, windFromDeg, windKt).crosswind;
}

/** "HH:MM" of a minute of the day. */
function clockText(min: number): string {
  const m = ((Math.floor(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Whole kg for the warning texts. */
const kgText = (kg: number) => `${Math.round(kg)} kg`;

/**
 * The load sheet for `offer` flown by `aircraft` with `fuelKg` (kg) on board at take-off (below what is aboard
 * defuels, above it buys the difference at the origin), for the career in `save` (cash, reputation, ratings, clock)
 * on the world's `fields`. Masses kg, CG body x m (+ forward), times min (block hours h), wind kt, money whole $.
 * Codes are listed in a fixed order, blocking ones first; `ok` is true when none blocks.
 */
export function loadSheet(offer: JobOffer, aircraft: FleetAircraft, fuelKg: number, save: CareerSave, fields: readonly Airfield[]): LoadSheet {
  const type = aircraft.type;
  const perf = CAREER_PERF[type];
  const reg = aircraft.registration;
  const origin = fieldOf(offer.origin, fields);
  const destKind = placeKind(offer.destination, fields);

  // Seating and masses.
  const seating = assignStations(offer.payload, type);
  const items: readonly PayloadItem[] = seating.ok ? seating.items : [];
  const payloadKg = offer.payload.reduce((s, it) => s + it.kg, 0);
  const zeroFuelKg = perf.emptyKg + OCCUPANT_KG + payloadKg;
  const takeoffKg = zeroFuelKg + fuelKg;
  const maxFuelKg = Math.max(0, Math.min(perf.usableFuelKg, perf.mtowKg - zeroFuelKg));
  const cgX = cgOf(type, items, fuelKg);

  // Fuel plan, wind and times.
  const plan = offerFuelPlan(offer, type, fields);
  const gsKt = offerGroundSpeedKt(offer, type, fields);
  const route = routeWindOf(offer, fields);
  const headwindKt = route.kind === 'loop' ? offer.windKt * DEADLINE_RULES.loopWindFactor : windComponents(route.trackDeg, offer.windDirDeg, offer.windKt).headwind;
  let crosswindKt = runwayCrosswindKt(origin, offer.windDirDeg, offer.windKt);
  if (offer.destination.kind === 'field') crosswindKt = Math.max(crosswindKt, runwayCrosswindKt(fieldOf(offer.destination.code, fields), offer.windDirDeg, offer.windKt));
  const landingKg = takeoffKg - plan.tripKg - plan.climbKg - plan.taxiKg;
  const flightTimeMin = flightTimeAt(offer.distanceNm, gsKt);
  const blockHoursEst = blockHours(flightTimeMin, perf.cls);
  const deadlineMarginMin = offer.deadlineMin - (flightTimeMin + CLASS_RULES[perf.cls].taxiMin);

  // Money.
  const { upliftKg, defuelKg } = upliftAndDefuel(fuelKg, aircraft.fuelKg);
  const price = fuelPricePerKg(perf.fuel, origin.kind);
  const fuelCost = fuelCostUsd(upliftKg, perf.fuel, origin.kind);
  const defuelCredit = defuelCreditUsd(defuelKg, perf.fuel);
  const landingFeeEst = landingFee(destKind, perf.mtowKg);
  const hoursCostEst = hoursCostUsd(blockHoursEst, perf, aircraft.tenure);
  const netEst = offer.pay - fuelCost + defuelCredit - landingFeeEst - hoursCostEst;

  // Codes.
  const warnings: LoadSheetWarning[] = [];
  const add = (code: LoadSheetCode, severity: 'block' | 'warn', text: string) => {
    if (!warnings.some((w) => w.code === code)) warnings.push({ code, severity, text });
  };
  const block = (code: LoadSheetCode, text: string) => add(code, 'block', text);
  const warn = (code: LoadSheetCode, text: string) => add(code, 'warn', text);

  const day = Math.floor(save.clockMin / 1440);
  const minuteOfDay = save.clockMin - day * 1440;
  if (aircraft.field !== offer.origin) block('notHere', `${reg} is at ${aircraft.field}, not ${offer.origin}`);
  if (aircraft.groundedUntilDay !== undefined && day < aircraft.groundedUntilDay) block('grounded', `${reg} is out of service until day ${aircraft.groundedUntilDay}`);
  const missing = perf.ratings.filter((r) => !save.ratings.includes(r));
  if (missing.length > 0) block('rating', `The ${perf.icaoType} needs the ${missing.join(' and ')} rating`);
  const job = classRank(offer.minClass);
  const mine = classRank(perf.cls);
  if (job.rotor && !mine.rotor) block('heliOnly', 'A helicopter job');
  else if (!job.rotor && mine.rotor) block('fixedWingOnly', 'An aeroplane job');
  else if (mine.rank < job.rank) block('class', `Needs a ${CLASS_RULES[offer.minClass].label.toLowerCase()} or larger`);
  if (save.reputation < offer.repRequired) block('reputation', `Needs reputation ${offer.repRequired}`);
  if (!seating.ok) {
    block(seating.code, seating.code === 'seats'
      ? `No seat for ${seating.item.label} in the ${perf.icaoType}`
      : `No room for ${seating.item.label} (${kgText(seating.item.kg)}) in the ${perf.icaoType}`);
  }
  if (takeoffKg > perf.mtowKg + EPS_KG) block('overMtow', `Take-off mass ${kgText(takeoffKg)} is over the ${kgText(perf.mtowKg)} maximum: at most ${kgText(maxFuelKg)} of fuel`);
  if (fuelKg < plan.requiredKg - EPS_KG) block('fuelShort', `${kgText(fuelKg)} of fuel is below the ${kgText(plan.requiredKg)} required`);
  if (fuelKg > perf.usableFuelKg + EPS_KG) block('fuelOverCapacity', `The tanks hold ${kgText(perf.usableFuelKg)}`);
  for (const end of [{ kind: 'field', code: offer.origin } as JobPlace, offer.destination]) {
    const c = runwayCode(end, type, fields);
    const name = end.kind === 'field' ? end.code : end.name;
    if (c === 'runwayShort') block('runwayShort', `The runway at ${name} is too short for the ${perf.icaoType}`);
    if (c === 'grass') block('grass', `The ${perf.icaoType} cannot use the grass strip at ${name}`);
  }
  // The board's fit rule always shows on the sheet (at the required fuel the two agree by construction).
  const fit = fitOffer(offer, type, fields);
  if (fit === 'overMtow') block('overMtow', `Too heavy for the ${perf.icaoType} with the required fuel`);
  else if (fit) block(fit, `The load does not fit the ${perf.icaoType}`);
  if (minuteOfDay > CLOCK_RULES.lastDepartureMin || minuteOfDay < CLOCK_RULES.firstDepartureMin) {
    block('lateInDay', `Departures are between ${clockText(CLOCK_RULES.firstDepartureMin)} and ${clockText(CLOCK_RULES.lastDepartureMin)}: rest until tomorrow`);
  }
  if (fuelCost > 0 && save.cash - fuelCost + defuelCredit < START_RULES.overdraftLimit) block('cash', `The fuel ($${fuelCost}) would take the company past its overdraft`);

  if (seating.ok && (cgX > perf.cg.fwdX + EPS_M || cgX < perf.cg.aftX - EPS_M)) {
    warn('cg', `Take-off CG ${cgX > perf.cg.fwdX ? 'forward of' : 'aft of'} the ${perf.icaoType}'s usual loadings`);
  }
  if (landingKg > perf.mlwKg + EPS_KG) warn('overMlw', `Landing mass ${kgText(landingKg)} is over the ${kgText(perf.mlwKg)} maximum`);
  if (deadlineMarginMin < DEADLINE_TIGHT_MIN) warn('deadlineTight', `Only ${Math.round(deadlineMarginMin)} min in hand on the deadline`);
  if (perf.cls === 'trainer' && TRAINER_WEATHER_WARN.includes(offer.weather)) warn('weather', `${offer.weather === 'rain' ? 'Rain' : 'Gusty wind'} in a trainer`);
  if (perf.maxDemoCrosswindKt !== null && crosswindKt > perf.maxDemoCrosswindKt) {
    warn('crosswind', `Crosswind ${Math.round(crosswindKt)} kt, above the ${perf.icaoType}'s demonstrated ${perf.maxDemoCrosswindKt} kt`);
  }
  if (upliftKg > 0 && price.truck) warn('fuelTruck', `${offer.origin} does not sell ${perf.fuel === 'jetA1' ? 'Jet A-1' : 'avgas'}: a fuel truck brings it (+50 %)`);
  if (netEst < 0) warn('losesMoney', `Estimated to lose $${-netEst} with the ${perf.icaoType}`);

  const ordered = [...warnings.filter((w) => w.severity === 'block'), ...warnings.filter((w) => w.severity === 'warn')];
  return {
    offerId: offer.id, aircraftUid: aircraft.uid, type,
    emptyKg: perf.emptyKg, pilotKg: OCCUPANT_KG, payloadKg, zeroFuelKg, fuelKg, takeoffKg, landingKg,
    mtowKg: perf.mtowKg, mlwKg: perf.mlwKg,
    cgX, cgFwdX: perf.cg.fwdX, cgAftX: perf.cg.aftX,
    maxFuelKg,
    tripFuelKg: plan.tripKg, climbFuelKg: plan.climbKg, taxiFuelKg: plan.taxiKg, reserveFuelKg: plan.reserveKg, requiredFuelKg: plan.requiredKg,
    upliftKg, fuelCost, defuelKg, defuelCredit,
    headwindKt, crosswindKt,
    flightTimeMin, blockHoursEst, enduranceMin: enduranceAt(perf, fuelKg), deadlineMarginMin,
    landingFeeEst, hoursCostEst, netEst,
    items, warnings: ordered, ok: !ordered.some((w) => w.severity === 'block'),
  };
}
