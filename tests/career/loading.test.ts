// Proves the Career's flight-model payload (src/career/loading.ts loadingFor): a pilot-only loading sits exactly
// where the helicopters' own solo loadings put their pilot (R22_SOLO, R44_SOLO, S269_SOLO, MD500_SOLO; position to
// 1e-9, and the mass too when built with their 170 lb pilot, since the Career's OCCUPANT_KG is 77 kg); for seeded
// random payloads of every type the mass is the pilot plus the items and the distribution is valid (fractions sum
// to one, weighted offsets zero, each point at its seat or station); and for every type the take-off CG of a
// typical load lies between the type's own forward and aft loadings (2 cm), a light or full load lies there or the
// load sheet warns 'cg' (exactly when outside the figures), and the loading's centroid gives the load sheet's CG.

import { describe, expect, it } from 'vitest';
import { MD500_SOLO } from '../../src/aircraft/md500/mass';
import { R22_SOLO } from '../../src/aircraft/r22/mass';
import { R44_SOLO } from '../../src/aircraft/r44/mass';
import { S269_SOLO } from '../../src/aircraft/s269/mass';
import { loadingFor } from '../../src/career/loading';
import { loadSheet } from '../../src/career/loadsheet';
import { CAREER_PERF } from '../../src/career/perf';
import { assignStations, CAREER_STATIONS } from '../../src/career/stations';
import {
  CAREER_AIRCRAFT_IDS, OCCUPANT_KG, type CareerAircraftId, type CareerSave, type FleetAircraft, type JobOffer,
  type OfferItem, type PayloadItem,
} from '../../src/career/types';
import type { LoadingRequest } from '../../src/physics/interfaces';
import type { Airfield } from '../../src/world/airfields';

/** mulberry32: the tests' seeded stream (never Math.random). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The distribution rules PayloadDistribution states, and the centroid. */
function expectValid(l: LoadingRequest, points: { kg: number; x: number; y: number; z: number }[]) {
  const d = l.payloadDistribution!;
  expect(d.length).toBe(points.length);
  expect(d.reduce((s, q) => s + q.fraction, 0)).toBeCloseTo(1, 12);
  for (const k of ['x', 'y', 'z'] as const) {
    expect(d.reduce((s, q) => s + q.fraction * q.offset[k], 0)).toBeCloseTo(0, 12);
  }
  d.forEach((q, i) => {
    expect(q.fraction * l.payload).toBeCloseTo(points[i].kg, 9);
    for (const k of ['x', 'y', 'z'] as const) expect(l.payloadPosition[k] + q.offset[k]).toBeCloseTo(points[i][k], 9);
  });
}

describe('loadingFor: the pilot alone', () => {
  const solos: [CareerAircraftId, { payload: number; payloadPosition: { x: number; y: number; z: number } }][] = [
    ['r22', R22_SOLO], ['r44', R44_SOLO], ['s269', S269_SOLO], ['md500', MD500_SOLO],
  ];

  for (const [type, solo] of solos) {
    it(`puts the ${type} pilot exactly where its own solo loading does`, () => {
      const exact = loadingFor(type, [], solo.payload);
      expect(Math.abs(exact.payload - solo.payload)).toBeLessThan(1e-9);
      for (const k of ['x', 'y', 'z'] as const) expect(Math.abs(exact.payloadPosition[k] - solo.payloadPosition[k])).toBeLessThan(1e-9);
      // The Career's own pilot: the same seat, 77 kg (the definitions' 170 lb is 77.11 kg).
      const career = loadingFor(type, []);
      expect(career.payload).toBe(OCCUPANT_KG);
      for (const k of ['x', 'y', 'z'] as const) expect(Math.abs(career.payloadPosition[k] - solo.payloadPosition[k])).toBeLessThan(1e-9);
      expect(career.payloadDistribution).toHaveLength(1);
      expect(career.payloadDistribution![0].fraction).toBe(1);
      for (const k of ['x', 'y', 'z'] as const) expect(Math.abs(career.payloadDistribution![0].offset[k])).toBeLessThan(1e-12);
    });
  }

  it('adds exactly one pilot in every type, the C208 included', () => {
    for (const type of CAREER_AIRCRAFT_IDS) {
      const l = loadingFor(type, []);
      expect(l.payload).toBe(OCCUPANT_KG);
      for (const k of ['x', 'y', 'z'] as const) expect(Math.abs(l.payloadPosition[k] - CAREER_STATIONS[type].pilot[k])).toBeLessThan(1e-12);
    }
  });
});

describe('loadingFor: seeded payloads', () => {
  it('sums the masses to the pilot plus the items and gives a valid distribution for every type', () => {
    const r = rng(20261031);
    for (const type of CAREER_AIRCRAFT_IDS) {
      for (let trial = 0; trial < 25; trial++) {
        const items: OfferItem[] = [];
        const nPax = Math.floor(r() * (CAREER_PERF[type].paxSeats + 1));
        for (let i = 0; i < nPax; i++) items.push({ kind: 'passenger', label: `Passenger ${i + 1}`, kg: 55 + r() * 45 });
        if (r() < 0.7) items.push({ kind: 'baggage', label: 'Bags', kg: r() * 20 });
        const seated = assignStations(items, type);
        if (!seated.ok) continue;
        const l = loadingFor(type, seated.items);
        expect(l.payload).toBeCloseTo(OCCUPANT_KG + items.reduce((s, it) => s + it.kg, 0), 9);
        const set = CAREER_STATIONS[type];
        expectValid(l, [{ kg: OCCUPANT_KG, ...set.pilot }, ...seated.items.map((it) => ({ kg: it.kg, ...set.stations[it.station]! }))]);
      }
    }
  });

  it('refuses an item at a station the type does not have', () => {
    const bad: PayloadItem = { kind: 'freight', label: 'Freight', kg: 10, station: 'cargo' };
    expect(() => loadingFor('c152', [bad])).toThrow(/no cargo station/);
  });
});

