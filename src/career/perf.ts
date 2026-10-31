// The Career's performance and business table (docs/career.md "Types and the performance table"): one CareerPerf
// row per type the Career flies, as literal numbers.
//
// This module imports no aircraft module (each type is a lazy chunk, src/aircraft/registry.ts; the Career reaches
// the main bundle through the Simulator, so an import here would pull every type in). tests/career/perf.test.ts
// loads every definition and proves the columns that come from it: empty mass, MTOW, MLW, ICAO type, usable fuel
// (the tank sum, within 0.1 kg), fuel grade, class (helicopter iff `def.rotorcraft`, twin iff two piston engines)
// and the CG figures (`cg.emptyX` the empty airframe's, `cg.fwdX` / `cg.aftX` the CGs of the type's own `forward`
// and `aft` loadings with their fuel, within 1 mm). The masses are written to the definitions' full precision.
//
// Cruise TAS and fuel flow are planning figures at the 2,000 ft planning height. The flows were MEASURED on
// 2026-10-31 by tests/career/perfCalibration.test.ts (slow): each type on the 'cruise' scenario moved to 2,500 ft,
// zero wind and turbulence, its `typical` loading and full tanks, the autoflight's heading and altitude hold with
// the speed on the throttle (autothrottle) at the KIAS of the table's TAS, settled for 60 s, then 3 min measured.
// That is the type's `airborne` preset (full rich, no leaning: the sim's pilot does not lean below 3,000 ft), so
// the piston flows are above the book's leaned figures (the C172S burns 36.7 kg/h at 117 KTAS, not the POH's
// 27). Measured TAS (the hold flies indicated airspeed, so the type's position error moves it): c152 97.1, pa38
// 97.9, da20 110.1, c172s 117.0, pa34 165.3, c208 159.0, pc12 233.9, and every helicopter on its target; every
// table TAS is within 3 % of that and kept. Measured flows, kg/h: c152 18.9, pa38 20.3, da20 17.5, c172s 36.7,
// pa34 57.5, c208 146.1, pc12 269.5, r22 20.9, s269 26.8, r44 38.1, md500 80.8, bo105 143.0 (the table rounds
// them). Every helicopter flew headless; none is calibrated from its definition alone. The helicopters' TAS is the
// definition's `vcruise` plus 2 % per 1,000 ft at 2,000 ft (round(vcruise x 1.04)). Every planning TAS is below Vno
// at 2,000 ft ISA (perf.test).
//
// The station limits (stationMaxKg) cite each type's POH; the front seat is the seat beside the pilot (110 kg, a
// seat limit for the Career where the POH gives none: the seat's structural rating is far above any occupant), a
// seat station's figure is that limit times its free seats. Money (list price, buy-in, hourly rates, lease
// reputation) is game data (docs/career.md "Buying is game-scaled"). Passenger seats exclude the pilot.

import type { AircraftClass, CareerAircraftId, CareerPerf } from './types';

/** Every aeroplane needs the single-engine piston rating; twins and turbines add theirs. */
const SEP = ['sep'] as const;
const MEP = ['sep', 'mep'] as const;
const TURBINE = ['sep', 'turbine'] as const;
const HELI = ['heli'] as const;
/** Turbine helicopters: the helicopter rating and the turbine (and high performance) rating. */
const HELI_TURBINE = ['heli', 'turbine'] as const;

/**
 * The Career's table, one row per type (docs/career.md). Masses kg, speeds kt, flows kg/h, CG body x m (the
 * definition's frame: x forward of the reference point), runway m, money $.
 */
