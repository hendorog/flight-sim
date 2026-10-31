// Job settlement (docs/career.md "Settlement"): settleJob turns the job runtime's JobFlightReport into money and
// reputation lines, moves the aircraft, updates its fuel and hours, writes the logbook line, advances the career
// clock, selects the job's aircraft (its field is the next start) and clears the active job. Pure: the save in is
// never changed; the new save and the debrief's Settlement come out.
//
// The order of the lines follows the debrief: pay (base, the rank bonus, the scenic route share, on time or late,
// landing, heavy-landing inspection, comfort, overspeed, high g, low reserve, runway stop), then what failure
// costs (recovery, the insurance excess), then the costs on every outcome (fuel, defuel credit, landing fees,
// aircraft hours). Every money line is rounded to whole dollars and the net is their sum, so the doc's worked
// example comes out to the dollar ($219, +2). Choices the design leaves open, fixed here:
// - Base = offer pay x (1 + the rank's pay bonus); the bonus is its own 'rankBonus' line and every percentage is
//   of that sum. A scenic flight with turning points missed pays base x done / total (the 'route' line takes the
//   rest), and the later percentages are of the reduced base.
// - Late is counted in started minutes (-2 % each, at most -60 %); more than 10 min late costs -3 reputation
//   instead of -1. A hard landing (above 600 fpm, helicopters 400) costs -2 reputation and no pay line (its toll is
//   in the landing and comfort scores); a heavy one (900 / 600) also an inspection of $500 x the class mult.
// - "Class mult" on inspections, overspeed, recovery is the flown type's class payMult (it is that airframe's
//   repair), not the offer's least class.
// - Low reserve: fuel at shutdown below (planning reserve - 10 min) of cruise flow, critical below a third of the
//   reserve (the critical line replaces the low one).
// - Comfort counts on the kinds with a PAY_RULES comfortWeight (charter, scenic, medevac): both the money line and
//   the comfort reputation.
// - Landing fees: the destination's on a completed job (and a scenic route missed: back at the origin), the stop
//   field's on a diversion, none where the aircraft did not land at a field; plus fees already paid at stops.
// - Fuel: ActiveJob.charges (the dispatch and stop purchases) when the CareerSystem recorded them; without it the
//   uplift or defuel at dispatch is priced from the job's fuel against the fleet entry's (pre-job) fuel at the origin.
// - Abandoned after take-off settles as a lost aircraft would (recovery, the nearest field) with the abandoned-
//   in-the-air reputation; on the ground (never airborne, held at a stop, or the report names the field it rests
//   at) the aircraft stays where it is and the fuel bought stays in its tanks.
// - High g: the passenger limit (3.0) applies to any job carrying people: pax aboard, or a kind whose comfort counts
//   (a medevac's patient is payload, not a seat).
// - The clock moves to max(now, accepted + elapsed + turnaround); a day boundary crossed ends that day
//   (src/career/progression.ts advanceClock), so cashAfter includes any idle lease charge it paid.

import type { Airfield } from '../world/airfields';
import { defuelCredit, enduranceMin, fuelCost, hoursCost, insuranceExcess, landingFee, reserveMin, upliftAndDefuel, type PlaceKind } from './costs';
import { CAREER_PERF, isRotorcraftClass } from './perf';
import { advanceClock, careerBlockHours, dayOf, rankFor } from './progression';
import {
  CLASS_RULES, CLOCK_RULES, PAY_RULES, REP_RULES, SCORING_RULES, type ActiveJob, type CareerLogEntry, type CareerSave,
  type JobFlightReport, type MoneyLine, type MoneyLineId, type RepLine, type SettledOutcome, type Settlement,
} from './types';

/** Reputation bounds. */
const REP_MIN = 0;
const REP_MAX = 100;

