// Hand-written guards for the Career save (docs/career.md "Data model" and "Persistence, boot and reloads"), in the
// style of the school's src/training/career/validate.ts: the save is rebuilt field by field, so unknown fields are
// dropped on every load and import, an invalid entity (one fleet aircraft, one logbook line, the active job, the
// last settlement) is dropped with a reason and the rest of the career is kept, and settings fields fall back to
// their defaults one by one. Only a value that is not a Career save at all (wrong format, another schema, no pilot
// or company, a broken top-level number) is rejected: the store then falls back to the `.prev` copy.
//
// Cross-entity rules: fleet uids are unique; `selectedUid` names a surviving fleet aircraft (else the first, or
// null); the active job's aircraft is in the fleet with the same type, a placed job carries its loading (the only
// copy of the payload: placed with `loading: null` cannot be resumed, so the job is dropped), and a stopped job
// names the field it is held at. Pure: no storage, no DOM.

import type { StormCell, WeatherSettings } from '../core/types';
import type { LoadingRequest } from '../physics/interfaces';
import {
  CAREER_AIRCRAFT_IDS, CAREER_SCHEMA,
  type ActiveJob, type AircraftClass, type CareerAircraftId, type CareerLogEntry, type CareerSave, type CareerSettings,
  type CareerWeatherId, type ComfortFactor, type ComfortSummary, type FleetAircraft, type JobFlightReport,
  type JobKind, type JobOffer, type JobOutcome, type JobPhase, type JobPlace, type LandingSummary, type LicenceSource,
  type MoneyLine, type MoneyLineId, type OfferItem, type PayloadItem, type PayloadKind, type RankId, type RatingId,
  type RepLine, type SettledOutcome, type Settlement, type Station, type Tenure, type Waypoint,
} from './types';

/** A validated save and the reasons for everything dropped or repaired on the way ("fleet[2]: invalid"). */
export interface ValidatedCareerSave {
  save: CareerSave;
  dropped: string[];
}

// ---- primitives ----------------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNonNeg = (v: unknown): v is number => isNum(v) && v >= 0;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isId = (v: unknown): v is string => isStr(v) && v !== '';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const oneOf = <T extends string>(v: unknown, xs: readonly T[]): v is T => isStr(v) && (xs as readonly string[]).includes(v);

// Enumerations, complete by construction: each is the key list of a Record over its contract union, so a member
// added to or removed from types.ts fails to compile here instead of silently dropping entities on load.
const keysOf = <T extends string>(o: Record<T, 0>): readonly T[] => Object.keys(o) as T[];
const AIRCRAFT_CLASSES = keysOf<AircraftClass>({ trainer: 0, tourer: 0, twin: 0, turbine: 0, heli: 0, heliTurbine: 0 });
const JOB_KINDS = keysOf<JobKind>({ charter: 0, freight: 0, mail: 0, scenic: 0, positioning: 0, medevac: 0, utility: 0 });
const JOB_PHASES = keysOf<JobPhase>({ dispatched: 0, ground: 0, airborne: 0, landed: 0, stopped: 0, done: 0 });
const WEATHER_IDS = keysOf<CareerWeatherId>({ clear: 0, fair: 0, overcast: 0, gusty: 0, drizzle: 0, rain: 0 });
const PAYLOAD_KINDS = keysOf<PayloadKind>({ passenger: 0, baggage: 0, freight: 0, mail: 0, patient: 0, equipment: 0 });
const STATIONS = keysOf<Station>({ front: 0, rear: 0, cabin: 0, baggage: 0, cargo: 0 });
const JOB_OUTCOMES = keysOf<JobOutcome>({ completed: 0, diverted: 0, outlanded: 0, crashed: 0, abandoned: 0, lost: 0 });
const SETTLED_OUTCOMES = keysOf<SettledOutcome>({ completed: 0, diverted: 0, outlanded: 0, crashed: 0, abandoned: 0, lost: 0, routeMissed: 0 });
const MONEY_LINE_IDS = keysOf<MoneyLineId>({
  base: 0, route: 0, onTime: 0, early: 0, late: 0, landing: 0, heavyLanding: 0, comfort: 0, overspeed: 0, highG: 0, lowReserve: 0,
  runwayStop: 0, rankBonus: 0, fuel: 0, defuel: 0, landingFee: 0, aircraftHours: 0, leaseIdle: 0, repair: 0, recovery: 0,
});
const COMFORT_FACTORS = keysOf<ComfortFactor>({ vertical: 0, lateral: 0, bank: 0, pitch: 0, descent: 0, stall: 0, landing: 0 });
const RANK_IDS = keysOf<RankId>({ junior: 0, line: 0, senior: 0, captain: 0, chief: 0 });
/** In RATINGS order: a validated save lists its ratings in this order. */
const RATING_IDS = keysOf<RatingId>({ sep: 0, mep: 0, turbine: 0, heli: 0 });
const TENURES = keysOf<Tenure>({ owned: 0, leased: 0 });
const LICENCE_SOURCES = keysOf<LicenceSource>({ school: 0, declared: 0, unlock: 0 });
const LOG_KINDS = keysOf<CareerLogEntry['kind']>({
  job: 0, rating: 0, purchase: 0, lease: 0, sale: 0, return: 0, leaseIdle: 0, refuel: 0, bankruptcy: 0,
});
const FIRST_WHEELS = keysOf<LandingSummary['firstWheel']>({ nose: 0, left: 0, right: 0 });

