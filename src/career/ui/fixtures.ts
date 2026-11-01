// Fixture careers for the Career pages (dev/career.html and tests/career/ui.test.ts): a career played for real
// through the pure core (createCareer, boardFor, loadSheet, settleJob, rest, the market and ratings), so every
// figure a page shows is one the game could produce, plus the states the pages branch on: no career, no licence,
// another world, a job stopped at another field, a pending crash, a job waiting for another type, a debrief, and an
// overdrawn company. Deterministic: fixed seed, fixed clock, no Math.random. Takes the world's fields as an
// argument (the dev page passes the real seed-0 fields, the tests synthetic ones), so this module pulls in no
// terrain.

import { defaultWeather } from '../../core/types';
import { HOME_AIRFIELD, type Airfield } from '../../world/airfields';
import { createCareer } from '../create';
import { settleJob } from '../economy';
import { distanceM, fieldStand } from '../geo';
import { boardFor } from '../jobs';
import { loadSheet } from '../loadsheet';
import { CAREER_PERF } from '../perf';
import { advanceClock, buyAircraft, buyRating, leaseAircraft, rest } from '../progression';
import { assignStations } from '../stations';
import type { ActiveJob, CareerSave, FleetAircraft, JobFlightReport, JobOffer, JobStripModel, PayloadItem } from '../types';
import type { CareerUiModel, CareerView } from './models';
import { defaultFuelKg } from './widgets';

/** Every screen the dev page and the shots script know. */
export const FIXTURE_SCREENS = [
  'locked', 'create', 'seed', 'hub', 'hub-job', 'hub-first', 'board', 'reposition', 'dispatch', 'dispatch-switch', 'fleet', 'market',
  'pilot', 'logbook', 'stop', 'bankrupt', 'debrief', 'debrief-crash', 'strip', 'strip-heli',
] as const;
/** One of FIXTURE_SCREENS (the dev page's `screen=`). */
export type FixtureScreen = (typeof FIXTURE_SCREENS)[number];

/** What a fixture screen shows: the model, the page to open (null: none, the strip only), and the extras. */
export interface Fixture {
  model: CareerUiModel;
  page: CareerView | null;
  dispatchOfferId?: string;
  /** Page state to preset (the fleet's market tab). */
  memo?: Record<string, unknown>;
  strip?: { model: JobStripModel; canAbandon: boolean };
}

const SEED = 0;
const NOW = Date.UTC(2026, 9, 31, 10, 0, 0);

/** A completed (or other outcome) report for a job, at plausible figures that vary with `k`. */
function reportFor(job: ActiveJob, fields: readonly Airfield[], k: number, over: Partial<JobFlightReport> = {}): JobFlightReport {
  const destCode = job.offer.destination.kind === 'field' ? job.offer.destination.code : job.offer.origin;
  const dest = fields.find((f) => f.code === destCode)!;
  const sheet = loadSheet(job.offer, { uid: job.aircraftUid, type: job.type, tenure: 'leased', registration: '', field: job.offer.origin, fuelKg: job.fuelKg, hours: 0, acquiredDay: 0 }, job.fuelKg, { ...emptySave(), reputation: 100, ratings: ['sep', 'mep', 'turbine', 'heli'] }, fields);
  const flightMin = sheet.flightTimeMin * (0.85 + (k % 3) * 0.06);
  const blockS = Math.round((flightMin + 14) * 60);
  const wps = job.offer.waypoints?.length ?? 0;
  const report: JobFlightReport = {
    outcome: 'completed', atField: dest.code, position: { north: dest.north, east: dest.east }, elapsedMin: flightMin + 22,
    blockS, airborneS: Math.round(flightMin * 60), nightS: 0, landingsDay: 1, landingsNight: 0, takeoffs: 1,
    landing: { score: 58 + ((k * 17) % 38), sinkFpm: 180 + ((k * 53) % 260), bounces: k % 5 === 4 ? 1 : 0, firstWheel: 'left', helicopter: false, onTarget: true, distAimFt: 120 + ((k * 41) % 300) - 80, centrelineM: ((k * 7) % 30) / 10 },
    comfort: { score: 70 + ((k * 11) % 28), deductions: { vertical: 4 + (k % 4), lateral: 2, bank: 1 + (k % 3), pitch: 0, descent: 1, stall: 0, landing: k % 4 } },
    maxG: 1.3, minG: 0.7, overspeedS: 0, stallWarningS: 0, fuelAtEndKg: Math.max(0, job.fuelKg - sheet.tripFuelKg - sheet.taxiFuelKg - sheet.climbFuelKg) * (0.95 + (k % 2) * 0.04),
    onApron: k % 3 !== 0, onRunway: false, waypointsDone: wps, waypointsTotal: wps, ...over,
  };
  return report;
}

