// Career progression and the business around the flying (docs/career.md "Progression", "The career clock",
// "Bankruptcy"): the rank from career block hours and reputation, the ratings shop, the market (lease, buy, sell,
// return a lease) and defuelling, the daily idle charge of leased aircraft, the bankruptcy options, and the career
// clock (day, minute of the day, the departure window, the season's day of year, Rest until tomorrow). Hours by
// class for the Pilot page are derived from the logbook here and never stored.
//
// Every function is pure: it takes a CareerSave and returns a new one (the input is never changed), or a refusal
// with a code and a pilot-facing sentence. Business rules: below $0 nothing can be bought or leased (a purchase,
// a lease's sign-on fee or a rating must leave the cash at $0 or more); an aircraft with the active job cannot be
// sold, returned or defuelled; the fleet holds at most START_RULES.maxFleet aircraft. Buying needs the type's
// ratings (as leasing does) but not the lessor's reputation. New aircraft are delivered to the home field with
// CareerPerf.deliveryFuelKg; their uid is `a${n}` past every uid, acquisition and logged registration (nextUid), so
// a sold airframe's registration is not handed to the next one.
//
// Rest until tomorrow settles a job still stopped at another field as 'diverted' through src/career/economy.ts
// settleJob (economy imports the rank and clock helpers from here; the cycle holds functions only, none is called
// while either module loads). Rest has no job monitor, so unless the caller passes the runtime's report it builds
// one from the job (stop field, elapsed time, last known position, fuel at the latest placement, block time = job
// time): an approximation of the hours cost only.

import { HOME_AIRFIELD, type Airfield } from '../world/airfields';
import type { AuthorityId } from '../training/types';
import { defuelCredit, upliftAndDefuel } from './costs';
import { settleJob } from './economy';
import { CAREER_PERF } from './perf';
import { registrationFor } from './registration';
import {
  CLOCK_RULES, RANKS, RATINGS, START_RULES, type AircraftClass, type CareerAircraftId, type CareerLogEntry,
  type CareerSave, type FleetAircraft, type JobFlightReport, type JobKind, type RankRule, type RatingId,
  type Settlement,
} from './types';

/** Minutes in a career day. */
const DAY_MIN = 1440;

// --------------------------------------------------------------------------------------------- results

/** Why a progression action is refused. */
export type ProgressionRefusal =
  | 'cash' | 'rating' | 'reputation' | 'hours' | 'held' | 'fleetFull' | 'notFound' | 'notOwned' | 'notLeased'
  | 'jobActive' | 'fuel';

/** The outcome of a progression action: the new save, or a refusal code with the sentence the UI shows. */
export type ProgressionResult =
  | { ok: true; save: CareerSave }
  | { ok: false; code: ProgressionRefusal; text: string };

function refuse(code: ProgressionRefusal, text: string): ProgressionResult {
  return { ok: false, code, text };
}

/** A deep copy of the save to change (saves are plain JSON data). */
function copy(save: CareerSave): CareerSave {
  return structuredClone(save);
}

/** "$1,240" (whole dollars; negative "-$300"). */
function usd(n: number): string {
  const s = `$${Math.abs(Math.round(n)).toLocaleString('en-GB')}`;
  return n < 0 ? `-${s}` : s;
}

/**
 * A business logbook line (no flying): `kind`, its net $, and remarks, stamped with the save's clock. The id is
 * `l${n}`, n the logbook's length after it. Exported for src/career/economy.ts.
 */
export function businessLine(save: CareerSave, kind: CareerLogEntry['kind'], net: number, remarks: string, extra: Partial<CareerLogEntry> = {}): CareerLogEntry {
  return {
    id: `l${save.logbook.length + 1}`, day: dayOf(save.clockMin), clockMin: save.clockMin, kind,
    blockS: 0, airborneS: 0, nightS: 0, landingsDay: 0, landingsNight: 0, net: Math.round(net), repDelta: 0, remarks,
    ...extra,
  };
}