const isCareerType = (v: unknown): v is CareerAircraftId => oneOf(v, CAREER_AIRCRAFT_IDS);

// Field coverage, also complete by construction: `Covers<T, K>` compiles to `true` only when K names every field
// of T, so a field added to a contract interface (another package's "(contract addition)") fails to compile here
// until the rebuild below copies it, instead of being silently stripped from every save on load.
type Covers<T, K extends keyof T> = [Exclude<keyof T, K>] extends [never] ? true : { notValidated: Exclude<keyof T, K> };
const CONTRACT_FIELDS_COVERED: readonly true[] = [
  true satisfies Covers<CareerSave, 'format' | 'schema' | 'createdAt' | 'updatedAt' | 'seed' | 'pilot' | 'company' | 'cash'
    | 'reputation' | 'clockMin' | 'ratings' | 'fleet' | 'selectedUid' | 'inCareer' | 'taken' | 'active' | 'lastSettlement'
    | 'logbook' | 'flightNo' | 'ownNo' | 'settings'>,
  true satisfies Covers<CareerSettings, 'companyCallsign'>,
  true satisfies Covers<FleetAircraft, 'uid' | 'type' | 'tenure' | 'registration' | 'field' | 'fuelKg' | 'hours' | 'acquiredDay'
    | 'groundedUntilDay'>,
  true satisfies Covers<ActiveJob, 'offer' | 'aircraftUid' | 'type' | 'fuelKg' | 'loading' | 'items' | 'phase' | 'placed'
    | 'acceptedAtMin' | 'elapsedBaseS' | 'elapsedS' | 'lastKnown' | 'everAirborne' | 'stoppedAt' | 'playerWeather'
    | 'pendingReport' | 'charges'>,
  true satisfies Covers<JobOffer, 'id' | 'kind' | 'day' | 'origin' | 'destination' | 'waypoints' | 'client' | 'title' | 'pax'
    | 'payload' | 'payloadKg' | 'distanceNm' | 'pay' | 'deadlineMin' | 'minClass' | 'refType' | 'repRequired' | 'premium'
    | 'weather' | 'windDirDeg' | 'windKt'>,
  true satisfies Covers<PayloadItem, 'kind' | 'label' | 'kg' | 'station'>,
  true satisfies Covers<Waypoint, 'name' | 'north' | 'east' | 'radiusM' | 'maxAglFt'>,
  true satisfies Covers<JobFlightReport, (typeof REPORT_NUMBERS)[number] | 'outcome' | 'atField' | 'position' | 'landing'
    | 'comfort' | 'onApron' | 'onRunway' | 'crashReason' | 'test'>,
  true satisfies Covers<LandingSummary, 'score' | 'sinkFpm' | 'bounces' | 'firstWheel' | 'helicopter' | 'onTarget' | 'distAimFt'
    | 'centrelineM' | 'spotDistM'>,
  true satisfies Covers<Settlement, 'offerId' | 'outcome' | 'lines' | 'net' | 'repLines' | 'repDelta' | 'cashAfter' | 'repAfter'
    | 'rankBefore' | 'rankAfter' | 'aircraftAt' | 'groundedUntilDay' | 'report' | 'logEntry' | 'summary'>,
  true satisfies Covers<CareerLogEntry, 'id' | 'day' | 'clockMin' | 'kind' | 'type' | 'cls' | 'registration' | 'from' | 'to'
    | 'jobKind' | 'jobId' | 'outcome' | 'blockS' | 'airborneS' | 'nightS' | 'landingsDay' | 'landingsNight' | 'net' | 'repDelta'
    | 'remarks'>,
  true satisfies Covers<WeatherSettings, (typeof WEATHER_NUMBERS)[number] | (typeof WEATHER_OPTIONAL_NUMBERS)[number]
    | (typeof WEATHER_OPTIONAL_STRINGS)[number] | 'storms'>,
  true satisfies Covers<StormCell, 'northM' | 'eastM' | 'radiusM' | 'topM' | 'intensity' | 'motionDeg' | 'motionKt' | 'lightning'>,
];