/** A blank save for the planning calls above (only cash, reputation, ratings and the clock matter there). */
function emptySave(): CareerSave {
  return createCareer({ pilotName: 'x', companyName: 'x', callsign: '', start: 'c152' }, { seed: SEED, licence: 'declared', authority: 'easa', homeCode: HOME_AIRFIELD.code, now: NOW });
}

/** An active job for `offer` flown by `ac`, at the required fuel, items seated for its type. */
export function activeFor(save: CareerSave, offer: JobOffer, ac: FleetAircraft, fields: readonly Airfield[], over: Partial<ActiveJob> = {}): ActiveJob {
  const sheet = loadSheet(offer, ac, ac.fuelKg, save, fields);
  const fuelKg = Math.min(sheet.maxFuelKg, Math.max(sheet.requiredFuelKg, ac.fuelKg));
  const seat = assignStations(offer.payload, ac.type);
  const items: PayloadItem[] = seat.ok ? [...seat.items] : [];
  const origin = fields.find((f) => f.code === offer.origin)!;
  return {
    offer, aircraftUid: ac.uid, type: ac.type, fuelKg, loading: null, items, phase: 'dispatched', placed: false,
    acceptedAtMin: save.clockMin, elapsedBaseS: 0, elapsedS: 0, lastKnown: { north: origin.north, east: origin.east, onGround: true },
    everAirborne: false, playerWeather: defaultWeather(), charges: { fuelUsd: Math.round(sheet.fuelCost), defuelCreditUsd: 0, stopFeesUsd: 0 },
    ...over,
  };
}

/** The first offer on today's board here that `ac` can fly (an ok load sheet at its default fuel). */
function firstFlyable(save: CareerSave, ac: FleetAircraft, fields: readonly Airfield[], skip = 0): JobOffer | null {
  const day = Math.floor(save.clockMin / 1440);
  let n = 0;
  for (const o of boardFor(save.seed, day, ac.field, fields)) {
    if (save.taken.includes(o.id)) continue;
    const probe = loadSheet(o, ac, ac.fuelKg, save, fields);
    const s = loadSheet(o, ac, Math.min(probe.maxFuelKg, Math.max(ac.fuelKg, probe.requiredFuelKg)), save, fields);
    if (s.ok && n++ >= skip) return o;
  }
  return null;
}

/** Fly `n` jobs with the selected aircraft, settling each as completed (resting when the day runs out). */
function playJobs(save: CareerSave, fields: readonly Airfield[], n: number, k0 = 0): CareerSave {
  let s = save;
  for (let k = 0; k < n; k++) {
    const ac = s.fleet.find((a) => a.uid === s.selectedUid)!;
    let offer = firstFlyable(s, ac, fields, k % 2);
    if (!offer) {
      const r = rest(s, fields);
      if (r.ok) s = r.save;
      offer = firstFlyable(s, s.fleet.find((a) => a.uid === s.selectedUid)!, fields);
      if (!offer) break;
    }
    const job = activeFor(s, offer, s.fleet.find((a) => a.uid === s.selectedUid)!, fields, { phase: 'landed', placed: true, everAirborne: true });
    s = { ...s, taken: [...s.taken, offer.id], active: job };
    s = settleJob(s, job, reportFor(job, fields, k + k0), fields).save;
    if (s.clockMin % 1440 > 17 * 60) {
      const r = rest(s, fields);
      if (r.ok) s = r.save;
    }
  }
  return s;
}

/**
 * Today's first untaken one-passenger trainer charter from home that the PC-12 could also fly (an ok load sheet at
 * its default fuel), or null.
 */
export function dispatchCharter(save: CareerSave, fields: readonly Airfield[]): JobOffer | null {
  const pc12 = save.fleet.find((a) => a.type === 'pc12' && a.field === HOME_AIRFIELD.code);
  if (!pc12) return null;
  const atDefault = (o: JobOffer, ac: FleetAircraft) => loadSheet(o, ac, defaultFuelKg(loadSheet(o, ac, ac.fuelKg, save, fields), ac.fuelKg), save, fields);
  return boardFor(save.seed, Math.floor(save.clockMin / 1440), HOME_AIRFIELD.code, fields)
    .find((o) => o.kind === 'charter' && o.minClass === 'trainer' && o.pax > 0 && !save.taken.includes(o.id) && atDefault(o, pc12).ok) ?? null;
}

