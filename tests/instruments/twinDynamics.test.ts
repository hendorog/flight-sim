// Instrument dynamics of a twin and of a FADEC diesel: per-engine readings, two vacuum pumps, electric gyros,
// load meters, gear lights. Each test states a physical fact with its number and where the number comes from
// (work/aircraft-data/pa34.md and da42.md quote the handbooks).

import { describe, expect, it } from 'vitest';
import { C172S_INSTRUMENT_SYSTEMS } from '../../src/aircraft/c172s/panel';
import { DEG } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather, setEngineControl } from '../../src/core/types';
import { InstrumentSet } from '../../src/instruments/dynamics/instrumentSet';
import type { InstrumentSystemsDef } from '../../src/instruments/panelDef';
import { FADEC_TESTBED_SYSTEMS, run, TWIN_TESTBED_SYSTEMS, twinControls, twinState } from './testbed';

const LB = 0.45359237;
const L_PER_GAL = 3.785411784;

describe('per-engine readings', () => {
  it('is mirror symmetric: swapping the two engines swaps their readings exactly', () => {
    const a = twinState();
    Object.assign(a.engines[0], { rpm: 2450, propRpm: 2450, manifoldPressure: 24.5, fuelFlow: 0.0071, egt: 705, cht: 196, oilTemp: 88, oilPressure: 62, fuelPressure: 24, loadPercent: 74 });
    Object.assign(a.engines[1], { rpm: 1310, propRpm: 1310, manifoldPressure: 11.2, fuelFlow: 0.0009, egt: 380, cht: 121, oilTemp: 64, oilPressure: 31, fuelPressure: 18, loadPercent: 6 });
    const b = twinState();
    Object.assign(b.engines[0], a.engines[1]);
    Object.assign(b.engines[1], a.engines[0]);
    const setA = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS, tachHours: 500 });
    const setB = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS, tachHours: 500 });
    run(setA, 7.3, a);
    run(setB, 7.3, b);
    // Identical arithmetic on either side: not one bit differs.
    expect(setA.readings.engines[0]).toEqual(setB.readings.engines[1]);
    expect(setA.readings.engines[1]).toEqual(setB.readings.engines[0]);
    // And the two engines really read differently (the test would pass on a set that ignored engine 1).
    expect(setA.readings.engines[0].rpm - setA.readings.engines[1].rpm).toBeCloseTo(2450 - 1310, 0);
    expect(setA.readings.engines[0].manifoldInHg - setA.readings.engines[1].manifoldInHg).toBeCloseTo(24.5 - 11.2, 3);
  });

  it('keeps every single-engine reading on engine 0 (the left engine), bit for bit', () => {
    const s = twinState();
    Object.assign(s.engines[0], { rpm: 2380, oilTemp: 91, oilPressure: 58, egt: 690, fuelFlow: 0.0066 });
    Object.assign(s.engines[1], { rpm: 900, oilTemp: 40, oilPressure: 22, egt: 300, fuelFlow: 0.001 });
    const set = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS });
    run(set, 3, s);
    const r = set.readings;
    const e0 = r.engines[0];
    expect([r.rpm, r.tachHours, r.oilTempF, r.oilPressurePsi, r.egtF, r.fuelFlowGph]).toEqual([e0.rpm, e0.tachHours, e0.oilTempF, e0.oilPressurePsi, e0.egtF, e0.fuelFlowGph]);
    expect([r.fuelLeftGal, r.fuelRightGal]).toEqual([r.fuelGal[0], r.fuelGal[1]]);
    expect(set.tach.hours).toBe(e0.tachHours);
    // On a single the per-engine record is the same reading again.
    const single = new InstrumentSet();
    run(single, 3, makeMockState({ rpm: 2380 }), defaultControls());
    expect(single.readings.engines).toHaveLength(1);
    expect(single.readings.engines[0].rpm).toBe(single.readings.rpm);
  });

  it('converts to the units of the dials: 100 C is 212 F, 6.0 lb of avgas is a US gallon', () => {
    const s = twinState();
    // 10.3 US gal/h per engine is the handbook's 75 % cruise flow (pa34.md, OH-1): 10.3 x 6.0 lb/gal x 0.45359237 kg/lb / 3600 s.
    const flow = (10.3 * 6.0 * LB) / 3600;
    Object.assign(s.engines[1], { oilTemp: 100, cht: 100, egt: 700, fuelFlow: flow, oilPressure: 60, fuelPressure: 21, loadPercent: 75, manifoldPressure: 24 });
    const set = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS });
    run(set, 60, s);
    const e = set.readings.engines[1];
    expect(e.oilTempF).toBeCloseTo(212, 3);
    expect(e.chtF).toBeCloseTo(212, 3);
    expect(e.egtF).toBeCloseTo(1292, 2);
    expect(e.fuelFlowGph).toBeCloseTo(10.3, 2);
    expect(e.oilPressurePsi).toBeCloseTo(60, 6);
    expect(e.fuelPressurePsi).toBeCloseTo(21, 6);
    expect(e.loadPct).toBeCloseTo(75, 6);
    expect(e.manifoldInHg).toBeCloseTo(24, 6);
  });

  it('gauges fuel flow by the density of the fuel burned: Jet A-1 at 0.80 kg/L reads 9.3 gal/h at 100 % load', () => {
    // da42.md (AFM 5): 9.3 US gal/h per engine at 100 % load; the manual's density for the figures is 0.80 kg/L.
    const flow = (9.3 * L_PER_GAL * 0.8) / 3600;
    const s = twinState();
    s.engines[0].fuelFlow = flow;
    const diesel = new InstrumentSet({ systems: FADEC_TESTBED_SYSTEMS });
    const avgas = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS });
    run(diesel, 30, s);
    run(avgas, 30, s);
    expect(diesel.readings.engines[0].fuelFlowGph).toBeCloseTo(9.3, 3);
    // The same mass flow gauged as avgas (6.0 lb/gal = 0.719 kg/L) would over-read by 0.80 / 0.719 = 11 %.
    expect(avgas.readings.engines[0].fuelFlowGph / 9.3).toBeCloseTo((0.8 * L_PER_GAL) / (6.0 * LB), 4);
  });

  it('reads the propeller shaft on a geared engine: 3880 crank rpm is 2300 on the tachometer (1.69 : 1)', () => {
    // da42.md (AFM 7.9.1): take-off power at 2300 propeller rpm = 3880 crank rpm; gearbox 1 : 1.69.
    const s = twinState();
    for (const e of s.engines) Object.assign(e, { rpm: 3880, propRpm: 3880 / 1.69 });
    const geared = new InstrumentSet({ systems: FADEC_TESTBED_SYSTEMS });
    const direct = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS });
    run(geared, 5, s);
    run(direct, 5, s);
    expect(Math.abs(geared.readings.engines[1].rpm - 2300)).toBeLessThan(5);
    expect(geared.readings.rpm).toBeCloseTo(3880 / 1.69, 3);
    // Without the definition's word for it the tachometer is on the crank.
    expect(direct.readings.engines[1].rpm).toBeCloseTo(3880, 3);
  });

  it('counts tach hours per engine in proportion to its revolutions', () => {
    // One hour at the definition's hour rpm is one tach hour; half the revolutions are half an hour; none, none.
    const hourRpm = TWIN_TESTBED_SYSTEMS.tachHourRpm;
    const s = twinState();
    s.engines[0].rpm = hourRpm;
    s.engines[1].rpm = hourRpm / 2;
    const set = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS, tachHours: 1000 });
    run(set, 3600, s, twinControls(), 1);
    expect(set.readings.engines[0].tachHours - 1000).toBeCloseTo(1, 3);
    expect(set.readings.engines[1].tachHours - 1000).toBeCloseTo(0.5, 3);
    s.engines[1].rpm = 0;
    const before = set.readings.engines[1].tachHours;
    run(set, 600, s, twinControls(), 1);
    expect(set.readings.engines[1].tachHours - before).toBeLessThan(1e-4);
  }, 20_000);

  it('on a dead bus the electric gauges fall to their stops; manifold pressure and the tachometer still read', () => {
    const s = twinState({ rpm: 2400 });
    for (const e of s.engines) Object.assign(e, { manifoldPressure: 25, oilPressure: 60, loadPercent: 70 });
    const set = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS });
    run(set, 20, s);
    expect(set.readings.engines[1].oilPressurePsi).toBeCloseTo(60, 3);
    s.electrical.busVoltage = 0;
    // An unpowered needle returns to its stop with a 1 s time constant: after 5 s, exp(-5) = 0.7 % is left.
    run(set, 5, s);
    const e = set.readings.engines[1];
    expect(e.oilPressurePsi / 60).toBeCloseTo(Math.exp(-5), 3);
    expect(e.loadPct / 70).toBeCloseTo(Math.exp(-5), 3);
    // A direct-reading pressure gauge and a cable-driven tachometer need no bus.
    expect(e.manifoldInHg).toBeCloseTo(25, 6);
    expect(e.rpm).toBeCloseTo(2400, 3);
    expect(set.readings.busPowered).toBe(false);
  });

  it('takes a 14 V bus as alive where the 28 V Cessna would be dead', () => {
    const s = twinState();
    s.electrical.busVoltage = 13.8;
    const twin = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS });
    const c172 = new InstrumentSet({ systems: { ...C172S_INSTRUMENT_SYSTEMS } });
    run(twin, 1, s);
    run(c172, 1, s);
    expect(twin.readings.busPowered).toBe(true);
    expect(twin.readings.busVolts).toBe(13.8);
    expect(c172.readings.busPowered).toBe(false);
  });

  it('shows the carburettor heat knob of engine 0', () => {
    const s = twinState();
    const c = twinControls();
    c.carbHeat = 1;
    setEngineControl(c, 1, 'carbHeat', 0);
    const set = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS });
    run(set, 0.1, s, c);
    expect(set.readings.carbHeat).toBe(1);
    setEngineControl(c, 0, 'carbHeat', 0.5);
    run(set, 0.1, s, c);
    expect(set.readings.carbHeat).toBe(0.5);
  });

  it('halves one gauged tank into the legacy pair, so their sum is still the fuel on board', () => {
    const oneTank: InstrumentSystemsDef = { ...C172S_INSTRUMENT_SYSTEMS, fuel: { kgPerGal: 2.7216, tanks: [(s) => s.fuel.left + s.fuel.right] } };
    const s = makeMockState();
    s.fuel.left = 30;
    s.fuel.right = 24.432;
    const set = new InstrumentSet({ systems: oneTank });
    run(set, 30, s, defaultControls());
    const r = set.readings;
    expect(r.fuelGal).toHaveLength(1);
    expect(r.fuelGal[0]).toBeCloseTo(54.432 / 2.7216, 3);
    expect(r.fuelLeftGal + r.fuelRightGal).toBe(r.fuelGal[0]);
  });
});