// --------------------------------------------------------------------------------------------- clock

/** Career day of a clock reading (minutes since day 0 00:00). */
export function dayOf(clockMin: number): number {
  return Math.floor(clockMin / DAY_MIN);
}

/** Minute of the day of a clock reading, 0..1439. */
export function minuteOfDay(clockMin: number): number {
  return ((clockMin % DAY_MIN) + DAY_MIN) % DAY_MIN;
}

/** True when a departure is allowed at this clock reading: from 07:00 to 18:00 inclusive (CLOCK_RULES). */
export function departureOpen(clockMin: number): boolean {
  const m = minuteOfDay(clockMin);
  return m >= CLOCK_RULES.firstDepartureMin && m <= CLOCK_RULES.lastDepartureMin;
}

/** Day of year a job on career day `day` is flown on: 152 + (day mod 90), held to June to August (CLOCK_RULES). */
export function seasonDayOfYear(day: number): number {
  return CLOCK_RULES.day0Doy + (((day % CLOCK_RULES.seasonDays) + CLOCK_RULES.seasonDays) % CLOCK_RULES.seasonDays);
}

/** Block hours each leased aircraft flew on career day `day`, from the logbook's job lines (matched by registration), h. */
function hoursFlownOn(save: CareerSave, registration: string, day: number): number {
  let s = 0;
  for (const e of save.logbook) if (e.kind === 'job' && e.day === day && e.registration === registration) s += e.blockS;
  return s / 3600;
}

/** One leased aircraft's idle charge for a day: the lease of (leaseIdleHoursPerDay less the hours it flew), never negative. */
export interface IdleCharge {
  uid: string;
  registration: string;
  type: CareerAircraftId;
  /** Block hours flown that day, h. */
  hoursFlown: number;
  /** Whole $, 0 or more. */
  amount: number;
}

/**
 * The idle lease charges for career day `day` (charged when that day ends): for every leased aircraft,
 * max(0, START_RULES.leaseIdleHoursPerDay - hours flown that day) x its lease rate, whole $.
 */
export function idleLeaseCharges(save: CareerSave, day: number): IdleCharge[] {
  return save.fleet.filter((a) => a.tenure === 'leased').map((a) => {
    const hoursFlown = hoursFlownOn(save, a.registration, day);
    const amount = Math.round(Math.max(0, START_RULES.leaseIdleHoursPerDay - hoursFlown) * CAREER_PERF[a.type].leaseHourly);
    return { uid: a.uid, registration: a.registration, type: a.type, hoursFlown, amount };
  });
}

/**
 * Move the clock forward to `toMin` (never back). Each day boundary crossed ends that day: its idle lease charges
 * are paid (one 'leaseIdle' logbook line per aircraft charged), and the taken offers are cleared (boards are per
 * day). The cash may go below zero (charges are still paid).
 */
export function advanceClock(save: CareerSave, toMin: number): CareerSave {
  const s = copy(save);
  const target = Math.max(s.clockMin, Math.round(toMin));
  for (let d = dayOf(s.clockMin); d < dayOf(target); d++) {
    s.clockMin = Math.max(s.clockMin, (d + 1) * DAY_MIN - 1);
    for (const c of idleLeaseCharges(s, d)) {
      if (c.amount <= 0) continue;
      s.cash -= c.amount;
      s.logbook.push(businessLine(s, 'leaseIdle', -c.amount, `Idle lease, ${c.registration}: ${(START_RULES.leaseIdleHoursPerDay - c.hoursFlown).toFixed(1)} h`, {
        type: c.type, cls: CAREER_PERF[c.type].cls, registration: c.registration,
      }));
    }
    s.taken = [];
  }
  s.clockMin = target;
  return s;
}

/** The result of Rest until tomorrow: the new save and the settlement of a job given up at a stop (or null). */
export type RestResult =
  | { ok: true; save: CareerSave; settlement: Settlement | null }
  | { ok: false; code: 'jobActive'; text: string };

