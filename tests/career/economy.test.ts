// Proves the Career's job settlement (src/career/economy.ts settleJob) against docs/career.md "Settlement": the
// worked example to the dollar ($219, +2 reputation) with and without the dispatch charges recorded; the rank's pay
// bonus; on time, early and late (with the late cap); the scenic route share and a route missed; low and critical
// reserve for an aeroplane and a helicopter; the heavy-landing inspection and a hard landing with no pay line;
// comfort, overspeed (capped), high g, a runway stop; every failed outcome's money, reputation and where the aircraft
// ends up (diverted, outlanded, crashed with the excess clamps and two days out of service, lost, abandoned on the
// ground, at a stop and after take-off); reputation clamped to 0..100; the aircraft, fuel, hours, logbook, clock,
// selection and active job updated without changing the save passed in; and the spoken summary at most 60 words.

import { describe, expect, it } from 'vitest';
import { defaultWeather } from '../../src/core/types';
import { insuranceExcess } from '../../src/career/costs';
import { nearestFieldCode, settleJob, settledOutcome } from '../../src/career/economy';
import { CAREER_PERF } from '../../src/career/perf';
import {
  OCCUPANT_KG, type ActiveJob, type CareerAircraftId, type CareerLogEntry, type CareerSave, type FleetAircraft,
  type JobFlightReport, type JobOffer, type MoneyLineId, type Settlement,
} from '../../src/career/types';
import type { Airfield, AirfieldKind } from '../../src/world/airfields';

/** A synthetic field: runway along north-south, centre at (north, east). */
function field(code: string, kind: AirfieldKind, length: number, north: number, east: number): Airfield {
  return {
    code, name: code, kind, north, east, elevation: 100, heading: 0, ids: ['18', '36'], length, width: 23,
    flatMargin: 50, blend: 100, approachLength: 1000, circuit: 'left', frequency: 123.5, apronAlong: 0,
  };
}

const NM20 = 20 * 1852;
const FIELDS: readonly Airfield[] = [
  field('HOME', 'home', 1200, 0, 0),
  field('EAST', 'sealed', 900, 0, NM20),
  field('GRAS', 'grass', 600, NM20, 0),
];

/** Day 3, 10:00. */
const T0 = 3 * 1440 + 600;

function offer(over: Partial<JobOffer> = {}): JobOffer {
  return {
    id: '3-HOME-0', kind: 'charter', day: 3, origin: 'HOME', destination: { kind: 'field', code: 'EAST' }, client: 'Test',
    title: '1 passenger to EAST', pax: 1, payload: [{ kind: 'passenger', label: 'Passenger 1', kg: OCCUPANT_KG }],
    payloadKg: OCCUPANT_KG, distanceNm: 20, pay: 280, deadlineMin: 50, minClass: 'trainer', refType: 'c152',
    repRequired: 0, premium: false, weather: 'clear', windDirDeg: 0, windKt: 0, ...over,
  };
}

function aircraft(type: CareerAircraftId = 'c152', over: Partial<FleetAircraft> = {}): FleetAircraft {
  return { uid: 'a1', type, tenure: 'leased', registration: 'G-TEST', field: 'HOME', fuelKg: 30, hours: 10, acquiredDay: 1, ...over };
}

function job(over: Partial<ActiveJob> = {}): ActiveJob {
  return {
    offer: offer(), aircraftUid: 'a1', type: 'c152', fuelKg: 42, loading: null, items: [], phase: 'done', placed: true,
    acceptedAtMin: T0, elapsedBaseS: 0, elapsedS: 38 * 60, lastKnown: { north: 0, east: NM20, onGround: true },
    everAirborne: true, playerWeather: defaultWeather(), ...over,
  };
}

function save(over: Partial<CareerSave> = {}): CareerSave {
  const j = over.active === undefined ? job() : over.active;
  return {
    format: 'fs-career', schema: 1, createdAt: 0, updatedAt: 0, seed: 0, pilot: { name: 'P', licence: 'declared' },
    company: { name: 'Fable Air', callsign: 'Fable' }, cash: 5000, reputation: 20, clockMin: T0, ratings: ['sep'],
    fleet: [aircraft(j?.type ?? 'c152')], selectedUid: 'a1', inCareer: true, taken: [j?.offer.id ?? 'x'], active: j,
    lastSettlement: null, logbook: [], flightNo: 12, ownNo: 1, settings: { companyCallsign: false }, ...over,
  };
}