/**
 * Keep the valid members of a list (each rebuilt by `fix`), dropping the rest with a reason (indices are the
 * stored list's). With `key`, a member whose key an earlier member already has is dropped as a duplicate.
 */
function listOf<T>(v: unknown, path: string, fix: (x: unknown) => T | null, dropped: string[], key?: (x: T) => string): T[] {
  if (!Array.isArray(v)) {
    if (v !== undefined) dropped.push(`${path}: not a list`);
    return [];
  }
  const out: T[] = [];
  const seen = new Set<string>();
  v.forEach((x, i) => {
    const r = fix(x);
    if (r === null) { dropped.push(`${path}[${i}]: invalid`); return; }
    if (key) {
      const k = key(r);
      if (seen.has(k)) { dropped.push(`${path}[${i}]: duplicate ${k}`); return; }
      seen.add(k);
    }
    out.push(r);
  });
  return out;
}

/** Every member valid (each rebuilt), or null: for lists inside an entity, where one bad member spoils the entity. */
function allOf<T>(v: unknown, fix: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const x of v) {
    const r = fix(x);
    if (r === null) return null;
    out.push(r);
  }
  return out;
}

// ---- physics and weather payloads --------------------------------------------------------------------------

function vec3(v: unknown): { x: number; y: number; z: number } | null {
  return isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.z) ? { x: v.x, y: v.y, z: v.z } : null;
}

/** A LoadingRequest (src/physics/interfaces.ts) rebuilt: payload kg >= 0, a body-axis centroid, an optional distribution. */
export function validateLoading(v: unknown): LoadingRequest | null {
  if (!isObj(v) || !isNonNeg(v.payload)) return null;
  const payloadPosition = vec3(v.payloadPosition);
  if (!payloadPosition) return null;
  const out: LoadingRequest = { payload: v.payload, payloadPosition };
  if (v.payloadDistribution !== undefined) {
    const dist = allOf(v.payloadDistribution, (x) => {
      if (!isObj(x) || !isNonNeg(x.fraction)) return null;
      const offset = vec3(x.offset);
      return offset ? { fraction: x.fraction, offset } : null;
    });
    if (!dist) return null;
    out.payloadDistribution = dist;
  }
  return out;
}

const WEATHER_NUMBERS = [
  'windDirectionDeg', 'windSpeedKt', 'gustKt', 'turbulence', 'isaDeviation', 'qnhHpa', 'cloudCover', 'cloudBaseM',
  'cloudTopM', 'visibilityM', 'timeOfDay', 'dayOfYear',
] as const satisfies readonly (keyof WeatherSettings)[];
const WEATHER_OPTIONAL_NUMBERS = [
  'cirrusCover', 'midCover', 'midAltM', 'precipRateMmH', 'fogTopM', 'fogVisibilityM',
] as const satisfies readonly (keyof WeatherSettings)[];
/** Optional string fields: copied when strings; src/core/weatherFields.ts treats unknown values as absent. */
const WEATHER_OPTIONAL_STRINGS = ['cloudType', 'midType', 'precipType'] as const satisfies readonly (keyof WeatherSettings)[];

