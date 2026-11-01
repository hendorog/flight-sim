// Proves the Career's single fit rule (src/career/fit.ts fitOffer) and the airframe registrations
// (src/career/registration.ts): each refusal code (seats, stationLimit, overMtow, runwayShort, grass) is returned
// exactly past its limit and null at or just inside it, the checks run in the documented order, the offer's wind
// and a scenic loop change the required fuel, helicopters and off-field sites skip the runway checks; and
// registrationFor is deterministic, of the EASA and FAA forms, and distinct over 1,000 fleet uids.

import { describe, expect, it } from 'vitest';
import { fitOffer, offerFuelPlan, routeWindOf, takeoffMassAtRequired } from '../../src/career/fit';
import { CAREER_PERF } from '../../src/career/perf';
import { registrationFor } from '../../src/career/registration';
import { OCCUPANT_KG, type CareerAircraftId, type JobOffer, type OfferItem } from '../../src/career/types';
import type { Airfield, AirfieldKind } from '../../src/world/airfields';

/** A synthetic field: runway along north-south, centre at (north, east). */
function field(code: string, kind: AirfieldKind, length: number, north: number, east: number): Airfield {
  return {
    code, name: code, kind, north, east, elevation: 100, heading: 0, ids: ['18', '36'], length, width: 23,
    flatMargin: 50, blend: 100, approachLength: 1000, circuit: 'left', frequency: 123.5, apronAlong: 0,
  };
}

/** 20 NM in metres. */
const NM20 = 20 * 1852;
const FIELDS: readonly Airfield[] = [
  field('HOME', 'home', 1200, 0, 0),
  field('EAST', 'sealed', 900, 0, NM20),
  field('NRTH', 'grass', 450, NM20, 0),
  field('SHRT', 'sealed', 650, -NM20, 0),
  field('SHR2', 'sealed', 649.9, 0, -NM20),
  field('LONG', 'grass', 1000, NM20, NM20),
  field('S899', 'sealed', 899.9, -NM20, -NM20),
];

const pax = (kg = OCCUPANT_KG): OfferItem => ({ kind: 'passenger', label: 'Passenger', kg });
const freight = (kg: number): OfferItem => ({ kind: 'freight', label: 'Freight', kg });

function offer(payload: OfferItem[], over: Partial<JobOffer> = {}): JobOffer {
  return {
    id: '1-HOME-0', kind: 'freight', day: 1, origin: 'HOME', destination: { kind: 'field', code: 'EAST' }, client: 'Test',
    title: 'Test', pax: payload.filter((p) => p.kind === 'passenger').length, payload, payloadKg: payload.reduce((s, p) => s + p.kg, 0),
    distanceNm: 20, pay: 100, deadlineMin: 60, minClass: 'trainer', refType: 'c152', repRequired: 0, premium: false,
    weather: 'clear', windDirDeg: 0, windKt: 0, ...over,
  };
}

/** The freight that brings a type to MTOW at the required fuel, after `first` kg in its first station. */
function atMtow(type: CareerAircraftId, first: number, over: Partial<JobOffer> = {}): number {
  const required = offerFuelPlan(offer([], over), type, FIELDS).requiredKg;
  const p = CAREER_PERF[type];
  return p.mtowKg - p.emptyKg - OCCUPANT_KG - required - first;
}