describe('vacuum pumps and gyros of a twin', () => {
  it('regulates at 5.0 inHg at 2000 rpm and holds the gyros on either pump alone', () => {
    // pa34.md (OH-2): a pump per engine, regulators set to 5.0 +/- 0.1 inHg at 2000 rpm; one pump carries all the gyros.
    const s = twinState({ rpm: 2000 });
    const set = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS });
    run(set, 10, s);
    expect(Math.abs(set.readings.suctionInHg - 5.0)).toBeLessThan(0.1);
    for (const dead of [0, 1]) {
      const one = twinState({ rpm: 2000 });
      Object.assign(one.engines[dead], { rpm: 0, running: false });
      const oneSet = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS });
      run(oneSet, 300, one);
      expect(Math.abs(oneSet.readings.suctionInHg - 5.0), `engine ${dead} dead`).toBeLessThan(0.1);
      expect(oneSet.attitude.rotor.spin, `engine ${dead} dead`).toBeGreaterThan(0.99);
      expect(oneSet.readings.lamps.vacuum).toBe(false);
    }
  });

  it('loses suction with both engines stopped: the rotors coast down with their 180 s time constant', () => {
    const s = twinState({ rpm: 0 });
    for (const e of s.engines) e.running = false;
    const set = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS });
    run(set, 180, s);
    expect(set.readings.suctionInHg).toBeLessThan(0.01);
    expect(set.readings.lamps.vacuum).toBe(true);
    // First-order coast-down: exp(-1) of rated speed after one time constant (less the 0.4 s the suction line takes to bleed off).
    expect(set.attitude.rotor.spin).toBeCloseTo(Math.exp(-1), 2);
    expect(set.heading.rotor.spin).toBeCloseTo(Math.exp(-1), 2);
  });

  it('electric gyros run on the bus, not on the engines', () => {
    // No vacuum system at all (da42.md: none); both engines stopped, the bus alive on the battery.
    const s = twinState({ rpm: 0 });
    for (const e of s.engines) e.running = false;
    s.electrical.busVoltage = 25.2;
    const set = new InstrumentSet({ systems: FADEC_TESTBED_SYSTEMS });
    set.reset(s);
    expect(set.attitude.rotor.spin).toBe(1);
    run(set, 180, s);
    expect(set.readings.suctionInHg).toBe(0);
    expect(set.attitude.rotor.spin).toBeCloseTo(1, 6);
    // A rigid rotor shows a 20 degree bank in full.
    s.roll = 20 * DEG;
    run(set, 0.5, s);
    expect(set.readings.attitudeRoll / DEG).toBeCloseTo(20, 0);
    // Master off: now they coast down like any rotor, exp(-1) after 180 s.
    s.electrical.busVoltage = 0;
    run(set, 180, s);
    expect(set.attitude.rotor.spin).toBeCloseTo(Math.exp(-1), 3);
    expect(set.heading.rotor.spin).toBeCloseTo(Math.exp(-1), 3);
    // A reset with the bus dead starts them stopped, whatever the engines do.
    for (const e of s.engines) e.running = true;
    set.reset(s);
    expect(set.attitude.rotor.spin).toBe(0);
  });

  it('the air-driven gyros of the same state would be stopped after a reset', () => {
    const s = twinState({ rpm: 0 });
    for (const e of s.engines) e.running = false;
    const set = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS });
    set.reset(s);
    expect(set.attitude.rotor.spin).toBe(0);
    s.engines[1].running = true;
    set.reset(s);
    expect(set.attitude.rotor.spin).toBe(1);
  });
});