/**
 * Rest until tomorrow: a job still stopped at another field is settled as diverted (with `report` when the
 * runtime has one, else one built from the job), then the clock goes to 07:30 of the next day, ending today
 * (idle lease charges, taken offers cleared). Refused while a job is active and not stopped.
 */
export function rest(save: CareerSave, fields: readonly Airfield[], report?: JobFlightReport): RestResult {
  let s = save;
  let settlement: Settlement | null = null;
  const job = s.active;
  if (job) {
    if (job.phase !== 'stopped') return { ok: false, code: 'jobActive', text: 'Finish or abandon the job first' };
    const r: JobFlightReport = report ? { ...report, outcome: 'diverted' } : divertedReport(s);
    ({ save: s, settlement } = settleJob(s, job, r, fields));
  }
  const next = (dayOf(s.clockMin) + 1) * DAY_MIN + CLOCK_RULES.restToMin;
  return { ok: true, save: advanceClock(s, next), settlement };
}

/** A diverted report built from the stopped job alone (no monitor): see the header. */
function divertedReport(save: CareerSave): JobFlightReport {
  const job = save.active!;
  return {
    outcome: 'diverted', atField: job.stoppedAt ?? null, position: { north: job.lastKnown.north, east: job.lastKnown.east },
    elapsedMin: job.elapsedS / 60, blockS: job.elapsedS, airborneS: 0, nightS: 0, landingsDay: 0, landingsNight: 0,
    takeoffs: 0, landing: null, comfort: { score: 100, deductions: { vertical: 0, lateral: 0, bank: 0, pitch: 0, descent: 0, stall: 0, landing: 0 } },
    maxG: 1, minG: 1, overspeedS: 0, stallWarningS: 0, fuelAtEndKg: job.fuelKg, onApron: false, onRunway: false,
    waypointsDone: 0, waypointsTotal: job.offer.waypoints?.length ?? 0,
  };
}

// --------------------------------------------------------------------------------------------- hours, rank

/** Career block hours: the sum of the logbook's job lines, h. */
export function careerBlockHours(logbook: readonly CareerLogEntry[]): number {
  let s = 0;
  for (const e of logbook) if (e.kind === 'job') s += e.blockS;
  return s / 3600;
}

/** The rank for career block hours (h) and reputation: the last of RANKS whose hours and reputation are both met. */
export function rankFor(blockHours: number, reputation: number): RankRule {
  let r = RANKS[0];
  for (const k of RANKS) if (blockHours >= k.minHours && reputation >= k.minRep) r = k;
  return r;
}

/** The save's present rank. */
export function rankOf(save: CareerSave): RankRule {
  return rankFor(careerBlockHours(save.logbook), save.reputation);
}

/** Hours of one class, h. */
export interface ClassHours {
  blockH: number;
  airborneH: number;
}

/** What the Pilot page shows, derived from the logbook. */
export interface CareerHours {
  byClass: Record<AircraftClass, ClassHours>;
  totalBlockH: number;
  totalAirborneH: number;
  nightH: number;
  landingsDay: number;
  landingsNight: number;
  /** Jobs completed and failed (every other outcome) by kind. */
  jobsDone: Record<JobKind, number>;
  jobsFailed: Record<JobKind, number>;
}

