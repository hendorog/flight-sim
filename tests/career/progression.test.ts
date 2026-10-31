// Proves the Career's progression and business rules (src/career/progression.ts) against docs/career.md
// "Progression", "The career clock" and "Bankruptcy": the rank thresholds both ways at 2 / 8 / 20 / 40 h with their
// reputation; the ratings' hours, reputation and cash prerequisites; lease, buy, sell, return and defuel with the
// ratings, the lessor's reputation, the fleet cap, the no-buying-below-$0 rule, delivery to the home field with
// half tanks, registrations that are never recycled, and the active-job lock; the idle lease charge (1 h a day less
// the hours flown, never negative) at the day change; the bankruptcy options (sellOwned only when it lifts the cash
// above -$5,000); Rest until tomorrow (07:30 next day, a stopped job settled as diverted); the departure window; the
// season's day of year 152 + (day mod 90); and hours by class from the logbook.

import { describe, expect, it } from 'vitest';
import { defaultWeather } from '../../src/core/types';
import { CAREER_PERF } from '../../src/career/perf';
import {
  advanceClock, bankruptcyOptions, bankruptcySellOwned, buyAircraft, buyRating, careerBlockHours, careerHours, dayOf,
  defuelAircraft, departureOpen, idleLeaseCharges, isBankrupt, leaseAircraft, leaseSignOnFee, minuteOfDay, nextUid,
  rankFor, rankOf, ratingRefusal, rest, returnLease, saleValue, seasonDayOfYear, sellAircraft, type ProgressionResult,
} from '../../src/career/progression';
import { registrationFor } from '../../src/career/registration';
import { HOME_AIRFIELD, type Airfield, type AirfieldKind } from '../../src/world/airfields';
import {
  type ActiveJob, type CareerAircraftId, type CareerLogEntry, type CareerSave, type FleetAircraft, type JobOffer,
} from '../../src/career/types';

function field(code: string, kind: AirfieldKind, north: number, east: number): Airfield {
  return {
    code, name: code, kind, north, east, elevation: 100, heading: 0, ids: ['18', '36'], length: 900, width: 23,
    flatMargin: 50, blend: 100, approachLength: 1000, circuit: 'left', frequency: 123.5, apronAlong: 0,
  };
}

const FIELDS: readonly Airfield[] = [field(HOME_AIRFIELD.code, 'home', 0, 0), field('EAST', 'sealed', 0, 37040), field('GRAS', 'grass', 37040, 0)];

/** Day 3, 10:00. */
const T0 = 3 * 1440 + 600;

function aircraft(uid: string, type: CareerAircraftId, tenure: FleetAircraft['tenure'] = 'leased', over: Partial<FleetAircraft> = {}): FleetAircraft {
  return { uid, type, tenure, registration: registrationFor(uid, 'easa'), field: HOME_AIRFIELD.code, fuelKg: 30, hours: 0, acquiredDay: 1, ...over };
}

function save(over: Partial<CareerSave> = {}): CareerSave {
  return {
    format: 'fs-career', schema: 1, createdAt: 0, updatedAt: 0, seed: 0, pilot: { name: 'P', licence: 'declared' },
    company: { name: 'Fable Air', callsign: 'Fable' }, cash: 5000, reputation: 20, clockMin: T0, ratings: ['sep'],
    fleet: [aircraft('a1', 'c152')], selectedUid: 'a1', inCareer: true, taken: [], active: null, lastSettlement: null,
    logbook: [], flightNo: 1, ownNo: 1, settings: { companyCallsign: false }, ...over,
  };
}

/** A job logbook line of `hours` block hours. */
function jobLine(hours: number, over: Partial<CareerLogEntry> = {}): CareerLogEntry {
  return {
    id: 'l1', day: 2, clockMin: 2 * 1440, kind: 'job', cls: 'trainer', jobKind: 'charter', outcome: 'completed',
    blockS: hours * 3600, airborneS: hours * 3000, nightS: 0, landingsDay: 1, landingsNight: 0, net: 0, repDelta: 0,
    remarks: '', ...over,
  };
}

function offer(over: Partial<JobOffer> = {}): JobOffer {
  return {
    id: '3-KFBL-0', kind: 'charter', day: 3, origin: HOME_AIRFIELD.code, destination: { kind: 'field', code: 'EAST' },
    client: 'Test', title: 'Test', pax: 0, payload: [], payloadKg: 0, distanceNm: 20, pay: 280, deadlineMin: 50,
    minClass: 'trainer', refType: 'c152', repRequired: 0, premium: false, weather: 'clear', windDirDeg: 0, windKt: 0, ...over,
  };
}