describe('fitOffer', () => {
  it('refuses a passenger with no seat as seats, a bag with no room as stationLimit', () => {
    expect(fitOffer(offer([pax()]), 'c152', FIELDS)).toBeNull();
    expect(fitOffer(offer([pax(), pax()]), 'c152', FIELDS)).toBe('seats');
    expect(fitOffer(offer([pax(), freight(54)]), 'c152', FIELDS)).toBeNull();
    expect(fitOffer(offer([pax(), freight(54.1)]), 'c152', FIELDS)).toBe('stationLimit');
  });

  it('refuses overMtow exactly past the maximum take-off mass at the required fuel', () => {
    const rest = atMtow('c152', 54);
    expect(rest).toBeGreaterThan(50);
    expect(rest).toBeLessThan(110);
    const at = offer([freight(54), freight(rest - 1e-9)]);
    expect(takeoffMassAtRequired(at, 'c152', FIELDS)).toBeLessThanOrEqual(CAREER_PERF.c152.mtowKg);
    expect(takeoffMassAtRequired(at, 'c152', FIELDS)).toBeCloseTo(CAREER_PERF.c152.mtowKg, 6);
    expect(fitOffer(at, 'c152', FIELDS)).toBeNull();
    expect(fitOffer(offer([freight(54), freight(rest + 0.1)]), 'c152', FIELDS)).toBe('overMtow');
  });

  it('plans the required fuel in the offer\'s wind: a headwind turns a load at MTOW into overMtow', () => {
    const rest = atMtow('c152', 54);
    const calm = offer([freight(54), freight(rest - 1e-9)]);
    // EAST is due east of HOME: a wind from 090 is a headwind, from 270 a tailwind.
    expect(routeWindOf(calm, FIELDS)).toEqual({ kind: 'leg', trackDeg: 90 });
    expect(fitOffer({ ...calm, windDirDeg: 90, windKt: 15 }, 'c152', FIELDS)).toBe('overMtow');
    expect(fitOffer({ ...calm, windDirDeg: 270, windKt: 15 }, 'c152', FIELDS)).toBeNull();
    const headwind = offerFuelPlan({ ...calm, windDirDeg: 90, windKt: 15 }, 'c152', FIELDS);
    expect(headwind.tripKg).toBeCloseTo((20 / 85) * CAREER_PERF.c152.fuelFlowKgH, 9);
    // A scenic loop takes half the wind speed off whatever its direction.
    const loop = { ...calm, destination: { kind: 'field' as const, code: 'HOME' }, waypoints: [{ name: 'A', north: 5000, east: 5000, radiusM: 1500 }], windDirDeg: 270, windKt: 10 };
    expect(routeWindOf(loop, FIELDS)).toEqual({ kind: 'loop' });
    expect(offerFuelPlan(loop, 'c152', FIELDS).tripKg).toBeCloseTo((20 / 95) * CAREER_PERF.c152.fuelFlowKgH, 9);
  });

  it('refuses runwayShort below minRunwayM at either end and allows exactly minRunwayM', () => {
    expect(CAREER_PERF.c208.minRunwayM).toBe(650);
    expect(fitOffer(offer([], { destination: { kind: 'field', code: 'SHRT' } }), 'c208', FIELDS)).toBeNull();
    expect(fitOffer(offer([], { destination: { kind: 'field', code: 'SHR2' } }), 'c208', FIELDS)).toBe('runwayShort');
    expect(fitOffer(offer([], { origin: 'SHR2', destination: { kind: 'field', code: 'EAST' } }), 'c208', FIELDS)).toBe('runwayShort');
    expect(fitOffer(offer([], { destination: { kind: 'field', code: 'EAST' } }), 'pa34', FIELDS)).toBeNull();
    expect(fitOffer(offer([], { destination: { kind: 'field', code: 'S899' } }), 'pa34', FIELDS)).toBe('runwayShort');
  });

  it('refuses grass for a type that may not use it, whatever the strip\'s length', () => {
    expect(fitOffer(offer([], { destination: { kind: 'field', code: 'LONG' } }), 'pa34', FIELDS)).toBe('grass');
    expect(fitOffer(offer([], { origin: 'LONG', destination: { kind: 'field', code: 'EAST' } }), 'pa34', FIELDS)).toBe('grass');
    expect(fitOffer(offer([], { destination: { kind: 'field', code: 'LONG' } }), 'c208', FIELDS)).toBeNull();
    expect(fitOffer(offer([], { destination: { kind: 'field', code: 'NRTH' } }), 'c152', FIELDS)).toBeNull();
    expect(fitOffer(offer([], { destination: { kind: 'field', code: 'NRTH' } }), 'c172s', FIELDS)).toBe('runwayShort');
  });

  it('lets helicopters use any field and skips the runway checks at an off-field site', () => {
    for (const code of ['NRTH', 'SHR2', 'LONG']) expect(fitOffer(offer([pax()], { destination: { kind: 'field', code } }), 'r22', FIELDS)).toBeNull();
    const site = { kind: 'site' as const, id: 's1', name: 'Farm', north: 1000, east: 1000, elevation: 200 };
    expect(fitOffer(offer([], { origin: 'SHR2', destination: site }), 'r44', FIELDS)).toBeNull();
    expect(fitOffer(offer([], { destination: site }), 'c208', FIELDS)).toBeNull();
    expect(routeWindOf(offer([], { destination: site }), FIELDS)).toEqual({ kind: 'leg', trackDeg: 45 });
  });

  it('checks stations, then MTOW, then runways', () => {
    // Three 110 kg occupants and a full baggage bay: inside every station, far above MTOW.
    const heavy = [pax(110), pax(110), pax(110), freight(54)];
    expect(atMtow('c172s', 384)).toBeLessThan(0);
    expect(fitOffer(offer([pax(), pax(), pax(), pax()], { destination: { kind: 'field', code: 'NRTH' } }), 'c172s', FIELDS)).toBe('seats');
    expect(fitOffer(offer(heavy, { destination: { kind: 'field', code: 'NRTH' } }), 'c172s', FIELDS)).toBe('overMtow');
    expect(fitOffer(offer([freight(10)], { destination: { kind: 'field', code: 'NRTH' } }), 'c172s', FIELDS)).toBe('runwayShort');
  });

  it('throws on a field code the world does not have', () => {
    expect(() => fitOffer(offer([], { destination: { kind: 'field', code: 'NONE' } }), 'c152', FIELDS)).toThrow(/NONE/);
  });
});

describe('registrationFor', () => {
  it('is deterministic and of the EASA and FAA forms', () => {
    for (let n = 1; n <= 200; n++) {
      const uid = `a${n}`;
      expect(registrationFor(uid, 'easa')).toBe(registrationFor(uid, 'easa'));
      expect(registrationFor(uid, 'easa')).toMatch(/^G-[A-Z]{4}$/);
      expect(registrationFor(uid, 'faa')).toMatch(/^N[1-9][0-9]{2}[A-Z]{2}$/);
    }
    for (const uid of ['', 'x', 'fleet-7', 'a0', 'A12']) {
      expect(registrationFor(uid, 'easa')).toMatch(/^G-[A-Z]{4}$/);
      expect(registrationFor(uid, 'faa')).toMatch(/^N[1-9][0-9]{2}[A-Z]{2}$/);
    }
  });

  it('gives 1,000 fleet uids 1,000 distinct marks under each authority', () => {
    const uids = Array.from({ length: 1000 }, (_, i) => `a${i + 1}`);
    expect(new Set(uids.map((u) => registrationFor(u, 'easa'))).size).toBe(1000);
    expect(new Set(uids.map((u) => registrationFor(u, 'faa'))).size).toBe(1000);
  });

  it('does not give neighbouring uids neighbouring marks', () => {
    expect(registrationFor('a1', 'easa').slice(0, 4)).not.toBe(registrationFor('a2', 'easa').slice(0, 4));
  });
});