/** The doc's worked example's flight: 38 min, 0.6 block h, landing 72, comfort 84, 22 kg left at EAST. */
function report(over: Partial<JobFlightReport> = {}): JobFlightReport {
  return {
    outcome: 'completed', atField: 'EAST', position: { north: 0, east: NM20 }, elapsedMin: 38, blockS: 0.6 * 3600,
    airborneS: 1500, nightS: 0, landingsDay: 1, landingsNight: 0, takeoffs: 1,
    landing: { score: 72, sinkFpm: 250, bounces: 0, firstWheel: 'left', helicopter: false, onTarget: true },
    comfort: { score: 84, deductions: { vertical: 0, lateral: 0, bank: 0, pitch: 0, descent: 0, stall: 0, landing: 0 } },
    maxG: 1.4, minG: 0.6, overspeedS: 0, stallWarningS: 0, fuelAtEndKg: 22, onApron: true, onRunway: false,
    waypointsDone: 0, waypointsTotal: 0, ...over,
  };
}

/** Settle the save's active job with the report. */
function settle(s: CareerSave, r: JobFlightReport): { save: CareerSave; settlement: Settlement } {
  return settleJob(s, s.active!, r, FIELDS);
}

/** A money line's amount (0 when absent). */
function amount(st: Settlement, id: MoneyLineId): number {
  return st.lines.filter((l) => l.id === id).reduce((a, l) => a + l.amount, 0);
}

/** A save with a job of this type, kind and offer changes (the fleet entry matches). */
function saveFor(type: CareerAircraftId, offerOver: Partial<JobOffer> = {}, jobOver: Partial<ActiveJob> = {}, saveOver: Partial<CareerSave> = {}): CareerSave {
  const j = job({ type, offer: offer(offerOver), fuelKg: 30, ...jobOver });
  return save({ active: j, fleet: [aircraft(type)], ...saveOver });
}

describe('settleJob: the worked example', () => {
  it('settles the doc\'s $280 C152 charter to the dollar: net $219 and +2 reputation', () => {
    const s = save();
    const { settlement: st } = settle(s, report());
    expect(st.outcome).toBe('completed');
    expect(st.lines.map((l) => [l.id, l.amount])).toEqual([
      ['base', 280], ['onTime', 28], ['early', 14], ['landing', 8], ['comfort', 20],
      ['fuel', -43], ['landingFee', -16], ['aircraftHours', -72],
    ]);
    expect(st.net).toBe(219);
    expect(st.repDelta).toBe(2);
    expect(st.cashAfter).toBe(5219);
    expect(st.repAfter).toBe(22);
    expect(st.rankBefore).toBe('junior');
    expect(st.rankAfter).toBe('junior');
  });

  it('uses the charges the CareerSystem recorded when the job carries them, stop fees included', () => {
    const s = save({ active: job({ charges: { fuelUsd: 43, defuelCreditUsd: 7, stopFeesUsd: 5 } }) });
    const { settlement: st } = settle(s, report());
    expect(amount(st, 'fuel')).toBe(-43);
    expect(amount(st, 'defuel')).toBe(7);
    expect(amount(st, 'landingFee')).toBe(-21);
    expect(st.net).toBe(219 + 7 - 5);
  });

  it('prices a defuel at dispatch as a credit when no charges are recorded', () => {
    // 30 kg aboard, dispatched with 20 kg: 10 kg drained at half of $2.60/0.719 kg.
    const s = save({ active: job({ fuelKg: 20 }) });
    const { settlement: st } = settle(s, report());
    expect(amount(st, 'fuel')).toBe(0);
    expect(amount(st, 'defuel')).toBe(18);
  });

  it('moves the aircraft, updates its fuel and hours, logs the job, advances the clock and leaves the input unchanged', () => {
    const s = save();
    const before = structuredClone(s);
    const { save: out, settlement: st } = settle(s, report());
    expect(s).toEqual(before);
    const ac = out.fleet[0];
    expect(ac.field).toBe('EAST');
    expect(ac.fuelKg).toBe(22);
    expect(ac.hours).toBeCloseTo(10.6, 9);
    expect(st.aircraftAt).toBe('EAST');
    expect(out.active).toBeNull();
    expect(out.lastSettlement).toEqual(st);
    expect(out.flightNo).toBe(13);
    expect(settle(save({ selectedUid: null }), report()).save.selectedUid).toBe('a1');
    expect(out.clockMin).toBe(T0 + 38 + 30);
    expect(out.cash).toBe(5219);
    expect(out.reputation).toBe(22);
    const e = out.logbook[out.logbook.length - 1];
    expect(e).toEqual(st.logEntry);
    expect(e).toMatchObject({
      kind: 'job', day: 3, clockMin: T0, type: 'c152', cls: 'trainer', registration: 'G-TEST', from: 'HOME', to: 'EAST',
      jobKind: 'charter', jobId: '3-HOME-0', outcome: 'completed', blockS: 2160, net: 219, repDelta: 2,
    });
    expect(e.remarks).toContain('apron');
  });

  it('marks a test arrival in the logbook', () => {
    const { settlement: st } = settle(save(), report({ test: true }));
    expect(st.logEntry.remarks).toContain('(test)');
  });
});

