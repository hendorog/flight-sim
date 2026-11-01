// Proves the dispatch load sheet (src/career/loadsheet.ts loadSheet): every blocking and warning code is reachable
// and correct on hand-built cases (synthetic fields, a hand-built save and fleet entry), the named acceptance cases
// of docs/career.md (the PA-38 with a passenger, a bag and full fuel is overMtow and ok after defuelling to
// maxFuelKg with the credit shown; the C152 with the same load at full fuel is ok; a PC-12 with nine passengers and
// full fuel is overMtow and ok at maxFuelKg; a Jet A-1 type at a grass strip gets fuelTruck as a warning only), the
// estimated net on a hand-worked case to the dollar, each limit just past and just inside it, and that the sheet always carries 1a's fitOffer code, so the
// board and the dispatch agree at the required fuel.

import { describe, expect, it } from 'vitest';
import { fitOffer } from '../../src/career/fit';
import { loadSheet } from '../../src/career/loadsheet';
import { CAREER_PERF } from '../../src/career/perf';
import {
  CAREER_AIRCRAFT_IDS, OCCUPANT_KG, type CareerAircraftId, type CareerSave, type FleetAircraft, type JobOffer,
  type LoadSheet, type LoadSheetCode, type OfferItem,
} from '../../src/career/types';
import type { Airfield, AirfieldKind } from '../../src/world/airfields';

/** A synthetic field: runway along north-south (heading 0), centre at (north, east). */
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
  field('NRTH', 'grass', 450, NM20, 0),
  field('SHRT', 'sealed', 650, -NM20, 0),
  field('GRSS', 'grass', 1000, 0, -NM20),
  { ...field('XWND', 'sealed', 900, NM20, NM20), heading: Math.PI / 2 },
];

const pax = (n: number, kg = OCCUPANT_KG): OfferItem => ({ kind: 'passenger', label: `Passenger ${n}`, kg });
const bag = (n: number, kg = 10): OfferItem => ({ kind: 'baggage', label: `Bag ${n}`, kg });
const freight = (kg: number): OfferItem => ({ kind: 'freight', label: 'Freight', kg });

function offer(payload: OfferItem[], over: Partial<JobOffer> = {}): JobOffer {
  return {
    id: '1-HOME-0', kind: 'charter', day: 1, origin: 'HOME', destination: { kind: 'field', code: 'EAST' }, client: 'Test',
    title: 'Test', pax: payload.filter((p) => p.kind === 'passenger').length, payload, payloadKg: payload.reduce((s, p) => s + p.kg, 0),
    distanceNm: 20, pay: 280, deadlineMin: 60, minClass: 'trainer', refType: 'c152', repRequired: 0, premium: false,
    weather: 'clear', windDirDeg: 0, windKt: 0, ...over,
  };
}

function plane(type: CareerAircraftId, over: Partial<FleetAircraft> = {}): FleetAircraft {
  return { uid: 'a1', type, tenure: 'leased', registration: 'G-TEST', field: 'HOME', fuelKg: CAREER_PERF[type].usableFuelKg, hours: 0, acquiredDay: 1, ...over };
}

function save(over: Partial<CareerSave> = {}): CareerSave {
  return {
    format: 'fs-career', schema: 1, createdAt: 0, updatedAt: 0, seed: 0, pilot: { name: 'Test', licence: 'declared' },
    company: { name: 'Test Air', callsign: 'Test' }, cash: 5000, reputation: 100, clockMin: 1440 + 10 * 60,
    ratings: ['sep', 'mep', 'turbine', 'heli'], fleet: [], selectedUid: 'a1', inCareer: true, taken: [], active: null,
    lastSettlement: null, logbook: [], flightNo: 1, ownNo: 1, settings: { companyCallsign: false }, ...over,
  };
}

const codes = (s: LoadSheet): LoadSheetCode[] => s.warnings.map((w) => w.code);
const severity = (s: LoadSheet, c: LoadSheetCode) => s.warnings.find((w) => w.code === c)?.severity;
/** The trainer charter used throughout: one passenger and a 10 kg bag, HOME to EAST, 20 NM, calm, clear. */
const charter = (over: Partial<JobOffer> = {}) => offer([pax(1), bag(1)], over);