/** The field nearest a NED point (`fallback` if `fields` is empty). */
export function nearestFieldCode(fields: readonly Airfield[], p: { north: number; east: number }, fallback: string): string {
  let best = fallback;
  let bestD = Infinity;
  for (const f of fields) {
    const d = Math.hypot(f.north - p.north, f.east - p.east);
    if (d < bestD) {
      bestD = d;
      best = f.code;
    }
  }
  return best;
}

/** The place kind of a field code (home, sealed, grass); 'sealed' for a code not in `fields`. */
function kindOf(code: string, fields: readonly Airfield[]): PlaceKind {
  return fields.find((f) => f.code === code)?.kind ?? 'sealed';
}

/** The settled outcome: a completed scenic flight with no turning point overflown is 'routeMissed'. */
export function settledOutcome(report: JobFlightReport): SettledOutcome {
  if (report.outcome === 'completed' && report.waypointsTotal > 0 && report.waypointsDone === 0) return 'routeMissed';
  return report.outcome;
}

/**
 * Settle a job (docs/career.md "Settlement"): `job` is the save's active job, `report` the runtime's (or the
 * player's Give up: outcome 'diverted'), `fields` the world's airfields. Returns the new save (cash, reputation,
 * aircraft field / fuel / hours / grounding, logbook, clock, flight number, `active` null, `lastSettlement`) and the
 * debrief's Settlement. Pure.
 */