describe('settleJob: pay lines on a completed job', () => {
  it('adds the rank\'s pay bonus as its own line and takes every percentage of the sum', () => {
    // A line pilot (2 h, reputation 30): +3 %.
    const log: CareerLogEntry = {
      id: 'l1', day: 2, clockMin: 2 * 1440, kind: 'job', blockS: 2 * 3600, airborneS: 0, nightS: 0, landingsDay: 0,
      landingsNight: 0, net: 0, repDelta: 0, remarks: '',
    };
    const { settlement: st } = settle(save({ reputation: 30, logbook: [log] }), report());
    expect(st.rankBefore).toBe('line');
    expect(amount(st, 'base')).toBe(280);
    expect(amount(st, 'rankBonus')).toBe(8);
    expect(amount(st, 'onTime')).toBe(29); // 288.4 x 0.1
    expect(amount(st, 'early')).toBe(14); // 14.42
  });

  it('pays on time without the early bonus past 80 % of the deadline, and nothing extra when late', () => {
    const onTime = settle(save(), report({ elapsedMin: 41 })).settlement;
    expect(amount(onTime, 'onTime')).toBe(28);
    expect(amount(onTime, 'early')).toBe(0);
    const exact = settle(save(), report({ elapsedMin: 50 })).settlement;
    expect(amount(exact, 'onTime')).toBe(28);
    expect(amount(exact, 'late')).toBe(0);
  });

  it('takes 2 % a started minute late, -1 reputation up to 10 min and -3 beyond, capped at 60 %', () => {
    const five = settle(save(), report({ elapsedMin: 55 })).settlement;
    expect(amount(five, 'onTime')).toBe(0);
    expect(amount(five, 'late')).toBe(-28);
    expect(five.repLines).toContainEqual({ reason: 'Late', delta: -1 });
    expect(five.repDelta).toBe(1);
    const part = settle(save(), report({ elapsedMin: 50.2 })).settlement;
    expect(amount(part, 'late')).toBe(-6);
    const ten = settle(save(), report({ elapsedMin: 60 })).settlement;
    expect(ten.repLines.map((r) => r.delta)).toContain(-1);
    const eleven = settle(save(), report({ elapsedMin: 61 })).settlement;
    expect(amount(eleven, 'late')).toBe(-62);
    expect(eleven.repLines.map((r) => r.delta)).toContain(-3);
    const capped = settle(save(), report({ elapsedMin: 200 })).settlement;
    expect(amount(capped, 'late')).toBe(-168);
  });

  it('pays the landing bonus from 60 up and +1 reputation from 85', () => {
    const r = (score: number) => report({ landing: { score, sinkFpm: 150, bounces: 0, firstWheel: 'left', helicopter: false, onTarget: true } });
    expect(amount(settle(save(), r(59)).settlement, 'landing')).toBe(0);
    expect(amount(settle(save(), r(100)).settlement, 'landing')).toBe(28);
    const good = settle(save(), r(85)).settlement;
    expect(good.repLines).toContainEqual({ reason: 'Good landing', delta: 1 });
    expect(amount(settle(save(), report({ landing: null })).settlement, 'landing')).toBe(0);
  });

  it('costs a hard landing reputation and no pay line, a heavy one an inspection by class, aeroplane and helicopter', () => {
    const land = (sinkFpm: number, helicopter: boolean) => ({ score: 40, sinkFpm, bounces: 0, firstWheel: 'left' as const, helicopter, onTarget: true });
    const hard = settle(save(), report({ landing: land(650, false) })).settlement;
    expect(hard.lines.some((l) => l.id === 'heavyLanding')).toBe(false);
    expect(hard.repLines).toContainEqual({ reason: 'Hard landing', delta: -2 });
    expect(hard.net).toBe(settle(save(), report({ landing: land(250, false) })).settlement.net);
    const soft = settle(save(), report({ landing: land(600, false) })).settlement;
    expect(soft.repLines.some((r) => r.reason === 'Hard landing')).toBe(false);
    const heavy = settle(save(), report({ landing: land(950, false) })).settlement;
    expect(amount(heavy, 'heavyLanding')).toBe(-500);
    expect(heavy.repLines).toContainEqual({ reason: 'Hard landing', delta: -2 });
    // R44 (class mult 2.0): hard above 400 fpm, heavy above 600.
    const r44 = () => saveFor('r44', { minClass: 'heli', refType: 'r44' });
    const hHard = settle(r44(), report({ fuelAtEndKg: 60, landing: land(450, true) })).settlement;
    expect(hHard.lines.some((l) => l.id === 'heavyLanding')).toBe(false);
    expect(hHard.repLines).toContainEqual({ reason: 'Hard landing', delta: -2 });
    const hHeavy = settle(r44(), report({ fuelAtEndKg: 60, landing: land(650, true) })).settlement;
    expect(amount(hHeavy, 'heavyLanding')).toBe(-1000);
  });

  it('weights comfort by kind: charter 0.15 and scenic 0.30 both ways, freight none', () => {
    const c = (score: number) => ({ score, deductions: { vertical: 0, lateral: 0, bank: 0, pitch: 0, descent: 0, stall: 0, landing: 0 } });
    expect(amount(settle(save(), report({ comfort: c(100) })).settlement, 'comfort')).toBe(42);
    expect(amount(settle(save(), report({ comfort: c(35) })).settlement, 'comfort')).toBe(-21);
    const smooth = settle(save(), report({ comfort: c(90) })).settlement;
    expect(smooth.repLines).toContainEqual({ reason: 'Smooth ride', delta: 1 });
    const rough = settle(save(), report({ comfort: c(49) })).settlement;
    expect(rough.repLines).toContainEqual({ reason: 'Uncomfortable ride', delta: -2 });
    const freight = settle(saveFor('c152', { kind: 'freight', pax: 0 }), report({ comfort: c(10) })).settlement;
    expect(amount(freight, 'comfort')).toBe(0);
    expect(freight.repLines.some((r) => r.reason === 'Uncomfortable ride')).toBe(false);
  });

  it('charges overspeed at $40 a second times the class mult, at most $2,000', () => {
    expect(amount(settle(save(), report({ overspeedS: 10 })).settlement, 'overspeed')).toBe(-400);
    expect(amount(settle(save(), report({ overspeedS: 100 })).settlement, 'overspeed')).toBe(-2000);
    const pc12 = settle(saveFor('pc12', { minClass: 'turbine', refType: 'pc12' }), report({ fuelAtEndKg: 500, overspeedS: 1 })).settlement;
    expect(amount(pc12, 'overspeed')).toBe(-128);
    expect(pc12.repLines).toContainEqual({ reason: 'Overspeed', delta: -3 });
  });

  it('inspects above 3.0 g with passengers, 3.5 g without, and below 0 g', () => {
    expect(amount(settle(save(), report({ maxG: 3.0 })).settlement, 'highG')).toBe(0);
    expect(amount(settle(save(), report({ maxG: 3.01 })).settlement, 'highG')).toBe(-300);
    const freight = () => saveFor('c152', { kind: 'freight', pax: 0 });
    expect(amount(settle(freight(), report({ maxG: 3.4 })).settlement, 'highG')).toBe(0);
    expect(amount(settle(freight(), report({ maxG: 3.6 })).settlement, 'highG')).toBe(-300);
    expect(amount(settle(freight(), report({ minG: -0.1 })).settlement, 'highG')).toBe(-300);
    // A medevac carries its patient as payload (no seat), but it is a job with people aboard: the 3.0 g limit.
    const medevac = saveFor('c152', { kind: 'medevac', pax: 0, payload: [{ kind: 'patient', label: 'Patient', kg: OCCUPANT_KG }] });
    expect(amount(settle(medevac, report({ maxG: 3.2 })).settlement, 'highG')).toBe(-300);
  });

  it('penalises a low and a critical reserve for an aeroplane (20 / 10 min) and a helicopter (10 / 6.7 min)', () => {
    // C152 at 19 kg/h: 20 min = 6.333 kg, 10 min = 3.167 kg.
    const flow = CAREER_PERF.c152.fuelFlowKgH / 60;
    const fine = settle(save(), report({ fuelAtEndKg: 20 * flow + 0.01 })).settlement;
    expect(amount(fine, 'lowReserve')).toBe(0);
    const low = settle(save(), report({ fuelAtEndKg: 20 * flow - 0.01 })).settlement;
    expect(amount(low, 'lowReserve')).toBe(-28);
    expect(low.repLines).toContainEqual({ reason: 'Low fuel reserve', delta: -2 });
    const crit = settle(save(), report({ fuelAtEndKg: 10 * flow - 0.01 })).settlement;
    expect(amount(crit, 'lowReserve')).toBe(-70);
    expect(crit.repLines).toContainEqual({ reason: 'Critical fuel reserve', delta: -5 });
    expect(crit.repLines.some((r) => r.reason === 'Low fuel reserve')).toBe(false);
    // R44 at its flow: reserve 20 min, low below 10, critical below 6.67.
    const hf = CAREER_PERF.r44.fuelFlowKgH / 60;
    const r44 = () => saveFor('r44', { minClass: 'heli', refType: 'r44', pay: 400 });
    expect(amount(settle(r44(), report({ fuelAtEndKg: 10 * hf + 0.01 })).settlement, 'lowReserve')).toBe(0);
    expect(amount(settle(r44(), report({ fuelAtEndKg: 10 * hf - 0.01 })).settlement, 'lowReserve')).toBe(-40);
    expect(amount(settle(r44(), report({ fuelAtEndKg: (20 / 3) * hf + 0.01 })).settlement, 'lowReserve')).toBe(-40);
    const hCrit = settle(r44(), report({ fuelAtEndKg: (20 / 3) * hf - 0.01 })).settlement;
    expect(amount(hCrit, 'lowReserve')).toBe(-100);
    expect(hCrit.repLines).toContainEqual({ reason: 'Critical fuel reserve', delta: -5 });
  });

  it('takes 5 % and a point of reputation for stopping on the runway', () => {
    const st = settle(save(), report({ onRunway: true, onApron: false })).settlement;
    expect(amount(st, 'runwayStop')).toBe(-14);
    expect(st.repLines).toContainEqual({ reason: 'Stopped on the runway', delta: -1 });
    expect(st.logEntry.remarks).toContain('runway');
  });

  it('gives +1 for a positioning flight and +4 for a medevac', () => {
    expect(settle(saveFor('c152', { kind: 'positioning', pax: 0, payload: [], payloadKg: 0 }), report()).settlement.repLines).toContainEqual({ reason: 'Job completed', delta: 1 });
    expect(settle(saveFor('c152', { kind: 'medevac' }), report()).settlement.repLines).toContainEqual({ reason: 'Job completed', delta: 4 });
  });
});