describe('loadSheet: the named acceptance cases', () => {
  it('passes the C152 with one passenger and a bag at full fuel', () => {
    const s = loadSheet(charter(), plane('c152'), CAREER_PERF.c152.usableFuelKg, save(), FIELDS);
    expect(s.ok).toBe(true);
    expect(s.warnings).toEqual([]);
    expect(s.takeoffKg).toBeLessThanOrEqual(s.mtowKg);
    expect(s.items.map((i) => i.station)).toEqual(['front', 'baggage']);
  });

  it('refuses the PA-38 with one passenger, a bag and full fuel as overMtow, and passes it defuelled to maxFuelKg with the credit shown', () => {
    const p = CAREER_PERF.pa38;
    const full = loadSheet(charter(), plane('pa38'), p.usableFuelKg, save(), FIELDS);
    expect(full.ok).toBe(false);
    expect(severity(full, 'overMtow')).toBe('block');
    expect(full.maxFuelKg).toBeCloseTo(p.mtowKg - (p.emptyKg + OCCUPANT_KG + OCCUPANT_KG + 10), 9);
    expect(full.maxFuelKg).toBeLessThan(p.usableFuelKg);

    const s = loadSheet(charter(), plane('pa38'), full.maxFuelKg, save(), FIELDS);
    expect(s.ok).toBe(true);
    expect(s.takeoffKg).toBeCloseTo(p.mtowKg, 9);
    expect(s.defuelKg).toBeCloseTo(p.usableFuelKg - full.maxFuelKg, 9);
    expect(s.upliftKg).toBe(0);
    expect(s.fuelCost).toBe(0);
    // Half the avgas list price: 2.60 $/L / 0.719 kg/L / 2.
    expect(s.defuelCredit).toBe(Math.round(s.defuelKg * (2.6 / 0.719) * 0.5));
    expect(s.defuelCredit).toBeGreaterThan(0);
  });

  it('refuses a PC-12 with nine passengers and full fuel as overMtow, and passes it at maxFuelKg', () => {
    const nine = [1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [pax(n), bag(n)]);
    const o = offer(nine, { minClass: 'turbine', refType: 'pc12' });
    const p = CAREER_PERF.pc12;
    const full = loadSheet(o, plane('pc12'), p.usableFuelKg, save(), FIELDS);
    expect(severity(full, 'overMtow')).toBe('block');
    const s = loadSheet(o, plane('pc12'), full.maxFuelKg, save(), FIELDS);
    expect(s.ok).toBe(true);
    expect(s.fuelKg).toBeGreaterThanOrEqual(s.requiredFuelKg);
    // At MTOW after a 20 NM hop it lands above its 4,500 kg MLW: a warning only.
    expect(severity(s, 'overMlw')).toBe('warn');
  });

  it('warns fuelTruck, never blocks, for a Jet A-1 type buying fuel at a grass strip', () => {
    const o = offer([freight(200)], { origin: 'GRSS', destination: { kind: 'field', code: 'HOME' }, kind: 'freight', minClass: 'turbine', refType: 'c208' });
    const s = loadSheet(o, plane('c208', { field: 'GRSS', fuelKg: 400 }), 600, save(), FIELDS);
    expect(severity(s, 'fuelTruck')).toBe('warn');
    expect(s.ok).toBe(true);
    // 200 kg of Jet A-1 at 1.95 $/L / 0.8 kg/L plus the truck's 50 %.
    expect(s.fuelCost).toBe(Math.round(200 * (1.95 / 0.8) * 1.5));
    // No uplift, no truck.
    expect(codes(loadSheet(o, plane('c208', { field: 'GRSS', fuelKg: 600 }), 600, save(), FIELDS))).not.toContain('fuelTruck');
  });
});