function job(over: Partial<ActiveJob> = {}): ActiveJob {
  return {
    offer: offer(), aircraftUid: 'a1', type: 'c152', fuelKg: 30, loading: null, items: [], phase: 'stopped', placed: true,
    acceptedAtMin: T0, elapsedBaseS: 0, elapsedS: 1800, lastKnown: { north: 37040, east: 0, onGround: true },
    everAirborne: true, stoppedAt: 'GRAS', playerWeather: defaultWeather(), ...over,
  };
}

/** The new save of a result that must succeed. */
function ok(r: ProgressionResult): CareerSave {
  if (!r.ok) throw new Error(`refused: ${r.code} ${r.text}`);
  return r.save;
}

/** The refusal code of a result. */
function code(r: ProgressionResult): string | null {
  return r.ok ? null : r.code;
}

describe('ranks', () => {
  it('promotes exactly at 2, 8, 20 and 40 block hours with the reputation for each, and not a moment before', () => {
    expect(rankFor(0, 0).id).toBe('junior');
    expect(rankFor(1.99, 100).id).toBe('junior');
    expect(rankFor(2, 30).id).toBe('line');
    expect(rankFor(2, 29).id).toBe('junior');
    expect(rankFor(7.99, 100).id).toBe('line');
    expect(rankFor(8, 45).id).toBe('senior');
    expect(rankFor(8, 44).id).toBe('line');
    expect(rankFor(19.99, 100).id).toBe('senior');
    expect(rankFor(20, 60).id).toBe('captain');
    expect(rankFor(20, 59).id).toBe('senior');
    expect(rankFor(39.99, 100).id).toBe('captain');
    expect(rankFor(40, 75).id).toBe('chief');
    expect(rankFor(40, 74).id).toBe('captain');
  });

  it('demotes when reputation falls below a rank\'s figure (ranks go both ways)', () => {
    const s = save({ logbook: [jobLine(25)], reputation: 60 });
    expect(rankOf(s).id).toBe('captain');
    expect(rankOf({ ...s, reputation: 59 }).id).toBe('senior');
    expect(rankOf({ ...s, reputation: 29 }).id).toBe('junior');
  });

  it('counts career block hours from the job lines only', () => {
    const log = [jobLine(1.5), jobLine(0.5), { ...jobLine(9), kind: 'rating' as const }];
    expect(careerBlockHours(log)).toBeCloseTo(2, 9);
  });
});

describe('ratings', () => {
  it('needs the hours, the reputation and the cash, in that order, and refuses one already held', () => {
    expect(ratingRefusal(save(), 'sep')?.code).toBe('held');
    expect(ratingRefusal(save({ logbook: [jobLine(2.99)], reputation: 100, cash: 1e6 }), 'mep')?.code).toBe('hours');
    expect(ratingRefusal(save({ logbook: [jobLine(3)], reputation: 19, cash: 1e6 }), 'mep')?.code).toBe('reputation');
    expect(ratingRefusal(save({ logbook: [jobLine(3)], reputation: 20, cash: 4499 }), 'mep')?.code).toBe('cash');
    expect(ratingRefusal(save({ logbook: [jobLine(3)], reputation: 20, cash: 4500 }), 'mep')).toBeNull();
    expect(ratingRefusal(save({ logbook: [jobLine(2)], reputation: 15, cash: 9000 }), 'heli')).toBeNull();
    expect(ratingRefusal(save({ logbook: [jobLine(7.9)], reputation: 35, cash: 12000 }), 'turbine')?.code).toBe('hours');
  });

  it('charges the training, grants the rating at once and logs it', () => {
    const s = save({ logbook: [jobLine(3)], reputation: 20, cash: 5000 });
    const out = ok(buyRating(s, 'mep'));
    expect(out.cash).toBe(500);
    expect(out.ratings).toEqual(['sep', 'mep']);
    expect(out.logbook[out.logbook.length - 1]).toMatchObject({ kind: 'rating', net: -4500 });
    expect(s.ratings).toEqual(['sep']);
    expect(code(buyRating(out, 'mep'))).toBe('held');
  });
});