describe('settleJob: scenic flights', () => {
  const scenic = { kind: 'scenic' as const, destination: { kind: 'field' as const, code: 'HOME' }, pay: 300, deadlineMin: 60 };
  const wps = (done: number) => report({ atField: 'HOME', waypointsDone: done, waypointsTotal: 3 });

  it('pays the share of the route flown and costs a point of reputation per turning point missed', () => {
    const st = settle(saveFor('c152', scenic), wps(2)).settlement;
    expect(st.outcome).toBe('completed');
    expect(amount(st, 'base')).toBe(300);
    expect(amount(st, 'route')).toBe(-100);
    expect(amount(st, 'onTime')).toBe(20);
    expect(st.repLines.filter((r) => r.reason === 'Turning point missed')).toHaveLength(1);
    expect(st.logEntry.remarks).toContain('2 of 3 turning points');
    const full = settle(saveFor('c152', scenic), wps(3)).settlement;
    expect(amount(full, 'route')).toBe(0);
    expect(amount(full, 'onTime')).toBe(30);
  });

  it('settles a scenic flight with no turning point overflown as routeMissed: no pay, -4, costs still due', () => {
    expect(settledOutcome(wps(0))).toBe('routeMissed');
    const st = settle(saveFor('c152', scenic), wps(0)).settlement;
    expect(st.outcome).toBe('routeMissed');
    expect(st.lines.map((l) => l.id).filter((id) => ['base', 'onTime', 'early', 'landing', 'comfort'].includes(id))).toEqual([]);
    expect(st.repDelta).toBe(-4);
    expect(amount(st, 'landingFee')).toBe(-26); // home: 20 + 8 x 0.757 t
    expect(amount(st, 'aircraftHours')).toBe(-72);
    expect(st.net).toBeLessThan(0);
    expect(st.aircraftAt).toBe('HOME');
  });
});