describe('load meters and alternator lamps', () => {
  it('shows each alternator its own current; the two add up to the bus supply', () => {
    // pa34.md: two 60 A alternators, "outputs about equal" on the run-up check.
    const s = twinState();
    s.electrical.alternators[0] = 31;
    s.electrical.alternators[1] = 22;
    const set = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS });
    run(set, 5, s);
    const amps = set.readings.alternatorAmps;
    expect(amps).toHaveLength(2);
    expect(amps[0]).toBeCloseTo(31, 4);
    expect(amps[1]).toBeCloseTo(22, 4);
    expect(amps[0] + amps[1]).toBeCloseTo(53, 4);
    expect(set.readings.lamps).toMatchObject({ leftAlternator: false, rightAlternator: false });
    // One alternator off line: its meter falls with the 0.3 s lag (63 % of the way after 0.3 s) and its lamp lights.
    s.electrical.alternators[0] = 0;
    run(set, 0.3, s);
    expect(set.readings.alternatorAmps[0] / 31).toBeCloseTo(Math.exp(-1), 2);
    expect(set.readings.lamps).toMatchObject({ leftAlternator: true, rightAlternator: false });
    expect(set.readings.alternatorAmps[1]).toBeCloseTo(22, 4);
  });

  it('has one load meter on a single', () => {
    const set = new InstrumentSet();
    const s = makeMockState();
    s.electrical.alternatorAmps = 18;
    run(set, 5, s, defaultControls());
    expect(set.readings.alternatorAmps).toHaveLength(1);
    expect(set.readings.alternatorAmps[0]).toBeCloseTo(18, 4);
    expect(set.readings.busVolts).toBe(28);
  });
});