describe('the market', () => {
  it('leases a type for a sign-on fee of 5 hours, delivered to the home field with half tanks and its own registration', () => {
    const out = ok(leaseAircraft(save(), 'c172s', 'easa'));
    expect(leaseSignOnFee('c172s')).toBe(950);
    expect(out.cash).toBe(5000 - 950);
    const ac = out.fleet[1];
    expect(ac).toMatchObject({
      uid: 'a2', type: 'c172s', tenure: 'leased', field: HOME_AIRFIELD.code, fuelKg: CAREER_PERF.c172s.deliveryFuelKg,
      hours: 0, acquiredDay: 3, registration: registrationFor('a2', 'easa'),
    });
    expect(out.logbook[0]).toMatchObject({ kind: 'lease', net: -950, registration: ac.registration });
    expect(ok(leaseAircraft(save(), 'c152', 'faa')).fleet[1].registration).toMatch(/^N[1-9][0-9]{2}[A-Z]{2}$/);
  });

  it('needs the type\'s ratings and the lessor\'s reputation to lease', () => {
    expect(code(leaseAircraft(save({ reputation: 100 }), 'pa34', 'easa'))).toBe('rating');
    expect(code(leaseAircraft(save({ reputation: 100 }), 'r22', 'easa'))).toBe('rating');
    expect(code(leaseAircraft(save({ ratings: ['sep', 'mep'], reputation: 29 }), 'pa34', 'easa'))).toBe('reputation');
    expect(ok(leaseAircraft(save({ ratings: ['sep', 'mep'], reputation: 30 }), 'pa34', 'easa')).cash).toBe(5000 - 2100);
    expect(code(leaseAircraft(save({ ratings: ['heli'], reputation: 100, cash: 1e6 }), 'md500', 'easa'))).toBe('rating');
    expect(code(leaseAircraft(save({ ratings: ['heli', 'turbine'], reputation: 39, cash: 1e6 }), 'md500', 'easa'))).toBe('reputation');
  });

  it('buys nothing and leases nothing that would take the cash below $0', () => {
    expect(code(leaseAircraft(save({ cash: 949 }), 'c172s', 'easa'))).toBe('cash');
    expect(ok(leaseAircraft(save({ cash: 950 }), 'c172s', 'easa')).cash).toBe(0);
    expect(code(leaseAircraft(save({ cash: -100 }), 'c152', 'easa'))).toBe('cash');
    expect(code(buyAircraft(save({ cash: 2999 }), 'c152', 'easa'))).toBe('cash');
    expect(code(buyAircraft(save({ cash: -2000 }), 'c152', 'easa'))).toBe('cash');
  });

  it('buys for the buy-in with the ratings but without the lessor\'s reputation, delivered home with half tanks', () => {
    const out = ok(buyAircraft(save({ cash: 50_000, reputation: 0, ratings: ['sep', 'turbine'] }), 'c208', 'easa'));
    expect(out.cash).toBe(50_000 - 28_500);
    expect(out.fleet[1]).toMatchObject({ type: 'c208', tenure: 'owned', fuelKg: CAREER_PERF.c208.deliveryFuelKg, field: HOME_AIRFIELD.code });
    expect(out.logbook[0]).toMatchObject({ kind: 'purchase', net: -28_500 });
    expect(code(buyAircraft(save({ cash: 1e6 }), 'c208', 'easa'))).toBe('rating');
  });

  it('holds at most six aircraft', () => {
    const fleet = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((u) => aircraft(u, 'c152'));
    expect(code(leaseAircraft(save({ fleet }), 'c152', 'easa'))).toBe('fleetFull');
    expect(code(buyAircraft(save({ fleet, cash: 1e6 }), 'c152', 'easa'))).toBe('fleetFull');
    expect(ok(leaseAircraft(save({ fleet: fleet.slice(0, 5) }), 'c152', 'easa')).fleet).toHaveLength(6);
  });

  it('sells an owned aircraft wherever it stands for 75 % of the buy-in and moves the selection', () => {
    const s = save({ fleet: [aircraft('a1', 'c152', 'owned', { field: 'GRAS' }), aircraft('a2', 'c172s')] });
    const out = ok(sellAircraft(s, 'a1'));
    expect(saleValue('c152')).toBe(2250);
    expect(out.cash).toBe(7250);
    expect(out.fleet.map((a) => a.uid)).toEqual(['a2']);
    expect(out.selectedUid).toBe('a2');
    expect(out.logbook[0]).toMatchObject({ kind: 'sale', net: 2250 });
    expect(code(sellAircraft(s, 'a2'))).toBe('notOwned');
    expect(code(sellAircraft(s, 'zz'))).toBe('notFound');
  });

  it('returns a lease for free anywhere, and refuses to return an owned one', () => {
    const s = save({ fleet: [aircraft('a1', 'c152', 'leased', { field: 'EAST' })] });
    const out = ok(returnLease(s, 'a1'));
    expect(out.cash).toBe(5000);
    expect(out.fleet).toEqual([]);
    expect(out.selectedUid).toBeNull();
    expect(out.logbook[0]).toMatchObject({ kind: 'return', net: 0 });
    expect(code(returnLease(save({ fleet: [aircraft('a1', 'c152', 'owned')] }), 'a1'))).toBe('notLeased');
  });

  it('defuels an aircraft at half the fuel\'s price, only below what is aboard', () => {
    const out = ok(defuelAircraft(save(), 'a1', 20));
    expect(out.fleet[0].fuelKg).toBe(20);
    expect(out.cash).toBe(5018); // 10 kg / 0.719 x $2.60 x 0.5
    expect(code(defuelAircraft(save(), 'a1', 30))).toBe('fuel');
    expect(code(defuelAircraft(save(), 'a1', -1))).toBe('fuel');
  });

  it('locks the aircraft on the active job against sale, return and defuel', () => {
    const owned = save({ fleet: [aircraft('a1', 'c152', 'owned')], active: job({ phase: 'airborne' }) });
    expect(code(sellAircraft(owned, 'a1'))).toBe('jobActive');
    expect(code(defuelAircraft(owned, 'a1', 10))).toBe('jobActive');
    expect(code(returnLease(save({ active: job({ phase: 'dispatched' }) }), 'a1'))).toBe('jobActive');
  });

  it('never hands a sold airframe\'s uid (and registration) to the next one', () => {
    const s = ok(buyAircraft(save({ cash: 1e5 }), 'c152', 'easa'));
    expect(s.fleet[1].uid).toBe('a2');
    const sold = ok(sellAircraft(s, 'a2'));
    expect(nextUid(sold)).toBe('a3');
    expect(ok(leaseAircraft(sold, 'c152', 'easa')).fleet[1].registration).not.toBe(s.fleet[1].registration);
  });
});