describe('settleJob: failed outcomes', () => {
  it('diverted: no pay, -4, the stop field\'s fee and the hours, the aircraft at the stop', () => {
    const s = save({ active: job({ phase: 'stopped', stoppedAt: 'GRAS' }) });
    const st = settle(s, report({ outcome: 'diverted', atField: 'GRAS', landing: null })).settlement;
    expect(st.outcome).toBe('diverted');
    expect(amount(st, 'base')).toBe(0);
    expect(amount(st, 'landingFee')).toBe(-5);
    expect(amount(st, 'aircraftHours')).toBe(-72);
    expect(st.repDelta).toBe(-4);
    expect(st.aircraftAt).toBe('GRAS');
  });

  it('outlanded: recovery $1,500 x the class mult, -8, the aircraft at the nearest field', () => {
    const st = settle(save(), report({ outcome: 'outlanded', atField: null, position: { north: NM20 - 3000, east: 1000 } })).settlement;
    expect(amount(st, 'recovery')).toBe(-1500);
    expect(amount(st, 'landingFee')).toBe(0);
    expect(st.repDelta).toBe(-8);
    expect(st.aircraftAt).toBe('GRAS');
    const r44 = settle(saveFor('r44'), report({ outcome: 'outlanded', atField: null })).settlement;
    expect(amount(r44, 'recovery')).toBe(-3000);
  });

  it('crashed: the insurance excess (5 % of list, $2,000 to $25,000), -20, two days out of service at the nearest field', () => {
    const s = save({ reputation: 50 });
    const { save: out, settlement: st } = settle(s, report({ outcome: 'crashed', atField: null, crashReason: 'Struck the ground', position: { north: 100, east: 200 } }));
    expect(amount(st, 'repair')).toBe(-2250);
    expect(amount(st, 'base')).toBe(0);
    expect(st.repDelta).toBe(-20);
    expect(st.aircraftAt).toBe('HOME');
    expect(st.groundedUntilDay).toBe(5);
    expect(out.fleet[0].groundedUntilDay).toBe(5);
    expect(out.fleet[0].field).toBe('HOME');
    expect(st.logEntry.remarks).toContain('Struck the ground');
    const pc12 = settle(saveFor('pc12'), report({ outcome: 'crashed', atField: null })).settlement;
    expect(amount(pc12, 'repair')).toBe(-25000);
    expect(insuranceExcess({ ...CAREER_PERF.c152, listPrice: 10_000 })).toBe(2000);
  });

  it('lost: recovery $300 x the class mult, -5, the aircraft at the field nearest the last known position', () => {
    const st = settle(save(), report({ outcome: 'lost', atField: null, landing: null, position: { north: 0, east: NM20 - 500 } })).settlement;
    expect(amount(st, 'recovery')).toBe(-300);
    expect(st.repDelta).toBe(-5);
    expect(st.aircraftAt).toBe('EAST');
  });

  it('abandoned on the ground: -2, fuel bought still paid, the aircraft and its fuel stay at the origin', () => {
    const s = save({ active: job({ everAirborne: false }) });
    const { save: out, settlement: st } = settle(s, report({ outcome: 'abandoned', atField: 'HOME', elapsedMin: 4, blockS: 0, fuelAtEndKg: 42, landing: null }));
    expect(st.repDelta).toBe(-2);
    expect(amount(st, 'fuel')).toBe(-43);
    expect(amount(st, 'landingFee')).toBe(0);
    expect(amount(st, 'recovery')).toBe(0);
    expect(st.aircraftAt).toBe('HOME');
    expect(out.fleet[0].fuelKg).toBe(42);
  });

  it('abandoned while held at a stop: on the ground, -2, no recovery, the aircraft left at the stop field', () => {
    const s = save({ active: job({ phase: 'stopped', stoppedAt: 'GRAS' }) });
    const st = settle(s, report({ outcome: 'abandoned', atField: null, position: { north: NM20, east: 0 }, landing: null })).settlement;
    expect(st.repDelta).toBe(-2);
    expect(amount(st, 'recovery')).toBe(0);
    expect(st.aircraftAt).toBe('GRAS');
  });

  it('abandoned after take-off: settled as lost (recovery, nearest field) with -5', () => {
    const st = settle(save(), report({ outcome: 'abandoned', atField: null, position: { north: NM20, east: 900 } })).settlement;
    expect(amount(st, 'recovery')).toBe(-300);
    expect(st.repDelta).toBe(-5);
    expect(st.aircraftAt).toBe('GRAS');
  });
});