describe('gear lights', () => {
  // da42.md (AFM 7.5): a green light per leg down and locked; red GEAR UNSAFE while the gear is neither fully up nor down and locked.
  const lights = (set: InstrumentSet): unknown => set.readings.gear && { ...set.readings.gear };

  it('has none on fixed gear', () => {
    const set = new InstrumentSet();
    run(set, 0.1, makeMockState(), defaultControls());
    expect(set.readings.gear).toBeNull();
  });

  it('three greens down and locked, red alone in transit, all dark when up', () => {
    const s = twinState();
    const set = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS });
    run(set, 0.1, s);
    expect(lights(set)).toEqual({ nose: true, left: true, right: true, inTransit: false });
    Object.assign(s.gear, { lever: 'up', extension: [0.5, 0.5, 0.5], locked: [false, false, false], inTransit: true });
    run(set, 0.1, s);
    expect(lights(set)).toEqual({ nose: false, left: false, right: false, inTransit: true });
    // The mains lock before the nose leg: two greens and the red.
    Object.assign(s.gear, { lever: 'down', extension: [0.9, 1, 1], locked: [false, true, true], inTransit: true });
    run(set, 0.1, s);
    expect(lights(set)).toEqual({ nose: false, left: true, right: true, inTransit: true });
    Object.assign(s.gear, { lever: 'up', extension: [0, 0, 0], locked: [false, false, false], inTransit: false });
    run(set, 0.1, s);
    expect(lights(set)).toEqual({ nose: false, left: false, right: false, inTransit: false });
  });

  it('the lamps are on the bus: none lit with the master off', () => {
    const s = twinState();
    s.electrical.busVoltage = 0;
    const set = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS });
    run(set, 0.1, s);
    expect(lights(set)).toEqual({ nose: false, left: false, right: false, inTransit: false });
  });
});

describe('cost', () => {
  it('a step of two engines costs at most 2.2 times a step of one', () => {
    const weather = defaultWeather();
    const time = (set: InstrumentSet, s: ReturnType<typeof makeMockState>, c: ReturnType<typeof defaultControls>): number => {
      let best = Infinity;
      for (let rep = 0; rep < 5; rep++) {
        const t0 = performance.now();
        for (let i = 0; i < 40_000; i++) set.step(1 / 60, s, c, weather);
        best = Math.min(best, performance.now() - t0);
      }
      return (best / 40_000) * 1000;
    };
    const single = time(new InstrumentSet(), makeMockState(), defaultControls());
    const twin = time(new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS }), twinState(), twinControls());
    console.log(`[instruments] InstrumentSet.step: one engine ${single.toFixed(2)} us, two engines ${twin.toFixed(2)} us, ratio ${(twin / single).toFixed(2)}`);
    expect(twin / single).toBeLessThan(2.2);
  }, 30_000);
});