export function settleJob(save: CareerSave, job: ActiveJob, report: JobFlightReport, fields: readonly Airfield[]): { save: CareerSave; settlement: Settlement } {
  const perf = CAREER_PERF[job.type];
  const heli = isRotorcraftClass(perf.cls);
  const mult = CLASS_RULES[perf.cls].payMult;
  const offer = job.offer;
  const ac = save.fleet.find((a) => a.uid === job.aircraftUid);
  const tenure = ac?.tenure ?? 'leased';
  const S = SCORING_RULES;
  const R = REP_RULES;

  const hoursBefore = careerBlockHours(save.logbook);
  const rankBefore = rankFor(hoursBefore, save.reputation);
  const outcome = settledOutcome(report);
  const lines: MoneyLine[] = [];
  const reps: RepLine[] = [];
  const line = (id: MoneyLineId, label: string, amount: number): void => {
    const a = Math.round(amount);
    if (a !== 0 || id === 'base') lines.push({ id, label, amount: a });
  };
  const rep = (reason: string, delta: number): void => {
    reps.push({ reason, delta });
  };
  const nearest = (): string => nearestFieldCode(fields, report.position, offer.origin);
  const destCode = offer.destination.kind === 'field' ? offer.destination.code : null;

  let aircraftAt: string;
  let feePlace: string | null = null;
  let groundedFor = 0;
  /** Summary parts: the safety point and the strength. */
  const notes: { safety: string | null; strength: string | null } = { safety: null, strength: null };

  switch (outcome) {
    case 'completed': {
      const pay = offer.pay;
      line('base', 'Base pay', pay);
      const bonus = rankBefore.payBonus;
      if (bonus > 0) line('rankBonus', `${rankBefore.label} bonus`, pay * bonus);
      let base = pay * (1 + bonus);
      // Scenic: pay for the share of the route flown.
      const total = report.waypointsTotal;
      const done = Math.min(report.waypointsDone, total);
      if (total > 0 && done < total) {
        line('route', `Route: ${done} of ${total} turning points`, -base * (total - done) / total);
        base = base * done / total;
        for (let i = done; i < total; i++) rep('Turning point missed', R.waypointMissed);
      }
      // Time.
      const elapsed = report.elapsedMin;
      if (elapsed <= offer.deadlineMin) {
        line('onTime', 'On time', base * S.onTime);
        if (elapsed <= S.earlyFraction * offer.deadlineMin) line('early', 'Early', base * S.early);
      } else {
        const lateMin = Math.ceil(elapsed - offer.deadlineMin - 1e-9);
        line('late', `Late (${lateMin} min)`, -base * Math.min(S.lateCap, S.latePerMin * lateMin));
        if (elapsed - offer.deadlineMin > R.lateLargeMin) rep(`More than ${R.lateLargeMin} min late`, R.lateLarge);
        else rep('Late', R.lateSmall);
      }
      // Landing.
      const l = report.landing;
      if (l) {
        if (l.score >= S.landingFrom) line('landing', `Landing (${Math.round(l.score)})`, base * S.landingMax * (l.score - S.landingFrom) / (100 - S.landingFrom));
        const hardFpm = heli ? S.hardSinkHeliFpm : S.hardSinkFpm;
        const heavyFpm = heli ? S.heavySinkHeliFpm : S.heavySinkFpm;
        if (l.sinkFpm > heavyFpm) {
          line('heavyLanding', 'Heavy landing inspection', -S.heavyInspection * mult);
          notes.safety = `That landing was heavy, ${Math.round(l.sinkFpm)} feet a minute: the aircraft needed an inspection.`;
        }
        if (l.sinkFpm > hardFpm) {
          rep('Hard landing', R.hardLanding);
          notes.safety ??= `That landing was hard, ${Math.round(l.sinkFpm)} feet a minute: hold the flare longer.`;
        } else if (l.score >= R.goodLandingScore) {
          rep('Good landing', R.goodLanding);
          notes.strength ??= 'A good landing.';
        }
      }
      // Comfort.
      const w = PAY_RULES[offer.kind].comfortWeight;
      if (w > 0) {
        const c = report.comfort.score;
        if (c > S.comfortFrom) line('comfort', `Comfort (${Math.round(c)})`, base * w * (c - S.comfortFrom) / (100 - S.comfortFrom));
        else if (c < S.comfortFrom) line('comfort', `Comfort (${Math.round(c)})`, -base * w * (S.comfortFrom - c) / S.comfortFrom);
        if (c >= R.comfortHighScore) {
          rep('Smooth ride', R.comfortHigh);
          notes.strength ??= 'A smooth ride for the passengers.';
        } else if (c < R.comfortLowScore) {
          rep('Uncomfortable ride', R.comfortLow);
        }
      }
      // Penalties.
      if (report.overspeedS > 0) {
        line('overspeed', 'Overspeed inspection', -Math.min(S.overspeedCap, S.overspeedPerS * report.overspeedS * mult));
        rep('Overspeed', R.overspeed);
        notes.safety = 'You exceeded the never-exceed speed: watch the airspeed in the descent.';
      }
      const gMax = offer.pax > 0 || PAY_RULES[offer.kind].comfortWeight > 0 ? S.gHighPax : S.gHigh;
      if (report.maxG > gMax || report.minG < S.gLow) {
        line('highG', 'Load factor inspection', -S.gInspection * mult);
        rep('Load factor exceeded', R.highG);
        notes.safety ??= 'The load factor went past the limit: fly smoothly.';
      }
      const endurance = enduranceMin(perf, report.fuelAtEndKg);
      const reserve = reserveMin(perf);
      if (endurance < reserve * S.criticalReserveFraction) {
        line('lowReserve', 'Critical fuel reserve', -base * S.criticalReservePenalty);
        rep('Critical fuel reserve', R.criticalReserve);
        notes.safety = `You landed with ${Math.round(endurance)} minutes of fuel: never eat into the reserve.`;
      } else if (endurance < reserve - S.lowReserveMarginMin) {
        line('lowReserve', 'Low fuel reserve', -base * S.lowReservePenalty);
        rep('Low fuel reserve', R.lowReserve);
        notes.safety ??= `You landed with ${Math.round(endurance)} minutes of fuel: plan to keep the reserve.`;
      }
      if (report.onRunway) {
        line('runwayStop', 'Stopped on the runway', -base * S.runwayStop);
        rep('Stopped on the runway', R.runwayStop);
      }
      rep('Job completed', offer.kind === 'positioning' ? R.completedPositioning : offer.kind === 'medevac' ? R.completedMedevac : R.completed);
      if (elapsed <= offer.deadlineMin) notes.strength ??= 'You were on time.';
      aircraftAt = report.atField ?? destCode ?? nearest();
      feePlace = report.atField ?? destCode;
      break;
    }
    case 'routeMissed':
      rep('No turning point overflown', R.routeMissed);
      notes.safety = 'None of the turning points was overflown: the client did not get the flight.';
      aircraftAt = report.atField ?? offer.origin;
      feePlace = report.atField ?? offer.origin;
      break;
    case 'diverted':
      rep('Diverted', R.diverted);
      aircraftAt = report.atField ?? job.stoppedAt ?? nearest();
      feePlace = report.atField ?? job.stoppedAt ?? null;
      break;
    case 'outlanded':
      line('recovery', 'Recovery', -S.recovery * mult);
      rep('Outlanding', R.outlanded);
      notes.safety = 'You shut down away from any field: plan the fuel and divert early.';
      aircraftAt = nearest();
      break;
    case 'crashed':
      line('repair', 'Insurance excess', -insuranceExcess(perf));
      rep('Crash', R.crashed);
      notes.safety = 'The aircraft crashed.';
      aircraftAt = nearest();
      groundedFor = S.groundedDays;
      break;
    case 'lost':
      line('recovery', 'Recovery', -S.lostRecovery * mult);
      rep('Flight lost', R.lost);
      aircraftAt = nearest();
      break;
    case 'abandoned':
      if (job.everAirborne && job.phase !== 'stopped' && report.atField === null) {
        line('recovery', 'Recovery', -S.lostRecovery * mult);
        rep('Abandoned after take-off', R.abandonedAir);
        aircraftAt = nearest();
      } else {
        rep('Abandoned', R.abandonedGround);
        aircraftAt = report.atField ?? job.stoppedAt ?? offer.origin;
      }
      break;
  }

  // Costs on every outcome.
  const ch = job.charges ?? dispatchCharges(job, ac?.fuelKg ?? job.fuelKg, fields);
  line('fuel', 'Fuel', -ch.fuelUsd);
  line('defuel', 'Defuel credit', ch.defuelCreditUsd);
  const fee = (feePlace !== null ? landingFee(kindOf(feePlace, fields), perf.mtowKg) : 0) + ch.stopFeesUsd;
  line('landingFee', ch.stopFeesUsd > 0 ? 'Landing fees' : 'Landing fee', -fee);
  const blockH = Math.max(0, report.blockS) / 3600;
  line('aircraftHours', tenure === 'owned' ? `Aircraft hours (${blockH.toFixed(1)} h owned)` : `Lease (${blockH.toFixed(1)} h)`, -hoursCost(blockH, perf, tenure));

  const net = lines.reduce((s, x) => s + x.amount, 0);
  const repRaw = reps.reduce((s, x) => s + x.delta, 0);
  const repAfter = Math.min(REP_MAX, Math.max(REP_MIN, save.reputation + repRaw));
  const repDelta = repAfter - save.reputation;

  // The new save.
  let s: CareerSave = structuredClone(save);
  s.cash += net;
  s.reputation = repAfter;
  const remarks: string[] = [];
  if (report.test) remarks.push('(test)');
  if (report.waypointsTotal > 0) remarks.push(`${Math.min(report.waypointsDone, report.waypointsTotal)} of ${report.waypointsTotal} turning points`);
  if (report.onRunway) remarks.push('stopped on the runway');
  else if (report.onApron) remarks.push('parked on the apron');
  if (report.crashReason) remarks.push(report.crashReason);
  if (outcome !== 'completed') remarks.push(outcome === 'routeMissed' ? 'route missed' : outcome);
  const logEntry: CareerLogEntry = {
    id: `l${s.logbook.length + 1}`, day: dayOf(job.acceptedAtMin), clockMin: job.acceptedAtMin, kind: 'job',
    type: job.type, cls: perf.cls, registration: ac?.registration, from: offer.origin, to: aircraftAt,
    jobKind: offer.kind, jobId: offer.id, outcome, blockS: Math.max(0, report.blockS), airborneS: Math.max(0, report.airborneS),
    nightS: Math.max(0, report.nightS), landingsDay: report.landingsDay, landingsNight: report.landingsNight,
    net, repDelta, remarks: remarks.join('; '),
  };
  s.logbook.push(logEntry);
  s.active = null;
  s.flightNo += 1;
  const doneAt = job.acceptedAtMin + Math.max(0, report.elapsedMin) + CLOCK_RULES.turnaroundMin;
  s = advanceClock(s, Math.max(s.clockMin, doneAt));
  const fa = s.fleet.find((a) => a.uid === job.aircraftUid);
  let groundedUntilDay: number | undefined;
  if (fa) {
    s.selectedUid = fa.uid;
    fa.field = aircraftAt;
    fa.fuelKg = Math.max(0, report.fuelAtEndKg);
    fa.hours += blockH;
    if (groundedFor > 0) {
      groundedUntilDay = dayOf(s.clockMin) + groundedFor;
      fa.groundedUntilDay = groundedUntilDay;
    }
  }
  const rankAfter = rankFor(careerBlockHours(s.logbook), s.reputation);

  const settlement: Settlement = {
    offerId: offer.id, outcome, lines, net, repLines: reps, repDelta, cashAfter: s.cash, repAfter,
    rankBefore: rankBefore.id, rankAfter: rankAfter.id, aircraftAt,
    ...(groundedUntilDay !== undefined ? { groundedUntilDay } : {}),
    report, logEntry, summary: summaryOf(outcome, net, report, offer.deadlineMin, notes),
  };
  s.lastSettlement = settlement;
  return { save: s, settlement };
}