function stormCell(v: unknown): StormCell | null {
  if (!isObj(v)) return null;
  const { northM, eastM, radiusM, topM, intensity, motionDeg, motionKt, lightning } = v;
  if (!isNum(northM) || !isNum(eastM) || !isNum(radiusM) || !isNum(topM) || !isNum(intensity) || !isNum(motionDeg) || !isNum(motionKt)) return null;
  const out: StormCell = { northM, eastM, radiusM, topM, intensity, motionDeg, motionKt };
  if (isBool(lightning)) out.lightning = lightning;
  return out;
}

/**
 * The player's own WeatherSettings rebuilt: every required number finite; the optional fields known today copied
 * when of the right primitive type (a malformed one is left out: absent is the default everywhere).
 */
export function validateWeather(v: unknown): WeatherSettings | null {
  if (!isObj(v)) return null;
  const out: Record<string, unknown> = {};
  for (const k of WEATHER_NUMBERS) {
    if (!isNum(v[k])) return null;
    out[k] = v[k];
  }
  for (const k of WEATHER_OPTIONAL_NUMBERS) if (isNum(v[k])) out[k] = v[k];
  for (const k of WEATHER_OPTIONAL_STRINGS) if (isStr(v[k])) out[k] = v[k];
  if (v.storms !== undefined) {
    const storms = allOf(v.storms, stormCell);
    if (storms) out.storms = storms;
  }
  return out as unknown as WeatherSettings;
}

// ---- jobs ----------------------------------------------------------------------------------------------

function offerItem(v: unknown): OfferItem | null {
  return isObj(v) && oneOf(v.kind, PAYLOAD_KINDS) && isStr(v.label) && isNonNeg(v.kg) ? { kind: v.kind, label: v.label, kg: v.kg } : null;
}

function payloadItem(v: unknown): PayloadItem | null {
  const item = offerItem(v);
  return item && isObj(v) && oneOf(v.station, STATIONS) ? { ...item, station: v.station } : null;
}

function jobPlace(v: unknown): JobPlace | null {
  if (!isObj(v)) return null;
  if (v.kind === 'field') return isId(v.code) ? { kind: 'field', code: v.code } : null;
  if (v.kind === 'site') {
    const { id, name, north, east, elevation } = v;
    return isId(id) && isStr(name) && isNum(north) && isNum(east) && isNum(elevation)
      ? { kind: 'site', id, name, north, east, elevation } : null;
  }
  return null;
}

function waypoint(v: unknown): Waypoint | null {
  if (!isObj(v) || !isStr(v.name) || !isNum(v.north) || !isNum(v.east) || !isNonNeg(v.radiusM)) return null;
  const out: Waypoint = { name: v.name, north: v.north, east: v.east, radiusM: v.radiusM };
  if (v.maxAglFt !== undefined) {
    if (!isNum(v.maxAglFt)) return null;
    out.maxAglFt = v.maxAglFt;
  }
  return out;
}

/** A JobOffer rebuilt (unknown fields dropped); null when any field is missing or of the wrong kind. */
export function validateOffer(v: unknown): JobOffer | null {
  if (!isObj(v) || !isId(v.id) || !oneOf(v.kind, JOB_KINDS) || !isNum(v.day) || !isId(v.origin)) return null;
  const destination = jobPlace(v.destination);
  const payload = allOf(v.payload, offerItem);
  if (!destination || !payload) return null;
  if (!isStr(v.client) || !isStr(v.title) || !isNonNeg(v.pax) || !isNonNeg(v.payloadKg) || !isNonNeg(v.distanceNm)) return null;
  if (!isNum(v.pay) || !isNonNeg(v.deadlineMin) || !oneOf(v.minClass, AIRCRAFT_CLASSES) || !isCareerType(v.refType)) return null;
  if (!isNum(v.repRequired) || !isBool(v.premium) || !oneOf(v.weather, WEATHER_IDS) || !isNum(v.windDirDeg) || !isNonNeg(v.windKt)) return null;
  const out: JobOffer = {
    id: v.id, kind: v.kind, day: v.day, origin: v.origin, destination,
    client: v.client, title: v.title, pax: v.pax, payload, payloadKg: v.payloadKg, distanceNm: v.distanceNm,
    pay: v.pay, deadlineMin: v.deadlineMin, minClass: v.minClass, refType: v.refType, repRequired: v.repRequired,
    premium: v.premium, weather: v.weather, windDirDeg: v.windDirDeg, windKt: v.windKt,
  };
  if (v.waypoints !== undefined) {
    const waypoints = allOf(v.waypoints, waypoint);
    if (!waypoints) return null;
    out.waypoints = waypoints;
  }
  return out;
}