describe('loadSheet: the estimate', () => {
  it('gives the estimated net as pay less fuel, landing fee and hours on a hand-worked case', () => {
    // C152, leased ($120/h), 30 kg aboard, filled to 66.68 kg at home (avgas $2.60/L at 0.719 kg/L = $3.6161/kg):
    // 36.68 kg -> $132.64 -> $133. Landing fee at a sealed field: 12 + 5 x 0.7575 t = $15.79 -> $16. Flight time
    // 20 NM at 100 kt + 10 min = 22 min; block 22 + 25 = 47 min = 0.7833 h x $120 = $94. Net 280 - 133 - 16 - 94 = $37.
    const s = loadSheet(charter(), plane('c152', { fuelKg: 30 }), 66.68, save(), FIELDS);
    expect(s.upliftKg).toBeCloseTo(36.68, 9);
    expect(s.fuelCost).toBe(133);
    expect(s.landingFeeEst).toBe(16);
    expect(s.flightTimeMin).toBeCloseTo(22, 9);
    expect(s.blockHoursEst).toBeCloseTo(47 / 60, 9);
    expect(s.hoursCostEst).toBe(94);
    expect(s.netEst).toBe(37);
    // Deadline 60 min less (22 + 25): 13 min in hand.
    expect(s.deadlineMarginMin).toBeCloseTo(13, 9);
    // The fuel plan at 19 kg/h: trip 3.8, climb 5 min, taxi 6 min, reserve 30 min.
    expect(s.tripFuelKg).toBeCloseTo(3.8, 9);
    expect(s.climbFuelKg).toBeCloseTo(19 * 5 / 60, 9);
    expect(s.taxiFuelKg).toBeCloseTo(19 * 6 / 60, 9);
    expect(s.reserveFuelKg).toBeCloseTo(19 * 30 / 60, 9);
    expect(s.requiredFuelKg).toBeCloseTo(1.1 * 3.8 + 19 * 41 / 60, 9);
    expect(s.landingKg).toBeCloseTo(s.takeoffKg - 3.8 - 19 * 11 / 60, 9);
    expect(s.enduranceMin).toBeCloseTo(66.68 / 19 * 60, 9);
    expect(s.zeroFuelKg).toBeCloseTo(CAREER_PERF.c152.emptyKg + 77 + 87, 9);
  });

  it('counts the defuel credit into the net and owned hours at the owned rate', () => {
    const s = loadSheet(charter(), plane('c152', { fuelKg: 66.68, tenure: 'owned' }), 40, save(), FIELDS);
    expect(s.defuelCredit).toBe(Math.round(26.68 * (2.6 / 0.719) * 0.5));
    expect(s.hoursCostEst).toBe(Math.round((47 / 60) * 55));
    expect(s.netEst).toBe(280 + s.defuelCredit - 16 - s.hoursCostEst);
  });

  it('reports the headwind along the route and the larger runway crosswind', () => {
    // EAST is due east: a wind from 090 is all headwind and all crosswind on the north-south runways.
    const s = loadSheet(charter({ windDirDeg: 90, windKt: 10 }), plane('c152'), 66.68, save(), FIELDS);
    expect(s.headwindKt).toBeCloseTo(10, 9);
    expect(s.crosswindKt).toBeCloseTo(10, 9);
    expect(s.flightTimeMin).toBeCloseTo(60 * 20 / 90 + 10, 9);
  });
});