/**
 * The dispatch's fuel money when the job carries no `charges`: the uplift (or defuel) from what the aircraft had
 * (`aboardKg`, the fleet entry's pre-job fuel) to the job's fuel, at the origin's price.
 */
function dispatchCharges(job: ActiveJob, aboardKg: number, fields: readonly Airfield[]): { fuelUsd: number; defuelCreditUsd: number; stopFeesUsd: number } {
  const grade = CAREER_PERF[job.type].fuel;
  const { upliftKg, defuelKg } = upliftAndDefuel(job.fuelKg, aboardKg);
  return { fuelUsd: fuelCost(upliftKg, grade, kindOf(job.offer.origin, fields)), defuelCreditUsd: defuelCredit(defuelKg, grade), stopFeesUsd: 0 };
}

/** Outcome headlines for the spoken debrief. */
const HEADLINE: Readonly<Record<SettledOutcome, string>> = {
  completed: 'Job complete.',
  routeMissed: 'The scenic route was missed.',
  diverted: 'The job was given up at a stop.',
  outlanded: 'You landed out.',
  crashed: 'The job ended in a crash.',
  abandoned: 'The job was abandoned.',
  lost: 'The flight could not be resumed.',
};

/** The debrief's spoken summary: the outcome and net, safety first, one strength, one main point (at most 60 words). */
function summaryOf(outcome: SettledOutcome, net: number, report: JobFlightReport, deadlineMin: number, notes: { safety: string | null; strength: string | null }): string {
  const parts = [HEADLINE[outcome], `Net ${net < 0 ? 'loss' : 'result'} ${net < 0 ? '-' : ''}$${Math.abs(net).toLocaleString('en-GB')}.`];
  if (notes.safety) parts.push(notes.safety);
  if (notes.strength) parts.push(notes.strength);
  if (outcome === 'completed' && report.elapsedMin > deadlineMin) parts.push('Main point: plan the time, the client noticed you were late.');
  else if (!notes.safety && outcome === 'completed') parts.push('Main point: keep it up.');
  const words = parts.join(' ').split(/\s+/);
  return words.slice(0, 60).join(' ');
}