// ---- flight report, settlement, logbook ----------------------------------------------------------------------

function landingSummary(v: unknown): LandingSummary | null {
  if (!isObj(v) || !isNum(v.score) || !isNum(v.sinkFpm) || !isNonNeg(v.bounces) || !oneOf(v.firstWheel, FIRST_WHEELS)) return null;
  if (!isBool(v.helicopter) || !isBool(v.onTarget)) return null;
  const out: LandingSummary = {
    score: v.score, sinkFpm: v.sinkFpm, bounces: v.bounces, firstWheel: v.firstWheel, helicopter: v.helicopter, onTarget: v.onTarget,
  };
  for (const k of ['distAimFt', 'centrelineM', 'spotDistM'] as const) {
    if (v[k] === undefined) continue;
    if (!isNum(v[k])) return null;
    out[k] = v[k] as number;
  }
  return out;
}

function comfortSummary(v: unknown): ComfortSummary | null {
  if (!isObj(v) || !isNum(v.score) || !isObj(v.deductions)) return null;
  const d = v.deductions;
  const deductions = {} as Record<ComfortFactor, number>;
  for (const k of COMFORT_FACTORS) {
    if (!isNum(d[k])) return null;
    deductions[k] = d[k] as number;
  }
  return { score: v.score, deductions };
}

const REPORT_NUMBERS = [
  'elapsedMin', 'blockS', 'airborneS', 'nightS', 'landingsDay', 'landingsNight', 'takeoffs', 'maxG', 'minG',
  'overspeedS', 'stallWarningS', 'fuelAtEndKg', 'waypointsDone', 'waypointsTotal',
] as const satisfies readonly (keyof JobFlightReport)[];

/** A JobFlightReport rebuilt (the job runtime's hand-over to the settlement). */
export function validateReport(v: unknown): JobFlightReport | null {
  if (!isObj(v) || !oneOf(v.outcome, JOB_OUTCOMES) || !(v.atField === null || isId(v.atField))) return null;
  const p = v.position;
  if (!isObj(p) || !isNum(p.north) || !isNum(p.east)) return null;
  let landing: LandingSummary | null = null;
  if (v.landing !== null) {
    landing = landingSummary(v.landing);
    if (!landing) return null;
  }
  const comfort = comfortSummary(v.comfort);
  if (!comfort || !isBool(v.onApron) || !isBool(v.onRunway)) return null;
  const nums = {} as Record<(typeof REPORT_NUMBERS)[number], number>;
  for (const k of REPORT_NUMBERS) {
    if (!isNum(v[k])) return null;
    nums[k] = v[k] as number;
  }
  const out: JobFlightReport = {
    outcome: v.outcome, atField: v.atField, position: { north: p.north, east: p.east }, ...nums,
    landing, comfort, onApron: v.onApron, onRunway: v.onRunway,
  };
  if (v.crashReason !== undefined) {
    if (!isStr(v.crashReason)) return null;
    out.crashReason = v.crashReason;
  }
  if (v.test !== undefined) {
    if (!isBool(v.test)) return null;
    out.test = v.test;
  }
  return out;
}