describe('loadSheet: blocking codes', () => {
  const blocks = (s: LoadSheet, c: LoadSheetCode) => {
    expect(codes(s)).toContain(c);
    expect(severity(s, c)).toBe('block');
    expect(s.ok).toBe(false);
  };
  const full = CAREER_PERF.c152.usableFuelKg;

  it('blocks notHere when the aircraft stands at another field', () => {
    blocks(loadSheet(charter(), plane('c152', { field: 'EAST' }), full, save(), FIELDS), 'notHere');
  });

  it('blocks grounded before the day the aircraft is back in service, and not on that day', () => {
    blocks(loadSheet(charter(), plane('c152', { groundedUntilDay: 2 }), full, save(), FIELDS), 'grounded');
    expect(loadSheet(charter(), plane('c152', { groundedUntilDay: 1 }), full, save(), FIELDS).ok).toBe(true);
  });

  it('blocks rating when a rating the type needs is missing', () => {
    const o = charter({ minClass: 'twin' });
    blocks(loadSheet(o, plane('pa34'), 150, save({ ratings: ['sep'] }), FIELDS), 'rating');
    expect(codes(loadSheet(o, plane('pa34'), 150, save(), FIELDS))).not.toContain('rating');
  });

  it('blocks class for a smaller class than the job needs, but lets a larger one take it', () => {
    blocks(loadSheet(charter({ minClass: 'tourer' }), plane('c152'), full, save(), FIELDS), 'class');
    expect(codes(loadSheet(charter({ minClass: 'trainer' }), plane('c172s'), 100, save(), FIELDS))).not.toContain('class');
  });

  it('blocks heliOnly for an aeroplane on a helicopter job and fixedWingOnly for the reverse', () => {
    blocks(loadSheet(charter({ minClass: 'heli' }), plane('c152'), full, save(), FIELDS), 'heliOnly');
    blocks(loadSheet(charter({ minClass: 'trainer' }), plane('r22', { fuelKg: 50 }), 50, save(), FIELDS), 'fixedWingOnly');
    expect(codes(loadSheet(charter({ minClass: 'heli' }), plane('md500'), 150, save(), FIELDS))).not.toContain('class');
    blocks(loadSheet(charter({ minClass: 'heliTurbine' }), plane('r22'), 60, save(), FIELDS), 'class');
  });

  it('blocks reputation below the offer\'s figure and not at it', () => {
    blocks(loadSheet(charter({ repRequired: 30 }), plane('c152'), full, save({ reputation: 29 }), FIELDS), 'reputation');
    expect(loadSheet(charter({ repRequired: 30 }), plane('c152'), full, save({ reputation: 30 }), FIELDS).ok).toBe(true);
  });

  it('blocks seats and stationLimit from the seating, with no items listed', () => {
    const s = loadSheet(offer([pax(1), pax(2)]), plane('c152'), 40, save(), FIELDS);
    blocks(s, 'seats');
    expect(s.items).toEqual([]);
    expect(Number.isFinite(s.cgX)).toBe(true);
    blocks(loadSheet(offer([pax(1), freight(54.1)]), plane('c152'), 30, save(), FIELDS), 'stationLimit');
  });

  it('blocks overMtow above MTOW at the chosen fuel and not at maxFuelKg', () => {
    const s = loadSheet(charter(), plane('pa38'), 70, save(), FIELDS);
    blocks(s, 'overMtow');
    expect(codes(loadSheet(charter(), plane('pa38'), s.maxFuelKg, save(), FIELDS))).not.toContain('overMtow');
  });

  it('blocks fuelShort below the required fuel and not at it', () => {
    const at = loadSheet(charter(), plane('c152'), 30, save(), FIELDS).requiredFuelKg;
    blocks(loadSheet(charter(), plane('c152'), at - 0.01, save(), FIELDS), 'fuelShort');
    expect(loadSheet(charter(), plane('c152'), at, save(), FIELDS).ok).toBe(true);
  });

  it('blocks fuelOverCapacity above the usable fuel', () => {
    blocks(loadSheet(offer([]), plane('c152'), full + 0.1, save(), FIELDS), 'fuelOverCapacity');
  });

  it('blocks runwayShort and grass at either end', () => {
    const twin = (dest: string) => offer([pax(1)], { minClass: 'twin', destination: { kind: 'field', code: dest } });
    blocks(loadSheet(twin('SHRT'), plane('pa34'), 150, save(), FIELDS), 'runwayShort');
    blocks(loadSheet(twin('GRSS'), plane('pa34'), 150, save(), FIELDS), 'grass');
    const fromGrass = offer([pax(1)], { minClass: 'twin', origin: 'GRSS', destination: { kind: 'field', code: 'HOME' } });
    blocks(loadSheet(fromGrass, plane('pa34', { field: 'GRSS' }), 150, save(), FIELDS), 'grass');
    // A helicopter uses any field.
    const heli = offer([pax(1)], { minClass: 'heli', destination: { kind: 'field', code: 'NRTH' } });
    expect(loadSheet(heli, plane('r22'), 60, save(), FIELDS).ok).toBe(true);
  });

  it('blocks lateInDay after 18:00 and allows 18:00 itself', () => {
    blocks(loadSheet(charter(), plane('c152'), full, save({ clockMin: 1440 + 18 * 60 + 1 }), FIELDS), 'lateInDay');
    expect(loadSheet(charter(), plane('c152'), full, save({ clockMin: 1440 + 18 * 60 }), FIELDS).ok).toBe(true);
  });

  it('blocks lateInDay before 07:00 and allows 07:00 itself', () => {
    blocks(loadSheet(charter(), plane('c152'), full, save({ clockMin: 2 * 1440 + 7 * 60 - 1 }), FIELDS), 'lateInDay');
    expect(loadSheet(charter(), plane('c152'), full, save({ clockMin: 2 * 1440 + 7 * 60 }), FIELDS).ok).toBe(true);
  });

  it('blocks cash when the fuel would take the company past the overdraft', () => {
    const s = loadSheet(charter(), plane('c152', { fuelKg: 20 }), full, save({ cash: -4900 }), FIELDS);
    blocks(s, 'cash');
    expect(s.fuelCost).toBeGreaterThan(100);
    expect(loadSheet(charter(), plane('c152', { fuelKg: full }), full, save({ cash: -4900 }), FIELDS).ok).toBe(true);
    // Exactly down to the overdraft is allowed, a dollar more is not.
    const at = -5000 + s.fuelCost;
    expect(loadSheet(charter(), plane('c152', { fuelKg: 20 }), full, save({ cash: at }), FIELDS).ok).toBe(true);
    blocks(loadSheet(charter(), plane('c152', { fuelKg: 20 }), full, save({ cash: at - 1 }), FIELDS), 'cash');
    // Already past the overdraft but buying nothing (a defuel): the fuel asks nothing of it.
    expect(codes(loadSheet(charter(), plane('c152', { fuelKg: full }), 40, save({ cash: -6000 }), FIELDS))).not.toContain('cash');
  });

  it('lists blocking codes before warnings', () => {
    const s = loadSheet(charter({ minClass: 'tourer', weather: 'gusty' }), plane('c152'), full, save(), FIELDS);
    const sev = s.warnings.map((w) => w.severity);
    expect(sev).toEqual([...sev].sort((a, b) => (a === b ? 0 : a === 'block' ? -1 : 1)));
    expect(codes(s)).toEqual(['class', 'weather']);
  });
});

