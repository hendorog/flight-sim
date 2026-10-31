// Proves the Career's cost and planning arithmetic (src/career/costs.ts) on hand-worked numbers: docs/career.md's
// pay and pay-floor examples to the dollar (at the doc's planning figures for the C152, 100 kt and 17 kg/h), the
// worked settlement's fuel, landing-fee and lease lines, fuel prices by grade and place (grass and fuel-truck
// surcharges), the wind components and ground speed (legs, loops and the floor), the fuel plan with the
// helicopters' shorter reserve, flight time, block hours, uplift and defuel, endurance and the insurance excess
// clamps.

import { describe, expect, it } from 'vitest';
import {
  basePricePerKg, bearingDeg, blockHours, burnKg, defuelCredit, enduranceMin, flightTimeMin, fuelCost, fuelPlan,
  fuelPricePerKg, groundSpeedKt, hourlyRate, hoursCost, insuranceExcess, landingFee, offerPay, payFloor, payFormula,
  reserveMin, sellsGrade, upliftAndDefuel, windComponents,
} from '../../src/career/costs';
import { CAREER_PERF } from '../../src/career/perf';
import type { CareerPerf } from '../../src/career/types';

/** The C152 at docs/career.md's planning figures (the table before calibration): 100 kt, 17 kg/h. */
const DOC_C152: CareerPerf = { ...CAREER_PERF.c152, cruiseTasKt: 100, fuelFlowKgH: 17 };