/** A CareerLogEntry rebuilt; the optional job fields are kept only when of their kind. */
export function validateLogEntry(v: unknown): CareerLogEntry | null {
  if (!isObj(v) || !isId(v.id) || !isNum(v.day) || !isNum(v.clockMin) || !oneOf(v.kind, LOG_KINDS)) return null;
  for (const k of ['blockS', 'airborneS', 'nightS', 'landingsDay', 'landingsNight'] as const) if (!isNonNeg(v[k])) return null;
  if (!isNum(v.net) || !isNum(v.repDelta) || !isStr(v.remarks)) return null;
  const out: CareerLogEntry = {
    id: v.id, day: v.day, clockMin: v.clockMin, kind: v.kind,
    blockS: v.blockS as number, airborneS: v.airborneS as number, nightS: v.nightS as number,
    landingsDay: v.landingsDay as number, landingsNight: v.landingsNight as number,
    net: v.net, repDelta: v.repDelta, remarks: v.remarks,
  };
  if (v.type !== undefined) { if (!isCareerType(v.type)) return null; out.type = v.type; }
  if (v.cls !== undefined) { if (!oneOf(v.cls, AIRCRAFT_CLASSES)) return null; out.cls = v.cls; }
  if (v.jobKind !== undefined) { if (!oneOf(v.jobKind, JOB_KINDS)) return null; out.jobKind = v.jobKind; }
  if (v.outcome !== undefined) { if (!oneOf(v.outcome, SETTLED_OUTCOMES)) return null; out.outcome = v.outcome; }
  for (const k of ['registration', 'from', 'to', 'jobId'] as const) {
    if (v[k] === undefined) continue;
    if (!isStr(v[k])) return null;
    out[k] = v[k] as string;
  }
  return out;
}

const moneyLine = (v: unknown): MoneyLine | null =>
  isObj(v) && oneOf(v.id, MONEY_LINE_IDS) && isStr(v.label) && isNum(v.amount) ? { id: v.id, label: v.label, amount: v.amount } : null;

const repLine = (v: unknown): RepLine | null =>
  isObj(v) && isStr(v.reason) && isNum(v.delta) ? { reason: v.reason, delta: v.delta } : null;

/** A Settlement (the debrief model) rebuilt. */
export function validateSettlement(v: unknown): Settlement | null {
  if (!isObj(v) || !isId(v.offerId) || !oneOf(v.outcome, SETTLED_OUTCOMES)) return null;
  const lines = allOf(v.lines, moneyLine);
  const repLines = allOf(v.repLines, repLine);
  const report = validateReport(v.report);
  const logEntry = validateLogEntry(v.logEntry);
  if (!lines || !repLines || !report || !logEntry) return null;
  if (!isNum(v.net) || !isNum(v.repDelta) || !isNum(v.cashAfter) || !isNum(v.repAfter)) return null;
  if (!oneOf(v.rankBefore, RANK_IDS) || !oneOf(v.rankAfter, RANK_IDS) || !isId(v.aircraftAt) || !isStr(v.summary)) return null;
  const out: Settlement = {
    offerId: v.offerId, outcome: v.outcome, lines, net: v.net, repLines, repDelta: v.repDelta,
    cashAfter: v.cashAfter, repAfter: v.repAfter, rankBefore: v.rankBefore, rankAfter: v.rankAfter,
    aircraftAt: v.aircraftAt, report, logEntry, summary: v.summary,
  };
  if (v.groundedUntilDay !== undefined) {
    if (!isNum(v.groundedUntilDay)) return null;
    out.groundedUntilDay = v.groundedUntilDay;
  }
  return out;
}

// ---- fleet and the active job --------------------------------------------------------------------------------

/** A FleetAircraft rebuilt. */
export function validateFleetAircraft(v: unknown): FleetAircraft | null {
  if (!isObj(v) || !isId(v.uid) || !isCareerType(v.type) || !oneOf(v.tenure, TENURES) || !isId(v.registration)) return null;
  if (!isId(v.field) || !isNonNeg(v.fuelKg) || !isNonNeg(v.hours) || !isNum(v.acquiredDay)) return null;
  const out: FleetAircraft = {
    uid: v.uid, type: v.type, tenure: v.tenure, registration: v.registration, field: v.field,
    fuelKg: v.fuelKg, hours: v.hours, acquiredDay: v.acquiredDay,
  };
  if (v.groundedUntilDay !== undefined) {
    if (!isNum(v.groundedUntilDay)) return null;
    out.groundedUntilDay = v.groundedUntilDay;
  }
  return out;
}