export const CAREER_PERF: Readonly<Record<CareerAircraftId, CareerPerf>> = {
  c152: {
    id: 'c152', cls: 'trainer', icaoType: 'C152', ratings: SEP, paxSeats: 1,
    // POH 1978 sect. 6: baggage area 1 + 2, 120 lb combined.
    stationMaxKg: { front: 110, baggage: 54 },
    emptyKg: 515.28093232, mtowKg: 757.4992579, mlwKg: 757.4992579,
    usableFuelKg: 66.68, deliveryFuelKg: 33.34, fuel: 'avgas',
    cruiseTasKt: 100, fuelFlowKgH: 19, maxDemoCrosswindKt: 12,
    cg: { emptyX: 0.0907, fwdX: 0.0213, aftX: -0.0742 },
    minRunwayM: 450, grassOk: true, pressurised: false,
    listPrice: 45_000, buyIn: 3_000, ownedHourly: 55, leaseHourly: 120, leaseRep: 0,
  },
  pa38: {
    id: 'pa38', cls: 'trainer', icaoType: 'PA38', ratings: SEP, paxSeats: 1,
    // POH (Piper Report 2126) sect. 6: baggage shelf, 100 lb.
    stationMaxKg: { front: 110, baggage: 45 },
    emptyKg: 530.24948053, mtowKg: 757.4992579, mlwKg: 757.4992579,
    usableFuelKg: 81.65, deliveryFuelKg: 40.825, fuel: 'avgas',
    cruiseTasKt: 100, fuelFlowKgH: 20, maxDemoCrosswindKt: 15,
    cg: { emptyX: 0.1029, fwdX: 0.0954, aftX: -0.0316 },
    minRunwayM: 450, grassOk: true, pressurised: false,
    listPrice: 42_000, buyIn: 2_500, ownedHourly: 55, leaseHourly: 115, leaseRep: 0,
  },
  da20: {
    id: 'da20', cls: 'trainer', icaoType: 'DV20', ratings: SEP, paxSeats: 1,
    // AFM DA202-C1 sect. 6: baggage compartment, 44 lb (20 kg).
    stationMaxKg: { front: 110, baggage: 20 },
    emptyKg: 535, mtowKg: 800, mlwKg: 800,
    usableFuelKg: 65.43, deliveryFuelKg: 32.715, fuel: 'avgas',
    cruiseTasKt: 110, fuelFlowKgH: 17.5, maxDemoCrosswindKt: 20,
    cg: { emptyX: 0.0205, fwdX: 0.0925, aftX: -0.0115 },
    minRunwayM: 450, grassOk: true, pressurised: false,
    listPrice: 95_000, buyIn: 3_500, ownedHourly: 60, leaseHourly: 135, leaseRep: 5,
  },
  c172s: {
    id: 'c172s', cls: 'tourer', icaoType: 'C172', ratings: SEP, paxSeats: 3,
    // POH sect. 6: baggage areas A + B, 120 lb combined; the rear seats two of 110.
    stationMaxKg: { front: 110, rear: 220, baggage: 54 },
    emptyKg: 754.32411131, mtowKg: 1156.6605435, mlwKg: 1156.6605435,
    usableFuelKg: 144, deliveryFuelKg: 72, fuel: 'avgas',
    cruiseTasKt: 120, fuelFlowKgH: 37, maxDemoCrosswindKt: 15,
    cg: { emptyX: 0.0212, fwdX: -0.0085, aftX: -0.1648 },
    minRunwayM: 500, grassOk: true, pressurised: false,
    listPrice: 220_000, buyIn: 4_500, ownedHourly: 85, leaseHourly: 190, leaseRep: 0,
  },
  pa34: {
    id: 'pa34', cls: 'twin', icaoType: 'PA34', ratings: MEP, paxSeats: 5,
    // Owner's handbook sect. 6: forward (nose) and aft baggage, 100 lb each; the centre and rear rows four of 110.
    stationMaxKg: { front: 110, cabin: 440, baggage: 90 },
    emptyKg: 1292.7382545, mtowKg: 1905.087954, mlwKg: 1814.36948,
    usableFuelKg: 253.1, deliveryFuelKg: 126.55, fuel: 'avgas',
    cruiseTasKt: 165, fuelFlowKgH: 58, maxDemoCrosswindKt: 17,
    cg: { emptyX: 0.235, fwdX: 0.1585, aftX: -0.0119 },
    minRunwayM: 900, grassOk: false, pressurised: false,
    listPrice: 260_000, buyIn: 9_500, ownedHourly: 210, leaseHourly: 420, leaseRep: 30,
  },
  c208: {
    id: 'c208', cls: 'turbine', icaoType: 'C208', ratings: TURBINE, paxSeats: 9,
    // POH sect. 6: cabin floor (eight passenger seats in the commuter layout), cargo pod 1,090 lb in four bays
    // (the Career takes 450 kg).
    stationMaxKg: { front: 110, cabin: 990, cargo: 450 },
    emptyKg: 2086.524902, mtowKg: 3628.73896, mlwKg: 3538.020486,
    usableFuelKg: 1008.97, deliveryFuelKg: 504.485, fuel: 'jetA1',
    cruiseTasKt: 160, fuelFlowKgH: 146, maxDemoCrosswindKt: 20,
    cg: { emptyX: 0.0528, fwdX: 0.088, aftX: -0.2112 },
    minRunwayM: 650, grassOk: true, pressurised: false,
    listPrice: 2_000_000, buyIn: 28_500, ownedHourly: 520, leaseHourly: 1_150, leaseRep: 50,
  },
  pc12: {
    id: 'pc12', cls: 'turbine', icaoType: 'PC12', ratings: TURBINE, paxSeats: 9,
    // POH sect. 6: the cabin (STD-9S seats) and the aft cargo area, 180 kg.
    stationMaxKg: { front: 110, cabin: 990, cargo: 180 },
    emptyKg: 2800, mtowKg: 4740, mlwKg: 4500,
    usableFuelKg: 1217.6, deliveryFuelKg: 608.8, fuel: 'jetA1',
    cruiseTasKt: 230, fuelFlowKgH: 270, maxDemoCrosswindKt: 25,
    cg: { emptyX: 0.15, fwdX: 0.102, aftX: -0.107 },
    minRunwayM: 800, grassOk: true, pressurised: true,
    listPrice: 4_200_000, buyIn: 45_000, ownedHourly: 700, leaseHourly: 1_700, leaseRep: 60,
  },
  r22: {
    id: 'r22', cls: 'heli', icaoType: 'R22', ratings: HELI, paxSeats: 1,
    // POH sect. 2: 240 lb per seat including the under-seat compartment; 50 lb a compartment (the Career: 23 kg).
    stationMaxKg: { front: 109, baggage: 23 },
    emptyKg: 399.1612856, mtowKg: 621.4215469, mlwKg: 621.4215469,
    usableFuelKg: 71.58, deliveryFuelKg: 35.79, fuel: 'avgas',
    cruiseTasKt: 83, fuelFlowKgH: 21, maxDemoCrosswindKt: null,
    cg: { emptyX: -0.1016, fwdX: 0.064, aftX: -0.0265 },
    minRunwayM: 0, grassOk: true, pressurised: false,
    listPrice: 330_000, buyIn: 6_500, ownedHourly: 160, leaseHourly: 300, leaseRep: 0,
  },
  s269: {
    id: 's269', cls: 'heli', icaoType: 'H269', ratings: HELI, paxSeats: 1,
    // RFM sect. 6: the baggage compartment, 100 lb.
    stationMaxKg: { front: 110, baggage: 45 },
    emptyKg: 501.21956885, mtowKg: 793.7866475, mlwKg: 793.7866475,
    usableFuelKg: 88.45, deliveryFuelKg: 44.225, fuel: 'avgas',
    cruiseTasKt: 73, fuelFlowKgH: 27, maxDemoCrosswindKt: null,
    cg: { emptyX: -0.0178, fwdX: 0.0508, aftX: 0.0073 },
    minRunwayM: 0, grassOk: true, pressurised: false,
    listPrice: 300_000, buyIn: 6_000, ownedHourly: 160, leaseHourly: 290, leaseRep: 0,
  },
  r44: {
    id: 'r44', cls: 'heli', icaoType: 'R44', ratings: HELI, paxSeats: 3,
    // POH sect. 2 (r44/limits.ts R44_LOADING_LIMITS): 300 lb per seat with its under-seat compartment, 50 lb a
    // compartment (the Career: two, 45 kg).
    stationMaxKg: { front: 136, rear: 272, baggage: 45 },
    emptyKg: 684.9244787, mtowKg: 1133.980925, mlwKg: 1133.980925,
    usableFuelKg: 126.55, deliveryFuelKg: 63.275, fuel: 'avgas',
    cruiseTasKt: 104, fuelFlowKgH: 38, maxDemoCrosswindKt: null,
    cg: { emptyX: -0.1651, fwdX: 0.1623, aftX: 0.0386 },
    minRunwayM: 0, grassOk: true, pressurised: false,
    listPrice: 520_000, buyIn: 11_000, ownedHourly: 240, leaseHourly: 480, leaseRep: 20,
  },
  md500: {
    id: 'md500', cls: 'heliTurbine', icaoType: 'H500', ratings: HELI_TURBINE, paxSeats: 4,
    // RFM sect. 6: the aft compartment (a bench of three, the blurb's five seats), and the baggage under it.
    stationMaxKg: { front: 110, cabin: 300, baggage: 45 },
    emptyKg: 684.9244787, mtowKg: 1360.77711, mlwKg: 1360.77711,
    usableFuelKg: 191.37, deliveryFuelKg: 95.685, fuel: 'jetA1',
    cruiseTasKt: 125, fuelFlowKgH: 81, maxDemoCrosswindKt: null,
    cg: { emptyX: -0.2286, fwdX: -0.022, aftX: -0.1027 },
    minRunwayM: 0, grassOk: true, pressurised: false,
    listPrice: 1_300_000, buyIn: 19_500, ownedHourly: 420, leaseHourly: 850, leaseRep: 40,
  },
  bo105: {
    id: 'bo105', cls: 'heliTurbine', icaoType: 'B105', ratings: HELI_TURBINE, paxSeats: 4,
    // FM sect. 6: the rear bench (three seats) and the cargo compartment behind it (aft clamshell doors).
    stationMaxKg: { front: 110, cabin: 330, cargo: 250 },
    emptyKg: 1276, mtowKg: 2500, mlwKg: 2500,
    usableFuelKg: 456, deliveryFuelKg: 228, fuel: 'jetA1',
    cruiseTasKt: 104, fuelFlowKgH: 143, maxDemoCrosswindKt: null,
    cg: { emptyX: -0.2192, fwdX: -0.0861, aftX: -0.1296 },
    minRunwayM: 0, grassOk: true, pressurised: false,
    listPrice: 1_700_000, buyIn: 29_500, ownedHourly: 650, leaseHourly: 1_300, leaseRep: 50,
  },
};

/** The Career's row of a type. */
export function careerPerf(id: CareerAircraftId): CareerPerf {
  return CAREER_PERF[id];
}

/** True for the helicopter classes (rotorcraft: no runway, crosswind or grass check; reserve RESERVE_MIN_HELI). */
export function isRotorcraftClass(cls: AircraftClass): boolean {
  return cls === 'heli' || cls === 'heliTurbine';
}