describe('Career costs', () => {
  it('reproduces the doc\'s trainer charter: $280 by the formula, a $178 floor, so $280', () => {
    expect(payFormula('charter', 20, 1, 0, 'trainer', 'clear')).toBe(280);
    const floor = payFloor(DOC_C152, 20, 100, 1.15);
    expect(floor).toBe(178);
    expect(payFloor(DOC_C152, 20, 100)).toBe(154);
    expect(offerPay(280, floor)).toBe(280);
    // The floor's parts: 0.78 h of lease and $25 of fuel.
    expect(blockHours(flightTimeMin(20, 100), 'trainer')).toBeCloseTo(0.7833333333, 9);
    expect(burnKg(fuelPlan(DOC_C152, 20, 100)) * basePricePerKg('avgas')).toBeCloseTo(24.795, 3);
  });

  it('applies the class, weather and premium multipliers and rounds the pay to $5', () => {
    // Freight, tourer, rain, regular client: (70 + 6 x 30 + 0.8 x 150) x 1.3 x 1.25 x 1.15 = 691.4375.
    expect(payFormula('freight', 30, 0, 150, 'tourer', 'rain', 1.15)).toBeCloseTo(691.4375, 9);
    expect(offerPay(691.4375, 0)).toBe(690);
    expect(offerPay(100, 177.6)).toBe(180);
    expect(offerPay(282.5, 0)).toBe(285);
  });

  it('prices the doc\'s worked settlement: $43 of fuel, a $16 landing fee and $72 of lease', () => {
    expect(fuelCost(12, 'avgas', 'sealed')).toBe(43);
    expect(landingFee('sealed', CAREER_PERF.c152.mtowKg)).toBe(16);
    expect(hoursCost(0.6, CAREER_PERF.c152, 'leased')).toBe(72);
    expect(hoursCost(0.6, CAREER_PERF.c152, 'owned')).toBe(33);
    expect(hourlyRate(CAREER_PERF.pc12, 'leased')).toBe(1700);
    // 22 kg left at shutdown is 78 minutes of the doc's 17 kg/h.
    expect(Math.round(enduranceMin(DOC_C152, 22))).toBe(78);
  });

  it('prices fuel by grade and place: grass sells avgas at +10 %, a fuel truck brings the rest at +50 %', () => {
    expect(sellsGrade('home', 'jetA1')).toBe(true);
    expect(sellsGrade('sealed', 'avgas')).toBe(true);
    expect(sellsGrade('grass', 'avgas')).toBe(true);
    expect(sellsGrade('grass', 'jetA1')).toBe(false);
    expect(sellsGrade('site', 'avgas')).toBe(false);
    expect(fuelPricePerKg('avgas', 'home')).toEqual({ perKg: 2.6 / 0.719, truck: false });
    expect(fuelPricePerKg('avgas', 'grass').perKg).toBeCloseTo((2.6 / 0.719) * 1.1, 12);
    expect(fuelPricePerKg('jetA1', 'grass')).toEqual({ perKg: (1.95 / 0.8) * 1.5, truck: true });
    expect(fuelCost(12, 'avgas', 'grass')).toBe(48);
    expect(fuelCost(12, 'jetA1', 'sealed')).toBe(29);
    expect(fuelCost(12, 'jetA1', 'grass')).toBe(44);
    expect(fuelCost(12, 'avgas', 'site')).toBe(65);
    expect(fuelCost(-3, 'avgas', 'home')).toBe(0);
  });

  it('charges landing fees by field kind and MTOW', () => {
    expect(landingFee('home', 757.4992579)).toBe(26);
    expect(landingFee('home', 4740)).toBe(58);
    expect(landingFee('sealed', 4740)).toBe(36);
    expect(landingFee('grass', 4740)).toBe(5);
    expect(landingFee('site', 2500)).toBe(0);
  });

  it('credits defuelled fuel at half its list price and splits a fuel choice into uplift or defuel', () => {
    expect(defuelCredit(10, 'avgas')).toBe(18);
    expect(defuelCredit(100, 'jetA1')).toBe(122);
    expect(upliftAndDefuel(40, 30)).toEqual({ upliftKg: 10, defuelKg: 0 });
    expect(upliftAndDefuel(30, 40)).toEqual({ upliftKg: 0, defuelKg: 10 });
    expect(upliftAndDefuel(30, 30)).toEqual({ upliftKg: 0, defuelKg: 0 });
  });

  it('resolves the wind into head and cross components and plans the ground speed', () => {
    expect(windComponents(90, 90, 10).headwind).toBeCloseTo(10, 12);
    expect(windComponents(90, 90, 10).crosswind).toBeCloseTo(0, 12);
    expect(windComponents(90, 180, 10).headwind).toBeCloseTo(0, 12);
    expect(windComponents(90, 180, 10).crosswind).toBeCloseTo(10, 12);
    expect(windComponents(90, 270, 10).headwind).toBeCloseTo(-10, 12);
    expect(windComponents(350, 50, 20).headwind).toBeCloseTo(10, 12);
    expect(groundSpeedKt(100, { kind: 'leg', trackDeg: 90 }, 90, 10)).toBeCloseTo(90, 12);
    expect(groundSpeedKt(100, { kind: 'leg', trackDeg: 90 }, 270, 10)).toBeCloseTo(110, 12);
    expect(groundSpeedKt(100, { kind: 'loop' }, 123, 10)).toBe(95);
    expect(groundSpeedKt(100, { kind: 'leg', trackDeg: 0 }, 0, 60)).toBe(50);
    expect(bearingDeg({ north: 0, east: 0 }, { north: 0, east: 1000 })).toBeCloseTo(90, 12);
    expect(bearingDeg({ north: 0, east: 0 }, { north: 1000, east: 0 })).toBeCloseTo(0, 12);
    expect(bearingDeg({ north: 0, east: 0 }, { north: 0, east: -1000 })).toBeCloseTo(270, 12);
    expect(bearingDeg({ north: 0, east: 0 }, { north: -1000, east: -1000 })).toBeCloseTo(225, 12);
  });

  it('plans trip, climb, taxi and reserve fuel, with the helicopters\' 20-minute reserve', () => {
    const p = fuelPlan(DOC_C152, 20, 100);
    expect(p.tripKg).toBeCloseTo(3.4, 12);
    expect(p.climbKg).toBeCloseTo(17 / 12, 12);
    expect(p.taxiKg).toBeCloseTo(1.7, 12);
    expect(p.reserveKg).toBeCloseTo(8.5, 12);
    expect(p.requiredKg).toBeCloseTo(1.1 * 3.4 + 17 / 12 + 1.7 + 8.5, 12);
    expect(burnKg(p)).toBeCloseTo(p.requiredKg - 8.5, 12);
    expect(reserveMin(CAREER_PERF.r44)).toBe(20);
    expect(reserveMin(CAREER_PERF.c208)).toBe(30);
    const r44 = fuelPlan(CAREER_PERF.r44, 26, 104);
    expect(r44.tripKg).toBeCloseTo(0.25 * CAREER_PERF.r44.fuelFlowKgH, 12);
    expect(r44.reserveKg).toBeCloseTo(CAREER_PERF.r44.fuelFlowKgH / 3, 12);
  });

  it('adds 10 minutes to the airborne time and the class\'s taxi allowance to the block', () => {
    expect(flightTimeMin(20, 100)).toBeCloseTo(22, 12);
    expect(flightTimeMin(30, 150)).toBeCloseTo(22, 12);
    expect(blockHours(22, 'turbine')).toBeCloseTo(52 / 60, 12);
    expect(blockHours(22, 'heli')).toBeCloseTo(47 / 60, 12);
  });

  it('clamps the insurance excess to $2,000..$25,000 of 5 % of the list price', () => {
    expect(insuranceExcess(CAREER_PERF.c152)).toBe(2250);
    expect(insuranceExcess(CAREER_PERF.pa38)).toBe(2100);
    expect(insuranceExcess({ ...CAREER_PERF.c152, listPrice: 20_000 })).toBe(2000);
    expect(insuranceExcess(CAREER_PERF.c172s)).toBe(11_000);
    expect(insuranceExcess(CAREER_PERF.pc12)).toBe(25_000);
  });
});