/**
 * An ActiveJob rebuilt, checked against the (already validated) fleet. Null with a reason when it cannot stand:
 * malformed, its aircraft gone or of another type, placed without a loading, or stopped without a field.
 */
export function validateActiveJob(v: unknown, fleet: readonly FleetAircraft[]): { job: ActiveJob | null; reason?: string } {
  if (!isObj(v)) return { job: null, reason: 'not an object' };
  const offer = validateOffer(v.offer);
  if (!offer) return { job: null, reason: 'invalid offer' };
  if (!isId(v.aircraftUid) || !isCareerType(v.type)) return { job: null, reason: 'invalid aircraft' };
  const ac = fleet.find((a) => a.uid === v.aircraftUid);
  if (!ac || ac.type !== v.type) return { job: null, reason: 'its aircraft is not in the fleet' };
  if (!isBool(v.placed) || !oneOf(v.phase, JOB_PHASES)) return { job: null, reason: 'invalid phase' };
  let loading: LoadingRequest | null = null;
  if (v.loading !== null) {
    loading = validateLoading(v.loading);
    if (!loading) return { job: null, reason: 'invalid loading' };
  }
  if (v.placed && loading === null) return { job: null, reason: 'placed without a loading' };
  const items = allOf(v.items, payloadItem);
  if (!items) return { job: null, reason: 'invalid items' };
  if (!isNonNeg(v.fuelKg) || !isNum(v.acceptedAtMin) || !isNonNeg(v.elapsedBaseS) || !isNonNeg(v.elapsedS)) {
    return { job: null, reason: 'invalid numbers' };
  }
  const lk = v.lastKnown;
  if (!isObj(lk) || !isNum(lk.north) || !isNum(lk.east) || !isBool(lk.onGround)) return { job: null, reason: 'invalid last position' };
  if (!isBool(v.everAirborne)) return { job: null, reason: 'invalid everAirborne' };
  const playerWeather = validateWeather(v.playerWeather);
  if (!playerWeather) return { job: null, reason: 'invalid player weather' };
  const job: ActiveJob = {
    offer, aircraftUid: v.aircraftUid, type: v.type, fuelKg: v.fuelKg, loading, items, phase: v.phase, placed: v.placed,
    acceptedAtMin: v.acceptedAtMin, elapsedBaseS: v.elapsedBaseS, elapsedS: v.elapsedS,
    lastKnown: { north: lk.north, east: lk.east, onGround: lk.onGround }, everAirborne: v.everAirborne, playerWeather,
  };
  if (v.stoppedAt !== undefined) {
    if (!isId(v.stoppedAt)) return { job: null, reason: 'invalid stop field' };
    job.stoppedAt = v.stoppedAt;
  }
  if (job.phase === 'stopped' && job.stoppedAt === undefined) return { job: null, reason: 'stopped without a field' };
  if (v.pendingReport !== undefined) {
    const r = validateReport(v.pendingReport);
    if (!r) return { job: null, reason: 'invalid pending report' };
    job.pendingReport = r;
  }
  if (v.charges !== undefined) {
    const ch = v.charges;
    if (!isObj(ch) || !isNonNeg(ch.fuelUsd) || !isNonNeg(ch.defuelCreditUsd) || !isNonNeg(ch.stopFeesUsd)) {
      return { job: null, reason: 'invalid charges' };
    }
    job.charges = { fuelUsd: ch.fuelUsd, defuelCreditUsd: ch.defuelCreditUsd, stopFeesUsd: ch.stopFeesUsd };
  }
  return { job };
}

// ---- the save ----------------------------------------------------------------------------------------------

/** Settings of a new career (company callsign on the radio). */
export function defaultCareerSettings(): CareerSettings {
  return { companyCallsign: true };
}

function settingsFrom(v: unknown, dropped: string[]): CareerSettings {
  const d = defaultCareerSettings();
  if (!isObj(v)) {
    dropped.push('settings: reset to defaults');
    return d;
  }
  if (isBool(v.companyCallsign)) return { companyCallsign: v.companyCallsign };
  dropped.push('settings.companyCallsign: reset to default');
  return d;
}

/** A counter (flightNo, ownNo): a whole number >= 1, else 1 with a reason. */
function counter(v: unknown, path: string, dropped: string[]): number {
  if (isNum(v) && Number.isInteger(v) && v >= 1) return v;
  dropped.push(`${path}: reset to 1`);
  return 1;
}