/** Hours by class, totals, landings and jobs done and failed by kind, from the logbook's job lines. */
export function careerHours(logbook: readonly CareerLogEntry[]): CareerHours {
  const zero = (): Record<JobKind, number> => ({ charter: 0, freight: 0, mail: 0, scenic: 0, positioning: 0, medevac: 0, utility: 0 });
  const byClass = {} as Record<AircraftClass, ClassHours>;
  for (const c of ['trainer', 'tourer', 'twin', 'turbine', 'heli', 'heliTurbine'] as const) byClass[c] = { blockH: 0, airborneH: 0 };
  const h: CareerHours = {
    byClass, totalBlockH: 0, totalAirborneH: 0, nightH: 0, landingsDay: 0, landingsNight: 0, jobsDone: zero(), jobsFailed: zero(),
  };
  for (const e of logbook) {
    if (e.kind !== 'job') continue;
    if (e.cls) {
      byClass[e.cls].blockH += e.blockS / 3600;
      byClass[e.cls].airborneH += e.airborneS / 3600;
    }
    h.totalBlockH += e.blockS / 3600;
    h.totalAirborneH += e.airborneS / 3600;
    h.nightH += e.nightS / 3600;
    h.landingsDay += e.landingsDay;
    h.landingsNight += e.landingsNight;
    if (e.jobKind) (e.outcome === 'completed' ? h.jobsDone : h.jobsFailed)[e.jobKind]++;
  }
  return h;
}

// --------------------------------------------------------------------------------------------- ratings

/** Why a rating cannot be bought now, or null (held, hours, reputation, cash in that order). */
export function ratingRefusal(save: CareerSave, rating: RatingId): { code: ProgressionRefusal; text: string } | null {
  const r = RATINGS[rating];
  if (save.ratings.includes(rating)) return { code: 'held', text: `${r.label}: already held` };
  if (careerBlockHours(save.logbook) < r.minHours) return { code: 'hours', text: `Needs ${r.minHours} career hours` };
  if (save.reputation < r.minRep) return { code: 'reputation', text: `Needs reputation ${r.minRep}` };
  if (save.cash < r.cost) return { code: 'cash', text: `Needs ${usd(r.cost)}` };
  return null;
}

/** Buy a rating's training: paid at once, effective at once, with a logbook line. */
export function buyRating(save: CareerSave, rating: RatingId): ProgressionResult {
  const no = ratingRefusal(save, rating);
  if (no) return refuse(no.code, no.text);
  const s = copy(save);
  const r = RATINGS[rating];
  s.cash -= r.cost;
  s.ratings.push(rating);
  s.logbook.push(businessLine(s, 'rating', -r.cost, `${r.label} rating`));
  return { ok: true, save: s };
}

// --------------------------------------------------------------------------------------------- market

/** True when the save holds every rating the type needs. */
export function hasRatingsFor(save: CareerSave, type: CareerAircraftId): boolean {
  return CAREER_PERF[type].ratings.every((r) => save.ratings.includes(r));
}

/** A lease's sign-on fee: START_RULES.leaseSignOnHours of its lease rate, whole $. */
export function leaseSignOnFee(type: CareerAircraftId): number {
  return Math.round(START_RULES.leaseSignOnHours * CAREER_PERF[type].leaseHourly);
}

/** What selling an owned aircraft returns: START_RULES.saleFraction of its buy-in, whole $. */
export function saleValue(type: CareerAircraftId): number {
  return Math.round(START_RULES.saleFraction * CAREER_PERF[type].buyIn);
}

/**
 * The next fleet uid: `a${n}`, n above every `a<n>` uid in the fleet and above the logbook's acquisitions plus the
 * starting aircraft (which may not be logged), then past any uid whose registration (under `authority`) the
 * logbook already names, so a sold or returned airframe's marks are never handed on. Gaps are harmless.
 */
export function nextUid(save: CareerSave, authority: AuthorityId = 'easa'): string {
  let n = save.logbook.filter((e) => e.kind === 'lease' || e.kind === 'purchase').length + 1;
  for (const a of save.fleet) {
    const m = /^a(\d+)$/.exec(a.uid);
    if (m) n = Math.max(n, Number(m[1]));
  }
  const used = new Set(save.logbook.map((e) => e.registration).filter((r): r is string => !!r));
  for (const a of save.fleet) used.add(a.registration);
  do n++; while (used.has(registrationFor(`a${n}`, authority)));
  return `a${n}`;
}