describe('settleJob: clamps, clock and summary', () => {
  it('clamps reputation to 0..100 and reports the clamped change', () => {
    const top = settle(save({ reputation: 99 }), report({ landing: { score: 95, sinkFpm: 100, bounces: 0, firstWheel: 'left', helicopter: false, onTarget: true } })).settlement;
    expect(top.repAfter).toBe(100);
    expect(top.repDelta).toBe(1);
    const bottom = settle(save({ reputation: 5 }), report({ outcome: 'crashed', atField: null })).settlement;
    expect(bottom.repAfter).toBe(0);
    expect(bottom.repDelta).toBe(-5);
  });

  it('ends the day when a job runs past midnight: idle lease charged, taken offers cleared', () => {
    // Accepted 23:30; 38 min + 30 min turnaround takes the clock into the next day.
    const late = 3 * 1440 + 23 * 60 + 30;
    const s = save({ clockMin: late, active: job({ acceptedAtMin: late }) });
    const { save: out } = settle(s, report());
    expect(out.clockMin).toBe(late + 68);
    expect(out.taken).toEqual([]);
    // The job's 0.6 h counted against day 3's idle hour: 0.4 h x $120.
    const idle = out.logbook.filter((e) => e.kind === 'leaseIdle');
    expect(idle.map((e) => e.net)).toEqual([-48]);
    expect(out.cash).toBe(5000 + 219 - 48);
  });

  it('never moves the clock back', () => {
    const s = save({ clockMin: T0 + 500 });
    expect(settle(s, report()).save.clockMin).toBe(T0 + 500);
  });

  it('speaks a summary of at most 60 words for every outcome', () => {
    const outcomes: JobFlightReport['outcome'][] = ['completed', 'diverted', 'outlanded', 'crashed', 'abandoned', 'lost'];
    for (const o of outcomes) {
      const st = settle(save(), report({ outcome: o, overspeedS: 5, maxG: 4, fuelAtEndKg: 1, elapsedMin: 90, landing: { score: 10, sinkFpm: 1000, bounces: 2, firstWheel: 'nose', helicopter: false, onTarget: false } })).settlement;
      expect(st.summary.length).toBeGreaterThan(0);
      expect(st.summary.split(/\s+/).length).toBeLessThanOrEqual(60);
    }
    expect(settle(save(), report()).settlement.summary).toContain('$219');
  });

  it('finds the nearest field, or the fallback with no fields', () => {
    expect(nearestFieldCode(FIELDS, { north: 1, east: NM20 - 1 }, 'X')).toBe('EAST');
    expect(nearestFieldCode([], { north: 0, east: 0 }, 'X')).toBe('X');
  });
});
