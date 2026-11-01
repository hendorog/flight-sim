// Proves the Career's seating table and rules (src/career/stations.ts): every literal position the definitions
// hold equals the definition's (1e-9: the pilot where the type's solo or crew loading puts the pilot, the other
// seats and compartments from the seat helpers or by solving the definition's own loadings), the ESTIMATE stations
// lie inside the airframe, the fuel centroid is the tanks', the seat counts sum to the passenger seats, cgOf
// equals the real mass model's CG for the same loading, and assignStations fills the documented order and refuses
// with 'seats' or 'stationLimit' exactly 0.1 kg past each limit.

import { describe, expect, it } from 'vitest';
import { loadAircraft } from '../../src/aircraft/registry';
import { BO105_SEATS } from '../../src/aircraft/bo105/mass';
import { MD500_SEATS, MD500_SOLO } from '../../src/aircraft/md500/mass';
import { pa34StationX } from '../../src/aircraft/pa34/geometry';
import { da20DatumX } from '../../src/aircraft/da20/geometry';
import { R22_SOLO } from '../../src/aircraft/r22/mass';
import { SEAT_CENTRES as R44_SEATS } from '../../src/aircraft/r44/dimensions';
import { R44_SOLO } from '../../src/aircraft/r44/mass';
import { PILOT_SEAT as S269_PILOT_SEAT, SEAT_CENTRES as S269_SEATS } from '../../src/aircraft/s269/dimensions';
import { S269_SOLO } from '../../src/aircraft/s269/mass';
import type { PayloadDef } from '../../src/aircraft/types';
import { C172 } from '../../src/core/c172';
import type { Vec3 } from '../../src/core/math';
import { createMassModel } from '../../src/physics/massModel';
import { CAREER_PERF } from '../../src/career/perf';
import { CAREER_STATIONS, assignStations, cgOf } from '../../src/career/stations';
import { CAREER_AIRCRAFT_IDS, OCCUPANT_KG, type CareerAircraftId, type OfferItem, type PayloadItem, type Station } from '../../src/career/types';

const IDS: readonly CareerAircraftId[] = CAREER_AIRCRAFT_IDS;

function expectVec(actual: Vec3 | undefined, expected: Vec3, tol = 1e-9): void {
  expect(actual).toBeDefined();
  expect(Math.abs(actual!.x - expected.x)).toBeLessThan(tol);
  expect(Math.abs(actual!.y - expected.y)).toBeLessThan(tol);
  expect(Math.abs(actual!.z - expected.z)).toBeLessThan(tol);
}

const mean = (...p: Vec3[]): Vec3 => ({
  x: p.reduce((s, v) => s + v.x, 0) / p.length,
  y: p.reduce((s, v) => s + v.y, 0) / p.length,
  z: p.reduce((s, v) => s + v.z, 0) / p.length,
});

/** The rest of a loading once `crewKg` at `crew` is taken out: its centroid (the definitions' crewAndBags / crewAndCabin algebra solved back). */
function rest(l: PayloadDef, crewKg: number, crew: Vec3): Vec3 {
  const m = l.payload - crewKg;
  const p = l.payloadPosition;
  return { x: (l.payload * p.x - crewKg * crew.x) / m, y: (l.payload * p.y - crewKg * crew.y) / m, z: (l.payload * p.z - crewKg * crew.z) / m };
}

/** A two-seat pair's left and right seats from its centroid and the definition's seatY. */
const left = (c: Vec3, seatY: number): Vec3 => ({ x: c.x, y: -seatY, z: c.z });
const right = (c: Vec3, seatY: number): Vec3 => ({ x: c.x, y: seatY, z: c.z });

const pax = (kg = OCCUPANT_KG, label = 'Passenger'): OfferItem => ({ kind: 'passenger', label, kg });
const bag = (kg: number): OfferItem => ({ kind: 'baggage', label: 'Bag', kg });
const freight = (kg: number): OfferItem => ({ kind: 'freight', label: 'Freight', kg });
const stationsOf = (r: ReturnType<typeof assignStations>): Station[] => (r.ok ? r.items.map((i) => i.station) : []);