/** Why the type cannot join the fleet (fleet size, ratings, the lessor's reputation for a lease, cash), or null. */
export function acquireRefusal(save: CareerSave, type: CareerAircraftId, how: 'lease' | 'buy'): { code: ProgressionRefusal; text: string } | null {
  const p = CAREER_PERF[type];
  if (save.fleet.length >= START_RULES.maxFleet) return { code: 'fleetFull', text: `The fleet is full (${START_RULES.maxFleet} aircraft)` };
  if (!hasRatingsFor(save, type)) return { code: 'rating', text: `Needs the ${p.ratings.map((r) => RATINGS[r].label.toLowerCase()).join(' and ')} rating` };
  if (how === 'lease' && save.reputation < p.leaseRep) return { code: 'reputation', text: `Needs reputation ${p.leaseRep}` };
  const price = how === 'lease' ? leaseSignOnFee(type) : p.buyIn;
  if (save.cash < price) return { code: 'cash', text: `Needs ${usd(price)}` };
  return null;
}

function acquire(save: CareerSave, type: CareerAircraftId, how: 'lease' | 'buy', authority: AuthorityId): ProgressionResult {
  const no = acquireRefusal(save, type, how);
  if (no) return refuse(no.code, no.text);
  const s = copy(save);
  const p = CAREER_PERF[type];
  const uid = nextUid(s, authority);
  const ac: FleetAircraft = {
    uid, type, tenure: how === 'lease' ? 'leased' : 'owned', registration: registrationFor(uid, authority),
    field: HOME_AIRFIELD.code, fuelKg: p.deliveryFuelKg, hours: 0, acquiredDay: dayOf(s.clockMin),
  };
  const price = how === 'lease' ? leaseSignOnFee(type) : p.buyIn;
  s.cash -= price;
  s.fleet.push(ac);
  if (s.selectedUid === null) s.selectedUid = uid;
  s.logbook.push(businessLine(s, how === 'lease' ? 'lease' : 'purchase', -price,
    how === 'lease' ? `Leased ${ac.registration} (${p.icaoType}): sign-on fee` : `Bought ${ac.registration} (${p.icaoType}): buy-in`,
    { type, cls: p.cls, registration: ac.registration }));
  return { ok: true, save: s };
}

/** Lease a type: its ratings held, reputation at least its leaseRep, the sign-on fee paid; delivered to the home field with half tanks. */
export function leaseAircraft(save: CareerSave, type: CareerAircraftId, authority: AuthorityId): ProgressionResult {
  return acquire(save, type, 'lease', authority);
}

/** Buy a type: its ratings held, the buy-in paid; delivered to the home field with half tanks. */
export function buyAircraft(save: CareerSave, type: CareerAircraftId, authority: AuthorityId): ProgressionResult {
  return acquire(save, type, 'buy', authority);
}

/** The fleet entry and a refusal when it is missing or carries the active job. */
function disposable(save: CareerSave, uid: string): { ac: FleetAircraft } | { code: ProgressionRefusal; text: string } {
  const ac = save.fleet.find((a) => a.uid === uid);
  if (!ac) return { code: 'notFound', text: 'No such aircraft' };
  if (save.active?.aircraftUid === uid) return { code: 'jobActive', text: `${ac.registration} is on a job` };
  return { ac };
}

/** Take an aircraft out of the fleet, moving the selection to the first remaining one (or null). */
function remove(s: CareerSave, uid: string): void {
  s.fleet = s.fleet.filter((a) => a.uid !== uid);
  if (s.selectedUid === uid) s.selectedUid = s.fleet[0]?.uid ?? null;
}

/** Sell an owned aircraft wherever it stands for its sale value (not one on the active job). */
export function sellAircraft(save: CareerSave, uid: string): ProgressionResult {
  const d = disposable(save, uid);
  if (!('ac' in d)) return refuse(d.code, d.text);
  if (d.ac.tenure !== 'owned') return refuse('notOwned', `${d.ac.registration} is leased: return it instead`);
  const s = copy(save);
  const value = saleValue(d.ac.type);
  s.cash += value;
  remove(s, uid);
  s.logbook.push(businessLine(s, 'sale', value, `Sold ${d.ac.registration} (${CAREER_PERF[d.ac.type].icaoType})`,
    { type: d.ac.type, cls: CAREER_PERF[d.ac.type].cls, registration: d.ac.registration }));
  return { ok: true, save: s };
}