/** A career a few days in: about a dozen jobs, a leased Tomahawk, an owned PC-12, a leased R44 away. */
export function playedCareer(fields: readonly Airfield[]): CareerSave {
  let s = createCareer({ pilotName: 'Alex Morgan', companyName: 'Fable Air', callsign: '', start: 'c152' }, {
    seed: SEED, licence: 'school', authority: 'easa', homeCode: HOME_AIRFIELD.code, now: NOW,
  });
  s = playJobs(s, fields, 12);
  // The market and ratings, on a generous day (the fixture's figures are reset after).
  s = { ...s, cash: 250000, reputation: 70 };
  for (const r of ['heli', 'mep', 'turbine'] as const) {
    const b = buyRating(s, r);
    s = b.ok ? b.save : { ...s, ratings: [...new Set([...s.ratings, r])] };
  }
  for (const [how, type] of [['lease', 'pa38'], ['buy', 'pc12'], ['lease', 'r44']] as const) {
    const res = how === 'lease' ? leaseAircraft(s, type, 'easa') : buyAircraft(s, type, 'easa');
    if (res.ok) s = res.save;
  }
  const away = fields.find((f) => f.kind === 'sealed') ?? fields[1];
  s = {
    ...s, cash: 18240, reputation: 48,
    // The trainer flown home at the end of the last day (its board is the home field's), the R44 away on a job.
    fleet: s.fleet.map((a) => (a.type === 'r44' ? { ...a, field: away.code, fuelKg: 74, hours: 3.2 }
      : a.type === 'pa38' ? { ...a, fuelKg: CAREER_PERF.pa38.usableFuelKg }
        : a.type === 'c152' ? { ...a, field: HOME_AIRFIELD.code, fuelKg: 38 } : a)),
  };
  // 10:40 on the first day (from the latest) whose home board has a one-passenger trainer charter the PC-12 could
  // also fly, so the dispatch fixture shows the Tomahawk's defuel and the PC-12's losesMoney warning; days skipped
  // go through advanceClock (idle leases charged), as resting would.
  const today = Math.floor(s.clockMin / 1440);
  const at = (d: number): number => d * 1440 + 10 * 60 + 40;
  let pick = s.clockMin <= at(today) ? at(today) : at(today + 1);
  for (let d = Math.floor(pick / 1440); d < today + 15; d++) {
    if (dispatchCharter({ ...s, clockMin: at(d), taken: d === today ? s.taken : [] }, fields)) {
      pick = at(d);
      break;
    }
  }
  s = pick > s.clockMin ? advanceClock(s, pick) : { ...s, clockMin: pick };
  return s;
}