describe('loadSheet: warnings', () => {
  const warns = (s: LoadSheet, c: LoadSheetCode) => {
    expect(codes(s)).toContain(c);
    expect(severity(s, c)).toBe('warn');
  };

  it('warns cg when the take-off CG is outside the type\'s forward and aft loadings', () => {
    // The C152 with its pilot alone and little fuel sits forward of its own `forward` loading.
    const s = loadSheet(offer([]), plane('c152', { fuelKg: 30 }), 30, save(), FIELDS);
    warns(s, 'cg');
    expect(s.cgX).toBeGreaterThan(s.cgFwdX);
    expect(s.ok).toBe(true);
  });

  it('warns overMlw when the landing mass is above MLW', () => {
    const s = loadSheet(offer([pax(1), pax(2), pax(3)], { minClass: 'twin' }), plane('pa34'), 253, save(), FIELDS);
    expect(s.landingKg).toBeGreaterThan(s.mlwKg);
    warns(s, 'overMlw');
  });

  it('warns deadlineTight under 5 min in hand and not at 5', () => {
    // 22 min of flight + 25 taxi = 47 min.
    warns(loadSheet(charter({ deadlineMin: 51.9 }), plane('c152'), 66.68, save(), FIELDS), 'deadlineTight');
    expect(codes(loadSheet(charter({ deadlineMin: 52 }), plane('c152'), 66.68, save(), FIELDS))).not.toContain('deadlineTight');
  });

  it('warns weather for gusty wind or rain in a trainer only', () => {
    warns(loadSheet(charter({ weather: 'gusty' }), plane('c152'), 66.68, save(), FIELDS), 'weather');
    warns(loadSheet(charter({ weather: 'rain' }), plane('c152'), 66.68, save(), FIELDS), 'weather');
    expect(codes(loadSheet(charter({ weather: 'drizzle' }), plane('c152'), 66.68, save(), FIELDS))).not.toContain('weather');
    expect(codes(loadSheet(charter({ weather: 'rain' }), plane('c172s'), 100, save(), FIELDS))).not.toContain('weather');
  });

  it('warns crosswind above the demonstrated figure and never for a helicopter', () => {
    warns(loadSheet(charter({ windDirDeg: 270, windKt: 12.5 }), plane('c152'), 66.68, save(), FIELDS), 'crosswind');
    expect(codes(loadSheet(charter({ windDirDeg: 270, windKt: 12 }), plane('c152'), 66.68, save(), FIELDS))).not.toContain('crosswind');
    // A wind along the origin's runway but across the destination's (east-west) still warns.
    const across = loadSheet(charter({ windDirDeg: 0, windKt: 15, destination: { kind: 'field', code: 'XWND' } }), plane('c152'), 66.68, save(), FIELDS);
    expect(across.crosswindKt).toBeCloseTo(15, 9);
    warns(across, 'crosswind');
    // Along the runway: no crosswind.
    expect(codes(loadSheet(charter({ windDirDeg: 0, windKt: 20 }), plane('c152'), 66.68, save(), FIELDS))).not.toContain('crosswind');
    expect(codes(loadSheet(offer([pax(1)], { minClass: 'heli', windDirDeg: 270, windKt: 30 }), plane('r22'), 60, save(), FIELDS))).not.toContain('crosswind');
  });

  it('warns losesMoney when the estimated net is below zero', () => {
    const s = loadSheet(charter({ pay: 50 }), plane('c152'), 66.68, save(), FIELDS);
    expect(s.netEst).toBeLessThan(0);
    warns(s, 'losesMoney');
    expect(s.ok).toBe(true);
  });
});