describe('the idle lease charge', () => {
  it('charges each lease 1 h a day less the hours it flew that day, never negative, and nothing for owned aircraft', () => {
    const fleet = [aircraft('a1', 'c152'), aircraft('a2', 'c172s'), aircraft('a3', 'pa38', 'owned')];
    const log = [
      jobLine(0.4, { day: 3, registration: fleet[0].registration }),
      jobLine(1.5, { day: 3, registration: fleet[1].registration }),
      jobLine(1, { day: 2, registration: fleet[0].registration }),
    ];
    const charges = idleLeaseCharges(save({ fleet, logbook: log }), 3);
    expect(charges.map((c) => [c.uid, c.amount])).toEqual([['a1', 72], ['a2', 0]]);
    expect(idleLeaseCharges(save({ fleet, logbook: log }), 2).map((c) => c.amount)).toEqual([0, 190]);
  });

  it('is paid at the day change with a logbook line, and today\'s taken offers are cleared', () => {
    const s = save({ taken: ['3-KFBL-1'] });
    const same = advanceClock(s, T0 + 60);
    expect(same.cash).toBe(5000);
    expect(same.taken).toEqual(['3-KFBL-1']);
    const next = advanceClock(s, 4 * 1440 + 450);
    expect(next.clockMin).toBe(4 * 1440 + 450);
    expect(next.cash).toBe(5000 - 120);
    expect(next.taken).toEqual([]);
    expect(next.logbook[0]).toMatchObject({ kind: 'leaseIdle', net: -120, day: 3 });
    expect(advanceClock(s, T0 - 100).clockMin).toBe(T0);
  });
});

describe('bankruptcy', () => {
  it('opens below -$5,000', () => {
    expect(isBankrupt(save({ cash: -5000 }))).toBe(false);
    expect(isBankrupt(save({ cash: -5001 }))).toBe(true);
  });

  it('offers the bank sale only when it lifts the cash above -$5,000', () => {
    expect(bankruptcyOptions(save({ cash: -9000 }))).toEqual(['restart']);
    const owned = (type: CareerAircraftId, cash: number) => save({ cash, fleet: [aircraft('a1', type, 'owned'), aircraft('a2', 'c172s')] });
    expect(bankruptcyOptions(owned('c152', -7250))).toEqual(['restart']); // -7,250 + 2,250 = -5,000: not above
    expect(bankruptcyOptions(owned('c152', -7249))).toEqual(['sellOwned', 'restart']);
    expect(bankruptcyOptions(owned('c152', -9000))).toEqual(['restart']);
    expect(bankruptcyOptions(owned('pa34', -9000))).toEqual(['sellOwned', 'restart']);
  });

  it('sells every owned aircraft and keeps the leases', () => {
    const s = save({ cash: -9000, fleet: [aircraft('a1', 'pa34', 'owned'), aircraft('a2', 'c172s'), aircraft('a3', 'c152', 'owned')] });
    const out = ok(bankruptcySellOwned(s));
    expect(out.cash).toBe(-9000 + 7125 + 2250);
    expect(out.fleet.map((a) => a.uid)).toEqual(['a2']);
    expect(out.selectedUid).toBe('a2');
    expect(out.logbook[0].kind).toBe('bankruptcy');
    expect(code(bankruptcySellOwned(save({ cash: -9000 })))).toBe('cash');
  });
});