/** The fixture for one screen. */
export function careerFixture(screen: FixtureScreen, fields: readonly Airfield[]): Fixture {
  const played = playedCareer(fields);
  const home = played.fleet.find((a) => a.uid === played.selectedUid)!;
  const board = (s: CareerSave): JobOffer[] => {
    const ac = s.fleet.find((a) => a.uid === s.selectedUid) ?? s.fleet[0];
    return ac ? boardFor(s.seed, Math.floor(s.clockMin / 1440), ac.field, fields) : [];
  };
  const model = (s: CareerSave | null, over: Partial<CareerUiModel> = {}): CareerUiModel => ({
    save: s, fields, board: s ? board(s) : [], worldSeed: SEED, bootedType: 'c152', storeKind: 'local', storage: 'ok', authority: 'easa',
    licence: 'school', suggestedPilotName: 'Alex Morgan', ...over,
  });
  const offers = board(played);
  const charter = dispatchCharter(played, fields) ?? offers.find((o) => !played.taken.includes(o.id)) ?? offers[0];

  switch (screen) {
    case 'locked':
      return { model: model(null, { licence: null }), page: 'locked' };
    case 'create':
      return { model: model(null), page: 'create' };
    case 'seed':
      return { model: model(played, { worldSeed: 7 }), page: 'seed' };
    case 'hub-first': {
      const fresh = createCareer({ pilotName: 'Alex Morgan', companyName: 'Fable Air', callsign: '', start: 'c152' }, {
        seed: SEED, licence: 'school', authority: 'easa', homeCode: HOME_AIRFIELD.code, now: NOW,
      });
      return { model: model(fresh), page: 'hub' };
    }
    case 'hub':
    case 'board':
    case 'reposition':
    case 'pilot':
    case 'logbook':
      return { model: model(played), page: screen };
    case 'fleet':
      return { model: model(played), page: 'fleet' };
    case 'market':
      return { model: model(played), page: 'fleet', memo: { 'fleet.tab': 'market' } };
    case 'dispatch': {
      // The Tomahawk with full tanks: too heavy with the passenger, so the slider starts at the most the load allows
      // (a defuel, credited); the PC-12 beside it would lose money on a trainer job.
      const s = { ...played, selectedUid: played.fleet.find((a) => a.type === 'pa38')?.uid ?? played.selectedUid };
      return { model: model(s), page: 'dispatch', dispatchOfferId: charter.id };
    }
    case 'dispatch-switch': {
      const s = { ...played, selectedUid: played.fleet.find((a) => a.type === 'pc12')?.uid ?? played.selectedUid };
      return { model: model(s, { storeKind: 'mem' }), page: 'dispatch', dispatchOfferId: charter.id };
    }
    case 'hub-job': {
      const job = activeFor(played, charter, home, fields, { phase: 'airborne', placed: true, everAirborne: true, elapsedS: 14 * 60 });
      return { model: model({ ...played, active: job, taken: [...played.taken, charter.id] }), page: 'hub' };
    }
    case 'stop': {
      const other = fields.find((f) => f.code !== charter.origin && (charter.destination.kind !== 'field' || f.code !== charter.destination.code) && f.kind !== 'home') ?? fields[2];
      const job = activeFor(played, charter, home, fields, {
        phase: 'stopped', placed: true, everAirborne: true, stoppedAt: other.code, elapsedS: 31 * 60,
        lastKnown: { north: other.north, east: other.east, onGround: true },
      });
      return { model: model({ ...played, active: job }, { liveFuelKg: 9.5 }), page: 'stop' };
    }
    case 'debrief':
    case 'debrief-crash': {
      const job = activeFor(played, charter, home, fields, { phase: 'landed', placed: true, everAirborne: true, elapsedS: 38 * 60 });
      const s0 = { ...played, active: job, taken: [...played.taken, charter.id] };
      const crash = screen === 'debrief-crash';
      const destCode = charter.destination.kind === 'field' ? charter.destination.code : charter.origin;
      const dest = fields.find((f) => f.code === destCode)!;
      const rep = reportFor(job, fields, 5, crash
        ? { outcome: 'crashed', atField: null, position: { north: (dest.north + fields[0].north) / 2, east: (dest.east + fields[0].east) / 2 }, landing: null, crashReason: 'Nose gear collapsed in a heavy landing', landingsDay: 0 }
        : { landing: { score: 88, sinkFpm: 140, bounces: 0, firstWheel: 'left', helicopter: false, onTarget: true, distAimFt: 160, centrelineM: 0.6 } });
      const { save: s1 } = settleJob(s0, job, rep, fields);
      return { model: model(s1), page: 'debrief' };
    }
    case 'bankrupt': {
      const s = { ...played, cash: -7350 };
      return { model: model(s), page: 'bankrupt' };
    }
    case 'strip':
    case 'strip-heli': {
      const heli = screen === 'strip-heli';
      const destCode = charter.destination.kind === 'field' ? charter.destination.code : charter.origin;
      const dest = fields.find((f) => f.code === destCode)!;
      const stand = fieldStand(dest);
      const m: JobStripModel = heli
        ? { title: '2 passengers to the lakes', target: `${dest.code} ${dest.name}`, distanceNm: 0.4, bearingDeg: 212, etaMin: 1, remainingMin: 9, enduranceMin: 96,
          projectedReserveMin: 18, waypointIndex: null, waypointsTotal: null, windDirDeg: 250, windKt: 9, spotDistM: Math.round(distanceM(stand, { north: stand.north + 30, east: stand.east + 22 })),
          comfort: 64, phase: 'airborne', hint: 'Land on the stand and shut down' }
        : { title: charter.title, target: 'Point B, 7 NM north-east', distanceNm: 4.2, bearingDeg: 47, etaMin: 6, remainingMin: 21, enduranceMin: 142,
          projectedReserveMin: 61, waypointIndex: 1, waypointsTotal: 3, windDirDeg: 270, windKt: 12, spotDistM: null, comfort: 91, phase: 'airborne',
          hint: 'Overfly the turning point below 2,500 ft' };
      const job = activeFor(played, charter, home, fields, { phase: 'airborne', placed: true, everAirborne: true, elapsedS: 20 * 60 });
      return { model: model({ ...played, active: job }), page: null, strip: { model: m, canAbandon: false } };
    }
  }
}