describe('loadSheet agrees with fitOffer', () => {
  it('carries fitOffer\'s code at the required fuel and no fit code when fitOffer finds none', () => {
    const fitCodes: LoadSheetCode[] = ['seats', 'stationLimit', 'overMtow', 'runwayShort', 'grass'];
    const loads: OfferItem[][] = [
      [], [pax(1)], [pax(1), bag(1, 15)], [pax(1), pax(2), pax(3)], [freight(60)], [freight(250)], [freight(700)],
      [1, 2, 3, 4, 5].map((n) => pax(n, 90)), [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => pax(n)),
    ];
    const dests = ['EAST', 'NRTH', 'SHRT', 'GRSS'];
    let refused = 0;
    for (const type of CAREER_AIRCRAFT_IDS) {
      for (const load of loads) {
        for (const d of dests) {
          const o = offer(load, { destination: { kind: 'field', code: d }, windDirDeg: 45, windKt: 10 });
          const required = loadSheet(o, plane(type), 0, save(), FIELDS).requiredFuelKg;
          const s = loadSheet(o, plane(type, { fuelKg: required }), required, save(), FIELDS);
          const fit = fitOffer(o, type, FIELDS);
          const sheetFit = codes(s).filter((c) => fitCodes.includes(c));
          if (fit === null) expect(sheetFit, `${type} ${d} ${load.length}`).toEqual([]);
          else {
            refused++;
            expect(sheetFit, `${type} ${d} ${load.length}`).toContain(fit);
          }
        }
      }
    }
    expect(refused).toBeGreaterThan(20);
  });
});