describe('the career clock', () => {
  it('reads the day and the minute of the day', () => {
    expect(dayOf(T0)).toBe(3);
    expect(minuteOfDay(T0)).toBe(600);
  });

  it('allows departures from 07:00 to 18:00', () => {
    expect(departureOpen(3 * 1440 + 419)).toBe(false);
    expect(departureOpen(3 * 1440 + 420)).toBe(true);
    expect(departureOpen(3 * 1440 + 1080)).toBe(true);
    expect(departureOpen(3 * 1440 + 1081)).toBe(false);
  });

  it('flies career day n on day of year 152 + (n mod 90)', () => {
    expect(seasonDayOfYear(0)).toBe(152);
    expect(seasonDayOfYear(1)).toBe(153);
    expect(seasonDayOfYear(89)).toBe(241);
    expect(seasonDayOfYear(90)).toBe(152);
    expect(seasonDayOfYear(91)).toBe(153);
    expect(seasonDayOfYear(1000)).toBe(152 + (1000 % 90));
  });

  it('rests until 07:30 the next day, ending today', () => {
    const r = rest(save({ taken: ['3-KFBL-0'] }), FIELDS);
    if (!r.ok) throw new Error('refused');
    expect(r.settlement).toBeNull();
    expect(r.save.clockMin).toBe(4 * 1440 + 450);
    expect(r.save.taken).toEqual([]);
    expect(r.save.cash).toBe(5000 - 120);
    // Rest at 00:30: still the next day's 07:30.
    const early = rest(save({ clockMin: 4 * 1440 + 30 }), FIELDS);
    expect(early.ok && early.save.clockMin).toBe(5 * 1440 + 450);
  });

  it('settles a job still stopped as diverted when resting, the aircraft left at the stop', () => {
    const r = rest(save({ active: job() }), FIELDS);
    if (!r.ok) throw new Error('refused');
    expect(r.settlement?.outcome).toBe('diverted');
    expect(r.settlement?.repDelta).toBe(-4);
    expect(r.save.active).toBeNull();
    expect(r.save.fleet[0].field).toBe('GRAS');
    expect(r.save.reputation).toBe(16);
    expect(r.save.clockMin).toBe(4 * 1440 + 450);
    expect(r.save.logbook.find((e) => e.kind === 'job')?.outcome).toBe('diverted');
  });

  it('refuses to rest while a job is active and not stopped', () => {
    const r = rest(save({ active: job({ phase: 'airborne', stoppedAt: undefined }) }), FIELDS);
    expect(r.ok).toBe(false);
  });
});

describe('hours by class', () => {
  it('sums block and airborne hours per class, landings and jobs done and failed by kind', () => {
    const log = [
      jobLine(1, { cls: 'trainer', jobKind: 'charter', landingsDay: 1 }),
      jobLine(2, { cls: 'heli', jobKind: 'freight', outcome: 'diverted', landingsNight: 2, nightS: 1800 }),
      jobLine(0.5, { cls: 'trainer', jobKind: 'charter' }),
      { ...jobLine(5), kind: 'lease' as const },
    ];
    const h = careerHours(log);
    expect(h.byClass.trainer.blockH).toBeCloseTo(1.5, 9);
    expect(h.byClass.trainer.airborneH).toBeCloseTo(1.25, 9);
    expect(h.byClass.heli.blockH).toBeCloseTo(2, 9);
    expect(h.byClass.twin.blockH).toBe(0);
    expect(h.totalBlockH).toBeCloseTo(3.5, 9);
    expect(h.nightH).toBeCloseTo(0.5, 9);
    expect(h.landingsDay).toBe(3);
    expect(h.landingsNight).toBe(2);
    expect(h.jobsDone.charter).toBe(2);
    expect(h.jobsFailed.freight).toBe(1);
  });
});