describe('Career stations against the definitions', () => {
  it('the aeroplanes seat the pilot left of their crew centroid and the passenger right of it', async () => {
    for (const id of ['c152', 'pa38', 'da20', 'pa34', 'c208', 'pc12'] as const) {
      const m = (await loadAircraft(id)).mass;
      const seat = m.loadings.typical.payloadPosition;
      expectVec(CAREER_STATIONS[id].pilot, left(seat, m.seatY));
      expectVec(CAREER_STATIONS[id].stations.front, right(seat, m.seatY));
    }
    const m = (await loadAircraft('c172s')).mass;
    expectVec(CAREER_STATIONS.c172s.pilot, left(C172.mass.crewPos, m.seatY));
    expectVec(CAREER_STATIONS.c172s.stations.front, right(C172.mass.crewPos, m.seatY));
  });

  it('the rear, cabin and baggage stations the definitions hold equal them', async () => {
    const c172 = (await loadAircraft('c172s')).mass;
    expectVec(CAREER_STATIONS.c172s.stations.rear, c172.loadings.aft.payloadPosition);
    expectVec(CAREER_STATIONS.c172s.stations.baggage, rest(c172.loadings.typical, C172.mass.crew, C172.mass.crewPos));
    const c152 = (await loadAircraft('c152')).mass;
    expectVec(CAREER_STATIONS.c152.stations.baggage, rest(c152.loadings.maxGross, 154, c152.loadings.typical.payloadPosition));
    const c208 = (await loadAircraft('c208')).mass;
    expectVec(CAREER_STATIONS.c208.stations.cabin, rest(c208.loadings.maxGross, 154, c208.loadings.typical.payloadPosition));
    const pc12 = (await loadAircraft('pc12')).mass;
    expectVec(CAREER_STATIONS.pc12.stations.cabin, rest(pc12.loadings.maxGross, 85, pc12.loadings.typical.payloadPosition));
    // The Seneca's cabin and baggage: the definition's centre row with the POH's rear row, and the two compartments.
    const pa34 = (await loadAircraft('pa34')).mass;
    const centreRow = rest(pa34.loadings.maxGross, 154, pa34.loadings.typical.payloadPosition);
    expect(Math.abs(centreRow.x - pa34StationX(118.1))).toBeLessThan(1e-9);
    expectVec(CAREER_STATIONS.pa34.stations.cabin, { ...centreRow, x: (pa34StationX(118.1) + pa34StationX(155.7)) / 2 });
    expect(Math.abs(CAREER_STATIONS.pa34.stations.baggage!.x - pa34StationX(100.6))).toBeLessThan(1e-9);
    expect(Math.abs(CAREER_STATIONS.da20.stations.baggage!.x - da20DatumX(0.824))).toBeLessThan(1e-9);
  });

  it('the helicopters seat the pilot where their own solo loading does, the others at the seat helpers', async () => {
    expectVec(CAREER_STATIONS.r22.pilot, R22_SOLO.payloadPosition);
    const crew = (await loadAircraft('r22')).mass.inertiaLoading.payloadPosition;
    expectVec(CAREER_STATIONS.r22.stations.front, { ...R22_SOLO.payloadPosition, y: 2 * crew.y - R22_SOLO.payloadPosition.y });
    expect(CAREER_STATIONS.r22.stations.front!.y / 0.0254).toBeCloseTo(-9.3, 9);

    expectVec(CAREER_STATIONS.r44.pilot, R44_SOLO.payloadPosition);
    expectVec(CAREER_STATIONS.r44.pilot, R44_SEATS[1]);
    expectVec(CAREER_STATIONS.r44.stations.front, R44_SEATS[0]);
    expectVec(CAREER_STATIONS.r44.stations.rear, mean(R44_SEATS[2], R44_SEATS[3]));

    expectVec(CAREER_STATIONS.s269.pilot, S269_SOLO.payloadPosition);
    expectVec(CAREER_STATIONS.s269.pilot, S269_SEATS[S269_PILOT_SEAT]);
    expectVec(CAREER_STATIONS.s269.stations.front, S269_SEATS[1 - S269_PILOT_SEAT]);

    expectVec(CAREER_STATIONS.md500.pilot, MD500_SOLO.payloadPosition);
    expectVec(CAREER_STATIONS.md500.pilot, MD500_SEATS[0]);
    expectVec(CAREER_STATIONS.md500.stations.front, MD500_SEATS[1]);
    expectVec(CAREER_STATIONS.md500.stations.cabin, mean(MD500_SEATS[2], MD500_SEATS[3]));

    expectVec(CAREER_STATIONS.bo105.pilot, BO105_SEATS[0]);
    expectVec(CAREER_STATIONS.bo105.stations.front, BO105_SEATS[1]);
    expectVec(CAREER_STATIONS.bo105.stations.cabin, mean(BO105_SEATS[2], BO105_SEATS[3], BO105_SEATS[4]));
    expectVec(CAREER_STATIONS.bo105.stations.cargo, BO105_SEATS[5]);
  });

  it.each(IDS)('%s: the fuel centroid is the tanks\' capacity-weighted centroid and every station lies inside the airframe', async (id) => {
    const def = await loadAircraft(id);
    const tanks = def.powerplant.fuel.tanks;
    const total = tanks.reduce((s, t) => s + t.capacity, 0);
    const c = tanks.reduce((s, t) => ({ x: s.x + (t.capacity * t.position.x) / total, y: s.y + (t.capacity * t.position.y) / total, z: s.z + (t.capacity * t.position.z) / total }), { x: 0, y: 0, z: 0 });
    expectVec(CAREER_STATIONS[id].fuel, c, 1e-6);
    // Inside the fuselage: between its tail and nose, within half its width (the definition's geometry).
    const body = def.geometry.fuselage;
    for (const [name, p] of Object.entries({ pilot: CAREER_STATIONS[id].pilot, ...CAREER_STATIONS[id].stations })) {
      expect(p!.x, name).toBeLessThan(body.noseX);
      expect(p!.x, name).toBeGreaterThan(body.tailX);
      expect(Math.abs(p!.y), name).toBeLessThan(body.maxWidth / 2);
      expect(Math.abs(p!.z), name).toBeLessThan(1.5);
    }
  });

  it.each(IDS)('%s: stations and limits match, seats sum to the passenger seats and sit only on seat stations', (id) => {
    const set = CAREER_STATIONS[id];
    const perf = CAREER_PERF[id];
    expect(Object.keys(set.stations).sort()).toEqual(Object.keys(perf.stationMaxKg).sort());
    expect(Object.values(set.seats).reduce((s, n) => s + n, 0)).toBe(perf.paxSeats);
    for (const s of Object.keys(set.seats) as Station[]) expect(['front', 'rear', 'cabin']).toContain(s);
    expect(set.seats.front).toBe(1);
  });

  it.each(IDS)('%s: cgOf equals the mass model\'s CG for the pilot, a full load and half fuel within 1 mm', async (id) => {
    const def = await loadAircraft(id);
    const set = CAREER_STATIONS[id];
    const perf = CAREER_PERF[id];
    // One item per station at 90 % of its limit (a seat station: its passengers' share), and the pilot.
    const items: PayloadItem[] = (Object.keys(set.stations) as Station[]).map((s) => ({ kind: 'freight', label: s, kg: 0.9 * perf.stationMaxKg[s]!, station: s }));
    const fuelKg = perf.usableFuelKg / 2;
    const points = [{ m: OCCUPANT_KG, p: set.pilot }, ...items.map((it) => ({ m: it.kg, p: set.stations[it.station]! }))];
    const payload = points.reduce((s, q) => s + q.m, 0);
    const centroid = points.reduce((s, q) => ({ x: s.x + (q.m * q.p.x) / payload, y: s.y + (q.m * q.p.y) / payload, z: s.z + (q.m * q.p.z) / payload }), { x: 0, y: 0, z: 0 });
    const tanks = def.powerplant.fuel.tanks;
    const model = createMassModel(def.mass, tanks);
    const props = model.properties({
      payload,
      payloadPosition: centroid,
      payloadDistribution: points.map((q) => ({ fraction: q.m / payload, offset: { x: q.p.x - centroid.x, y: q.p.y - centroid.y, z: q.p.z - centroid.z } })),
      tanks: tanks.map((t) => t.capacity / 2),
    });
    expect(Math.abs(cgOf(id, items, fuelKg) - props.cgOffset.x)).toBeLessThan(1e-3);
    // The pilot alone with full tanks: the helicopters' own solo loadings (their pilot is 170 lb, 77.1 kg, against
    // the Career's 77, hence 2 mm).
    if (id === 'r44' || id === 'md500' || id === 's269' || id === 'r22') {
      const solo = model.properties(model.loadingFor('typical'));
      expect(Math.abs(cgOf(id, [], perf.usableFuelKg) - solo.cgOffset.x)).toBeLessThan(2e-3);
    }
  });

  it('cgOf refuses an item at a station the type does not have', () => {
    expect(() => cgOf('c152', [{ kind: 'freight', label: 'x', kg: 1, station: 'cabin' }], 10)).toThrow(/no cabin station/);
  });
});