/**
 * Validate a Career save (anything parsed from JSON). Null when it is not a schema-CAREER_SCHEMA Career save at
 * all: wrong format or schema, no pilot name or licence source, no company name or callsign, or a non-finite
 * seed, cash, reputation or clock. Otherwise the rebuilt save and the reasons for what was dropped or repaired.
 */
export function validateCareerSave(v: unknown): ValidatedCareerSave | null {
  if (!isObj(v) || v.format !== 'fs-career' || v.schema !== CAREER_SCHEMA) return null;
  const p = v.pilot, c = v.company;
  if (!isObj(p) || !isStr(p.name) || !oneOf(p.licence, LICENCE_SOURCES)) return null;
  if (!isObj(c) || !isStr(c.name) || !isStr(c.callsign)) return null;
  if (!isNum(v.seed) || !isNum(v.cash) || !isNum(v.reputation) || !isNonNeg(v.clockMin)) return null;
  const dropped: string[] = [];

  const now = Date.now();
  const time = (k: 'createdAt' | 'updatedAt'): number => {
    if (isNum(v[k])) return v[k] as number;
    dropped.push(`${k}: invalid, reset`);
    return now;
  };

  // Fleet first: the selection and the active job are checked against the survivors.
  const fleet = listOf(v.fleet, 'fleet', validateFleetAircraft, dropped, (a) => `uid ${a.uid}`);
  const uids = new Set(fleet.map((a) => a.uid));

  let selectedUid: string | null = null;
  if (isStr(v.selectedUid) && uids.has(v.selectedUid)) selectedUid = v.selectedUid;
  else {
    selectedUid = fleet[0]?.uid ?? null;
    if (v.selectedUid !== selectedUid) dropped.push(`selectedUid: reset to ${selectedUid ?? 'none'}`);
  }

  const ratingSet = new Set<RatingId>(['sep']);
  if (Array.isArray(v.ratings)) {
    for (const r of v.ratings) {
      if (oneOf(r, RATING_IDS)) ratingSet.add(r);
      else dropped.push(`ratings: unknown ${String(r)}`);
    }
  } else dropped.push('ratings: not a list');
  const ratings = RATING_IDS.filter((r) => ratingSet.has(r));

  let active: ActiveJob | null = null;
  if (v.active !== null && v.active !== undefined) {
    const r = validateActiveJob(v.active, fleet);
    active = r.job;
    if (!active) dropped.push(`active: ${r.reason ?? 'invalid'}, dropped`);
  }

  let lastSettlement: Settlement | null = null;
  if (v.lastSettlement !== null && v.lastSettlement !== undefined) {
    lastSettlement = validateSettlement(v.lastSettlement);
    if (!lastSettlement) dropped.push('lastSettlement: invalid, dropped');
  }

  // A duplicate logbook id would make the lines ambiguous: keep the first.
  const logbook = listOf(v.logbook, 'logbook', validateLogEntry, dropped, (e) => `id ${e.id}`);

  const taken = listOf(v.taken, 'taken', (x) => (isId(x) ? x : null), dropped, (x) => `id ${x}`);

  let inCareer = false;
  if (isBool(v.inCareer)) inCareer = v.inCareer;
  else dropped.push('inCareer: reset to false');

  const save: CareerSave = {
    format: 'fs-career', schema: 1,
    createdAt: time('createdAt'), updatedAt: time('updatedAt'),
    seed: v.seed,
    pilot: { name: p.name, licence: p.licence },
    company: { name: c.name, callsign: c.callsign },
    cash: v.cash, reputation: Math.min(100, Math.max(0, v.reputation)), clockMin: v.clockMin,
    ratings, fleet, selectedUid, inCareer, taken, active, lastSettlement, logbook,
    flightNo: counter(v.flightNo, 'flightNo', dropped),
    ownNo: counter(v.ownNo, 'ownNo', dropped),
    settings: settingsFrom(v.settings, dropped),
  };
  if (save.reputation !== v.reputation) dropped.push('reputation: clamped to 0..100');
  return { save, dropped };
}