/** Return a leased aircraft, free, wherever it stands (not one on the active job). */
export function returnLease(save: CareerSave, uid: string): ProgressionResult {
  const d = disposable(save, uid);
  if (!('ac' in d)) return refuse(d.code, d.text);
  if (d.ac.tenure !== 'leased') return refuse('notLeased', `${d.ac.registration} is owned: sell it instead`);
  const s = copy(save);
  remove(s, uid);
  s.logbook.push(businessLine(s, 'return', 0, `Returned ${d.ac.registration} (${CAREER_PERF[d.ac.type].icaoType}) to the lessor`,
    { type: d.ac.type, cls: CAREER_PERF[d.ac.type].cls, registration: d.ac.registration }));
  return { ok: true, save: s };
}

/** Drain an aircraft's fuel to `fuelKg` (0 up to what is aboard), credited at DEFUEL_RULES; not one on the active job. */
export function defuelAircraft(save: CareerSave, uid: string, fuelKg: number): ProgressionResult {
  const d = disposable(save, uid);
  if (!('ac' in d)) return refuse(d.code, d.text);
  if (!(fuelKg >= 0) || fuelKg >= d.ac.fuelKg) return refuse('fuel', 'Choose less fuel than is aboard');
  const s = copy(save);
  const { defuelKg } = upliftAndDefuel(fuelKg, d.ac.fuelKg);
  const credit = defuelCredit(defuelKg, CAREER_PERF[d.ac.type].fuel);
  s.cash += credit;
  s.fleet.find((a) => a.uid === uid)!.fuelKg = fuelKg;
  s.logbook.push(businessLine(s, 'refuel', credit, `Defuelled ${d.ac.registration}: ${defuelKg.toFixed(1)} kg drained`,
    { type: d.ac.type, cls: CAREER_PERF[d.ac.type].cls, registration: d.ac.registration }));
  return { ok: true, save: s };
}

// --------------------------------------------------------------------------------------------- bankruptcy

/** True below the overdraft limit (the bankruptcy page opens). */
export function isBankrupt(save: CareerSave): boolean {
  return save.cash < START_RULES.overdraftLimit;
}

/** The owned aircraft the bank would sell (every owned one but the active job's) and what they fetch, $. */
function bankSale(save: CareerSave): { uids: string[]; value: number } {
  const own = save.fleet.filter((a) => a.tenure === 'owned' && save.active?.aircraftUid !== a.uid);
  return { uids: own.map((a) => a.uid), value: own.reduce((v, a) => v + saleValue(a.type), 0) };
}

/** The bankruptcy page's choices: 'sellOwned' only when the sale lifts the cash above the overdraft; 'restart' always. */
export function bankruptcyOptions(save: CareerSave): ('sellOwned' | 'restart')[] {
  const sale = bankSale(save);
  return sale.uids.length > 0 && save.cash + sale.value > START_RULES.overdraftLimit ? ['sellOwned', 'restart'] : ['restart'];
}

/** The bank sells every owned aircraft at its sale value (leases are kept), with one logbook line. Refused when not offered. */
export function bankruptcySellOwned(save: CareerSave): ProgressionResult {
  if (!bankruptcyOptions(save).includes('sellOwned')) return refuse('cash', 'Selling the owned aircraft would not clear the overdraft');
  const s = copy(save);
  const sale = bankSale(s);
  const regs = s.fleet.filter((a) => sale.uids.includes(a.uid)).map((a) => a.registration);
  s.cash += sale.value;
  for (const uid of sale.uids) remove(s, uid);
  s.logbook.push(businessLine(s, 'bankruptcy', sale.value, `The bank sold ${regs.join(', ')}`));
  return { ok: true, save: s };
}