describe('assignStations', () => {
  it('seats passengers front, then rear, then cabin, and refuses one more than the seats with "seats"', () => {
    expect(stationsOf(assignStations([pax(), pax(), pax()], 'c172s'))).toEqual(['front', 'rear', 'rear']);
    expect(stationsOf(assignStations([pax(), pax(), pax(), pax(), pax()], 'pa34'))).toEqual(['front', 'cabin', 'cabin', 'cabin', 'cabin']);
    const nine = Array.from({ length: 9 }, () => pax());
    expect(stationsOf(assignStations(nine, 'c208'))).toEqual(['front', ...Array(8).fill('cabin')]);
    const r = assignStations([...nine, pax(77, 'Passenger 10')], 'c208');
    expect(r).toMatchObject({ ok: false, code: 'seats', index: 9, item: { label: 'Passenger 10' } });
    expect(assignStations([pax(), pax()], 'c152')).toMatchObject({ ok: false, code: 'seats', index: 1 });
  });

  it('puts bags in the baggage bay, then the cargo hold, then a free seat, and keeps the offer\'s order', () => {
    const r = assignStations([bag(10), pax(), bag(12), pax()], 'c172s');
    expect(stationsOf(r)).toEqual(['baggage', 'front', 'baggage', 'rear']);
    expect(r.ok && r.items.map((i) => i.kg)).toEqual([10, 77, 12, 77]);
    // Nine passengers' bags in the C208: no baggage bay, so the pod.
    expect(stationsOf(assignStations([pax(), bag(15), bag(15)], 'c208'))).toEqual(['front', 'cargo', 'cargo']);
    // A trainer's freight: the baggage bay, then the right seat.
    expect(stationsOf(assignStations([freight(40), freight(60)], 'c152'))).toEqual(['baggage', 'front']);
    // Tourer freight over the baggage limit goes on the rear seats, before the seat beside the pilot.
    expect(stationsOf(assignStations([freight(200)], 'c172s'))).toEqual(['rear']);
    // A patient lies in the cabin first.
    expect(stationsOf(assignStations([{ kind: 'patient', label: 'Patient', kg: 80 }, pax()], 'bo105'))).toEqual(['cabin', 'front']);
  });

  it('refuses at each limit + 0.1 kg and accepts at the limit', () => {
    // C152 with a passenger: the baggage bay (54 kg) is the only place for a bag.
    expect(assignStations([pax(), bag(54)], 'c152').ok).toBe(true);
    expect(assignStations([pax(), bag(54.1)], 'c152')).toMatchObject({ ok: false, code: 'stationLimit', index: 1 });
    // C152 freight alone: 54 in the bay, then up to 110 on the right seat.
    expect(stationsOf(assignStations([freight(54), freight(110)], 'c152'))).toEqual(['baggage', 'front']);
    expect(assignStations([freight(54), freight(110.1)], 'c152')).toMatchObject({ ok: false, code: 'stationLimit', index: 1 });
    // A passenger heavier than the seat: a free seat, but too much for it.
    expect(assignStations([pax(109)], 'r22').ok).toBe(true);
    expect(assignStations([pax(109.1)], 'r22')).toMatchObject({ ok: false, code: 'stationLimit', index: 0 });
    // The R44's rear seats, 272 kg for two.
    expect(assignStations([pax(136), pax(136), pax(136)], 'r44').ok).toBe(true);
    expect(assignStations([pax(136), pax(136), pax(136.1)], 'r44')).toMatchObject({ ok: false, code: 'stationLimit', index: 2 });
    // The C172S rear seats take freight up to 220 kg; beyond, the right seat's 110 is not enough either.
    expect(stationsOf(assignStations([freight(220)], 'c172s'))).toEqual(['rear']);
    expect(assignStations([freight(220.1)], 'c172s')).toMatchObject({ ok: false, code: 'stationLimit' });
    // The PC-12's aft cargo area, 180 kg, behind a full cabin.
    const full = Array.from({ length: 9 }, () => pax());
    expect(assignStations([...full, freight(180)], 'pc12').ok).toBe(true);
    expect(assignStations([...full, freight(180.1)], 'pc12')).toMatchObject({ ok: false, code: 'stationLimit', index: 9 });
    // The Bo 105: the clamshell's 250 kg, then the rear bench's 330, then the left front seat's 110.
    expect(stationsOf(assignStations([freight(250)], 'bo105'))).toEqual(['cargo']);
    expect(stationsOf(assignStations([freight(250.1)], 'bo105'))).toEqual(['cabin']);
    expect(assignStations([freight(330.1)], 'bo105')).toMatchObject({ ok: false, code: 'stationLimit' });
  });

  it('a freight item on a seat takes the seat, so a passenger after it in the processing order still finds one first', () => {
    // People are seated before goods whatever the offer's order.
    expect(stationsOf(assignStations([freight(100), pax()], 'c152'))).toEqual([]);
    expect(assignStations([freight(100), pax()], 'c152')).toMatchObject({ ok: false, code: 'stationLimit', index: 0 });
    expect(stationsOf(assignStations([freight(50), pax()], 'c152'))).toEqual(['baggage', 'front']);
  });
});