describe('loadingFor and the load sheet: typical loads of every type', () => {
  const home: Airfield = {
    code: 'HOME', name: 'Home', kind: 'home', north: 0, east: 0, elevation: 100, heading: 0, ids: ['18', '36'],
    length: 1500, width: 30, flatMargin: 50, blend: 100, approachLength: 1000, circuit: 'left', frequency: 123.5, apronAlong: 0,
  };
  const fields: Airfield[] = [home, { ...home, code: 'EAST', kind: 'sealed', east: 20 * 1852 }];
  const save: CareerSave = {
    format: 'fs-career', schema: 1, createdAt: 0, updatedAt: 0, seed: 0, pilot: { name: 'Test', licence: 'declared' },
    company: { name: 'Test Air', callsign: 'Test' }, cash: 5000, reputation: 100, clockMin: 1440 + 600,
    ratings: ['sep', 'mep', 'turbine', 'heli'], fleet: [], selectedUid: 'a1', inCareer: true, taken: [], active: null,
    lastSettlement: null, logbook: [], flightNo: 1, ownNo: 1, settings: { companyCallsign: false },
  };

  /** n passengers, each with a 10 kg bag where it fits. */
  function load(type: CareerAircraftId, n: number): OfferItem[] {
    const items: OfferItem[] = [];
    for (let i = 0; i < n; i++) items.push({ kind: 'passenger', label: `Passenger ${i + 1}`, kg: OCCUPANT_KG });
    for (let i = 0; i < n; i++) {
      const bag: OfferItem = { kind: 'baggage', label: `Bag ${i + 1}`, kg: 10 };
      if (assignStations([...items, bag], type).ok) items.push(bag);
    }
    return items;
  }

  for (const type of CAREER_AIRCRAFT_IDS) {
    it(`keeps the ${type}'s CG between its forward and aft loadings, or warns cg, for a light, typical and full load`, () => {
      const perf = CAREER_PERF[type];
      const isHeli = perf.cls === 'heli' || perf.cls === 'heliTurbine';
      const sizes = [0, Math.ceil(perf.paxSeats / 2), perf.paxSeats];
      for (const n of sizes) {
        const items = load(type, n);
        const offer: JobOffer = {
          id: '1-HOME-0', kind: 'charter', day: 1, origin: 'HOME', destination: { kind: 'field', code: 'EAST' }, client: 'Test',
          title: 'Test', pax: n, payload: items, payloadKg: items.reduce((s, it) => s + it.kg, 0), distanceNm: 20, pay: 5000,
          deadlineMin: 120, minClass: isHeli ? 'heli' : 'trainer', refType: type, repRequired: 0, premium: false,
          weather: 'clear', windDirDeg: 0, windKt: 0,
        };
        const aircraft: FleetAircraft = { uid: 'a1', type, tenure: 'owned', registration: 'G-TEST', field: 'HOME', fuelKg: 0, hours: 0, acquiredDay: 1 };
        const zfm = perf.emptyKg + OCCUPANT_KG + offer.payloadKg;
        const fuel = Math.min(perf.usableFuelKg, perf.mtowKg - zfm);
        const s = loadSheet(offer, aircraft, fuel, save, fields);
        expect(s.items.length, `${type} ${n}`).toBe(items.length);

        // The loading's centroid gives the sheet's CG.
        const l = loadingFor(type, s.items);
        expect(l.payload).toBeCloseTo(OCCUPANT_KG + offer.payloadKg, 9);
        const set = CAREER_STATIONS[type];
        const cg = (perf.emptyKg * perf.cg.emptyX + l.payload * l.payloadPosition.x + fuel * set.fuel.x) / (perf.emptyKg + l.payload + fuel);
        expect(cg).toBeCloseTo(s.cgX, 9);

        const inside = s.cgX <= perf.cg.fwdX + 0.02 && s.cgX >= perf.cg.aftX - 0.02;
        const why = `${type} ${n} pax: cg ${s.cgX} not in [${perf.cg.aftX}, ${perf.cg.fwdX}]`;
        // The typical load (half the seats, each with a bag) must sit inside; a light or full one may warn instead.
        if (n === sizes[1]) expect(inside, why).toBe(true);
        else expect(inside || s.warnings.some((w) => w.code === 'cg'), why).toBe(true);
        // Outside the figures exactly (no tolerance) is what the sheet warns about.
        const outside = s.cgX > perf.cg.fwdX || s.cgX < perf.cg.aftX;
        expect(s.warnings.some((w) => w.code === 'cg'), `${type} ${n} pax`).toBe(outside);
      }
    });
  }
});
